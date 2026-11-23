import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { saveSetting } from '../config/secrets.js';
import { assignLead } from './workflow-a.js';

/**
 * The owner hands out every lead.
 *
 * Emir asked for this on 21 November. The switch had been on the settings
 * page since the start and the code that hands out leads never read it: it
 * saved, it displayed, and the round-robin carried on regardless. These
 * tests exist so that cannot quietly become true again.
 */
describeWithDb('when the owner hands out every lead', () => {
  beforeAll(prepareTestDatabase);
  afterAll(closeTestDatabase);
  beforeEach(resetTables);

  const SYSTEM = { userId: null, role: 'automation' as const };

  async function newLead(ownerUserId: string | null = null) {
    const stage = await queryOne<{ id: string; pipeline_id: string }>(
      "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'new_lead' LIMIT 1",
    );
    if (!stage) throw new Error('no seeded New Lead stage');
    const contactId = newId();
    const opportunityId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, owner_user_id) VALUES (?, ?, ?, ?)',
      [contactId, 'Walk-in Buyer', `+9715${Math.floor(Math.random() * 100000000)}`, ownerUserId],
    );
    await execute(
      `INSERT INTO opportunities (id, contact_id, pipeline_id, stage_id, stage_key, status, source, owner_user_id)
       VALUES (?, ?, ?, ?, 'new', 'open', 'manual', ?)`,
      [opportunityId, contactId, stage.pipeline_id, stage.id, ownerUserId],
    );
    return { opportunityId, contactId };
  }

  it('gives a new lead to nobody, and says why', async () => {
    await saveSetting(SYSTEM, 'ROUTING_AUTO_ASSIGN', '0');
    await createTestUser({ role: 'agent' });
    const { opportunityId, contactId } = await newLead();

    const out = await assignLead(opportunityId, contactId);
    expect(out.userId).toBeNull();
    expect(out.reason).toBe('owner_hands_out');

    const row = await queryOne<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?', [opportunityId],
    );
    expect(row?.owner_user_id).toBeNull();
  });

  it('puts it in Incoming rather than dropping it', async () => {
    await saveSetting(SYSTEM, 'ROUTING_AUTO_ASSIGN', '0');
    await createTestUser({ role: 'agent' });
    const { opportunityId, contactId } = await newLead();
    await assignLead(opportunityId, contactId);

    const queued = await queryOne<{ reason: string }>(
      'SELECT reason FROM unassigned_queue WHERE opportunity_id = ? AND resolved_at IS NULL',
      [opportunityId],
    );
    expect(queued?.reason).toBe('owner_hands_out');
  });

  it('holds a returning lead too, instead of sending it to their old agent', async () => {
    /*
     * Emir's own call: "to you first, like every other lead". Sticky owner is
     * the one rule that would otherwise route around the whole mode, and a
     * returning buyer is exactly who trips it.
     */
    await saveSetting(SYSTEM, 'ROUTING_AUTO_ASSIGN', '0');
    const agent = await createTestUser({ role: 'agent' });
    const { opportunityId, contactId } = await newLead(agent.id);

    const out = await assignLead(opportunityId, contactId);
    expect(out.reason).toBe('owner_hands_out');
    expect(out.userId).toBeNull();

    /* The answer said nobody while the row still said the old agent: ingestion
       had written them on, and the lead never reached Incoming (Nov 23, 2026). */
    const row = await queryOne<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?', [opportunityId],
    );
    expect(row?.owner_user_id).toBeNull();
  });

  it('still hands out by itself when the switch is back on', async () => {
    await saveSetting(SYSTEM, 'ROUTING_AUTO_ASSIGN', '1');
    await createTestUser({ role: 'agent' });
    const { opportunityId, contactId } = await newLead();

    const out = await assignLead(opportunityId, contactId);
    expect(out.reason).not.toBe('owner_hands_out');
  });
});
