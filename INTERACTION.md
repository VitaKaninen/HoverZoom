# Preview window — interaction reference

What the preview **window** does, as a state machine. Menus, buttons, the status bar contents and
the loading ring are out of scope except where they change what the window itself accepts.

Describes `Hover-Zoom.user.js` **v0.51.0**.

**This file is the vocabulary, not the reasoning.** Each item is one or two lines saying what the window does. *Why* it does it lives in [`docs/`](docs/) — `E` items point straight at the section that holds the argument, and every other ID can be found with `grep -rn "S05" docs/`.

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

**Retired, never to be reused:** `E4`, `E5` — defined against v0.9.0 and dropped without a note, so they were dangling citations for several versions — and `S07`, `S08`, `S09`, `S11`, `T08`, `T09`, `T11`, `T12`, `T13`,
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
| `S20` | dragging (zoom slider), placed | transient | the held button |
| `S21` | typing a zoom level, placed | placed | nothing |
| `S22` | holding the scrubber, placed (clip only) | placed | the held button |
| `S23` | speed menu open, placed (clip only) | placed | a press anywhere else |
| `S24` | volume column showing, placed (clip only) | placed | the pointer leaving it, after a delay |
| `S25` | touring — placed, stepping through the page's pictures | placed | nothing |
| `S26` | scrubbing — an arrow held, the counter running | transient | the held key |
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
| `P3` | Displayed no larger than `maxDisplayed` — **retired in v0.40.0**, nobody could name a reason to skip big pictures | — |
| `P4` | Not a media/plugin tag, and no **player** on this page covering it: not inside a `<video>`, not sitting in a **video surface** (a laid-out player's rectangle, or the player box derived from it), and no player in it or within three ancestors. A `<video>` that is muted, controls-less, looping or autoplaying, and under a minute long is an animated picture rather than a player — it is none of those things (`E12`). No setting — a player on the page always wins | — |
| `P5` | The site passes the blacklist / whitelist test. The host tested is the **page's**, not the frame's (`E29`) | blacklist, empty |
| `P6` | In modifier mode, the modifier key is held. **Either order** — hold it and then point, or point and then press it (`E28`) | activation = hover |
| `P7` | Not page furniture — a CSS background that is part of the page rather than a picture on it (`E17`) | `skipFurniture` on |
| `P8` | Neither the displayed URL nor any candidate is on the never-preview list | `blockList` empty |
| `P9` | Not marked decoration by the page itself: no `aria-hidden="true"`, no `role="presentation"`/`"none"` on the element | `skipFurniture` on |
| `P11` | Not a thumbnail leading AWAY to a video page: no ancestor `a[href]` matching the video-URL shapes. A different question from `P4` and a different setting since v0.59.0 — that one is about where you are standing, this one about where the picture goes (`E31`) | `videoMode` = `clips` |
| `P12` | Anything that moves is allowed to reach the frame at all — a video file by its URL, an animated GIF/WebP/APNG by sniffing its first 4 KB (`E27`, `E31`, `E32`) | `videoMode` ≠ `none` |
| `P10` | Not a **band** across the top of the page (`E20`) — a masthead, channel banner or leaderboard ad. The one furniture rule that applies to an `<img>` as well | `skipFurniture` on |

The element tested is not always the one under the pointer. When the hover target fails `P1`, a
single picture directly beneath it in the same card is tried instead (`E18`), and that picture
then faces every precondition here in its own right.

A candidate that passes all ten still shows nothing unless a probe finds an image **larger than**
`minRatio` (1.2×) times what is displayed — strictly, so 1 means "anything bigger at all" — **and
shaped like it** (`E19`) — see `T04`. Since
v0.40.0 that ratio applies to what a linked page declares as well; the page is trusted about
*what* the thumbnail stands for, not about whether it is worth a window.

`P7` is five separate tests, listed in `E17`. It applies to CSS backgrounds only; the one rule
that also judges an `<img>` is `P10`, and it is deliberately much narrower. `P10` runs on CSS
backgrounds too, which is not an accident — see `E20`.

`P8` is checked in three places — before the spinner (`eligible`), before any candidate is probed
(`collectCandidates`), and in the not-larger fallback — so a blocked image costs no request and
shows no ring.

`P9` reads the element itself and never an ancestor: carousels routinely mark cloned slides
`aria-hidden`, and those are real pictures on screen that a user will hover.

*Code: `eligible`, `eligibleDirect`, `coveredMedia`, `wallpaperReason`, `decorativeReason`,
`blockMatch`, `playerSurfaceReason`, `videoLinkReason`, `overVideoSurface`, `siteEnabled`, `onOver`.*

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
  default) it opens beside the pointer and is nudged the smallest distance that puts the pointer
  `REACH_INSET` (10 px) inside its edge. (`cursorGap` was retired in v0.40.0: that nudge always
  overrode it, so the gap could never survive.) With `position: center` it is centred in the
  window and the pointer is *outside* it, so the press that pins it is the one on the picture
  itself (`E30`). Either way it stays 4 px clear of the viewport's edges and **24 px clear of the
  bottom**, which is where the browser paints the link target it would follow (`STATUS_TIP_H`).
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
- **Its status bar carries four buttons, and only here**, right to left: ⛶ fill the screen
  (`E35`), ⊘ never preview this image, which asks first (`E11`), a no-play glyph that stops
  showing clips in this tab (`E27`, clip only), AA smooth-or-hard-pixels, a plain toggle
  (`E31`). **Every one of them clears the frame's grab bands** (`E37`). Only the ⊘ opens a
  popover, **upward** out of the bar; a press anywhere else in the frame closes it.
- **Over a clip, a translucent strip floats above the bar** (`S22`, `E36`): play/pause, elapsed
  time, a scrubber, playback speed and sound. It overlays the picture and reserves no layout, so
  it costs the zoom floor nothing. Hidden on a frame shorter than 110 px.
  - **Speed** opens a menu upward (`S23`) — 10/25/50/100/125/150/200/300 % plus a custom field.
  - **Sound** — the button mutes and unmutes and turns red while muted; hovering or clicking it
    reveals a vertical volume column (`S24`). The mute flag and the unmuted level are two
    separate values remembered **per site**, and every site starts muted at level 0 (`E38`).
- **And a zoom cluster left of those buttons:** a 100 px slider stepping through round zoom
  percentages, and the current level,
  which is clickable and becomes a text field (`S20`, `S21`). Zooming from either **holds the
  frame's bottom-right corner still**, so the control does not run away from the pointer driving
  it (`E34`). The level shows on a hover preview too, but only when it is off its fit; the slider
  is placed-only. **A placed frame is never narrower than its bar's controls** —
  274 px, or 298 px while the no-play button is there (`barMinW()`), and wider still if the
  frame margin is raised — the controls always clear the grab bands (`E37`).
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
- **Bounds:** clamped so the frame never shows past the edges of the picture — and **what the
  clamp refuses moves the window instead** (`E32`), so a frame bigger than the screen still has
  reachable edges.
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
- **Bounds:** no shorter than 48 px and **no narrower than `barMinW()`** — 274 px, or 298 px while
  the no-play button is there (`E34`, `E37`); at the default border that is a 276 × 50 window, which is what keeps the
  ⊘ reachable at any size (`E25`). No larger than the growth ceiling.

#### S20 · dragging (zoom slider), placed
Press on the slider in the status bar. Zoom follows the thumb from the picture's fit (or 25 %,
whichever is lower) up to `maxZoom` — but never below the scale at which the frame stops
shrinking and letterboxes the picture instead (`noBarsScale()`), which for a narrow picture is
well above 25 %. One slider step is one **round** percentage — 5 % apart up to
200 %, widening with the level (`ZOOM_BANDS`) — so 100 % and its neighbours are always on the
track. The ladder is never longer than the track has pixels, or the thumb could not land on every
stop (`fitStops()`); a bigger `maxZoom` therefore buys its range by coarsening the low end.
- **The frame's bottom-right corner does not move** while it grows or shrinks; the picture zooms
  about the frame's centre (`E34`).
- **The bar cannot fade while the drag is live**, even when the pointer wanders off it.
- Below-fit and above-`maxZoom` levels are still reachable by wheel and by typing; the thumb just
  sits at its end there.

#### S21 · typing a zoom level, placed
Click the level and it becomes a text field in the same slot.
- **Accepts anything** — `200`, `200%`, `1,000%`. Out of range is clamped, not refused, and the
  readout then shows what actually stuck.
- **Enter** applies and closes; **Escape** closes without applying and does **not** close the
  window.
- **Anything else that means "done" applies it too:** a press anywhere but the readout itself —
  picture, border, bar, the slider — and the pointer leaving the window. `blur` alone cannot
  carry this: `onBoxDown` calls `preventDefault()`, so a press on the window never moves focus
  off the field (`commitZoomField`).
- The window's own keys are suspended while it is open, or `0`, `-` and Escape would be eaten by
  the window instead of typed (`E34`).

#### S22 · holding the scrubber, placed (clip only)
Drag the scrubber in the floating strip to move through the clip.
- **The bar and the strip cannot fade while it is held** — `pointerOverBar()` counts the strip's
  rect as well as the bar's (`E36`).
- `timeupdate` keeps writing the readout but **must not write the thumb** while `seekDrag` is set,
  or the value fights the hand holding it — the same rule the zoom slider's `zoomDrag` follows.
- Arrow keys nudge it while it has focus, and the window's own pan keys stand aside (`capOwns`).

#### S23 · speed menu open, placed (clip only)
Click the speed readout and a menu opens **upward** out of the strip.
- 10/25/50/100/125/150/200/300 %, the current one marked, plus a **custom** field taking any
  percentage (clamped to what the media element accepts, 6.25–1600 %).
- **Enter** applies and closes; **Escape** closes without applying. The field owns the keyboard
  while it is open, or the window's own keys would eat the digits (`E38`).
- It is a popover, so a press anywhere else in the frame closes it and the bar cannot fade while
  it is up.

#### S24 · volume column showing, placed (clip only)
Hover the sound button and a vertical column appears above it; clicking the button also opens it.
- **Ends on:** the pointer leaving both the button and the column, after a grace period
  (`VOL_CLOSE_MS`). The delay is load-bearing — without it the crossing between the two loses
  the column (`E38`). Crossing *back* from the column to the button keeps it (`E38`). A drag that
  ends outside the box still counts as held.
- **Hovering the button with no mouse button held resets the hold**, so the column can never be
  stranded open (`E38`).
- **Dragging it to zero mutes**; the button toggles between silence and the stored unmuted level,
  which may itself be zero — then the button only changes the icon. Muted, the icon is red.
- **Changing the volume never starts a paused clip** (`E38`).
- Released, the level and the mute state are written to the **site's** entry as two separate
  values (`E38`).
- The column reaches above the strip, so the bar counts it as its own and will not fade under it.

#### S25 · touring
A placed window stepping through every picture on the page. The window stays put, the page does
not move, and each step swaps a different picture into the same frame.
- **Entered from:** the first ◀ / ▶ or navigating arrow press on any placed window (`T29`, `T30`).
  There is no separate mode to turn on; a pinned window is already carrying the strip. **The
  entering press does not advance** — the picture stays, the window slides to its corner, and
  the next press is the first step.
- **The list is derived on every press and kept nowhere** (`E54`). Lazy-loaded and newly appended
  images are picked up for free, and a virtualised feed deleting the picture under you is
  survivable — the anchor is the element, then its URL, then the place it was last seen.
- **Membership is `eligibleDirect()`**, so the tour can only hold things that would preview if
  hovered, and it inherits every gate — `videoMode`, the block list, the banner and furniture
  rules — with no separate list. Clips and images share one list. Elements with a CSS background
  image are hoverable but not in the tour.
- **Then the tour's own two gates, both read off the picture it started on** (`E60`): a floor on
  the shorter side as drawn (`tourMinDisplayed`, 128 — emoji, badges and avatars fall under it;
  a start picture smaller than that lowers it to its own size), and a **scope** — the smallest
  area of the page around the start picture that holds two or more pictures and is not merely a
  wrapper for them, so a forum post's ten pictures tour without the replies, the sidebar or the
  avatars. `{` and `}` move the scope a level in or out (`T37`).
- **Nothing is ever dropped for failing to resolve** (`E56`): a page of 50 gives a tour of 50, so
  the counter means what it says and a picture spotted half way down stays where it was.
- **The bottom-right corner is what does not move** (`E54`), because the buttons live there.
- **The frame is capped at the viewport** for as long as a tour is running — anchored bottom
  right, an oversized frame would run off the top-left and stay clipped there.
- **A short picture letterboxes** rather than shrinking the frame past the strip.

#### S26 · scrubbing
An arrow held down. OS key repeat is ~30/s, ten times the useful rate.
- The counter steps at up to `tourScrubRate` (5/s) and **nothing is resolved** until the key has
  been still for 150 ms. The counter is the feedback.
- Releasing resolves whatever the anchor landed on. Any other press cancels the pending resolve.

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
  outside it (`T16`) — which very often lands on the thumbnail it came from. **Only if the pointer
  is on that image at the moment of the dismiss** (`E44`); dismissed from anywhere else the image
  is not suppressed at all and hovering it again previews straight away.
- **Why it exists:** without it, the very next mouse movement over the same image would re-open what
  you had deliberately got rid of.
- **Ends on:** the pointer leaving that image and coming back (`T15`) — leaving through a child of
  it (a caption over a background image) counts, since v0.78.0. Other images are unaffected.

#### S17 · fading out
The window has been ended and is running out its `fadeMs` (90 ms) opacity transition. It is already
inert.
- **Accepts:** nothing. Not hit-testable, holds no state. A clip is paused the instant the fade
  starts, so sound never outlives the window (v0.78.0).
- **Then:** ~60 ms later the decoded image is released, so a long session does not accumulate
  bitmaps. One teardown timer at a time: a second fade started inside the first's window restarts
  it rather than being cut short by it.

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
| `T26` | `S10` | Single click on the picture — not the bar, not a control — with under 4 px of travel | `S10`; a clip pauses or resumes, a still image does nothing (`E39`) |
| `T27` | `S10` | Double click in the same place | `S10` fullscreen, or back out of it if already there. Click 1's pause is undone (`E39`); the border comes off for as long as it lasts (`E43`) |
| `T28` | `S10` fullscreen | Drag the picture, an edge, or the status bar | Nothing moves — fullscreen is locked to the screen, and the cursor stays an arrow. A spilling picture still pans, with the `grab` cursor, and panning past its edge does not carry the window with it (`E35`, `E40`) |
| `T29` | `S05` | `→` or `←` (or `[` / `]`) on a preview you are only hovering | `S25` — it pins, slides to the bottom-right corner and brings up the counter, **on the same picture**; the next press is the first step (`E54`) |
| `T30` | `S10`/`S25` | ◀ ▶ in the strip, or `→` `←` where the picture cannot pan sideways, or `[` `]` always | From `S10`: `S25` on the same picture, relocated. From `S25`: the next picture. Position and any hand-set size stay; zoom and pan reset; the **bottom-right corner does not move** (`E54`, `E55`) |
| `T31` | `S25` | Hold the key | `S26` — the counter steps at up to `tourScrubRate`/sec and nothing resolves until the key has been still 150 ms |
| `T32` | `S25` | ⊘ on the picture | `S25` on the next one — mid-tour, blocking means "not this one", not "close the window" |
| `T33` | `S25` | Reach a picture that will not resolve | `S25` showing the page's own thumbnail with the reason in the bar, and ↻ to ask again (`E56`) |
| `T34` | `S25` fullscreen | `f`, or the button, after stepping | `S25` windowed, fitted to the picture now in the frame and holding the bottom-right corner — not the zoom and top-left of the picture that went in (`E57`) |
| `T35` | `S25` | Get within 10 of the end of the list, or press ▶ at the end | The page is scrolled to the bottom and straight back, so a lazy feed loads its next batch; the counter grows and the tour carries on. You never see it move. Once an excursion returns nothing, it stops trying (`E58`) |
| `T36` | `S25` | Reach the end of a page that will not load any more | The **next page** is fetched and parsed in the background and its pictures join the list — the document is never navigated, so the window and the script survive. It stops when nothing on the page says which way is forward (`E59`). Only from a scope that is the whole page: a tour confined to one post stays on this page until `}` widens it (`E60`) |
| `T37` | `S10`/`S25` | `{` or `}` | The scope narrows or widens by one level of the page — the counter's total changes to say so. Never below two pictures, never past the whole page. An anchor left outside a narrowed scope shows as `– / n` and the next step goes by position (`E60`) |
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
| `K3` | Browser window loses focus | Modifier mode forgets a held key, since no keyup will ever arrive for it (`E28`). |
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

---

## E — known edges and consequences

Consequences of the design rather than decisions in their own right, and several are open to
change if you want them changed. **The argument for each one lives in `docs/`**, under a
heading tagged with the ID — `grep -rn "E22" docs/` lands on it. Keeping one copy is why
this table is a table.

| ID | What it is | Argument in |
|---|---|---|
| `E1` | A press on a hover preview is claimed by geometry, not by hit-testing | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E2` | A click outside a placed window suppresses the image it came from | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E6` | Leaving mid-search does not abort probes already in flight | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E7` | The growth ceiling — `maxSizeMultiple`, 2× the browser window | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E8` | An upgrade is almost never visible | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E9` | The browser's own context menu is the one that can save and copy | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E10` | The status bar fades itself out | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E11` | The ⊘ button, and why it is not on a hover preview | [`docs/GATES.md`](docs/GATES.md) |
| `E12` | A wall of playing clips is a picture page, not a video site | [`docs/GATES.md`](docs/GATES.md) |
| `E13` | The frame reaches the bottom of the window — **retired in v0.33.0** | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E14` | The preview itself may be a video | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E15` | The original can come from the page the thumbnail links to | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E16` | The thing you hover can be the clip itself | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E17` | What counts as a page background | [`docs/GATES.md`](docs/GATES.md) |
| `E18` | The pointer may never touch the picture at all | [`docs/GATES.md`](docs/GATES.md) |
| `E19` | An upgrade has to be the same picture, not just a bigger file | [`docs/GATES.md`](docs/GATES.md) |
| `E20` | The band across the top of the page | [`docs/GATES.md`](docs/GATES.md) |
| `E21` | A placed window may hang off the edges of the screen | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E22` | The wheel is the page's until the window is placed, then it grows the window | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E23` | Edges and corners resize, and what the picture does depends on what it was doing | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E24` | A drag outlives the frame's edges and the browser's | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E25` | *Retired in v0.71.0 — the grab border is gone.* The frame was a margin you could grab, drawn over the picture | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E26` | The picture may be smaller than the frame | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E27` | Turning off clips for the rest of the tab | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| `E28` | The modifier key works in either order | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| `E29` | The script runs in every iframe; the menu and the site test belong to the page | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| `E30` | A centred preview is pinned from the picture, not from the window | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E31` | “Is it a video” is three questions, and they get three answers | [`docs/GATES.md`](docs/GATES.md) |
| `E32` | An animated GIF or WebP is only detectable inside the file | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E33` | A later hit may never downgrade the frame | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E31` | Smoothing — the AA toggle, and why there are only two answers | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| `E32` | A pan that runs out of picture continues as a window move | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E33` | The settings panel is never modal, and who owns the keyboard and wheel | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| `E34` | The status bar's zoom slider and level, the bottom-right corner anchor, and why the percentage is CSS pixels rather than screen pixels | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E35` | Fullscreen — why the DOCUMENT goes fullscreen, why maximise IS the implementation, and the three points that nail it to the screen | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E36` | The floating video strip: why it overlays rather than reserves, and why not native `controls` | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E37` | Every control clears the frame's grab bands, and the padding trap that broke it | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E38` | Sound is remembered per site as two values, and starts muted everywhere | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E39` | Clicking the picture of a placed window: one click pauses, two fill the screen, and the 4 px slop that separates a click from a drag | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E40` | One cursor rule: `grab`/`grabbing` wherever a press would pan, `move` wherever it would move the window | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E41` | The grab border is gone and the bar is the only handle; `barMode` docks the bar when 'always'; outside fullscreen the whole preview holds it open | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E42` | Real fullscreen measures the screen with `innerWidth`, and frees the scrollbar's strip with `scrollbar-width:none` — `overflow` alone does not reclaim it there | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E43` | Fullscreen wears no border, and it goes before the fit measures — removed afterwards the frame stays short by it | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E44` | A dismiss suppresses only while the pointer is on the picture; armed from anywhere else nothing lifts it until the visit after next | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E45` | `naturalWidth` is density-corrected under `srcset`, so the "same URL, same picture" test compares ratio there, not pixels | [`docs/GATES.md`](docs/GATES.md) |
| `E46` | The probe budget falls on the guesses; the ancestor link and the displayed src are always tried, and a srcset list contributes two | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E47` | A fullscreen exit waits for the request still in flight, or the change it fires finds nothing to undo | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E48` | A media URL in the ancestor link's query IS the answer, so the page behind it is never fetched; and an anchor holding a strip of thumbnails only speaks for the biggest one | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E49` | The page's `img-src` CSP refuses the probe, silently and in a millisecond; the bytes are then fetched with GM_xhr and shown as `blob:`, or `data:` where blob is refused too | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E50` | Size parameters are dropped from an extensionless CDN path only when the last segment is an opaque id and the path is not a script endpoint | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E51` | GM_xhr's own timeout does not cover a pending permission dialog, so every GM_xhr here carries a second timer of its own | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E52` | A picture still silent after 3 s earns one ranged request, which says whether to keep waiting and for how long; a diagnostic that times out means slow, never dead | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| `E53` | A hover that resolved nothing AND hit a real failure shows the page's own picture with the reason; one that merely found nothing bigger still shows nothing | [`docs/RESOLVER.md`](docs/RESOLVER.md) |

| `E54` | The tour's list is derived on every press and kept nowhere; the anchor is an element and a position, never an index; the bottom-right corner is what stays still, and the slide to it happens once per pinned window | [`docs/TOUR.md`](docs/TOUR.md) |
| `E55` | `←`/`→` navigate only where the picture cannot pan sideways — per axis, so a tall picture pans up and down while they still step. `[` and `]` always navigate | [`docs/TOUR.md`](docs/TOUR.md) |
| `E56` | A tour never drops an entry: one that will not resolve shows the page's own picture with the reason and a ↻, where an ordinary hover shows nothing | [`docs/TOUR.md`](docs/TOUR.md) |
| `E57` | A zoom and a top-left corner belong to the picture they were taken on, so leaving fullscreen after a tour step fits the new picture and holds the bottom-right corner instead | [`docs/TOUR.md`](docs/TOUR.md) |

| `E58` | A lazy page is made to load more by a real scroll to the bottom and straight back — an IntersectionObserver sentinel cannot be spoofed. It works through fullscreen's `overflow:hidden`, and it stops for good once one attempt returns nothing | [`docs/TOUR.md`](docs/TOUR.md) |

| `E59` | Which link is forward is decided by three rungs — a declared `rel=next`, the hole in a numbered pager's range, then a forward word — and **ambiguity is refused, never guessed**. A harvested entry is a detached element carrying the page it came from, so its relative URLs resolve against that page and not against this one | [`docs/TOUR.md`](docs/TOUR.md) |
| `E60` | The tour is stricter than a hover, and the picture it started on is the example: a floor on the shorter side as drawn (`tourMinDisplayed`, lowered to the start picture's own size when that is smaller), and a **scope** — the outermost ancestor holding the same pictures as the smallest one that holds two, climbed past every wrapper (under 8 elements of chrome and 200 characters of text). `{`/`}` move it a level; the next page is only fetched from the whole page | [`docs/TOUR.md`](docs/TOUR.md) §1a |

`E3` is retired with the detached state (v0.28.0); `E4` and `E5` are retired as dangling.

---

## Where this lives in the code

| Area | Functions |
|---|---|
| Eligibility (`P1`–`P6`, `P11`, `P12`) | `eligible`, `playerSurfaceReason`, `videoLinkReason`, `overVideoSurface`, `videoPreviewsOn`, `siteEnabled` |
| Hover state machine (`R1`, `R2`, `S01`–`S06`, `S16`, `E44`) | `onOver`, `onOut`, `cancel`, `dismiss`, `stillUnderPointer`, `suppressed`/`suppressedCovered` |
| Press / click ownership (`E1`) | `pointInPreview`, `onBoxDown`, `onBoxClick`, the document `mousedown` and `click` listeners |
| Press regions and dragging (`S13`, `S14`, `S19`, `E21`, `E23`, `E25`) | `hitRegion`, `regionCursor`, `onBoxDown`, `onMove`, `resizeBy` |
| Zoom units (`E34`) | `zoomUnit`, `toShown`/`fromShown`, `fmtZoom`, `parseZoom`, `zoomStops`/`stopsKey`, `zoomLo`/`zoomHi`, `clampScale`, `fitScaleFor`, `displayScale` — see [`docs/ZOOM-UNITS.md`](docs/ZOOM-UNITS.md) |
| The cursor (`E40`) | `pressMode`, `applyCursor`, `regionCursor`, the `.box.pan` / `.box.placed:not(.pan)` CSS fallback |
| Furniture modes (`E41`) | `barMode`, `barShown`/`barFades`/`barVisible`, `barDock`, `applyIdle`, `barWanted`/`barOver`, `pointerOverCap`/`pointerOverBar`/`pointerNearBar`/`barHoverBand`, `syncFurniture` |
| Probing (`E19`, `E45`, `E46`) | `collectCandidates`/`SRCSET_KEEP`, `resolve`/`MAX_PROBES`, `probe`/`probeImage`/`probeVideo`, `IMAGE_PROBE_MS`/`PROBE_RETRY_MS`, `nativeSize`/`samePicture`/`markUnstable` |
| Placed mode (`S10`–`S15`, `S19`) | `place`, `unplace`, `onPinKey`, `onPinWheel` |
| Wheel zoom, both states (`T17`, `T22`, `T24`) | `enableWheelZoom`, `disableWheelZoom`, `onPinWheel` |
| Geometry (`S12`, `E7`, `E21`, `E25`, `E26`) | `view`, `reflow`, `layout`, `zoomAt`, `pannable`, `viewportBox`, `growBox`, `clampPosition`, `fitScaleFor`, `minScaleFor`, `maxScale`, `insetX`/`insetY`, `outerW`/`outerH` |
| Fullscreen (`E35`, `E43`, `E47`) | `toggleFull`, `enterFull`, `leaveFull`, `restoreFull`, `fitFull`, `onFullChange`, `fullActive`, `fullPrev`/`fullApi`/`fullReq`, `lockScroll`/`unlockScroll`, `borderPx` |
| Video strip (`S22`, `E36`) | `buildVideoControls`, `syncVideoCtl`, `syncVideoTime`, `togglePlay`, `playVideo`, `clipSecs`, `isBoxControl`, `pointerOverBar` |
| Speed menu (`S23`) | `buildRateMenu`, `toggleRateMenu`, `syncRateMenu`, `commitRateField`, `setRate`, `RATES`, `capOwns` |
| Sound (`S24`, `E38`) | `audioFor`, `saveAudio`, `AUDIO_DEFAULT`, `toggleMute`, `applyAudioWish`, `rememberAudio`, `openVol`/`laterCloseVol`/`closeVol`, `volDrag` |
| Click on the picture (`T26`, `T27`, `E39`) | `boxTap`, `tap`/`tapPaused`/`TAP_SLOP`, `onBoxDown`, `onMove`, the `swallowNextClick` branch of the `window` click listener |
| Grab-band clearance (`E37`) | `grabBand`, `grabInset`, `btnGutter`, `barMinW`, `layoutChrome`, `pointerOverControl` |
| Zoom cluster (`S20`, `S21`, `E34`) | `buildZoomControl`, `syncZoom`, `openZoomField`, `closeZoomField`, `zoomAnchored`, `ZOOM_BANDS`/`walkStops`/`fitStops`/`zoomStops`/`zoomIndex`, `zoomLo`/`noBarsScale`/`zoomHi`, `parseZoom`, `commitZoomField`, `capOwns`, `minFrameW` |
| Upgrades (`S06`, `S15`) | `resolve`, `upgradeViewer` |
| The tour (`S25`, `S26`, `T29`–`T37`, `E54`–`E60`) | `tourEntries`/`tourOrder`/`tourSize`, `tourWorthy`/`tourPics`/`tourLevels`/`tourWrapper`/`tourPick`/`tourScopeNow`/`tourRescope`, `tourAt`/`tourTarget`/`tourBefore`, `tourNav`/`tourShow`/`tourFallback`, `tourStart`/`tourEnd`/`tourSync`/`tourChrome`, `tourRelocate`, `tourOwnsArrows`, `swapViewer`, `navShown`/`navW`/`stripUp`, `minFrameH`, `retryShown`, `tourExcursion`/`tourGrow`, `plFill`/`plRun`/`plPump`/`plReserve`, `noRushHosts`/`hardBlock`, `nextPageIn`/`pageNumOf`/`fetchDoc`/`rebase`/`harvestFrom`/`tourCross`, `baseOf` — see [`docs/TOUR.md`](docs/TOUR.md) |

Function names are used rather than line numbers, which rot.

---

---

## Changes

**Kept in git, not here.** This file used to carry a hand-written changelog of every version
since v0.9.0 — ~4.6k tokens restating what `git log` already holds, with dates and diffs
and no chance of going stale. `git log --oneline` is the index; each commit message names the
version and the change in the same sentence this table used to.
