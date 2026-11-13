/**
 * One picture per phone screen: the design, the build, and the build in dark.
 *
 * The left panel is the owner's own picture of the design, from
 * `design/phone-shots/`, not this script rendering the prototype. The
 * prototypes need a runtime (`support.js`) that is not in this repository, so
 * rendering one drew every conditional state stacked on top of the others —
 * on My Day, the screen plus two pop-ups at once, which is unreadable. The
 * owner supplied 59 clean pictures instead, 390x844 at two device pixels,
 * pop-ups closed, each the first state and the top of the screen.
 *
 * What those pictures do NOT show, and the `.dc.html` file still must be read
 * for: the lower part of a long screen, and every sheet and dialog. A row
 * here that opens a sheet is marked on the picture, because its left panel is
 * the screen as it looks before the sheet opens.
 *
 * The owner asked for proof he can look at rather than a claim he has to
 * trust. Each picture is 390px three times across, labelled, with the design
 * file's name on it so any row can be checked by hand.
 *
 * The prototypes are in the old green palette — `docs/v2/phone-shell.md` says
 * so at the top, and the master prompt's §1.1 is the mapping to orange. So a
 * colour difference between the first panel and the second is expected and is
 * not a finding. Layout, order, wording and missing buttons are.
 *
 * Usage:
 *   node scripts/phone-proof.mjs                 # all of them
 *   node scripts/phone-proof.mjs my-day lead     # just these
 *
 * The preview must be on 5182 (or set PROOF_BASE_URL).
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.PROOF_BASE_URL ?? 'http://127.0.0.1:5182';
const OUT = path.join(ROOT, 'docs/v2/phone-proof');
/*
 * One scratch folder per run, not one shared by all of them. Four groups
 * shooting their own screens at once emptied each other's folder at the end
 * of a run and killed the stitch step half way through.
 */
const SHOTS = path.join(OUT, `.shots-${process.pid}`);

/**
 * Every one of the 59 phone screens, against where it lives in the build.
 *
 * `open` is what to do after the page loads to reach the state the prototype
 * draws — a tab to press, a button that opens a sheet. Without it a screen
 * that is a sheet in the design is compared against the page behind it.
 */
export const SCREENS = [
  // ── A: home and leads ──────────────────────────────────────────────────
  ['my-day', 'Main', '/v2', 'agent'],
  ['owner-home', 'OwnerHome', '/v2', 'owner'],
  ['owner-dashboard', 'OwnerDashboard', '/v2/dashboard', 'owner'],
  ['my-leads', 'Leads', '/v2/leads', 'agent'],
  ['all-leads', 'AllLeads', '/v2/leads', 'owner'],
  ['lead', 'Lead', '/v2/leads/o-1', 'agent'],
  ['notes', 'Notes', '/v2/leads/o-1', 'agent', { click: 'Notes' }],
  ['add-lead', 'AddLead', '/v2/leads/new', 'agent'],
  ['incoming', 'Incoming', '/v2/incoming', 'agent'],
  ['owner-assign', 'OwnerAssign', '/v2/vip', 'owner'],
  ['calling', 'Dialer', '/v2/calling', 'agent'],
  ['pipeline', 'Pipeline', '/v2/pipeline', 'agent'],

  // ── B: plan, attendance, transfers ─────────────────────────────────────
  ['calendar', 'Calendar', '/v2/calendar', 'agent'],
  ['tasks', 'Tasks', '/v2/tasks', 'agent'],
  ['follow-ups', 'FollowUps', '/v2/tasks?tab=follow-ups', 'agent'],
  ['attendance', 'Attendance', '/v2/attendance', 'agent'],
  ['team-attendance', 'TeamAttendance', '/v2/attendance', 'owner'],
  ['work-outside', 'WorkOutside', '/v2/attendance', 'agent', { click: /working outside/i }],
  ['leave-request', 'LeaveRequest', '/v2/attendance', 'agent', { click: [/^Leave/, /ask for days off/i] }],
  ['leave-approvals', 'LeaveApprovals', '/v2/attendance', 'owner', { click: /leave/i }],
  ['transfers', 'Transfers', '/v2/transfers', 'agent'],
  ['transfer-lead', 'TransferLead', '/v2/leads/o-1', 'agent', { click: 'button.d-tr-link' }],
  ['search', 'Search', '/v2/search', 'agent'],
  ['notifications', 'Notifications', '/v2/notifications', 'agent'],

  // ── C: projects, team, the person ──────────────────────────────────────
  ['projects', 'LiveProjects', '/v2/projects', 'agent'],
  ['project', 'ProjectDetail', '/v2/projects/p-1', 'agent'],
  ['manage-projects', 'ManageProjects', '/v2/projects/manage', 'owner'],
  ['team', 'TeamDirectory', '/v2/team', 'agent'],
  ['colleague', 'Colleague', '/v2/team/u-2', 'agent'],
  ['wall', 'TeamWall', '/v2/wall', 'agent'],
  ['best', 'Leaderboard', '/v2/best', 'agent'],
  ['profile', 'Profile', '/v2/profile', 'agent'],
  ['personal-info', 'PersonalInfo', '/v2/me', 'agent'],
  ['security', 'Security', '/v2/settings/security', 'agent'],
  ['card', 'DigitalCard', '/v2/card', 'agent'],
  ['feedback', 'Feedback', '/v2/feedback', 'agent'],

  // ── D: messages, AI, the owner's tools ─────────────────────────────────
  ['inbox', 'Inbox', '/v2/inbox', 'agent'],
  ['chat', 'Chat', '/v2/inbox', 'agent', { click: 'button.d-cv' }],
  ['email', 'Email', '/v2/email', 'agent'],
  ['templates', 'Templates', '/v2/templates', 'agent'],
  ['ask-ai', 'AskAI', '/v2/ai', 'agent'],
  ['team-live', 'OwnerLive', '/v2/team-live', 'owner'],
  ['activity', 'TeamActivity', '/v2/activity', 'owner'],
  ['messaging', 'OwnerMessaging', '/v2/messaging', 'owner'],
  ['feedback-inbox', 'OwnerFeedback', '/v2/settings/feedback', 'owner'],
  ['import', 'Import', '/v2/import', 'owner'],
  ['automations', 'Automations', '/v2/automations', 'owner'],
  ['desks', 'Desks', '/v2/settings/desks', 'owner'],

  // ── the menu, settings, login ──────────────────────────────────────────
  ['more', 'Menu', '/v2/more', 'agent'],
  ['settings', 'Settings', '/v2/settings', 'agent'],
  ['settings-notifications', 'SettingsNotifications', '/v2/settings/notifications', 'agent'],
  ['settings-team', 'SettingsTeam', '/v2/settings/team', 'owner'],
  ['settings-attendance', 'SettingsAttendance', '/v2/settings/attendance', 'owner'],
  ['ai-settings', 'AISettings', '/v2/settings/ai', 'owner'],
  ['company', 'Company', '/v2/settings/company', 'owner'],
  ['health', 'Health', '/v2/settings/health', 'owner'],
  ['banners', 'OwnerBanners', '/v2/settings/banners', 'owner'],
  ['install-guide', 'InstallGuide', '/v2/settings/phone-app', 'agent'],
  ['login', 'Login', '/login', 'agent'],
];

const wanted = process.argv.slice(2);
const list = wanted.length > 0
  ? SCREENS.filter(([key]) => wanted.includes(key))
  : SCREENS;

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const missed = [];

/**
 * Every prototype asks Google for Inter and Manrope, and every one of those
 * requests goes out through the container's proxy — about a second each,
 * three loads per screen, 59 screens. The comparison is layout, order and
 * wording, not the typeface, so the request is answered locally with
 * nothing.
 */
async function noWebFonts(page) {
  await page.route('**://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**://fonts.gstatic.com/**', (r) => r.abort());
}

async function shoot(page, file) {
  await page.waitForTimeout(1400);
  await page.screenshot({ path: file });
}

for (const [key, design, route, role, how = {}] of list) {
  /* The design: the owner's picture, not a render. */
  const shot = path.join(ROOT, 'design/phone-shots', `${design}__${role}.png`);
  if (!existsSync(shot)) missed.push(`${key}: no picture ${design}__${role}.png`);

  /* The build, light and dark. */
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme,
    });
    if (route === '/login') {
      /*
       * The preview signs itself in, so /login bounces to the dashboard and
       * the picture would show the wrong screen entirely. The flag is read
       * once when the bundle loads, so it has to be set and then reloaded.
       */
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => localStorage.setItem('emir.previewSignedOut', '1'));
      await page.goto(`${BASE}/#/login`, { waitUntil: 'domcontentloaded' });
      await page.reload({ waitUntil: 'networkidle' });
    } else {
      await page.goto(`${BASE}/?as=${role}#${route}`, { waitUntil: 'networkidle' });
    }
    await page.waitForTimeout(900);
    /* A list, because some of these sit behind a tab: open the tab, then
       the sheet. One string is the same thing with one step. */
    for (const step of [how.click].flat().filter(Boolean)) {
      const target = typeof step === 'string' && step.includes('.')
        ? page.locator(step).first()
        : page.getByRole('button', { name: step }).first();
      const also = page.getByRole('tab', { name: step }).first();
      if (await also.count() > 0) await also.click().catch(() => {});
      else if (await target.count() > 0) await target.click().catch(() => {});
      else missed.push(`${key}: nothing matched ${step} in the build`);
      await page.waitForTimeout(700);
    }
    await shoot(page, path.join(SHOTS, `${key}-${theme}.png`));
    await page.close();
  }
  process.stdout.write('.');
}

/* ── stitch ─────────────────────────────────────────────────────────────── */

const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

for (const [key, design, route, role, how = {}] of list) {
  const shot = path.join(ROOT, 'design/phone-shots', `${design}__${role}.png`);
  if (!existsSync(shot)) continue;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#EFEDE9;font:14px -apple-system,Segoe UI,Roboto,sans-serif;color:#16151A}
    .wrap{padding:22px 24px 26px}
    h1{font-size:19px;margin:0 0 3px;letter-spacing:-.01em}
    .sub{font-size:12.5px;color:#6B6A72;margin:0 0 16px}
    .cols{display:flex;gap:20px}
    .col{width:390px}
    .tag{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin:0 0 7px;color:#6B6A72}
    .tag b{color:#FF4000}
    .warn{color:#B3400E;font-weight:700}
    img{width:390px;display:block;border-radius:14px;box-shadow:0 2px 14px rgba(0,0,0,.14)}
  </style><div class="wrap">
    <h1>${key} — 390&nbsp;px</h1>
    <p class="sub">${design}.dc.html &nbsp;·&nbsp; build at <code>${route}</code> as ${role}${
      how.click ? ' &nbsp;·&nbsp; <b class="warn">the design picture is this screen before the sheet opens — read the .dc.html for the sheet itself</b>' : ''
    }</p>
    <div class="cols">
      <div class="col"><p class="tag">Phone design</p><img src="${b64(shot)}"></div>
      <div class="col"><p class="tag"><b>Built — light</b></p><img src="${b64(path.join(SHOTS, `${key}-light.png`))}"></div>
      <div class="col"><p class="tag"><b>Built — dark</b></p><img src="${b64(path.join(SHOTS, `${key}-dark.png`))}"></div>
    </div>
  </div>`;
  const tmp = path.join(SHOTS, `${key}.html`);
  writeFileSync(tmp, html);
  const page = await browser.newPage({ viewport: { width: 1290, height: 1000 } });
  await page.goto(`file://${tmp}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  /*
   * One device pixel per CSS pixel, and JPEG. Each panel is captured at two
   * and drawn into 390px here, so it is downsampled from a sharp source and
   * reads exactly as it does on a phone. At two and PNG the 59 pictures came
   * to 51MB, and every re-run would add another 51MB to this repository for
   * ever.
   */
  await page.screenshot({ path: path.join(OUT, `${key}.jpg`), fullPage: true, type: 'jpeg', quality: 88 });
  await page.close();
}

await browser.close();
rmSync(SHOTS, { recursive: true, force: true });
console.log(`\n${list.length} pictures -> docs/v2/phone-proof/`);
if (missed.length > 0) {
  console.log('\ncould not reach the state the design draws:');
  for (const line of missed) console.log(`  ${line}`);
}
