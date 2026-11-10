import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, query, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { SYSTEM_ACTOR } from '../audit/audit.js';
import { ingestLead } from '../ingestion/ingest.js';
import { normalizeLead } from '../ingestion/normalize.js';
import { clearAllLeads, countLeadData, leadTablesStillHolding } from './clear-all.js';

/**
 * Emptying the CRM of leads.
 *
 * Two things have to be true, and the second is the one that bites: every
 * table holding lead data must be empty afterwards, and nothing else may be
 * touched. The first test reads information_schema rather than a list written
 * here, so a table added next month is covered on the day it is added.
 */
describeWithDb('clearing every lead', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); });

  /** A lead with as much hanging off it as a real one has. */
  async function aLeadWithEverything(n: number, ownerUserId: string) {
    const ingested = await ingestLead(normalizeLead({
      source: 'website',
      externalId: `clear-test-${n}`,
      mapped: {
        full_name: `Person ${n}`,
        phone: `+9715012345${String(10 + n).slice(-2)}`,
        email: `person${n}@example.com`,
        project: 'Emaar Beachfront',
      },
      receivedAt: new Date(),
    }));
    const { contactId, opportunityId } = ingested;

    await execute('UPDATE opportunities SET owner_user_id = ? WHERE id = ?', [ownerUserId, opportunityId]);
    await execute(
      `INSERT INTO activities (id, contact_id, opportunity_id, user_id, type, title)
       VALUES (?, ?, ?, ?, 'call', 'Rang them')`,
      [newId(), contactId, opportunityId, ownerUserId],
    );
    await execute(
      `INSERT INTO tasks (id, contact_id, opportunity_id, assigned_user_id, type, title, due_at, created_by_user_id)
       VALUES (?, ?, ?, ?, 'call', 'Call back', NOW(3), ?)`,
      [newId(), contactId, opportunityId, ownerUserId, ownerUserId],
    );
    await execute(
      `INSERT INTO notifications (id, user_id, type, title, contact_id, opportunity_id)
       VALUES (?, ?, 'lead_assigned', 'New lead for you', ?, ?)`,
      [newId(), ownerUserId, contactId, opportunityId],
    );
    await execute(
      `INSERT INTO lead_assignments (id, opportunity_id, contact_id, agent_user_id)
       VALUES (?, ?, ?, ?)`,
      [newId(), opportunityId, contactId, ownerUserId],
    );
    await execute(
      `INSERT INTO jobs (id, type, payload, contact_id)
       VALUES (?, 'lead.score', ?, ?)`,
      [newId(), JSON.stringify({ opportunityId }), contactId],
    );
    return ingested;
  }

  it('leaves no row in any table that holds lead data', async () => {
    const owner = await createTestUser({ role: 'owner' });
    for (let i = 0; i < 5; i += 1) await aLeadWithEverything(i, owner.id);

    const before = await countLeadData();
    expect(before.contacts).toBe(5);
    expect(before.opportunities).toBe(5);

    await clearAllLeads({ ...SYSTEM_ACTOR, userId: owner.id });

    /*
     * Read back from information_schema, not from a list in this file: the
     * check has to find a table somebody adds later without anybody
     * remembering to update it here.
     */
    const left = await leadTablesStillHolding();
    expect(left, `still holding rows: ${JSON.stringify(left)}`).toEqual([]);
  });

  it('keeps the people, the projects and the settings', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    await aLeadWithEverything(1, agent.id);

    const projectId = newId();
    await execute(
      `INSERT INTO projects (id, slug, name, developer, emirate, sale_status)
       VALUES (?, ?, 'Emaar Beachfront', 'Emaar', 'dubai', 'selling_now')`,
      [projectId, `beachfront-${projectId.slice(0, 8)}`],
    );

    await clearAllLeads({ ...SYSTEM_ACTOR, userId: owner.id });

    const users = await query('SELECT id FROM users');
    expect(users.length, 'the team is still here').toBe(2);
    const project = await queryOne<{ id: string }>('SELECT id FROM projects WHERE id = ?', [projectId]);
    expect(project?.id, 'and the project library').toBe(projectId);
  });

  it('writes an audit line, with what was there and that it cannot be undone', async () => {
    const owner = await createTestUser({ role: 'owner' });
    for (let i = 0; i < 3; i += 1) await aLeadWithEverything(i, owner.id);

    await clearAllLeads({ ...SYSTEM_ACTOR, userId: owner.id });

    const row = await queryOne<{
      before_json: { contacts?: number }; after_json: { recoverable?: boolean };
    }>("SELECT before_json, after_json FROM audit_log WHERE action = 'leads.cleared'", []);
    expect(row?.before_json?.contacts, 'how many there were').toBe(3);
    expect(row?.after_json?.recoverable, 'and that there is no way back').toBe(false);
  });

  /*
   * The reason this is a hard delete. A soft one leaves the row, and
   * `reviveIfDeleted` brings the contact back on the next enquiry with the
   * old name still on it — which is the exact fault Emir is clearing.
   */
  it('lets the same number come back as a brand new person', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const first = await ingestLead(normalizeLead({
      source: 'csv_import',
      externalId: 'wrong-name',
      mapped: { full_name: 'Alfio Mercia', phone: '+971502533033' },
      receivedAt: new Date(),
    }));
    expect(first.isNewContact).toBe(true);

    await clearAllLeads({ ...SYSTEM_ACTOR, userId: owner.id });

    const again = await ingestLead(normalizeLead({
      source: 'csv_import',
      externalId: 'right-name',
      mapped: { full_name: 'Ali Arshad', phone: '+971502533033' },
      receivedAt: new Date(),
    }));
    expect(again.isNewContact, 'a fresh record, not the old one revived').toBe(true);
    expect(again.contactId).not.toBe(first.contactId);

    const contact = await queryOne<{ full_name: string }>(
      'SELECT full_name FROM contacts WHERE id = ?', [again.contactId],
    );
    expect(contact?.full_name, 'the corrected name, not the one it replaced').toBe('Ali Arshad');
  });

  it('is happy on an empty CRM', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const removed = await clearAllLeads({ ...SYSTEM_ACTOR, userId: owner.id });
    expect(removed.contacts).toBe(0);
    expect(await leadTablesStillHolding()).toEqual([]);
  });

  it('takes the sales offers with it', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const lead = await aLeadWithEverything(1, owner.id);
    const offerId = newId();
    await execute(
      `INSERT INTO offers (id, slug, title, agent_user_id, contact_id, opportunity_id, language)
       VALUES (?, ?, 'For Person 1', ?, ?, ?, 'en')`,
      [offerId, `slug-${offerId.slice(0, 8)}`, owner.id, lead.contactId, lead.opportunityId],
    );

    await clearAllLeads({ ...SYSTEM_ACTOR, userId: owner.id });

    const offers = await query('SELECT id FROM offers');
    expect(offers, 'Emir chose to clear these too').toHaveLength(0);
  });
});
