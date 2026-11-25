import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/opt/node-tools/node_modules/playwright/index.js');

/**
 * The agent report, as the PDF a person actually gets.
 *
 * Rendered at paper size on purpose. A PDF taken from a 1280px window comes
 * out blank — which is how the first one came out, and why this script exists
 * rather than a screenshot: the screen looked perfect the whole time.
 */
const AT = process.env.AT ?? 'http://localhost:4182';
const OUT = '/home/user/Emir-CRM/docs/v2/agent-report';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
await page.goto(`${AT}/#/v2/team/u-2/report?from=2026-11-01&to=2026-11-30`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.pdf({
  path: `${OUT}/Shan-Ali-November-2026.pdf`,
  preferCSSPageSize: true,
  printBackground: true,
});
await browser.close();
console.log('pdf written');
