# Testing notes and the debug log

What each test-page case is for, the `debug` setting, and the long list of Browser-pane behaviours that will otherwise waste a session. The commands themselves are in [`../CLAUDE.md`](../CLAUDE.md).

## Diagnostics — the `debug` setting (v0.13.0)

Off by default and silent when off. It exists for the one class of bug that cannot be reasoned
about from the source: **"it behaves differently in my browser than in yours."** Every gate in
this script is a DOM read, so only the DOM in front of the user can say which one fired.

- `dbg('loaded', …)` at boot prints the **installed version**, via `GM_info.script.version` so it
  cannot drift from the header. The settings panel shows the same string in its heading. For a
  "works in Chrome, not in Firefox" report, *is the installed copy even current* is the first
  question and this is how it gets answered without opening the manager.
- `hoverReport()` prints one line per hover: what was under the pointer, `videoGate` (which of the
  four video rules fired, or none), whether an `<a href>` ancestor was findable **at all**, how
  many laid-out `<video>` elements the page has, and whether the element sits in a shadow root.
- `videoReason()` returns a *string* rather than a boolean for exactly this — `inVideoContext()`
  is now a `!!` wrapper over it. Keep it that way; a boolean cannot be reported.

Two lessons from reading the first real report back (2026-09-03, v0.14.0 fixed both):

- **Every path that paints a preview must log**, and every path that rejects one as well.
  `resolve()`'s `showEvenIfNotLarger` fallback (deleted in v0.43.0) called `onHit` with no
  `dbg('hit', …)`, so a hover that *did* show something produced no `hit` line at all. A log with
  a silent success path is worse than no log: it reads as positive evidence that nothing was
  shown. The boot line prints `minRatio` and `minDisplayed`, because "no hit line" means nothing
  without them — and v0.43.0 gave the main loop's `bigEnough()` rejection its own `dbg` for the
  same reason, since `minRatio` below 1 is now the diagnostic for "why does this not preview".
- **Print positions, not just sizes.** The first `hoverReport` logged `1903×798` for the page's
  video and left the actual question unanswerable — gate 0 tests the element's centre against the
  video's *rectangle*, so a video of exactly the right size sitting somewhere else looks identical
  in the log to one directly under the pointer. Each video now prints `x,y w×h` plus its own
  verdict (`[CONTAINS the pointer target]` / `[does not contain it]` / `[too small, skipped]`), so
  the gate's decision is readable rather than inferred. General rule: **log the operands of the
  comparison, not a summary of one of them.**

**`closestAcross()` — `closest()` does not cross a shadow boundary.** Neither does
`parentElement`. A site that builds its cards from custom elements can put the `<img>` inside a
shadow root and the `<a>` that wraps it outside, and the video-**link** gate then sees no link at
all and cannot fire. The composed walk (ordinary `closest()`, then hop to `getRootNode().host` and
continue) is what the gate uses now. This is a real gap regardless of which browser exposed it;
`collectCandidates` still uses plain `closest()` and is a candidate for the same treatment if an
ancestor-link candidate ever comes back missing on a shadow-DOM site.

- **Cases 39–41 are the banner gate** (v0.38.0), and all three must start within `BANNER_TOP`
  (300 px) of the document top or they test nothing — 41 is a row of two bands that must both
  preview, 39 is the banner with four decoys beside it that must not, 40 is a one-column gallery
  that must. The vertical budget is part of the fixture: measured at 1265 px they sit at 87, 172
  and 263 px down. Re-measure with the probe in [`banner-test-sites.md`](../banner-test-sites.md)
  after editing that block, and note the shape half of the gate is asserted offline in
  `test-resolver.js` against ~40 real pages, so a threshold change fails there by site name.
- **Cases 29–35 are the v0.21.0 gates**, and 30/31 are the ones that fail loudly if the cover
  walk is loosened: 30 puts two pictures under one cover (must show nothing), 31 puts text over a
  background (must not reach through to it). 35 lives **outside** the `.grid`, because the whole
  point of it is spanning the window — inside a `.case` box its padding put it at 98.26 % of the
  viewport, passing the 98 % test by 0.3 % and proving nothing.
- **To test a real site's card shape without installing anything, rebuild it in the test page.**
  The Browser pane blocks `http://localhost` requests from an `https` origin
  (`ERR_BLOCKED_BY_CLIENT`), so the script cannot be injected into a live site from here.
  Constructing the site's markup with its real cross-origin URLs inside `test-page.html` at
  runtime exercises the entire pipeline — cover walk, `UPGRADES`, the video probe — against the
  actual files. That is how gifwow was verified.
- **`test-server.py`, not `python -m http.server`.** It is the same static server plus
  `?slow=<seconds>`, which stalls that one response. Nothing else can reproduce the symptom that
  motivated the resolve spinner: against localhost every probe finishes in single-digit ms, so
  a slow resolve — the state the user actually sees as "hovering does nothing" — is otherwise
  unreachable. Case 15 uses it. It is threaded, or one `?slow=` would block the whole page.
- **The page defines GM stand-ins** (`GM_getValue`/`GM_setValue`/`GM_addValueChangeListener`/
  `GM_registerMenuCommand`) over `localStorage` before loading the script, so the settings panel
  opens from a button in the corner instead of the manager menu. `GM_addValueChangeListener` is
  wired to the `storage` event, which is genuinely cross-tab: open the page twice and the
  settings-staleness path below is reproducible for real.
- Case 14 is the only fixture whose original (800×600) is smaller than the viewport cap, so it
  is the only one that exercises the "frame grows before the image spills" branch of `reflow()`.
  Every other case has a 1600×1200 original, which opens already clamped to the cap.
- Case 16 is the `?imgurl=` shape — a 32px icon wrapped in an `/imgres?imgurl=…` viewer link.
- **Case 20 is the only case where a progressive upgrade is VISIBLE**, and it exists because
  "it never upgrades" was reported as a bug. Its `data-src` is probed first and already clears
  the gate, so the preview opens at 800×600; the ancestor link is bigger again but carries
  `?slow=3`. Measured: preview at 1085 ms, ring docks at 2077 ms, swap to 1600×1200 at 4400 ms.
  Every other upgrade on the page resolves inside one frame, which is exactly why the feature
  looks absent in normal use — see `INTERACTION.md` `E8`.
- **`test-server.py` honours `$PORT`** (default 8899) and `.claude/launch.json` sets
  `autoPort: true`, so two sessions can each run their own copy. Without that the second
  session's `preview_start` just fails on the first session's server, which it cannot stop.
- **The Browser pane's screenshots came back blank/stale for a whole session** (2026-09-03)
  while `document.elementFromPoint` proved the content was there — same family as the
  zero-rAF problem below. Verify by reading DOM state and computed style, not by looking.
  Also note the pane letterboxes the emulated viewport: screenshot coordinates were 800×446
  against a 1280×720 CSS viewport, a 0.625 scale factor that must be applied to every
  coordinate taken from `getBoundingClientRect()`.
- **Driving the script with synthetic `MouseEvent`s works and is far cheaper than coordinates.**
  Nothing checks `isTrusted`, so `dispatchEvent` on the element (plus a `mousemove` on `document`
  to set `pointer`) exercises the real handlers — including the pointer-transparent place path, by
  dispatching `mousedown`/`mouseup`/`click` at `document` inside the frame's rect. Do the whole
  sequence in **one** `javascript_tool` call: each round trip to the pane costs ~700 ms, which is
  longer than most of the timings being measured.
  - **Once the window is PLACED, dispatch into the shadow root, not the document.** A placed
    window is hit-testable, and `document.elementFromPoint` returns the shadow **host**, whose
    events never propagate down to `.box` — so `onBoxDown` never runs and the drag silently does
    nothing. Use `host.shadowRoot.elementFromPoint(x, y)` first and fall back to the document.
    The geometry handoff in the window `mousedown` listener only covers the `!placed` case, by
    design, so nothing catches this for you. Cost 20 minutes on 2026-09-04.
  - **Check the grab point is actually on screen before dispatching.** A placed window may hang
    off the edges now, so a point computed from its rect is routinely negative or past the
    viewport; `elementFromPoint` returns null there, the event goes to `body`, and the test reads
    as a broken feature. Assert `0 <= x < clientWidth` in the helper.
  - **`dismiss()` sets `suppressed`, so the same case will not re-open.** Two consecutive tests
    on case 1 make the second look like a regression. Use a different case, or move the pointer
    off and back first.
- **`.case` DOM order is NOT case-number order** — cases 15 and 16 are swapped in the markup. Find
  a case by its heading text, never by array index; an index-based probe reports the wrong case's
  result and case 15 stalls 3 s on purpose, so it reads as a failure at any shorter wait.
- **Clear `blockList` between browser test runs.** It persists in `localStorage`, and the fixtures
  share image files — blocking case 1 also silences cases 16 and 19, which then look like
  regressions. Cost 10 minutes chasing exactly that on 2026-09-03.
- **A synthetic sweep of all 20 cases needs a wait longer than the first COLD probe, or the
  early cases read as failures that are not there.** A 700 ms-per-case loop on a fresh load
  reported cases 1–4 and 10 as showing nothing; each of those resolves to a 1600×1200 original
  that had never been fetched, and every later case reusing `photo.jpg` passed off the warm
  `probeCache`. Re-hovering any of them alone at 2 s showed the full-size image. The tell is that
  the failures are exactly the cases that are FIRST to want a given file — if a "regression" set
  looks like that, lengthen the wait before believing it. Two or three cases per
  `javascript_tool` call: the pane's timers run slow when it is hidden and a 20-case sweep hits
  the 45 s tool timeout.
- **The Browser pane reports `innerWidth`/`innerHeight`/`clientWidth`/`clientHeight` as ZERO
  while it is hidden** — `getBoundingClientRect()` on ordinary elements keeps working, so nothing
  looks broken and every viewport-relative measurement is quietly meaningless (the preview opens
  34×26 and clamps to nothing). Measured 2026-09-03 while verifying `bottomReserve`; same family
  as the blank-screenshot and zero-rAF problems. **Call `resize_window` to pin an emulated
  viewport before measuring any geometry**, and sanity-check `clientHeight` in the same call as
  the measurement rather than trusting it.
- **A `javascript_tool` call that times out has still run everything up to the timeout.** A
  45 s-capped call that hovered, measured, then *wrote a setting* left that setting written; the
  next measurement was of the changed config and read as "the new setting does nothing". Keep a
  call that mutates settings separate from the one that measures, and re-read the stored value in
  the same call that reports a number.
- **`location.reload()` from `javascript_tool` frequently does NOT reload the pane's page.** The
  call returns, the next call still sees the old script instance, and a settings change therefore
  reads as "the new setting does nothing" — which cost twenty minutes on 2026-09-04 chasing a
  `zoomFactor` that was in `localStorage`, was returned by `GM_getValue`, and still had no effect.
  Navigate to the URL with a **changed query string** (`?v=2`, `?v=3`) instead; same-URL
  `navigate` is also treated as a no-op. The tell is that `document.getElementById('hover-zoom-host')`
  is still non-null on what should be a fresh page.
- **A reloaded page can still run the PREVIOUS build of the script.** `test-page.html` pulls it
  with a plain `<script src="./Hover-Zoom.user.js">`, and the pane's browser serves that from its
  HTTP cache — even across a changed page query string, which only busts the *page*. Symptom: a
  control you just added is missing from the panel and every conclusion drawn afterwards is about
  old code. Bust it explicitly before reloading:
  `await fetch('/Hover-Zoom.user.js', {cache:'reload'}); location.reload();` — and when something
  you just wrote appears to be absent, check that first rather than the code.
- **CSS transitions do not advance while the pane is hidden**, so opacity reads as its start value
  for ever. Anything about fading has to be reasoned from the code — measuring it there returns
  `0` and looks like a bug in the thing you are testing (2026-09-05, chasing `fadeMs`).
- **A `computer{action:"hover"}` to a coordinate the pointer is already at fires no `mouseover`,**
  so a second test against the same element silently does nothing and reads as a script bug. Move
  the pointer somewhere else first, and re-derive coordinates from a fresh screenshot after any
  pane resize — the emulated viewport is letterboxed into the pane, so a stale scale factor puts
  every click off-target.

Shadow roots are `mode: 'open'` specifically so the test harness can read the viewer. Encapsulation
is identical to `closed`; only script access differs, and the page can find `#hover-zoom-host`
either way.

**A `file://` load will not work** — the preview pane renders local files as a static `data:`
snapshot and the external script never executes. Use the HTTP server.
