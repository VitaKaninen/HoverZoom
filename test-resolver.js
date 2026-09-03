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
const vEnd = src.indexOf('    function inVideoContext');
if (vStart < 0 || vEnd < 0) { console.error('video markers not found'); process.exit(1); }
const VIDEO_LINK_RE = new Function(
    src.slice(vStart, vEnd) + '\nreturn VIDEO_LINK_RE;')();

const location = { href: 'https://example.com/page/index.html' };
const body = src.slice(start, end);
const exported = new Function('location', body +
    '\nreturn {parseSrcset, looksLikeImage, upgradeCandidates, linkParamCandidates, blockMatch};')(location);
const { parseSrcset, looksLikeImage, upgradeCandidates, linkParamCandidates, blockMatch } = exported;

let pass = 0, fail = 0;
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

none('imgur bare 7-char id is left alone', 'https://i.imgur.com/T22ZUhZ.jpg');
none('imgur bare 5-char id is left alone', 'https://i.imgur.com/T22ZU.jpg');
none('imgur bare 7-char png id is left alone', 'https://i.imgur.com/KlprxXs.png');
none('the imgur rule is host-checked', 'https://notimgur.com/T22ZUhZ_d.jpg');
none('imgur nested paths are not ids', 'https://i.imgur.com/a/b/T22ZUhZ_d.jpg');

// ---- the transform-segment rule must not eat ordinary path segments
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
eq('a link with no query yields nothing',
    linkParamCandidates('https://site.com/gallery/item'), []);
eq('a malformed href yields nothing rather than throwing',
    linkParamCandidates('::::not a url::::'), []);

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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
