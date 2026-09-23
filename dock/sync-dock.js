// node dock/sync-dock.js [--check] — copy dock/us-dock.js into every script that carries the
// `// ==== us-dock begin ====` / `// ==== us-dock end ====` markers, at the markers' indentation.
// --check only reports scripts whose copy differs, and exits 1 if any does.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TARGETS = [
    'HoverZoom/Hover-Zoom.user.js',
    'Forum-Stumbler/Forum-Stumbler.user.js',
    'Reddit-Notifications-Floating-Panel/Reddit-Notifications-Floating-Panel.user.js',
];
const BEGIN = '// ==== us-dock begin ====';
const END = '// ==== us-dock end ====';

const check = process.argv.includes('--check');
const src = fs.readFileSync(path.join(__dirname, 'us-dock.js'), 'utf8').replace(/\r\n/g, '\n').trimEnd().split('\n');
let bad = 0;

for (const rel of TARGETS) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) { console.log('missing  ' + rel); bad++; continue; }
    const raw = fs.readFileSync(file, 'utf8');
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const b = lines.findIndex(l => l.trim() === BEGIN);
    const e = lines.findIndex((l, i) => i > b && l.trim() === END);
    if (b < 0 || e < 0) { console.log('no markers  ' + rel); bad++; continue; }
    const indent = lines[b].match(/^\s*/)[0];
    const unit = indent ? indent : '';
    const block = src.map(l => l ? unit + l.replace(/^( {4})+/, m => (unit.length === 2 ? '  ' : '    ').repeat(m.length / 4)) : l);
    const same = lines.slice(b, e + 1).join('\n') === block.join('\n');
    if (same) { console.log('same     ' + rel); continue; }
    if (check) { console.log('DIFFERS  ' + rel); bad++; continue; }
    const next = lines.slice(0, b).concat(block, lines.slice(e + 1)).join('\n');
    fs.writeFileSync(file, eol === '\r\n' ? next.replace(/\n/g, '\r\n') : next, 'utf8');
    console.log('written  ' + rel);
}
process.exit(bad ? 1 : 0);
