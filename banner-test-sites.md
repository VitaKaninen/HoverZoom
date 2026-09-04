# Banner-gate test corpus

Sample pages for rewriting `bannerCheck()`. Every row in the MEASURED sections was produced by
running a replica of the shipped gate against the live DOM in the Claude Code Browser pane on
**2026-09-04**, at a **1265-1280px viewport, signed out**, with the page scrolled to the top.

Gate replicated: `BANNER_TOP` 200, `BANNER_MIN` 400, `BANNER_SIMILAR` 0.1, `BESIDE_PEER` 0.25,
`BANNER_SET_MIN` 2, plus `reallyVisible()`.

Two directions of failure, and they pull the rules opposite ways:

- **MISS** — a real banner previews. The reported bug; loud.
- **FALSE POSITIVE** — real content is refused. Silent, so it is the one nobody reports.

**The viewport and the sign-in state are part of every measurement.** `CLAUDE.md` already records
that YouTube's blocking 24px avatar exists only signed in with the guide open. Several rows below
sit within 10-20px of a threshold, so a different window width flips them.

---

## MEASURED — MISS (banner previews when it should not)

### `www.avsforum.com` — the reported forum-masthead shape, caught live

```
1280x307  @x8    8px down   -> previews: set of 2 [1249@x8,319down  1404@x48,4257down]
1249x250  @x8  319px down   -> previews: 319px down, past 200
```

The best case in the corpus. A full-bleed 1280x307 masthead at 8px from the top of the document
is saved from refusal by two images that are **not a column**: the site logo 319px below it, and
something 4,257px down the page. Condition (4) asks only "does another picture share this width",
never "do these form a set" — no test of shared x, no test of regular spacing, no bound on how far
away a set member may be.

The second line is a separate miss on condition (1): the 1249x250 logo band sits at 319px down
because the banner above it is 307px tall, so a site with **two** stacked header images always
gets the lower one through.

### `xkcd.com` — condition (4) decided by coincidence

```
540x100  @x463  113px down  -> previews: set of 2 [520@x374,787down  520@x374,891down]
740x239  @x264  388px down  -> previews: 388px down, past 200 (the comic; correct)
```

The store-news banner previews only because two unrelated 520px images further down the page fall
within `BANNER_SIMILAR` of 540. Nothing about the page changed; the arithmetic did. Re-run this
one on a day the store strip is different and it may well flip to refused, which is the point.

### `linustechtips.com` — condition (2), a masthead under 400px

```
304x54  @x15  13px down  -> previews: under 400px wide
```

`BANNER_MIN` 400 is a width, and plenty of forum and blog mastheads are a narrow logo lockup.
Hovering the site logo pops a preview. Small and low-harm, but it is the same bug.

---

## MEASURED — FALSE POSITIVE (real content refused)

This is the larger and more damaging group, and every one of them is silent.

### `wallhaven.cc/w/<id>` — the wallpaper itself, on a wallpaper site

```
950x633  @x305  158px down  id="wallpaper"  -> REFUSED (alone, 0 same-width)
```

Sample: <https://wallhaven.cc/w/og79gm> (ids rotate; grab a fresh one from
<https://wallhaven.cc/latest>). The single reason the page exists is refused. It passes all four
conditions because a detail page has exactly one big picture on it — which is precisely the shape
conditions (3) and (4) cannot tell apart from a masthead.

### `safebooru.org/index.php?page=post&s=view&id=<id>` — booru post page

```
850x850  @x233  176px down  id="image"  -> REFUSED (alone, 0 same-width)
```

Sample: <https://safebooru.org/index.php?page=post&s=view&id=7116188>.
**This is a whole family, not one site** — Gelbooru's engine is shared by gelbooru.com,
rule34.xxx, xbooru.com, tbib.org and others, all with `id="image"` in the same position. Verify
one of the others before treating the family as measured; only safebooru was actually run.

### `www.tumblr.com/<blog>` — the first post in the feed

```
580x326  @x302  34px down  -> REFUSED (alone, 0 same-width)
```

Sample: <https://www.tumblr.com/staff>. 519 images on the page and the top post is still "alone"
and "unique width", because posts in a feed are *not* uniform width — each one is its own image at
its own size. Condition (4) was written assuming a single-column gallery has same-width tiles;
a blog feed is a single column of **differently**-sized pictures and defeats it completely.

This is the residual cost `CLAUDE.md` already admits ("a page whose first two pictures are
stacked, wide and near the top loses the first") showing up on a mainstream site.

### `www.newgrounds.com` — a featured tile 8px inside the band

```
1542x1103  @x0    85px down  -> REFUSED   (site backdrop art; refusing is probably right)
 624x374   @x486 192px down  -> REFUSED   (featured content thumbnail; WRONG)
```

The second one is the interesting row: a real featured-content thumbnail at **192px** down, eight
pixels inside `BANNER_TOP`. The identical tile eight pixels lower previews normally. A hard
document-Y cutoff has no soft edge, and this is what that looks like in the wild.

---

## MEASURED — controls and near-misses (currently correct, but thin)

Keep these in any test set; a rewrite that breaks them has traded one bug for another.

| Page | Measurement | Verdict |
|---|---|---|
| `amandapalmer.bandcamp.com` | 975x180 @ 1px down, alone, 0 same-width | **REFUSED — correct.** The clean true positive. Every Bandcamp artist page is this shape. |
| `questionablecontent.net` | 815x60 header @ 107px down, alone, **1** same-width | **REFUSED — correct**, but one image away from flipping. The comic at 333px down is safe. |
| `alrincon.com/en/` | 1000x557 @ 60px down, **set of 3** [1000@x133 at 621, 17189, 26919 down] | **previews — correct now.** Your reported case; fixed by `BANNER_SET_MIN` 2. It survives only because the page is long enough to hold three more 1000px posts. A short day's page would refuse it again. |
| `www.newegg.com` | 1280x315 hero @ 140px down, alone | **REFUSED — correct.** Only one carousel slide is mounted; a carousel that keeps all slides in the DOM would form a set and miss. Worth finding one that does. |
| `www.phpbb.com/community/` | header is a **CSS background**, 1152x129 @ 42px down, `textContent` length **43** | Caught by `wallpaperReason`'s `CONTENT_CHARS` 40 — by three characters. Not the banner gate, but the same brittleness. |

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
they differ only in how big the uploaded originals were. `minRatio` is doing exactly what it is
documented to do.

---

## LEADS — NOT MEASURED

Listed by the structural reason each is expected to break the gate. **Every one of these is a
prediction from shape, not a measurement** — run the probe below before quoting any of them.

Blocked from the in-app browser during this pass, so unverifiable here: `youtube.com` (navigation
denied), `reddit.com` and `danbooru.donmai.us` (blocked by policy), `artstation.com` and
`forums.spacebattles.com` (Cloudflare interstitial), `unsplash.com` (bot check),
`elderscrolls.fandom.com` (never populated `document.images`). Several of those are exactly the
shapes worth testing, so they need a real browser with the userscript installed.

**Detail pages — one big picture near the top** (expected FALSE POSITIVE, same shape as wallhaven
and safebooru): gelbooru.com, rule34.xxx, xbooru.com, tbib.org post pages; e621.net posts;
imgur.com single-post pages; flickr.com photo pages; 500px.com photo pages; artstation.com
artwork pages; deviantart.com deviation pages; pixiv artwork pages; alphacoders,
wallpaperflare and wallpapercave detail pages.

**Feeds whose first post sits high** (expected FALSE POSITIVE, same shape as Tumblr): any Tumblr
blog on a custom theme; Blogger and WordPress blogs with a short header; Ghost publications;
Substack post pages; Mastodon and Lemmy instance timelines; photo blogs on single-column themes.

**Mastheads with something beside them** (expected MISS via condition 3): any forum whose header
row is banner + ad slot, or banner + logo. vBulletin and Invision boards with a leaderboard ad in
the header are the densest source.

**Mastheads pushed past 200px** (expected MISS via condition 1): sites with a cookie bar,
announcement strip, or tall sticky nav above the banner. AVS Forum's second row above is already
this shape.

**Carousels that mount every slide** (expected MISS via condition 4): Swiper and Slick sliders
often keep all slides — and duplicate clones — in the DOM at the banner's width, which reads as a
set. Shopify and WooCommerce storefront themes, hotel and travel homepages, and university
department sites are where these cluster. Newegg is *not* one (only one slide mounts), so this
needs a positive example found rather than assumed.

**Channel and profile headers** (expected MISS or FALSE POSITIVE depending on sign-in):
youtube.com channel pages (the canonical case, and only reproducible signed in with the guide
open), twitch.tv channels, soundcloud.com profiles, patreon.com creator pages, behance.net
profiles, furaffinity.net user pages, newgrounds.com user pages.

---

## Re-running the probe

Paste into the console on any page, scrolled to the top. It reports every image and video at least
250px wide within 900px of the document top, with the gate's verdict and the operands it decided
on. It changes nothing on the page.

```js
(()=>{const T=200,M=400,S=.1,P=.25,N=2;
const u=n=>n.currentSrc||n.src||'';
const V=n=>n.checkVisibility?n.checkVisibility({opacityProperty:true,visibilityProperty:true}):true;
const A=[...document.images,...document.getElementsByTagName('video')];
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
  return bl.length?'previews ('+bl.join(' + ')+')':'REFUSED (alone, '+sw.length+' same-width)';};
const o=[];
for(const el of A){const r=el.getBoundingClientRect();const d=Math.round(r.top+scrollY);
  if(r.width<250||d>900)continue;
  o.push(Math.round(r.width)+'x'+Math.round(r.height)+' @x'+Math.round(r.left)+' '+d+'down :: '+chk(el)+' :: '+u(el).slice(-45));}
return{url:location.href,vw:document.documentElement.clientWidth,imgs:document.images.length,top:o};})()
```

---

## What the corpus says about each condition

Observations from the rows above, not a proposed design.

1. **`BANNER_TOP` 200 — a hard document-Y cutoff.** Newgrounds refuses a content tile at 192px
   and previews the same tile at 208px. AVS Forum's second header image clears it at 319px purely
   because the banner above it is tall. The cutoff has no soft edge and no relation to where the
   page's content actually starts.
2. **`BANNER_MIN` 400.** Lets narrow mastheads through (LTT, 304px).
3. **The peer test.** No measured failure in this pass — but every page here was signed out, and
   `CLAUDE.md` records that the case which broke it (YouTube's 24px avatar) exists only signed in.
   Untested in this pass rather than sound.
4. **`BANNER_SET_MIN` 2 — the weakest, as `CLAUDE.md` already says, and both loud misses come
   from it.** Membership in a "set" is decided on width alone: no shared x, no regular spacing, no
   distance bound. AVS Forum's set members are 319px and 4,257px down the page. Symmetrically, a
   feed of differently-sized posts (Tumblr) forms no set at all and the top post is refused.
   Alrincon passes only because that day's page happened to hold three more 1000px posts.
