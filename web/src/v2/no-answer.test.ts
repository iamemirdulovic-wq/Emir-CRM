import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MENU_RESULTS, RESULT_LABEL, dubaiMoment, lastTryText, nextStepWithTries, nextTryText,
  savedLine, todayInDubai, tomorrowInDubai, triesOf, tryIsDue, whenAgain,
} from './no-answer.js';

/**
 * "No answer": the wording, the clock, and the wiring on the leads list.
 *
 * Emir's 14 November list, sections B and C, against
 * `docs/v2/call-results-contract.md`. Two halves, for the two ways this can
 * be wrong:
 *
 *  1. **The arithmetic and the words.** A time written in the browser's own
 *     zone instead of Dubai's, or "no_answer" reaching a screen, or a count
 *     invented where the server sent none.
 *  2. **The wiring.** There is no DOM testing library in this app, so the
 *     markup is held by reading the source — the same trick
 *     `leads-screens.test.ts` and `leads-dates.test.ts` use, and for the same
 *     reason: a column added inside the phone branch can never be reached on
 *     a computer, and a green suite says nothing about it. The screens
 *     themselves were driven in a real browser; the shots are in the report.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const read = (file: string) => readFileSync(path.join(HERE, file), 'utf8');
const LEADS = read('Leads.tsx');
const MODULE = read('no-answer.tsx');
const CSS = readFileSync(path.join(HERE, '..', 'styles', 'v2-no-answer.css'), 'utf8');

/** A lead row with a no-answer run on it. */
const row = (over: Record<string, unknown> = {}) => ({ id: 'o-1', ...over });

afterEach(() => { vi.useRealTimers(); });

/* ── 1. the count comes from the server, never from here ───────────────── */

describe('how many tries a lead has had', () => {
  it('reads the contract’s own block first', () => {
    expect(triesOf(row({ noAnswer: { tries: 3, lastTryAt: null, nextTryAt: null } }))).toBe(3);
  });

  it('falls back to the column the list endpoint has always sent', () => {
    /* `opportunities.no_answer_count`, which `/api/my-leads` selects and
       `runLeadAction` writes. A real number, not a guess — which is the
       whole point of having a fallback at all. */
    expect(triesOf(row({ no_answer_count: 2 }))).toBe(2);
    /* And the block wins when both are there. */
    expect(triesOf(row({
      no_answer_count: 2, noAnswer: { tries: 4, lastTryAt: null, nextTryAt: null },
    }))).toBe(4);
  });

  it('is zero, not a guess, when the server said nothing', () => {
    expect(triesOf(row())).toBe(0);
    expect(triesOf(row({ noAnswer: null }))).toBe(0);
  });
});

/* ── 2. Dubai time, 24 hours, in words ─────────────────────────────────── */

describe('when to try again, in plain English', () => {
  /* 14 Nov 2026, 08:00 Dubai. The clock below is deliberately set from a UTC
     instant so the test says the same thing on a machine in any zone — which
     is the bug it exists to catch. */
  const now = new Date('2026-11-14T04:00:00.000Z');

  it('names today, tomorrow and yesterday rather than printing a date', () => {
    expect(whenAgain('2026-11-14T07:00:00.000Z', now)).toBe('today 11:00');
    expect(whenAgain('2026-11-15T07:00:00.000Z', now)).toBe('tomorrow 11:00');
    expect(whenAgain('2026-11-13T07:00:00.000Z', now)).toBe('yesterday 11:00');
  });

  it('carries the date once it is further out', () => {
    expect(whenAgain('2026-11-17T07:00:00.000Z', now)).toBe('17 Nov 11:00');
  });

  it('is Dubai’s clock, not the machine’s', () => {
    /* 23:30 UTC on the 14th is 03:30 Dubai on the 15th: tomorrow, early. */
    expect(whenAgain('2026-11-14T23:30:00.000Z', now)).toBe('tomorrow 03:30');
  });

  it('never prints a 12-hour clock', () => {
    const said = [
      whenAgain('2026-11-14T15:00:00.000Z', now),
      nextTryText('2026-11-14T15:00:00.000Z', now),
      lastTryText('2026-11-14T15:00:00.000Z'),
    ].join(' ');
    expect(said).not.toMatch(/\b(AM|PM|am|pm)\b/);
    expect(whenAgain('2026-11-14T15:00:00.000Z', now)).toBe('today 19:00');
  });

  it('never prints an ISO timestamp or a raw code', () => {
    const said = nextStepWithTries(
      row({ noAnswer: { tries: 2, lastTryAt: null, nextTryAt: '2026-11-15T07:00:00.000Z' } }),
      'No next step',
      { now },
    ).full;
    expect(said).toBe('No answer ×2 · try again tomorrow 11:00');
    expect(said).not.toContain('T07:00');
    expect(said).not.toContain('no_answer');
  });

  it('says so in words when there is nothing planned', () => {
    expect(nextTryText(null)).toBe('Nothing planned');
    expect(lastTryText(null)).toBe('Not recorded');
    /* Not a dash: §2.4's seventh point, which is why "No phone" is words. */
    expect(nextTryText(null)).not.toBe('–');
  });

  it('knows when a try is due', () => {
    expect(tryIsDue('2026-11-14T03:00:00.000Z', now)).toBe(true);
    expect(tryIsDue('2026-11-14T05:00:00.000Z', now)).toBe(false);
    expect(tryIsDue(null, now)).toBe(false);
  });
});

/* ── 3. the pill, and the multiplication sign ──────────────────────────── */

describe('the tag on a lead', () => {
  it('writes "No answer ×2" with the multiplication sign, not the letter x', () => {
    const said = nextStepWithTries(row({ no_answer_count: 2 }), 'No next step').text;
    expect(said.startsWith('No answer ×2')).toBe(true);
    expect(said).not.toContain('x2');
  });

  it('leaves a lead that has never been tried exactly as it was', () => {
    const said = nextStepWithTries(row(), 'Due 15 Nov, 11:00');
    expect(said.text).toBe('Due 15 Nov, 11:00');
    expect(said.tries).toBe(0);
  });

  it('keeps the lead’s real next step when the server sent no next try', () => {
    /* Never a made-up time: the row's own promise is shown instead. */
    const said = nextStepWithTries(
      row({ noAnswer: { tries: 1, lastTryAt: null, nextTryAt: null } }),
      'Due 15 Nov, 11:00',
    );
    expect(said.full).toBe('No answer ×1 · Due 15 Nov, 11:00');
  });

  it('drops "try again" only where the column cannot hold it', () => {
    const lead = row({ noAnswer: { tries: 2, lastTryAt: null, nextTryAt: '2026-11-15T07:00:00.000Z' } });
    const now = new Date('2026-11-14T04:00:00.000Z');
    expect(nextStepWithTries(lead, 'x', { now }).text).toContain('try again');
    const short = nextStepWithTries(lead, 'x', { now, short: true });
    expect(short.text).toBe('No answer ×2 · tomorrow 11:00');
    /* And the hover always carries the whole sentence. */
    expect(short.full).toBe('No answer ×2 · try again tomorrow 11:00');
  });
});

/* ── 4. the toast ──────────────────────────────────────────────────────── */

describe('what the toast says', () => {
  const now = new Date('2026-11-14T04:00:00.000Z');

  it('is the owner’s own line, word for word', () => {
    expect(savedLine('no_answer', {
      tries: 2, maxTries: 5, lastTryAt: null, nextTryAt: '2026-11-15T07:00:00.000Z',
      exhausted: false, whatsapp: null,
    }, now)).toBe('Saved · No answer · try 2 of 5 · next try tomorrow 11:00');
  });

  it('drops a half it was not given rather than inventing one', () => {
    expect(savedLine('wrong_number', {
      tries: 0, maxTries: 5, lastTryAt: null, nextTryAt: null, exhausted: false, whatsapp: null,
    }, now)).toBe('Saved · Wrong number');
  });

  it('never shows the code the server takes', () => {
    for (const result of ['no_answer', 'call_back', 'wrong_number', 'not_interested'] as const) {
      expect(savedLine(result, null, now)).not.toContain('_');
    }
  });
});

/* ── 5. the call-back time the agent types ─────────────────────────────── */

describe('a call back at a time the agent chose', () => {
  it('reads it as Dubai, with the fixed +04:00 offset', () => {
    expect(dubaiMoment('2026-11-15', '11:00')).toBe('2026-11-15T07:00:00.000Z');
  });

  it('refuses half a time rather than saving a wrong one', () => {
    expect(dubaiMoment('', '11:00')).toBeNull();
    expect(dubaiMoment('2026-11-15', '')).toBeNull();
  });

  it('offers tomorrow, in Dubai’s day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T21:00:00.000Z')); /* 01:00 Dubai on the 15th */
    expect(todayInDubai()).toBe('2026-11-15');
    expect(tomorrowInDubai()).toBe('2026-11-16');
  });
});

/* ── 6. the wiring on the screen ───────────────────────────────────────── */

describe('the tab', () => {
  it('sits between "No next step" and VIP on both lists — B.1', () => {
    const order = (block: string) => [...block.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
    const agent = LEADS.slice(LEADS.indexOf('export const AGENT_TABS'), LEADS.indexOf('export const OWNER_TABS'));
    const owner = LEADS.slice(LEADS.indexOf('export const OWNER_TABS'), LEADS.indexOf('export type TabKey'));
    for (const tabs of [order(agent), order(owner)]) {
      const at = tabs.indexOf('no_answer');
      expect(at).toBeGreaterThan(-1);
      expect(tabs[at - 1]).toBe('no_next_step');
      expect(tabs[at + 1]).toBe('vip');
    }
  });

  it('sorts by the next try, soonest first, and sinks the ones with none — B.3', () => {
    expect(LEADS).toContain('function bySoonestTry');
    expect(LEADS).toContain('onNoAnswerTab ? [...rows].sort(bySoonestTry) : rows');
  });

  it('draws the owner’s columns and no day bands — B.3, B.6', () => {
    expect(LEADS).toContain('<th title="How many times this lead has been tried">Tries</th>');
    expect(LEADS).toContain('<th title="When the last try was">Last try</th>');
    expect(LEADS).toContain('<th title="When to try again">Next try</th>');
    expect(LEADS).toContain('inTryOrder.map((row) => drawRow(row))');
  });

  it('shows nothing rather than the wrong leads before the server has the tab', () => {
    /* `/api/my-leads` falls back to Today for a tab it does not know and
       says so in `tab`; without this the No answer tab would have drawn
       today's follow-ups under it. */
    expect(LEADS).toContain("leads.data.tab === 'no_answer'");
    expect(LEADS).toContain('{!tabIsLive && <TabNotReady />}');
  });

  it('keeps the whole thing off the ordinary tabs’ column budget', () => {
    /* The two modifiers are written with one class more than the shell's own
       rules, so they win whatever the file order — see the head of the
       stylesheet. */
    expect(CSS).toContain('.v2 .d-id-leads.v2-cols-mine.v2-na-cols th:nth-child(1){ width:230px; }');
    expect(CSS).toContain('.v2 .d-id-leads.v2-cols-book.v2-na-cols th:nth-child(1){ width:230px; }');
    /* The Lead column is 230px in both tables at every width: a cut name is
       the complaint that started this work. */
    expect(CSS).not.toMatch(/v2-na-cols th:nth-child\(1\)\{ width:(?!230px)/);
  });
});

describe('the row’s "No answer" button', () => {
  it('is on the agent’s row on every tab, and on the No answer tab for both', () => {
    expect(LEADS).toContain("const dialable = phone !== '' && (!book || triesColumns === true);");
  });

  it('cannot save a result before the agent has tried — C.5', () => {
    /* The same rule the dialler enforces with `touched`, not a second one. */
    expect(MODULE).toContain('tried ? onSave : onLocked');
    expect(LEADS).toContain('const tried = useTried();');
    expect(LEADS).toContain('if (id !== null) tried.mark(lead.id);');
    expect(MODULE).toContain("const label = tried ? RESULT_LABEL.no_answer : 'Call first';");
  });

  it('marks the tap from the quick panel too, since that is a call as well', () => {
    expect(LEADS).toContain('dial={rowDial}');
  });

  it('puts the other four results in the row menu — C.3', () => {
    expect(MENU_RESULTS.map((one) => one.result))
      .toEqual(['busy', 'call_back', 'wrong_number', 'not_interested']);
    for (const one of MENU_RESULTS) {
      expect(RESULT_LABEL[one.result]).not.toContain('_');
    }
    expect(LEADS).toContain('{RESULT_LABEL[one.result]}');
  });

  it('asks twice before marking a selection, and offers Undo — C.4', () => {
    expect(LEADS).toContain('async function markManyNoAnswer()');
    expect(LEADS).toContain('if (!markArmed) { setMarkArmed(true); return; }');
    expect(LEADS).toContain("label: 'Undo', onClick: () => void takeBack(done, 'no_answer')");
  });

  it('undoes through the contract’s own endpoint, not by saving another result', () => {
    expect(MODULE).toContain("return api.del<NoAnswerState>(PATH(opportunityId));");
    expect(MODULE).toContain('Too late to undo that');
  });
});

describe('the 3+ tries filter — H.2 and B.6', () => {
  it('is a control on the No answer tab and on the owner’s book', () => {
    expect(LEADS).toContain('{(onNoAnswerTab || book) && (');
    expect(LEADS).toContain('<option value="3">No answer 3+ times</option>');
  });

  it('says how many rows it looked at, rather than borrowing the server’s total', () => {
    /* It narrows the rows in hand — `/api/my-leads` takes no minimum-tries
       parameter — so the count line has to be honest about that. */
    expect(LEADS).toContain('loaded tried 3+ times');
  });
});
