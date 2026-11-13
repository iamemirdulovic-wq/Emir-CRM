import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT ?? '/tmp/claude-0/-home-user-Emir-CRM/d25e41ad-dd7b-5b85-aa9e-7b42e8ece14e/scratchpad/shots';
mkdirSync(OUT, { recursive: true });

// spec = route|role|clickText
const specs = (process.argv[2] ?? 'team|owner').split(',');
const wide = process.argv[3] !== 'phone';

const browser = await chromium.launch();
for (const spec of specs) {
  const [route, as, click] = spec.split('|');
  const page = await browser.newPage({
    viewport: wide ? { width: 1440, height: 1000 } : { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:5182/?as=${as ?? 'owner'}#/v2/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (click) {
    const target = click.startsWith('css:')
      ? page.locator(click.slice(4)).first()
      : page.getByText(click, { exact: false }).first();
    await target.click().catch((e) => errs.push(`click: ${e.message.slice(0, 80)}`));
    await page.waitForTimeout(600);
  }
  const name = `${route.replace(/\//g, '-')}-${as ?? 'owner'}${click ? `-${click.replace(/\W+/g, '')}` : ''}-${wide ? 'wide' : 'phone'}`;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(name, errs.length ? `ERRORS: ${errs.slice(0, 4).join(' | ')}` : 'ok');
  await page.close();
}
await browser.close();
