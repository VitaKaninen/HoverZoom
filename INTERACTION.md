# Preview window — interaction reference

What the preview **window** does, as a state machine. Menus, buttons, the status bar contents and
the loading ring are out of scope except where they change what the window itself accepts.

Describes `Hover-Zoom.user.js` **v0.39.0**.

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
| `P4` | Not a video: not a media/plugin tag, not sitting inside a **video surface** (a laid-out **player**'s rectangle, or the player box derived from it), no **player** in it or within three ancestors, and not inside a link matching the video-URL shapes. A `<video>` that is muted, controls-less, looping or autoplaying, and under a minute long is an animated picture rather than a player — it is none of those things (`E12`) | `previewVideos` off |
| `P5` | The site passes the blacklist / whitelist test. The host tested is the **page's**, not the frame's (`E29`) | blacklist, empty |
| `P6` | In modifier mode, the modifier key is held. **Either order** — hold it and then point, or point and then press it (`E28`) | activation = hover |
| `P7` | Not page furniture — a CSS background that is part of the page rather than a picture on it (`E17`) | `skipFurniture` on |
| `P8` | Neither the displayed URL nor any candidate is on the never-preview list | `blockList` empty |
| `P9` | Not marked decoration by the page itself: no `aria-hidden="true"`, no `role="presentation"`/`"none"` on the element | `skipFurniture` on |
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
  default) it opens beside the pointer and is nudged the smallest distance that puts the pointer
  `REACH_INSET` (10 px) inside its edge. (`cursorGap` was retired in v0.40.0: that nudge always
  overrode it, so the gap could never survive.) With `position: center` it is centred in the
  window and the pointer is *outside* it, so the press that pins it is the one on the picture
  itself (`E30`).
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
- **Its status bar carries three buttons, and only here:** ⊘ never preview this image, which asks
  first (`E11`), ▶ stop showing clips in this tab (`E27`), AA smooth-or-hard-pixels, a plain
  toggle (`E31`). Only the ⊘ opens a popover, **upward** out of the bar; a press anywhere else in
  the frame closes it.
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
| `E25` | The frame is a margin you can grab, drawn over the picture | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E26` | The picture may be smaller than the frame | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E27` | Turning off clips for the rest of the tab | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| `E28` | The modifier key works in either order | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| `E29` | The script runs in every iframe; the menu and the site test belong to the page | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| `E30` | A centred preview is pinned from the picture, not from the window | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E31` | Smoothing — the AA toggle, and why there are only two answers | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| `E32` | A pan that runs out of picture continues as a window move | [`docs/VIEWER.md`](docs/VIEWER.md) |
| `E33` | The settings panel is never modal, and who owns the keyboard and wheel | [`docs/SETTINGS.md`](docs/SETTINGS.md) |

`E3` is retired with the detached state (v0.28.0); `E4` and `E5` are retired as dangling.

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

---

## Changes

**Kept in git, not here.** This file used to carry a hand-written changelog of every version
since v0.9.0 — ~4.6k tokens restating what `git log` already holds, with dates and diffs
and no chance of going stale. `git log --oneline` is the index; each commit message names the
version and the change in the same sentence this table used to.
