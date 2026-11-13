import { chromium } from 'playwright';
const OUT = '/tmp/claude-0/-home-user-Emir-CRM/d25e41ad-dd7b-5b85-aa9e-7b42e8ece14e/scratchpad/shots';
const b = await chromium.launch();
for (const [route, as] of [['team','owner'],['transfers','agent'],['attendance','agent']]) {
  const p = await b.newPage({ viewport:{width:1440,height:1000}, deviceScaleFactor:2 });
  await p.addInitScript(() => { try { localStorage.setItem('emir.theme','dark'); } catch {} });
  await p.goto(`http://127.0.0.1:5182/?as=${as}#/v2/${route}`, { waitUntil:'networkidle' });
  await p.waitForTimeout(800);
  console.log(route, await p.evaluate(() => document.documentElement.dataset.theme));
  await p.screenshot({ path:`${OUT}/${route}-${as}-dark.png`, fullPage:true });
  await p.close();
}
await b.close();
