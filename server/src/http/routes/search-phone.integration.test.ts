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
 * Five digits off a missed-call screen must find the lead.
 *
 * Emir, 14 Nov, on the live site: he typed **99693** into the top search and
 * it said *"It is a new number"* — and offered to add the client as a new
 * lead. The client was already in the CRM, on +91 99693 42716. The next thing
 * an agent does with that answer is create a duplicate of somebody we are
 * already talking to.
 *
 * Two things were wrong and both are checked here, because either one on its
 * own brings the fault back:
 *
 *  1. The phone clause was only added at **six** digits or more, so five
 *     digits never asked about a phone number at all.
 *  2. It matched from the **right-hand end** (`LIKE '%…'`), so even six
 *     digits only found a number *ending* in them. "99693" is in the middle.
 *
 * Nobody types the end of a number. They type what they can see.
 */
let server: Server;
let base = '';

describeWithDb('finding a lead by part of their number', () => {
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

  /** One lead on one number, owned by this user. */
  async function lead(owner: string, name: string, phone: string) {
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, owner_user_id) VALUES (?, ?, ?, ?)',
      [contactId, name, phone, owner],
    );
    const stage = await firstStage();
    const opportunityId = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 'manual')`,
      [opportunityId, contactId, stage.pipeline_id, stage.id, stage.key, owner, name],
    );
    return { contactId, opportunityId };
  }

  interface Hit { id: string; label: string; to: string }

  async function search(term: string, cookie: string): Promise<Hit[]> {
    const res = await fetch(`${base}/api/search?q=${encodeURIComponent(term)}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { leads: Hit[] };
    return body.leads;
  }

  it('finds the lead from five digits in the middle of the number', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const made = await lead(agent.id, 'Prospective buyer', '+919969342716');
    const cookie = await signIn(base, agent);

    const hits = await search('99693', cookie);
    expect(hits.map((one) => one.id)).toEqual([made.opportunityId]);
  });

  it('finds it however much of the number was typed, and however it was spaced', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const made = await lead(agent.id, 'Prospective buyer', '+919969342716');
    const cookie = await signIn(base, agent);

    for (const typed of [
      '99693', '996934', '9969342716', '42716', '342716',
      '+91 99693 42716', '91 99693 42716', '99693 42716',
    ]) {
      const hits = await search(typed, cookie);
      expect(hits.map((one) => one.id), `searching "${typed}"`).toEqual([made.opportunityId]);
    }
  });

  it('still finds a UAE number in every shape it gets written in', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const made = await lead(agent.id, 'Dubai buyer', '+971501234567');
    const cookie = await signIn(base, agent);

    for (const typed of [
      '0501234567', '+971501234567', '971 50 123 4567', '050-123-4567', '(050) 123 4567',
      '00971501234567', '50123', '1234567',
      /* The country code and then a national zero, which people do write. */
      '+971 0 50 123 4567',
    ]) {
      const hits = await search(typed, cookie);
      expect(hits.map((one) => one.id), `searching "${typed}"`).toEqual([made.opportunityId]);
    }
  });

  it('sends the enquiry as well as the person, so the screen opens the right lead', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const made = await lead(agent.id, 'Prospective buyer', '+919969342716');
    const cookie = await signIn(base, agent);

    const [hit] = await search('99693', cookie);
    expect(hit?.to).toBe(`/contacts/${made.contactId}?lead=${made.opportunityId}`);
  });

  it('does not hand an agent somebody else’s client', async () => {
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });
    await lead(theirs.id, 'Not mine', '+919969342716');
    const cookie = await signIn(base, mine);

    expect(await search('99693', cookie)).toEqual([]);
  });

  it('does not treat a year as a phone number', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await lead(agent.id, 'Prospective buyer', '+971502026777');
    const cookie = await signIn(base, agent);

    /* Four digits is a handover year, not a number somebody read off a
       screen, and matching it would put half the CRM in the list. */
    expect(await search('2026', cookie)).toEqual([]);
  });

  it('finds a lead by name and by project, as it always did', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const made = await lead(agent.id, 'Prospective buyer', '+919969342716');
    await execute('UPDATE opportunities SET project_name = ? WHERE id = ?', ['Emaar Beachfront', made.opportunityId]);
    const cookie = await signIn(base, agent);

    expect((await search('Prospective', cookie)).map((one) => one.id)).toEqual([made.opportunityId]);
    expect((await search('beachfront', cookie)).map((one) => one.id)).toEqual([made.opportunityId]);
  });
});
