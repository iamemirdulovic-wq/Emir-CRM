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

/**
 * Reporting a bug, and the owner's inbox.
 *
 * The rules worth testing: anybody may report, nobody but an owner or admin
 * reads everybody's, and "it stops me working" sorts above everything else
 * however old it is — a single list sorted by date buries the agent who
 * cannot work today under last week's ideas.
 */
let server: Server;
let base = '';

describeWithDb('feedback', () => {
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

  it('keeps the screen the agent was on, without asking for it', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const res = await send('POST', '/api/v2/feedback', await signIn(base, agent), {
      kind: 'bug', body: 'The call button does nothing on the lead page.', screen: '/v2/leads/o-1',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const made = await res.json() as { screen: string; status: string; blocking: boolean };
    expect(made.screen).toBe('/v2/leads/o-1');
    expect(made.status).toBe('new');
    expect(made.blocking).toBe(false);
  });

  it('puts what stops somebody working at the top, however old', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, agent);

    await send('POST', '/api/v2/feedback', cookie, { kind: 'bug', body: 'Blocks me.', blocking: true });
    await send('POST', '/api/v2/feedback', cookie, { kind: 'idea', body: 'Would be nice one day.' });

    const inbox = await (await send('GET', '/api/v2/feedback', await signIn(base, owner))).json() as {
      items: Array<{ body: string; blocking: boolean }>;
      counts: Record<string, number>;
    };
    /* The idea was sent later, so a plain date sort would put it first. */
    expect(inbox.items[0]?.blocking).toBe(true);
    expect(inbox.counts.blocking).toBe(1);
    expect(inbox.counts.new).toBe(2);
  });

  it('keeps one agent out of everybody else\'s reports', async () => {
    const one = await createTestUser({ role: 'agent' });
    const two = await createTestUser({ role: 'agent' });
    await send('POST', '/api/v2/feedback', await signIn(base, two), { kind: 'bug', body: 'Theirs.' });

    const cookie = await signIn(base, one);
    /* The inbox is refused outright. */
    expect((await send('GET', '/api/v2/feedback', cookie)).status).toBe(403);
    /* And their own list is their own. */
    const mine = await (await send('GET', '/api/v2/feedback/mine', cookie)).json() as { items: unknown[] };
    expect(mine.items).toHaveLength(0);
  });

  it('records the answer against whoever gave it', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const owner = await createTestUser({ role: 'owner' });
    const made = await (await send('POST', '/api/v2/feedback', await signIn(base, agent), {
      kind: 'bug', body: 'Something is broken.',
    })).json() as { id: string };

    const answered = await (await send('PATCH', `/api/v2/feedback/${made.id}`, await signIn(base, owner), {
      status: 'fixed', reply: 'Fixed this morning.',
    })).json() as { status: string; reply: string; repliedBy: string };

    expect(answered.status).toBe('fixed');
    expect(answered.reply).toBe('Fixed this morning.');
    /* Whoever answered is named, so an agent is not replied to by "the
       system". The test user's name is fixed by the helper. */
    expect(answered.repliedBy).toBeTruthy();

    /* And the agent can see the answer, which is the point of replying. */
    const mine = await (await send('GET', '/api/v2/feedback/mine', await signIn(base, agent))).json() as {
      items: Array<{ reply: string | null }>;
    };
    expect(mine.items[0]?.reply).toBe('Fixed this morning.');
  });
});
