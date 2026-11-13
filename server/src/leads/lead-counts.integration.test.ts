import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';

/**
 * The number on a tab and the length of the list under it.
 *
 * These two came from two different queries, and for the "All" tab the count
 * took a short cut -- a plain COUNT(*) with no deleted fence -- while the
 * list was built from `TABS.all.where`, which has one. So a deleted lead was
 * counted and never shown, and the tab read one higher than the rows beneath
 * it for ever, with nothing in any log to say why.
 *
 * Emir reported this shape of bug on 11 November from the other end: "we have
 * leads means new 419, but we can't see all the leads". This test is the line
 * under it. Both numbers now come from `leadTabCounts`.
 */
let server: Server;
let base = '';

describeWithDb('tab counts and the list agree', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    setEnvForTesting(null);
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });
  beforeEach(async () => { await resetTables(); resetRateLimits(); });
  afterEach(() => resetRateLimits());

  async function aLead(owner: string, opts: { deleted?: boolean; lost?: boolean } = {}) {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Someone', `+9715${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source,
          deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'x', 'manual', ?)`,
      [
        id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner,
        opts.lost ? 'lost' : 'open',
        opts.deleted ? new Date() : null,
      ],
    );
    return id;
  }

  const get = async <T>(path: string, cookie: string): Promise<T> => {
    const res = await fetch(`${base}${path}`, { headers: { cookie } });
    expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
    return await res.json() as T;
  };

  it('does not count a deleted lead the list will never show', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id);
    await aLead(agent.id);
    await aLead(agent.id, { deleted: true });
    const cookie = await signIn(base, agent);

    const counts = await get<Record<string, number>>('/api/my-leads/counts', cookie);
    const list = await get<{ total: number; items: unknown[] }>(
      '/api/my-leads?tab=all&pageSize=50', cookie,
    );

    expect(counts.all, 'the deleted lead must not be counted').toBe(2);
    expect(counts.all, 'the tab and the list must be the same number').toBe(list.total);
    expect(list.items).toHaveLength(2);
  });

  it('agrees with the list on every tab', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id);
    await aLead(agent.id, { lost: true });
    await aLead(agent.id, { deleted: true });
    const cookie = await signIn(base, agent);

    const counts = await get<Record<string, number>>('/api/my-leads/counts', cookie);

    for (const tab of ['today', 'new', 'hot', 'overdue', 'no_next_step', 'vip', 'lost', 'all']) {
      const list = await get<{ total: number }>(
        `/api/my-leads?tab=${tab}&pageSize=50`, cookie,
      );
      expect(counts[tab], `tab "${tab}" disagrees with its own list`).toBe(list.total);
    }
  });

  it('counts only what an agent may see', async () => {
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });
    await aLead(mine.id);
    await aLead(theirs.id);
    await aLead(theirs.id);

    const counts = await get<Record<string, number>>(
      '/api/my-leads/counts', await signIn(base, mine),
    );
    expect(counts.all, 'an agent must not be told how many leads other people hold').toBe(1);
  });
});
