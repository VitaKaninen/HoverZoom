# Galleries (peek)

**Names:** the ▦ on a gallery's thumbnail is the **gallery button** in everything the user reads (user
2026-11-26: "chip" was never theirs); code and these notes still say chip (`galChip…`, `galleryChips`).

A click on a door's ▦ chip (or a middle press, with `galleryMiddle`) floats the linked page's
thumbnails over the page, so the user can judge whether that gallery is worth opening. Code:
`galDoorHover` … `galMove`, after `harvest`. Where it runs = wherever doors are learned (`P17`).

**Gallery mode is retired (v0.291.0, user):** the per-site switch (`gallerySites`, the ▦ dock
button, the "Show / Hide gallery button" menu item), previews-off while on, Ctrl tap to open,
unlocked hover galleries (grace period, hole steering, edge band, scroll lock) and the whole-page
preload (`galPreNext`). Reason: peek on doors does the same without a mode, and the mode hid
previews and the chip (nsfw.xxx: no chip ever, because the mode was on). `hoverZoomGalleryHosts` /
`hoverZoomGalleryDock` are left in storage, unread. A setting `gallerySites` in old stored settings
is ignored. Before v0.291.0 = the mode's code, if it is ever wanted back.

## Peek, pages, reading on (v0.282.0; INTERACTION.md `G1`, `G6`, `G7`)

- **Lists kept per tab** (user, v0.341.0; every list, v0.390.0: "no need to recheck a link"): every list read in
  the tab — to its end or from its HTML alone (`whole` false → `N+`, not marked grown) — goes to sessionStorage
  `hzGalLists2` (`galKeep`, written 1 s later by `galKeptWrite` and on `pagehide`; each item's `hit` minus
  `display`). No age or count limit: when full, the oldest tenth is dropped and the write retried (user: overwrite
  the oldest). `galLoad` and the preload's `galCountLoad` take it (`galKept`) before any fetch. ~18 KB per 40-picture
  gallery on `door-long`, so ~250 galleries fit. A door's kind is kept the same way in `hzDoorKinds2`, **'gallery'
  only** (v0.405.0). Measured: after a reload of `door-long` (150 kept), 0 gallery pages fetched.
- **A kept verdict must be able to come undone** (user 2026-11-26, v0.405.0: "wrongly learning things … no way to try
  again with a new hover"). A 'results' read is never kept for the tab, and a per-door 'results'/unknown is re-read
  by a hover `GAL_DOOR_REREAD_MS` (20 s) later (`galDoorKindRead`). **Rename the three keys (`GAL_OLD_KEYS` gets the
  old names) whenever the picker changes so old lists are wrong** — sessionStorage outlives a cache clear and a reload.
- **The HTML read skips site furniture** (`galSiteFurniture`: `nav`/`header`/`footer`/banner roles outside
  `main`/`article`). eporner's header menu holds 8 category tiles in one group; a 5-picture gallery lost to them
  (`galChoose`: its 20 related-gallery cards are `sib`, so the biggest non-sib group won), the tiles linked to
  `/cat/` pages, and the door was then judged 'results'. The frame read never had it (hidden menu, `widgetEntries`).
- **`galLeafAt` matches by a shared 6+ digit id too** (`sameFileId`, dates excluded). eporner's gallery list drops a
  title's apostrophe (`standing-dp-s-…`) where the photo page writes `-039-`, so `sameStem` failed on both pages
  checked and the gallery read as 'results'.
- **The chip shows the count** (user, v0.342.0; open chip too, v0.343.0): `galCountText` — `N` when read to its
  end, `N+` from the HTML only, nothing when unknown; `galKnownN(href)` reads memory, then the kept list, then
  sessionStorage `hzGalCounts2` {href: [n, at]}, 3000, whole galleries only, written by `galKeep`. `galChipsCount(href)`
  restyles after `galLoad`, `galMore` and `galGrow`'s end.
- **Cheap count (L13 split, v0.453.0)**: every fetched gallery page (`galCountRead`, from `galLoad` and `galCountLoad`,
  no extra request) yields candidates (`galCountCands`): short labels (≤ 60 chars, title included) stating a number of
  pictures (`countStated`), and the pager's last page (`pagerNum`: same path with `?page=N` etc., or `/N`, `/page/N`;
  count range `pagerRange` at the HTML's own count per page). Ground truth = a frame read to its end (`galCountTruth`,
  in `galGrow`'s end): agreeing candidates are area samples (shared rule; stores `countAreas` / `pagerAreas`, keyed by
  the gallery's host, path = its path), 3 galleries → a rule; a covering rule that disagrees is struck (`vdForget`),
  or dropped at once (`areaDrop`) when it equalled the HTML count (it would have ended the list early). Free check on
  every read: a stated count below the HTML's is struck. Under a rule (`galStated`): the chip/strip show that count
  (no `+` when stated; a pager gives `N+`; `galKnownN`; a list growing past it proves it wrong); stated = HTML count →
  list final with no frame (`galStatedTake`); otherwise the idle reads (L7 `ahIdleGrow`, L13 `galGrowLater`) are
  skipped and the read starts only when pages past the list are wanted (`galGrowNeed`) or Load all needs the list
  (Load all on = L13 runs as before). `COUNT_CHECK` 1 in 10 galleries (`galCountDraw`, per href) is read anyway to
  keep the rule honest. Debug: `gallery count from a learned place`, `gallery count: the read to its end checks the
  page's numbers` (says `page not read in this tab` when no candidates were kept — seen once on the fixture, cause
  not found). Fixture `door-count.html` (TESTING.md).
  **Badges first** (user v0.455.0: "the first place I would look"): a door's own card on the results page — eporner
  `div.mbphoto2_galleryico "48"` beside the link, nsfw.xxx `div.user--image-count > span "683"` inside it. Read once per
  door at its chip (`galChipStyle` → `galBadgeNote`): the card = up from the door picture while the ancestor holds ≤ 2
  images (≤ 4 levels); candidates = deepest elements whose whole text is a bare number (`countBadge`: an icon before,
  a picture word after allowed; `16:16`, `96%`, `720p` refused). Store `badgeAreas` keyed by the RESULTS page's host and
  path (`areaApply`), id = the gallery href. Same truth (`galCountTruth`) and strikes; a badge below the HTML's count is
  struck on the HTML read. Ground truth also comes from lists final from their HTML (frames refused, `galNoFrame`, or
  `galWholeTake`) — eporner refuses frames, so without this it could never learn. Exact match only: nsfw.xxx's count
  may never equal what the frame reads (video cards, other users' posts), so it may not learn there — unverified.
- **Grey chip until its first round is in** (user, v0.388.0; round 1 since v0.418.0): `[data-hz-door].wait` (icon `#a6adc8`, blue `#89b4fa`
  once ready). `galThumbsReady(href)` = the first `AH_THUMBS_STEP` (10, or `galPer(null)` if fewer) items of `galLists` all in `galThumbDone` (thumbnail
  URLs settled, load or error, recorded in `galImg`), so a broken thumbnail cannot keep it grey. `galThumbSettled`
  restyles every chip 150 ms after a batch. No list yet = grey. The open ✕ is never grey.
- **Reads to the end only when idle** (v0.387.0 reverses v0.350.0's "scroll fast → read further ahead", user). The
  old reason — pornpics chips sat at `19+` until opened — is answered by counts, which still run for every door
  at all times; only the frame reads (`galGrow`) moved to idle (`ahIdleGrow`). See "Loading ahead". Counts
  (`galCountNext`, HTML only) run before the frame guards — v0.350.0 had them behind `galGrowing`, so in a
  browser whose frame never reports (10 s each) half the chips had no number. The open gallery's own page ramp
  is `galAhead` — a name clash once replaced it silently (v0.351.0 dev).
- **One request per page** (user, v0.351.0: "we are not asking each page for multiple things?" — we were: count,
  preload, hover read-ahead and the resolver's linked-page read each fetched it, plus two frames). `pageText` keeps
  each page's text (successes only, `PAGE_TEXT_KEEP` 120, misses asked again); `fetchDoc` and `fetchPageMedia`
  parse from it; `onRefused` goes to the first asker only; `pageTextHeld` keeps a shared read out of us-log.
  Fixture `door-long.html` (150 doors): one `fetch` per gallery page. Frames still load the page again (a frame
  cannot be fed text).
- **Debug lines** for counts: `gallery count from its page {pictures, why, shared}`, `gallery read to its end:
  <why> {from, pictures, final, ms}`; the rest under "Loading ahead".
- **Sites whose pages hold the whole gallery** (v0.358.0; user, sexygirlspics in LibreWolf: every chip `16+` for
  hours, because each count waited on a ~9 s frame read, serial, that always ended `from: 16, pictures: 16`).
  `galWholeSeen`: a read to its end that ends where the HTML did counts toward the host; `GAL_WHOLE_RUN` 3 in a row →
  `hzHtmlWhole` (GM storage, `{host: {run, whole}}`, kept across tabs) and every HTML-read list there is final at once.
  Only lists read by `galCountLoad` (`galFromHtml`) are taken: a frame's first report can be short (13 for 16).
  `GAL_WHOLE_CHECK` 1 in 10 is still read to its end; one that finds more drops the host's entry. Fixture
  `door-whole.html` → `gallery-whole.html?w=N` (static 16, script runs in the frame): 12 final in ~20 s, then a
  fresh tab final in 2 s.
- **A load whose frame is taken still answers from its HTML** (v0.356.0; LibreWolf trace: middle press, the open's
  frame was "replaced by a newer hover" 67 ms later and the gallery failed "the load was cancelled"). `galLoad`
  resolves `'cancel'` only when the HTML has nothing either.
- `download bar: <corner|gallery|above the widget> left,top WxH {galOn, strip, fly, anchor, widget, bar}` — logged on
  each change of spot (v0.356.0, for the user's "bar stays mid-page after close", not reproduced on fixtures or in
  Chrome's geometry).
- **Counts for every door on the page** (user, v0.343.0: "why does it take several minutes"): the preload read only
  doors on screen, serially, each waiting for its thumbnails (`galWarm`, removed v0.440.0). `galCountNext` now runs beside it:
  `galPrePick(true)` (anywhere, nearest the viewport's centre), `GAL_COUNT_PAR` 4 in flight, `galCountLoad` = the
  HTML alone (`galPick`; no frame, no thumbnails), skipping hrefs already counted. eporner, fresh tab: 99 counts in
  26 s (was 11 on screen, none below); after Back, all at once from `hzGalCounts`.
- **Sites that refuse a frame** (v0.343.0): `galRender` landing on an unreadable/blank page calls `galNoFrameNote`
  (sessionStorage `hzNoFrame` {host: true}). From then `galLoad` starts no frame, `galCountLoad` uses `galLoad`, and a
  list read there is final: `galGrown` + why `html` + `galKeep` (so `N`, not `N+`, and ⤓ ready at once); `galGrow`
  returns at once. eporner refuses every frame (SecurityError), so before this its counts never lost the `+`.
- **Frames that never report** (user v0.355.0, LibreWolf: one count per 10 s, chips `N+` for minutes): the frame
  loads but our script does not run in it, so each read waited `GAL_FRAME_MS`/`GAL_REPORT_MS` and then took the HTML.
  `galReportSeen` (from `galRender`'s `fin`): `GAL_NOREPORT_MAX` (2) `no report …` in a row for a host →
  `galNoFrameNote`, which also marks every list already held for that host whole (`galGrown`, `html`, `galKeep`), so
  all chips go final at once and no more frames load. A `reported` resets the run. Fixture door-long: 150 chips
  final in 10 s (was 4.5 s each). **Risk:** a site whose frames do report but two are too slow in a row loses frame
  reading for the tab (lazy galleries count only their HTML) — if seen, raise the count or require the frame's
  `load` to have fired.
- **Peek**: a left press on a door's chip (`galChipClickable`, capture on the chip) peeks, or closes
  the open one; where `siteEnabled()`, a plain middle press on `doorAt()` does too, but only with `cfg.galleryMiddle` (default off, user
  2026-11-12). Both set
  `galPeek` and call `galMiddle()`. A door whose `galKindOf()` is `results` gets neither. While `galPeek`, a Ctrl tap closes it (and `galPeekTapAt` keeps the previews hotkey from also
  toggling), `galScroll` runs. `onOver` returns while `galCur || (galOn && galWant)`: with previews
  on, the page under the set would otherwise preview through the gaps. `galHide` clears `galPeek`.
- **Which group is the gallery** (`galGroup` → `galChoose`, pure, tested): the biggest group of like-placed
  pictures, unless most of its links share the read page's first path segment (a "more like this" strip:
  20 `/gallery/` cards at the foot of an eporner `/gallery/` page) and another group holds ≥ `GAL_OWN_MIN` 4 —
  then that one. Without it a 16-picture gallery read as its strip → `results` → no chips (eporner /search-photos/spreading/).
  **State classes don't split a group (v0.378.0):** `galMergeAlike` joins groups whose chains are `chainsAlike`
  (same tags, one's classes ⊆ the other's at every level) when the smaller lies inside the bigger's own container
  (`commonAncestor`), then sorts by document order. pictoa's photo page strip came as 3 groups — the current cell
  (`a.img-sel`), page 1 (`div.lasy`), pages 2–4 — so the grid left out the very picture its cover shows.
- **Door hover** (`doorHover(el, x, y)` → `galDoorHover`): the event's x, y go into `galPt` first —
  mouseover lands before the mousemove that sets it, and a cached `galKindOf()` would test a stale
  point and skip the chip. `galKindOf()` settles once per area per page, unknown included (nsfw.xxx
  profiles are script-built: always unknown, ~1 s per read). `galLoad` after `cfg.hoverDelay` reads ahead.
- **One pill per picture** (user, v0.293.0): chip ▦, tick, saved disc side by side, in that order,
  on one dark background — `[data-hz-marks]` in the card's link (`galPill`; marks found through
  `pill.__box`, `galPillMarks`), so hovering it keeps the site's own `:hover` (nsfw.xxx zooms the
  card 1.1×; the v0.291.0 chip in our fixed layer took the hover away). The pill is placed as one box
  by `galCorners` (`galMarkPlace(img)`): top-left first with a chip, else the tick's or disc's order.
  **Its look is in a shadow root's stylesheet, never inline**: Dark Reader (in the user's Chrome)
  rewrites inline colours and turned the dark pill light grey; it leaves a shadow `<style>` dark.
  The pill swallows presses on its own padding (link not followed).
- **The chip**: `galChipsAll` (from `galMarkAll`) puts one on every picture `doorReason()` matches
  once its area's `galKindOf()` is settled and not `results`. `cfg.galleryChips` (default on): every
  chip shows; off: the chip is `.off` (out of the pill) except on `galChipHot` (the hovered door,
  cleared by `galMove`/`galScroll`) — the tick and disc then shift by one slot when it appears.
  Open door's chip = yellow ✕, `galChipsSync()` on every open/close. No first-uses text (user: "just
  show the icon"; GM `hoverZoomPeekHints` left unread).
- **Pages** (`galRows(asp, hole, page)` → `{out, pages, page}`): the row floor is `galMinH()` =
  `cfg.galleryRowMin` (user v0.301.0, default 120, never under 48). If everything fits at the floor
  the binary search grows the rows from there; else pages, whose rows also grow to fill the height
  (`galPagedH`: as many rows as fit at the floor, then the spare height shared out; user: "any extra
  room is taken up by expanding the images, they never go smaller"). Not shared out evenly: v0.422.0 counted each
  picture wider to spread the last page's few over every page; reverted v0.425.0 (user: no picture grew, same page count,
  looked worse). A settings change while a
  gallery is open runs `galRefit`. A bar (the clicked picture, a detached strip) cuts only the rows
  it overlaps vertically: one touching a row, e.g. snapped to its bottom line, leaves that row whole
  (user v0.304.0; the old `G` margin cut it and left a gap above the picture). `galRows` takes several bars (the clicked picture and its strip). Tested in `test-resolver.js`.
  `set.page` survives a rebuild of the same href. `galPageWork` = upgrades and `galHqAll` for the page
  on screen, then the pages ahead by `galAhead` (the thumbnails' ramp: 1 on page 1 — "preload the first 2 pages", user
  v0.319.0 — then `GAL_AHEAD_ON` 5 from the first forward step, user 2026-11-26: thumbnails are cheap; page 6 on, as many as
  the page's number). Re-run after every append (`set.pv`); `item.hqTried` skips
  cells already answered.
- **The strip** (user, v0.299.0–v0.303.0; replaced the top `.pg` line): one element for every
  gallery (`galSt`, built once by `galStripBuild`, filled by `galStripText`): ◀ Page n / N ▶
  (`galFlip`, PageUp/PageDown; the `.pg` row) and ◀ picture n / N ▶ (`galStep`; both rows 24 px, user v0.425.0; row class `.pn` — `.pic` is the picture box's, and `.fly .pic{flex:1}`
  stretched the row); rows `justify-content:space-evenly` (user: equal gaps); `+` while reading on. **The page row shows only with 2+ pages**
  (`galStripOne`, `galStripRows`; strip `GAL_STRIP_H1` 34 vs `GAL_STRIP_H` 62). Each open starts
  with one row; the first time a set has 2+ pages it switches for good (`set.two`, so a relayout
  that fits one page again cannot flip it back and forth). An attached strip keeps the unit's
  height, so the picture narrows (the side nearer the window edge stays). The remembered `hf` counts
  the full `GAL_STRIP_H` (`galSave`, and `galPlace` adds the difference back), so either strip gives the
  same unit height. **Numbers never cut** (`galStripSqueeze`, user): 20 px buttons; then "Page"
  goes, then the type shrinks to 8 px; a picture holding the strip is never resized under
  `GAL_UNIT_MIN_W` 120. Three places (`galStripM.m`, placed by `galStripPlace`):
  - `in` (default): inside the clicked picture's frame, above or below the picture (`.pic`), same
    width, no border of its own. The `.fly` box then includes it (flex column), so it never covers
    the picture.
  - `dock`: against the picture's top or bottom with its own blue border (`.own`), the picture's width,
    following the picture.
  - `out`: anywhere, own border, as wide as its text (`.out` = `max-content`, user); the side nearer
    the window's edge stays put as its width changes. `GAL_STRIP_W` is only the first guess.
  `in` and `dock` share one geometry, the "unit" (`galUnitRect`/`galUnitPut`, `galAttH`): what
  `galHole` holds, what the rows avoid and what the memory places. An `out` strip is a second bar
  in `galRows` (`galBars`). With no clicked picture (no `<img>` on the door) it sits under the hole
  (`galStripRect`). The dock widget hides while a gallery is open (`twGalOpen`) — never two ◀ ▶.
- **Two layers** (v0.302.0; a third for the clicked picture since v0.336.0, below): cells, veil, pending glow and the diagnostics box in `galRoot` (`galHost`, z max, in `<body>` before the preview's host — see
  "Stacking over the page" below); the
  clicked picture, the strip and the menu in `galTop` (`galTopHost`, z max, appended to `<html>` after
  `<body>`, which holds the preview's host). Same stylesheet cloned. Before this a pinned preview
  covered the strip and the second ◀ ▶ press landed on the preview. `galTopHost` is in `ours()` and
  in the document mousedown's hole test, or a press on the strip closes the gallery.
- **A still pointer is not a hover** (v0.302.0): cells moved by a relayout (more pictures read in)
  fire `mouseenter` under a pointer that never moved, which previewed that cell and set `set.at`, so
  the counter jumped to 30 / 45. `galLayout` stamps `galLaidAt`, `galMove` stamps `galMovedAt` only
  when the coordinates change (browsers send their own same-place mousemove after a layout); an
  enter with no move since the layout is parked in `galStill` and runs on the next real move.
- **Detach / dock / join** (user, v0.300.0; no mode since v0.303.0): dragging the strip by its
  background (not a button; `galStripDown`, 4 px threshold) detaches it (`galDetach`, the picture
  keeps its own box); dragging the picture never detaches. While any drag is under way each piece
  has a dashed outline (inside the frame when joined). Dropping the strip — or moving the picture — so the strip's
  edge is within `POS_SNAP_EDGE` of the picture's top or bottom, overlapping it, docks it
  (`galDockFor`, `galDock`) at the picture's width, and the picture shows ✓ / ✕ "Join the strip to the
  picture?" (`.bt.ask`, `galJoin`): ✓ → `in`, ✕ → stays `dock`; both save. A new press on the
  picture or strip answers ✕. Ctrl drops the snapping, docking included. Joining is the only way
  back in (user removed "Reset position", v0.303.0).
- **Stepping is the slideshow's** (v0.317.0, user: the gallery's preview matches the page slideshow
  in every aspect; the strip stayed, v0.318.0): the strip's picture row and ← → [ ] call `galStep` →
  `twPress`. `tour.gal` = the set, `tourEntries` → `galEntries` (cells in order, `x` = index),
  `tourFollow` → `galFollow` (turns to the picture's page, `galPageNote`), `resolve` → `galResolve`
  for a cell, `plGet` → `item.hit`, `plFill` skipped (`galHqAll` loads each page's originals),
  `tourMore` → `galTourMore` (raises `set.far`, `galFeed`, waits ≤ 6 s), `tourExhausted` →
  `galWhole`. So spot, size reset, page picture at once, ends, hold, fast mode and fullscreen are the
  page's. A gallery rebuilt for the same href rebinds `tour.gal` (`tourEntries`). Idle start =
  `galStartAt` (`set.at` if on the page on screen, else the page's first); `set.at` is set only by a
  step or a pin, **never by a hover** (reaching the strip crosses cells). Pages: the strip's page row
  is `galFlip`; its ◀ ▶, ↑ ↓ and PageUp/PageDown go through `twPageBtn` (any preview closes first, v0.426.0)
  to `galPageStep` (past the last it loads more). The wheel never scrolls the
  page behind (`galWheel`, eats it always; a pinned preview closes): a scroll closed the gallery,
  which then also stopped the reading (v0.295.0).
- **Closing does not stop the reading** (user, v0.297.0): a reopen has the later pages; a hover
  read-ahead or another open replaces it (`galRender` stops the busy frame). Closing does close a
  pinned gallery preview (user v0.309.0).
- **The count is read whole, the pictures fetched by need** (user v0.309.0; v0.307.0–v0.308.0
  paused the frame instead, which left the total unknown — the user wants the count).
  - Frame (`galProbeReport`, `hush`): once the first list has set `shapes`, every `<img>` of a
    judged card shape is listed as it mounts (its `src`, else a `GAL_LAZY` attribute; `galItem`
    before anything is removed) and then blanked (1×1 data GIF, `srcset` and `<picture>` sources
    removed), so the site's page scrolls to its end with no picture downloads. Other-shape mounts
    count toward `GAL_FOREIGN_END` as before. Unjudged shapes still load and go through `list()`/
    `mine`. Measured in Chrome on nsfw.xxx /user/How_Is_This_Fashion (plain frame, same blanking):
    376 posts listed in 48 s, 12 image requests, 0 bytes; the site's virtualised feed kept loading.
  - Parent: `galLists` holds everything read; the set gets cells only as `galFeed` asks
    (`galWantN`: through the furthest page reached `far` plus `ahead` = 1, then page − 1 for pages
    2–4, then the page number from 5 — user's ramp: page 2 → 3 loaded, 3 → 4–5, 5 → 5 ahead,
    10 → 10 ahead). `galPer` = the first page's count, else a guess from the window. `galShow`
    loads only `2 × galPer(null)` thumbnails on open. `set.fed` walks `galLists` (dedupe by
    `galKeys`), `set.inflight` counts thumbnails loading; a failed one frees its room.
  - Strip: pictures `/ galLists length`, pages = laid-out pages + the unloaded rest ÷ `galPer`.
    `galStep` does not wrap until `galWhole` (all read and loaded).
  - `latePlayerArea` is off inside the frame (v0.310.0). nsfw.xxx plays its own clip on a hovered
    video card, so hovers learn those cards as a late-player area. `tourWorthy` then refused them,
    and the frame listed none of them. On /user/alternativealt1 it read 295 of the site's 552 posts;
    all 257 missing were `div.post.video`. The site itself had loaded all 552 (its PostsGrid
    `posts`). Note: Chrome's resource-timing buffer stops at 250 entries, so the API page list
    looked like it ended at page 17.
  - The fixture `door-big.html` uses `/many/bigN.jpg` (distinct paths): `galKeys` dedupes by URL
    *path*, so 240 `mural.jpg?bigN` were one picture to the feed.
- **Reading on** (`galGrow`, queued by `galBuild` as L13, last — PRELOAD.md L13 row): `galRender(href, onMore, onEnd)` names
  the frame `…:<token>:grow`; the frame's `galProbeReport` reports as before, then `readOn()`:
  every `GAL_GROW_TICK` it posts only new items, scrolls `scrollingElement` 0.9 screen and
  dispatches a `scroll` event (a frame not painted, as in the Browser pane, sends none; pages that
  load on `scroll` then work, IntersectionObserver ones do not there), and posts `done` after
  `GAL_GROW_IDLE_MS` at the bottom or `GAL_GROW_MAX_MS`. Parent: `galMore` merges into
  `galLists` (the cached list, mutated) by URL path of thumb + every srcset entry (`galItemKeys`,
  so an HTML read and a frame read of one picture match), `galAppend` adds cells in
  `GAL_APPEND_MS` batches, relayout keeps the page. `galGrown` = read to the end this visit, not
  read again. (No longer ended by `galHide`, v0.297.0.)
  Cost: the open's page loads a second time (the first frame, if any, is gone by then).
- **Where the gallery ends** (user v0.298.0: nsfw.xxx's /user/PogiOne shows its 37 posts, then
  appends the site's feed of *other users* in the same grid, which read on as more pictures). In
  the frame (`galProbeReport` `mine`/`judge`): each item carries its card shape (`galCardSig`, the
  first `GAL_CARD_DEPTH` 4 levels of `domChain` — an outer load-state class like `init` must not
  count). The first list **holding any pictures** (an empty first report must not seed it) sets
  the gallery's own shapes: the commonest one and every shape up to its last card. A shape seen
  later is judged once: **another gallery** when most of its cards are learned doors
  (`doorReason`) or link to a page shaped like this one (`galPathShape`: first segment kept,
  others `#`/`w` — /user/PogiOne vs /user/x); **elsewhere** when most link to another site's page, not a
  picture or clip (`offSite`; v0.352.0, sexygirlspics: 9 cam spots `li.faye-live-spot` → `go.sexygirlspics.live`,
  mounted by script so the HTML path never saw them, made a 15-picture gallery read 24 in Chrome) — never the
  commonest shape (`domSig`), so a forum's pictures linking to an image host's pages stay own;
  **anything else is the gallery's own** (no evidence
  = keep reading, as before). `GAL_FOREIGN_END` 4 such pictures in a row end the reading.
  **The first list is judged too** (v0.305.0, verified in Chrome on nsfw.xxx /post/351243: 1 own
  picture, then 16 feed cards linking `/post/#`): when its shapes split into own and other
  galleries, only the own ones count; when none judge own, all do, as before (a page whose own
  thumbnails link to sibling pages of its own shape keeps working).
- **Row spacing** (user v0.309.0, `galRows` `place`): a row segment keeps `GAL_GAP` at both ends
  (window margin, the clicked picture); what is left is shared between its pictures only. The
  set's last row (and a lone picture) stays left-aligned at `GAL_GAP`.
  nsfw.xxx `/user/alternativealt1` (card count 3, 500+ read) is **not** a feed: hovering its posts
  says they are the creator's, and the user keeps them, videos included (2026-11-13); the volume is
  handled by reading one page ahead (above).
  Not used (tried in v0.298.0's draft): `galLeafAt` on the shape's links — a video post's page has
  no bigger *picture*, so it called the gallery's own video posts "more thumbnails" and cut a
  37-post gallery at 15. Every verdict and the end reason go into the open's trace as `frame: …`
  (`notes` on the frame's messages; `hover-zoom:gallery-state` prints them) — the frame's own
  `dbg` never reaches the console.
- Why the 683-picture gallery showed 9–15: the frame reported once, 4 s after load, and the page
  mounts posts as it is scrolled. Unverified on nsfw.xxx itself.

## Loading ahead (v0.387.0, user's spec 2026-11-26; INTERACTION.md `G13`)

What loads ahead follows what the user does. Code: the `ah*` functions after `galPre`'s declarations, constants beside
`GAL_HQ_PAR`. Terms: **gallery** = the middle-click view (code: peek); **gallery preview** = the hover view.

- **Pacing** (`ahGate`): every background start waits for a slot; starts are a random `AH_PIC_GAP` 50–200 ms
  apart for pictures (≤ `GAL_HQ_PAR` 6 in flight), `AH_PAGE_GAP` 300–800 ms for page reads (Forum Stumbler's gap,
  ≤ 4). In flight settles at download time ÷ gap, so a faster line has *fewer* overlapping, the rate stays human.
  Order (`ahPri(tag, ahMoment())`): no gallery open = counts → the main page. A gallery open = PRELOAD.md M6–M9:
  `galh` (L22) → `galp` (L23) → `galo` (L14) / `gal` (L17) (M6 `galo` first, else `gal`) → `galn` (L18); counts and
  the main page paused (`ahHeld`), resumed by `ahGalClose`'s `ahPump`. While the open gallery's thumbnails arrive
  (`set.inflight`; and `galEarlyLeft`, the first 2 pages `galShow` places by declared sizes and loads outside
  `galAppend` — set *before* `galBuild`, whose layout queues the originals synchronously; without it 2 originals
  started under the first batch, v0.438.0 on door-big) everything but `galh` waits, unless none settled for `AH_THUMB_STALL_MS` 3 s (a
  stalled file must not block originals for good); each thumbnail sets `set.thumbAt`, the last pumps the gates.
  A run (`galHqAll`) keeps `GAL_HQ_Q` 12 waiting or in flight, twice the gate's 6, so a lower line never starts in the
  gap between one original landing and the next being queued. During an L17 walk (`ahGalAhead`, `ahG.walk` = its run) `galo` is held in M7–M9, page reads included: the walk awaits one gallery at a time, and without it L14 filled every gap between galleries (eporner, v0.438.0). L18 (`galn`) is queued after the walk. The slideshow (`ahMoment` 'slide') keeps the old
  order: `gal`/`galo` equal and taking turns, no hold (M13 not built). `ahDrop(tag)` resolves a tag's waiting slots
  to null (callers skip); `ahDropOrigs` drops all four originals lines. A hidden tab starts nothing. Measured on `door-long`:
  picture starts 58 / 141 / 453 ms (min / median / max).
- **Main page** (`galPreNext` → `ahMainPick`, no gallery or preview up; v0.397.0, user 2026-11-26): page reads for every
  door all the time (`galCountNext`, HTML only, nearest the middle first — the read *is* the count and the thumbnail
  list, there is no separate count). From `ahAnchor` (the hovered door, else the first on screen — read at every pick, never stored: a stored one
  skipped doors recognised later above it, v0.418.0) on in page order,
  one job at a time, in **rounds** (v0.415.0, user: "28 galleries of thumbnails over 2 minutes before any full size
  is not how a person uses a site"; numbers expected to change with testing): round r = for each door in page
  order, its next `AH_THUMBS_STEP` 10 thumbnails then its original r+1 (`ahRound` = rounds done per door; `ahOrig` →
  `galResolve` on a stand-in, `plKeepImage`), until `AH_THUMBS_MAIN` 30 thumbnails = 3 rounds (so 3 originals). The
  ▦ chip turns blue once round 1's thumbnails are in (`galFirstIn`, v0.418.0, user; it was the last round's).
  Then, after a gallery preview, the door after it gets its whole first page of thumbnails (`ahLookLast`,
  `ahNextDone`); then frame reads to the end (`galGrow`, the expensive `19+` → `40`) last of all (`ahIdleGrow`, once
  per door). Thumbnails already settled are skipped. A preview
  loads the rest of its page itself. Endless off: thumbnails for the first door + `AH_THUMBS_OFF` 3, originals for
  the first only, the rest once ≥ `AH_SHARE` 40 % of the page's doors are seen. Measured on eporner (Chrome, cold):
  page reads ~0.4 s, 30 thumbnails ≈ 4 s a door, an original ≈ 1.1 s with 6 in flight.
- **Order on the results page** (v0.440.0, PRELOAD.md M1): L1 (`pgFill` jobs marked `l1`, on screen and the next
  screen) → counts (`count` held by `ahL1Busy`; `plL1` counts L1 in flight, `plDoneOne` pumps the gates when the last
  settles; stall guard `AH_THUMB_STALL_MS`) → rounds (`main` also held while `galCnt` > 0; counts and rounds are on
  different gates, so without this they ran side by side, eporner v0.440.0). Rounds are steps per door (`ahRound` =
  steps done): step 2r = round r's 10 thumbnails, 2r+1 = its original — every door's step before any door's next. Then
  L2: `galPreNext` with no job sets `ahRoundsLeft` false and `pgWant(3)` on a page with doors; until then `pgFill` caps
  at level 2 (pages without doors keep the interest rule: 3 screens scrolled, or a screen's scroll after a hover).
  Until v0.439.0 the covers' originals waited for the counts instead.
- **Scrolling** (v0.440.0, PRELOAD.md M4; `ahScrollNote` from `galScroll`, checked ≤ every 200 ms): any user scroll
  sets `ahBehind` (= scrolling). Meanwhile only the window on screen → `AH_SCROLL_SCREENS` 3 screens down loads: L1
  (`pgFill` span 3), counts (`galPrePick` skips doors outside it), round 1's thumbnails (`ahMainPick` scroll branch,
  step 0 only); the job's door leaving the window → `ahDrop('main')`. Still for `AH_STILL_MS` 250, then
  `AH_HOVER_WAIT_MS` 1000 for a hover: the hovered door becomes the anchor, else the first door on screen, and M1
  resumes. A job cut by the drop (`ahGen` changed) is un-done so it loads again later. (Until v0.439.0 a scroll past
  the next door stopped all new loads until still.)
- **Gallery preview** (`galLookOpen`, `galLook`): a door hovered `AH_LOOK_MS` 500 lays out its first page of
  thumbnails around it, the door left in place as the hole (`galHole` = its rect, `galBars` → hole only). Inert:
  the set never gets `live` (no cell events), no strip (`galLayout` skips `galPageNote`/`galFeed`), never marked
  seen (seen shapes the endless queue), no originals, upgrades or frame. Closes on leaving the door (`galMove`), a
  page scroll, the pointer leaving the window (`galPtLeft`, from the document `mouseout` with no `relatedTarget`: a fast
  exit sends no `galMove` outside the door, so it also clears `galHoverTimer` and sets `galPtOut`, which
  `galLookOpen` refuses until the next move — else the timer opened it at the stale `galPt`), a left press (the link is followed), or any other hover (`onOver` — it ran `return` for an open
  gallery and swallowed the next door's mouseover). Middle press / chip from it opens the gallery (`galMiddle`
  closes it first; `galChipOpen` ignores it). Wheel and keys stay the page's.
- **Storage readout** (user, v0.394.0; v0.423.0 R/P/D): `galStoreTick`, `.hzst` — bottom-right of the hovered door
  (`galHole`, fixed in `galTop`, long labels) for a preview; once open, the first child of the corner box
  `galFly.pic0`'s bottom-left column, above Endless and All (**not** `galFly.pic`: that is the page's own `<img>`).
  Short `R: P: D:`, spelled out (RAM, Preloaded, Disk) while the picture is hovered (`.s`/`.l` spans); hidden with the other
  buttons until the picture is hovered (v0.425.0). Lines: RAM = `heldBytes`; Preloaded ≈ `plKeep` bytes not in `heldBlobs`
  (an estimate from pixels, `PL_BYTES_PER_PX`); disk = `navigator.storage.estimate().usage` (the whole origin). Ticks
  each second while `galLook`/`galCur`/`galWant`; started from `galShow`, `galLookOpen`, the `galCur` set and the fly's
  creation (a closing preview's `galHide` removes it on a timeout that can land after the gallery opened).
  Preloaded is NOT thumbnails (user asked; it is full-size pictures held for the next steps).
- **Load all** (`cfg.galleryLoadAll`, default on, v0.397.0; the right-click menu and Settings → Galleries — off the
  clicked picture since v0.423.0, user): `galHqAhead` (v0.438.0, PRELOAD.md M6–M9) queues, in this order, the
  `AH_NEAR` 3 either side of the last hovered picture (`ahG.near`, `galh`), the page on screen (`galp`; `ahG.m`
  'back' = from its end), every built cell after it, stand-ins for the list's unbuilt rest, then the
  `KEEP_BACK_PAGES` behind it nearest first (all `galo`). A hover whose ±3 are loaded does not restart the run
  (`ahSaw`), unless it is the gallery's first (G: waiting) or the run stopped at the memory horizon. Each page step
  sets the moment (`ahPageStep`: `fwd`/`back`) and the flip's `galPageWork` re-queues from the new page; a queue switch
  (`galBuild`, new href) sets `open` (M11). Turned off mid-gallery: the run cancelled, only `galh` from then on. Off
  = only `galh` (the plan's [Load all] lines skipped; until v0.437.0: from a preview through 2 pages on).
  The clicked picture is never under `GAL_PIC_MIN_W`×`GAL_PIC_MIN_H` 160×134 (`galPlace`, drag `lo`, `galBoxKept`):
  measured v0.423.0 at the floor (inner 173×128, the 3 px border eats 6): ⓘ ↗ 11–74 × 6–30, ⤓ ✕ from 103, the
  left column (readout 40 + Endless 20 + All 20, 4 px gaps) 34–122, ⛶ 135–162. Taller column = the height floor;
  Endless and All side by side would lower it ~24 px.
  A run stops at the **memory horizon** (`keepRoomFor(item)`, v0.420.0, user: "stay under the cap, drop things to
  make room"): it loads the next picture while it fits, or fits by dropping only pictures *farther* than it
  (`keepDist`); otherwise it ends `memory full` and sets `set.hqHorizon`, and every slideshow step/preview
  (`ahSaw`) starts it again from there, so it walks forward as the user does. `galn` (next gallery) loads ask the
  same. Replaced `keepFullAt` (any drop ahead blocked every run for 3 s — the run started for the
  picture on screen ended `0 found, 0 ms` and the slideshow showed thumbnails). Main-page originals don't ask:
  with no gallery open every distance is Infinity and they would never load.
- **Memory keep** (`keepTrim`, user 2026-11-26; replaces HELD_MAX / plBudget's oldest-first): `heldBlobs` (exact
  bytes) and `plKeep` (estimated, `PL_BYTES_PER_PX` — over-counts JPEGs ~3×, so the cap uses held bytes where
  present) as one set. Gallery entries (`keepItem` url → item) are placed on the open queue (`keepPlaces`, linear
  over the queue's lists); behind the user = dropped past `KEEP_BACK_PAGES` 2 pages or `KEEP_BEHIND_MS` 5 min
  behind. Over `cfg.galleryKeepMB` (1024): farthest first by `keepDist` — not in the queue (other galleries) =
  Infinity, behind = distance × `KEEP_BEHIND_W` 2, ahead = distance (was: behind, then ahead, unplaced mixed in by
  age, so a left gallery's pictures outlived what was just ahead). Thumbnails are not in this cap (HTTP cache). Everything
  else: `cfg.keepMB` (512), oldest first. Under 8 GB `deviceMemory`, each cap ≤ 128 MB per GB. A dropped
  original's item loses `hqTried`, so a backward run loads it again. Runs on every add and each storage-readout
  tick (1 s). Verified on eporner with a 64 MB cap: 361/666 then `memory full`.
- **Gallery, endless** (`ahG`, made in `galMiddle` unless a queue switch, dropped in `galHide`): thumbnails
  (first 2 pages) of the next `ahAheadN` galleries — 2, then 5 once the user steps forward or reaches gallery 2, never
  more (user v0.434.0: 10 was overkill) (`ahGalAhead`, run on every landing and page step, and when Endless is ticked).
  **Last** loads none (`galLastSet` bumps `ahG.run`, stops `otok`, drops `galn`): those galleries never open.
  **G: pressed** (`ahAll()`, `ahStepMode`, user v0.434.0): Load all waits until something in the gallery on screen is
  previewed (`ahG.saw`, set in `ahSaw`, cleared on a queue switch); P: pressed on an unpreviewed gallery resumes it.
  **A slideshow step** raises `set.far` to its picture's page and runs `galFeed` (in `ahSaw`), so the page it closes
  on already has its thumbnails (user: an empty page filling in shuffles the cells). The slideshow's originals
  (`galHqSlide`, from `ahSaw` in `tourGo`): from its picture through 2 pages on (only what `galFeed` has built; Load
  all: to the end); within reach of the end, the next gallery's first page too. A backward slideshow step puts the
  `AH_BACK` 5 before it first; forward resumes after. Closing the gallery drops `gal` and the originals lines and the
  main page restarts from the first door on screen.
- **A restart never cancels what is in flight** (v0.412.0, user: after 2 page steps nothing loaded but the hovered
  picture). `galHqAhead` runs on every thumbnail append (`set.pv`) and every preview, and it used to set `hqTok.cancelled`,
  which `galResolve` honours: each restart killed the run's 6 in-flight originals, so few ever finished. Now it sets
  `hqTok.stop` (start nothing more); in-flight ones land and set `hqTried`, and `hqBusy` keeps the new run from
  starting them twice. Real cancels stay: gallery closed (`galDrop`), Load all turned off, a skip with Load all off.
- **Stopped runs leave the queue; the next gallery waits behind the open one** (v0.414.0, eporner repro: one page step
  fired 9 `galHqAhead`s in 3 s; each re-queued the next gallery's 54 already-found originals as `galo`, FIFO ahead of
  the open run, which then found nothing for ~2 min). `ahSlot` takes the run's `tok` and `ahGate.pump` resolves a
  stopped/cancelled run's waiters to null. `ahOrig` skips found (`hqTried && hit`) and in-flight (`hqBusy`) pictures
  without a slot. The next gallery's first page is tag `galn` (priority 0.5: after `gal`/`galo`, before counts), and
  each `ahGalAhead` walk stops the last one's `g.otok`. A slot dropped by a stop must not set `tok.cancelled`: that
  would kill the run's in-flight `galResolve`.
- **`hqTried` only on a found original** (v0.395.0): a run (`galHqAll`) probes without `fresh`, so it reuses a cached
  miss (`probeMiss`, `PROBE_RETRY_MS`); marking every picture tried made one bad patch permanent — no run ever
  loaded those pictures again and each hover fetched its own (user, LibreWolf, girlstop; Chrome's run: 37/37,
  18.3 MB in 13 s). Not confirmed as the user's cause: their `gallery originals: done {pictures, found}` would show it.
- **Cache check**: originals loaded ahead (`ahFiles`) that a slideshow paints are timed in `swapViewer`;
  `ahWarmReport` writes us-log `aheadwarm` (ok = under `PL_COLD_MS`) when the gallery closes. Hover previews are
  not timed.
- Trace: `hover-zoom:ahead-trace` (v0.396.0) — every paced load and user step with timings; usage in `docs/TESTING.md`
  "Live sites in Claude in Chrome".
- Debug lines: `loading ahead: …` (thumbnails [and first originals] {href, cut}, scrolled past…, scroll stopped…,
  a preview; originals from picture N, pages skipped…, thumbnails of gallery N of the queue {ahead}, idle,
  reading a count to its end).
- Not verified (2026-11-26): the slideshow backward rule, endless off, LibreWolf, pornpics (refused by both
  browsers' safety lists — needs the user's run).
- **Prediction log** (`predNote`, `predSum`; user v0.435.0): what the user did beside what was loaded — `docs/PREDICT.md`.

## Stable layout (v0.435.0, user; INTERACTION.md `G16`)

User: thumbnails sliding while they load chase the pointer and cause motion sickness. Rule: **a shown cell never
moves** except on a resize, a hole move, or a declared size proving wrong.
- **Order:** cells join in list order only. `galAppend` queues each item at `set.qIn`; `galQFlush` takes the run
  from `set.qOut` while settled (a failure is null, passed over after one retry `GAL_RETRY_GAP_MS` later). `galShow`
  builds from `galPrefix` (loaded up to the first still loading; `set.fed` = how far) and hands its in-flight
  loads to the set (`galShowPend` → `set.pend`) so `galAppend` does not ask again. `galRest` only writes the
  short note now (it used to rebuild with late arrivals inserted mid-list — that moved everything).
- **Hidden open row:** `galRows` packs a row tight while it may still gain pictures (`spare` only once the next
  shape is known), so the last row's last run (`galOpenRow`) on the last page gets `.cell.wait` (visibility
  hidden) until `galWhole`. `galGrow`'s end relayouts when `set.waiting`.
- **Scale lock:** fill mode (one page grown to the screen) rescales every row per arrival; it is allowed only
  while `whole`, and `set.fill` is fixed at the first layout with a shown cell. A small gallery shown before it
  was whole stays at the paged row height.
- **Declared sizes:** `galItem` keeps the `<img>` `width`/`height` attributes (`dw`, `dh`). `galDeclAsp` uses them
  while the site is trusted (`galSizeTrusted`: not `bad ≥ 3` and `bad > 20 %`); `galImg(…, early)` then hands
  out a cell at once (`p.early`, no `ok` until it loads, `galEarlyDone`). `galShow` places the whole first two
  pages at once when every item has one. Every loaded thumbnail with a declared size is checked once
  (`galSizeCheck`, ±10 % `GAL_DECL_TOL`; `object-fit: cover` hides less) — free ground truth, so a distrusted site
  can earn trust back. Counts halve past 100. Stored in GM `hoverZoomSizeTrust`, kept across Reset; `dbg` on a flip.
  A wrong one corrects its cell's shape (that one move is the cost). A failed early cell stays an empty `.gone` slot.
- Test: `door-search.html` d8 → `gallery-shapes.html` (60 pictures, 6 shapes, no sizes, 0–2.5 s late); d6 has
  sizes. Measured 2026-11-26 (Browser pane): 0 moves on both; d8 fills a row at a time.
- Not fixed: the main page's loading ahead and the open gallery can ask for the same thumbnail at once (seen
  on d8, uncached; pre-existing).

## Cell marks: cover and ready corners (v0.441.0–v0.442.0, user 2026-11-27)

**Their blue, and the corner picture's frame (`.fly`, `.strip.own`), is `#063685`** (user v0.454.0): Dark Reader's
rendering of `#89b4fa`, which the user had been seeing in Chrome and asked for back. Set as `--hzm`/`--hzmg` on the three
gallery hosts (`galMarkVars`) with `--darkreader-{bg,text,border}--hzm` beside them, so Dark Reader's copy of the sheet
draws it unchanged (SETTINGS.md "Dark Reader and the widgets"). A literal colour in that sheet would be converted again.

In the open gallery and the gallery preview (`galCellMarks`, painted 120 ms after any cell or keep change via
`galCellMarksSoon`). One 14 px corner triangle, bottom-right, clipped to the cell's 6 px rounding (user: a dot never
sat centred on its dark ring; a star was replaced by a corner):
- **Cover: a blue border inside the cell** (`.cvr`, `inset:0` + `inset` box-shadow, setting `galleryCoverMark`; user
  v0.445.0: the yellow corner was still hard to find; the border must not change row height or picture size, so it
  is an overlay, never a CSS border). The cover keeps its own blue/red corner. `set.cover` = `galCoverSrc(href)` read at
  `galBuild`: the corner picture's page door (`galFly.pic`; Endless always opens from a door on the live page, so it
  has one), else its first src (`galFly.src0`), the previewed door, else the page's door linking there. Matched by
  `galCoverItem` (same URL, `sameStem`, `galSameFile`), retried as cells join; `galFlyUpgrade` also sets it.
- **Blue** (`.rdy`, `var(--hzm)`, setting `galleryReadyMark`) where the original is held in the memory keep (`plKeep` or
  `heldBlobs` via `keepItem`) — the honest "a hover shows it at once". Recomputed from the keep every paint, so a
  dropped original loses it. A clip gets it once buffered in full (`galClips` done, v0.456.0).
- **Red** (`.hqx`, `#f38ba8`, under `galleryReadyMark`) where the original genuinely failed (`it.hqFail`, set by
  `galOrigNote` / a hover's miss; a cut never sets it), in place of blue. Its activity line carries the diagnosis.
- **A `GIF` / `clip` label top-right** (`.ply`, always on, L24; a centred ▶ until v0.457.0 — user: it looked like a
  button to click): an animated GIF thumbnail shown as its first frame (`item.gifAnim`), or a cell whose original turned
  out a clip (`item.hit.video`; appears when L22/L23/L14 or a hover finds it). Gone once the clip plays in the cell.

## Full clips: "Upgrade clips" and L25 (v0.456.0)

A found clip (`hit.video`) is loaded in full by `galClipQueue` → `galClipLoad`: a muted `<video preload=auto>` kept
alive in `galClips` (Chromium's player of the same address in this document shares its buffer — unverified per
browser; the slideshow's `plWarmVideo` relies on the same). Lines (`galClipTag`): `galc` = the page on screen
("Upgrade clips", Load all; rank 0.5, ahead of L23), `galv` = L25, past the page, only in M6/M11 and M13 and while
fewer than `GAL_CLIP_KEEP` 12 are kept; `gals` = the slideshow's next 10, any setting; without Load all a slideshow
upgrades the page's *known* clips only (unknown cells are not resolved for it). L22 clips stay metadata-only unless
Load all (plan M8). A clip is known only after its original is resolved, so a found clip re-queues in its own line;
known clips (`hqTried`) are queued by `galHqAll` before its filter drops them. Done = buffered to the end; the
browser suspending short of it (`GAL_CLIP_SUSPEND_MS`) = "partly buffered" (⚠, kept); `GAL_CLIP_MS` 60 s frees the
slot and the load goes on. Cuts: an entry in `netLive` under `clip:<url>`, so hovers, page steps and `galDrop` stop
it like any original (`galClipStop`); closing flushes all, an Endless switch the left gallery's. Over 12, the oldest
done ones off the page on screen go (`galClipTrim`). Fixture: `gallery-gif.html` (2 clip cells; door-gif.html).
- **A hovered clip goes on loading after the pointer leaves** (`galClipHover`, tag `hov`, any setting; user v0.457.0):
  a background owner outside the gates, so only another picture's rested hover (`hoverFirst`), a page step or a close
  stops it. With Load all the hover's ±3 clips ride L22's own line (`galClipTag` → `galh`), so they come next.
- **A clip in full plays in its cell** (`galClipCell`, from `galCellMarks`; user v0.457.0): the kept `<video>` itself is
  moved over the still (`video.cv`, muted, looping, `pointer-events:none` so the cell's `<img>` keeps the hover).
- **An animated GIF plays in its cell once its full file is held** (`galGifPlay`, from `galCellMarks`, user v0.458.0):
  the still (L24) is only there until then, so the user sees what is coming. The user's goal for L24 and clips: never
  a black empty cell — a still (first frame, or the site's thumbnail) first, then the real thing playing in place once
  loaded (Load all: ahead; otherwise after a hover).

## L24: GIF thumbnails as their first frame (v0.449.0)

A cell whose thumbnail path ends `.gif` (`isGifUrl`) gets `gifStill(thumb)`: ranged GM_xhr reads (`rangeGet`'s
`from`, 64 KB, then on to 256 KB, 1 MB, 2 MB, never re-reading), `gifFrameEnd` finds where frame 1's image data ends,
a trailer byte is appended and the cell shows that blob (`img.__hzStill`). More frames after it = `gifAnim` (▶). The
whole file is the original: a hover, L22, or Load all fetches it as before. Fallbacks to the file itself: no
GM_xhr (plain test pages), a non-206 answer on a follow-up read, frame 1 past 2 MB, not a GIF, or the blob refused
(`blobRefused`, or the img's `onerror` on the blob retries the file once).
- **`galResolve` must not take a still's blob for "the thumbnail itself"** — it reads `item.thumb` when `__hzStill`.
- Tested 2026-11-27: Chromium decodes a cut-off GIF as a partial frame (64 KB of a 312 KB frame drew 20 % of the
  pixels), hence the cut at the frame's end. A video's first frame via `preload="metadata"` also works (Chromium
  fetched ~3 s of a 60 s clip and fired `loadeddata`) — not used: gallery cells always have an image thumbnail,
  and `probeVideo` already reads only metadata.
- Fixture: `test-pages/door-gif.html` → `gallery-gif.html` (4 animated, 1 single-frame GIF, 3 jpg, 1 jpg → `post-clip.html`).
- `galFlyUpgrade` stores the cover's original (`it.hit`, `plKeepImage`).
- **The next gallery paints at once** (v0.445.0): L17's loaded thumbnails are kept as `<img>`s (`galThumbKeep`, 600,
  cleared on close) and handed to the new gallery's cells by `galImg`. Before, the cells refetched them (user saw the
  blue corners first — originals held — then thumbnails filling left to right, the browser's 6 per host).
- **Not preloaded yet, it still appears as one block** (v0.446.0, user: page steps paint as a block, so must a new
  gallery): a set placed by declared sizes gets `.set.hold` (`galHoldStart`) — its first page stays hidden until every
  cell there settles (`galHoldCheck` from `galEarlyDone`), at most `GAL_WAIT_MS`; a page step ends it. The undeclared
  path already waits for all (`Promise.race([all, cap])`). Seen when L17 had not run: a fresh open (M6) puts L17 after
  L14, so with Load all the first Endless switch often lands before the next gallery's thumbnails are in.
- Both settings: settings panel (Galleries) and the gallery right-click menu, beside the saved-disc one.
- Verified in Chrome on eporner 2026-11-27: cover on the right cell (5-picture gallery: picture 4; Endless into the
  next gallery: its picture 15 = its door's src); ready 12 → 144 over 23 s with Load all; both menu toggles.

## Hover patterns, L26 (v0.464.0, user 2026-11-28)

User's ask: watch the last 10–20 galleries; if previews keep landing on the same places (first and last, first and
5th…), load those first. "The more ways to find a pattern, the better." Not for the user's own browsing (they hunt
specific shots that cannot be predicted); for other people. Earlier rejection (shared computer; behaviour differs by
site) is answered by per-site records and a rolling window. Setting `galleryPattern` (default on).

- Record (`hpNote` from `ahSaw`, not slideshow steps): per gallery visit the 0-based positions `h` and the page-time
  keys `k`; committed on close / Endless switch / pagehide (`hpCommit`) as `{n, h, k}` (n = list length when
  `galWhole`, else 0). GM `hoverZoomHoverPattern` `{host: [last 20 visits with a preview]}`, ≤ 50 hosts.
- Keys (one visit counts a key once): `sJ`/`eJ` J from the gallery's start / end (J < 10; e and `mid` only when n is
  known, computed at pick time from `h`); `pJ`/`qJ` from the page's start / end; `rcR.C` row and column on the page
  (rows = distinct rounded `y` of the page's layout `set.hpL`, columns by `x`); `reR` end of row R; `lrC` in the last
  row; shape from `set.asp` (L > 1.15, P < 0.87, else S): `fX` gallery's first of shape X, `gX` page's first, `wide` /
  `tall` page's widest / tallest (pages of ≥ 3).
- Pick (`hpPick`, pure): ≥ 5 visits; a key in ≥ half of them AND ≥ 2× what chance gives (`luck` = Σ min(1, 3·previews /
  pictures seen)) — without the second test a visit that previews half the gallery makes every place a pattern.
- Apply (`hpFor` → `galHqAhead`, tag `galk`, rank 0.7: after L22/Upgrade clips, before L17a/L23): `hpResolve` maps keys
  to ≤ 6 positions — gallery keys from n, page keys on the page on screen. Runs with Load all off too (a few pictures);
  not with G: before a preview (M10's rule). `pv` logs `pat: 1` on a hover of a picked place.
- Settings row (`hpRow`) names the places in words (`hpWords`) with Forget. Colour is not a key: a cross-origin
  thumbnail taints a canvas, so reading pixels needs each thumbnail fetched again as bytes (GM_xhr) — offered to the
  user, not built.

## Arrival check (v0.411.0, user 2026-11-26; INTERACTION.md `G15`)

The page a door opens is the ground truth for the press that opened it. Hovers could correct a door verdict; arriving could not.
- **Press** (`missPress`, `CAP_TARGET` mousedown capture, records only — never stops or prevents): left or middle press on
  a same-origin linked `<img>` ≥ 50 px (or one under a cover) → `hoverZoomPressed` (GM, cross-tab: middle-click and
  OLINT open new tabs, which get no sessionStorage) `{h, from, path, chain (doorChainOf), thumb, w, ht, thought}`;
  `thought` = `results` (`galResultsAt`) / `gallery` (`doorReason`) / `none`. ≤ 12 kept, each 2 min.
- **Arrival** (`missArrive` at boot, top frame, not a probe frame): a pending press whose `h` is this URL (trailing `/`
  ignored) is consumed, judged `MISS_SETTLE_MS` 2.5 s after `load` (`missJudge`): the pressed picture drawn
  `DOOR_BIGGER` × bigger here (same URL, `sameStem` or `sameFileId`) → `leaf`; else `galKindFetch(href, document)` on the
  live page (no `galLoad` fallback: the page is already rendered; may fetch 2 cells' pages for the leaf test).
- **Fix** (`arrivalFix`, pure, tested): none→door = `doorLearn('door')` (a sample; 3 make a rule, as hovers); a door →
  leaf = `doorLearn('leaf')` (`areaDrop`, at once); gallery↔results = the tab's `hzDoorKinds2` entry set/removed (per tab only).
- **Log** (`missLog`, default **off**: it holds page addresses — a slice of browsing history, unlike us-log; the user asked
  for it): GM `hoverZoomMissLog` `{hosts: {h: {ok, miss}}, rows}` (300 rows), Settings → Diagnostics: Copy / Show / Clear.
  An unknown verdict (`truth` null) counts neither way.
- Risk, unmeasured: a photo page drawing its picture under 1.5× the thumbnail reads as its related strip's kind and teaches a
  door; hover rechecks (10 %) drop such a rule. Verified on door-whole → gallery-whole (none → learn door, logged).

## Behaviour (user's numbers, 2026-11-09)

- Every picture the page has (`GAL_MAX` = Infinity, user v0.251.0: galleries run 10-100 and a cap
  silently hid the rest; more pictures = smaller cells).
- **Locked on its door** (`galOn`): no hover delay, the hole and gallery never change while open, and
  leaving the link or the window does not hide it, so the pointer can go over the thumbnails. Closes
  on a Ctrl tap (Ctrl down then up, no other key, press or wheel between: `galTap`; it does not also
  run the previews hotkey, `galPeekTapAt`), Esc (with no preview up), a press on the corner picture
  (`.fly`), a scroll. **A browser-window resize keeps it** (user, v0.299.0: resizing to fit more
  pictures): `galRefit` puts the picture at its remembered place for the new size and lays out again on
  the page holding `set.at`; a scroll within 1 s of a resize is the reflow's and does not close
  (`galResizeAt`). The Browser pane's viewport emulation sends no `resize` event — dispatch one. A left press on the page where the corner is, while the picture is
  still flying, closes too (`galLeftAt` makes `galMidEat` eat its click). A left press before the set
  is built (loading) still closes it and goes through.
- **Presses between pictures reach nothing** (user, v0.292.0: a misclick must not open another
  page): `.set.live .shade` takes pointer events (its clip-path cuts the hole out of hit-testing too)
  and stops every press and click. Only cells, the preview, the hole and the tab act.
- **Clicking a cell opens its own page** (user): `item.link` = the picture's link on the gallery's
  page, else its card's (`cardLinks`); several (post + poster) → `galLinksPick` keeps the one whose
  first path part most single-link cards use. Ignored while a preview is up (that press pins it).
- **Middle press** (`galMiddle`, with `galleryMiddle`): on the open door it closes it; on another it
  switches. `preventDefault` on the press (no autoscroll), and `galMidEat` swallows that press's
  mouseup/auxclick/click (no new tab; `galMidAt`, reset by every press). Any modifier goes to the
  browser. A middle press on the preview is still `midSave` (window capture, runs first).
- **The clicked picture flies to the corner** (user, v0.293.0: always the same place to click to end,
  and nsfw.xxx's cards are a third of the page tall, so a hole there crowded the gallery out):
  `galHole = galCornerRect()` — bottom-right, `GAL_FLY_FRAC` 1/5 of the window tall, the card's
  shape, ≤ 40 % wide. `galFlyOut` copies the card's picture into `.fly` (outside the sets, blue
  border) and animates `transform` from the card's box (`GAL_FLY_MS` 320). `galFlyBack` (every
  `galHide`, and a switch to another door) flies it back to the card's box **as it is now**, or
  fades it when the card is off screen. `galFlyUpgrade` swaps in the full-size original: the gallery
  item that is this picture (same URL, `sameStem`, or `galSameFile` — one file name ends with the
  other, nsfw.xxx prefixes `amateur-`) → `galLinkedHit`, else the card's URL-rule candidates. The yellow
  ring and Close tab of v0.292.0 are gone (user: blue again).
- **Under the preview unless the pointer is on it** (user, v0.336.0; a v0.335.0 fade was rejected):
  `.fly` and its corners live in `galFlyHost` (`galFlyLayer`), z max like the rest; at rest it sits
  between `galHost` and the preview's host in `<body>`, so tree order puts it over the cells and under
  the preview. `galFlyZ` (from `galMove`, edit start/stop, open/close) moves it right after the
  preview's host (`galSlot(galFlyHost, true)`), over the preview, while `galPt` is within its box ± `GAL_HD`/2 or `galEdit`. An `in`
  strip rides inside `.fly`; `dock`/`out` strips and the menu stay in `galTop` (z max), over the
  preview, or the v0.302.0 bug (◀ ▶ press landing on a pinned preview) returns. The test is by
  coordinates, not `:hover`: a preview over the picture takes the pointer's hover itself.
  **Only the page strip hides the preview** (user v0.384.0, "nowhere else"; v0.382.0–v0.383.0 hid it on the whole
  corner picture; v0.384.0 the whole strip): while the pointer is on the strip's **page row** (`.r.pg`, not the picture
  row) the preview's host is `visibility:hidden`, fullscreen too (`galStripHidesPreview`). Re-tested on every pointer move
  (`galMove`, `galFlyZ`), at the end of `layout()` (a page step swaps the picture under a still pointer: it must start
  hidden), of `galStripText` (the row resizes) and after the corner picture's flight (`galFlyOut`, endless switching). A pinned preview's bar buttons and zoom cluster shift left off
  the corner picture and the strip (`barFlyShift` in `layoutChrome`), or they sit under something raised over them.
- **A left click or middle press on it closes** (v0.294.0: middle had stopped closing once the hole
  left the card — the document handler's middle branch only `preventDefault`s presses on our layer;
  the `.fly` listener closes and sets `galMidAt` so `galMidEat` eats the auxclick). Left closes on
  release without a 4 px move (`galEditDown`), since a drag moves it.
- **Tooltips:** short ones on the picture's buttons (⤓ ↗ ✕ ⛶ ⓘ, Endless mode, Show all galleries; user v0.423.0
  reversed v0.339.0's none), none on the picture, its corners or ◀ ▶ (user v0.426.0, as the page widget). The full
  help is the ⓘ box (`galInfoShow`), its one home; the right-click menu opens it ("What the buttons and numbers mean").
- **The menu stays over the raised picture**: `galTopHost` is in `<html>` after `<body>`, so it is over everything
  in `<body>`; `galMenuShow` also moves it last in `<html>` before showing (v0.339.0: the menu was under the
  picture and the strip while the pointer was on them).
- **Stacking over the page** (user, v0.381.0: a page's max-z launcher button covered the diagnostics box's
  Close). Every host is z max, so only tree order separates ours from a page's own z-max element. `galHost`
  and `galFlyHost` go through `galSlot` into the preview's slot in `<body>` (before `[data-us-dock]` widgets and
  the panel, which must stay over the preview); `hzRaise()` (from `showViewer`, `galFlyLayer`, `galDiag`)
  finds a non-inert page element after our first layer in `<body>` and moves our layers, and our own widget
  and panel if they were behind it, after it. It skips the move while a clip plays (a moved `<video>` pauses).
  z max − 1 is never safe for a layer the user must reach: a page at z max beats it wherever it sits.
- **Right-click = our menu** (`galMenuShow`, `.menu` in the layer; also on the strip): ✓ toggles for
  `galleryChips`, `galleryTicks`,
  `gallerySavedMarks` (also in Settings → Galleries), `galleryMiddle`, then Close the gallery.
  Closed by any press outside it or Esc.
- **Move or resize, always on** (user v0.303.0: snapping made the old lock-in mode and its ✓ / ✕
  unneeded): a drag of the picture moves the unit; a drag from a corner resizes it (the picture's
  own shape kept, 48 px … 90 % of the window tall). Corners are invisible `.hd` boxes in `galTop`
  at the unit's corners (`galHdPlace`), `GAL_HD` 7 px = the 3 px frame plus 2 px inside and out,
  with resize cursors. `galEdit` now means "a drag under way" (`galEditStart` on the first 4 px
  of movement); the drop saves at once (`galEditStop(true)` → `galSave`, no toast). **Lines**
  (`galLines`): the window's edges, the gallery's margin (`GAL_GAP` in from each edge, so the gap to
  the window matches the cells'), the centre, and on y the row lines (`galAnchorRows`). A move snaps
  edges to any line within `POS_SNAP_EDGE` and the middle to the centre within `POS_SNAP_CENTRE`
  (`galBoxSnap`). **A corner drag always snaps** (`galSnapH`, the strip's height counted): the moving
  edge to the nearest line, x lines via the aspect. **Ctrl = free** (user v0.300.0; Alt was v0.299.0
  and moved the whole browser window on the user's system). `galKeyDown` ignores Ctrl while editing,
  or a Ctrl tap mid-drag would close the gallery. Esc mid-drag restores the unit and the strip's
  place.
- **Row lines for snapping and memory** (`galAnchorRows`): a paged gallery's are `galPagedRows(H)`,
  which only the window height decides (a partial last page draws fewer rows but the lines stay);
  a one-page gallery's are its own `set.rows`, which move with the picture, so `galRefit` places it
  a second time on the new rows and it can still drift a little.
- **Its memory** (GM `hoverZoomGalleryAnchor` = `{last, sites: {host: {x, y, hf, ex, ey, strip}}}`;
  x/y are the preview's per-axis `{m: s|c|e, o}` via `galAnchorAx`, applied with `posAxis`; hf = the
  picture's height ÷ window height). **An edge on a line stays on that line** (user v0.300.0,
  `galEdges`/`galEdgeOn` save `ex.{l,r}`, `ey.{t,b}`; `galPlace`/`galEdgeAt` resolve): window edge or
  margin `{k:'w', e, o}`, centre `{k:'c'}`, row line `{k:'r', e, i}` counted from the nearer end. Both
  edges of an axis on lines set the size (y first), one sets the place, none falls back to x/y/hf.
  A row line missing in the new window falls back too. `strip` = `{m, side}`, or for `out` its own
  x/y/ex/ey (`galStripRec`/`galStripLoad`). The unit includes an attached strip. A save writes this site and `last`. **A site's first open copies `last` (or the corner
  default) into its own entry** (`galAnchorRec`), so a later save on another site never moves it
  (user: the new place is the default for new sites only).
- **The hole** (`galHole`) is the corner; the old hole on the card itself was v0.291.0–v0.292.0. The moving slot that followed the
  pointer was v0.240.0, commit de9996a ("take it back to here" means that).
- `galShow` loads every thumbnail first (`galImg`, up to `GAL_WAIT_MS` 2.5 s; late or failed ones are
  left out), so each shape is known **before** anything is placed — the user does not want pictures
  swimming as they load.
- `galRows(aspects, hole)`: rows of one height spread evenly over the viewport; each row's band is
  split into free segments around the hole (+ `GAL_GAP`); pictures fill segments in order, spare
  width spread evenly between them; binary search for the largest height that places every
  picture (none fits even at 8 px → the unplaced cells are hidden). Rows are one height because a
  segment beside the hole cannot be justified independently of the rows above and below.
- Upgrade check uses each picture's drawn width.
- **Hovering a door** shows its gallery preview after 500 ms (`G13`, "Loading ahead"). `GAL_CACHE` 300.
- **Preload** (`galPreNext`, `cfg.galleryPreload` on): "Loading ahead". Kicked after each `galMarkAll`
  (boot, scroll, new results), each frame's end and each close. Waits while any frame is busy (`galFrameStop`,
  `galGrowing`) or a gallery or preview is up — `galRender` would kill that frame. Stops for the
  page on a 429/503 or a frozen page (`galPreHalt`); a hidden tab stops its frame. Logged as one
  `gallery` row in `us-log`.
- **Next page** (`nextCheck` … `nextWarmReport`, user v0.325.0–v0.327.0; v0.440.0 = PRELOAD.md M5/L8): within a
  screen of the bottom (`ahAtBottom`) of a page with learned doors, idle (`nextIdle`: no preload, frame, gallery,
  slideshow or scroll), and this page's M1 lines 1–7 done (`ahRoundsLeft` false, no counts, no `page` PL jobs) —
  it reads `nextPageIn()`'s page and runs its M1 lines 2–6: every door's list (`galLoad`), then 3 rounds of each
  door's next 10 thumbnails (`ahImg`, tag `next`) then each door's next original (`galResolve` on a stand-in, through
  `ahPics`); endless off = the first 1 + `AH_THUMBS_OFF` doors, originals for the first. No share-opened rule (user;
  until v0.439.0 ≥ 20 % of the unseen galleries opened, 3 galleries, every original; `nextEngaged` is now only in the
  debug line). Not built: the next page's L1 (its singles: they are elements of a fetched page). Once per page. Lists + hits + file URLs go to `sessionStorage` `hzNextPage`; the next page
  (`nextArrive`) seeds `galLists`/`galCache` from it, so those peeks open at once. Originals survive
  the navigation only in the browser's cache, so `nextWarmSeen` times each one asked again and
  `nextWarmReport` logs `nextwarm` (ok = arrived under `PL_COLD_MS`) per opened gallery — the
  evidence for whether loading originals a page ahead is worth its bytes. No scroll-depth tracking:
  it is only asked at the bottom, and a hidden pane fires no scroll events (v0.325.0 counted 4 of 37).
  Pane, 2026-11-16: 3 galleries / 123 originals in ~30 s; 12 of 17 kept. us-log `nextpg` row.
  **Chrome, 2026-11-16, girlstop:** 10 originals loaded by `new Image()` on `/`, then a navigation to
  `?page=2`: the same 10 loaded in 2-5 ms, an unloaded control file 325 ms. The disk cache keeps them
  across pages there, so loading originals a page ahead is worth it in Chrome; other browsers' cache
  settings decide for themselves, and the `nextwarm` rows answer that per browser.
- **Picture tools** (`galToolsBuild`, user v0.328.0, `G10`): ⤓ ✕ in `.tools`, ⛶ in `.tools.low` (bottom-right, v0.366.0; in fullscreen it leaves) (v0.365.0: ↗ moved to the right-click menu;
  ⛶ `galFullStart` asks `requestFullscreen` inside the press — a later call has no user activation — then
  `twGoTo(0)` / `tourFromStart(1, true, 0)` and `enterFull` once the preview is up; ✕ = `galHide('hole')`) inside the clicked
  picture's `.pic`, inset `GAL_HD + 4` from the right so the invisible resize corner stays reachable.
  Each button eats its own mousedown, or the picture's handler closes the gallery or starts a drag.
  ⤓ `galDownloadAll` queues the gallery (`galBestOf` + `saveOriginal(…, fail)` per picture; `fail` skips the
  save path's toast and open-in-a-tab fallback, or a refused batch opens hundreds of tabs). A ⧉ copy-every-address
  button was removed at the user's word (v0.329.0).
- **Download queue** (`dlq*`, user v0.331.0–v0.332.0): lives in GM storage, so it survives navigation and tab closes.
  - Keys: `hzDlJob:<id>` {href, origin, items, read: `queued`, again, note}, `hzDlSt:<id>` one char per item (0 to
    do, 1 in flight, 2 saved, 3 failed), `hzDlErr:<id>` {index: {why, n, url}} — both written only by the working
    tab; `hzDlRetry:<id>` [index] any tab asks, the working tab takes (`dlqTakeRetries`) — never write `hzDlSt` from
    another tab, the worker holds its own copy and overwrites it. `hzDlLock:<origin>` {tab, t}, `hzDlTab:<tab>`
    {o, t} presence, `hzDlFind` the Page handoff. Needs `GM_listValues`/`GM_deleteValue`. Workers check `dlqAlive`
    before every write, or a late write resurrects a cancelled job. A job with a `read` other than `queued` (v0.331.0's
    background read) is dropped.
  - **One tab per origin works it** (`dlqTick` every 2 s claims the lock, works from the second tick). Jobs run only
    in a tab of the gallery's own origin: `galLinkedHit` needs same-origin. `DLQ_LOCK_MS` 75 s, renewed before every
    download (`dlqMine`): a background tab's timers can run once a minute; with 8 s two tabs saved the same items.
    `pagehide` releases the lock. In-flight items (`1`) are redone by the next owner: a duplicate beats a lost picture.
  - **⤓ is ready as soon as any list is known** (user v0.353.0: "just read the page and give me the button, then
    preload"; reverses v0.332.0's "only once read to its end"). v0.332.0's reason — a misjudged end scrolls forever, so
    the queue never ends — is answered by the read's own cap (`GAL_GROW_MAX_MS`) bounding the job: a press while
    the read runs queues the known list with `job.growing`; `galMore` → `dlqExtend` appends what the read finds
    (`dlqStates` pads new items as `0`, so the working tab's state string is untouched); the worker's end does not
    close a job that grew or is `dlqGrowing` (stateless: `growing` and younger than the cap + slack, so a tab that
    left cannot strand it); `galGrow`'s end → `dlqGrowEnd` clears `growing`, notes an early stop, and closes a job
    that finished meanwhile. Button: `⤓ n / N+` while growing. A press on a list never read on starts `galGrow`.
    Fixture `door-search` d7 (`door-grow`, 150 mounted on scroll), preload off: ⤓ ready in 1.8 s, job 100 → 150+ →
    150, 150 unique saves, job closed.
  - Whole (`galGrown`) still decides the chip's `N` vs `N+`. Whole = the frame said
    `grown`/`reported`, or the frame gave nothing — refused, never loaded, or loaded without our script reporting (`no report …`; the user's browser, v0.338.0: eporner's frame never fired `load`) — so HTML is all there is: `galGrowWhy` `html`, a note on the job. Any other
    stop (`timed out` at `GAL_GROW_MAX_MS`, `froze`, `cancelled`) leaves it not whole: ⤓ still queues, with a note; reopening
    reads again. Presses answer with `flash()` over the button (own popover, fades at 3 s, survives mouseleave —
    the tip box does not). Queueing drops this href's finished job: its failures are in the new one.
  - **✕ and a second ⤓ ask** (`dlqAsk`, `confirm`). A finished job with failures is kept (strip "Saved n / N",
    ✕ = clear); without failures it is dropped.
  - **Failed list** (`dlFailPaint`, the strip's "n failed"): rows by gallery, `#i · why · n tries`, Retry; once a
    retry failed too (`n ≥ 2`) **Page**: `dlqFindOpen` stores `hzDlFind` and opens the gallery page; `dlqFindHere`
    on that page (same origin+path, within `DLQ_FIND_MS` 60 s) scrolls until an `img` whose any attribute or
    srcset path matches `galItemKeys`, outlines it red and flashes the reason. `dlqFinding` blocks hovers and the
    scroll-cancel while it scrolls (our scroll fires mouseover). Rows whose retry is in flight stay listed as
    "Retrying…" (`dlqRetrying`), or the list closed itself mid-retry.
  - **Leaving the site's last tab warns** (`beforeunload`, user v0.332.0: downloads pause with no tab of the site):
    only with downloads left here and no other live `hzDlTab:` of the origin. Not for a left press on a same-origin
    link, a same-origin form, or a Navigation API `navigate` to it within 3 s (`dlqNavAt`) — the queue carries on
    there. A reload, Back or a typed address cannot be told from a close, so those warn too. The text is the
    browser's own.
  - Downloads: `DLQ_WORKERS` 3, starts `DLQ_GAP_MIN..MAX` 400–1200 ms apart (Forum Stumbler's pacing). us-log `saveall`.
  - **Progress is one bar** (user, v0.340.0): saved blue, failed red, rest grey (`.pd`/`.pf`). The old segments
    used class `b` for in-flight, which the gallery sheet's `.strip .b` (button, 24 px) made tall: grep a class in
    both sheets before reusing it.
  - **Originals are fetched once, as bytes** (user, v0.340.0: "why download them a second time"): `galHqAll` and
    `galBestOf` add the gallery's hosts to `bytesHosts`; `probeImage` there fetches with GM_xhr (`bytesFor(url, true)`)
    and shows from the blob, kept in `heldBlobs` up to `HELD_MAX` 512 MB (oldest dropped with its `probeCache`/
    `bytesCache` entries, so the next ask fetches again). `saveOriginal` saves a held blob (`saveHeld`; refused →
    `saveAsServed`, which keeps the folder — `saveBlob`'s link fallback would not). A host whose bytes fail while its
    `<img>` loads goes in `bytesNoHosts` for the page. Measured why not the HTTP cache: a page `fetch` after an `<img>`
    load of the same file went to the network (Chrome, eporner), and an `<img>` in between broke even fetch→fetch reuse.
    `galFlyUpgrade` and `plKeepImage` use `display` too, or they load the file a second time.
  - **A queued gallery's bytes go to disk** (user, v0.342.0: "they don't need to download them twice"; memory dies
    with the page): the site's IndexedDB `hz-held-originals`, store `b`, key = original URL. On while this origin has
    a job with work left (`heldDiskSync`, each `dlqTick`; GM flag `hzHeldDisk:<origin>` so a site that never queued
    never opens a DB); ⤓ copies the job's held blobs in (`heldQueue`, matched by `item.hit.url`), and `holdBlob`
    writes each new one. `probeBytes(url, hold)` and `saveOriginal(quiet)` read disk before fetching; a saved picture
    is deleted, and the store is cleared once no job here has work left. `galBytesHosts` includes `item.hit.url`'s
    host, or the remembered hit is probed by `<img>` and the disk copy never asked. Site scripts can read the DB (same
    origin); it only ever holds that site's own pictures. Measured on `door-search.html` (GM_xhr stand-in counts
    requests): 40 originals fetched once; ⤓ saved 6 from memory, reload mid-queue, 28 saved from disk, 0 fetches.
    Not avoidable: a `bytesNoHosts` host (picture via `<img>`, bytes unreadable) is fetched again by the save.
  - **A worker never dies on a throw** (v0.341.0): its body is in try/catch, and `saveOriginal`'s promise is caught.
    A throw left the picture at `1` and the run looking alive, so the queue never restarted.
  - **`galBestOf` races a `SAVE_FETCH_MS` (120 s) deadline** (v0.344.0): a lookup that never settles (bare `fetch` in
    `fetchDoc`/`linkedMedia` has no timeout) held one worker forever, so `Promise.all` never ended — live on eporner,
    146/147, 0 failed, frozen 3+ min. Now it fails (`3`, retryable). A reload already recovered it (`1` → `0`).
  - **The job carries the gallery's `title`/`site`** (v0.345.0), and the kept list (`hzGalLists`) its `info`: folder and
    name come from `pageInfos`, which is in memory and filled only by the page that fetched the gallery. Any other
    saving page (bfcache after Back/Forward, another tab) fell back to the host label — live: 134 of 400 files in
    `Hover Zoom/Eporner/` named `Eporner - …` instead of `Hover Zoom/EPORNER.COM/<gallery>/`.
  - **`beforeunload` is registered only while this site has downloads left** (`dlqLeaveSync` from `dlqTick`, v0.391.0):
    a page with that listener can be refused the back-forward cache. Confirmed in Chrome (Back restored at once). A
    reload or Back re-downloading every picture in LibreWolf is its disabled disk cache (`browser.cache.disk.enable`
    false), fixed in the browser's settings, not here (user: no per-browser workarounds).
  - **`pagehide` halts this page's run** (`dlqHalt`, v0.341.0): a save in flight never calls back after a bfcache
    freeze (user: "it stalls when I hit back"); on return the ticks claim it again and `1`s are redone.
  - **In the gallery's strip while a gallery is open** (user, v0.339.0: it moved round the page as the unit
    resized): `dlStripHome` moves the `.dl` row (`dlStripEl.__row`) into `galSt.el` as its first row, above the
    page row, and back on close; `galStripDl` adds `GAL_STRIP_DL` 26 to `galStripH()`, and the change goes through
    `galStripReshape` (the unit keeps its height, the picture narrows). `galMiddle` sets `galStripDl = dlHere()`
    before sizing the hole. The row has its own mousedown for its buttons; a press elsewhere on it drags the strip.
    Its CSS is `.strip .dl …` in the gallery sheet (the row's own sheet does not reach another shadow root). Only
    the failed list stays in `dlHost`, placed over the unit.
  - **Strip** (`dlStripPaint`/`dlStripPlace`, own host, in `ours()` and `galTopAt`; `dlStripEl` is the wrapper
    holding the failed list and the strip): above the gallery's strip/picture while one is open, else flush in the bottom-right corner (no gap, user v0.357.0)
    (user v0.354.0: it was anchored over the widget wherever that was docked, so it floated mid-screen after a
    close); just above the widget (`tw.box`, not `tw.rect`) only when the widget is in that corner. Text = this origin's first job with work
    left, else its first with failures; One bar of the whole job.
    Shown only in tabs of a job's origin.
  - Fixtures: `test-pages/door-search.html` shims `GM_listValues`/`GM_download` (`window.__saved`; `window.__fail`
    a RegExp of URLs that fail); seed a `hzDlJob:` key in localStorage to drive it. ⤓ for real: set
    `galleryMiddle` in `hoverZoomSettings`, synthetic middle mousedown+mouseup on `#d7 img` (door-grow, 150).
    The hidden pane fires no scroll events, so `door-grow.html` grows for the finder only when they are dispatched.
- **Unopened galleries load at most `NEXT_VIDEOS` 3 clips ahead** (`nextRun`, user v0.331.0); opening one is the
  normal `galHqAll`. Closing a gallery drops the slideshow's buffered clips (`plVidsDrop`), which kept loading.
- **A cell's preview asks the picture's own page first** (`galLinkedHit`, v0.292.0): its `og:image`
  (same shape as the thumbnail unless the names match) or a same-named copy, the biggest wider than
  the thumbnail. nsfw.xxx profile cells: 300×533 thumbnail → the post's 960×1704.
- **Originals after a preview** (v0.387.0, user; before: every cell's original on open, v0.263.0–v0.386.0, the
  complaint then was hovering each cell and waiting): `galHqAhead` → `galHqAll` runs `galResolve` from the
  previewed picture through 2 pages ("Loading ahead"), each start paced by `ahPics`. Same probe as the hover, so `probeCache` shares an in-flight
  fetch and a hover finds the answer. **Each found original is held** (`plKeepImage`): the browser
  cache cannot be relied on to keep it (user: a hover minutes later still downloaded). `galDrop`
  cancels it (`set.hqTok`); probes in flight finish. us-log kind `origs`, one row per open, on the
  page's host, with its bytes (`b`; `transferBytes`, else `diagnose()`'s Content-Range total — one
  small range request per file, only with `logRequests`). Measured 2026-11-16: girlstop galleries
  are 30–52 MB for 41 originals.
  Each item keeps its winner (`item.hit`, v0.267.0): a hover is a `fresh` probe, which re-asks every
  settled miss, and a gallery's candidates usually start with guesses that 404 — every hover waited on
  them (spinner, 100-500 ms) even when preloaded. The kept hit is re-probed (cache) and dropped if gone.
  `debug`: `gallery preview found {ms, remembered}`.
  Open questioned (2026-11-10): first failure after it, 41 cached thumbnails on another host neither
  loaded nor failed in 2.5 s. Suspected: originals tying up that host. v0.264.0 measures it: `galHqLive`
  (in flight, how many for a closed gallery, oldest age) in the diagnostics' `at press` and trace;
  with no thumbnail in `GAL_WAIT_MS`, `galLate` waits `GAL_LATE_MS` 6.5 s more (inside the 10 s
  diagnostics timer), traces whether they came, and shows them if they did.
- **A short gallery fills itself in** (user, v0.266.0: "my goal is to just have them all drawn"; a
  notice only when that fails). Shown with fewer than the page has (at `GAL_WAIT_MS`, or late via
  `galLate`) → `galRest` waits up to `GAL_REST_MS` 15 s for the rest, retries the failed ones once
  after `GAL_RETRY_GAP_MS` 1 s (us-log kind `gthumbs`), then **one** `galBuild` with every picture that
  came — a single redraw, which the user accepted over the no-moving-pictures rule (the same `<img>`
  elements move into the new cells). Still missing → `galShortNote`: a `.short` pill (fixed, bottom
  centre, `#f9e2af`) inside `set.el`, "would not load" / "still loading after 15 s". Not a toast:
  hovering a cell replaces the tip. v0.265.0's "middle-click twice" notice is gone.
- **Safeguards** (user, v0.262.0, after gallery mode on YouTube with several tabs open crashed the
  browser — each hidden frame is a full watch page):
  - No media in the hidden frame (`galNoMedia`, run by the frame's own copy at the start of
    `galProbeReport`): every video/audio is emptied (src, `<source>`, srcObject, `load()`), every
    iframe/embed/object removed, now, on `loadstart`, and via a MutationObserver (allowed here: the
    frame lives seconds and nothing is kept). Runs at `document-idle`, so a player built before that
    may have begun fetching. Rejected: refusing pages that have a player — the user's gallery pages
    carry videos at the bottom.
  - Lag watchdog in `galRender`: a `GAL_LAG_TICK` 250 ms timer while a frame exists; firing more than
    `GAL_LAG_MS` 1 s late (tab visible) removes the frame.
  - Rejected by the user: stopping on galleries with few pictures (show whatever is there), and a
    confirm on first enable (the user can't judge whether a site is a bad idea).
- A newer open crossfades from the old set (`GAL_FADE_MS` 200). A linked page with no pictures clears it.
- **Previews on the thumbnails** (user, v0.251.0 — the use: save chosen pictures without opening the
  result). When the linked page would preview (`siteEnabledAt(href)` = the site list run on that URL)
  (`set.pv`) a cell's hover previews; otherwise the first hover toasts which site-list entry turns
  that page off (`galNoPv`, once per gallery) — the silent version cost the user a debugging round,
  because a bare-host "Disable for this site" from the previews-off era covers the galleries too.
  Cells always take the pointer while a set is up (`.live`). A cell's `mouseenter` → `galPv`: the ordinary
  `active`/`token`/`timer` hover, after `cfg.hoverDelay`, with `galResolve` = the item's `cands`
  (from the linked page's own context), then its srcsets widest first; first larger than the
  thumbnail wins, else the thumbnail; then `showViewer`. `mouseleave` cancels unless placed. None of
  `refusal()`'s gates run (no layout of that page), like harvested tour entries. `galOwns(el)` = el is
  in the gallery's shadow root; `onMove` skips `playerArrived` for it; `galHide` cancels its preview.
  The document's `onOver` never acts on the page under it: it returns while `galCur || (galOn && galWant)`.
- Presses: on the gallery (`galHost`), on our preview/backdrop (`ours`) or inside the preview keep the
  gallery, so middle-click save, pinning and click-away-from-a-pinned-preview all leave it up.
- **Saved mark** (user): a middle-click save (`midSave` → `saveOriginal(url, quiet, done)`, `done` on
  `GM_download`'s `onload`) of a gallery preview stores the thumbnail URL (`hoverZoomGallerySaved`)
  and the result's link (`hoverZoomGallerySavedFrom`), same list rules as seen. Mark = 22 px blue
  `#89b4fa` disc with a down arrow (`galSavedIcon`), top-left: `.svd` in the cell, and on the result's
  picture a `data-hz-saved` span (`galMarkSaved`). Marks are found by scanning the next 3 siblings
  (`galMarkFind`), since a picture can now have two.
- **Scroll hides it** (`galScroll`: the document or a container ≥ half the viewport tall — a carousel
  must not count). Only the user's scroll: a wheel/key within 600 ms whose event the script did NOT
  `preventDefault` (`galInputEv`; a slideshow wheel flips, it scrolls nothing). A page scroll with no such input
  while a gallery is open (scroll anchoring, the site's code) is put back to `galPageY` and the gallery stays
  (v0.419.0, user: fullscreen slideshows closed mid-wheel, logged as "You closed"). The activity line names
  the close's real reason (`ahGalClose(why)`; `GAL_USER_HIDE` decides "You closed" vs "The gallery closed").
- **Seen check** (user): a gallery opened by a press (`galPeek`: chip or middle) is seen at once (user,
  v0.343.0: ticks missing until reload — a scroll the page made in its first second hid the set, `galScroll`
  'page scrolled by itself', so the timer found it gone). The 1 s rule below now covers only a non-press show.
  Otherwise: a gallery that stays on screen `GAL_SEEN_MS` (1 s) as the current set has its
  link stored (user, v0.249.0, when galleries opened on hover: a shorter look never counts) (`hoverZoomGallerySeen`, an ordered list,
  last `GAL_SEEN_MAX` 10,000, re-read before each write so tabs don't erase each other) and every
  page `<img>` linking there gets a 24 px bare green tick (inline SVG, dark outline, no box) in a span (`data-hz-seen`) appended to the result's link (`galMarkHost`; found again by `__hzAt`),
  absolutely positioned by measuring its own containing block (`galMarkImg`; size = the larger of img and `<picture>`, `galMarkRect`, as an inline picture measures as a line box) — so no ancestor's
  `position` is changed. `galMarkAll` re-derives on boot (+1.5 s), 250 ms after a scroll or resize,
  and after each show; it holds no element references.
  Debug (`debug` on): `gallery seen` (with a storage read-back) or `gallery not counted as seen:
  hidden/replaced`; `gallery marks` (logged only when it changes) gives counts, `tooSmall`, up to 3
  drawn-but-`hidden` ticks (clipped/covered/zero size), up to 3 `small` (img and picture sizes), and `lastSeenUnmatched` + `nearestLinks` when
  the newest seen link matches no page picture.
- **Mark rules (user, v0.278.0–v0.280.0):** only the **biggest** picture linking to a result is marked
  (nsfw.xxx cards hold the profile avatar too). Corners: `galMarkPlace` lays the saved disc (top-left
  first) and the tick (top-right first) out together with `galCorners` (pure, in `test-resolver.js`):
  first corner clear of page elements and earlier marks, else beside an earlier mark, else least
  covered. Page elements = `galMarkBlockers`, read from the card's tree (link + up to 4 ancestors whose
  *shown* box, `galShownRect`, is no bigger than 2x the picture: a slider strip is N slides wide but
  shows one; nsfw.xxx slider cards keep their ↗ button 3 levels up), not hit-tested: `elementsFromPoint` failed off screen (tick drawn on
  the badge, moved after scrolling), under the link's `::before` overlay, and for `pointer-events:none`.
  nsfw.xxx: badge top-right, name bar across the bottom, so a saved card shows disc and tick side by
  side top-left (a fixed top-left disc pushed the tick onto the badge). Re-derived when any `<img>` loads (masonry relayouts move cards). `galMarkRect` clips the picture by
  every overflow-hiding ancestor up to the link: nsfw.xxx scales `.user--content` 1.1× on `:hover`,
  so the raw rect put the tick ~22 px past the card's edge, clipped off. `galHoleRect()` (the gallery's hole and
  ring) and the chip use the same clipped box. **Marks go in the link, not beside
  the picture:** nsfw.xxx's card container is a z-index 1 layer under the link's z-index 2 gradient
  `::before`, so a mark inside it was dimmed and unclickable at any z-index. z-index 3.
  **A click on a tick or saved disc clears the link** from seen, visited and saved-from (`galMarkClear`,
  capture on the mark, claims the click per `../CLICK_COLLISIONS.md`, no toast — user: the tip must
  just go). Saved-disc clearing is untested live.
  `toast()` writes into the tip's shadow text (`tipEl.__text`): writing the host's own `textContent`
  never drew, so the old tip text showed again under the pointer (fixed v0.292.0).
- **Visited = double tick** (user): two of the same ticks, 10 px apart in a 34 × 24 box, both fully
  outlined. Stored in `hoverZoomGalleryVisited` (same list rules, `galList`/`galListAdd`). **Only the
  browser loading the page counts** (user, v0.252.0): at boot, every top-frame page on a
  site with learned doors stores its own URL (storing the search page too is harmless). A link, middle-click or context-menu "Open in
  new tab" all land there; hovering, the gallery, a peek and the hidden frame (not top frame) never do. No click counting (`galClick` removed). Untested assumptions,
  true on the user's site so far: the result link is the URL that loads (no redirect / extra params)
  and the site reloads between pages (no SPA). `:visited` cannot be read by script, hence our own
  list. Visited wins over seen; a mark of the wrong kind is replaced.
- Test: the Browser pane's background tab fires **no** scroll events (`scrollBy` moves the page,
  listeners get nothing) — dispatch `new Event('scroll')` on `document` by hand.
- Backdrop (user, v0.247.0 — so the page's picture can't be taken for a thumbnail): `.shade`
  darkens the page `rgba(0,0,0,.8)` with the hole cut out (`clip-path: path(evenodd, viewport,
  hole)`, `galClip`/`galShade`); the hole is the corner where `.fly` sits, rounded by the frame's own
  `GAL_FLY_RADIUS` (v0.456.0: a square hole left the four wedges outside the curve unshaded and unblurred). **The dark starts with the flight**
  (user, v0.296.0): `galVeil(true)` in `galMiddle` puts the same shade (`.veil`, outside any set,
  `pointer-events:none` so a press while loading still closes and goes through) and the blur up at
  once; `galBuild` drops it `GAL_FADE_MS` after its set fades in, `galHide` always.
  Both live inside the set and fade with it. The page is also blurred and greyed (`blur(6px)
  grayscale(.6)`) by one shared `galBlur` with the same clip, **outside** the sets: an ancestor
  with opacity < 1 is a backdrop root, so inside the fading set the blur would show nothing
  mid-fade. It transitions `backdrop-filter`, goes on in `galShow`, off wherever `galCur` is cleared.

## Endless (v0.359.0, user; INTERACTION.md `G12`)

`cfg.galleryEndless` (remembered; ☐ Endless at the clicked picture's bottom-left (Show all galleries, `galleryEndlessViewed` / `galEndlessViewedSet`, only in the menu and Settings since v0.433.0 (user), tip `GAL_ALL_TIP`: the traffic it costs),
one word, swapped on hover for "Endless mode" / "Show all galleries" (`.s`/`.l`; user v0.424.0: keep it short, they
run the picture very small); ⓘ ↗ top-left (`.endl.top`), `galEndlessBuild`. ✕ and ⛶ rest at 60 %, full while the picture is hovered (user v0.427.0, as the preview's ✕); every
other button there and ⤓ is hidden until the picture is hovered, then fully shown (`.fd`; user v0.424.0). The readout
always shows. ⤓ greyed (page not read yet) is by colour, never opacity, or it fights the fade. Also the
right-click menu and the panel; on by default since v0.387.0, user). Code: `galEndless` … `galInfoShow`, after `galPageStep`.
- **The queue** (`galChain` {hrefs, at, land}, made in `galMiddle` by `galChainFrom` for a user's open, kept for
  a queued one: `land.href === href`): the opened door, then the doors after it in document order (`galDoorList`:
  where a chip shows, one per link, its biggest picture). **Viewed (seen ∪ visited) is judged once, when a door
  joins** (user: "if we recheck, we will skip it half way through, or on the back button") — `galChainExtend` only
  appends doors not in the queue, at the queue's end; `galChainWiden` (menu "include viewed" turned on) only adds;
  turning it off removes nothing. Every gallery the queue opens is marked seen at once (`galPeek`).
- **Moving**: `galChainGo(dir, pic)` from `galPageStep` (past the last page: after `galTourMore` brings nothing, or
  whole; before page 1), and the slideshow's three ends — `tourWall`, `tourNav` (◀ at the first picture),
  `tourSeam` — all through `galSeam` (below). It opens through
  `galMiddle` — the same read as a middle press, so the corner picture switches to that door's card. `land` = where
  to arrive: `page` (0, or 1e9 = last) and the slideshow's `pic` ('first' / 'last' / 'page' = that page's first).
  `c.land` set = a switch under way: every further press is swallowed (else a second press skips a gallery).
  `galChainLanded` (end of `galBuild`): `set.want` = the page wanted; `galLayout` lays out at `want` until reached or
  `galWhole` (backward needs every thumbnail fed: `far` raised), a user's flip clears it. A slideshow waits ≤ 6 s for
  that, then `tour.gal` = the new set and `tourGo`. Until then `tourEntries` is [] for
  the old set, so `land` must stay set through the wait.
- A queued door gone from the page is passed over; a queued gallery that fails (`galShow`: cancel / no pictures)
  → `galChainSkip`, the next one that way, else closes as before.
- **Strip** (`galChainText`; user v0.430.0): page row = a two-part switch `P:page/pages` `G:gallery/galleries`
  (`.sg`, pressed = dark + bold, `galStripPg` `{seg}` parts). `galStepG` (reset on every open and close): G: pressed =
  the row's ◀ ▶ step whole galleries (`galRowStep` → `galChainOpen` at page 0, closing any preview; "No more
  galleries" at the queue's end); ↑ ↓ PageUp PageDown always step pages (`twPageBtn`). A click on the unpressed part
  presses it, on the pressed part types (`twAsk` 'page' → `galChainPageAt`, 'gal' → `galChainJump`). P: shows this
  gallery's `page/pages` with the queue's page total beside it in grey (`.gr`, `{more}`), the typed number still counts
  across the queue. Picture row (`galStripPic`, user v0.431.0): `41 / 90` in this gallery, endless adds the queue's
  total ` (12,574)` beside it in grey, all centred (v0.430.0's "34 left of 75" with the total floated right was dropped:
  user preferred the plain count); a click asks a picture of the whole queue (`galChainPicJump`: in another gallery it
  opens the page holding it). `s.picW` is the row's widest form for `galFullW`, so the box does not resize as a count
  gains a digit; `galFullW` adds no slack beside ◀ ▶ (user v0.433.0) and counts `+` only while shown.
  `+` = some count not final. A gallery not open counts `galChainN` (its list or `hzGalCounts`) ÷ this `galPer`,
  1 page when unknown. `s.nums` {page, gal, pic, tb} feeds `twAsk`. The page row always shows in endless (`galStripRows`).
  **Tips** (user v0.433.0, only these three): P:, G: and the picture numbers say what they count; `P`/Page is
  `GAL_TIP_P` blue and `G`/Gallery `GAL_TIP_G` green in both strip and tip (`showTip` takes [text, colour] parts).
  **A switch keeps the old numbers** (user v0.433.0): while `galChain.land` points elsewhere `galStripText` leaves the
  text and only runs `galPadFit`, and `galFlyOut` skips `galStripBlank` — blanking narrowed the box, then the rows
  reshuffled when the numbers came back. `galBoxKept` also keeps the text's width.
- **The box's least width** (`galPadFit`, run by every `galStripText`; user v0.431.0: keeps the picture small): outside
  fullscreen, with the strip attached, the box is at least `galFullW()` (and `GAL_PIC_MIN_W`) wide; the picture keeps
  its height and `.fly.pad` draws it `object-fit: contain` with bars at its sides. `galPlace` and a corner drag widen the
  same way — **never make a narrow picture taller to reach a minimum width** (the old `GAL_PIC_MIN_W / asp` height floor;
  the user keeps pictures small). In fullscreen `galFullRect` sets the width; `pad` only stops the crop there.
- **Last** (`galLast`; user v0.430.0: finish this gallery without opening the next, which would mark it seen): the
  Endless box cycles Endless → Last → off (`galEndlessCycle`; menu: three radio dots). Last stops for good at the end
  of the gallery on screen — `galSeam` (note "End of this gallery: stopped (Last)", the self-playing slideshow too),
  `galPageStep` ("No more pages"), `galChainText`'s `on`/`picOn`. One flag, not tied to a gallery: forgotten on close
  or another user open (`galHide`, `galMiddle`), never saved; a G: step or typed gallery still moves (deliberate). Yellow
  box and picture count (`galEndlessLook`, `.lt`); the box stays shown unhovered while Last is on.
- The galleries ahead load per "Loading ahead" (`ahGalAhead`; replaced `galChainWarm`, which read only the next
  one's thumbnails, on the last page).
- **Closing** (`galHide`) after the queue moved on scrolls the current card into view (`behavior: 'instant'` — a
  smooth scroll would still be moving when `galFlyBack` measures) so the picture flies back to it.
- ⤓ stays per gallery (user): each switch builds a new corner picture with its own `galToolsBuild(href)`.
- **The seam in endless** (`galSeam`; user, v0.362.0 put it back after v0.360.0 took it out): a user step past a
  gallery's end holds once (`seamDir`/`SEAM_HOLD_MS`, note "Last/First picture of this gallery"); the next crosses.
  `galleryEndlessStop` (default on, menu + panel) off = crosses at once. The slideshow playing by itself
  (`user` false) never holds. Endless never wraps: at the queue's ends it stops for good, note "… of the last/first
  gallery" (none with the stop off), and the strip's ▶ (◀) is faint (`picOn`/`picBack`). No note on a switch (a
  "Gallery n of N" one was dropped: it read as the endstop).
- **Fullscreen** (user, v0.360.0: the corner picture was blown up): `galCornerRect` → `galFullRect` — bottom-right
  (`galAnchorDefault`, never the remembered place), as wide as `galFullW()` (the strip's widest line with every `n/N`
  measured as `N/N+`, digits as 8, canvas `measureText`, + ◀ ▶, gaps, padding, border), the picture as tall as that
  width gives, ≤ `GAL_FULL_FRAC` 0.45 of the screen (v0.360.0 had 0.1: portraits were cropped, user).
- **One box per window size** (`galBoxKeep` {u, W, H, asp}; `galKeepNow`, `galKept`; user v0.365.0): set at a user's open,
  a drag/resize (`galSave`) and the top of `enterFull` (before `lockScroll` widens `vpW`); reused by every refit and
  every queue switch (`galMiddle` with `land`) while the window is within 24 px of it, outside fullscreen. A picture of
  another shape keeps the height and outer edge. Recomputing from the anchor gave another size each time: it snaps to
  the current gallery's rows (a one-page gallery's own), so switches and leaving fullscreen changed it (pane: 213×214 →
  209×211; user: about double on leaving fullscreen in LibreWolf). Never re-recorded by a refit: a refit mid-transition
  (fullscreen exit, viewport not settled) would store a wrong box. A switch at a new window size records the box on
  screen first. Debug line `gallery refit {full, W, H, kept, restored}`. The pane's viewport emulation stops sending
  `resize` after a few changes: dispatch one by hand when testing this.
- **Wheel in a gallery or fullscreen**: flips; a click on the picture makes it zoom (`docs/TOUR.md`, `wheelFlips`).
- **Page row end** (user v0.424.0): the total of P (when `!ch.on`: nothing further anywhere) and of G (last gallery
  queued) turn red (`galStripPg`, `.no`); without endless the total turns red on the last page once `galWhole`. ▶
  with nowhere to go — greyed, or `galChainGo` false after `galTourMore` — shows "No more pages" in red for
  `GAL_NOMORE_MS` 2 s (`galNoMore`). A ✕ left of the page row's ▶ closes the gallery (`galHide('hole')`).
  A typed page past what is laid out sets `want`, so it lands there once loaded (it used to stop at the last page laid out).
- **Right-click menu marks** (v0.423.0, user): `item(text, kind, act)` — boolean = a drawn checkbox, `{radio}` = a dot,
  a string = an action's icon (⚙ ↗ ✕, blue text). ✕ top-right closes it. Every setting in it is also in the panel;
  `withGalIcon` draws ▦ in a label as `ICON_GALLERY` (menu and panel).
- **ⓘ box and the right-click menu**: the ⓘ box is placed off its button (above, else below, else beside:
  `galMenuShow(…, avoid)`). While it is up the next press anywhere, ⓘ included, only closes it; while the menu is
  up a press off it does the same (user v0.363.0; a press on an item still acts). `galInfoPress` is the first
  window-capture `mousedown` (bound at boot beside `midSaveClick`, so it runs before every other capture listener),
  and `galInfoAfter` eats that press's mouseup / click / auxclick / dblclick / contextmenu until the next press
  (≤ 5 s; 1.5 s let a slow click through). `galStripText` refits when that width moves
  (`galFullLast`); `enterFull`/`restoreFull` call `galRefit` (a maximise fallback fires no `resize`). No drags or
  corner resizes while `fullActive()`, and a drag there is not a click (`held`), so nothing is saved to the anchor.
- **Measure the fly where it lands, never mid-flight** (`galFlyRect()`, not `getBoundingClientRect`): `galFlyZ` (the
  picture is under the preview unless the pointer is on it) and `galStripFade` ran at a switch while the new picture
  still sat at its card, so in fullscreen both stayed hidden until the pointer moved.
- **Back into a gallery with the slideshow on** waits (≤ 6 s) for every thumbnail to be fed before it can step to
  the last picture; meanwhile `tourEntries` is [] and the old gallery's picture stayed up (user v0.365.0).
  `galLandShow` blanks the frame and swaps in the landing picture from `galLists` (`galBestOf`) at once.
  Closing then left the preview open: the old set's cells are detached, so `galOwns(active)` is false — `galHide`
  also closes when `tour.gal` is set.
- **Stepping back from the landing picture waited ≤ 6 s too** (user v0.366.0): `galWhole` also waits for the page's
  read to end (`galGrowing`), and the last thumbnails can land with no relayout. A `want` of the last page now clears on
  `galFedAll` (every listed picture in and loaded), and the land wait relays out once that holds. Fixture: 6.3 s → 0.35 s.
- **The page under the gallery follows the queue** (`galChainFollow`, user v0.366.0: fullscreen stopped half down the
  page — lazy thumbnails below were never loaded, so never doors, and an endless feed never loaded more). Each switch
  scrolls the current card to the centre; within 3 of the queue's end (and on a short queue at open, and at its end)
  the last queued card goes to the top, nudging 1 px when already at the bottom so a scroll event fires, then
  `galChainExtend` at 1.5 s and 4 s. `galSelfScrollAt` keeps `galScroll` from closing the gallery for it. A hidden pane
  fires no scroll events: test with a fixture that appends doors from wrapped `scrollTo`/`scrollIntoView`.
- Not done: the queue never crosses into the site's next page (`nextPageIn`).
- Fixture door-long (150 doors, 40 each): 2 seen → queue 148, P:1/296; ▼ past page 2 → gallery long=3; ◀ back →
  long=1's last page; slideshow ▶ 40 → 41 seamless, ◀ 1 → previous 40; typed P 231 → gallery 116; close scrolled
  to its card.

## Reading the gallery: the hidden frame first (v0.231.0)

The user's site builds its gallery by script: the plain HTML held 5 groups, the biggest the
header logo (2), so the HTML read showed only the logo and excluding it promoted the next header
picture. The user wants **the widget's own rules** (it counted 20 there and left the logo out).

`galRender(href)` loads the page in a hidden same-origin iframe (`opacity:0`, viewport-sized so
layout and lazy loading run, `sandbox="allow-scripts allow-same-origin"` = no top navigation or
popups, `allow="autoplay 'none'"`). `window.name` = `hz-gallery-probe:<token>`. Our own copy runs
in that frame (no `@noframes`); seeing the name it runs `galProbeReport()`: after `load` +
once no `<img>` has been added or changed `src`/`srcset` for `GAL_SETTLE_MS` (a MutationObserver; empty → keeps waiting; `GAL_QUIET_CAP_MS` 4 s from DOMContentLoaded sends whatever it has — v0.275.0: nsfw.xxx mounts posts in batches of 10 ~1.5 s in, a fixed 700 ms after DOMContentLoaded reported 0–2) it posts `widgetEntries()`'s `<img>`s as
plain items `{thumb, ss, cands, base}` (`galItem`). It also mutes and pauses anything that plays.
No `allow="autoplay 'none'"`: Gecko logs "Skipping unsupported feature name autoplay" for it
(removed v0.235.0; the play listener does the job).
One frame at a time (`galFrameStop`); a newer hover cancels it (`'cancel'`, not cached).

**Both reads start at once** (`galLoad`). The plain HTML wins as soon as it holds `GAL_HTML_ENOUGH`
(6) pictures — the frame is stopped. Under 6 (a logo, an avatar) **the frame decides**, however long
it takes within its own caps; if it fails, the HTML's few are shown but **not cached**, so the next
press reads again (v0.277.0). Cutting the frame off at 2.5 s (`GAL_PREFER_MS`, v0.236.0–v0.276.0)
cached nsfw.xxx's 1-picture logo read for every result: its frames take 2.5–3.3 s. The frame's copy
reports from `DOMContentLoaded`, not `load` (ads keep some pages loading forever).
Diagnose with `document.dispatchEvent(new CustomEvent('hover-zoom:gallery-state'))`: one console
line with doors/open/locked and every load's trace (`galStateText`, URLs reduced by `galSane`).

The frame **fails** → the plain HTML read below: load lands on an error page or another origin
(cross-origin links always do), the page not loaded in `GAL_FRAME_MS` (10 s), or no report
`GAL_REPORT_MS` (4.5 s) after it loaded. During that wait the previous set stays up.

- The 3 s post-load cap exists because the user saw a very long pause in their main browser
  (v0.234.0): the frame almost certainly never reported, and the wait ran the full 10 s.
- **Unverified:** whether Tampermonkey injects into a `sandbox`ed iframe (per browser). The test
  pages load the script by `<script>`, so they cannot tell. If it does not, every hover logs
  `no report 3000 ms after the page loaded`; then try dropping the `sandbox` attribute (cost:
  frame-busting scripts could navigate the user's page).

## The HTML fallback

`fetchDoc` (DOMParser runs no scripts). `galPick` groups every `<img>` by `domChain` and takes the
**largest group**: the grid shares one chain; logos, ads and "related galleries" usually sit in
another. A site whose related block shares the grid's chain will mix them.

Thumbnail URL (`galThumbOf`): a lazy attribute first (`GAL_LAZY`, then any other `data-*` whose
value ends in an image extension), else `src`, else the smallest srcset entry. Blocked URLs,
`data:`/`blob:` skipped.

- **Lazy attribute before `src`:** lazy pages give every grid `<img>` one placeholder `src`, and
  `galPick` dedupes by URL, so the whole grid collapsed to one entry and the 2-picture logo group
  won (user's site, v0.231.0). Fixture: `test-pages/gallery-lazy.html` (12 must show, no header).
- The frame's "refused" log names where it landed (v0.232.0). On the user's site it fails although
  `frame-ancestors 'self'` allows it and the fetch redirects within the origin. Cause unknown; a
  script frame-buster that navigates itself is the guess.

## Bigger size (user's rule)

After layout, if a picture's slot is more than `GAL_UPGRADE` (1.3) × the thumbnail file's width, `galBigger` lists bigger files: srcset `w` entries above the thumbnail, the
smallest one ≥ the drawn width first, then larger, then smaller; with no srcset, the resolver's
`collectCandidates` (original first). The first that loads larger than the thumbnail replaces it;
the drawn size does not change. At most `GAL_TRIES` per picture.

- `parseSrcset()` returns **URL strings, widest first — no widths**. `galBigger` parses `w`
  descriptors itself for that reason.

## Open feedback and diagnostics (user, v0.255.0)

Asked for because an open on one live site does nothing ~1 in 4 presses and a second press works.
- A peek that opens lights the result (`.pend`: blue ring, the rest dimmed by its
  200vmax shadow) until `galBuild` shows the set (`galPendStart`/`galPendClear`) — but only from
  `GAL_PEND_MS` 3 s after the press (user, v0.256.0: a normal open is under 3 s and must look as before).
- `galTrace(href, what)` records every step of every load, read-aheads included (`galTraces`, 60 links),
  so a press that hit an in-flight read still shows its earlier steps (negative ms).
- The popup (`galDiag`, copy button) opens when: nothing shows `GAL_DIAG_MS` (10 s) after the press;
  a failure ends the open early (`galHide('fail: …')` — no pictures, none loaded in `GAL_WAIT_MS`,
  load cancelled); or the hide reason is not the user's (`GAL_USER_HIDE`: press, esc, middle, ctrl,
  resize, scroll). A scroll counts as the user's only within 600 ms of a wheel, key (not
  Control), touch or left press (`galInputAt`); the middle press itself must not count, or a page
  scroll it triggers would be silent.
- Privacy: no URL leaves `galSane()` — scheme, same host / sibling subdomain / other host, path
  with letter runs → `w` and digit runs → `#`, query keys only. Trace strings never carry a URL
  (the frame's "landed on <url>" is rewritten). Element chains are `domChain()` (digits → `#`).
- Unverified: the 10 s timer path (fixture loads never hang). Candidate causes the trace separates:
  thumbnails slow (2.5 s cap, then a silent hide — a retry hits the browser cache), a cancelled
  frame, a page scroll, a covering overlay.

## Requests

Fetched pages are cached by URL (`GAL_CACHE` 300; failures are not cached). A 429/503 is logged
with `logBusy` — the host is already stored in `doorAreas`, so the log privacy rule holds.

## Test

`test-pages/door-search.html`: hover d1–d3 to learn the door area, then the chip on d4 opens
`gallery-mixed.html`. Synthetic `mouseover`/`mousemove` with `clientX/Y` learns; a synthetic
`mousedown` on the chip (`[data-hz-door]`, in the card's link) opens. `gallery-search.html` and
`gallery-masonry.html` still seed `gallerySites` (ignored now); their linked pages:
"built by script" → 25 through the frame in ~1.5 s, logo left out; A → (frame times out: A has no
script) all 40 grid pictures from the HTML, none of the 6 related; B → 10; the last → nothing. Synthetic
`mouseover` on `#ra img` works; the pane's hover coordinates are scaled (×1.28 measured), so aim
by `clientX` read back from a `mousemove` listener. Upgrade path needs cells > 260 px: emulate a
2400 × 1500 viewport; expect `photo-420x315.jpg`, not the 800.
