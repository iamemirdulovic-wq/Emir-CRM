import { describe, expect, it } from 'vitest';
import {
  defaultSubStatus,
  isClosed,
  isLostReason,
  isPastAttemptedContact,
  isValidSubStatus,
  STAGE_KEYS,
  stagePosition,
} from './stages.js';

describe('pipeline stages', () => {
  it('orders the stages exactly as specified', () => {
    expect([...STAGE_KEYS]).toEqual([
      'new_lead',
      'attempted_contact',
      'engaged_qualified',
      'appointment_scheduled',
      'deal_sent',
      'won',
      'lost',
    ]);
  });

  it('knows which stages are past Attempted Contact', () => {
    expect(isPastAttemptedContact('new_lead')).toBe(false);
    expect(isPastAttemptedContact('attempted_contact')).toBe(false);
    expect(isPastAttemptedContact('engaged_qualified')).toBe(true);
    expect(isPastAttemptedContact('won')).toBe(true);
  });

  it('knows the closed stages', () => {
    expect(isClosed('won')).toBe(true);
    expect(isClosed('lost')).toBe(true);
    expect(isClosed('deal_sent')).toBe(false);
  });

  it('validates sub-statuses against their stage', () => {
    expect(isValidSubStatus('attempted_contact', 'attempt_3')).toBe(true);
    expect(isValidSubStatus('attempted_contact', 'qualified')).toBe(false);
    expect(isValidSubStatus('engaged_qualified', 'nurture')).toBe(true);
    expect(isValidSubStatus('won', 'commission_received')).toBe(true);
    expect(isValidSubStatus('new_lead', null)).toBe(true);
  });

  it('validates lost reasons', () => {
    expect(isLostReason('unresponsive')).toBe(true);
    expect(isLostReason('changed_mind')).toBe(false);
    expect(isLostReason(null)).toBe(false);
  });

  it('gives each stage a sensible default sub-status', () => {
    expect(defaultSubStatus('new_lead')).toBe('raw');
    expect(defaultSubStatus('attempted_contact')).toBe('attempt_1');
    expect(defaultSubStatus('lost')).toBeNull();
  });

  it('positions increase monotonically', () => {
    const positions = STAGE_KEYS.map(stagePosition);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
