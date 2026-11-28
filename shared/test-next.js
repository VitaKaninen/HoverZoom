// node shared/test-next.js — the shared next-page finder: rel=next, numbered pagers (windowed,
// comment counts, clashes), forward words, ambiguity refused, and the pager-control test.
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'us-next.js'), 'utf8');
const N = new Function(SRC + '\nreturn usNext;')();

let pass = 0, fail = 0;
function eq(got, want, what) {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log('FAIL ' + what + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}

// ---- a minimal DOM: tags, attributes, text, and the attribute selectors the finder uses
function matches(el, sel) {
    return sel.split(',').some(function (one) {
        one = one.trim();
        const m = /^([a-z]*)((?:\[[^\]]+\])*)$/i.exec(one);
        if (!m) throw new Error('selector not supported: ' + one);
        if (m[1] && el.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
        const parts = m[2].match(/\[[^\]]+\]/g) || [];
        return parts.every(function (p) {
            const a = /^\[([\w-]+)(?:([~*]?=)"([^"]*)"(\s+i)?)?\]$/.exec(p);
            const v = el.getAttribute(a[1]);
            if (v == null) return false;
            if (!a[2]) return true;
            const have = a[4] ? v.toLowerCase() : v, want = a[4] ? a[3].toLowerCase() : a[3];
            if (a[2] === '=') return have === want;
            if (a[2] === '*=') return have.includes(want);
            return have.split(/\s+/).includes(want);
        });
    });
}
function El(tag, attrs, kids) {
    this.tagName = tag.toUpperCase();
    this.attrs = attrs || {};
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    (kids || []).forEach(k => this.append(k));
}
El.prototype.append = function (k) {
    if (typeof k === 'string') k = Object.assign(new El('#text'), { text: k });
    k.parentElement = this;
    this.children.push(k);
};
El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
El.prototype.all = function () { return this.children.filter(c => c.tagName !== '#TEXT').flatMap(c => [c].concat(c.all())); };
El.prototype.querySelectorAll = function (sel) { return this.all().filter(e => matches(e, sel)); };
El.prototype.contains = function (x) { for (; x; x = x.parentElement) if (x === this) return true; return false; };
El.prototype.closest = function (sel) { for (let x = this; x && x.tagName !== '#TEXT'; x = x.parentElement) if (matches(x, sel)) return x; return null; };
Object.defineProperty(El.prototype, 'textContent', { get: function () {
    return this.tagName === '#TEXT' ? this.text : this.children.map(c => c.textContent).join('');
} });
const h = (tag, attrs, ...kids) => new El(tag, attrs, kids);
const a = (href, text, attrs) => h('a', Object.assign({ href }, attrs || {}), ...(text ? [text] : []));
function doc(...kids) {
    const body = h('body', {}, ...kids);
    const root = h('html', {}, body);
    const d = { body, querySelectorAll: s => root.querySelectorAll(s) };
    root.all().concat(root).forEach(e => { e.ownerDocument = d; });
    return d;
}
// An anchor as OLINT sees it: href and pathname resolved.
function live(el, base) {
    const u = new URL(el.getAttribute('href'), base);
    el.href = u.href; el.pathname = u.pathname;
    return el;
}
const url = (r) => r && r.url;
const B = 'https://ex.com/forum/list';

// ---- rel=next
eq(url(N.find(doc(h('link', { rel: 'next', href: '?page=3' }), a('/other', 'Next')), B + '?page=2')),
    'https://ex.com/forum/list?page=3', 'rel=next wins');
eq(N.find(doc(h('link', { rel: 'next', href: 'x' })), B).a, null, 'a head <link> has no anchor');
eq(url(N.find(doc(a('/a', '', { rel: 'next' }), a('/b', '', { rel: 'next' }), a('/c', 'Next')), B)),
    'https://ex.com/c', 'two different rel=next are refused; the word rung decides');
eq(url(N.find(doc(a('https://other.org/2', 'Next', { rel: 'next' })), B)), null, 'off-site rel=next is not followed');

// ---- numbered pagers
const pager = (base, ns, extra) => doc(h('div', { class: 'pagination' },
    ...ns.map(n => a(base + '?page=' + n, String(n), extra))));
eq(url(N.find(pager('/forum/list', [1, 2, 4, 5]), B + '?page=3')), 'https://ex.com/forum/list?page=4', 'URL says page 3');
eq(url(N.find(pager('/forum/list', [1, 5, 6, 8, 9, 42]), 'https://ex.com/forum/list?x=7')),
    'https://ex.com/forum/list?page=8', 'windowed pager: the narrow hole is here');
eq(url(N.find(doc(h('div', { class: 'numlist2' }, ...[4, 5, 6, 8, 9, 10].map(n => a('/cat/all/' + n + '/', String(n))))), 'https://ex.com/cat/all/7/')),
    'https://ex.com/cat/all/8/', 'a window that does not show page 1 (eporner)');
eq(url(N.find(doc(h('div', { class: 'numlist2' }, ...[4, 5, 6, 8, 9, 10].map(n => a('/cat/all/' + n + '/', String(n), n % 2 ? { class: 'extrapages' + n } : {})))), 'https://ex.com/cat/all/7/')),
    'https://ex.com/cat/all/8/', 'per-link classes do not split the pager (eporner)');
eq(url(N.find(doc(h('div', {}, a('/t/9811', '7'), a('/t/1204', '8'))), B)), null, 'two numbers above 2 with no run are not a pager');
eq(url(N.find(pager('/forum/list', [2, 3, 4]), B)), 'https://ex.com/forum/list?page=2', 'page 1 links from 2');
eq(url(N.find(pager('/forum/list', [1, 2, 3]), B + '?page=4')), null, 'last page: nothing after it');
{
    const d = doc(h('ul', {},
        h('li', {}, a('/forum/list?page=1', '1')),
        h('li', { class: 'active' }, h('span', { class: 'current' }, '2')),
        h('li', {}, a('/forum/list?page=2', '2')),
        h('li', {}, a('/forum/list?page=3', '3'))));
    eq(url(N.find(d, 'https://ex.com/forum/list?s=x')), 'https://ex.com/forum/list?page=3',
        'a pager that links its own page: the active marker says where we are');
}
{
    // Comment counts: numbered, consecutive, but each links a different thread.
    const d = doc(
        h('div', { class: 'row' }, a('/t/9811', '1')), h('div', { class: 'row' }, a('/t/1204', '2')),
        h('div', { class: 'row' }, a('/t/5530', '3')));
    eq(url(N.find(d, B)), null, 'comment counts are not a pager');
}
eq(url(N.find(doc(h('nav', {}, a('/gallery/one/', '1'), a('/gallery/three/', '3'))), 'https://ex.com/gallery/two/')),
    'https://ex.com/gallery/three/', 'digit-free page URLs still read as a pager');
eq(url(N.find(doc(h('div', { class: 'p' }, a('/l?page=1', '1'), a('/l?page=3', '3'), a('/l?page=3b', '3'))), 'https://ex.com/l?page=2')),
    null, 'one number linking two places is refused');
eq(url(N.find(pager('/forum/list', [1, 3]), B + '?page=2', { noNumbers: true })), null, 'noNumbers skips the pager');

// ---- learned (the caller's layer) sits between rel=next and the pager
{
    const r = N.find(pager('/forum/list', [1, 3]), B + '?page=2', { learned: () => 'https://ex.com/L', learnedHow: 'learned page address' });
    eq([r.url, r.how], ['https://ex.com/L', 'learned page address'], 'learned beats the pager');
}

// ---- forward words
eq(url(N.find(doc(a('/new', 'Newer posts'), a('/old', 'Older posts →')), B)), 'https://ex.com/old', 'older is forward');
eq(url(N.find(doc(a('/a', 'Next'), a('/b', 'More')), B)), null, 'two exact forward controls are refused');
eq(url(N.find(doc(a('/a', 'Next »'), a('/a', 'Next »')), B)), 'https://ex.com/a', 'top and bottom copies agree');
eq(url(N.find(doc(a('/p1', 'Read more'), a('/p2', 'Read more'), a('/older', '← Older posts')), B)),
    'https://ex.com/older', 'an exact control beats loose "Read more" links');
eq(url(N.find(doc(a('/a', 'Next chapter')), B)), 'https://ex.com/a', 'a forward word in a short label');
eq(url(N.find(doc(a('/a', 'Read the next instalment of our long running series right here')), B)), null, 'prose is not a control');
eq(url(N.find(doc(a('/a', '', { 'aria-label': 'Next page' })), B)), 'https://ex.com/a', 'icon labelled next');
eq(url(N.find(doc(a('/a', '', { class: 'btn next' }), a('/b', '', { class: 'btn prev' })), B)), 'https://ex.com/a', 'icon classed next');
eq(url(N.find(doc(a('?sort=top', 'Top'), a('?sort=new', 'New')), B)), null, 'sort controls are not a direction');
eq(url(N.find(doc(a('/forum/list#x', 'Next')), B)), null, 'a link to this page is not next');
eq(url(N.find(doc(a('/i/photo.jpg', 'Next')), B, { skip: u => /\.jpg$/.test(u) })), null, 'skip refuses a URL');
eq(url(N.find(doc(a('/a/', 'Next')), B, { norm: u => u.replace(/\/$/, '') })), 'https://ex.com/a', 'norm shapes the URL');

// ---- deriveTemplateFromChain, pageNumOf
{
    const t = N.deriveTemplateFromChain('https://ex.com/f?page=2', 'https://ex.com/f?page=3');
    eq([t.current, t.template(9)], [2, 'https://ex.com/f?page=9'], 'template from page 2 → 3');
    const u = N.deriveTemplateFromChain('https://ex.com/f', 'https://ex.com/f/page/2/');
    eq([u.current, u.template(1), u.template(5)], [1, 'https://ex.com/f', 'https://ex.com/f/page/5/'], 'template from page 1');
}
eq(N.pageNumOf(new URL('https://ex.com/g/page/7/')), 7, 'pageNumOf /page/N');
eq(N.pageNumOf(new URL('https://ex.com/g/pager-2.html')), 0, 'pageNumOf refuses a filename number');

// ---- pagerReason: is it a pager control at all
const PB = 'https://ex.com/blog/';
const reason = (el, extra) => { const d = doc(el); return N.pagerReason(live(d.body.querySelectorAll('a[href]').find(x => x === el) || el.querySelectorAll('a[href]')[0], PB), extra); };
eq(!!reason(a('/x', 'Previous')), true, 'previous is a pager word');
eq(!!reason(a('/x', '« First')), true, 'arrow-wrapped word');
eq(!!reason(a('/x', 'Top')), false, 'sort word is not shared');
eq(!!reason(a('/x', 'Top'), new Set(['top'])), true, 'caller word list');
eq(!!reason(a('/blog/page/3/', 'An article')), true, '/page/N URL');
eq(!!reason(a('/mods/232', 'A mod')), false, 'a content id is not a page');
eq(!!reason(a('/blog/2', '2')), true, 'trailing number labelled with it');
eq(!!reason(h('div', { class: 'pagination' }, a('/z', '7'))), true, 'bare number in a pager');
eq(!!reason(a('/x', '', { 'aria-label': 'Next' })), true, 'icon-only labelled next');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
