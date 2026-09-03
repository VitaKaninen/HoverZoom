// ==UserScript==
// @name         Hover Zoom
// @namespace    https://github.com/azrobbins
// @version      0.2.0
// @description  Zoom any image on hover. No format allowlist, no size caps, no per-site plugins — resolves the full-size URL on demand.
// @author       azrobbins
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes     false
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
        enabled: true,

        // when to zoom
        activation: 'hover',        // 'hover' | 'modifier' (hold key, then hover)
        modifierKey: 'ctrl',        // 'ctrl' | 'alt' | 'shift'
        hoverDelay: 120,            // ms before resolving
        minDisplayed: 48,           // ignore images displayed smaller than this (icons)
        maxDisplayed: 0,            // ignore images displayed larger than this (0 = no cap)
        minRatio: 1.2,              // full size must be at least this much bigger
        showEvenIfNotLarger: false, // show at natural size even when it isn't an upgrade
        preferLargest: false,       // probe every candidate and take the biggest, not the first hit
        skipWhileMouseDown: true,   // don't fire mid drag/selection
        siteMode: 'blacklist',      // 'blacklist' | 'whitelist'
        siteList: [],               // hostnames, matched by suffix

        // how to display
        maxWidthPct: 92,            // % of viewport
        maxHeightPct: 92,
        zoomFactor: 1.0,            // scale applied to natural size before clamping
        position: 'cursor',         // 'cursor' | 'center'
        cursorGap: 24,              // px between pointer and image edge
        fadeMs: 90,
        borderWidth: 1,
        borderColor: '#45475a',
        cornerRadius: 6,
        shadow: true,
        dimOpacity: 0,              // 0 = no page dimming, up to 90
        showDimensions: true,
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
        // Google user content / Blogger: =s400-c or =w400-h300 -> =s0
        function (u) {
            if (!/(^|\.)(googleusercontent\.com|ggpht\.com|blogspot\.com)$/.test(u.hostname)) return null;
            const p = u.pathname.replace(/=[swh]\d+(-[a-z0-9-]+)*$/i, '=s0');
            if (p === u.pathname && !/=/.test(u.pathname)) return u.href + '=s0';
            u.pathname = p;
            return u.href;
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

        // 3. an ancestor link pointing at media
        const a = el.closest && el.closest('a[href]');
        if (a && a.href) {
            if (looksLikeImage(a.href)) add(a.href);
            else upgradeCandidates(a.href).forEach(function (u) { if (looksLikeImage(u)) add(u); });
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
    // largest. Prefer-largest probes the whole list and takes the biggest, which can
    // beat the site's own srcset by rewriting it, at the cost of N requests.
    const MAX_PROBES = 8;

    async function resolve(el, displayed, token) {
        const candidates = collectCandidates(el).slice(0, MAX_PROBES);
        const shown = el.tagName === 'IMG' ? (el.currentSrc || el.src) : backgroundUrl(el);
        let best = null;
        for (const url of candidates) {
            if (token.cancelled) return null;
            const dim = await probe(url);
            if (!dim) continue;
            const isSameAsShown = (url === shown);
            const bigEnough = dim.w >= displayed.w * cfg.minRatio || dim.h >= displayed.h * cfg.minRatio;
            const usable = bigEnough || (cfg.showEvenIfNotLarger && !isSameAsShown);
            if (!usable) continue;
            const hit = { url: url, w: dim.w, h: dim.h };
            if (!cfg.preferLargest) return hit;
            if (!best || dim.w * dim.h > best.w * best.h) best = hit;
        }
        if (best) return best;
        if (cfg.showEvenIfNotLarger && shown) {
            const dim = await probe(shown);
            if (dim) return { url: shown, w: dim.w, h: dim.h };
        }
        return null;
    }

    // ------------------------------------------------------------------ viewer

    let host = null, root = null, box = null, imgEl = null, capEl = null, dimEl = null;

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
            '.box{position:fixed;opacity:0;pointer-events:none;transition:opacity var(--fade) ease;',
            'background:#1e1e2e;box-sizing:content-box;overflow:hidden}',
            '.box.on{opacity:1}',
            '.dim.on{opacity:var(--dim)}',
            'img{display:block;width:100%;height:100%;object-fit:contain;background:#1e1e2e}',
            '.cap{position:absolute;left:0;right:0;bottom:0;padding:3px 7px;font:11px/1.4 system-ui,sans-serif;',
            'color:#cdd6f4;background:rgba(30,30,46,.82);text-align:right;letter-spacing:.02em}',
        ].join('');
        root.appendChild(style);

        dimEl = document.createElement('div');
        dimEl.className = 'dim';
        root.appendChild(dimEl);

        box = document.createElement('div');
        box.className = 'box';
        imgEl = document.createElement('img');
        capEl = document.createElement('div');
        capEl.className = 'cap';
        box.appendChild(imgEl);
        box.appendChild(capEl);
        root.appendChild(box);

        (document.body || document.documentElement).appendChild(host);
    }

    function showViewer(res, anchor, pointer) {
        buildViewer();

        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const maxW = vw * (cfg.maxWidthPct / 100) - cfg.borderWidth * 2;
        const maxH = vh * (cfg.maxHeightPct / 100) - cfg.borderWidth * 2;

        let w = res.w * cfg.zoomFactor;
        let h = res.h * cfg.zoomFactor;
        const fit = Math.min(maxW / w, maxH / h, 1);
        w = Math.round(w * fit);
        h = Math.round(h * fit);

        host.style.setProperty('--fade', cfg.fadeMs + 'ms');
        host.style.setProperty('--dim', (cfg.dimOpacity / 100).toString());

        box.style.width = w + 'px';
        box.style.height = h + 'px';
        box.style.border = cfg.borderWidth > 0 ? cfg.borderWidth + 'px solid ' + cfg.borderColor : 'none';
        box.style.borderRadius = cfg.cornerRadius + 'px';
        box.style.boxShadow = cfg.shadow ? '0 8px 32px rgba(0,0,0,.55)' : 'none';

        const outer = { w: w + cfg.borderWidth * 2, h: h + cfg.borderWidth * 2 };
        let left, top;
        if (cfg.position === 'center') {
            left = (vw - outer.w) / 2;
            top = (vh - outer.h) / 2;
        } else {
            // prefer the side of the pointer with more room, then clamp
            const rightRoom = vw - pointer.x - cfg.cursorGap;
            left = rightRoom >= outer.w ? pointer.x + cfg.cursorGap : pointer.x - cfg.cursorGap - outer.w;
            top = pointer.y - outer.h / 2;
        }
        box.style.left = Math.round(Math.max(4, Math.min(left, vw - outer.w - 4))) + 'px';
        box.style.top = Math.round(Math.max(4, Math.min(top, vh - outer.h - 4))) + 'px';

        if (cfg.noReferrer) imgEl.referrerPolicy = 'no-referrer';
        imgEl.src = res.url;

        if (cfg.showDimensions) {
            capEl.textContent = res.w + ' × ' + res.h;
            capEl.style.display = '';
        } else {
            capEl.textContent = '';
            capEl.style.display = 'none';
        }

        box.classList.add('on');
        if (cfg.dimOpacity > 0) dimEl.classList.add('on');
    }

    function hideViewer() {
        if (!box) return;
        box.classList.remove('on');
        dimEl.classList.remove('on');
        // release the decoded image so long sessions don't accumulate bitmaps
        setTimeout(function () {
            if (box && !box.classList.contains('on')) imgEl.removeAttribute('src');
        }, cfg.fadeMs + 60);
    }

    // ------------------------------------------------------------- interaction

    let active = null;      // element currently zoomed or pending
    let token = null;       // cancellation token for the in-flight resolve
    let timer = null;
    let pointer = { x: 0, y: 0 };
    let mouseDown = false;
    let modifierDown = false;

    function modifierHeld(e) {
        if (cfg.modifierKey === 'ctrl') return e.ctrlKey;
        if (cfg.modifierKey === 'alt') return e.altKey;
        if (cfg.modifierKey === 'shift') return e.shiftKey;
        return false;
    }

    function eligible(el) {
        if (!el) return null;
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
        clearTimeout(timer);
        if (token) token.cancelled = true;
        token = null;
        active = null;
        hideViewer();
    }

    function onMove(e) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
    }

    function onOver(e) {
        if (!cfg.enabled || !siteEnabled()) return;
        if (cfg.skipWhileMouseDown && mouseDown) return;
        if (cfg.activation === 'modifier' && !modifierHeld(e) && !modifierDown) return;

        const el = eligible(e.target);
        if (!el) {
            // moving onto the page background closes an open viewer
            if (active && !active.contains(e.target)) cancel();
            return;
        }
        if (el === active) return;

        cancel();
        const displayed = sizeOf(el);
        if (displayed.w < cfg.minDisplayed && displayed.h < cfg.minDisplayed) return;
        if (cfg.maxDisplayed > 0 && (displayed.w > cfg.maxDisplayed || displayed.h > cfg.maxDisplayed)) return;

        active = el;
        const myToken = token = { cancelled: false };
        timer = setTimeout(async function () {
            const res = await resolve(el, displayed, myToken);
            if (myToken.cancelled || active !== el) return;
            if (res) showViewer(res, el, pointer);
        }, cfg.hoverDelay);
    }

    function onOut(e) {
        if (!active) return;
        const to = e.relatedTarget;
        if (to && active.contains && active.contains(to)) return;
        cancel();
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('mousedown', function () { mouseDown = true; cancel(); }, true);
    document.addEventListener('mouseup', function () { mouseDown = false; }, true);
    window.addEventListener('scroll', cancel, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') cancel();
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
        check('preferLargest', 'Always find the largest', 'probes every candidate instead of stopping at the first good one');
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

        section('How to display');
        num('zoomFactor', 'Zoom factor', 'scale applied before fitting to the window', 0.1, 8, 0.1);
        num('maxWidthPct', 'Max width', '% of window', 10, 100, 1);
        num('maxHeightPct', 'Max height', '% of window', 10, 100, 1);
        pick('position', 'Position', null, [
            ['cursor', 'Beside the cursor'], ['center', 'Centered in the window']]);
        num('cursorGap', 'Gap from cursor', 'px', 0, 200, 1);
        num('fadeMs', 'Fade duration', 'ms', 0, 1000, 10);
        num('borderWidth', 'Border thickness', 'px', 0, 20, 1);
        color('borderColor', 'Border colour');
        num('cornerRadius', 'Corner radius', 'px', 0, 40, 1);
        check('shadow', 'Drop shadow');
        num('dimOpacity', 'Dim the page behind', '% — 0 disables', 0, 90, 5);
        check('showDimensions', 'Show image dimensions');
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
