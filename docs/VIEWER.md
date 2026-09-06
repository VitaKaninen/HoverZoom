# The preview window

Geometry, states, handles, dragging, zoom, the status bar, the context menu. The citable IDs are
in [`../INTERACTION.md`](../INTERACTION.md); headings here carry the `E` id that owns them.

## Two states: hover → placed

- **Hover** — opens beside the pointer. Held open by ONE thing: the pointer being over the source
  image. Leaving it cancels **at once**, no grace period. A wheel belongs to the PAGE: it scrolls,
  and the scroll takes the preview down.
- **Placed** — one press (click, drag, or corner grab — all the same gesture, decided on the
  **press**). Held open by NOTHING; ends only on Escape or a click outside. Position is free, the
  wheel is the window's, the page underneath stays readable and scrollable.

**Exactly one thing holds the preview open at a time, and leaving it ends the preview.** Earlier
versions let both the image and the preview hold it, and every reported hover bug came from that
blur. A third rung (`detached` — dragged aside but still dying when the pointer left) was removed
in v0.28.0 for the same reason: a window you positioned deliberately must not vanish on its own.

Because a drag and a click reach the same state, decided on the press, there is nothing to tell a
3 px wobble from a real drag — **do not reintroduce `DRAG_SLOP`/`justDragged`.**

**Right-click does not dismiss a placed window, and that is deliberate.** The right button belongs
to the browser there, because its menu is the only thing that can Save or Copy the picture. Use
Escape or a click outside.

### Placed is NOT modal · `E2` · `E13`

`.dim` is transparent and exists for one job: catching the dismissing click before the page acts
on it.

- **The page still scrolls.** Only a wheel *over the frame* is claimed; one over the backdrop finds
  no scrollable ancestor until the document.
- **Dimming would fight the point** — you place a window to compare it with what is behind it.
- The dismissing click is swallowed at **window capture**, not by the backdrop's handler: the
  backdrop is inside the shadow host, so capture reaches `document`/`body` first and a page
  listening there would see a phantom click. Use `e.composedPath()[0]`, **not** `e.target` —
  outside the shadow tree the target is retargeted to the host.
- A click outside usually lands on the thumbnail, so it suppresses (`E2`).

`bottomReserve` is retired: `usableHeight()` is now just the viewport, floored at 64 px because the
Browser pane reports `clientHeight` 0 while hidden. It survives as the single answer to "where is
the bottom", so the size cap, the opening position and `clampPosition()` cannot disagree.

### Suppression is armed by where the POINTER is, not by the dismiss · `E44`

`dismiss()` arms `suppressed` only when the pointer is over the source picture at that moment
(`stillUnderPointer`), not unconditionally from `active`.

**`onOut` is the only thing that lifts it.** Armed with the pointer somewhere else, no `mouseout`
for that picture is ever coming: the flag survives the next *entry*, `onOver` refuses on
`el === suppressed`, and only the leave after that clears it — so the picture takes **two** visits
to come back. Hover previews never hit this (the pointer leaving the picture cancels them, so
`active` is null by then); a **placed** window does, because it outlives hover entirely and can be
dismissed from anywhere on screen. Fixed v0.77.0.

The two cases the rule has to keep apart, both real:

- **Dismissed by clicking the thumbnail itself** (`E2`, the common case): the pointer *is* on it,
  so it suppresses, and hovering it again is refused until you leave. Without that the click that
  closed the window re-opens it on the next mouse movement.
- **Dismissed with the pointer elsewhere** — the ⊘ and ▶ buttons, a backdrop click away from the
  source, a right-click on a window that has been dragged off its thumbnail: nothing to suppress,
  because you are not standing on the thing that would re-open.

**The leave that lifts it may come from a child.** `mouseout` fires on the deepest element the
pointer was over, so a background-image element with a caption inside it reports the leave on the
caption. `onOut` tests `suppressed.contains(e.target)`, as the `active` branch below it always
did; testing `e.target === suppressed` left the picture refused until a leave from its own bare
area. Found v0.78.0.

### The bottom gap is bigger than the other three · `STATUS_TIP_H`

Every side keeps `EDGE_GAP` (4 px) clear; the bottom keeps `bottomGap()` — `EDGE_GAP +
STATUS_TIP_H`, 24 px. The browser paints the link target it is about to follow over the bottom-left
of the viewport, and a hover preview's status bar is the first thing that covers. Flat pixels, not
a fraction: the strip the browser paints is a fixed height.

**This is not `bottomReserve` coming back.** What was retired was a *setting* — a knob in the same
sweep as `maxWidthPct`, `maxHeightPct` and `dimOpacity` — and the invariant the retirement bought
was that only one expression decides where the bottom is. `bottomGap()` keeps that: `viewportBox()`
(the opening size) and `clampPosition()`'s hover branch both call it, so they cannot disagree.

**It costs the placed growth ceiling 20 px × `maxSizeMultiple`**, because `growBox()` multiplies
`viewportBox()`. Accepted rather than special-cased: at the 1.2 default the ceiling is still far
past the viewport, and a second height that means "the same but without the reserve" is exactly the
drift the single-answer rule exists to prevent.

The gap only binds a **hover** preview. `clampPosition()`'s placed branch is `KEEP_ON_SCREEN` and
lets a window sit wherever it was put, tip or no tip. The loading ring is nudged up by the same
amount, since it is a hover-time thing too.

## The wheel grows a PLACED window, about the POINTER · `E22`

`view.fixedW` is the whole of the state:

| `view.fixedW` | set by | `frameW` |
|---|---|---|
| `null` | nothing yet | `max(minFrameW(), min(imgW, growBox().w))` — follows the picture to the ceiling |
| a number | `resizeBy()`, i.e. a **hand resize** | `fixedW` — pinned, whatever the picture does inside |

**Nothing else pins the size. Not placing, not moving.** v0.29.0–v0.33.0 froze it on the move; that
became unreachable once the wheel went back to the page while hovering, because zooming then
requires placing, placing is a press, and a press almost always wanders the 3 px that counted as a
move. Every window was frozen at its opening size and `maxSizeMultiple` could not be reached at
all. *(The general shape is worth remembering: a rule correct in isolation was made vacuous by a
change elsewhere, and the symptom was not an error but a capability that silently stopped being
reachable.)*

**Zoom is anchored on the POINTER.** `zoomAt()` holds the pointer at a constant fraction of the
frame, so a growing window expands away from the cursor and a shrinking one collapses towards it.
Holding the frame's centre instead walks the edges past the pointer on zoom-out, at which point
`onPinWheel`'s `pointInPreview()` stops claiming the wheel and zooming out means chasing the window
with the mouse. `zoomCentre()` passes the frame's centre, so `+`/`−`/`0` behave as always — there is
no pointer in a keypress.

**A wheel over a HOVER preview is the page's.** v0.30.0 made it place-and-grow; that stole the
scroll wheel from every hover, since `nudgeIntoReach()` puts the cursor inside the frame. Scrolling
is constant and previewing is incidental to it, so the common gesture wins. The bought gesture
survives one click later.

**`enableWheelZoom()` is called from `place()`, `disableWheelZoom()` from `cancel()`** — not bound
for the life of the script. It is a non-passive capture listener on `window`; while attached, every
wheel event on the page is cancellable for nothing.

`fitScaleFor()` measures against `fixedW` when there is one, so `0` on a hand-sized window fits the
picture to the size that was chosen rather than to the browser window. It is what `0` returns to;
the zoom **floor** is `minScaleFor()` (see below).

**`upgradeViewer()` reads `userSized` against the OLD fit, before recomputing it** — and the test is
`Math.abs(scale - fitScale) > 1e-6`, not `>`, because a view deliberately zoomed *out* is as
hand-made as one zoomed in. Getting either wrong compiles and silently undoes sizing done by hand.

## Free positioning, and the frame as the title bar · `E21`

`clampPosition()` guarantees only that `KEEP_ON_SCREEN` (72 px) stays in view per axis. Deleting it
entirely strands a window dragged off screen, or one at `left: 1500` when the browser is narrowed
to 1200.

`hitRegion()` is three rings: **resize strip, move band, then the middle** (which pans if the
picture is spilling and moves the frame if not).

- **The resize strip STRADDLES the edge** — `RESIZE_OUT` (6 px) outside plus `RESIZE_IN` (6 px) in,
  so the cursor changes as the pointer arrives rather than after it crosses. `hitRegion()` tests the
  window grown by `RESIZE_OUT`, letting `dl`/`dr`/`dt`/`db` go negative so every comparison reads
  the same on both sides. The outer half is carried by **`gripEl`**, an invisible collar between
  backdrop and frame; it gets `hot` in `layout()` and loses it in `hideViewer()`, for the same
  reason the box does.
- **`MOVE_BAND` (13 px) is floored at the drawn ring's thickness** —
  `max(rb + MOVE_BAND, chromeThickness() + borderWidth)`. A painted handle with a dead strip along
  its inner edge is the worst of both. At defaults that is 25 px; the 13 only matters when
  `frameMargin` is small.
- **The move ring exists only while the frame margin is visible** (`chromeVisible()`). Faded, a
  press there falls through to the middle's rule. This is what keeps it from being an invisible
  band — the objection that killed v0.28.0's undrawn move band.

**Edges resize, not just corners**, because the growth ceiling is above 1× so a frame can have no
corner on screen at all. An edge is a whole strip and there is nearly always one visible.

**Geometry, not child elements.** Four corner divs plus four edge divs lands straight in the
`isBoxControl()` capture trap — `onBoxDown` is a capture listener on an ancestor and eats a child's
events first, symptom silence. Deriving regions from `view` also gives one code path for both
states.

A **hover** preview is deliberately not free: it is positioned by the script, so it stays fully on
screen while it fits, and is only stopped from sliding a gap in at an edge once grown past the
window.

### The zoom cluster, and the corner anchor that makes it usable · `E34`

The bar carries a slider and the zoom level, in that order, immediately left of the ⊘/AA/▶
buttons. Clicking the level swaps it for a text field in the same 52 px slot.

**The percentage is CSS pixels per media pixel, not screen pixels.** `view.scale` is a plain ratio
of layout units, so at 100% one image pixel occupies one CSS pixel — which equals one screen pixel
only at 100% browser zoom on a 1× display. Audited 2026-09-06 against four hand-measured readings
and the arithmetic is exact every time; a worked example, 480×854 clip on a 1080-tall screen:

| browser zoom | viewport CSS px | reading | media on screen |
|---|---|---|---|
| 100 % | 1080 | fullscreen 126 % | 1078 device px |
| 130 % | 830 | fullscreen 97 % | 1078 device px |

Both readings are right and they disagree, because browser zoom shrinks the CSS pixel while the
screen stays the same size: `(830 − 2·insetY)/854 = 0.97`, `(1080 − 2·insetY)/854 = 1.26`. The
picture is the same physical size in both rows — only the label moves. **A ruler held to the screen
therefore matches the reading only at 100 % browser zoom.**

**The fix is designed and agreed but NOT built** — a `displayScale` setting divided back out of
`devicePixelRatio`. [`ZOOM-UNITS.md`](ZOOM-UNITS.md) holds the formula, the setting, every code
site it touches and its traps; do not re-derive it here.

**The problem the anchor solves:** the frame follows the picture, so a control living on the frame
runs away from the pointer driving it. `zoomAnchored()` nails the frame's **bottom-right** corner —
`view.left`/`view.top` are recomputed from `right`/`bottom` after `reflow()` — while the picture
still zooms about the frame's centre. Those are two separate anchors and `zoomAt()` couples them,
which is why this is its own function rather than a call with corner coordinates.

**Bottom-right and not bottom-left**, because `.cap` is `name{flex:1}` then `meta`, with the
buttons `position:absolute; right:N`. Everything except the filename is already pinned to the right
edge, so a bottom-right anchor freezes the whole cluster; a bottom-left one would freeze only the
filename and leave the slider on the moving end.

The wheel keeps `zoomAt()` (anchored on the pointer, `E22`) and `+`/`−`/`0` keep `zoomCentre()` —
there is no on-screen control to hold still for either.

**The slider steps through a ladder of round percentages — one slider step is one stop.** A linear
track is useless (25 %–3200 % puts 100 % one pixel from the left end), and the log/pow mapping that
replaced it — `zoomPos()`/`zoomScaleAt()`, v0.47.0–v0.51.0 — was right about the *spacing* and
wrong about the *values*: it lands wherever the arithmetic falls, so zooming back in from the left
end read 84 %, 90 %, 95 %, 101 % and 100 % was not on the track at all.

**A ladder longer than the track is the same bug wearing round numbers, and v0.52.0 shipped it.**
That version built 143 stops for a 100 px slider and argued the density was a feature. It is not:
a range input maps pointer x to `round(fraction × max)`, so with more stops than pixels the browser
*cannot* select some of them. 100 % was one of the unreachable ones, and the drag read 92, 94, 98,
105 — round values, inconsistent gaps, no 100 %. **The stop count is capped by the track's pixels;
that cap is the whole design, not a detail of it.**

`ZOOM_BANDS` is the *wanted* step per percent band — 5 up to 200 %, 25 to 500 %, 50 to 1000 %, 100
to 2000 %, 200 to 5000 %, 500 above; 2 below 30 % and 1 below 10 % for a picture whose fit is tiny.
`walkStops()` turns bands into `[lo, …round values…, hi]` plus, per band, its stop count and the log
distance it covered. `fitStops()` then walks the budget down: while the ladder is longer than
`BAR_SLIDER_W - ZOOM_THUMB`, it coarsens the band with the most stops **per unit of log distance**
— per unit of track — one notch along `ZOOM_NICE`. `zoomStops()` caches the result per `lo/hi`
pair, and `zoomIndex()` finds the nearest stop by ratio so a wheeled or typed level parks sensibly.
`syncZoom()` writes `max` from the stop count **before** the value, or the value clamps against the
previous ladder's end.

Four properties this leans on, none of them accidental:

- **Every step divides its own band's ends — and so does its neighbour in `ZOOM_NICE`**, because
  `fitStops()` may coarsen any band by a notch. That is what keeps a boundary (100 % above all) a
  stop reached from both sides. It is also why the bands are 5/25/50/100 and not the 3/15 the
  request opened with: 100 is not a multiple of 3, so a 3 % ladder can only hit it by anchoring to
  25 %, which breaks the moment `lo` is a fit scale instead.
- **Density is thinned where the track is over-resolved, not where the ladder is longest.** The
  naive greedy — coarsen the biggest band — spends the cut on 30–200 %, the range actually being
  used, while leaving the 2000–5000 % band at three stops per pixel. Log distance per stop is the
  honest measure of "too fine", because equal log distance is equal track.
- **The ladder stays logarithmic to within a few percent of the track.** At `maxZoom` 32× it is 76
  stops: 5 % steps to 200 %, then 25s, 50s, 100s, 200s. 25 %→100 % takes 18 of them (24 % of the
  track) against the log mapping's 28.6 %, the low end being slightly favoured by the fixed bands.
- **The budget is deliberately pessimistic.** `ZOOM_THUMB` reserves 20 px of the 100 px slider for
  a thumb measured at ~16.4 px, because the thumb is the UA's and Firefox's is not Chrome's.

The ladder also fixes the arrow keys, which under the old track moved 1/1000 of the range — a
change too small to see. One press is now one round stop.

`lo` and `hi` are exact first and last entries, so the ends stay reachable: dragging fully left
gives the fit scale itself, not a rounded near-fit.

**A 64× ceiling costs the low end its 5 % steps** (`fitStops()` thins 30–200 % to 10s), and that is
the honest trade: 100 px of track cannot resolve both a 256× span and 5 % granularity. Raising
`BAR_SLIDER_W` buys the budget back — the ladder re-fits itself, nothing else needs touching.

**Its low end is `min(fitScale, max(0.25, noBarsScale()))`, not the zoom floor.** `minScaleFor()` is
~0.4 % for a large picture, which would spend most of the track on sizes nobody wants; the fit is
the natural zoomed-all-the-way-out point. Below-fit scales are still reachable by wheel and by
typing, and the thumb simply clamps to the left end there. The high end is
`min(cfg.maxZoom, MAX_SCALE_ABS)`.

**`noBarsScale()` is the letterbox floor, and it is per-picture.** `reflow()` will not shrink the
frame below `minFrameW()` — the width its own controls need, 260 px — so under
`minFrameW() / natW` the frame stops following the picture and centres it instead, with background
showing either side. Measured at the pre-v0.63.0 236 px: a 1600 px picture was clean to 15 % and
letterboxed at 14.5 % (236/1600 = 14.75 %); a 600 px one letterboxed under 39.3 %. Each button
added to the bar moves both numbers by `BTN_STEP`/`natW`. The same applies to height
against `MIN_FRAME` (48 px), which only bites on a very wide, very short picture.

**This is why the fix is not "raise the floor to 30 %".** 30 % is the letterbox point of an ~790 px
picture and nothing more: it still shows bars on anything narrower, and it needlessly forbids
25–30 % on everything wider than 944 px, where there were never any bars. Reported 2026-09-05 as
black bars at 25 %, with 30 % offered as the fix — right number, one picture wide.

The `min(fitScale, …)` on the outside keeps the fit reachable when the two rules disagree. A narrow,
very tall picture can have `noBarsScale()` above its own fit; there the picture is letterboxed at
every scale it can be seen at, so the floor gives up rather than putting the slider's left end above
the point `0` returns to.

**Nothing restricts what may be typed.** `parseZoom()` strips commas, spaces and `%`; `clampScale()`
does the rest, and the readout then shows what actually stuck, so a clamp is visible rather than
mysterious.

**The field cannot rely on `blur`, and that is why `commitZoomField()` exists.** The panel's inputs
commit on the native `change` event, which fires on blur — nothing else needed. The zoom field has a
`blur` handler that does the same thing, and until v0.55.0 it almost never ran: `onBoxDown` calls
`preventDefault()` on every press that is not a box control, and a prevented mousedown **does not
move focus**. So clicking the picture, the border or the bar left the field focused and the typed
number uncommitted, and Enter was the only way out. Reported 2026-09-05.

`commitZoomField()` is called from the two places that mean "done" without a blur: the top of
`onBoxDown` (any press whose target is outside `zoomWrapEl` — so the readout and the field itself
are exempt, everything else commits) and `onMove` when the pointer is no longer in
`pointInPreview()`. It returns immediately when the field is hidden, so putting it on the move path
costs a hidden-flag test per mousemove.

**The pointer-leaves rule has a consequence worth knowing:** move the mouse off the window *before*
typing and the field has already committed the unchanged value and closed. That is the trade the
behaviour was asked for with, not an oversight.

**The cluster is absolutely positioned, like the buttons — it is NOT a flex item.** This is the
whole of why it stays still, and two versions were spent learning it. A flex item's position is
whatever is left after the filename and metadata have taken their share, so it moves whenever
*they* change width: as the frame narrows the text shrinks, the free space runs out, and the
cluster starts sliding along the bar. With the pointer holding the slider thumb, a slider that
moves under it is a slider being dragged — the value ran to an end on its own. `.zctl` now sits at
`right: btnGutter()`, so its screen position depends on the frame's right edge and nothing else,
and `zoomAnchored()` nails that edge.

The project already knew this failure: *"The ⊘ is absolutely positioned … as a flex item after a
`flex:none` dimensions field it was pushed past the end and clipped."* Same bar, same cause.

v0.48.0's attempt — make `.cap .meta` shrinkable so the text collapses first — is kept, because the
text does have to give way, but it is not what holds the cluster still. **On its own it is not
enough:** it makes the cluster's position depend on text width *smoothly* instead of abruptly,
which is still a dependency.

**The minimum width is computed, not chosen** — `barMinW()` is the bar's padding, the slider, the
readout and `btnGutter()`, every one of them the same constant the stylesheet is built from:
260 px for a picture, 284 px with the ▶ present. Filename and metadata claim nothing, because at
that width they are clipped to nothing. `layoutChrome()` positions the cluster and sets
`padding-right` from `textGutter()`, which is `btnGutter()` plus the cluster, so the reserve and
the thing it reserves for cannot disagree.

**The cluster's width is written, never shrink-to-fit — and that is a Firefox bug fix.** An
absolutely positioned box with no `width` is shrink-to-fit, and Chrome sized it from the slider's
`flex-basis` (100 px) to exactly 158 px, flush at both edges. Firefox sizes it from the range
input's larger *intrinsic* width instead, so the box came out wider than its contents — and with
the default `justify-content: flex-start` the surplus parked **after the last item**, as a ~30 px
gap between the readout and the AA button. Chrome had no surplus, so Chrome looked right.

`layoutChrome()` now writes `zctlEl.style.width = zctlW()`, the same number `textGutter()` reserves,
and `.zctl` carries `justify-content: flex-end` as a second guard: if a browser still oversizes the
box, the surplus goes in front of the slider rather than behind the readout. The slider is
`flex:none; width:100px` for the same reason — with `barMinW()` now accounting for the ▶ it never
needs to compress, so nothing depends on how a browser sizes a form control.

**The Browser pane is Chromium, so this class of fault is invisible to every check made here.**
Reported by the user against Firefox and LibreWolf, v0.50.0.

**`caption()` runs before `layoutChrome()` in `layout()`.** `textGutter()` measures the cluster
through the `hidden` flags that `syncZoom()` writes, so reversing the two leaves the padding one
frame stale every time the cluster appears or disappears.

**It applies only while placed**, via `minFrameW()` — a hover preview has no controls and owes them
no room. `place()` therefore calls `reflow()` before `layout()`, or a small window pinned would keep
its old width until something else happened to reflow it.

**Slider input is throttled by its own measured cost.** A range input emits one `input` per pixel of
travel and each one resizes the picture; smoothed *downscaling* of a 3000–4000 px image is the
expensive direction, and the events outrun the redraws. `slideZoom()` starts its clock when the
previous zoom *finished* and waits `max(16, lastCost)`, so an expensive picture asks for fewer
redraws by itself. Measured on a 4000 × 3000 photo: a 60-event sweep across fit→100 % becomes 36
layouts. **Not `requestAnimationFrame`** — the Browser pane delivers no animation frames, and the
pane is where this gets tested.

The reported jank (100 % CPU, jerky below 100 %, fine above, only with AA on) was **not reproducible
here**: main-thread lag stayed under 2 ms across that band with AA both on and off, which fits
raster happening off the main thread. The throttle bounds how much of it is asked for; it is not a
verified fix for a fault that was never caught in the act.

**`caption()` caches everything but the zoom.** `layout()` calls it on every frame of a drag, and it
was running `new URL()`, `decodeURIComponent()` and `performance.getEntriesByName()` — a linear scan
of the resource-timing buffer — every time. Keyed on URL plus natural size; `deferredCaption()`
calls `resetCaption()` because the byte count is the one part that arrives late. Measured: 60 zoom
steps now scan the timing buffer zero times.

Four things this walks into, each silent:

- **`isBoxControl()` must list `zctlEl`** — `onBoxDown`/`onBoxClick` are capture listeners on the
  box and eat a child's events first.
- **`onPinKey` is capture on `window`, so it sees the field's keys first.** `capOwns()` stands
  aside for the field, and for the arrow/Home/End/PageUp-Down set while the slider has focus. It
  must also *handle* Escape and Enter rather than passing them: the document-level Escape listener
  below it cancels the whole preview.
- **`barWanted()` needs `zoomBusy()`** — a slider drag legitimately leaves the bar vertically, and
  a faded bar is `pointer-events:none`.
- **Every `[hidden]` here needs its own `display:none`** (`.zctl`, `.zoom`, `.zval`, `.zin`,
  `.zslider`), for the reason in the project `CLAUDE.md`.

**A hint on the bar says what a press does.** `capHintEl` — *(click this window to pin it)* — sits
between filename and metadata; `.box.placed .cap .hint{display:none}` drops it once placed. It is
the one thing here that cannot be guessed: a hover preview is pointer-transparent, so nothing about
it invites a click, and every control that would say so appears only *after* the click. It is
`flex:0 1 auto` with an ellipsis, so it gives way before the dimensions do.

### The status bar sits at the frame's bottom, always

`.cap` is `bottom:0` in CSS and **nothing writes an offset over it**. `stickBar()` is gone.

It took three versions, and the reason is structural rather than arithmetic. The float existed to
rescue a real trap: a frame grown past the viewport covers the screen, so no edge, corner or margin
is reachable, the middle pans, and the bar is below the bottom of the screen. But **the trap state
and the deliberately-positioned state are the same geometry** — "a window nobody can reach" and "a
window I pushed off the bottom" differ only in intent — so no rule written in terms of
`view.left`/`view.top` can separate them, and every version became a rescue that overrode the user.
(v0.35.0 tested `view.top < 0`, too coarse for a tall frame dragged down; v0.36.0 tested whether any
strip of margin was in view, which made the bar hop as a window slid left and right.)

**What made it disposable is the free frame**: an un-resized frame follows the picture, so zooming
out is a complete escape from a state zooming in created. Measured — a 2512 × 1392 frame over a
1265 × 705 viewport is back in view at 403 × 302 after eight notches out.

**Do not reintroduce a float keyed on `clampPosition()`'s `KEEP_ON_SCREEN` either.** That guarantees
72 px of the *frame*, which a strip of bare picture satisfies; it says nothing about a handle, and
it is a position test — the family that failed.

Residual, accepted knowingly: a **hand-resized** frame is pinned, so one dragged bigger than the
screen and then moved until all four edges are off it closes only with Escape (`K5`).

**The bar's precedence in `onBoxDown` is narrow:** `capEl.contains(e.target) && !(reg && reg.kind
=== 'resize')`. A resize region wins; the bar claims what is left. **Do not delete the rest as
redundant** — with `frameMargin: 0` there is no move ring at all, and with a small one the ring is
thinner than the bar, so without this the bar's upper rows would pan. Testing the bar *first* made
the two bottom corners answer a grab with a move cursor.

`onMove` mirrors this for the cursor but with **geometry** (`pointerOverBar()`), not `e.target`: a
mousemove on `document` is retargeted to the shadow host and can never name the bar. It is gated on
`chromeVisible()` so a faded bar shows the cursor its press would actually produce.
`.box.placed .cap{cursor:move}` was removed with it, or the bar would claim `move` over its own
resize strip. `resetBar()` clears state, or the next preview opens stale.

### A drag outlives the frame and the browser · `E24`

`onMove` is on `document`, and while a button is held the browser keeps delivering `mousemove` with
coordinates outside the viewport — so a pan follows the pointer off the page for free.

What does **not** arrive is the `mouseup` when the button is released out there. The drag then stays
live and the window follows the pointer back with no button held. **`e.buttons === 0` on the next
move is the only thing that can notice**, and it must end through the same `endDrag()` the ordinary
release uses, or the two paths drift.

### `maxSizeMultiple` · `E7`

Replaces `maxWidthPct`/`maxHeightPct` (92 each), which bought an 8 % margin for reachability that a
freely-movable window does not need.

```
growW = viewportBox().w * m            // the ceiling the wheel and corners may reach
openW = min(growW, viewportBox().w)    // never OPEN bigger than the screen
```

**Without that `min`, a large picture at 2× would open taller than the screen** — and a preview
appears without being asked for.

The default is above 1× for a geometric reason, not a preference for big pictures: a frame exactly
the window's height, shoved up to see under it, leaves a strip of empty page along the bottom, and
lining it back up is fiddly. A frame larger than the window in both axes reaches the screen edges
from any position.

`RETIRED` in `readSettings()` **deletes** old keys rather than ignoring them — `cfg` is DEFAULTS
merged with storage and the whole object is written back on Save, so a retired key survives every
save forever. They are not converted: the old pair capped the size a preview *opened* at, the new
one caps how far it may *grow*, and there is no honest arithmetic between them.

### The viewport is `<body>` on a quirks-mode page

`document.documentElement.clientHeight` is the viewport height **only in standards mode**. CSSOM
special-cases it: the root element answers with the viewport, *unless* the document is in quirks
mode, and then `<html>` is an ordinary block that answers with its own padding box — the whole
document's height. So a doctype-less page returns the scroll height, `viewportBox().h` is enormous,
the `min` above never bites, and the preview opens many screens tall.

Measured 2026-09-05 in the Browser pane, one page with a 4000px div at a 1024px viewport:

| | `documentElement.clientHeight` | `body.clientHeight` |
|---|---|---|
| quirks (`BackCompat`) | **4016** | 1024 ✓ |
| standards (`CSS1Compat`) | 1009 ✓ | 7281 |

Neither element is right on its own — the branch is mandatory, and reaching for `<body>`
unconditionally is the *worse* of the two failures. `vpEl()` / `vpW()` / `vpH()` are the only
readers; nothing else may touch `clientWidth`/`clientHeight` for a viewport. Width survives quirks
mode by luck (a block `<html>` fills the viewport anyway), so the symptom is a preview that is too
**tall** and correctly wide — do not let that shape argue against a width fix.

Found on `phun.org`, which ships no `<!DOCTYPE>`. Reported as "it isn't restricted to the browser
window on all sites", which reads like a per-site resolver problem and is not one.

### Edge and corner resize · `E23`

`resizeBy()` sets the frame directly with the opposite edge anchored, then:

- **Picture at fit** → stays at fit, so it grows with the window.
- **Picture spilling** → scale kept, aperture shows more. Rescaling would undo a deliberate zoom.
- **Picture zoomed OUT below fit** → scale kept, same reason.

So `drag.refit` is captured alongside `drag.spilling`, and the test is `scale === fitScale` rather
than `!spilling` — "not spilling" used to mean "at fit" and no longer does.

`drag.spilling` is captured at **grab time**, not read per move, or the gesture would change
character halfway through as the frame passed the picture's size.

**Aspect is FREE; Shift locks it** to `drag.aspect` (the frame's shape when grabbed, not the
picture's, which would snap the frame the instant it was touched). The lock used to be the default,
back when a one-axis drag growing bands of background was an incoherent state; `E26` made it an
ordinary one.

**`ex`/`ey` may each be null, and that is what makes an edge a one-axis corner.** A `null` axis is
left alone unless Shift fills it from the aspect lock. On the axis not being dragged the frame grows
about its **centre** — anchoring to top or left makes the window crawl diagonally while you pull one
edge straight.

### The frame is a margin drawn ON the picture · `E25` — RETIRED v0.71.0

> **The grab border is gone.** `frameMargin`, `borderMode`, `chrome()`, `chromeThickness()`,
> `MOVE_BAND`, the four `.edge` strips and `hitRegion()`'s `'move'` kind all went with it; the
> status bar is the only move handle now. Kept below because the geometry it describes — what a
> painted-on ring costs, and why the hit band and the paint had to be the same number — is the
> argument against bringing one back. Everything below is history.

`frameMargin` (24 px, a setting) is a ring painted **over** the edges of the picture, exactly as the
status bar always has been — the bar *is* the bottom of that ring. Outer 12 px resize, rest of the
margin moves, picture pans.

v0.30.0 laid it out *around* the picture: that cost every preview 48 px each way and forced a 98 px
minimum window. Overlaying costs nothing and needs no minimum beyond what the ⊘ needs anyway.

- **Four `.edge` divs, `pointer-events: none`, sized by `layoutChrome()`.** Pure decoration;
  `hitRegion()` decides what a press does, from `view`, so they never enter the `isBoxControl()`
  trap. The sides run the full height *under* the bar — stopping at whichever is thicker leaves a
  visible gap in the ring just above the bar when the two disagree.
- **`chromeThickness()` is read by both the drawing and `hitRegion()`**, capped at a third of the
  frame. If the two capped differently, the ring you see and the ring you can grab would differ.
- **The ring fades with the bar and stops being a handle while faded** (`chromeVisible()`, read by
  `hitRegion()`). The bar gets this free from `pointer-events: none`; the ring is drawn rather than
  hit-tested, so the rule must be applied by hand. This is the whole answer to the invisible-band
  objection.
- **The `idle` class lives on `box`, not `capEl`** — the strips are siblings of the bar and CSS
  cannot select backwards, so one class on their common ancestor fades both halves as one thing.
  `showBar()`, `resetBar()` and `chromeVisible()` all read it there.
- **`pointerOverChrome()` extends `pointerOverBar()` to the ring**, by geometry, because the strips
  are pointer-transparent.
- **`insetX()`/`insetY()`/`outerW()`/`outerH()` are kept** even though the margin no longer feeds
  them: they replaced ~15 copies of `view.frameW + cfg.borderWidth * 2`, the expression most likely
  to be half-updated.

**Minimum window is 48 px of picture, and `barMinW()` wide once placed** (`minFrameW()`, see the
zoom cluster above) — 50 px and 238 px at the default border. Both are applied in `reflow()` (bounding
the opening size and the wheel) **and** in `resizeBy()` (bounding a hand resize); both places are
needed. Without a floor, `minDisplayed: 0` on a page of tiny pictures produced previews a few pixels
across.

**The ⊘ is absolutely positioned, 20 px in from the right edge.** As a flex item after a `flex:none`
dimensions field it was pushed past the end and clipped — invisible on exactly the previews where it
is most wanted. 20 px rather than flush because the corner is where the hand goes.

**The gutter keeping text off the ⊘ is set inline by `layoutChrome()` and clamped.** `.cap` is
`left:0;right:0` with `box-sizing: border-box`, so a padding wider than the frame does not shrink
the text — it forces the bar wider than the window, which is then clipped, dragging the ⊘ off its
20 px. Measured on a 50 px window: the bar came out 54 px.

Side and top strips are `rgba(30,30,46,.30)` against the bar's `.86` — deliberately near-transparent,
since they carry no text and only need to say "there is a handle here".

### The picture may be smaller than the frame · `E26`

The zoom floor was `fitScale` and `reflow()` never let a free frame exceed the picture, so frame and
picture were welded at the fit. Both limits had to go together.

- **`minScaleFor()` is the floor**: `MIN_MEDIA` (32 px) on the long side, **capped at
  `fitScaleFor()`** so a thumbnail under 32 px is never forced to open enlarged.
- **The background is already there** — `reflow()` centres the picture and the frame's colour shows
  around it.
- **Every enforcement of the old floor had to go together**: `zoomAt`, `verifyMedia`, the window
  `resize` listener, `upgradeViewer`, `resizeBy`. Miss one and the symptom is a zoom-out that
  silently springs back on a path nobody tests.

## A pan that runs out continues as a window move · `E32`

`maxSizeMultiple` above 1 means the frame can be wider than the screen, with its edges off it.
`reflow()` clamps the pan so the frame never shows past the picture's edges — and that clamp used
to be the end of the gesture, which left the edges of the picture **unreachable**: they sit at the
frame's edges, which are off-screen.

`panBy()` now measures what the clamp refused and adds it to `view.left` / `view.top`. One drag
pans until the picture's edge meets the frame, then carries the window along with no stop in
between. The placed clamp (`KEEP_ON_SCREEN`, 72 px) is the only limit, so any part of the picture
can be brought into view.

*(Where the handover happens: `pannable()` — the picture larger than the frame — is what the
middle of the frame does on a press, and it becomes true once the frame stops growing, i.e. at
the `maxSizeMultiple` ceiling or after a hand resize pins the frame. The cursor says which:
`move` (four arrows) = the window moves, `grab` (hand) = the picture pans.)*

## Every open fades from a settled zero

Reported as "`fadeMs` only works the first time; after that the preview opens instantly". The
window is one element reused for every preview, so `box.classList.add('on')` transitions from
**whatever opacity the last fade-out left**, and returning to an image before that fade-out
finished starts the fade-in from most of the way up — indistinguishable from no fade. A brand-new
element has the opposite problem: a transition needs a previous computed value, and the first
`add('on')` after insertion has none.

`showViewer()` therefore removes `on`, sets `transition:none; opacity:0`, forces a reflow with
`void box.offsetWidth`, clears both inline properties and only then adds `on`. Both cases become
the same case. *(Not measurable in the Browser pane — transitions do not advance while it is
hidden, see [`TESTING.md`](TESTING.md).)*

`applyLook()` is the other half: everything the appearance settings write to the window —
`--fade`, `--barfade`, border, radius, shadow — in one function, called from `showViewer()` and
from the panel's `persist()`, so a change made while a preview is up lands on it (`E33`).

## The drop shadow needs SPREAD, not just blur

`0 8px 32px rgba(0,0,0,.55)` looks like almost nothing however far the numbers are pushed,
because a shadow with no spread is the box's own shape: its edge is *under* the box, so the
darkest thing visible outside is the halfway point of the blur — about 50 % of the colour, before
the alpha is even applied. Reported as "100 % opacity and 60 px gives maybe 30 % darkening".

`shadowCss()` sets spread to `size / 2` and blur to `size`, so the solid part of the shadow
reaches the box edge and the taper runs from there to roughly `size` px out — which is what the
two numbers claim to mean.

## The HOVER preview is POINTER-TRANSPARENT · `E1`

**This is the load-bearing decision.** `.box` has `pointer-events:none`; `.box.hot` turns it back
on, and `layout()` sets `hot` only when `placed`. Do not simplify this to always-on.

The bug it fixes: with a hit-testable preview, scanning a row of five thumbnails gives ONE preview —
it covers thumbnails 2–5, so the pointer never reaches them. *"If I have a row of 5 images and I
scan my mouse across them, I expect to get 5 preview windows."*

Consequences, which must be handled together:

- **No `HIDE_GRACE`/`hideTimer`.** The grace existed so the pointer could travel onto the preview.
  There is nothing to travel to, so leaving the image is unambiguous and `onOut` calls `cancel()`
  directly. **Re-adding a delay re-breaks scanning.**
- **Pinning and dragging are decided by GEOMETRY, not hit-testing.** A press lands on the page
  beneath, so the `mousedown`/`click` capture listeners test `pointInPreview(e.clientX, e.clientY)`
  against `view` and hand the event to the same `onBoxDown`/`onBoxClick` the hit-testable states
  use — one state machine, two ways in. Those handlers **must** keep `preventDefault()` +
  `stopPropagation()`, or a link beneath is followed.
- **Those listeners live on `CAP_TARGET` (= window), in capture**, with `contextmenu`. Not enough on
  its own: Open Links in New Tab is on window capture too, and order is the manager's to decide. So
  the press also stamps `<html>` via `claimClick()` (cleared by `releaseClick()` on any press we do
  not claim), which OLINT reads during the click. `mousedown` always precedes `click`, which makes
  the handshake order-independent. Full contract in [`../../CLAUDE.md`](../../CLAUDE.md).
- **`ours(e.target)` is only ever true once `hot` is set** — it means "on a placed window". Since the
  backdrop is hit-testable across the whole viewport while placed, `ours()` is true *everywhere*
  then, which is why `onMove` uses `pointInPreview()` geometry to decide whether to un-fade the bar.
  Using `ours()` there means the bar never fades again.
- **Nothing inside the frame is clickable on a plain hover preview**, by design. Anything needing a
  click — the ⊘, the context menu, the resize cursors — belongs to a placed window.

Two guards keep a drag from destroying what it is dragging: `onOver` and `onOut` both return early
while `drag` is set.

**`hot` is set by `layout()` and MUST be cleared by `hideViewer()`.** `layout()` stops running once
the frame is down, so a `hot` left set leaves the box with `pointer-events:auto` and `cursor:move`
at its last position: an invisible full-size rectangle that shows the move cursor, swallows every
click through `onBoxDown`, and makes `onOver`'s `ours(e.target)` true so no image under it ever
previews again. It arms on the first placement and survives every close. `hideViewer()` clears
`box.style.cursor` for the same reason, since `onMove` writes it inline.

**The general rule: a class that grants `pointer-events` must be removed on the path that HIDES the
element, not the path that lays it out.** Check it with `elementFromPoint` inside the old rectangle
after closing — it must return page content, not `hover-zoom-host`.

## Image actions — the browser's own menu · `E9`

**A userscript cannot *open* the browser's context menu.** A dispatched `contextmenu` event is
untrusted and browsers run no default action for untrusted events. "A button that simulates a right
click" cannot be built, at any price.

**But it can decline to suppress one.** On a **placed** window `altButton()` returns false,
`swallowMenuAt` stays unset, and the browser raises its real menu over our `<img>` — whose `src` is the
resolved full-size URL, so *Save image as…*, *Copy image*, *Copy image address* and *Open image in
new tab* all act on the original. Native chrome does target an `<img>` inside an **open** shadow
root.

**Only placed.** A hover preview is pointer-transparent, so the native menu there comes up for the
thumbnail underneath and offers to save *that*.

**The ⋮ menu was removed and must not be rebuilt.** Its Save and Copy ran in page JavaScript, so
they needed the host to send `Access-Control-Allow-Origin`, and Copy needed clipboard-write on top.
Most hosts send neither and nothing in a page context gets around it. The two that *do* work from
page JS are "open in a new tab" and "copy the URL". Removing it touched eight places
(`isBoxControl()`, `unplace()`, `onBoxDown()`, `onPinWheel()`, `onPinKey()`'s Escape, `cancel()`,
and the document `mousedown`/`keydown`/`resize` listeners) — `node --check` catches none of that; a
leftover call is a runtime `ReferenceError` in a handler, which fails silently.

### The status bar fades itself out · `E10`

The bar is drawn ON the picture, so on a meme, screenshot or comic panel it covers the text being
read. `.cap.idle` sets `opacity:0` **and** `pointer-events:none`; `showBar()` clears it and arms a
`BAR_IDLE_MS` timer.

**Three timings, deliberately different numbers:** `BAR_IDLE_MS` (1000) is how long the pointer must
be still before the fade starts, `BAR_FADE_MS` (1200) how long the fade takes, `BAR_SHOW_MS` (120)
the return. The fade is slow because all of it is reaction time and the bar carries the ⊘; the
return is fast because it is a control just asked for and a slow one reads as lag. `.cap` carries
the show duration and `.cap.idle` overrides it with the fade duration — that is what makes the two
directions differ.

**A pointer resting ON the bar holds it open indefinitely.** A still pointer fires no `mousemove`,
so only the fade timer can notice: it calls `pointerOverBar()` and re-arms instead of fading. The
test is **geometric**, not a hover state, because on a hover preview the bar is pointer-transparent
and `e.target` is the page underneath.

- **`.cap.idle` must drop `pointer-events` as well as `opacity`.** Opacity alone leaves an invisible
  move handle across the bottom of the picture — same class of bug as the `hot` ghost.
- **`showBar()` is called from `onMove` only when the pointer is over the window.** Calling it on
  every mousemove means the bar never fades while the pointer is anywhere on screen.
- **The timeout re-checks `view`** before adding `idle`, and `cancel()` calls `resetBar()`, so a
  preview cannot open with a stale class.

#### The two settings that turn it off, and what 0 actually means (v0.43.0, corrected in v0.44.0)

`barFade` (a checkbox, on by default) gated `barIdleMs` and `barFadeMs` in the panel and the
behaviour: off meant the bar and grab border stayed up for as long as the window did, and
`showBar()` returned without arming a timer. **Retired in v0.70.0 — see the two modes below;
`anyFades()` is what that sentence now reads.**

**`barIdleMs` of 0 means no delay and no fade — NOT "never shown".** The complaint was precise
and easy to over-read: *"when moving the mouse over the preview, the bar would briefly appear and
disappear. But when the mouse was over the border, it would stay visible. This is what I wanted,
just not the flickering when moving across the image."* v0.43.0 read that as "never appear" and
pinned `idle` on, which also killed the one case that was working. **It is a timing complaint, not
a visibility one.**

- **`barInstant()`** is the predicate: `barFade` on, `barIdleMs` 0.
- **`barWanted()`** is the question the fade timer already asked — `pointerOverChrome() ||
  popOpen() || !!drag` — lifted out so it can be asked *synchronously*. At 0 there is no timer to
  ask it later, and asking it a frame later is exactly the flicker.
- **`showBar()` at 0 toggles `idle` from `barWanted()` on the spot.** `onMove` sets `pointer`
  before calling it, so the answer is right in the same event.
- **`drag` is in `barWanted()`** or the bar vanishes mid-drag when the pointer leaves the border
  it grabbed.

**`.box.nobar` only removes the transition** — `transition:none` on `.cap` and `.edge`, nothing
else. It must stay after the `idle` rules (equal specificity, source order decides). v0.43.0 had
it repeat `opacity:0`, which is what made 0 mean "never", and is the line to check first if the
bar ever stops coming back.

**A consequence worth knowing:** `hitRegion()` returns no `move` region while `chromeVisible()`
is false, so at 0 a *zoomed* window has no grab handle while the pointer is over the middle of
the image — moving onto the border brings both the bar and the handle back instantly.

Note the Browser pane never advances CSS transitions, so **read the class, not the opacity** — and
time the flip with a `MutationObserver`, not a polling loop. See [`TESTING.md`](TESTING.md).

## Placed mode — the rest

- **Left click pins, right click dismisses a HOVER preview**; `pinButton` swaps them. Dismiss is for
  "the preview is in my way but my cursor is staying here": it takes the preview down and records
  the element in `suppressed`, which `onOver` skips until `onOut` sees the pointer leave. Without
  that, the next mousemove just re-shows it. The right press is claimed in the document `mousedown`
  handler, **not** on `contextmenu` — mousedown fires first and would otherwise `cancel()` and clear
  `active` before the menu event could see what to dismiss; `swallowMenuAt` then suppresses the
  menu. It is a timestamp with a `MENU_CLAIM_MS` (1.5 s) life, not a flag: a right press released
  outside the window fires no `contextmenu`, and a flag would have eaten the next menu anywhere on
  the page.
- **While placed, the left button always drives the window**, whatever `pinButton` says. Do not wire
  dismissal onto the button that resizes, moves and pans.
- **There is no close button.** A placed window has two ways out that need no aim, and the X sat in
  the corner the hand reaches for to resize. `closeEl`, its CSS, its `layoutChrome()` placement and
  its `isBoxControl()` entry all went together; the ⊘ is the only control left inside the box.
- **The preview opens beside the pointer, then is nudged until the pointer is `REACH_INSET`
  (10 px) inside it** (`nudgeIntoReach`), on the axis that needs it. Centring it on the cursor
  solves reachability but moves it much further than needed. **This is why `cursorGap` was
  retired in v0.40.0** — the nudge overrode every value it could hold.
- **With `position: center` there is no nudge, so the press that pins comes from the picture**
  (`E30`). `pressPinsPreview()` claims a press inside the window's rectangle *or*, in centred
  mode only, on the element the preview came from. Without it a centred hover preview cannot be
  kept at all: it is pointer-transparent, the pointer is never over it, and leaving the picture
  closes it.
- **Key and wheel listeners live on `CAP_TARGET` (= window), in capture**, so arrows and `+`/`−` are
  ours while placed. Keys are added in `place()` and removed in `unplace()` against that one
  constant; `wheel` uses the shared `WHEEL_OPTS` object for add *and* remove, or the removal
  silently no-ops.
- **In the frame's MIDDLE a drag pans only while the picture is spilling; otherwise it moves the
  frame.** `pannable()` is read per press, so zooming in and back out restores dragging with no
  state to keep in step. Before this the placed branch was `'pan'` unconditionally and the press was
  dropped when `pannable()` was false, so a placed frame at `fitScale` could not be dragged at all.

`place()` deliberately does **not** cancel the in-flight resolve — placing is a reason to keep
looking. `upgradeViewer()` holds the frame's centre, and for a placed view also its on-screen size
(`prevImgW / res.w`) and the fraction of the picture at the frame's middle, so a swap changes only
the pixels, never what the eye is tracking.

### Tooltips are drawn by the script, not by the browser

**`TIP_DELAY_MS` is the one value, and it exists because a native `title` has no scriptable delay.**
Every hint used to be `el.title = '…'`, whose appearance timing belongs to the browser and the OS —
about a second in Chrome, different in Firefox, and settable from neither CSS nor JS. Asked on
2026-09-05 for tooltips that are consistent and quicker, the only honest answer was to stop using
`title`: `setTip(el, text)` now replaces every one of them, and `TIP_DELAY_MS` (300 ms) is what all
of them wait.

- **`setTip()` removes the `title` attribute.** Leave it on and the browser draws its own tooltip a
  second later, underneath ours.
- **The tip is appended to the hovered element's OWN root**, found with `getRootNode()`. The viewer
  and the settings panel are separate shadow roots with their own stacking; a tip drawn in the
  viewer's root would sit behind the panel.
- **It is styled inline**, so it needs no rule added to either root's stylesheet, and it carries
  `pointer-events: none` so it cannot take the hover it is describing.
- **It flips above the element when there is no room below**, and clamps to the viewport — the
  Reset/Undo buttons sit on the panel's bottom edge, where a tip below would be off-screen.
- **`hideTip()` is called from `hideViewer()` and the top of `onBoxDown`.** A capture listener on
  `.box` calls `stopPropagation()`, so a `mousedown` on a non-control child never reaches that
  child's own listener — the tip's self-teardown cannot be relied on there.

## Fullscreen · `E35`

The bar's rightmost button. It fills the screen and puts the frame back exactly as it was — the
prior `fixedW`/`fixedH`/`left`/`top`/`scale` are snapshotted into `fullPrev` and restored verbatim.

**The DOCUMENT goes fullscreen, not our host.** Every coordinate in this script is
`position:fixed` against the viewport, and `vpW()`/`vpH()` read
`documentElement.clientWidth`/`clientHeight`. Fullscreening the document is the one route that
makes the viewport *be* the screen in every engine, so the entire geometry model keeps working
untouched. Fullscreening `host` instead depends on whether the fullscreen element resizes the
initial containing block — which is a subtlety that differs between engines and was not worth
betting the layout on. The page is still behind us, so `.dim.full` blacks it out.

**`maximise()` is not just the fallback, it is the whole implementation.** The API call only
changes what the viewport measures; `onFullChange()` then calls `maximise()`/`restoreFull()`, which
are the same two functions the fallback uses directly. So an iframe without `allow="fullscreen"`,
or a rejected request, degrades to a viewport-filling window rather than to nothing.

**`fitFull()` must `reflow()` BEFORE it centres.** `outerW()`/`outerH()` read `view.frameW`/`frameH`,
which are stale until `reflow()` has consumed the new `fixedW`/`fixedH` — centring first offsets the
window by half the size change. Shipped wrong once and caught in browser testing: a 1142→1265 grow
put the frame at `left: 62` instead of `0`.

**Escape is layered:** `onPinKey` leaves fullscreen and returns, so one press does not also unpin.
The browser eats Escape itself when the API is what put us there, and `fullscreenchange` restores;
this branch is what covers the maximise fallback. `unplace()` leaves fullscreen too — but only
`fullActive()` fullscreen, never the page's.

### `fullPrev` is written at the CLICK, and it is also the ownership flag · `E35`

Both halves of that sentence were bugs in v0.63.0, and the first one was serious.

**Never key off `document.fullscreenElement`.** It is set when the PAGE goes fullscreen too, and
`onFullChange` is registered on `document` in every frame of every site. v0.63.0 read it, found no
preview open, and called `exitFullscreen()` — so clicking fullscreen on YouTube entered and
immediately left it. It happened on excluded sites as well, because the listener was registered at
load, before any site check, and the site gates only ever guarded *previewing*. Two rules follow:

- **`fullActive()` is `!!fullPrev` and nothing else.** `onFullChange` returns immediately when it
  is null: that fullscreen belongs to someone else and is none of our business.
- **Nothing in the change handler may call `exitFullscreen()`.** Leaving is only ever driven by
  the button, a key, or `unplace()`.
- The listener is registered in `buildViewer()`, so a page that never opens a preview never has
  it at all. Registering globals at load in a `@match *://*/*` script is how this class of bug
  gets in — see the `isTopFrame` trap in the project `CLAUDE.md`.

**The snapshot is taken before anything moves, in `enterFull()`.** Taking it in the change handler
looked equivalent and was not: `resize` can arrive *before* `fullscreenchange`, and the resize path
calls `fitFull()` while `fullActive()` is already true — so the snapshot captured the
already-maximised geometry and "restoring" put the window back to fullscreen size. The symptom was
a window that came back pinned to the left edge at ~full height and refused to grow, because it was
sitting on the growth ceiling. Reported 2026-09-06.

`fullApi` distinguishes the real API from the maximise fallback, so `leaveFull()` knows whether to
ask the browser (and wait for `fullscreenchange`) or restore directly.

### An exit waits for the request to land · `E47`

`fullReq` holds the `requestFullscreen()` promise while it is in flight. `leaveFull()` called
before it settles — F pressed twice, a double-click followed by Escape — defers itself to the
promise. Without that it saw no `document.fullscreenElement` yet, restored directly and cleared
`fullPrev`, and the `fullscreenchange` that arrived a moment later found nothing of ours and was
ignored: the document stayed fullscreen with a windowed preview on it, until the browser's own
Escape. `restoreFull()` clears `fullReq`; a rejected request (an iframe without
`allow="fullscreen"`) settles it too, and the deferred exit then restores directly.

### Fullscreen is nailed to the screen · `E35`

Every other app's fullscreen is fixed, and ours was not: dragging the picture moved the window off
its own black backdrop and left a grey hole where it had been. Locked in v0.68.0 at three points,
all of which are needed — removing any one of them leaves a way to move it, plus a fourth found in
v0.74.0:

- **`hitRegion()` returns null while `fullActive()`.** No move band, no resize edge, so the
  cursor stops promising a drag as well.
- **`onBoxDown()` allows only `pan` in fullscreen**, and only while `pannable()` — looking around a
  picture the wheel has grown is the one drag that does not move the frame. The status bar is a
  move handle everywhere else and is not one here.
- **`.box.full`** gives `cursor:default` (after `.box.placed:not(.pan)`, or the move cursor still
  wins), and `enterFull`/`restoreFull` clear `box.style.cursor` because `onMove()`'s inline write
  outranks any rule. `onMove` writes `''` in fullscreen rather than a cursor name, so `.pan` can
  still say `grab`.
- **`panBy()` does not spill into `view.left/top` while `fullActive()`.** The one drag fullscreen
  *does* allow moved the window anyway: panning past the picture's edge hands the refused travel to
  the window, which is right everywhere else (a frame grown past the screen has edges nobody could
  otherwise reach) and wrong here, where the frame IS the screen. The window came off the edge and
  stayed there — nothing puts it back until fullscreen ends, since `fitFull()` only re-centres on a
  viewport change. Arrow-key panning took the same route. Found v0.74.0.

### The scrollbar's reserved strip · `E42`

Two separate things go wrong in real fullscreen, and each needed its own fix.

**The measurement.** `vpW()`/`vpH()` return `window.innerWidth`/`innerHeight` while our real
fullscreen is engaged (`fullActive() && document.fullscreenElement`), and
`documentElement.clientWidth`/`clientHeight` every other time. `.dim.full` is `100vw`/`100vh` for
the same reason: those units include the scrollbar's strip, `inset:0` stops short of it.

**The scrollbar itself.** `lockScroll()` also sets `scrollbar-width: none`, not just
`overflow: hidden`. Measured in fullscreen at 1920 wide, all three variants:

| root style | `innerWidth` | `clientWidth` |
|---|---|---|
| as-is (`overflow:hidden`) | 1920 | 1903 |
| `width:100vw` added | 1920 | 1903 |
| `overflow` cleared | 1920 | 1903 |

**`overflow` does nothing to the reservation in fullscreen** — it stops the page scrolling and
nothing more. Windowed, the same `overflow:hidden` takes the gap from 15 to 0, so the propagation
that normally reclaims the strip simply does not happen while the root is the fullscreen element.
`scrollbar-width:none` does reclaim it (15 → 0, verified, and restores cleanly).

**The two fixes are independent, and both are load-bearing.** With only the measurement fix the
window and backdrop *do* span the screen — `dimRight` and `boxRight` both read 1920 — and the strip
is still visible, because the browser paints the empty scrollbar track above page content and
nothing we draw can go over it. With only `scrollbar-width` the strip is freed but `clientWidth`
still sizes the frame short. The symptom that names this: a gap exactly one scrollbar wide with
**no draggable thumb in it**. Before `lockScroll()` existed the same inset was there with a real,
working scrollbar sitting in it, which read as normal rather than as a bug.

**Neither automated surface can enter real fullscreen**, so all of the above came from the user
running a probe in their own Chrome. The Browser pane swallows `requestFullscreen()` (the promise
never settles) and an extension-driven tab is `visibilityState:"hidden"`, which Chrome refuses with
`TypeError: not granted` — a synthetic click *does* carry user activation, so that is not what is
missing. The maximise fallback is testable and was verified: enter, `scrollbarWidth:'none'` with
gap 0 and the frame at full width; leave, both inline styles back to `''` and the page's scrollbar
returned.

Wheel zoom needs no guard: `fitFull()` sets `view.fixedW/fixedH`, which is the hand-resized state,
so the wheel already zooms the picture inside a fixed frame instead of growing the window.

### Fullscreen wears no border · `E43`

The frame's border is the window's edge, and in fullscreen there is no edge — it would draw a
`borderColor` hairline all the way round the screen and take `borderWidth` off every side of the
picture. `borderPx()` answers `0` while `fullActive()` and `cfg.borderWidth` otherwise; `insetX`,
`insetY`, `grabInset` and `applyLook` all read it, so the setting itself is untouched and comes
back on the way out.

**Order is the whole trick.** `fullPrev` is assigned first in `enterFull()`, so `borderPx()` is
already 0 when `applyLook()` runs, and `applyLook()` runs **before** `fitFull()` — which sizes the
frame from `vpW() - insetX() * 2`. Strip the border after the fit and the frame keeps the two
pixels it was told to reserve, leaving the picture short of the screen with nothing there. The
same holds in reverse: `restoreFull()` clears `fullPrev`, then `applyLook()`, then `reflow()`.

## Clicking the picture of a placed window · `E39`

Once the window is pinned its first click has been spent, so the picture itself is free: **one
click pauses a clip, two fill the screen**, in every placed variant including hand-resized and
fullscreen. Added v0.67.0.

**There is no `dblclick` listener, and there is no delayed single click.** The pair arrives as two
`click` events with `detail` 1 then 2; click 1 pauses immediately and records `tapPaused`, and
click 2 undoes that toggle before calling `toggleFull()`. The alternative — waiting ~250 ms to see
whether a second click follows — makes every pause feel late, which is the more common action of
the two.

**The handler is `boxTap()`, called from the `swallowNextClick` branch of the window-level `click`
listener, NOT from `onBoxClick`.** `onBoxDown` sets `swallowNextClick`, and that branch
`stopPropagation()`s on `window` capture — which is *above* the box, so `onBoxClick`'s own capture
listener never runs for a press the window owns. Putting the logic in `onBoxClick` looks right and
is dead code.

**What counts as "the picture":** `onBoxDown` records `tap = {x, y, mid}` where `mid` requires the
window to have been placed *before* this press (so the pinning click is not also a pause), the left
button, `hitRegion()` returning null (not a grab band, not a resize edge) and not the status bar.
`isBoxControl()` has already returned early, so the strip and its popups never reach here.
`onMove()` clears `tap` once the pointer has travelled more than `TAP_SLOP` (4 px), so a pan or a
move is not also a pause.

**The slop check must sit ABOVE `onMove`'s `if (!drag || !view) return;`, not below it.** Not every
press starts a drag: fullscreen with a picture that fits sets no `drag` at all, so a check inside
that guard never ran and the pause fired on release however far the pointer had travelled. Clearing
`tap` is about the pointer, not about a drag being in progress. Fixed v0.69.0.

## One cursor rule: it names what a press would do · `E40`

**`pressMode(reg)` answers "what would a press here start" — `resize`, `move`, `pan` or nothing —
and it is the same rule `onBoxDown` applies.** `applyCursor()` turns that into the cursor:
`grab` for pan, `grabbing` while a pan drag is live, `move` for a window move, the eight resize
arrows, `default` over a control or where a press does nothing. It is the only writer of
`box.style.cursor`, called from `onMove`, from `onBoxDown` after the drag is decided, and from
`endDrag()` — the last because a release with no further pointer movement has nothing else to
redraw it.

Before v0.69.0 the cursor was assembled inline in `onMove` from a different set of tests than
`onBoxDown` used, and the two drifted: fullscreen short-circuited to `''` and left the answer to
CSS, and a live drag kept whatever inline value the last hover had written. The `.box.pan` /
`.box.placed:not(.pan)` / `.box.full:not(.pan)` rules survive as the fallback for the moment
between `place()` and the first mousemove; they are no longer what decides anything.

## Grab border and status bar are two independent three-way modes · `E41`

`borderMode` and `barMode` each answer `'always' | 'hover' | 'off'` for themselves, replacing the
`barFade` checkbox (may the pair fade) and `showStatusBar` (is the bar drawn). Added v0.70.0
because the old pair could not say "border always, bar only on hover", and "border off" was only
reachable by setting `frameMargin` to 0 — a size doing a visibility job.

- **`chrome()` returns 0 when `borderMode` is `'off'`.** That one line is the whole switch: the
  drawn strips, the insets, `chromeThickness()`, and `hitRegion()`'s move band all read it, so
  turning the visual off correctly takes the move handle with it.
- **Two idle classes, not one.** `baridle` hides `.cap` and `.vctl`; `edgeidle` hides `.edge`.
  `applyIdle(idle)` sets each only when that element's own mode is `'hover'`, so `'always'` never
  takes its class and one timer still drives both.
- **`borderVisible()` / `barVisible()` replaced `chromeVisible()`**, which could not answer for
  two elements at once. `hitRegion()` asks the border (the move band is the border's), `pressMode()`
  asks the bar.
- **The panel relabels itself.** `syncFurniture()` writes the subject of the two fade rows from
  which modes are `'hover'` — "Grab border and status bar fade after", or just one of them — and
  hides both rows when neither fades. `relabel()` rewrites `label.childNodes[0]`, so a row that
  will ever be relabelled must be **built with a hint**, or there is no `.hint` span to write into.

### Three questions about the bar, and they are NOT the same question · `E41`

This bit twice in one session, in both directions, so the three are now separate functions:

| | What it covers | Who asks |
|---|---|---|
| `pointerOverCap()` | the status bar rectangle, nothing else | `pressMode()` — the move handle |
| `pointerOverBar()` | that, plus the video strip, volume column and speed menu | fade-keeping |
| `pointerNearBar()` | a band up from the frame's bottom edge, `barHoverBand()` tall | fade-keeping |

**`pressMode()` may only ever use the narrowest one.** `onBoxDown` decides a move from
`capEl.contains(e.target)` — the literal bar — so anything wider makes the cursor promise a move
where the press pans. Folding the hover band in did it once; the pre-existing `overRect(vctlEl)`
in `pointerOverBar()` had been doing it since the strip shipped, over the strip's own background.

**`barHoverBand()` is `BAR_MIN_H`, or `BAR_MIN_H + VCTL_GAP + VCTL_H` (60 px) over a clip.** The
band has to clear the gap between the bar and the video strip, or the strip fades out from under a
hand crossing it on the way to the scrubber. Measured: parked 10, 40 and 55 px up from the bottom
all hold it open; 70 px lets it fade.

## The grab border is gone; the bar is the only handle · `E41`

v0.71.0 deleted the border outright rather than leaving it off by default. What that removed, so a
future session does not go looking: `frameMargin` and `borderMode` (both retired keys), `chrome()`,
`chromeThickness()`, `borderShown`/`borderFades`/`borderVisible`, `MOVE_BAND`, the `edgeEls` array
and its `.edge` CSS, the `edgeidle` class, and `hitRegion()`'s `'move'` kind — that function now
returns a resize region or null, nothing else.

**The status bar is the only move handle.** `pressMode()` and `onBoxDown()` both reduce to: on the
bar → move; otherwise pan if the picture spills, move if it does not. The two were already required
to agree (`E40`); with one handle left there is much less to disagree about.

### `barMode` docks the bar when it is 'always'

`'always'` puts the bar **below** the picture instead of over it; `'hover'` and `'off'` leave the
geometry alone. `barDock()` returns `BAR_MIN_H` or 0 and is added to `outerH()`, to the box's own
height, to `viewportBox().h` and to `fitFull()`'s `fixedH`.

- **Only 'always' docks.** A bar that fades cannot own layout — the picture would resize itself
  every time the bar came and went, which is the one thing worse than a bar drawn over it.
- **`.box.bardock .cap` is opaque.** The media is still absolutely positioned and clipped by the
  box's `overflow:hidden`, so a spilling picture runs on *under* the docked bar; the normal
  `rgba(30,30,46,.86)` would show it through. Measured with an 8-step zoom: image 4357 px tall in a
  903 px box, clipped, nothing visible through the bar.
- **The video strip needs no change.** It sits at `bottom: BAR_MIN_H + VCTL_GAP`, and the dock is
  exactly `BAR_MIN_H`, so it lands just above the docked bar on its own.

### Outside fullscreen the whole preview holds the bar open

`barWanted()` splits on `fullActive()`: outside fullscreen it is `pointInPreview()`, so the bar
never fades out from under a picture you are still looking at — **leaving the window is what starts
the fade**. In fullscreen the still-pointer rule stays, because there is nowhere to leave to: the
window is the screen.

**`onMove` calls `showBar()` once on the way OUT**, guarded by a `barOver` flag. Calling it on every
move outside the window would push the fade back on any movement anywhere on screen — which is the
failure the old "only call it when over" rule was avoiding, and the reason that rule cannot simply
be dropped. Measured: parked mid-picture for 1800 ms at a 300 ms idle, still shown; one move off the
window, faded; back on, shown.

## The floating video strip · `E36`

Play/pause, elapsed time, a scrubber, playback speed and sound, over the picture rather than in the
bar. Only over a clip (`.box.hasvid`), only placed (`.box.hot`), and only above `VCTL_MIN_H`
(`.box.tall`) — below that it would cover the clip instead of sitting on it.

**It floats, so it reserves nothing.** No `btnGutter()` slot, no `barMinW()`, no `bottomGap()`. This
is the whole reason it is an overlay and not a second row: a reserved strip would have pushed the
zoom floor up again for every video, and a scrubber does not fit in the bar beside a 100 px zoom
slider anyway.

**Every element in it must be in `isBoxControl()`** — `vctlEl.contains(t)` covers the lot. The
capture listeners on `.box` eat a child's events otherwise, and the symptom is silence.
`pointerOverBar()` includes its rect for the same class of reason: without it the strip fades out
from under the hand reaching for the scrubber.

**Sound is the one control that can un-permit playback.** A clip autoplays *because* it is muted;
unmuting is allowed only because the click is a gesture. `playVideo()` therefore catches `play()`'s
rejection and falls back to muted rather than leaving a frozen preview. `soundWanted` carries the
choice from one preview to the next — `vidEl.muted` cannot, since `setMedia()` rewrites it.

**Native `controls` was rejected, and not only on looks.** A click on the native strip retargets to
`vidEl`, which is also the target for dragging the picture, so `isBoxControl()` cannot tell the two
apart and the control strip would be either dead or would eat every drag. Its fullscreen button also
escapes the frame, taking the bare video and losing zoom, pan and the bar.

**`clipSecs()`, not `secsOf()`.** `secsOf()` formats a string for the gate's debug line
(`"2s"` / `"length unknown"`); using it as a number silently makes every scrubber position `NaN`.

## The bar's controls clear the grab bands · `E37` — partly retired v0.71.0

> With the grab border gone, `grabBand()` is just `CORNER_REACH` (24 px) and the clearance now
> keeps controls out of the **corner resize zones**, which still exist. The reasoning below about
> reading the setting rather than the clamped thickness is moot; the padding trap is not.

The frame's own edges are draggable and the bar sits inside them, so a control under the bottom
corners (resize) or the side strips (move) is unreachable: `onBoxDown` gives the frame the press
before the control ever sees it. Every control therefore keeps `grabInset()` clear of both sides
of the frame, and the strip does the same.

**It is derived, not chosen.** `grabBand()` is the same `max(CORNER_REACH, RESIZE_IN + MOVE_BAND,
chrome() + borderWidth)` that `hitRegion()` tests, so raising the frame margin widens the clearance
instead of burying the slider. At the defaults that is 24 px, which puts `barMinW()` at 274 px for
a picture and 298 px for a clip.

**It reads `chrome()`, the SETTING, not `chromeThickness()`, the setting clamped to the frame.**
`barMinW()` feeds `minFrameW()` feeds `reflow()`, which is what sets `frameW` — asking about the
frame here is a loop. The setting is the larger of the two, so the clearance errs wide, which is
the direction that was asked for.

**The two paddings on `.cap` may not together exceed the frame.** `box-sizing: border-box` treats
padding as a *minimum*, not a share of the width: overflow it and the bar's border box grows past
the frame, and every `right:`-anchored control goes with it. Shipped wrong once — the buttons
stopped clearing the band and the slider jumped 10 px sideways at the narrowest zoom, which is the
exact failure the corner anchor exists to prevent (`E34`). `layoutChrome()` now clamps
`paddingRight` against what `paddingLeft` already took.

**The readout is left-aligned in its slot** (`.cap .zoom{justify-content:flex-start}`). The slot is
`BAR_ZOOM_W`, wide enough for "3,200%"; right-aligning it left a 24 px hole between the slider and
a short reading like "26%" — and that hole was inside `zctlEl`, so `isBoxControl()` swallowed the
press while `onMove`'s geometry still drew a move cursor over it. Reported as "the four-way arrow
shows but nothing happens".

**A control is never a move handle**, and the cursor now says so: `onMove` asks
`pointerOverControl()` — `root.elementFromPoint()`, because a document-level hit test only ever
names the shadow host — and leaves the cursor alone over anything `isBoxControl()` claims.

## Sound is remembered per site · `E38`

`cfg.siteAudio` maps host to `{muted, volume}` — **two independent values**, and both start silent
(`AUDIO_DEFAULT = {muted:true, volume:0}`): a preview that made noise on a page nobody asked it to
would be the worst possible first impression. After that the site's own answer is what a new
preview opens with.

- **`volume` is the UNMUTED level and is never overwritten by muting.** The mute flag overrides the
  output to silence; the level underneath survives, so the button toggles between silence and
  whatever was last set. A stored level of 0 is legal and means the button toggles 0 ↔ 0 — the
  icon changes and nothing else does. v0.67.0 removed a `toggleMute()` line that bumped a zero
  level to a default, because that made a deliberate 0 unstorable: it is the user's answer, not a
  gap to fill.
- **`saveAudio()` reloads before it writes.** The map is shared with every other tab on every other
  site; a read-modify-write against our own stale `cfg` would drop their entries.
- **The volume column and the mute button are one state.** Dragging the column to zero mutes.
  `syncVideoCtl()` shows a muted element as 0 rather than the level it will come back to, and puts
  `.muted` on `.vsound` so the icon goes red (`#f38ba8`).
- **An audio change never resumes a paused clip.** `applyAudioWish(wasPlaying)` takes the play
  state read *before* the change and only restarts what the change itself stopped — unmuting a
  clip that autoplayed because it was muted. It used to play unconditionally on any audio change,
  so touching the volume of a paused preview started it.
- **`volDrag` guards the column exactly as `zoomDrag` guards the zoom slider** — `syncVideoCtl()`
  writing `.value` mid-drag is a slider fighting the hand on it.
- **The column and the speed menu pop ABOVE the strip**, outside `vctlEl`'s rect, so
  `pointerOverBar()` counts them too or the bar fades out from under the pointer reaching for them.
  Both are clipped by `.box{overflow:hidden}` on a frame too short to hold them; accepted.

**The speed menu is a `.spop`, not a `.pop`.** It anchors to the rate button rather than the bar's
right edge, clamped so a narrow frame cannot push it off the left edge, and it joins `closePops()`
and `popOpen()` so one press closes it and the bar waits on it. Its custom field is a text box, so
`capOwns()` must claim the keyboard while it is open — `onPinKey` is capture on `window` and would
otherwise eat the digits.

**The ▶ that stops clips is a STROKED no-play glyph** (`ICON_NOPLAY`, two paths, `fill:none`). A
slash across a solid triangle reads as a triangle; outlining both is the only version that says
"no" at 13 px.

## Corrections to `E37` and the sound column

**The gap after the zoom readout cannot be closed completely.** The slider's right edge and the
buttons' left edge are both pinned to the frame's right edge, so the space between them is a
constant; a reading shorter than the slot's reserve leaves slack *somewhere* in it. Right-aligning
the readout put the slack before it (between slider and readout); left-aligning puts it after.
The only way to remove it is a slot that tracks the text, which moves the slider — `E34`. What was
done instead: `BAR_ZOOM_W` trimmed 52 → 44, measured against the widest reading the ceiling can
produce (`MAX_SCALE_ABS` 64 → "6,400%", 35 px at 11 px system-ui, plus `.zval`'s 6 px of padding).
Residual slack at a short reading is ~16 px.

**`box.style.cursor = ''` is not "no cursor", it is "whatever CSS says"** — and CSS says
`.box.placed:not(.pan){cursor:move}`. Suppressing the move cursor over a control therefore needs an
explicit `'default'`; the empty string left the four-way arrow exactly where the complaint was.
Child rules still win for the child's own box, so the buttons and sliders keep their `pointer`.

**`.cap .block` keeps `line-height:16px`.** The shared 18 px centres the letters of AA but drops the
taller circled glyph a pixel too low.

### The volume column: hover, with a close delay · `E38`

Hovering the sound button opens the column; leaving it closes after `VOL_CLOSE_MS`. Both halves
matter, and the project has now tried all three designs — the order is worth knowing, because two
of them look correct and are not:

1. **CSS `:hover` on a shared wrapper.** Failed: the pointer travelling from the button to the
   slider is briefly over *neither*, so the column vanished on the way to it. Whether it did
   depended on how fast the mouse moved, which is why it worked "a few of the times".
2. **Sticky — opened and closed by the button, dismissed on leave only after the slider had been
   used.** Correct, in that nothing could lose it, but tried and disliked: the button then meant
   two things at once, and the column outstayed its welcome.
3. **Hover plus a close delay** (current). The delay is what makes hover viable — a grace period
   cannot be outrun, where a hover test can.

Two details the delay alone does not cover:

- **The listeners are `mouseover`/`mouseout` on the wrapper, NOT `mouseenter`/`mouseleave`.**
  `.vvol` is a DOM child of `.vsound`, so enter/leave never fire for a crossing between the two —
  which is fine going *up* into the column (nothing closes it) and broken coming back *down*: the
  leave from the column armed the close timer and no enter on the wrapper existed to cancel it, so
  the column vanished while the pointer sat on the button. `mouseover`/`mouseout` bubble from
  descendants and fire on every internal crossing, so the close is always re-cancelled. Fixed in
  v0.67.0.
- **`toggleMute()` calls `openVol()`.** Once the column had been lost with the pointer still on the
  button, no further crossing existed to reopen it and clicking did nothing visible; the click is
  now itself a request to see the column.
- **The gap between button and popup is `padding`, not `margin`.** Margin is dead space outside
  the hover target; padding is inside it. The delay would have papered over this, but the dead
  pixels would still be there for the pointer to fall into.
- **`volDrag` re-arms the timer instead of letting it fire.** A drag is released wherever the hand
  happens to be, which is routinely off the column; without this the slider is taken away
  mid-adjustment.

**Why the column got STUCK open, and the two things that now stop it.** `volDrag` was armed on the
slider's `mousedown` and disarmed only on its `change` — and **a press on a range input that does
not move the value fires no `change` at all.** Click the thumb where it already is, or press and
release without dragging, and the flag is set for the rest of the preview's life: `laterCloseVol()`
sees it, re-arms, and the column can never close. Nothing recovers it short of tearing the window
down, which is exactly the reported symptom. Fixed in v0.68.0, two ways, because one of them is a
guarantee and the other is a repair:

- **`releaseSliders()` on the document's `mouseup`.** The release is the one event that always
  comes. `seekDrag` and `zoomDrag` are the identical shape and were cleared at the same time — the
  scrubber sticking stops it following the clip, and `zoomDrag` sticking holds the bar open for
  ever (`zoomBusy()`).
- **`openVol(e)` clears `volDrag` when `e.buttons === 0`.** Hovering the button with nothing held
  cannot legitimately be mid-drag, so no stuck flag survives the next hover. The `buttons` test is
  load-bearing: a real drag that wanders off the column and back must NOT be reset.

`.vvol` is shown by the `open` class only — there is no `:hover` rule left, so JS is the single
source of truth for its visibility.

### Our fullscreen hides the page's scrollbar

Fullscreening the *document* leaves the page scrollable underneath, so its scrollbar is still drawn
down the side of our black backdrop. `lockScroll()` sets `overflow:hidden` on **both**
`documentElement` and `body` — which of them carries the scrollbar is the page's choice, not ours —
and `unlockScroll()` puts back the exact inline values it found.

**Restore what was there, do not clear.** A page may carry its own inline `overflow`, and blanking
it is a change to the site that outlives the preview. The saved value is re-assigned verbatim;
assigning `''` is what "there was none" has to mean, and it is only used when that is true.

The lock reclaims the scrollbar's width, which fires `resize` → `fitFull()`. That is idempotent and
happens under the backdrop, so it is invisible.

**The rate clamp is the browser's, not ours.** Chromium throws `NotSupportedError` outside
[0.0625, 16] and Firefox ignores the assignment, so `setRate()` clamps and the readout shows what
stuck — the same contract as the zoom field.
