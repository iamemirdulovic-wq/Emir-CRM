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
import { ALWAYS_ON, everySwitch } from './notify-prefs.js';

/**
 * What each person wants to hear about.
 *
 * Three rules are worth a test rather than a comment. A VIP alert cannot be
 * switched off, in the database and not only in the UI, because that switch
 * is the difference between a short clock and a missed one. Only the
 * differences from the default are stored, so a switch added later arrives on
 * for everybody. And one person's settings are never reachable from another's
 * session.
 */
let server: Server;
let base = '';

describeWithDb('notification settings', () => {
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

  it('starts with sensible defaults and stores nothing', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const res = await send('GET', '/api/v2/notify', await signIn(base, agent));
    expect(res.status, await res.clone().text()).toBe(200);
    const got = await res.json() as {
      switches: Record<string, boolean>;
      quiet: string | null;
      groups: Array<{ key: string; switches: Array<{ id: string; note: string }> }>;
    };

    /* Leads are on by default; the noisy ones are not. */
    expect(got.switches.new_lead).toBe(true);
    expect(got.switches.vip_lead).toBe(true);
    expect(got.switches.wall).toBe(false);
    expect(got.quiet).toBe('22:00-08:00');

    /* Every switch the server honours is described to the screen, with the
       wording that makes it a decision somebody can make. */
    const described = got.groups.flatMap((group) => group.switches.map((one) => one.id));
    expect(described.sort()).toEqual(everySwitch().sort());
    for (const group of got.groups) {
      for (const one of group.switches) expect(one.note.length).toBeGreaterThan(10);
    }

    /* Nothing written: somebody who has not touched the screen has no row. */
    const row = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM user_prefs WHERE user_id = ? AND name = 'notify'",
      [agent.id],
    );
    expect(Number(row?.n)).toBe(0);
  });

  it('stores only what was changed', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);

    await send('PUT', '/api/v2/notify', cookie, { switches: { new_lead: false, wall: true } });

    const row = await queryOne<{ value: string }>(
      "SELECT value FROM user_prefs WHERE user_id = ? AND name = 'notify'",
      [agent.id],
    );
    const stored = JSON.parse(row?.value ?? '{}') as { off: string[]; on: string[] };
    /* Two differences, not thirty values. */
    expect(stored.off).toEqual(['new_lead']);
    expect(stored.on).toEqual(['wall']);

    const again = await (await send('GET', '/api/v2/notify', cookie)).json() as {
      switches: Record<string, boolean>;
    };
    expect(again.switches.new_lead).toBe(false);
    expect(again.switches.wall).toBe(true);
    /* Everything untouched is still at its default. */
    expect(again.switches.followup_due).toBe(true);
  });

  it('refuses to switch off a VIP alert, in the database and not only on screen', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);

    for (const key of ALWAYS_ON) {
      const res = await send('PUT', '/api/v2/notify', cookie, { switches: { [key]: false } });
      expect(res.status).toBe(200);
      const got = await res.json() as { switches: Record<string, boolean> };
      expect(got.switches[key], `${key} must stay on`).toBe(true);
    }

    const row = await queryOne<{ value: string }>(
      "SELECT value FROM user_prefs WHERE user_id = ? AND name = 'notify'",
      [agent.id],
    );
    const stored = JSON.parse(row?.value ?? '{}') as { off: string[] };
    for (const key of ALWAYS_ON) expect(stored.off).not.toContain(key);
  });

  it('keeps one person out of another person\'s settings', async () => {
    const one = await createTestUser({ role: 'agent' });
    const two = await createTestUser({ role: 'agent' });
    const cookieOne = await signIn(base, one);
    const cookieTwo = await signIn(base, two);

    await send('PUT', '/api/v2/notify', cookieOne, { switches: { new_lead: false } });

    const other = await (await send('GET', '/api/v2/notify', cookieTwo)).json() as {
      switches: Record<string, boolean>;
    };
    expect(other.switches.new_lead).toBe(true);
  });

  it('ignores a switch it has never heard of', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const res = await send('PUT', '/api/v2/notify', cookie, {
      switches: { there_is_no_such_switch: false },
    });
    expect(res.status).toBe(200);
    const stored = await queryOne<{ value: string }>(
      "SELECT value FROM user_prefs WHERE user_id = ? AND name = 'notify'",
      [agent.id],
    );
    expect(stored?.value ?? '').not.toContain('there_is_no_such_switch');
  });

  it('only accepts a quiet-hours window it offers', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    expect((await send('PUT', '/api/v2/notify', cookie, { quiet: '03:00-04:00' })).status).toBe(400);
    expect((await send('PUT', '/api/v2/notify', cookie, { quiet: null })).status).toBe(200);
    const got = await (await send('GET', '/api/v2/notify', cookie)).json() as { quiet: string | null };
    expect(got.quiet).toBeNull();
  });
});
