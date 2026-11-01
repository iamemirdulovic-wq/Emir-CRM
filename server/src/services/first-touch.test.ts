import { describe, expect, it } from 'vitest';
import { countsAsFirstTouch } from './opportunities.js';

/**
 * `first_touch_at` drives both the "Contacted" figure and speed-to-lead, and
 * it used to be set by any move off New. That made a lead closed as Lost
 * without a single call count as contacted — the funnel read 42 of 43 — and
 * let an automated step two hours after assignment fix the median at a flat
 * 7,200 seconds.
 */
describe('countsAsFirstTouch', () => {
  it('counts an agent moving a lead on, which is a real attempt', () => {
    expect(countsAsFirstTouch('attempted_contact', 'open', 'agent')).toBe(true);
    expect(countsAsFirstTouch('engaged_qualified', 'open', 'agent')).toBe(true);
    expect(countsAsFirstTouch('deal_sent', 'open', 'manager')).toBe(true);
    expect(countsAsFirstTouch('won', 'won', 'owner')).toBe(true);
  });

  it('never counts closing a lead nobody managed to reach', () => {
    expect(countsAsFirstTouch('lost', 'lost', 'agent')).toBe(false);
  });

  it('never counts the automation account', () => {
    // The follow-up worker moves cards. Counting that as a human answering is
    // what produced a median of exactly the follow-up interval.
    expect(countsAsFirstTouch('attempted_contact', 'open', 'automation')).toBe(false);
    expect(countsAsFirstTouch('engaged_qualified', 'open', 'automation')).toBe(false);
  });

  it('does not count a lead still sitting in New', () => {
    expect(countsAsFirstTouch('new_lead', 'open', 'agent')).toBe(false);
  });
});
