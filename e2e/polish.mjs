/**
 * The layout check: every screen, both sizes, both themes.
 *
 * A person looking at a hundred screenshots misses things. A browser does not:
 * it can say exactly which element is hanging off the right edge of a phone,
 * which button is thirteen pixels across, and which image never loaded. This
 * is the pass that found the lead page dragging sideways on a phone, a 13px
 * row button, and a timestamp pushing the audit log off the screen.
 *
 * Four checks, each chosen because it catches something a screenshot does not
 * make obvious:
 *
 *  - **page-overflow** — the page itself scrolls sideways. On a phone that is
 *    always a bug: content ends up off-screen with no way to know it is there.
 *  - **overflows-right** — an element past the right edge that is not inside
 *    something built to scroll sideways. A board and a button row are meant
 *    to run off; a card is not.
 *  - **text-clipped** — text cut off with no ellipsis and no title, so there
 *    is no way to read the rest.
 *  - **small-tap-target** — on a phone, anything under 28px. Inline links
 *    inside a sentence are expected to be short and are not a defect; a
 *    button is.
 *
 * Run it against the preview build, which needs no database:
 *
 *   npm --workspace web run build:preview
 *   cd web && npx vite preview --config vite.config.preview.ts --port 5182 &
 *   cd .. && node e2e/polish.mjs
 *
 * Start the preview server from inside `web/`, not from the repository root:
 * from the root it resolves its own root elsewhere and serves a 404 for the
 * page itself, which looks like a hundred broken screens.
 *
 * Set POLISH_BASE_URL to point somewhere else, OUTDIR to keep screenshots.
 * Exits non-zero when anything but a small tap target is found.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.POLISH_BASE_URL ?? 'http://127.0.0.1:5182';
const OUT = process.env.OUTDIR ?? null;
if (OUT) mkdirSync(OUT, { recursive: true });

/** Every screen, with the preview's own ids for the detail routes. */
const ROUTES = [
  ['/dashboard', 'dashboard'], ['/incoming', 'incoming'], ['/leads', 'leads'],
  ['/leads?tab=today', 'leads-today'], ['/pipeline', 'pipeline'], ['/inbox', 'inbox'],
  ['/tasks', 'tasks'], ['/contacts/c-1', 'lead'], ['/lists', 'lists'], ['/lists/ls-1', 'list-detail'],
  ['/campaigns', 'campaigns'], ['/campaigns/cp-1', 'campaign'], ['/campaigns/cp-1/dial', 'dialler'],
  ['/email-campaigns', 'email-campaigns'], ['/wall', 'wall'], ['/projects', 'projects'],
  ['/offers', 'offers'], ['/imports', 'imports'], ['/imports/new', 'import-wizard'],
  ['/imports/im-1', 'import-detail'], ['/pool', 'pool'], ['/automations', 'automations'],
  ['/team-activity', 'team-activity'], ['/audit', 'audit'], ['/profile', 'profile'],
  ['/settings', 'settings'], ['/dev/components', 'components'],
];

const VIEWPORTS = [['desktop', 1440, 1000], ['mobile', 390, 844]];
const THEMES = ['light', 'dark'];

/** The smallest a thumb reliably hits inside a dense row. */
const MIN_TAP = 28;

/** Runs inside the page. */
const AUDIT = (minTap) => {
  const vw = window.innerWidth;
  const problems = [];
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const insideScroller = (el) => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
    return false;
  };

  const doc = document.scrollingElement;
  if (doc && doc.scrollWidth > vw + 1) {
    problems.push({ kind: 'page-overflow', detail: `scrollWidth ${doc.scrollWidth} > viewport ${vw}` });
  }

  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    if (el.classList.contains('sr-only')) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;

    if (box.right > vw + 1 && style.position !== 'fixed' && !insideScroller(el)) {
      problems.push({ kind: 'overflows-right', detail: `${describe(el)} right=${Math.round(box.right)}` });
    }

    if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && style.overflow !== 'visible') {
      const text = (el.textContent || '').trim();
      if (text.length > 0 && !el.title && style.textOverflow !== 'ellipsis') {
        problems.push({ kind: 'text-clipped', detail: `${describe(el)} "${text.slice(0, 40)}"` });
      }
    }

    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0) {
      problems.push({ kind: 'broken-image', detail: `${describe(el)} src=${el.getAttribute('src')}` });
    }
  }

  if (vw < 600) {
    for (const el of document.querySelectorAll('button, a[href], [role="switch"], input[type="checkbox"]')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      /* The switch draws at 40x24 by design and carries a larger invisible
         target on a pseudo-element, which a bounding box cannot see. */
      if (el.classList.contains('switch')) continue;
      /* A link inside a sentence is as tall as the line it sits in. */
      if (el.tagName === 'A' && style.display === 'inline') continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.height < minTap || box.width < minTap) {
        const label = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24);
        problems.push({
          kind: 'small-tap-target',
          detail: `${describe(el)} ${Math.round(box.width)}x${Math.round(box.height)} "${label}"`,
        });
      }
    }
  }

  return problems;
};

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const report = [];

for (const [size, width, height] of VIEWPORTS) {
  for (const theme of THEMES) {
    for (const [route, slug] of ROUTES) {
      const page = await browser.newPage({ viewport: { width, height } });
      const consoleErrors = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', (error) => consoleErrors.push(`PAGEERROR ${error.message}`));
      await page.addInitScript((chosen) => {
        try {
          localStorage.setItem('emir.theme', chosen);
          /* Past the tour, so it does not cover the screen being checked. */
          localStorage.setItem(
            'homes.preview.prefs',
            JSON.stringify({ tour_state: JSON.stringify({ step: 0, doneAt: '2026-01-01', skipped: false }) }),
          );
        } catch { /* private window */ }
      }, theme);

      try {
        /*
         * `domcontentloaded` and a fixed wait, not `networkidle`: the app
         * holds a realtime connection open and sends a heartbeat, so the
         * network is never idle and every page would sit out its timeout.
         */
        await page.goto(`${BASE}/#${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1800);
        const problems = await page.evaluate(AUDIT, MIN_TAP);
        if (OUT) await page.screenshot({ path: `${OUT}/${slug}-${size}-${theme}.png` }).catch(() => undefined);
        report.push({ route, size, theme, console: consoleErrors, problems });
      } catch (error) {
        report.push({ route, size, theme, console: consoleErrors, problems: [{ kind: 'failed', detail: String(error).slice(0, 160) }] });
      }
      await page.close();
    }
  }
}

await browser.close();

const counts = {};
for (const row of report) {
  for (const problem of row.problems) counts[problem.kind] = (counts[problem.kind] ?? 0) + 1;
  if (row.console.length) counts.console = (counts.console ?? 0) + row.console.length;
}

console.log(`${report.length} screens checked — ${VIEWPORTS.length} sizes x ${THEMES.length} themes x ${ROUTES.length} routes`);
console.log(Object.keys(counts).length ? JSON.stringify(counts, null, 1) : 'nothing found');

for (const row of report) {
  if (!row.problems.length && !row.console.length) continue;
  console.log(`\n${row.route} [${row.size}/${row.theme}]`);
  for (const message of row.console.slice(0, 3)) console.log(`  console: ${message.slice(0, 160)}`);
  const seen = new Set();
  for (const problem of row.problems) {
    const key = `${problem.kind}:${problem.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${problem.kind}: ${problem.detail}`);
  }
}

/* A small tap target is a judgement call; everything else is a bug. */
const blocking = ['page-overflow', 'overflows-right', 'text-clipped', 'broken-image', 'failed', 'console'];
const failed = blocking.some((kind) => counts[kind]);
process.exit(failed ? 1 : 0);
