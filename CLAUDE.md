# Hover Zoom — project notes

A single-purpose replacement for the Hover Zoom+ browser extension. **Images only** — no video,
audio, galleries, downloads, or action keys, by design. Inherits the shared rules in
`../CLAUDE.md` (version bumps, commit+push, no `innerHTML`, `#89b4fa` checkboxes).

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

- **No DOM scanning, ever.** Two delegated listeners on `document`; everything resolves at hover
  time. This is the whole architectural difference from HZ+ and it removes an entire bug class
  (lazy-loaded src, SPA navigation, images added after load, scan races). Do not add a
  MutationObserver or a pre-pass "for performance".
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

## Pinned mode (v0.3.0)

Click the preview → it pins. The backdrop (`.dim.catch`) starts swallowing clicks, an X appears
(`.box.pinned .x`), and wheel / `+` `−` / arrows / drag become a zoom-and-pan surface. It closes
on the X, a click on the backdrop, or Escape.

- **The frame grows before the image spills.** Zooming enlarges the frame until it reaches
  `maxWidthPct`/`maxHeightPct` of the viewport; past that the frame is fixed and the image
  overflows it, which is when `pannable()` (and the `grab` cursor) turn on. Zoom-out floors at
  `fitScale`, the scale the preview opened at; `0` returns there.
- **Pinned-mode key/wheel listeners live on `CAP_TARGET` (= `window`), in capture** — per
  `../CLAUDE.md`, that beats every document-level listener on the page and in sibling
  userscripts, so arrows and `+`/`−` are ours while pinned and nobody else's. Both are added in
  `pin()` and removed in `unpin()` against that one constant; `wheel` uses the shared
  `WHEEL_OPTS` object for add *and* remove, or the removal silently no-ops.
- **Hover has a `HIDE_GRACE` (220 ms).** The preview sits `cursorGap` px from the image, so
  reaching it means crossing page content. `onOut` schedules the hide instead of doing it, and
  `onOver` cancels that timer when the pointer lands on the host. Without it the preview is
  unreachable and click-to-pin cannot work at all.
- **The preview is hit-testable while unpinned** (`.box.on.hot`, gated on `cfg.clickToPin`).
  That is the cost of click-to-pin: the preview covers whatever is under it. Turning the setting
  off restores `pointer-events:none`.

## Gotcha: a capture listener on the box eats its own children's events

`onBoxDown`/`onBoxClick` are capture listeners on `.box`, and the X button is a *child* of the
box — capture descends from the ancestor, so those two run first and their `stopPropagation()`
kept `closeEl`'s own handlers from ever firing. The X looked correct, hovered correctly, and did
nothing. Both handlers now `return` early on `closeEl.contains(e.target)`. Any new control
placed inside the box needs the same exemption. Found 2026-09-03 in browser testing; nothing
static catches it — `node --check` passes and the markup is fine.

## Testing

```bash
node --check Hover-Zoom.user.js     # syntax
node test-resolver.js               # 39 assertions on the pure URL logic
python make-test-images.py          # regenerate fixtures into test-images/
```

Browser test: serve the folder (`.claude/launch.json` defines `hover-zoom-test` on port 8899,
`python -m http.server`) and open `test-page.html`. 13 cases, 9 of which HZ+ rejects outright.
The page loads `Hover-Zoom.user.js` via a `<script>` tag, so it runs without Tampermonkey —
`GM_getValue` is absent, `readSettings()` catches the ReferenceError and falls back to defaults.

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

## Known limits

- HZ+'s 399 plugins encode genuine per-site knowledge (Pixiv's referer requirement, Instagram's
  URL signing, Twitter's `:orig`). The generic resolver wins on the long tail and loses on a few
  hostile sites. Add narrowly-scoped rules to `UPGRADES` only with host checks and negative tests.
- `preferLargest` (off by default) probes every candidate instead of stopping at the first that
  clears the ratio gate. It finds bigger originals — e.g. rewriting a `srcset`'s widest entry —
  at the cost of up to `MAX_PROBES` (8) requests per hover.
