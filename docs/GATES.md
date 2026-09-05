# What may be hovered — the gates

Everything deciding whether the thing under the pointer is a picture worth previewing. Headings
carry the `E` id that owns them.

## A `<video>` is a PLAYER or a GIF · `E12`

"Is there a `<video>` involved" is too blunt. A site **dedicated to video** has a listing page and,
behind each entry, one player with a play button, a volume slider and a quality menu — no previews
anywhere on it. **imgur's gallery or gifwow's grid** shows a wall of short muted clips *already
playing*, no controls, nothing to click but the link underneath — animated pictures that happen to
be encoded as video, on an ordinary picture page. Clicking one leads to a player page, which is the
first kind again and is still refused.

`gifLike(v)` is the test and **all four properties are required**, because each alone has a false
positive:

- **no `controls`** — false on YouTube too, which draws its own chrome.
- **`muted`** — true of any player started under an autoplay policy.
- **`loop` or `autoplay`** — says nothing about length on its own.
- **duration ≤ `GIF_MAX_SECS` (60), and known.** This carries the argument: a clip that loops in
  under a minute is not something you sit and watch. An **unknown** duration (metadata not in, a
  cued player never started) reads as PLAYER — the safe direction to be wrong in, and what keeps an
  empty `<video>` (duration `NaN`) refused.

Applied in exactly two places, both load-bearing: `videoSurfaces()` lists a gif but **flags** it, so
`overVideoSurface()` skips it *and no player box is derived from it*; and the structural ancestor
walk goes through `playerIn()` rather than `querySelector('video')`. The debug line still prints
every video, gifs labelled as ignored — a gate that silently stops considering something is exactly
what the log exists to make visible.

**What this deliberately cannot do is judge the destination.** A muted, playing, controls-less clip
on a video site's *listing* page is pixel-for-pixel the imgur shape; nothing in the DOM separates
them, and the ancestor-link gate is the only signal left. That is why the link gate stays as it is.

Measured: gifwow's grid is `<picture>`/`<img>` webp with `/go/…` links and **no `<video>` at all**;
its item page is one `<video autoplay muted>` mp4 with a poster and no controls — a gif by this
rule, which is right, because the 90×90 thumbnails beside it are ordinary images.

Test cases 21 and 22 are the same card twice, differing **only** in the `controls` attribute — 21
must preview, 22 must not. The fixture is a real 2-second silent mp4 because the gate reads
`duration`, and an empty `<video>` reports `NaN`.

## Videos are never previewed — four gates, any one sufficient

`previewVideos` is OFF by default and switches gate 3 only.

### 0 · Geometry

The element's centre lies inside a **video surface**: the rect of a laid-out `<video>`, *or* of a
player box derived from it. A player's poster, cued-thumbnail overlay and endscreen images all
occupy that rectangle, so this names them exactly whatever the DOM between them looks like. Videos
under 2 px are skipped, so a 1×1 fixture contains nothing and cannot poison a page.

**The `<video>`'s own rect is NOT always where the player appears — this cost two rounds of
debugging.** Measured on a LibreWolf YouTube watch page, cued state:

| | rect | top | bottom |
|---|---|---|---|
| poster overlay (`.ytp-cued-thumbnail-overlay-image`) | `0,56 1903×798` | 56 | 854 |
| `<video>` | `0,-742 1903×798` | −742 | 56 |

The video is laid out exactly its own height **above** the player, touching the poster's top edge
and overlapping it nowhere. The gate missed by precisely 798 px and the poster previewed. Chrome
puts the video where the player is, which is why this was Firefox-only and read as a browser bug.

So `videoSurfaces()` also derives the **player box**: walking up to `PLAYER_UP` (3) ancestors of
each `<video>`, keeping those the video substantially fills. Two bounds, both load-bearing:

- **`PLAYER_FILL` (0.5)** — the video must cover half the ancestor's area. This is what stops one
  `<video>` anywhere on a page from suppressing every image on it, and why the walk can be anchored
  at the video and needs no "still one card" bound.
- **Not narrower or shorter than the video.** An area test alone admitted a `40×7006` column against
  a `640×360` video. A player box cannot be smaller than the video it holds. It `continue`s rather
  than `break`s — a wrapper can be odd while its parent is the real player box.

Reproduce with a `<video>` at `top:-360px` inside a `position:relative` player of the same size,
plus an `inset:0` background-image overlay: the two rects must not overlap.

### 1 · `NEVER`

`VIDEO`/`AUDIO`/`IFRAME`/`CANVAS`/`OBJECT`/`EMBED`/`SOURCE`/`TRACK` are never candidates, whatever
CSS background they carry. **Except**: `eligible()` takes a `VIDEO` branch *before* this test — see
[`RESOLVER.md`](RESOLVER.md) `E16`.

### 2 · Structure

A `<video>` in the element or up to three ancestors. Exact when it fires, but late on a card whose
inline player has not been injected yet, which is why (3) exists.

**The ancestor walk must stop at the first ancestor holding more than one `<img>`.** Without that
bound the walk reaches a grid, finds a single 1×1 `<video>` fixture, and disables every case on the
page. One video anywhere would poison every image. The bound is "still one card", not a depth count
— depth alone does not distinguish a card from a grid.

**That bound is also why gate 0 had to exist.** It is applied to an ancestor *before* the ancestor
is tested for a `<video>`, and a YouTube watch page's player element holds the video **and** several
`<img>`, so the walk ended before the structural signal was read. Reordering the two inside the loop
is not the fix — testing the video first re-breaks the test page, because the grid ancestor holding
the 1×1 fixture would then match. The geometric test sits *outside* the walk and leaves the bound
exactly as it was.

### 3 · The link

The nearest ancestor `a[href]` matching `VIDEO_LINK_RE` (`/watch?`, `/shorts/`, `/embed/`,
`/video(s)/`, `youtu.be/`, `.mp4|webm|m3u8|mov|mkv|avi`). This is the heuristic, and the one that can
be wrong. **The asymmetry favours having it**: a false positive costs one preview that never opens,
a false negative is the reported bug. Positive *and* negative cases live in `test-resolver.js`.

**`closestAcross()` — `closest()` does not cross a shadow boundary**, and neither does
`parentElement`. A site building cards from custom elements can put the `<img>` inside a shadow root
and the wrapping `<a>` outside, and this gate then sees no link at all. The composed walk (ordinary
`closest()`, then hop to `getRootNode().host` and continue) is what the gate uses.
`collectCandidates` still uses plain `closest()` and is a candidate for the same treatment if an
ancestor-link candidate ever comes back missing on a shadow-DOM site.

Cases 17, 18 and 19 (video link, video in the card, and an ordinary `/gallery/` control) exist so a
regression shows as a test-page failure rather than in the wild.

## Looking through a cover · `E18`

The pointer often never touches the picture. Measured on gifwow's grid:

```
div.grid-item > figure > a > picture > img          393×510   the picture
              > figure > figcaption > a[href=/go/…] 393×510   position:absolute, ON TOP
```

`elementsFromPoint()` at the middle returns `[A, FIGCAPTION, IMG, …]` — the hover target is an
**empty anchor covering the whole card**, so `eligible()` saw no `<img>` and no background image and
returned null. No preview, no spinner, nothing to debug. This is not a gifwow quirk: an absolutely
positioned link, a caption layer or a click-catcher across the card face is one of the commonest
ways a thumbnail grid is built.

`coveredMedia(el, x, y)` walks the hit-test stack below the target. **Two bounds, and the second is
what keeps it from being dangerous:**

- **Only an `<img>` or a `<video>`, never a CSS background.** This is the load-bearing distinction.
  Reaching down through a paragraph onto the section behind it is precisely the hero/backdrop case:
  "content is stacked on top of it" is the signal that a background IS a backdrop, and the signal
  that an `<img>` is a card's picture. **The same fact means opposite things for the two, and the
  element type is the only thing that separates them.**
- **Same card:** an ancestor of the cover, within `COVER_UP` (4), that contains the picture and
  contains exactly one *laid-out* picture. Without it the walk reaches the grid or the page and a
  full-page backdrop `<img>` becomes the answer to hovering anything. **Laid-out, not
  `querySelectorAll(...).length`** — gifwow's card also holds a `display:none` loader `<img>`, and
  counting it bounds the walk one level too early, at `FIGCAPTION`, which finds nothing.

Everything found under a cover then faces `eligibleDirect()` in its own right, so looking through a
cover can never reach something a direct hover would have refused.

**The hold rule needed a second answer** (`activeCovered` / `suppressedCovered`). "Leaving the image
takes the preview down at once" is enforced by mouseout's `active.contains(to)` test — and the
pointer is *never* on a covered picture, so that says "left" on every crossing between layers of the
same card, closing and reopening the preview. For a covered preview the question is answered by the
stack instead (`stillUnderPointer`). **Deliberately not used for a direct hover:** at the exact
boundary pixel the stack still holds the image, which would keep the preview alive a moment too long
and cost the one-preview-per-image row scan that pointer-transparency exists for.

Case 30 is the negative bound (two pictures under one cover → no preview); case 31 puts text over a
background and must not reach through to it.

## The preview is a completely different picture · `E19`

Reported on a forum whose 1200×125 masthead and ~600×600 sidebar picture both come from a pool that
rotates daily; hovering the banner gave the sidebar image.

**The obvious diagnosis is wrong, and following it cost a round.** "The URL hands out a different
picture each request" is the intuitive story. Measured in Chrome:

```js
for (let i=0;i<4;i++) { const im=new Image(); await load(im,'/rotate.php'); }
// four loads, Cache-Control: no-store  ->  ONE network request, four identical pictures
```

**A browser does not re-request a URL the document is already displaying.** So an unstable *displayed
src* cannot mislead — probe and frame both get the copy in memory. The case that bites is a
**different URL**: `/banner.php` derived from `/banner.php?loc=header` by the query-strip rule. That
rolls once, and every later check agrees with it perfectly while it shows something unrelated.
**General lesson: when a bug story requires the network to be hit twice, measure that it is.**

Three answers, at three different depths:

- **The query-strip rule only fires on a path that names a media file.** On `photo.jpg?w=400` the
  query is decoration over a file that exists either way; on `/banner.php?loc=header` the query *is*
  the request. **This is the fix**; the rest are backstops.
- **`sameShape()` — an upgrade has the same shape as the picture it upgrades.** `ASPECT_TOL` is **4**
  and it is loose on purpose: a thumbnail is often a *crop* of its original (a square thumb of a 3:2
  photo is 1.5× off, a 16:9 crop of 4:3 is 1.34×) and all must pass, while the reported case is
  9.6:1 against 1:1. A wrong refusal here is silent, so the number errs toward letting things
  through. Applied to guesses **and** to the linked-page answer, which otherwise skips every gate —
  a banner links to the section it heads, and that section's `og:image` is its own artwork. Only
  where a **natural** size exists (`nativeSize()`): a CSS background has none, and its box aspect is
  not the image's.
- **`markUnstable()` — a URL caught contradicting itself is refused for the tab.** Two free check
  points: the probe against the element's own `naturalWidth`, and the frame's load against the probe.
  Given the measurement above these do **not** fire in Chrome; they are kept for browsers that
  re-request (Firefox honours `no-store` more strictly, and this project's reports come from
  LibreWolf). **Do not delete them believing they are dead, and do not expect the test page to
  exercise them under Chromium.**

**`collectCandidates()` returns `{ url, from }`, and `from` is the whole point.** Six mechanisms can
produce a preview; the log used to print only the winning URL, which says nothing about which one to
go and look at. "The preview is the wrong picture" is unanswerable without it.

Cases 36 and 37 are the two shapes and both are **verified to fail without the fix**.
`test-server.py`'s `/rotate.php` is deterministic on the query rather than actually random, because
a test has to assert which picture came back.

## The band across the top of the page · `E20`

**Read [`../banner-test-sites.md`](../banner-test-sites.md) before touching any threshold.** ~40 live
pages probed in two browsers, each with the operands the gate decided on. Every number here sits next
to a row, and `test-resolver.js` asserts them all, so a moved threshold fails a named site rather
than failing silently in the wild.

**The old gate reasoned about one picture's width against a bag of other widths, and never about the
picture itself.** So every miss was a coincidence of widths and every false positive the absence of
one, and the two directions could not be fixed together because they pulled the same condition
opposite ways. FurAffinity is the sharpest page in the corpus: the artwork was refused while three
ads above it previewed.

### The band ratio

A banner is a **band**: wide and short. That is a property of the picture, so nothing else on the
page can move it.

```
banners   steam strip 33.8   aliexpress 14.2   qc 13.6   city-data 13.1   homedepot 12.9
          phpbb 8.9   furaffinity ad 8.1   4chan ad 7.8   youtube 6.2   spacebattles 5.9
          bandcamp 5.4   xkcd banner 5.4   linustechtips 5.2   soundcloud 4.8   avsforum 4.2
          newegg 4.1   natgeo 3.9   macrumors 3.5   4chan board banner 3.0
content   nasa hero 2.4   allbirds 1.9   itch 1.8   tumblr 1.8   alrincon 1.8
          newgrounds tile 1.7   flickr 1.6   unsplash 1.5   pexels 1.5   500px 1.5
          wallhaven 1.5   safebooru 1.0   furaffinity artwork 1.0   artstation 0.65
```

`BANNER_BAND` is **3**, and the gap from 2.4 to 3.0 is empty. Measured from the DISPLAYED rect, not
the natural size — `object-fit: cover` on a square file is one of the commonest ways to build a
banner.

### The width-set condition is deleted and CANNOT be repaired

Its job was saving a single-column gallery, which the shape test now does better because gallery
tiles are picture-shaped. Every repair considered fails on a measured row:

- *Require a shared x, or regular spacing* — Home Depot's four promo banners are all 1376 px at
  x=90; Samsung's three section bands are all 1265 px at x=0. A column test keeps both.
- *Require members be contiguous below with no content between* — clears Home Depot and xkcd, fails
  on AVS Forum, whose site logo sits **4 px** below the masthead. AVS is the shape the user reported.

**A stack of same-shaped bands down a page is Home Depot's promo column AND a hypothetical column of
banner-shaped content, and no test written in layout can separate them.** Home Depot is measured;
the column of bands is not.

**Residual cost, stated because it is real:** a one-column gallery whose tiles are wider than 3:1 and
whose first tile starts in the top 300 px loses that first tile. If that turns up on a real page it
is evidence to weigh — not a reason to restore a rule whose every measured effect was a miss.

### The other three conditions

- **`BANNER_TOP` 300.** The corpus clusters on the old 200 cutoff with no relation to where content
  begins: newgrounds refused a content tile at 192 px and previewed it at 208; homedepot was caught
  at 197; steam's backdrop escaped at 206; samsung's hero sits at **−7**. **It does not go higher**,
  for exactly two rows: xkcd's *comic* is 3.1:1 at 388 px down and questionablecontent's at 333.
  Those are the only band-shaped content in the corpus, and position is the only thing saving them.
- **`BANNER_MIN` 240.** Real mastheads measured 250 (macrumors), 300 (4chan's rotating board banner),
  304 (linustechtips), 340 (spacebattles) — all escaping on width alone at the old 400.
- **The peer test survives, narrowed twice.** It must be the same **height** (`PEER_HEIGHT`, 30 %):
  on furaffinity a 320×50 skyscraper sat beside a 728×90 leaderboard and rescued it, and two pieces
  of furniture sharing a horizontal band is not a row. `BESIDE_PEER` is 0.15, not 0.25 — the height
  test independently kills the YouTube subscription avatar the quarter was invented for, while a
  quarter sat on 500px.com's exact geometry.

### One picture can be two elements — a cross-fader

Pushed back on, correctly: *"There is only one image at the top of the page."* It cannot count the
same element twice (`if (n === el) continue`, and the img/video lists are disjoint) — but a rotating
banner is very often a **cross-fader**: two stacked `<img>` of identical size with the outgoing one
at `opacity: 0`. Different URLs, so the same-src exemption misses them, and **`opacity: 0` and
`visibility: hidden` both leave a FULL-SIZE rectangle**, which passes a `width >= 2` filter.

`reallyVisible()` uses `Element.checkVisibility({opacityProperty, visibilityProperty})` where it
exists, falling back to computed style plus a four-level ancestor walk — **opacity does not
inherit**, so a faded *wrapper* leaves the image's own computed opacity at 1. Called lazily, only for
a picture that would otherwise count.

Confirmed by the corpus: carousel pages at Samsung (27 slides), Best Buy (27), Allbirds (23), Newegg,
Steam and AliExpress all had off-screen slides and duplicate clones correctly discarded.

**A copy of itself is not a row-mate.** Banners are routinely rendered twice — a blurred backdrop
behind the sharp one, a low-res placeholder left in the tree — and a copy is by definition the same
shape. Mostly handled by geometry now, since **a copy is stacked ON the banner and overlapping rects
are never "beside" each other**; the `shownUrl()` comparison is kept for one laid out next to it.

### It judges CSS backgrounds too, and that is deliberate

`bannerCheck()` only ever reads `getBoundingClientRect()` and `shownUrl()`, and `eligibleDirect()`
calls it on whatever `el` is — **so it has always judged backgrounds, and the docs used to deny it.**

Keep it. Measured on soundcloud.com: the profile banner is a CSS background escaping **all five**
`wallpaperReason()` tests — not fixed, not tiled, `textContent` length 0, and 78 % of the viewport
against `BAND_WIDTH` 0.98 — and this gate is the only thing that catches it. At 4.8:1 it is caught
cleanly.

### Reporting and testing

`bannerCheck()` returns `{ banner, why }` for **both** answers, naming the failing condition and its
numbers:

```
"bannerGate": "not a banner: 1193×192 (6.2:1) at 812px from the top of the document;
               a banner starts within 300px of the top"
```

A bare "not a banner" cannot answer a cross-browser report; this makes it one paste rather than a
round trip. Same rule as the video log: **print the operands, not a summary of one of them.**
`hoverReport` runs it on `el || t`, not the hover target — where a cover was looked through those
differ.

`bannerShape(w, h, docTop)` is split out as a **pure** function precisely so the corpus can be a
regression suite. The DOM half is test cases 39–41, where the banner has four decoys beside it, each
killing one way the test could be loosened. **All three must start within `BANNER_TOP` of the
document top or they prove nothing** — measured at 1265 px: 41 at 87, the banner at 172, 40's first
tile at 263. Anything added above pushes 40 out of the band and the test silently stops testing.

### Known and accepted — not new bugs

- **A full-bleed hero is content and previews** — nasa.gov (2.4:1), itch.io key art, allbirds. The
  project has always held that a full-width photo with text over it is a real photo; shape now agrees.
- **samsung.com's 1280×960 hero and steam's 1266×712 backdrop pass**, at 1.3:1 and 1.8:1 — pixel-for-
  pixel the NASA shape. Nothing measurable separates a decorative backdrop from an editorial hero.
- **newgrounds' backdrop art (1.4:1) and twitch's offline card (1.8:1) now preview.** The second is
  caught by the video gates anyway.
- **avsforum's second header image at 319 px is still missed** — it clears `BANNER_TOP` only because
  the banner above it is 307 px tall.

## A copy of what is on screen is reachable below `minRatio` 1, on purpose (v0.43.0)

`showEvenIfNotLarger` is retired into `minRatio < 1` — see
[`SETTINGS.md`](SETTINGS.md). It carried a guard worth recording, because the guard went with it:
its fallback had no size comparison, so a frame could hold the identical bytes at the identical
scale, floating over the image they came from, and `dim.w <= displayed.w && dim.h <= displayed.h`
was added to stop that.

**Nothing replaces it, and that is the intended shape.** At `minRatio` ≥ 1 the test is a strict
`>`, so an identical copy cannot pass at any value anyone would leave set. Below 1 it can — which
is exactly what the number is for: "show me the preview anyway so I can see what the resolver
found". Blocking it there would defeat the setting.

The old note "only the fallback gets this, never the main loop" is moot with the fallback deleted,
but its reason still holds and still constrains: a *different* URL at the same pixel size can be a
better answer — imgur's `.webp` (static) versus `.jpg` (animated) at 412×360. Same size, different
image, worth showing.

## What counts as a page background · `E17`

`wallpaperReason()` returns a string, like `videoReason()`, so `hoverReport` can print which of the
five fired. **These apply to CSS backgrounds ONLY** — with the banner gate above as the deliberate
exception, since it asks a different question (*is it a band*).

- `<body>`/`<html>`.
- **repeat + `auto` size.** Repeat alone is NOT the test: `background-repeat: repeat` is the CSS
  *default*, so a hero setting only `background-size: cover` computes to it. Test case 9 is exactly
  that shape, so a repeat-only rule kills it. It is repeat **and** `auto` together that mean tiled.
- **`background-attachment: fixed`** — it does not scroll with the page. A picture you are meant to
  look at moves with the text beside it; a parallax backdrop does not.
- **Spans ≥ `BAND_WIDTH` (98 %) of the window width.** 98 % rather than looser because a gallery tile
  inside a centred container never reaches both edges and a band does by definition. **Guard
  `clientWidth > 0`** — the Browser pane reports 0 while hidden, and without it *every* element spans
  a zero-width viewport.
- **Carries ≥ `CONTENT_CHARS` (40) characters of text** — the page's own content is sitting on it.
  The threshold is what lets a tile's caption ("Sunset, 2019") through. Only reachable by hovering
  the element's own blank space, since text hit-tests first.

`decorativeReason()` is a separate test under the same `skipFurniture` switch and **does** apply to
`<img>`: `aria-hidden="true"` and `role="presentation"`/`"none"` are the page stating outright that
something is not content. **Read on the element itself, never inherited** — carousels routinely mark
cloned slides `aria-hidden` and those are real pictures on screen. **`alt=""` is deliberately NOT
used** even though it is the same convention: YouTube ships `alt=""` on its banner *and* on all 23
content thumbnails, so it separates nothing, and being wrong here is silent.

### Considered and rejected — do not re-propose

| Suggestion | Why not |
|---|---|
| class/id matching `/hero\|banner\|bg\|masthead/i` | a guess at intent dressed as a measurement. A wrong exclusion is **silent** — the picture just stops previewing — and this project keeps no allowlist |
| filename patterns (`sprite`, `bg-`, `pixel`) | same, and weaker |
| `alt=""` / missing alt | too many real content images ship without alt |
| extreme aspect ratios (>5:1) | panoramas and comic strips are real pictures |
| ignore CSS backgrounds entirely | test case 9 is a legitimate background thumbnail; deletes a working feature to fix a narrower bug |
| require a positive signal (figure, data-full, meaningful alt) | inverts the project's premise. The gate is *is it bigger than what is displayed*, measured by loading it; a positive-signal requirement is an allowlist by another name and loses the long tail this exists to win |
| minimum size, tracking pixels | already `minDisplayed` (48 px) |
| `background-repeat: repeat` alone | breaks test case 9 — see above |

## Images the user has ruled out — the ⊘ and `blockList` · `E11`

Two mechanisms, because neither covers the other: **automatic** is `skipFurniture` (the tests above);
**manual** is the ⊘ in the status bar and the `blockList` setting, for anything the automatic rule
cannot know about — a watermark, a sprite sheet, one specific image simply not wanted.

- **`blockCurrent()` records TWO urls** — `view.url` (what is on screen) and `activeShown` (the source
  element's own src). They differ whenever the preview is an upgrade, and blocking only the resolved
  one leaves the thumbnail still opening a preview that then fails to upgrade. `activeShown` exists
  solely for this and is cleared in `cancel()`.
- **The button is only on a PLACED window** (`.box.hot .cap .block`): a hover preview is
  pointer-transparent, so a button on it cannot be clicked at all. The flow is hover → click to pin →
  ⊘, and the panel says so, because it is not guessable.
- **It goes in `isBoxControl()`** — the capture-listener trap; the symptom is silence, not an error.
- **It asks first (v0.41.0).** The ⊘ opens a confirmation over the picture — what it will do, where
  the entry lands, and that Exceptions in the settings panel is how to take it back — with Cancel
  and *Never preview it*. A one-click permanent rule with no visible record was the complaint; the
  undo path has to be stated at the moment the rule is made, not found afterwards.
- **`blockCurrent()` calls `reloadSettings()` first.** The list is the one setting written from
  *outside* the panel, so it is the one place a stale in-memory `cfg` would silently drop another
  tab's entries.
- Entries are exact URLs, or globs when they contain `*` — which is what a background carrying a
  cache-busting query needs, since its URL is never twice the same. `blockMatch()` is pure and sits
  **inside the slice `test-resolver.js` evaluates**. It escapes regex metacharacters: an unescaped
  `?` or `.` would quietly widen the match, and **a wrong match here is silent**. Same discipline as
  `UPGRADES` — the negative tests matter more.

Blocking is checked in two places, both needed: `eligible()` (so no spinner even flashes) and
`collectCandidates`' `add()` (so a blocked URL is never *probed*). It was three until v0.43.0
deleted `resolve()`'s fallback probe of the shown URL.
