// node shared/test-log.js — the shared request log: what a read records, re-read on write,
// eviction, cut reads, Retry-After, and that nothing identifying survives the export.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'us-log.js'), 'utf8');
const fresh = () => new Function(SRC + '\nreturn usLog;')();

let pass = 0, fail = 0;
function eq(got, want, what) {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log('FAIL ' + what + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}
const ok = (c, what) => eq(!!c, true, what);

// A fake store and clock, so every number below is exact.
function rig(opts) {
    const box = { s: '' };
    let t = 1000000;
    const lg = fresh().init(Object.assign({
        load: () => box.s, save: (s) => { box.s = s; }, now: () => t
    }, opts || {}));
    return { lg, box, tick: (ms) => { t += ms; }, at: () => t, data: () => JSON.parse(box.s) };
}

// ---- off means nothing
{
    const r = rig({ on: false });
    eq(r.lg.start('range', { host: 'a.com' }), null, 'off: start returns null');
    r.lg.note('norush', { host: 'a.com', out: 'set', status: 429 });
    eq(r.box.s, '', 'off: nothing written');
    const noStore = fresh();
    eq(noStore.start('range', { host: 'a.com' }), null, 'no storage: start returns null');
}

// ---- one read: counts, spacing measured from the stamped starts, pages
{
    const r = rig();
    const h = r.lg.start('range', { host: 'Forum.Example', pace: 'w6 g300-800' });
    const q1 = h.req(); r.tick(300);
    const q2 = h.req(); r.tick(700);
    const q3 = h.req(); r.tick(100);
    const q4 = h.req(); r.tick(50);
    q1.done({ status: 200, topics: 20 });
    q3.done({ status: 200, topics: 0 });
    q2.done({ status: 200, topics: 18 });
    q2.done({ status: 200, topics: 18 });
    q4.done({ status: 404 });
    h.end('done');
    const row = r.data().rows[0];
    eq([row.n, row.ok, row.pg], [4, 3, 2], 'requests, ok, pages with topics; a second done() is ignored');
    eq(row.sp, [100, 300, 700], 'spacing min/med/max from request starts, gaps out of order');
    eq(row.ms, 1150, 'elapsed');
    eq(row.h, 'forum.example', 'host lowercased');
    eq(row.since, null, 'first read on a host has no previous');
    eq(row.out, 'done', 'outcome');
}

// ---- a limit event: which request, status, signal, Retry-After, when
{
    const r = rig();
    const h = r.lg.start('range', { host: 'a.com', slowed: true });
    for (let i = 0; i < 4; i++) { h.req().done({ status: 200, topics: 5 }); r.tick(400); }
    const q = h.req(); r.tick(150);
    q.done({ status: 429, limited: true, signal: 'hard', retryAfter: 60 });
    h.end('limited');
    const row = r.data().rows[0];
    eq(row.ev, [{ a: 5, s: 429, w: 'hard', ra: 60, dt: 1750 }], 'limit event on the 5th request');
    eq(row.ok, 4, 'the refused request is not counted ok');
    eq(row.nr, 1, 'slowed flag recorded');
    eq(r.data().hosts['a.com'].limits, 1, 'host summary counts the limit');
    eq(r.lg.stats(), { rows: 1, limits: 1 }, 'stats: rows and limit events');
    ok(/@5 429 hard ra60 \+1\.8s/.test(r.lg.text()), 'event text');
}

// ---- since: the gap from the previous read's END on that host — the refresh case
{
    const r = rig();
    const a = r.lg.start('range', { host: 'a.com' }); a.req(); r.tick(18000); a.end('done');
    r.tick(61000);
    const b = r.lg.start('range', { host: 'a.com' }); b.req(); b.end('done');
    const c = r.lg.start('range', { host: 'b.com' }); c.req(); c.end('done');
    const rows = r.data().rows;
    eq(rows[1].since, 61000, 'second read on a host: ms since the first one ended');
    eq(rows[2].since, null, 'another host has its own previous');
    ok(/prev 61s/.test(r.lg.text()), 'since in the text');
}

// ---- end() re-reads the store: a row written by another tab meanwhile survives
{
    const r = rig();
    const h = r.lg.start('range', { host: 'a.com' }); h.req();
    const o = fresh().init({ load: () => r.box.s, save: (s) => { r.box.s = s; }, now: () => r.at() });
    const x = o.start('chain', { host: 'b.com' }); x.req(); x.end('done');
    h.end('done');
    eq(r.data().rows.map(w => w.h), ['b.com', 'a.com'], "another tab's row is kept");
    eq(Object.keys(r.data().hosts).sort(), ['a.com', 'b.com'], 'both hosts summarised');
}

// ---- eviction from the front; the host summary outlives it
{
    const r = rig({ max: 10 });
    for (let i = 0; i < 25; i++) { const h = r.lg.start('k' + i, { host: 'a.com' }); h.req(); h.end('done'); }
    const d = r.data();
    eq(d.rows.length, 10, 'capped');
    eq(d.rows[0].k, 'k15', 'oldest dropped first');
    eq(d.hosts['a.com'].reads, 25, 'summary counts every read ever');
}

// ---- cut: a read the page never finished is still written, once
{
    const r = rig();
    const h = r.lg.start('range', { host: 'a.com' }); h.req(); h.req();
    const g = r.lg.start('tail', { host: 'a.com' }); g.req(); g.end('done');
    r.lg.cutOpen();
    r.lg.cutOpen();
    h.end('done');
    const rows = r.data().rows;
    eq(rows.map(w => w.out), ['done', 'cut'], 'open read cut once; finished one untouched; late end ignored');
    eq(rows[1].n, 2, 'the cut read keeps the requests it made');
}

// ---- Retry-After, both legal forms
{
    const r = rig();
    eq(r.lg.retryAfterOf('Content-Type: text/html\r\nRetry-After: 120\r\n'), 120, 'seconds');
    eq(r.lg.retryAfterOf('retry-after:7'), 7, 'case and spacing');
    eq(r.lg.retryAfterOf('x-retry-after: 9\nfoo: bar'), null, 'another header ending in the name');
    eq(r.lg.retryAfterOf('Content-Type: text/html'), null, 'absent');
    const when = new Date(r.at() + 90000).toUTCString();
    eq(r.lg.retryAfterOf('Retry-After: ' + when), 90, 'HTTP date');
    eq(r.lg.retryAfterSecs('garbage'), null, 'unparseable');
}

// ---- note: a host demoted or put back
{
    const r = rig();
    r.lg.note('norush', { host: 'a.com', out: 'set', status: 429, signal: 'hard' });
    r.lg.note('norush', { host: 'a.com', out: 'clear' });
    const rows = r.data().rows;
    eq(rows.map(w => w.out), ['set', 'clear'], 'note outcomes');
    eq(rows[0].ev[0].s, 429, 'note carries the status');
    eq(r.data().hosts['a.com'].limits, 1, 'only the note with a status counts as a limit');
}

// ---- privacy: nothing identifying gets in, and the anonymised export has no hostname
{
    const r = rig();
    const h = r.lg.start('range/secretkind', {
        host: 'https://user:pw@forum.example:8080/secretpath/thread-name?q=secretquery#frag',
        pace: 'w6 https://forum.example/secretpace'
    });
    h.req().done({ status: 429, limited: true, signal: 'hard/secretsig' });
    h.end('limited?secretout');
    r.lg.note('norush', { host: 'other.example/secretnote', out: 'set' });
    const stored = r.box.s;
    for (const w of ['secret', 'thread-name', 'user', 'pw@', '://', 'frag'])
        ok(!stored.includes(w), 'stored log has no "' + w + '"');
    eq(r.data().rows[0].h, 'forum.example:8080', 'a whole URL is reduced to its host');
    const anon = r.lg.text({ anon: true });
    ok(!anon.includes('forum.example') && !anon.includes('other.example'), 'anonymised export has no hostname');
    ok(anon.includes('site1') && anon.includes('site2'), 'hosts become site1, site2');
    ok(r.lg.text().includes('forum.example'), 'the raw export keeps the hostname');
}

// ---- a corrupt or foreign store is replaced, never thrown on
{
    for (const junk of ['{', '[]', '{"v":99,"rows":[]}', 'null', '{"v":1,"rows":"x","hosts":{}}', '{"v":1,"rows":[]}']) {
        const box = { s: junk };
        let n = -1;
        try {
            const lg = fresh().init({ load: () => box.s, save: (s) => { box.s = s; } });
            const h = lg.start('range', { host: 'a.com' }); h.req(); h.end('done');
            n = JSON.parse(box.s).rows.length;
        } catch (_) {}
        eq(n, 1, 'recovers from ' + junk);
    }
    let survived = false;
    try {
        const lg = fresh().init({ load: () => { throw new Error('x'); }, save: () => { throw new Error('y'); } });
        const h = lg.start('range', { host: 'a.com' }); h.req(); h.end('done');
        survived = lg.count() === 0 && lg.text().includes('0 rows');
    } catch (_) {}
    ok(survived, 'a throwing store is survived');
}

// ---- times are UTC and say so, whatever the browser's zone
{
    const r = rig();
    r.tick(Date.UTC(2026, 9, 28, 15, 4, 5) - r.at());
    const h = r.lg.start('range', { host: 'a.com' }); h.req(); h.end('done');
    const t = r.lg.text();
    ok(t.includes('\n2026-10-28 15:04:05  a.com'), 'row time is UTC');
    ok(t.includes('when (UTC)'), 'the header says so');
}

// ---- clear
{
    const r = rig();
    const h = r.lg.start('range', { host: 'a.com' }); h.req(); h.end('done');
    r.lg.clear();
    eq([r.lg.count(), Object.keys(r.data().hosts).length], [0, 0], 'clear empties rows and summary');
}

// ---- Hover Zoom's wiring: its own hzLog / logBusy, pulled out of the script by name and run
// against the real module. The browser cannot show this while its pane is hidden (HZ's hover
// needs frames), so this is where the setting gate and the before-hardBlock order are held.
{
    const HZ = fs.readFileSync(path.join(__dirname, '..', 'Hover-Zoom.user.js'), 'utf8');
    const grabFn = (name) => {
        const at = HZ.indexOf('    function ' + name + '(');
        if (at < 0) throw new Error('not found in Hover-Zoom.user.js: ' + name);
        let depth = 0;
        for (let j = HZ.indexOf('{', at); j < HZ.length; j++) {
            if (HZ[j] === '{') depth++;
            else if (HZ[j] === '}' && !--depth) return HZ.slice(at, j + 1);
        }
        throw new Error('unbalanced: ' + name);
    };
    const wire = (cfg, slowed) => {
        const box = { s: '' };
        const lg = fresh().init({ load: () => box.s, save: (s) => { box.s = s; } });
        const fn = new Function('usLog', 'cfg', 'noRush',
            'const hostOf = (u) => new URL(u, "https://page.example/").hostname;\n'
            + 'const loggedBusy = new Set();\n'
            + grabFn('hzLog') + '\n' + grabFn('logBusy') + '\nreturn { hzLog, logBusy };');
        return { box, w: fn(lg, cfg, (h) => slowed.has(h)), rows: () => (box.s ? JSON.parse(box.s).rows : []) };
    };
    const refused = { status: 429, headers: 'Content-Type: text/plain\r\nRetry-After: 120' };

    let t = wire({ logRequests: true }, new Set());
    t.w.logBusy('https://cdn.example/a.jpg', refused);
    eq(t.rows().map(r => [r.k, r.h, r.out, r.ev[0].s, r.ev[0].ra]), [['busy', 'cdn.example', 'first', 429, 120]], 'hz: a refusal is logged with status and Retry-After');
    t.w.logBusy('https://cdn.example/b.jpg', refused);
    eq(t.rows().length, 1, 'hz: one row per host per page');
    t.w.logBusy('https://other.example/c.jpg', refused);
    eq(t.rows().length, 2, 'hz: another host gets its own');
    ok(!t.box.s.includes('a.jpg') && !t.box.s.includes('/c.jpg'), 'hz: the picture address is not stored');

    t = wire({ logRequests: true }, new Set(['cdn.example']));
    t.w.logBusy('https://cdn.example/a.jpg', refused);
    eq(t.rows()[0].out, 'slowed', 'hz: a host already asked singly logs as slowed');

    t = wire({ logRequests: false }, new Set());
    t.w.logBusy('https://cdn.example/a.jpg', refused);
    t.w.hzLog('norush', { host: 'cdn.example', out: 'set' });
    eq(t.rows().length, 0, 'hz: the setting off logs nothing');

    t = wire({}, new Set());
    t.w.hzLog('norush', { host: 'cdn.example', out: 'set' });
    eq(t.rows().length, 1, 'hz: a setting never saved counts as on');

    const diag = grabFn('diagnose');
    ok(diag.indexOf('logBusy(url, r)') > 0 && diag.indexOf('logBusy(url, r)') < diag.indexOf('hardBlock(url, v)'),
        'hz: diagnose logs the refusal before hardBlock records the host');
    ok(/noRushHosts\(\)\.add\(h\);[\s\S]*?hzLog\('norush'/.test(grabFn('hardBlock')), 'hz: hardBlock notes the climb-down');
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
