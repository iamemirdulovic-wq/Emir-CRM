import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALL_RESULTS, RESULT_LABEL, plain, resultsFromActivities,
} from './call-result.js';
import {
  NOTE_TYPES, TYPE_LABEL, TYPE_TONE, QUICK_PHRASES, looksLikePlaceholder, placeholderFor,
} from './note-text.js';
import { dayAndClock, saidAbout, stamp } from './CallResultBar.js';
import { reminderFor } from './LeadNotes.js';

/**
 * The call-result bar, the note box and the saved notes — §D, §E and §F of
 * the owner's list of 14 November, and `docs/v2/note-box-design.md`, which is
 * the reading of his picture.
 *
 * Most of it is a screen and is checked in a real browser; what is here is
 * the part that can go quietly wrong — the words, the times, and the three
 * rules the owner has repeated: no emoji, no raw codes, and never a number
 * the record does not hold.
 *
 * The source checks read the files the way `hook-order.test.ts` does: a thing
 * built once and used in three places is invisible to a unit test and obvious
 * in the file, and the whole point of these three components is that there is
 * one of each.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const code = (file: string) => readFileSync(path.join(HERE, file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/* ── §D · the six results ─────────────────────────────────────────────── */

describe('the call results', () => {
  it('are the six the contract names, in its own order', () => {
    expect([...CALL_RESULTS]).toEqual([
      'answered', 'no_answer', 'busy', 'call_back', 'wrong_number', 'not_interested',
    ]);
  });

  it('are shown as words, never as the stored key', () => {
    for (const key of CALL_RESULTS) {
      expect(RESULT_LABEL[key], `${key} needs words`).toMatch(/^[A-Z][a-z]/);
      expect(RESULT_LABEL[key]).not.toContain('_');
    }
    expect(RESULT_LABEL.no_answer).toBe('No answer');
    expect(RESULT_LABEL.wrong_number).toBe('Wrong number');
  });

  it('go to the one endpoint the contract names', () => {
    expect(code('CallResultBar.tsx')).toContain('/api/v2/leads/${opportunityId}/call-result');
  });

  it('ask for a time before Call back is saved — D.4', () => {
    const bar = code('CallResultBar.tsx');
    expect(bar).toContain("if (result === 'call_back')");
    expect(bar).toContain("setPicking('call_back')");
  });

  it('never send the "I tried to call you" message itself — the agent presses send', () => {
    const bar = code('CallResultBar.tsx');
    expect(bar).toContain('dial.whatsapp(lead, { text: message })');
    expect(bar, 'nothing here posts a message to a client').not.toMatch(/api\/v2\/messages|\/send/);
  });
});

describe('what the toast says after a result', () => {
  it('names the result, the try and the next try, from the answer', () => {
    expect(saidAbout('no_answer', {
      tries: 2, maxTries: 5, lastTryAt: null, exhausted: false, whatsapp: null,
      nextTryAt: '2026-11-15T07:00:00.000Z',
    })).toMatch(/^Saved · No answer · try 2 of 5 · next try /);
  });

  it('leaves out a count the record does not hold, rather than inventing one', () => {
    /* A lead row carries the count without the limit, so "of 5" is left off
       rather than guessed at. Never invent a number. */
    expect(saidAbout('no_answer', {
      tries: 2, maxTries: undefined as unknown as number,
      lastTryAt: null, nextTryAt: null, exhausted: false, whatsapp: null,
    })).toBe('Saved · No answer · try 2');
    expect(saidAbout('answered', null)).toBe('Saved · Answered');
  });
});

/* ── Dubai, 24 hour, everywhere ───────────────────────────────────────── */

describe('the times on these screens', () => {
  beforeEach(() => {
    /* 14 Nov 2026, 18:00 in Dubai. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T14:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('stamp a saved row with the real date and the real time — F.1', () => {
    expect(stamp('2026-11-14T12:41:00.000Z')).toBe('14 Nov 16:41');
    expect(stamp('2026-11-09T06:05:00.000Z')).toBe('9 Nov 10:05');
  });

  it('are Dubai’s, not the reader’s own', () => {
    /* 22:30 UTC on the 14th is 02:30 on the 15th in Dubai. A screen that read
       the browser's clock would print the wrong day and the wrong hour on
       every laptop outside the UAE, which this page did until 14 Nov. */
    expect(stamp('2026-11-14T22:30:00.000Z')).toBe('15 Nov 02:30');
  });

  it('say today, tomorrow and yesterday where a person would', () => {
    expect(dayAndClock('2026-11-14T15:00:00.000Z')).toBe('today 19:00');
    expect(dayAndClock('2026-11-15T07:00:00.000Z')).toBe('tomorrow 11:00');
    expect(dayAndClock('2026-11-13T07:00:00.000Z')).toBe('yesterday 11:00');
    expect(dayAndClock('2026-11-20T07:00:00.000Z')).toBe('20 Nov 11:00');
  });

  it('never print a 12-hour clock', () => {
    for (const value of ['2026-11-14T09:00:00.000Z', '2026-11-14T20:00:00.000Z']) {
      expect(stamp(value)).not.toMatch(/am|pm/i);
    }
  });
});

/* ── §F.3 · a call result read back out of the lead’s own history ─────── */

describe('the call results already on a lead', () => {
  const activities = [
    { id: 'a1', type: 'no_answer', meta: { action: 'no_answer' }, user_name: 'Rocky', created_at: '2026-11-14T05:12:00.000Z' },
    { id: 'a2', type: 'callback_set', meta: { action: 'call_back' }, user_name: 'Rocky', created_at: '2026-11-13T09:00:00.000Z' },
    { id: 'a3', type: 'note', meta: null, user_name: 'Rocky', created_at: '2026-11-13T08:00:00.000Z' },
    { id: 'a4', type: 'lost', meta: { action: 'lost', reason: 'budget' }, user_name: 'Emir', created_at: '2026-11-12T08:00:00.000Z' },
  ];

  it('takes only the two actions that can mean nothing else', () => {
    /* `problem` and `lost` are also what the Wrong number and Lost *dialogs*
       write, and a Lost recorded from the Lost dialog is not a call result. */
    expect(resultsFromActivities(activities).map((one) => one.result))
      .toEqual(['no_answer', 'call_back']);
  });

  it('carries who and when, and no try number it cannot know', () => {
    const [first] = resultsFromActivities(activities);
    expect(first?.who).toBe('Rocky');
    expect(first?.at).toBe('2026-11-14T05:12:00.000Z');
    expect(first?.tries, 'nothing stores which attempt a past one was').toBeNull();
    expect(first?.maxTries).toBeNull();
  });
});

/* ── §E.1 · no emoji, anywhere ────────────────────────────────────────── */

describe('no emoji', () => {
  it('is stripped out of what the server sends', () => {
    /* `SAID` in `server/src/leads/actions.ts` answers these, word for word. */
    expect(plain('Moved to Interested 🔥')).toBe('Moved to Interested');
    expect(plain('Deal won! 🏆')).toBe('Deal won!');
    expect(plain('Meeting booked 📅')).toBe('Meeting booked');
  });

  it('is stripped out of the notes already in the database', () => {
    /* The old note box wrote these two bodies itself. */
    expect(plain('🎤 Voice note')).toBe('Voice note');
    expect(plain('📎 Attachment')).toBe('Attachment');
  });

  it('leaves everything that is not a picture exactly as it was typed', () => {
    expect(plain('عميل يريد شقة بغرفتين')).toBe('عميل يريد شقة بغرفتين');
    expect(plain('Budget AED 1.9M — not 2.5M · “he was clear”'))
      .toBe('Budget AED 1.9M — not 2.5M · “he was clear”');
  });

  it('is in none of the three components’ own words', () => {
    const pictograph = /\p{Extended_Pictographic}/u;
    for (const file of ['CallResultBar.tsx', 'LeadNoteBox.tsx', 'LeadNotes.tsx', 'note-text.ts']) {
      expect(pictograph.test(code(file)), `${file} carries an emoji`).toBe(false);
    }
  });
});

/* ── §E.2 · the six kinds of note ─────────────────────────────────────── */

describe('the note types', () => {
  it('are the six values the column really holds', () => {
    /* `lead_notes.type` is an ENUM; MySQL refuses a word that is not in the
       list rather than storing an approximation. The note box above the tabs
       used to post `call` and `viewing`, which the server rejected outright
       every time an agent chose them. */
    expect([...NOTE_TYPES]).toEqual([
      'general', 'call_summary', 'viewing_feedback', 'budget', 'objection', 'next_step',
    ]);
  });

  it('are shown in the design’s own words', () => {
    expect(NOTE_TYPES.map((one) => TYPE_LABEL[one]))
      .toEqual(['Note', 'Call', 'Viewing', 'Budget', 'Objection', 'Next step']);
  });

  it('wear the colour the picture gives them: orange, blue, grey', () => {
    expect(TYPE_TONE.next_step).toBe('d-orange');
    expect(TYPE_TONE.call_summary).toBe('d-blue');
    expect(TYPE_TONE.general).toBe('');
  });
});

/* ── §E.3 · the quick phrases ─────────────────────────────────────────── */

describe('the quick phrases', () => {
  it('are the five from the picture, in its order', () => {
    expect([...QUICK_PHRASES]).toEqual([
      'Client wants 2 BR',
      'Send the payment plan',
      'Call after 6pm',
      'Cash buyer',
      'Needs a mortgage',
    ]);
  });
});

/* ── §F.2 · a photo is a picture, never a file name ───────────────────── */

describe('a note whose body is a stand-in', () => {
  it('spots the one the server writes for an uploaded file', () => {
    /* `POST /api/my-leads/:id/files/note` writes the folder and the file's
       own name as the note's text. That is the bug in F.2. */
    expect(looksLikePlaceholder('Photos · IMG_4821.jpg', ['IMG_4821.jpg'])).toBe(true);
    expect(looksLikePlaceholder('Passport & ID · scan.pdf', ['scan.pdf'])).toBe(true);
    expect(looksLikePlaceholder('IMG_4821.jpg', ['IMG_4821.jpg'])).toBe(true);
  });

  it('spots the two the note box used to write', () => {
    expect(looksLikePlaceholder('Voice note', [])).toBe(true);
    expect(looksLikePlaceholder('Attachment', [])).toBe(true);
    expect(placeholderFor('voice')).toBe('Voice note');
    expect(placeholderFor('image')).toBe('Photo');
  });

  it('keeps anything a person actually wrote, even one word', () => {
    expect(looksLikePlaceholder('Photo of the floor plan he liked.', ['IMG_4821.jpg'])).toBe(false);
    expect(looksLikePlaceholder('Cash.', [])).toBe(false);
    expect(looksLikePlaceholder('Photos of the roof', ['roof.jpg'])).toBe(false);
  });
});

/* ── §F.4 · the bell, and only where the record puts it ───────────────── */

describe('the reminder on a note', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-14T06:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('is drawn against the note whose words the next step is', () => {
    /* `addNote` copies the note's first 255 characters into `next_step_note`
       when it is saved with a reminder. That copy is the only link between
       the two rows, so it is what the bell is matched on. */
    expect(reminderFor(
      { body: 'Send the floor plan before five.' },
      { at: '2026-11-14T11:30:00.000Z', note: 'Send the floor plan before five.' },
    )).toBe('today 15:30');
  });

  it('is drawn against no other note', () => {
    expect(reminderFor(
      { body: 'Something else entirely.' },
      { at: '2026-11-14T11:30:00.000Z', note: 'Send the floor plan before five.' },
    )).toBeNull();
  });

  it('says nothing when the lead has no next step at all', () => {
    expect(reminderFor({ body: 'Anything' }, { at: null, note: null })).toBeNull();
    expect(reminderFor({ body: 'Anything' }, null)).toBeNull();
  });
});

/* ── One of each, used in three places ────────────────────────────────── */

describe('the bar, the box and the list are built once', () => {
  const lead = code('Lead.tsx');
  const panel = code('LeadPanel.tsx');

  it('are the same three components on the lead page and in the quick panel', () => {
    for (const [what, needle] of [
      ['the result bar', '<CallResultBar'],
      ['the note box', '<LeadNoteBox'],
      ['the notes list', '<LeadNotes'],
    ] as const) {
      expect(lead, `the lead page draws ${what}`).toContain(needle);
      expect(panel, `the quick panel draws ${what}`).toContain(needle);
    }
  });

  it('left no second note box behind on either screen', () => {
    /* Two copies drift apart inside a week; the lead page and the panel each
       had their own, and one of them posted a note type the server refuses. */
    for (const [name, text] of [['Lead.tsx', lead], ['LeadPanel.tsx', panel]] as const) {
      expect(text, `${name} still declares a note box of its own`)
        .not.toMatch(/function NoteBox\(/);
      expect(text, `${name} still declares a notes list of its own`)
        .not.toMatch(/function LastNotes\(/);
    }
  });

  it('ask the question once, in the bar, after a Call or a WhatsApp', () => {
    /* The blue "WhatsApp opened · waiting for your update" line is gone:
       §D.6 asks for the bar to be what lights up after either tap, and two
       strips asking the same question in different words is the fault. */
    expect(lead).not.toContain('WhatsappAsked');
    expect(lead).toContain("setAsking({ what: 'call', at })");
    expect(panel).toContain("setAsking({ what: 'call', at })");
  });

  it('keep their own class names out of the design’s namespace', () => {
    /* Every class these three invent is `v2-ln-`. A bare `d-` name they made
       up would style nothing, which `design-classes.test.ts` catches, and a
       bare common word would collide, which `css-collisions.test.ts` does. */
    for (const file of ['CallResultBar.tsx', 'LeadNoteBox.tsx', 'LeadNotes.tsx']) {
      /* The stylesheet's own import is a file name, not a class. */
      const text = code(file).replace(/'[^']*\.css'/g, "''");
      for (const match of text.matchAll(/\bv2-[a-z0-9-]+/g)) {
        expect(match[0].startsWith('v2-ln-'), `${file}: ${match[0]}`).toBe(true);
      }
    }
  });
});
