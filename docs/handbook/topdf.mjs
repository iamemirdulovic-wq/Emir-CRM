import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/node-tools/').call(null, 'playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto(`file://${process.cwd()}/handbook.html`, { waitUntil: 'networkidle' });
await p.emulateMedia({ media: 'print' });
await p.waitForTimeout(1200);
await p.pdf({
  path: 'homes-me-crm-agent-handbook.pdf',
  printBackground: true, preferCSSPageSize: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
// a PNG of page 1 so the cover can be checked by eye
await p.setViewportSize({ width: 794, height: 1123 });
await p.screenshot({ path: 'cover.png', clip: { x: 0, y: 0, width: 794, height: 1123 } });
await b.close();
console.log('done');
