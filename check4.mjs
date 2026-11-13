import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = '/tmp/claude-0/-home-user-Emir-CRM/d25e41ad-dd7b-5b85-aa9e-7b42e8ece14e/scratchpad/shots4';
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ['/v2/inbox?as=owner', 'inbox'],
  ['/v2/email?as=owner', 'email'],
  ['/v2/templates?as=owner', 'templates'],
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (const [size, width, height, scale] of [['desk', 1440, 1000, 2], ['phone', 390, 844, 2]]) {
  for (const [route, slug] of ROUTES) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`PAGEERROR ${e.message}`));
    await page.goto(`http://127.0.0.1:5182/#${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: `${OUT}/${slug}-${size}.png` });
    const overflow = await page.evaluate(() => {
      const doc = document.scrollingElement;
      return { scrollWidth: doc.scrollWidth, vw: window.innerWidth };
    });
    console.log(slug, size, JSON.stringify(overflow), errors.length ? errors.slice(0, 3) : 'no console errors');
    await page.close();
  }
}

// The template panel open, and the inbox thread on a phone.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:5182/#/v2/templates?as=owner', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.locator('.d-tp').first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/templates-panel.png` });
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:5182/#/v2/inbox?as=owner', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.locator('.d-cv').first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/inbox-thread-phone.png`, fullPage: true });
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.scrollingElement.scrollWidth, vw: window.innerWidth,
  }));
  console.log('inbox-thread-phone', JSON.stringify(overflow));
  await page.close();
}

await browser.close();
console.log('shots in', OUT);
