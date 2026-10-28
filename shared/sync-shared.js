// node shared/sync-shared.js [--check] — copy each shared block into every script carrying its
// `// ==== <name> begin ====` / `// ==== <name> end ====` markers, at the markers' indentation.
// --check only reports scripts whose copy differs, and exits 1 if any does.
//
// The dock predates this and keeps its own dock/sync-dock.js. Adding a script to a block here is
// two steps: paste the marker pair into it, and add its path to that block's targets.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BLOCKS = [
    {
        name: 'us-log',
        src: 'us-log.js',
        targets: [
            'Forum-Stumbler/Forum-Stumbler.user.js',
            'HoverZoom/Hover-Zoom.user.js',
        ],
    },
];

const check = process.argv.includes('--check');
let bad = 0;

for (const blk of BLOCKS) {
    const BEGIN = '// ==== ' + blk.name + ' begin ====';
    const END = '// ==== ' + blk.name + ' end ====';
    const src = fs.readFileSync(path.join(__dirname, blk.src), 'utf8')
        .replace(/\r\n/g, '\n').trimEnd().split('\n');

    for (const rel of blk.targets) {
        const file = path.join(ROOT, rel);
        if (!fs.existsSync(file)) { console.log('missing  ' + blk.name + '  ' + rel); bad++; continue; }
        const raw = fs.readFileSync(file, 'utf8');
        const eol = raw.includes('\r\n') ? '\r\n' : '\n';
        const lines = raw.replace(/\r\n/g, '\n').split('\n');
        const b = lines.findIndex(l => l.trim() === BEGIN);
        const e = lines.findIndex((l, i) => i > b && l.trim() === END);
        if (b < 0 || e < 0) { console.log('no markers  ' + blk.name + '  ' + rel); bad++; continue; }
        const unit = lines[b].match(/^\s*/)[0];
        const step = unit.length === 2 ? '  ' : '    ';
        const block = src.map(l => l ? unit + l.replace(/^( {4})+/, m => step.repeat(m.length / 4)) : l);
        if (lines.slice(b, e + 1).join('\n') === block.join('\n')) { console.log('same     ' + blk.name + '  ' + rel); continue; }
        if (check) { console.log('DIFFERS  ' + blk.name + '  ' + rel); bad++; continue; }
        const next = lines.slice(0, b).concat(block, lines.slice(e + 1)).join('\n');
        fs.writeFileSync(file, eol === '\r\n' ? next.replace(/\n/g, '\r\n') : next, 'utf8');
        console.log('written  ' + blk.name + '  ' + rel);
    }
}
process.exit(bad ? 1 : 0);
