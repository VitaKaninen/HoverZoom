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

- Grid 7 × 5 over the viewport (`GAL_COLS`/`GAL_ROWS`); the cell under the pointer stays empty,
  so at most 34 pictures. Pictures fill the other cells in reading order; when the pointer changes
  cell they slide one slot (CSS transform transition) — that is the "move out of the way".
- Hover delay = `cfg.hoverDelay`. Off every result link for `GAL_GRACE_MS` 500 → fade out. Moving
  to another link within that time keeps the old set until the new one is ready, then crossfades
  (`GAL_FADE_MS` 200). A linked page with no pictures clears the old set.
- Esc, a mouse press, or leaving gallery-mode pages hides it.

## Picking the gallery from the fetched page

`fetchDoc` (DOMParser, so **a gallery built by JavaScript comes back empty** — nothing shows; the
debug log says `gallery: no pictures`). `galPick` groups every `<img>` by `domChain` and takes the
**largest group**: the grid shares one chain; logos, ads and "related galleries" usually sit in
another. No learning yet: a site where the related block shares the grid's chain will mix them.
If that happens, the next step is the learned-structure pattern from `../CLAUDE.md` with the user
teaching the grid, not a hardcoded selector.

Thumbnail URL (`galThumbOf`): `src`, else a lazy attribute (`GAL_LAZY`), else the smallest srcset
entry. Blocked URLs, `data:`/`blob:` skipped.

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
A → 34 of 40 grid pictures, none of the 6 related; B → 10; the third → nothing. Synthetic
`mouseover` on `#ra img` works; the pane's hover coordinates are scaled (×1.28 measured), so aim
by `clientX` read back from a `mousemove` listener. Upgrade path needs cells > 260 px: emulate a
2400 × 1500 viewport; expect `photo-420x315.jpg`, not the 800.
