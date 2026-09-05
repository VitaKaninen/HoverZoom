# The preview window

How the window behaves and why: the two states, geometry, the frame and its handles, dragging, zoom, the status bar, and the browser's own context menu. The behavioural summary with the citable IDs is [`../INTERACTION.md`](../INTERACTION.md).

## Two viewer states: hover → placed (v0.28.0)

*Behaviour is specified in [`INTERACTION.md`](../INTERACTION.md) (`S05`, `S10`, and the rules `R1`
and `R2`). What follows is why it is built that way — keep the two in step.*

- **Hover** — transient. Opens beside the pointer. Held open by ONE thing: the pointer being
  over the source image. Leaving that image takes it down **at once**, with no grace period.
  A wheel over it belongs to the PAGE: it scrolls, and the scroll takes the preview down.
- **Placed** — one press: a click, a drag, or a corner grab, all the same gesture. Held open by
  NOTHING; it ends only on Escape or a click outside it. Position becomes free, the wheel becomes
  the window's, and the page underneath stays readable and scrollable.

Read that as one rule: **exactly one thing holds the preview open at a time, and leaving it
ends the preview.** Every earlier version blurred this — both the image and the preview held
it — and every reported hover bug came from the blur.

**There used to be a third rung, `detached`, and removing it is the point of v0.28.0.** It was
reached by dragging a hover preview, and it was held open by *the preview itself* — so a window
you had deliberately positioned vanished the moment the pointer wandered off it. That is the
opposite of what positioning something means, and it is why the rung had to carry `suppressed`
bookkeeping (`T11`/`T13`) that nothing else needed.

Three things fell out of the collapse for free, and they are the argument for it:

- **`DRAG_SLOP` and `justDragged` are gone.** They existed only because a drag and a click led to
  *different* states, so a 3px wobble during a click had to be told from a real drag. Both lead to
  the same state now, decided on the **press**, so there is nothing left to distinguish.
- **Scroll no longer kills a placed window** — `E3`'s standing complaint.
- **`onOver`/`onOut` lose their `detached` branches**, which were the fiddliest part of the hover
  machine.

**The cost is real and was accepted deliberately: right-click no longer shoves a window aside.**
On a placed window the right button belongs to the browser, because its context menu is the only
thing that can Save or Copy the picture (see the image-actions section). So "drag it out of the
way, then right-click to be rid of it" is now "drag it, then X / Escape / click outside". Do not
"fix" this by giving right-click back to dismiss on a placed window — that trades a working Save
for a shortcut that has three replacements.

### Placed is NOT modal, and that is a change from pinned

`dimOpacity` is removed and `.dim` is transparent. It exists for one job: catching the click that
dismisses the window before the page can act on it. Specifically:

- **The page still scrolls.** A wheel over the backdrop finds no scrollable ancestor until the
  document, so it scrolls normally; only a wheel *over the frame* is claimed. Verified: a
  synthetic wheel outside the frame comes back with `defaultPrevented: false`, one over the frame
  `true`.
- **The page cannot be clicked**, and `R2` keeps hovering off, so there is only ever one window.
- **Dimming would fight the whole point.** You place a window in order to compare it with what is
  behind it; dimming the comparison is backwards.

The dismissing click is swallowed at **window capture**, not by the backdrop's own handler. The
backdrop lives inside the shadow host, so capture reaches `document` and `body` first and a page
listening there would see a phantom click — nothing on the page can act on it (the event's target
is the backdrop), but being observed at all is avoidable. Note `e.composedPath()[0]`, not
`e.target`: outside the shadow tree the target is retargeted to the host.

### The wheel grows a PLACED window, about the POINTER, and only a hand resize stops it (v0.34.0)  · `E22`

*Specified as `E22`.* The reported problem it started from: on a page whose pictures are all
small, every preview opens small, and "resize each one by hand" is not a workflow.

So `reflow()` has TWO modes, and `view.fixedW` is the whole of the state:

| `view.fixedW` | set by | `frameW` |
|---|---|---|
| `null` | nothing yet | `max(MIN_FRAME, min(imgW, growBox().w))` — follows the picture to the growth ceiling |
| a number | `resizeBy()`, i.e. a hand resize | `fixedW` — pinned, whatever the picture does inside it |

**There used to be a third, and removing it is the point of v0.34.0.** v0.29.0 froze the size on
the MOVE, on the reasoning that putting a window somewhere is the moment its size is settled;
v0.32.0 softened that from a fixed size to a ceiling (`sizeLock: 'max'`), so zooming out after a
move shrank the window again and zooming in stopped where it had stopped before. Both were asked
for, and the arguments for them are still good ones read on their own.

**What killed it is that v0.31.0 made it unreachable, and nobody noticed for two versions.** Once
the wheel belongs to the page while you are only hovering, zooming *requires* placing first —
placing is a press, a press that wandered `MOVE_SLOP` (3px) was a move, and a click almost always
wanders 3px. So in practice every window was frozen at its opening size, which is never larger
than the browser window, before it had any chance to be grown. `maxSizeMultiple` could not be
reached at all. Reported as "it stops at the edges of the browser window" and diagnosed as a
v0.33.0 regression, which it was not — v0.33.0 was simply the first version whose other changes
sent the user looking.

**The general shape is worth keeping:** a rule that is correct in isolation can be made vacuous
by a change somewhere else, and the symptom is not an error but a capability that silently stops
being reachable. The same shape as v0.20.0's `NEVER` gate, two sections down.

**Zoom is anchored on the POINTER, and that is what makes a never-frozen frame comfortable.**
`zoomAt()` holds the pointer at a constant FRACTION of the frame (`fx`/`fy`), so a growing window
expands away from the cursor and a shrinking one collapses towards it. It used to hold the
frame's centre, which is fine while the frame is pinned and wrong while it is following the
picture: zooming out walked the edges inward past the pointer, `onPinWheel`'s `pointInPreview()`
then stopped claiming the wheel, and zooming out further meant chasing the window across the
screen with the mouse. Reported in the same message. `zoomCentre()` passes the frame's own
centre, so `+`/`−`/`0` get `fx = fy = 0.5` and behave exactly as they always did — there is no
pointer in a keypress.

**`fitScaleFor()` measures against `fixedW` when there is one, not the current frame**, so `0` on
a hand-sized window fits the picture to the size that was chosen rather than to the browser
window.

**A wheel over a HOVER preview is the page's, and that is the v0.31.0 correction.** v0.29.0 had
`onPinWheel` call `place()`, so one notch promoted the window and grew it — which made
grow-then-position a gesture you could finish without clicking first. The cost was that the
wheel stopped scrolling the page whenever a preview was up, and since `nudgeIntoReach()` puts the
cursor inside the frame, that was nearly always. Asked for and reverted the same day it shipped:
scrolling a page is a thing people do constantly and previewing is incidental to it, so the
common gesture wins. The bought gesture survives one click later — nothing but a hand resize
freezes the size, so a placed window grows on the wheel exactly as before.

**`enableWheelZoom()` is therefore called from `place()`, not `showViewer()`**, and
`disableWheelZoom()` from `cancel()`. Binding it on show and gating inside the handler would work
too, and is worse: this is a non-passive capture listener on `window`, so while it is attached
every wheel event on the page is cancellable for nothing.

A placed window keeps growing on the wheel until it reaches the ceiling, where the frame stops
and the picture spills inside it.

**`fitScaleFor()` exists because of this.** What `0` returns to used to be "fit the window"; on a
hand-resized frame it has to become "fit the FRAME", or `0` on a window the user sized by hand
would spring it back to the window's shape and throw the size away. It was also the zoom *floor* until
v0.30.0 — that job is `minScaleFor()`'s now, see "The picture may be smaller than the frame".

**`upgradeViewer()` reads `userSized` against the OLD fit, before recomputing it.** A hover
preview that has been wheel-grown must hold its on-screen size exactly as a placed one does —
missing that case means a late upgrade quietly undoing the sizing just done by hand. Getting the
ordering wrong here compiles and silently does the wrong thing.

### Free positioning, and the status bar as the title bar (v0.28.0, settled v0.29.0)  · `E21`

*Specified as `E21`.* `clampPosition()` was not deleted, it was **loosened** — deleting it strands
a window dragged fully off screen, and strands one at `left: 1500` the moment the browser is
narrowed to 1200. It now guarantees only that `KEEP_ON_SCREEN` (72px) stays in view per axis.

`hitRegion()` is three rings since v0.30.0: **a resize strip along the edge, a move band inside
it, and everything further in is the middle**, which moves the frame or pans the picture by the
old rule. The move ring only exists **while the frame margin is visible** (`chromeVisible()`);
faded, a press there falls through to the middle's rule, which is what keeps an overlaid ring
from being the invisible band all over again.

**The resize strip STRADDLES the window edge** (v0.33.0): `RESIZE_OUT` (6px) outside plus
`RESIZE_IN` (6px) inside, so the cursor changes as the pointer arrives rather than after it has
crossed the border. `hitRegion()` tests the window grown by `RESIZE_OUT`, which lets `dl`/`dr`/
`dt`/`db` go negative and leaves every comparison below reading the same on both sides of the
edge. The outer half is carried by `gripEl`, an invisible collar between the backdrop and the
frame — the only part of it anything can reach is the ring sticking out past the box. It gets
`hot` in `layout()` and loses it in `hideViewer()`, for the documented reason the box does.

Then `MOVE_BAND` (13px) further in, floored at the drawn ring's own thickness
(`max(rb + MOVE_BAND, chromeThickness() + borderWidth)`) — a painted handle with a dead strip
along its inner edge would be the worst of both. At the defaults that works out to 25px, so the
13 is the number that matters only when `frameMargin` is set small.

**The middle ring is the move band that v0.29.0 removed, and the difference is that this one is
drawn.** v0.28.0 put an *invisible* move-only band just inside the resize strip so a window
dragged half off screen always had something to drag it back by. It was removed because two bands
within 30px of each other is a mis-grab waiting to happen, and because it made the edge mean two
different things depending on a number nobody can see. Both objections are about *invisibility*,
not about the idea: `frameMargin` paints the ring, clips the picture out of it, and puts the
`move` cursor on it, so there is no hidden number left. See "The window has a frame" below.

`showStatusBar: false` used to be a real trade — a spilling frame with no bar could be resized and
panned but not moved. The margin removes that; turning the bar off now costs the filename and the
⊘, not the ability to move the window. `frameMargin: 0` **and** `showStatusBar: false` together
bring the old trade back, and that is what the setting's description says.

**A hint on the bar says what a press does** (v0.36.0). `capHintEl` — *(click this window to pin
it)* — sits between the filename and the metadata, and `.box.placed .cap .hint{display:none}`
drops it the moment the window is placed, when it would be describing something already done. It
is the one thing about this UI that cannot be guessed: a hover preview is pointer-transparent, so
nothing about it invites a click, and every control that would advertise the fact (the ⊘, the
browser's own menu) only appears *after* the click. It is `flex:0 1 auto` with an ellipsis, so on
a narrow bar it gives way before the dimensions do.

### The status bar is part of the window — `stickBar()` is gone (v0.37.0)  · `E21`

The bar sits at the bottom of the frame. Always, at every size and position, including off the
bottom of the screen. `.cap` is `bottom:0` in CSS and nothing writes an offset over it.

**It took three versions to get here and the reason is worth keeping, because the mistake was
structural rather than arithmetic.** `stickBar()` floated the bar up to the bottom of the frame's
*visible* part, to answer a real trap found while verifying v0.29.0: a frame grown past the
viewport covers the whole screen, so no edge and no corner is reachable to resize by, the middle
pans, and the bar — then the only thing that moved the window — is below the bottom of the
screen. Only Escape got you out.

Then it was narrowed twice, and each narrowing was reported as still wrong:

- **v0.35.0, `view.top < 0`** — too coarse. A frame taller than the viewport still has its top off
  screen after being dragged down, so the rescue fired on the very gesture it was meant to leave
  alone.
- **v0.36.0, `ringOnScreen()`** — "is any strip of the frame margin in view", which is the right
  question about handles and the wrong thing to attach to the bar. Sliding a windowleft/right made
  the bar hop up and down as the side strips crossed the viewport edges: *"as I move the window
  from left to right, the bar drops back down when either side is visible."* Correct by the rule
  and unexplainable to anyone watching it.

**The finding that ends it: the trap state and the deliberate state are the same geometry.** "A
window nobody can reach" and "a window I have deliberately pushed off the bottom" differ only in
intent, so no rule written in terms of `view.left`/`view.top` can separate them, and every attempt
becomes a rescue that overrides the user some of the time.

**What made the rescue disposable is v0.34.0, one change earlier.** The trap needed the frame to
be frozen at screen size, which is what the move-freeze did — zooming out then shrank the picture
inside a frame that stayed put. A free frame follows the picture down, so scrolling back out is
now a complete escape from the state scrolling in created. Measured from a 2512 × 1392 frame
covering a 1265 × 705 viewport: eight notches out and an edge is back in view, at 403 × 302.

**What is left, stated plainly:** a HAND-RESIZED frame is pinned, so zoom-out does not shrink it,
and one dragged bigger than the screen and then moved until all four edges are off it can only be
closed with Escape. It takes two deliberate acts to build, the second of which is exactly the one
that must not be overridden, and Escape is a documented terminator (`K5`). That trade was made
knowingly.

**Do not reintroduce a float based on `clampPosition()`'s `KEEP_ON_SCREEN` either.** That
guarantees 72px of the FRAME stays in view, which a strip of bare picture satisfies; it says
nothing about a handle, and it is a position test, which is the family of test that failed.

**The bar's precedence in `onBoxDown` was narrowed in v0.33.0, and the narrowing is the point.**
It used to be tested FIRST and suppress `hitRegion()` entirely, from when it was the only move
handle there was. Once the whole frame margin became one (`E25`) that made the bar a dead spot
for resizing — and the two BOTTOM CORNERS in particular answered a grab with a move cursor,
reported as "I can't resize the window by grabbing either of the bottom corners". It is now
`capEl.contains(e.target) && !(reg && reg.kind === 'resize')`, so a resize region wins and the
bar claims only what is left.

**Do not delete the rest of it as redundant** — that was the first instinct and it is wrong.
With `frameMargin: 0` there is no move ring for `hitRegion()` to return at all, and with a small
one the ring is thinner than the bar, so without the precedence the bar's upper rows would pan.
The redundant half was the overlap with the resize strip; the non-redundant half is everything
else.

`onMove` mirrors the same rule for the cursor, but with **geometry** (`pointerOverBar()`) rather
than `e.target`: a mousemove seen on `document` has been retargeted to the shadow host and can
never name the bar. It is gated on `chromeVisible()` so a faded bar shows the cursor its press
would actually produce. `.box.placed .cap{cursor:move}` was removed with it, or the bar would
claim `move` over its own resize strip.

`resetBar()` clears the offset, or the next preview opens with its bar floating up the picture.

**Edges resize, not just corners, because corners are not always reachable.** The growth ceiling
is above 1×, so a frame can be larger than the browser window and have no corner on screen at all
— measured while testing: a 1513px frame on a 1265px viewport had no vertical edge in view until
it was dragged. An edge is a whole strip and there is nearly always one of those visible.

**Geometry, not child elements.** Four corner divs and four edge divs is the obvious build and it
lands straight in the documented `isBoxControl()` trap: `onBoxDown` is a capture listener on an
ancestor, so it eats a child's events first and the symptom is silence. Deriving the regions from
`view` also gives one code path for both states — on a hover preview there is nothing to hit-test
at all.

A hover preview is deliberately **not** free: it is positioned by the script rather than the user,
so it is kept fully on screen while it fits, and only stopped from sliding a gap in at an edge
once it has been grown past the window.

### A drag outlives the frame and the browser (v0.29.0)  · `E24`

*Specified as `E24`.* Mostly free, and worth knowing it is free: `onMove` is on `document`, and
while a button is held the browser keeps delivering `mousemove` with coordinates outside the
viewport. So a pan started inside the frame follows the pointer across the frame's edge, across
the page and off the browser without any special casing.

The one thing that does NOT arrive is the `mouseup`, when the button is released out there. The
drag then stays live and the picture follows the pointer back in with no button held — a window
apparently glued to the mouse. **`e.buttons === 0` on the next move is the only thing that can
notice**, and it ends the drag through the same `endDrag()` the ordinary release uses, so the two
paths cannot drift. Verified by dispatching moves at `buttons: 0` after a press: the picture stops
dead and `.drag` comes off.

### `maxSizeMultiple` replaces the two percentages, and 2× is a geometric argument  · `E7`

`maxWidthPct`/`maxHeightPct` (92 each) are gone. They bought an 8% margin for *reachability*, and
a window that can be moved anywhere does not need buying. A preview now opens filling the window.

The new setting caps **growth**, and the two numbers must not be the same one:

```
growW = viewportBox().w * m            // the ceiling the wheel and corners may reach
openW = min(growW, viewportBox().w)    // never OPEN bigger than the screen
```

Without that `min`, a large picture on a 2× setting would *open* taller than the screen — and a
preview appears without being asked for.

**Why the default is above 1×, in the user's own framing:** a frame exactly the window's height,
shoved upwards to see what is under it, leaves a strip of empty page along the bottom, and lining
it back up is fiddly. A frame larger than the window in both axes reaches the screen edges from
any position, so there is nothing to line up. That is the whole reason for 2 — it is not about
wanting bigger pictures.

`RETIRED` in `readSettings()` **deletes** the old keys rather than ignoring them: `cfg` is
DEFAULTS merged with storage and the whole object is written back on Save, so a retired key
survives every save forever. They are not converted — the old pair capped the size a preview
*opened* at (below the window), the new one caps how far it may *grow* (above it), so there is no
honest arithmetic between them.

### Edge and corner resize: what the picture does depends on what it was doing  · `E23`

*Specified as `E23`.* `resizeBy()` sets the frame directly with the opposite edge anchored, and
then:

- **Picture at fit** → stays at fit, so the picture grows with the window. This is what "stretch
  it to the size I want" means; letting the frame grow grey bars instead would be a worse answer.
- **Picture spilling** → the scale is kept and the aperture simply shows more. Rescaling here
  would undo a zoom asked for deliberately.
- **Picture zoomed OUT below fit** (v0.30.0) → the scale is kept for the same reason. This is
  why `drag.refit` is captured alongside `drag.spilling` and the test is `scale === fitScale`
  rather than `!spilling`: "not spilling" used to mean "at fit" and no longer does.

With a free aspect, "at fit" means fitted on whichever axis binds, so pulling one edge grows the
picture only until the other axis takes over. Measured: a 995×747 frame at fit, right edge pulled
in 400px, gives 595×747 with the picture at 593×445 and background above and below it.

`drag.spilling` is captured at **grab time**, not read per move, or the gesture would change
character halfway through as the frame passed the picture's size.

**Aspect is FREE, and Shift keeps it** (v0.32.0 — it was the other way round). The lock was the
default because an edge drag that changes one dimension only just grows bands of background down
the sides; that was an incoherent state before v0.30.0's `E26` let the frame be a different shape
from the picture, and it is an ordinary one now. Shift still locks to `drag.aspect` — the frame's
shape when the edge was grabbed — rather than to the picture's, which would snap the frame the
instant it was touched.

**`ex`/`ey` may each be null, and that is what makes an edge a one-axis corner** rather than a
separate gesture: a `null` axis is left alone by the mouse, and it stays alone unless Shift fills
it in from the aspect lock. On the axis not being dragged the frame grows about its **centre** —
anchoring it to top or left instead makes the window crawl diagonally while you pull one edge
straight.

### The window has a frame, drawn ON the picture (v0.30.0, corrected in v0.31.0)  · `E25`

*Specified as `E25`.* `frameMargin` (24px, a setting) is a ring painted **over** the edges of the
picture, exactly as the status bar always has been — the bar *is* the bottom of that ring. It is
a move handle, so the window reads as an ordinary window from the outside in: **outer 12px
resize, the rest of the margin moves, the picture pans**.

**v0.30.0 laid the ring out AROUND the picture and that was the wrong shape.** It cost every
preview 48px of width and height, and it forced a 98px minimum window — which then read back as
"the minimum is large because the frame is large", a number invented to prop up a mistake. The
user's own framing settled it: the bottom border was always drawn on top of the picture, and the
other three were meant to match it. Overlaying costs nothing and needs no minimum beyond the one
the ⊘ needs anyway.

- **Four `.edge` divs, `pointer-events: none`, sized by `layoutChrome()`.** They are pure
  decoration: `hitRegion()` decides what a press on them does, from `view`, so they never enter
  the `isBoxControl()` capture trap. The sides run the full height *under* the bar rather than
  stopping at it — stopping at whichever of the two is thicker leaves a visible gap in the ring
  just above the bar whenever they disagree. The bottom strip only appears when there is no bar.
- **`chromeThickness()` is read by both the drawing and `hitRegion()`.** The ring is capped at a
  third of the frame so a 50px window is not entirely chrome, and if the two capped differently
  the ring you can see and the ring you can grab would not be the same ring.
- **The ring FADES with the bar, and stops being a handle while faded** (`chromeVisible()`, read
  by `hitRegion()`). This is the whole answer to the objection that killed v0.28.0's invisible
  move band: there is never a region that means something different from what is drawn. The bar
  got this for free from `pointer-events: none`; the ring is drawn rather than hit-tested, so the
  same rule has to be applied by hand.
- **The `idle` class moved from `capEl` to `box`.** The strips are siblings of the bar and CSS
  cannot select backwards, so one class on their common ancestor is what makes the two halves of
  the frame fade as one thing. `showBar()`, `resetBar()` and `chromeVisible()` all read it there.
- **`pointerOverChrome()` extends `pointerOverBar()` to the ring**, so a pointer parked on the
  margin holds it open the same way. Geometry, because the strips are pointer-transparent.
- **`insetX()`/`insetY()`/`outerW()`/`outerH()` are kept even though the margin no longer feeds
  them.** They replaced ~15 copies of `view.frameW + cfg.borderWidth * 2` — the expression most
  likely to be half-updated — and they are where a future margin-affects-layout change would go.
- **`onBar` still outranks `hitRegion()`** in `onBoxDown`, or the bar's lower half would resize.

**The minimum window is 48px of picture — 50px at the default border**, which is the number the
user asked for. `minDisplayed: 0` on a page of tiny pictures otherwise produced previews a few
pixels across, which is where the ⊘ complaint started. `MIN_FRAME` is applied in `reflow()` (so it
bounds the opening size and the wheel) and in `resizeBy()` (so it bounds a hand resize); both were
needed.

**The ⊘ is absolutely positioned, 20px in from the right edge.** As a flex item it sat after a
`flex:none` dimensions field, so on a narrow bar the name shrank to nothing, the dimensions
overflowed, and the button was pushed past the end and clipped — invisible on exactly the
previews where it is most wanted. 20px rather than flush because the corner is where the hand
goes to resize or move. The **X** moved in for the same reason, to just inside the ring.

**The gutter that keeps text off the ⊘ is set inline by `layoutChrome()`, not in CSS, and it is
clamped.** `.cap` is `left:0;right:0` with `box-sizing: border-box`, so a padding wider than the
frame does not shrink the text — it forces the whole bar wider than the window, which then gets
clipped and drags the ⊘ off its 20px. Measured on a 50px window: the bar came out 54px.

**The side and top strips are `rgba(30,30,46,.30)` against the bar's `.86`** — mostly transparent
on purpose, since they carry no text and their whole job is to say "there is a handle here"
without hiding the picture.

### The picture may be smaller than the frame (v0.30.0)  · `E26`

*Specified as `E26`.* Two limits were removed together, because either alone is incoherent: the
zoom floor was `fitScale`, and `reflow()` never let a free frame exceed the picture. So a window
could not be made smaller than the picture it held, and the picture could not be made smaller
than the window — the frame and the picture were welded at the fit.

- **`minScaleFor()` is the floor now**: `MIN_MEDIA` (32px) on the picture's long side, **capped at
  `fitScaleFor()`** so a thumbnail smaller than 32px is never forced to open enlarged.
- **The background is already there.** `reflow()` centres the picture (its existing ox/oy
  branch) and the frame's own colour shows around it; nothing new had to be painted.
- **Every enforcement of the old floor had to go together** — `zoomAt`, `verifyMedia`, the window
  `resize` listener, `upgradeViewer`, and `resizeBy`. Missing one leaves the floor in place on a
  path nobody tests, and the symptom is a zoom-out that silently springs back.
- **`upgradeViewer`'s `userSized` is now `Math.abs(scale - fitScale) > 1e-6`, not `>`.** A view
  deliberately zoomed *out* is as hand-made as one zoomed in, and the one-sided test would have
  let a late upgrade undo it.

### The HOVER preview is POINTER-TRANSPARENT (v0.9.0) — this is the load-bearing decision  · `E1`

`.box` has `pointer-events:none`; `.box.hot` turns it back on, and `layout()` sets `hot` only
when `placed`. Do not "simplify" this back to always-on.

The bug it fixes: with a hit-testable preview, scanning a row of five thumbnails gives ONE
preview. The preview covers thumbnails 2–5, so the pointer never reaches them — no `mouseover`
fires, and the first preview just sits there. The user's words: "If I have a row of 5 images
and I scan my mouse across them, I expect to get 5 preview windows."

The consequences, all of which have to be handled together:

- **`HIDE_GRACE` and `hideTimer` are gone.** The grace existed so the pointer could travel onto
  the preview before it vanished. There is nothing to travel to now, so leaving the image is
  unambiguous and `onOut` calls `cancel()` directly. Re-adding a delay re-breaks scanning.
- **Pinning and dragging are decided by GEOMETRY, not hit-testing.** A press on a transparent
  preview lands on the page beneath, so the `mousedown`/`click` capture listeners test
  `pointInPreview(e.clientX, e.clientY)` against `view` and hand the event to the same
  `onBoxDown`/`onBoxClick` the hit-testable states use — one state machine, two ways in. Those
  handlers must keep their `preventDefault()` + `stopPropagation()`: the press is really on the
  page, and without them a link beneath would follow.
- **Those two listeners live on `CAP_TARGET` (= window), in capture** — moved off `document` in
  v0.16.0, along with `contextmenu`. Per `../CLAUDE.md` that is where a modal "this click is
  mine" mode belongs, ahead of the page and of every sibling userscript on `document`. It is not
  enough on its own: Open Links in New Tab is on window/capture too since its v1.19.0, and two
  listeners on the same node are settled by registration order that the manager owns. So the
  press *also* stamps `<html>` with `data-userscript-click-claim` (`claimClick()`, cleared by
  `releaseClick()` on any press we do not claim), which OLINT v1.24.0 reads during the click.
  `mousedown` always precedes `click`, which is what makes the handshake order-independent — the
  full contract is in `../CLAUDE.md`. Symptom it fixes, reported on imgur: the preview did not
  pin and the link was followed, and it went away if OLINT was disabled.
- **`ours(e.target)` is only ever true once `hot` is set.** Both `onOver` and `onOut` rely on
  that: `ours()` means "on a placed window". Note that since v0.28.0 the backdrop is hit-testable
  across the whole viewport while placed, so `ours()` is true *everywhere* then — which is why
  `onMove` uses `pointInPreview()` geometry rather than `ours()` to decide whether to un-fade the
  status bar. Using `ours()` there would mean the bar never faded again.
- **Nothing inside the frame is clickable on a plain hover preview**, by design — it dies the
  moment you move off the image toward it. Anything that needs clicking (the ⊘, the browser's
  context menu, the resize corners' cursors) belongs to a placed window. **The wheel is
  not an exception either, since v0.31.0**: it goes to the page, which scrolls and takes the
  preview with it. v0.28.0–v0.30.0 made it the frame's on the argument that a wheel needs no
  pointer travel; true, but it meant a preview being up silently disabled scrolling.

Two guards keep a drag from destroying the thing being dragged: `onOver` and `onOut` both
return early while `drag` is set. Scroll cancels a hover preview, and since the wheel is the
page's there again, that fires wherever the pointer is.

**`hot` is set by `layout()` and must be cleared by `hideViewer()`** — v0.9.0 set it and never
removed it, and the symptom is nasty out of all proportion to the fix. `layout()` stops running
once the frame is down, so the box kept `pointer-events:auto` and `cursor:move` at its last
position and size: an invisible full-size rectangle that showed the move cursor, swallowed every
click through its own `onBoxDown`, and made `onOver`'s `ours(e.target)` true so no image under it
would ever preview again. Reported as "a phantom window where the preview used to be"; it needed
one placement to arm and then survived every close. `hideViewer()` clears `box.style.cursor` for
the same reason since v0.28.0 — `onMove` writes it inline over the bands and corners. **The general rule: a class that grants
`pointer-events` must be removed on the same path that hides the element, not on the path that
lays it out.** Fixed in v0.10.0; the browser check is `elementFromPoint` inside the old rectangle
after closing, which must return page content, not `hover-zoom-host`.

## Image actions — the browser's own menu, on a pinned window  · `E9`

**A userscript cannot *open* the browser's context menu.** A dispatched `contextmenu` event is
untrusted and browsers run no default action for untrusted events — the menu is user-agent
chrome, raised only by real input. So "a button that simulates a right click" is not a thing
that can be built, at any price.

**But it can decline to suppress one** (v0.11.0), and that is the answer. On a **pinned** window
`altButton()` returns false, `swallowMenu` stays off, and the browser raises its real menu over
our `<img>` — whose `src` is the resolved full-size URL, so *Save image as…*, *Copy image*,
*Copy image address* and *Open image in new tab* all act on the original. Verified in a real
browser 2026-09-03, including that native chrome does target an `<img>` inside an **open**
shadow root. `B2` (`pinButton:'right'`) already behaved this way and is the test that proved the
mechanism before any of it was built — two right presses, no code.

**Only pinned** (narrowed in v0.12.0). A hover preview is pointer-transparent, so the native menu
there comes up for the thumbnail underneath and offers to save *that*. Since v0.28.0 there is no
middle state to argue about: dragging a window aside places it, so the menu is available the
moment the window is somewhere deliberate. Pinning is the
deliberate "I want to work with this image" gesture, and that is where the menu belongs.

**The ⋮ menu was removed in v0.12.0**, along with `MENU_ITEMS`, `runMenu`, `openMenu`/`closeMenu`,
`flash`, and the clipboard/canvas helpers (`legacyCopy`, `writeText`, `fetchBlob`, `toPng`,
`openTab`). Its Save and Copy ran in page JavaScript and so needed the host to send
`Access-Control-Allow-Origin` — and Copy needed clipboard-write permission on top. Most hosts
send neither and nothing in a page context gets around it, which is why they were reported as
simply not working. **Do not rebuild it.** If image actions are ever wanted somewhere the browser
menu cannot reach, the two that work from page JS are "open in a new tab" and "copy the URL"; the
other two cannot be made to work from here at any price.

The removal took some care, because the menu had hooks in eight places: `isBoxControl()` (now the
X alone), `unplace()`, `onBoxDown()`, `onPinWheel()`, `onPinKey()`'s Escape, `cancel()`, and the
document `mousedown`, `keydown` and `resize` listeners. `node --check` catches none of that — a
leftover `closeMenu()` is a runtime `ReferenceError` in a handler, which fails silently.

### The status bar fades itself out (v0.12.0)  · `E10`

The bar is drawn ON the picture, so on a meme, a screenshot or a comic panel it covers the text
being read. `.cap.idle` sets `opacity:0` **and** `pointer-events:none`, `showBar()` clears it and
arms a `BAR_IDLE_MS` (1000 ms since v0.13.0, 2000 before) timer, and `onMove` calls `showBar()` only when the pointer is over
the window — moving anywhere else lets it fade, which is the point. `resetBar()` in `cancel()`
keeps a closed preview from reopening with a stale class.

**Three timings, and they are deliberately different numbers** (v0.16.0): `BAR_IDLE_MS` (1000) is
how long the pointer must be still before the fade starts, `BAR_FADE_MS` (1200, was 220) is how
long the fade itself takes, and `BAR_SHOW_MS` (120) is the return. The fade is slow because the
whole of it is reaction time and the bar carries the ⊘; the return is fast because it is a control
the user has just asked for and a slow one reads as lag. `.cap` carries the show duration and
`.cap.idle` overrides it with the fade duration, which is what makes the two directions differ.

**A pointer resting ON the bar holds it open indefinitely** (v0.16.0). A still pointer fires no
`mousemove`, so `onMove` cannot notice, and the fade timer is the only thing that can — it calls
`pointerOverBar()` and re-arms itself instead of fading. The test is **geometric** (`pointer`
against `capEl.getBoundingClientRect()`), not a hover state, for the same reason pinning is: on a
hover preview the bar is pointer-transparent and `e.target` is the page underneath. Reported as
the ⊘ disappearing before it could be clicked.

The `pointer-events` half is not decoration: the bar is the move handle, and an invisible move
handle is a trap. Faded, a press where it was pans or moves by the ordinary rule, and moving the
pointer first brings the real handle back. Points that are load-bearing:

- **`.cap.idle` must drop `pointer-events` as well as `opacity`.** Opacity alone leaves an
  invisible move handle across the bottom of the picture, which is the same class of bug as the
  `hot` ghost above — something you cannot see still answering the mouse.
- **`showBar()` is called from `onMove` only when the pointer is over the window** (`ours()` or
  `pointInPreview()`). Calling it on every mousemove would mean the bar never fades while the
  pointer is anywhere on screen, which is not what "after a second" means.
- **The timeout re-checks `view`** before adding `idle`, and `cancel()` calls `resetBar()`, so a
  preview cannot open with a stale class from the last one.

Verified in the pane: `cap` → `cap idle` after a still pointer → `cap` again on a mousemove over
the window; while pinned, `pointer-events` goes `auto` → `none` → `auto` with it. Note the pane
never advances CSS transitions (the zero-frame problem below), so **read the class, not the
opacity** — computed opacity there is stuck at whatever it started as and proves nothing. **Time
the flip with a `MutationObserver`, not a polling loop**: the pane's `setTimeout` runs slow and
each round trip costs ~700 ms, so a poll cannot resolve 1000 ms from 2000 ms. The observer
measured 1318 ms for the 1000 ms timer — the overshoot is the pane, not the code.

## Placed mode  · `E2` & `E13`

Press the preview → it is placed. The backdrop (`.dim.catch`) starts swallowing clicks and
`+` `−` / arrows / drag become a zoom-and-pan surface. It closes on a click outside it or on
Escape. **Not optional** — there is no other thing a press on a
floating preview could mean, so it has no setting; the panel's **How it works** text explains
the controls without offering a switch.

- **Left click pins, right click dismisses a HOVER preview — and `pinButton` swaps them.**
  Dismiss is for "the preview is in my way but my cursor is staying on this image": it takes the
  preview down and records the element in `suppressed`, which `onOver` skips until `onOut` sees
  the pointer actually leave it. Without that, the next mousemove just re-shows it. The right
  press is claimed in the document `mousedown` handler, not on `contextmenu` — mousedown fires
  first and would otherwise `cancel()` and clear `active` before the menu event could see what to
  dismiss; `swallowMenu` then suppresses the menu itself.
- **On a PLACED window right-click is the browser's**, not ours — see the image-actions section
  for why. `altButton()` returns false when `placed`, which is what leaves `swallowMenu` off. Do
  not "tidy" that early return into a dismiss: it is the whole feature, and since v0.28.0 it is
  also the only right-click behaviour a placed window has.
- **While placed, the left button always drives the window**, whatever `pinButton` says, so a
  placed frame closes via a click outside or Escape — under both button maps. Do not wire
  dismissal onto the button that resizes, moves and pans.
- **There is no close BUTTON** (v0.34.0). The X was removed because a placed window already has
  two ways out that need no aim, and the button sat in the top-right corner — the corner the hand
  reaches for to resize or move. `closeEl`, the `.x` CSS, its `layoutChrome()` placement and its
  entry in `isBoxControl()` all went together; the ⊘ is the only control left inside the box.
- **The preview opens beside the pointer, then is nudged just far enough to touch it**
  (`nudgeIntoReach`, `REACH_INSET` 10px). v0.4.0 centred it on the cursor, which solved
  reachability but moved the preview much further than needed. The nudge is ~34px with the
  default 24px gap, and only on the axis that needs it. (A frame clamped away from the cursor at
  a window edge used to be covered by `HIDE_GRACE`; there is no grace period since v0.9.0, and
  the preview being pointer-transparent is what makes that safe.)
- **The status bar always moves the frame** (`drag.mode === 'move'`); the edges and corners
  resize; the middle pans if the picture is spilling and moves the frame if it is not. All of
  them go through the same `drag` object in `onMove`. The bar is the title bar: once the picture
  spills it is the only thing left that moves the window, which is why `showStatusBar: false` is
  a real trade.

- **`bottomReserve` is retired (v0.33.0), and `usableHeight()` is now just the viewport.** The
  browser paints link addresses and "Waiting for…" along the bottom of the content area, over
  anything we draw, and 30px were kept clear for it from v0.17.0. That earned its place while a
  preview was clamped inside the browser window: the status bar could end up permanently under
  that chrome with nothing the user could do. A window can be dragged anywhere and resized freely
  now, so the answer is to move it — and the reserve's only remaining effect was to stop the bar
  reaching the true bottom of the screen, reported as the bar not following the window down.
  `usableHeight()` survives as the single place that answers "where is the bottom", because the
  size cap, the opening position and `clampPosition()` must not disagree. It floors at 64px: the
  Browser pane reports `clientHeight` **0** while hidden.
- **The frame grows before the image spills — until a hand resize pins it** (see the wheel
  section above). Zooming a placed window enlarges the frame, about the pointer, up to
  `maxSizeMultiple` × the viewport; past that the zoom overflows it, which is when `pannable()`
  (and the `grab` cursor) turn on. Dragging an edge pins the frame there and every later zoom
  overflows it instead. Zoom-out floors at `minScaleFor()` since v0.30.0, not at the fit;
  `fitScaleFor()` is still what `0` returns to — fit-to-window while the frame is free,
  fit-to-frame once it has been resized by hand.
- **Key and wheel listeners live on `CAP_TARGET` (= `window`), in capture** — per
  `../CLAUDE.md`, that beats every document-level listener on the page and in sibling
  userscripts, so arrows and `+`/`−` are ours while placed and nobody else's. Keys are added in
  `place()` and removed in `unplace()` against that one constant; `wheel` uses the shared
  `WHEEL_OPTS` object for add *and* remove, or the removal silently no-ops.
- **The wheel belongs to the frame only while PLACED** (v0.28.0 made it both states; v0.31.0 put
  it back). `enableWheelZoom()` is called from `place()` and `disableWheelZoom()` from `cancel()`,
  one flag so add and remove cannot drift. It is bound **on demand, not for the life of the
  script**: this is a non-passive capture listener on `window`, and leaving one attached makes
  every wheel event on every page cancellable for nothing. `onPinWheel` claims it only when the
  pointer is actually over the frame — `pointInPreview()` geometry rather than the hit test,
  because `e.target` is the shadow host — so a wheel anywhere else still scrolls.
- **In the frame's MIDDLE a drag pans only while the picture is spilling; otherwise it moves
  the frame** (v0.10.0) — with the status bar always moving it whatever the zoom.
  Before this the placed branch was `'pan'` unconditionally and the press was simply dropped when
  `pannable()` was false, so a placed frame at `fitScale` could not be dragged at all.
  `pannable()` is read per press, so zooming in and back out restores dragging with no state to
  keep in step.
