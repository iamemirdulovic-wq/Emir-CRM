import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'shots2';
mkdirSync(OUT, { recursive: true });

const ROUTES = process.argv[2]
  ? [[process.argv[2], 'one']]
  : [
    ['/v2/projects?as=owner', 'projects-owner'],
    ['/v2/projects?as=agent', 'projects-agent'],
    ['/v2/projects/p-1?as=owner', 'project-owner'],
    ['/v2/projects/p-1?as=agent', 'project-agent'],
    ['/v2/wall?as=owner', 'wall-owner'],
    ['/v2/wall?as=agent', 'wall-agent'],
    ['/v2/best?as=agent', 'best-agent'],
    ['/v2/best?as=owner', 'best-owner'],
    ['/v2/notifications?as=owner', 'bell-owner'],
    ['/v2/search?as=owner&q=em', 'search-owner'],
    ['/v2/search?as=owner', 'search-empty'],
  ];

const browser = await chromium.launch();
for (const [size, width, height, scale] of [['wide', 1440, 1000, 2], ['phone', 390, 844, 2]]) {
  for (const [route, slug] of ROUTES) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:5182/#${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const over = await page.evaluate(() => {
      const vw = window.innerWidth;
      const doc = document.scrollingElement;
      const out = [];
      if (doc && doc.scrollWidth > vw + 1) out.push(`page ${doc.scrollWidth} > ${vw}`);
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        if (b.right > vw + 1 && s.position !== 'fixed') {
          let scroller = false;
          for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            const o = getComputedStyle(n).overflowX;
            if (o === 'auto' || o === 'scroll') { scroller = true; break; }
          }
          if (!scroller) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 2).join('.')} right ${Math.round(b.right)}`);
        }
      }
      return out.slice(0, 8);
    });
    await page.screenshot({ path: `${OUT}/${slug}-${size}.png`, fullPage: true });
    if (over.length || errors.length) {
      console.log(`${slug} ${size}:`, JSON.stringify({ over, errors: errors.slice(0, 4) }));
    } else {
      console.log(`${slug} ${size}: ok`);
    }
    await page.close();
  }
}
await browser.close();
