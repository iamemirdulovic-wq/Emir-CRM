import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { consumeLoginLink, issueLoginLink, LINK_TTL_MS } from './magic-link.js';
import { hashToken } from '../lib/crypto.js';

/**
 * A sign-in link is a password that arrives by email, so the promises it
 * makes have to hold against a real database rather than a mock:
 *
 *   - the token itself is never written down;
 *   - it works exactly once, even if two people click at the same instant;
 *   - asking for a new one kills the old;
 *   - a deactivated or promoted account cannot finish signing in.
 *
 * The double-click test is the one that matters. A link arrives by email, and
 * email is forwarded, synced to two phones and prefetched by scanners — so
 * "two requests at once" is the normal case, not the exotic one.
 */
describeWithDb('signing in with a link', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); });

  it('never stores the token itself', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { token } = await issueLoginLink(agent.id, '1.2.3.4');

    const row = await queryOne<{ token_hash: string }>(
      'SELECT token_hash FROM login_links WHERE user_id = ?', [agent.id],
    );
    expect(row?.token_hash).toBe(hashToken(token));
    expect(row?.token_hash).not.toBe(token);
  });

  it('signs the agent in', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { token } = await issueLoginLink(agent.id, null);

    const result = await consumeLoginLink(token, '1.2.3.4');
    expect(result).toEqual({ ok: true, userId: agent.id, role: 'agent' });
  });

  it('works once and only once', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { token } = await issueLoginLink(agent.id, null);

    expect((await consumeLoginLink(token, null)).ok).toBe(true);
    expect(await consumeLoginLink(token, null)).toEqual({ ok: false, why: 'already_used' });
  });

  /*
   * Two clicks landing together — a forwarded email, a mail scanner following
   * the link, the same person tapping twice on a slow connection. Exactly one
   * must win. A read-then-write would let both through.
   */
  it('lets exactly one of two simultaneous clicks through', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { token } = await issueLoginLink(agent.id, null);

    const results = await Promise.all([
      consumeLoginLink(token, '1.1.1.1'),
      consumeLoginLink(token, '2.2.2.2'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it('kills the previous link when a new one is asked for', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const first = await issueLoginLink(agent.id, null);
    const second = await issueLoginLink(agent.id, null);

    expect(await consumeLoginLink(first.token, null)).toEqual({ ok: false, why: 'expired' });
    expect((await consumeLoginLink(second.token, null)).ok).toBe(true);
  });

  it('refuses a link that has run out', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { token } = await issueLoginLink(agent.id, null);
    await execute(
      'UPDATE login_links SET expires_at = DATE_SUB(NOW(3), INTERVAL 1 SECOND) WHERE user_id = ?',
      [agent.id],
    );
    expect(await consumeLoginLink(token, null)).toEqual({ ok: false, why: 'expired' });
  });

  it('refuses a token nobody issued', async () => {
    expect(await consumeLoginLink('not-a-real-token-at-all', null))
      .toEqual({ ok: false, why: 'unknown' });
  });

  it('refuses once the account is switched off', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { token } = await issueLoginLink(agent.id, null);
    await execute('UPDATE users SET is_active = 0 WHERE id = ?', [agent.id]);

    expect(await consumeLoginLink(token, null)).toEqual({ ok: false, why: 'user_inactive' });
  });

  /*
   * Promoted between asking and clicking. The role is checked again on the
   * way in, because owners and admins keep passwords so that something can
   * still sign in on the day email is broken.
   */
  it('refuses if the account became an admin in the meantime', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { token } = await issueLoginLink(agent.id, null);
    await execute("UPDATE users SET role = 'admin' WHERE id = ?", [agent.id]);

    expect(await consumeLoginLink(token, null)).toEqual({ ok: false, why: 'role_not_allowed' });
  });

  it('expires fifteen minutes out', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const before = Date.now();
    const { expiresAt } = await issueLoginLink(agent.id, null);
    const gap = expiresAt.getTime() - before;
    expect(gap).toBeGreaterThan(LINK_TTL_MS - 5_000);
    expect(gap).toBeLessThanOrEqual(LINK_TTL_MS + 1_000);
  });
});
