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

## An opaque size code on the stem · v0.57.0

The named-vocabulary rule strips suffixes it can read — `_thumb`, `_small`, `_tn`. Sites also use
codes that mean nothing outside that site: `my.evilmilk.com` serves `/p/<id>_t3.jpg`. The rule below
it strips **any** short code and lets the probe decide:

    /^(.*\/[^/]{3,})[_-](?:[a-z]{2}\d{0,2}|[a-z]\d{1,2})(\.[a-z0-9]+)$/i

**Never interpret the suffix — strip it and measure.** The two evilmilk hosts are the proof that its
meaning is not knowable from the string:

| | `_s` is |
|---|---|
| `www.evilmilk.com` | the **thumbnail** (140×140), original at `/pictures/X.jpg` |
| `my.evilmilk.com` | a **larger** copy (600×923), and *still* not the biggest |

Measured live 2026-09-05, `my.evilmilk.com` is a three-rung ladder — `_t3` 340×523, `_s` 600×923,
**bare 720×1108**. So the bare stem is the top rung, which is why stripping beats enumerating a
vocabulary of suffixes to try: one candidate, no guessing at what `_s` or `_b` might mean here.

- **The token must be at least two characters**, which is the whole safety margin. A single letter is
  too ambiguous — it would strip imgur's `_d` (breaking that rule's host-check negative test) and the
  `_a`/`_b` of a numbered series, where the bare stem may be a *different picture*. `_t3` survives as
  one letter plus a digit.
- **Digit-led tokens are excluded** so `_2x` and `_1` are left alone: a bare number is a series index,
  not a size. `-150x150` and `_400x400` belong to the WordPress and Shopify rules above.
- **The remaining stem must be ≥3 characters**, so `ab_t3.jpg` is left alone.
- The accepted residual risk is a bare stem that exists, loads, is bigger, and is a *different*
  picture. `sameShape()` will not catch it — `ASPECT_TOL` is 4, far too loose to distinguish two
  photographs. Nothing else guards it, so the negative tests in `test-resolver.js` are the control.

**`E15` cannot help on this site**, which is why the URL rule had to. The grid item is
`<div class="it go" data-url="...">` with **no `<a href>` anywhere** — clicking opens a JS lightbox
that pushes `/go/<id>.htm` through the History API without leaving the page. There is no link for
`linkedMedia()` to follow and no separate document to fetch.

### The "it previews the same image" report is the gate working

Reported as a bug: hovering shows a preview of the identical URL, and raising *Required upsize* to
1.1 does not stop it. It is not a bug. The masonry layout renders the 340 px file in a box whose
width follows the viewport — measured at 311 px on a 1000 px viewport, and *upscaled* to 400 px on a
1280 px one. At 311 px the file really is 1.09× the displayed size, so `bigEnough()` passes at
`minRatio` 1 and sits on the knife edge at 1.1 (`340 > 342.1` is false, but a 309 px column flips
it). The preview looked identical because it was the same picture, 9 % bigger. Finding the 720 px
original is what actually answers the complaint — **a marginal upsize is a symptom that the real
original has not been found yet, not a reason to raise the threshold.**

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
- **`SPIN_SIZE` (24 px, was 34 until v0.69.0) is the only size to change** — the `.spin` CSS reads
  it, and the SVG's `viewBox` stays 36×36, so the disc, strokes and rim scale with it.
- **Contrast is deliberate on both sides:** 4.5 px strokes, a 1.5 px rim at .45 alpha, track
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
animated without fetching it — a settings answer (`minRatio` at or below 1), not a code one.

**On an imgur post page there is nothing to fix**: an animated post renders as `<video>` with an
`.mp4` src, and the video gates refuse it correctly. The grid thumbnail is the only place a gif is
an `<img>` at all.

## Going to the next page for the original · `E15`

Every other mechanism here GUESSES a URL from strings on the page and verifies it by loading it. This
one asks the site: fetch the page the thumbnail links to and read the media it declares — and, since
v0.56.0, the media in its own markup. **The media on the item page is by definition the thing the
thumbnail stands for**, so a hit from `linkedMedia()` → `fetchPageMedia()` → `pageMediaFrom()` **ends
the search** — the candidate loop breaks the moment `trusted` is set. It does *not* skip the gates:
`sameShape()` and `bigEnough()` apply to it exactly as they do to a guess (see the upsize note below
— v0.40.0 reversed the original exemption).

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
- **When `og:` is the share card, the page's own markup is the answer · v0.56.0.** A site may point
  `og:image` at the *thumbnail* — the share card wants a small square, not the original. evilmilk.com
  does exactly this: `/pictures/X.htm` declares `og:image` = `/thumbs/X_s.jpg`, the 140×140 already on
  screen, while the 1001px original is only in `<img id="mainpic">`. The og answer then fails the
  upsize gate and the site previewed nothing at all. So `pageMediaFrom()` returns **both** what the
  page declares and `pageBodyMedia()` — its same-origin `<img>`/`<video>` srcs — and `resolve()` tries
  them together, capped at `LINKED_TRIES` (4).
  - **A body image is only tried when `sameStem()` says it names the same picture** as the thumbnail:
    identical filename stems, or one stem plus a short separator-led tail (`_s`, `-150x150`,
    `_thumbnail`). Without that filter this path would happily pick a banner ad off the item page —
    and it is the one path that gets called authoritative. The tail is capped at 10 characters so
    `X_The_Sequel` is not read as a size variant of `X`.
  - **Resolve against the FETCHED page, not this one.** The document comes from `DOMParser`, so
    `node.src` would resolve relative paths against the listing page. `pageBodyMedia()` reads
    `getAttribute('src')` and resolves against `pageUrl` itself.
  - **The largest qualifying answer wins, not the first, and never the URL already on screen.** `og:`
    is not automatically better than the markup — it can be a mid-size share crop that passes the
    upsize gate while the real original sits in the body.

### A matching filename outranks the shape test · v0.58.0

`angryduck.cc` is a grid of clips where **some posts previewed and some did not, with byte-identical
markup on both the listing and the item pages**. The difference was never in the markup — it was the
thumbnail's shape. Measured live 2026-09-06:

| post | thumbnail | clip | apart | |
|---|---|---|---|---|
| beach-day | 160×70 (2.29) | 270×480 (0.56) | **4.06×** | refused |
| whooooopsies | 160×70 (2.29) | 270×480 (0.56) | **4.06×** | refused |
| yeah-no537146 | 160×144 (1.11) | 480×480 (1.00) | 1.11× | previewed |
| what-are-you986075 | 160×104 (1.54) | 338×480 (0.70) | 2.19× | previewed |

`ASPECT_TOL` is 4. The site letterboxes portrait clips into a fixed-shape thumbnail, so the two
portrait posts land at 4.06× — over by a hair — and `sameShape()` vetoed them. Raising the tolerance
would be fitting the constant to one site and would weaken it everywhere else.

**So a body candidate matched by `sameStem()` skips `sameShape()`.** The gate is a *heuristic for
identity*: same shape, probably the same picture. A matching filename on the page the thumbnail links
to is *evidence* of identity, and when the evidence is present the heuristic has nothing left to add
— a thumbnail's shape describes the site's crop, not the media behind it.

- **`bigEnough()` still applies**, to this and to every other candidate. Identity and worth are
  different questions: the page is authoritative about *what* the thumbnail stands for, never about
  whether it is worth a window. That is the same line v0.40.0 drew.
- **The exemption does not extend to `og:` candidates**, which keep the shape test — an `og:image`
  is not filename-matched, and the banner-links-to-its-section case in [`GATES.md`](GATES.md) is
  exactly that shape of mistake.
- This page declares **no `og:` of any kind**, so the media comes only from `pageBodyMedia()` reading
  `video source[src]` — the `<video>` carries no `src` of its own. Case 42 is the fixture.
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
value **of 1 or more**; since v0.43.0 the floor is 0.1, and anything below 1 shows it. It used to
bypass the gate on the grounds that the page is authoritative, and
that is still true about *what* the thumbnail stands for; it is not an answer to *is this worth a
window*. Reported as "I set Required upsize to 100× and everything still previews", which is exactly
what a link-following site did.

**gifwow is carried by the URL rule, not by its own `/go/` page** — that page declares `og:url` =
`https://gifpit.com/gifs/…`, a different host and path from the one requested, so the `og:url` guard
correctly trusts nothing on it.

### The anchor's own query outranks the page behind it · `E48` · v0.79.0

When the ancestor link already names a media URL in its query, `linkedMedia()` is **not** run at all
and that URL is added with `keep: true`. Two independent reasons, and the first is a live bug:

- **An internal result page answers `og:image` with the site's generic share card.** Measured on Bing
  image search: every result thumbnail links to `bing.com/images/search?view=detailV2&…`, whose
  `og:image` is `www.bing.com/sa/simg/facebook_sharing_5.png` — 988×525, the same card on every page
  of the site. It became `trusted`, and `betterHit()` puts `trusted` above size unconditionally, so a
  988×525 logo beat a 4000×2666 original that was named in the same anchor's own `mediaurl=`.
  `sameShape()` cannot catch this: `ASPECT_TOL` is **4**, a "wildly different picture" detector, and
  1.88 against 1.33 is nowhere near it. Yandex has the identical shape (`img_url=`) and the same trap.
- **The fetch is redundant.** The anchor already declared the answer; going to the page can only
  confirm it or, as above, contradict it with furniture.

Measured after the change on four live Bing results: 4/4 declared, resolving to 4000×2666, 2560×1440
and 3072×1728 — the fourth's original is genuinely dead, and falling back to the thumbnail is right.

#### The anchor must own the image · v0.80.0

Fixing the above made a second bug visible, because the wrong URL was now *kept*: a card links once
but holds a **strip of extra thumbnails inside the same anchor**, so `closest('a')` hands all of them
the card's `mediaurl` and every strip thumb previewed its neighbour's picture. Measured on one Bing
page: **18 of 73** linked images, every one an 89×89 strip thumb in an anchor holding three images,
and in 18/18 the wrong ones were *not the largest image in that anchor* while the right ones always
were. So `anchorOwns()` gates the whole anchor branch — its query, the link itself, and
`linkedMedia()` — on being the biggest `<img>` the anchor contains.

- **A tie leaves everyone an owner.** `>` not `>=`, so `<a>` with a front image and an equal-sized
  hover-swap keeps working. A grid of equal images under one anchor would therefore all claim its
  declared URL; no measured layout does this, and refusing on a tie would cost the swap case.
#### The parameter's NAME can declare an image · v0.81.0

`looksLikeImage()` wanted an extension, and Bing's `mediaurl` is often an extensionless resize
endpoint (`…/wp-content/uploads/2022/09/resize/1280x720!/quality/90/`). The candidate was dropped,
`skipLinkedPage()` therefore said no, and the share card came back by the long way round. A parameter
literally called `mediaurl` / `imgurl` / `img_url` / `piurl` **has already said its value is an
image**; requiring the extension as well is asking for the same proof twice. `IMAGE_PARAM` accepts
those names without one — `THUMB_PARAM` is still tested first, and a bare `?url=` still needs an
extension because on a link that usually means a redirect target.

#### A share card the current page also declares is furniture · v0.82.0

The remaining case has no media URL on the anchor at all — Bing's cluster and related-search tiles
link to another `bing.com/images/search` page — so `linkedMedia()` runs and gets the card again.
The free guard: **this page declares `og:image` = `…/facebook_sharing_5.png` for itself**, and so does
every page it links to. `pageMediaFrom()` now rejects a linked page's `og:image` when it equals
`ownOgImage()`. One cached `querySelector`, no request, no site knowledge.

Audited over one live Bing page, 164 linked images: **82 resolve** from the anchor's declared URL
(4 of them only because of the `IMAGE_PARAM` rule), **45 decline** as not the anchor's owner, and the
**37** that would otherwise have shown the share card are now refused by this guard.

- **A declined strip thumb now previews nothing at all**, which is correct but incomplete: its own
  `th.bing.com/th/id/OIP.<id>?w=89&h=89&…` gives an honest 474×711 once the size parameters are
  dropped. **Done in v0.83.0** — see `E50` below.

## Size parameters on an extensionless CDN path · `E50` · v0.83.0

The param-drop rule required `MEDIA_RE` on the pathname, which excludes every extensionless image
CDN. A second rule now covers those, gated so it cannot repeat the `/rotate.php` mistake — there the
query **is** the request, and stripping it asks a different question and returns an unrelated
picture, consistently enough that no later check catches it.

Two guards, both necessary:

- **No script endpoint** — `.php`, `.aspx`, `.jsp`, `.cgi` and friends.
- **The last path segment must be an opaque id**: 12+ characters with at least one letter and one
  digit. `OIP.XwOEWPBVs8clfI8jAokcPwHaLH` passes; `rotate`, `image_proxy` and `_next/image` do not.
  The point is that such a URL's identity lives in the **path**, so the query can only be a rendering
  instruction.

Measured on `th.bing.com`: dropping just `w` and `h` takes 89×89 to **474×711** — the full uncropped
frame. The other parameters (`c`, `rs`, `qlt`, `pid`, `rm`) make no difference, so the rule stays on
the shared `SIZE_PARAMS` list and needs no CDN-specific knowledge.

**Raising a size parameter would have been wrong.** The same CDN answers `?w=3000&h=3000` with a real
3000×3000 upscale of a 474×315 file, which the size gate cannot tell from detail. Drop, never raise.

`linkParamCandidates()` now also runs on the **displayed src**, because an image proxy carries its
source in its own query rather than on a link (`?url=`, `?piurl=`, `?imgurl=`, `?u=`). The value must
still be an absolute `http(s)` URL that `looksLikeImage()` accepts, so a proxy pointing at another
extensionless proxy — which is what the Bing-backed engines below do — adds nothing.

### The page's CSP can forbid the probe outright · `E49`

**`img-src` applies to the userscript's `new Image()`.** Measured end-to-end with the installed
script, not assumed: `test-pages/csp-img-src.html` serves one fixture twice, and under
`img-src 'self'` a cross-origin original behind a link is refused while the same-origin one on the
same page still resolves. The failure is silent and ~1 ms, identical to a 404.

This is the whole story on the privacy search engines, and no URL rule can be written around it.
Measured 2026-09-07, headers read directly with `curl` where a browser was challenged:

| Engine | off-site probe | `blob:` | `data:` | Today |
|---|---|---|---|---|
| Bing | allowed (no CSP) | — | — | originals, since v0.79.0–v0.82.0 |
| Yandex (`img-src 'self' * blob: data:`) | allowed | — | — | originals via `img_url=`; 2560×1405 verified |
| Ecosia | allowed | — | — | **already worked** — 4000×2666 verified |
| Google | allowed | — | — | thumbnail only, and not fixable generically (above) |
| Brave, DuckDuckGo, Startpage, Qwant | **blocked** | yes | yes | thumbnail only |
| Mojeek, `searx.be` (SearXNG) | **blocked** | **no** | yes | thumbnail only |

Two consequences:

- **A blocked probe is identifiable for free.** `securitypolicyviolation` on `document` carries
  `blockedURI` and `violatedDirective`, needs no network request, and fires before any timeout. It is
  the one failure kind that can be named exactly, and it must not be spent as a retry.
**Built in v0.83.0.** `probeImage()` treats a refusal as a redirection, not a failure: on `error` it
asks `cspRefused()` — the exact URL from a recorded violation, or any off-site URL once the page has
refused one — and if so hands off to `bytesFor()`, which fetches through `GM_xmlhttpRequest` and
measures the result. A hit may then carry a **`display`** URL separate from its real `url`, and
`setMedia()` writes `res.display || res.url`. The caption keeps the real name, so the status bar says
`scene.jpg`, never a blob UUID.

Four things this needed that are easy to get wrong:

- **`@connect *` in the header.** Without it Tampermonkey prompts per host, and a pending prompt
  means GM_xhr **never calls back at all** — not an error, not a timeout. That parks the candidate
  loop on that URL and the whole hover produces nothing, on every site. `fetchBlob()` therefore also
  carries its own wall-clock `setTimeout`, because GM_xhr's `timeout` option does not cover a dialog.
- **`onerror` is deferred one tick** before deciding why a probe failed, so the violation event has
  landed and `cspRefused()` can see it.
- **Blob URLs are revoked**, oldest first, past `BYTES_MAX` (12) — enough for a tour's window.
- **The bytes are never fetched speculatively.** Only a refusal triggers the path, so the ordinary
  case still costs one image load and "probing is preloading" survives.

- **`data:` is the universal escape hatch, not `blob:`.** `GM_xmlhttpRequest` is not subject to page
  CSP, so the bytes can always be fetched; the question is only what may then be *displayed*. Four of
  the six blocked engines allow `blob:`, but SearXNG (`img-src 'self' data:
  https://*.tile.openstreetmap.org`) and Mojeek (`img-src 'self' data: *.mojeek.com`) do not — and
  every one of the six allows `data:`. **So the fallback must try `blob:` first and fall back to
  `data:`**, paying ~33% base64 bloat and the memory only where it must. An earlier note here said
  every blocked engine allowed `blob:`; that was true of the four measured in a browser and false in
  general. This is **not built**; it is the prerequisite for the Brave rule in [`TOUR.md`](TOUR.md)
  §14, which decodes correctly and then cannot load what it decoded.
- **A Cloudflare or Anubis interstitial is not a CSP answer.** Ecosia and `searx.be` both refuse the
  in-app browser (a throwaway profile that cannot hold `cf_clearance`) and both are fine in a real
  one; `curl` reads the header either way and needs no browser at all. Ecosia turned out to need no
  work, which the interstitial had hidden.

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
- **No native `controls`, on purpose — but there ARE controls since v0.63.0.** The element still
  never gets the `controls` attribute: a click on the native strip retargets to `vidEl`, the same
  target as dragging the picture, so `isBoxControl()` cannot separate them. The script draws its
  own floating strip instead — see [`VIEWER.md`](VIEWER.md) `E36`. It opens `muted` + `loop` +
  `autoplay` because it stands in for an animated picture, which is also what keeps the autoplay
  policy from blocking it; `playVideo()` owns the one case where sound takes that permission away.
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
- **`videoPreviewsOn()` is checked in `collectCandidates`' `add()`**, so a video candidate is not
  merely unusable but never *probed*; it would otherwise spend one of `MAX_PROBES`. It is
  `playVideos && cfg.videoMode !== 'none'` — the bar's play button and the stored setting asking one
  question, so they cannot disagree (`E27`, `E31`). Do not confuse it with the *gates*:
  **`videoMode`/`previewOverPlayer` decide what on the page may be hovered, `videoPreviewsOn()` what
  the frame may display.**
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
- **`videoPreviewsOn()` gates it** — a clip the frame cannot display is not worth hovering.
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


## Nothing may downgrade the frame · `E33`

`resolve()` runs two paths at once — the linked-page lookup and the candidate loop — and each
called `onHit()` on its own. The caller does `upgradeViewer(hit)` unconditionally and throws the
return value away, so **whichever path emitted last owned the display.**

That is fine cold and wrong warm. On the first hover the page fetch is slow, so the loop's still
lands first and the video replaces it; on the second hover `pageCache` and `probeCache` are warm,
the interleaving flips, and a *bigger still from the same page* lands after the video and replaces
it. Reported as "the first hover plays the video, the second shows an enlarged jpg" — the same
element, the same settings, a different answer.

Both paths now go through one `emit()`, guarded by **`betterHit(cur, next)`**, which ranks
`trusted` (the linked page's own answer) over `video` over area. The candidate loop's local
`best && best.video && !dim.video` guard only ever covered loop-versus-loop; this covers the pair.
`betterHit()` is pure and lives in the sliceable section, so `test-resolver.js` asserts the
ordering directly — the race itself is environmental and cannot be asserted, the rule can.

## Animated images, when the setting says none · `E32`

`videoMode: 'none'` used to gate video *files*, which is not what it says. On gifwow the grid is
30 animated `.webp` and no `<video>` at all, and each item page declares `og:video` → `.mp4`
**and** `og:image` → an animated `.gif`; at `none` the resolver skipped the mp4 and fell straight
through to the GIF. Half the tiles still moved.

`sniffAnimated()` reads a candidate's first 4 KB and answers from the container:

- **WebP** — a `VP8X` chunk with bit `0x02` of its flags byte set, or an `ANMF` chunk present.
- **GIF** — the `NETSCAPE2.0` application extension. Not a frame count: counting image
  descriptors means walking LZW block chains, and the loop extension is on essentially every
  animated GIF in the wild.
- **APNG** — an `acTL` chunk before `IDAT`.

Verified against gifwow's real tiles: 6 of 6 animated, the static logo not.

- **It needs `GM_xmlhttpRequest`, and that is why the grant was added.** A plain `fetch` of the
  file is blocked — measured: `gifpit.com` sends no CORS headers, and the media is nearly always
  on a different origin from the page. `mode: 'no-cors'` returns an opaque body, and the canvas
  route taints. There is no same-origin-only version of this that fixes the reported case.
- **Only at `videoMode: 'none'`, and only for `.gif`/`.webp`/`.png`/`.apng`.** It is one extra
  request per candidate, paid only by the mode that asked for stillness. The panel hint says so.
- **A missing grant degrades to "not animated"**, so the test page — whose GM shim has no
  `GM_xmlhttpRequest` — cannot exercise this. `sniffAnimated()` is pure and asserted over
  synthetic headers instead.
- **A false positive costs one refused preview in one mode.** That is why the GIF test is the
  loop extension rather than something stricter.
- **`headBytes()` keeps only the first `ANIM_HEAD` bytes of whatever came back.** A server that
  ignores `Range` (Python's `SimpleHTTPRequestHandler`, so the test server) returns the whole
  file, and `sniffAnimated()` would otherwise walk it byte by byte.
- **It reads `videoPreviewsOn()`, not the stored setting.** The ▶ in the bar is the same switch
  per tab (`E27`); until v0.78.0 the sniff ignored it and animated GIFs kept moving after ▶.

## The probe budget keeps the sure things · `E46`

`MAX_PROBES` (8) bounds the requests one hover may cost. It is spent on the **guesses** — data
attributes, srcset entries, URL rewrites — and never on the two candidates that are not guesses:
the ancestor link when it names a media file, and the displayed src, which is the fallback. Both
carry `keep: true` out of `collectCandidates()` (a duplicate arriving with `keep` upgrades the
earlier entry) and `resolve()` filters with `c.keep || budget-- > 0`, so order is preserved and only
guesses are dropped.

**A srcset list contributes its two widest entries** (`SRCSET_KEEP`), whatever its length. The rest
are strictly smaller derivatives of the same picture, which can never beat the widest and cost a
download each to be rejected. Two rather than one so a widest entry that 404s still has a
fallback.

Measured before the fix: an 8-entry srcset inside `<a href="photo.jpg">` — eight probes, all
srcset, seven downloaded only to be rejected, the link never tried, no preview. Seven entries:
the link was candidate eight and hit.

### Image probes time out, and a miss is not for life

`probeImage()` gives up after `IMAGE_PROBE_MS` (20 s) and aborts the fetch; `probeVideo()` has
always had its 6 s. Without it a stalled candidate parked the resolver on that URL for every later
hover of the element, since the never-settling promise was cached. A probe that answers `null` —
timeout, 404, 429 — is forgotten after `PROBE_RETRY_MS` (30 s) so a rate-limited burst is not a
dead URL for the page's life. A hit is cached for the page's life as before.
