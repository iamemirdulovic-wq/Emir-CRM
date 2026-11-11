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
 * "Next lead" walks the list. All of it, once each.
 *
 * Emir's agents, 11 Nov: "it's just repeating only first two leads all over
 * again." They were right, and it had been doing that since the button was
 * built: it asked for "the oldest open lead that is not this one", which from
 * the oldest gives you the second and from the second gives you the oldest.
 *
 * The test that existed only asked whether a next lead came back at all, so
 * it passed throughout. This one does what an agent does -- press the button
 * until it stops -- and checks what that journey was.
 */
let server: Server;
let base = '';

describeWithDb('walking the leads with Next lead', () => {
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
    phoneSeq = 0;
  });
  afterEach(() => resetRateLimits());

  async function stage() {
    const row = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    if (!row) throw new Error('no seeded pipeline stages');
    return row;
  }

  /**
   * Leads that all arrived in the same second.
   *
   * Not a contrivance: a file of six hundred imported leads shares a
   * `created_at` to the second, which is exactly when an order with no
   * tiebreaker starts handing rows back in a different sequence each time.
   */
  /* Phones are unique across the whole CRM, so the counter has to be too:
     two agents each given three leads is six different people. */
  let phoneSeq = 0;

  async function leadsForAgent(owner: string, count: number): Promise<string[]> {
    const s = await stage();
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const contactId = newId();
      phoneSeq += 1;
      await execute(
        'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
        [contactId, `Lead ${String(i).padStart(2, '0')}`, `+97150${String(1_000_000 + phoneSeq)}`],
      );
      const opportunityId = newId();
      await execute(
        `INSERT INTO opportunities
           (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 'csv_import', NOW(3))`,
        [opportunityId, contactId, s.pipeline_id, s.id, s.key, owner, `Lead ${i}`],
      );
      ids.push(opportunityId);
    }
    return ids;
  }

  /** Press the button until it stops, and report where it went. */
  async function walk(cookie: string, startId: string, tab = 'all'): Promise<string[]> {
    const seen: string[] = [];
    let at = startId;
    for (let guard = 0; guard < 60; guard++) {
      const res = await fetch(`${base}/api/my-leads/${at}/next?tab=${tab}`, { headers: { cookie } });
      expect(res.status, await res.clone().text()).toBe(200);
      const { next } = await res.json() as { next: { id: string } | null };
      if (!next) return seen;
      seen.push(next.id);
      at = next.id;
    }
    throw new Error('the walk never ended');
  }

  it('visits every lead once and then stops', async () => {
    const agent = await createTestUser({ role: 'agent', name: 'Test Agents' });
    const ids = await leadsForAgent(agent.id, 8);
    const cookie = await signIn(base, agent);

    /* Starting from the first of the list, the other seven follow. */
    const first = await (await fetch(`${base}/api/my-leads?tab=all&pageSize=50`, { headers: { cookie } })).json() as {
      items: { id: string }[];
    };
    expect(first.items).toHaveLength(8);

    const seen = await walk(cookie, first.items[0]!.id);

    expect(seen, 'seven more, then nothing').toHaveLength(7);
    expect(new Set(seen).size, 'and no lead twice').toBe(7);
    expect(seen).not.toContain(first.items[0]!.id);
    /* The same order the agent is looking at, not an order of its own. */
    expect(seen).toEqual(first.items.slice(1).map((row) => row.id));
    expect(ids).toEqual(expect.arrayContaining(seen));
  });

  it('does not bounce between the first two', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await leadsForAgent(agent.id, 5);
    const cookie = await signIn(base, agent);

    const list = await (await fetch(`${base}/api/my-leads?tab=all&pageSize=50`, { headers: { cookie } })).json() as {
      items: { id: string }[];
    };
    const second = await walk(cookie, list.items[0]!.id);
    /* The exact shape of the bug: A, B, A, B, ... */
    expect(second.slice(0, 2)).not.toEqual([list.items[1]!.id, list.items[0]!.id]);
    expect(second).toHaveLength(4);
  });

  it('walks the tab the agent is on, not a different list', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await leadsForAgent(agent.id, 4);
    const cookie = await signIn(base, agent);

    /* Every one of these is a New Lead with nothing promised, so the New
       tab and the All tab hold the same four in their own orders. */
    const newTab = await (await fetch(`${base}/api/my-leads?tab=new&pageSize=50`, { headers: { cookie } })).json() as {
      items: { id: string }[];
    };
    expect(newTab.items).toHaveLength(4);

    const seen = await walk(cookie, newTab.items[0]!.id, 'new');
    expect(seen).toEqual(newTab.items.slice(1).map((row) => row.id));
  });

  it('offers nothing when this is the only lead', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const [only] = await leadsForAgent(agent.id, 1);
    const cookie = await signIn(base, agent);

    expect(await walk(cookie, only!)).toEqual([]);
  });

  it('never offers an agent somebody else’s lead', async () => {
    const mine = await createTestUser({ role: 'agent', name: 'Mine' });
    const theirs = await createTestUser({ role: 'agent', name: 'Theirs' });
    await leadsForAgent(mine.id, 3);
    const others = await leadsForAgent(theirs.id, 3);
    const cookie = await signIn(base, mine);

    /* From the top of HIS list -- All reads newest first, so the lead
       created first is the last one, with nothing after it. */
    const list = await (await fetch(`${base}/api/my-leads?tab=all&pageSize=50`, { headers: { cookie } })).json() as {
      items: { id: string }[];
    };
    expect(list.items, 'he sees only his own three').toHaveLength(3);

    const seen = await walk(cookie, list.items[0]!.id);
    for (const id of seen) expect(others).not.toContain(id);
    expect(seen).toHaveLength(2);
  });
});
