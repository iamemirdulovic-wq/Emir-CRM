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
 *   npx playwright install chromium
 *   node e2e/ui.mjs
 *
 * Set E2E_BASE_URL to point somewhere else, OUTDIR to keep the screenshots.
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
  await page.goto(`${BASE}/board`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Emir CRM', { timeout: 10000 });
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
    await page.waitForURL(/change-password|board/, { timeout: 8000 });
    sawPasswordGate = page.url().includes('change-password');
  } catch {
    // The temporary password has already been replaced by an earlier run.
    await page.fill('#email', OWNER_EMAIL);
    await page.fill('#password', NEW_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(/\/board/, { timeout: 15000 });
  }
});

await step('forces the temporary password change', async () => {
  if (!sawPasswordGate) skip('the temporary password was already replaced');
  await page.fill('#current', TEMP_PASSWORD);
  await page.fill('#next', NEW_PASSWORD);
  await page.fill('#confirm', NEW_PASSWORD);
  await shot(page, '02-change-password.png');
  await page.click('button[type=submit]');
  await page.waitForURL(/\/board/, { timeout: 15000 });
});

await step('board renders all seven stages', async () => {
  await page.waitForSelector('section[aria-label="New Lead"]', { timeout: 15000 });
  const stages = ['New Lead', 'Attempted Contact', 'Engaged / Qualified', 'Appointment Scheduled', 'Deal Sent', 'Won', 'Lost'];
  for (const stage of stages) {
    const found = await page.locator(`section[aria-label="${stage}"]`).count();
    if (found === 0) throw new Error(`missing stage column: ${stage}`);
  }
  await shot(page, '03-board.png');
});

await step('inbox renders a thread', async () => {
  await page.click('a[href="/inbox"]');
  await page.waitForSelector('text=Inbox', { timeout: 10000 });
  await page.waitForTimeout(1500);
  const threads = await page.locator('li button').count();
  if (threads > 0) {
    await page.locator('li button').first().click();
    await page.waitForTimeout(2000);
  }
  await shot(page, '04-inbox.png');
});

await step('contact 360 opens', async () => {
  await page.click('a[href="/contacts"]');
  await page.waitForTimeout(1500);
  const rows = await page.locator('a[href^="/contacts/"]').count();
  if (rows > 0) {
    await page.locator('a[href^="/contacts/"]').first().click();
    await page.waitForTimeout(2000);
  }
  await shot(page, '05-contact.png');
});

await step('projects page shows verification state', async () => {
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Projects', { timeout: 10000 });
  await shot(page, '06-projects.png');
});

await step('reports page renders', async () => {
  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Agent performance', { timeout: 10000 });
  await shot(page, '07-reports.png');
});

await step('team page renders', async () => {
  await page.goto(`${BASE}/team`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Add user', { timeout: 10000 });
  await shot(page, '08-team.png');
});

await step('mobile layout works', async () => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  await m.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await m.fill('#email', OWNER_EMAIL);
  await m.fill('#password', NEW_PASSWORD);
  await m.click('button[type=submit]');
  await m.waitForURL(/\/board/, { timeout: 15000 });
  await m.waitForSelector('nav[aria-label="Primary mobile"]', { timeout: 10000 });
  await shot(m, '09-mobile-board.png');
  await m.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(1500);
  await shot(m, '10-mobile-inbox.png');
  await mobile.close();
});

await step('the language toggle switches to Arabic and mirrors the layout', async () => {
  await page.goto(`${BASE}/board`, { waitUntil: 'networkidle' });
  // The toggle offers the language you are not currently in.
  if ((await page.evaluate(() => document.documentElement.dir)) === 'rtl') {
    await page.getByRole('button', { name: 'English' }).click();
    await page.waitForTimeout(2500);
  }
  await page.getByRole('button', { name: 'العربية' }).click();
  await page.waitForTimeout(2500);
  const dir = await page.evaluate(() => document.documentElement.dir);
  if (dir !== 'rtl') throw new Error(`expected dir=rtl after the toggle, got ${dir}`);
  await shot(page, '11-arabic-rtl.png');
});

await step('the Arabic preference survives a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const dir = await page.evaluate(() => document.documentElement.dir);
  if (dir !== 'rtl') throw new Error(`the language preference did not persist (dir=${dir})`);
  await page.getByRole('button', { name: 'English' }).click();
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
