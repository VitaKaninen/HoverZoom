// ==UserScript==
// @name        Hover Zoom
// @namespace   https://github.com/VitaKaninen
// @version     0.43.0
// @author      VitaKaninen
// @description Zoom any image on hover. No format allowlist, no size caps, no per-site plugins — resolves the full-size URL on demand. Drag the preview to keep it around, click it to pin it, then wheel or +/− to zoom in past the window edge and drag or arrow keys to pan.
// @match       *://*/*
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_addValueChangeListener
// @grant       GM_registerMenuCommand
// @grant       GM_unregisterMenuCommand
// @run-at      document-idle
// @downloadURL https://raw.githubusercontent.com/VitaKaninen/HoverZoom/master/Hover-Zoom.user.js
// @updateURL   https://raw.githubusercontent.com/VitaKaninen/HoverZoom/master/Hover-Zoom.user.js
// ==/UserScript==

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
        // when to zoom
        activation: 'hover',        // 'hover' | 'modifier' (hold key, then hover)
        modifierKey: 'ctrl',        // 'ctrl' | 'alt' | 'shift'
        hoverDelay: 120,            // ms before resolving
        minDisplayed: 48,           // ignore images displayed smaller than this (icons)
        minRatio: 1.2,              // full size must be this much bigger; below 1 previews anything
        previewVideos: false,       // preview video THUMBNAILS and player surfaces too. Off by
        skipFurniture: true,        // never preview the page's own furniture: its background, a
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
        zoomFactor: 1.0,            // ceiling on the opening scale; the window still fits it
        position: 'cursor',         // 'cursor' | 'center'
        fadeMs: 90,
        borderWidth: 1,
        borderColor: '#45475a',
        cornerRadius: 6,
        frameMargin: 24,            // px of frame drawn ON TOP of the image, on all four
        barFade: true,              // may the bar and grab border fade at all
        barIdleMs: 1000,            // still pointer before they fade; 0 = they never appear
        barFadeMs: 1200,            // how long that fade takes
        shadow: true,
        shadowSize: 32,             // px of blur
        shadowStrength: 55,         // % opacity
        smoothing: 'auto',          // 'auto' | 'pixelated' | 'crisp-edges' — image-rendering
        showStatusBar: true,        // filename / type / size / dimensions strip, also the move handle; auto-fades
        spinnerTheme: 'auto',       // 'auto' (follows the browser) | 'dark' | 'light'
        referrerSites: [],          // sites to load previews from WITHOUT a referrer

        debug: false,               // log every hover decision to the console
    };

    const KEY = 'hoverZoomSettings';

    const RETIRED = ['maxWidthPct', 'maxHeightPct', 'dimOpacity', 'bottomReserve',
        'sameShapeOnly', 'keepSearching', 'followLinks', 'hoverThroughOverlays',
        'skipWhileMouseDown', 'playVideos', 'skipVideos', 'skipPageBackgrounds',
        'skipBanners', 'skipDecorative', 'enabled', 'maxDisplayed', 'cursorGap', 'noReferrer',
        'showEvenIfNotLarger'];

    // The retirements that DO convert.
    function migrate(o) {
        if (o.previewVideos === undefined && o.skipVideos !== undefined) {
            o.previewVideos = !o.skipVideos;
        }
        if (o.skipFurniture === undefined && o.skipPageBackgrounds !== undefined) {
            o.skipFurniture = !!o.skipPageBackgrounds;
        }
        // "Preview images that are already full size" is a minRatio below 1 now.
        if (o.showEvenIfNotLarger && !(o.minRatio < 1)) o.minRatio = 0.9;
        return o;
    }

    function readSettings() {
        try {
            const raw = GM_getValue(KEY, null);
            const o = migrate(raw ? JSON.parse(raw) : {});
            RETIRED.forEach(function (k) { delete o[k]; });
            return o;
        } catch (e) {
            try { console.warn('[Hover Zoom] settings could not be read, using defaults:', e); }
            catch (e2) { /* no console */ }
            return {};
        }
    }

    let cfg = Object.assign({}, DEFAULTS, readSettings());

    let playVideos = true;

    function saveSettings() {
        GM_setValue(KEY, JSON.stringify(cfg));
    }

    // Every tab holds its own `cfg`, read once at load.
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
                refreshSiteMenu();                  // the mode or the list may have changed
                if (panelHost) openPanel();         // re-render an open panel onto fresh values
            });
        } catch (e) { /* not all managers implement it; reloadSettings() still covers the panel */ }
    }

    // Does an entry cover this hostname? Suffix match, so example.com covers www.example.com.
    function entryCovers(entry, host) {
        const e = String(entry).trim().toLowerCase().replace(/^\*\./, '');
        if (!e) return false;
        return host === e || host.endsWith('.' + e);
    }

    const isTopFrame = (function () {
        try { return window.top === window.self; } catch (e) { return false; }
    })();

    // The site the USER is on, not the frame this copy happens to run in.
    function pageHost() {
        if (isTopFrame) return location.hostname.toLowerCase();
        try {
            const anc = location.ancestorOrigins;
            if (anc && anc.length) return new URL(anc[anc.length - 1]).hostname.toLowerCase();
        } catch (e) { /* not in Firefox */ }
        try {
            const h = window.top.location.hostname;      // same-origin frames only
            if (h) return h.toLowerCase();
        } catch (e) { /* cross-origin */ }
        try {
            if (document.referrer) return new URL(document.referrer).hostname.toLowerCase();
        } catch (e) { /* no referrer */ }
        return location.hostname.toLowerCase();
    }

    function siteListed() {
        const host = pageHost();
        return cfg.siteList.some(function (entry) { return entryCovers(entry, host); });
    }

    function siteEnabled() {
        return cfg.siteMode === 'whitelist' ? siteListed() : !siteListed();
    }

    // Per site, because stripping it fixes one host and breaks the next.
    function noReferrerHere() {
        const host = pageHost();
        return cfg.referrerSites.some(function (entry) { return entryCovers(entry, host); });
    }

    let siteMenuId = null;

    function siteMenuLabel() {
        const on = siteEnabled();
        return on ? 'Disable for this site' : 'Enable for this site';
    }

    // Re-registering is how the label is kept honest. Top frame only, or every iframe on the page
    // registers a second copy and the one you click is not the one you meant.
    function refreshSiteMenu() {
        if (!isTopFrame) return;
        if (typeof GM_registerMenuCommand !== 'function') return;
        if (siteMenuId != null) {
            if (typeof GM_unregisterMenuCommand !== 'function') return;
            try { GM_unregisterMenuCommand(siteMenuId); } catch (e) { return; }
            siteMenuId = null;
        }
        try {
            siteMenuId = GM_registerMenuCommand(siteMenuLabel(), toggleSite);
        } catch (e) { /* nothing to fall back to; the panel still has the list */ }
    }

    // reloadSettings() first for the same reason blockCurrent() does it.
    function toggleSite() {
        reloadSettings();
        const host = pageHost();
        const kept = cfg.siteList.filter(function (entry) { return !entryCovers(entry, host); });
        if (kept.length === cfg.siteList.length) kept.push(host);
        cfg.siteList = kept;
        saveSettings();
        refreshSiteMenu();
        refreshPanel();
        if (!siteEnabled()) cancel();
        dbg('site toggled', { host: host, list: cfg.siteList, enabledHere: siteEnabled() });
    }

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

    // Parse a srcset into candidates sorted widest first.
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

    // Images the user has said never to preview.
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
        function (u) {
            const hit = imgurId(u);
            if (!hit) return null;
            const url = 'https://i.imgur.com/' + hit.id + '.mp4';
            return url === u.href ? null : url;
        },
        function (u) {
            if (!/(^|\.)gifwow\.com$/.test(u.hostname)) return null;
            const m = u.pathname.match(/^\/gifs\/([A-Za-z0-9_-]+)\.(?:jpe?g|png|webp|gif)$/i);
            return m ? u.origin + '/gifs/' + m[1] + '.mp4' : null;
        },
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

    // Ordered best-first list of candidates worth trying for this element, each as `{ url, from }`.
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
            if (!playVideos && isVideoUrl(abs)) return;
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

        const a = el.closest && el.closest('a[href]');
        if (a && a.href) {
            if (looksLikeImage(a.href) || (playVideos && isVideoUrl(a.href))) add(a.href, 'the ancestor link itself');
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

    // What this element is actually showing right now — the only URL that exists for it without a probe.
    function shownUrl(el) {
        if (el.tagName === 'IMG') return el.currentSrc || el.src;
        if (el.tagName === 'VIDEO') return el.currentSrc || el.src || null;
        return backgroundUrl(el);
    }

    function blocked(url) {
        return blockMatch(url, cfg.blockList);
    }

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
            if (noReferrerHere()) img.referrerPolicy = 'no-referrer';
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

    const MAX_PROBES = 8;

    const pageCache = new Map();    // page url -> Promise<{url, video}|null>

    function metaContent(doc, names) {
        for (let i = 0; i < names.length; i++) {
            const m = doc.querySelector('meta[property="' + names[i] + '"], meta[name="' + names[i] + '"]');
            const v = m && m.getAttribute('content');
            if (v && v.trim()) return v.trim();
        }
        return null;
    }

    // What a fetched page says its media is.
    function pageMediaFrom(doc, pageUrl) {
        const declared = metaContent(doc, ['og:url']);
        if (declared) {
            let d = null;
            try { d = new URL(declared, pageUrl.href); } catch (e) { d = null; }
            if (!d || d.pathname.replace(/\/+$/, '') !== pageUrl.pathname.replace(/\/+$/, '')) return null;
        }
        const vid = metaContent(doc, ['og:video:secure_url', 'og:video:url', 'og:video',
            'twitter:player:stream']);
        if (vid && playVideos && isVideoUrl(vid)) {
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
            if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) return null;
            doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        } catch (e) {
            return null;                                  // offline, blocked, CSP, aborted
        }
        return pageMediaFrom(doc, pageUrl);
    }

    function linkedMedia(el) {
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

    // The required upsize. Applies to the linked page's own answer too — a ratio nobody enforces is a setting that does nothing.
    // Strictly greater, so 1 means "anything bigger at all" without asking for 1.000001.
    function bigEnough(dim, displayed) {
        return dim.w > displayed.w * cfg.minRatio || dim.h > displayed.h * cfg.minRatio;
    }

    async function resolve(el, displayed, token, onHit) {
        const candidates = collectCandidates(el).slice(0, MAX_PROBES);
        const shown = shownUrl(el);
        const native = nativeSize(el);      // the bytes on screen, for the stability test
        dbg('candidates', candidates);
        let best = null;
        let trusted = null;

        const linked = linkedMedia(el).then(async function (hit) {
            if (!hit || token.cancelled || blocked(hit.url)) return null;
            const dim = await probe(hit.url);
            if (!dim || token.cancelled) return null;
            if (!sameShape(native, dim)) {
                dbg('linked page rejected — a different shape, so a different picture', {
                    url: hit.url,
                    onScreen: native ? native.w + '×' + native.h : '(unknown)',
                    declared: dim.w + '×' + dim.h,
                });
                return null;
            }
            if (!bigEnough(dim, displayed)) {
                dbg('linked page rejected — under the required upsize', {
                    url: hit.url, minRatio: cfg.minRatio,
                    onScreen: displayed.w + '×' + displayed.h,
                    declared: dim.w + '×' + dim.h,
                });
                return null;
            }
            trusted = { url: hit.url, w: dim.w, h: dim.h, video: !!dim.video, duration: dim.duration,
                from: 'the page the thumbnail links to (og: media)' };
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
            if (isSameAsShown && native && (dim.w !== native.w || dim.h !== native.h)) {
                markUnstable(url, native, dim);
                continue;
            }
            if (!sameShape(native, dim)) {
                dbg('rejected — a different shape, so a different picture', {
                    url: url, from: c.from,
                    onScreen: native.w + '×' + native.h, candidate: dim.w + '×' + dim.h,
                });
                continue;
            }
            if (!bigEnough(dim, displayed)) {
                dbg('rejected — under the required upsize', {
                    url: url, from: c.from, minRatio: cfg.minRatio,
                    onScreen: displayed.w + '×' + displayed.h,
                    candidate: dim.w + '×' + dim.h,
                });
                continue;
            }
            if (best && dim.w * dim.h <= best.w * best.h) continue;   // not an improvement
            if (best && best.video && !dim.video) continue;
            best = { url: url, w: dim.w, h: dim.h, video: !!dim.video, duration: dim.duration,
                from: c.from };
            dbg('hit', best);
            if (onHit && !token.cancelled) onHit(best);
        }
        await linked;
        if (trusted) return trusted;
        return best;
    }

    let host = null, root = null, box = null, imgEl = null, vidEl = null, mediaEl = null;
    let dimEl = null;
    let capEl = null, capNameEl = null, capHintEl = null, capMetaEl = null, blockEl = null;
    let vidOffEl = null;        // "stop showing clips", only while the frame IS one
    let aaEl = null;            // smoothing, and the menu it opens
    let aaPopEl = null, blockPopEl = null;

    // Only two of these are real: Chrome accepts auto, pixelated and crisp-edges, and renders
    // crisp-edges the same as pixelated. Anything else (lanczos, bicubic) needs a canvas.
    const SMOOTHING_OPTS = [
        ['auto', 'Smooth', 'blended pixels — photographs, and most images'],
        ['pixelated', 'Hard pixels', 'every pixel a square — pixel art, screenshots, small logos'],
    ];
    let edgeEls = null;         // [top, left, right, bottom] — the drawn frame margin
    let gripEl = null;          // invisible collar that carries the outer half of the resize strip
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

    // The spinner is the one part of the overlay that sits on the bare page rather than on the frame's own dark background.
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

    // DarkReader rewrites var() usage inside STYLESHEETS, so a themed rule loses to it; it does not
    // fight an inline !important literal. Sudokupad-Tools' LESSONS_LEARNED, "Beating DarkReader".
    function paintOver(el, prop, value) {
        if (!el) return;
        el.style.setProperty(prop, value, 'important');
        el.removeAttribute('data-darkreader-inline-' + prop);
    }

    // Catppuccin Mocha in dark mode, near-white in light.
    function applySpinTheme() {
        if (!host) return;
        const dark = darkMode();
        const bg = dark ? 'rgba(24,24,37,.96)' : 'rgba(255,255,255,.97)';
        const edge = dark ? 'rgba(205,214,244,.45)' : 'rgba(30,30,46,.45)';
        const track = dark ? 'rgba(205,214,244,.30)' : 'rgba(30,30,46,.22)';
        const arc = dark ? '#89b4fa' : '#1e66f5';
        host.style.setProperty('--spin-bg', bg);
        host.style.setProperty('--spin-edge', edge);
        host.style.setProperty('--spin-track', track);
        host.style.setProperty('--spin-arc', arc);
        if (!spinSvg) return;
        paintOver(spinSvg.querySelector('.disc'), 'fill', bg);
        paintOver(spinSvg.querySelector('.disc'), 'stroke', edge);
        paintOver(spinSvg.querySelector('.track'), 'stroke', track);
        paintOver(spinSvg.querySelector('.arc'), 'stroke', arc);
    }

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
            '.dim{position:fixed;inset:0;background:transparent;pointer-events:none}',
            '.dim.catch{pointer-events:auto}',
            '.grip{position:fixed;background:transparent;pointer-events:none}',
            '.grip.hot{pointer-events:auto}',
            '.box{position:fixed;opacity:0;pointer-events:none;transition:opacity var(--fade) ease;',
            'background:#1e1e2e;box-sizing:content-box;overflow:hidden}',
            '.box.on{opacity:1}',
            '.box.hot{pointer-events:auto}',
            '.box.placed:not(.pan){cursor:move}',
            '.box.pan{cursor:grab}',
            '.box.pan.drag{cursor:grabbing}',
            'img,video{display:block;position:absolute;background:#1e1e2e;-webkit-user-drag:none;user-select:none}',
            '.edge{position:absolute;pointer-events:none;background:rgba(30,30,46,.30)}',
            'img[hidden],video[hidden]{display:none}',
            '.cap{position:absolute;left:0;right:0;bottom:0;height:' + BAR_MIN_H + 'px;',
            'display:flex;align-items:center;gap:10px;box-sizing:border-box;',
            'padding:0 8px;font:11px/16px system-ui,sans-serif;color:#cdd6f4;',
            'background:rgba(30,30,46,.86);letter-spacing:.02em;user-select:none}',

            '.cap .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
            'font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#a6adc8}',
            '.cap .meta{flex:none;white-space:nowrap}',
            '.cap .hint{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;',
            'white-space:nowrap;color:#7f849c;font-style:italic}',
            '.box.placed .cap .hint{display:none}',
            '.cap .btn{position:absolute;top:50%;transform:translateY(-50%);display:none;',
            'width:18px;height:18px;line-height:16px;text-align:center;border-radius:4px;',
            'border:1px solid #45475a;background:rgba(49,50,68,.9);color:#a6adc8;',
            'cursor:pointer;font-size:12px}',
            '.box.hot .cap .block,.box.hot .cap .aa{display:block}',
            '.box.hot .cap.hasvid .vidoff{display:block}',
            '.cap .vidoff{font-size:10px}',
            '.cap .aa{font-size:9px;font-weight:700;letter-spacing:-.06em}',
            '.cap .aa.sharp{background:#89b4fa;border-color:#89b4fa;color:#1e1e2e}',
            '.cap .block:hover{background:#f38ba8;border-color:#f38ba8;color:#1e1e2e}',
            '.cap .vidoff:hover{background:#f9e2af;border-color:#f9e2af;color:#1e1e2e}',
            '.cap .aa:hover{background:#89b4fa;border-color:#89b4fa;color:#1e1e2e}',
            '.pop{position:absolute;right:8px;bottom:' + (BAR_MIN_H + 4) + 'px;display:none;',
            'z-index:4;max-width:250px;background:rgba(30,30,46,.98);border:1px solid #45475a;',
            'border-radius:6px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.55);',
            'font:11px/1.4 system-ui,sans-serif;color:#cdd6f4;text-align:left}',
            '.box.hot .pop.open{display:block}',
            '.pop .head{padding:8px 10px;color:#bac2de;border-bottom:1px solid #45475a}',
            '.pop .head b{color:#cdd6f4}',
            '.pop .item{padding:6px 10px;cursor:pointer}',
            '.pop .item:hover{background:#45475a}',
            '.pop .item.on{color:#89b4fa;font-weight:700}',
            '.pop .item .sub{display:block;color:#7f849c;font-size:10px;font-weight:400}',
            '.pop .acts{display:flex;gap:6px;justify-content:flex-end;padding:8px}',
            '.pop .acts button{font:11px system-ui,sans-serif;padding:4px 10px;border-radius:5px;',
            'border:1px solid #45475a;background:#313244;color:#cdd6f4;cursor:pointer}',
            '.pop .acts button.go{background:#f38ba8;border-color:#f38ba8;color:#1e1e2e;font-weight:700}',
            '.cap,.edge{transition:opacity ' + BAR_SHOW_MS + 'ms ease}',
            '.box.idle .cap{opacity:0;pointer-events:none;transition:opacity var(--barfade) ease}',
            '.box.idle .edge{opacity:0;transition:opacity var(--barfade) ease}',
            // Source order beats the two rules above at equal specificity — "never shown" has no fade.
            '.box.nobar .cap{opacity:0;pointer-events:none;transition:none}',
            '.box.nobar .edge{opacity:0;transition:none}',
            '.spin{position:fixed;width:34px;height:34px;display:none;pointer-events:none;',
            'filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))}',
            '.spin.on{display:block}',
            '.spin svg{display:block;width:100%;height:100%}',
            '.spin .disc{fill:var(--spin-bg);stroke:var(--spin-edge);stroke-width:1.5}',
            '.spin .track,.spin .arc{fill:none;stroke-width:4.5;stroke-linecap:round}',
            '.spin .track{stroke:var(--spin-track)}',
            '.spin .arc{stroke:var(--spin-arc)}',
        ].join('');
        root.appendChild(style);

        dimEl = document.createElement('div');
        dimEl.className = 'dim';
        dimEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        dimEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); dismiss(); }, true);
        root.appendChild(dimEl);

        gripEl = document.createElement('div');
        gripEl.className = 'grip';
        gripEl.addEventListener('mousedown', onBoxDown, true);
        gripEl.addEventListener('click', onBoxClick, true);
        root.appendChild(gripEl);

        box = document.createElement('div');
        box.className = 'box';

        imgEl = document.createElement('img');
        imgEl.draggable = false;

        vidEl = document.createElement('video');
        vidEl.muted = true;
        vidEl.loop = true;
        vidEl.autoplay = true;
        vidEl.playsInline = true;
        vidEl.draggable = false;
        vidEl.hidden = true;

        imgEl.addEventListener('load', verifyMedia);
        vidEl.addEventListener('loadedmetadata', verifyMedia);

        capEl = document.createElement('div');
        capEl.className = 'cap';
        capNameEl = document.createElement('span');
        capNameEl.className = 'name';
        capHintEl = document.createElement('span');
        capHintEl.className = 'hint';
        capHintEl.textContent = '(click this window to pin it)';
        capMetaEl = document.createElement('span');
        capMetaEl.className = 'meta';
        blockEl = document.createElement('span');
        blockEl.className = 'btn block';
        blockEl.title = 'Never preview this image again';
        blockEl.textContent = '⊘';
        blockEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        blockEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); togglePop(blockPopEl); }, true);

        vidOffEl = document.createElement('span');
        vidOffEl.className = 'btn vidoff';
        vidOffEl.title = 'Stop showing clips in this tab — still images only, until you reload';
        vidOffEl.textContent = '▶';
        vidOffEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        vidOffEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); stopVideoPreviews(); }, true);

        aaEl = document.createElement('span');
        aaEl.className = 'btn aa';
        aaEl.textContent = 'AA';
        aaEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        aaEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); togglePop(aaPopEl); }, true);

        capEl.appendChild(capNameEl);
        capEl.appendChild(capHintEl);
        capEl.appendChild(capMetaEl);
        capEl.appendChild(blockEl);
        capEl.appendChild(vidOffEl);
        capEl.appendChild(aaEl);

        aaPopEl = buildPop();
        popHead(aaPopEl, 'How the image is drawn when the preview is bigger than the original.',
            ' Point at one to see it; click to keep it.');
        SMOOTHING_OPTS.forEach(function (o) {
            const it = popItem(aaPopEl, o[1], o[2]);
            it.dataset.val = o[0];
            it.addEventListener('mouseenter', function () { previewSmoothing(o[0]); });
            it.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation(); chooseSmoothing(o[0]);
            }, true);
        });
        // Leaving without choosing puts the saved one back.
        aaPopEl.addEventListener('mouseleave', function () { previewSmoothing(null); });

        blockPopEl = buildPop();
        popHead(blockPopEl, 'Never preview this image again.',
            ' It goes on the Exceptions list in Hover Zoom settings, where you can take it off ' +
            'again. The page itself is not changed.');
        const acts = document.createElement('div');
        acts.className = 'acts';
        const noBtn = document.createElement('button');
        noBtn.textContent = 'Cancel';
        noBtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation(); closePops();
        }, true);
        const yesBtn = document.createElement('button');
        yesBtn.className = 'go';
        yesBtn.textContent = 'Never preview it';
        yesBtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation(); closePops(); blockCurrent();
        }, true);
        acts.appendChild(noBtn);
        acts.appendChild(yesBtn);
        blockPopEl.appendChild(acts);

        edgeEls = ['t', 'l', 'r', 'b'].map(function (k) {
            const d = document.createElement('div');
            d.className = 'edge ' + k;
            return d;
        });

        box.appendChild(imgEl);
        box.appendChild(vidEl);
        edgeEls.forEach(function (d) { box.appendChild(d); });
        box.appendChild(capEl);
        box.appendChild(aaPopEl);
        box.appendChild(blockPopEl);
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

        // Both hosts sit at the maximum z-index, so DOM order is the only tie-break left: a
        // preview first opened while the panel is up would otherwise bury the panel's controls.
        const parent = document.body || document.documentElement;
        if (panelHost && panelHost.parentNode === parent) parent.insertBefore(host, panelHost);
        else parent.appendChild(host);
    }

    // ----------------------------------------------------------------- geometry

    const EDGE_GAP = 4;

    const MIN_FRAME = 48;

    function chrome() {
        return Math.max(0, Math.min(80, cfg.frameMargin | 0));
    }

    // What sits between view.left/top and the picture's own top-left, and the window's outer size.
    function insetX() { return cfg.borderWidth; }
    function insetY() { return cfg.borderWidth; }
    function outerW() { return view.frameW + insetX() * 2; }
    function outerH() { return view.frameH + insetY() * 2; }

    function usableHeight() {
        // The floor is because the Browser pane reports clientHeight 0 while it is hidden.
        return Math.max(64, document.documentElement.clientHeight);
    }

    // The box a preview OPENS into.
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

    // The zoom floor, and what `0` returns to.
    function fitScaleFor(w, h) {
        if (!w || !h) return 1;
        if (view && view.fixedW != null) return Math.min(view.fixedW / w, view.fixedH / h);
        const m = viewportBox();
        return Math.min(cfg.zoomFactor, m.w / w, m.h / h);
    }

    const MIN_MEDIA = 32;

    function minScaleFor(w, h) {
        if (!w || !h) return 1;
        return Math.min(MIN_MEDIA / Math.max(w, h), fitScaleFor(w, h));
    }

    // The frame follows the picture, up to the growth ceiling.
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

    const REACH_INSET = 10;

    function nudgeIntoReach() {
        const ow = outerW();
        const oh = outerH();
        if (pointer.x < view.left + REACH_INSET) view.left = pointer.x - REACH_INSET;
        else if (pointer.x > view.left + ow - REACH_INSET) view.left = pointer.x - ow + REACH_INSET;
        if (pointer.y < view.top + REACH_INSET) view.top = pointer.y - REACH_INSET;
        else if (pointer.y > view.top + oh - REACH_INSET) view.top = pointer.y - oh + REACH_INSET;
    }

    const KEEP_ON_SCREEN = 72;

    // Two different jobs behind one name.
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

    const RESIZE_OUT = 6;     // px outside the window edge that still resizes
    const RESIZE_IN = 6;      // px inside it — together, a 12px strip centred on the edge
    const MOVE_BAND = 13;     // px further in that moves the window
    const CORNER_REACH = 24;  // px from a corner where a drag resizes both axes at once

    function hitRegion(x, y) {
        if (!view) return null;
        const ow = outerW();
        const oh = outerH();
        const rx = x - view.left, ry = y - view.top;
        if (rx < -RESIZE_OUT || ry < -RESIZE_OUT ||
            rx > ow + RESIZE_OUT || ry > oh + RESIZE_OUT) return null;
        const dl = rx, dr = ow - rx, dt = ry, db = oh - ry;
        const corner = Math.min(CORNER_REACH, ow / 3, oh / 3);
        const rb = Math.min(RESIZE_IN, ow / 6, oh / 6);
        const cl = dl <= corner, cr = dr <= corner, ct = dt <= corner, cb = db <= corner;
        if ((cl || cr) && (ct || cb)) {
            return { kind: 'resize', ex: cl ? 'l' : 'r', ey: ct ? 't' : 'b' };
        }
        if (dl <= rb) return { kind: 'resize', ex: 'l', ey: null };
        if (dr <= rb) return { kind: 'resize', ex: 'r', ey: null };
        if (dt <= rb) return { kind: 'resize', ex: null, ey: 't' };
        if (db <= rb) return { kind: 'resize', ex: null, ey: 'b' };
        if (!chromeVisible() || !chromeThickness()) return null;
        const m = Math.max(rb + MOVE_BAND, chromeThickness() + cfg.borderWidth);
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

    // Filename and format, both taken from the URL — the only source available without a second request.
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

    // Byte size for free: the probe already fetched it, so the Resource Timing entry is there.
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
        if (placed || Math.abs(view.scale - view.fitScale) > 1e-6) {
            parts.push(Math.round(view.scale * 100) + '%');
        }
        capMetaEl.textContent = parts.join('  ·  ');
    }

    const BAR_SHOW_MS = 120;

    // The bar's height, fixed so the ring around it can be a matching thickness.
    const BAR_MIN_H = 24;
    const BTN_RIGHT = 20;       // the rightmost button's inset
    const BTN_STEP = 24;        // and the pitch of the ones beside it

    let barTimer = 0;

    // The bar must not fade while the pointer is ON it.
    function pointerOverBar() {
        if (!capEl || !view || !box || !box.classList.contains('on')) return false;
        if (capEl.style.display === 'none') return false;
        const r = capEl.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        return pointer.x >= r.left && pointer.x <= r.right &&
               pointer.y >= r.top && pointer.y <= r.bottom;
    }

    // The margin ring counts too, for the same reason the bar does.
    function pointerOverChrome() {
        if (pointerOverBar()) return true;
        if (!view || !box || !box.classList.contains('on') || !chrome()) return false;
        const ow = outerW(), oh = outerH();
        const rx = pointer.x - view.left, ry = pointer.y - view.top;
        if (rx < 0 || ry < 0 || rx > ow || ry > oh) return false;
        const m = chromeThickness() + cfg.borderWidth;
        return rx < m || ry < m || ow - rx < m || oh - ry < m;
    }

    // Whether the frame's own furniture — bar and margin — is showing.
    function chromeVisible() {
        return !!box && !box.classList.contains('idle');
    }

    function barIdleMs() {
        return Math.max(0, Math.min(60000, cfg.barIdleMs | 0));
    }

    // Zero idle means the bar and grab border never appear at all — the timer version of that
    // shows them for one frame and fades, which is what "0 still shows it briefly" was.
    function barAlwaysIdle() {
        return !!cfg.barFade && !barIdleMs();
    }

    // The class lives on the BOX, not on the bar. `nobar` kills the transition too, or the
    // never-shown case still fades from opacity 1 the first time the window opens.
    function showBar() {
        if (!box) return;
        clearTimeout(barTimer);
        barTimer = 0;
        box.classList.toggle('nobar', barAlwaysIdle());
        if (barAlwaysIdle()) { box.classList.add('idle'); return; }
        box.classList.remove('idle');
        if (!cfg.barFade) return;               // stays up for as long as the window does
        barTimer = setTimeout(function () {
            barTimer = 0;
            if (!box || !view) return;
            if (pointerOverChrome() || popOpen()) { showBar(); return; }   // parked on it: keep it
            box.classList.add('idle');
        }, barIdleMs());
    }

    function resetBar() {
        clearTimeout(barTimer);
        barTimer = 0;
        if (!box) return;
        box.classList.toggle('nobar', barAlwaysIdle());
        box.classList.toggle('idle', barAlwaysIdle());
    }

    // Point the frame at a resolved candidate, picking the face that can display it.
    function setMedia(res) {
        const wantsVideo = !!res.video;
        mediaEl = wantsVideo ? vidEl : imgEl;
        const idle = wantsVideo ? imgEl : vidEl;
        idle.hidden = true;
        clearMedia(idle);
        mediaEl.hidden = false;
        applySmoothing();
        if (!wantsVideo && noReferrerHere()) imgEl.referrerPolicy = 'no-referrer';
        mediaEl.src = res.url;
        if (wantsVideo) {
            const started = vidEl.play();
            if (started && started.catch) started.catch(function () { /* torn down or blocked */ });
        }
    }

    function clearMedia(el) {
        if (!el) return;
        if (el === vidEl) { vidEl.pause(); vidEl.removeAttribute('src'); vidEl.load(); }
        else el.removeAttribute('src');
    }

    // WHAT LOADED IS NOT WHAT WAS MEASURED.
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

    // How thick the drawn margin actually is.
    function chromeThickness() {
        if (!view) return 0;
        return Math.round(Math.min(chrome(), view.frameW / 3, view.frameH / 3));
    }

    // The margin strips, which float over the picture and therefore have to be re-placed whenever the frame changes size.
    function layoutChrome() {
        const m = chromeThickness();
        const px = function (n) { return n + 'px'; };
        edgeEls[0].style.cssText = 'left:0;right:0;top:0;height:' + px(m);
        edgeEls[1].style.cssText = 'left:0;top:' + px(m) + ';bottom:0;width:' + px(m);
        edgeEls[2].style.cssText = 'right:0;top:' + px(m) + ';bottom:0;width:' + px(m);
        edgeEls[3].style.cssText = cfg.showStatusBar ? 'display:none'
            : 'left:' + px(m) + ';right:' + px(m) + ';bottom:0;height:' + px(m);
        const hasVid = mediaEl === vidEl;
        capEl.classList.toggle('hasvid', hasVid);
        // Right to left, skipping the ▶ when the frame is not holding a clip; the gutter has to
        // clear whatever is actually there or the filename runs under the buttons.
        let right = BTN_RIGHT;
        blockEl.style.right = px(right); right += BTN_STEP;
        if (hasVid) { vidOffEl.style.right = px(right); right += BTN_STEP; }
        aaEl.style.right = px(right); right += BTN_STEP;
        aaEl.classList.toggle('sharp', smoothingMode() !== 'auto');
        aaEl.title = 'How the image is drawn when it is enlarged';
        capEl.style.paddingRight =
            px(placed ? Math.min(right + 2, Math.max(8, view.frameW - 8)) : 8);
    }

    function layout() {
        if (!view || !mediaEl) return;
        clampPosition();
        box.style.left = Math.round(view.left) + 'px';
        box.style.top = Math.round(view.top) + 'px';
        gripEl.style.left = Math.round(view.left - RESIZE_OUT) + 'px';
        gripEl.style.top = Math.round(view.top - RESIZE_OUT) + 'px';
        gripEl.style.width = Math.round(outerW() + RESIZE_OUT * 2) + 'px';
        gripEl.style.height = Math.round(outerH() + RESIZE_OUT * 2) + 'px';
        gripEl.classList.toggle('hot', placed);
        box.style.width = view.frameW + 'px';
        box.style.height = view.frameH + 'px';
        layoutChrome();
        mediaEl.style.width = Math.round(view.imgW) + 'px';
        mediaEl.style.height = Math.round(view.imgH) + 'px';
        mediaEl.style.left = Math.round(view.ox) + 'px';
        mediaEl.style.top = Math.round(view.oy) + 'px';
        box.classList.toggle('hot', placed);
        box.classList.toggle('pan', placed && pannable());
        caption();
        if (spinDocked) moveSpinner();      // the dock rides with the frame
    }

    // Zoom about a point given in SCREEN coordinates, keeping whatever pixel of the image sits under it there afterwards.
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

        const fx = view.frameW ? ax / view.frameW : 0.5;
        const fy = view.frameH ? ay / view.frameH : 0.5;

        view.scale = nextScale;
        reflow();                       // new frame size; offsets are re-derived below
        view.left = screenX - insetX() - fx * view.frameW;
        view.top = screenY - insetY() - fy * view.frameH;
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

    // Whatever the pan clamp refuses moves the WINDOW instead, or a frame bigger than the screen
    // has edges of the picture nobody can ever reach.
    function panBy(dx, dy) {
        if (!view || !pannable()) return;
        const wasX = view.ox, wasY = view.oy;
        view.ox += dx;
        view.oy += dy;
        reflow();
        const spareX = dx - (view.ox - wasX);
        const spareY = dy - (view.oy - wasY);
        if (spareX || spareY) { view.left += spareX; view.top += spareY; }
        layout();
    }

    const SPINNER_DELAY = 150;   // don't flash it for a cached or instant resolve

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

    // A shadow with no SPREAD is half-hidden under the box: its own edge sits on the box's, so the
    // darkest part visible outside is 50% of the colour. Spread pushes the solid part out first.
    function shadowCss() {
        if (!cfg.shadow) return 'none';
        const size = Math.max(0, Math.min(120, cfg.shadowSize | 0));
        const a = Math.max(0, Math.min(100, cfg.shadowStrength | 0)) / 100;
        if (!size || !a) return 'none';
        return '0 ' + Math.round(size / 10) + 'px ' + size + 'px ' + Math.round(size / 2) + 'px ' +
            'rgba(0,0,0,' + a.toFixed(2) + ')';
    }

    // Everything the appearance settings write to a window that is already up, so changing one
    // while a preview is open shows it (see the panel's live mode).
    function applyLook() {
        if (!host || !box) return;
        host.style.setProperty('--fade', cfg.fadeMs + 'ms');
        host.style.setProperty('--barfade', barFadeMs() + 'ms');
        box.style.border = cfg.borderWidth > 0
            ? cfg.borderWidth + 'px solid ' + cfg.borderColor : 'none';
        box.style.borderRadius = cfg.cornerRadius + 'px';
        box.style.boxShadow = shadowCss();
        paintOver(box, 'background-color', '#1e1e2e');
        if (cfg.borderWidth > 0) paintOver(box, 'border-color', cfg.borderColor);
    }

    function barFadeMs() {
        return Math.max(0, Math.min(10000, cfg.barFadeMs | 0));
    }

    function showViewer(res, pointer) {
        buildViewer();

        const m = viewportBox();
        const fit = Math.min(cfg.zoomFactor, m.w / res.w, m.h / res.h);

        view = {
            url: res.url, natW: res.w, natH: res.h,
            scale: fit, fitScale: fit,
            imgW: 0, imgH: 0, frameW: 0, frameH: 0, ox: 0, oy: 0, left: 0, top: 0,
            // null until a hand resize pins the edges; resizeBy() is the only writer.
            fixedW: null, fixedH: null,
        };
        reflow();

        applyLook();

        const ow = outerW();
        const oh = outerH();
        if (cfg.position === 'center') {
            view.left = (m.vw - ow) / 2;
            view.top = (m.vh - oh) / 2;
        } else {
            // Beside the pointer, on whichever side has more room.
            const rightRoom = m.vw - pointer.x;
            view.left = rightRoom >= ow ? pointer.x : pointer.x - ow;
            view.top = pointer.y - oh / 2;
            nudgeIntoReach();
        }

        setMedia(res);
        layout();
        deferredCaption(res.url);

        // Start every open from a settled opacity 0, or the fade is whatever the last fade-out
        // left behind — returning to an image mid-fade looked like the setting doing nothing.
        box.classList.remove('on');
        box.style.transition = 'none';
        box.style.opacity = '0';
        void box.offsetWidth;
        box.style.transition = '';
        box.style.opacity = '';
        box.classList.add('on');
        showBar();
    }

    // A better original arrived while the preview is already up.
    function upgradeViewer(res) {
        if (!view) return;
        const centreX = view.left + outerW() / 2;
        const centreY = view.top + outerH() / 2;
        // where the frame's middle sits in the picture, as a fraction of it
        const fx = view.imgW ? (view.frameW / 2 - view.ox) / view.imgW : 0.5;
        const fy = view.imgH ? (view.frameH / 2 - view.oy) / view.imgH : 0.5;
        const prevImgW = view.imgW;
        const userSized = view.fixedW != null || Math.abs(view.scale - view.fitScale) > 1e-6;

        view.url = res.url;
        view.natW = res.w;
        view.natH = res.h;
        view.fitScale = fitScaleFor(res.w, res.h);
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
        if (!cfg.showStatusBar || transferBytes(url)) return;
        setTimeout(function () { if (view && view.url === url) caption(); }, 300);
    }

    function hideViewer() {
        if (!box) return;
        closePops();
        box.classList.remove('on', 'hot', 'pan', 'drag');
        box.style.cursor = '';      // onMove writes this inline over the bands; see hitRegion
        if (gripEl) { gripEl.classList.remove('hot'); gripEl.style.cursor = ''; }
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

    const CAP_TARGET = window;
    const WHEEL_OPTS = { capture: true, passive: false };

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

    let wheelZoomOn = false;

    // Bound when the window is PLACED, not when it appears.
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

    // Hovering becomes placed, and there is nothing in between.
    function place() {
        if (placed || !view) return;
        placed = true;
        clearTimeout(timer);
        box.classList.add('placed');
        dimEl.classList.add('catch');
        CAP_TARGET.addEventListener('keydown', onPinKey, true);
        // The wheel becomes the window's only now — see enableWheelZoom.
        enableWheelZoom();
        layout();
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

    // Controls that live INSIDE the box.
    function isBoxControl(t) {
        return blockEl.contains(t) || vidOffEl.contains(t) || aaEl.contains(t) ||
            aaPopEl.contains(t) || blockPopEl.contains(t);
    }

    // ---- the two popovers a status-bar button opens

    function buildPop() {
        const d = document.createElement('div');
        d.className = 'pop';
        d.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        return d;
    }

    function popHead(pop, lead, rest) {
        const h = document.createElement('div');
        h.className = 'head';
        const b = document.createElement('b');
        b.textContent = lead;
        h.appendChild(b);
        h.appendChild(document.createTextNode(rest));
        pop.appendChild(h);
        return h;
    }

    function popItem(pop, label, sub) {
        const it = document.createElement('div');
        it.className = 'item';
        it.appendChild(document.createTextNode(label));
        const s = document.createElement('span');
        s.className = 'sub';
        s.textContent = sub;
        it.appendChild(s);
        pop.appendChild(it);
        return it;
    }

    function popOpen() {
        return !!(aaPopEl && (aaPopEl.classList.contains('open') ||
            blockPopEl.classList.contains('open')));
    }

    function closePops() {
        if (!aaPopEl) return;
        if (aaPopEl.classList.contains('open')) previewSmoothing(null);
        aaPopEl.classList.remove('open');
        blockPopEl.classList.remove('open');
    }

    function togglePop(pop) {
        const wasOpen = pop.classList.contains('open');
        closePops();
        if (!wasOpen) {
            pop.classList.add('open');
            markSmoothing();
        }
        showBar();
    }

    // ---- smoothing: a stored setting, chosen from the frame instead of the panel

    let smoothingPreview = null;    // what the pointer is resting on in the menu

    function smoothingMode() {
        return smoothingPreview || cfg.smoothing || 'auto';
    }

    function applySmoothing() {
        const v = smoothingMode();
        if (imgEl) imgEl.style.imageRendering = v;
        if (vidEl) vidEl.style.imageRendering = v;
    }

    function markSmoothing() {
        if (!aaPopEl) return;
        const now = smoothingMode();
        [].forEach.call(aaPopEl.querySelectorAll('.item'), function (it) {
            it.classList.toggle('on', it.dataset.val === (cfg.smoothing || 'auto'));
        });
        aaEl.classList.toggle('sharp', now !== 'auto');
    }

    function previewSmoothing(v) {
        smoothingPreview = v;
        applySmoothing();
        markSmoothing();
    }

    function chooseSmoothing(v) {
        smoothingPreview = null;
        reloadSettings();               // this writes the whole object back
        cfg.smoothing = v;
        saveSettings();
        applySmoothing();
        closePops();
        markSmoothing();
        dbg('smoothing', v);
    }

    // "Stop showing clips in this tab", from the ▶ in the status bar.
    function stopVideoPreviews() {
        playVideos = false;
        dbg('video previews off for this tab');
        probeCache.clear();
        dismiss();
    }

    // "Never preview this image again", from the ⊘ in the status bar.
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
        refreshPanel();             // the Exceptions list is on screen behind this window
        dismiss();
    }

    // Placing happens on the PRESS, so by the time a click arrives the window is already placed and there is nothing left f...
    function onBoxClick(e) {
        if (isBoxControl(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
    }

    function onBoxDown(e) {
        if (isBoxControl(e.target)) return;
        closePops();                // a press anywhere else puts an open menu away
        if (e.button !== 0 && e.button !== 2) return;

        if (placed) {
            if (e.button !== 0) return;
        } else if (e.button !== (cfg.pinButton === 'right' ? 2 : 0)) {
            altButton(e);           // the other button dismisses a hover preview
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (!view) return;
        swallowNextClick = true;    // the click half of this press is ours too
        if (!placed) place();

        const reg = hitRegion(e.clientX, e.clientY);
        const onBar = capEl.contains(e.target) && !(reg && reg.kind === 'resize');
        if (reg && reg.kind === 'resize') {
            drag = {
                mode: 'resize', ex: reg.ex, ey: reg.ey,
                x0: e.clientX, y0: e.clientY,
                w0: view.frameW, h0: view.frameH, l0: view.left, t0: view.top,
                aspect: view.frameH ? view.frameW / view.frameH : 1,
                spilling: pannable(),
                refit: !pannable() && Math.abs(view.scale - view.fitScale) < 1e-6,
            };
        } else {
            const onFrame = onBar || (reg && reg.kind === 'move');   // reg is never 'resize' here
            const mode = onFrame || !pannable() ? 'move' : 'pan';
            drag = { x: e.clientX, y: e.clientY, mode: mode };
        }
        box.classList.add('drag');
    }

    // A corner or an edge drag.
    function resizeBy(e) {
        const g = growBox();
        let w = drag.w0, h = drag.h0;
        if (drag.ex) w = drag.w0 + (drag.ex === 'r' ? 1 : -1) * (e.clientX - drag.x0);
        if (drag.ey) h = drag.h0 + (drag.ey === 'b' ? 1 : -1) * (e.clientY - drag.y0);
        if (e.shiftKey && drag.aspect > 0) {
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

    // The settings panel is another window on top of this one: what lands inside it is its own
    // scrolling and typing, not the preview's to take.
    function panelOwns(e) {
        if (!panelHost) return false;
        if (!e || !e.composedPath) return false;
        return e.composedPath().indexOf(panelHost) !== -1;
    }

    function onPinKey(e) {
        if (!placed || !view) return;
        if (panelOwns(e)) return;
        // The panel is the window on top, so Escape is ITS exit before it is this one's —
        // wherever the focus happens to be. One press must not close both.
        if (e.key === 'Escape' && panelHost) return;
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

    // A wheel over a PLACED window is the window's; anywhere else, and in every other state, it is the page's.
    function onPinWheel(e) {
        if (!view || !placed) return;
        if (panelOwns(e)) return;
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
    let swallowNextClick = false;
    let suppressed = null;  // element whose preview was dismissed; skipped until re-entered
    let activeCovered = false;
    let suppressedCovered = false;
    let swallowMenu = false;
    let pointer = { x: 0, y: 0 };
    let mouseDown = false;
    let modifierDown = false;

    // A hover preview cannot be hit-tested, so "is the pointer on it" is answered from `view` instead.
    // A hover preview is pinned by pressing it — but with position:center the pointer is nowhere
    // near it, so the press that pins it is the one on the picture that produced it.
    function pressPinsPreview(e) {
        if (!view || !box || !box.classList.contains('on')) return false;
        if (pointInPreview(e.clientX, e.clientY)) return true;
        if (cfg.position !== 'center' || !active) return false;
        return e.target === active || (active.contains && active.contains(e.target));
    }

    function pointInPreview(x, y) {
        if (!view || !box || !box.classList.contains('on')) return false;
        const w = outerW();
        const h = outerH();
        return x >= view.left && x <= view.left + w && y >= view.top && y <= view.top + h;
    }

    function ours(node) {
        if (panelHost && (node === panelHost ||
            (panelHost.contains && panelHost.contains(node)))) return true;
        return !!host && (node === host || (host.contains && host.contains(node)));
    }

    function modifierHeld(e) {
        if (cfg.modifierKey === 'ctrl') return e.ctrlKey;
        if (cfg.modifierKey === 'alt') return e.altKey;
        if (cfg.modifierKey === 'shift') return e.shiftKey;
        return false;
    }

    const NEVER = { VIDEO: 1, AUDIO: 1, IFRAME: 1, CANVAS: 1, OBJECT: 1, EMBED: 1,
        SOURCE: 1, TRACK: 1 };

    const VIDEO_LINK_RE = new RegExp([
        'youtu\\.be/',
        '/watch\\?',
        '/shorts/',
        '/embed/',
        '/videos?/',
        '\\.(?:mp4|webm|m3u8|mov|mkv|avi)(?:$|[?#])',
    ].join('|'), 'i');

    const PLAYER_UP = 3;
    const PLAYER_FILL = 0.5;

    const GIF_MAX_SECS = 60;

    function gifLike(v) {
        if (v.controls || v.hasAttribute('controls')) return false;
        if (!v.muted) return false;
        if (!(v.loop || v.autoplay)) return false;
        const d = v.duration;
        return isFinite(d) && d > 0 && d <= GIF_MAX_SECS;
    }

    // The first non-gif <video> inside `n`, or null.
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
            if (gifLike(vids[i])) { out.push({ what: 'gif (not a player)', rect: v, gif: true }); continue; }
            out.push({ what: 'video', rect: v });
            const area = v.width * v.height;
            let n = vids[i].parentElement;
            for (let up = 0; n && up < PLAYER_UP; up++, n = n.parentElement) {
                const r = n.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) continue;
                if (area < r.width * r.height * PLAYER_FILL) break;   // too big to be this video's player
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

    // closest() and parentElement both stop dead at a shadow-root boundary.
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

    // Returns WHY this element counts as video, or null.
    function videoReason(el) {
        if (el.closest && el.closest('video')) return 'inside a <video>';
        if (overVideoSurface(el)) return 'over a laid-out <video> rectangle';
        let n = el;
        for (let up = 0; n && up < 4; up++, n = n.parentElement) {
            if (up > 0 && n.querySelectorAll && n.querySelectorAll('img').length > 1) break;
            if (playerIn(n)) return '<video> in ancestor #' + up;
        }
        const linked = videoLinkReason(el);
        if (linked) return linked;
        return null;
    }

    // Split out of videoReason() because a gif-style clip that is ITSELF the hover target needs this gate and none of the o...
    function videoLinkReason(el) {
        const a = closestAcross(el, 'a[href]');
        const href = a ? (a.getAttribute('href') || '') : '';
        if (href && VIDEO_LINK_RE.test(href)) return 'video link: ' + href;
        return null;
    }

    function inVideoContext(el) {
        return !!videoReason(el);
    }

    const BAND_WIDTH = 0.98;    // of the viewport — a full-bleed band reaches both edges
    const CONTENT_CHARS = 40;   // text this long is a paragraph, not a tile's caption

    function wallpaperReason(el) {
        if (el === document.body || el === document.documentElement) return 'the page background';
        const s = getComputedStyle(el);
        if (s.backgroundAttachment.indexOf('fixed') >= 0)
            return 'background-attachment: fixed — it does not scroll with the page';
        if (!/no-repeat/.test(s.backgroundRepeat) && /^auto/.test(s.backgroundSize))
            return 'tiled end to end';
        const r = el.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        if (vw > 0 && r.width >= vw * BAND_WIDTH) return 'spans the full width of the page';
        if ((el.textContent || '').trim().length >= CONTENT_CHARS)
            return 'the page\'s own text sits on it';
        return null;
    }

    const BANNER_TOP = 300;         // px from the top of the document
    const BANNER_MIN = 240;         // px wide on screen
    const BANNER_BAND = 3;          // width ÷ height — below this it is picture-shaped
    const BESIDE_PEER = 0.15;       // a neighbour this fraction of the width may be a row-mate
    const PEER_HEIGHT = 0.3;        // ...and only if its height is within this much of ours

    // Conditions (1) to (3) — everything that needs only the picture's OWN rectangle.
    function bannerShape(w, h, docTop) {
        const band = h > 0 ? w / h : 0;
        const where = Math.round(w) + '×' + Math.round(h) + ' (' + band.toFixed(1) + ':1) at ' +
            Math.round(docTop) + 'px from the top of the document';
        if (w < BANNER_MIN || h < 2)
            return { band: false, why: where + '; a banner is at least ' + BANNER_MIN + 'px wide' };
        if (docTop > BANNER_TOP)
            return { band: false, why: where + '; a banner starts within ' + BANNER_TOP + 'px of the top' };
        if (band < BANNER_BAND)
            return { band: false, why: where + '; a banner is a band of at least ' +
                BANNER_BAND + ':1, and this is picture-shaped' };
        return { band: true, why: where };
    }

    // Returns WHICH condition decided and the numbers it decided on, for both answers.
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
        const shape = bannerShape(r.width, r.height, r.top + (window.scrollY || 0));
        if (!shape.band) return { banner: false, why: shape.why };
        const where = shape.why;
        const src = shownUrl(el) || '';
        const lists = [document.getElementsByTagName('img'), document.getElementsByTagName('video')];
        let beside = null;
        for (let l = 0; l < lists.length && !beside; l++) {
            for (let i = 0; i < lists[l].length; i++) {
                const n = lists[l][i];
                if (n === el) continue;
                const q = n.getBoundingClientRect();
                if (q.width < 2 || q.height < 2) continue;
                if (q.width < r.width * BESIDE_PEER) continue;
                if (Math.abs(q.height - r.height) > Math.max(q.height, r.height) * PEER_HEIGHT)
                    continue;
                const mid = q.top + q.height / 2;
                if (mid < r.top || mid > r.bottom) continue;
                if (q.right > r.left && q.left < r.right) continue;
                if (src && (shownUrl(n) || '') === src) continue;
                if (!reallyVisible(n)) continue;
                beside = Math.round(q.width) + '×' + Math.round(q.height) + ' at x=' +
                    Math.round(q.left);
                break;
            }
        }
        if (beside) return { banner: false, why: where + ', but a ' + beside +
            ' picture of the same height sits beside it, so this is one item in a row' };
        return { banner: true, why: where + ' — a band above where the page\'s content ' +
            'begins, with nothing of its height beside it' };
    }

    function bannerReason(el) {
        const c = bannerCheck(el);
        return c.banner ? c.why : null;
    }

    // What the page itself says is not content.
    function decorativeReason(el) {
        if (!el.getAttribute) return null;
        if (el.getAttribute('aria-hidden') === 'true') return 'aria-hidden="true"';
        const role = (el.getAttribute('role') || '').toLowerCase();
        if (role === 'presentation' || role === 'none') return 'role="' + role + '"';
        return null;
    }

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

    // `x`/`y` are the pointer, and are what makes the cover walk possible; called without them this is the plain element te...
    function eligible(el, x, y) {
        const direct = eligibleDirect(el);
        if (direct) return direct;
        if (typeof x !== 'number') return null;
        const under = coveredMedia(el, x, y);
        return under ? eligibleDirect(under) : null;
    }

    function eligibleDirect(el) {
        if (!el) return null;
        if (el.tagName === 'VIDEO') {
            if (!playVideos || !gifLike(el)) return null;
            if (!cfg.previewVideos && videoLinkReason(el)) return null;
            return blocked(shownUrl(el)) ? null : el;
        }
        if (NEVER[el.tagName]) return null;
        if (!cfg.previewVideos && inVideoContext(el)) return null;
        if (cfg.skipFurniture && decorativeReason(el)) return null;
        // Before the <img> branch, because this is the one furniture rule that applies to one.
        if (cfg.skipFurniture && bannerReason(el)) return null;
        if (el.tagName === 'IMG') return blocked(shownUrl(el)) ? null : el;
        // element with a background image and no img of its own
        if (el.querySelector && el.querySelector('img')) return null;
        const bg = backgroundUrl(el);
        if (!bg || blocked(bg)) return null;
        if (cfg.skipFurniture && wallpaperReason(el)) return null;
        return el;
    }

    // One console line per hover, when `debug` is on.
    function hoverReport(t, el) {
        const a = closestAcross(t, 'a[href]');
        const rect = t.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
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
            resolvedFrom: !el ? '(nothing)'
                : el === t ? 'the hover target itself'
                    : 'looked through the cover to ' + el.tagName +
                      (el.id ? '#' + el.id : '') + ' — ' + (shownUrl(el) || '').slice(0, 120),
            previewVideos: cfg.previewVideos,
            videoGate: videoReason(t) || 'none — NOT treated as video',
            backgroundGate: t.tagName === 'IMG' || t.tagName === 'VIDEO' ? 'n/a — not a background'
                : !backgroundUrl(t) ? 'n/a — no background image'
                    : (wallpaperReason(t) || 'none — NOT treated as page furniture'),
            decorativeGate: decorativeReason(t) || 'none — not marked decorative',
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

    function dismiss() {
        suppressed = active;            // read it before unplace()/cancel() clear it
        suppressedCovered = activeCovered;
        if (placed) unplace(); else cancel();
    }

    // The button that does NOT place.
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
        if (over) showBar();
        if (box && placed && !drag) {
            const reg = hitRegion(e.clientX, e.clientY);
            const c = reg && reg.kind === 'resize' ? regionCursor(reg)
                : (chromeVisible() && pointerOverBar() ? 'move' : regionCursor(reg));
            box.style.cursor = c;
            if (gripEl) gripEl.style.cursor = c;
        }
        if (!drag || !view) return;
        if (e.buttons === 0) { endDrag(); return; }
        if (drag.mode === 'resize') { resizeBy(e); return; }
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!dx && !dy) return;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (drag.mode === 'move') {
            view.left += dx;
            view.top += dy;
            layout();       // clampPosition() keeps a grabbable strip of it on screen
        } else {
            panBy(dx, dy);
        }
    }

    function onOver(e) {
        if (placed) return;
        if (drag) return;
        if (ours(e.target)) return;         // on our own overlay
        if (!siteEnabled()) return;
        if (mouseDown) return;
        if (cfg.activation === 'modifier' && !modifierHeld(e) && !modifierDown) return;

        const el = eligible(e.target, e.clientX, e.clientY);
        if (cfg.debug) dbg('hover', hoverReport(e.target, el));
        if (!el) {
            if (active && !active.contains(e.target) &&
                !(activeCovered && stillUnderPointer(active, e.clientX, e.clientY))) cancel();
            return;
        }
        if (el === suppressed) return;      // dismissed; stays down until the pointer leaves
        if (el === active) return;

        cancel();
        const displayed = sizeOf(el);
        if (displayed.w < cfg.minDisplayed && displayed.h < cfg.minDisplayed) return;

        active = el;
        activeCovered = (el !== e.target);
        activeShown = shownUrl(el);
        const myToken = token = { cancelled: false };
        timer = setTimeout(async function () {
            showSpinner();
            try {
                await resolve(el, displayed, myToken,
                    function (hit) {
                        if (myToken.cancelled || active !== el) return;
                        if (view && box.classList.contains('on')) upgradeViewer(hit);
                        else { showViewer(hit, pointer); dockSpinner(); }
                    });
            } finally {
                if (!myToken.cancelled) hideSpinner();
            }
        }, cfg.hoverDelay);
    }

    // Is the picture still under the pointer?
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
            if (!inside && (suppressedCovered || e.target === suppressed)) {
                suppressed = null;  // left the image; hovering it again may preview again
                suppressedCovered = false;
            }
        }
        if (!active) return;
        if (to && active.contains && active.contains(to)) return;   // still inside the image
        if (activeCovered && stillUnderPointer(active, e.clientX, e.clientY)) return;
        cancel();
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);

    CAP_TARGET.addEventListener('mousedown', function (e) {
        swallowNextClick = false;
        if (ours(e.target)) { claimClick(); return; }   // onBoxDown / the backdrop own this one
        if (!placed && (e.button === 0 || e.button === 2) && pressPinsPreview(e)) {
            claimClick();
            onBoxDown(e);
            return;
        }
        if (e.button === 2 && overOurs(e) && altButton(e)) { claimClick(); return; }
        releaseClick();
        mouseDown = true;
        cancel();
    }, true);
    CAP_TARGET.addEventListener('click', function (e) {
        if (swallowNextClick) {
            swallowNextClick = false;
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (dimEl && dimEl.classList.contains('catch') && e.composedPath &&
            e.composedPath()[0] === dimEl) {
            e.preventDefault();
            e.stopPropagation();
            dismiss();
            return;
        }
        if (ours(e.target)) return;             // onBoxClick owns it
        if (placed) return;
        if (!pressPinsPreview(e)) return;
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
    window.addEventListener('scroll', function (e) {
        if (!placed && !panelOwns(e)) cancel();
    }, true);
    window.addEventListener('blur', function () { if (!placed) cancel(); });
    window.addEventListener('resize', function () {
        if (!placed) { cancel(); return; }
        if (!view) return;
        view.fitScale = fitScaleFor(view.natW, view.natH);
        const lo = minScaleFor(view.natW, view.natH);
        if (view.scale < lo) view.scale = lo;
        reflow();
        layout();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && panelHost) {
            closePanel();                       // the panel is on top; it closes first
            e.stopPropagation();
            return;
        }
        if (e.key === 'Escape') {
            cancel();                           // onPinKey has already handled the placed case
        }
        if (cfg.activation === 'modifier' && modifierHeld(e) && !modifierDown) {
            modifierDown = true;
            hoverAtPointer();
        }
    }, true);
    document.addEventListener('keyup', function (e) {
        if (cfg.activation === 'modifier' && !modifierHeld(e)) { modifierDown = false; cancel(); }
    }, true);

    // The pointer is not moving, so onOver is synthesised from where it already is.
    function hoverAtPointer() {
        if (placed || drag || active) return;
        if (!document.elementFromPoint) return;
        const el = document.elementFromPoint(pointer.x, pointer.y);
        if (!el) return;
        onOver({ target: el, clientX: pointer.x, clientY: pointer.y });
    }

    // -------------------------------------------------------------- settings UI

    const C = { base: '#1e1e2e', surface: '#313244', surface2: '#45475a', text: '#cdd6f4',
        sub: '#a6adc8', blue: '#89b4fa', green: '#a6e3a1', red: '#f38ba8' };

    let panelHost = null;
    let panelFlush = null;      // commits an open "edit as text" box, whatever closes the panel
    let panelPos = null;        // where the panel has been dragged to
    let advOpen = false;        // the fold survives the re-render every outside write needs

    function closePanel() {
        if (panelFlush) { panelFlush(); panelFlush = null; }
        if (panelHost) { panelHost.remove(); panelHost = null; }
    }

    // Anything writing cfg from OUTSIDE the panel re-renders it, or it shows stale values.
    function refreshPanel() {
        if (panelHost) openPanel();
    }

    // The manager's menu — a fresh visit, so the fold starts shut and the window is placed again.
    function showPanel() {
        advOpen = false;
        panelPos = null;
        openPanel();
    }

    // A re-render must not throw the reader back to the top of a ~3000px scroller.
    function panelScroll() {
        const b = panelHost && panelHost.shadowRoot && panelHost.shadowRoot.querySelector('.body');
        return b ? b.scrollTop : 0;
    }

    function openPanel() {
        const keepScroll = panelScroll();
        closePanel();
        reloadSettings();
        // Never modal: the host covers the viewport, so without this it eats every hover on the page.
        panelHost = document.createElement('div');
        panelHost.style.cssText =
            'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
        const sr = panelHost.attachShadow({ mode: 'open' });

        const st = document.createElement('style');
        st.textContent = [
            ':host{all:initial}',
            '*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}',
            '.panel{position:fixed;width:520px;max-width:94vw;',
            'max-height:88vh;display:flex;flex-direction:column;overflow:hidden;background:' + C.base + ';',
            'color:' + C.text + ';border:1px solid ' + C.surface2 + ';',
            'border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.75);font-size:13px;',
            'pointer-events:auto}',
            '.body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px 16px}',
            // The title bar is OUTSIDE the scroller, or it is gone the moment you scroll.
            '.head{flex:none;margin:0;display:flex;align-items:baseline;gap:8px;cursor:move;',
            'padding:10px 20px 9px;font-size:15px;font-weight:600;color:' + C.text + ';',
            'border-bottom:1px solid ' + C.surface + '}',
            '.head .ver{font-weight:400;font-size:12px;color:' + C.sub + '}',
            // Two more handles, because the pointer is usually already somewhere else on a
            // window this tall. Source order puts them over the body and the footer.
            '.grab{position:absolute;cursor:move;background:transparent}',
            '.grab:hover{background:' + C.surface + '}',
            '.grab.l{left:0;top:0;bottom:0;width:7px}',
            '.grab.b{left:0;right:0;bottom:0;height:7px}',
            'h3{margin:18px 0 8px;font-size:12px;font-weight:600;text-transform:uppercase;',
            'letter-spacing:.06em;color:' + C.sub + ';border-bottom:1px solid ' + C.surface + ';padding-bottom:5px}',
            '.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:5px 0}',
            '.row label{flex:1;cursor:pointer}',
            '.row[hidden]{display:none}',
            '.hint{display:block;font-size:11px;color:' + C.sub + ';margin-top:1px}',
            'input[type=checkbox]{accent-color:' + C.blue + ';width:15px;height:15px;cursor:pointer;flex:none}',
            'input[type=number],input[type=text],select,textarea{background:' + C.surface + ';color:' + C.text + ';',
            'border:1px solid ' + C.surface2 + ';border-radius:5px;padding:4px 7px;font-size:12px}',
            'input[type=number]{width:74px}',
            'input[type=color]{width:40px;height:26px;padding:0;border:1px solid ' + C.surface2 + ';',
            'border-radius:5px;background:' + C.surface + ';cursor:pointer}',
            'textarea{width:100%;height:64px;resize:vertical;font-family:ui-monospace,monospace}',
            // Not sticky — a flex row below the scroller, or content shows under it.
            '.foot{flex:none;display:flex;gap:8px;align-items:center;padding:12px 20px;',
            'background:' + C.base + ';border-top:1px solid ' + C.surface + '}',
            '.foot .auto{flex:1;font-size:11px;color:' + C.sub + '}',
            'button{background:' + C.surface + ';color:' + C.text + ';border:1px solid ' + C.surface2 + ';',
            'border-radius:6px;padding:6px 14px;font-size:12px;cursor:pointer}',
            'button:hover{background:' + C.surface2 + '}',
            'button.primary{background:' + C.blue + ';color:' + C.base + ';border-color:' + C.blue + ';font-weight:600}',
            'button.add{background:' + C.green + ';color:' + C.base + ';border-color:' + C.green + ';font-weight:600}',
            'button.danger{color:' + C.red + '}',
            '.listbtns{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}',
            '.listwrap{margin-top:4px}',
            '.listwrap + .listwrap{margin-top:18px}',
            '.listhead{font-size:12.5px;font-weight:600;color:' + C.text + ';margin-bottom:3px}',
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
            '.listtext{width:100%;height:150px;margin-top:8px;resize:vertical;',
            'font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.5}',
            '.edittext{padding:4px 10px;font-size:11px}',
            'details.adv{margin-top:20px;border-top:1px solid ' + C.surface + ';padding-top:4px}',
            'details.adv summary{cursor:pointer;list-style:revert;padding:8px 0;font-size:12px;',
            'font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:' + C.sub + '}',
            'details.adv summary:hover{color:' + C.text + '}',
            'details.adv summary .hint{text-transform:none;letter-spacing:0;font-weight:400}',
            'details.adv h3:first-of-type{margin-top:6px}',
            '.intro{font-size:12.5px;line-height:1.55;color:' + C.text + ';margin:0 0 10px}',
            '.intro b{color:' + C.blue + ';font-weight:600}',
            '.guide{display:none;margin:2px 0 14px;padding:12px 14px;border-radius:8px;',
            'background:' + C.surface + ';font-size:12px;line-height:1.55;color:#bac2de}',
            '.guide.open{display:block}',
            '.guide p{margin:0 0 9px}',
            '.guide p:last-child{margin-bottom:0}',
            '.guide b{color:' + C.text + ';font-weight:600}',
            '.guidebtn{margin-bottom:14px;padding:5px 12px;font-size:12px}',
        ].join('');
        sr.appendChild(st);

        const panel = document.createElement('div');
        panel.className = 'panel';
        sr.appendChild(panel);

        // Moving off the panel commits whatever is half-typed. A number otherwise sits in its
        // box until you click somewhere else, which is the wrong thing to have to do while
        // watching the preview it changes. The text editor is exempt — it commits on its own
        // blur, and losing it because the pointer wandered would drop a paste in progress.
        panel.addEventListener('mouseleave', function () {
            const a = sr.activeElement;
            if (!a || a.tagName === 'TEXTAREA' || typeof a.blur !== 'function') return;
            a.blur();
        });

        function placePanel() {
            if (!panelPos) return;
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;
            if (vw && vh) {             // the Browser pane reports 0 while hidden
                const keep = 80;
                panelPos.left = Math.max(keep - panel.offsetWidth, Math.min(panelPos.left, vw - keep));
                panelPos.top = Math.max(0, Math.min(panelPos.top, vh - 34));
            }
            panel.style.left = panelPos.left + 'px';
            panel.style.top = panelPos.top + 'px';
        }

        function startPanelDrag(e) {
            if (e.button !== 0) return;
            e.preventDefault();
            const r = panel.getBoundingClientRect();
            const ox = e.clientX - r.left, oy = e.clientY - r.top;
            const move = function (ev) {
                panelPos = { left: ev.clientX - ox, top: ev.clientY - oy };
                placePanel();
            };
            const up = function () {
                window.removeEventListener('mousemove', move, true);
                window.removeEventListener('mouseup', up, true);
            };
            window.addEventListener('mousemove', move, true);
            window.addEventListener('mouseup', up, true);
        }

        const h = document.createElement('h2');
        h.className = 'head';
        h.title = 'Drag to move';
        h.textContent = 'Hover Zoom — settings';
        const ver = document.createElement('span');
        ver.className = 'ver';
        ver.textContent = version();
        h.appendChild(ver);
        h.addEventListener('mousedown', startPanelDrag);
        panel.appendChild(h);

        const body = document.createElement('div');
        body.className = 'body';
        panel.appendChild(body);

        // What Undo changes goes back to: the whole object as it stood when the panel opened.
        const opened = JSON.parse(JSON.stringify(cfg));

        // Every control writes as it is changed, so there is no Save to miss and no Cancel to lie.
        function persist() {
            saveSettings();
            probeCache.clear();
            refreshSiteMenu();
            applyLook();                    // a preview that is already up follows along
            if (view && box && box.classList.contains('on')) { reflow(); layout(); showBar(); }
        }

        let mount = body;

        function section(title) {
            const s = document.createElement('h3');
            s.textContent = title;
            mount.appendChild(s);
        }

        // The fold at the bottom.
        function advanced(title, summaryHint) {
            const d = document.createElement('details');
            d.className = 'adv';
            const sum = document.createElement('summary');
            sum.textContent = title;
            if (summaryHint) {
                const hint = document.createElement('span');
                hint.className = 'hint';
                hint.textContent = summaryHint;
                sum.appendChild(hint);
            }
            d.appendChild(sum);
            d.open = advOpen;
            d.addEventListener('toggle', function () { advOpen = d.open; });
            body.appendChild(d);
            mount = d;
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
            mount.appendChild(r);
            return r;
        }

        function check(key, labelText, hintText) {
            const el = document.createElement('input');
            el.type = 'checkbox';
            el.checked = !!cfg[key];
            el.addEventListener('change', function () { cfg[key] = el.checked; persist(); });
            return { el: el, row: row(labelText, hintText, el) };
        }

        // On `change`, not `input`: a half-typed number is not a value anyone meant to save.
        function num(key, labelText, hintText, min, max, step) {
            const el = document.createElement('input');
            el.type = 'number';
            el.value = cfg[key];
            el.min = min; el.max = max; el.step = step || 1;
            el.addEventListener('change', function () {
                const v = parseFloat(el.value);
                if (isNaN(v)) { el.value = cfg[key]; return; }
                cfg[key] = Math.max(min, Math.min(max, v));
                el.value = cfg[key];
                persist();
            });
            // Enter fires `change` on its own, but leaves the caret sitting in the box.
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
            });
            return { el: el, row: row(labelText, hintText, el) };
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
            el.addEventListener('change', function () { cfg[key] = el.value; persist(); });
            return { el: el, row: row(labelText, hintText, el) };
        }

        // A list editor for one of the array settings, laid out the same way as the one in Open Links in New Tab.
        function list(key, opts) {
            const items = cfg[key].slice();

            function store() { cfg[key] = items.slice(); persist(); }

            // Alphabetical for the host lists; the block list stays in the order things were
            // added, so the one just added by mistake is the last row.
            function sortItems() {
                if (opts.chronological) return;
                items.sort(function (a, b) {
                    return a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b);
                });
            }
            sortItems();

            const wrap = document.createElement('div');
            wrap.className = 'listwrap';

            if (opts.heading) {
                const hd = document.createElement('div');
                hd.className = 'listhead';
                hd.textContent = opts.heading;
                wrap.appendChild(hd);
            }

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
                        const at = items.indexOf(item);
                        if (at !== -1) items.splice(at, 1);
                        store();
                        render();
                    });
                    r.appendChild(label);
                    r.appendChild(rm);
                    entries.appendChild(r);
                });
                // The newest is the last row, so show that end of it.
                if (opts.chronological) entries.scrollTop = entries.scrollHeight;
            }

            function add(raw) {
                const value = String(raw || '').trim();
                if (!value) return;
                if (items.indexOf(value) === -1) { items.push(value); sortItems(); store(); }
                input.value = '';
                render();
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

            const textarea = document.createElement('textarea');
            textarea.className = 'listtext';
            textarea.spellcheck = false;
            textarea.hidden = true;

            const editBtn = document.createElement('button');
            editBtn.className = 'edittext';
            editBtn.type = 'button';
            editBtn.textContent = 'Edit as text';
            editBtn.title = 'One entry per line — paste a list in, or copy this one out';

            function editing() { return !textarea.hidden; }

            function openText() {
                textarea.value = items.join('\n');
                textarea.hidden = false;
                entries.hidden = true;
                addRow.hidden = true;
                editBtn.textContent = 'Done editing';
                textarea.focus();
            }

            function commitText() {
                if (!editing()) return;
                const seen = Object.create(null);
                const next = [];
                textarea.value.split('\n').forEach(function (line) {
                    const v = line.trim();
                    if (!v || seen[v]) return;
                    seen[v] = 1;
                    next.push(v);
                });
                items.length = 0;
                Array.prototype.push.apply(items, next);
                sortItems();
                store();
                textarea.hidden = true;
                entries.hidden = false;
                addRow.hidden = false;
                editBtn.textContent = 'Edit as text';
                render();
            }

            textarea.addEventListener('blur', commitText);
            // Or the press blurs the textarea, commitText() closes it, and the click that follows
            // sees "not editing" and re-opens it — Done editing looks dead.
            editBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
            editBtn.addEventListener('click', function () {
                if (editing()) { commitText(); } else { openText(); }
            });

            const editRow = document.createElement('div');
            editRow.className = 'listbtns';
            editRow.appendChild(editBtn);

            wrap.appendChild(addRow);
            wrap.appendChild(entries);
            wrap.appendChild(textarea);
            wrap.appendChild(editRow);
            mount.appendChild(wrap);
            render();

            return { items: items, flush: commitText };
        }

        function color(key, labelText) {
            const el = document.createElement('input');
            el.type = 'color';
            el.value = cfg[key];
            el.addEventListener('change', function () { cfg[key] = el.value; persist(); });
            return { el: el, row: row(labelText, null, el) };
        }

        const intro = document.createElement('p');
        intro.className = 'intro';
        intro.textContent =
            'Point at any image and Hover Zoom finds the full-size original and shows it. ' +
            'Click that preview to keep it on screen — then scroll to make it bigger, drag it ' +
            'anywhere, and right-click it to save or copy. Hit Escape or click outside the ' +
            'preview to close it.';
        body.appendChild(intro);

        const guideBtn = document.createElement('button');
        guideBtn.className = 'guidebtn';
        guideBtn.textContent = 'How it works';

        const guide = document.createElement('div');
        guide.className = 'guide';

        function para(lead, rest) {
            const p = document.createElement('p');
            const b = document.createElement('b');
            b.textContent = lead + ' ';
            p.appendChild(b);
            p.appendChild(document.createTextNode(rest));
            guide.appendChild(p);
        }

        para('Finding the original.',
            'Nothing is decided until you point at something. It then works from what the page ' +
            'itself offers — a bigger version named in the markup, the same URL with the ' +
            'thumbnail’s size stripped out of it — and, when the image links to its own ' +
            'page on the same site, it reads that page and takes whatever the site declares ' +
            'there. Every candidate is loaded and measured, so a preview is verified to be ' +
            'bigger rather than guessed at. There is no list of supported sites.');
        para('A ring means it is still looking.',
            'The first thing found appears immediately; if something better turns up a moment ' +
            'later it replaces it in place, without moving what you are looking at.');
        para('One press keeps it.',
            'A click — or the start of a drag — pins the preview. It then stays until you press ' +
            'Escape or click outside the preview to close it. Nothing else holds it open, and the page underneath ' +
            'stays readable and scrollable while it is there.');
        para('Moving, sizing and zooming.',
            'Drag the frame around the image, or its status bar, to move the window; drag an ' +
            'edge or a corner to resize it, holding Shift to keep its shape. The wheel grows the ' +
            'whole window until you resize it by hand, after which it zooms the image inside ' +
            'the frame instead. Arrow keys pan, + and − zoom, 0 fits.');
        para('Saving a copy.',
            'Right-click a pinned preview and you get the browser’s own menu — Save image ' +
            'as…, Copy image, Copy image address, Open image in new tab — all of them acting ' +
            'on the full-size original. On a preview you are only hovering, right-click dismisses ' +
            'it instead.');
        para('Something previewing that should not.',
            'Pin it and press ⊘ in its status bar: that image goes on the never-preview list ' +
            'below, which is the answer to a tiled background or a watermark that previews from ' +
            'everywhere. For a whole site, the userscript manager’s menu has an ' +
            'enable/disable entry for the page you are on.');
        para('Clips.',
            'A short muted clip already looping with no controls is an animated image, not a ' +
            'video, and previews as one — some posts have no still form at all. Press ▶ in a ' +
            'pinned preview’s status bar to go back to still images for the rest of the ' +
            'tab; reloading the page restores it.');

        guideBtn.addEventListener('click', function () {
            const open = guide.classList.toggle('open');
            guideBtn.textContent = open ? 'Hide the details' : 'How it works';
        });
        body.appendChild(guideBtn);
        body.appendChild(guide);

        section('The preview');
        const act = pick('activation', 'Show a preview',
            'either order works with the key — hold it and then point, or point and then press it', [
                ['hover', 'When I hover over an image'],
                ['modifier', 'Only when the modifier key is held']]);
        const modKey = pick('modifierKey', 'Modifier key', null, [
            ['ctrl', 'Ctrl'], ['alt', 'Alt'], ['shift', 'Shift']]);
        function syncModKey() { modKey.row.hidden = act.el.value !== 'modifier'; }
        act.el.addEventListener('change', syncModKey);
        syncModKey();
        const pos = pick('position', 'Opens', ' ', [
            ['cursor', 'Beside the pointer'], ['center', 'Centred in the window']]);
        const posHint = pos.row.querySelector('.hint');
        function syncPos() {
            posHint.textContent = pos.el.value === 'center'
                ? 'the pointer is nowhere near it, so click the image you are pointing at to ' +
                  'pin the preview — then hit Escape or click outside the preview to close it'
                : 'opens under the pointer, so a click pins it without moving the mouse';
        }
        pos.el.addEventListener('change', syncPos);
        syncPos();
        pick('pinButton', 'Pin preview with',
            'which button keeps a preview on screen. The other one closes it without ' +
            'following the link underneath', [
                ['left', 'Left click  (right click dismisses)'],
                ['right', 'Right click  (left click dismisses)']]);
        check('previewVideos', 'Preview videos as well',
            'off by default, because pointing at a video is usually aiming to play it and a ' +
            'preview lands on what you were about to click. This is about video thumbnails and ' +
            'players — a short looping clip with no controls counts as an animated image and ' +
            'previews either way');
        check('skipFurniture', 'Ignore backgrounds and banners',
            'page furniture rather than images on the page: the page’s own background, a ' +
            'tiled or fixed one, a strip spanning the window, one the page’s text sits on, ' +
            'the banner across the top, and anything the page marks as decoration. Turn off if ' +
            'it is skipping images you want');

        section('Where it runs');
        pick('siteMode', 'Site list', null, [
            ['blacklist', 'Disable on listed sites'], ['whitelist', 'Enable only on listed sites']]);

        const sites = list('siteList', {
            description: 'Subdomains are included, so example.com also covers www.example.com.',
            examples: 'Examples: example.com, news.ycombinator.com',
            placeholder: 'e.g. example.com',
            addCurrentLabel: '+ This Site',
            addCurrentTitle: pageHost(),
            currentValue: function () { return pageHost(); },
        });

        section('Exceptions');
        const blocks = list('blockList', {
            heading: 'Never preview these images',
            chronological: true,
            description: 'Individual images that never open a preview. The quickest way to add ' +
                'one is the ⊘ button on a pinned preview. Newest last, so an accidental one is ' +
                'the bottom row. A * matches anything.',
            examples: 'Examples: https://example.com/tile.png, https://cdn.example.com/wm/*',
            placeholder: 'e.g. https://example.com/watermark.png',
        });

        const refSites = list('referrerSites', {
            heading: 'Load previews without a referrer on these sites',
            description: 'The browser normally tells the image host which page asked for it. A ' +
                'few hosts refuse a request that names another site, and their previews come up ' +
                'blank or as a “no hotlinking” placeholder while the page’s own thumbnails look ' +
                'fine — add that site here. It is per site because stripping the referrer has ' +
                'the opposite effect on hosts that require their own site as the referrer, ' +
                'where it turns working previews blank.',
            examples: 'Subdomains are included, same as the site list above',
            placeholder: 'e.g. example.com',
            addCurrentLabel: '+ This Site',
            addCurrentTitle: pageHost(),
            currentValue: function () { return pageHost(); },
        });

        advanced('Advanced options', '  timings, sizes, appearance');

        section('Matching');
        num('hoverDelay', 'Delay before the preview appears',
            'how long the pointer rests on an image first, in ms. A short wait stops previews ' +
            'firing as you sweep the pointer across a page', 0, 3000, 10);
        num('minDisplayed', 'Ignore images smaller than',
            'the size it is displayed at, in px — skips icons', 0, 2000, 1);
        num('minRatio', 'Required upsize',
            'the original must be at least this many times the size of the image on the page, ' +
            'so 1 means anything bigger at all. Below 1 previews an image that is no bigger — ' +
            'useful for working out why something gives no preview. Applies to what a linked ' +
            'page declares as well as to what the script works out for itself', 0.1, 100, 0.1);

        section('The preview window');
        num('wheelZoomStep', 'Wheel zoom step',
            'how much one wheel notch changes the zoom, in %. The + and − keys always step by 25%',
            2, 100, 1);
        num('panStep', 'Arrow-key pan step',
            'how far one press moves the image, in px — hold Shift for 3×', 5, 500, 5);
        num('maxZoom', 'Maximum zoom',
            'how far you can zoom in by hand, in multiples of the original’s own size', 1, 64, 1);
        num('maxSizeMultiple', 'Maximum window size',
            'how large the preview window may be grown, in multiples of the browser window. A ' +
            'preview always opens no larger than the browser window; this is the ceiling for ' +
            'growing it yourself afterwards, with the wheel or by dragging a corner', 1, 4, 0.25);
        num('zoomFactor', 'Opening zoom limit',
            'how far a SMALL image is enlarged when the preview first opens, in multiples of ' +
            'the original’s own size (1 = never enlarged). It is still fitted inside the ' +
            'browser window, so anything larger than that opens smaller than this', 0.1, 8, 0.1);

        section('Appearance');
        num('fadeMs', 'Preview fade',
            'time the preview window takes to fade in when it opens, and out when it closes, ' +
            'in ms', 0, 1000, 10);
        num('borderWidth', 'Border thickness', 'in px', 0, 20, 1);
        color('borderColor', 'Border colour');
        num('cornerRadius', 'Corner radius', 'in px', 0, 40, 1);
        num('frameMargin', 'Grab border',
            'width of the frame drawn over the edges of the image, in px, matching the status ' +
            'bar along the bottom. This is the strip you grab to move the window at any zoom — ' +
            'and it stops being a handle once it has faded', 0, 80, 2);
        const barFade = check('barFade', 'Fade the grab border and status bar out',
            'off keeps both of them on screen for as long as the preview window is up');
        const barIdle = num('barIdleMs', 'Grab border fades after',
            'how long the pointer stays still first, in ms. Set it to 0 and the grab border and ' +
            'the status bar never appear at all — the window is then moved by dragging the ' +
            'middle of an unzoomed image, and resized from its very edge', 0, 60000, 100);
        const barTake = num('barFadeMs', 'Grab border fade takes',
            'how long that fade takes, in ms. Both come back instantly on any movement over ' +
            'the preview', 0, 10000, 100);
        function syncBarFade() {
            barIdle.row.hidden = !barFade.el.checked;
            barTake.row.hidden = !barFade.el.checked;
        }
        barFade.el.addEventListener('change', syncBarFade);
        syncBarFade();
        const shadow = check('shadow', 'Drop shadow',
            'a soft shadow under the preview window, which separates it from the page behind it');
        const shadowSize = num('shadowSize', 'Shadow size',
            'the blur under the window, in px — 0 is none, 60 is a wide soft pool', 0, 120, 4);
        const shadowStrength = num('shadowStrength', 'Shadow strength',
            'how dark that shadow is at its centre, in %', 0, 100, 5);
        function syncShadow() {
            shadowSize.row.hidden = !shadow.el.checked;
            shadowStrength.row.hidden = !shadow.el.checked;
        }
        shadow.el.addEventListener('change', syncShadow);
        syncShadow();
        check('showStatusBar', 'Show the status bar',
            'filename, format, dimensions and size along the bottom, and the ⊘, ▶ and AA ' +
            'buttons — AA is where smoothing is chosen, on the image you are looking at. It ' +
            'doubles as the window’s title bar, and fades out with the grab border');
        pick('spinnerTheme', 'Loading ring',
            'the ring shown while it is still searching. Matching means the light-or-dark ' +
            'preference the browser reports to pages, which on every desktop browser is the ' +
            'operating system’s setting — the browser’s own theme does not change it', [
                ['auto', 'Match the system'], ['dark', 'Always dark'], ['light', 'Always light']]);
        section('Diagnostics');
        check('debug', 'Log every hover to the console',
            'one line per hover in the browser console (F12): what was under the pointer, which ' +
            'gates fired and why, and the URLs tried. Noisy — on only while chasing a problem');

        const foot = document.createElement('div');
        foot.className = 'foot';

        const auto = document.createElement('span');
        auto.className = 'auto';
        auto.textContent = 'Changes save as you make them.';

        const reset = document.createElement('button');
        reset.className = 'danger';
        reset.textContent = 'Reset to defaults';
        reset.addEventListener('click', function () {
            cfg = Object.assign({}, DEFAULTS);
            saveSettings();
            probeCache.clear();
            refreshSiteMenu();
            openPanel();
        });

        // Back to the values this panel opened on, whatever has been saved since.
        const undo = document.createElement('button');
        undo.textContent = 'Undo changes';
        undo.addEventListener('click', function () {
            cfg = JSON.parse(JSON.stringify(opened));
            saveSettings();
            probeCache.clear();
            refreshSiteMenu();
            openPanel();
        });

        const close = document.createElement('button');
        close.className = 'primary';
        close.textContent = 'Close';
        close.addEventListener('click', closePanel);

        // An open "edit as text" box commits on blur, which a click can outrun; every exit runs this.
        panelFlush = function () {
            sites.flush();
            blocks.flush();
            refSites.flush();
        };

        foot.appendChild(auto);
        foot.appendChild(reset);
        foot.appendChild(undo);
        foot.appendChild(close);
        panel.appendChild(foot);

        // Last, so they sit over the body and the footer rather than under them.
        ['l', 'b'].forEach(function (k) {
            const g = document.createElement('div');
            g.className = 'grab ' + k;
            g.title = 'Drag to move';
            g.addEventListener('mousedown', startPanelDrag);
            panel.appendChild(g);
        });

        (document.body || document.documentElement).appendChild(panelHost);

        if (!panelPos) {                    // out of the way, on the right: the page is the point
            panelPos = {
                left: Math.max(12, document.documentElement.clientWidth - panel.offsetWidth - 24),
                top: 40,
            };
        }
        placePanel();
        body.scrollTop = keepScroll;
    }

    if (isTopFrame && typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Hover Zoom settings', showPanel);
        refreshSiteMenu();
    }

    dbg('loaded', {
        version: version(),
        url: location.href,
        topFrame: isTopFrame,
        siteEnabled: siteEnabled(),
        previewVideos: cfg.previewVideos,
        playVideos: playVideos,
        skipFurniture: cfg.skipFurniture,
        blockList: cfg.blockList.length,
        minRatio: cfg.minRatio,
        minDisplayed: cfg.minDisplayed,
    });
})();
