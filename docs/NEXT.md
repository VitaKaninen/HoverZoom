# Next work — handoff (2026-11-09, session ended at ~320k tokens)

## What the user is doing with gallery mode

An infinite-scroll image search site; each result opens a gallery page of 10-100 pictures. They hunt
for specific viewpoints and save matches. Gallery mode exists so they never open the result: open a
result's gallery on the search page, hover a thumbnail for the full preview, middle-click to save.
Ticks (seen / visited / saved) are how they skip results already checked. Design detail and
reasons: [`GALLERY.md`](GALLERY.md).

## Done this session (v0.246.0 → v0.252.0, all committed and pushed)

- Backdrop: page 80 % dark, blurred + greyed; the open result undimmed with a blue ring.
- Hole = the picture under the pointer (3 × 3 neighbour rule removed).
- Open: Ctrl tap or middle-click on a result, locked to it; close: tap, middle-click on it, left
  press on the page, scroll, Esc, resize. Middle-click on another result switches.
- Every same-origin result's gallery and thumbnails preload one page at a time.
- Seen = gallery on screen 1 s. Visited = the browser loading the page (no click counting).
- Locked thumbnails preview (`galPv`) when the linked page would; middle-click on the preview saves
  and adds a blue saved mark to the thumbnail and the result. No picture cap.
- Gallery button (top-right dock widget) on `gallerySites` sites switches gallery mode per site,
  remembered until toggled (v0.254.0); off = the page untouched. Site list moved to Settings → Advanced. Thumbnails whose page
  the site list turns off now say so on hover.

## Not verified

All tests ran on `test-pages/` with synthetic events, never in Tampermonkey on the user's site. Open
questions only the user's browser answers:
- Does LibreWolf + Tampermonkey fire `GM_download`'s `onload`? If not, the saved mark never appears;
  fix by marking at click time.
- The user reported no thumbnail previews on their site; most likely a site-list entry covering the
  galleries (v0.253.0 now names it in a toast). Not confirmed.

## Last exchange

The user asked for the button + middle-click + navigation visited; it was built and reported. No
question is outstanding. The user said redirects and SPA navigation do not apply on their site.
