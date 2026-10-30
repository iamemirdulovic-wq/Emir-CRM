import { describe, expect, it } from 'vitest';
import { bandFor, detectSpamSignals, scoreLead, type ScoreSignals } from './score.js';

const signals = (over: Partial<ScoreSignals> = {}): ScoreSignals => ({
  hasValidPhone: true,
  isMobile: true,
  hasEmail: false,
  budgetMinAed: null,
  budgetMaxAed: null,
  timeline: 'unknown',
  purpose: 'unknown',
  repliedOnWhatsApp: false,
  requestedCall: false,
  requestedPricing: false,
  requestedBrochure: false,
  inquiryCount: 1,
  goldenVisaInterest: false,
  spamSignals: 0,
  invalidNumber: false,
  ...over,
});

describe('scoreLead', () => {
  it('scores a bare but valid lead low', () => {
    const result = scoreLead(signals());
    expect(result.score).toBe(15);
    expect(result.isHot).toBe(false);
  });

  it('scores an engaged, in-budget, ready buyer as hot', () => {
    const result = scoreLead(
      signals({
        hasEmail: true,
        budgetMinAed: 1_500_000,
        budgetMaxAed: 2_500_000,
        timeline: 'immediate',
        purpose: 'investment',
        repliedOnWhatsApp: true,
        requestedCall: true,
      }),
    );
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.isHot).toBe(true);
  });

  it('never exceeds 100 or drops below 0', () => {
    const max = scoreLead(
      signals({
        hasEmail: true,
        budgetMinAed: 5_000_000,
        budgetMaxAed: 9_000_000,
        timeline: 'immediate',
        purpose: 'investment',
        repliedOnWhatsApp: true,
        requestedCall: true,
        requestedPricing: true,
        requestedBrochure: true,
        inquiryCount: 5,
        goldenVisaInterest: true,
      }),
    );
    expect(max.score).toBe(100);

    const min = scoreLead(signals({ invalidNumber: true, hasValidPhone: false, spamSignals: 3 }));
    expect(min.score).toBe(0);
  });

  it('penalises an invalid number heavily', () => {
    const valid = scoreLead(signals({ timeline: 'immediate' })).score;
    const invalid = scoreLead(signals({ timeline: 'immediate', hasValidPhone: false, invalidNumber: true })).score;
    expect(invalid).toBeLessThan(valid);
  });

  it('rewards a budget inside the target band most', () => {
    const inRange = scoreLead(signals({ budgetMaxAed: 2_000_000 })).score;
    const below = scoreLead(signals({ budgetMaxAed: 300_000 })).score;
    const above = scoreLead(signals({ budgetMaxAed: 80_000_000 })).score;
    expect(inRange).toBeGreaterThan(above);
    expect(above).toBeGreaterThan(below);
  });

  it('ranks timelines in order', () => {
    const scoreFor = (timeline: ScoreSignals['timeline']) => scoreLead(signals({ timeline })).score;
    expect(scoreFor('immediate')).toBeGreaterThan(scoreFor('1_3_months'));
    expect(scoreFor('1_3_months')).toBeGreaterThan(scoreFor('3_6_months'));
    expect(scoreFor('3_6_months')).toBeGreaterThan(scoreFor('6_12_months'));
    expect(scoreFor('6_12_months')).toBeGreaterThan(scoreFor('12_plus'));
    expect(scoreFor('12_plus')).toBeGreaterThan(scoreFor('unknown'));
  });

  it('treats a WhatsApp reply and a call request as the strongest engagement signals', () => {
    const base = scoreLead(signals()).score;
    expect(scoreLead(signals({ repliedOnWhatsApp: true })).score).toBe(base + 15);
    expect(scoreLead(signals({ requestedCall: true })).score).toBe(base + 15);
    expect(scoreLead(signals({ requestedBrochure: true })).score).toBe(base + 5);
  });

  it('rewards a re-inquiry but caps the bonus', () => {
    expect(scoreLead(signals({ inquiryCount: 2 })).score - scoreLead(signals()).score).toBe(5);
    expect(scoreLead(signals({ inquiryCount: 10 })).score - scoreLead(signals()).score).toBe(10);
  });

  it('explains itself', () => {
    const result = scoreLead(signals({ timeline: 'immediate', repliedOnWhatsApp: true }));
    const names = result.components.map((c) => c.signal);
    expect(names).toContain('valid_phone');
    expect(names).toContain('timeline_immediate');
    expect(names).toContain('replied_on_whatsapp');
    expect(result.components.reduce((t, c) => t + c.points, 0)).toBe(result.score);
  });

  it('marks 70 as the hot threshold', () => {
    expect(scoreLead(signals({ budgetMaxAed: 2_000_000, timeline: 'immediate', repliedOnWhatsApp: true, requestedPricing: true })).isHot).toBe(
      true,
    );
  });
});

describe('detectSpamSignals', () => {
  it('flags obvious test submissions', () => {
    expect(detectSpamSignals({ fullName: 'test', email: null, phoneValid: true, notes: null })).toBeGreaterThan(0);
    expect(detectSpamSignals({ fullName: 'asdf', email: null, phoneValid: true, notes: null })).toBeGreaterThan(0);
  });

  it('flags disposable email domains', () => {
    expect(
      detectSpamSignals({ fullName: 'Sara', email: 'x@mailinator.com', phoneValid: true, notes: null }),
    ).toBeGreaterThan(0);
  });

  it('flags a lead with neither a valid phone nor an email', () => {
    expect(detectSpamSignals({ fullName: 'Sara', email: null, phoneValid: false, notes: null })).toBeGreaterThan(0);
  });

  it('does not flag a normal lead', () => {
    expect(detectSpamSignals({ fullName: 'Sara Al Mansoori', email: 'sara@gmail.com', phoneValid: true, notes: null })).toBe(0);
  });

  it('does not flag an Arabic name', () => {
    expect(detectSpamSignals({ fullName: 'سارة المنصوري', email: null, phoneValid: true, notes: null })).toBe(0);
  });
});

/**
 * The score in words.
 *
 * An agent picking who to call next reads the band; an agent dialling reads
 * the reason, because it decides how the call opens. Both are stored, so what
 * is shown next to a lead is what was true when it was scored.
 */
describe('explaining the score', () => {
  const base: ScoreSignals = {
    hasValidPhone: true,
    isMobile: true,
    hasEmail: true,
    budgetMinAed: null,
    budgetMaxAed: null,
    timeline: 'unknown',
    purpose: 'unknown',
    repliedOnWhatsApp: false,
    requestedCall: false,
    requestedPricing: false,
    requestedBrochure: false,
    inquiryCount: 1,
    goldenVisaInterest: false,
    spamSignals: 0,
    invalidNumber: false,
  };

  it('leads with the budget and the timeline, which is what opens a call', () => {
    const result = scoreLead({ ...base, budgetMaxAed: 2_500_000, timeline: 'immediate', requestedCall: true });
    expect(result.reason).toBe('Budget AED 2.5M · ready now · asked for a call');
  });

  it('rounds a whole million without a stray decimal', () => {
    expect(scoreLead({ ...base, budgetMaxAed: 2_000_000 }).reason).toContain('AED 2M');
    expect(scoreLead({ ...base, budgetMaxAed: 850_000 }).reason).toContain('AED 850K');
  });

  /* A missing budget is unknown, not zero. Inventing "AED 0" would be worse
     than saying nothing. */
  it('leaves out what the lead never told us', () => {
    const result = scoreLead({ ...base, timeline: 'immediate' });
    expect(result.reason).not.toContain('AED');
    expect(result.reason).toBe('ready now');
  });

  it('says plainly when there is nothing to go on', () => {
    expect(scoreLead(base).reason).toBe('Nothing to go on yet');
  });

  /* The problem is the thing an agent needs first: a beautiful budget on a
     number that does not dial is not a good lead. */
  it('puts the problem before the good news', () => {
    const result = scoreLead({
      ...base, hasValidPhone: false, invalidNumber: true, budgetMaxAed: 5_000_000, timeline: 'immediate',
    });
    expect(result.reason.startsWith('number did not validate')).toBe(true);
  });

  it('says so when there is no way to reach them at all', () => {
    const result = scoreLead({ ...base, hasValidPhone: false, hasEmail: false });
    expect(result.reason).toContain('no way to reach them');
  });

  it('names only the strongest engagement signal, not all of them', () => {
    const result = scoreLead({
      ...base, requestedCall: true, repliedOnWhatsApp: true, requestedPricing: true, requestedBrochure: true,
    });
    expect(result.reason).toContain('asked for a call');
    expect(result.reason).not.toContain('brochure');
  });

  it('mentions that they have come back before', () => {
    expect(scoreLead({ ...base, inquiryCount: 3 }).reason).toContain('enquired 3 times');
  });

  it('never overflows the column it is stored in', () => {
    const result = scoreLead({
      ...base, budgetMaxAed: 19_500_000, timeline: '1_3_months', requestedCall: true,
      inquiryCount: 9, goldenVisaInterest: true, spamSignals: 1,
    });
    expect(result.reason.length).toBeLessThanOrEqual(255);
  });
});

describe('the three bands', () => {
  it('splits hot, warm and cold where an agent would', () => {
    expect(bandFor(85)).toBe('hot');
    expect(bandFor(70)).toBe('hot');
    expect(bandFor(69)).toBe('warm');
    expect(bandFor(40)).toBe('warm');
    expect(bandFor(39)).toBe('cold');
    expect(bandFor(0)).toBe('cold');
  });

  it('agrees with isHot, so two screens never disagree about one lead', () => {
    for (const score of [0, 39, 40, 69, 70, 100]) {
      expect(bandFor(score) === 'hot').toBe(score >= 70);
    }
  });
});
