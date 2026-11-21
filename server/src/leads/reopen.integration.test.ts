import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { runLeadAction } from './actions.js';

/**
 * An action that puts a closed lead back in an open stage reopens it.
 *
 * "Interested" on a Lost lead moved its stage and left its status Lost, so
 * the Pipeline board drew it in an open column while the dashboard counted it
 * Lost: 2,038 open against 2,037 in the v2 test of 16 Nov 2026.
 */
describeWithDb('a closed lead moved back to an open stage', () => {
  beforeAll(prepareTestDatabase);
  afterAll(closeTestDatabase);
  beforeEach(resetTables);

  async function lostLead(ownerId: string): Promise<string> {
    const stage = await queryOne<{ id: string; pipeline_id: string }>(
      "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'lost' LIMIT 1",
    );
    if (!stage) throw new Error('no seeded Lost stage');
    const contactId = newId();
    const id = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Aisha Rahman', `+9715${Math.floor(Math.random() * 100000000)}`],
    );
    await execute(
      `INSERT INTO opportunities (id, contact_id, pipeline_id, stage_id, stage_key, status, closed_at, source, owner_user_id)
       VALUES (?, ?, ?, ?, 'lost', 'lost', NOW(3), 'manual', ?)`,
      [id, contactId, stage.pipeline_id, stage.id, ownerId],
    );
    return id;
  }

  it('is open again, so the board and the dashboard count it the same way', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const id = await lostLead(agent.id);

    await runLeadAction(
      { userId: agent.id, role: 'agent', label: 'Agent' },
      { opportunityId: id, action: 'interested' },
    );

    const row = await queryOne<{ stage_key: string; status: string; closed_at: Date | null }>(
      'SELECT stage_key, status, closed_at FROM opportunities WHERE id = ?', [id],
    );
    expect(row).toMatchObject({ stage_key: 'engaged_qualified', status: 'open', closed_at: null });
  });

  it('pressing Lost again restores the lead to the stage it had before (Nov 19, 2026)', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const id = await lostLead(agent.id);
    await execute(
      "UPDATE opportunities SET stage_key = 'engaged_qualified', status = 'open', closed_at = NULL WHERE id = ?",
      [id],
    );
    const actor = { userId: agent.id, role: 'agent', label: 'Agent' } as const;

    await runLeadAction(actor, { opportunityId: id, action: 'lost', reason: 'not_interested' });
    const result = await runLeadAction(actor, { opportunityId: id, action: 'reopen' });

    expect(result).toMatchObject({ stageKey: 'engaged_qualified', status: 'open' });
    const row = await queryOne<{ stage_key: string; status: string; closed_at: Date | null }>(
      'SELECT stage_key, status, closed_at FROM opportunities WHERE id = ?', [id],
    );
    expect(row).toMatchObject({ stage_key: 'engaged_qualified', status: 'open', closed_at: null });
    await expect(runLeadAction(actor, { opportunityId: id, action: 'reopen' })).rejects.toThrow(/Only a Lost lead/);
  });
});
