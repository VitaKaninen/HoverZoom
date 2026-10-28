# Hover Zoom — project notes

A single-purpose replacement for the Hover Zoom+ browser extension. **Pictures only** — no
galleries, downloads, or action keys, by design. A preview may be a muted looping clip (many
animated posts have no image form) with **our own** control strip — a native one cannot be told
apart from the picture under it. **This does not preview a video *player***: a page with a real
player refuses previews, and `videoMode` decides what may play at all. Inherits the shared rules
in `../CLAUDE.md` (version bumps, commit+push, no `innerHTML`, `#89b4fa` checkboxes).

> **[`INTERACTION.md`](INTERACTION.md) is the ID vocabulary for the preview window** — every
> state, transition, terminator and known edge, each with a permanent ID (`S05`, `T17`, `E22` …).
> The user cites those IDs in conversation instead of writing out a repro, so it must be kept
> current whenever window behaviour changes. It says in a line what each one *is*; the `docs/`
> file it points at says *why*. Do not let the two drift.

> **These notes are a record of reasons, not a veto.** They are written in a confident
> voice — "do not regress this", "settled", "decided deliberately" — because a reason that is
> not stated plainly is a reason nobody can weigh later. That voice is *not* a claim that the
> decision is permanent. The user, 2026-09-04: *"we need to not treat what is written in the notes as law. We are
> making this up as we go. Settled decisions from the past can be changed. If there is a good
> reason behind it, then we need to address it head on, not just decide that we can't do that
> because we previously decided against it."*
>
> So when a note argues against what is being asked for: **say what the old reason was, say
> whether the new request answers it, and then do the work.** Quoting the note as an objection
> and stopping there is the failure mode. A reversed decision keeps its note, carrying the argument
> in both directions.

## Start here — read ONE row, not the table

The reasoning is split so a session loads only the part it needs. **Opening them all defeats the
point**; if a task genuinely spans two, read two.

| Working on | Read |
|---|---|
| the preview window — states, geometry, the frame and its handles, dragging, zoom, the status bar, the context menu | [`docs/VIEWER.md`](docs/VIEWER.md) |
| whether something may be hovered at all — video, banner, page background, covers, the block list, a player that lands late and the wait learned for it | [`docs/GATES.md`](docs/GATES.md) |
| finding the original — URL rules, linked pages, imgur, video previews, the loading ring | [`docs/RESOLVER.md`](docs/RESOLVER.md) |
| the settings panel, stored settings, the manager's menu | [`docs/SETTINGS.md`](docs/SETTINGS.md) |
| the test page, the `debug` log, the Browser pane's many lies | [`docs/TESTING.md`](docs/TESTING.md) |
| the slideshow (`tour` in the code) and the ◀ ▶ widget that starts it | [`docs/TOUR.md`](docs/TOUR.md) — its first lines give the user's two words, *slideshow* and *widget*; §1a is the scope — what a slideshow leaves out that a hover would show |
| any banner-gate threshold | [`banner-test-sites.md`](banner-test-sites.md) — ~40 live pages measured in two browsers; every number in the gate sits next to a row |
| the widget's position, or any floating widget shared with Forum Stumbler / RNFP | [`docs/WIDGET-DOCK.md`](docs/WIDGET-DOCK.md) — the shared `dock/us-dock.js`; never edit a synced copy |
| rate limiting, a 429, the one-at-a-time list, or the request log shared with Forum Stumbler | [`docs/REQUEST-LOG.md`](docs/REQUEST-LOG.md) — the shared `shared/us-log.js`; never edit a synced copy; **log first, no new pacing logic without a log** |
| the zoom **percentage** — what it counts, and why it once moved with browser zoom | [`docs/ZOOM-UNITS.md`](docs/ZOOM-UNITS.md) |
| the user cited an ID — `S05`, `E22`, `T17`, `P4` | [`INTERACTION.md`](INTERACTION.md) says what it is in one line; then `grep -rn "E22" docs/` for the argument |

**Find code by name, not by reading the file.** `Hover-Zoom.user.js` is ~11,600 lines, and a
whole-file read costs ~150k tokens. `grep -n` for the function, then read the range around it.

### Keeping this current

New reasoning goes in the `docs/` file it belongs to, under its own heading — **not here**. This
file holds only what is true for every session, and it is capped at that on purpose: everything
below is paid by every session whether it is relevant or not.

---

## Traps that fire BEFORE you act

Each is silent — no error, just the wrong behaviour — and lives here, not in `docs/`, because by
the time you would look one up the symptom has already been misdiagnosed. (The shared ones — `innerHTML` on Trusted-Types sites, the
`const`-below-`cfg` hoisting trap, the two-userscripts-one-click contract — are in
[`../CLAUDE.md`](../CLAUDE.md).)

- **A control placed inside `.box` must be added to `isBoxControl()`.** `onBoxDown`/`onBoxClick`
  are capture listeners on the box, so they eat a child's events first. The symptom is silence,
  and `node --check` passes. See the capture-listener note in [`docs/VIEWER.md`](docs/VIEWER.md). (Anything inside `vctlEl` is already covered
  by the whole-subtree exemption; a new button in the **bar** is not — ↻ had to be added by hand.)
- **An element from a FETCHED page resolves its URLs against that page, not this one.** Anything
  reading a relative attribute off an element must go through `baseOf(el)`, which reads the
  `__hzBase` the tour's harvest stamps on it. `DOMParser` also gives the parsed document *this*
  document's base URI, so `fetchDoc()` injects a `<base>` before anything reads `img.src` or
  `a.href`. Get it wrong and every harvested URL is plausible, wrong, and 404s.
- **A test fixture that builds its own markup in a `<script>` is fetched EMPTY.** `DOMParser` does
  not run scripts, so anything the cross-page walk has to read must be static HTML —
  `test-pages/pager-*.html` are four files rather than one for exactly this reason.
- **A new reason in the status bar must invalidate the caption.** `caption()` rebuilds only when
  the URL or the measured size changes, and a tour swaps between entries that share both. Call
  `resetCaption()`. The symptom is a stale sentence over a picture it does not describe.
- **A global listener must never act on state it does not own.** `@match *://*/*` means our
  `fullscreenchange`/`resize`/key handlers fire for the PAGE's own doings on every site,
  excluded ones included — the site gates only guard previewing. v0.63.0's handler read
  `document.fullscreenElement`, found no preview, and cancelled YouTube's fullscreen. Key off
  a flag *we* set, and never undo an action we did not start. See `E35`.
- **Anything registered per-page — a menu command, a listener that writes settings — must be
  guarded on `isTopFrame`.** `@match *://*/*` with no `@noframes` means every ad iframe runs its
  own copy, and the manager lists every frame's menu commands together. Site decisions use
  `pageHost()`, never `location.hostname`. See `E29`.
- **Never write `el.title = '…'` — call `setTip(el, text)`.** The script draws its own tooltips so
  every one waits `TIP_DELAY_MS` (or its own `delay`); a `title` left on an element shows the browser's own a
  second later, under ours. See [`docs/VIEWER.md`](docs/VIEWER.md).
- **A range input fires NO `change` when the press does not move the value.** Every "held" flag
  here — `volDrag`, `seekDrag`, `zoomDrag` — is armed on `mousedown`, so clearing it only on
  `change` strands it on for the life of the preview. Clear it on the document's `mouseup`
  (`releaseSliders()`), which is the one event that always arrives. Symptom: the volume column
  will not close, or the bar will not fade, and nothing the user does recovers it. See `E38`.
- **A class that grants `pointer-events` must be removed on the path that HIDES the element**, not
  the path that lays it out. `layout()` stops running once the frame is down, so a `hot` left set
  leaves an invisible rectangle that eats clicks and blocks hover where the window used to be.
- **The shadow root's stylesheet is one namespace: grep a state class before reusing it.** `.dim`
  is the page overlay (`position:fixed;inset:0`), and a nav button toggled to `dim` for "nothing
  that way" left the flex row and sat over the counter. It faded correctly, so it read as a
  layout bug. Cost v0.102.0.
- **`[hidden]` loses to an explicit `display`.** `img[hidden]`, `video[hidden]` and `.row[hidden]`
  each need their own `display:none` rule, because the rule above sets `display:block`/`flex` and
  outranks the UA sheet. It has cost a version twice.
- **Measure the viewport with `vpW()`/`vpH()`, never `documentElement.clientHeight` directly.** On a
  quirks-mode page (no doctype) the root answers with the whole document's height. See
  [`docs/VIEWER.md`](docs/VIEWER.md).
- **Before writing a URL rule for a site, check that site's `img-src` CSP.** It applies to our
  `new Image()` probe, so on Brave / DuckDuckGo / Startpage / Qwant / Mojeek a perfectly correct rule
  decodes the right original and is then refused in a millisecond, looking exactly like a 404. One
  line in the console settles it: `new Image().src = '<any off-site image>'` and watch for a
  `securitypolicyviolation`. See `E49`.
- **An `<img>` with `srcset` reports `naturalWidth` divided by the chosen candidate's density**, not
  the file's pixels. Never compare it to a probe of the same URL for equality — `nativeSize()`
  marks it `scaled` and `samePicture()` compares the ratio instead. See `E45`.
- **The event target at a document listener is the shadow HOST**, never the element inside a shadow
  root; `composedPath()[0]` is the real one. A diagnostic that reads `e.target.getRootNode()` can
  never say "in a shadow root".
- **Under the manager the script boots AFTER the page loaded, so `twRefresh()` runs synchronously
  at boot** — anything it calls runs before every `let` declared below that point (TDZ throw, whole
  script dead: no previews, no settings). The test pages load the script while still `loading`, so
  that path is deferred there and passes. Defer new work out of boot paths (`setTimeout`). Cost v0.127.0.
- **A scroll WE make fires `mouseout`/`mouseover` under a still pointer** (measured in Chrome), so
  anything that scrolls while a resolve is pending must be guarded in `onOut`/`onOver` and the
  page-scroll `cancel()`. `tourFollow()` scrolling during a ← start cancelled it: page moved, no
  preview, intermittent by where the pointer rested (v0.135.0, `twStarting` guard).
- **Never pass `view: window` to an event constructor.** Under Tampermonkey `window` is a proxy, the
  constructor throws, and a `try` around it makes the dispatch silently never happen — the test
  pages (no sandbox) pass. Found on `primeLink`, v0.126.0.

---

## Design invariants — do not regress these

- **Nothing is cached that the DOM can invalidate.** (One exception, checked on arrival: the
  slideshow's roll keeps pictures a recycling feed unmounted — [`docs/TOUR.md`](docs/TOUR.md) §1d.)
  Everything resolves from a read taken at the
  moment it is needed — hover time for a preview, press time for next/prev. Do not add a
  MutationObserver or a pre-pass "for performance", and do not hold a reference to a page element
  across an interaction; re-derive instead. Reading the document ahead of a hover is fine, and
  `tourEntries()` does exactly that on every press — keeping the answer is what causes the bugs.
  *(Not a ban on querying the document or reading ahead: what it guards is *keeping* the answer —
  stale `src`, SPA navigation, images added after a scan, dead references. Where it bites: the
  Google Images section of [`docs/RESOLVER.md`](docs/RESOLVER.md); `coveredMedia()` hit-tests at
  hover time and caches nothing; `tourAt()` anchors on an element and a position, never an index,
  so a virtualised feed deleting the node under you is survivable.)*
- **No format allowlist.** Extension never decides eligibility. The only gate is
  `bigEnough()`, measured by loading the candidate: by default (`sizeGate` off, v0.168.0) "would
  the window draw it larger than the page does", so every picture previews, enlarged up to
  `zoomLimit` (4); with `sizeGate` on, "is it `minRatio` times what is displayed". A candidate the
  linked page *declares* skips the guessing checks but **not** that gate (v0.40.0 — see
  [`docs/RESOLVER.md`](docs/RESOLVER.md)), and the page's own file beats it when bigger.
- **No hardcoded size caps.** `minDisplayed` / `minRatio` / `smallBelow` are settings (16 / 1 / 48).
  Under `smallBelow` only avatars and emoji preview (v0.175.0, user's call — see `P14` in
  [`docs/GATES.md`](docs/GATES.md)); that replaced "nothing singles out icons or avatars".
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

## Testing

```bash
node --check Hover-Zoom.user.js     # syntax
node test-resolver.js               # 461 assertions: the pure URL and video-link logic, the
                                    # banner gate's shape test against every measured page in
                                    # banner-test-sites.md, the tour's next-page detector, the
                                    # learned wait's arithmetic and the captcha gate
node dock/test-dock.js               # the shared widget dock's layout and drops
node dock/sync-dock.js --check      # the dock copy in all three scripts matches (reads the siblings)
node shared/test-log.js             # the shared request log, and HZ's wiring of it
node shared/sync-shared.js --check  # the us-log copy in HZ and Forum Stumbler matches
python make-test-images.py          # regenerate fixtures into test-images/
```

Browser test: `python test-server.py`, then `http://localhost:8899/test-page.html`. What each case
is for, the counts, and the Browser pane's behaviours: [`docs/TESTING.md`](docs/TESTING.md).
