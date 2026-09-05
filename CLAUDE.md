# Hover Zoom — project notes

A single-purpose replacement for the Hover Zoom+ browser extension. **Pictures only** — no
galleries, downloads, or action keys, by design. It said *images* only until v0.18.0; the preview
may now be a muted looping clip, because a large class of animated posts has no image form at all
and "no video" meant "no answer" for them. That is a display capability, not a change of purpose:
nothing here plays sound, offers controls, or previews a video *player*. Inherits the shared rules in
`../CLAUDE.md` (version bumps, commit+push, no `innerHTML`, `#89b4fa` checkboxes).

> **[`INTERACTION.md`](INTERACTION.md) is the ID vocabulary for the preview window** — every
> state, transition, terminator and known edge, each with a permanent ID (`S05`, `T17`, `E22` …).
> The user cites those IDs in conversation instead of writing out a repro, so it must be kept
> current whenever window behaviour changes. It says in a line what each one *is*; the `docs/`
> file it points at says *why*. Do not let the two drift.

> **These notes are a record of reasons, not a veto.** They are written in a confident
> voice — "do not regress this", "settled", "decided deliberately" — because a reason that is
> not stated plainly is a reason nobody can weigh later. That voice is *not* a claim that the
> decision is permanent. Said by the user, 2026-09-04, after two changes were reverted in the
> session that shipped them: *"we need to not treat what is written in the notes as law. We are
> making this up as we go. Settled decisions from the past can be changed. If there is a good
> reason behind it, then we need to address it head on, not just decide that we can't do that
> because we previously decided against it."*
>
> So when a note argues against what is being asked for: **say what the old reason was, say
> whether the new request answers it, and then do the work.** Quoting the note as an objection
> and stopping there is the failure mode. v0.31.0 is the worked example — it reverses two of
> v0.30.0's decisions, and both notes now carry the argument in both directions rather than
> being deleted.

## Start here — read ONE row, not the table

The reasoning behind this project is ~35k tokens. It is split so a session loads the part it
needs. **Opening all five defeats the point**; if a task genuinely spans two, read two.

| Working on | Read |
|---|---|
| the preview window — states, geometry, the frame and its handles, dragging, zoom, the status bar, the context menu | [`docs/VIEWER.md`](docs/VIEWER.md) |
| whether something may be hovered at all — video, banner, page background, covers, the block list | [`docs/GATES.md`](docs/GATES.md) |
| finding the original — URL rules, linked pages, imgur, video previews, the loading ring | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| the settings panel, stored settings, the manager's menu | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| the test page, the `debug` log, the Browser pane's many lies | [`docs/TESTING.md`](docs/TESTING.md) |
| any banner-gate threshold | [`banner-test-sites.md`](banner-test-sites.md) — ~40 live pages measured in two browsers; every number in the gate sits next to a row |
| the user cited an ID — `S05`, `E22`, `T17`, `P4` | [`INTERACTION.md`](INTERACTION.md) says what it is in one line; then `grep -rn "E22" docs/` for the argument |

**Find code by name, not by reading the file.** `Hover-Zoom.user.js` is ~4,200 lines and half of
it is comment prose, so a whole-file read costs ~58k tokens. `grep -n` for the function, then read
the range around it.

### Keeping this current

New reasoning goes in the `docs/` file it belongs to, under its own heading — **not here**. This
file holds only what is true for every session, and it is capped at that on purpose: everything
below is paid by every session whether it is relevant or not. `INTERACTION.md` is the user's own
lookup for state IDs and is cited in conversation, so it must be updated whenever window
behaviour changes.

---

## Traps that fire BEFORE you act

Each of these is silent — no error, no visible failure, just the wrong behaviour. They are here
rather than in a `docs/` file because you cannot look them up after the fact; by then the symptom
has already been misdiagnosed once. (The shared ones — `innerHTML` on Trusted-Types sites, the
`const`-below-`cfg` hoisting trap, the two-userscripts-one-click contract — are in
[`../CLAUDE.md`](../CLAUDE.md).)

- **A control placed inside `.box` must be added to `isBoxControl()`.** `onBoxDown`/`onBoxClick`
  are capture listeners on the box, so they eat a child's events first. The symptom is silence,
  and `node --check` passes. See the section below.
- **Anything registered per-page — a menu command, a listener that writes settings — must be
  guarded on `isTopFrame`.** `@match *://*/*` with no `@noframes` means every ad iframe runs its
  own copy, and the manager lists every frame's menu commands together. Site decisions use
  `pageHost()`, never `location.hostname`. See `E29`.
- **A class that grants `pointer-events` must be removed on the path that HIDES the element**, not
  the path that lays it out. `layout()` stops running once the frame is down, so a `hot` left set
  leaves an invisible rectangle that eats clicks and blocks hover where the window used to be.
- **`[hidden]` loses to an explicit `display`.** `img[hidden]`, `video[hidden]` and `.row[hidden]`
  each need their own `display:none` rule, because the rule above sets `display:block`/`flex` and
  outranks the UA sheet. It has cost a version twice.
- **Measure the viewport with `vpW()`/`vpH()`, never `documentElement.clientHeight` directly.** On a
  quirks-mode page (no doctype) the root answers with the whole document's height. See
  [`docs/VIEWER.md`](docs/VIEWER.md).
- **The Browser pane is Chromium; a Firefox-only layout fault is invisible to every check made
  here.** Give any absolutely positioned box holding a form control an explicit width — shrink-to-fit
  diverges between engines. See [`docs/TESTING.md`](docs/TESTING.md).
- **The Browser pane reports `innerWidth`/`clientHeight` as ZERO while hidden**, and delivers zero
  animation frames while claiming to be visible. Pin a viewport with `resize_window` before
  measuring anything geometric, and never use `requestAnimationFrame` for something that must
  animate. More of these in [`docs/TESTING.md`](docs/TESTING.md).

---

## Why this exists

Hover Zoom+ (extesy/hoverzoom) zooms some images on a page and silently ignores others. That is
not a settings problem. Its generic fallback, `prepareDownscaledImages()` in `js/hoverzoom.js`,
gates every bare `<img>` behind five hardcoded rules, none of them user-configurable:

1. `src.toLowerCase().lastIndexOf('.jpg') != src.length - 4` — **only `.jpg`, and only when the
   extension is the final 4 characters.** Rejects `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`, and
   any URL with a query string (`photo.jpg?w=400`).
2. not `document.body.firstChild`
3. must carry an explicit width/height/max-width/max-height
4. `if (widthAttr > 300 || heightAttr > 300) return;` — thumbnails displayed over 300px are dropped
5. natural size must be `> displayed * 1.8`

Plus two defects in the same block:

- **Global single-slot lock.** `if (document.body.querySelector('#hzDownscaled') !== null) return;`
  — only one image can be measured at a time, and the handler is `.one('mouseover')`, so an image
  hovered while another probe is in flight is skipped permanently. Added by the maintainer in
  commit `b47d17a` (2021-07-29) as a performance fix.
- **No `error` handler on the probe element.** If a probe's src fails to load, `#hzDownscaled` is
  never removed and the guard above blocks *every* remaining image on the page for good.

Reported upstream and still open: [#395](https://github.com/extesy/hoverzoom/issues/395)
(query strings, 2018, zero comments), [#888](https://github.com/extesy/hoverzoom/issues/888)
(`.jpg` only, 2022), [#779](https://github.com/extesy/hoverzoom/issues/779) (generic zoom, 2021).
The repo is active but effort goes to per-site plugins — 399 of them in `plugins/`; the generic
path has been touched twice ever, both times in 2021.

---

## Design invariants — do not regress these

- **Nothing is decided before hover time.** Two delegated listeners on `document`; everything
  resolves when the pointer arrives. This is the whole architectural difference from HZ+ and it
  removes an entire bug class (lazy-loaded src, SPA navigation, images added after load, scan
  races). Do not add a MutationObserver or a pre-pass "for performance", and never bind state to
  an element that might change under it.
  *(Previously worded "no DOM scanning, ever", which reads as a ban on ever querying the document
  and is broader than the thing being protected — a read performed AT hover time, binding
  nothing, has none of those failure modes. See the Google Images section of
  [`docs/RESOLVER.md`](docs/RESOLVER.md) for where the distinction actually bites, and
  `coveredMedia()` for one that is squarely inside the rule: a
  hit-test of the pointer's own position, done at hover time, caching nothing.)*
- **No format allowlist.** Extension never decides eligibility. The only gate is
  "is the candidate actually bigger than what's displayed", measured by loading it. A candidate
  the linked page *declares* skips the guessing checks but **not** the `minRatio` gate (v0.40.0
  reversed the v0.19.0 exemption — see [`docs/RESOLVER.md`](docs/RESOLVER.md)).
- **No hardcoded size caps.** `minDisplayed` / `minRatio` are settings; the defaults are 16 / 1,
  and `minDisplayed` is the ONLY size gate — nothing separately singles out icons or avatars.
- **Per-element probe state.** No shared lock, no `.one()`. `probeCache` is keyed by URL and
  every probe has both `onload` and `onerror`.
- **Build UI with `createElement` + `textContent`.** Trusted Types CSP sites (YouTube, Google)
  throw on `innerHTML` and abort the function mid-build with no visible error.
- **`view` + `reflow()` + `layout()` own all viewer geometry.** `view` is the only state,
  `reflow()` derives frame size and clamps the pan offsets, `layout()` is the only thing that
  writes to the DOM. Nothing else may set `box`/`img` styles or the two representations drift.
  Since v0.18.0 the frame has two possible faces and `layout()` writes to whichever `mediaEl`
  points at — the rule is unchanged, only what it writes *to* is.

---

## Gotcha: a capture listener on the box eats its own children's events

`onBoxDown`/`onBoxClick` are capture listeners on `.box`, and a control inside the box is a
*child* of it — capture descends from the ancestor, so those two run first and their
`stopPropagation()` keeps the child's own handlers from ever firing. Found on the X button, which
looked correct, hovered correctly, and did nothing. Both handlers now `return` early on
**`isBoxControl(e.target)`**, which is the one list of exempt controls — just the ⊘ now that the
⋮ button is gone (v0.12.0) and the X with it (v0.34.0). Any new control placed inside the box
goes in there — it is not optional, and the symptom is silence. Found 2026-09-03 in browser testing; nothing
static catches it — `node --check` passes and the markup is fine.

---

## Testing

```bash
node --check Hover-Zoom.user.js     # syntax
node test-resolver.js               # 160 assertions: the pure URL and video-link logic, plus
                                    # the banner gate's shape test against every measured page
                                    # in banner-test-sites.md
python make-test-images.py          # regenerate fixtures into test-images/
```

Browser test: `python test-server.py`, then open `http://localhost:8899/test-page.html`. 41 cases,
11 of which HZ+ rejects outright. (`.claude/launch.json` wraps the same command as
`hover-zoom-test`, but `.claude/` is gitignored — a fresh clone has only the direct command.)

The rest of the testing notes — what each case is for, and the Browser pane's behaviours — are in [`docs/TESTING.md`](docs/TESTING.md).

---

## Known limits

- HZ+'s 399 plugins encode genuine per-site knowledge (Pixiv's referer requirement, Instagram's
  URL signing, Twitter's `:orig`). The generic resolver wins on the long tail and loses on a few
  hostile sites. Add narrowly-scoped rules to `UPGRADES` only with host checks and negative tests.
- The resolver keeps probing past the first hit and upgrades the preview in place each time
  something strictly bigger turns up. It costs up to `MAX_PROBES` (8) requests per hover instead of
  usually one. This was `keepSearching` (before that `preferLargest`, off) and is unconditional
  since v0.39.0: the whole point is to end up with the best size, so stop-at-first-hit was a switch
  for turning the feature off.
