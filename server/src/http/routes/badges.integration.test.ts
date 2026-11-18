import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { execute, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * The Follow-ups badge counts what the Follow-ups tab lists.
 *
 * The v2 test on 16 Nov 2026 found the sidebar saying 136 over a Follow-ups
 * tab that said 0: the badge was the leads list's Overdue count (leads whose
 * next step had passed), while the tab lists the caller's own open tasks
 * against a lead. A badge that disagrees with its page is worse than none.
 */
let server: Server;
let base = '';

describeWithDb('the sidebar badges', () => {
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

  async function aLead(owner: string): Promise<{ id: string; contactId: string }> {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Omar Khalil', `+97150${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`],
    );
    const id = newId();
    /* Its next step passed yesterday: the leads list calls it Overdue. */
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status,
          title, source, next_step_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'Omar', 'manual', NOW(3) - INTERVAL 1 DAY)`,
      [id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner],
    );
    return { id, contactId };
  }

  async function badges(cookie: string): Promise<Record<string, number>> {
    const res = await fetch(`${base}/api/v2/badges`, { headers: { cookie } });
    expect(res.status).toBe(200);
    return await res.json() as Record<string, number>;
  }

  it('counts overdue follow-up tasks, not leads with a passed next step', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    await aLead(agent.id);

    /* Two leads overdue on the list, and not one follow-up promised. */
    expect((await badges(cookie)).followups).toBe(0);

    const task = (title: string, dueHours: number, opportunityId: string | null, done = false) => execute(
      `INSERT INTO tasks (id, type, title, due_at, assigned_user_id, contact_id, opportunity_id, completed_at)
       VALUES (?, 'call', ?, NOW(3) + INTERVAL ? HOUR, ?, ?, ?, ?)`,
      [newId(), title, dueHours, agent.id, opportunityId ? lead.contactId : null, opportunityId,
        done ? new Date() : null],
    );
    await task('Ring Omar back', -2, lead.id);          // counted
    await task('Ring Omar tomorrow', 20, lead.id);      // not overdue yet
    await task('Already rang', -3, lead.id, true);      // done
    await task('Paperwork', -2, null);                  // not a follow-up

    const after = await badges(cookie);
    expect(after.followups).toBe(1);
    /* Tasks still counts every overdue open task of mine, lead or not. */
    expect(after.tasks).toBe(2);
  });
});
