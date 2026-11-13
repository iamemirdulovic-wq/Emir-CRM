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

/**
 * Desks, and the limit on one.
 *
 * Three things are worth a test here, and each of them is a thing that would
 * be wrong quietly. The limit has to survive the round trip, or the screen
 * measures everybody against a number nobody set. Deleting a desk must leave
 * the agents' leads alone, because that is what the screen promises in words
 * before it does it. And an agent must not be able to read the page at all:
 * it says how many leads each of their colleagues is carrying.
 */
let server: Server;
let base = '';

describeWithDb('desks', () => {
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

  type DeskList = {
    items: Array<{
      id: string; name: string; maxOpenLeads: number | null;
      members: Array<{ userId: string; name: string; openLeads: number }>;
    }>;
    agents: Array<{ userId: string; name: string; openLeads: number; deskIds: string[] }>;
  };

  it('keeps the limit and the members it was given', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });

    const made = await send('POST', '/api/v2/desks', cookie, {
      name: 'Arabic desk', maxOpenLeads: 50, memberIds: [sara.id, omar.id],
    });
    expect(made.status, await made.clone().text()).toBe(201);

    const list = await (await send('GET', '/api/v2/desks', cookie)).json() as DeskList;
    const desk = list.items.find((one) => one.name === 'Arabic desk');
    expect(desk?.maxOpenLeads).toBe(50);
    expect(desk?.members.map((one) => one.name).sort()).toEqual(['Omar', 'Sara']);

    /* The picker has to say which desks somebody is already on, or an owner
       cannot see that one agent is sitting on two. */
    expect(list.agents.find((one) => one.userId === sara.id)?.deskIds).toEqual([desk?.id]);

    await send('PATCH', `/api/v2/desks/${desk?.id}`, cookie, { maxOpenLeads: 80, memberIds: [omar.id] });
    const after = await (await send('GET', '/api/v2/desks', cookie)).json() as DeskList;
    const changed = after.items.find((one) => one.id === desk?.id);
    expect(changed?.maxOpenLeads).toBe(80);
    expect(changed?.members.map((one) => one.name)).toEqual(['Omar']);
  });

  it('refuses a second desk with the same name, in words', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);

    await send('POST', '/api/v2/desks', cookie, { name: 'Dubai', maxOpenLeads: 60, memberIds: [] });
    const again = await send('POST', '/api/v2/desks', cookie, {
      name: 'Dubai', maxOpenLeads: 40, memberIds: [],
    });
    expect(again.status).toBe(400);
    expect(await again.text()).toContain('already a desk with this name');
  });

  it('deleting a desk leaves the agents their leads', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });

    /* `opportunities.stage_id` is a foreign key, so the lead needs a real
       seeded stage — those survive resetTables. */
    const stage = await queryOne<{ id: string; pipeline_id: string }>(
      "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'new_lead' LIMIT 1", [],
    );
    await execute(
      `INSERT INTO contacts (id, full_name, phone_e164, first_source)
       VALUES ('c-desk', 'A Buyer', '+971500000111', 'manual')`,
    );
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, status, owner_user_id, source)
       VALUES ('o-desk', 'c-desk', ?, ?, 'new_lead', 'open', ?, 'manual')`,
      [stage?.pipeline_id, stage?.id, sara.id],
    );

    const madeRes = await send('POST', '/api/v2/desks', cookie, {
      name: 'Dubai off-plan', maxOpenLeads: 60, memberIds: [sara.id],
    });
    expect(madeRes.status, await madeRes.clone().text()).toBe(201);
    const made = await madeRes.json() as { id: string };

    const beforeRes = await send('GET', '/api/v2/desks', cookie);
    expect(beforeRes.status, await beforeRes.clone().text()).toBe(200);
    const before = await beforeRes.json() as DeskList;
    expect(before.items[0]?.members[0]?.openLeads).toBe(1);

    expect((await send('DELETE', `/api/v2/desks/${made.id}`, cookie)).status).toBe(200);

    const after = await (await send('GET', '/api/v2/desks', cookie)).json() as DeskList;
    expect(after.items).toHaveLength(0);
    /* The desk is gone; the lead is not. */
    expect(after.agents.find((one) => one.userId === sara.id)?.openLeads).toBe(1);
  });

  it('keeps an agent out of them entirely', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    expect((await send('GET', '/api/v2/desks', cookie)).status).toBe(403);
    expect((await send('POST', '/api/v2/desks', cookie, {
      name: 'Mine now', maxOpenLeads: 40, memberIds: [],
    })).status).toBe(403);
  });
});
