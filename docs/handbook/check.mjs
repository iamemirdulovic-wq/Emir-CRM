/* Content clipped by .page{overflow:hidden} is invisible in the PDF, so measure
   it rather than trusting the eye. Also flags a page that is mostly empty. */
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/').call(null, 'playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto(`file://${process.cwd()}/handbook.html`, { waitUntil: 'networkidle' });
await p.emulateMedia({ media: 'print' });
await p.waitForTimeout(1500);
const rows = await p.evaluate(() => [...document.querySelectorAll('.page')].map((el, i) => {
  const kids = [...el.children].filter(c => !c.classList.contains('pf') && !c.classList.contains('wm'));
  const last = kids[kids.length - 1];
  const pageBottom = el.getBoundingClientRect().bottom;
  const contentBottom = last ? last.getBoundingClientRect().bottom : pageBottom;
  const px2mm = 96 / 25.4;
  return {
    i: i + 1,
    over: +((el.scrollHeight - el.clientHeight) / px2mm).toFixed(1),
    gap: +((pageBottom - contentBottom) / px2mm).toFixed(1),
  };
}));
for (const r of rows) {
  const flag = r.gap < 8 ? `OVERFLOW (content reaches ${r.gap}mm from edge)` : r.gap > 68 ? `thin (${r.gap}mm empty)` : 'ok';
  if (flag !== 'ok') console.log(`  page ${String(r.i).padStart(2)}  ${flag}`);
}
console.log(`checked ${rows.length} pages`);
await b.close();
