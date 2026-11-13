// ==UserScript==
// @name        Hover Zoom
// @namespace   https://github.com/VitaKaninen
// @version     0.307.0
// @author      VitaKaninen
// @description Zoom any image on hover. No format allowlist, no size caps, no per-site plugins — resolves the full-size URL on demand. Drag the preview to keep it around, click it to pin it, then wheel or +/− to zoom in past the window edge and drag or arrow keys to pan.
// @match       *://*/*
// @grant       GM_getValue
// @grant       GM_xmlhttpRequest
// @grant       GM_setValue
// @grant       GM_addValueChangeListener
// @grant       GM_registerMenuCommand
// @grant       GM_unregisterMenuCommand
// @grant       GM_getTab
// @grant       GM_saveTab
// @grant       GM_download
// @grant       GM_openInTab
// @connect     *
// @run-at      document-idle
// @downloadURL https://raw.githubusercontent.com/VitaKaninen/HoverZoom/master/Hover-Zoom.user.js
// @updateURL   https://raw.githubusercontent.com/VitaKaninen/HoverZoom/master/Hover-Zoom.user.js
// ==/UserScript==

/*
 * Design note — why nothing here is decided in advance.
 *
 * Hover Zoom+ pre-scans the page for candidate images, binds .one('mouseover') to each,
 * and never revisits them. That single decision causes most of its misses: images added
 * after the scan, lazy-loaded images whose src was a placeholder at scan time, and any
 * image whose probe lost a race against a global single-slot lock are dead for the life
 * of the page.
 *
 * This script binds two delegated listeners at document level and resolves everything at
 * hover time, when the DOM is settled and the real src is present. The tour reads the
 * whole document, but on every press and keeping nothing: an answer held across an
 * interaction is the thing that goes stale, not the reading of it.
 */

(function () {
    'use strict';

    // ---- perf recorder: document.dispatchEvent(new CustomEvent('hover-zoom:perf', {detail: true | false | 'report'}))
    // Prints totals only — no URLs, no page names. See docs/TESTING.md "Perf recorder".

    const perf = { on: false, t0: 0, calls: new Map(), lo: null, obs: null, self: '', wrapped: new WeakMap(), labels: new WeakMap(),
        orig: new WeakMap(), hot: false, step: 0 };
    const setTimeout = function (fn, ms, ...a) { return window.setTimeout(perfWrap(fn, 'timeout'), ms, ...a); };
    const setInterval = function (fn, ms, ...a) { return window.setInterval(perfWrap(fn, 'interval'), ms, ...a); };
    const MutationObserver = perfObserver(window.MutationObserver, 'mutation');
    const ResizeObserver = perfObserver(window.ResizeObserver, 'resize-obs');

    // The same wrapper for the same function, so add/removeEventListener still pair.
    function perfWrap(fn, kind) {
        if (typeof fn !== 'function') return fn;
        let w = perf.wrapped.get(fn);
        if (w) return w;
        w = function () {
            if (!perf.on) return fn.apply(this, arguments);
            const t = performance.now();
            try { return fn.apply(this, arguments); }
            finally { perfTally(kind, fn, performance.now() - t); }
        };
        perf.wrapped.set(fn, w);
        perf.orig.set(w, fn);
        return w;
    }

    // Rebinds the scan's hot function declarations to timed wrappers while recording (inclusive times).
    function perfHot(w) {
        tourPics = w(tourPics); tourWorthy = w(tourWorthy); shownMedia = w(shownMedia); eligibleDirect = w(eligibleDirect);
        refusal = w(refusal); playerSurfaceReason = w(playerSurfaceReason); videoLinkRefused = w(videoLinkRefused);
        decorativeReason = w(decorativeReason); bannerReason = w(bannerReason); pinnedWallpaperReason = w(pinnedWallpaperReason);
        blocked = w(blocked); blockMatch = w(blockMatch); pictureUrl = w(pictureUrl); shownUrl = w(shownUrl);
        lazyBehindBlocked = w(lazyBehindBlocked); tourSize = w(tourSize); postPics = w(postPics); postEnd = w(postEnd);
        mainPics = w(mainPics); sideColumnEl = w(sideColumnEl); tourScopeNow = w(tourScopeNow); tourLevels = w(tourLevels);
        tourPick = w(tourPick); tourEntriesIn = w(tourEntriesIn); tourOrder = w(tourOrder); twCount = w(twCount); idleFloor = w(idleFloor);
        idlePics = w(idlePics); pageKey = w(pageKey); tourEntriesNow = w(tourEntriesNow); plHas = w(plHas); plFill = w(plFill); plPump = w(plPump);
        tourNav = w(tourNav); twNear = w(twNear); twWheelZone = w(twWheelZone); thruSync = w(thruSync);
        videoSurfaces = w(videoSurfaces); gifLike = w(gifLike); hwFill = w(hwFill); tourSync = w(tourSync); layout = w(layout);
        showViewer = w(showViewer); upgradeViewer = w(upgradeViewer); tourLinesSync = w(tourLinesSync); atOrAfter = w(atOrAfter);
        postEndNow = w(postEndNow); postGroup = w(postGroup); postLead = w(postLead);
    }

    // Smallest step performance.now() moves in; Firefox with resistFingerprinting rounds to ~16.7 ms.
    function perfStep() {
        let a = performance.now(), b = a, best = Infinity;
        for (let i = 0; i < 3; i++) {
            while ((b = performance.now()) === a) { /* spin to the next tick */ }
            if (i) best = Math.min(best, b - a);
            a = b;
        }
        return best;
    }

    function perfObserver(C, kind) {
        return C ? class extends C { constructor(cb) { super(perfWrap(cb, kind)); } } : C;
    }

    function perfTally(kind, fn, ms) {
        let label = fn.name;
        if (!label) {
            label = perf.labels.get(fn);
            if (!label) perf.labels.set(fn, label = 'anon{' + String(fn).replace(/\s+/g, ' ').slice(0, 60) + '}');
        }
        const name = kind + ' ' + label;
        const s = perf.calls.get(name) || { n: 0, ms: 0, max: 0 };
        s.n++; s.ms += ms; if (ms > s.max) s.max = ms;
        perf.calls.set(name, s);
    }

    // This script's own source URL, read off our own stack; long frames are bucketed against it.
    function perfSelfUrl() {
        const m = /(?:\(|@|at )((?:[a-z-]+:)?[^\s()@]+?):\d+:\d+/.exec(String(new Error().stack).split('\n').slice(1).join('\n'));
        return m ? m[1] : '';
    }

    function perfSource(url) {
        if (url && url === perf.self) return 'Hover Zoom';
        if (/^(chrome|moz|safari)(-web)?-extension:|^userscript/i.test(url || '')) {
            const n = /[?&]name=([^&#]+)/.exec(url);
            let label = 'extension';
            try { if (n) label = 'extension "' + decodeURIComponent(n[1]) + '"'; } catch (e) { /* bad escape */ }
            return label;
        }
        return url ? 'page' : 'unattributed';
    }

    function perfFrame(f) {
        const lo = perf.lo;
        lo.frames++; lo.ms += f.duration; lo.block += f.blockingDuration || 0;
        if (f.renderStart) lo.render += f.startTime + f.duration - f.renderStart;
        (f.scripts || []).forEach(function (s) {
            const src = perfSource(s.sourceURL);
            const b = lo.src.get(src) || { ms: 0, forced: 0 };
            b.ms += s.duration; b.forced += s.forcedStyleAndLayoutDuration || 0;
            lo.src.set(src, b);
            if (src !== 'Hover Zoom') return;
            const k = (s.sourceFunctionName || 'anonymous') + ' via ' + (s.invokerType || '?');
            const e = lo.fn.get(k) || { n: 0, ms: 0, forced: 0 };
            e.n++; e.ms += s.duration; e.forced += s.forcedStyleAndLayoutDuration || 0;
            lo.fn.set(k, e);
        });
    }

    function perfStart() {
        perfStop();
        perf.on = true;
        perf.t0 = performance.now();
        perf.calls = new Map();
        perf.lo = { frames: 0, ms: 0, block: 0, render: 0, src: new Map(), fn: new Map() };
        perf.self = perfSelfUrl();
        perf.step = perfStep();
        perfHot(function (f) { return perfWrap(f, 'fn'); });
        perf.hot = true;
        try {
            if ((PerformanceObserver.supportedEntryTypes || []).indexOf('long-animation-frame') >= 0) {
                perf.obs = new PerformanceObserver(function (list) { list.getEntries().forEach(perfFrame); });
                perf.obs.observe({ type: 'long-animation-frame' });
            }
        } catch (e) { perf.obs = null; }
    }

    function perfStop() {
        perf.on = false;
        if (perf.hot) { perfHot(function (f) { return perf.orig.get(f) || f; }); perf.hot = false; }
        if (perf.obs) { try { perf.obs.disconnect(); } catch (e) { /* gone */ } perf.obs = null; }
    }

    function perfReport() {
        if (!perf.lo) return '[HoverZoom] perf: nothing recorded yet';
        const f1 = function (n) { return n.toFixed(1); };
        const secs = (performance.now() - perf.t0) / 1000;
        const all = Array.from(perf.calls.entries()).sort(function (a, b) { return b[1].ms - a[1].ms; });
        const rows = all.filter(function (r) { return r[0].indexOf('fn ') !== 0; });
        const fns = all.filter(function (r) { return r[0].indexOf('fn ') === 0; });
        const own = rows.reduce(function (t, r) { return t + r[1].ms; }, 0);
        const line = function (r) {
            const s = r[1];
            out.push('  ' + String(s.n).padStart(6) + String(f1(s.ms)).padStart(11) + String(f1(s.max)).padStart(9) +
                String(f1(s.n / secs)).padStart(7) + '   ' + r[0]);
        };
        const out = ['[HoverZoom ' + version() + '] perf over ' + f1(secs) + ' s' + (perf.on ? ' (still recording)' : ''),
            'Page: ' + document.querySelectorAll('img,video').length + ' img/video, ' +
                document.getElementsByTagName('*').length + ' elements; timer step ' + f1(perf.step) + ' ms',
            'Entry points (timers/observers/listeners): ' + f1(own) + ' ms (' + f1(own / secs / 10) + '% of one core)',
            '   calls   total ms   max ms     /s   name'];
        rows.slice(0, 25).forEach(line);
        out.push('Inside them, inclusive (a caller’s time holds its callees’):',
            '   calls   total ms   max ms     /s   name');
        fns.slice(0, 30).forEach(line);
        const lo = perf.lo;
        if (perf.obs || lo.frames) {
            out.push('Long frames (>50 ms): ' + lo.frames + ', ' + f1(lo.ms) + ' ms total, ' + f1(lo.block) + ' ms blocking, ' +
                f1(lo.render) + ' ms of it style/layout/paint');
            Array.from(lo.src.entries()).sort(function (a, b) { return b[1].ms - a[1].ms; }).forEach(function (r) {
                out.push('  ' + r[0] + ': ' + f1(r[1].ms) + ' ms script, ' + f1(r[1].forced) + ' ms forced layout');
            });
            Array.from(lo.fn.entries()).sort(function (a, b) { return b[1].ms - a[1].ms; }).slice(0, 15).forEach(function (r) {
                out.push('    ' + r[0] + ' ×' + r[1].n + ': ' + f1(r[1].ms) + ' ms, forced layout ' + f1(r[1].forced) + ' ms');
            });
        }
        return out.join('\n');
    }

    document.addEventListener('hover-zoom:perf', function (e) {
        const d = e.detail;
        if (d === true) perfStart();
        else if (d === false) perfStop();
        const text = d === true ? '[HoverZoom] perf recording — dispatch again with detail false to stop and print' : perfReport();
        try { console.log(text); } catch (x) { /* no console */ }
        // Also as an event, for a test harness on a page that swallows console output.
        if (d !== true) document.dispatchEvent(new CustomEvent('hover-zoom:perf-report', { detail: text }));
    });

    // ---------------------------------------------------------------- settings

    // Site UI icons and emoji that shipped block entries cover; listed first in the user's block list, removable.
    const DEFAULT_BLOCKS = [
        'https://ssl.gstatic.com/ui/v1/icons/*',            // Gmail / Google apps buttons
        'https://www.gstatic.com/images/icons/*',           // Google material icons
        'https://www.gstatic.com/images/branding/*',        // Google product logos
    ];

    // Emoji hosts: an emoji sign (smallEmoji decides), no longer shipped as blocks; v0.174.0 offered them.
    const EMOJI_HOSTS = [
        'https://fonts.gstatic.com/s/e/notoemoji/*',        // Google emoji
        'https://abs-0.twimg.com/emoji/*',                  // X / Twitter emoji
        'https://static.xx.fbcdn.net/images/emoji.php/*',   // Facebook / Messenger emoji
        'https://github.githubassets.com/images/icons/emoji/*',
        'https://s.w.org/images/core/emoji/*',              // WordPress emoji
        'https://cdn.discordapp.com/emojis/*',
        'https://static-cdn.jtvnw.net/emoticons/*',         // Twitch
        '*/economy/emoticon/*',                             // Steam
    ];
    const RETIRED_BLOCKS = EMOJI_HOSTS.slice(0, 5);

    // The shipped entries missing from `list`, put in front of it; the rest keeps its order.
    function withDefaultBlocks(list, skip) {
        const add = DEFAULT_BLOCKS.filter(function (e) {
            return list.indexOf(e) === -1 && !(skip && skip.indexOf(e) !== -1);
        });
        return add.concat(list);
    }

    const DEFAULTS = {
        // when to zoom
        activation: 'hover',        // 'hover' (the hotkey holds previews back) | 'modifier' (only while it is held)
        modifierKey: 'ctrl',        // the hotkey: 'ctrl' | 'alt' | 'shift'
        hotkeyToggle: false,        // 'hover': a lone tap turns previews off in this tab until the next
        hoverDelay: 120,            // ms before resolving
        galleryMiddle: false,       // a middle-click on a result opens its gallery (else the ▦ chip's click does)
        galleryChips: true,         // the ▦ chip on every gallery thumbnail; off: only on the one under the pointer
        galleryTicks: true,         // seen / visited ticks on results
        gallerySavedMarks: true,    // saved discs on results and in galleries
        galleryPreload: true,       // read the first page of every gallery on screen ahead of a click
        galleryRowMin: 120,         // px: gallery rows never shorter; spare room grows them; past that, pages
        hoverPreload: true,         // load the page's pictures ahead of the user, as far as they show interest
        minDisplayed: 16,           // ignore images displayed smaller than this, whatever they are
        smallBelow: 48,             // px: smaller pictures preview only as an avatar or an emoji
        smallAvatars: true,         // a small, square picture whose original is big
        smallEmoji: true,           // an emoji: a plain enlargement beside the pointer at emojiSize
        emojiSize: 200,             // px
        sizeGate: false,            // only preview when the original is minRatio times what is drawn
        minRatio: 1,                // full size must be this much bigger; below 1 previews anything
        bigChip: true,              // a picture the page already draws full size: a chip on it opens the preview anyway
        videoMode: 'clips',         // 'none' | 'clips' (animated clips) | 'all' (+ links to a video page)
        skipFurniture: true,        // never preview the page's own furniture: its background, a
        siteMode: 'blacklist',      // 'blacklist' | 'whitelist'
        siteList: [],               // hostnames, matched by suffix
        blockList: DEFAULT_BLOCKS.slice(),  // image URLs never to preview; '*' matches anything
        blockOffered: DEFAULT_BLOCKS.slice(),   // shipped entries already put in blockList once; removing one sticks

        // the slideshow ("tour" in the code) — next/previous through the page's pictures
        tourButtons: true,          // the widget: ◀ ▶ and the counter, in its own box
        tourFade: false,            // the widget is faint until the pointer comes near
        tourFadeTo: 35,             // ...at this opacity, %
        tourKeys: true,             // arrows navigate when the picture cannot pan sideways
        tourKeyStart: true,         // → (←) with nothing open starts the slideshow at the first (last) picture
        tourMinDisplayed: 128,      // the tour's own floor: longer side as drawn, px; emoji and badges fall under it
        preloadAhead: 0,            // slideshow pictures loaded ahead of (and behind) the current one; 0 = all
        preloadMB: 0,               // memory for loaded pictures; 0 = automatic
        tourWorkers: 6,             // concurrent speculative resolves
        tourHoldRate: 0,            // steps/sec ceiling while an arrow or ◀ ▶ is held; 0 = none
        wheelRange: 65,             // px around the widget's wheel button in which the wheel steps
        tourLoadMore: true,         // the scroll excursion that makes a lazy page load more
        tourCrossPage: true,        // harvest the next page in the background
        tourSkipDupes: true,        // the slideshow shows each picture once

        // placed mode
        wheelZoomStep: 15,          // % per wheel notch
        panStep: 80,                // px per arrow-key press (Shift = 3x)
        maxZoom: 32,                // hard ceiling, multiples of natural size
        displayScale: 1,            // the OS display scaling, divided back out of the readout

        // how to display
        maxSizeMultiple: 1.2,       // how far the frame may GROW, as a multiple of the window.
        zoomLimit: 4,               // ceiling on the opening scale; the window still fits it
        position: 'last',           // 'cursor' | 'under' | 'last' (where a pinned one was last dropped; the centre until then)
        posPerSite: true,           // remembered positions (slideshow, 'last') are kept per site
        fadeMs: 200,
        borderWidth: 1,
        borderColor: '#45475a',
        cornerRadius: 6,
        barMode: 'hover',           // 'always' | 'hover' | 'off' — the status bar
        barIdleMs: 250,             // delay before it starts fading; 0 = starts at once
        barFadeMs: 250,             // how long the fade itself takes; 0 = no animation
        shadow: true,
        shadowSize: 24,             // px of blur
        shadowStrength: 50,         // % opacity
        smoothing: 'auto',          // 'auto' | 'pixelated' | 'crisp-edges' — image-rendering
        spinnerTheme: 'auto',       // 'auto' (follows the browser) | 'dark' | 'light'
        saveConvert: 'off',         // saving converts to: 'off' | 'png' | 'jpg' | 'webp'
        saveConvertFrom: 'avif',    // ...which files: 'avif' | 'modern' (AVIF, WebP, JPEG XL)
        saveJpegQuality: 92,        // %, for 'jpg' and 'webp'
        saveRename: 'meaningless',  // 'off' | 'meaningless' (0001.jpg, image.jpg) | 'always'
        saveNameTemplate: '[site] - [page_title] - [orig_name]',
        referrerSites: [],          // sites to load previews from WITHOUT a referrer
        scrollSites: [],            // sites that load more when scrolled: learned, or the user's
        videoDelays: {},            // host -> {ms, rules, samples, fixes, user}: wait for the page's
                                    // own player before previewing; learned, or set by the user
        avatarAreas: {},            // host -> {rules, samples, idleDays}: small pictures there preview as ordinary ones
        ownPlayerAreas: {},         // host -> {rules, samples, idleDays}: video-link thumbnails the site's own player lands on
        linkAreas: {},              // host -> {rules, samples, idleDays}: thumbnails whose linked page never holds the original
        doorAreas: {},              // host -> {rules, samples, idleDays}: thumbnails that lead to other pages, not a bigger copy (P17)
        taughtRules: {},            // image host -> [{re, to, ex, one?, made}]: where the original lives, shown by the user
        areasAgedOn: 0,             // the day areaAgeAll() last ran
        siteAudio: {},              // host -> {muted, volume}; absent means muted, which is the
                                    // only default a first visit may have — see AUDIO_DEFAULT

        debug: false,               // log every hover decision to the console
        showPostEnd: false,         // draw the slideshow's post end (red) and sidebars (orange)
        logRequests: true,          // keep the shared request log (us-log): refusals and climb-downs only
    };

    const KEY = 'hoverZoomSettings';

    const RETIRED = ['avatarAgedOn', 'maxWidthPct', 'maxHeightPct', 'dimOpacity', 'bottomReserve',
        'sameShapeOnly', 'keepSearching', 'followLinks', 'hoverThroughOverlays',
        'skipWhileMouseDown', 'playVideos', 'skipVideos', 'skipPageBackgrounds',
        'skipBanners', 'skipDecorative', 'enabled', 'maxDisplayed', 'cursorGap', 'noReferrer',
        'showEvenIfNotLarger', 'previewVideos', 'previewOverPlayer', 'barFade', 'showStatusBar',
        'frameMargin', 'borderMode', 'pinButton', 'tourScrubRate', 'wheelZone', 'tourWindow', 'zoomFactor', 'wheelReach'];

    // The retirements that DO convert.
    function migrate(o) {
        if (o.previewVideos === undefined && o.skipVideos !== undefined) {
            o.previewVideos = !o.skipVideos;
        }
        // One checkbox asked three questions; the one it actually answered is the middle one.
        if (o.videoMode === undefined && o.previewVideos !== undefined) {
            o.videoMode = o.previewVideos ? 'all' : 'clips';
        }
        if (o.skipFurniture === undefined && o.skipPageBackgrounds !== undefined) {
            o.skipFurniture = !!o.skipPageBackgrounds;
        }
        // "Centred in the window" is "Where I last put it", whose default is the centre.
        if (o.position === 'center') o.position = 'last';
        // "Preview images that are already full size" is a minRatio below 1 now.
        if (o.showEvenIfNotLarger && !(o.minRatio < 1)) o.minRatio = 0.9;
        // Two checkboxes became two three-way modes. `barFade` answered "may they fade" for the
        // pair; a zero frame margin was the only way to turn the border visual off.
        if (o.barMode === undefined && (o.barFade !== undefined || o.showStatusBar !== undefined)) {
            o.barMode = o.showStatusBar === false ? 'off' : (o.barFade === false ? 'always' : 'hover');
        }
        // Shipped block entries this list has never been offered go on top, once.
        if (Array.isArray(o.blockList)) {
            let offered = Array.isArray(o.blockOffered) ? o.blockOffered : [];
            // The emoji entries v0.174.0 shipped come out once; one the user adds back stays.
            const gone = RETIRED_BLOCKS.filter(function (e) { return offered.indexOf(e) !== -1; });
            if (gone.length) {
                o.blockList = o.blockList.filter(function (e) { return gone.indexOf(e) === -1; });
                offered = offered.filter(function (e) { return gone.indexOf(e) === -1; });
            }
            o.blockList = withDefaultBlocks(o.blockList, offered);
            o.blockOffered = offered.concat(DEFAULT_BLOCKS.filter(function (e) { return offered.indexOf(e) === -1; }));
        }
        if (o.saveNameTemplate === '[site] - ([page_title]) - [date]_[time]-###') o.saveNameTemplate = '[site] - [page_title] - [orig_name]';
        // wheelReach's old default (50) becomes wheelRange's (65); a value the user chose carries over.
        if (o.wheelRange === undefined && o.wheelReach !== undefined) {
            o.wheelRange = o.wheelReach === 50 ? 65 : o.wheelReach;
        }
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

    let playVideos = true;      // the tab's own copy of videoMode 'none', from the bar's play button

    // Anything that moves: the stored setting and the per-tab button ask the same question.
    function videoPreviewsOn() { return playVideos && cfg.videoMode !== 'none'; }

    function saveSettings() {
        GM_setValue(KEY, JSON.stringify(cfg));
    }

    // Sound is remembered per site as two values — the mute flag and the level it comes back to.
    // Both start silent: a preview that made noise on a page unasked is the worst first impression.
    const AUDIO_DEFAULT = { muted: true, volume: 0 };

    function audioFor() {
        const m = cfg.siteAudio && cfg.siteAudio[pageHost()];
        if (!m) return Object.assign({}, AUDIO_DEFAULT);
        return {
            muted: m.muted === undefined ? AUDIO_DEFAULT.muted : !!m.muted,
            volume: typeof m.volume === 'number' ? Math.max(0, Math.min(1, m.volume))
                                                 : AUDIO_DEFAULT.volume,
        };
    }

    // Read-modify-write against STORAGE, not against our copy: another tab may have written since.
    function saveAudio(patch) {
        const host = pageHost();
        if (!host) return;
        reloadSettings();
        const all = Object.assign({}, cfg.siteAudio);
        all[host] = Object.assign({}, AUDIO_DEFAULT, all[host], patch);
        cfg.siteAudio = all;
        saveSettings();
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
                plReset();
                refreshSiteMenu();                  // the mode or the list may have changed
                if (panelHost) openPanel();         // re-render an open panel onto fresh values
                twRefresh();
            });
        } catch (e) { /* not all managers implement it; reloadSettings() still covers the panel */ }
    }

    // Does an entry cover this hostname? Suffix match, so example.com covers www.example.com.
    function entryCovers(entry, host) {
        const e = String(entry).trim().toLowerCase().replace(/^\*\./, '');
        if (!e) return false;
        return host === e || host.endsWith('.' + e);
    }

    // A site-list entry against the page URL: bare host = host suffix, bare with a path = that path and
    // below, "quoted" = that one page; a trailing * on either = every path starting with it.
    function siteEntryMatches(entry, pageUrl) {
        const raw = String(entry).trim();
        const q = /^["“”'](.*)["“”']$/.exec(raw);
        let page;
        try { page = new URL(pageUrl); } catch (e) { return false; }
        const host = page.hostname.toLowerCase();
        const scheme = /^[a-z][a-z0-9+.-]*:\/\//i;
        if (!q && !/[\/?]/.test(raw.replace(scheme, ''))) return entryCovers(raw, host);
        const text = (q ? q[1] : raw).trim();
        let want;
        try { want = new URL(scheme.test(text) ? text : 'https://' + text); } catch (e) { return false; }
        const bare = function (h) { return h.toLowerCase().replace(/^www\./, ''); };
        if (q ? bare(want.hostname) !== bare(host) : !entryCovers(want.hostname, host)) return false;
        const trim = function (p) { return p.replace(/\/+$/, ''); };
        const wp = want.pathname, hp = trim(page.pathname);
        if (/\*$/.test(wp)) {
            if ((hp + '/').indexOf(wp.replace(/\*+$/, '')) !== 0) return false;
        } else if (q) {
            if (trim(wp) !== hp) return false;
        } else if (hp !== trim(wp) && hp.indexOf(trim(wp) + '/') !== 0) return false;
        let ok = true;
        want.searchParams.forEach(function (v, k) { if (page.searchParams.getAll(k).indexOf(v) === -1) ok = false; });
        return ok;
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

    // The page the USER is on; a cross-origin frame gets the host alone, so "quoted" pages miss there.
    function pageUrl() {
        if (isTopFrame) return location.href;
        try { const h = window.top.location.href; if (h) return h; } catch (e) { /* cross-origin */ }
        return 'https://' + pageHost() + '/';
    }

    function siteListed() {
        const url = pageUrl();
        return cfg.siteList.some(function (entry) { return siteEntryMatches(entry, url); });
    }

    function siteEnabled() {
        return cfg.siteMode === 'whitelist' ? siteListed() : !siteListed();
    }

    // A captcha's picture grid is never something to preview, and it is almost always an iframe.
    const CAPTCHA_HERE = (function () {
        const h = location.hostname, p = location.pathname;
        if (/(^|\.)(hcaptcha\.com|challenges\.cloudflare\.com|arkoselabs\.com|funcaptcha\.com)$/i.test(h)) return true;
        if (/^\/recaptcha\//i.test(p)) return true;
        if (/(^|\.)google\.[a-z.]+$/i.test(h) && /^\/sorry\//i.test(p)) return true;
        return !isTopFrame && /captcha/i.test(p);
    })();

    // Per site, because stripping it fixes one host and breaks the next.
    function noReferrerHere() {
        const host = pageHost();
        return cfg.referrerSites.some(function (entry) { return entryCovers(entry, host); });
    }

    let siteMenuId = null;
    let linesMenuId = null;         // the debug lines' toggle, beside the site one

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
        if (linesMenuId != null) {
            try { GM_unregisterMenuCommand(linesMenuId); } catch (e) { return; }
            linesMenuId = null;
        }
        try {
            siteMenuId = GM_registerMenuCommand(siteMenuLabel(), toggleSite);
            linesMenuId = GM_registerMenuCommand((cfg.showPostEnd ? '☑' : '☐') + ' Draw where the slideshow stops', toggleLines, { autoClose: false });
        } catch (e) { /* nothing to fall back to; the panel still has the list */ }
    }

    // The menu's copy of the panel's Diagnostics checkbox.
    function toggleLines() {
        reloadSettings();
        cfg.showPostEnd = !cfg.showPostEnd;
        saveSettings();
        refreshSiteMenu();
        refreshPanel();
        twRefresh();
        toast('Draw where the slideshow stops: ' + (cfg.showPostEnd ? 'on' : 'off'), 3000);
    }

    // reloadSettings() first for the same reason blockCurrent() does it.
    function toggleSite() {
        reloadSettings();
        const host = pageHost();
        const url = pageUrl();
        const kept = cfg.siteList.filter(function (entry) { return !siteEntryMatches(entry, url); });
        if (kept.length === cfg.siteList.length) kept.push(host);
        cfg.siteList = kept;
        saveSettings();
        refreshSiteMenu();
        refreshPanel();
        if (!siteEnabled()) { if (placed) unplace(); else cancel(); }
        twRefresh();                        // the widget goes or comes back now, not at the next load
        dbg('site toggled', { host: host, list: cfg.siteList, enabledHere: siteEnabled() });
        toast('Hover Zoom ' + (siteEnabled() ? 'enabled' : 'disabled') + ' for ' + host, 3000);
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

    // This page only, never stored: `document.dispatchEvent(new CustomEvent('hover-zoom:debug',
    // {detail: true}))` from the console turns the log on without touching the settings.
    let pageDebug = false;
    document.addEventListener('hover-zoom:debug', function (e) {
        pageDebug = !!e.detail;
        try { console.log('[HoverZoom ' + version() + '] debug ' + (pageDebug ? 'on' : 'off') + ' for this page'); } catch (x) { /* no console */ }
    });
    // `document.dispatchEvent(new CustomEvent('hover-zoom:gallery-state'))`: gallery mode's state and every load trace, as one console line.
    document.addEventListener('hover-zoom:gallery-state', function () {
        try { console.log('[HoverZoom ' + version() + '] gallery state\n' + galStateText()); } catch (x) { /* no console */ }
    });

    function debugOn() { return pageDebug || !!cfg.debug; }

    function dbg(label, data) {
        if (!debugOn()) return;
        try {
            // Page debug is read by a tool, not a person: one flat string, no collapsed Object.
            const head = '[HoverZoom ' + version() + '] ' + label;
            if (data === undefined) console.log(head);
            else console.log(head, pageDebug ? JSON.stringify(data) : data);
        } catch (e) { /* no console */ }
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

    // A stem plus a short separator-led tail: `_s`, `-150x150`, `_thumbnail`.
    const SIZE_TAIL_RE = /^[-_.][A-Za-z0-9][A-Za-z0-9_-]{0,8}$/;

    function urlStem(url) {
        try {
            const p = new URL(url, location.href).pathname;
            const file = p.slice(p.lastIndexOf('/') + 1);
            const dot = file.lastIndexOf('.');
            return dot > 0 ? file.slice(0, dot) : file;
        } catch (e) { return ''; }
    }

    // ...or a short size-led head that carries a digit: MediaWiki's `250px-`.
    const SIZE_HEAD_RE = /^(?=[^_.-]*\d)[A-Za-z0-9]{1,9}[-_.]$/;

    // Do two media URLs name the same picture at different sizes?
    function sameStem(a, b) {
        const x = urlStem(a), y = urlStem(b);
        if (!x || !y) return false;
        if (x === y) return true;
        const long = x.length > y.length ? x : y;
        const short = x.length > y.length ? y : x;
        if (long.indexOf(short) === 0 && SIZE_TAIL_RE.test(long.slice(short.length))) return true;
        return long.slice(-short.length) === short && SIZE_HEAD_RE.test(long.slice(0, -short.length));
    }

    const THUMB_PARAM = /(?:^|[_-])(?:thumb|thumbnail|tn|small|preview|icon|avatar)(?:$|[_-])/i;

    // A parameter that says its value IS an image needs no extension to prove it: Bing's
    // ?mediaurl=, Google's ?imgurl=, Yandex's ?img_url=, Startpage's ?piurl=. See E48.
    const IMAGE_PARAM = /^(?:media|img|image|photo|pic|picture|pi)[_-]?(?:url|src)$/i;

    // A card links once but can hold a strip of extra thumbnails; the link is about the biggest
    // image inside it and says nothing about the others. See E48.
    function anchorOwns(el, a) {
        if (!a || !a.querySelectorAll) return false;
        const imgs = a.querySelectorAll('img');
        if (imgs.length <= 1) return true;
        const mine = el.clientWidth * el.clientHeight;
        for (let i = 0; i < imgs.length; i++)
            if (imgs[i] !== el && imgs[i].clientWidth * imgs[i].clientHeight > mine) return false;
        return true;
    }

    // Fetching the page behind a link is wasted when the link already named the media, and wrong
    // when this image is not what the link is about — both give the site's share card. See E48.
    function skipLinkedPage(el) {
        const a = el.closest && el.closest('a[href]');
        if (!a || !a.href) return false;
        if (!anchorOwns(el, a)) return true;
        return !looksLikeImage(a.href) && linkParamCandidates(a.href).length > 0;
    }

    function linkParamCandidates(href) {
        const out = [];
        let u;
        try { u = new URL(href, location.href); } catch (e) { return out; }
        u.searchParams.forEach(function (value, name) {
            if (THUMB_PARAM.test(name)) return;          // never trade an original for a thumbnail
            if (!/^https?:\/\//i.test(value)) return;    // absolute only; a bare path is ambiguous
            if (looksLikeImage(value) || IMAGE_PARAM.test(name)) out.push(value);
        });
        return out;
    }

    // Images the user has said never to preview. Compiled once per list; answers memoised per URL.
    const blockCompiled = new WeakMap();
    function blockMatch(url, list) {
        if (!url || !list || !list.length) return false;
        let c = blockCompiled.get(list);
        if (!c || c.len !== list.length) {      // the ⊘ menu pushes onto cfg.blockList in place
            c = { len: list.length, exact: new Set(), rx: [], seen: new Map() };
            for (let i = 0; i < list.length; i++) {
                const entry = String(list[i]).trim();
                if (!entry) continue;
                if (entry.indexOf('*') === -1) { c.exact.add(entry); continue; }
                c.rx.push(new RegExp('^' + entry.split('*').map(function (part) {
                    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                }).join('.*') + '$'));
            }
            blockCompiled.set(list, c);
        }
        let hit = c.seen.get(url);
        if (hit !== undefined) return hit;
        hit = c.exact.has(url) || c.rx.some(function (rx) { return rx.test(url); });
        if (c.seen.size > 5000) c.seen.clear();
        c.seen.set(url, hit);
        return hit;
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

    // An endpoint whose query is the REQUEST, not a resize: /rotate.php?loc=header asks a
    // different question once stripped. Never drop a query from one of these. See E50.
    const SCRIPT_EXT_RE = /\.(php\d?|aspx?|jsp|cgi|pl|py|rb|do|action)(?=$|[?#])/i;

    const SIZE_PARAMS = ['w', 'h', 'width', 'height', 'size', 's', 'fit', 'resize', 'crop',
        'quality', 'q', 'strip', 'thumb', 'thumbnail', 'scale', 'max', 'maxwidth',
        'maxheight', 'downsize', 'compress', 'dpr'];

    // live.staticflickr.com/<farm>/<id>_<secret>[_<size>].jpg -- swap the size letter.
    function flickrSize(u, want) {
        if (!/(^|\.)staticflickr\.com$/.test(u.hostname)) return null;
        const m = u.pathname.match(/^(.*\/\d+_[0-9a-f]+)(?:_[a-z0-9]{1,2})?(\.[a-z0-9]+)$/i);
        if (!m) return null;
        const p = m[1] + '_' + want + m[2];
        if (p === u.pathname) return null;
        u.pathname = p;
        return u.href;
    }

    function dropSizeParams(u) {
        let touched = false;
        SIZE_PARAMS.forEach(function (p) {
            if (u.searchParams.has(p)) { u.searchParams.delete(p); touched = true; }
        });
        return touched ? u.href : null;
    }

    // base64url, and only if it looks like one: a short or non-alphabet string is not worth atob().
    function b64UrlDecode(s) {
        if (!s || s.length < 16 || /[^A-Za-z0-9_-]/.test(s)) return null;
        try {
            let b = s.replace(/-/g, '+').replace(/_/g, '/');
            while (b.length % 4) b += '=';
            const out = atob(b);
            return /^[\x20-\x7e]+$/.test(out) ? out : null;
        } catch (e) { return null; }
    }

    // Names a URL rule; `report` marks one whose failure means the site changed, not a missing size.
    function rule(name, report, fn) {
        fn.ruleName = name;
        fn.report = report;
        return fn;
    }

    const UPGRADES = [
        // A proxy carrying its source base64url-encoded in the path: imgproxy and everything
        // shaped like it, Brave image search included. Self-validating — the segments either
        // decode to an absolute URL or they do not, so this cannot match by accident. See E51.
        rule('image proxy', false, function (u) {
            const segs = u.pathname.split('/').filter(Boolean)
                .filter(function (s) { return s.indexOf(':') === -1; });   // processing options
            for (let i = 0; i < segs.length; i++) {
                const dec = b64UrlDecode(segs.slice(i).join(''));
                if (dec && /^https?:\/\/[^\s]+$/i.test(dec)) return dec;
            }
            return null;
        }),
        rule('imgur clip', false, function (u) {
            const hit = imgurId(u);
            if (!hit) return null;
            const url = 'https://i.imgur.com/' + hit.id + '.mp4';
            return url === u.href ? null : url;
        }),
        rule('gifwow clip', true, function (u) {
            if (!/(^|\.)gifwow\.com$/.test(u.hostname)) return null;
            const m = u.pathname.match(/^\/gifs\/([A-Za-z0-9_-]+)\.(?:jpe?g|png|webp|gif)$/i);
            return m ? u.origin + '/gifs/' + m[1] + '.mp4' : null;
        }),
        rule('imgur original', true, function (u) {
            const hit = imgurId(u);
            if (!hit) return null;
            const was = u.href;
            // .webp is the de-animating transcode; anything else gives the stored original.
            const ext = /^\.webp$/i.test(hit.ext) ? '.jpg' : hit.ext;
            u.pathname = '/' + hit.id + ext;
            u.search = '';      // ?maxwidth= and ?tb both just ask for a smaller picture
            return u.href === was ? null : u.href;
        }),
        rule('size query', false, function (u) {
            if (!MEDIA_RE.test(u.pathname) && !VIDEO_EXT_RE.test(u.pathname)) return null;
            return dropSizeParams(u);
        }),
        // The same, for a CDN whose path carries an opaque id and no extension:
        // th.bing.com/th/id/OIP.<id>?w=89&h=89 -> 474x711, measured. See E50.
        rule('size query, no extension', false, function (u) {
            if (MEDIA_RE.test(u.pathname) || VIDEO_EXT_RE.test(u.pathname)) return null;
            if (SCRIPT_EXT_RE.test(u.pathname)) return null;
            const last = u.pathname.split('/').filter(Boolean).pop() || '';
            if (last.length < 12 || !/[A-Za-z]/.test(last) || !/\d/.test(last)) return null;
            return dropSizeParams(u);
        }),
        // Twitter / X: ?name=small -> ?name=orig
        rule('Twitter original', true, function (u) {
            if (!/(^|\.)(twimg\.com)$/.test(u.hostname)) return null;
            if (u.searchParams.get('name') === 'orig') return null;
            u.searchParams.set('name', 'orig');
            return u.href;
        }),
        // WordPress and friends: image-150x150.jpg -> image.jpg
        rule('WordPress size suffix', false, function (u) {
            const p = u.pathname.replace(/-\d{2,5}x\d{2,5}(\.[a-z0-9]+)$/i, '$1');
            if (p === u.pathname) return null;
            u.pathname = p;
            return u.href;
        }),
        // Shopify: image_400x400.jpg / image_400x.jpg -> image.jpg
        rule('Shopify size suffix', false, function (u) {
            const p = u.pathname.replace(/_(\d{2,5}x\d{0,5}|x\d{2,5})(?:@\dx)?(\.[a-z0-9]+)$/i, '$2');
            if (p === u.pathname) return null;
            u.pathname = p;
            return u.href;
        }),
        rule('resize path segment', false, function (u) {
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
        }),
        rule('Google size token', true, function (u) {
            // usercontent.google.com is Google Photos, same size-token syntax on a different host.
            if (!/(^|\.)(googleusercontent\.com|usercontent\.google\.com|ggpht\.com|blogspot\.com)$/.test(u.hostname)) return null;
            const p = u.pathname.replace(
                /(\/|=)(?:w\d{2,}-h\d{2,}|[swh]\d{2,})(?:-[a-z0-9]+)*(\/|$)/i, '$1s0$2');
            if (p !== u.pathname) { u.pathname = p; return u.href; }
            if (!/[=/]s0(\/|$)/.test(u.pathname)) return u.href + '=s0';
            return null;
        }),
        // MediaWiki: /thumb/a/ab/File.jpg/220px-File.jpg -> /a/ab/File.jpg
        rule('MediaWiki thumbnail', true, function (u) {
            const m = u.pathname.match(/^(.*)\/thumb(\/[a-f0-9]\/[a-f0-9]{2}\/[^/]+)\/[^/]+$/i);
            if (!m) return null;
            u.pathname = m[1] + m[2];
            // Wikimedia: thumb.wikimedia.org serves no originals; upload.wikimedia.org does
            if (u.hostname === 'thumb.wikimedia.org') { u.hostname = 'upload.wikimedia.org'; u.search = ''; }
            return u.href;
        }),
        // Reddit preview host -> direct host. The id is the last alphanumeric run before the
        // extension, which covers both the bare form and the slug form preview.redd.it now uses.
        rule('Reddit preview', true, function (u) {
            if (!/(^|\.)redd\.it$/.test(u.hostname)) return null;
            if (u.hostname === 'i.redd.it') return null;
            const m = u.pathname.match(/([a-z0-9]+)(\.(?:jpe?g|png|gif|webp))$/i);
            if (!m) return null;
            return 'https://i.redd.it/' + m[1] + m[2];
        }),
        // Flickr size suffix: _n is 320, _b is 1024, _k is 2048 where it exists (else a 410,
        // which costs one probe). _o needs a secret and is not guessable.
        rule('Flickr large', true, function (u) {
            return flickrSize(u, 'b');
        }),
        rule('Flickr 2048', false, function (u) {
            return flickrSize(u, 'k');
        }),
        // A thumbnail marker leads the filename as often as it trails it: thumbnail_<hash>.jpg.
        rule('thumbnail prefix', false, function (u) {
            const p = u.pathname.replace(
                /\/(?:thumb|thumbs|thumbnail|thumbnails|small|tn|preview)[_-]([^/]+)$/i, '/$1');
            if (p === u.pathname) return null;
            u.pathname = p;
            return u.href;
        }),
        // The Gelbooru family, which safebooru/rule34/konachan all descend from:
        // /thumbnails/<dir>/thumbnail_<sha1>.jpg -> /images/<dir>/<sha1>.jpg
        rule('booru thumbnail', true, function (u) {
            if (u.pathname.indexOf('/thumbnails/') === -1) return null;
            const p = u.pathname.replace('/thumbnails/', '/images/')
                .replace(/\/(?:thumbnail|thumb)[_-]([^/]+)$/i, '/$1');
            if (p === u.pathname) return null;
            u.pathname = p;
            u.search = '';      // the ?<post id> cache-buster names nothing on the image host
            return u.href;
        }),
        // Squarespace: ?format=500w -> ?format=2500w
        rule('Squarespace format', true, function (u) {
            const f = u.searchParams.get('format');
            if (!f || !/^\d+w$/.test(f)) return null;
            u.searchParams.set('format', '2500w');
            return u.href;
        }),
        // Etsy: the size is a prefix on the filename, il_510x638.<id>_<code>.jpg, and the top of
        // the ladder is named rather than numbered.
        rule('Etsy full size', true, function (u) {
            if (!/(^|\.)etsystatic\.com$/.test(u.hostname)) return null;
            const p = u.pathname.replace(/\/il_\d+x[\dN]+\./, '/il_fullxfull.');
            if (p === u.pathname) return null;
            u.pathname = p;
            return u.href;
        }),
        // Pinterest: the first path segment is the size. /originals/ is the true top but 403s on
        // some pins, and /1200x/ answers where it does, so both are offered and the biggest wins.
        rule('Pinterest original', false, function (u) {
            if (!/(^|\.)pinimg\.com$/.test(u.hostname)) return null;
            const p = u.pathname.replace(/^\/(?:\d+x\d*|originals)\//, '/originals/');
            if (p === u.pathname) return null;
            u.pathname = p;
            return u.href;
        }),
        rule('Pinterest 1200', true, function (u) {
            if (!/(^|\.)pinimg\.com$/.test(u.hostname)) return null;
            const p = u.pathname.replace(/^\/(?:\d+x\d*|originals)\//, '/1200x/');
            if (p === u.pathname) return null;
            u.pathname = p;
            return u.href;
        }),
        // generic path markers
        rule('thumbnail path marker', false, function (u) {
            const p = u.pathname
                .replace(/\/(thumb|thumbs|thumbnail|thumbnails|small|medium|preview|resized|tiny|mini|micro|square)\//i, '/')
                .replace(/(_|-)(thumb|thumbnail|small|medium|preview|min|tn|tiny|mini|micro|square)(\.[a-z0-9]+)$/i, '$3');
            if (p === u.pathname) return null;
            u.pathname = p;
            return u.href;
        }),
        // An opaque size code on the stem: photo_t3.jpg -> photo.jpg. Two chars minimum.
        rule('size code', false, function (u) {
            const m = u.pathname.match(
                /^(.*\/[^/]{3,})[_-](?:[a-z]{2}\d{0,2}|[a-z]\d{1,2})(\.[a-z0-9]+)$/i);
            if (!m) return null;
            u.pathname = m[1] + m[2];
            return u.href;
        }),
    ];

    // Every rule's rewrite of `src`, as `{ url, rule, host }` — host is the one the rule was applied to.
    function upgradeRules(src) {
        const out = [];
        let base;
        try { base = new URL(src, location.href); } catch (e) { return out; }
        UPGRADES.forEach(function (fn) {
            try {
                const r = fn(new URL(base.href));
                if (r && r !== base.href) out.push({ url: r, rule: fn, host: base.hostname });
            } catch (e) { /* a rule that throws is just a rule that doesn't apply */ }
        });
        return out;
    }

    function upgradeCandidates(src) {
        return upgradeRules(src).map(function (r) { return r.url; });
    }

    const ANIM_EXT_RE = /\.(gif|webp|png|apng)(?=$|[?#])/i;

    // Animated or not, from a file's first few KB. No URL or DOM property answers this.
    function sniffAnimated(bytes) {
        if (!bytes || bytes.length < 24) return false;
        let head = '';
        for (let i = 0; i < bytes.length; i++) head += String.fromCharCode(bytes[i]);
        if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP')
            return (head.slice(12, 16) === 'VP8X' && (bytes[20] & 0x02) !== 0) ||
                head.indexOf('ANMF') >= 0;
        if (head.slice(0, 4) === 'GIF8') return head.indexOf('NETSCAPE2.0') >= 0;
        if (bytes[0] === 0x89 && head.slice(1, 4) === 'PNG') return head.indexOf('acTL') >= 0;
        return false;
    }

    // A file's real format from its first bytes: { fmt, animated } or null.
    function sniffFormat(bytes) {
        if (!bytes || bytes.length < 12) return null;
        let head = '';
        for (let i = 0; i < Math.min(bytes.length, 16); i++) head += String.fromCharCode(bytes[i]);
        let fmt = null, anim = sniffAnimated(bytes);
        if (head.slice(4, 8) === 'ftyp') {
            const brand = head.slice(8, 12);
            if (brand === 'avif' || brand === 'avis') { fmt = 'avif'; anim = brand === 'avis'; }
            else if (/^(heic|heix|mif1|msf1)$/.test(brand)) fmt = 'heic';
        } else if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') fmt = 'webp';
        else if ((bytes[0] === 0xFF && bytes[1] === 0x0A) || head.slice(4, 8) === 'JXL ') fmt = 'jxl';
        else if (bytes[0] === 0xFF && bytes[1] === 0xD8) fmt = 'jpg';
        else if (bytes[0] === 0x89 && head.slice(1, 4) === 'PNG') fmt = 'png';
        else if (head.slice(0, 4) === 'GIF8') { fmt = 'gif'; anim = true; }
        return fmt ? { fmt: fmt, animated: anim } : null;
    }

    // Is `next` worth replacing what the frame is already showing? The two resolver paths
    // emit independently and warm caches reorder them, so last-writer-wins is not safe.
    function betterHit(cur, next) {
        if (!next) return false;
        if (!cur) return true;
        if (!!next.trusted !== !!cur.trusted) return !!next.trusted;
        if (!!next.video !== !!cur.video) return !!next.video;
        return next.w * next.h > cur.w * cur.h;
    }

    // ---- taught patterns: one thumbnail -> original pair from the user, generalised. See RESOLVER.md "Taught patterns".
    const TAUGHT_ID_LEN = 5;        // a word with a digit, this long, that only the original has names one picture

    function urlTokens(s) { return String(s).match(/[A-Za-z0-9]+|[^A-Za-z0-9]+/g) || []; }

    function taughtVar(t) { return /\d/.test(t) && /^[A-Za-z0-9]+$/.test(t); }

    // The rewrite { re, to, ex, one? } that turns `thumb` into `orig`, and others shaped like it; null when equal.
    // Picks the context naming the fewest plain words that still reproduces the example.
    function taughtRuleFrom(thumb, orig) {
        const A = urlTokens(thumb), B = urlTokens(orig);
        if (thumb === orig || !A.length || !B.length) return null;
        let p = 0;
        while (p < A.length && p < B.length && A[p] === B[p]) p++;
        let s = 0;
        while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
        const midB = B.slice(p, B.length - s), mE = A.length - s;
        const shape = function (t) { return t.replace(/\d+/g, '#'); };
        const sizes = A.slice(p, mE).map(shape);       // w400 -> w2048 is a size, not an id
        const esc = function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
        const lit = function (t) { return t.replace(/\$/g, '$$$$'); };
        const word = function (t) { return /^[A-Za-z0-9]+$/.test(t); };
        const exact = { re: '^' + esc(thumb) + '$', to: lit(orig), ex: [thumb, orig], one: true };
        if (midB.some(function (t) {
            return taughtVar(t) && A.indexOf(t) < 0 && t.length >= TAUGHT_ID_LEN && sizes.indexOf(shape(t)) < 0;
        })) return exact;
        let best = null, bestCost = Infinity;
        for (let lw = 0; lw <= p; lw++) {
            for (let rw = 0; rw <= s; rw++) {
                let L = p - lw, R = mE + rw;
                midB.forEach(function (t) {
                    if (!taughtVar(t) || A.slice(L, R).indexOf(t) >= 0) return;
                    const i = A.indexOf(t);
                    if (i >= 0) { L = Math.min(L, i); R = Math.max(R, i + 1); }
                });
                let cost = R - L, anchor = false;
                for (let i = L; i < R; i++) {
                    if (!word(A[i]) || taughtVar(A[i]) && (i < p || i >= mE)) continue;
                    if (/[A-Za-z]/.test(A[i])) anchor = true;
                    if (i < p) cost += 100; else if (i >= mE) cost += 60;
                }
                if (!anchor || cost >= bestCost) continue;
                let re = '', n = 0;
                const grp = {}, byVal = {};
                for (let i = L; i < R; i++) {
                    const t = A[i];
                    if (!taughtVar(t)) { re += esc(t); continue; }
                    n++; grp[i] = n;
                    if (!(t in byVal)) byVal[t] = n;
                    re += i >= p && i < mE ? '(' + esc(t).replace(/\d+/g, '\\d+') + ')' : '([A-Za-z0-9]+)';
                }
                if (word(A[L])) re = '(?<![A-Za-z0-9])' + re;
                if (word(A[R - 1])) re += '(?![A-Za-z0-9])';
                const ctx = function (i) { return grp[i] ? '$' + grp[i] : lit(A[i]); };
                let to = '';
                for (let i = L; i < p; i++) to += ctx(i);
                midB.forEach(function (t) { to += taughtVar(t) && byVal[t] ? '$' + byVal[t] : lit(t); });
                for (let i = mE; i < R; i++) to += ctx(i);
                const rule = { re: re, to: to,
                    ex: [A.slice(L, R).join(''), A.slice(L, p).concat(midB, A.slice(mE, R)).join('')] };
                if (taughtApply(rule, thumb) !== orig) continue;
                best = rule;
                bestCost = cost;
            }
        }
        return best || exact;
    }

    // A taught rule's rewrite of `url`, or null when it does not apply.
    function taughtApply(rule, url) {
        let re;
        try { re = new RegExp(rule.re); } catch (e) { return null; }
        if (!re.test(url)) return null;
        const out = url.replace(re, rule.to);
        return out !== url ? out : null;
    }

    const DATA_ATTRS = ['data-src', 'data-original', 'data-original-src', 'data-full',
        'data-full-src', 'data-fullsize', 'data-large', 'data-large-src', 'data-hi-res',
        'data-highres', 'data-zoom-image', 'data-zoom', 'data-image', 'data-img',
        'data-lazy', 'data-lazy-src', 'data-defer-src', 'data-echo', 'data-url',
        'data-hoverzoom', 'data-actualsrc'];

    // ---- rule health: per rule and image host, whether its guesses load. See RESOLVER.md "Rule health".
    const RULE_HEALTH_KEY = 'ruleHealth';
    const RULE_DEAD_AFTER = 10;     // 404s in a row before a rule counts as not working on a host
    const RULE_RETRY_EVERY = 10;    // a skipped rule is still tried once in this many hovers
    const RULE_HEALTH_MAX = 300;

    function ruleHealth() {
        try { return JSON.parse(GM_getValue(RULE_HEALTH_KEY, '') || '{}') || {}; }
        catch (e) { console.warn('[Hover Zoom] unreadable rule health, starting fresh', e); return {}; }
    }

    function saveRuleHealth(m) {
        const keys = Object.keys(m);
        if (keys.length > RULE_HEALTH_MAX) {
            keys.sort(function (a, b) { return m[a].t - m[b].t; })
                .slice(0, keys.length - RULE_HEALTH_MAX).forEach(function (k) { delete m[k]; });
        }
        try { GM_setValue(RULE_HEALTH_KEY, JSON.stringify(m)); } catch (e) { /* storage unavailable */ }
    }

    // Leave out a rule that has never worked on this host and keeps 404ing there, bar the odd retry.
    function ruleSkipped(r) {
        const m = ruleHealth(), k = r.rule.ruleName + '|' + r.host, e = m[k];
        if (!e || e.h > 0 || e.f < RULE_DEAD_AFTER) return false;
        e.s = (e.s || 0) + 1;
        saveRuleHealth(m);
        if (e.s % RULE_RETRY_EVERY === 0) return false;
        dbg('skipped — this rule has never worked here', { rule: r.rule.ruleName, host: r.host, url: r.url });
        return true;
    }

    // Tally one probe of a rule's guess: loaded, or a 4xx. Anything less certain is not counted.
    function ruleOutcome(c, dim) {
        const d = dim ? null : diagValue.get(c.url);
        if (!dim && !(d && d.kind === 'gone')) return;
        const m = ruleHealth(), k = c.rule.ruleName + '|' + c.ruleHost, now = Date.now();
        const e = m[k] || (m[k] = { h: 0, f: 0, s: 0, since: 0 });
        if (dim) { e.h++; e.f = 0; e.since = 0; }
        else { if (!e.f) e.since = now; e.f++; }
        e.s = 0; e.t = now;
        saveRuleHealth(m);
    }

    // Site rules that have stopped working: [{ rule, host, fails, since, hits }], worst first.
    function brokenRules() {
        const m = ruleHealth(), report = new Set();
        UPGRADES.forEach(function (fn) { if (fn.report) report.add(fn.ruleName); });
        return Object.keys(m).map(function (k) {
            const i = k.lastIndexOf('|');
            return { rule: k.slice(0, i), host: k.slice(i + 1), fails: m[k].f, since: m[k].since, hits: m[k].h };
        })
            .filter(function (b) { return report.has(b.rule) && b.fails >= RULE_DEAD_AFTER; })
            .sort(function (a, b) { return b.fails - a.fails; });
    }

    // ---- dead links: the widget's ⚠ when most pictures here point at a larger file that never loads. See TOUR.md "Dead-link ⚠".
    const DEAD_MIN = 5;             // pictures with a lead before the widget may warn
    const deadLinks = new Map();    // displayed url -> true when every lead it had failed to load
    let deadHost = '';

    // Record one finished full search: did any lead to a larger file return a picture, of any size?
    function noteLeads(displayed, shown, leads) {
        if (!shown || !isTopFrame || !leads.tried) return;
        if (displayed.w < cfg.smallBelow && displayed.h < cfg.smallBelow) return;     // icons, emoji, avatars
        if (deadHost !== pageHost()) { deadLinks.clear(); deadHost = pageHost(); }
        deadLinks.set(shown, !leads.ok);
        twSync();
    }

    // { dead, of } when most pictures looked up on this page had only dead leads, else null.
    function deadLinkSite() {
        if (deadHost !== pageHost() || deadLinks.size < DEAD_MIN) return null;
        let dead = 0;
        deadLinks.forEach(function (v) { if (v) dead++; });
        return dead * 2 > deadLinks.size ? { dead: dead, of: deadLinks.size } : null;
    }

    const SRCSET_KEEP = 2;      // per list: the widest, and one behind it in case that 404s. See E46.

    // Ordered best-first list of candidates worth trying for this element, each as `{ url, from, keep }`.
    // An element harvested from a FETCHED page carries the page it came from, and every relative
    // URL on it resolves against that rather than against this document. See TOUR.md §10.
    function baseOf(el) {
        return (el && el.__hzBase) || location.href;
    }

    function collectCandidates(el) {
        const seen = new Map();
        const out = [];
        const at = baseOf(el);
        const add = function (u, from, keep, r) {
            if (!u) return;
            let abs;
            try { abs = new URL(u, at).href; } catch (e) { return; }
            if (abs.startsWith('data:') || abs.startsWith('blob:')) return;
            if (blocked(abs)) return;       // never probe something the user has ruled out
            if (unstable.has(abs)) return;  // it has already been caught changing under us
            if (!videoPreviewsOn() && isVideoUrl(abs)) return;
            // A lead points at the larger file: anything but a generic rule's guess or the picture itself.
            const lead = r ? !!r.rule.report : from !== 'the displayed src itself';
            if (seen.has(abs)) { if (keep) seen.get(abs).keep = true; if (lead) seen.get(abs).lead = true; return; }
            const c = { url: abs, from: from, keep: !!keep, lead: lead };
            if (r) { c.rule = r.rule; c.ruleHost = r.host; }
            seen.set(abs, c);
            out.push(c);
        };
        const adder = function (from) { return function (u) { add(u, from); }; };
        const ruled = function (from) {
            return function (r) { if (!ruleSkipped(r)) add(r.url, from, false, r); };
        };

        const shown = shownUrl(el);
        // 0. where the user showed the original lives, for pictures from this host
        if (shown) taughtCandidates(shown, at).forEach(adder(TAUGHT_FROM));

        // 1. explicit high-res attributes
        DATA_ATTRS.forEach(function (a) {
            const v = el.getAttribute && el.getAttribute(a);
            if (v && !/\s/.test(v.trim())) add(v.trim(), a);
        });
        const dataSrcset = el.getAttribute && el.getAttribute('data-srcset');
        if (dataSrcset) parseSrcset(dataSrcset).slice(0, SRCSET_KEEP).forEach(adder('data-srcset'));

        // 2. srcset on the image and on any <picture><source>
        let bestSrcset = null;
        if (el.tagName === 'IMG') {
            if (el.srcset) {
                const list = parseSrcset(el.srcset);
                if (list.length) bestSrcset = list[0];
                list.slice(0, SRCSET_KEEP).forEach(adder('srcset'));
            }
            const pic = el.closest && el.closest('picture');
            if (pic) {
                pic.querySelectorAll('source[srcset]').forEach(function (s) {
                    const list = parseSrcset(s.srcset);
                    if (!bestSrcset && list.length) bestSrcset = list[0];
                    list.slice(0, SRCSET_KEEP).forEach(adder('<picture> <source srcset>'));
                });
            }
        }

        // 2b. the widest srcset entry is itself often a resized derivative
        if (bestSrcset) upgradeRules(bestSrcset).forEach(ruled('url rule on the widest srcset entry'));

        const a = el.closest && el.closest('a[href]');
        if (a && a.href && anchorOwns(el, a)) {
            if (looksLikeImage(a.href) || (videoPreviewsOn() && isVideoUrl(a.href))) add(a.href, 'the ancestor link itself', true);
            else {
                // A declaration, not a guess, so it is kept out of the probe budget. See E48.
                linkParamCandidates(a.href).forEach(function (u) {
                    add(u, 'a url inside the ancestor link\'s query', true);
                });
                upgradeRules(a.href).filter(function (r) { return looksLikeImage(r.url); })
                    .forEach(ruled('url rule on the ancestor link'));
            }
        }

        // 4. rewrites of the displayed src
        // An image proxy carries its source in its own query: ?url=, ?piurl=, ?imgurl=. See E48.
        if (shown) linkParamCandidates(shown).forEach(adder('a url inside the displayed src\'s query'));
        if (shown) upgradeRules(shown).forEach(ruled('url rule on the displayed src'));

        // 5. the displayed src itself, last — it is the fallback, never the upgrade
        if (shown) add(shown, 'the displayed src itself', true);

        return out;
    }

    const TAUGHT_FROM = 'a pattern you taught';

    // Every taught rule's rewrite of `src`, from the rules for its own host.
    function taughtCandidates(src, at) {
        let u;
        try { u = new URL(src, at); } catch (e) { return []; }
        const out = [];
        ((cfg.taughtRules || {})[u.hostname] || []).forEach(function (r) {
            const v = taughtApply(r, u.href);
            if (v && out.indexOf(v) < 0) out.push(v);
        });
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

    // A lazy <img> still showing a blocked placeholder: the unblocked picture its data attribute names, else null.
    function lazyBehindBlocked(el) {
        if (el.tagName !== 'IMG' || !el.getAttribute) return null;
        const shown = shownUrl(el);
        if (!shown || !blocked(shown)) return null;
        for (let i = 0; i < DATA_ATTRS.length; i++) {
            const v = (el.getAttribute(DATA_ATTRS[i]) || '').trim();
            if (!v || /\s/.test(v)) continue;
            let abs;
            try { abs = new URL(v, baseOf(el)).href; } catch (e) { continue; }
            if (abs !== shown && /^https?:/.test(abs) && !blocked(abs)) return abs;
        }
        return null;
    }

    // The URL a picture is judged and known by: the shown one, or the real one behind a blocked placeholder.
    function pictureUrl(el) {
        return lazyBehindBlocked(el) || shownUrl(el);
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

    // Did the probe load the picture the page decoded? Exact, unless the page's size is density-corrected (E45).
    function samePicture(native, dim) {
        if (!native.scaled) return dim.w === native.w && dim.h === native.h;
        return Math.abs(native.w * dim.h - native.h * dim.w) <= dim.w + dim.h;
    }

    // The size of the bytes the page ALREADY has for this element. `scaled`: under srcset, naturalWidth is divided by the candidate's density.
    function nativeSize(el) {
        if (el.tagName === 'IMG' && el.naturalWidth > 0)
            return { w: el.naturalWidth, h: el.naturalHeight,
                scaled: !!(el.srcset || (el.closest && el.closest('picture'))) };
        if (el.tagName === 'VIDEO' && el.videoWidth > 0)
            return { w: el.videoWidth, h: el.videoHeight };
        return null;    // a background image, or nothing decoded yet — nothing to check
    }

    const PLACEHOLDER_PX = 2;
    const PLACEHOLDER_DATA_LEN = 300;

    // A lazy page's stand-in (Google's 1x1 GIF): never shown as the page's own picture.
    function placeholder(el, url) {
        const n = nativeSize(el);
        if (n) return n.w <= PLACEHOLDER_PX && n.h <= PLACEHOLDER_PX;
        return !!url && url.indexOf('data:') === 0 && url.length < PLACEHOLDER_DATA_LEN;
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

    const IMAGE_PROBE_MS = 20000;
    const PROBE_RETRY_MS = 30000;   // a miss is forgotten after this; a stall or a 429 is not for life

    // ---- the page's own CSP refuses our probes. See E49.

    let cspBlocksOffsite = false;   // this page has refused at least one off-site image
    let blobRefused = false;        // ...and refuses blob: as well, so data: is the only way in
    const cspHits = new Set();      // exact URLs the page has refused

    document.addEventListener('securitypolicyviolation', function (e) {
        if (!/^(?:img-src|default-src)/.test(e.violatedDirective || '')) return;
        const u = String(e.blockedURI || '');
        if (!u) return;
        if (u === 'blob' || u.indexOf('blob:') === 0) { blobRefused = true; return; }
        if (u === 'data' || u.indexOf('data:') === 0) return;
        cspHits.add(u);
        cspBlocksOffsite = true;
    });

    // Was this URL refused by policy rather than by the server? The exact hit if we have it,
    // otherwise any off-site URL on a page already known to refuse them.
    function cspRefused(url) {
        if (cspHits.has(url)) return true;
        if (!cspBlocksOffsite) return false;
        try { return new URL(url, location.href).origin !== location.origin; } catch (e) { return false; }
    }

    function measureSrc(src) {
        return new Promise(function (res) {
            const im = new Image();
            let t = 0;
            const fin = function (ok) {
                clearTimeout(t);
                im.onload = im.onerror = null;
                res(ok && im.naturalWidth > 0 ? { w: im.naturalWidth, h: im.naturalHeight } : null);
            };
            im.onload = function () { fin(true); };
            im.onerror = function () { setTimeout(function () { fin(false); }, 0); };
            t = setTimeout(function () { fin(false); }, IMAGE_PROBE_MS);
            im.src = src;
        });
    }

    // GM_xhr is not subject to the page's CSP, so the bytes are always reachable.
    function fetchBlob(url) {
        return new Promise(function (res) {
            if (typeof GM_xmlhttpRequest !== 'function') { res(null); return; }
            let settled = false;
            const fin = function (v) { if (!settled) { settled = true; res(v); } };
            // GM_xhr's own timeout does not cover a pending permission dialog, and a request that
            // never calls back parks the whole candidate loop on this URL.
            setTimeout(function () { fin(null); }, IMAGE_PROBE_MS);
            try {
                GM_xmlhttpRequest({
                    method: 'GET', url: url, responseType: 'blob', timeout: IMAGE_PROBE_MS,
                    onload: function (r) {
                        if (r.status && (r.status < 200 || r.status >= 300)) { fin(null); return; }
                        fin(r.response || null);
                    },
                    onerror: function () { fin(null); },
                    ontimeout: function () { fin(null); },
                });
            } catch (e) { fin(null); }
        });
    }

    function blobToDataUrl(blob) {
        return new Promise(function (res) {
            try {
                const fr = new FileReader();
                fr.onload = function () { res(String(fr.result)); };
                fr.onerror = function () { res(null); };
                fr.readAsDataURL(blob);
            } catch (e) { res(null); }
        });
    }

    const bytesCache = new Map();   // url -> Promise<{w,h,display}|null>
    const bytesMime = new Map();    // url -> the fetched file's type, for a saved file's extension
    const liveBlobs = [];           // object URLs held open, oldest first
    const BYTES_MAX = 12;           // enough for a tour's window; the oldest is revoked

    function keepBlob(url, objUrl) {
        liveBlobs.push({ url: url, objUrl: objUrl });
        while (liveBlobs.length > BYTES_MAX) {
            const old = liveBlobs.shift();
            bytesCache.delete(old.url);
            URL.revokeObjectURL(old.objUrl);
        }
    }

    // blob: where the policy allows it, data: otherwise — every blocked engine measured takes one.
    async function probeBytes(url) {
        const blob = await fetchBlob(url);
        if (!blob) return null;
        bytesMime.set(url, blob.type || '');
        if (!blobRefused) {
            const objUrl = URL.createObjectURL(blob);
            const dim = await measureSrc(objUrl);
            if (dim) { keepBlob(url, objUrl); return { w: dim.w, h: dim.h, display: objUrl }; }
            URL.revokeObjectURL(objUrl);
        }
        const data = await blobToDataUrl(blob);
        if (!data) return null;
        const dim = await measureSrc(data);
        return dim ? { w: dim.w, h: dim.h, display: data } : null;
    }

    function bytesFor(url) {
        if (bytesCache.has(url)) return bytesCache.get(url);
        const p = probeBytes(url);
        bytesCache.set(url, p);
        return p;
    }

    // ---- how long to wait, and telling a dead host from a slow one. See TOUR.md §7.

    const LIVENESS_MS = 3000;       // still silent here, and the paid diagnostic fires
    const ATTEMPT_FLOOR_MS = 5000;  // no single attempt is cut shorter than this
    const ATTEMPT_CEIL_MS = 20000;  // and none runs longer, whatever the file size says
    const PROBE_TOTAL_MS = 30000;   // across every attempt at one URL
    const IMAGE_TRIES = 3;
    const IMG_RATE = 100 * 1024;    // bytes/sec assumed, the measured floor for images
    const DIAG_BYTES = 4096;
    // Longer than it looks it needs to be, on purpose: a server that is merely slow answers
    // this request slowly too, and a diagnostic that times out first calls it dead. See E52.
    const DIAG_MS = 10000;

    // The total file size. On a 206 that is the tail of Content-Range — Content-Length is the
    // slice, and reads 4096 for a 9 MB file.
    function sizeFromHeaders(h, status) {
        const cr = /content-range:\s*bytes\s+\d+-\d+\/(\d+)/i.exec(h);
        if (cr) return parseInt(cr[1], 10) || 0;
        if (status === 200) {
            const cl = /content-length:\s*(\d+)/i.exec(h);
            if (cl) return parseInt(cl[1], 10) || 0;
        }
        return 0;
    }

    // A silent GM_xhr means a dead host ONLY once one has answered here. Before that it is
    // indistinguishable from a blocked grant or a pending permission dialog, and treating
    // that as death would fail every picture on the page in three seconds.
    let gmXhrWorks = false;

    const diagCache = new Map();    // url -> Promise<verdict>
    const diagValue = new Map();    // url -> the settled verdict, readable synchronously

    // Why is this URL not answering? One ranged request settles it, and the same answer carries
    // the file size that sets the waiting budget.
    function diagnose(url) {
        if (diagCache.has(url)) return diagCache.get(url);
        const p = rangeGet(url, DIAG_BYTES, DIAG_MS).then(function (r) {
            let v;
            // A timeout says slow, never dead — keep waiting. Only a refused connection,
            // and only once GM_xhr has been seen to work here, is fatal.
            if (!r || r.timedOut) v = { kind: 'unknown', status: 0, total: 0 };
            else if (r.netError) v = { kind: gmXhrWorks ? 'dead' : 'unknown', status: 0, total: 0 };
            else if (r.status === 429 || ((r.status === 403 || r.status === 503) && /retry-after:/i.test(r.headers)))
                v = { kind: 'busy', status: r.status, total: 0 };
            else if (r.status >= 400 && r.status < 500) v = { kind: 'gone', status: r.status, total: 0 };
            else if (r.status >= 500) v = { kind: 'dead', status: r.status, total: 0 };
            else v = { kind: 'alive', status: r.status, total: sizeFromHeaders(r.headers, r.status) };
            diagValue.set(url, v);
            if (v.kind === 'busy') logBusy(url, r);   // before hardBlock, or every refusal reads as "slowed"
            hardBlock(url, v);      // the one answer that changes how hard we may push the host
            return v;
        });
        diagCache.set(url, p);
        return p;
    }

    // A sentence for the status bar, from the diagnosis the probe already paid for.
    function failureText(url) {
        const d = diagValue.get(url);
        if (!d) return 'the picture did not load';
        if (d.kind === 'gone') return 'not found (' + d.status + ')';
        if (d.kind === 'busy') return 'rate-limited (' + d.status + ')';
        if (d.kind === 'dead') return d.status ? 'the site answered ' + d.status : 'no answer from the site';
        return 'the picture did not load';
    }

    // One attempt. Resolves with the size, or a verdict saying whether another is worth making.
    function imageAttempt(url, deadlineAt) {
        return new Promise(function (res) {
            const img = new Image();
            if (noReferrerHere()) img.referrerPolicy = 'no-referrer';
            let live = 0, cap = 0, settled = false;
            const fin = function (v) {
                if (settled) return;
                settled = true;
                clearTimeout(live); clearTimeout(cap);
                img.onload = img.onerror = null;
                if (!v.dim) img.src = '';           // abort a transfer we have stopped waiting for
                res(v);
            };
            const arm = function (ms) {
                clearTimeout(cap);
                cap = setTimeout(function () { fin({ retry: true, timedOut: true }); },
                    Math.max(0, Math.min(ms, deadlineAt - Date.now())));
            };
            img.onload = function () {
                fin(img.naturalWidth > 0 ? { dim: { w: img.naturalWidth, h: img.naturalHeight } }
                    : { stop: true, why: 'the file is not a picture' });
            };
            // Deferred a tick: the violation event must land before we decide why this failed.
            img.onerror = function () {
                setTimeout(function () { fin(cspRefused(url) ? { csp: true } : { retry: true }); }, 0);
            };
            arm(ATTEMPT_CEIL_MS);
            live = setTimeout(function () {
                diagnose(url).then(function (d) {
                    if (settled) return;
                    if (d.kind === 'unknown') { arm(ATTEMPT_CEIL_MS - LIVENESS_MS); return; }
                    if (d.kind !== 'alive') { fin({ stop: true, diag: d }); return; }
                    // Alive, so the wait is the file's own cost, not a hang.
                    const want = d.total ? d.total / IMG_RATE * 1000 : ATTEMPT_FLOOR_MS;
                    arm(Math.max(ATTEMPT_FLOOR_MS, Math.min(want, ATTEMPT_CEIL_MS)));
                });
            }, LIVENESS_MS);
            img.src = url;
            if (img.complete && img.naturalWidth > 0) fin({ dim: { w: img.naturalWidth, h: img.naturalHeight } });
        });
    }

    async function probeImage(url) {
        const deadlineAt = Date.now() + PROBE_TOTAL_MS;
        for (let i = 0; i < IMAGE_TRIES; i++) {
            const r = await imageAttempt(url, deadlineAt);
            if (r.dim) return r.dim;
            // A refusal is not a failure: the bytes are still reachable. See E49.
            if (r.csp) { dbg('refused by the page CSP — fetching the bytes instead', url); return bytesFor(url); }
            if (r.stop) { dbg('gave up', { url: url, why: r.why || failureText(url) }); return null; }
            // An error lands in milliseconds, before the liveness deadline could fire, so a 404
            // would otherwise spend every attempt. Diagnose before deciding to try again.
            const d = await diagnose(url);
            if (d.kind !== 'alive' && d.kind !== 'unknown') { dbg('gave up', { url: url, why: failureText(url) }); return null; }
            if (Date.now() >= deadlineAt) break;
            dbg('retrying', { url: url, attempt: i + 2, size: d.total });
        }
        return null;
    }

    const probeMiss = new Set();    // URLs whose cached promise settled as a failure

    function probe(url, fresh) {
        // A user gesture always retries: only a settled miss is evicted, never a probe in flight.
        if (fresh && probeMiss.has(url)) {
            probeCache.delete(url); probeMiss.delete(url);
            diagCache.delete(url); diagValue.delete(url);
        }
        if (probeCache.has(url)) return probeCache.get(url);
        const p = isVideoUrl(url) ? probeVideo(url) : probeImage(url);
        probeCache.set(url, p);
        p.then(function (dim) {
            if (dim) return;
            probeMiss.add(url);
            setTimeout(function () {
                if (probeCache.get(url) === p) { probeCache.delete(url); probeMiss.delete(url); }
            }, PROBE_RETRY_MS);
        });
        return p;
    }

    const MAX_PROBES = 8;

    const LINKED_TRIES = 4;         // the linked page's own answers: og media, then its markup

    const ANIM_HEAD = 4096;
    const animCache = new Map();    // url -> Promise<boolean>

    // One small ranged GET, with the status and headers kept. GM_xmlhttpRequest, not fetch: the
    // file is usually on a CDN that sends no CORS headers, and GM_xhr is not subject to the
    // page's CSP either.
    function rangeGet(url, n, ms) {
        return new Promise(function (res) {
            if (typeof GM_xmlhttpRequest !== 'function') { res(null); return; }
            let done = false;
            const fin = function (v) { if (!done) { done = true; res(v); } };
            // GM's own timeout does not cover a pending permission dialog. See E51.
            setTimeout(function () { fin({ status: 0, timedOut: true, headers: '' }); }, ms + 500);
            try {
                GM_xmlhttpRequest({
                    method: 'GET', url: url, responseType: 'arraybuffer', timeout: ms,
                    headers: { Range: 'bytes=0-' + (n - 1) },
                    // Only the head, whatever the server made of the Range header.
                    onload: function (r) {
                        const b = r.response;
                        gmXhrWorks = true;
                        fin({
                            status: r.status || 0,
                            headers: String(r.responseHeaders || ''),
                            bytes: b && b.byteLength != null
                                ? new Uint8Array(b, 0, Math.min(n, b.byteLength)) : null,
                        });
                    },
                    onerror: function () { fin({ status: 0, netError: true, headers: '' }); },
                    ontimeout: function () { fin({ status: 0, timedOut: true, headers: '' }); },
                });
            } catch (e) { fin(null); }
        });
    }

    function headBytes(url, n) {
        return rangeGet(url, n, 4000).then(function (r) { return r && r.bytes ? r.bytes : null; });
    }

    function isAnimated(url) {
        if (animCache.has(url)) return animCache.get(url);
        const p = headBytes(url, ANIM_HEAD).then(sniffAnimated, function () { return false; });
        animCache.set(url, p);
        return p;
    }

    // The only place the script looks INSIDE a file, and only in the mode that asked for stillness.
    async function motionRefused(url) {
        if (videoPreviewsOn()) return false;
        let path;
        try { path = new URL(url, location.href).pathname; } catch (e) { return false; }
        if (!ANIM_EXT_RE.test(path)) return false;
        const anim = await isAnimated(url);
        if (anim) dbg('refused — an animated image, and video is set to none', url);
        return anim;
    }

    const pageCache = new Map();    // page url -> Promise<{url, video}|null>

    function metaContent(doc, names) {
        for (let i = 0; i < names.length; i++) {
            const m = doc.querySelector('meta[property="' + names[i] + '"], meta[name="' + names[i] + '"]');
            const v = m && m.getAttribute('content');
            if (v && v.trim()) return v.trim();
        }
        return null;
    }

    // Media in the fetched page's own markup and links to media files, any host — resolved against that page.
    function pageBodyMedia(doc, pageUrl) {
        const out = [], seen = new Set();
        doc.querySelectorAll('img[src], video[src], video source[src], a[href]').forEach(function (n) {
            const raw = n.getAttribute(n.tagName === 'A' ? 'href' : 'src');
            if (!raw) return;
            let u;
            try { u = new URL(raw, pageUrl.href); } catch (e) { return; }
            if (!/^https?:$/.test(u.protocol) || seen.has(u.href)) return;
            if (!looksLikeImage(u.href) && !(videoPreviewsOn() && isVideoUrl(u.href))) return;
            seen.add(u.href);
            out.push(u.href);
        });
        return out;
    }

    // What a fetched page says its media is: what it declares, and what its markup holds.
    // The og:image THIS page declares for itself. A linked page repeating it is showing the site's
    // share card, which says nothing about the picture. See E48.
    let ownOg;
    function ownOgImage() {
        if (ownOg === undefined) {
            const m = document.querySelector('meta[property="og:image"], meta[name="og:image"]');
            const v = m && m.getAttribute('content');
            try { ownOg = v ? new URL(v, location.href).href : null; } catch (e) { ownOg = null; }
        }
        return ownOg;
    }

    function pageMediaFrom(doc, pageUrl) {
        const declared = metaContent(doc, ['og:url']);
        if (declared) {
            let d = null;
            try { d = new URL(declared, pageUrl.href); } catch (e) { d = null; }
            if (!d || d.pathname.replace(/\/+$/, '') !== pageUrl.pathname.replace(/\/+$/, '')) return null;
        }
        let og = null;
        const vid = metaContent(doc, ['og:video:secure_url', 'og:video:url', 'og:video',
            'twitter:player:stream']);
        if (vid && videoPreviewsOn() && isVideoUrl(vid)) {
            try { og = { url: new URL(vid, pageUrl.href).href }; } catch (e) { /* fall through */ }
        }
        if (!og) {
            const img = metaContent(doc, ['og:image:secure_url', 'og:image', 'twitter:image:src',
                'twitter:image']);
            if (img && looksLikeImage(img)) {
                try {
                    const abs = new URL(img, pageUrl.href).href;
                    if (abs === ownOgImage()) dbg('linked page rejected — it declares the same share card this page does', abs);
                    else og = { url: abs };
                } catch (e) { /* none */ }
            }
        }
        const grid = gridMedia(doc, pageUrl.href);
        return { declared: og, body: pageBodyMedia(doc, pageUrl).filter(function (u) { return !grid.has(u); }) };
    }

    // The URLs of a fetched page's grid cells (thumbnail and link): a copy there is one of many, not the page's picture. See P17.
    function gridMedia(doc, href) {
        const out = new Set(), cells = galGroup(doc, href, true);
        if (cells.length < GAL_HTML_ENOUGH) return out;
        cells.forEach(function (x) {
            out.add(x.thumb);
            const a = x.el.closest('a[href]');
            try { if (a) out.add(new URL(a.getAttribute('href'), href).href); } catch (e) { /* no link */ }
        });
        return out;
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

    // The same-origin page this picture links to, worth fetching for its media; null when none.
    function linkTarget(el) {
        const a = closestAcross(el, 'a[href]');
        const href = a && a.getAttribute('href');
        if (!href) return null;
        const at = baseOf(el);
        let u;
        try { u = new URL(href, at); } catch (e) { return null; }
        if (!/^https?:$/.test(u.protocol)) return null;
        if (u.origin !== location.origin) return null;
        u.hash = '';
        if (u.href === at.split('#')[0]) return null;   // the page it is on
        if (looksLikeImage(u.href) || isVideoUrl(u.href)) return null;
        return u;
    }

    // A linkless picture's card link: the one page link of its smallest ancestor holding no other picture like it (nsfw.xxx's post button). See RESOLVER.md "Card link".
    function cardLink(el) {
        const l = cardLinks(el);
        return l.length === 1 ? new URL(l[0]) : null;
    }

    // Every page link (up to 4) of a linkless picture's smallest card that has any.
    function cardLinks(el) {
        if (!el || !el.parentElement) return [];
        const at = baseOf(el), doc = el.ownerDocument;
        const like = function (n) { return n !== el && n.className === el.className; };
        for (let e = el.parentElement, i = 0; e && i < 4 && e !== doc.body; e = e.parentElement, i++) {
            if (Array.prototype.some.call(e.getElementsByTagName(el.tagName), like)) return [];
            const hrefs = new Set();
            e.querySelectorAll('a[href]').forEach(function (a) {
                let u;
                try { u = new URL(a.getAttribute('href'), at); } catch (x) { return; }
                u.hash = '';
                if (/^https?:$/.test(u.protocol) && u.origin === location.origin && u.href !== at.split('#')[0] &&
                    !looksLikeImage(u.href) && !isVideoUrl(u.href)) hrefs.add(u.href);
            });
            if (hrefs.size) return Array.from(hrefs).slice(0, 4);
        }
        return [];
    }

    function linkedMedia(u) {
        if (!u) return Promise.resolve(null);
        if (pageCache.has(u.href)) return pageCache.get(u.href);
        const p = fetchPageMedia(u);
        pageCache.set(u.href, p);
        return p;
    }

    // With sizeGate, the required upsize, strictly (1 is "anything bigger"), linked pages included.
    // Without it, anything the window would draw larger than the page does.
    function bigEnough(dim, displayed) {
        if (cfg.sizeGate) return dim.w > displayed.w * cfg.minRatio || dim.h > displayed.h * cfg.minRatio;
        const m = viewportBox();
        const s = Math.min(fromShown(cfg.zoomLimit), m.w / dim.w, m.h / dim.h);
        return dim.w * s > displayed.w + 1 || dim.h * s > displayed.h + 1;
    }

    // `guesses` caps the non-keep candidates for a SPECULATIVE resolve; the full search runs on
    // arrival if a cut one came up empty. See TOUR.md §6.
    async function resolve(el, displayed, token, onHit, guesses) {
        // The budget falls on the guesses; the link and the displayed src are always tried. See E46.
        const all = collectCandidates(el);
        const keeps = all.filter(function (c) { return c.keep; }).length;
        let budget = guesses === undefined ? MAX_PROBES - keeps : Math.max(0, guesses | 0);
        const candidates = all.filter(function (c) { return c.keep || budget-- > 0; });
        const shown = shownUrl(el);
        const native = nativeSize(el);      // the bytes on screen, for the stability test
        const full = guesses === undefined;      // a speculative search is capped, so says nothing about the site
        const leads = { tried: 0, ok: false };
        dbg('candidates', candidates);
        let best = null;
        let trusted = null;
        let emitted = null;
        let failure = null;      // a candidate that FAILED, as opposed to one merely rejected
        let lfailed = false;     // one of the linked page's own candidates failed

        // Both paths below emit through here, so a later hit can never downgrade the frame.
        function emit(hit) {
            if (token.cancelled || !betterHit(emitted, hit)) {
                if (hit && !token.cancelled)
                    dbg('upgrade refused — not an improvement on what is showing',
                        { showing: emitted, offered: hit });
                return;
            }
            emitted = hit;
            if (onHit) onHit(hit);
        }

        // Learned per area: a linked page that never holds the original is skipped, bar a recheck. See E15.
        const ownLink = !skipLinkedPage(el) && el.ownerDocument === document ? linkTarget(el) : null;
        const lt = ownLink || (!skipLinkedPage(el) && el.ownerDocument === document && !closestAcross(el, 'a[href]') ? cardLink(el) : null);
        const lchain = lt ? domChain(el) : '', lpath = pagePath();
        let lfetched = false;
        const lskip = lt && !token.recheck && areaRule('linkAreas', lchain, lpath) && Math.random() >= LINK_RECHECK;
        if (lskip) dbg('linked page skipped — pages linked from here have never held the original', { link: lt.href });
        const linked = !lt || lskip ? Promise.resolve(null) : linkedMedia(lt).then(async function (page) {
            if (!page || token.cancelled) return null;
            lfetched = true;
            const tries = [];
            // og:image is the share card on some sites, and that is the thumbnail itself.
            // A matching filename proves identity, so it outranks the shape test here too — the
            // thumbnail is often a square crop of a portrait original. See v0.58.0 and v0.90.0.
            if (page.declared && page.declared.url !== shown)
                tries.push({ url: page.declared.url,
                    named: !!(shown && sameStem(page.declared.url, shown)),
                    from: 'the page the thumbnail links to (og: media)' });
            page.body.forEach(function (u) {
                if (shown && u !== shown && sameStem(u, shown))
                    tries.push({ url: u, named: true, from: 'the page the thumbnail links to (its own markup)' });
            });
            // Largest of the page's own answers, not the first — og: may be a share crop.
            for (const t of tries.slice(0, LINKED_TRIES)) {
                if (token.cancelled) break;
                if (blocked(t.url)) continue;
                const dim = await probe(t.url, token.fresh);
                leads.tried++;
                if (dim) leads.ok = true;
                if (!dim) { failure = failure || failureText(t.url); lfailed = true; continue; }
                if (token.cancelled) continue;
                // A matching filename already proves identity; the thumbnail may be a fixed-shape crop.
                if (!t.named && !sameShape(native, dim)) {
                    dbg('linked page rejected — a different shape, so a different picture', {
                        url: t.url, from: t.from,
                        onScreen: native ? native.w + '×' + native.h : '(unknown)',
                        declared: dim.w + '×' + dim.h,
                    });
                    continue;
                }
                if (!bigEnough(dim, displayed)) {
                    dbg('linked page rejected — under the required upsize', {
                        url: t.url, from: t.from, minRatio: cfg.minRatio,
                        onScreen: displayed.w + '×' + displayed.h,
                        declared: dim.w + '×' + dim.h,
                    });
                    continue;
                }
                if (await motionRefused(t.url)) continue;
                if (trusted && dim.w * dim.h <= trusted.w * trusted.h) continue;
                if (trusted && trusted.video && !dim.video) continue;
                trusted = { url: t.url, w: dim.w, h: dim.h, video: !!dim.video, duration: dim.duration,
                    display: dim.display, trusted: true, from: t.from };
                dbg('hit (declared by the linked page)', trusted);
                emit(trusted);
            }
            return trusted;
        }, function () { return null; });

        for (const c of candidates) {
            const url = c.url;
            if (token.cancelled) return trusted || best;
            if (trusted) break;             // the authoritative answer landed; stop guessing
            const dim = await probe(url, token.fresh);
            if (c.rule) ruleOutcome(c, dim);
            if (c.lead && url !== shown) { leads.tried++; if (dim) leads.ok = true; }
            if (!dim) { failure = failure || failureText(url); continue; }
            const isSameAsShown = (url === shown);
            if (isSameAsShown && native && !samePicture(native, dim)) {
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
                if (!dim.video && (!token.small || dim.w * dim.h > token.small.w * token.small.h))
                    token.small = { url: url, w: dim.w, h: dim.h, display: dim.display, from: c.from };
                dbg('rejected — under the required upsize', {
                    url: url, from: c.from, minRatio: cfg.minRatio,
                    onScreen: displayed.w + '×' + displayed.h,
                    candidate: dim.w + '×' + dim.h,
                });
                continue;
            }
            if (await motionRefused(url)) continue;
            if (best && dim.w * dim.h <= best.w * best.h) continue;   // not an improvement
            if (best && best.video && !dim.video) continue;
            best = { url: url, w: dim.w, h: dim.h, video: !!dim.video, duration: dim.duration,
                display: dim.display, from: c.from };
            dbg('hit', best);
            emit(best);
        }
        await linked;
        if (lt && lfetched && !token.cancelled) {
            if (trusted) areaApply('linkAreas', areaDrop, lchain, lpath);
            else areaApply('linkAreas', areaLearn, lchain, lpath, lt.href);
        }
        if (ownLink && full && token.door && !token.cancelled) doorLearn(doorVerdict({
            linked: lfetched ? 'fetched' : lskip ? 'skipped' : null, trusted: trusted,
            displayed: displayed, failed: lfailed }), lchain, lpath, lt.href);
        if (trusted) {
            // The linked page names the picture, but the page's own copy of it may be bigger.
            const own = shown && !trusted.video && !token.cancelled && !unstable.has(shown) ? await probe(shown, false) : null;
            if (own && !own.video && own.w * own.h > trusted.w * trusted.h && sameShape(native, own)) {
                const hit = { url: shown, w: own.w, h: own.h, display: own.display, from: 'the page\'s own picture, bigger than the linked page\'s' };
                dbg('hit', hit);
                emit(hit);
                if (full) noteLeads(displayed, shown, leads);
                return hit;
            }
            if (full) noteLeads(displayed, shown, leads);
            return trusted;
        }
        // Nothing loaded AND something actually failed — the caller shows the reason. A run
        // that only rejected candidates for being too small leaves this null on purpose.
        if (!best && failure) token.failure = failure;
        if (full && !token.cancelled) noteLeads(displayed, shown, leads);
        return best;
    }

    let host = null, root = null, box = null, imgEl = null, vidEl = null, mediaEl = null, coverEl = null;
    let dimEl = null;
    let xEl = null, cornerXEl = null;
    let capEl = null, capNameEl = null, capHintEl = null, capMetaEl = null, blockEl = null;
    let zctlEl = null, zsliderEl = null, zoomWrapEl = null, zvalEl = null, zinEl = null;
    let vidOffEl = null;        // "stop showing clips", only while the frame IS one
    let aaEl = null;            // smoothing, toggled between its two answers
    let blockPopEl = null;
    let bytesPopEl = null;      // our own Save / Open / Copy for a picture shown from bytes. See E9a.

    let gripEl = null;          // invisible collar that carries the outer half of the resize strip
    let spinEl = null, spinSvg = null;
    let savedMarkEl = null;      // the small blue disc by the pointer over a picture saved this visit
    const SAVED_MARK = 12;       // px
    const midSaved = new Map(); // url -> when pressed, or Infinity once saved; this page address only
    let midSavedHref = '';
    const MID_RETRY_MS = 60000; // a save that never reported back may be pressed again after this
    let seamNoteEl = null, seamNoteTimer = 0;
    let fsEl = null;            // the bar's fullscreen button
    let vctlEl = null, vgrpEl = null, vplayEl = null, vtimeEl = null, vseekEl = null,
        vrateEl = null, vmuteEl = null, vsoundEl = null, vvolEl = null, vvolInEl = null,
        ratePopEl = null, rateInEl = null;
    let retryEl = null;         // in the bar, and only on a failed picture during a tour
    let teachEl = null, teachPopEl = null, teachInEl = null, teachMsgEl = null, teachGoEl = null, teachNoEl = null;
    let seekDrag = false;       // the scrubber is being held; timeupdate must not fight it
    let volDrag = false;        // ditto for the volume column against syncVideoCtl()
    let fullPrev = null;        // geometry to put back, and the "this fullscreen is ours" flag
    let fullApi = false;        // the real API engaged, rather than the maximise fallback
    let fullReq = null;         // the requestFullscreen() still in flight, which an exit waits out. See E47.

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const SPIN_SIZE = 24;                           // px, matches the .spin rule
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

    // ---- button icons, drawn rather than typed: the emoji a glyph would need render in colour
    // and break the monochrome bar, and the geometric alternatives are not portable.
    const ICON_FULL = 'M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z';
    const ICON_EXIT = 'M9 4v5H4V7h3V4h2zm6 0h2v3h3v2h-5V4zM4 15h5v5H7v-3H4v-2zm11 0h5v2h-3v3h-2v-5z';
    const ICON_PLAY = 'M7 4l12 8-12 8V4z';
    const ICON_PAUSE = 'M6 4h4v16H6V4zm8 0h4v16h-4V4z';
    const ICON_LOUD = 'M3 9v6h4l5 4V5L7 9H3zm12.5 3a3.5 3.5 0 0 0-2-3.15v6.3A3.5 3.5 0 0 0 15.5 12z' +
        'M14 4.2v2.06a5.75 5.75 0 0 1 0 11.48v2.06a7.75 7.75 0 0 0 0-15.6z';
    const ICON_MUTE = 'M3 9v6h4l5 4V5L7 9H3zm12.6-.9l1.4 1.4 1.4-1.4 1.4 1.4-1.4 1.4 1.4 1.4-1.4 1.4' +
        '-1.4-1.4-1.4 1.4-1.4-1.4 1.4-1.4-1.4-1.4 1.4-1.4z';
    // Stroked, not filled: a slash through a solid triangle reads as a triangle. Outlining both
    // is the only version that says "no" at 12 px.
    const ICON_NOPLAY = ['M8 5.5v13l10-6.5z', 'M4.5 19.5l15-15'];
    const ICON_PREV = 'M15 5l-8 7 8 7V5z';
    const ICON_NEXT = 'M9 5l8 7-8 7V5z';
    const ICON_WHEEL = 'M7 3l-4 5h3v13h2V8h3L7 3zm10 18l4-5h-3V3h-2v13h-3l4 5z';
    const ICON_CLOSE = 'M6.4 5L12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z';
    const ICON_RETRY = 'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z';
    const ICON_FIND = 'M10 3a7 7 0 0 1 5.6 11.2l4.6 4.6-1.4 1.4-4.6-4.6A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm-1 2h2v2h2v2h-2v2H9v-2H7V9h2V7z';

    // A filled glyph from one path, or a stroked one from several.
    function mkIcon(d) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        [].concat(d).forEach(function (one) {
            const p = document.createElementNS(SVG_NS, 'path');
            p.setAttribute('d', one);
            svg.appendChild(p);
        });
        return svg;
    }

    // Swap an icon button's glyph without rebuilding the button. Single-path icons only.
    function setIcon(btn, d) {
        const p = btn.querySelector('path');
        if (p) p.setAttribute('d', d);
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

    // The zoom ceiling in scale units; every fit and clamp reads this one.
    function maxScale() { return fromShown(Math.min(cfg.maxZoom, MAX_SCALE_ABS)); }

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
            '.dim.catch.thru{pointer-events:none}',
            // Fullscreen puts the whole document on the screen, so the page is still behind us.
            // vw/vh INCLUDE the scrollbar's reserved strip; inset:0 stops short of it. See E42.
            '.dim.full{background:#11111b;width:100vw;height:100vh}',
            '.grip{position:fixed;background:transparent;pointer-events:none}',
            '.grip.hot{pointer-events:auto}',
            '.box{position:fixed;opacity:0;pointer-events:none;transition:opacity var(--fade) ease;',
            'background:#1e1e2e;box-sizing:content-box;overflow:hidden}',
            '.box.on{opacity:1}',
            '.box.hot{pointer-events:auto}',
            '.box.placed:not(.pan){cursor:move}',
            '.box.pan{cursor:grab}',
            '.box.pan.drag{cursor:grabbing}',
            // Fullscreen is nailed to the screen, so nothing here is a handle. After .placed, or
            // the move cursor would still win.
            '.box.full:not(.pan){cursor:default}',
            'img,video{display:block;position:absolute;background:#1e1e2e;-webkit-user-drag:none;user-select:none}',
            'img[hidden],video[hidden]{display:none}',
            'canvas.cover{display:block;position:absolute;pointer-events:none}',
            'canvas.cover[hidden]{display:none}',
            '.cap{position:absolute;left:0;right:0;bottom:0;height:' + BAR_MIN_H + 'px;',
            'display:flex;align-items:center;gap:' + BAR_GAP + 'px;box-sizing:border-box;',
            'padding:0 ' + BAR_PAD + 'px;font:11px/16px system-ui,sans-serif;color:#cdd6f4;',
            'background:rgba(30,30,46,.86);letter-spacing:.02em;user-select:none}',

            '.cap .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
            'font-family:ui-monospace,SFMono-Regular,Consolas,monospace;color:#a6adc8}',
            // Shrinkable, or on a narrow frame it shoves the zoom cluster under the buttons.
            '.cap .meta{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;',
            'white-space:nowrap}',
            '.cap .hint{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;',
            'white-space:nowrap;color:#7f849c;font-style:italic}',
            '.box.placed .cap .hint{display:none}',
            '.cap .btn{position:absolute;top:50%;transform:translateY(-50%);display:none;',
            'width:18px;height:18px;line-height:18px;text-align:center;border-radius:4px;',
            'border:1px solid #45475a;background:rgba(49,50,68,.9);color:#a6adc8;',
            'cursor:pointer;font-size:12px}',
            '.box.hot .cap .block,.box.hot .cap .aa,.box.hot .cap .fs,.box.hot .cap .xb{display:block}',
            '.cap .xb svg{display:block;width:12px;height:12px;margin:3px auto;fill:currentColor}',
            '.cap .xb:hover{background:#f38ba8;border-color:#f38ba8;color:#1e1e2e}',
            // The corner one sits inside the corner's resize square, which answers round it.
            '.cx{position:absolute;top:' + CX_INSET + 'px;right:' + CX_INSET + 'px;width:' + CX_SIZE + 'px;',
            'height:' + CX_SIZE + 'px;box-sizing:border-box;display:none;align-items:center;justify-content:center;',
            'color:#cdd6f4;cursor:pointer;user-select:none;z-index:3;opacity:.6;',
            'transition:opacity var(--barfade) ease}',
            '.cx svg{display:block;width:100%;height:100%;fill:none;stroke:currentColor;',
            'stroke-width:1.6;stroke-linecap:round}',
            '.cx:hover{color:#f38ba8;opacity:1}',
            // Rides the bar's fade; with the bar off it shows only while the pointer is on the window.
            '.box.placed.hot .cx{display:flex}',
            '.box.baridle .cx{opacity:0;pointer-events:none}',
            '.box.nobar:not(:hover) .cx{display:none}',
            '.box.hot .cap.hasvid .vidoff{display:block}',
            '.box.hot .cap .retry.on{display:block}',
            '.box.hot .cap .teach.on{display:block}',
            '.cap .teach svg{display:block;width:12px;height:12px;margin:3px auto;fill:currentColor}',
            '.cap .teach:hover{background:#89b4fa;border-color:#89b4fa;color:#1e1e2e}',
            '.cap .retry svg{display:block;width:12px;height:12px;margin:3px auto;fill:currentColor}',
            '.cap .retry:hover{background:#f9e2af;border-color:#f9e2af;color:#1e1e2e}',
            '.cap .vidoff svg{display:block;width:13px;height:13px;margin:2px auto;fill:none;',
            'stroke:currentColor;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}',
            '.cap .fs svg{display:block;width:12px;height:12px;margin:3px auto;fill:currentColor}',
            '.cap .fs:hover{background:#a6e3a1;border-color:#a6e3a1;color:#1e1e2e}',
            '.cap .aa{font-size:9px;font-weight:700;letter-spacing:-.06em}',
            // Reverted from the shared 18px: the glyph is taller than the letters and the
            // extra pixel reads as low rather than centred.
            '.cap .block{line-height:16px}',
            '.cap .aa.sharp{background:#89b4fa;border-color:#89b4fa;color:#1e1e2e}',
            '.cap .block:hover{background:#f38ba8;border-color:#f38ba8;color:#1e1e2e}',
            '.cap .vidoff:hover{background:#f9e2af;border-color:#f9e2af;color:#1e1e2e}',
            '.cap .aa:hover{background:#89b4fa;border-color:#89b4fa;color:#1e1e2e}',

            // ---- the zoom cluster: slider, then the readout that opens a field
            // Absolutely placed, like the buttons: a flex item's position depends on how wide the
            // filename and metadata happen to be, and this one must not move.
            // Width written by layoutChrome(), never shrink-to-fit: Firefox sizes an abspos flex
            // box from the range's intrinsic width and parks the surplus after the last item.
            '.cap .zctl{position:absolute;top:50%;transform:translateY(-50%);box-sizing:border-box;',
            'display:flex;align-items:center;justify-content:flex-end;gap:' + BAR_ZOOM_GAP + 'px}',
            '.cap .zctl[hidden]{display:none}',
            '.cap .zslider{flex:none;width:' + BAR_SLIDER_W + 'px;height:14px;',
            'margin:0;padding:0;accent-color:#89b4fa;cursor:pointer}',
            '.cap .zslider[hidden]{display:none}',
            // Left-aligned in a fixed-width slot: the slot is wide enough for "3,200%", so
            // right-aligning it left a hole between the slider and a short reading like "26%".
            // The slack now falls after the readout, where nothing has to reach across it.
            '.cap .zoom{flex:none;position:relative;display:flex;align-items:center;',
            'justify-content:flex-start;width:' + BAR_ZOOM_W + 'px;height:16px}',
            '.cap .zoom[hidden]{display:none}',
            '.cap .zval{cursor:pointer;padding:0 3px;border-radius:3px;white-space:nowrap}',
            '.cap .zval[hidden]{display:none}',
            '.box.hot .cap .zval:hover{background:#313244;color:#cdd6f4}',
            '.cap .zin{width:100%;box-sizing:border-box;padding:0 3px;text-align:right;',
            'font:11px/16px system-ui,sans-serif;color:#cdd6f4;background:#313244;',
            'border:1px solid #89b4fa;border-radius:3px;outline:none}',
            '.cap .zin[hidden]{display:none}',
            // ---- the video strip: floats OVER the picture, so it costs no layout at all —
            // no gutter, no minFrameW(), no reserved height. Shown only over a clip.
            '.vctl{position:absolute;',
            'bottom:' + (BAR_MIN_H + VCTL_GAP) + 'px;height:' + VCTL_H + 'px;display:none;',
            'align-items:center;gap:8px;box-sizing:border-box;padding:0 8px;border-radius:7px;',
            'background:rgba(17,17,27,.55);backdrop-filter:blur(7px) saturate(1.4);',
            '-webkit-backdrop-filter:blur(7px) saturate(1.4);border:1px solid rgba(205,214,244,.12);',
            'font:11px/16px system-ui,sans-serif;color:#cdd6f4;',
            'text-shadow:0 1px 2px rgba(0,0,0,.6)}',
            '.box.hot.tall.hasvid .vctl{display:flex}',
            '.vctl .vgrp{flex:1;min-width:0;display:flex;align-items:center;gap:8px}',
            ...vbtnCss(),
            '.vctl .vtime{flex:none;min-width:62px;font-variant-numeric:tabular-nums;',
            'letter-spacing:.02em;color:#bac2de;white-space:nowrap}',
            '.vctl .vseek{flex:1;min-width:0;height:14px;margin:0;padding:0;',
            'accent-color:#89b4fa;cursor:pointer}',
            '.vctl .vrate{flex:none;padding:0 5px;height:18px;line-height:18px;border-radius:4px;',
            'cursor:pointer;font-variant-numeric:tabular-nums;font-weight:600;color:#bac2de}',
            '.vctl .vrate:hover,.vctl .vrate.open{background:rgba(205,214,244,.18);color:#cdd6f4}',
            '.vctl .vrate.off{color:#f9e2af}',

            // ---- sound: the button is a hover target for the column above it, so the two share
            // a wrapper and the popup keeps the pointer inside it on the way up.
            '.vctl .vsound{flex:none;position:relative;display:flex;align-items:center;',
            'justify-content:center;width:' + VOL_BTN + 'px;height:' + VOL_BTN + 'px}',
            '.vctl .vsound .vbtn{width:100%;height:100%}',
            '.vctl .vsound .vbtn svg{width:17px;height:17px}',
            '.vctl .vsound.muted .vbtn{color:#f38ba8}',
            // Explicit width: an abspos box holding a form control shrink-to-fits differently in Firefox.
            '.vvol{position:absolute;left:50%;bottom:100%;transform:translateX(-50%);display:none;',
            'width:28px;box-sizing:border-box;padding:9px 6px 11px;border-radius:7px;',
            'background:rgba(17,17,27,.92);border:1px solid rgba(205,214,244,.14);',
            'box-shadow:0 6px 18px rgba(0,0,0,.5)}',
            '.vvol.open{display:block}',
            // A vertical range: the rotated-div trick misreports its own hit area, so use the
            // real thing. Both spellings are needed — Firefox reads one, Chromium the other.
            '.vvol input{-webkit-appearance:slider-vertical;appearance:slider-vertical;',
            'writing-mode:vertical-lr;direction:rtl;-moz-orient:vertical;',
            'width:16px;height:' + VOL_TRACK + 'px;margin:0;padding:0;',
            'accent-color:#89b4fa;cursor:pointer}',

            // ---- the speed menu, opening upward out of the strip
            '.spop{position:absolute;bottom:100%;margin-bottom:6px;display:none;z-index:5;',
            'width:' + RATE_POP_W + 'px;box-sizing:border-box;padding:4px;border-radius:7px;background:rgba(17,17,27,.97);',
            'border:1px solid rgba(205,214,244,.16);box-shadow:0 8px 22px rgba(0,0,0,.55);',
            'font:11px/1.4 system-ui,sans-serif;color:#cdd6f4;text-align:left}',
            '.spop.open{display:block}',
            '.spop .opt{padding:4px 8px;border-radius:4px;cursor:pointer;',
            'font-variant-numeric:tabular-nums;white-space:nowrap}',
            '.spop .opt:hover{background:#313244}',
            '.spop .opt.on{background:#89b4fa;color:#1e1e2e;font-weight:700}',
            '.spop .sep{height:1px;margin:4px 2px;background:rgba(205,214,244,.16)}',
            '.spop .custom{display:flex;align-items:center;gap:4px;padding:2px 4px 2px 8px}',
            '.spop .custom input{width:46px;box-sizing:border-box;padding:2px 4px;',
            'font:11px system-ui,sans-serif;color:#cdd6f4;background:#313244;',
            'border:1px solid #45475a;border-radius:4px;outline:none}',
            '.spop .custom input:focus{border-color:#89b4fa}',
            '.spop .custom span{color:#7f849c}',
            '.pop{position:fixed;left:0;top:0;display:none;',
            'z-index:4;width:250px;background:rgba(30,30,46,.98);border:1px solid #45475a;',
            'border-radius:6px;overflow:hidden;box-shadow:0 6px 20px rgba(0,0,0,.55);',
            'font:11px/1.4 system-ui,sans-serif;color:#cdd6f4;text-align:left}',
            '.pop.open{display:block}',
            '.pop .head{padding:8px 10px;color:#bac2de;border-bottom:1px solid #45475a}',
            '.pop .head b{color:#cdd6f4}',
            '.pop .acts{display:flex;gap:6px;justify-content:flex-end;padding:8px}',
            '.pop .acts button{font:11px system-ui,sans-serif;padding:4px 10px;border-radius:5px;',
            'border:1px solid #45475a;background:#313244;color:#cdd6f4;cursor:pointer}',
            '.pop .acts button.go{background:#f38ba8;border-color:#f38ba8;color:#1e1e2e;font-weight:700}',
            '.pop .acts button.ok{background:#89b4fa;border-color:#89b4fa;color:#1e1e2e;font-weight:700}',
            '.pop.teachpop{width:300px}',
            '.pop .field{padding:8px 10px 0}',
            '.pop .field input{display:block;width:100%;box-sizing:border-box;padding:4px 6px;',
            'font:11px system-ui,sans-serif;color:#cdd6f4;background:#313244;',
            'border:1px solid #45475a;border-radius:4px;outline:none}',
            '.pop .field input:focus{border-color:#89b4fa}',
            '.pop .field[hidden]{display:none}',
            '.pop .msg{padding:6px 10px 0;color:#bac2de}',
            '.pop .msg:empty{display:none}',
            '.pop .msg.bad{color:#f38ba8}',
            '.pop .msg.good{color:#a6e3a1}',
            '.pop .acts button[hidden]{display:none}',
            '.pop.bytespop{width:auto;min-width:170px;padding:4px 0}',
            '.pop .item{padding:5px 12px;cursor:pointer;white-space:nowrap}',
            '.pop .item:hover{background:#45475a}',
            // barFadeMs drives BOTH directions: in from 0, and out again after barIdleMs.
            '.cap,.vctl{transition:opacity var(--barfade) ease}',
            '.box.baridle .cap,.box.baridle .vctl{opacity:0;pointer-events:none}',
            // The idle classes still decide whether they show; this only takes the animation off.
            // Equal specificity to the two rules above, so source order is what beats them.
            // Docked: the bar sits BELOW the picture rather than on it, so it must be opaque —
            // a spilling image runs on under it and would otherwise show through.
            '.box.bardock .cap{background:#1e1e2e}',
            '.seamnote{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:50;',
            'pointer-events:none;white-space:nowrap;color:#fff;font:600 22px/1.2 system-ui,sans-serif;',
            'text-shadow:0 0 3px #000,0 1px 8px rgba(0,0,0,.85);opacity:0;transition:opacity .5s ease}',
            '.seamnote.on{opacity:.9;transition:none}',
            '.bigchip{position:fixed;z-index:3;display:none;width:28px;height:28px;box-sizing:border-box;align-items:center;justify-content:center;' +
                'border-radius:8px;background:#1e1e2e;border:1px solid #45475a;cursor:pointer;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,.6)}',
            '.bigchip.on{display:flex}.bigchip:hover{background:#313244}.bigchip svg{width:16px;height:16px;fill:#89b4fa}',
            '.spin{position:fixed;width:' + SPIN_SIZE + 'px;height:' + SPIN_SIZE + 'px;',
            'display:none;pointer-events:none;',
            'filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))}',
            '.spin.on{display:block}',
            '.svmark{position:fixed;width:' + SAVED_MARK + 'px;height:' + SAVED_MARK + 'px;display:none;pointer-events:none}',
            '.svmark.on{display:block}',
            '.svmark svg{display:block}',
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

        seamNoteEl = document.createElement('div');
        seamNoteEl.className = 'seamnote';
        box.appendChild(seamNoteEl);

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
        capHintEl.textContent = '(click to pin)';
        capMetaEl = document.createElement('span');
        capMetaEl.className = 'meta';
        blockEl = document.createElement('span');
        blockEl.className = 'btn block';
        setTip(blockEl, 'Never preview this image');
        blockEl.textContent = '⊘';
        blockEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        blockEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); togglePop(blockPopEl); }, true);

        vidOffEl = document.createElement('span');
        vidOffEl.className = 'btn vidoff';
        setTip(vidOffEl, 'No clips in this tab');
        vidOffEl.appendChild(mkIcon(ICON_NOPLAY));
        vidOffEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        vidOffEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); stopVideoPreviews(); }, true);

        aaEl = document.createElement('span');
        aaEl.className = 'btn aa';
        aaEl.textContent = 'AA';
        aaEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        aaEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleSmoothing(); }, true);

        retryEl = document.createElement('span');
        retryEl.className = 'btn retry';
        retryEl.appendChild(mkIcon(ICON_RETRY));
        setTip(retryEl, 'Retry');
        retryEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        retryEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); tourShow(); }, true);

        teachEl = document.createElement('span');
        teachEl.className = 'btn teach';
        teachEl.appendChild(mkIcon(ICON_FIND));
        setTip(teachEl, 'Show Hover Zoom where the full-size picture is');
        teachEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        teachEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openTeach(); }, true);

        fsEl = document.createElement('span');
        fsEl.className = 'btn fs';
        fsEl.appendChild(mkIcon(ICON_FULL));
        setTip(fsEl, 'Fullscreen');
        fsEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        fsEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleFull(); }, true);

        xEl = document.createElement('span');
        xEl.className = 'btn xb';
        xEl.appendChild(mkIcon(ICON_CLOSE));
        setTip(xEl, 'Close');
        xEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        xEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeByButton(); }, true);

        cornerXEl = document.createElement('span');
        cornerXEl.className = 'cx';
        cornerXEl.appendChild(mkIcon(['M12 1.8a10.2 10.2 0 1 1 0 20.4a10.2 10.2 0 1 1 0-20.4z', 'M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6']));
        setTip(cornerXEl, 'Close');
        cornerXEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        cornerXEl.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeByButton(); }, true);
        box.appendChild(cornerXEl);

        buildZoomControl();
        buildVideoControls();

        capEl.appendChild(capNameEl);
        capEl.appendChild(capHintEl);
        capEl.appendChild(capMetaEl);
        capEl.appendChild(zctlEl);
        capEl.appendChild(blockEl);
        capEl.appendChild(vidOffEl);
        capEl.appendChild(retryEl);
        capEl.appendChild(teachEl);
        capEl.appendChild(aaEl);
        capEl.appendChild(fsEl);
        capEl.appendChild(xEl);

        blockPopEl = buildPop();
        popHead(blockPopEl, 'Never preview this image again.',
            ' It goes on the Exceptions list in settings, where it can be removed. The page is ' +
            'not changed.');
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

        box.appendChild(imgEl);
        box.appendChild(vidEl);
        coverEl = document.createElement('canvas');
        coverEl.className = 'cover';
        coverEl.hidden = true;
        box.appendChild(coverEl);
        box.appendChild(vctlEl);
        box.appendChild(capEl);
        box.addEventListener('mousedown', onBoxDown, true);
        box.addEventListener('click', onBoxClick, true);
        root.appendChild(box);
        root.appendChild(blockPopEl);       // outside the box, whose overflow would clip it
        teachPopEl = buildTeachPop();
        root.appendChild(teachPopEl);
        bytesPopEl = buildBytesPop();
        root.appendChild(bytesPopEl);

        document.addEventListener('fullscreenchange', onFullChange);
        document.addEventListener('webkitfullscreenchange', onFullChange);

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
        savedMarkEl = galSavedIcon('svmark');
        root.appendChild(savedMarkEl);

        // Max z-index everywhere, so DOM order decides: stay under the panel and every docked widget.
        const parent = document.body || document.documentElement;
        const under = Array.prototype.find.call(parent.children, function (c) {
            return c === panelHost || c.hasAttribute('data-us-dock');
        });
        parent.insertBefore(host, under || null);
        // The tour widget floats over the preview, so it has to come after it.
        if (tw && tw.host.parentNode === parent) parent.appendChild(tw.host);
    }

    // ----------------------------------------------------------------- geometry

    const EDGE_GAP = 4;

    // The browser paints the link target it is about to follow over the bottom-left of the
    // viewport, and our status bar is the first thing it covers.
    const STATUS_TIP_H = 20;

    function bottomGap() { return Math.max(EDGE_GAP + STATUS_TIP_H, widgetFloor()); }

    const TW_FLOOR_BAND = 16;   // px: a widget whose bottom is this close to the window's is docked at the bottom

    function twShownRect() { return tw && tw.rect && tw.host.style.display !== 'none' ? tw.rect : null; }

    // Room the ◀ ▶ widget takes off the bottom of the window when it is docked there. See VIEWER.md.
    function widgetFloor() {
        const r = twShownRect(), vh = vpH();
        if (!r || !vh || r.y + r.h < vh - TW_FLOOR_BAND) return 0;
        return Math.max(0, vh - r.y + EDGE_GAP);
    }

    // A status bar landing on the widget moves the window up or down, whichever is less.
    function clearWidget() {
        const r = twShownRect(), vh = vpH();
        if (!r || !vh || drag || !barShown() || fullActive()) return;
        const ow = outerW(), oh = outerH(), barH = BAR_MIN_H + insetY();
        const barTop = view.top + oh - barH;
        if (r.x >= view.left + ow || r.x + r.w <= view.left || r.y >= view.top + oh || r.y + r.h <= barTop) return;
        const up = r.y - EDGE_GAP - oh, down = r.y + r.h + EDGE_GAP - (oh - barH);
        const fits = function (t) { return t >= EDGE_GAP && t + oh <= vh - bottomGap(); };     // never into the bottom strip
        const best = [up, down].filter(fits).sort(function (a, b) {
            return Math.abs(a - view.top) - Math.abs(b - view.top);
        })[0];
        if (best != null) { view.top = best; return; }
        // Neither fits: shrink from the bottom until the window ends above the widget.
        const capH = Math.max(MIN_FRAME, r.y - EDGE_GAP * 2 - insetY() * 2 - barDock());
        if (capH >= view.frameH) return;
        view.capH = capH;
        if (view.fixedH != null) view.fixedH = capH;
        else if (Math.abs(view.scale - view.fitScale) < 1e-6) {
            view.fitScale = view.scale = Math.max(minScaleFor(view.natW, view.natH), view.scale * capH / view.frameH);
        }
        reflow();
        view.top = EDGE_GAP;
    }

    const MIN_FRAME = 48;
    // Only a PLACED window carries controls, so only a placed one owes them room.
    function minFrameW() {
        return placed && barShown() ? barMinW() : MIN_FRAME;
    }

    // The status bar answers 'always' | 'hover' | 'off' for itself.
    function barShown() { return cfg.barMode !== 'off'; }
    function barFades() { return cfg.barMode === 'hover'; }

    // Height the bar claims BELOW the picture instead of over it. Only 'always' docks: a bar that
    // fades cannot own layout, or the picture would resize itself every time the bar came and went.
    function barDock() {
        return barShown() && cfg.barMode === 'always' ? BAR_MIN_H : 0;
    }

    // The border the window is wearing right now — the setting, except in fullscreen where there
    // is no window edge to draw. Everything geometric reads this, never cfg.borderWidth. See E43.
    function borderPx() { return fullActive() ? 0 : cfg.borderWidth; }

    // What sits between view.left/top and the picture's own top-left, and the window's outer size.
    function insetX() { return borderPx(); }
    function insetY() { return borderPx(); }
    function outerW() { return view.frameW + insetX() * 2; }
    function outerH() { return view.frameH + insetY() * 2 + barDock(); }

    // The element whose clientWidth/clientHeight IS the viewport — <body> on a quirks-mode page.
    function vpEl() {
        return (document.compatMode === 'BackCompat' && document.body) || document.documentElement;
    }
    // Real fullscreen measures the SCREEN, not the layout viewport. See E42.
    function fullScreenAPI() { return fullActive() && !!document.fullscreenElement; }
    function vpW() { return fullScreenAPI() ? window.innerWidth : vpEl().clientWidth; }
    function vpH() { return fullScreenAPI() ? window.innerHeight : vpEl().clientHeight; }

    function usableHeight() {
        // The floor is because the Browser pane reports clientHeight 0 while it is hidden.
        return Math.max(64, vpH());
    }

    // The box a preview OPENS into.
    function viewportBox() {
        const vw = vpW();
        const vh = usableHeight();
        return {
            vw: vw,
            vh: vh,
            w: Math.max(MIN_FRAME, vw - EDGE_GAP * 2 - insetX() * 2),
            h: Math.max(MIN_FRAME, vh - EDGE_GAP - bottomGap() - insetY() * 2 - barDock()),
        };
    }

    // ---- tooltips: drawn here, because a native `title`'s delay belongs to the browser

    const TIP_DELAY_MS = 300;   // every control waits this, except a help tip given its own delay

    let tipEl = null, tipTimer = 0, tipFor = null;

    function hideTip() {
        clearTimeout(tipTimer);
        tipTimer = 0;
        tipFor = null;
        if (!tipEl) return;
        try { if (tipEl.matches(':popover-open')) tipEl.hidePopover(); } catch (e) { /* no popover API */ }
        if (tipEl.parentNode) tipEl.parentNode.removeChild(tipEl);
    }

    // Its own host in the browser's top layer, so no widget, preview or fullscreen can cover it.
    function tipBox() {
        if (tipEl) return tipEl;
        tipEl = document.createElement('div');
        tipEl.setAttribute('popover', 'manual');
        const t = document.createElement('div');
        t.style.cssText = 'max-width:320px;padding:3px 6px;border-radius:4px;background:#1e1e2e;color:#cdd6f4;' +
            'border:1px solid #45475a;font:11px/1.45 system-ui,sans-serif;white-space:pre-wrap;' +
            'overflow-wrap:anywhere;box-shadow:0 2px 8px rgba(0,0,0,.45)';
        tipEl.attachShadow({ mode: 'open' }).appendChild(t);
        tipEl.__text = t;
        return tipEl;
    }

    // Above the control, below only when there is no room.
    function showTip(el) {
        const text = el.__tip;
        if (!text) return;
        const h = tipBox();
        h.__text.textContent = text;
        h.style.cssText = 'all:initial;display:block;position:fixed;left:0;top:0;width:max-content;max-width:320px;margin:0;padding:0;border:0;' +
            'background:none;overflow:visible;z-index:2147483647;pointer-events:none';
        document.documentElement.appendChild(h);
        try { h.showPopover(); } catch (e) { /* no popover API: z-index and DOM order */ }
        const r = el.getBoundingClientRect(), b = h.getBoundingClientRect();
        let x = r.left, y = r.top - 6 - b.height;
        if (x + b.width > vpW() - 4) x = vpW() - 4 - b.width;
        if (y < 4) y = r.bottom + 6;
        h.style.left = Math.max(4, Math.round(x)) + 'px';
        h.style.top = Math.max(4, Math.round(y)) + 'px';
    }

    // Replaces `el.title = text` everywhere; the attribute is removed or both would show.
    function setTip(el, text, delay) {
        if (!el) return;
        el.__tip = text || '';
        if (delay) el.__tipDelay = delay;
        if (el.hasAttribute && el.hasAttribute('title')) el.removeAttribute('title');
        if (el.__tipBound) return;
        el.__tipBound = true;
        el.addEventListener('mouseenter', function () {
            clearTimeout(tipTimer);
            tipFor = el;
            tipTimer = setTimeout(function () { if (tipFor === el) showTip(el); }, el.__tipDelay || TIP_DELAY_MS);
        });
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('mousedown', hideTip, true);
    }

    // A still pointer sends no mouseleave, so a wheel or a key is what ends a tip under it.
    window.addEventListener('wheel', function () { if (tipFor || (tipEl && tipEl.parentNode)) hideTip(); }, { capture: true, passive: true });
    window.addEventListener('keydown', function () { if (tipFor || (tipEl && tipEl.parentNode)) hideTip(); }, true);

    const MAX_MULTIPLE_ABS = 4;

    // How far the frame may grow. Deliberately bigger than the window — see the setting.
    // A tour is the exception: it is a lightbox, centred and capped at the viewport. See TOUR.md.
    function growBox() {
        const m = tourActive() ? 1 : Math.max(1, Math.min(cfg.maxSizeMultiple || 1, MAX_MULTIPLE_ABS));
        const b = viewportBox();
        return { vw: b.vw, vh: b.vh, w: b.w * m, h: b.h * m };
    }

    function pannable() {
        return !!view && (view.imgW > view.frameW + 0.5 || view.imgH > view.frameH + 0.5);
    }

    // The zoom floor, and what `0` returns to.
    function fitScaleFor(w, h) {
        if (!w || !h) return 1;
        if (view && view.fixedW != null) return Math.min(maxScale(), view.fixedW / w, view.fixedH / h);
        const m = viewportBox();
        const mh = view && view.capH ? Math.min(m.h, view.capH) : m.h;
        return Math.min(fromShown(cfg.zoomLimit), maxScale(), m.w / w, mh / h);
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
        if (view.capH) g.h = Math.min(g.h, view.capH);
        view.imgW = view.natW * view.scale;
        view.imgH = view.natH * view.scale;
        const mw = Math.min(minFrameW(), g.w);
        const mh = Math.min(MIN_FRAME, g.h);
        view.frameW = Math.round(view.fixedW != null ? view.fixedW
            : Math.max(mw, Math.min(view.imgW, g.w)));
        view.frameH = Math.round(Math.max(mh, view.fixedH != null ? view.fixedH
            : Math.min(view.imgH, g.h)));
        view.ox = view.imgW <= view.frameW
            ? (view.frameW - view.imgW) / 2
            : Math.min(0, Math.max(view.frameW - view.imgW, view.ox));
        view.oy = view.imgH <= view.frameH
            ? (view.frameH - view.imgH) / 2
            : Math.min(0, Math.max(view.frameH - view.imgH, view.oy));
    }

    const REACH_INSET = 10;

    // A small picture's preview never covers it: beside it on the roomier side, else above or below.
    function besidePicture(ow, oh, m) {
        const r = activeRect;
        if (!r) return;
        const GAP = 8;
        const overlaps = view.left < r.right && view.left + ow > r.left && view.top < r.bottom && view.top + oh > r.top;
        if (!overlaps) return;
        const right = m.vw - r.right - GAP, left = r.left - GAP;
        if (Math.max(right, left) >= ow) {
            view.left = right >= ow ? r.right + GAP : r.left - GAP - ow;
            view.top = Math.max(0, Math.min(m.vh - oh, r.top + r.height / 2 - oh / 2));
        } else {
            view.left = Math.max(0, Math.min(m.vw - ow, r.left + r.width / 2 - ow / 2));
            view.top = m.vh - r.bottom - GAP >= r.top - GAP ? r.bottom + GAP : r.top - GAP - oh;
        }
    }

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
        const vw = vpW();
        const vh = vpH();
        if (!vw || !vh) return;      // the Browser pane reports 0 while hidden
        const ow = outerW();
        const oh = outerH();
        if (!placed) {
            const bh = usableHeight();
            const loX = vw - ow - EDGE_GAP, hiX = EDGE_GAP;
            const loY = bh - oh - bottomGap(), hiY = EDGE_GAP;
            view.left = loX >= hiX ? Math.max(hiX, Math.min(view.left, loX))
                                   : Math.max(loX, Math.min(view.left, hiX));
            view.top = loY >= hiY ? Math.max(hiY, Math.min(view.top, loY))
                                  : Math.max(loY, Math.min(view.top, hiY));
            clearWidget();
            return;
        }
        const keep = Math.min(KEEP_ON_SCREEN, ow, oh);
        view.left = Math.max(keep - ow, Math.min(view.left, vw - keep));
        view.top = Math.max(keep - oh, Math.min(view.top, vh - keep));
        clearWidget();
    }

    const RESIZE_OUT = 6;     // px outside the window edge that still resizes
    const RESIZE_IN = 6;      // px inside it — together, a 12px strip centred on the edge
    const CX_INSET = 10;      // the corner ✕: this far in from the top and right edges
    const CX_SIZE = 26;
    const CORNER_REACH = 24;  // px from a corner where a drag resizes both axes at once

    function hitRegion(x, y) {
        if (!view) return null;
        if (fullActive()) return null;      // locked to the screen: no move band, no resize edge
        const ow = outerW();
        const oh = outerH();
        const rx = x - view.left, ry = y - view.top;
        if (rx < -RESIZE_OUT || ry < -RESIZE_OUT ||
            rx > ow + RESIZE_OUT || ry > oh + RESIZE_OUT) return null;
        const dl = rx, dr = ow - rx, dt = ry, db = oh - ry;
        const cxIn = CX_INSET + borderPx();
        if (placed && dr >= cxIn && dr <= cxIn + CX_SIZE && dt >= cxIn && dt <= cxIn + CX_SIZE)
            return null;    // the corner ✕

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
        return null;    // the middle — the pan-or-move rule decides
    }

    function regionCursor(reg) {
        if (!reg) return '';        // the middle: leave it to the .pan / .placed CSS rules
        if (!reg.ey) return 'ew-resize';
        if (!reg.ex) return 'ns-resize';
        return (reg.ex === 'l') === (reg.ey === 't') ? 'nwse-resize' : 'nesw-resize';
    }

    // What a press at this spot would actually start — the same rule onBoxDown applies, so the
    // cursor can never promise a drag the press does not perform.
    function pressMode(reg) {
        if (!placed || !view) return '';
        if (reg && reg.kind === 'resize') return 'resize';
        if (fullActive()) return pannable() ? 'pan' : '';
        // The status bar is the only move handle left: the grab border went in v0.71.0.
        return (barVisible() && pointerOverCap()) || !pannable() ? 'move' : 'pan';
    }

    // The one writer of the box cursor. Panning gets the hand in every state that pans.
    function applyCursor() {
        if (!box || !placed) return;
        let c;
        if (drag) {
            c = drag.mode === 'pan' ? 'grabbing'
                : drag.mode === 'move' ? 'move'
                : regionCursor({ kind: 'resize', ex: drag.ex, ey: drag.ey });
        } else {
            const reg = hitRegion(pointer.x, pointer.y);
            const m = pressMode(reg);
            // A control is never a handle: onBoxDown returns early on isBoxControl().
            c = pointerOverControl(pointer.x, pointer.y) ? 'default'
                : m === 'resize' ? regionCursor(reg)
                : m === 'pan' ? 'grab'
                : m === 'move' ? 'move' : 'default';
        }
        box.style.cursor = c;
        if (gripEl) gripEl.style.cursor = c;
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
        // 83% of cross-origin images report 0 — no Timing-Allow-Origin. Where the picture was slow
        // enough to earn a diagnosis, Content-Range already said the true size, for free.
        const d = diagValue.get(url);
        return (d && d.total) || 0;
    }

    function humanBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
        return (n / (1024 * 1024)).toFixed(1) + ' MB';
    }

    let capFor = '', capDims = '';

    function resetCaption() { capFor = ''; }

    // Everything but the zoom changes only with the URL or the measured size, and layout() calls
    // this on every frame of a drag — fileInfo() and transferBytes() are not frame work.
    function caption() {
        box.classList.toggle('nobar', !barShown());
        if (!barShown()) {
            capEl.style.display = 'none';
            return;
        }
        capEl.style.display = '';

        const dims = view.natW + ' × ' + view.natH;
        if (capFor !== view.url || capDims !== dims) {
            capFor = view.url;
            capDims = dims;
            const info = fileInfo(view.url);
            capNameEl.textContent = info.name;
            setTip(capNameEl, view.url);
            const parts = [];
            if (info.type) parts.push(info.type);
            parts.push(dims);
            const bytes = transferBytes(view.url);
            if (bytes) parts.push(humanBytes(bytes));
            if (view.reason) parts.push(view.reason);
            capMetaEl.textContent = parts.join('  ·  ');
        }
        syncZoom();
    }

    // ------------------------------------------------------- the zoom control

    const ZOOM_LO_CAP = 0.25;   // the low end asked for, when the picture's own fit is above it

    // ---- what the percentage counts. `view.scale` is CSS px per media px, and a CSS pixel is not
    // a fixed size — browser zoom at 130% paints it 1.3 screen px wide, so the number moved when
    // the picture did not. devicePixelRatio is displayScale × browserZoom and the two are not
    // separable, so the display half is asked for and divided out. See docs/ZOOM-UNITS.md.
    function zoomUnit() {
        const s = cfg.displayScale > 0 ? cfg.displayScale : 1;
        return (window.devicePixelRatio || 1) / s;
    }

    function toShown(scale) { return scale * zoomUnit(); }
    function fromShown(pct) { return pct / zoomUnit(); }

    // Percent bands and the step wanted inside each; every step divides its band's own ends, and
    // so does its neighbour in ZOOM_NICE, because fitStops() may coarsen a band by one notch.
    const ZOOM_BANDS = [[10, 1], [30, 2], [200, 5], [500, 25],
                        [1000, 50], [2000, 100], [5000, 200], [Infinity, 500]];
    const ZOOM_NICE = [0.5, 1, 2, 5, 10, 25, 50, 100, 200, 500, 1000, 2500, 5000];

    // A stop the thumb cannot land on may as well not exist, so the ladder is capped at the
    // track's own pixel count. The thumb's width is the UA's, hence the pessimistic reserve.
    const ZOOM_THUMB = 20;

    // The scale below which reflow() stops shrinking the frame and letterboxes the picture instead.
    function noBarsScale() {
        const g = growBox();
        return Math.max(view.natW ? Math.min(minFrameW(), g.w) / view.natW : 0,
                        view.natH ? MIN_FRAME / view.natH : 0);
    }

    // The slider spans fit-or-25% up to the ceiling, but never down into the letterbox.
    function zoomLo() {
        if (!view) return fromShown(ZOOM_LO_CAP);
        return Math.max(0.01, Math.min(view.fitScale,
            Math.max(fromShown(ZOOM_LO_CAP), noBarsScale())));
    }

    function zoomHi() {
        return Math.max(zoomLo() * 1.01, maxScale());
    }

    // lo, every round value above it, then hi — with each band's stop count and the log distance
    // it covered, which together are the only thing fitStops() needs to choose what to thin.
    function walkStops(lo, hi, bands) {
        const zero = function () { return 0; };
        const stops = [lo], counts = bands.map(zero), spans = bands.map(zero), end = hi * 100;
        let pct = lo * 100;
        for (let guard = 0; guard < 4000; guard++) {
            let k = 0;
            while (k < bands.length - 1 && pct + 1e-9 >= bands[k][0]) k++;
            const step = bands[k][1];
            const next = Math.floor(pct / step + 1e-9) * step + step;
            if (next >= end - 1e-9) break;
            stops.push(next / 100);
            counts[k]++;
            spans[k] += Math.log(next / pct);
            pct = next;
        }
        stops.push(hi);
        return { stops: stops, counts: counts, spans: spans };
    }

    function coarser(step) {
        for (let i = 0; i < ZOOM_NICE.length; i++) if (ZOOM_NICE[i] > step + 1e-9) return ZOOM_NICE[i];
        return step * 2;
    }

    // Too many stops for the track: thin the DENSEST band — most stops per unit of log distance,
    // which is per unit of track — until they fit. Thinning the longest band instead spends the
    // cut on the range being used rather than on the over-resolved top end.
    function fitStops(lo, hi, budget) {
        const bands = ZOOM_BANDS.map(function (b) { return [b[0], b[1]]; });
        let r = walkStops(lo, hi, bands);
        for (let guard = 0; guard < 40 && r.stops.length - 1 > budget; guard++) {
            let k = -1, best = 0;
            for (let i = 0; i < r.counts.length; i++) {
                const d = r.spans[i] > 1e-9 ? r.counts[i] / r.spans[i] : 0;
                if (d > best) { best = d; k = i; }
            }
            if (k < 0) break;
            bands[k][1] = coarser(bands[k][1]);
            r = walkStops(lo, hi, bands);
        }
        return r.stops;
    }

    let stopsKey = '', stopsArr = null;

    // The ladder must be round in what is READ, not in `scale`, so it is built in shown terms
    // and converted back. zoomUnit() is in the key: browser zoom moves it without moving lo or
    // hi, and a stale ladder lands the thumb on non-round readings.
    function zoomStops() {
        const lo = zoomLo(), hi = zoomHi(), key = lo + '/' + hi + '/' + zoomUnit();
        if (key !== stopsKey) {
            stopsKey = key;
            stopsArr = fitStops(toShown(lo), toShown(hi),
                Math.max(8, BAR_SLIDER_W - ZOOM_THUMB)).map(fromShown);
        }
        return stopsArr;
    }

    // Which stop a scale sits on — nearest by ratio, so a wheeled or typed level parks sensibly.
    function zoomIndex(scale) {
        const stops = zoomStops(), last = stops.length - 1;
        if (!(scale > stops[0])) return 0;
        if (scale >= stops[last]) return last;
        let i = 0;
        while (i < last && stops[i + 1] <= scale) i++;
        if (i < last && Math.log(stops[i + 1] / scale) < Math.log(scale / stops[i])) i++;
        return i;
    }

    function fmtZoom(scale) {
        const pct = toShown(scale) * 100;
        const s = pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
        return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '%';
    }

    // Anything goes in: "200", "200%", "1,000%". Out of range is clamped, not rejected.
    function parseZoom(text) {
        const n = parseFloat(String(text).replace(/[,\s%]/g, ''));
        return isFinite(n) && n > 0 ? fromShown(n / 100) : NaN;
    }

    let zoomDrag = false;

    // The bar must not fade out from under a slider drag or an open field.
    function zoomBusy() {
        return zoomDrag || !!(zinEl && !zinEl.hidden);
    }

    const SLIDE_MIN_MS = 16;

    let slideWant = null, slideTimer = 0, slideFree = 0, slideCost = 0;

    // A slider emits an `input` per pixel of travel, and each one repaints the picture at a new
    // size. Smoothed DOWNscaling of a large image costs tens of ms a frame, so the events arrive
    // faster than they can be served and the drag falls behind the pointer. The clock starts when
    // the last zoom FINISHED, and the wait is the last one's own cost: an expensive picture asks
    // for fewer redraws by itself, and a cheap one is never throttled below 60/s.
    function slideZoom(scale) {
        slideWant = scale;
        const wait = Math.max(SLIDE_MIN_MS, slideCost) - (Date.now() - slideFree);
        if (wait <= 0) { flushSlide(); return; }
        if (!slideTimer) slideTimer = setTimeout(flushSlide, wait);
    }

    function flushSlide() {
        clearTimeout(slideTimer);
        slideTimer = 0;
        if (slideWant == null || !view) { slideWant = null; return; }
        const scale = slideWant;
        slideWant = null;
        const t0 = Date.now();
        zoomAnchored(scale);
        slideFree = Date.now();
        slideCost = slideFree - t0;
    }

    function buildZoomControl() {
        zctlEl = document.createElement('div');
        zctlEl.className = 'zctl';

        zsliderEl = document.createElement('input');
        zsliderEl.className = 'zslider';
        zsliderEl.type = 'range';
        zsliderEl.min = '0';
        zsliderEl.max = '1';        // the real end is the stop count, written by syncZoom()
        zsliderEl.step = '1';
        setTip(zsliderEl, 'Drag to zoom');
        zsliderEl.addEventListener('mousedown', function (e) {
            e.stopPropagation();
            zoomDrag = true;
            showBar();
        }, true);
        zsliderEl.addEventListener('input', function () {
            if (!view) return;
            zoomDrag = true;
            const stops = zoomStops();
            slideZoom(stops[Math.max(0, Math.min(stops.length - 1, Number(zsliderEl.value)))]);
        });
        zsliderEl.addEventListener('change', function () {
            flushSlide();
            zoomDrag = false;
            syncZoom();
            showBar();
        });

        zoomWrapEl = document.createElement('span');
        zoomWrapEl.className = 'zoom';
        zvalEl = document.createElement('span');
        zvalEl.className = 'zval';
        setTip(zvalEl, 'Type a level');
        zinEl = document.createElement('input');
        zinEl.className = 'zin';
        zinEl.type = 'text';
        zinEl.spellcheck = false;
        zinEl.hidden = true;
        zvalEl.addEventListener('mousedown', function (e) {
            e.preventDefault(); e.stopPropagation();
        }, true);
        zvalEl.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation(); openZoomField();
        }, true);
        zinEl.addEventListener('mousedown', function (e) { e.stopPropagation(); }, true);
        zinEl.addEventListener('blur', function () { closeZoomField(true); });
        zoomWrapEl.appendChild(zvalEl);
        zoomWrapEl.appendChild(zinEl);

        zctlEl.appendChild(zsliderEl);
        zctlEl.appendChild(zoomWrapEl);
    }

    function syncZoom() {
        if (!zctlEl || !view) return;
        const showVal = placed || Math.abs(view.scale - view.fitScale) > 1e-6;
        zsliderEl.hidden = !placed;
        zoomWrapEl.hidden = !showVal;
        zctlEl.hidden = !placed && !showVal;
        zvalEl.textContent = fmtZoom(view.scale);
        zsliderEl.max = String(zoomStops().length - 1);   // before the value, or the value clamps
        if (!zoomDrag) zsliderEl.value = String(zoomIndex(view.scale));
    }

    function openZoomField() {
        if (!view || !zinEl || !zinEl.hidden) return;
        zinEl.value = String(Math.round(toShown(view.scale) * 100));
        zvalEl.hidden = true;
        zinEl.hidden = false;
        showBar();
        zinEl.focus();
        zinEl.select();
    }

    // The window swallows presses (onBoxDown preventDefaults), so `blur` never fires on its own:
    // a press outside the readout, or the pointer leaving, is what commits. See the panel's `change`.
    function commitZoomField(e) {
        if (!zinEl || zinEl.hidden) return;
        if (e && zoomWrapEl && zoomWrapEl.contains(e.target)) return;
        closeZoomField(true);
    }

    function closeZoomField(apply) {
        if (!zinEl || zinEl.hidden) return;
        const text = zinEl.value;
        zinEl.hidden = true;
        zvalEl.hidden = false;
        if (apply && view) {
            const s = parseZoom(text);
            if (!isNaN(s)) zoomAnchored(s);     // clamped in there; the readout shows what stuck
        }
        syncZoom();
        showBar();
    }

    function resetZoomControl() {
        clearTimeout(slideTimer);
        slideTimer = 0;
        slideWant = null;
        slideCost = 0;
        zoomDrag = false;
        resetCaption();
        if (!zinEl) return;
        zinEl.hidden = true;
        if (zvalEl) zvalEl.hidden = false;
    }

    // ------------------------------------------------- the floating video strip

    const RATES = [0.1, 0.25, 0.5, 1, 1.25, 1.5, 2, 3];
    // The BROWSER's range, not a choice of ours: Chromium throws NotSupportedError outside
    // [0.0625, 16] and Firefox silently ignores it, so a typed value is clamped and the readout
    // shows what actually stuck rather than what was asked for.
    const RATE_MIN = 0.0625, RATE_MAX = 16;
    const RATE_POP_W = 96;                      // matches .spop's min-width

    // The round-cornered strip buttons, shared by the preview's shadow root and the widget's.
    function vbtnCss() {
        return [
            '.vbtn{flex:none;display:flex;align-items:center;justify-content:center;',
            'width:' + VBTN_W + 'px;height:' + VBTN_W + 'px;border-radius:4px;cursor:pointer;color:#cdd6f4}',
            '.vbtn svg{display:block;width:14px;height:14px;fill:currentColor}',
            '.vbtn:hover{background:rgba(205,214,244,.18)}',
            // `faint`, not `dim`: .dim is the page overlay, position:fixed, and a button wearing it leaves the row
            '.vbtn.faint{opacity:.3;cursor:default}',
            '.vbtn.faint:hover{background:none}',
        ];
    }

    function mkVBtn(icon, tip, onClick) {
        const b = document.createElement('span');
        b.className = 'vbtn';
        b.appendChild(mkIcon(icon));
        if (tip) setTip(b, tip);
        b.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        b.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation(); onClick(); showBar();
        }, true);
        return b;
    }

    // Play/pause, elapsed time, scrubber, speed and sound — over the picture, not in the bar.
    function buildVideoControls() {
        vctlEl = document.createElement('div');
        vctlEl.className = 'vctl';

        vplayEl = mkVBtn(ICON_PAUSE, 'Play / pause', togglePlay);

        vtimeEl = document.createElement('span');
        vtimeEl.className = 'vtime';
        vtimeEl.textContent = '0:00 / 0:00';

        vseekEl = document.createElement('input');
        vseekEl.className = 'vseek';
        vseekEl.type = 'range';
        vseekEl.min = '0';
        vseekEl.max = '1000';
        vseekEl.step = '1';
        vseekEl.value = '0';
        setTip(vseekEl, 'Drag to scrub');
        vseekEl.addEventListener('mousedown', function (e) {
            e.stopPropagation(); seekDrag = true; showBar();
        }, true);
        vseekEl.addEventListener('input', function () {
            const d = clipSecs();
            if (!d) return;
            seekDrag = true;
            vidEl.currentTime = d * (Number(vseekEl.value) / 1000);
            syncVideoTime();
        });
        vseekEl.addEventListener('change', function () { seekDrag = false; showBar(); });

        vrateEl = document.createElement('span');
        vrateEl.className = 'vrate';
        vrateEl.textContent = '100%';
        setTip(vrateEl, 'Speed');
        vrateEl.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
        vrateEl.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation(); toggleRateMenu(); showBar();
        }, true);
        buildRateMenu();

        // The button and its column share a wrapper, so the pointer never leaves the hover
        // target on its way from one to the other.
        vsoundEl = document.createElement('span');
        vsoundEl.className = 'vsound';
        vmuteEl = mkVBtn(ICON_MUTE, 'Sound on / off', toggleMute);
        vvolEl = document.createElement('div');
        vvolEl.className = 'vvol';
        vvolInEl = document.createElement('input');
        vvolInEl.type = 'range';
        vvolInEl.min = '0';
        vvolInEl.max = '100';
        vvolInEl.step = '1';
        setTip(vvolInEl, 'Volume');
        vvolInEl.addEventListener('mousedown', function (e) {
            e.stopPropagation(); volDrag = true; showBar();
        }, true);
        vvolInEl.addEventListener('input', function () {
            const v = Number(vvolInEl.value) / 100;
            if (mediaEl !== vidEl) return;
            const wasPlaying = !vidEl.paused;
            volDrag = true;
            vidEl.volume = v;
            // Touching the column is a request for sound; zero is the way to ask for silence.
            vidEl.muted = v <= 0;
            applyAudioWish(wasPlaying);
        });
        vvolInEl.addEventListener('change', function () {
            volDrag = false;
            rememberAudio();
            showBar();
        });
        vvolEl.appendChild(vvolInEl);
        vsoundEl.appendChild(vmuteEl);
        vsoundEl.appendChild(vvolEl);
        // Hover-driven, with a close DELAY, on the wrapper only. mouseover/mouseout, not
        // enter/leave: the popup is a DOM child, so crossing back from it to the button fires
        // no enter on the wrapper and the pending close was never cancelled.
        vsoundEl.addEventListener('mouseover', openVol);
        vsoundEl.addEventListener('mouseout', laterCloseVol);

        vgrpEl = document.createElement('div');
        vgrpEl.className = 'vgrp';
        vgrpEl.appendChild(vplayEl);
        vgrpEl.appendChild(vtimeEl);
        vgrpEl.appendChild(vseekEl);
        vgrpEl.appendChild(vrateEl);
        vgrpEl.appendChild(vsoundEl);

        vctlEl.appendChild(vgrpEl);
        // A child of the strip, not of either group: `.spop` positions against the strip, and
        // toggleRateMenu() measures vrateEl.offsetLeft in the same box.
        vctlEl.appendChild(ratePopEl);

        vidEl.addEventListener('timeupdate', syncVideoTime);
        vidEl.addEventListener('durationchange', syncVideoTime);
        vidEl.addEventListener('play', syncVideoCtl);
        vidEl.addEventListener('pause', syncVideoCtl);
        vidEl.addEventListener('volumechange', syncVideoCtl);
    }

    let volTimer = 0;

    // Hovering the button with no button held is a fresh start: nothing can legitimately be
    // holding the column open at that moment, so a stuck `volDrag` cannot outlive the next hover.
    function openVol(e) {
        if (!e || e.buttons === 0) volDrag = false;
        clearTimeout(volTimer);
        volTimer = 0;
        if (vvolEl && mediaEl === vidEl) vvolEl.classList.add('open');
    }

    // A drag that wanders off the box still holds it: the button is released somewhere, and
    // that somewhere is often not over the column.
    function laterCloseVol() {
        clearTimeout(volTimer);
        volTimer = setTimeout(function () {
            volTimer = 0;
            if (volDrag) { laterCloseVol(); return; }
            closeVol();
        }, VOL_CLOSE_MS);
    }

    function closeVol() {
        clearTimeout(volTimer);
        volTimer = 0;
        if (vvolEl) vvolEl.classList.remove('open');
    }

    function fmtTime(s) {
        if (!isFinite(s) || s < 0) s = 0;
        const m = Math.floor(s / 60);
        const r = Math.floor(s % 60);
        return m + ':' + (r < 10 ? '0' : '') + r;
    }

    // Not secsOf(), which formats a string for the gate's debug line.
    function clipSecs() {
        const d = vidEl ? vidEl.duration : 0;
        return isFinite(d) && d > 0 ? d : 0;
    }

    function syncVideoTime() {
        if (!vtimeEl || mediaEl !== vidEl) return;
        const d = clipSecs();
        const t = isFinite(vidEl.currentTime) ? vidEl.currentTime : 0;
        vtimeEl.textContent = fmtTime(t) + ' / ' + fmtTime(d);
        if (!seekDrag) vseekEl.value = String(d ? Math.round((t / d) * 1000) : 0);
    }

    function syncVideoCtl() {
        if (!vctlEl || mediaEl !== vidEl) return;
        setIcon(vplayEl, vidEl.paused ? ICON_PLAY : ICON_PAUSE);
        setIcon(vmuteEl, vidEl.muted ? ICON_MUTE : ICON_LOUD);
        setTip(vmuteEl, vidEl.muted ? 'Sound on' : 'Mute');
        vsoundEl.classList.toggle('muted', !!vidEl.muted);
        // A muted element still reports its volume; the column must show silence, not the level
        // it will come back to.
        if (!volDrag) vvolInEl.value = String(Math.round((vidEl.muted ? 0 : vidEl.volume) * 100));
        vrateEl.textContent = Math.round(vidEl.playbackRate * 100) + '%';
        vrateEl.classList.toggle('off', Math.abs(vidEl.playbackRate - 1) > 1e-6);
        syncRateMenu();
        syncVideoTime();
    }

    function togglePlay() {
        if (mediaEl !== vidEl) return;
        if (vidEl.paused) playVideo(); else vidEl.pause();
    }

    // Sound is the one thing that can un-permit playback: a clip that autoplayed BECAUSE it was
    // muted is stopped the moment it is not, unless the browser counts this click as the gesture.
    function toggleMute() {
        if (mediaEl !== vidEl) return;
        const wasPlaying = !vidEl.paused;
        vidEl.muted = !vidEl.muted;
        // The stored level is not touched: unmuting returns to it, zero included.
        applyAudioWish(wasPlaying);
        rememberAudio();
        openVol();      // clicking the button is also a request to see the column
    }

    // One place decides what the tab wants, so the icon, the column and the element agree.
    // Only a clip that WAS playing is restarted — unmuting is not a request to resume.
    function applyAudioWish(wasPlaying) {
        if (wasPlaying && vidEl.paused) playVideo();
        syncVideoCtl();
    }

    function rememberAudio() {
        saveAudio({ muted: !!vidEl.muted, volume: vidEl.volume });
    }

    // ---- the speed menu

    function buildRateMenu() {
        ratePopEl = document.createElement('div');
        ratePopEl.className = 'spop';
        ratePopEl.addEventListener('mousedown', function (e) { e.stopPropagation(); }, true);
        RATES.forEach(function (r) {
            const o = document.createElement('div');
            o.className = 'opt';
            o.dataset.rate = String(r);
            o.textContent = Math.round(r * 100) + '%';
            o.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation(); setRate(r); closeRateMenu(); showBar();
            }, true);
            ratePopEl.appendChild(o);
        });
        const sep = document.createElement('div');
        sep.className = 'sep';
        ratePopEl.appendChild(sep);
        const row = document.createElement('div');
        row.className = 'custom';
        rateInEl = document.createElement('input');
        rateInEl.type = 'text';
        rateInEl.spellcheck = false;
        rateInEl.placeholder = 'custom';
        rateInEl.addEventListener('mousedown', function (e) { e.stopPropagation(); }, true);
        rateInEl.addEventListener('keydown', function (e) {
            e.stopPropagation();                    // onPinKey is capture on window
            if (e.key === 'Enter') { commitRateField(); e.preventDefault(); }
            else if (e.key === 'Escape') { closeRateMenu(); e.preventDefault(); }
        }, true);
        const pct = document.createElement('span');
        pct.textContent = '%';
        row.appendChild(rateInEl);
        row.appendChild(pct);
        ratePopEl.appendChild(row);
    }

    function commitRateField() {
        const n = parseFloat(String(rateInEl.value).replace(/[^0-9.]/g, ''));
        if (isNaN(n) || n <= 0) { closeRateMenu(); return; }
        setRate(Math.max(RATE_MIN, Math.min(RATE_MAX, n / 100)));
        closeRateMenu();
    }

    function setRate(r) {
        if (mediaEl !== vidEl) return;
        vidEl.playbackRate = Math.max(RATE_MIN, Math.min(RATE_MAX, r));
        syncVideoCtl();
    }

    function rateMenuOpen() { return !!ratePopEl && ratePopEl.classList.contains('open'); }

    function closeRateMenu() {
        if (!ratePopEl) return;
        ratePopEl.classList.remove('open');
        vrateEl.classList.remove('open');
    }

    function toggleRateMenu() {
        if (rateMenuOpen()) { closeRateMenu(); return; }
        closePops();
        // Anchored to the button, clamped so a narrow frame cannot push it off the left edge.
        const left = Math.max(0, vrateEl.offsetLeft + vrateEl.offsetWidth - RATE_POP_W);
        ratePopEl.style.left = left + 'px';
        ratePopEl.classList.add('open');
        vrateEl.classList.add('open');
        rateInEl.value = '';
        syncRateMenu();
    }

    function syncRateMenu() {
        if (!ratePopEl) return;
        const cur = vidEl ? vidEl.playbackRate : 1;
        [].forEach.call(ratePopEl.querySelectorAll('.opt'), function (o) {
            o.classList.toggle('on', Math.abs(Number(o.dataset.rate) - cur) < 1e-6);
        });
    }

    // The autoplay policy refuses an unmuted clip that has no gesture behind it. Rather than
    // leave a frozen preview, fall back to muted and keep the picture moving.
    function playVideo() {
        const started = vidEl.play();
        if (!started || !started.catch) return;
        started.catch(function () {
            if (vidEl.muted || mediaEl !== vidEl) return;   // torn down, or already silent
            vidEl.muted = true;
            const retry = vidEl.play();
            if (retry && retry.catch) retry.catch(function () { /* gone */ });
        });
    }


    // The bar's height, fixed so the ring around it can be a matching thickness.
    const BAR_MIN_H = 24;
    const BTN_STEP = 24;        // and the pitch of the ones beside it

    // The bar's own metrics, shared by the stylesheet and by barMinW() so the two cannot disagree.
    const BAR_PAD = 8;          // .cap's left/right padding
    const BAR_GAP = 10;         // between name, metadata and the zoom cluster
    const BAR_SLIDER_W = 100;
    const BAR_ZOOM_GAP = 0;     // inside the cluster: the readout's own padding is the gap
    // The readout slot. Measured: at 11px system-ui the widest reading the zoom ceiling can
    // produce ("6,400%", MAX_SCALE_ABS) is 35px, plus .zval's 6px of padding. The slot is
    // FIXED because the slider's right edge and the buttons' left edge are both pinned, so a
    // slot that tracked the text would move one of them — which is the skip `E34` exists to
    // prevent. A short reading therefore leaves slack after it; trimming 52 to 44 is as far as
    // that can go without giving the slider back its wander.
    const BAR_ZOOM_W = 44;

    // The floating video strip. It overlays the picture and reserves nothing, so none of these
    // reach btnGutter(), barMinW() or bottomGap() — that is the whole point of floating it.
    const VCTL_H = 30;
    const VOL_BTN = 24;         // bigger than the rest of the strip: it is also a hover target
    const VOL_TRACK = 72;       // the popup column's height
    const VOL_CLOSE_MS = 320;   // grace period for the pointer to reach the column
    const VCTL_GAP = 6;         // clearance above the status bar
    // Below this the strip would cover the clip instead of sitting on it.
    const VCTL_MIN_H = 110;
    const VCTL_PAD = 8;         // .vctl's own left/right padding, matching the rule
    const VBTN_W = 20;          // one strip button's box
    const NAV_GAP = 2;          // between ◀, the counter and ▶ in the tour widget

    // Is the floating strip actually on screen? Exactly what the CSS rule above asks.
    function stripUp() {
        return !!box && box.classList.contains('hot') && box.classList.contains('tall') &&
            box.classList.contains('hasvid');
    }

    // ---- clearing the grab bands
    //
    // The frame's edges are draggable, and the bar sits inside them: the bottom corners resize,
    // the sides move the window. A control placed under any of that is unreachable — the press
    // is the frame's, not the control's — so every control keeps `grabInset()` clear of both
    // sides. It is derived from the same constants `hitRegion()` tests, so raising the frame
    // margin widens the clearance instead of burying the slider.
    //
    function grabBand() {
        return Math.max(CORNER_REACH, RESIZE_IN);
    }

    // The same distance measured from the FRAME's edge, which is what the bar is laid out in.
    function grabInset() {
        return Math.max(BAR_PAD, grabBand() - borderPx());
    }

    // Where the zoom cluster's right edge sits, measured in from the bar's right edge: clear of
    // the buttons once placed, and of nothing but the padding while hovering.
    function btnGutter() {
        if (!placed) return BAR_PAD;
        const n = 4 + (mediaEl === vidEl ? 1 : 0) + (retryShown() ? 1 : 0) + (teachShown() ? 1 : 0);
        return grabInset() + BTN_STEP * n + 2;
    }

    // ↻ appears only where re-hovering is not available: on a failed picture, inside a tour.
    function retryShown() { return !!retryEl && !!view && !!view.reason && tourActive(); }

    function markRetry() {
        if (retryEl) retryEl.classList.toggle('on', retryShown());
        if (teachEl) teachEl.classList.toggle('on', teachShown());
    }

    // The find-the-original button: on a pinned picture that is still the page's own copy.
    function teachShown() {
        return !!teachEl && !!view && placed && mediaEl !== vidEl && !!activeShown &&
            (view.url === activeShown || isOpen(teachPopEl));
    }

    // How much of the bar the cluster covers right now.
    function zctlW() {
        if (!zctlEl || zctlEl.hidden) return 0;
        return (zsliderEl.hidden ? 0 : BAR_SLIDER_W + BAR_ZOOM_GAP) + BAR_ZOOM_W;
    }

    // Everything on the right that the filename and metadata must stay clear of.
    function textGutter() {
        const w = zctlW();
        return btnGutter() + (w ? w + BAR_GAP : 0);
    }

    // The narrowest frame that still shows the whole cluster clear of the buttons. Filename and
    // metadata are allowed to be clipped away entirely, so they claim nothing here.
    function barMinW() {
        return grabInset() + BAR_SLIDER_W + BAR_ZOOM_GAP + BAR_ZOOM_W + btnGutter();
    }

    let barTimer = 0;
    let barOver = false;        // was the pointer on the preview last move; see onMove

    // The bar must not fade while the pointer is ON it.
    function overRect(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        return pointer.x >= r.left && pointer.x <= r.right &&
               pointer.y >= r.top && pointer.y <= r.bottom;
    }

    // How far up from the frame's bottom edge counts as reaching for the bar. Over a clip it
    // clears the video strip and the gap under it, or the strip fades out from under the hand
    // crossing that gap on the way to the scrubber.
    function barHoverBand() {
        let h = barShown() ? BAR_MIN_H : 0;
        if (stripUp()) h = Math.max(h, BAR_MIN_H + VCTL_GAP + VCTL_H);
        return h;
    }

    // The status bar and nothing else. This is the ONE thing onBoxDown treats as a move handle
    // (`capEl.contains(e.target)`), so it is the only thing `pressMode()` may call one. Widen
    // this and the cursor promises a move where the press pans. See E40.
    function pointerOverCap() {
        if (!capEl || !view || !box || !box.classList.contains('on')) return false;
        return capEl.style.display !== 'none' && overRect(capEl);
    }

    // The strip counts too, or it fades out from under the hand reaching for the scrubber — or,
    // over a still picture, for ◀.
    function pointerOverBar() {
        if (pointerOverCap()) return true;
        if (!view || !box || !box.classList.contains('on')) return false;
        if (!stripUp()) return false;
        if (overRect(vctlEl)) return true;
        return mediaEl === vidEl &&
            (overRect(vvolEl) || (rateMenuOpen() && overRect(ratePopEl)));
    }

    // Reaching for the bar, which is what keeps it up. Wider than the bar, and never a handle.
    function pointerNearBar() {
        const band = barHoverBand();
        if (!band || !view || !box || !box.classList.contains('on')) return false;
        const ow = outerW(), oh = outerH();
        const rx = pointer.x - view.left, ry = pointer.y - view.top;
        return rx >= 0 && rx <= ow && ry <= oh && oh - ry <= band;
    }

    function pointerOverChrome() {
        return pointerOverBar() || pointerNearBar();
    }

    function barVisible() {
        return !!box && barShown() && !box.classList.contains('baridle');
    }

    function barIdleMs() {
        return Math.max(0, Math.min(60000, cfg.barIdleMs | 0));
    }

    // The DELAY only. At 0 the answer is given on the spot rather than a frame later, which is
    // what the flicker across the middle of the picture was. It says NOTHING about how long the
    // fade takes — that is barFadeMs, and coupling the two is the bug fixed in v0.72.0.
    function barNoDelay() {
        return barFades() && !barIdleMs();
    }

    // Should it be up right now, asked only where there is no timer to ask it later.
    // Outside fullscreen the whole preview holds the bar open, so it never fades out from under
    // the picture you are reading — only leaving the window starts the fade. Fullscreen keeps the
    // still-pointer rule, because there is nowhere to leave to: the window IS the screen.
    function barWanted() {
        if (popOpen() || !!drag || zoomBusy()) return true;
        if (!fullActive()) return pointInPreview(pointer.x, pointer.y);
        return pointerOverChrome();
    }

    // The class lives on the BOX, not on the bar. 'always' simply never takes it.
    function applyIdle(idle) {
        box.classList.toggle('baridle', barFades() && idle);
    }

    function showBar() {
        if (!box) return;
        clearTimeout(barTimer);
        barTimer = 0;
        if (barNoDelay()) {
            applyIdle(!barWanted());            // on the chrome: still shown
            return;
        }
        applyIdle(false);
        if (!barFades()) return;                // stays up for as long as the window does
        barTimer = setTimeout(function () {
            barTimer = 0;
            if (!box || !view) return;
            if (barWanted()) { showBar(); return; }         // parked on it: keep it
            applyIdle(true);
        }, barIdleMs());
    }

    function resetBar() {
        clearTimeout(barTimer);
        barTimer = 0;
        barOver = false;
        if (!box) return;
        applyIdle(barNoDelay() && !barWanted());
    }

    const COVER_HOLD_MS = 150;  // coverEl stays this long past imgEl's decode: LibreWolf paints imgEl late
    let swapSeq = 0;            // bumped by anything that puts media in the frame; a staged swap checks it
    let blanked = false;        // a slideshow step with nothing to show yet: the frame is empty
    let tourRestTimer = 0;
    let spinCentred = false;

    // Point the frame at a resolved candidate, picking the face that can display it.
    function setMedia(res, stage) {
        const seq = ++swapSeq;
        dropCover();
        if (blanked) unblank();
        const wantsVideo = !!res.video;
        mediaEl = wantsVideo ? vidEl : imgEl;
        const idle = wantsVideo ? imgEl : vidEl;
        idle.hidden = true;
        clearMedia(idle);
        mediaEl.hidden = false;
        applySmoothing();
        if (!wantsVideo && noReferrerHere()) imgEl.referrerPolicy = 'no-referrer';
        const want = res.display || res.url, was = imgEl.getAttribute('src');
        imgEl.style.visibility = '';
        mediaEl.src = want;   // a CSP-refused picture displays from bytes. See E49.
        if (stage && !wantsVideo && was && was !== want) stageCover(want, seq);
        syncSavedMark();
        if (wantsVideo) {
            // The site's remembered answer, not the last clip's: a fresh tab on a site that has
            // never been unmuted starts silent, which is what AUDIO_DEFAULT is for.
            const a = audioFor();
            vidEl.volume = a.volume;
            vidEl.muted = a.muted;
            vidEl.playbackRate = 1;
            seekDrag = false;
            volDrag = false;
            closeRateMenu();
            closeVol();
            playVideo();
            syncVideoCtl();
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

    // The margin strips, which float over the picture and therefore have to be re-placed whenever the frame changes size.
    function layoutChrome() {
        const px = function (n) { return n + 'px'; };
        const hasVid = mediaEl === vidEl;
        capEl.classList.toggle('hasvid', hasVid);
        box.classList.toggle('hasvid', hasVid);
        // The strip would cover the picture rather than sit on it once the frame is this short.
        box.classList.toggle('tall', view.frameH >= VCTL_MIN_H);
        // Right to left, skipping the ▶ when the frame is not holding a clip; the gutter has to
        // clear whatever is actually there or the filename runs under the buttons.
        let right = grabInset();
        xEl.style.right = px(right); right += BTN_STEP;
        fsEl.style.right = px(right); right += BTN_STEP;
        blockEl.style.right = px(right); right += BTN_STEP;
        if (hasVid) { vidOffEl.style.right = px(right); right += BTN_STEP; }
        if (retryShown()) { retryEl.style.right = px(right); right += BTN_STEP; }
        if (teachShown()) { teachEl.style.right = px(right); right += BTN_STEP; }
        aaEl.style.right = px(right); right += BTN_STEP;
        markSmoothing();
        markRetry();
        zctlEl.style.width = px(zctlW());
        zctlEl.style.right = px(btnGutter());
        // The strip clears the side bands too; it sits above the corners, so those do not apply.
        vctlEl.style.right = px(grabInset());
        vctlEl.style.left = px(grabInset());
        // The two paddings TOGETHER may not exceed the frame. `box-sizing:border-box` treats
        // padding as a minimum, not a share: overflow it and the bar's border box grows past the
        // frame, taking every `right:`-anchored control with it — the buttons stop clearing the
        // grab band and the slider jumps sideways at the narrowest zoom.
        const padL = Math.min(grabInset(), Math.max(0, view.frameW - BAR_PAD));
        capEl.style.paddingLeft = px(padL);
        capEl.style.paddingRight = px(Math.min(textGutter(), Math.max(0, view.frameW - padL)));
    }

    function layout() {
        if (!view || !mediaEl) return;
        clampPosition();
        if (placed && twPtr) thruSync(twPtr.x, twPtr.y);     // the window changed under a still pointer
        box.style.left = Math.round(view.left) + 'px';
        box.style.top = Math.round(view.top) + 'px';
        gripEl.style.left = Math.round(view.left - RESIZE_OUT) + 'px';
        gripEl.style.top = Math.round(view.top - RESIZE_OUT) + 'px';
        gripEl.style.width = Math.round(outerW() + RESIZE_OUT * 2) + 'px';
        gripEl.style.height = Math.round(outerH() + RESIZE_OUT * 2) + 'px';
        gripEl.classList.toggle('hot', placed);
        box.style.width = view.frameW + 'px';
        box.style.height = (view.frameH + barDock()) + 'px';
        box.classList.toggle('bardock', !!barDock());
        caption();          // sets what the bar shows; layoutChrome() reserves room for it
        layoutChrome();
        mediaEl.style.width = Math.round(view.imgW) + 'px';
        mediaEl.style.height = Math.round(view.imgH) + 'px';
        mediaEl.style.left = Math.round(view.ox) + 'px';
        mediaEl.style.top = Math.round(view.oy) + 'px';
        if (coverEl && !coverEl.hidden) coverEl.style.cssText = mediaEl.style.cssText;
        box.classList.toggle('hot', placed);
        box.classList.toggle('pan', placed && pannable());
        if (spinDocked) moveSpinner();      // the dock rides with the frame
        placePop();
    }

    function clampScale(s) {
        const lo = minScaleFor(view.natW, view.natH);
        const hi = Math.max(lo, maxScale());
        return Math.max(lo, Math.min(hi, s));
    }

    // Zoom about a point given in SCREEN coordinates, keeping whatever pixel of the image sits under it there afterwards.
    function zoomAt(nextScale, screenX, screenY) {
        if (!view) return;
        nextScale = clampScale(nextScale);
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

    // Zoom with the frame's bottom-right corner nailed in place, so the bar's own controls do not
    // move under the pointer driving them; the picture still zooms about the frame's centre.
    function zoomAnchored(nextScale) {
        if (!view) return;
        nextScale = clampScale(nextScale);
        if (Math.abs(nextScale - view.scale) < 1e-6) return;
        const rx = view.left + view.frameW, by = view.top + view.frameH;
        const cx = (view.frameW / 2 - view.ox) / view.scale;
        const cy = (view.frameH / 2 - view.oy) / view.scale;
        view.scale = nextScale;
        reflow();
        view.left = rx - view.frameW;
        view.top = by - view.frameH;
        view.ox = view.frameW / 2 - cx * nextScale;
        view.oy = view.frameH / 2 - cy * nextScale;
        reflow();
        layout();
    }

    function zoomCentre(nextScale) {
        if (!view) return;
        zoomAt(nextScale,
            view.left + insetX() + view.frameW / 2,
            view.top + insetY() + view.frameH / 2);
    }

    // Whatever the pan clamp refuses moves the WINDOW instead, or a frame bigger than the screen
    // has edges of the picture nobody can ever reach — except in fullscreen, which is nailed down.
    function panBy(dx, dy) {
        if (!view || !pannable()) return;
        const wasX = view.ox, wasY = view.oy;
        view.ox += dx;
        view.oy += dy;
        reflow();
        const spareX = dx - (view.ox - wasX);
        const spareY = dy - (view.oy - wasY);
        // Nailed to the screen: the spill would drag the window off its own backdrop. See E35.
        if (!fullActive() && (spareX || spareY)) { view.left += spareX; view.top += spareY; }
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
        if (activeSmall) return;
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
        if (spinCentred && view && box && box.classList.contains('on')) {
            spinEl.style.left = Math.round(view.left + insetX() + (view.frameW - SPIN_SIZE) / 2) + 'px';
            spinEl.style.top = Math.round(view.top + insetY() + (view.frameH - SPIN_SIZE) / 2) + 'px';
            return;
        }
        if (spinDocked && view && box && box.classList.contains('on')) {
            const capH = barShown() ? capEl.offsetHeight : 0;
            spinEl.style.left =
                Math.round(view.left + insetX() + view.frameW - SPIN_SIZE - 8) + 'px';
            spinEl.style.top =
                Math.round(view.top + insetY() + view.frameH - capH - SPIN_SIZE - 8) + 'px';
            return;
        }
        spinEl.style.left = Math.min(pointer.x + 16, m.vw - SPIN_SIZE - EDGE_GAP) + 'px';
        spinEl.style.top = Math.min(pointer.y + 16, m.vh - SPIN_SIZE - bottomGap()) + 'px';
    }

    // Empty the frame, in the page's light or dark, with the spinner in the middle.
    function blankFrame() {
        if (!view || !box) return;
        imgEl.hidden = true;
        vidEl.hidden = true;
        clearMedia(vidEl);
        paintOver(box, 'background-color', darkMode() ? '#1e1e2e' : '#ffffff');
        blanked = spinCentred = true;
        showSpinner();
        moveSpinner();
    }

    function unblank() {
        blanked = spinCentred = false;
        paintOver(box, 'background-color', '#1e1e2e');
        moveSpinner();
    }

    // The saved mark follows the pointer, below-right, while a picture saved this visit is up; the spinner takes the spot first.
    function syncSavedMark() {
        if (!savedMarkEl) return;
        const on = !!view && !!box && box.classList.contains('on') && midSavedHref === location.href && midSaved.get(view.url) === Infinity &&
            !(spinEl && spinEl.classList.contains('on')) && (!placed || pointInPreview(pointer.x, pointer.y));
        savedMarkEl.classList.toggle('on', on);
        if (!on) return;
        const m = viewportBox();
        savedMarkEl.style.left = Math.min(pointer.x + 14, m.vw - SAVED_MARK - EDGE_GAP) + 'px';
        savedMarkEl.style.top = Math.min(pointer.y + 14, m.vh - SAVED_MARK - bottomGap()) + 'px';
    }

    function hideSpinner() {
        clearTimeout(spinTimer);
        if (spinAnim) { clearInterval(spinAnim); spinAnim = 0; }
        spinDocked = false;
        if (spinEl) spinEl.classList.remove('on');
        syncSavedMark();
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

    // A preview called up by the hotkey appears and goes at once: the key is the control.
    function fadeNow() { return cfg.activation === 'modifier' ? 0 : cfg.fadeMs; }

    // Everything the appearance settings write to a window that is already up, so changing one
    // while a preview is open shows it (see the panel's live mode).
    function applyLook() {
        if (!host || !box) return;
        host.style.setProperty('--fade', fadeNow() + 'ms');
        host.style.setProperty('--barfade', barFadeMs() + 'ms');
        const bw = borderPx();
        box.style.border = bw > 0 ? bw + 'px solid ' + cfg.borderColor : 'none';
        box.style.borderRadius = cfg.cornerRadius + 'px';
        box.style.boxShadow = shadowCss();
        paintOver(box, 'background-color', '#1e1e2e');
        if (bw > 0) paintOver(box, 'border-color', cfg.borderColor);
    }

    function barFadeMs() {
        return Math.max(0, Math.min(10000, cfg.barFadeMs | 0));
    }

    function showViewer(res, pointer) {
        buildViewer();

        const m = viewportBox();
        const fit = Math.min(fromShown(cfg.zoomLimit), m.w / res.w, m.h / res.h);

        view = {
            url: res.url, natW: res.w, natH: res.h, reason: res.reason || null,
            scale: fit, fitScale: fit,
            imgW: 0, imgH: 0, frameW: 0, frameH: 0, ox: 0, oy: 0, left: 0, top: 0,
            // null until a hand resize pins the edges; resizeBy() is the only writer.
            fixedW: null, fixedH: null,
            capH: null,             // frame height clearWidget() shrank it to, so it ends above the widget
            anchor: null,           // the remembered spot it was placed by; posApply() sets it
        };
        reflow();

        applyLook();

        const ow = outerW();
        const oh = outerH();
        const kind = posKind();
        if (kind) posApply(posLoad(kind));
        else {
            // Centred on the pointer ('under'), else beside it on whichever side has more room.
            const rightRoom = m.vw - pointer.x;
            view.left = cfg.position === 'under' ? pointer.x - ow / 2 : rightRoom >= ow ? pointer.x : pointer.x - ow;
            view.top = pointer.y - oh / 2;
            if (!activeSmall) nudgeIntoReach();
        }
        if (activeSmall) besidePicture(ow, oh, m);

        setMedia(res, true);
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
        view.reason = res.reason || null;   // an upgrade landing clears a failure note
        view.fitScale = fitScaleFor(res.w, res.h);
        view.scale = userSized && prevImgW
            ? Math.max(minScaleFor(res.w, res.h), prevImgW / res.w)   // same size, better pixels
            : view.fitScale;

        reflow();
        view.ox = view.frameW / 2 - fx * view.imgW;
        view.oy = view.frameH / 2 - fy * view.imgH;
        reflow();
        if (view.anchor) posApply(view.anchor);
        else {
            view.left = centreX - outerW() / 2;
            view.top = centreY - outerH() / 2;
        }

        setMedia(res);
        layout();
        deferredCaption(res.url);
    }

    // A DIFFERENT picture into the same window, at the slideshow's spot. A hand-set size stays; zoom and pan
    // reset, because a pan offset means nothing carried into another picture. See TOUR.md.
    // Stages an image off-screen; the commit paints it on coverEl so frame size and picture change in one paint. See TOUR.md §2.
    function swapViewer(res, warm) {
        if (!view) return;
        const seq = ++swapSeq;
        if (res.video) { commitSwap(res); return; }
        const im = new Image();
        if (noReferrerHere()) im.referrerPolicy = 'no-referrer';
        const t0 = Date.now();
        im.src = res.display || res.url;
        showSpinner();
        dockSpinner();
        const done = function () {
            if (warm && im.naturalWidth && Date.now() - t0 > PL_COLD_MS) plWentCold();
            if (seq !== swapSeq || !view || !tourActive()) return;
            hideSpinner();
            commitSwap(res);
            showCover(im);
        };
        im.decode().then(done, done);
    }

    function commitSwap(res) {
        view.url = res.url;
        view.natW = res.w;
        view.natH = res.h;
        view.reason = res.reason || null;
        view.capH = null;
        view.fitScale = fitScaleFor(res.w, res.h);
        view.scale = view.fitScale;
        view.ox = 0;
        view.oy = 0;
        // caption() only rebuilds when the URL or the measured size changes, and two entries can
        // share both — the same file, once with a reason and once without.
        resetCaption();

        reflow();
        posApply(posLoad('tour'));

        setMedia(res);
        layout();
        deferredCaption(res.url);
    }

    // Draws the staged picture over imgEl until imgEl itself has painted it.
    function showCover(im) {
        if (!im.naturalWidth || mediaEl !== imgEl) return;
        const seq = swapSeq;
        const dpr = window.devicePixelRatio || 1;
        const k = Math.min(dpr, Math.sqrt(8e6 / Math.max(1, view.imgW * view.imgH)));
        const w = Math.max(1, Math.round(view.imgW * k));
        const h = Math.max(1, Math.round(view.imgH * k));
        try {
            coverEl.width = w;
            coverEl.height = h;
            const g = coverEl.getContext('2d');
            g.fillStyle = '#1e1e2e';
            g.fillRect(0, 0, w, h);
            g.imageSmoothingEnabled = smoothingMode() !== 'pixelated';
            g.imageSmoothingQuality = 'high';
            g.drawImage(im, 0, 0, w, h);
        } catch (e) { dropCover(); return; }
        coverEl.style.cssText = imgEl.style.cssText;
        coverEl.hidden = false;
        const lift = function () { setTimeout(function () { if (seq === swapSeq) dropCover(); }, COVER_HOLD_MS); };
        imgEl.decode().then(lift, lift);
        setTimeout(function () { if (seq === swapSeq) dropCover(); }, 3000);
    }

    // imgEl may paint its last picture at the new size: hide it, decode off-screen, then show it under coverEl. See VIEWER.md.
    function stageCover(want, seq) {
        imgEl.style.visibility = 'hidden';
        const im = new Image();
        if (noReferrerHere()) im.referrerPolicy = 'no-referrer';
        im.src = want;
        const done = function () {
            if (seq !== swapSeq || !view || mediaEl !== imgEl || imgEl.getAttribute('src') !== want) return;
            imgEl.style.visibility = '';
            showCover(im);
        };
        im.decode().then(done, done);
    }

    function dropCover() {
        if (!coverEl || coverEl.hidden) return;
        coverEl.hidden = true;
        coverEl.width = coverEl.height = 0;
    }

    function deferredCaption(url) {
        if (!barShown() || transferBytes(url)) return;
        setTimeout(function () {
            if (!view || view.url !== url) return;
            resetCaption();         // the byte count is the one part that arrives late
            caption();
        }, 300);
    }

    let hideTimer = 0;          // one teardown at a time, or an older hide clears a newer fade

    function hideViewer() {
        if (!box) return;
        if (vidEl) vidEl.pause();   // sound must not outlive the window; setMedia() restarts it
        hideTip();
        closePops();
        resetZoomControl();
        seekDrag = false;
        volDrag = false;
        closeVol();
        box.classList.remove('on', 'hot', 'pan', 'drag', 'full');
        syncSavedMark();
        box.style.cursor = '';      // onMove writes this inline over the bands; see hitRegion
        if (gripEl) { gripEl.classList.remove('hot'); gripEl.style.cursor = ''; }
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
            hideTimer = 0;
            if (box && !box.classList.contains('on')) {
                clearMedia(imgEl);
                clearMedia(vidEl);
                mediaEl = null;
                view = null;
            }
        }, fadeNow() + 60);
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
        CAP_TARGET.addEventListener('wheel', perfWrap(onPinWheel, 'event'), WHEEL_OPTS);
    }

    function disableWheelZoom() {
        if (!wheelZoomOn) return;
        wheelZoomOn = false;
        CAP_TARGET.removeEventListener('wheel', perfWrap(onPinWheel, 'event'), WHEEL_OPTS);
    }

    // The ✕ buttons: gone, and a picture still under the pointer stays down until it is left.
    function closeByButton() {
        lastUserAct = Date.now();
        dismiss();
    }

    // Hovering becomes placed, and there is nothing in between.
    function place() {
        if (placed || !view) return;
        placed = true;
        clearTimeout(timer);
        clearInterval(watchTimer);      // a placed window outlives whatever lands under it
        box.classList.add('placed');
        dimEl.classList.add('catch');
        CAP_TARGET.addEventListener('keydown', onPinKey, true);
        // The wheel becomes the window's only now — see enableWheelZoom.
        enableWheelZoom();
        if (!tour && !galOwns(active)) tourStart();     // a tour begun from the widget brings its own; a gallery picture steps through its gallery (galStep)
        if (galCur && galOwns(active)) { const i = galShownAt(galCur); if (i >= 0) { galCur.at = i; galPageNote(galCur); } }
        reflow();       // the controls appear with `placed`, and minFrameW() grows with them
        layout();
        twSync();
    }

    function unplace() {
        if (!placed) return;
        // Fullscreen outlives nothing: the window that asked for it is going away. Only ours.
        if (fullActive()) leaveFull();
        placed = false;
        tourEnd();
        drag = null;
        tap = null;
        box.classList.remove('placed', 'drag');
        box.style.cursor = '';
        dimEl.classList.remove('catch', 'thru');
        CAP_TARGET.removeEventListener('keydown', onPinKey, true);
        cancel();
    }

    // ------------------------------------------------------------- remembered positions

    // Two memories: the slideshow's, and the hover preview's when it opens 'last'. A spec is
    // {x:{m,o}, y:{m,o}} — the window's start/centre/end point, o px from the viewport's same
    // point, m the nearest third (with the widgets' hysteresis). See VIEWER.md.
    const POS_KEY = 'hoverZoomPos';     // GM: { tour: { sites, last }, hover: { sites, last } }
    const POS_CENTRE = { x: { m: 'c', o: 0 }, y: { m: 'c', o: 0 } };

    function posStore() {
        try {
            const v = JSON.parse(GM_getValue(POS_KEY, 'null'));
            if (v && typeof v === 'object') return v;
        } catch (e) { console.warn('[Hover Zoom] remembered positions unreadable; using the centre', e); }
        return {};
    }

    // This site's spot when per-site is on and it has one, else the last drop anywhere, else the centre.
    function posLoad(kind) {
        const k = posStore()[kind] || {};
        return (cfg.posPerSite && k.sites && k.sites[pageHost()]) || k.last || POS_CENTRE;
    }

    function posSave(kind, spec) {
        const st = posStore();
        const k = st[kind] = st[kind] || {};
        k.sites = k.sites || {};
        if (cfg.posPerSite) k.sites[pageHost()] = spec;
        k.last = spec;
        GM_setValue(POS_KEY, JSON.stringify(st));
    }

    // Which memory a window opened now answers to, if any.
    function posKind() {
        if (tourActive()) return 'tour';
        return cfg.position === 'last' ? 'hover' : null;
    }

    function posPt(lo, len, m) { return m === 's' ? lo : m === 'c' ? lo + len / 2 : lo + len; }

    function posAxis(a, len, V) {
        const m = a && /^[sce]$/.test(a.m) ? a.m : 'c';
        const lo = posPt(0, V, m) + ((a && +a.o) || 0) - posPt(0, len, m);
        return len >= V ? (V - len) / 2 : Math.max(0, Math.min(V - len, lo));
    }

    // The window placed by a spec, whole on screen whenever it fits.
    function posApply(spec) {
        view.left = posAxis(spec.x, outerW(), vpW());
        view.top = posAxis(spec.y, outerH(), vpH());
        view.anchor = spec;
    }

    // A drop flush with an edge or the centre anchors there; anywhere else, the nearest third.
    // A wide picture's centre never reaches an outer third, so the snap has to say it.
    function posSpec(prev) {
        const ax = function (lo, len, V, p) {
            if (len >= V - 1) return p || { m: 'c', o: 0 };     // filling the axis says nothing about it
            const m = Math.abs(lo) < 0.5 ? 's' : Math.abs(lo + len - V) < 0.5 ? 'e'
                : Math.abs(lo + len / 2 - V / 2) < 0.5 ? 'c' : usDock.zone(p && p.m, lo, len, V);
            return { m: m, o: Math.round((posPt(lo, len, m) - posPt(0, V, m)) * 100) / 100 };
        };
        return { x: ax(view.left, outerW(), vpW(), prev && prev.x),
                 y: ax(view.top, outerH(), vpH(), prev && prev.y) };
    }

    const POS_SNAP_EDGE = 16;       // px: a window edge pulls this far
    const POS_SNAP_CENTRE = 40;     // px: the centre pulls further — it is where most things go
    const POS_MOVE_MIN = 40;        // px: a drag shorter than this on an axis is not a new spot
    const POS_ROOM_MIN = 80;        // px (or 10% of the window): less spare room than this is not a choice

    // A box of w x h at (l, t), snapped per axis to the window's edges and its middle — the corners,
    // the edge middles, the centre. Nearest wins. The preview and the settings panel share it.
    function boxSnap(l, t, w, h) {
        const one = function (v, len, V) {
            let best = v, gap = Infinity;
            [[0, POS_SNAP_EDGE], [(V - len) / 2, POS_SNAP_CENTRE], [V - len, POS_SNAP_EDGE]].forEach(function (c) {
                const d = Math.abs(v - c[0]);
                if (d <= c[1] && d < gap) { gap = d; best = c[0]; }
            });
            return best;
        };
        return { x: one(l, w, vpW()), y: one(t, h, vpH()) };
    }

    function posSnap(l, t) { return boxSnap(l, t, outerW(), outerH()); }

    // A pinned window let go after a move. It stays where it was put (view.anchor), but the memory
    // takes an axis only when the drag was a clear choice on it: moved at least POS_MOVE_MIN, with
    // real room to choose in. Nudging a picture nearly the window's size is not a new default.
    function posDropped(dx, dy) {
        const vw = vpW(), vh = vpH();
        if (!vw || !vh) return;
        const cur = posSpec(view.anchor);
        view.anchor = cur;
        const kind = posKind();
        const room = function (len, V) { return V - len >= Math.max(POS_ROOM_MIN, V * 0.1); };
        const takeX = Math.abs(dx) >= POS_MOVE_MIN && room(outerW(), vw);
        const takeY = Math.abs(dy) >= POS_MOVE_MIN && room(outerH(), vh);
        if (kind && (takeX || takeY)) {
            const saved = posLoad(kind);
            posSave(kind, { x: takeX ? cur.x : saved.x, y: takeY ? cur.y : saved.y });
        }
        dbg('window dropped', { kind: kind || '(not remembered)', spec: JSON.stringify(cur),
            remembered: kind ? (takeX ? 'x' : '') + (takeY ? 'y' : '') || 'nothing — too small a move, or no room' : '-' });
    }

    // ------------------------------------------------------------- fullscreen

    // The DOCUMENT goes fullscreen, not our host: our whole coordinate system is `position:fixed`
    // against the viewport, and fullscreening the document is the one route that makes the
    // viewport BE the screen in every engine. The page behind is blacked out by `.dim.full`.
    //
    // `fullPrev` is BOTH the saved geometry and the "this fullscreen is ours" flag, and it is
    // written at the CLICK — never from the change event. Two reasons, both of which shipped as
    // bugs in v0.63.0:
    //
    //  - `document.fullscreenElement` is also set when the PAGE goes fullscreen. Keying off it
    //    meant our handler fired on YouTube's own fullscreen and cancelled it.
    //  - `resize` can arrive before `fullscreenchange`, so a snapshot taken in the handler had
    //    already been overwritten by `fitFull()` and "restoring" put back the fullscreen size.
    function fullActive() {
        return !!fullPrev;
    }

    // Fullscreening the DOCUMENT leaves the page scrollable underneath, so its scrollbar is still
    // drawn down the side of our black backdrop. Take it away for as long as we are up, and put
    // back exactly what was there — an inline value we did not write is not ours to discard.
    //
    // Both elements, because which one carries the scrollbar is the page's choice, not ours.
    // `scrollbar-width` as well as `overflow`: in fullscreen only the former frees the strip. E42.
    let scrollLock = null;

    function lockScroll() {
        if (scrollLock) return;
        const de = document.documentElement, bd = document.body;
        const keep = growsHere();       // overflow:hidden stops a feed loading more under the slideshow. E77.
        scrollLock = {
            de: de && !keep ? de.style.overflow : null, bd: bd && !keep ? bd.style.overflow : null,
            deBar: de ? de.style.scrollbarWidth : null,
            bdBar: bd ? bd.style.scrollbarWidth : null,
        };
        if (de) { if (!keep) de.style.overflow = 'hidden'; de.style.scrollbarWidth = 'none'; }
        if (bd) { if (!keep) bd.style.overflow = 'hidden'; bd.style.scrollbarWidth = 'none'; }
    }

    function unlockScroll() {
        if (!scrollLock) return;
        const de = document.documentElement, bd = document.body;
        // Assigning '' removes the declaration, which is what "there was none" has to mean.
        if (de && scrollLock.de !== null) de.style.overflow = scrollLock.de;
        if (bd && scrollLock.bd !== null) bd.style.overflow = scrollLock.bd;
        if (de && scrollLock.deBar !== null) de.style.scrollbarWidth = scrollLock.deBar;
        if (bd && scrollLock.bdBar !== null) bd.style.scrollbarWidth = scrollLock.bdBar;
        scrollLock = null;
    }

    function toggleFull() {
        if (!view) return;
        if (fullActive()) { leaveFull(); return; }
        enterFull();
    }

    function enterFull() {
        // Captured before anything moves: this is the only moment the pre-fullscreen state exists.
        // The URL is for the tour: a step taken while fullscreen means the picture coming back
        // is not the one that went in. See E57.
        fullPrev = { left: view.left, top: view.top, scale: view.scale, url: view.url };
        fullApi = false;
        lockScroll();
        dimEl.classList.add('full');
        box.classList.add('full');
        box.style.cursor = '';      // onMove's inline cursor outranks the .full rule
        applyLook();                // border off BEFORE fitFull() measures with it. See E43.
        setIcon(fsEl, ICON_EXIT);
        setTip(fsEl, 'Leave fullscreen');
        if (!placed) place();           // fullscreen is a placed state, whatever it started as
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req && document.fullscreenEnabled) {
            try {
                const p = req.call(el);
                fullApi = true;
                fullReq = p && p.then ? p : null;
                // An iframe without allow="fullscreen" rejects; the maximise below is already
                // showing, so the fallback is to simply stop expecting the API.
                if (p && p.catch) p.catch(function () { fullApi = false; });
            } catch (e) { fullApi = false; fullReq = null; }
        }
        fitFull();
    }

    function leaveFull() {
        // A request still in flight lands first, or the change it fires would find nothing to undo.
        if (fullReq) {
            const pending = fullReq;
            fullReq = null;
            pending.then(leaveFull, leaveFull);
            return;
        }
        if (fullApi && document.fullscreenElement) {
            const fn = document.exitFullscreen || document.webkitExitFullscreen;
            if (fn) {
                try {
                    const p = fn.call(document);
                    if (p && p.catch) p.catch(function () { restoreFull(); });
                    return;
                } catch (e) { /* fall through and restore */ }
            }
        }
        restoreFull();
    }

    // Edge to edge, and the picture refitted to it.
    function fitFull() {
        if (!view) return;
        view.fixedW = Math.max(MIN_FRAME, vpW() - insetX() * 2);
        view.fixedH = Math.max(MIN_FRAME, usableHeight() - widgetFloor() - insetY() * 2 - barDock());
        view.fitScale = fitScaleFor(view.natW, view.natH);
        view.scale = view.fitScale;
        reflow();       // outerW()/outerH() read view.frameW/H, so they must be settled first
        view.left = Math.round((vpW() - outerW()) / 2);
        view.top = Math.round((usableHeight() - widgetFloor() - outerH()) / 2);
        layout();
    }

    // Position and zoom come back; the hand-resized flag does NOT. Leaving fullscreen always
    // lands in pinned-but-not-resized, so the frame follows the picture again and the wheel grows
    // the window rather than only the image.
    function restoreFull() {
        if (!fullPrev) return;
        const p = fullPrev;
        fullPrev = null;
        fullApi = false;
        fullReq = null;
        unlockScroll();
        dimEl.classList.remove('full');
        box.classList.remove('full');
        box.style.cursor = '';
        applyLook();                // fullPrev is already null, so the border comes back first
        setIcon(fsEl, ICON_FULL);
        setTip(fsEl, 'Fullscreen');
        if (!view) return;
        view.fixedW = null;
        view.fixedH = null;
        // A tour may have stepped while we were fullscreen. A zoom and a top-left corner belong
        // to the picture they were taken on: on a different one, fit it and centre it — the same
        // rule a swap follows. See E57.
        const swapped = view.url !== p.url;
        view.fitScale = fitScaleFor(view.natW, view.natH);
        view.scale = swapped ? view.fitScale
            : Math.max(p.scale, minScaleFor(view.natW, view.natH));
        reflow();
        if (swapped) posApply(posLoad('tour'));
        else {
            view.left = p.left;
            view.top = p.top;
        }
        layout();
    }

    // Only ever reacts to OUR fullscreen. A page putting its own player on the screen must pass
    // straight through here untouched — and it reaches us on every site, since the script has no
    // @noframes and the listener cannot know whose request this was.
    function onFullChange() {
        if (!fullPrev) return;
        if (document.fullscreenElement) { fullApi = true; fitFull(); return; }
        restoreFull();
    }

    // Controls that live INSIDE the box.
    // What is actually under the pointer, asked of the shadow root — a document-level hit test
    // only ever names the host.
    function pointerOverControl(x, y) {
        if (!root || !root.elementFromPoint) return false;
        const el = root.elementFromPoint(x, y);
        return !!el && isBoxControl(el);
    }

    function isBoxControl(t) {
        return blockEl.contains(t) || vidOffEl.contains(t) || aaEl.contains(t) ||
            fsEl.contains(t) || xEl.contains(t) || cornerXEl.contains(t) ||
            retryEl.contains(t) || blockPopEl.contains(t) || teachEl.contains(t) || teachPopEl.contains(t) ||
            bytesPopEl.contains(t) || zctlEl.contains(t) || vctlEl.contains(t);
    }

    // ---- the popover the ⊘ opens

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

    function isOpen(pop) { return !!pop && pop.classList.contains('open'); }

    function popOpen() {
        return isOpen(blockPopEl) || isOpen(teachPopEl) || isOpen(bytesPopEl) || rateMenuOpen();
    }

    function closePops() {
        if (blockPopEl) blockPopEl.classList.remove('open');
        if (teachPopEl) teachPopEl.classList.remove('open');
        if (bytesPopEl) bytesPopEl.classList.remove('open');
        closeRateMenu();
    }

    function togglePop(pop) {
        const wasOpen = pop.classList.contains('open');
        closePops();
        if (!wasOpen) { pop.classList.add('open'); placePop(); }
        showBar();
    }

    // Above the bar at the window's right end, free to spill past the window, whole on screen.
    function placePop() {
        const pop = isOpen(blockPopEl) ? blockPopEl : isOpen(teachPopEl) ? teachPopEl : null;
        if (!pop) return;
        const b = box.getBoundingClientRect(), c = capEl.getBoundingClientRect(), p = pop.getBoundingClientRect();
        const x = Math.max(4, Math.min(b.right - 8 - p.width, vpW() - 4 - p.width));
        let y = c.top - 4 - p.height;
        if (y < 4) y = Math.min(c.bottom + 4, vpH() - 4 - p.height);
        pop.style.left = Math.round(x) + 'px';
        pop.style.top = Math.round(Math.max(4, y)) + 'px';
    }

    // ---- Save / Open / Copy on a picture shown from bytes, where the browser's menu would act on the blob. See VIEWER.md E9a.

    function buildBytesPop() {
        const d = buildPop();
        d.classList.add('bytespop');
        [['Save image as…', saveOriginal], ['Open image in new tab', openOriginal],
         ['Copy image address', copyOriginal]].forEach(function (it) {
            const o = document.createElement('div');
            o.className = 'item';
            o.textContent = it[0];
            o.addEventListener('click', function (e) {
                e.preventDefault(); e.stopPropagation();
                const url = view && view.url;
                closePops();
                if (url) it[1](url);
            }, true);
            d.appendChild(o);
        });
        return d;
    }

    function shownFromBytes() {
        if (!placed || !view || !mediaEl || !view.url) return false;
        return /^(?:blob|data):/.test(mediaEl.currentSrc || mediaEl.src || '') && !/^(?:blob|data):/.test(view.url);
    }

    function openBytesPop(x, y) {
        closePops();
        bytesPopEl.classList.add('open');
        const p = bytesPopEl.getBoundingClientRect();
        bytesPopEl.style.left = Math.round(Math.max(4, Math.min(x, vpW() - 4 - p.width))) + 'px';
        bytesPopEl.style.top = Math.round(Math.max(4, Math.min(y, vpH() - 4 - p.height))) + 'px';
    }

    const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
        'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm' };

    // ---- save names (pure)
    const NAME_TOKENS = ['site', 'page_title', 'full_title', 'host', 'page_id', 'orig_name', 'name', 'num',
        'date', 'time', 'year', 'month', 'day', 'hh', 'mm', 'ss'];
    const MEANINGLESS_RE = /^(?:image|img|photo|pic|picture|large|big|original|orig|full|fullsize|download|file|index|untitled|default|thumb|media|preview|view|max|hd)?[\d\W_]*$/i;

    // A file stem that says nothing about its picture: 0001, 12, image, img_3, large.
    function meaninglessName(stem) {
        const s = String(stem || '');
        return !s || MEANINGLESS_RE.test(s) || s.replace(/[\d\W_]+/g, '').length < 2;
    }

    // A page title split into the site's name and the page's own: "Red panda - Wikipedia" -> {site, title}.
    function titleParts(title, siteHint, host) {
        const full = String(title || '').replace(/\s+/g, ' ').trim();
        const hp = String(host || '').toLowerCase().split('.').filter(Boolean);
        if (hp.length > 1) hp.pop();
        if (hp.length > 1 && /^(co|com|net|org|ac|gov|edu|ne|or)$/.test(hp[hp.length - 1])) hp.pop();
        const label = hp.length ? hp[hp.length - 1] : '';
        const squash = function (x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
        const segs = full.split(/\s+[-|–—•·»:]\s+/);
        let site = String(siteHint || '').trim(), page = full;
        const isSite = function (seg) {
            const q = squash(seg);
            return !!q && ((site && q === squash(site)) || (label && (q === squash(label) || q.indexOf(squash(label)) === 0 && q.length <= squash(label).length + 4)));
        };
        if (segs.length > 1) {
            if (isSite(segs[segs.length - 1])) { if (!site) site = segs[segs.length - 1]; page = segs.slice(0, -1).join(' - '); }
            else if (isSite(segs[0])) { if (!site) site = segs[0]; page = segs.slice(1).join(' - '); }
        }
        if (!site) site = label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
        if (squash(page) === squash(site)) page = '';
        return { site: site, title: page, full: full };
    }

    // The longest run of digits in a page address's path, else a 5-character code of the address.
    function pageIdOf(href) {
        let path = String(href || '');
        try { const u = new URL(href); path = u.pathname + u.search; } catch (e) { /* the raw text */ }
        const runs = path.match(/\d{2,}/g) || [];
        if (runs.length) return runs.sort(function (a, b) { return b.length - a.length; })[0];
        let h = 2166136261;
        for (let i = 0; i < String(href).length; i++) { h ^= String(href).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return h.toString(36).slice(0, 5);
    }

    // The template with every [token] filled; ### stays for the counter. Empty brackets and dangling separators go.
    function fillNameTemplate(tpl, v) {
        const d = v.now || new Date(), two = function (n) { return String(n).padStart(2, '0'); };
        const val = {
            site: v.site, page_title: v.title, full_title: v.full, host: v.host, page_id: v.pageId,
            orig_name: v.name, name: v.name, num: v.num,
            date: d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()),
            time: two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()),
            year: String(d.getFullYear()), month: two(d.getMonth() + 1), day: two(d.getDate()),
            hh: two(d.getHours()), mm: two(d.getMinutes()), ss: two(d.getSeconds()),
        };
        let out = String(tpl || '').replace(/\[([a-z_]+)\]/gi, function (m, k) {
            k = k.toLowerCase();
            return NAME_TOKENS.indexOf(k) >= 0 ? String(val[k] || '') : m;
        });
        out = out.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ');
        for (let i = 0; i < 3; i++) {
            out = out.replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, '')
                .replace(/\s*([-_.,])(?:\s*[-_.,])+\s*/g, function (m, c) { return /\s/.test(m) ? ' ' + c + ' ' : c; })
                .replace(/\s{2,}/g, ' ');
        }
        return out.replace(/^[\s\-_.,]+|[\s\-_.,]+$/g, '').slice(0, 150).trim();
    }
    // ---- save names end

    const PAGE_INFO_MAX = 200;
    const pageInfos = new Map();        // page address -> {title, site}: the pages pictures came from

    function keepPageInfo(href, title, siteHint) {
        if (!href || !title) return;
        const k = String(href).split('#')[0];
        pageInfos.delete(k);
        pageInfos.set(k, { title: String(title), site: siteHint || '' });
        if (pageInfos.size > PAGE_INFO_MAX) pageInfos.delete(pageInfos.keys().next().value);
    }

    function siteNameOf(doc) {
        try {
            const m = doc.querySelector('meta[property="og:site_name"],meta[name="application-name"],meta[name="apple-mobile-web-app-title"]');
            return m ? String(m.getAttribute('content') || '').trim() : '';
        } catch (e) { return ''; }
    }

    function keepDocInfo(href, doc) {
        try { keepPageInfo(href, doc.title, siteNameOf(doc)); } catch (e) { /* no title */ }
    }

    // Which page a picture came from: a gallery thumbnail's linked page, a harvested page, else this one.
    function savePage(el) {
        if (el && galOwns(el) && galCur) return galCur.href;
        const b = el ? baseOf(el) : location.href;
        return String(b || location.href).split('#')[0];
    }

    // A file name the manager will accept: it refuses names without a whitelisted extension.
    function saveName(url, page, ext) {
        let name = String(fileInfo(url).name || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^[._]+/, '').slice(0, 120) || 'image';
        const m = name.match(/\.([a-z0-9]{2,5})$/i);
        let stem = m ? name.slice(0, -m[0].length) : name;
        ext = ext || (m ? m[1] : MIME_EXT[bytesMime.get(url)] || 'jpg');
        if (cfg.saveRename === 'always' || (cfg.saveRename === 'meaningless' && meaninglessName(stem))) {
            const renamed = templateName(page || location.href, stem);
            if (renamed) stem = renamed;
        }
        return stem + '.' + ext;
    }

    function templateName(page, stem) {
        const here = page === location.href.split('#')[0];
        const info = here ? { title: document.title, site: siteNameOf(document) } : (pageInfos.get(page) || { title: '', site: '' });
        let host = '';
        try { host = new URL(page).hostname.replace(/^www\./, ''); } catch (e) { /* none */ }
        const tp = titleParts(info.title, info.site, host);
        const nums = String(stem).match(/\d+/g);
        let out = fillNameTemplate(cfg.saveNameTemplate, {
            site: tp.site, title: tp.title, full: tp.full, host: host, pageId: pageIdOf(page),
            name: stem, num: nums ? nums[nums.length - 1] : '',
        });
        if (/#/.test(out)) out = out.replace(/#+/, function (h) { return String(saveCount(out)).padStart(h.length, '0'); });
        return out.replace(/#+/g, '');
    }

    // The next number for a name, remembered across visits so a later save never repeats one.
    function saveCount(key) {
        let all = {};
        try { all = JSON.parse(GM_getValue('hoverZoomSaveCounts', '') || '{}') || {}; } catch (e) { /* fresh */ }
        const n = (all[key] || 0) + 1;
        delete all[key];
        all[key] = n;
        const keys = Object.keys(all);
        for (let i = 0; i < keys.length - 500; i++) delete all[keys[i]];
        try { GM_setValue('hoverZoomSaveCounts', JSON.stringify(all)); } catch (e) { /* this name only */ }
        return n;
    }

    // ---- converting on save: the file's own bytes decide its format, never its name
    const SAVE_FETCH_MS = 120000;
    const CONVERT_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

    function convertWanted(fmt) {
        if (!fmt || cfg.saveConvert === 'off' || fmt.animated || fmt.fmt === cfg.saveConvert) return false;
        if (cfg.saveConvertFrom === 'modern') return ['avif', 'webp', 'jxl'].indexOf(fmt.fmt) >= 0;
        return fmt.fmt === 'avif';
    }

    function fetchForSave(url) {
        return new Promise(function (res) {
            let settled = false;
            const fin = function (v) { if (!settled) { settled = true; res(v); } };
            setTimeout(function () { fin(null); }, SAVE_FETCH_MS);
            try {
                GM_xmlhttpRequest({
                    method: 'GET', url: url, responseType: 'arraybuffer', timeout: SAVE_FETCH_MS,
                    onload: function (r) { fin(r.status && (r.status < 200 || r.status >= 300) ? null : r.response || null); },
                    onerror: function () { fin(null); },
                    ontimeout: function () { fin(null); },
                });
            } catch (e) { fin(null); }
        });
    }

    // The bytes decoded and re-encoded as cfg.saveConvert; null when the browser cannot decode them.
    async function convertBytes(buf, fmt) {
        try {
            const bmp = await createImageBitmap(new Blob([buf], { type: 'image/' + fmt.fmt }));
            const c = document.createElement('canvas');
            c.width = bmp.width;
            c.height = bmp.height;
            const g = c.getContext('2d');
            if (cfg.saveConvert === 'jpg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }   // JPEG has no transparency
            g.drawImage(bmp, 0, 0);
            if (bmp.close) bmp.close();
            const mime = CONVERT_MIME[cfg.saveConvert];
            const out = await new Promise(function (r) { c.toBlob(r, mime, Math.max(0.1, Math.min(1, cfg.saveJpegQuality / 100))); });
            c.width = c.height = 0;
            return out && out.type === mime ? out : null;
        } catch (e) {
            dbg('converting for save failed', String(e));
            return null;
        }
    }

    // A converted file to the download folder: the manager's download, else a plain link download.
    function saveBlob(blob, name, quiet, done, url, page) {
        const obj = URL.createObjectURL(blob);
        const viaLink = function () {
            try {
                const a = document.createElement('a');
                a.href = obj;
                a.download = name;
                a.style.display = 'none';
                document.documentElement.appendChild(a);
                a.click();
                a.remove();
                if (done) done();
            } catch (e) { dbg('saving the converted file failed', String(e)); saveAsServed(url, quiet, done, page); }
            setTimeout(function () { URL.revokeObjectURL(obj); }, 60000);
        };
        try {
            GM_download({ url: obj, name: name, saveAs: !quiet,
                onload: function () { setTimeout(function () { URL.revokeObjectURL(obj); }, 60000); if (done) done(); },
                onerror: function (r) { dbg('manager refused the converted file', { error: r && r.error }); if (!(r && r.error === 'not_succeeded')) viaLink(); } });
        } catch (e) { viaLink(); }
    }

    // Saving: converted when the setting covers the file's real format, else exactly as served.
    async function saveOriginal(url, quiet, done, page) {
        if (cfg.saveConvert === 'off' || typeof GM_xmlhttpRequest !== 'function' || /^(data|blob):/.test(url)) { saveAsServed(url, quiet, done, page); return; }
        toast('Saving…', 60000);
        const buf = await fetchForSave(url);
        const fmt = buf ? sniffFormat(new Uint8Array(buf, 0, Math.min(4096, buf.byteLength))) : null;
        if (!convertWanted(fmt)) { hideTip(); saveAsServed(url, quiet, done, page); return; }
        toast('Converting ' + fmt.fmt.toUpperCase() + ' to ' + cfg.saveConvert.toUpperCase() + '…', 60000);
        const out = await convertBytes(buf, fmt);
        if (!out) { toast('Could not convert this ' + fmt.fmt.toUpperCase() + '; saved as it is', 3000); saveAsServed(url, quiet, done, page); return; }
        hideTip();
        saveBlob(out, saveName(url, page, cfg.saveConvert), quiet, done, url, page);
    }

    function saveAsServed(url, quiet, done, page) {
        if (typeof GM_download !== 'function') { openOriginal(url); return; }
        try {
            GM_download({ url: url, name: saveName(url, page), saveAs: !quiet,
                onload: function () { if (done) done(); },
                onerror: function (r) {
                    const why = r && r.error;
                    dbg('saving the original failed', { url: url, error: why, details: r && r.details });
                    if (why && why !== 'not_succeeded') openOriginal(url);   // refused outright: save it from the tab
                } });
        } catch (e) { dbg('saving the original threw', String(e)); openOriginal(url); }
    }

    function openOriginal(url) {
        try {
            if (typeof GM_openInTab === 'function') { GM_openInTab(url, { active: true, insert: true, setParent: true }); return; }
        } catch (e) { dbg('opening the original threw', String(e)); }
        window.open(url, '_blank', 'noopener');
    }

    function copyOriginal(url) {
        try {
            navigator.clipboard.writeText(url).catch(function (e) { dbg('copying the address failed', String(e)); });
        } catch (e) { dbg('copying the address threw', String(e)); }
    }

    // ---- teaching where the original lives, from the bar's find button. See RESOLVER.md "Taught patterns".

    function buildTeachPop() {
        const d = document.createElement('div');
        d.className = 'pop teachpop';
        d.addEventListener('mousedown', function (e) {
            const t = e.composedPath ? e.composedPath()[0] : e.target;
            if (!t || t.tagName !== 'INPUT') e.preventDefault();      // the field must still take focus
            e.stopPropagation();
        }, true);
        popHead(d, 'Where is the full-size picture?',
            ' Open it in another tab — click through to it, or right-click it and choose “Open image in ' +
            'new tab” — then copy its address and paste it here, or drag the picture onto this box. ' +
            'Hover Zoom will look for other pictures on this site the same way.');
        const field = document.createElement('div');
        field.className = 'field';
        teachInEl = document.createElement('input');
        teachInEl.type = 'text';
        teachInEl.spellcheck = false;
        teachInEl.placeholder = 'Paste the picture’s address';
        teachInEl.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); teachSubmit(); }
            else if (e.key === 'Escape') { e.preventDefault(); closePops(); layout(); }
        });
        teachInEl.addEventListener('dragover', function (e) { e.preventDefault(); });
        teachInEl.addEventListener('drop', function (e) {
            const dt = e.dataTransfer;
            const v = dt && ((dt.getData('text/uri-list') || '').split(/\r?\n/).filter(function (l) { return l && l[0] !== '#'; })[0] ||
                dt.getData('text/plain'));
            if (!v) return;
            e.preventDefault();
            teachInEl.value = v.trim();
            teachSubmit();
        });
        field.appendChild(teachInEl);
        d.appendChild(field);
        teachMsgEl = document.createElement('div');
        teachMsgEl.className = 'msg';
        d.appendChild(teachMsgEl);
        const acts = document.createElement('div');
        acts.className = 'acts';
        teachNoEl = document.createElement('button');
        teachNoEl.textContent = 'Cancel';
        teachNoEl.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation(); closePops(); layout();
        }, true);
        teachGoEl = document.createElement('button');
        teachGoEl.className = 'ok';
        teachGoEl.textContent = 'Use it';
        teachGoEl.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation(); teachSubmit();
        }, true);
        acts.appendChild(teachNoEl);
        acts.appendChild(teachGoEl);
        d.appendChild(acts);
        return d;
    }

    function teachSay(text, kind) {
        teachMsgEl.textContent = text;
        teachMsgEl.className = 'msg' + (kind ? ' ' + kind : '');
        placePop();
    }

    function openTeach() {
        const wasOpen = isOpen(teachPopEl);
        togglePop(teachPopEl);
        if (wasOpen) { layout(); return; }
        teachInEl.value = '';
        teachInEl.parentNode.hidden = false;
        teachGoEl.hidden = false;
        teachNoEl.textContent = 'Cancel';
        teachSay('');
        teachInEl.focus();
    }

    // Load what the user pointed at; if it is the bigger picture, show it and keep the pattern for this host.
    async function teachSubmit() {
        const thumb = activeShown, at = view, raw = teachInEl.value.trim();
        if (!thumb || !view || !raw) return;
        let u;
        try { u = new URL(raw); } catch (e) { u = null; }
        if (!u || !/^https?:$/.test(u.protocol)) { teachSay('That is not a web address.', 'bad'); return; }
        teachSay('Checking…');
        const dim = await probe(u.href, true);
        if (view !== at || activeShown !== thumb) return;
        if (!dim) {
            teachSay('That address did not open as a picture. Copy the address of the picture itself — ' +
                'right-click it and choose “Open image in new tab” — not the page it is on.', 'bad');
            return;
        }
        if (dim.w * dim.h <= view.natW * view.natH) {
            teachSay('That picture is ' + dim.w + ' × ' + dim.h + ', no bigger than this one.', 'bad');
            return;
        }
        const rule = taughtRuleFrom(thumb, u.href);
        let host = '';
        try { host = new URL(thumb).hostname; } catch (e) { /* none */ }
        if (rule && host) {
            reloadSettings();
            rule.made = new Date().toISOString().slice(0, 10);
            const all = Object.assign({}, cfg.taughtRules);
            all[host] = (all[host] || []).filter(function (r) { return r.re !== rule.re; }).concat([rule]);
            cfg.taughtRules = all;
            saveSettings();
            probeCache.clear();
            plReset();                  // buffered answers predate the pattern
            refreshPanel();
            dbg('taught a pattern', { host: host, rule: rule, thumb: thumb, original: u.href });
        }
        upgradeViewer({ url: u.href, w: dim.w, h: dim.h, video: !!dim.video, duration: dim.duration, display: dim.display });
        teachInEl.parentNode.hidden = true;
        teachGoEl.hidden = true;
        teachNoEl.textContent = 'Close';
        teachSay(!rule || rule.one
            ? 'Found it. This address has nothing in common with the small one, so Hover Zoom can only ' +
              'remember it for this picture.'
            : 'Found it. Other pictures from ' + host + ' will be looked for the same way. The pattern is ' +
              'listed under Per-site fixes in settings, where it can be removed.', 'good');
    }

    // ---- smoothing: a stored setting, toggled from the frame instead of the panel

    function smoothingMode() {
        return cfg.smoothing === 'pixelated' ? 'pixelated' : 'auto';
    }

    function applySmoothing() {
        const v = smoothingMode();
        if (imgEl) imgEl.style.imageRendering = v;
        if (vidEl) vidEl.style.imageRendering = v;
    }

    // Two answers, so the button IS the choice — no menu to open and nothing to preview.
    function markSmoothing() {
        if (!aaEl) return;
        const sharp = smoothingMode() === 'pixelated';
        aaEl.classList.toggle('sharp', sharp);
        setTip(aaEl, sharp ? 'Sharp pixels' : 'Smooth pixels');
    }

    function toggleSmoothing() {
        reloadSettings();               // this writes the whole object back
        cfg.smoothing = smoothingMode() === 'pixelated' ? 'auto' : 'pixelated';
        saveSettings();
        applySmoothing();
        markSmoothing();
        dbg('smoothing', cfg.smoothing);
    }

    // "Stop showing clips in this tab", from the ▶ in the status bar.
    function stopVideoPreviews() {
        playVideos = false;
        dbg('video previews off for this tab');
        probeCache.clear();
        dismiss();
    }

    // Never take a key from a field the user is typing in.
    function typingIn(e) {
        const t = e && e.composedPath ? e.composedPath()[0] : (e && e.target);
        if (!t || !t.tagName) return false;
        return !!t.isContentEditable ||
            t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
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
        plReset();                  // buffered answers may have been reached through this URL
        refreshPanel();             // the Exceptions list is on screen behind this window
        // Mid-tour, blocking is "not this one" — it moves on rather than tearing the window down.
        if (tourActive()) { tourNav(scrubDir, false); return; }
        dismiss();
    }

    // Placing happens on the PRESS, so by the time a click arrives the window is already placed and there is nothing left f...
    function onBoxClick(e) {
        if (isBoxControl(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
    }

    // A click on the picture of an already-pinned window: once pauses a clip, twice fills the
    // screen. The pair arrives as two clicks with `detail` 1 then 2 — there is no dblclick
    // listener, so click 2 undoes the pause click 1 just made.
    function boxTap(e) {
        if (!tap || !tap.mid || !view || !placed) return;
        if (e.detail === 1) {
            if (mediaEl === vidEl && vidEl) { togglePlay(); tapPaused = true; }
            return;
        }
        if (e.detail !== 2) return;
        if (tapPaused) { togglePlay(); tapPaused = false; }
        toggleFull();
    }

    function onBoxDown(e) {
        hideTip();
        commitZoomField(e);
        tap = null;
        if (e.detail <= 1) tapPaused = false;
        if (isBoxControl(e.target)) return;
        closePops();                // a press anywhere else puts an open menu away
        if (e.button !== 0 && e.button !== 2) return;

        if (placed) {
            if (e.button !== 0) return;
        } else if (e.button !== 0) {
            altButton(e);           // the other button dismisses a hover preview
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        if (!view) return;
        swallowNextClick = true;    // the click half of this press is ours too
        const wasPlaced = placed;
        if (!placed) place();

        const reg = hitRegion(e.clientX, e.clientY);
        const onBar = capEl.contains(e.target) && !(reg && reg.kind === 'resize');
        // The picture itself: not a grab band, not the bar, not a control, and not the press
        // that pinned the window. boxTap() acts on it if the pointer never moved.
        tap = { x: e.clientX, y: e.clientY,
                mid: wasPlaced && e.button === 0 && !reg && !onBar };
        if (reg && reg.kind === 'resize') {
            drag = {
                mode: 'resize', ex: reg.ex, ey: reg.ey,
                x0: e.clientX, y0: e.clientY,
                w0: view.frameW, h0: view.frameH, l0: view.left, t0: view.top,
                aspect: view.frameH ? view.frameW / view.frameH : 1,
                spilling: pannable(),
                refit: !pannable() && Math.abs(view.scale - view.fitScale) < 1e-6,
            };
        } else if (fullActive()) {
            // Nailed to the screen. Panning a picture that spills is the only drag left — a move
            // would slide the window off its own black backdrop.
            if (pannable()) drag = { x: e.clientX, y: e.clientY, mode: 'pan' };
        } else {
            const mode = onBar || !pannable() ? 'move' : 'pan';
            drag = { x: e.clientX, y: e.clientY, mode: mode };
        }
        if (drag) box.classList.add('drag');
        applyCursor();
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
        w = Math.max(Math.min(minFrameW(), g.w), Math.min(w, g.w));
        h = Math.max(Math.min(MIN_FRAME, g.h), Math.min(h, g.h));
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

    // The zoom field is a text box and the slider answers the arrows: while either has the focus,
    // the window's own keys are not the window's.
    const SLIDER_KEYS = {
        ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1,
        Home: 1, End: 1, PageUp: 1, PageDown: 1,
    };

    function capOwns(e) {
        if (!e || !e.composedPath) return false;
        const path = e.composedPath();
        if (zinEl && !zinEl.hidden && path.indexOf(zinEl) !== -1) return true;
        if (rateInEl && rateMenuOpen() && path.indexOf(rateInEl) !== -1) return true;
        if (teachInEl && isOpen(teachPopEl) && path.indexOf(teachInEl) !== -1) return true;
        if (!SLIDER_KEYS[e.key]) return false;
        // The scrubber answers the arrows exactly as the zoom slider does.
        return (!!zsliderEl && path.indexOf(zsliderEl) !== -1) ||
               (!!vseekEl && path.indexOf(vseekEl) !== -1) ||
               (!!vvolInEl && path.indexOf(vvolInEl) !== -1);
    }

    function onPinKey(e) {
        if (!placed || !view) return;
        if (!e.repeat && !/^(Shift|Control|Alt|Meta)$/.test(e.key)) lastUserAct = Date.now();
        if (panelOwns(e)) return;
        if (capOwns(e)) {
            // Escape and Enter never reach the field: onPinKey is capture on `window`, and the
            // document-level Escape below it would cancel the whole preview.
            if (zinEl && !zinEl.hidden && (e.key === 'Escape' || e.key === 'Enter')) {
                closeZoomField(e.key === 'Enter');
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }
        // The panel is the window on top, so Escape is ITS exit before it is this one's —
        // wherever the focus happens to be. One press must not close both.
        if (e.key === 'Escape' && panelHost) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;   // leave browser/page chords alone
        if (e.key === 'Escape' && isOpen(bytesPopEl)) { closePops(); e.preventDefault(); e.stopPropagation(); return; }
        // Fullscreen is the layer above the pin, so Escape leaves it first. The browser eats the
        // key itself when the API is what put us there; this covers the maximise fallback.
        if (e.key === 'Escape' && fullActive()) {
            toggleFull();
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        const step = e.shiftKey ? cfg.panStep * 3 : cfg.panStep;
        let handled = true;
        switch (e.key) {
            case 'Escape': unplace(); break;
            case ' ': if (mediaEl === vidEl) togglePlay(); else handled = false; break;
            case 'f': case 'F': toggleFull(); break;
            case 'm': case 'M': if (mediaEl === vidEl) toggleMute(); else handled = false; break;
            // Left/Right step through the page's pictures unless the picture itself can pan
            // sideways. Up/Down always pan. See TOUR.md §5.
            case 'ArrowLeft':
                if (tourOwnsArrows()) tourNav(-1, e.repeat, true); else panBy(step, 0); break;
            case 'ArrowRight':
                if (tourOwnsArrows()) tourNav(1, e.repeat, true); else panBy(-step, 0); break;
            case 'ArrowUp': panBy(0, step); break;
            case 'ArrowDown': panBy(0, -step); break;
            // The always-navigates pair, or zooming in traps you on the current picture.
            case '[': tourNav(-1, e.repeat, true); break;
            case ']': tourNav(1, e.repeat, true); break;
            // The tour's area: one level of the page narrower or wider. See TOUR.md §1a.
            case '{': if (!e.repeat) tourRescope(-1); break;
            case '}': if (!e.repeat) tourRescope(1); break;
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
    let activeSmall = false; // it is an avatar under smallBelow: shown only when big, never over it
    let activeShown = null; // what that element was displaying — the second URL ⊘ blocks
    let token = null;       // cancellation token for the in-flight resolve
    let timer = null;
    let drag = null;        // { mode:'pan'|'move'|'resize', … } while a button is held
    const TAP_SLOP = 4;     // px of pointer travel a click is allowed before it counts as a drag
    let tap = null;         // the last press, while it could still turn out to be a plain click
    let tapPaused = false;  // did click 1 of a double-click toggle playback, to be undone by click 2
    let swallowNextClick = false;
    let suppressed = null;  // element whose preview was dismissed; skipped until re-entered
    let activeCovered = false;
    let suppressedCovered = false;
    let hoverAt = 0;            // when the current hover began
    let activeRect = null;      // where the picture was then; a player landing inside it is a late one
    let activeChain = '';       // domChain() taken then — a player landing later changes the answer
    let activePath = '/';
    let holdMs = 0;             // the wait this hover is under: the site's learned one, or the grace
    let ruleMs = 0;             // the learned part alone; 0 when no rule applied to this hover
    let holding = false;        // still inside that wait
    let holdTimer = null;
    let watchTimer = null;      // the poll for a player under the picture
    let midSaveAt = 0;          // when the last middle-click save happened; its click is ours
    let swallowMenuAt = 0;      // when the right press that dismissed a preview happened; its menu is ours
    const MENU_CLAIM_MS = 1500; // and only that long, or a press released off-window eats the next menu
    let pointer = { x: 0, y: 0 };
    let mouseDown = false;
    let lastUserAct = 0;            // the last press or key; a close soon after is the user's doing
    const USER_QUIET_MS = 2500;
    let modifierDown = false;
    let hotTap = false;         // the hotkey is down and nothing else has happened since: a tap if it comes up
    let hotLast = { t: 0, x: 0, y: 0 };    // 'modifier': the last press, for a quick second one
    let hotQuiet = false;       // 'modifier': this press closed a pinned window; it shows nothing until up
    const HOT_DOUBLE_MS = 450;
    let releasedOn = null;      // 'modifier': the picture whose preview the hotkey's release closed
    let pinOnShow = null;       // ...pressed again over it: pinned the moment it paints
    let hzOff = false;          // toggled off by the hotkey, for this tab
    let pressHeld = false;      // any button down, ours or the page's: the hotkey belongs to the drag

    const OFF_KEY = 'hoverZoomOff';
    try {
        if (typeof GM_getTab === 'function') GM_getTab(function (t) { hzOff = !!(t && t[OFF_KEY]); });
        else hzOff = sessionStorage.getItem(OFF_KEY) === '1';
    } catch (e) { /* no tab storage: previews start on */ }

    // A tap of the hotkey in toggle mode: previews off for this tab, or back on.
    function setOff(on) {
        hzOff = on;
        try {
            if (typeof GM_getTab === 'function') {
                GM_getTab(function (t) { t = t || {}; t[OFF_KEY] = on; GM_saveTab(t); });
            } else sessionStorage.setItem(OFF_KEY, on ? '1' : '0');
        } catch (e) { /* the switch still holds for this page */ }
        if (on && view) dismiss();
        toast(on ? 'Previews off in this tab — tap ' + hotkeyName() + ' to turn them back on'
                 : 'Previews on');
        dbg('previews toggled by the hotkey', { off: on });
    }

    function hotkeyName() { return { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' }[cfg.modifierKey] || 'the hotkey'; }

    function isHotkey(e) {
        return e.key === ({ ctrl: 'Control', alt: 'Alt', shift: 'Shift' }[cfg.modifierKey]);
    }

    // A short note by the pointer; gone by itself.
    let toastTimer = 0;
    function toast(text, ms) {
        hideTip();
        const t = tipBox();
        t.__text.textContent = text;    // the host has a shadow root: its own text would never draw
        t.style.cssText = 'all:initial;display:block;position:fixed;left:0;top:0;width:max-content;max-width:320px;margin:0;padding:0;border:0;' +
            'background:none;overflow:visible;z-index:2147483647;pointer-events:none';
        document.documentElement.appendChild(t);
        try { t.showPopover(); } catch (e) { /* no popover API */ }
        const b = t.getBoundingClientRect();
        t.style.left = Math.max(4, Math.min(vpW() - 4 - b.width, pointer.x + 14)) + 'px';
        t.style.top = Math.max(4, Math.min(vpH() - 4 - b.height, pointer.y + 18)) + 'px';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideTip, ms || 1800);
    }

    // A hover preview cannot be hit-tested, so "is the pointer on it" is answered from `view` instead.
    // A hover preview is pinned by pressing it — and when it opened somewhere the pointer is not, by
    // pressing the picture that produced it. Any mode: a remembered spot can be anywhere. See E30.
    function pressPinsPreview(e) {
        if (!view || !box || !box.classList.contains('on')) return false;
        if (pointInPreview(e.clientX, e.clientY)) return true;
        if (!active || activeSmall) return false;
        // composedPath: a gallery cell is inside our shadow root, so e.target is only its host. See G5.
        const t = (e.composedPath && e.composedPath()[0]) || e.target;
        if (t === active || (active.contains && active.contains(t))) return true;
        // The site's card over the picture (nsfw.xxx's div.post): a press inside the picture still pins.
        if (!t || t.nodeType !== 1 || ours(t) || !active.getBoundingClientRect || !holds(active.getBoundingClientRect(), e.clientX, e.clientY)) return false;
        return t.contains(active) || coveredMedia(t, e.clientX, e.clientY) === active;
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
        if (tw && node === tw.host) return true;
        if (galTopHost && node === galTopHost) return true;
        return !!host && (node === host || (host.contains && host.contains(node)));
    }

    const PASS_CONTROL = 'button,input,select,textarea,summary,label,[contenteditable=""],[contenteditable="true"],' +
        '[role="button"],[role="checkbox"],[role="switch"],[role="tab"],[role="menuitem"],[role="radio"],' +
        '[role="slider"],[role="combobox"],[role="option"]';

    function closestComposed(el, sel) {
        while (el) {
            const hit = el.closest ? el.closest(sel) : null;
            if (hit) return hit;
            const r = el.getRootNode ? el.getRootNode() : null;
            el = r && r.host ? r.host : null;
        }
        return null;
    }

    // What the page has at a point, under our own layers, inside any open shadow root.
    function pageElAt(x, y) {
        const hits = document.elementsFromPoint(x, y);
        let el = null;
        for (let i = 0; i < hits.length; i++) if (!ours(hits[i])) { el = hits[i]; break; }
        while (el && el.shadowRoot) {
            const inner = el.shadowRoot.elementFromPoint(x, y);
            if (!inner || inner === el) break;
            el = inner;
        }
        return el;
    }

    // A control the press was meant for — a button, a field, another userscript's widget — not a link or picture.
    function pageControlAt(x, y) {
        const el = pageElAt(x, y);
        if (!el) return false;
        if (closestComposed(el, '[data-us-dock]')) return true;
        if (closestComposed(el, 'a[href],img,video,picture,svg image')) return false;
        return !!closestComposed(el, PASS_CONTROL);
    }

    // Over a page control, the backdrop lets the press through; the press then closes the window. See E70.
    function thruSync(x, y) {
        if (!dimEl) return;
        const on = placed && !drag && !dimEl.classList.contains('full') && !pointInPreview(x, y) && pageControlAt(x, y);
        dimEl.classList.toggle('thru', on);
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

    // Which gifLike() clause refused this <video>. Debug line only.
    function notGifBecause(v) {
        if (v.controls || v.hasAttribute('controls')) return 'it has controls';
        if (!v.muted) return 'it is not muted';
        if (!(v.loop || v.autoplay)) return 'neither loop nor autoplay is set';
        const d = v.duration;
        if (!isFinite(d) || d <= 0) return 'its duration is unknown (' + d + ')';
        return 'it runs ' + Math.round(d) + 's, over the ' + GIF_MAX_SECS + 's clip limit';
    }

    function secsOf(v) {
        const d = v.duration;
        return isFinite(d) && d > 0 ? Math.round(d) + 's' : 'length unknown';
    }

    // The first non-gif <video> inside `n`, or null.
    // A player the page holds but has not laid out; a laid-out one is beside the picture or over it, and geometry says which.
    function playerIn(n) {
        if (!n || !n.querySelectorAll) return null;
        const vs = n.querySelectorAll('video');
        for (let i = 0; i < vs.length; i++) {
            if (gifLike(vs[i])) continue;
            const r = vs[i].getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return vs[i];
        }
        return null;
    }

    // One read pass over the page (a step's list, the widget's count): shared answers, dropped when it returns.
    let passMemo = null;
    function inPass(fn) {
        if (passMemo) return fn();
        passMemo = { rects: new Map(), surfaces: null };
        try { return fn(); } finally { passMemo = null; }
    }

    function passRect(el) {
        if (!passMemo) return el.getBoundingClientRect();
        let r = passMemo.rects.get(el);
        if (!r) { r = el.getBoundingClientRect(); passMemo.rects.set(el, r); }
        return r;
    }

    function videoSurfaces() {
        if (passMemo && passMemo.surfaces) return passMemo.surfaces;
        const out = [];
        if (passMemo) passMemo.surfaces = out;
        const vids = document.getElementsByTagName('video');
        for (let i = 0; i < vids.length; i++) {
            const v = vids[i].getBoundingClientRect();
            if (v.width < 2 || v.height < 2) continue;   // not laid out; contains nothing
            if (gifLike(vids[i])) {
                out.push({ what: 'clip, ' + secsOf(vids[i]), rect: v, gif: true, el: vids[i] });
                continue;
            }
            out.push({ what: 'player — ' + notGifBecause(vids[i]), rect: v, el: vids[i] });
            const area = v.width * v.height;
            let n = vids[i].parentElement;
            for (let up = 0; n && up < PLAYER_UP; up++, n = n.parentElement) {
                const r = n.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) continue;
                if (area < r.width * r.height * PLAYER_FILL) break;   // too big to be this video's player
                if (r.width < v.width - 1 || r.height < v.height - 1) continue;
                out.push({ what: 'player box', rect: r, el: vids[i] });
            }
        }
        return out;
    }

    function holds(rect, cx, cy) {
        return cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
    }

    // What laid-out <video> covers the picture's centre: '' when none. A clip counts unless it IS
    // the hovered media — over another picture it is the page's own preview, however short. See E12.
    function overVideoSurface(el) {
        const surfaces = videoSurfaces();
        if (!surfaces.length) return '';
        const r = passRect(el);
        if (!r.width || !r.height) return '';
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        for (let i = 0; i < surfaces.length; i++) {
            const s = surfaces[i];
            if (s.gif && (s.el === el || s.el.contains(el))) continue;
            if (holds(s.rect, cx, cy)) return s.what;
        }
        return '';
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

    // Returns WHY a real player on THIS page covers this element, or null.
    function playerSurfaceReason(el) {
        const own = el.closest && el.closest('video');
        if (own && own !== el && !gifLike(own)) return 'inside a <video>';
        const over = overVideoSurface(el);
        if (over) return 'over a laid-out <video> rectangle (' + over + ')';
        let n = el;
        for (let up = 0; n && up < 4; up++, n = n.parentElement) {
            if (up > 0 && n.querySelectorAll && n.querySelectorAll('img').length > 1) break;
            if (playerIn(n)) return 'dormant <video> in ancestor #' + up;
        }
        return null;
    }

    // Returns WHY this element leads AWAY to a video page, or null.
    function videoLinkReason(el) {
        const a = closestAcross(el, 'a[href]');
        const href = a ? (a.getAttribute('href') || '') : '';
        if (href && VIDEO_LINK_RE.test(href)) return 'video link: ' + href;
        return null;
    }

    // A <video> the page holds but has not laid out: an inline preview waiting for a hover.
    function dormantPlayer() {
        const vids = document.getElementsByTagName('video');
        for (let i = 0; i < vids.length; i++) {
            const r = vids[i].getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return true;
        }
        return false;
    }

    // Even under 'all', a video-link thumbnail is the SITE's to preview when its player will land on
    // it: the page holds a dormant one now, or thumbnails shaped like this have had one land. See E61.
    function videoLinkRefused(el) {
        const why = videoLinkReason(el);
        if (!why) return null;
        if (cfg.videoMode !== 'all') return why;
        if (dormantPlayer()) return why + ' — and this page holds a dormant player';
        return areaRule('ownPlayerAreas', domChain(el), pagePath()) ? why + ' — the site\'s own player has landed on thumbnails like this' : null;
    }

    const LINK_RECHECK = 0.1;       // share of hovers in a skip area that fetch the linked page anyway

    // A thumbnail in a learned door area: it leads to a page of other pictures, so it is the page's link, not a preview. See P17.
    function doorReason(el) {
        const e = (cfg.doorAreas || {})[pageHost()];
        if (!e || !e.rules || !e.rules.length || el.ownerDocument !== document) return null;
        if (skipLinkedPage(el) || !linkTarget(el)) return null;
        const r = vdRuleFor(e, domChain(el), pagePath());
        return r ? 'it leads to a page of other pictures, as thumbnails like it here have (' + r.dom + ' on ' + r.path + ')' : null;
    }

    // A hover's door verdict into doorAreas; a rule appearing or going recounts the widget.
    function doorLearn(verdict, chain, path, id) {
        if (!verdict) return;
        const c = verdict === 'leaf' ? areaApply('doorAreas', areaDrop, chain, path)
            : areaApply('doorAreas', areaLearn, chain, path, id);
        if (c && c !== 'sampled' && c !== 'used' && c !== 'confirmed') { setTimeout(twRecount, 0); if (isTopFrame) setTimeout(galMarkSoon, 0); }
    }

    let doorCheckEl = null;

    // A refused door hover: stamp its area, and on a LINK_RECHECK share check it silently against the linked page.
    function doorHover(el, x, y) {
        galDoorHover(el, x, y);
        if (doorCheckEl === el) return;
        const chain = domChain(el), path = pagePath();
        areaApply('doorAreas', areaTouch, chain, path);
        if (Math.random() >= LINK_RECHECK) return;
        doorCheckEl = el;
        dbg('door area: rechecking this thumbnail against the page it links to');
        resolve(el, sizeOf(el), { cancelled: false, fresh: false, door: true, recheck: true }, null)
            .catch(function () { return null; })
            .then(function () { if (doorCheckEl === el) doorCheckEl = null; });
    }

    // The door-refused picture at the pointer: the target, or the one its cover hides.
    function doorAt(t, x, y) {
        const e = (cfg.doorAreas || {})[pageHost()];
        if (!e || !e.rules || !e.rules.length) return null;
        if (!t || t.nodeType !== 1 || !/^doorGate/.test(refusal(t) || '')) {
            const under = t && t.nodeType === 1 ? coveredMedia(t, x, y) : null;
            return under && /^doorGate/.test(refusal(under) || '') ? under : null;
        }
        return t;
    }
    const OP_WATCH_MS = 3000;       // how long a refused video-link hover watches for the site's player
    let opWatchEl = null, opWatchTimer = 0;

    // A player landed on a video-link thumbnail: evidence for its area. Recounts when the rules change.
    function opSeen(chain, path, id) {
        const c = areaApply('ownPlayerAreas', areaLearn, chain, path, id);
        if (c && c !== 'sampled' && c !== 'used') setTimeout(twRecount, 0);
    }

    function opStop() { clearInterval(opWatchTimer); opWatchTimer = 0; opWatchEl = null; }

    // A video-link thumbnail we refused: watch whether the site's own player lands on it. Under a rule,
    // a full watch with no player is a strike. The pointer leaving is no evidence.
    function opWatch(el) {
        if (opWatchEl === el || el.tagName === 'VIDEO' || cfg.videoMode !== 'all' || !videoLinkReason(el)) return;
        opStop();
        opWatchEl = el;
        const rect = el.getBoundingClientRect(), chain = domChain(el), path = pagePath(), t0 = Date.now();
        const limit = OP_WATCH_MS + vdHoldFor(chain, path);
        opWatchTimer = setInterval(function () {
            if (!holds(rect, pointer.x, pointer.y)) { opStop(); return; }
            if (videoOver(rect)) { opStop(); opSeen(chain, path, videoLinkReason(el)); return; }
            if (!el.isConnected) { opStop(); return; }
            if (Date.now() - t0 < limit) return;
            opStop();
            if (areaRule('ownPlayerAreas', chain, path)) {
                const c = areaApply('ownPlayerAreas', vdForget, chain, path);
                if (c && c.indexOf('forgot') === 0) setTimeout(twRecount, 0);
            }
        }, VDELAY_POLL_MS);
    }

    // ---- the learned wait for a player that lands late. See E62.

    const VDELAY_SAMPLES = 3;       // flashes measured before an area gets a wait, or a wait grows
    const VDELAY_MARGIN = 1.25;     // the wait, as a multiple of the slowest arrival seen
    const VDELAY_STEP = 250;        // ms added when the wait turns out short
    const VDELAY_MAX = 10000;
    const VDELAY_POLL_MS = 100;     // how often the picture is checked for a player under it
    const PLAYER_GRACE_MS = 150;    // no preview before this, on any site: a player that lands at
                                    // once is seen by the poll first and never flashes
    const CHAIN_DEPTH = 8;          // ancestors read into a picture's chain
    const RULE_DEPTH = 4;           // levels a rule may pin; deeper is per-row noise
    const RULE_MIN = 2;             // fewer shared levels is not the same area

    function vdRound(ms) {
        return Math.min(VDELAY_MAX, Math.max(VDELAY_STEP, Math.ceil(ms / 50) * 50));
    }

    // 'tag.a.b' -> {tag, cls: ['a','b']}
    function levelOf(s) {
        const p = s.split('.');
        return { tag: p[0], cls: p.slice(1) };
    }

    // The head several chains share, level by level: the tag must agree, and the level keeps only
    // the classes ALL of them carry. A level where one has classes and nothing is shared ends it —
    // a bare `a` under every picture is not an area.
    function sharedHead(chains) {
        const split = chains.map(function (c) { return c.split('>').map(levelOf); });
        const out = [];
        for (let n = 0; n < split[0].length; n++) {
            const first = split[0][n];
            let cls = first.cls.slice(), any = first.cls.length > 0;
            let ok = true;
            for (let i = 1; i < split.length && ok; i++) {
                const lv = split[i][n];
                if (!lv || lv.tag !== first.tag) { ok = false; break; }
                any = any || lv.cls.length > 0;
                cls = cls.filter(function (c) { return lv.cls.indexOf(c) !== -1; });
            }
            if (!ok || (any && !cls.length)) break;
            out.push(first.tag + (cls.length ? '.' + cls.join('.') : ''));
        }
        return out;
    }

    // The area several chains share: their common head, at least RULE_MIN and at most RULE_DEPTH
    // levels. '' when they share too little to be one area.
    function chainPrefix(chains) {
        const head = sharedHead(chains);
        if (head.length < RULE_MIN) return '';
        return head.slice(0, RULE_DEPTH).join('>');
    }

    // The page-path head several paths share, by segment; '/' when none.
    function pathPrefix(paths) {
        const split = paths.map(function (p) { return p.replace(/^\//, '').split('/'); });
        let n = 0;
        outer: for (; n < split[0].length; n++) {
            for (let i = 1; i < split.length; i++) if (split[i][n] !== split[0][n]) break outer;
        }
        return n ? '/' + split[0].slice(0, n).join('/') : '/';
    }

    // A chain matches a rule when, level for level, the tag agrees and it carries every class the
    // rule names — extra classes on the picture's side (state, animation) do not matter. A rule
    // with no dom covers nothing: nothing is ever site-wide.
    function chainMatches(chain, prefix) {
        if (!prefix) return false;
        const want = prefix.split('>').map(levelOf);
        const have = chain.split('>').map(levelOf);
        if (have.length < want.length) return false;
        for (let n = 0; n < want.length; n++) {
            if (have[n].tag !== want[n].tag) return false;
            for (let i = 0; i < want[n].cls.length; i++) if (have[n].cls.indexOf(want[n].cls[i]) === -1) return false;
        }
        return true;
    }

    // A rule this chain does not match but has the same tags all the way down, on this path: the
    // difference is classes only, so the rule is narrowed to what they share instead of the chain
    // becoming another area. null when none.
    function vdNearRule(e, chain, path) {
        const rules = (e && e.rules) || [];
        for (let i = 0; i < rules.length; i++) {
            if (!rules[i].dom || !pathMatches(path, rules[i].path)) continue;
            const head = sharedHead([rules[i].dom, chain]);
            if (head.length === rules[i].dom.split('>').length) return rules[i];
        }
        return null;
    }

    function pathMatches(path, prefix) {
        return !prefix || prefix === '/' || path === prefix || path.indexOf(prefix + '/') === 0;
    }

    // The rule of an entry that covers this hover, or null. A user's entry covers the whole site.
    function vdRuleFor(e, chain, path) {
        if (!e) return null;
        if (e.user) return e;
        const rules = e.rules || [];
        for (let i = 0; i < rules.length; i++) {
            if (chainMatches(chain, rules[i].dom) && pathMatches(path, rules[i].path)) return rules[i];
        }
        return null;
    }

    // One flash, folded into a site's entry. Under a rule that covers it: three make the wait
    // longer. Under none: three from one area make that area a rule — the head its chains share,
    // on the page-path they share — and a site may hold several. Nothing is ever site-wide.
    function vdLearn(entry, elapsed, chain, path, today) {
        const e = entry ? JSON.parse(JSON.stringify(entry)) : {};
        if (e.user) return { entry: e, change: null };
        const covering = vdRuleFor(e, chain, path);
        if (covering) {
            if (covering !== e) delete covering.idle;      // a flash is a player: no strike stands
            e.fixes = (e.fixes || []).concat([{ ms: elapsed }]);
            if (e.fixes.length < VDELAY_SAMPLES) return { entry: e, change: 'resampled' };
            const slowest = Math.max.apply(null, e.fixes.map(function (x) { return x.ms; }));
            delete e.fixes;
            e.ms = Math.min(VDELAY_MAX, Math.max(e.ms + VDELAY_STEP, vdRound(slowest * VDELAY_MARGIN)));
            return { entry: e, change: 'longer' };
        }
        // Measured against the grace, not the wait, so it says nothing about ms.
        const near = vdNearRule(e, chain, path);
        if (near) { near.dom = sharedHead([near.dom, chain]).join('>'); return { entry: e, change: 'widened' }; }
        const used = areaSample(e, { ms: elapsed, chain: chain, path: path }, today);
        if (!used) return { entry: e, change: 'sampled' };
        const slowest = Math.max.apply(null, used.map(function (x) { return x.ms; }));
        const ms = vdRound(slowest * VDELAY_MARGIN);
        e.ms = e.ms == null ? ms : Math.max(e.ms, ms);
        return { entry: e, change: e.rules.length === 1 ? 'learned' : 'another area' };
    }

    const VDELAY_FORGET = 3;        // waits in a row that ran out with no player before a rule goes

    // A covered hover's wait ran out and no player came: evidence against the rule. Three in a row
    // drop it — if it was right, the flashes that made it make it again — and an entry left with
    // no rules and no samples goes too. vdWorked() resets the count.
    function vdForget(entry, chain, path) {
        const e = entry ? JSON.parse(JSON.stringify(entry)) : null;
        if (!e || e.user) return { entry: e, change: null };
        const rule = vdRuleFor(e, chain, path);
        if (!rule) return { entry: e, change: null };
        rule.idle = (rule.idle || 0) + 1;
        if (rule.idle < VDELAY_FORGET) return { entry: e, change: 'waited for nothing' };
        e.rules = e.rules.filter(function (r) { return r !== rule; });
        if (!e.rules.length && !(e.samples && e.samples.length)) return { entry: null, change: 'forgot the site' };
        return { entry: e, change: 'forgot an area' };
    }

    // A player landed inside a covered hover's wait: the rule is doing its job.
    function vdWorked(entry, chain, path) {
        const e = entry ? JSON.parse(JSON.stringify(entry)) : null;
        const rule = e && !e.user ? vdRuleFor(e, chain, path) : null;
        if (!rule || !rule.idle) return { entry: e, change: null };
        delete rule.idle;
        return { entry: e, change: 'a player came' };
    }

    // The wait an entry gives this hover. While a correction is being sampled the wait is OFF, so
    // the flashes that finish it come as fast as the page makes them.
    function vdWaitOf(e, chain, path) {
        if (!e || !(e.ms > 0) || !vdRuleFor(e, chain, path)) return 0;
        return !e.user && e.fixes && e.fixes.length ? 0 : e.ms;
    }

    // ---- learned areas: a verdict cached per page structure, self-repairing and ageing. See ../CLAUDE.md.
    const AREA_SAMPLE_MAX = 30;     // samples kept across all areas still being learned
    const AREA_IDLE_DAYS = 90;      // unused this long, an area is marked; each site learns its own span
    const AREA_GRACE_DAYS = 365;    // marked and unused this much longer, it is deleted
    const AREA_IDLE_MARGIN = 1.5;   // a marked area used again: the site's span becomes its gap × this

    // Adds a sample; when VDELAY_SAMPLES share an area, appends a rule on it. The samples used, null,
    // or false when this item (sample.id) is already a sample — one picture hovered thrice is one.
    function areaSample(e, sample, today) {
        if (sample.id && (e.samples || []).some(function (x) { return x.id === sample.id; })) return false;
        const samples = (e.samples || []).concat([sample]).slice(-AREA_SAMPLE_MAX);
        e.samples = samples;
        const mates = samples.filter(function (x) { return chainPrefix([x.chain, sample.chain]) !== ''; });
        if (mates.length < VDELAY_SAMPLES) return null;
        let used = mates, dom = chainPrefix(mates.map(function (x) { return x.chain; }));
        if (!dom) { used = mates.slice(-VDELAY_SAMPLES); dom = chainPrefix(used.map(function (x) { return x.chain; })); }
        if (!dom) return null;
        e.samples = samples.filter(function (x) { return used.indexOf(x) === -1; });
        if (!e.samples.length) delete e.samples;
        e.rules = (e.rules || []).concat([{ dom: dom, path: pathPrefix(used.map(function (x) { return x.path; })), seen: today }]);
        return used;
    }

    // One verdict for this chain: under a rule it confirms it (strikes cleared, day stamped); else a
    // near rule widens, or it is a sample — three sharing an area make a rule, whatever came between.
    function areaLearn(entry, chain, path, today, id) {
        const e = entry ? JSON.parse(JSON.stringify(entry)) : {};
        const rule = vdRuleFor(e, chain, path);
        if (rule) {
            const t = areaTouch(e, chain, path, today);
            const r = vdRuleFor(t.entry, chain, path);
            if (!r.idle) return t;
            delete r.idle;
            return { entry: t.entry, change: t.change || 'confirmed' };
        }
        const near = vdNearRule(e, chain, path);
        if (near) { near.dom = sharedHead([near.dom, chain]).join('>'); return { entry: e, change: 'widened' }; }
        const sample = { chain: chain, path: path };
        if (id) sample.id = id;
        const used = areaSample(e, sample, today);
        if (used === false) return { entry: entry, change: null };
        if (!used) return { entry: e, change: 'sampled' };
        return { entry: e, change: e.rules.length === 1 ? 'learned' : 'another area' };
    }

    // Counter-evidence that must not wait for strikes: the covering rule goes, and samples sharing its area.
    function areaDrop(entry, chain, path) {
        if (!entry) return { entry: null, change: null };
        const e = JSON.parse(JSON.stringify(entry));
        const rule = vdRuleFor(e, chain, path);
        const before = (e.samples || []).length;
        if (e.samples) e.samples = e.samples.filter(function (x) { return chainPrefix([x.chain, chain]) === ''; });
        if (e.samples && !e.samples.length) delete e.samples;
        if (rule) e.rules = e.rules.filter(function (r) { return r !== rule; });
        if (!rule && (e.samples || []).length === before) return { entry: e, change: null };
        if (!(e.rules && e.rules.length) && !(e.samples && e.samples.length)) return { entry: null, change: 'forgot the site' };
        return { entry: e, change: rule ? 'dropped an area' : 'dropped samples' };
    }

    // A hover this area covered: stamp the day. A marked area used again proves the site's span too short.
    function areaTouch(entry, chain, path, today) {
        const e = entry ? JSON.parse(JSON.stringify(entry)) : null;
        const rule = e && e.rules ? vdRuleFor(e, chain, path) : null;
        if (!rule || rule === e || rule.seen === today) return { entry: e, change: null };
        let change = 'used';
        if (rule.stale && rule.seen != null) {
            const gap = today - rule.seen;
            e.idleDays = Math.max(e.idleDays || AREA_IDLE_DAYS, Math.ceil(gap * AREA_IDLE_MARGIN));
            change = 'marked area used again after ' + gap + ' days; span now ' + e.idleDays;
        }
        delete rule.stale;
        rule.seen = today;
        return { entry: e, change: change };
    }

    // Once a day per site: mark areas idle past the span, unmark any the span now covers, delete the long-dead.
    function areaAge(entry, today) {
        if (entry.user) return { entry: entry, change: null };
        const e = JSON.parse(JSON.stringify(entry));
        const span = e.idleDays || AREA_IDLE_DAYS;
        let changed = false;
        e.rules = (e.rules || []).filter(function (r) {
            if (r.seen == null) { r.seen = today; changed = true; return true; }
            const idle = today - r.seen;
            if (idle > span + AREA_GRACE_DAYS) { changed = true; return false; }
            if (idle > span && !r.stale) { r.stale = true; changed = true; }
            if (idle <= span && r.stale) { delete r.stale; changed = true; }
            return true;
        });
        if (!changed) return { entry: entry, change: null };
        if (!e.rules.length && !(e.samples && e.samples.length)) return { entry: null, change: 'deleted' };
        return { entry: e, change: 'aged' };
    }

    const DOOR_BIGGER = 1.5;        // a copy this much bigger than drawn, on either side, makes a leaf

    // One hover's ground truth for door areas: 'leaf' (the linked page holds a bigger copy), 'door', or null (no evidence). See P17.
    function doorVerdict(r) {
        if (!r.linked) return null;
        const h = r.trusted;
        if (h && (h.w > r.displayed.w * DOOR_BIGGER || h.h > r.displayed.h * DOOR_BIGGER)) return 'leaf';
        if (!h && r.failed) return null;
        return 'door';
    }

    // What a door's linked page is, from its own pictures: 'gallery' (they are leaves), 'results' (they are doors), or null. See P17.
    function doorKindVerdict(k) {
        if (!k.pics) return null;
        if (k.linked * 2 < k.pics) return 'gallery';
        if (k.images * 2 >= k.linked) return 'gallery';
        if (k.leaves > 0) return 'gallery';
        if (k.checked >= 2) return 'results';
        return null;
    }

    // The entry for a host: its own, else the most specific user entry covering it.
    function vdEntryFor(host) {
        const all = cfg.videoDelays || {};
        if (all[host]) return all[host];
        let best = null, bestLen = 0;
        Object.keys(all).forEach(function (k) {
            if (all[k].user && entryCovers(k, host) && k.length > bestLen) { best = all[k]; bestLen = k.length; }
        });
        return best;
    }

    // tag + every class, digits normalised to '#' and sorted: item-12 and item-13 are one shape.
    function nodeSig(n, classes) {
        let sig = n.tagName.toLowerCase();
        if (!classes) return sig;
        const cls = [];
        for (let i = 0; n.classList && i < n.classList.length; i++) {
            cls.push(n.classList[i].replace(/\d+/g, '#'));
        }
        if (cls.length) sig += '.' + cls.sort().join('.');
        return sig;
    }

    // The picture's chain, outward: its own tag alone (its classes are load state), then ancestors.
    function domChain(el) {
        const parts = [];
        let n = el;
        for (let up = 0; n && n.nodeType === 1 && up < CHAIN_DEPTH && !/^(BODY|HTML)$/.test(n.tagName);
             up++, n = n.parentElement) {
            if (up > 0 && n.tagName === 'PICTURE') { up--; continue; }   // a wrapper, not a shape: nsfw.xxx cards come both ways
            parts.push(nodeSig(n, up > 0));
        }
        return parts.join('>');
    }

    // This frame's page path, normalised: no query, no trailing slash.
    function pagePath() {
        return '/' + String(location.pathname || '').split('/').filter(Boolean).join('/');
    }

    // A learned rule covers this picture: hovering it plays the page's own clip, so the slideshow skips it.
    function latePlayerArea(el) {
        const e = vdEntryFor(pageHost());
        if (!e || e.user || !(e.rules && e.rules.length)) return false;
        return !!vdRuleFor(e, domChain(el), pagePath());
    }

    // How long this hover waits for the page's own player before previewing. 0 = no wait.
    function vdHoldFor(chain, path) {
        return vdWaitOf(vdEntryFor(pageHost()), chain, path);
    }

    // Read-modify-write against storage, as saveAudio() does. `step` is vdLearn, vdForget or vdWorked.
    function vdApply(step, chain, path, elapsed) {
        const host = pageHost();
        if (!host) return;
        reloadSettings();
        const r = step === vdLearn ? vdLearn(vdEntryFor(host), elapsed, chain, path, areaDay())
            : step(vdEntryFor(host), chain, path, areaDay());
        if (!r.change) return;
        const all = Object.assign({}, cfg.videoDelays);
        if (r.entry) all[host] = r.entry;
        else delete all[host];
        cfg.videoDelays = all;
        saveSettings();
        refreshPanel();
        twRefresh();
        dbg('late player: ' + r.change, { host: host, after: elapsed != null ? elapsed + ' ms' : '-',
            chain: chain, path: path, entry: r.entry });
    }

    function vdRecord(chain, path, elapsed) { vdApply(vdLearn, chain, path, elapsed); }

    const AREA_STORES = ['avatarAreas', 'ownPlayerAreas', 'linkAreas', 'doorAreas', 'videoDelays'];

    // The learned rule in cfg[key] covering this chain on this site, or null.
    function areaRule(key, chain, path) {
        const e = (cfg[key] || {})[pageHost()];
        return e && e.rules ? vdRuleFor(e, chain, path) : null;
    }

    function areaDay() { return Math.floor(Date.now() / 86400000); }

    // Read-modify-write of cfg[key] for this site. `step` is areaLearn, areaTouch, areaDrop, vdWorked or vdForget.
    function areaApply(key, step, chain, path, id) {
        const host = pageHost();
        if (!host || !isTopFrame) return null;
        reloadSettings();
        const r = step((cfg[key] || {})[host] || null, chain, path, areaDay(), id);
        if (!r.change) return null;
        const all = Object.assign({}, cfg[key]);
        if (r.entry) all[host] = r.entry;
        else delete all[host];
        cfg[key] = all;
        saveSettings();
        refreshPanel();
        dbg(key + ': ' + r.change, { host: host, chain: chain, path: path, entry: r.entry });
        return r.change;
    }

    // Ages every learned store, at most once a day.
    function areaAgeAll() {
        const today = areaDay();
        if (cfg.areasAgedOn === today) return;
        reloadSettings();
        if (cfg.areasAgedOn === today) return;
        AREA_STORES.forEach(function (key) {
            const all = {};
            Object.keys(cfg[key] || {}).forEach(function (host) {
                const r = areaAge(cfg[key][host], today);
                if (r.entry) all[host] = r.entry;
                if (r.change) dbg(key + ' ' + r.change, { host: host, entry: r.entry });
            });
            cfg[key] = all;
        });
        cfg.areasAgedOn = today;
        saveSettings();
    }

    const VDELAY_EVIDENCE_MS = 400;     // players land a beat after the close they cause

    // Is a <video>, or a frame that could hold a player, where the picture was? The one proof that a
    // close was a player's doing — without it, a page redrawing its grid teaches a wait (Google Images).
    function videoOver(r) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const surfaces = videoSurfaces();
        for (let i = 0; i < surfaces.length; i++) if (holds(surfaces[i].rect, cx, cy)) return true;
        const stack = document.elementsFromPoint ? document.elementsFromPoint(cx, cy) : [];
        for (let i = 0; i < stack.length; i++) if (/^(VIDEO|IFRAME)$/.test(stack[i].tagName)) return true;
        return false;
    }

    const BAND_WIDTH = 0.98;    // of the viewport — a full-bleed band reaches both edges
    const CONTENT_CHARS = 40;   // text this long is a paragraph, not a tile's caption

    // The same fact as `background-attachment: fixed`, expressed with an element instead of a CSS
    // background: pinned to the viewport and filling it in both axes. Applies to <img>/<video>,
    // which every other wallpaper test deliberately does not. See E17.
    function pinnedWallpaperReason(el) {
        const vw = vpW(), vh = vpH();
        if (vw <= 0 || vh <= 0) return null;        // the Browser pane answers 0 while hidden
        if (getComputedStyle(el).position !== 'fixed') return null;
        const r = el.getBoundingClientRect();
        if (r.width < vw * BAND_WIDTH || r.height < vh * BAND_WIDTH) return null;
        return 'pinned to the viewport and filling it — a wallpaper, not a picture on the page';
    }

    function wallpaperReason(el) {
        if (el === document.body || el === document.documentElement) return 'the page background';
        const s = getComputedStyle(el);
        if (s.backgroundAttachment.indexOf('fixed') >= 0)
            return 'background-attachment: fixed — it does not scroll with the page';
        if (!/no-repeat/.test(s.backgroundRepeat) && /^auto/.test(s.backgroundSize))
            return 'tiled end to end';
        const r = el.getBoundingClientRect();
        const vw = vpW();
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
        const r = passRect(el);
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
                const q = passRect(n);
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

    // An <img> with real alt text: aria-hidden on it only stops a screen reader repeating a caption.
    function describedImg(el) {
        return el.tagName === 'IMG' && !!(el.getAttribute('alt') || '').trim();
    }

    const SPRITE_OVER = 1.5;        // drawn background / box, in BOTH axes, that makes it a sheet of icons
    const SPRITE_MAX_SHOWN = 128;   // px: a negative offset on a box bigger than this is a crop, not a sprite

    // Why this element's background is a sprite sheet it shows one slice of, or null.
    function spriteReason(el) {
        const cs = getComputedStyle(el);
        const size = cs.backgroundSize.split(',')[0].trim();
        if (/cover|contain/.test(size)) return null;
        const r = el.getBoundingClientRect();
        const part = size.split(/\s+/);
        const len = function (v, box) {
            return /px$/.test(v) ? parseFloat(v) : /%$/.test(v) ? parseFloat(v) * box / 100 : NaN;
        };
        const w = len(part[0], r.width), h = len(part[1] || 'auto', r.height);
        if (w > SPRITE_OVER * r.width && h > SPRITE_OVER * r.height) {
            return 'its background is drawn ' + Math.round(w) + '×' + Math.round(h) + ' in a ' +
                Math.round(r.width) + '×' + Math.round(r.height) + ' box';
        }
        const pos = cs.backgroundPosition.split(',')[0].trim();
        if (Math.max(r.width, r.height) <= SPRITE_MAX_SHOWN && /(^|\s)-\d*\.?\d+px/.test(pos)) {
            return 'a ' + Math.round(r.width) + '×' + Math.round(r.height) + ' box offset into its background at ' + pos;
        }
        return null;
    }

    // Resolves to why this small box shows a corner of a sheet drawn at natural size, or ''.
    function sheetCheck(el, displayed) {
        if (el.tagName === 'IMG' || el.tagName === 'VIDEO') return Promise.resolve('');
        if (Math.max(displayed.w, displayed.h) > SPRITE_MAX_SHOWN) return Promise.resolve('');
        if (!/^auto( auto)?$/.test(getComputedStyle(el).backgroundSize.split(',')[0].trim())) return Promise.resolve('');
        const url = shownUrl(el);
        if (!url) return Promise.resolve('');
        return new Promise(function (done) {
            const im = new Image();
            im.onload = function () {
                const w = im.naturalWidth, h = im.naturalHeight;
                done(w > SPRITE_OVER * displayed.w && h > SPRITE_OVER * displayed.h
                    ? 'a ' + displayed.w + '×' + displayed.h + ' box showing a corner of a ' + w + '×' + h + ' file' : '');
            };
            im.onerror = function () { done(''); };
            im.src = url;
        });
    }

    // What the page itself says is not content.
    function decorativeReason(el) {
        if (!el.getAttribute) return null;
        if (el.getAttribute('aria-hidden') === 'true' && !describedImg(el)) return 'aria-hidden="true"';
        const role = (el.getAttribute('role') || '').toLowerCase();
        if (role === 'presentation' || role === 'none') return 'role="' + role + '"';
        return null;
    }

    const COVER_UP = 4;
    const COVER_PEER = 0.25;    // share of the biggest picture's area that makes another one a peer

    // Laid-out pictures under n, counted only as far as "more than one".
    // Laid out but invisible is not a picture on screen. Lazy-load placeholders sit exactly on top
    // of the real image at opacity 0, so they are neither a peer nor a candidate. See E18.
    function shownMedia(el) {
        const s = getComputedStyle(el);
        return s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.01;
    }

    // How many laid-out pictures in here are PEERS of the biggest one. A card's avatar or badge is
    // not a second picture; two tiles of a grid are. See E18.
    function peerMedia(n) {
        if (!n.querySelectorAll) return 0;
        const all = n.querySelectorAll('img,video');
        const areas = [];
        for (let i = 0; i < all.length; i++) {
            const r = all[i].getBoundingClientRect();
            if (r.width >= 2 && r.height >= 2 && shownMedia(all[i])) areas.push(r.width * r.height);
        }
        if (!areas.length) return 0;
        let max = 0;
        for (let i = 0; i < areas.length; i++) if (areas[i] > max) max = areas[i];
        let peers = 0;
        for (let i = 0; i < areas.length; i++) if (areas[i] >= max * COVER_PEER) peers++;
        return peers;
    }

    function coveredMedia(el, x, y) {
        if (!document.elementsFromPoint) return null;
        const stack = document.elementsFromPoint(x, y);
        const under = [];
        let below = false;
        for (let i = 0; i < stack.length; i++) {
            if (!below) { if (stack[i] === el) below = true; continue; }
            if ((stack[i].tagName === 'IMG' || stack[i].tagName === 'VIDEO') && shownMedia(stack[i]))
                under.push(stack[i]);
        }
        if (!under.length) return null;
        let n = el;
        for (let up = 0; n && up <= COVER_UP; up++, n = n.parentElement) {
            if (peerMedia(n) > 1) return null;       // a grid or a page, not a card
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
        return !el || refusal(el) ? null : el;
    }

    // The first gate that refuses this element, named with the setting behind it; null when none does.
    function refusal(el) {
        let why;
        if (el.tagName === 'VIDEO') {
            if (!videoPreviewsOn()) return 'a <video>, and video previews are off (videoMode: ' + cfg.videoMode + ')';
            if (!gifLike(el)) return 'a <video> that is not a clip — ' + notGifBecause(el);
            if ((why = playerSurfaceReason(el))) return 'playerGate: ' + why;
            if ((why = videoLinkRefused(el))) return 'videoLinkGate: ' + why;
            return blocked(shownUrl(el)) ? 'its URL matches the block list' : null;
        }
        if (NEVER[el.tagName]) return 'a <' + el.tagName.toLowerCase() + '> is never previewed';
        if ((why = playerSurfaceReason(el))) return 'playerGate: ' + why;
        if ((why = videoLinkRefused(el))) return 'videoLinkGate: ' + why;
        if ((why = doorReason(el))) return 'doorGate: ' + why;
        if (cfg.skipFurniture && (why = decorativeReason(el))) return 'decorativeGate (skipFurniture is on): ' + why;
        // Before the <img> branch, because these are the furniture rules that apply to one.
        if (cfg.skipFurniture && (why = bannerReason(el))) return 'bannerGate (skipFurniture is on): ' + why;
        if (cfg.skipFurniture && (why = pinnedWallpaperReason(el))) return 'backgroundGate (skipFurniture is on): ' + why;
        if (el.tagName === 'IMG') return blocked(pictureUrl(el)) ? 'its URL matches the block list' : null;
        // element with a background image and no img of its own
        if (el.querySelector && el.querySelector('img')) return 'not an <img>, and it holds one — that <img> is the target, not this';
        const bg = backgroundUrl(el);
        if (!bg) return 'not an <img> and has no background image';
        if (blocked(bg)) return 'its background URL matches the block list';
        if ((why = spriteReason(el))) return 'spriteGate: ' + why;
        if (cfg.skipFurniture && (why = wallpaperReason(el))) return 'backgroundGate (skipFurniture is on): ' + why;
        return null;
    }

    // One console line per hover, when `debug` is on.
    function hoverReport(t, el, e) {
        const a = closestAcross(t, 'a[href]');
        const rect = t.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const sizes = videoSurfaces().map(function (s) {
            return s.what + ' ' + rectStr(s.rect) +
                (s.gif ? ' [an animated picture — suppresses nothing]'
                    : holds(s.rect, cx, cy) ? ' [CONTAINS the pointer target]'
                        : ' [does not contain it]');
        });
        const cls = typeof t.className === 'string' ? t.className.trim() : '';
        const shown = sizeOf(el || t);
        const tooSmall = shown.w < cfg.minDisplayed && shown.h < cfg.minDisplayed;
        return {
            target: t.tagName + (t.id ? '#' + t.id : '') +
                (cls ? '.' + cls.split(/\s+/).slice(0, 2).join('.') : ''),
            targetRect: rectStr(rect),
            showing: (shownUrl(t) || '(nothing)').slice(0, 160),
            eligible: !!el && !tooSmall,
            refusedBy: el ? (tooSmall ? 'sizeGate' : 'nothing — eligible')
                : (function () {
                    let why = refusal(t);
                    const under = e && coveredMedia(t, e.clientX, e.clientY);
                    if (under) why += ' — and under the cover, ' + under.tagName + ': ' + refusal(under);
                    return why;
                })(),
            resolvedFrom: !el ? '(nothing)'
                : el === t ? 'the hover target itself'
                    : 'looked through the cover to ' + el.tagName +
                      (el.id ? '#' + el.id : '') + ' — ' + (shownUrl(el) || '').slice(0, 120),
            sizeGate: shown.w + '×' + shown.h + ' displayed, minDisplayed ' + cfg.minDisplayed +
                (tooSmall ? ' — REFUSED, both sides under it' : ' — passes'),
            blockList: !cfg.blockList || !cfg.blockList.length ? 'empty'
                : cfg.blockList.length + ' entries — ' + (blocked(shownUrl(el || t)) ? 'MATCHES the shown URL' : 'no match'),
            skipFurniture: cfg.skipFurniture,
            videoMode: cfg.videoMode + (playVideos ? '' : ' (turned off in this tab)'),
            playerGate: playerSurfaceReason(t) || 'none — no player on this page covers it',
            videoLinkGate: videoLinkReason(t) || 'none — does not lead to a video page',
            doorGate: doorReason(t) || 'none — no learned door area covers it',
            dormantPlayer: dormantPlayer(),
            lateWait: (function () {
                const w = vdEntryFor(pageHost());
                if (!w) return 'none — no entry for this site';
                if (w.user) return (w.ms || 0) + ' ms, set by the user';
                if (w.ms == null) return 'learning — ' + (w.samples || []).length + ' of ' + VDELAY_SAMPLES + ' samples';
                const r = el && vdRuleFor(w, domChain(el), pagePath());
                return w.ms + ' ms, learned, ' + (w.rules || []).length + ' area(s) — ' +
                    (r ? 'applies here (' + r.dom + ' on ' + r.path + ')' + (w.fixes && w.fixes.length ? ' — updating, no wait' : '')
                       : 'none covers this picture on ' + pagePath() + ' — its chain: ' + (el ? domChain(el) : '?') +
                         ' — rules: ' + (w.rules || []).map(function (x) { return x.dom + ' on ' + x.path; }).join(' | '));
            })(),
            backgroundGate: t.tagName === 'IMG' || t.tagName === 'VIDEO'
                ? (pinnedWallpaperReason(t) || 'n/a — not a background')
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
            // The listener only ever sees the host; the real target is in its shadow root.
            retargetedFromShadowRoot: !!(e && e.composedPath && e.composedPath()[0] !== t),
        };
    }

    function sizeOf(el) {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
    }

    // ---- small pictures: under smallBelow, only an avatar or an emoji previews
    const AVATAR_MIN_PX = 96;       // the original's longer side
    const AVATAR_UPSIZE = 2.4;      // times the size on the page
    const EMOJI_ALT_RE = /^\s*(?:\p{Extended_Pictographic}|\p{Regional_Indicator})[\p{Extended_Pictographic}\p{Emoji_Component}‍️\s]*$/u;
    const EMOJI_MAX_SHOWN = 128;    // an emoji-marked picture this big is a sticker or a picture: normal preview
    const EMOJI_CODE_RE = /^:[\w~+-]{1,64}:$/;
    const EMOJI_CLASS_RE = /(?:^|[\s_-])(?:emoji|emoticon|emote)(?:$|[\s_-])/i;

    // 'emoji', 'avatar', 'refuse', or null when the picture is not small.
    function smallKind(el, displayed) {
        const side = Math.max(displayed.w, displayed.h);
        if (cfg.activation === 'modifier') return null;     // the key asked for this one
        const emoji = side < EMOJI_MAX_SHOWN && emojiSign(el);
        if (emoji && cfg.smallEmoji) return 'emoji';
        if (side >= cfg.smallBelow) return null;
        if (emoji) return 'refuse';
        const ratio = displayed.w / Math.max(1, displayed.h);
        if (cfg.smallAvatars && ratio >= 0.75 && ratio <= 1.33) return 'avatar';
        return 'refuse';
    }

    // Why this picture is an emoji — its alt text, its class, its host — or ''.
    function emojiSign(el) {
        if (el.tagName !== 'IMG') return '';
        const alt = (el.getAttribute('alt') || '').trim();
        if (alt && alt.length <= 24 && EMOJI_ALT_RE.test(alt)) return 'alt is an emoji';
        if (EMOJI_CODE_RE.test(alt)) return 'alt is a :shortcode:';
        for (let n = el, up = 0; n && up < 2; up++, n = n.parentElement) {
            if (EMOJI_CLASS_RE.test(typeof n.className === 'string' ? n.className : '')) return 'class names an emoji';
        }
        if (blockMatch(shownUrl(el), EMOJI_HOSTS)) return 'an emoji host';
        return '';
    }

    // An avatar: the original found is big, and much bigger than the page draws it.
    function avatarBig(hit, displayed) {
        const orig = Math.max(hit.w || 0, hit.h || 0);
        return orig >= AVATAR_MIN_PX && orig >= AVATAR_UPSIZE * Math.max(displayed.w, displayed.h);
    }

    let emojiEl = null, emojiImg = null;
    let emojiLast = 0;              // when the last emoji enlargement went away; the next within EMOJI_SWEEP_MS skips the delay
    const EMOJI_SWEEP_MS = 800;
    const EMOJI_OFFSET = 18;        // px from the pointer, so it is never under it

    // The emoji enlargement: the picture on a plain backing, pointer-transparent. Nothing else.
    function buildEmoji() {
        if (emojiEl) return;
        buildViewer();
        emojiEl = document.createElement('div');
        emojiEl.style.cssText = 'position:fixed;display:none;pointer-events:none;box-sizing:content-box;padding:6px;' +
            'border-radius:10px;background:#1e1e2e;box-shadow:0 4px 18px rgba(0,0,0,.45)';
        emojiImg = document.createElement('img');
        emojiImg.style.cssText = 'display:block;position:static;background:none;object-fit:contain';     // the sheet's img rule is the preview's
        emojiEl.appendChild(emojiImg);
        root.appendChild(emojiEl);
    }

    // Beside the pointer, below-right, flipped to whichever side has room.
    function emojiPlace() {
        if (!emojiEl || emojiEl.style.display === 'none') return;
        const w = emojiEl.offsetWidth, h = emojiEl.offsetHeight;
        const x = pointer.x + EMOJI_OFFSET + w <= vpW() ? pointer.x + EMOJI_OFFSET : pointer.x - EMOJI_OFFSET - w;
        const y = pointer.y + EMOJI_OFFSET + h <= vpH() ? pointer.y + EMOJI_OFFSET : pointer.y - EMOJI_OFFSET - h;
        emojiEl.style.left = Math.max(0, x) + 'px';
        emojiEl.style.top = Math.max(0, y) + 'px';
    }

    // Hovering an emoji: after the hover delay (none mid-sweep), its enlargement; a bigger file swaps in when found.
    function emojiHover(el, displayed) {
        active = el;
        activeRect = el.getBoundingClientRect();
        const myToken = token = { cancelled: false, fresh: true };
        const wait = Date.now() - emojiLast < EMOJI_SWEEP_MS ? 0 : cfg.hoverDelay;
        timer = setTimeout(function () {
            if (myToken.cancelled || active !== el) return;
            const url = shownUrl(el);
            if (!url) return;
            buildEmoji();
            const size = Math.max(32, Math.min(1000, cfg.emojiSize | 0));
            emojiImg.style.width = emojiImg.style.height = size + 'px';
            emojiImg.src = url;
            emojiEl.style.display = 'block';
            emojiPlace();
            let best = 0;
            resolve(el, displayed, myToken, function (hit) {
                if (myToken.cancelled || active !== el || hit.video) return;
                const s = Math.max(hit.w || 0, hit.h || 0);
                if (s > best) { best = s; emojiImg.src = hit.url; }
            }).catch(function () { /* the page's own file stays */ });
        }, wait);
    }

    function emojiHide() {
        if (!emojiEl || emojiEl.style.display === 'none') return;
        emojiEl.style.display = 'none';
        emojiImg.removeAttribute('src');
        emojiLast = Date.now();
    }

    function cancel() {
        if (placed) return;         // a placed viewer outlives hover entirely
        pinOnShow = null;
        if (active && view && box && box.classList.contains('on') && debugOn()) {
            const lines = String(new Error().stack || '').split('\n');
            let i = 0;
            while (i < lines.length && lines[i].indexOf('cancel') === -1) i++;
            dbg('a painted preview is closing', { from: (lines[i + 1] || '?').trim(),
                after: (Date.now() - hoverAt) + ' ms', lastUserAct: lastUserAct ? (Date.now() - lastUserAct) + ' ms ago' : 'never' });
        }
        clearTimeout(timer);
        clearTimeout(holdTimer);
        clearInterval(watchTimer);
        holding = false;
        holdMs = 0;
        ruleMs = 0;
        activeRect = null;
        activeChain = '';
        if (token) token.cancelled = true;
        token = null;
        active = null;
        activeSmall = false;
        activeCovered = false;
        activeShown = null;
        drag = null;
        emojiHide();
        disableWheelZoom();
        resetBar();
        hideSpinner();
        hideViewer();
    }

    // Only arm the suppression when the pointer is actually ON the picture — `onOut` is the only
    // thing that lifts it, so armed from anywhere else it strands until the next enter-and-leave.
    // See E44.
    function dismiss() {
        const el = active;              // read it before unplace()/cancel() clear it
        const on = !!el && stillUnderPointer(el, pointer.x, pointer.y);
        suppressed = on ? el : null;
        suppressedCovered = on ? activeCovered : false;
        if (placed) unplace(); else cancel();
    }

    // The button that does NOT place.
    function altButton(e) {
        if (placed) return false;       // hands the press to the browser; see above
        if (!active && !view) return false;
        dismiss();
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 2) swallowMenuAt = Date.now();
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
        const d = drag;
        drag = null;
        if (box) box.classList.remove('drag');
        applyCursor();      // the release may land with no further movement to redraw it
        if (d.mode === 'move' && d.moved && view && placed && !fullActive()) {
            posDropped(view.left - d.sl, view.top - d.st);
        }
    }

    function onMove(e) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        if (emojiEl) emojiPlace();
        twNear(e.clientX, e.clientY);
        if (placed) thruSync(e.clientX, e.clientY);
        if (active && !placed && !galOwns(active) && playerArrived(active)) return;
        if (spinEl && spinEl.classList.contains('on')) moveSpinner();
        syncSavedMark();
        const over = !!view && !!box && box.classList.contains('on') &&
            pointInPreview(e.clientX, e.clientY);
        // Leaving is a one-shot: showBar() once on the way out arms the fade, where calling it on
        // every move outside would push the fade back on any movement anywhere on screen.
        if (over) showBar();
        else { commitZoomField(null); if (barOver) showBar(); }
        barOver = over;
        applyCursor();
        // Before the drag guard: fullscreen with a picture that fits starts no drag at all, and
        // a tap only cleared inside that guard survives any distance. See E39.
        if (tap && (Math.abs(e.clientX - tap.x) > TAP_SLOP ||
                    Math.abs(e.clientY - tap.y) > TAP_SLOP)) tap = null;
        if (!drag || !view) return;
        if (e.buttons === 0) { endDrag(); return; }
        if (drag.mode === 'resize') { resizeBy(e); return; }
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!dx && !dy) return;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (drag.mode === 'move') {
            // Snapped from the unsnapped position, or a snap could never be pulled out of.
            if (!drag.moved) {
                drag.rl = drag.sl = view.left;
                drag.rt = drag.st = view.top;
                drag.moved = true;
            }
            drag.rl += dx;
            drag.rt += dy;
            // Only an axis the drag has moved snaps; a sideways drag must not pull the top to an edge.
            const p = e.ctrlKey ? { x: drag.rl, y: drag.rt } : posSnap(drag.rl, drag.rt);
            view.left = Math.abs(drag.rl - drag.sl) >= 1 ? p.x : drag.rl;
            view.top = Math.abs(drag.rt - drag.st) >= 1 ? p.y : drag.rt;
            layout();       // clampPosition() keeps a grabbable strip of it on screen
        } else {
            panBy(dx, dy);
        }
    }

    function onOver(e) {
        if (e.isTrusted) { twNear(e.clientX, e.clientY); if (placed) thruSync(e.clientX, e.clientY); }
        if (placed || priming || hotQuiet) return;
        if (galCur || (galOn && galWant)) return;      // an open gallery: its cells preview on their own
        if (drag || twBusy()) return;
        if (ours(e.target)) return;         // on our own overlay
        if (!siteEnabled() || CAPTCHA_HERE) return;
        if (mouseDown) return;
        if (cfg.activation === 'modifier' && !modifierHeld(e) && !modifierDown) return;
        if (cfg.activation !== 'modifier' &&
            (hzOff || (!cfg.hotkeyToggle && (modifierDown || modifierHeld(e))))) return;

        const el = eligible(e.target, e.clientX, e.clientY);
        if (debugOn()) dbg('hover', hoverReport(e.target, el, e));
        if (!el && e.target.tagName === 'IMG' && /^videoLinkGate/.test(refusal(e.target) || '')) opWatch(e.target);
        if (!el) { const door = doorAt(e.target, e.clientX, e.clientY); if (door) doorHover(door, e.clientX, e.clientY); }
        if (!el) {
            if (!active || active.contains(e.target)) return;
            if (activeCovered && stillUnderPointer(active, e.clientX, e.clientY)) return;
            if (lateCover(e.target, e.clientX, e.clientY)) return;
            if (playerReplaced(e.clientX, e.clientY)) return;
            selfClosed('the picture is no longer under the pointer', e.clientX, e.clientY);
            cancel();
            return;
        }
        if (el === suppressed) return;      // dismissed; stays down until the pointer leaves
        if (el === active) return;

        if (active) selfClosed('something else took its place: ' + el.tagName, e.clientX, e.clientY);
        cancel();
        const displayed = sizeOf(el);
        const small = smallKind(el, displayed);
        if (small === 'emoji') { emojiHover(el, displayed); return; }     // an emoji may be tinier than minDisplayed
        if (displayed.w < cfg.minDisplayed && displayed.h < cfg.minDisplayed) return;
        if (small === 'refuse') {
            if (debugOn()) dbg('small picture, not an avatar or emoji — no preview', { shown: displayed.w + '×' + displayed.h,
                smallBelow: cfg.smallBelow, emoji: emojiSign(el) || 'no', smallEmoji: cfg.smallEmoji, smallAvatars: cfg.smallAvatars });
            return;
        }

        active = el;
        activeCovered = (el !== e.target);
        activeShown = shownUrl(el);
        hoverAt = Date.now();
        activeRect = el.getBoundingClientRect();
        activeChain = domChain(el);     // taken now: at close the card holds the player too
        activePath = pagePath();
        const chain = activeChain, path = activePath;
        const avArea = small === 'avatar' && !!areaRule('avatarAreas', chain, path);     // a learned area previews as ordinary. See P16.
        activeSmall = small === 'avatar' && !avArea;
        if (avArea) areaApply('avatarAreas', areaTouch, chain, path);
        let avSeen = false;     // a hit here proved an avatar
        const keyed = cfg.activation === 'modifier';     // the user asked for it: no grace, no learned wait
        ruleMs = keyed ? 0 : vdHoldFor(activeChain, activePath);
        holdMs = keyed ? 0 : Math.max(ruleMs, PLAYER_GRACE_MS);
        holding = true;
        // A player landing under a still pointer raises no mouse event worth waiting for. See E61.
        watchTimer = setInterval(function () {
            if (active !== el || placed) return;
            if (!el.isConnected) {      // swapped out under a still pointer; no mouse event says so
                selfClosed('the picture was removed from the page', pointer.x, pointer.y);
                cancel();
                return;
            }
            playerArrived(el);
        }, VDELAY_POLL_MS);
        // A hover is a user gesture, and a gesture always retries a cached miss. See TOUR.md §7.
        const myToken = token = { cancelled: false, fresh: true, door: true };
        let heldHit = null;     // the best hit so far, kept back until the wait is over
        let resolving = false;  // the resolve has started; the ring belongs to it, not to the wait
        function paint(hit) {
            if (view && box.classList.contains('on')) upgradeViewer(hit);
            else { showViewer(hit, pointer); dockSpinner(); hwStart(el); }
            if (pinOnShow === el) { pinOnShow = null; place(); }
        }
        if (ruleMs) { dbg('waiting ' + holdMs + ' ms for the page\'s own player before previewing'); vdApply(areaTouch, chain, path); }
        holdTimer = setTimeout(async function () {
            if (myToken.cancelled || active !== el || playerArrived(el)) return;
            // A learned wait ran out and nothing came: one strike against the rule.
            if (ruleMs) vdApply(vdForget, activeChain, activePath);
            holding = false;
            if (heldHit) { paint(heldHit); return; }
            if (!myToken.done) { if (resolving) showSpinner(); return; }   // hits paint directly from here
            if (myToken.small && cfg.bigChip) bigChipShow(el, myToken.small);
            if (myToken.failure) await showFallback(el, myToken, myToken.failure);
        }, holdMs);
        timer = setTimeout(async function () {
            const sheet = await sheetCheck(el, displayed);
            if (myToken.cancelled || active !== el) return;
            if (sheet) { dbg('spriteGate: ' + sheet); dismiss(); return; }
            resolving = true;
            if (!holding) showSpinner();
            let got = false;
            try {
                await resolve(el, displayed, myToken,
                    function (hit) {
                        if (myToken.cancelled || active !== el || playerArrived(el)) return;
                        if (small === 'avatar' && !avSeen && avatarBig(hit, displayed)) {
                            avSeen = true;
                            areaApply('avatarAreas', areaLearn, chain, path, activeShown);
                        }
                        if (activeSmall && !avatarBig(hit, displayed)) return;
                        got = true;
                        if (holding) { heldHit = hit; return; }
                        paint(hit);
                    });
                myToken.done = true;
                if (avArea && !myToken.cancelled && !avSeen) areaApply('avatarAreas', vdForget, chain, path);
                if (holding) return;            // the wait's timer paints, or shows the failure
                if (!got && !myToken.cancelled && active === el && myToken.small && cfg.bigChip) bigChipShow(el, myToken.small);
                if (!got && !myToken.cancelled && active === el && myToken.failure)
                    await showFallback(el, myToken, myToken.failure);
            } finally {
                if (!myToken.cancelled && !holding) hideSpinner();
            }
        }, keyed ? 0 : cfg.hoverDelay);
    }

    let bigChipEl = null, bigChipFor = null;

    // A picture the page already draws as large as a preview would be: a chip on its corner opens the preview anyway, pinned, to zoom in.
    function bigChipShow(el, hit) {
        buildViewer();
        if (!bigChipEl) {
            bigChipEl = document.createElement('div');
            bigChipEl.className = 'bigchip';
            bigChipEl.appendChild(mkIcon(ICON_FIND));
            setTip(bigChipEl, 'Preview it anyway — the page already shows this picture as large as a preview would be');
            ['mousedown', 'mouseup', 'click', 'auxclick', 'dblclick'].forEach(function (t) {
                bigChipEl.addEventListener(t, function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (t === 'mousedown' && e.button === 0) bigChipOpen();
                });
            });
            root.appendChild(bigChipEl);
        }
        bigChipFor = { el: el, hit: hit };
        const r = el.getBoundingClientRect();
        bigChipEl.style.left = Math.round(Math.min(r.right, vpW()) - 36) + 'px';
        bigChipEl.style.top = Math.round(Math.max(r.top, 0) + 8) + 'px';
        bigChipEl.classList.add('on');
        document.addEventListener('mousemove', bigChipWatch, true);
        window.addEventListener('scroll', bigChipHide, { capture: true, passive: true });
    }

    function bigChipHide() {
        if (!bigChipEl) return;
        bigChipEl.classList.remove('on');
        bigChipFor = null;
        document.removeEventListener('mousemove', bigChipWatch, true);
        window.removeEventListener('scroll', bigChipHide, { capture: true, passive: true });
    }

    // The chip goes once the pointer is off both the picture and the chip.
    function bigChipWatch(e) {
        const f = bigChipFor;
        if (f && (holds(f.el.getBoundingClientRect(), e.clientX, e.clientY) || holds(bigChipEl.getBoundingClientRect(), e.clientX, e.clientY))) return;
        bigChipHide();
    }

    function bigChipOpen() {
        const f = bigChipFor;
        bigChipHide();
        if (!f || !f.el.isConnected) return;
        if (placed) unplace(); else cancel();
        active = f.el;
        activeShown = shownUrl(f.el);
        hoverAt = Date.now();
        token = { cancelled: false, fresh: true };
        showViewer(f.hit, pointer);
        place();
    }

    // A player now covers the picture we are previewing. Chromium's mouseover for a layout change
    // under a still pointer is best-effort, so this is asked by geometry, not waited for. See E61.
    function playerArrived(el) {
        const over = overVideoSurface(el);
        if (!over) return false;
        withdrawn('over a laid-out <video> rectangle (' + over + ')');
        return true;
    }

    // The page put a player over the picture after the hover: the preview is withdrawn.
    function withdrawn(why) {
        dbg('a player arrived over the picture — preview withdrawn' + (holding ? ' before it opened' : ''),
            { after: (Date.now() - hoverAt) + ' ms', why: why });
        if (holding && ruleMs && active) vdApply(vdWorked, activeChain, activePath);
        if (active && active.tagName !== 'VIDEO' && videoLinkReason(active)) opSeen(activeChain, activePath, videoLinkReason(active));
        selfClosed(why, pointer.x, pointer.y, true);
        cancel();
    }

    // A preview that was ON SCREEN is closing with the pointer still on the picture: the page took
    // it away, not the user. Whatever the path, this is the one event the wait learns from — a
    // rule that is wrong keeps being corrected by the flash it failed to prevent. See E62.
    function selfClosed(why, x, y, seen) {
        const painted = !!(view && box && box.classList.contains('on'));
        if (!active || placed || holding || !activeRect || !painted) {
            if (painted || holding) dbg('closing, not counted — ' + why,
                { active: !!active, placed: placed, holding: holding, rect: !!activeRect, painted: painted });
            return;
        }
        if (x <= activeRect.left + 1 || x >= activeRect.right - 1 ||
            y <= activeRect.top + 1 || y >= activeRect.bottom - 1) {
            const now = active.isConnected ? active.getBoundingClientRect() : null;
            if (now && holds(now, x, y)) dbg('the picture moved under the pointer — closing, not counted — ' + why,
                { x: x, y: y, hoverRect: rectStr(activeRect), nowRect: rectStr(now) });
            return;
        }
        // A captcha tile swaps its picture because it was CLICKED: a page change the user caused.
        if (Date.now() - lastUserAct < USER_QUIET_MS) {
            dbg('the preview closed on its own, but after a press or key — not counted', why);
            return;
        }
        const elapsed = Date.now() - hoverAt;
        const chain = activeChain, path = activePath, rect = activeRect, waited = ruleMs;
        const vlink = active.tagName !== 'VIDEO' ? videoLinkReason(active) : null;
        const record = function () {
            dbg('the page took the preview away — ' + why,
                { after: elapsed + ' ms', waited: waited ? waited + ' ms, learned' : 'the grace only' });
            vdRecord(chain, path, elapsed);
            if (vlink && !seen) opSeen(chain, path, vlink);      // the player paths reported it already
        };
        // Only a close a player caused teaches a wait. The player paths saw one; the rest look.
        if (seen) { record(); return; }
        setTimeout(function () {
            if (videoOver(rect)) record();
            else dbg('the preview closed on its own, but no video appeared there — not counted', why);
        }, VDELAY_EVIDENCE_MS);
    }

    // The picture itself went, and a <video> is where it was — a clip included, since it is never
    // the hovered media (E12): the same withdrawal, seen from the mouseout it causes. Only inside
    // the rectangle the picture had, so leaving onto a neighbouring player is still just leaving.
    function playerReplaced(x, y) {
        if (!active || !activeRect || !holds(activeRect, x, y)) return false;
        if (!document.elementsFromPoint) return false;
        const stack = document.elementsFromPoint(x, y);
        for (let i = 0; i < stack.length; i++) {
            if (stack[i].tagName === 'VIDEO') {
                withdrawn('a <video> is now where the picture was');
                return true;
            }
        }
        return false;
    }

    // Nothing loaded and something genuinely failed: show the page's own picture with the reason,
    // so a hover is never a ring that spins and vanishes. Deliberately NOT shown when every
    // candidate was merely rejected for being too small — that is the size gate working, and
    // previewing every un-upgradable thumbnail on a page would be noise. See TOUR.md §8.
    // Sized from the probe, never nativeSize(): a srcset <img> reports a density-divided size,
    // and verifyMedia() closes the window on the real one. See E45.
    async function showFallback(el, token, why) {
        if (activeSmall) return;            // a small picture with no big original is not an avatar
        const url = shownUrl(el);
        if (!url || blocked(url) || placeholder(el, url)) return;
        const dim = await probe(url);       // resolve() already tried the displayed src; cached
        if (!dim || token.cancelled || active !== el || playerArrived(el)) return;
        dbg('showing the page\'s own picture instead — ' + why, url);
        showViewer({ url: url, w: dim.w, h: dim.h, video: !!dim.video, duration: dim.duration,
            display: dim.display, reason: why }, pointer);
        dockSpinner();
    }

    // Is the picture still under the pointer?
    function stillUnderPointer(el, x, y) {
        if (!el || !document.elementsFromPoint) return false;
        const stack = document.elementsFromPoint(x, y);
        for (let i = 0; i < stack.length; i++) if (stack[i] === el) return true;
        return false;
    }

    // Is the picture under the pointer with something ABOVE it? A neighbour is never above it at
    // the same point, so a boundary pixel on the row scan does not answer yes. See E61.
    function underCover(el, x, y) {
        if (!el || !document.elementsFromPoint) return false;
        const stack = document.elementsFromPoint(x, y);
        for (let i = 1; i < stack.length; i++) if (stack[i] === el) return true;
        return false;
    }

    function onOut(e) {
        if (placed || drag || twStarting) return;      // twStarting: tourFollow() scrolls the page out from under the pointer
        const to = e.relatedTarget;
        if (suppressed) {
            const inside = (to && suppressed.contains && suppressed.contains(to)) ||
                (suppressedCovered && stillUnderPointer(suppressed, e.clientX, e.clientY));
            if (!inside && (suppressedCovered || suppressed.contains(e.target))) {
                suppressed = null;  // left the image; hovering it again may preview again
                suppressedCovered = false;
            }
        }
        if (!active) return;
        if (to && active.contains && active.contains(to)) return;   // still inside the image
        if (activeCovered && stillUnderPointer(active, e.clientX, e.clientY)) return;
        // mouseout precedes the mouseover that onOver decides on; same test, same answer.
        if (lateCover(to, e.clientX, e.clientY)) return;
        if (playerReplaced(e.clientX, e.clientY)) return;
        selfClosed('the pointer is still on it', e.clientX, e.clientY);
        cancel();
    }

    // Something the page put over the picture AFTER the hover. A player wins, as it does
    // everywhere else; anything else makes this a covered hover from here on. See E61.
    function lateCover(t, x, y) {
        if (!t || !t.tagName || !underCover(active, x, y)) return false;
        const why = playerSurfaceReason(t);
        if (why) { withdrawn(why); return true; }
        activeCovered = true;
        return true;
    }

    document.addEventListener('mousemove', perfWrap(onMove, 'event'), true);
    document.addEventListener('mouseover', perfWrap(onOver, 'event'), true);
    document.addEventListener('mouseout', perfWrap(onOut, 'event'), true);
    document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) twLeave(); }, true);   // left the window (or into a frame)

    // Middle-click on the window saves the original to the download folder. See E76.
    function midSave(e) {
        if (e.button !== 1 || !view || !view.url || e.target === panelHost || !pointInPreview(e.clientX, e.clientY)) return false;
        e.preventDefault();         // no autoscroll
        e.stopImmediatePropagation();
        claimClick();
        midSaveAt = Date.now();
        if (midSavedHref !== location.href) { midSaved.clear(); midSavedHref = location.href; }
        const url = view.url, at = midSaved.get(url);
        if (at && Date.now() - at < MID_RETRY_MS) { toast('Already saved', 2000); return true; }
        midSaved.set(url, Date.now());
        const gImg = galOwns(active) ? active : null, gHref = gImg && galCur ? galCur.href : null;
        saveOriginal(url, true, function () { midSaved.set(url, Infinity); syncSavedMark(); if (gImg) galSaved(gImg, gHref); }, savePage(active));
        return true;
    }
    // The click half of that press: a hover preview lets it through to the link underneath, which would open a tab.
    function midSaveClick(e) {
        if (e.button !== 1 || Date.now() - midSaveAt > MENU_CLAIM_MS) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    }
    CAP_TARGET.addEventListener('auxclick', midSaveClick, true);
    CAP_TARGET.addEventListener('click', midSaveClick, true);
    CAP_TARGET.addEventListener('mouseup', midSaveClick, true);

    CAP_TARGET.addEventListener('mousedown', function (e) {
        if (midSave(e)) return;
        swallowNextClick = false;
        lastUserAct = Date.now();
        hotTap = false;
        pressHeld = true;
        if (e.button === 2 && placed && dimEl && e.composedPath && e.composedPath()[0] === dimEl) {
            e.preventDefault();
            e.stopPropagation();
            claimClick();
            swallowMenuAt = Date.now();     // off the window, a right press closes it; no menu
            dismiss();
            return;
        }
        if (ours(e.target)) { claimClick(); return; }   // onBoxDown / the backdrop own this one
        if (placed && e.button === 0) {     // through the backdrop onto a page control: close, let it act
            dbg('a press on a page control closes the window and goes through', describeEl(e.target));
            dismiss();
        }
        if (!placed && e.button === 2 && cfg.activation === 'modifier' && (modifierDown || modifierHeld(e)) &&
            pressPinsPreview(e)) {
            claimClick();
            const onIt = pointInPreview(e.clientX, e.clientY);
            place();
            // On the preview, the browser's menu is for the picture: let it come. Off it, it is not.
            if (!onIt) { e.preventDefault(); e.stopPropagation(); swallowMenuAt = Date.now(); }
            return;
        }
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
            boxTap(e);      // onBoxClick never sees this one; the stop above is on `window`
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
        const ours = swallowMenuAt && Date.now() - swallowMenuAt <= MENU_CLAIM_MS;
        swallowMenuAt = 0;
        if (!ours && shownFromBytes() && e.composedPath && e.composedPath()[0] === mediaEl) {
            e.preventDefault();
            e.stopPropagation();
            openBytesPop(e.clientX, e.clientY);
            return;
        }
        if (!ours) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);
    // The three slider flags are armed on `mousedown` and disarmed on `change` — but a press that
    // does not move the value fires no `change`, so the release is the only event that always
    // comes. Without this they stick on: the volume column can never close (`E38`), the scrubber
    // stops following the clip, and the bar never fades.
    function releaseSliders() {
        seekDrag = false;
        volDrag = false;
        zoomDrag = false;
    }

    document.addEventListener('mouseup', function () {
        mouseDown = false;
        pressHeld = false;
        endDrag();
        releaseSliders();
    }, true);
    window.addEventListener('scroll', perfWrap(function onScrollCancel(e) {
        if (!placed && !twStarting && !panelOwns(e)) cancel();     // twStarting: tourFollow() scrolls
    }, 'event'), true);
    // No keyup ever comes for a modifier held through Alt+Tab or Ctrl+Tab, so blur forgets it.
    window.addEventListener('blur', function () {
        modifierDown = false; hotTap = false; hotQuiet = false;
        if (!placed) cancel();
    });
    window.addEventListener('resize', function () {
        if (!placed) { cancel(); return; }
        if (!view) return;
        if (fullActive()) { fitFull(); return; }        // the screen IS the new viewport
        view.fitScale = fitScaleFor(view.natW, view.natH);
        const lo = minScaleFor(view.natW, view.natH);
        if (view.scale < lo) view.scale = lo;
        reflow();
        if (view.anchor) posApply(view.anchor);     // a bottom-anchored window stays on the bottom
        layout();
    });
    const TOUR_KEYS = { ArrowRight: 1, ']': 1, ArrowLeft: -1, '[': -1 };

    document.addEventListener('keydown', function (e) {
        // A nav key on a preview we are only HOVERING pins it and starts the tour. onPinKey has
        // already taken the placed case; this one acts only on a window of ours that is up.
        const dir = TOUR_KEYS[e.key];
        if (dir && !placed && cfg.tourKeys && view && box && box.classList.contains('on') &&
            !e.ctrlKey && !e.metaKey && !e.altKey && !panelHost && !typingIn(e)) {
            lastUserAct = Date.now();       // the close this causes is not a player's; see E62
            place();
            tourNav(dir, e.repeat, true);
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        // A bare modifier changes no page, and a held one repeats: under modifier activation it
        // would stamp every hover as the user's doing and nothing would ever be learned.
        if (!e.repeat && !/^(Shift|Control|Alt|Meta)$/.test(e.key)) lastUserAct = Date.now();
        if (e.key === 'Escape' && panelHost) {
            closePanel();                       // the panel is on top; it closes first
            e.stopPropagation();
            return;
        }
        if (e.key === 'Escape') {
            cancel();                           // onPinKey has already handled the placed case
        }
        if (!isHotkey(e)) { hotTap = false; return; }
        if (e.repeat || modifierDown) return;
        // Whatever is being dragged owns the hotkey: Ctrl there means "no snapping".
        if (drag || twBusy() || pressHeld) return;
        modifierDown = true;
        if (cfg.activation === 'modifier') {
            if (placed) {               // the third press: closed, and back on the next hold
                lastUserAct = Date.now();
                hotQuiet = true;
                releasedOn = null;
                hotLast.t = 0;
                unplace();
                return;
            }
            const now = Date.now();
            const quick = now - hotLast.t < HOT_DOUBLE_MS &&
                Math.abs(pointer.x - hotLast.x) < 12 && Math.abs(pointer.y - hotLast.y) < 12;
            hotLast = { t: now, x: pointer.x, y: pointer.y };
            const up = !!view && !!box && box.classList.contains('on');
            const again = quick || (!!releasedOn && !up && stillUnderPointer(releasedOn, pointer.x, pointer.y));
            releasedOn = null;
            hoverAtPointer();
            if (!again || !active) return;
            hotLast.t = 0;
            if (view && box.classList.contains('on')) place();
            else pinOnShow = active;
            return;
        }
        if (cfg.hotkeyToggle) { hotTap = true; return; }
        if (view && box && box.classList.contains('on')) {
            lastUserAct = Date.now();
            dismiss();
        }
    }, true);
    document.addEventListener('keyup', function (e) {
        if (!isHotkey(e)) return;
        const wasDown = modifierDown;
        modifierDown = false;
        if (cfg.activation === 'modifier') {
            hotQuiet = false;
            if (!wasDown) return;
            if (pinOnShow && pinOnShow === active) return;      // pinned the moment it paints
            releasedOn = !placed && view && box && box.classList.contains('on') ? active : null;
            cancel();
            return;
        }
        if (hotTap && cfg.hotkeyToggle && isTopFrame && !(e.key === 'Control' && (galPeek || Date.now() - galPeekTapAt < 100))) setOff(!hzOff);   // Ctrl there is the gallery's key
        hotTap = false;
    }, true);

    // → / ← with nothing open is ▶ / ◀ on the widget. Bubble phase on window, so a page that handles
    // the key itself — preventDefault or stopPropagation — keeps it.
    const KEY_START_BUSY = /^(INPUT|SELECT|TEXTAREA|VIDEO|AUDIO|IFRAME)$/;
    window.addEventListener('keydown', function (e) {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir || e.defaultPrevented || !cfg.tourKeyStart || !isTopFrame) return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || placed || panelHost || twBusy()) return;
        if (view && box && box.classList.contains('on')) return;
        if (typingIn(e) || !siteEnabled() || CAPTCHA_HERE) return;
        const ae = document.activeElement;
        if (ae && (KEY_START_BUSY.test(ae.tagName) || ae.isContentEditable ||
            /^(slider|tab|listbox|menu|menuitem|grid|radiogroup|spinbutton)$/.test(ae.getAttribute('role') || ''))) return;
        if (twCount() < 2) return;
        e.preventDefault();
        tourFromStart(dir);
    });

    // The pointer is not moving, so onOver is synthesised from where it already is.
    function hoverAtPointer() {
        if (placed || drag || active) return;
        if (!document.elementFromPoint) return;
        const el = document.elementFromPoint(pointer.x, pointer.y);
        if (!el) return;
        onOver({ target: el, clientX: pointer.x, clientY: pointer.y });
    }

    // ==== us-dock begin ====
    // Shared verbatim by Hover Zoom, Forum Stumbler and RNFP. Edit HoverZoom/dock/us-dock.js, then run
    // `node dock/sync-dock.js` from HoverZoom. The design is HoverZoom/docs/WIDGET-DOCK.md.
    const usDock = (function () {
        const SNAP = 8;                 // px: window edges, the window's centre, other widgets
        const STATUS_BAND = 21;         // px: the browser's link-URL bubble along the window's bottom
        const TOUCH = 1;                // px: how close two edges must be to count as attached at a drop
        const PASSES = 4;               // overlap sweeps; three widgets settle in two
        const SHADOW_REACH = 40;        // px: how far THEME.shadow spreads past a widget
        const A_ID = 'data-us-dock', A_SPEC = 'data-us-dock-a', A_SIZE = 'data-us-dock-s',
            A_GREW = 'data-us-dock-t', A_DRAG = 'data-us-dock-d', A_STRETCH = 'data-us-dock-st',
            A_FILL = 'data-us-dock-f', A_RADIUS = 'data-us-dock-r';
        const WATCHED = [A_ID, A_SPEC, A_SIZE, A_GREW, A_DRAG, A_STRETCH, A_FILL, A_RADIUS, 'hidden'];
        const AXES = ['x', 'y'];
        const LEN = { x: 'w', y: 'h' };

        const mine = [];                // this script's widgets
        let queued = false;
        let watching = false;
        const attrObs = new MutationObserver(schedule);
        const listObs = new MutationObserver(function (recs) {
            for (const r of recs) {
                for (const n of r.addedNodes) if (isDock(n)) { observeDocks(); schedule(); return; }
                for (const n of r.removedNodes) if (isDock(n)) { schedule(); return; }
            }
        });

        function isDock(n) { return n.nodeType === 1 && n.hasAttribute(A_ID); }

        // Every widget wears RNFP's palette, the light one on a light page.
        const THEME = {
            dark: { bg: '#1a1a1b', bg2: '#232325', bg3: '#2d2d30', border: '#343536', text: '#d7dadc',
                muted: '#8a8d91', shadow: '0 8px 24px rgba(0,0,0,.6)', scheme: 'dark' },
            light: { bg: '#ffffff', bg2: '#f3f5f7', bg3: '#e6e9ec', border: '#d5d9dd', text: '#1c1c1c',
                muted: '#5c6c74', shadow: '0 8px 24px rgba(0,0,0,.25)', scheme: 'light' },
        };
        const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

        // Luminance of an opaque-enough background, or null for a transparent one.
        function bgLum(node) {
            const nums = (getComputedStyle(node).backgroundColor || '').match(/[\d.]+/g);
            if (!nums || nums.length < 3) return null;
            if (nums.length >= 4 && parseFloat(nums[3]) < 0.5) return null;
            return 0.2126 * nums[0] + 0.7152 * nums[1] + 0.0722 * nums[2];
        }

        // The page's own background decides: <body>, <html>, then whatever paints the middle of the
        // window (apps paint a wrapper). A page that paints nothing is white unless it declares dark.
        function pageIsDark() {
            const seen = [document.body, document.documentElement];
            for (const node of seen) {
                const l = node ? bgLum(node) : null;
                if (l !== null) return l < 128;
            }
            const vp = viewport();
            const stack = document.elementsFromPoint ? document.elementsFromPoint(vp.w / 2, vp.h / 2) : [];
            for (const top of stack) {
                if (top.closest && top.closest('[' + A_ID + ']')) continue;     // a widget reads its own colour
                for (let n = top; n && seen.indexOf(n) < 0; n = n.parentElement) {
                    const l = bgLum(n);
                    if (l !== null) return l < 128;
                }
            }
            const root = document.documentElement;
            const meta = document.querySelector('meta[name="color-scheme" i]');
            const cs = ((root ? getComputedStyle(root).colorScheme : '') || '') + ' ' + (meta ? meta.content : '');
            if (!/dark/.test(cs)) return false;
            if (!/light/.test(cs)) return true;
            return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        }

        function theme() { return pageIsDark() ? THEME.dark : THEME.light; }

        // The layout viewport, scrollbars excluded; <body> answers for it on a quirks-mode page.
        function viewport() {
            const el = (document.compatMode === 'BackCompat' && document.body) || document.documentElement;
            return { w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight };
        }

        // To 0.01 px: whole pixels leave a fractional widget up to 1 px short of a window edge.
        function cent(v) { return Math.round(v * 100) / 100; }

        function pt(lo, len, k) { return k === 's' ? lo : k === 'e' ? lo + len : lo + len / 2; }

        // Which third the widget is in, measured from the point its current anchor holds. See WIDGET-DOCK.md.
        function zone(prev, lo, len, V) {
            const p = pt(lo, len, prev || 'c');
            return p < V / 3 ? 's' : p > V * 2 / 3 ? 'e' : 'c';
        }

        function winAxis(k, lo, len, V) { return { r: 'win', m: k, t: k, o: cent(pt(lo, len, k) - pt(0, V, k)) }; }

        function parse(s) { try { return JSON.parse(s); } catch (_) { return null; } }

        function nums(s, n) {
            if (!s) return null;
            const a = s.split(' ').map(Number);
            return a.length === n && a.every(isFinite) ? a : null;
        }

        function cleanAxis(a) {
            const k = /^[sce]$/;
            if (!a || typeof a !== 'object' || typeof a.r !== 'string' || !k.test(a.m) || !k.test(a.t) ||
                typeof a.o !== 'number' || !isFinite(a.o)) return null;
            return { r: a.r, m: a.m, t: a.t, o: a.o };
        }

        function cleanSpec(s) {
            if (!s || typeof s !== 'object') return null;
            const x = cleanAxis(s.x), y = cleanAxis(s.y), fx = cleanAxis(s.fx), fy = cleanAxis(s.fy);
            if (!x || !y || !fx || !fy || fx.r !== 'win' || fy.r !== 'win') return null;
            const ov = Array.isArray(s.ov) ? s.ov.filter(function (v) { return typeof v === 'string'; }) : [];
            return { x: x, y: y, fx: fx, fy: fy, ov: ov };
        }

        // Every widget on the page, read from what each one publishes — never from where it is drawn,
        // except the live position of one being dragged. See WIDGET-DOCK.md "Mechanism".
        function readDocks() {
            const out = [], seen = {};
            const els = document.querySelectorAll('[' + A_ID + ']');
            for (const el of els) {
                const id = el.getAttribute(A_ID);
                if (seen[id] || el.hidden || !el.getClientRects().length) continue;
                const spec = cleanSpec(parse(el.getAttribute(A_SPEC)));
                const size = nums(el.getAttribute(A_SIZE), 2);
                if (!spec || !size || size[0] < 1 || size[1] < 1) continue;
                seen[id] = true;
                const drag = nums(el.getAttribute(A_DRAG), 2);
                const st = nums(el.getAttribute(A_STRETCH), 1);
                out.push({ id: id, el: el, spec: spec, w: size[0], h: size[1],
                    grew: Number(el.getAttribute(A_GREW)) || 0,
                    drag: drag ? { x: drag[0], y: drag[1] } : null,
                    minH: st ? st[0] : null, fill: el.hasAttribute(A_FILL),
                    radius: Number(el.getAttribute(A_RADIUS)) || 0 });
            }
            out.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
            return out;
        }

        // The one layout. Same inputs give the same answer in every script, so none of them reacts
        // to another's result and nothing can oscillate.
        function solve(docks, V) {
            const by = {};
            const S = { x: V.w, y: V.h };
            docks.forEach(function (d) { by[d.id] = d; d.a = {}; d.pos = {}; d.root = {}; });
            AXES.forEach(function (ax) {
                docks.forEach(function (d) {
                    const a = d.spec[ax];
                    d.a[ax] = a.r !== 'win' && (!by[a.r] || a.r === d.id) ? d.spec['f' + ax] : a;
                });
                // A loop of attachments cannot be placed; the first widget in it falls back to the window.
                docks.forEach(function (d) {
                    const seen = {};
                    seen[d.id] = true;
                    let c = d.a[ax];
                    while (c.r !== 'win') {
                        if (seen[c.r]) { d.a[ax] = d.spec['f' + ax]; break; }
                        seen[c.r] = true;
                        c = by[c.r].a[ax];
                    }
                });
            });
            function place(d, ax) {
                if (d.pos[ax] != null) return d.pos[ax];
                const len = d[LEN[ax]];
                if (d.drag) { d.root[ax] = d.id; return (d.pos[ax] = d.drag[ax]); }
                const a = d.a[ax];
                if (a.r === 'win') {
                    d.root[ax] = d.id;
                    return (d.pos[ax] = pt(0, S[ax], a.t) + a.o - pt(0, len, a.m));
                }
                const p = by[a.r];
                const plo = place(p, ax);
                d.root[ax] = p.root[ax];
                return (d.pos[ax] = pt(plo, p[LEN[ax]], a.t) + a.o - pt(0, len, a.m));
            }
            AXES.forEach(function (ax) { docks.forEach(function (d) { place(d, ax); }); });

            // A widget that fills takes the width of a wider one stacked on or under it, and moves with it.
            function stacked(a, b) { return a.a.y.r === b.id && a.a.y.m !== a.a.y.t; }
            docks.forEach(function (d) {
                if (!d.fill || d.drag) return;
                const p = docks.find(function (k) {
                    return k !== d && k.w > d.w && (stacked(d, k) || (stacked(k, d) && !k.drag));
                });
                if (!p) return;
                const old = d.root.x;
                d.pos.x = p.pos.x;
                d.w = p.w;
                docks.forEach(function (k) { if (k.root.x === old) k.root.x = p.root.x; });
            });

            function group(d, ax) { return docks.filter(function (k) { return k.root[ax] === d.root[ax]; }); }
            function span(g, ax) {
                let lo = Infinity, hi = -Infinity;
                g.forEach(function (k) { lo = Math.min(lo, k.pos[ax]); hi = Math.max(hi, k.pos[ax] + k[LEN[ax]]); });
                return { lo: lo, hi: hi };
            }
            function shift(g, ax, dv) { g.forEach(function (k) { k.pos[ax] += dv; }); }

            // A panel that stretches keeps its top and gives up its bottom to the window first.
            docks.forEach(function (d) {
                if (d.minH == null) return;
                const give = Math.min(d.pos.y + d.h - S.y, d.h - d.minH);
                if (give > 0) d.h -= give;
            });
            // Attached widgets are one unit on that axis, and the unit is kept on screen as a whole.
            AXES.forEach(function (ax) {
                const done = {};
                docks.forEach(function (d) {
                    if (done[d.root[ax]]) return;
                    done[d.root[ax]] = true;
                    const g = group(d, ax), s = span(g, ax);
                    const dv = s.hi - s.lo > S[ax] ? -s.lo : Math.max(-s.lo, Math.min(0, S[ax] - s.hi));
                    if (dv) shift(g, ax, dv);
                });
            });

            function over(a, b, ax) {
                return Math.min(a.pos[ax] + a[LEN[ax]], b.pos[ax] + b[LEN[ax]]) - Math.max(a.pos[ax], b.pos[ax]);
            }
            function dragged(d) { return (by[d.root.x] && by[d.root.x].drag) || (by[d.root.y] && by[d.root.y].drag); }
            // Move g toward `dir` (-1 start, +1 end) by up to `need`, never off screen. Returns the distance moved.
            function push(g, ax, dir, need) {
                const s = span(g, ax);
                const room = dir < 0 ? Math.max(0, s.lo) : Math.max(0, S[ax] - s.hi);
                const dv = Math.min(need, room);
                if (dv > 0) shift(g, ax, dir * dv);
                return dv;
            }
            function separate(a, b, ax, need) {
                if (a.root[ax] === b.root[ax]) return false;
                const ca = a.pos[ax] + a[LEN[ax]] / 2, cb = b.pos[ax] + b[LEN[ax]] / 2;
                const first = ca < cb || (ca === cb && a.id < b.id) ? a : b;
                const second = first === a ? b : a;
                let left = need;
                // A panel that stretches gives up its bottom before anything is moved.
                if (ax === 'y' && first.minH != null) {
                    const give = Math.min(left, Math.max(0, first.h - first.minH));
                    first.h -= give;
                    left -= give;
                }
                if (left <= 0) return true;
                // The widget that changed size most recently is the one pushing; the other one moves.
                const grower = a.grew !== b.grew ? (a.grew > b.grew ? a : b) : a;
                const mover = grower === a ? b : a;
                const dirOf = function (k) { return k === first ? -1 : 1; };
                left -= push(group(mover, ax), ax, dirOf(mover), left);
                if (left > 0) left -= push(group(grower, ax), ax, dirOf(grower), left);
                return left < need;
            }
            for (let pass = 0; pass < PASSES; pass++) {
                let moved = false;
                for (let i = 0; i < docks.length; i++) {
                    for (let j = i + 1; j < docks.length; j++) {
                        const a = docks[i], b = docks[j];
                        if (dragged(a) || dragged(b)) continue;
                        if (a.spec.ov.indexOf(b.id) >= 0 || b.spec.ov.indexOf(a.id) >= 0) continue;
                        const px = over(a, b, 'x'), py = over(a, b, 'y');
                        if (px <= 0.5 || py <= 0.5) continue;
                        const order = py <= px ? ['y', 'x'] : ['x', 'y'];
                        for (const ax of order) {
                            if (separate(a, b, ax, ax === 'y' ? py : px)) { moved = true; break; }
                        }
                    }
                }
                if (!moved) break;
            }
            docks.forEach(function (d) {
                d.out = { x: cent(d.pos.x), y: cent(d.pos.y), w: d.w, h: cent(d.h) };
            });
            return docks;
        }

        function schedule() {
            if (queued) return;
            queued = true;
            Promise.resolve().then(relayout);
        }

        function setPx(el, p, v) {
            const s = v + 'px';
            if (el.style[p] !== s) el.style[p] = s;
        }

        function relayout() {
            queued = false;
            if (!mine.length) return;
            const docks = solve(readDocks(), viewport());
            mine.forEach(function (w) {
                const d = docks.find(function (k) { return k.el === w.el; });
                if (!d) return;
                clipShadow(w, d, docks, viewport());
                if (w.o.apply) { w.o.apply(d.out); return; }
                setPx(w.el, 'left', d.out.x);
                setPx(w.el, 'top', d.out.y);
                if (w.el.style.right !== 'auto') w.el.style.right = 'auto';
                if (w.el.style.bottom !== 'auto') w.el.style.bottom = 'auto';
            });
        }

        // A widget's shadow is cut away where another widget sits, so it reads as passing under it.
        function clipShadow(w, d, docks, V) {
            const o = d.out;
            const box = function (l, t, r, b) {
                l = cent(l - o.x); t = cent(t - o.y); r = cent(r - o.x); b = cent(b - o.y);
                return 'M' + l + ' ' + t + 'H' + r + 'V' + b + 'H' + l + 'Z';
            };
            // The hole has the other widget's rounded corners, or the shadow is cut where its body is not.
            const round = function (l, t, r, b, k) {
                if (!k) return box(l, t, r, b);
                l = cent(l - o.x); t = cent(t - o.y); r = cent(r - o.x); b = cent(b - o.y);
                k = Math.min(k, (r - l) / 2, (b - t) / 2);
                const arc = function (x, y) { return 'A' + k + ' ' + k + ' 0 0 1 ' + cent(x) + ' ' + cent(y); };
                return 'M' + cent(l + k) + ' ' + t + 'H' + cent(r - k) + arc(r, t + k) + 'V' + cent(b - k) + arc(r - k, b) +
                    'H' + cent(l + k) + arc(l, b - k) + 'V' + cent(t + k) + arc(l + k, t) + 'Z';
            };
            const holes = [];
            docks.forEach(function (k) {
                if (k === d || !k.out) return;
                const r = k.out;
                // Bodies overlapping mid-drag: nothing is cut, or the body itself would be.
                if (r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y) return;
                const l = Math.max(r.x, o.x - SHADOW_REACH), t = Math.max(r.y, o.y - SHADOW_REACH);
                const rr = Math.min(r.x + r.w, o.x + o.w + SHADOW_REACH), b = Math.min(r.y + r.h, o.y + o.h + SHADOW_REACH);
                if (rr - l > 0.5 && b - t > 0.5) holes.push(round(r.x, r.y, r.x + r.w, r.y + r.h, k.radius));
            });
            const want = holes.length ? "path(evenodd, '" + box(0, 0, V.w, V.h) + holes.join('') + "')" : '';
            if (w.clip === want) return;
            w.clip = want;
            w.el.style.clipPath = want;
        }

        function observeDocks() {
            for (const el of document.querySelectorAll('[' + A_ID + ']')) {
                attrObs.observe(el, { attributes: true, attributeFilter: WATCHED });
            }
        }

        function watch() {
            if (watching) return;
            watching = true;
            listObs.observe(document.documentElement, { childList: true });
            if (document.body) listObs.observe(document.body, { childList: true });
            else document.addEventListener('DOMContentLoaded', function () {
                if (document.body) listObs.observe(document.body, { childList: true });
                observeDocks();
                schedule();
            });
            window.addEventListener('resize', schedule);
            document.addEventListener('fullscreenchange', schedule);
            // A scrollbar appearing changes the viewport and fires no `resize`.
            if (window.ResizeObserver) new ResizeObserver(schedule).observe(document.documentElement);
        }

        // The ids attached to `id`, directly or through another widget: they travel with it.
        function carried(id, docks) {
            const set = {};
            set[id] = true;
            let grew = true;
            while (grew) {
                grew = false;
                docks.forEach(function (d) {
                    if (!set[d.id] && (set[d.spec.x.r] || set[d.spec.y.r])) { set[d.id] = true; grew = true; }
                });
            }
            return set;
        }

        function rectOf(d) {
            const r = d.el.getBoundingClientRect();
            return { id: d.id, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        }

        // Snap a dragged rect to the window's edges and centre, the top of the status bubble, and other widgets' edges.
        function snap(x, y, w, h, V, others) {
            let bx = null, by = null;
            function tx(v) { const d = Math.abs(v - x); if (d <= SNAP && (!bx || d < bx.d)) bx = { d: d, v: v }; }
            function ty(v) { const d = Math.abs(v - y); if (d <= SNAP && (!by || d < by.d)) by = { d: d, v: v }; }
            tx(0); tx(V.w - w); tx((V.w - w) / 2);
            ty(0); ty(V.h - h); ty((V.h - h) / 2); ty(V.h - STATUS_BAND - h);
            others.forEach(function (r) {
                const nearY = y < r.bottom + SNAP && y + h > r.top - SNAP;
                const nearX = x < r.right + SNAP && x + w > r.left - SNAP;
                if (nearY) { tx(r.left - w); tx(r.right); }
                if (nearX) { ty(r.top - h); ty(r.bottom); }
                const touchY = nearX && (Math.abs(y + h - r.top) <= SNAP || Math.abs(y - r.bottom) <= SNAP);
                const touchX = nearY && (Math.abs(x + w - r.left) <= SNAP || Math.abs(x - r.right) <= SNAP);
                if (touchY) { tx(r.left); tx(r.right - w); tx(r.left + (r.width - w) / 2); }
                if (touchX) { ty(r.top); ty(r.bottom - h); ty(r.top + (r.height - h) / 2); }
            });
            return { x: bx ? bx.v : x, y: by ? by.v : y };
        }

        // The anchor a drop makes: attached to a widget it touches, else to the window's thirds.
        function makeSpec(rc, zones, others, V) {
            const fx = winAxis(zones.x, rc.x, rc.w, V.w), fy = winAxis(zones.y, rc.y, rc.h, V.h);
            let x = fx, y = fy;
            const winX = rc.x <= TOUCH ? winAxis('s', rc.x, rc.w, V.w)
                : rc.x + rc.w >= V.w - TOUCH ? winAxis('e', rc.x, rc.w, V.w) : null;
            const winY = rc.y <= TOUCH ? winAxis('s', rc.y, rc.h, V.h)
                : rc.y + rc.h >= V.h - TOUCH ? winAxis('e', rc.y, rc.h, V.h) : null;
            function align(r, lo, len, rlo, rlen) {
                let best = null;
                ['s', 'c', 'e'].forEach(function (k) {
                    const o = cent(pt(lo, len, k) - pt(rlo, rlen, k));
                    if (!best || Math.abs(o) < Math.abs(best.o)) best = { r: r.id, m: k, t: k, o: o };
                });
                return best;
            }
            for (const r of others) {
                const xo = rc.x < r.right - TOUCH && rc.x + rc.w > r.left + TOUCH;
                const yo = rc.y < r.bottom - TOUCH && rc.y + rc.h > r.top + TOUCH;
                if (xo && Math.abs(rc.y + rc.h - r.top) <= TOUCH) y = { r: r.id, m: 'e', t: 's', o: cent(rc.y + rc.h - r.top) };
                else if (xo && Math.abs(rc.y - r.bottom) <= TOUCH) y = { r: r.id, m: 's', t: 'e', o: cent(rc.y - r.bottom) };
                else if (yo && Math.abs(rc.x + rc.w - r.left) <= TOUCH) x = { r: r.id, m: 'e', t: 's', o: cent(rc.x + rc.w - r.left) };
                else if (yo && Math.abs(rc.x - r.right) <= TOUCH) x = { r: r.id, m: 's', t: 'e', o: cent(rc.x - r.right) };
                else continue;
                if (y.r === r.id) x = winX || align(r, rc.x, rc.w, r.left, r.width);
                else y = winY || align(r, rc.y, rc.h, r.top, r.height);
                break;
            }
            const ov = others.filter(function (r) {
                return Math.min(rc.x + rc.w, r.right) - Math.max(rc.x, r.left) > 0.5 &&
                    Math.min(rc.y + rc.h, r.bottom) - Math.max(rc.y, r.top) > 0.5;
            }).map(function (r) { return r.id; });
            return { x: x, y: y, fx: fx, fy: fy, ov: ov };
        }

        // o: { id, el, load() -> spec|null, save(spec), initial() -> spec, size() -> [w, h] natural,
        //      stretchMin() -> px|null, apply(rect), handle(target) -> may a press here drag, onDrag(on),
        //      radius: px of its rounded corners, fill: take a wider stacked widget's width (apply gets rect.w) }
        function create(o) {
            const el = o.el;
            const w = { o: o, el: el, spec: null, dragging: false, size: null };
            mine.push(w);

            function setSpec(spec) {
                w.spec = cleanSpec(spec) || cleanSpec(o.initial());
                el.setAttribute(A_SPEC, JSON.stringify(w.spec));
            }

            function measure() {
                const s = o.size ? o.size() : (function (r) { return [r.width, r.height]; })(el.getBoundingClientRect());
                return [cent(s[0]), cent(s[1])];
            }

            // Only the NATURAL size is published; a clamp or a stretch is an output and must not feed back.
            function sizeChanged() {
                const s = measure();
                if (w.size && s[0] === w.size[0] && s[1] === w.size[1]) return;
                w.size = s;
                el.setAttribute(A_SIZE, s[0] + ' ' + s[1]);
                el.setAttribute(A_GREW, String(Date.now()));
                const min = o.stretchMin ? o.stretchMin() : null;
                if (min != null) el.setAttribute(A_STRETCH, String(Math.round(min)));
                else el.removeAttribute(A_STRETCH);
            }

            el.setAttribute(A_ID, o.id);
            if (o.radius) el.setAttribute(A_RADIUS, String(o.radius));
            if (o.fill) el.setAttribute(A_FILL, '');
            setSpec(o.load());
            sizeChanged();
            const ro = window.ResizeObserver ? new ResizeObserver(sizeChanged) : null;
            if (ro) ro.observe(el);
            // Content changes too: not every engine delivers ResizeObserver (the Browser pane never does).
            const mo = new MutationObserver(sizeChanged);
            mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true,
                attributeFilter: ['style', 'class'] });

            el.addEventListener('mousedown', function (e) {
                if (e.button !== 0 || (o.handle && !o.handle(e.target))) return;
                e.preventDefault();
                const docks = readDocks();
                const self = docks.find(function (d) { return d.el === el; });
                if (!self) return;
                const skip = carried(o.id, docks);
                const others = docks.filter(function (d) { return !skip[d.id]; }).map(rectOf);
                const r0 = el.getBoundingClientRect();
                const sx = e.clientX, sy = e.clientY;
                const zones = { x: w.spec.fx.m, y: w.spec.fy.m };
                let last = null;
                w.dragging = true;
                if (o.onDrag) o.onDrag(true);
                function move(ev) {
                    const V = viewport();
                    const W = self.w, H = self.h;
                    let x = Math.max(0, Math.min(r0.left + ev.clientX - sx, V.w - W));
                    let y = Math.max(0, Math.min(r0.top + ev.clientY - sy, V.h - H));
                    if (!ev.ctrlKey) {
                        const s = snap(x, y, W, H, V, others);
                        x = Math.max(0, Math.min(s.x, V.w - W));
                        y = Math.max(0, Math.min(s.y, V.h - H));
                    }
                    zones.x = zone(zones.x, x, W, V.w);
                    zones.y = zone(zones.y, y, H, V.h);
                    last = { x: x, y: y, w: W, h: H };
                    el.setAttribute(A_DRAG, cent(x) + ' ' + cent(y));
                    relayout();
                }
                function up() {
                    window.removeEventListener('mousemove', move, true);
                    window.removeEventListener('mouseup', up, true);
                    w.dragging = false;
                    if (last) {
                        setSpec(makeSpec(last, zones, others, viewport()));
                        o.save(w.spec);
                    }
                    el.removeAttribute(A_DRAG);
                    relayout();
                    if (o.onDrag) o.onDrag(false);
                }
                window.addEventListener('mousemove', move, true);
                window.addEventListener('mouseup', up, true);
            });

            watch();
            observeDocks();
            schedule();

            return {
                relayout: schedule,
                sizeChanged: sizeChanged,
                dragging: function () { return w.dragging; },
                spec: function () { return w.spec; },
                // Hidden widgets drop out of everyone's layout; widgets attached to them fall back.
                show: function (on) {
                    el.hidden = !on;
                    if (on) { w.size = null; sizeChanged(); }
                    schedule();
                },
                // Re-read the anchor and the size: for a script that keeps its own geometry (RNFP).
                reload: function () { setSpec(o.load()); sizeChanged(); schedule(); },
                // For a script that runs its own drag: snap a rect as a dock drag would...
                snap: function (x, y, W, H) {
                    const docks = readDocks();
                    const skip = carried(o.id, docks);
                    return snap(x, y, W, H, viewport(), docks.filter(function (d) { return !skip[d.id]; }).map(rectOf));
                },
                // ...and publish where it is, so widgets attached to it travel with it.
                dragAt: function (x, y) {
                    w.dragging = true;
                    el.setAttribute(A_DRAG, cent(x) + ' ' + cent(y));
                    relayout();
                },
                dragEnd: function () {
                    w.dragging = false;
                    el.removeAttribute(A_DRAG);
                    schedule();
                },
                // For a widget being thrown away: it leaves everyone's layout at once.
                destroy: function () {
                    const i = mine.indexOf(w);
                    if (i >= 0) mine.splice(i, 1);
                    if (ro) ro.disconnect();
                    mo.disconnect();
                    [A_ID, A_SPEC, A_SIZE, A_GREW, A_DRAG, A_STRETCH, A_FILL, A_RADIUS].forEach(function (a) { el.removeAttribute(a); });
                },
            };
        }

        return { create: create, solve: solve, makeSpec: makeSpec, snap: snap, zone: zone, SNAP: SNAP, STATUS_BAND: STATUS_BAND,
            THEME: THEME, FONT: FONT, pageIsDark: pageIsDark, theme: theme };
    })();
    // ==== us-dock end ====

    // ==== us-log begin ====
    // Shared verbatim by Forum Stumbler and Hover Zoom. Edit HoverZoom/shared/us-log.js, then run
    // `node shared/sync-shared.js` from HoverZoom. The design is HoverZoom/docs/REQUEST-LOG.md.
    //
    // Records nothing but counts, timings and status codes. No URL, path, query or title ever
    // reaches it — the only identifying field is the hostname, and the export replaces that too.
    const usLog = (function () {
        const V = 1;
        const MAX_ROWS = 400;        // reads kept; the per-host summary outlives their eviction
        const MAX_EV = 12;           // limit events kept per read
        const PACE_MAX = 40;         // chars of the caller's pace label

        let store = null;            // { load(), save(str) } — the host script owns the key
        let max = MAX_ROWS, evMax = MAX_EV;
        let clock = () => Date.now();
        let on = true;
        const inst = Math.random().toString(36).slice(2, 7);
        const open = new Set();

        // The host script supplies storage and may override the caps; nothing here touches GM_*.
        function init(o) {
            o = o || {};
            if (o.load && o.save) store = { load: o.load, save: o.save };
            if (o.max) max = Math.max(10, o.max | 0);
            if (o.evMax) evMax = Math.max(1, o.evMax | 0);
            if (o.now) clock = o.now;
            if (o.on != null) on = !!o.on;
            return usLog;
        }

        const enable = (v) => { on = !!v; };
        const enabled = () => on && !!store;
        const blank = () => ({ v: V, hosts: {}, rows: [] });

        function read() {
            if (!store) return blank();
            try {
                const d = JSON.parse(store.load() || '');
                return (d && d.v === V && Array.isArray(d.rows) && d.hosts) ? d : blank();
            } catch (_) { return blank(); }
        }

        function write(d) {
            if (!store) return;
            try { store.save(JSON.stringify(d)); } catch (_) {}
        }

        // Codes and short labels only. Cut at the first / ? # so a URL handed in by mistake keeps none of its path.
        const clean = (s, n) => String(s == null ? '' : s).split(/[/?#]/)[0].replace(/[^\w .+-]/g, '').slice(0, n || 24);

        // The bare hostname, even from a whole URL — a path must never survive into the log.
        function hostName(h) {
            let s = String(h || '').toLowerCase().trim();
            const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/.exec(s);
            if (m) s = m[1];
            s = s.split(/[/?#]/)[0].replace(/^[^@]*@/, '');
            return s.replace(/[^a-z0-9.:-]/g, '').slice(0, 80);
        }

        // Seconds from a Retry-After header value, which is legally either a count or an HTTP date.
        function retryAfterSecs(v) {
            if (v == null || v === '') return null;
            const s = String(v).trim();
            if (/^\d+$/.test(s)) return Math.min(999999, parseInt(s, 10));
            const t = Date.parse(s);
            return isNaN(t) ? null : Math.max(0, Math.round((t - clock()) / 1000));
        }

        // Pull Retry-After out of the newline-delimited header blob both fetch paths produce.
        function retryAfterOf(headers) {
            const m = /^[ \t]*retry-after[ \t]*:[ \t]*(.*)$/im.exec(String(headers || ''));
            return m ? retryAfterSecs(m[1]) : null;
        }

        // One background read — a run of requests the caller is about to make at one pace.
        // Returns null when logging is off, so every call site is `const lg = usLog.start(...)`
        // followed by `lg && lg.something()`.
        function start(kind, opts) {
            if (!enabled()) return null;
            opts = opts || {};
            const row = {
                t: clock(), h: hostName(opts.host), i: inst, k: clean(kind, 12),
                p: clean(opts.pace, PACE_MAX), n: 0, ok: 0, pg: 0, ms: 0,
                sp: null, out: 'open', nr: opts.slowed ? 1 : 0, ev: []
            };
            const starts = [];
            let ended = false;

            // Each request stamps its own start, so the spacing the forum actually saw is
            // measured rather than assumed from the configured gap.
            function req() {
                starts.push(clock() - row.t);
                row.n++;
                let settled = false;
                return {
                    done(info) {
                        if (settled) return;
                        settled = true;
                        info = info || {};
                        const st = info.status | 0;
                        if (info.limited) {
                            if (row.ev.length < evMax) {
                                row.ev.push({
                                    a: row.n, s: st, w: clean(info.signal, 6) || 'hard',
                                    ra: info.retryAfter == null ? null : info.retryAfter | 0,
                                    dt: clock() - row.t
                                });
                            }
                        } else if (st >= 200 && st < 400) {
                            row.ok++;
                            if (info.topics > 0) row.pg++;
                        }
                    }
                };
            }

            function spacing() {
                if (starts.length < 2) return null;
                const gaps = [];
                for (let i = 1; i < starts.length; i++) gaps.push(starts[i] - starts[i - 1]);
                gaps.sort((a, b) => a - b);
                return [gaps[0], gaps[(gaps.length - 1) >> 1], gaps[gaps.length - 1]].map(x => Math.round(x));
            }

            // Append this read and update its host's running totals. The store is RE-READ here
            // rather than trusted from when the read began: another tab may have written since,
            // and this saves the whole list back.
            function end(outcome) {
                if (ended) return;
                ended = true;
                open.delete(handle);
                row.ms = clock() - row.t;
                row.sp = spacing();
                row.out = clean(outcome, 10) || 'done';
                const d = read();
                const hs = d.hosts[row.h] || (d.hosts[row.h] = { reads: 0, reqs: 0, limits: 0, first: row.t, last: 0 });
                row.since = hs.last ? row.t - hs.last : null;
                hs.reads++;
                hs.reqs += row.n;
                hs.limits += row.ev.length;
                hs.last = row.t + row.ms;
                d.rows.push(row);
                if (d.rows.length > max) d.rows.splice(0, d.rows.length - max);
                write(d);
            }

            const handle = { req, end };
            open.add(handle);
            return handle;
        }

        // A read the page never got to finish — a navigation or a refresh in the middle of it.
        // Exactly the case a per-read flush at the end would lose, and the one most worth having.
        function cutOpen() {
            for (const h of Array.from(open)) h.end('cut');
        }

        // A one-off worth a row of its own: a host demoted, or put back. Codes only, no prose.
        function note(kind, opts) {
            if (!enabled()) return;
            opts = opts || {};
            const d = read();
            const h = hostName(opts.host);
            const row = {
                t: clock(), h, i: inst, k: clean(kind, 12), p: clean(opts.pace, PACE_MAX),
                n: 0, ok: 0, pg: 0, ms: 0, sp: null, out: clean(opts.out, 10) || 'note', nr: 0, ev: []
            };
            if (opts.status || opts.signal || opts.retryAfter != null) {
                row.ev.push({
                    a: 0, s: opts.status | 0, w: clean(opts.signal, 6) || 'hard',
                    ra: opts.retryAfter == null ? null : opts.retryAfter | 0, dt: 0
                });
            }
            const hs = d.hosts[h] || (d.hosts[h] = { reads: 0, reqs: 0, limits: 0, first: row.t, last: 0 });
            if (row.ev.length) hs.limits++;
            d.rows.push(row);
            if (d.rows.length > max) d.rows.splice(0, d.rows.length - max);
            write(d);
        }

        // UTC always: a fingerprinting-resistant browser may report UTC as local time, so local would be ambiguous.
        const stamp = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
        const day = (ms) => stamp(ms).slice(0, 10);

        // Coarse but readable: the field exists to tell "an hour later" from "one minute later".
        function dur(ms) {
            if (ms == null) return '-';
            const s = Math.round(ms / 1000);
            if (s < 90) return s + 's';
            const m = Math.round(s / 60);
            if (m < 90) return m + 'm';
            const h = Math.round(m / 6) / 10;
            return (h < 48 ? h + 'h' : Math.round(h / 24) + 'd');
        }

        const secs = (ms) => (ms >= 10000 ? Math.round(ms / 1000) + 's' : (Math.round(ms / 100) / 10) + 's');

        function evText(ev) {
            return ev.map(e => '@' + e.a + ' ' + (e.s || '-') + ' ' + e.w
                + (e.ra == null ? '' : ' ra' + e.ra) + ' +' + secs(e.dt)).join('  ');
        }

        // One line per read, readable by eye and parseable by column. `anon` replaces each
        // hostname with siteN, numbered by first appearance, which is the only field that
        // identifies anything.
        function text(opts) {
            opts = opts || {};
            const d = read();
            const names = {};
            let next = 1;
            const nm = (h) => {
                if (!opts.anon) return h || '-';
                if (!names[h]) names[h] = 'site' + next++;
                return names[h];
            };
            for (const r of d.rows) nm(r.h);

            const limits = d.rows.reduce((n, r) => n + r.ev.length, 0);
            const out = [
                '# us-log v' + V + ' — ' + stamp(clock()) + ' — ' + d.rows.length + ' rows, ' + limits + ' limit events',
                '# No URL, path, query or page title is ever recorded.'
                + (opts.anon ? ' Hostnames are replaced with siteN.' : ' Hostnames are real in this copy.'),
                '# cols: when (UTC) | site | kind | pace | ok/req | pages | elapsed | spacing min/med/max'
                + ' | since prev read | slowed | outcome | limit events',
                ''
            ];
            const hosts = Object.keys(d.hosts).sort();
            for (const h of hosts) {
                const s = d.hosts[h];
                out.push('# ' + nm(h) + '  reads ' + s.reads + '  requests ' + s.reqs + '  limits ' + s.limits
                    + '  first ' + day(s.first) + '  last ' + (s.last ? day(s.last) : '-'));
            }
            out.push('');
            for (const r of d.rows) {
                out.push([
                    stamp(r.t), nm(r.h), r.k, r.p || '-',
                    r.ok + '/' + r.n, 'pg' + r.pg, secs(r.ms),
                    r.sp ? 'sp ' + r.sp.join('/') : 'sp -',
                    'prev ' + dur(r.since),
                    r.nr ? 'SLOWED' : '-',
                    r.out, evText(r.ev)
                ].join('  ').trimEnd());
            }
            return out.join('\n') + '\n';
        }

        const count = () => read().rows.length;
        // Rows kept, and limit events among them — enough for a settings line to say "it happened".
        function stats() {
            const d = read();
            return { rows: d.rows.length, limits: d.rows.reduce((n, r) => n + r.ev.length, 0) };
        }
        const clear = () => write(blank());

        return { init, enable, enabled, start, cutOpen, note, text, count, stats, clear,
            retryAfterOf, retryAfterSecs };
    })();
    // ==== us-log end ====

    // -------------------------------------------------------------------- tour

    // Next/previous through every picture on the page, from the pinned window. The window stays
    // put, the page does not move, each step swaps a different picture into the same frame.
    // docs/TOUR.md is the specification; nothing here keeps a list between presses.

    let tour = null;            // the pinned window's navigation state; null when nothing is pinned

    const TOUR_ROW = 0.5;       // share of the shorter item's height that puts two in one row

    // Is a tour under way — as opposed to a window merely pinned? Geometry reads this.
    function tourActive() { return !!tour && tour.on; }

    // What the page draws it as, or failing that what its attributes say it will be. A lazy
    // image below the fold is often 0×0 until it loads and must not fall out for it. Null means
    // unknown, and unknown stays in the list: only a probe can settle it. See TOUR.md §1.
    function tourSize(el) {
        const r = passRect(el);
        if (r.width >= 1 || r.height >= 1) return { w: r.width, h: r.height };
        const w = parseInt(el.getAttribute('width') || '0', 10) || 0;
        const h = parseInt(el.getAttribute('height') || '0', 10) || 0;
        return (w || h) ? { w: w, h: h } : null;
    }

    // Reading order: items overlapping a row's FIRST item join that row, sorted left to right
    // inside it. A plain (top, left) sort scrambles ragged grids; a growing band walks masonry by column.
    function tourOrder(items) {
        items.sort(function (a, b) { return a.y - b.y || a.x - b.x || a.n - b.n; });
        const rows = [];
        items.forEach(function (it) {
            const row = rows[rows.length - 1];
            const over = row ? Math.min(row.top + row.h, it.y + it.h) - Math.max(row.top, it.y) : -1;
            if (row && over >= Math.min(row.h, it.h) * TOUR_ROW) row.items.push(it);
            else rows.push({ top: it.y, h: it.h, items: [it] });
        });
        const out = [];
        rows.forEach(function (row) {
            row.items.sort(function (a, b) { return a.x - b.x || a.n - b.n; });
            for (let i = 0; i < row.items.length; i++) out.push(row.items[i]);
        });
        return out;
    }

    // ---- the scope: the tour stays inside the area of the page it started in. See TOUR.md §1a.

    const TOUR_WRAP_ELS = 8;    // fewer elements around its pictures than this, and a block is a wrapper
    const TOUR_WRAP_TEXT = 200; // ...and fewer characters of text than this

    // What the tour may hold: a hover's gates, then the tour's own floor on the drawn size.
    // Unknown size stays in — a lazy image below the fold is often 0×0 until it loads.
    function tourWorthy(el, floor) {
        if (!el.getClientRects().length || !shownMedia(el)) return false;
        if (!eligibleDirect(el) || latePlayerArea(el)) return false;
        const s = tourSize(el);
        if (!s) return true;
        if (s.w && s.w < cfg.minDisplayed && s.h && s.h < cfg.minDisplayed) return false;
        if (stripShaped(s.w, s.h) || siteLogo(el)) return false;
        return Math.max(s.w, s.h) >= floor;
    }

    const STRIP_SHORT = 32;     // px: thinner than this...
    const STRIP_RATIO = 10;     // ...and this many times longer is a divider rule, not a picture

    // A thin rule between posts, drawn as an image.
    function stripShaped(w, h) {
        const lo = Math.min(w, h), hi = Math.max(w, h);
        return lo > 0 && lo < STRIP_SHORT && hi >= lo * STRIP_RATIO;
    }

    // The site's own logo: near the top, linking to this site's home page.
    function siteLogo(el) {
        const a = el.closest && el.closest('a[href]');
        if (!a) return false;
        let u;
        try { u = new URL(a.href); } catch (e) { return false; }
        if (u.hostname.toLowerCase().replace(/^www\./, '') !== pageHost().replace(/^www\./, '')) return false;
        if (!/^\/(index\.\w+)?$/.test(u.pathname) || u.search) return false;
        return passRect(el).top + (window.scrollY || 0) < BANNER_TOP;
    }

    // Reused while the page key holds, like tourEntries(): one step asks several times. See TOUR.md §3.
    let picsMemo = null;
    function tourPics(floor) {
        const key = pageKey() + '|' + floor;
        const m = picsMemo;
        if (m && m.key === key && m.cfg === cfg && Date.now() - m.t < TOUR_LIST_MS &&
            m.pics.every(function (p) { return p.isConnected; })) return m.pics.slice();
        const all = document.querySelectorAll('img,video');
        const pics = [];
        for (let i = 0; i < all.length; i++) if (tourWorthy(all[i], floor)) pics.push(all[i]);
        picsMemo = { key: key, cfg: cfg, t: Date.now(), pics: pics };
        return pics.slice();
    }

    function countIn(node, pics) {
        let n = 0;
        for (let i = 0; i < pics.length; i++) if (node.contains(pics[i])) n++;
        return n;
    }

    function elsIn(node) { return node.querySelectorAll(':not(svg, svg *)').length; }

    // The ancestors of the start picture at which the count of pictures grows — one level per
    // count, holding the OUTERMOST element with it. The last level is the whole document.
    function tourLevels(start, pics) {
        const levels = [];
        let node = start, n = -1;
        while (node) {
            const k = countIn(node, pics);
            if (k === n) levels[levels.length - 1].el = node;
            else levels.push({ el: node, n: k });
            n = k;
            node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
        }
        return levels;
    }

    // A block that only holds pictures — a row, a paragraph, a figure — as opposed to a post,
    // which has a header, buttons and text around them. Chrome is what is left of the element
    // count once every picture's own wrapper is taken out.
    function tourWrapper(el, pics) {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().length;
        if (text >= TOUR_WRAP_TEXT) return false;
        const inside = pics.filter(function (p) { return el.contains(p); });
        let chrome = elsIn(el);
        inside.forEach(function (p) {
            let w = p;
            while (w.parentElement && w.parentElement !== el && countIn(w.parentElement, inside) === 1) w = w.parentElement;
            chrome -= elsIn(w) + 1;
        });
        return chrome < TOUR_WRAP_ELS;
    }

    // The level the tour starts at: the smallest area holding at least two pictures, widened
    // past every wrapper. `{` and `}` move it from there.
    function tourPick(levels, pics) {
        let i = 0;
        while (i < levels.length - 1 && levels[i].n < 2) i++;
        while (i < levels.length - 1 && tourWrapper(levels[i].el, pics)) i++;
        return i;
    }

    function tourFloor() { return tour ? tour.floor : idleFloor(); }

    const GRID_MIN = 64;        // px, longer side: a thumbnail grid's pictures are at least this
    const GRID_RUN = 4;         // pictures of one size that make a grid
    let floorMemo = null;

    // The widget's floor: tourMinDisplayed, or a thumbnail grid's own size when fewer than two
    // pictures reach it. Profile-linked pictures (avatars) never form a grid. See TOUR.md §1a.
    function idleFloor() {
        const base = Math.max(0, cfg.tourMinDisplayed | 0);
        const key = pageKey() + '|' + base;
        if (floorMemo && floorMemo.key === key && Date.now() - floorMemo.t < TOUR_LIST_MS) return floorMemo.floor;
        let floor = base;
        if (base > GRID_MIN && idlePics(base).length < 2) {     // what the slideshow would hold, not raw sizes
            const sizes = new Map();
            inPass(function () {
                tourPics(GRID_MIN).forEach(function (p) {
                    const r = passRect(p);
                    const long = Math.round(Math.max(r.width, r.height));
                    if (long >= base) return;
                    const a = p.closest('a[href]');
                    if (a && PROFILE_URL.test(a.href)) return;
                    sizes.set(long, (sizes.get(long) || 0) + 1);
                });
            });
            let best = 0, bestN = 0;
            sizes.forEach(function (n, s) {
                let run = 0;
                for (let d = -2; d <= 2; d++) run += sizes.get(s + d) || 0;
                if (run >= GRID_RUN && (run > bestN || (run === bestN && s > best))) { best = s; bestN = run; }
            });
            if (best) floor = best - 2;
        }
        floorMemo = { key: key, t: Date.now(), floor: floor };
        return floor;
    }

    function tourStartEl() {
        if (!tour) return null;
        if (tour.start && tour.start.isConnected) return tour.start;
        return tour.el && tour.el.isConnected ? tour.el : null;
    }

    // The scope element, re-derived from the start picture only when the one held has left the
    // document — the anchor's own rule.
    function tourScopeNow(pics) {
        const root = document.documentElement;
        if (!tour) return root;
        if (tour.scope && tour.scope.isConnected) return tour.scope;
        const start = tourStartEl();
        if (!start) { tour.scope = root; return root; }
        const levels = tourLevels(start, pics);
        if (tour.level < 0) tour.level = tourPick(levels, pics);
        tour.level = Math.max(0, Math.min(levels.length - 1, tour.level));
        tour.scope = levels[tour.level].el;
        return tour.scope;
    }

    function describeEl(el) {
        if (!el || el === document.documentElement) return 'the whole page';
        let s = el.tagName.toLowerCase();
        if (el.id) s += '#' + el.id;
        if (el.classList.length) s += '.' + Array.prototype.slice.call(el.classList, 0, 3).join('.');
        return s;
    }

    // `{` narrows the scope one level, `}` widens it; neither goes below two pictures.
    function tourRescope(dir) {
        if (!tour) return;
        const pics = tourPics(tourFloor());
        const start = tourStartEl();
        if (!start) return;
        const levels = tourLevels(start, pics);
        let min = 0;
        while (min < levels.length - 1 && levels[min].n < 2) min++;
        let cur = levels.length - 1;
        if (tour.scope) for (let i = 0; i < levels.length; i++) if (levels[i].el.contains(tour.scope)) { cur = i; break; }
        const to = Math.max(min, Math.min(levels.length - 1, cur + dir));
        if (to === cur && dir > 0 && tour.postOnly) tour.postOnly = false;     // } at the whole page: the replies too
        else if (to === cur) { dbg('tour scope: already ' + (dir > 0 ? 'the whole page' : 'as narrow as it goes')); return; }
        tour.level = to;
        tour.scope = levels[to].el;
        tour.mainOnly = false;
        const list = tourSync();
        twSync();
        dbg('tour scope: ' + describeEl(tour.scope), { level: to + 1 + ' of ' + levels.length, pictures: list.length });
        if (tour.on && tour.index >= 0) plFill(list, tour.index, scrubDir);
    }

    // Everything in the scope a hover would preview, in reading order. Derived on every press;
    // sorted in DOCUMENT coordinates, or the order changes as the page scrolls.
    // tourEntriesNow(), reused for TOUR_LIST_MS while the page's shape key is unchanged. See TOUR.md §3.
    const TOUR_LIST_MS = 1500;
    let tourListMemo = null;
    function tourEntries() {
        const key = tourListKey();
        const m = tourListMemo;
        if (m && m.key === key && m.tour === tour && Date.now() - m.t < TOUR_LIST_MS &&
            (!tour || (m.scope === tour.scope && m.level === tour.level && m.postOnly === tour.postOnly &&
                m.mainOnly === tour.mainOnly)) &&
            m.cfg === cfg && m.list.every(function (e) { return !e.el || e.el.ownerDocument !== document || e.el.isConnected; })) return tourDedupe(tourRoll(m.list.slice()), true);
        const list = inPass(tourEntriesNow);
        tourListMemo = { key: key, tour: tour, cfg: cfg, t: Date.now(), list: list, scope: tour && tour.scope,
            level: tour && tour.level, postOnly: tour && tour.postOnly, mainOnly: tour && tour.mainOnly };
        return tourDedupe(tourRoll(list.slice()), true);
    }

    // Drops every later copy of a picture already in the list; the first stays. Counts what it dropped.
    let tourDupes = 0, widgetDupes = 0;
    function tourDedupe(list, isTour) {
        if (!cfg.tourSkipDupes) { if (isTour) tourDupes = 0; else widgetDupes = 0; return list; }
        const seen = new Set(), out = [];
        list.forEach(function (e) {
            let k = typeof e.pk === 'string' ? e.pk : e.pk === undefined && e.url ? e.url : null;     // a placeholder is never a duplicate
            if (k && dupOf.size) k = dupRoot(k);
            if (k && seen.has(k)) return;
            if (k) seen.add(k);
            out.push(e);
        });
        if (isTour) tourDupes = list.length - out.length; else widgetDupes = list.length - out.length;
        return out;
    }

    // ---- same picture at two addresses: the page's thumbnail re-read in CORS mode and sampled; a match is confirmed on the originals' bytes
    const FP_SIDE = 16, FP_HEAD = 65536, FP_LOAD_MS = 8000, FP_STRIKES = 3;
    const FP_THUMB_PX = 1500000;    // a shown picture bigger than this is not re-read: only small files come back from the cache
    const fpOf = new Map();         // entry key (plKey) -> { key: 'w×h|hash' of the thumbnail sample, thumb, orig }
    const dupOf = new Map();        // entry key -> the entry key it was confirmed to be a copy of
    const fpFails = new Map();      // host -> unreadable pictures so far; FP_STRIKES turns it off there

    function dupRoot(url) { let u = url, n = 0; while (dupOf.has(u) && n++ < 50) u = dupOf.get(u); return u; }

    // A picture opened in readable (CORS) mode, or null.
    function fpImage(url) {
        return new Promise(function (res) {
            const im = new Image();
            let done = false, t = 0;
            const fin = function (v) { if (!done) { done = true; clearTimeout(t); res(v); } };
            t = setTimeout(function () { fin(null); }, FP_LOAD_MS);
            im.crossOrigin = 'anonymous';
            if (noReferrerHere()) im.referrerPolicy = 'no-referrer';
            im.onload = function () { fin(im); };
            im.onerror = function () { fin(null); };
            im.src = url;
        });
    }

    // The picture's pixels with its long side at most `side`, or null when the browser refuses. Decoded and scaled off the main thread.
    async function fpPixels(im, side) {
        const w = im.naturalWidth, h = im.naturalHeight;
        if (!w || !h) return null;
        const s = Math.min(1, side / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * s));
        c.height = Math.max(1, Math.round(h * s));
        try {
            const bmp = await createImageBitmap(im, { resizeWidth: c.width, resizeHeight: c.height, resizeQuality: 'medium' });
            const g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(bmp, 0, 0);
            bmp.close();
            return g.getImageData(0, 0, c.width, c.height).data;
        } catch (e) { return null; }
    }

    function fpHash(d) {
        let h = 0x811c9dc5;
        for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
        return (h >>> 0).toString(36);
    }

    function fpSame(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    function fpFail(url) {
        const host = hostOf(url), n = (fpFails.get(host) || 0) + 1;
        fpFails.set(host, n);
        if (n === FP_STRIKES) dbg('duplicates: pictures on ' + host + ' cannot be read, so copies there are found by address only');
    }

    // Two small pictures read in full and compared pixel for pixel.
    async function fpSameThumb(a, b) {
        const ia = await fpImage(a), ib = ia && await fpImage(b);
        if (!ia || !ib) { fpFail(a); return false; }
        return fpSame(await fpPixels(ia, Infinity), await fpPixels(ib, Infinity));
    }

    // A file's total size and a hash of its first FP_HEAD bytes, from one ranged request; '' when unreadable.
    async function fpHead(url) {
        let r = null;
        if (typeof GM_xmlhttpRequest === 'function') r = await rangeGet(url, FP_HEAD, FP_LOAD_MS);
        else {      // the test pages, which have no GM_xhr
            try {
                const f = await fetch(url, { headers: { Range: 'bytes=0-' + (FP_HEAD - 1) } });
                let h = '';
                f.headers.forEach(function (v, k) { h += k + ': ' + v + '\n'; });
                const b = await f.arrayBuffer();
                r = { status: f.status, headers: h, bytes: new Uint8Array(b, 0, Math.min(FP_HEAD, b.byteLength)) };
            } catch (e) { r = null; }
        }
        if (!r || !r.bytes || r.status < 200 || r.status >= 300) return '';
        const size = sizeFromHeaders(r.headers, r.status) || '?';
        return size + '|' + fpHash(r.bytes);
    }

    async function fpSameFile(a, b) {
        const ha = await fpHead(a), hb = ha && await fpHead(b);
        if (!ha || !hb) { fpFail(a); return false; }
        return ha === hb;
    }

    // Samples a preloaded entry's thumbnail; one matching an earlier thumbnail is checked on the originals, and a match drops it from the slideshow.
    async function fpTake(el, res) {
        if (!cfg.tourSkipDupes || !el || el.tagName !== 'IMG' || !res || res.video || !res.url) return;
        const pk = plKey(el), thumb = pictureUrl(el);
        if (typeof pk !== 'string' || !thumb || fpOf.has(pk) || dupOf.has(pk)) return;
        if (!(el.naturalWidth * el.naturalHeight <= FP_THUMB_PX) || (fpFails.get(hostOf(thumb)) || 0) >= FP_STRIKES) return;
        fpOf.set(pk, null);
        const im = await fpImage(thumb);
        const px = im && await fpPixels(im, FP_SIDE);
        if (!px) { fpFail(thumb); return; }
        const me = { key: im.naturalWidth + '×' + im.naturalHeight + '|' + fpHash(px), thumb: thumb, orig: res.url };
        fpOf.set(pk, me);
        for (const [k, o] of fpOf) {
            if (k === pk || !o || o.key !== me.key || dupRoot(k) === dupRoot(pk)) continue;
            if (o.thumb !== me.thumb && !await fpSameThumb(o.thumb, me.thumb)) continue;
            if (o.orig !== me.orig && !await fpSameFile(o.orig, me.orig)) continue;
            dupOf.set(pk, dupRoot(k));
            dbg('duplicates: the same picture at two addresses', { first: o.orig.slice(-60), copy: me.orig.slice(-60) });
            if (tour) tourSync();
            else if (tw) twTotal = widgetEntries().length;
            twSync();
            return;
        }
    }

    // A feed that unmounts what scrolled away (Imgur) keeps it in the slideshow: an entry whose
    // element left the document stays, by picture and position, until the page mounts that picture
    // again or puts a different one in its place. See TOUR.md §1d.
    function tourRoll(list) {
        if (!tour) return list;
        if (tourIsWidget()) return rollMerge(list, pageRoll, widgetSig());
        return rollMerge(list, tour, location.href + '|' + tour.level + '|' + !!tour.postOnly + '|' + !!tour.mainOnly + '|' + tourFloor());
    }

    // The widget's list, tracked whether a slideshow is open or not, so the count and the position
    // hold across scrolling, closing and reopening, and a pinned start lands on the same list.
    const pageRoll = { roll: null, rollSig: '', recycles: false };
    function widgetSig() { return location.href + '|' + idleFloor(); }
    function tourIsWidget() { return !!tour && !!tour.mainOnly && !!tour.postOnly && tour.floor === idleFloor(); }

    // What the widget counts and ▶ opens on: the main column down to the post end, plus what the page unmounted.
    function widgetEntries() {
        const floor = idleFloor();
        const main = idlePics(floor);
        return tourDedupe(rollMerge(inPass(function () { return tourEntriesIn(main, tourCommon(main), true); }), pageRoll, widgetSig()), false);
    }

    function rollMerge(list, holder, sig) {
        const live = [], tail = [];
        list.forEach(function (e) { (e.el && e.el.ownerDocument === document ? live : tail).push(e); });
        if (!holder.roll || holder.rollSig !== sig) { holder.roll = []; holder.rollSig = sig; holder.recycles = false; }
        const keys = new Set(live.map(rollKey));
        const kept = holder.roll.filter(function (g) {
            if (g.el && g.el.isConnected) return false;         // still on the page: the live list speaks for it
            if (keys.has(rollKey(g))) return false;             // mounted again as a new element
            return !live.some(function (e) { return rollOver(e, g); });     // something else is there now
        }).map(function (g) { return Object.assign({}, g, { ghost: true }); });
        if (!kept.length) { holder.roll = live; return list; }
        holder.recycles = true;
        const all = live.concat(kept);
        all.forEach(function (e, i) { e.n = i; });
        holder.roll = tourOrder(all);
        return holder.roll.concat(tail);
    }

    // The live entry for a remembered one: the same picture remounted, else whatever now fills its spot.
    function rollFind(list, pk, spot) {
        const liveOf = function (e) { return !e.ghost && e.el && e.el.ownerDocument === document; };
        for (let i = 0; i < list.length; i++) if (liveOf(list[i]) && rollKey(list[i]) === pk) return list[i];
        for (let i = 0; i < list.length; i++) if (liveOf(list[i]) && rollOver(list[i], spot)) return list[i];
        return null;
    }

    // Wait for the page to mount a remembered entry after following scrolled to it.
    async function ghostLive(entry, myToken) {
        for (let i = 0; i < GHOST_LOOKS.length; i++) {
            await sleep(GHOST_LOOKS[i] - (i ? GHOST_LOOKS[i - 1] : 0));
            if (myToken.cancelled || !tour) return null;
            const hit = rollFind(tourEntries(), entry.pk, entry);
            if (hit) return hit;
        }
        return null;
    }

    function rollKey(e) { return typeof e.pk === 'string' ? e.pk : e.url; }

    // Two entries covering over half of the smaller one: the same spot on the page.
    function rollOver(a, b) {
        const w = Math.min(a.x + (a.w || 0), b.x + (b.w || 0)) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        return w > 0 && h > 0 && w * h > 0.5 * Math.min((a.w || 0) * a.h, (b.w || 0) * b.h);
    }

    function tourListKey() { return pageKey() + '|' + harvest.length + '|' + tourFloor(); }

    // Cheap reads that change when the pictures do: counts, sizes, and the length of every src.
    function pageKey() {
        const b = document.body;
        let srcs = 0, n = 0;
        [document.getElementsByTagName('img'), document.getElementsByTagName('video')].forEach(function (c) {
            for (let i = 0; i < c.length; i++) { srcs += (c[i].currentSrc || c[i].src || '').length; n++; }
        });
        return location.href + '|' + document.getElementsByTagName('*').length + '|' + n + '|' + srcs + '|' +
            vpW() + 'x' + vpH() + '|' + (b ? b.scrollHeight : 0);
    }

    function tourEntriesNow() {
        let pics = tourPics(tourFloor());
        if (tour && tour.postOnly) pics = postPics(pics);
        // Started from the widget: the area is re-derived like the widget's own count, so batches
        // the page mounts as it follows the tour join it.
        if (tour && tour.mainOnly) { pics = mainPics(pics); tour.scope = tourCommon(pics); }
        return tourEntriesIn(pics, tourScopeNow(pics));
    }

    function tourEntriesIn(pics, scope, noTail) {
        const root = document.documentElement;
        const sx = window.scrollX || 0, sy = window.scrollY || 0;
        const items = [];
        for (let i = 0; i < pics.length; i++) {
            const el = pics[i];
            if (scope !== root && !scope.contains(el)) continue;
            const r = passRect(el);
            items.push({ el: el, url: pictureUrl(el), pk: plKey(el), x: r.left + sx, y: r.top + sy,
                w: r.width, h: r.height, n: items.length });
        }
        const live = tourOrder(items);
        // Pages fetched from the pager come after everything this document holds, in the order
        // they were harvested — they have no document coordinates to be sorted by. See §10.
        if (noTail) return live;
        return harvest.length && scope === root && !tourConfined() ? live.concat(harvest) : live;
    }

    // Kept to part of this page — a narrowed scope, or the post above its replies: no next page.
    function tourConfined() {
        return !!tour && (!!tour.postOnly || (!!tour.scope && tour.scope !== document.documentElement));
    }

    // Where the anchor sits in a freshly derived list: element identity, then URL. Never an
    // index — the list changes length under us.
    function tourAt(list) {
        if (!tour) return -1;
        for (let i = 0; i < list.length; i++) if (list[i].el === tour.el) return i;
        if (tour.url) for (let i = 0; i < list.length; i++) if (list[i].url === tour.url) return i;
        return -1;
    }

    function tourBefore(it) {
        return it.y < tour.y - 1 || (it.y <= tour.y + 1 && it.x < tour.x);
    }

    // The index a step of `dir` lands on, or -1 for "nothing that way".
    function tourTarget(list, dir) {
        if (!list.length || !tour) return -1;
        const at = tourAt(list);
        if (at >= 0) {
            const to = at + dir;
            return to >= 0 && to < list.length ? to : -1;
        }
        // The anchor was destroyed under us — a virtualised feed does this. Step from the last
        // position it was seen at, in the direction of travel.
        let k = 0;
        while (k < list.length && tourBefore(list[k])) k++;
        return Math.max(0, Math.min(list.length - 1, dir > 0 ? k : k - 1));
    }

    function tourRemember(entry) {
        tour.el = entry.el;
        tour.url = entry.url;
        tour.pk = entry.pk;
        tour.ghost = !!entry.ghost;
        tour.x = entry.x;
        tour.y = entry.y;
        tour.w = entry.w || 0;
        tour.h = entry.h || 0;
        tourFollow(entry.el, entry);
    }

    // The page scrolls behind the preview to keep the anchor on screen, so a feed that empties
    // what is far from the viewport (Google in Firefox) mounts the next section as the tour walks.
    // Ahead, as a reader scrolls: the picture near the top, so the page shows what comes next.
    const FOLLOW_TOP = 0.1, FOLLOW_BAND = 0.4;      // fractions of the viewport height
    function tourFollow(el, entry) {
        if (!el || el.__hzBase || !growsHere()) return;
        const ghost = !el.isConnected;
        if (ghost && !(entry && entry.ghost)) return;
        const h = vpH();
        if (!(h > 0)) return;
        const sy = window.scrollY || 0;
        const r = ghost ? { top: entry.y - sy, bottom: entry.y + entry.h - sy } : el.getBoundingClientRect();
        // A picture that fits the first screen: the page goes to its very top, so the scrollbar says so.
        if (r.bottom + sy <= h) {
            if (sy > 0) try { window.scrollTo({ left: window.scrollX || 0, top: 0, behavior: 'instant' }); } catch (e) { /* stays */ }
            return;
        }
        const top = r.top;
        if (top >= h * FOLLOW_TOP - 1 && top <= h * FOLLOW_BAND) return;
        if (ghost) {
            try { window.scrollBy({ left: 0, top: top - h * FOLLOW_TOP, behavior: 'instant' }); } catch (e) { /* stays */ }
            return;
        }
        try {
            if (docHeight() > h + EXC_EDGE_PX) window.scrollBy({ left: 0, top: top - h * FOLLOW_TOP, behavior: 'instant' });
            else el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });    // an inner scroller
        } catch (e) { dbg('tour: could not bring the picture on screen', String(e)); }
    }

    // Re-derive and report where the anchor is. The index and total are the only things kept
    // between presses, and only because the counter shows them.
    function tourSync() {
        if (!tour) return null;
        const list = tourEntries();
        tour.index = tourAt(list);
        tour.total = list.length;
        return list;
    }

    // The picture the window was pinned on sets the tour's area and its size floor: it is the
    // user's example of what they want to see. A tour begun on a 100px thumbnail admits 100px.
    function tourStart() {
        tour = { el: active || null, start: active || null, url: activeShown || (view ? view.url : ''),
            x: 0, y: 0, index: -1, total: 0, on: false,
            scope: null, level: -1, floor: idleFloor() };
        if (tour.el) {
            const r = tour.el.getBoundingClientRect();
            tour.x = r.left + (window.scrollX || 0);
            tour.y = r.top + (window.scrollY || 0);
            if (idlePics(tour.floor).indexOf(tour.el) >= 0) {
                tour.mainOnly = true;   // one of the widget's pictures: the widget's list and count, from here
                tour.postOnly = true;
            } else {
                const s = tourSize(tour.el);
                const long = s ? Math.max(s.w, s.h) : 0;
                if (long >= 1 && long < tour.floor) tour.floor = Math.floor(long);
                const pe = postEnd();       // begun in the post: its replies stay out; begun in them, they are the tour
                tour.postOnly = !!pe && !!pe.cut && !atOrAfter(pe.cut, tour.el);
            }
        }
        tour.had = new Set(tourPics(tour.floor));   // at the final floor, or tourAdopt() sees old pictures as new
    }

    function tourEnd() {
        clearTimeout(tourRestTimer);
        seamDir = 0;
        if (seamNoteEl) seamNoteEl.classList.remove('on');
        twWheelSet(false);
        tour = null;
        plStop();
        crossReset();
        excSpent = false;       // a fresh tour asks the page again; it may have grown since
        twRefresh();
    }

    // ---- the widget: ◀ n / N ▶ in its own fixed box, placed by the shared dock. See TOUR.md.

    const DOCK_KEY = 'hoverZoomDock';   // GM: { sites: { host: spec }, last: spec }
    const TW_NEAR = 60;                 // px: the pointer this close lights the widget up
    const TW_RECOUNT_MS = 300;          // after scrolling stops, the page is counted again

    let tw = null;              // { host, box, prev, count, next, dock, rect, near }
    let twPics = 0;             // pictures on the page by the cheap count, capped at 2
    let twTotal = -1;           // the real count: at load, when scrolling stops, and when the pointer nears the widget
    let twStarting = null;      // the token of a tour being opened from the widget
    let twRecountTimer = 0;
    let twLoadTimer = 0;
    const TW_HELP_MS = 1000;    // the widget's help waits longer than a button's tip
    const TW_HELP = '◀ ▶  previous / next; hold to repeat\n' +
        '⇅  wheel near it flips; click: wheel flips anywhere\n' +
        'Drag to move; Ctrl: no snapping';
    let twGalOpen = false;      // a gallery is open: its own strip steps it, so the widget goes
    let twWheelArmed = null;    // the URL the wheel button was clicked on; the wheel then steps anywhere
    let twWheelIn = false;      // the pointer is within wheelRange of the button
    let twWheelAcc = 0;         // wheel travel not yet stepped on, px
    let twWheelLast = 0;        // the last wheel event we took
    const TW_WHEEL_STEP_PX = 50;    // a notch is 100; a touchpad sends many small ones
    let twWheelWantAt = 0;      // the last wheel step asked for, taken or not
    let twWheelRun = 0;         // wheel steps asked for in a row, each within STEP_GAP_MS of the last
    let twWheelTimes = [];      // when each wheel step was asked for, the last FAST_WHEEL_MS
    let twWheelHush = null;     // { t0, last }: the wheel that opened the slideshow; the rest of that spin is dropped
    const TW_HUSH_QUIET_MS = 300;   // the hush ends when the wheel rests this long
    const TW_HUSH_MAX_MS = 500;     // or this long after the opening tick, still spinning
    const PTR_KEY = 'hoverZoomPointer';
    const PTR_KEEP_MS = 30000;
    let twPtr = ptrLoad();      // the last pointer position seen, carried over a navigation in this tab
    let twHoldT = 0;            // ◀ ▶ held down: the repeat timer
    let twHeld = false;         // this press repeated, so its click must not step again
    const TW_HOLD_DELAY_MS = 500;   // Windows' default keyboard repeat delay and rate
    const TW_HOLD_EVERY_MS = 33;

    function dockStore() {
        try {
            const v = JSON.parse(GM_getValue(DOCK_KEY, 'null'));
            if (v && typeof v === 'object') return v;
        } catch (e) { console.warn('[Hover Zoom] widget position unreadable; using the default', e); }
        return { sites: {}, last: null };
    }

    // This site's position, else the last one saved anywhere, else the default.
    function dockLoad() {
        const st = dockStore();
        return (st.sites && st.sites[pageHost()]) || st.last || null;
    }

    function dockSave(spec) {
        const st = dockStore();
        st.sites = st.sites || {};
        st.sites[pageHost()] = spec;
        st.last = spec;
        GM_setValue(DOCK_KEY, JSON.stringify(st));
    }

    // First run: on top of Forum Stumbler's bar when it is on the page, the window's corner when not.
    function dockInitial() {
        const win = { r: 'win', m: 'e', t: 'e', o: 0 };
        return { x: { r: 'forum-stumbler', m: 'e', t: 'e', o: 0 }, y: { r: 'forum-stumbler', m: 'e', t: 's', o: 0 },
            fx: win, fy: win, ov: [] };
    }

    function buildTourWidget() {
        if (tw || !isTopFrame || !document.body) return;
        const host = document.createElement('div');
        host.id = 'hover-zoom-tour';
        // `all:initial` would out-rank [hidden], so visibility is `display`, set by twRefresh().
        host.style.cssText = 'all:initial;position:fixed;right:0;bottom:0;z-index:2147483647;' +
            'width:max-content;display:none';
        const sr = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = [
            ':host{all:initial}',
            '.tw{display:flex;align-items:center;justify-content:center;gap:' + NAV_GAP + 'px;box-sizing:border-box;',
            'height:' + VCTL_H + 'px;padding:0 ' + VCTL_PAD + 'px;border-radius:8px;',
            'background:var(--bg);border:1px solid var(--border);box-shadow:var(--shadow);',
            'font:13px/16px ' + usDock.FONT + ';color:var(--text);white-space:nowrap;cursor:move;',
            'user-select:none;transition:opacity .15s ease}',
            '.count{flex:none;padding:0 4px;font-variant-numeric:tabular-nums;color:var(--text)}',
            '.load{flex:none;padding:0 2px;font-size:11px;font-variant-numeric:tabular-nums;color:var(--muted)}',
            '.load.done{color:var(--done)}',
            '.dup{margin-left:3px;font-size:9px;color:var(--dup)}',
            '.dup:empty{display:none}',
            '.dead{margin-left:3px;font-size:10px;color:var(--dead)}',
            '.dead:empty{display:none}',
            '.load:empty{display:none}',
        ].concat(vbtnCss(), [
            '.tw .vbtn{color:var(--text)}',
            '.tw .vbtn:hover{background:var(--bg3)}',
            '.tw .vbtn.faint:hover{background:none}',
            '.tw .vbtn.wheel.armed,.tw .vbtn.wheel.armed:hover{background:#89b4fa;color:#1e1e2e}',
        ]).join('');
        sr.appendChild(style);
        const box = document.createElement('div');
        box.className = 'tw';
        const prev = mkVBtn(ICON_PREV, null, function () { if (!twHeld) twPress(-1); });
        const count = document.createElement('span');
        count.className = 'count';
        const num = document.createTextNode('');
        const dup = document.createElement('span');
        dup.className = 'dup';
        const deadEl = document.createElement('span');
        deadEl.className = 'dead';
        count.appendChild(num);
        count.appendChild(dup);
        count.appendChild(deadEl);
        setTip(count, TW_HELP, TW_HELP_MS);
        const next = mkVBtn(ICON_NEXT, null, function () { if (!twHeld) twPress(1); });
        twHoldOn(prev, -1);
        twHoldOn(next, 1);
        const wheel = mkVBtn(ICON_WHEEL, null, twWheelClick);
        wheel.classList.add('wheel');
        const load = document.createElement('span');
        load.className = 'load';
        box.appendChild(prev);
        box.appendChild(count);
        box.appendChild(next);
        box.appendChild(wheel);
        box.appendChild(load);
        sr.appendChild(box);
        tw = { host: host, box: box, prev: prev, count: count, num: num, dup: dup, dead: deadEl, next: next, wheel: wheel, load: load, dock: null, rect: null, near: false };
        // A pointer already resting where the widget appears sends no mousemove, only this.
        host.addEventListener('mouseover', function (e) { twNear(e.clientX, e.clientY); });
        document.body.appendChild(host);
        tw.dock = usDock.create({ id: 'hover-zoom', el: host, load: dockLoad, save: dockSave, initial: dockInitial,
            radius: 8, fill: true,
            // The natural size: the width a stacked wider widget lends is an output.
            size: function () {
                const mw = box.style.minWidth;
                box.style.minWidth = '';
                const r = host.getBoundingClientRect();
                box.style.minWidth = mw;
                return [r.width, r.height];
            },
            apply: function (r) {
                tw.rect = r;
                box.style.minWidth = r.w + 'px';
                host.style.left = r.x + 'px';
                host.style.top = r.y + 'px';
                host.style.right = 'auto';
                host.style.bottom = 'auto';
                setTimeout(twNearAgain, 0);
            },
            onDrag: function (on) { if (on) { hideTip(); cancel(); } } });
        if (typeof GM_addValueChangeListener === 'function') {
            try {
                GM_addValueChangeListener(DOCK_KEY, function (name, o, n, remote) { if (remote && tw) tw.dock.reload(); });
            } catch (e) { /* not all managers implement it */ }
        }
    }

    // Two drawn pictures at the tour's floor are enough to show the widget; stop counting there.
    function twCount() {
        const floor = Math.max(1, idleFloor());
        const all = document.querySelectorAll('img,video');
        let n = 0;
        for (let i = 0; i < all.length && n < 2; i++) {
            const r = all[i].getBoundingClientRect();
            if (Math.max(r.width, r.height) >= floor) n++;
        }
        return n;
    }

    function twWanted() {
        return !!cfg.tourButtons && isTopFrame && siteEnabled() && !CAPTCHA_HERE && !twGalOpen && (!!tour || (twPics >= 2 && twTotal >= 2));
    }

    function twRefresh() {
        if (!isTopFrame || !document.body) return;
        setTimeout(pgTick, 0);                  // never during boot, as below
        if (cfg.showPostEnd || postLine || sideLines.length) tourLinesSync();
        if (!tw) {
            if (!cfg.tourButtons || !siteEnabled() || CAPTCHA_HERE) return;
            buildTourWidget();
        }
        twPics = twCount();
        const was = twTotal;
        if (!tour) twTotal = twPics >= 2 ? widgetEntries().length : 0;
        if (!tour && twTotal !== was && debugOn()) dbg('widget count ' + twTotal, twReport());
        if (twWheelArmed && twWheelArmed !== location.href) twWheelSet(false);
        const on = twWanted();
        if (on) twTheme();
        if (on) setTimeout(twWarmFirst, 0);     // never during boot: it reads `let`s declared further down
        const shown = tw.host.style.display !== 'none';
        if (on !== shown) {
            tw.host.style.display = on ? 'block' : 'none';
            tw.dock.show(on);
            if (on) setTimeout(twNearAgain, 0);
        }
        twSync();
        twLoadLater();
    }

    function twLoadLater() { if (!twLoadTimer) twLoadTimer = setTimeout(twLoadSync, 250); }

    // How many of the slideshow's pictures are already answered: "212 loaded", then "all loaded".
    function twLoadSync() {
        twLoadTimer = 0;
        if (!tw || tw.host.style.display === 'none') return;
        if (!debugOn()) {       // the label is debug-only; the count costs a full scan
            if (tw.load.textContent) { tw.load.textContent = ''; tw.dock.sizeChanged(); }
            return;
        }
        const els = tour ? tourEntries() : widgetEntries();
        let n = 0;
        els.forEach(function (e) { if (plDone.has(e.pk || plKey(e.el))) n++; });
        const all = n > 0 && n >= els.length;
        const text = !n || !debugOn() ? '' : all ? 'all loaded' : n + ' loaded';
        if (tw.load.textContent === text) return;
        tw.load.textContent = text;
        tw.load.classList.toggle('done', all);
        setTip(tw.load, n + ' of ' + els.length + ' pictures loaded ahead');
        tw.dock.sizeChanged();
    }

    // RNFP's palette, light or dark by the page behind it.
    function twTheme() {
        const t = usDock.theme();
        ['bg', 'bg3', 'border', 'text', 'muted', 'shadow'].forEach(function (k) { tw.box.style.setProperty('--' + k, t[k]); });
        tw.box.style.setProperty('--done', t.scheme === 'dark' ? '#a6e3a1' : '#40a02b');
        tw.box.style.setProperty('--dup', t.scheme === 'dark' ? '#f9e2af' : '#df8e1d');
        tw.box.style.setProperty('--dead', t.scheme === 'dark' ? '#fab387' : '#fe640b');
        tw.box.style.colorScheme = t.scheme;
    }

    // Debug: every drawn picture and why the widget did or did not count it. No URLs, only shapes.
    function twReport() {
        const floor = idleFloor();
        const all = document.querySelectorAll('img,video');
        const urls = new Map(), out = [];
        for (let i = 0; i < all.length && out.length < 40; i++) {
            const el = all[i], r = el.getBoundingClientRect();
            if (Math.max(r.width, r.height) < 50) continue;
            const u = shownUrl(el) || '';
            if (!urls.has(u)) urls.set(u, 'U' + (urls.size + 1));
            const lazy = el.getAttribute('data-src') ? ' data-src' + (el.getAttribute('data-src') === el.getAttribute('src') ? '=src' : '≠src') : '';
            let why;
            if (!el.getClientRects().length) why = 'not laid out';
            else if (!shownMedia(el)) why = 'hidden (opacity/visibility)';
            else if ((why = refusal(el))) why = 'refused: ' + why.replace(/\S*[\/?]\S*/g, '<url>');
            else if (!tourWorthy(el, floor)) why = 'under the floor (' + floor + 'px)';
            else if (sideColumn(el)) why = 'side column';
            else if (popupLayer(el)) why = 'popup layer';
            else why = 'COUNTED';
            out.push(el.tagName.toLowerCase() + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) +
                (el.naturalWidth ? ' nat ' + el.naturalWidth + 'x' + el.naturalHeight : '') + ' ' + urls.get(u) + lazy +
                (r.top > vpH() ? ' below' : r.bottom < 0 ? ' above' : '') + ' — ' + why);
        }
        return out;
    }

    // Debounced, but never past TW_RECOUNT_MAX_MS: a feed loading pictures as it goes would otherwise put it off indefinitely.
    const TW_RECOUNT_MAX_MS = 1000;
    let twRecountSince = 0;
    function twRecount() {
        clearTimeout(twRecountTimer);
        const now = Date.now();
        if (!twRecountSince) twRecountSince = now;
        twRecountTimer = setTimeout(function () { twRecountSince = 0; twRefresh(); },
            Math.max(0, Math.min(TW_RECOUNT_MS, twRecountSince + TW_RECOUNT_MAX_MS - now)));
        if (pageRoll.recycles && !twTrackTimer) twTrackTimer = setTimeout(twTrack, TW_TRACK_MS);
    }

    // A feed that unmounts as it scrolls is read while the scroll goes on, or pictures passed without stopping are never seen.
    const TW_TRACK_MS = 250;
    let twTrackTimer = 0;
    function twTrack() {
        twTrackTimer = 0;
        if (!tw || twStarting) return;
        if (tour) { if (tourIsWidget()) { tourSync(); twSync(); } return; }
        if (twPics >= 2) { twTotal = widgetEntries().length; twSync(); }
    }

    // Counter and buttons: the slideshow's position (`–` when its picture is not in the list), else the page's total.
    function twSync() {
        if (!tw) return;
        const on = !!tour && tour.on;
        const at = on ? tour.index : -1, n = on ? tour.total : twTotal;
        tw.num.nodeValue = (at >= 0 ? at + 1 : '–') + ' / ' + (n >= 0 ? n : '–');
        const dupes = tour ? tourDupes : widgetDupes;
        tw.dup.textContent = dupes ? '(' + dupes + ')' : '';
        const dl = deadLinkSite();
        tw.dead.textContent = dl ? '⚠' : '';
        tw.count.__tip = (dl ? '⚠ Links to the full-size picture failed for ' + dl.dead + ' of ' + dl.of +
                ' pictures on this site' + (brokenRules().length ? ' — the settings panel names the rule' : '') + '\n' : '') +
            (dupes ? 'Skipped ' + dupes + ' duplicate' + (dupes === 1 ? '' : 's') + '\n' : '') + TW_HELP;
        tw.prev.classList.toggle('faint', !n);      // faint only with nothing to show; at either end a press wraps
        tw.next.classList.toggle('faint', !n);
        tw.wheel.classList.toggle('faint', !n);
        tw.wheel.classList.toggle('armed', !!twWheelArmed || twWheelIn);
        const fade = Math.max(0, Math.min(100, +cfg.tourFadeTo || 0)) / 100;
        tw.box.style.opacity = cfg.tourFade && !tw.near ? String(fade) : '1';
        if (tw.host.style.display !== 'none') tw.dock.sizeChanged();     // the counter's width
    }

    // The pointer near the widget lights it up.
    function twNear(x, y) {
        twPtr = { x: x, y: y };
        if (!tw || !tw.rect || tw.host.style.display === 'none') return;
        const inReach = twWheelZone(x, y, cfg.wheelRange);
        if (inReach !== twWheelIn) { twWheelIn = inReach; twSync(); }
        const r = tw.rect;
        const near = x >= r.x - TW_NEAR && x <= r.x + r.w + TW_NEAR && y >= r.y - TW_NEAR && y <= r.y + r.h + TW_NEAR;
        if (near === tw.near) return;
        tw.near = near;
        // Counted at load and after scrolling; a page that changed without either is caught here.
        if (near && !tour) { twRefresh(); return; }     // a count under two hides it
        twSync();
    }

    // The pointer left the window: nothing is near any more; an armed wheel stays lit.
    function twLeave() {
        twPtr = null;
        if (!tw || (!twWheelIn && !tw.near)) return;
        twWheelIn = false;
        tw.near = false;
        twSync();
    }

    // The widget appeared or moved under a still pointer: light it as a move there would.
    function twNearAgain() {
        if (twPtr) twNear(twPtr.x, twPtr.y);
    }

    // The pointer the previous page in this tab last saw, if the window is the same size.
    function ptrLoad() {
        try {
            const p = JSON.parse(sessionStorage.getItem(PTR_KEY));
            if (!p || Date.now() - p.t > PTR_KEEP_MS || p.w !== window.innerWidth || p.h !== window.innerHeight) return null;
            return { x: p.x, y: p.y };
        } catch (e) { return null; }
    }

    function ptrSave() {
        try {
            if (!twPtr) { sessionStorage.removeItem(PTR_KEY); return; }
            sessionStorage.setItem(PTR_KEY, JSON.stringify({ x: twPtr.x, y: twPtr.y, t: Date.now(),
                w: window.innerWidth, h: window.innerHeight }));
        } catch (e) { /* storage refused */ }
    }

    // Is (x, y) within `pad` px of the wheel button?
    function twWheelZone(x, y, pad) {
        if (!tw || tw.host.style.display === 'none') return false;
        const r = tw.wheel.getBoundingClientRect();
        if (!r.width) return false;
        pad = Math.max(0, +pad || 0);
        return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
    }

    function twWheelSet(on) {
        twWheelArmed = on ? location.href : null;
        twSync();
    }

    // The wheel button: arm and start the slideshow, or disarm and leave it open.
    function twWheelClick() {
        if (twWheelArmed) { twWheelSet(false); return; }
        twWheelSet(true);
        if (!(placed && view)) tourFromStart(1);
    }

    // Window capture, bound at boot so it runs before onPinWheel: a wheel within wheelRange of the
    // button, or anywhere while armed, steps the slideshow instead of scrolling or zooming.
    function twWheel(e) {
        if (!e.deltaY || !tw) return;
        twNear(e.clientX, e.clientY);
        if (twWheelArmed === location.href) { if (panelOwns(e)) return; }
        else if (!twWheelZone(e.clientX, e.clientY, cfg.wheelRange)) return;
        e.preventDefault();
        e.stopImmediatePropagation();       // the tip's own wheel listener never sees this one
        hideTip();
        const now = Date.now();
        if (twWheelHush) {
            if (now - twWheelHush.last < TW_HUSH_QUIET_MS && now - twWheelHush.t0 < TW_HUSH_MAX_MS) {
                twWheelHush.last = now;
                return;
            }
            twWheelHush = null;
            twWheelAcc = 0;
        }
        const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1);
        if (now - twWheelLast > 500 || (px > 0) !== (twWheelAcc > 0)) twWheelAcc = 0;
        twWheelLast = now;
        twWheelAcc += px;
        if (Math.abs(twWheelAcc) < TW_WHEEL_STEP_PX) return;
        twWheelAcc = 0;
        const dir = px > 0 ? 1 : -1;
        twWheelRun = now - twWheelWantAt < STEP_GAP_MS ? twWheelRun + 1 : 1;
        twWheelWantAt = now;
        twWheelTimes = twWheelTimes.filter(function (t) { return now - t < FAST_WHEEL_MS; });
        twWheelTimes.push(now);
        if (twWheelRun >= FAST_WHEEL_RUN) tourFast(FAST_WHEEL_RUN + ' wheel steps in a row under ' + STEP_GAP_MS + ' ms apart');
        else if (twWheelTimes.length >= FAST_WHEEL_N) tourFast(FAST_WHEEL_N + ' wheel steps within ' + FAST_WHEEL_MS + ' ms');
        if (placed && view) {
            if (!tour) { tourStart(); twWheelHush = { t0: now, last: now }; }
            tourNav(dir, false, true);
        } else if (!twStarting) {
            twWheelHush = { t0: now, last: now };
            tourFromStart(1);       // either way, the wheel starts at the first picture
        }
    }

    // ◀ ▶ held: after TW_HOLD_DELAY_MS they repeat like a held arrow key, scrubbing.
    function twHoldOn(btn, dir) {
        btn.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            twHoldStop();
            twHeld = false;
            navHoldFrom = Date.now();
            twHoldT = setTimeout(function tick() {
                twHeld = true;
                if (placed && view && tour) tourNav(dir, true, true);
                else if (!placed && !twStarting && !tour) twPress(dir);
                twHoldT = setTimeout(tick, TW_HOLD_EVERY_MS);
            }, TW_HOLD_DELAY_MS);
        }, true);   // capture: mkVBtn's capture stopPropagation() cancels this node's bubble listeners
    }

    function twHoldStop() {
        clearTimeout(twHoldT);
        twHoldT = 0;
    }

    function twBusy() { return !!twStarting || (!!tw && !!tw.dock && tw.dock.dragging()); }

    function twPress(dir) {
        if (placed && view) {
            if (!tour) tourStart();
            tourNav(dir, false, true);
            return;
        }
        tourFromStart(dir);
    }

    // A tall, narrow column standing beside a wider one: a sidebar, by width alone. See TOUR.md §1b.
    function sideColumn(el) { return !!sideColumnEl(el); }

    // { col, main }: the sidebar holding el and the wider column beside it, or null.
    function sideColumnEl(el) {
        const vw = vpW();
        let node = el, narrow = null;
        while (node && node !== document.body && node !== document.documentElement) {
            if (passRect(node).width >= vw * 0.45) {
                const p = node.parentElement;      // a carousel track overflowing its narrow frame is not the page
                if (!p || p === document.body || p === document.documentElement || passRect(p).width >= vw * 0.45) break;
            } else narrow = node;
            node = node.parentElement;
        }
        if (!narrow || !node) return null;
        const nr = passRect(narrow);
        if (nr.height < Math.min(600, vpH() * 0.6)) return null;      // a floated figure, not a column
        for (let i = 0; i < node.children.length; i++) {
            const c = node.children[i];
            if (c === narrow) continue;
            const r = passRect(c);
            if (r.width > nr.width * 1.5 && r.top < nr.bottom && r.bottom > nr.top) return { col: narrow, main: c };
        }
        return null;
    }

    // Inside a fixed layer narrower than the page: a dropdown, menu or chat dock, not the page's pictures.
    function popupLayer(el) {
        for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
            if (getComputedStyle(node).position === 'fixed') return passRect(node).width < vpW() * 0.6;
        }
        return false;
    }

    // What a slideshow started from idle may show: everything but the sidebars and popups.
    function mainPics(pics) { return pics.filter(function (p) { return !sideColumn(p) && !popupLayer(p); }); }

    // What the widget counts and ▶ starts on: the main column, down to the post end.
    // Reused like tourEntries(): the widget's count, pgTick and twWarmFirst all ask after one scroll.
    // No `harvest` in this key — twRefresh() runs this at boot, above that `let`.
    let idleMemo = null;
    function idlePics(floor) {
        const key = pageKey() + '|' + floor;
        const m = idleMemo;
        if (m && m.key === key && m.cfg === cfg && Date.now() - m.t < TOUR_LIST_MS &&
            m.pics.every(function (p) { return p.isConnected; })) return m.pics.slice();
        const pics = inPass(function () { return postPics(mainPics(tourPics(floor))); });
        idleMemo = { key: key, cfg: cfg, t: Date.now(), pics: pics };
        return pics.slice();
    }

    // ---- the post end: where a thread's first post or an article stops and replies/comments begin. See TOUR.md §1c.
    const POST_WORD = /post|comment|message|repl|answer|comtr/i;
    const SIG_SKIP = /^(bg\d|odd|even|alt\d?|first|last|new|unread|is-.*|.*\d{3,}.*|.*--(highlighted|selected|op|owner|first|last).*)$/i;
    const COMMENTS_SEL = '#comments, .comments, .comment-list, .commentlist, .comments-area, .commentarea, ' +
        '.comment-tree, #disqus_thread, #answers, .CommentsList, shreddit-comment-tree';
    const CHROME_SEL = 'nav, aside, footer, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"]';
    const LEAD_SKIP = 'a, script, style, noscript, template, button, select, option, label, ' + CHROME_SEL;
    const LEAD_TEXT = 800;      // characters of prose (link text excluded) before the group that make it comments
    const LEAD_PIC = 100;       // px, shorter side: a picture above the group this big is the post's
    const COMMENT_HEAD = /^\s*(\d[\d,.]*\s*k?\s+(comments?|repl(y|ies)|answers?|responses?)\b|leave a (reply|comment)|add a comment|post a comment|comments?\s*\(\d)/i;

    // Siblings sharing a tag and any one class; the OP often carries extra ones (XenForo's firstPost).
    function sibGroups(p) {
        const g = new Map();
        for (let c = p.firstElementChild; c; c = c.nextElementSibling) {
            const keys = [].filter.call(c.classList, function (k) { return !SIG_SKIP.test(k); });
            if (!keys.length) keys.push('');
            keys.forEach(function (k) {
                const key = c.tagName + '.' + k, a = g.get(key);
                if (a) a.push(c); else g.set(key, [c]);
            });
        }
        return g;
    }

    function postish(e) {
        if (!e) return false;
        // the tag too: Reddit's comments are classless <shreddit-comment>
        if (POST_WORD.test((e.getAttribute('class') || '') + ' ' + e.id + ' ' + (e.tagName.indexOf('-') > 0 ? e.tagName : ''))) return true;
        if (/comment|posting|answer/i.test((e.getAttribute('itemtype') || '') + ' ' + (e.getAttribute('itemprop') || ''))) return true;
        return e.hasAttribute('data-post-id') || e.hasAttribute('data-post-number') || e.hasAttribute('data-content');
    }

    // Down the first-child chain too: vBulletin wraps table#post… in four bare divs.
    function postishDeep(e) {
        for (let i = 0; e && i < 5; i++, e = e.firstElementChild) if (postish(e)) return true;
        return false;
    }

    // An index of cards, not a thread: most members carry a headline linking to another page.
    // A forum's headings link to the poster's profile or back into this page, and do not count.
    const PROFILE_URL = /\/(members?|profile|users?|u|member\.php)\b|[?&](u|showuser|userid)=/i;
    function cardList(m) {
        const here = location.origin + location.pathname;
        let n = 0;
        m.forEach(function (e) {
            const a = e.querySelector('h1 a[href], h2 a[href], h3 a[href]');
            if (a && a.textContent.trim().length >= 8 && a.href.split('#')[0].split('?')[0] !== here &&
                !PROFILE_URL.test(a.href)) n++;
        });
        return n * 2 > m.length;
    }

    // The largest run of same-shaped sibling posts, stacked down the main column.
    function postGroup() {
        if (!document.body) return null;
        const vw = vpW();
        const all = document.body.getElementsByTagName('*');
        let best = null;
        for (let i = 0; i < all.length; i++) {
            const p = all[i];
            if (p.childElementCount < 2) continue;
            // judged on every post-like child, or two cards sharing a category class pass as a thread
            const posty = [].filter.call(p.children, postishDeep);
            if (posty.length < 2) continue;     // every group below needs two post-like members
            if (cardList(posty)) continue;
            sibGroups(p).forEach(function (m, key) {
                m = m.filter(function (e) {        // vBulletin's empty div#lastpost anchor goes, not the group
                    if (!postishDeep(e)) return false;
                    const r = rectOf(e);
                    return r.height >= 40 && r.width >= vw * 0.3;
                });
                if (m.length < 2) return;
                let text = 0, prev = null;
                for (let j = 0; j < m.length; j++) {
                    const r = rectOf(m[j]);
                    if (prev && r.top < prev.bottom - 2) return;       // side by side: a grid, not a thread
                    prev = r;
                    text += m[j].textContent.length;
                }
                if ((best && text <= best.text) || sideColumn(m[0])) return;
                best = { m: m, text: text, key: key };
            });
        }
        if (!best) return null;
        best.m.key = best.key;
        return best.m;
    }

    // Replies inside replies: a comment tree (Lemmy, Reddit, WordPress). A forum's posts never nest.
    function nests(g) {
        const dot = g.key.indexOf('.');
        const tag = g.key.slice(0, dot).toLowerCase(), cls = g.key.slice(dot + 1);
        if (!cls && tag.indexOf('-') < 0) return false;      // a bare <div> is inside everything
        const sel = cls ? tag + '.' + CSS.escape(cls) : tag;
        return g.some(function (e) { return !!e.querySelector(sel); });
    }

    // A box's rect, or its children's together when it draws none itself (display:contents, an inline custom element).
    function rectOf(e) {
        const r = e.getBoundingClientRect();
        if (r.height > 0 || !e.firstElementChild) return r;
        let t = Infinity, l = Infinity, b = -Infinity, rt = -Infinity;
        for (let c = e.firstElementChild; c; c = c.nextElementSibling) {
            const q = c.getBoundingClientRect();
            if (!q.width && !q.height) continue;
            t = Math.min(t, q.top); l = Math.min(l, q.left); b = Math.max(b, q.bottom); rt = Math.max(rt, q.right);
        }
        return t === Infinity ? r : { top: t, left: l, bottom: b, right: rt, width: rt - l, height: b - t };
    }

    function precedes(a, b) { return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) && !a.contains(b); }
    function atOrAfter(cut, el) { return cut === el || cut.contains(el) || precedes(cut, el); }

    function siteChrome(el) {
        if (el.closest(CHROME_SEL)) return true;
        const h = el.closest('header');
        return !!h && !h.parentElement.closest('main, article, [role="main"]');
    }

    // The thread's page number, where the page says; a page past the first opens on a reply.
    function threadPage() {
        const u = location.pathname + location.search;
        let m = /[\/-]page[-\/]?(\d+)/i.exec(u) || /[?&](?:page|pg)=(\d+)/i.exec(location.search);
        if (m) return +m[1] || 1;
        m = /[?&]start=(\d+)/i.exec(location.search) || /[?&]topic=\d+\.(\d+)/i.exec(location.search);
        if (m) return +m[1] > 0 ? 2 : 1;
        const cur = document.querySelectorAll('[aria-current="page"], .pageNav-page--current, .pagination .active, ' +
            '.pagination .current, .pagenav .current, .pages .current, .ipsPagination_active');
        for (let i = 0; i < cur.length; i++) {
            const t = cur[i].textContent.trim();
            if (/^\d+$/.test(t)) return +t;
        }
        return 1;
    }

    // What sits above the group that makes it comments on something rather than the thread itself.
    function postLead(g0, floor) {
        let from = null;
        const h1s = document.getElementsByTagName('h1');
        for (let i = 0; i < h1s.length; i++) if (h1s[i].getClientRects().length && precedes(h1s[i], g0)) from = h1s[i];
        const pics = tourPics(floor).filter(function (p) {
            const r = p.getBoundingClientRect();        // a logo strip or a button is not the post's picture
            return Math.min(r.width, r.height) >= LEAD_PIC && precedes(p, g0) && (!from || precedes(from, p)) &&
                !sideColumn(p) && !siteChrome(p);
        });
        if (pics.length) return { why: 'pictures above', el: pics[0] };
        const eds = document.querySelectorAll('textarea, [contenteditable="true"], [contenteditable=""]');
        for (let i = 0; i < eds.length; i++) {
            if (eds[i].getClientRects().length && precedes(eds[i], g0)) return { why: 'reply box above', el: eds[i] };
        }
        const hs = document.querySelectorAll('h2, h3, h4, h5, [role="heading"]');
        for (let i = 0; i < hs.length; i++) {
            if (precedes(hs[i], g0) && hs[i].getClientRects().length && COMMENT_HEAD.test(hs[i].textContent)) {
                return { why: 'comment heading', el: hs[i] };
            }
        }
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        if (from) w.currentNode = from;
        let n = 0, t;
        while ((t = w.nextNode())) {
            if (!precedes(t, g0)) break;
            const p = t.parentElement;
            if (!p || (from && from.contains(p)) || p.closest(LEAD_SKIP) || !p.getClientRects().length) continue;
            n += t.nodeValue.replace(/\s+/g, ' ').trim().length;
            if (n >= LEAD_TEXT) return { why: 'text above', el: p };
        }
        return null;
    }

    // postEndNow(), reused while the page's shape key is unchanged — it walks every element. See TOUR.md §1c.
    let postEndMemo = null;
    function postEnd() {
        const b = document.body;
        const key = location.href + '|' + document.getElementsByTagName('*').length + '|' + vpW() + 'x' + vpH() + '|' +
            (b ? b.scrollHeight : 0) + '|' + (cfg.tourMinDisplayed | 0);
        const m = postEndMemo;
        if (m && m.key === key && (!m.pe || !m.pe.cut || m.pe.cut.isConnected) &&
            (!m.pe || !m.pe.g || m.pe.g.every(function (e) { return e.isConnected; }))) return m.pe;
        const pe = postEndNow();
        postEndMemo = { key: key, pe: pe };
        return pe;
    }

    // { cut, how } — the first element a slideshow of the post leaves out — or null (with `why` for the debug line).
    function postEndNow() {
        const floor = Math.max(0, cfg.tourMinDisplayed | 0);
        const g = postGroup();
        if (g) {
            const lead = nests(g) ? { why: 'replies nest', el: null } : postLead(g[0], floor);
            if (lead) {
                const box = g[0].closest(COMMENTS_SEL);
                const h1 = document.querySelector('h1');
                if (h1 && g[0].contains(h1)) return { cut: g[1], how: 'comments below the post (' + lead.why +
                    '; the title is in the 1st, so replies start at the 2nd)', g: g, lead: lead };
                return { cut: box && !(h1 && box.contains(h1)) ? box : g[0], how: 'comments below the post (' + lead.why + ')',
                    g: g, lead: lead };
            }
            const num = g[0].getAttribute('data-post-number') || g[0].getAttribute('data-number') ||
                (g[0].querySelector('[data-post-number]') || g[0]).getAttribute('data-post-number');
            if (num && num !== '1') return { cut: null, why: 'thread opens on post ' + num + ', not the first', g: g };
            const pg = threadPage();
            if (pg > 1) return { cut: null, why: 'thread page ' + pg + ' — every post is a reply', g: g };
            return { cut: g[1], how: 'thread: replies start at the 2nd post', g: g };
        }
        const cs = document.querySelectorAll(COMMENTS_SEL);
        for (let i = 0; i < cs.length; i++) {
            const c = cs[i];
            if (rectOf(c).height > 0 && !c.querySelector('h1') && !c.parentElement.closest(COMMENTS_SEL)) {
                return { cut: c, how: 'comment area' };
            }
        }
        return null;
    }

    function postPics(pics) {
        const pe = postEnd();
        return pe && pe.cut ? pics.filter(function (p) { return !atOrAfter(pe.cut, p); }) : pics;
    }

    // ---- debug lines (setting showPostEnd): red where the post ends, orange where each sidebar begins.
    let postLine = null;            // hz-post-end
    let sideLines = [];             // hz-side-edge, one per sidebar
    let linesReported = '';         // the last report logged, so a page logs once per change

    function mkDebugLine(tag, css, color) {
        const line = document.createElement(tag);
        line.style.cssText = 'all:initial;position:absolute;z-index:2147483646;pointer-events:none;display:block;' + css;
        const label = document.createElement('span');
        label.style.cssText = 'all:initial;position:absolute;padding:1px 6px;background:' + color + ';color:#fff;' +
            'font:12px/16px sans-serif;border-radius:0 0 4px 4px;white-space:nowrap;top:2px;' +
            (tag === 'hz-post-end' ? 'right:8px' : 'left:2px');
        line.appendChild(label);
        return line;
    }

    // The sidebars the pictures sit in, each once.
    function sidebars() {
        const out = [];
        tourPics(idleFloor()).forEach(function (p) {
            const s = sideColumnEl(p);
            if (!s) return;
            const have = out.find(function (o) { return o.col === s.col; });
            if (have) have.n++; else out.push({ col: s.col, main: s.main, n: 1 });
        });
        return out;
    }

    function tourLinesSync() {
        const want = !!cfg.showPostEnd && isTopFrame && !!document.body;
        const pe = want ? postEnd() : null;
        const sides = want ? sidebars() : [];
        const sx = window.scrollX || 0, sy = window.scrollY || 0;
        if (pe) {
            if (!postLine) postLine = mkDebugLine('hz-post-end', 'left:0;right:0;height:0;border-top:3px solid #f00', '#f00');
            if (!postLine.isConnected) document.documentElement.appendChild(postLine);
            const y = pe.cut ? rectOf(pe.cut).top + sy - 2 : sy + 40;
            postLine.style.top = Math.round(y) + 'px';
            postLine.style.borderTopStyle = pe.cut ? 'solid' : 'dashed';
            postLine.firstChild.textContent = 'Hover Zoom: ' + (pe.cut ? 'slideshow ends here — ' + pe.how : 'no post end — ' + pe.why);
            postLine.style.display = 'block';
        } else if (postLine) postLine.style.display = 'none';
        while (sideLines.length > sides.length) sideLines.pop().remove();
        sides.forEach(function (s, i) {
            let line = sideLines[i];
            if (!line) line = sideLines[i] = mkDebugLine('hz-side-edge', 'width:0;border-left:3px solid #f80', '#f80');
            if (!line.isConnected) document.documentElement.appendChild(line);
            const r = s.col.getBoundingClientRect(), m = s.main.getBoundingClientRect();
            const left = r.left + r.width / 2 < m.left + m.width / 2;       // the edge facing the main column
            line.style.left = Math.round((left ? r.right : r.left) + sx - 1) + 'px';
            line.style.top = Math.round(r.top + sy) + 'px';
            line.style.height = Math.round(r.height) + 'px';
            line.firstChild.textContent = 'Hover Zoom: sidebar (' + s.n + ' picture' + (s.n === 1 ? '' : 's') + ' left out)';
        });
        linesUnstack();
        if (want) tourLinesReport(pe, sides);
    }

    // Moves each sidebar label down until it clears the post-end label and the ones already placed.
    function linesUnstack() {
        const placed = postLine && postLine.style.display !== 'none' ? [postLine.firstChild.getBoundingClientRect()] : [];
        sideLines.forEach(function (line) {
            const label = line.firstChild;
            for (let top = 2; top < 400; top += 20) {
                label.style.top = top + 'px';
                const r = label.getBoundingClientRect();
                if (!placed.some(function (o) { return r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top; })) break;
            }
            placed.push(label.getBoundingClientRect());
        });
    }

    // Structure only — tags, classes, ids, sizes, positions; never a URL or the page's text.
    function tourLinesReport(pe, sides) {
        const sy = window.scrollY || 0;
        const at = function (el) { const r = rectOf(el); return Math.round(r.width) + '×' + Math.round(r.height) + ' at y ' + Math.round(r.top + sy); };
        const chain = function (el) {
            const out = [];
            for (let i = 0; el && el !== document.documentElement && i < 6; i++, el = el.parentElement) out.push(describeEl(el));
            return out.join(' < ');
        };
        const lines = ['post end: ' + (!pe ? 'none — no repeated posts and no comment area found' :
            pe.cut ? pe.how : pe.why)];
        if (pe && pe.g) {
            lines.push('posts: ' + pe.g.key.toLowerCase() + ' ×' + pe.g.length + '; 1st ' + at(pe.g[0]) + '; 2nd ' + at(pe.g[1]));
            const h1 = document.querySelector('h1');
            lines.push('1st post: ' + chain(pe.g[0]) + '; h1 ' + (!h1 ? 'none' : pe.g[0].contains(h1) ? 'inside it' :
                precedes(h1, pe.g[0]) ? 'above it' : 'below it'));
        }
        if (pe && pe.lead && pe.lead.el) lines.push('evidence: ' + pe.lead.el.tagName.toLowerCase() + ' ' + at(pe.lead.el) + ' — ' + chain(pe.lead.el));
        if (pe && pe.cut) lines.push('cut: ' + describeEl(pe.cut) + ' ' + at(pe.cut));
        lines.push('thread page: ' + threadPage() + '; h1: ' + document.getElementsByTagName('h1').length +
            '; window ' + vpW() + '×' + vpH());
        sides.forEach(function (s) { lines.push('sidebar: ' + chain(s.col) + ' ' + at(s.col) + ', ' + s.n + ' pictures'); });
        const text = lines.join('\n');
        if (text === linesReported) return;
        linesReported = text;
        console.info('[Hover Zoom] slideshow lines\n' + text);
    }

    // The smallest element holding every picture the widget counted: the article, not the page
    // around it. <body> is the whole page, and only the whole page carries on onto the next one.
    function tourCommon(pics) {
        const root = document.documentElement;
        let node = pics[0] || null;
        while (node && !pics.every(function (p) { return node.contains(p); })) {
            node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
        }
        return !node || node === document.body ? root : node;
    }

    // The picture ▶ would open, resolved ahead so a slideshow started from idle shows at once.
    let twWarm = null;          // { el, displayed, res } — res undefined while it resolves
    function twWarmFirst() {
        if (tour || placed || !twWanted()) return;
        const first = widgetEntries()[0];
        if (!first || first.ghost || (twWarm && twWarm.el === first.el)) return;
        const w = twWarm = { el: first.el, displayed: sizeOf(first.el), res: undefined };
        primeLink(w.el);
        resolve(w.el, w.displayed, { cancelled: false, fresh: false }, null).then(function (res) {
            if (twWarm !== w) return;
            w.res = res || null;
            if (res && !res.video) plKeepImage(res);
            dbg('slideshow: first picture ready', res ? res.w + '×' + res.h + ' ' + res.url.slice(-48) : 'nothing found');
        }, function () { if (twWarm === w) w.res = null; });
    }

    // ▶ (◀) with nothing pinned: the first (last) picture of the area the page's pictures are in, opened and pinned.
    async function tourFromStart(dir) {
        dir = dir < 0 ? -1 : 1;
        if (placed || twStarting || !siteEnabled() || CAPTCHA_HERE) return;
        cancel();
        const floor = idleFloor();
        tour = { el: null, start: null, url: '', x: 0, y: 0, index: -1, total: 0, on: true,
            scope: null, mainOnly: true, postOnly: true, level: -1, floor: floor, had: new Set(tourPics(floor)) };
        const list = tourEntries();
        if (!list.length) { tourEnd(); return; }
        let at = dir > 0 ? 0 : list.length - 1;
        const myToken = twStarting = token = { cancelled: false, fresh: true };
        showSpinner();
        let res = null, el = null, displayed = null, fromPage = false;
        try {
            for (let tries = 0; tries < TOUR_START_TRIES && at >= 0 && at < list.length; tries++, at += dir) {
                let entry = list[at];
                tourRemember(entry);
                tour.index = at;
                tour.total = list.length;
                twSync();
                if (entry.ghost) {
                    const live = await ghostLive(entry, myToken);
                    if (myToken.cancelled || !tour) break;
                    if (!live) {
                        const pre = plDone.get(entry.pk);
                        if (pre && pre.res) { el = entry.el; displayed = pre.displayed; res = pre.res; fromPage = true; break; }
                        continue;
                    }
                    entry = live;
                    tourRemember(entry);
                }
                el = entry.el;
                displayed = sizeOf(el);
                active = el;
                activeShown = shownUrl(el);
                const warm = twWarm && twWarm.el === el && twWarm.res && sameDisplayed(twWarm.displayed, displayed) ? twWarm.res : null;
                primeLink(el);
                const pre = plGet(el);
                res = warm || (pre && pre.res && sameDisplayed(pre.displayed, displayed) ? pre.res : null);
                fromPage = !res;
                if (!res) res = await tourPageRes(el, displayed);
                if (!res && !myToken.cancelled) { fromPage = false; res = await resolve(el, displayed, myToken, null); }
                if (res || myToken.cancelled || !tour) break;
                dbg('tour: nothing to show for this one — trying the next', { at: at + 1 });
            }
        } finally {
            twStarting = null;
            hideSpinner();
        }
        if (!res || myToken.cancelled || !tour || tour.el !== el || placed) {
            if (!placed) { active = null; activeShown = null; tourEnd(); }
            return;
        }
        if (!fromPage) plSet(el, { res: res, displayed: displayed });
        dbg('tour started from the widget', { pictures: list.length, from: dir > 0 ? 'the first' : 'the last',
            url: (res.url || '').slice(-60) });
        showViewer(res, pointer);
        place();
        twSync();
        if (fromPage && el.isConnected) tourRest(el, displayed, myToken);
        const now = tourEntries();
        plFill(now, tour.index, dir);
        if (now.length - 1 - tour.index < TOUR_AHEAD) tourGrow(dir, false);
    }

    if (isTopFrame) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', twRefresh);
        else twRefresh();
        window.addEventListener('load', twRecount);
        // A lazy picture landing after page load changes the count with no scroll to catch it.
        document.addEventListener('load', function (e) {
            const t = e.target;
            if (t && (t.tagName === 'IMG' || t.tagName === 'VIDEO') && !tour) twRecount();
            if (t && t.tagName === 'IMG' && galMarksHere()) galMarkSoon();   // a picture landing moves its neighbours' marks
        }, true);
        window.addEventListener('scroll', perfWrap(twRecount, 'event'), { passive: true });
        CAP_TARGET.addEventListener('wheel', perfWrap(twWheel, 'event'), WHEEL_OPTS);
        window.addEventListener('pagehide', ptrSave);
        window.addEventListener('mouseup', twHoldStop, true);
        window.addEventListener('blur', twHoldStop);
        window.addEventListener('popstate', twRecount);
        if (window.navigation) window.navigation.addEventListener('navigatesuccess', twRecount);
    }

    // Left/Right navigate when the picture cannot pan sideways, and pan when it can. Per axis,
    // not pannable(): a tall picture at fit-width pans up and down while the arrows still step.
    function tourOwnsArrows() {
        return !!tour && !!view && cfg.tourKeys && !(view.imgW > view.frameW + 0.5);
    }

    let scrubAt = 0, scrubDir = 1;
    let wallBusy = false;       // ▶ at the last picture is asking the page for more
    let seamDir = 0;            // the end the last step stopped at; the next one wraps
    let seamHoldUntil = 0;      // user steps toward seamDir are ignored until then; away from it pass
    const SEAM_HOLD_MS = 1000;
    const SEAM_NOTE_MS = 1000;
    const STEP_GAP_MS = 150;        // a user step this soon after the last is dropped (a notch run on), until tourFast()
    const FAST_HOLD_MS = 3000;      // a key or ◀ ▶ held this long lifts the gap
    const FAST_WHEEL_RUN = 10;      // so do this many wheel steps in a row, each under STEP_GAP_MS apart
    const FAST_WHEEL_N = 15, FAST_WHEEL_MS = 1500;     // or this many wheel steps within this long
    let userStepAt = 0;             // the last user step taken
    let navHoldFrom = 0;            // when the key or button now repeating went down

    // The user is flipping fast on purpose: no gap between steps until this slideshow closes.
    function tourFast(why) {
        if (!tour || tour.fast) return;
        tour.fast = true;
        dbg('slideshow: no gap between steps until it closes — ' + why);
    }

    // One press of ◀ / ▶ or a navigating arrow. A HELD key scrubs: the anchor moves at the scrub
    // rate and nothing resolves until the key has been still, because OS key repeat is ~30/s and
    // would outrun any buffer instantly. See TOUR.md §5.
    // `user`: a key, click, hold or wheel — paced by the picture on screen and stopped once at each end.
    function tourNav(dir, repeat, user) {
        if (!placed || !view || !tour) return;
        if (user && dir === seamDir && Date.now() < seamHoldUntil) return;
        if (user) {
            const now = Date.now();
            if (!repeat) navHoldFrom = now;
            else if (now - navHoldFrom >= FAST_HOLD_MS) tourFast('held ' + FAST_HOLD_MS / 1000 + ' s');
            if (!tour.fast && now - userStepAt < STEP_GAP_MS) return;
            userStepAt = now;
        }
        if (repeat) {
            const rate = +cfg.tourHoldRate || 0;
            if (rate > 0 && Date.now() - scrubAt < 1000 / rate) return;
        }
        scrubAt = Date.now();
        scrubDir = dir;
        if (!tour.on) {
            tour.on = true;
            dbg('tour entered: ' + describeEl(tourScopeNow(tourPics(tourFloor()))), { floor: tour.floor + 'px' });
        }
        const list = tourEntries();
        const to = tourTarget(list, dir);
        tour.total = list.length;
        if (to < 0) {
            tour.index = tourAt(list);
            twSync();
            if (wallBusy) return;
            // A press past either end wraps; forward asks the page for more first.
            if (dir < 0 || seamDir === dir) tourSeam(dir, user);
            else tourWall(user);
            return;
        }
        seamDir = 0;
        plVidLeft();
        tourGo(list, to, dir, repeat);
    }

    // Step the slideshow to list[to].
    function tourGo(list, to, dir, repeat) {
        tourRemember(list[to]);
        tour.index = to;
        dbg('tour step', { at: to + 1, of: list.length, dir: dir, scrubbing: !!repeat,
            // The position is the operand the reading-order sort compared, so it is logged.
            doc: Math.round(list[to].x) + ',' + Math.round(list[to].y),
            to: list[to].el.tagName + ' ' + (list[to].url || '(nothing)').slice(-48) });
        twSync();
        plFill(list, to, dir);
        // Refill BEFORE the wall, so the page loads more while there are still pictures to look at.
        if (list.length - 1 - to < TOUR_AHEAD) tourGrow(dir, false);
        tourShow();
    }

    // Put the anchor in the window at once: its loaded original, else the page's own picture, else
    // an empty frame. Nothing is requested for it until the user rests on it. See TOUR.md §6.
    function tourShow() {
        if (!placed || !view || !tour || !tour.el) return;
        if (tour.ghost) { tourShowGhost(); return; }
        const el = tour.el;
        const displayed = sizeOf(el);
        swapSeq++;                  // a swap still loading for the last entry must not land over this one
        active = el;
        activeShown = shownUrl(el);
        if (token) token.cancelled = true;
        clearTimeout(tourRestTimer);
        hideSpinner();              // the cancelled resolve owned it and will not hide it now
        const myToken = token = { cancelled: false, fresh: true };
        primeLink(el);
        const pre = plGet(el);
        if (pre && pre.res && sameDisplayed(pre.displayed, displayed)) {
            dbg('tour: from the preload buffer', pre.res);
            swapViewer(pre.res, true);
            // The preload spent one guess, or the page has offered more since (Google fills a
            // result's link on hover): the full search runs once the user rests here.
            if (pre.sig !== undefined && pre.sig !== candSig(el)) tourRest(el, displayed, myToken, pre.res);
            return;
        }
        const blank = setTimeout(function () { if (!myToken.cancelled && !myToken.shown) blankFrame(); }, TOUR_BLANK_MS);
        tourPageRes(el, displayed).then(function (res) {
            clearTimeout(blank);
            if (myToken.cancelled || myToken.shown || !tour || tour.el !== el || !view) return;
            if (!res) { if (!blanked) blankFrame(); return; }
            myToken.shown = true;
            swapViewer(res);
        });
        tourRest(el, displayed, myToken);
    }

    const GHOST_LOOKS = [100, 250, 500, 1000, 1600];     // ms after arriving: is the page showing it again?

    // An entry the page has unmounted: what the preloader got for it is shown straight away; once
    // the page mounts that spot again, the slideshow binds to the live element — the same picture,
    // or whatever the page now has there, which is then shown instead.
    function tourShowGhost() {
        const ghostEl = tour.el, pk = tour.pk;
        swapSeq++;
        if (token) token.cancelled = true;
        clearTimeout(tourRestTimer);
        hideSpinner();
        const myToken = token = { cancelled: false, fresh: true };
        const pre = plDone.get(pk);
        if (pre && pre.res) { swapViewer(pre.res, true); myToken.shown = true; }
        else if (!blanked) blankFrame();
        GHOST_LOOKS.forEach(function (ms, i) {
            setTimeout(function () {
                if (myToken.cancelled || !tour || tour.el !== ghostEl || !view) return;
                const got = tourRebind(pk, i === GHOST_LOOKS.length - 1);
                if (got === 'other' || (got && !myToken.shown)) tourShow();
            }, ms);
        });
    }

    // The ghost's picture is live again (or replaced): point the anchor at the live element.
    function tourRebind(pk, last) {
        const list = tourEntries();
        const hit = rollFind(list, pk, { x: tour.x, y: tour.y, w: tour.w, h: tour.h });
        if (!hit) {
            if (last) dbg('slideshow: the page has not shown this picture again; showing what was loaded for it');
            return false;
        }
        const same = rollKey(hit) === pk;
        if (same) dbg('slideshow: the page shows this picture again — checked');
        if (!same) dbg('slideshow: the page has a different picture here now — showing that', { was: tour.url.slice(-48), now: (hit.url || '').slice(-48) });
        tour.el = hit.el;
        tour.url = hit.url;
        tour.pk = hit.pk;
        tour.ghost = false;
        tour.x = hit.x; tour.y = hit.y; tour.w = hit.w; tour.h = hit.h;
        tour.index = tourAt(list);
        tour.total = list.length;
        twSync();
        return same ? 'same' : 'other';
    }

    const TOUR_REST_MS = 300;       // a step held this long is one the user is looking at
    const TOUR_BLANK_MS = 150;      // the page's own picture gets this long before the frame empties

    // The full search for the anchor, once the user has stopped on it; the result replaces what is shown.
    function tourRest(el, displayed, myToken, had) {
        clearTimeout(tourRestTimer);
        tourRestTimer = setTimeout(async function () {
            if (myToken.cancelled || !tour || tour.el !== el || !view) return;
            plPaused = true;        // a resolve the user is waiting on never queues behind six
            showSpinner();
            dockSpinner();
            let hit = null;
            try {
                hit = await resolve(el, displayed, myToken, null);
            } finally {
                plPaused = false;
                plPump();
                if (!myToken.cancelled) hideSpinner();
            }
            if (myToken.cancelled || !tour || tour.el !== el || !view) return;
            if (had) {
                if (!betterHit(had, hit)) return;
                dbg('tour: the full search beat the preload', { was: had, now: hit });
                plSet(el, { res: hit, displayed: displayed });
                upgradeViewer(hit);
                return;
            }
            plSet(el, { res: hit, displayed: displayed });
            if (!hit) { await tourFallback(el, displayed, myToken.failure); return; }
            myToken.shown = true;
            if (hit.url === view.url && hit.w === view.natW && hit.h === view.natH && !blanked) {
                if (view.reason) { view.reason = null; resetCaption(); layout(); }
                return;
            }
            swapViewer(hit);
        }, TOUR_REST_MS);
    }

    // A link with no address yet is one the page fills on hover (Google Images): a tour entry is
    // never hovered, so it is given the mouseover the page is waiting for. See TOUR.md §6.
    let priming = false;
    function primeLink(el) {
        if (!el || el.__hzBase || !el.isConnected) return;
        const a = closestAcross(el, 'a');
        if (!a || a.hasAttribute('href')) return;
        const r = el.getBoundingClientRect();
        priming = true;
        try {
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, composed: true,
                clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));    // no `view`: the manager's window is a proxy
        } catch (e) { dbg('tour: the hover for the link failed', String(e)); }
        finally { priming = false; }
        dbg('tour: gave the page a hover to fill in its link', { now: a.getAttribute('href') ? 'filled' : 'still empty' });
    }

    // What a resolve of el would try; '' when a speculative one (guesses given) could not try it all.
    function candSig(el, guesses) {
        const all = collectCandidates(el);
        if (guesses !== undefined && all.filter(function (c) { return !c.keep; }).length > guesses) return '';
        return all.map(function (c) { return c.url; }).join('\n');
    }

    // A preload measured against a stale rect would have applied the size gate to the wrong
    // number, so its answer is only usable while the picture is still that size.
    function sameDisplayed(a, b) {
        return !!a && !!b && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;
    }

    // Never blank, never skipped: a page of 50 pictures gives a tour of 50, and one that will not
    // resolve shows the page's own picture with the reason. Unlike an ordinary hover this fires
    // for a candidate merely rejected as too small as well — inside a tour the entry has to
    // exist. See TOUR.md §8.
    async function tourFallback(el, displayed, why) {
        const res = await tourFallbackRes(el, displayed, why);
        if (!tour || tour.el !== el || !view) return;
        if (res) { swapViewer(res); return; }
        dbg('tour: nothing to show for this one — moving on', { why: why || '(none)' });
        tourNav(scrubDir, false);
    }

    // The page's own picture with the reason, as something the window can show; null if even that fails.
    async function tourFallbackRes(el, displayed, why) {
        const res = await tourPageRes(el, displayed);
        if (!res) return null;
        res.reason = why || 'no larger version found';
        dbg('tour: showing the page\'s own picture — ' + res.reason, res.url);
        return res;
    }

    // The page's own picture as something the window can show; null for a placeholder or a failure.
    async function tourPageRes(el, displayed) {
        const url = shownUrl(el);
        if (!url || blocked(url) || placeholder(el, url)) return null;
        const n = nativeSize(el);
        if (n && n.w && n.h && !n.scaled) return { url: url, w: n.w, h: n.h };
        // A srcset size is density-divided, and verifyMedia() would mark the URL unstable. An
        // entry harvested from a fetched page has nothing decoded at all. See E45, TOUR.md §10.
        const dim = await probe(url, false);
        if (!dim || dim.video) return null;
        return { url: url, w: dim.w, h: dim.h };
    }

    // ---- making a lazy page load more: the page is scrolled as a reader scrolls it (tourFollow),
    // and the batch that arrives is watched for. A loader fires on a real viewport intersection and
    // cannot be spoofed. See TOUR.md §9.

    const TOUR_AHEAD = 10;          // landing this close to the end, either way, triggers a refill
    const TOUR_START_TRIES = 5;     // unshowable entries a start from the widget walks past
    const EXC_POLL_MS = 150;
    const EXC_MAX_MS = 2000;
    const EXC_COOL_MS = 3000;
    const EXC_STEP = 0.9;           // at the wall, the page moves on this many viewports, like Page Down
    const EXC_WALK_MS = 250;        // a pause on each screen of the walk, for a loader to fire
    const EXC_WALK_MAX = 40;        // screens one press may walk

    let excBusy = false, excAt = 0, excSpent = false;
    let excDead = null;             // {url, h, n} when this page last loaded nothing; never reset
    const EXC_EDGE_PX = 2;

    // Wait up to EXC_MAX_MS for new media, stopping once it has stopped arriving.
    async function excWatch(before) {
        const until = Date.now() + EXC_MAX_MS;
        let last = before, still = 0, grew = false;
        while (Date.now() < until) {
            await sleep(EXC_POLL_MS);
            if (pageGrew(last)) { grew = true; last = pageSize(); still = 0; }
            else if (grew && ++still >= 2) break;
        }
        return { grew: grew, now: last.n, h: last.h };
    }

    function docHeight() {
        const b = document.body, d = document.documentElement;
        return Math.max(b ? b.scrollHeight : 0, d ? d.scrollHeight : 0);
    }

    function mediaCount() { return document.querySelectorAll('img,video').length; }

    // A feed that recycles its elements (Imgur) never raises the count; it lengthens the page instead.
    function pageSize() { return { n: mediaCount(), h: docHeight() }; }
    function pageGrew(before) {
        const h = vpH();
        return mediaCount() > before.n || (h > 0 && docHeight() >= before.h + h);
    }

    // The bottom of the page is on screen now, so any loader there has already fired.
    function excBottomShown() {
        const h = vpH();
        return h > 0 && (window.scrollY || 0) + h >= docHeight() - EXC_EDGE_PX;
    }

    // This page loaded nothing when last asked, and has not grown since.
    function excStillDead() {
        return !!excDead && excDead.url === location.href &&
            docHeight() <= excDead.h && mediaCount() <= excDead.n;
    }

    // ---- which sites load more when scrolled: learned from the user's own scrolling

    const GROWS_OLD_KEY = 'hoverZoomGrowsOnScroll';    // v0.141.0-v0.142.0's list, moved into cfg
    const GROWS_MISS_KEY = 'hoverZoomScrollMisses';     // host -> page loads in a row that loaded nothing
    const GROWS_FORGET = 5;
    const GROWS_INPUT_MS = 1000;    // a scroll this soon after wheel/key/touch/press is the user's
    const GROWS_SETTLE_MS = 600;
    const GROWS_LATE_MS = 2000;     // a second look, for a batch that lands after scrolling stops
    let growsBase = null, growsHad = null, growsNear = false, growsTimer = 0, userInputAt = 0, growsMoved = false;
    let growsH = 0;         // the page's height when growsBase was taken

    function growsMigrate() {
        if (growsMoved) return;
        growsMoved = true;
        let old = [];
        try { old = JSON.parse(GM_getValue(GROWS_OLD_KEY, '') || '[]'); } catch (e) { /* unreadable: nothing to move */ }
        if (!old.length) return;
        reloadSettings();
        cfg.scrollSites = (cfg.scrollSites || []).concat(old.filter(function (h) { return (cfg.scrollSites || []).indexOf(h) === -1; }));
        saveSettings();
        GM_setValue(GROWS_OLD_KEY, '');
    }

    function growsHere() {
        growsMigrate();
        const host = pageHost();
        return (cfg.scrollSites || []).some(function (k) { return entryCovers(k, host); });
    }

    function growsPics() { return mainPics(tourPics(idleFloor())); }
    function growsCount() { return growsPics().length; }

    function growsMisses() {
        try { return JSON.parse(GM_getValue(GROWS_MISS_KEY, '') || '{}'); } catch (e) { return {}; }
    }

    function growsLearn(from, to) {
        const host = pageHost();
        reloadSettings();
        if ((cfg.scrollSites || []).indexOf(host) === -1) cfg.scrollSites = (cfg.scrollSites || []).concat([host]);
        saveSettings();
        refreshPanel();
        growsHit('learned from your scrolling, ' + from + ' → ' + to);
    }

    // Evidence the site does load more: its run of empty page loads starts again.
    function growsHit(why) {
        const host = pageHost(), m = growsMisses();
        if (m[host]) { delete m[host]; GM_setValue(GROWS_MISS_KEY, JSON.stringify(m)); }
        dbg('this site loads more when scrolled — ' + why, { host: host });
    }

    // A page here that loaded nothing when asked; GROWS_FORGET in a row and the site is forgotten.
    function growsMiss() {
        const host = pageHost(), m = growsMisses();
        m[host] = (m[host] || 0) + 1;
        const forget = m[host] >= GROWS_FORGET;
        if (forget) delete m[host];
        GM_setValue(GROWS_MISS_KEY, JSON.stringify(m));
        dbg('this page loaded nothing when scrolled', { host: host, inARow: forget ? GROWS_FORGET : m[host] });
        if (!forget) return;
        reloadSettings();
        cfg.scrollSites = (cfg.scrollSites || []).filter(function (k) { return k !== host; });
        saveSettings();
        refreshPanel();
        dbg('forgot this site as one that loads more — ' + GROWS_FORGET + ' page loads in a row loaded nothing', { host: host });
    }

    // Pictures added after the user scrolled near the bottom: this site needs the excursion.
    function growsCheck(late) {
        if (growsBase === null) return;
        const now = growsPics(), n = now.length;
        // New elements, not a lazy page filling in the ones it already had.
        const added = now.some(function (p) { return !growsHad.has(p); });
        const longer = vpH() > 0 && docHeight() >= growsH + vpH();     // a recycling feed: count flat, page longer
        if ((n > growsBase || longer) && added && growsNear) {
            if (growsHere()) growsHit('seen again as you scrolled, ' + growsBase + ' → ' + n);
            else growsLearn(growsBase, n);
            growsBase = null;
            growsHad = null;
            return;
        }
        if (late) { growsBase = null; growsHad = null; growsNear = false; return; }
        growsTimer = setTimeout(function () { growsCheck(true); }, GROWS_LATE_MS);
    }

    function growsOnScroll() {
        if (tour || twStarting || excBusy || Date.now() - userInputAt > GROWS_INPUT_MS) return;
        if (!cfg.tourLoadMore || !siteEnabled()) return;
        if (growsBase === null) { const had = growsPics(); growsBase = had.length; growsHad = new Set(had); growsNear = false; growsH = docHeight(); }
        const h = vpH();
        if (h > 0 && (window.scrollY || 0) + 2 * h >= docHeight()) growsNear = true;
        clearTimeout(growsTimer);
        growsTimer = setTimeout(function () { growsCheck(false); }, GROWS_SETTLE_MS);
    }

    if (isTopFrame) {
        ['wheel', 'keydown', 'touchmove', 'mousedown'].forEach(function (t) {
            window.addEventListener(t, function () { userInputAt = Date.now(); }, { capture: true, passive: true });
        });
        window.addEventListener('scroll', perfWrap(growsOnScroll, 'event'), { passive: true });
    }

    // Watch for the batch the page loads once following has brought its bottom on screen. At the
    // wall (`force`) the page is scrolled on by a screen, as a reader would: never to the bottom,
    // which skips the middle of a feed that mounts only near the viewport (Google in Firefox).
    async function tourAskMore(force) {
        if (excBusy || excSpent || !cfg.tourLoadMore) return false;
        if (!growsHere()) { excSpent = true; dbg('load more: not on this site, which has not been seen to load more when scrolled'); return false; }
        if (!force && Date.now() - excAt < EXC_COOL_MS) return false;
        if (excStillDead()) { excSpent = true; dbg('load more: this page loaded nothing last time and has not grown'); return false; }
        if (!force && !excBottomShown()) return false;
        excBusy = true;
        excAt = Date.now();
        const before = pageSize();
        let seen;
        try {
            if (force) await excWalk(before);
            seen = await excWatch(before);
        } finally { excBusy = false; }
        dbg('load more: watched the bottom of the page', { was: before.n, now: seen.now, height: before.h + ' → ' + seen.h,
            grew: seen.grew, atWall: !!force });
        if (seen.grew) { growsHit('the slideshow found more'); return true; }
        if (!excBottomShown()) return false;        // a screen further on at the next press
        excGaveNothing();
        return false;
    }

    // At the wall: on down a screen at a time, as Page Down would, until the bottom shows or pictures are added.
    async function excWalk(before) {
        for (let i = 0; i < EXC_WALK_MAX && !excBottomShown() && !pageGrew(before); i++) {
            window.scrollBy({ left: 0, top: Math.round(vpH() * EXC_STEP), behavior: 'instant' });
            await sleep(EXC_WALK_MS);
            if (!tour) return;
        }
    }

    // Spent for this slideshow, dead for this page until it grows, and one miss for the site per page.
    function excGaveNothing() {
        excSpent = true;
        const first = !excDead || excDead.url !== location.href;
        excDead = { url: location.href, h: docHeight(), n: mediaCount() };
        if (first) growsMiss();
    }

    // ---- crossing to the next page
    //
    // The document is NEVER navigated: that destroys the pinned window and, on a non-SPA site,
    // the script instance with it. The next page is fetched and parsed instead, which this script
    // already does for a linked page — it was only ever pointed at one page at a time.
    // See TOUR.md §10.

    // "Older" is forward in a blog pager; "newer" is backward. Sort controls — new, best, hot,
    // top — are deliberately absent: they are not direction, and a wrong answer here walks the
    // tour into the wrong pages in silence.
    const NEXT_WORDS = /(^|\W)(next|older|forward|more)(\W|$)|»|›|→|>>/i;
    const BACK_WORDS = /(^|\W)(prev|previous|newer|back|earlier|first)(\W|$)|«|‹|←|<</i;
    const LABEL_MAX = 40;       // longer than this is prose, not a pager control

    function pageNumOf(u) {
        const m = /[?&](?:page|p|pg|paged|pagenum|start)=(\d+)/i.exec(u.search) ||
                  /\/(?:page|p)\/(\d+)(?:\/|$)/i.exec(u.pathname) ||
                  /\/(?:page|p)(\d+)(?:\/|$)/i.exec(u.pathname);
        return m ? parseInt(m[1], 10) : 0;
    }

    // Directional, and it REFUSES ambiguity rather than guessing. Three rungs, best first; a rung
    // offering two different destinations is discarded whole and the next one is tried.
    function nextPageIn(root, base) {
        const only = function (urls) { return urls.length === 1 ? urls[0] : null; };
        const here = String(base).split('#')[0];
        const abs = function (n) {
            const href = n.getAttribute('href');
            if (!href) return null;
            let u;
            try { u = new URL(href, base); } catch (e) { return null; }
            if (!/^https?:$/.test(u.protocol)) return null;
            if (u.origin !== location.origin) return null;      // same site only
            u.hash = '';
            if (u.href === here) return null;
            if (looksLikeImage(u.href) || isVideoUrl(u.href)) return null;
            return u.href;
        };
        const gather = function (nodes, ok) {
            const urls = [];
            [].forEach.call(nodes, function (n) {
                if (ok && !ok(n)) return;
                const u = abs(n);
                if (u && urls.indexOf(u) === -1) urls.push(u);
            });
            return urls;
        };

        // 1. Declared by the page. Unambiguous by construction.
        const declared = only(gather(
            root.querySelectorAll('link[rel~="next" i][href],a[rel~="next" i][href]')));
        if (declared) return declared;

        const anchors = root.querySelectorAll('a[href]');

        // 2. A numbered pager. Which page we are ON comes from the URL where it says so — and
        //    otherwise from the pager's own shape, because most pagers do not put the number
        //    anywhere a regex can find it (`pager-2.html`, `/gallery/two/`). The number inside
        //    the pager's range that is NOT a link is the page you are standing on.
        const byNum = new Map();
        const clashed = new Set();
        [].forEach.call(anchors, function (a) {
            const t = (a.textContent || '').trim();
            if (!/^\d{1,4}$/.test(t)) return;
            const u = abs(a);
            if (!u) return;
            const n = parseInt(t, 10);
            if (byNum.has(n)) { if (byNum.get(n) !== u) clashed.add(n); }   // two pagers agree: fine
            else byNum.set(n, u);
        });
        const numbered = function (n) {
            return (!clashed.has(n) && byNum.get(n)) || null;
        };
        let cur = 0;
        try { cur = pageNumOf(new URL(base)); } catch (e) { cur = 0; }
        if (cur && numbered(cur + 1)) return numbered(cur + 1);
        if (byNum.size >= 2) {
            const ns = Array.from(byNum.keys()).sort(function (a, b) { return a - b; });
            const gaps = [];
            for (let k = ns[0]; k <= ns[ns.length - 1]; k++) if (!byNum.has(k)) gaps.push(k);
            // Exactly one hole: that is here, and the link after it is next.
            if (gaps.length === 1 && numbered(gaps[0] + 1)) return numbered(gaps[0] + 1);
            // No hole and the run starts above 1: page 1 links every other page but not itself.
            if (!gaps.length && ns[0] > 1 && numbered(ns[0])) return numbered(ns[0]);
        }

        // 3. A forward word, with nothing backward in the same label.
        return only(gather(anchors, function (a) {
            const label = ((a.textContent || '') + ' ' + (a.getAttribute('aria-label') || '') +
                ' ' + (a.getAttribute('title') || '')).trim();
            if (!label || label.length > LABEL_MAX) return false;
            return NEXT_WORDS.test(label) && !BACK_WORDS.test(label);
        }));
    }

    // DOMParser gives the parsed document THIS document's base URI, so every relative URL in it
    // would resolve against the wrong page. A page's own <base> is kept, made absolute first.
    function rebase(doc, href) {
        const head = doc.head || doc.documentElement;
        if (!head) return;
        const own = doc.querySelector('base[href]');
        if (own) {
            try { own.setAttribute('href', new URL(own.getAttribute('href'), href).href); }
            catch (e) { /* unparseable; the injected one below is not reached */ }
            return;
        }
        const b = doc.createElement('base');
        b.setAttribute('href', href);
        head.insertBefore(b, head.firstChild);
    }

    async function fetchDoc(href, onRefused) {
        try {
            const res = await fetch(href, { credentials: 'same-origin', redirect: 'follow' });
            if (!res.ok) { if (onRefused) onRefused(res); return null; }
            if (!/text\/html|application\/xhtml/i.test(res.headers.get('content-type') || '')) return null;
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            rebase(doc, href);
            return doc;
        } catch (e) {
            return null;                        // offline, blocked, CSP, aborted
        }
    }

    // A fetched document has NO LAYOUT, so most of the eligibility gates cannot run: banner shape,
    // the wallpaper tests and the peer walk all read rects. What survives is what the markup says
    // on its own — the block list, the page's own decoration flags, and declared width/height.
    // Everything else is settled by the probe when the entry is reached.
    function harvestFrom(doc, href, page) {
        keepDocInfo(href, doc);
        const out = [], seen = new Set(), floor = tourFloor();
        doc.querySelectorAll('img,video').forEach(function (n) {
            if (n.tagName === 'VIDEO' && !videoPreviewsOn()) return;
            if (cfg.skipFurniture && decorativeReason(n)) return;
            n.__hzBase = href;
            const u = shownUrl(n);
            if (!u || seen.has(u) || blocked(u)) return;
            if (u.indexOf('data:') === 0 || u.indexOf('blob:') === 0) return;
            const w = parseInt(n.getAttribute('width') || '0', 10) || 0;
            const h = parseInt(n.getAttribute('height') || '0', 10) || 0;
            if ((w || h) && w < cfg.minDisplayed && h < cfg.minDisplayed) return;
            if ((w || h) && Math.max(w, h) < floor) return;
            seen.add(u);
            out.push({ el: n, url: u, x: 0, y: 0, h: 0, n: out.length, page: page });
        });
        return out;
    }

    // Harvested entries, appended to the list after everything the live document holds. This IS
    // kept between presses — but nothing in the DOM can invalidate it, because none of it came
    // from the DOM.
    let harvest = [];
    let crossNext = null, crossBusy = false, crossSpent = false, crossPage = 1;

    async function tourCross() {
        if (crossBusy || crossSpent || !cfg.tourCrossPage) return false;
        // A tour confined to part of this page has no business on the next one. Not spent: } widens.
        if (tourConfined()) {
            dbg('no next page — the tour is confined to ' + (tour.postOnly ? 'the post' : describeEl(tour.scope)) + '; } widens it');
            return false;
        }
        crossBusy = true;
        try {
            const href = crossNext || nextPageIn(document, location.href);
            if (!href) {
                crossSpent = true;
                dbg('no next page — nothing found that says which way is forward');
                return false;
            }
            const doc = await fetchDoc(href);
            if (!doc) { crossSpent = true; dbg('the next page could not be fetched', href); return false; }
            crossPage++;
            const got = harvestFrom(doc, href, crossPage);
            crossNext = nextPageIn(doc, href);
            if (!crossNext) crossSpent = true;
            dbg('harvested the next page', { page: href, pictures: got.length,
                total: harvest.length + got.length, then: crossNext || '(no further page)' });
            if (!got.length) return false;
            harvest = harvest.concat(got);
            return true;
        } finally {
            crossBusy = false;
        }
    }

    function crossReset() {
        harvest = [];
        crossNext = null;
        crossSpent = false;
        crossPage = 1;
    }

    // Scroll first, then the next page: a page that will load more in place is cheaper, and it
    // keeps everything in one document where the layout gates still apply.
    async function tourMore(force) {
        if (await tourAskMore(force)) { if (tour && tour.had) tourAdopt(tour.had); return true; }
        return await tourCross();
    }

    // A feed that appends each batch as a sibling block lands it outside the section the tour
    // picked. Widen to the nearest ancestor holding new pictures, if it holds nothing else.
    function tourAdopt(had) {
        if (!tour || !tour.scope || tour.scope === document.documentElement || !tour.scope.isConnected) return;
        const pics = tourPics(tourFloor());
        const fresh = pics.filter(function (p) { return !had.has(p); });
        if (!fresh.length || fresh.some(function (p) { return tour.scope.contains(p); })) return;
        let a = tour.scope.parentElement;
        while (a && !fresh.some(function (p) { return a.contains(p); })) a = a.parentElement;
        if (!a) return;
        const old = tour.scope;
        const stray = pics.filter(function (p) { return a.contains(p) && !old.contains(p) && had.has(p); });
        if (stray.length) {
            dbg('new pictures arrived outside the tour section, which is left as it is', { stray: stray.length });
            return;
        }
        tour.scope = a;
        dbg('tour scope widened to take in the new pictures: ' + describeEl(a), { fresh: fresh.length });
    }

    // One request for more at a time; a press at the wall waits on the refill already running.
    let moreP = null;
    function tourMoreOnce(force) {
        if (!moreP) moreP = tourMore(force).finally(function () { moreP = null; });
        return moreP;
    }

    // Nothing left to ask for: the page will not load more and there is no next page to fetch.
    function tourExhausted() {
        const scoped = tourConfined();
        return (excSpent || !cfg.tourLoadMore) && (crossSpent || !cfg.tourCrossPage || scoped);
    }

    // ▶ on the last picture: more if the page has any, otherwise the slideshow ends.
    async function tourWall(user) {
        showSpinner();
        dockSpinner();
        let grew = false;
        wallBusy = true;
        try { grew = await tourMoreOnce(true); }
        finally { hideSpinner(); wallBusy = false; }
        if (!tour || !placed) return;
        if (grew) { tourSync(); tourNav(1, false); return; }
        // A batch that landed after the excursion stopped watching (LibreWolf: seconds later).
        if (tour.had) tourAdopt(tour.had);
        const list = tourSync();
        if (list && tour.index >= 0 && tour.index < list.length - 1) {
            dbg('tour: more pictures arrived after the page was asked', { now: list.length });
            tourNav(1, false);
            return;
        }
        if (tourExhausted()) tourSeam(1, user);
    }

    // Past an end: user input stops there once (note, SEAM_HOLD_MS deaf that way only); the next step wraps.
    function tourSeam(dir, user) {
        if (!tour || !placed) return;
        if (user && seamDir !== dir) {
            seamDir = dir;
            seamHoldUntil = Date.now() + SEAM_HOLD_MS;
            seamNote(dir > 0 ? 'Last picture' : 'First picture');
            return;
        }
        seamDir = 0;
        const list = tourEntries();
        tour.total = list.length;
        if (list.length < 2) return;
        const to = dir > 0 ? 0 : list.length - 1;
        dbg('tour wrapped to ' + (dir > 0 ? 'the first picture' : 'the last picture'), { of: list.length });
        seamNote(dir > 0 ? 'Wrapped to the first picture' : 'Wrapped to the last picture');
        tourGo(list, to, dir, false);
    }

    // White text over the picture, faded out after SEAM_NOTE_MS.
    function seamNote(text) {
        if (!seamNoteEl) return;
        clearTimeout(seamNoteTimer);
        seamNoteEl.textContent = text;
        seamNoteEl.classList.add('on');
        seamNoteTimer = setTimeout(function () { seamNoteEl.classList.remove('on'); }, SEAM_NOTE_MS);
    }

    // Fire and forget: the refill overlaps with pictures the user is still looking at rather
    // than stalling them at the wall.
    function tourGrow(dir, stepAfter) {
        // Pictures the page mounted as it followed the tour, with no excursion involved.
        if (tour && tour.had && !stepAfter) {
            const was = tour.scope;
            tourAdopt(tour.had);
            if (tour.scope !== was) { tourSync(); twSync(); }
        }
        tourMoreOnce(false).then(function (grew) {
            if (!grew || !tour || !placed) return;
            const list = tourSync();
            twSync();
            if (!list) return;
            if (stepAfter) { tourNav(dir, false); return; }
            if (tour.index >= 0) plFill(list, tour.index, dir);
        });
    }

    // ---- the preloader
    //
    // Depth buys a burst; only concurrency buys a rate. Measured: serial resolves land one picture
    // every ~1.1-1.45s, against a 3/s target — so the window absorbs the burst and six workers
    // sustain the rate. Do not raise the worker count without re-measuring. TOUR.md §6 and §14.

    const PL_GAP_MS = 120;      // minimum spacing between speculative request STARTS
    const PL_GUESSES = 1;       // guesses a speculative resolve may spend beyond its keeps
    const PL_VIDEO_AHEAD = 2;   // a hover job's distance sits past this, so it never buffers a clip
    const PL_VIDS_WATCH = 5;    // clips buffered ahead while the user watches them through
    const PL_VIDS_FLIP = 12;    // ...and while they leave them unfinished
    const PL_MAX_WORKERS = 12;
    const PL_COLD_MS = 500;     // a preloaded picture slower than this to arrive was fetched again

    const plDone = new Map();   // plKey -> { res, displayed, sig }; kept for the life of the page
    let plQueue = [];
    let plLive = [];            // tokens of running speculative resolves, for cancellation
    let plRunning = 0;
    let plSlotAt = 0;           // the next reserved request start time
    let plPaused = false;       // a foreground resolve is waiting: start nothing speculative
    let plSerial = false;       // some host in the window pushed back
    let plGen = 0;              // bumped on a direction change; older jobs fall out
    let plDir = 0;
    let plWarmGen = 0;          // bumped when the browser has dropped the loaded files
    let plColdAt = 0;

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    // Reserved SYNCHRONOUSLY, before any await, so two workers cannot claim one slot. This, not
    // the worker count, is what bounds the load a 6-wide preloader puts on a site.
    function plReserve() {
        const now = Date.now();
        const at = Math.max(now, plSlotAt);
        plSlotAt = at + PL_GAP_MS;
        return at - now;
    }

    function plWorkers() {
        if (plSerial) return 1;
        const n = cfg.tourWorkers | 0;
        return Math.max(1, Math.min(PL_MAX_WORKERS, n || 6));
    }

    // Everything queued or in flight is abandoned; what has already been answered is kept.
    function plCancel() {
        plGen++;
        plQueue = [];
        plLive.forEach(function (t) { t.cancelled = true; });
        plLive = [];
    }

    // The answers survived but the files did not (a tab left for hours): load them all again.
    function plWentCold() {
        if (Date.now() - plColdAt < 10000) return;
        plColdAt = Date.now();
        plWarmGen++;
        plKeep.length = 0;
        plKeepBytes = 0;
        dbg('preloader: the browser dropped the loaded pictures; loading them again');
        if (!tour || !tour.on || tour.index < 0) return;
        plFill(tourEntries(), tour.index, plDir || 1);
    }

    function plReset() {
        plStop();
        plDone.clear();
        plKeep.length = 0;
        plKeepBytes = 0;
    }

    // The slideshow closed: stop loading, keep every answer for the next one.
    function plStop() {
        hwScope = null;
        plCancel();
        plDir = 0;
    }

    // Answers are known by picture and link, so a feed that rebuilds its elements keeps them.
    function plKey(el) {
        const u = pictureUrl(el);
        if (!u || placeholder(el, u)) return el;
        const a = closestAcross(el, 'a');
        return u + '\n' + ((a && a.getAttribute('href')) || '');
    }
    function plGet(el) { return plDone.get(plKey(el)); }
    function plHas(el) { return plDone.has(plKey(el)); }
    function plSet(el, v) { plDone.set(plKey(el), v); }

    function plPump() {
        if (plPaused) return;
        while (plRunning < plWorkers() && plQueue.length) {
            const job = plQueue.shift();
            if (job.gen !== plGen) continue;
            plRunning++;
            plRun(job).then(plDoneOne, plDoneOne);
        }
    }

    function plDoneOne() { plRunning--; plPump(); twLoadLater(); }

    async function plRun(job) {
        const wait = plReserve();
        if (wait > 0) await sleep(wait);
        if (job.gen !== plGen || (!tour && !job.hover)) return;
        if (job.rewarm) { job.rewarm.warm = plWarmGen; plKeepImage(job.rewarm.res); return; }
        primeLink(job.el);
        if (plHas(job.el)) return;
        const token = { cancelled: false, fresh: false };
        plLive.push(token);
        let hit = null;
        const displayed = sizeOf(job.el);
        try { hit = await resolve(job.el, displayed, token, null, PL_GUESSES); }
        catch (e) { hit = null; }
        plLive = plLive.filter(function (t) { return t !== token; });
        if (job.gen !== plGen || token.cancelled) return;
        plSet(job.el, { res: hit, displayed: displayed, sig: candSig(job.el, PL_GUESSES), warm: plWarmGen });
        dbg('preloaded', { ahead: job.dist, buffered: plDone.size, queued: plQueue.length,
            workers: plWorkers(), got: hit ? hit.w + '×' + hit.h + ' ' + hit.url.slice(-48)
                                          : 'nothing (the full search runs on arrival)' });
        if (!hit) return;
        // Probing an image leaves it in the HTTP cache; probing a clip does not, because
        // probeVideo() aborts the fetch the moment it has the dimensions.
        if (hit.video) { if (!job.hover && job.dist <= plVidsAhead) plWarmVideo(hit.url); }
        else { plKeepImage(hit); fpTake(job.el, hit); }
    }

    // Queue every entry not yet answered, nearest first and ahead before behind. Nothing running
    // is cancelled: a picture passed at speed is still wanted when the user comes back.
    function plFill(list, at, dir) {
        if (at < 0) return;
        const depth = plDepth();
        plDir = dir;
        const jobs = [];
        for (let i = 0; i < list.length; i++) {
            const d = (i - at) * dir;
            if (depth && Math.abs(d) > depth) continue;
            const dist = d >= 0 ? d : -2 * d;
            const pre = plDone.get(list[i].pk || plKey(list[i].el));     // pk: taken when the list was built
            if (pre) {
                if (plWarmGen && pre.warm !== plWarmGen && pre.res && !pre.res.video) jobs.push({ rewarm: pre, dist: dist, gen: plGen });
                continue;
            }
            if (list[i].ghost) continue;        // not on the page: nothing to resolve from until it mounts
            jobs.push({ el: list[i].el, dist: dist, gen: plGen });
        }
        for (let k = 1; k <= plVidsAhead; k++) {
            const e = list[at + k * dir], pre = e && plDone.get(e.pk || plKey(e.el));
            if (pre && pre.res && pre.res.video) plWarmVideo(pre.res.url);
        }
        jobs.sort(function (x, y) { return x.dist - y.dist; });
        plQueue = jobs;
        plSerial = list.some(function (e) { return noRush(hostOf(e.url)); });
        plPump();
    }

    // How far either way the slideshow loads; 0 is all of it, unless the browser is saving data.
    function plDepth() {
        const n = Math.max(0, cfg.preloadAhead | 0);
        if (n) return n;
        const c = navigator.connection;
        return c && c.saveData ? 12 : 0;
    }

    // A probe lets its Image go and relies on the HTTP cache, which Chromium can evict, and which a
    // server can refuse ("no-store"). Held Images keep the files in memory, up to a budget.
    const plKeep = [];
    let plKeepBytes = 0;
    const PL_BYTES_PER_PX = 0.5;    // an estimate of a compressed picture's size; nothing measures it

    function plBudget() {
        const mb = Math.max(0, cfg.preloadMB | 0);
        if (mb) return mb * 1048576;
        const dm = +navigator.deviceMemory || 0;       // GB, rounded; Chromium only (the pane reports 32)
        return (dm ? Math.min(1024, dm * 128) : 1024) * 1048576;
    }

    function plKeepImage(res) {
        if (plKeep.some(function (k) { return k.url === res.url; })) return;
        const im = new Image();
        if (noReferrerHere()) im.referrerPolicy = 'no-referrer';
        im.src = res.url;
        const bytes = Math.max(1, (res.w * res.h) || 0) * PL_BYTES_PER_PX;
        plKeep.push({ url: res.url, im: im, bytes: bytes });
        plKeepBytes += bytes;
        while (plKeep.length > 1 && plKeepBytes > plBudget()) plKeepBytes -= plKeep.shift().bytes;
    }

    // Stage 2 for clips: a real buffered fetch, which the metadata probe deliberately aborts.
    let plVids = [];
    let plVidsAhead = PL_VIDS_WATCH;

    // Leaving a clip the slideshow showed: unfinished means flipping, so buffer further ahead.
    function plVidLeft() {
        if (!view || mediaEl !== vidEl || !(vidEl.duration > 0)) return;
        let played = 0;
        for (let i = 0; i < vidEl.played.length; i++) played += vidEl.played.end(i) - vidEl.played.start(i);
        const was = plVidsAhead;
        plVidsAhead = played >= vidEl.duration * 0.9 ? PL_VIDS_WATCH : PL_VIDS_FLIP;
        if (plVidsAhead !== was) dbg('clips buffered ahead: ' + plVidsAhead, { played: played.toFixed(1) + ' of ' + vidEl.duration.toFixed(1) + ' s' });
    }

    function plWarmVideo(url) {
        if (plVids.some(function (v) { return v.src === url; })) return;
        const v = document.createElement('video');
        v.preload = 'auto';
        v.muted = true;
        v.src = url;
        plVids.push(v);
        while (plVids.length > plVidsAhead) {
            const old = plVids.shift();
            old.removeAttribute('src');
            old.load();
        }
    }

    // ---- warming the section a hover started in
    //
    // One preview says the user is reading this part of the page, so the rest of it that is on
    // screen goes through the same preloader; scrolling adds what comes into view.

    const HW_SCROLL_MS = 200;

    let hwScope = null, hwTimer = 0;

    // Pick the hovered picture's section (the tour's own start rule) and warm what is visible in it.
    function hwStart(el) {
        if (!cfg.hoverPreload || tour || !el || !el.isConnected) return;
        pgHovered = window.scrollY || 0;
        if (pointer.y > vpH() * PG_LOW) pgWant(2);
        if (!(hwScope && hwScope.isConnected && hwScope.contains(el))) {
            const pics = tourPics(idleFloor());
            const levels = tourLevels(el, pics);
            hwScope = levels[tourPick(levels, pics)].el;
            dbg('warming the section: ' + describeEl(hwScope));
        }
        hwFill();
    }

    function onScreen(el) {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vpH() && r.left < vpW();
    }

    // Queue the section's on-screen pictures; queued ones that scrolled away are dropped.
    function hwFill() {
        if (!cfg.hoverPreload || tour || !hwScope || !hwScope.isConnected) { hwScope = null; return; }
        const pics = tourPics(idleFloor()).filter(function (p) {
            return hwScope.contains(p) && onScreen(p);
        });
        const want = new Set(pics);
        plQueue = plQueue.filter(function (j) { return !j.hover || j.page || want.has(j.el); });
        let added = 0;
        pics.forEach(function (p) {
            if (plHas(p) || plQueue.some(function (j) { return j.el === p; })) return;
            const u = pictureUrl(p);
            if (!u || blocked(u)) return;
            plQueue.push({ el: p, dist: PL_VIDEO_AHEAD + 1, gen: plGen, hover: true });
            added++;
        });
        if (added) dbg('warming ' + added + ' more in the section', { queued: plQueue.length });
        plPump();
    }

    // ---- loading the page ahead of the user
    //
    // Interest decides how far: what is on screen on arrival, the next screen after a hover near
    // the bottom, and everything once they scroll a few screens down or scroll after a hover.

    const PG_LOW = 0.6;             // a hover below this fraction of the viewport looks ahead
    const PG_ALL_SCREENS = 3;       // scrolled this many screens down: they want the whole page

    let pgLevel = 0;                // 1 on screen, 2 the next screen too, 3 everything
    let pgHref = '';
    let pgHovered = -1;             // scrollY at the last preview, -1 before any

    function pgWant(level) {
        if (level > pgLevel) {
            pgLevel = level;
            dbg('loading ahead: ' + ['', 'what is on screen', 'the next screen', 'the whole page'][level]);
        }
        pgFill();
    }

    // Re-read interest from the scroll position, then queue.
    function pgTick() {
        if (pgHref !== location.href) { pgHref = location.href; pgLevel = 0; pgHovered = -1; }
        const y = window.scrollY || 0, h = vpH();
        if (h > 0 && (y >= h * PG_ALL_SCREENS || (pgHovered >= 0 && Math.abs(y - pgHovered) >= h))) pgWant(3);
        else pgWant(1);
    }

    // Queue the pictures the current level covers, nearest the screen first.
    function pgFill() {
        if (!cfg.hoverPreload || tour || !pgLevel || !siteEnabled() || CAPTCHA_HERE) return;
        const level = plDepth() ? 1 : pgLevel;         // saving data: only what is on screen
        const h = vpH();
        if (!(h > 0)) return;
        const want = [];
        idlePics(idleFloor()).forEach(function (p) {
            const r = p.getBoundingClientRect();
            if (!r.width || !r.height) return;
            if (level < 3 && (r.bottom <= 0 || r.top >= h * level)) return;
            want.push({ el: p, d: r.top >= 0 ? r.top : h - 2 * r.top });
        });
        want.sort(function (a, b) { return a.d - b.d; });
        let added = 0;
        want.forEach(function (w) {
            if (plHas(w.el) || plQueue.some(function (j) { return j.el === w.el; })) return;
            const u = pictureUrl(w.el);
            if (!u || blocked(u)) return;
            plQueue.push({ el: w.el, dist: PL_VIDEO_AHEAD + 1, gen: plGen, hover: true, page: true });
            added++;
        });
        if (added) dbg('loading ' + added + ' more ahead', { queued: plQueue.length });
        plPump();
    }

    window.addEventListener('scroll', perfWrap(function onScrollWarm() {
        if (!hwScope) return;
        clearTimeout(hwTimer);
        hwTimer = setTimeout(hwFill, HW_SCROLL_MS);
    }, 'event'), { passive: true });

    // ---- gallery mode: hovering a link floats the linked page's thumbnails. See docs/GALLERY.md.

    const GAL_WAIT_MS = 2500;           // longest wait for thumbnails before laying out without the rest
    const GAL_GAP = 12;                 // px between cells and at the edges
    const GAL_FADE_MS = 200;
    const GAL_UPGRADE = 1.3;            // drawn this much larger than the thumbnail's file -> fetch the next size
    const GAL_CACHE = 300;              // fetched pages kept by URL
    const GAL_TRIES = 4;                // bigger sizes tried per thumbnail
    const GAL_LAZY = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-echo', 'data-defer-src', 'data-url'];
    const GAL_MAX = Infinity;           // every picture the page has
    const GAL_NAME = 'hz-gallery-probe';    // the hidden frame's window.name prefix
    const GAL_FRAME_MS = 10000;         // longest wait for the hidden frame's page to load
    const GAL_HTML_ENOUGH = 6;          // the plain HTML is trusted at once from this many pictures (a logo group is 1-3)
    const GAL_REPORT_MS = 4500;         // longest wait for its report once loaded (the frame's own cap + slack)
    const GAL_HQ_PAR = 4;               // originals fetched at once when a gallery opens
    const GAL_REST_MS = 15000;          // a short gallery waits this long for the rest before redrawing with what came
    const GAL_RETRY_GAP_MS = 1000;      // then the failed thumbnails are tried once more after this
    const GAL_LATE_MS = 6500;           // extra wait when no thumbnail came in GAL_WAIT_MS; ends before the 10 s diagnostics timer
    const GAL_LAG_TICK = 250;          // while a hidden frame loads, a timer this often measures how late it runs
    const GAL_LAG_MS = 1000;            // later than this = the page froze: the frame goes and preloading stops for the page
    const GAL_SETTLE_MS = 700;          // the frame counts once no picture has arrived for this long
    const GAL_QUIET_CAP_MS = 4000;      // from DOMContentLoaded: the frame reports by then whatever it has
    const GAL_MIN_H = 120;              // rows never shorter: a bigger gallery is laid out as pages (cfg.galleryRowMin)
    const GAL_FLIP_MS = 200;            // at most one picture per this long on the wheel
    const GAL_STRIP_H = 54;             // the page and picture rows under the clicked picture
    const GAL_STRIP_H1 = 34;            // the picture row alone: a one-page gallery
    const GAL_UNIT_MIN_W = 120;         // a picture holding the strip: never narrower, or its numbers cannot fit
    const GAL_HD = 7;                   // a resize corner: the frame's 3 px border plus 2 px inside and out
    const GAL_STRIP_W = 190;            // their least width; wider under a wider picture
    const GAL_STRIP_GAP = 6;            // between the picture and the strip
    let galResizeAt = 0, galRefitTimer = 0;
    let galSt = null, galStripM = { m: 'in', side: 'b' };   // the strip, and where it is: in the picture's frame, docked to it, or out on its own
    const GAL_APPEND_MS = 300;          // thumbnails that load late join the set in batches this far apart
    const GAL_GROW_TICK = 400;          // the reading frame scrolls a screen this often
    const GAL_GROW_IDLE_MS = 4000;      // at its bottom with nothing new this long, the page is read
    const GAL_GROW_MAX_MS = 180000;     // longest a gallery's page is read on
    const GAL_FOREIGN_END = 4;          // this many pictures of another card shape in a row: the gallery ended, the site's feed follows
    const GAL_CARD_DEPTH = 4;           // levels of the ancestor chain that make a card's shape
    const GAL_DOOR_MARK = 'data-hz-door';      // the ▦ chip, in the card like the marks
    const GAL_PILL = 'data-hz-marks';          // one dark pill per picture holding chip, tick, disc
    let galPeek = false, galPeekTapAt = 0, galGrowing = null, galGrowEnd = null, galGrowHold = null, galChipHot = null, galLeftAt = 0;
    const galGrown = new Set(), galLists = new Map();
    const galCache = new Map();         // href -> Promise of [{thumb, ss, cands, base}] | null | 'cancel'
    let galFrameStop = null;
    let galHost = null, galRoot = null, galBlur = null, galCur = null, galWant = null, galTopHost = null, galTop = null;
    let galHoverTimer = 0, galPt = { x: 0, y: 0 }, galMovedAt = 0, galLaidAt = 0, galStill = null, galStripOne = true;
    const GAL_SEEN_KEY = 'hoverZoomGallerySeen';   // linked pages whose gallery was shown, oldest first
    const GAL_SEEN_MAX = 10000;
    const GAL_SEEN_MS = 1000;           // a gallery counts as seen once it has been on screen this long
    const GAL_MARK = 'data-hz-seen';
    const GAL_VISITED_KEY = 'hoverZoomGalleryVisited';   // linked pages clicked or opened, oldest first
    const GAL_SAVED_KEY = 'hoverZoomGallerySaved';       // thumbnails whose picture was saved from the gallery
    const GAL_SAVEDFROM_KEY = 'hoverZoomGallerySavedFrom';   // linked pages something was saved from
    const GAL_SAVED_MARK = 'data-hz-saved';
    let galSeen = {}, galMarkTimer = 0, galHole = null, galFly = null;
    const GAL_FLY_MS = 320;             // the clicked picture's flight to the corner and back
    const GAL_FLY_FRAC = 0.2;           // its height there, of the window's (user)
    let galOn = false, galTap = false, galMidAt = 0;      // a peek is up and locked; Ctrl down with nothing else yet
    const GAL_PEND_MS = 3000;           // the pressed result lights up only if its gallery is not on screen by then
    const GAL_DIAG_MS = 10000;          // an open that shows nothing this long after the press gets the diagnostics popup
    const GAL_USER_HIDE = ['press', 'esc', 'middle', 'ctrl', 'resize', 'scroll', 'chip', 'hole', 'menu'];
    const galTraces = new Map();        // href -> [[ms, what]], sanitised, the last 60 links
    let galPend = null, galInputAt = 0; // the open waiting for its gallery; the user's last wheel/key/press

    // Seen / visited / saved marks: sites with learned doors.
    function galMarksHere() {
        const e = (cfg.doorAreas || {})[pageHost()];
        return !!(e && e.rules && e.rules.length);
    }

    const ICON_GALLERY = 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z';
    const ICON_TICK = 'M9 16.2l-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z';

    // The page a hovered picture links to, or null.
    function galLinkOf(t) {
        if (!t || t.nodeType !== 1 || !t.closest) return null;
        const a = t.closest('a[href]');
        if (!a || !(t.tagName === 'IMG' || a.querySelector('img'))) return null;
        let u;
        try { u = new URL(a.href, location.href); } catch (e) { return null; }
        if (!/^https?:$/.test(u.protocol)) return null;
        u.hash = '';
        if (u.href === location.href.split('#')[0] || looksLikeImage(u.href)) return null;
        return u.href;
    }

    // A fetched <img>'s thumbnail URL: a lazy attribute (src is then a placeholder), else src, else its smallest srcset entry.
    function galThumbOf(n) {
        const ok = function (u) { return u && !/^(data|blob):/.test(u) && !blocked(u); };
        const abs = function (v) { try { return new URL(v.trim(), n.__hzBase).href; } catch (e) { return ''; } };
        const named = GAL_LAZY.slice();
        for (let i = 0; i < n.attributes.length; i++) {
            const a = n.attributes[i];
            if (/^data-/.test(a.name) && named.indexOf(a.name) < 0 && !/srcset/.test(a.name) &&
                /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(a.value.trim())) named.push(a.name);
        }
        for (let i = 0; i < named.length; i++) {
            const v = n.getAttribute(named[i]);
            if (v && !/\s/.test(v.trim()) && ok(abs(v))) return abs(v);
        }
        if (n.getAttribute('src') && ok(n.src)) return n.src;
        const ss = n.getAttribute('srcset') || n.getAttribute('data-srcset');
        if (ss) {
            const list = parseSrcset(ss);       // widest first
            if (list.length && ok(abs(list[list.length - 1]))) return abs(list[list.length - 1]);
        }
        return '';
    }

    // The gallery: the largest group of pictures on the page that share one ancestor chain.
    function galPick(doc, href) {
        return galGroup(doc, href).slice(0, GAL_MAX).map(function (x) { return galItem(x.el, x.thumb, href); });
    }

    // The fetched page's biggest group of like-placed pictures, as [{el, thumb}].
    function galGroup(doc, href, quiet) {
        const groups = new Map();
        doc.querySelectorAll('img').forEach(function (n) {
            n.__hzBase = href;
            const thumb = galThumbOf(n);
            if (!thumb) return;
            const w = parseInt(n.getAttribute('width') || '0', 10) || 0;
            const h = parseInt(n.getAttribute('height') || '0', 10) || 0;
            if ((w || h) && w < cfg.minDisplayed && h < cfg.minDisplayed) return;
            if (cfg.skipFurniture && decorativeReason(n)) return;
            const k = domChain(n);
            if (!groups.has(k)) groups.set(k, []);
            const g = groups.get(k);
            if (!g.some(function (x) { return x.thumb === thumb; })) g.push({ el: n, thumb: thumb });
        });
        let best = [];
        groups.forEach(function (g) { if (g.length > best.length) best = g; });
        if (!quiet) dbg('gallery picked from the HTML', { href: href, groups: groups.size, pictures: best.length,
            chain: best.length ? domChain(best[0].el) : '' });
        return best;
    }

    const galKinds = new Map();     // door chain -> Promise<'gallery'|'results'|null>, this page only
    const galKindDone = new Map();  // door chain -> its settled kind

    // Whether a door leads to a gallery or to more results, read once per area on this page.
    function galKindOf(el, href) {
        const key = domChain(el);
        if (galKinds.has(key)) return galKinds.get(key);
        const p = galKindRead(href).then(function (k) {
            galKindDone.set(key, k);
            return k;
        });
        galKinds.set(key, p);
        return p;
    }

    async function galKindRead(href) {
        const doc = await fetchDoc(href);
        if (!doc) return null;
        const pics = galGroup(doc, href), pages = [];
        const k = { pics: pics.length, linked: 0, images: 0, checked: 0, leaves: 0 };
        pics.forEach(function (x) {
            const a = x.el.closest('a[href]');
            let u;
            try { u = a && new URL(a.getAttribute('href'), href); } catch (e) { u = null; }
            if (!u || !/^https?:$/.test(u.protocol)) return;
            u.hash = '';
            if (u.href === href.split('#')[0]) return;
            k.linked++;
            if (looksLikeImage(u.href)) k.images++;
            else if (u.origin === location.origin) pages.push({ u: u, thumb: x.thumb });
        });
        if (!doorKindVerdict(k)) {
            for (const c of pages.slice(0, 2)) {
                const leaf = await galLeafAt(c.u, c.thumb);
                if (leaf === null) continue;
                k.checked++;
                if (leaf) { k.leaves++; break; }
            }
        }
        const v = doorKindVerdict(k);
        dbg('door leads to: ' + (v || 'unknown'), { href: href, pictures: k.pics, linked: k.linked,
            toImages: k.images, pagesChecked: k.checked, leaves: k.leaves });
        return v;
    }

    // Does this page hold a bigger copy of thumb? null = it could not be read.
    async function galLeafAt(u, thumb) {
        let p = pageCache.get(u.href);
        if (!p) { p = fetchPageMedia(u); pageCache.set(u.href, p); }
        const page = await p;
        if (!page) return null;
        const same = (page.declared ? [page.declared.url] : []).concat(page.body || [])
            .filter(function (x) { return x !== thumb && sameStem(x, thumb); });
        if (!same.length) return false;
        const own = await probe(thumb, false);
        for (const x of same.slice(0, 3)) {
            const d = await probe(x, false);
            if (d && (!own || d.w * d.h > own.w * own.h)) return true;
        }
        return false;
    }

    // One picture as plain data, so it can cross from the hidden frame: thumbnail, srcsets, resolver candidates.
    function galItem(el, thumb, base) {
        const ss = [el.getAttribute('srcset'), el.getAttribute('data-srcset')];
        const pic = el.closest && el.closest('picture');
        if (pic) pic.querySelectorAll('source[srcset]').forEach(function (s) { ss.push(s.getAttribute('srcset')); });
        let cands = [];
        try {
            cands = collectCandidates(el).map(function (c) { return c.url; })
                .filter(function (u) { return u !== thumb && !isVideoUrl(u); }).slice(0, GAL_TRIES * 2);
        } catch (e) { /* no candidates is fine: the thumbnail stays */ }
        const links = galItemLinks(el, base);
        return { thumb: thumb, ss: ss.filter(Boolean), cands: cands, base: base, links: links, link: links.length === 1 ? links[0] : '' };
    }

    // The pages a gallery picture may open on its own page: its link, else its card's links.
    function galItemLinks(el, base) {
        const a = el.closest && el.closest('a[href]');
        if (!a) return cardLinks(el);
        let u;
        try { u = new URL(a.getAttribute('href'), base); } catch (e) { return []; }
        u.hash = '';
        return /^https?:$/.test(u.protocol) && u.href !== String(base).split('#')[0] ? [u.href] : [];
    }

    // A card with several links (post, poster): the one whose first path part is the one most single-link cards use.
    function galLinksPick(items) {
        const seg = function (h) { try { return new URL(h).pathname.split('/')[1] || ''; } catch (e) { return ''; } };
        const n = new Map();
        items.forEach(function (it) { if (it.links && it.links.length === 1) n.set(seg(it.links[0]), (n.get(seg(it.links[0])) || 0) + 1); });
        let top = null, most = 0;
        n.forEach(function (c, k) { if (c > most) { most = c; top = k; } });
        if (top === null) return;
        items.forEach(function (it) {
            if (it.link || !it.links || it.links.length < 2) return;
            const hit = it.links.filter(function (h) { return seg(h) === top; });
            if (hit.length === 1) it.link = hit[0];
        });
    }

    // The rendered page's pictures, by the widget's own rules, from a hidden frame. null = the frame failed.
    // With onMore the frame stays after its first report and scrolls its page, reporting what joins (onEnd says why it stopped).
    function galRender(href, onMore, onEnd) {
        if (galFrameStop) galFrameStop();
        return new Promise(function (resolve) {
            const token = Math.random().toString(36).slice(2);
            const f = document.createElement('iframe');
            let done = false, gone = false, t = 0, lagT = 0, lagAt = performance.now();
            const end = function (why) {
                if (gone) return;
                gone = true;
                clearTimeout(t);
                clearTimeout(lagT);
                window.removeEventListener('message', onMsg);
                if (galFrameStop === stop) galFrameStop = null;
                if (galGrowEnd === end) galGrowEnd = null;
                if (galGrowHold === hold) galGrowHold = null;
                f.remove();
                if (done && onEnd) onEnd(why);
                setTimeout(galPreNext, 0);
            };
            const fin = function (v, why, keep) {
                if (done) return;
                done = true;
                galTrace(href, 'frame: ' + String(why).replace(/landed on .*/, 'landed on another page') + (v && v !== 'cancel' ? ' (' + v.length + ' pictures)' : ''));
                dbg('gallery frame: ' + why, { href: href, pictures: v ? v.length : 0 });
                resolve(v);
                if (keep) { clearTimeout(t); t = setTimeout(function () { end('timed out'); }, GAL_GROW_MAX_MS + GAL_REPORT_MS); }
                else end(why);
            };
            let held = false;
            // Reading on waits (on) or goes on (off); a wait does not count towards its time limit.
            const hold = function (on) {
                if (!done || gone || on === held) return;
                held = on;
                clearTimeout(t);
                if (!on) t = setTimeout(function () { end('timed out'); }, GAL_GROW_MAX_MS + GAL_REPORT_MS);
                galTrace(href, 'reading on: ' + (on ? 'waits, the next page is full' : 'goes on'));
                try { f.contentWindow.postMessage({ hzGalleryHold: token, hold: on }, new URL(href).origin); } catch (e) { /* frame gone */ }
            };
            const stop = function () { if (done) end('cancelled'); else fin('cancel', 'replaced by a newer hover'); };
            const onMsg = function (e) {
                if (e.source !== f.contentWindow || !e.data || e.data.hzGallery !== token) return;
                if (e.data.title) keepPageInfo(href, e.data.title, e.data.site);
                const items = Array.isArray(e.data.items) ? e.data.items : [];
                if (Array.isArray(e.data.notes)) e.data.notes.forEach(function (n) { galTrace(href, 'frame: ' + String(n)); });
                if (!done) { fin(items, 'reported', !!onMore && !e.data.done); return; }
                if (items.length) onMore(items);
                if (e.data.done) end('grown');
            };
            galFrameStop = stop;
            if (onMore) { galGrowEnd = end; galGrowHold = hold; }
            window.addEventListener('message', onMsg);
            f.name = GAL_NAME + ':' + token + (onMore ? ':grow' : '');
            f.setAttribute('sandbox', 'allow-scripts allow-same-origin');     // no top navigation, no popups
            f.setAttribute('aria-hidden', 'true');
            f.tabIndex = -1;
            f.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:' + vpW() + 'px;height:' + vpH() +
                'px;border:0;opacity:0;pointer-events:none;z-index:-2147483647';
            f.addEventListener('load', function () {
                if (done) return;
                let u = '';
                try { u = f.contentWindow.location.href; } catch (e) { u = 'unreadable: ' + e.name; }
                galTrace(href, 'frame loaded');
                if (!u || u === 'about:blank' || /^unreadable/.test(u)) fin(null, 'the page refused to load in a frame, landed on ' + (u || 'nothing'));
                else {
                    clearTimeout(t);
                    t = setTimeout(function () { fin(null, 'no report ' + GAL_REPORT_MS + ' ms after the page loaded'); }, GAL_REPORT_MS);
                }
            });
            t = setTimeout(function () { fin(null, 'no report in ' + GAL_FRAME_MS + ' ms'); }, GAL_FRAME_MS);
            const lagCheck = function () {
                const late = performance.now() - lagAt - GAL_LAG_TICK;
                if (late > GAL_LAG_MS && document.visibilityState !== 'hidden') {   // a hidden tab's timers are throttled, not frozen
                    galPreHalt('froze');
                    if (done) end('froze'); else fin(null, 'the page froze for ' + Math.round(late) + ' ms');
                    return;
                }
                lagAt = performance.now();
                lagT = setTimeout(lagCheck, GAL_LAG_TICK);
            };
            lagT = setTimeout(lagCheck, GAL_LAG_TICK);
            galTrace(href, 'frame start');
            f.src = href;
            document.documentElement.appendChild(f);
        });
    }

    // Inside the hidden frame: no video, audio or embedded player loads, now or when the page adds one later.
    function galNoMedia() {
        const kill = function (el) {
            const t = el.tagName;
            if (t === 'VIDEO' || t === 'AUDIO') {
                if (!el.hasAttribute('src') && !el.querySelector('source') && !el.currentSrc && !el.srcObject) return;   // already emptied: load() again would loop
                try {
                    el.pause(); el.muted = true; el.autoplay = false; el.preload = 'none';
                    el.removeAttribute('src');
                    if (el.srcObject) el.srcObject = null;
                    el.querySelectorAll('source').forEach(function (s) { s.remove(); });
                    el.load();
                } catch (e) { /* already gone */ }
            } else if (t === 'IFRAME' || t === 'EMBED' || t === 'OBJECT') el.remove();
        };
        const sweep = function (root) {
            if (root.nodeType !== 1) return;
            if (/^(VIDEO|AUDIO|IFRAME|EMBED|OBJECT)$/.test(root.tagName)) kill(root);
            root.querySelectorAll('video,audio,iframe,embed,object').forEach(kill);
        };
        sweep(document.documentElement);
        document.addEventListener('loadstart', function (e) { if (e.target && e.target.tagName) kill(e.target); }, true);
        try {
            new MutationObserver(function (recs) {   // the frame is thrown away within seconds; nothing is kept
                recs.forEach(function (r) { r.addedNodes.forEach(sweep); });
            }).observe(document.documentElement, { childList: true, subtree: true });
        } catch (e) { /* loadstart still catches media */ }
    }

    // A picture's card shape: the first GAL_CARD_DEPTH levels of its ancestor chain (an outer load-state class does not count).
    function galCardSig(el) {
        return domChain(el).split('>').slice(0, GAL_CARD_DEPTH).join('>');
    }

    // A path's shape: its first segment as written, later ones as # (a number) or w (anything else).
    function galPathShape(p) {
        return String(p || '/').split('/').filter(Boolean).map(function (s, i) { return i === 0 ? s.toLowerCase() : /^\d+$/.test(s) ? '#' : 'w'; }).join('/');
    }

    // Inside the hidden frame: once no picture has arrived for GAL_SETTLE_MS (or at GAL_QUIET_CAP_MS), send the parent what the widget would count.
    function galProbeReport() {
        const tag = String(window.name).slice(GAL_NAME.length + 1).split(':');
        const token = tag[0], grow = tag[1] === 'grow';
        let sent = false, quietT = 0, capT = 0, obs = null, held = false;
        const known = new Set();
        window.addEventListener('message', function (e) {
            if (e.source === window.parent && e.data && e.data.hzGalleryHold === token) held = !!e.data.hold;
        });
        galNoMedia();
        document.addEventListener('play', function (e) {
            try { e.target.muted = true; e.target.pause(); } catch (x) { /* not media */ }
        }, true);
        const list = function () {
            try {
                return widgetEntries().filter(function (e) { return e.el && e.el.tagName === 'IMG'; })
                    .map(function (e) { const x = galItem(e.el, shownUrl(e.el) || e.url, location.href); x.sig = galCardSig(e.el); x.el = e.el; return x; })
                    .filter(function (x) { return x.thumb && !/^(data|blob):/.test(x.thumb); }).slice(0, GAL_MAX);
            } catch (err) { dbg('gallery frame could not list the page', String(err)); return []; }
        };
        let shapes = null, foreign = 0;
        const linkOf = function (x) {
            try { const u = new URL(x.link || x.links[0], location.href); return u.origin === location.origin ? u : null; } catch (e) { return null; }
        };
        // A card shape seen after the gallery's own leads to other galleries when most of its cards are learned doors or link to pages shaped like this one; else it is the gallery's.
        const judge = function (sig, items) {
            const half = items.length / 2, here = galPathShape(location.pathname);
            if (items.filter(function (x) { return doorReason(x.el); }).length > half) return 'other galleries (learned doors)';
            if (items.filter(function (x) { const u = linkOf(x); return u && galPathShape(u.pathname) === here; }).length > half) return 'other galleries (links shaped like this page, ' + here + ')';
            return 'own';
        };
        // The gallery's own pictures: the commonest card shape and every shape up to its last card, from the first list holding any, less a shape there that leads to other galleries while another does not (a post page's own pictures, then the site's feed); a shape after it is judged once.
        const mine = async function (items) {
            if (!items.length) return [];
            if (!shapes) {
                shapes = new Map();
                const n = {}, by = new Map();
                items.forEach(function (x) { n[x.sig] = (n[x.sig] || 0) + 1; });
                let dom = null, last = -1;
                Object.keys(n).forEach(function (k) { if (!dom || n[k] > n[dom]) dom = k; });
                items.forEach(function (x, i) { if (x.sig === dom) last = i; });
                items.forEach(function (x, i) { if (i <= last) { if (!by.has(x.sig)) by.set(x.sig, []); by.get(x.sig).push(x); } });
                const v = new Map();
                if (by.size > 1) for (const [sig, xs] of by) v.set(sig, await judge(sig, xs));
                const some = Array.from(v.values()).some(function (x) { return x === 'own'; });
                by.forEach(function (xs, sig) {
                    const k = some ? v.get(sig) : 'own';
                    shapes.set(sig, k);
                    if (k !== 'own') notes.push('a card shape among the gallery\u2019s first pictures (' + xs.length + ') is ' + k);
                });
            }
            const fresh = new Map();
            items.forEach(function (x) { if (!shapes.has(x.sig)) { if (!fresh.has(x.sig)) fresh.set(x.sig, []); fresh.get(x.sig).push(x); } });
            for (const [sig, xs] of fresh) {
                const v = await judge(sig, xs);
                shapes.set(sig, v);
                notes.push('a card shape after the gallery’s own (' + xs.length + ' pictures) is ' + v);
            }
            const out = [];
            items.forEach(function (x) {
                if (shapes.get(x.sig) === 'own') { out.push(x); foreign = 0; }
                else { known.add(x.thumb); foreign++; }
            });
            return out;
        };
        const notes = [];
        const post = function (items, done, why) {
            if (why) notes.push(why);
            items.forEach(function (x) { known.add(x.thumb); delete x.el; delete x.sig; });
            try { window.parent.postMessage({ hzGallery: token, items: items, done: done, notes: notes.splice(0), title: document.title, site: siteNameOf(document) }, location.origin); }
            catch (e) { /* parent gone */ }
        };
        // Reading on: a screen further down every GAL_GROW_TICK, new pictures sent as they mount, done once the bottom stays quiet or the site's feed begins.
        const readOn = function () {
            let t0 = Date.now(), idle = 0;
            const tick = function () {
                if (held) { t0 += GAL_GROW_TICK; setTimeout(tick, GAL_GROW_TICK); return; }
                const fresh = list().filter(function (x) { return !known.has(x.thumb); });
                (fresh.length ? mine(fresh) : Promise.resolve([])).then(function (ok) {
                    if (fresh.length) idle = 0;
                    if (ok.length) post(ok, false);
                    if (foreign >= GAL_FOREIGN_END) { post([], true, 'read on: stopped, ' + foreign + ' pictures in a row were not the gallery\u2019s'); return; }
                    const se = document.scrollingElement || document.documentElement, max = se.scrollHeight - window.innerHeight;
                    if (se.scrollTop < max - 4) {
                        se.scrollTop = Math.min(max, se.scrollTop + Math.round(window.innerHeight * 0.9));
                        idle = 0;
                        try { window.dispatchEvent(new Event('scroll')); } catch (e) { /* the real one follows */ }     // a frame not painted sends none
                    } else {
                        if (idle % 2000 === 0) { try { window.dispatchEvent(new Event('scroll')); } catch (e) { /* as above */ } }
                        idle += GAL_GROW_TICK;
                    }
                    if (idle >= GAL_GROW_IDLE_MS || Date.now() - t0 > GAL_GROW_MAX_MS) { post([], true, idle >= GAL_GROW_IDLE_MS ? 'read on: the bottom stayed quiet' : 'read on: time limit'); return; }
                    setTimeout(tick, GAL_GROW_TICK);
                });
            };
            setTimeout(tick, GAL_GROW_TICK);
        };
        const send = function (final) {
            if (sent) return;
            const all = list();
            if (!all.length && !final) return;
            sent = true;
            clearTimeout(quietT); clearTimeout(capT);
            if (obs) obs.disconnect();
            mine(all).then(function (items) {
                const end = !grow || foreign >= GAL_FOREIGN_END;
                post(items, end);
                if (!end) readOn();
            });
        };
        const bump = function () { clearTimeout(quietT); quietT = setTimeout(function () { send(false); }, GAL_SETTLE_MS); };
        const isPic = function (n) { return n.nodeType === 1 && (n.tagName === 'IMG' || (n.querySelector && !!n.querySelector('img'))); };
        const go = function () {
            try {
                obs = new MutationObserver(function (recs) {   // the frame is thrown away within seconds; nothing is kept
                    for (let i = 0; i < recs.length; i++) {
                        const r = recs[i];
                        if (r.type === 'attributes' ? r.target.tagName === 'IMG' : Array.prototype.some.call(r.addedNodes, isPic)) { bump(); return; }
                    }
                });
                obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
            } catch (e) { /* the timers still report */ }
            bump();
            capT = setTimeout(function () { send(true); }, GAL_QUIET_CAP_MS);
        };
        if (document.readyState !== 'loading') go(); else document.addEventListener('DOMContentLoaded', go);
    }

    // Both reads at once: the plain HTML as soon as it holds GAL_HTML_ENOUGH; else the frame's report; if that fails, whatever the HTML had (not cached).
    function galLoad(href, log) {
        if (galCache.has(href)) { galTrace(href, 'load: already started or cached'); return galCache.get(href); }
        galTrace(href, 'load start' + (log ? ' (preload)' : ''));
        let weak = false;
        const frame = galRender(href);
        const stopFrame = galFrameStop;
        const req = log && log.req();
        let refused = null;
        const html = fetchDoc(href, function (res) {
            refused = res;
            if (res.status === 429 || res.status === 503) { logBusy(href, res); galPreHalt('limited'); }
            dbg('gallery page refused', { href: href, status: res.status });
        }).then(function (doc) {
            const busy = !!refused && (refused.status === 429 || refused.status === 503);
            galTrace(href, 'html: ' + (refused ? 'status ' + refused.status : doc ? 'ok' : 'failed or not html'));
            if (req) req.done(refused ? { status: refused.status, limited: busy, signal: 'hard',
                retryAfter: busy ? usLog.retryAfterOf(refused.headers) : null } : { status: doc ? 200 : 0 });
            if (doc) keepDocInfo(href, doc);
            const got = doc ? galPick(doc, href) : null;
            if (doc) galTrace(href, 'html: ' + (got ? got.length : 0) + ' pictures');
            return got;
        });
        const p = new Promise(function (resolve) {
            let done = false, frameOver = false;
            const finish = function (v) { if (!done) { done = true; resolve(v); } };
            frame.then(function (v) {
                frameOver = true;
                if (v === 'cancel' && !done) return finish('cancel');
                if (v && v.length) return finish(v);
                html.then(function (h) { weak = !h || h.length < GAL_HTML_ENOUGH; finish(h); });
            });
            html.then(function (h) {
                if (!h || h.length < GAL_HTML_ENOUGH) return;   // a logo and an avatar: the frame decides
                if (!frameOver && stopFrame === galFrameStop && galFrameStop) galFrameStop();
                finish(h);
            });
        }).then(function (v) {
            galTrace(href, 'load result: ' + (v === 'cancel' ? 'cancelled' : !v ? 'nothing' : v.length + ' pictures') + (weak ? ' (HTML only, not kept)' : ''));
            if (v === 'cancel' || !v || weak) galCache.delete(href);
            if (Array.isArray(v)) {
                galLists.set(href, v);
                if (galLists.size > GAL_CACHE) galLists.delete(galLists.keys().next().value);
            }
            return v;
        });
        galCache.set(href, p);
        if (galCache.size > GAL_CACHE) galCache.delete(galCache.keys().next().value);
        return p;
    }

    // The clicked picture, its strip and the menu: a layer of their own, after <body> so it stacks over the preview.
    function galTopRoot() {
        galLayer();
        if (!galTopHost.isConnected) document.documentElement.appendChild(galTopHost);
        return galTop;
    }

    function galLayer() {
        if (galRoot) return galRoot;
        galHost = document.createElement('div');
        galHost.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646';
        galRoot = galHost.attachShadow({ mode: 'open' });
        const st = document.createElement('style');
        st.textContent =
            '.set{position:fixed;inset:0;opacity:0;transition:opacity ' + GAL_FADE_MS + 'ms ease}' +
            '.set.on{opacity:1}' +
            '.cell{position:absolute;left:0;top:0;display:flex;align-items:center;justify-content:center}' +
            '.set.live .cell{pointer-events:auto}' +
            '.short{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:calc(100vw - 32px);box-sizing:border-box;' +
            'padding:6px 12px;border-radius:8px;background:#1e1e2e;border:1px solid #f9e2af;color:#f9e2af;font:13px/1.3 system-ui,sans-serif;' +
            'pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.6)}' +
            '.svd{position:absolute;left:4px;top:4px;width:22px;height:22px;pointer-events:none}' +
            '.strip[hidden]{display:none}' +
            '.strip{position:fixed;z-index:4;display:flex;flex-direction:column;justify-content:space-evenly;padding:0 4px;box-sizing:border-box;cursor:move;' +
            'background:#1e1e2e;border:1px solid #45475a;border-radius:8px;color:#cdd6f4;' +
            'font:12px/1 system-ui,sans-serif;pointer-events:auto;box-shadow:0 4px 14px rgba(0,0,0,.6);user-select:none}' +
            '.strip .r{display:flex;align-items:center;gap:4px;height:24px}' +
            '.strip .r.pg{height:16px}.strip .r.pg .b{height:16px;font-size:8px}.strip .r.pg .t{font-size:11px}.strip.one .r.pg{display:none}' +
            '.strip.out{width:max-content}.strip.out .t{padding:0 6px}' +
            '.strip .b{flex:none;display:flex;align-items:center;justify-content:center;width:20px;height:24px;border-radius:5px;background:#313244;cursor:pointer;font-size:11px}' +
            '.strip .b:hover{background:#45475a}.strip .b.faint{opacity:.35;cursor:default}.strip .b.faint:hover{background:#313244}' +
            '.strip .t{flex:1;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}' +
            '.strip.own{border:3px solid #89b4fa;box-shadow:0 0 14px 2px rgba(137,180,250,.55),0 8px 22px rgba(0,0,0,.6)}' +
            '.strip.edit:not(.in){outline:2px dashed #f9e2af;outline-offset:3px}' +
            '.fly .strip{position:relative;z-index:auto;flex:none;width:auto;border:0;border-radius:0;box-shadow:none}' +
            '.fly.edit.joined{outline:none}' +
            '.fly.edit.joined .pic,.fly.edit.joined .strip{outline:2px dashed #f9e2af;outline-offset:-3px}' +
            '.cell.go{cursor:pointer}' +
            'img{display:block;width:100%;height:100%;object-fit:cover;border-radius:6px;background:#1e1e2e;opacity:0;transition:opacity ' + GAL_FADE_MS + 'ms ease;' +
            'box-shadow:0 8px 22px rgba(0,0,0,.55),0 2px 5px rgba(0,0,0,.4)}' +
            'img.ok{opacity:1}' +
            '.shade{position:absolute;inset:0;background:rgba(0,0,0,.8)}' +
            '.set.live .shade{pointer-events:auto}' +
            '.veil{position:fixed;inset:0;background:rgba(0,0,0,.8);opacity:0;pointer-events:none;transition:opacity ' + GAL_FADE_MS + 'ms ease}' +
            '.veil.on{opacity:1}' +
            '.blur{position:fixed;inset:0;backdrop-filter:blur(0) grayscale(0);transition:backdrop-filter ' + GAL_FADE_MS + 'ms ease}' +
            '.blur.on{backdrop-filter:blur(6px) grayscale(.6)}' +
            '.fly{position:fixed;z-index:3;box-sizing:border-box;border:3px solid #89b4fa;border-radius:8px;overflow:hidden;background:#1e1e2e;' +
            'box-shadow:0 0 14px 2px rgba(137,180,250,.55),0 8px 22px rgba(0,0,0,.6);transform-origin:0 0;cursor:pointer;pointer-events:auto}' +
            '.fly{display:flex;flex-direction:column}' +
            '.fly.on{transition:transform ' + GAL_FLY_MS + 'ms ease,opacity ' + GAL_FLY_MS + 'ms ease}' +
            '.fly .pic{position:relative;flex:1 1 0;min-height:0}' +
            '.fly img{width:100%;height:100%;object-fit:cover;border-radius:0;box-shadow:none;opacity:1}' +
            '.fly.edit{outline:2px dashed #f9e2af;outline-offset:3px}' +
            '.hd{position:fixed;z-index:6;width:' + GAL_HD + 'px;height:' + GAL_HD + 'px;pointer-events:auto}.hd.tl,.hd.br{cursor:nwse-resize}.hd.tr,.hd.bl{cursor:nesw-resize}' +
            '.fly .bt{display:none;gap:8px;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}' +
            '.fly .bt.ask{display:none;flex-wrap:wrap;justify-content:center;width:max-content;max-width:90%}.fly.asking .bt{display:none}.fly.asking .bt.ask{display:flex}' +
            '.fly .bt.ask b{flex-basis:100%;padding:4px 8px;border-radius:6px;background:#1e1e2e;color:#cdd6f4;font:12px/1.3 system-ui,sans-serif;text-align:center}' +
            '.fly .bt span{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:16px;' +
            'background:#1e1e2e;border:1px solid #45475a;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.6)}' +
            '.fly .bt svg{width:18px;height:18px;fill:#a6e3a1}.fly .bt .no svg{fill:#f38ba8}' +
            '.menu[hidden]{display:none}' +
            '.menu{position:fixed;z-index:5;min-width:240px;padding:4px;box-sizing:border-box;background:#1e1e2e;border:1px solid #45475a;border-radius:8px;' +
            'box-shadow:0 8px 28px rgba(0,0,0,.6);color:#cdd6f4;font:13px/1.3 system-ui,sans-serif;pointer-events:auto}' +
            '.menu .it{display:flex;align-items:center;gap:6px;padding:5px 10px 5px 6px;border-radius:5px;cursor:pointer;white-space:nowrap}' +
            '.menu .it:hover{background:#313244}.menu .ck{width:16px;text-align:center;color:#89b4fa}' +
            '.menu .sep{height:1px;margin:4px 6px;background:#45475a}' +
            '.pend[hidden]{display:none}.pend{position:fixed;box-sizing:border-box;border:3px solid #89b4fa;border-radius:8px;' +
            'box-shadow:0 0 0 200vmax rgba(0,0,0,.55),0 0 16px 3px rgba(137,180,250,.7);animation:hzpend .8s ease-in-out infinite alternate}' +
            '@keyframes hzpend{to{border-color:#cdd6f4;box-shadow:0 0 0 200vmax rgba(0,0,0,.55),0 0 4px 1px rgba(137,180,250,.4)}}' +
            '.diag{position:fixed;right:16px;bottom:16px;width:min(560px,calc(100vw - 32px));box-sizing:border-box;padding:12px;' +
            'background:#1e1e2e;color:#cdd6f4;border:1px solid #45475a;border-radius:8px;pointer-events:auto;' +
            'font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.6)}' +
            '.diag b{display:block;margin-bottom:6px;color:#f9e2af}' +
            '.diag textarea{display:block;width:100%;height:260px;box-sizing:border-box;margin:0 0 8px;padding:6px;' +
            'background:#313244;color:#cdd6f4;border:0;border-radius:4px;font:11px/1.4 ui-monospace,Consolas,monospace;resize:vertical}' +
            '.diag button{margin-left:8px;float:right;padding:4px 12px;background:#45475a;color:#cdd6f4;border:0;border-radius:4px;font:inherit;cursor:pointer}' +
            '.diag button:hover{background:#585b70}';
        galRoot.appendChild(st);
        galTopHost = document.createElement('div');
        galTopHost.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647';
        galTop = galTopHost.attachShadow({ mode: 'open' });
        galTop.appendChild(st.cloneNode(true));
        // Outside the fading .set: an ancestor below opacity 1 is a backdrop root, so the blur would show nothing mid-fade.
        galBlur = document.createElement('div');
        galBlur.className = 'blur';
        galRoot.appendChild(galBlur);
        galVeilEl = document.createElement('div');
        galVeilEl.className = 'veil';
        galRoot.appendChild(galVeilEl);
        return galRoot;
    }

    // Rows of one height spread over the viewport, split around the hole: the largest height that fits every shape,
    // or, when that is under GAL_MIN_H, pages of GAL_MIN_H rows. {out: slots by index for `page`, pages: [[from, to]], page}.
    function galRows(asp, hole, page) {
        const G = GAL_GAP, W = vpW(), H = vpH(), bars = [].concat(hole);
        const free = function (y, h) {
            let segs = [[G, W - G]];
            bars.forEach(function (b) {
                if (b.y >= y + h - 0.5 || b.y + b.h <= y + 0.5) return;     // a bar touching a row (snapped to its edge) leaves it whole
                const l = b.x - G, r = b.x + b.w + G, next = [];
                segs.forEach(function (s) {
                    if (r <= s[0] || l >= s[1]) { next.push(s); return; }
                    if (l > s[0]) next.push([s[0], l]);
                    if (r < s[1]) next.push([r, s[1]]);
                });
                segs = next;
            });
            return segs;
        };
        const place = function (h, from, top) {
            top = top || G;
            const n = Math.max(1, Math.floor((H - top) / (h + G)));
            const pitch = n > 1 ? (H - top - G - h) / (n - 1) : 0;
            const out = [];
            let i = from || 0;
            for (let k = 0; k < n && i < asp.length; k++) {
                const y = top + k * pitch;
                free(y, h).forEach(function (s) {
                    const row = [];
                    let used = 0;
                    while (i < asp.length) {
                        const add = (row.length ? G : 0) + asp[i] * h;
                        if (used + add > s[1] - s[0]) break;
                        row.push(i);
                        used += add;
                        i++;
                    }
                    const spare = (s[1] - s[0] - used) / (row.length + 1);
                    let x = s[0] + spare;
                    row.forEach(function (j) {
                        out[j] = { x: x, y: y, w: asp[j] * h, h: h };
                        x += asp[j] * h + G + spare;
                    });
                });
            }
            return { out: out, all: i === asp.length, next: i };
        };
        const minH = Math.min(galMinH(), H - 2 * G);
        if (place(minH).all) {
            let lo = minH, hi = H - 2 * G, best = place(lo);
            for (let k = 0; k < 24; k++) {
                const mid = (lo + hi) / 2, p = place(mid);
                if (p.all) { best = p; lo = mid; } else hi = mid;
            }
            return { out: best.out, pages: [[0, asp.length]], page: 0 };
        }
        const top = G, pages = [], ph = galPagedH(H).h;
        for (let s = 0; s < asp.length;) {
            const e = Math.max(place(ph, s, top).next, s + 1);
            pages.push([s, e]);
            s = e;
        }
        const k = Math.min(Math.max(0, page | 0), pages.length - 1);
        return { out: place(ph, pages[k][0], top).out, pages: pages, page: k };
    }

    // The shading: the page dark and blurred, except the corner where the clicked picture waits.
    function galShade(set, o) {
        set.shade.style.clipPath = galClip(o);
        if (galBlur) galBlur.style.clipPath = set.shade.style.clipPath;
    }

    // The whole window less one box, as a clip-path.
    function galClip(o) {
        const W = vpW(), H = vpH();
        const box = [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]];
        const pts = function (a) { return a.map(function (p) { return p[0] + 'px ' + p[1] + 'px'; }).join(','); };
        return 'polygon(evenodd,' + pts([[0, 0], [W, 0], [W, H], [0, H], [0, 0]]) + ',' + pts(box.concat([box[0]])) + ')';
    }

    let galVeilEl = null;
    // The page goes dark the moment the picture flies, before any cell has loaded; the set's own shade takes over.
    function galVeil(on) {
        if (!on) { if (galVeilEl) galVeilEl.classList.remove('on'); return; }
        galLayer();
        if (!galHost.isConnected) document.documentElement.appendChild(galHost);
        galVeilEl.style.clipPath = galBlur.style.clipPath = galClip(galHole);
        void galVeilEl.offsetWidth;
        galVeilEl.classList.add('on');
        galBlur.classList.add('on');
    }

    // Lay the set out around one hole; returns the slots.
    function galLayout(set, hole) {
        galLaidAt = performance.now();
        const R = galRows(set.asp, galBars(hole), set.page || 0), L = R.out;
        set.pages = R.pages;
        set.page = R.page;
        set.open = hole;
        galShade(set, hole);
        set.cells.forEach(function (cell, k) {
            const r = L[k];
            if (!r) { cell.style.display = 'none'; return; }
            cell.style.display = '';
            cell.style.width = r.w + 'px';
            cell.style.height = r.h + 'px';
            cell.style.transform = 'translate(' + r.x + 'px,' + r.y + 'px)';
        });
        set.rows = galRowLines(L);
        galPageNote(set);
        galGrowPace(set);
        return L;
    }

    // Reading on keeps one page ahead of the page on screen: it waits once that page is full.
    function galGrowPace(set) {
        if (!galGrowHold || galGrowing !== set.href) return;
        const P = set.pages || [], per = P.length > 1 ? P[0][1] - P[0][0] : 0;
        galGrowHold(!!per && set.cells.length >= (set.page + 2) * per);
    }

    // What the rows keep clear of: the clicked picture with its attached strip, and a strip of its own.
    function galBars(hole) {
        if (!galFly) return [hole, galStripRect(hole)];
        return galStripM.m === 'out' && galStripM.r ? [hole, galStripM.r] : [hole];
    }

    // Where the rows on screen start and end, and the middle of each gap between them: what a resize of the clicked picture snaps to.
    function galRowLines(L) {
        const rows = new Map();
        L.forEach(function (r) { if (r) rows.set(Math.round(r.y), Math.round(r.y + r.h)); });
        const tops = Array.from(rows.keys()).sort(function (a, b) { return a - b; }), out = [];
        tops.forEach(function (t, i) {
            out.push(t, rows.get(t));
            if (i + 1 < tops.length) out.push(Math.round((rows.get(t) + tops[i + 1]) / 2));
        });
        return out;
    }

    // The smallest row height the user allows.
    function galMinH() {
        return Math.max(48, +cfg.galleryRowMin || GAL_MIN_H);
    }

    // A paged gallery's rows in a window H tall: as many as fit at the minimum, grown to fill the height.
    function galPagedH(H) {
        const G = GAL_GAP, m = Math.min(galMinH(), H - 2 * G), n = Math.max(1, Math.floor((H - G) / (m + G)));
        return { n: n, h: Math.max(m, Math.floor((H - G) / n - G)) };
    }

    // The row lines of a paged gallery in a window H tall: they depend on nothing else.
    function galPagedRows(H) {
        const G = GAL_GAP, P = galPagedH(H), h = P.h, n = P.n;
        const pitch = n > 1 ? (H - 2 * G - h) / (n - 1) : 0, L = [];
        for (let k = 0; k < n; k++) L.push({ y: G + k * pitch, h: h });
        return galRowLines(L);
    }

    // The lines an edge snaps to and is remembered by, on one axis: the window's edges, the gallery's margin, the centre; on y the row lines too, counted from the nearer end.
    function galLines(V, rows) {
        const G = GAL_GAP, out = [{ v: 0, a: { k: 'w', e: 's', o: 0 } }, { v: G, a: { k: 'w', e: 's', o: G } }, { v: V / 2, a: { k: 'c' } },
            { v: V - G, a: { k: 'w', e: 'e', o: G } }, { v: V, a: { k: 'w', e: 'e', o: 0 } }];
        (rows || []).forEach(function (y, i) {
            out.push({ v: y, a: y < V / 2 ? { k: 'r', e: 's', i: i } : { k: 'r', e: 'e', i: rows.length - 1 - i } });
        });
        return out;
    }

    // The line an edge sits on, kept so it survives a resize; null when on none.
    function galEdgeOn(v, lines) {
        const l = lines.find(function (x) { return Math.abs(x.v - v) < 0.75; });
        return l ? l.a : null;
    }

    // Where a remembered edge's line is now; null when that line is gone.
    function galEdgeAt(a, V, rows) {
        if (!a) return null;
        if (a.k === 'c') return V / 2;
        if (a.k === 'w') return a.e === 's' ? +a.o || 0 : V - (+a.o || 0);
        if (a.k !== 'r' || !rows) return null;
        const i = a.e === 's' ? a.i : rows.length - 1 - a.i;
        return i >= 0 && i < rows.length ? rows[i] : null;
    }

    // A remembered box placed in a W×H window: an edge on a line follows it; both edges of an axis on lines give the size (y first). asp: the picture's; sh: an attached strip's height; fixed: a box whose size never changes.
    function galPlace(rec, asp, sh, W, H, rows, fixed) {
        const ey = rec.ey || {}, ex = rec.ex || {};
        const t = galEdgeAt(ey.t, H, rows), b = galEdgeAt(ey.b, H, rows), l = galEdgeAt(ex.l, W), r = galEdgeAt(ex.r, W);
        let w, h;
        if (fixed) { w = fixed.w; h = fixed.h; } else {
            let ph, both = true;
            if (t !== null && b !== null && b - t - sh >= 48) ph = b - t - sh;
            else if (l !== null && r !== null && r - l >= 48) ph = (r - l) / asp;
            else { ph = H * Math.max(0.05, Math.min(0.9, +rec.hf || GAL_FLY_FRAC)) + (sh ? GAL_STRIP_H - sh : 0); both = false; }
            w = ph * asp;
            const maxW = both ? W - 8 : W * 0.4;
            if (w > maxW) { w = maxW; ph = w / asp; }
            if (ph + sh > H) { ph = H - sh; w = ph * asp; }
            h = ph + sh;
        }
        const x = l !== null ? l : r !== null ? r - w : posAxis(rec.x, w, W);
        const y = t !== null ? t : b !== null ? b - h : posAxis(rec.y, h, H);
        return { x: Math.round(Math.max(0, Math.min(W - w, x))), y: Math.round(Math.max(0, Math.min(H - h, y))), w: Math.round(w), h: Math.round(h) };
    }

    // A box's edges as remembered lines.
    function galEdges(u, W, H, rows) {
        const lx = galLines(W), ly = galLines(H, rows);
        return { ex: { l: galEdgeOn(u.x, lx), r: galEdgeOn(u.x + u.w, lx) }, ey: { t: galEdgeOn(u.y, ly), b: galEdgeOn(u.y + u.h, ly) } };
    }

    // A dragged box pulled onto the nearest line within reach, per axis: its edges onto any line, its middle onto the centre.
    function galBoxSnap(l, t, w, h, W, H, rows) {
        const one = function (v, len, lines, V) {
            let best = v, d = POS_SNAP_EDGE + 0.01;
            lines.forEach(function (x) {
                [[x.v, 0], [x.v - len, 0]].forEach(function (c) { if (Math.abs(v - c[0]) < d) { d = Math.abs(v - c[0]); best = c[0]; } });
            });
            if (Math.abs(v + len / 2 - V / 2) <= POS_SNAP_CENTRE && Math.abs(v + len / 2 - V / 2) < d) best = V / 2 - len / 2;
            return best;
        };
        return { x: one(l, w, galLines(W), W), y: one(t, h, galLines(H, rows), H) };
    }

    // The strip's box when there is no clicked picture to hold it: under the hole, else over it.
    function galStripRect(h) {
        const W = vpW(), H = vpH(), w = Math.min(W - 2 * GAL_GAP, Math.max(GAL_STRIP_W, h.w));
        const x = Math.max(GAL_GAP, Math.min(W - GAL_GAP - w, h.x + h.w / 2 - w / 2));
        const sh = galStripH(), below = h.y + h.h + GAL_STRIP_GAP + sh <= H - 4;
        return { x: x, y: below ? h.y + h.h + GAL_STRIP_GAP : Math.max(4, h.y - GAL_STRIP_GAP - sh), w: w, h: sh };
    }

    // The strip: inside the clicked picture's frame ('in'), against its top or bottom with a frame of its own ('dock'), or anywhere ('out').
    function galStripPlace() {
        galHdPlace();
        const s = galSt;
        if (!s) return;
        const f = galFly, m = galStripM;
        s.el.hidden = !galOn;
        s.el.classList.toggle('edit', !!galEdit);
        s.el.classList.toggle('one', galStripOne);
        s.el.style.height = galStripH() + 'px';
        const inside = !!f && m.m === 'in';
        s.el.classList.toggle('in', inside);
        s.el.classList.toggle('own', !!f && !inside);
        if (f) f.el.classList.toggle('joined', inside);
        if (inside) {
            if (m.side === 't') { if (f.el.firstChild !== s.el) f.el.insertBefore(s.el, f.el.firstChild); }
            else if (f.pic0.nextSibling !== s.el) f.el.insertBefore(s.el, f.pic0.nextSibling);
            s.el.classList.remove('out');
            s.el.style.left = s.el.style.top = s.el.style.width = '';
            galStripFit();
            return;
        }
        if (s.el.parentNode !== galTop) galTopRoot().appendChild(s.el);
        const r = !f ? galStripRect(galHole || { x: 0, y: 0, w: 0, h: 0 }) : m.m === 'dock' ? galDockRect(galFlyRect(), m.side) : m.r;
        const free = !!f && m.m === 'out' && !(r && r.d);
        s.el.classList.toggle('out', free);
        s.el.style.width = free || !r ? '' : Math.round(r.w) + 'px';
        galStripFit();
        if (!r) return;
        if (free) {         // as wide as its text; the side nearer the window's edge stays put
            const w = s.el.offsetWidth;
            if (r.w && r.x + r.w / 2 > vpW() / 2) r.x += r.w - w;
            r.x = Math.max(0, Math.min(vpW() - w, r.x));
            r.w = w;
            r.h = s.el.offsetHeight;
        }
        s.el.style.left = Math.round(r.x) + 'px'; s.el.style.top = Math.round(r.y) + 'px';
    }

    function galStripFit() {
        if (galCur) galStripText(galCur);
    }

    // The strip's height: the page row shows only once there is more than one page.
    function galStripH() {
        return galStripOne ? GAL_STRIP_H1 : GAL_STRIP_H;
    }

    // A second page appeared: the page row joins the strip for good, and an attached strip keeps the unit's height, so the picture narrows.
    function galStripRows(set) {
        const one = !set.two && (set.pages ? set.pages.length : 1) <= 1;
        if (!one) set.two = true;
        if (one === galStripOne || galEdit) return;
        const u0 = galAttH() ? galUnitRect() : null;
        galStripOne = one;
        if (!u0) { galStripPlace(); return; }
        const W = vpW(), ph = Math.max(48, u0.h - galStripH()), w = Math.min(W - 8, ph * galFly.asp);
        const x = u0.x + u0.w / 2 > W / 2 ? u0.x + u0.w - w : u0.x;
        galHole = { x: Math.max(0, Math.min(W - w, x)), y: u0.y, w: w, h: u0.h };
        galUnitPut(galHole);
        setTimeout(function () { if (galCur === set && !galEdit) galPageWork(set, galLayout(set, galHole)); }, 0);
    }

    // The corners that resize the clicked picture: invisible, at the unit's corners.
    function galHdPlace() {
        const f = galFly;
        if (!f || !f.hds) return;
        const u = galUnitRect(), k = GAL_HD, o = 2;
        f.hds.forEach(function (hd) {
            const c = hd.__hzCorner;
            hd.style.left = Math.round(c[1] === 'l' ? u.x - o : u.x + u.w - k + o) + 'px';
            hd.style.top = Math.round(c[0] === 't' ? u.y - o : u.y + u.h - k + o) + 'px';
        });
    }

    // The strip's box against the picture's top or bottom, as wide as it.
    function galDockRect(p, side) {
        const sh = galStripH();
        return { x: p.x, y: side === 't' ? p.y - sh : p.y + p.h, w: p.w, h: sh };
    }

    // The clicked picture's box with an attached strip (inside its frame or docked against it): what the rows keep clear of.
    function galUnitRect() {
        const p = galFlyRect(), sh = galStripH();
        if (galStripM.m !== 'dock') return p;
        return { x: p.x, y: galStripM.side === 't' ? p.y - sh : p.y, w: p.w, h: p.h + sh };
    }

    // The attached strip's height, which the picture's box includes.
    function galAttH() {
        return galFly && (galStripM.m === 'in' || galStripM.m === 'dock') ? galStripH() : 0;
    }

    function galFlyRect() {
        const el = galFly.el;
        return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
    }

    // The clicked picture and its attached strip put in one box.
    function galUnitPut(u) {
        const f = galFly;
        if (!f) return;
        const sh = galStripM.m === 'dock' ? galStripH() : 0;
        galFlyPut(f.el, u.x, galStripM.side === 't' ? u.y + sh : u.y, u.w, u.h - sh);
        galStripPlace();
    }

    // The strip's page and picture: ◀ Page n / N ▶, then ◀ picture n / N ▶.
    function galPageNote(set) {
        if (!set) return;
        galStripBuild();
        galStripPlace();
        galStripText(set);
    }

    function galStripText(set) {
        const s = galSt;
        if (!s || !set) return;
        const reading = galGrowing === set.href, n = set.cells.length;
        galStripRows(set);
        const total = set.pages ? set.pages.length : 1, page = set.page || 0, at = set.at >= 0 && set.at < n ? set.at : -1;
        const pg = (page + 1) + ' / ' + total + (reading ? '+' : '');
        s.pgT.textContent = 'Page ' + pg;
        s.picT.textContent = (at >= 0 ? at + 1 : '–') + ' / ' + n + (reading ? '+' : '');
        galStripSqueeze(s, pg);
        setTip(s.pgT, reading ? 'Finding more pictures on the gallery\'s page…' : total + ' page' + (total === 1 ? '' : 's') + ' · PageUp / PageDown');
        setTip(s.picT, n + ' picture' + (n === 1 ? '' : 's') + (reading ? ', finding more' : '') + ' · mouse wheel or ← → steps through them');
        s.pgP.classList.toggle('faint', page <= 0);
        s.pgN.classList.toggle('faint', page >= total - 1);
        s.picP.classList.toggle('faint', !n);
        s.picN.classList.toggle('faint', !n);
    }

    // Numbers that do not fit: "Page" goes first, then the type shrinks.
    function galStripSqueeze(s, pg) {
        [s.pgT, s.picT].forEach(function (t) { t.style.fontSize = ''; });
        if (s.el.hidden || s.el.classList.contains('out')) return;
        const over = function (t) { return t.scrollWidth > t.clientWidth + 0.5; };
        if (over(s.pgT)) s.pgT.textContent = pg;
        [s.pgT, s.picT].forEach(function (t) {
            let f = parseFloat(getComputedStyle(t).fontSize) || 12;
            while (over(t) && f > 8) { f -= 0.5; t.style.fontSize = f + 'px'; }
        });
    }

    // Before the gallery's pictures arrive.
    function galStripBlank() {
        const s = galSt;
        if (!s) return;
        s.pgT.textContent = 'Page … / …';
        s.picT.textContent = '– / …';
        ['pgP', 'pgN', 'picP', 'picN'].forEach(function (k) { s[k].classList.add('faint'); });
    }

    // One strip for every gallery, made once; dragged by its background, it comes off the picture.
    function galStripBuild() {
        if (galSt) return;
        galLayer();
        const el = document.createElement('div');
        el.className = 'strip';
        el.hidden = true;
        const s = { el: el };
        const row = function (cls, pk, tk, nk, prevTip, nextTip, act) {
            const r = document.createElement('div');
            r.className = 'r ' + cls;
            const btn = function (text, tip, dir) {
                const b = document.createElement('span');
                b.className = 'b';
                b.textContent = text;
                setTip(b, tip);
                b.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.button === 0 && !b.classList.contains('faint')) act(dir);
                });
                return b;
            };
            s[pk] = btn('◀', prevTip, -1);
            s[tk] = document.createElement('span');
            s[tk].className = 't';
            s[nk] = btn('▶', nextTip, 1);
            r.appendChild(s[pk]); r.appendChild(s[tk]); r.appendChild(s[nk]);
            el.appendChild(r);
        };
        row('pg', 'pgP', 'pgT', 'pgN', 'Previous page · PageUp', 'Next page · PageDown', galFlip);
        row('pn', 'picP', 'picT', 'picN', 'Previous picture · ← or wheel up', 'Next picture · → or wheel down', galStep);
        ['mousedown', 'mouseup', 'click', 'auxclick', 'dblclick', 'contextmenu'].forEach(function (t) {
            el.addEventListener(t, function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (t === 'mousedown' && !galEdit && e.button === 0) galStripDown(e);
                if (t === 'contextmenu' && !galEdit && galFly) galMenuShow(e.clientX, e.clientY);
            });
        });
        galSt = s;
        galTopRoot().appendChild(el);
    }

    // The page holding picture k.
    function galPageOf(set, k) {
        const i = (set.pages || []).findIndex(function (p) { return k >= p[0] && k < p[1]; });
        return i < 0 ? set.page || 0 : i;
    }

    // The gallery picture on screen in the preview, else -1.
    function galShownAt(set) {
        if (!active || !galOwns(active)) return -1;
        return set.pics.findIndex(function (p) { return p.img === active; });
    }

    let galStepTok = null;

    // One picture on (+1) or back (-1), its page following: from a pinned preview, else the last one stepped to on this page, else the page's first is shown (a hover moves nothing).
    function galStep(dir) {
        const set = galCur;
        if (!set || !set.pics.length) return false;
        const n = set.pics.length, p = (set.pages && set.pages[set.page]) || [0, n];
        let k = placed ? galShownAt(set) : -1;
        if (k < 0 && set.at >= p[0] && set.at < p[1]) k = set.at;
        k = k < 0 ? p[0] : (k + dir + n) % n;
        set.at = k;
        const pg = galPageOf(set, k);
        if (pg !== set.page) {
            if (galOwns(active) && !placed) cancel();
            set.page = pg;
            galPageWork(set, galLayout(set, set.open));
        } else galPageNote(set);
        galPin(set, set.pics[k].img);
        return true;
    }

    // A gallery picture's preview, pinned; the one up now stays until the new one is found, so a step never blinks.
    function galPin(set, img) {
        if (galStepTok) galStepTok.cancelled = true;
        const tok = galStepTok = { cancelled: false, fresh: true };
        if (!placed) { cancel(); showSpinner(); }
        galResolve(img, tok).then(function (hit) {
            if (galStepTok !== tok || galCur !== set) return;
            hideSpinner();
            if (!hit) return;
            if (placed) unplace(); else cancel();
            active = img;
            activeShown = img.__hzItem.thumb;
            hoverAt = Date.now();
            token = tok;
            showViewer(hit, pointer);
            place();
        });
    }

    // The cells of the page on screen, as their pics.
    function galPagePics(set) {
        const p = set.pages && set.pages[set.page];
        return p ? set.pics.slice(p[0], p[1]) : set.pics.slice();
    }

    // Work owed to the page on screen: bigger files for cells drawn large, and every cell's original.
    function galPageWork(set, L) {
        const p = set.pages[set.page] || [0, set.pics.length];
        for (let k = p[0]; k < p[1]; k++) {
            const pic = set.pics[k], r = L[k];
            if (pic && r && !pic.up && r.w > pic.nw * GAL_UPGRADE) { pic.up = true; galUpgrade(pic.item, pic.img, pic.nw, r.w); }
        }
        if (!set.pv) return;
        if (set.hqTok) set.hqTok.cancelled = true;
        galHqAll(set, galPagePics(set).map(function (q) { return q.img; }));
    }

    // One page on (+1) or back (-1). False at either end.
    function galFlip(dir) {
        const set = galCur;
        if (!set || !set.pages || set.pages.length < 2) return false;
        const to = Math.min(Math.max(0, set.page + dir), set.pages.length - 1);
        if (to === set.page) return false;
        if (galOwns(active) && !placed) cancel();
        set.page = to;
        galPageWork(set, galLayout(set, set.open));
        return true;
    }

    let galFlipAt = 0, galWheelSum = 0, galWheelAt = 0;

    // The wheel steps an open gallery's pictures and never scrolls the page; over a pinned preview it zooms that instead.
    function galWheel(e) {
        const set = galCur;
        if (!set) return;
        if (e.ctrlKey) return;      // the preview's zoom over a pinned one (onPinWheel), else the browser's own zoom

        if (panelOwns(e)) return;
        if (placed && view && pointInPreview(e.clientX, e.clientY)) return;     // zooms it (onPinWheel)
        e.preventDefault();
        e.stopImmediatePropagation();
        const now = performance.now();
        if (now - galWheelAt > 300) galWheelSum = 0;
        galWheelAt = now;
        galWheelSum += e.deltaMode ? e.deltaY * 40 : e.deltaY;
        if (Math.abs(galWheelSum) < 60 || now - galFlipAt < GAL_FLIP_MS) return;
        galStep(galWheelSum > 0 ? 1 : -1);
        galFlipAt = now;
        galWheelSum = 0;
    }

    // Every visible linked picture on the page, as rects.
    function galPics() {
        const out = [];
        document.querySelectorAll('a[href] img').forEach(function (img) {
            const r = img.getBoundingClientRect();
            if (r.width < 24 || r.height < 24 || r.bottom <= 0 || r.right <= 0 || r.top >= vpH() || r.left >= vpW()) return;
            out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
        });
        return out;
    }

    // Bigger files for one thumbnail, the next size up first: srcset widths ascending, else the resolver's list.
    function galBigger(item, nw, need) {
        const ss = [];
        (item.ss || []).forEach(function (v) {
            const re = /(\S+)\s+(\d+)w\b/g;
            let m;
            while ((m = re.exec(v))) ss.push({ url: m[1].replace(/^,/, ''), weight: +m[2] });
        });
        const abs = function (v) { try { return new URL(v, item.base).href; } catch (e) { return ''; } };
        const wide = ss.filter(function (c) { return c.weight > nw; })
            .sort(function (a, b) { return a.weight - b.weight; });
        let out;
        if (wide.length) {
            const i = wide.findIndex(function (c) { return c.weight >= need; });
            out = i < 0 ? wide.slice().reverse() : wide.slice(i).concat(wide.slice(0, i).reverse());
            out = out.map(function (c) { return abs(c.url); });
        } else {
            out = (item.cands || []).slice();
        }
        return out.filter(function (u, i) { return u && u !== item.thumb && out.indexOf(u) === i; }).slice(0, GAL_TRIES);
    }

    // Load one thumbnail; resolves {img, item, asp} once it has a size, or null.
    function galImg(item) {
        return new Promise(function (resolve) {
            const img = document.createElement('img');
            img.decoding = 'async';
            if (noReferrerHere()) img.referrerPolicy = 'no-referrer';
            img.onload = function () {
                img.onload = img.onerror = null;
                const nw = img.naturalWidth, nh = img.naturalHeight;
                resolve(nw && nh ? { img: img, item: item, nw: nw, asp: nw / nh } : null);
            };
            img.onerror = function () { img.onload = img.onerror = null; resolve(null); };
            img.src = item.thumb;
        });
    }

    // Swap in the first bigger file that loads; the drawn size stays put.
    function galUpgrade(item, img, nw, need) {
        const tries = galBigger(item, nw, need);
        (function next(i) {
            if (i >= tries.length || !img.isConnected) return;
            const p = new Image();
            if (noReferrerHere()) p.referrerPolicy = 'no-referrer';
            p.onload = function () {
                if (p.naturalWidth > nw && img.isConnected) img.src = p.src;
                else next(i + 1);
            };
            p.onerror = function () { next(i + 1); };
            p.src = tries[i];
        })(0);
    }

    // Measure every thumbnail first, then lay the set out once and fade it in.
    function galShow(href, list) {
        if (galWant !== href) { galTrace(href, 'show: skipped, another link is wanted now'); return; }
        if (galCur && galCur.href === href) { galTrace(href, 'show: already on screen'); galPendClear(); return; }
        if (list === 'cancel') { galHide('fail: the load was cancelled'); return; }
        if (!list || !list.length) {
            dbg('gallery: no pictures on the linked page', { href: href });
            galHide('fail: no pictures found on the linked page');
            return;
        }
        let timer = 0, failed = 0;
        const got = [], t0 = performance.now();
        galTrace(href, 'thumbnails: loading ' + list.length + ' (' + galHostMix(list.map(function (it) { return it.thumb; })) + ')');
        const all = Promise.all(list.map(function (item, i) {
            return galImg(item).then(function (v) { got[i] = v; if (!v) failed++; return v; });
        }));
        const cap = new Promise(function (r) { timer = setTimeout(r, GAL_WAIT_MS, null); });
        Promise.race([all, cap]).then(function (v) {
            clearTimeout(timer);
            const pics = (v || got).filter(Boolean);
            galTrace(href, 'thumbnails: ' + pics.length + ' loaded, ' + failed + ' failed, ' +
                (list.length - pics.length - failed) + ' still loading after ' + Math.round(performance.now() - t0) + ' ms');
            if (galWant !== href || (galCur && galCur.href === href)) return;
            if (!pics.length) { galLate(href, list, all, got, t0); return; }
            galBuild(href, pics);
            if (pics.length < list.length) galRest(href, list, all, got, t0, pics.length);
        });
    }

    // Some shown, the rest not yet: wait for them (GAL_REST_MS), try the failed ones once more, then redraw with every one that came.
    function galRest(href, list, all, got, t0, shown) {
        const set = galCur;
        let t = 0;
        Promise.race([all, new Promise(function (r) { t = setTimeout(r, GAL_REST_MS, null); })]).then(function (v) {
            clearTimeout(t);
            const have = list.map(function (it, i) { return (v || got)[i] || null; });
            const bad = [], hung = [];
            have.forEach(function (p, i) { if (!p) (v || got[i] === null ? bad : hung).push(i); });
            galTrace(href, 'thumbnails after ' + Math.round(performance.now() - t0) + ' ms: ' + (list.length - bad.length - hung.length) +
                ' loaded, ' + bad.length + ' failed, ' + hung.length + ' still loading');
            const retry = bad.length ? new Promise(function (r) { setTimeout(r, GAL_RETRY_GAP_MS); }).then(function () {
                usLog.enable(cfg.logRequests !== false);
                const lg = usLog.start('gthumbs', { host: pageHost(), pace: version().replace(/\?/g, '') + ' retry once', slowed: noRush(pageHost()) });
                return Promise.all(bad.map(function (i) {
                    const r = lg && lg.req();
                    return galImg(list[i]).then(function (p) { if (r) r.done({ status: p ? 200 : 0 }); if (p) have[i] = p; });
                })).then(function () { if (lg) lg.end('done'); });
            }) : Promise.resolve();
            retry.then(function () {
                const pics = have.filter(Boolean), missing = list.length - pics.length;
                if (bad.length) galTrace(href, 'retry: ' + (list.length - missing - (list.length - bad.length - hung.length)) + ' of ' + bad.length + ' failed ones loaded');
                if (galCur !== set || galWant !== href) return;
                if (pics.length > shown && set.cells.length < pics.length) galBuild(href, pics);
                if (missing) galShortNote(href, pics.length, list.length, hung.length, missing - hung.length);
            });
        });
    }

    // Shown in the gallery only when, after waiting and one retry, some pictures still could not be drawn.
    function galShortNote(href, shown, total, hung, failed) {
        const set = galCur;
        if (!set || set.href !== href) return;
        const el = document.createElement('div');
        el.className = 'short';
        el.textContent = 'Showing ' + shown + ' of ' + total + ' pictures' + (failed ? ' · ' + failed + ' would not load' : '') +
            (hung ? ' · ' + hung + ' still loading after ' + GAL_REST_MS / 1000 + ' s' : '');
        set.el.appendChild(el);
        dbg('gallery short', { href: href, total: total, shown: shown, failed: failed, hung: hung });
    }

    // Not one thumbnail in GAL_WAIT_MS: wait GAL_LATE_MS more (the diagnostics then say whether they ever came), show them if they do.
    function galLate(href, list, all, got, t0) {
        galTrace(href, 'originals fetching: ' + galHqText());
        let t = 0;
        Promise.race([all, new Promise(function (r) { t = setTimeout(r, GAL_LATE_MS, null); })]).then(function (v) {
            clearTimeout(t);
            const pics = (v || got).filter(Boolean), ms = Math.round(performance.now() - t0);
            galTrace(href, 'thumbnails after ' + ms + ' ms: ' + pics.length + ' loaded, ' +
                (v ? (v.length - pics.length) + ' failed, all settled' : 'the rest still loading') + '; originals fetching: ' + galHqText());
            if (galWant !== href || (galCur && galCur.href === href)) return;
            if (!pics.length) { galHide('fail: no thumbnail loaded within ' + ms + ' ms'); return; }
            galBuild(href, pics);
            if (pics.length < list.length) galRest(href, list, all, got, t0, pics.length);
        });
    }

    // One thumbnail's cell, appended to the set.
    function galCell(set, p, saved) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        p.img.classList.add('ok');
        p.img.__hzItem = p.item;
        cell.appendChild(p.img);
        if (cfg.gallerySavedMarks && saved.has(p.item.thumb)) cell.appendChild(galSavedIcon('svd'));
        const enter = function () { if (set.pv) galPv(p.img); else galNoPv(set); };
        cell.addEventListener('mouseenter', function () {
            if (galMovedAt < galLaidAt) { galStill = { set: set, cell: cell, go: enter }; return; }     // the cells moved under a still pointer: not a hover
            enter();
        });
        cell.addEventListener('mouseleave', function () { if (!placed && active === p.img) cancel(); });
        if (p.item.link) {
            cell.classList.add('go');
            cell.addEventListener('click', function (e) {     // as on its own page: the picture's link
                if (e.button !== 0 || (view && box && box.classList.contains('on'))) return;
                e.preventDefault();
                location.assign(p.item.link);
            });
        }
        set.cells.push(cell);
        set.asp.push(p.asp);
        set.pics.push(p);
        set.el.appendChild(cell);
    }

    function galBuild(href, pics) {
        const root = galLayer();
        if (!galHost.isConnected) document.documentElement.appendChild(galHost);
        const page = galCur && galCur.href === href ? galCur.page : 0;
        if (galCur) galDrop(galCur);
        const set = { href: href, el: document.createElement('div'), shade: document.createElement('div'),
            cells: [], asp: [], pics: [], page: page };
        set.el.className = 'set';
        set.shade.className = 'shade';
        ['mousedown', 'mouseup', 'click', 'auxclick', 'dblclick'].forEach(function (t) {
            set.shade.addEventListener(t, function (e) { e.preventDefault(); e.stopPropagation(); });   // between pictures: nothing under it is reached
        });
        set.el.appendChild(set.shade);
        const saved = galList(GAL_SAVED_KEY);
        galLinksPick(pics.map(function (p) { return p.item; }));
        pics.forEach(function (p) { galCell(set, p, saved); });
        set.pv = siteEnabledAt(href);       // the linked page previews: so do its thumbnails
        const L = galLayout(set, galHole);
        set.el.classList.add('live');
        root.appendChild(set.el);
        void set.el.offsetWidth;
        set.el.classList.add('on');
        galBlur.classList.add('on');
        galCur = set;
        if (!twGalOpen) { twGalOpen = true; twRefresh(); }
        setTimeout(function () { if (galCur === set) galVeil(false); }, GAL_FADE_MS);
        galTrace(href, 'shown: ' + pics.length + ' thumbnails');
        galPendClear();
        setTimeout(function () {
            if (galCur !== set) { dbg('gallery not counted as seen: ' + (galCur ? 'replaced' : 'hidden') + ' within ' + GAL_SEEN_MS + ' ms', { href: href }); return; }
            galListAdd(GAL_SEEN_KEY, href);
            galSeen[GAL_SEEN_KEY] = null;
            dbg('gallery seen', { href: href, readBack: galList(GAL_SEEN_KEY).has(href) });
            galMarkAll();
        }, GAL_SEEN_MS);
        galPageWork(set, L);
        galCatchUp(set);
        galGrow(href);
    }

    // Pictures of this gallery already known but not in the set (read after it was built): add them.
    function galCatchUp(set) {
        const base = galLists.get(set.href);
        if (!base) return;
        const keys = galKeys(set.pics.map(function (p) { return p.item; }));
        const add = base.filter(function (it) { return !galKeyHit(keys, it); });
        if (add.length) galAppend(set, add);
    }

    // The URL paths an item is known by: its thumbnail and every srcset entry.
    function galItemKeys(it) {
        const out = [];
        const path = function (u) { try { const x = new URL(u, it.base); return x.host + x.pathname; } catch (e) { return ''; } };
        out.push(path(it.thumb));
        (it.ss || []).forEach(function (v) { parseSrcset(v).forEach(function (u) { out.push(path(u)); }); });
        return out.filter(Boolean);
    }

    function galKeys(items) {
        const s = new Set();
        items.forEach(function (it) { galItemKeys(it).forEach(function (k) { s.add(k); }); });
        return s;
    }

    function galKeyHit(keys, it) {
        return galItemKeys(it).some(function (k) { return keys.has(k); });
    }

    // New pictures for an open set: their thumbnails load (up to GAL_WAIT_MS), then one relayout on the same page.
    function galAppend(set, items) {
        let pending = [], timer = 0;
        const flush = function () {
            timer = 0;
            if (galCur !== set) return;
            const batch = pending.sort(function (a, b) { return a.k - b.k; });
            pending = [];
            const saved = galList(GAL_SAVED_KEY), keys = galKeys(set.pics.map(function (p) { return p.item; }));
            const before = set.pages && set.pages[set.page] ? set.pages[set.page].join('-') : '';
            let n = 0;
            galLinksPick(set.pics.map(function (p) { return p.item; }).concat(batch.map(function (b) { return b.p.item; })));
            batch.forEach(function (b) { if (!galKeyHit(keys, b.p.item)) { galCell(set, b.p, saved); n++; } });
            if (!n) return;
            galTrace(set.href, 'appended ' + n + ' (' + set.cells.length + ' in all)');
            const L = galLayout(set, set.open);
            if (set.pages[set.page].join('-') !== before) galPageWork(set, L);
        };
        items.forEach(function (it, k) {
            galImg(it).then(function (p) {
                if (!p || galCur !== set) return;
                pending.push({ p: p, k: k });
                if (!timer) timer = setTimeout(flush, GAL_APPEND_MS);
            });
        });
    }

    // While a gallery is open its page is read on in a frame that scrolls it, so pictures it mounts late join the set.
    function galGrow(href) {
        if (galGrowing === href || galGrown.has(href)) return;
        galGrowing = href;
        galTrace(href, 'reading on: start');
        if (galCur && galCur.href === href) galPageNote(galCur);
        galRender(href, function (items) { galMore(href, items); }, function (why) {
            if (galGrowing === href) galGrowing = null;
            if (why === 'grown') galGrown.add(href);
            galTrace(href, 'reading on: ' + why);
            if (galCur && galCur.href === href) galPageNote(galCur);
        }).then(function (v) { if (Array.isArray(v)) galMore(href, v); });
    }

    // The reading frame's pictures: those not known yet join the stored list and, if it is open, the set.
    function galMore(href, items) {
        const base = galLists.get(href);
        if (!base) return;
        const keys = galKeys(base), add = [];
        items.forEach(function (it) {
            if (!it || !it.thumb || blocked(it.thumb) || galKeyHit(keys, it)) return;
            galItemKeys(it).forEach(function (k) { keys.add(k); });
            add.push(it);
        });
        if (!add.length) return;
        add.forEach(function (it) { base.push(it); });
        galTrace(href, 'reading on: +' + add.length + ' (' + base.length + ' known)');
        if (galCur && galCur.href === href) galAppend(galCur, add);
    }

    const galHqLive = new Set();         // originals being fetched now, for the open diagnostics
    function galHqText() {
        if (!galHqLive.size) return 'none';
        let old = Infinity, closed = 0;
        galHqLive.forEach(function (l) { old = Math.min(old, l.t); if (l.mine.cancelled) closed++; });
        return galHqLive.size + ' (' + closed + ' for a closed gallery), oldest ' + Math.round((performance.now() - old) / 100) / 10 + ' s';
    }

    // Every cell's original, GAL_HQ_PAR at a time, through the hover's own probe, so a hover finds it loaded.
    function galHqAll(set, imgs) {
        if (!imgs.length) return;
        usLog.enable(cfg.logRequests !== false);
        const lg = usLog.start('origs', { host: pageHost(), pace: version().replace(/\?/g, '') + ' ' + GAL_HQ_PAR + ' at once', slowed: noRush(pageHost()) });
        const tok = set.hqTok = { cancelled: false, fresh: false };
        let i = 0, running = 0, ended = false, got = 0;
        const end = function (why) {
            if (ended) return;
            ended = true;
            if (lg) lg.end(why);
            dbg('gallery originals: ' + why, { href: set.href, pictures: imgs.length, found: got });
        };
        const next = function () {
            if (tok.cancelled) { if (!running) end('cut'); return; }
            if (i >= imgs.length) { if (!running) end('done'); return; }
            while (running < GAL_HQ_PAR && i < imgs.length) {
                const img = imgs[i++], r = lg && lg.req(), live = { t: performance.now(), mine: tok };
                running++;
                galHqLive.add(live);
                galResolve(img, tok).then(function (hit) {
                    if (hit) got++;
                    if (r) r.done({ status: hit ? 200 : 0 });
                }, function () { if (r) r.done({ status: 0 }); }).then(function () { galHqLive.delete(live); running--; next(); });
            }
        };
        next();
    }

    function galDrop(set) {
        if (set.hqTok) set.hqTok.cancelled = true;
        set.el.classList.remove('on');
        setTimeout(function () { set.el.remove(); }, GAL_FADE_MS + 50);
    }

    function galHide(why) {
        galEditStop(false);
        galMenuHide();
        if (galPend) {
            const p = galPend;
            galTrace(p.href, 'hidden: ' + (why || 'pointer left'));
            galPendClear();
            if (GAL_USER_HIDE.indexOf(why) < 0) galDiag(p, why || 'hidden: pointer left');
        }
        clearTimeout(galHoverTimer);
        galWant = null;
        galOn = false;
        galPeek = false;
        if (galOwns(active)) cancel();
        if (galCur) { galDrop(galCur); galCur = null; }
        if (galGrowEnd) galGrowEnd('closed');
        if (galBlur) galBlur.classList.remove('on');
        galVeil(false);
        galFlyBack();
        if (galSt) galSt.el.hidden = true;
        galChipsSync();
        if (galStepTok) { galStepTok.cancelled = true; galStepTok = null; }
        if (twGalOpen) { twGalOpen = false; twRefresh(); }
    }

    function galOwns(el) {
        return !!el && !!galRoot && !!el.getRootNode && el.getRootNode() === galRoot;
    }

    // Would previews run on this page? The site list checked against a URL other than this page's.
    function siteEnabledAt(url) {
        const listed = cfg.siteList.some(function (entry) { return siteEntryMatches(entry, url); });
        return cfg.siteMode === 'whitelist' ? listed : !listed;
    }

    // A thumbnail whose page the site list turns off: say why, once per gallery.
    function galNoPv(set) {
        if (set.told) return;
        set.told = true;
        const hit = cfg.siteList.find(function (entry) { return siteEntryMatches(entry, set.href); });
        toast(cfg.siteMode === 'whitelist'
            ? 'No previews: this gallery\'s page is not in the site list (Enable only on listed sites)'
            : 'No previews: this gallery\'s page is turned off by the site list entry “' + hit + '”', 5000);
    }

    // Hovering a thumbnail: the ordinary preview of its best original, after the hover delay.
    function galPv(img) {
        if (placed || !img.__hzItem) return;
        cancel();
        active = img;
        activeShown = img.__hzItem.thumb;
        hoverAt = Date.now();
        const myToken = token = { cancelled: false, fresh: true };
        timer = setTimeout(async function () {
            if (myToken.cancelled || active !== img) return;
            showSpinner();
            const t1 = performance.now(), known = !!img.__hzItem.hit;
            const hit = await galResolve(img, myToken);
            if (myToken.cancelled || active !== img) return;
            hideSpinner();
            dbg('gallery preview found', { ms: Math.round(performance.now() - t1), remembered: known, size: hit ? hit.w + 'x' + hit.h : null });
            if (!hit) return;
            showViewer(hit, pointer);
        }, cfg.hoverDelay);
    }

    // A thumbnail's original: its page's candidates, then srcset widest first; the first larger than the thumbnail wins, else the thumbnail.
    async function galResolve(img, tok) {
        const item = img.__hzItem, nw = img.naturalWidth || 0;
        const abs = function (v) { try { return new URL(v, item.base).href; } catch (e) { return ''; } };
        let list = (item.cands || []).slice();
        (item.ss || []).forEach(function (v) { list = list.concat(parseSrcset(v).map(abs)); });
        list = list.filter(function (u, i) { return u && list.indexOf(u) === i && !blocked(u); });
        const hitOf = function (u, d) { return { url: u, w: d.w, h: d.h, video: !!d.video, duration: d.duration, display: d.display }; };
        if (item.hit) {             // found before: the misses ahead of it are not asked again
            const d = await probe(item.hit.url);
            if (d) return item.hit;
            item.hit = null;
        }
        const linked = await galLinkedHit(item, img, tok);
        if (linked) return (item.hit = linked);
        for (let i = 0; i < list.length; i++) {
            if (tok.cancelled) return null;
            const d = await probe(list[i], tok.fresh);
            if (d && d.w > nw) return (item.hit = hitOf(list[i], d));
        }
        const own = img.currentSrc || img.src;
        const d = own ? await probe(own) : null;
        return d ? hitOf(own, d) : null;
    }

    // The page a gallery picture links to: what it declares (same shape) or a copy of the same name, the biggest one larger than the thumbnail.
    async function galLinkedHit(item, img, tok) {
        let u;
        try { u = item.link ? new URL(item.link) : null; } catch (e) { u = null; }
        if (!u || u.origin !== location.origin || looksLikeImage(u.href) || isVideoUrl(u.href)) return null;
        const page = await linkedMedia(u);
        if (!page || tok.cancelled) return null;
        const nat = { w: img.naturalWidth || 0, h: img.naturalHeight || 0 };
        const tries = [];
        if (page.declared) tries.push({ url: page.declared.url, named: sameStem(page.declared.url, item.thumb) });
        page.body.forEach(function (x) { if (x !== item.thumb && sameStem(x, item.thumb)) tries.push({ url: x, named: true }); });
        let best = null;
        for (const t of tries.slice(0, LINKED_TRIES)) {
            if (tok.cancelled || blocked(t.url) || t.url === item.thumb) continue;
            const d = await probe(t.url, tok.fresh);
            if (!d || d.w <= nat.w || (!t.named && nat.w && !sameShape(nat, d))) continue;
            if (best && d.w * d.h <= best.w * best.h) continue;
            best = { url: t.url, w: d.w, h: d.h, video: !!d.video, duration: d.duration, display: d.display };
        }
        dbg('gallery preview: the picture\'s own page', { link: u.href, declared: page.declared && page.declared.url, hit: best && best.url });
        return best;
    }

    // A picture saved from the gallery: its thumbnail and the result it came from are marked.
    function galSaved(img, href) {
        if (!img || !img.__hzItem) return;
        galListAdd(GAL_SAVED_KEY, img.__hzItem.thumb);
        if (href) galListAdd(GAL_SAVEDFROM_KEY, href);
        const cell = img.parentNode;
        if (cell && cfg.gallerySavedMarks && !cell.querySelector('.svd')) cell.appendChild(galSavedIcon('svd'));
        galMarkAll();
    }

    // The saved mark: a blue disc with a down arrow, no outline (user).
    function galSavedIcon(cls) {
        const NS = 'http://www.w3.org/2000/svg';
        const m = document.createElement('span');
        if (cls) m.className = cls;
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '10.5');
        c.setAttribute('fill', '#89b4fa');
        svg.appendChild(c);
        const a = document.createElementNS(NS, 'path');
        a.setAttribute('d', 'M12 6.5v8M8.2 11l3.8 3.8 3.8-3.8M7.5 17.5h9');
        a.setAttribute('fill', 'none'); a.setAttribute('stroke', '#11111b'); a.setAttribute('stroke-width', '2.2');
        a.setAttribute('stroke-linecap', 'round'); a.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(a);
        m.appendChild(svg);
        return m;
    }

    // The result's visible box: clipped like a mark's, since a site may scale the picture under the pointer (nsfw.xxx 1.1×).
    function galHoleRect(el) {
        return galMarkRect(el, el.closest('picture') || el);
    }

    // A peek at a door's gallery, locked; on the open one, closed; on another, switched.
    function galMiddle(t, href) {
        if (galOn && (galWant === href || (galCur && galCur.href === href))) { galHide('middle'); return; }
        const a = t.closest('a[href]'), pic = t.tagName === 'IMG' ? t : a && a.querySelector('img');
        const hr = galHoleRect(pic || t);
        if (galOwns(active)) cancel();
        galOn = true;
        galStripOne = true;
        galStripM = pic ? galStripLoad(galAnchorRec(), galPagedRows(vpH())) : { m: 'in', side: 'b' };
        galHole = galCornerRect(hr.width && hr.height ? hr.width / hr.height : 1, pic && galStripM.m !== 'out' ? galStripH() : 0);
        galWant = href;
        clearTimeout(galHoverTimer);
        galFlyBack();
        if (pic) galFlyOut(pic, hr, href);
        galVeil(true);
        galPendStart(href, 'middle press');
        galChipsSync();
        galLoad(href).then(function (list) {
            galShow(href, list);
            if (galFly && galFly.href === href && Array.isArray(list)) galFlyUpgrade(galFly, list);
        });
    }

    // Where the clicked picture waits while its gallery is open, with sh px of attached strip: its remembered place, else bottom-right, a fifth of the window tall; its own shape (user).
    function galCornerRect(asp, sh) {
        return galPlace(galAnchorRec(), asp || 1, sh, vpW(), vpH(), galAnchorRows(vpH()));
    }

    // The row lines a place is remembered against: a one-page gallery's own, else the paged grid's, which only the window's height decides.
    function galAnchorRows(H) {
        const set = galCur;
        return set && set.pages && set.pages.length === 1 && set.rows && set.rows.length ? set.rows : galPagedRows(H);
    }

    // The strip's remembered place: in the frame (the default), docked, or out with its own place.
    function galStripLoad(rec, rows) {
        const s = rec.strip || {};
        if (s.m === 'out') return { m: 'out', side: 'b', r: galPlace(s, 1, 0, vpW(), vpH(), rows, { w: GAL_STRIP_W, h: galStripH() }) };
        return { m: s.m === 'dock' ? 'dock' : 'in', side: s.side === 't' ? 't' : 'b' };
    }

    function galStripRec(rows) {
        const m = galStripM;
        if (m.m !== 'out' || !m.r) return { m: m.m === 'dock' ? 'dock' : 'in', side: m.side };
        const r = m.r, W = vpW(), H = vpH();
        return Object.assign({ m: 'out', x: galAnchorAx(r.x, r.w, W), y: galAnchorAx(r.y, r.h, H) }, galEdges(r, W, H, rows));
    }

    const GAL_ANCHOR_KEY = 'hoverZoomGalleryAnchor';     // {last, sites: {host: {x, y, hf}}}: where the clicked picture waits
    function galAnchorDefault() { return { x: { m: 'e', o: -GAL_GAP }, y: { m: 'e', o: -GAL_GAP }, hf: GAL_FLY_FRAC }; }

    function galAnchorStore() {
        let st = null;
        try { st = JSON.parse(GM_getValue(GAL_ANCHOR_KEY, '') || 'null'); } catch (e) { /* unreadable: start again */ }
        if (!st || typeof st !== 'object') st = {};
        if (!st.sites || typeof st.sites !== 'object') st.sites = {};
        return st;
    }

    // This site's place. A site first seen takes the newest saved place and keeps it, so a later save elsewhere never moves it (user).
    function galAnchorRec() {
        const st = galAnchorStore(), host = pageHost();
        if (st.sites[host]) return st.sites[host];
        st.sites[host] = st.last || galAnchorDefault();
        try { GM_setValue(GAL_ANCHOR_KEY, JSON.stringify(st)); } catch (e) { /* this page only */ }
        return st.sites[host];
    }

    // A saved place: this site's, and the one new sites start from.
    function galAnchorSave(rec) {
        const st = galAnchorStore();
        st.sites[pageHost()] = rec;
        st.last = rec;
        try { GM_setValue(GAL_ANCHOR_KEY, JSON.stringify(st)); } catch (e) { /* this page only */ }
        dbg('gallery picture place saved', { host: pageHost(), rec: JSON.stringify(rec) });
    }

    // A box's place per axis, as the preview remembers its own: flush with an edge or the centre anchors there, else the nearest third.
    function galAnchorAx(lo, len, V) {
        if (len >= V - 1) return { m: 'c', o: 0 };
        const m = Math.abs(lo) < 0.5 ? 's' : Math.abs(lo + len - V) < 0.5 ? 'e' : Math.abs(lo + len / 2 - V / 2) < 0.5 ? 'c' : usDock.zone(null, lo, len, V);
        return { m: m, o: Math.round((posPt(lo, len, m) - posPt(0, V, m)) * 100) / 100 };
    }

    let galEdit = null;     // a drag of the clicked picture or its strip under way: {the box and strip before}

    // A drag begins: the pieces show dashed outlines; Esc puts everything back.
    function galEditStart() {
        const f = galFly;
        if (!f) return;
        galMenuHide();
        galEdit = { el: f.el, u: galUnitRect(), sm: Object.assign({}, galStripM) };
        f.el.classList.add('edit');
        galStripPlace();
        hideTip();
    }

    // A drag ends: dropped, the place is saved (this site, and the default for new sites); cancelled, it goes back.
    function galEditStop(keep) {
        const ed = galEdit;
        if (!ed) return;
        galEdit = null;
        ed.el.classList.remove('edit');
        if (!keep || !galFly) {
            ed.el.classList.remove('asking');
            galStripM = ed.sm;
            if (galFly) galUnitPut(ed.u); else galStripPlace();
            return;
        }
        galSave();
    }

    // The clicked picture's place and its strip's remembered, and the gallery laid out around them.
    function galSave() {
        if (!galFly) return;
        const u = galUnitRect(), W = vpW(), H = vpH(), rows = galAnchorRows(H);
        galAnchorSave(Object.assign({ x: galAnchorAx(u.x, u.w, W), y: galAnchorAx(u.y, u.h, H),
            hf: Math.round((u.h - (galAttH() ? GAL_STRIP_H : 0)) / H * 1000) / 1000, strip: galStripRec(rows) }, galEdges(u, W, H, rows)));
        galHole = u;
        galStripPlace();
        if (galCur) galPageWork(galCur, galLayout(galCur, galHole));
    }

    // The browser window resized: the clicked picture goes back to its remembered place for the new size (edges on a line follow it), and the gallery is laid out again on the page holding the same picture.
    function galRefit() {
        galResizeAt = performance.now();
        if (galRefitTimer) return;
        galRefitTimer = setTimeout(function () {
            galRefitTimer = 0;
            galResizeAt = performance.now();
            galEditStop(false);
            galMenuHide();
            const set = galCur, H = vpH();
            if (galFly) {
                const sl = galStripLoad(galAnchorRec(), galAnchorRows(H));
                if (sl.m === 'out' && galStripM.m === 'out') galStripM.r = sl.r;
                galHole = galCornerRect(galFly.asp, galAttH());
                galUnitPut(galHole);
            } else if (galHole) galHole = galCornerRect(galHole.w / galHole.h, 0);
            if (galVeilEl && galVeilEl.classList.contains('on')) galVeilEl.style.clipPath = galBlur.style.clipPath = galClip(galHole);
            if (!set) return;
            const p = set.pages && set.pages[set.page], keep = set.at >= 0 ? set.at : p ? p[0] : 0;
            let L = galLayout(set, galHole);
            const pg = galPageOf(set, keep);
            if (pg !== set.page) { set.page = pg; L = galLayout(set, galHole); }
            if (galFly && set.pages.length === 1) {         // a one-page gallery's rows move with the picture: place it once more on the new ones
                const u = galCornerRect(galFly.asp, galAttH());
                if (u.x !== galHole.x || u.y !== galHole.y || u.w !== galHole.w || u.h !== galHole.h) { galHole = u; galUnitPut(u); L = galLayout(set, u); }
            }
            galPageWork(set, L);
        });
    }

    // A corner drag's picture height, snapped: the moving edge on a row's top or bottom, a gap's middle, the margin or the window's centre line (either axis); the nearest to the free height wins. st: the box with sh px of attached strip.
    function galSnapH(st, corner, h0, lines, W, H, sh, xs) {
        sh = sh || 0;
        const asp = st.w / (st.h - sh), cands = [];
        lines.concat([H / 2]).forEach(function (y) { cands.push((corner[0] === 'b' ? y - st.t : st.t + st.h - y) - sh); });
        (xs || [W / 2]).forEach(function (x) { cands.push((corner[1] === 'r' ? x - st.l : st.l + st.w - x) / asp); });
        let best = h0, d = Infinity;
        cands.forEach(function (h) {
            if (!(h >= 48 && h <= H * 0.9 && h + sh <= H && h * asp <= W - 8)) return;
            if (Math.abs(h - h0) < d) { d = Math.abs(h - h0); best = h; }
        });
        return best;
    }

    function galFlyPut(el, l, t, w, h) {
        el.style.left = Math.round(l) + 'px'; el.style.top = Math.round(t) + 'px';
        el.style.width = Math.round(w) + 'px'; el.style.height = Math.round(h) + 'px';
    }

    // A strip box s against picture box p: which side it docks to, if close enough and overlapping.
    function galDockFor(s, p) {
        if (s.x + s.w <= p.x || s.x >= p.x + p.w) return null;
        if (Math.abs(s.y + s.h - p.y) <= POS_SNAP_EDGE) return 't';
        if (Math.abs(s.y - (p.y + p.h)) <= POS_SNAP_EDGE) return 'b';
        return null;
    }

    // The strip docks to the picture's top or bottom, kept on screen, and asks whether to join them.
    function galDock(side) {
        galStripM = { m: 'dock', side: side };
        const u = galUnitRect(), W = vpW(), H = vpH();
        galUnitPut({ x: Math.max(0, Math.min(W - u.w, u.x)), y: Math.max(0, Math.min(H - u.h, u.y)), w: u.w, h: u.h });
        galSave();
        if (galFly) galFly.el.classList.add('asking');
    }

    // The question's answer: joined, the strip goes inside the picture's frame; else they stay apart.
    function galJoin(yes) {
        if (!galFly) return;
        galFly.el.classList.remove('asking');
        if (!yes || galStripM.m !== 'dock') return;
        const u = galUnitRect();
        galStripM = { m: 'in', side: galStripM.side };
        galUnitPut(u);
        galSave();
    }

    // The strip comes off the picture: the picture keeps its own box, the strip goes its own way.
    function galDetach() {
        const m = galStripM;
        if (m.m === 'out') return;
        const u = galUnitRect(), sh = galStripH(), y = m.side === 't' ? u.y + sh : u.y;
        galStripM = { m: 'out', side: m.side, r: null };
        galFlyPut(galFly.el, u.x, y, u.w, u.h - sh);
        galStripPlace();
    }

    // A press on the clicked picture: a click closes the gallery; dragged, it moves the picture with any attached strip, or from a corner resizes it (its own shape kept); both snap unless Ctrl is held, and the drop is saved.
    function galEditDown(e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.button !== 0 || !galFly) return;
        if (galFly.el.classList.contains('asking')) galJoin(false);
        const t0 = e.composedPath()[0], corner = t0 && t0.__hzCorner;
        let on = false;
        const u0 = galUnitRect(), sh = galAttH(), st = { x: e.clientX, y: e.clientY, l: u0.x, t: u0.y, w: u0.w, h: u0.h };
        const ph0 = st.h - sh, asp = st.w / ph0, W = vpW(), H = vpH(), rows = galAnchorRows(H);
        const ys = galLines(H, rows).map(function (x) { return x.v; }), xs = galLines(W).map(function (x) { return x.v; });
        let dock = null;
        const move = function (ev) {
            if (!on) {
                if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) < 4) return;
                on = true;
                galEditStart();
            }
            if (!galEdit) return;       // Esc
            const dx = ev.clientX - st.x, dy = ev.clientY - st.y;
            let l = st.l, t = st.t, w = st.w, h = st.h;
            dock = null;
            if (corner) {
                const sx = corner[1] === 'r' ? 1 : -1, sy = corner[0] === 'b' ? 1 : -1;
                const k = Math.max((st.w + sx * dx) / st.w, (ph0 + sy * dy) / ph0);
                const lo = Math.max(48, sh ? GAL_UNIT_MIN_W / asp : 0);
                let ph = Math.max(lo, Math.min(H * 0.9, ph0 * k));
                if (!ev.ctrlKey) ph = Math.max(lo, galSnapH(st, corner, ph, ys, W, H, sh, xs));
                w = ph * asp;
                if (w > W - 8) { w = W - 8; ph = w / asp; }
                h = ph + sh;
                if (corner[1] === 'l') l = st.l + st.w - w;
                if (corner[0] === 't') t = st.t + st.h - h;
            } else { l = st.l + dx; t = st.t + dy; }
            l = Math.max(0, Math.min(W - w, l));
            t = Math.max(0, Math.min(H - h, t));
            if (!corner && !ev.ctrlKey) {
                const m = galStripM;
                dock = m.m === 'out' && m.r ? galDockFor(m.r, { x: l, y: t, w: w, h: h }) : null;
                if (dock) t = dock === 't' ? m.r.y + m.r.h : m.r.y - h;
                else { const sn = galBoxSnap(l, t, w, h, W, H, rows); l = sn.x; t = sn.y; }
            }
            galUnitPut({ x: l, y: t, w: w, h: h });
        };
        const up = function () {
            window.removeEventListener('mousemove', move, true);
            window.removeEventListener('mouseup', up, true);
            if (!on) { if (!corner) galHide('hole'); return; }
            if (!galEdit) return;
            galEditStop(true);
            if (dock) galDock(dock);
        };
        window.addEventListener('mousemove', move, true);
        window.addEventListener('mouseup', up, true);
    }

    // A press on the strip's background: dragged, it comes off the picture and moves on its own (snapping unless Ctrl is held); dropped against the picture's top or bottom it docks there.
    function galStripDown(e) {
        if (!galFly) return;
        if (galFly.el.classList.contains('asking')) galJoin(false);
        const b = galSt.el.getBoundingClientRect(), W = vpW(), H = vpH(), rows = galAnchorRows(H);
        const st = { x: e.clientX, y: e.clientY, fx: (e.clientX - b.left) / (b.width || 1), oy: e.clientY - b.top };
        let on = false, dock = null;
        const move = function (ev) {
            if (!on) {
                if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) < 4) return;
                on = true;
                galEditStart();
                galDetach();
            }
            if (!galEdit) return;       // Esc
            const p = galFlyRect(), sw = galSt.el.offsetWidth, h = galStripH();
            let l = Math.max(0, Math.min(W - sw, ev.clientX - st.fx * sw)), t = Math.max(0, Math.min(H - h, ev.clientY - st.oy));
            dock = ev.ctrlKey ? null : galDockFor({ x: l, y: t, w: sw, h: h }, p);
            if (!dock && !ev.ctrlKey) { const sn = galBoxSnap(l, t, sw, h, W, H, rows); l = sn.x; t = sn.y; }
            galStripM.r = dock ? Object.assign(galDockRect(p, dock), { d: 1 }) : { x: l, y: t, w: 0, h: h };
            galStripPlace();
        };
        const up = function () {
            window.removeEventListener('mousemove', move, true);
            window.removeEventListener('mouseup', up, true);
            if (!on || !galEdit) return;
            galEditStop(true);
            if (dock) galDock(dock);
        };
        window.addEventListener('mousemove', move, true);
        window.addEventListener('mouseup', up, true);
    }

    let galMenuEl = null;

    // Our menu on the corner picture: its place, and the gallery settings.
    function galMenuShow(x, y) {
        const root = galTopRoot();
        if (!galMenuEl) {
            galMenuEl = document.createElement('div');
            galMenuEl.className = 'menu';
            root.appendChild(galMenuEl);
        }
        const m = galMenuEl;
        while (m.firstChild) m.firstChild.remove();
        const item = function (text, on, act) {
            const it = document.createElement('div');
            it.className = 'it';
            const ck = document.createElement('span');
            ck.className = 'ck';
            ck.textContent = on === true ? '✓' : '';
            const tx = document.createElement('span');
            tx.textContent = text;
            it.appendChild(ck);
            it.appendChild(tx);
            it.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); if (e.button === 0) act(); });
            m.appendChild(it);
        };
        const sep = function () { const d = document.createElement('div'); d.className = 'sep'; m.appendChild(d); };
        const flip = function (key) {
            return function () {
                cfg[key] = !cfg[key];
                saveSettings();
                if (key === 'gallerySavedMarks' && galCur) galCur.cells.forEach(function (c) {
                    const d = c.querySelector('.svd');
                    if (d && !cfg.gallerySavedMarks) d.remove();
                });
                galMarkSoon();
                galChipsSync();
                galMenuShow(x, y);
            };
        };
        item('Show the ▦ chip on every gallery', !!cfg.galleryChips, flip('galleryChips'));
        item('Tick results whose gallery was seen', !!cfg.galleryTicks, flip('galleryTicks'));
        item('Mark results something was saved from', !!cfg.gallerySavedMarks, flip('gallerySavedMarks'));
        item('Middle-click opens a gallery', !!cfg.galleryMiddle, flip('galleryMiddle'));
        sep();
        item('Close the gallery', null, function () { galMenuHide(); galHide('menu'); });
        m.hidden = false;
        const b = m.getBoundingClientRect();
        m.style.left = Math.round(Math.max(4, Math.min(x, vpW() - 4 - b.width))) + 'px';
        m.style.top = Math.round(Math.max(4, Math.min(y, vpH() - 4 - b.height))) + 'px';
        hideTip();
    }

    function galMenuHide() {
        if (galMenuEl) galMenuEl.hidden = true;
    }

    // From the card to the corner; a press on it closes the gallery.
    function galFlyOut(pic, hr, href) {
        const root = galTopRoot();
        if (!galHost.isConnected) document.documentElement.appendChild(galHost);
        const U = galHole, m = galStripM, sh = m.m === 'dock' ? galStripH() : 0, band = m.m === 'in' ? galStripH() : 0;
        const H = { x: U.x, y: m.side === 't' ? U.y + sh : U.y, w: U.w, h: U.h - sh };
        const P = { x: H.x, y: m.side === 't' ? H.y + band : H.y, w: H.w, h: H.h - band };
        const el = document.createElement('div'), pw = document.createElement('div'), img = document.createElement('img');
        el.className = 'fly';
        pw.className = 'pic';
        img.src = pic.currentSrc || pic.src;
        pw.appendChild(img);
        el.appendChild(pw);
        galFlyPut(el, H.x, H.y, H.w, H.h);
        el.style.transform = galFlyFrom(hr, H, P);
        const hds = ['tl', 'tr', 'bl', 'br'].map(function (c) {
            const hd = document.createElement('div');
            hd.className = 'hd ' + c;
            hd.__hzCorner = c;
            setTip(hd, 'Drag to resize — snaps to the edges of the gallery\'s rows and margins, the middle of the gaps between rows and the window\'s centre lines · hold Ctrl to size freely');
            hd.addEventListener('mousedown', galEditDown);
            hd.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); });
            return hd;
        });
        const pair = function (cls, label, yes, no, act) {
            const bt = document.createElement('div');
            bt.className = cls;
            if (label) { const q = document.createElement('b'); q.textContent = label; bt.appendChild(q); }
            [['ok', ICON_TICK, yes, true], ['no', ICON_CLOSE, no, false]].forEach(function (b) {
                const x = document.createElement('span');
                x.className = b[0];
                x.appendChild(mkIcon(b[1]));
                setTip(x, b[2]);
                x.addEventListener('mousedown', function (e) {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    act(b[3]);
                });
                bt.appendChild(x);
            });
            pw.appendChild(bt);
        };
        pair('bt ask', 'Join the strip to the picture?', 'Join them: the strip goes inside the picture\'s frame', 'Keep them apart', galJoin);
        el.addEventListener('mousedown', function (e) {
            if (e.button !== 0 && e.button !== 1) return;
            e.preventDefault();         // middle too: no autoscroll, and galMidEat eats its click
            e.stopPropagation();
            if (e.button === 0) { galEditDown(e); return; }
            galMidAt = Date.now();
            galHide('middle');
        });
        el.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!galEdit) galMenuShow(e.clientX, e.clientY);
        });
        setTip(el, 'Click to close this gallery · drag to move it, or a corner to resize it · right-click for options');
        root.appendChild(el);
        hds.forEach(function (hd) { root.appendChild(hd); });
        void el.offsetWidth;
        el.classList.add('on');
        el.style.transform = 'none';
        galFly = { el: el, img: img, pic: pic, href: href, asp: hr.width && hr.height ? hr.width / hr.height : 1, pic0: pw, hds: hds };
        galStripBuild();
        if (!galCur || galCur.href !== href) galStripBlank();
        galStripPlace();
    }

    // One file name ends with the other (a site prefixing a category to the same picture's name), 8+ characters.
    function galSameFile(a, b) {
        const name = function (u) { try { return decodeURIComponent(new URL(u).pathname.split('/').pop()).toLowerCase(); } catch (e) { return ''; } };
        const x = name(a), y = name(b);
        return x.length >= 8 && y.length >= 8 && (x.slice(-y.length) === y || y.slice(-x.length) === x);
    }

    // The transform that puts the picture's part P of box H over r.
    function galFlyFrom(r, H, P) {
        P = P || H;
        const sx = r.width / P.w, sy = r.height / P.h;
        return 'translate(' + (r.left - H.x - (P.x - H.x) * sx) + 'px,' + (r.top - H.y - (P.y - H.y) * sy) + 'px) scale(' + sx + ',' + sy + ')';
    }

    // Back to the card, wherever it is now; off screen or gone, it fades out instead.
    function galFlyBack() {
        const f = galFly;
        if (!f) return;
        galFly = null;
        hideTip();
        f.hds.forEach(function (hd) { hd.remove(); });
        const el = f.el, H = galHole || { x: 0, y: 0, w: 1, h: 1 };
        if (galSt) { galSt.el.hidden = true; if (galSt.el.parentNode === el) galTop.appendChild(galSt.el); }
        el.classList.remove('joined', 'edit', 'asking');
        el.style.pointerEvents = 'none';
        const r = f.pic.isConnected ? galHoleRect(f.pic) : null;
        const onScreen = r && r.width > 0 && r.bottom > 0 && r.top < vpH() && r.right > 0 && r.left < vpW();
        if (onScreen) el.style.transform = galFlyFrom(r, { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) });
        else el.style.opacity = '0';
        el.classList.add('back');
        setTimeout(function () { el.remove(); }, GAL_FLY_MS + 60);
        void H;
    }

    // The flown picture at full size: its own page's original (the gallery item that is this picture), else a URL rule's bigger copy.
    async function galFlyUpgrade(f, list) {
        const src = f.pic.currentSrc || f.pic.src, nat = { w: f.pic.naturalWidth || 0, h: f.pic.naturalHeight || 0 };
        const tok = { cancelled: false, fresh: false };
        const it = list.find(function (x) { return x.thumb === src; }) || list.find(function (x) { return sameStem(x.thumb, src); }) ||
            list.find(function (x) { return galSameFile(x.thumb, src); });
        let hit = null;
        if (it) { if (!it.link) galLinksPick(list); hit = await galLinkedHit(it, f.pic, tok); }
        if (!hit) {
            let cands = [];
            try { cands = collectCandidates(f.pic).map(function (c) { return c.url; }).filter(function (u) { return u !== src && !isVideoUrl(u); }).slice(0, GAL_TRIES); } catch (e) { /* none */ }
            for (const u of cands) {
                const d = await probe(u, false);
                if (d && !d.video && d.w > nat.w && sameShape(nat, d)) { hit = { url: u, w: d.w, h: d.h }; break; }
            }
        }
        if (!hit || hit.video || galFly !== f) return;
        const big = new Image();
        big.onload = function () { if (galFly === f || f.el.isConnected) f.img.src = hit.url; };
        big.src = hit.url;
        dbg('gallery: the clicked picture at full size', { from: src, to: hit.url });
    }

    // A hovered door: its chip shows (with galleryChips off) and its pictures are read ahead.
    function galDoorHover(el, x, y) {
        if (!isTopFrame) return;
        if (x !== undefined) { galPt.x = x; galPt.y = y; }    // mouseover lands before the mousemove that would set it
        const href = galLinkOf(el);
        if (!href || galChipHot === el) return;
        galKindOf(el, href).then(function (kind) {
            if (kind === 'results' || galChipHot === el) return;
            if (!holds(el.getBoundingClientRect(), galPt.x, galPt.y)) return;
            const prev = galChipHot;
            galChipHot = el;
            if (prev) galChipRefresh(prev);
            if (galChipEl(el, href)) galMarkPlace(el);
            if (galCur || galWant) return;
            clearTimeout(galHoverTimer);
            galHoverTimer = setTimeout(function () {
                if (galChipHot !== el) return;
                galLoad(href).then(function (list) { if (Array.isArray(list)) galWarm(list); });
            }, cfg.hoverDelay);
        });
    }

    // The ▦ chip of a door's picture, made if missing; null when the picture is too small for marks.
    function galChipEl(img, h) {
        const at = img.closest('picture') || img, ir = galMarkRect(img, at);
        if (ir.width < 48 || ir.height < 24) return null;
        let m = galMarkFind(at, GAL_DOOR_MARK);
        if (!m) {
            m = document.createElement('span');
            m.setAttribute(GAL_DOOR_MARK, '');
            galChipClickable(m);
            m.__hzAt = at;
            galPill(at, true).__box.appendChild(m);
        }
        m.__hzHref = h;
        m.__hzImg = img;
        galChipStyle(m);
        return m;
    }

    function galChipOpen(h) { return !!h && (galWant === h || (!!galCur && galCur.href === h)); }

    // Closed: the ▦ chip; open: a yellow ✕. Left out of the pill when chips show only under the pointer and this one is not.
    function galChipStyle(m) {
        const open = galChipOpen(m.__hzHref), shown = open || cfg.galleryChips || galChipHot === m.__hzImg;
        if (m.__hzOpen !== open || !m.firstChild) {
            m.__hzOpen = open;
            while (m.firstChild) m.firstChild.remove();
            const svg = mkIcon(open ? ICON_CLOSE : ICON_GALLERY);
            m.appendChild(svg);
            setTip(m, open ? 'Close this gallery' : 'Show this gallery’s pictures');
        }
        m.className = open ? 'open' : shown ? '' : 'off';
    }

    function galChipRefresh(img) {
        const m = galMarkFind(img.closest('picture') || img, GAL_DOOR_MARK);
        if (m) { galChipStyle(m); galMarkPlace(img); }
    }

    function galChipsSync() {
        galPillMarks(GAL_DOOR_MARK).forEach(function (m) { galChipStyle(m); if (m.__hzImg) galMarkPlace(m.__hzImg); });
    }

    // A press on the chip opens its door's gallery, or closes it when open; the page never sees it.
    function galChipClickable(m) {
        ['mousedown', 'mouseup', 'click', 'auxclick', 'dblclick'].forEach(function (t) {
            m.addEventListener(t, function (e) {
                if (t === 'mousedown') document.documentElement.setAttribute('data-userscript-click-claim', String(Date.now()));
                e.preventDefault();
                e.stopImmediatePropagation();
                hideTip();
                if (t !== 'mousedown' || e.button !== 0 || !m.__hzHref || !m.__hzImg) return;
                if (galChipOpen(m.__hzHref)) { galHide('chip'); return; }
                galPeek = true;
                galMiddle(m.__hzImg, m.__hzHref);
            }, true);
        });
    }

    // ---- open diagnostics
    function galTrace(href, what) {
        let l = galTraces.get(href);
        if (!l) {
            l = [];
            galTraces.set(href, l);
            if (galTraces.size > 60) galTraces.delete(galTraces.keys().next().value);
        }
        if (l.length < 100) l.push([performance.now(), what]);
    }

    // The pressed result lit, the page dimmed, until its gallery shows; nothing after GAL_DIAG_MS -> the popup.
    function galPendStart(href, how) {
        galPendClear();
        const root = galLayer();
        if (!galHost.isConnected) document.documentElement.appendChild(galHost);
        const el = document.createElement('div'), h = galHole;
        el.className = 'pend';
        el.hidden = true;
        el.style.cssText = 'left:' + (h.x - 3) + 'px;top:' + (h.y - 3) + 'px;width:' + (h.w + 6) + 'px;height:' + (h.h + 6) + 'px';
        root.appendChild(el);
        const at = 'cache ' + (galCache.has(href) ? 'has this link' : 'empty for this link') +
            '; hidden frame ' + (galFrameStop ? 'busy' : 'idle') + '; gallery on screen ' + (galCur ? 'yes' : 'no') +
            '; tab ' + document.visibilityState + '; originals fetching ' + galHqText();
        galTrace(href, 'press (' + how + ')');
        galPend = { href: href, how: how, t0: performance.now(), el: el, at: at };
        galPend.lit = setTimeout(function () { el.hidden = false; }, GAL_PEND_MS);
        galPend.timer = setTimeout(function () {
            const p = galPend;
            if (!p || p.href !== href) return;
            galTrace(href, 'nothing on screen after ' + GAL_DIAG_MS / 1000 + ' s');
            galPendClear();
            galDiag(p, 'nothing on screen after ' + GAL_DIAG_MS / 1000 + ' s');
        }, GAL_DIAG_MS);
    }

    function galPendClear() {
        if (!galPend) return;
        clearTimeout(galPend.timer);
        clearTimeout(galPend.lit);
        galPend.el.remove();
        galPend = null;
    }

    // A URL with every word and number replaced: only its shape and where it points survive.
    function galSane(u) {
        let x;
        try { x = new URL(u, location.href); } catch (e) { return 'unparsable'; }
        const word = function (s) { return s.replace(/[0-9]+/g, '#').replace(/[^#\W_]+/g, 'w'); };
        const where = x.host === location.host ? 'same host' : x.host.split('.').slice(-2).join('.') === location.host.split('.').slice(-2).join('.') ? 'sibling subdomain' : 'other host';
        const q = Array.from(x.searchParams.keys()).map(word);
        return x.protocol.replace(':', '') + ', ' + where + ', path ' + (word(x.pathname) || '/') + (q.length ? ', query keys ' + q.join('&') : '');
    }

    function galHostMix(urls) {
        const n = {};
        urls.forEach(function (u) { let k; try { k = galSane(u).split(', ')[1]; } catch (e) { k = '?'; } n[k] = (n[k] || 0) + 1; });
        return Object.keys(n).map(function (k) { return n[k] + ' ' + k; }).join(', ');
    }

    function galDiagText(p, why) {
        const lines = [
            'Hover Zoom ' + version() + ' - gallery open diagnostics (URLs reduced to shape: w = word, # = number)',
            'result: ' + why,
            'trigger: ' + p.how,
            'page: ' + galSane(location.href),
        ];
        if (p.href) lines.push('link: ' + galSane(p.href));
        lines.push('at press: ' + p.at);
        lines.push('settings: hover delay ' + cfg.hoverDelay + ' ms, request log ' + (cfg.logRequests !== false ? 'on' : 'off') +
            ', previews on the linked page ' + (p.href && siteEnabledAt(p.href) ? 'yes' : 'no'));
        lines.push('browser: ' + navigator.userAgent);
        if (p.href) {
            lines.push('trace, ms from the press (negative = before it):');
            (galTraces.get(p.href) || []).forEach(function (r) { lines.push('  ' + Math.round(r[0] - p.t0) + '  ' + r[1]); });
        }
        return lines.join('\n');
    }

    // The gallery's state and the recent load traces (ms from each load's first step), URLs reduced to shape.
    function galStateText() {
        const lines = ['top frame ' + isTopFrame + ', host ' + pageHost() + ', doors ' + galMarksHere() + ', open ' + !!galCur + ', locked ' + !!galOn];
        galTraces.forEach(function (l, href) {
            const t0 = l.length ? l[0][0] : 0;
            lines.push('link ' + galSane(href) + ' (cached ' + galCache.has(href) + ')');
            l.forEach(function (r) { lines.push('  ' + Math.round(r[0] - t0) + '  ' + r[1]); });
        });
        return lines.join('\n');
    }

    // The copyable popup: what this open did, step by step.
    function galDiag(p, why) {
        const root = galLayer();
        if (!galHost.isConnected) document.documentElement.appendChild(galHost);
        const old = root.querySelector('.diag');
        if (old) old.remove();
        const d = document.createElement('div'), b = document.createElement('b'), ta = document.createElement('textarea');
        const copy = document.createElement('button'), close = document.createElement('button');
        d.className = 'diag';
        b.textContent = 'Gallery did not open - copy this for Claude';
        ta.readOnly = true;
        ta.value = galDiagText(p, why);
        copy.textContent = 'Copy';
        close.textContent = 'Close';
        copy.addEventListener('click', function () {
            const ok = function () { copy.textContent = 'Copied'; };
            ta.focus();
            ta.select();
            try {
                navigator.clipboard.writeText(ta.value).then(ok, function () { if (document.execCommand('copy')) ok(); });
            } catch (e) { if (document.execCommand('copy')) ok(); }
        });
        close.addEventListener('click', function () { d.remove(); });
        d.appendChild(b);
        d.appendChild(ta);
        d.appendChild(close);
        d.appendChild(copy);
        root.appendChild(d);
        dbg('gallery diagnostics', ta.value);
    }

    // The rest of that press: no new tab.
    function galMidEat(e) {
        const at = e.button === 1 ? galMidAt : e.button === 0 ? galLeftAt : 0;
        if (!at || Date.now() - at > 1000) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    }

    // A Ctrl tap (nothing else pressed, clicked or scrolled meanwhile) closes an open peek.
    function galKeyDown(e) {
        if (e.key !== 'Control') { galTap = false; return; }
        if (e.repeat) return;
        galTap = !e.shiftKey && !e.altKey && !e.metaKey && !typingIn(e) && galPeek && !galEdit && !!(galWant || galCur);
    }

    function galKeyUp(e) {
        if (e.key !== 'Control' || !galTap) return;
        galTap = false;
        if (galOn || galWant || galCur) { galPeekTapAt = Date.now(); galHide('ctrl'); }
    }

    // Tracks the pointer; a hover-only chip goes once it leaves its door.
    function galMove(e) {
        if (e.clientX === galPt.x && e.clientY === galPt.y) return;     // the browser's own move after a layout
        galPt.x = e.clientX;
        galPt.y = e.clientY;
        galMovedAt = performance.now();
        const st = galStill;
        galStill = null;
        if (st && galCur === st.set && st.cell.isConnected && holds(st.cell.getBoundingClientRect(), galPt.x, galPt.y)) st.go();
        if (galChipHot && !holds(galChipHot.getBoundingClientRect(), galPt.x, galPt.y)) galChipCool();
    }

    function galChipCool() {
        const el = galChipHot;
        galChipHot = null;
        if (el) galChipRefresh(el);
    }

    // A page scroll hides the set; nothing shows again until the pointer itself moves.
    function galScroll(e) {
        galChipCool();
        if (!galMarksHere() && !galWant && !galCur) return;
        const t = e.target;
        if (t !== document && !(t && t.nodeType === 1 && t.clientHeight >= vpH() / 2)) return;
        if ((galWant || galCur) && performance.now() - galResizeAt > 1000)      // a window resize reflows the page, and its scroll is not the user's
            galHide(performance.now() - galInputAt < 600 ? 'scroll' : 'page scrolled by itself');
        galMarkSoon();
    }

    // A stored list of links, oldest first, the last GAL_SEEN_MAX kept.
    function galList(key) {
        if (galSeen[key]) return galSeen[key];
        let a = [];
        try { a = JSON.parse(GM_getValue(key, '') || '[]'); } catch (e) { /* unreadable: start empty */ }
        galSeen[key] = new Set(Array.isArray(a) ? a : []);
        return galSeen[key];
    }

    function galListAdd(key, href) {
        galSeen[key] = null;
        const s = galList(key);
        s.delete(href);
        s.add(href);
        while (s.size > GAL_SEEN_MAX) s.delete(s.values().next().value);
        try { GM_setValue(key, JSON.stringify(Array.from(s))); } catch (e) { /* storage unavailable */ }
    }

    function galListDel(key, href) {
        galSeen[key] = null;
        const s = galList(key);
        if (!s.delete(href)) return;
        try { GM_setValue(key, JSON.stringify(Array.from(s))); } catch (e) { /* storage unavailable */ }
    }

    // A click on a tick or a saved disc: the link is no longer seen, visited or saved-from, and its marks go.
    function galMarkClear(m, e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideTip();
        const h = m.__hzHref;
        if (!h || e.type !== 'click') return;
        galListDel(GAL_SEEN_KEY, h);
        galListDel(GAL_VISITED_KEY, h);
        galListDel(GAL_SAVEDFROM_KEY, h);
        galPillMarks(GAL_MARK).concat(galPillMarks(GAL_SAVED_MARK)).forEach(function (x) {
            if (x.__hzHref !== h) return;
            const box = x.parentElement, pill = box && box.getRootNode().host;
            x.remove();
            if (pill && !box.children.length) pill.remove();
        });
        galMarkSoon();
        dbg('gallery mark cleared', { href: h });
    }

    function galMarkClickable(m) {
        ['mousedown', 'mouseup', 'click', 'auxclick', 'dblclick'].forEach(function (t) {
            m.addEventListener(t, function (e) {
                if (t === 'mousedown') document.documentElement.setAttribute('data-userscript-click-claim', String(Date.now()));
                galMarkClear(m, e);
            }, true);
        });
        setTip(m, 'Click: mark as not seen and not saved');
    }

    const GAL_TICK_ORDER = ['rt', 'rb', 'lb', 'lt'], GAL_SAVED_ORDER = ['lt', 'lb', 'rb', 'rt'], GAL_HINT_ORDER = ['lt', 'rt', 'lb', 'rb'];

    function galOverlap(a, b) {
        return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    }

    // Spots for marks {w, h, order, rel?} in box ir: each takes its first spot clear of the blockers and earlier marks (prior: ones already drawn) —
    // rel {i, side: 'right'|'below'} beside mark i first, then its corners, then beside any — else the least covered.
    function galCorners(ir, blockers, marks, pad, prior) {
        const p = pad === undefined ? 4 : pad, taken = (prior || []).slice(), out = [];
        marks.forEach(function (k) {
            const at = function (left, top) { return { left: left, top: top, right: left + k.w, bottom: top + k.h }; };
            const cands = [], r = k.rel && out[k.rel.i];
            if (r) cands.push(k.rel.side === 'below' ? at(r.left, r.bottom + p) : at(r.right + p, r.top));
            k.order.forEach(function (c) {
                cands.push(at(c[0] === 'r' ? ir.right - p - k.w : ir.left + p, c[1] === 't' ? ir.top + p : ir.bottom - p - k.h));
            });
            taken.forEach(function (t) { cands.push(at(t.right + p, t.top), at(t.left - p - k.w, t.top)); });
            let best = cands[0], cov = Infinity;
            cands.forEach(function (c) {
                if (c.left < ir.left || c.right > ir.right || c.top < ir.top || c.bottom > ir.bottom) return;
                const v = blockers.concat(taken).reduce(function (s, b) { return s + galOverlap(c, b); }, 0);
                if (v < cov) { cov = v; best = c; }
            });
            taken.push(best);
            out.push(best);
        });
        return out;
    }

    // The page's own elements over the picture's box (a count badge, a name bar): read from the card's tree, so it holds off screen too.
    function galMarkBlockers(at, ir) {
        const area = ir.width * ir.height, out = [];
        let scope = galMarkHost(at);
        if (!scope) return out;
        for (let i = 0; i < 2 && scope.parentElement && scope.parentElement !== document.body; i++) {
            const pr = scope.parentElement.getBoundingClientRect();
            if (pr.width * pr.height > area * 2) break;
            scope = scope.parentElement;
        }
        const mine = '[' + GAL_PILL + ']';
        scope.querySelectorAll('*').forEach(function (n) {
            if (n === at || n.contains(at) || at.contains(n) || n.closest(mine)) return;
            const r = n.getBoundingClientRect();
            if (r.width < 1 || r.height < 1 || r.width * r.height > area / 2 || galOverlap(r, ir) <= 0) return;
            const cs = getComputedStyle(n);
            if (cs.visibility === 'hidden' || +cs.opacity === 0) return;
            out.push(r);
        });
        return out;
    }

    const GAL_PILL_CSS = ':host{all:initial}' +
        '.p{display:flex;align-items:center;gap:3px;box-sizing:border-box;height:26px;padding:0 4px;border-radius:6px;' +
        'background:rgba(30,30,46,.92);border:1px solid #45475a;box-shadow:0 2px 8px rgba(0,0,0,.5)}' +
        '.p>*{display:block;flex:none;cursor:pointer}svg{display:block}' +
        '[data-hz-door]{order:1;display:flex;align-items:center;justify-content:center;width:20px;height:20px}' +
        '[data-hz-door].off{display:none}[data-hz-door] svg{width:13px;height:13px;fill:#89b4fa}' +
        '[data-hz-door].open svg{width:15px;height:15px;fill:#f9e2af}' +
        '[data-hz-seen]{order:2;width:20px;height:20px}[data-hz-seen="2"]{width:28px}[data-hz-saved]{order:3;width:18px;height:18px}';

    // Every mark of one kind on the page, inside the pills.
    function galPillMarks(attr) {
        const out = [];
        document.querySelectorAll('[' + GAL_PILL + ']').forEach(function (p) {
            if (p.__box) p.__box.querySelectorAll('[' + attr + ']').forEach(function (m) { out.push(m); });
        });
        return out;
    }

    // A picture's pill, made when asked. Its look lives in a shadow root: an extension restyling the page's inline colours
    // (Dark Reader turned an inline dark pill light) leaves a shadow stylesheet alone. It swallows presses on its own padding.
    function galPill(at, make) {
        const host = galMarkHost(at);
        if (!host) return null;
        for (let m = host.lastElementChild; m; m = m.previousElementSibling) if (m.hasAttribute(GAL_PILL) && m.__hzAt === at) return m;
        if (!make) return null;
        const pill = document.createElement('span');
        pill.setAttribute(GAL_PILL, '');
        pill.__hzAt = at;
        pill.style.cssText = 'all:initial;position:absolute;left:0;top:0;z-index:3;display:none;pointer-events:auto';
        const sr = pill.attachShadow({ mode: 'open' }), st = document.createElement('style'), box = document.createElement('div');
        st.textContent = GAL_PILL_CSS;
        box.className = 'p';
        sr.appendChild(st);
        sr.appendChild(box);
        pill.__box = box;
        ['mousedown', 'mouseup', 'click', 'auxclick', 'dblclick'].forEach(function (t) {
            pill.addEventListener(t, function (e) {
                const t0 = e.composedPath()[0];
                if (t0 !== pill && t0 !== box) return;
                e.preventDefault();
                e.stopImmediatePropagation();
            }, true);
        });
        host.appendChild(pill);
        return pill;
    }

    // The pill laid out clear of the page's badges: top-left first with a chip (user), else as the tick or disc would go; gone when empty.
    function galMarkPlace(img) {
        const at = img.closest('picture') || img, pill = galPill(at);
        if (!pill) return;
        const kids = pill.__box.children;
        if (!kids.length) { pill.remove(); return; }
        const shown = Array.prototype.some.call(kids, function (k) { return !k.classList.contains('off'); });
        pill.style.display = shown ? 'flex' : 'none';
        if (!shown) return;
        const ir = galMarkRect(img, at), o = pill.getBoundingClientRect();
        const order = pill.__box.querySelector('[' + GAL_DOOR_MARK + ']') ? GAL_HINT_ORDER : pill.__box.querySelector('[' + GAL_MARK + ']') ? GAL_TICK_ORDER : GAL_SAVED_ORDER;
        const spot = galCorners(ir, galMarkBlockers(at, ir), [{ w: o.width, h: o.height, order: order }])[0];
        pill.style.left = ((parseFloat(pill.style.left) || 0) + spot.left - o.left) + 'px';
        pill.style.top = ((parseFloat(pill.style.top) || 0) + spot.top - o.top) + 'px';
    }

    // One green tick in the picture's first uncovered corner (top-right first), or two overlapping for a visited gallery; a click clears it.
    function galMarkImg(img, kind, h) {
        const at = img.closest('picture') || img;
        const ir = galMarkRect(img, at);
        if (ir.width < 48 || ir.height < 24) return null;
        let m = galMarkFind(at, GAL_MARK);
        if (m && m.getAttribute(GAL_MARK) !== kind) { m.remove(); m = null; }
        if (!m) {
            m = document.createElement('span');
            m.setAttribute(GAL_MARK, kind);
            const NS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', kind === '2' ? '0 0 34 24' : '0 0 24 24');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            (kind === '2' ? [0, 10] : [0]).forEach(function (dx) {
                [['#0b2b0b', '6.5'], ['#3ee03e', '3.6']].forEach(function (p) {
                    const path = document.createElementNS(NS, 'path');
                    path.setAttribute('d', 'M' + (4 + dx) + ' 13.5 ' + (9.5 + dx) + ' 19 ' + (20.5 + dx) + ' 5');
                    path.setAttribute('fill', 'none');
                    path.setAttribute('stroke', p[0]);
                    path.setAttribute('stroke-width', p[1]);
                    path.setAttribute('stroke-linecap', 'round');
                    path.setAttribute('stroke-linejoin', 'round');
                    svg.appendChild(path);
                });
            });
            m.appendChild(svg);
            galMarkClickable(m);
            m.__hzAt = at;
            galPill(at, true).__box.appendChild(m);
        }
        m.__hzHref = h;
        return m;
    }

    // The picture's drawn box: the larger of the <img> and its <picture>, since an inline <picture> measures as a line box.
    // Clipped by every ancestor up to the result's link that hides overflow: nsfw.xxx scales the picture 1.1× under the pointer.
    function galMarkRect(img, at) {
        const a = img.getBoundingClientRect(), b = at === img ? a : at.getBoundingClientRect();
        let l, t, r, btm;
        const big = a.width * a.height >= b.width * b.height ? a : b;
        l = big.left; t = big.top; r = big.right; btm = big.bottom;
        const host = galMarkHost(at);
        for (let e = at.parentElement; e; e = e.parentElement) {
            const cs = getComputedStyle(e);
            if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
                const c = e.getBoundingClientRect();
                if (c.width > 0 && c.height > 0) { l = Math.max(l, c.left); t = Math.max(t, c.top); r = Math.min(r, c.right); btm = Math.min(btm, c.bottom); }
            }
            if (e === host) break;
        }
        if (r <= l || btm <= t) return big;
        return { left: l, top: t, right: r, bottom: btm, width: r - l, height: btm - t };
    }

    // Where a picture's marks live: the result's link itself, above any layer the card makes inside it (nsfw.xxx: a z-index 1 container under the link's z-index 2 overlay).
    function galMarkHost(at) {
        return at.closest('a[href]') || at.parentElement;
    }

    // Our mark of one kind for this picture.
    function galMarkFind(at, attr) {
        const pill = galPill(at);
        return pill ? pill.__box.querySelector('[' + attr + ']') : null;
    }

    // The saved mark (placed by galMarkPlace, top-left first).
    function galMarkSaved(img, h) {
        const at = img.closest('picture') || img;
        const ir = galMarkRect(img, at);
        if (ir.width < 48 || ir.height < 24) return null;
        let m = galMarkFind(at, GAL_SAVED_MARK);
        if (!m) {
            m = galSavedIcon('');
            m.setAttribute(GAL_SAVED_MARK, '');
            galMarkClickable(m);
            m.__hzAt = at;
            galPill(at, true).__box.appendChild(m);
        }
        m.__hzHref = h;
        return m;
    }

    function galMarkAll() {
        if (!isTopFrame || !galMarksHere()) return;
        const seen = galList(GAL_SEEN_KEY), went = galList(GAL_VISITED_KEY), from = galList(GAL_SAVEDFROM_KEY);
        galChipsAll();
        if (!seen.size && !went.size && !from.size) { galMarkLog({ stored: 'none' }); return; }
        const dbgOn = debugOn(), st = { seenStored: seen.size, visitedStored: went.size, pictures: 0, linked: 0, ticks: 0, tooSmall: 0, hidden: [] };
        const links = new Set(), biggest = new Map(), area = function (img) { const r = galMarkRect(img, img.closest('picture') || img); return r.width * r.height; };
        const imgs = Array.from(document.querySelectorAll('a[href] img'));
        imgs.forEach(function (img) {
            const h = galLinkOf(img);
            if (h && (went.has(h) || seen.has(h) || from.has(h)) && (!biggest.has(h) || area(img) > area(biggest.get(h)))) biggest.set(h, img);
        });
        imgs.forEach(function (img) {
            st.pictures++;
            const h = galLinkOf(img);
            if (!h) return;
            st.linked++;
            links.add(h);
            if (biggest.has(h) && biggest.get(h) !== img) {   // the card's avatar or caption icon: only the result's main picture is marked
                const at = img.closest('picture') || img;
                [GAL_MARK, GAL_SAVED_MARK].forEach(function (k) { const x = galMarkFind(at, k); if (x) x.remove(); });
                galMarkPlace(img);
                return;
            }
            const atp = img.closest('picture') || img;
            const saved = from.has(h) && cfg.gallerySavedMarks ? galMarkSaved(img, h) : null;
            if (!saved) { const x = galMarkFind(atp, GAL_SAVED_MARK); if (x) x.remove(); }
            let m = null;
            if (cfg.galleryTicks) {
                if (went.has(h)) m = galMarkImg(img, '2', h);
                else if (seen.has(h)) m = galMarkImg(img, '1', h);
            }
            if (!m) { const x = galMarkFind(atp, GAL_MARK); if (x) x.remove(); }
            if (!cfg.galleryTicks && (went.has(h) || seen.has(h))) { galMarkPlace(img); return; }
            const chip = galMarkFind(img.closest('picture') || img, GAL_DOOR_MARK);
            galMarkPlace(img);
            if (!went.has(h) && !seen.has(h)) return;
            if (!m) {
                st.tooSmall++;
                if (dbgOn && (st.small || (st.small = [])).length < 3) {
                    const at = img.closest('picture') || img, a = img.getBoundingClientRect(), b = at.getBoundingClientRect();
                    st.small.push({ href: h, img: Math.round(a.width) + 'x' + Math.round(a.height), picture: at === img ? null : Math.round(b.width) + 'x' + Math.round(b.height),
                        natural: img.naturalWidth + 'x' + img.naturalHeight, display: getComputedStyle(img).display, parent: galMarkName(img.parentElement) });
                }
                return;
            }
            st.ticks++;
            if (dbgOn && st.hidden.length < 3) { const why = galMarkHidden(m, img); if (why) st.hidden.push({ href: h, why: why }); }
        });
        if (!dbgOn) return;
        const last = Array.from(seen).pop();
        if (last && !links.has(last)) {
            let lu;
            try { lu = new URL(last); } catch (e) { lu = new URL(location.href); }
            const seg = lu.pathname.split('/')[1] || '';
            st.lastSeenUnmatched = last;
            st.nearestLinks = Array.from(links).filter(function (h) {
                try { const u = new URL(h); return u.host === lu.host && (u.pathname.split('/')[1] || '') === seg; } catch (e) { return false; }
            }).slice(0, 3);
        }
        galMarkLog(st);
    }

    // A chip on every door's picture whose area leads to galleries; hidden (spot kept) when galleryChips is off. An area's kind is read once, then this runs again.
    function galChipsAll() {
        document.querySelectorAll('a[href] img').forEach(function (img) {
            const h = galLinkOf(img), at = img.closest('picture') || img;
            const old = galMarkFind(at, GAL_DOOR_MARK);
            if (!h || !doorReason(img)) { if (old) { old.remove(); galMarkPlace(img); } return; }
            const key = domChain(img);
            if (!galKindDone.has(key)) { galKindOf(img, h).then(galMarkSoon); return; }
            if (galKindDone.get(key) === 'results') { if (old) { old.remove(); galMarkPlace(img); } return; }
            const chip = galChipEl(img, h);
            if (!chip) return;
            galMarkPlace(img);
        });
    }

    // Debug only: why a drawn tick cannot be seen — zero size, clipped by an ancestor, or something drawn over it.
    function galMarkHidden(m, img) {
        const r = m.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return 'zero size';
        const cs = getComputedStyle(m);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return 'style ' + cs.display + '/' + cs.visibility + '/' + cs.opacity;
        for (let p = m.parentElement; p && p !== document.body; p = p.parentElement) {
            const ps = getComputedStyle(p);
            if (ps.overflow === 'visible' && ps.overflowX === 'visible' && ps.overflowY === 'visible') continue;
            const pr = p.getBoundingClientRect();
            if (r.left < pr.left || r.right > pr.right || r.top < pr.top || r.bottom > pr.bottom) return 'clipped by ' + galMarkName(p);
        }
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (cx < 0 || cy < 0 || cx > vpW() || cy > vpH()) return null;
        const top = document.elementFromPoint(cx, cy);
        const at = img.closest('picture') || img;
        if (top && top !== at && !at.contains(top) && !top.contains(m)) return 'covered by ' + galMarkName(top);
        return null;
    }

    function galMarkName(el) {
        return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
    }

    let galMarkLast = '';
    function galMarkLog(st) {
        const s = JSON.stringify(st);
        if (s === galMarkLast) return;
        galMarkLast = s;
        dbg('gallery marks', st);
    }

    function galMarkSoon() {
        clearTimeout(galMarkTimer);
        galMarkTimer = setTimeout(function () { galMarkAll(); galPreNext(); }, 250);
    }

    // Load a gallery's thumbnails into the browser's cache, up to GAL_WAIT_MS.
    function galWarm(list) {
        let t = 0;
        return Promise.race([Promise.all(list.map(galImg)), new Promise(function (r) { t = setTimeout(r, GAL_WAIT_MS); })])
            .then(function () { clearTimeout(t); });
    }

    // ---- preload: the first page of every gallery on screen, one at a time, nearest the pointer first

    let galPre = null, galPreStop = false, galPreLog = null;
    const galPreTried = new Set();

    // The nearest door on screen whose area leads to galleries and whose pictures are not read yet.
    function galPrePick() {
        const seen = new Set(), W = vpW(), H = vpH();
        let best = null, bestD = Infinity;
        document.querySelectorAll('a[href] img').forEach(function (img) {
            const h = galLinkOf(img);
            if (!h || seen.has(h)) return;
            seen.add(h);
            if (galPreTried.has(h) || galCache.has(h) || galLists.has(h)) return;
            const key = domChain(img);
            if (!galKindDone.has(key) || galKindDone.get(key) === 'results' || !doorReason(img)) return;     // where a chip shows
            try { if (new URL(h).origin !== location.origin) return; } catch (e) { return; }
            const r = galHoleRect(img);
            if (!r.width || !r.height || r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) return;
            const d = Math.hypot(r.left + r.width / 2 - galPt.x, r.top + r.height / 2 - galPt.y);
            if (d < bestD) { bestD = d; best = h; }
        });
        return best;
    }

    // One more gallery, unless one is in flight, a frame is busy (a hover, or an open gallery read on), or a refusal stopped it.
    function galPreNext() {
        if (!isTopFrame || !cfg.galleryPreload || galPre || galPreStop || galFrameStop || galGrowing || galWant || galCur ||
            document.visibilityState === 'hidden' || !siteEnabled() || CAPTCHA_HERE) return;
        const href = galPrePick();
        if (!href) { if (galPreLog) { galPreLog.end('done'); galPreLog = null; } return; }
        if (!galPreLog) {
            usLog.enable(cfg.logRequests !== false);
            galPreLog = usLog.start('gallery', { host: pageHost(), pace: version().replace(/\?/g, '') + ' serial', slowed: noRush(pageHost()) });
        }
        galPre = href;
        galPreTried.add(href);
        galLoad(href, galPreLog).then(function (list) {
            if (list === 'cancel') galPreTried.delete(href);
            return Array.isArray(list) ? galWarm(list) : null;
        }).then(function () {
            galPre = null;
            setTimeout(galPreNext, 0);
        });
    }

    // A refusal or a frozen page: no more preloading on this page.
    function galPreHalt(why) {
        if (galPreStop) return;
        galPreStop = true;
        dbg('gallery preload stopped: ' + why);
        if (galPreLog) { galPreLog.end(why); galPreLog = null; }
    }

    if (isTopFrame) {
        document.addEventListener('scroll', galScroll, { capture: true, passive: true });
        window.addEventListener('pagehide', function () { if (galPreLog) { galPreLog.end('cut'); galPreLog = null; } });
        setTimeout(function () { galMarkAll(); galPreNext(); }, 1500);
        window.addEventListener('keydown', galKeyDown, true);
        ['mouseup', 'auxclick', 'click'].forEach(function (t) { document.addEventListener(t, galMidEat, true); });
        window.addEventListener('keyup', galKeyUp, true);
        window.addEventListener('blur', function () { galTap = false; if (galPend) galTrace(galPend.href, 'window lost focus'); });
        document.addEventListener('visibilitychange', function () {
            if (galPend) galTrace(galPend.href, 'tab ' + document.visibilityState);
            if (document.visibilityState === 'hidden') { if (galPre && galFrameStop) galFrameStop(); }   // only the tab in view preloads
            else galPreNext();
        });
        window.addEventListener('wheel', function () { galTap = false; galInputAt = performance.now(); }, { capture: true, passive: true });
        window.addEventListener('touchstart', function () { galInputAt = performance.now(); }, { capture: true, passive: true });
        setTimeout(function () {
            if (galMarksHere()) galListAdd(GAL_VISITED_KEY, location.href.split('#')[0]);
        }, 0);
        document.addEventListener('mousemove', galMove, { capture: true, passive: true });
        document.addEventListener('mousedown', function (e) {
            galTap = false;
            galMidAt = 0;
            galLeftAt = 0;
            if (e.button === 0) galInputAt = performance.now();      // a scrollbar drag; the middle press itself is not
            if (galMenuEl && !galMenuEl.hidden && e.composedPath().indexOf(galMenuEl) < 0) galMenuHide();
            if (e.composedPath().some(function (n) { return n.nodeType === 1 && n.hasAttribute(GAL_PILL); })) return;   // our marks act on their own
            const plain = e.button === 1 && cfg.galleryMiddle && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
            if (plain && !CAPTCHA_HERE && siteEnabled()) {
                if (e.target === galHost && galCur) { e.preventDefault(); return; }
                const door = doorAt(e.target, e.clientX, e.clientY), href = door && galLinkOf(door);
                if (href && galKindDone.get(domChain(door)) !== 'results') {     // a door to a gallery, anywhere: peek at its pictures. See P17.
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    galMidAt = Date.now();
                    galPeek = true;
                    galMiddle(door, href);
                    return;
                }
            }
            if (e.button !== 0 || (!galWant && !galCur)) return;     // middle and right presses (a tab, the menu) leave it up
            const H = galHole;
            if (H && e.target !== galHost && e.target !== galTopHost && !pointInPreview(e.clientX, e.clientY) && e.clientX >= H.x && e.clientX <= H.x + H.w && e.clientY >= H.y && e.clientY <= H.y + H.h) {
                e.preventDefault();         // the original card: closes, and its link is not followed
                e.stopImmediatePropagation();
                galLeftAt = Date.now();
                galHide('hole');
                return;
            }
            if (e.target === galHost || ours(e.target) || pointInPreview(e.clientX, e.clientY)) return;   // the gallery or the preview
            galHide('press');
        }, true);
        window.addEventListener('keydown', function (e) {
            if (e.key !== 'Control') galInputAt = performance.now();
            if (e.key === 'Escape' && (galEdit || (galMenuEl && !galMenuEl.hidden))) { e.stopImmediatePropagation(); if (galEdit) galEditStop(false); else galMenuHide(); }
            else if (e.key === 'Escape' && galCur && !(view && box && box.classList.contains('on'))) galHide('esc');   // a preview up: Esc closes it first
            if ((e.key === 'PageDown' || e.key === 'PageUp') && galCur && !galEdit && !typingIn(e)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                galFlip(e.key === 'PageDown' ? 1 : -1);
            }
            const step = { ArrowRight: 1, ']': 1, ArrowLeft: -1, '[': -1 }[e.key];      // in a gallery the arrows always step (never pan)
            if (step && galCur && !galEdit && !panelHost && !e.ctrlKey && !e.metaKey && !e.altKey && !typingIn(e)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (!e.repeat || performance.now() - galFlipAt >= GAL_FLIP_MS) { galFlipAt = performance.now(); galStep(step); }
            }
        }, true);
        CAP_TARGET.addEventListener('wheel', galWheel, WHEEL_OPTS);
        window.addEventListener('resize', function () {
            if (galMarksHere()) galMarkSoon();
            if (galWant || galCur) galRefit();
        });
    } else if (String(window.name || '').indexOf(GAL_NAME + ':') === 0) {
        setTimeout(galProbeReport, 0);
    }

    // ---- hosts that pushed back
    //
    // Remembered across sessions, because a 429 is a fact about the site rather than about
    // this page load. The verdict comes from the diagnosis a failed probe already paid for.

    const NORUSH_KEY = 'hoverZoomNoRush';
    let noRushSet = null;
    const LOG_KEY = 'hoverZoomReqLog';
    usLog.init({ load: function () { return GM_getValue(LOG_KEY, ''); }, save: function (s) { GM_setValue(LOG_KEY, s); } });
    const loggedBusy = new Set();    // hosts already logged as refusing on this page

    // A row in the shared request log, honouring the setting as it is now (another tab may have changed it).
    function hzLog(kind, o) {
        usLog.enable(cfg.logRequests !== false);
        usLog.note(kind, o);
    }

    // A refusal: one row per host per page, saying whether that host was already being asked singly.
    function logBusy(url, r) {
        const h = hostOf(url);
        if (!h || loggedBusy.has(h)) return;
        loggedBusy.add(h);
        hzLog('busy', { host: h, out: noRush(h) ? 'slowed' : 'first', status: r.status, signal: 'hard',
            retryAfter: usLog.retryAfterOf(r.headers) });
    }

    function hostOf(url) {
        try { return new URL(url, location.href).hostname.toLowerCase(); } catch (e) { return ''; }
    }

    function noRushHosts() {
        if (noRushSet) return noRushSet;
        noRushSet = new Set();
        try {
            const raw = GM_getValue(NORUSH_KEY, '');
            if (raw) JSON.parse(raw).forEach(function (h) { noRushSet.add(h); });
        } catch (e) { /* nothing stored, or unreadable */ }
        return noRushSet;
    }

    function noRush(h) { return !!h && noRushHosts().has(h); }

    function hardBlock(url, verdict) {
        if (!verdict || verdict.kind !== 'busy') return;
        const h = hostOf(url);
        if (!h || noRush(h)) return;
        noRushHosts().add(h);
        try { GM_setValue(NORUSH_KEY, JSON.stringify(Array.from(noRushHosts()))); }
        catch (e) { /* the list is an optimisation; losing it costs politeness, not correctness */ }
        hzLog('norush', { host: h, out: 'set' });
        plSerial = true;
        dbg('the host asked us to slow down — serial from here', { host: h, status: verdict.status });
    }

    // -------------------------------------------------------------- settings UI

    const C = { base: '#1e1e2e', surface: '#313244', surface2: '#45475a', text: '#cdd6f4',
        sub: '#a6adc8', blue: '#89b4fa', green: '#a6e3a1', red: '#f38ba8', yellow: '#f9e2af' };

    let panelHost = null;
    let panelFlush = null;      // commits an open "edit as text" box, whatever closes the panel
    let panelPos = null;        // where the panel has been dragged to
    let advOpen = false;        // the fold survives the re-render every outside write needs
    let panelOpened = null;     // Undo's snapshot — see openPanel(); MUST outlive a re-render

    // What the user entered per site, not knobs: `Reset to defaults` leaves these alone.
    const RESET_KEEPS = ['siteList', 'blockList', 'referrerSites', 'siteAudio', 'videoDelays', 'avatarAreas', 'ownPlayerAreas', 'linkAreas', 'doorAreas', 'areasAgedOn', 'scrollSites', 'taughtRules'];

    // Open/closed, the fold, scroll and position for this TAB — sessionStorage is per tab and
    // per origin, so it follows a same-site link or a refresh and dies with the tab.
    const PANEL_STATE_KEY = 'hz-panel';

    function savePanelState() {
        if (!isTopFrame) return;
        try {
            sessionStorage.setItem(PANEL_STATE_KEY, JSON.stringify({
                open: !!panelHost, adv: advOpen, scroll: panelScroll(), pos: panelPos,
            }));
        } catch (e) { /* sandboxed or storage-less page; the panel simply starts fresh */ }
    }

    function restorePanelState() {
        if (!isTopFrame) return;
        let s = null;
        try { s = JSON.parse(sessionStorage.getItem(PANEL_STATE_KEY)); } catch (e) { return; }
        if (!s || typeof s !== 'object') return;
        advOpen = !!s.adv;
        if (s.pos && typeof s.pos.left === 'number' && typeof s.pos.top === 'number') panelPos = s.pos;
        if (!s.open) return;
        openPanel();
        const b = panelHost.shadowRoot.querySelector('.body');
        b.scrollTop = +s.scroll || 0;
    }

    function closePanel() {
        if (panelFlush) { panelFlush(); panelFlush = null; }
        if (panelHost) { panelHost.remove(); panelHost = null; }
        savePanelState();
        twRefresh();                // tourButtons may have changed
    }

    // Anything writing cfg from OUTSIDE the panel re-renders it, or it shows stale values.
    function refreshPanel() {
        if (panelHost) openPanel();
    }

    // The manager's menu — a fresh visit, so the fold starts shut and Undo re-arms. `panelPos`
    // is deliberately NOT reset: the window stays where it was last dragged for the life of the tab.
    function showPanel() {
        advOpen = false;
        panelOpened = null;
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
            '.body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px 20px 16px;overscroll-behavior:contain}',
            // The title bar is OUTSIDE the scroller, or it is gone the moment you scroll.
            '.head{flex:none;margin:0;display:flex;align-items:baseline;gap:8px;cursor:move;',
            'padding:10px 20px 9px;font-size:15px;font-weight:600;color:' + C.text + ';',
            'border-bottom:1px solid ' + C.surface + '}',
            '.ver{flex:none;text-align:right;padding:0 20px 8px;font-size:11px;color:' + C.sub + ';background:' + C.base + '}',
            // Every part of the panel that is not text or a control is a handle — see
            // dragBg(). These two rules only make the cursor agree with it; the later,
            // more specific control rules (.row label, input[type=checkbox], …) still win.
            '.panel,.body,.row,.foot,.listwrap,.addrow,.entries,.listbtns,.entry,',
            'details.adv{cursor:move}',
            'h3,p,span,b,.hint,.listdesc,.listhead,.listex,.empty,.intro,.guide{cursor:text}',
            'label,summary,button,select,input,textarea{cursor:auto}',
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
            '.toks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px 6px;margin:8px 0}',
            '.toks button{padding:3px 6px;font:11px ui-monospace,Consolas,monospace;text-align:left;border-radius:4px;' +
            'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.tplex{margin-top:6px;font-size:11px;color:' + C.sub + ';word-break:break-all}',
            '.listwrap + .listwrap{margin-top:18px}',
            '.listhead{font-size:12.5px;font-weight:600;color:' + C.text + ';margin-bottom:3px}',
            '.listdesc{font-size:12px;color:#9399b2;line-height:1.45}',
            '.listex{margin-top:4px;color:#6c7086;font-style:italic}',
            '.addrow{display:flex;gap:6px;margin-top:8px}',
            '.addrow input[type=text]{flex:1;padding:6px 10px;border-radius:6px;font-size:13px}',
            '.addrow input[type=number]{width:84px;padding:6px 8px;border-radius:6px;font-size:13px}',
            '.entry .prov{color:#9399b2;font-size:12px;margin-left:8px;word-break:normal}',
            '.entry span.words{word-break:normal;overflow-wrap:anywhere}',
            '.entry .msval{color:' + C.text + ';cursor:pointer;border-bottom:1px dotted #9399b2}',
            '.entry .msval:hover{border-bottom-color:' + C.text + '}',
            '.entry .msedit{width:70px;padding:1px 4px;font-size:12px}',
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
            const vw = vpW();
            const vh = vpH();
            if (vw && vh) {             // the Browser pane reports 0 while hidden
                const keep = 80;
                panelPos.left = Math.max(keep - panel.offsetWidth, Math.min(panelPos.left, vw - keep));
                panelPos.top = Math.max(0, Math.min(panelPos.top, vh - 34));
            }
            panel.style.left = panelPos.left + 'px';
            panel.style.top = panelPos.top + 'px';
        }

        // Text and controls keep their own press; everything else — padding, gaps, the row
        // background, the panel itself — moves the window. Only the drag path calls
        // preventDefault(), so selecting and copying the text still works normally.
        const TEXTY = 'label,p,summary,h3,span,b,.hint,.listdesc,.listhead,.listex,' +
            '.empty,.intro,.guide,.auto';

        // A press on a scrollbar belongs to the scrollbar. It reports the scrolling element
        // as its target, so without this the body cannot be scrolled by its own bar.
        function onScrollbar(el, e) {
            const r = el.getBoundingClientRect();
            const barW = el.offsetWidth - el.clientWidth;
            const barH = el.offsetHeight - el.clientHeight;
            return (barW > 0 && e.clientX > r.right - barW) ||
                   (barH > 0 && e.clientY > r.bottom - barH);
        }

        function dragBg(e) {
            const t = e.target;
            if (!t || t.nodeType !== 1) return false;
            if (t.closest && t.closest('.head')) return true;       // the title bar, text and all
            if (/^(INPUT|SELECT|TEXTAREA|BUTTON|OPTION)$/.test(t.tagName)) return false;
            if (t.closest && t.closest(TEXTY)) return false;
            if (onScrollbar(t, e)) return false;
            return true;
        }

        function startPanelDrag(e) {
            if (e.button !== 0) return;
            if (!dragBg(e)) return;
            e.preventDefault();
            const r = panel.getBoundingClientRect();
            const ox = e.clientX - r.left, oy = e.clientY - r.top;
            const move = function (ev) {
                const l = ev.clientX - ox, t = ev.clientY - oy;
                // The preview's snapping, so the rules can be tried out here; Ctrl places freely.
                const p = ev.ctrlKey ? { x: l, y: t } : boxSnap(l, t, panel.offsetWidth, panel.offsetHeight);
                panelPos = { left: p.x, top: p.y };
                placePanel();
            };
            const up = function () {
                window.removeEventListener('mousemove', move, true);
                window.removeEventListener('mouseup', up, true);
            };
            window.addEventListener('mousemove', move, true);
            window.addEventListener('mouseup', up, true);
        }

        panel.addEventListener('mousedown', startPanelDrag);

        const h = document.createElement('h2');
        h.className = 'head';
        setTip(h, 'Drag to move');
        h.textContent = 'Hover Zoom — settings';
        panel.appendChild(h);

        const body = document.createElement('div');
        body.className = 'body';
        // The wheel stops at the panel's edge: when nothing inside can scroll further that way,
        // the page underneath must not take it.
        panel.addEventListener('wheel', function (e) {
            const down = e.deltaY > 0;
            for (let n = e.target; n && n !== panel; n = n.parentElement) {
                if (n.scrollHeight > n.clientHeight + 1 &&
                    (down ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0)) return;
            }
            e.preventDefault();
        }, { passive: false });
        panel.appendChild(body);

        // What Undo goes back to: the whole object as it stood when the panel was OPENED — which
        // is why it is module-level and guarded. Captured here, it was re-taken on every
        // re-render, so Reset's own openPanel() call overwrote the snapshot that undoes it.
        if (!panelOpened) panelOpened = JSON.parse(JSON.stringify(cfg));

        // Every control writes as it is changed, so there is no Save to miss and no Cancel to lie.
        function persist() {
            saveSettings();
            probeCache.clear();
            refreshSiteMenu();
            applyLook();                    // a preview that is already up follows along
            if (view && box && box.classList.contains('on')) { reflow(); layout(); showBar(); }
            twRefresh();
        }

        let mount = body;

        // Built-in site rules that keep missing on some image host, under Diagnostics; nothing when all is well.
        function brokenRulesNotice() {
            const list = brokenRules();
            if (!list.length) return;
            const wrap = document.createElement('div');
            wrap.className = 'listwrap';
            const hd = document.createElement('div');
            hd.className = 'listhead';
            hd.textContent = 'Built-in rules that keep missing';
            wrap.appendChild(hd);
            const desc = document.createElement('div');
            desc.className = 'listdesc';
            desc.textContent = 'Hover Zoom knows where some sites keep their full-size pictures. On the sites ' +
                'below, that guess keeps coming back “not found”, so previews there may stay small. A rule ' +
                'that has never worked on a site is skipped there by itself. To fix a site, pin one of its ' +
                'previews and press the magnifier in the status bar to show Hover Zoom where the full-size ' +
                'picture is.';
            wrap.appendChild(desc);
            const entries = document.createElement('div');
            entries.className = 'entries';
            list.forEach(function (b) {
                const en = document.createElement('div');
                en.className = 'entry';
                const t = document.createElement('span');
                t.className = 'words';
                t.textContent = '“' + b.rule + '” on ' + b.host + ' — ' + (b.hits
                    ? 'worked ' + b.hits + ' times, then missed the last ' + b.fails + ' since ' +
                      new Date(b.since).toLocaleDateString() + '. The site may have changed.'
                    : 'has never worked here (' + b.fails + ' misses), so it is skipped here.');
                en.appendChild(t);
                entries.appendChild(en);
            });
            wrap.appendChild(entries);
            const btns = document.createElement('div');
            btns.className = 'listbtns';
            const clear = document.createElement('button');
            clear.textContent = 'Clear';
            setTip(clear, 'Forget these counts; a rule still failing will be listed again');
            clear.addEventListener('click', function () {
                const m = ruleHealth();
                list.forEach(function (b) { delete m[b.rule + '|' + b.host]; });
                saveRuleHealth(m);
                wrap.remove();
            });
            btns.appendChild(clear);
            wrap.appendChild(btns);
            mount.appendChild(wrap);
        }

        // The patterns taught with the bar's magnifier, one entry each, removable.
        function taughtList() {
            const wrap = document.createElement('div');
            wrap.className = 'listwrap';
            const hd = document.createElement('div');
            hd.className = 'listhead';
            hd.textContent = 'Full-size pictures you showed Hover Zoom';
            wrap.appendChild(hd);
            const desc = document.createElement('div');
            desc.className = 'listdesc';
            desc.textContent = 'When a preview stays small, pin it and press the magnifier in its status bar ' +
                'to show where the full-size picture is. Hover Zoom then finds other pictures on that site ' +
                'the same way.';
            wrap.appendChild(desc);
            const entries = document.createElement('div');
            entries.className = 'entries';
            function render() {
                while (entries.firstChild) entries.removeChild(entries.firstChild);
                const all = cfg.taughtRules || {};
                const rows = [];
                Object.keys(all).sort().forEach(function (h) {
                    (all[h] || []).forEach(function (r) { rows.push({ host: h, rule: r }); });
                });
                if (!rows.length) {
                    const empty = document.createElement('div');
                    empty.className = 'empty';
                    empty.textContent = 'None yet.';
                    entries.appendChild(empty);
                    return;
                }
                rows.forEach(function (row) {
                    const en = document.createElement('div');
                    en.className = 'entry';
                    const t = document.createElement('span');
                    t.className = 'words';
                    t.textContent = row.host;
                    const prov = document.createElement('span');
                    prov.className = 'prov';
                    prov.textContent = row.rule.one ? 'one picture only'
                        : '“' + row.rule.ex[0] + '” ' + (row.rule.ex[1] ? 'becomes “' + row.rule.ex[1] + '”' : 'is removed');
                    t.appendChild(prov);
                    const rm = document.createElement('button');
                    rm.textContent = '✕';
                    setTip(rm, 'Forget this one');
                    rm.addEventListener('click', function () {
                        const next = Object.assign({}, cfg.taughtRules);
                        next[row.host] = (next[row.host] || []).filter(function (r) { return r.re !== row.rule.re; });
                        if (!next[row.host].length) delete next[row.host];
                        cfg.taughtRules = next;
                        persist();
                        render();
                    });
                    en.appendChild(t);
                    en.appendChild(rm);
                    entries.appendChild(en);
                });
            }
            render();
            wrap.appendChild(entries);
            mount.appendChild(wrap);
        }

        function section(title) {
            const s = document.createElement('h3');
            s.textContent = title;
            mount.appendChild(s);
        }

        // The fold at the bottom.
        function advanced(title) {
            const d = document.createElement('details');
            d.className = 'adv';
            const sum = document.createElement('summary');
            sum.textContent = title;
            d.appendChild(sum);
            d.open = advOpen;
            d.addEventListener('toggle', function () { advOpen = d.open; savePanelState(); });
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

        // The request log's count and its three ways out: copy with hosts replaced, show as stored, clear.
        // This site's learned door areas, with a way to forget them. See P17.
        function doorRow() {
            const host = pageHost();
            const e = (cfg.doorAreas || {})[host];
            const n = e && e.rules ? e.rules.length : 0;
            const text = document.createElement('span');
            text.className = 'hint';
            text.textContent = n ? 'On ' + host + ', ' + n + (n === 1 ? ' kind' : ' kinds') +
                ' of thumbnail learned as a link to a page of other pictures. They show no preview; a click opens the page.'
                : 'Thumbnails that lead to a page of other pictures (search results, gallery covers) stop previewing ' +
                  'once three of a kind are seen. None learned on ' + (host || 'this site') + ' yet.';
            const r = document.createElement('div');
            r.className = 'row';
            r.appendChild(text);
            if (n) {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = 'Forget';
                b.style.flex = 'none';
                setTip(b, 'Preview these thumbnails again on this site, and start learning afresh');
                b.addEventListener('click', function () {
                    reloadSettings();
                    const all = Object.assign({}, cfg.doorAreas);
                    delete all[host];
                    cfg.doorAreas = all;
                    saveSettings();
                    b.remove();
                    text.textContent = 'Forgotten. Thumbnails on ' + host + ' preview again.';
                    twRecount();
                });
                r.appendChild(b);
            }
            mount.appendChild(r);
        }

        function requestLogRow() {
            const count = document.createElement('span');
            count.className = 'hint';
            const btns = document.createElement('div');
            btns.style.cssText = 'display:flex;gap:6px;flex:none';
            const mk = function (label, tip) {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = label;
                setTip(b, tip);
                btns.appendChild(b);
                return b;
            };
            const copyBtn = mk('Copy for sharing', 'Copy the log with every hostname replaced by site1, site2…');
            const showBtn = mk('Show', 'Show the log here, with the real hostnames');
            const clearBtn = mk('Clear', 'Empty the request log');
            const ta = document.createElement('textarea');
            ta.readOnly = true;
            ta.hidden = true;
            ta.spellcheck = false;
            ta.style.cssText = 'height:160px;font-size:10px;white-space:pre';
            const r = document.createElement('div');
            r.className = 'row';
            r.appendChild(count);
            r.appendChild(btns);
            mount.appendChild(r);
            mount.appendChild(ta);
            function refresh() {
                const s = usLog.stats();
                count.textContent = s.rows + ' logged' + (s.limits ? ' · ' + s.limits + ' refused' : '');
                btns.hidden = !s.rows;
                btns.style.display = s.rows ? 'flex' : 'none';
            }
            function shown(text) { ta.value = text; ta.hidden = false; showBtn.textContent = 'Hide'; }
            function hidden() { ta.value = ''; ta.hidden = true; showBtn.textContent = 'Show'; }
            copyBtn.addEventListener('click', function () {
                const text = usLog.text({ anon: true });
                const done = function () { copyBtn.textContent = 'Copied'; };
                const fallback = function () {
                    shown(text);
                    try { ta.focus(); ta.select(); if (document.execCommand('copy')) done(); } catch (e) { /* left selected */ }
                };
                try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
            });
            showBtn.addEventListener('click', function () { if (ta.hidden) shown(usLog.text()); else hidden(); });
            clearBtn.addEventListener('click', function () { usLog.clear(); hidden(); refresh(); });
            refresh();
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
        // Host -> {ms, rules, samples, fixes, user}: the learned wait for a late player, and the
        // user's own. Adding a host the script already holds replaces its entry.
        function delayList(opts) {
            const wrap = document.createElement('div');
            wrap.className = 'listwrap';

            const hd = document.createElement('div');
            hd.className = 'listhead';
            hd.textContent = opts.heading;
            wrap.appendChild(hd);

            const desc = document.createElement('div');
            desc.className = 'listdesc';
            const descMain = document.createElement('div');
            descMain.textContent = opts.description;
            desc.appendChild(descMain);
            const ex = document.createElement('div');
            ex.className = 'listex';
            ex.textContent = opts.examples;
            desc.appendChild(ex);
            wrap.appendChild(desc);

            const addRow = document.createElement('div');
            addRow.className = 'addrow';
            const input = document.createElement('input');
            input.type = 'text';
            input.spellcheck = false;
            input.placeholder = 'e.g. example.com';
            const ms = document.createElement('input');
            ms.type = 'number';
            ms.min = 0; ms.max = VDELAY_MAX; ms.step = 50;
            ms.placeholder = 'ms';
            setTip(ms, 'Wait in ms; 0 never waits here');
            const addBtn = document.createElement('button');
            addBtn.className = 'primary';
            addBtn.textContent = 'Add';
            const cur = document.createElement('button');
            cur.className = 'add';
            cur.textContent = '+ This site';
            setTip(cur, pageHost());
            addRow.appendChild(input);
            addRow.appendChild(ms);
            addRow.appendChild(addBtn);
            addRow.appendChild(cur);

            const entries = document.createElement('div');
            entries.className = 'entries';

            // The text after the number; the number itself is its own span, so it can be edited.
            function describe(e) {
                if (e.user) return ' — yours';
                if (e.ms == null) return 'learning, ' + (e.samples || []).length + ' of ' + VDELAY_SAMPLES;
                const rules = e.rules || [];
                const paths = [];
                rules.forEach(function (r) { if (paths.indexOf(r.path) === -1) paths.push(r.path); });
                const where = paths.length === 1 && paths[0] === '/' ? 'any page'
                    : paths.slice(0, 2).join(', ') + (paths.length > 2 ? ', …' : '');
                return ' — learned, ' + (rules.length === 1 ? 'one area' : rules.length + ' areas') + ' on ' + where +
                    (e.fixes ? ' · updating, ' + e.fixes.length + ' of ' + VDELAY_SAMPLES + ', no wait meanwhile' : '') +
                    (e.samples && e.samples.length ? ' · another area, ' + e.samples.length + ' of ' + VDELAY_SAMPLES : '');
            }

            // Click the number to change it. A learned entry stays learned: the script goes on
            // adjusting it from there.
            function msField(host, e) {
                const val = document.createElement('span');
                val.className = 'msval';
                val.textContent = (e.ms | 0) + ' ms';
                setTip(val, 'Click to change');
                val.addEventListener('click', function () {
                    const inp = document.createElement('input');
                    inp.type = 'number';
                    inp.min = 0; inp.max = VDELAY_MAX; inp.step = 50;
                    inp.value = e.ms | 0;
                    inp.className = 'msedit';
                    val.replaceWith(inp);
                    inp.focus();
                    inp.select();
                    let done = false;
                    function commit() {
                        if (done) return;
                        done = true;
                        const v = parseInt(inp.value, 10);
                        if (!isNaN(v) && v !== e.ms) {
                            const all = Object.assign({}, cfg.videoDelays);
                            const ne = Object.assign({}, e, { ms: Math.max(0, Math.min(VDELAY_MAX, v)) });
                            delete ne.fixes;
                            all[host] = ne;
                            cfg.videoDelays = all;
                            persist();
                        }
                        render();
                    }
                    inp.addEventListener('keydown', function (ev) {
                        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
                    });
                    inp.addEventListener('blur', commit);
                });
                return val;
            }

            function hosts() {
                return Object.keys(cfg.videoDelays || {}).sort(function (a, b) {
                    return a.localeCompare(b);
                });
            }

            function render() {
                while (entries.firstChild) entries.removeChild(entries.firstChild);
                const keys = hosts();
                if (!keys.length) {
                    const empty = document.createElement('div');
                    empty.className = 'empty';
                    empty.textContent = 'No entries yet.';
                    entries.appendChild(empty);
                    return;
                }
                keys.forEach(function (host) {
                    const e = cfg.videoDelays[host];
                    const r = document.createElement('div');
                    r.className = 'entry';
                    const label = document.createElement('span');
                    label.textContent = host;
                    const prov = document.createElement('span');
                    prov.className = 'prov';
                    if (e.ms != null) prov.appendChild(msField(host, e));
                    prov.appendChild(document.createTextNode(describe(e)));
                    label.appendChild(prov);
                    const rm = document.createElement('button');
                    rm.textContent = '✕';
                    setTip(rm, 'Remove ' + host);
                    rm.addEventListener('click', function () {
                        const all = Object.assign({}, cfg.videoDelays);
                        delete all[host];
                        cfg.videoDelays = all;
                        persist();
                        render();
                    });
                    r.appendChild(label);
                    r.appendChild(rm);
                    entries.appendChild(r);
                });
            }

            // A user's entry also retires every learned one it covers, so the script's cannot win.
            function add(raw) {
                const host = String(raw || '').trim().toLowerCase().replace(/^\*\./, '');
                const v = parseInt(ms.value, 10);
                if (!host || isNaN(v)) { if (host) ms.focus(); return; }
                const all = {};
                Object.keys(cfg.videoDelays || {}).forEach(function (k) {
                    if (!(!cfg.videoDelays[k].user && entryCovers(host, k))) all[k] = cfg.videoDelays[k];
                });
                all[host] = { ms: Math.max(0, Math.min(VDELAY_MAX, v)), user: true };
                cfg.videoDelays = all;
                persist();
                input.value = '';
                ms.value = '';
                render();
            }

            addBtn.addEventListener('click', function () { add(input.value); });
            cur.addEventListener('click', function () { add(pageHost()); });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); add(input.value); }
            });
            ms.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); add(input.value); }
            });

            wrap.appendChild(addRow);
            wrap.appendChild(entries);
            render();
            mount.appendChild(wrap);
        }

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
                    setTip(rm, 'Remove ' + item);
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
                setTip(cur, opts.addCurrentTitle || '');
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
            setTip(editBtn, 'Edit as text');

            function editing() { return !textarea.hidden; }

            function openText() {
                textarea.value = items.join('\n');
                textarea.hidden = false;
                entries.hidden = true;
                addRow.hidden = true;
                editBtn.textContent = 'Done';
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
            // sees "not editing" and re-opens it — Done looks dead.
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
            'Point at an image to see the full-size original. Click to keep it, then wheel to ' +
            'zoom, drag to move, double-click for fullscreen, right-click to save or copy. ' +
            'Escape closes it.';
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
            'Nothing is decided until you point at something. It works from what the page ' +
            'offers — a larger version named in the markup, the thumbnail’s URL with the size ' +
            'stripped out, or the image’s own page on the same site. Every candidate is loaded ' +
            'and measured, so a preview is verified to be larger rather than guessed at. There ' +
            'is no list of supported sites.');
        para('A ring means it is still looking.',
            'The first thing found appears immediately. If something better turns up it ' +
            'replaces it in place, without moving what you are looking at.');
        para('One press keeps it.',
            'A click, or the start of a drag, pins the preview until you press Escape or click ' +
            'outside it. The page underneath stays readable and scrollable. Once pinned, a ' +
            'single click on the image pauses or resumes a clip and a double click fills the ' +
            'screen.');
        para('Moving, sizing and zooming.',
            'Drag the status bar to move the window; drag an edge or corner to resize it, Shift ' +
            'keeps its shape. The wheel grows the window until you have resized it by hand, ' +
            'then zooms the image inside it. Arrow keys pan, + and − zoom, 0 fits. Click the ' +
            'zoom level in the status bar to type one.');
        para('Stepping through a page.',
            'On a pinned preview, ◀ and ▶ — or the arrow keys — move to the next picture on the ' +
            'page without moving the page itself. The window jumps to the bottom-right corner ' +
            'the first time, then stays wherever you put it. Hold an arrow to run through them.');
        para('Saving a copy.',
            'Right-click a pinned preview for the browser’s own menu — Save image as…, Copy ' +
            'image, Copy image address, Open image in new tab — all acting on the full-size ' +
            'original. On a preview you are only hovering, right-click dismisses it instead.');
        para('Something previewing that should not.',
            'Pin it and press ⊘ in its status bar to add it to the never-preview list below. ' +
            'For a whole site, the userscript manager’s menu has an enable/disable entry for the ' +
            'page you are on.');
        para('Clips, and what counts as a video.',
            'A short muted clip already looping with no controls is an animated image whatever ' +
            'it is encoded as, and previews as one — some posts have no still form at all. A ' +
            'real player, or a thumbnail linking to a video page, is a video. A page with a real ' +
            'player never previews on that player, whatever the setting says. Press ▶ in a ' +
            'pinned preview to stop playing video for the rest of the tab.');

        guideBtn.addEventListener('click', function () {
            const open = guide.classList.toggle('open');
            guideBtn.textContent = open ? 'Hide' : 'How it works';
        });
        body.appendChild(guideBtn);
        body.appendChild(guide);

        section('The preview');
        const act = pick('activation', 'Show a preview', ' ', [
                ['hover', 'On hover — the hotkey holds them back'],
                ['modifier', 'Only while the hotkey is held']]);
        pick('modifierKey', 'Hotkey', null, [
            ['ctrl', 'Ctrl'], ['alt', 'Alt'], ['shift', 'Shift']]);
        const hotTog = check('hotkeyToggle', 'Hotkey turns previews off until pressed again',
            'A tap turns previews off in this tab (the widget still works); another turns them on.');
        const actHint = act.row.querySelector('.hint');
        function syncModKey() {
            const show = act.el.value === 'modifier';
            hotTog.row.hidden = show;
            actHint.textContent = show
                ? 'Hold it and point; let go to close. Press twice to pin, once more to close.'
                : 'Hold it to point without previews; press it to close one.';
        }
        act.el.addEventListener('change', syncModKey);
        syncModKey();
        const pos = pick('position', 'Opens', ' ', [
            ['cursor', 'Beside the pointer'], ['under', 'Under the pointer'], ['last', 'Where I last put it']]);
        const posHint = pos.row.querySelector('.hint');
        function syncPos() {
            posHint.textContent = pos.el.value !== 'last'
                ? 'Click the preview to pin it.'
                : 'Centred until you move one. Click the picture to pin, then drag; later ones open there.';
        }
        pos.el.addEventListener('change', syncPos);
        syncPos();
        check('posPerSite', 'Remember positions per site',
            'Each site keeps its own; others use the last one.');
        num('hoverDelay', 'Hover delay',
            'How long the pointer rests on an image before the preview loads, in ms. ' +
            '(default: 120)', 0, 3000, 10);
        check('hoverPreload', 'Load pictures ahead',
            'What is on screen loads when you arrive; the next screen when you hover near the ' +
            'bottom; the whole page once you scroll a few screens down, or scroll after a ' +
            'preview. The slideshow always loads its own.');
        num('zoomLimit', 'Opening zoom limit',
            'How far a small original is enlarged, in multiples of its size. 1 never enlarges; ' +
            'large originals always shrink to fit. (default: 4)', 0.1, 8, 0.1);
        check('sizeGate', 'Only preview when a bigger version exists',
            'Off: every picture previews, enlarged if nothing bigger is found. On: only when the ' +
            'original is at least the ratio below times the size on the page. The slideshow ' +
            'shows every picture either way. (default: off)');
        num('minRatio', 'Minimum size ratio',
            'Used only with the box above. Original ÷ the image on the page. 1 previews anything ' +
            'larger; below 1 previews smaller originals too. (default: 1)', 0.1, 100, 0.1);
        check('bigChip', 'Offer a preview of pictures already shown full size',
            'A picture the page draws as large as a preview would be does not preview. With this on, a ' +
            'button on its corner opens it anyway, so you can zoom in. (default: on)');
        num('minDisplayed', 'Ignore images smaller than',
            'As drawn on the page, in px. Nothing smaller ever previews. (default: 16)', 0, 2000, 1);
        num('smallBelow', 'Small pictures: under',
            'As drawn on the page, in px. Pictures this small are mostly buttons and icons, so ' +
            'they preview only as an avatar or an emoji (the boxes below). (default: 48)', 0, 2000, 1);
        check('smallAvatars', 'Small pictures: avatars',
            'A small, square picture whose original is at least ' + AVATAR_MIN_PX + ' px and ' +
            AVATAR_UPSIZE + ' times its size on the page. Shown beside it, never over it, so it ' +
            'can still be clicked. (default: on)');
        check('smallEmoji', 'Small pictures: emoji',
            'An emoji, known by its alt text, class or host, shows enlarged beside the pointer, ' +
            'and nothing else: no bar, no pinning. Any emoji up to ' + EMOJI_MAX_SHOWN + ' px. (default: on)');
        num('emojiSize', 'Emoji size',
            'In px. (default: 200)', 32, 1000, 1);
        pick('videoMode', 'Play in a preview',
            'A clip is short, muted and looping; a video is anything a thumbnail links to.', [
                ['clips', 'Looping clips only'],
                ['all', 'Clips and videos'],
                ['none', 'Nothing that moves']]);
        check('skipFurniture', 'Ignore backgrounds and banners',
            'Turn off if an image you want is being skipped.');
        num('displayScale', 'Display scaling',
            'If the zoom percentages look wrong, set this to your display’s scaling. (default: 1)',
            1, 4, 0.25);

        section('The slideshow');
        check('tourButtons', 'Show the ◀ ▶ widget',
            '▶ starts at the first picture. Drag to move; Ctrl skips snapping.');
        (function () {
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!cfg.tourFade;
            const pct = document.createElement('input');
            pct.type = 'number';
            pct.min = 0; pct.max = 100; pct.step = 5;
            pct.value = cfg.tourFadeTo;
            setTip(pct, 'Faded opacity, % (default: 35)');
            const pair = document.createElement('span');
            pair.style.cssText = 'display:flex;align-items:center;gap:8px';
            pair.appendChild(pct);
            pair.appendChild(cb);
            function sync() { pct.disabled = !cb.checked; }
            cb.addEventListener('change', function () { cfg.tourFade = cb.checked; sync(); persist(); });
            pct.addEventListener('change', function () {
                const v = parseFloat(pct.value);
                if (!isNaN(v)) { cfg.tourFadeTo = Math.max(0, Math.min(100, v)); persist(); }
                pct.value = cfg.tourFadeTo;
            });
            pct.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); pct.blur(); } });
            sync();
            row('Fade the widget', 'Until the pointer nears it; the number is opacity, in %. (default: on, 35)', pair);
        })();
        check('tourKeys', 'Arrow keys step through the page',
            'Unless zoomed in enough to pan. [ ] always step; { } narrow or widen the area.');
        check('tourKeyStart', '→ or ← with nothing open starts the slideshow',
            'Like ▶ and ◀ on the widget, unless the page uses the arrows.');
        num('tourMinDisplayed', 'Leave out pictures smaller than',
            'Longer side, in px; starting on a smaller one lowers it. (default: 128)',
            0, 1000, 8);
        check('tourLoadMore', 'Let a scrolling page load more',
            'Scrolls the page ahead of the slideshow. Only on sites listed under Per-site fixes.');
        check('tourCrossPage', 'Carry on onto the next page',
            'Fetches the next page in the background; you stay on this one.');
        check('tourSkipDupes', 'Skip duplicate pictures',
            'Shows each picture once, even when it was uploaded twice under different addresses. The first copy stays.');

        section('Saving');
        const conv = pick('saveConvert', 'Convert when saving',
            'Middle-click on a preview saves its picture. The file’s real format decides, not its name. ' +
            'Animated pictures are always saved as they are.', [
                ['off', 'Never: save as the site serves it'], ['png', 'To PNG (lossless, large)'],
                ['jpg', 'To JPEG'], ['webp', 'To WebP']]);
        const convFrom = pick('saveConvertFrom', 'Which pictures', null, [
            ['avif', 'AVIF only'], ['modern', 'AVIF, WebP and JPEG XL']]);
        const convQ = num('saveJpegQuality', 'JPEG / WebP quality', 'In %. (default: 92)', 10, 100, 1);
        function syncConvert() {
            const v = conv.el.value;
            convFrom.row.hidden = v === 'off';
            convQ.row.hidden = v === 'off' || v === 'png';
        }
        conv.el.addEventListener('change', syncConvert);
        syncConvert();
        const ren = pick('saveRename', 'Rename saved pictures',
            'Meaningless names are ones like 0001.jpg, 12.png or image.jpg, which pile up as 0001 (1).jpg, 0001 (2).jpg.', [
                ['meaningless', 'Only meaningless names'], ['always', 'Always'], ['off', 'Never']]);
        const tplWrap = document.createElement('div');
        tplWrap.className = 'listwrap';
        const tplHead = document.createElement('div');
        tplHead.className = 'listhead';
        tplHead.textContent = 'File name';
        const tplDesc = document.createElement('div');
        tplDesc.className = 'listdesc';
        tplDesc.textContent = 'Type the name with these terms in it; click one to insert it. ### is a counter, as many digits ' +
            'as there are #. The extension is added. A term with nothing to fill it is dropped with its brackets.';
        const toks = document.createElement('div');
        toks.className = 'toks';
        const tplIn = document.createElement('input');
        tplIn.type = 'text';
        tplIn.value = cfg.saveNameTemplate;
        tplIn.spellcheck = false;
        tplIn.style.cssText = 'width:100%;box-sizing:border-box;padding:6px 10px;font-size:13px';
        [['[site]', 'The site’s name, e.g. Wikipedia'], ['[page_title]', 'The page title without the site’s name'],
            ['[full_title]', 'The page title as the page has it'], ['[host]', 'e.g. en.wikipedia.org'],
            ['[page_id]', 'The longest number in the page address, else a 5-character code'],
            ['[orig_name]', 'The file’s own name, e.g. 0001'], ['[num]', 'The last number in the file’s own name'],
            ['###', 'A counter: 001, 002 … per name'],
            ['[date]', '2026-11-10'], ['[time]', '163347'], ['[year]', '2026'], ['[month]', '11'],
            ['[day]', '10'], ['[hh]', 'Hour, 16'], ['[mm]', 'Minute, 33'], ['[ss]', 'Second, 47']].forEach(function (t) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = t[0];
            setTip(b, t[1]);
            b.addEventListener('click', function () {
                const a = tplIn.selectionStart == null ? tplIn.value.length : tplIn.selectionStart;
                const z = tplIn.selectionEnd == null ? a : tplIn.selectionEnd;
                tplIn.value = tplIn.value.slice(0, a) + t[0] + tplIn.value.slice(z);
                tplIn.focus();
                tplIn.setSelectionRange(a + t[0].length, a + t[0].length);
                tplIn.dispatchEvent(new Event('change'));
            });
            toks.appendChild(b);
        });
        const tplEx = document.createElement('div');
        tplEx.className = 'tplex';
        tplWrap.appendChild(tplHead);
        tplWrap.appendChild(tplDesc);
        tplWrap.appendChild(toks);
        tplWrap.appendChild(tplIn);
        tplWrap.appendChild(tplEx);
        mount.appendChild(tplWrap);
        function syncTpl() {
            const v = tplIn.value.trim() || DEFAULTS.saveNameTemplate;
            const page = location.href.split('#')[0], tp = titleParts(document.title, siteNameOf(document), location.hostname.replace(/^www\./, ''));
            const ex = fillNameTemplate(v, { site: tp.site, title: tp.title, full: tp.full, host: location.hostname.replace(/^www\./, ''),
                pageId: pageIdOf(page), name: '0001', num: '0001' }).replace(/#+/, function (h) { return '1'.padStart(h.length, '0'); }).replace(/#+/g, '');
            tplEx.textContent = 'On this page, 0001.jpg would save as: ' + (ex || '0001') + '.jpg';
            tplWrap.hidden = ren.el.value === 'off';
        }
        tplIn.addEventListener('input', syncTpl);
        tplIn.addEventListener('change', function () { cfg.saveNameTemplate = tplIn.value.trim() || DEFAULTS.saveNameTemplate; if (!tplIn.value.trim()) tplIn.value = cfg.saveNameTemplate; persist(); syncTpl(); });
        tplIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tplIn.blur(); } });
        ren.el.addEventListener('change', syncTpl);
        syncTpl();

        section('Where it runs');
        pick('siteMode', 'Site list', null, [
            ['blacklist', 'Disable on listed sites'], ['whitelist', 'Enable only on listed sites']]);

        const sites = list('siteList', {
            description: 'example.com also covers www.example.com. example.com/gallery covers that page and every page under it. To match only one page, put it in quotes: "example.com/home?sort=new" matches that page with those settings, not the rest of the site. A trailing * matches any path starting with it.',
            examples: 'Examples: example.com, example.com/gallery, "example.com/" (the front page only), "example.com/home?sort=new&t=week"',
            placeholder: 'e.g. example.com',
            addCurrentLabel: '+ This site',
            addCurrentTitle: pageHost(),
            currentValue: function () { return pageHost(); },
        });

        section('Exceptions');
        const blocks = list('blockList', {
            heading: 'Never preview these images',
            chronological: true,
            description: 'Add one with ⊘ on a pinned preview; newest last. * matches anything.',
            examples: 'Examples: https://example.com/tile.png, https://cdn.example.com/wm/*',
            placeholder: 'e.g. https://example.com/watermark.png',
        });

        advanced('Advanced options');

        section('The slideshow');
        num('preloadAhead', 'Pictures to load ahead',
            'How far each way from where you are the slideshow loads. 0 loads all of it, so ' +
            'nothing waits later. Lower it to save data on a metered connection; the browser\'s ' +
            'data saver lowers it to 12 by itself. (default: 0)', 0, 1000, 1);
        num('preloadMB', 'Memory for loaded pictures',
            'In MB. Loaded pictures are held up to this much so they never download again. Lower ' +
            'it on a computer with little memory. 0 picks it from the computer\'s memory where ' +
            'the browser says (1/8 of it, at most 1024), else 1024. (default: 0)', 0, 16384, 64);
        num('tourWorkers', 'Loaded at once',
            'How many are fetched in parallel. This is what sets the rate. Measured at about ' +
            '5 pictures a second at 6. (default: 6)', 1, 12, 1);
        num('tourHoldRate', 'Hold speed limit',
            'Pictures per second while an arrow key or ◀ ▶ is held down; the picture loads when ' +
            'you let go. 0 is no limit: as fast as the key repeats. (default: 0)', 0, 60, 1);
        num('wheelRange', 'Wheel button reach',
            'The wheel steps the slideshow while the pointer is within this many px of the wheel ' +
            'button. Click the button to make it step anywhere. (default: 65)', 0, 500, 1);

        section('The preview window');
        num('wheelZoomStep', 'Wheel zoom step',
            'Per wheel notch, in %. The + and − keys step 25%. (default: 15)', 2, 100, 1);
        num('panStep', 'Arrow-key pan step',
            'Per press, in px; Shift triples it. (default: 80)', 5, 500, 5);
        num('maxZoom', 'Maximum zoom',
            'In multiples of the original’s size. (default: 32)', 1, 64, 1);
        num('maxSizeMultiple', 'Maximum window size',
            'In multiples of the browser window. A preview never opens larger than the browser ' +
            'window. (default: 1.2)', 1, 4, 0.25);

        section('Appearance');
        num('fadeMs', 'Preview fade', 'In and out, in ms. (default: 200)', 0, 1000, 10);
        num('borderWidth', 'Border thickness', 'In px; 0 for none. (default: 1)', 0, 20, 1);
        color('borderColor', 'Border colour');
        num('cornerRadius', 'Corner radius', 'In px. (default: 6)', 0, 40, 1);
        const bar = pick('barMode', 'Status bar', 'Filename, size, zoom and the buttons.', [
            ['always', 'Always shown'],
            ['hover', 'Shown while the pointer is on the preview'],
            ['off', 'Hidden']]);
        const barIdle = num('barIdleMs', 'Status bar fade delay',
            'After the pointer leaves the preview, in ms. (default: 250)', 0, 60000, 50);
        const barTake = num('barFadeMs', 'Status bar fade duration',
            'Out and back in, in ms. (default: 250)', 0, 10000, 50);
        function syncFurniture() {
            const fades = bar.el.value === 'hover';
            barIdle.row.hidden = !fades;
            barTake.row.hidden = !fades;
        }
        bar.el.addEventListener('change', syncFurniture);
        syncFurniture();
        const shadow = check('shadow', 'Drop shadow',
            'Separates the preview from the page behind it.');
        const shadowSize = num('shadowSize', 'Shadow size',
            'Blur, in px. (default: 24)', 0, 120, 4);
        const shadowStrength = num('shadowStrength', 'Shadow strength',
            'Darkness, in %. (default: 50)', 0, 100, 5);
        function syncShadow() {
            shadowSize.row.hidden = !shadow.el.checked;
            shadowStrength.row.hidden = !shadow.el.checked;
        }
        shadow.el.addEventListener('change', syncShadow);
        syncShadow();
        pick('spinnerTheme', 'Loading ring',
            'Match uses the system’s light/dark setting, not the browser’s.', [
                ['auto', 'Match the system'], ['dark', 'Always dark'], ['light', 'Always light']]);
        section('Diagnostics');
        check('debug', 'Log every hover to the console',
            'One line per hover in the console (F12). Leave off unless chasing a problem.');
        check('showPostEnd', 'Draw where the slideshow stops',
            'A red line where the post ends (its replies or comments are left out; dashed at the top when ' +
            'the page has replies but no post), an orange one where each sidebar begins. What was found is ' +
            'logged to the console (F12): page structure and sizes only, no addresses or text.');
        const reqLog = check('logRequests', 'Keep a request log',
            'Each time a site refuses a picture for being asked too fast, and whether it was already being asked ' +
            'one at a time. Hostnames only — no addresses, pages or pictures.');
        reqLog.el.addEventListener('change', function () { usLog.enable(reqLog.el.checked); });
        requestLogRow();
        brokenRulesNotice();

        section('Per-site fixes');
        taughtList();
        const refSites = list('referrerSites', {
            heading: 'Load previews without a referrer on these sites',
            description: 'For a site whose previews come up blank or say “no hotlinking”.',
            examples: 'example.com also covers www.example.com',
            placeholder: 'e.g. example.com',
            addCurrentLabel: '+ This site',
            addCurrentTitle: pageHost(),
            currentValue: function () { return pageHost(); },
        });
        delayList({
            heading: 'Wait for the page’s own video preview on these sites',
            description: 'For sites whose own video covers a preview. Learned and measured; add ' +
                'one to set the wait by hand, 0 ms to stop learning it.',
            examples: 'example.com also covers www.example.com. Adding a site again replaces its entry.',
        });
        doorRow();
        list('scrollSites', {
            heading: 'Scroll the page along with the slideshow on these sites',
            description: 'Learned when your scrolling raises the widget’s count; dropped after ' +
                GROWS_FORGET + ' loads that find nothing more.',
            examples: 'example.com also covers www.example.com',
            placeholder: 'e.g. example.com',
            addCurrentLabel: '+ This site',
            addCurrentTitle: pageHost(),
            currentValue: function () { return pageHost(); },
        });

        section('Galleries');
        check('galleryMiddle', 'Middle-click opens a gallery',
            'Off: middle-click opens the link in a new tab as usual, and clicking the ▦ chip on a result opens its gallery.');
        check('galleryChips', 'Show the ▦ chip on every gallery',
            'Off: the chip shows only on the thumbnail under the pointer.').el.addEventListener('change', galMarkSoon);
        check('galleryTicks', 'Tick results whose gallery was seen',
            'One green tick for a gallery you looked at, two for a page you opened.').el.addEventListener('change', galMarkSoon);
        check('gallerySavedMarks', 'Mark results something was saved from',
            'A blue disc on the result, and on each saved picture in its gallery.').el.addEventListener('change', galMarkSoon);
        check('galleryPreload', 'Read the galleries on screen ahead of a click',
            'One at a time, nearest the pointer first, so a gallery opens at once. Stops on this page if the site refuses a request.').el.addEventListener('change', galMarkSoon);
        num('galleryRowMin', 'Smallest gallery row',
            'In px. Rows grow to fill the window but never get shorter than this; a gallery that would need shorter rows is split into pages. (default: 120)', 48, 2000, 1)
            .el.addEventListener('change', function () { if (galCur) galRefit(); });
        const foot = document.createElement('div');
        foot.className = 'foot';

        const auto = document.createElement('span');
        auto.className = 'auto';
        auto.textContent = 'Changes save as you make them.';

        const reset = document.createElement('button');
        reset.className = 'danger';
        reset.textContent = 'Reset to defaults';
        setTip(reset, 'Every option to its default; lists kept');
        reset.addEventListener('click', function () {
            const kept = {};
            RESET_KEEPS.forEach(function (k) { kept[k] = cfg[k]; });
            cfg = Object.assign({}, DEFAULTS, kept);
            cfg.blockList = withDefaultBlocks(cfg.blockList || []);
            saveSettings();
            probeCache.clear();
            refreshSiteMenu();
            openPanel();
        });

        // Back to the values this panel opened on, whatever has been saved since.
        const undo = document.createElement('button');
        undo.textContent = 'Undo changes';
        setTip(undo, 'Back to when this window opened');
        undo.addEventListener('click', function () {
            cfg = JSON.parse(JSON.stringify(panelOpened));
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
        const ver = document.createElement('div');
        ver.className = 'ver';
        ver.textContent = version();
        panel.appendChild(ver);

        (document.body || document.documentElement).appendChild(panelHost);

        if (!panelPos) {                    // first open in this tab: centred
            const vw = vpW() || 1024;
            const vh = vpH() || 768;
            panelPos = {
                left: Math.max(12, Math.round((vw - panel.offsetWidth) / 2)),
                top: Math.max(12, Math.round((vh - panel.offsetHeight) / 2)),
            };
        }
        placePanel();
        body.scrollTop = keepScroll;
        savePanelState();
    }

    if (isTopFrame) setTimeout(areaAgeAll, 0);

    if (isTopFrame && typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Hover Zoom settings', showPanel);
        refreshSiteMenu();
    }

    // Scroll and drag are not written as they happen; the snapshot at unload carries them.
    window.addEventListener('pagehide', savePanelState);
    restorePanelState();

    dbg('loaded', {
        version: version(),
        url: location.href,
        topFrame: isTopFrame,
        siteEnabled: siteEnabled(),
        captcha: CAPTCHA_HERE,
        videoMode: cfg.videoMode,
        playVideos: playVideos,
        skipFurniture: cfg.skipFurniture,
        blockList: cfg.blockList.length,
        lateWait: (function () { const w = vdEntryFor(pageHost()); return w ? (w.ms == null ? 'learning' : w.ms + ' ms') : 'none'; })(),
        sizeGate: cfg.sizeGate,
        minRatio: cfg.minRatio,
        minDisplayed: cfg.minDisplayed,
    });
})();
