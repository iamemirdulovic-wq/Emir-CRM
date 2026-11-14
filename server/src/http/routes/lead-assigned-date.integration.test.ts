import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { execute, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * When a lead was given to an agent, as the list endpoint sends it.
 *
 * Talha, 14 Nov 2026, with a screenshot of 105 new leads in which every card
 * was identical: *"you need to put dates on the leads once they assign, so we
 * know which one is today leads, which one is yesterday, and which one is day
 * before yesterday."*
 *
 * `opportunities.assigned_at` has existed since `0001_init.sql` and every
 * assignment path writes it. It was simply never selected into `/api/my-leads`,
 * so the screens had nothing to draw. These tests hold three things:
 *
 *   1. the field is in the response, as a real timestamp;
 *   2. it is the date the lead was **given out**, not the date it arrived —
 *      the two differ by design, and this is what the owner chose on 14 Nov;
 *   3. a lead that has never been given out sends null rather than borrowing
 *      another date, so a screen cannot present a confident wrong answer.
 */
let server: Server;
let base = '';

describeWithDb('when a lead was given to its agent', () => {
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

  /** MySQL's own `DATETIME(3)` spelling of an instant. */
  const sql = (at: Date) => at.toISOString().slice(0, 23).replace('T', ' ');

  async function firstStage(): Promise<{ id: string; pipeline_id: string; key: string }> {
    const row = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    return row!;
  }

  async function aLead(
    owner: string | null,
    over: { name?: string; createdAt?: Date; assignedAt?: Date | null } = {},
  ): Promise<string> {
    const stage = await firstStage();
    const contactId = newId();
    await execute(
      `INSERT INTO contacts (id, full_name, phone_e164, email, language)
       VALUES (?, ?, ?, ?, 'en')`,
      [
        contactId,
        over.name ?? 'Marco Bellini',
        `+3933312${Math.floor(Math.random() * 90000) + 10000}`,
        `lead-${contactId.slice(0, 8)}@example.com`,
      ],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source,
          project_name, created_at, assigned_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 'referral', 'The Archive', COALESCE(?, NOW(3)), ?)`,
      [
        id, contactId, stage.pipeline_id, stage.id, stage.key, owner,
        over.name ?? 'Marco Bellini',
        over.createdAt ? sql(over.createdAt) : null,
        over.assignedAt === undefined
          ? sql(new Date())
          : over.assignedAt === null ? null : sql(over.assignedAt),
      ],
    );
    return id;
  }

  const get = (path: string, cookie: string) => fetch(`${base}${path}`, { headers: { cookie } });

  interface Row {
    id: string;
    full_name: string | null;
    assigned_at: string | null;
    created_at: string | null;
  }

  async function list(cookie: string, tab = 'all'): Promise<Row[]> {
    const res = await get(`/api/my-leads?tab=${tab}&pageSize=50`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { items: Row[] }).items;
  }

  it('sends assigned_at on every lead in the list', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const givenAt = new Date(Date.now() - 26 * 3_600_000);
    await aLead(agent.id, { name: 'Given Yesterday', assignedAt: givenAt });

    const rows = await list(await signIn(base, agent));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.assigned_at, 'the field the three screens read').not.toBeUndefined();
    expect(row.assigned_at).not.toBeNull();
    /* Within a second of what was stored: the screens do the formatting, the
       endpoint only has to send the instant. */
    expect(Math.abs(new Date(row.assigned_at as string).getTime() - givenAt.getTime()))
      .toBeLessThan(1_000);
  });

  /*
   * The owner chose this deliberately over "when the lead arrived". They
   * differ exactly where it matters: an old list imported months after those
   * people enquired, and a lead moved from one agent to another.
   */
  it('is when the lead was given out, not when it arrived', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const arrived = new Date(Date.UTC(2026, 7, 2, 9, 0, 0));   // 2 Aug, an old list
    const handed = new Date(Date.UTC(2026, 10, 13, 6, 30, 0)); // 13 Nov, given out
    await aLead(agent.id, { name: 'Old Import', createdAt: arrived, assignedAt: handed });

    const row = (await list(await signIn(base, agent)))[0]!;
    expect(new Date(row.assigned_at as string).getUTCMonth(), 'November, not August').toBe(10);
    expect(new Date(row.created_at as string).getUTCMonth()).toBe(7);
    expect(row.assigned_at).not.toBe(row.created_at);
  });

  it('sends null for a lead that has never been given out', async () => {
    const boss = await createTestUser({ role: 'owner' });
    await aLead(null, { name: 'Still In The Pool', assignedAt: null });

    const rows = await list(await signIn(base, boss));
    const row = rows.find((one) => one.full_name === 'Still In The Pool')!;
    expect(row, 'the pool lead should be in the owner’s book').toBeTruthy();
    /*
     * Null, not the created date. The screens print "Not given out yet" from
     * this; a server that quietly substituted `created_at` here would make
     * every screen confidently wrong and no screen could tell.
     */
    expect(row.assigned_at).toBeNull();
    expect(row.created_at).not.toBeNull();
  });

  it('moves the date forward when a lead is given to somebody else', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const from = await createTestUser({ role: 'agent', name: 'Shan' });
    const to = await createTestUser({ role: 'agent', name: 'Rocky' });
    const old = new Date(Date.now() - 5 * 86_400_000);
    const id = await aLead(from.id, { name: 'Handed Over', assignedAt: old });
    const cookie = await signIn(base, boss);

    const res = await fetch(`${base}/api/my-leads/move`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ moves: [{ id, toUserId: to.id }] }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    /*
     * The new agent's "given to you" has to be the day they got it, not the
     * day the previous agent did — which is the whole reason the owner picked
     * `assigned_at` over `created_at`.
     */
    const row = (await list(await signIn(base, to)))[0]!;
    expect(row.full_name).toBe('Handed Over');
    expect(new Date(row.assigned_at as string).getTime())
      .toBeGreaterThan(old.getTime() + 86_400_000);
  });

  it('an agent still only sees their own leads’ dates', async () => {
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    await aLead(mine.id, { name: 'Mine' });
    await aLead(theirs.id, { name: 'Theirs' });

    const rows = await list(await signIn(base, mine));
    expect(rows.map((row) => row.full_name)).toEqual(['Mine']);
  });
});
