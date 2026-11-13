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
 * What the team is doing right now.
 *
 * The screen is read in the middle of the day to decide who to go and talk
 * to, so what matters is that each figure counts the thing it is labelled
 * with — a call is a tap on Call, a WhatsApp click is a tap that opened the
 * app — that the hour columns put a click in the Dubai hour it happened in,
 * and that an agent cannot open it at all, because it carries every
 * colleague's day.
 */
let server: Server;
let base = '';

interface Live {
  now: string;
  closed: boolean;
  hours: Array<{ hour: number; calls: number; whatsapp: number; telegram: number; future: boolean }>;
  nowAcross: number | null;
  totals: { calls: number; whatsapp: number; telegram: number };
  yesterday: { calls: number; whatsapp: number; telegram: number };
  agents: Array<{
    userId: string; name: string; calls: number; whatsapp: number; telegram: number;
    spark: number[]; lastClickAt: string | null;
  }>;
  notCheckedIn: Array<{ userId: string; name: string; calls: number; times: string[]; checkedInAt: string | null }>;
}

describeWithDb('the team right now', () => {
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

  const get = (path: string, cookie: string) =>
    fetch(`${base}${path}`, { headers: { cookie } });

  /** The hour it is in Dubai, which is UTC+4 all year (see `dubai.ts`). */
  const dubaiHour = (): number => new Date(Date.now() + 4 * 3_600_000).getUTCHours();

  /** One lead for the clicks to hang off. */
  async function aLead(): Promise<{ contactId: string; opportunityId: string }> {
    const stage = await queryOne<{ id: string; pipeline_id: string }>(
      "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'new_lead' LIMIT 1", [],
    );
    const contactId = newId();
    const opportunityId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, first_source) VALUES (?, ?, ?, ?)',
      [contactId, 'Dana Haddad', `+9715${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, 'manual'],
    );
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, status, source)
       VALUES (?, ?, ?, ?, 'new_lead', 'open', 'manual')`,
      [opportunityId, contactId, stage?.pipeline_id, stage?.id],
    );
    return { contactId, opportunityId };
  }

  /**
   * A call at a given Dubai hour today.
   *
   * Written through `CONVERT_TZ` rather than with a JavaScript date, so the
   * row lands in the same hour the endpoint reads it out of however the test
   * machine's clock is set.
   */
  async function aCall(
    userId: string,
    lead: { contactId: string; opportunityId: string },
    dubaiHour: number,
    notCheckedIn = false,
  ): Promise<void> {
    await execute(
      `INSERT INTO call_logs (id, opportunity_id, contact_id, user_id, started_at, not_checked_in)
       VALUES (?, ?, ?, ?,
               DATE_ADD(
                 CONVERT_TZ(DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')), '+04:00', '+00:00'),
                 INTERVAL ? MINUTE),
               ?)`,
      [newId(), lead.opportunityId, lead.contactId, userId, dubaiHour * 60 + 12, notCheckedIn ? 1 : 0],
    );
  }

  async function aTap(
    userId: string,
    lead: { contactId: string; opportunityId: string },
    dubaiHour: number,
    app: 'whatsapp' | 'telegram' = 'whatsapp',
  ): Promise<void> {
    await execute(
      `INSERT INTO message_taps (id, opportunity_id, contact_id, user_id, app, tapped_at)
       VALUES (?, ?, ?, ?, ?,
               DATE_ADD(
                 CONVERT_TZ(DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')), '+04:00', '+00:00'),
                 INTERVAL ? MINUTE))`,
      [newId(), lead.opportunityId, lead.contactId, userId, app, dubaiHour * 60 + 20],
    );
  }

  it('counts calls and clicks into the hour they happened in', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    const lead = await aLead();

    /* This hour and the one before it, in Dubai — not a pair of fixed hours,
       which would make the test pass or fail by the clock on the machine. */
    const now = dubaiHour();
    const earlier = now >= 1 ? now - 1 : now;

    await aCall(sara.id, lead, earlier);
    await aCall(sara.id, lead, earlier);
    await aCall(sara.id, lead, now);
    await aTap(sara.id, lead, now);
    await aTap(omar.id, lead, now, 'telegram');

    const res = await get('/api/v2/live', cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const live = await res.json() as Live;

    expect(live.totals).toEqual({ calls: 3, whatsapp: 1, telegram: 1 });
    expect(live.now).toMatch(/^\d{2}:\d{2}$/);

    const thisHour = live.hours.find((one) => one.hour === now);
    expect(thisHour?.whatsapp).toBe(1);
    expect(thisHour?.telegram).toBe(1);
    /* This hour is happening, so it is never drawn as an empty slot. */
    expect(thisHour?.future).toBe(false);
    if (earlier === now) {
      expect(thisHour?.calls).toBe(3);
    } else {
      expect(thisHour?.calls).toBe(1);
      expect(live.hours.find((one) => one.hour === earlier)?.calls).toBe(2);
    }

    const row = live.agents.find((one) => one.userId === sara.id);
    expect(row?.calls).toBe(3);
    expect(row?.whatsapp).toBe(1);
    expect(row?.telegram).toBe(0);
    expect(row?.lastClickAt).not.toBeNull();
    /* The sparkline is the same buckets as the chart, so it sums to the row. */
    expect(row?.spark.reduce((sum, one) => sum + one, 0)).toBe(4);

    /* Busiest first: four clicks beats one. */
    expect(live.agents[0]?.userId).toBe(sara.id);
    /* The owner is not in the table — nobody is measuring them. */
    expect(live.agents.some((one) => one.userId === owner.id)).toBe(false);
  });

  it('gives an agent with no clicks a row of noughts', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const quiet = await createTestUser({ role: 'agent', name: 'Quiet' });

    const live = await (await get('/api/v2/live', cookie)).json() as Live;
    const row = live.agents.find((one) => one.userId === quiet.id);
    expect(row).toBeDefined();
    expect(row?.calls).toBe(0);
    expect(row?.lastClickAt).toBeNull();
    expect(live.totals).toEqual({ calls: 0, whatsapp: 0, telegram: 0 });
  });

  it('names who called before checking in, and when', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const shan = await createTestUser({ role: 'agent', name: 'Shan' });
    const lead = await aLead();

    await aCall(shan.id, lead, 9, true);
    await aCall(shan.id, lead, 9, true);
    /* And one ordinary call, which must not be counted here. */
    await aCall(shan.id, lead, 10);

    const live = await (await get('/api/v2/live', cookie)).json() as Live;
    const flagged = live.notCheckedIn.find((one) => one.userId === shan.id);
    expect(flagged?.calls).toBe(2);
    expect(flagged?.name).toBe('Shan');
    expect(flagged?.times).toEqual(['09:12', '09:12']);
    /* Nothing marked them in, so there is no check-in time to show. */
    expect(flagged?.checkedInAt).toBeNull();
    /* Every call still counts as a call. */
    expect(live.totals.calls).toBe(3);
  });

  it('keeps an agent and a manager out of it', async () => {
    const agent = await createTestUser({ role: 'agent' });
    expect((await get('/api/v2/live', await signIn(base, agent))).status).toBe(403);

    const manager = await createTestUser({ role: 'manager' });
    expect((await get('/api/v2/live', await signIn(base, manager))).status).toBe(403);
  });
});
