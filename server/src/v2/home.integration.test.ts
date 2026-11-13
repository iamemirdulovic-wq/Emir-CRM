import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';

/**
 * The home screen's one request.
 *
 * It fans out to about twenty queries across fourteen tables, several of them
 * new in migration 0036. A single mistyped column name in any of them turns
 * the first screen of everybody's morning into an error page, and no unit
 * test would see it — which is the whole reason this file talks to a real
 * database instead of a mock.
 *
 * It also pins the two things that must never drift: an agent cannot reach
 * the owner's figures, and no number on the page is invented.
 */
let server: Server;
let base = '';

describeWithDb('home', () => {
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

  async function aLead(owner: string | null, over: Partial<{
    name: string; phone: string; vip: boolean; nextStepAt: Date | null; project: string;
  }> = {}) {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [
        contactId,
        over.name ?? 'Marco Bellini',
        over.phone ?? `+9715${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`,
      ],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title,
          source, project_name, is_vip, next_step_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'x', 'manual', ?, ?, ?)`,
      [
        id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner,
        over.project ?? 'Valia by Emaar',
        over.vip ? 1 : 0,
        over.nextStepAt ?? null,
      ],
    );
    return { id, contactId };
  }

  const get = async (cookie: string) => {
    const res = await fetch(`${base}/api/v2/home`, { headers: { cookie } });
    expect(res.status, await res.clone().text()).toBe(200);
    return await res.json() as Record<string, unknown>;
  };

  it('answers an agent without touching a table that is not there', async () => {
    const agent = await createTestUser({ role: 'agent', name: 'Rocky Dulovic' });
    await aLead(agent.id, { nextStepAt: new Date(Date.now() - 3_600_000) });
    await aLead(agent.id);
    await aLead(null);

    const home = await get(await signIn(base, agent));

    expect(home.role).toBe('agent');
    expect((home.me as { firstName: string }).firstName).toBe('Rocky');
    /* Every one of these is a query that ran. A missing column throws a 500
       long before this line. */
    expect((home.counts as Record<string, number>).all).toBe(2);
    expect(home.freeLeads, 'the unowned lead is a free lead').toBe(1);
    expect(home.today).toMatchObject({ calls: 0, messages: 0, meetings: 0 });
    expect(home.nextUp, 'the overdue promise is the one to pick up').not.toBeNull();
    expect(Array.isArray(home.callNow)).toBe(true);
    expect(Array.isArray(home.banners)).toBe(true);
    expect(home.vip).toBeNull();
    expect(home.streakDays).toBe(0);
  });

  it('counts the calls and messages actually recorded today', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const { id, contactId } = await aLead(agent.id);

    await execute(
      `INSERT INTO call_logs (id, opportunity_id, contact_id, user_id, outcome)
       VALUES (?, ?, ?, ?, 'interested')`,
      [newId(), id, contactId, agent.id],
    );
    await execute(
      `INSERT INTO call_logs (id, opportunity_id, contact_id, user_id, outcome)
       VALUES (?, ?, ?, ?, 'no_answer')`,
      [newId(), id, contactId, agent.id],
    );
    await execute(
      `INSERT INTO message_taps (id, opportunity_id, contact_id, user_id, app)
       VALUES (?, ?, ?, ?, 'whatsapp')`,
      [newId(), id, contactId, agent.id],
    );

    const home = await get(await signIn(base, agent));
    const today = home.today as Record<string, number>;

    expect(today.calls).toBe(2);
    expect(today.answered, 'only the one that got somewhere counts as answered').toBe(1);
    expect(today.messages).toBe(1);
    /* The tap is not yet answered, so the agent is owed an update on it. */
    expect(home.waitingUpdate).toHaveLength(1);
  });

  it('shows an agent the VIP lead handed to them, with its deadline', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const agent = await createTestUser({ role: 'agent' });
    const { id } = await aLead(agent.id, { name: 'Sheikh Khalid', vip: true });

    const deadline = new Date(Date.now() + 30 * 60_000);
    await execute(
      `INSERT INTO vip_handoffs
         (id, opportunity_id, given_by, given_to, call_within_minutes, deadline_at, private_note)
       VALUES (?, ?, ?, ?, 30, ?, 'He is a friend of the family. Call him yourself.')`,
      [newId(), id, boss.id, agent.id, deadline],
    );

    const home = await get(await signIn(base, agent));
    const vip = home.vip as Record<string, unknown>;

    expect(vip).not.toBeNull();
    expect(vip.name).toBe('Sheikh Khalid');
    expect(vip.givenBy).toBe('Emir Dulovic');
    expect(vip.note).toContain('friend of the family');
    expect(vip.accepted).toBe(false);
    expect(new Date(String(vip.deadlineAt)).getTime()).toBeGreaterThan(Date.now());
    expect((home.counts as Record<string, number>).vip).toBe(1);
  });

  it('gives an owner the company’s day, not their own', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent', name: 'Rocky' });
    await aLead(agent.id);
    await aLead(null);

    const home = await get(await signIn(base, boss));

    expect(home.role).toBe('owner');
    expect(Array.isArray(home.needsYou)).toBe(true);
    /* One lead with nobody on it is one thing the owner has to do. */
    expect((home.needsYou as Array<{ kind: string; n: number }>)
      .find((r) => r.kind === 'waiting')?.n).toBe(1);
    const team = home.teamRightNow as Array<{ name: string; openLeads: number }>;
    expect(team.find((r) => r.name === 'Rocky')?.openLeads).toBe(1);
    expect(home.todayNumbers).toMatchObject({ newLeads: 2, calls: 0, unitsBooked: 0 });
    expect(home.teamToday).toHaveProperty('inOffice');
  });

  it('never hands an agent the owner’s shape', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const home = await get(await signIn(base, agent));

    expect(home.role).toBe('agent');
    expect(home).not.toHaveProperty('needsYou');
    expect(home).not.toHaveProperty('teamRightNow');
    expect(home).not.toHaveProperty('todayNumbers');
  });

  /* ── the blocks `design/web/owner-home.html` draws ───────────────────── */

  /**
   * "VIP Omar Khan is not called · Bassam had 30 min".
   *
   * The row used to read "1 VIP lead not called in time", which is a row
   * nobody can act on without opening another screen first. These three
   * expectations are the whole point of the rebuild: the name, the agent and
   * the limit they were given.
   */
  it('names the VIP lead, the agent and the time they had', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir Dulovic' });
    const bassam = await createTestUser({ role: 'agent', name: 'Bassam Haddad' });
    const { id } = await aLead(null, { name: 'Omar Khan', vip: true });

    await execute(
      `INSERT INTO vip_handoffs
         (id, opportunity_id, given_by, given_to, call_within_minutes, deadline_at)
       VALUES (?, ?, ?, ?, 30, DATE_SUB(NOW(3), INTERVAL 35 MINUTE))`,
      [newId(), id, boss.id, bassam.id],
    );

    const home = await get(await signIn(base, boss));
    const row = (home.needsYou as Array<Record<string, unknown>>)
      .find((one) => one.kind === 'vip_late');

    expect(row, 'a VIP lead past its deadline is the first thing on the hero').toBeTruthy();
    expect(String(row?.text)).toContain('Omar Khan');
    expect(String(row?.sub)).toContain('Bassam Haddad');
    expect(String(row?.sub)).toContain('30 min');
    /* The hero's chip reads "Oldest waits …" off this. */
    expect(Number(row?.waitMinutes)).toBeGreaterThanOrEqual(34);
  });

  /**
   * The period switch moves calls, meetings and units — and nothing else.
   *
   * An owner who picks "Year" and watches the pipeline total change has been
   * told something untrue. How many leads exist is a fact about now.
   */
  it('moves calls with the period and leaves the pipeline alone', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const cookie = await signIn(base, boss);

    for (const daysAgo of [0, 10]) {
      await execute(
        `INSERT INTO call_logs (id, opportunity_id, contact_id, user_id, started_at)
         VALUES (?, ?, ?, ?, ?)`,
        [newId(), lead.id, lead.contactId, agent.id, new Date(Date.now() - daysAgo * 86_400_000)],
      );
    }

    const read = async (period: string) => {
      const res = await fetch(`${base}/api/v2/home?period=${period}`, { headers: { cookie } });
      expect(res.status, await res.clone().text()).toBe(200);
      return await res.json() as {
        period: string;
        work: { calls: number };
        pipeline: { total: number };
      };
    };

    const today = await read('today');
    const month = await read('month');

    expect(today.work.calls, 'only the call made today').toBe(1);
    expect(month.work.calls, 'both calls are inside thirty days').toBe(2);
    expect(month.pipeline.total, 'how many leads exist is not a fact about a window')
      .toBe(today.pipeline.total);
  });

  it('reads a nonsense period as today rather than failing', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const res = await fetch(`${base}/api/v2/home?period=fortnight`, {
      headers: { cookie: await signIn(base, boss) },
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { period: string }).period).toBe('today');
  });

  /**
   * The calls chart: a column per Dubai hour, and the hours still to come
   * drawn as empty slots rather than as noughts.
   */
  it('buckets today’s calls by Dubai hour and marks the hours still to come', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);

    await execute(
      `INSERT INTO call_logs (id, opportunity_id, contact_id, user_id, started_at)
       VALUES (?, ?, ?, ?, NOW(3))`,
      [newId(), lead.id, lead.contactId, agent.id],
    );

    const home = await get(await signIn(base, boss));
    const hours = home.hours as Array<{ hour: number; calls: number; future: boolean }>;

    expect(hours.length).toBeGreaterThan(0);
    expect(hours.reduce((sum, one) => sum + one.calls, 0), 'the one call is in a column').toBe(1);
    /* Nothing can have been counted in an hour that has not started. */
    expect(hours.filter((one) => one.future).every((one) => one.calls === 0)).toBe(true);
    expect(home.bestHour, 'the busiest hour so far').not.toBeNull();
    expect(home.nowAcross).not.toBeNull();
  });

  /**
   * The team table: the desk maximum, the check-in time, the week of calls,
   * and problems first.
   */
  it('gives every agent a desk maximum, a check-in time and a week of calls', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const here = await createTestUser({ role: 'agent', name: 'Talha' });
    const missing = await createTestUser({ role: 'agent', name: 'Bassam' });

    const deskId = newId();
    await execute(
      'INSERT INTO desks (id, name, max_open_leads) VALUES (?, ?, 60)',
      [deskId, 'Dubai off-plan'],
    );
    await execute(
      'INSERT INTO desk_members (desk_id, user_id) VALUES (?, ?)', [deskId, here.id],
    );
    await execute(
      `INSERT INTO attendance (id, user_id, on_date, kind, marked_at)
       VALUES (?, ?, DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')), 'office', NOW(3))`,
      [newId(), here.id],
    );
    await aLead(here.id);

    const home = await get(await signIn(base, boss));
    const rows = home.teamRightNow as Array<Record<string, unknown>>;

    const talha = rows.find((one) => one.name === 'Talha');
    expect(talha?.deskMax, 'the desk’s agreed maximum').toBe(60);
    expect(talha?.deskName).toBe('Dubai off-plan');
    expect(String(talha?.checkedInAt), 'Dubai HH:MM').toMatch(/^\d{2}:\d{2}$/);
    expect((talha?.callsPerDay as number[]), 'seven days, oldest first').toHaveLength(7);

    /* Problems first: the one who has not marked themselves in is at the top,
       whatever the alphabet says. */
    expect(rows[0]?.name, 'nobody has marked Bassam in').toBe('Bassam');
    expect(rows.find((one) => one.name === 'Bassam')?.deskMax).toBeNull();
    expect(missing.id).toBeTruthy();

    /* The desks named in the table's foot are the ones with a maximum on. */
    expect(home.desks).toMatchObject([{ name: 'Dubai off-plan', maxOpenLeads: 60 }]);
  });

  /** The five rows of the watch list, each a count of something real. */
  it('counts the five things on the watch list', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent', name: 'Shan' });

    /* One overdue follow-up, one lead gone cold, one unanswered tap. */
    const late = await aLead(agent.id, { nextStepAt: new Date(Date.now() - 3_600_000) });
    await execute(
      'UPDATE opportunities SET last_contact_at = DATE_SUB(NOW(3), INTERVAL 9 DAY) WHERE id = ?',
      [late.id],
    );
    await execute(
      `INSERT INTO message_taps (id, opportunity_id, contact_id, user_id, app)
       VALUES (?, ?, ?, ?, 'whatsapp')`,
      [newId(), late.id, late.contactId, agent.id],
    );

    const home = await get(await signIn(base, boss));
    const watch = home.watch as Record<string, Record<string, unknown>>;

    expect(watch.overdue?.n).toBe(1);
    expect(watch.overdue?.who, 'who the late follow-ups sit with')
      .toMatchObject([{ name: 'Shan', n: 1 }]);
    expect(watch.cold?.valueOf()).toBe(1);
    expect(watch.taps).toMatchObject({ n: 1, unanswered: 1 });
    expect(watch.transfers).toMatchObject({ n: 0, needApproval: 0 });
  });

  /**
   * "Transfers today" means today.
   *
   * The hero still has to see an approval asked for yesterday evening — it
   * needs the owner this morning — so the two figures are counted off the
   * same rows with different windows, and this is the line that pins it.
   */
  it('counts transfers today as today, while the hero still sees yesterday’s', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const from = await createTestUser({ role: 'agent', name: 'Rocky' });
    const to = await createTestUser({ role: 'agent', name: 'Yuliia' });
    const lead = await aLead(from.id, { name: 'Omar Khalil' });

    await execute(
      `INSERT INTO lead_transfers
         (id, opportunity_id, from_user_id, to_user_id, reason, status, requested_at)
       VALUES (?, ?, ?, ?, 'leave', 'needs_approval',
               DATE_SUB(DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')), INTERVAL 2 HOUR))`,
      [newId(), lead.id, from.id, to.id],
    );

    const home = await get(await signIn(base, boss));
    const watch = home.watch as Record<string, Record<string, unknown>>;
    const row = (home.needsYou as Array<Record<string, unknown>>)
      .find((one) => one.kind === 'transfer');

    expect(watch.transfers?.n, 'asked for before midnight, so not today').toBe(0);
    expect(watch.transfers?.needApproval, 'still waiting on the owner').toBe(1);
    expect(String(row?.sub), 'the row names the lead and both people')
      .toContain('Omar Khalil');
    expect(String(row?.sub)).toContain('Rocky → Yuliia');
  });

  /** The two cards below the fold. */
  it('sends the newest leads and the VIP leads this owner gave out', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir' });
    const agent = await createTestUser({ role: 'agent', name: 'Rocky' });
    const mine = await aLead(agent.id, { name: 'Khalid Al Mansoori', vip: true });
    await aLead(null, { name: 'Kevin Brooks' });

    await execute(
      `INSERT INTO vip_handoffs
         (id, opportunity_id, given_by, given_to, call_within_minutes, deadline_at)
       VALUES (?, ?, ?, ?, 30, DATE_ADD(NOW(3), INTERVAL 24 MINUTE))`,
      [newId(), mine.id, boss.id, agent.id],
    );

    const home = await get(await signIn(base, boss));
    const latest = home.latestLeads as Array<Record<string, unknown>>;
    const vip = home.vipGiven as { total: number; rows: Array<Record<string, unknown>> };

    expect(latest).toHaveLength(2);
    expect(latest.map((one) => one.name)).toContain('Kevin Brooks');
    const khalid = latest.find((one) => one.name === 'Khalid Al Mansoori');
    expect(khalid?.isVip).toBe(true);
    expect(khalid?.agent, 'the table names the agent, or says Incoming').toBe('Rocky');
    expect(latest.find((one) => one.name === 'Kevin Brooks')?.agent).toBeNull();

    expect(vip.total).toBe(1);
    expect(vip.rows[0]).toMatchObject({ name: 'Khalid Al Mansoori', agent: 'Rocky' });
    expect(vip.rows[0]?.deadlineAt, 'the card counts down to this').toBeTruthy();
  });

  /** The strip under the hero: the stages now, with Lost kept apart. */
  it('sends the pipeline strip with Lost outside its proportions', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id);
    await aLead(agent.id);
    const lost = await aLead(agent.id);
    await execute(
      "UPDATE opportunities SET status = 'lost', stage_key = 'lost' WHERE id = ?", [lost.id],
    );

    const home = await get(await signIn(base, boss));
    const pipeline = home.pipeline as {
      total: number; open: number;
      stages: Array<{ key: string; n: number; pct: number }>;
      lost: { n: number };
    };

    expect(pipeline.total).toBe(3);
    expect(pipeline.open).toBe(2);
    expect(pipeline.lost.n).toBe(1);
    expect(pipeline.stages.some((one) => one.key === 'lost'), 'a pipeline does not count its dead')
      .toBe(false);
    expect(pipeline.stages.find((one) => one.key === 'new_lead')?.pct).toBe(100);
  });
});
