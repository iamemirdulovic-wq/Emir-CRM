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
import { saveRoutingSettings } from '../../routing/settings.js';
import { SYSTEM_ACTOR } from '../../audit/audit.js';

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

  /*
   * Urgent still arms a clock -- once the rule is switched on.
   *
   * It is off by default from 12 Nov, by Emir's instruction, so this test
   * turns it on for itself like the others that cover the five-minute rule.
   * Off means off everywhere, Hot included: a switch that some screens
   * ignore is worse than no switch.
   */
  it('starts one when the owner says it is urgent', async () => {
    await saveRoutingSettings(SYSTEM_ACTOR, { slaEnabled: true });
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

  /*
   * "I added this lead myself -- it doesn't mean nobody called." The lead went
   * in with no contact against it, so every count and every suggestion in the
   * CRM believed it had never been touched.
   */
  it('counts a lead you keep as contacted', async () => {
    const emir = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, emir);

    const res = await addLead(cookie, { assignToUserId: emir.id });
    const row = await queryOne<{ last_contact_at: Date | null; first_touch_at: Date | null }>(
      'SELECT last_contact_at, first_touch_at FROM opportunities WHERE id = ?', [res.body.opportunityId],
    );
    expect(row?.last_contact_at, 'somebody spoke to them: him').not.toBeNull();
    expect(row?.first_touch_at, 'and that is the speed-to-lead moment').not.toBeNull();

    const activity = await queryOne<{ title: string; type: string }>(
      'SELECT title, type FROM activities WHERE opportunity_id = ? AND type = ?',
      [res.body.opportunityId, 'call'],
    );
    expect(activity?.title, 'and the history says where it came from').toContain('kept it');
  });

  it('counts an agent adding their own lead as contacted too', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));
    const res = await addLead(cookie, {});
    const row = await queryOne<{ last_contact_at: Date | null }>(
      'SELECT last_contact_at FROM opportunities WHERE id = ?', [res.body.opportunityId],
    );
    expect(row?.last_contact_at).not.toBeNull();
  });

  /* But a lead handed to somebody else has NOT been called by them, and the
     nag on it is the whole point of the pipeline. */
  it('leaves a handed-over lead uncontacted', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, await createTestUser({ role: 'owner' }));

    const res = await addLead(cookie, { assignToUserId: agent.id });
    const row = await queryOne<{ last_contact_at: Date | null }>(
      'SELECT last_contact_at FROM opportunities WHERE id = ?', [res.body.opportunityId],
    );
    expect(row?.last_contact_at, 'the agent still has to ring them').toBeNull();
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
