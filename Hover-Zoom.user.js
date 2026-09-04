// ==UserScript==
// @name        Hover Zoom
// @namespace   https://github.com/VitaKaninen
// @version     0.31.0
// @author      VitaKaninen
// @description Zoom any image on hover. No format allowlist, no size caps, no per-site plugins — resolves the full-size URL on demand. Drag the preview to keep it around, click it to pin it, then wheel or +/− to zoom in past the window edge and drag or arrow keys to pan.
// @match       *://*/*
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_addValueChangeListener
// @grant       GM_registerMenuCommand
// @run-at      document-idle
// @downloadURL https://raw.githubusercontent.com/VitaKaninen/HoverZoom/master/Hover-Zoom.user.js
// @updateURL   https://raw.githubusercontent.com/VitaKaninen/HoverZoom/master/Hover-Zoom.user.js
// ==/UserScript==

// @noframes was previously written as `@noframes false`, which does NOT disable it —
// Tampermonkey treats the tag as a presence flag and ignores the value, so that line was
// switching frames OFF while reading as if it left them on. Removed rather than corrected:
// this script is meant to run in subframes.

/*
 * Design note — why this does no DOM scanning.
 *
 * Hover Zoom+ pre-scans the page for candidate images, binds .one('mouseover') to each,
 * and never revisits them. That single decision causes most of its misses: images added
 * after the scan, lazy-loaded images whose src was a placeholder at scan time, and any
 * image whose probe lost a race against a global single-slot lock are dead for the life
 * of the page.
 *
 * This script binds two delegated listeners at document level and resolves everything at
 * hover time, when the DOM is settled and the real src is present. Nothing is scanned,
 * nothing is cached against an element that might change, and there is no shared lock.
 */

(function () {
    'use strict';

    // ---------------------------------------------------------------- settings

    const DEFAULTS = {
        enabled: true,

        // when to zoom
        activation: 'hover',        // 'hover' | 'modifier' (hold key, then hover)
        modifierKey: 'ctrl',        // 'ctrl' | 'alt' | 'shift'
        hoverDelay: 120,            // ms before resolving
        minDisplayed: 48,           // ignore images displayed smaller than this (icons)
        maxDisplayed: 0,            // ignore images displayed larger than this (0 = no cap)
        minRatio: 1.2,              // full size must be at least this much bigger
        showEvenIfNotLarger: false, // show at natural size even when it isn't an upgrade
        sameShapeOnly: true,        // an upgrade must be roughly the same shape — a wildly
                                    // different aspect is a different picture, not a bigger one
        skipVideos: true,           // never preview a video thumbnail or a player surface
        playVideos: true,           // the preview may BE a video — the only form some gifs have
        followLinks: true,          // read the linked page's own og: media — same origin only
        hoverThroughOverlays: true, // a lid over a picture — hover the picture, not the lid
        skipPageBackgrounds: true,  // never preview page furniture: the page's own background,
                                    // a tiled one, a fixed one, a full-width band, or one the
                                    // page's own text sits on
        skipDecorative: true,       // skip what the page itself marks as not content
                                    // (aria-hidden, role=presentation/none)
        skipBanners: true,          // the picture across the top of a page — masthead, channel
                                    // banner, forum header. The one furniture rule that also
                                    // applies to an <img>, so it is kept narrow
        keepSearching: true,        // show the first hit at once, then keep probing and upgrade in place
        skipWhileMouseDown: true,   // don't fire mid drag/selection
        siteMode: 'blacklist',      // 'blacklist' | 'whitelist'
        siteList: [],               // hostnames, matched by suffix
        blockList: [],              // image URLs never to preview; '*' matches anything

        // placed mode
        pinButton: 'left',          // 'left' | 'right' — whichever pins, the other dismisses
        wheelZoomStep: 15,          // % per wheel notch
        panStep: 80,                // px per arrow-key press (Shift = 3x)
        maxZoom: 32,                // hard ceiling, multiples of natural size

        // how to display
        maxSizeMultiple: 2,         // how far the frame may GROW, as a multiple of the window.
                                    // Above 1 on purpose: a frame bigger than the window can be
                                    // shoved aside or upwards and still reach the screen edges,
                                    // so it never leaves a strip of empty page behind it
        bottomReserve: 30,          // px of the window's bottom edge kept clear — the browser
                                    // paints its link/status text there, over the picture
        zoomFactor: 1.0,            // scale applied to natural size before clamping
        position: 'cursor',         // 'cursor' | 'center'
        cursorGap: 24,              // px between pointer and frame edge
        fadeMs: 90,
        borderWidth: 1,
        borderColor: '#45475a',
        cornerRadius: 6,
        frameMargin: 24,            // px of frame drawn ON TOP of the picture, on all four
                                    // sides, the way the status bar always was. It is a move
                                    // handle: the middle pans, the edge resizes, this ring
                                    // moves the window at any zoom. It fades with the bar, and
                                    // stops being a handle while faded. 0 leaves only the bar
        shadow: true,
        showStatusBar: true,        // filename / type / size / dimensions strip, also the move handle; auto-fades
        spinnerTheme: 'auto',       // 'auto' (follows the browser) | 'dark' | 'light'
        noReferrer: false,          // strip referrer when loading full image

        debug: false,               // log every hover decision to the console
    };

    const KEY = 'hoverZoomSettings';
    let cfg = Object.assign({}, DEFAULTS, readSettings());

    // Settings that no longer exist are DELETED on read, not merely ignored. cfg is
    // DEFAULTS merged with what is stored and the whole object is written back on Save, so
    // a retired key survives every save forever and reappears the moment someone greps for
    // it. maxWidthPct/maxHeightPct do not convert into maxSizeMultiple — the old pair capped
    // the size a preview OPENED at (below the window), the new one caps how far it may GROW
    // (above it), so they do not measure the same thing and there is no honest arithmetic
    // between them. A preview now opens filling the window instead of 92% of it.
    const RETIRED = ['maxWidthPct', 'maxHeightPct', 'dimOpacity'];

    function readSettings() {
        try {
            const raw = GM_getValue(KEY, null);
            const o = raw ? JSON.parse(raw) : {};
            RETIRED.forEach(function (k) { delete o[k]; });
            return o;
        } catch (e) {
            return {};
        }
    }

    function saveSettings() {
        GM_setValue(KEY, JSON.stringify(cfg));
    }

    // Every tab holds its own `cfg`, read once at load. Without these two, a tab that has
    // been open a while is editing a stale snapshot: the panel renders old values, and
    // saving writes that whole snapshot back, silently reverting anything changed in
    // another tab since. reloadSettings() before rendering the panel is the fix that
    // always works; the change listener is the better one where the manager provides it,
    // because it also keeps the *running* script current, not just the panel.
    function reloadSettings() {
        cfg = Object.assign({}, DEFAULTS, readSettings());
        return cfg;
    }

    if (typeof GM_addValueChangeListener === 'function') {
        try {
            GM_addValueChangeListener(KEY, function (name, oldVal, newVal, remote) {
                if (!remote) return;                // our own write; cfg already matches
                reloadSettings();
                probeCache.clear();
                if (panelHost) openPanel();         // re-render an open panel onto fresh values
            });
        } catch (e) { /* not all managers implement it; reloadSettings() still covers the panel */ }
    }

    function siteEnabled() {
        const host = location.hostname.toLowerCase();
        const listed = cfg.siteList.some(function (entry) {
            const e = entry.trim().toLowerCase().replace(/^\*\./, '');
            if (!e) return false;
            return host === e || host.endsWith('.' + e);
        });
        return cfg.siteMode === 'whitelist' ? listed : !listed;
    }

    // ------------------------------------------------------------------- debug
    //
    // Off by default and completely silent when off. It exists for the one class of bug
    // this script cannot reason about from the source: "it behaves differently in my
    // browser than in yours". Every gate here is a DOM read, so only the DOM in front of
    // the user can say which one did or did not fire — and the answer to "is the installed
    // copy even the current one" is the first line it prints.

    function version() {
        try {
            if (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) {
                return 'v' + GM_info.script.version;
            }
        } catch (e) { /* not every manager exposes GM_info */ }
        return 'v?';
    }

    function rectStr(r) {
        return Math.round(r.left) + ',' + Math.round(r.top) + ' ' +
            Math.round(r.width) + '×' + Math.round(r.height);
    }

    function dbg(label, data) {
        if (!cfg.debug) return;
        try { console.log('[HoverZoom ' + version() + '] ' + label, data); } catch (e) { /* no console */ }
    }

    // ------------------------------------------------------------- url helpers

    // Parse a srcset into candidates sorted widest first. Handles both w and x
    // descriptors, and URLs containing commas (data: URIs, CDN transform paths).
    function parseSrcset(srcset) {
        const out = [];
        let i = 0;
        while (i < srcset.length) {
            while (i < srcset.length && /[\s,]/.test(srcset[i])) i++;
            if (i >= srcset.length) break;
            let start = i;
            while (i < srcset.length && !/\s/.test(srcset[i])) i++;
            const url = srcset.slice(start, i).replace(/,+$/, '');
            while (i < srcset.length && /\s/.test(srcset[i]) && srcset[i] !== ',') i++;
            let desc = '';
            while (i < srcset.length && srcset[i] !== ',') desc += srcset[i++];
            i++; // skip comma
            desc = desc.trim();
            let weight = 1;
            const w = desc.match(/^(\d+(?:\.\d+)?)w$/);
            const x = desc.match(/^(\d+(?:\.\d+)?)x$/);
            if (w) weight = parseFloat(w[1]);
            else if (x) weight = parseFloat(x[1]) * 1000; // x-descriptors sort above bare urls
            if (url) out.push({ url: url, weight: weight });
        }
        return out.sort(function (a, b) { return b.weight - a.weight; }).map(function (c) { return c.url; });
    }

    const MEDIA_RE = /\.(avif|bmp|gif|heic|heif|ico|jfif|jpe|jpeg|jpg|jxl|png|svg|tif|tiff|webp)(?=$|[?#])/i;

    // The moving originals. Deliberately a SEPARATE list from MEDIA_RE rather than an
    // addition to it, because the two answer different questions: MEDIA_RE asks "is this a
    // picture", this asks "does the frame need a <video> rather than an <img> to show it".
    // Every candidate goes through one or the other, and which one decides how it is
    // measured and which face of the viewer displays it.
    const VIDEO_EXT_RE = /\.(mp4|m4v|webm|mov|ogv)(?=$|[?#])/i;

    function isVideoUrl(url) {
        try { return VIDEO_EXT_RE.test(new URL(url, location.href).pathname); }
        catch (e) { return false; }
    }

    function looksLikeImage(url) {
        try {
            const u = new URL(url, location.href);
            if (MEDIA_RE.test(u.pathname)) return true;
            // extension-less CDN paths that still declare a format in the query
            if (/[?&](format|fm|output)=(avif|jpe?g|png|webp)/i.test(u.search)) return true;
            return false;
        } catch (e) {
            return false;
        }
    }

    // Viewer, redirect and proxy links carry the real image URL as a query parameter:
    // Google Images' /imgres?imgurl=…, share endpoints, CMS lightboxes, image proxies.
    // The href itself is an HTML page, so looksLikeImage() rejects it and the original is
    // never seen. Nothing here names a host — it is the generic form of the trick HZ+'s
    // Google plugin does with its `a[href*="imgurl="]` selector.
    const THUMB_PARAM = /(?:^|[_-])(?:thumb|thumbnail|tn|small|preview|icon|avatar)(?:$|[_-])/i;

    function linkParamCandidates(href) {
        const out = [];
        let u;
        try { u = new URL(href, location.href); } catch (e) { return out; }
        u.searchParams.forEach(function (value, name) {
            if (THUMB_PARAM.test(name)) return;          // never trade an original for a thumbnail
            if (!/^https?:\/\//i.test(value)) return;    // absolute only; a bare path is ambiguous
            if (looksLikeImage(value)) out.push(value);
        });
        return out;
    }

    // Images the user has said never to preview: a page's tiled wallpaper, a watermark, a
    // sprite sheet, anything that keeps popping a preview nobody asked for. An entry is an
    // exact URL, or a glob when it contains '*' — which is what a background carrying a
    // cache-busting query needs, since its URL is never twice the same.
    //
    // Pure, and deliberately inside the slice test-resolver.js evaluates, so the matching
    // can be exercised offline like the URL rules. A wrong match here is silent: the image
    // simply stops previewing, with nothing on screen to say why.
    function blockMatch(url, list) {
        if (!url || !list || !list.length) return false;
        for (let i = 0; i < list.length; i++) {
            const entry = String(list[i]).trim();
            if (!entry) continue;
            if (entry.indexOf('*') === -1) {
                if (entry === url) return true;
                continue;
            }
            const rx = new RegExp('^' + entry.split('*').map(function (part) {
                return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }).join('.*') + '$');
            if (rx.test(url)) return true;
        }
        return false;
    }

    // Site-agnostic rewrites that turn a thumbnail URL into its original.
    // Each returns a new URL string, or null when it doesn't apply.
    // The post id inside an i.imgur.com path, or null. Both imgur rules below need it and
    // the restraint documented on the first one is the entire safety of the pair, so it is
    // written once: a second copy is a second place for the "leave a bare id alone" bound to
    // be got wrong, and getting it wrong shows the WRONG PICTURE rather than none.
    function imgurId(u) {
        if (!/(^|\.)imgur\.com$/.test(u.hostname)) return null;
        const m = u.pathname.match(/^\/([A-Za-z0-9]+(?:_d)?)(\.[a-z0-9]+)$/);
        if (!m) return null;
        let id = m[1];
        if (/_d$/.test(id)) id = id.slice(0, -2);
        else if ((id.length === 6 || id.length === 8) && /[sbtmlhg]$/.test(id)) id = id.slice(0, -1);
        return { id: id, ext: m[2] };
    }

    const UPGRADES = [
        // Imgur, the MOVING original — before the still rule below, and the order is the
        // whole point. For a video post the two candidates have IDENTICAL pixel dimensions,
        // and resolve() only replaces a hit with something strictly bigger, so whichever is
        // probed first is what you get. Measured 2026-09-03, both ids live:
        //
        //   EDiKb3d.jpg  image/jpeg   36 KB  480×854   a STILL FRAME
        //   EDiKb3d.mp4  video/mp4   2.6 MB  480×854   10.85 s — the actual post
        //   T22ZUhZ.jpg  image/gif   3.1 MB  800×450   animated
        //   T22ZUhZ.mp4  video/mp4   1.8 MB  800×450   5.04 s
        //
        // There are two kinds of animated imgur post and only one has an image form at all:
        // a legacy GIF post answers `.jpg` with image/gif, a video post answers it with one
        // frame. For the second kind NO url rule can ever make the preview move, which is
        // why the viewer had to learn video rather than this rule being enough.
        //
        // COST, stated because it is real: imgur ignores the extension you ask for, so on a
        // STATIC post `<id>.mp4` answers 200 with image/jpeg and this spends one probe that
        // cannot succeed. probeVideo()'s timeout is what bounds that; `playVideos` turns the
        // whole thing off. There is nothing in a thumbnail URL that says whether the post
        // behind it moves, so the choice is this or no gifs.
        function (u) {
            const hit = imgurId(u);
            if (!hit) return null;
            const url = 'https://i.imgur.com/' + hit.id + '.mp4';
            return url === u.href ? null : url;
        },
        // gifwow.com: the grid shows /gifs/<id>.jpg — a poster frame — or the .webp
        // animation, and the post page's player is /gifs/<id>.mp4. Same directory, same
        // basename, extension swapped. Measured 2026-09-03: grid item /gifs/gp-1tnq3g.jpg
        // under a /go/gp-1tnq3g link, and that page's <video src="/gifs/gp-1tnq3g.mp4">.
        // Host-checked and anchored to /gifs/, so it cannot reach any other path shape.
        function (u) {
            if (!/(^|\.)gifwow\.com$/.test(u.hostname)) return null;
            const m = u.pathname.match(/^\/gifs\/([A-Za-z0-9_-]+)\.(?:jpe?g|png|webp|gif)$/i);
            return m ? u.origin + '/gifs/' + m[1] + '.mp4' : null;
        },
        // Imgur: reduce a thumbnail URL to the stored original. Early in the list because it
        // is host-checked and high-confidence, and because the generic query-strip rule below
        // actively goes the WRONG WAY here. All measured 2026-09-03 against i.imgur.com:
        //
        //   T22ZUhZ_d.jpg?maxwidth=520&shape=thumb   15.9 KB   435×244   (what the grid shows)
        //   T22ZUhZ_d.jpg   (query stripped)          1.9 KB   145× 81   SMALLER than displayed
        //   T22ZUhZ.jpg     (suffix stripped)         3.1 MB   800×450   image/gif — the original
        //
        // That third row is the whole reason for this rule. A GIF post's grid thumbnail is a
        // STATIC frame, and with no suffix rule the only candidate that ever cleared the ratio
        // gate was that still — reported as "it is not working for gifs".
        //
        // TWO facts about imgur, both worth stating because neither is guessable:
        //
        // 1. The extension you ask for is IGNORED, except `.webp`. `.jpg`, `.png` and `.gif`
        //    all return the stored original bytes with its real content-type — T22ZUhZ.jpg
        //    comes back as image/gif and animates in an <img>, KlprxXs.jpg comes back as
        //    image/png. So there is no need to guess the true extension; ask for anything.
        // 2. `.webp` is a TRANSCODE at the same pixel size, and for an animated post it is a
        //    STILL. zFAj8eD.webp?tb is 240×210 animated, zFAj8eD.webp is 412×360 and static,
        //    zFAj8eD.jpg is 412×360 and animated. So a `.webp` source is rewritten to `.jpg`,
        //    which is the difference between a moving preview and a frozen one.
        //
        // The suffix has two forms, both unambiguous, and the ambiguous one is excluded:
        //   `_d`  — imgur ids never contain an underscore, so this is always a suffix.
        //   a single trailing [sbtmlhg] on a 6- or 8-character basename — imgur issues 5- and
        //   7-character ids, so those lengths can only be id+suffix. Verified: KlprxXsb.jpg
        //   (7 KB), KlprxXsm.webp (20 KB) and KlprxXsh.jpg (150 KB) are all thumbnails of
        //   KlprxXs (1080×1080).
        //
        // A BARE 5- or 7-character id keeps its id, and that restraint is the load-bearing
        // part: T22ZUh.jpg — T22ZUhZ.jpg with its last character taken off — is a real 90 KB
        // image of something else entirely. Over-matching here would silently show the WRONG
        // PICTURE, which is far worse than showing none. See the negative tests.
        function (u) {
            const hit = imgurId(u);
            if (!hit) return null;
            const was = u.href;
            // .webp is the de-animating transcode; anything else gives the stored original.
            const ext = /^\.webp$/i.test(hit.ext) ? '.jpg' : hit.ext;
            u.pathname = '/' + hit.id + ext;
            u.search = '';      // ?maxwidth= and ?tb both just ask for a smaller picture
            return u.href === was ? null : u.href;
        },
        // strip common resize/quality query parameters
        //
        // ONLY when the path names a media file. On `photo.jpg?w=400` the query is decoration
        // over a file that exists either way, and dropping it asks for the same picture
        // bigger. On `/banner.php?loc=header` or `/image?id=7` the query is the REQUEST —
        // dropping it asks a different question, and a rotator answers with an unrelated
        // picture that probe and frame then agree on perfectly. Measured against the reported
        // forum banner shape 2026-09-03; the shape gate is the backstop, this is the fix.
        function (u) {
            if (!MEDIA_RE.test(u.pathname) && !VIDEO_EXT_RE.test(u.pathname)) return null;
            const drop = ['w', 'h', 'width', 'height', 'size', 's', 'fit', 'resize', 'crop',
                'quality', 'q', 'strip', 'thumb', 'thumbnail', 'scale', 'max', 'maxwidth',
                'maxheight', 'downsize', 'compress', 'dpr'];
            let touched = false;
            drop.forEach(function (p) {
                if (u.searchParams.has(p)) { u.searchParams.delete(p); touched = true; }
            });
            return touched ? u.href : null;
        },
        // Twitter / X: ?name=small -> ?name=orig
        function (u) {
            if (!/(^|\.)(twimg\.com)$/.test(u.hostname)) return null;
            if (u.searchParams.get('name') === 'orig') return null;
            u.searchParams.set('name', 'orig');
            return u.href;
        },
        // WordPress and friends: image-150x150.jpg -> image.jpg
        function (u) {
            const p = u.pathname.replace(/-\d{2,5}x\d{2,5}(\.[a-z0-9]+)$/i, '$1');
            if (p === u.pathname) return null;
            u.pathname = p;
            return u.href;
        },
        // Shopify: image_400x400.jpg / image_400x.jpg -> image.jpg
        function (u) {
            const p = u.pathname.replace(/_(\d{2,5}x\d{0,5}|x\d{2,5})(?:@\dx)?(\.[a-z0-9]+)$/i, '$2');
            if (p === u.pathname) return null;
            u.pathname = p;
            return u.href;
        },
        // Cloudinary / Imgix style transform segments: /w_400,h_300,c_fill/ -> /
        // Deliberately strict: a segment must be entirely key_value pairs drawn from the
        // known transform keys AND carry a numeric w_ or h_. A loose version of this rule
        // ate ordinary path segments like /en_US/ and /v_2/, which silently resolves to a
        // different image rather than to no image.
        function (u) {
            const KEYS = /^(?:w|h|c|q|f|g|e|b|o|r|x|y|z|a|d|t|ar|dpr|fl|bo|cs|vc)$/;
            const segs = u.pathname.split('/');
            let touched = false;
            const kept = segs.filter(function (seg) {
                if (!seg || seg.indexOf('_') === -1) return true;
                const parts = seg.split(',');
                const wellFormed = parts.every(function (p) {
                    const m = p.match(/^([a-z]{1,3})_([A-Za-z0-9.:%-]+)$/);
                    return m && KEYS.test(m[1]);
                });
                if (!wellFormed) return true;
                if (!/(?:^|,)[wh]_\d+(?:,|$)/.test(seg)) return true;
                touched = true;
                return false;
            });
            if (!touched) return null;
            u.pathname = kept.join('/');
            return u.href;
        },
        // Google user content / Blogger. The size token appears in two forms — appended
        // with '=' (…/abc=s400-c) or as its own path segment (…/s400/photo.jpg) — and
        // 's0' means "no downscale". The segment form is why a Blogger or Photos image
        // used to come back at its thumbnail size. Host-checked, because `/s400/` is an
        // ordinary path segment anywhere else.
        function (u) {
            if (!/(^|\.)(googleusercontent\.com|ggpht\.com|blogspot\.com)$/.test(u.hostname)) return null;
            const p = u.pathname.replace(
                /(\/|=)(?:w\d{2,}-h\d{2,}|[swh]\d{2,})(?:-[a-z0-9]+)*(\/|$)/i, '$1s0$2');
            if (p !== u.pathname) { u.pathname = p; return u.href; }
            if (!/[=/]s0(\/|$)/.test(u.pathname)) return u.href + '=s0';
            return null;
        },
        // MediaWiki: /thumb/a/ab/File.jpg/220px-File.jpg -> /a/ab/File.jpg
        function (u) {
            const m = u.pathname.match(/^(.*)\/thumb(\/[a-f0-9]\/[a-f0-9]{2}\/[^/]+)\/[^/]+$/i);
            if (!m) return null;
            u.pathname = m[1] + m[2];
            return u.href;
        },
        // Reddit preview host -> direct host
        function (u) {
            if (!/(^|\.)redd\.it$/.test(u.hostname)) return null;
            if (u.hostname === 'i.redd.it') return null;
            const m = u.pathname.match(/^\/([a-z0-9]+\.(?:jpe?g|png|gif|webp))$/i);
            if (!m) return null;
            return 'https://i.redd.it/' + m[1];
        },
        // Squarespace: ?format=500w -> ?format=2500w
        function (u) {
            const f = u.searchParams.get('format');
            if (!f || !/^\d+w$/.test(f)) return null;
            u.searchParams.set('format', '2500w');
            return u.href;
        },
        // generic path markers
        function (u) {
            const p = u.pathname
                .replace(/\/(thumb|thumbs|thumbnail|thumbnails|small|medium|preview|resized)\//i, '/')
                .replace(/(_|-)(thumb|thumbnail|small|medium|preview|min|tn)(\.[a-z0-9]+)$/i, '$3');
            if (p === u.pathname) return null;
            u.pathname = p;
            return u.href;
        },
    ];

    function upgradeCandidates(src) {
        const out = [];
        let base;
        try { base = new URL(src, location.href); } catch (e) { return out; }
        UPGRADES.forEach(function (fn) {
            try {
                const r = fn(new URL(base.href));
                if (r && r !== base.href) out.push(r);
            } catch (e) { /* a rule that throws is just a rule that doesn't apply */ }
        });
        return out;
    }

    const DATA_ATTRS = ['data-src', 'data-original', 'data-original-src', 'data-full',
        'data-full-src', 'data-fullsize', 'data-large', 'data-large-src', 'data-hi-res',
        'data-highres', 'data-zoom-image', 'data-zoom', 'data-image', 'data-img',
        'data-lazy', 'data-lazy-src', 'data-defer-src', 'data-echo', 'data-url',
        'data-hoverzoom', 'data-actualsrc'];

    // Ordered best-first list of candidates worth trying for this element, each as
    // `{ url, from }`. `from` is carried purely so the debug log can name the mechanism
    // that produced the preview: "the preview is the wrong picture" is unanswerable without
    // it — there are six mechanisms here and the log used to print only the winning URL,
    // which says nothing about which one to go and look at.
    function collectCandidates(el) {
        const seen = new Set();
        const out = [];
        const add = function (u, from) {
            if (!u) return;
            let abs;
            try { abs = new URL(u, location.href).href; } catch (e) { return; }
            if (abs.startsWith('data:') || abs.startsWith('blob:')) return;
            if (blocked(abs)) return;       // never probe something the user has ruled out
            if (unstable.has(abs)) return;  // it has already been caught changing under us
            // `playVideos` off means the frame cannot display one, so a video candidate is
            // not merely useless — probing it would spend one of MAX_PROBES on a result
            // that has to be thrown away, ahead of the image candidate behind it.
            if (!cfg.playVideos && isVideoUrl(abs)) return;
            if (seen.has(abs)) return;
            seen.add(abs);
            out.push({ url: abs, from: from });
        };
        const adder = function (from) { return function (u) { add(u, from); }; };

        // 1. explicit high-res attributes
        DATA_ATTRS.forEach(function (a) {
            const v = el.getAttribute && el.getAttribute(a);
            if (v && !/\s/.test(v.trim())) add(v.trim(), a);
        });
        const dataSrcset = el.getAttribute && el.getAttribute('data-srcset');
        if (dataSrcset) parseSrcset(dataSrcset).forEach(adder('data-srcset'));

        // 2. srcset on the image and on any <picture><source>
        let bestSrcset = null;
        if (el.tagName === 'IMG') {
            if (el.srcset) {
                const list = parseSrcset(el.srcset);
                if (list.length) bestSrcset = list[0];
                list.forEach(adder('srcset'));
            }
            const pic = el.closest && el.closest('picture');
            if (pic) {
                pic.querySelectorAll('source[srcset]').forEach(function (s) {
                    const list = parseSrcset(s.srcset);
                    if (!bestSrcset && list.length) bestSrcset = list[0];
                    list.forEach(adder('<picture> <source srcset>'));
                });
            }
        }

        // 2b. the widest srcset entry is itself often a resized derivative
        if (bestSrcset) upgradeCandidates(bestSrcset).forEach(adder('url rule on the widest srcset entry'));

        // 3. an ancestor link pointing at media — directly, via a query parameter, or
        //    after a rewrite
        const a = el.closest && el.closest('a[href]');
        if (a && a.href) {
            if (looksLikeImage(a.href) || (cfg.playVideos && isVideoUrl(a.href))) add(a.href, 'the ancestor link itself');
            else {
                linkParamCandidates(a.href).forEach(adder('a url inside the ancestor link\'s query'));
                upgradeCandidates(a.href).forEach(function (u) {
                    if (looksLikeImage(u)) add(u, 'url rule on the ancestor link');
                });
            }
        }

        // 4. rewrites of the displayed src
        const shown = shownUrl(el);
        if (shown) upgradeCandidates(shown).forEach(adder('url rule on the displayed src'));

        // 5. the displayed src itself, last — it is the fallback, never the upgrade
        if (shown) add(shown, 'the displayed src itself');

        return out;
    }

    function backgroundUrl(el) {
        const bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none') return null;
        const m = bg.match(/url\((['"]?)(.*?)\1\)/);
        return m ? m[2] : null;
    }

    // What this element is actually showing right now — the only URL that exists for it
    // without a probe. Three places wanted this expression; it is one function so a change
    // to how "displayed" is read cannot land in two of them and miss the third.
    function shownUrl(el) {
        if (el.tagName === 'IMG') return el.currentSrc || el.src;
        // currentSrc rather than src: a clip is often given <source> children with no src
        // attribute of its own, and then src is the empty string.
        if (el.tagName === 'VIDEO') return el.currentSrc || el.src || null;
        return backgroundUrl(el);
    }

    function blocked(url) {
        return blockMatch(url, cfg.blockList);
    }

    // ---------------------------------------------------------- unstable URLs
    //
    // A URL THAT ANSWERS WITH A DIFFERENT PICTURE EACH REQUEST breaks the one assumption
    // every part of this script rests on: that the thing measured and the thing displayed
    // are the same picture. Rotating forum banners, "random image" endpoints, ad slots and
    // daily-header scripts are all this shape, and the failure is silent and bizarre —
    // measure 1200×125, display 600×600, and the preview is a picture the user never
    // pointed at. Reported 2026-09-03 as "hovering the banner gives me the sidebar image,
    // and it varies".
    //
    // Nothing about the URL says it will do this, so it is caught by CONTRADICTION, at two
    // points where the answer is already known and costs nothing:
    //
    //  1. Against the browser's own copy. For an <img> on screen, naturalWidth/Height are
    //     the exact bytes being displayed. Re-probing that same URL must return the same
    //     numbers. This is an identity test — no tolerance, no false positives — and it
    //     needs no extra request, because the probe was going to happen anyway.
    //  2. Against the probe, when the frame loads it. Catches the same thing for a
    //     candidate that is NOT the displayed URL — a rewrite of a rotator, or a linked
    //     page's og:image — which (1) cannot see. Also free: the frame loads it regardless.
    //
    // Once a URL has contradicted itself it is refused for the life of the tab, so the
    // preview does not come back on the next hover with yet another wrong picture.
    const unstable = new Set();

    function markUnstable(url, was, got) {
        if (!url || unstable.has(url)) return;
        unstable.add(url);
        probeCache.delete(url);     // its cached size describes a picture that is now gone
        dbg('unstable url — refused for this tab', {
            url: url,
            measured: was ? was.w + '×' + was.h : '(unknown)',
            loaded: got ? got.w + '×' + got.h : '(unknown)',
            why: 'the same URL answered with two different pictures, so nothing it returns ' +
                'can be trusted to be the thing under the pointer',
        });
    }

    // ------------------------------------------------------- is it the same picture?
    //
    // A bigger version of a picture has the SAME SHAPE as the picture. That is the one
    // property a genuine upgrade cannot lose, and it is the only cheap handle on the
    // question the user is really asking — "is this the thing I pointed at?".
    //
    // It is what catches a rotator that the two tests above cannot see. Measured in Chrome
    // 2026-09-03 and it is the crux: a second load of an ALREADY-DISPLAYED url does not hit
    // the network at all — four `new Image()` loads of one no-store URL produced ONE request
    // and one identical picture. So an unstable *displayed* src cannot mislead in that
    // browser, and the case that actually bites is a DIFFERENT url — `/banner.php` derived
    // from `/banner.php?loc=header` by the query-strip rule, or a linked page's `og:image`.
    // Those roll once, and probe and frame then agree with each other perfectly while
    // showing something unrelated. Nothing about the URL says so; the shape does.
    //
    // The tolerance is deliberately loose. A thumbnail is often a CROP of its original — a
    // square thumb of a 3:2 photo is 1.5× off, a 16:9 crop of 4:3 is 1.34× — and those must
    // all pass. The reported case is a 1200×125 masthead (9.6:1) answering with a 600×600
    // sidebar picture (1:1): 9.6× apart. There is a wide gap between "cropped differently"
    // and "not the same picture", and 4 sits in it. A wrong refusal here is silent, so the
    // number errs toward letting things through.
    const ASPECT_TOL = 4;

    function sameShape(a, b) {
        if (!a || !b || !a.w || !a.h || !b.w || !b.h) return true;   // unknown: do not judge
        const r1 = a.w / a.h, r2 = b.w / b.h;
        return Math.max(r1, r2) / Math.min(r1, r2) <= ASPECT_TOL;
    }

    // The size of the bytes the page ALREADY has for this element — free, and exact.
    function nativeSize(el) {
        if (el.tagName === 'IMG' && el.naturalWidth > 0)
            return { w: el.naturalWidth, h: el.naturalHeight };
        if (el.tagName === 'VIDEO' && el.videoWidth > 0)
            return { w: el.videoWidth, h: el.videoHeight };
        return null;    // a background image, or nothing decoded yet — nothing to check
    }

    // ------------------------------------------------------------------ probing

    const probeCache = new Map(); // url -> Promise<{w,h}|null>

    // A video is measured exactly the way an image is — load it and ask how big it came out
    // — only the event is `loadedmetadata` and the size is videoWidth/videoHeight. preload
    // is 'metadata', so a probe costs the container header rather than the file; the frames
    // are only fetched if this candidate wins and the viewer actually plays it.
    //
    // The TIMEOUT is not belt-and-braces. imgur ignores the extension you ask for, so
    // <id>.mp4 on a static post answers 200 with image/jpeg — a response that is neither a
    // playable video nor an error the element is obliged to report promptly. A probe that
    // never settles stalls the whole sequential resolve behind it, and the symptom is the
    // one this script's spinner exists to apologise for: hovering appears to do nothing.
    const VIDEO_PROBE_MS = 6000;

    function probeVideo(url) {
        return new Promise(function (resolve) {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.muted = true;
            let timer = 0;
            const done = function (ok) {
                clearTimeout(timer);
                v.onloadedmetadata = v.onerror = null;
                // Read every measurement BEFORE tearing the element down: clearing src and
                // calling load() resets videoWidth to 0 and duration to NaN.
                const out = ok && v.videoWidth > 0
                    ? { w: v.videoWidth, h: v.videoHeight, video: true, duration: v.duration }
                    : null;
                v.removeAttribute('src');
                v.load();                       // stop a fetch whose answer we already have
                resolve(out);
            };
            v.onloadedmetadata = function () { done(true); };
            v.onerror = function () { done(false); };
            timer = setTimeout(function () { done(false); }, VIDEO_PROBE_MS);
            v.src = url;
        });
    }

    function probe(url) {
        if (probeCache.has(url)) return probeCache.get(url);
        if (isVideoUrl(url)) {
            const pv = probeVideo(url);
            probeCache.set(url, pv);
            return pv;
        }
        const p = new Promise(function (resolve) {
            const img = new Image();
            if (cfg.noReferrer) img.referrerPolicy = 'no-referrer';
            const done = function (ok) {
                img.onload = img.onerror = null;
                resolve(ok ? { w: img.naturalWidth, h: img.naturalHeight } : null);
            };
            img.onload = function () { done(img.naturalWidth > 0); };
            img.onerror = function () { done(false); };   // HZ+ omits this; a failed probe there wedges the page
            img.src = url;
            if (img.complete && img.naturalWidth > 0) done(true);
        });
        probeCache.set(url, p);
        return p;
    }

    // Walk candidates until one is a real upgrade. Per-element, no shared state.
    //
    // Two modes. First-match stops at the first candidate that clears the ratio gate:
    // one extra request per hover, and it honours whatever the site declared as its
    // largest. Keep-searching carries on past that hit and reports every strictly larger
    // one after it, so the caller can show something immediately and improve it in place.
    //
    // This is why the probes stay SEQUENTIAL and in list order. The list is ordered by
    // heuristic confidence, not by measured size; racing it and taking the first response
    // would hand the decision to whichever server answers fastest, which systematically
    // favours the smallest file. Order is the selection rule, so order has to be kept.
    const MAX_PROBES = 8;

    // ------------------------------------------------- the page behind the thumbnail
    //
    // Every other mechanism in this script GUESSES a full-size URL from strings already on
    // the page and then verifies it by loading it. This one asks the site directly: fetch
    // the page the thumbnail links to and read what it declares as its own media. That is
    // authoritative in a way no guess can be — it is the page you would have landed on —
    // so the result does NOT face the ratio gate and it ends the search. Some originals are
    // not derivable from a thumbnail URL by any rule, and this is the only thing that
    // reaches them.
    //
    // Bounded deliberately, because it is the one part of this script that makes a request
    // for a document rather than for an image:
    //
    //  - SAME ORIGIN ONLY. A listing and its item pages are on the same site essentially by
    //    definition; a cross-origin href is an outbound link, not "the page for this
    //    thumbnail". It also means plain fetch() with the user's own cookies, so the HTML is
    //    what they would see — no GM_xmlhttpRequest, no new @grant, no @connect prompt.
    //  - Once per URL, cached for the tab, and only after `hoverDelay` has already elapsed.
    //  - Never for a link that is already a media URL: that is an ordinary candidate and is
    //    handled by collectCandidates().
    //  - `followLinks` turns it off entirely.
    const pageCache = new Map();    // page url -> Promise<{url, video}|null>

    function metaContent(doc, names) {
        for (let i = 0; i < names.length; i++) {
            const m = doc.querySelector('meta[property="' + names[i] + '"], meta[name="' + names[i] + '"]');
            const v = m && m.getAttribute('content');
            if (v && v.trim()) return v.trim();
        }
        return null;
    }

    // What a fetched page says its media is. Separate from the fetch so it can be tested
    // against a parsed document with no network involved.
    function pageMediaFrom(doc, pageUrl) {
        // THE PAGE YOU GET IS NOT ALWAYS THE PAGE YOU ASKED FOR, and the failure is silent.
        // Measured 2026-09-03: fetching one imgur gallery URL returned another post's
        // document entirely — same byte count, wrong id — and a second attempt returned a
        // generic shell whose og:image is the imgur logo. Either would have put a confident,
        // completely wrong picture on screen, and this candidate skips the ratio gate that
        // would otherwise have caught the logo. So the page has to agree about which page it
        // is: og:url must name the path we requested, or nothing here is trusted.
        const declared = metaContent(doc, ['og:url']);
        if (declared) {
            let d = null;
            try { d = new URL(declared, pageUrl.href); } catch (e) { d = null; }
            if (!d || d.pathname.replace(/\/+$/, '') !== pageUrl.pathname.replace(/\/+$/, '')) return null;
        }
        // Video first: on a post that has both, the video IS the post and the og:image is
        // its poster frame. isVideoUrl() is required because og:video is often a player
        // PAGE (an embed url) rather than a media file, and that would never load.
        const vid = metaContent(doc, ['og:video:secure_url', 'og:video:url', 'og:video',
            'twitter:player:stream']);
        if (vid && cfg.playVideos && isVideoUrl(vid)) {
            try { return { url: new URL(vid, pageUrl.href).href, video: true }; } catch (e) { /* fall through */ }
        }
        const img = metaContent(doc, ['og:image:secure_url', 'og:image', 'twitter:image:src',
            'twitter:image']);
        if (img && looksLikeImage(img)) {
            try { return { url: new URL(img, pageUrl.href).href, video: false }; } catch (e) { /* none */ }
        }
        return null;
    }

    async function fetchPageMedia(pageUrl) {
        let doc;
        try {
            const res = await fetch(pageUrl.href, { credentials: 'same-origin', redirect: 'follow' });
            if (!res.ok) return null;
            // Only ever parse HTML. A link to a PDF or a zip would otherwise be pulled in
            // full just to be thrown away.
            if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) return null;
            doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        } catch (e) {
            return null;                                  // offline, blocked, CSP, aborted
        }
        return pageMediaFrom(doc, pageUrl);
    }

    function linkedMedia(el) {
        if (!cfg.followLinks) return Promise.resolve(null);
        const a = closestAcross(el, 'a[href]');
        const href = a && a.getAttribute('href');
        if (!href) return Promise.resolve(null);
        let u;
        try { u = new URL(href, location.href); } catch (e) { return Promise.resolve(null); }
        if (!/^https?:$/.test(u.protocol)) return Promise.resolve(null);
        if (u.origin !== location.origin) return Promise.resolve(null);
        u.hash = '';
        if (u.href === location.href.split('#')[0]) return Promise.resolve(null);   // this page
        if (looksLikeImage(u.href) || isVideoUrl(u.href)) return Promise.resolve(null);
        if (pageCache.has(u.href)) return pageCache.get(u.href);
        const p = fetchPageMedia(u);
        pageCache.set(u.href, p);
        return p;
    }

    async function resolve(el, displayed, token, onHit) {
        const candidates = collectCandidates(el).slice(0, MAX_PROBES);
        const shown = shownUrl(el);
        const native = nativeSize(el);      // the bytes on screen, for the stability test
        dbg('candidates', candidates);
        let best = null;
        let trusted = null;

        // Started here, NOT awaited here. A document fetch is slow next to an image probe,
        // and there is usually a decent local candidate that can be on screen meanwhile —
        // so the ordinary sequence paints something immediately and this replaces it in
        // place through the same progressive-upgrade path when it arrives. Awaiting it up
        // front would turn every hover into a page load before anything appeared.
        const linked = linkedMedia(el).then(async function (hit) {
            if (!hit || token.cancelled || blocked(hit.url)) return null;
            const dim = await probe(hit.url);
            if (!dim || token.cancelled) return null;
            // The one gate that still applies to the authoritative answer. It skips the
            // RATIO check because the page is the site telling us what this thumbnail
            // stands for — but a forum banner links to the section it heads, and that
            // page's og:image is the section's own artwork, which is a different picture
            // rather than a smaller one. Shape is what separates those two cases.
            if (cfg.sameShapeOnly && !sameShape(native, dim)) {
                dbg('linked page rejected — a different shape, so a different picture', {
                    url: hit.url,
                    onScreen: native ? native.w + '×' + native.h : '(unknown)',
                    declared: dim.w + '×' + dim.h,
                });
                return null;
            }
            trusted = { url: hit.url, w: dim.w, h: dim.h, video: !!dim.video, duration: dim.duration,
                from: 'the page the thumbnail links to (og: media)' };
            // No ratio gate, no comparison with `best`: the linked page is the site telling
            // us what this thumbnail stands for, and a smaller answer from it still beats a
            // bigger guess.
            dbg('hit (declared by the linked page)', trusted);
            if (onHit && !token.cancelled) onHit(trusted);
            return trusted;
        }, function () { return null; });

        for (const c of candidates) {
            const url = c.url;
            if (token.cancelled) return trusted || best;
            if (trusted) break;             // the authoritative answer landed; stop guessing
            const dim = await probe(url);
            if (!dim) continue;
            const isSameAsShown = (url === shown);
            // THE URL IS NOT STABLE. Re-fetching what is already on screen came back a
            // different size, so this URL hands out a different picture each request and
            // nothing it returns is the thing under the pointer. See markUnstable().
            if (isSameAsShown && native && (dim.w !== native.w || dim.h !== native.h)) {
                markUnstable(url, native, dim);
                continue;
            }
            // NOT THE SAME PICTURE. See sameShape() — a candidate shaped nothing like the
            // thumbnail is a different image, not a bigger one, whatever its pixel count.
            if (cfg.sameShapeOnly && !sameShape(native, dim)) {
                dbg('rejected — a different shape, so a different picture', {
                    url: url, from: c.from,
                    onScreen: native.w + '×' + native.h, candidate: dim.w + '×' + dim.h,
                });
                continue;
            }
            const bigEnough = dim.w >= displayed.w * cfg.minRatio || dim.h >= displayed.h * cfg.minRatio;
            const usable = bigEnough || (cfg.showEvenIfNotLarger && !isSameAsShown);
            if (!usable) continue;
            if (best && dim.w * dim.h <= best.w * best.h) continue;   // not an improvement
            // An upgrade may not trade MOTION for a bigger still. "Bigger wins" is the right
            // rule between two pictures, but a moving original is the thing being asked for
            // here — a 1600×1200 frozen frame is not an improvement on a 640×480 clip of the
            // same post, it is a different and worse answer to the question. On imgur the
            // two happen to be the same pixel size so probe order settles it; this is what
            // settles it everywhere else. A bigger VIDEO still replaces a smaller one.
            if (best && best.video && !dim.video) continue;
            best = { url: url, w: dim.w, h: dim.h, video: !!dim.video, duration: dim.duration,
                from: c.from };
            dbg('hit', best);
            if (onHit && !token.cancelled) onHit(best);
            if (!cfg.keepSearching) break;
        }
        // The search is not over until the page lookup settles — the spinner keeps turning
        // because something really is still running, and a late authoritative answer still
        // replaces whatever the guesses produced.
        await linked;
        if (trusted) return trusted;
        if (best) return best;
        if (cfg.showEvenIfNotLarger && shown && !blocked(shown) && !token.cancelled) {
            const dim = await probe(shown);
            if (dim && native && (dim.w !== native.w || dim.h !== native.h)) {
                markUnstable(shown, native, dim);
            } else if (dim && dim.w <= displayed.w && dim.h <= displayed.h) {
                // NOTHING TO SHOW. `showEvenIfNotLarger` means "display it at natural size
                // even though it does not clear minRatio" — it does not mean "display a
                // pixel-for-pixel copy of what is already on screen". This branch is the
                // only one where the candidate is the SAME URL as the thumbnail, so when it
                // is also the same size the frame would hold the identical bytes at the
                // identical scale, floating over the picture they were copied from.
                // Reported 2026-09-04: a 1000×557 masthead served at exactly 1000×557,
                // where this was the only thing producing a preview at all.
                dbg('nothing to show — the original is no bigger than what is on screen', {
                    url: shown, onScreen: displayed.w + '×' + displayed.h,
                    original: dim.w + '×' + dim.h,
                });
            } else if (dim) {
                best = { url: shown, w: dim.w, h: dim.h, video: !!dim.video, duration: dim.duration,
                    from: 'the displayed src itself (shown anyway — not larger)' };
                // This branch paints a preview too, so it MUST log one. Without it a hover
                // that showed something produced no 'hit' line at all, and a debug log with
                // a silent success path is worse than none — it reads as proof that nothing
                // was shown. Found while reading a real report, 2026-09-03.
                dbg('hit (not larger — shown anyway)', best);
                if (onHit && !token.cancelled) onHit(best);
            }
        }
        return best;
    }

    // ------------------------------------------------------------------ viewer
    //
    // The viewer has three states.
    //
    // UNPINNED it is a transient preview: it opens beside the pointer, is hit-testable,
    // and vanishes when the pointer leaves the image it came from.
    //
    // DETACHED (after dragging it anywhere) it stops tracking the source image: only
    // leaving the PREVIEW takes it down. Dragging is the cheap "keep this, I'm not done
    // with it" gesture — no click, no modal, no backdrop.
    //
    // PINNED (after a click) it becomes a modal: the backdrop starts swallowing
    // clicks, an X appears, and wheel / +− / arrows / drag turn it into a zoom-and-pan
    // surface that keeps going past the point where the frame fills the window.
    //
    // `view` is the only source of truth for geometry. reflow() derives frame size and
    // clamps the pan offsets; layout() is the only thing that writes any of it to the
    // DOM. Nothing else may set box/img styles, or the two will drift.

    // The frame has two possible faces and `mediaEl` is whichever one is currently showing.
    // layout() writes geometry to `mediaEl` and to nothing else, so "one thing owns the
    // DOM" survives the frame being able to hold a picture or a clip. setMedia() is the
    // only function that reassigns it, and it is also the only place either element's src
    // is set, so the two can never both be loaded at once.
    let host = null, root = null, box = null, imgEl = null, vidEl = null, mediaEl = null;
    let dimEl = null, closeEl = null;
    let capEl = null, capNameEl = null, capMetaEl = null, blockEl = null;
    let edgeEls = null;         // [top, left, right, bottom] — the drawn frame margin
    let spinEl = null, spinSvg = null;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const SPIN_SIZE = 34;                           // px, matches the .spin rule
    const RING_R = 13;                              // in the 36×36 viewBox, stroke-width 4.5
    const RING_C = 2 * Math.PI * RING_R;
    const ARC_FRAC = 0.3;                           // how much of the ring the moving arc covers

    function ringCircle(cls, r) {
        const c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('class', cls);
        c.setAttribute('cx', '18');
        c.setAttribute('cy', '18');
        c.setAttribute('r', String(r === undefined ? RING_R : r));
        return c;
    }

    // The spinner is the one part of the overlay that sits on the bare page rather than on
    // the frame's own dark background, so it has to read against whatever is behind it.
    //
    // `prefers-color-scheme` is the primary signal — it IS the browser's colour mode, which
    // is what "match the browser" means, and it is what the user is looking at everywhere
    // else. v0.7.0 keyed off the PAGE's computed background instead, which put a near-white
    // disc on a white page: technically "matching", and nearly invisible. That is kept only
    // as the fallback for a browser with no media-query support.
    function parseColor(s) {
        const m = String(s).match(/^rgba?\(([^)]+)\)$/i);
        if (!m) return null;
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
        if (p.length < 3 || p.some(isNaN)) return null;
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }

    function darkMode() {
        if (cfg.spinnerTheme === 'dark') return true;
        if (cfg.spinnerTheme === 'light') return false;
        try {
            const mq = matchMedia('(prefers-color-scheme: dark)');
            if (mq && typeof mq.matches === 'boolean') return mq.matches;
        } catch (e) { /* fall through to what the page actually painted */ }
        const els = [document.body, document.documentElement];
        for (let i = 0; i < els.length; i++) {
            if (!els[i]) continue;
            const c = parseColor(getComputedStyle(els[i]).backgroundColor);
            if (c && c.a > 0.05) return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) < 128;
        }
        return false;
    }

    // Catppuccin Mocha in dark mode, near-white in light. Both carry a hard rim and a
    // visible track: the disc lands on arbitrary page content, so the rim is what separates
    // it from whatever is behind it, and a rim too faint to see was the whole of the
    // "I can hardly see it" report.
    function applySpinTheme() {
        if (!host) return;
        const dark = darkMode();
        host.style.setProperty('--spin-bg', dark ? 'rgba(24,24,37,.96)' : 'rgba(255,255,255,.97)');
        host.style.setProperty('--spin-edge', dark ? 'rgba(205,214,244,.45)' : 'rgba(30,30,46,.45)');
        host.style.setProperty('--spin-track', dark ? 'rgba(205,214,244,.30)' : 'rgba(30,30,46,.22)');
        host.style.setProperty('--spin-arc', dark ? '#89b4fa' : '#1e66f5');
    }

    // { url, natW, natH, scale, fitScale, imgW, imgH, frameW, frameH, ox, oy, left, top }
    // ox/oy are the image's top-left within the frame's content box: 0 or negative once
    // the image outgrows the frame, centred while it still fits.
    let view = null;
    let placed = false;

    const MAX_SCALE_ABS = 64;   // ceiling on cfg.maxZoom; past this a pixel is a billboard
    const KEY_ZOOM = 1.25;      // per +/− press

    function buildViewer() {
        if (host) return;
        host = document.createElement('div');
        host.id = 'hover-zoom-host';
        host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
        root = host.attachShadow({ mode: 'open' });

        const style = document.createElement('style');
        style.textContent = [
            ':host{all:initial}',
            // Invisible, and never anything else. It exists only to catch the click that
            // dismisses a placed window before the page can act on it — no dimming, because
            // the whole point of placing a window is to compare it with what is behind it.
            // It does not block SCROLLING: a wheel over it finds no scrollable ancestor
            // until the document, so the page still moves under a placed window.
            '.dim{position:fixed;inset:0;background:transparent;pointer-events:none}',
            '.dim.catch{pointer-events:auto}',
            '.box{position:fixed;opacity:0;pointer-events:none;transition:opacity var(--fade) ease;',
            'background:#1e1e2e;box-sizing:content-box;overflow:hidden}',
            '.box.on{opacity:1}',
            // POINTER-TRANSPARENT until it is placed. This is what lets a scan across a row
            // of thumbnails work: the preview never intercepts the pointer, so leaving an
            // image really does leave it, and the next image under the preview still gets
            // its own mouseover. The press that places one is decided by GEOMETRY at window
            // level instead — see pointInPreview() and hitRegion().
            '.box.hot{pointer-events:auto}',
            // With nothing to pan the frame moves, so it says so. onMove overrides this with
            // an inline cursor over the edges and the corners.
            '.box.placed:not(.pan){cursor:move}',
            '.box.pan{cursor:grab}',
            '.box.pan.drag{cursor:grabbing}',
            'img,video{display:block;position:absolute;background:#1e1e2e;-webkit-user-drag:none;user-select:none}',
            // The frame margin: three strips drawn ON TOP of the picture, matching the status
            // bar along the bottom. Mostly transparent, because unlike the bar they carry no
            // text and their whole job is to say "there is a handle here" without hiding the
            // picture. Pointer-transparent decoration — hitRegion() decides what a press on
            // them does, so they never enter the isBoxControl() capture trap.
            '.edge{position:absolute;pointer-events:none;background:rgba(30,30,46,.30)}',
            // `display:block` above outranks the hidden attribute's UA rule, so the face
            // that is not in use would keep its box and sit under the other one.
            'img[hidden],video[hidden]{display:none}',
            // The status bar doubles as the frame's move handle, so unlike the rest of the
            // overlay it must stay hit-testable.
            '.cap{position:absolute;left:0;right:0;bottom:0;height:' + BAR_MIN_H + 'px;',
            'display:flex;align-items:center;gap:10px;box-sizing:border-box;',
            'padding:0 8px;font:11px/16px system-ui,sans-serif;color:#cdd6f4;',
            'background:rgba(30,30,46,.86);letter-spacing:.02em;user-select:none}',
            '.box.placed .cap{cursor:move}',
            '.cap .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
            'font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#a6adc8}',
            '.cap .meta{flex:none;white-space:nowrap}',
            // "Never this image again". Only on a PLACED window, for the same reason the X
            // is: a hover preview is pointer-transparent, so a button on it cannot be
            // clicked at all. Hover it, click to pin, then press this.
            // ABSOLUTE, not a flex item, plus a reserved gutter on the bar. As a flex item it
            // sat after a `flex:none` dimensions field, so on a narrow bar it was pushed past
            // the end and clipped away entirely - on a preview of a small picture, which is
            // the case where the button is most wanted. Its position no longer depends on
            // anything else in the bar.
            '.cap .block{position:absolute;right:' + BLOCK_RIGHT + 'px;top:50%;',
            'transform:translateY(-50%);display:none;width:18px;height:18px;line-height:16px;',
            'text-align:center;border-radius:4px;border:1px solid #45475a;',
            'background:rgba(49,50,68,.9);color:#a6adc8;cursor:pointer;font-size:12px}',
            '.box.hot .cap .block{display:block}',
            '.cap .block:hover{background:#f38ba8;border-color:#f38ba8;color:#1e1e2e}',
            // The bar sits ON the picture, so on anything with text near the bottom — a meme,
            // a screenshot, a comic panel — it covers the thing you are reading. It fades out
            // after BAR_IDLE_MS of pointer stillness and comes back the moment the pointer
            // moves over the window. pointer-events go with the opacity, so a faded bar is not
            // an invisible move handle waiting to be pressed by mistake.
            //
            // The fade itself takes BAR_FADE_MS, kept deliberately long: the whole of it is
            // reaction time, and the bar carries the ⊘ button. It comes BACK instantly
            // (BAR_SHOW_MS) — a slow return would read as lag on a control you just asked for.
            '.cap,.edge{transition:opacity ' + BAR_SHOW_MS + 'ms ease}',
            '.box.idle .cap{opacity:0;pointer-events:none;transition:opacity ' + BAR_FADE_MS + 'ms ease}',
            '.box.idle .edge{opacity:0;transition:opacity ' + BAR_FADE_MS + 'ms ease}',
            // Resolve progress: an INDETERMINATE ring — a fixed arc sweeping a full track.
            // It says "still working" and nothing else. The determinate version it replaces
            // could not be honest: the denominator was the candidate count, most runs stop
            // well before the end of that list, so the arc never once finished where it
            // said it would. The disc behind it is mostly opaque and themed to the page,
            // so the ring reads on a white page as well as a dark one.
            '.spin{position:fixed;width:34px;height:34px;display:none;pointer-events:none;',
            'filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))}',
            '.spin.on{display:block}',
            '.spin svg{display:block;width:100%;height:100%}',
            '.spin .disc{fill:var(--spin-bg);stroke:var(--spin-edge);stroke-width:1.5}',
            '.spin .track,.spin .arc{fill:none;stroke-width:4.5;stroke-linecap:round}',
            '.spin .track{stroke:var(--spin-track)}',
            '.spin .arc{stroke:var(--spin-arc)}',
            '.x{position:absolute;width:26px;height:26px;display:none;',
            'align-items:center;justify-content:center;border-radius:50%;border:1px solid #45475a;',
            'background:rgba(30,30,46,.88);color:#cdd6f4;font:17px/1 system-ui,sans-serif;',
            'cursor:pointer;user-select:none}',
            '.box.placed .x{display:flex}',
            '.x:hover{background:#f38ba8;border-color:#f38ba8;color:#1e1e2e}',
        ].join('');
        root.appendChild(style);

        dimEl = document.createElement('div');
        dimEl.className = 'dim';
        // Only reachable while `.catch` is on, i.e. while placed. Killing the mousedown
        // as well as the click stops the page beneath from starting a selection or
        // following a link with the same gesture that dismissed us.
        //
        // dismiss() rather than unplace(): the click that gets rid of a window very often
        // lands on the thumbnail it came from, and a plain close would let the next mouse
        // movement re-open the thing just thrown away.
        dimEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        dimEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); dismiss(); }, true);
        root.appendChild(dimEl);

        box = document.createElement('div');
        box.className = 'box';

        imgEl = document.createElement('img');
        imgEl.draggable = false;

        // The frame's other face. An imgur video post has no animated image form at all, so
        // "the better version of this gif" is an mp4 or it is nothing. It is muted, looping
        // and autoplaying because it stands in for an animated picture rather than offering
        // a player — and deliberately WITHOUT `controls`, which would put a play button and
        // a scrubber under the same clicks that pin, drag and dismiss the window.
        vidEl = document.createElement('video');
        vidEl.muted = true;
        vidEl.loop = true;
        vidEl.autoplay = true;
        vidEl.playsInline = true;
        vidEl.draggable = false;
        vidEl.hidden = true;

        // The second half of the unstable-URL test. Permanent listeners on the two faces
        // rather than a per-load handler, so there is nothing to attach, detach or leak;
        // verifyMedia() is a no-op whenever the sizes agree, which is every ordinary load.
        imgEl.addEventListener('load', verifyMedia);
        vidEl.addEventListener('loadedmetadata', verifyMedia);

        capEl = document.createElement('div');
        capEl.className = 'cap';
        capNameEl = document.createElement('span');
        capNameEl.className = 'name';
        capMetaEl = document.createElement('span');
        capMetaEl.className = 'meta';
        blockEl = document.createElement('span');
        blockEl.className = 'block';
        blockEl.title = 'Never preview this image again';
        blockEl.textContent = '⊘';
        // Both halves swallowed, and both needed: onBoxDown/onBoxClick are capture
        // listeners on an ANCESTOR, so they run first — isBoxControl() is what stops them
        // eating this button's own events. See the note on isBoxControl().
        blockEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        blockEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); blockCurrent(); }, true);

        capEl.appendChild(capNameEl);
        capEl.appendChild(capMetaEl);
        capEl.appendChild(blockEl);

        closeEl = document.createElement('div');
        closeEl.className = 'x';
        closeEl.title = 'Close (Esc)';
        closeEl.textContent = '×';
        closeEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        closeEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); unplace(); }, true);

        // After the picture and before the bar, so the bar is drawn over the bottom strip
        // where the two overlap.
        edgeEls = ['t', 'l', 'r', 'b'].map(function (k) {
            const d = document.createElement('div');
            d.className = 'edge ' + k;
            return d;
        });

        box.appendChild(imgEl);
        box.appendChild(vidEl);
        edgeEls.forEach(function (d) { box.appendChild(d); });
        box.appendChild(capEl);
        box.appendChild(closeEl);
        box.addEventListener('mousedown', onBoxDown, true);
        box.addEventListener('click', onBoxClick, true);
        root.appendChild(box);

        spinEl = document.createElement('div');
        spinEl.className = 'spin';
        spinSvg = document.createElementNS(SVG_NS, 'svg');
        spinSvg.setAttribute('viewBox', '0 0 36 36');
        spinSvg.appendChild(ringCircle('disc', 17.5));
        spinSvg.appendChild(ringCircle('track'));
        const arcEl = ringCircle('arc');
        arcEl.setAttribute('stroke-dasharray',
            (RING_C * ARC_FRAC).toFixed(2) + ' ' + (RING_C * (1 - ARC_FRAC)).toFixed(2));
        spinSvg.appendChild(arcEl);
        spinEl.appendChild(spinSvg);
        root.appendChild(spinEl);

        (document.body || document.documentElement).appendChild(host);
    }

    // ----------------------------------------------------------------- geometry

    // The one gutter between the frame and the edge of the window, applied wherever WE place
    // a frame rather than the user. It is subtracted from the opening size as well as the
    // opening position, or a preview would open exactly 8px wider than it is allowed to sit.
    const EDGE_GAP = 4;

    // The browser paints its own status text — the target of the link under the pointer,
    // "Waiting for…", the download bar — along the BOTTOM edge of the content area, on top
    // of the page and on top of anything we draw there. A frame clamped to the true bottom
    // therefore has its last rows of pixels covered by browser chrome we cannot see from
    // here. `bottomReserve` is taken off the height ONCE, at the top of viewportBox(), so
    // the size cap, the opening position, clampPosition() and the floating spinner all
    // inherit it from this single place and cannot disagree about where the bottom is.
    // The frame around the picture, and the smallest window worth having.
    //
    // THE MARGIN IS DRAWN ON TOP OF THE PICTURE, exactly as the status bar always has been,
    // and it costs the frame no size at all (v0.31.0 — v0.30.0 laid it out around the
    // picture, which made every preview 48px wider and taller than it needed to be). It is a
    // move handle, and the answer to the old objection that a move band is an invisible
    // second meaning for the edge is that this one is painted and carries the `move` cursor.
    // While it is FADED it stops being a handle at all, which is the same rule the bar has
    // always had — see hitRegion().
    //
    // MIN_FRAME is the whole picture area, so the smallest window is 50px at the default
    // border. It exists because `minDisplayed: 0` otherwise gives a preview a few pixels
    // across, with nowhere for the status bar or the block button to be.
    const MIN_FRAME = 48;

    function chrome() {
        return Math.max(0, Math.min(80, cfg.frameMargin | 0));
    }

    // What sits between view.left/top and the picture's own top-left, and the window's outer
    // size. The margin is NOT part of this: it floats over the picture. Every geometry site
    // goes through these four so there is one place to change if that ever stops being true.
    function insetX() { return cfg.borderWidth; }
    function insetY() { return cfg.borderWidth; }
    function outerW() { return view.frameW + insetX() * 2; }
    function outerH() { return view.frameH + insetY() * 2; }

    function usableHeight() {
        const vh = document.documentElement.clientHeight;
        return Math.max(64, vh - Math.max(0, cfg.bottomReserve || 0));
    }

    // The box a preview OPENS into. Never larger than the window, whatever the growth
    // ceiling says: a preview appears without being asked for, so one that arrived taller
    // than the screen would be a nuisance rather than a feature. Growing past this point is
    // something the user does on purpose, with the wheel or a corner.
    function viewportBox() {
        const vw = document.documentElement.clientWidth;
        const vh = usableHeight();
        return {
            vw: vw,
            vh: vh,
            w: Math.max(MIN_FRAME, vw - EDGE_GAP * 2 - insetX() * 2),
            h: Math.max(MIN_FRAME, vh - EDGE_GAP * 2 - insetY() * 2),
        };
    }

    // A setting this high is a compositing cost, not a feature: 4x a 1920x1080 window is a
    // 33-megapixel frame.
    const MAX_MULTIPLE_ABS = 4;

    // How far the frame may grow. Deliberately bigger than the window — see the setting.
    function growBox() {
        const m = Math.max(1, Math.min(cfg.maxSizeMultiple || 1, MAX_MULTIPLE_ABS));
        const b = viewportBox();
        return { vw: b.vw, vh: b.vh, w: b.w * m, h: b.h * m };
    }

    function pannable() {
        return !!view && (view.imgW > view.frameW + 0.5 || view.imgH > view.frameH + 0.5);
    }

    // The zoom floor, and what `0` returns to. While the frame still follows the picture
    // that is "fit the window"; once the frame is frozen it has to become "fit the FRAME",
    // or `0` on a window the user sized by hand would spring it back to the window's shape
    // and throw away the size they chose.
    function fitScaleFor(w, h) {
        if (!w || !h) return 1;
        if (view && view.fixedW != null) return Math.min(view.fixedW / w, view.fixedH / h);
        const m = viewportBox();
        return Math.min(cfg.zoomFactor, m.w / w, m.h / h);
    }

    // The zoom FLOOR is no longer "fit". A frame may now be bigger than the picture inside
    // it: zoom out past fit and the picture shrinks in place, with the frame's own
    // background behind it, the way any image viewer behaves. What stops it is an absolute
    // size rather than the frame's - below this there is nothing left to look at.
    const MIN_MEDIA = 32;

    function minScaleFor(w, h) {
        if (!w || !h) return 1;
        // Never a floor ABOVE where the picture opens, or a thumbnail smaller than MIN_MEDIA
        // would be forced to open enlarged.
        return Math.min(MIN_MEDIA / Math.max(w, h), fitScaleFor(w, h));
    }

    // While it is still a hover preview the frame grows with the image, up to the growth
    // ceiling: zooming a small picture is how you get a preview big enough to be worth
    // placing, and having to resize every one of them by hand on a page full of small
    // images is the thing that made this necessary.
    //
    // Placing it FREEZES the frame (view.fixedW/fixedH, set by place() and by a corner
    // drag). From then on the frame is an aperture: zooming scales the picture inside it,
    // which spills and pans, and only a corner changes the frame again.
    function reflow() {
        if (!view) return;
        const g = growBox();
        view.imgW = view.natW * view.scale;
        view.imgH = view.natH * view.scale;
        view.frameW = Math.round(view.fixedW != null ? view.fixedW
            : Math.max(MIN_FRAME, Math.min(view.imgW, g.w)));
        view.frameH = Math.round(view.fixedH != null ? view.fixedH
            : Math.max(MIN_FRAME, Math.min(view.imgH, g.h)));
        view.ox = view.imgW <= view.frameW
            ? (view.frameW - view.imgW) / 2
            : Math.min(0, Math.max(view.frameW - view.imgW, view.ox));
        view.oy = view.imgH <= view.frameH
            ? (view.frameH - view.imgH) / 2
            : Math.min(0, Math.max(view.frameH - view.imgH, view.oy));
    }

    // Placed beside the pointer, the frame does not contain it, so reaching the preview
    // means crossing page content that dismisses it. Centring it on the cursor fixed that
    // but moved the preview much further than it needed to go. This shifts it by the
    // smallest amount that puts the pointer just inside the frame's edge — with the
    // default 24px gap, about 34px, and only along the axis that needs it.
    const REACH_INSET = 10;

    function nudgeIntoReach() {
        const ow = outerW();
        const oh = outerH();
        if (pointer.x < view.left + REACH_INSET) view.left = pointer.x - REACH_INSET;
        else if (pointer.x > view.left + ow - REACH_INSET) view.left = pointer.x - ow + REACH_INSET;
        if (pointer.y < view.top + REACH_INSET) view.top = pointer.y - REACH_INSET;
        else if (pointer.y > view.top + oh - REACH_INSET) view.top = pointer.y - oh + REACH_INSET;
    }

    // Enough of a placed frame to grab hold of. It must be at least the width of the edge
    // band that moves the frame (hitRegion), because that is what makes the rule safe:
    // whatever strip of a half-offscreen window is still visible runs along one of its
    // edges, so it is always in the band, so the window can always be dragged back. Drop
    // below the band width and a window can be stranded with nothing but Escape.
    const KEEP_ON_SCREEN = 72;

    // Two different jobs behind one name.
    //
    // A HOVER preview was placed by us, not by the user, so it is kept fully on screen while
    // it fits — and once the wheel has grown it past the window there is nothing left to
    // keep inside, so it is only stopped from sliding a gap in at an edge.
    //
    // A PLACED window was put where it is on purpose. It may hang off any edge, which is the
    // whole point of the growth ceiling being above 1x: shove it aside or upwards and the
    // picture still reaches the screen edges instead of leaving a strip of page behind it.
    function clampPosition() {
        if (!view) return;
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        if (!vw || !vh) return;      // the Browser pane reports 0 while hidden
        const ow = outerW();
        const oh = outerH();
        if (!placed) {
            const bh = usableHeight();
            const loX = vw - ow - EDGE_GAP, hiX = EDGE_GAP;
            const loY = bh - oh - EDGE_GAP, hiY = EDGE_GAP;
            view.left = loX >= hiX ? Math.max(hiX, Math.min(view.left, loX))
                                   : Math.max(loX, Math.min(view.left, hiX));
            view.top = loY >= hiY ? Math.max(hiY, Math.min(view.top, loY))
                                  : Math.max(loY, Math.min(view.top, hiY));
            return;
        }
        const keep = Math.min(KEEP_ON_SCREEN, ow, oh);
        view.left = Math.max(keep - ow, Math.min(view.left, vw - keep));
        view.top = Math.max(keep - oh, Math.min(view.top, vh - keep));
    }

    // ------------------------------------------------------- where a press landed
    //
    // GEOMETRY, not child elements. Four corner divs and four edge divs would be the
    // obvious build, and they would land straight in the documented isBoxControl() trap:
    // onBoxDown is a capture listener on an ANCESTOR, so it eats a child's events before
    // the child sees them and the symptom is silence rather than an error. Doing it from
    // `view` also means one code path for both states — on a hover preview the frame is
    // pointer-transparent and there is nothing to hit-test at all.
    //
    // An ordinary desktop window, and deliberately nothing cleverer:
    //
    //   corner       resize both axes
    //   edge strip   resize that one axis
    //   the middle   move the frame, or pan the picture once it is spilling
    //   status bar   move the frame, always — this is the title bar (see below)
    //
    // EDGES RESIZE, not move. An earlier cut had a move band sitting just inside the resize
    // strip, so that a window dragged half off the screen always had something to drag it
    // back by. Two bands within 30px of each other is a mis-grab waiting to happen, and it
    // made the edge mean two things depending on a number nobody can see.
    //
    // Corners AND edges both resize because corners are not always reachable: the growth
    // ceiling is above 1x, so a frame can be larger than the window and have no corner on
    // screen at all, while an edge is a whole strip and there is nearly always one in view.
    //
    // WHAT MOVES A SPILLING FRAME IS THE STATUS BAR. Once the picture spills, the middle
    // pans, so the bar is the only handle left — exactly as a title bar is on any window
    // manager. That is the reason it always moves the frame regardless of zoom, and the
    // reason `showStatusBar` off is a real trade rather than a cosmetic one: a spilling
    // frame with no bar can be resized and panned but not moved, and Escape is the way out.
    const RESIZE_BAND = 12;   // px of the outer edge that resizes along one axis
    const CORNER_REACH = 24;  // px from a corner where a drag resizes both axes at once

    function hitRegion(x, y) {
        if (!view) return null;
        const ow = outerW();
        const oh = outerH();
        const rx = x - view.left, ry = y - view.top;
        if (rx < 0 || ry < 0 || rx > ow || ry > oh) return null;
        const dl = rx, dr = ow - rx, dt = ry, db = oh - ry;
        // Both rings shrink on a small frame, or together they swallow the whole of it and
        // there is no middle left to grab.
        const corner = Math.min(CORNER_REACH, ow / 3, oh / 3);
        const rb = Math.min(RESIZE_BAND, ow / 6, oh / 6);
        const cl = dl <= corner, cr = dr <= corner, ct = dt <= corner, cb = db <= corner;
        if ((cl || cr) && (ct || cb)) {
            return { kind: 'resize', ex: cl ? 'l' : 'r', ey: ct ? 't' : 'b' };
        }
        if (dl <= rb) return { kind: 'resize', ex: 'l', ey: null };
        if (dr <= rb) return { kind: 'resize', ex: 'r', ey: null };
        if (dt <= rb) return { kind: 'resize', ex: null, ey: 't' };
        if (db <= rb) return { kind: 'resize', ex: null, ey: 'b' };
        // Past the resize strip and inside the frame margin: the drawn ring, which moves the
        // window whatever the zoom. Bounded by a third of the frame so that on a small one it
        // cannot swallow the middle entirely.
        //
        // ONLY WHILE IT IS VISIBLE. The ring fades with the status bar, and a faded bar has
        // always dropped its pointer-events so that a press there falls through to the
        // ordinary pan-or-move rule rather than being an invisible handle. The ring is drawn
        // rather than hit-tested, so the same rule has to be applied here by hand.
        if (!chromeVisible()) return null;
        const m = chromeThickness() + cfg.borderWidth;
        if (dl < m || dr < m || dt < m || db < m) return { kind: 'move' };
        return null;    // the middle — the pan-or-move rule decides
    }

    function regionCursor(reg) {
        if (!reg) return '';        // the middle: leave it to the .pan / .placed CSS rules
        if (reg.kind === 'move') return 'move';
        if (!reg.ey) return 'ew-resize';
        if (!reg.ex) return 'ns-resize';
        return (reg.ex === 'l') === (reg.ey === 't') ? 'nwse-resize' : 'nesw-resize';
    }

    // ------------------------------------------------------------- status bar

    const TYPE_NAMES = { jpg: 'JPEG', jpeg: 'JPEG', jpe: 'JPEG', jfif: 'JPEG',
        tif: 'TIFF', tiff: 'TIFF', ico: 'ICO', svg: 'SVG' };

    // Filename and format, both taken from the URL — the only source available without a
    // second request. An extension-less CDN path can still declare its format in the query.
    function fileInfo(url) {
        const out = { name: url, type: '' };
        try {
            const u = new URL(url, location.href);
            const segs = u.pathname.split('/').filter(Boolean);
            out.name = decodeURIComponent(segs.length ? segs[segs.length - 1] : u.hostname);
            const ext = u.pathname.match(MEDIA_RE) || u.pathname.match(VIDEO_EXT_RE);
            const q = ext ? null : u.search.match(/[?&](?:format|fm|output)=([a-z0-9]+)/i);
            const raw = ext ? ext[1] : (q ? q[1] : '');
            if (raw) out.type = TYPE_NAMES[raw.toLowerCase()] || raw.toUpperCase();
        } catch (e) { /* keep the raw url as the name */ }
        return out;
    }

    // Byte size for free: the probe already fetched it, so the Resource Timing entry is
    // there. Cross-origin without Timing-Allow-Origin reports 0, and then we just omit it.
    function transferBytes(url) {
        try {
            const entries = performance.getEntriesByName(url);
            for (let i = entries.length - 1; i >= 0; i--) {
                const n = entries[i].encodedBodySize || entries[i].transferSize || 0;
                if (n > 0) return n;
            }
        } catch (e) { /* no Resource Timing */ }
        return 0;
    }

    function humanBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function caption() {
        if (!cfg.showStatusBar) {
            capEl.style.display = 'none';
            return;
        }
        capEl.style.display = '';

        const info = fileInfo(view.url);
        capNameEl.textContent = info.name;
        capNameEl.title = view.url;

        const parts = [];
        if (info.type) parts.push(info.type);
        parts.push(view.natW + ' × ' + view.natH);
        const bytes = transferBytes(view.url);
        if (bytes) parts.push(humanBytes(bytes));
        // A hover preview can be grown with the wheel, so the scale shows whenever it is
        // placed or has moved off the scale it opened at.
        if (placed || Math.abs(view.scale - view.fitScale) > 1e-6) {
            parts.push(Math.round(view.scale * 100) + '%');
        }
        capMetaEl.textContent = parts.join('  ·  ');
    }

    // ------------------------------------------------------------- status bar fade
    //
    // The bar is drawn ON the picture, so on a meme, a screenshot or a comic panel it covers
    // the text you are trying to read. It fades after BAR_IDLE_MS of pointer stillness and
    // returns the moment the pointer moves over the window — which is also how you get the
    // move handle back, so nothing becomes unreachable.
    //
    // The ⋮ image-actions menu that used to live at the right end of this bar is gone
    // (v0.12.0). Its Save and Copy could not work: both ran in page JavaScript and needed the
    // host to send Access-Control-Allow-Origin, which most do not. A placed window hands
    // right-click to the BROWSER instead, whose own menu has no such limit — see the
    // image-actions section of CLAUDE.md.

    // BAR_IDLE_MS is how long the pointer must be still before the fade STARTS;
    // BAR_FADE_MS is how long the fade itself takes. They are separate on purpose — the
    // second one is pure reaction time, so it is generous, while the first stays short
    // enough that the bar gets out of the way of the picture.
    const BAR_IDLE_MS = 1000;
    const BAR_FADE_MS = 1200;
    const BAR_SHOW_MS = 120;

    // The bar's height, fixed so the ring around it can be a matching thickness.
    const BAR_MIN_H = 24;
    // How far the block button sits in from the right edge. Off the corner on purpose: the
    // corner is where the hand goes to resize or to move, and a destructive button there is
    // a trap.
    const BLOCK_RIGHT = 20;

    let barTimer = 0;

    // The bar must not fade while the pointer is ON it: it holds the ⊘ button and the
    // filename, and a control that disappears under a resting cursor is unusable. A still
    // pointer fires no mousemove, so showBar()'s own timer is the only thing that can
    // notice — it re-arms instead of fading. Geometry, not hit-testing, for the same reason
    // pinning is: on a hover preview the bar is pointer-transparent and `e.target` is the
    // page beneath.
    function pointerOverBar() {
        if (!capEl || !view || !box || !box.classList.contains('on')) return false;
        if (capEl.style.display === 'none') return false;
        const r = capEl.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        return pointer.x >= r.left && pointer.x <= r.right &&
               pointer.y >= r.top && pointer.y <= r.bottom;
    }

    // The margin ring counts too, for the same reason the bar does: it is a control, and a
    // control that vanishes under a resting cursor is unusable. Geometry rather than a hit
    // test, because the strips are pointer-transparent decoration.
    function pointerOverChrome() {
        if (pointerOverBar()) return true;
        if (!view || !box || !box.classList.contains('on') || !chrome()) return false;
        const ow = outerW(), oh = outerH();
        const rx = pointer.x - view.left, ry = pointer.y - view.top;
        if (rx < 0 || ry < 0 || rx > ow || ry > oh) return false;
        const m = chromeThickness() + cfg.borderWidth;
        return rx < m || ry < m || ow - rx < m || oh - ry < m;
    }

    // Whether the frame's own furniture — bar and margin — is showing. hitRegion() reads it,
    // so the ring is a move handle exactly while it can be seen.
    function chromeVisible() {
        return !!box && !box.classList.contains('idle');
    }

    // The class lives on the BOX, not on the bar: the margin strips are siblings of the bar
    // and CSS cannot select backwards, so one class on their common ancestor is what keeps
    // the two halves of the frame fading as one thing.
    function showBar() {
        if (!box) return;
        box.classList.remove('idle');
        clearTimeout(barTimer);
        barTimer = setTimeout(function () {
            barTimer = 0;
            if (!box || !view) return;
            if (pointerOverChrome()) { showBar(); return; }   // parked on it: keep it
            box.classList.add('idle');
        }, BAR_IDLE_MS);
    }

    function resetBar() {
        clearTimeout(barTimer);
        barTimer = 0;
        // The offset stickBar() wrote belongs to the frame that just closed; leaving it on
        // would open the next preview with its bar floating somewhere up the picture.
        if (box) box.classList.remove('idle');
        if (capEl) capEl.style.bottom = '0px';
    }

    // Point the frame at a resolved candidate, picking the face that can display it. The
    // one being put away has its src cleared as well as being hidden: a <video> left with a
    // src goes on buffering behind a hidden element, and an <img> left with one holds its
    // decoded bitmap for the life of the tab.
    function setMedia(res) {
        const wantsVideo = !!res.video;
        mediaEl = wantsVideo ? vidEl : imgEl;
        const idle = wantsVideo ? imgEl : vidEl;
        idle.hidden = true;
        clearMedia(idle);
        mediaEl.hidden = false;
        if (!wantsVideo && cfg.noReferrer) imgEl.referrerPolicy = 'no-referrer';
        mediaEl.src = res.url;
        if (wantsVideo) {
            // Autoplay is muted, so this is allowed everywhere — but it still returns a
            // promise that rejects if the element is torn down mid-start, and an unhandled
            // rejection in a hover handler is noise in every page's console.
            const started = vidEl.play();
            if (started && started.catch) started.catch(function () { /* torn down or blocked */ });
        }
    }

    function clearMedia(el) {
        if (!el) return;
        if (el === vidEl) { vidEl.pause(); vidEl.removeAttribute('src'); vidEl.load(); }
        else el.removeAttribute('src');
    }

    // WHAT LOADED IS NOT WHAT WAS MEASURED. The probe and the frame fetch the same URL under
    // the same referrer policy, so the only thing that produces a disagreement is a URL that
    // answers with different bytes each time — see markUnstable(). The picture in the frame
    // is then one the user never pointed at, and the honest thing is to take it down rather
    // than relabel it.
    //
    // A PINNED window is not yanked away: the user deliberately kept it, and closing a
    // window under a click is worse than showing an unexpected picture. Its geometry is
    // corrected to the size that actually loaded instead, and the URL is still refused from
    // then on, so the next hover does not produce yet another wrong picture.
    function verifyMedia() {
        if (!view || !mediaEl) return;
        const w = mediaEl === vidEl ? vidEl.videoWidth : imgEl.naturalWidth;
        const h = mediaEl === vidEl ? vidEl.videoHeight : imgEl.naturalHeight;
        if (!w || !h) return;
        if (w === view.natW && h === view.natH) return;
        markUnstable(view.url, { w: view.natW, h: view.natH }, { w: w, h: h });
        if (!placed) { cancel(); return; }
        view.natW = w;
        view.natH = h;
        view.fitScale = fitScaleFor(w, h);
        view.scale = Math.max(view.scale, minScaleFor(w, h));
        reflow();
        layout();
    }

    // The status bar rides the bottom of the VISIBLE part of the frame, not the bottom of the
    // frame. Without this there is a state you can zoom yourself into and not get out of: a
    // frame grown past the viewport and then zoomed until the picture spills covers the whole
    // screen, so no edge and no corner is reachable to resize by, the middle pans, and the bar
    // — the one thing that always moves the window — is somewhere below the bottom of the
    // screen. Every gesture is then a pan and only Escape gets you out.
    //
    // Keeping the bar against the visible bottom edge is the same guarantee a window manager
    // makes about a title bar, and it is the reason the move handle can live there alone. It
    // also means the filename and dimensions stay readable on a frame far bigger than the
    // window. The offset is clamped so the bar can never climb above the frame's own top.
    function stickBar() {
        if (!capEl || !cfg.showStatusBar) return;
        const oh = outerH();
        const overhang = (view.top + oh) - usableHeight();
        const room = Math.max(0, oh - cfg.borderWidth * 2 - capEl.offsetHeight);
        capEl.style.bottom = Math.round(Math.max(0, Math.min(overhang, room))) + 'px';
    }

    // How thick the drawn margin actually is. Capped at a third of the frame so the smallest
    // window is not entirely chrome. hitRegion() reads the same number, or the ring you can
    // see and the ring you can grab would not be the same ring.
    function chromeThickness() {
        if (!view) return 0;
        return Math.round(Math.min(chrome(), view.frameW / 3, view.frameH / 3));
    }

    // The margin strips and the X, all of which float over the picture and therefore have to
    // be re-placed whenever the frame changes size.
    //
    // The sides run the full height under the bar rather than stopping at it: stopping at
    // whichever of the two is thicker leaves a gap in the ring just above the bar whenever
    // they disagree. The bar is drawn after them and is nearly opaque, so the overlap reads
    // as the bar. The bottom strip only appears when there is no bar to be the bottom edge.
    function layoutChrome() {
        const m = chromeThickness();
        const px = function (n) { return n + 'px'; };
        edgeEls[0].style.cssText = 'left:0;right:0;top:0;height:' + px(m);
        edgeEls[1].style.cssText = 'left:0;top:' + px(m) + ';bottom:0;width:' + px(m);
        edgeEls[2].style.cssText = 'right:0;top:' + px(m) + ';bottom:0;width:' + px(m);
        edgeEls[3].style.cssText = cfg.showStatusBar ? 'display:none'
            : 'left:' + px(m) + ';right:' + px(m) + ';bottom:0;height:' + px(m);
        // The gutter the block button sits in, reserved so the filename and the dimensions
        // can never run under it. Clamped rather than fixed in CSS: the bar is positioned
        // left:0/right:0 with border-box sizing, so a padding wider than the frame does not
        // shrink the text, it forces the whole bar wider than the window it is in.
        capEl.style.paddingRight =
            px(placed ? Math.min(BLOCK_RIGHT + 26, Math.max(8, view.frameW - 8)) : 8);
        // Pulled in from the corner only as far as there is room for it.
        const inset = Math.max(4, Math.min(m + 6, Math.min(view.frameW, view.frameH) - 32));
        closeEl.style.top = closeEl.style.right = px(inset);
    }

    function layout() {
        if (!view || !mediaEl) return;
        clampPosition();
        box.style.left = Math.round(view.left) + 'px';
        box.style.top = Math.round(view.top) + 'px';
        box.style.width = view.frameW + 'px';
        box.style.height = view.frameH + 'px';
        layoutChrome();
        mediaEl.style.width = Math.round(view.imgW) + 'px';
        mediaEl.style.height = Math.round(view.imgH) + 'px';
        mediaEl.style.left = Math.round(view.ox) + 'px';
        mediaEl.style.top = Math.round(view.oy) + 'px';
        stickBar();
        box.classList.toggle('hot', placed);
        box.classList.toggle('pan', placed && pannable());
        caption();
        if (spinDocked) moveSpinner();      // the dock rides with the frame
    }

    // Zoom about a point given in SCREEN coordinates, keeping whatever pixel of the image
    // sits under it there afterwards. The frame may resize and be re-centred in between,
    // so the anchor's frame-relative position is derived twice: once against the old
    // frame to find the image pixel, once against the new one to place it back.
    function zoomAt(nextScale, screenX, screenY) {
        if (!view) return;
        const lo = minScaleFor(view.natW, view.natH);
        const hi = Math.max(lo, Math.min(cfg.maxZoom, MAX_SCALE_ABS));
        nextScale = Math.max(lo, Math.min(hi, nextScale));
        if (Math.abs(nextScale - view.scale) < 1e-6) return;

        const ax = Math.max(0, Math.min(view.frameW, screenX - (view.left + insetX())));
        const ay = Math.max(0, Math.min(view.frameH, screenY - (view.top + insetY())));
        const ix = (ax - view.ox) / view.scale;
        const iy = (ay - view.oy) / view.scale;

        const cx = view.left + outerW() / 2;
        const cy = view.top + outerH() / 2;

        view.scale = nextScale;
        reflow();                       // new frame size; offsets are re-derived below
        view.left = cx - outerW() / 2;
        view.top = cy - outerH() / 2;
        clampPosition();

        const ax2 = Math.max(0, Math.min(view.frameW, screenX - (view.left + insetX())));
        const ay2 = Math.max(0, Math.min(view.frameH, screenY - (view.top + insetY())));
        view.ox = ax2 - ix * nextScale;
        view.oy = ay2 - iy * nextScale;
        reflow();                       // clamp the offsets; frame size is already settled
        layout();
    }

    function zoomCentre(nextScale) {
        if (!view) return;
        zoomAt(nextScale,
            view.left + insetX() + view.frameW / 2,
            view.top + insetY() + view.frameH / 2);
    }

    function panBy(dx, dy) {
        if (!view || !pannable()) return;
        view.ox += dx;
        view.oy += dy;
        reflow();
        layout();
    }

    // ---------------------------------------------------------- resolve spinner
    //
    // Probing is sequential and each step waits on a real image load, so a hover over a
    // slow or many-candidate image can sit silent for seconds and read as "nothing
    // happened". The ring says work is in progress. That is ALL it says, deliberately.
    //
    // It used to be determinate, filling against the candidate count. That number is the
    // worst case — the run stops at the first candidate that clears the ratio gate, which
    // is usually the first or second of up to eight — so the arc never finished anywhere
    // near where it claimed it would. A progress bar that is wrong every single time is
    // worse than no progress bar; there is no honest denominator available here, so the
    // ring stopped pretending to have one.

    const SPINNER_DELAY = 150;   // don't flash it for a cached or instant resolve

    // setInterval, not requestAnimationFrame, and not a CSS animation. rAF is starved
    // whenever the compositor decides the page is not worth animating — a fully occluded
    // window, some power-saving modes, and the Claude Code Browser pane, which reports
    // visibilityState "visible" and still delivers zero frames. A frozen ring is
    // indistinguishable from a hung script, so the animation must not depend on frames
    // being offered.
    const SPIN_MS = 60;          // ~16fps, one style write per tick
    const SPIN_STEP = 24;        // degrees per tick — 400°/s

    let spinTimer = null;
    let spinAnim = 0;
    let spinAngle = 0;

    function spinFrame() {
        if (!spinSvg) return;
        spinAngle = (spinAngle + SPIN_STEP) % 360;
        spinSvg.style.transform = 'rotate(' + spinAngle + 'deg)';
    }

    function showSpinner() {
        clearTimeout(spinTimer);
        buildViewer();
        applySpinTheme();           // per hover: the page may have flipped light/dark since
        spinDocked = false;
        spinAngle = 0;
        spinFrame();
        spinTimer = setTimeout(function () {
            moveSpinner();
            spinEl.classList.add('on');
            if (!spinAnim) spinAnim = setInterval(spinFrame, SPIN_MS);
        }, SPINNER_DELAY);
    }

    // Two homes. Before anything is on screen it trails the cursor, which is the only
    // place the user is looking. Once a preview is up it docks into the frame's lower
    // right, just above the status bar, where it means "this is not the final image yet".
    let spinDocked = false;

    function dockSpinner() {
        spinDocked = true;
        moveSpinner();
    }

    function moveSpinner() {
        if (!spinEl) return;
        const m = viewportBox();
        if (spinDocked && view && box && box.classList.contains('on')) {
            const capH = cfg.showStatusBar ? capEl.offsetHeight : 0;
            spinEl.style.left =
                Math.round(view.left + insetX() + view.frameW - SPIN_SIZE - 8) + 'px';
            spinEl.style.top =
                Math.round(view.top + insetY() + view.frameH - capH - SPIN_SIZE - 8) + 'px';
            return;
        }
        spinEl.style.left = Math.min(pointer.x + 16, m.vw - SPIN_SIZE - 4) + 'px';
        spinEl.style.top = Math.min(pointer.y + 16, m.vh - SPIN_SIZE - 4) + 'px';
    }

    function hideSpinner() {
        clearTimeout(spinTimer);
        if (spinAnim) { clearInterval(spinAnim); spinAnim = 0; }
        spinDocked = false;
        if (spinEl) spinEl.classList.remove('on');
    }

    // -------------------------------------------------------------------- show

    function showViewer(res, pointer) {
        buildViewer();

        const m = viewportBox();
        // Equivalent to the old "scale by zoomFactor, then shrink to fit, never enlarge":
        // whichever of the three constraints binds first.
        const fit = Math.min(cfg.zoomFactor, m.w / res.w, m.h / res.h);

        view = {
            url: res.url, natW: res.w, natH: res.h,
            scale: fit, fitScale: fit,
            imgW: 0, imgH: 0, frameW: 0, frameH: 0, ox: 0, oy: 0, left: 0, top: 0,
            // null while it is still a hover preview, which is what lets the wheel grow the
            // frame; place() and a corner drag fill them in and the frame stops following
            // the picture. See reflow().
            fixedW: null, fixedH: null,
        };
        reflow();

        host.style.setProperty('--fade', cfg.fadeMs + 'ms');

        box.style.border = cfg.borderWidth > 0 ? cfg.borderWidth + 'px solid ' + cfg.borderColor : 'none';
        box.style.borderRadius = cfg.cornerRadius + 'px';
        box.style.boxShadow = cfg.shadow ? '0 8px 32px rgba(0,0,0,.55)' : 'none';

        const ow = outerW();
        const oh = outerH();
        if (cfg.position === 'center') {
            view.left = (m.vw - ow) / 2;
            view.top = (m.vh - oh) / 2;
        } else {
            // Beside the pointer, on whichever side has more room.
            const rightRoom = m.vw - pointer.x - cfg.cursorGap;
            view.left = rightRoom >= ow ? pointer.x + cfg.cursorGap : pointer.x - cfg.cursorGap - ow;
            view.top = pointer.y - oh / 2;
            nudgeIntoReach();
        }

        setMedia(res);
        layout();
        deferredCaption(res.url);

        box.classList.add('on');
        showBar();
    }

    // A better original arrived while the preview is already up. Swap the pixels without
    // moving anything the eye is tracking: the frame keeps its centre, and a placed view
    // keeps both its on-screen size and the part of the picture it was looking at. The
    // decode is instant because the probe already pulled this URL into cache.
    function upgradeViewer(res) {
        if (!view) return;
        const centreX = view.left + outerW() / 2;
        const centreY = view.top + outerH() / 2;
        // where the frame's middle sits in the picture, as a fraction of it
        const fx = view.imgW ? (view.frameW / 2 - view.ox) / view.imgW : 0.5;
        const fy = view.imgH ? (view.frameH / 2 - view.oy) / view.imgH : 0.5;
        const prevImgW = view.imgW;
        // Read against the OLD fit, before it is recomputed for the new picture.
        // Either side of fit counts: since the frame may now be bigger than the picture, a
        // view deliberately zoomed OUT is as hand-made as one zoomed in, and re-fitting it on
        // an upgrade would undo that just as visibly.
        const userSized = view.fixedW != null || Math.abs(view.scale - view.fitScale) > 1e-6;

        view.url = res.url;
        view.natW = res.w;
        view.natH = res.h;
        view.fitScale = fitScaleFor(res.w, res.h);
        // Hold the on-screen size whenever the user has had a hand in it — placed, or grown
        // with the wheel while still hovering. Only a preview nobody has touched re-fits.
        // Missing the wheel-grown case would mean a late upgrade quietly undoing the sizing
        // that had just been done by hand.
        view.scale = userSized && prevImgW
            ? Math.max(minScaleFor(res.w, res.h), prevImgW / res.w)   // same size, better pixels
            : view.fitScale;

        reflow();
        view.ox = view.frameW / 2 - fx * view.imgW;
        view.oy = view.frameH / 2 - fy * view.imgH;
        reflow();
        view.left = centreX - outerW() / 2;
        view.top = centreY - outerH() / 2;

        setMedia(res);
        layout();
        deferredCaption(res.url);
    }

    function deferredCaption(url) {
        // Resource Timing can land a tick after the load the probe saw, so the byte size
        // is often missing on the first pass. One re-read catches it.
        if (!cfg.showStatusBar || transferBytes(url)) return;
        setTimeout(function () { if (view && view.url === url) caption(); }, 300);
    }

    function hideViewer() {
        if (!box) return;
        // `hot` is what makes the frame hit-testable, and it is added by layout(), which no
        // longer runs once the frame is down — so it has to come off HERE. Left on, the box
        // stays a full-size invisible rectangle with pointer-events:auto and cursor:move at
        // the frame's last position: it shows the move cursor, swallows every click through
        // its own onBoxDown, and makes onOver's `ours(e.target)` true so no image under it
        // can ever preview again. Reported as "a phantom window where the preview used to
        // be"; it appeared only after a preview had been placed at least once.
        box.classList.remove('on', 'hot', 'pan', 'drag');
        box.style.cursor = '';      // onMove writes this inline over the bands; see hitRegion
        // Release the decoded image, or stop the clip, so long sessions accumulate
        // neither bitmaps nor a video quietly buffering behind a hidden element.
        setTimeout(function () {
            if (box && !box.classList.contains('on')) {
                clearMedia(imgEl);
                clearMedia(vidEl);
                mediaEl = null;
                view = null;
            }
        }, cfg.fadeMs + 60);
    }

    // ------------------------------------------------------------- placed mode

    // Every placed-mode key and wheel listener lives on this one node, in capture, so
    // teardown cannot drift and so we outrank document-level listeners belonging to the
    // page or to a sibling userscript (the capture path reaches window first).
    const CAP_TARGET = window;
    const WHEEL_OPTS = { capture: true, passive: false };

    // ---------------------------------------------- the cross-userscript click claim
    //
    // Binding on window/capture beats every DOCUMENT-level listener, but two userscripts
    // both on window/capture are settled by registration order — which is the manager's
    // to decide and not ours. Open Links in New Tab moved its own click handling to
    // window/capture in v1.19.0 for exactly the same reason, and on a site it early-captures
    // it was taking the click that pins a preview: the press landed on the transparent
    // preview, OLINT saw a link under the pointer, and the page navigated instead.
    //
    // The order-independent fact is that MOUSEDOWN always precedes CLICK. So the press —
    // which every script sees, because nobody stops mousedown — is where ownership is
    // declared, and the click handler that runs first can read it. The channel is an
    // attribute on <html>: `document` is the one object two sandboxed userscripts reliably
    // share, needing no @grant and no unsafeWindow.
    //
    // The value is a timestamp and consumers check freshness (OLINT allows 1500 ms), because
    // there is no reliable "last" event to clear it on: mouseup fires BEFORE click, so
    // clearing there would clear it too early. It is cleared on the next press we do not
    // claim, and a stale one expires on its own.
    const CLAIM_ATTR = 'data-userscript-click-claim';

    function claimClick() {
        try {
            document.documentElement.setAttribute(CLAIM_ATTR, String(Date.now()));
        } catch (e) { /* no document element yet */ }
    }

    function releaseClick() {
        try {
            document.documentElement.removeAttribute(CLAIM_ATTR);
        } catch (e) { /* no document element yet */ }
    }

    // ONE rule, both states: a wheel over the frame is the frame's, a wheel anywhere else
    // scrolls the page. What it DOES differs — it grows a hover preview and zooms inside a
    // placed one — but who owns it does not, and that is what makes it predictable.
    //
    // The cost, and it is real: a hover preview is nudged to sit under the cursor, so while
    // one is up the wheel almost never reaches the page. Scrolling means moving off the
    // image first, which takes the preview down instantly, and then scrolling.
    //
    // Bound on demand rather than for the life of the script: this is a non-passive capture
    // listener on window, and leaving one attached on every page makes every wheel event on
    // every page cancellable for nothing. One flag so add and remove cannot drift, and the
    // same WHEEL_OPTS object for both, or the removal silently no-ops.
    let wheelZoomOn = false;

    // Bound when the window is PLACED, not when it appears. A wheel over a preview you are
    // merely hovering belongs to the PAGE: it scrolls, and the scroll takes the preview down.
    // v0.30.0 had the wheel place the window and grow it, which made growing-before-placing
    // possible but stole the scroll wheel from every hover — reverted deliberately in
    // v0.31.0. Growing the frame still works, one click later: placing does not freeze the
    // size, so the wheel over a placed-but-unmoved window grows it exactly as before.
    function enableWheelZoom() {
        if (wheelZoomOn) return;
        wheelZoomOn = true;
        CAP_TARGET.addEventListener('wheel', onPinWheel, WHEEL_OPTS);
    }

    function disableWheelZoom() {
        if (!wheelZoomOn) return;
        wheelZoomOn = false;
        CAP_TARGET.removeEventListener('wheel', onPinWheel, WHEEL_OPTS);
    }

    // Hovering becomes placed, and there is nothing in between. The old middle rung —
    // dragged aside but still dying the moment the pointer left it — was the thing that
    // made a deliberately positioned window disappear on its own, which is the opposite of
    // what positioning it means.
    //
    // Entered by any deliberate act on the frame: a wheel notch, a click, a drag, or a
    // resize. The press does it, not the release, so click-to-place and drag-to-place are
    // the same code path and there is no travel threshold to get wrong.
    //
    // THE WHEEL PLACES IT TOO, which is what makes growing a preview a stable gesture: while
    // it was still hover-held, growing one and then moving the pointer anywhere — including
    // towards the window you had just enlarged — killed it. The cost is that an idle scroll
    // over a picture now leaves a window that has to be dismissed, where before it merely
    // grew and then died on its own.
    //
    // Placing does NOT freeze the size. That is freezeSize(), and it is MOVING the window
    // that triggers it — putting it somewhere is the moment its size is settled.
    function place() {
        if (placed || !view) return;
        placed = true;
        clearTimeout(timer);
        // The in-flight resolve is deliberately NOT cancelled: placing is a reason to keep
        // looking for a better original, not to stop. upgradeViewer() preserves the placed
        // geometry when one arrives.
        box.classList.add('placed');
        dimEl.classList.add('catch');
        CAP_TARGET.addEventListener('keydown', onPinKey, true);
        // The wheel becomes the window's only now — see enableWheelZoom.
        enableWheelZoom();
        layout();
    }

    // The frame stops following the picture and becomes an aperture it zooms inside. Called
    // when the window is MOVED and when it is resized by hand — both are the user settling
    // the question of how big it should be. Until then the wheel keeps growing it, so the
    // sequence is: scroll it to the size you want, then put it where you want it.
    //
    // fitScale has to be recomputed here: it is the zoom floor and what `0` returns to, and
    // on a frozen frame that has to mean "fit the FRAME" rather than "fit the window", or
    // `0` would spring a hand-sized window back to the window's shape.
    function freezeSize() {
        if (!view || view.fixedW != null) return;
        view.fixedW = view.frameW;
        view.fixedH = view.frameH;
        view.fitScale = fitScaleFor(view.natW, view.natH);
    }

    function unplace() {
        if (!placed) return;
        placed = false;
        drag = null;
        box.classList.remove('placed', 'drag');
        box.style.cursor = '';
        dimEl.classList.remove('catch');
        CAP_TARGET.removeEventListener('keydown', onPinKey, true);
        cancel();
    }

    // Controls that live INSIDE the box. onBoxDown/onBoxClick are capture listeners on the
    // box, and capture descends from the ancestor, so without an explicit exemption their
    // stopPropagation() runs before a child's own handlers and the control does nothing —
    // the X looked correct, hovered correctly and did nothing until this existed. Any new
    // control added inside the box goes in here; the symptom of forgetting is silence.
    function isBoxControl(t) {
        return closeEl.contains(t) || blockEl.contains(t);
    }

    // "Never preview this image again", from the ⊘ in the status bar. Records the URL on
    // screen AND the source element's own src, because those differ whenever the preview is
    // an upgrade — blocking only the resolved one would leave the thumbnail still opening a
    // preview that then failed to upgrade.
    //
    // reloadSettings() first: the list is the one setting written from outside the panel, so
    // it is the one place a stale in-memory cfg would silently discard another tab's entries.
    function blockCurrent() {
        if (!view) return;
        reloadSettings();
        let added = false;
        [view.url, activeShown].forEach(function (u) {
            if (u && cfg.blockList.indexOf(u) === -1) { cfg.blockList.push(u); added = true; }
        });
        if (added) saveSettings();
        dbg('blocked', cfg.blockList);
        probeCache.clear();
        dismiss();
    }

    // Placing happens on the PRESS, so by the time a click arrives the window is already
    // placed and there is nothing left for this to do but keep the click off the page.
    function onBoxClick(e) {
        if (isBoxControl(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
    }

    function onBoxDown(e) {
        if (isBoxControl(e.target)) return;
        if (e.button !== 0 && e.button !== 2) return;

        // A PLACED window hands the right button to the browser: its own context menu is the
        // only thing that can Save or Copy the picture, because ours would run in page
        // JavaScript and need the host's CORS headers. The left button always drives the
        // window, whichever way pinButton points, or a window could end up with no way to
        // be moved at all.
        if (placed) {
            if (e.button !== 0) return;
        } else if (e.button !== (cfg.pinButton === 'right' ? 2 : 0)) {
            altButton(e);           // the other button dismisses a hover preview
            return;
        }

        // Swallow it either way: on a hover preview the press really does land on the page
        // beneath, and a link there would otherwise be followed.
        e.preventDefault();
        e.stopPropagation();
        if (!view) return;
        swallowNextClick = true;    // the click half of this press is ours too
        if (!placed) place();

        // Edges and corners resize; everything else is the middle — see hitRegion(). The
        // middle keeps the older rule: pan when there is something to pan, move the frame
        // when there is not, with the status bar always moving it. pannable() is read per
        // press, so zooming in and back out restores dragging by itself with no state to
        // keep in step.
        // THE STATUS BAR OUTRANKS THE EDGE REGIONS, and it has to. It normally sits along the
        // frame's bottom edge, inside the bottom resize strip, so without this precedence its
        // lower half would resize and only its top few pixels would move — on the one control
        // whose whole job is moving the window. The cost is that the bottom EDGE cannot be
        // grabbed to resize where the bar covers it; the two bottom corners and the other
        // three edges still can, which is the same trade any window with a docked title bar
        // makes.
        //
        // contains(e.target), not geometry: a faded bar has `pointer-events: none` (E10), so
        // this is false and the press falls through to the ordinary rule — which is exactly
        // the "a faded bar is not an invisible handle" behaviour.
        const onBar = capEl.contains(e.target);
        const reg = onBar ? null : hitRegion(e.clientX, e.clientY);
        if (reg && reg.kind === 'resize') {
            drag = {
                mode: 'resize', ex: reg.ex, ey: reg.ey,
                x0: e.clientX, y0: e.clientY,
                w0: view.frameW, h0: view.frameH, l0: view.left, t0: view.top,
                aspect: view.frameH ? view.frameW / view.frameH : 1,
                // Captured at grab time: a frame whose picture already spills is an
                // aperture, and widening it should reveal more rather than undo the zoom.
                spilling: pannable(),
                // Only a picture sitting EXACTLY at fit follows the frame. One deliberately
                // zoomed OUT below fit keeps its scale, or a resize would undo the zoom-out
                // exactly the way it is forbidden to undo a zoom-in.
                refit: !pannable() && Math.abs(view.scale - view.fitScale) < 1e-6,
            };
        } else {
            // The frame margin moves the window for the same reason the bar does, and it is
            // what makes the bar optional again: a spilling frame is now movable by any of
            // its four sides rather than by the bar alone.
            const onFrame = onBar || (reg && reg.kind === 'move');
            const mode = onFrame || !pannable() ? 'move' : 'pan';
            drag = { x: e.clientX, y: e.clientY, mode: mode, dist: 0 };
        }
        box.classList.add('drag');
    }

    // A corner or an edge drag. `ex`/`ey` name which edges are being pulled, and either may
    // be null — that is what makes an edge a one-axis version of a corner rather than a
    // separate gesture.
    //
    // Aspect is locked to the frame as it was at GRAB TIME — locking it to the picture's
    // shape instead would snap the frame the instant it was touched — and Shift frees it.
    // The lock is what makes an edge drag useful rather than a way to grow grey bars: pull
    // the right edge and the frame widens AND heightens, staying the shape it was. Freed,
    // an edge drag changes one dimension only, which is what you want on a spilling frame
    // being used as an aperture.
    //
    // On the axis NOT being dragged, the frame grows about its centre. Anchoring that axis
    // to its top or left instead would make the window crawl diagonally while you pull one
    // edge straight.
    //
    // What happens to the PICTURE depends on whether it was already spilling, which keeps
    // one gesture honest in both cases: a picture at fit stays at fit, so the window gets
    // bigger and so does the picture, and a picture already zoomed in keeps its zoom and
    // simply shows more of itself.
    function resizeBy(e) {
        const g = growBox();
        let w = drag.w0, h = drag.h0;
        if (drag.ex) w = drag.w0 + (drag.ex === 'r' ? 1 : -1) * (e.clientX - drag.x0);
        if (drag.ey) h = drag.h0 + (drag.ey === 'b' ? 1 : -1) * (e.clientY - drag.y0);
        if (!e.shiftKey && drag.aspect > 0) {
            if (!drag.ey) h = w / drag.aspect;                                  // vertical edge
            else if (!drag.ex) w = h * drag.aspect;                             // horizontal edge
            else if (Math.abs(w - drag.w0) >= Math.abs(h - drag.h0)) h = w / drag.aspect;
            else w = h * drag.aspect;
        }
        w = Math.max(MIN_FRAME, Math.min(w, g.w));
        h = Math.max(MIN_FRAME, Math.min(h, g.h));
        if (drag.ex === 'l') view.left = drag.l0 + (drag.w0 - w);
        else if (!drag.ex) view.left = drag.l0 - (w - drag.w0) / 2;
        if (drag.ey === 't') view.top = drag.t0 + (drag.h0 - h);
        else if (!drag.ey) view.top = drag.t0 - (h - drag.h0) / 2;
        view.fixedW = w;
        view.fixedH = h;
        view.fitScale = fitScaleFor(view.natW, view.natH);
        if (drag.refit) view.scale = view.fitScale;
        reflow();
        layout();
    }

    function onPinKey(e) {
        if (!placed || !view) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave browser/page chords alone
        const step = e.shiftKey ? cfg.panStep * 3 : cfg.panStep;
        let handled = true;
        switch (e.key) {
            case 'Escape': unplace(); break;
            case 'ArrowLeft': panBy(step, 0); break;
            case 'ArrowRight': panBy(-step, 0); break;
            case 'ArrowUp': panBy(0, step); break;
            case 'ArrowDown': panBy(0, -step); break;
            case '+': case '=': zoomCentre(view.scale * KEY_ZOOM); break;
            case '-': case '_': zoomCentre(view.scale / KEY_ZOOM); break;
            case '0': zoomCentre(view.fitScale); break;
            default: handled = false;
        }
        if (handled) { e.preventDefault(); e.stopPropagation(); }
    }

    // A wheel over a PLACED window is the window's; anywhere else, and in every other state,
    // it is the page's. What it does is decided by reflow(), not here: while the frame is
    // still free it grows with the picture, and once a move has frozen it the picture spills
    // inside it.
    //
    // The listener is only bound while placed, so the `placed` test is belt and braces
    // against a stray wheel arriving between place() and unplace().
    function onPinWheel(e) {
        if (!view || !placed) return;
        if (!pointInPreview(e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
        const f = 1 + cfg.wheelZoomStep / 100;
        zoomAt(view.scale * (e.deltaY < 0 ? f : 1 / f), e.clientX, e.clientY);
    }

    // ------------------------------------------------------------- interaction

    let active = null;      // element currently zoomed or pending
    let activeShown = null; // what that element was displaying — the second URL ⊘ blocks
    let token = null;       // cancellation token for the in-flight resolve
    let timer = null;
    let drag = null;        // { mode:'pan'|'move'|'resize', … } while a button is held
    // The press that places a window also produces a click, and by then the backdrop is
    // catching — so without this the window would be dismissed by the very gesture that
    // placed it, or the click would reach a link on the page. Set when a press is claimed,
    // consumed by the next click, cleared by any press we do not claim.
    let swallowNextClick = false;
    let suppressed = null;  // element whose preview was dismissed; skipped until re-entered
    // Whether `active` / `suppressed` were reached by looking THROUGH a cover. It changes
    // what "the pointer left the image" means: the pointer is never on the picture itself
    // in that case, so mouseout's element containment test — which is what makes a scan
    // across a row give one preview per image — cannot answer it and the stack has to.
    let activeCovered = false;
    let suppressedCovered = false;
    let swallowMenu = false;
    let pointer = { x: 0, y: 0 };
    let mouseDown = false;
    let modifierDown = false;

    // A press that wanders this far counts as MOVING the window, which is what freezes its
    // size (freezeSize). It no longer decides any state — a drag and a click both place the
    // window, on the press — so `justDragged` is gone with the state it used to pick.
    const MOVE_SLOP = 3;

    // There is no grace period on the hide any more, and no `hideTimer`. One existed so the
    // pointer could travel onto the preview before it vanished — which mattered only while
    // the preview was hit-testable. It is pointer-transparent now, so leaving the image is
    // unambiguous and the preview goes at once. That is what makes scanning a row of
    // thumbnails give one preview per thumbnail.

    // A hover preview cannot be hit-tested, so "is the pointer on it" is answered from
    // `view` instead. Outer rect: the frame plus its border, which is what layout() writes.
    function pointInPreview(x, y) {
        if (!view || !box || !box.classList.contains('on')) return false;
        const w = outerW();
        const h = outerH();
        return x >= view.left && x <= view.left + w && y >= view.top && y <= view.top + h;
    }

    function ours(node) {
        return !!host && (node === host || (host.contains && host.contains(node)));
    }

    function modifierHeld(e) {
        if (cfg.modifierKey === 'ctrl') return e.ctrlKey;
        if (cfg.modifierKey === 'alt') return e.altKey;
        if (cfg.modifierKey === 'shift') return e.shiftKey;
        return false;
    }

    // Images only, by design — so nothing that IS a media element or a plugin surface is a
    // candidate, whatever CSS background it happens to carry.
    const NEVER = { VIDEO: 1, AUDIO: 1, IFRAME: 1, CANVAS: 1, OBJECT: 1, EMBED: 1,
        SOURCE: 1, TRACK: 1 };

    // A video thumbnail is a plain <img>: at the DOM level there is nothing to tell it from
    // any other image, so three independent signals are used and any one is enough.
    //
    // 0. GEOMETRY — the element sits inside the rectangle of a laid-out <video>. Exact for
    //    a player surface of any shape; see overVideoSurface().
    // 1. STRUCTURE — a <video> in the element itself or in one of three ancestors. This
    //    catches players and the inline preview a card swaps in on hover. It is exact when
    //    it fires, but on a card whose player has not been injected yet it fires late or
    //    not at all, which is why (2) exists.
    // 2. THE LINK — the nearest ancestor <a href> pointing at something that is plainly a
    //    video. This is a heuristic and it is the one that can be wrong; it is bounded to
    //    unmistakable shapes and is switchable (`skipVideos`). The asymmetry favours it:
    //    a false positive costs one preview that will not open, a false negative is the
    //    reported bug — a preview covering the video you are trying to click.
    //
    // Three ancestors, not "walk to the top": querySelector on a high ancestor scans its
    // whole subtree, and this runs on every mouseover.
    const VIDEO_LINK_RE = new RegExp([
        'youtu\\.be/',
        '/watch\\?',
        '/shorts/',
        '/embed/',
        '/videos?/',
        '\\.(?:mp4|webm|m3u8|mov|mkv|avi)(?:$|[?#])',
    ].join('|'), 'i');

    // GEOMETRY — is this element sitting on top of a real, laid-out <video>? A player's
    // poster, its cued-thumbnail overlay and its endscreen images all occupy the same
    // rectangle as the <video> itself, so a containment test names them exactly, whatever
    // the DOM between them looks like. This is what the ancestor walk below cannot do on a
    // watch page: the player element holds the <video> AND several <img>, so the "still one
    // card" bound ends the walk before the video test is ever reached, and a preview opens
    // over the video you were trying to click. Reported on YouTube video pages.
    //
    // A zero-sized <video> (the 1x1 fixture in test case 18, a player not yet laid out)
    // contains nothing, so this cannot poison a page the way an unbounded walk does.
    // THE VIDEO'S OWN RECTANGLE IS NOT ALWAYS WHERE THE PLAYER APPEARS. Measured on a
    // LibreWolf YouTube watch page in the cued (not-yet-playing) state, 2026-09-03:
    //
    //     poster overlay   0,56   1903×798     (top 56, bottom 854)
    //     <video>          0,-742 1903×798     (top -742, bottom 56)
    //
    // The video is laid out exactly its own height ABOVE the player — touching the poster's
    // top edge, overlapping it nowhere. Testing the poster against the video's rect missed by
    // precisely 798px, the gate reported "not a video", and the poster previewed. Chrome puts
    // the video where the player is and never showed this.
    //
    // So the surface to test against is the player BOX, not the video element: the nearest
    // ancestors of the <video> that the video substantially FILLS. On a watch page that is
    // 100% of the player container, which is exactly the poster's rectangle. On a page whose
    // only video is a small one in a grid, the video fills ~0% of the grid, so the walk stops
    // at once — that fill test is what stops one <video> anywhere on a page from suppressing
    // every image on it, and it is why the walk can be anchored at the video rather than
    // needing the "still one card" img bound that the ancestor walk below uses.
    const PLAYER_UP = 3;
    const PLAYER_FILL = 0.5;

    // A <video> on the page is not by itself a reason to suppress anything — it depends
    // entirely on which of two kinds it is, and they behave nothing alike.
    //
    //   A PLAYER. A site dedicated to video: a listing page, and behind each entry a page
    //   holding one player with a play button, a volume slider, a quality menu. A preview
    //   opening over that covers the thing you are trying to click, which is the reported
    //   bug every gate below exists to stop.
    //
    //   A GIF. Imgur's gallery, gifwow's grid: a wall of short muted clips ALREADY PLAYING,
    //   no controls, nothing to click but the link underneath — they are animated pictures
    //   that happen to be encoded as video, and the page they sit on is an ordinary picture
    //   page where previews belong. (Clicking one leads to a player page; that page is the
    //   first kind and is still refused.)
    //
    // Four properties are required together, because every one of them alone has a false
    // positive: `controls` is false on YouTube too (it draws its own chrome), `muted` is
    // true of any player started under an autoplay policy, and `autoplay`/`loop` say
    // nothing about length. The DURATION is what carries the argument — a clip that loops
    // in under a minute is not something you sit and watch — and an UNKNOWN duration
    // (metadata not in yet, a cued player that has never been started) reads as PLAYER,
    // which is the safe direction to be wrong in: it costs one preview that does not open,
    // where the other direction covers the video you were reaching for.
    //
    // What this deliberately does NOT try to do is judge the destination. A muted, playing,
    // controls-less clip on a video site's listing page is pixel-for-pixel the imgur shape
    // and nothing in the DOM separates them; the ancestor-link gate below is the only
    // signal left for that case, and it stays.
    const GIF_MAX_SECS = 60;

    function gifLike(v) {
        if (v.controls || v.hasAttribute('controls')) return false;
        if (!v.muted) return false;
        if (!(v.loop || v.autoplay)) return false;
        const d = v.duration;
        return isFinite(d) && d > 0 && d <= GIF_MAX_SECS;
    }

    // The first non-gif <video> inside `n`, or null. Used instead of querySelector('video')
    // wherever "is there a player here" is the question being asked.
    function playerIn(n) {
        if (!n || !n.querySelectorAll) return null;
        const vs = n.querySelectorAll('video');
        for (let i = 0; i < vs.length; i++) if (!gifLike(vs[i])) return vs[i];
        return null;
    }

    function videoSurfaces() {
        const out = [];
        const vids = document.getElementsByTagName('video');
        for (let i = 0; i < vids.length; i++) {
            const v = vids[i].getBoundingClientRect();
            if (v.width < 2 || v.height < 2) continue;   // not laid out; contains nothing
            // Listed, so the debug log still accounts for every video on the page, but
            // flagged: a gif suppresses nothing and gets no player box derived from it.
            if (gifLike(vids[i])) { out.push({ what: 'gif (not a player)', rect: v, gif: true }); continue; }
            out.push({ what: 'video', rect: v });
            const area = v.width * v.height;
            let n = vids[i].parentElement;
            for (let up = 0; n && up < PLAYER_UP; up++, n = n.parentElement) {
                const r = n.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) continue;
                if (area < r.width * r.height * PLAYER_FILL) break;   // too big to be this video's player
                // An area test alone admits an oddly-shaped ancestor: a 40×7006 column passed
                // it against a 640×360 video during testing. A player box cannot be NARROWER
                // or SHORTER than the video it holds, whatever the area works out to. Skip and
                // keep climbing rather than stop — a wrapper can be odd while its parent is
                // the real player box. (1px of tolerance for sub-pixel layout.)
                if (r.width < v.width - 1 || r.height < v.height - 1) continue;
                out.push({ what: 'player box', rect: r });
            }
        }
        return out;
    }

    function holds(rect, cx, cy) {
        return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
    }

    function overVideoSurface(el) {
        const surfaces = videoSurfaces();
        if (!surfaces.length) return false;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        for (let i = 0; i < surfaces.length; i++) {
            if (surfaces[i].gif) continue;
            if (holds(surfaces[i].rect, cx, cy)) return true;
        }
        return false;
    }

    // closest() and parentElement both stop dead at a shadow-root boundary. A site that
    // builds its cards out of custom elements — YouTube's entire feed — can therefore put
    // the <img> inside a shadow root and the <a> that wraps it outside, and the link gate
    // below sees no link at all. This is the composed walk: ordinary closest() first, then
    // hop to the shadow host and keep going.
    function closestAcross(el, sel) {
        let n = el;
        while (n) {
            if (n.closest) {
                const hit = n.closest(sel);
                if (hit) return hit;
            }
            const root = n.getRootNode ? n.getRootNode() : null;
            n = root && root.host ? root.host : null;
        }
        return null;
    }

    // Returns WHY this element counts as video, or null. A string rather than a boolean
    // because the debug log prints it: when a preview opens over a video it should not have,
    // "which of the four gates fired, and what did the fourth one see" is the whole
    // question, and it can only be answered on the machine showing the bug.
    function videoReason(el) {
        if (el.closest && el.closest('video')) return 'inside a <video>';
        if (overVideoSurface(el)) return 'over a laid-out <video> rectangle';
        // Walk up only while the ancestor still looks like ONE card. The moment it holds
        // more than one image it is a grid or a page, and a <video> anywhere else in it
        // would poison every image on the page. Measured 2026-09-03: without this bound the
        // single 1×1 <video> fixture on the test page disabled all nineteen cases.
        let n = el;
        for (let up = 0; n && up < 4; up++, n = n.parentElement) {
            if (up > 0 && n.querySelectorAll && n.querySelectorAll('img').length > 1) break;
            if (playerIn(n)) return '<video> in ancestor #' + up;
        }
        const linked = videoLinkReason(el);
        if (linked) return linked;
        return null;
    }

    // Split out of videoReason() because a gif-style clip that is ITSELF the hover target
    // needs this gate and none of the others: it is trivially "inside a <video>" and sits
    // inside its own rectangle, so the structural and geometric tests self-match and would
    // refuse every clip on every page. The link is the one signal that still means
    // something there — it is what separates a wall of animations from a video site's
    // listing page, where the clips look identical and previews are not wanted.
    function videoLinkReason(el) {
        const a = closestAcross(el, 'a[href]');
        const href = a ? (a.getAttribute('href') || '') : '';
        if (href && VIDEO_LINK_RE.test(href)) return 'video link: ' + href;
        return null;
    }

    function inVideoContext(el) {
        return !!videoReason(el);
    }

    // PAGE FURNITURE — a CSS background that is part of the page rather than a picture on
    // it. Returns WHY, or null, for the same reason videoReason() does: the decision is a
    // read of the user's own DOM and a silent exclusion is the worst kind of bug here — a
    // wrongly-skipped image just stops previewing, with nothing on screen to say so.
    //
    // Every test below is a MEASUREMENT, not a guess at intent. Deliberately absent: class
    // and id matching (/hero|banner|bg|masthead/), filename patterns, and "require a
    // positive signal before previewing" — those are the guesses, and this script's whole
    // premise is that it decides nothing before hover time and keeps no allowlist.
    //
    // NOTE these apply to CSS backgrounds ONLY, never to an <img>. A full-width <img>, an
    // <img> with text over it, an <img> in a header — those are all ordinary shapes for a
    // picture that is genuinely the content, and the reported bug ("blank space previews
    // the tile") is a background bug.
    const BAND_WIDTH = 0.98;    // of the viewport — a full-bleed band reaches both edges
    const CONTENT_CHARS = 40;   // text this long is a paragraph, not a tile's caption

    function wallpaperReason(el) {
        if (el === document.body || el === document.documentElement) return 'the page background';
        const s = getComputedStyle(el);
        // Does not scroll with the page. A parallax or fixed backdrop is decoration by
        // construction — a picture you are meant to look at moves with the text beside it.
        if (s.backgroundAttachment.indexOf('fixed') >= 0)
            return 'background-attachment: fixed — it does not scroll with the page';
        // Laid end to end. `background-repeat: repeat` alone does NOT mean tiled — it is the
        // CSS default, so a hero with `background-size: cover` computes to it too and would
        // be caught (test case 9 is exactly that shape). It is repeat AND an auto size
        // together that mean the image is being stepped across the element at natural size.
        if (!/no-repeat/.test(s.backgroundRepeat) && /^auto/.test(s.backgroundSize))
            return 'tiled end to end';
        const r = el.getBoundingClientRect();
        // Full-bleed band: masthead, hero, section stripe, footer. 98% rather than something
        // looser because a gallery tile inside a centred container never reaches the window
        // edges, while a band does by definition. (clientWidth is 0 in a hidden Browser pane,
        // hence the guard — without it every element would span a zero-width viewport.)
        const vw = document.documentElement.clientWidth;
        if (vw > 0 && r.width >= vw * BAND_WIDTH) return 'spans the full width of the page';
        // The page's own content is sitting ON it, so it is a backdrop, not a picture. The
        // threshold keeps a tile's caption ("Sunset, 2019") from counting; a hero carries
        // real copy. Only reachable by hovering the element's own blank space, since the
        // text itself is a different element and hit-tests first.
        if ((el.textContent || '').trim().length >= CONTENT_CHARS)
            return 'the page\'s own text sits on it';
        return null;
    }

    // THE PICTURE ACROSS THE TOP OF THE PAGE. A channel banner, a forum masthead, a site
    // header image — an <img>, so none of the background rules above can see it, and often
    // linked and often rotated daily so the never-preview list cannot hold it either.
    //
    // Measured on youtube.com/@TheOnion, 2026-09-03: `<img>` 1193×192 at 56 px from the top
    // of the document, natural 1707×282, inside `#page-header-banner`. Nothing usable in
    // the markup — no role, no aria-hidden, and alt="" is on every image YouTube renders
    // including the video thumbnails, so it separates nothing. The geometry is all there is.
    //
    // FOUR conditions, and each of the last three exists to kill a false positive that can
    // be named. Together they flagged exactly one of the 24 images on that page.
    //
    //  1. Its top is within BANNER_TOP of the top of the DOCUMENT — above where a page's
    //     content begins. Document, not viewport: scrolled down, an ordinary picture would
    //     otherwise drift into the band.
    //  2. At least BANNER_MIN wide on screen. Kills logos, avatars (YouTube's is 160 px and
    //     sits at 282), and every icon.
    //  3. NO PEER SITS BESIDE IT. A picture with a comparable one to its left or right is
    //     one item in a row — a gallery's first row is near the top of the document and can
    //     be wide, and this is what saves it. A banner is a band; it is alone on its line.
    //     PEER, not "anything": measured in LibreWolf on the YouTube page with the left
    //     guide open, a **24 px** subscription avatar sits in the band beside a 1284 px
    //     banner and defeated this outright. An icon in a sidebar is not an item in a row
    //     with a masthead. `BESIDE_PEER` is the floor, deliberately low (a quarter) so that
    //     a masonry row of unequal tiles still protects its own widest member.
    //  4. FEWER THAN `BANNER_SET_MIN` OTHER PICTURES ON THE PAGE ARE ITS WIDTH. Saves a
    //     single-column gallery, where (3) is useless: tiles in a column are all the same
    //     width, and a banner is unique. Ten per cent counts as the same width.
    //     TWO PICTURES ARE NOT A SET. A column has many members; a page with a masthead and
    //     one other picture of the same width has a coincidence. Measured 2026-09-04 on the
    //     reported forum: a 1000×557 masthead with exactly one other 1000px picture on the
    //     page, and this condition alone kept it previewing. Note the residual cost — a page
    //     whose first two pictures are stacked, wide, and near the top loses the first.
    //     This is the weakest of the four conditions and the only one invented defensively
    //     rather than measured; narrow it further before adding anything to it.
    //
    // The page-wide scan is only reached once (1) and (2) hold, so it costs nothing on an
    // ordinary hover — a large picture at the very top of the document is rare.
    //
    // Unlike the background rules this DOES apply to an <img>, which is a deliberate
    // narrowing of "a full-width photo is still a photo": that stays true of a photo in the
    // body of a page, and stops being true of the one thing above all the content that is
    // as wide as the page and resembles nothing else on it.
    const BANNER_TOP = 200;         // px from the top of the document
    const BANNER_MIN = 400;         // px wide on screen
    const BANNER_SIMILAR = 0.1;     // widths within 10% are "the same width"
    const BESIDE_PEER = 0.25;       // a neighbour this fraction of the width is an item in a row
    const BANNER_SET_MIN = 2;       // this many OTHER pictures of one width make it a set

    // Returns WHICH condition decided and the numbers it decided on, for both answers.
    // A bare "not a banner" is useless in a bug report — the whole class of report this
    // exists for is "it works in your browser and not in mine", where the only thing that
    // can settle it is the operands the gate actually saw on the machine showing the bug.
    // Same rule as the video log: print the operands, not a summary of one of them.
    // A PICTURE NOBODY CAN SEE IS NOT BESIDE ANYTHING, AND IS NOT A MEMBER OF A SET.
    //
    // `opacity: 0` and `visibility: hidden` both leave a full-size rectangle behind, so a
    // zero-size filter does not catch them. That matters here more than anywhere else,
    // because the elements this gate judges are BANNERS and a rotating banner is very often
    // a cross-fader: two stacked <img> of identical size, one fading out. Different URLs, so
    // the same-src exemption below misses it, and the page then holds "two 1000px pictures"
    // while showing one — which is exactly what a user looking at their own page will
    // (correctly) tell you is impossible.
    //
    // Called lazily, only for a picture that would otherwise count, so the computed-style
    // read happens once or twice rather than for every image on the page.
    function reallyVisible(n) {
        if (n.checkVisibility)
            return n.checkVisibility({ opacityProperty: true, visibilityProperty: true });
        const s = getComputedStyle(n);
        if (s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false;
        // opacity does not inherit, so a faded WRAPPER leaves the image's own opacity at 1.
        let p = n.parentElement;
        for (let up = 0; p && up < 4; up++, p = p.parentElement) {
            if (parseFloat(getComputedStyle(p).opacity) < 0.05) return false;
        }
        return true;
    }

    function bannerCheck(el) {
        const r = el.getBoundingClientRect();
        const w = Math.round(r.width);
        const docTop = Math.round(r.top + (window.scrollY || 0));
        const where = w + '×' + Math.round(r.height) + ' at ' + docTop + 'px from the top of the document';
        if (r.width < BANNER_MIN || r.height < 2)
            return { banner: false, why: where + '; a banner is at least ' + BANNER_MIN + 'px wide' };
        if (docTop > BANNER_TOP)
            return { banner: false, why: where + '; a banner starts within ' + BANNER_TOP + 'px of the top' };
        const src = shownUrl(el) || '';
        const lists = [document.getElementsByTagName('img'), document.getElementsByTagName('video')];
        // BOTH blockers are collected rather than returning on the first. A log that names
        // only the first failing condition costs a round trip every time the next one also
        // fails — which is exactly what happened between v0.24.0 and this version.
        let beside = 0;
        const sameWidth = [];
        for (let l = 0; l < lists.length; l++) {
            for (let i = 0; i < lists[l].length; i++) {
                if (beside && sameWidth.length >= BANNER_SET_MIN) break;
                const n = lists[l][i];
                if (n === el) continue;
                const q = n.getBoundingClientRect();
                if (q.width < 2 || q.height < 2) continue;
                // A COPY OF ITSELF IS NOT A SIBLING ITEM. Banners are routinely rendered
                // twice — a blurred backdrop behind the sharp one, or a low-res placeholder
                // left in the tree — and the copy is by definition the same width, which
                // would defeat the uniqueness test with the banner's own reflection.
                if (src && (shownUrl(n) || '') === src) continue;
                let vis = null;
                const onScreen = function () {
                    if (vis === null) vis = reallyVisible(n);
                    return vis;
                };
                const mid = q.top + q.height / 2;
                if (!beside && q.width >= r.width * BESIDE_PEER &&
                    mid >= r.top && mid <= r.bottom && (q.right <= r.left || q.left >= r.right) &&
                    onScreen())
                    beside = q.width;
                if (Math.abs(q.width - r.width) <= r.width * BANNER_SIMILAR && onScreen())
                    // WHERE it is, not just that it exists. "another picture is 1000px wide
                    // too" cost a whole round trip on 2026-09-04 — whether that neighbour is
                    // a column-mate below or a second masthead is the entire question, and
                    // the width alone cannot answer it.
                    sameWidth.push(Math.round(q.width) + 'px at x=' + Math.round(q.left) +
                        ', ' + Math.round(q.top + (window.scrollY || 0)) + 'px down');
            }
        }
        const blockers = [];
        if (beside) blockers.push('a ' + Math.round(beside) + 'px picture sits beside it, so this ' +
            'is one item in a row');
        if (sameWidth.length >= BANNER_SET_MIN) blockers.push(sameWidth.length + ' other pictures ' +
            'share its width (' + sameWidth.join('; ') + '), so this is one of a set');
        if (blockers.length) return { banner: false, why: where + ', but ' + blockers.join('; and ') };
        return { banner: true, why: where + ', alone on its line, and ' + (sameWidth.length
            ? sameWidth.length + ' other picture(s) share its width (' + sameWidth.join('; ') +
              '), which is under the ' + BANNER_SET_MIN + ' that would make it a set'
            : 'no other picture on the page is its width') };
    }

    function bannerReason(el) {
        const c = bannerCheck(el);
        return c.banner ? c.why : null;
    }

    // What the page itself says is not content. ARIA is the one place an author states this
    // outright rather than us inferring it, so it is worth reading — but only on the element
    // itself, never inherited: carousels routinely mark cloned slides aria-hidden, and those
    // are real pictures a user can see and will hover.
    //
    // `alt=""` is NOT used, though it is the same convention. Too many sites ship real
    // content images with an empty or missing alt for it to be safe, and the cost of being
    // wrong is a picture that silently never previews.
    function decorativeReason(el) {
        if (!el.getAttribute) return null;
        if (el.getAttribute('aria-hidden') === 'true') return 'aria-hidden="true"';
        const role = (el.getAttribute('role') || '').toLowerCase();
        if (role === 'presentation' || role === 'none') return 'role="' + role + '"';
        return null;
    }

    // THE PICTURE UNDER A LID. A card whose whole face is covered by an absolutely
    // positioned <a>, a caption layer, a hover overlay or a click-catcher hands us that
    // cover as the hover target, and the picture beneath is never considered — gifwow's
    // grid, measured 2026-09-03: `figcaption > a[href="/go/…"]`, 393x510, exactly over the
    // <img> it belongs to. Nothing about that is site-specific; it is one of the most
    // common ways a thumbnail grid is built.
    //
    // Two bounds, and the second is the one that keeps this from being dangerous:
    //
    //  - ONLY an <img> or <video> is picked up this way, never a CSS background. Reaching
    //    down through a paragraph onto the section behind it is precisely the hero/backdrop
    //    case the gates above exist to refuse, and "content is stacked on top of it" is the
    //    signal that it IS a backdrop. The same fact means opposite things for the two, and
    //    which element type it is, is what separates them.
    //  - SAME CARD: an ancestor of the cover, within COVER_UP levels, that holds the
    //    picture and holds only that one laid-out picture. This is the "still one card"
    //    bound the video gate already uses. Without it the walk reaches the grid or the
    //    page and a full-page backdrop <img> — or an arbitrary neighbour — becomes the
    //    answer to hovering anything.
    //
    // Hidden media does not count toward that one: gifwow's grid item also holds a
    // `display:none` loader <img>, and counting it would bound the walk one level too early.
    const COVER_UP = 4;

    function laidOutMedia(n) {
        if (!n.querySelectorAll) return 0;
        const all = n.querySelectorAll('img,video');
        let seen = 0;
        for (let i = 0; i < all.length; i++) {
            const r = all[i].getBoundingClientRect();
            if (r.width >= 2 && r.height >= 2) seen++;
        }
        return seen;
    }

    function coveredMedia(el, x, y) {
        if (!document.elementsFromPoint) return null;
        const stack = document.elementsFromPoint(x, y);
        const under = [];
        let below = false;
        for (let i = 0; i < stack.length; i++) {
            if (!below) { if (stack[i] === el) below = true; continue; }
            if (stack[i].tagName === 'IMG' || stack[i].tagName === 'VIDEO') under.push(stack[i]);
        }
        if (!under.length) return null;
        let n = el;
        for (let up = 0; n && up <= COVER_UP; up++, n = n.parentElement) {
            if (laidOutMedia(n) > 1) return null;    // a grid or a page, not a card
            for (let i = 0; i < under.length; i++) if (n.contains(under[i])) return under[i];
        }
        return null;
    }

    // `x`/`y` are the pointer, and are what makes the cover walk possible; called without
    // them this is the plain element test and nothing is looked through.
    function eligible(el, x, y) {
        const direct = eligibleDirect(el);
        if (direct) return direct;
        if (!cfg.hoverThroughOverlays || typeof x !== 'number') return null;
        const under = coveredMedia(el, x, y);
        // The picture found under the lid faces every gate the lid did — video, blocked,
        // decorative — so looking through a cover can never reach something a direct hover
        // would have refused.
        return under ? eligibleDirect(under) : null;
    }

    function eligibleDirect(el) {
        if (!el) return null;
        // A PLAYING GIF IS THE PICTURE. On imgur's gallery and gifwow's grid the animation
        // in the grid is a <video> element, so the thing under the pointer is not an <img>
        // at all and `NEVER` below refused it outright — hovering a gif did nothing, no
        // preview and no spinner, while every still beside it worked. That was the whole of
        // "it does not work on gifs": v0.18.0 taught the FRAME to show video and v0.19.0
        // taught the resolver to ask the linked page, but the entry point stayed shut, so
        // neither could ever be reached from the one element that needed them.
        //
        // Only a gif-like clip, and only the link gate applies to it — see videoLinkReason()
        // for why the other three video tests cannot be used on a video. A real player is
        // still refused, so a watch page is unaffected.
        if (el.tagName === 'VIDEO') {
            if (!cfg.playVideos || !gifLike(el)) return null;
            if (cfg.skipVideos && videoLinkReason(el)) return null;
            return blocked(shownUrl(el)) ? null : el;
        }
        if (NEVER[el.tagName]) return null;
        if (cfg.skipVideos && inVideoContext(el)) return null;
        if (cfg.skipDecorative && decorativeReason(el)) return null;
        // Before the <img> branch, because this is the one furniture rule that applies to one.
        if (cfg.skipBanners && bannerReason(el)) return null;
        if (el.tagName === 'IMG') return blocked(shownUrl(el)) ? null : el;
        // element with a background image and no img of its own
        if (el.querySelector && el.querySelector('img')) return null;
        const bg = backgroundUrl(el);
        if (!bg || blocked(bg)) return null;
        if (cfg.skipPageBackgrounds && wallpaperReason(el)) return null;
        return el;
    }

    // One console line per hover, when `debug` is on. Every field is something that differs
    // between browsers or between installs, and that nothing on screen reveals: which gate
    // decided, whether an ancestor link was findable at all, whether the element is inside a
    // shadow root, and how many laid-out <video> elements the page is offering.
    function hoverReport(t, el) {
        const a = closestAcross(t, 'a[href]');
        const rect = t.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        // POSITIONS, not just sizes. The first version of this printed `1903×798` for the
        // page's video and left the real question unanswerable: gate 0 compares the
        // element's centre against the video's RECTANGLE, so a video of exactly the right
        // size sitting somewhere else entirely looks identical in the log to one sitting
        // under the pointer. Each entry now says whether it contains the centre, so the
        // gate's own verdict is readable rather than inferred.
        // The SURFACES actually tested, derived player boxes included — not the raw <video>
        // list. Printing the raw list was what hid this bug for a round: the one video on the
        // page had exactly the right size, so nothing in the log looked wrong.
        const sizes = videoSurfaces().map(function (s) {
            return s.what + ' ' + rectStr(s.rect) +
                (s.gif ? ' [ignored: muted, no controls, short loop — suppresses nothing]'
                    : holds(s.rect, cx, cy) ? ' [CONTAINS the pointer target]'
                        : ' [does not contain it]');
        });
        const cls = typeof t.className === 'string' ? t.className.trim() : '';
        return {
            target: t.tagName + (t.id ? '#' + t.id : '') +
                (cls ? '.' + cls.split(/\s+/).slice(0, 2).join('.') : ''),
            targetRect: rectStr(rect),
            showing: (shownUrl(t) || '(nothing)').slice(0, 160),
            eligible: !!el,
            // Which element the preview is actually FOR. Not always the hover target: a
            // cover over a card hands us the lid, and the answer is the picture under it.
            resolvedFrom: !el ? '(nothing)'
                : el === t ? 'the hover target itself'
                    : 'looked through the cover to ' + el.tagName +
                      (el.id ? '#' + el.id : '') + ' — ' + (shownUrl(el) || '').slice(0, 120),
            skipVideos: cfg.skipVideos,
            videoGate: videoReason(t) || 'none — NOT treated as video',
            // Only meaningful for an element that HAS a CSS background image — an <img> is
            // never page furniture, and reporting a reason for an element with no background
            // at all reads as a gate that fired when nothing was ever tested.
            backgroundGate: t.tagName === 'IMG' || t.tagName === 'VIDEO' ? 'n/a — not a background'
                : !backgroundUrl(t) ? 'n/a — no background image'
                    : (wallpaperReason(t) || 'none — NOT treated as page furniture'),
            decorativeGate: decorativeReason(t) || 'none — not marked decorative',
            // `el || t`, not `t`: when a cover was looked through (E18) the gate judged the
            // picture underneath, and reporting the lid's geometry instead would describe an
            // element no decision was made about.
            bannerGate: (function () {
                const c = bannerCheck(el || t);
                return (c.banner ? 'BANNER, refused: ' : 'not a banner: ') + c.why;
            })(),
            videosOnPage: sizes.length ? sizes.join(', ') : 'none',
            ancestorLink: a ? (a.getAttribute('href') || '(empty href)').slice(0, 160)
                : 'NO <a href> ancestor, even across shadow roots',
            inShadowRoot: !!(t.getRootNode && t.getRootNode() !== document),
        };
    }

    function sizeOf(el) {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
    }

    function cancel() {
        if (placed) return;         // a placed viewer outlives hover entirely
        clearTimeout(timer);
        if (token) token.cancelled = true;
        token = null;
        active = null;
        activeCovered = false;
        activeShown = null;
        drag = null;
        disableWheelZoom();
        resetBar();
        hideSpinner();
        hideViewer();
    }

    // ---- pin / dismiss, and the switch that swaps which button does which
    //
    // Dismiss is for "the preview is in my way but my cursor is staying on this image":
    // it takes the preview down and keeps it down until the pointer actually leaves the
    // element and comes back. Without `suppressed` the next mousemove would just re-show
    // it, which is the whole reason Escape alone was not enough.

    function dismiss() {
        suppressed = active;            // read it before unplace()/cancel() clear it
        suppressedCovered = activeCovered;
        if (placed) unplace(); else cancel();
    }

    // The button that does NOT place. Returns true when it acted, which is the signal to
    // swallow the context menu that a right press is about to raise.
    //
    // A PLACED window deliberately does NOT act on the right button, so the browser raises
    // its own context menu over our <img> — whose src is the resolved full-size URL. That is
    // the only way "Save image as…" and "Copy image" work at all: ours ran in page
    // JavaScript and needed the host to send Access-Control-Allow-Origin, which most do not,
    // while the browser's use its own network stack and the bitmap it has already decoded.
    // Verified in a real browser 2026-09-03 — native chrome does target an <img> inside an
    // open shadow root, and Save gives the full-size file.
    //
    // So dismiss-by-button belongs to the HOVER preview alone, which has no choice: it is
    // pointer-transparent, so a native menu there would come up for the thumbnail underneath
    // and offer to save *that*. A placed window is dismissed with the X, Escape, or a click
    // outside it.
    function altButton(e) {
        if (placed) return false;       // hands the press to the browser; see above
        if (!active && !view) return false;
        dismiss();
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 2) swallowMenu = true;
        return true;
    }

    function overOurs(e) {
        if (ours(e.target)) return true;
        if (pointInPreview(e.clientX, e.clientY)) return true;
        return !!active && (active === e.target || (active.contains && active.contains(e.target)));
    }

    // One place, so the mouseup path and the released-outside-the-window path cannot drift.
    function endDrag() {
        if (!drag) return;
        drag = null;
        if (box) box.classList.remove('drag');
    }

    function onMove(e) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        if (spinEl && spinEl.classList.contains('on')) moveSpinner();
        const over = !!view && !!box && box.classList.contains('on') &&
            pointInPreview(e.clientX, e.clientY);
        // The status bar comes back when the pointer moves OVER the window, and only then —
        // moving anywhere else lets it fade, which is the whole point of it. Geometry, not
        // ours(e.target): while a window is placed the backdrop is hit-testable across the
        // whole viewport, so ours() is true everywhere and the bar would never fade again.
        if (over) showBar();
        // Which region the pointer is in, said in the cursor. Only readable once placed — a
        // hover preview is pointer-transparent, so the page's own cursor is what shows
        // there, for the same reason the X and the ⊘ are absent from one.
        if (box && placed && !drag) {
            box.style.cursor = over && !(capEl && capEl.contains(e.target))
                ? regionCursor(hitRegion(e.clientX, e.clientY)) : '';
        }
        if (!drag || !view) return;
        // A drag OUTLIVES the frame's edges and the browser's: this listener is on
        // `document`, and while a button is held the browser keeps delivering mousemove with
        // coordinates outside the viewport, so a pan started inside carries on wherever the
        // pointer goes. What does NOT arrive is the mouseup, if the button is released out
        // there — so the drag would stay live and the picture would follow the pointer back
        // with no button held. `buttons` is the only thing that can notice.
        if (e.buttons === 0) { endDrag(); return; }
        if (drag.mode === 'resize') { resizeBy(e); return; }
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!dx && !dy) return;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (drag.mode === 'move') {
            // Moving it settles how big it should be. MOVE_SLOP so that a hand shaking
            // during a click does not count as putting it somewhere — the frame still
            // follows those first pixels, it just does not commit on them.
            drag.dist += Math.abs(dx) + Math.abs(dy);
            if (drag.dist > MOVE_SLOP) freezeSize();
            view.left += dx;
            view.top += dy;
            layout();       // clampPosition() keeps a grabbable strip of it on screen
        } else {
            panBy(dx, dy);
        }
    }

    function onOver(e) {
        if (placed) return;
        // A drag can outrun the frame it is moving; without this, the page elements
        // sliding under the pointer would cancel the very preview being dragged.
        if (drag) return;
        if (ours(e.target)) return;         // on our own overlay
        if (!cfg.enabled || !siteEnabled()) return;
        if (cfg.skipWhileMouseDown && mouseDown) return;
        if (cfg.activation === 'modifier' && !modifierHeld(e) && !modifierDown) return;

        const el = eligible(e.target, e.clientX, e.clientY);
        if (cfg.debug) dbg('hover', hoverReport(e.target, el));
        if (!el) {
            // moving onto the page background closes an open viewer — unless the picture is
            // still under the pointer, one layer down, which is the covered-card case again.
            if (active && !active.contains(e.target) &&
                !(activeCovered && stillUnderPointer(active, e.clientX, e.clientY))) cancel();
            return;
        }
        if (el === suppressed) return;      // dismissed; stays down until the pointer leaves
        if (el === active) return;

        cancel();
        const displayed = sizeOf(el);
        if (displayed.w < cfg.minDisplayed && displayed.h < cfg.minDisplayed) return;
        if (cfg.maxDisplayed > 0 && (displayed.w > cfg.maxDisplayed || displayed.h > cfg.maxDisplayed)) return;

        active = el;
        activeCovered = (el !== e.target);
        activeShown = shownUrl(el);
        const myToken = token = { cancelled: false };
        timer = setTimeout(async function () {
            showSpinner();
            try {
                await resolve(el, displayed, myToken,
                    function (hit) {
                        // First hit paints the preview; every later one is strictly bigger
                        // and replaces it in place, placed or not.
                        if (myToken.cancelled || active !== el) return;
                        if (view && box.classList.contains('on')) upgradeViewer(hit);
                        else { showViewer(hit, pointer); dockSpinner(); }
                    });
            } finally {
                // Off whatever the outcome — found, rejected, cancelled or thrown. A ring
                // still turning after the search stopped would be a lie.
                if (!myToken.cancelled) hideSpinner();
            }
        }, cfg.hoverDelay);
    }

    // Is the picture still under the pointer? Only asked of a preview that was found under
    // a cover, where the pointer is on the lid and never on the picture, so the containment
    // test below cannot answer it. Not used for a direct hover: at the exact boundary pixel
    // the stack still holds the image, which would hold the preview open a moment too long
    // and cost the one-preview-per-image scan across a row.
    function stillUnderPointer(el, x, y) {
        if (!el || !document.elementsFromPoint) return false;
        const stack = document.elementsFromPoint(x, y);
        for (let i = 0; i < stack.length; i++) if (stack[i] === el) return true;
        return false;
    }

    function onOut(e) {
        if (placed || drag) return;
        const to = e.relatedTarget;
        if (suppressed) {
            const inside = (to && suppressed.contains && suppressed.contains(to)) ||
                (suppressedCovered && stillUnderPointer(suppressed, e.clientX, e.clientY));
            // A covered picture is never the mouseout target itself, so the target test is
            // only right for a direct hover; the stack answers for the other.
            if (!inside && (suppressedCovered || e.target === suppressed)) {
                suppressed = null;  // left the image; hovering it again may preview again
                suppressedCovered = false;
            }
        }
        if (!active) return;
        if (to && active.contains && active.contains(to)) return;   // still inside the image
        // Under a lid, moving from one layer of the card to another — the cover anchor to
        // the caption to the badge — is not leaving the picture, and every such crossing
        // would otherwise close and reopen the preview.
        if (activeCovered && stillUnderPointer(active, e.clientX, e.clientY)) return;
        // Off the image — the preview goes at once, even though it is sitting under the
        // pointer. It cannot be hit-tested, so there is nothing to travel to and no reason
        // to wait, and this is what makes a scan across a row give one preview per image.
        cancel();
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);

    // A press on the preview is a MODAL gesture — pinning or dragging a window that is
    // floating over the page — so per ../CLAUDE.md it binds on CAP_TARGET (= window) in
    // capture, ahead of every document-level listener on the page and in sibling
    // userscripts. On a pointer-transparent hover preview the press really does land on the
    // page beneath, and a link there would otherwise be followed.
    CAP_TARGET.addEventListener('mousedown', function (e) {
        swallowNextClick = false;
        if (ours(e.target)) { claimClick(); return; }   // onBoxDown / the backdrop own this one
        // A HOVER preview is pointer-transparent, so a press ON it lands on the page beneath
        // and never reaches onBoxDown. Geometry decides ownership instead, and hands the
        // press to that same handler so there is still only one state machine.
        if (!placed && view && box && box.classList.contains('on') &&
            (e.button === 0 || e.button === 2) && pointInPreview(e.clientX, e.clientY)) {
            claimClick();
            onBoxDown(e);
            return;
        }
        // The right button has to be claimed here, not on contextmenu: mousedown fires
        // first, and letting it fall through to cancel() would clear `active` before the
        // menu event could see what to dismiss.
        if (e.button === 2 && overOurs(e) && altButton(e)) { claimClick(); return; }
        releaseClick();
        mouseDown = true;
        cancel();
    }, true);
    // The click half of the same handoff, and the reason placing on the PRESS needs one.
    // Between that press and its click the window becomes placed and the backdrop starts
    // catching, so the click lands on something new: on the backdrop, whose own handler
    // would dismiss the window that press just placed, or on the page, where it could
    // follow a link. Either way it is ours and it goes no further.
    CAP_TARGET.addEventListener('click', function (e) {
        if (swallowNextClick) {
            swallowNextClick = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        // The click that dismisses a placed window is caught HERE rather than being left to
        // the backdrop's own handler. The backdrop sits inside the shadow host, so capture
        // reaches document and body first, and a page listening for clicks there would see a
        // phantom one — nothing on the page can act on it, since the event's target is the
        // backdrop, but being observed at all is avoidable. composedPath()[0] because
        // `e.target` is retargeted to the host once the event leaves the shadow tree.
        if (dimEl && dimEl.classList.contains('catch') && e.composedPath &&
            e.composedPath()[0] === dimEl) {
            e.preventDefault();
            e.stopPropagation();
            dismiss();
            return;
        }
        if (ours(e.target)) return;             // onBoxClick owns it
        if (placed || !view || !box || !box.classList.contains('on')) return;
        if (!pointInPreview(e.clientX, e.clientY)) return;
        onBoxClick(e);
    }, true);
    CAP_TARGET.addEventListener('contextmenu', function (e) {
        if (!swallowMenu) return;
        swallowMenu = false;
        e.preventDefault();
        e.stopPropagation();
    }, true);
    document.addEventListener('mouseup', function () {
        mouseDown = false;
        endDrag();
    }, true);
    window.addEventListener('scroll', function () { if (!placed) cancel(); }, true);
    window.addEventListener('blur', function () { if (!placed) cancel(); });
    window.addEventListener('resize', function () {
        if (!placed) { cancel(); return; }
        if (!view) return;
        // The frame the user sized is left exactly as it is — re-fitting it to the new
        // window would throw away the size they chose. clampPosition() still runs, so a
        // window narrowed to nothing cannot leave the frame stranded off the edge.
        view.fitScale = fitScaleFor(view.natW, view.natH);
        const lo = minScaleFor(view.natW, view.natH);
        if (view.scale < lo) view.scale = lo;
        reflow();
        layout();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            cancel();                           // onPinKey has already handled the placed case
        }
        if (cfg.activation === 'modifier' && modifierHeld(e)) modifierDown = true;
    }, true);
    document.addEventListener('keyup', function (e) {
        if (cfg.activation === 'modifier' && !modifierHeld(e)) { modifierDown = false; cancel(); }
    }, true);

    // -------------------------------------------------------------- settings UI

    const C = { base: '#1e1e2e', surface: '#313244', surface2: '#45475a', text: '#cdd6f4',
        sub: '#a6adc8', blue: '#89b4fa', green: '#a6e3a1', red: '#f38ba8' };

    let panelHost = null;

    function closePanel() {
        if (panelHost) { panelHost.remove(); panelHost = null; }
    }

    function openPanel() {
        closePanel();
        // Always render from storage, never from this tab's in-memory copy — see
        // reloadSettings(). Without this, a long-lived tab shows stale values and saving
        // reverts whatever another tab changed in the meantime.
        reloadSettings();
        panelHost = document.createElement('div');
        panelHost.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
        const sr = panelHost.attachShadow({ mode: 'open' });

        const st = document.createElement('style');
        st.textContent = [
            ':host{all:initial}',
            '*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}',
            '.back{position:fixed;inset:0;background:rgba(0,0,0,.5)}',
            '.panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:520px;max-width:94vw;',
            'max-height:88vh;overflow:auto;background:' + C.base + ';color:' + C.text + ';border:1px solid ' + C.surface2 + ';',
            'border-radius:10px;padding:18px 20px;box-shadow:0 16px 48px rgba(0,0,0,.6);font-size:13px}',
            'h2{margin:0 0 14px;font-size:15px;font-weight:600;color:' + C.text + '}',
            'h3{margin:18px 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;',
            'letter-spacing:.06em;color:' + C.sub + ';border-bottom:1px solid ' + C.surface + ';padding-bottom:5px}',
            '.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0}',
            '.row label{flex:1;cursor:pointer}',
            '.hint{display:block;font-size:11px;color:' + C.sub + ';margin-top:1px}',
            'input[type=checkbox]{accent-color:' + C.blue + ';width:15px;height:15px;cursor:pointer;flex:none}',
            'input[type=number],input[type=text],select,textarea{background:' + C.surface + ';color:' + C.text + ';',
            'border:1px solid ' + C.surface2 + ';border-radius:5px;padding:4px 7px;font-size:12px}',
            'input[type=number]{width:74px}',
            'input[type=color]{width:40px;height:26px;padding:0;border:1px solid ' + C.surface2 + ';',
            'border-radius:5px;background:' + C.surface + ';cursor:pointer}',
            'textarea{width:100%;height:64px;resize:vertical;font-family:ui-monospace,monospace}',
            '.foot{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;padding-top:14px;',
            'border-top:1px solid ' + C.surface + '}',
            'button{background:' + C.surface + ';color:' + C.text + ';border:1px solid ' + C.surface2 + ';',
            'border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer}',
            'button:hover{background:' + C.surface2 + '}',
            'button.primary{background:' + C.blue + ';color:' + C.base + ';border-color:' + C.blue + ';font-weight:600}',
            'button.add{background:' + C.green + ';color:' + C.base + ';border-color:' + C.green + ';font-weight:600}',
            'button.danger{color:' + C.red + '}',
            '.listbtns{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}',
            // The list widget, matched to the one in Open Links in New Tab: a description,
            // an italic examples line, then input + Add + "+ This site" on one row, then the
            // entries as removable rows. Same shape, same colours, same button order — these
            // panels are read side by side, so a second dialect of the same control is a
            // cost with no benefit.
            '.listwrap{margin-top:4px}',
            '.listdesc{font-size:12px;color:#9399b2;line-height:1.45}',
            '.listex{margin-top:4px;color:#6c7086;font-style:italic}',
            '.addrow{display:flex;gap:6px;margin-top:8px}',
            '.addrow input[type=text]{flex:1;padding:6px 10px;border-radius:6px;font-size:13px}',
            '.addrow button{padding:6px 12px;border-radius:6px;border:none;font-weight:700;',
            'font-size:13px;white-space:nowrap}',
            '.addrow button.primary{background:' + C.blue + ';color:' + C.base + '}',
            '.addrow button.add{background:' + C.green + ';color:' + C.base + '}',
            '.entries{display:flex;flex-direction:column;gap:5px;margin-top:8px;',
            'max-height:150px;overflow-y:auto;padding-right:4px}',
            '.entry{display:flex;align-items:center;justify-content:space-between;gap:8px;',
            'background:' + C.surface + ';border-radius:6px;padding:6px 10px}',
            '.entry span{font-size:13px;word-break:break-all}',
            '.entry button{background:none;border:none;color:' + C.red + ';cursor:pointer;',
            'font-size:14px;padding:0 4px;flex:none}',
            '.entry button:hover{background:none;color:' + C.text + '}',
            '.empty{color:#6c7086;font-size:13px;text-align:center;padding:12px 0}',
        ].join('');
        sr.appendChild(st);

        const back = document.createElement('div');
        back.className = 'back';
        back.addEventListener('click', closePanel);
        sr.appendChild(back);

        const panel = document.createElement('div');
        panel.className = 'panel';
        sr.appendChild(panel);

        const h = document.createElement('h2');
        // The version is here so "which copy is installed in this browser" is answerable
        // without opening the manager. Read from GM_info, so it cannot drift from the header.
        h.textContent = 'Hover Zoom — settings  ·  ' + version();
        panel.appendChild(h);

        const controls = [];

        function section(title) {
            const s = document.createElement('h3');
            s.textContent = title;
            panel.appendChild(s);
        }

        function row(labelText, hintText, control) {
            const r = document.createElement('div');
            r.className = 'row';
            const l = document.createElement('label');
            l.textContent = labelText;
            if (hintText) {
                const hint = document.createElement('span');
                hint.className = 'hint';
                hint.textContent = hintText;
                l.appendChild(hint);
            }
            r.appendChild(l);
            r.appendChild(control);
            panel.appendChild(r);
            return r;
        }

        // A labelled row with no control — for behaviour that is always on and just needs
        // explaining.
        function note(labelText, hintText) {
            const r = document.createElement('div');
            r.className = 'row';
            const l = document.createElement('label');
            l.textContent = labelText;
            const hint = document.createElement('span');
            hint.className = 'hint';
            hint.textContent = hintText;
            l.appendChild(hint);
            r.appendChild(l);
            panel.appendChild(r);
        }

        function check(key, labelText, hintText) {
            const el = document.createElement('input');
            el.type = 'checkbox';
            el.checked = !!cfg[key];
            controls.push(function () { cfg[key] = el.checked; });
            row(labelText, hintText, el);
        }

        function num(key, labelText, hintText, min, max, step) {
            const el = document.createElement('input');
            el.type = 'number';
            el.value = cfg[key];
            el.min = min; el.max = max; el.step = step || 1;
            controls.push(function () {
                const v = parseFloat(el.value);
                if (!isNaN(v)) cfg[key] = v;
            });
            row(labelText, hintText, el);
        }

        function pick(key, labelText, hintText, opts) {
            const el = document.createElement('select');
            opts.forEach(function (o) {
                const op = document.createElement('option');
                op.value = o[0];
                op.textContent = o[1];
                if (cfg[key] === o[0]) op.selected = true;
                el.appendChild(op);
            });
            controls.push(function () { cfg[key] = el.value; });
            row(labelText, hintText, el);
        }

        // A list editor for one of the array settings, laid out the same way as the one in
        // Open Links in New Tab: description, examples, an add row (text field, Add, and an
        // optional "+ This site"), then the entries as rows you can remove one at a time.
        // It replaced a raw textarea in v0.16.0 — the two panels sit side by side in daily
        // use and were asking the user to learn the same list twice.
        //
        // Staging, not saving: entries live in a local array until Save, exactly like every
        // other control on this panel. That is the one deliberate difference from OLINT,
        // whose lists write straight through; changing it here would make Cancel a lie.
        function list(key, opts) {
            const items = cfg[key].slice();
            controls.push(function () { cfg[key] = items.slice(); });

            const wrap = document.createElement('div');
            wrap.className = 'listwrap';

            const desc = document.createElement('div');
            desc.className = 'listdesc';
            const descMain = document.createElement('div');
            descMain.textContent = opts.description;
            desc.appendChild(descMain);
            if (opts.examples) {
                const ex = document.createElement('div');
                ex.className = 'listex';
                ex.textContent = opts.examples;
                desc.appendChild(ex);
            }
            wrap.appendChild(desc);

            const addRow = document.createElement('div');
            addRow.className = 'addrow';

            const input = document.createElement('input');
            input.type = 'text';
            input.spellcheck = false;
            input.placeholder = opts.placeholder || '';

            const addBtn = document.createElement('button');
            addBtn.className = 'primary';
            addBtn.textContent = 'Add';

            addRow.appendChild(input);
            addRow.appendChild(addBtn);

            const entries = document.createElement('div');
            entries.className = 'entries';

            function render() {
                while (entries.firstChild) entries.removeChild(entries.firstChild);
                if (!items.length) {
                    const empty = document.createElement('div');
                    empty.className = 'empty';
                    empty.textContent = 'No entries yet.';
                    entries.appendChild(empty);
                    return;
                }
                items.forEach(function (item) {
                    const r = document.createElement('div');
                    r.className = 'entry';
                    const label = document.createElement('span');
                    label.textContent = item;
                    const rm = document.createElement('button');
                    rm.textContent = '✕';
                    rm.title = 'Remove ' + item;
                    rm.addEventListener('click', function () {
                        // Remove by VALUE, not by index: the rendered order and the stored
                        // order need not agree, and entries are unique because add() dedupes.
                        const at = items.indexOf(item);
                        if (at !== -1) items.splice(at, 1);
                        render();
                    });
                    r.appendChild(label);
                    r.appendChild(rm);
                    entries.appendChild(r);
                });
            }

            function add(raw) {
                const value = String(raw || '').trim();
                if (!value) return;
                if (items.indexOf(value) === -1) items.push(value);
                input.value = '';
                render();
                entries.scrollTop = entries.scrollHeight;
            }

            addBtn.addEventListener('click', function () { add(input.value); });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); add(input.value); }
            });

            if (opts.addCurrentLabel) {
                const cur = document.createElement('button');
                cur.className = 'add';
                cur.textContent = opts.addCurrentLabel;
                cur.title = opts.addCurrentTitle || '';
                cur.addEventListener('click', function () { add(opts.currentValue()); });
                addRow.appendChild(cur);
            }

            wrap.appendChild(addRow);
            wrap.appendChild(entries);
            panel.appendChild(wrap);
            render();

            return { items: items, clear: function () { items.length = 0; render(); } };
        }

        function listButtons(buttons) {
            const r = document.createElement('div');
            r.className = 'listbtns';
            buttons.forEach(function (b) {
                const el = document.createElement('button');
                if (b.cls) el.className = b.cls;
                if (b.title) el.title = b.title;
                el.textContent = b.label;
                el.addEventListener('click', b.onClick);
                r.appendChild(el);
            });
            panel.appendChild(r);
        }

        function color(key, labelText) {
            const el = document.createElement('input');
            el.type = 'color';
            el.value = cfg[key];
            controls.push(function () { cfg[key] = el.value; });
            row(labelText, null, el);
        }

        check('enabled', 'Enable Hover Zoom');

        section('When to zoom');
        pick('activation', 'Activation', 'Hold the key to arm zooming', [
            ['hover', 'On hover'], ['modifier', 'Only while a key is held']]);
        pick('modifierKey', 'Modifier key', null, [
            ['ctrl', 'Ctrl'], ['alt', 'Alt'], ['shift', 'Shift']]);
        num('hoverDelay', 'Hover delay', 'milliseconds before resolving', 0, 3000, 10);
        num('minDisplayed', 'Ignore images smaller than', 'px on screen — skips icons', 0, 2000, 1);
        num('maxDisplayed', 'Ignore images larger than', 'px on screen — 0 means no limit', 0, 10000, 1);
        num('minRatio', 'Required upsize', 'full size must be this many times the thumbnail', 1, 10, 0.1);
        check('showEvenIfNotLarger', 'Show even when not larger', 'display at natural size anyway');
        check('sameShapeOnly', 'Only upgrade to the same shape',
            'a bigger version of a picture has the same proportions. A candidate shaped ' +
            'nothing like the thumbnail — a 1200×125 banner answering with a 600×600 ' +
            'picture — is a different image, not a bigger one, which is what rotating ' +
            '“random image” endpoints on forums produce. The tolerance is loose (4×) so ' +
            'that a thumbnail cropped differently from its original still counts');
        check('keepSearching', 'Keep looking after the first hit',
            'shows the first match immediately, then upgrades the preview in place as bigger ' +
            'originals turn up — costs up to 8 requests per hover instead of usually one');
        check('skipVideos', 'Never preview videos',
            'skips media elements, anything with a player next to it, and images inside a ' +
            'link that plainly points at a video (/watch?, /shorts/, /embed/, /video/, ' +
            'youtu.be, .mp4 and friends) — turn off if it is skipping stills you want. ' +
            'A short muted clip already playing with no controls counts as an animated ' +
            'picture, not a player, so pages like Imgur’s gallery still preview normally');
        check('followLinks', 'Look at the linked page for the original',
            'when a thumbnail links to its own page on the same site, fetch that page and ' +
            'use whatever it declares as its media — the picture or clip you would have got ' +
            'by clicking through. It is taken as correct, so it is not size-checked. Costs ' +
            'one page request per link you hover, cached for the tab; the site sees that ' +
            'request. Same site only, never another domain');
        check('playVideos', 'Let the preview be a video',
            'some animated posts have no image form at all — an Imgur video post answers ' +
            '.jpg with a single frozen frame, and the moving original exists only as .mp4. ' +
            'With this on, the preview window plays it, muted and looping. Turn it off to ' +
            'keep previews to still pictures; you will get the frozen frame instead');
        check('hoverThroughOverlays', 'Look through covers',
            'many thumbnail grids lay an invisible link, a caption layer or a hover overlay ' +
            'across the whole card, so the pointer never reaches the picture at all. With ' +
            'this on, a cover with a single picture under it hovers that picture. Only ' +
            'reaches an <img> or a video, and only within the same card — never the page ' +
            'behind it');
        check('skipPageBackgrounds', 'Never preview page backgrounds',
            'CSS background images that are part of the page rather than pictures on it: ' +
            'the page\'s own background, one tiled end to end, one fixed so it does not ' +
            'scroll, one spanning the full width of the window, and one the page\'s own ' +
            'text is sitting on. Never applies to an <img> — a full-width photo with a ' +
            'caption over it is still a photo');
        check('skipBanners', 'Never preview the banner across the top of a page',
            'a channel banner, a forum masthead, a site header image. Recognised by shape ' +
            'rather than by name: it sits above where the page\'s content begins, is at ' +
            'least 400px wide, has nothing beside it, and no other picture on the page is ' +
            'its width. The last two are what keep a gallery\'s first row — and a ' +
            'single-column gallery — out of it. This is the only rule of its kind that ' +
            'applies to an <img> as well as to a background');
        check('skipDecorative', 'Skip images the page marks as decoration',
            'aria-hidden="true" and role="presentation" are the page saying outright that ' +
            'something is not content. Read only on the image itself, never inherited — ' +
            'carousels mark cloned slides aria-hidden and those are real pictures');
        check('skipWhileMouseDown', 'Suppress while a mouse button is down');
        pick('siteMode', 'Site list mode', null, [
            ['blacklist', 'Disable on listed sites'], ['whitelist', 'Enable only on listed sites']]);

        list('siteList', {
            description: 'Sites the Site list mode above applies to. Subdomains are included, ' +
                'so adding example.com also covers www.example.com.',
            examples: 'Examples: example.com, news.ycombinator.com',
            placeholder: 'e.g. example.com',
            addCurrentLabel: '+ This Site',
            addCurrentTitle: location.hostname,
            currentValue: function () { return location.hostname; },
        });

        section('Never preview these images');
        note('Add one with the ⊘ button on a placed preview',
            'Hover the image, click the preview to pin it, then press ⊘ in its status bar: ' +
            'the image goes into this list and the preview closes. For a page whose tiled ' +
            'background or watermark previews everywhere, that is one click and done.');
        const blocks = list('blockList', {
            description: 'Exact image URLs that never open a preview. A * matches anything, ' +
                'so …/tile.png?* covers a background carrying a cache-busting query.',
            examples: 'Examples: https://example.com/tile.png, https://cdn.example.com/wm/*',
            placeholder: 'e.g. https://example.com/watermark.png',
        });
        listButtons([
            { label: 'Clear all', cls: 'danger', onClick: function () { blocks.clear(); } },
        ]);

        section('The placed window');
        note('Click the preview, then scroll to make it bigger',
            'While you are only hovering, the wheel belongs to the page and scrolls it — which ' +
            'takes the preview down with it. Click the preview first and the wheel becomes the ' +
            'window\'s: it grows the whole window, which is how a page full of small pictures ' +
            'gives usable previews without resizing every one by hand. Moving the window then ' +
            'settles its size: from that point the wheel and +/− zoom the picture inside the ' +
            'frame instead, the arrow keys pan it, and 0 fits it back to the frame.');
        note('It behaves like an ordinary window, and may hang off the screen',
            'Drag the frame around the picture — the margin or the status bar — to move it, ' +
            'at any zoom. Drag an edge or a corner to resize (hold Shift to change its shape ' +
            'rather than keep it). Dragging the middle moves it too, until you have zoomed in ' +
            'past the frame, at which point the middle pans the picture instead. Zoom out past ' +
            'the fit and the picture shrinks inside the frame rather than stopping. Close it ' +
            'with the X, Escape, or a click anywhere outside it.');
        note('Right-click a placed window for the browser\'s own menu',
            'Save image as…, Copy image, Copy image address, Open image in new tab — all of ' +
            'them acting on the full-size original, because the browser fetches it itself. ' +
            'On a preview you are only hovering, right-click dismisses it instead.');
        pick('pinButton', 'Place with',
            'the other button dismisses a preview you are hovering — it stays down until you ' +
            'move off the image and back on', [
                ['left', 'Left click  (right click dismisses)'],
                ['right', 'Right click  (left click dismisses)']]);
        num('wheelZoomStep', 'Wheel zoom step', '% per notch — +/− steps by 25%', 2, 100, 1);
        num('panStep', 'Arrow-key pan step', 'px per press — Shift for 3×', 5, 500, 5);
        num('maxZoom', 'Maximum zoom', '× the natural size', 1, 64, 1);

        section('How to display');
        num('zoomFactor', 'Zoom factor', 'scale applied before fitting to the window', 0.1, 8, 0.1);
        num('maxSizeMultiple', 'Maximum size',
            '× the browser window. A preview always OPENS fitting the window; this is how ' +
            'far the wheel and the corners may then take it. Above 1 on purpose: a frame ' +
            'larger than the window can be shoved aside or upwards and still reach the ' +
            'screen edges, instead of leaving a strip of empty page behind it',
            1, 4, 0.25);
        num('bottomReserve', 'Keep clear at the bottom',
            'px — the browser draws link addresses and its status text over the bottom of ' +
            'the window, so the preview stays above that strip', 0, 300, 5);
        pick('position', 'Position', null, [
            ['cursor', 'Beside the cursor'], ['center', 'Centred in the window']]);
        num('cursorGap', 'Gap from cursor', 'px — the frame is still nudged to stay reachable',
            0, 200, 1);
        num('fadeMs', 'Fade duration', 'ms', 0, 1000, 10);
        num('borderWidth', 'Border thickness', 'px', 0, 20, 1);
        num('frameMargin', 'Frame margin',
            'px of frame drawn over the edges of the picture, matching the status bar along '
            + 'the bottom. It is a move handle: drag it to move a placed window at any zoom. '
            + 'It fades with the bar after a second of stillness, and stops being a handle '
            + 'while faded, so it is never something invisible to press by mistake. 0 leaves '
            + 'the status bar as the only handle',
            0, 80, 2);
        color('borderColor', 'Border colour');
        num('cornerRadius', 'Corner radius', 'px', 0, 40, 1);
        check('shadow', 'Drop shadow');
        check('showStatusBar', 'Show the status bar',
            'filename, format, dimensions, size — and the bottom edge of the frame, which moves '
            + 'a placed window the way a title bar does. The frame margin does the same on the '
            + 'other three sides, so turning this off no longer strands a zoomed-in window — '
            + 'unless the margin is also 0, in which case such a window can be resized and '
            + 'panned but not moved. '
            + 'Both fade out after a second of a still pointer so they stop covering the '
            + 'picture, and return when you move the pointer over the preview');
        pick('spinnerTheme', 'Loading ring',
            'auto follows the browser’s light/dark setting', [
                ['auto', 'Match the browser'], ['dark', 'Always dark'], ['light', 'Always light']]);
        check('noReferrer', 'Strip referrer', 'helps on some hosts, breaks others');

        section('Diagnostics');
        check('debug', 'Log every hover to the console',
            'one line per hover in the browser console (F12): what was under the pointer, ' +
            'whether it was treated as a video and by which rule, whether an ancestor link ' +
            'was findable, and the URLs probed. Off unless a problem is being chased — it ' +
            'is noisy on a page you are moving around');

        const foot = document.createElement('div');
        foot.className = 'foot';

        const reset = document.createElement('button');
        reset.className = 'danger';
        reset.textContent = 'Reset to defaults';
        reset.addEventListener('click', function () {
            cfg = Object.assign({}, DEFAULTS);
            saveSettings();
            openPanel();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', closePanel);

        const save = document.createElement('button');
        save.className = 'primary';
        save.textContent = 'Save';
        save.addEventListener('click', function () {
            controls.forEach(function (fn) { fn(); });
            saveSettings();
            probeCache.clear();
            closePanel();
        });

        foot.appendChild(reset);
        foot.appendChild(cancelBtn);
        foot.appendChild(save);
        panel.appendChild(foot);

        (document.body || document.documentElement).appendChild(panelHost);
    }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Hover Zoom settings', openPanel);
    }

    // First line in the console when debug is on: which copy of the script is actually
    // installed here, and whether the gates that matter are even armed. "Works in one
    // browser, not another" is a stale install until proved otherwise.
    dbg('loaded', {
        version: version(),
        url: location.href,
        enabled: cfg.enabled,
        siteEnabled: siteEnabled(),
        skipVideos: cfg.skipVideos,
        playVideos: cfg.playVideos,
        followLinks: cfg.followLinks,
        hoverThroughOverlays: cfg.hoverThroughOverlays,
        skipPageBackgrounds: cfg.skipPageBackgrounds,
        skipBanners: cfg.skipBanners,
        skipDecorative: cfg.skipDecorative,
        blockList: cfg.blockList.length,
        // These three decide whether a probed candidate becomes a preview, so a log without
        // them cannot be read: 'no hit line' means "nothing was big enough" under the
        // defaults, but showEvenIfNotLarger turns the ratio gate off entirely.
        showEvenIfNotLarger: cfg.showEvenIfNotLarger,
        sameShapeOnly: cfg.sameShapeOnly,
        minRatio: cfg.minRatio,
        minDisplayed: cfg.minDisplayed,
    });
})();
