/**
 * The phone shell, driven by a real browser.
 *
 * `src/v2/phone.test.ts` checks the rules; this checks the behaviour, because
 * a sheet that rises correctly and then cannot be closed passes every unit
 * test ever written and is useless to hold in your hand.
 *
 * Four things, all from `docs/v2/phone-shell.md`:
 *
 *  1. §1.2 — the bar is there on an ordinary screen and gone on the four
 *     full-attention ones.
 *  2. §1.5 — a decision opens as a sheet pinned to the bottom edge, full
 *     width, with a grab handle; tapping the dim behind it closes it.
 *  3. §5.1 — the check-in gate asks before a call, with its three answers.
 *  4. The page never scrolls sideways at 390px.
 *
 * Run: `node e2e/phone.mjs` with the preview on 5182, or set PHONE_BASE_URL.
 */
import { chromium } from 'playwright';

const BASE = process.env.PHONE_BASE_URL ?? 'http://127.0.0.1:5182';
const PHONE = { width: 390, height: 844 };

const problems = [];
const fail = (what, detail) => problems.push(`${what}: ${detail}`);
let checks = 0;
const ok = (what, cond, detail) => {
  checks += 1;
  if (!cond) fail(what, detail);
};

const browser = await chromium.launch();

async function open(route, role = 'agent') {
  const page = await browser.newPage({ viewport: PHONE });
  page.on('pageerror', (e) => fail(route, `page error — ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Failed to load resource')) {
      fail(route, `console — ${m.text().slice(0, 120)}`);
    }
  });
  await page.goto(`${BASE}/?as=${role}#${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  return page;
}

/* ── 1. the bottom bar ──────────────────────────────────────────────────── */

for (const route of ['/v2', '/v2/leads', '/v2/tasks', '/v2/more', '/v2/attendance']) {
  const page = await open(route);
  const bar = await page.locator('.v2-bar').count();
  const dial = await page.locator('.v2-dial').count();
  ok(route, bar === 1, `expected the bottom bar, found ${bar}`);
  ok(route, dial === 1, `expected the dial button, found ${dial}`);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(route, wide === PHONE.width, `scrolls sideways — scrollWidth ${wide}`);
  await page.close();
}

for (const route of ['/v2/calling', '/v2/email']) {
  const page = await open(route);
  const bar = await page.locator('.v2-bar').count();
  ok(route, bar === 0, 'a full-attention screen still shows the bottom bar');
  await page.close();
}

/* A chat is the third: it is a state inside the inbox, not an address. */
{
  const page = await open('/v2/inbox');
  const before = await page.locator('.v2-bar').count();
  ok('/v2/inbox', before === 1, 'the inbox list should keep its bar');
  const thread = page.locator('button.d-cv').first();
  if (await thread.count() > 0) {
    await thread.click();
    await page.waitForTimeout(500);
    const after = await page.locator('.v2-bar').count();
    ok('/v2/inbox thread', after === 0, 'an open thread should take the bar away');
  } else {
    fail('/v2/inbox', 'found no thread to open — the check did not run');
  }
  await page.close();
}

/* ── 2. a sheet opens, and closes ───────────────────────────────────────── */

{
  const page = await open('/v2/leads/o-1');
  const action = page.getByRole('button', { name: /follow-?up/i }).first();
  if (await action.count() === 0) {
    fail('/v2/leads/o-1', 'no Follow-up button, so the sheet check did not run');
  } else {
    await action.click();
    await page.waitForTimeout(600);
    const shape = await page.evaluate(() => {
      const sheet = document.querySelector('.d-dialog, .d-panel');
      if (!sheet) return null;
      const r = sheet.getBoundingClientRect();
      const handle = getComputedStyle(sheet, '::before');
      return {
        bottomGap: Math.round(window.innerHeight - r.bottom),
        left: Math.round(r.left),
        width: Math.round(r.width),
        radius: getComputedStyle(sheet).borderTopLeftRadius,
        handle: `${handle.width} x ${handle.height}`,
        scrim: !!document.querySelector('.d-scrim'),
      };
    });
    if (!shape) {
      fail('/v2/leads/o-1', 'the Follow-up button opened nothing');
    } else {
      ok('sheet', shape.bottomGap === 0, `sits ${shape.bottomGap}px off the bottom edge`);
      ok('sheet', shape.left === 0 && shape.width === PHONE.width, `is ${shape.width}px wide at x=${shape.left}`);
      ok('sheet', shape.radius === '28px', `top radius is ${shape.radius}, not 28px`);
      ok('sheet', shape.handle === '44px x 5px', `grab handle is ${shape.handle}`);
      ok('sheet', shape.scrim, 'has no dim layer behind it');

      /* Tapping the dim closes it — §1.5. */
      await page.locator('.d-scrim').first().click({ position: { x: 10, y: 10 } });
      await page.waitForTimeout(500);
      const left = await page.locator('.d-dialog, .d-panel').count();
      ok('sheet', left === 0, 'tapping the dim behind it did not close it');
    }
  }
  await page.close();
}

/* ── 3. the check-in gate ───────────────────────────────────────────────── */

{
  /*
   * From the dial button, on an ordinary screen — not only on the calling
   * screen. §1.3 puts the gate on the way to the dialler from all 64, and
   * the audit found it on one.
   */
  const page = await open('/v2/leads');
  await page.locator('.v2-dial').click();
  await page.waitForTimeout(700);
  const gate = await page.evaluate(() => {
    const d = document.querySelector('.v2-gate');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return {
      bottomGap: Math.round(window.innerHeight - r.bottom),
      rows: [...d.querySelectorAll('.v2-gate-row b')].map((x) => x.textContent?.trim()),
      subs: [...d.querySelectorAll('.v2-gate-row > .d-grow > span')].map((x) => x.textContent ?? ''),
      foot: d.querySelector('.v2-gate-foot')?.textContent ?? '',
    };
  });
  if (!gate) {
    fail('check-in', 'the dial button did not ask — the gate is not on the way to the dialler');
  } else {
    ok('check-in', gate.bottomGap === 0, 'the gate is not a bottom sheet');
    ok('check-in', gate.rows.length === 3, `expected three answers, found ${gate.rows.length}`);
    ok('check-in', gate.rows[0] === 'Check in now and call', `first answer reads "${gate.rows[0]}"`);
    ok('check-in', gate.rows[1] === "I'm working outside", `second answer reads "${gate.rows[1]}"`);
    ok('check-in', gate.rows[2] === 'Call anyway', `third answer reads "${gate.rows[2]}"`);
    /* The half that makes "call anyway" honest rather than a dare. */
    ok('check-in', gate.subs[2]?.includes('owners see it'), 'the consequence does not say owners see it');
    /* Enforced in code and never said, so a lock looked like a bug. */
    ok('check-in', gate.foot.includes('Owners and admin are not asked'), 'the exemption is still unprinted');
  }
  await page.close();
}

await browser.close();

if (problems.length === 0) {
  console.log(`the phone shell is as the design draws it — ${checks} checks passed`);
  process.exit(0);
}
console.log(`${problems.length} of ${checks} checks failed:\n`);
for (const line of problems) console.log(`  ${line}`);
process.exit(1);
