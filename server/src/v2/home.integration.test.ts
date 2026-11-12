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
});
