import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The date a lead was given out, in all three places it had to go.
 *
 * Talha sent the owner a screenshot of his leads list on 14 Nov 2026 — 105 new
 * leads, every card identical — and said: *"you need to put dates on the leads
 * once they assign, so we know which one is today leads, which one is
 * yesterday, and which one is day before yesterday."*
 *
 * `lib/assigned.test.ts` holds the arithmetic. This file holds the wiring,
 * because the wiring is the part that is invisible when it breaks: a column
 * added inside the phone branch can never be reached on a computer, and a
 * field left out of the server's SELECT arrives as `undefined` and renders as
 * nothing at all with the suite green. There is no DOM testing library in this
 * app, so these read the source — the same trick `hook-order.test.ts`,
 * `schema-map.test.ts` and `leads-screens.test.ts` use, and for the same
 * reason.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const WEB = path.join(HERE, '..');
const SERVER = path.join(HERE, '..', '..', '..', 'server', 'src');

const read = (file: string) => readFileSync(file, 'utf8');

/** `Leads.tsx` after the phone branch has returned: the computer layout. */
function computerLayout(): string {
  const text = read(path.join(HERE, 'Leads.tsx'));
  const phoneAt = text.indexOf('  if (isPhone) {');
  expect(phoneAt, 'the phone branch should still be there').toBeGreaterThan(-1);
  const computerAt = text.indexOf("  return (\n    <div className={wide ? 'v2-leadlist p-all-leads'", phoneAt);
  expect(computerAt, 'and the computer layout after it').toBeGreaterThan(phoneAt);
  return text.slice(computerAt);
}

/** The phone branch on its own. */
function phoneLayout(): string {
  const text = read(path.join(HERE, 'Leads.tsx'));
  const phoneAt = text.indexOf('  if (isPhone) {');
  const computerAt = text.indexOf("  return (\n    <div className={wide ? 'v2-leadlist p-all-leads'", phoneAt);
  return text.slice(phoneAt, computerAt);
}

/* ── 1. the server sends it ───────────────────────────────────────────── */

describe('the list endpoint', () => {
  const route = read(path.join(SERVER, 'http', 'routes', 'my-leads.ts'));

  it('selects assigned_at into the lead list', () => {
    /*
     * The column has existed since `0001_init.sql` and is written by every
     * assignment path. It was simply never in this SELECT, which is the whole
     * reason the screens could not show it.
     */
    expect(route).toMatch(/o\.assigned_at/);
  });

  it('uses one SELECT for the list and for a single lead', () => {
    /* So the field cannot arrive on one screen and not the other. */
    expect(route).toContain('${SELECT} WHERE ${clause}');
    expect(route).toContain('${SELECT} WHERE o.id = ?');
  });
});

/* ── 2. the v2 computer table ─────────────────────────────────────────── */

describe('the v2 computer table', () => {
  const computer = computerLayout();

  it('has a column for when the lead was given out', () => {
    /*
     * One word in the header, because an 11px uppercase `th` with letter
     * spacing set the whole column's width and the table has none to spare —
     * the `title` says which "given" it means.
     */
    expect(computer).toContain('className="v2-given-cell"');
    expect(computer).toContain('When the lead was given to its agent');
    expect(computer).toContain('When the lead was given to you');
  });

  it('draws the day headings between the groups, spanning the whole row', () => {
    expect(computer).toContain('byDay.map');
    expect(computer).toContain('v2-daygroup');
    expect(computer).toContain('colSpan={columns}');
    expect(computer).toContain('{day.heading}');
    expect(computer).toContain('{day.count}');
  });

  it('counts the heading’s colSpan from the same conditions as the columns', () => {
    /*
     * A hard-coded number here is a heading that stops halfway across the row
     * the next time somebody adds a column — and only on one of the two
     * screens, because the owner's book has two columns the agent's has not.
     */
    const text = read(path.join(HERE, 'Leads.tsx'));
    expect(text).toMatch(/const columns = \(book \? 1 : 0\) \+ 5/);
  });

  it('renders the row’s cell through the shared helper', () => {
    const text = read(path.join(HERE, 'Leads.tsx'));
    expect(text).toContain('<td className="v2-given-cell"><GivenLine at={row.assigned_at} /></td>');
    expect(text, 'the one helper, so the three screens word it the same')
      .toContain("from '../lib/assigned.js'");
  });

  it('uses the one component for the table, the card and the owner’s row', () => {
    /*
     * One `GivenLine` for all three, so the three screens cannot word the
     * same date three ways — which is how "Yesterday" ended up meaning two
     * different days on two screens of this product before.
     */
    const text = read(path.join(HERE, 'Leads.tsx'));
    expect(text.match(/function Given/g) ?? [], 'exactly one of them').toHaveLength(1);
    expect(text, 'the whole date is one hover away').toContain('title={line.exact ?? undefined}');
  });
});

/* ── 3. the v2 phone card ─────────────────────────────────────────────── */

describe('the v2 phone card', () => {
  const text = read(path.join(HERE, 'Leads.tsx'));

  it('says when the lead was given to you', () => {
    expect(text).toContain('<GivenLine at={row.assigned_at} label="Given to you" />');
  });

  it('groups the phone list by day too', () => {
    const phone = phoneLayout();
    expect(phone).toContain('byDay.map');
    expect(phone).toContain('v2-a-day');
    expect(phone).toContain('{day.heading}');
  });

  it('drops the "New" stage chip, which repeated the tab above it', () => {
    /*
     * Talha's screenshot was the New tab: 105 cards each carrying a "New"
     * pill that said nothing the heading did not, in the one piece of space
     * the date could use. Every other stage still shows, because Called,
     * Interested, Meeting, Offer and Won each say something the rest of the
     * card does not.
     */
    expect(text).toContain("row.stage_key !== 'new_lead' && (");
  });
});

/* ── 4. the live v1 screen, which is what Talha is using today ────────── */

describe('the live v1 My Leads', () => {
  const text = read(path.join(WEB, 'pages', 'MyLeads.tsx'));

  it('asks for assigned_at and puts it on every row', () => {
    expect(text).toContain('assigned_at: string | null;');
    expect(text).toContain('<GivenOn at={lead.assigned_at}');
  });

  it('groups by the day it was given out', () => {
    expect(text).toContain('groupByGivenDay');
    expect(text).toContain('lead-day');
    expect(text).toContain('{day.heading}');
    expect(text).toContain('{day.count}');
  });

  it('says "Given to you" to an agent and plain "Given" to a manager', () => {
    expect(text).toContain("label={showOwner ? 'Given' : 'Given to you'}");
  });

  it('reads assigned_at and nothing else', () => {
    /*
     * The rule from CLAUDE.md: never fall back to another date and present it
     * as the assignment date. `created_at` and `last_contact_at` are both on
     * this row and both wrong for this question.
     */
    expect(text).not.toMatch(/GivenOn at=\{lead\.(created_at|last_contact_at)\}/);
  });
});

/* ── 5. the stylesheets the three of them need ────────────────────────── */

describe('the warm colour on anything older than today', () => {
  const shell = read(path.join(WEB, 'styles', 'v2-shell.css'));
  const phone = read(path.join(WEB, 'styles', 'v2-phone-a.css'));
  const kit = read(path.join(WEB, 'styles', 'kit.css'));

  it('is a token that already exists, in every one of the three sheets', () => {
    /* "Use the tokens already in the stylesheets — do not invent a colour."
       `--amber-ink` is the v2 design system's warm ink; `--att-late` is v1's,
       and the only warm one there picked for contrast on both themes. */
    expect(shell).toMatch(/\.v2-given-old\{ color:var\(--amber-ink\)/);
    expect(phone).toMatch(/\.v2-given-old \{ color: var\(--amber-ink\)/);
    expect(kit).toMatch(/\.lead-given-old\{color:var\(--att-late\)\}/);
  });

  it('puts the computer’s rules in the base layer of v2-shell.css', () => {
    /*
     * The bottom half of `v2-shell.css` is inside `@media (max-width:767px)`,
     * and three fixes written for the computer have already landed in there
     * and done nothing at any width above 767px, in silence, with the suite
     * green. The `.v2-given` rules must be outside every query.
     *
     * Counted by brace depth rather than by eye, because by eye is how it
     * went wrong the first three times.
     */
    const css = shell.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf('.v2 .v2-given{');
    expect(at, 'the rule should be in v2-shell.css').toBeGreaterThan(-1);
    let depth = 0;
    for (const ch of css.slice(0, at)) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    expect(depth, 'depth 0 is the base layer; 1 is inside a media query').toBe(0);
  });

  it('puts the phone’s rules inside the 767px query, with three classes', () => {
    const css = phone.replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf('.v2.v2-phone .v2-a-day {');
    expect(at).toBeGreaterThan(-1);
    let depth = 0;
    for (const ch of css.slice(0, at)) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
    expect(depth, 'inside @media (max-width: 767px)').toBe(1);
  });

  it('styles the table’s heading row deep enough to beat the ported page CSS', () => {
    /*
     * The ported page CSS is `.v2 .p-my-leads .d-id-leads td` — three classes
     * and one element. A two-class rule here loses, the heading row inherits a
     * lead row's 52px height and 8px padding, and the code looks right.
     */
    expect(shell).toContain('.v2 .d-id-leads tr.v2-daygroup td{');
  });
});
