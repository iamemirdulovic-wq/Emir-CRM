import { describe, expect, it } from 'vitest';
import { addedAt } from './Home.js';

/*
 * Latest leads showed the time alone, so today's 12:24 sat above Sunday's
 * 17:49 and read like a sorting bug (the v2 test, 16 Nov 2026).
 */
describe('when a lead was added, on the Latest leads card', () => {
  const now = new Date(2026, 10, 17, 18, 0);

  it('is the time alone today', () => {
    expect(addedAt(new Date(2026, 10, 17, 12, 24).toISOString(), now)).toBe('12:24');
  });

  it('says Yesterday for yesterday', () => {
    expect(addedAt(new Date(2026, 10, 16, 9, 5).toISOString(), now)).toBe('Yesterday 09:05');
  });

  it('carries the date, month first, before that', () => {
    expect(addedAt(new Date(2026, 10, 15, 17, 49).toISOString(), now)).toBe('Nov 15, 17:49');
    expect(addedAt(new Date(2025, 11, 30, 8, 0).toISOString(), now)).toBe('Dec 30, 2025, 08:00');
  });
});
