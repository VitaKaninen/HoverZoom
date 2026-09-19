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
*no player box is derived from it* and `overVideoSurface()` skips it **only when it is the hovered
media itself** (`s.el === el`); and the structural ancestor walk goes through `playerIn()` rather
than `querySelector('video')`. The debug line still prints every video, gifs labelled as ignored —
a gate that silently stops considering something is exactly what the log exists to make visible.

**A clip covering a DIFFERENT picture is a player** (v0.115.0). Until then `overVideoSurface()`
skipped every gif, so a site whose hover preview is a muted looping ~10 s clip inserted over the
thumbnail was caught only while its `duration` was still `NaN`: during learning the poll saw it at
~300 ms and withdrew; with the learned wait in place the check ran later, the metadata was in, the
clip was "gif-like", and the preview painted over the playing clip and stayed — nothing to learn
from, so the wait never corrected either. Seen 2026-09-18 on the 4×9 grid; `?clip` on the fixture
reproduces it (a preloaded clip lands gif-like at 600 ms and must withdraw with `(clip, 2s)`).
The imgur shape is untouched: the clip under the pointer is `el`, and the exemption is exactly that.

**What this deliberately cannot do is judge the destination.** A muted, playing, controls-less clip
on a video site's *listing* page is pixel-for-pixel the imgur shape; nothing in the DOM separates
them, and the ancestor-link gate is the only signal left. That is why the link gate stays as it is.

Measured: gifwow's grid is `<picture>`/`<img>` webp with `/go/…` links and **no `<video>` at all**;
its item page is one `<video autoplay muted>` mp4 with a poster and no controls — a gif by this
rule, which is right, because the 90×90 thumbnails beside it are ordinary images.

Test cases 21 and 22 are the same card twice, differing **only** in the `controls` attribute — 21
must preview, 22 must not. The fixture is a real 2-second silent mp4 because the gate reads
`duration`, and an empty `<video>` reports `NaN`.

## Three questions, not one · `E31`

Until v0.59.0 a single `previewVideos` checkbox switched every gate below at once, which made a
setting about *video sites* also decide what happens on a *player page*. Those are different
questions with different right answers, and there is a third one underneath both:

| Question | About | What answers it |
|---|---|---|
| Is the thing under the pointer an animated picture, or a player? | the media itself | `gifLike()` — no setting |
| Am I standing on a player that is already on this page? | where I am | nothing — always refused |
| Does this thumbnail lead away to a video page? | where it goes | `videoMode`, default **`clips`** |

`videoMode` is a ladder: `none` (nothing animated reaches the frame — video files by URL, and
animated GIF/WebP/APNG by sniffing the bytes, see [`RESOLVER.md`](RESOLVER.md) `E32`) ⊂ `clips`
(animated clips, the default) ⊂ `all` (also a still that links to a video page). `none` is the
stored form of the bar's play button — `videoPreviewsOn()` is `playVideos && videoMode !== 'none'`
and is the single test every video *candidate* passes through, so the two cannot disagree.

**The decomposition is what makes the imgur / gifwow / angryduck family work without naming
them.** All three are a wall of short muted clips whose item page is another short muted clip;
the first question answers yes for every one of them and no setting is consulted. A dedicated
video site differs in exactly one place — its item page holds a real player — and that is the
third question, asked of the link. See "Where the line actually is" below for which half of that
is robust and which will break.

### `previewOverPlayer` existed for one version and was removed (v0.62.0)

It was the setting for the second question, default off. Deleted because **the thing it appeared
to offer was not a thing it could do.** A user who ticks "preview on top of a video player"
expects to hover the player and get the video; what actually happens is that
`eligibleDirect()`'s `VIDEO` branch refuses any `<video>` that is not `gifLike()` **before**
the setting is ever consulted, so a real player can never preview whatever the box says. All
ticking it did was un-gate *other* elements sitting on the player's rectangle — a poster, an
endscreen still — which is why the report was "it shows a static jpg, enlarged".

Making it work as it read would mean previewing a player's own stream, which is `E12` in
reverse: the player is right there, full size, with controls. So gates 0 and 2 are
**unconditional** now and the question has no setting.

### The four gates, any one sufficient

Gates 0 and 2 are the second question and always apply; gate 3 is the third and answers to
`videoMode`. Gate 1 is unconditional. `playerSurfaceReason()` is 0 and 2 together;
`videoLinkReason()` is 3; `videoReason()` is both, and exists only for the debug line.

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
be wrong. **The asymmetry favoured having it** when `previewVideos` defaulted on: a false positive
cost one preview that never opens, a false negative was the reported bug. That reversed in v0.59.0
— `videoMode` defaults to `clips`, so this gate is now live by default and an over-match is the
silent failure. See "Where the line actually is" below. Positive *and* negative cases live in
`test-resolver.js`.

**`closestAcross()` — `closest()` does not cross a shadow boundary**, and neither does
`parentElement`. A site building cards from custom elements can put the `<img>` inside a shadow root
and the wrapping `<a>` outside, and this gate then sees no link at all. The composed walk (ordinary
`closest()`, then hop to `getRootNode().host` and continue) is what the gate uses.
`collectCandidates` still uses plain `closest()` and is a candidate for the same treatment if an
ancestor-link candidate ever comes back missing on a shadow-DOM site.

Cases 17, 18 and 19 (video link, video in the card, and an ordinary `/gallery/` control) exist so a
regression shows as a test-page failure rather than in the wild. 17 now moves with `videoMode`
while 18 and 22 move with `previewOverPlayer` — the whole point of the split, and the thing to
re-check if either ever stops being independent of the other.

## Where the line actually is — and where it will break

The two halves are not of equal quality and it is worth knowing which one to distrust.

**`gifLike()` is a property test and it generalises.** It reads four things the site had to set
for functional reasons: a site that wants a gif must mute it, loop or autoplay it, and leave the
controls off; a site that wants a player must give it controls or draw its own. It never looks at
layout, so a new site's grid markup cannot break it. Its one real gap is a player that draws its
own chrome — `controls` false, `muted` true under an autoplay policy — and there **`duration`
carries the whole gate alone**. That is the fragile hinge, and it is one number: `GIF_MAX_SECS`,
60. A 90-second looping background clip is refused; a three-minute muted autoplaying banner video
is refused. Both are the safe direction. Asserted against plain objects in `test-resolver.js`,
one case per property.

**The four clauses are checked in order and the first one to fail wins, so the duration is often
never consulted at all.** A player that never sets `loop` or `autoplay` as *attributes* — most of
them, since players call `play()` from script — is refused by the third clause, and `GIF_MAX_SECS`
does nothing on that page. Which means the cost of raising it is much narrower than it looks: it
is paid only where a video is muted, controls-less, *and* attribute-autoplaying or looping, and is
still long. **Measure before moving it** — the debug line's `videosOnPage` prints every video's
length and names the clause that refused it, precisely so this number can be argued from real
pages instead of from whichever two sites were open.

**Where it bites is asymmetric, and worth knowing before changing it.** On a grid of short clips
the duration clause never fires, so raising it changes nothing there. It fires on *item* pages,
where a long clip stops being hoverable and starts suppressing its neighbours. That produces one
genuine wart: **the same post page behaves differently depending on how long its video is**, with
the boundary invisible to the user — under the limit it previews, over it is refused.

**`VIDEO_LINK_RE` is a URL guess and it does not generalise.** `/watch?`, `/shorts/`, `/embed/`,
`/video(s)/`, `youtu.be/` are five shapes out of an open set; `/v/12345` is deliberately a
negative because it over-matches. A video site whose item URL is `/p/12345` or `/media/abc` is
invisible to it and its listing thumbnails will preview.

**Do not answer that by growing the regex.** Every pattern added is a new way to refuse an
ordinary gallery, and the cost is asymmetric in the *opposite* direction from the note in gate 3:
now that `videoMode` defaults to `clips`, an over-match silently kills previews on a picture site,
which is the complaint this whole script exists to fix. The escape hatch when the guess is wrong
is a setting away in either direction — `all` if it is refusing too much, the site list if one
site is hopeless — and that is the intended answer.

**What could replace the guess, and why it is not in yet.** `probeVideo()` already returns
`duration`, so a resolved candidate could face the same 60-second rule the DOM clip faces, making
`GIF_MAX_SECS` the single line for both. It is not wired up because the link gate has to fire
*before* the fetch, and following every thumbnail on a video site's listing page to find out is
the one cost the resolver's linked-page lookup was careful not to pay. If the regex ever becomes
the top source of complaints, this is the direction — not more patterns.

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

### "Exactly one picture" was too literal — count PEERS, not pictures · v0.92.0

An avatar in the card is laid out, so it counted, so the walk bailed and **nothing on the page
previewed at all**. Measured on ArtStation's grid 2026-09-07: `A.gallery-grid-link` holds the
209×209 tile *and* a 40×40 artist avatar that appears on hover, with `DIV.gallery-grid-overlay` on
top of both — the exact `E18` shape, refused by the exact guard that exists to make `E18` safe.

`peerMedia(n)` replaces `laidOutMedia(n)`: it counts only pictures whose area is at least
`COVER_PEER` (0.25) of the biggest one in the container. The avatar is 3.7 % of the tile and is not
a peer; two tiles of a grid are peers and still stop the walk, which is the whole point of the
guard. **The failure was silent and total** — no preview, no ring, nothing to debug — and it will
be just as silent on every other card that puts a badge, an avatar or a play icon beside its
picture, which is most of them.

Verified end to end: ArtStation's grid previews the 762×1047 original after this change, on an
untouched page. Before it, the same hover produced nothing; making the overlay
`pointer-events:none` by hand was what proved the cover walk was the blocker rather than the
resolver.

### An invisible placeholder is not a picture · `shownMedia()` · v0.95.0

The peer rule above still counted one thing it should not: a lazy-load placeholder **at the same
size, in the same box**. Measured on Discord 2026-09-07, every attachment is two stacked `<img>`
elements —

    IMG.lazyImg            551×290 at (447,335)   natural 640×337   opacity 1
    IMG.imagePlaceholder   550×309 at (447,335)   natural  32×18    opacity 0

— so `peerMedia()` counted 2 genuine peers at every ancestor, the walk bailed, and **nothing on
Discord previewed at all**: not images, not the gif embeds, which sit under the same cover.

`shownMedia()` now excludes `visibility: hidden` and `opacity` at or near 0, in two places: peer
counting, and the collection of candidates *under* the cover. The second matters as much as the
first — without it the walk can return the 32×18 placeholder, and the size gate then rejects it,
which looks exactly like a broken resolver.

Both Discord cases verified after the change: an attachment previews at **1323×1059** (bigger than
the 512×410 shown, because the signed URL keeps its `ex`/`is`/`hm` and loses only `width`/`height`),
and a gif embed plays as a **501×282** clip.

**The next rung, if a site ever needs it:** two media elements that are *co-located* — overlapping
rectangles rather than side by side — are one picture rendered twice, whatever their opacity. Not
built, because the opacity test settled every case measured so far and a wrong exclusion here is
silent.

Everything found under a cover then faces `eligibleDirect()` in its own right, so looking through a
cover can never reach something a direct hover would have refused.

**The hold rule needed a second answer** (`activeCovered` / `suppressedCovered`). "Leaving the image
takes the preview down at once" is enforced by mouseout's `active.contains(to)` test — and the
pointer is *never* on a covered picture, so that says "left" on every crossing between layers of the
same card, closing and reopening the preview. For a covered preview the question is answered by the
stack instead (`stillUnderPointer`). **Deliberately not used for a direct hover:** at the exact
boundary pixel the stack still holds the image, which would keep the preview alive a moment too long
and cost the one-preview-per-image row scan that pointer-transparency exists for.

**A cover can also arrive AFTER the hover** (`E61`, v0.105.0). YouTube's subscriptions grid puts its
inline player — a `<video>` that is a player, muted but with no `loop`/`autoplay`, so rightly
refused — over the thumbnail somewhere between 200 ms and 2 s into the hover (measured both). Three
things were true and each cost a version:

- **Chromium's mouseout/mouseover for a layout change under a still pointer is best-effort.** It
  came 206 ms after the hover once, 3 s later once, and not at all once. Nothing that waits for the
  event is reliable; the check is geometric — `overVideoSurface(active)` — asked at paint time, on
  every `mousemove`, and since v0.106.0 on a 100 ms poll (`watchTimer`) for as long as a hover is
  pending or open (`playerArrived()`), and it withdraws the preview. The poll is what makes the
  learned wait's timings honest: a still pointer is the normal case, and a withdrawal timed from
  the next mouse event measured 1399 ms for a player that landed at 600. `lateCover()` still takes
  the event when it does come: a player cover cancels, any other late cover (`underCover`: the
  picture is in the stack with the target *above* it) turns the hover into a covered one.
  Requiring "above" is what keeps the boundary-pixel objection answered — a neighbour never sits
  above the picture at one point, so the row scan cannot trip it. `playerReplaced()` covers the
  third shape: the picture itself is removed and a `<video>` is where it was, which arrives as a
  mouseout with the picture no longer in the stack at all.
- **No FIXED grace period can beat a delay that varies by 10× between sites.** v0.105.0 briefly
  held the paint 400 ms for video-link thumbnails; YouTube landed at 2 s that day. Removed the same
  session. What replaced it (v0.106.0, `E62`, below) is a wait that is *measured per site* and
  corrects itself — the objection was to guessing one number for every site, not to waiting.
- **A page holding a dormant `<video>` — laid out under 2 px — is a page that previews its own
  videos.** So under `all`, a video-link thumbnail on such a page is refused up front
  (`videoLinkRefused()`, reported as `dormantPlayer` on the debug line): the site's player will land
  on it and win, and ours would only ever be withdrawn. This is the rule that makes YouTube quiet;
  the geometry above is the backstop for a player created on demand. The cost: a page with any
  hidden `<video>` — a background clip, an ad slot — refuses `/watch?`-shaped thumbnails under
  `all`. Narrow, and the debug line names it.

v0.104.0 shipped the opposite — holding the preview *over* the arrived player — and the user's
first look said it: "since the video is playing behind it, the preview should not be showing at
all." `P4` already said a player on the page always wins; a player that arrives late is not an
exception. `test-pages/inline-player.html` holds both shapes: dormant (nothing opens) and
`?nodormant` (opens, then withdrawn by geometry on the next move; a plain overlay holds).

Case 30 is the negative bound (two pictures under one cover → no preview); case 31 puts text over a
background and must not reach through to it.

### A site that lands players late is learned, and waited for · `E62` · v0.106.0–v0.109.0

Asked for after a site whose thumbnails start a clip about a second into the hover: every hover
opened a preview that then closed a second later — correct, and useless. The design is the user's,
and it took four versions to build it as stated, because the first three keyed learning to *how*
the preview closed instead of *what the user saw*. The rule that survived:

**The trigger is a preview that was on screen closing with the pointer still on the picture.**
`selfClosed(why, x, y)`: `box` has `on`, the hover is not placed, not inside a wait, and (x, y) is
strictly inside `activeRect` — the rectangle the picture had when the hover began. That is "the
script created a preview and removed it on its own"; the user never left. It is called from every
page-driven close: the picture no longer under the pointer (`onOver`'s ineligible branch), something
else eligible in its place (`onOver`'s re-target — a muted looping clip swapped in for the
thumbnail lands here, and no player gate would ever see it), a mouseout that left the pointer
where it was (`onOut`), the picture removed from the document (the poll, `isConnected`), and the
three player-detection paths (`withdrawn()`). Never from Escape, a right-click, a scroll, a blur,
the modifier's keyup or `verifyMedia`'s size mismatch — those are not call sites. Keying on the
visible event is what closes the loop: **a rule that is wrong is corrected by the flash it failed
to prevent**, whatever path closed it. v0.106.0–v0.108.0 recorded only the three player paths, so
on a site that closed the preview another way the rule sat at a wrong number "and keeps showing
the preview flashes" (the user, on v0.106.0).

**The grace.** No preview paints before `PLAYER_GRACE_MS` (150 ms, the ring's own delay) after the
hover, on any site, with the poll checking underneath. A player that lands at once is seen first
and never flashes — and so never teaches, which is right: nothing was seen. Costs at most ~30 ms
on a cached hit (the resolve starts at `hoverDelay` = 120). The user's call: *"our preview never
appears within 100 ms of a hover, even when it is supposed to, so adding this delay seems like it
doesn't really cost anything."* v0.108.0 instead *remembered* areas whose player beat the preview;
the grace makes that state unnecessary and it was removed.

**The record** (v0.112.0, the shape borrowed from Forum Stumbler's `sigDeep` /
`derivePositionPrefixes` / site `prefixes`). `cfg.videoDelays` is
`host → {ms, rules: [{dom, path}], samples, fixes, user}`; everything up to `vdEntryFor` is
arithmetic on that object and is asserted in `test-resolver.js`:

- **A picture's chain** (`domChain()`): its own tag alone — its classes are load state — then up
  to 7 ancestors as `tag.class.class`, every class kept, **digits normalised to `#`** and sorted,
  stopping at `<body>`. `item-12` and `item-13` are one shape; the 4-class cap and the "stop at
  the grid" heuristic of v0.106.0 are gone — the latter stopped one level early whenever a card
  still held the site's player from an earlier hover, which is how a same-layout page 2 failed to
  match page 1 and the rule went site-wide.
- **A rule is a prefix, not a key.** Three flashes whose chains share at least `RULE_MIN` (2)
  levels become a rule: `dom` = their common head capped at `RULE_DEPTH` (4) levels, `path` = the
  common head of the pages' paths (`/videos/page/2`, `/videos/page/3`, `/videos` → `/videos`; `/`
  when nothing is shared). A hover is covered when its chain **starts with** `dom` and the page
  path starts with `path`, by segment. Deeper per-row variation cannot break it; the photo page of
  the same site, with the same card markup, is a different `path` and is not covered. The user's
  framing: *"it is really only dedicated video pages where I expect this to be a problem."*
- **A level is a tag plus the classes ALL samples carry, and a chain matches a level when it has
  the tag and at least those classes** (`sharedHead`, `chainMatches`; v0.114.0). A level where one
  side has classes and nothing is shared ends the head — `img>a` is every linked picture, not an
  area. Before v0.114.0 a level was compared as a string, and a card's `<a>` carrying scroll-in
  state (`fade` / `fadeUp`) made every row its own area: two samples shared only `img`, each
  new one evicted the last, and the panel went 2 of 3 → 1 of 3. Seen 2026-09-18 on a 4×9 grid.
- **A withdrawal is any `<video>` landing over the picture, a short clip included** — `E12`'s
  clip exemption applies to the hovered media only (v0.115.0). The `why` names it: `(clip, 8s)` or
  `(player — its duration is unknown (NaN))`.
- **A rule is narrowed, not duplicated.** A flash no rule covers, whose chain has a rule's tags
  at every level on a matching path, replaces that rule's `dom` with what the two share
  (`vdNearRule`, change `widened`) and is NOT a `fixes` sample — it was measured against the
  grace, not the wait, so it says nothing about `ms`. Three same-row samples that all carried a
  state class are thus corrected by the first flash in the next row.
- **Nothing is ever site-wide.** A flash no rule covers is a sample for *another area*; samples
  that share no head with the newest are dropped (another area, or noise); three of one area add
  a rule (up to `RULE_MAX`, 6) and raise `ms` to the new area's figure if it is higher. v0.106.0–
  v0.111.0 widened to the whole site on the first uncovered flash, which on a site with a photo
  section is exactly wrong; only a user's own entry covers a whole site now.
- **Correcting.** A flash on a covered picture is sampled (`fixes`, the panel says
  `updating, n of 3`, the wait stands meanwhile); the third makes `ms`
  `max(ms + 250, slowest × 1.25)`. One `ms` per site, shared by its areas — the slowest wins.
- **A flash within 2.5 s of a press or key is the user's doing** (`lastUserAct`, `USER_QUIET_MS`)
  and never counts. Found on Google's captcha interstitial: a clicked tile swaps its picture under
  the pointer, which is a page-driven close in every respect except cause, and `google.com` had a
  learning entry before Google Images was ever hovered.
- **The user's entries** (`user: true`, from the panel) cover the whole site, are never written
  by the script, and adding one removes every learned entry it covers; **0 ms** turns learning off
  for the site. Lookup (`vdEntryFor`) is the host's own key, else the most specific user entry that
  covers it. The number on a *learned* row can be clicked and changed in place; that keeps it
  learned, so the script goes on adjusting from the new value.
- **Old entries** (`{ms, region}`, v0.106.0–v0.111.0) are read through `vdNorm()`: the region
  becomes one rule on `/`; `'*'` becomes a rule with an empty `dom`, which matches everything.

**The chain is taken once, at hover time (`activeChain`, `activePath`).** Computed at close it is
a different chain — the card now contains the `<video>` — and the rule never matches. Found in the
first browser run of v0.106.0.

**The poll** (`watchTimer`, 100 ms, only while a hover is pending or open) is what makes the
timings honest under a still pointer — the normal case. Without it the first sample measured
1399 ms for a player that landed at 600, because Chromium raised no mouse event until the pointer
moved. It asks two things: is the picture still in the document, and is a player rectangle over it.

`test-pages/late-player.html` is the fixture: grid A lands a player at 600 ms (`?slow`: 1200;
`?instant`: 0; `?swap`: the thumbnail is *replaced* by a muted looping clip), grid B never does.
Measured there: three samples at ~700 ms learn 900 ms for
`{dom: img>div.card.video>div.grid, path: /test-pages/late-player.html}`; A4 then
waits 900, the player lands at 714, nothing opens; B1 opens at once; on `?slow` A1 opens at 900
and is withdrawn at 1302 → 1650 ms; on `?instant` A1 is withdrawn at 123 ms inside the grace and
nothing is stored; on `?swap` the same three samples arrive by the re-target and `isConnected`
paths and A4 is held the same way.

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
  through. Applied to guesses **and** to the linked page's `og:` answer, which otherwise skips every
  gate — a banner links to the section it heads, and that section's `og:image` is its own artwork.
  Only where a **natural** size exists (`nativeSize()`): a CSS background has none, and its box
  aspect is not the image's.
  - **Exempt since v0.58.0: a linked-page candidate whose FILENAME matches the thumbnail's**
    (`sameStem()`, so `beach-day.jpg` → `beach-day.mp4`). Shape is a *guess* at identity; a matching
    filename on the page the thumbnail links to is a much stronger claim, and it outranks the guess.
    The exemption is deliberately narrow — the banner case above is an `og:image`, which is not
    filename-matched and still faces this gate. Reasoning and the measured site in
    [`RESOLVER.md`](RESOLVER.md).
- **`markUnstable()` — a URL caught contradicting itself is refused for the tab.** Two free check
  points: the probe against the element's own `naturalWidth`, and the frame's load against the probe.
  Given the measurement above these do **not** fire in Chrome on a re-request; they are kept for
  browsers that do re-request (Firefox honours `no-store` more strictly, and this project's reports
  come from LibreWolf). **Do not delete them believing they are dead, and do not expect the test
  page to exercise them under Chromium.**

### `naturalWidth` is density-corrected under `srcset` · `E45`

The first check point fired in Chrome anyway, on a units mismatch rather than a re-request: an
`<img>` whose current source came from a `w`-descriptor `srcset` reports `naturalWidth` as *file
pixels ÷ (descriptor ÷ source size)*. Measured: a 24×18 PNG in an 8-entry srcset with no `sizes`
at 1280 wide read 284×213. Any density other than exactly 1 — most HiDPI displays, most `sizes`
values — made the displayed URL "unstable", refused it for the tab, and left the frame on a smaller
entry. `nativeSize()` marks the answer `scaled` when the element has a `srcset` or sits in a
`<picture>`, and `samePicture()` then compares the aspect ratio to within a pixel of slack instead
of the pixels; the 9.6:1-against-1:1 case above is still caught. The frame's own load is not
affected — our `<img>` has no srcset. Found v0.78.0.

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

### A wallpaper can be an `<img>` · `pinnedWallpaperReason()` · v0.93.0

Every test above reads a CSS background property, so a backdrop built as an **element** passed all
of them. Discord's login page is the case: `<img class="artwork">`, `position: fixed`, `inset: 0`,
sized to the viewport in both axes at every window size, `alt=""`, no `aria-hidden`. It previewed,
which is absurd — it is the wallpaper.

The new test is the element-shaped statement of a rule already argued here:
**`background-attachment: fixed` says "it does not scroll with the page", and `position: fixed`
says exactly the same thing.** Two conditions, both required:

- `position: fixed`, and
- the rect spans ≥ `BAND_WIDTH` (98 %) of the viewport in **both** axes.

**Both axes is what keeps a lightbox safe.** A photo opened full-screen is letterboxed — it fits
one axis and falls short on the other — while a `cover`/`fill` backdrop matches both exactly. The
`vw <= 0 || vh <= 0` guard is the usual one: the Browser pane reports zero while hidden, and
without it every element spans a zero-width viewport.

Known and accepted: a full-bleed *fixed* photo that a site genuinely wants you to look at is now
refused. It is already displayed at screen size, so little is lost, and `skipFurniture` turns the
whole family off. Regression test: `test-pages/wallpaper-fixed.html`, which pairs the backdrop with
an ordinary card picture that must still preview.

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

## A captcha is never previewed · `P13` · v0.111.0

Google's "unusual traffic" interstitial puts a reCAPTCHA picture grid in an iframe; every tile is
an eligible `<img>`, so each square hovered raised a preview to be dismissed before the tile could
be clicked. Excluding the site is wrong (it is `google.com`) and excluding the image is useless
(every challenge is new). `CAPTCHA_HERE` is decided once per frame from the frame's own URL and
`onOver` returns on it: hCaptcha, Cloudflare's challenge platform, Arkose/FunCaptcha by hostname;
`/recaptcha/` by path; Google's `/sorry/` page in the top frame; and, in a frame only, `captcha`
anywhere in the path — a top-level article about captchas must still preview. `pageHost()` is not
involved, deliberately: the decision is about the frame the picture is in, not the site the user
is on. Asserted in `test-resolver.js`.

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
