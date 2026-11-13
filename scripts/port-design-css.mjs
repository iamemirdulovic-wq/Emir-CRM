#!/usr/bin/env node
/**
 * Port the approved design's CSS into the app, mechanically.
 *
 * `design/web/ui.css` is the design system; `design/web/*.html` each carry a
 * <style> block of rules that belong to that page alone. Both are approved
 * work, and both are written for a standalone demo where they are the only
 * stylesheet on the page. Inside this app they are not: the live CRM that ten
 * people use every day has its own `.card`, `.chip`, `.btn`, `.side`, `.ring`
 * -- forty-two names in common at the last count -- and its rules reach any
 * element that carries one.
 *
 * That is not a theoretical problem. The first time the v2 home screen was
 * drawn, the design's `.side` (the right-hand column of the hero) picked up
 * the live app's `.side` (a slide-in panel, `position:fixed`), and the
 * countdown ring sat on top of the agent's phone number in a white box.
 * Nothing threw; it just looked wrong, and only in that one state.
 *
 * So this script does three things to every rule it ports:
 *
 *   1. Scopes the selector under `.v2`, so nothing it writes can reach the
 *      live screens either. The protection runs both ways.
 *   2. Prefixes every design class with `d-`, so no live class name can
 *      collide with a design one, now or when somebody adds a class to the
 *      live app next month. `.card` becomes `.d-card`.
 *   3. Renames every animation `v2-*`. Keyframe names are global whatever the
 *      selectors say, and the design and the live app both define `pop`,
 *      differently.
 *
 * Run it again whenever the design files change:
 *
 *   node scripts/port-design-css.mjs
 *
 * Do not hand-edit the generated files. If a ported rule is wrong, fix the
 * design file or add an override in `web/src/styles/v2-shell.css`, which is
 * ours.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = path.join(ROOT, 'design', 'web');
const STYLES = path.join(ROOT, 'web', 'src', 'styles');

/** Section 4 onwards: everything but the tokens, the base reset and the shell. */
const UI_FROM_LINE = 184;
const UI_TO_LINE = 807;

/** Classes that are ours, not the design's, and are already safe. */
const OURS = /^(v2|d)-/;

function keyframes(css) {
  const found = new Map();
  const spans = [];
  for (const match of css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)\s*\{/g)) {
    let i = match.index + match[0].length;
    let depth = 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    found.set(match[1], css.slice(match.index, i));
    spans.push([match.index, i]);
  }
  return { found, spans };
}

/**
 * Prefix every class in one selector, and scope it under `.v2`.
 *
 * Ids are rewritten here and nowhere else. The design hangs demo-only
 * behaviour off ids (`#hero`, `#vip-accept`); React renders many of these, so
 * the component carries a class instead. Doing it on the selector rather than
 * on the whole file matters: `#fff` in a declaration is a colour, and a pass
 * over the text turned `color:#fff` into `color:.id-fff`.
 */
/**
 * The design writes an icon as `<i data-icon="phone">`; we render `<Icon/>`,
 * which is an `<svg class="lucide">`.
 *
 * So every rule that styles an icon through its element name misses ours. It
 * is not cosmetic: `.input-icon>i` is `position:absolute`, and without it the
 * icon becomes a flex child that pushes the input sideways and clips the
 * phone number inside it. `.set-nav a.on i` is what makes the open section's
 * icon orange. Both looked fine in a passing test suite and wrong on screen.
 *
 * So each selector that names `i` is emitted twice, once with `svg`. The
 * design also uses `<i>` as a plain fill element — the bar inside `.bar`, the
 * grace band on the shift bar — and those keep working because the `<i>`
 * selector is still there and no `<svg>` is ever in those places.
 */
function alsoForSvg(part) {
  /* `i` as an element selector: at the start or after a combinator, and not
     part of a class or attribute name. `.d-input-icon` must not match. */
  const swapped = part.replace(
    /(^|[\s>+~(])i(?=$|[\s>+~).:[\]#,])/g,
    (_whole, before) => `${before}svg`,
  );
  return swapped === part ? null : swapped;
}

function scope(selector) {
  const parts = [];
  for (const raw of selector.split(',')) {
    const part = raw.replace(/#hero/g, '.hero').replace(/#([a-z][\w-]*)/g, '.id-$1').trim();
    if (!part) continue;

    const prefixed = part.replace(/\.([A-Za-z0-9_-]+)/g, (whole, name) =>
      (name === 'v2' || OURS.test(name) ? whole : `.d-${name}`));

    if (part.startsWith('html[data-theme="dark"]')) {
      const rest = prefixed.slice('html[data-theme="dark"]'.length).trim();
      parts.push(rest ? `html[data-theme="dark"] .v2 ${rest}` : 'html[data-theme="dark"] .v2');
    } else if (part.startsWith('html') || part.startsWith(':root')) {
      parts.push(prefixed);
    } else if (part.startsWith('body')) {
      parts.push(`.v2${prefixed.slice('body'.length)}`);
    } else {
      parts.push(`.v2 ${prefixed}`);
      const svg = alsoForSvg(prefixed);
      if (svg) parts.push(`.v2 ${svg}`);
    }
  }
  return parts.join(', ');
}

/**
 * Walk the CSS and rewrite it. Deliberately a small hand-rolled parser rather
 * than a dependency: it has one job, and the one thing it must never do is
 * silently drop a rule, which a regex over nested blocks does.
 */
function port(css, { keepAtRules = true } = {}) {
  const out = [];
  let buffer = '';
  let i = 0;

  while (i < css.length) {
    const char = css[i];

    if (char === '{') {
      const selector = buffer.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (selector.startsWith('@')) {
        if (!keepAtRules) {
          /* Skip the whole at-rule, body and all. */
          let j = i + 1;
          let depth = 1;
          while (j < css.length && depth > 0) {
            if (css[j] === '{') depth += 1;
            else if (css[j] === '}') depth -= 1;
            j += 1;
          }
          buffer = '';
          i = j;
          continue;
        }
        out.push(`${selector} {`);
        buffer = '';
        i += 1;
        continue;
      }

      let j = i + 1;
      let depth = 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      for (const comment of buffer.match(/\/\*[\s\S]*?\*\//g) ?? []) out.push(comment);
      if (selector) out.push(`${scope(selector)} {${css.slice(i + 1, j - 1).trim()}}`);
      buffer = '';
      i = j;
      continue;
    }

    if (char === '}') {
      out.push('}');
      buffer = '';
      i += 1;
      continue;
    }

    buffer += char;
    i += 1;
  }

  return out.join('\n');
}

/*
 * Rename every animation the design uses, once each.
 *
 * The `(?<!v2-)` is the whole point. Two keyframes named `pulse` and
 * `pulse-row` meant the long one was renamed first, to `v2-pulse-row`, and
 * then the short one matched *inside* it — `pulse` sits between two hyphens,
 * which are word boundaries — and left `v2-v2-pulse-row`. That names no
 * keyframe, so the row flash on Team live animated nothing, silently, on
 * every screen that used it.
 */
function renameAnimations(css, names) {
  let out = css;
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    out = out.replace(
      new RegExp(`(animation:[^;}]*?)(?<!v2-)\\b${name}\\b`, 'g'),
      (_whole, head) => `${head}v2-${name}`,
    );
  }
  return out;
}

function used(css, defined) {
  const names = new Set();
  for (const match of css.matchAll(/animation:[^;}]*/g)) {
    for (const name of defined.keys()) {
      if (new RegExp(`\\b${name}\\b`).test(match[0])) names.add(name);
    }
  }
  return names;
}

/* ── 1. the design system (ui.css, sections 4-18) ───────────────────────── */

const uiSource = readFileSync(path.join(DESIGN, 'ui.css'), 'utf8');
const { found: frames, spans } = keyframes(uiSource);

/* Blank the keyframe blocks before parsing: their `0%{...}` bodies look like
   nested rules and would be ported as selectors. */
const blanked = [...uiSource];
for (const [from, to] of spans) for (let k = from; k < to; k += 1) blanked[k] = ' ';
const lines = uiSource.split('\n');
const from = lines.slice(0, UI_FROM_LINE - 1).reduce((n, line) => n + line.length + 1, 0);
const to = lines.slice(0, UI_TO_LINE).reduce((n, line) => n + line.length + 1, 0);

const uiBody = renameAnimations(port(blanked.join('').slice(from, to)), frames.keys());
const uiFrames = [...used(uiBody, frames)].sort()
  .map((name) => `@keyframes v2-${name}${frames.get(name).slice(`@keyframes ${name}`.length)}`)
  .join('\n');

const BASE = `
/* ── The design's base layer (ui.css §2), scoped ─────────────────────────
 *
 * Small, and it is what makes everything else look right: without
 * \`a{color:inherit;text-decoration:none}\` every number on the home screen
 * renders as blue underlined link text, because the live app's base sheet
 * styles links for the live app.
 *
 * Every element selector is wrapped in \`:where()\`, which contributes nothing
 * to specificity. Without it \`.v2 button\` (0,1,1) beats \`.v2-chip-opt\`
 * (0,1,0), and a reset meant to clear the browser's default button styling
 * quietly cleared ours too: the chips on Add Lead and the outcome buttons on
 * the calling screen rendered as plain text, and only a screenshot showed it.
 * A reset should be the weakest rule in the file, not one of the strongest.
 */
.v2 :where(h1, h2, h3, h4, p) {margin:0}
.v2 :where(h1) {font-size:22px;font-weight:700;letter-spacing:-.02em}
.v2 :where(h2) {font-size:18px;font-weight:700;letter-spacing:-.015em}
.v2 :where(h3) {font-size:15px;font-weight:650;letter-spacing:-.01em}
.v2 :where(h4) {font-size:12px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3)}
.v2 :where(a) {color:inherit;text-decoration:none}
/* ui.css styles this one as \`a.link\`. Carried over for a <button> too,
   because an action that is a link in the design and a button in React is
   still the same thing on screen. */
.v2 a.d-link, .v2 button.d-link {color:var(--accent-ink);font-weight:600}
.v2 a.d-link:hover, .v2 button.d-link:hover {text-decoration:underline}
.v2 :where(button) {font:inherit;color:inherit;cursor:pointer;background:none;border:0;padding:0}
.v2 :where(input, select, textarea) {font:inherit;color:inherit}
.v2 :where(kbd) {font:600 11px/1 var(--font);padding:4px 6px;border-radius:6px;background:var(--surface-3);color:var(--ink-3)}
.v2 :where(hr) {border:0;border-top:1px solid var(--line);margin:16px 0}
.v2 {font-variant-numeric:tabular-nums}
.v2 :where(svg.lucide) {width:18px;height:18px;flex:none}
`;

const UI_HEADER = `/*
 * GENERATED by scripts/port-design-css.mjs from design/web/ui.css.
 * Do not edit by hand -- run the script again instead. It explains why every
 * selector is scoped under \`.v2\`, why every design class carries a \`d-\`
 * prefix, and why the animations are renamed.
 */
`;

writeFileSync(
  path.join(STYLES, 'v2-ui.css'),
  `${UI_HEADER}${BASE}\n${uiBody.trim()}\n\n/* The animations the rules above use, renamed. */\n${uiFrames}\n`,
);

/* ── 2. the pages that carry their own styles ───────────────────────────── */

/**
 * Each page's own rules, and the class that turns them on.
 *
 * The design loads one page at a time, so its page styles can safely use the
 * same class name for two different things. This app loads every stylesheet
 * at once, so each page's block is scoped to a `p-*` class that only that
 * screen's root element carries. Without it, the calling screen's `.card`
 * tweak would reach the home screen's cards.
 */
const PAGES = [
  ['my-day.html', 'My Day', 'p-my-day'],
  ['owner-home.html', "the owner's home", 'p-owner-home'],
  ['calling.html', 'calling', 'p-calling'],
  ['incoming.html', 'incoming', 'p-incoming'],
  ['my-leads.html', 'my leads', 'p-my-leads'],
  ['lead.html', 'the lead page', 'p-lead'],
  /* Settings and the office pages behind it. Added when it turned out the
     first Settings screen had been built from the written spec rather than
     from `settings.html`, and looked nothing like it. */
  ['settings.html', 'settings', 'p-settings'],
  ['company.html', 'the company page', 'p-company'],
  ['settings-team.html', 'team and roles', 'p-set-team'],
  ['settings-attendance.html', 'attendance rules', 'p-set-attendance'],
  ['ai-settings.html', "Homes AI's settings", 'p-ai-settings'],
  ['automations.html', 'automations', 'p-automations'],
  ['sales-offers.html', 'sales offers', 'p-offers'],
  ['import.html', 'import', 'p-import'],
  /* The rest of the design, ported in one pass so every screen's rebuild
     starts from its own page styles rather than Settings'. */
  ['homes-ai.html', 'Homes AI', 'p-homes-ai'],
  ['team-activity.html', 'who did what', 'p-activity'],
  ['dashboard.html', 'the dashboard', 'p-dashboard'],
  ['calendar.html', 'the calendar', 'p-calendar'],
  ['tasks.html', 'tasks', 'p-tasks'],
  ['attendance.html', 'attendance', 'p-attendance'],
  ['team-attendance.html', "the team's attendance", 'p-team-attendance'],
  ['team.html', 'the team', 'p-team'],
  ['profile.html', 'a profile', 'p-profile'],
  ['team-live.html', 'the team right now', 'p-team-live'],
  ['team-wall.html', 'the team wall', 'p-wall'],
  ['best-of-homes.html', 'best of homes', 'p-best'],
  ['notifications.html', 'the bell', 'p-bell'],
  ['search.html', 'search', 'p-find'],
  ['projects.html', 'the projects', 'p-projects'],
  ['project.html', 'a project', 'p-project'],
  ['manage-projects.html', 'managing projects', 'p-manage-projects'],
  ['transfers.html', 'transfers', 'p-transfers'],
  ['pipeline.html', 'the pipeline', 'p-pipeline'],
  ['all-leads.html', 'all leads', 'p-all-leads'],
  ['settings-team.html', 'team and roles', 'p-set-team'],
  ['desks.html', 'desks', 'p-desks'],
  ['system-health.html', 'system health', 'p-health'],
  ['feedback-inbox.html', 'the feedback inbox', 'p-feedback-inbox'],
  ['feedback.html', 'sending feedback', 'p-feedback'],
  ['inbox.html', 'the inbox', 'p-inbox'],
  ['email.html', 'email', 'p-email'],
  ['templates.html', 'templates', 'p-templates'],
  ['digital-card.html', 'the business card', 'p-card'],
  ['home-banners.html', 'home banners', 'p-banners'],
  ['messaging-report.html', 'the messaging report', 'p-messaging'],
  ['install-guide.html', 'the install guide', 'p-install'],
  ['add-lead.html', 'adding a lead', 'p-add-lead'],
  /* The sign-in screen. `docs/v2/screens.md` had it down as "the existing
     sign-in screen, unchanged", which was a false Done: the design is a
     two-column brand panel beside the form, nothing like the live card. */
  ['login.html', 'sign in', 'p-login'],
];

const pageCss = PAGES.map(([file, what, pageClass]) => {
  const html = readFileSync(path.join(DESIGN, file), 'utf8');
  const block = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  const ported = port(block, { keepAtRules: false })
    /* `.v2 X` becomes `.v2 .p-page X`, on every selector. */
    .replace(/^\.v2 /gm, `.v2 .${pageClass} `)
    .replace(/, \.v2 /g, `, .v2 .${pageClass} `)
    .replace(new RegExp(`\\.v2 \\.${pageClass} \\.${pageClass}\\b`, 'g'), `.v2 .${pageClass}`);
  return `\n/* ── ${what} (${file}) · scoped to .${pageClass} ───────────── */\n${ported}`;
}).join('\n');

const PAGE_HEADER = `/*
 * GENERATED by scripts/port-design-css.mjs from the <style> blocks of the
 * design's own page files. Do not edit by hand.
 *
 * These rules are not in ui.css -- the four hero states, the countdown ring's
 * placing, the call rows, the goal bars, the mini stats. Porting ui.css alone
 * produced a hero with the ring sitting on top of the agent's phone number.
 *
 * The design shows one hero state and hides the other three with CSS, because
 * its demo has a state switcher. Those rules are kept: the real screen renders
 * only the state that is true and sets the same \`data-state\`, so they agree.
 * The unconditional \`.d-hs\` rule below is the belt to that braces -- if
 * \`data-state\` is ever missing, the hero still lays out instead of vanishing.
 */

.v2 .d-hs {display:flex;flex:1;min-height:0;align-items:stretch;gap:28px}
`;

writeFileSync(path.join(STYLES, 'v2-home.css'), `${PAGE_HEADER}${pageCss}\n`);

console.log(`ported ui.css and ${PAGES.length} page stylesheets`);
