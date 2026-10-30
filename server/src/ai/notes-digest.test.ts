import { describe, expect, it } from 'vitest';
import {
  buildNotesDigestPrompt, digestIsStale, MAX_NOTES_IN_PROMPT, packDigest, parseNotesDigest,
  ungroundedFigures, unpackDigest, type LeadForDigest, type NoteForDigest,
} from './notes-digest.js';

const NOW = new Date('2026-03-04T08:00:00.000Z');

function note(over: Partial<NoteForDigest> = {}): NoteForDigest {
  return {
    type: 'general',
    body: 'Spoke to him, wants a sea view.',
    pinned: false,
    authorName: 'Sara',
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    ...over,
  };
}

const lead: LeadForDigest = {
  name: 'Ahmed Khan',
  stage: 'engaged_qualified',
  subStatus: 'qualified',
  project: 'Saadiyat Lagoons',
  budgetBand: '2M - 3M',
  unitType: '2 Bedroom',
};

describe('buildNotesDigestPrompt', () => {
  it('puts pinned notes first and the rest newest-first', () => {
    const { user } = buildNotesDigestPrompt(lead, [
      note({ body: 'Oldest', createdAt: new Date('2026-01-01T00:00:00Z') }),
      note({ body: 'Newest', createdAt: new Date('2026-03-03T00:00:00Z') }),
      note({ body: 'Pinned thing', pinned: true, createdAt: new Date('2026-02-01T00:00:00Z') }),
    ]);
    const order = ['Pinned thing', 'Newest', 'Oldest'].map((text) => user.indexOf(text));
    expect(order[0]).toBeLessThan(order[1] as number);
    expect(order[1]).toBeLessThan(order[2] as number);
  });

  it('marks the pinned ones so the model knows they are the standing facts', () => {
    const { user } = buildNotesDigestPrompt(lead, [note({ pinned: true })]);
    expect(user).toContain('[PINNED]');
  });

  it('forbids inventing a figure, in the prompt as well as in the code', () => {
    const { system } = buildNotesDigestPrompt(lead, [note()]);
    expect(system).toMatch(/never state a price/i);
    expect(system).toMatch(/handover/i);
  });

  it('shows the budget as the lead stated it, never as a number we worked out', () => {
    const { user } = buildNotesDigestPrompt(lead, [note()]);
    expect(user).toContain('BUDGET AS STATED: 2M - 3M');
  });

  it('says "not stated" rather than leaving a field blank', () => {
    const { user } = buildNotesDigestPrompt(
      { name: null, stage: 'new_lead', subStatus: null, project: null, budgetBand: null, unitType: null },
      [note()],
    );
    expect(user).toContain('PROJECT: not stated');
    expect(user).toContain('LEAD: unnamed');
  });

  it('caps how many notes it sends', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      note({ body: `Note number ${i}`, createdAt: new Date(2026, 0, 1 + i) }),
    );
    const { user } = buildNotesDigestPrompt(lead, many);
    expect(user.match(/^- /gm)?.length).toBe(MAX_NOTES_IN_PROMPT);
    /* The count is still honest about how many there are. */
    expect(user).toContain('NOTES (60)');
  });

  it('flattens a note written across several lines', () => {
    const { user } = buildNotesDigestPrompt(lead, [note({ body: 'line one\n\nline two' })]);
    expect(user).toContain('line one line two');
  });

  it('copes with no notes at all', () => {
    const { user } = buildNotesDigestPrompt(lead, []);
    expect(user).toContain('(none)');
  });
});

describe('ungroundedFigures', () => {
  const notes = 'Budget is AED 2.5M, wants 1,200 sqft, offered a 60/40 plan, handover 2028, 4% DLD.';

  it('accepts a figure that is in the notes', () => {
    expect(ungroundedFigures('Budget AED 2.5M, happy with 60/40.', notes)).toEqual([]);
  });

  it('matches regardless of spacing and case', () => {
    expect(ungroundedFigures('budget aed 2.5 m', notes)).toEqual([]);
  });

  it('catches a price nobody wrote down', () => {
    expect(ungroundedFigures('Budget is AED 3.8M', notes)).toEqual(['AED 3.8M']);
  });

  it('catches an invented handover year', () => {
    expect(ungroundedFigures('Handover 2031', notes)).toEqual(['2031']);
  });

  it('catches an invented percentage', () => {
    expect(ungroundedFigures('Expects 8% yield', notes)).toEqual(['8%']);
  });

  it('catches an invented payment plan', () => {
    expect(ungroundedFigures('Suggested 40/60', notes)).toEqual(['40/60']);
  });

  it('catches an invented size', () => {
    expect(ungroundedFigures('Looking at 2,000 sqft', notes)).toEqual(['2,000 sqft']);
  });

  it('leaves plain counts alone — they are not claims about the deal', () => {
    expect(ungroundedFigures('Rang 3 times, wants 2 bedrooms, 5 kids', notes)).toEqual([]);
  });

  it('accepts a year the notes mention even in a different sentence', () => {
    expect(ungroundedFigures('Wants to move in by 2028.', notes)).toEqual([]);
  });
});

describe('parseNotesDigest', () => {
  const source = 'Budget AED 2.5M. Wants a sea view. Do not mention the first project, he fell out with them.';

  it('takes three lines and the warning', () => {
    const digest = parseNotesDigest(
      {
        lines: ['Investor, wants a sea view.', 'Budget AED 2.5M, stated himself.', 'Waiting on floor plans.'],
        watchOut: 'Do not mention the first project.',
      },
      source,
    );
    expect(digest?.lines).toHaveLength(3);
    expect(digest?.watchOut).toBe('Do not mention the first project.');
    expect(digest?.dropped).toEqual([]);
  });

  it('drops a line carrying a figure nobody wrote', () => {
    const digest = parseNotesDigest(
      { lines: ['Wants a sea view.', 'Budget is AED 9M.', 'Waiting on plans.'], watchOut: null },
      source,
    );
    expect(digest?.lines).toEqual(['Wants a sea view.', 'Waiting on plans.']);
    expect(digest?.dropped).toEqual(['AED 9M']);
  });

  it('drops an invented warning rather than showing it', () => {
    const digest = parseNotesDigest(
      { lines: ['Wants a sea view.'], watchOut: 'Hold the price until 2029.' },
      source,
    );
    expect(digest?.watchOut).toBeNull();
    expect(digest?.dropped).toContain('2029');
  });

  it('keeps at most three lines', () => {
    const digest = parseNotesDigest({ lines: ['a', 'b', 'c', 'd', 'e'], watchOut: null }, source);
    expect(digest?.lines).toEqual(['a', 'b', 'c']);
  });

  it('treats "none" as no warning', () => {
    for (const value of ['none', 'None', 'N/A', 'nothing', '']) {
      const digest = parseNotesDigest({ lines: ['a'], watchOut: value }, source);
      expect(digest?.watchOut).toBeNull();
    }
  });

  it('returns null when there is nothing usable', () => {
    expect(parseNotesDigest({ lines: [], watchOut: null }, source)).toBeNull();
    expect(parseNotesDigest({ lines: ['AED 9M only'], watchOut: 'AED 9M' }, source)).toBeNull();
    expect(parseNotesDigest(null, source)).toBeNull();
    expect(parseNotesDigest('nope', source)).toBeNull();
    expect(parseNotesDigest({}, source)).toBeNull();
  });

  it('ignores non-strings in the lines array', () => {
    const digest = parseNotesDigest({ lines: ['real', 42, null, { a: 1 }], watchOut: null }, source);
    expect(digest?.lines).toEqual(['real']);
  });

  it('collapses whitespace and trims long lines', () => {
    const digest = parseNotesDigest({ lines: [`  a${'x'.repeat(400)}  `], watchOut: null }, source);
    expect(digest?.lines[0]?.length).toBe(160);
  });
});

describe('digestIsStale', () => {
  it('is not stale when there are no notes to summarise', () => {
    expect(digestIsStale({ digest: null, count: 0, at: null }, 0, NOW)).toBe(false);
  });

  it('is stale when there is no digest yet', () => {
    expect(digestIsStale({ digest: null, count: 0, at: null }, 3, NOW)).toBe(true);
  });

  it('is stale the moment somebody adds a note', () => {
    expect(digestIsStale({ digest: 'x', count: 3, at: NOW }, 4, NOW)).toBe(true);
  });

  it('is stale when a note is deleted, too', () => {
    expect(digestIsStale({ digest: 'x', count: 3, at: NOW }, 2, NOW)).toBe(true);
  });

  it('is fresh when the count matches and it is recent', () => {
    expect(digestIsStale({ digest: 'x', count: 3, at: NOW }, 3, NOW)).toBe(false);
  });

  it('goes stale with age even if nothing changed', () => {
    const old = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000);
    expect(digestIsStale({ digest: 'x', count: 3, at: old }, 3, NOW)).toBe(true);
  });

  it('treats a missing timestamp as stale even with a digest present', () => {
    expect(digestIsStale({ digest: 'x', count: 3, at: null }, 3, NOW)).toBe(true);
  });
});

describe('packDigest / unpackDigest', () => {
  it('round-trips', () => {
    const digest = { lines: ['one', 'two'], watchOut: 'careful', dropped: [] };
    expect(unpackDigest(packDigest(digest))).toEqual({ lines: ['one', 'two'], watchOut: 'careful' });
  });

  it('round-trips without a warning', () => {
    expect(unpackDigest(packDigest({ lines: ['one'], watchOut: null, dropped: [] }))).toEqual({
      lines: ['one'],
      watchOut: null,
    });
  });

  it('reads nothing as nothing', () => {
    expect(unpackDigest(null)).toEqual({ lines: [], watchOut: null });
    expect(unpackDigest('')).toEqual({ lines: [], watchOut: null });
  });

  it('fits the column', () => {
    const long = packDigest({ lines: Array.from({ length: 20 }, () => 'x'.repeat(160)), watchOut: 'y'.repeat(200), dropped: [] });
    expect(long.length).toBeLessThanOrEqual(1000);
  });
});
