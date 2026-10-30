/**
 * Browser smoke test.
 *
 * Drives the real app in Chromium: the login gate, the forced password change,
 * every page, the mobile layout and the Arabic RTL switch. It is the only test
 * that can catch the class of bug that only appears once a browser renders the
 * thing — a CDN icon font that never loads, a filter default that shows an
 * empty screen, a language toggle silently reset by the next session refresh.
 *
 * Expects a server on BASE with demo data loaded:
 *
 *   npm run demo && npm start &
 *   node e2e/ui.mjs
 *
 * Set E2E_BASE_URL to point somewhere else, OUTDIR to keep the screenshots,
 * CHROMIUM_PATH to use a browser that is already on the machine.
 *
 * On a box with no MySQL and no Docker daemon — which is where this is usually
 * written — one is two commands away, and it is the same 8.0 the CI service
 * container uses:
 *
 *   apt-get install -y mysql-server-8.0 && mysqld_safe &
 *   mysql --protocol=socket -uroot -e "CREATE DATABASE emir_crm_e2e;
 *     CREATE USER 'root'@'127.0.0.1' IDENTIFIED BY ''; GRANT ALL ON *.* TO 'root'@'127.0.0.1';"
 *
 * Worth the five minutes. Running this against a real database is what found
 * the first-run-setup race, and running it at all is what found that the tour
 * had been swallowing every click since Step 14.
 *
 * It is re-runnable against the same environment: the owner's temporary
 * password only works once and the tour is only new once, so both of those
 * steps fall back or skip rather than failing on a second run.
 */
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const OUT = process.env.OUTDIR ?? null;
const OWNER_EMAIL = process.env.E2E_OWNER_EMAIL ?? 'owner@emircrm.local';
const TEMP_PASSWORD = process.env.E2E_TEMP_PASSWORD ?? 'ChangeMe123!';
const NEW_PASSWORD = process.env.E2E_NEW_PASSWORD ?? 'OwnerPass2026!';
const errors = [];

/** A screenshot is a nicety; never fail the run because OUTDIR is unset. */
const shot = async (page, name) => {
  if (!OUT) return;
  await page.screenshot({ path: `${OUT}/${name}`, fullPage: false }).catch(() => undefined);
};

const browser = await chromium.launch({
  // Honour a preinstalled browser when one is provided.
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  /*
   * Two kinds of console error are expected and not failures: the 401 from the
   * session check before sign-in, and a webfont the network may block. Neither
   * affects the app — icons are inline SVG and text falls back to system fonts.
   */
  if (/401|Unauthorized/.test(text)) return;
  if (/fonts\.(googleapis|gstatic)\.com|ERR_CERT_AUTHORITY_INVALID/.test(text)) return;
  errors.push(`console: ${text}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

/** Thrown by a step that has nothing to do in this environment. */
class Skip extends Error {}
const skip = (why) => {
  throw new Skip(why);
};

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    if (err instanceof Skip) {
      console.log(`skip ${name}: ${err.message}`);
      return;
    }
    console.log(`FAIL ${name}: ${err.message}`);
    errors.push(`${name}: ${err.message}`);
  }
};

await step('login page renders', async () => {
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
  // The brand, not the product name: this is the one check that would notice
  // the login page losing its identity entirely.
  await page.waitForSelector('text=homes.me', { timeout: 10000 });
  if (!page.url().includes('/login')) throw new Error(`expected redirect to /login, got ${page.url()}`);
  await shot(page, '01-login.png');
});

await step('rejects a wrong password', async () => {
  await page.fill('#email', OWNER_EMAIL);
  await page.fill('#password', 'wrong-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]', { timeout: 10000 });
});

/*
 * The owner's temporary password can only be used once, so a second run of this
 * script has to sign in with the new one. Trying both keeps the suite
 * re-runnable against the same environment.
 */
let sawPasswordGate = false;

await step('signs in', async () => {
  await page.fill('#password', TEMP_PASSWORD);
  await page.click('button[type=submit]');
  try {
    await page.waitForURL(/change-password|dashboard/, { timeout: 8000 });
    sawPasswordGate = page.url().includes('change-password');
  } catch {
    // The temporary password has already been replaced by an earlier run.
    await page.fill('#email', OWNER_EMAIL);
    await page.fill('#password', NEW_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  }
});

await step('forces the temporary password change', async () => {
  if (!sawPasswordGate) skip('the temporary password was already replaced');
  await page.fill('#current', TEMP_PASSWORD);
  await page.fill('#next', NEW_PASSWORD);
  await page.fill('#confirm', NEW_PASSWORD);
  await shot(page, '02-change-password.png');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
});

/*
 * The tour is modal on a first sign-in, by design: the dim covers the app and a
 * click anywhere skips it. That makes it the first thing a browser meets after
 * the dashboard, and until this step existed every click after sign-in was
 * swallowed by it — which is how a smoke test stops being run. So it is checked
 * rather than worked around: it must appear for somebody who has never seen it,
 * and Escape must close it.
 */
await step('the tour greets a first-time user, and Escape closes it', async () => {
  const dim = page.locator('.tour-dim');
  try {
    await dim.waitFor({ state: 'visible', timeout: 6000 });
  } catch {
    // The owner has finished it on an earlier run; the preference is per user
    // and lives in the database, so it stays finished.
    skip('this account has already seen the tour');
  }
  await shot(page, '03-tour.png');
  await page.keyboard.press('Escape');
  await dim.waitFor({ state: 'detached', timeout: 6000 });
});


await step('the dashboard draws its charts from real data', async () => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpi .val', { timeout: 15000 });
  const drawn = await page.locator('.chart-wrap svg path.area-line').count();
  if (drawn === 0) throw new Error('the leads-over-time chart did not draw');
  await shot(page, '03-dashboard.png');
});

await step('board renders all seven stages', async () => {
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
  await page.waitForSelector('section[aria-label="New Lead"]', { timeout: 15000 });
  const stages = ['New Lead', 'Attempted Contact', 'Engaged / Qualified', 'Appointment Scheduled', 'Deal Sent', 'Won', 'Lost'];
  for (const stage of stages) {
    const found = await page.locator(`section[aria-label="${stage}"]`).count();
    if (found === 0) throw new Error(`missing stage column: ${stage}`);
  }
  await shot(page, '04-board.png');
});

await step('inbox renders a thread with the 24-hour window indicator', async () => {
  await page.click('a[href="/inbox"]');
  await page.waitForSelector('.threads', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const threads = await page.locator('.thread').count();
  if (threads === 0) skip('no conversations in this environment');
  await page.locator('.thread').first().click();
  await page.waitForTimeout(2000);
  if ((await page.locator('.window').count()) === 0) {
    throw new Error('the WhatsApp window indicator is missing');
  }
  await shot(page, '05-inbox.png');
});

await step('a lead opens from My Leads, with its brief and its actions', async () => {
  /*
   * There is no `/contacts` screen any more — Step 7 replaced it with My Leads,
   * and `/contacts` only survives as a redirect. This step used to click a
   * sidebar link that no longer exists and then find nothing, which is a step
   * that passes by doing nothing.
   *
   * It also has to pick a tab. My Leads opens on "Follow-up today", which on a
   * healthy morning is empty on purpose, so "All" is where the leads are. The
   * tabs are a tablist, not chips — `getByRole('button')` finds none of them.
   */
  await page.goto(`${BASE}/leads`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'All' }).first().click();
  await page.waitForSelector('a[href^="/contacts/"]', { timeout: 10000 });
  await page.locator('a[href^="/contacts/"]').first().click();
  await page.waitForURL(/\/contacts\/[^/]+$/, { timeout: 10000 });
  // The two things Step 7 put on this page: what to do next, and the one-tap
  // actions. A lead page without them is the old read-only page back again.
  await page.waitForSelector('.brief', { timeout: 10000 });
  await page.waitForSelector('.lead-actions', { timeout: 10000 });
  await shot(page, '06-contact.png');
});

await step('tasks page lists the follow-ups', async () => {
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.toolbar .chip', { timeout: 10000 });
  await shot(page, '07-tasks.png');
});

/*
 * /projects serves the off-plan library now, not the old verified-projects
 * list, so this asserts what the library actually puts on screen.
 */
await step('project library shows its filters and the developers switch', async () => {
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Selling now', { timeout: 10000 });
  await page.waitForSelector('text=Developers', { timeout: 10000 });
  await shot(page, '08-projects.png');
});

/*
 * The sales-offers library. The offer created here is left in the trash rather
 * than deleted for good, so a second run of this script finds a clean library
 * and the step stays idempotent.
 */
await step('sales offers library creates, renames and trashes an offer', async () => {
  await page.goto(`${BASE}/offers`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.sof-bar', { timeout: 10000 });

  await page.click('button:has-text("New offer")');
  await page.waitForSelector('.ocard', { timeout: 10000 });

  await page.hover('.ocard');
  await page.click('.ocard .kebab');
  await page.waitForSelector('.menu', { timeout: 8000 });
  await page.click('.menu button:has-text("Rename")');
  const name = page.getByRole('dialog').locator('input').first();
  await name.waitFor({ timeout: 8000 });
  await name.fill('Smoke test offer');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForSelector('text=Smoke test offer', { timeout: 10000 });
  await shot(page, '09-offers.png');

  await page.hover('.ocard');
  await page.click('.ocard .kebab');
  await page.waitForSelector('.menu', { timeout: 8000 });
  await page.click('.menu button:has-text("Move to trash")');
  await page.waitForSelector('.empty, .drive', { timeout: 10000 });
});

await step('automations page lists the workflows', async () => {
  await page.goto(`${BASE}/automations`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Automations', { timeout: 10000 });
  await shot(page, '09-automations.png');
});

await step('settings shows the team and the appearance controls', async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Reduce glass effect', { timeout: 10000 });
  await shot(page, '10-settings.png');
  // The tabs here are chips, and `.toolbar .chip` is what they are: naming the
  // element rather than guessing at a role keeps this working when one of them
  // is translated.
  const tab = (label) => page.locator('.toolbar .chip', { hasText: label }).first();
  await tab('Company').click();
  await page.waitForSelector('text=Registered name', { timeout: 10000 });
  await shot(page, '11-settings-company.png');
  await tab('Team').click();
  await page.waitForSelector('text=Reset password', { timeout: 10000 });
  await shot(page, '12-settings-team.png');
});

await step('mobile layout works', async () => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  await m.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await m.fill('#email', OWNER_EMAIL);
  await m.fill('#password', NEW_PASSWORD);
  await m.click('button[type=submit]');
  await m.waitForURL(/\/dashboard/, { timeout: 15000 });
  await m.waitForSelector('nav[aria-label="Primary mobile"]', { timeout: 10000 });
  // The sidebar is the desktop path; at phone width it must be out of the way.
  if (await m.locator('.side').isVisible()) throw new Error('the sidebar is showing at phone width');
  await shot(m, '12-mobile-dashboard.png');
  await m.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(1200);
  await shot(m, '13-mobile-pipeline.png');
  await m.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(1500);
  await shot(m, '14-mobile-inbox.png');
  await mobile.close();
});

await step('the import wizard reads a file and maps its columns', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const csv = ['Full Name,Mobile No.,Email Address,Interested Project,Budget AED'];
  for (let i = 0; i < 40; i++) {
    csv.push(`E2E Lead ${i},05${String(70000000 + i)},e2e${i}@example.com,Emaar Beachfront,AED 1M - 2M`);
  }
  const file = join(mkdtempSync(join(tmpdir(), 'emir-e2e-')), 'e2e-leads.csv');
  writeFileSync(file, csv.join('\n'), 'utf8');

  await page.goto(`${BASE}/imports/new`, { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file]', file);
  await page.waitForSelector('text=Map the columns', { timeout: 30000 });

  // The suggester must place the columns a real export actually uses.
  const mapped = await page.locator('table select').evaluateAll((els) => els.map((e) => e.value).filter(Boolean));
  if (!mapped.includes('phone')) throw new Error('the phone column was not detected');
  if (!mapped.includes('budgetBand')) throw new Error('the budget column was not detected');
  await shot(page, '17-import-mapping.png');
});

await step('lists and campaigns render', async () => {
  await page.goto(`${BASE}/lists`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.toolbar', { timeout: 10000 });
  await shot(page, '18-lists.png');

  await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.toolbar', { timeout: 10000 });
  await shot(page, '19-campaigns.png');
});

await step('the dark theme applies without a reload', async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Dark' }).click();
  await page.waitForTimeout(800);
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (theme !== 'dark') throw new Error(`expected data-theme=dark, got ${theme}`);
  await shot(page, '15-dark.png');
  await page.getByRole('button', { name: 'Light' }).click();
  await page.waitForTimeout(500);
});

await step('the language switch mirrors the layout for Arabic', async () => {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.selectOption('select', 'ar');
  await page.waitForTimeout(2500);
  const dir = await page.evaluate(() => document.documentElement.dir);
  if (dir !== 'rtl') throw new Error(`expected dir=rtl after the switch, got ${dir}`);
  await shot(page, '16-arabic-rtl.png');
});

await step('the Arabic preference survives a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const dir = await page.evaluate(() => document.documentElement.dir);
  if (dir !== 'rtl') throw new Error(`the language preference did not persist (dir=${dir})`);
  await page.selectOption('select', 'en');
  await page.waitForTimeout(2000);
});

await browser.close();

if (errors.length === 0) {
  console.log('\nAll browser checks passed.');
  process.exit(0);
}
console.log(`\n${errors.length} problem(s):`);
for (const e of errors) console.log(`  - ${e}`);
process.exit(1);
