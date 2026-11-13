import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, query,
  resetTables,
} from '../../testing/db.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';
import { newId } from '../../lib/ids.js';

/**
 * The owner's settings screens, and the rules behind them.
 *
 * `docs/v2/audit-4.md` found the same fault on seven of these pages: the
 * screen opened for an agent and the data behind it was refused, so what an
 * agent saw was a page frame and a red line. The screen-side block is
 * `web/src/v2/OwnerOnly.tsx`; these are the refusals it stands in front of,
 * plus the four rules the audit found had no enforcement anywhere:
 *
 *  - an owner can never be deactivated (§4.13), on the server as well as on
 *    the screen — on a one-owner installation, allowing it locks everybody
 *    out of their own CRM and there is no way back in;
 *  - an admin cannot change, deactivate or sign out an owner;
 *  - the Homes AI budget is owner and admin, not manager;
 *  - a report's attachments belong to whoever sent it.
 */
let server: Server;
let base = '';

const json = { 'content-type': 'application/json' } as const;

describeWithDb('the owner settings endpoints', () => {
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

  /* ── the doors ──────────────────────────────────────────────────────── */

  const SHUT: Array<[string, string]> = [
    /* The roster with email addresses, last sign-ins, open-lead counts and
       whose phone is registered. `GET /api/users` stays open because half the
       CRM needs a colleague's name; this one is the owner's file. */
    ['GET', '/api/v2/team/roles'],
    ['POST', '/api/v2/team/remind-alerts'],
    /* The whole feedback inbox, including other people's reports. */
    ['GET', '/api/v2/feedback/export.csv'],
    /* The AI budget and what it is told about the company. */
    ['GET', '/api/ai/usage'],
    ['GET', '/api/ai/knowledge'],
    /* The attendance file: every agent, every day, every late minute. */
    ['GET', '/api/attendance/report.csv'],
    ['GET', '/api/attendance/report/months'],
    /* The health page: which keys are set, and who has no phone. */
    ['GET', '/api/v2/health'],
    ['POST', '/api/v2/health/check'],
  ];

  for (const [method, path] of SHUT) {
    it(`${method} ${path} is shut to an agent`, async () => {
      const agent = await createTestUser({ role: 'agent' });
      const cookie = await signIn(base, agent);
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { Cookie: cookie, ...json },
        body: method === 'GET' ? undefined : JSON.stringify({ userIds: [agent.id] }),
      });
      expect(res.status, `${method} ${path} let an agent through`).toBe(403);
      /* And it does not hand the role names to the person reading it. */
      expect(await res.text()).not.toContain('requires one of');
    });
  }

  /*
   * A manager is not an owner here.
   *
   * These two used to be `requireManager`, so a manager read the company's
   * monthly AI bill and the budget switches. `design/web/ai-settings.html` is
   * marked `data-role="owner"`.
   */
  for (const path of ['/api/ai/usage', '/api/ai/knowledge']) {
    it(`${path} is shut to a manager too`, async () => {
      const manager = await createTestUser({ role: 'manager' });
      const cookie = await signIn(base, manager);
      const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
      expect(res.status, `${path} let a manager read the AI budget`).toBe(403);
    });
  }

  it('lets an owner through the same doors', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    for (const [method, path] of SHUT) {
      if (method !== 'GET') continue;
      const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
      expect(res.status, `${path} refused an owner`).toBeLessThan(400);
    }
  });

  /* ── an owner can never be deactivated ──────────────────────────────── */

  describe('deactivating somebody', () => {
    it('refuses to deactivate an owner, and says so in words', async () => {
      const owner = await createTestUser({ role: 'owner' });
      const other = await createTestUser({ role: 'owner', email: 'second@emircrm.test' });
      const cookie = await signIn(base, owner);

      const res = await fetch(`${base}/api/users/${other.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, ...json },
        body: JSON.stringify({ isActive: false }),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('An owner cannot be deactivated');

      /* And the account is untouched: no ended sessions, no leads moved. */
      const [row] = await query<{ is_active: number }>(
        'SELECT is_active FROM users WHERE id = ?', [other.id],
      );
      expect(row?.is_active).toBe(1);
    });

    it('still deactivates an agent, and still moves their leads', async () => {
      const owner = await createTestUser({ role: 'owner' });
      const agent = await createTestUser({ role: 'agent' });
      const cookie = await signIn(base, owner);

      const res = await fetch(`${base}/api/users/${agent.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, ...json },
        body: JSON.stringify({ isActive: false }),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const [row] = await query<{ is_active: number }>(
        'SELECT is_active FROM users WHERE id = ?', [agent.id],
      );
      expect(row?.is_active).toBe(0);
    });

    it('does not let an admin touch an owner', async () => {
      const admin = await createTestUser({ role: 'admin' });
      const owner = await createTestUser({ role: 'owner' });
      const cookie = await signIn(base, admin);

      const demote = await fetch(`${base}/api/users/${owner.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, ...json },
        body: JSON.stringify({ role: 'agent' }),
      });
      expect(demote.status).toBe(400);
      expect(await demote.text()).toContain('An admin cannot change an owner');

      const out = await fetch(`${base}/api/users/${owner.id}/sign-out-everywhere`, {
        method: 'POST',
        headers: { Cookie: cookie, ...json },
      });
      expect(out.status).toBe(400);
    });

    it('does not let an admin hand out owner', async () => {
      const admin = await createTestUser({ role: 'admin' });
      const agent = await createTestUser({ role: 'agent' });
      const cookie = await signIn(base, admin);

      const res = await fetch(`${base}/api/users/${agent.id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, ...json },
        body: JSON.stringify({ role: 'owner' }),
      });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('Only an owner can make somebody else an owner');
    });
  });

  /* ── sign out everywhere ────────────────────────────────────────────── */

  it('ends every session a person has, without changing their password', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const ownerCookie = await signIn(base, owner);
    /* Two devices, so "everywhere" means something. */
    const one = await signIn(base, agent);
    const two = await signIn(base, agent);

    const res = await fetch(`${base}/api/users/${agent.id}/sign-out-everywhere`, {
      method: 'POST',
      headers: { Cookie: ownerCookie, ...json },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json() as { sessionsEnded: number }).sessionsEnded).toBe(2);

    for (const cookie of [one, two]) {
      const after = await fetch(`${base}/api/v2/feedback/mine`, { headers: { Cookie: cookie } });
      expect(after.status, 'a signed-out device still worked').toBe(401);
    }

    /* The password is untouched: this is not a reset. */
    const back = await signIn(base, agent);
    expect(back).toBeTruthy();
  });

  /* ── the Team and roles payload ─────────────────────────────────────── */

  it('tells an owner who has no phone registered, by name and never by token', async () => {
    const owner = await createTestUser({ role: 'owner', name: 'Owner One' });
    const withPhone = await createTestUser({ role: 'agent', name: 'Has A Phone' });
    await createTestUser({ role: 'agent', name: 'No Phone' });
    await execute(
      "INSERT INTO push_tokens (id, user_id, token, platform) VALUES (?, ?, ?, 'ios')",
      [newId(), withPhone.id, 'a-device-token-nobody-should-see'],
    );

    const cookie = await signIn(base, owner);
    const res = await fetch(`${base}/api/v2/team/roles`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body, 'a device token reached the screen').not.toContain('a-device-token');

    const { members, counts } = JSON.parse(body) as {
      members: Array<{ name: string; phonePlatform: string | null; computerAlerts: boolean }>;
      counts: { withAlerts: number; withoutAlerts: number; owners: number; agents: number };
    };
    expect(members.find((one) => one.name === 'Has A Phone')?.phonePlatform).toBe('ios');
    expect(members.find((one) => one.name === 'No Phone')?.phonePlatform).toBeNull();
    expect(counts.withAlerts).toBe(1);
    expect(counts.withoutAlerts).toBe(2);
    expect(counts.owners).toBe(1);
    expect(counts.agents).toBe(2);
  });

  it('writes “Turn on notifications” into the bell of whoever is reminded', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent', name: 'Tej' });
    const cookie = await signIn(base, owner);

    const res = await fetch(`${base}/api/v2/team/remind-alerts`, {
      method: 'POST',
      headers: { Cookie: cookie, ...json },
      body: JSON.stringify({ userIds: [agent.id] }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json() as { reminded: string[] }).reminded).toEqual(['Tej']);

    const rows = await query<{ title: string; user_id: string }>(
      'SELECT title, user_id FROM notifications WHERE user_id = ?', [agent.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Turn on notifications');
  });

  /* ── attendance ─────────────────────────────────────────────────────── */

  it('lets an admin save the attendance rules, not only an owner', async () => {
    /* `sage.md` §1: an admin does what an owner does on these screens. Saving
       was owner-only, so an admin got the whole form and a 403 on Save. */
    const admin = await createTestUser({ role: 'admin' });
    const cookie = await signIn(base, admin);
    const res = await fetch(`${base}/api/attendance/settings`, {
      method: 'PUT',
      headers: { Cookie: cookie, ...json },
      body: JSON.stringify({ start: '10:00', end: '19:00' }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it('keeps the name of each office network beside its address', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const res = await fetch(`${base}/api/attendance/settings`, {
      method: 'PUT',
      headers: { Cookie: cookie, ...json },
      body: JSON.stringify({
        officeIps: ['203.0.113.10', '203.0.113.11'],
        officeNames: { '203.0.113.10': 'homes.me-Office', '203.0.113.11': 'homes.me-Office-5G' },
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const saved = await res.json() as { officeNames: Record<string, string> };
    expect(saved.officeNames['203.0.113.10']).toBe('homes.me-Office');

    /* A name for an address that is not saved is dropped rather than kept as
       a label on a network nobody can check in from. */
    const narrowed = await fetch(`${base}/api/attendance/settings`, {
      method: 'PUT',
      headers: { Cookie: cookie, ...json },
      body: JSON.stringify({
        officeIps: ['203.0.113.10'],
        officeNames: { '203.0.113.10': 'homes.me-Office', '203.0.113.11': 'gone' },
      }),
    });
    const after = await narrowed.json() as { officeNames: Record<string, string> };
    expect(Object.keys(after.officeNames)).toEqual(['203.0.113.10']);
  });

  it('hands the month down as a CSV with a row per person per day', async () => {
    const owner = await createTestUser({ role: 'owner' });
    await createTestUser({ role: 'agent', name: 'Rocky Khan' });
    const cookie = await signIn(base, owner);

    const months = await fetch(`${base}/api/attendance/report/months`, {
      headers: { Cookie: cookie },
    });
    const { months: list } = await months.json() as {
      months: Array<{ key: string; label: string; workingDays: number; people: number }>;
    };
    expect(list).toHaveLength(3);
    expect(list[0]?.key).toMatch(/^\d{4}-\d{2}$/);
    expect(list[0]?.people).toBe(1);

    const file = await fetch(
      `${base}/api/attendance/report.csv?month=${list[0]?.key}`,
      { headers: { Cookie: cookie } },
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('text/csv');
    expect(file.headers.get('content-disposition')).toContain('Attendance-');
    const csv = await file.text();
    expect(csv).toContain('Late minutes');
    expect(csv).toContain('Rocky Khan');
  });
});
