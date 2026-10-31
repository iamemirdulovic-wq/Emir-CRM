import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, query, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { addNote } from './notes.js';

/**
 * Writing a note moves a new lead to Attempted Contact — through the real
 * stage-move path, not a quiet UPDATE.
 *
 * The rules themselves are unit-tested in `note-stage.test.ts`. What this adds
 * is the part that matters to an agent arguing with a report later: the card
 * actually moved, the timeline says so, and the audit log has it. A stage that
 * changes with no trail is one nobody can question.
 */
describeWithDb('a note moves the lead, and leaves a trail', () => {
  beforeAll(prepareTestDatabase);
  afterAll(closeTestDatabase);
  beforeEach(resetTables);

  /* Owned, because that is the only way an agent can see it at all — and
     `validateMove` is right to refuse a card an agent does not hold. */
  async function lead(ownerId: string, stageKey = 'new_lead', status = 'open') {
    const stage = await queryOne<{ id: string; pipeline_id: string }>(
      'SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = ? LIMIT 1', [stageKey],
    );
    if (!stage) throw new Error(`no seeded stage ${stageKey}`);
    const contactId = newId();
    const opportunityId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Aisha Rahman', `+9715${Math.floor(Math.random() * 100000000)}`],
    );
    await execute(
      `INSERT INTO opportunities (id, contact_id, pipeline_id, stage_id, stage_key, status, source, owner_user_id)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?)`,
      [opportunityId, contactId, stage.pipeline_id, stage.id, stageKey, status, ownerId],
    );
    return { contactId, opportunityId };
  }

  const stageOf = async (id: string) => queryOne<{ stage_key: string; sub_status: string | null }>(
    'SELECT stage_key, sub_status FROM opportunities WHERE id = ?', [id],
  );

  it('moves a new lead the moment the agent writes what was said', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { contactId, opportunityId } = await lead(agent.id);

    const result = await addNote(
      { userId: agent.id, role: 'agent', label: 'Agent' },
      { contactId, opportunityId, body: 'Rang him, wants a 2BR under 2M, calling back Thursday.' },
    );

    expect(result.movedStage?.to).toBe('attempted_contact');
    expect(await stageOf(opportunityId)).toMatchObject({
      stage_key: 'attempted_contact', sub_status: 'attempt_1',
    });
  });

  it('writes the move onto the timeline and into the audit log', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { contactId, opportunityId } = await lead(agent.id);

    await addNote(
      { userId: agent.id, role: 'agent', label: 'Agent' },
      { contactId, opportunityId, body: 'No answer, tried twice.' },
    );

    const activities = await query<{ type: string }>(
      'SELECT type FROM activities WHERE contact_id = ?', [contactId],
    );
    expect(activities.length).toBeGreaterThan(0);

    const audit = await query<{ action: string }>(
      "SELECT action FROM audit_log WHERE action LIKE 'opportunity%' OR action LIKE '%stage%'", [],
    );
    expect(audit.length, 'the move must be audited like any other').toBeGreaterThan(0);
  });

  it('leaves a lead that is further along exactly where it is', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { contactId, opportunityId } = await lead(agent.id, 'appointment_scheduled');

    await addNote(
      { userId: agent.id, role: 'agent', label: 'Agent' },
      { contactId, opportunityId, body: 'Client called to confirm Saturday at 4.' },
    );

    expect((await stageOf(opportunityId))?.stage_key).toBe('appointment_scheduled');
  });

  it('does not move anything when the note is not on a lead', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { contactId } = await lead(agent.id);

    const result = await addNote(
      { userId: agent.id, role: 'agent', label: 'Agent' },
      { contactId, body: 'Met him at the Saadiyat sales centre.' },
    );
    expect(result.movedStage).toBeNull();
  });
});
