# Gallery mode

Hovering a result on a search/listing page floats the thumbnails of the page that result links to,
so the user can judge whether that gallery is worth opening. Look only: the floating layer is
`pointer-events:none`, nothing on it is clickable. Code: `galleryHere` … `galMove`, after `harvest`.

## Where it runs

`galleryHere()` = top frame, not a captcha, page covered by `cfg.gallerySites`, **and ordinary
previews are off here** (`!siteEnabled()`). The user's search pages are already path entries in
the site list; the galleries they lead to are not, so previews keep working there.

- `gallerySites` entries use `siteEntryMatches` (same syntax as the site list). A bare host covers
  every previews-off page on that host; a path entry narrows it. That is the answer to "a page
  where I want neither": exclude it in the site list and give `gallerySites` path entries that
  don't cover it. The user flagged the bare-host case as possibly needing a rethink later.
- Menu item `toggleGallery()` removes every entry covering the page, else adds the host.
- In `RESET_KEEPS`.

## Behaviour (user's numbers, 2026-11-09)

- At most 34 pictures (`GAL_COLS` × `GAL_ROWS` − 1; that is all those constants do now).
- **A Ctrl tap toggles it, locked on one result** (user, v0.250.0; held-Ctrl was v0.248.0-v0.249.0).
  Hovering alone shows nothing (it only preloads). A tap = Ctrl down then up with no other key,
  mouse press or wheel between (`galTap`; Ctrl+F, Ctrl+click, Ctrl+wheel never toggle), not typing.
  On: the result under the pointer (`galAt`, kept by `galOver`/`galOut` even while on; cleared on
  scroll, resize, window edge) is locked (`galOn`): no hover delay, the hole and gallery never change
  while on, and leaving the link, the window edge band and leaving the window do not hide it — so the
  pointer can go over the thumbnails. Off: another tap, Esc, a mouse press, a scroll, a resize
  (`galHide` clears `galOn`). Tap with no result under the pointer does nothing. A Ctrl tap on a
  gallery page does not run the previews hotkey toggle (`hotkeyToggle`'s keyup).
- **Layout: the hole is the picture under the pointer** (user, v0.248.0): `galSteer` on every
  `mousemove` and once at build, unless locked (`galOn`, always now); on no picture it stays. The user rejected looking past the
  hovered picture: a 3 × 3 rule picking a neighbour (v0.243.0–v0.247.0) gave no way to tell which
  page pictures were still unseen on a non-grid page. The moving slot is v0.240.0, commit de9996a
  ("take it back to here" means that).
- `galShow` loads every thumbnail first (`galImg`, up to `GAL_WAIT_MS` 2.5 s; late or failed ones are
  left out), so each shape is known **before** anything is placed — the user does not want pictures
  swimming as they load.
- `galRows(aspects, hole)`: rows of one height spread evenly over the viewport; each row's band is
  split into free segments around the hole (+ `GAL_GAP`); pictures fill segments in order, spare
  width spread evenly between them; binary search for the largest height that places every
  picture (none fits even at 8 px → the unplaced cells are hidden). Rows are one height because a
  segment beside the hole cannot be justified independently of the rows above and below.
- Resize hides the set (the hole's rect is stale). Upgrade check uses each picture's drawn width.
- **Preload** (user, v0.248.0): `galPreNext` reads every same-origin result's gallery (`galLoad`) and
  then its thumbnails (`galWarm`, into the browser cache), **one page at a time**, nearest the
  pointer first (`galPrePick`, re-derived each step, so a scroll re-orders it). Kicked at boot +1.5 s,
  250 ms after a scroll/resize, and by the end of every `galLoad`. It never starts while a frame is
  loading (`galFrameStop`), so it cannot cancel a hover's frame; a hover's frame does cancel it (that
  page is retried). Tried pages are not retried (`galPreTried`). A hover still loads its own result
  at once after `cfg.hoverDelay`. A 429/503 on any gallery fetch stops preloading for the page
  (`galPreHalt`). Logged: one `gallery` us-log row per run on the page's host (stored in
  `gallerySites`, so the privacy rule holds); the hidden frame's requests are not counted.
  `GAL_CACHE` is 300 so a long results page is not evicted while it preloads.
- Hover delay = `cfg.hoverDelay`. Off every result link for `GAL_GRACE_MS` 500 → fade out. Moving
  to another link within that time keeps the old set until the new one is ready, then crossfades
  (`GAL_FADE_MS` 200). A linked page with no pictures clears the old set.
- Esc, a mouse press, or leaving gallery-mode pages hides it.
- **The grace period is for inside the page only** (user): the pointer within `GAL_EDGE` 50 px of
  the window's edge, or leaving the window (`mouseout` with no `relatedTarget`), hides it at once.
  Hovers inside that band are ignored; coming back out of it counts as a hover on whatever is under
  the pointer (no `mouseover` fires for a move within one element).
- **Scroll hides it and locks hovering** (user): `galScroll` (document or a container ≥ half the
  viewport tall — a carousel must not count) stores the pointer as `galLock`; `galOver` ignores
  everything until `galMove` sees different coordinates, then treats that move as the hover. The lock
  exists because a scroll fires `mouseover` under a still pointer.
- **Seen check** (user): a gallery that stays on screen `GAL_SEEN_MS` (1 s) as the current set has its
  link stored (user, v0.249.0: a shorter look, a hover without Ctrl, and preloading never count) (`hoverZoomGallerySeen`, an ordered list,
  last `GAL_SEEN_MAX` 10,000, re-read before each write so tabs don't erase each other) and every
  page `<img>` linking there gets a 24 px bare green tick (inline SVG, dark outline, no box) in a span (`data-hz-seen`) inserted right after it,
  absolutely positioned by measuring its own containing block (`galMarkImg`) — so no ancestor's
  `position` is changed. `galMarkAll` re-derives on boot (+1.5 s), 250 ms after a scroll or resize,
  and after each show; it holds no element references.
- **Visited = double tick** (user): two of the same ticks, 10 px apart in a 34 × 24 box, both fully
  outlined. Stored in `hoverZoomGalleryVisited` (same list rules, `galList`/`galListAdd`). A link
  counts as visited when (a) a left or middle `click`/`auxclick` on a result link on a gallery-mode
  page (`galClick`), or (b) the page itself loads where `gallerySites` covers it but gallery mode
  is off (previews on) — that catches "open in new tab" from the context menu, but only if the
  gallery pages are covered (a bare-host entry). `:visited` cannot be read by script, hence our
  own list. Visited wins over seen; a mark of the wrong kind is replaced.
- Test: the Browser pane's background tab fires **no** scroll events (`scrollBy` moves the page,
  listeners get nothing) — dispatch `new Event('scroll')` on `document` by hand.
- Backdrop (user, v0.247.0 — so the page's picture can't be taken for a thumbnail): `.shade`
  darkens the page `rgba(0,0,0,.8)` with the hole cut out (`clip-path: polygon(evenodd, viewport,
  hole)`, `galShade`); the hole is left undimmed with a 3 px `#89b4fa` glowing `.ring` 4 px outside it.
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
`GAL_SETTLE_MS` (one retry after `GAL_RETRY_MS` if empty) it posts `widgetEntries()`'s `<img>`s as
plain items `{thumb, ss, cands, base}` (`galItem`). It also mutes and pauses anything that plays.
No `allow="autoplay 'none'"`: Gecko logs "Skipping unsupported feature name autoplay" for it
(removed v0.235.0; the play listener does the job).
One frame at a time (`galFrameStop`); a newer hover cancels it (`'cancel'`, not cached).

**Both reads start at once** (`galLoad`, v0.236.0). The plain HTML wins as soon as it holds
`GAL_HTML_ENOUGH` (6) pictures — the frame is stopped. Otherwise the frame's report wins if it comes
within `GAL_PREFER_MS` (2.5 s); after that any non-empty HTML result is used; an empty HTML waits for
the frame. Why: on the user's site the frame's page never reaches `load` (ads keep it loading), so
every hover waited the full 10 s; the user wants no wait at all. The frame's copy reports from
`DOMContentLoaded` + settle, not `load`, for the same reason.

The frame **fails** → the plain HTML read below: load lands on an error page or another origin
(cross-origin links always do), the page not loaded in `GAL_FRAME_MS` (10 s), or no report
`GAL_REPORT_MS` (3 s) after it loaded. During that wait the previous set stays up.

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

## Requests

Fetched pages are cached by URL (`GAL_CACHE` 300; failures are not cached). A 429/503 is logged
with `logBusy` — the host is already stored in `gallerySites`, so the log privacy rule holds.

## Test

`test-pages/gallery-search.html` (sets its own localStorage settings on first load):
"built by script" → 25 through the frame in ~1.5 s, logo left out; A → (frame times out: A has no
script) 34 of 40 grid pictures from the HTML, none of the 6 related; B → 10; the last → nothing. Synthetic
`mouseover` on `#ra img` works; the pane's hover coordinates are scaled (×1.28 measured), so aim
by `clientX` read back from a `mousemove` listener. Upgrade path needs cells > 260 px: emulate a
2400 × 1500 viewport; expect `photo-420x315.jpg`, not the 800.
