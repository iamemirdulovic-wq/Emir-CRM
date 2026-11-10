import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { execute, query, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';
import { runSlaCheck } from '../../workflows/workflow-a.js';
import { resetStorm } from '../../routing/storm.js';
import { saveRoutingSettings } from '../../routing/settings.js';
import { SYSTEM_ACTOR } from '../../audit/audit.js';

/**
 * The loop Emir got caught in, and the way out of it.
 *
 * He gave his agents leads. The clock ran out on each one while the agents
 * were mid-conversation, every lead came back to him, and then there was no
 * screen that would hand a pile of them out again: they sat in his own leads
 * looking like any other lead of his, while nine agents lost the contacts
 * they had been talking to.
 *
 * Two things had to be true to end it. A lead that comes back has to appear
 * where leads waiting to be placed appear. And handing one out must not
 * restart the same clock that took it away.
 */
let server: Server;
let base = '';

/** The default pipeline and its first stage, which an opportunity must have. */
async function newLeadStage(): Promise<{ pipelineId: string; stageId: string }> {
  const row = await queryOne<{ id: string; pipeline_id: string }>(
    "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'new_lead' ORDER BY position LIMIT 1", [],
  );
  if (!row) throw new Error('no new_lead stage: the test database was not seeded');
  return { pipelineId: row.pipeline_id, stageId: row.id };
}

/** One lead, with whatever owner and history the test needs. */
async function makeLead(
  title: string,
  source: string,
  ownerUserId: string | null,
): Promise<{ opportunityId: string; contactId: string }> {
  const { pipelineId, stageId } = await newLeadStage();
  const contactId = newId();
  const opportunityId = newId();
  await execute(
    'INSERT INTO contacts (id, full_name, phone_e164, language) VALUES (?, ?, ?, ?)',
    [contactId, title, `+9715${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`, 'en'],
  );
  await execute(
    `INSERT INTO opportunities
       (id, contact_id, pipeline_id, stage_id, stage_key, status, source, title, owner_user_id, assigned_at)
     VALUES (?, ?, ?, ?, 'new_lead', 'open', ?, ?, ?, ${ownerUserId ? 'NOW(3)' : 'NULL'})`,
    [opportunityId, contactId, pipelineId, stageId, source, title, ownerUserId],
  );
  return { opportunityId, contactId };
}

/** A lead, owned by `agent`, handed over by `giver`. */
async function handOver(giver: string, agent: string): Promise<{ opportunityId: string; contactId: string }> {
  const made = await makeLead('Mahi', 'walk_in', agent);
  await execute(
    `INSERT INTO lead_assignments (id, opportunity_id, contact_id, agent_user_id, assigned_by_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [newId(), made.opportunityId, made.contactId, agent, giver],
  );
  return made;
}

const incoming = async (cookie: string) => {
  const res = await fetch(`${base}/api/incoming`, { headers: { cookie } });
  return (await res.json() as { items: { id: string; returnedAt: string | null }[] }).items;
};

const slaJobs = async (opportunityId: string): Promise<number> => Number((await queryOne<{ n: number }>(
  "SELECT COUNT(*) AS n FROM jobs WHERE type = 'workflow.a.sla_check' AND payload LIKE ?",
  [`%${opportunityId}%`],
))?.n ?? 0);

describeWithDb('a lead that came back, and handing it out again', () => {
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
  beforeEach(async () => {
    await resetTables(); resetRateLimits(); resetStorm();
    /* These tests are about the five-minute rule, which is off by default
       since 10 Nov, so they switch it on for themselves. */
    await saveRoutingSettings(SYSTEM_ACTOR, { slaEnabled: true });
  });

  it('shows up in Incoming for the person it came back to', async () => {
    const emir = await createTestUser({ role: 'owner', name: 'Emir' });
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    const { opportunityId, contactId } = await handOver(emir.id, tej.id);

    await runSlaCheck({ opportunityId, contactId, assignedUserId: tej.id });

    const owner = await queryOne<{ owner_user_id: string; returned_at: Date | null }>(
      'SELECT owner_user_id, returned_at FROM opportunities WHERE id = ?', [opportunityId],
    );
    expect(owner?.owner_user_id, 'back to the person who gave it out').toBe(emir.id);
    expect(owner?.returned_at, 'and marked as waiting to be placed').not.toBeNull();

    const items = await incoming(await signIn(base, emir));
    expect(items.map((row) => row.id), 'so he can see it and hand it on').toContain(opportunityId);
    expect(items.find((row) => row.id === opportunityId)?.returnedAt).not.toBeNull();
  });

  it('stays out of another manager’s Incoming', async () => {
    const emir = await createTestUser({ role: 'owner', name: 'Emir' });
    const other = await createTestUser({ role: 'manager', name: 'Someone else' });
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    const { opportunityId, contactId } = await handOver(emir.id, tej.id);

    await runSlaCheck({ opportunityId, contactId, assignedUserId: tej.id });

    const items = await incoming(await signIn(base, other));
    expect(items.map((row) => row.id), 'it is Emir’s to place, not theirs').not.toContain(opportunityId);
  });

  /* The loop itself: handing it out again must not restart the clock. */
  it('starts no new clock when it is handed out again', async () => {
    const emir = await createTestUser({ role: 'owner', name: 'Emir' });
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    const talha = await createTestUser({ role: 'agent', name: 'Talha' });
    const { opportunityId, contactId } = await handOver(emir.id, tej.id);
    await runSlaCheck({ opportunityId, contactId, assignedUserId: tej.id });

    const cookie = await signIn(base, emir);
    await execute("DELETE FROM jobs WHERE type = 'workflow.a.sla_check'");

    const res = await fetch(`${base}/api/incoming/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ opportunityIds: [opportunityId], agentUserId: talha.id }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ assigned: 1, urgent: false });

    expect(await slaJobs(opportunityId), 'no clock, so it cannot come back again').toBe(0);

    const row = await queryOne<{ owner_user_id: string; returned_at: Date | null; accepted_at: Date | null }>(
      'SELECT owner_user_id, returned_at, accepted_at FROM opportunities WHERE id = ?', [opportunityId],
    );
    expect(row?.owner_user_id).toBe(talha.id);
    expect(row?.returned_at, 'it has an owner, so it leaves Incoming').toBeNull();
    expect(row?.accepted_at, 'nothing for Talha to accept: Emir already decided').not.toBeNull();

    expect((await incoming(cookie)).map((r) => r.id)).not.toContain(opportunityId);
  });

  it('starts one when the clock is asked for', async () => {
    const emir = await createTestUser({ role: 'owner', name: 'Emir' });
    const talha = await createTestUser({ role: 'agent', name: 'Talha' });
    const { opportunityId } = await makeLead('Waiting', 'meta_lead_ads', null);

    const res = await fetch(`${base}/api/incoming/assign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await signIn(base, emir) },
      body: JSON.stringify({ opportunityIds: [opportunityId], agentUserId: talha.id, urgent: true }),
    });
    expect(await res.json()).toMatchObject({ assigned: 1, urgent: true });
    expect(await slaJobs(opportunityId)).toBe(1);

    const row = await queryOne<{ accepted_at: Date | null }>(
      'SELECT accepted_at FROM opportunities WHERE id = ?', [opportunityId],
    );
    expect(row?.accepted_at, 'an urgent lead is accepted by the agent, not for them').toBeNull();
  });

  /* And a lead he decides to keep and ring himself stops waiting to be placed. */
  it('leaves Incoming once the person who got it back works it', async () => {
    const emir = await createTestUser({ role: 'owner', name: 'Emir' });
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    const { opportunityId, contactId } = await handOver(emir.id, tej.id);
    await runSlaCheck({ opportunityId, contactId, assignedUserId: tej.id });

    const cookie = await signIn(base, emir);
    expect((await incoming(cookie)).map((r) => r.id)).toContain(opportunityId);

    const res = await fetch(`${base}/api/my-leads/${opportunityId}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ action: 'call' }),
    });
    expect(res.status, await res.text()).toBeLessThan(300);

    expect(
      (await incoming(cookie)).map((r) => r.id),
      'he rang them himself, so it is not waiting for anybody',
    ).not.toContain(opportunityId);
  });

  it('still lists the leads nobody owns at all', async () => {
    const emir = await createTestUser({ role: 'owner', name: 'Emir' });
    const { opportunityId } = await makeLead('Nobody', 'website', null);

    const items = await incoming(await signIn(base, emir));
    expect(items.map((row) => row.id)).toContain(opportunityId);
    expect(items.find((row) => row.id === opportunityId)?.returnedAt).toBeNull();

    /* Nothing was broken by the new condition. */
    expect(await query('SELECT id FROM opportunities')).toHaveLength(1);
  });
});
