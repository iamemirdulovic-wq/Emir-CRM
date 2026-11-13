import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:5182/?as=owner#/v2/activity', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
console.log(JSON.stringify(await p.evaluate(() => {
  const out = [];
  for (const sel of ['main.v2-page', '.p-activity', '.p-activity .d-tabs', '.p-activity .d-tops', '.p-activity .d-card.d-hero']) {
    const el = document.querySelector(sel);
    if (!el) { out.push([sel, 'MISSING']); continue; }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push([sel, {
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      op: cs.opacity, pe: cs.pointerEvents, vis: cs.visibility, pos: cs.position,
      tr: cs.transform, anim: cs.animationName, disp: cs.display, bg: cs.backgroundColor,
    }]);
  }
  return out;
}), null, 1));
await b.close();
