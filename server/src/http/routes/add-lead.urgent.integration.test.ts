import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { queryOne } from '../../db/client.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * The five-minute clock is opt-in on a lead somebody adds by hand.
 *
 * The clock protects a stranger who has just filled in a form and is sitting
 * there waiting: if nobody touches the lead it is taken off that agent, the
 * manager is alerted and it is tagged `sla-breach`.
 *
 * A lead the owner types in and hands to a named agent is not waiting for
 * anybody. Starting a clock on it means the CRM takes the lead back off the
 * person the owner just chose, five minutes later, for no reason — undoing the
 * decision rather than enforcing it. Emir, 10 Nov 2026: "it should be only me,
 * as owner and admin, who gives a lead that timer, not every lead."
 *
 * So the clock runs only when `urgent` is sent, for the case it was built for:
 * the owner typing in somebody who is on the phone right now.
 */
let server: Server;
let base = '';

async function addLead(cookie: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      fullName: 'Ahmed Khan', phone: '+971501234567', source: 'walk_in', ...body,
    }),
  });
  return { status: res.status, body: await res.json().catch(() => null) as Record<string, string> };
}

/** The SLA job the timer queues, if it queued one. */
async function slaJobs(): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM jobs WHERE type = 'workflow.a.sla_check'", [],
  );
  return Number(row?.n ?? 0);
}

describeWithDb('the clock on a lead added by hand', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });
  beforeEach(async () => { await resetTables(); resetRateLimits(); });

  it('starts no clock when the owner hands a lead to an agent', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, await createTestUser({ role: 'owner' }));

    const res = await addLead(cookie, { assignToUserId: agent.id });
    expect(res.status).toBe(201);
    expect(await slaJobs(), 'the lead is theirs; nothing should take it back').toBe(0);
  });

  it('starts one when the owner says it is urgent', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, await createTestUser({ role: 'owner' }));

    await addLead(cookie, { assignToUserId: agent.id, urgent: true });
    expect(await slaJobs()).toBe(1);
  });

  it('still assigns the lead either way', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, await createTestUser({ role: 'owner' }));

    const res = await addLead(cookie, { assignToUserId: agent.id });
    const owned = await queryOne<{ owner_user_id: string; accepted_at: string | null }>(
      'SELECT owner_user_id, accepted_at FROM opportunities WHERE id = ?', [res.body.opportunityId],
    );
    expect(owned?.owner_user_id).toBe(agent.id);
    /* Accepted on the spot: there is nothing for the agent to accept, because
       the owner already decided. */
    expect(owned?.accepted_at).not.toBeNull();
  });

  /* An agent adding their own lead never had a clock, and must not gain one
     by sending the flag. */
  it('ignores urgent from an agent adding their own lead', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));
    await addLead(cookie, { urgent: true });
    expect(await slaJobs()).toBe(0);
  });

  it('starts no clock on an unassigned lead, urgent or not', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'owner' }));
    await addLead(cookie, { urgent: true });
    /* Nobody is holding it, so there is nobody to take it from. It waits in
       Incoming for someone to pick it up. */
    expect(await slaJobs()).toBe(0);
  });

  /*
   * The bug Emir photographed: he added a lead for himself and the CRM put a
   * countdown on it and told him nobody had called them yet. A clock exists to
   * move a lead away from the person holding it, so on your own lead it can
   * only ever fire against you.
   */
  it('starts no clock on a lead you keep for yourself, even urgent', async () => {
    const emir = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, emir);

    const res = await addLead(cookie, { assignToUserId: emir.id, urgent: true });
    expect(res.status).toBe(201);
    expect(await slaJobs(), 'nobody to take it from').toBe(0);

    const owned = await queryOne<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?', [res.body.opportunityId],
    );
    expect(owned?.owner_user_id, 'and it stays his').toBe(emir.id);
  });

  it('records in the audit log whether the clock was asked for', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, await createTestUser({ role: 'owner' }));
    await addLead(cookie, { assignToUserId: agent.id, urgent: true });

    /* mysql2 parses a JSON column into an object, so this is read as one
       rather than grepped as a string. */
    const row = await queryOne<{ after_json: { urgent?: boolean } }>(
      "SELECT after_json FROM audit_log WHERE action = 'lead.added_manually'", [],
    );
    expect(row?.after_json?.urgent).toBe(true);
  });
});
