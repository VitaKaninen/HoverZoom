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

## The wheel grows a PLACED window, about the POINTER · `E22`

`view.fixedW` is the whole of the state:

| `view.fixedW` | set by | `frameW` |
|---|---|---|
| `null` | nothing yet | `max(MIN_FRAME, min(imgW, growBox().w))` — follows the picture to the ceiling |
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

### The frame is a margin drawn ON the picture · `E25`

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

**Minimum window is 48 px of picture — 50 px at the default border.** `MIN_FRAME` is applied in
`reflow()` (bounding the opening size and the wheel) **and** in `resizeBy()` (bounding a hand
resize); both are needed. Without it, `minDisplayed: 0` on a page of tiny pictures produced previews
a few pixels across.

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
`swallowMenu` stays off, and the browser raises its real menu over our `<img>` — whose `src` is the
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

`barFade` (a checkbox, on by default) gates `barIdleMs` and `barFadeMs` in the panel and the
behaviour: off means the bar and grab border stay up for as long as the window does, and
`showBar()` returns without arming a timer.

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
  `active` before the menu event could see what to dismiss; `swallowMenu` then suppresses the menu.
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
