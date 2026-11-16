import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/opt/node-tools/node_modules/playwright/index.js');

const OUT = '/home/user/Emir-CRM/docs/v2/claude-proof';
const BASE = 'http://localhost:4178/#';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function go(hash) {
  await page.goto(`${BASE}${hash}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

// 1 — the settings page
await go('/v2/settings/ai');
await page.waitForTimeout(800);
await page.locator('.d-card').filter({ hasText: 'The key' }).first()
  .screenshot({ path: `${OUT}/1-settings-claude-key.png` });

// 2 — Test the key
const test = page.getByRole('button', { name: 'Test the key' });
console.log('test button found:', await test.count());
await test.first().click();
await page.waitForTimeout(1500);
await page.locator('.d-card').filter({ hasText: 'The key' }).first()
  .screenshot({ path: `${OUT}/2-test-the-key.png` });

// 3 — Homes AI answering
await go('/v2');
const orb = page.locator('.v2-orb, [aria-label*="Homes AI" i], button:has-text("Homes AI")');
console.log('orb candidates:', await orb.count());
await orb.first().click();
await page.waitForTimeout(900);
const chip = page.getByRole('button', { name: /call first|needs me|awake/i });
console.log('chips:', await chip.count());
await chip.first().click();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/3-homes-ai-answer.png` });

console.log('console errors:', errors.slice(0, 5));
await browser.close();
