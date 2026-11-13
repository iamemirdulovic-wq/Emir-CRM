import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport:{width:390,height:844} });
await p.goto('http://127.0.0.1:5182/?as=owner#/v2/attendance', { waitUntil:'networkidle' });
await p.waitForTimeout(700);
console.log(await p.evaluate(() => {
  const g = document.querySelector('.d-grid8');
  const cs = getComputedStyle(g);
  const card = g.closest('.d-card');
  return {
    gridW: g.getBoundingClientRect().width, gridScrollW: g.scrollWidth,
    overflowX: cs.overflowX, cols: cs.gridTemplateColumns,
    cardW: card.getBoundingClientRect().width, cardScrollW: card.scrollWidth,
    pageScrollW: document.querySelector('.v2-page').scrollWidth,
    tabs: document.querySelector('.d-top-tabs')?.scrollWidth,
  };
}));
await b.close();
