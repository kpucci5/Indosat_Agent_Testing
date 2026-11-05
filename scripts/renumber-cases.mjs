// Renumbers the live cases so there are no gaps after one is removed.
//   node scripts/renumber-cases.mjs
// Codes look like <letter><section>.<case> (e.g. G2.3). Sections count up per letter in the
// order areas appear in cases/index.json, and cases count up within each area file.
// References to renumbered codes in steps, expected and notes are updated too.
// Codes in other formats (e.g. EA-03) are left alone.
import fs from 'node:fs';

const dir = new URL('../cases/', import.meta.url);
const read = (f) => JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
const write = (f, v) => fs.writeFileSync(new URL(f, dir), JSON.stringify(v, null, 2) + '\n');
const CODE = /^([A-Za-z]+)(\d+)\.(\d+)$/;

const index = read('index.json');
const files = index.areas.map((a) => ({ file: a.file, cases: read(a.file) }));

const map = {}, sections = {};
for (const f of files) {
  const first = f.cases.map((c) => CODE.exec(c.code)).find(Boolean);
  if (!first) continue;
  const letter = first[1];
  const sec = sections[letter] = (sections[letter] || 0) + 1;
  let n = 0;
  for (const c of f.cases) {
    const m = CODE.exec(c.code);
    if (m && m[1] === letter) map[c.code] = `${letter}${sec}.${++n}`;
  }
}

const changed = Object.entries(map).filter(([a, b]) => a !== b);
if (!changed.length) { console.log('Already numbered in order.'); process.exit(0); }

// One pass, so G2.2 → G2.1 and G2.3 → G2.2 don't chain into each other.
const ref = new RegExp(`\\b(${Object.keys(map).map((k) => k.replace('.', '\\.')).join('|')})\\b`, 'g');
const fix = (s) => s.replace(ref, (k) => map[k]);
for (const f of files) {
  for (const c of f.cases) {
    c.code = map[c.code] || c.code;
    c.steps = c.steps.map(fix);
    c.expected = fix(c.expected);
    c.notes = c.notes.map(fix);
  }
  write(f.file, f.cases);
}
for (const [a, b] of changed) console.log(`${a} → ${b}`);
