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

  const moved = [];
  const gone = [];
  const added = [];

  for (const key of Object.keys(before)) {
    if (!(key in after)) { gone.push(key); continue; }
    const a = before[key];
    const b = after[key];
    if (a.length !== b.length) {
      moved.push(`${key}: ${a.length} elements became ${b.length}`);
      continue;
    }
    let worst = null;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i].what !== b[i].what) { worst = `${a[i].what} became ${b[i].what}`; break; }
      const d = Math.max(
        Math.abs(a[i].x - b[i].x), Math.abs(a[i].y - b[i].y),
        Math.abs(a[i].w - b[i].w), Math.abs(a[i].h - b[i].h),
      );
      /* A pixel of rounding is not a layout change. */
      if (d > 1) { worst = `${a[i].what} moved ${d}px`; break; }
    }
    if (worst) moved.push(`${key}: ${worst}`);
  }
  for (const key of Object.keys(after)) if (!(key in before)) added.push(key);

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
