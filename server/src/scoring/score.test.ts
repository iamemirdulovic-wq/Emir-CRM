import { describe, expect, it } from 'vitest';
import { detectSpamSignals, scoreLead, type ScoreSignals } from './score.js';

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
