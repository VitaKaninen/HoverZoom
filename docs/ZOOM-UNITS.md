# What the zoom percentage counts · `E34`

**Status: IMPLEMENTED in v0.72.0.** Designed 2026-09-06, built the same day, to the letter of
what is below — every site in the table was changed and the setting exists. The design text is kept
as written because it is the argument, not a plan; see *Verification* at the bottom for what was
actually measured. The one deviation: the setting went into the panel's **first** section rather
than *The preview window*, because leaving `displayScale` at 1 on a scaled display makes the
readout worse than before the feature existed, so it must not sit behind the Advanced fold.

## The defect

`view.scale` is a ratio of **CSS pixels** to media pixels, and `fmtZoom()` prints it unchanged. A
CSS pixel is not a fixed size: browser zoom at 130 % paints it 1.3 screen pixels wide. So the
number moves when the picture does not.

Measured by hand, 480×854 clip, 1080-tall screen, `devicePixelRatio` 1 at 100 % browser zoom:

| browser zoom | state | reads | media on screen | ruler says |
|---|---|---|---|---|
| 100 % | hover | 104 % | 890 device px | 104 % |
| 130 % | hover | **79 %** | 881 device px | **103 %** |
| 100 % | fullscreen | 126 % | 1078 device px | 126 % |
| 130 % | fullscreen | **97 %** | 1078 device px | **126 %** |

The arithmetic is exact in every row — `(830 − 2·insetY())/854 = 0.97`, and so on. The script is
not miscalculating; it is counting in a unit that shrank. Note rows 1 and 2: the preview is the
same physical size both times, because it is fitted to a screen that did not change. Only the
label moved.

## The formula

```
devicePixelRatio = displayScale × browserZoom
```

`devicePixelRatio` is readable; the two factors are not separable — both are drawn from discrete
sets that overlap (DPR 1.5 is 1×150 % zoom or 1.5×100 % zoom, indistinguishably), so no
auto-detection is possible. **Ask for `displayScale` and divide it out**:

```js
function zoomUnit() {                       // CSS px per "true" px at this browser zoom
    const s = cfg.displayScale > 0 ? cfg.displayScale : 1;
    return (window.devicePixelRatio || 1) / s;
}
function toShown(scale) { return scale * zoomUnit(); }   // scale  -> what the user reads
function fromShown(pct) { return pct / zoomUnit(); }     // and back
```

The readout becomes `scale × browserZoom`. What 100 % then means: **the picture occupies as many
CSS-pixels-at-100 %-browser-zoom as it has real pixels** — one media pixel per screen pixel on an
unscaled monitor, and the same *apparent size* on a scaled one, only sharper. It no longer moves
when browser zoom does, which is the whole point.

Why not the simpler `scale × devicePixelRatio` (no setting): it is truthful but folds display
scaling in, so a 2× laptop opens every preview reading ~200 % and typing 100 renders at half size.
Rejected for that reason.

## The setting

`displayScale`, a number, **default 1**, in the panel's *The preview window* section beside
`maxZoom`:

> **Display scaling** — Your operating system's display scaling, as a multiplier. Windows 100 % = 1,
> 125 % = 1.25, 150 % = 1.5; a Retina Mac is 2. Leave at 1 if you do not scale your display. This
> only affects the zoom percentages shown; it changes nothing about how large the preview is.

Sensible bounds for `num()`: `1, 4, 0.25` — but a live hint showing the current `devicePixelRatio`
is worth more than the range, because it is the number the user needs in order to answer.

**Two monitors at different scalings will disagree**, since `devicePixelRatio` follows whichever
screen the window is on but the setting is one number. Accepted by the user when the setting was
agreed: one screen being right and chosen beats both being wrong.

## Every site that must change

By name, not line — the file is ~4,200 lines and moves. All of these are identity when
`zoomUnit() === 1`.

| Site | Change |
|---|---|
| `DEFAULTS` | add `displayScale: 1` |
| `fmtZoom(scale)` | `const pct = toShown(scale) * 100` |
| `parseZoom(text)` | return `fromShown(n / 100)` |
| `syncZoom()` | `zinEl.value` from `toShown(view.scale)` |
| `zoomStops()` | ladder in shown terms: `fitStops(toShown(lo), toShown(hi), budget).map(fromShown)` — the stops must be round in what is *read*, not in `scale` |
| `zoomStops()` cache | **`stopsKey` must include `zoomUnit()`** — see the trap below |
| `zoomLo()` | `ZOOM_LO_CAP` is a shown 25 %, so `fromShown(ZOOM_LO_CAP)` |
| `zoomHi()` | `fromShown(Math.min(cfg.maxZoom, MAX_SCALE_ABS))` |
| `fitScaleFor()` | `Math.min(fromShown(cfg.zoomFactor), …)` |
| the other `cfg.zoomFactor` site | the opening fit in the show path — same treatment |
| the other `cfg.maxZoom` site | `Math.max(lo, fromShown(Math.min(cfg.maxZoom, MAX_SCALE_ABS)))` |
| settings panel | the `num()` row above |

`maxZoom` and `zoomFactor` move into shown terms deliberately: they are percentages the user
types and then reads back, so leaving them in `scale` makes the panel disagree with the bar.
`MAX_SCALE_ABS` (64) stays the cap on the *shown* ceiling, which keeps `BAR_ZOOM_W`'s reserve for
`"6,400%"` valid.

## Traps

- **`devicePixelRatio` changes when browser zoom changes**, so `zoomUnit()` is not a constant.
  `zoomStops()` caches on `lo + '/' + hi`, both of which are unchanged by a browser-zoom change —
  the ladder would go stale and the slider would land on non-round readings. Put `zoomUnit()` in
  the key.
- **Every conversion is the identity at `devicePixelRatio` 1**, which is the machine this was
  reported from and the machine most tests run on. `node test-resolver.js` cannot catch a mistake
  here and neither can the Browser pane at its default. **Verify at a non-1 ratio** — set the pane's
  zoom, or temporarily stub `devicePixelRatio`, and re-measure the four rows in the table above.
- **Unverified: whether Safari's page zoom moves `devicePixelRatio` at all.** Chrome, Edge and
  Firefox do. If it does not, the correction is a no-op there and the old behaviour stands — which
  is safe, but do not claim the fix is universal without checking.
- `fmtZoom` is also used for the `0`/fit readout and the wheel; there is no second formatter to
  keep in step, which is why the conversion belongs in it rather than at its call sites.

---

## Verification (v0.72.0)

`devicePixelRatio` was stubbed and the CSS viewport divided by the same factor, which is what a
browser-zoom change actually does. 1600×1200 original, `displayScale` 1:

| | CSS viewport | DPR | image CSS px | image device px | reads |
|---|---|---|---|---|---|
| 100 % browser zoom | 1100 | 1 | 1007 | 1007 | **63 %** |
| 130 % browser zoom | 846 | 1.3 | 760 | 988 | **62 %** |

The picture is the same physical size in both rows and the label now agrees. Before the fix the
second row read 48 % (`760/1600`). The 63 → 62 and 1007 → 988 drift is integer rounding of the
viewport (1100/1.3 = 846.15) and the frame, not the conversion.

**`displayScale` divides correctly:** DPR 1.3 with `displayScale` 1.3 — a 130 % monitor at 100 %
browser zoom — gives `zoomUnit()` 1 and reads 48 %, the raw CSS ratio, which is what the script
showed before the feature existed. That is the intended no-op.

**The ladder stays round in shown terms.** At `zoomUnit()` 1.3 the slider stops read
25, 65, 115, 165, 275, 550, 1,100, 2,200, 3,200 % — clean readings over ugly `scale` values, which
is the whole reason `zoomStops()` builds in shown terms and maps back. Top stop is `maxZoom` 32 as
3,200 %, so that setting is in shown terms too, as designed.

**Typing round-trips.** At `zoomUnit()` 1.3, typing 100 / 250 / 50 gives `scale` 0.7694 / 1.9231 /
0.3844 against an expected 0.7692 / 1.9231 / 0.3846, and each reads back as the number typed.

**Still unverified:** Safari. The trap about its page zoom possibly not moving `devicePixelRatio`
stands — nothing here tested it.
