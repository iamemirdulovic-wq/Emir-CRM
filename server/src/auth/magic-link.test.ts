import { describe, expect, it } from 'vitest';
import { canUseLoginLink, checkLink, LINK_TTL_MS, type LinkRow } from './magic-link.js';

/**
 * A sign-in link is a password that arrives by email, so every way one can be
 * wrong is settled here rather than discovered on a live CRM.
 */

const NOW = new Date('2026-11-02T10:00:00Z');
const at = (msFromNow: number) => new Date(NOW.getTime() + msFromNow);

const link = (over: Partial<LinkRow> = {}): LinkRow => ({
  id: 'l-1',
  user_id: 'u-1',
  expires_at: at(LINK_TTL_MS),
  used_at: null,
  ...over,
});

describe('who may sign in with a link', () => {
  /*
   * The whole reason owner and admin are excluded: a link needs working
   * email, so if every role depended on one, the day email breaks is the day
   * nobody can get in to fix it — including the person who would fix it.
   */
  it('keeps owner and admin on passwords', () => {
    expect(canUseLoginLink('owner')).toBe(false);
    expect(canUseLoginLink('admin')).toBe(false);
  });

  it('lets the people who work the leads use one', () => {
    expect(canUseLoginLink('agent')).toBe(true);
    expect(canUseLoginLink('manager')).toBe(true);
    expect(canUseLoginLink('accountant')).toBe(true);
  });

  it('never lets the service account sign in at all', () => {
    expect(canUseLoginLink('automation')).toBe(false);
  });
});

describe('checking a link', () => {
  it('accepts one that is fresh and unused', () => {
    expect(checkLink(link(), NOW)).toEqual({ ok: true });
  });

  it('rejects a token nobody issued', () => {
    expect(checkLink(null, NOW)).toEqual({ ok: false, why: 'unknown' });
  });

  it('rejects one that has been spent', () => {
    expect(checkLink(link({ used_at: at(-1000) }), NOW)).toEqual({ ok: false, why: 'already_used' });
  });

  it('rejects one that has run out', () => {
    expect(checkLink(link({ expires_at: at(-1) }), NOW)).toEqual({ ok: false, why: 'expired' });
  });

  /* The boundary, stated rather than assumed: a link expiring exactly now is
     gone. Off by one second here is a link that works a moment too long. */
  it('treats the expiry moment as expired', () => {
    expect(checkLink(link({ expires_at: NOW }), NOW)).toEqual({ ok: false, why: 'expired' });
    expect(checkLink(link({ expires_at: at(1) }), NOW)).toEqual({ ok: true });
  });

  /* Used wins over expired. A link somebody already clicked should say so,
     rather than implying it would have worked if they had been quicker. */
  it('says used, not expired, when it is both', () => {
    expect(checkLink(link({ used_at: at(-5000), expires_at: at(-1) }), NOW))
      .toEqual({ ok: false, why: 'already_used' });
  });
});

describe('how long a link lasts', () => {
  it('is fifteen minutes', () => {
    expect(LINK_TTL_MS).toBe(15 * 60 * 1000);
  });
});
