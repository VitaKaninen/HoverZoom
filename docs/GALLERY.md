# Galleries (peek)

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
- **Grey chip until its first page is in** (user, v0.388.0): `[data-hz-door].wait` (icon `#a6adc8`, blue `#89b4fa`
  once ready). `galThumbsReady(href)` = the first `galPer(null)` items of `galLists` all in `galThumbDone` (thumbnail
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
  doors on screen, serially, each waiting for its thumbnails (`galWarm`). `galCountNext` now runs beside it:
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
  room is taken up by expanding the images, they never go smaller"). A settings change while a
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
  (`galFlip`, PageUp/PageDown; the `.pg` row, 16 px, user: "rarely used") and ◀ picture n / N ▶
  (`galStep`, 24 px; row class `.pn` — `.pic` is the picture box's, and `.fly .pic{flex:1}`
  stretched the row); rows `justify-content:space-evenly` (user: equal gaps); `+` while reading on. **The page row shows only with 2+ pages**
  (`galStripOne`, `galStripRows`; strip `GAL_STRIP_H1` 34 vs `GAL_STRIP_H` 54). Each open starts
  with one row; the first time a set has 2+ pages it switches for good (`set.two`, so a relayout
  that fits one page again cannot flip it back and forth). An attached strip keeps the unit's
  height, so the picture narrows (the side nearer the window edge stays). The remembered `hf` counts
  the full 54 px (`galSave`, and `galPlace` adds the difference back), so either strip gives the
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
  is `galFlip`; ↑ ↓, PageUp/PageDown and the wheel off the preview are `galPageStep` (with a slideshow
  up it goes to that page's first picture; past the last it loads more). The wheel never scrolls the
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
- **Reading on** (`galGrow`, after `galBuild` of a locked open): `galRender(href, onMore, onEnd)` names
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

What loads ahead follows what the user does. Code: the `ah*` functions after `galWarm`, constants beside
`GAL_HQ_PAR`. Terms: **gallery** = the middle-click view (code: peek); **gallery preview** = the hover view.

- **Pacing** (`ahGate`): every background start waits for a slot; starts are a random `AH_PIC_GAP` 50–200 ms
  apart for pictures (≤ `GAL_HQ_PAR` 6 in flight), `AH_PAGE_GAP` 300–800 ms for page reads (Forum Stumbler's gap,
  ≤ 4). In flight settles at download time ÷ gap, so a faster line has *fewer* overlapping, the rate stays human.
  Order (`ahPri`): the open gallery (`gal` thumbnails, `galo` originals) → counts → the main page. `ahDrop(tag)`
  resolves a tag's waiting slots to null (callers skip). A hidden tab starts nothing. Measured on `door-long`:
  picture starts 58 / 141 / 453 ms (min / median / max).
- **Main page** (`galPreNext` → `ahMainPick`, no gallery or preview up; v0.397.0, user 2026-11-26): page reads for every
  door all the time (`galCountNext`, HTML only, nearest the middle first — the read *is* the count and the thumbnail
  list, there is no separate count). From `ahAnchor` (the hovered door, else the first on screen) on in page order,
  one job at a time, in **rounds** (v0.415.0, user: "28 galleries of thumbnails over 2 minutes before any full size
  is not how a person uses a site"; numbers expected to change with testing): round r = for each door in page
  order, its next `AH_THUMBS_STEP` 10 thumbnails then its original r+1 (`ahRound` = rounds done per door; `ahOrig` →
  `galResolve` on a stand-in, `plKeepImage`), until `AH_THUMBS_MAIN` 30 thumbnails = 3 rounds (so 3 originals). The
  ▦ chip still turns blue only once the last round's thumbnails are in (`galFirstIn`).
  Then, after a gallery preview, the door after it gets its whole first page of thumbnails (`ahLookLast`,
  `ahNextDone`); then frame reads to the end (`galGrow`, the expensive `19+` → `40`) last of all (`ahIdleGrow`, once
  per door). Thumbnails already settled are skipped. The ▦ chip turns blue at the 30 (`galThumbsReady`); a preview
  loads the rest of its page itself. Endless off: thumbnails for the first door + `AH_THUMBS_OFF` 3, originals for
  the first only, the rest once ≥ `AH_SHARE` 40 % of the page's doors are seen. Measured on eporner (Chrome, cold):
  page reads ~0.4 s, 30 thumbnails ≈ 4 s a door, an original ≈ 1.1 s with 6 in flight. The covers' own originals
  (`pgFill`, `hoverPreload`) wait while counts are in flight (`galCountsBusy`) — user: revisit later.
- **Scrolling** (`ahScrollNote` from `galScroll`, checked ≤ every 200 ms): the next door to load scrolled above the
  viewport = behind → `ahDrop('main')` and nothing new starts (counts go on). Still for `AH_STILL_MS` 250, then
  `AH_HOVER_WAIT_MS` 1000 for a hover: the hovered door becomes the anchor, else the first door on screen. A job cut
  by the drop (`ahGen` changed) is un-done so it loads again later.
- **Gallery preview** (`galLookOpen`, `galLook`): a door hovered `AH_LOOK_MS` 500 lays out its first page of
  thumbnails around it, the door left in place as the hole (`galHole` = its rect, `galBars` → hole only). Inert:
  the set never gets `live` (no cell events), no strip (`galLayout` skips `galPageNote`/`galFeed`), never marked
  seen (seen shapes the endless queue), no originals, upgrades or frame. Closes on leaving the door (`galMove`), a
  page scroll, the pointer leaving the window (`galPtLeft`, from the document `mouseout` with no `relatedTarget`: a fast
  exit sends no `galMove` outside the door, so it also clears `galHoverTimer` and sets `galPtOut`, which
  `galLookOpen` refuses until the next move — else the timer opened it at the stale `galPt`), a left press (the link is followed), or any other hover (`onOver` — it ran `return` for an open
  gallery and swallowed the next door's mouseover). Middle press / chip from it opens the gallery (`galMiddle`
  closes it first; `galChipOpen` ignores it). Wheel and keys stay the page's.
- **Storage readout** (user, v0.394.0): `galStoreTick`, `.hzst`, bottom-right of the gallery's own picture — the
  hovered door (`galHole`, fixed in `galTop`) for a preview, the corner box `galFly.pic0` once open (**not**
  `galFly.pic`: that is the page's own `<img>`). Lines: RAM = `heldBytes`; ahead ≈ `plKeep` bytes not in `heldBlobs`
  (an estimate from pixels, `PL_BYTES_PER_PX`); disk = `navigator.storage.estimate().usage` (the whole origin). Ticks
  each second while `galLook`/`galCur`/`galWant`; started from `galShow`, `galLookOpen`, the `galCur` set and the fly's
  creation (a closing preview's `galHide` removes it on a timeout that can land after the gallery opened); `.fly:hover`
  lifts it over ⛶.
- **Load all** (`cfg.galleryLoadAll`, default on, v0.397.0; ☐ Load all above ☐ Endless on the clicked picture, and
  Settings → Galleries): the open gallery's originals load at once — `ahG.origs` true from `ahGalOpen`, `galHqAhead`
  from the page on screen through every built cell, then stand-ins for the list's unbuilt rest, then the
  `KEEP_BACK_PAGES` behind it. A hover on a picture not loaded yet (`hqTried` unset) restarts the run there (jumps
  the queue). Page steps never stop it; a queue switch (`galBuild`, new href) starts the new gallery from its
  start. Turned off mid-gallery: `galo` dropped, nothing new until a preview. Off = the data-saver rules below
  (originals from a preview on; a forward page step stops them, also the step past a gallery's end).
  The clicked picture is never under `GAL_PIC_MIN_W`×`GAL_PIC_MIN_H` 196×130 (`galPlace`, drag `lo`, `galBoxKept`):
  measured, the stacked checkboxes (11 px in, 77 wide, 54 tall) and the storage readout (81×51, raised 38 px on
  hover over ⛶) need 181×127.
  A run stops starting more (`memory full`) within 3 s of the memory keep dropping a picture *ahead*
  (`keepFullAt`); the next layout/page step/preview resumes it.
- **Memory keep** (`keepTrim`, user 2026-11-26; replaces HELD_MAX / plBudget's oldest-first): `heldBlobs` (exact
  bytes) and `plKeep` (estimated, `PL_BYTES_PER_PX` — over-counts JPEGs ~3×, so the cap uses held bytes where
  present) as one set. Gallery entries (`keepItem` url → item) are placed on the open queue (`keepPlaces`, linear
  over the queue's lists); behind the user = dropped past `KEEP_BACK_PAGES` 2 pages or `KEEP_BEHIND_MS` 5 min
  behind. Over `cfg.galleryKeepMB` (1024): behind first (farthest first), then the farthest ahead. Everything
  else: `cfg.keepMB` (512), oldest first. Under 8 GB `deviceMemory`, each cap ≤ 128 MB per GB. A dropped
  original's item loses `hqTried`, so a backward run loads it again. Runs on every add and each storage-readout
  tick (1 s). Verified on eporner with a 64 MB cap: 361/666 then `memory full`.
- **Gallery, endless** (`ahG`, made in `galMiddle` unless a queue switch, dropped in `galHide`): thumbnails
  (first 2 pages) of the next `ahAheadN` galleries — 2, 5 once the user steps forward or reaches gallery 2,
  10 from gallery 3 (`ahGalAhead`, run on every landing and page step, and when Endless is ticked). With Load all
  off, originals only after a preview
  (`ahSaw` from `galPv` and from `tourGo` in a gallery): `galHqAhead` = from the previewed picture through 2
  pages on (only what `galFeed` has built); within reach of the end, the next gallery's first page too. A
  forward page step outside a slideshow = skipping: originals stop (`galo` dropped) until the next preview. A
  backward step puts the `AH_BACK` 5 before it first; forward resumes after. Closing the gallery drops `gal`
  and `galo` and the main page restarts from the first door on screen.
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
- **No tooltips on the picture, its corners, its ⤓ ⛶ ✕ or the strip** (user, v0.339.0: "constantly popping
  up"). Their text is a "Using the gallery" section at the foot of the menu (`.lb.hp`). Don't add `setTip` back there.
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
- **Next page** (`nextCheck` … `nextWarmReport`, user v0.325.0–v0.327.0): within a screen of the
  bottom of a page with learned doors, idle (`nextIdle`: no preload, frame, gallery or slideshow), and
  going through it — `nextEngaged`: galleries ticked since arrival ≥ `NEXT_SHARE` (20 %) of those
  unticked at arrival (`nextTicked`, snapshot at boot; ticks = seen ∪ visited, re-read from GM so
  other tabs count) — it reads `nextPageIn()`'s page and loads its first `NEXT_GALLERIES` (3)
  unticked doors: `galLoad`, `galWarm`, then every original through `galResolve` on a stand-in img,
  4 at a time, pausing while not idle. Once per page; a skim (0 opened) loads nothing and asks again
  on the next scroll. Lists + hits + file URLs go to `sessionStorage` `hzNextPage`; the next page
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
  must not count).
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
  darkens the page `rgba(0,0,0,.8)` with the hole cut out (`clip-path: polygon(evenodd, viewport,
  hole)`, `galShade`); the hole is the corner where `.fly` sits. **The dark starts with the flight**
  (user, v0.296.0): `galVeil(true)` in `galMiddle` puts the same shade (`.veil`, outside any set,
  `pointer-events:none` so a press while loading still closes and goes through) and the blur up at
  once; `galBuild` drops it `GAL_FADE_MS` after its set fades in, `galHide` always.
  Both live inside the set and fade with it. The page is also blurred and greyed (`blur(6px)
  grayscale(.6)`) by one shared `galBlur` with the same clip, **outside** the sets: an ancestor
  with opacity < 1 is a backdrop root, so inside the fading set the blur would show nothing
  mid-fade. It transitions `backdrop-filter`, goes on in `galShow`, off wherever `galCur` is cleared.

## Endless (v0.359.0, user; INTERACTION.md `G12`)

`cfg.galleryEndless` (remembered; ☐ Endless at the clicked picture's bottom-left, ⓘ top-left (`.endl.top`), `galEndlessBuild`; also the
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
- **Strip** (`galChainText`): `P:page/pages · G:gallery/galleries`, `G:picture/pictures · T:picture/pictures`
  (`+` = some count not final). A gallery not open counts `galChainN` (its list or `hzGalCounts`) ÷ this `galPer`,
  1 page when unknown. P and G are plain numbers: `twAsk` reads the first `\d+/`; a typed page maps across the queue
  (`galChainPageAt`). The page row always shows in endless (`galStripRows`).
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
