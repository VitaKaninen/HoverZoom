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

- **Peek**: a left press on a door's chip (`galChipClickable`, capture on the chip) peeks, or closes
  the open one; where `siteEnabled()`, a plain middle press on `doorAt()` does too, but only with `cfg.galleryMiddle` (default off, user
  2026-11-12). Both set
  `galPeek` and call `galMiddle()`. A door whose `galKindOf()` is `results` gets neither. While `galPeek`, a Ctrl tap closes it (and `galPeekTapAt` keeps the previews hotkey from also
  toggling), `galScroll` runs. `onOver` returns while `galCur || (galOn && galWant)`: with previews
  on, the page under the set would otherwise preview through the gaps. `galHide` clears `galPeek`.
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
  on screen only (was every cell).
- **The strip** (user, v0.299.0–v0.303.0; replaced the top `.pg` line): one element for every
  gallery (`galSt`, built once by `galStripBuild`, filled by `galStripText`): ◀ Page n / N ▶
  (`galFlip`, PageUp/PageDown; the `.pg` row, 16 px, user: "rarely used") and ◀ picture n / N ▶
  (`galStep`, 24 px); `+` while reading on. **The page row shows only with 2+ pages**
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
- **Two layers** (v0.302.0): cells, veil and pending glow in `galRoot` (`galHost`, z max − 1); the
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
- **Stepping** (`galStep`): wheel anywhere (also over the preview — Ctrl + wheel over a pinned one
  zooms it, elsewhere the browser zooms), ← → [ ] (always step in a gallery, never pan), the picture
  row. From the preview's picture, else `set.at` (last viewed/stepped) if on the page on screen, else
  the page's first (last going back); wraps; the page follows. `galPin` keeps the old pinned preview
  until the next is resolved (no blink) and pins it; `place()` skips `tourStart` for a gallery
  picture. `galWheel` on `CAP_TARGET` capture, before `onPinWheel`: 60 px of delta, one step per
  `GAL_FLIP_MS`. **It eats the wheel always** (user, v0.295.0): a page scroll closed the gallery,
  which then also stopped the reading.
- **Closing no longer stops the reading** (user, v0.297.0): it runs to its end (`GAL_GROW_MAX_MS`) so
  a reopen has the later pages; a hover read-ahead or another open still replaces it (`galRender`
  stops the busy frame) and the reopen then reads again.
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
  others `#`/`w` — /user/PogiOne vs /user/x); **anything else is the gallery's own** (no evidence
  = keep reading, as before). `GAL_FOREIGN_END` 4 such pictures in a row end the reading.
  Not used (tried in v0.298.0's draft): `galLeafAt` on the shape's links — a video post's page has
  no bigger *picture*, so it called the gallery's own video posts "more thumbnails" and cut a
  37-post gallery at 15. Every verdict and the end reason go into the open's trace as `frame: …`
  (`notes` on the frame's messages; `hover-zoom:gallery-state` prints them) — the frame's own
  `dbg` never reaches the console.
- Why the 683-picture gallery showed 9–15: the frame reported once, 4 s after load, and the page
  mounts posts as it is scrolled. Unverified on nsfw.xxx itself.

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
- **A left click or middle press on it closes** (v0.294.0: middle had stopped closing once the hole
  left the card — the document handler's middle branch only `preventDefault`s presses on our layer;
  the `.fly` listener closes and sets `galMidAt` so `galMidEat` eats the auxclick). Left closes on
  release without a 4 px move (`galEditDown`), since a drag moves it.
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
- **Read-ahead**: hovering a door, after `cfg.hoverDelay`, reads its gallery (`galLoad`) and warms its
  thumbnails (`galWarm`). `GAL_CACHE` 300.
- **Preload** (`galPreNext`, user v0.297.0, `cfg.galleryPreload` on): the first page (`galLoad` +
  `galWarm`, never the reading on) of every door **on screen** that shows a chip (kind settled, not
  `results`), same origin, one at a time, nearest the pointer first; kicked after each `galMarkAll`
  (boot, scroll, new results) and each frame's end. Waits while any frame is busy (`galFrameStop`,
  `galGrowing`) or a gallery is wanted or open — `galRender` would kill that frame. Stops for the
  page on a 429/503 or a frozen page (`galPreHalt`); a hidden tab stops its frame. Logged as one
  `gallery` row in `us-log`. The v0.291.0 retirement removed the old whole-page one only because it
  belonged to gallery mode (`galPreTried` = tried this page).
- **A cell's preview asks the picture's own page first** (`galLinkedHit`, v0.292.0): its `og:image`
  (same shape as the thumbnail unless the names match) or a same-named copy, the biggest wider than
  the thumbnail. nsfw.xxx profile cells: 300×533 thumbnail → the post's 960×1704.
- **Originals on open** (user, v0.263.0 — hovering each cell then waiting for its fetch was the
  complaint): when a set is built and its thumbnails preview (`set.pv`), `galHqAll` runs `galResolve`
  on every cell, `GAL_HQ_PAR` 4 at a time, in cell order. Same probe as the hover, so `probeCache`
  shares an in-flight fetch and a hover finds the answer (and the browser cache the file). `galDrop`
  cancels it (`set.hqTok`); probes in flight finish. us-log kind `origs`, one row per open, on the
  page's host. No pacing beyond the 4: log first.
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
- **Seen check** (user): a gallery that stays on screen `GAL_SEEN_MS` (1 s) as the current set has its
  link stored (user, v0.249.0: a shorter look never counts) (`hoverZoomGallerySeen`, an ordered list,
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
  covered. Page elements = `galMarkBlockers`, read from the card's tree (link + up to 2 ancestors no
  bigger than 2x the picture), not hit-tested: `elementsFromPoint` failed off screen (tick drawn on
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
