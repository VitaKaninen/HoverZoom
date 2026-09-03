// ==UserScript==
// @name        Hover Zoom
// @namespace   https://github.com/VitaKaninen
// @version     0.10.0
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
        keepSearching: true,        // show the first hit at once, then keep probing and upgrade in place
        skipWhileMouseDown: true,   // don't fire mid drag/selection
        siteMode: 'blacklist',      // 'blacklist' | 'whitelist'
        siteList: [],               // hostnames, matched by suffix

        // pinned mode
        pinButton: 'left',          // 'left' | 'right' — whichever pins, the other dismisses
        wheelZoomStep: 15,          // % per wheel notch
        panStep: 80,                // px per arrow-key press (Shift = 3x)
        maxZoom: 32,                // hard ceiling, multiples of natural size

        // how to display
        maxWidthPct: 92,            // % of viewport
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
        showStatusBar: true,        // filename / type / size / dimensions strip, also the move handle
        spinnerTheme: 'auto',       // 'auto' (follows the browser) | 'dark' | 'light'
        noReferrer: false,          // strip referrer when loading full image
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

    // Site-agnostic rewrites that turn a thumbnail URL into its original.
    // Each returns a new URL string, or null when it doesn't apply.
    const UPGRADES = [
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
        const shown = el.tagName === 'IMG' ? (el.currentSrc || el.src) : backgroundUrl(el);
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
        const shown = el.tagName === 'IMG' ? (el.currentSrc || el.src) : backgroundUrl(el);
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
            if (onHit && !token.cancelled) onHit(best);
            if (!cfg.keepSearching) return best;
        }
        if (best) return best;
        if (cfg.showEvenIfNotLarger && shown && !token.cancelled) {
            const dim = await probe(shown);
            if (dim) {
                best = { url: shown, w: dim.w, h: dim.h };
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
    let capEl = null, capNameEl = null, capMetaEl = null, spinEl = null, spinSvg = null;
    let menuEl = null, menuBtn = null;

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
            // The browser's own context menu cannot be raised from script — a dispatched
            // contextmenu event is untrusted and browsers run no default action for it —
            // and right-click is spoken for by dismiss anyway. This is the replacement:
            // the actions that menu was wanted for, on a button that is always reachable.
            '.cap .more{flex:none;align-self:center;width:18px;height:18px;display:flex;',
            'align-items:center;justify-content:center;border-radius:4px;cursor:pointer;',
            'color:#a6adc8;font:14px/1 system-ui,sans-serif;margin-left:-2px}',
            '.cap .more:hover{background:#45475a;color:#cdd6f4}',
            // A sibling of .box, not a child: .box has overflow:hidden and a small preview
            // would clip the menu to nothing.
            '.menu{position:fixed;display:none;min-width:168px;padding:4px;',
            'background:#1e1e2e;border:1px solid #45475a;border-radius:6px;',
            'box-shadow:0 8px 24px rgba(0,0,0,.55);user-select:none;',
            'font:12px/1.4 system-ui,sans-serif;color:#cdd6f4}',
            '.menu.on{display:block}',
            '.menu .item{padding:6px 10px;border-radius:4px;cursor:pointer;white-space:nowrap}',
            '.menu .item:hover{background:#45475a}',
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
        menuBtn = document.createElement('div');
        menuBtn.className = 'more';
        menuBtn.title = 'Image actions';
        menuBtn.textContent = '⋮';
        menuBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (menuEl.classList.contains('on')) closeMenu(); else openMenu();
        });

        capEl.appendChild(capNameEl);
        capEl.appendChild(capMetaEl);
        capEl.appendChild(menuBtn);

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

        menuEl = document.createElement('div');
        menuEl.className = 'menu';
        MENU_ITEMS.forEach(function (it) {
            const row = document.createElement('div');
            row.className = 'item';
            row.textContent = it[1];
            row.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                runMenu(it[0]);
            });
            menuEl.appendChild(row);
        });
        root.appendChild(menuEl);

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

    function viewportBox() {
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        return {
            vw: vw,
            vh: vh,
            w: Math.max(32, vw * (cfg.maxWidthPct / 100) - cfg.borderWidth * 2),
            h: Math.max(32, vh * (cfg.maxHeightPct / 100) - cfg.borderWidth * 2),
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
        view.left = Math.max(4, Math.min(view.left, m.vw - ow - 4));
        view.top = Math.max(4, Math.min(view.top, m.vh - oh - 4));
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
        if (!flashTimer) capNameEl.textContent = info.name;   // a flash owns the name slot
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

    // ------------------------------------------------------------- image actions
    //
    // The browser's own context menu is not available to us. A dispatched `contextmenu`
    // event is untrusted, and browsers run no default action for untrusted events — the
    // menu is user-agent chrome, raised only by real input — so a button that "simulates a
    // right click" would do precisely nothing. Right-click is also already spoken for by
    // dismiss, and `swallowMenu` suppresses the native menu that press would raise.
    //
    // So this is our own menu, carrying the actions that one was wanted for. Two of them
    // need to READ the image bytes, which is a cross-origin fetch: hosts that send no
    // Access-Control-Allow-Origin will refuse, and there is no way around that from a page
    // context. Both fail soft, say so in the status bar, and fall back to opening the image
    // in a tab where the browser's real menu is available on it.

    const MENU_ITEMS = [
        ['tab', 'Open image in new tab'],
        ['url', 'Copy image URL'],
        ['copy', 'Copy image'],
        ['save', 'Save image…'],
    ];

    let flashTimer = 0;

    // Transient message in the status bar's name slot. caption() steps aside while one is
    // up, or the next layout() would wipe it a frame later.
    function flash(msg) {
        if (!capNameEl) return;
        clearTimeout(flashTimer);
        capNameEl.textContent = msg;
        flashTimer = setTimeout(function () {
            flashTimer = 0;
            if (view) caption();
        }, 1800);
    }

    function menuOpen() {
        return !!menuEl && menuEl.classList.contains('on');
    }

    function openMenu() {
        if (!view || !menuEl) return;
        menuEl.classList.add('on');
        // Aiming at a menu item means moving off the image, which would otherwise take the
        // preview — and the menu with it — down mid-gesture.
        if (!pinned) detach();
        const b = menuBtn.getBoundingClientRect();
        const m = viewportBox();
        const w = menuEl.offsetWidth;
        const h = menuEl.offsetHeight;
        let top = b.top - h - 6;                       // above the bar, where the room is
        if (top < 4) top = Math.min(b.bottom + 6, m.vh - h - 4);
        menuEl.style.left = Math.max(4, Math.min(b.right - w, m.vw - w - 4)) + 'px';
        menuEl.style.top = Math.max(4, top) + 'px';
    }

    function closeMenu() {
        if (menuEl) menuEl.classList.remove('on');
    }

    function legacyCopy(s) {
        try {
            const ta = document.createElement('textarea');
            ta.value = s;
            ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
            (document.body || document.documentElement).appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (e) { return false; }
    }

    function writeText(s) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(s).then(
                function () { return true; },
                function () { return legacyCopy(s); });
        }
        return Promise.resolve(legacyCopy(s));
    }

    function fetchBlob(url) {
        const opts = { credentials: 'omit' };
        if (cfg.noReferrer) opts.referrerPolicy = 'no-referrer';
        return fetch(url, opts).then(function (r) {
            if (!r.ok) throw new Error(r.status);
            return r.blob();
        });
    }

    // ClipboardItem accepts PNG everywhere and little else, so anything that is not already
    // PNG goes through a canvas. That needs the bitmap, which needs the same CORS grant the
    // fetch needed, so it fails in the same cases and no earlier.
    function toPng(blob) {
        return new Promise(function (res, rej) {
            const url = URL.createObjectURL(blob);
            const im = new Image();
            im.onload = function () {
                try {
                    const c = document.createElement('canvas');
                    c.width = im.naturalWidth;
                    c.height = im.naturalHeight;
                    c.getContext('2d').drawImage(im, 0, 0);
                    c.toBlob(function (b) {
                        URL.revokeObjectURL(url);
                        b ? res(b) : rej(new Error('encode'));
                    }, 'image/png');
                } catch (e) { URL.revokeObjectURL(url); rej(e); }
            };
            im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
            im.src = url;
        });
    }

    function openTab(url) {
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    function runMenu(kind) {
        const url = view && view.url;
        closeMenu();
        if (!url) return;

        if (kind === 'tab') { openTab(url); return; }

        if (kind === 'url') {
            writeText(url).then(function (ok) { flash(ok ? 'URL copied' : 'copy blocked'); });
            return;
        }

        if (kind === 'copy') {
            if (!navigator.clipboard || !window.ClipboardItem) {
                flash('this browser cannot copy images');
                return;
            }
            // ClipboardItem takes a PROMISE for its data, and clipboard.write() is called
            // synchronously here, still inside the click. Fetching first and writing in a
            // .then() instead loses the transient user activation and the write is rejected
            // with NotAllowedError — measured, that is exactly what the first version did.
            flash('copying image…');
            const png = fetchBlob(url).then(function (b) {
                return b.type === 'image/png' ? b : toPng(b);
            });
            png.catch(function () { /* reported by the write below; not also unhandled */ });
            navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(
                function () { flash('image copied'); },
                function () { flash('copy blocked — try Open image in new tab'); });
            return;
        }

        if (kind === 'save') {
            flash('saving…');
            fetchBlob(url).then(function (blob) {
                const href = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = href;
                a.download = fileInfo(url).name || 'image';
                a.style.display = 'none';
                (document.body || document.documentElement).appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { URL.revokeObjectURL(href); }, 10000);
                flash('saved');
            }, function () {
                // No openTab() here: this runs after the fetch, so the user activation is
                // gone and window.open would be popup-blocked — or, worse, navigate the tab
                // the user is on. The first menu item does the same thing, from a click.
                flash('host blocked the download — try Open image in new tab');
            });
        }
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
        closeMenu();
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
    // control added inside the box goes in here.
    function isBoxControl(t) {
        return closeEl.contains(t) || menuBtn.contains(t);
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
        closeMenu();            // a press anywhere else on the frame dismisses it
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
            case 'Escape': if (menuOpen()) closeMenu(); else unpin(); break;
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
        closeMenu();            // it is anchored to the bar, and the bar is about to move
        const f = 1 + cfg.wheelZoomStep / 100;
        zoomAt(view.scale * (e.deltaY < 0 ? f : 1 / f), e.clientX, e.clientY);
    }

    // ------------------------------------------------------------- interaction

    let active = null;      // element currently zoomed or pending
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
    function overVideoSurface(el) {
        const vids = document.getElementsByTagName('video');
        if (!vids.length) return false;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        for (let i = 0; i < vids.length; i++) {
            const v = vids[i].getBoundingClientRect();
            if (v.width < 2 || v.height < 2) continue;
            if (cx >= v.left && cx <= v.right && cy >= v.top && cy <= v.bottom) return true;
        }
        return false;
    }

    function inVideoContext(el) {
        if (el.closest && el.closest('video')) return true;
        if (overVideoSurface(el)) return true;
        // Walk up only while the ancestor still looks like ONE card. The moment it holds
        // more than one image it is a grid or a page, and a <video> anywhere else in it
        // would poison every image on the page. Measured 2026-09-03: without this bound the
        // single 1×1 <video> fixture on the test page disabled all nineteen cases.
        let n = el;
        for (let up = 0; n && up < 4; up++, n = n.parentElement) {
            if (up > 0 && n.querySelectorAll && n.querySelectorAll('img').length > 1) break;
            if (n.querySelector && n.querySelector('video')) return true;
        }
        const a = el.closest && el.closest('a[href]');
        return !!(a && VIDEO_LINK_RE.test(a.getAttribute('href') || ''));
    }

    function eligible(el) {
        if (!el) return null;
        if (NEVER[el.tagName]) return null;
        if (cfg.skipVideos && inVideoContext(el)) return null;
        if (el.tagName === 'IMG') return el;
        // element with a background image and no img of its own
        if (el.querySelector && el.querySelector('img')) return null;
        return backgroundUrl(el) ? el : null;
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
        detached = false;
        disableWheelZoom();
        closeMenu();
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
    function altButton(e) {
        let acted = false;
        if (cfg.pinButton === 'right') {
            if (!pinned && view && box.classList.contains('on')) { pin(); acted = true; }
        } else if (pinned || active) {
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
    document.addEventListener('mousedown', function (e) {
        if (!ours(e.target)) closeMenu();
        if (ours(e.target)) return;     // onBoxDown / the backdrop own this one
        // An unpinned preview is pointer-transparent, so a press ON it lands on the page
        // beneath and never reaches onBoxDown. Geometry decides ownership instead, and
        // hands the press to that same handler so there is still only one state machine.
        if (!pinned && view && box && box.classList.contains('on') &&
            (e.button === 0 || e.button === 2) && pointInPreview(e.clientX, e.clientY)) {
            onBoxDown(e);
            return;
        }
        // The right button has to be claimed here, not on contextmenu: mousedown fires
        // first, and letting it fall through to cancel() would clear `active` before the
        // menu event could see what to dismiss.
        if (e.button === 2 && overOurs(e) && altButton(e)) return;
        mouseDown = true;
        cancel();
    }, true);
    // The click half of the same handoff. Without it a press on a pointer-transparent
    // preview would move or pin nothing and the page beneath would take the click.
    document.addEventListener('click', function (e) {
        if (ours(e.target)) return;             // onBoxClick owns it
        if (pinned || !view || !box || !box.classList.contains('on')) return;
        if (!pointInPreview(e.clientX, e.clientY)) return;
        onBoxClick(e);
    }, true);
    document.addEventListener('contextmenu', function (e) {
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
        closeMenu();
        if (!pinned) { cancel(); return; }
        // the window shrinking can leave the frame oversized and the pan out of bounds
        view.fitScale = Math.min(cfg.zoomFactor, viewportBox().w / view.natW, viewportBox().h / view.natH);
        if (view.scale < view.fitScale) view.scale = view.fitScale;
        reflow();
        layout();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            if (menuOpen()) { closeMenu(); return; }
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
            'button.danger{color:' + C.red + '}',
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
        h.textContent = 'Hover Zoom — settings';
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
        check('skipWhileMouseDown', 'Suppress while a mouse button is down');
        pick('siteMode', 'Site list mode', null, [
            ['blacklist', 'Disable on listed sites'], ['whitelist', 'Enable only on listed sites']]);

        const sites = document.createElement('textarea');
        sites.value = cfg.siteList.join('\n');
        sites.spellcheck = false;
        controls.push(function () {
            cfg.siteList = sites.value.split('\n').map(function (s) { return s.trim(); })
                .filter(function (s) { return s.length > 0; });
        });
        const sr2 = document.createElement('div');
        const sl = document.createElement('label');
        sl.textContent = 'Sites';
        const sh = document.createElement('span');
        sh.className = 'hint';
        sh.textContent = 'one hostname per line; subdomains included';
        sl.appendChild(sh);
        sr2.appendChild(sl);
        sr2.appendChild(sites);
        panel.appendChild(sr2);

        section('Pinned mode');
        note('Drag the preview to keep it, click it to pin it',
            'Dragging an unpinned preview moves it and detaches it from the hover: it then ' +
            'stays until you move off the preview itself. Clicking pins it, and it stays until ' +
            'the X, a click outside it, or Escape. While pinned: wheel or +/− to zoom, drag the ' +
            'image or use the arrow keys to pan, 0 to reset, and drag the status bar to move ' +
            'the frame.');
        note('The ⋮ button in the status bar opens the image actions',
            'Open in a new tab, copy the URL, copy the image, save it. The browser\'s own ' +
            'context menu cannot be opened from a script, and right-click is taken by ' +
            'dismiss — this is the replacement. Copy and save need the host to allow a ' +
            'cross-origin read; when it refuses, the image opens in a tab instead.');
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
            'filename, format, dimensions, size — plus the ⋮ button (open, copy or save the ' +
            'full-size image) and the handle that moves a pinned frame');
        pick('spinnerTheme', 'Loading ring',
            'auto follows the browser’s light/dark setting', [
                ['auto', 'Match the browser'], ['dark', 'Always dark'], ['light', 'Always light']]);
        check('noReferrer', 'Strip referrer', 'helps on some hosts, breaks others');

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
})();
