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
 * If a lead is in your list, you can open it.
 *
 * Reported from the live CRM, with screenshots: the only agent on the team saw
 * a lead on My Leads and got **"This lead belongs to another agent"** when he
 * tapped it. Both answers came from the server and they contradicted each
 * other, because they asked different questions —
 *
 *   the list:  does the agent own the OPPORTUNITY?   (`opportunities.owner_user_id`)
 *   the page:  does the agent own the CONTACT?       (`contacts.owner_user_id`)
 *
 * Those two are the same right up until they are not. The contact's owner is
 * deliberately sticky — "a returning lead stays with their existing agent" —
 * so once a person exists in the CRM, a later enquiry assigned to somebody
 * else moves the opportunity and leaves the contact where it was. Every way
 * of assigning a lead can produce it, and `add-lead` says so in SQL:
 * `UPDATE contacts SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL`.
 *
 * The person is shared; the enquiry is assigned. So owning either one is
 * enough to open the page, and these tests hold the two answers together.
 */
let server: Server;
let base = '';

describeWithDb('a lead you can see is a lead you can open', () => {
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

  beforeEach(async () => {
    await resetTables();
    resetRateLimits();
  });
  afterEach(() => resetRateLimits());

  async function firstStage() {
    const row = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1', [],
    );
    if (!row) throw new Error('no seeded pipeline stages');
    return row;
  }

  /** A person owned by one user, with an enquiry assigned to another. */
  async function splitOwnershipLead(contactOwner: string | null, opportunityOwner: string) {
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, owner_user_id) VALUES (?, ?, ?, ?)',
      [contactId, 'Emir Dulovic', `+9715${Math.floor(Math.random() * 100000000)}`, contactOwner],
    );
    const stage = await firstStage();
    const opportunityId = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'New world map', 'manual')`,
      [opportunityId, contactId, stage.pipeline_id, stage.id, stage.key, opportunityOwner],
    );
    return { contactId, opportunityId };
  }

  const get = (path: string, cookie: string) => fetch(`${base}${path}`, { headers: { cookie } });

  it('opens a lead whose contact row belongs to the owner, not the agent', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir' });
    const agent = await createTestUser({ role: 'agent', name: 'Tejeshwar Singh Solanki' });
    const { contactId } = await splitOwnershipLead(boss.id, agent.id);
    const cookie = await signIn(base, agent);

    /* It is on his list — this part was never broken. */
    const list = await (await get('/api/my-leads?tab=all', cookie)).json() as { items: { id: string }[] };
    expect(list.items).toHaveLength(1);

    /* And the page it links to must open. */
    expect((await get(`/api/contacts/${contactId}`, cookie)).status).toBe(200);
  });

  it('opens a lead whose contact has no owner at all', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { contactId } = await splitOwnershipLead(null, agent.id);
    const cookie = await signIn(base, agent);

    expect((await get(`/api/contacts/${contactId}`, cookie)).status).toBe(200);
  });

  it('lets him work the lead, not just look at it', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const { contactId } = await splitOwnershipLead(boss.id, agent.id);
    const cookie = await signIn(base, agent);

    /* The notes panel and the timeline hang off the same check, so a lead he
       cannot write a note on is a lead he cannot work. */
    const note = await fetch(`${base}/api/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Called, asked for the payment plan.' }),
    });
    expect(note.status).toBeLessThan(300);
  });

  it('still keeps another agent out', async () => {
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });
    const { contactId } = await splitOwnershipLead(theirs.id, theirs.id);
    const cookie = await signIn(base, mine);

    expect((await get(`/api/contacts/${contactId}`, cookie)).status).toBe(403);
  });

  it('keeps an agent out of a contact nobody owns and nobody has an enquiry for', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, owner_user_id) VALUES (?, ?, ?, NULL)',
      [contactId, 'Nobody at all', '+971500000111'],
    );
    const cookie = await signIn(base, agent);

    expect((await get(`/api/contacts/${contactId}`, cookie)).status).toBe(403);
  });
});
