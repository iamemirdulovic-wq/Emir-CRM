import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
  type TestUser,
} from '../testing/db.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';

/**
 * Four screens, one headcount.
 *
 * The owner opened four screens on 13 Nov and was told his floor had 14, 11,
 * 12 and 17 people on it:
 *
 *  - the dashboards counted `agent` + `manager`;
 *  - attendance counted everybody but the owner, so the **admin** was in the
 *    register as somebody being measured on turning up;
 *  - Best of Homes and the team wall's ranking counted everybody but the
 *    service account, so the **owner and the admin were ranked as agents**;
 *  - "who has the CRM open", the list under Team live, had no role filter at
 *    all and showed the owner among his own agents.
 *
 * One office of four people — an owner, an admin, a manager and an agent —
 * and every screen has to say two. That is the whole test: a number, pinned,
 * on every surface that reads it, so the next person to add a screen cannot
 * invent a fifth rule without this failing.
 */
let server: Server;
let base = '';

describeWithDb('how many agents', () => {
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

  /** The whole office. Signed in, so the presence list has rows to filter. */
  async function theOffice(): Promise<{
    owner: TestUser; admin: TestUser; manager: TestUser; agent: TestUser; cookie: string;
  }> {
    const owner = await createTestUser({ role: 'owner', name: 'Emir' });
    const admin = await createTestUser({ role: 'admin', name: 'Admin Person' });
    const manager = await createTestUser({ role: 'manager', name: 'Manager Person' });
    const agent = await createTestUser({ role: 'agent', name: 'Agent Person' });
    await createTestUser({ role: 'automation', name: 'The CRM' });

    /* Everybody signs in, so "who has the CRM open" would list all four if it
       were not filtering — which is exactly how it shipped. */
    const cookie = await signIn(base, owner);
    await signIn(base, admin);
    await signIn(base, manager);
    await signIn(base, agent);
    return { owner, admin, manager, agent, cookie };
  }

  const get = async (path: string, cookie: string): Promise<Record<string, unknown>> => {
    const res = await fetch(`${base}${path}`, { headers: { cookie } });
    expect(res.status, path).toBe(200);
    return await res.json() as Record<string, unknown>;
  };

  const names = (rows: unknown): string[] =>
    (rows as Array<{ name?: string }>).map((row) => String(row.name)).sort();

  it('is the agents and their managers, on every screen that counts them', async () => {
    const { manager, agent, cookie } = await theOffice();
    const expected = [agent.id, manager.id].sort();
    const expectedNames = ['Agent Person', 'Manager Person'];

    /* The owner's dashboard: the per-agent table. */
    const dashboard = await get('/api/v2/dashboard?period=today', cookie);
    expect(names(dashboard.agents)).toEqual(expectedNames);

    /* Attendance, where the admin used to appear. */
    const attendance = await get('/api/v2/attendance/team', cookie);
    expect(names(attendance.people)).toEqual(expectedNames);
    expect(
      (attendance.people as Array<{ role: string }>).map((row) => row.role).sort(),
    ).toEqual(['agent', 'manager']);

    /* Best of Homes and the wall's sidebar, where the owner used to be ranked
       among his own agents. Everybody is on it even on nil points, so the
       count is the roster rather than who happened to earn something. */
    const sidebar = await get('/api/wall/sidebar', cookie);
    expect(names(sidebar.leaderboard)).toEqual(expectedNames);

    /* Team live: the roster beside the clicks-by-hour chart. */
    const live = await get('/api/v2/live', cookie);
    expect(names(live.agents)).toEqual(expectedNames);
    expect(
      (live.agents as Array<{ userId: string }>).map((row) => row.userId).sort(),
    ).toEqual(expected);

    /* And who has the CRM open, under it. All four signed in. */
    const signedIn = await get('/api/activity/team', cookie);
    expect(names(signedIn.items)).toEqual(expectedNames);
  });

  it('never counts the owner, the admin or the service account as an agent', async () => {
    const { cookie } = await theOffice();
    const forbidden = ['Emir', 'Admin Person', 'The CRM'];

    for (const [path, key] of [
      ['/api/v2/dashboard?period=today', 'agents'],
      ['/api/v2/attendance/team', 'people'],
      ['/api/wall/sidebar', 'leaderboard'],
      ['/api/v2/live', 'agents'],
      ['/api/activity/team', 'items'],
    ] as const) {
      const body = await get(path, cookie);
      for (const name of forbidden) {
        expect(names(body[key]), `${path} lists ${name}`).not.toContain(name);
      }
    }
  });

  /*
   * A manager carries leads and is on the register, so a manager is counted —
   * which is the half of the rule that is easy to lose when somebody "fixes"
   * this by filtering on `role = 'agent'`.
   */
  it('counts a manager, who carries leads like anybody else', async () => {
    const owner = await createTestUser({ role: 'owner', name: 'Emir' });
    await createTestUser({ role: 'manager', name: 'Manager Person' });
    const cookie = await signIn(base, owner);

    for (const [path, key] of [
      ['/api/v2/dashboard?period=today', 'agents'],
      ['/api/v2/attendance/team', 'people'],
      ['/api/wall/sidebar', 'leaderboard'],
      ['/api/v2/live', 'agents'],
    ] as const) {
      expect(names((await get(path, cookie))[key]), path).toEqual(['Manager Person']);
    }
  });

  /* A deactivated person is history, not a row of absences growing every
     morning, and not a name on a leaderboard either. */
  it('leaves out somebody who no longer works here', async () => {
    const { agent, cookie } = await theOffice();
    const res = await fetch(`${base}/api/users/${agent.id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(200);

    const live = await get('/api/v2/live', cookie);
    expect(names(live.agents)).toEqual(['Manager Person']);
  });
});
