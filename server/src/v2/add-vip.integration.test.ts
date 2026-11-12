import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { queryOne } from '../db/client.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';

/**
 * Adding a lead and giving it as VIP.
 *
 * The rules worth holding: only an owner may do it, it must go to somebody by
 * name, and the deadline is real. A VIP lead that quietly became an ordinary
 * one would be the worst outcome of all — the owner would believe a named
 * person was answerable for it when nobody was.
 */
let server: Server;
let base = '';

describeWithDb('add a VIP lead', () => {
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

  const add = (cookie: string, body: Record<string, unknown>) =>
    fetch(`${base}/api/leads`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Sheikh Khalid', phone: '+971505550101', source: 'referral', ...body,
      }),
    });

  it('gives it to the agent, with the clock the owner chose', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const agent = await createTestUser({ role: 'agent', name: 'Rocky' });

    const res = await add(await signIn(base, boss), {
      assignToUserId: agent.id,
      isVip: true,
      callWithinMinutes: 30,
      privateNote: 'Friend of the family. Call him yourself.',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { opportunityId } = await res.json() as { opportunityId: string };

    const lead = await queryOne<{ is_vip: number }>(
      'SELECT is_vip FROM opportunities WHERE id = ?', [opportunityId],
    );
    expect(lead?.is_vip).toBe(1);

    const handoff = await queryOne<{
      given_by: string; given_to: string; call_within_minutes: number;
      deadline_at: Date; private_note: string;
    }>('SELECT given_by, given_to, call_within_minutes, deadline_at, private_note FROM vip_handoffs WHERE opportunity_id = ?',
      [opportunityId]);

    expect(handoff?.given_by).toBe(boss.id);
    expect(handoff?.given_to).toBe(agent.id);
    expect(handoff?.call_within_minutes).toBe(30);
    expect(handoff?.private_note).toContain('Friend of the family');

    const minutes = (new Date(String(handoff?.deadline_at)).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(28);
    expect(minutes).toBeLessThan(32);
  });

  it('"today" means the end of the day in Dubai', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });

    const res = await add(await signIn(base, boss), {
      assignToUserId: agent.id, isVip: true, callWithinMinutes: null,
    });
    const { opportunityId } = await res.json() as { opportunityId: string };

    const handoff = await queryOne<{ deadline_at: Date; call_within_minutes: number | null }>(
      'SELECT deadline_at, call_within_minutes FROM vip_handoffs WHERE opportunity_id = ?',
      [opportunityId],
    );
    expect(handoff?.call_within_minutes).toBeNull();

    /* Midnight in Dubai is 20:00 UTC. Whatever today's date, the deadline
       lands on that hour — which is the thing a UTC-based "end of day" would
       get wrong by four hours. */
    const at = new Date(String(handoff?.deadline_at));
    expect(at.getUTCHours()).toBe(20);
    expect(at.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a VIP lead with nobody to give it to', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const res = await add(await signIn(base, boss), { isVip: true, callWithinMinutes: 15 });
    expect(res.status).toBe(400);
  });

  it('an agent cannot make a lead VIP', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const res = await add(await signIn(base, agent), { isVip: true, callWithinMinutes: 15 });
    expect(res.status).toBe(403);
  });

  it('an ordinary lead is untouched by any of it', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });

    const res = await add(await signIn(base, boss), { assignToUserId: agent.id });
    expect(res.status).toBe(201);
    const { opportunityId } = await res.json() as { opportunityId: string };

    const lead = await queryOne<{ is_vip: number }>(
      'SELECT is_vip FROM opportunities WHERE id = ?', [opportunityId],
    );
    expect(lead?.is_vip).toBe(0);
    const handoff = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM vip_handoffs WHERE opportunity_id = ?', [opportunityId],
    );
    expect(Number(handoff?.n)).toBe(0);
  });

  it('keeps the extra ways to reach them, and every language they speak', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const res = await add(await signIn(base, boss), {
      telegram: '@khalid', languages: ['ar', 'en', 'ru'],
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const { contactId } = await res.json() as { contactId: string };

    const contact = await queryOne<{ telegram: string; language: string }>(
      'SELECT telegram, language FROM contacts WHERE id = ?', [contactId],
    );
    expect(contact?.telegram).toBe('@khalid');
    /* The column is an 8-character code the routing rules read, so it holds
       the first choice and the rest become tags. */
    expect(contact?.language).toBe('ar');

    const tags = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM contact_tags ct
         JOIN tags t ON t.id = ct.tag_id
        WHERE ct.contact_id = ? AND t.namespace = 'lang'`,
      [contactId],
    );
    expect(Number(tags?.n), 'all three languages are kept').toBe(3);
  });
});
