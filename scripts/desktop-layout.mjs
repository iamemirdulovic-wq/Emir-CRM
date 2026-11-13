/**
 * The shape of every computer page, written down so it can be compared.
 *
 * The promise is "768px and wider does not change". The obvious way to check
 * that is a screenshot of every page before and after — and it does not work:
 * this CRM draws a live clock, counters that count up, and times written as
 * "since 06:05". Run the same code twice and a third of the pictures differ.
 * Measured: 31 of 96, with nothing changed at all.
 *
 * So this records geometry instead. For every element on the page: what it is,
 * what classes it carries, and where its box sits, rounded to the pixel. A
 * clock ticking does not move a box. A stylesheet rule escaping its media
 * query moves hundreds.
 *
 *   node scripts/desktop-layout.mjs before.json
 *   ... do the work ...
 *   node scripts/desktop-layout.mjs after.json
 *   node scripts/desktop-layout.mjs --diff before.json after.json
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SHOT_BASE_URL ?? 'http://127.0.0.1:5182';

/* ── compare ────────────────────────────────────────────────────────────── */

if (process.argv[2] === '--diff') {
  const [, , , beforeFile, afterFile] = process.argv;
  const before = JSON.parse(readFileSync(beforeFile, 'utf8'));
  const after = JSON.parse(readFileSync(afterFile, 'utf8'));

  /*
   * Align by name, not by position.
   *
   * The first version walked the two lists index by index, so one element
   * inserted near the top reported every element after it as moved: 70 of
   * 102 screens "changed" when a handful really had. Keying each element by
   * its tag-and-classes plus how many of that kind came before it compares
   * like with like, and an insertion shows up as what it is — one element
   * added — rather than as a hundred that moved.
   */
  const key = (list) => {
    const seen = new Map();
    const out = new Map();
    for (const one of list) {
      const n = (seen.get(one.what) ?? 0) + 1;
      seen.set(one.what, n);
      out.set(`${one.what}#${n}`, one);
    }
    return out;
  };

  const moved = [];
  const gone = [];
  const added = [];

  for (const name of Object.keys(before)) {
    if (!(name in after)) { gone.push(name); continue; }
    const a = key(before[name]);
    const b = key(after[name]);

    let worst = 0;
    let worstWhat = '';
    let shifted = 0;
    for (const [k, box] of a) {
      const other = b.get(k);
      if (!other) continue;
      const d = Math.max(
        Math.abs(box.x - other.x), Math.abs(box.y - other.y),
        Math.abs(box.w - other.w), Math.abs(box.h - other.h),
      );
      /* A pixel of rounding is not a layout change. */
      if (d > 1) { shifted += 1; if (d > worst) { worst = d; worstWhat = k; } }
    }
    const onlyBefore = [...a.keys()].filter((k) => !b.has(k));
    const onlyAfter = [...b.keys()].filter((k) => !a.has(k));

    if (shifted === 0 && onlyBefore.length === 0 && onlyAfter.length === 0) continue;
    const parts = [];
    if (shifted > 0) parts.push(`${shifted} moved, worst ${worst}px (${worstWhat})`);
    if (onlyBefore.length > 0) parts.push(`${onlyBefore.length} gone: ${onlyBefore.slice(0, 3).join(', ')}`);
    if (onlyAfter.length > 0) parts.push(`${onlyAfter.length} new: ${onlyAfter.slice(0, 3).join(', ')}`);
    moved.push(`${name}: ${parts.join(' · ')}`);
  }
  for (const name of Object.keys(after)) if (!(name in before)) added.push(name);

  if (moved.length === 0 && gone.length === 0 && added.length === 0) {
    console.log(`all ${Object.keys(before).length} computer screens have the same shape`);
    process.exit(0);
  }
  console.log(`${moved.length} changed, ${gone.length} gone, ${added.length} new, of ${Object.keys(before).length}`);
  for (const line of [...moved, ...gone.map((k) => `${k}: gone`), ...added.map((k) => `${k}: new`)]) {
    console.log(`  ${line}`);
  }
  process.exit(1);
}

/* ── record ─────────────────────────────────────────────────────────────── */

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/desktop-layout.mjs <file.json> | --diff <a> <b>');
  process.exit(1);
}

const app = readFileSync(path.join(ROOT, 'web/src/App.tsx'), 'utf8');
const routes = [...app.matchAll(/path="(\/v2[^"]*)"/g)]
  .map((m) => m[1]).filter((p) => !p.includes(':')).sort();
routes.push('/v2/leads/o-1', '/v2/projects/p-1', '/v2/team/u-2');

const OWNER_ONLY = /\/v2\/(dashboard|team-live|activity|messaging|import|settings\/(team|desks|banners|feedback|health|ai|attendance|automations|company)|projects\/manage)/;

/**
 * What is worth recording about an element.
 *
 * Its text is not: a clock changes, a lead's name is random in the stand-in
 * data. Its tag, its classes and its box are the layout.
 */
const MEASURE = () => [...document.querySelectorAll('.v2 *')]
  .map((el) => {
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
    return {
      what: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`,
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
    };
  })
  .filter((one) => one.w > 0 && one.h > 0);

const browser = await chromium.launch();
const shapes = {};

for (const route of routes) {
  const role = OWNER_ONLY.test(route) ? 'owner' : 'agent';
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 }, colorScheme: theme,
    });
    await page.goto(`${BASE}/?as=${role}#${route}`, { waitUntil: 'networkidle' });
    /* Let every animation land, or a card caught mid-rise reads as moved. */
    await page.waitForTimeout(1600);
    shapes[`${route} [${theme}]`] = await page.evaluate(MEASURE);
    await page.close();
  }
  process.stdout.write('.');
}
await browser.close();

writeFileSync(out, JSON.stringify(shapes, null, 1));
const n = Object.values(shapes).reduce((sum, list) => sum + list.length, 0);
console.log(`\n${Object.keys(shapes).length} screens, ${n} elements -> ${out}`);
