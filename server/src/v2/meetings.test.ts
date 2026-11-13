import { describe, expect, it } from 'vitest';
import { LEAD_REQUIRED, MAX_SPAN_DAYS, needsLead, pastProblem, spanDays } from './meetings.js';

/**
 * The rules behind the calendar's refusals, with no database in the way.
 *
 * These are the two the owner found by hand: a plan could be saved in the
 * past, and nothing said which field was wrong. Both are checked on the server
 * as well as in the browser, because a check that only exists in the browser
 * is a check anyone with the address can walk round.
 */

/** 11 November 2026, 14:55 Dubai — the hour every design file is written at. */
const NOW = new Date('2026-11-11T10:55:00Z');

describe('a plan cannot be put in the past', () => {
  it('refuses yesterday, and blames the day', () => {
    const problem = pastProblem(new Date('2026-11-10T06:00:00Z'), NOW);
    expect(problem).toEqual({
      field: 'day',
      message: 'This day has passed. Choose today or later.',
    });
  });

  it('refuses this morning, and blames the time rather than the day', () => {
    /* 09:00 Dubai today. The day is right; only the hour has gone. */
    const problem = pastProblem(new Date('2026-11-11T05:00:00Z'), NOW);
    expect(problem).toEqual({
      field: 'time',
      message: 'This time has passed. It is 14:55 now.',
    });
  });

  it('allows later today', () => {
    expect(pastProblem(new Date('2026-11-11T12:30:00Z'), NOW)).toBeNull();
  });

  it('allows tomorrow at any hour, including one earlier than now', () => {
    expect(pastProblem(new Date('2026-11-12T04:00:00Z'), NOW)).toBeNull();
  });

  it('is not fooled by midnight in Dubai being the day before in UTC', () => {
    /*
     * 20:30 UTC on the 11th is 00:30 Dubai on the 12th. A check written in UTC
     * would call that "today" and compare the hour, and refuse a plan for
     * half past midnight tomorrow.
     */
    expect(pastProblem(new Date('2026-11-11T20:30:00Z'), NOW)).toBeNull();
  });

  it('allows a save a few seconds behind the clock', () => {
    /* The form left the browser at 14:54:40; the server must not quibble. */
    expect(pastProblem(new Date('2026-11-11T10:54:40Z'), NOW)).toBeNull();
  });

  it('asks for a day when there is not a real one', () => {
    expect(pastProblem(new Date('not a date'), NOW)).toEqual({
      field: 'day',
      message: 'Choose a day.',
    });
  });
});

describe('a plan for a client belongs to a lead', () => {
  it('requires one for a meeting, a site visit and a call', () => {
    expect(needsLead('meeting')).toBe(true);
    expect(needsLead('site_visit')).toBe(true);
    expect(needsLead('call')).toBe(true);
    expect([...LEAD_REQUIRED]).toEqual(['meeting', 'site_visit', 'call']);
  });

  it('does not require one for a team plan', () => {
    /* "A team plan has no lead" -- design/web/calendar.html. */
    expect(needsLead('team')).toBe(false);
  });
});

describe('a plan that runs over several days', () => {
  it('counts the days it covers, ends_at being the midnight after the last', () => {
    expect(spanDays(new Date('2026-11-17T00:00:00Z'), new Date('2026-11-20T00:00:00Z'))).toBe(3);
  });

  it('counts a single day as one', () => {
    expect(spanDays(new Date('2026-11-17T06:00:00Z'), new Date('2026-11-17T07:00:00Z'))).toBe(1);
  });

  it('stops at five, which is what the design chips offer', () => {
    expect(MAX_SPAN_DAYS).toBe(5);
  });
});
