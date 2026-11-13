import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [route, as] of [['attendance','owner'],['attendance','agent'],['team','owner'],['transfers','owner'],['transfers','agent'],['profile','agent']]) {
  const p = await b.newPage({ viewport:{width:390,height:844} });
  await p.goto(`http://127.0.0.1:5182/?as=${as}#/v2/${route}`, { waitUntil:'networkidle' });
  await p.waitForTimeout(700);
  const out = await p.evaluate(() => {
    const bad = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('.v2-page *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > vw + 1) bad.push(`${el.className || el.tagName}  right=${Math.round(r.right)} w=${Math.round(r.width)}`);
    }
    return { scrollW: document.documentElement.scrollWidth, vw, bad: [...new Set(bad)].slice(0, 8) };
  });
  console.log(route, as, JSON.stringify(out, null, 1));
  await p.close();
}
await b.close();
