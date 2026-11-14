import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { plainly, planKind, tagWords } from './Lead.js';
import { RESULT_LABEL } from './call-result.js';

/**
 * The computer lead page against its design picture.
 *
 * Emir checked `/v2/leads/<id>` on a laptop on 14 Nov and wrote §5 of the
 * master fix list. His summary of what was wrong: *"raw import tags under the
 * name, no place to write a note, page opens on Timeline, German text from
 * Excel in the timeline, Lead # is a code."*
 *
 * The rule the whole list sits under, §0: *"Never show raw codes to people:
 * no 'en', 'walk_in', 'csv_import', file names, or database ids. Always
 * simple English words."* Most of these tests are that rule, applied to the
 * three places on this page that were breaking it.
 *
 * The wiring tests read the source, the way `leads-dates.test.ts` and
 * `hook-order.test.ts` do: a block moved into the wrong half of the page is
 * invisible to a unit test and obvious in the file.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, 'Lead.tsx'), 'utf8');
/** The file with its prose removed — a class name in a comment is not markup. */
const CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** Just the left-hand column: the card an agent reads before dialling. */
const LEFT = CODE.slice(
  CODE.indexOf('<aside className="d-lcol">'),
  CODE.indexOf('</aside>'),
);

/* ── §5.2 · only clean tags on the left card ──────────────────────────── */

describe('the tags', () => {
  it('are off the card an agent reads before dialling', () => {
    /*
     * The row printed every tag on the contact, which on an imported lead is
     * the spreadsheet's own file name, a database word and a language code.
     * The five chips the design draws — Stage, Score, Hot, VIP, Investor —
     * are each rendered from their own field and stay.
     */
    expect(LEFT.length, 'the left column should be findable').toBeGreaterThan(200);
    expect(LEFT, 'no tag loop in the left card').not.toContain('tags.map');
    expect(LEFT).toContain('d-stage-${STAGE_CHIP[lead.stage_key]');
    expect(LEFT).toContain('Score {lead.lead_score}');
    expect(LEFT).toContain('<span className="d-vip-tag">VIP</span>');
    expect(LEFT).toContain('>Hot</span>');
    expect(LEFT).toContain('>Investor</span>');
  });

  it('are still on the page, under Tags on the Info tab', () => {
    /* §0 again: "Do not remove any feature to make it simpler." */
    expect(CODE).toContain('{tags.map((one) => (');
    expect(CODE).toContain('<h4 className="d-mt-24 d-mb-8">Tags</h4>');
    expect(CODE).toContain('tagWords(one)');
  });

  it('read as words, never as the stored key', () => {
    expect(tagWords('src:csv_import')).toBe('CSV import');
    expect(tagWords('src:walk_in')).toBe('Walk-in');
    expect(tagWords('src:meta_ctwa')).toBe('WhatsApp ad');
    expect(tagWords('lang:en')).toBe('English');
    expect(tagWords('lang:ar')).toBe('Arabic');
    expect(tagWords('intent:hot')).toBe('Hot');
  });

  it('leaves a name somebody typed exactly as they typed it', () => {
    /*
     * "leads_gesamtliste_12nov" is the name of Emir's own import, not a code
     * to be translated. Underscores become spaces and the first letter goes
     * up; nothing else is touched, and nothing is invented in its place.
     */
    expect(tagWords('list:leads_gesamtliste_12nov')).toBe('Leads gesamtliste 12nov');
    expect(tagWords('proj:Emaar Beachfront')).toBe('Emaar Beachfront');
  });
});

/* ── §5.2 · "with <agent> · since <date>" ─────────────────────────────── */

describe('the agent line', () => {
  it('says how long they have had it, through the one date helper', () => {
    expect(CODE).toContain('with <b>{lead.owner_name}</b>');
    expect(CODE).toContain('given(lead.assigned_at)');
    expect(CODE, 'from the module that owns the wording')
      .toContain("from '../lib/assigned.js'");
  });

  it('says nothing rather than a borrowed date when there is none', () => {
    expect(CODE).toContain('given(lead.assigned_at).missing');
  });
});

/* ── §5.3 · the order of the middle column ────────────────────────────── */

describe('the middle column', () => {
  const at = (needle: string) => {
    const index = CODE.indexOf(needle);
    expect(index, `${needle} should be on the page`).toBeGreaterThan(-1);
    return index;
  };

  it('runs: Next step, In short, Who has had this lead, result bar, note box, tabs', () => {
    /*
     * The blue "WhatsApp opened · waiting for your update" line used to be
     * the first thing in this column. It is gone, and on purpose: §D.6 asks
     * for the call-result bar to be the one thing that asks "what happened?"
     * after a tap on Call **or** on WhatsApp, and two strips asking the same
     * question in different words is the fault, not the fix. The bar sits
     * where the design's picture puts it — directly above the note box — and
     * scrolls itself into view when it has something to ask.
     */
    const next = at('<span className="d-sec-label">Next step</span>');
    const short = at('<InShort lead={lead}');
    const hand = at('<LeadHandover leadId={lead.id} />');
    const bar = at('<CallResultBar');
    const note = at('<LeadNoteBox');
    const tabs = at('className="d-card v2-leadpage-tabs"');
    expect(next).toBeLessThan(short);
    expect(short, '§5.7: the card Emir asked to keep sits under "In short"').toBeLessThan(hand);
    expect(hand).toBeLessThan(bar);
    expect(bar, 'D.1: the result row is above the note box').toBeLessThan(note);
    expect(note).toBeLessThan(tabs);
  });

  it('opens on Notes, not on Timeline', () => {
    /* §5.3e. Timeline is the record of what the CRM did; Notes is the record
       of what the client said, and that is what a lead is opened to read. */
    expect(CODE).toMatch(/\? asked as TabKey : 'notes'/);
  });

  it('draws one note box, never two', () => {
    /*
     * One box, and it is the same component in both places — the Notes tab
     * and above the tabs — so the type chips, the quick phrases, Attach,
     * Voice, Remind me and Ctrl + Enter cannot behave differently depending
     * on which tab happens to be open. The one above the tabs stands down
     * when the tab that holds the other is open.
     */
    expect(CODE).toContain("{tab !== 'notes' && (");
    expect(CODE, 'the one shared note box, not a second copy of it')
      .toContain("from './LeadNoteBox.js'");
  });
});

/* ── §5.3a / §5.10 / §D.6 · what happened, after a tap ───────────────── */

/**
 * The question folded into the call-result bar on 14 Nov.
 *
 * It used to be a blue line of its own at the top of this column, with its
 * own "What happened?" button and its own six answers. §D asks for a row of
 * six results above the note box, always visible, and §D.6 asks for that row
 * to be what lights up after a tap on Call **or** on WhatsApp. So there is
 * one asker now, and these are its promises.
 */
const BAR = readFileSync(path.join(HERE, 'CallResultBar.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('after a Call or a WhatsApp tap', () => {
  it('asks what happened, in the bar, and names what was tapped', () => {
    /* The word is the app's own name, so a Telegram tap does not say
       "WhatsApp opened" — which is the sort of small lie that makes an agent
       stop trusting a screen. */
    expect(BAR).toContain('What happened?');
    expect(BAR).toContain('You tapped ${tapped(asking.what)} at ${formatTime(asking.at)}');
    expect(BAR).toContain("what === 'call' ? 'Call' : what === 'telegram' ? 'Telegram' : 'WhatsApp'");
  });

  it('offers the six results the endpoint takes, in words', () => {
    for (const [key, words] of [
      ['answered', 'Answered'],
      ['no_answer', 'No answer'],
      ['busy', 'Busy'],
      ['call_back', 'Call back'],
      ['wrong_number', 'Wrong number'],
      ['not_interested', 'Not interested'],
    ] as const) {
      expect(RESULT_LABEL[key], `${key} should be said in words`).toBe(words);
    }
    expect(BAR).toContain('/api/v2/leads/${opportunityId}/call-result');
  });

  it('still writes the tap’s own outcome, so no WhatsApp goes unanswered', () => {
    /* `PATCH /api/v2/taps/:id` had been waiting for an answer since the
       calling screen was built. The one question now feeds both records. */
    expect(BAR).toContain('/api/v2/taps/${asking.tapId}');
    expect(BAR).toContain('TAP_OUTCOME[result]');
  });

  it('lights the bar up from the tap the page just made', () => {
    expect(CODE).toContain("setAsking({ what: 'call', at })");
    expect(CODE).toContain("setAsking({ what: 'whatsapp', at, tapId })");
  });
});

/* ── §5.8 · the timeline in English, without the sheet's own words ────── */

describe('an imported lead’s timeline', () => {
  it('says it was imported, in English', () => {
    expect(plainly({ type: 'lead.created', title: 'New lead from csv_import', body: null }, null))
      .toEqual({ title: 'Imported from a spreadsheet', body: null });
  });

  it('names the agent on the hand-out line', () => {
    expect(plainly(
      { type: 'lead.assigned', title: 'Assigned by bulk import', body: null },
      'Test Agents',
    )).toEqual({ title: 'Given to Test Agents by import', body: null });
  });

  it('says it plainly even when nobody holds the lead', () => {
    expect(plainly({ type: 'lead.assigned', title: 'Assigned by bulk import', body: null }, null))
      .toEqual({ title: 'Given out by import', body: null });
  });

  it('leaves the spreadsheet’s own text out of the history', () => {
    /*
     * This is the exact row Emir found: the German columns out of his own
     * Excel file, printed as a line of the lead's history where it reads as
     * something the CRM did. The columns are not lost — they are on the Info
     * tab under "From the file", which is where §5.8 puts them.
     */
    const german = 'Project: ROSE HILL BY EMAAR Status: Prüfen Ländervorwahl: +91 '
      + 'Hinweis: 10-stellig ohne Vorwahl – als Indien (+91) angenommen, bitte prüfen';
    const said = plainly({ type: 'lead.created', title: 'New lead from csv_import', body: german }, null);
    expect(said.body).toBeNull();
    expect(said.title).not.toContain('Prüfen');
    expect(said.title).not.toContain('csv_import');
  });

  it('leaves every other line exactly as it was', () => {
    expect(plainly({ type: 'call.logged', title: 'Rocky called · no answer', body: 'Try again in 2 h' }, null))
      .toEqual({ title: 'Rocky called · no answer', body: 'Try again in 2 h' });
  });

  it('still starts a line with a capital when the title is only a type', () => {
    expect(plainly({ type: 'stage.changed', title: null, body: null }, null).title)
      .toBe('Stage changed');
  });

  it('puts the file’s own columns under "From the file" on Info', () => {
    expect(CODE).toContain('From the file');
    expect(CODE).toContain('detail.data.importedRow.fields.map');
    /* And no longer as a card of its own in the middle column. */
    expect(PAGE).not.toContain('<h3>From the sheet</h3>');
  });
});

/* ── §5.6 · Coming up ─────────────────────────────────────────────────── */

describe('the Coming up card', () => {
  it('says what kind of plan it is, in words', () => {
    expect(planKind('follow_up')).toBe('Follow-up');
    expect(planKind('whatsapp')).toBe('WhatsApp');
    expect(planKind('viewing')).toBe('Viewing');
    expect(planKind(null)).toBe('Task');
    expect(planKind('some_new_type')).toBe('Some new type');
  });

  it('reads its day and clock in Dubai, not the reader’s own', () => {
    /*
     * It printed a Dubai day beside a browser-local clock — "Today 11:00" on
     * a laptop in London for a task due at 15:00 in Dubai. Both now come
     * from `dubaiParts`, which is `civil()` and `formatTime()`.
     */
    expect(CODE).toContain('dubaiParts(new Date(one.due_at))');
    expect(CODE).not.toContain("toLocaleTimeString('en-GB'");
  });
});

/* ── §5.1 · the page title ────────────────────────────────────────────── */

describe('the page title', () => {
  const shell = readFileSync(path.join(HERE, 'Shell.tsx'), 'utf8');

  it('is the lead’s name, with "← All leads" above it', () => {
    expect(shell).toContain('<Link to="/v2/leads" className="v2-back"><Icon name="arrow-left" />All leads</Link>');
    expect(shell).toContain('{head.title && <h1 className="v2-title">{head.title}</h1>}');
  });

  it('comes from the slot the lead page already fills', () => {
    expect(CODE).toContain('usePhoneHead({');
    expect(CODE).toContain("title: loaded?.full_name ?? 'Lead'");
  });
});
