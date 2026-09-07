// Standalone checks for the pure URL logic in Hover-Zoom.user.js.
// Slices the pure section out of the userscript and evaluates it with a stub
// location, so the rules under test are the shipped ones, not a copy.
//   node test-resolver.js

const fs = require('fs');

const src = fs.readFileSync(require('path').join(__dirname, 'Hover-Zoom.user.js'), 'utf8');
const start = src.indexOf('    function parseSrcset');
const end = src.indexOf('    const DATA_ATTRS');
if (start < 0 || end < 0) { console.error('markers not found'); process.exit(1); }

// The video-link heuristic lives further down the file, outside the pure-URL slice.
const vStart = src.indexOf('    const VIDEO_LINK_RE');
const vEnd = src.indexOf('    const PLAYER_UP');
if (vStart < 0 || vEnd < 0) { console.error('video markers not found'); process.exit(1); }
const VIDEO_LINK_RE = new Function(
    src.slice(vStart, vEnd) + '\nreturn VIDEO_LINK_RE;')();

// The banner gate's first three conditions need only the picture's own rectangle, so they
// slice out and run with no DOM at all. That is what lets `banner-test-sites.md` -- ~40 live
// pages measured in two browsers on 2026-09-04 -- be asserted here instead of merely written
// down, which is how the old gate's thresholds drifted onto real sites' geometry unnoticed.
const bStart = src.indexOf('    const BANNER_TOP');
const bEnd = src.indexOf('    // Returns WHICH condition decided');
if (bStart < 0 || bEnd < 0) { console.error('banner markers not found'); process.exit(1); }
const bannerShape = new Function(
    src.slice(bStart, bEnd) + '\nreturn bannerShape;')();

// gifLike() is the whole animated-image/player distinction and it reads only element
// properties, so it slices out and runs against plain objects with no DOM at all.
const gStart = src.indexOf('    const GIF_MAX_SECS');
const gEnd = src.indexOf('    // The first non-gif');
if (gStart < 0 || gEnd < 0) { console.error('gifLike markers not found'); process.exit(1); }
const gifLike = new Function(src.slice(gStart, gEnd) + '\nreturn gifLike;')();

// sizeFromHeaders() reads raw header text and nothing else. It is asserted here because the
// 206 trap is invisible at runtime: reading Content-Length on a partial response gives 4096
// for a 9 MB file, and the only symptom is a waiting budget that is far too short.
const szStart = src.indexOf('    function sizeFromHeaders');
const szEnd = src.indexOf('    // A silent GM_xhr means');
if (szStart < 0 || szEnd < 0) { console.error('sizeFromHeaders markers not found'); process.exit(1); }
const sizeFromHeaders = new Function(
    src.slice(szStart, szEnd) + String.fromCharCode(10) + 'return sizeFromHeaders;')();

const location = { href: 'https://example.com/page/index.html' };
const body = src.slice(start, end);
const exported = new Function('location', body +
    '\nreturn {parseSrcset, looksLikeImage, isVideoUrl, upgradeCandidates, linkParamCandidates, blockMatch, sameStem, urlStem, betterHit, sniffAnimated};')(location);
const { parseSrcset, looksLikeImage, isVideoUrl, upgradeCandidates, linkParamCandidates, blockMatch, sameStem, urlStem, betterHit, sniffAnimated } = exported;

let pass = 0, fail = 0;
const NL = String.fromCharCode(10);
function eq(label, got, want) {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) { pass++; } else { fail++; console.log('FAIL ' + label + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
function has(label, list, wanted) {
    const ok = list.includes(wanted);
    if (ok) { pass++; } else { fail++; console.log('FAIL ' + label + '\n  wanted ' + wanted + '\n  in    ' + JSON.stringify(list, null, 1)); }
}

// ---- srcset parsing
eq('srcset w-descriptors sort widest first',
    parseSrcset('a-320.jpg 320w, a-1280.jpg 1280w, a-640.jpg 640w'),
    ['a-1280.jpg', 'a-640.jpg', 'a-320.jpg']);

eq('srcset x-descriptors outrank bare w',
    parseSrcset('a.jpg 1x, b.jpg 2x'),
    ['b.jpg', 'a.jpg']);

eq('srcset tolerates commas inside CDN transform paths',
    parseSrcset('https://cdn.x/img/w_100,h_100/a.jpg 100w, https://cdn.x/img/w_900,h_900/a.jpg 900w'),
    ['https://cdn.x/img/w_900,h_900/a.jpg', 'https://cdn.x/img/w_100,h_100/a.jpg']);

// ---- format detection: every case HZ+'s `.jpg`-only check rejects
['a.jpg', 'a.jpeg', 'a.png', 'a.webp', 'a.avif', 'a.gif', 'a.JPG', 'a.svg', 'a.jxl'].forEach(function (n) {
    const u = 'https://example.com/' + n;
    if (looksLikeImage(u)) pass++; else { fail++; console.log('FAIL format ' + n); }
});
eq('query string does not defeat detection', looksLikeImage('https://example.com/a.jpg?w=400'), true);
eq('fragment does not defeat detection', looksLikeImage('https://example.com/a.png#x'), true);
eq('extensionless with format param', looksLikeImage('https://cdn.example.com/i/abc?format=webp'), true);
eq('html page is not an image', looksLikeImage('https://example.com/photo/12345'), false);

// ---- upgrade rules
has('strips resize query params',
    upgradeCandidates('https://cdn.example.com/a.jpg?w=400&h=300&quality=70'),
    'https://cdn.example.com/a.jpg');

// The query on a media path is decoration over a file that exists either way, so
// dropping it asks for the same picture bigger. The query on a SCRIPT path is the
// request itself — a rotating forum banner answers `/banner.php` with an unrelated
// picture, and probe and frame then agree on it perfectly. Reported 2026-09-03.
none('no query strip on a path with no media extension',
    'https://forum.example.com/banner.php?loc=header&w=1200');
none('no query strip on an extensionless endpoint',
    'https://forum.example.com/images/random?section=4&size=large');
has('query strip still applies to a media path',
    upgradeCandidates('https://cdn.example.com/b.png?width=200&thumb=1'),
    'https://cdn.example.com/b.png');

has('twitter name=small -> orig',
    upgradeCandidates('https://pbs.twimg.com/media/ABC.jpg?format=jpg&name=small'),
    'https://pbs.twimg.com/media/ABC.jpg?format=jpg&name=orig');

has('wordpress -150x150 suffix',
    upgradeCandidates('https://site.com/wp-content/uploads/2024/03/pic-150x150.jpg'),
    'https://site.com/wp-content/uploads/2024/03/pic.jpg');

has('shopify _400x400 suffix',
    upgradeCandidates('https://cdn.shopify.com/s/files/1/x/pic_400x400.jpg'),
    'https://cdn.shopify.com/s/files/1/x/pic.jpg');

has('cloudinary transform segment',
    upgradeCandidates('https://res.cloudinary.com/demo/image/upload/w_400,h_300,c_fill/sample.jpg'),
    'https://res.cloudinary.com/demo/image/upload/sample.jpg');

has('googleusercontent =s400 -> =s0',
    upgradeCandidates('https://lh3.googleusercontent.com/abc=s400-c'),
    'https://lh3.googleusercontent.com/abc=s0');

has('mediawiki thumb path',
    upgradeCandidates('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/220px-Cat.jpg'),
    'https://upload.wikimedia.org/wikipedia/commons/a/ab/Cat.jpg');

has('squarespace format bump',
    upgradeCandidates('https://images.squarespace-cdn.com/content/x/pic?format=500w'),
    'https://images.squarespace-cdn.com/content/x/pic?format=2500w');

has('generic /thumb/ path segment',
    upgradeCandidates('https://site.com/images/thumb/pic.png'),
    'https://site.com/images/pic.png');

has('generic _thumb filename suffix',
    upgradeCandidates('https://site.com/images/pic_thumb.png'),
    'https://site.com/images/pic.png');

// ---- Etsy. Measured live 2026-09-07: il_510x638 is 70 KB, il_1140xN 223 KB, il_fullxfull 323 KB.
has('etsy size prefix to fullxfull',
    upgradeCandidates('https://i.etsystatic.com/19619146/r/il/ee675c/6642205685/il_510x638.6642205685_jhs0.jpg'),
    'https://i.etsystatic.com/19619146/r/il/ee675c/6642205685/il_fullxfull.6642205685_jhs0.jpg');
has('etsy handles the xN form the ladder also uses',
    upgradeCandidates('https://i.etsystatic.com/1/r/il/aa/22/il_794xN.123_abc.jpg'),
    'https://i.etsystatic.com/1/r/il/aa/22/il_fullxfull.123_abc.jpg');
none('the etsy rule is host-scoped', 'https://cdn.other.com/il_510x638.123_abc.jpg');

// ArtStation's thumbnail is a 400x400 square crop of a 762x1047 original, so the shape test
// refuses the og:image the linked page declares — and the filename is identical either side.
// That match is what overrides it; see the `named` flag in resolve(). Measured 2026-09-07.
eq('artstation thumbnail and original share a stem across different size segments',
    sameStem('https://cdna.artstation.com/p/assets/images/images/001/936/185/large/tiago-kogi-red-panda-2.jpg',
             'https://cdna.artstation.com/p/assets/images/images/001/936/185/20160207045143/smaller_square/tiago-kogi-red-panda-2.jpg'),
    true);

// ---- Pinterest. Sizes measured live 2026-09-07 on three pins: 60x60 1.3KB, 236x 18KB,
// 474x 56KB, 736x 103KB, 1200x 170KB. /originals/ was 403 on one of the three and identical to
// 1200x on the other two, so both are offered rather than either alone.
has('pinterest size segment to originals',
    upgradeCandidates('https://i.pinimg.com/60x60/fa/de/85/fade85201d3af07f0c74573447544e67.jpg'),
    'https://i.pinimg.com/originals/fa/de/85/fade85201d3af07f0c74573447544e67.jpg');
has('pinterest size segment to 1200x, the fallback when originals 403s',
    upgradeCandidates('https://i.pinimg.com/236x/fa/de/85/fade85201d3af07f0c74573447544e67.jpg'),
    'https://i.pinimg.com/1200x/fa/de/85/fade85201d3af07f0c74573447544e67.jpg');
has('pinterest already at originals still offers 1200x',
    upgradeCandidates('https://i.pinimg.com/originals/fa/de/85/fade85201d3af07f0c74573447544e67.jpg'),
    'https://i.pinimg.com/1200x/fa/de/85/fade85201d3af07f0c74573447544e67.jpg');

// The marker vocabulary was widened from HZ+'s 398 plugins, where these four are the tokens
// that recur outside our list. See RESOLVER.md "What HZ+'s plugins actually contain".
has('generic /tiny/ path segment',
    upgradeCandidates('https://site.com/gallery/tiny/pic.jpg'),
    'https://site.com/gallery/pic.jpg');
has('generic /square/ path segment',
    upgradeCandidates('https://site.com/gallery/square/pic.jpg'),
    'https://site.com/gallery/pic.jpg');
has('generic _mini filename suffix',
    upgradeCandidates('https://site.com/images/pic_mini.png'),
    'https://site.com/images/pic.png');
has('generic -micro filename suffix',
    upgradeCandidates('https://site.com/images/pic-micro.png'),
    'https://site.com/images/pic.png');

// ---- an OPAQUE size code on the stem, where no vocabulary names it.
// my.evilmilk.com serves the same picture at _t3 (340px), _s (600px) and bare (720px), so the
// bare stem is the top of the ladder. Measured live 2026-09-05.
has('opaque _t3 size code is stripped to the bare stem',
    upgradeCandidates('https://my.evilmilk.com/p/5bq-4evr26_t3.jpg'),
    'https://my.evilmilk.com/p/5bq-4evr26.jpg');

has('a tilde in the stem does not stop it',
    upgradeCandidates('https://my.evilmilk.com/p/5bq-4evq~p_t3.jpg'),
    'https://my.evilmilk.com/p/5bq-4evq~p.jpg');

has('two-letter size codes are stripped', upgradeCandidates('https://site.com/i/pic_xl.jpg'),
    'https://site.com/i/pic.jpg');

has('a hyphen separator works the same', upgradeCandidates('https://site.com/i/pic-v2.jpg'),
    'https://site.com/i/pic.jpg');

// The token is capped at two characters MINIMUM and four maximum, which is what keeps this rule
// off single-letter suffixes -- imgur's _d, and the _a/_b of a numbered series.
none('a single-letter suffix is too ambiguous to strip', 'https://site.com/i/diagram_a.jpg');
none('so is _s, which is a THUMBNAIL on one evilmilk host and the ORIGINAL on the other',
    'https://site.com/i/picture_s.jpg');
none('a digit-only suffix is a series number, not a size',
    'https://site.com/i/photo_1.jpg');
none('a digit-led token is not a size code here', 'https://site.com/i/logo_2x.png');
none('a real word is left to the named-vocabulary rule above',
    'https://site.com/i/picture_large.jpg');
none('the remaining stem must be at least three characters',
    'https://site.com/i/ab_t3.jpg');

// ---- imgur thumbnail suffixes. The positive cases are all measured against the live host
// (2026-09-03); the negative ones are the point of the rule, because a bare id with its last
// character removed is a REAL image of something else and would load without complaint.
has('imgur _d thumbnail suffix, query dropped with it',
    upgradeCandidates('https://i.imgur.com/T22ZUhZ_d.jpg?maxwidth=520&shape=thumb&fidelity=high'),
    'https://i.imgur.com/T22ZUhZ.jpg');

// .webp is imgur's transcode and is STILL for an animated post, so it is rewritten to .jpg,
// which returns the stored original bytes whatever the real format is.
has('imgur _d on a webp thumbnail, rewritten away from webp',
    upgradeCandidates('https://i.imgur.com/KlprxXs_d.webp'),
    'https://i.imgur.com/KlprxXs.jpg');

has('imgur single-letter suffix on an 8-char basename',
    upgradeCandidates('https://i.imgur.com/KlprxXsm.webp'),
    'https://i.imgur.com/KlprxXs.jpg');

has('imgur single-letter suffix on a 6-char basename (5-char id)',
    upgradeCandidates('https://i.imgur.com/T22ZUh.jpg'),
    'https://i.imgur.com/T22ZU.jpg');

has('imgur ?tb animated thumbnail on a bare id',
    upgradeCandidates('https://i.imgur.com/zFAj8eD.webp?tb'),
    'https://i.imgur.com/zFAj8eD.jpg');

has('imgur bare webp is still worth rewriting — it is the de-animated transcode',
    upgradeCandidates('https://i.imgur.com/zFAj8eD.webp'),
    'https://i.imgur.com/zFAj8eD.jpg');

// Every imgur URL now also yields the moving original, so "left alone" no longer means
// "no candidates" — it means THE ID WAS NOT TRUNCATED. That is the bound whose failure
// shows the wrong picture (T22ZUh.jpg is a real image of something else entirely), so it
// is asserted directly rather than inferred from an empty list.
onlyVideo('imgur bare 7-char id is left alone',
    'https://i.imgur.com/T22ZUhZ.jpg', 'https://i.imgur.com/T22ZUhZ.mp4');
onlyVideo('imgur bare 5-char id is left alone',
    'https://i.imgur.com/T22ZU.jpg', 'https://i.imgur.com/T22ZU.mp4');
onlyVideo('imgur bare 7-char png id is left alone',
    'https://i.imgur.com/KlprxXs.png', 'https://i.imgur.com/KlprxXs.mp4');
none('the imgur rule is host-checked', 'https://notimgur.com/T22ZUhZ_d.jpg');
none('imgur nested paths are not ids', 'https://i.imgur.com/a/b/T22ZUhZ_d.jpg');

// ---- the moving original. Measured 2026-09-03: EDiKb3d.jpg is image/jpeg and a single
// frozen frame, EDiKb3d.mp4 is 10.85 s of the actual post at the same 480×854. For that
// kind of imgur post the animated form does not exist as an image at all.
eq('the video candidate is offered FIRST, ahead of the still',
    upgradeCandidates('https://i.imgur.com/EDiKb3d_d.jpg?maxwidth=520&shape=thumb')[0],
    'https://i.imgur.com/EDiKb3d.mp4');
has('imgur thumbnail still also yields the image original',
    upgradeCandidates('https://i.imgur.com/EDiKb3d_d.jpg?maxwidth=520&shape=thumb'),
    'https://i.imgur.com/EDiKb3d.jpg');
has('an imgur webp thumbnail yields the moving original too',
    upgradeCandidates('https://i.imgur.com/KlprxXsm.webp'),
    'https://i.imgur.com/KlprxXs.mp4');
none('the imgur video rule is host-checked too', 'https://imgur.com.evil.test/T22ZUhZ.jpg');

// gifwow: /gifs/<id>.jpg is the grid poster, /gifs/<id>.mp4 is the post page's player.
has('gifwow poster to player',
    upgradeCandidates('https://gifwow.com/gifs/gp-1tnq3g.jpg'),
    'https://gifwow.com/gifs/gp-1tnq3g.mp4');
has('gifwow webp animation to player',
    upgradeCandidates('https://gifwow.com/gifs/gp-1tnq3g.webp'),
    'https://gifwow.com/gifs/gp-1tnq3g.mp4');
none('the gifwow rule is host-checked', 'https://notgifwow.com/gifs/gp-1tnq3g.jpg');
none('the gifwow rule is anchored to /gifs/', 'https://gifwow.com/img/gp-1tnq3g.jpg');
none('the gifwow rule does not touch its own mp4', 'https://gifwow.com/gifs/gp-1tnq3g.mp4');

// ---- which face of the viewer a candidate needs
['a.mp4', 'a.webm', 'a.m4v', 'a.mov', 'a.ogv', 'a.MP4'].forEach(function (n) {
    if (isVideoUrl('https://example.com/' + n)) pass++; else { fail++; console.log('FAIL video ext ' + n); }
});
eq('a query string does not hide the extension', isVideoUrl('https://x.com/a.mp4?t=1'), true);
eq('an image is not a video', isVideoUrl('https://x.com/a.jpg'), false);
eq('mp4 in the QUERY is not a video url', isVideoUrl('https://x.com/page?file=a.mp4'), false);
eq('mp4 mid-path is not the extension', isVideoUrl('https://x.com/a.mp4.jpg'), false);

// ---- the transform-segment rule must not eat ordinary path segments
// Produces exactly one candidate, the moving original, and no image rewrite at all.
function onlyVideo(label, url, wanted) {
    const out = upgradeCandidates(url);
    if (JSON.stringify(out) === JSON.stringify([wanted])) { pass++; return; }
    fail++; console.log('FAIL ' + label + NL + '  got  ' + JSON.stringify(out) + NL + '  want ' + JSON.stringify([wanted]));
}

function none(label, url) {
    const out = upgradeCandidates(url);
    if (out.length === 0) { pass++; return; }
    fail++; console.log('FAIL ' + label + ' should produce no candidates\n  got ' + JSON.stringify(out));
}
none('locale segment /en_US/ is not a transform', 'https://site.com/en_US/images/pic.jpg');
none('version segment /v_2/ is not a transform', 'https://site.com/v_2/assets/photo.png');
none('arbitrary /a_b/c_d/ is not a transform', 'https://cdn.site.com/a_b/c_d/pic.jpg');
none('underscored filename is not a transform', 'https://site.com/img/my_photo.jpg');

has('multiple transform segments all stripped',
    upgradeCandidates('https://cdn.site.com/w_100,h_100/c_fill,w_50/pic.jpg'),
    'https://cdn.site.com/pic.jpg');

has('transform segment without w_/h_ digits is left alone, others still work',
    upgradeCandidates('https://res.cloudinary.com/demo/image/upload/c_fill,w_400/sample.jpg'),
    'https://res.cloudinary.com/demo/image/upload/sample.jpg');

// ---- google size tokens, both the '=' and the path-segment form
has('googleusercontent /s400/ segment -> /s0/',
    upgradeCandidates('https://lh3.googleusercontent.com/x/s400/photo.jpg'),
    'https://lh3.googleusercontent.com/x/s0/photo.jpg');
has('googleusercontent =w1200-h800 -> =s0',
    upgradeCandidates('https://lh3.googleusercontent.com/abc=w1200-h800-no'),
    'https://lh3.googleusercontent.com/abc=s0');
none('a /s400/ segment on any other host is just a path',
    'https://cdn.example.com/x/s400/photo.jpg');
none('googleusercontent already at s0 is left alone',
    'https://lh3.googleusercontent.com/x/s0/photo.jpg');

// ---- image URLs carried as a query parameter of a viewer/redirect link
eq('imgurl= parameter is extracted and decoded',
    linkParamCandidates('https://www.google.com/imgres?imgurl=https%3A%2F%2Fsite.com%2Fbig.jpg&imgrefurl=x'),
    ['https://site.com/big.jpg']);
eq('proxy style ?url= is extracted',
    linkParamCandidates('https://proxy.example/resize?url=https://cdn.site/photo.png&w=200'),
    ['https://cdn.site/photo.png']);
// Negative cases: over-matching here shows the WRONG image, which is worse than showing none.
eq('non-image parameters are ignored',
    linkParamCandidates('https://site.com/go?next=https://site.com/article.html&ref=abc'),
    []);
eq('relative parameter values are ignored',
    linkParamCandidates('https://site.com/view?src=/images/photo.jpg'),
    []);
eq('thumbnail-named parameters are skipped even when they are images',
    linkParamCandidates('https://site.com/v?thumb=https://cdn/small.jpg&preview_url=https://cdn/p.jpg'),
    []);
// An extension is not the only proof: the parameter's NAME can declare the value is an image.
// Bing's mediaurl is an extensionless resize endpoint, and requiring an extension sent the
// resolver to the linked page instead, which answers og:image with Bing's own share card. See E48.
eq('mediaurl= is taken even with no extension on the path',
    linkParamCandidates('https://www.bing.com/images/search?view=detailV2&mediaurl=https%3A%2F%2Fhost.com%2Fup%2Fresize%2F1280x720!%2Fquality%2F90%2F'),
    ['https://host.com/up/resize/1280x720!/quality/90/']);
eq('img_url= and piurl= are image-declaring names too',
    linkParamCandidates('https://yandex.com/images/search?img_url=https%3A%2F%2Fa.com%2Fx&piurl=https%3A%2F%2Fb.com%2Fy'),
    ['https://a.com/x', 'https://b.com/y']);
eq('an image-declaring name still loses to a thumbnail name',
    linkParamCandidates('https://site.com/v?thumb_url=https://cdn/small'), []);
eq('a bare ?url= still needs an extension, so a redirect target is not an image',
    linkParamCandidates('https://site.com/go?url=https://site.com/article'), []);
eq('a link with no query yields nothing',
    linkParamCandidates('https://site.com/gallery/item'), []);
eq('a malformed href yields nothing rather than throwing',
    linkParamCandidates('::::not a url::::'), []);

// ---- sites surveyed 2026-09-07; each transform confirmed live before the rule was written
has('reddit preview slug form yields the direct host',
    upgradeCandidates('https://preview.redd.it/met-these-two-cuties-at-jardin-des-plantes-in-paris-v0-sw0xl9lxexnh1.jpg?width=640'),
    'https://i.redd.it/sw0xl9lxexnh1.jpg');
has('reddit bare form still works',
    upgradeCandidates('https://preview.redd.it/abc123def.png'),
    'https://i.redd.it/abc123def.png');
eq('i.redd.it is already the direct host',
    upgradeCandidates('https://i.redd.it/sw0xl9lxexnh1.jpg').filter(u => /redd\.it/.test(u)), []);
has('flickr _n upgrades to _b',
    upgradeCandidates('https://live.staticflickr.com/4120/4820124455_f657d22a9c_n.jpg'),
    'https://live.staticflickr.com/4120/4820124455_f657d22a9c_b.jpg');
has('flickr also offers _k, which 410s where it does not exist',
    upgradeCandidates('https://live.staticflickr.com/4120/4820124455_f657d22a9c_n.jpg'),
    'https://live.staticflickr.com/4120/4820124455_f657d22a9c_k.jpg');
has('a flickr url with no size suffix still gets one',
    upgradeCandidates('https://live.staticflickr.com/4120/4820124455_f657d22a9c.jpg'),
    'https://live.staticflickr.com/4120/4820124455_f657d22a9c_b.jpg');
has('a leading thumbnail marker is stripped from the filename',
    upgradeCandidates('https://cdn.example/img/thumbnail_b3e903d8d23eaeff.jpg'),
    'https://cdn.example/img/b3e903d8d23eaeff.jpg');
has('the gelbooru family maps /thumbnails/ to /images/ and drops the prefix',
    upgradeCandidates('https://safebooru.org/thumbnails/1358/thumbnail_b3e903d8d23eaeff3821e1094b8e444e6c270b54.jpg?7124806'),
    'https://safebooru.org/images/1358/b3e903d8d23eaeff3821e1094b8e444e6c270b54.jpg');

// ---- a source URL base64url-encoded in the path (E51)
has('brave/imgproxy base64 path decodes to the source',
    upgradeCandidates('https://imgs.search.brave.com/GTjfXXbCnK5MJOjQSivz5qLFeRU73hL_-ccBZb9zk2g/rs:fit:500:0:1:0/g:ce/aHR0cHM6Ly93d3cu/bHB6b28ub3JnL3dw/LWNvbnRlbnQvdXBs/b2Fkcy8yMDIyLzEy/L2ZfcnAuanBn'),
    'https://www.lpzoo.org/wp-content/uploads/2022/12/f_rp.jpg');
has('a decoded source keeps its own query for the later rules to chew on',
    upgradeCandidates('https://imgs.search.brave.com/piBq5qA1HSHU1Ws444HaWlWykU7mldkRgWcFLCRR__Y/rs:fit:0:180:1:0/g:ce/aHR0cHM6Ly9mYXVu/YWZvY3VzLmNvbS93/cC1jb250ZW50L3Vw/bG9hZHMvMjAxNy8w/OS9jcm9wcGVkLTM1/NzYwNTQ4MjM0XzZl/OWU0MGNmZjRfby5q/cGc_dz03MDA'),
    'https://faunafocus.com/wp-content/uploads/2017/09/cropped-35760548234_6e9e40cff4_o.jpg?w=700');
eq('ordinary path segments do not decode to anything',
    upgradeCandidates('https://cdn.example/photos/2024/january/holiday/beach.jpg')
        .filter(u => /^https?:\/\//.test(u) && u.indexOf('cdn.example') === -1), []);
eq('a long hex id is not mistaken for an encoded url',
    upgradeCandidates('https://cdn.example/i/0a1b2c3d4e5f60718293a4b5c6d7e8f9')
        .filter(u => u.indexOf('cdn.example') === -1), []);

// ---- size parameters on an extensionless CDN path (E50)
has('extensionless CDN id path drops w/h',
    upgradeCandidates('https://th.bing.com/th/id/OIP.XwOEWPBVs8clfI8jAokcPwHaLH?w=89&h=89&c=1&pid=InlineBlock'),
    'https://th.bing.com/th/id/OIP.XwOEWPBVs8clfI8jAokcPwHaLH?c=1&pid=InlineBlock');
// The guards. Each of these would be an unrelated picture, not a bigger one.
eq('a script endpoint keeps its query, whatever it looks like',
    upgradeCandidates('https://forum.example/rotate.php?loc=header&w=200')
        .filter(u => u.indexOf('rotate.php') >= 0 && u.indexOf('loc=header') === -1), []);
eq('a short generic last segment is not an opaque id',
    upgradeCandidates('https://searx.be/image_proxy?w=200&h=100')
        .filter(u => u.indexOf('image_proxy') >= 0), []);
eq('a next/image style endpoint is left to the proxy rule',
    upgradeCandidates('https://site.com/_next/image?w=640&q=75')
        .filter(u => u.indexOf('_next/image') >= 0), []);
eq('an id with no digits is not opaque enough',
    upgradeCandidates('https://cdn.example/assets/somethinglong?w=200')
        .filter(u => u.indexOf('somethinglong') >= 0), []);

// ---- upgrades must never return the input unchanged, and never throw
const noisy = ['https://a.com/x.jpg', 'not a url at all', '/relative/p.png', 'data:image/png;base64,AAA',
    'https://a.com/', 'https://a.com/x.jpg?w=1', 'https://lh3.googleusercontent.com/abc'];
noisy.forEach(function (u) {
    let out;
    try { out = upgradeCandidates(u); } catch (e) { fail++; console.log('FAIL threw on ' + u + ': ' + e.message); return; }
    if (!Array.isArray(out)) { fail++; console.log('FAIL non-array for ' + u); return; }
    if (out.some(function (r) { return r === u; })) { fail++; console.log('FAIL echoed input for ' + u); return; }
    pass++;
});

// ---- the video-link heuristic: what it must catch, and what it must leave alone.
// Over-matching here is silent — the image simply never previews — so the negatives are
// the half that matters, same as for UPGRADES.
[
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/abc123',
    'https://player.vimeo.com/video/12345',
    'https://www.twitch.tv/videos/987654',
    'https://site.com/embed/xyz',
    'https://cdn.com/media/clip.mp4',
    'https://cdn.com/media/stream.m3u8?token=1',
].forEach(function (u) {
    if (VIDEO_LINK_RE.test(u)) pass++;
    else { fail++; console.log('FAIL video link not caught: ' + u); }
});

[
    'https://site.com/photos/2024/beach.jpg',
    'https://site.com/gallery/item?id=5',
    'https://news.com/article/watch-out-for-scams',
    'https://shop.com/products/movado-watch',
    'https://site.com/embedded/thing',
    'https://site.com/videography/portfolio.jpg',
    'https://cdn.com/img/movies/poster.jpg',
    'https://site.com/v/12345',
    'https://site.com/watchmen-review',
].forEach(function (u) {
    if (!VIDEO_LINK_RE.test(u)) pass++;
    else { fail++; console.log('FAIL video link over-matched: ' + u); }
});

// ---- gifLike(): which <video> is an animated image and which is a player.
// The four properties are ANDed and each alone has a false positive, so every case below
// turns exactly one of them off. `duration` carries the argument; an unknown one reads as a
// player, which is the safe direction and is what keeps an empty <video> refused.
function vid(o) {
    const v = { controls: false, muted: true, loop: true, autoplay: false, duration: 4 };
    Object.keys(o).forEach(function (k) { v[k] = o[k]; });
    v.hasAttribute = function (a) { return a === 'controls' && !!v.controls; };
    return v;
}
eq('a muted looping controls-less short clip is an animated image', gifLike(vid({})), true);
eq('autoplay alone satisfies the loop-or-autoplay half',
    gifLike(vid({ loop: false, autoplay: true })), true);
eq('neither loop nor autoplay is not a clip',
    gifLike(vid({ loop: false, autoplay: false })), false);
eq('controls make it a player', gifLike(vid({ controls: true })), false);
eq('sound makes it a player', gifLike(vid({ muted: false })), false);
eq('over a minute is a player', gifLike(vid({ duration: 61 })), false);
eq('exactly a minute is still a clip', gifLike(vid({ duration: 60 })), true);
eq('an unknown duration reads as a player', gifLike(vid({ duration: NaN })), false);
eq('an empty <video> reads as a player', gifLike(vid({ duration: 0 })), false);
eq('an endless stream reads as a player', gifLike(vid({ duration: Infinity })), false);
// A site that draws its own chrome leaves `controls` false, and an autoplay policy leaves it
// muted: duration is the only test still standing, and it is the one that must hold.
eq('a custom-chrome player is caught by duration alone',
    gifLike(vid({ autoplay: true, loop: false, duration: 212 })), false);

// ---- betterHit(): the two resolver paths emit independently and warm caches reorder them,
// so this is what stops a later hit downgrading the frame. Order is trusted > video > area.
const still = function (w) { return { w: w, h: w, video: false }; };
const movie = function (w) { return { w: w, h: w, video: true }; };
eq('anything beats an empty frame', betterHit(null, still(100)), true);
eq('nothing is not an upgrade', betterHit(still(100), null), false);
eq('a bigger still replaces a smaller one', betterHit(still(100), still(200)), true);
eq('a smaller still does not replace a bigger one', betterHit(still(200), still(100)), false);
eq('the same size is not an improvement', betterHit(still(200), still(200)), false);
eq('a video replaces a still, even a much bigger still',
    betterHit(still(4000), movie(100)), true);
eq('a still NEVER replaces a video, however big',
    betterHit(movie(100), still(4000)), false);
eq('a bigger video replaces a smaller video', betterHit(movie(100), movie(200)), true);
// The linked page's own answer outranks a URL guess regardless of size -- that is `trusted`.
eq('the linked page beats a bigger guess',
    betterHit(still(4000), { w: 100, h: 100, trusted: true }), true);
eq('a guess never displaces the linked page',
    betterHit({ w: 100, h: 100, trusted: true }, still(4000)), false);

// ---- sniffAnimated(): the animated-image filter, over real container headers.
// Only consulted at videoMode 'none', and a wrong `true` there costs one refused preview.
function bytes(str, pad) {
    const a = new Uint8Array(str.length + (pad || 0));
    for (let i = 0; i < str.length; i++) a[i] = str.charCodeAt(i);
    return a;
}
function webp(fourcc, flags, tail) {
    const a = bytes('RIFF____WEBP' + fourcc + '____', 200);
    a[20] = flags;
    if (tail) for (let i = 0; i < tail.length; i++) a[40 + i] = tail.charCodeAt(i);
    return a;
}
eq('an animated webp is caught by the VP8X animation flag', sniffAnimated(webp('VP8X', 0x12)), true);
eq('a still webp with a VP8X chunk is not', sniffAnimated(webp('VP8X', 0x10)), false);
eq('a plain lossy webp is not', sniffAnimated(webp('VP8 ', 0)), false);
eq('an ANMF chunk alone is enough', sniffAnimated(webp('VP8 ', 0, 'ANMF')), true);
eq('an animated gif is caught by its loop extension',
    sniffAnimated(bytes('GIF89a' + 'x'.repeat(20) + 'NETSCAPE2.0', 40)), true);
eq('a still gif is not', sniffAnimated(bytes('GIF89a', 40)), false);
const APNG = bytes('QPNG', 100); APNG[0] = 0x89;
'acTL'.split('').forEach(function (c, i) { APNG[40 + i] = c.charCodeAt(0); });
eq('an APNG is caught by its acTL chunk', sniffAnimated(APNG), true);
const PNG = bytes('QPNG', 100); PNG[0] = 0x89;
eq('a plain png is not', sniffAnimated(PNG), false);
eq('a truncated read is never called animated', sniffAnimated(new Uint8Array(8)), false);
eq('no bytes at all is not animated', sniffAnimated(null), false);

// ---- the never-preview list
// A wrong match here is SILENT — the image just stops previewing, with nothing on screen to
// say why — so the negative cases matter more than the positive ones, same as UPGRADES.
const TILE = 'https://site.com/img/tile.png';
eq('exact url matches', blockMatch(TILE, [TILE]), true);
eq('empty list matches nothing', blockMatch(TILE, []), false);
eq('no url matches nothing', blockMatch(null, [TILE]), false);
eq('blank entries are ignored', blockMatch(TILE, ['', '   ']), false);
eq('entries are trimmed', blockMatch(TILE, ['  ' + TILE + '  ']), true);
eq('exact entry is not a prefix match', blockMatch(TILE + '?v=2', [TILE]), false);
eq('a different image is not blocked', blockMatch('https://site.com/img/photo.png', [TILE]), false);

eq('trailing * covers a cache-busted query', blockMatch(TILE + '?v=99', [TILE + '*']), true);
eq('leading * covers a changing host', blockMatch(TILE, ['*/img/tile.png']), true);
eq('* in the middle spans a path segment', blockMatch(TILE, ['https://site.com/*/tile.png']), true);
eq('a glob still has to match the whole url',
    blockMatch('https://other.com/img/tile.png.jpg', [TILE + '*']), false);

// Regex metacharacters in a URL are literal, not syntax. Without escaping, a '?' would make
// the preceding character optional and a '.' would match anything.
eq('a dot is literal, not any-character',
    blockMatch('https://site.com/imgXtile.png', [TILE]), false);
eq('a query string in the entry is literal',
    blockMatch('https://site.com/a?b=1', ['https://site.com/a?b=1']), true);
eq('parentheses and brackets do not throw',
    blockMatch('https://site.com/a(1)[2].png', ['https://site.com/a(1)[2].png']), true);

// ---- the banner gate's shape test, against the measured corpus
//
// Every row below is a real page from `banner-test-sites.md`, probed 2026-09-04 with the
// page scrolled to the top: displayed width, displayed height, and pixels from the top of
// the DOCUMENT. `true` means "band-shaped and high enough to be page furniture" — the one
// remaining condition (a row-mate beside it) needs the DOM, and cases 39–41 on the test
// page exercise that instead.
//
// A wrong answer here is SILENT in the wild: the picture simply stops previewing, with
// nothing on screen to say why. That is the whole reason these are assertions rather than
// a table in a document — which is what they were, while the thresholds drifted onto real
// sites' geometry unnoticed.
function band(label, w, h, top, want) {
    const got = bannerShape(w, h, top);
    if (got.band === want) { pass++; return; }
    fail++;
    console.log('FAIL banner ' + label + NL + '  got ' + got.band + ', want ' + want +
        NL + '  ' + got.why);
}

// Banners the OLD gate let through, every one of them rescued by a coincidence of widths.
band('homedepot.com promo banner',        1376, 107, 197, true);
band('avsforum.com masthead',             1280, 307,   8, true);
band('xkcd.com store-news banner',         540, 100, 113, true);
band('4chan.org rotating board banner',    300, 100,  39, true);
band('4chan.org house ad',                 468,  60, 300, true);
band('furaffinity.net leaderboard ad',     728,  90,  66, true);
band('furaffinity.net skyscraper ad',      320,  50,  61, true);
band('linustechtips.com masthead',         304,  58,  13, true);
band('forums.macrumors.com masthead',      250,  71,  10, true);
band('spacebattles.com masthead',          340,  58, 294, true);

// Content the OLD gate refused. Silent failures, and the larger group.
band('unsplash.com photo page',           1082, 721, 124, false);
band('flickr.com photo page',             1050, 656,  98, false);
band('pexels.com photo page',             1013, 675, 168, false);
band('wallhaven.cc wallpaper page',        950, 633, 158, false);
band('safebooru.org post page',            850, 850, 176, false);
band('furaffinity.net artwork',           1136, 1136, 175, false);
band('tumblr.com first post in feed',      580, 326,  34, false);
band('newgrounds.com featured tile',       624, 374, 192, false);
band('nasa.gov editorial hero',           1556, 640,  86, false);
band('itch.io game key art',               960, 540,   0, false);
band('allbirds.com storefront hero',      1536, 810,  42, false);

// Controls: refusals that were already right and must stay right.
band('youtube.com channel banner',        1284, 207,  56, true);
band('bandcamp.com artist header',         975, 180,   1, true);
band('city-data.com forum masthead',       683,  52,   0, true);
band('store.steampowered.com bg strip',   1557,  46, 104, true);
band('questionablecontent.net header',     815,  60, 107, true);
band('newegg.com hero band',              1280, 315, 140, true);
band('aliexpress.us promo strip',          539,  38, 182, true);
band('soundcloud.com profile banner (bg)', 1208, 254, 110, true);
band('nationalgeographic.com hero (bg)',  1712, 437,  48, true);
band('phpbb.com header (bg)',             1152, 129,  42, true);

// Controls: content that previewed before and must keep previewing. The first two used to
// survive on luck — artstation on a sidebar thumbnail happening to sit beside the artwork,
// 500px on 276/1104 = 0.250000 against a `>= 0.25` test — and now pass on their own shape.
band('artstation.com artwork',             548, 846, 104, false);
// Re-measured 2026-09-04 on a different artwork, and this one has NO peer at all — its nearest
// sidebar thumbnail is at 504px down, outside the band. The old gate would have refused it, so
// the corpus's "correct, but by luck" note was not hypothetical. At 2.2:1 it is also the second
// closest content row to BANNER_BAND, after nasa.gov's 2.4.
band('artstation.com artwork, no peer',   1084, 484, 104, false);
band('500px.com photo',                   1104, 736,  84, false);
band('imgur.com gallery item',             480, 741, 221, false);
band('alrincon.com first post',           1000, 557,  60, false);
band('pixiv.net artwork (below the band)', 911, 643, 302, false);

// The two pieces of band-shaped CONTENT in the corpus, and position is the only thing that
// saves them. This pair is why BANNER_TOP does not go above 300.
band('xkcd.com comic itself',              740, 239, 388, false);
band('questionablecontent.net comic',      800, 250, 333, false);

// Boundary rows, spelled out so a nudge to any threshold fails loudly rather than silently.
band('exactly BANNER_BAND is a band',      300, 100,  10, true);
band('a hair under BANNER_BAND is not',    299, 100,  10, false);
band('exactly BANNER_MIN is wide enough',  240,  40,  10, true);
band('a hair under BANNER_MIN is not',     239,  40,  10, false);
band('exactly BANNER_TOP is high enough', 1000,  60, 300, true);
band('a hair below BANNER_TOP is not',    1000,  60, 301, false);
band('a zero-height rect is never a band', 1000,   0,  10, false);


// ---- the linked page's own markup: does a body image name the same picture as the thumbnail?
// evilmilk.com sets og:image to the share thumbnail, so the full picture is only in the markup.
const EM_THUMB = 'https://www.evilmilk.com/thumbs/I_Am_An_Expert_s.jpg';
eq('evilmilk thumb and its full picture are the same stem',
    sameStem(EM_THUMB, 'https://www.evilmilk.com/pictures/I_Am_An_Expert.jpg'), true);

eq('evilmilk og:image is the thumbnail itself, so a different post never matches',
    sameStem(EM_THUMB, 'https://www.evilmilk.com/pictures/Prepare_Yourself.jpg'), false);

eq('a different directory does not break the stem match',
    sameStem('/thumbs/cat_s.jpg', '/pictures/cat.jpg'), true);

eq('a different extension does not break the stem match',
    sameStem('/thumbs/cat.webp', '/pictures/cat.jpg'), true);

eq('wordpress -150x150 crops match their original',
    sameStem('/wp/2024/cat-150x150.jpg', '/wp/2024/cat.jpg'), true);

eq('_thumbnail is inside the tail budget',
    sameStem('/a/cat_thumbnail.jpg', '/a/cat.jpg'), true);

// The tail must be separator-led and short, or the rule starts matching neighbouring pictures.
eq('a digit with no separator is a different picture, not a size',
    sameStem('/a/photo1.jpg', '/a/photo.jpg'), false);

eq('a long word tail is a different picture',
    sameStem('/a/I_Am_An_Expert_The_Sequel.jpg', '/a/I_Am_An_Expert.jpg'), false);

eq('a site logo never matches the thumbnail it sits beside',
    sameStem(EM_THUMB, 'https://www.evilmilk.com/img/mymilk-logo.png'), false);

eq('unrelated names do not match', sameStem('/a/dog.jpg', '/a/cat.jpg'), false);

eq('a bare directory url has no stem to match', sameStem('/a/', '/a/cat.jpg'), false);

eq('urlStem strips the directory and the extension',
    urlStem('https://www.evilmilk.com/pictures/I_Am_An_Expert.jpg'), 'I_Am_An_Expert');

// ---- the waiting budget's input. The 206 trap is invisible at runtime: the wrong header gives
// 4096 for a 9 MB file and the only symptom is a budget far too short. See TOUR.md §7 and §14.
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
eq('a 206 reports the whole file from Content-Range, never the slice',
    sizeFromHeaders('content-range: bytes 0-4095/8388608' + CRLF + 'content-length: 4096' + CRLF, 206),
    8388608);
eq('a 200 falls back to Content-Length',
    sizeFromHeaders('content-type: image/jpeg' + CRLF + 'content-length: 34494' + CRLF, 200),
    34494);
eq('Content-Length is ignored on a 206 that sent no Content-Range',
    sizeFromHeaders('content-length: 4096' + CRLF, 206), 0);
eq('header names match case-insensitively',
    sizeFromHeaders('Content-Range: bytes 0-4095/12345' + CRLF, 206), 12345);
eq('no size header at all is zero, so the floor applies',
    sizeFromHeaders('content-type: image/png' + CRLF, 200), 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
