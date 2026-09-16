import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3111';
const OUT = process.env.OUTDIR;
const errors = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message}`);
    errors.push(`${name}: ${err.message}`);
  }
};

await step('login page renders', async () => {
  await page.goto(`${BASE}/board`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Emir CRM', { timeout: 10000 });
  if (!page.url().includes('/login')) throw new Error(`expected redirect to /login, got ${page.url()}`);
  await page.screenshot({ path: `${OUT}/01-login.png` });
});

await step('rejects a wrong password', async () => {
  await page.fill('#email', 'owner@emircrm.local');
  await page.fill('#password', 'wrong-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]', { timeout: 10000 });
});

await step('signs in', async () => {
  await page.fill('#password', 'ChangeMe123!');
  await page.click('button[type=submit]');
  await page.waitForURL(/change-password|board/, { timeout: 15000 });
});

await step('forces the temporary password change', async () => {
  if (!page.url().includes('change-password')) throw new Error('expected the change-password gate');
  await page.fill('#current', 'ChangeMe123!');
  await page.fill('#next', 'OwnerPass2026!');
  await page.fill('#confirm', 'OwnerPass2026!');
  await page.screenshot({ path: `${OUT}/02-change-password.png` });
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
  await page.screenshot({ path: `${OUT}/03-board.png`, fullPage: false });
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
  await page.screenshot({ path: `${OUT}/04-inbox.png` });
});

await step('contact 360 opens', async () => {
  await page.click('a[href="/contacts"]');
  await page.waitForTimeout(1500);
  const rows = await page.locator('a[href^="/contacts/"]').count();
  if (rows > 0) {
    await page.locator('a[href^="/contacts/"]').first().click();
    await page.waitForTimeout(2000);
  }
  await page.screenshot({ path: `${OUT}/05-contact.png`, fullPage: true });
});

await step('projects page shows verification state', async () => {
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Projects', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/06-projects.png` });
});

await step('reports page renders', async () => {
  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Agent performance', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/07-reports.png`, fullPage: true });
});

await step('team page renders', async () => {
  await page.goto(`${BASE}/team`, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Add user', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/08-team.png` });
});

await step('mobile layout works', async () => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  await m.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await m.fill('#email', 'owner@emircrm.local');
  await m.fill('#password', 'OwnerPass2026!');
  await m.click('button[type=submit]');
  await m.waitForURL(/\/board/, { timeout: 15000 });
  await m.waitForSelector('nav[aria-label="Primary mobile"]', { timeout: 10000 });
  await m.screenshot({ path: `${OUT}/09-mobile-board.png` });
  await m.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(1500);
  await m.screenshot({ path: `${OUT}/10-mobile-inbox.png` });
  await mobile.close();
});

await step('the language toggle switches to Arabic and mirrors the layout', async () => {
  await page.goto(`${BASE}/board`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'العربية' }).click();
  await page.waitForTimeout(2500);
  const dir = await page.evaluate(() => document.documentElement.dir);
  if (dir !== 'rtl') throw new Error(`expected dir=rtl after the toggle, got ${dir}`);
  await page.screenshot({ path: `${OUT}/11-arabic-rtl.png` });
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

console.log(`\n${errors.length === 0 ? 'NO ERRORS' : `${errors.length} PROBLEM(S):`}`);
for (const e of errors) console.log(`  - ${e}`);
process.exit(errors.length === 0 ? 0 : 1);
