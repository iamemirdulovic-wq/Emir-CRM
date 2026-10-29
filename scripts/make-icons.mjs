/**
 * Generate the PWA's PNG icons from web/public/icon.svg.
 *
 *   node scripts/make-icons.mjs
 *
 * The manifest asks for 192px and 512px PNGs as well as the SVG, because
 * Android's launcher and iOS's home screen both want a raster icon and will
 * fall back to guessing — a screenshot, or a grey globe — if one is missing.
 * That icon is the thing an agent taps every morning, so it is worth having.
 *
 * Rendered in Chromium rather than by an image library: it is the same engine
 * the phones use, so what comes out is what they would have drawn. Needs
 * Playwright's Chromium, which is a development-only tool — the PNGs it
 * produces are committed, so a normal build and deploy never runs this.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/*
 * Playwright is a development tool, not a dependency of this project, so it is
 * resolved rather than imported: wherever it happens to be installed (a global
 * install, a CI image), this finds it, and the script says plainly what to do
 * when it is absent instead of failing with a module-resolution stack trace.
 */
const require_ = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require_('playwright'));
} catch {
  console.error(
    'This needs Playwright, which is a development tool and not installed by\n'
    + '`npm ci`. Either run `npm i -D playwright` first, or skip this — the\n'
    + 'PNGs it generates are committed, so only a change to icon.svg needs it.',
  );
  process.exit(1);
}

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public');

/*
 * Raster copies of the brand's own icons, for the places that will not take an
 * SVG: Android's launcher, and iOS, which ignores an `apple-touch-icon` that
 * is not a PNG and falls back to a screenshot of the page.
 *
 * The manifest declares the 512 as both `any` and `maskable`, which is only
 * honest because the brand's icon is a full-bleed square: a launcher may crop
 * it to a circle or a squircle and will never cut into the mark, which sits
 * well inside the middle 80%. An icon with transparent corners could not claim
 * both — the corners would show as notches once cropped.
 */
const OUTPUTS = [
  { from: 'icon.svg', file: 'icon-192.png', size: 192 },
  { from: 'icon.svg', file: 'icon-512.png', size: 512 },
  // 180 is the size Apple asks for; anything else is resampled by the phone.
  { from: 'apple-touch-icon.svg', file: 'apple-touch-icon.png', size: 180 },
];

const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (const { from, file, size } of OUTPUTS) {
  const svg = readFileSync(join(PUBLIC_DIR, from), 'utf8');
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;padding:0;background:transparent}
            svg{display:block;width:${size}px;height:${size}px}</style>
     ${svg}`,
    { waitUntil: 'load' },
  );
  const png = await page.screenshot({ omitBackground: true });
  writeFileSync(join(PUBLIC_DIR, file), png);
  await page.close();
  console.log(`wrote ${file} (${png.length} bytes) from ${from}`);
}

await browser.close();
