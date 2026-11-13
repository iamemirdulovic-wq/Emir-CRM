/**
 * Two folders of desktop screenshots, compared pixel for pixel.
 *
 * The phone work must not touch 768px and wider. `npm run polish` says a page
 * is not broken; this says a page did not change, which is the promise the
 * owner actually asked for.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [before, after] = process.argv.slice(2);
if (!before || !after) {
  console.error('usage: node scripts/desktop-diff.mjs <before> <after>');
  process.exit(1);
}
const sum = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const list = (d) => new Set(readdirSync(d).filter((f) => f.endsWith('.png')));

const a = list(before);
const b = list(after);
const changed = [];
const missing = [];

for (const f of a) {
  if (!b.has(f)) { missing.push(`${f} — gone`); continue; }
  if (sum(path.join(before, f)) !== sum(path.join(after, f))) changed.push(f);
}
for (const f of b) if (!a.has(f)) missing.push(`${f} — new`);

if (changed.length === 0 && missing.length === 0) {
  console.log(`all ${a.size} computer screens are identical`);
  process.exit(0);
}
console.log(`${changed.length} changed, ${missing.length} added or gone, of ${a.size}`);
for (const f of [...changed, ...missing].sort()) console.log(`  ${f}`);
process.exit(1);
