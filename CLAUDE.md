# Hover Zoom — project notes

A single-purpose replacement for the Hover Zoom+ browser extension. **Pictures only** — no
galleries, downloads, or action keys, by design. It said *images* only until v0.18.0; the preview
may now be a muted looping clip, because a large class of animated posts has no image form at all
and "no video" meant "no answer" for them. That is a display capability, not a change of purpose:
nothing here plays sound, offers controls, or previews a video *player*. Inherits the shared rules in
`../CLAUDE.md` (version bumps, commit+push, no `innerHTML`, `#89b4fa` checkboxes).

> **[`INTERACTION.md`](INTERACTION.md) is the behavioural spec for the preview window** — every
> state, transition, terminator and known edge, each with a permanent ID (`S07`, `T12`, `E1` …).
> The user cites those IDs in conversation, so read it before discussing or changing window
> behaviour, and keep it current when behaviour changes. This file holds the *reasons*;
> `INTERACTION.md` holds the *behaviour*. Where they overlap, do not let them drift.

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

- **Nothing is decided before hover time.** Two delegated listeners on `document`; everything
  resolves when the pointer arrives. This is the whole architectural difference from HZ+ and it
  removes an entire bug class (lazy-loaded src, SPA navigation, images added after load, scan
  races). Do not add a MutationObserver or a pre-pass "for performance", and never bind state to
  an element that might change under it.
  *(Previously worded "no DOM scanning, ever", which reads as a ban on ever querying the document
  and is broader than the thing being protected — a read performed AT hover time, binding
  nothing, has none of those failure modes. See the Google Images section for where the
  distinction actually bites, and `coveredMedia()` for one that is squarely inside the rule: a
  hit-test of the pointer's own position, done at hover time, caching nothing.)*
- **No format allowlist.** Extension never decides eligibility. The only gate is
  "is the candidate actually bigger than what's displayed", measured by loading it — with one
  deliberate exception since v0.19.0: a candidate the linked page *declares* is not a guess and
  is not size-checked. Everything the script infers for itself still faces the gate.
- **No hardcoded size caps.** `minDisplayed` / `maxDisplayed` / `minRatio` are settings; the
  defaults are 48 / 0 (off) / 1.2.
- **Per-element probe state.** No shared lock, no `.one()`. `probeCache` is keyed by URL and
  every probe has both `onload` and `onerror`.
- **Build UI with `createElement` + `textContent`.** Trusted Types CSP sites (YouTube, Google)
  throw on `innerHTML` and abort the function mid-build with no visible error.
- **`view` + `reflow()` + `layout()` own all viewer geometry.** `view` is the only state,
  `reflow()` derives frame size and clamps the pan offsets, `layout()` is the only thing that
  writes to the DOM. Nothing else may set `box`/`img` styles or the two representations drift.
  Since v0.18.0 the frame has two possible faces and `layout()` writes to whichever `mediaEl`
  points at — the rule is unchanged, only what it writes *to* is.

## Two viewer states: hover → placed (v0.28.0)

*Behaviour is specified in [`INTERACTION.md`](INTERACTION.md) (`S05`, `S10`, and the rules `R1`
and `R2`). What follows is why it is built that way — keep the two in step.*

- **Hover** — transient. Opens beside the pointer. Held open by ONE thing: the pointer being
  over the source image. Leaving that image takes it down **at once**, with no grace period.
  A wheel over it grows the whole window (see below).
- **Placed** — one press: a click, a drag, or a corner grab, all the same gesture. Held open by
  NOTHING; it ends only on the X, Escape, or a click outside it. Position becomes free, the size
  freezes, and the page underneath stays readable and scrollable.

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

### The wheel PLACES it and grows it; MOVING it freezes the size (v0.28.0, refined v0.29.0)

*Specified as `E22`.* The reported problem: on a page whose pictures are all small, every preview
opens small, and "resize each one by hand" is not a workflow.

So `reflow()` has two modes, switched by `view.fixedW`/`fixedH` being null or not:

- **Frame free** — `frameW = min(imgW, growBox().w)`. The frame follows the picture, so the wheel
  makes the whole window bigger, up to `maxSizeMultiple` (2×) of the browser window.
- **Frame frozen** — `frameW = view.fixedW`. The wheel then zooms the picture *inside* a fixed
  aperture, which spills and pans. Only `resizeBy()` changes it after that.

**Two things switch that, and v0.29.0 separated them deliberately.**

- **`onPinWheel` calls `place()`.** A wheel over the frame is a deliberate act on it, so it earns
  the same promotion a press does. Without this, growing a preview was a gesture nobody could
  finish: it was still hover-held, so moving the pointer *towards the window you had just
  enlarged* killed it.
- **`freezeSize()` is called from the MOVE, not from `place()`.** Putting the window somewhere is
  the moment its size is settled; until then the wheel keeps growing it. `MOVE_SLOP` (3px) so a
  hand shaking during a click does not count as putting it somewhere.

A window placed by a click and never moved keeps growing on the wheel until it reaches the
ceiling, where the frame stops and the picture spills anyway — a longer road, not a dead end.

**`fitScaleFor()` exists because of this.** The zoom floor and what `0` returns to used to be
"fit the window"; on a frozen frame it has to become "fit the FRAME", or `0` on a window the user
sized by hand would spring it back to the window's shape and throw the size away.

**`upgradeViewer()` reads `userSized` against the OLD fit, before recomputing it.** A hover
preview that has been wheel-grown must hold its on-screen size exactly as a placed one does —
missing that case means a late upgrade quietly undoing the sizing just done by hand. Getting the
ordering wrong here compiles and silently does the wrong thing.

**The known cost, and it is the change most likely to be felt:** while a hover preview is up, the
wheel no longer scrolls the page. `nudgeIntoReach()` puts the cursor inside the frame, so the
wheel is nearly always claimed. Scrolling means moving off the image — which takes the preview
down at once — then scrolling. This buys one rule covering both states (*a wheel over the frame is
the frame's, anywhere else is the page's*), and reverting it is one condition in `onPinWheel`.

### Free positioning, and the status bar as the title bar (v0.28.0, settled v0.29.0)

*Specified as `E21`.* `clampPosition()` was not deleted, it was **loosened** — deleting it strands
a window dragged fully off screen, and strands one at `left: 1500` the moment the browser is
narrowed to 1200. It now guarantees only that `KEEP_ON_SCREEN` (72px) stays in view per axis.

`hitRegion()` is two rings and nothing cleverer, which is the v0.29.0 correction: **corners and a
`RESIZE_BAND` (12px) edge strip resize; everything else is the middle**, which moves the frame or
pans the picture by the old rule.

**The move band is gone, and it is worth knowing why it existed.** v0.28.0 put a second,
move-only band just inside the resize strip so a window dragged half off screen always had
something to drag it back by. Two bands within 30px of each other is a mis-grab waiting to happen,
and it made the edge mean two different things depending on a number nobody can see. **The status
bar is the answer instead** — it moves the frame whatever the zoom, which is exactly a title bar's
job, and once the picture spills it is the only handle that moves rather than pans or resizes.

So `showStatusBar: false` is a real trade, not a cosmetic one: a spilling frame with no bar can be
resized and panned but not moved, and Escape is the way out. Say that in the setting's
description; do not quietly re-add a move band to paper over it.

**`stickBar()` exists because the bar being the only handle is otherwise not enough.** Found while
verifying v0.29.0: grow the frame past the viewport, then keep zooming until the picture spills,
and the frame covers the entire screen — no edge, no corner, the middle pans, and the bar is
below the bottom of the window. Every gesture available is a pan; only Escape gets out. It is
reachable by doing nothing but scrolling, which is the intended flow. So the bar is positioned
against the bottom of the frame's *visible* part rather than its own bottom, which is the same
guarantee a window manager makes about a title bar. Measured: a 2512 × 1492 frame at (−637, −368)
on a 1265 × 785 viewport, own bottom edge at 1124, bar held at 726.

**Two precedence problems came with it, and both are in `onBoxDown`.** The bar normally sits
inside the bottom `RESIZE_BAND`, so `hitRegion()` would claim its lower half for a resize — on
the one control whose entire job is moving the window. `onBar` is therefore tested FIRST and
suppresses `hitRegion()` entirely, and `onMove` skips the resize cursor over it for the same
reason. The cost is that the bottom edge cannot be resized where the bar covers it; the bottom
corners and the other three edges still can, which is what any window with a docked title bar
does. `resetBar()` clears the offset, or the next preview opens with its bar floating up the
picture.

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
once the wheel has grown it past the window.

### A drag outlives the frame and the browser (v0.29.0)

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

### `maxSizeMultiple` replaces the two percentages, and 2× is a geometric argument

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

### Edge and corner resize: what the picture does depends on what it was doing

*Specified as `E23`.* `resizeBy()` sets the frame directly with the opposite edge anchored, and
then:

- **Picture at fit** → stays at fit, so the picture grows with the window. This is what "stretch
  it to the size I want" means; letting the frame grow grey bars instead would be a worse answer.
- **Picture spilling** → the scale is kept and the aperture simply shows more. Rescaling here
  would undo a zoom asked for deliberately.

`drag.spilling` is captured at **grab time**, not read per move, or the gesture would change
character halfway through as the frame passed the picture's size.

Aspect locks to `drag.aspect` — the frame's shape when the edge was grabbed — rather than to the
picture's, which would snap the frame the instant it was touched. Shift frees it.

**`ex`/`ey` may each be null, and that is what makes an edge a one-axis corner** rather than a
separate gesture: a `null` axis is left alone by the mouse and then filled in by the aspect lock.
Without the lock an edge drag would just grow grey bars, which is why locked is the default here
and Shift is the escape. On the axis not being dragged the frame grows about its **centre** —
anchoring it to top or left instead makes the window crawl diagonally while you pull one edge
straight.

### The HOVER preview is POINTER-TRANSPARENT (v0.9.0) — this is the load-bearing decision

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
  moment you move off the image toward it. Anything that needs clicking (the X, the ⊘, the
  browser's context menu, the resize corners' cursors) belongs to a placed window. The wheel is
  the exception, and always was: it needs no pointer travel, which is exactly what makes
  growing a preview before placing it possible (v0.28.0).

Two guards keep a drag from destroying the thing being dragged: `onOver` and `onOut` both
return early while `drag` is set. Scroll still cancels a hover preview — but note that a wheel
over the frame is claimed for zoom and never reaches the page, so in practice that fires only
for a wheel somewhere else.

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

## A `<video>` is a PLAYER or a GIF, and only a player suppresses (v0.17.0)

Every gate below asks "is there a `<video>` involved". That was too blunt, and the user's own
framing is the correction: a site **dedicated to video** has a listing page and, behind each
entry, a page holding one player with a play button, a volume slider and a quality menu — no
previews wanted anywhere on it. A site like **imgur's gallery or gifwow's grid** shows a wall of
short muted clips *already playing*, with no controls and nothing to click but the link
underneath — those are animated pictures that happen to be encoded as video, and the page is an
ordinary picture page where previews belong. Clicking one leads to a player page, which is the
first kind again and is still refused.

`gifLike(v)` is the test, and **all four properties are required**, because each alone has a
false positive:

- **no `controls`** — false on YouTube too, which draws its own chrome.
- **`muted`** — true of any player started under an autoplay policy.
- **`loop` or `autoplay`** — says nothing about length on its own.
- **duration ≤ `GIF_MAX_SECS` (60), and known.** This is the one that carries the argument: a
  clip that loops in under a minute is not something you sit and watch. An **unknown** duration —
  metadata not in yet, a cued player never started — reads as PLAYER, which is the safe direction
  to be wrong in, and it is what keeps test case 18's empty `<video>` (duration `NaN`) refused.

It is applied in exactly two places, and both matter: `videoSurfaces()` lists a gif but flags it,
so `overVideoSurface()` skips it *and no player box is derived from it*, and the structural
ancestor walk goes through `playerIn()` rather than `querySelector('video')`. The debug line still
prints every video on the page, gifs labelled as ignored — a gate that silently stops considering
something is the kind of thing the log exists to make visible.

**What this deliberately cannot do is judge the destination.** A muted, playing, controls-less
clip on a video site's *listing* page is pixel-for-pixel the imgur shape; nothing in the DOM
separates them, and the ancestor-link gate is the only signal left for that case. That is why the
link gate stays exactly as it was.

Measured 2026-09-03 while building this: gifwow's grid is `<picture>`/`<img>` webp with `/go/…`
links and **no `<video>` at all**; its item page is one `<video autoplay muted>` mp4 with a poster
and **no controls** — a gif by this rule, which is right, because the 90×90 thumbnails beside it
are ordinary images. Imgur's gallery grid measured as `<img>` throughout in that browser.

Cases 21 and 22 on the test page are the same card twice and differ **only** in the `controls`
attribute — 21 must preview, 22 must not. The fixture is a real 2-second silent mp4
(`test-images/clip-2s.mp4`, generated by `make-test-images.py` via ffmpeg and committed, so a
clone without ffmpeg still has it) because the gate reads `duration` and an empty `<video>`
reports `NaN`.

**This paragraph used to say an imgur-style `<video>` grid item was still refused as a *source* by
`NEVER`, and to ask before changing it. Fixed in v0.20.0 — and it is left here as the record of
how it went wrong: that limitation made the whole of v0.18.0 and v0.19.0 unreachable on the exact
site they were built for, it was written down rather than fixed, and the user found it by hovering
a gif and getting nothing. See "A playing clip is a hoverable picture" below.**

## Videos are never previewed (v0.9.0)

"Images only" was a stated invariant that nothing actually enforced — a video thumbnail is a
plain `<img>` and previewed like any other. Reported on YouTube: "when I go to click a video,
I get a preview." Four gates, in `eligible()` / `inVideoContext()` / `overVideoSurface()`, any
one sufficient:

0. **Geometry** (v0.10.0, corrected in v0.15.0) — the element's centre lies inside a **video
   surface**: the rect of a laid-out `<video>`, *or* of a player box derived from it. A
   player's poster, cued-thumbnail overlay and endscreen images all occupy that rectangle, so
   this names them exactly whatever the DOM between them looks like. Videos smaller than 2px
   are skipped, so the test page's 1×1 fixture contains nothing and cannot poison a page the
   way an unbounded ancestor walk does.

   **The `<video>`'s own rect is NOT always where the player appears — this cost two rounds of
   debugging.** Measured on a LibreWolf YouTube watch page in the cued (not-yet-playing) state,
   2026-09-03:

   | | rect | top | bottom |
   |---|---|---|---|
   | poster overlay (`.ytp-cued-thumbnail-overlay-image`) | `0,56 1903×798` | 56 | 854 |
   | `<video>` | `0,-742 1903×798` | −742 | 56 |

   The video is laid out exactly its own height **above** the player, touching the poster's top
   edge and overlapping it nowhere. The gate missed by precisely 798px, reported "not a video",
   and the poster previewed. Chrome puts the video where the player is, which is why this was
   Firefox-only and read as a browser bug rather than a geometry bug.

   `videoSurfaces()` therefore also derives the **player box**: walking up to `PLAYER_UP` (3)
   ancestors of each `<video>`, keeping those the video substantially fills. Two bounds, both
   load-bearing:
   - **`PLAYER_FILL` (0.5)** — the video must cover half the ancestor's area. This is what stops
     one `<video>` anywhere on a page from suppressing every image on it, and it is why this
     walk can be anchored at the video and needs no "still one card" img bound.
   - **Not narrower or shorter than the video.** An area test alone admitted a `40×7006` column
     against a `640×360` video in testing. A player box cannot be smaller than the video it
     holds, whatever the area works out to. It `continue`s rather than `break`s — a wrapper can
     be odd while its parent is the real player box.

   Reproduce it with a `<video>` positioned `top:-360px` inside a `position:relative` player of
   the same size, with an `inset:0` background-image overlay: the two rects must not overlap.
   Verified the poster is refused while test cases 1, 9, 19 and 20 still preview and 17 and 18
   stay skipped — run that check with `showEvenIfNotLarger:true` and `minDisplayed:12`, the
   permissive settings the bug was reported under, or the ratio gate hides the result.

1. **`NEVER`** — `VIDEO`/`AUDIO`/`IFRAME`/`CANVAS`/`OBJECT`/`EMBED`/`SOURCE`/`TRACK` are never
   candidates, whatever CSS background they carry.
2. **Structure** — a `<video>` in the element or in up to three ancestors. Exact when it
   fires, but late on a card whose inline player has not been injected yet, which is why (3)
   exists.
3. **The link** — the nearest ancestor `a[href]` matching `VIDEO_LINK_RE` (`/watch?`,
   `/shorts/`, `/embed/`, `/video(s)/`, `youtu.be/`, `.mp4|webm|m3u8|mov|mkv|avi`). This is
   the heuristic, and the one that can be wrong. The asymmetry favours having it: a false
   positive costs one preview that never opens, a false negative is the reported bug. It is
   switchable — `skipVideos`, on by default — and has positive *and* negative cases in
   `test-resolver.js`, which slices the regex out of the script the way the URL tests do.

**That bound is also why gate 0 had to exist.** The bound is applied to an ancestor *before* the
ancestor is tested for a `<video>`, and on a YouTube watch page the player element holds the
video **and** several `<img>`, so the walk ended before the exact structural signal was ever
read — a preview opened over the video you were trying to click. Reordering the two inside the
loop is not the fix: testing the video first re-breaks the test page, because the grid ancestor
holding the 1×1 fixture would then match. The geometric test sits *outside* the walk and leaves
the bound exactly as it was. Found 2026-09-03; the reproduction is a `<div>` holding a `<video>`,
two sibling `<img>`, and the poster nested one level down.

**The ancestor walk must stop at the first ancestor holding more than one `<img>`.** Measured
2026-09-03: without that bound the walk reached the test page's grid, found the single 1×1
`<video>` fixture in case 18, and disabled all nineteen cases. One video anywhere on a page
would otherwise poison every image on it. The bound is "still one card", not a depth count —
depth alone does not distinguish a card from a grid.

Cases 17 (video link), 18 (video in the card) and 19 (an ordinary `/gallery/` link, the
control) exist so a regression shows up as a test-page failure rather than in the wild.

## Image actions — the browser's own menu, on a pinned window

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

### The status bar fades itself out (v0.12.0)

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

## The pointer often never touches the picture — looking through a cover (v0.21.0)

Reported as "gifwow.com does not work; there is some sort of overlay". Measured live on the grid,
2026-09-03, and the overlay is the whole story:

```
div.grid-item > figure > a > picture > img          393×510   the picture
              > figure > figcaption > a[href=/go/…] 393×510   position:absolute, ON TOP
```

`document.elementsFromPoint()` at the middle of the picture returns `[A, FIGCAPTION, IMG, …]` —
the hover target is an **empty anchor covering the whole card**, `eligible()` saw an element with
no `<img>` of its own and no background image, and returned null. No preview, no spinner, nothing
to debug. This is not a gifwow quirk; an absolutely positioned link, a caption layer, a hover
overlay or a click-catcher across the card face is one of the most common ways a thumbnail grid
is built anywhere.

`coveredMedia(el, x, y)` walks the hit-test stack below the target. **Two bounds, and the second
is what keeps it from being dangerous:**

- **Only an `<img>` or a `<video>` is picked up this way, never a CSS background.** This is the
  load-bearing distinction, and it is the answer to "images that are under other images" as an
  *exclusion* rule — which is what it looks like at first. Reaching down through a paragraph onto
  the section behind it is precisely the hero/backdrop case; "content is stacked on top of it" is
  the signal that a background IS a backdrop, and the signal that an `<img>` is a card's picture.
  The same fact means opposite things for the two, and **the element type is the only thing that
  separates them.**
- **Same card:** an ancestor of the cover, within `COVER_UP` (4), that contains the picture and
  contains exactly one *laid-out* picture. This is the "still one card" bound the video gate
  already uses. Without it the walk reaches the grid or the page, and a full-page backdrop `<img>`
  — or an arbitrary neighbour — becomes the answer to hovering anything.
  **Laid-out, not `querySelectorAll(...).length`:** gifwow's card also holds a `display:none`
  loader `<img>`, and counting it bounds the walk one level too early, at `FIGCAPTION`, which
  finds nothing. Test case 30 is the positive side of the bound (two pictures under one cover →
  no preview).

Everything found under a cover then faces `eligibleDirect()` in its own right, so looking through
a cover can never reach something a direct hover would have refused.

**The hold rule needed a second answer** (`activeCovered` / `suppressedCovered`). "Leaving the
image takes the preview down at once" is enforced by mouseout's `active.contains(to)` test — and
the pointer is *never* on a covered picture, so that test says "left" on every crossing between
layers of the same card, closing and reopening the preview. For a covered preview the question is
answered by the stack instead (`stillUnderPointer`). **This is deliberately not used for a direct
hover:** at the exact boundary pixel the stack still holds the image, which would keep the preview
alive a moment too long and cost the one-preview-per-image row scan that pointer-transparency
exists for.

Verified end to end against the real gifwow URLs (the card rebuilt inside the local test page,
because the Browser pane blocks a localhost script from an https origin): hover the cover →
`resolvedFrom: looked through the cover to IMG#… gp-7xx2k.webp` → the existing `/gifs/<id>.mp4`
upgrade rule → a playing 350×621 video in the frame.

**gifwow's own `/go/` page is NOT what resolves it, and that is the `og:url` guard working.**
Measured: `https://gifwow.com/go/gp-7xx2k` declares `og:url` = `https://gifpit.com/gifs/gp-7xx2k.gif`
— a different host and a different path from the one requested — so `pageMediaFrom()` trusts
nothing on it. The URL rule is what carries this site.

## The preview is a completely different picture (v0.22.0)

Reported: a forum whose masthead is a **1200×125 banner** and whose sidebar carries a
**~600×600** picture, both drawn from a pool that rotates daily. Hovering the banner gave the
sidebar image — "and it varies, probably depending on the dimensions that they happen to roll".

**The obvious diagnosis is wrong, and following it cost a round.** "The URL hands out a
different picture each request" is the intuitive story, so the first fix compared the probe
against the element's own `naturalWidth`. Then the fixture would not reproduce the bug, which
is how this got measured, in Chrome 2026-09-03:

```js
for (let i=0;i<4;i++) { const im=new Image(); await load(im,'/rotate.php'); }
// four loads, Cache-Control: no-store  ->  ONE network request, four identical pictures
```

**A browser does not re-request a URL the document is already displaying.** So an unstable
*displayed src* cannot mislead: probe and frame both get the copy already in memory, and the
preview is the same picture the thumbnail is. The case that actually bites is a **different
URL** — `/banner.php` derived from `/banner.php?loc=header` by the generic query-strip rule.
That rolls once, and every later check then agrees with it perfectly while it shows something
unrelated. **General lesson: when a bug story requires the network to be hit twice, measure
that it is.**

Three answers, deliberately at three different depths:

- **The query-strip rule only fires on a path that names a media file.** On `photo.jpg?w=400`
  the query is decoration over a file that exists either way, so dropping it asks for the same
  picture bigger. On `/banner.php?loc=header` the query *is* the request, and dropping it asks
  a different question. This is the fix; the rest are backstops.
- **`sameShape()` — an upgrade has the same shape as the picture it upgrades.** The only cheap
  handle on "is this the thing I pointed at". `ASPECT_TOL` is **4**, and it is loose on purpose:
  a thumbnail is often a *crop* of its original (a square thumb of a 3:2 photo is 1.5× off, a
  16:9 crop of 4:3 is 1.34×) and all of those must pass, while the reported case is 9.6:1
  against 1:1 — 9.6× apart. There is a wide gap between "cropped differently" and "not the same
  picture", and 4 sits in it. A wrong refusal here is silent, so the number errs toward letting
  things through. Applied to guesses **and** to the linked-page answer, which otherwise skips
  every gate — a banner links to the section it heads, and that section's `og:image` is its own
  artwork, a different picture rather than a smaller one.
  Only where a **natural** size exists (`nativeSize()`): a CSS background has none, and its box
  aspect is not the image's, so backgrounds are not judged.
- **`markUnstable()` — a URL caught contradicting itself is refused for the tab.** Two points,
  both free: the probe against the element's own `naturalWidth`, and the frame's own load
  against the probe. Given the measurement above these do **not** fire in Chrome, and they are
  kept for browsers that do re-request (Firefox honours `no-store` more strictly, and this
  project's reports come from LibreWolf). Do not delete them believing they are dead, and do
  not expect the test page to exercise them under Chromium — say so in any note that touches
  them.

**`collectCandidates()` now returns `{ url, from }`, and `from` is the whole point.** There are
six mechanisms that can produce a preview and the log used to print only the winning URL, which
says nothing about which one to go and look at. "The preview is the wrong picture" is
unanswerable without it; with it, one hover with `debug` on names the mechanism
(`"from":"url rule on the displayed src"`, `"the page the thumbnail links to (og: media)"`, …).

Cases 36 and 37 are the two shapes, and both are **verified to fail without the fix**: 37 with
`sameShapeOnly` off shows 600×600, and 36's candidate list contains `/rotate.php` before the
strip rule was narrowed. `test-server.py`'s `/rotate.php` is deterministic on the query rather
than actually random, because a test has to assert which picture came back — per-request
variation is not what makes the bug.

**Still open, and NOT guessed at:** a second report in the same message described a 1000×557
background image near the top of a page, under a bar of links, also rotating daily. It is not
known whether that is a CSS background or an `<img>`, and the two need different answers — a
"large background near the top of the document is a masthead" rule would be pure invention
without the page. Ask before building it.

## The banner across the top of a page (v0.23.0)

Reported: v0.21.0 and v0.22.0 did not fix the two sites they were built for, with a test anyone
can repeat — **youtube.com/@TheOnion**, whose channel banner previews.

**The reason is a boundary I drew and stated too confidently.** v0.21.0's page-furniture rules
were written "CSS backgrounds ONLY, never an `<img>` — a full-width photo with a caption over it
is still a photo". That sentence is right about a photo in the body of a page and wrong about
the one thing above all the content. Every banner that matters is an `<img>`, so every rule was
looking in the wrong place. The measurement was never done; the boundary was reasoned from a
single example and then written down as settled.

Measured on that page, 2026-09-03:

| | |
|---|---|
| element | `<img>` 1193×192, natural 1707×282, inside `#page-header-banner` |
| position | **56 px from the top of the document** |
| `role` / `aria-hidden` | none |
| `alt` | `""` — and so is every video thumbnail's, so it separates nothing |

`alt=""` deserves the note: it is the standard decorative convention and it was rejected in
v0.21.0 as unsafe. This page is why — YouTube ships `alt=""` on the banner *and* on all 23
content thumbnails. There is nothing in the markup. **The geometry is all there is.**

`bannerReason()` is four conditions, and each of the last three exists to kill a false positive
that can be named. Together they flagged exactly one of the 24 images on that page, and zero
after scrolling 1200 px down:

1. **Top within `BANNER_TOP` (200 px) of the top of the DOCUMENT** — above where content
   begins. Document, not viewport, or every picture drifts into the band as you scroll.
2. **At least `BANNER_MIN` (400 px) wide on screen** — kills logos, icons, and YouTube's
   160 px avatar (which sits at 282 and fails this too).
3. **No PEER sits beside it** — a neighbour at least `BESIDE_PEER` (a quarter) of its width.
   A picture with a comparable one to its left or right is one item in a row; a gallery's
   first row is near the top of the document and can be wide, and this is what saves it. A
   banner is a band, alone on its line.
   **"Peer", not "anything", and that word cost a version.** Measured in LibreWolf with
   YouTube's left guide open, 2026-09-04: a **24 px** subscription avatar sits in the band
   beside a 1284 px banner, and the rule refused to call it a banner. An icon in a sidebar is
   not an item in a row with a masthead. A quarter is low on purpose, so a masonry row of
   unequal tiles still protects its widest member.
4. **Fewer than `BANNER_SET_MIN` (2) other pictures share its width** (within
   `BANNER_SIMILAR`, 10 %). Saves a **single-column** gallery, where (3) is useless: tiles in
   a column all share a width, and a banner is unique on its page.
   **Two pictures are not a set** (v0.26.0). A column has members; a masthead plus one other
   picture of its width is a coincidence, and that coincidence was the whole of the second
   reported failure — a 1000×557 forum masthead with exactly one 1000px neighbour. Residual
   cost, stated because it is real: a page whose first two pictures are stacked, wide and near
   the top loses the first. **This is the weakest of the four and the only one invented
   defensively rather than measured — narrow it further before adding anything to it.**

The page-wide scan is only reached once (1) and (2) hold, so an ordinary hover never pays for
it — a large picture at the very top of the document is rare.

**Cases 39 and 40 share one `.case` box on purpose, and 40 must stay inside it.** The rule is
position-sensitive: 40 is the single-column-gallery false positive, and it only tests condition
(4) if its first image starts within 200 px of the document top (measured: 183). Giving it its
own bordered box pushes it past that and the test silently stops testing anything. The banner
above it is forced to `height:60px` for the same reason — its natural 125 px does not leave
room. Verified: 39 refused with the reason printed, 40 still previews.

**`BANNER_TOP` is the knob if a site is missed.** A page with a tall header can put its banner
lower than 200 px, and then nothing fires.

**The in-app browser is not a substitute for the user's window here, and this rule is why.** The
YouTube page was measured twice at 1265 px with the guide collapsed and the gate looked perfect
both times; the failing neighbour only exists with the guide open and an account signed in.
Widening the pane to 1830 px opens the guide but shows no subscriptions when signed out, so the
24 px avatars still never appear. **Case 39 carries the icon at its real scale** because that is
the only place this shape can be re-run.

### The gate has to say WHICH condition decided, and on what numbers (v0.24.0)

Reported immediately after v0.23.0: the banners are excluded in Chrome and Firefox and **not in
LibreWolf**. Every condition above is a geometry read of the user's own page, so the only thing
that can settle a report like that is the operands the gate actually saw on the machine showing
it — and `bannerGate` said `none — not a page banner`, which is exactly the useless answer this
project has run into twice before. Same rule as the video log: **print the operands, not a
summary of one of them.**

`bannerCheck()` returns `{ banner, why }` for both answers, and one hover line reads:

```
"bannerGate": "not a banner: 1193×192 at 812px from the top of the document; a banner starts within 200px of the top"
```

That names the failing condition and the number it failed on, so a cross-browser difference is
one paste rather than a round trip. `bannerReason()` is a thin wrapper for the gate itself.

### One picture, two elements — a cross-fader (v0.27.0)

Pushed back on, and correctly: *"There is only one image at the top of the page. If it is seeing
2 images, then it must be counting the same image twice."*

It cannot count the same element twice — `if (n === el) continue`, and the `img` and `video`
lists are disjoint. But **one picture really can be two elements**, and the way it happens is
specific to the thing this gate judges: a rotating banner is very often a **cross-fader**, two
stacked `<img>` of identical size with the outgoing one at `opacity: 0`. Different URLs, so the
same-src exemption misses them, and:

**`opacity: 0` and `visibility: hidden` both leave a FULL-SIZE rectangle.** The only filter here
was `width >= 2 && height >= 2`, which they pass. So the page holds two 1000px pictures and shows
one, which is exactly what a user looking at their own page will tell you is impossible.

`reallyVisible()` uses `Element.checkVisibility({opacityProperty, visibilityProperty})` where it
exists, falling back to computed style plus a four-level ancestor walk — **opacity does not
inherit**, so a faded *wrapper* leaves the image's own computed opacity at 1. It is called
lazily, only for a picture that would otherwise count, so the computed-style read happens once or
twice rather than for every image on the page.

Case 39 carries two invisible slides (one `opacity:0`, one `visibility:hidden`, different
pictures, banner width). Two of them, so removing the visibility test fails the case outright
rather than merely weakening it — with `BANNER_SET_MIN` at 2, one phantom would not have blocked.

**Also fixed in passing:** `hoverReport` ran `bannerCheck(t)` on the hover *target* while
`eligibleDirect` ran it on `el`. Where a cover had been looked through (`E18`) those are
different elements, so the log described geometry no decision was made about. It is `el || t` now.

**It reports the blocking neighbour's POSITION, not just its width** (v0.26.0). "another
picture on the page is 1000px wide too" cost a full round trip: whether that neighbour is a
column-mate below or a second masthead is the entire question, and the width alone cannot answer
it. A success line reports near-misses too, so a page that is one neighbour away from being
refused says so.

**It reports EVERY blocker, not the first** (v0.25.0). v0.24.0 returned on the first failing
condition, the user's log named condition (3), and fixing (3) would have said nothing about
whether (4) also failed — a second round trip built into the design of the message. The loop now
collects both and stops early only when both are found.

### A copy of itself is not a sibling item

Banners are routinely rendered **twice** — a blurred backdrop behind the sharp one, or a low-res
placeholder left in the tree — and a copy is by definition the same width, so condition (4) was
being defeated by the banner's own reflection. Pictures with the same `shownUrl()` are skipped in
both (3) and (4).

**The trade, and the fixture found it rather than the reasoning:** a single-column gallery of the
*same file repeated* is now refused. Case 40 originally used one image twice out of laziness and
started failing the moment the exemption landed; it uses two different pictures now, because a
real gallery shows different pictures and a banner's twin is the same file. Do not "tidy" case 40
back to one src.

## `showEvenIfNotLarger` must not show a copy of what is already on screen (v0.26.0)

The second reported page's only preview came from here, and the log said so outright:

```
hit (not larger — shown anyway) { url: …/74.jpg, w: 1000, h: 557,
                                  from: "the displayed src itself (shown anyway — not larger)" }
target: IMG, targetRect: "161,60 1000×557"
```

Displayed 1000×557, natural 1000×557, **same URL**. The frame was holding the identical bytes at
the identical scale, floating over the picture they were copied from. `showEvenIfNotLarger` means
"display it at natural size even though it does not clear `minRatio`" — it never meant "display a
pixel-for-pixel copy", and `resolve()`'s fallback had no size comparison of any kind.

The guard is `dim.w <= displayed.w && dim.h <= displayed.h` — no bigger in *either* dimension, so
a picture that is genuinely a little larger still shows under that setting.

**Only the fallback gets this, never the main loop.** The loop's own escape is
`showEvenIfNotLarger && !isSameAsShown`, and a *different* URL at the same pixel size can be a
better answer — that is exactly imgur's `.webp` (static) versus `.jpg` (animated) at 412×360.
Same size, different picture, and worth showing.

Verified with case 13 (an original displayed at its own natural size) and the setting on: no
preview, and one log line saying why. Case 1 still previews, and case 25 — the linked page's
not-size-checked answer — is untouched, because that arrives through `trusted` rather than here.

## What counts as a page background (v0.21.0)

`isWallpaper()` → `wallpaperReason()`, a string like `videoReason()` so `hoverReport` can print
which of the five fired. Two tests were already there (`<body>`/`<html>`, repeat + auto size);
three are new, and each is a **measurement**, not a guess at intent:

- **`background-attachment: fixed`** — it does not scroll with the page. A picture you are meant
  to look at moves with the text beside it; a parallax backdrop does not.
- **Spans ≥ `BAND_WIDTH` (98 %) of the window width** — masthead, hero, section stripe, footer.
  98 % rather than something looser because a gallery tile inside a centred container never
  reaches both edges and a band does by definition. Guard `clientWidth > 0`: the Browser pane
  reports 0 while hidden, and without it *every* element spans a zero-width viewport.
- **Carries ≥ `CONTENT_CHARS` (40) characters of text** — the page's own content is sitting on it,
  so it is a backdrop. The threshold is what lets a tile's caption ("Sunset, 2019") through. Only
  reachable by hovering the element's own blank space, since the text hit-tests first.

**These apply to CSS backgrounds ONLY.** A full-width `<img>`, an `<img>` with a caption over it,
an `<img>` in a `<header>` — all ordinary shapes for a picture that genuinely is the content.

**That boundary was stated as settled and it was too broad — see the banner section above.** It
holds for a picture in the body of a page and does not hold for the one thing above all the
content, which is an `<img>` on every site that has one. `bannerReason()` is the narrow
exception, and it earns it by being four conditions rather than one.

`decorativeReason()` is separate (`skipDecorative`, on) and does apply to `<img>`: `aria-hidden="true"`
and `role="presentation"`/`"none"` are the page stating outright that something is not content.
**Read on the element itself, never inherited** — carousels routinely mark cloned slides
`aria-hidden` and those are real pictures on screen. **`alt=""` is deliberately NOT used** even
though it is the same convention: too many sites ship real content images with an empty or
missing alt, and being wrong here is silent.

**Considered and rejected, with reasons, so they are not re-proposed:**

| Suggestion | Why not |
|---|---|
| class/id matching `/hero\|banner\|bg\|masthead/i` | a guess at intent dressed as a measurement. A wrong exclusion here is **silent** — the picture just stops previewing, with nothing on screen to say why — and this project keeps no allowlist |
| filename patterns (`sprite`, `bg-`, `pixel`) | same, and weaker |
| `alt=""` / missing alt | too many real content images ship without alt |
| extreme aspect ratios (>5:1) | panoramas and comic strips are real pictures |
| "ignore CSS backgrounds entirely" | test case 9 is a legitimate background thumbnail, and this would delete a working feature to fix a narrower bug |
| "require a positive signal (figure, data-full, meaningful alt) before previewing" | inverts the project's premise. The gate here is *is it bigger than what is displayed*, measured by loading it; a positive-signal requirement is an allowlist by another name and would lose the long tail this exists to win |
| minimum size, tracking pixels | already `minDisplayed` (48 px) |
| `background-repeat: repeat` alone | breaks test case 9 — repeat is the CSS *default*, so `background-size: cover` computes to it. It is repeat **and** `auto` together that mean tiled |

## Images the user has ruled out — the ⊘ button and `blockList` (v0.13.0)

Reported: a page whose background is one image **tiled** previews that tile from every patch of
blank space on the page. Two mechanisms, because neither covers the other.

**Automatic — `skipPageBackgrounds` (on).** `wallpaperReason()` skips `<body>`/`<html>`, and any
element whose background both repeats *and* has an `auto` size — plus, since v0.21.0, three more
tests listed in the "What counts as a page background" section above.

- **Repeat alone is NOT the test, and getting this wrong breaks a shipped case.**
  `background-repeat: repeat` is the CSS *default*, so a hero image that sets only
  `background-size: cover` computes to `repeat` too. Test case 9 is exactly that shape —
  measured `repeat` + `cover` — so a repeat-only rule kills it. It is repeat **and** `auto`
  together that mean the image is being laid out at natural size and stepped across the element,
  which is the thing being described.

**Manual — the `⊘` in the status bar, and the `blockList` setting.** Anything the automatic rule
cannot know about: a watermark, a sprite sheet, one specific image that is simply not wanted.

- **`blockCurrent()` records TWO urls** — `view.url` (what is on screen) and `activeShown` (the
  source element's own src). They differ whenever the preview is an upgrade, and blocking only
  the resolved one leaves the thumbnail still opening a preview that then fails to upgrade.
  `activeShown` exists solely for this and is cleared in `cancel()`.
- **The button is only on a PLACED window** (`.box.hot .cap .block`), for the same reason the X
  is: a hover preview is pointer-transparent, so a button on it cannot be clicked at all. The
  flow is hover → click to pin → ⊘. The panel's `note()` row says so, because it is not guessable.
- **It goes in `isBoxControl()`.** That is the documented capture-listener trap — a control inside
  the box whose events `onBoxDown`/`onBoxClick` eat first, and the symptom is silence, not an
  error. Verified by dispatching a real click at the button and watching the list change.
- **`blockCurrent()` calls `reloadSettings()` first.** The list is the one setting written from
  *outside* the panel, so it is the one place a stale in-memory `cfg` would silently drop another
  tab's entries — the same staleness bug as the settings panel, arriving by a different door.
- Entries are exact URLs, or globs when they contain `*` — which is what a background carrying a
  cache-busting query needs, since its URL is never twice the same. `blockMatch()` is pure and
  sits **inside the slice `test-resolver.js` evaluates**, so the matching is tested offline like
  the URL rules. It escapes regex metacharacters: an unescaped `?` or `.` in a URL would quietly
  widen the match, and **a wrong match here is silent** — the image just stops previewing, with
  nothing on screen to say why. Same discipline as `UPGRADES`: the negative tests matter more.

Blocking is checked in three places, and all three are needed: `eligible()` (so no spinner even
flashes), `collectCandidates`' `add()` (so a blocked URL is never *probed*), and the
`showEvenIfNotLarger` fallback in `resolve()`.

## Diagnostics — the `debug` setting (v0.13.0)

Off by default and silent when off. It exists for the one class of bug that cannot be reasoned
about from the source: **"it behaves differently in my browser than in yours."** Every gate in
this script is a DOM read, so only the DOM in front of the user can say which one fired.

- `dbg('loaded', …)` at boot prints the **installed version**, via `GM_info.script.version` so it
  cannot drift from the header. The settings panel shows the same string in its heading. For a
  "works in Chrome, not in Firefox" report, *is the installed copy even current* is the first
  question and this is how it gets answered without opening the manager.
- `hoverReport()` prints one line per hover: what was under the pointer, `videoGate` (which of the
  four video rules fired, or none), whether an `<a href>` ancestor was findable **at all**, how
  many laid-out `<video>` elements the page has, and whether the element sits in a shadow root.
- `videoReason()` returns a *string* rather than a boolean for exactly this — `inVideoContext()`
  is now a `!!` wrapper over it. Keep it that way; a boolean cannot be reported.

Two lessons from reading the first real report back (2026-09-03, v0.14.0 fixed both):

- **Every path that paints a preview must log.** `resolve()`'s `showEvenIfNotLarger` fallback
  called `onHit` with no `dbg('hit', …)`, so a hover that *did* show something produced no `hit`
  line at all. A log with a silent success path is worse than no log: it reads as positive
  evidence that nothing was shown. The boot line now also prints `showEvenIfNotLarger`,
  `minRatio` and `minDisplayed`, because "no hit line" means nothing without them.
- **Print positions, not just sizes.** The first `hoverReport` logged `1903×798` for the page's
  video and left the actual question unanswerable — gate 0 tests the element's centre against the
  video's *rectangle*, so a video of exactly the right size sitting somewhere else looks identical
  in the log to one directly under the pointer. Each video now prints `x,y w×h` plus its own
  verdict (`[CONTAINS the pointer target]` / `[does not contain it]` / `[too small, skipped]`), so
  the gate's decision is readable rather than inferred. General rule: **log the operands of the
  comparison, not a summary of one of them.**

**`closestAcross()` — `closest()` does not cross a shadow boundary.** Neither does
`parentElement`. A site that builds its cards from custom elements can put the `<img>` inside a
shadow root and the `<a>` that wraps it outside, and the video-**link** gate then sees no link at
all and cannot fire. The composed walk (ordinary `closest()`, then hop to `getRootNode().host` and
continue) is what the gate uses now. This is a real gap regardless of which browser exposed it;
`collectCandidates` still uses plain `closest()` and is a candidate for the same treatment if an
ancestor-link candidate ever comes back missing on a shadow-DOM site.

## Placed mode

Press the preview → it is placed. The backdrop (`.dim.catch`) starts swallowing clicks, an X
appears (`.box.placed .x`), and `+` `−` / arrows / drag become a zoom-and-pan surface. It closes
on the X, a click outside it, or Escape. **Not optional** — there is no other thing a press on a
floating preview could mean, so it has no setting; the panel carries `note()` rows that explain
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
  placed frame closes via the X, a click outside, or Escape — under both button maps. Do not wire
  dismissal onto the button that resizes, moves and pans.
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

- **The bottom 30px of the window belong to the browser** (`bottomReserve`, v0.17.0). The link
  address under the pointer, "Waiting for…", the download bar — the browser paints those along the
  bottom edge of the content area, on top of everything the page draws, so a frame clamped to the
  true bottom has its last rows covered by chrome no script can see. The reserve is subtracted
  **once**, at the top of `viewportBox()`, so the size cap, the opening position, `clampPosition()`
  and the floating spinner all inherit it and cannot disagree about where the bottom is; a second
  subtraction anywhere else would double it. The opening size is therefore measured against the
  *usable* height, which is why raising the reserve shrinks the preview instead of pushing it off
  the screen. It survived the v0.28.0 free-positioning work deliberately: losing the clamp does
  not remove the need to *place* a preview well, and the browser still paints there.
  `usableHeight()` floors at 64px: the Browser pane reports `clientHeight` **0** while
  hidden, and without the floor the reserve would make the viewport negative.
- **The frame grows before the image spills — but only while HOVERING** (changed in v0.28.0; see
  the wheel section above). Zooming a hover preview enlarges the frame up to `maxSizeMultiple` ×
  the viewport; placing freezes it, and from then on zoom overflows the frame, which is when
  `pannable()` (and the `grab` cursor) turn on. Zoom-out floors at `fitScale`, which is
  `fitScaleFor()` — fit-to-window while the frame is free, fit-to-frame once it is frozen.
- **Key and wheel listeners live on `CAP_TARGET` (= `window`), in capture** — per
  `../CLAUDE.md`, that beats every document-level listener on the page and in sibling
  userscripts, so arrows and `+`/`−` are ours while placed and nobody else's. Keys are added in
  `place()` and removed in `unplace()` against that one constant; `wheel` uses the shared
  `WHEEL_OPTS` object for add *and* remove, or the removal silently no-ops.
- **The wheel belongs to the frame in BOTH states** (v0.28.0; it was placed-only before).
  `enableWheelZoom()` is called from `showViewer()` and `disableWheelZoom()` from `cancel()`, one
  flag so add and remove cannot drift. It is bound **on demand, not for the life of the script**:
  this is a non-passive capture listener on `window`, and leaving one attached makes every wheel
  event on every page cancellable for nothing. `onPinWheel` claims it only when the pointer is
  actually over the frame — `pointInPreview()` geometry rather than the hit test, because on a
  hover preview `e.target` is whatever is on the page underneath — so a wheel anywhere else
  still scrolls, in both states.
- **In the frame's MIDDLE a drag pans only while the picture is spilling; otherwise it moves
  the frame** (v0.10.0) — with the status bar always moving it whatever the zoom.
  Before this the placed branch was `'pan'` unconditionally and the press was simply dropped when
  `pannable()` was false, so a placed frame at `fitScale` could not be dragged at all.
  `pannable()` is read per press, so zooming in and back out restores dragging with no state to
  keep in step.

## The list editor matches the sibling scripts (v0.16.0)

`siteList` and `blockList` were raw textareas with a button row underneath. They are now the same
widget Open Links in New Tab uses — description, an italic examples line, `input` + blue **Add** +
green **+ This Site**, then the entries as rows with a `✕` — because these panels are read side by
side and a second dialect of the same control is a cost with no benefit. Colours come from the
shared palette (`#89b4fa` Add, `#a6e3a1` add-current, `#313244` rows, `#f38ba8` remove).

**One deliberate difference from OLINT: entries stage in a local array and reach storage only on
Save**, like every other control on this panel. OLINT's lists write straight through, which is
right there because it has no Save button; copying that here would make Cancel a lie.

`list(key, opts)` returns `{ items, clear }` rather than the old textarea element, so *Clear all*
calls `blocks.clear()`. `addLine()` is gone. Removal is **by value, not index** — entries are
unique because `add()` dedupes, and an index would be wrong the moment display and storage order
disagree.

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
nothing. Both handlers now `return` early on **`isBoxControl(e.target)`**, which is the one list
of exempt controls — just the X now that the ⋮ button is gone. Any new control placed inside it goes in
there — it is not optional, and the symptom is silence. Found 2026-09-03 in browser testing; nothing
static catches it — `node --check` passes and the markup is fine.

## Testing

```bash
node --check Hover-Zoom.user.js     # syntax
node test-resolver.js               # 114 assertions on the pure URL and video-link logic
python make-test-images.py          # regenerate fixtures into test-images/
```

Browser test: `python test-server.py`, then open `http://localhost:8899/test-page.html`. 39 cases,
11 of which HZ+ rejects outright. (`.claude/launch.json` wraps the same command as
`hover-zoom-test`, but `.claude/` is gitignored — a fresh clone has only the direct command.)

- **Cases 29–35 are the v0.21.0 gates**, and 30/31 are the ones that fail loudly if the cover
  walk is loosened: 30 puts two pictures under one cover (must show nothing), 31 puts text over a
  background (must not reach through to it). 35 lives **outside** the `.grid`, because the whole
  point of it is spanning the window — inside a `.case` box its padding put it at 98.26 % of the
  viewport, passing the 98 % test by 0.3 % and proving nothing.
- **To test a real site's card shape without installing anything, rebuild it in the test page.**
  The Browser pane blocks `http://localhost` requests from an `https` origin
  (`ERR_BLOCKED_BY_CLIENT`), so the script cannot be injected into a live site from here.
  Constructing the site's markup with its real cross-origin URLs inside `test-page.html` at
  runtime exercises the entire pipeline — cover walk, `UPGRADES`, the video probe — against the
  actual files. That is how gifwow was verified.
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
- **Case 20 is the only case where a progressive upgrade is VISIBLE**, and it exists because
  "it never upgrades" was reported as a bug. Its `data-src` is probed first and already clears
  the gate, so the preview opens at 800×600; the ancestor link is bigger again but carries
  `?slow=3`. Measured: preview at 1085 ms, ring docks at 2077 ms, swap to 1600×1200 at 4400 ms.
  Every other upgrade on the page resolves inside one frame, which is exactly why the feature
  looks absent in normal use — see `INTERACTION.md` `E8`.
- **`test-server.py` honours `$PORT`** (default 8899) and `.claude/launch.json` sets
  `autoPort: true`, so two sessions can each run their own copy. Without that the second
  session's `preview_start` just fails on the first session's server, which it cannot stop.
- **The Browser pane's screenshots came back blank/stale for a whole session** (2026-09-03)
  while `document.elementFromPoint` proved the content was there — same family as the
  zero-rAF problem below. Verify by reading DOM state and computed style, not by looking.
  Also note the pane letterboxes the emulated viewport: screenshot coordinates were 800×446
  against a 1280×720 CSS viewport, a 0.625 scale factor that must be applied to every
  coordinate taken from `getBoundingClientRect()`.
- **Driving the script with synthetic `MouseEvent`s works and is far cheaper than coordinates.**
  Nothing checks `isTrusted`, so `dispatchEvent` on the element (plus a `mousemove` on `document`
  to set `pointer`) exercises the real handlers — including the pointer-transparent place path, by
  dispatching `mousedown`/`mouseup`/`click` at `document` inside the frame's rect. Do the whole
  sequence in **one** `javascript_tool` call: each round trip to the pane costs ~700 ms, which is
  longer than most of the timings being measured.
  - **Once the window is PLACED, dispatch into the shadow root, not the document.** A placed
    window is hit-testable, and `document.elementFromPoint` returns the shadow **host**, whose
    events never propagate down to `.box` — so `onBoxDown` never runs and the drag silently does
    nothing. Use `host.shadowRoot.elementFromPoint(x, y)` first and fall back to the document.
    The geometry handoff in the window `mousedown` listener only covers the `!placed` case, by
    design, so nothing catches this for you. Cost 20 minutes on 2026-09-04.
  - **Check the grab point is actually on screen before dispatching.** A placed window may hang
    off the edges now, so a point computed from its rect is routinely negative or past the
    viewport; `elementFromPoint` returns null there, the event goes to `body`, and the test reads
    as a broken feature. Assert `0 <= x < clientWidth` in the helper.
  - **`dismiss()` sets `suppressed`, so the same case will not re-open.** Two consecutive tests
    on case 1 make the second look like a regression. Use a different case, or move the pointer
    off and back first.
- **`.case` DOM order is NOT case-number order** — cases 15 and 16 are swapped in the markup. Find
  a case by its heading text, never by array index; an index-based probe reports the wrong case's
  result and case 15 stalls 3 s on purpose, so it reads as a failure at any shorter wait.
- **Clear `blockList` between browser test runs.** It persists in `localStorage`, and the fixtures
  share image files — blocking case 1 also silences cases 16 and 19, which then look like
  regressions. Cost 10 minutes chasing exactly that on 2026-09-03.
- **A synthetic sweep of all 20 cases needs a wait longer than the first COLD probe, or the
  early cases read as failures that are not there.** A 700 ms-per-case loop on a fresh load
  reported cases 1–4 and 10 as showing nothing; each of those resolves to a 1600×1200 original
  that had never been fetched, and every later case reusing `photo.jpg` passed off the warm
  `probeCache`. Re-hovering any of them alone at 2 s showed the full-size image. The tell is that
  the failures are exactly the cases that are FIRST to want a given file — if a "regression" set
  looks like that, lengthen the wait before believing it. Two or three cases per
  `javascript_tool` call: the pane's timers run slow when it is hidden and a 20-case sweep hits
  the 45 s tool timeout.
- **The Browser pane reports `innerWidth`/`innerHeight`/`clientWidth`/`clientHeight` as ZERO
  while it is hidden** — `getBoundingClientRect()` on ordinary elements keeps working, so nothing
  looks broken and every viewport-relative measurement is quietly meaningless (the preview opens
  34×26 and clamps to nothing). Measured 2026-09-03 while verifying `bottomReserve`; same family
  as the blank-screenshot and zero-rAF problems. **Call `resize_window` to pin an emulated
  viewport before measuring any geometry**, and sanity-check `clientHeight` in the same call as
  the measurement rather than trusting it.
- **A `javascript_tool` call that times out has still run everything up to the timeout.** A
  45 s-capped call that hovered, measured, then *wrote a setting* left that setting written; the
  next measurement was of the changed config and read as "the new setting does nothing". Keep a
  call that mutates settings separate from the one that measures, and re-read the stored value in
  the same call that reports a number.
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

`.spin` answers it: an SVG ring, **indeterminate** — a fixed arc (`ARC_FRAC`, 28% of the ring)
sweeping a full track at 400°/s. It says "still working" and deliberately nothing else.

**The determinate version was removed in v0.7.0 because it could not be honest.** Its
denominator was `candidates.length`, the worst case; the run stops at the first candidate that
clears the ratio gate, usually the first or second of up to eight. So the arc never once
finished where it said it would — reported as "it has never finished when it thinks it will".
A progress bar that is wrong every time is worse than none, and no honest denominator exists
here: the cost is a network fetch of unknown size and the stopping point is data-dependent.
Do not reintroduce one (`CREEP_TAU`/`CREEP_MAX`, the exponential easing between steps, and
`resolve()`'s `onProgress` parameter all went with it).

**The disc behind the ring is mostly opaque and themed to the BROWSER** (`applySpinTheme()`,
called per hover). The spinner is the only part of the overlay that sits on the bare page
rather than on the frame's own dark background, so it is the only part that needs this.

`darkMode()` reads `prefers-color-scheme` — that IS the browser's colour mode, and it is what
the user sees everywhere else. **v0.7.0 keyed off the PAGE's computed background instead and
that was wrong**: on a white page it picked the light palette and drew a near-white disc on
white, which is "matching" and invisible. Reported as "still too light, I can hardly see it —
I am using a dark browser theme". The page-background reading survives only as the fallback
for a browser with no media-query support, and `spinnerTheme` (auto/dark/light) overrides
both.

Contrast is deliberate on both sides: 34px, 4.5px strokes, a 1.5px rim at .45 alpha, and a
track at .22–.30. **The rim is what separates the disc from arbitrary page content behind it**
— at v0.7.0's .20 alpha there was effectively no edge, which is most of why it read as a
smudge. History worth not repeating: v0.4.0 had an unconditional `#1e1e2e` disc that was a
dark blob; v0.5.0 made the centre transparent, which read as nothing at all on a busy image.

`SPINNER_DELAY` (150 ms) keeps it from flashing on cached hits, but `buildViewer()` runs
*immediately* in `showSpinner()` so the ring exists before anything can need it.
`hideSpinner()` is in a `finally`, so the ring stops on every outcome including a throw; a
ring still turning after the search stopped is a lie.

- **`setInterval`, never `requestAnimationFrame` — and not a CSS animation either.** rAF is
  starved whenever the compositor decides the page is not worth animating. **The Claude Code
  Browser pane delivers zero animation frames while reporting `visibilityState: "visible"` and
  `document.hasFocus(): true`** — a 60-frame rAF probe returned 0. Real browsers do the same
  for occluded windows and some power-saving modes. A frozen ring is indistinguishable from a
  hung script, so the animation must not depend on frames being offered. Anything else here
  that must animate has the same constraint, and no screenshot will catch it — verify by
  reading the attribute over time (`svg.style.transform` advances 24° every 60 ms).

## Imgur — measured, and why `.webp` is the trap (v0.16.0)

Reported: "it is not working for gifs". Measured live on `i.imgur.com`, 2026-09-03:

| URL | bytes | pixels | content-type |
|---|---|---|---|
| `T22ZUhZ_d.jpg?maxwidth=520&shape=thumb` — what the grid shows | 15.9 KB | 435×244 | image/jpeg |
| `T22ZUhZ_d.jpg` — the generic query-strip rule's candidate | 1.9 KB | **145×81** | image/jpeg |
| `T22ZUhZ.jpg` — the suffix stripped | 3.1 MB | 800×450 | **image/gif** |

The middle row is the finding that matters: **the generic query-strip rule goes the wrong way on
imgur**, producing something smaller than what is displayed. It is correctly rejected by the ratio
gate, so nothing was ever visibly broken — there was simply no candidate left, and a GIF post's
thumbnail is a **static frame**. Hence a host-checked rule, placed **first** in `UPGRADES` so the
high-confidence candidate is probed before the generic one.

Two imgur facts, neither guessable:

- **The extension you ask for is ignored, except `.webp`.** `T22ZUhZ.jpg` returns `image/gif` and
  animates in an `<img>`; `KlprxXs.jpg` returns `image/png`. So the rule never has to guess the
  original's real format — asking for anything but webp returns the stored bytes.
- **`.webp` is a transcode at the same pixel size, and for an animated post it is a STILL.**
  `zFAj8eD.webp?tb` is 240×210 animated, `zFAj8eD.webp` is 412×360 and frozen, `zFAj8eD.jpg` is
  412×360 and moving. That is why the rule rewrites `.webp` → `.jpg` even when the id is already
  bare — the size is unchanged and the picture starts moving.
- **There are TWO kinds of animated imgur post and only one of them has an image form at all.**
  Measured 2026-09-03, both ids live:

  | id | `.jpg` | `.mp4` |
  |---|---|---|
  | `T22ZUhZ` — legacy GIF post | `image/gif`, 3.1 MB, **animated** | 1.8 MB |
  | `EDiKb3d` — video post (`og:type` `video.other`) | `image/jpeg`, 36 KB, **a still frame** | 2.6 MB |

  The row above this one is still true; it is just not the whole story. For a video post the
  moving original exists **only** as `.mp4`, so no URL rule of any kind can make the preview
  animate — the ceiling is a still, and the gate passes it (480×854 against a 292px thumbnail,
  ratio 1.64) so it looks like it worked. This is the real limit behind "it is not working for
  gifs", not the resolver, and lifting it means the viewer displaying video. See the next
  section.

**The restraint is the load-bearing part.** Imgur ids are 5 or 7 characters, so `_d` and a single
trailing `[sbtmlhg]` on a 6- or 8-character basename are unambiguous suffixes, but a **bare** 5- or
7-character id must be left alone: `T22ZUh.jpg` — `T22ZUhZ.jpg` with its last character removed —
is a real 90 KB image of something else, and it *loads*. Over-matching here shows the wrong
picture, which is worse than showing none. Negative tests are in `test-resolver.js`.

Verified against the live grid: 8 of 8 thumbnails resolved to their originals. **One caveat worth
knowing before chasing it as a bug:** an imgur original is sometimes barely larger than the
thumbnail (measured `UnCz83E`, 314×228 against a 300px display = ratio 1.05), and the default
`minRatio` of 1.2 then rejects it — so that post stays a still. There is no way to know a candidate
is animated without fetching it, so this is a settings answer (`minRatio` ≈ 1.0, or
`showEvenIfNotLarger`), not a code one.

**On an imgur post page there is nothing to fix**: an animated post renders as `<video>` with an
`.mp4` src (`DIV.PostVideo-video-wrapper`), and `P4`/`NEVER` refuse it correctly. "Images only" is
the design; the grid thumbnail is the only place a gif is an `<img>` at all.

## Going to the next page for the original (v0.19.0)

Every other mechanism here GUESSES a URL from strings already on the page and verifies it by
loading it. This one asks the site: fetch the page the thumbnail links to and read what it
declares as its own media. The user's framing, and it is the right one: **the media on the item
page is by definition the thing the thumbnail stands for, so there is nothing to compare.**
Hence `linkedMedia()` → `fetchPageMedia()` → `pageMediaFrom()`, and a hit from it **skips the
ratio gate and ends the search**.

- **It runs in PARALLEL with the ordinary probes, not before them.** A document fetch is slow
  beside an image probe, and there is usually a local candidate worth showing meanwhile — so the
  guesses paint something immediately and the authoritative answer replaces it in place through
  the existing progressive-upgrade path. Awaiting it up front would turn every hover into a page
  load before anything appeared. `resolve()` breaks out of the candidate loop the moment
  `trusted` is set, and `await`s the lookup before returning so the spinner keeps turning while
  something really is still running. Note `keepSearching: false` now `break`s rather than
  returning, or a late authoritative answer would be dropped on the floor.
- **`og:url` MUST name the path that was requested, or nothing on the page is trusted.** This is
  not defensive tidiness — it is the reason the feature is safe. Measured against live imgur
  2026-09-03: fetching one gallery URL returned *another post's document entirely* (same byte
  count, wrong id), and a second attempt returned a generic shell whose `og:image` is the imgur
  logo. Either would have put a confident, completely wrong picture on screen, and this candidate
  skips the ratio gate that would otherwise have caught a 1200×630 logo. Test case 26 is that
  page, and the correct outcome is no preview at all.
- **`og:video` before `og:image`**, because on a post that has both the video IS the post and the
  image is its poster frame. `isVideoUrl()` gates it: `og:video` is frequently a player *page*
  (an embed URL), which would never load.
- **Same origin only, and that is a design choice rather than a limitation.** A listing and its
  item pages are on one site essentially by definition; a cross-origin href is an outbound link,
  not "the page for this thumbnail". The payoff is large: plain `fetch` with the user's own
  cookies, so the HTML is what they would actually see — **no `GM_xmlhttpRequest`, no new
  `@grant`, no `@connect` prompt, and no ability to pull arbitrary third-party documents.** If a
  cross-origin case ever genuinely needs this, that is the trade being reopened, not a small
  addition.
- **Bounded elsewhere too:** one fetch per URL, cached in `pageCache` for the tab; only after
  `hoverDelay` has already elapsed; never for a link that is already a media URL (that is an
  ordinary candidate); HTML content-types only, so a link to a PDF is not pulled in full to be
  thrown away; `blocked()` still applies to the result; and `followLinks` turns it off.
- **The cost is a real page request per link hovered, and the site sees it.** That is said plainly
  in the setting's description, because it is a behavioural change a user should be able to
  consent to: hovering now touches the server, where before it only touched the image CDN.

Cases 24–26 all hang off `icon.png`, which has **no upgrade candidates of any kind** — so if a
preview appears at all, the page was fetched and read. 24 gets a video the URL could never have
produced, 25 gets an image *no bigger than the thumbnail* (the ratio-gate bypass, which is the
whole point), 26 gets nothing.

**The thing that actually blocked "same treatment for gifs" was the viewer, not the resolver** —
built in v0.18.0, see the next section. For an imgur video post the moving original is only ever
`.mp4` (table above), and gifwow's is only ever `.mp4`; both URLs are derivable with a pure string
rule the existing machinery already held.

## The preview can BE a video (v0.18.0) — "images only" is retired, deliberately

The header invariant said images only, and for the class of post above that means *there is no
answer at all*: an imgur video post's `.jpg` is one frozen frame, and no URL rule can change that.
So the frame grew a second face. Decided by the user 2026-09-03, asked explicitly rather than
assumed, because it is the one stated design rule this project was built around.

- **`mediaEl` is the whole of the design.** `imgEl` and `vidEl` both live in the box, exactly one
  is visible, and `mediaEl` points at it. `layout()` writes geometry to `mediaEl` and nothing
  else, so the "`view` + `reflow()` + `layout()` own all geometry" invariant survives intact —
  the frame having two possible faces changes what is written to, not who writes.
- **`setMedia()` is the only place either `src` is set**, and it clears the one being put away.
  Both halves matter for different reasons: a `<video>` left with a src goes on buffering behind
  `hidden`, and an `<img>` left with one holds its decoded bitmap for the life of the tab. The
  same pair is cleared in `cancel()`'s teardown via `clearMedia()`.
- **`img[hidden],video[hidden]{display:none}` is required**, because the rule above it sets
  `display:block` on both and that outranks the UA's `[hidden]` rule. Without it the idle face
  keeps its box and sits under the live one.
- **The `<video>` has no `controls`, on purpose.** A play button and a scrubber would sit under
  the very clicks that pin, drag and dismiss the window. It is `muted` + `loop` + `autoplay`
  because it stands in for an animated picture, not for a player — which also means the browser's
  autoplay policy never blocks it.
- **`probeVideo()` measures with `loadedmetadata` → `videoWidth`/`videoHeight`, `preload:
  'metadata'`, and a 6 s timeout.** The timeout is load-bearing, not caution: imgur ignores the
  extension you ask for, so `<id>.mp4` on a *static* post answers 200 with `image/jpeg` — neither
  playable nor an error the element must report promptly. Probes are sequential, so one that never
  settles stalls every candidate behind it, and the symptom is the exact silence the spinner
  exists to apologise for. Read every measurement BEFORE clearing `src` and calling `load()`;
  that teardown resets `videoWidth` to 0 and `duration` to `NaN`.
- **An upgrade may not trade motion for a bigger still** (`resolve()`: `if (best && best.video &&
  !dim.video) continue`). "Bigger wins" is right between two pictures and wrong here — a
  1600×1200 frozen frame is not an improvement on a 640×480 clip of the same post, it is a
  different and worse answer. On imgur the still and the mp4 are the *same pixel size*, so probe
  order settles it there and this rule settles it everywhere else. A bigger video still replaces
  a smaller one. Test case 23 is built to fail if this regresses: its thumbnail deliberately
  upgrades to a 1600×1200 still that is probed second.
- **The video candidate is offered FIRST** (the imgur mp4 rule is `UPGRADES[0]`), for the same
  reason — with identical dimensions, first probed is what shows.
- **`playVideos` (on) turns it all off**, and it is checked in `collectCandidates`' `add()` so a
  video candidate is not merely unusable but never *probed*: it would otherwise spend one of
  `MAX_PROBES` ahead of the image candidate behind it. It is a separate setting from
  `skipVideos`, and the two are easy to confuse — `skipVideos` is about *what on the page may be
  hovered*, `playVideos` is about *what the frame may display*.
- **Our own `<video>` cannot poison the video gates.** `videoSurfaces()` uses
  `document.getElementsByTagName('video')`, which does not cross a shadow boundary, so the
  preview's clip is invisible to it. It would read as `gifLike` anyway — muted, looping, no
  controls — which is a second, independent reason it is harmless.

### A playing clip is a hoverable picture (v0.20.0) — the gap that made all of this invisible

Reported as "when I hover over a gif, it does not open the preview window", and the diagnosis is
the embarrassing kind: **on imgur's gallery and gifwow's grid the animation IS a `<video>`
element**, so the thing under the pointer was never an `<img>`, and `eligible()`'s third line —
`if (NEVER[el.tagName]) return null;` — refused it outright. No preview, no spinner, nothing,
while every still beside it worked perfectly.

So v0.18.0 taught the frame to *display* video and v0.19.0 taught the resolver to *ask the linked
page*, and neither could ever be reached from the one element that needed them. Both features
were real and both were unreachable. **The lesson is about the shape of the mistake, not the
line:** a capability was added at the end of a pipeline whose entrance still rejected the input
that capability existed for. It was even written down — v0.18.0's notes said "an imgur-style
`<video>` grid item is still refused as a source by `NEVER`" — and then not revisited when the
user asked for the rest. A known limitation recorded in the docs is not a limitation the user
agreed to.

`eligible()` now takes a `VIDEO` branch **before** the `NEVER` test:

- **Only a `gifLike()` clip**, so a real player is still refused and a watch page is unaffected.
- **`playVideos` gates it**, because a clip that the frame cannot display is not worth hovering.
- **Only the LINK gate applies** (`videoLinkReason()`, split out of `videoReason()` for this).
  The other three video tests cannot be used on a video: it is trivially "inside a `<video>`",
  its own ancestor walk finds it, and it sits inside its own rectangle — all three self-match and
  would refuse every clip on every page. The link is the one signal that still means something,
  and it is what keeps case 28 (the same clip under a `/watch?` link) refused.
- **`shownUrl()` reads `currentSrc` for a video**, not `src`: a clip is often given `<source>`
  children and then `src` is the empty string.

For an imgur grid clip the resolution path is then the *linked page*, not a URL rule — its
`_lq`-style basename does not match `imgurId()`, but the `/gallery/…` link does resolve. Which is
exactly the mechanism asked for: go to the next page and bring back what is there.

Cases 27 and 28 are that shape with **no `<img>` in the card at all**.

**Known cost, stated because it is real:** on a *static* imgur post the mp4 candidate is probed
and cannot succeed, spending one request per hover. Nothing in a thumbnail URL says whether the
post behind it moves, so the choice is that or no gifs.

**Not verified here, and worth measuring on the real site:** whether imgur's grid serves a
*truncated* clip that differs from the post page's. `<id>.mp4` and `<id>_lq.mp4` measured
identical durations (10.85 s and 10.85 s; 5.04 s and 5.04 s — `_lq` is lower resolution, not
shorter), and imgur's grid never mounted a `<video>` in the in-app browser, so the grid's own URL
shape was never observed. The rule targets `<id>.mp4`, which is the full-length post either way.

## Known limits

- HZ+'s 399 plugins encode genuine per-site knowledge (Pixiv's referer requirement, Instagram's
  URL signing, Twitter's `:orig`). The generic resolver wins on the long tail and loses on a few
  hostile sites. Add narrowly-scoped rules to `UPGRADES` only with host checks and negative tests.
- `keepSearching` (ON by default, was `preferLargest` and off) keeps probing past the first hit
  and upgrades the preview in place each time something strictly bigger turns up. It costs up to
  `MAX_PROBES` (8) requests per hover instead of usually one. Turning it off restores
  stop-at-first-hit.

## Progressive resolution, and why probes stay sequential

`resolve()` takes an `onHit` callback and fires it for every strictly larger candidate, so the
first match paints immediately and later ones replace it via `upgradeViewer()`. The ring docks
into the frame's lower right (`dockSpinner()`) while the search continues, which is the only
signal that what you are looking at is not final.

**Do not parallelise the probes into a race.** The candidate list is ordered by *heuristic
confidence*, not by measured size — `data-*` attributes, then srcset widest-first, then rewrites,
then the link, then the displayed src last. Selection is "first in list order that clears the
gate", so taking the first *response* instead hands the decision to whichever server answers
fastest, which systematically favours the smallest file. If the latency ever needs fixing, the
safe shape is: start all probes at once, then `await` them **in list order** — same result, wall
clock drops from the sum to the slowest one actually needed, at the cost of always issuing N
requests. That is a bandwidth decision, not a correctness one.

`place()` deliberately does **not** cancel the in-flight resolve; placing is a reason to keep
looking. `upgradeViewer()` holds the frame's centre, and for a pinned view also holds its
on-screen size (`prevImgW / res.w`) and the fraction of the picture at the frame's middle, so a
swap changes only the pixels, never what the eye is tracking.

### Google Images cannot be fixed generically — measured, not assumed

Reported 2026-09-03: HZ+ returns full-size originals there, this script returns 500–700px.
Inspected live on `google.com/search?udm=2` (2026-09-03, real Chrome — the in-app browser gets
`/sorry/index` bot detection). What a result thumbnail actually offers:

| Source we could use | What Google gives |
|---|---|
| `src` | `encrypted-tbn0.gstatic.com/images?q=tbn:<opaque token>` — no extension, no size params, nothing to rewrite |
| `srcset` | **absent** |
| `data-*` on the img | `data-csiid`, `data-atf` only — no URL |
| `data-*` on 6 levels of ancestors | `data-ved`, `data-eqld`, `data-preview-id` (empty), `data-img-wrapper` — no URL |
| ancestor `<a href>` | **the anchor has no `href` attribute at all** |

Natural sizes of those thumbnails measured 678×452, 245×205, 503×397 — which *is* the reported
500–700px. So nothing is malfunctioning: the thumbnail is the only candidate that exists, it
clears the ratio gate against a 240px display, and it gets shown.

The original URL is present only inside ~0.94 MB of inline script JSON, as `["<url>",h,w]` triples
sitting a few hundred bytes after the thumbnail's `tbn:` token. **Note HZ+'s own
`a[href*="imgurl="]` selector is now stale for this layout** — its Google support must be riding
on the script-JSON path.

What v0.5.0 added is still worth having, just not for this: `linkParamCandidates()` (the generic
`?imgurl=`-style rule) and the `/s0/` path-segment form of the googleusercontent size token.

#### If it is ever revisited, these are the measured numbers (2026-09-03)

A prototype extractor — find the token in any `<script>`, take the next 1200 chars, first
`["url",h,w]` triple whose host is not Google — run against the live page:

| | Initial page | After "More results" |
|---|---|---|
| thumbnails rendered | 15 | 226 |
| resolved to an original | **15 (100%)** | **39 (17%)** |
| cost per lookup | 0.3 ms | 0.19 ms |
| gain | median 1.9×, max 13× | max 15.8× |

The initial payload carries 200 external image entries, 152 of them ≥800px — enough to cover the
lazy placeholders in that batch too. Everything past "More results" arrives by XHR and its
originals are **not** in the DOM at all, which is exactly why HZ+ needs its fourth mechanism.

#### The invariant question, stated properly

"No DOM scanning" is worded more broadly than the thing it protects. Every bug it exists to
prevent — lazy-loaded src, images added after load, SPA navigation, scan races, HZ+'s
`.one('mouseover')` — comes from **deciding eligibility ahead of time and binding to elements**.
A hover-time `querySelectorAll('script')` + `indexOf` binds nothing, caches nothing against an
element, and re-reads live every time, so it has none of those failure modes. Do not reject it by
quoting the rule; the rule is about pre-passes.

The real objections are different, and they are the ones to weigh:

1. **It is the first site-specific rule.** It reads Google's private JSON shape, which can change
   with no warning and no error — the preview would just quietly go back to thumbnails.
2. **`UPGRADES` cannot host it.** Every rule there is a pure URL→URL function, which is the only
   reason `test-resolver.js` can test them offline with no DOM. This needs a new extension point
   taking the element, and a saved-page fixture to test against.
3. **It is a partial fix** — the 17% above. Completing it means hooking XHR on Google, which is a
   permanent network interception plus a cache, and is a site plugin in everything but name.

So: (a) do nothing and keep HZ+ for Google; (b) hover-time lookup, host-gated, accepting first-
batch-only coverage and silent breakage; (c) (b) plus XHR hooking, which is the thing this
project exists not to be. Not decided as of v0.6.0 — ask before building any of it.
