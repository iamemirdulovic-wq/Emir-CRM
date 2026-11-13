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
import { MAX_BANNERS } from './banners.js';

/**
 * The banners on My Day.
 *
 * The limit is the rule worth testing, and it is enforced on the server
 * rather than only by a disabled button: six banners rotating is not five
 * plus one, it is a carousel nobody waits through, and the sixth is the one
 * nobody ever sees.
 */
let server: Server;
let base = '';

describeWithDb('home banners', () => {
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

  it('refuses a sixth banner, and says why in words', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);

    for (let i = 0; i < MAX_BANNERS; i += 1) {
      const res = await send('POST', '/api/v2/banners', cookie, { title: `Banner ${i + 1}` });
      expect(res.status, await res.clone().text()).toBe(201);
    }

    const sixth = await send('POST', '/api/v2/banners', cookie, { title: 'One too many' });
    expect(sixth.status).toBe(400);
    expect(await sixth.text()).toContain('Switch one off');

    /* Switching one off makes room, which is the way out the message names. */
    const all = await (await send('GET', '/api/v2/banners', cookie)).json() as {
      items: Array<{ id: string }>;
    };
    await send('PATCH', `/api/v2/banners/${all.items[0]?.id}`, cookie, { isActive: false });
    expect((await send('POST', '/api/v2/banners', cookie, { title: 'Now there is room' })).status).toBe(201);
  });

  it('counts a banner switched back on against the limit too', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);

    const off = await (await send('POST', '/api/v2/banners', cookie, {
      title: 'Off for now', isActive: false,
    })).json() as { id: string };
    for (let i = 0; i < MAX_BANNERS; i += 1) {
      await send('POST', '/api/v2/banners', cookie, { title: `Banner ${i + 1}` });
    }

    const back = await send('PATCH', `/api/v2/banners/${off.id}`, cookie, { isActive: true });
    expect(back.status).toBe(400);
  });

  it('keeps an agent out of them entirely', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    expect((await send('GET', '/api/v2/banners', cookie)).status).toBe(403);
    expect((await send('POST', '/api/v2/banners', cookie, { title: 'Mine now' })).status).toBe(403);
  });

  it('saves a new order in one go', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const made: string[] = [];
    for (const title of ['First', 'Second', 'Third']) {
      const one = await (await send('POST', '/api/v2/banners', cookie, { title })).json() as { id: string };
      made.push(one.id);
    }

    const flipped = [made[2], made[0], made[1]] as string[];
    const after = await (await send('POST', '/api/v2/banners/order', cookie, { ids: flipped })).json() as {
      items: Array<{ id: string; title: string }>;
    };
    expect(after.items.map((one) => one.title)).toEqual(['Third', 'First', 'Second']);
  });
});
