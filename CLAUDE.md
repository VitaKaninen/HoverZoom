# Hover Zoom — project notes

A single-purpose replacement for the Hover Zoom+ browser extension. **Images only** — no video,
audio, galleries, downloads, or action keys, by design. Inherits the shared rules in
`../CLAUDE.md` (version bumps, commit+push, no `innerHTML`, `#89b4fa` checkboxes).

## Why this exists

Hover Zoom+ (extesy/hoverzoom) zooms some images on a page and silently ignores others. That is
not a settings problem. Its generic fallback, `prepareDownscaledImages()` in `js/hoverzoom.js`,
gates every bare `<img>` behind five hardcoded rules, none of them user-configurable:

1. `src.toLowerCase().lastIndexOf('.jpg') != src.length - 4` — **only `.jpg`, and only when the
   extension is the final 4 characters.** Rejects `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`, and
   any URL with a query string (`photo.jpg?w=400`).
2. not `document.body.firstChild`
3. must carry an explicit width/height/max-width/max-height
4. `if (widthAttr > 300 || heightAttr > 300) return;` — thumbnails displayed over 300px are dropped
5. natural size must be `> displayed * 1.8`

Plus two defects in the same block:

- **Global single-slot lock.** `if (document.body.querySelector('#hzDownscaled') !== null) return;`
  — only one image can be measured at a time, and the handler is `.one('mouseover')`, so an image
  hovered while another probe is in flight is skipped permanently. Added by the maintainer in
  commit `b47d17a` (2021-07-29) as a performance fix.
- **No `error` handler on the probe element.** If a probe's src fails to load, `#hzDownscaled` is
  never removed and the guard above blocks *every* remaining image on the page for good.

Reported upstream and still open: [#395](https://github.com/extesy/hoverzoom/issues/395)
(query strings, 2018, zero comments), [#888](https://github.com/extesy/hoverzoom/issues/888)
(`.jpg` only, 2022), [#779](https://github.com/extesy/hoverzoom/issues/779) (generic zoom, 2021).
The repo is active but effort goes to per-site plugins — 399 of them in `plugins/`; the generic
path has been touched twice ever, both times in 2021.

## Design invariants — do not regress these

- **No DOM scanning, ever.** Two delegated listeners on `document`; everything resolves at hover
  time. This is the whole architectural difference from HZ+ and it removes an entire bug class
  (lazy-loaded src, SPA navigation, images added after load, scan races). Do not add a
  MutationObserver or a pre-pass "for performance".
- **No format allowlist.** Extension never decides eligibility. The only gate is
  "is the candidate actually bigger than what's displayed", measured by loading it.
- **No hardcoded size caps.** `minDisplayed` / `maxDisplayed` / `minRatio` are settings; the
  defaults are 48 / 0 (off) / 1.2.
- **Per-element probe state.** No shared lock, no `.one()`. `probeCache` is keyed by URL and
  every probe has both `onload` and `onerror`.
- **Build UI with `createElement` + `textContent`.** Trusted Types CSP sites (YouTube, Google)
  throw on `innerHTML` and abort the function mid-build with no visible error.
- **`view` + `reflow()` + `layout()` own all viewer geometry.** `view` is the only state,
  `reflow()` derives frame size and clamps the pan offsets, `layout()` is the only thing that
  writes to the DOM. Nothing else may set `box`/`img` styles or the two representations drift.

## Pinned mode

Click the preview → it pins. The backdrop (`.dim.catch`) starts swallowing clicks, an X appears
(`.box.pinned .x`), and wheel / `+` `−` / arrows / drag become a zoom-and-pan surface. It closes
on the X, a click on the backdrop, or Escape. **Not optional** — there is no other thing a click
on a floating preview could mean, so it has no setting; the panel carries a `note()` row that
explains the controls without offering a switch.

- **The preview opens centred ON the pointer** (`position: 'cursor'`). It used to open beside it
  with a gap, which meant reaching it crossed page content — fatal for a small thumbnail or a
  pointer already near the image's edge, because that crossing dismissed the very thing being
  reached for. `HIDE_GRACE` now only covers frames clamped away from the cursor at a window edge.
- **The status bar is the move handle.** Dragging it moves the frame (`drag.mode === 'move'`);
  dragging the image pans within the frame (`'pan'`). Both go through the same `drag` object in
  `onMove`. Hiding the status bar therefore also removes the only way to move a pinned frame.

- **The frame grows before the image spills.** Zooming enlarges the frame until it reaches
  `maxWidthPct`/`maxHeightPct` of the viewport; past that the frame is fixed and the image
  overflows it, which is when `pannable()` (and the `grab` cursor) turn on. Zoom-out floors at
  `fitScale`, the scale the preview opened at; `0` returns there.
- **Pinned-mode key/wheel listeners live on `CAP_TARGET` (= `window`), in capture** — per
  `../CLAUDE.md`, that beats every document-level listener on the page and in sibling
  userscripts, so arrows and `+`/`−` are ours while pinned and nobody else's. Both are added in
  `pin()` and removed in `unpin()` against that one constant; `wheel` uses the shared
  `WHEEL_OPTS` object for add *and* remove, or the removal silently no-ops.
- **Hover has a `HIDE_GRACE` (220 ms).** The preview sits `cursorGap` px from the image, so
  reaching it means crossing page content. `onOut` schedules the hide instead of doing it, and
  `onOver` cancels that timer when the pointer lands on the host. Without it the preview is
  unreachable and click-to-pin cannot work at all.
- **The preview is hit-testable while unpinned** (`.box.on.hot`, gated on `cfg.clickToPin`).
  That is the cost of click-to-pin: the preview covers whatever is under it. Turning the setting
  off restores `pointer-events:none`.

## Settings are per-tab snapshots — always re-read before rendering the panel

`cfg` is read once at load, so every tab holds its own copy. A tab open for a while is editing a
stale snapshot: the panel renders old values *and*, because Save writes the whole object, it
reverts anything another tab changed since. Symptom as reported: "I change one thing and it
saves other things I had previously disabled."

Two defences, both needed:

- `reloadSettings()` at the top of `openPanel()` — the one that always works, including where
  the manager has no change API.
- `GM_addValueChangeListener` on `KEY`, acting only when `remote` is true. This is the better
  fix because it also keeps the *running* script current, not just the panel, and re-renders an
  already-open panel. It needs the `@grant`, and it must be feature-detected — not every manager
  implements it.

Verified against the `storage`-event stub in `test-page.html`: a silent write is picked up on
open, a signalled write is picked up immediately, and saving afterwards preserves the other
tab's values instead of clobbering them.

## Gotcha: a capture listener on the box eats its own children's events

`onBoxDown`/`onBoxClick` are capture listeners on `.box`, and the X button is a *child* of the
box — capture descends from the ancestor, so those two run first and their `stopPropagation()`
kept `closeEl`'s own handlers from ever firing. The X looked correct, hovered correctly, and did
nothing. Both handlers now `return` early on `closeEl.contains(e.target)`. Any new control
placed inside the box needs the same exemption. Found 2026-09-03 in browser testing; nothing
static catches it — `node --check` passes and the markup is fine.

## Testing

```bash
node --check Hover-Zoom.user.js     # syntax
node test-resolver.js               # 50 assertions on the pure URL logic
python make-test-images.py          # regenerate fixtures into test-images/
```

Browser test: `python test-server.py`, then open `http://localhost:8899/test-page.html`. 16 cases,
9 of which HZ+ rejects outright. (`.claude/launch.json` wraps the same command as
`hover-zoom-test`, but `.claude/` is gitignored — a fresh clone has only the direct command.)

- **`test-server.py`, not `python -m http.server`.** It is the same static server plus
  `?slow=<seconds>`, which stalls that one response. Nothing else can reproduce the symptom that
  motivated the resolve spinner: against localhost every probe finishes in single-digit ms, so
  a slow resolve — the state the user actually sees as "hovering does nothing" — is otherwise
  unreachable. Case 15 uses it. It is threaded, or one `?slow=` would block the whole page.
- **The page defines GM stand-ins** (`GM_getValue`/`GM_setValue`/`GM_addValueChangeListener`/
  `GM_registerMenuCommand`) over `localStorage` before loading the script, so the settings panel
  opens from a button in the corner instead of the manager menu. `GM_addValueChangeListener` is
  wired to the `storage` event, which is genuinely cross-tab: open the page twice and the
  settings-staleness path below is reproducible for real.
- Case 14 is the only fixture whose original (800×600) is smaller than the viewport cap, so it
  is the only one that exercises the "frame grows before the image spills" branch of `reflow()`.
  Every other case has a 1600×1200 original, which opens already clamped to the cap.
- Case 16 is the `?imgurl=` shape — a 32px icon wrapped in an `/imgres?imgurl=…` viewer link.
- **A `computer{action:"hover"}` to a coordinate the pointer is already at fires no `mouseover`,**
  so a second test against the same element silently does nothing and reads as a script bug. Move
  the pointer somewhere else first, and re-derive coordinates from a fresh screenshot after any
  pane resize — the emulated viewport is letterboxed into the pane, so a stale scale factor puts
  every click off-target.

Shadow roots are `mode: 'open'` specifically so the test harness can read the viewer. Encapsulation
is identical to `closed`; only script access differs, and the page can find `#hover-zoom-host`
either way.

**A `file://` load will not work** — the preview pane renders local files as a static `data:`
snapshot and the external script never executes. Use the HTTP server.

## Gotchas found while building

- **URL-upgrade rules over-match silently, and that is worse than under-matching.** The first cut
  of the Cloudinary/Imgix transform-segment rule was
  `/\/(?:[a-z]{1,3}_[^/,]+)(?:,[a-z]{1,3}_[^/,]+)*\//g`, which ate ordinary path segments like
  `/en_US/`, `/v_2/` and `/a_b/` on any host. A wrong candidate that happens to load shows the
  *wrong image*; a missing candidate just shows nothing. The rule now requires every comma-part to
  be a `key_value` pair from a known transform-key set **and** the segment to carry a numeric `w_`
  or `h_`. Any new path-rewriting rule needs the same negative tests — see `none()` in
  `test-resolver.js`.
- A first run of a new test suite that passes 33/33 deserves suspicion, not celebration. The
  over-match above was invisible until real URLs were printed and eyeballed.
- **`linkParamCandidates()` needs the same discipline as `UPGRADES`.** It pulls any query-param
  value that is an absolute http(s) URL passing `looksLikeImage()` out of an ancestor link, which
  is how `/imgres?imgurl=…` works without naming Google. Two guards keep it from doing harm:
  values must be absolute (a bare path is ambiguous), and `THUMB_PARAM` names are skipped so a
  `?thumb=` never displaces the original. Everything it returns still faces the ratio gate, so
  the worst case is a wasted probe rather than the wrong image — but only because of those
  guards. Negative tests live beside the positive ones in `test-resolver.js`.

## Resolve progress

Probes are sequential and each awaits a real image load, so a slow or many-candidate image can
sit silent for seconds. Worse, leaving mid-probe does not abort the in-flight loads — they finish
and populate `probeCache`, which is why the same image "works if you come back to it later".
That is a cache warming up, not a fixed bug, and it is why the silence needed a UI rather than
a code fix.

`.spin` answers it: an SVG ring whose arc grows clockwise from twelve, `stroke-dashoffset` driven.
The centre is **transparent** — v0.4.0 filled it with a `#1e1e2e` disc and it read as a dark blob.

`SPINNER_DELAY` (150 ms) keeps it from flashing on cached hits, but `buildViewer()` runs
*immediately* in `showSpinner()` — `resolve()` emits its first progress tick synchronously and it
would be dropped if the ring did not exist yet. `hideSpinner()` is in a `finally`, so the ring
stops on every outcome including a throw; a ring still turning after the search stopped is a lie.

**Two things about the progress that are easy to get wrong:**

- **Steps alone are not enough.** The denominator is real — `candidates.length`, the worst case
  if nothing qualifies — but there are often only one or two candidates, so a purely step-driven
  arc sits at 0% for the entire wait and looks broken. That was the v0.4.0 bug ("always full or
  empty"). Between ticks the arc now eases toward the next boundary on an exponential curve
  (`CREEP_TAU`), claiming at most `CREEP_MAX` of the gap and never arriving. The steps are
  measured; the motion between them is an estimate that says only "still going".
- **`setInterval`, never `requestAnimationFrame`.** rAF is starved whenever the compositor
  decides the page is not worth animating. **The Claude Code Browser pane delivers zero animation
  frames while reporting `visibilityState: "visible"` and `document.hasFocus(): true`** — a
  60-frame rAF probe returned 0. Real browsers do the same for occluded windows and some
  power-saving modes. A frozen ring is indistinguishable from the stuck one it replaces, so this
  animation must not depend on frames being offered. Anything else here that must animate has the
  same constraint, and no screenshot will catch it — verify by reading the attribute over time.

## Known limits

- HZ+'s 399 plugins encode genuine per-site knowledge (Pixiv's referer requirement, Instagram's
  URL signing, Twitter's `:orig`). The generic resolver wins on the long tail and loses on a few
  hostile sites. Add narrowly-scoped rules to `UPGRADES` only with host checks and negative tests.
- `preferLargest` (off by default) probes every candidate instead of stopping at the first that
  clears the ratio gate. It finds bigger originals — e.g. rewriting a `srcset`'s widest entry —
  at the cost of up to `MAX_PROBES` (8) requests per hover.

### Google Images specifically

Reported 2026-09-03: HZ+ returns full-size originals there, this script returns 500–700px.
Google's live DOM could not be inspected — `google.com/search?udm=2` served `/sorry/index`
bot detection, and a CAPTCHA is not something to work around. So this is read off HZ+'s own
plugin source (`extesy/hoverzoom` `plugins/google.js`, v5.0), which uses four mechanisms:

| HZ+ mechanism | Us |
|---|---|
| `=s0` / `/s0/` size-token rewrite on googleusercontent, ggpht | **have it**, both forms since v0.5.0 |
| `a[href*="imgurl="]` — original URL in the link's query | **have it** since v0.5.0, as the generic `linkParamCandidates()` |
| parse `<script>` JSON for `tbnid` → full URL | **no** — needs script scanning, against the no-DOM-scanning invariant |
| hook XHR responses, cache them in sessionStorage | **no** — site-specific and invasive |

The first two are genuinely generic and were worth taking; the last two are what a per-site
plugin is *for*, and taking them would make this a Google plugin. If Google's results still come
back small, the remaining gap is the `tbnid` table, and that is a deliberate non-goal. Verify
against the live page before assuming which mechanism is carrying the result today.
