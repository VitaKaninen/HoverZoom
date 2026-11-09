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

- At most 34 pictures (`GAL_COLS` × `GAL_ROWS` − 1). The grid is sized to the count (v0.233.0,
  user: "fill the available space"): `galGrid(n)` tries every column count for n + 1 cells and keeps
  the one that draws a `GAL_ASPECT` (4:3) picture largest. Chosen once per set (`set.grid`) and
  again only on resize — the user wants placement settled first, not pictures swimming as
  thumbnails load. Spare cells sit at the end. The cell under the pointer stays empty; pictures
  fill the others in reading order and slide one slot when the pointer changes cell (CSS
  transform transition) — that is the "move out of the way".
- Hover delay = `cfg.hoverDelay`. Off every result link for `GAL_GRACE_MS` 500 → fade out. Moving
  to another link within that time keeps the old set until the new one is ready, then crossfades
  (`GAL_FADE_MS` 200). A linked page with no pictures clears the old set.
- Esc, a mouse press, or leaving gallery-mode pages hides it.

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
One frame at a time (`galFrameStop`); a newer hover cancels it (`'cancel'`, not cached).

The frame **fails** → the plain HTML read below: load lands on an error page or another origin
(cross-origin links always do), or no report in `GAL_FRAME_MS` (10 s). During that wait the
previous set stays up.

- **Unverified:** whether Tampermonkey injects into a `sandbox`ed iframe. The test pages load the
  script by `<script>`, so they cannot tell. If it does not, every hover logs `gallery frame: no
  report in 10000 ms` and falls back; then drop the `sandbox` attribute (cost: frame-busting
  scripts could navigate the user's page).

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

After the thumbnail loads it is drawn to fit its cell. If that is more than `GAL_UPGRADE` (1.3) ×
the file's width, `galBigger` lists bigger files: srcset `w` entries above the thumbnail, the
smallest one ≥ the drawn width first, then larger, then smaller; with no srcset, the resolver's
`collectCandidates` (original first). The first that loads larger than the thumbnail replaces it;
the drawn size does not change. At most `GAL_TRIES` per picture.

- `parseSrcset()` returns **URL strings, widest first — no widths**. `galBigger` parses `w`
  descriptors itself for that reason.

## Requests

Fetched pages are cached by URL (`GAL_CACHE` 30; failures are not cached). A 429/503 is logged
with `logBusy` — the host is already stored in `gallerySites`, so the log privacy rule holds.

## Test

`test-pages/gallery-search.html` (sets its own localStorage settings on first load):
"built by script" → 25 through the frame in ~1.5 s, logo left out; A → (frame times out: A has no
script) 34 of 40 grid pictures from the HTML, none of the 6 related; B → 10; the last → nothing. Synthetic
`mouseover` on `#ra img` works; the pane's hover coordinates are scaled (×1.28 measured), so aim
by `clientX` read back from a `mousemove` listener. Upgrade path needs cells > 260 px: emulate a
2400 × 1500 viewport; expect `photo-420x315.jpg`, not the 800.
