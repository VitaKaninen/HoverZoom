# NEXT — open work only

Start line: **"Read docs/NEXT.md and continue."** Session history is in git (`git log`), not here.
Keep this file to what is still open; delete an item the moment it is done or answered.

## Next task

None open. The preload plan (PRELOAD.md "Plan") is built through v0.460.0.

## Waiting on the user (ask only if they bring it up)

- L8 takes as many of the fetched page's pictures as this page shows in its first 2 screens (v0.459.0) — right number?
- L24: a clip cell already shows the site's still, so L24 for clips is only the label (PRELOAD.md "Built (v0.449.0)").
- Flickr album lists: covers are background `div`s with text on them, refused by `backgroundGate`; a look-through
  was tried and reverted (gained nothing). User's call whether to pursue.
- D (from 2026-11-13): one slideshow scope whatever the start (`S25`, `E60`); same frame rules pinned or touring
  (`E21` vs `growBox`). Waits on a yes.

## Not live-tested (TEST-PLAN ids; run on a real site when the area is touched)

- 7.12d–l: activity checklist, hover-cuts-only-what-it-must, cheap count, full clips, shade corners, leaving a hover
  keeps its download, L10 order, L8 singles, M10 (G: next gallery before page 2).
- ⤓ pause/resume on a hover (Chrome's `prompt()` trap, TESTING.md); a real red failure corner; the page-step
  thumbnail cut; L13's step-past jump; badge learning on eporner; Dark Reader's pinned blue after a manager update.
- Next-page finding: the finder itself checked on eporner `/cat/all/1,2,7/` (v0.461.0); TEST-PLAN 4.7's full flow
  (the activity line naming page 8) and FS/OLINT on a live site not yet run.
- LibreWolf in general (frames never load there; the user's main browser).
- Real middle press before the preview (`E79`, synthetic only); a middle press on a results-page door never saves
  (`active` is null) — known gap.

## Cleanup owed

- `download queue: title at press {…}` and `download queue: names {…}` debug lines (v0.346.0, for a misfile that has
  not recurred since): delete them.

## Shelved (do not propose unless asked)

- Keep pictures on disk across reloads: cause was LibreWolf's disabled disk cache, fixed in about:config; user wants no
  per-browser script change. Measured if revived: eporner original ≈ 2.8 MB, thumbnail ≈ 27 KB; 2 back + 2 ahead at
  1920×970 ≈ 1.2 GB; GM_xhr costs a fixed ~120–135 ms per request over `<img>`.
- Newcomer aids (first-use hints, gesture sheet, basic/advanced settings split): script is unfinished, one user.
