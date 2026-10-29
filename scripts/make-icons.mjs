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

const svg = readFileSync(join(PUBLIC_DIR, 'icon.svg'), 'utf8');

/*
 * The icon's own background colour, so the maskable version can bleed to the
 * edges in the same colour and show no seam. Falls back to the theme colour if
 * the SVG is ever redrawn without a fill on its first shape.
 */
const brandColour = /fill="(#[0-9a-f]{3,8})"/i.exec(svg)?.[1] ?? '#1f47d6';

/*
 * Two shapes, because the manifest asks two different questions.
 *
 * `any` is the icon shown as drawn — a browser tab, a bookmark, a desktop
 * shortcut — so it keeps its own rounded square and transparent corners.
 *
 * `maskable` is cropped by the launcher to whatever shape that phone uses: a
 * circle, a squircle, a rounded square. A transparent corner there becomes a
 * visible notch, so this one fills the frame edge to edge and holds the logo
 * inside the middle 80%, which is the area every mask is guaranteed to keep.
 */
const OUTPUTS = [
  { file: 'icon-192.png', size: 192, bleed: false },
  { file: 'icon-512.png', size: 512, bleed: false },
  { file: 'icon-maskable-512.png', size: 512, bleed: true },
];

const SAFE_ZONE = 0.8;
const browser = await chromium.launch({ args: ['--no-sandbox'] });

for (const { file, size, bleed } of OUTPUTS) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const inner = bleed ? Math.round(size * SAFE_ZONE) : size;
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>
       html,body{margin:0;padding:0;width:${size}px;height:${size}px;
                 background:${bleed ? brandColour : 'transparent'};
                 display:flex;align-items:center;justify-content:center}
       svg{display:block;width:${inner}px;height:${inner}px}
     </style>
     ${svg}`,
    { waitUntil: 'load' },
  );
  const png = await page.screenshot({ omitBackground: !bleed });
  writeFileSync(join(PUBLIC_DIR, file), png);
  await page.close();
  console.log(`wrote ${file} (${png.length} bytes)`);
}

await browser.close();
