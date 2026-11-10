import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { execute, query, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * "Take all 45."
 *
 * An agent handed a batch of leads used to get one alert card per lead, and
 * the only way past a card was to open its lead. Emir, 10 Nov 2026: "it
 * continues open one by one notifications, even they cannot cancel, they need
 * to open the leads." Forty-five cards is forty-five clocks and a lost
 * morning, so the card counts them and this takes the lot in one press.
 */
let server: Server;
let base = '';

async function stageLead(ownerUserId: string | null, n: number): Promise<string> {
  const stage = await queryOne<{ id: string; pipeline_id: string }>(
    "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'new_lead' ORDER BY position LIMIT 1", [],
  );
  if (!stage) throw new Error('no new_lead stage: the test database was not seeded');
  const contactId = newId();
  const opportunityId = newId();
  await execute(
    'INSERT INTO contacts (id, full_name, phone_e164, language) VALUES (?, ?, ?, ?)',
    [contactId, `Lead ${n}`, `+9715${String(50_000_000 + n)}`, 'en'],
  );
  await execute(
    `INSERT INTO opportunities
       (id, contact_id, pipeline_id, stage_id, stage_key, status, source, title, owner_user_id,
        assigned_at, accepted_at)
     VALUES (?, ?, ?, ?, 'new_lead', 'open', 'meta_lead_ads', ?, ?, NOW(3), NULL)`,
    [opportunityId, contactId, stage.pipeline_id, stage.id, `Lead ${n}`, ownerUserId],
  );
  return opportunityId;
}

const pending = async (cookie: string) => {
  const res = await fetch(`${base}/api/incoming/pending`, { headers: { cookie } });
  return await res.json() as { total: number; items: { id: string }[] };
};

describeWithDb('taking a batch of leads in one press', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });
  beforeEach(async () => { await resetTables(); resetRateLimits(); });

  it('counts everything waiting, not just the few it lists', async () => {
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    for (let i = 0; i < 12; i += 1) await stageLead(tej.id, i);

    const body = await pending(await signIn(base, tej));
    expect(body.total, 'the card says "12 new leads"').toBe(12);
    expect(body.items.length, 'and still carries the details it needs').toBeGreaterThan(0);
  });

  it('takes them all and leaves nothing on the clock', async () => {
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    for (let i = 0; i < 12; i += 1) await stageLead(tej.id, i);
    const cookie = await signIn(base, tej);

    const res = await fetch(`${base}/api/incoming/accept-all`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 12, skipped: 0 });

    const left = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM opportunities WHERE owner_user_id = ? AND accepted_at IS NULL', [tej.id],
    );
    expect(Number(left?.n), 'no card comes back').toBe(0);
    expect((await pending(cookie)).total).toBe(0);
  });

  /* The rule it must not break: you can only accept your own leads. */
  it('never touches another agent’s leads', async () => {
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    const talha = await createTestUser({ role: 'agent', name: 'Talha' });
    for (let i = 0; i < 3; i += 1) await stageLead(tej.id, i);
    const theirs = await stageLead(talha.id, 99);

    await fetch(`${base}/api/incoming/accept-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await signIn(base, tej) },
      body: '{}',
    });

    const other = await queryOne<{ accepted_at: Date | null }>(
      'SELECT accepted_at FROM opportunities WHERE id = ?', [theirs],
    );
    expect(other?.accepted_at, 'Talha still has to take his own').toBeNull();
  });

  it('leaves the leads nobody owns alone', async () => {
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    const waiting = await stageLead(null, 7);

    const res = await fetch(`${base}/api/incoming/accept-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await signIn(base, tej) },
      body: '{}',
    });
    expect(await res.json()).toMatchObject({ accepted: 0 });

    const row = await queryOne<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?', [waiting],
    );
    expect(row?.owner_user_id, 'it is still in Incoming for a manager to place').toBeNull();
  });

  it('writes one audit line per lead taken', async () => {
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    for (let i = 0; i < 4; i += 1) await stageLead(tej.id, i);

    await fetch(`${base}/api/incoming/accept-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await signIn(base, tej) },
      body: '{}',
    });

    const lines = await query("SELECT id FROM audit_log WHERE action = 'lead.accepted'");
    expect(lines).toHaveLength(4);
  });

  it('says so plainly when there is nothing to take', async () => {
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    const res = await fetch(`${base}/api/incoming/accept-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: await signIn(base, tej) },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 0, skipped: 0 });
  });
});
