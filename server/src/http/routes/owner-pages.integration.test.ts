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

/**
 * An owner's page refuses an agent, and says so in words.
 *
 * The owner typed four addresses into the browser while signed in as an
 * agent — /v2/import, /v2/settings/team, /v2/settings/automations,
 * /v2/settings/company — and every one of them opened.
 *
 * The data behind them was never exposed: each router already carried its
 * guard. What an agent saw was the page frame and a red line reading "This
 * action requires one of: owner, admin" — the role names out of the code,
 * which tell a person nothing and read like a fault in the CRM rather than
 * a door that is not theirs.
 *
 * So this file holds two things together: the refusal is still a refusal,
 * and what it says is something a person can act on. The screen-side block
 * is `web/src/v2/OwnerOnly.tsx`; neither replaces the other.
 */
let server: Server;
let base = '';

describeWithDb('an owner page refuses an agent', () => {
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

  const SHUT: [string, string][] = [
    ['GET', '/api/imports'],
    ['POST', '/api/imports'],
    ['GET', '/api/imports/mappings/all'],
    ['PATCH', '/api/automations/auto-assign'],
    ['GET', '/api/company/lead-data'],
  ];

  for (const [method, path] of SHUT) {
    it(`${method} ${path} is shut to an agent`, async () => {
      const agent = await createTestUser({ role: 'agent' });
      const cookie = await signIn(base, agent);
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { Cookie: cookie, 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify({ isActive: true }),
      });
      expect(res.status, `${method} ${path} let an agent through`).toBe(403);

      /* And it does not hand the role names to the person reading it. */
      const body = await res.text();
      expect(body, `${method} ${path} showed the raw role list`).not.toContain('requires one of');
    });
  }

  it('lets an owner through the same doors', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const res = await fetch(`${base}/api/imports`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
});
