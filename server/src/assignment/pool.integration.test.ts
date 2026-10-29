import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { newId } from '../lib/ids.js';
import { SYSTEM_ACTOR } from '../audit/audit.js';
import { claimNextLead, poolStatus, recycleStaleClaims, releaseClaim } from './apply.js';

const actor = (userId: string) => ({ ...SYSTEM_ACTOR, userId, role: 'agent' as const });

/** An unowned open lead, i.e. one sitting in the shared pool. */
async function createPooledLead(name: string): Promise<{ contactId: string; opportunityId: string }> {
  const contactId = newId();
  const opportunityId = newId();
  await execute(
    `INSERT INTO contacts (id, full_name, phone_e164, language, first_source)
     VALUES (?, ?, ?, 'en', 'csv_import')`,
    [contactId, name, `+9715${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`],
  );
  const stage = await query<{ id: string; pipeline_id: string }>(
    "SELECT s.id, s.pipeline_id FROM pipeline_stages s WHERE s.`key` = 'new_lead' LIMIT 1",
  );
  await execute(
    `INSERT INTO opportunities (id, contact_id, pipeline_id, stage_id, stage_key, status, title, source, created_at, stage_changed_at)
     VALUES (?, ?, ?, ?, 'new_lead', 'open', ?, 'csv_import', NOW(3), NOW(3))`,
    [opportunityId, contactId, stage[0]?.pipeline_id, stage[0]?.id, name],
  );
  return { contactId, opportunityId };
}

describeWithDb('the shared lead pool', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
  });

  it('gives an agent the oldest waiting lead', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const first = await createPooledLead('First In');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await createPooledLead('Second In');

    const claimed = await claimNextLead(actor(agent.id), agent.id);
    expect(claimed?.opportunityId).toBe(first.opportunityId);
    expect(claimed?.fullName).toBe('First In');
  });

  it('returns nothing when the pool is empty', async () => {
    const agent = await createTestUser({ role: 'agent' });
    expect(await claimNextLead(actor(agent.id), agent.id)).toBeNull();
  });

  /**
   * The race that matters. Two agents pressing "Claim next lead" at the same
   * instant must not both get the same person — nothing annoys a lead faster
   * than two calls from the same agency in one minute.
   */
  it('never hands the same lead to two agents at once', async () => {
    const agents = await Promise.all(
      Array.from({ length: 5 }, (_unused, i) => createTestUser({ role: 'agent', name: `Agent ${i}` })),
    );
    for (let i = 0; i < 5; i++) await createPooledLead(`Lead ${i}`);

    const claims = await Promise.all(agents.map((agent) => claimNextLead(actor(agent.id), agent.id)));

    const ids = claims.map((claim) => claim?.opportunityId).filter(Boolean);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);

    const openClaims = await query('SELECT id FROM lead_pool_claims WHERE released_at IS NULL');
    expect(openClaims).toHaveLength(5);
  });

  it('hands out no more than the pool holds, however many agents ask', async () => {
    const agents = await Promise.all(
      Array.from({ length: 6 }, (_unused, i) => createTestUser({ role: 'agent', name: `Agent ${i}` })),
    );
    await createPooledLead('Only One');

    const claims = await Promise.all(agents.map((agent) => claimNextLead(actor(agent.id), agent.id)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('stops an agent hoarding past the claim limit', async () => {
    const agent = await createTestUser({ role: 'agent' });
    for (let i = 0; i < 3; i++) await createPooledLead(`Lead ${i}`);

    await claimNextLead(actor(agent.id), agent.id, { maxOpenClaims: 2 });
    await claimNextLead(actor(agent.id), agent.id, { maxOpenClaims: 2 });

    await expect(claimNextLead(actor(agent.id), agent.id, { maxOpenClaims: 2 })).rejects.toThrow(/claimed leads/i);
  });

  it('takes the lead out of the pool once it is claimed', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await createPooledLead('One');

    expect((await poolStatus(agent.id)).available).toBe(1);
    await claimNextLead(actor(agent.id), agent.id);

    const status = await poolStatus(agent.id);
    expect(status.available).toBe(0);
    expect(status.claimedByYou).toBe(1);
  });

  it('puts a released lead back for someone else', async () => {
    const first = await createTestUser({ role: 'agent', name: 'First' });
    const second = await createTestUser({ role: 'agent', name: 'Second' });
    const lead = await createPooledLead('Shared');

    await claimNextLead(actor(first.id), first.id);
    expect(await claimNextLead(actor(second.id), second.id)).toBeNull();

    await releaseClaim(actor(first.id), lead.opportunityId, first.id);
    expect((await claimNextLead(actor(second.id), second.id))?.opportunityId).toBe(lead.opportunityId);
  });

  it('recycles a claim nobody has touched', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await createPooledLead('Forgotten');
    await claimNextLead(actor(agent.id), agent.id);

    await execute('UPDATE lead_pool_claims SET claimed_at = DATE_SUB(NOW(3), INTERVAL 10 DAY)');

    expect(await recycleStaleClaims(3)).toBe(1);
    const owners = await query<{ owner_user_id: string | null }>('SELECT owner_user_id FROM opportunities');
    expect(owners[0]?.owner_user_id).toBeNull();
  });

  it('keeps a claim the agent has actually worked', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await createPooledLead('Being Worked');
    const claimed = await claimNextLead(actor(agent.id), agent.id);

    await execute('UPDATE lead_pool_claims SET claimed_at = DATE_SUB(NOW(3), INTERVAL 10 DAY)');
    // First touch is the same standard the speed-to-lead SLA uses.
    await execute('UPDATE opportunities SET first_touch_at = NOW(3) WHERE id = ?', [claimed?.opportunityId]);

    expect(await recycleStaleClaims(3)).toBe(0);
    const owners = await query<{ owner_user_id: string | null }>('SELECT owner_user_id FROM opportunities');
    expect(owners[0]?.owner_user_id).toBe(agent.id);
  });

  it('writes an audit entry for every claim', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await createPooledLead('Audited');
    await claimNextLead(actor(agent.id), agent.id);

    const entries = await query<{ action: string }>("SELECT action FROM audit_log WHERE action = 'lead.claimed'");
    expect(entries).toHaveLength(1);
  });
});
