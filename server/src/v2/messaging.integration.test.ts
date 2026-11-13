import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';
import { execute, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';

/**
 * The messaging report.
 *
 * The figures are a funnel, so what is worth testing is that each step counts
 * the thing it is labelled with: a tap is a tap, "confirmed" is the agent
 * having answered rather than anything about the client, and "replied" is one
 * particular answer. Also that an agent cannot open it at all — it carries
 * every colleague's numbers, including who has stopped answering.
 */
let server: Server;
let base = '';

describeWithDb('the messaging report', () => {
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

  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** One lead, owned by nobody in particular: the taps are what is counted. */
  async function aLead(): Promise<{ contactId: string; opportunityId: string }> {
    const stage = await queryOne<{ id: string; pipeline_id: string }>(
      "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'new_lead' LIMIT 1", [],
    );
    const contactId = newId();
    const opportunityId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, first_source) VALUES (?, ?, ?, ?)',
      [contactId, 'Marco Bellini', `+9715${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, 'manual'],
    );
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, status, source)
       VALUES (?, ?, ?, ?, 'new_lead', 'open', 'manual')`,
      [opportunityId, contactId, stage?.pipeline_id, stage?.id],
    );
    return { contactId, opportunityId };
  }

  async function aTap(
    userId: string,
    lead: { contactId: string; opportunityId: string },
    result: string | null,
    app: 'whatsapp' | 'telegram' = 'whatsapp',
  ): Promise<void> {
    await execute(
      `INSERT INTO message_taps (id, opportunity_id, contact_id, user_id, app, result, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ${result === null ? 'NULL' : 'NOW(3)'})`,
      [newId(), lead.opportunityId, lead.contactId, userId, app, result],
    );
  }

  type Report = {
    taps: { total: number; whatsapp: number; telegram: number; previous: number };
    confirmed: number;
    noUpdate: number;
    replied: number;
    answers: Record<string, number>;
    links: { made: number; opened: number; opens: number };
    agents: Array<{ userId: string; name: string; taps: number; noUpdate: number; linksOpened: number }>;
    opened: Array<{ client: string | null; opens: number }>;
  };

  it('counts taps, answers and the ones nobody answered', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const lead = await aLead();

    await aTap(sara.id, lead, 'replied');
    await aTap(sara.id, lead, 'sent');
    await aTap(sara.id, lead, 'not_sent', 'telegram');
    await aTap(sara.id, lead, null);

    const res = await send('GET', '/api/v2/messaging?period=today', cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const report = await res.json() as Report;

    expect(report.taps.total).toBe(4);
    expect(report.taps.whatsapp).toBe(3);
    expect(report.taps.telegram).toBe(1);
    /* Three were answered; the fourth is the open question the screen chases. */
    expect(report.confirmed).toBe(3);
    expect(report.noUpdate).toBe(1);
    expect(report.replied).toBe(1);
    expect(report.answers.not_sent).toBe(1);

    const row = report.agents.find((one) => one.userId === sara.id);
    expect(row?.taps).toBe(4);
    expect(row?.noUpdate).toBe(1);
  });

  it('counts a link once however often it was opened', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const lead = await aLead();

    const linkId = newId();
    await execute(
      `INSERT INTO tracking_links (id, code, opportunity_id, contact_id, user_id, kind, target_url, label)
       VALUES (?, 'abc123', ?, ?, ?, 'brochure', 'https://example.com/b.pdf', 'Brochure · The Archive')`,
      [linkId, lead.opportunityId, lead.contactId, sara.id],
    );
    for (let i = 0; i < 3; i += 1) {
      await execute('INSERT INTO link_opens (id, link_id) VALUES (?, ?)', [newId(), linkId]);
    }

    const report = await (await send('GET', '/api/v2/messaging', cookie)).json() as Report;
    expect(report.links.made).toBe(1);
    /* One link opened, three opens: the design shows "31 of 74 links", which
       is links, and the panel below shows "opened 3 times", which is opens. */
    expect(report.links.opened).toBe(1);
    expect(report.links.opens).toBe(3);
    expect(report.opened[0]?.client).toBe('Marco Bellini');
    expect(report.opened[0]?.opens).toBe(3);
    expect(report.agents.find((one) => one.userId === sara.id)).toBeUndefined();
  });

  it('reminds an agent once, for every question still open', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const lead = await aLead();
    await aTap(sara.id, lead, null);
    await aTap(sara.id, lead, null);

    const sent = await send('POST', '/api/v2/messaging/remind', cookie, { userId: sara.id });
    expect(sent.status, await sent.clone().text()).toBe(200);
    expect(await sent.json()).toEqual({ reminded: 2 });

    const note = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'tap_reminder'",
      [sara.id],
    );
    expect(Number(note?.n)).toBe(1);

    /* Nothing left to answer is not a reminder worth sending. */
    await execute('UPDATE message_taps SET answered_at = NOW(3), result = ? WHERE user_id = ?', ['sent', sara.id]);
    expect((await send('POST', '/api/v2/messaging/remind', cookie, { userId: sara.id })).status).toBe(400);
  });

  it('keeps an agent out of it', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    expect((await send('GET', '/api/v2/messaging', cookie)).status).toBe(403);
    expect((await send('POST', '/api/v2/messaging/remind', cookie, { userId: agent.id })).status).toBe(403);
  });
});
