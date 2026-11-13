import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
const bad = [];
p.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
await p.goto('http://127.0.0.1:5182/#/v2/settings/automations?as=owner', { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
await p.screenshot({ path: '/tmp/claude-0/shots/automations.png', fullPage: true });
console.log('say:', await p.locator('.d-tb-say').textContent());
console.log('taken back rows:', await p.locator('.d-list-row').count());

// Change the VIP clock and check the sentence follows.
await p.getByRole('button', { name: '1 hour', exact: true }).click();
await p.waitForTimeout(500);
console.log('after 1 hour:', await p.locator('.d-tb-say').textContent());

// Switch the whole rule off.
await p.locator('.v2-take-switch').click();
await p.waitForTimeout(500);
console.log('switched off:', await p.locator('.d-tb-say').textContent());
console.log('rows after off:', await p.locator('.d-list-row').count());
await b.close();
console.log(bad.length ? `\nPROBLEMS:\n${bad.join('\n')}` : '\nno page errors');
