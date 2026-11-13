import { describe, expect, it } from 'vitest';
import { defaultNextStep, LEAD_ACTIONS, LOST_REASONS, PROBLEM_REASONS } from './actions.js';

/**
 * What the CRM promises on the agent's behalf when they do not say.
 *
 * Only no-answer gets an automatic next step, and only because the right
 * answer is obvious and waiting for someone to type it loses it. Everything
 * else deliberately leaves the lead in "No next step", where it is visible —
 * inventing a promise nobody made is worse than admitting none exists.
 */
describe('the next step chosen automatically', () => {
  const now = new Date('2026-10-15T10:00:00Z');
  const hoursLater = (result: { at: Date } | null) =>
    result ? Math.round((result.at.getTime() - now.getTime()) / 3_600_000) : null;

  it('tries again in two hours after the first no answer', () => {
    const first = defaultNextStep('no_answer', 1, now);
    expect(first?.type).toBe('call');
    expect(hoursLater(first)).toBe(2);
  });

  /*
   * Backing off matters. Ringing the same number every two hours all day is
   * how a brokerage's number gets blocked, and how a buyer decides they
   * dislike you before you have spoken.
   */
  it('backs off as the attempts pile up', () => {
    expect(hoursLater(defaultNextStep('no_answer', 2, now))).toBe(4);
    expect(hoursLater(defaultNextStep('no_answer', 3, now))).toBe(24);
    expect(hoursLater(defaultNextStep('no_answer', 7, now))).toBe(24);
  });

  it('switches to WhatsApp once the phone has clearly not worked', () => {
    expect(defaultNextStep('no_answer', 2, now)?.type).toBe('call');
    expect(defaultNextStep('no_answer', 3, now)?.type).toBe('whatsapp');
    expect(defaultNextStep('no_answer', 3, now)?.note).toContain('WhatsApp');
  });

  /*
   * Everything else returns nothing on purpose. A lead that was called and
   * has nothing promised belongs in the No next step tab, where an agent can
   * see it and decide — not carrying a date the CRM made up.
   */
  it('invents nothing for any other action', () => {
    for (const action of LEAD_ACTIONS) {
      if (action === 'no_answer') continue;
      expect(defaultNextStep(action, 0, now), action).toBeNull();
    }
  });

  it('always lands in the future', () => {
    for (const count of [1, 2, 3, 10]) {
      expect(defaultNextStep('no_answer', count, now)!.at.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe('the reasons a lead can be closed or flagged', () => {
  /* Marking a lead Lost without a reason makes the lost-reasons report
     meaningless, which is the report that tells an owner what to fix. */
  it('offers a reason for every way a deal actually dies', () => {
    expect(LOST_REASONS).toContain('bought_elsewhere');
    expect(LOST_REASONS).toContain('budget_too_low');
    expect(LOST_REASONS).toContain('changed_plans');
    expect(LOST_REASONS).toContain('other');
  });

  /*
   * The design's six, in `design/web/lead.html`'s own order. Two of them —
   * "Not into off-plan" and "Is a broker, not a buyer" — were missing
   * entirely, so an agent whose buyer only wanted a ready flat, or who turned
   * out to be another broker, reached for "Other" and the owner lost the two
   * answers they could act on: one is a project problem, the other a
   * lead-source problem.
   */
  it('offers the six the lead page draws, in its order', () => {
    expect(LOST_REASONS.slice(0, 6)).toEqual([
      'bought_elsewhere', 'budget_too_low', 'just_browsing',
      'not_into_offplan', 'is_broker', 'other',
    ]);
  });

  /* The dialler still offers these two and leads already carry them, so
     dropping them would make an existing reason unwritable — which is the
     fault being fixed here, in reverse. */
  it('still accepts the two the dialler offers', () => {
    expect(LOST_REASONS).toContain('not_reachable');
    expect(LOST_REASONS).toContain('changed_plans');
  });

  it('separates a problem with the contact from a lost deal', () => {
    expect(PROBLEM_REASONS).toContain('wrong_number');
    expect(PROBLEM_REASONS).toContain('not_decision_maker');
    /* "Bought elsewhere" is a lost deal, not a bad phone number. */
    expect(PROBLEM_REASONS).not.toContain('bought_elsewhere');
  });

  it('has the nine buttons an agent presses', () => {
    expect([...LEAD_ACTIONS].sort()).toEqual([
      'call', 'call_back', 'interested', 'lost', 'meeting', 'no_answer', 'problem', 'whatsapp', 'won',
    ]);
  });
});
