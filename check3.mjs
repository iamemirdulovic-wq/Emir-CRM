import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/claude-0/-home-user-Emir-CRM/d25e41ad-dd7b-5b85-aa9e-7b42e8ece14e/scratchpad/three';
mkdirSync(OUT, { recursive: true });

const PAGES = [
  ['pipeline-owner', 'owner', '/v2/pipeline'],
  ['pipeline-agent', 'agent', '/v2/pipeline'],
  ['ai-owner', 'owner', '/v2/ai'],
  ['ai-agent', 'agent', '/v2/ai'],
  ['activity-owner', 'owner', '/v2/activity'],
];

const browser = await chromium.launch();

for (const [name, role, path] of PAGES) {
  for (const [label, size] of [['wide', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: label === 'wide' ? 2 : 2 });
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', (e) => problems.push(String(e)));
    await page.goto(`http://127.0.0.1:5182/?as=${role}#${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${name}-${label}.png`, fullPage: label === 'phone' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (problems.length || overflow) console.log(name, label, 'overflow:', overflow, problems.slice(0, 3));
    await ctx.close();
  }
}

// The extra tabs on Activity.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5182/?as=owner#/v2/activity', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
for (const [label, text] of [['signins', 'Sign-ins'], ['unusual', 'Unusual']]) {
  await page.getByRole('tab', { name: new RegExp(text) }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/activity-${label}-wide.png` });
}
await page.getByRole('button', { name: 'Review' }).first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/activity-review-wide.png` });
await ctx.close();

// The AI screen with a question asked.
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page2 = await ctx2.newPage();
await page2.goto('http://127.0.0.1:5182/?as=agent#/v2/ai', { waitUntil: 'networkidle' });
await page2.waitForTimeout(700);
await page2.getByRole('button', { name: 'Who should I call first?' }).click();
await page2.waitForTimeout(900);
await page2.screenshot({ path: `${OUT}/ai-answered-wide.png` });
await ctx2.close();

await browser.close();
console.log('shots in', OUT);
