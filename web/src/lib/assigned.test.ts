import { describe, expect, it } from 'vitest';
import {
  NOT_GIVEN, given, givenDayHeading, givenDayKey, groupByGivenDay,
} from './assigned.js';

/**
 * When a lead was given to an agent.
 *
 * Talha asked for this on 14 Nov 2026 with a screenshot of 105 new leads in
 * which every card was identical: *"you need to put dates on the leads once
 * they assign, so we know which one is today leads, which one is yesterday,
 * and which one is day before yesterday."*
 *
 * Four things are worth a test, and each is something that has gone wrong in
 * this repository before:
 *
 *   1. the day a lead lands in is its **Dubai** day, not the reader's. The
 *      test runner is pinned to Asia/Dubai by `vitest.config.ts`, so the
 *      boundary cases below are written as UTC instants that fall on the
 *      other side of Dubai midnight and the assertion is about the UTC field
 *      disagreeing — otherwise the test would pass for the wrong reason.
 *   2. "today / yesterday / N days ago" is measured the same way.
 *   3. a NULL date says so and never borrows another date.
 *   4. times are 24-hour. Emir asked for that by name on 13 Nov.
 *
 * `now` is passed in rather than faked with timers, because that is the only
 * argument the module takes and it keeps every case readable as a pair of
 * instants.
 */

/** 14 Nov 2026, 12:00 in Dubai. */
const NOON = new Date('2026-11-14T08:00:00Z');

describe('which Dubai day a lead was given out on', () => {
  it('reads the Dubai day and not the machine’s', () => {
    /* 20:30 UTC on the 13th is 00:30 on the 14th in Dubai. */
    expect(givenDayKey('2026-11-13T20:30:00Z')).toBe('2026-11-14');
    expect(new Date('2026-11-13T20:30:00Z').getUTCDate(), 'UTC still calls it the 13th').toBe(13);
  });

  it('and the other way: late Dubai evening is still that Dubai day', () => {
    /* 19:00 UTC on the 14th is 23:00 on the 14th in Dubai. */
    expect(givenDayKey('2026-11-14T19:00:00Z')).toBe('2026-11-14');
  });

  it('has no day for a lead that was never given out', () => {
    expect(givenDayKey(null)).toBeNull();
    expect(givenDayKey(undefined)).toBeNull();
    expect(givenDayKey('not a date')).toBeNull();
  });
});

describe('the heading over a group', () => {
  it('names today and yesterday in Dubai terms', () => {
    expect(givenDayHeading('2026-11-14', NOON)).toBe('Today');
    expect(givenDayHeading('2026-11-13', NOON)).toBe('Yesterday');
  });

  it('gives anything older the weekday and the date', () => {
    expect(givenDayHeading('2026-11-12', NOON)).toBe('Thursday 12 Nov');
    expect(givenDayHeading('2026-11-09', NOON)).toBe('Monday 9 Nov');
  });

  it('adds the year once it is not this one', () => {
    expect(givenDayHeading('2025-11-12', NOON)).toContain('2025');
  });

  it('says so plainly for the leads with no date', () => {
    expect(givenDayHeading(null, NOON)).toBe(NOT_GIVEN);
  });

  /*
   * The case the whole module exists for. Just after midnight in Dubai, a
   * lead given forty minutes earlier is **yesterday's** and a lead given ten
   * minutes earlier is **today's** — and a reader in London, where both are
   * still the same afternoon, must see the same two headings.
   */
  it('moves the boundary at Dubai midnight, not UTC midnight', () => {
    const justAfterMidnight = new Date('2026-11-13T20:10:00Z'); // 00:10 on the 14th
    expect(givenDayHeading(givenDayKey('2026-11-13T19:50:00Z'), justAfterMidnight))
      .toBe('Yesterday');
    expect(givenDayHeading(givenDayKey('2026-11-13T20:05:00Z'), justAfterMidnight))
      .toBe('Today');
  });
});

describe('the line on a card or a row', () => {
  it('shows the time alone for a lead given today', () => {
    const line = given('2026-11-14T07:42:00Z', NOON); // 11:42 Dubai
    expect(line.text).toBe('11:42');
    expect(line.ago).toBeNull();
    expect(line.stale, 'today is not a warning').toBe(false);
    expect(line.missing).toBe(false);
  });

  it('shows the day, the time and how long it has been sitting for yesterday', () => {
    const line = given('2026-11-13T12:30:00Z', NOON); // 16:30 Dubai yesterday
    expect(line.when).toBe('Yesterday 16:30');
    expect(line.ago).toBe('19 h ago');
    expect(line.text).toBe('Yesterday 16:30 · 19 h ago');
    expect(line.stale, 'older than today reads warm').toBe(true);
  });

  it('counts whole days once it is more than two', () => {
    const line = given('2026-11-12T06:05:00Z', NOON); // 10:05 Dubai, two days back
    expect(line.text).toBe('12 Nov 10:05 · 2 days ago');
    expect(line.stale).toBe(true);
  });

  /* Yesterday at 23:50, read at 00:10, is twenty minutes ago — not a day. */
  it('counts minutes when yesterday was twenty minutes ago', () => {
    const line = given('2026-11-13T19:50:00Z', new Date('2026-11-13T20:10:00Z'));
    expect(line.text).toBe('Yesterday 23:50 · 20 min ago');
  });

  it('is 24-hour, everywhere', () => {
    /* 16:30, 23:42 and 00:30 — never 4:30 PM, 11:42 PM or 12:30 AM. */
    expect(given('2026-11-14T12:30:00Z', NOON).when).toBe('16:30');
    expect(given('2026-11-13T19:42:00Z', NOON).when).toBe('Yesterday 23:42');
    /* 20:30 UTC on the 13th is 00:30 on the 14th in Dubai: half past
       midnight reads 00:30, never 12:30 AM and never 24:30. */
    expect(given('2026-11-13T20:30:00Z', NOON).when).toBe('00:30');
    for (const value of ['2026-11-14T12:30:00Z', '2026-11-13T19:42:00Z']) {
      expect(given(value, NOON).text).not.toMatch(/[AaPp]\.?[Mm]/);
    }
  });

  it('treats a date slightly ahead of now as today rather than the future', () => {
    /* A few seconds of clock skew between MySQL and the browser must not
       print "in 4 seconds" on an agent's list. */
    const line = given('2026-11-14T08:00:04Z', NOON);
    expect(line.stale).toBe(false);
    expect(line.ago).toBeNull();
  });
});

describe('a lead that was never given out', () => {
  /*
   * The rule from CLAUDE.md, earned here more than once: a blank beats a
   * confident wrong answer. There is no argument this function could use to
   * fall back on `created_at` — it is handed one value — and the line it
   * returns says in words that there is no date.
   */
  it('says so, and borrows nothing', () => {
    for (const value of [null, undefined, '']) {
      const line = given(value, NOON);
      expect(line.missing).toBe(true);
      expect(line.text).toBe('Not given out yet');
      expect(line.when).toBe('Not given out yet');
      expect(line.ago).toBeNull();
      expect(line.exact).toBeNull();
      /* Not warm either: it is not late, it is absent. */
      expect(line.stale).toBe(false);
    }
  });

  it('never renders a clock time for it', () => {
    expect(given(null, NOON).text).not.toMatch(/\d\d:\d\d/);
  });
});

describe('cutting the list into days', () => {
  interface Lead { id: string; assigned_at: string | null }

  const rows: Lead[] = [
    { id: 'a', assigned_at: '2026-11-14T07:42:00Z' }, // today 11:42
    { id: 'b', assigned_at: '2026-11-13T12:30:00Z' }, // yesterday 16:30
    { id: 'c', assigned_at: '2026-11-13T20:30:00Z' }, // today 00:30 Dubai
    { id: 'd', assigned_at: null },
    { id: 'e', assigned_at: '2026-11-12T06:05:00Z' }, // Thursday 12 Nov
    { id: 'f', assigned_at: '2026-11-14T05:00:00Z' }, // today 09:00
  ];

  const days = groupByGivenDay(rows, (row) => row.assigned_at, NOON);

  it('puts a lead given at 00:30 Dubai into today, not yesterday', () => {
    const today = days.find((day) => day.heading === 'Today');
    expect(today?.rows.map((row) => row.id)).toEqual(['a', 'c', 'f']);
  });

  it('heads each group and counts it', () => {
    expect(days.map((day) => `${day.heading} · ${day.count}`)).toEqual([
      'Today · 3 leads',
      'Yesterday · 1 lead',
      'Thursday 12 Nov · 1 lead',
      'Not given out yet · 1 lead',
    ]);
  });

  it('puts the newest day first and the leads with no date last', () => {
    expect(days.map((day) => day.key)).toEqual([
      '2026-11-14', '2026-11-13', '2026-11-12', null,
    ]);
  });

  it('keeps the order the server sent inside a day', () => {
    /* The tab decides the order — most overdue first, newest first — and an
       agent works down it. Grouping must not re-sort inside a day. */
    expect(days[0]?.rows.map((row) => row.id)).toEqual(['a', 'c', 'f']);
  });

  it('leaves out the empty group when every lead has a date', () => {
    const all = groupByGivenDay(rows.filter((row) => row.assigned_at), (row) => row.assigned_at, NOON);
    expect(all.some((day) => day.key === null)).toBe(false);
  });

  it('is empty for an empty list', () => {
    expect(groupByGivenDay([] as Lead[], (row) => row.assigned_at, NOON)).toEqual([]);
  });
});

/**
 * The number beside a day heading is the number of leads on that day.
 *
 * It used to be the number of rows the page happened to be holding, so on a
 * long list every band read "50 leads" — fifty being the page size. The owner
 * opened a book of 2,041 leads, saw "Thursday 12 Nov · 50 leads" over the
 * first band and said it was wrong. It was. A number on a screen has to
 * answer the question it looks like it is answering.
 */
describe('the count beside a day heading', () => {
  const at = (iso: string) => ({ assigned_at: iso });
  const pick = (r: { assigned_at: string | null }) => r.assigned_at;
  /* A Friday afternoon in Dubai. */
  const now = new Date('2026-11-14T10:00:00Z');

  it('uses the whole list, not the rows on this page', () => {
    /* Two rows in hand out of 2,041 really given out that day. */
    const rows = [at('2026-11-12T14:57:00Z'), at('2026-11-12T15:02:00Z')];
    const totals = new Map<string | null, number>([['2026-11-12', 2041]]);
    const [band] = groupByGivenDay(rows, pick, now, totals);
    expect(band?.count).toBe('2,041 leads');
    /* and it still only draws the rows it has */
    expect(band?.rows).toHaveLength(2);
  });

  it('falls back to the rows in hand when no totals are given', () => {
    const rows = [at('2026-11-12T14:57:00Z'), at('2026-11-12T15:02:00Z')];
    const [band] = groupByGivenDay(rows, pick, now);
    expect(band?.count).toBe('2 leads');
  });

  it('counts the leads nobody has been given from the whole list too', () => {
    const rows = [{ assigned_at: null }];
    const totals = new Map<string | null, number>([[null, 97]]);
    const bands = groupByGivenDay(rows, pick, now, totals);
    expect(bands[bands.length - 1]?.count).toBe('97 leads');
  });
});
