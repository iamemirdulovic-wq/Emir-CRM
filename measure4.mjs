import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
await p.goto('http://127.0.0.1:5182/#/v2/templates?as=owner', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2200);
const card = p.locator('.d-tp').nth(4);
await card.screenshot({ path: '/tmp/claude-0/-home-user-Emir-CRM/d25e41ad-dd7b-5b85-aa9e-7b42e8ece14e/scratchpad/shots4/card-crop.png' });
console.log(await card.locator('.d-tp-body').evaluate((el) => ({
  clientH: el.clientHeight, scrollH: el.scrollHeight, display: getComputedStyle(el).display,
})));
await b.close();
