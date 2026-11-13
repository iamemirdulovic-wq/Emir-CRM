import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';
import { query } from '../../db/client.js';

/**
 * My signed-in devices — the list `design/web/profile.html` draws on its
 * Security tab, and the two buttons beside it.
 *
 * The rules this holds are the ones that would be a security hole if they
 * were wrong rather than merely untidy:
 *
 *   - a person is served their own sessions and nobody else's;
 *   - the id in the URL is the hash of a live token, so a session that is
 *     not yours cannot be ended by guessing one;
 *   - "Sign out all others" keeps the device that pressed it;
 *   - every revocation is in `audit_log`, with who did it.
 */
let server: Server;
let base = '';

async function sessions(cookie: string): Promise<{
  items: Array<{ id: string; current: boolean; device: string; handheld: boolean }>;
}> {
  const res = await fetch(`${base}/api/auth/sessions`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json() as Promise<{ items: Array<{
    id: string; current: boolean; device: string; handheld: boolean;
  }> }>;
}

describeWithDb('my signed-in devices', () => {
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
  });
  afterEach(() => resetRateLimits());

  it('lists my own sessions and marks the one asking', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const first = await signIn(base, agent);
    const second = await signIn(base, agent);

    const mine = await sessions(second);
    expect(mine.items).toHaveLength(2);
    expect(mine.items.filter((one) => one.current)).toHaveLength(1);
    expect(mine.items.every((one) => typeof one.device === 'string')).toBe(true);
    /* The first cookie is still live and sees the same two. */
    expect((await sessions(first)).items).toHaveLength(2);
  });

  it('never shows one person another person\'s devices', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const other = await createTestUser({ role: 'agent' });
    await signIn(base, other);
    await signIn(base, other);
    const cookie = await signIn(base, agent);

    const mine = await sessions(cookie);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]?.current).toBe(true);
  });

  it('signs one of my own devices out, and writes it down', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const phone = await signIn(base, agent);
    const here = await signIn(base, agent);

    const other = (await sessions(here)).items.find((one) => !one.current);
    expect(other).toBeTruthy();

    const res = await fetch(`${base}/api/auth/sessions/${other?.id}`, {
      method: 'DELETE', headers: { cookie: here },
    });
    expect(res.status).toBe(200);

    /* Gone from the list, and the cookie it belonged to no longer works. */
    expect((await sessions(here)).items).toHaveLength(1);
    const dead = await fetch(`${base}/api/auth/me`, { headers: { cookie: phone } });
    expect(dead.status).toBe(401);

    const audit = await query<{ action: string; actor_user_id: string }>(
      "SELECT action, actor_user_id FROM audit_log WHERE action = 'auth.session_revoked'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_user_id).toBe(agent.id);
  });

  it('refuses to end somebody else\'s session', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const other = await createTestUser({ role: 'agent' });
    const theirs = await signIn(base, other);
    const mine = await signIn(base, agent);

    const target = (await sessions(theirs)).items[0];
    const res = await fetch(`${base}/api/auth/sessions/${target?.id}`, {
      method: 'DELETE', headers: { cookie: mine },
    });
    expect(res.status).toBe(400);
    /* Still signed in. */
    expect((await fetch(`${base}/api/auth/me`, { headers: { cookie: theirs } })).status).toBe(200);
  });

  it('refuses to end the device that is asking', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const here = await signIn(base, agent);
    const own = (await sessions(here)).items.find((one) => one.current);

    const res = await fetch(`${base}/api/auth/sessions/${own?.id}`, {
      method: 'DELETE', headers: { cookie: here },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Sign out here');
  });

  it('signs out all the others and keeps this one', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const one = await signIn(base, agent);
    const two = await signIn(base, agent);
    const here = await signIn(base, agent);

    const res = await fetch(`${base}/api/auth/sessions`, {
      method: 'DELETE', headers: { cookie: here },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, signedOut: 2 });

    expect((await sessions(here)).items).toHaveLength(1);
    for (const gone of [one, two]) {
      expect((await fetch(`${base}/api/auth/me`, { headers: { cookie: gone } })).status).toBe(401);
    }

    const audit = await query<{ after_json: string | null }>(
      "SELECT after_json FROM audit_log WHERE action = 'auth.sessions_revoked'",
    );
    expect(audit).toHaveLength(1);
  });

  it('is shut to somebody who is not signed in', async () => {
    expect((await fetch(`${base}/api/auth/sessions`)).status).toBe(401);
    expect((await fetch(`${base}/api/auth/sessions`, { method: 'DELETE' })).status).toBe(401);
  });
});
