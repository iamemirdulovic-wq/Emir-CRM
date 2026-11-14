/**
 * Count the cells that are actually clipped in the leads table.
 *
 * Written on 14 Nov, after a column budget was argued three times from
 * taste and shipped twice without being looked at. A cut name is not a
 * matter of opinion: either the text is wider than the box it is in or it
 * is not, and the browser will say which. This asks it.
 *
 * It reports per column, per role, at whatever widths are given, so a
 * change to one column can be seen paying for itself somewhere else — which
 * is the thing that kept going wrong. Giving the Project 44px looked like a
 * win until you counted the next step.
 *
 *   node scripts/leads-columns.mjs --base http://127.0.0.1:5173
 *   node scripts/leads-columns.mjs --widths 1280,1440,1600 --role agent
 *
 * The base must be a preview build started with its own config:
 *
 *   cd web && PREVIEW_OUT=/tmp/prev npm run build:preview
 *   npx vite preview --config vite.config.preview.ts --outDir /tmp/prev
 *
 * Without `--config` the preview proxies /api to localhost:3000 and every
 * row is an error card, which counts as zero clipped cells and proves
 * nothing. That has cost twenty minutes more than once.
 */
import { chromium } from 'playwright';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = arg('base', 'http://127.0.0.1:4173').replace(/\/$/, '');
const WIDTHS = arg('widths', '1280,1440,1600').split(',').map((n) => Number(n.trim()));
const ROLES = arg('role', 'agent,owner').split(',').map((r) => r.trim());

/** What the page is asked for, and what is counted once it is there. */
const measure = () => {
  const table = document.querySelector('.d-id-leads');
  if (!table) return { error: 'no leads table on the page' };
  const heads = [...table.querySelectorAll('thead th')]
    .map((th, i) => th.textContent.trim() || (i === 0 ? 'tick' : 'buttons'));
  const widths = [...table.querySelectorAll('thead th')]
    .map((th) => Math.round(th.getBoundingClientRect().width));
  const byColumn = {};
  const example = {};
  for (const td of table.querySelectorAll('tbody td')) {
    const i = [...td.parentElement.children].indexOf(td);
    const name = heads[i] ?? `#${i}`;
    /* The cell itself or anything inside it: the ellipsis is set on a span
       in some columns and on the td in others, and a line clamp reports on
       whichever element carries it. */
    for (const el of [td, ...td.querySelectorAll('*')]) {
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
        byColumn[name] = (byColumn[name] ?? 0) + 1;
        example[name] ??= el.innerText.trim().replace(/\s+/g, ' ').slice(0, 40);
        break;
      }
    }
  }
  const card = table.closest('.d-card') ?? table.parentElement;
  return {
    byColumn,
    example,
    widths: heads.map((h, i) => `${h}=${widths[i]}`),
    sideways: card.scrollWidth > card.clientWidth + 1,
  };
};

const browser = await chromium.launch();
let worst = 0;
try {
  for (const width of WIDTHS) {
    for (const role of ROLES) {
      const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/?as=${role}#/v2/leads`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.d-id-leads tbody tr', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);
      const out = await page.evaluate(measure);
      if (out.error) {
        console.log(`\n== ${role} @ ${width}px ==  ${out.error}`);
        await ctx.close();
        continue;
      }
      const total = Object.values(out.byColumn).reduce((a, b) => a + b, 0);
      worst = Math.max(worst, total);
      console.log(`\n== ${role} @ ${width}px ==  ${total} clipped cell${total === 1 ? '' : 's'}${out.sideways ? '  ** SIDEWAYS SCROLL **' : ''}`);
      console.log(`   ${out.widths.join('  ')}`);
      for (const [col, n] of Object.entries(out.byColumn).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${col.padEnd(16)} ${String(n).padStart(3)}   e.g. ${out.example[col]}`);
      }
      if (!total) console.log('   nothing clipped.');
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`\nworst single screen: ${worst} clipped cells`);
