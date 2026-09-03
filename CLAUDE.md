# Hover Zoom — project notes

A single-purpose replacement for the Hover Zoom+ browser extension. **Images only** — no video,
audio, galleries, downloads, or action keys, by design. Inherits the shared rules in
`../CLAUDE.md` (version bumps, commit+push, no `innerHTML`, `#89b4fa` checkboxes).

> **[`INTERACTION.md`](INTERACTION.md) is the behavioural spec for the preview window** — every
> state, transition, terminator and known edge, each with a permanent ID (`S07`, `T12`, `E1` …).
> The user cites those IDs in conversation, so read it before discussing or changing window
> behaviour, and keep it current when behaviour changes. This file holds the *reasons*;
> `INTERACTION.md` holds the *behaviour*. Where they overlap, do not let them drift.

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

## Design invariants — do not regress these

- **Nothing is decided before hover time.** Two delegated listeners on `document`; everything
  resolves when the pointer arrives. This is the whole architectural difference from HZ+ and it
  removes an entire bug class (lazy-loaded src, SPA navigation, images added after load, scan
  races). Do not add a MutationObserver or a pre-pass "for performance", and never bind state to
  an element that might change under it.
  *(Previously worded "no DOM scanning, ever", which reads as a ban on ever querying the document
  and is broader than the thing being protected — a read performed AT hover time, binding
  nothing, has none of those failure modes. See the Google Images section for where the
  distinction actually bites.)*
- **No format allowlist.** Extension never decides eligibility. The only gate is
  "is the candidate actually bigger than what's displayed", measured by loading it.
- **No hardcoded size caps.** `minDisplayed` / `maxDisplayed` / `minRatio` are settings; the
  defaults are 48 / 0 (off) / 1.2.
- **Per-element probe state.** No shared lock, no `.one()`. `probeCache` is keyed by URL and
  every probe has both `onload` and `onerror`.
- **Build UI with `createElement` + `textContent`.** Trusted Types CSP sites (YouTube, Google)
  throw on `innerHTML` and abort the function mid-build with no visible error.
- **`view` + `reflow()` + `layout()` own all viewer geometry.** `view` is the only state,
  `reflow()` derives frame size and clamps the pan offsets, `layout()` is the only thing that
  writes to the DOM. Nothing else may set `box`/`img` styles or the two representations drift.

## Three viewer states: hover → detached → pinned

*Behaviour is specified in [`INTERACTION.md`](INTERACTION.md) (`S05`, `S07`, `S10` and the rule
`R1`). What follows is why it is built that way — keep the two in step.*

The preview escalates by gesture, and each step is one gesture, not a setting.

- **Hover** — transient. Opens beside the pointer. Held open by ONE thing: the pointer being
  over the source image. Leaving that image takes it down **at once**, with no grace period.
- **Detached** — drag it anywhere and it stops tracking the source image. Now held open by
  ONE thing: the pointer being over the preview. Leaving the preview takes it down *and*
  `dismiss()` puts the source image in `suppressed`, so moving back onto that image does not
  re-open it until the pointer has left the image and returned. A wheel over it zooms (v0.10.0):
  having placed it deliberately, scrolling the page — which would close it — is not what the
  gesture means.
- **Pinned** — click. Modal: backdrop catches, X appears, wheel/keys/drag become zoom-and-pan.

Read that as one rule: **exactly one thing holds the preview open at a time, and leaving it
ends the preview.** Every earlier version blurred this — both the image and the preview held
it — and every reported hover bug came from the blur.

### The unpinned preview is POINTER-TRANSPARENT (v0.9.0) — this is the load-bearing decision

`.box` has `pointer-events:none`; `.box.hot` turns it back on, and `layout()` sets `hot` only
when `pinned || detached`. Do not "simplify" this back to always-on.

The bug it fixes: with a hit-testable preview, scanning a row of five thumbnails gives ONE
preview. The preview covers thumbnails 2–5, so the pointer never reaches them — no `mouseover`
fires, and the first preview just sits there. The user's words: "If I have a row of 5 images
and I scan my mouse across them, I expect to get 5 preview windows."

The consequences, all of which have to be handled together:

- **`HIDE_GRACE` and `hideTimer` are gone.** The grace existed so the pointer could travel onto
  the preview before it vanished. There is nothing to travel to now, so leaving the image is
  unambiguous and `onOut` calls `cancel()` directly. Re-adding a delay re-breaks scanning.
- **Pinning and dragging are decided by GEOMETRY, not hit-testing.** A press on a transparent
  preview lands on the page beneath, so the document-level `mousedown`/`click` capture
  listeners test `pointInPreview(e.clientX, e.clientY)` against `view` and hand the event to
  the same `onBoxDown`/`onBoxClick` the hit-testable states use — one state machine, two ways
  in. Those handlers must keep their `preventDefault()` + `stopPropagation()`: the press is
  really on the page, and without them a link beneath would follow.
- **`ours(e.target)` is only ever true once `hot` is set.** Both `onOver` and `onOut` rely on
  that: `ours()` now means "on a placed preview", which is exactly the detached hold rule.
- **Nothing inside the frame is clickable on a plain hover preview**, by design — it dies the
  moment you move off the image toward it. Anything that needs clicking (the X, the browser's
  context menu) belongs to a placed or pinned window.

Two guards keep a drag from destroying the thing being dragged: `onOver` and `onOut` both
return early while `drag` is set. Scroll still cancels an unpinned preview, detached or not —
except a wheel *over* a placed preview, which zooms it (see the pinned-mode section).

**`hot` is set by `layout()` and must be cleared by `hideViewer()`** — v0.9.0 set it and never
removed it, and the symptom is nasty out of all proportion to the fix. `layout()` stops running
once the frame is down, so the box kept `pointer-events:auto` and `cursor:move` at its last
position and size: an invisible full-size rectangle that showed the move cursor, swallowed every
click through its own `onBoxDown`, and made `onOver`'s `ours(e.target)` true so no image under it
would ever preview again. Reported as "a phantom window where the preview used to be"; it needed
one detach or pin to arm and then survived every close. **The general rule: a class that grants
`pointer-events` must be removed on the same path that hides the element, not on the path that
lays it out.** Fixed in v0.10.0; the browser check is `elementFromPoint` inside the old rectangle
after closing, which must return page content, not `hover-zoom-host`.

## Videos are never previewed (v0.9.0)

"Images only" was a stated invariant that nothing actually enforced — a video thumbnail is a
plain `<img>` and previewed like any other. Reported on YouTube: "when I go to click a video,
I get a preview." Four gates, in `eligible()` / `inVideoContext()` / `overVideoSurface()`, any
one sufficient:

0. **Geometry** (v0.10.0) — the element's centre lies inside the rect of a laid-out `<video>`.
   A player's poster, cued-thumbnail overlay and endscreen images all occupy the video's own
   rectangle, so this names them exactly whatever the DOM between them looks like. Videos
   smaller than 2px are skipped, so the test page's 1×1 fixture contains nothing and cannot
   poison a page the way an unbounded ancestor walk does.

1. **`NEVER`** — `VIDEO`/`AUDIO`/`IFRAME`/`CANVAS`/`OBJECT`/`EMBED`/`SOURCE`/`TRACK` are never
   candidates, whatever CSS background they carry.
2. **Structure** — a `<video>` in the element or in up to three ancestors. Exact when it
   fires, but late on a card whose inline player has not been injected yet, which is why (3)
   exists.
3. **The link** — the nearest ancestor `a[href]` matching `VIDEO_LINK_RE` (`/watch?`,
   `/shorts/`, `/embed/`, `/video(s)/`, `youtu.be/`, `.mp4|webm|m3u8|mov|mkv|avi`). This is
   the heuristic, and the one that can be wrong. The asymmetry favours having it: a false
   positive costs one preview that never opens, a false negative is the reported bug. It is
   switchable — `skipVideos`, on by default — and has positive *and* negative cases in
   `test-resolver.js`, which slices the regex out of the script the way the URL tests do.

**That bound is also why gate 0 had to exist.** The bound is applied to an ancestor *before* the
ancestor is tested for a `<video>`, and on a YouTube watch page the player element holds the
video **and** several `<img>`, so the walk ended before the exact structural signal was ever
read — a preview opened over the video you were trying to click. Reordering the two inside the
loop is not the fix: testing the video first re-breaks the test page, because the grid ancestor
holding the 1×1 fixture would then match. The geometric test sits *outside* the walk and leaves
the bound exactly as it was. Found 2026-09-03; the reproduction is a `<div>` holding a `<video>`,
two sibling `<img>`, and the poster nested one level down.

**The ancestor walk must stop at the first ancestor holding more than one `<img>`.** Measured
2026-09-03: without that bound the walk reached the test page's grid, found the single 1×1
`<video>` fixture in case 18, and disabled all nineteen cases. One video anywhere on a page
would otherwise poison every image on it. The bound is "still one card", not a depth count —
depth alone does not distinguish a card from a grid.

Cases 17 (video link), 18 (video in the card) and 19 (an ordinary `/gallery/` link, the
control) exist so a regression shows up as a test-page failure rather than in the wild.

## Image actions — the browser's own menu, on a pinned window

**A userscript cannot *open* the browser's context menu.** A dispatched `contextmenu` event is
untrusted and browsers run no default action for untrusted events — the menu is user-agent
chrome, raised only by real input. So "a button that simulates a right click" is not a thing
that can be built, at any price.

**But it can decline to suppress one** (v0.11.0), and that is the answer. On a **pinned** window
`altButton()` returns false, `swallowMenu` stays off, and the browser raises its real menu over
our `<img>` — whose `src` is the resolved full-size URL, so *Save image as…*, *Copy image*,
*Copy image address* and *Open image in new tab* all act on the original. Verified in a real
browser 2026-09-03, including that native chrome does target an `<img>` inside an **open**
shadow root. `B2` (`pinButton:'right'`) already behaved this way and is the test that proved the
mechanism before any of it was built — two right presses, no code.

**Only pinned** (narrowed in v0.12.0). A hover preview is pointer-transparent, so the native menu
there comes up for the thumbnail underneath and offers to save *that*; a detached window keeps
dismiss because shoving it aside is worth more than a menu that is one click away. Pinning is the
deliberate "I want to work with this image" gesture, and that is where the menu belongs.

**The ⋮ menu was removed in v0.12.0**, along with `MENU_ITEMS`, `runMenu`, `openMenu`/`closeMenu`,
`flash`, and the clipboard/canvas helpers (`legacyCopy`, `writeText`, `fetchBlob`, `toPng`,
`openTab`). Its Save and Copy ran in page JavaScript and so needed the host to send
`Access-Control-Allow-Origin` — and Copy needed clipboard-write permission on top. Most hosts
send neither and nothing in a page context gets around it, which is why they were reported as
simply not working. **Do not rebuild it.** If image actions are ever wanted somewhere the browser
menu cannot reach, the two that work from page JS are "open in a new tab" and "copy the URL"; the
other two cannot be made to work from here at any price.

The removal took some care, because the menu had hooks in eight places: `isBoxControl()` (now the
X alone), `unpin()`, `onBoxDown()`, `onPinWheel()`, `onPinKey()`'s Escape, `cancel()`, and the
document `mousedown`, `keydown` and `resize` listeners. `node --check` catches none of that — a
leftover `closeMenu()` is a runtime `ReferenceError` in a handler, which fails silently.

### The status bar fades itself out (v0.12.0)

The bar is drawn ON the picture, so on a meme, a screenshot or a comic panel it covers the text
being read. `.cap.idle` sets `opacity:0` **and** `pointer-events:none`, `showBar()` clears it and
arms a `BAR_IDLE_MS` (2000 ms) timer, and `onMove` calls `showBar()` only when the pointer is over
the window — moving anywhere else lets it fade, which is the point. `resetBar()` in `cancel()`
keeps a closed preview from reopening with a stale class.

The `pointer-events` half is not decoration: the bar is the move handle, and an invisible move
handle is a trap. Faded, a press where it was pans or moves by the ordinary rule, and moving the
pointer first brings the real handle back. Points that are load-bearing:

- **`.cap.idle` must drop `pointer-events` as well as `opacity`.** Opacity alone leaves an
  invisible move handle across the bottom of the picture, which is the same class of bug as the
  `hot` ghost above — something you cannot see still answering the mouse.
- **`showBar()` is called from `onMove` only when the pointer is over the window** (`ours()` or
  `pointInPreview()`). Calling it on every mousemove would mean the bar never fades while the
  pointer is anywhere on screen, which is not what "after two seconds" means.
- **The timeout re-checks `view`** before adding `idle`, and `cancel()` calls `resetBar()`, so a
  preview cannot open with a stale class from the last one.

Verified in the pane: `cap` → `cap idle` after 2.4 s of a still pointer → `cap` again on a
mousemove over the window; while pinned, `pointer-events` goes `auto` → `none` → `auto` with it.
Note the pane never advances CSS transitions (the zero-frame problem below), so **read the class,
not the opacity** — computed opacity there is stuck at whatever it started as and proves nothing.

## Pinned mode

Click the preview → it pins. The backdrop (`.dim.catch`) starts swallowing clicks, an X appears
(`.box.pinned .x`), and wheel / `+` `−` / arrows / drag become a zoom-and-pan surface. It closes
on the X, a click on the backdrop, or Escape. **Not optional** — there is no other thing a click
on a floating preview could mean, so it has no setting; the panel carries a `note()` row that
explains the controls without offering a switch.

- **Left click pins, right click dismisses a HOVER preview — and `pinButton` swaps them.**
  Dismiss is for "the preview is in my way but my cursor is staying on this image": it takes the
  preview down and records the element in `suppressed`, which `onOver` skips until `onOut` sees
  the pointer actually leave it. Without that, the next mousemove just re-shows it. The right
  press is claimed in the document `mousedown` handler, not on `contextmenu` — mousedown fires
  first and would otherwise `cancel()` and clear `active` before the menu event could see what to
  dismiss; `swallowMenu` then suppresses the menu itself.
- **On a PINNED window right-click is the browser's**, not ours — see the image-actions section
  for why. `altButton()` returns false on `pinned`, which is what leaves `swallowMenu` off. Do
  not "tidy" that early return into a dismiss: it is the whole feature. It was `pinned ||
  detached` for one version; detached went back to dismissing in v0.12.0.
- **While pinned, the left button always pans or moves**, whatever `pinButton` says, so a pinned
  frame closes via the X, the backdrop, or Escape — under both button maps now, since right no
  longer closes it either. Do not wire dismissal onto the pan button.
- **The preview opens beside the pointer, then is nudged just far enough to touch it**
  (`nudgeIntoReach`, `REACH_INSET` 10px). v0.4.0 centred it on the cursor, which solved
  reachability but moved the preview much further than needed. The nudge is ~34px with the
  default 24px gap, and only on the axis that needs it. (A frame clamped away from the cursor at
  a window edge used to be covered by `HIDE_GRACE`; there is no grace period since v0.9.0, and
  the preview being pointer-transparent is what makes that safe.)
- **The status bar always moves the frame** (`drag.mode === 'move'`); everywhere else pans if
  the picture is spilling and moves the frame if it is not. Both go through the same `drag`
  object in `onMove`. Hiding the status bar therefore removes the only way to move a frame that
  is zoomed in far enough to pan.

- **The frame grows before the image spills.** Zooming enlarges the frame until it reaches
  `maxWidthPct`/`maxHeightPct` of the viewport; past that the frame is fixed and the image
  overflows it, which is when `pannable()` (and the `grab` cursor) turn on. Zoom-out floors at
  `fitScale`, the scale the preview opened at; `0` returns there.
- **Key and wheel listeners live on `CAP_TARGET` (= `window`), in capture** — per
  `../CLAUDE.md`, that beats every document-level listener on the page and in sibling
  userscripts, so arrows and `+`/`−` are ours while pinned and nobody else's. Keys are added in
  `pin()` and removed in `unpin()` against that one constant; `wheel` uses the shared
  `WHEEL_OPTS` object for add *and* remove, or the removal silently no-ops.
- **Wheel zoom belongs to any PLACED preview, pinned or merely detached** (v0.10.0). A wheel
  over a detached preview used to scroll the page, and the scroll then cancelled the preview —
  the gesture destroyed what it was aimed at. `enableWheelZoom()`/`disableWheelZoom()` guard one
  flag so add and remove cannot drift, and `detach()` is the single place `detached` is set so
  the binding cannot fall out of step with it. It is bound **on demand, not for the life of the
  script**: this is a non-passive capture listener on `window`, and leaving one attached makes
  every wheel event on every page cancellable for nothing. Unpinned, `onPinWheel` acts only when
  the pointer is actually over the frame, so a wheel anywhere else still scrolls.
- **A drag pans only while the picture is spilling; otherwise it moves the frame** (v0.10.0) —
  one rule for every state, with the status bar always moving the frame. Before this the pinned
  branch was `'pan'` unconditionally and the press was simply dropped when `pannable()` was
  false, so a pinned frame at `fitScale` could not be dragged at all. `pannable()` is read per
  press, so zooming in and back out restores dragging with no state to keep in step.

## Settings are per-tab snapshots — always re-read before rendering the panel

`cfg` is read once at load, so every tab holds its own copy. A tab open for a while is editing a
stale snapshot: the panel renders old values *and*, because Save writes the whole object, it
reverts anything another tab changed since. Symptom as reported: "I change one thing and it
saves other things I had previously disabled."

Two defences, both needed:

- `reloadSettings()` at the top of `openPanel()` — the one that always works, including where
  the manager has no change API.
- `GM_addValueChangeListener` on `KEY`, acting only when `remote` is true. This is the better
  fix because it also keeps the *running* script current, not just the panel, and re-renders an
  already-open panel. It needs the `@grant`, and it must be feature-detected — not every manager
  implements it.

Verified against the `storage`-event stub in `test-page.html`: a silent write is picked up on
open, a signalled write is picked up immediately, and saving afterwards preserves the other
tab's values instead of clobbering them.

## Gotcha: a capture listener on the box eats its own children's events

`onBoxDown`/`onBoxClick` are capture listeners on `.box`, and the X button is a *child* of the
box — capture descends from the ancestor, so those two run first and their `stopPropagation()`
kept `closeEl`'s own handlers from ever firing. The X looked correct, hovered correctly, and did
nothing. Both handlers now `return` early on **`isBoxControl(e.target)`**, which is the one list
of exempt controls — just the X now that the ⋮ button is gone. Any new control placed inside it goes in
there — it is not optional, and the symptom is silence. Found 2026-09-03 in browser testing; nothing
static catches it — `node --check` passes and the markup is fine.

## Testing

```bash
node --check Hover-Zoom.user.js     # syntax
node test-resolver.js               # 67 assertions on the pure URL and video-link logic
python make-test-images.py          # regenerate fixtures into test-images/
```

Browser test: `python test-server.py`, then open `http://localhost:8899/test-page.html`. 20 cases,
10 of which HZ+ rejects outright. (`.claude/launch.json` wraps the same command as
`hover-zoom-test`, but `.claude/` is gitignored — a fresh clone has only the direct command.)

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

## Gotchas found while building

- **URL-upgrade rules over-match silently, and that is worse than under-matching.** The first cut
  of the Cloudinary/Imgix transform-segment rule was
  `/\/(?:[a-z]{1,3}_[^/,]+)(?:,[a-z]{1,3}_[^/,]+)*\//g`, which ate ordinary path segments like
  `/en_US/`, `/v_2/` and `/a_b/` on any host. A wrong candidate that happens to load shows the
  *wrong image*; a missing candidate just shows nothing. The rule now requires every comma-part to
  be a `key_value` pair from a known transform-key set **and** the segment to carry a numeric `w_`
  or `h_`. Any new path-rewriting rule needs the same negative tests — see `none()` in
  `test-resolver.js`.
- A first run of a new test suite that passes 33/33 deserves suspicion, not celebration. The
  over-match above was invisible until real URLs were printed and eyeballed.
- **`linkParamCandidates()` needs the same discipline as `UPGRADES`.** It pulls any query-param
  value that is an absolute http(s) URL passing `looksLikeImage()` out of an ancestor link, which
  is how `/imgres?imgurl=…` works without naming Google. Two guards keep it from doing harm:
  values must be absolute (a bare path is ambiguous), and `THUMB_PARAM` names are skipped so a
  `?thumb=` never displaces the original. Everything it returns still faces the ratio gate, so
  the worst case is a wasted probe rather than the wrong image — but only because of those
  guards. Negative tests live beside the positive ones in `test-resolver.js`.

## Resolve progress

Probes are sequential and each awaits a real image load, so a slow or many-candidate image can
sit silent for seconds. Worse, leaving mid-probe does not abort the in-flight loads — they finish
and populate `probeCache`, which is why the same image "works if you come back to it later".
That is a cache warming up, not a fixed bug, and it is why the silence needed a UI rather than
a code fix.

`.spin` answers it: an SVG ring, **indeterminate** — a fixed arc (`ARC_FRAC`, 28% of the ring)
sweeping a full track at 400°/s. It says "still working" and deliberately nothing else.

**The determinate version was removed in v0.7.0 because it could not be honest.** Its
denominator was `candidates.length`, the worst case; the run stops at the first candidate that
clears the ratio gate, usually the first or second of up to eight. So the arc never once
finished where it said it would — reported as "it has never finished when it thinks it will".
A progress bar that is wrong every time is worse than none, and no honest denominator exists
here: the cost is a network fetch of unknown size and the stopping point is data-dependent.
Do not reintroduce one (`CREEP_TAU`/`CREEP_MAX`, the exponential easing between steps, and
`resolve()`'s `onProgress` parameter all went with it).

**The disc behind the ring is mostly opaque and themed to the BROWSER** (`applySpinTheme()`,
called per hover). The spinner is the only part of the overlay that sits on the bare page
rather than on the frame's own dark background, so it is the only part that needs this.

`darkMode()` reads `prefers-color-scheme` — that IS the browser's colour mode, and it is what
the user sees everywhere else. **v0.7.0 keyed off the PAGE's computed background instead and
that was wrong**: on a white page it picked the light palette and drew a near-white disc on
white, which is "matching" and invisible. Reported as "still too light, I can hardly see it —
I am using a dark browser theme". The page-background reading survives only as the fallback
for a browser with no media-query support, and `spinnerTheme` (auto/dark/light) overrides
both.

Contrast is deliberate on both sides: 34px, 4.5px strokes, a 1.5px rim at .45 alpha, and a
track at .22–.30. **The rim is what separates the disc from arbitrary page content behind it**
— at v0.7.0's .20 alpha there was effectively no edge, which is most of why it read as a
smudge. History worth not repeating: v0.4.0 had an unconditional `#1e1e2e` disc that was a
dark blob; v0.5.0 made the centre transparent, which read as nothing at all on a busy image.

`SPINNER_DELAY` (150 ms) keeps it from flashing on cached hits, but `buildViewer()` runs
*immediately* in `showSpinner()` so the ring exists before anything can need it.
`hideSpinner()` is in a `finally`, so the ring stops on every outcome including a throw; a
ring still turning after the search stopped is a lie.

- **`setInterval`, never `requestAnimationFrame` — and not a CSS animation either.** rAF is
  starved whenever the compositor decides the page is not worth animating. **The Claude Code
  Browser pane delivers zero animation frames while reporting `visibilityState: "visible"` and
  `document.hasFocus(): true`** — a 60-frame rAF probe returned 0. Real browsers do the same
  for occluded windows and some power-saving modes. A frozen ring is indistinguishable from a
  hung script, so the animation must not depend on frames being offered. Anything else here
  that must animate has the same constraint, and no screenshot will catch it — verify by
  reading the attribute over time (`svg.style.transform` advances 24° every 60 ms).

## Known limits

- HZ+'s 399 plugins encode genuine per-site knowledge (Pixiv's referer requirement, Instagram's
  URL signing, Twitter's `:orig`). The generic resolver wins on the long tail and loses on a few
  hostile sites. Add narrowly-scoped rules to `UPGRADES` only with host checks and negative tests.
- `keepSearching` (ON by default, was `preferLargest` and off) keeps probing past the first hit
  and upgrades the preview in place each time something strictly bigger turns up. It costs up to
  `MAX_PROBES` (8) requests per hover instead of usually one. Turning it off restores
  stop-at-first-hit.

## Progressive resolution, and why probes stay sequential

`resolve()` takes an `onHit` callback and fires it for every strictly larger candidate, so the
first match paints immediately and later ones replace it via `upgradeViewer()`. The ring docks
into the frame's lower right (`dockSpinner()`) while the search continues, which is the only
signal that what you are looking at is not final.

**Do not parallelise the probes into a race.** The candidate list is ordered by *heuristic
confidence*, not by measured size — `data-*` attributes, then srcset widest-first, then rewrites,
then the link, then the displayed src last. Selection is "first in list order that clears the
gate", so taking the first *response* instead hands the decision to whichever server answers
fastest, which systematically favours the smallest file. If the latency ever needs fixing, the
safe shape is: start all probes at once, then `await` them **in list order** — same result, wall
clock drops from the sum to the slowest one actually needed, at the cost of always issuing N
requests. That is a bandwidth decision, not a correctness one.

`pin()` deliberately does **not** cancel the in-flight resolve; pinning is a reason to keep
looking. `upgradeViewer()` holds the frame's centre, and for a pinned view also holds its
on-screen size (`prevImgW / res.w`) and the fraction of the picture at the frame's middle, so a
swap changes only the pixels, never what the eye is tracking.

### Google Images cannot be fixed generically — measured, not assumed

Reported 2026-09-03: HZ+ returns full-size originals there, this script returns 500–700px.
Inspected live on `google.com/search?udm=2` (2026-09-03, real Chrome — the in-app browser gets
`/sorry/index` bot detection). What a result thumbnail actually offers:

| Source we could use | What Google gives |
|---|---|
| `src` | `encrypted-tbn0.gstatic.com/images?q=tbn:<opaque token>` — no extension, no size params, nothing to rewrite |
| `srcset` | **absent** |
| `data-*` on the img | `data-csiid`, `data-atf` only — no URL |
| `data-*` on 6 levels of ancestors | `data-ved`, `data-eqld`, `data-preview-id` (empty), `data-img-wrapper` — no URL |
| ancestor `<a href>` | **the anchor has no `href` attribute at all** |

Natural sizes of those thumbnails measured 678×452, 245×205, 503×397 — which *is* the reported
500–700px. So nothing is malfunctioning: the thumbnail is the only candidate that exists, it
clears the ratio gate against a 240px display, and it gets shown.

The original URL is present only inside ~0.94 MB of inline script JSON, as `["<url>",h,w]` triples
sitting a few hundred bytes after the thumbnail's `tbn:` token. **Note HZ+'s own
`a[href*="imgurl="]` selector is now stale for this layout** — its Google support must be riding
on the script-JSON path.

What v0.5.0 added is still worth having, just not for this: `linkParamCandidates()` (the generic
`?imgurl=`-style rule) and the `/s0/` path-segment form of the googleusercontent size token.

#### If it is ever revisited, these are the measured numbers (2026-09-03)

A prototype extractor — find the token in any `<script>`, take the next 1200 chars, first
`["url",h,w]` triple whose host is not Google — run against the live page:

| | Initial page | After "More results" |
|---|---|---|
| thumbnails rendered | 15 | 226 |
| resolved to an original | **15 (100%)** | **39 (17%)** |
| cost per lookup | 0.3 ms | 0.19 ms |
| gain | median 1.9×, max 13× | max 15.8× |

The initial payload carries 200 external image entries, 152 of them ≥800px — enough to cover the
lazy placeholders in that batch too. Everything past "More results" arrives by XHR and its
originals are **not** in the DOM at all, which is exactly why HZ+ needs its fourth mechanism.

#### The invariant question, stated properly

"No DOM scanning" is worded more broadly than the thing it protects. Every bug it exists to
prevent — lazy-loaded src, images added after load, SPA navigation, scan races, HZ+'s
`.one('mouseover')` — comes from **deciding eligibility ahead of time and binding to elements**.
A hover-time `querySelectorAll('script')` + `indexOf` binds nothing, caches nothing against an
element, and re-reads live every time, so it has none of those failure modes. Do not reject it by
quoting the rule; the rule is about pre-passes.

The real objections are different, and they are the ones to weigh:

1. **It is the first site-specific rule.** It reads Google's private JSON shape, which can change
   with no warning and no error — the preview would just quietly go back to thumbnails.
2. **`UPGRADES` cannot host it.** Every rule there is a pure URL→URL function, which is the only
   reason `test-resolver.js` can test them offline with no DOM. This needs a new extension point
   taking the element, and a saved-page fixture to test against.
3. **It is a partial fix** — the 17% above. Completing it means hooking XHR on Google, which is a
   permanent network interception plus a cache, and is a site plugin in everything but name.

So: (a) do nothing and keep HZ+ for Google; (b) hover-time lookup, host-gated, accepting first-
batch-only coverage and silent breakage; (c) (b) plus XHR hooking, which is the thing this
project exists not to be. Not decided as of v0.6.0 — ask before building any of it.
