// ==== us-next begin ====
// Shared verbatim by Hover Zoom, Forum Stumbler and Open Links in New Tab. Edit
// HoverZoom/shared/us-next.js, then run `node shared/sync-shared.js` from HoverZoom.
// Design: HoverZoom/docs/PRELOAD.md "Next-page finding".
const usNext = (function () {
    // ---- which page is next: rel=next → learned (caller's) → numbered pager → forward word
    const NEXT_TEXT = /^(next|next\s*page|older|older\s*posts?|more|load\s*more|show\s*more|next\s*[»›→]|»|›|→|>>)$/i;
    const NEXT_DECOR = /^[\s«»‹›→←⇒⇐<>|·.…–—-]+|[\s«»‹›→←⇒⇐<>|·.…–—-]+$/g;
    const NEXT_WORDS = /(^|\W)(next|older|forward|more)(\W|$)|»|›|→|>>/i;
    const BACK_WORDS = /(^|\W)(prev|previous|newer|back|earlier|first)(\W|$)|«|‹|←|<</i;
    const LABEL_MAX = 40;       // longer than this is prose, not a pager control
    const ACTIVE_RX = /(?:^|[\s_-])(?:active|current|selected|here)(?:[\s_-]|$)/i;

    const nextText = (s) => NEXT_TEXT.test(s) || NEXT_TEXT.test((s || '').replace(NEXT_DECOR, ''));
    const hashless = (u) => { try { const x = new URL(u); x.hash = ''; return x.href; } catch (_) { return u; } };

    // The page number a URL states, or 0.
    function pageNumOf(u) {
        const m = /[?&](?:page|p|pg|paged|pagenum|start)=(\d+)/i.exec(u.search) ||
                  /\/(?:page|p)\/(\d+)(?:\/|$)/i.exec(u.pathname) ||
                  /\/(?:page|p)(\d+)(?:\/|$)/i.exec(u.pathname);
        return m ? parseInt(m[1], 10) : 0;
    }

    // Every same-site anchor that leaves this page: { a, url, urlObj, text }. o.norm, o.skip(url).
    function anchors(root, base, o) {
        o = o || {};
        const nrm = o.norm || hashless;
        let origin;
        try { origin = new URL(base).origin; } catch (_) { return []; }
        const here = nrm(String(base).split('#')[0], base);
        const out = [];
        for (const a of root.querySelectorAll('a[href]')) {
            const r = record(a, base, origin, here, nrm, o.skip);
            if (r) out.push(r);
        }
        return out;
    }

    function record(a, base, origin, here, norm, skip) {
        const raw = a.getAttribute('href');
        if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel):/i.test(raw)) return null;
        let u;
        try { u = new URL(raw, base); } catch (_) { return null; }
        if (!/^https?:$/.test(u.protocol) || u.origin !== origin) return null;
        const url = norm(u.href, base);
        if (url === here || (skip && skip(url))) return null;
        return { a, url, urlObj: u, text: (a.textContent || '').trim() };
    }

    // Coarse cluster fingerprint: the link's own tag (its classes vary per link), then tag + first 2 classes, 3 levels up.
    function groupSig(a) {
        const parts = [];
        let el = a;
        for (let i = 0; i < 4 && el && el.tagName; i++) {
            let sig = el.tagName.toLowerCase();
            const cls = (i && el.getAttribute && el.getAttribute('class') || '')
                .trim().split(/\s+/).slice(0, 2).map(c => c.replace(/\d+/g, '#')).join('.');
            if (cls) sig += '.' + cls;
            parts.push(sig);
            el = el.parentElement;
        }
        return parts.join('>');
    }

    // The current page as the pager marks it (aria-current / active class on a bare number).
    function pagerCurrentFromDom(nums) {
        if (!nums.length) return null;
        const need = Math.min(2, nums.length);
        let el = nums[0].a;
        for (let up = 0; el && el.contains && up < 8; up++, el = el.parentElement) {
            if (nums.filter(r => el.contains(r.a)).length < need) continue;
            for (const c of el.querySelectorAll('[aria-current],[class]')) {
                const t = (c.textContent || '').trim();
                if (!/^\d{1,6}$/.test(t)) continue;
                const ac = c.getAttribute('aria-current');
                if ((ac && ac !== 'false') || ACTIVE_RX.test(c.getAttribute('class') || '')) return parseInt(t, 10);
            }
        }
        return null;
    }

    // The current page as the lone narrow hole in the pager's numbers; null if two holes qualify.
    function pagerCurrentFromGap(byNum) {
        let found = null;
        for (const n of byNum.keys()) {
            const c = n - 1;
            if (c < 1 || byNum.has(c)) continue;
            if (c > 1 && !byNum.has(c - 1)) continue;         // wide gap = an ellipsis
            if (found !== null && found !== c) return null;
            found = c;
        }
        return found;
    }

    // current + 1 among numbered links; null on the last page or when the number links two places.
    function pickNumericNext(recs, base) {
        const byNum = new Map();
        const clashed = new Set();
        const nums = [];
        for (const r of recs) {
            if (!/^\d{1,6}$/.test(r.text)) continue;
            const n = parseInt(r.text, 10);
            if (!n) continue;
            nums.push(r);
            if (!byNum.has(n)) byNum.set(n, r);
            else if (byNum.get(n).url !== r.url) clashed.add(n);
        }
        if (!byNum.size) return null;
        let unlinked = 1;
        while (byNum.has(unlinked)) unlinked++;
        const highest = Math.max.apply(null, Array.from(byNum.keys()));
        let fromUrl = 0;
        try { fromUrl = base ? pageNumOf(new URL(base)) : 0; } catch (_) { fromUrl = 0; }
        for (const c of [fromUrl, pagerCurrentFromGap(byNum), pagerCurrentFromDom(nums), unlinked]) {
            if (!c) continue;
            if (byNum.has(c + 1)) return clashed.has(c + 1) ? null : byNum.get(c + 1);
            if (c === highest || c === highest + 1) return null;
        }
        return null;
    }

    // Which same-position group of numbered links is the pager (not comment counts); [] if none.
    function pickPagerGroup(recs, base) {
        const groups = new Map();
        for (const r of recs) {
            if (!/^\d{1,6}$/.test(r.text)) continue;
            const sig = groupSig(r.a);
            if (!groups.has(sig)) groups.set(sig, []);
            groups.get(sig).push(r);
        }
        let best = null;
        for (const items of groups.values()) {
            const nums = Array.from(new Set(items.map(r => parseInt(r.text, 10)))).sort((a, b) => a - b);
            if (nums.length < 2) continue;
            let run = 1, longest = 1;
            for (let i = 1; i < nums.length; i++) {
                run = (nums[i] === nums[i - 1] + 1) ? run + 1 : 1;
                if (run > longest) longest = run;
            }
            if (nums[0] > 2 && longest < 3) continue;               // a window with no page 1 (4 5 6 [7] 8 9) needs a run of 3
            if (longest < 2 && nums.join() !== '1,3') continue;     // 1,3: page 2 of 3
            if (!pagerShapeOk(items, base)) continue;
            if (!best || longest > best.run) best = { items, run: longest };
        }
        return best ? best.items : [];
    }

    // Do these numbered links address pages of this list? Digit-free URLs (/gallery/two/) pass.
    function pagerShapeOk(items, base) {
        const byN = new Map();
        for (const r of items) {
            const n = parseInt(r.text, 10);
            if (n > 1 && !byN.has(n)) byN.set(n, r.url);
        }
        const ents = Array.from(byN.entries()).sort((a, b) => a[0] - b[0]);
        if (!ents.length) return false;
        if (ents.every(e => !/\d/.test(e[1]))) return true;
        const letters = (s) => (s || '').replace(/[^a-z]/gi, '').toLowerCase();
        if (ents.length === 1) {
            const [n, u] = ents[0];
            if (!base) return true;
            const g = deriveTemplateFromChain(base, u);
            if (g && g.template(n) === u) return true;
            return letters(u) === letters(base);
        }
        const mask = (u) => u.replace(/\d+/g, '#');
        const shape = mask(ents[0][1]);
        if (ents.some(e => mask(e[1]) !== shape)) return false;
        if (base) {
            try {
                const bp = letters(new URL(base).pathname);
                if (!letters(new URL(ents[0][1], base).pathname).startsWith(bp)) return false;
            } catch (_) {}
        }
        const runs = ents.map(e => (e[1].match(/\d+/g) || []).map(Number));
        for (let i = 0; i < runs[0].length; i++) {
            let up = true;
            for (let k = 1; k < runs.length && up; k++) up = runs[k][i] > runs[k - 1][i];
            if (up) return true;
        }
        return false;
    }

    // 2: the whole label is a forward control (or an icon labelled/classed next); 1: a forward word in a short label.
    function forwardLevel(r) {
        const a = r.a;
        const al = ((a.getAttribute('aria-label') || '') + ' ' + (a.getAttribute('title') || '')).trim();
        if (nextText(r.text)) return 2;
        if (!r.text) {
            if (al) return NEXT_WORDS.test(al) && !BACK_WORDS.test(al) ? 2 : 0;
            const pa = a.parentElement;
            const cls = (a.getAttribute('class') || '') + ' ' + ((pa && pa.getAttribute && pa.getAttribute('class')) || '');
            return /(^|[\s_-])next([\s_-]|$)/i.test(cls) && !/(^|[\s_-])prev(ious)?([\s_-]|$)/i.test(cls) ? 2 : 0;
        }
        const label = (r.text + ' ' + al).trim();
        if (label.length > LABEL_MAX) return 0;
        return NEXT_WORDS.test(label) && !BACK_WORDS.test(label) ? 1 : 0;
    }

    // The one forward destination, exact controls before loose wording; null when a tier holds two.
    function pickTextNext(recs) {
        const hit = [null, null, null];
        const clash = [false, false, false];
        for (const r of recs) {
            const lv = forwardLevel(r);
            if (!lv) continue;
            if (!hit[lv]) hit[lv] = r;
            else if (hit[lv].url !== r.url) clash[lv] = true;
        }
        if (hit[2]) return clash[2] ? null : hit[2];
        return hit[1] && !clash[1] ? hit[1] : null;
    }

    // Next page { url, a, how } or null. o: norm, skip, learned(base) → url, learnedHow, noNumbers.
    function find(root, base, o) {
        o = o || {};
        const nrm = o.norm || hashless;
        let origin;
        try { origin = new URL(base).origin; } catch (_) { return null; }
        const here = nrm(String(base).split('#')[0], base);
        const declared = [];
        for (const el of root.querySelectorAll('link[rel~="next" i][href],a[rel~="next" i][href]')) {
            const r = record(el, base, origin, here, nrm, o.skip);
            if (r && !declared.some(d => d.url === r.url)) declared.push(r);
        }
        if (declared.length === 1) {
            const el = declared[0].a;
            return { url: declared[0].url, a: /^a$/i.test(el.tagName) ? el : null, how: 'rel="next"' };
        }
        const learned = o.learned ? o.learned(base) : null;
        if (learned) return { url: learned, a: null, how: o.learnedHow || 'learned' };
        const recs = anchors(root, base, o);
        if (!o.noNumbers) {
            const num = pickNumericNext(pickPagerGroup(recs, base), base);
            if (num) return { url: num.url, a: num.a, how: 'numeric page link' };
        }
        const txt = pickTextNext(recs);
        return txt ? { url: txt.url, a: txt.a, how: 'next/older text link' } : null;
    }

    // Two consecutive page URLs → { current, template(n) }; null when ambiguous.
    function deriveTemplateFromChain(curUrl, nextUrl) {
        if (!curUrl || !nextUrl || curUrl === nextUrl) return null;
        const runs = (s) => {
            const out = [], rx = /\d+/g;
            let m;
            while ((m = rx.exec(s))) out.push({ at: m.index, end: m.index + m[0].length, val: m[0] });
            return out;
        };
        const hits = [];
        for (const r of runs(curUrl)) {
            const n = parseInt(r.val, 10);
            const pre = curUrl.slice(0, r.at), suf = curUrl.slice(r.end);
            if (pre + (n + 1) + suf !== nextUrl) continue;
            hits.push({ current: n, template: (p) => pre + p + suf });
        }
        if (hits.length) return hits.length === 1 ? hits[0] : null;
        for (const r of runs(nextUrl)) {
            if (r.val !== '2') continue;
            const pre = nextUrl.slice(0, r.at), suf = nextUrl.slice(r.end);
            if (!pre.startsWith(curUrl)) continue;
            hits.push({ current: 1, template: (p) => (p === 1 ? curUrl : pre + p + suf) });
        }
        return hits.length === 1 ? hits[0] : null;
    }

    // ---- is this link a pager control at all (either direction)
    const PAGINATION_CONTAINERS = [
        '[class*="pagin" i]', '[id*="pagin" i]', '[class*="pager" i]', '[id*="pager" i]',
        '[class*="page-nav" i]', '[class*="pagenav" i]', '[aria-label*="pagin" i]',
        'nav[aria-label*="page" i]', '[role="navigation"]'
    ].join(',');
    const PAGE_NUMBER_LABEL = /^(page )?\d[\d,]*$/;
    const PAGER_TEXTS = new Set([
        'next', 'more', 'older', 'previous', 'prev',
        'next page', 'previous page', 'older posts', 'newer posts',
        'load more posts', 'go to next page', 'view older posts', 'next article',
        'next ›', 'previous ›', 'next →', 'previous →', 'next >>', 'previous >>', '›', '→', '>>', '»',
        'prev ‹', 'previous ‹', '‹', '←', '<<', '«',
        'first', 'last', '…', '...'
    ]);

    // Nearest ancestor (≤ 4 levels, below <body>) holding another bare-number link: its text.
    function numberedSiblingLink(link) {
        const body = link.ownerDocument && link.ownerDocument.body;
        let scope = link.parentElement;
        for (let depth = 0; scope && scope !== body && depth < 4; depth++, scope = scope.parentElement) {
            const other = Array.from(scope.querySelectorAll('a[href]')).find(a =>
                a !== link && PAGE_NUMBER_LABEL.test(a.textContent.replace(/\s+/g, ' ').trim().toLowerCase()));
            if (other) return other.textContent.replace(/\s+/g, ' ').trim();
        }
        return null;
    }

    // Icon-only prev/next arrows judged by rel, aria-label/title and classes.
    function iconPagerReason(link) {
        const rel = (link.getAttribute('rel') || '').toLowerCase();
        if (/\b(next|prev)\b/.test(rel)) return 'link has rel="' + rel + '"';
        if (link.textContent.trim()) return null;
        const label = ((link.getAttribute('aria-label') || '') + ' ' + (link.getAttribute('title') || '')).trim().toLowerCase();
        if (/\b(next|prev|previous|older|newer|pagination|pager)\b/.test(label)) return 'icon-only link labelled "' + label + '"';
        const cls = ((link.getAttribute('class') || '') + ' ' + ((link.parentElement && link.parentElement.getAttribute('class')) || '')).toLowerCase();
        if (/\b(next|prev|previous)\b/.test(cls)) return 'icon-only link with a prev/next class';
        const icons = Array.from(link.querySelectorAll('[class]')).map(e => e.getAttribute('class')).join(' ').toLowerCase();
        if (/chevron|arrow|angle|caret/.test(icons) && link.closest(PAGINATION_CONTAINERS)) return 'arrow icon inside a pagination container';
        return null;
    }

    // Why this <a> is a pager control (a sentence), or null. `extra`: the caller's own word Set.
    function pagerReason(link, extra) {
        const icon = iconPagerReason(link);
        if (icon) return icon;
        if (link.textContent) {
            const text = link.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
            const known = (t) => PAGER_TEXTS.has(t) || !!(extra && extra.has(t));
            if (known(text)) return 'link text "' + text + '" is in the pagination/sort-control word list';
            const bare = text.replace(/^[«»‹›→←<>\s]+|[«»‹›→←<>\s]+$/g, '');
            if (bare !== text && known(bare)) return 'link text "' + text + '" is "' + bare + '" wrapped in arrow glyphs';
            if (PAGE_NUMBER_LABEL.test(text)) {
                if (link.closest(PAGINATION_CONTAINERS)) return 'link is a bare number inside a pagination container';
                const sibling = numberedSiblingLink(link);
                if (sibling) return 'link is a bare number beside another bare-number link ("' + sibling + '")';
            }
        }
        if (link.href) {
            const url = link.href.toLowerCase();
            const path = (link.pathname || '').toLowerCase();
            const label = () => (link.textContent || '').replace(/\s+/g, ' ').replace(/,/g, '').trim().toLowerCase().replace(/^page /, '');
            if (/[?&](page|paged|pg|start|offset)=\d+(?:[&#]|$)/.test(url)) return 'query string carries a page number (?page=N / ?offset=N …)';
            const pMatch = url.match(/[?&]p=(\d+)(?:[&#]|$)/);
            if (pMatch && (label() === pMatch[1] || label() === String(Number(pMatch[1]) + 1))) return 'query string has ?p=' + pMatch[1] + ' and the link is labelled ' + label();
            if (/[?&][^=]*-page=\d+(?:[&#]|$)/.test(url)) return 'query string carries a prefixed page number (?something-page=N)';
            if (/\/(page|p)\/\d+\/?$/.test(path)) return 'path ends in /page/N';
            if (/\bpage[-_]?\d+(\.\w+)?\/?$/.test(path)) return 'path ends in pageN / page-N / page_N';
            if (/\/portal\/\d+\/?$/.test(path)) return 'path ends in /portal/N';
            if (/\/(new|newest|latest|recent|top|hot|best|rising|popular|trending|all|active|unanswered)\/\d+\/?$/.test(path)) return 'path ends in a sort word followed by a number (…/new/2, …/top/3)';
            const numericEndMatch = path.match(/\/(\d+)\/?$/);
            if (numericEndMatch) {
                const n = numericEndMatch[1];
                if (label() === n) return 'path ends in /' + n + ' and the link is labelled with that same number';
                if (label() === String(Number(n) + 1)) return 'path ends in /' + n + ' and the link is labelled ' + label() + ' (zero-indexed pagination)';
            }
        }
        return null;
    }

    return { find, anchors, pageNumOf, nextText, pickNumericNext, pickTextNext, pickPagerGroup,
        pagerCurrentFromGap, pagerCurrentFromDom, deriveTemplateFromChain, pagerReason };
})();
// ==== us-next end ====
