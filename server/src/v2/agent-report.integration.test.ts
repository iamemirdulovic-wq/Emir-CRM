import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { agentReport } from './agent-report.js';

/**
 * One person's month.
 *
 * Every assertion here is really about one thing: that the SQL runs. Two of
 * these queries were written against column names this database does not
 * have — `leave_requests.starts_on`, `unassigned_queue.taken_from_user_id` —
 * and TypeScript was perfectly happy with both. A report that quietly says
 * "Leave 0" for a person who took a week off is worse than no report, because
 * somebody will act on it.
 */
describeWithDb('an agent report', () => {
  beforeAll(prepareTestDatabase);
  afterAll(closeTestDatabase);
  beforeEach(resetTables);

  const FROM = '2026-11-01';
  const TO = '2026-11-30';

  async function leadFor(userId: string | null) {
    const stage = await queryOne<{ id: string; pipeline_id: string }>(
      "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'new_lead' LIMIT 1",
    );
    const contactId = newId();
    const opportunityId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Report Buyer', `+9715${Math.floor(Math.random() * 100000000)}`],
    );
    await execute(
      `INSERT INTO opportunities (id, contact_id, pipeline_id, stage_id, stage_key, status, source, owner_user_id)
       VALUES (?, ?, ?, ?, 'new_lead', 'open', 'manual', ?)`,
      [opportunityId, contactId, stage?.pipeline_id, stage?.id, userId],
    );
    return { opportunityId, contactId };
  }

  it('runs every query, which is the whole point of this test', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const report = await agentReport(agent.id, FROM, TO);

    expect(report).not.toBeNull();
    expect(report?.person.id).toBe(agent.id);
    expect(report?.attendance.openDays).toBeGreaterThan(0);
  });

  it('counts approved leave, through the columns this database actually has', async () => {
    /* `from_date` and `to_date`. Written as `starts_on`/`ends_on` first,
       which threw, and the throw was swallowed into a zero. */
    const agent = await createTestUser({ role: 'agent' });
    await execute(
      `INSERT INTO leave_requests (id, user_id, kind, from_date, to_date, working_days, status)
       VALUES (?, ?, 'annual', '2026-11-10', '2026-11-12', 3, 'approved')`,
      [newId(), agent.id],
    );
    const report = await agentReport(agent.id, FROM, TO);
    expect(report?.attendance.leave).toBe(1);
  });

  it('counts a lead taken back off this agent, not off the person it went to', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { opportunityId, contactId } = await leadFor(agent.id);
    await execute(
      `INSERT INTO lead_assignments (id, opportunity_id, contact_id, agent_user_id, outcome, assigned_at)
       VALUES (?, ?, ?, ?, 'bounced', '2026-11-14 09:00:00')`,
      [newId(), opportunityId, contactId, agent.id],
    );
    const report = await agentReport(agent.id, FROM, TO);
    expect(report?.leads.takenBack).toBe(1);
  });

  it('counts calls, and the ones made while not checked in', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { opportunityId, contactId } = await leadFor(agent.id);
    await execute(
      `INSERT INTO call_logs (id, opportunity_id, contact_id, user_id, started_at, outcome, not_checked_in)
       VALUES (?, ?, ?, ?, '2026-11-14 09:00:00', 'no_answer', 0),
              (?, ?, ?, ?, '2026-11-14 10:00:00', 'interested', 1)`,
      [
        newId(), opportunityId, contactId, agent.id,
        newId(), opportunityId, contactId, agent.id,
      ],
    );
    const report = await agentReport(agent.id, FROM, TO);
    expect(report?.calls.total).toBe(2);
    expect(report?.calls.notCheckedIn).toBe(1);
    expect(report?.calls.byOutcome.map((o) => o.outcome).sort())
      .toEqual(['interested', 'no_answer']);
  });

  it('says a lead was never called, which is the number worth acting on', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await leadFor(agent.id);
    const report = await agentReport(agent.id, FROM, TO);
    expect(report?.leads.open).toBe(1);
    expect(report?.leads.neverCalled).toBe(1);
  });

  it('reports last seen working, since this CRM records no leaving time', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { opportunityId, contactId } = await leadFor(agent.id);
    /* 14:30 UTC is 18:30 in Dubai, and the report is in Dubai time. */
    await execute(
      `INSERT INTO call_logs (id, opportunity_id, contact_id, user_id, started_at)
       VALUES (?, ?, ?, ?, '2026-11-14 14:30:00')`,
      [newId(), opportunityId, contactId, agent.id],
    );
    const report = await agentReport(agent.id, FROM, TO);
    const day = report?.attendance.days.find((d) => d.date === '2026-11-14');
    expect(day?.lastSeen).toBe('18:30');
    expect(report?.attendance.usualLastSeen).toBe('18:30');
  });

  it('is nothing at all for a person who does not exist', async () => {
    expect(await agentReport(newId(), FROM, TO)).toBeNull();
  });
});
