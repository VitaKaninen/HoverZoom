# Banner-gate test corpus

> **The rewrite this file was built for shipped as v0.38.0**, and the measurements below are
> now the gate's regression suite: `test-resolver.js` asserts every row's width, height and
> document-Y against `bannerShape()`, so a moved threshold fails by site name. **Everything
> below describes the OLD four-condition gate** — the verdicts in the MISS and FALSE POSITIVE
> sections are what it did, not what the script does now. What replaced it, condition by
> condition, is in `CLAUDE.md` under "The banner gate, rewritten around SHAPE (v0.38.0)".
>
> Short version: the width-set condition is deleted, and the deciding test is now that a
> banner is a **band** — width ÷ height ≥ 3. Measured here, banners run 3.0 to 33.8 and
> content runs 0.65 to 2.4, with nothing in the gap. `BANNER_TOP` 200 → 300, `BANNER_MIN`
> 400 → 240, the row-mate must be the same height, `BESIDE_PEER` 0.25 → 0.15.
>
> **Four rows are knowingly left as they were,** because nothing measurable separates them
> from content: samsung.com's 1280×960 hero (1.3:1), steam's 1266×712 app backdrop (1.8:1),
> and avsforum's second header image at 319 px down. newgrounds' backdrop art and twitch's
> offline card now preview, having been refused before.
>
> **Adding to this file is still useful** — a new row is a new assertion. Run the probe at
> the bottom, paste the numbers in, and add a `band(...)` line to `test-resolver.js`.

Sample pages for rewriting `bannerCheck()`. Every row in the MEASURED sections was produced by
running a replica of the shipped gate against the live DOM, **2026-09-04**, with the page scrolled
to the top.

Two browsers, and the difference matters:

- **Pane** — the Claude Code Browser pane, **signed out**, 1265-1280px viewport.
- **Chrome** — the user's real Chrome, **signed in**, ~1556-1571px viewport, **with an ad blocker
  active**. The Hover Zoom userscript was installed and running; it does not affect the probe,
  because its preview lives in a shadow root and `document.images` does not cross that boundary.

Gate replicated: `BANNER_TOP` 200, `BANNER_MIN` 400, `BANNER_SIMILAR` 0.1, `BESIDE_PEER` 0.25,
`BANNER_SET_MIN` 2, plus `reallyVisible()`.

Two directions of failure, and they pull the rules opposite ways:

- **MISS** — a real banner previews. The reported bug; loud.
- **FALSE POSITIVE** — real content is refused. Silent, so it is the one nobody reports.

**Viewport, sign-in state and ad blocking are part of every measurement.** Several rows below sit
within 10-20px of a threshold, so a different window width flips them.

---

## MEASURED — MISS (banner previews when it should not)

### `www.homedepot.com` — the strongest case in the corpus (Chrome)

```
1376x107  @x90  197px down  -> previews: set of 4 [1376@x90,619  1376@x90,1081  1376@x90,2658]
```

A promotional top banner (`...TopBanner-DSK-01.gif`) three pixels inside `BANNER_TOP`, saved from
refusal by four other images that **are themselves stacked full-width promo banners** further down
the page. The page is built out of banners, so the banners form the set that proves none of them
is a banner. Condition (4) inverts on any page whose layout is a stack of full-width bands.

### `www.avsforum.com` — the reported forum-masthead shape (Pane)

```
1280x307  @x8    8px down   -> previews: set of 2 [1249@x8,319down  1404@x48,4257down]
1249x250  @x8  319px down   -> previews: 319px down, past 200
```

A full-bleed 1280x307 masthead at 8px from the top of the document is saved by two images that are
**not a column**: the site logo 319px below it, and something 4,257px down the page. Condition (4)
asks only "does another picture share this width", never "do these form a set" — no test of shared
x, no test of regular spacing, no bound on how far away a member may be.

The second line is a separate miss on condition (1): the 1249x250 logo band sits at 319px down
because the banner above it is 307px tall, so a site with **two stacked header images** always gets
the lower one through.

### `xkcd.com` — condition (4) decided by coincidence (Pane)

```
540x100  @x463  113px down  -> previews: set of 2 [520@x374,787down  520@x374,891down]
740x239  @x264  388px down  -> previews: 388px down, past 200 (the comic; correct)
```

The store-news banner previews only because two unrelated 520px images further down the page fall
within `BANNER_SIMILAR` of 540. Nothing about the page changed; the arithmetic did.

### `samsung.com/us` — a hero on a page of stacked full-width sections (Pane)

```
1280x960 hero @x-7  -7px down  vis=true  -> previews: set of 3 [1265@x0,969  1265@x0,2024  1265@x0,3083]
```

Same mechanism as Home Depot, on a page with **27 swiper slides**. Two things worth keeping:

- The hero's document top is **-7px** (negative margin), which sails through condition (1).
- Three hidden slides at the same position measured `vis=false` and were correctly excluded from
  the set count — `reallyVisible()` and the v0.27.0 cross-fader fix are working exactly as
  intended. The set members that *do* count are stacked full-width section banners further down.

### `store.steampowered.com/app/<id>` — a miss by six pixels (Pane)

```
1266x712  @x0  206px down  -> previews: 206px down, past 200
```

Sample: <https://store.steampowered.com/app/620/Portal_2/> (pick a title with no age gate — an
age-check interstitial replaces the page entirely). A full-bleed decorative backdrop `<img>` —
page furniture by any reading — clears `BANNER_TOP` by six pixels. It is rendered twice with the
same src, and the same-src exemption handles the duplicate correctly.

### `boards.4chan.org/<board>` — two misses on one page (Pane)

```
300x100  @x483   39px down  -> previews: under 400px wide      (the rotating board banner)
468x60   @x399  300px down  -> previews: 300px down, past 200  (a house ad, same-document <img>)
```

The board banner is *the* rotating-banner shape `CLAUDE.md` discusses, and it escapes on width
alone. The 468x60 below it is one of the few display ads that is a real `<img>` in the top
document rather than an iframe — see the ad section below.

### `furaffinity.net/view/<id>` — the ad-as-banner case, finally caught (Chrome, ads unblocked)

```
IMG  728x90    @x234    66px down  -> previews: peer 320px beside   (leaderboard ad)
IMG  320x50    @x1216   61px down  -> previews: under 400px wide    (skyscraper ad)
IMG  320x50    @x1216  130px down  -> previews: under 400px wide    (skyscraper ad)
IMG 1136x1136  @x30    175px down  -> REFUSED  id="submissionImg"   (the artwork — see below)
```

The one page in the corpus where advertising is served as **same-document `<img>` rather than in
an iframe**, so the gate can see it. Three ad images at the top of the page all preview: the
728x90 leaderboard is rescued by the 320x50 beside it acting as a peer, and the two skyscrapers
escape on width. This is the shape the ad hunt was after, and it only appeared once the VPN-level
blocking was turned off.

Note what it does **not** show: an ad rescuing a *masthead*. Here the ad is itself the banner
candidate. The masthead-plus-leaderboard shape is still unmeasured.

### Mastheads under `BANNER_MIN` — condition (2)

```
linustechtips.com        304x58  @x15   13px down  -> previews: under 400px wide   (Pane)
forums.macrumors.com     250x71  @x185  10px down  -> previews: under 400px wide   (Chrome)
forums.spacebattles.com  340x58  @x188 294px down  -> previews: under 400px wide   (Chrome)
```

`BANNER_MIN` 400 is a width, and a great many forum and blog mastheads are a narrow logo lockup.
SpaceBattles fails conditions (1) **and** (2) at once. Low harm individually, but it is the same
bug and it is everywhere.

---

## MEASURED — FALSE POSITIVE (real content refused)

The larger and more damaging group, and every one is silent.

### The detail page — one big picture near the top

The single most reliable way to break the gate. A detail page has exactly one big picture on it,
which is precisely the shape conditions (3) and (4) cannot tell apart from a masthead.

| Page | Measurement | Browser |
|---|---|---|
| `unsplash.com/photos/<slug>` | 1082x721 @x269, **124px down**, alone, 0 same-width | Chrome |
| `flickr.com/photos/<user>/<id>` | 1050x656 @x85, **98px down**, alone, 0 same-width | Chrome |
| `pexels.com/photo/<slug>` | 1013x675 @x126, **168px down**, alone, 0 same-width | Pane |
| `wallhaven.cc/w/<id>` | 950x633 @x305, **158px down**, `id="wallpaper"`, alone, 0 same-width | Pane |
| `safebooru.org/index.php?page=post&s=view&id=<id>` | 850x850 @x233, **176px down**, `id="image"`, alone, 0 same-width | Pane |
| `furaffinity.net/view/<id>` | 1136x1136 @x30, **175px down**, `id="submissionImg"`, alone, 0 same-width | Chrome |

Samples: <https://unsplash.com/photos/hand-holding-smartphone-with-usb-drive-plugged-in-bSIKF9GnyPE>,
<https://www.flickr.com/photos/138486769@N02/55502473822/>,
<https://www.pexels.com/photo/blue-and-white-abstract-painting-1103970/>,
<https://wallhaven.cc/w/og79gm> (ids rotate — grab a fresh one from <https://wallhaven.cc/latest>),
<https://safebooru.org/index.php?page=post&s=view&id=7116188>.

Unsplash, Flickr and Pexels are the ones that matter: mainstream photo sites where the picture you
navigated to is the thing that will not preview. FurAffinity is the sharpest single page in the
corpus — **the artwork is refused while three ads above it preview**, which is the gate producing
exactly the inverse of what a user wants, on one screen.

Safebooru's engine is shared by gelbooru.com, rule34.xxx, xbooru.com and tbib.org, all with
`id="image"` in the same position — **inferred from the shared codebase, not measured.**
danbooru.donmai.us is blocked in both browsers, so the family stayed unverified.

### `www.tumblr.com/<blog>` — the first post in the feed (Pane)

```
580x326  @x302  34px down  -> REFUSED (alone, 0 same-width)
```

Sample: <https://www.tumblr.com/staff>. 519 images on the page and the top post is still "alone"
and "unique width", because posts in a feed are *not* uniform width — each is its own image at its
own size. Condition (4) assumes a single column has same-width tiles; a blog feed is a single
column of **differently**-sized pictures and defeats it completely.

This is the residual cost `CLAUDE.md` already admits ("a page whose first two pictures are
stacked, wide and near the top loses the first") showing up on a mainstream site.

### `www.newgrounds.com` — a featured tile 8px inside the band (Pane)

```
1542x1103  @x0    85px down  -> REFUSED   (site backdrop art; refusing is probably right)
 624x374   @x486 192px down  -> REFUSED   (featured content thumbnail; WRONG)
```

A real featured-content thumbnail at **192px** down, eight pixels inside `BANNER_TOP`. The
identical tile eight pixels lower previews normally. A hard document-Y cutoff has no soft edge,
and this is what that looks like in the wild.

### The hero, and the boundary the geometry cannot draw

```
nasa.gov            1556x640  @x0    86px down  -> REFUSED (alone, 1 same-width)   (Chrome)
<user>.itch.io/<game> 960x540  @x153   0px down  -> REFUSED (alone, 0 same-width)   (Pane)
```

Sample: <https://a1esska.itch.io/771-demo> (any itch.io game page is this shape).

```
allbirds.com        1536x810  @x10   42px down  -> REFUSED (alone, 0 same-width)   (Chrome)
```

NASA's is a full-bleed editorial hero photo with a headline over it; itch.io's is the game's key
art, the main thing the page is selling; Allbirds' is the storefront hero. **Whether these are false positives is a judgement call,
and that is the point** — `CLAUDE.md` says a full-width `<img>` with text over it is "an ordinary
shape for a picture that is genuinely the content", while `bannerReason()` refuses exactly that
shape. These are the clean examples of the two rules disagreeing, and NASA's is one same-width
neighbour away from flipping.

---

## `bannerReason()` also judges CSS backgrounds — undocumented, and it matters

`CLAUDE.md` frames the banner gate as "the narrow exception" that applies to an `<img>`, against
page-furniture rules that are "CSS backgrounds ONLY". In the code, `eligibleDirect()` calls
`bannerReason(el)` on whatever `el` is, and `bannerCheck()` only ever touches
`getBoundingClientRect()` and `shownUrl()` — **so it judges background elements too.**

Measured on `soundcloud.com/<artist>` (Chrome), where the profile banner is a CSS background:

```
BG 1208x254 @x174 110px down :: wallpaper=NO :: BANNER-REFUSED (alone, 0 same-width)
```

It escapes **all five** `wallpaperReason()` tests — not fixed, not tiled, `textContent` length 0,
and 1208/1556 = 78% of the viewport, under `BAND_WIDTH` 0.98 — and is then caught by the banner
gate instead. The right answer, by the other rule.

By contrast `nationalgeographic.com/animals` has its hero caught by **both** paths:

```
BG 1712x437 @x-78 48px down :: wallpaper=full-bleed band :: BANNER-REFUSED (alone, 0)
BG 1556x397 @x0   68px down :: wallpaper=full-bleed band :: BANNER-REFUSED (alone, 0)
```

Any rewrite needs to decide this deliberately rather than inherit it: **the two gates overlap on
CSS backgrounds, and the docs say they do not.** A probe that only walks `document.images` — as
the first version of the one below did — cannot see this class at all.

## MEASURED — controls and near-misses (currently correct)

A rewrite that breaks these has traded one bug for another.

| Page | Measurement | Verdict |
|---|---|---|
| **`youtube.com/@SabineHossenfelder`** signed in, guide open, 1556px (Chrome) | banner 1284x207 @x256, 56px down, alone, 0 same-width | **REFUSED — correct.** The canonical case now passes. See below. |
| `amandapalmer.bandcamp.com` (Pane) | 975x180 @ 1px down, alone, 0 same-width | **REFUSED — correct.** The clean true positive; every Bandcamp artist page is this shape. |
| `city-data.com/forum/` (Chrome) | 683x52 @x0, 0px down, alone, 0 same-width | **REFUSED — correct.** |
| `store.steampowered.com` (Chrome) | 1557x46 @x0, 104px down, alone | **REFUSED — correct.** A decorative page background shipped as an `<img>`. |
| `twitch.tv/<channel>` (both) | 533x300 @ 142px down, alone | **REFUSED.** Offline/stream card; other video gates would catch it anyway. |
| `artstation.com/artwork/<id>` (Chrome) | artwork 548x846 @ 104px down -> **previews: peer 334px beside** | **Correct, but by luck** — saved by a "more from this artist" sidebar thumbnail. An artwork page with an empty sidebar would be refused. |
| **`500px.com/photo/<id>/<slug>`** (Chrome) | photo 1104x736 @ 84px down -> **previews: peer 276px beside** | **Correct by exactly zero margin.** 276 / 1104 = **0.250000**, and the test is `q.width >= w * 0.25`, so it passes on equality. A 275px avatar refuses the photo. The single most fragile row in the corpus. **Re-verified against unrounded `getBoundingClientRect()` floats** — both widths are exactly integral (1104, 276) and `frac` is exactly 0.25, so this is not a rounding artefact. Note the page is slow: the photo needs ~15s to appear, and a probe run too early reports "no wide image". |
| `pixiv.net/en/artworks/<id>` (Chrome, signed out) | artwork 911x643 @ **302px down** | **previews — correct.** Clears `BANNER_TOP` comfortably; pixiv's header is tall. |
| `imgur.com/gallery/<slug>` (Chrome) | 480x741 @ **221px down** | **previews** — clears `BANNER_TOP` by 21px. |
| `questionablecontent.net` (Pane) | 815x60 header @ 107px down, alone, **1** same-width | **REFUSED — correct**, one image from flipping. Comic at 333px down is safe. |
| `alrincon.com/en/` (Pane) | 1000x557 @ 60px down, **set of 3** [621, 17189, 26919 down] | **previews — correct now.** Your reported case, fixed by `BANNER_SET_MIN` 2. Survives only because the page held three more 1000px posts; a short day's page would refuse it again. |
| `newegg.com` (Pane) | 1280x315 hero @ 140px down, alone | **REFUSED — correct.** Only one carousel slide mounts. |
| `aliexpress.us` (Pane) | 539x38 promo strip @ 182px down, alone | **REFUSED — correct.** |
| `soundcloud.com/<artist>` (Chrome) | CSS bg 1208x254 @ 110px down, `wallpaper=NO`, alone | **REFUSED — correct**, but by the banner gate, not the wallpaper gate. See the section above. |
| `nationalgeographic.com/animals` (Chrome) | CSS bg 1712x437 @ 48px down | **REFUSED — correct**, and caught by both gates at once. |
| `old.reddit.com/r/pics` (Chrome) | 300x31 CSS bg @ 148px down, `wallpaper=tiled` | **Correctly identified as tiled.** No header image on this sub. |
| `phpbb.com/community/` (Pane) | header is a **CSS background**, 1152x129 @ 42px down, `textContent` length **43** | Caught by `wallpaperReason`'s `CONTENT_CHARS` 40 — by three characters. Different gate, same brittleness. |

**No exposure at all** (nothing ≥250px wide within 900px of the document top, so the gate is never
reached): `reddit.com/r/EarthPorn` (first post at 352px down), `theverge.com/tech` (725px down),
`arstechnica.com` article (418px down), `9gag.com` (301px down), `apnews.com` (508px down),
`deviantart.com/<user>/gallery` (851px down), `resetera.com`, `bestbuy.com`, `xenforo.com/community`.

**Would not measure**: both Fandom wikis tried (`elderscrolls`, `minecraft`) returned
`document.images.length === 0` in both browsers after a 6s wait, which is not a real zero — the
probe cannot see whatever Fandom is doing. Worth a manual look, since wiki heroes are a plausible
shape.

### The YouTube case, re-measured signed in

`CLAUDE.md` records that condition (3) was broken by a 24px subscription avatar beside the banner,
visible only signed in with the guide open. That state was reproduced and the numbers are:

```
banner        1284x207  @x256 y56        guide open, guideW 240
in-band peer    24x24   @x24  y221       disjoint=true   frac=0.019
```

One image sits in the banner's vertical band, and at 1.9% of the banner's width it is far below
`BESIDE_PEER` 0.25 — so the quarter-width floor added in v0.23.0 is doing its job on the exact
case that motivated it. **Condition (3) has no measured failure in this corpus**, in either
browser state.

### Ads mostly cannot be peers, and it is not about ad blocking

The header leaderboard beside a logo is the classic shape for a condition (3) miss, so it was
chased directly. It does not work, and the reason is structural rather than environmental:

- **`bannerCheck()` reads `document.getElementsByTagName('img')`, which does not enter an
  iframe.** Nearly all display advertising renders inside a cross-origin iframe, so an ad is not
  an `<img>` in the top document and can never be counted as a peer or a set member.
- Measured on tomshardware.com: **7 iframes on the page, none of them in the header band**, and
  no ad `<img>` above 250px anywhere near the top.
- Measured on city-data.com three ways — Chrome with the extension blocker on, Chrome with it off,
  and the in-app pane which has **no blocking of any kind** — all three returned
  **`iframesTotal: 0`** and the same lone 683x52 masthead. The page simply has no header ad.

An earlier draft of this file claimed the ad blocker was hiding the evidence. That was wrong;
the unblocked pane shows the same thing.

**The exception is an ad served as a same-document `<img>`, and it is not merely theoretical.**
4chan's 468x60 is one; **FurAffinity is the full demonstration** — three ad images at the top of a
submission page, one of them rescued from refusal by another ad acting as its peer. Those pages
only measured this way once VPN-level blocking was off, so that change did widen the corpus,
contrary to what this file said a revision ago.

The distinction that survives: **iframe ads are invisible to the gate, same-document ad `<img>`s
are ordinary candidates and behave like any other picture.** Sites that self-serve their
advertising — image boards, older forums, art communities — are where ads enter the arithmetic.

---

## NOT a banner-gate failure — remove from the sample

**`www.ebaumsworld.com` picture galleries.** The two top images on
<https://www.ebaumsworld.com/pictures/20-photos-that-dont-have-time-to-explain-themselves/87766704/>
are not refused by the banner gate and cannot be: every gallery image is 440px wide at 1,148px or
more down the document, so conditions (1) and (2) exclude them before anything else runs.

Measured intrinsic vs displayed width on that page:

| # | intrinsic | displayed | ratio | vs `minRatio` 1.2 |
|---|---|---|---|---|
| 1 | 500 | 440 | 1.14 | **fails** |
| 2 | 500 | 440 | 1.14 | **fails** |
| 3 | 1078 | 440 | 2.45 | passes |
| 4 | 736 | 440 | 1.67 | passes |

On the page that works
(<https://www.ebaumsworld.com/pictures/15-notorious-american-criminals-of-the-19th-century/87766725/>)
every image is intrinsic 1170 at 440 displayed = 2.66. The two pages are identical in structure;
they differ only in how big the uploaded originals were. `minRatio` is doing what it is documented
to do.

---

## Blocked, and still unmeasured

**Blocked by the Claude-in-Chrome extension's own safety policy** — not by the network, a VPN, or
any ad blocker: `danbooru.donmai.us`, `gelbooru.com`, `e621.net`, `patreon.com`. Tool-driven navigation is
refused with `This site is not allowed due to safety restrictions`, and while such a tab is *open*
the extension refuses to enumerate tabs at all, so no other site can be reached either. Manual
browsing is unaffected. To add any of them, run the probe below in the console on the page and
paste the output.

This is why **the Gelbooru-engine family claim above rests on safebooru alone.** Both siblings
that would have confirmed it are blocked.

Not attempted: custom-theme Tumblr blogs. `behance.net` and `ko-fi.com` were tried with guessed
URLs that did not resolve — real ones would work.

**The all-slides carousel was predicted to be a miss, and the evidence now says it is not.**
Carousel-bearing pages were checked at Samsung (27 slides), Best Buy (27), Allbirds (23), Newegg,
Steam and AliExpress. In every case the off-screen slides and duplicate clones measured
`vis=false` and were correctly discarded by `reallyVisible()` — Allbirds shows the shape plainly,
with each product tile appearing twice, once `vis=true` and once `vis=false`. **`reallyVisible()`
and the v0.27.0 cross-fader fix are handling this class across six sites.**

What actually defeated the gate on Samsung was the **stacked full-width section banners further
down the page**, the same mechanism as Home Depot — not the slides. Treat "carousel clones form a
set" as disproved unless a counter-example turns up.

---

## Re-running the probe

Paste into the console on any page, scrolled to the top. Reports every image, video **and
CSS-background element** at least 250px wide within 900px of the document top, with both gates'
verdicts and the operands they decided on. Changes nothing on the page.

**Walk backgrounds as well as `document.images`** — the first version of this probe did not, and
it is blind to the entire SoundCloud/NatGeo class described above.

```js
(()=>{const T=200,M=400,S=.1,P=.25,N=2,BW=.98,CC=40;
const u=n=>n.currentSrc||n.src||'';
const V=n=>n.checkVisibility?n.checkVisibility({opacityProperty:true,visibilityProperty:true}):true;
const A=[...document.images,...document.getElementsByTagName('video')];
const vw=document.documentElement.clientWidth;
const wall=el=>{if(el===document.body||el===document.documentElement)return'page background';
  const s=getComputedStyle(el);
  if(s.backgroundAttachment.indexOf('fixed')>=0)return'attachment:fixed';
  if(!/no-repeat/.test(s.backgroundRepeat)&&/^auto/.test(s.backgroundSize))return'tiled';
  const r=el.getBoundingClientRect(); if(vw>0&&r.width>=vw*BW)return'full-bleed band';
  if((el.textContent||'').trim().length>=CC)return'text sits on it'; return null;};
const chk=el=>{const r=el.getBoundingClientRect(),w=r.width,d=Math.round(r.top+scrollY);
  if(w<M||r.height<2)return'previews (under '+M+'px wide)';
  if(d>T)return'previews ('+d+'px down, past '+T+')';
  const s=u(el);let b=0;const sw=[];
  for(const n of A){if(n===el)continue;const q=n.getBoundingClientRect();
    if(q.width<2||q.height<2)continue; if(s&&u(n)===s)continue;
    const m=q.top+q.height/2;
    if(!b&&q.width>=w*P&&m>=r.top&&m<=r.bottom&&(q.right<=r.left||q.left>=r.right)&&V(n))b=Math.round(q.width);
    if(Math.abs(q.width-w)<=w*S&&V(n))sw.push(Math.round(q.width)+'@x'+Math.round(q.left)+','+Math.round(q.top+scrollY)+'down');}
  const bl=[];if(b)bl.push('peer '+b+'px beside');
  if(sw.length>=N)bl.push('set of '+sw.length+' ['+sw.slice(0,3).join(' ')+']');
  return bl.length?'previews ('+bl.join(' + ')+')':'BANNER-REFUSED (alone, '+sw.length+' same-width)';};
const o=[];
for(const el of A){const r=el.getBoundingClientRect();const d=Math.round(r.top+scrollY);
  if(r.width<250||d>900)continue;
  o.push('IMG '+Math.round(r.width)+'x'+Math.round(r.height)+' @x'+Math.round(r.left)+' '+d+'down vis='+V(el)+' :: '+chk(el)+' :: '+u(el).slice(-45));}
for(const el of document.querySelectorAll('div,section,header,a,span,picture')){
  const s=getComputedStyle(el); if(!/url\(/.test(s.backgroundImage))continue;
  const r=el.getBoundingClientRect();const d=Math.round(r.top+scrollY);
  if(r.width<250||d>900)continue;
  o.push('BG  '+Math.round(r.width)+'x'+Math.round(r.height)+' @x'+Math.round(r.left)+' '+d+'down :: wallpaper='+(wall(el)||'NO')+' :: '+chk(el));}
return{url:location.href,vw,imgs:document.images.length,rows:o};})()
```

Some hosts (The Verge) make the harness redact any output containing a query string — print
`el.alt` instead of the src there.

---

## What the corpus says about each condition

Observations from the rows above, not a proposed design.

1. **`BANNER_TOP` 200 — a hard document-Y cutoff with no soft edge, and the corpus clusters right
   on it.** Newgrounds refuses a content tile at 192px and previews it at 208px. Home Depot's
   banner is caught at 197px; Steam's page backdrop escapes at 206px; imgur's content escapes at
   221px. Samsung's hero sits at **-7px**. AVS Forum's second header image clears the cutoff at
   319px purely because the banner above it is tall. The threshold has no relation to where the
   page's content actually begins.
2. **`BANNER_MIN` 400.** Lets narrow mastheads through — measured at 250, 300, 304 and 340px on
   four different sites, including 4chan's rotating board banner.
3. **The peer test — no measured failure, but the tightest margin in the corpus sits here.**
   Re-measured on the exact YouTube case that motivated it: the blocking avatar comes in at
   `frac=0.019` against a floor of 0.25, comfortably excluded. But **500px passes on exact
   equality** — a 276px avatar against a 1104px photo is 0.250000, and `>=` is what saves it. One
   pixel narrower and 500px joins the refused-content list. FurAffinity shows the other side: an
   ad acting as a peer for another ad, letting a 728x90 leaderboard preview. The rule's *direction*
   is right; its threshold is sitting exactly on a real site's geometry.
4. **`BANNER_SET_MIN` 2 — the weakest, as `CLAUDE.md` already says, and every loud miss comes from
   it.** Membership is decided on width alone: no shared x, no regular spacing, no distance bound,
   and no check that the members are *content* rather than more banners. Home Depot's set is four
   promo banners; Samsung's is three stacked section bands; AVS Forum's members are 319px and
   4,257px down the page. Symmetrically, a feed of differently-sized posts (Tumblr) forms no set at
   all and the top post is refused, and Alrincon passes only because that day's page happened to
   hold three more 1000px posts.

The two directions have a common root: **the gate reasons about one picture's width against a bag
of other widths, and never about layout.** Every miss is a coincidence of widths, and every false
positive is the absence of one.
