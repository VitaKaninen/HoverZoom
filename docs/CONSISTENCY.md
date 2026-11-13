# Consistency audit (v0.316.0, 2026-11-13)

User's goal: the preview window behaves the same however it was started and whatever it shows; the
gallery's widget is the page's widget, differing only by the clicked picture beside it. Nothing below
is built yet; it waits on the user's answers (questions at the end). Delete each row once resolved.

## Window: differences by how it opened

| # | Behaviour | Page hover / pin | Slideshow step (`commitSwap`) | Gallery step (`galPin`) | Small picture |
|---|---|---|---|---|---|
| W1 | Where it opens | `cfg.position` (auto: centre, else under pointer + `nudgeIntoReach`) | tab spot (`posLoad('spot')`) or centre | `showViewer(hit, pointer)` = `cfg.position` around the pointer (often the strip / wheel spot) | `besidePicture` |
| W2 | Hand-set size on a step | kept (`fixedW` survives) | — | lost (`unplace` + new `showViewer`) | — |
| W3 | Fullscreen across a step | kept, refit (`E57`) | — | dropped (`unplace` → `leaveFull`) | — |
| W4 | Picture not loaded yet | page's own picture at once, then rest (`tourShow`/`tourRest`) | — | old picture stays until resolved | — |
| W5 | Picture fails | page picture + reason + ↻ (`E56`) | — | `if (!hit) return` — no step, but `set.at` already moved: counter and picture disagree (bug) | — |
| W6 | Ends | stop once ("Last picture", `SEAM_HOLD_MS`), then wrap with note | — | silent wrap (waits only while not `galWhole`) | — |
| W7 | Keys | ← → ↑ ↓ [ ] step | — | ← → [ ] only; ↑ ↓ do nothing | — |
| W8 | Wheel, step rate | 50 px/step, `STEP_GAP_MS` + `tourFast` | — | 60 px/step, `GAL_FLIP_MS` | — |
| W9 | Wheel off the window | steps only if pinned, or within `wheelRange` of ⇅, or armed | — | always steps, pinned or not | — |
| W10 | Right-click on window | browser menu (ours only for bytes, `E9a`) | same | same; strip/picture = our settings menu | — |
| W11 | Kind of window | full | full | full | emoji: separate bar-less, unpinnable mini window (`E73`); avatar: press on picture does not pin |

Fix shape: send gallery steps through the slideshow's swap path (`swapViewer`/`tourShow`/`tourNav`
seams) so W2–W9 vanish; W1 = one opening rule for every window.

## Widget vs gallery strip — two separate builds

`buildTourWidget` vs `galStripBuild`. Differ in: SVG `vbtn` buttons vs text ◀ ▶ spans; tips (one help
tip on the counter vs a tip on every part); ◀ ▶ repeat when held vs not; idle counter (start number
vs `–`); ⇅ / (N) dupes / ⚠ / load count only on the page widget, `+` while reading only in gallery;
faint-until-near only on page widget; placement (shared dock, draggable, per-site) vs `in`/`dock`/`out`
modes with a ✓/✕ join prompt and its own memory (`hoverZoomGalleryAnchor.strip`); right-click menu
only on the strip. Target: one builder; in a gallery the same widget sits against the corner picture.

## Docs that contradict the code (INTERACTION.md — the user cites these IDs)

- `S05`, `T22`, `K2`, `E22`: wheel over a hover preview scrolls the page. Code (`twWheel`, `galWheel`): pins and zooms.
- `S10` "page still scrolls", `T24`: code steps pictures on a wheel off a pinned window.
- `E65` "right press on the window is our menu": code and `B1` give the browser's menu.
- `E55` ← → pan where the picture can: code — keyboard never pans.
- `E60`, `E71`: scope / post end, retired v0.313.0. `S05` placement describes `cursor` as default (it is `auto`). Header says v0.144.0.

## Possibly annoying (user to judge)

- A pinned window takes the wheel page-wide (W9): the page can't be wheel-scrolled while one is up.
- Pinning any picture turns ← → into stepping keys (`place()` → `tourStart`).
- ⇅ "armed" state: wheel steps anywhere on the page until clicked again.
- Stop-once-at-each-end hold (W6) on top of wrapping.

## Settings that are tuning knobs rather than choices

`tourWorkers`, `preloadAhead`, `preloadMB`, `tourHoldRate`, `wheelRange`, `displayScale`, `barIdleMs`,
`barFadeMs`, `fadeMs`, `shadowSize`, `shadowStrength`, `spinnerTheme`, `posPerSite`, `galleryRowMin`,
`tourFadeTo`. Position alone is 4 values + `posPerSite` + `keepClearWidget` + `keepClearStatus`.
