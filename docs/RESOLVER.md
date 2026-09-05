# Finding the original

How a candidate URL is produced, probed, ranked and upgraded. Headings carry the `E` id that owns
them.

## URL rules over-match silently, and that is worse than under-matching

**A wrong candidate that happens to load shows the *wrong image*; a missing candidate just shows
nothing.** So every rule in `UPGRADES` needs negative tests, and they matter more than the positive
ones — see `none()` in `test-resolver.js`.

The worked example: the first cut of the Cloudinary/Imgix transform-segment rule was
`/\/(?:[a-z]{1,3}_[^/,]+)(?:,[a-z]{1,3}_[^/,]+)*\//g`, which ate ordinary path segments like
`/en_US/`, `/v_2/` and `/a_b/` on any host. It now requires every comma-part to be a `key_value`
pair from a known transform-key set **and** the segment to carry a numeric `w_` or `h_`.

**A first run of a new suite that passes 33/33 deserves suspicion, not celebration** — that
over-match was invisible until real URLs were printed and eyeballed.

**`linkParamCandidates()` needs the same discipline.** It pulls any query-param value that is an
absolute http(s) URL passing `looksLikeImage()` out of an ancestor link, which is how
`/imgres?imgurl=…` works without naming Google. Two guards keep it harmless: values must be
**absolute** (a bare path is ambiguous), and **`THUMB_PARAM` names are skipped** so a `?thumb=` never
displaces the original. Everything it returns still faces the ratio gate, so the worst case is a
wasted probe — but only because of those guards.

## Progressive resolution · `E6` · `E8`

`resolve()` takes an `onHit` callback and fires it for every strictly larger candidate, so the first
match paints immediately and later ones replace it via `upgradeViewer()`. The ring docks into the
frame's lower right (`dockSpinner()`) while the search continues — the only signal that what you are
looking at is not final.

**Do not parallelise the probes into a race.** The candidate list is ordered by *heuristic
confidence*, not measured size — `data-*` attributes, then srcset widest-first, then rewrites, then
the link, then the displayed src last. Selection is "first in list order that clears the gate", so
taking the first *response* instead hands the decision to whichever server answers fastest, which
systematically favours the smallest file. If latency ever needs fixing, the safe shape is: start all
probes at once, then `await` them **in list order** — same result, wall clock drops to the slowest
one actually needed, at the cost of always issuing N requests. A bandwidth decision, not a
correctness one.

**Leaving mid-probe does not abort the in-flight loads.** They finish and populate `probeCache`,
which is why an image "works if you come back to it later" — a cache warming up, not a fixed bug.
That is why the silence needed a UI rather than a code fix.

`place()` deliberately does **not** cancel the in-flight resolve; placing is a reason to keep
looking.

### The loading ring

`.spin` is an SVG ring, **indeterminate** — a fixed arc (`ARC_FRAC`, 28 % of the ring) sweeping a
full track at 400°/s. It says "still working" and deliberately nothing else.

**The determinate version was removed because it could not be honest, and must not come back.** Its
denominator was `candidates.length`, the worst case; the run stops at the first candidate that clears
the ratio gate, usually the first or second of up to eight. So the arc never once finished where it
said it would. No honest denominator exists here: the cost is a network fetch of unknown size and the
stopping point is data-dependent. `CREEP_TAU`, `CREEP_MAX` and `resolve()`'s `onProgress` parameter
went with it.

- **`setInterval`, never `requestAnimationFrame`, and not a CSS animation either.** rAF is starved
  whenever the compositor decides the page is not worth animating — **the Browser pane delivers zero
  animation frames while reporting `visibilityState: "visible"`**, and real browsers do the same for
  occluded windows. A frozen ring is indistinguishable from a hung script. Verify by reading the
  attribute over time (`svg.style.transform` advances 24° every 60 ms), never by screenshot.
- **The disc behind the ring is themed to the BROWSER, not the page** (`applySpinTheme()`, called per
  hover). It is the only part of the overlay sitting on the bare page rather than the frame's own
  dark background. `darkMode()` reads `prefers-color-scheme` — keying off the *page's* computed
  background picks the light palette on a white page and draws a near-white disc on white, which is
  "matching" and invisible. The page reading survives only as the fallback where the media query is
  unsupported; `spinnerTheme` (auto/dark/light) overrides both.
- **Contrast is deliberate on both sides:** 34 px, 4.5 px strokes, a 1.5 px rim at .45 alpha, track
  at .22–.30. **The rim is what separates the disc from arbitrary page content behind it** — at .20
  there is effectively no edge, which is most of why an earlier cut read as a smudge.
- `SPINNER_DELAY` (150 ms) keeps it from flashing on cached hits, but `buildViewer()` runs
  *immediately* in `showSpinner()` so the ring exists before anything can need it. `hideSpinner()` is
  in a `finally`, so the ring stops on every outcome including a throw — a ring still turning after
  the search stopped is a lie.

## Imgur — `.webp` is the trap

Measured live on `i.imgur.com`:

| URL | bytes | pixels | content-type |
|---|---|---|---|
| `T22ZUhZ_d.jpg?maxwidth=520&shape=thumb` — what the grid shows | 15.9 KB | 435×244 | image/jpeg |
| `T22ZUhZ_d.jpg` — the generic query-strip candidate | 1.9 KB | **145×81** | image/jpeg |
| `T22ZUhZ.jpg` — the suffix stripped | 3.1 MB | 800×450 | **image/gif** |

The middle row is the finding: **the generic query-strip rule goes the wrong way on imgur**,
producing something smaller than what is displayed. It is correctly rejected by the ratio gate, so
nothing was visibly broken — there was simply no candidate left, and a GIF post's thumbnail is a
*static frame*. Hence a host-checked rule, placed **first** in `UPGRADES` so the high-confidence
candidate is probed before the generic one.

Two imgur facts, neither guessable:

- **The extension you ask for is ignored, except `.webp`.** `T22ZUhZ.jpg` returns `image/gif` and
  animates in an `<img>`; `KlprxXs.jpg` returns `image/png`. So the rule never has to guess the
  original's format.
- **`.webp` is a transcode at the same pixel size, and for an animated post it is a STILL.**
  `zFAj8eD.webp` is 412×360 and frozen; `zFAj8eD.jpg` is 412×360 and moving. That is why the rule
  rewrites `.webp` → `.jpg` even when the id is already bare.

**There are TWO kinds of animated imgur post and only one has an image form at all:**

| id | `.jpg` | `.mp4` |
|---|---|---|
| `T22ZUhZ` — legacy GIF post | `image/gif`, 3.1 MB, **animated** | 1.8 MB |
| `EDiKb3d` — video post (`og:type` `video.other`) | `image/jpeg`, 36 KB, **a still frame** | 2.6 MB |

For a video post the moving original exists **only** as `.mp4`, so no URL rule can make the preview
animate — and the gate passes the still (480×854 against a 292 px thumbnail) so it looks like it
worked. That is the real limit behind "it is not working for gifs", and lifting it meant the viewer
learning to display video.

**The restraint is the load-bearing part.** Imgur ids are 5 or 7 characters, so `_d` and a single
trailing `[sbtmlhg]` on a 6- or 8-character basename are unambiguous suffixes — but a **bare** 5- or
7-character id must be left alone: `T22ZUh.jpg` (`T22ZUhZ.jpg` with its last character removed) is a
real 90 KB image of something else, **and it loads**. Negative tests are in `test-resolver.js`.

**One caveat before chasing it as a bug:** an imgur original is sometimes barely larger than the
thumbnail (measured `UnCz83E`, 314×228 against a 300 px display = ratio 1.05), and the default
`minRatio` of 1.2 rejects it, so that post stays a still. There is no way to know a candidate is
animated without fetching it — a settings answer (`minRatio` ≈ 1.0, or `showEvenIfNotLarger`), not a
code one.

**On an imgur post page there is nothing to fix**: an animated post renders as `<video>` with an
`.mp4` src, and the video gates refuse it correctly. The grid thumbnail is the only place a gif is
an `<img>` at all.

## Going to the next page for the original · `E15`

Every other mechanism here GUESSES a URL from strings on the page and verifies it by loading it. This
one asks the site: fetch the page the thumbnail links to and read what it declares as its own media.
**The media on the item page is by definition the thing the thumbnail stands for, so there is nothing
to compare** — a hit from `linkedMedia()` → `fetchPageMedia()` → `pageMediaFrom()` **skips the ratio
gate and ends the search**.

- **It runs in PARALLEL with the ordinary probes, not before them.** A document fetch is slow beside
  an image probe, and there is usually a local candidate worth showing meanwhile — so the guesses
  paint something immediately and the authoritative answer replaces it through the existing upgrade
  path. Awaiting it up front turns every hover into a page load before anything appears. `resolve()`
  breaks out of the candidate loop the moment `trusted` is set, and `await`s the lookup before
  returning so the spinner keeps turning while something really is still running.
- **`og:url` MUST name the path that was requested, or nothing on the page is trusted.** This is not
  defensive tidiness — it is the reason the feature is safe. Measured against live imgur: fetching
  one gallery URL returned *another post's document entirely* (same byte count, wrong id), and a
  second attempt returned a generic shell whose `og:image` is the imgur logo. Either would have put a
  confident, completely wrong picture on screen, **and this candidate skips the ratio gate that would
  otherwise have caught a 1200×630 logo.** Test case 26 is that page; the correct outcome is no
  preview at all.
- **`og:video` before `og:image`**, because on a post that has both, the video IS the post and the
  image is its poster frame. `isVideoUrl()` gates it: `og:video` is frequently a player *page* (an
  embed URL), which would never load.
- **Same origin only, and that is a design choice rather than a limitation.** A listing and its item
  pages are on one site essentially by definition; a cross-origin href is an outbound link, not "the
  page for this thumbnail". The payoff is large: plain `fetch` with the user's own cookies, so the
  HTML is what they would actually see — **no `GM_xmlhttpRequest`, no new `@grant`, no `@connect`
  prompt, and no ability to pull arbitrary third-party documents.** A cross-origin case reopens that
  trade; it is not a small addition.
- **Bounded elsewhere too:** one fetch per URL, cached in `pageCache` for the tab; only after
  `hoverDelay` has elapsed; never for a link that is already a media URL; HTML content-types only, so
  a link to a PDF is not pulled in full to be thrown away; and `blocked()` still applies to the
  result.
- **The cost is a real page request per link hovered, and the site sees it.** Hovering now touches the
  server, where before it only touched the image CDN. It was behind `followLinks` and is unconditional
  now — the linked page is the site itself saying what the thumbnail stands for, so there was never a
  case for preferring a guess over it. Said plainly in the panel's **How it works** text.

Cases 24–26 all hang off `icon.png`, which has **no upgrade candidates of any kind** — so if a
preview appears at all, the page was fetched and read. 24 gets a video the URL could never have
produced; 25 gets an image *no bigger than the thumbnail* and 26 gets nothing.

**The required upsize applies to the declared candidate too, since v0.40.0**, and since v0.42.0 the
test is `>` rather than `>=` — so `minRatio` 1 means "anything bigger at all" without asking anyone
to type 1.000001, and 25 (declared image exactly the size of the thumbnail) fails it at every
value. Only *Preview pictures that are already full size* shows it. It used to bypass the gate on the grounds that the page is authoritative, and
that is still true about *what* the thumbnail stands for; it is not an answer to *is this worth a
window*. Reported as "I set Required upsize to 100× and everything still previews", which is exactly
what a link-following site did.

**gifwow is carried by the URL rule, not by its own `/go/` page** — that page declares `og:url` =
`https://gifpit.com/gifs/…`, a different host and path from the one requested, so the `og:url` guard
correctly trusts nothing on it.

## The preview can BE a video · `E14`

"Images only" is retired deliberately. For an imgur video post there is no image answer at all, so
the frame grew a second face.

- **`mediaEl` is the whole of the design.** `imgEl` and `vidEl` both live in the box, exactly one is
  visible, and `mediaEl` points at it. `layout()` writes geometry to `mediaEl` and nothing else, so
  the "`view` + `reflow()` + `layout()` own all geometry" invariant survives intact — what changes is
  what it writes *to*, not who writes.
- **`setMedia()` is the only place either `src` is set**, and it clears the one being put away. Both
  halves matter for different reasons: a `<video>` left with a src goes on buffering behind `hidden`,
  and an `<img>` left with one holds its decoded bitmap for the life of the tab. The same pair is
  cleared in `cancel()`'s teardown via `clearMedia()`.
- **`img[hidden],video[hidden]{display:none}` is required**, because the rule above sets
  `display:block` on both and outranks the UA's `[hidden]` rule. Without it the idle face keeps its
  box and sits under the live one.
- **No `controls`, on purpose.** A play button and a scrubber would sit under the very clicks that
  pin, drag and dismiss the window. It is `muted` + `loop` + `autoplay` because it stands in for an
  animated picture, not a player — which also means the autoplay policy never blocks it.
- **`probeVideo()` measures with `loadedmetadata` → `videoWidth`/`videoHeight`, `preload: 'metadata'`,
  and a 6 s timeout.** The timeout is load-bearing, not caution: imgur ignores the extension you ask
  for, so `<id>.mp4` on a *static* post answers 200 with `image/jpeg` — neither playable nor an error
  the element must report promptly. Probes are sequential, so one that never settles stalls every
  candidate behind it. **Read every measurement BEFORE clearing `src` and calling `load()`**; that
  teardown resets `videoWidth` to 0 and `duration` to `NaN`.
- **An upgrade may not trade motion for a bigger still** (`if (best && best.video && !dim.video)
  continue`). "Bigger wins" is right between two pictures and wrong here — a 1600×1200 frozen frame is
  not an improvement on a 640×480 clip of the same post. A bigger video still replaces a smaller one.
  Test case 23 is built to fail if this regresses.
- **The video candidate is offered FIRST** (the imgur mp4 rule is `UPGRADES[0]`) — with identical
  dimensions, first probed is what shows.
- **`playVideos` is checked in `collectCandidates`' `add()`**, so a video candidate is not merely
  unusable but never *probed*; it would otherwise spend one of `MAX_PROBES`. It is a session flag, not
  a stored setting — see [`SETTINGS.md`](SETTINGS.md) `E27`. Do not confuse it with `previewVideos`:
  **`previewVideos` is about what on the page may be hovered, `playVideos` about what the frame may
  display.**
- **Our own `<video>` cannot poison the video gates.** `videoSurfaces()` uses
  `document.getElementsByTagName('video')`, which does not cross a shadow boundary. It would read as
  `gifLike` anyway — a second, independent reason it is harmless.

### A playing clip is a hoverable picture · `E16`

On imgur's gallery and gifwow's grid **the animation IS a `<video>` element**, so the thing under the
pointer was never an `<img>` and `eligible()`'s `NEVER` test refused it outright. No preview, no
spinner, nothing, while every still beside it worked.

So `E14` taught the frame to *display* video and `E15` taught the resolver to *ask the linked page*,
and neither could be reached from the one element that needed them. **The lesson is the shape of the
mistake, not the line: a capability was added at the end of a pipeline whose entrance still rejected
the input that capability existed for.** It was even written down as a known limitation and then not
revisited — a limitation recorded in the docs is not a limitation the user agreed to.

`eligible()` takes a `VIDEO` branch **before** the `NEVER` test:

- **Only a `gifLike()` clip**, so a real player is still refused and a watch page is unaffected.
- **`playVideos` gates it** — a clip the frame cannot display is not worth hovering.
- **Only the LINK gate applies** (`videoLinkReason()`, split out of `videoReason()` for this). The
  other three video tests cannot be used on a video: it is trivially "inside a `<video>`", its own
  ancestor walk finds it, and it sits inside its own rectangle — **all three self-match and would
  refuse every clip on every page.** The link is the one signal that still means something, and it is
  what keeps case 28 (the same clip under a `/watch?` link) refused.
- **`shownUrl()` reads `currentSrc` for a video**, not `src`: a clip is often given `<source>`
  children, and then `src` is the empty string.

For an imgur grid clip the resolution path is the *linked page*, not a URL rule — its `_lq`-style
basename does not match `imgurId()`, but the `/gallery/…` link resolves.

**Known cost:** on a *static* imgur post the mp4 candidate is probed and cannot succeed, spending one
request per hover. Nothing in a thumbnail URL says whether the post behind it moves, so the choice is
that or no gifs.

**Not verified, and worth measuring on the real site:** whether imgur's grid serves a *truncated* clip
differing from the post page's. `<id>.mp4` and `<id>_lq.mp4` measured identical durations (`_lq` is
lower resolution, not shorter), and imgur's grid never mounted a `<video>` in the in-app browser.

## Google Images cannot be fixed generically — measured, not assumed

Reported that HZ+ returns full-size originals there and this script returns 500–700 px. Inspected
live on `google.com/search?udm=2` in real Chrome (the in-app browser gets `/sorry/index` bot
detection). What a result thumbnail offers:

| Source | What Google gives |
|---|---|
| `src` | `encrypted-tbn0.gstatic.com/images?q=tbn:<opaque token>` — no extension, no size params |
| `srcset` | **absent** |
| `data-*` on the img | `data-csiid`, `data-atf` only — no URL |
| `data-*` on 6 levels of ancestors | `data-ved`, `data-eqld`, `data-preview-id` (empty) — no URL |
| ancestor `<a href>` | **the anchor has no `href` attribute at all** |

Natural sizes measured 678×452, 245×205, 503×397 — which *is* the reported 500–700 px. **Nothing is
malfunctioning:** the thumbnail is the only candidate that exists, it clears the ratio gate against a
240 px display, and it gets shown. The original URL is present only inside ~0.94 MB of inline script
JSON, as `["<url>",h,w]` triples near the thumbnail's `tbn:` token. (HZ+'s own `a[href*="imgurl="]`
selector is stale for this layout; its Google support must ride on the script-JSON path.)

A prototype extractor run against the live page: **15/15 resolved on the initial payload** (median
1.9× gain, max 13×), **39/226 after "More results"** — everything past that arrives by XHR and its
originals are not in the DOM at all. Cost 0.2–0.3 ms per lookup.

**The invariant question, stated properly.** "No DOM scanning" is worded more broadly than the thing
it protects. Every bug it exists to prevent — lazy-loaded src, images added after load, SPA
navigation, scan races — comes from **deciding eligibility ahead of time and binding to elements**. A
hover-time `querySelectorAll('script')` binds nothing, caches nothing, and re-reads live every time.
**Do not reject it by quoting the rule; the rule is about pre-passes.** The real objections are:

1. **It is the first site-specific rule**, reading Google's private JSON shape, which can change with
   no warning and no error — the preview would quietly go back to thumbnails.
2. **`UPGRADES` cannot host it.** Every rule there is a pure URL→URL function, which is the only
   reason `test-resolver.js` can test them offline with no DOM. This needs a new extension point
   taking the element, plus a saved-page fixture.
3. **It is a partial fix** — the 17 % above. Completing it means hooking XHR on Google, which is a
   permanent network interception plus a cache, and a site plugin in everything but name.

So: (a) do nothing and keep HZ+ for Google; (b) hover-time lookup, host-gated, accepting
first-batch-only coverage and silent breakage; (c) (b) plus XHR hooking, which is the thing this
project exists not to be. **Not decided — ask before building any of it.**

What was added for this and is still worth having, just not for Google: `linkParamCandidates()` (the
generic `?imgurl=`-style rule) and the `/s0/` path-segment form of the googleusercontent size token.
