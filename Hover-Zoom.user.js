// ==UserScript==
// @name        Hover Zoom
// @namespace   https://github.com/VitaKaninen
// @version     0.16.0
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
        skipVideos: true,           // never preview a video thumbnail or a player surface
        skipPageBackgrounds: true,  // never preview a page's own background, or a tiled one
        keepSearching: true,        // show the first hit at once, then keep probing and upgrade in place
        skipWhileMouseDown: true,   // don't fire mid drag/selection
        siteMode: 'blacklist',      // 'blacklist' | 'whitelist'
        siteList: [],               // hostnames, matched by suffix
        blockList: [],              // image URLs never to preview; '*' matches anything

        // pinned mode
        pinButton: 'left',          // 'left' | 'right' — whichever pins, the other dismisses
        wheelZoomStep: 15,          // % per wheel notch
        panStep: 80,                // px per arrow-key press (Shift = 3x)
        maxZoom: 32,                // hard ceiling, multiples of natural size

        // how to display
        maxWidthPct: 92,            // % of viewport — 100 fills it, less EDGE_GAP
        maxHeightPct: 92,
        zoomFactor: 1.0,            // scale applied to natural size before clamping
        position: 'cursor',         // 'cursor' | 'center'
        cursorGap: 24,              // px between pointer and frame edge
        fadeMs: 90,
        borderWidth: 1,
        borderColor: '#45475a',
        cornerRadius: 6,
        shadow: true,
        dimOpacity: 0,              // 0 = no page dimming, up to 90
        showStatusBar: true,        // filename / type / size / dimensions strip, also the move handle; auto-fades
        spinnerTheme: 'auto',       // 'auto' (follows the browser) | 'dark' | 'light'
        noReferrer: false,          // strip referrer when loading full image

        debug: false,               // log every hover decision to the console
    };

    const KEY = 'hoverZoomSettings';
    let cfg = Object.assign({}, DEFAULTS, readSettings());

    function readSettings() {
        try {
            const raw = GM_getValue(KEY, null);
            return raw ? JSON.parse(raw) : {};
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
    const UPGRADES = [
        // Imgur: reduce a thumbnail URL to the stored original. First in the list because it
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
            if (!/(^|\.)imgur\.com$/.test(u.hostname)) return null;
            const m = u.pathname.match(/^\/([A-Za-z0-9]+(?:_d)?)(\.[a-z0-9]+)$/);
            if (!m) return null;
            const was = u.href;
            let id = m[1];
            if (/_d$/.test(id)) id = id.slice(0, -2);
            else if ((id.length === 6 || id.length === 8) && /[sbtmlhg]$/.test(id)) id = id.slice(0, -1);
            // .webp is the de-animating transcode; anything else gives the stored original.
            const ext = /^\.webp$/i.test(m[2]) ? '.jpg' : m[2];
            u.pathname = '/' + id + ext;
            u.search = '';      // ?maxwidth= and ?tb both just ask for a smaller picture
            return u.href === was ? null : u.href;
        },
        // strip common resize/quality query parameters
        function (u) {
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

    // Ordered best-first list of URLs worth trying for this element.
    function collectCandidates(el) {
        const seen = new Set();
        const out = [];
        const add = function (u) {
            if (!u) return;
            let abs;
            try { abs = new URL(u, location.href).href; } catch (e) { return; }
            if (abs.startsWith('data:') || abs.startsWith('blob:')) return;
            if (blocked(abs)) return;       // never probe something the user has ruled out
            if (seen.has(abs)) return;
            seen.add(abs);
            out.push(abs);
        };

        // 1. explicit high-res attributes
        DATA_ATTRS.forEach(function (a) {
            const v = el.getAttribute && el.getAttribute(a);
            if (v && !/\s/.test(v.trim())) add(v.trim());
        });
        const dataSrcset = el.getAttribute && el.getAttribute('data-srcset');
        if (dataSrcset) parseSrcset(dataSrcset).forEach(add);

        // 2. srcset on the image and on any <picture><source>
        let bestSrcset = null;
        if (el.tagName === 'IMG') {
            if (el.srcset) {
                const list = parseSrcset(el.srcset);
                if (list.length) bestSrcset = list[0];
                list.forEach(add);
            }
            const pic = el.closest && el.closest('picture');
            if (pic) {
                pic.querySelectorAll('source[srcset]').forEach(function (s) {
                    const list = parseSrcset(s.srcset);
                    if (!bestSrcset && list.length) bestSrcset = list[0];
                    list.forEach(add);
                });
            }
        }

        // 2b. the widest srcset entry is itself often a resized derivative
        if (bestSrcset) upgradeCandidates(bestSrcset).forEach(add);

        // 3. an ancestor link pointing at media — directly, via a query parameter, or
        //    after a rewrite
        const a = el.closest && el.closest('a[href]');
        if (a && a.href) {
            if (looksLikeImage(a.href)) add(a.href);
            else {
                linkParamCandidates(a.href).forEach(add);
                upgradeCandidates(a.href).forEach(function (u) { if (looksLikeImage(u)) add(u); });
            }
        }

        // 4. rewrites of the displayed src
        const shown = shownUrl(el);
        if (shown) upgradeCandidates(shown).forEach(add);

        // 5. the displayed src itself, last — it is the fallback, never the upgrade
        if (shown) add(shown);

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
        return el.tagName === 'IMG' ? (el.currentSrc || el.src) : backgroundUrl(el);
    }

    function blocked(url) {
        return blockMatch(url, cfg.blockList);
    }

    // ------------------------------------------------------------------ probing

    const probeCache = new Map(); // url -> Promise<{w,h}|null>

    function probe(url) {
        if (probeCache.has(url)) return probeCache.get(url);
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

    async function resolve(el, displayed, token, onHit) {
        const candidates = collectCandidates(el).slice(0, MAX_PROBES);
        const shown = shownUrl(el);
        dbg('candidates', candidates);
        let best = null;
        for (const url of candidates) {
            if (token.cancelled) return best;
            const dim = await probe(url);
            if (!dim) continue;
            const isSameAsShown = (url === shown);
            const bigEnough = dim.w >= displayed.w * cfg.minRatio || dim.h >= displayed.h * cfg.minRatio;
            const usable = bigEnough || (cfg.showEvenIfNotLarger && !isSameAsShown);
            if (!usable) continue;
            if (best && dim.w * dim.h <= best.w * best.h) continue;   // not an improvement
            best = { url: url, w: dim.w, h: dim.h };
            dbg('hit', best);
            if (onHit && !token.cancelled) onHit(best);
            if (!cfg.keepSearching) return best;
        }
        if (best) return best;
        if (cfg.showEvenIfNotLarger && shown && !blocked(shown) && !token.cancelled) {
            const dim = await probe(shown);
            if (dim) {
                best = { url: shown, w: dim.w, h: dim.h };
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

    let host = null, root = null, box = null, imgEl = null, dimEl = null, closeEl = null;
    let capEl = null, capNameEl = null, capMetaEl = null, blockEl = null;
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
    let pinned = false;

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
            '.dim{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity var(--fade) ease}',
            '.dim.on{opacity:var(--dim)}',
            '.dim.catch{pointer-events:auto}',
            '.box{position:fixed;opacity:0;pointer-events:none;transition:opacity var(--fade) ease;',
            'background:#1e1e2e;box-sizing:content-box;overflow:hidden}',
            '.box.on{opacity:1}',
            // POINTER-TRANSPARENT until it is pinned or deliberately placed. This is what
            // lets a scan across a row of thumbnails work: the preview never intercepts the
            // pointer, so leaving an image really does leave it, and the next image under
            // the preview still gets its own mouseover. Pinning and dragging are decided by
            // GEOMETRY at document level instead — see pointInPreview().
            '.box.hot{pointer-events:auto}',
            // Placed but not pinned, the whole frame is a move handle: there is nothing to
            // pan yet, and dragging is how a preview is kept without pinning it.
            '.box.hot:not(.pinned){cursor:move}',
            // Pinned with nothing to pan, the frame moves too, so it says so.
            '.box.pinned:not(.pan){cursor:move}',
            '.box.pan{cursor:grab}',
            '.box.pan.drag{cursor:grabbing}',
            'img{display:block;position:absolute;background:#1e1e2e;-webkit-user-drag:none;user-select:none}',
            // The status bar doubles as the frame's move handle, so unlike the rest of the
            // overlay it must stay hit-testable.
            '.cap{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:baseline;gap:10px;',
            'padding:4px 8px;font:11px/1.5 system-ui,sans-serif;color:#cdd6f4;',
            'background:rgba(30,30,46,.86);letter-spacing:.02em;user-select:none}',
            '.box.pinned .cap{cursor:move}',
            '.cap .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
            'font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#a6adc8}',
            '.cap .meta{flex:none;white-space:nowrap}',
            // "Never this image again". Only on a PLACED window, for the same reason the X
            // is: a hover preview is pointer-transparent, so a button on it cannot be
            // clicked at all. Hover it, click to pin, then press this.
            '.cap .block{flex:none;display:none;width:18px;height:18px;line-height:16px;',
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
            '.cap{transition:opacity ' + BAR_SHOW_MS + 'ms ease}',
            '.cap.idle{opacity:0;pointer-events:none;transition:opacity ' + BAR_FADE_MS + 'ms ease}',
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
            '.x{position:absolute;top:7px;right:7px;width:26px;height:26px;display:none;',
            'align-items:center;justify-content:center;border-radius:50%;border:1px solid #45475a;',
            'background:rgba(30,30,46,.88);color:#cdd6f4;font:17px/1 system-ui,sans-serif;',
            'cursor:pointer;user-select:none}',
            '.box.pinned .x{display:flex}',
            '.x:hover{background:#f38ba8;border-color:#f38ba8;color:#1e1e2e}',
        ].join('');
        root.appendChild(style);

        dimEl = document.createElement('div');
        dimEl.className = 'dim';
        // Only reachable while `.catch` is on, i.e. while pinned. Killing the mousedown
        // as well as the click stops the page beneath from starting a selection or
        // following a link with the same gesture that dismissed us.
        dimEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        dimEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); unpin(); }, true);
        root.appendChild(dimEl);

        box = document.createElement('div');
        box.className = 'box';

        imgEl = document.createElement('img');
        imgEl.draggable = false;

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
        closeEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); unpin(); }, true);

        box.appendChild(imgEl);
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

    // The one gutter between the frame and the edge of the window. clampPosition() uses it
    // too, and it is subtracted from the cap here so that maxWidthPct:100 means "fill the
    // window" and not "be 8px wider than clampPosition will allow you to sit".
    const EDGE_GAP = 4;

    function viewportBox() {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        // The percentage is of the OUTER frame, borders included, so the number in the panel
        // is the fraction of the window the preview visibly occupies. Below 100 the cap is
        // the percentage; at 100 the gutter is what stops it, not the percentage.
        const outerW = Math.min(vw * (cfg.maxWidthPct / 100), vw - EDGE_GAP * 2);
        const outerH = Math.min(vh * (cfg.maxHeightPct / 100), vh - EDGE_GAP * 2);
        return {
            vw: vw,
            vh: vh,
            w: Math.max(32, outerW - cfg.borderWidth * 2),
            h: Math.max(32, outerH - cfg.borderWidth * 2),
        };
    }

    function pannable() {
        return !!view && (view.imgW > view.frameW + 0.5 || view.imgH > view.frameH + 0.5);
    }

    // Frame grows with the image until it hits the viewport cap; after that the frame is
    // fixed and further zoom spills out of it, which is exactly when panning starts to
    // mean something.
    function reflow() {
        if (!view) return;
        const m = viewportBox();
        view.imgW = view.natW * view.scale;
        view.imgH = view.natH * view.scale;
        view.frameW = Math.round(Math.min(view.imgW, m.w));
        view.frameH = Math.round(Math.min(view.imgH, m.h));
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
        const ow = view.frameW + cfg.borderWidth * 2;
        const oh = view.frameH + cfg.borderWidth * 2;
        if (pointer.x < view.left + REACH_INSET) view.left = pointer.x - REACH_INSET;
        else if (pointer.x > view.left + ow - REACH_INSET) view.left = pointer.x - ow + REACH_INSET;
        if (pointer.y < view.top + REACH_INSET) view.top = pointer.y - REACH_INSET;
        else if (pointer.y > view.top + oh - REACH_INSET) view.top = pointer.y - oh + REACH_INSET;
    }

    function clampPosition() {
        const m = viewportBox();
        const ow = view.frameW + cfg.borderWidth * 2;
        const oh = view.frameH + cfg.borderWidth * 2;
        view.left = Math.max(EDGE_GAP, Math.min(view.left, m.vw - ow - EDGE_GAP));
        view.top = Math.max(EDGE_GAP, Math.min(view.top, m.vh - oh - EDGE_GAP));
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
            const ext = u.pathname.match(MEDIA_RE);
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
        // A detached window can be zoomed too now, so the scale shows whenever it is pinned
        // or has moved off the scale it opened at.
        if (pinned || Math.abs(view.scale - view.fitScale) > 1e-6) {
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
    // host to send Access-Control-Allow-Origin, which most do not. A pinned window hands
    // right-click to the BROWSER instead, whose own menu has no such limit — see the
    // image-actions section of CLAUDE.md.

    // BAR_IDLE_MS is how long the pointer must be still before the fade STARTS;
    // BAR_FADE_MS is how long the fade itself takes. They are separate on purpose — the
    // second one is pure reaction time, so it is generous, while the first stays short
    // enough that the bar gets out of the way of the picture.
    const BAR_IDLE_MS = 1000;
    const BAR_FADE_MS = 1200;
    const BAR_SHOW_MS = 120;

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

    function showBar() {
        if (!capEl) return;
        capEl.classList.remove('idle');
        clearTimeout(barTimer);
        barTimer = setTimeout(function () {
            barTimer = 0;
            if (!capEl || !view) return;
            if (pointerOverBar()) { showBar(); return; }   // parked on the bar: keep it
            capEl.classList.add('idle');
        }, BAR_IDLE_MS);
    }

    function resetBar() {
        clearTimeout(barTimer);
        barTimer = 0;
        if (capEl) capEl.classList.remove('idle');
    }

    function layout() {
        if (!view) return;
        clampPosition();
        box.style.left = Math.round(view.left) + 'px';
        box.style.top = Math.round(view.top) + 'px';
        box.style.width = view.frameW + 'px';
        box.style.height = view.frameH + 'px';
        imgEl.style.width = Math.round(view.imgW) + 'px';
        imgEl.style.height = Math.round(view.imgH) + 'px';
        imgEl.style.left = Math.round(view.ox) + 'px';
        imgEl.style.top = Math.round(view.oy) + 'px';
        box.classList.toggle('hot', pinned || detached);
        box.classList.toggle('pan', (pinned || detached) && pannable());
        caption();
        if (spinDocked) moveSpinner();      // the dock rides with the frame
    }

    // Zoom about a point given in SCREEN coordinates, keeping whatever pixel of the image
    // sits under it there afterwards. The frame may resize and be re-centred in between,
    // so the anchor's frame-relative position is derived twice: once against the old
    // frame to find the image pixel, once against the new one to place it back.
    function zoomAt(nextScale, screenX, screenY) {
        if (!view) return;
        const lo = view.fitScale;
        const hi = Math.max(lo, Math.min(cfg.maxZoom, MAX_SCALE_ABS));
        nextScale = Math.max(lo, Math.min(hi, nextScale));
        if (Math.abs(nextScale - view.scale) < 1e-6) return;

        const ax = Math.max(0, Math.min(view.frameW, screenX - (view.left + cfg.borderWidth)));
        const ay = Math.max(0, Math.min(view.frameH, screenY - (view.top + cfg.borderWidth)));
        const ix = (ax - view.ox) / view.scale;
        const iy = (ay - view.oy) / view.scale;

        const cx = view.left + (view.frameW + cfg.borderWidth * 2) / 2;
        const cy = view.top + (view.frameH + cfg.borderWidth * 2) / 2;

        view.scale = nextScale;
        reflow();                       // new frame size; offsets are re-derived below
        view.left = cx - (view.frameW + cfg.borderWidth * 2) / 2;
        view.top = cy - (view.frameH + cfg.borderWidth * 2) / 2;
        clampPosition();

        const ax2 = Math.max(0, Math.min(view.frameW, screenX - (view.left + cfg.borderWidth)));
        const ay2 = Math.max(0, Math.min(view.frameH, screenY - (view.top + cfg.borderWidth)));
        view.ox = ax2 - ix * nextScale;
        view.oy = ay2 - iy * nextScale;
        reflow();                       // clamp the offsets; frame size is already settled
        layout();
    }

    function zoomCentre(nextScale) {
        if (!view) return;
        zoomAt(nextScale,
            view.left + cfg.borderWidth + view.frameW / 2,
            view.top + cfg.borderWidth + view.frameH / 2);
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
                Math.round(view.left + cfg.borderWidth + view.frameW - SPIN_SIZE - 8) + 'px';
            spinEl.style.top =
                Math.round(view.top + cfg.borderWidth + view.frameH - capH - SPIN_SIZE - 8) + 'px';
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
        };
        reflow();

        host.style.setProperty('--fade', cfg.fadeMs + 'ms');
        host.style.setProperty('--dim', (cfg.dimOpacity / 100).toString());

        box.style.border = cfg.borderWidth > 0 ? cfg.borderWidth + 'px solid ' + cfg.borderColor : 'none';
        box.style.borderRadius = cfg.cornerRadius + 'px';
        box.style.boxShadow = cfg.shadow ? '0 8px 32px rgba(0,0,0,.55)' : 'none';

        const ow = view.frameW + cfg.borderWidth * 2;
        const oh = view.frameH + cfg.borderWidth * 2;
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

        if (cfg.noReferrer) imgEl.referrerPolicy = 'no-referrer';
        imgEl.src = res.url;
        layout();
        deferredCaption(res.url);

        box.classList.add('on');
        showBar();
        if (cfg.dimOpacity > 0) dimEl.classList.add('on');
    }

    // A better original arrived while the preview is already up. Swap the pixels without
    // moving anything the eye is tracking: the frame keeps its centre, and a pinned view
    // keeps both its on-screen size and the part of the picture it was looking at. The
    // decode is instant because the probe already pulled this URL into cache.
    function upgradeViewer(res) {
        if (!view) return;
        const m = viewportBox();
        const centreX = view.left + (view.frameW + cfg.borderWidth * 2) / 2;
        const centreY = view.top + (view.frameH + cfg.borderWidth * 2) / 2;
        // where the frame's middle sits in the picture, as a fraction of it
        const fx = view.imgW ? (view.frameW / 2 - view.ox) / view.imgW : 0.5;
        const fy = view.imgH ? (view.frameH / 2 - view.oy) / view.imgH : 0.5;
        const prevImgW = view.imgW;

        view.url = res.url;
        view.natW = res.w;
        view.natH = res.h;
        view.fitScale = Math.min(cfg.zoomFactor, m.w / res.w, m.h / res.h);
        view.scale = pinned && prevImgW
            ? Math.max(view.fitScale, prevImgW / res.w)   // same size on screen, better pixels
            : view.fitScale;                              // an unpinned preview re-fits

        reflow();
        view.ox = view.frameW / 2 - fx * view.imgW;
        view.oy = view.frameH / 2 - fy * view.imgH;
        reflow();
        view.left = centreX - (view.frameW + cfg.borderWidth * 2) / 2;
        view.top = centreY - (view.frameH + cfg.borderWidth * 2) / 2;

        imgEl.src = res.url;
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
        // be"; it appeared only after a preview had been detached or pinned at least once.
        box.classList.remove('on', 'hot', 'pan', 'drag');
        dimEl.classList.remove('on');
        // release the decoded image so long sessions don't accumulate bitmaps
        setTimeout(function () {
            if (box && !box.classList.contains('on')) {
                imgEl.removeAttribute('src');
                view = null;
            }
        }, cfg.fadeMs + 60);
    }

    // ------------------------------------------------------------- pinned mode

    // Every pinned-mode key and wheel listener lives on this one node, in capture, so
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

    // Wheel-to-zoom belongs to any PLACED window — pinned or merely detached. Having gone to
    // the trouble of dragging a preview somewhere, a wheel over it means "make this bigger",
    // not "scroll the page" — and scrolling the page would take the preview down (K2), so the
    // gesture destroyed the thing it was aimed at.
    //
    // Bound on demand rather than for the life of the script: this is a non-passive capture
    // listener on window, and leaving one attached on every page makes every wheel event on
    // every page cancellable for nothing. One flag so add and remove cannot drift, and the
    // same WHEEL_OPTS object for both, or the removal silently no-ops.
    let wheelZoomOn = false;

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

    // The one place `detached` is set, so the wheel binding cannot fall out of step with it.
    function detach() {
        if (detached) return;
        detached = true;
        enableWheelZoom();
    }

    function pin() {
        if (pinned || !view) return;
        pinned = true;
        clearTimeout(timer);
        // The in-flight resolve is deliberately NOT cancelled: pinning is a reason to keep
        // looking for a better original, not to stop. upgradeViewer() preserves the pinned
        // geometry when one arrives.
        box.classList.add('pinned');
        dimEl.classList.add('catch');
        CAP_TARGET.addEventListener('keydown', onPinKey, true);
        enableWheelZoom();
        layout();
    }

    function unpin() {
        if (!pinned) return;
        pinned = false;
        drag = null;
        box.classList.remove('pinned', 'drag');
        dimEl.classList.remove('catch');
        CAP_TARGET.removeEventListener('keydown', onPinKey, true);
        disableWheelZoom();
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

    function onBoxClick(e) {
        if (isBoxControl(e.target)) return;
        // A drag that actually moved something ends in a click too. Pinning on it would
        // make the frame impossible to shove aside without committing to a pin.
        if (justDragged) { justDragged = false; e.stopPropagation(); return; }
        if (pinned) { e.stopPropagation(); return; }   // a pinned box only closes via X / backdrop / Esc
        if (!view) return;
        e.preventDefault();
        e.stopPropagation();
        if (cfg.pinButton === 'left') pin(); else dismiss();
    }

    function onBoxDown(e) {
        if (e.button === 2) { altButton(e); return; }
        if (e.button !== 0) return;
        if (isBoxControl(e.target)) return;
        // Swallow it either way: this is the press half of the pin click and must not
        // reach the page, and it may also turn into a drag.
        e.preventDefault();
        e.stopPropagation();
        justDragged = false;
        if (!view) return;
        // One rule for every state: the status bar always moves the frame, and anywhere else
        // pans when there is something to pan and moves the frame when there is not. Before
        // this a pinned frame at fitScale answered a drag on the picture with nothing at all
        // — mode came out 'pan', pannable() was false, and the press was dropped. pannable()
        // is read per press, so zooming in and back out restores dragging by itself, with no
        // state to keep in step.
        const mode = (capEl.contains(e.target) || !pannable()) ? 'move' : 'pan';
        drag = { x: e.clientX, y: e.clientY, mode: mode, dist: 0, moved: false };
        box.classList.add('drag');
    }

    function onPinKey(e) {
        if (!pinned || !view) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave browser/page chords alone
        const step = e.shiftKey ? cfg.panStep * 3 : cfg.panStep;
        let handled = true;
        switch (e.key) {
            case 'Escape': unpin(); break;
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

    function onPinWheel(e) {
        if (!view) return;
        // Pinned, the wheel is ours wherever it lands — the window is modal. Merely detached,
        // it is one of several things under the pointer, so only a wheel actually over the
        // frame is claimed and everything else still scrolls the page.
        if (!pinned && !(ours(e.target) || pointInPreview(e.clientX, e.clientY))) return;
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
    let drag = null;        // { x, y, mode:'pan'|'move', dist, moved } while dragging
    let justDragged = false;// the click that ends a real drag must not also pin
    let detached = false;   // an unpinned preview that was dragged: hover no longer owns it
    let suppressed = null;  // element whose preview was dismissed; skipped until re-entered
    let swallowMenu = false;
    let pointer = { x: 0, y: 0 };
    let mouseDown = false;
    let modifierDown = false;

    // A press that wanders this far in total is a drag, not a click. Below it, the frame
    // still moves, but the release is treated as a pin.
    const DRAG_SLOP = 3;

    // There is no grace period on the hide any more, and no `hideTimer`. One existed so the
    // pointer could travel onto the preview before it vanished — which mattered only while
    // the preview was hit-testable. It is pointer-transparent now, so leaving the image is
    // unambiguous and the preview goes at once. That is what makes scanning a row of
    // thumbnails give one preview per thumbnail.

    // The unpinned preview cannot be hit-tested, so "is the pointer on it" is answered from
    // `view` instead. Outer rect: the frame plus its border, which is what layout() writes.
    function pointInPreview(x, y) {
        if (!view || !box || !box.classList.contains('on')) return false;
        const w = view.frameW + cfg.borderWidth * 2;
        const h = view.frameH + cfg.borderWidth * 2;
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

    function videoSurfaces() {
        const out = [];
        const vids = document.getElementsByTagName('video');
        for (let i = 0; i < vids.length; i++) {
            const v = vids[i].getBoundingClientRect();
            if (v.width < 2 || v.height < 2) continue;   // not laid out; contains nothing
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
            if (n.querySelector && n.querySelector('video')) return '<video> in ancestor #' + up;
        }
        const a = closestAcross(el, 'a[href]');
        const href = a ? (a.getAttribute('href') || '') : '';
        if (href && VIDEO_LINK_RE.test(href)) return 'video link: ' + href;
        return null;
    }

    function inVideoContext(el) {
        return !!videoReason(el);
    }

    // A page's own background, and any background laid end to end, are wallpaper rather
    // than pictures: hovering blank space on such a page opened a preview of the tile, and
    // on a tiled page there is blank space everywhere.
    //
    // `background-repeat: repeat` alone does NOT mean tiled — it is the CSS default, so a
    // hero image with `background-size: cover` computes to it too and would be caught. It is
    // repeat AND an auto size together that mean the image is being laid out at its natural
    // size and stepped across the element, which is the thing being described.
    function isWallpaper(el) {
        if (el === document.body || el === document.documentElement) return true;
        const s = getComputedStyle(el);
        if (/no-repeat/.test(s.backgroundRepeat)) return false;
        return /^auto/.test(s.backgroundSize);
    }

    function eligible(el) {
        if (!el) return null;
        if (NEVER[el.tagName]) return null;
        if (cfg.skipVideos && inVideoContext(el)) return null;
        if (el.tagName === 'IMG') return blocked(shownUrl(el)) ? null : el;
        // element with a background image and no img of its own
        if (el.querySelector && el.querySelector('img')) return null;
        const bg = backgroundUrl(el);
        if (!bg || blocked(bg)) return null;
        if (cfg.skipPageBackgrounds && isWallpaper(el)) return null;
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
                (holds(s.rect, cx, cy) ? ' [CONTAINS the pointer target]' : ' [does not contain it]');
        });
        const cls = typeof t.className === 'string' ? t.className.trim() : '';
        return {
            target: t.tagName + (t.id ? '#' + t.id : '') +
                (cls ? '.' + cls.split(/\s+/).slice(0, 2).join('.') : ''),
            targetRect: rectStr(rect),
            showing: (shownUrl(t) || '(nothing)').slice(0, 160),
            eligible: !!el,
            skipVideos: cfg.skipVideos,
            videoGate: videoReason(t) || 'none — NOT treated as video',
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
        if (pinned) return;         // a pinned viewer outlives hover entirely
        clearTimeout(timer);
        if (token) token.cancelled = true;
        token = null;
        active = null;
        activeShown = null;
        detached = false;
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
        suppressed = active;            // read it before unpin()/cancel() clear it
        if (pinned) unpin(); else cancel();
    }

    // The button that does NOT pin. Returns true when it acted, which is the signal to
    // swallow the context menu that a right press is about to raise.
    //
    // A PINNED window deliberately does NOT act, so the browser raises its own context menu
    // over our <img> — whose src is the resolved full-size URL. That is the only way "Save
    // image as…" and "Copy image" work at all: ours ran in page JavaScript and needed the host
    // to send Access-Control-Allow-Origin, which most do not, while the browser's use its own
    // network stack and the bitmap it has already decoded. Verified in a real browser
    // 2026-09-03 (via pinButton:'right', where a second right press already fell through to
    // it) — native chrome does target an <img> inside an open shadow root, and Save gives the
    // full-size file.
    //
    // Only pinned. A HOVER preview is pointer-transparent, so the native menu there would come
    // up for the thumbnail underneath and offer to save *that*; and a DETACHED window keeps
    // dismiss because right-click-to-shove-it-away is worth more there than a menu that is one
    // click (a pin) away. Pinning is the deliberate "I want to work with this image" gesture,
    // which is exactly where the menu belongs.
    function altButton(e) {
        let acted = false;
        if (cfg.pinButton === 'right') {
            if (!pinned && view && box.classList.contains('on')) { pin(); acted = true; }
        } else if (pinned) {
            return false;               // hands the press to the browser; see above
        } else if (active) {
            dismiss();
            acted = true;
        }
        if (acted) {
            e.preventDefault();
            e.stopPropagation();
            swallowMenu = true;
        }
        return acted;
    }

    function overOurs(e) {
        if (ours(e.target)) return true;
        if (pointInPreview(e.clientX, e.clientY)) return true;
        return !!active && (active === e.target || (active.contains && active.contains(e.target)));
    }

    function onMove(e) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        if (spinEl && spinEl.classList.contains('on')) moveSpinner();
        // The status bar comes back when the pointer moves OVER the window, and only then —
        // moving anywhere else lets it fade, which is the whole point of it.
        if (view && box && box.classList.contains('on') &&
            (ours(e.target) || pointInPreview(e.clientX, e.clientY))) showBar();
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!dx && !dy) return;
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.dist += Math.abs(dx) + Math.abs(dy);
        if (drag.dist > DRAG_SLOP) drag.moved = true;
        if (drag.mode === 'move') {
            // Dragging an unpinned preview detaches it: it has been deliberately placed, so
            // it stops following the hover and now lives until the pointer leaves IT.
            if (drag.moved && !pinned) detach();
            view.left += dx;
            view.top += dy;
            layout();       // clampPosition() keeps the frame on screen
        } else {
            panBy(dx, dy);
        }
    }

    function onOver(e) {
        if (pinned) return;
        // A drag can outrun the frame it is moving; without this, the page elements
        // sliding under the pointer would cancel the very preview being dragged.
        if (drag) return;
        if (ours(e.target)) return;         // on the preview — only reachable once detached
        // The pointer is on the page, so it is off any detached preview. A placed preview is
        // held by nothing else, so it goes now, and dismiss() suppresses the image it came
        // from: moving back onto that image must not re-open it until the pointer has left
        // and returned.
        if (detached) dismiss();
        if (!cfg.enabled || !siteEnabled()) return;
        if (cfg.skipWhileMouseDown && mouseDown) return;
        if (cfg.activation === 'modifier' && !modifierHeld(e) && !modifierDown) return;

        const el = eligible(e.target);
        if (cfg.debug) dbg('hover', hoverReport(e.target, el));
        if (!el) {
            // moving onto the page background closes an open viewer
            if (active && !active.contains(e.target)) cancel();
            return;
        }
        if (el === suppressed) return;      // dismissed; stays down until the pointer leaves
        if (el === active) return;

        cancel();
        const displayed = sizeOf(el);
        if (displayed.w < cfg.minDisplayed && displayed.h < cfg.minDisplayed) return;
        if (cfg.maxDisplayed > 0 && (displayed.w > cfg.maxDisplayed || displayed.h > cfg.maxDisplayed)) return;

        active = el;
        activeShown = shownUrl(el);
        const myToken = token = { cancelled: false };
        timer = setTimeout(async function () {
            showSpinner();
            try {
                await resolve(el, displayed, myToken,
                    function (hit) {
                        // First hit paints the preview; every later one is strictly bigger
                        // and replaces it in place, pinned or not.
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

    function onOut(e) {
        if (pinned || drag) return;
        const to = e.relatedTarget;
        if (suppressed && e.target === suppressed &&
            !(to && suppressed.contains && suppressed.contains(to))) {
            suppressed = null;      // left the image; hovering it again may preview again
        }
        if (!active) return;
        if (detached) {
            // Held by the preview alone. Leaving the source image is a non-event; leaving
            // the PREVIEW takes it down and suppresses that image until it is re-entered.
            if (ours(e.target) && !(to && ours(to))) dismiss();
            return;
        }
        if (to && active.contains && active.contains(to)) return;   // still inside the image
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
        if (ours(e.target)) { claimClick(); return; }   // onBoxDown / the backdrop own this one
        // An unpinned preview is pointer-transparent, so a press ON it lands on the page
        // beneath and never reaches onBoxDown. Geometry decides ownership instead, and
        // hands the press to that same handler so there is still only one state machine.
        if (!pinned && view && box && box.classList.contains('on') &&
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
    // The click half of the same handoff. Without it a press on a pointer-transparent
    // preview would move or pin nothing and the page beneath would take the click.
    CAP_TARGET.addEventListener('click', function (e) {
        if (ours(e.target)) return;             // onBoxClick owns it
        if (pinned || !view || !box || !box.classList.contains('on')) return;
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
        if (drag) {
            justDragged = drag.moved;   // read by onBoxClick, which fires right after this
            drag = null;
            if (box) box.classList.remove('drag');
        }
    }, true);
    window.addEventListener('scroll', function () { if (!pinned) cancel(); }, true);
    window.addEventListener('blur', function () { if (!pinned) cancel(); });
    window.addEventListener('resize', function () {
        if (!pinned) { cancel(); return; }
        // the window shrinking can leave the frame oversized and the pan out of bounds
        view.fitScale = Math.min(cfg.zoomFactor, viewportBox().w / view.natW, viewportBox().h / view.natH);
        if (view.scale < view.fitScale) view.scale = view.fitScale;
        reflow();
        layout();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            cancel();                           // onPinKey has already handled the pinned case
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
        check('keepSearching', 'Keep looking after the first hit',
            'shows the first match immediately, then upgrades the preview in place as bigger ' +
            'originals turn up — costs up to 8 requests per hover instead of usually one');
        check('skipVideos', 'Never preview videos',
            'skips media elements, anything with a player next to it, and images inside a ' +
            'link that plainly points at a video (/watch?, /shorts/, /embed/, /video/, ' +
            'youtu.be, .mp4 and friends) — turn off if it is skipping stills you want');
        check('skipPageBackgrounds', 'Never preview page backgrounds',
            'the page\'s own background, and any background tiled end to end — wallpaper ' +
            'rather than a picture, and on a tiled page there is blank space everywhere to ' +
            'trip over it');
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

        section('Pinned mode');
        note('Drag the preview to keep it, click it to pin it',
            'Dragging an unpinned preview moves it and detaches it from the hover: it then ' +
            'stays until you move off the preview itself. Clicking pins it, and it stays until ' +
            'the X, a click outside it, or Escape. While pinned: wheel or +/− to zoom, drag the ' +
            'image or use the arrow keys to pan, 0 to reset, and drag the status bar to move ' +
            'the frame.');
        note('Right-click a pinned preview for the browser\'s own menu',
            'Save image as…, Copy image, Copy image address, Open image in new tab — all of ' +
            'them acting on the full-size original, because the browser fetches it itself. ' +
            'Right-click on an unpinned preview still dismisses it.');
        pick('pinButton', 'Pin with',
            'the other button dismisses instead — the preview stays down until you move off ' +
            'the image and back on', [
                ['left', 'Left click  (right click dismisses)'],
                ['right', 'Right click  (left click dismisses)']]);
        num('wheelZoomStep', 'Wheel zoom step', '% per notch — +/− steps by 25%', 2, 100, 1);
        num('panStep', 'Arrow-key pan step', 'px per press — Shift for 3×', 5, 500, 5);
        num('maxZoom', 'Maximum zoom', '× the natural size', 1, 64, 1);

        section('How to display');
        num('zoomFactor', 'Zoom factor', 'scale applied before fitting to the window', 0.1, 8, 0.1);
        num('maxWidthPct', 'Max width', '% of window', 10, 100, 1);
        num('maxHeightPct', 'Max height', '% of window', 10, 100, 1);
        pick('position', 'Position', null, [
            ['cursor', 'Beside the cursor'], ['center', 'Centred in the window']]);
        num('cursorGap', 'Gap from cursor', 'px — the frame is still nudged to stay reachable',
            0, 200, 1);
        num('fadeMs', 'Fade duration', 'ms', 0, 1000, 10);
        num('borderWidth', 'Border thickness', 'px', 0, 20, 1);
        color('borderColor', 'Border colour');
        num('cornerRadius', 'Corner radius', 'px', 0, 40, 1);
        check('shadow', 'Drop shadow');
        num('dimOpacity', 'Dim the page behind', '% — 0 disables', 0, 90, 5);
        check('showStatusBar', 'Show the status bar',
            'filename, format, dimensions, size — and the handle that moves a pinned frame. ' +
            'It fades out after a second of a still pointer so it stops covering the ' +
            'bottom of the picture, and returns when you move the pointer over the preview');
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
        skipPageBackgrounds: cfg.skipPageBackgrounds,
        blockList: cfg.blockList.length,
        // These three decide whether a probed candidate becomes a preview, so a log without
        // them cannot be read: 'no hit line' means "nothing was big enough" under the
        // defaults, but showEvenIfNotLarger turns the ratio gate off entirely.
        showEvenIfNotLarger: cfg.showEvenIfNotLarger,
        minRatio: cfg.minRatio,
        minDisplayed: cfg.minDisplayed,
    });
})();
