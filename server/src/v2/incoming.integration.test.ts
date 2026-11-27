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
import { saveSetting } from '../config/secrets.js';

/**
 * Incoming: taking a free lead, and giving them out.
 *
 * The test that matters most is the race. Two agents pressing "Take this
 * lead" within the same second must not both get it, and the failure mode if
 * they do is the worst kind: both call the same client, and neither knows the
 * other did.
 */
let server: Server;
let base = '';

describeWithDb('incoming', () => {
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

  async function freeLead(over: { vip?: boolean; source?: string; daysAgo?: number } = {}) {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Free Lead', `+9715${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title,
          source, is_vip, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, 'open', 'x', ?, ?,
               DATE_SUB(NOW(3), INTERVAL ? DAY))`,
      [
        id, contactId, stage!.pipeline_id, stage!.id, stage!.key,
        over.source ?? 'manual', over.vip ? 1 : 0, over.daysAgo ?? 0,
      ],
    );
    return id;
  }

  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('never lets an import bury a lead somebody just sent', async () => {
    /*
     * 27 November, the morning this was found. Incoming held 200 CSV rows
     * from an agent who had left seventeen days before, the list was sorted
     * oldest first and capped at 200, and a website lead that had arrived a
     * minute earlier was not on the screen at all -- cut off past the end.
     * The owner could see the count say 207 and could not find the lead.
     *
     * 210 imports here, more than the cap, so the fresh one can only be
     * visible if the two lists really are separate queries.
     */
    const boss = await createTestUser({ role: 'owner' });
    for (let i = 0; i < 210; i += 1) {
      await freeLead({ source: 'csv_import', daysAgo: 17 });
    }
    const fresh = await freeLead({ source: 'website' });

    const res = await send('GET', '/api/v2/incoming', await signIn(base, boss));
    const body = await res.json() as {
      free: Array<{ id: string }>;
      imported: Array<{ id: string }>;
      counts: { fresh: number; imported: number };
    };

    expect(body.free.map((one) => one.id), 'the fresh lead is in the fresh list')
      .toContain(fresh);
    expect(body.free, 'and no import is in it with it').toHaveLength(1);
    expect(body.imported.map((one) => one.id), 'the imports are their own list')
      .not.toContain(fresh);

    /* The count is of everything waiting, not of the truncated page: 200
       rows printed as "200 waiting" while 210 waited is the lie that hid
       the lead in the first place. */
    expect(body.counts.imported).toBe(210);
    expect(body.counts.fresh).toBe(1);
    expect(body.imported.length).toBeLessThan(body.counts.imported);
  });

  it('puts the newest lead at the top of the fresh list', async () => {
    /* Oldest first is right for a backlog and wrong for an alarm. The lead
       that needs a call in five minutes is the one that just arrived. */
    const boss = await createTestUser({ role: 'owner' });
    await freeLead({ source: 'website', daysAgo: 3 });
    await freeLead({ source: 'website', daysAgo: 1 });
    const newest = await freeLead({ source: 'website' });

    const res = await send('GET', '/api/v2/incoming', await signIn(base, boss));
    const body = await res.json() as { free: Array<{ id: string }> };
    expect(body.free[0]?.id).toBe(newest);
  });

  it('gives an agent one list, freshest first', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await freeLead({ source: 'csv_import', daysAgo: 17 });
    const fresh = await freeLead({ source: 'website' });

    const res = await send('GET', '/api/v2/incoming', await signIn(base, agent));
    const body = await res.json() as {
      free: Array<{ id: string }>; imported: Array<{ id: string }>;
    };
    /* The screen concatenates them, fresh first; both halves must be sent. */
    expect(body.free.map((one) => one.id)).toEqual([fresh]);
    expect(body.imported).toHaveLength(1);
  });

  it('shows an agent the free leads and nothing about the team', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await freeLead();
    await freeLead();

    const res = await send('GET', '/api/v2/incoming', await signIn(base, agent));
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body.role).toBe('agent');
    expect(body.free).toHaveLength(2);
    expect(body, 'an agent is not told who holds how many leads').not.toHaveProperty('agents');
  });

  it('gives an owner the people to hand them to, with their open counts', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent', name: 'Rocky' });
    await freeLead();

    const body = await (await send('GET', '/api/v2/incoming', await signIn(base, boss))).json() as {
      role: string; agents: Array<{ name: string; openLeads: number }>;
    };
    expect(body.role).toBe('owner');
    expect(body.agents.find((a) => a.name === 'Rocky')?.openLeads).toBe(0);
    expect(agent.id).toBeTruthy();
  });

  it('only one of two agents can take the same lead', async () => {
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const lead = await freeLead();
    const [cookieOne, cookieTwo] = await Promise.all([signIn(base, one), signIn(base, two)]);

    const [a, b] = await Promise.all([
      send('POST', `/api/v2/incoming/${lead}/take`, cookieOne),
      send('POST', `/api/v2/incoming/${lead}/take`, cookieTwo),
    ]);

    const wins = [a.status, b.status].filter((s) => s === 200).length;
    expect(wins, 'exactly one of them may win').toBe(1);

    const after = await queryOne<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?', [lead],
    );
    expect([one.id, two.id]).toContain(after?.owner_user_id);
  });

  it('an agent cannot take a lead while the owner hands them out', async () => {
    await saveSetting({ userId: null, role: 'automation' }, 'ROUTING_AUTO_ASSIGN', '0');
    const agent = await createTestUser({ role: 'agent' });
    const lead = await freeLead();
    const cookie = await signIn(base, agent);

    const list = await send('GET', '/api/v2/incoming', cookie);
    expect(((await list.json()) as { canTake?: boolean }).canTake, 'no Take button').toBe(false);

    const res = await send('POST', `/api/v2/incoming/${lead}/take`, cookie);
    expect(res.status, await res.clone().text()).toBe(403);
    const row = await queryOne<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?', [lead],
    );
    expect(row?.owner_user_id, 'the lead still waits for the owner').toBeNull();
  });

  it('taking a lead moves the contact and the conversation too', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await freeLead();

    const res = await send('POST', `/api/v2/incoming/${lead}/take`, await signIn(base, agent));
    expect(res.status, await res.clone().text()).toBe(200);

    const row = await queryOne<{ owner_user_id: string; contact_id: string; accepted_at: Date | null }>(
      'SELECT owner_user_id, contact_id, accepted_at FROM opportunities WHERE id = ?', [lead],
    );
    expect(row?.owner_user_id).toBe(agent.id);
    /* Taking it is accepting it: there is no second clock to stop. */
    expect(row?.accepted_at).not.toBeNull();

    const contact = await queryOne<{ owner_user_id: string }>(
      'SELECT owner_user_id FROM contacts WHERE id = ?', [String(row?.contact_id)],
    );
    expect(contact?.owner_user_id, 'the person follows the lead').toBe(agent.id);
  });

  it('shares the normal leads evenly and never shares a VIP one', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });

    const leads = [await freeLead(), await freeLead(), await freeLead(), await freeLead()];
    const vip = await freeLead({ vip: true });

    const res = await send('POST', '/api/v2/incoming/share', await signIn(base, boss), {
      opportunityIds: [...leads, vip],
      agentUserIds: [one.id, two.id],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as {
      given: number; vipSkipped: number; perAgent: Array<{ agentUserId: string; n: number }>;
    };

    expect(body.given).toBe(4);
    expect(body.vipSkipped, 'a VIP lead is given by hand, never swept into a split').toBe(1);
    expect(body.perAgent.map((p) => p.n).sort()).toEqual([2, 2]);

    const stillFree = await queryOne<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM opportunities WHERE id = ?', [vip],
    );
    expect(stillFree?.owner_user_id).toBeNull();
  });

  it('an agent cannot share leads out', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const other = await createTestUser({ role: 'agent', name: 'Other' });
    const lead = await freeLead();

    const res = await send('POST', '/api/v2/incoming/share', await signIn(base, agent), {
      opportunityIds: [lead], agentUserIds: [other.id],
    });
    expect(res.status).toBe(403);
  });
});
