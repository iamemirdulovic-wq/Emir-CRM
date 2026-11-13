import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The owner's settings screens, against their design files.
 *
 * `docs/v2/audit-4.md` counted 101 items missing across eight of them, and
 * most were a block, a field, a button or a sentence that was simply not in
 * the markup. A behavioural test cannot see that — there is no DOM testing
 * library in this app — so this reads the source, the same way
 * `hook-order.test.ts`, `schema-map.test.ts` and `design-classes.test.ts` do,
 * and for the same reason: the fault is invisible to a green suite otherwise.
 *
 * It holds three kinds of thing:
 *
 *  - **wording the design fixes**, quoted from the design file;
 *  - **a control that is only there in the markup** — a second tap, a side
 *    panel, a row menu, an export link;
 *  - **the two sentences that must never slip**: the assistant is Homes AI,
 *    and an environment variable always beats the key saved in the CRM.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const V2 = path.join(HERE, '..');
const DESIGN = path.join(HERE, '..', '..', '..', '..', 'design', 'web');

function source(file: string): string {
  return readFileSync(path.join(HERE, file), 'utf8');
}

function design(file: string): string {
  return readFileSync(path.join(DESIGN, file), 'utf8');
}

/** The design's shared script, where its own answers to this live. */
const drawn24 = design('app.js');

/** The code, without the prose around it. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Every screen in this slice, with the design file it was built from and the
 * `p-*` class that carries that file's ported page styles.
 *
 * The `p-*` class is load-bearing: the ported CSS is `.v2 .p-X .d-foo`, so a
 * panel that does not name its own page gets Settings' and loses its layout.
 */
const SCREENS: Array<{ file: string; design: string; page: string }> = [
  { file: 'Team.tsx', design: 'settings-team.html', page: 'p-set-team' },
  { file: 'Company.tsx', design: 'company.html', page: 'p-company' },
  { file: 'FeedbackInbox.tsx', design: 'feedback-inbox.html', page: 'p-feedback-inbox' },
  { file: 'Health.tsx', design: 'system-health.html', page: 'p-health' },
  { file: 'Attendance.tsx', design: 'settings-attendance.html', page: 'p-set-attendance' },
  { file: 'Banners.tsx', design: 'home-banners.html', page: 'p-banners' },
  { file: 'Ai.tsx', design: 'ai-settings.html', page: 'p-ai-settings' },
  { file: '../Automations.tsx', design: 'automations.html', page: 'p-automations' },
];

describe('each screen carries its own page styles', () => {
  for (const screen of SCREENS) {
    it(`${screen.file} names ${screen.page}`, () => {
      expect(source(screen.file)).toContain(screen.page);
    });
  }
});

/* ── every page is behind the owner gate ───────────────────────────────── */

describe('an agent cannot open any of them', () => {
  /*
   * The owner typed these addresses in while signed in as an agent and every
   * one of them opened: the server refused the data, so what an agent saw was
   * a page frame and a red line reading "This action requires one of: owner,
   * admin" — which tells them nothing and reads like a broken CRM.
   *
   * `OwnerOnly` is the design's own block, with a way out. It is a screen,
   * not a permission: the permission is on every endpoint and stays there.
   */
  const ROUTES = [
    '/v2/settings/team', '/v2/settings/attendance', '/v2/settings/automations',
    '/v2/settings/company', '/v2/settings/ai', '/v2/settings/desks',
    '/v2/settings/health', '/v2/settings/feedback', '/v2/settings/banners',
    '/v2/automations',
  ];

  const app = readFileSync(path.join(V2, '..', 'App.tsx'), 'utf8');

  for (const route of ROUTES) {
    it(`${route} is wrapped in OwnerOnly`, () => {
      const line = app.split('\n').find((one) => one.includes(`path="${route}"`));
      expect(line, `${route} has no route`).toBeDefined();
      expect(line, `${route} renders without the owner block`).toContain('<OwnerOnly>');
    });
  }

  it('the block says what the server says', () => {
    const gate = readFileSync(path.join(V2, 'OwnerOnly.tsx'), 'utf8');
    expect(gate).toContain('Only for owners and admin');
    /* And it offers a way out, which is the half that stops it reading as a
       fault rather than a door. */
    expect(gate).toContain('Go to My Day');
  });
});

/* ── Team and roles ────────────────────────────────────────────────────── */

describe('Team and roles', () => {
  const text = source('Team.tsx');
  const drawn = design('settings-team.html');

  it('asks twice before handing out or taking away Owner', () => {
    /* §4.13. The select used to save on the first change, so one stray
       scroll wheel over a dropdown handed an agent the keys. */
    expect(text).toContain('Tap again · full access');
    expect(text).toContain('Tap again · no longer owner');
    expect(drawn).toContain('Tap again · full access');
    /* Both directions: owner in, and owner out. */
    expect(text).toContain("(role === 'owner' || person.role === 'owner')");
  });

  it('offers the row menu the design draws, with all three items', () => {
    for (const item of ['Send a reset link', 'Sign out everywhere', 'Deactivate']) {
      expect(text, `the ⋯ menu has no "${item}"`).toContain(item);
      expect(drawn).toContain(item);
    }
    expect(text).toContain('Tap again to deactivate');
  });

  it('will not offer to deactivate an owner', () => {
    expect(text).toContain('An owner cannot be deactivated.');
    expect(text).toContain("disabled={one.role === 'owner'}");
    expect(drawn).toContain('An owner cannot be deactivated.');
  });

  it('says what deactivating does to their leads', () => {
    expect(text).toContain('open leads go to Incoming. Notes and history stay.');
  });

  it('has the notifications table the design draws, and a Remind button', () => {
    for (const header of ['Phone app', 'Computer', 'Last alert']) {
      expect(text, `the alerts tab has no "${header}" column`).toContain(header);
    }
    expect(text).toContain('Remind all');
    expect(text).toContain('“Turn on notifications” on My Day');
    expect(text).toContain('Open the install guide');
  });

  it('has the design’s empty state for a search that finds nobody', () => {
    expect(text).toContain('Nobody found');
    expect(text).toContain('Try another name or email, or choose “All”.');
    expect(text).toContain('Show everyone');
  });

  it('uses the design’s nine role rows, word for word', () => {
    for (const row of [
      'Give, move and import leads',
      'Projects, banners, automations, desks',
      'Deactivate a person',
      'Company details and Homes AI budget',
    ]) {
      expect(text, `the roles table does not say "${row}"`).toContain(row);
      expect(drawn, `the design does not say "${row}" either`).toContain(row);
    }
  });

  it('has the design’s footer about admins and owners', () => {
    expect(text).toContain(
      'Admin can do the same as an owner, but cannot remove or change owners. An owner',
    );
    expect(text).toContain('can never be deactivated.');
  });

  it('has the three invite errors the design writes', () => {
    for (const message of [
      'Write the full name.',
      'Write a real email, like name@homes.me.',
      'This email is already in the team.',
    ]) {
      expect(text, `the invite dialog has no "${message}"`).toContain(message);
      expect(drawn).toContain(message);
    }
  });

  it('filters by the design’s four roles, in the design’s order', () => {
    const order = text.slice(text.indexOf('const FILTERS'), text.indexOf('const ROLES'));
    expect(order.indexOf('All')).toBeLessThan(order.indexOf('Owners'));
    expect(order.indexOf('Owners')).toBeLessThan(order.indexOf('Admin'));
    expect(order.indexOf('Admin')).toBeLessThan(order.indexOf('Agents'));
  });
});

/* ── Company ───────────────────────────────────────────────────────────── */

describe('Company', () => {
  const text = source('Company.tsx');
  const drawn = design('company.html');

  it('has the logo block the design draws', () => {
    expect(text).toContain('Upload a new logo');
    expect(drawn).toContain('Upload a new logo');
    expect(text).toContain('Tap again to remove');
    expect(text).toContain('No logo. Cards and offers show the brand name only.');
    expect(drawn).toContain('No logo. Cards and offers show the brand name only.');
  });

  it('has two address lines, not one', () => {
    /* One field meant the business card had to guess where to break the
       address, by splitting on a comma. */
    expect(text).toContain('label="Line 1"');
    expect(text).toContain('label="Line 2"');
    expect(text).toContain('Write the area and city.');
    expect(drawn).toContain('Write the area and city.');
  });

  it('has every field error the design writes', () => {
    for (const message of [
      'Write the legal name, as on the licence.',
      'Write the brand name.',
      'Digits only, at least 4.',
      'A TRN has 15 digits.',
      'Write the office address.',
      'Digits only, at least 9.',
      'This email does not look right.',
    ]) {
      expect(text, `Company has no "${message}"`).toContain(message);
      expect(drawn, `the design does not say "${message}" either`).toContain(message);
    }
  });

  it('says when the record last changed and who changed it', () => {
    expect(text).toContain('last change');
    expect(text).toContain('You have changes that are not saved');
    expect(drawn).toContain('You have changes that are not saved');
  });

  it('has the business card shortcut at the foot of the preview column', () => {
    expect(text).toContain('Business card tool');
    expect(drawn).toContain('Business card tool');
  });
});

/* ── Feedback inbox ───────────────────────────────────────────────────── */

describe('Feedback inbox', () => {
  const text = source('FeedbackInbox.tsx');
  const drawn = design('feedback-inbox.html');

  it('opens on New, not on All', () => {
    /* An inbox that opens on "All" shows a fortnight of fixed reports above
       the one that came in this morning. */
    expect(text).toContain("useState<string>('new')");
  });

  it('is a table with the design’s seven columns', () => {
    expect(text).toContain('<table');
    for (const header of ['Report', 'Type', 'From', 'Urgency', 'Status']) {
      expect(text, `the table has no "${header}" column`).toContain(`<th>${header}</th>`);
    }
    /* And the number an owner quotes out loud. */
    expect(text).toContain('#{one.ref');
  });

  it('has the side panel the design draws, with every block in it', () => {
    expect(text).toContain('d-panel');
    expect(text).toContain('Screenshot from the sender · click to open');
    expect(drawn).toContain('Screenshot from the sender · click to open');
    expect(text).toContain('<h4 className="d-mb-8">Replies</h4>');
    expect(text).toContain('Write a reply. The sender gets a notification.');
    expect(drawn).toContain('Write a reply. The sender gets a notification.');
    expect(text).toContain('Write your reply first.');
  });

  it('offers the three row buttons the design decides between', () => {
    expect(text).toContain("label: 'Plan it'");
    expect(text).toContain("label: 'Mark fixed'");
    expect(text).toContain("label: 'Open again'");
  });

  it('says the sender gets points, and offers the export', () => {
    expect(text).toContain('Every report gives the sender +');
    expect(text).toContain('Export file');
    expect(drawn).toContain('Export file');
  });

  it('has the design’s empty state', () => {
    expect(text).toContain('No report has this status now.');
    expect(drawn).toContain('No report has this status now.');
  });

  it('offers Undo on a status change rather than asking first', () => {
    expect(text).toContain("label: 'Undo'");
  });
});

/* ── System health ────────────────────────────────────────────────────── */

describe('System health', () => {
  const text = source('Health.tsx');
  const drawn = design('system-health.html');

  it('says how often it checks itself, as the design does', () => {
    expect(text).toContain('Is everything working? Checked by itself every 5 minutes.');
    expect(drawn).toContain('Is everything working? Checked by itself every 5 minutes.');
  });

  it('draws the thirty-day strip, and greys a day nobody sampled', () => {
    expect(text).toContain('d-hl-strip');
    expect(text).toContain('v2-hl-none');
    /* The tooltip the design writes, with a real percentage behind it. */
    expect(text).toContain('% up');
    expect(text).toContain('Bars: last');
  });

  it('has the “What to do” card and the timeline of past problems', () => {
    expect(text).toContain('What to do');
    expect(drawn).toContain('What to do');
    expect(text).toContain('d-timeline');
    expect(text).toContain('still open');
    expect(drawn).toContain('still open');
  });

  it('sends an owner to the list of people whose phone will not ring', () => {
    expect(text).toContain('Who has notifications on');
    expect(drawn).toContain('Who has notifications on');
  });

  it('has the design’s own button and footer wording', () => {
    expect(text).toContain('Run a check now');
    expect(drawn).toContain('Run a check now');
    expect(text).toContain('Something else is wrong? Tell us with a bug report marked “Blocking my work”.');
    expect(drawn).toContain('Something else is wrong? Tell us with a bug report marked “Blocking my work”.');
  });

  it('never prints a key, only whether one is set', () => {
    /*
     * The server returns booleans and a spend figure, and this page reads no
     * more than that. Comments are stripped first, because the file's own
     * docblock says out loud that no secret appears on the page — which is
     * the promise, not a breach of it.
     */
    expect(withoutComments(text)).not.toMatch(/apiKey|GEMINI|secret|token/i);
  });
});

/* ── Attendance rules ─────────────────────────────────────────────────── */

describe('Attendance rules', () => {
  const text = source('Attendance.tsx');
  const drawn = design('settings-attendance.html');

  it('asks for the network name the design asks for', () => {
    expect(text).toContain('Network name, exactly as on the phone');
    expect(drawn).toContain('Network name, exactly as on the phone');
    expect(text).toContain('Office Wi-Fi');
    expect(text).toContain('Check-in works only on these networks. Keep at least one.');
    expect(drawn).toContain('Check-in works only on these networks. Keep at least one.');
  });

  it('asks twice before removing a network, and offers Undo', () => {
    /* One tap can stop a whole office checking in tomorrow morning, and
       nothing else in the CRM would say why. */
    expect(text).toContain('Tap again to remove');
    expect(text).toContain('removed. Check-in no longer works on it.');
    expect(drawn).toContain('removed. Check-in no longer works on it.');
    expect(text).toContain("label: 'Undo'");
  });

  it('has the add errors and the keep-one note', () => {
    expect(text).toContain('Write the network name.');
    expect(text).toContain('This network is already in the list.');
    expect(drawn).toContain('This network is already in the list.');
    expect(text).toContain('This is the last network. Add another one before you remove it.');
    expect(drawn).toContain('This is the last network. Add another one before you remove it.');
  });

  it('makes “Late after” a time, with the design’s error', () => {
    expect(text).toContain('label="Late after"');
    expect(text).toContain('Must be after the start and before the end.');
    expect(drawn).toContain('Must be after the start and before the end.');
  });

  it('writes the times as 24-hour boxes, the way the design does', () => {
    /*
     * `<input type="time">` draws itself in the browser's own locale and
     * ignores `lang`, so on an en-US browser the shift read "7:00 PM". The
     * design hit this too and says so in `app.js`: "a native time field
     * shows AM/PM on some computers". Both answers are the same — a text box
     * that only takes HH:MM.
     */
    expect(drawn24).toContain('24-hour time boxes');
    expect(withoutComments(text)).not.toContain('type="time"');
    expect(text).toContain('inputMode="numeric"');
    expect(text).toContain('placeholder="HH:MM"');
    expect(text).toContain('24-hour clock, like 09:00 or 18:30');
    expect(drawn24).toContain('24-hour clock, like 09:00 or 18:30');
  });

  it('refuses to save half a time', () => {
    /* Not a time: keep the one that was. An empty shift makes every check-in
       late and nothing on screen would say why. */
    expect(text).toContain('if (HHMM.test(next)) onChange(next);');
  });

  it('refuses to save a shift that does not make sense', () => {
    expect(text).toContain('Check the shift times first. Nothing was saved.');
    expect(drawn).toContain('Check the shift times first. Nothing was saved.');
  });

  it('has the monthly report with its month picker', () => {
    expect(text).toContain('Monthly report');
    expect(text).toContain('/api/attendance/report.csv?month=');
    expect(text).toContain('working day');
    expect(drawn).toContain('Monthly report');
  });

  it('lets an admin edit, as sage §1 says', () => {
    expect(text).toContain("user?.role === 'owner' || user?.role === 'admin'");
  });
});

/* ── Home banners ─────────────────────────────────────────────────────── */

describe('Home banners', () => {
  const text = source('Banners.tsx');
  const drawn = design('home-banners.html');

  it('says how many there can be and how fast they change', () => {
    expect(text).toContain('they change\n          every {got.data.rotateSeconds} seconds.');
    expect(text).toContain('of {max} used');
    expect(drawn).toContain('they change every 4.5 seconds');
  });

  it('has the New banner button rather than a form that is always open', () => {
    expect(text).toContain('New banner');
    expect(drawn).toContain('New banner');
  });

  it('has every field the design’s form has', () => {
    for (const label of [
      'Picture', 'Label', 'Button text', 'Opens', 'Show from', 'Until', 'Who sees it',
    ]) {
      expect(text, `the form has no "${label}"`).toContain(label);
      expect(drawn, `the design has no "${label}" either`).toContain(label);
    }
    expect(text).toContain('1200 × 500 px');
    expect(drawn).toContain('1200 × 500 px');
  });

  it('shows Live, Scheduled or Ended on each row, and who has seen it', () => {
    expect(text).toContain('seen by ');
    expect(text).toContain('{one.state}');
    expect(drawn).toContain('Drag to change the order');
    expect(text).toContain('Drag to change the order');
  });

  it('is draggable, which is how the design reorders them', () => {
    expect(text).toContain('draggable');
    expect(text).toContain('onDrop');
    expect(text).toContain('Order saved · agents see the new order now');
    expect(drawn).toContain('Order saved · agents see the new order now');
  });

  it('refuses the four things the design’s form refuses', () => {
    expect(text).toContain('“Until” is before “Show from”. Choose a later day.');
    expect(text).toContain('The start day is in the past.');
    expect(text).toContain('Write the full web link. It starts with https://');
    expect(drawn).toContain('Write the full web link. It starts with https://');
  });
});

/* ── Homes AI ─────────────────────────────────────────────────────────── */

describe('Homes AI', () => {
  const text = source('Ai.tsx');
  const drawn = design('ai-settings.html');

  it('is called Homes AI, never Emir AI', () => {
    expect(text).toContain('Homes AI');
    expect(text).not.toContain('Emir AI');
  });

  it('has the box for the key, which was only on the old settings page', () => {
    expect(text).toContain('Google Gemini key');
    expect(text).toContain('/api/ai/connection');
  });

  it('says plainly that the hosting panel always wins', () => {
    /*
     * `server/src/config/secrets.ts` reads the environment first. Without
     * this sentence an owner pastes a new key, sees "saved", and watches the
     * stale one keep answering.
     */
    expect(text).toContain('This key is set in the hosting panel, and that always wins.');
    expect(text).toContain('GEMINI_API_KEY');
  });

  it('never shows the key itself', () => {
    expect(text).toContain('It is never shown again — only the last four characters.');
    expect(text).toContain('type="password"');
  });

  it('forecasts the month with a date on it, as the design does', () => {
    expect(text).toContain('At this speed: about $');
    expect(text).toContain('· over the limit');
    expect(drawn).toContain('· over the limit');
    expect(text).toContain('Homes AI pauses until ');
    expect(text).toContain('Alert to owners at 80% and at 100%');
    expect(drawn).toContain('Alert to owners at 80% and at 100%');
  });

  it('counts the letters in the company text, with the design’s two guards', () => {
    expect(text).toContain('letters');
    expect(text).toContain('Write at least one full sentence.');
    expect(drawn).toContain('Write at least one full sentence.');
    expect(text).toContain('The text is too long. Keep it under ');
    expect(text).toContain('MIN_LETTERS');
  });
});

/* ── Automations ──────────────────────────────────────────────────────── */

describe('Automations', () => {
  const text = readFileSync(path.join(V2, 'Automations.tsx'), 'utf8');
  const drawn = design('automations.html');

  it('asks twice before switching take-back off', () => {
    /* One tap stops every clock in the CRM, silently. */
    expect(text).toContain('Tap again to turn take-back off. Uncalled leads will stay with agents.');
    expect(drawn).toContain('Tap again to turn take-back off. Uncalled leads will stay with agents.');
  });

  it('says the whole sentence, alert and notes included', () => {
    expect(text).toContain('goes back to Incoming and you get an');
    expect(text).toContain('Notes and history stay with the lead.');
    expect(drawn).toContain('Notes and history stay with the lead.');
    expect(text).toContain('working days)');
  });

  it('says the off state in the card, not only in a toast', () => {
    expect(text).toContain('Leads stay with the agent even when nobody calls them.');
    expect(drawn).toContain('Leads stay with the agent even when nobody calls them.');
  });

  it('keeps the design’s own wording on the VIP and import notes', () => {
    expect(text).toContain('gets a warning 10 min before the end.');
    expect(drawn).toContain('gets a warning 10 min before the end.');
    expect(text).toContain('The agent sees the day and hour on the lead, like “goes');
  });

  it('shows how long a taken-back lead has been waiting', () => {
    expect(text).toContain('Waits {');
    expect(drawn).toContain('Waits 11 min');
  });
});
