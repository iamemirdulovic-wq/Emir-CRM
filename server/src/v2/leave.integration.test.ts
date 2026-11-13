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

/**
 * Asking for days off, and answering.
 *
 * The rules under test are the ones that stop an argument three weeks later:
 * days are counted when the request is made and kept, a refusal carries a
 * reason, and nobody can answer or cancel somebody else's request.
 */
let server: Server;
let base = '';

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describeWithDb('leave', () => {
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

  it('counts the working days and keeps them', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const res = await send('POST', '/api/v2/leave', await signIn(base, agent), {
      kind: 'annual', fromDate: day(7), toDate: day(13), reason: 'Family wedding',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const made = await res.json() as { workingDays: number; status: string };

    /* Seven calendar days, with the office shut one day a week by default. */
    expect(made.workingDays).toBe(6);
    expect(made.status).toBe('pending');

    const kept = await queryOne<{ working_days: number }>(
      'SELECT working_days FROM leave_requests LIMIT 1',
    );
    expect(Number(kept?.working_days), 'the number is stored, not recomputed later').toBe(6);
  });

  /*
   * `docs/v2/tester-rules.md` §52 and rule R31: Yuliia asked for the same
   * days twice on the prototype and both requests were taken. The screen
   * shows the clash in a red banner before the button is pressed; this is
   * the half of the rule that holds when the screen is not there.
   */
  it('will not take the same days twice', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const first = await send('POST', '/api/v2/leave', cookie, {
      kind: 'annual', fromDate: day(7), toDate: day(10), reason: 'Family wedding',
    });
    expect(first.status).toBe(201);

    /* Right across it, and overlapping only its last day. */
    for (const range of [[day(7), day(10)], [day(10), day(14)], [day(5), day(8)]]) {
      const again = await send('POST', '/api/v2/leave', cookie, {
        kind: 'annual', fromDate: range[0], toDate: range[1], reason: 'Again',
      });
      expect(again.status, `${range[0]} to ${range[1]}`).toBe(400);
      expect(await again.text()).toContain('You already asked for these days.');
    }

    /* Days after it are fine, and so is somebody else asking for the same. */
    const after = await send('POST', '/api/v2/leave', cookie, {
      kind: 'annual', fromDate: day(20), toDate: day(21), reason: 'Trip',
    });
    expect(after.status).toBe(201);

    const colleague = await createTestUser({ role: 'agent' });
    const theirs = await send('POST', '/api/v2/leave', await signIn(base, colleague), {
      kind: 'annual', fromDate: day(7), toDate: day(10), reason: 'Same week',
    });
    expect(theirs.status).toBe(201);
  });

  it('refuses leave that starts in the past', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const res = await send('POST', '/api/v2/leave', await signIn(base, agent), {
      kind: 'annual', fromDate: day(-3), toDate: day(1),
    });
    expect(res.status).toBe(400);
  });

  it('will not take a refusal without a reason', async () => {
    const boss = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const asked = await (await send('POST', '/api/v2/leave', await signIn(base, agent), {
      kind: 'sick', fromDate: day(1), toDate: day(1),
    })).json() as { id: string };

    const bare = await send('PATCH', `/api/v2/leave/${asked.id}`, await signIn(base, boss), {
      status: 'refused',
    });
    expect(bare.status, 'a "no" with nothing after it is what nobody can act on').toBe(400);

    const withReason = await send('PATCH', `/api/v2/leave/${asked.id}`, await signIn(base, boss), {
      status: 'refused', note: 'Launch week — talk to me first.',
    });
    expect(withReason.status).toBe(200);
    expect(await withReason.json()).toMatchObject({
      status: 'refused', decisionNote: 'Launch week — talk to me first.',
    });
  });

  it('an agent cannot answer their own request', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const asked = await (await send('POST', '/api/v2/leave', cookie, {
      kind: 'annual', fromDate: day(2), toDate: day(3),
    })).json() as { id: string };

    const res = await send('PATCH', `/api/v2/leave/${asked.id}`, cookie, { status: 'approved' });
    expect(res.status).toBe(403);
  });

  it('cancelling is yours alone, and only before it is answered', async () => {
    const one = await createTestUser({ role: 'agent', name: 'One' });
    const two = await createTestUser({ role: 'agent', name: 'Two' });
    const boss = await createTestUser({ role: 'owner' });
    const mine = await signIn(base, one);

    const asked = await (await send('POST', '/api/v2/leave', mine, {
      kind: 'annual', fromDate: day(4), toDate: day(5),
    })).json() as { id: string };

    const theirs = await send('POST', `/api/v2/leave/${asked.id}/cancel`, await signIn(base, two));
    expect(theirs.status).toBe(403);

    await send('PATCH', `/api/v2/leave/${asked.id}`, await signIn(base, boss), { status: 'approved' });
    const late = await send('POST', `/api/v2/leave/${asked.id}/cancel`, mine);
    expect(late.status, 'once it is answered it is a decision, not a draft').toBe(400);
  });

  it('shows an agent their own month and nobody else’s', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const res = await send('GET', '/api/v2/attendance/me', await signIn(base, agent));
    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    expect(body).toHaveProperty('today');
    expect(body).toHaveProperty('days');
    expect(body).toHaveProperty('leave');
    expect(body, 'an agent is not handed the team grid').not.toHaveProperty('people');
  });

  it('keeps the team grid away from agents', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const res = await send('GET', '/api/v2/attendance/team', await signIn(base, agent));
    expect(res.status).toBe(403);
  });
});
