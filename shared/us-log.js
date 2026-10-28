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
