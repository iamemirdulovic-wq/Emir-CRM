import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, query, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';

/**
 * The full dashboard.
 *
 * The point of these: the period switch must move the three numbers it is
 * supposed to move and leave the rest alone. An owner who picks "Year" and
 * watches the lead total change has been told something untrue, and that is
 * exactly the kind of bug a screenshot does not catch — the page looks right
 * either way.
 */
let server: Server;
let base = '';

describeWithDb('the full dashboard', () => {
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

  /** A lead, optionally owned, optionally stale, optionally in a stage. */
  async function aLead(over: {
    owner?: string | null;
    stage?: string;
    status?: string;
    lastContactDaysAgo?: number | null;
    project?: string | null;
    source?: string;
  } = {}) {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Marco Bellini', `+9715${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title,
          source, project_name, last_contact_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'x', ?, ?, ?)`,
      [
        id, contactId, stage!.pipeline_id, stage!.id, over.stage ?? stage!.key,
        over.owner ?? null, over.status ?? 'open',
        over.source ?? 'meta_lead_ads',
        over.project === undefined ? 'Valia' : over.project,
        over.lastContactDaysAgo === null || over.lastContactDaysAgo === undefined
          ? null
          : new Date(Date.now() - over.lastContactDaysAgo * 86_400_000),
      ],
    );
    return { id, contactId };
  }

  const get = (path: string, cookie: string) =>
    fetch(`${base}${path}`, { headers: { cookie } });

  it('counts leads, stages and sources, and keeps lost out of the strip', async () => {
    const owner = await createTestUser({ role: 'owner' });
    await aLead({ stage: 'new_lead' });
    await aLead({ stage: 'new_lead' });
    await aLead({ stage: 'won', status: 'won' });
    await aLead({ stage: 'lost', status: 'lost' });
    await aLead({ stage: 'new_lead', source: 'website' });

    const res = await get('/api/v2/dashboard', await signIn(base, owner));
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as {
      totals: { all: number; open: number; lost: number; untouched: number };
      stages: Array<{ key: string; n: number; pct: number }>;
      lost: { n: number };
      sources: Array<{ key: string; n: number }>;
    };

    expect(body.totals.all).toBe(5);
    expect(body.totals.lost).toBe(1);
    expect(body.totals.open).toBe(3);
    /* Nobody has been contacted, and only the open ones count as untouched. */
    expect(body.totals.untouched).toBe(3);

    const strip = Object.fromEntries(body.stages.map((s) => [s.key, s.n]));
    expect(strip.new_lead).toBe(3);
    expect(strip.won).toBe(1);
    /* Lost is counted, but outside the strip's own proportions. */
    expect(body.stages.some((s) => s.key === 'lost')).toBe(false);
    expect(body.lost.n).toBe(1);
    const newPct = body.stages.find((s) => s.key === 'new_lead')?.pct;
    expect(newPct, 'three of the four live leads are New').toBe(75);

    const sources = Object.fromEntries(body.sources.map((s) => [s.key, s.n]));
    expect(sources.meta_lead_ads).toBe(4);
    expect(sources.website).toBe(1);
  });

  it('moves calls with the period and leaves the lead total alone', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent', name: 'Caller' });
    const lead = await aLead({ owner: agent.id });
    const cookie = await signIn(base, owner);

    /* One call today, one ten days ago. */
    for (const daysAgo of [0, 10]) {
      await execute(
        `INSERT INTO call_logs (id, opportunity_id, contact_id, user_id, started_at)
         VALUES (?, ?, ?, ?, ?)`,
        [newId(), lead.id, lead.contactId, agent.id, new Date(Date.now() - daysAgo * 86_400_000)],
      );
    }

    const today = await (await get('/api/v2/dashboard?period=today', cookie)).json() as {
      work: { calls: number }; totals: { all: number };
    };
    const month = await (await get('/api/v2/dashboard?period=month', cookie)).json() as {
      work: { calls: number }; totals: { all: number };
    };

    expect(today.work.calls, 'only the call made today').toBe(1);
    expect(month.work.calls, 'both calls are inside thirty days').toBe(2);
    expect(month.totals.all, 'how many leads exist is not a fact about a window')
      .toBe(today.totals.all);
  });

  it('a nonsense period reads as today rather than failing', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const res = await get('/api/v2/dashboard?period=fortnight', await signIn(base, owner));
    expect(res.status).toBe(200);
    expect((await res.json() as { period: string }).period).toBe('today');
  });

  it('finds the leads going cold, and who is sitting on them', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent', name: 'Quiet' });
    await aLead({ owner: agent.id, lastContactDaysAgo: 30 });
    await aLead({ owner: agent.id, lastContactDaysAgo: 9 });
    await aLead({ owner: agent.id, lastContactDaysAgo: 1 });

    const body = await (await get('/api/v2/dashboard', await signIn(base, owner))).json() as {
      cold: { total: number; agents: Array<{ name: string; leads: number; cold: number }> };
    };

    expect(body.cold.total, 'two are older than a week').toBe(2);
    expect(body.cold.agents).toHaveLength(1);
    expect(body.cold.agents[0]?.name).toBe('Quiet');
    expect(body.cold.agents[0]?.leads).toBe(3);
    expect(body.cold.agents[0]?.cold).toBe(2);
  });

  it('"Move" sends that agent’s open leads back to the pool, and nobody else’s', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const away = await createTestUser({ role: 'agent', name: 'On Leave' });
    const staying = await createTestUser({ role: 'agent', name: 'Still Here' });
    const theirs = await aLead({ owner: away.id });
    const closed = await aLead({ owner: away.id, status: 'won', stage: 'won' });
    const other = await aLead({ owner: staying.id });

    const res = await fetch(`${base}/api/v2/dashboard/move`, {
      method: 'POST',
      headers: { cookie: await signIn(base, owner), 'content-type': 'application/json' },
      body: JSON.stringify({ userId: away.id }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ moved: 1, name: 'On Leave' });

    const rows = await query<{ id: string; owner_user_id: string | null }>(
      'SELECT id, owner_user_id FROM opportunities WHERE id IN (?, ?, ?)',
      [theirs.id, closed.id, other.id],
    );
    const owned = Object.fromEntries(rows.map((r) => [r.id, r.owner_user_id]));
    expect(owned[theirs.id], 'back in the pool for the owner to give out').toBeNull();
    expect(owned[closed.id], 'a closed lead is not anybody’s work').toBe(away.id);
    expect(owned[other.id], 'nobody else was touched').toBe(staying.id);
  });

  /* ── the blocks `design/web/dashboard.html` draws ────────────────────── */

  /**
   * The morning brief's rows carry their reason, not the button's own word.
   *
   * The card used to read "Move 31 / Move 31", because the explanation line
   * was wired to the action. The design puts the reason there: "Back Thursday
   * · 1 follow-up is already overdue".
   */
  it('gives each brief row its own reason, and a Move for the agent who is away', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const away = await createTestUser({ role: 'agent', name: 'Sultan' });
    await aLead({ owner: away.id });
    await aLead({ owner: away.id });
    const today = await queryOne<{ d: string }>(
      "SELECT DATE_FORMAT(DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')), '%Y-%m-%d') AS d",
    );
    await execute(
      `INSERT INTO leave_requests (id, user_id, kind, from_date, to_date, working_days, status)
       VALUES (?, ?, 'annual', ?, ?, 1, 'approved')`,
      [newId(), away.id, today!.d, today!.d],
    );

    const body = await (await get('/api/v2/dashboard', await signIn(base, owner))).json() as {
      brief: Array<{
        kind: string; text: string; sub: string; action: string;
        move: { userId: string; leads: number } | null;
      }>;
    };

    const leave = body.brief.find((row) => row.kind === 'leave');
    expect(leave, 'an agent on leave with leads is the first row').toBeTruthy();
    expect(leave?.text).toContain('Sultan');
    expect(leave?.text).toContain('2 leads have nobody');
    expect(leave?.sub, 'the reason, not the button’s word').not.toBe(leave?.action);
    expect(leave?.sub).toMatch(/Back |On leave/);
    expect(leave?.move).toMatchObject({ userId: away.id, leads: 2 });

    /* The untouched row is the design's third, and it counts for real. */
    expect(body.brief.find((row) => row.kind === 'untouched')?.text)
      .toContain('not touched yet');
  });

  it('carries each agent’s desk maximum, and the desks for the column’s foot', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent', name: 'Talha' });
    const deskId = newId();
    await execute(
      'INSERT INTO desks (id, name, max_open_leads) VALUES (?, ?, 60)',
      [deskId, 'Dubai off-plan'],
    );
    await execute('INSERT INTO desk_members (desk_id, user_id) VALUES (?, ?)', [deskId, agent.id]);
    await aLead({ owner: agent.id });

    const body = await (await get('/api/v2/dashboard', await signIn(base, owner))).json() as {
      agents: Array<{ name: string; deskMax: number | null; deskName: string | null }>;
      desks: Array<{ name: string; maxOpenLeads: number | null }>;
      assignable: Array<{ name: string; where: string; canTake: boolean }>;
    };

    expect(body.agents.find((row) => row.name === 'Talha')).toMatchObject({
      deskMax: 60, deskName: 'Dubai off-plan',
    });
    expect(body.desks).toMatchObject([{ name: 'Dubai off-plan', maxOpenLeads: 60 }]);
    /* Nobody has marked themselves in, so nobody may be given leads. */
    expect(body.assignable.find((row) => row.name === 'Talha'))
      .toMatchObject({ where: 'absent', canTake: false });
  });

  /**
   * The Move dialog's three choices, and the rule under the hint.
   *
   * "People on leave or absent cannot be chosen" is the dialog's own line.
   * A hint in a dialog is not a rule, so the server refuses them again.
   */
  it('moves one agent’s leads to one agent, and refuses somebody absent', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const away = await createTestUser({ role: 'agent', name: 'Away' });
    const here = await createTestUser({ role: 'agent', name: 'Here' });
    const absent = await createTestUser({ role: 'agent', name: 'Absent' });
    const theirs = await aLead({ owner: away.id });
    const cookie = await signIn(base, owner);

    await execute(
      `INSERT INTO attendance (id, user_id, on_date, kind)
       VALUES (?, ?, DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')), 'office')`,
      [newId(), here.id],
    );

    const move = (body: unknown) => fetch(`${base}/api/v2/dashboard/move`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const refused = await move({ userId: away.id, to: { kind: 'agent', userId: absent.id } });
    expect(refused.status, 'nobody has marked Absent in today').toBe(400);
    expect(await refused.text()).toContain('cannot be chosen');

    const ok = await move({ userId: away.id, to: { kind: 'agent', userId: here.id } });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await ok.json()).toMatchObject({ moved: 1, name: 'Away', to: 'Here' });

    const row = await queryOne<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?', [theirs.id],
    );
    expect(row?.owner_user_id).toBe(here.id);
  });

  /**
   * A manager is not somebody `assign` gives leads to.
   *
   * `loadCandidates` takes an active **agent** who is available, and nobody
   * else. Offering a manager in the Move dialog would have looked like it
   * worked and quietly pooled the leads instead, with the screen saying they
   * had gone to them.
   */
  it('does not offer, or accept, somebody the assignment rules will not give to', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const away = await createTestUser({ role: 'agent', name: 'Away' });
    const boss = await createTestUser({ role: 'manager', name: 'Manager' });
    await aLead({ owner: away.id });

    await execute(
      `INSERT INTO attendance (id, user_id, on_date, kind)
       VALUES (?, ?, DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')), 'office')`,
      [newId(), boss.id],
    );

    const cookie = await signIn(base, owner);
    const body = await (await get('/api/v2/dashboard', cookie)).json() as {
      assignable: Array<{ userId: string; name: string; canTake: boolean }>;
    };
    expect(
      body.assignable.find((row) => row.userId === boss.id)?.canTake,
      'the manager is marked in, but is not somebody leads are given to',
    ).toBe(false);

    const res = await fetch(`${base}/api/v2/dashboard/move`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: away.id, to: { kind: 'agent', userId: boss.id } }),
    });
    expect(res.status, 'and the server refuses rather than pooling them silently').toBe(400);
  });

  it('shares leads only between the agents it was given', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const away = await createTestUser({ role: 'agent', name: 'Away' });
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const three = await createTestUser({ role: 'agent', name: 'Three' });
    for (let i = 0; i < 4; i += 1) await aLead({ owner: away.id });

    for (const person of [one, two, three]) {
      await execute(
        `INSERT INTO attendance (id, user_id, on_date, kind)
         VALUES (?, ?, DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')), 'office')`,
        [newId(), person.id],
      );
    }

    const res = await fetch(`${base}/api/v2/dashboard/move`, {
      method: 'POST',
      headers: { cookie: await signIn(base, owner), 'content-type': 'application/json' },
      body: JSON.stringify({ userId: away.id, to: { kind: 'share', userIds: [one.id, two.id] } }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ moved: 4, to: '2 agents' });

    const rows = await query<{ owner_user_id: string }>(
      "SELECT owner_user_id FROM opportunities WHERE status = 'open'",
    );
    const owners = new Set(rows.map((r) => String(r.owner_user_id)));
    expect(owners.has(three.id), 'Three was not ticked, so Three gets nothing').toBe(false);
    expect(owners.size, 'both of the two who were ticked got some').toBe(2);
  });

  it('is shut to an agent and to a manager', async () => {
    for (const role of ['agent', 'manager']) {
      const person = await createTestUser({ role, name: `A ${role}` });
      const res = await get('/api/v2/dashboard', await signIn(base, person));
      expect(res.status, `${role} must not read the whole company`).not.toBe(200);
    }
  });
});
