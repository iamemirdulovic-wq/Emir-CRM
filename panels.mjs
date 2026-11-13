import { chromium } from 'playwright';
const OUT = '/tmp/claude-0/-home-user-Emir-CRM/d25e41ad-dd7b-5b85-aa9e-7b42e8ece14e/scratchpad/shots';
const b = await chromium.launch();

// Agent: leave tab, then "Ask for days off".
let p = await b.newPage({ viewport:{width:1440,height:1000}, deviceScaleFactor:2 });
await p.goto('http://127.0.0.1:5182/?as=agent#/v2/attendance', { waitUntil:'networkidle' });
await p.waitForTimeout(600);
await p.getByRole('tab', { name: /Leave/ }).click();
await p.waitForTimeout(400);
await p.getByRole('button', { name: /Ask for days off/ }).click();
await p.waitForTimeout(500);
await p.screenshot({ path:`${OUT}/panel-ask.png`, fullPage:true });
await p.close();

// Agent: "I'm working outside today" from the hero.
p = await b.newPage({ viewport:{width:1440,height:1000}, deviceScaleFactor:2 });
await p.goto('http://127.0.0.1:5182/?as=agent#/v2/attendance', { waitUntil:'networkidle' });
await p.waitForTimeout(600);
await p.getByRole('button', { name: /working outside/ }).click();
await p.waitForTimeout(500);
await p.screenshot({ path:`${OUT}/panel-outside.png`, fullPage:true });
await p.close();
await b.close();
console.log('ok');
