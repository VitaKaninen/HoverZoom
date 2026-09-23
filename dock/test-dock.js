// node dock/test-dock.js — the shared widget layout (solve) and drop logic (makeSpec, zone).
const fs = require('fs');
const path = require('path');

global.MutationObserver = class { observe() {} };
const usDock = new Function(fs.readFileSync(path.join(__dirname, 'us-dock.js'), 'utf8') + '\nreturn usDock;')();

let pass = 0, fail = 0;
function eq(got, want, what) {
    if (JSON.stringify(got) === JSON.stringify(want)) pass++;
    else { fail++; console.log('FAIL ' + what + '\n  got  ' + JSON.stringify(got) + '\n  want ' + JSON.stringify(want)); }
}

const V = { w: 1000, h: 600 };
const win = (m, o) => ({ r: 'win', m: m, t: m, o: o || 0 });
function dock(id, w, h, x, y, extra) {
    const fx = x.r === 'win' ? x : win('e'), fy = y.r === 'win' ? y : win('e');
    return Object.assign({ id: id, w: w, h: h, grew: 0, drag: null, minH: null,
        spec: { x: x, y: y, fx: fx, fy: fy, ov: [] } }, extra || {});
}
function out(docks) {
    const r = {};
    usDock.solve(docks, V).forEach(d => { r[d.id] = [d.out.x, d.out.y, d.out.h]; });
    const sorted = {};
    Object.keys(r).sort().forEach(k => { sorted[k] = r[k]; });
    return sorted;
}
const above = id => ({ r: id, m: 'e', t: 's', o: 0 });
const below = id => ({ r: id, m: 's', t: 'e', o: 0 });
const alignE = id => ({ r: id, m: 'e', t: 'e', o: 0 });

// FS flush bottom-right; HZ on top of it, right edges aligned.
eq(out([dock('fs', 200, 80, win('e'), win('e')), dock('hz', 120, 30, alignE('fs'), above('fs'))]),
    { fs: [800, 520, 80], hz: [880, 490, 30] }, 'HZ stacked on FS');

// FS grows up: HZ is carried with it.
eq(out([dock('fs', 200, 300, win('e'), win('e')), dock('hz', 120, 30, alignE('fs'), above('fs'))]),
    { fs: [800, 300, 300], hz: [880, 270, 30] }, 'FS grows, HZ carried');

// FS absent: HZ falls back to its window anchor.
eq(out([dock('hz', 120, 30, alignE('fs'), above('fs'))]), { hz: [880, 570, 30] }, 'anchor widget absent');

// HZ 40px off the bottom; FS attached BELOW it grows down past the window: the pair moves up as one.
eq(out([dock('hz', 120, 30, win('e'), win('e', -40)), dock('fs', 200, 100, alignE('hz'), below('hz'))]),
    { fs: [800, 500, 100], hz: [880, 470, 30] }, 'attached pair clamped as a unit');

// Centre anchor: the widget's centre sits at the window's centre plus the offset.
eq(out([dock('hz', 100, 40, win('c', 10), win('c', -20))]), { hz: [460, 260, 40] }, 'centre anchor');

// Two unattached widgets overlap: the newer (grower) stays, the other is pushed.
eq(out([dock('a', 100, 100, win('e'), win('e'), { grew: 2 }), dock('b', 100, 50, win('e'), win('e', -60), { grew: 1 })]),
    { a: [900, 500, 100], b: [900, 450, 50] }, 'grower pushes the other');

// The pushed one would leave the screen: the grower is pushed back instead.
eq(out([dock('a', 100, 100, win('e'), win('s', 40), { grew: 2 }), dock('b', 100, 50, win('e'), win('s'), { grew: 1 })]),
    { a: [900, 50, 100], b: [900, 0, 50] }, 'grower pushed back at the edge');

// A stretching panel above gives up its bottom first, down to its minimum.
eq(out([dock('rnfp', 380, 500, win('e'), win('s', 100), { minH: 120 }), dock('hz', 120, 30, win('e'), win('e'))]),
    { hz: [880, 570, 30], rnfp: [620, 100, 470] }, 'stretch panel shrinks');

// A stretching panel taller than the window keeps its top; its bottom stops at the window.
eq(out([dock('rnfp', 380, 700, win('e'), win('s', 60), { minH: 120 })]), { rnfp: [620, 60, 540] }, 'stretch panel clamps its bottom');

// Overlap the user dropped on purpose is left alone.
const ovA = dock('a', 100, 100, win('e'), win('e'), { grew: 2 });
ovA.spec.ov = ['b'];
eq(out([ovA, dock('b', 100, 50, win('e'), win('e'), { grew: 1 })]), { a: [900, 500, 100], b: [900, 550, 50] }, 'dropped overlap kept');

// A loop of attachments: the first in id order falls back to the window.
eq(out([dock('a', 100, 50, alignE('b'), above('b')), dock('b', 100, 50, alignE('a'), above('a'))]),
    { a: [900, 550, 50], b: [900, 500, 50] }, 'attachment loop broken');

// A widget being dragged is where the pointer puts it, and carries what is attached to it.
eq(out([dock('fs', 200, 80, win('e'), win('e'), { drag: { x: 100, y: 200 } }), dock('hz', 120, 30, alignE('fs'), above('fs'))]),
    { fs: [100, 200, 80], hz: [180, 170, 30] }, 'group follows a drag');

// ---- zones: hysteresis is half the widget's size
eq(usDock.zone('e', 0, 60, 600), 's', 'bottom-anchored, dragged to the top');
eq(usDock.zone('e', 340, 60, 600), 'c', 'bottom edge above the 2/3 line → centre');
eq(usDock.zone('c', 365, 60, 600), 'c', 'centre anchor holds until its centre crosses 2/3');
eq(usDock.zone('c', 371, 60, 600), 'e', '...and then it is bottom');

// ---- drops
const fsR = { id: 'fs', left: 800, top: 520, right: 1000, bottom: 600, width: 200, height: 80 };
let s = usDock.makeSpec({ x: 880, y: 490, w: 120, h: 30 }, { x: 'e', y: 'e' }, [fsR], V);
eq([s.x, s.y], [win('e'), above('fs')], 'dropped on FS at the window edge: x to the window, y to FS');
s = usDock.makeSpec({ x: 680, y: 490, w: 120, h: 30 }, { x: 'e', y: 'e' }, [
    { id: 'fs', left: 600, top: 520, right: 800, bottom: 600, width: 200, height: 80 }], V);
eq([s.x, s.y], [alignE('fs'), above('fs')], 'dropped on FS away from the edge: aligned right edges');
s = usDock.makeSpec({ x: 450, y: 250, w: 100, h: 40 }, { x: 'c', y: 'c' }, [], V);
eq([s.x, s.y, s.ov], [win('c', 0), win('c', -30), []], 'free drop mid-window: centre anchors');
s = usDock.makeSpec({ x: 850, y: 540, w: 100, h: 40 }, { x: 'e', y: 'e' }, [fsR], V);
eq(s.ov, ['fs'], 'a drop overlapping another records it');
eq(usDock.snap(805, 485, 120, 30, V, [fsR]), { x: 800, y: 490 }, 'snaps to FS top and its left edge');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
