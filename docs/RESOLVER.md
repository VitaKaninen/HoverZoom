# Finding the original

How a candidate URL is produced, probed, ranked and upgraded: the URL rules, the linked-page lookup, imgur, video previews, the loading ring, and why probes stay sequential.

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

## Imgur — measured, and why `.webp` is the trap (v0.16.0)

Reported: "it is not working for gifs". Measured live on `i.imgur.com`, 2026-09-03:

| URL | bytes | pixels | content-type |
|---|---|---|---|
| `T22ZUhZ_d.jpg?maxwidth=520&shape=thumb` — what the grid shows | 15.9 KB | 435×244 | image/jpeg |
| `T22ZUhZ_d.jpg` — the generic query-strip rule's candidate | 1.9 KB | **145×81** | image/jpeg |
| `T22ZUhZ.jpg` — the suffix stripped | 3.1 MB | 800×450 | **image/gif** |

The middle row is the finding that matters: **the generic query-strip rule goes the wrong way on
imgur**, producing something smaller than what is displayed. It is correctly rejected by the ratio
gate, so nothing was ever visibly broken — there was simply no candidate left, and a GIF post's
thumbnail is a **static frame**. Hence a host-checked rule, placed **first** in `UPGRADES` so the
high-confidence candidate is probed before the generic one.

Two imgur facts, neither guessable:

- **The extension you ask for is ignored, except `.webp`.** `T22ZUhZ.jpg` returns `image/gif` and
  animates in an `<img>`; `KlprxXs.jpg` returns `image/png`. So the rule never has to guess the
  original's real format — asking for anything but webp returns the stored bytes.
- **`.webp` is a transcode at the same pixel size, and for an animated post it is a STILL.**
  `zFAj8eD.webp?tb` is 240×210 animated, `zFAj8eD.webp` is 412×360 and frozen, `zFAj8eD.jpg` is
  412×360 and moving. That is why the rule rewrites `.webp` → `.jpg` even when the id is already
  bare — the size is unchanged and the picture starts moving.
- **There are TWO kinds of animated imgur post and only one of them has an image form at all.**
  Measured 2026-09-03, both ids live:

  | id | `.jpg` | `.mp4` |
  |---|---|---|
  | `T22ZUhZ` — legacy GIF post | `image/gif`, 3.1 MB, **animated** | 1.8 MB |
  | `EDiKb3d` — video post (`og:type` `video.other`) | `image/jpeg`, 36 KB, **a still frame** | 2.6 MB |

  The row above this one is still true; it is just not the whole story. For a video post the
  moving original exists **only** as `.mp4`, so no URL rule of any kind can make the preview
  animate — the ceiling is a still, and the gate passes it (480×854 against a 292px thumbnail,
  ratio 1.64) so it looks like it worked. This is the real limit behind "it is not working for
  gifs", not the resolver, and lifting it means the viewer displaying video. See the next
  section.

**The restraint is the load-bearing part.** Imgur ids are 5 or 7 characters, so `_d` and a single
trailing `[sbtmlhg]` on a 6- or 8-character basename are unambiguous suffixes, but a **bare** 5- or
7-character id must be left alone: `T22ZUh.jpg` — `T22ZUhZ.jpg` with its last character removed —
is a real 90 KB image of something else, and it *loads*. Over-matching here shows the wrong
picture, which is worse than showing none. Negative tests are in `test-resolver.js`.

Verified against the live grid: 8 of 8 thumbnails resolved to their originals. **One caveat worth
knowing before chasing it as a bug:** an imgur original is sometimes barely larger than the
thumbnail (measured `UnCz83E`, 314×228 against a 300px display = ratio 1.05), and the default
`minRatio` of 1.2 then rejects it — so that post stays a still. There is no way to know a candidate
is animated without fetching it, so this is a settings answer (`minRatio` ≈ 1.0, or
`showEvenIfNotLarger`), not a code one.

**On an imgur post page there is nothing to fix**: an animated post renders as `<video>` with an
`.mp4` src (`DIV.PostVideo-video-wrapper`), and `P4`/`NEVER` refuse it correctly. "Images only" is
the design; the grid thumbnail is the only place a gif is an `<img>` at all.

## Going to the next page for the original (v0.19.0)  · `E15`

Every other mechanism here GUESSES a URL from strings already on the page and verifies it by
loading it. This one asks the site: fetch the page the thumbnail links to and read what it
declares as its own media. The user's framing, and it is the right one: **the media on the item
page is by definition the thing the thumbnail stands for, so there is nothing to compare.**
Hence `linkedMedia()` → `fetchPageMedia()` → `pageMediaFrom()`, and a hit from it **skips the
ratio gate and ends the search**.

- **It runs in PARALLEL with the ordinary probes, not before them.** A document fetch is slow
  beside an image probe, and there is usually a local candidate worth showing meanwhile — so the
  guesses paint something immediately and the authoritative answer replaces it in place through
  the existing progressive-upgrade path. Awaiting it up front would turn every hover into a page
  load before anything appeared. `resolve()` breaks out of the candidate loop the moment
  `trusted` is set, and `await`s the lookup before returning so the spinner keeps turning while
  something really is still running. Note the (since-retired) `keepSearching: false` `break`s rather than
  returning, or a late authoritative answer would be dropped on the floor.
- **`og:url` MUST name the path that was requested, or nothing on the page is trusted.** This is
  not defensive tidiness — it is the reason the feature is safe. Measured against live imgur
  2026-09-03: fetching one gallery URL returned *another post's document entirely* (same byte
  count, wrong id), and a second attempt returned a generic shell whose `og:image` is the imgur
  logo. Either would have put a confident, completely wrong picture on screen, and this candidate
  skips the ratio gate that would otherwise have caught a 1200×630 logo. Test case 26 is that
  page, and the correct outcome is no preview at all.
- **`og:video` before `og:image`**, because on a post that has both the video IS the post and the
  image is its poster frame. `isVideoUrl()` gates it: `og:video` is frequently a player *page*
  (an embed URL), which would never load.
- **Same origin only, and that is a design choice rather than a limitation.** A listing and its
  item pages are on one site essentially by definition; a cross-origin href is an outbound link,
  not "the page for this thumbnail". The payoff is large: plain `fetch` with the user's own
  cookies, so the HTML is what they would actually see — **no `GM_xmlhttpRequest`, no new
  `@grant`, no `@connect` prompt, and no ability to pull arbitrary third-party documents.** If a
  cross-origin case ever genuinely needs this, that is the trade being reopened, not a small
  addition.
- **Bounded elsewhere too:** one fetch per URL, cached in `pageCache` for the tab; only after
  `hoverDelay` has already elapsed; never for a link that is already a media URL (that is an
  ordinary candidate); HTML content-types only, so a link to a PDF is not pulled in full to be
  thrown away; and `blocked()` still applies to the result. It was `followLinks` until v0.39.0,
  and it is unconditional now — the linked page is the site itself saying what the thumbnail
  stands for, so there was never a case for preferring a guess over it.
- **The cost is a real page request per link hovered, and the site sees it.** That is said plainly
  in the setting's description, because it is a behavioural change a user should be able to
  consent to: hovering now touches the server, where before it only touched the image CDN.

Cases 24–26 all hang off `icon.png`, which has **no upgrade candidates of any kind** — so if a
preview appears at all, the page was fetched and read. 24 gets a video the URL could never have
produced, 25 gets an image *no bigger than the thumbnail* (the ratio-gate bypass, which is the
whole point), 26 gets nothing.

**The thing that actually blocked "same treatment for gifs" was the viewer, not the resolver** —
built in v0.18.0, see the next section. For an imgur video post the moving original is only ever
`.mp4` (table above), and gifwow's is only ever `.mp4`; both URLs are derivable with a pure string
rule the existing machinery already held.

## The preview can BE a video (v0.18.0) — "images only" is retired, deliberately  · `E14`

The header invariant said images only, and for the class of post above that means *there is no
answer at all*: an imgur video post's `.jpg` is one frozen frame, and no URL rule can change that.
So the frame grew a second face. Decided by the user 2026-09-03, asked explicitly rather than
assumed, because it is the one stated design rule this project was built around.

- **`mediaEl` is the whole of the design.** `imgEl` and `vidEl` both live in the box, exactly one
  is visible, and `mediaEl` points at it. `layout()` writes geometry to `mediaEl` and nothing
  else, so the "`view` + `reflow()` + `layout()` own all geometry" invariant survives intact —
  the frame having two possible faces changes what is written to, not who writes.
- **`setMedia()` is the only place either `src` is set**, and it clears the one being put away.
  Both halves matter for different reasons: a `<video>` left with a src goes on buffering behind
  `hidden`, and an `<img>` left with one holds its decoded bitmap for the life of the tab. The
  same pair is cleared in `cancel()`'s teardown via `clearMedia()`.
- **`img[hidden],video[hidden]{display:none}` is required**, because the rule above it sets
  `display:block` on both and that outranks the UA's `[hidden]` rule. Without it the idle face
  keeps its box and sits under the live one.
- **The `<video>` has no `controls`, on purpose.** A play button and a scrubber would sit under
  the very clicks that pin, drag and dismiss the window. It is `muted` + `loop` + `autoplay`
  because it stands in for an animated picture, not for a player — which also means the browser's
  autoplay policy never blocks it.
- **`probeVideo()` measures with `loadedmetadata` → `videoWidth`/`videoHeight`, `preload:
  'metadata'`, and a 6 s timeout.** The timeout is load-bearing, not caution: imgur ignores the
  extension you ask for, so `<id>.mp4` on a *static* post answers 200 with `image/jpeg` — neither
  playable nor an error the element must report promptly. Probes are sequential, so one that never
  settles stalls every candidate behind it, and the symptom is the exact silence the spinner
  exists to apologise for. Read every measurement BEFORE clearing `src` and calling `load()`;
  that teardown resets `videoWidth` to 0 and `duration` to `NaN`.
- **An upgrade may not trade motion for a bigger still** (`resolve()`: `if (best && best.video &&
  !dim.video) continue`). "Bigger wins" is right between two pictures and wrong here — a
  1600×1200 frozen frame is not an improvement on a 640×480 clip of the same post, it is a
  different and worse answer. On imgur the still and the mp4 are the *same pixel size*, so probe
  order settles it there and this rule settles it everywhere else. A bigger video still replaces
  a smaller one. Test case 23 is built to fail if this regresses: its thumbnail deliberately
  upgrades to a 1600×1200 still that is probed second.
- **The video candidate is offered FIRST** (the imgur mp4 rule is `UPGRADES[0]`), for the same
  reason — with identical dimensions, first probed is what shows.
- **`playVideos` turns it all off**, and it is checked in `collectCandidates`' `add()` so a
  video candidate is not merely unusable but never *probed*: it would otherwise spend one of
  `MAX_PROBES` ahead of the image candidate behind it. It is not a stored setting — see "The ▶ in
  the status bar" below — and it is a different question from `previewVideos`, which the two names
  are easy to confuse: `previewVideos` is about *what on the page may be hovered*, `playVideos` is
  about *what the frame may display*.
- **Our own `<video>` cannot poison the video gates.** `videoSurfaces()` uses
  `document.getElementsByTagName('video')`, which does not cross a shadow boundary, so the
  preview's clip is invisible to it. It would read as `gifLike` anyway — muted, looping, no
  controls — which is a second, independent reason it is harmless.

### A playing clip is a hoverable picture (v0.20.0) — the gap that made all of this invisible  · `E16`

Reported as "when I hover over a gif, it does not open the preview window", and the diagnosis is
the embarrassing kind: **on imgur's gallery and gifwow's grid the animation IS a `<video>`
element**, so the thing under the pointer was never an `<img>`, and `eligible()`'s third line —
`if (NEVER[el.tagName]) return null;` — refused it outright. No preview, no spinner, nothing,
while every still beside it worked perfectly.

So v0.18.0 taught the frame to *display* video and v0.19.0 taught the resolver to *ask the linked
page*, and neither could ever be reached from the one element that needed them. Both features
were real and both were unreachable. **The lesson is about the shape of the mistake, not the
line:** a capability was added at the end of a pipeline whose entrance still rejected the input
that capability existed for. It was even written down — v0.18.0's notes said "an imgur-style
`<video>` grid item is still refused as a source by `NEVER`" — and then not revisited when the
user asked for the rest. A known limitation recorded in the docs is not a limitation the user
agreed to.

`eligible()` now takes a `VIDEO` branch **before** the `NEVER` test:

- **Only a `gifLike()` clip**, so a real player is still refused and a watch page is unaffected.
- **`playVideos` gates it** (the session flag), because a clip the frame cannot display is not
  worth hovering.
- **Only the LINK gate applies** (`videoLinkReason()`, split out of `videoReason()` for this).
  The other three video tests cannot be used on a video: it is trivially "inside a `<video>`",
  its own ancestor walk finds it, and it sits inside its own rectangle — all three self-match and
  would refuse every clip on every page. The link is the one signal that still means something,
  and it is what keeps case 28 (the same clip under a `/watch?` link) refused.
- **`shownUrl()` reads `currentSrc` for a video**, not `src`: a clip is often given `<source>`
  children and then `src` is the empty string.

For an imgur grid clip the resolution path is then the *linked page*, not a URL rule — its
`_lq`-style basename does not match `imgurId()`, but the `/gallery/…` link does resolve. Which is
exactly the mechanism asked for: go to the next page and bring back what is there.

Cases 27 and 28 are that shape with **no `<img>` in the card at all**.

**Known cost, stated because it is real:** on a *static* imgur post the mp4 candidate is probed
and cannot succeed, spending one request per hover. Nothing in a thumbnail URL says whether the
post behind it moves, so the choice is that or no gifs.

**Not verified here, and worth measuring on the real site:** whether imgur's grid serves a
*truncated* clip that differs from the post page's. `<id>.mp4` and `<id>_lq.mp4` measured
identical durations (10.85 s and 10.85 s; 5.04 s and 5.04 s — `_lq` is lower resolution, not
shorter), and imgur's grid never mounted a `<video>` in the in-app browser, so the grid's own URL
shape was never observed. The rule targets `<id>.mp4`, which is the full-length post either way.

## Progressive resolution, and why probes stay sequential  · `E6` & `E8`

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

`place()` deliberately does **not** cancel the in-flight resolve; placing is a reason to keep
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
