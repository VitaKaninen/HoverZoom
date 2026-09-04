# Preview window — interaction reference

What the preview **window** does, as a state machine. Menus, buttons, the status bar contents and
the loading ring are out of scope except where they change what the window itself accepts.

Describes `Hover-Zoom.user.js` **v0.16.0**.

---

## How to cite this document

Every item has a short permanent ID. Say the ID instead of quoting:

| Prefix | Covers | Example |
|---|---|---|
| `R` | The governing rule | `R1` |
| `P` | Preconditions — what must be true before anything opens | `P4` |
| `S` | States | `S07` |
| `T` | Transitions | `T12` |
| `K` | Terminators — what closes an unpinned window | `K3` |
| `B` | Button map rows | `B2` |
| `E` | Known edges and consequences | `E1` |

**IDs are permanent.** New items are appended with new numbers; a removed item's ID is retired and
never reused, so a reference in an old conversation never silently points at something else. If an
item's *content* changes materially, the ID stays and the change is noted in `## Changes` at the
bottom.

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
| `S07` | detached | placed | the window |
| `S08` | detached, upgrading | placed | the window |
| `S09` | dragging (move), unpinned | transient | the held button |
| `S10` | pinned | pinned | nothing |
| `S11` | pinned, frame growing | pinned | nothing |
| `S12` | pinned, image spilling | pinned | nothing |
| `S13` | dragging (pan), pinned | transient | the held button |
| `S14` | dragging (move), pinned | transient | the held button |
| `S15` | pinned, upgrading | pinned | nothing |
| `S16` | suppressed | gone | — |
| `S17` | fading out | gone | — |

The three states that matter most in conversation are `S05`, `S07` and `S10` — the escalation
ladder. Everything else is a phase on the way in or out of one of them.

---

## R — the governing rule

### R1 · One holder at a time

**Exactly one thing holds the window open at any moment, and leaving that thing ends the window.**

- While it is a hover preview (`S05`, `S06`) that thing is **the source image**. Never the window —
  the window is invisible to the pointer and cannot hold itself open.
- Once dragged (`S07`, `S08`) that thing becomes **the window**. The source image stops mattering
  entirely.
- Once pinned (`S10`) **nothing** holds it. It ends only on an explicit dismissal.

Every hover bug this script has had came from two things holding it at once. Any proposed change
that reintroduces a second holder should be treated as a regression until argued otherwise.

*Code: `onOver`, `onOut`, `cancel`, `dismiss`.*

---

## P — preconditions

None of the states are reachable unless all of these pass, evaluated the moment the pointer
arrives — nothing is decided in advance.

| ID | Precondition | Default |
|---|---|---|
| `P1` | The element is an `<img>`, a **playing gif-style `<video>`** (`E16`), or has a CSS background image and contains no `<img>` of its own | — |
| `P2` | Displayed at least `minDisplayed` on screen | 48 px |
| `P3` | Displayed no larger than `maxDisplayed` | 0 = no cap |
| `P4` | Not a video: not a media/plugin tag, not sitting inside a **video surface** (a laid-out **player**'s rectangle, or the player box derived from it), no **player** in it or within three ancestors, and not inside a link matching the video-URL shapes. A `<video>` that is muted, controls-less, looping or autoplaying, and under a minute long is an animated picture rather than a player — it is none of those things (`E12`) | `skipVideos` on |
| `P5` | The site passes the blacklist / whitelist test | blacklist, empty |
| `P6` | In modifier mode, the modifier key is held | activation = hover |
| `P7` | Not page furniture — a CSS background that is part of the page rather than a picture on it (`E17`) | `skipPageBackgrounds` on |
| `P8` | Neither the displayed URL nor any candidate is on the never-preview list | `blockList` empty |
| `P9` | Not marked decoration by the page itself: no `aria-hidden="true"`, no `role="presentation"`/`"none"` on the element | `skipDecorative` on |
| `P10` | Not the banner across the top of the page (`E20`) — the one furniture rule that applies to an `<img>` as well | `skipBanners` on |

The element tested is not always the one under the pointer. When the hover target fails `P1`, a
single picture directly beneath it in the same card is tried instead (`E18`), and that picture
then faces every precondition here in its own right.

A candidate that passes all ten still shows nothing unless a probe finds an image at least
`minRatio` (1.2×) bigger than what is displayed **and shaped like it** (`E19`) — see `T04`.

`P7` is five separate tests, listed in `E17`. It applies to CSS backgrounds only; the one rule
that also judges an `<img>` is `P10`, and it is deliberately much narrower.

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
- **Accepts:** left press + release → pin (`T07`); left press + drag > 3 px → detach (`T08`);
  right press → dismiss (`T10`), and the browser's own menu is suppressed with it. Default button
  map `B1`. This is the one state that keeps right-click: the window is transparent here, so the
  browser's menu would come up for the *thumbnail* underneath (`E9`).
- **Ends on:** leaving the image, **immediately** — no grace period, even though the window is
  sitting under the cursor.

#### S06 · hover-held, upgrading
`S05` while the search is still running, because a bigger original may exist (`keepSearching`, on
by default, up to 8 probes).
- **On screen:** the window, plus the ring docked into its lower-right corner — the only signal
  that what you are looking at is not final.
- **On upgrade:** the frame keeps its centre; only the pixels change.
- **Ends on:** as `S05`. Leaving mid-search does **not** abort loads already in flight (`E6`).

### Placed — held by the window

#### S07 · detached
Reached by dragging `S05`/`S06` more than `DRAG_SLOP` (3 px). The window has been deliberately
positioned, so it stops tracking the image and answers to the pointer directly.
- **On screen:** the window, now **hit-testable** — it intercepts the pointer instead of passing it
  through.
- **Held by:** the pointer being on the window. The source image is now irrelevant to it (`R1`).
- **Accepts:** click → pin (`T14`); drag → move it again; **wheel over it → zoom** about the
  pointer, exactly as `S10` does (`T20`). Having dragged a window somewhere, a wheel over it
  means "make this bigger" — and letting it scroll the page would close the window (`K2`), so
  the gesture used to destroy what it was aimed at. A wheel anywhere *else* still scrolls.
- **Zooming it** promotes it through the same `S11` → `S12` geometry as a pinned window, so a
  detached window can end up spilling and pannable without ever being pinned.
- **Right press → dismiss**, as on `S05`. The browser's menu is `S10`'s alone (`E9`): shoving a
  detached window out of the way is worth more than a menu that is one click away.
- **Ends on:** the pointer leaving the window — **and** the source image is put in `S16`, so moving
  back onto it does not re-open anything (`T11`, `T13`).

#### S08 · detached, upgrading
`S07` with the search still running. Dragging never stops the search.
- **On screen:** the window plus the docked ring.
- **On upgrade:** frame centre held, so it does not jump under your hand.

#### S09 · dragging (move), unpinned
The button is down and the window is following the pointer 1:1.
- **Suspends:** all hover logic, for the duration. A fast drag can outrun the frame, and the page
  elements sliding underneath must not be allowed to cancel the thing being dragged.
- **Bounds:** clamped to stay 4 px inside the viewport.
- **Ends on:** release. Past 3 px of travel it lands in `S07` and the release does **not** pin.

### Pinned — modal

#### S10 · pinned
A click promoted it. The backdrop now swallows clicks meant for the page, an X appears, and the
keyboard and wheel belong to the window.
- **On screen:** the window, the X, and the backdrop — dimmed only if `dimOpacity` is above 0.
- **Held by:** nothing. It outlives hover, scrolling and focus loss entirely.
- **Accepts:** wheel → zoom about the pointer (`wheelZoomStep`, 15 % per notch); `+` / `−` → zoom
  about the frame centre (1.25× per press); `0` → back to the opening scale; arrows → pan
  (`panStep` 80 px, Shift for 3×); drag → **pan if the picture is spilling, otherwise move the
  frame** (`S13` / `S14`); drag the status bar → always move the frame (`S14`).
- **Ends on:** the X, a click on the backdrop, or Escape. **Right-click does not close it** under
  either button map — it raises the browser's own menu over the picture instead (`T21`, `E9`).
- **Note:** the key and wheel listeners are bound on `window` in capture, so they outrank the page
  and any sibling userscript while pinned.

#### S11 · pinned, frame growing
The image at the current scale is still smaller than the viewport cap, so zooming in enlarges **the
frame**. The picture always fits; there is nothing to pan.
- **Cursor:** `move`. There is nothing to pan, so dragging anywhere on it moves the frame
  (`S14`) — including after zooming in and back out, because "can this pan" is asked afresh on
  every press.
- **Zoom floor:** the scale the window opened at. `0` returns there.
- **Growth:** each axis grows independently up to its own cap, so the frame keeps widening after
  its height has capped, and vice versa. It stops at `maxWidthPct` / `maxHeightPct` — **92 % by
  default, which is why a fully zoomed frame still leaves a margin all round** (`E7`).
- **Ends on:** the frame reaching that cap, which promotes it to `S12`.

#### S12 · pinned, image spilling
The frame has hit the viewport cap and is now fixed. Further zoom pushes the image out past the
frame's edges, which is the moment panning starts to mean something.
- **Cursor:** `grab` over the image.
- **Accepts:** drag the image to pan (`S13`); arrows to pan; wheel keeps the pixel under the pointer
  where it is.
- **Zoom ceiling:** `maxZoom` (32×), hard-capped at 64×.

#### S13 · dragging (pan), pinned
Press on the image while it is spilling — and only while it is spilling; with nothing to pan the
same press moves the frame instead (`S14`). The picture moves inside a frame that stays put.
- **Cursor:** `grabbing`.
- **Bounds:** clamped so the frame never shows past the edges of the picture.

#### S14 · dragging (move), pinned
Press on the **status bar**, or anywhere on a frame whose picture is not spilling. The whole frame
moves; the picture stays put inside it.
- **Cursor:** `move`.
- **The status bar always moves the frame**, whatever the zoom — it is the escape hatch once the
  picture is spilling and every other press pans, which is why hiding the status bar leaves a
  zoomed-in frame with no way to be moved.

#### S15 · pinned, upgrading
Pinning is a reason to keep looking, not to stop, so the search runs on.
- **On upgrade:** three things are held constant — the frame's centre, its on-screen size, and the
  fraction of the picture sitting at the frame's middle. Only the pixels improve.

### Gone

#### S16 · suppressed
No window, and the image it came from is blocked from opening another one.
- **Entered from:** a right-click dismiss (`T10`), or a detached window losing the pointer (`T11`,
  `T13`).
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
| `T07` | `S05` | Click | `S10` |
| `T08` | `S05` | Drag > 3 px | `S07` |
| `T09` | `S05` | Drag < 3 px, then release | `S10` — a wobble is still a click |
| `T10` | `S05` | Right-click | `S16` |
| `T11` | `S07` | Move off the window | `S16` |
| `T12` | `S07` | Move off the window onto a different image | that image's `S02` |
| `T13` | `S07` | Move back onto the source image | `S16` — nothing re-opens |
| `T14` | `S07` | Click | `S10` |
| `T15` | `S16` | Leave that image, come back | `S02` |
| `T16` | `S10` | Escape, the X, or click the backdrop | `S01` |
| `T17` | `S10` | Wheel, or `+` / `−` | `S11` → `S12` as the frame reaches the cap |
| `T18` | `S10` | Press `0` | `S11` at the opening scale |
| `T19` | `S10` | Resize the browser window | `S10`, re-fitted — it does not close |
| `T20` | `S07` | Wheel over the window | `S07`, zoomed — the page does not scroll and the window does not close |
| `T21` | `S10` | Right-click the window | `S10` unchanged — the browser raises its own menu over the picture (`E9`) |

---

## K — terminators

Everything that closes an **unpinned** window. `S10` survives all of these except `K5` and the
explicit dismissals in `T16`.

| ID | Trigger | Notes |
|---|---|---|
| `K1` | The pointer leaves its holder | The image for `S05`; the window for `S07`. Immediate, no grace. |
| `K2` | Page scroll | A detached window dies too — only pinning survives scrolling (`E3`). A wheel *over* a detached window zooms it instead and never reaches the page (`T20`). |
| `K3` | Browser window loses focus | — |
| `K4` | Browser window resize | Pinned windows re-fit instead (`T19`). |
| `K5` | Escape | Closes it, but does **not** suppress the image (`E2`). |
| `K6` | `mousedown` on the page outside the window's rectangle | — |
| `K7` | Releasing the modifier key | Modifier mode only. |
| `K8` | Any mouse button held down | Suppresses *new* windows rather than closing the current one. `skipWhileMouseDown`. |

---

## B — button map

| ID | Setting | On `S05` / `S07` | On `S10` |
|---|---|---|---|
| `B1` | Pin with **left** (default) | Left pins · right dismisses and suppresses | Left pans or moves · right raises the browser's own menu over the picture (`E9`) |
| `B2` | Pin with **right** | Right pins · left dismisses and suppresses | Left pans or moves · right does nothing, so the browser's own context menu appears over the picture |

The left button always pans or moves a pinned window, whichever way the setting points — otherwise
a pinned frame could have no way to be moved. Under both settings the browser's own context menu is
reachable over a **pinned** window, which is the only place `Save image as…` and `Copy image` work
at all (`E9`).

---

## E — known edges and consequences

These are consequences of the design rather than decisions in their own right. Several are open to
change if you want them changed.

#### E1 · A click on a hovered image usually pins instead of following the link
The window is invisible to the pointer, but a click inside its rectangle is still claimed by
geometry — at **window** level, in capture (v0.16.0; it was document level before). With
`position: cursor` the window is nudged to touch your cursor, so your cursor is nearly always
inside it. This is the price of click-to-pin. `position: center` does not have this problem,
because the window opens away from the pointer.

Window/capture is what keeps the claim ahead of the page's own click handling and of sibling
userscripts on `document`. Against a sibling that also sits on window/capture, ordering is the
userscript manager's to decide, so the press additionally stamps `<html>` with
`data-userscript-click-claim`; a cooperating script reads that during the click and stands aside.
Reported as a preview that pinned *and* followed the link on imgur, alongside Open Links in New
Tab v1.19.0+.

#### E2 · Escape is not the same as a right-click dismiss
Escape (`K5`) hides the window but does not enter `S16`, so crossing into a child element of the
image and back can re-open it. Right-click (`T10`) is the one that stays down.

#### E3 · Scrolling kills a detached window
Dragging a window aside to read the page under it does not survive a scroll (`K2`). Pinning is the
only way to keep a window across a scroll. The one exception is a wheel with the pointer *on* the
window, which zooms instead of scrolling (`T20`).

#### E4 · The window never follows the pointer
Placement is decided once, when it opens. Moving around within the same image does not reposition
it, and neither does an upgrade.

#### E5 · A hover-held window cannot be clicked *on*
Anything living inside `S05` is out of reach until you detach or pin, because moving toward it means
leaving the image, which ends it (`R1`). Detaching (`T08`) or pinning (`T07`) makes the window
hit-testable.

#### E6 · Leaving mid-search does not cancel the network
Probes already in flight finish and populate the cache, which is why an image that "did nothing" the
first time can open instantly a moment later. That is a cache warming up, not a fixed bug.

#### E7 · A fully zoomed frame stops 8 % short of the screen
`S11` grows each axis to `maxWidthPct` / `maxHeightPct`, both **92** by default, so the frame
stops with a margin all round and the picture starts spilling from there. Measured on a
1265 × 784 viewport: a 4:3 picture opens height-capped at 960 × 720, widens over two wheel
notches to 1162 × 720, and stops — 91.9 % and 91.8 % of the viewport. If you want it to reach the
edges, both settings go to 100; nothing else is capping it.

#### E20 · The banner across the top of a page is never previewed
A channel banner, a forum masthead, a site header image. It is an `<img>`, so none of `E17`'s
background rules can see it, and it is often rotated daily so the never-preview list cannot hold
it either. Measured on youtube.com/@TheOnion: `<img>` 1193 × 192, **56 px from the top of the
document**, no `role`, no `aria-hidden`, and `alt=""` — which is also on all 23 video thumbnails,
so the markup says nothing. Recognised by shape instead, four conditions together:

| Condition | What it rules out |
|---|---|
| Top within 200 px of the top of the **document** | anything below where content begins |
| At least 400 px wide on screen | logos, icons, avatars (YouTube's is 160 px) |
| Nothing beside it | a gallery's first row, which is also near the top and can be wide |
| No other picture on the page shares its width (±10 %) | a single-column gallery, where the row test is useless |

A picture with the **same URL** as the candidate is exempt from the last two: banners are often
rendered twice — a blurred backdrop, a low-res placeholder — and a copy is the same width, so
uniqueness was being defeated by the banner's own reflection.

On that page it refused exactly one of 24 images, and none at all once scrolled. `skipBanners`
turns it off; if a site's banner sits lower than 200 px it is missed. The hover log's
`bannerGate` line names the condition that decided **and the number it decided on**, for both
answers — the gate is pure geometry, so a "works in your browser, not mine" report can only be
settled by what it saw on that machine.

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
has none, and the shape of its box is not the shape of its image. `sameShapeOnly` turns it off.

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
at once, as `T06` says. Turn it off with `hoverThroughOverlays`.

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
`og:image` was the site logo. `followLinks` (on) turns the whole thing off; note that with it on,
hovering a linked thumbnail makes a request the site can see.

#### E14 · The preview itself may be a video
Some animated posts have no image form at all: an Imgur *video post* answers `.jpg` with one
frozen frame, and the moving original exists only as `.mp4`. Since v0.18.0 the frame can show
that clip instead of a picture — muted, looping, no controls, and every gesture (`S05`–`S17`)
behaves exactly as it does for a still. `playVideos` (on) turns it off, and the frozen frame is
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

#### E13 · The frame stops short of the bottom of the window
The browser paints its own status text — the address of the link under the pointer, "Waiting
for…" — along the bottom edge of the content area, over everything the page draws. `bottomReserve`
(30 px) is taken off the usable height before any other geometry, so the size cap, the opening
position and the clamp all stay above that strip. Measured on an 885 px viewport: the frame closes
at 851 px, 34 px clear (the reserve plus the ordinary 4 px gutter), against 881 px with the reserve
set to 0. Raising it shrinks the preview rather than pushing it off the bottom.

#### E8 · An upgrade is almost never visible
`S06` / `S08` / `S15` work, but the candidate list is ordered best-first, so the first hit is
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
**pinned** window hands right-click back to it (`T21`). The element under the pointer is our
`<img>`, whose `src` is the resolved full-size URL, so *Save image as…*, *Copy image*, *Copy image
address* and *Open image in new tab* all act on the original. Verified in a real browser
2026-09-03, including that native chrome targets an `<img>` inside an open shadow root.

`S05` and `S07` keep right-click-to-dismiss. `S05` has no choice — it is pointer-transparent, so
the menu there comes up for the thumbnail underneath and offers to save *that*. `S07` is a
judgement call: shoving a window out of the way is the more useful gesture there, and pinning is
one click away when you want the menu.

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
The status bar of a **placed** window (`S07` or `S10`) carries a `⊘` beside the metadata: it adds
the image to the never-preview list (`P8`) and closes the window. It is the answer to a page whose
tiled background or watermark opens a preview from every patch of blank space.

It is absent from `S05` for the same reason the X is: a hover preview is pointer-transparent, so a
button drawn on it cannot be clicked at all. The gesture is therefore hover → click to pin → `⊘`,
which the settings panel states outright, because it is not guessable from the UI.

It records **two** URLs — the one on screen and the source element's own `src`. Those differ
whenever the preview was an upgrade, and blocking only the resolved one would leave the thumbnail
still opening a preview that then failed to upgrade.

`skipPageBackgrounds` (`P7`) handles the common case with no gesture at all; `⊘` is for everything
that rule cannot know about.

---

## Where this lives in the code

| Area | Functions |
|---|---|
| Eligibility (`P1`–`P6`) | `eligible`, `inVideoContext`, `overVideoSurface`, `siteEnabled` |
| Hover state machine (`R1`, `S01`–`S08`, `S16`) | `onOver`, `onOut`, `cancel`, `dismiss` |
| Press / click ownership (`E1`) | `pointInPreview`, `onBoxDown`, `onBoxClick`, the document `mousedown` and `click` listeners |
| Dragging (`S09`, `S13`, `S14`) | `onMove`, `onBoxDown` |
| Pinned mode (`S10`–`S15`) | `pin`, `unpin`, `onPinKey`, `onPinWheel` |
| Wheel zoom on a placed window (`T20`) | `detach`, `enableWheelZoom`, `disableWheelZoom`, `onPinWheel` |
| Geometry (`S11`, `S12`) | `view`, `reflow`, `layout`, `zoomAt`, `pannable` |
| Upgrades (`S06`, `S08`, `S15`) | `resolve`, `upgradeViewer` |

Function names are used rather than line numbers, which rot.

---

## Changes

| Date | Change |
|---|---|
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
