import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT ?? '/tmp/claude-0/-home-user-Emir-CRM/d25e41ad-dd7b-5b85-aa9e-7b42e8ece14e/scratchpad/shots';
mkdirSync(OUT, { recursive: true });

const routes = (process.argv[2] ?? 'team:owner,transfers:owner,attendance:owner').split(',');
const wide = process.argv[3] !== 'phone';

const browser = await chromium.launch();
for (const spec of routes) {
  const [route, as, tab] = spec.split(':');
  const page = await browser.newPage({
    viewport: wide ? { width: 1440, height: 1000 } : { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:5182/#/v2/${route}?as=${as ?? 'owner'}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (tab) {
    await page.click(`text=${tab}`).catch(() => {});
    await page.waitForTimeout(500);
  }
  const name = `${route.replace(/\//g, '-')}-${as ?? 'owner'}${tab ? `-${tab}` : ''}-${wide ? 'wide' : 'phone'}`;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(name, errs.length ? `ERRORS: ${errs.slice(0, 4).join(' | ')}` : 'ok');
  await page.close();
}
await browser.close();
