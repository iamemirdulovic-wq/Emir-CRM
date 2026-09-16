import { describe, expect, it } from 'vitest';
import {
  batchSize, DEFAULT_BULK_POLICY, describeSkipped, shouldPause, splitByEligibility,
  type ConsentCheck,
} from './guard.js';

const contact = (id: string, extra: Partial<ConsentCheck> = {}): ConsentCheck => ({
  contactId: id, dnc: false, whatsappConsent: true, hasWaId: true, ...extra,
});

describe('who may be messaged', () => {
  it('lets through a consenting contact with a WhatsApp number', () => {
    const split = splitByEligibility([contact('a')]);
    expect(split.eligible).toEqual(['a']);
    expect(split.skipped).toHaveLength(0);
  });

  it('never messages a contact with no recorded consent', () => {
    // The single most reliable way to get a WhatsApp number banned.
    const split = splitByEligibility([contact('a', { whatsappConsent: false })]);
    expect(split.eligible).toHaveLength(0);
    expect(split.skipped[0]?.reason).toMatch(/consent/i);
  });

  it('never messages someone on the do-not-contact list', () => {
    const split = splitByEligibility([contact('a', { dnc: true })]);
    expect(split.eligible).toHaveLength(0);
    expect(split.skipped[0]?.reason).toMatch(/do-not-contact/i);
  });

  it('reports DNC ahead of missing consent, because it is the stronger signal', () => {
    const split = splitByEligibility([contact('a', { dnc: true, whatsappConsent: false })]);
    expect(split.skipped[0]?.reason).toMatch(/do-not-contact/i);
  });

  it('skips a consenting contact with no WhatsApp number', () => {
    const split = splitByEligibility([contact('a', { hasWaId: false })]);
    expect(split.eligible).toHaveLength(0);
  });

  it('splits a mixed list', () => {
    const split = splitByEligibility([
      contact('a'),
      contact('b', { whatsappConsent: false }),
      contact('c', { dnc: true }),
      contact('d'),
    ]);
    expect(split.eligible).toEqual(['a', 'd']);
    expect(split.skipped).toHaveLength(2);
  });
});

describe('the warning shown before sending', () => {
  it('counts the skipped contacts by reason', () => {
    // "412 will be skipped" is a warning; naming the reasons is actionable.
    const split = splitByEligibility([
      contact('a'),
      contact('b', { whatsappConsent: false }),
      contact('c', { whatsappConsent: false }),
      contact('d', { dnc: true }),
    ]);
    const text = describeSkipped(split);
    expect(text).toContain('1 will be messaged');
    expect(text).toContain('3 will be skipped');
    expect(text).toContain('2 no recorded whatsapp consent');
  });

  it('says so plainly when nothing is skipped', () => {
    expect(describeSkipped(splitByEligibility([contact('a'), contact('b')]))).toBe(
      'All 2 contacts will be messaged.',
    );
  });
});

describe('automatic pause', () => {
  it('keeps going while the rating is green', () => {
    expect(shouldPause({ quality: 'GREEN', attempted: 100, failed: 1 })).toEqual({ pause: false });
  });

  it('stops the moment the rating goes red', () => {
    const decision = shouldPause({ quality: 'RED', attempted: 5, failed: 0 });
    expect(decision.pause).toBe(true);
    if (decision.pause) expect(decision.reason).toMatch(/quality/i);
  });

  it('can be told to stop on yellow too', () => {
    const strict = { ...DEFAULT_BULK_POLICY, pauseAtQuality: 'YELLOW' as const };
    expect(shouldPause({ quality: 'YELLOW', attempted: 5, failed: 0 }, strict).pause).toBe(true);
    expect(shouldPause({ quality: 'GREEN', attempted: 5, failed: 0 }, strict).pause).toBe(false);
  });

  it('stops when too many sends are failing', () => {
    const decision = shouldPause({ quality: 'GREEN', attempted: 100, failed: 30 });
    expect(decision.pause).toBe(true);
    if (decision.pause) expect(decision.reason).toContain('30%');
  });

  it('ignores a high failure rate over too few attempts', () => {
    // Two failures out of three is noise at the start of a campaign.
    expect(shouldPause({ quality: 'GREEN', attempted: 3, failed: 2 }).pause).toBe(false);
  });

  it('treats an unknown rating as usable rather than blocking every campaign', () => {
    expect(shouldPause({ quality: 'UNKNOWN', attempted: 10, failed: 0 }).pause).toBe(false);
  });
});

describe('throttle', () => {
  it('sends the configured number per minute', () => {
    expect(batchSize({ ...DEFAULT_BULK_POLICY, throttlePerMinute: 20 })).toBe(20);
  });

  it('never sends nothing, whatever the configuration says', () => {
    expect(batchSize({ ...DEFAULT_BULK_POLICY, throttlePerMinute: 0 })).toBe(1);
  });

  it('caps a reckless configuration', () => {
    expect(batchSize({ ...DEFAULT_BULK_POLICY, throttlePerMinute: 100_000 })).toBe(200);
  });
});
