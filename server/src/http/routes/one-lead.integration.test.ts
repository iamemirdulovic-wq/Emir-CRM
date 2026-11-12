import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
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
 * One lead, for the v2 lead page.
 *
 * The route is `/:id`, which is the most dangerous shape a route can have: it
 * matches anything. Declared above `/counts` it would swallow it, and the
 * counts endpoint would return "that lead is not yours" for ever while every
 * tab quietly showed no number. Nothing would throw. The first test here
 * exists for that and nothing else.
 */
let server: Server;
let base = '';

describeWithDb('one lead', () => {
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
  afterEach(() => resetRateLimits());

  async function aLead(owner: string): Promise<{ id: string; contactId: string }> {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, email) VALUES (?, ?, ?, ?)',
      [contactId, 'Marco Bellini', '+393331234567', 'marco@example.com'],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source, project_name)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'Marco', 'manual', 'Valia by Emaar')`,
      [id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner],
    );
    return { id, contactId };
  }

  const get = (path: string, cookie: string) => fetch(`${base}${path}`, { headers: { cookie } });

  it('does not swallow /counts', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const res = await get('/api/my-leads/counts', cookie);

    expect(res.status, 'counts must still be counts, not a lead called "counts"').toBe(200);
    const body = await res.json() as Record<string, number>;
    /* A tab list, not a lead record. */
    expect(body).toHaveProperty('today');
    expect(body).toHaveProperty('all');
    expect(body).not.toHaveProperty('lead');
  });

  it('gives the lead and the person together', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { id } = await aLead(agent.id);
    const cookie = await signIn(base, agent);

    const res = await get(`/api/my-leads/${id}`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);

    const body = await res.json() as {
      lead: { id: string; project_name: string; phone_e164: string };
      contact: { full_name: string };
      activities: unknown[];
    };
    expect(body.lead.id).toBe(id);
    expect(body.lead.project_name).toBe('Valia by Emaar');
    expect(body.lead.phone_e164).toBe('+393331234567');
    /* Both halves in one answer: the page needs them together, and two
       requests for one screen is two chances for half of it to arrive. */
    expect(body.contact.full_name).toBe('Marco Bellini');
    expect(Array.isArray(body.activities)).toBe(true);
  });

  it('refuses another agent’s lead', async () => {
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });
    const { id } = await aLead(theirs.id);

    const res = await get(`/api/my-leads/${id}`, await signIn(base, mine));
    expect(res.status, 'an agent must not read a colleague’s lead').not.toBe(200);
  });

  it('lets an owner open any lead', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const { id } = await aLead(agent.id);

    const res = await get(`/api/my-leads/${id}`, await signIn(base, boss));
    expect(res.status).toBe(200);
  });

  it('says so plainly when the lead is gone', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const res = await get(`/api/my-leads/${newId()}`, await signIn(base, agent));
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(500);
  });
});
