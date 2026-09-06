# Review findings — Hover Zoom v0.77.0 (2026-09-06)

Answers [`REVIEW-BRIEF.md`](REVIEW-BRIEF.md). Nothing here is applied yet; the user picks the list
over first. Line numbers are v0.77.0's. "Verified" = reproduced on the test page with real events;
"code" = deterministic from the source, not run.

## P0 — wrong behaviour on common markup

1. **`nativeSize()` reads `naturalWidth`, which is density-corrected for `srcset` `w` candidates.**
   `Hover-Zoom.user.js:668`, consumed at `:929-932`. Spec: `naturalWidth = file px ÷ (w ÷ source
   size)`. Whenever the chosen candidate's density is not exactly 1 — most HiDPI displays, and any
   `sizes` that does not land on the file width — the on-screen size differs from the probe of the
   same URL, `markUnstable()` refuses the displayed URL for the tab, and the resolver falls back to
   a smaller `srcset` entry. **Verified:** a 24×18 PNG in an 8-entry `w` srcset reported 284×213
   and was logged `unstable url — refused … measured 284×213, loaded 24×18`. Shape tests are
   unaffected (density preserves the ratio). Fix: when `el.srcset` or `el.closest('picture')`,
   make the stability test compare aspect ratios (tight, ~1%) instead of exact pixels; keep exact
   equality otherwise. `verifyMedia()` is safe — our own `imgEl` has no srcset.

## P1 — wrong in an edge case

2. **`MAX_PROBES` truncation drops the ancestor link and the displayed src.** `:858` slices after
   `srcset`/`<picture>` entries (`:585-598`) are all added, widest first; the link (`:604-613`) and
   the shown URL (`:616-620`) come after. Eight or more srcset URLs and the link is never probed —
   and seven smaller srcset entries are downloaded to be rejected first. **Verified:** 8-entry
   srcset + `<a href="photo.jpg">` → candidates logged = 8, all srcset, no hit; same fixture with
   7 entries → `photo.jpg` hit. Fix: cap each srcset list's contribution (top 2), or exempt the
   link and shown URL from the slice.
3. **`modifierDown` strands on window blur.** `:3357`, set `:3960`, cleared only by `keyup`
   (`:3965`); `blur` (`:3939`) does not clear it. Ctrl+Tab / Alt+Tab away and back: previews open
   with no key held until any keyup. **Verified.** Fix: `modifierDown = false` in the blur handler.
4. **`suppressed` is not lifted when the pointer leaves through a child.** `:3867` requires
   `e.target === suppressed`; a background-image element with caption text inside it fires
   `mouseout` on the child. Re-hover is refused until a leave from the element itself.
   **Verified** on case 31. Fix: `|| suppressed.contains(e.target)` — `active` already does this
   at `:3873`.
5. **The ▶ (stop clips in this tab) does not stop animated GIF/WebP/APNG.** `motionRefused()`
   `:762` tests `cfg.videoMode !== 'none'`, not `videoPreviewsOn()` (`:130`). Tooltip `:1307`
   promises "still images only"; `docs/SETTINGS.md:493` says the two are one switch. Code. Fix:
   `if (videoPreviewsOn()) return false;`.
6. **A clip keeps playing through the fade-out, with sound if unmuted.** `hideViewer()`
   `:2828-2847` never pauses; `clearMedia(vidEl)` runs at `fadeMs + 60`. Teardown timing verified
   (src still set through the fade); playback itself could not run in the pane. Fix: `vidEl.pause()`
   at the top of `hideViewer()` — `setMedia()` restarts it on any re-show.
7. **Fullscreen exit inside the request's own transition strands the document fullscreen.**
   `enterFull()` sets `fullApi = true` synchronously (`:2983`) but `leaveFull()` (`:2995`) checks
   `document.fullscreenElement`, still null until the transition lands → `restoreFull()` clears
   `fullPrev` → the later `fullscreenchange` is ignored at `:3051`. Press F twice quickly, or
   double-click then Escape. The browser's own Escape recovers it. Code; the pane cannot enter
   fullscreen. Fix: while `fullApi` and no element yet, still call `exitFullscreen()` (it rejects
   harmlessly) or defer the exit to the pending promise.

## P2 — polish, performance, hygiene

8. **`sniffAnimated()` walks the whole response** (`:532`) when a server ignores `Range` (`:744`);
   Python's `SimpleHTTPRequestHandler` does, so the test server is a trigger. Multi-MB GIF at
   `videoMode: none` → millions of string appends. Fix: `bytes = bytes.subarray(0, ANIM_HEAD)`.
9. **A stale `hideViewer()` timer can tear down a newer fade** (`:2839-2846`): hover A, leave, hover
   B within `fadeMs + 60`, leave B → A's timer clears B's media mid-fade (blank dark box). Fix: a
   hide sequence number, or clear the pending timer in `showViewer()`.
10. **Image probes never time out and failures cache forever.** `probe()` `:704-726` has no timer
    (video has 6 s, `:699`); a stalled URL blocks every later candidate for that element on every
    hover, and a transient 429/404 is `null` for the page's life. Fix: race a ~15 s timeout and do
    not cache a timeout/failure result.
11. **`laidOutMedia()` `:3621-3630` counts every img/video under up to 5 ancestors** before the
    caller tests `> 1`. A covered thumbnail in a large grid pays 5 full gBCR passes per hover.
    Fix: return early at 2.
12. **`swallowMenu` strands** (`:3761`, consumed `:3915`) if no `contextmenu` follows the right
    press (released outside the window); the next context menu anywhere on the page is eaten.
    Unverified. Fix: a timestamp with a TTL, like the click claim.
13. **Fullscreen fit is not capped by `MAX_SCALE_ABS`.** `fitFull()` `:3013` via `fitScaleFor()`
    `:1526` can exceed `clampScale()`'s ceiling (`:2580`); a 32 px original on a 2160 px screen
    opens at fit and the first wheel notch snaps down. Code.
14. **`hoverReport.inShadowRoot` (`:3719`) can never be true.** At the document listener `e.target`
    is retargeted to the shadow host. **Verified.** The same fact means images inside an open
    shadow root are never eligible (`eligible()` gets the host); not filed — design limit, but the
    diagnostic should say `composedPath()[0]` or be removed.
15. **`Reset to defaults` wipes `siteAudio`** (`:4705-4707`, `RESET_KEEPS` `:3990`) while the tip
    (`:4702`) says the user's lists are kept. Per-site mute/volume is user-set too. Decision.
16. **`transferBytes()` `:1678`** stops answering after the Resource Timing buffer fills (250 by
    default); byte counts vanish on long feeds. Fix: `performance.setResourceTimingBufferSize(…)`
    once, or accept.
17. **Firefox, unverified:** `.vvol` (`:1200`) is an absolutely positioned box holding a range with
    no explicit width — the project's own rule in `CLAUDE.md`. `.spop` has only `min-width`.
18. **Dead code:** `relabel()` `:4282-4287`, `videoReason()` `:3507-3509`; `anyFades()` `:1409` is
    a bare alias of `barFades()`. None is inside a `test-resolver.js` slice.
19. **Docs stale:** guide `:4524` says "Drag the grab border" — retired v0.71.0 (`:1632`).
    `CLAUDE.md:52` "~4,200 lines and half of it is comment prose" (4,776 lines, 413 comment
    lines); `CLAUDE.md:192` "160 assertions" (213). Case counts at `:198` are right.

Not filed, noted: `linkedMedia()` performs a credentialed same-origin GET of whatever page a
thumbnail links to; an action URL behind an image would be hit on hover.

## Settings copy — proposals

Rules applied, from `docs/SETTINGS.md`: unit at the end of the first clause, `(default: N)` on
every numeric, "image" never "picture", a hint holds one fact the label does not.

| key / item | current | proposed |
|---|---|---|
| activation opts | When I hover over an image / Only when the modifier key is held | On hover / On hover while the modifier key is held |
| position | label *Location*; hints "where the preview window will open. …" | label *Opens*; center: "Pin it by clicking the image under the pointer." cursor: "Pin it by clicking the preview." |
| zoomFactor hint | How far a small original may be enlarged, in multiples of its own size. 1 never enlarges. Larger originals still shrink to fit the window. (default: 2) | How far a small original is enlarged, in multiples of its size. 1 never enlarges; large originals always shrink to fit. (default: 2) |
| minRatio | label *Required upsize*; hint (33 words) | label *Minimum size ratio*; "Original ÷ the image on the page. 1 previews anything larger; below 1 previews smaller originals too. (default: 1)" |
| minDisplayed hint | The size drawn on the page, in px. Lower it to reach icons and avatars — a YouTube avatar is about 24. (default: 16) | As drawn on the page, in px. Lower it for icons and avatars; a YouTube avatar is about 24. (default: 16) |
| pinButton | label *Pin preview with*; hint "The other button closes the preview without following the link underneath."; opts "Left click  (right click dismisses)" | label *Pin with*; hint "The other button dismisses it without following the link underneath."; opts "Left click (right dismisses)" / "Right click (left dismisses)" |
| videoMode | label *Video to play in a preview*; hint 3 sentences; opt "No video at all" | label *Play in a preview*; hint "A clip is short, muted and looping; a video is anything a thumbnail links to."; opt "Nothing that moves" (drops the GIF sentence: the option now says it) |
| skipFurniture hint | Page furniture — backgrounds, banners, decoration — rather than images on the page. Turn off if it skips images you want to preview. | Turn off if an image you want is being skipped. |
| displayScale hint | if the zoom percentages look wrong, set this to your display scaling. (default: 1) | If the zoom percentages look wrong, set this to your display's scaling. (default: 1) |
| siteList desc | Subdomains are included, so example.com also covers www.example.com. | example.com also covers www.example.com. |
| blockList desc | Images that never open a preview. Add one with the ⊘ button on a pinned preview; newest last. A * matches anything. | Add one with ⊘ on a pinned preview; newest last. * matches anything. |
| referrerSites desc / ex | Add a site whose previews come up blank or say "no hotlinking" while the page's own thumbnails look fine. / Subdomains are included, same as the site list above | For a site whose previews come up blank or say "no hotlinking". / example.com also covers www.example.com |
| wheelZoomStep hint | One wheel notch, in %. The + and − keys always step by 25%. (default: 15) | Per wheel notch, in %. The + and − keys step 25%. (default: 15) |
| panStep hint | How far one press moves the image, in px — hold Shift for 3×. (default: 80) | Per press, in px; Shift triples it. (default: 80) |
| maxZoom hint | How far you can zoom in by hand, in multiples of the original's size. (default: 32) | In multiples of the original's size. (default: 32) |
| maxSizeMultiple hint | How far you can grow the window yourself, in multiples of the browser window. A preview always opens no larger than the browser window. (default: 1.2) | In multiples of the browser window. A preview never opens larger than the browser window. (default: 1.2) |
| hoverDelay | label *Delay before the preview appears*; hint "How long the pointer must rest on an image before the preview begins to load, in ms. (default: 120)"; sits under *Appearance* | label *Hover delay*; "How long the pointer rests on an image before the preview loads, in ms. (default: 120)"; move to *The preview* |
| fadeMs | *Preview fade in / out* — "in ms. (default: 200)" | *Preview fade* — "In and out, in ms. (default: 200)" |
| borderWidth hint | in px. (default: 1) | In px; 0 for none. (default: 1) |
| borderColor | no hint | "(default: #45475a)" or leave — a colour is not numeric |
| cornerRadius hint | in px. (default: 6) | In px. (default: 6) |
| barMode | hint "has useful tools and info."; opts Always visible / Visible when hovering / Hidden | hint "Filename, size, zoom and the buttons. (default: while hovering)"; opts Always shown / Shown while the pointer is on the preview / Hidden |
| barIdleMs hint | time in ms before the status bar begins to fade out. (default: 250) | After the pointer leaves the preview, in ms. (default: 250) |
| barFadeMs hint | time in ms the status bar takes to fade out, and back in. (default: 250) | Out and back in, in ms. (default: 250) |
| shadow hint | a soft shadow around the preview window, which separates it from the page behind it | Separates the preview from the page behind it. |
| shadowSize hint | The blur, in px. (default: 24) | Blur, in px. (default: 24) |
| shadowStrength hint | how dark that shadow is, in %. (default: 50) | Darkness, in %. (default: 50) |
| spinnerTheme hint | Matching follows your system's light-or-dark setting, not the browser's theme. | Match uses the system's light/dark setting, not the browser's. |
| debug hint | One line per hover in the browser console (F12). Noisy — leave off unless chasing a problem. | One line per hover in the console (F12). Leave off unless chasing a problem. |
| intro | …Click to keep it on screen, then scroll to resize, drag to move, and double-click for fullscreen. Right-click to save or copy. Escape closes it. | Point at an image to see the full-size original. Click to keep it, then wheel to zoom, drag to move, double-click for fullscreen, right-click to save or copy. Escape closes it. ("scroll to resize" is not what the wheel does) |
| guide "Moving, sizing and zooming" | Drag the grab border or the status bar… | Drag the status bar to move the window; drag an edge or corner to resize it, Shift keeps its shape. The wheel grows the window until you have resized it by hand, then zooms the image inside it. Arrow keys pan, + and − zoom, 0 fits. Click the zoom level in the status bar to type one. |
| guide "One press keeps it" | …a single click on the **picture** pauses… | image |
| guide button | How it works / Hide the details | How it works / Hide |
| reset tip | Puts every option back to its default. Your site list, exceptions and referrer sites are kept. | Every option back to its default; the three lists are kept. (see finding 15) |
| undo tip | Puts everything back to how it was when you opened this window, including the lists. | Everything back to how it was when this window opened, lists included. |
| capHint | (click this window to pin it) | (click to pin) |
| vidOff tip | Stop showing clips in this tab — still images only, until you reload | Stop clips in this tab until reload (true only after finding 5) |
| fs tip | Fill the screen / Leave fullscreen | Fullscreen / Leave fullscreen |
| zval tip | Click to type a zoom level | Click to type a level |
| vrate tip | Playback speed | Speed |
| aa tips | Hard pixels when enlarged — click for smooth / Smooth when enlarged — click for hard pixels | Sharp pixels; click for smooth / Smooth; click for sharp pixels |
| edit tip | One entry per line — paste a list in, or copy this one out | One entry per line; paste in or copy out |
| edit buttons | Edit as text / Done editing | Edit as text / Done |
| add-current | + This Site | + This site |
| ⊘ popover | Never preview this image again. It goes on the Exceptions list in Hover Zoom settings, where you can take it off again. The page itself is not changed. | Never preview this image again. It goes on the Exceptions list in settings, where it can be removed. The page is not changed. |

Every stored key is read somewhere and every panel row applies live or on the next hover; no
orphans. `smoothing` (AA button) and `siteAudio` (sound button) have no row by design.
