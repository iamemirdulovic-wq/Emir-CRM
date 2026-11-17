import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/opt/node-tools/node_modules/playwright/index.js');

/**
 * Pictures of Homes AI, for Emir to look at before it goes anywhere near the
 * live site. Computer and phone, empty and answering, because the empty state
 * is what an agent sees every morning and the draft card is the thing the
 * page exists for.
 */
const OUT = '/home/user/Emir-CRM/docs/v2/ai-page';
const AT = 'http://localhost:4180/#/v2/ai';
const browser = await chromium.launch();
const errors = [];

async function shot(page, name) { await page.screenshot({ path: `${OUT}/${name}.png` }); }

const big = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
big.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await big.goto(AT, { waitUntil: 'networkidle' });
await big.waitForTimeout(1500);
await shot(big, 'new-computer-empty');

await big.locator('.v2-ai2-card').filter({ hasText: 'Write a WhatsApp' }).click();
await big.waitForTimeout(2000);
await shot(big, 'new-computer-draft');

const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await phone.goto(AT, { waitUntil: 'networkidle' });
await phone.waitForTimeout(1500);
await shot(phone, 'new-phone-empty');

await phone.locator('.v2-ai2-card').filter({ hasText: 'Write a WhatsApp' }).click();
await phone.waitForTimeout(2000);
await shot(phone, 'new-phone-draft');

console.log('console errors:', errors.slice(0, 4));
await browser.close();
