/**
 * Regenerates every screenshot in the handbook, into img/.
 *
 * Runs against the PREVIEW build, which carries its own fixture data and talks
 * to no database. That is deliberate and not negotiable: the handbook is
 * printed and handed out, and a shot of the live CRM would put real clients'
 * names and phone numbers into a document that leaves the building.
 *
 * Shot as an agent, not the owner — an agent is who reads this, and their
 * sidebar is shorter.
 *
 *   npm --workspace web run build:preview
 *   cd web && npx vite preview --config vite.config.preview.ts --port 5182 &
 *   cd ../docs/handbook && node shots.mjs
 *
 * Then `python3 build.py && node topdf.mjs`.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire('/opt/node-tools/').call(null, 'playwright');

const BASE = process.env.SHOTS_BASE_URL ?? 'http://127.0.0.1:5182';
const RAW = 'raw', OUT = 'img';
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

const PREFS = JSON.stringify({
  tour_state: JSON.stringify({ step: 0, doneAt: '2026-01-01', skipped: false }),
});
/* Both float over the page. Each gets its own figure; everywhere else they sit
   on top of the thing being explained. */
const HIDE = '.newlead{display:none !important} .ask-fab{display:none !important}';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const log = [];

async function open(route, { keepFab = false, keepAlert = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 880 }, deviceScaleFactor: 2,
  });
  await ctx.addInitScript((prefs) => {
    try {
      localStorage.setItem('emir.theme', 'light');
      localStorage.setItem('emir.previewRole', 'agent');
      localStorage.setItem('homes.preview.prefs', prefs);
    } catch { /* private mode */ }
  }, PREFS);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'networkidle', timeout: 30000 });
  let css = HIDE;
  if (keepFab) css = css.replace('.ask-fab{display:none !important}', '');
  if (keepAlert) css = css.replace('.newlead{display:none !important}', '');
  if (css.trim()) await page.addStyleTag({ content: css });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

async function shot(name, route, opts = {}) {
  const { ctx, page } = await open(route, opts);
  try {
    if (opts.act) await opts.act(page);
    const target = opts.sel ? page.locator(opts.sel).first() : page;
    if (opts.sel) await target.waitFor({ state: 'visible', timeout: 8000 });
    await target.screenshot({ path: `${RAW}/${name}.png` });
    log.push(`  ok   ${name}`);
  } catch (err) {
    log.push(`  FAIL ${name} — ${err.message.split('\n')[0].slice(0, 70)}`);
  }
  await ctx.close();
}

/* whole screens */
for (const [name, route] of [
  ['s-dashboard', '/dashboard'], ['s-leads', '/leads'], ['s-lead', '/contacts/c-1'],
  ['s-incoming', '/incoming'], ['s-pipeline', '/pipeline'], ['s-projects', '/projects'],
  ['s-offers', '/offers'], ['s-wall', '/wall'], ['s-profile', '/profile'],
  ['s-card', '/tools/business-card'],
]) await shot(name, route);

/* close-ups, by the component's own class */
await shot('c-alert',   '/dashboard',    { keepAlert: true, sel: '.newlead' });
await shot('c-actions', '/contacts/c-1', { sel: '.lead-actions' });
await shot('c-brief',   '/contacts/c-1', { sel: '.brief' });
await shot('c-note',    '/contacts/c-1', { sel: '.note-compose' });
await shot('c-tabs',    '/leads',        { sel: '[role="tablist"]' });
await shot('c-sidebar', '/dashboard',    { sel: 'aside.side' });
await shot('c-leadrow', '/leads',        { sel: '[role="tabpanel"] li, .lead-row, tbody tr' });

/* things you have to open first */
await shot('o-shortcuts', '/leads', { sel: '.modal', act: async (p) => {
  await p.keyboard.press('?'); await p.waitForTimeout(800);
} });
await shot('o-palette', '/leads', { sel: '.palette', act: async (p) => {
  await p.keyboard.press('Control+k'); await p.waitForTimeout(800);
} });
await shot('o-ai', '/dashboard', { keepFab: true, sel: '.ask', act: async (p) => {
  await p.getByRole('button', { name: /Ask Emir AI/i }).first().click();
  await p.waitForTimeout(1200);
} });

/* a conversation whose 24-hour window has closed: the composer changes, which
   is the single most useful screenshot in the handbook */
await shot('s-inbox', '/inbox', { act: async (p) => {
  await p.getByText('Sara Al Mansoori').first().click(); await p.waitForTimeout(1400);
} });
await shot('s-inbox-closed', '/inbox', { act: async (p) => {
  await p.getByText('James Whitfield').first().click(); await p.waitForTimeout(1400);
} });

await browser.close();

/* 256 colours keeps UI screenshots crisp at a third of the size — a 20-page
   handbook of full-colour retina PNGs is a 40 MB file nobody can email. */
for (const line of log) {
  const name = line.trim().split(/\s+/)[1];
  if (!line.includes('ok')) continue;
  execFileSync('convert', [`${RAW}/${name}.png`, '-resize', '1700x>', '-colors', '256',
    '-strip', `${OUT}/${name}.png`]);
}
console.log(log.join('\n'));
