# Preload kinds — IDs the user cites (`L1` … `L25`, moments `M1` … `M14`)

User 2026-11-27: every kind of thing loaded ahead gets an ID; the user then states, per situation, the order they
want, and the code is made to match. **Keep this list current when a load kind is added, removed or re-ordered.**
Code names, constants and reasons live in `GALLERY.md` "Loading ahead" and `RESOLVER.md`; this file is the index.

Queues (each kind below names its own). They do not know about each other; all share the one network line.
- **PL**: the page preloader (`plQueue`/`plPump`), `PL_WORKERS` 6 at once, `PL_GAP_MS` 120 between starts, nearest first.
- **AH-pic / AH-page**: the gallery gates (`ahPics` 6 at once, 50–200 ms apart; `ahPages` 4, 300–800 ms). Order
  (`ahPri(tag, ahMoment())`): no gallery = `count` → `main`; a gallery open (M6–M9) = `galh` → `galp` → `galo`/`gal`
  (M6 `galo` first) → `galn`, `count`/`main` paused, all but `galh` held while its thumbnails arrive; a slideshow
  (M13 not built) = the old order, `gal`+`galo` equal taking turns → `galn` → `count` → `main`. Reasons: GALLERY.md.
- **direct**: no queue, the browser's own connection limit only.

| ID | What | When, now | Queue |
|---|---|---|---|
| **Results page, nothing open** ||||
| L1 | Single pictures' full size, on screen and the next screen | on arrival (`pgFill` level 2, jobs marked `l1`); first: counts and rounds wait for it (`ahL1Busy`); scrolling: up to 2 screens below | PL |
| L2 | Single pictures' full size, the whole page | 3 screens scrolled, a screen's scroll after a hover, or arrived from a gallery link (`pgTick`) | PL |
| L3 | Gallery page reads: each door's linked page fetched for its picture list (= the count) | always, nearest the window's middle first (`galCountNext`); paused while a gallery is open | AH-page `count` |
| L4 | Gallery thumbnails, 10 per door per round, 3 rounds (30) | from the hovered door, else the first on screen, in page order (`ahMainPick`) | AH-pic `main` |
| L5 | Gallery full size, one per door per round (3) | inside L4's rounds | AH-pic `main` |
| L6 | The door after a gallery preview: its whole first page of thumbnails | after L4/L5 (`ahLookLast`) | AH-pic `main` |
| L7 | Frame read of a gallery past what its HTML lists | last, once per door (`ahIdleGrow`) | frame |
| L8 | Next results page: its first 3 unseen galleries — list, thumbnails, all full size (≤ 3 clips each) | at the bottom, idle, ≥ 20 % of this page's galleries opened (`nextCheck`) | direct (6 at once) |
| **On a hover (asked for, not ahead)** ||||
| L9 | The hovered picture's full size | the pointer rests `hoverDelay`; in a gallery every AH line waits for it (`galPvWait`, ≤ `AH_PV_HOLD_MS` 8 s) | direct |
| L10 | The section the hover is in: its on-screen pictures' full size | after a preview (`hwFill`); scrolled-away ones dropped | PL |
| L11 | Gallery preview: the hovered door's first page of thumbnails | door hovered 500 ms (`galLookOpen`) | direct |
| **A gallery open (middle-click)** ||||
| L12 | Thumbnails of the page on screen | at once, in list order (`galFeed`) | direct |
| L20 | Thumbnails of the next page | with L12 (`galFeed`, 1 page ahead on page 1) | direct |
| L21 | Thumbnails of pages further ahead (up to 5 once stepped on) | with L12 (`galFeed`) | direct |
| L13 | Frame read for the rest of this gallery's list | last: `galGrowLater` queues tag `grow` in AH-page, held while any of the gallery's lines wait or load (`ahGalBusy`); jumps the queue (`galGrowNeed`) when the list is shorter than the pages wanted, a step goes past it (`galTourMore`), or ⤓ | frame |
| L22 | Full size of the pictures around the one just hovered, ±3 nearest first | its preview shown (`ahSaw` after `showViewer`; cells the pointer only crosses never count, v0.443.0), any setting; the head of the run (`galHqAhead`) | AH-pic `galh` |
| L23 | Full size of the page on screen (M9: from its end backward) | Load all: after the thumbnails, each open, step, landing | AH-pic `galp` |
| L14 | This gallery's full size after the page on screen: → end → 2 pages behind | Load all: after L23 (M6) or after L17 (M7–M9); G: waits for a hover | AH-pic `galo` |
| L15 | Bigger thumbnail files for cells drawn large | page laid out (`galUpgrade`) | direct |
| L16 | The clicked (corner) picture's full size | on open (`galFlyUpgrade`) | direct |
| UC / L25 | Full clips: the page on screen's (`galc`) / the rest of the gallery's (`galv`) | UC with Load all, ahead of L23; L25 in M6/M11, M13 (GALLERY.md "Full clips") | AH-pic |
| L24 | A GIF thumbnail's first frame only (ranged read) + ▶; ▶ also on a cell whose original is a clip | with its cell's thumbnail (`gifStill` in `galImg`), GALLERY.md "L24" | direct (GM_xhr) |
| **Endless** ||||
| L17 | Next galleries in the queue: page read + first 2 pages of thumbnails, 2 ahead → 5 once moving on; Last: none | every landing and page step (`ahGalAhead`) | AH-page `gal`, AH-pic `gal` |
| L18 | Next gallery's first page full size | within 2 pages of this gallery's end, originals on | AH-pic `galn` |
| **Slideshow** ||||
| L19 | Page slideshow: every picture's full size ahead and behind, nearest first (behind counts double); clips buffered ahead | each step (`plFill`); in a gallery L14 does this instead | PL |

## Plan — the user's (2026-11-27, wrote M6–M9 themselves); being built

**Built (v0.438.0–v0.439.0; verified in Chrome on eporner: M6, M7, M8, M11):** M6–M9 and M11 as in the lines below, except: the clip lines (L24/L25, "Upgrade clips") and
L13's place (still its own frame queue, started as before); L16/L20/L21 are direct (the browser's order, so L16 may
overlap L12, and L22 overlaps L12 in M8). M10 = M6/M7 order with no HQ until a hover; its "L17 first gallery before
L20" is not built (L17 waits for all thumbnails). Without Load all a hover now loads L22 only (was 2 pages on).
**Built (v0.440.0; Chrome on eporner: M1 order L1 → L3, round-1 thumbnails across doors; M4 scroll window and
drop):** M1, M4, M5 (L8 = the next page's lists + 3 rounds, no 20 % rule). User confirmed 2026-11-27: L1
includes gallery covers' own full size (the cover is the gallery's best picture, looked for first); automatic L2
only on pages with doors (others keep the interest rule), and M4's singles below the screen go first while
scrolling ("1 screen ahead is fine"; built: 2). Cover and ready corners in gallery cells: GALLERY.md "Cell marks".
Chrome, eporner 2026-11-27 (v0.447.0): 85 counts done before round 1; at the bottom the doors from the screen on
finished their 3 rounds, then L8 (next page: 310 thumbnails). Doors scrolled past keep round 0 (M4 dropped them).
**Built (v0.447.0), M13:** `galHqSlide` — tag `gals` (activity L19) = the next `AH_SLIDE` 10 in the step's direction
(`ahG.dir`), `AH_SLIDE_CATCH` 20 while `ahG.caught` (set when a step shows a picture whose original was not in; cleared
once those 20 are in); with Load all then `galp` its page from it that way, `galo` the rest that way + stand-ins +
behind. `ahPri('slide')`: gals, gal (L17), galp, galo, galn; `ahHeld`: every other tag waits while a `gals` is waiting
or loading; L17's walk holds `galo`. Thumbnail lines (L12/L20/L21) are direct, not in this queue. Chrome, eporner:
caught up in a 112-picture gallery → exactly 20 `gals`, `gal` 201 / `galn` 60 waiting behind them.
**Built (v0.449.0), L24:** GIF thumbnails as first-frame stills + ▶ (GALLERY.md "L24"). Assumption, not confirmed by the
user: a clip cell already has the site's still image as its thumbnail, so L24 for clips is only the ▶.
**Built (v0.450.0), L13's place:** last in every gallery moment, jumping the queue as the plan says (table row). Until
the read has ended (`galListRead`: grown, or stopped with a reason) `galWhole` is false and the page count shows "+".
Trap: a gate's release pumps **both** gates (`onFree` = `ahPump`, set beside the two gates so `ahGate` stays testable alone), or `grow` (AH-page) never sees AH-pic's originals finish.
Chrome-pane check, door-search: d6 (240 in HTML) read at 32.8 s right after its 240 originals with Load all, 0.1 s
without; d7 (10 in HTML) "needed now" at once. The step-past jump is not live-tested.
**Built (v0.456.0), L25 + "Upgrade clips":** GALLERY.md "Full clips" (tags `galc`, `galv`; verified in the pane on
`door-gif.html`: both clip cells loaded in full as `galc`, blue corner). Not live-tested on a real site.
**Not built:** M10's "L17 first gallery before L20", L8's L1 (singles of a fetched page), L10's ±3-then-rest,
next-page finding (its own session, three repos).

New kind in the plan (not in code): **L25** the full clip. L10 = ±3 nearest first, then the rest of the section on screen. L8 = the next results page's
M1 lines 1–6 (no 20 % rule, user). L20/L21 = the next page / the page after, relative to the page on screen; under
Endless they run on into the next gallery's first pages when this gallery ends.

**The user's direct actions come first (user, 2026-11-27; replaces "in flight lands" for these three):**
- **A hover** (its preview about to load) cancels every other download in flight — loading ahead and the ⤓ save
  queue alike — except the previous hovered picture's own original, which finishes. The save queue's cancelled files
  go back to the front of its queue and resume once the hover's own loads (L9, L22) are in.
- **A second hover** drops the first hover's L22 (±3) entirely, waiting and in flight — no re-queue; Load all
  picks them up later in its own order.
- **A page step** cancels, mid-download, the left page's originals and its unfinished thumbnails: leaving a page
  says the user will not look at it.
**Only when needed (user, 2026-11-27):** a hover whose own original is known (`item.hit`, or `hqTried` — set on a
hit, the thumbnail itself included) cuts nothing; a gallery hover whose ±3 are in opens no M8 (`ahSaw` `idle`); a
gallery preview whose first page of thumbnails is in (`galLookReady`) cuts nothing. A thumbnail-only picture once
looked like "unknown" on every hover and stopped everything.
A cancelled load is not a failure: it is never cached as a miss, never marked tried, and a later run asks again.
**Pause, not drop (user, 2026-11-27):** where we may come back, a cut is a pause — every queue re-derives what is
unloaded, so a cut picture is asked again first when its moment resumes; only leaving for good flushes. A real
mid-stream pause is not possible from a userscript (an `<img>` or GM request can only be aborted; the browser may keep
the partial bytes in its cache and resume them — unverified). Flushed: closing a gallery (`galDrop(set, true)`: its
originals and thumbnails, and the next galleries' L17/L18); an Endless switch flushes only the left gallery's own.
**Built v0.445.0:** `hoverFirst(why)` for every rested hover (gallery `galPv`, results page M2, a gallery preview
M3): `netCutWhere(all)`; the ⤓ queue `dl.pause()` aborts its saves in flight (`saveCtl*`: GM_download / GM_xhr
handles) and marks them `0` again — the front, since workers take the first `0`; PL jobs are cuttable owners and go
back to the front of `plQueue`; the gates and `plPump` hold until `hoverDone()` (its own original in), then
`hoverResumeCheck` waits for L22 (`galh`) to drain and resumes all; 16 s backstop. A gallery preview (M3) also undoes
the round under way (`ahDrop('main')`) and cuts the rounds' thumbnails in flight (`galThumbCut`), held until its L11
thumbnails are in (`lookDone`). A page step cuts the left page's placed-but-unloaded thumbnails (`e.cut`, kept in
place, reloaded by `galPageWork` when that page shows).
**Built v0.444.0** for originals (`netLive`/`netCut`/`netCutWhere`; owner per background job `netJob(tok, it, tag)`,
a hover's token is never an owner that can be cut; `galDrop` cuts a left gallery's too). Chrome, eporner: a page step
cut 6, a hover cut 4 (its original in 2.1 s), all 92 loaded later. (The ⤓ queue, the left page's thumbnails and PL on a hover: built v0.445.0, above.)

**Rules for every moment.** Each line waits for the one above. Not listed = paused. The latest action wins: a new
moment drops what is still *waiting* and re-queues in its order; in flight lands. A drop loses nothing (the next moment
re-derives what is unloaded from the page). Hovers (M2, M3, M8) and scrolling (M4) are temporary: when they end, the
moment underneath resumes from where the pointer/screen now is. Tab hidden: nothing. Already loaded = skipped at once.
**[Load all]** = only with "Load all of a gallery's originals when it opens" ticked; unticked, skipped (HQ in a gallery
waits for a hover). **[Endless]** = only with Endless on and Last unticked.
**Clips and GIFs:** every clip/GIF cell shows L24 first (gallery preview, open gallery). Full clips: "Upgrade clips"
lines [Load all], a hovered clip (any setting), and the slideshow's next clip (any setting: it plays it).
**L13 jumps the queue** whenever a line needs pages past what the gallery's list has read so far (user put it last;
without this, Endless would take the end of the read list for the gallery's end and move on).

Short labels the user reads (keep them when editing):
L1 HQ singles, on screen + next screen(s) · L2 HQ singles, rest of page · L3 Gallery lists · L4 Gallery thumbs, 10 per
round · L5 Gallery HQ, 1 per round · L6 Next gallery's p1 thumbs · L7 Full list of long galleries (slow) · L8 Next
results page · L9 HQ of hovered img · L10 HQ ±3 around it, then rest on screen · L11 Hovered gallery's p1 thumbs · L12
Thumbs, page on screen · L13 Rest of gallery list (slow) · L14 HQ, rest of gallery · L15 Bigger thumbs for big cells ·
L16 HQ of clicked picture (corner) · L17 Next galleries' thumbs p1–2 · L18 Next gallery's p1 HQ · L19 Slideshow HQ ·
L20 Thumbs, next page · L21 Thumbs, page after that · L22 HQ ±3 around hovered gallery img · L23 HQ, page on screen ·
L24 Clip/GIF stills with ▶ · L25 Full clips

**M1 – Landed on a results page:** 1 L1 · 2 L3 · 3 L4 r1 · 4 L5 r1 · 5 L4/L5 r2 · 6 L4/L5 r3 · 7 L2 · 8 L7 (cut by M5)
**M2 – Hovering a single picture:** 1 L9 · 2 L10 · 3 back to M1
**M3 – Gallery preview:** 1 L11 (clips as L24) · 2 L6 · 3 M1 from this gallery on
**M4 – Scrolling the results page** (a gallery's waiting loads dropped the moment it leaves the screen): 1 L1 for
pictures up to 2 screens below, as the page adds them · 2 L3 for galleries on screen and up to 2 screens below · 3 L4
r1 for the same · once still: M1 from the first gallery on screen. Unverified: lazy sites put the real address in the
page only near the screen (`data-src` etc. are read; a picture with no address yet waits).
**M5 – Reached the bottom of the results page:** 1 M1 lines 1–7 if unfinished · 2 L8 (next page's M1 1–6); M1 line 8
dropped (user confirmed). Galleries scrolled past were already dropped by M4.
**M6 – Just opened a gallery (P:), nothing hovered:** 1 L12 (clips L24) · 2 L16 · 3 L20 · 4 Upgrade clips on the page on
screen [Load all] · 5 L21 · 6 L23 [Load all] · 7 L14 + L25 [Load all] · 8 L17 [Endless] · 9 L18 [Endless, Load all] · 10 L13
**M7 – Stepped a page forward:** 1 L12 · 2 L20 · 3 Upgrade clips on the page on screen [Load all] · 4 L21 · 5 L23 [Load
all] · 6 L17 [Endless] · 7 L14 [Load all] · 8 L18 [Endless, Load all] · 9 L13
**M8 – Hovered a picture in the gallery:** 1 L9 (a clip: in full) · 2 L22 (clips among them stay L24 unless [Load all]) ·
3 L12 · 4 L20 · 5 Upgrade clips on the page on screen [Load all] · 6 L21 · 7 L23 [Load all] · 8 L17 [Endless] · 9 L14
[Load all] · 10 L18 [Endless, Load all] · 11 L13
**M9 – Stepped a page back:** 1 L12 · 2 L20 · 3 Upgrade clips on the page on screen [Load all] · 4 L21 · 5 L23 from the
page's end backward [Load all] · 6 L17 [Endless] · 7 L14 [Load all] · 8 L18 [Endless, Load all] · 9 L13. User's reason (2026-11-27): a step
back is temporary — to save or re-hover one picture — then forward again, so pages ahead stay. Settle from the log:
`page` dir -1 then further back vs forward, `pv`/`save` on the back page (`save` added v0.437.0).
**M10 – G: pressed, stepping whole galleries:** 1 L12 (clips L24) · 2 L16 · 3 L17 first gallery [Endless] · 4 L20 · 5 L17
the rest [Endless] · 6 L13 · no HQ or full clips until a hover (then M8)
**M11 – Endless landed on the next gallery:** as M6 (P:) or M10 (G:)
**M12 – Slideshow on a results page:** 1 L19 ahead, nearest first · 2 L19 behind
**M13 – Slideshow in a gallery** (user's): 1 HQ of the next 10 in its direction, kept 10 ahead (a clip: in full, any
setting); if the slideshow catches up with the loaded ones, 20 ahead before anything below resumes · 2 L12 of the page
it is on · 3 L20/L21 (next 2 pages) · 4 L17 [Endless] · 5 L23 [Load all] · 6 L14 + L25 ahead of it [Load all] · 7 L18
[Endless, Load all] · 8 L13. Starting a slideshow without Load all: the page's clips load in full (any not started).
**M14 – Gallery closed:** M1 from the first gallery on screen

M6 has L14 before L17, M7–M9 the reverse — on purpose (user): a fresh open means they want this gallery; once they
step a page or gallery they are skimming, and M6 does not return until the gallery is closed and opened again.
"Upgrade clips" = the page on screen only; when Load all reaches the next page, its clips go first.
**L17 is capped at the first 2 pages of each next gallery** (user: some have hundreds of thumbnails) — as now.

**L13 split, built v0.453.0** (the count; how it is learned and used: GALLERY.md "Cheap count"). The user's ask: the list read is one thing today — an HTML fetch of the gallery page gives
each picture's thumbnail + link, and their number *is* the count; past what the HTML holds, only a hidden frame
(the page loaded in full, scripts and images included; measured ~5–9 s each, one at a time) reads the rest. Cost (`galRender`
grow mode): it downloads what a visit scrolled to the bottom would — page, scripts, ads, every thumbnail; only video,
audio and embeds are stripped (`galNoMedia`). Time floor: page load + first report (settle 700 ms, cap 4 s) + one screen
per 400 ms (`GAL_GROW_TICK`) + 4 s idle at the bottom (`GAL_GROW_IDLE_MS`) to know it ended. Blocking its images is not
possible from a userscript (and lazy-loading pages only add more as images load). Full-size
addresses are not part of it: each is found per picture when its HQ is wanted (`galResolve`). Wanted: the **count**
first and cheap — a stated number ("240 photos") or the gallery's own pager, learned per site with the frame's final
count as ground truth (shared rule §learning) — then the rest of the list only when thumbnails past it are needed.

**Next-page finding (all three scripts, user 2026-11-27):** the best parts of each, one shared copy (as us-dock/us-log).
Open Links in New Tab (`nextPageReason`) recognises *that* a link is a pager control — rel, icon-only arrows by
aria-label/title/class, pagination containers, a word list, URL shapes (`?page=`, `/page/N`, `page-N`, sort-word/N,
a trailing number labelled N or N+1). It does not pick *which* is next. HZ `nextPageIn` and FS `detectNextRecord` pick
direction (rel="next" → the number after the current page → a lone forward word); FS adds a user-taught pager and a
learned rule. Its own piece of work, across three repos.
