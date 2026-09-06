# Review brief — Hover Zoom v0.77.0

The script is feature-complete and the known bugs are out. Two jobs, in this order:

1. **Inspect it for problems** — anything that is wrong, fragile, dead, or slow.
2. **Tighten the settings copy** — fewer words, same information.

Report first. Change nothing until the findings have been picked over.

---

## Before you touch anything

- Read `CLAUDE.md` here **and** `../CLAUDE.md`. The traps listed at the top of both are silent ones
  — no error, no visible failure — and every one of them has already cost a version.
- `Hover-Zoom.user.js` is 4,776 lines. **`grep -n` for the function, then read the range.** A
  whole-file read is ~58k tokens.
- `INTERACTION.md` is the ID vocabulary (`S05`, `T17`, `E22`…). Cite IDs; `grep -rn "E22" docs/`
  finds the argument behind one. The `docs/` table in `CLAUDE.md` says which file to open — read
  one row, not the table.
- **Comment budget: one line per function, and it is not being spent.** Do not add explanatory
  comments; reasoning goes in `docs/`.
- The notes are written in a confident voice but they are **reasons, not law**. If one argues
  against a change worth making, say what the old reason was, say whether it still holds, and then
  make the case. Quoting a note as a veto is the failure mode.

## Job 1 — the inspection

### Where the bugs in this script actually live

**State and lifecycle** — this has been the source of most of them.

- Inventory every module-level mutable flag (`drag`, `tap`, `mouseDown`, `swallowMenu`,
  `swallowNextClick`, `barOver`, `volDrag`, `seekDrag`, `zoomDrag`, `placed`, `fullPrev`,
  `scrollLock`, `suppressed`, `active`, `token`, `timer`…). For each: who sets it, who clears it,
  and **is there any exit path that skips the clear**. A stranded flag is invisible and
  unrecoverable without a reload (`E38`).
- Every `addEventListener` has a matching removal on every teardown path, and the add/remove use
  the same node constant. A capture listener left on the wrong node eats every click on the page.
- Classes that grant `pointer-events` (`hot`) must be dropped on the path that **hides** the
  window, not the path that lays it out.
- Async: a resolve callback landing after `cancel()`/`unplace()`, a timer that outlives the state
  that started it, an upgrade arriving during teardown.
- References held after the element is gone — `active`, `suppressed`, `probeCache` growth on a
  long-lived SPA page.

**Correctness edges**

- Degenerate geometry: `natW`/`natH` of 0, an SVG with no intrinsic size, quirks mode (`vpW`/`vpH`),
  a viewport smaller than `MIN_FRAME`, an enormous original, `displayScale` other than 1.
- Fullscreen exits we do not start: the browser's own Escape, the page going fullscreen on its own,
  `unplace()` while full, `scrollLock` restoring inline styles that were not ours (`E35`, `E42`,
  `E43`).
- Video: audio must never outlive the preview; muted default; per-site volume; rate and seek state
  reset between clips.
- Settings: the `const`-below-`cfg` TDZ trap (a `catch` returning `{}` silently), values outside
  their range, keys from an older version, the cross-tab change listener.
- Resolver: probe cache keying, `MAX_PROBES`, the referrer-less path, `GM_xmlhttpRequest` failure
  and timeout branches, `blockList` wildcard matching.
- The click-claim contract with the other userscripts (`../CLAUDE.md`) — still stamped and still
  read.

**Hygiene**

- No `innerHTML` anywhere (Trusted Types sites abort mid-build, silently). No `el.title =` — tips
  go through `setTip()`. Every control inside `.box` is in `isBoxControl()`. Checkboxes `#89b4fa`.
- Any `catch` that swallows and returns a plausible default without a `console.warn`.
- Dead weight: unused constants and functions, settings keys nothing reads, `@grant` entries the
  code never calls, docs describing things that no longer exist.
- Firefox: it is never exercised here. Absolutely positioned boxes holding a form control need an
  explicit width; check prefixed APIs and anything relying on Chromium shrink-to-fit.
- Performance: what runs per `mousemove` (`elementsFromPoint`, `getBoundingClientRect`, forced
  layout), and behaviour on a page with thousands of images.

### Out of scope

The design invariants in `CLAUDE.md` — nothing decided before hover time (no MutationObserver, no
pre-pass), no format allowlist, no hardcoded size caps, per-element probe state, `view` + `reflow()`
+ `layout()` owning all geometry. The banner-gate thresholds are **measured** against ~40 live pages
(`banner-test-sites.md`); do not retune a number without a row to justify it. No new features.

## Job 2 — the settings

The panel builds around lines 4200–4780: `section`, `advanced`, `check`, `num`, `pick`, `color`,
`list`. Also in scope: the 21 `setTip()` tooltips, the "How it works" guide, the list sections'
descriptions/examples/placeholders, the manager's menu labels, and the footer.

- **Cut every word the label already says.** A hint answers "what does this change for me", not how
  it works, and holds one fact.
- Fix the drift: some hints are sentence case and some start lowercase (`displayScale`,
  `fadeMs`, `shadow`); `(default: X)` is on most `num` rows and missing from others
  (`borderColor`, `barMode`, the `pick`s); trailing periods are inconsistent; several hints are
  bare fragments (`'in px. (default: 1)'`).
- Check the labels themselves for jargon and consistency — `Required upsize`, `Display scaling`,
  `Maximum window size`, `Opening zoom limit`.
- Confirm every knob still does something, is reachable, and applies live to an open preview.
  Report orphans rather than deleting them.
- **Do not rename storage keys** — they are persisted. Labels and hints only; a key that genuinely
  needs renaming needs a migration, so flag it instead.

## How to report

- Findings ranked P0 (wrong behaviour) → P1 (wrong in an edge case) → P2 (polish). Each one:
  `file:line`, one sentence saying what is broken, and the concrete steps or input that trigger it.
  **If you cannot name the trigger, do not file it** — no speculative findings.
- Settings copy as a table: key | current | proposed.
- Once the fixes are agreed: bump `@version` (semver minor), `node --check Hover-Zoom.user.js` and
  `node test-resolver.js` (213 assertions) green, then commit and push per `../CLAUDE.md`. Update
  `INTERACTION.md` if window behaviour changes.

## Verifying a claim

`python test-server.py`, then `http://localhost:8899/test-page.html` — the test page loads the
script itself, so no manager is needed.

**The automated browser surfaces lie**, and `docs/TESTING.md` lists how. Screenshots can come back
blank while the preview is up; `innerWidth`/`clientHeight` read 0 while the pane is hidden; real
fullscreen cannot be entered at all; `requestAnimationFrame` never fires. Read state out of the DOM
instead — `document.getElementById('hover-zoom-host').shadowRoot.querySelector('.box').className`
is the fastest ground truth — and drive the pointer with real events.
