# The tour — next/previous navigation through a page's pictures

**Vocabulary.** The user says **the slideshow** (the pinned preview stepping through a queue of the
page's pictures) and **the widget** (the floating ◀ `n / N` ▶ box that starts it). The code and these
notes say `tour`; every user-facing string says *slideshow* or *widget* (settled 2026-09-23).

**Status: BUILT, v0.96.0-v0.99.0; reworked v0.120.0-v0.139.0** around the widget. Kept as the
reasoning behind the shape; where the build departed from the plan the section says so, and §15
lists what is still only a guess. Section numbers are cited from code comments, so a deleted section
leaves a gap rather than a renumbering (§3, §4, §12, §13 went with the in-window nav group).

The live account of what the code does is `INTERACTION.md` `S25`, `S26`, `T29`-`T40`, `E54`-`E60`,
`E63`, `E64`, `E67`.

## The widget — BUILT, v0.120.0. Replaced the in-window nav group

◀ ▶ used to live inside the frame, whose size changes per picture, so every step moved them; the
relocation, the anchored corner, the two-press entry and the nav-driven size floors all existed to
fight that. They are deleted. Do not put nav controls back on the frame.

- **The widget** (`buildTourWidget`): ◀ `n / N` ▶ in its own fixed host outside the preview's, with
  its own shadow root (button CSS shared via `vbtnCss()`). Positioned by the shared dock —
  [`WIDGET-DOCK.md`](WIDGET-DOCK.md). Its host must come AFTER the preview host in the DOM, or the
  preview covers it (`buildViewer` re-appends it).
- **Visibility is `style.display`, not `[hidden]`**: the host's inline `all:initial` out-ranks the UA
  `[hidden]` rule. `twRefresh` sets both, and `dock.show()` tells the other scripts.
- **Shown** on pages with two drawn pictures at `idleFloor()` (`twCount`, stops at 2), or while a
  tour runs. **Once shown it stays on that URL whatever the count** (`twShownOn`, v0.155.0) — the
  user's request, for debugging: a widget left at `– / 0` flags a count that dropped, to be judged
  a bug or legitimate. Temporary; restore hiding when the user says so. The `– / N` total (`tourPics`) is taken with every recount — load, scroll stopping, SPA
  navigation, any `<img>` `load` (document capture; a lazy picture landing after page load, v0.150.0)
  — and again when the pointer comes near, which catches a page that changed without
  scrolling (no MutationObserver: design invariant). With `debug` on, a changed count logs
  `twReport()`: every drawn picture and the gate that dropped it, URLs replaced by `U1…` labels
  (the user diagnoses private sites with it — keep it URL-free). Faint (`tourFade`, at `tourFadeTo` %) until the
  pointer is within `TW_NEAR`; a `mouseover` on the host covers a pointer resting where it appears.
- **▶ with nothing open starts at the FIRST picture, ◀ at the LAST** (user's call: no guessing a
  start) — `tourFromStart(dir)`. **→ / ← do the same** (`tourKeyStart`, default on):
  window bubble phase, so a page that preventDefaults or stops → keeps it; not while focus is in a
  form control, media, or a slider/tab/menu role. Starting from a chosen picture = hover or pin it.
- **The first picture is resolved on landing** (`twWarmFirst`, from `twRefresh` whenever the widget
  is up and the first entry changed): `tourFromStart(1)` uses `twWarm.res` when it is for the same
  element at the same size, so ▶/→ from idle opens at once instead of after a silent resolve.
  Measured on the test page: 19 ms. One resolve per page (or per new first picture), at most 8 probes.
- **From idle, sidebars are left out** (`mainPics` → `sideColumn`, v0.130.0; §1b), and the widget
  counts and shows by the same list.
- **Its scope is `tourCommon()`: the smallest element holding every picture counted**, `<body>`
  counting as the whole page. Not the whole document: hackaday's article links `rel=next` to the
  NEXT ARTICLE, and a whole-page scope carried the tour onto it, harvesting its icons and sidebar
  thumbnails (a fetched page has no layout, so the size gates cannot drop them). Only a whole-page
  scope crosses pages (`tourCross`), so an article never does.
- **Every tour picture opens at the slideshow's remembered spot** (centre by default; drag one to
  move it — `E64`, [`VIEWER.md`](VIEWER.md)), as large as settings allow; the widget floats over it
  and no space is reserved (user's call). Hover placement follows `cfg.position`.
- **The entering press advances.** Measured sizes: re-publish after every counter change
  (`twSync` → `sizeChanged`), since the Browser pane never fires `ResizeObserver`.
- **Arrow keys** are ours while a preview or tour is up, plus → from idle (above). Forum Stumbler has
  no key handler of its own (checked twice, 2026-09-22).
- **The ⇅ wheel button** (`T41`, `E72`, v0.162.0): for 50+ step tours, where a pointer drifting off
  ▶ costs a click. Armed state is `twWheelArmed` = the URL it was armed on; `twRefresh` disarms on a
  different URL, `tourEnd` on any close. Reach (`wheelRange`, 65) is always live and measured from the
  button, not the widget (user's call); armed means anywhere. A setting because the user tunes it.
  **Lit without a move** (v0.172.0): `twPtr` is the last pointer seen (move, trusted mouseover, wheel),
  saved to sessionStorage on `pagehide` and restored on the next page in the tab if <30 s old and the
  window is the same size; `twNearAgain()` re-tests it whenever the widget is shown or docked.
  **Unlit on leaving the window** (v0.177.0): a document `mouseout` with no `relatedTarget` calls
  `twLeave()` — clears `twPtr`, `twWheelIn` and `tw.near`; armed stays lit. The browser sends nothing
  outside the window, so reach cannot extend past its edge. Also fires entering an iframe (correct: our
  wheel listener cannot see a wheel there either).
  **The opening spin is dropped** (`twWheelHush`, v0.172.0, user's call): after the tick that starts
  a slideshow, wheel events in reach are swallowed until the wheel rests 300 ms or 500 ms pass, so
  one flick opens at picture 1. The cap is what answers the earlier objection to waiting for the
  wheel to stop (a free-spinning wheel would need stopping by hand).
  ◀ ▶ repeat when held (`twHoldOn`); that listener must be capture — see `../../CLAUDE.md`.
- **One help tip, on the counter** (v0.171.0, user's call): the buttons have none; resting on the
  middle for `TW_HELP_MS` lists all three in three lines. The loaded count (`twLoadSync`) shows only
  with `debug` on.
- **Position memory** (`DOCK_KEY`): per site, falling back to the last drop anywhere; first run
  attaches on top of Forum Stumbler's bar, or the window's bottom-right when it is absent.

A *tour* is next/previous navigation through the page's pictures, driven from a pinned preview
window. Each step swaps a different picture into the same window at the slideshow's spot, and the
page scrolls along ahead of it, on sites that load more as they scroll (§9).

**No line numbers into `Hover-Zoom.user.js` appear below, deliberately.** They were here, taken at
v0.79.0, and v0.80.0–v0.85.0 moved the probe region ~110 lines; a plan this long outlives any of
them. `grep -n` the symbol name. (Refs into *other* scripts — Forum Stumbler, OLINT — keep their
numbers; those files are not moving under us.)

### What shipped since this was written, that the plan assumed was missing

v0.80.0–v0.85.0 landed the resolver work §14 was measuring, so three items below are done:

- **CSP refusal is detected and routed** (`cspRefused()` → `bytesFor()`, v0.83.0). A page whose
  `img-src` refuses off-site images now gets the bytes via GM_xhr and displays them as `blob:`, or
  `data:` where `blob:` is also refused. `@connect *` is in the header for this.
- **Brave's base64url originals decode** (v0.84.0), generically — any imgproxy-shaped path, not a
  Brave rule. Verified end-to-end in a real browser 2026-09-07: a Brave result whose only candidate
  was a 500 px proxy thumbnail previews as the 564×752 original.
- **Size parameters drop from extensionless CDN paths** (v0.83.0), plus Reddit/Flickr/gelbooru
  rules and leading thumbnail markers (v0.85.0).

v0.86.0-v0.87.0 then took the marker vocabulary out of HZ+'s plugins and added Pinterest's size
segment, and **v0.88.0-v0.89.0 built §7 and §8** — the retry model, the size-derived timeout budget,
and showing the page's own picture with a reason when one fails. Those were the parts that were
*not* about the tour, and they are done. `RESOLVER.md` holds the live account of all of it.

---

## 0. The invariant rewrite — DONE, v0.96.0

The rule in `../CLAUDE.md` was rewritten, and so was the script's own header comment. What follows
is why, kept because the reason is the part that stops it being rewritten back.

`../CLAUDE.md` used to carry, under "Design invariants":

> **Nothing is decided before hover time.** … Do not add a MutationObserver or a pre-pass "for
> performance", and never bind state to an element that might change under it.

Replace it with:

> **Nothing is cached that the DOM can invalidate.** Everything resolves from a read taken at the
> moment it is needed — hover time for a preview, press time for next/prev. Do not add a
> MutationObserver or a pre-pass "for performance", and do not hold a reference to a page element
> across an interaction; re-derive instead. Reading the document ahead of a hover is fine, and the
> navigation list does exactly that — keeping the answer is what causes the bugs.

The old wording banned reading the document ahead of a hover. What it was actually protecting
against was *keeping* the answer: stale `src`, SPA navigation, images added after a scan, dead
references. The list below re-reads on every press and keeps nothing, so it has none of those
failure modes.

Approved by the user 2026-09-07. The rule is not a veto on the feature; it is being changed
because it outlived its scope.

---

## 1. The list is derived, never stored

On every press: `document.querySelectorAll('img,video')` → sort into reading order → find the
anchor → step. No observer, no scroll listener, no maintained array.

Why this shape rather than a maintained list:

- A maintained list fills with nodes a virtualised feed has already destroyed, and you then owe
  reconciliation code to notice.
- Re-deriving is ~5ms on a keypress. That is a keypress budget, not a hover budget.
- Lazy-loaded and newly appended images are picked up for free, because every press re-reads.

`coveredMedia()` is the existing precedent: a read performed at the
moment of need, caching nothing.

### The anchor is an element, not an index

Store the current element, its URL, and its last known document-space position. Each press locates
the anchor by, in order:

1. element identity
2. URL match
3. nearest by last known position, in the direction of travel

Step 3 is what survives a virtualised feed deleting the node under you. Never store an index — the
list length changes under you.

### Ordering

- Sort in **document coordinates** (`rect.top + scrollY`), never viewport coordinates, or the
  order changes as the page scrolls.
- Reading order is a **row sort anchored on each row's first item**: an item joins the current row
  if it overlaps that row's *first* (topmost) item by half the shorter height, then the row sorts
  by `left`. A plain `(top, left)` sort scrambles a ragged grid where a neighbour sits a few px
  lower. **Never let the row's extent grow as items join** (the v0.100–v0.135 band): on masonry
  (Google Images' columns since 2026) overlaps chain into bands taller than the viewport, the tour
  walks down one column then jumps back up to the next, and with the page following (§9) the page
  scrolls up and down. Measured on Google, 199 pictures: band 35 upward jumps >150 px (max 624),
  anchored 3 (max 178).
- Ties break on document order.

### Membership

An entry is eligible if `eligibleDirect(el)` returns it. That guarantees the list can
only hold things that would preview if hovered, and it inherits every existing gate — `videoMode`,
the block list, banner/furniture rules — with no new code. Clips and images share one list.

**A picture a learned late-player rule covers is out too** (`latePlayerArea()`, v0.192.0 — GATES.md
`E62`). Hovering it plays the page's own clip and our preview withdraws, so the slideshow must show
nothing for it either; a video site's listing page then counts under two and the widget hides.
`eligibleDirect()` cannot see this — the clip only exists during a hover — so the learned record is
the only evidence. A **user** entry does not exclude: it covers the whole site, photo pages
included, and says only "wait", not "nothing previews here". Before three flashes have taught a
rule the cards still count; nothing static tells them apart. `vdApply()` calls `twRefresh()` so the
count drops the moment a rule is learned or forgotten.

**A repeat of a picture already in the list is out** (`tourDedupe()`, v0.193.0, user's request): same
`pk` (`plKey`: shown URL + link href; harvest entries: URL) = same picture; the **first** copy
stays, later ones go. Not the URL alone: one thumbnail linking to different originals is several
pictures (the test page does this — 19 dropped by URL, 12 by `pk`). Applied last, on the finished
list (live + roll ghosts + harvest), so the roll still remembers every copy. Placeholders (`pk` is
the element) are never deduped — they all share one URL. The widget counter's tip says how many
were skipped (`tourDupes`/`widgetDupes`). Hovering a dropped copy still previews; a slideshow
started on one lands on the first copy via `tourAt()`'s URL fallback. Setting `tourSkipDupes`.

**By content too** (v0.195.0 — a re-upload gets a new URL, same bytes; the user's site does this).
`fpTake(el, res)` runs per entry the preloader resolves:
1. Re-open the entry's **thumbnail** (shown URL, ≤ `FP_THUMB_PX`) with `crossOrigin` and sample it
   at 16 px → `w×h|FNV`. Free: small files come back from the HTTP cache.
2. Sample match → the two thumbnails compared pixel for pixel (small decode).
3. Then the **originals** by one ranged GET each (`fpHead`: total size + FNV of first 64 KB). Needed:
   identical thumbnails can stand for different originals (test-page's `photo-200x150.jpg` cases).
Confirmed → `dupOf` (plKey → plKey); `tourDedupe` keys by `dupRoot(pk)`. The total shrinks as the
preloader goes. A host unreadable `FP_STRIKES` (3) times is left to the URL check.
Do not go back to (measured on `test-pages/perf-dupes.html`, 12 MP photos):
- **Re-reading the originals in CORS mode:** the kept `Image` is unreadable (taint is stamped at
  download, not by the server's answer), the CORS re-open is a different mode from the memory cache,
  and the pane's HTTP cache does not store 7 MB files → a full second download per picture.
- **Comparing originals by pixels:** decoding a 12 MP photo blocks the main thread ~250 ms per pair,
  even through `createImageBitmap(img)`.
- **`img.decode()`:** never settles while the pane is hidden.
Cost now, 24 entries / 4 copies: 0 long tasks, 0 extra full downloads, 8 × 64 KB, all found in ~3 s.
**Test fixtures reuse `photo.jpg?n=…`**: pager-1 counts 1 with this on — turn it off to walk them.

**Never drop an entry for failing to resolve.** The user's stated reason: a page with 50 images
must give a tour of 50, and a picture they spotted half way down is their landmark for "half
done". A failure shows the thumbnail and a reason (§8); it does not vanish.

That extends to the size gate. `sizeOf(el)` reads the layout rect, and a below-the-fold
`loading="lazy"` image with no width/height attributes is often 0×0 until it loads. Fall back, in
order: layout rect → `width`/`height` attributes → probed dimensions. Only something that is
genuinely not a picture leaves the list.

**Scope limit:** `img`/`video` only. Elements with a CSS background image stay hoverable but are
not in the tour — enumerating them needs `getComputedStyle` on every node in the document.

## 1b. Sidebars, by width — v0.130.0

A slideshow started from idle (▶/→/← with nothing open) skips pictures in a side column; so does one
pinned on a picture the widget counts (§1d); one pinned on a sidebar picture does not (`tour.mainOnly`,
off after `{`/`}` too). `sideColumn(el)`: the widest
ancestor still under 45% of the window, if it is at least min(600 px, 60% of the window) tall and has a
sibling 1.5× wider beside it (overlapping vertically). The height test keeps floated figures and grid
cards out. Width only, no markup: the user's rule is "the wide middle column is the content".

v0.129.0's named sections (Main/Replies/Comments/…, with a switcher) were reverted in v0.130.0 —
**shelved, not rejected** (user): pulled only so other slideshow issues could settle first. §1c is the
part of it the user asked back for; the switcher and the other sections are not rebuilt.

## 1c. The post end — v0.156.0

A slideshow of a thread or an article keeps to the post: its replies/comments are left out.
`postEnd()` → `{ cut, how }`, the first element left out (everything at or after it in document
order, `atOrAfter`), or `{ cut: null, why }`, or null.
**Memoised since v0.179.0** (`postEndMemo`): `postEndNow()` walks every element (~220 ms per call on an
8,000-element page in Firefox, 90% of a slideshow step's cost, measured with the perf recorder). The
answer is reused only while a key read fresh on every call matches — URL, element count, viewport
size, `body.scrollHeight`, `tourMinDisplayed` — and the cut and group are still connected. This bends
the "nothing cached" invariant deliberately: the key is re-read each time, so a changed page re-derives.
Known blind spot: a change that keeps the element count and height (a class swap) keeps the old answer.
Applied: idle start and the widget count always (`idlePics`); a pinned start only when the start
picture is above the cut (`tour.postOnly` — begun in the comments, the comments are the tour).
`}` at the whole page lifts it. A post-only tour is confined: no harvest, no next page.
The user's pass mark: **the line may land anywhere between the end of the post and the first
reply's first picture** — exact placement and consistency between sites do not matter.

1. `postGroup()`: the largest (by text) run of siblings sharing a tag and **any one** class, every
   member post-like (`postishDeep`: /post|comment|message|repl|answer|comtr/ in class/id, comment
   itemtype, `data-post-*`, checked 5 levels down the first-child chain — vBulletin wraps
   `table#post…` in 4 bare divs), ≥40 px tall, ≥30% of the window wide, stacked (not side by side).
   Any one class, not the exact list: XenForo's OP carries extra `message--thfeature_firstPost`.
   Members under 40 px are dropped, not fatal (vB's empty `div#lastpost`). A parent whose post-like
   children are mostly **cards** (h1–h3 link ≥8 chars to another page, not a profile) is skipped
   whole — judged on all of them, or two recipe cards sharing `category-summer` pass as a thread.
2. The group is **comments under a post** if its replies nest (a member holds another of its own
   class — Lemmy, WordPress; forum posts never nest), or above member 1 there is (`postLead`): a
   picture with shorter side ≥ 100 px after the last h1, outside site chrome/sidebars (a 683×52 logo
   strip and a 159×26 button are not); a visible editor (HN); an "N comments/answers" or "leave a
   reply" heading (SE, WordPress); or ≥ 800 characters of non-link text after the h1. Then the cut
   is the group's `COMMENTS_SEL` ancestor if it does not hold the h1 (Invision's `#comments` holds
   every post), else member 1 — **unless member 1 holds the h1**: then it is the post, and the cut is
   member 2. (A Bootstrap page grouped its `div.row`s, which nest by design, and cut at the post's own
   top; requiring the nested row to be post-like did not help — its rows were.)
3. Otherwise it is a **thread** and member 1 is the OP: cut = member 2 — unless the page is past the
   first (`threadPage()`: URL `page-N`/`/page/N`/`page=`/`start=`/SMF `topic=N.M`, or the pager's
   current number) or member 1's `data-post-number`/`data-number` is not 1 (Discourse/Flarum deep
   links): no cut, the whole page is replies.
4. No group: the first `COMMENTS_SEL` element, if any.

Debug: setting `showPostEnd` ("Draw where the slideshow stops") draws `hz-post-end` (red,
document-absolute, redrawn by `twRefresh` via `tourLinesSync`) with `how`, or dashed at the top with
`why`, plus one orange `hz-side-edge` per sidebar holding pictures (`sidebars()`, from
`sideColumnEl`; a sidebar with no pictures draws nothing), on the edge facing the main column. It
also logs `[Hover Zoom] slideshow lines` to the console once per change (`tourLinesReport`):
tags/classes/ids, sizes and positions only — no URLs, no page text — so the user can paste it
without revealing what they were reading. **Ask for that report first** when a line is wrong.

Custom elements: `postish` also tests the tag name when it has a hyphen, and `nests` uses a
classless custom tag as its selector — Reddit's comments are classless nested `<shreddit-comment>`,
which matched nothing before v0.157.0 (no line at all). Unknown elements are `display:inline` and
report an empty rect, so geometry goes through `rectOf` (children's union).
`test-pages/reddit-like.html` is that shape; the tool browsers cannot open reddit.com itself.

Measured 2026-09-25 in Chrome, logged out — right: XenForo (anandtech), phpBB (linuxmint),
Invision (linustechtips, and page 2 → none), vBulletin 6 (city-data), Discourse (meta), HN, Lemmy,
WordPress (smittenkitchen), Stack Exchange, 4chan, imgur, test-pages/forum-thread.html. No line
(right): HN front, a XenForo forum index, the WordPress home page. Not reached: Reddit (the
extension refuses it), phpbb.com / simplemachines.org / eevblog / community.mybb.com (bot checks).
Unverified: Flarum; logged-in pages (an editor above member 1 reads as comments — 4chan's hidden
top form is why that would matter); Discourse before its posts render (null until they do).
Survey notes: on thread forums the reply box is **after the last reply**, never between post and
replies; on comment pages it is between (HN, and Reddit/Lemmy logged in).

## 1d. The roll — a recycling feed keeps what it unmounted (v0.187.0, user's design)

Imgur mounts only the pictures near the viewport, so the derived list was 20, then 16, then 12, then
24 as the page scrolled, and the pictures above were gone. `tourRoll()` runs on every `tourEntries()`
answer: an entry whose element has **left the document** stays in `tour.roll` as a *ghost* (a copy
with `ghost: true`, its detached `el`, its `pk`, and its document `x,y,w,h`), ordered with the live
ones by `tourOrder`. A ghost is dropped when a live entry has its key (`rollKey` = `pk`, the
preloader's picture+link key — mounted again) or covers over half of its spot (`rollOver` — the page
put a different picture there). A connected element missing from the live list is dropped too: the
page still has it and says it is not a picture now.

**One roll per page, for the widget's list** (`pageRoll`, v0.188.0, user: "the widget needs to track
the page even if the slideshow is not active"). `widgetEntries()` = the idle derivation
(`idlePics` → `tourEntriesIn(…, tourCommon, noTail)`) through `rollMerge`, and it is the idle count;
a tour whose list is the widget's (`tourIsWidget`: mainOnly + postOnly + the idle floor) merges into
the same `pageRoll`, so closing and reopening, or switching between ▶ and a pin, keeps count and
position. It resets on a new URL or idle floor (`widgetSig`). A tour on any other list (a `{`/`}`
rescope, a pin outside the widget's list) keeps its own roll on `tour`, dying with it.
**A pin on one of the widget's pictures IS the widget's slideshow** (`tourStart`: in
`idlePics(floor)` → mainOnly + postOnly). The §1a area rule now applies only to a pin the widget does
not count — a reply below the post end, a sidebar, a picture under the idle floor. On
`test-pages/forum-thread.html` at 1280 px: pin on the post → `2 / 12` (was the post's 11 via §1a; the
widget's 12 adds the signature), pin on a reply → `14 / 15` (§1a, unchanged).
**Idle tracking while scrolling:** once a page is seen to unmount (`pageRoll.recycles`), `twRecount`
also reads the list every `TW_TRACK_MS` (250) during a scroll (`twTrack`), or pictures passed without
stopping are never seen. `twRecount`'s debounce has a ceiling (`TW_RECOUNT_MAX_MS`, 1 s): every `<img>`
`load` re-arms it, so on a feed that keeps loading the recount was put off for screens at a time.
**▶/◀ from idle on a ghost** (`tourFromStart`): following scrolls to it, `ghostLive()` waits
`GHOST_LOOKS` for the page to mount it and starts on the live element; failing that, on the
preloaded answer, else the next entry. `twWarmFirst` skips a ghost (nothing to resolve from).

This is a deliberate exception to "nothing is cached that the DOM can invalidate": what is kept is a
URL and a position, never trusted. **Arriving on a ghost** (`tourShowGhost`): the preloader's answer
for its key is shown at once (`plDone.get(pk)`; nothing resolves from a detached element), following
has scrolled to its stored position, and at `GHOST_LOOKS` (100–1600 ms) `tourRebind()` looks for the
live element — same key: bind to it, "checked"; a different picture in that spot: bind to that and
show it. Measured on Imgur (Chrome, 2026-09-27): document positions of remounted pictures are
identical, so position is a sound key for the spot. `plFill` skips ghosts it has no answer for.
Stepping backward rarely lands on a ghost (following scrolls ahead and the page remounts first); a
wrap to the far end always does, and that end is where the page loads more.

**The top row goes to the very top** (`tourFollow`): a picture whose bottom fits the first screen
scrolls the page to 0, so the scrollbar says "top". Following alone left Imgur at y≈258 (its first
row starts under a 350 px header), and the user kept wheeling, crossed the seam and wrapped.

## 1a. The scope and the floor — BUILT, v0.100.0

**Since v0.188.0 this applies only to a pin on a picture the widget does not count** (§1d); a pin on
one it counts opens the widget's list. The post end (§1c) now does the "post's ten" job for that case.

A hover may expand anything — an icon, an avatar, a sidebar picture. A tour must not: asked for
2026-09-11 with the forum case — one post carrying ten pictures, dressed with an avatar, badges,
emoji, a signature, a sidebar, and fifty replies each with their own avatars and pictures. The
tour is the post's ten and nothing else. **The picture the window was pinned on is the user's
example of what they want**, and two things are read off it at `tourStart()`:

- **The floor** (`tour.floor`): `tourMinDisplayed` (default 128), on the **longer side as drawn**.
  Emoji, badges and 96px avatars fall under it. It was the shorter side in v0.100.0, which threw
  out a 60×150 picture (reported 2026-09-11) — a narrow picture is still a picture, so v0.101.0
  reads the long edge; the cost is that a 468×60 signature banner now passes. Unknown size stays
  in, as before. The floor is lowered to the start picture's own longer side when that is
  smaller — a tour begun on a 100px thumbnail admits 100px, or an old forum's attachment thumbs
  would give an empty tour.
- **The idle floor** (`idleFloor()`, v0.185.0): the widget's count and every idle path use it, not the
  setting directly. It is `tourMinDisplayed` unless that gives `idlePics()` fewer than two; then a
  **thumbnail grid** sets it — ≥`GRID_RUN` (4) `tourPics(GRID_MIN)` pictures within ±2 px of one long
  side, `GRID_MIN` (64) ≤ side < the setting, none linked to a profile (`PROFILE_URL`, so linked avatars
  never form one) — floor = that side − 2. Commons (200 × 120 px) and Lemmy lists (80 px, unlinked
  buttons, so "must be a link" was tried and fails) had no widget before. Ask `idlePics`, not raw rects:
  Lemmy's 966×240 banner and 139×18 logo pass 128 raw and are then refused. `postEnd` keeps the setting.
  A page of ≥4 same-size unlinked avatars ≥64 px with no real pictures gains a widget — accepted
  (user, 2026-09-27): the block list is the answer for those, not a tighter rule here.
- **The scope** (`tour.scope`): an ancestor of the start picture; only pictures inside it are in
  the list. Chosen by `tourPick()` from the *levels* (`tourLevels()`): the chain of ancestors at
  which the count of floor-passing pictures grows, one level per count, holding the **outermost**
  element with that count (so the post, not its body — the post's chrome is what the next test
  needs). Start at the smallest level holding two pictures, then climb past every **wrapper**:
  an element with under 200 characters of text whose element count, once each picture's own
  single-picture wrapper is subtracted, is under 8 (`tourWrapper()`). A `<p>` holding two
  thumbnails, a `<figure>`, a gallery row are wrappers; a post with a header, buttons and text is
  not. The first non-wrapper level is the scope.

Consequences that follow from that rule and are intended:

- A post with **one** picture is a wrapper by count, so its tour is the thread. A tour of one is
  no tour; the thread is the next-best answer.
- A picture in a *reply* tours the thread, for the same reason.
- A grid page with nothing else on it scopes to the whole page, which is what it was before.
- The scope element is held like the anchor is: kept while it is in the document, re-derived
  from the start picture when a virtualised feed destroys it. `tour.level` survives that.
- **The next page is only fetched from a scope that is the whole page** (`tourCross()` refuses,
  without setting `crossSpent`). A tour confined to one post has no business on page 2; `}` up to
  the whole page and ▶ at the wall crosses as before. Loading more (§9) still runs — it is
  invisible and a scoped infinite grid benefits.
- Harvested entries join the list only while the scope is the whole page, for the same reason.

**`{` narrows the scope one level, `}` widens it** (`tourRescope()`), never below two pictures,
and the counter is the feedback: `1 / 10` → `1 / 47` → `13 / 49`. This is the escape hatch for the
heuristic — the thresholds (8 elements, 200 characters) are starting values, measured on
`test-pages/forum-thread.html` and nothing else yet. An anchor left outside a narrowed scope shows
as `– / n` and the next step goes by position, exactly as a destroyed anchor does.

`test-pages/forum-thread.html` is the fixture: levels come out as `img(1) → p.pics(2) →
article#post-1(12) → main(15) → html(17)`, the pick is the article, and `}` `}` walks to 15 and 17.
The 12 are eleven pictures — one drawn 60×150 — and the post's signature.

---

## 2. The swap

Three functions now put media in the window, and they are not interchangeable:

| Function | Used when | Keeps |
|---|---|---|
| `showViewer()` | opening a new window | nothing; positions from the pointer or a remembered spot (`E64`), fades in |
| `upgradeViewer()` | a better version of **the same** picture arrived | zoom and pan — you stay on the same spot |
| **`swapViewer()`** | a **different** picture, same window | the hand-set size if there is one; placed at the slideshow's spot |

`swapViewer()` resets `scale` to `fitScale` and recentres `ox`/`oy` — carrying a pan offset into a
different picture is meaningless. Borrow the centre-preserving arithmetic from `upgradeViewer()`.

It must also update `active` and `activeShown`, or ⊘ blocks the wrong image and unpinning
misbehaves.

**The frame resizes only once `imgEl` itself holds the new picture** (v0.213.0). While a new `src`
loads, the browser keeps painting the OLD picture (the element's pending request), so resizing
first stretches it. `swapViewer()` sets `imgEl.src` via `setMedia()` with the geometry untouched;
if `imgEl.complete` it commits at once, else it waits on `imgEl.decode()` (spinner meanwhile,
`swapHold` set so `verifyMedia()` does not compare against the old size), then `commitSwap(res,
true)` changes the geometry and verifies. A decode failure still commits. `swapSeq` drops a swap the
user has moved past. Videos commit directly.
Do not go back to decoding an off-screen `new Image()` and then setting `src` (v0.161.0–v0.212.0):
the window's element can still re-fetch (no-store, evicted, different request), and ~1 in 15 steps
stretched.

### Growing and shrinking — already free

Frame follows the picture unless the user hand-resized. This is existing behaviour and needs no
new code: `view.fixedW`/`fixedH` are null until a hand resize, `resizeBy()` is their only
writer, and `reflow()` already branches on them. `swapViewer()` calls `reflow()` and gets
the right answer either way.

### The frame during a tour

Capped at the viewport (`growBox()`): a tour is a lightbox. No height or width floor is owed to
nav controls any more — they are in the widget.

---

## 5. Keys

`onPinKey()`.

- **Left/Right navigate when the picture cannot pan horizontally**, and pan when it can. Test
  `view.imgW > view.frameW + 0.5` — per-axis, not `pannable()`, which is either-axis.
  Correct edge case falls out: a tall picture at fit-width pans vertically, so Up/Down pan while
  Left/Right navigate.
- **Up/Down always pan.** Unchanged.
- **`[` / `]` always navigate**, or zooming in would trap the user on the current picture.
- **`{` / `}` narrow and widen the scope** (§1a). Not on repeat.
- `capOwns()` already stands the arrows down while the zoom field, scrubber or volume
  slider has focus. Unchanged, works for free.

### Scrub

OS key repeat is ~30/s, ten times the target rate, and would outrun any buffer instantly.

- **Holding an arrow steps and shows** every picture (v0.164.0, user's call: they need to see where
  they are). It was a scrub — resolve only once the key was still 150 ms — which moved only the counter.
  **No step ever waits** (v0.167.0, user's call; v0.165–v0.166 made every step wait for its picture,
  which ignored presses behind a slow one). A step shows the loaded original, else the page's own
  picture at once (`tourPageRes`), else an empty frame in the page's light/dark with a centred ring
  (`blankFrame`, after `TOUR_BLANK_MS`). Nothing is requested for a step until the user rests on it
  `TOUR_REST_MS` (`tourRest`), so flipping faster than the network requests nothing new.
- **No throttle** (v0.163.0, user's call; was 5/s on the argument that faster is too quick to see
  where to stop). `tourHoldRate` restores a cap; 0 by default.

---

## 6. The preloader — BUILT, v0.97.0

**What the build settled, beyond the plan:**

- **A speculative resolve issues one request at a time, not eight.** The plan feared "six
  concurrent resolves is up to 48 simultaneous requests" and asked for a global in-flight cap.
  There is none, because `resolve()`'s candidate loop `await`s each probe: a resolve has at most
  two requests open, its current probe and the linked-page fetch running beside it. The worker
  count IS the cap. **Slot spacing is still what bounds the request rate** — `plReserve()` hands
  out start times `PL_GAP_MS` apart, computed synchronously before any `await`.
- **A preload answer is only usable while the picture is still the size it was measured at.**
  `plRun` records the `displayed` rect it applied the `minRatio` gate against; `tourShow` refuses
  a buffered answer whose rect no longer matches (`sameDisplayed`). Without that, a below-the-fold
  entry measured at 0×0 passes the size gate trivially and caches an answer the foreground would
  have rejected.
- **`probeCache` dedup is worth more than expected.** Five separate entries in one window resolved
  to the same slow URL and cost one request between them, because the cache holds the *promise*.
- **Answers are kept for the life of the page** (v0.167.0; user skims 300 pictures, wraps and
  skims again). `plDone` is keyed by `plKey` — picture URL plus link href, the element only for a
  placeholder, whose URL is shared — so a feed that rebuilds its nodes keeps them, and closing the
  slideshow (`plStop`) keeps them too. Only a settings change or ⊘ clears them (`plReset`).
- **Everything loads, nearest first, ahead before behind** (behind counts double). `preloadAhead`
  limits it either way; 0 = all, 12 when the browser's data saver is on. The queue is rebuilt on
  every step; **nothing running is cancelled**, since a picture passed at speed is wanted on the
  way back.
- **Files are held to a byte budget, not a count** (`plKeepImage`, `preloadMB`; 0 = 1/8 of
  `navigator.deviceMemory` (Chromium only; the pane reports 32, so the spec's cap of 8 is not
  universal), max 1024 MB, else 1024). The size is estimated at 0.5 byte/px — nothing
  cross-origin reports it. Held because the HTTP cache evicts and a `no-store` file is never cached.
- **The no-rush list rides on the diagnosis that already exists.** `diagnose()` classifies a 429 /
  `Retry-After` as `busy`; `hardBlock()` hangs off that one line and needs no request of its own.
  It is remembered in GM storage across sessions, and it drops the pool to strictly serial.

Measured against localhost, buffered arrivals land in **~25 ms with no spinner and no upgrade
flash**. The local server cannot show the concurrency win — latency is what six workers multiply,
and there is none here; §14's live measurement is what that rests on.

### Why depth alone does not work

Measured by the user, 2026-09-07, on a Google image search results page: hovering 20 images in
sequence, each started when the previous finished, took **29 seconds — 1.45s per image**. The
target is 3 images/second.

Serial preloading N ahead still finishes one image every 1.45s regardless of N. Consuming at 3/s
while producing at 0.69/s drains the buffer at 2.31/s: a 10-deep buffer lasts ~4 seconds, about 13
images, then you are back to waiting. **Depth buys a burst; only concurrency buys a rate.**

With P resolves in flight, throughput is P/1.45 per second:

| P | images/sec |
|---|---|
| 1 | 0.7 |
| 3 | 2.1 |
| **5** | **3.4** |
| 6 | 4.1 |

**Target: 6 concurrent, window 10–15.** The window absorbs bursts; the concurrency sustains the
rate. Forum Stumbler independently landed on `PAGE_WORKERS = 6`, and **§14 measured 5.9× at 6
workers on live Google Images results — 5.3 images/sec, latency-bound as predicted.** Do not raise
the worker count without re-measuring.

**Clips are the exception**: they are 5–10× larger, so the window preloads video *metadata* only
and fully buffers just 1–2 ahead. See §14.

The two are separate settings and scale in opposite directions with connection quality: a slow link
wants a **deeper window** (more buffer), while **concurrency** only multiplies if the 1.45s is
latency rather than bandwidth. Google Images is expected to be latency-dominated — every result is
on a different third-party host, so each pays fresh DNS + TLS, and `collectCandidates` must pull
the real URL out of Google's `imgres?imgurl=` link via `linkParamCandidates` before
probing. **Not verified.** The test is to re-run the same 20-image walk against the concurrent
preloader and compare wall-clock.

### Structure — take this from Forum Stumbler

Read `../Forum-Stumbler/Forum-Stumbler.user.js`:

| Piece | Where | Why |
|---|---|---|
| **Slot-based request spacing** | `walkPageRange`, `:4048` | The standout. Reserves request *start times* spaced by `pageGap()`, computed synchronously before any `await` so two workers cannot claim one slot. Its comment: *"This, not the worker count, is what bounds the load on the forum."* Lets us have 6-wide concurrency **and** a bounded request rate. Hover Zoom has no politeness mechanism at all today — fine for one hover, not for a 6-wide preloader. |
| **`hardBlock()`** | `:3843` | Detects 429, Cloudflare interstitials, `Retry-After` on 403/503. |
| **`noRushHosts()` / `workersFor()`** | `:3867`, `:3891` | A host that pushed back drops to strictly serial, remembered in GM storage across sessions. This is the safety valve an aggressive preloader needs, already written. |
| **`ctl.cancelled`** | throughout | Matches Hover Zoom's existing `token.cancelled`. |
| **`ctl.mark(page, SEG_BUSY/DONE/TODO)`** | `:4085` | Per-item state, reported on **arrival** not delivery. What a buffer indicator would use. |
| **Failure containment** | `:4098` | `endAt = Math.min(endAt, page)` — stop scheduling past a failure, still deliver what is in hand. |
| **GM_xhr first, `fetch` fallback** | `fetchRes`, `:3902` | GM_xhr is not subject to the page's CSP/connect-src. Hover Zoom already does this in `headBytes`. |

**Do not take** the ordered-delivery machinery — the `got` map and `flush()` (`:4058`). Forum
Stumbler needs pages in order because `prevKey` and the `n` sequence only mean anything
sequentially. A preload buffer is a set, not a sequence; the user jumps to whichever picture they
are on. Dropping it removes most of the complexity. `PAGE_DELAY`'s 400ms serial politeness is also
an order of magnitude too slow for 3/s — slot spacing replaces it.

### Warming on hover — v0.131.0

A hover preview (`paint()` → `hwStart`) picks the picture's section with the tour's own rule
(`tourLevels` + `tourPick`, tour floor) and queues its **on-screen** pictures into this same
preloader as `hover: true` jobs (`hwFill`); a debounced scroll re-runs it and drops queued hover
jobs that scrolled away. The hover's own `resolve()` then hits `probeCache`. Off with
`hoverPreload`. `plReset()` forgets the scope; a tour's `plFill` replaces the whole queue.

### Loading the page ahead — v0.169.0

Without a slideshow, interest sets how far the page loads (`pgTick`/`pgWant`/`pgFill`, the
slideshow's own list `idlePics`, nearest the screen first, `page: true` hover jobs that `hwFill`
leaves alone): **1** what is on screen, from arrival; **2** the next screen too, after a preview
opened with the pointer below `PG_LOW` of the viewport; **3** the whole page, once scrolled
`PG_ALL_SCREENS` down or a screen away from where the last preview opened. Re-read on every
`twRefresh` (scroll-stop, lazy loads, navigation; reset on a URL change). A limit in `plDepth()`
(`preloadAhead`, or data saver) keeps it at 1. The widget shows the answered count of its list
(`twLoadSync`: "212 loaded", then "all loaded"), the user's signal that a show is ready to run
offline.

### Rules

- **A global cap on in-flight preload requests**, separate from resolve concurrency. `MAX_PROBES`
  is 8, so six concurrent resolves is up to 48 simultaneous requests without one.
- **Cut the probe budget for speculative items.** `resolve()` always tries the `keep` candidates —
  the link and the displayed src — and spends the rest of the 8 on guesses. Keep plus one
  or two guesses is enough for a preload; the full search runs on arrival if it came up empty.
  **It also runs on arrival when the preload was cut** (`candSig(el, PL_GUESSES)` is `''`) **or the
  candidates have changed since** — the preload shows at once, then `upgradeViewer` if the full one
  beats it (docked ring meanwhile). Before v0.126.0 a cut preload was final, so the slideshow showed
  smaller pictures than a hover of the same one.
- **The ring belongs to the token.** A resolve hides it in its `finally` only if not cancelled, so
  whatever cancels the token must hide it: `cancel()` does, and `tourShow()` does first thing.
  Before v0.138.0 a step that took the preload branch cancelled a pending live resolve and never
  hid its ring. With a fast key the ring then spun for ever over preloaded pictures (measured in
  Chrome: `from the preload buffer` logged, ring still on).
- **Prime links the page fills on hover** (`primeLink`). An `<a>` with no `href` around a live
  picture gets a synthetic `mouseover` before every tour resolve; Google Images writes
  `/imgres?imgurl=…` synchronously on it, and `linkParamCandidates` does the rest. Measured in real
  Chrome 2026-09-23: preloads went from 400–670 px thumbnails to the originals. `priming` keeps our
  own `onOver` out of it. **No `view:` in the event init** — the manager's `window` is a proxy and the
  constructor throws.
- **Foreground jumps the queue.** A resolve the user is waiting on must never sit behind six
  speculative ones. Two priority tiers.
- **Preloads never write to `view`.** Own token; `onHit` records only.
- `probeCache` is keyed by URL and holds a promise, so concurrent probes of one URL
  collapse automatically. Free.

### Arrival must be flash-free

`resolve()` emits every improvement as it lands and `upgradeViewer()` swaps it in live — on a tour
that means watching a thumbnail resolve into a mid-size into the original, fifty times. Eliminating
that, not just the latency, is the point of preloading.

So: on arrival, use the **completed** preload result and go straight to the final URL, skipping the
progressive emit path. Fall back to the live path only if the preload has not settled.

### Videos are not preloaded by probing

`probeVideo()` sets `preload='metadata'` and then calls `v.load()` to **abort** the fetch
once it has dimensions. Images land in the HTTP cache as a side effect of probing; clips do not.
Pre-warming a clip needs a separate hidden `<video preload="auto">` for the winning URL
(`plWarmVideo`). **How many is set by behaviour** (v0.170.0, `plVidLeft` on every slideshow step):
leaving a clip with under 90% of it played (`vidEl.played`) means flipping, `PL_VIDS_FLIP` (12)
ahead; watching it through means `PL_VIDS_WATCH` (5). Hover and page jobs never buffer a clip. How
much of each clip Chrome fetches under `preload="auto"` is the browser's call and was not measured;
the pane cannot test the watched branch at all — a hidden pane never plays a video.

Also keep the winning `Image` object alive for buffered entries — `probeImage` lets it go and
relies on the HTTP cache, which Chromium can evict.

---

## 7. Retry and timeouts — BUILT, v0.88.0-v0.89.0

**Shipped and verified in a browser. This section is now history; the live account of what the code
does is `RESOLVER.md` "Waiting, diagnosing, retrying".** What follows is kept because the reasoning
still explains the shape, and because one part of it was measured wrong and is worth not repeating.

**The one correction:** this section said a diagnostic that gets no response means the host is dead,
abort now. Built that way, a server that merely answers slowly timed the diagnostic out too and was
declared dead - killing exactly the case the design existed to rescue. Only an explicit refused
connection is fatal now; a timeout means slow and keeps waiting. `E52`.

Two smaller departures, both deliberate: attempts are 3 rather than 4 (the size-derived budget does
the work the extra attempt was for), and the failure display fires on a real failure only - see §8.

### What it replaced

| | |
|---|---|
| Image probe timeout | **20s** (`IMAGE_PROBE_MS`) |
| Video metadata timeout | 6s (`VIDEO_PROBE_MS`) |
| Retry on re-hover | **No, not for 30s.** `probe()` caches the *promise*; a null result schedules its removal after `PROBE_RETRY_MS = 30000`. A re-hover inside that window gets the cached failure instantly. |
| Shown on failure | **Nothing.** `resolve()` never emits, `onHit` never fires, `showViewer` is never called, the `finally` hides the spinner. The ring spins, then vanishes. |
| Can it tell a 404 from a timeout? | **No.** `probeImage`'s `onerror` fires identically for 404, dead host, CORS rejection and corrupt file. `new Image()` exposes no status. |
| Can it tell a CSP refusal from either? | **Yes, since v0.83.0** — the `securitypolicyviolation` listener names the URL, and `probeImage` routes a refusal to `bytesFor()` instead of returning null. This is the one failure kind already classified, and it is the free one. |

### The model to build

The user's analogy: type a URL, wait 3–4s, hit enter again, wait, open a new tab and retry, give up
after 3–4 attempts. **Short timeout, several attempts** — not one long wait.

- **Per-attempt timeout 5s** (from 20s), up to **4 attempts**, giving up at ~15s total.
- **A user gesture always retries.** Moving off an image and back, or pressing Retry, evicts that
  URL from `probeCache` and tries again. Automatic paths still honour the cached failure, so a page
  with a dead image does not re-probe forever.
- **Failure kind decides the schedule.** A 404/410 is definitive — one attempt, cache it. A timeout
  or network error is worth retrying. A 429 stops and marks the host no-rush. This needs the
  status, which means the GM_xhr diagnosis below.
- **A CSP refusal is definitive and free.** `securitypolicyviolation` names the blocked URL and the
  directive in ~1 ms, before any timeout and with no request spent. Never retry one, and never spend
  the paid diagnostic on it — the answer is already in hand. It is also not per-URL but per-host-set:
  once `img-src` has refused one off-site URL, every other off-site candidate on that page will be
  refused too, so the whole candidate list can be cut at once. See `RESOLVER.md` `E49`.
- **Tour retries are less aggressive but more numerous**: same 5s per attempt, ~6 attempts, backed
  off (2s, 4s, 8s), lowest priority. There is time, and nobody is waiting.

### The trap in shortening the timeout

`probeImage` resolves on `onload`, which is the **whole file**. A large JPEG on a slow link
legitimately takes more than 5s, so a flat 5s timeout would abort real downloads and retry from
scratch — an infinite failure loop on exactly the biggest pictures, which are the ones this script
exists to show.

**One number cannot serve both cases.** 20s is too long for a dead host and too short for an 8 MB
original on a slow link. The budget has to scale with the file.

#### Two dead ends — do not spend time on these

- **Resource Timing cannot report progress.** Entries are queued when a resource *finishes*, not
  while it downloads; there is no entry during the transfer. `transferBytes()` works only
  because it runs after the image has loaded.
- **`new Image()` is a black box** — no progress event, nothing between `src =` and
  `onload`/`onerror`.
- **GM_xhr + blob** gives real `onprogress`, but a blob URL is a different cache entry, so
  `mediaEl.src = res.url` would re-download. That destroys "probing *is* preloading", which the
  whole preload design (§6) rests on.
- **`fetch()` + ReadableStream** would populate the real cache, but a cross-origin image with no
  CORS headers yields an opaque response whose body cannot be read — which is exactly where images
  live, on third-party CDNs.

#### The design: measure the server, derive the budget from the file size

1. **Liveness deadline, ~3s.** If the `Image` has not loaded by then, fire one small ranged
   request. `headBytes()` is already this exact shape — 4KB, `Range` header, GM_xhr so
   CORS does not apply, own 4s timeout.
2. **Route on the answer:**
   - no response / timeout → host is dead. Abort now (~7s, not 20s).
   - 4xx → definitive. Abort, report "404 — not found", do not retry.
   - 429 / Cloudflare / `Retry-After` → `hardBlock()`, mark the host no-rush (§6).
   - 200/206 → alive; keep waiting.
3. **If alive, read the size — from `Content-Range`, never from `Content-Length`.** A 206 sends
   `Content-Range: bytes 0-4095/8388608` (total) alongside `Content-Length: 4096` (the slice).
   Reading the wrong one gives 4096 for an 8 MB file. `Content-Length` is the right source only on
   a **200**. Measured and confirmed — see §14.
   Then set the budget to `max(5s, size / floorRate)` with an absolute ceiling. `floorRate` is
   ~100 KB/s for images and ~500 KB/s for video (§14).

Why this shape:

- The fast path costs nothing; the diagnostic only fires when already waiting.
- **It is the same request as the failure diagnosis in §8.** One round trip decides whether to keep
  waiting *and* supplies the status code for the status-bar reason.
- `probeImage` keeps a plain `Image`, so the browser-cache/preload property survives.
- A dead host fails in ~7s instead of 20s, which is most of the complaint.

`headBytes` currently reads only `r.response` and discards `r.status` and `r.responseHeaders`. Both
are needed here, and `hardBlock()` wants the headers regardless.

Start `floorRate` pessimistic (~100 KB/s): an 8 MB file gets a long leash, small files fall through
to the 5s floor. Measuring the real rate is possible — request 64KB instead of 4KB and time it —
but 4KB is dominated by round-trip time and cannot give a throughput figure. Only add measurement
if the fixed floor misfires.

---

## 8. What a failed picture shows — BUILT in part, v0.88.0

Never blank, never skipped. Show the page's own thumbnail as a placeholder, plus a reason in the
status bar.

**Except when the page's own picture is itself a placeholder (v0.133.0):** `placeholder()` — decoded
at ≤ 2×2, or an undecoded `data:` URL under 300 chars. Google Images gives every result below the
fold a 1×1 GIF until it is scrolled to, and a result whose link is not an image (an Instagram
`lookaside` page) then showed as a black square. Neither fallback shows one; the tour moves on
(`tourFallback` → `tourNav`), and a start from the widget walks up to `TOUR_START_TRIES` entries.

**Built, with the condition narrowed: only a genuine failure shows it, not a candidate merely
rejected for being too small.** On an ordinary hover the wider rule would pop a blurry
thumbnail over every un-upgradable picture on the page. The wider rule is still right *inside a
tour*, where an entry must exist even when broken — so when the tour is built, widen it gated on
tour mode. The free/paid tiers below both exist now: `failureText()` reads the diagnosis the
probe already paid for. The Retry button is not built and cannot be until there is a tour.

Note that `minRatio` means a thumbnail is *never* what a normal hover offers, so showing one is a
deliberate exception — which is why the note is mandatory rather than optional. Without it, "why is
this blurry" reads as a bug.

Reasons come in two tiers:

- **Free** — already computed and currently thrown away. `resolve()` knows exactly why it rejected
  each candidate: *"under the required upsize"*, *"a different shape, so a different
  picture"*, blocked, caught changing size. Each is logged under the `debug` flag and
  discarded. Capture the last rejection instead.
- **Paid** — anything needing an HTTP status. On total failure only, fire one `GM_xmlhttpRequest`
  to learn why. Rare path, and it is what makes "404 — not found" vs "site did not respond"
  sayable. The same response feeds `hardBlock()`, so failure diagnosis and 429 detection share one
  request.

The caption is built in `caption()`; `capMetaEl` carries the type/dimensions/bytes line
and is where a reason belongs. Note the `capFor`/`capDims` guard — the caption only rebuilds when
the URL or measured size changes, so a reason must invalidate it (`resetCaption()`).

### The Retry button

In the bar, **only during a tour**, and only on a failed picture. Outside a tour the user already
has re-hover. It clears the URL from `probeCache` and re-resolves at foreground priority.

Any new control in the bar must be added to `isBoxControl()` — not optional, and the
symptom of forgetting is silence.

---

## 9. Loading more of the page — rebuilt v0.144.0: the page is scrolled as a reader scrolls it

**The rule (user's design, 2026-09-23):** a lazy page loads more because the page scrolls along
*ahead* of the slideshow, the way a person scrolling it would — never by a jump. `tourFollow()`
keeps the current picture in the top part of the viewport (its top between `FOLLOW_TOP` 10 % and
`FOLLOW_BAND` 40 %; outside that, `scrollBy` puts it back at 10 %), so the screen always shows
what comes next and the page's own loader fires about a screen before the last picture.
`tourAskMore()` does no scrolling of its own: once the bottom is on screen (`excBottomShown()`) it
watches (`excWatch`, ≤ 2 s) for the batch; before that it returns `false` and following gets there.
At the wall (`force`, ▶ on the last picture) `excWalk()` pages down by `EXC_STEP` (0.9 viewport)
with a `EXC_WALK_MS` pause per screen, **within the one press**, until the bottom shows or elements
are added, then watches. One screen per press (v0.144.0–v0.151.0) made a page with a long tail
under its last picture take ~5 slow presses (2 s watch each) or 30+ fast ones to end (user, v0.152.0).

**Why not the old jump (v0.98.0–v0.143.0: to the bottom and straight back, "the excursion"/"the
hop"/"the stay").** It skipped the middle: Google Images in Firefox/LibreWolf **mounts each
50-result batch only when the viewport comes near it**, so after a jump batches 2–5 were empty
`div`s of ~2,300 px and the counter read the top 50 and the bottom 50 (user, 2026-09-23). Following
was added in v0.134.0 to mount them, and it only ever scrolled once the picture was *off* screen and
then *centred* it — so it trailed the slideshow, and at the last picture on Google left the bottom
~490 px below the screen with nothing loading. That lag is what the jump had been covering for.
Do not bring a jump back to buy lead time; move `FOLLOW_*` instead.

**Measured in real Chrome, 2026-09-23, jump off, following ahead** (one press per 3.5 s, widget
start at #1, Google Images "hot air balloon", viewport 911 px): the next batch arrived at **step 86,
14 before the end** (user's bar: never within 10); 100 → 200, carried on, page moved only downward
in small steps. The user's rule: the picture being viewed stays in the top half, and the widget
never gets within 10 of the end before more arrives. At 3 presses/s the batch landed at step 93 —
see TESTING.md on pace. ← from nothing (lands on #100, bottom on screen): batch 1.1 s later,
→ gave 101/200. Bing: the second batch loaded at step 29 (41 → 84); Bing auto-loads only two
batches, then shows a "See more images" button no scroll passes, so its slideshow ends there.

- **Only on a learned host** (`growsHere()`); elsewhere the page never moves during a slideshow
  (v0.142.0, user: "disable both until we need them"). `cfg.scrollSites` is the list — panel,
  Per-site fixes, ✕ per row, kept by Reset (v0.141.0–v0.142.0 kept it in GM key
  `hoverZoomGrowsOnScroll`; `growsMigrate()` moves it once). A host is learned when the **user**
  scrolls (wheel/key/touch/press within 1 s before the `scroll`), is within two viewports of the
  bottom, and the widget's count (`growsCount()` = `twTotal`'s derivation, not `mediaCount()`: ads
  and pixels move the raw count) rises within 0.6 s or 2.6 s **with elements not there before**
  (`growsHad`): a lazy page filling in placeholders it already had raises the count too, and was
  learned as a feed (v0.152.0).
  **A recycling feed (Imgur) keeps ~8-15 pictures mounted at any scroll position**, so its count
  never rises; near the bottom it lengthens the page instead (29,755 → 52,127 px, measured Chrome
  2026-09-27). So "grew" is `pageGrew()`: count up, **or** the page one viewport longer — in the
  learner (`growsH`), `excWatch` and `excWalk`. Count-only, the watch logged a miss per page and
  `GROWS_FORGET` dropped Imgur after five. The user-input test excludes our own
  scrolls and scroll restoration. No built-in list of feeds, by design: the first slideshow on
  Google Images ends at 100 until the user has scrolled once.
- **Not a one-way gate (v0.143.0, user).** `hoverZoomScrollMisses` {host: n}: a watch at the
  bottom that finds nothing counts one miss per page URL (`excGaveNothing`); `GROWS_FORGET` (5) in
  a row removes the host. A batch found, or a hand scroll that raises the count, clears the run.
  A site with feed and finite pages (Reddit feed vs a post) may be forgotten and relearned — fine.
- **A page that loaded nothing** is `excDead {url, docHeight, mediaCount}` (never reset, unlike
  `excSpent`, which is per slideshow); asking again waits until the page has grown.
- **Cooldown** `EXC_COOL_MS`, or a watch re-fires on every press while content loads.
- Scrolls are `behavior:'instant'`: `'auto'` obeys a page's `scroll-behavior:smooth`.
- **Programmatic scrolling works through `lockScroll()`'s `overflow:hidden`** (measured v0.98.0,
  fullscreen), so fullscreen needs nothing extra — and `.dim.full` hides the page anyway.
- `twStarting` guards the page-scroll `cancel()`, since a start from the widget is not yet placed;
  a scroll WE make fires `mouseout`/`mouseover` under a still pointer (CLAUDE.md trap).
- **Virtualised feeds** (Twitter, Reddit) keep ~20 posts in the DOM; only a moving viewport reaches
  further, which following now is.

**▶ at the wall *is* the request, and the ends wrap** (`E67`; they closed the slideshow v0.126.0-v0.161.0).
`tourWall()`: `tourMoreOnce(true)` (one shared request, so a press lands on one already running;
`force` skips the cooldown), step if it grew, wrap (`tourSeam`) only if `tourExhausted()` — a `false`
from a busy source, or from "scrolled on, not at the bottom yet", is not an end. `wallBusy` drops
presses while it runs, or each would step/wrap when it resolves.
Wrapping is the user's call: a wheel spun to the end should not close anything. A note that stayed up
was rejected (it hides the picture); so was ignoring the wheel until it stops (a free-spinning wheel
must then be stopped by hand) — hence the fixed 1 s hold at the seam, for every input alike, and only toward that end (a step back is taken at once — user's call, v0.198.0) (`E72`;
the user expects all modes to behave the same and differ only in how they are started). The wall
also re-reads the page first (`tourAdopt(tour.had)`), for a batch that landed after the watch ended.

The list itself needs no scrolling for what is already in the DOM: `querySelectorAll` sees the whole
document and `collectCandidates` reads `data-src`/`data-srcset`.

**A feed appends each batch as a SIBLING block** (Google Images: 100 per block under one parent), so
a scope fixed at the first block misses it. `tourAdopt()` widens the scope to the nearest ancestor
holding the new pictures, only when that ancestor holds nothing else already on the page (no
sidebar pulled in). **A tour started from the widget (`mainOnly`) re-derives its scope on every press**
(`tourCommon(mainPics(...))`, the idle widget's derivation), so it never needs adopting; fixing it at
start ended LibreWolf's tour at 50 while the widget said 150. `{`/`}` clear `mainOnly`.
**That re-derivation runs on every step, so it must stay cheap** (`inPass`, v0.173.0): `tourEntries()`
and `idlePics()` run inside one read pass where `passRect()` and `videoSurfaces()` answer each element
once and are dropped on return — `sideColumnEl` re-measured the same ancestors for every picture and
`videoSurfaces` every video per picture (866 rect reads a step on the 35-picture test page; 39 → 12 ms a
step with 400 pictures + 20 videos). Never let a pass span a DOM write or a scroll: its rects go stale.
**And between steps the list is reused** (`tourListMemo`, v0.181.0): for `TOUR_LIST_MS` (1.5 s) while
`tourListKey()` — URL, element and picture counts, the summed length of every `src`, viewport,
`body.scrollHeight`, harvest size, floor — and the tour's scope/level/postOnly/mainOnly are unchanged
and every live entry is connected. Google Images, 464 pictures, 90 fast wheel ticks: 5.8 s → 1.0 s of
blocking (64 → ~10 ms a step). The key is re-read every step, so a page that changed re-derives; the
TTL bounds what the key cannot see (a visibility flip with no size change).
`idlePics()` is reused the same way (`idleMemo`, v0.182.0): after a scroll `twRefresh`, `pgTick` and
`twWarmFirst` each asked for it — three full scans per pause, now one. Its key (`pageKey()`) leaves
out `harvest`: `twRefresh()` runs it at boot, above that `let` (the CLAUDE.md TDZ trap).
`tourPics()` too (`picsMemo`, v0.184.0): one step asked for it 3x (the list, `postLead`, `tourGrow`).
`postGroup()` skips an element with fewer than two post-like children before `cardList`/`sibGroups` —
exact, since every group needs two post-like members (Imgur's recycling feed re-runs it each step).
A slow step is not just jank — Firefox scrolls the page anyway when a blocking wheel listener takes
~400 ms (`apz.content_response_timeout`), so wheel ticks leak through. For a tour
pinned from a hover, `tour.had` is taken at `tourStart` and `tourGrow` adopts near the end.

---

## 10. Crossing to the next page — BUILT, v0.99.0

Verified end to end on `test-pages/pager-1.html`: a tour of 6 grew to 12, 18 and 24 as pages 2, 3
and 4 were fetched and harvested, every harvested tile resolving to its own original through a
**relative** ancestor link, and stopping dead at page 4 because its only pager link points
backward. The detector is asserted offline as well — 20 assertions in `test-resolver.js`, which
matters because a wrong answer here is silent: the tour simply walks into the wrong pages.

**What the build settled, beyond the plan:**

- **The page number usually is not in the URL, so it is read off the pager instead.** The plan
  reached for `derivePageTemplate()`/`pagerInfo()`, which need the URL to carry a number. Most
  pagers do not — `pager-2.html`, `/gallery/two/`. The rung that actually works is the pager's own
  shape: **the number inside its range that is not a link is the page you are standing on**, and
  the link after it is next. A pager linking every page including this one is refused.
- **No page template is needed at all.** `derivePageTemplate()` exists so you can jump to page 100
  without fetching 99. A tour walks sequentially, so each fetched page simply yields its own next
  link and the machinery is unnecessary.
- **The base URL travels on the element**, as `__hzBase`, rather than through a parameter. Four
  call sites would have needed a new argument otherwise, and an argument can be forgotten at any
  one of them; a property stamped at harvest time cannot get out of sync with the element it
  belongs to. `collectCandidates` and `linkedMedia` read it through `baseOf(el)`.
- **`fetchDoc()` also injects a `<base>`**, because `DOMParser` hands the parsed document *this*
  document's base URI and `img.src`/`a.href` are resolved properties. A page's own `<base>` is
  kept, made absolute first.
- **The harvest can apply almost none of the gates**, and this is inherent rather than an
  oversight: a fetched document has no layout, so the banner shape, the wallpaper tests and the
  peer walk have nothing to read. What survives is the block list, the page's own decoration flags
  (`aria-hidden`, `role="presentation"`), and declared `width`/`height` against `minDisplayed`.
  A listing page's chrome images that declare no size do get in. They are stepped past, never
  dropped — §1's rule holds on fetched pages too.
- **A tour entry is still always an element**, just sometimes a detached one. The plan expected
  "a live DOM element or a bare URL"; keeping the parsed `<img>` means `collectCandidates` runs
  unchanged and a harvested thumbnail gets the whole upgrade chain — ancestor link, `srcset`,
  `data-src` — rather than only its own URL. `nativeSize()` returns null for it (nothing decoded),
  which `sameShape()` already treats as "unknown: do not judge", so the stability test simply
  stands down. The one thing that genuinely cannot work is `sizeOf()`, and `tourFallback()` probes
  for the size instead when it needs one.

### The reasoning, kept

**Never navigate the document.** That destroys the pinned window and, on a non-SPA site, the whole
script instance.

Not needed anyway. Hover Zoom already fetches and parses other pages — `linkedMedia()` /
`pageMediaFrom()` GM_xhr a linked page and `DOMParser` it to find media. The
capability is in the file; it is just pointed at one page at a time.

At 10-from-the-end with no more scroll content: find page 2's URL, fetch and parse it in the
background, harvest its pictures, append to the tour.

### Which detector

They are not interchangeable:

- **`../Open-Links-in-New-Tab/Open-Links-in-New-Tab.user.js:1314`, `nextPageReason()`** — a
  *negative, non-directional* classifier: "is this link a pagination or sort control, so do not
  open it in a new tab." Deliberately lumps in `new`, `best`, `hot`, `top`. **Cannot tell you which
  link is forward.** Useful only as a word list.
- **`../Forum-Stumbler/Forum-Stumbler.user.js:1198`, `detectNextPage()`** — directional. This is
  the one. Its companions:
  - `derivePageTemplate()` (`:1216`) builds a "page N → URL" function from two numbered pager
    links, so you can jump to page 100 without fetching 99. Note its digit-backoff reasoning —
    `/p12` and `/p13` share the prefix `/p1`, which would put the number in the wrong place.
  - `deriveTemplateFromChain()` (`:1268`) does the same job from just the current URL and its next
    link, for pagers with no numbered links at all ("← Older posts", WordPress's default). This is
    the more useful one here. **Ambiguity is refused, never guessed** — a wrong template silently
    generates plausible URLs for the wrong pages.
  - `pagerInfo()` (`:1296`) reads which page we are on and the highest page named.

### The structural change

**A tour entry becomes either a live DOM element (this page) or a bare URL harvested from a fetched
page.** Most of the pipeline is URL-based and does not care. Two things do:

- `collectCandidates(el)` works fine against an element from the parsed detached document
  — it only reads attributes and `closest('a')`.
- `sizeOf(el)` **cannot** — a detached document has no layout. Fetched entries fall back
  to probed dimensions for the `minDisplayed` gate.

This is the largest piece of the feature. Build it last, after the tour works on one page.

---

## 11. Settings

The keys in `DEFAULTS`. Remember the hoisting trap in `../CLAUDE.md`: every
`const` the loader touches must be declared **above** the `cfg =` line, or `readSettings()`'s own
`catch` swallows the `ReferenceError` and the script silently runs on defaults.

| Key | Default | What |
|---|---|---|
| `tourButtons` | `true` | show the widget |
| `tourFade`, `tourFadeTo` | `false`, `35` | the widget faint until the pointer nears, at this opacity % |
| `tourKeyStart` | `true` | → / ← with nothing open start at the first / last picture |
| `tourKeys` | `true` | arrows navigate when the picture cannot pan horizontally |
| `tourMinDisplayed` | `128` | the tour's floor on the longer side as drawn, px (§1a) |
| `preloadAhead` | `0` | entries loaded either way of the anchor; 0 = all. Replaced `tourWindow` (12) |
| `preloadMB` | `0` | memory for held files; 0 = automatic |
| `tourWorkers` | `6` | concurrent preload resolves |
| `tourHoldRate` | `0` | max steps/sec while an arrow or ◀ ▶ is held; 0 = the repeat rate. Replaced `tourScrubRate` (5), retired so a stored 5 does not survive |
| `wheelRange` | `65` | px around the wheel button in which the wheel steps. Replaced `wheelReach` (50; a stored 50 migrates to 65, other values carry over), which replaced `wheelZone` (20) |
| `tourLoadMore` | `true` | scrolling along ahead so a feed loads more (§9) |
| `tourCrossPage` | `true` | harvest the next page in the background |

Retry timings (5s stall, 4 attempts, 15s ceiling) apply to all hovers, not only tours, and are
probably constants rather than settings unless testing says otherwise.

---

## 14. Measured, 2026-09-07

Live browser tests against Google image search, Brave image search and imgur. Run on a fast link
(1.6–4.1 MB/s observed); on a slower connection bandwidth binds sooner and the concurrency figure
below shrinks.

### Concurrency is confirmed latency-bound — ~5.9× at 6 workers

30 Google Images originals, real hosts. Sum of individual load times **33.7s**; wall clock at
6-wide **5.7s**. Serial cost 1.12s/image, corroborating the user's independently measured 1.45s.

At 6-wide that is **0.19s/image = 5.3 images/sec**, clearing both the 3/s target and the 5/s scrub
cap (§5). **Six workers is enough. Do not raise it without re-measuring.**

### Never read `Content-Length` on a 206 — it is the slice, not the file

Proven same-origin: `Content-Range: bytes 0-4095/34494` alongside `Content-Length: 4096`.

- Cross-origin from page JS, `Content-Range` is **hidden** — it is not a CORS-safelisted response
  header — and `Content-Length` reads **4096**. GM_xhr bypasses CORS and sees the real header, so
  the script is fine, but a naive `Content-Length` read yields 4096 for a 9.6 MB video and derives
  a 5s budget for it.
- **Parse the total out of `Content-Range`. Fall back to `Content-Length` only on a 200.**
- All 30+ ranged requests across ~12 hosts answered **206**. The "bare 200 with no size" case this
  section previously asked about did not occur once; the real hazard turned out to be the 206.

### `floorRate` at 100 KB/s is right for images, wrong for video

Where size and time were both measurable: **240–452 KB/s** effective for files of 313 KB–1.3 MB. A
39 KB file measured 36 KB/s effective — latency-dominated — which the `max(5s, …)` term already
covers. The formula behaves correctly at both ends.

Video needs its own floor. At 100 KB/s a 9.6 MB clip gets a 96s budget. Use **~500 KB/s for
video**, giving ~19s.

### `transferBytes()` is already broken for most images — pre-existing, unrelated to the tour

Only **4 of 24** successful loads reported a nonzero `encodedBodySize`; 83% return 0 because the
host sends no `Timing-Allow-Origin`. So the status bar's byte figure is silently absent
for most cross-origin images today. The ranged diagnostic in §7 could supply it instead.

### Failures are a normal path, not an edge case

**6 of 30 (20%)** originals failed to load on a live Google Images page — `preview.redd.it` ×3,
`trvst.world` ×2, `media.istockphoto.com` ×1. This validates §8: a tour hits broken pictures
constantly and must handle them gracefully rather than treat them as exceptional.

**The "almost certainly hotlink/referer protection" attribution was a guess, and it did not hold.**
Re-run 2026-09-07 over 24 Google originals: 3 failed, and retrying each with
`referrerPolicy = 'no-referrer'` rescued **0 of 3**. Do not build a referer-retry rung on this
evidence. What the three actually were:

- one **stall, not a failure** — a 7004×4672 image that passed 12 s untouched and then loaded in
  3.4 s on an immediate retry. This is the §7 model's whole case in one measurement: the first
  attempt was not wrong, it was too patient. Note a *cache-busted* retry of the same file took
  7.2 s, so a flat 5 s per-attempt cap would still have missed it — the size-derived budget is what
  saves it, not the retry count.
- one **dead URL** (a MediaWiki `/thumb/` path with no `NNNpx-` segment — no such file).
- one host that refused all three attempts.

### Raising a size parameter is not safe; deleting it is

`th.bing.com/th/id/OIP.<id>` answers `?w=3000&h=3000` with a real **3000×3000** decode of a file
whose honest maximum is 474×315 — an upscale, and the size gate cannot tell it from detail. Dropping
the parameters instead returned the true 474×315. The existing rule deletes rather than raises, which
is correct; **do not "improve" it into raising one.**

### Brave's base64 rule decodes correctly and then cannot load · see `RESOLVER.md` `E49`

**Both halves shipped — v0.83.0 (the bytes path) and v0.84.0 (the decode) — and were verified
together in Chrome on 2026-09-07.** Kept because the ordering is the lesson: the decode was correct
and useless on its own.

Brave sends `img-src 'self' blob: data: https://*.search.brave.com …`, so the `t4.ftcdn.net` original
this section verified is refused by the page before it is ever probed. The decode below was right and
was **blocked on the GM_xhr → `blob:` path**, not shippable alone.

### Brave image search needs a URL rule, and one is available · shipped v0.84.0

- Results are `imgs.search.brave.com/<sig>/rs:fit:500:0:1:0/<base64>` with **no ancestor anchor**
  (`closest('a')` is null), so the linked-page path finds nothing and the only candidate is a
  500px proxy thumbnail.
- **Rewriting the resize spec fails.** The leading hash signs the whole path (imgproxy signed
  URLs); `rs:fit:2000:…`, `rs:fit:0:…` and dropping the segment all errored.
- **But the source URL is base64url-encoded in the trailing path segments.** Drop segment 1 (the
  signature) and any segment containing `:` (processing options), join the rest, base64url-decode.
  Verified on 5 URLs, e.g. → `https://t4.ftcdn.net/jpg/12/98/25/17/360_F_1298251759_….jpg`.
- Some decode to `favicons.search.brave.com` icons; those fall out under `minDisplayed` on their
  own.
- Some decode to a *thumbnail* on the source host (vecteezy `/thumbnails/…/small/`), so the
  existing `UPGRADES` chaining gets a second step for free.

This belongs in `UPGRADES` with a host check, per the Known Limits rule in `../CLAUDE.md`.

### Video: 5–10× larger, and metadata is 3–13× cheaper than a full load

imgur mp4, four clips: **1.0–9.6 MB** (images on the same run were 40 KB–1.3 MB). Metadata
**169–864ms**; full load **561–3076ms**.

- `VIDEO_PROBE_MS = 6000` is well calibrated — ~7× headroom over the measured worst case.
  No change.
- **Clips need a two-stage preload.** A 12-deep window of 9.6 MB clips is ~115 MB of speculative
  traffic. Stage 1: metadata for the whole window — cheap, and it settles dimensions so the frame
  is right and nothing flashes. Stage 2: full buffer only **1–2 ahead**, which is what makes
  playback instant.
- This is the "videos are different" exception. Everything else in §6 applies unchanged.

## 15. Still unverified

- Whether a 100ms relocation animation looks better than a jump (§3). Built as an animation; not
  yet judged by eye.
- Whether 6 workers still clears 3/s on a slow connection, where bandwidth binds instead of
  latency (§14).

## 16. Measured while building, 2026-09-07

- **The derivation costs 3 ms** on the 41-case test page (52 `img`/`video`, 40 eligible),
  Chromium. The plan's "~5 ms on a keypress" holds. The cost that would bite is
  `playerSurfaceReason()`'s ancestor walk, which does a `querySelectorAll('img')` per level — it
  breaks at the first ancestor holding more than one image, so on a grid it stops after one or two
  levels rather than scanning the grid per item.
- **The row sort is doing real work**, and the log proves it: `doc: 341,1606` → `652,1606` →
  `962,1606` → `31,1835`, i.e. left-to-right along a row and then a wrap, not a `(top, left)`
  scramble. `dbg('tour step', …)` prints the document position for exactly this reason.
- **The strip's two-group layout measures as designed**: 1094 px full-width over a clip with the
  scrubber flexing to 805 px, collapsing to a 106 px nav-only box on the next still picture, and
  back again.
- **`swapViewer()` must call `resetCaption()`.** `caption()` only rebuilds when the URL or the
  measured size changes, and two tour entries routinely share both — the same file, once with a
  failure reason and once without. Without the reset the bar kept "no larger version found" over a
  picture that had resolved fine. §8 said this; it still got missed once.
- **Leaving fullscreen after a step needed `E57`.** `restoreFull()` put back the zoom and top-left
  corner captured on entry, which belong to a picture that is no longer in the frame: the window
  came back 111 px off the right edge at the wrong zoom. A tour step is the only way to reach it.

## Dead-link ⚠ · v0.203.0

The widget's counter ends in an orange ⚠ when **most pictures looked up on this site point at a
larger file that never loads** — "the links are dead here, find out why". Asked for per site, never
per image, and deliberately **not** a quality measure: v0.202.0 judged by how much the preview had
to enlarge the result, which fired on sites that simply only have small pictures and depended on
screen size. The user rejected that; do not bring resolution back into it.

- **A lead** is a candidate that claims to be the larger file: `data-*`, `srcset`, `<picture>`, the
  ancestor link, a URL in a link's or the src's query, the linked page's answers, and a rule with
  `report: true`. Not a lead: a generic rule's guess (they 404 routinely on healthy sites) or the
  displayed src itself. Set in `collectCandidates()`'s `add` (`c.lead`).
- **Per picture** (`noteLeads()`, end of every full `resolve()`): any lead returned a picture, of
  ANY size → fine (a Google `imgurl=` smaller than its thumbnail is a success); leads tried and all
  failed (4xx, error, not a picture, timeout, CSP with no byte fallback) → dead; no lead tried → not
  counted. Speculative preloads (`guesses` set) are not counted.
- Shown at `DEAD_MIN` (5) counted pictures and more than half dead. Keyed by displayed URL, in memory
  for the tab, cleared when `pageHost()` changes. Top frame only; under `smallBelow` not counted.
- The tooltip points at the settings panel's rule-health box when that box has entries (RESOLVER.md
  "Rule health").
