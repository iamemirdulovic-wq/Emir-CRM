import { describe, expect, it } from 'vitest';
import { decideSla } from './assignments.js';

/**
 * Whether to take a lead off the agent holding it.
 *
 * The cost of getting this wrong is asymmetric and silent. Bounce too eagerly
 * and a lead is pulled off an agent who is on the phone to that client right
 * now. Bounce too late and it goes cold while looking handled. Neither shows
 * up as an error — the lead just quietly does worse — so every case is
 * written down here rather than discovered months later in the numbers.
 */
describe('deciding whether a lead has gone unworked', () => {
  const fresh = {
    phase: 'accept' as const,
    open: true,
    ownedByTimerAgent: true,
    acceptedAt: null,
    acted: false,
    firstTouchAt: null,
  };

  it('bounces a lead nobody accepted', () => {
    expect(decideSla(fresh)).toEqual({ act: 'bounce', why: 'not_accepted' });
  });

  it('bounces a lead that was accepted and then left alone', () => {
    expect(decideSla({ ...fresh, phase: 'action', acceptedAt: new Date() }))
      .toEqual({ act: 'bounce', why: 'no_action' });
  });

  /*
   * The two clocks must not fight. Accepting at minute one leaves the agent
   * the full window to act; the accept clock firing at minute five has to
   * stand down, or it bounces someone who is inside their time.
   */
  it('stands down on the accept clock once the lead is accepted', () => {
    expect(decideSla({ ...fresh, acceptedAt: new Date() }))
      .toEqual({ act: 'ignore', why: 'accepted_elsewhere' });
  });

  it('still judges the action clock after accepting', () => {
    const accepted = { ...fresh, phase: 'action' as const, acceptedAt: new Date() };
    expect(decideSla(accepted).act).toBe('bounce');
    expect(decideSla({ ...accepted, acted: true }).act).toBe('record');
  });

  /*
   * The button is bookkeeping; the phone call is the job. An agent who rang
   * the client without pressing Accept has not failed an SLA.
   */
  it('counts the work even when nobody pressed Accept', () => {
    expect(decideSla({ ...fresh, acted: true })).toEqual({ act: 'record', why: 'acted' });
  });

  it('counts the lead having moved past New as work', () => {
    expect(decideSla({ ...fresh, firstTouchAt: new Date() })).toEqual({ act: 'record', why: 'acted' });
  });

  /* Someone reassigned it by hand while the timer was running. */
  it('leaves a lead alone once it belongs to someone else', () => {
    expect(decideSla({ ...fresh, ownedByTimerAgent: false }))
      .toEqual({ act: 'ignore', why: 'owner_changed' });
  });

  it('never bounces a lead that is already won or lost', () => {
    for (const phase of ['accept', 'action'] as const) {
      expect(decideSla({ ...fresh, phase, open: false }).act).toBe('ignore');
    }
  });

  /*
   * Order matters: a closed or reassigned lead is nobody's failure, whatever
   * else is true of it. These would each bounce on the rules below them.
   */
  it('checks closed and reassigned before anything else', () => {
    expect(decideSla({ ...fresh, open: false, ownedByTimerAgent: false }).why).toBe('closed');
    expect(decideSla({ ...fresh, ownedByTimerAgent: false, acted: false }).why).toBe('owner_changed');
  });

  /* Every combination resolves to exactly one of the three actions. */
  it('always reaches a decision', () => {
    const bools = [true, false];
    for (const phase of ['accept', 'action'] as const) {
      for (const open of bools) {
        for (const ownedByTimerAgent of bools) {
          for (const acted of bools) {
            for (const acceptedAt of [null, new Date()]) {
              for (const firstTouchAt of [null, new Date()]) {
                const verdict = decideSla({ phase, open, ownedByTimerAgent, acted, acceptedAt, firstTouchAt });
                expect(['ignore', 'record', 'bounce']).toContain(verdict.act);
              }
            }
          }
        }
      }
    }
  });
});
