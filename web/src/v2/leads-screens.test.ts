import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_TABS, OWNER_TABS } from './Leads.js';
import { LOST_REASONS, SIGNED, readAmount } from './LeadAction.js';

/**
 * The faults the owner found by hand on the leads screens, 13 Nov 2026.
 *
 * Four of the nine were not logic at all — they were markup that existed only
 * inside the phone branch, which on a computer can never be reached. A unit
 * test cannot click a tick box here (there is no DOM testing library in this
 * app), so those four are held by reading the source and proving the markup is
 * on the computer side of `if (isPhone)`. That is the same trick
 * `hook-order.test.ts` and `schema-map.test.ts` use, and it is in both cases
 * because the mistake is invisible to a green suite otherwise.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);

function source(file: string): string {
  return readFileSync(path.join(HERE, file), 'utf8');
}

/**
 * The part of `Leads.tsx` that draws the computer, i.e. everything after the
 * phone branch has returned.
 */
function computerLayout(): string {
  const text = source('Leads.tsx');
  const phoneAt = text.indexOf('  if (isPhone) {');
  expect(phoneAt, 'the phone branch should still be there').toBeGreaterThan(-1);
  const computerAt = text.indexOf("  return (\n    <div className={wide ? 'v2-leadlist p-all-leads'", phoneAt);
  expect(computerAt, 'and the computer layout after it').toBeGreaterThan(phoneAt);
  return text.slice(computerAt);
}

/* ── 1. an owner opening All leads gets the owner's screen ─────────────── */

describe('whose screen the leads list is', () => {
  /*
   * `/v2/leads` landed an owner on the agent's My Leads: the Today tab, a
   * "Start calling" strip, a "Free leads" link, and the handful of leads the
   * owner personally holds. Their book of 863 was behind the All tab, and so
   * were the agent filter and the Agent column.
   */
  it('opens an owner on their own book and an agent on today', () => {
    const text = source('Leads.tsx');
    expect(text).toContain("const firstTab: TabKey = owns ? 'all' : 'today'");
    expect(
      text,
      'it used to be `isPhone && owns`, so only the phone opened on the book',
    ).not.toContain('isPhone && owns');
  });

  it('gives the owner the design’s tabs and not the agent’s', () => {
    const owner = OWNER_TABS.map((one) => one.key);
    /*
     * `all-leads.html` draws six: All, Going cold, Overdue, No next step,
     * VIP, Lost. Today and New are the agent's and belong on their screen.
     *
     * **Won is a seventh the design does not draw**, and it is here on the
     * owner's instruction of 14 Nov, not by oversight. All used to mean every
     * row, so a closed deal was already in the list; once All was narrowed to
     * live leads, Won needed somewhere to go or it would have been hidden
     * rather than filed. `docs/decisions-to-confirm.md` has it.
     */
    expect(owner).toEqual(['all', 'cold', 'overdue', 'no_next_step', 'vip', 'lost', 'won']);
    expect(owner).not.toContain('today');
    expect(owner).not.toContain('new');
    expect(OWNER_TABS[0]?.label).toBe('All');
    expect(OWNER_TABS[1]?.label).toBe('Going cold');
  });

  it('leaves the agent’s own tabs alone', () => {
    /* Won sits beside Lost, before All -- the two looking-back tabs together
       at the end of the work. Same 14 Nov decision as above. */
    expect(AGENT_TABS.map((one) => one.key))
      .toEqual(['today', 'new', 'overdue', 'no_next_step', 'vip', 'lost', 'won', 'all']);
  });

  /* An owner's screen is the wide one on every tab, not only on All: without
     this, pressing "Going cold" dropped back to the agent's narrow table. */
  it('keeps the owner on the wide table whichever tab is open', () => {
    expect(source('Leads.tsx')).toContain("const wide = owns || tab === 'all' || tab === 'hot'");
  });
});

/* ── 2. the tick boxes and "Move N leads", on the computer ─────────────── */

describe('selecting and moving leads on a computer', () => {
  const computer = computerLayout();

  it('puts a tick box on every row and one in the header', () => {
    expect(computer, 'the design’s tick column').toContain('d-t-check');
    expect(computer).toContain('Select all on this page');
    expect(computer).toContain('selectable={book}');
  });

  it('shows the dark bulk bar with both bulk actions', () => {
    expect(computer).toContain('d-bulkbar');
    expect(computer).toContain('Move to agent');
    expect(computer).toContain('Move to Incoming');
    expect(computer).toContain('selected');
  });

  it('opens a "Move N leads" panel that asks twice', () => {
    expect(computer).toContain('Move leads');
    expect(computer, 'the design’s second tap').toContain('Tap again · move');
    expect(computer).toContain('Notes and history go with them. The new agent gets one notification.');
    expect(computer, 'fewest open leads first, Incoming at the top').toContain('fewest open leads first');
  });

  it('offers Undo afterwards rather than a confirmation first', () => {
    const text = source('Leads.tsx');
    expect(text).toContain("label: 'Undo'");
    expect(text).toContain('Move undone');
  });

  it('moves the whole batch in one request, and records where each came from', () => {
    const text = source('Leads.tsx');
    expect(text).toContain("'/api/my-leads/move'");
    /* It used to be one `reassign` call per lead from the browser — twenty
       leads was twenty round trips and no way back. */
    expect(text).not.toContain('/reassign');
    expect(text, 'the inverse list is what Undo sends').toContain('toUserId: one.fromUserId');
  });

  it('gives every row a "⋯" menu', () => {
    expect(computer).toContain('d-menu d-open');
    expect(computer).toContain('Open full page');
    expect(computer).toContain('Give to another agent');
    expect(computer).toContain('Transfer to another agent');
    expect(computer).toContain('Plan a follow-up');
  });
});

/* ── 3. a row click opens the side panel ──────────────────────────────── */

describe('what a row click does', () => {
  it('opens the 480px panel instead of leaving the list', () => {
    const computer = computerLayout();
    expect(computer).toContain('<LeadPanel');
    expect(computer).toContain('onOpen={() => setPanelFor(row)}');

    const text = source('Leads.tsx');
    expect(text).toContain('if (onOpen) onOpen();');
    /* And the panel is the design's own 480px aside, not a dialog. */
    expect(text).toContain("className=\"d-panel d-open\"");
  });

  it('is the design’s 480px, which comes from the ported stylesheet', () => {
    const css = readFileSync(path.join(HERE, '..', 'styles', 'v2-ui.css'), 'utf8');
    expect(css).toMatch(/\.v2 \.d-panel \{[^}]*width:480px/);
  });

  it('still lets the keyboard reach the whole page', () => {
    expect(source('Leads.tsx')).toContain("if (e.key === 'Enter' && e.target === e.currentTarget) navigate(to)");
  });
});

/* ── 4. the project filter ────────────────────────────────────────────── */

describe('the project filter', () => {
  /*
   * It was filled from `/api/projects` — the project library, which has no
   * unique key on `name` — and then matched exactly against the free text on
   * the lead. So it listed "Sei Saadiyat" twice and could return nothing.
   */
  it('is filled from the projects the leads are on, not from the library', () => {
    const text = source('Leads.tsx');
    expect(text).toContain("api.get('/api/my-leads/projects')");
    expect(text).not.toContain('/api/projects?includeUnverified=1');
  });

  it('shows how many leads are behind each option', () => {
    expect(source('Leads.tsx')).toContain('{one.name} · {one.leads}');
  });
});

/* ── 8. the money on a Won deal ───────────────────────────────────────── */

describe('the Won form', () => {
  it('asks for the price, what was paid and what was signed', () => {
    const text = source('LeadAction.tsx');
    expect(text).toContain('Price, AED');
    expect(text).toContain('Paid now, AED');
    expect(text).toContain('What was signed');
    expect(text).toContain('Booking form or receipt');
    /* The design's own sentence, which is the reason the file is required. */
    expect(text).toContain('Without it the deal is not counted.');
  });

  it('offers the three things a buyer actually signs', () => {
    expect(SIGNED.map((one) => one.key)).toEqual(['booking_form', 'reservation_agreement', 'spa']);
    expect(SIGNED.map((one) => one.label))
      .toEqual(['Booking form', 'Reservation agreement', 'SPA']);
  });

  it('refuses more paid than the price, and sends neither until both read', () => {
    const text = source('LeadAction.tsx');
    expect(text).toContain('Paid now cannot be more than the price.');
    expect(text).toContain('priceAed !== null && paidAed > priceAed');
    expect(text, 'and the paperwork goes up before the deal is recorded')
      .toContain('if (proof) await attachProof(opportunityId, proof);');
  });

  /* Every figure comes out of what was typed. A box with a word in it is not
     a price, and `readAmount` says so by answering null rather than NaN. */
  it('reads a price only out of digits', () => {
    expect(readAmount('2,000,000')).toBe(2_000_000);
    expect(readAmount('2000000')).toBe(2_000_000);
    expect(readAmount(' 200 000 ')).toBe(200_000);
    expect(readAmount('')).toBeNull();
    expect(readAmount('2M')).toBeNull();
    expect(readAmount('about two million')).toBeNull();
    expect(readAmount('0')).toBeNull();
    expect(readAmount('-5')).toBeNull();
  });
});

/* ── 9. the reasons a lead is lost ────────────────────────────────────── */

describe('the Lost form', () => {
  /*
   * "Not into off-plan" and "Is a broker, not a buyer" could not be recorded
   * at all: they were in the design's chip row and in neither the screen's
   * list nor the server's. Both are answers an owner can act on — one is a
   * project problem, the other a lead-source problem.
   */
  it('offers the design’s six, in the design’s words', () => {
    expect(LOST_REASONS.map((one) => one.label)).toEqual([
      'Bought elsewhere',
      'Budget too low',
      'Just browsing',
      'Not into off-plan',
      'Is a broker, not a buyer',
      'Other',
    ]);
  });

  it('sends the keys the server stores', () => {
    expect(LOST_REASONS.map((one) => one.key)).toEqual([
      'bought_elsewhere', 'budget_too_low', 'just_browsing', 'not_into_offplan', 'is_broker', 'other',
    ]);
  });

  it('asks for a note under “Other”, in the design’s words', () => {
    const text = source('LeadAction.tsx');
    expect(text).toContain('· needed for “Other”');
    expect(text).toContain('With “Other”, write at least 5 letters.');
  });
});

/* ── 5. the transfer form's agent cards ───────────────────────────────── */

describe('the transfer form', () => {
  it('reads the languages people speak, not the CRM’s own', () => {
    const text = source('TransferLead.tsx');
    expect(text).toContain('languages: string[]');
    expect(text, 'one string called `language` was `users.locale`')
      .not.toContain('language: string | null;');
  });

  it('puts the status, the deals and the reply time on every card', () => {
    const text = source('TransferLead.tsx');
    expect(text).toContain('deals this month');
    expect(text).toContain('replies in');
    expect(text).toContain('d-chip d-att-office');
    expect(text).toContain('Late · ');
    expect(text).toContain('Outside until');
  });

  it('marks the first one who can take it now as the best match', () => {
    const text = source('TransferLead.tsx');
    expect(text).toContain('Best match');
    expect(text, 'the build said "Fewest leads" on whichever row came first')
      .not.toContain('>Fewest leads<');
  });

  it('links to the person’s profile, and says when they are over their desk’s maximum', () => {
    const text = source('TransferLead.tsx');
    expect(text).toContain('Profile');
    expect(text).toContain('above the desk maximum of');
  });

  it('says so plainly when nobody speaks the chosen language', () => {
    expect(source('TransferLead.tsx')).toContain('No agent speaks ${language}');
  });
});

/* ── 6 and 7. the lead page ───────────────────────────────────────────── */

describe('the lead page', () => {
  it('draws all seven of "What the client wants", and lets each be edited', () => {
    const text = source('Lead.tsx');
    for (const label of ['Project', 'Unit', 'Budget', 'Purpose', 'Timeline', 'Payment', 'Language']) {
      expect(text, `${label} is one of the design's seven lines`)
        .toContain(`label="${label}"`);
    }
    expect(text).toContain('click a line to edit');
    expect(text).toContain('/wants`');
    /* The three with a fixed vocabulary are a menu, because the column is an
       ENUM and MySQL refuses a word outside it rather than approximating. */
    expect(text).toContain("api.get('/api/my-leads/wants/choices')");
  });

  it('has an "In short" card, and only credits the AI when the AI wrote it', () => {
    const text = source('Lead.tsx');
    expect(text).toContain('d-card d-short');
    expect(text).toContain('In short');
    expect(text).toContain('{lines.length > 0 && (');
    expect(text).toContain('Homes AI');
  });

  it('shows the second WhatsApp number, Telegram, nationality and the history', () => {
    const text = source('Lead.tsx');
    expect(text).toContain('label="WhatsApp 2"');
    expect(text).toContain('label="Telegram"');
    expect(text).toContain('label="Nationality"');
    expect(text).toContain('Change history');
    expect(text).toContain('/history`');
  });

  it('has a Files tab with files, folders and the design’s privacy wording', () => {
    const text = source('Lead.tsx');
    expect(text).toContain('d-folders');
    expect(text).toContain('All files');
    expect(text).toContain('Passport & ID');
    expect(text).toContain('Booking forms');
    expect(text).toContain('WhatsApp screenshots');
    expect(text).toContain('ID or passport');
    expect(text).toContain('IDs and passports: only you and owners see them.');
    expect(text).toContain('Every view is logged.');
    expect(text, 'the tab used to hold this explanation instead of files')
      .not.toContain('Files live on a note');
  });
});
