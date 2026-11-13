/**
 * Every v2 page at 1440 x 1000, light and dark, to a folder.
 *
 * Run it once before touching the phone layout and once after: the two
 * folders must be identical. `npm run polish` says a page is not broken;
 * this says a page did not change, which is a different promise.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const BASE = process.env.SHOT_BASE_URL ?? 'http://127.0.0.1:5182';
if (!OUT) { console.error('usage: node scripts/desktop-shots.mjs <folder>'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

/* The route list is read from App.tsx, so a new page cannot be forgotten. */
const app = readFileSync(new URL('../web/src/App.tsx', import.meta.url), 'utf8');
const routes = [...app.matchAll(/path="(\/v2[^"]*)"/g)]
  .map((m) => m[1])
  .filter((p) => !p.includes(':'))
  .sort();
/* The three that only exist with a record behind them. */
routes.push('/v2/leads/o-1', '/v2/projects/p-1', '/v2/team/u-2');

const OWNER_ONLY = /\/v2\/(dashboard|team-live|activity|messaging|import|settings\/(team|desks|banners|feedback|health|ai|attendance|automations|company)|projects\/manage)/;

const b = await chromium.launch();
for (const route of routes) {
  const role = OWNER_ONLY.test(route) ? 'owner' : 'agent';
  for (const theme of ['light', 'dark']) {
    const page = await b.newPage({
      viewport: { width: 1440, height: 1000 }, colorScheme: theme, deviceScaleFactor: 1,
    });
    await page.goto(`${BASE}/?as=${role}#${route}`, { waitUntil: 'networkidle' });
    /* Animations finish, counters land, charts draw. */
    await page.waitForTimeout(1500);
    const name = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
    await page.screenshot({ path: `${OUT}/${name}__${theme}.png`, fullPage: true });
    await page.close();
  }
  process.stdout.write('.');
}
await b.close();
console.log(`\n${routes.length} pages x 2 themes -> ${OUT}`);
