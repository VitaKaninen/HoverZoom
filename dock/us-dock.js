// ==== us-dock begin ====
// Shared verbatim by Hover Zoom, Forum Stumbler and RNFP. Edit HoverZoom/dock/us-dock.js, then run
// `node dock/sync-dock.js` from HoverZoom. The design is HoverZoom/docs/WIDGET-DOCK.md.
const usDock = (function () {
    const SNAP = 8;                 // px: window edges, the window's centre, other widgets
    const TOUCH = 1;                // px: how close two edges must be to count as attached at a drop
    const PASSES = 4;               // overlap sweeps; three widgets settle in two
    const A_ID = 'data-us-dock', A_SPEC = 'data-us-dock-a', A_SIZE = 'data-us-dock-s',
        A_GREW = 'data-us-dock-t', A_DRAG = 'data-us-dock-d', A_STRETCH = 'data-us-dock-st';
    const WATCHED = [A_ID, A_SPEC, A_SIZE, A_GREW, A_DRAG, A_STRETCH, 'hidden'];
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

    // The layout viewport, scrollbars excluded; <body> answers for it on a quirks-mode page.
    function viewport() {
        const el = (document.compatMode === 'BackCompat' && document.body) || document.documentElement;
        return { w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight };
    }

    function pt(lo, len, k) { return k === 's' ? lo : k === 'e' ? lo + len : lo + len / 2; }

    // Which third the widget is in, measured from the point its current anchor holds. See WIDGET-DOCK.md.
    function zone(prev, lo, len, V) {
        const p = pt(lo, len, prev || 'c');
        return p < V / 3 ? 's' : p > V * 2 / 3 ? 'e' : 'c';
    }

    function winAxis(k, lo, len, V) { return { r: 'win', m: k, t: k, o: pt(lo, len, k) - pt(0, V, k) }; }

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
                minH: st ? st[0] : null });
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
            d.out = { x: Math.round(d.pos.x), y: Math.round(d.pos.y), w: d.w, h: Math.round(d.h) };
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
            if (w.o.apply) { w.o.apply(d.out); return; }
            setPx(w.el, 'left', d.out.x);
            setPx(w.el, 'top', d.out.y);
            if (w.el.style.right !== 'auto') w.el.style.right = 'auto';
            if (w.el.style.bottom !== 'auto') w.el.style.bottom = 'auto';
        });
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

    // Snap a dragged rect to the window's edges and centre, and to other widgets' edges.
    function snap(x, y, w, h, V, others) {
        let bx = null, by = null;
        function tx(v) { const d = Math.abs(v - x); if (d <= SNAP && (!bx || d < bx.d)) bx = { d: d, v: v }; }
        function ty(v) { const d = Math.abs(v - y); if (d <= SNAP && (!by || d < by.d)) by = { d: d, v: v }; }
        tx(0); tx(V.w - w); tx((V.w - w) / 2);
        ty(0); ty(V.h - h); ty((V.h - h) / 2);
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
                const o = pt(lo, len, k) - pt(rlo, rlen, k);
                if (!best || Math.abs(o) < Math.abs(best.o)) best = { r: r.id, m: k, t: k, o: o };
            });
            return best;
        }
        for (const r of others) {
            const xo = rc.x < r.right - TOUCH && rc.x + rc.w > r.left + TOUCH;
            const yo = rc.y < r.bottom - TOUCH && rc.y + rc.h > r.top + TOUCH;
            if (xo && Math.abs(rc.y + rc.h - r.top) <= TOUCH) y = { r: r.id, m: 'e', t: 's', o: rc.y + rc.h - r.top };
            else if (xo && Math.abs(rc.y - r.bottom) <= TOUCH) y = { r: r.id, m: 's', t: 'e', o: rc.y - r.bottom };
            else if (yo && Math.abs(rc.x + rc.w - r.left) <= TOUCH) x = { r: r.id, m: 'e', t: 's', o: rc.x + rc.w - r.left };
            else if (yo && Math.abs(rc.x - r.right) <= TOUCH) x = { r: r.id, m: 's', t: 'e', o: rc.x - r.right };
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
    //      stretchMin() -> px|null, apply(rect), handle(target) -> may a press here drag, onDrag(on) }
    function create(o) {
        const el = o.el;
        const w = { o: o, el: el, spec: null, dragging: false, size: null };
        mine.push(w);

        function setSpec(spec) {
            w.spec = cleanSpec(spec) || cleanSpec(o.initial());
            el.setAttribute(A_SPEC, JSON.stringify(w.spec));
        }

        function measure() {
            const s = o.size ? o.size() : [el.offsetWidth, el.offsetHeight];
            return [Math.round(s[0]), Math.round(s[1])];
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
        setSpec(o.load());
        sizeChanged();
        if (window.ResizeObserver) new ResizeObserver(sizeChanged).observe(el);

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
                el.setAttribute(A_DRAG, Math.round(x) + ' ' + Math.round(y));
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
                if (el.hidden === !on) return;
                el.hidden = !on;
                if (on) { w.size = null; sizeChanged(); }
                schedule();
            },
            reload: function () { setSpec(o.load()); schedule(); },
        };
    }

    return { create: create, solve: solve, makeSpec: makeSpec, snap: snap, zone: zone, SNAP: SNAP };
})();
// ==== us-dock end ====
