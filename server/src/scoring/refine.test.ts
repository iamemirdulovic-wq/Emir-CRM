import { describe, expect, it } from 'vitest';
import {
  AI_VERDICTS, isVerdict, MAX_ADJUSTMENT, MIN_CONFIDENCE, parseVerdict, refineScore,
  RESCORE_AFTER_DAYS, RESCORE_IGNORE_AFTER_DAYS, shouldRescore, verdictFromRules,
  VERDICT_LABEL,
} from './refine.js';
import { HOT_SCORE_THRESHOLD } from '../config/constants.js';

const NOW = new Date('2026-03-04T08:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('refineScore — the limits', () => {
  it('nudges a good lead up', () => {
    const result = refineScore({ ruleScore: 55, verdict: 'good', confidence: 1, unreachable: false });
    expect(result.adjustment).toBe(6);
    expect(result.score).toBe(61);
    expect(result.limited).toBe('none');
  });

  it('never moves a score by more than the cap', () => {
    for (const verdict of AI_VERDICTS) {
      const result = refineScore({ ruleScore: 50, verdict, confidence: 1, unreachable: false });
      expect(Math.abs(result.adjustment)).toBeLessThanOrEqual(MAX_ADJUSTMENT);
    }
  });

  it('caps a junk verdict at the maximum drop and says so', () => {
    const result = refineScore({ ruleScore: 60, verdict: 'junk', confidence: 1, unreachable: false });
    expect(result.adjustment).toBe(-MAX_ADJUSTMENT);
    expect(result.score).toBe(40);
    expect(result.limited).toBe('cap');
  });

  it('scales the move by confidence', () => {
    const sure = refineScore({ ruleScore: 50, verdict: 'hot', confidence: 1, unreachable: false });
    const halfSure = refineScore({ ruleScore: 50, verdict: 'hot', confidence: 0.5, unreachable: false });
    expect(halfSure.adjustment).toBeLessThan(sure.adjustment);
    expect(halfSure.adjustment).toBe(9);
  });

  it('changes nothing when the model is guessing', () => {
    const result = refineScore({ ruleScore: 50, verdict: 'junk', confidence: MIN_CONFIDENCE - 0.01, unreachable: false });
    expect(result.adjustment).toBe(0);
    expect(result.score).toBe(50);
    expect(result.limited).toBe('confidence');
  });

  it('treats a nonsense confidence as no confidence', () => {
    const result = refineScore({ ruleScore: 50, verdict: 'hot', confidence: Number.NaN, unreachable: false });
    expect(result.adjustment).toBe(0);
  });

  it('clamps a confidence above one rather than trusting it', () => {
    const result = refineScore({ ruleScore: 50, verdict: 'good', confidence: 9, unreachable: false });
    expect(result.adjustment).toBe(6);
  });

  it('stays inside 0 and 100', () => {
    expect(refineScore({ ruleScore: 96, verdict: 'hot', confidence: 1, unreachable: false }).score).toBe(100);
    expect(refineScore({ ruleScore: 5, verdict: 'junk', confidence: 1, unreachable: false }).score).toBe(0);
  });
});

describe('refineScore — the veto', () => {
  it('never lets an unreachable lead become hot', () => {
    const result = refineScore({ ruleScore: 68, verdict: 'hot', confidence: 1, unreachable: true });
    expect(result.score).toBe(HOT_SCORE_THRESHOLD - 1);
    expect(result.limited).toBe('unreachable');
    expect(result.band).not.toBe('hot');
  });

  it('pulls an already-hot rule score back down when there is no way to reach them', () => {
    const result = refineScore({ ruleScore: 80, verdict: 'good', confidence: 1, unreachable: true });
    expect(result.score).toBe(HOT_SCORE_THRESHOLD - 1);
    /* The adjustment is restated so rule + adjustment still equals the score. */
    expect(80 + result.adjustment).toBe(result.score);
  });

  it('leaves a reachable hot lead hot', () => {
    const result = refineScore({ ruleScore: 68, verdict: 'hot', confidence: 1, unreachable: false });
    expect(result.score).toBeGreaterThanOrEqual(HOT_SCORE_THRESHOLD);
    expect(result.band).toBe('hot');
  });

  it('does not touch a low score just because the lead is unreachable', () => {
    const result = refineScore({ ruleScore: 20, verdict: 'weak', confidence: 1, unreachable: true });
    expect(result.score).toBe(8);
    expect(result.limited).toBe('none');
  });
});

describe('refineScore — junk is a suggestion', () => {
  it('offers "mark invalid" only on a confident junk verdict', () => {
    expect(refineScore({ ruleScore: 10, verdict: 'junk', confidence: 0.9, unreachable: false }).suggestInvalid).toBe(true);
    expect(refineScore({ ruleScore: 10, verdict: 'junk', confidence: 0.7, unreachable: false }).suggestInvalid).toBe(false);
  });

  it('never offers it for any other verdict', () => {
    for (const verdict of ['hot', 'good', 'weak'] as const) {
      expect(refineScore({ ruleScore: 10, verdict, confidence: 1, unreachable: false }).suggestInvalid).toBe(false);
    }
  });
});

describe('verdictFromRules — so the chip works with AI switched off', () => {
  it('calls a high score hot', () => {
    expect(verdictFromRules({ score: 82, components: [{ signal: 'budget_in_range', points: 20 }] })).toBe('hot');
  });

  it('calls a middling score good', () => {
    expect(verdictFromRules({ score: 45, components: [] })).toBe('good');
  });

  it('calls a low score weak', () => {
    expect(verdictFromRules({ score: 12, components: [] })).toBe('weak');
  });

  it('calls junk junk, however high the rest scored', () => {
    expect(verdictFromRules({ score: 75, components: [{ signal: 'spam_signals', points: -20 }] })).toBe('junk');
    expect(verdictFromRules({ score: 75, components: [{ signal: 'invalid_number', points: -25 }] })).toBe('junk');
  });
});

describe('parseVerdict', () => {
  it('reads a well-formed reply', () => {
    expect(parseVerdict({ verdict: 'hot', confidence: 0.8, why: 'Asked for a call twice.' })).toEqual({
      verdict: 'hot',
      confidence: 0.8,
      why: 'Asked for a call twice.',
    });
  });

  it('tolerates case and whitespace', () => {
    expect(parseVerdict({ verdict: ' JUNK ', confidence: 1 })?.verdict).toBe('junk');
  });

  it('defaults a missing confidence to the middle', () => {
    expect(parseVerdict({ verdict: 'good' })?.confidence).toBe(0.5);
  });

  it('rejects a verdict that is not one of the four', () => {
    expect(parseVerdict({ verdict: 'warm', confidence: 1 })).toBeNull();
    expect(parseVerdict({ verdict: '', confidence: 1 })).toBeNull();
    expect(parseVerdict({ confidence: 1 })).toBeNull();
  });

  it('rejects anything that is not an object', () => {
    expect(parseVerdict(null)).toBeNull();
    expect(parseVerdict('hot')).toBeNull();
    expect(parseVerdict(42)).toBeNull();
  });

  it('collapses and trims the reason', () => {
    const parsed = parseVerdict({ verdict: 'good', confidence: 1, why: `  a\n\nb ${'x'.repeat(400)}` });
    expect(parsed?.why?.length).toBe(255);
    expect(parsed?.why).toContain('a b');
  });

  it('treats an empty reason as none', () => {
    expect(parseVerdict({ verdict: 'good', confidence: 1, why: '   ' })?.why).toBeNull();
  });

  it('agrees with isVerdict', () => {
    for (const verdict of AI_VERDICTS) expect(isVerdict(verdict)).toBe(true);
    expect(isVerdict('lukewarm')).toBe(false);
  });

  it('has a label for every verdict', () => {
    for (const verdict of AI_VERDICTS) expect(VERDICT_LABEL[verdict]).toBeTruthy();
  });
});

describe('shouldRescore', () => {
  const open = { status: 'open', createdAt: daysAgo(10) };

  it('always looks at a lead it has never scored', () => {
    expect(shouldRescore({ ...open, scoredAt: null, lastActivityAt: daysAgo(1) }, NOW)).toBe(true);
  });

  it('skips a closed lead', () => {
    expect(shouldRescore({ ...open, status: 'won', scoredAt: null, lastActivityAt: daysAgo(1) }, NOW)).toBe(false);
    expect(shouldRescore({ ...open, status: 'lost', scoredAt: null, lastActivityAt: daysAgo(1) }, NOW)).toBe(false);
  });

  it('skips a lead nobody has touched in six weeks', () => {
    expect(
      shouldRescore(
        { status: 'open', createdAt: daysAgo(90), scoredAt: null, lastActivityAt: daysAgo(RESCORE_IGNORE_AFTER_DAYS + 1) },
        NOW,
      ),
    ).toBe(false);
  });

  it('uses the created date when nothing has ever happened', () => {
    expect(shouldRescore({ status: 'open', createdAt: daysAgo(2), scoredAt: null, lastActivityAt: null }, NOW)).toBe(true);
    expect(shouldRescore({ status: 'open', createdAt: daysAgo(60), scoredAt: null, lastActivityAt: null }, NOW)).toBe(false);
  });

  it('re-scores when something happened after the last verdict', () => {
    expect(shouldRescore({ ...open, scoredAt: daysAgo(3), lastActivityAt: daysAgo(1) }, NOW)).toBe(true);
  });

  it('leaves a fresh verdict alone when nothing has happened since', () => {
    expect(shouldRescore({ ...open, scoredAt: daysAgo(1), lastActivityAt: daysAgo(3) }, NOW)).toBe(false);
  });

  it('re-scores an old verdict even on a quiet lead', () => {
    expect(
      shouldRescore({ ...open, scoredAt: daysAgo(RESCORE_AFTER_DAYS), lastActivityAt: daysAgo(8) }, NOW),
    ).toBe(true);
    expect(
      shouldRescore({ ...open, scoredAt: daysAgo(RESCORE_AFTER_DAYS - 1), lastActivityAt: daysAgo(8) }, NOW),
    ).toBe(false);
  });
});
