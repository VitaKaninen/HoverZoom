# Preview window — interaction reference

What the preview **window** does, as a state machine. Menus, buttons, the status bar contents and
the loading ring are out of scope except where they change what the window itself accepts.

Describes `Hover-Zoom.user.js` **v0.37.0**.

---

## How to cite this document

Every item has a short permanent ID. Say the ID instead of quoting:

| Prefix | Covers | Example |
|---|---|---|
| `R` | The governing rule | `R1` |
| `P` | Preconditions — what must be true before anything opens | `P4` |
| `S` | States | `S10` |
| `T` | Transitions | `T17` |
| `K` | Terminators — what closes a hover window | `K3` |
| `B` | Button map rows | `B2` |
| `E` | Known edges and consequences | `E1` |

**IDs are permanent.** New items are appended with new numbers; a removed item's ID is retired and
never reused, so a reference in an old conversation never silently points at something else. If an
item's *content* changes materially, the ID stays and the change is noted in `## Changes` at the
bottom.

**Retired, never to be reused:** `S07`, `S08`, `S09`, `S11`, `T08`, `T09`, `T11`, `T12`, `T13`,
`T14`, `T20`, `E3` — all of them belonged to the detached state, which v0.28.0 removed — and
`T25`, the move-freeze, removed in v0.34.0. See the 2026-09-04 rows in `## Changes`.

---

## Index

| ID | Name | Family | Held open by |
|---|---|---|---|
| `S01` | idle | waiting | — |
| `S02` | armed | waiting | the source image |
| `S03` | resolving, silent | working | the source image |
| `S04` | resolving, visible | working | the source image |
| `S05` | hover-held | open | the source image |
| `S06` | hover-held, upgrading | open | the source image |
| `S10` | placed | placed | nothing |
| `S12` | placed, image spilling | placed | nothing |
| `S13` | dragging (pan), placed | transient | the held button |
| `S14` | dragging (move), placed | transient | the held button |
| `S15` | placed, upgrading | placed | nothing |
| `S19` | dragging (resize), placed | transient | the held button |
| `S16` | suppressed | gone | — |
| `S17` | fading out | gone | — |

**There are two states, and everything else is a phase on the way in or out of one of them:
`S05`, which the image holds open, and `S10`, which nothing holds open.** One gesture separates
them — a press on the window.

The ladder used to have a third rung between them (`S07`, detached: dragged aside, but still
dying the moment the pointer left it). It is gone. Its defining behaviour was that a window you
had deliberately positioned would disappear on its own, which is the opposite of what
positioning one means.

---

## R — the governing rule

### R1 · One holder at a time

**Exactly one thing holds the window open at any moment, and leaving that thing ends the window.**

- While it is a hover preview (`S05`, `S06`) that thing is **the source image**. Never the window —
  the window is invisible to the pointer and cannot hold itself open.
- Once placed (`S10`) **nothing** holds it. It ends only on an explicit dismissal.

There is no third answer any more. `S07` used to be held by the window itself, which is what made
a deliberately positioned window vanish when the pointer wandered off it.

Every hover bug this script has had came from two things holding it at once. Any proposed change
that reintroduces a second holder should be treated as a regression until argued otherwise.

### R2 · One window at a time

**While a window is placed, no new preview opens.** Hovering is off until it is dismissed, which
costs one click anywhere outside it.

This is not a limitation working around the code; it is what keeps every other gesture
unambiguous. Two windows on screen would have no answer to which one the wheel zooms, which one
the arrow keys pan, or which one Escape closes — and the page is still readable and scrollable
underneath, so the reason to want a second one is thin.

*Code: `onOver`, `onOut`, `cancel`, `dismiss`, `place`, `unplace`.*

---

## P — preconditions

None of the states are reachable unless all of these pass, evaluated the moment the pointer
arrives — nothing is decided in advance.

| ID | Precondition | Default |
|---|---|---|
| `P1` | The element is an `<img>`, a **playing gif-style `<video>`** (`E16`), or has a CSS background image and contains no `<img>` of its own | — |
| `P2` | Displayed at least `minDisplayed` on screen | 48 px |
| `P3` | Displayed no larger than `maxDisplayed` | 0 = no cap |
| `P4` | Not a video: not a media/plugin tag, not sitting inside a **video surface** (a laid-out **player**'s rectangle, or the player box derived from it), no **player** in it or within three ancestors, and not inside a link matching the video-URL shapes. A `<video>` that is muted, controls-less, looping or autoplaying, and under a minute long is an animated picture rather than a player — it is none of those things (`E12`) | `previewVideos` off |
| `P5` | The site passes the blacklist / whitelist test | blacklist, empty |
| `P6` | In modifier mode, the modifier key is held. **Either order** — hold it and then point, or point and then press it (`E28`) | activation = hover |
| `P7` | Not page furniture — a CSS background that is part of the page rather than a picture on it (`E17`) | `skipFurniture` on |
| `P8` | Neither the displayed URL nor any candidate is on the never-preview list | `blockList` empty |
| `P9` | Not marked decoration by the page itself: no `aria-hidden="true"`, no `role="presentation"`/`"none"` on the element | `skipFurniture` on |
| `P10` | Not a **band** across the top of the page (`E20`) — a masthead, channel banner or leaderboard ad. The one furniture rule that applies to an `<img>` as well | `skipFurniture` on |

The element tested is not always the one under the pointer. When the hover target fails `P1`, a
single picture directly beneath it in the same card is tried instead (`E18`), and that picture
then faces every precondition here in its own right.

A candidate that passes all ten still shows nothing unless a probe finds an image at least
`minRatio` (1.2×) bigger than what is displayed **and shaped like it** (`E19`) — see `T04`.

`P7` is five separate tests, listed in `E17`. It applies to CSS backgrounds only; the one rule
that also judges an `<img>` is `P10`, and it is deliberately much narrower. `P10` runs on CSS
backgrounds too, which is not an accident — see `E20`.

`P8` is checked in three places — before the spinner (`eligible`), before any candidate is probed
(`collectCandidates`), and in the not-larger fallback — so a blocked image costs no request and
shows no ring.

`P9` reads the element itself and never an ancestor: carousels routinely mark cloned slides
`aria-hidden`, and those are real pictures on screen that a user will hover.

*Code: `eligible`, `eligibleDirect`, `coveredMedia`, `wallpaperReason`, `decorativeReason`,
`blockMatch`, `videoReason`, `overVideoSurface`, `siteEnabled`, `onOver`.*

---

## S — states

### Waiting

#### S01 · idle
No window, no timer, no memory. The resting state.
- **On screen:** nothing.
- **Ends on:** the pointer entering an eligible element (`T01`).

#### S02 · armed
The pointer is on an eligible element and the `hoverDelay` timer (120 ms) is running. Nothing has
been requested yet.
- **On screen:** nothing.
- **Held by:** the pointer being on the element.
- **Ends on:** leaving the element — silently, with no trace and no network cost.

### Working

#### S03 · resolving, silent
Probes are in flight. For the first `SPINNER_DELAY` (150 ms) nothing appears at all, so a cached or
instant hit never flashes a ring.
- **On screen:** nothing.
- **Held by:** the pointer being on the element.
- **Ends on:** a result, exhaustion of the candidate list, or leaving the element.

#### S04 · resolving, visible
Still searching past 150 ms. The ring appears near the cursor and trails it. There is still no
window.
- **On screen:** the ring only.
- **Held by:** the pointer being on the element.
- **Ends on:** the first hit (`T03`), no hit at all (`T04`), or leaving the element.

### Open — held by the image

#### S05 · hover-held
The window is up and transient.
- **Placement:** decided once, when it opens, and never revisited. With `position: cursor` (the
  default) it opens beside the pointer with a `cursorGap` (24 px) and is then nudged the smallest
  distance that puts the pointer `REACH_INSET` (10 px) inside its edge. With `position: center` it
  is centred in the window and the pointer is usually *outside* it — which changes `E1`.
- **On screen:** the window, **pointer-transparent** — but only to *hover and wheel*, which is
  the distinction that matters:
  - **hover** passes through. `mouseover` reaches the element underneath, which is what makes a
    scan across a row of thumbnails give one window per thumbnail.
  - **the wheel** passes through. The page scrolls, and the scroll then closes the window
    (`K2`).
  - **a press or click does NOT.** It genuinely lands on the page, but the script's own
    document-level capture listeners test the pointer against the window's rectangle and claim
    it before the page sees it. See `E1` — that is the price of click-to-pin.
- **Held by:** the pointer being on the source image. Nothing else (`R1`).
- **Accepts:** left press → placed (`T07`), on the press, whether or not it turns into
  a drag; right press → dismiss (`T10`), and
  the browser's own menu is suppressed with it. Default button map `B1`. This is the one state
  that keeps right-click: the window is transparent here, so the browser's menu would come up for
  the *thumbnail* underneath (`E9`).
- **The wheel is NOT accepted — it belongs to the page** (`E22`). It scrolls, and the scroll
  takes the preview down with it (`K2`). Growing the window is a placed-window gesture; one
  click first.
- **Ends on:** leaving the image, **immediately** — no grace period, even though the window is
  sitting under the cursor.

#### S06 · hover-held, upgrading
`S05` while the search is still running, because a bigger original may exist (always on since v0.39.0, was `keepSearching`, on
by default, up to 8 probes).
- **On screen:** the window, plus the ring docked into its lower-right corner — the only signal
  that what you are looking at is not final.
- **On upgrade:** the frame keeps its centre; only the pixels change.
- **Ends on:** as `S05`. Leaving mid-search does **not** abort loads already in flight (`E6`).

### Placed — held by nothing

#### S10 · placed
A wheel notch or a press promoted it — a scroll, a click, a drag, or a resize, all the same
thing. The backdrop starts catching clicks meant for the page, and the keyboard belongs to the
window. **The size is still not settled: the frame goes on following the picture up to the
growth ceiling, and only a hand resize pins its edges** (`E22`, `E23`).
- **On screen:** the window and an invisible backdrop. Nothing is dimmed: the reason to
  place a window is to compare it with what is behind it.
- **Held by:** nothing. It outlives hover, scrolling and focus loss entirely.
- **The page underneath stays alive to read.** It still scrolls — the window is fixed and stays
  put while the page moves under it. What it does not do is act on clicks, and no new preview
  opens while this one is up (`R2`).
- **Accepts:** wheel **over the frame** → grow the whole window about the pointer to the growth
  ceiling, then zoom the picture inside it, also about the pointer (`wheelZoomStep`, 15 % per
  notch, `E22`); a wheel anywhere else
  scrolls the page; `+` / `−` → zoom about the frame centre (1.25× per press), **down past the
  fit and into the frame's background** (`E26`); `0` → fit the picture to the current frame;
  arrows → pan (`panStep` 80 px, Shift for 3×); **a corner or an edge → resize** (`S19`, `E23`);
  **the frame margin or the status bar → move, always** (`S14`, `E25`, `E21`); **the middle
  → move the frame, or pan the picture once it is spilling** (`S14` / `S13`).
- **May hang off the edges of the screen** (`E21`), which is the point of the growth ceiling
  being above 1×: shoved aside or upwards, the picture still reaches the screen edges instead of
  leaving a strip of empty page behind it.
- **Ends on:** a click anywhere outside it, or Escape. **Right-click does not close it**
  under either button map — it raises the browser's own menu over the picture instead (`T21`,
  `E9`).
- **Note:** the key and wheel listeners are bound on `window` in capture, so they outrank the page
  and any sibling userscript.

#### S12 · placed, image spilling
The frame has reached the growth ceiling, or has been pinned by a hand resize, so zooming in
pushes the image out past its edges. That is the moment panning starts to mean something — and the moment the frame around the
picture becomes what moves the window, because the middle is now the pan surface (`E25`, `E21`).
- **Cursor:** `grab` over the image.
- **Accepts:** drag the image to pan (`S13`); arrows to pan; wheel keeps the pixel under the pointer
  where it is.
- **Zoom ceiling:** `maxZoom` (32×), hard-capped at 64×.

#### S13 · dragging (pan), placed
Press in the middle while the picture is spilling — and only while it is spilling; with nothing
to pan the same press moves the frame instead (`S14`). The picture moves inside a frame that
stays put.
- **Cursor:** `grabbing`.
- **Bounds:** clamped so the frame never shows past the edges of the picture.
- **It outlives the window and the browser** (`E24`): once started, the pan follows the pointer
  across the frame's edge and off the browser entirely, and ends on the release wherever that
  happens.

#### S14 · dragging (move), placed
Press on the **frame margin** or the **status bar** (`E25`), or anywhere in the **middle** of a
frame whose picture is not spilling. The whole frame moves; the picture stays put inside it, and
its size is not touched — moving used to freeze it, and no longer does (`E22`).
- **Cursor:** `move`.
- **Bounds:** it may go off the edges of the screen, but never so far that less than 72 px of it
  is left in view (`E21`).
- **The frame margin and the status bar move the frame whatever the zoom** — together they are
  the title bar, and once the picture spills they are the only handles that move rather than pan
  or resize (`E25`, `E21`).

#### S19 · dragging (resize), placed
Press on a corner or an edge. The frame is resized with the opposite edge anchored, and the
picture follows or does not depending on what it was doing (`E23`).
- **Cursor:** `nwse-resize` / `nesw-resize` on a corner, `ew-resize` / `ns-resize` on an edge.
- **Aspect:** free — drag the window to any shape you like. **Shift** locks it to the frame's
  shape as it was when the edge was grabbed (`E23`).
- **Bounds:** no smaller than 48 px of picture — a 50 px window at the default border, which is
  what keeps the ⊘ reachable at any size (`E25`) — and no larger than the growth ceiling.

#### S15 · placed, upgrading
Placing is a reason to keep looking, not to stop, so the search runs on.
- **On upgrade:** three things are held constant — the frame's centre, its on-screen size, and the
  fraction of the picture sitting at the frame's middle. Only the pixels improve.
- The same holds for a hover preview the wheel has already grown (`E22`) — otherwise a late
  upgrade would quietly undo the sizing just done by hand.

### Gone

#### S16 · suppressed
No window, and the image it came from is blocked from opening another one.
- **Entered from:** a right-click dismiss (`T10`), or dismissing a placed window with a click
  outside it (`T16`) — which very often lands on the thumbnail it came from.
- **Why it exists:** without it, the very next mouse movement over the same image would re-open what
  you had deliberately got rid of.
- **Ends on:** the pointer leaving that image and coming back (`T15`). Other images are unaffected.

#### S17 · fading out
The window has been ended and is running out its `fadeMs` (90 ms) opacity transition. It is already
inert.
- **Accepts:** nothing. Not hit-testable, holds no state.
- **Then:** ~60 ms later the decoded image is released, so a long session does not accumulate
  bitmaps.

---

## T — transitions

| ID | From | You do | It becomes |
|---|---|---|---|
| `T01` | `S01` | Point at an eligible element | `S02` |
| `T02` | `S02` | Wait 120 ms | `S03` |
| `T03` | `S03`/`S04` | First hit arrives | `S05` (or `S06` if still searching) |
| `T04` | `S03`/`S04` | Nothing bigger exists | `S01` — no window ever appears |
| `T05` | `S05` | Move onto the next image | that image's `S02` |
| `T06` | `S05` | Move onto blank page | `S01` |
| `T07` | `S05` | **Press** the window — click, drag or corner, all the same | `S10` |
| `T10` | `S05` | Right-click | `S16` |
| `T15` | `S16` | Leave that image, come back | `S02` |
| `T16` | `S10` | Escape, or click anywhere outside it | `S01` (`S16` for the click, `E2`) |
| `T17` | `S10` | Wheel over the frame, or `+` / `−` | Grows the whole window to the growth ceiling, about the pointer for a wheel and about the frame's centre for a key; past that `S12`, the picture spilling inside it. Zooming back out shrinks the frame again unless a hand resize has pinned it (`E23`) |
| `T18` | `S10` | Press `0` | `S10`, the picture fitted to the current frame |
| `T19` | `S10` | Resize the browser window | `S10`, kept at the size you gave it — it does not close or re-fit |
| `T21` | `S10` | Right-click the window | `S10` unchanged — the browser raises its own menu over the picture (`E9`) |
| `T22` | `S05` | Wheel over the window | `S01` — the wheel is the page's here; it scrolls, and the scroll closes the preview (`K2`, `E22`) |
| `T23` | `S10` | Drag a corner or an edge | `S19` → `S10` at the new size, frozen there (`E23`) |
| `T24` | `S10` | Wheel anywhere **but** the frame | `S10` unchanged — the page scrolls under it |
| `T25` | — | *Retired in v0.34.0.* Moving the window used to freeze its size as a ceiling; it no longer touches the size at all (`E22`) |

---

## K — terminators

Everything that closes a **hover** window (`S05`, `S06`). `S10` survives all of these except `K5`
and the explicit dismissals in `T16` — which is now the whole of the difference between the two
states.

| ID | Trigger | Notes |
|---|---|---|
| `K1` | The pointer leaves the source image | Immediate, no grace. |
| `K2` | Page scroll | A placed window survives it, and stays put while the page moves underneath. A wheel over a *hover* preview scrolls the page like any other, so this fires wherever the pointer is (`T22`, `E22`). |
| `K3` | Browser window loses focus | — |
| `K4` | Browser window resize | A placed window keeps the size it was given (`T19`). |
| `K5` | Escape | Closes it, but does **not** suppress the image (`E2`). |
| `K6` | `mousedown` on the page outside the window's rectangle | — |
| `K7` | Releasing the modifier key | Modifier mode only. Pressing it again re-opens the preview without the pointer moving (`E28`). |
| `K8` | Any mouse button held down | Suppresses *new* windows rather than closing the current one. Unconditional since v0.39.0. |

---

## B — button map

| ID | Setting | On `S05` | On `S10` |
|---|---|---|---|
| `B1` | Place with **left** (default) | Left places · right dismisses and suppresses | Left resizes, moves or pans by region · right raises the browser's own menu over the picture (`E9`) |
| `B2` | Place with **right** | Right places · left dismisses and suppresses | Left resizes, moves or pans by region · right does nothing, so the browser's own context menu appears over the picture |

The left button always drives a placed window, whichever way the setting points — otherwise a
placed frame could have no way to be moved. Under both settings the browser's own context menu is
reachable over a **placed** window, which is the only place `Save image as…` and `Copy image` work
at all (`E9`).

---

## E — known edges and consequences

These are consequences of the design rather than decisions in their own right. Several are open to
change if you want them changed.

#### E22 · The wheel is the page's until the window is placed, and then it grows the window
**A wheel over a preview you are only hovering belongs to the page.** It scrolls, and the scroll
takes the preview down with it (`K2`). Nothing about the window is claimed, and nothing about
scrolling a page changes because a preview happens to be up.

v0.30.0 tried the opposite — the wheel placed the window and grew it, so a page of small pictures
could be scrolled up to a usable size without a click. That bought one gesture and cost the
scroll wheel on every hover, because the window is nudged to sit under the cursor (`E1`) and so
the wheel was claimed nearly always. Reverted in v0.31.0. The gesture it bought still exists, one
click later.

**Once the window is placed, the wheel over the frame is the window's** (`T17`): it grows the
whole window, frame and picture together, to the growth ceiling (`E7`). A wheel anywhere else
still scrolls the page (`T24`).

**Nothing settles the size except a hand resize** (v0.34.0). Placing does not, and neither does
moving: the frame follows the picture up to the growth ceiling (`E7`, 2× the browser window by
default) for as long as the window is alive, and only dragging an edge or a corner pins it
(`E23`).

v0.29.0 to v0.33.0 froze the size on the move — `T25`, since retired — on the reasoning that
putting a window somewhere is the moment its size is settled, so the sequence would be scroll it
to size, then put it where you want it. v0.32.0 softened the freeze from a fixed size to a
ceiling for the same reason: moving a window says where it goes, not what shape it is.

**What killed it was v0.31.0's own correction.** Once the wheel belongs to the page while you are
only hovering, zooming requires placing first — and placing is a press, and a press that wanders
three pixels was a move. So in practice every window was frozen at its opening size, which is
never larger than the browser window, before it could ever be grown. The ceiling was not a
ceiling on deliberate growth, it was a ban on it, and it made `maxSizeMultiple` unreachable.
Reported as "it stops at the edges of the browser window".

**Zoom is anchored on the POINTER, and that is what makes an unfrozen frame comfortable**
(v0.34.0). `zoomAt()` holds the pointer at a constant fraction of the frame, so a growing window
expands *away* from the cursor and a shrinking one collapses *towards* it. Holding the centre
instead — which is what it did before — walked the frame's edges past the pointer on the way
down until the pointer was outside the window, at which point the wheel went back to the page and
zooming out further meant chasing the window across the screen with the mouse. `+` / `−` and `0`
still work about the frame's centre, because there is no pointer in a keypress.

`0` fits the picture to the current frame rather than to the browser window, or it would throw
away a size chosen by hand. An upgrade landing on a wheel-grown window holds its on-screen size
(`S15`) for the same reason.

#### E21 · A placed window may hang off the edges of the screen
Position is free once a window is placed — that is what the above-1× ceiling is for (`E7`). The
old clamp kept the whole frame inside the viewport; the new one only guarantees that **72 px of
it stays in view** on each axis.

A hover preview is *not* free: it is positioned by the script rather than by the user, so it is
kept fully on screen while it fits, and once the wheel has grown it past the window it is merely
stopped from sliding a gap in at an edge.

**The frame around the picture is the title bar, and that is load-bearing.** Once the picture
spills, the middle of the frame pans (`S13`) and the edges resize (`E23`), so the margin and the
bar are what is left to move the window — exactly the role a title bar plays in any window
manager. Since v0.30.0 that is a ring on all four sides (`E25`) rather than the bar alone, and
since v0.31.0 the whole ring fades and stops being a handle together, as the bar always has. The
bar moves the frame regardless of zoom for that reason, and it **outranks the edge regions**: it normally sits
along the frame's bottom edge, inside the bottom resize strip, so without that precedence its
lower half would resize. The price is that the bottom edge cannot be grabbed to resize where the
bar covers it — the two bottom corners and the other three edges still can.

**The bar goes where the window goes, off the bottom of the screen included** (v0.37.0). It sits
at the frame's own bottom edge at every size and position, and nothing moves it.

It used not to. `stickBar()` floated it up to the bottom of the frame's *visible* part, to answer
a state you could zoom yourself into and not out of: grow the frame past the browser window, keep
zooming, and it covers the whole screen — no edge or corner to resize by, no strip of margin in
view, the middle pans, and the bar below the bottom of the screen. That float was narrowed twice
and reported wrong both times — v0.35.0 tested the frame's top edge, which is off screen for any
tall frame dragged downwards; v0.36.0 tested whether any strip of the margin was in view, which
made the bar hop up and down as a wide window was slid left and right past the viewport edges.

**The trap state and the deliberately-positioned state are the same geometry**, so no rule
written in terms of the frame's position can separate them, and every version of the float
overrode the user somewhere. It is gone.

What replaces it is v0.34.0: a frame that has not been resized by hand follows the picture, so
zooming back out is a complete escape from a state zooming in created. Measured from a
2512 × 1392 frame covering a 1265 × 705 viewport — eight notches out and an edge is back in view
at 403 × 302. A HAND-RESIZED frame is pinned and does not shrink, so one dragged bigger than the
screen and then moved until all four edges are off it closes only with Escape (`K5`). That is a
known and accepted residue, not an oversight.

The bar also carries **(click this window to pin it)** between the filename and the metadata
while the window is only being hovered (`S05`), and drops it once placed. A hover preview is
pointer-transparent, so nothing about it invites a click, and every control that would say so
appears only after the click — it is the one part of this UI that cannot be guessed.

A faded bar still drops its `pointer-events` (`E10`), so it is not an invisible handle — but that
also means a press there falls through to a pan. Move the pointer first and it comes back.

`showStatusBar` off used to be a real trade for exactly this reason — a spilling frame with no
bar could be resized and panned but not moved. `E25`'s margin removes that: turning the bar off
now costs the filename and the ⊘, not the ability to move the window. Both off at once
(`frameMargin: 0` as well) brings the old trade back.

An earlier cut put a second, move-only band just *inside* the resize strip, invisible, and it was
removed: two bands within 30 px of each other is a mis-grab waiting to happen, and it made the
edge mean two different things depending on a number nobody can see. `E25` is that idea done
properly — the ring is drawn, and the picture never covers it.

#### E25 · The frame is a margin you can grab, drawn over the picture
A **`frameMargin` (24 px) ring on all four sides, painted on top of the picture** exactly as the
status bar always has been — the bar *is* the bottom of that ring. It costs the window no size:
the picture still fills the frame edge to edge, and the ring floats over it. (v0.30.0 laid the
ring out *around* the picture instead, which made every preview 48 px wider and taller than it
needed to be and forced a 98 px minimum; corrected in v0.31.0.)

The ring is a move handle, so the three gestures are readable off the window itself:

| Where | What it does |
|---|---|
| 6 px OUTSIDE the window, and 6 px inside it | resize (`S19`, `E23`) — a 12 px strip straddling the edge |
| 24 px of a corner, inside or out | resize both axes |
| the next 13 px in, and the status bar | move the window, at any zoom (`S14`) |
| the picture | move the window, or pan it once it is spilling (`S14` / `S13`) |

**The resize strip reaches 6 px OUTSIDE the window** (v0.33.0), so the cursor becomes a double
arrow as the pointer arrives rather than only after it has crossed the border. It is carried by
an invisible `.grip` collar that extends past the frame and sits above the backdrop; like every
other control it is hit-testable only while placed, because there is nothing to resize on a
preview you are merely hovering. Beyond that 6 px there is no control at all — the page owns the
cursor and we cannot reach it.

**It fades with the bar** (`E10`) — one second of a still pointer — and **while faded it stops
being a handle**, so a press there falls through to the ordinary pan-or-move rule. That is the
same rule the bar has always had, and it is the answer to the objection that killed the
*invisible* move band of v0.28.0: there is never a hidden region that means something different
from what is drawn. In practice the fade is hard to press through, because moving the pointer
into the ring brings it back, and parking it there holds it open.

**The strips are mostly transparent** (`rgba(30,30,46,.30)` against the bar's `.86`) — they carry
no text, and their whole job is to say "there is a handle here" without hiding the picture.

**The smallest window is 48 px of picture — 50 px with the default border.** Without a floor,
`minDisplayed: 0` on a page of tiny pictures produced previews a few pixels across, with nowhere
for the bar or its buttons to be. The ring shrinks to a third of the frame there so the window is
not entirely chrome.

**The ⊘ is positioned 20 px in from the right edge and no longer depends on the rest of the bar.**
As an ordinary flex item it sat after a `flex:none` dimensions field, so on a narrow bar it was
pushed past the end and clipped away entirely — on a small preview, which is exactly where it is
most wanted. The 20 px keeps it off the corner, where the hand goes to resize. (v0.30.0 moved
the **X** inside the ring for the same reason; v0.34.0 removed the button altogether — a placed
window already closes on Escape and on a click anywhere outside it, and a third way to do it was
occupying the corner the hand reaches for.)

`frameMargin: 0` leaves the status bar as the only handle, which is the pre-v0.30.0 shape.

#### E28 · The modifier key works in either order
`P6`'s gate is armed by a keypress, and a keypress is not a pointer movement. Holding the key and
then pointing at a picture always worked, because the pointer arriving fires the `mouseover` the
gate reads. Pointing first and then pressing the key fired nothing at all — the pointer is already
where it is going, and `mouseover` only ever fires on a crossing — so the preview simply never
appeared and the mode read as half-working.

Since v0.39.0 the keypress that arms the mode also looks up what is under the pointer and runs the
ordinary hover path against it, synthesising the event `onOver` would have received. One function,
two ways in, exactly as the pointer-transparent press is (`E1`). `K7` is unchanged: releasing the
key still takes the preview down at once, and pressing it again brings it back.

#### E27 · Turning off clips for the rest of the tab
`E14` lets the frame hold a muted looping clip, which is the only form some posts have. Whether
that is wanted is a judgement about the page in front of you rather than a standing preference, so
it is not a setting: the status bar of a **placed** window carries a `▶` beside the `⊘` **whenever
the frame is currently showing a clip**, and pressing it closes the window and returns previews to
still pictures for the rest of the tab. Reloading the page restores them.

It is session state, never written to storage — a stored version of it would be a setting again,
and one whose effect nobody could see from its label. The button follows the same rules as the
`⊘`: absolutely positioned so a long filename cannot push it off the bar, placed only (`E11`), and
listed in `isBoxControl()` or the box's own capture listeners would eat its click.

#### E26 · The picture may be smaller than the frame
The zoom floor used to be the fit, and the frame was never bigger than the picture in it. Both
are gone. Zoom out past the fit and the picture keeps shrinking, centred, with the window's own
background (`#1e1e2e`) around it — the way any image viewer behaves. The floor is now an absolute
32 px on the picture's long side, never above the scale it opened at.

Which of the two shrinks depends on whether the frame has been pinned by hand (`E22`):

- **Frame still free** (never resized by hand) → the frame follows the picture down, to the
  48 px minimum (`E25`).
- **Frame pinned** (an edge or a corner dragged) → the frame stays and the picture shrinks inside
  it, leaving background on all four sides.

`0` still fits the picture to the frame, so there is always one keypress back.

#### E24 · A drag outlives the frame's edges and the browser's
Start a pan and it follows the pointer wherever it goes — across the edge of the preview, across
the page, off the browser window entirely. That is not special-cased: the move listener is on
`document`, and while a button is held the browser keeps delivering `mousemove` with coordinates
outside the viewport.

What does *not* arrive is the `mouseup`, if the button is released out there. Without noticing,
the drag stays live and the picture follows the pointer back in with no button held — a window
that has apparently glued itself to the mouse. `e.buttons === 0` on the next move is the only
thing that can see it, and it ends the drag through the same `endDrag()` the ordinary release
uses, so the two paths cannot drift.

#### E23 · Edges and corners resize, and what the picture does depends on what it was doing
An ordinary desktop window: corners resize both axes, an edge strip resizes one. **Edges resize
as well as corners because corners are not always reachable** — the growth ceiling is above 1×,
so a frame can be larger than the browser window and have no corner on screen at all, while an
edge is a whole strip and there is nearly always one of those in view.

The frame is set directly and frozen there, with the opposite edge anchored. On the axis *not*
being dragged the frame grows about its centre, or the window would crawl diagonally while you
pull one edge straight.

What happens to the picture is decided by whether it was spilling when the edge was grabbed,
which keeps one gesture honest in both cases:

- **Picture at fit** → stays at fit, so the window gets bigger and so does the picture. This is
  what "stretch it to whatever size I want" means; growing grey bars instead would be a worse
  answer.
- **Picture already spilling** → the zoom is kept and the aperture simply shows more or less of
  it. Rescaling here would undo a zoom asked for deliberately.
- **Picture zoomed OUT below the fit** (`E26`) → the zoom is kept too, for the same reason: a
  deliberate zoom-out is as much a choice as a zoom-in, so the frame changes size around a
  picture that stays where it is.

**Aspect is free, and Shift keeps it** (v0.32.0 — it was the other way round). Pull one edge and
that one dimension changes; the window becomes whatever shape you drag it into. The lock used to
be the default because an edge drag that changes one dimension only just grows bands of
background down the sides, which was an incoherent state before `E26` allowed the frame to be a
different shape from the picture. It is an ordinary one now. **Shift** locks the aspect to the
frame's shape *as it was when the edge was grabbed* — locking to the picture's shape instead
would snap the frame the instant it was touched.

**A hand resize PINS the edges** (`view.fixedW`/`fixedH`), and since v0.34.0 it is the only thing
that does — moving the window leaves the size alone (`E22`). From then on the frame is exactly
what was dragged and the picture letterboxes or spills inside it; zooming no longer changes the
window at all. Bounds are 48 px at the bottom and the growth ceiling at the top.


#### E20 · The band across the top of the page
`P10` refuses the one picture above where a page's content begins: a channel banner, a forum
masthead, a promo strip, a leaderboard ad. Rewritten in v0.38.0 against `banner-test-sites.md`,
~40 live pages probed in two browsers.

| Test | Default | Why |
|---|---|---|
| Its top is within `BANNER_TOP` of the top of the **document** | 300 px | above where content begins. Document, not viewport, or every picture drifts into the band as you scroll |
| At least `BANNER_MIN` wide on screen | 240 px | kills logos, avatars and icons. Real mastheads were measured at 250, 300, 304 and 340 px, so it cannot be much higher |
| **It is a band** — width ÷ height at least `BANNER_BAND` | 3 : 1 | the condition that carries the decision. A banner is a strip; a picture is not |
| Nothing of its own height sits beside it | `BESIDE_PEER` 0.15 of its width, `PEER_HEIGHT` within 30 % of its height | a picture with a comparable one to its left or right is one item in a row |

**The shape test is the whole rewrite.** Until v0.38.0 the last condition was "fewer than two
other pictures on the page share its width", and it decided both answers by coincidence:
homedepot.com's promo banner previewed because four *more* promo banners further down formed the
set that proved none of them was a banner, and xkcd.com's store strip previewed because two
unrelated 520 px images happened to fall within 10 % of 540. Symmetrically, every photo site's
detail page — unsplash, flickr, pexels, wallhaven, safebooru, furaffinity — was **refused**,
because one big picture near the top with nothing beside it and nothing sharing its width is
exactly a masthead by those rules. FurAffinity showed both directions on one screen: the artwork
refused while three ads above it previewed.

Measured, the two groups do not overlap. Banners run 3.0 : 1 (4chan's board banner) to 33.8 : 1
(a Steam page strip); content runs 0.65 : 1 (an ArtStation portrait) to 2.4 : 1 (a NASA hero).
The gap between 2.4 and 3.0 is empty.

**The width-set condition was deleted, not repaired.** A stack of same-width bands down a page is
Home Depot's promo column *and* a hypothetical column of banner-shaped content, and no layout test
separates them. Residual cost, stated because it is real: a one-column gallery whose tiles are
wider than 3 : 1 and whose first tile starts in the top 300 px loses that first tile.

**Two conditions were also nudged by the corpus.** The row-mate must now be about the same
**height** — on furaffinity.net a 320×50 skyscraper ad sat beside a 728×90 leaderboard and
rescued it — and `BESIDE_PEER` dropped from a quarter to 0.15, because the height test kills the
YouTube avatar the quarter was invented for, and a quarter was sitting on 500px.com's exact
geometry (276 / 1104 = 0.250000, saved only by `>=`).

**It judges CSS backgrounds as well as `<img>`, deliberately.** `E17` says no furniture rule
touches an `<img>`; this is the narrow exception to that, and it runs in the other direction too.
SoundCloud's profile banner is a 4.8 : 1 CSS background that escapes all five `E17` tests, and
`P10` is the only thing that catches it.

The `bannerGate` line in the debug log names the deciding condition and its numbers either way.
Test-page cases 39–41 cover the DOM half (the row-mate test and its four decoys);
`test-resolver.js` asserts the shape half against every measured page in the corpus.

**Verified live, 2026-09-04, after shipping:** all 8 reachable MISS pages now refused and all 9
reachable FALSE POSITIVE pages now preview, with the same geometry the corpus recorded before the
rewrite — so the flips are the gate changing, not the pages. Every control held. Three sites could
not be re-measured (FurAffinity is behind a bot check; Unsplash and 500px never render their
photo into the DOM). The table is in `banner-test-sites.md`.

#### E19 · An upgrade has to be the same picture, not just a bigger file
A bigger version of a picture keeps its proportions. Since v0.22.0 a candidate whose aspect
ratio is more than **4×** away from the thumbnail's own is refused: it is a different image, not
a bigger one. The tolerance is loose because a thumbnail is often a *crop* — a square thumb of a
3:2 photo is 1.5× off — and all of those still pass. The case it exists for is a 1200 × 125
forum masthead answering with a 600 × 600 sidebar picture: 9.6× apart.

It applies to the linked page's declared media too (`E15`), which is otherwise trusted
unconditionally: a banner links to the section it heads, and that section's `og:image` is its
own artwork, a different picture rather than a smaller one.

Only pictures with a **natural** size are judged — an `<img>` or a `<video>`. A CSS background
has none, and the shape of its box is not the shape of its image. Unconditional since v0.39.0
(it was `sameShapeOnly`).

Two related guards, invisible unless they fire: a URL caught returning two different pictures is
refused for the rest of the tab, checked against the browser's own copy of the thumbnail and
again when the frame loads it. Note that a browser generally does **not** re-request a URL the
page already displays, so these are quiet in practice; the shape test is what carries this.

#### E18 · The pointer may never touch the picture at all
Thumbnail grids very often lay something across the whole card — an absolutely positioned `<a>`,
a caption layer, a hover overlay, a click-catcher. The pointer then lands on that cover and the
picture beneath is never considered, so hovering the card does nothing at all. Measured on
gifwow.com 2026-09-03: `figcaption > a[href="/go/…"]`, 393 × 510, exactly over the `<img>`.

Since v0.21.0 the cover is looked through, and the preview is for the picture underneath. Two
bounds keep that from reaching too far:

- **Only an `<img>` or a `<video>`** is picked up this way, never a CSS background. Content
  stacked on top of a background is the signal that the background is a *backdrop* (`E17`), so
  the same fact means opposite things for the two, and the element type is what separates them.
- **Same card only** — an ancestor of the cover, within four levels, that holds the picture and
  holds exactly one laid-out picture. Two under one cover is a grid, and there is no answer to
  which one. Hidden media is not counted: gifwow's card also holds a `display:none` loader
  `<img>`.

While such a preview is open, moving between layers of the same card — cover to caption to badge
— is *not* leaving the picture, so it does not close and reopen. Leaving the card does close it,
at once, as `T06` says. Unconditional since v0.39.0 (it was `hoverThroughOverlays`).

#### E17 · What counts as a page background
`P7` is five tests, any one of which refuses a CSS background image. All five are measurements,
not guesses at intent:

| Test | Why |
|---|---|
| It is `<body>` or `<html>` | the page's own background |
| It repeats **and** has an `auto` size | laid end to end at natural size — a texture. Repeat *alone* is the CSS default, so a hero setting only `background-size: cover` computes to it too and would be caught by the looser rule |
| `background-attachment: fixed` | it does not scroll with the page, so it is a backdrop by construction |
| It spans ≥ 98 % of the window width | a masthead, hero, section stripe or footer. A tile inside a centred container never reaches both edges |
| It carries ≥ 40 characters of the page's own text | the content is sitting on it. The threshold lets a tile's caption through and catches real copy |

None of these apply to an `<img>`. A full-width photo, a photo with a caption over it, a photo in
a header — those are ordinary shapes for a picture that genuinely is the content.

Deliberately *not* used, and not to be added without a measurement: class and id matching
(`/hero|banner|bg|masthead/`), filename patterns, `alt=""`, and "require a positive signal before
previewing at all". Those are guesses about intent, and a wrong exclusion here is **silent** —
the image simply stops previewing, with nothing on screen to say why.

#### E16 · The thing you hover can be the clip itself
On Imgur's gallery and gifwow's grid the animation in the grid is a `<video>`, not an `<img>` —
there is no still image under the pointer at all. Until v0.20.0 that was refused outright, so
hovering a gif produced nothing: no preview, no spinner. It now previews like any other picture,
resolving through `E15`'s linked page.

Only a gif-style clip (`E12`: muted, controls-less, looping or autoplaying, under a minute) can be
hovered this way, and of the four video tests only the **link** one applies to it — a clip is
trivially inside itself, so the rest would refuse every clip on every page. That link test is what
keeps a video site's listing refused: test-page cases 27 and 28 are the same clip, and only the
one under a `/watch?` link stays silent.

#### E15 · The original can come from the page the thumbnail links to
Since v0.19.0 a hover also fetches the linked page — same site only — and reads what it declares
as its own media (`og:video`, then `og:image`). That is the picture or clip you would have got by
clicking through, so it is **not size-checked**: it wins even when it is smaller than the
thumbnail, and it ends the search. It runs alongside the ordinary probes rather than ahead of
them, so a local guess still paints immediately and this replaces it in place when it lands —
`E8`'s docked ring is the signal that it is still coming.

The page must agree about which page it is: if `og:url` names a different path, nothing it
declares is used and no preview opens. That guard is why the feature is safe to skip the gate —
a live Imgur fetch returned another post's document, and another returned a shell whose
`og:image` was the site logo. Unconditional since v0.39.0 (it was `followLinks`); note that
hovering a linked thumbnail makes a request the site can see.

#### E14 · The preview itself may be a video
Some animated posts have no image form at all: an Imgur *video post* answers `.jpg` with one
frozen frame, and the moving original exists only as `.mp4`. Since v0.18.0 the frame can show
that clip instead of a picture — muted, looping, no controls, and every gesture (`S05`–`S17`)
behaves exactly as it does for a still. The ▶ in a placed window's status bar turns it off for
the rest of the tab (`E27`), and the frozen frame is
what you get instead.

Two precedence rules go with it, both invisible until they are wrong. The video candidate is
probed **first**, because on Imgur the clip and the still have identical pixel dimensions and
first-probed wins a tie. And **an upgrade may not trade motion for a bigger still** — a
1600 × 1200 frozen frame does not replace a 640 × 480 clip of the same post, though a bigger
*clip* still does. Test-page case 23 fails if either regresses.

#### E12 · A wall of playing clips is a picture page, not a video site
`P4` asks which of two kinds a `<video>` is. A **player** — a play button, a volume slider, a
quality menu, one per page — suppresses previews over it and around it, because a preview there
covers the thing being clicked. A **gif** — Imgur's gallery, gifwow's grid: short, muted, already
playing, no controls — suppresses nothing, and the page it sits on previews like any other.

All four properties are required together: no `controls`, `muted`, `loop` or `autoplay`, and a
duration of a minute or less. Each alone has a false positive (a site drawing its own chrome has
`controls` false; any player started under an autoplay policy is muted), and an **unknown**
duration — a cued player that has never been started — counts as a player, which is the safe way
to be wrong. What this cannot judge is the destination: a muted, playing, controls-less clip on a
video site's listing page is pixel-for-pixel the Imgur shape, and only the ancestor link
separates them. Test-page cases 21 and 22 are the same card twice, differing only in `controls`.

#### E13 · The frame reaches the bottom of the window — RETIRED in v0.33.0
The browser paints its own status text — the address of the link under the pointer, "Waiting
for…" — along the bottom edge of the content area, over everything the page draws. `bottomReserve`
(30 px) used to be taken off the usable height before any other geometry so that nothing was ever
drawn under it.

**That was worth having when a preview was clamped inside the browser window**: the status bar
could end up permanently beneath the browser's own chrome with nothing the user could do about
it. A window can now be dragged anywhere and resized freely, so "the browser is covering the bar"
is answered by moving the window — and the reserve's only remaining effect was to stop the bar
from ever reaching the true bottom of the screen, which is where a window's title bar belongs.
The setting is gone and the key is deleted on read. Measured on a 785 px viewport: the frame now
closes at 781 px, the ordinary 4 px gutter, against 751 px before.

#### E8 · An upgrade is almost never visible
`S06` / `S15` work, but the candidate list is ordered best-first, so the first hit is
usually already the largest and there is nothing to upgrade to. On top of that the docked ring
only appears if the search is still running 150 ms after the first hit, which a fast site never
reaches. Test-page case 20 is built to make one observable: it opens at 800 × 600, docks the ring,
and swaps to 1600 × 1200 three seconds later.

#### E9 · The browser's own context menu is the one that can save and copy
There used to be a ⋮ button at the right end of the status bar carrying *Open in new tab*, *Copy
URL*, *Copy image* and *Save image…*. Two of those could not work: they ran in page JavaScript, so
they needed the image host to send `Access-Control-Allow-Origin`, and Copy needed clipboard-write
permission on top. Most hosts send neither and nothing in a page context gets around it. The
button was removed in v0.12.0.

The browser's own menu has neither problem — its network stack, its already-decoded bitmap — so a
**placed** window hands right-click back to it (`T21`). The element under the pointer is our
`<img>`, whose `src` is the resolved full-size URL, so *Save image as…*, *Copy image*, *Copy image
address* and *Open image in new tab* all act on the original. Verified in a real browser
2026-09-03, including that native chrome targets an `<img>` inside an open shadow root.

`S05` keeps right-click-to-dismiss, and has no choice — it is pointer-transparent, so the menu
there comes up for the thumbnail underneath and offers to save *that*.

The cost of the v0.28.0 collapse falls here: `S07` also dismissed on a right-click, so "shove it
aside, then right-click to be rid of it" was a two-gesture disposal. A window dragged aside is now
placed, so that press belongs to the browser, and disposal is Escape or a click outside.

#### E10 · The status bar fades itself out
It is drawn *on* the picture, so on a meme, a screenshot or a comic panel it covers the text at
the bottom. It fades after one second of a still pointer, and the fade itself then takes 1.2 s;
it returns the moment the pointer moves over the window, in 120 ms. The two halves are different
numbers on purpose — the fade is the whole of your reaction time, while the return is a control
you have just asked for and must not feel laggy.

**A pointer resting on the bar itself never lets it fade**, however long it sits there: the bar
carries the `⊘` (`E11`) and the filename, and a control that vanishes under a resting cursor
cannot be used. The test is geometric, not a hover state, because on `S05` the bar is
pointer-transparent.

A faded bar also drops its `pointer-events`, so it stops being an invisible move handle — a press
where it was pans or moves by the ordinary rule (`S13`/`S14`), and moving the pointer first brings
the real handle back. `showStatusBar` still turns it off entirely.

#### E11 · The ⊘ button, and why it is not on a hover preview
The status bar of a **placed** window (`S10`) carries a `⊘` beside the metadata: it adds
the image to the never-preview list (`P8`) and closes the window. It is the answer to a page whose
tiled background or watermark opens a preview from every patch of blank space.

It is absent from `S05` because a hover preview is pointer-transparent, so a button drawn on it
cannot be clicked at all. The gesture is therefore hover → click to pin → `⊘`,
which the settings panel states outright, because it is not guessable from the UI.

It records **two** URLs — the one on screen and the source element's own `src`. Those differ
whenever the preview was an upgrade, and blocking only the resolved one would leave the thumbnail
still opening a preview that then failed to upgrade.

`skipFurniture` (`P7`) handles the common case with no gesture at all; `⊘` is for everything
that rule cannot know about.

---

## Where this lives in the code

| Area | Functions |
|---|---|
| Eligibility (`P1`–`P6`) | `eligible`, `inVideoContext`, `overVideoSurface`, `siteEnabled` |
| Hover state machine (`R1`, `R2`, `S01`–`S06`, `S16`) | `onOver`, `onOut`, `cancel`, `dismiss` |
| Press / click ownership (`E1`) | `pointInPreview`, `onBoxDown`, `onBoxClick`, the document `mousedown` and `click` listeners |
| Press regions and dragging (`S13`, `S14`, `S19`, `E21`, `E23`, `E25`) | `hitRegion`, `regionCursor`, `onBoxDown`, `onMove`, `resizeBy` |
| Placed mode (`S10`–`S15`, `S19`) | `place`, `unplace`, `onPinKey`, `onPinWheel` |
| Wheel zoom, both states (`T17`, `T22`, `T24`) | `enableWheelZoom`, `disableWheelZoom`, `onPinWheel` |
| Geometry (`S12`, `E7`, `E21`, `E25`, `E26`) | `view`, `reflow`, `layout`, `zoomAt`, `pannable`, `viewportBox`, `growBox`, `clampPosition`, `fitScaleFor`, `minScaleFor`, `chrome`, `insetX`/`insetY`, `outerW`/`outerH` |
| Upgrades (`S06`, `S15`) | `resolve`, `upgradeViewer` |

Function names are used rather than line numbers, which rot.

---

## Changes

| Date | Change |
|---|---|
| 2026-09-04 | v0.37.0. **`stickBar()` is gone: the status bar sits at the frame's own bottom, always** (`E21`). Three versions of a float that held it on screen were each reported as overriding a deliberate move, and the reason is structural — a window nobody can reach and a window pushed off the bottom on purpose are the same geometry, so no position test separates them. The trap it guarded needed a frame frozen at screen size, which v0.34.0 removed: an un-resized frame shrinks on zoom-out, so scrolling back out escapes the state scrolling in created. |
| 2026-09-04 | v0.36.0. **The status bar only floats up the frame when no strip of the frame margin is on screen** (`E21`) — "is there another handle", not "where is the frame". v0.35.0's `view.top < 0` test was too coarse: a frame taller than the viewport still has its top off screen after being dragged down, so the rescue fired on the very gesture it was meant to leave alone. Also: the bar now carries **(click this window to pin it)** while the window is only hovered, and drops it once placed (`E10`, `S05`) — a hover preview is pointer-transparent, so nothing on it invites a click. |
| 2026-09-04 | v0.35.0. **The status bar only floats up the frame while the frame's top edge is off screen too** (`E21`). It rides the visible bottom so a frame grown past the viewport still has a title bar in reach — but a window deliberately dragged down past the bottom of the browser is not that case, and the bar floating back into the picture rather than leaving with the window was reported as a bug. `view.top < 0` separates the rescue from the override. |
| 2026-09-04 | v0.38.0. **`E20` is rewritten around the SHAPE of the picture** and now has a section of its own. The old gate decided by comparing one width against a bag of other widths, which made both answers a coincidence — homedepot.com's promo banner previewed because four more promo banners formed a "set", and every photo site's detail page (unsplash, flickr, pexels, wallhaven, safebooru, furaffinity) was silently refused because one big picture near the top shares its width with nothing. A banner is a **band**: 3:1 or wider, measured across ~40 live pages in `banner-test-sites.md`, where banners run 3.0–33.8 and content runs 0.65–2.4 with nothing in between. The width-set condition is **deleted** — it cannot be repaired, since a stack of same-width bands is both a promo column and a gallery. `BANNER_TOP` 200 → 300 and `BANNER_MIN` 400 → 240, both of which the shape test now makes safe; the row-mate must be about the same **height** (an ad no longer rescues an ad); `BESIDE_PEER` 0.25 → 0.15, off 500px.com's exact geometry. `P10`'s judging of CSS backgrounds is now deliberate and documented rather than accidental. |
| 2026-09-04 | v0.34.0. Three changes to the placed window, all of them reported together. **Moving it no longer freezes its size** (`T25` retired, `E22`): the frame follows the picture up to the growth ceiling for as long as the window is alive, and only a hand resize pins it (`E23`). The freeze was v0.29.0's, and v0.31.0 quietly made it fatal — once the wheel belongs to the page while hovering, zooming means placing first, placing is a press, and a press that wandered three pixels was a move, so every window was frozen at its opening size before it could be grown and `maxSizeMultiple` was unreachable. **Zoom is anchored on the pointer** rather than on the frame's centre (`E22`, `T17`), so a growing window expands away from the cursor and a shrinking one collapses towards it instead of walking its edges past the pointer and handing the wheel back to the page. **The X button is gone** (`T16`, `E25`, `E9`, `E11`) — Escape and a click outside already close a placed window, and the button sat in the corner the hand reaches for to resize. |
| 2026-09-05 | v0.39.0. **The settings panel was rewritten around what a person can actually decide.** Seven switches retired because each had only one sane answer, and a setting nobody can name the effect of is not a choice: `sameShapeOnly`, `keepSearching`, `followLinks`, `hoverThroughOverlays` and `skipWhileMouseDown` are unconditional; `skipVideos` is inverted into **`previewVideos`, off by default**; `skipBanners`/`skipDecorative`/`skipPageBackgrounds` fold into one **`skipFurniture`**. `playVideos` leaves storage entirely for new `E27` — a `▶` in a placed window's status bar, shown only while the frame holds a clip, that turns clips off for the tab. New `E28` — the modifier key now works in **either order** (`P6`, `K7`), where pointing first and then pressing it used to do nothing. The panel itself gains a three-sentence description and a **How it works** button (which is where the instruction rows scattered through it now live), folds every timing, pixel count and colour into an **Advanced options** section, and gives both lists an **Edit as text** mode — one entry per line, committed on blur — with entries kept alphabetical. |
| 2026-09-04 | v0.33.0. **Stored settings were being discarded on every page load** and the script ran on defaults until something opened the panel — `readSettings()` is hoisted and the `cfg` initialiser called it while `const RETIRED` was still in its temporal dead zone, so the ReferenceError was swallowed by its own catch. Broken since v0.28.0. Also: the resize strip now straddles the window edge, **6 px outside and 6 px in**, with 13 px of move band beyond it (`E25`); the status bar **no longer outranks a resize**, so the bottom corners and the bottom edge resize like every other edge, and it keeps precedence only over the middle, which is what still matters when `stickBar()` has parked it up the picture (`E21`); `bottomReserve` is retired (`E13`); the manager's menu gains **Enable/Disable for this site**, labelled by what pressing it would do; and the settings panel's Save row is sticky. |
| 2026-09-04 | v0.32.0. **Moving a window now sets a size CEILING rather than a fixed size** (`T25`, `E22`): zoom out afterwards and the whole window shrinks with the picture the way it did before the move, zoom back in and it stops at the size it was given. `reflow()` gains a third mode for it — `sizeLock` is free, `'max'`, or `'exact'`. **A hand resize is the `'exact'` one** (`E23`) and is the only thing that pins the edges. **And a hand resize is now free-aspect, with Shift to keep the shape** — the reverse of before; the lock existed because a one-axis drag grew bands of background, which `E26` has since made an ordinary state rather than an incoherent one. |
| 2026-09-04 | v0.31.0. Two corrections to v0.30.0, both reversing something it had just decided. **The wheel is the page's again while you are only hovering** (`E22`, `T22`, `K2`) — it scrolls and the scroll closes the preview; growing the window is a placed-window gesture now, one click away. v0.30.0's version stole the scroll wheel from every hover to buy one gesture, which was a bad trade. **The frame margin is drawn ON the picture** (`E25`), the way the status bar always was, rather than laid out around it: the window costs no extra size, the minimum drops from 98 px to 50 px, the ring is mostly transparent, and it fades with the bar — and stops being a handle while faded, which is what makes an overlaid ring safe where an invisible band was not. |
| 2026-09-04 | v0.30.0. The window grew a frame. New `E25` — a `frameMargin` (24 px) ring on all four sides, drawn, that moves the window at any zoom; the status bar fills the bottom one. It is the invisible move band of v0.28.0 done properly, and it retires the `showStatusBar`-off trade in `E21`. With it: a 48 px minimum aperture (~98 px window), because `minDisplayed: 0` was producing previews too small to hold their own controls; the ⊘ moved to a fixed 20 px from the right edge, absolutely positioned so a long filename can no longer push it off the bar; the X moved inside the picture, clear of the resize corner. New `E26` — the picture may now be smaller than the frame: the zoom floor is an absolute 32 px rather than the fit, and a frozen frame keeps its size while the picture shrinks inside it. `E23` gains the matching case, and a resize no longer snaps a deliberately zoomed-out picture back to fit. |
| 2026-09-04 | v0.29.0. Three refinements to v0.28.0's two-state model, all of them making the window behave more like an ordinary desktop window. **The wheel now places it** as well as growing it (`T22`) — growing something that dies as soon as you move the pointer is not a gesture anyone can finish. **Moving it is what freezes the size** (`T25`), not placing it, so the sequence is scroll-to-size then put-it-somewhere. **Edges resize as well as corners** (`E23`), because a frame larger than the browser window has no corner on screen to grab. The move band that sat just inside the resize strip is gone with them: two bands 30 px apart is a mis-grab waiting to happen, so moving a spilling frame is the status bar's job, exactly as a title bar's is (`E21`). New `E24` — a pan started inside now provably survives leaving the frame and the browser, and ends itself if the button was released out there. Found while verifying and fixed with it: the status bar now rides the bottom of the frame's VISIBLE part, because a frame grown past the window and then zoomed until it spills covers the whole screen and left every gesture a pan, with only Escape out. |
| 2026-09-04 | v0.28.0. **The detached state is gone, and with it the three-rung ladder.** There are two states now: hovering, held by the image, and placed, held by nothing. A press on the window — click, drag or corner, on the press rather than the release — is the whole of the difference. Retired: `S07`, `S08`, `S09`, `S11`, `T08`, `T09`, `T11`, `T12`, `T13`, `T14`, `T20`, `E3`. New: `R2` (one window at a time), `S19`, `T22`–`T24`, `E21` (a placed window may hang off the screen, and a 20 px edge band always moves it), `E22` (the wheel grows a hover preview, and placing freezes the size), `E23` (corner resize). Changed: `R1` loses its third answer; `S10` is no longer modal — the page under it still scrolls and can be read, only clicks and new previews are held off; `E7` — `maxWidthPct`/`maxHeightPct` are replaced by one `maxSizeMultiple`, so a preview opens filling the window and may grow to 2× it; `E2` — a click outside a placed window suppresses, because it usually lands on the thumbnail; `E9` — right-click no longer shoves a window aside, which is the cost of the collapse. `dimOpacity` is removed: the backdrop is now invisible and exists only to catch the dismissing click. |
| 2026-09-04 | v0.27.0. `E20` no longer counts pictures nobody can see. A rotating banner is often a cross-fader — two stacked images of identical size, one at `opacity: 0` — and an invisible element still has a full-size rectangle, so the page held "two pictures of that width" while showing one. |
| 2026-09-04 | v0.26.0. Two fixes for one reported page, a forum masthead. `E20` condition four now needs two other pictures of a width before calling it a set — the page had exactly one. And `showEvenIfNotLarger` no longer shows the displayed image back at its own size: that setting means "at natural size even though it is not much bigger", not "an identical copy", and it was the only thing producing a preview there at all. |
| 2026-09-04 | v0.25.0. `E20` condition three now ignores a neighbour under a quarter of the candidate's width: measured in LibreWolf with YouTube's left guide open, a 24px subscription avatar sat in the banner's band and defeated the whole rule. The gate also reports every failing condition rather than the first, because naming only one guarantees a second round trip. |
| 2026-09-04 | v0.24.0. `E20` unchanged in behaviour except that a copy of the banner no longer counts against its uniqueness; what changed is the reporting — `bannerGate` now names the deciding condition and its numbers whichever way it goes, because the first report after v0.23.0 was "excluded in Chrome and Firefox, not in LibreWolf" and a bare "not a banner" cannot answer that. |
| 2026-09-04 | v0.23.0. New `P10`/`E20` — the banner across the top of a page. v0.21.0 declared that no furniture rule would ever judge an `<img>`, which was reasoned from one example rather than measured, and it made both `E17` and `E19` unable to see the thing the user was actually reporting: a YouTube channel banner is an `<img>`, with nothing in its markup to distinguish it from a video thumbnail. |
| 2026-09-03 | v0.22.0. New `E19` — an upgrade must be roughly the same shape as the thumbnail, because a rotating forum banner was answering a 1200×125 masthead with an unrelated 600×600 picture. Also, and this is the actual fix rather than the backstop: the generic query-strip rule no longer fires on a path with no media extension, since `?loc=header` is the request rather than a resize. Not visible here: the debug log now names which of the six mechanisms produced the preview. |
| 2026-09-03 | v0.21.0. New `E18` — a cover laid across a card is looked through to the picture under it, which is what made gifwow's grid (and many others) do nothing on hover. `P7` widened into `E17`: a CSS background is also refused when it is fixed, spans the window's width, or carries the page's own text — and the whole gate is now stated as applying to backgrounds only, never to an `<img>`. New `P9`/`skipDecorative` for `aria-hidden` and `role="presentation"`. |
| 2026-09-03 | v0.20.0. `P1` widened and new `E16` — a playing gif-style `<video>` can now be the hovered element. It could not be before, which meant that on Imgur's gallery, the site all of this was built for, hovering a gif did nothing at all and both `E14` and `E15` were unreachable. |
| 2026-09-03 | v0.19.0. New `E15` — the linked page is fetched and what it declares as its media is used directly, without a size check, because the item page's media *is* what the thumbnail stands for. Guarded by an `og:url` identity check, same-origin only, `followLinks`. |
| 2026-09-03 | v0.18.0. New `E14` — the preview may itself be a muted, looping video, because an Imgur video post's only moving form is an `.mp4` and "images only" meant "no answer" for it. `P1` unchanged: what is *hovered* is still a picture; this is about what the frame can *display*. |
| 2026-09-03 | v0.17.0. New `E12` — `P4` now asks whether a `<video>` is a *player* or a *gif*: a short, muted, controls-less clip that is already playing is an animated picture, suppresses nothing, and no player box is derived from it, so Imgur's gallery and gifwow's grid preview normally while video sites stay refused. New `E13` — `bottomReserve`, a 30 px strip kept clear at the bottom of the window where the browser paints link addresses over the picture. |
| 2026-09-03 | Written against v0.9.0. Initial IDs `R1`, `P1`–`P6`, `S01`–`S17`, `T01`–`T19`, `K1`–`K8`, `B1`–`B2`, `E1`–`E6`. |
| 2026-09-03 | v0.10.0. New: `T20` (wheel zooms a detached window), `E7` (the 92 % frame cap), `E8` (why upgrades are never seen). Changed: `S05` — the old text said clicks pass through the window, which contradicted `E1`; they do not, and only hover and the wheel do. `S07` — accepts the wheel. `S10`/`S11`/`S13`/`S14` — a drag now pans only while the picture is spilling and moves the frame otherwise, so a pinned frame at its opening scale can be dragged from anywhere; the status bar still always moves it. `P4` — a third video signal, the element sitting inside a laid-out `<video>`'s rectangle, because the ancestor walk's "still one card" bound was ending the search before the video test on a watch-page player. Also fixed, and not visible in this document: the closed window used to stay hit-testable, leaving an invisible rectangle that ate clicks and blocked hover where the window had been. |
| 2026-09-03 | v0.11.0. New: `T21`, `E9` — right-click on a *placed* window now raises the browser's own context menu instead of dismissing, which is the only way `Save image as…` and `Copy image` work. `S05` keeps right-click-to-dismiss. `B1` changed accordingly; `B2` was already behaving this way and is unchanged. |
| 2026-09-03 | v0.16.0. `E10` — the fade now takes 1.2 s rather than 220 ms, and a pointer resting **on** the bar holds it open indefinitely; a control that disappears under a still cursor cannot be used. `E1` — the pin claim moved from document to window capture and now stamps `data-userscript-click-claim` on `<html>` during the press, because Open Links in New Tab v1.19.0+ also sits on window capture and was taking the click that pins a preview. Not visible here: an imgur `UPGRADES` rule (a GIF post's thumbnail is a static frame, and `.webp` is imgur's de-animating transcode), and the settings panel's site and never-preview lists rebuilt as add/remove rows matching the sibling scripts. |
| 2026-09-03 | v0.15.0. `P4` widened: the geometry gate now tests the **player box** derived from each `<video>`, not only the video's own rectangle. Measured on a LibreWolf watch page, the cued player lays its `<video>` out exactly its own height above the poster, so the two never overlap and the poster previewed. |
| 2026-09-03 | v0.13.0. New `P7` (page and tiled backgrounds are never previewed) and `P8` (a user-maintained never-preview list), and `E11` for the `⊘` button that fills it from a placed window. `E10`'s fade is now one second rather than two. Not visible here: a `debug` setting that logs which gate decided each hover, and a video-link gate that now finds an ancestor `<a>` across a shadow-root boundary, which plain `closest()` cannot do. |
| 2026-09-03 | v0.12.0. `T21` narrowed to `S10`: only a **pinned** window gives right-click to the browser, and `S07` goes back to dismissing. The ⋮ image-actions menu is removed, so `E9` is now about the browser's menu alone. New `E10`: the status bar fades after two seconds of a still pointer and returns on movement over the window, because it was covering the text on memes and screenshots. |

This file is the only copy. A rendered HTML version used to sit beside it and was deleted in
v0.11.0 — it could only ever go stale, and there is nothing in it that is not here.
