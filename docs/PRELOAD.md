# Preload kinds — IDs the user cites (`L1` … `L23`, moments `M1` … `M14`)

User 2026-11-27: every kind of thing loaded ahead gets an ID; the user then states, per situation, the order they
want, and the code is made to match. **Keep this list current when a load kind is added, removed or re-ordered.**
Code names, constants and reasons live in `GALLERY.md` "Loading ahead" and `RESOLVER.md`; this file is the index.

Queues (each kind below names its own). They do not know about each other; all share the one network line.
- **PL**: the page preloader (`plQueue`/`plPump`), `PL_WORKERS` 6 at once, `PL_GAP_MS` 120 between starts, nearest first.
- **AH-pic / AH-page**: the gallery gates (`ahPics` 6 at once, 50–200 ms apart; `ahPages` 4, 300–800 ms). Order
  (`ahPri`): `gal`+`galo` 0 (equal: take turns) → `galn` 0.5 → `count` 1 → `main` 2.
- **direct**: no queue, the browser's own connection limit only.

| ID | What | When, now | Queue |
|---|---|---|---|
| **Results page, nothing open** ||||
| L1 | Single pictures' full size, on screen and the next screen | on arrival (`pgFill` level 2); waits while L3 runs (`galCountsBusy`) | PL |
| L2 | Single pictures' full size, the whole page | 3 screens scrolled, a screen's scroll after a hover, or arrived from a gallery link (`pgTick`) | PL |
| L3 | Gallery page reads: each door's linked page fetched for its picture list (= the count) | always, nearest the window's middle first (`galCountNext`) | AH-page `count` |
| L4 | Gallery thumbnails, 10 per door per round, 3 rounds (30) | from the hovered door, else the first on screen, in page order (`ahMainPick`) | AH-pic `main` |
| L5 | Gallery full size, one per door per round (3) | inside L4's rounds | AH-pic `main` |
| L6 | The door after a gallery preview: its whole first page of thumbnails | after L4/L5 (`ahLookLast`) | AH-pic `main` |
| L7 | Frame read of a gallery past what its HTML lists | last, once per door (`ahIdleGrow`) | frame |
| L8 | Next results page: its first 3 unseen galleries — list, thumbnails, all full size (≤ 3 clips each) | at the bottom, idle, ≥ 20 % of this page's galleries opened (`nextCheck`) | direct (6 at once) |
| **On a hover (asked for, not ahead)** ||||
| L9 | The hovered picture's full size | on hover | direct |
| L10 | The section the hover is in: its on-screen pictures' full size | after a preview (`hwFill`); scrolled-away ones dropped | PL |
| L11 | Gallery preview: the hovered door's first page of thumbnails | door hovered 500 ms (`galLookOpen`) | direct |
| **A gallery open (middle-click)** ||||
| L12 | Thumbnails of the page on screen | at once, in list order (`galFeed`) | direct |
| L20 | Thumbnails of the next page | with L12 (`galFeed`, 1 page ahead on page 1) | direct |
| L21 | Thumbnails of pages further ahead (up to 5 once stepped on) | with L12 (`galFeed`) | direct |
| L13 | Frame read for the rest of this gallery's list | when its HTML lists fewer than it has (`galGrow`, `galTourMore` on a step past it) | frame |
| L22 | Full size of the pictures around the one just hovered, ±3 nearest first | not separate now: part of L14's run from the hovered picture on | AH-pic `galo` |
| L23 | Full size of the page on screen | not separate now: the start of L14's run | AH-pic `galo` |
| L14 | This gallery's full size: Load all on = page on screen → end → 2 pages behind; off = from a preview through 2 pages on | Load all: at once (P:), after a preview (G:); a hover on an unloaded picture restarts it there | AH-pic `galo` |
| L15 | Bigger thumbnail files for cells drawn large | page laid out (`galUpgrade`) | direct |
| L16 | The clicked (corner) picture's full size | on open (`galFlyUpgrade`) | direct |
| **Endless** ||||
| L17 | Next galleries in the queue: page read + first 2 pages of thumbnails, 2 ahead → 5 once moving on; Last: none | every landing and page step (`ahGalAhead`) | AH-page `gal`, AH-pic `gal` |
| L18 | Next gallery's first page full size | within 2 pages of this gallery's end, originals on | AH-pic `galn` |
| **Slideshow** ||||
| L19 | Page slideshow: every picture's full size ahead and behind, nearest first (behind counts double); clips buffered ahead | each step (`plFill`); in a gallery L14 does this instead | PL |

## Order per moment — PROPOSED 2026-11-27, awaiting the user's adjustments, NOT in code yet

Read as "first → last". Anything not listed is paused. A new moment drops what is still *waiting* and re-queues in
its order; what is in flight lands (cancelling wastes its bytes). Dropping loses nothing: the next moment re-derives
what is unloaded from the page (nothing is cached), so a drop behaves as a pause. The latest action always wins;
hovers (M2, M3, M8) and scrolling (M4) are temporary — when they end, the moment underneath resumes from where the
pointer/screen now is. "Around" (L10 in M2, L22) = nearest first, before and after alike (user: before is as likely
as after; goes 2–3 either way): ±1, ±2, ±3, then (L10 only) the rest of the section on screen. Tab hidden: nothing.
Now (code): L10 queues every on-screen picture in the hovered picture's section in page order, not nearest first;
interruption is a mix — a gallery open or a scroll drops the main page's waiting jobs, a forward page step with Load
all on drops nothing, a gallery preview drops nothing.

| ID | Moment | Order |
|---|---|---|
| M1 | Landed on a results page, nothing hovered | L1 → L3 → L4 round 1 → L5 round 1 → L4/L5 rounds 2–3 → L2 → L7 |
| M2 | Hovering a single picture there | L9 → L10 → back to M1 |
| M3 | Gallery preview on a door | L11 → L6 → M1 from this door on |
| M4 | Scrolling the results page | nothing new; once still, M1 from the first door on screen |
| M5 | At the bottom, going through the galleries | M1's rest → L8 |
| M6 | Just opened a gallery, nothing hovered (P:) | L12 → L16 → L20 → L13 → L23 → L21 → L14 → L17 → L18 |
| M7 | Stepped a page forward | L12 → L20 → L13 → L23 → L21 → L14 → L17 → L18 |
| M8 | Hovered a picture in the gallery | L9 → L22 → L12 → L20 → L23 → L14 → L21 → L17 → L18 |
| M9 | Stepped a page back | L12 → L23 (from the page's end back) → L20 → L14 → L17 |
| M10 | G: pressed, stepping whole galleries | L12 → L16 → L17 (the next gallery first) → L20 → L13; full size waits for a hover (then M8) |
| M11 | Endless landed on the next gallery | as M6 (P:) or M10 (G:); Last ticked: no L17/L18 |
| M12 | Slideshow on a results page | L19 ahead (nearest first) → L19 behind |
| M13 | Slideshow in a gallery | L22 ahead of the slideshow → L12/L20 of the page it reaches → L14 → L18 near the end → L17 |
| M14 | Gallery closed | M1 from the first door on screen |

Load all off: drop L23/L14 from M6/M7/M9/M11 (L22 still follows a hover). Endless off or Last: drop L17/L18.
