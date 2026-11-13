/**
 * One picture per computer page: the design on the left, the build on the right.
 *
 * The phone side of this (`phone-proof.mjs`) has to use the owner's own
 * screenshots, because those prototypes need a `support.js` that is not in
 * this repository and rendering one stacks every conditional state on top of
 * the others. The computer pages have no such problem: `design/web/*.html`
 * are complete pages with their own `ui.css` and `app.js`, so this script
 * renders the real design file beside the real build and nobody has to take
 * a claim on trust.
 *
 * Both panels are the whole page, not the first screenful, because most of
 * what goes missing in a rebuild goes missing below the fold.
 *
 * Two differences are expected and are NOT findings:
 *   - the design package is in the old green palette; `docs/v2/phone-shell.md`
 *     and the master prompt's §1.1 carry the mapping to orange;
 *   - the design's numbers are invented, the build's come from the preview's
 *     own data, so figures will not match. Layout, blocks, fields, buttons
 *     and wording are what this is for.
 *
 * Usage:
 *   node scripts/computer-proof.mjs                 # all of them
 *   node scripts/computer-proof.mjs lead calendar   # just these
 *
 * The preview must be running (start it from inside `web/`), on 5182 or
 * wherever PROOF_BASE_URL points.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PROOF_BASE_URL ?? 'http://127.0.0.1:5182';
const OUT = path.join(ROOT, 'docs/v2/proof');
/* One scratch folder per run: two runs sharing one emptied each other's
   half way through the stitch step. Same reason as in phone-proof.mjs. */
const SHOTS = path.join(OUT, `.shots-${process.pid}`);

const WIDTH = 1440;

/**
 * Every computer page in the design package, against where it lives in the
 * build. Taken from the table in `docs/v2/screens.md`; `components.html` and
 * `index.html` are the package's own kit and index, not screens.
 *
 * The role matters: four of these pages are the same address seen by two
 * different people, and the design draws them as separate files.
 */
export const PAGES = [
  // ── home, leads, calling ───────────────────────────────────────────────
  ['my-day', '/v2', 'agent'],
  ['owner-home', '/v2', 'owner'],
  ['dashboard', '/v2/dashboard', 'owner'],
  ['incoming', '/v2/incoming', 'agent'],
  ['my-leads', '/v2/leads', 'agent'],
  ['all-leads', '/v2/leads', 'owner'],
  ['lead', '/v2/leads/o-1', 'agent'],
  ['add-lead', '/v2/leads/new', 'agent'],
  ['calling', '/v2/calling', 'agent'],
  ['pipeline', '/v2/pipeline', 'agent'],
  ['transfers', '/v2/transfers', 'agent'],
  ['import', '/v2/import', 'owner'],

  // ── the diary ──────────────────────────────────────────────────────────
  ['calendar', '/v2/calendar', 'agent'],
  ['tasks', '/v2/tasks', 'agent'],

  // ── projects and offers ────────────────────────────────────────────────
  ['projects', '/v2/projects', 'agent'],
  ['project', '/v2/projects/p-1', 'agent'],
  ['manage-projects', '/v2/projects/manage', 'owner'],
  ['sales-offers', '/v2/offers', 'agent'],

  // ── people ─────────────────────────────────────────────────────────────
  ['team', '/v2/team', 'agent'],
  ['profile', '/v2/profile', 'agent'],
  ['digital-card', '/v2/card', 'agent'],
  ['team-wall', '/v2/wall', 'agent'],
  ['best-of-homes', '/v2/best', 'agent'],
  ['attendance', '/v2/attendance', 'agent'],
  ['team-attendance', '/v2/attendance', 'owner'],
  ['team-live', '/v2/team-live', 'owner'],
  ['team-activity', '/v2/activity', 'owner'],

  // ── talking to clients ─────────────────────────────────────────────────
  ['messaging-report', '/v2/messaging', 'owner'],
  ['inbox', '/v2/inbox', 'agent'],
  ['email', '/v2/email', 'agent'],
  ['templates', '/v2/templates', 'agent'],
  ['homes-ai', '/v2/ai', 'agent'],
  ['notifications', '/v2/notifications', 'agent'],
  ['search', '/v2/search', 'agent'],
  ['feedback', '/v2/feedback', 'agent'],

  // ── the owner's own screens ────────────────────────────────────────────
  ['automations', '/v2/automations', 'owner'],
  ['settings', '/v2/settings', 'agent'],
  ['company', '/v2/settings/company', 'owner'],
  ['settings-team', '/v2/settings/team', 'owner'],
  ['settings-attendance', '/v2/settings/attendance', 'owner'],
  ['ai-settings', '/v2/settings/ai', 'owner'],
  ['desks', '/v2/settings/desks', 'owner'],
  ['home-banners', '/v2/settings/banners', 'owner'],
  ['feedback-inbox', '/v2/settings/feedback', 'owner'],
  ['system-health', '/v2/settings/health', 'owner'],
  ['install-guide', '/v2/settings/phone-app', 'agent'],
  ['login', '/v2/login', 'agent'],
];

const wanted = process.argv.slice(2);
const list = wanted.length > 0 ? PAGES.filter(([key]) => wanted.includes(key)) : PAGES;
if (list.length === 0) {
  console.error(`nothing matched. Known pages:\n  ${PAGES.map(([k]) => k).join(', ')}`);
  process.exit(1);
}

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const missed = [];

/**
 * Both sides ask Google for Inter and Manrope, and every one of those goes
 * out through the container's proxy — about a second each, two loads a page.
 * The comparison is layout and wording, not the typeface.
 */
async function noWebFonts(page) {
  await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
}

/* A tall cap: a few of these pages are very long, and a picture 12,000px
   high is unreadable and enormous. Noted on the picture when it bites. */
const MAX_HEIGHT = 5200;

async function shoot(page, file) {
  await page.waitForTimeout(1200);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const clipped = height > MAX_HEIGHT;
  await page.screenshot({
    path: file,
    ...(clipped
      ? { clip: { x: 0, y: 0, width: WIDTH, height: MAX_HEIGHT } }
      : { fullPage: true }),
  });
  return clipped;
}

const trimmed = new Set();

/**
 * Every design page declares `data-role` and, on most of them, `data-sub` —
 * the line under the title. Reading them from the file beats keeping a second
 * copy in this script that can drift: `data-role="owner"` means the design
 * draws that page as the owner, and the build has to be shot as the owner or
 * the two sidebars will not even match.
 *
 * `data-role="any"` means the design does not care, so the role in the list
 * above stands — that is also how the four pages that are one address seen by
 * two people (my-leads / all-leads, attendance / team-attendance) keep their
 * own rows.
 */
function designHead(file) {
  const body = (readFileSync(file, 'utf8').match(/<body[^>]*>/) ?? [''])[0];
  const read = (name) => (body.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1] ?? null;
  return { role: read('data-role'), sub: read('data-sub'), title: read('data-title') };
}

const subs = [];

for (const [key, route, listRole] of list) {
  const designFile = path.join(ROOT, 'design/web', `${key}.html`);
  if (!existsSync(designFile)) {
    missed.push(`${key}: design/web/${key}.html is not there`);
    continue;
  }
  const head = designHead(designFile);
  const role = head.role === 'owner' || head.role === 'agent' ? head.role : listRole;

  /* The design. Rendered from the file itself, so this cannot drift. */
  const dPage = await browser.newPage({
    viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'light',
  });
  await noWebFonts(dPage);
  await dPage.goto(`file://${designFile}`, { waitUntil: 'networkidle' }).catch(() => {});
  if (await shoot(dPage, path.join(SHOTS, `${key}-design.png`))) trimmed.add(key);
  await dPage.close();

  /* The build, at the same width, light theme, as the right person. */
  const bPage = await browser.newPage({
    viewport: { width: WIDTH, height: 1000 }, deviceScaleFactor: 1, colorScheme: 'light',
  });
  await noWebFonts(bPage);
  const errors = [];
  bPage.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
  await bPage.goto(`${BASE}/?as=${role}#${route}`, { waitUntil: 'networkidle' }).catch(() => {});
  await bPage.waitForTimeout(900);
  if (await shoot(bPage, path.join(SHOTS, `${key}-build.png`))) trimmed.add(key);
  if (errors.length > 0) missed.push(`${key}: the build threw — ${errors[0]}`);
  /* The design puts a line under the title on most pages — the date, the
     count, what the screen is for. Checked here rather than left to the eye,
     because it is the same omission repeated across forty pages and that is
     exactly the kind a person scrolling pictures stops noticing. */
  if (head.sub) {
    const shown = await bPage.locator('.v2-top .v2-tsub').count().catch(() => 0);
    if (shown === 0) subs.push(`${key}: "${head.sub}"`);
  }
  await bPage.close();

  process.stdout.write('.');
}

/* ── stitch ─────────────────────────────────────────────────────────────── */

const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

for (const [key, route, listRole] of list) {
  const designFile = path.join(ROOT, 'design/web', `${key}.html`);
  const head = existsSync(designFile) ? designHead(designFile) : { role: null };
  const role = head.role === 'owner' || head.role === 'agent' ? head.role : listRole;
  const design = path.join(SHOTS, `${key}-design.png`);
  const build = path.join(SHOTS, `${key}-build.png`);
  if (!existsSync(design) || !existsSync(build)) continue;

  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#EFEDE9;font:14px -apple-system,Segoe UI,Roboto,sans-serif;color:#16151A}
    .wrap{padding:24px 26px 28px}
    h1{font-size:21px;margin:0 0 4px;letter-spacing:-.01em}
    .sub{font-size:13px;color:#6B6A72;margin:0 0 18px}
    .note{color:#B3400E;font-weight:700}
    .cols{display:flex;gap:22px;align-items:flex-start}
    .col{width:${WIDTH}px}
    .tag{font-size:12.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin:0 0 8px;color:#6B6A72}
    .tag b{color:#FF4000}
    img{width:${WIDTH}px;display:block;border-radius:12px;box-shadow:0 2px 16px rgba(0,0,0,.15)}
  </style><div class="wrap">
    <h1>${key} — ${WIDTH}&nbsp;px</h1>
    <p class="sub">design/web/${key}.html &nbsp;·&nbsp; build at <code>${route}</code> as ${role}
      &nbsp;·&nbsp; the design is in the old green and its numbers are invented; compare layout, blocks, fields, buttons and wording${
        trimmed.has(key) ? ' &nbsp;·&nbsp; <span class="note">cut at ' + MAX_HEIGHT + 'px — open both files for the rest</span>' : ''
      }</p>
    <div class="cols">
      <div class="col"><p class="tag">Design</p><img src="${b64(design)}"></div>
      <div class="col"><p class="tag"><b>Built</b></p><img src="${b64(build)}"></div>
    </div>
  </div>`;

  const tmp = path.join(SHOTS, `${key}.html`);
  writeFileSync(tmp, html);
  const page = await browser.newPage({ viewport: { width: WIDTH * 2 + 70, height: 1000 } });
  await page.goto(`file://${tmp}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  /* JPEG at one device pixel. The phone set came to 51MB as PNG at two, and
     every re-run would add another 51MB to this repository for ever. */
  await page.screenshot({ path: path.join(OUT, `${key}.jpg`), fullPage: true, type: 'jpeg', quality: 82 });
  await page.close();
}

await browser.close();
rmSync(SHOTS, { recursive: true, force: true });
console.log(`\n${list.length} pictures -> docs/v2/proof/`);
if (missed.length > 0) {
  console.log('\nproblems:');
  for (const line of missed) console.log(`  ${line}`);
}
if (subs.length > 0) {
  console.log(`\nthe design gives these pages a line under the title and the build shows none (${subs.length}):`);
  for (const line of subs) console.log(`  ${line}`);
}
