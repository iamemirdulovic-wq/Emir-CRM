import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addLeadSub, attendanceSub, bestSub, cardSub, emailSub, feedbackSub, importSub,
  inboxSub, liveSub, messagingSub, teamSub, templatesSub, wallSub,
} from './subs.js';
import { STEPS as IMPORT_STEPS } from './Import.js';
import { STEPS as CARD_STEPS } from './Card.js';

/**
 * The line under the page title, on the fourteen screens that had none of
 * their own — or had one the computer design disagrees with.
 *
 * Two things are being held here, and the second is the one that matters.
 *
 * 1. **Every screen sets a sub.** The shell draws `head.sub` and nothing else,
 *    so a screen that never sets one leaves the line blank. Proved by reading
 *    each screen's source, the same trick `hook-order.test.ts` uses, because
 *    there is no DOM testing library in this app.
 *
 * 2. **No sub carries a number the screen did not compute.** The design's
 *    figures are invented: `team.html` says ten agents, `templates.html`
 *    sixteen templates, `best-of-homes.html` week 46 ending Sunday 23:59.
 *    Every one of those would have looked right in a screenshot and been a
 *    lie on a Tuesday. So each builder is fed a fixture and the expectation is
 *    read back off that same fixture — never written out as a literal — and
 *    then fed a different one to show the number moves.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DESIGN = path.join(HERE, '../../../design/web');

function source(file: string): string {
  return readFileSync(path.join(HERE, file), 'utf8');
}

/** What the design file itself puts on the line, straight off its `<body>`. */
function designSub(page: string): string {
  const html = readFileSync(path.join(DESIGN, `${page}.html`), 'utf8');
  const body = (html.match(/<body[^>]*>/) ?? [''])[0];
  const sub = (body.match(/data-sub="([^"]*)"/) ?? [])[1];
  expect(sub, `${page}.html should declare a data-sub`).toBeTruthy();
  /* The design files are HTML, so "Owner &amp; admin" arrives escaped. */
  return (sub as string).replace(/&amp;/g, '&').replace(/&nbsp;/g, '\u00a0');
}

/** Every digit run of two or more in a string — the numbers it asserts. */
function numbers(text: string): string[] {
  return text.match(/\d{2,}/g) ?? [];
}

/* ── 1. every screen sets one, and from the shared builder ──────────────── */

/**
 * screen file → the builder it must call. One row per page in the owner's
 * list; `/v2/activity` is another agent's file and is not here.
 */
const WIRED: Array<[file: string, builder: string]> = [
  ['AddLead.tsx', 'addLeadSub'],
  ['Import.tsx', 'importSub'],
  ['Team.tsx', 'teamSub'],
  ['Card.tsx', 'cardSub'],
  ['Wall.tsx', 'wallSub'],
  ['Wall.tsx', 'bestSub'],
  ['Attendance.tsx', 'attendanceSub'],
  ['Live.tsx', 'liveSub'],
  ['Messaging.tsx', 'messagingSub'],
  ['Inbox.tsx', 'inboxSub'],
  ['Email.tsx', 'emailSub'],
  ['Templates.tsx', 'templatesSub'],
  ['Feedback.tsx', 'feedbackSub'],
];

describe('every screen in the design package sets its own sub-line', () => {
  for (const [file, builder] of WIRED) {
    it(`${file} draws ${builder}() under the title`, () => {
      const text = source(file);
      expect(text, `${file} should import ${builder}`)
        .toMatch(new RegExp(`import \\{[^}]*\\b${builder}\\b[^}]*\\} from '\\./subs\\.js'`));
      /* Not just imported — handed to the header slot the shell reads. */
      expect(text, `${file} should pass it as the sub`)
        .toMatch(new RegExp(`sub:[^,\\n]*\\b${builder}\\(`));
    });
  }

  /*
   * The two screens that are one file: `Wall.tsx` holds the wall and the
   * leaderboard, and each has to set its own line. A single `usePhoneHead`
   * would leave whichever came second with the other's.
   */
  it('gives the wall and Best of Homes a line each', () => {
    const calls = source('Wall.tsx').match(/usePhoneHead\(/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  /* The Dubai clock, from the helper that already exists. A second offset
     written by hand here is how two screens come to disagree about today. */
  it('takes the date from the existing Dubai helpers', () => {
    expect(source('subs.ts')).toMatch(/from '\.\.\/lib\/calendar\.js'/);
  });
});

/* ── 2. the wording-only lines are the design's, exactly ────────────────── */

describe('the lines with no number in them are copied from the design', () => {
  const same: Array<[page: string, built: string]> = [
    ['add-lead', addLeadSub()],
    ['team-wall', wallSub()],
    ['team-live', liveSub()],
    ['messaging-report', messagingSub()],
    ['inbox', inboxSub()],
    ['email', emailSub()],
    ['feedback', feedbackSub()],
  ];

  for (const [page, built] of same) {
    it(`${page}.html`, () => {
      expect(built).toBe(designSub(page));
      /* And nothing numeric crept into a line that has no number in it. */
      expect(numbers(built)).toEqual([]);
    });
  }
});

/* ── 3. the lines with a number in them compute it ──────────────────────── */

describe('the counts come from the screen and not from the design file', () => {
  /*
   * The team directory. `design/web/team.html` writes "10 agents · 6 in
   * office now" and its own filter pills say "All 10" and "In office now 6" —
   * one pair of numbers, counted over the people the grid shows.
   */
  const ROSTER = [
    { name: 'Talha', role: 'agent', where: 'office' },
    { name: 'Sara', role: 'agent', where: 'home' },
    { name: 'Omar', role: 'manager', where: 'office' },
    { name: 'Lina', role: 'agent', where: 'leave' },
    /* In the directory's answer but not in the grid: the design draws these
       in an "Owners and office" row of their own, below the count. */
    { name: 'Emir', role: 'owner', where: 'office' },
  ];

  it('counts the roster it was given, not ten agents', () => {
    const grid = ROSTER.filter((one) => one.role === 'agent' || one.role === 'manager');
    const here = grid.filter((one) => one.where === 'office');
    const built = teamSub(grid.length, here.length);

    expect(built).toBe(`${grid.length} agents · ${here.length} in office now`);
    /* The design's own figures, which this fixture does not have. */
    expect(numbers(built)).not.toContain('10');
    expect(built).not.toContain(`${ROSTER.length} agents`);
  });

  it('moves when the roster does, and says "1 agent" for one', () => {
    expect(teamSub(1, 1)).toBe('1 agent · 1 in office now');
    expect(teamSub(2, 0)).toBe('2 agents · 0 in office now');
  });

  /* The two steppers. Both screens own a `STEPS` list and the line counts it,
     so a seventh import step or a fourth card step is carried automatically. */
  it('counts the import stepper', () => {
    expect(importSub(IMPORT_STEPS.length)).toBe(designSub('import'));
    expect(importSub(4)).toBe('Excel or CSV · 4 short steps');
  });

  it('counts the card stepper', () => {
    expect(cardSub(CARD_STEPS.length)).toBe(designSub('digital-card'));
    expect(cardSub(5)).toBe('Make your card in 5 steps');
  });

  /*
   * The templates. `design/web/templates.html` says sixteen; the screen merges
   * what the live API and the library answered and counts those.
   */
  it('counts the templates it loaded, not sixteen', () => {
    const loaded = [
      { id: 'lead_welcome_en' }, { id: 'followup_2h_en' }, { id: 'followup_24h_en' },
    ];
    const built = templatesSub(loaded.length);

    expect(built).toBe(`${loaded.length} WhatsApp templates · later phase`);
    expect(numbers(built)).not.toContain('16');
    /* The rest of the design's line is kept word for word. */
    expect(designSub('templates')).toContain('WhatsApp templates · later phase');
  });

  it('says "1 WhatsApp template" for one', () => {
    expect(templatesSub(1)).toBe('1 WhatsApp template · later phase');
  });
});

/* ── 4. the two lines the design asks for and the data cannot give ──────── */

describe('attendance says when the shift starts, because no end is stored', () => {
  /* What `/api/v2/attendance/me` really returns: a start, and no end. */
  const TODAY = { enabled: true, startsAt: '09:00', marked: null };
  const AT = new Date('2026-11-11T06:00:00Z'); // 10:00 in Dubai

  it("carries the agent's date, the year, and the real start", () => {
    const built = attendanceSub(false, AT, TODAY.startsAt);
    expect(built).toBe(`Wednesday, 11 November 2026 · shift starts ${TODAY.startsAt}`);
    /* The design's invented end of the shift is not in it. */
    expect(built).not.toContain('18:00');
  });

  it("drops the year on the owner's, as team-attendance.html does", () => {
    expect(attendanceSub(true, AT, TODAY.startsAt))
      .toBe('Wednesday, 11 November · shift starts 09:00');
    expect(designSub('team-attendance')).not.toContain('2026');
    expect(designSub('attendance')).toContain('2026');
  });

  it('takes the start from the fixture and not from the design', () => {
    const early = { ...TODAY, startsAt: '08:30' };
    expect(attendanceSub(false, AT, early.startsAt)).toContain(early.startsAt);
    expect(attendanceSub(false, AT, early.startsAt)).not.toContain('09:00');
  });

  it('gives the date alone when check-in is switched off', () => {
    expect(attendanceSub(false, AT, null)).toBe('Wednesday, 11 November 2026');
  });

  /*
   * Dubai is UTC+4 with no daylight saving, and the date has to be Dubai's.
   * 21:00 UTC on the 11th is already one in the morning on the 12th here, and
   * an attendance screen that says Wednesday when the office says Thursday is
   * worse than one that says nothing.
   */
  it('rolls the day over on Dubai time, not the browser’s', () => {
    expect(attendanceSub(false, new Date('2026-11-11T21:00:00Z'), '09:00'))
      .toBe('Thursday, 12 November 2026 · shift starts 09:00');
    expect(attendanceSub(false, new Date('2026-11-11T19:59:00Z'), '09:00'))
      .toBe('Wednesday, 11 November 2026 · shift starts 09:00');
  });
});

describe('Best of Homes gives the window it really ranks', () => {
  /*
   * `design/web/best-of-homes.html` writes "Week 46 · Mon 9 – Sun 15 Nov ·
   * ends Sunday 23:59". `/api/wall/sidebar` ranks a rolling window of days
   * and has no week and no deadline, so neither the week number nor the
   * deadline may appear. `docs/v2/questions-subs.md`.
   */
  const AT = new Date('2026-11-13T10:00:00Z');

  it('names both ends of the rolling window', () => {
    expect(bestSub(30, AT)).toBe('Points over the last 30 days · 15 Oct – 13 Nov');
  });

  it('moves with the window length', () => {
    expect(bestSub(7, AT)).toBe('Points over the last 7 days · 7 Nov – 13 Nov');
  });

  /*
   * Both ends are the same Dubai day arithmetic, applied once.
   *
   * This is here because it was wrong: the far end was converted to Dubai a
   * second time after the days had been subtracted, which added four hours
   * and rolled it onto the next date for anything after eight in the evening
   * UTC. The build read "16 Oct – 13 Nov" for a thirty-day window while the
   * test above, sitting at lunchtime, read 15 Oct and passed.
   */
  it('counts back from the Dubai day at any hour of it', () => {
    const lunchtime = bestSub(30, new Date('2026-11-13T10:00:00Z'));
    const lateEvening = bestSub(30, new Date('2026-11-13T19:30:00Z')); // 23:30 in Dubai
    expect(lateEvening).toBe(lunchtime);
    expect(lateEvening).toContain('15 Oct – 13 Nov');
  });

  it('crosses midnight in Dubai, not in UTC', () => {
    /* 21:00 UTC is 01:00 the next day here, so both ends move on by one. */
    expect(bestSub(30, new Date('2026-11-13T21:00:00Z')))
      .toBe('Points over the last 30 days · 16 Oct – 14 Nov');
  });

  it('carries neither the design’s week number nor its deadline', () => {
    const built = bestSub(30, AT);
    const design = designSub('best-of-homes');

    expect(design).toContain('Week 46');
    expect(built).not.toContain('Week');
    expect(built).not.toContain('46');
    expect(built).not.toContain('23:59');
  });
});
