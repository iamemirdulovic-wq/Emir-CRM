import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { dubaiDate } from '../attendance/attendance.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';

/**
 * Passing a lead to a colleague.
 *
 * Every rule here exists to stop a lead going quiet in the gap between two
 * people, so every one of them is tested: the lead does not move until the
 * receiver accepts, a deal in progress needs the owner first, a VIP lead
 * cannot go sideways at all, and two people can never both be deciding.
 */
let server: Server;
let base = '';

describeWithDb('transfers', () => {
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

  async function aLead(owner: string, over: { stage?: string; vip?: boolean } = {}) {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      over.stage
        ? 'SELECT id, pipeline_id, `key` FROM pipeline_stages WHERE `key` = ?'
        : 'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
      over.stage ? [over.stage] : [],
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, owner_user_id) VALUES (?, ?, ?, ?)',
      [contactId, 'Marco Bellini', `+9715${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`, owner],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title,
          source, is_vip)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'x', 'manual', ?)`,
      [id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner, over.vip ? 1 : 0],
    );
    return id;
  }

  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('the lead stays with the sender until it is accepted', async () => {
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const lead = await aLead(one.id);

    const asked = await send('POST', '/api/v2/transfers', await signIn(base, one), {
      opportunityId: lead, toUserId: two.id, reason: 'language',
    });
    expect(asked.status, await asked.clone().text()).toBe(201);
    const made = await asked.json() as { id: string; status: string };
    expect(made.status).toBe('pending');

    const waiting = await queryOne<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?', [lead],
    );
    expect(waiting?.owner_user_id, 'in transit it still belongs to somebody').toBe(one.id);

    const accepted = await send('POST', `/api/v2/transfers/${made.id}/answer`,
      await signIn(base, two), { accept: true });
    expect(accepted.status, await accepted.clone().text()).toBe(200);

    const moved = await queryOne<{ owner_user_id: string; accepted_at: Date | null }>(
      'SELECT owner_user_id, accepted_at FROM opportunities WHERE id = ?', [lead],
    );
    expect(moved?.owner_user_id).toBe(two.id);
    expect(moved?.accepted_at).not.toBeNull();
  });

  it('a lead at Meeting waits for the owner before the receiver even sees it', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const lead = await aLead(one.id, { stage: 'appointment_scheduled' });

    const made = await (await send('POST', '/api/v2/transfers', await signIn(base, one), {
      opportunityId: lead, toUserId: two.id, reason: 'leave',
    })).json() as { id: string; status: string };
    expect(made.status).toBe('needs_approval');

    /* The receiver cannot take it while it is still the owner's call. */
    const early = await send('POST', `/api/v2/transfers/${made.id}/answer`,
      await signIn(base, two), { accept: true });
    expect(early.status).toBe(400);

    await send('POST', `/api/v2/transfers/${made.id}/approve`, await signIn(base, boss), { agree: true });
    const now = await send('POST', `/api/v2/transfers/${made.id}/answer`,
      await signIn(base, two), { accept: true });
    expect(now.status).toBe(200);
  });

  it('a VIP lead cannot be passed sideways', async () => {
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const lead = await aLead(one.id, { vip: true });

    const res = await send('POST', '/api/v2/transfers', await signIn(base, one), {
      opportunityId: lead, toUserId: two.id, reason: 'too_many',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('back to whoever gave it');
  });

  it('two people cannot both be deciding on one lead', async () => {
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const three = await createTestUser({ role: 'agent', name: 'Three' });
    const lead = await aLead(one.id);
    const cookie = await signIn(base, one);

    await send('POST', '/api/v2/transfers', cookie, {
      opportunityId: lead, toUserId: two.id, reason: 'language',
    });
    const again = await send('POST', '/api/v2/transfers', cookie, {
      opportunityId: lead, toUserId: three.id, reason: 'language',
    });
    expect(again.status).toBe(400);
  });

  it('you can only pass on your own lead', async () => {
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const lead = await aLead(two.id);

    const res = await send('POST', '/api/v2/transfers', await signIn(base, one), {
      opportunityId: lead, toUserId: two.id, reason: 'language',
    });
    expect(res.status).toBe(403);
  });

  it('refusing leaves the lead exactly where it was', async () => {
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const lead = await aLead(one.id);

    const made = await (await send('POST', '/api/v2/transfers', await signIn(base, one), {
      opportunityId: lead, toUserId: two.id, reason: 'client_asked',
    })).json() as { id: string };

    await send('POST', `/api/v2/transfers/${made.id}/answer`, await signIn(base, two), { accept: false });

    const after = await queryOne<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?', [lead],
    );
    expect(after?.owner_user_id).toBe(one.id);
  });

  it('"Other" without a word of explanation is refused', async () => {
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const lead = await aLead(one.id);

    const res = await send('POST', '/api/v2/transfers', await signIn(base, one), {
      opportunityId: lead, toUserId: two.id, reason: 'other', note: 'eh',
    });
    expect(res.status).toBe(400);
  });

  it('does not offer somebody who is on leave today', async () => {
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const away = await createTestUser({ role: 'agent', name: 'Away' });
    /* Dubai's date, not this machine's. The product asks MySQL for
       `CONVERT_TZ(NOW(), '+00:00', '+04:00')`, so between 20:00 and midnight
       UTC a row written for the UTC date is yesterday's leave in Dubai and
       the person is not away after all. The test passed for twenty hours a
       day and failed for four, which is worse than failing always. */
    const today = dubaiDate();
    await execute(
      `INSERT INTO leave_requests (id, user_id, kind, from_date, to_date, working_days, status)
       VALUES (?, ?, 'annual', ?, ?, 1, 'approved')`,
      [newId(), away.id, today, today],
    );

    const lead = await aLead(one.id);
    const res = await send('POST', '/api/v2/transfers', await signIn(base, one), {
      opportunityId: lead, toUserId: away.id, reason: 'too_many',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('on leave');
  });
});
