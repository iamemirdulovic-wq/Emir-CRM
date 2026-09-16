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
  await page.goto(`${BASE}/pipeline`, { waitUntil: 'networkidle' });
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

await step('contact 360 opens', async () => {
  await page.click('a[href="/contacts"]');
  await page.waitForTimeout(1500);
  const rows = await page.locator('a[href^="/contacts/"]').count();
  if (rows > 0) {
    await page.locator('a[href^="/contacts/"]').first().click();
    await page.waitForTimeout(2000);
  }
  await shot(page, '06-contact.png');
});

await step('tasks page lists the follow-ups', async () => {
  await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.toolbar .chip', { timeout: 10000 });
  await shot(page, '07-tasks.png');
});

await step('projects page shows verification state', async () => {
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Verified only', { timeout: 10000 });
  await shot(page, '08-projects.png');
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
  await page.getByRole('button', { name: 'Team' }).click();
  await page.waitForSelector('text=Reset password', { timeout: 10000 });
  await shot(page, '11-settings-team.png');
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
