# Gallery mode

Hovering a result on a search/listing page floats the thumbnails of the page that result links to,
so the user can judge whether that gallery is worth opening. Look only: the floating layer is
`pointer-events:none`, nothing on it is clickable. Code: `galleryHere` … `galMove`, after `harvest`.

## Where it runs (user, v0.252.0)

- `gallerySites` (Settings → Advanced → Gallery mode; `RESET_KEEPS`) = the sites that get the **gallery
  button**, a 26 px docked widget (`galBtnBuild`, dock id `hover-zoom-gallery`, own per-site position
  in `hoverZoomGalleryDock`, first placed top-right). Menu item `toggleGallery()`: "Show / Hide gallery
  button on this site" (removes every entry covering the page, else adds the host). Elsewhere nothing
  shows, nothing preloads, nothing listens for Ctrl or the middle button.
- The button (`galToggle`) turns gallery mode on/off **for the site** (user, v0.254.0): hosts in
  `hoverZoomGalleryHosts` (GM storage, own key, survives Reset), read synchronously, so on until the
  button is pressed again on that host, in every tab; open tabs follow via `GM_addValueChangeListener`.
  Cost: a gallery opened in a new tab on the same host is also in gallery mode (the reason v0.253.0
  used per-tab `GM_saveTab`; v0.252.0 was per host + path). The user chose per site over that.
- `galleryHere()` = top frame, not a captcha, `galleryActive()`. **While active, ordinary previews
  are off on that page** (`siteEnabled()` is false; the slideshow widget hides). Off = the page as it
  is without gallery mode. Seen/visited/saved marks show either way (`galMarkAll` needs only the list).
- `galOnHosts` / `GAL_ON_KEY` are `var`s: `siteEnabled()` reads it and can run before its line.
## Behaviour (user's numbers, 2026-11-09)

- Every picture the page has (`GAL_MAX` = Infinity, user v0.251.0: galleries run 10-100 and a cap
  silently hid the rest; more pictures = smaller cells).
- **A Ctrl tap toggles it, locked on one result** (user, v0.250.0; held-Ctrl was v0.248.0-v0.249.0).
  Hovering alone shows nothing (it only preloads). A tap = Ctrl down then up with no other key,
  mouse press or wheel between (`galTap`; Ctrl+F, Ctrl+click, Ctrl+wheel never toggle), not typing.
  On: the result under the pointer (`galAt`, kept by `galOver`/`galOut` even while on; cleared on
  scroll, resize, window edge) is locked (`galOn`): no hover delay, the hole and gallery never change
  while on, and leaving the link, the window edge band and leaving the window do not hide it — so the
  pointer can go over the thumbnails. Off: another tap, Esc (with no preview up), a left press on the
  page (not on the gallery or a preview; middle and right presses leave it up), a scroll, a resize
  (`galHide` clears `galOn`). Tap with no result under the pointer does nothing. A Ctrl tap on a
  gallery page does not run the previews hotkey toggle (`hotkeyToggle`'s keyup).
- **Middle button, one-handed** (user, v0.252.0), only while gallery mode is on: a middle press on a
  result (`galMiddle`) opens its gallery locked, as a Ctrl tap does; on the open result (the one in
  the ring) it closes it; on another result it switches. `preventDefault` on the press (no
  autoscroll; also over the gallery itself), and `galMidEat` swallows that press's
  mouseup/auxclick/click (no new tab; `galMidAt`, reset by every press). Any modifier (Ctrl+middle =
  new tab) goes to the browser. A middle press on the preview is still `midSave` (window capture,
  runs first). Visited is not touched by any of it.
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
  then its thumbnails (`galWarm`, into the browser cache), **one page at a time** (`galPrePick`,
  re-derived each step, so a scroll re-orders it): results in the window nearest the pointer, then
  below it by distance, then above; only within `GAL_AHEAD` 3 screens below / `GAL_BEHIND` 1 above
  (user, v0.256.0: sites load 1.5-5 screens of results; keep ~3 ahead). A lazy `<img>` with no size
  yet is measured by its link's box — skipping it (pre-v0.256.0) left everything below the fold
  unread. Kicked at boot +1.5 s, 250 ms and 2 s after a scroll/resize (the second for results a
  site appends late), and by the end of every `galLoad`. Throughput is the limit (one frame + its
  thumbnails at a time, ~1-5 s each); going parallel is new pacing, so log first. It never starts while a frame is
  loading (`galFrameStop`), so it cannot cancel a hover's frame; a hover's frame does cancel it (that
  page is retried). Tried pages are not retried (`galPreTried`). A hover still loads its own result
  at once after `cfg.hoverDelay`. A 429/503 on any gallery fetch stops preloading for the page
  (`galPreHalt`). Logged: one `gallery` us-log row per run on the page's host (stored in
  `gallerySites`, so the privacy rule holds); the hidden frame's requests are not counted.
  `GAL_CACHE` is 300 so a long results page is not evicted while it preloads.
- **Originals on open** (user, v0.263.0 — hovering each cell then waiting for its fetch was the
  complaint): when a set is built and its thumbnails preview (`set.pv`), `galHqAll` runs `galResolve`
  on every cell, `GAL_HQ_PAR` 4 at a time, in cell order. Same probe as the hover, so `probeCache`
  shares an in-flight fetch and a hover finds the answer (and the browser cache the file). `galDrop`
  cancels it (`set.hqTok`); probes in flight finish. us-log kind `origs`, one row per open, on the
  page's host. No pacing beyond the 4: log first.
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
  browser — every tab follows the per-site on-state, and each preload frame is a full watch page):
  - Only the tab in view preloads: `galPreNext` returns while `document.visibilityState` is hidden;
    going hidden cancels the preload's frame, coming back resumes.
  - No media in the hidden frame (`galNoMedia`, run by the frame's own copy at the start of
    `galProbeReport`): every video/audio is emptied (src, `<source>`, srcObject, `load()`), every
    iframe/embed/object removed, now, on `loadstart`, and via a MutationObserver (allowed here: the
    frame lives seconds and nothing is kept). Runs at `document-idle`, so a player built before that
    may have begun fetching. Rejected: refusing pages that have a player — the user's gallery pages
    carry videos at the bottom.
  - Lag watchdog in `galRender`: a `GAL_LAG_TICK` 250 ms timer while a frame exists; firing more than
    `GAL_LAG_MS` 1 s late (tab visible) removes the frame, `galPreHalt('froze')`, and a 3 s toast.
  - Rejected by the user: stopping on galleries with few pictures (show whatever is there), and a
    confirm on first enable (the user can't judge whether a site is a bad idea).
- Hover delay = `cfg.hoverDelay`. Off every result link for `GAL_GRACE_MS` 500 → fade out. Moving
  to another link within that time keeps the old set until the new one is ready, then crossfades
  (`GAL_FADE_MS` 200). A linked page with no pictures clears the old set.
- Leaving gallery-mode pages hides it.
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
  The document's `onOver` never acts on the gallery: previews are off while gallery mode is on.
- Presses: on the gallery (`galHost`), on our preview/backdrop (`ours`) or inside the preview keep the
  gallery, so middle-click save, pinning and click-away-from-a-pinned-preview all leave it up.
- **Saved mark** (user): a middle-click save (`midSave` → `saveOriginal(url, quiet, done)`, `done` on
  `GM_download`'s `onload`) of a gallery preview stores the thumbnail URL (`hoverZoomGallerySaved`)
  and the result's link (`hoverZoomGallerySavedFrom`), same list rules as seen. Mark = 22 px blue
  `#89b4fa` disc with a down arrow (`galSavedIcon`), top-left: `.svd` in the cell, and on the result's
  picture a `data-hz-saved` span (`galMarkSaved`). Marks are found by scanning the next 3 siblings
  (`galMarkFind`), since a picture can now have two.
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
  absolutely positioned by measuring its own containing block (`galMarkImg`; size = the larger of img and `<picture>`, `galMarkRect`, as an inline picture measures as a line box) — so no ancestor's
  `position` is changed. `galMarkAll` re-derives on boot (+1.5 s), 250 ms after a scroll or resize,
  and after each show; it holds no element references.
  Debug (`debug` on): `gallery seen` (with a storage read-back) or `gallery not counted as seen:
  hidden/replaced`; `gallery marks` (logged only when it changes) gives counts, `tooSmall`, up to 3
  drawn-but-`hidden` ticks (clipped/covered/zero size), up to 3 `small` (img and picture sizes), and `lastSeenUnmatched` + `nearestLinks` when
  the newest seen link matches no page picture.
- **Visited = double tick** (user): two of the same ticks, 10 px apart in a 34 × 24 box, both fully
  outlined. Stored in `hoverZoomGalleryVisited` (same list rules, `galList`/`galListAdd`). **Only the
  browser loading the page counts** (user, v0.252.0): at boot, every top-frame page on a
  `gallerySites` site stores its own URL (the tab's on-state is not known yet at boot; storing the
  search page too is harmless). A link, middle-click or context-menu "Open in
  new tab" all land there; hovering, the gallery, middle-click-to-gallery and the hidden preload
  frame (not top frame) never do. No click counting (`galClick` removed). Untested assumptions,
  true on the user's site so far: the result link is the URL that loads (no redirect / extra params)
  and the site reloads between pages (no SPA). `:visited` cannot be read by script, hence our own
  list. Visited wins over seen; a mark of the wrong kind is replaced.
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

## Open feedback and diagnostics (user, v0.255.0)

Asked for because an open on one live site does nothing ~1 in 4 presses and a second press works.
- A middle press or Ctrl tap that opens lights the result (`.pend`: blue ring, the rest dimmed by its
  200vmax shadow) until `galBuild` shows the set (`galPendStart`/`galPendClear`) — but only from
  `GAL_PEND_MS` 3 s after the press (user, v0.256.0: a normal open is under 3 s and must look as before).
- `galTrace(href, what)` records every step of every load, preloads included (`galTraces`, 60 links),
  so a press that hit an in-flight preload still shows the preload's earlier steps (negative ms).
- The popup (`galDiag`, copy button) opens when: nothing shows `GAL_DIAG_MS` (10 s) after the press;
  a failure ends the open early (`galHide('fail: …')` — no pictures, none loaded in `GAL_WAIT_MS`,
  load cancelled); or the hide reason is not the user's (`GAL_USER_HIDE`: press, esc, middle, ctrl,
  resize, mode off, scroll). A scroll counts as the user's only within 600 ms of a wheel, key (not
  Control), touch or left press (`galInputAt`); the middle press itself must not count, or a page
  scroll it triggers would be silent. `galMissed`: a middle press whose target is no result but has
  one under it (`elementsFromPoint`) — an overlay covering the result.
- Privacy: no URL leaves `galSane()` — scheme, same host / sibling subdomain / other host, path
  with letter runs → `w` and digit runs → `#`, query keys only. Trace strings never carry a URL
  (the frame's "landed on <url>" is rewritten). Element chains are `domChain()` (digits → `#`).
- Unverified: the 10 s timer path (fixture loads never hang). Candidate causes the trace separates:
  thumbnails slow (2.5 s cap, then a silent hide — a retry hits the browser cache), a cancelled
  frame, a page scroll, a covering overlay.

## Requests

Fetched pages are cached by URL (`GAL_CACHE` 300; failures are not cached). A 429/503 is logged
with `logBusy` — the host is already stored in `gallerySites`, so the log privacy rule holds.

## Test

`test-pages/gallery-search.html` (sets its own localStorage settings on first load; click the
gallery button top-right once, or nothing happens — the on-state is not part of those settings):
"built by script" → 25 through the frame in ~1.5 s, logo left out; A → (frame times out: A has no
script) all 40 grid pictures from the HTML, none of the 6 related; B → 10; the last → nothing. Synthetic
`mouseover` on `#ra img` works; the pane's hover coordinates are scaled (×1.28 measured), so aim
by `clientX` read back from a `mousemove` listener. Upgrade path needs cells > 260 px: emulate a
2400 × 1500 viewport; expect `photo-420x315.jpg`, not the 800.
