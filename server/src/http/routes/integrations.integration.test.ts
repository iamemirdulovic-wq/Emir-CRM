import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, query, resetTables,
} from '../../testing/db.js';
import { queryOne } from '../../db/client.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { loadEnv, setEnvForTesting } from '../../config/env.js';
import { clearSecretCache } from '../../config/secrets.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * Setting the website secret from inside the CRM.
 *
 * It exists so the owner does not need the hosting panel, a restart, or
 * anybody else. Which makes the questions here: can only the right people set
 * it, does it work immediately, and does it ever come back out.
 */
let server: Server;
let base = '';
const SECRET = 'a-long-shared-secret-for-the-tests';

const readJson = <T,>(res: Response): Promise<T> => res.json() as Promise<T>;
type Status = {
  secretConfigured: boolean;
  secretSource: 'env' | 'crm' | 'none';
  wouldAnswer: 202 | 503;
  outboundUrl: string | null;
};

describeWithDb('connecting the website from inside the CRM', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setEnvForTesting(null);
    clearSecretCache();
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
    resetRateLimits();
    setEnvForTesting({ ...loadEnv(process.env), PROPERTY_INVESTMENT_HMAC_SECRET: undefined });
    clearSecretCache();
  });
  afterEach(() => { setEnvForTesting(null); clearSecretCache(); });

  /* ── Who may ──────────────────────────────────────────────────────────── */

  it('refuses an agent, and a manager, the right to set it', async () => {
    const agent = await signIn(base, await createTestUser({ role: 'agent' }));
    const manager = await signIn(base, await createTestUser({ role: 'manager' }));

    for (const who of [agent, manager]) {
      const res = await fetch(`${base}/api/integrations/property-investment`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: who },
        body: JSON.stringify({ secret: SECRET }),
      });
      expect(res.status).toBe(403);
    }

    const stored = await query('SELECT name FROM app_secrets');
    expect(stored).toHaveLength(0);
  });

  it('lets a manager read the state without being able to change it', async () => {
    const manager = await signIn(base, await createTestUser({ role: 'manager' }));

    const res = await fetch(`${base}/api/integrations/property-investment`, { headers: { cookie: manager } });

    expect(res.status).toBe(200);
    expect((await readJson<Status>(res)).secretConfigured).toBe(false);
  });

  /* ── What it does ─────────────────────────────────────────────────────── */

  /*
   * The whole promise of this screen: paste, and the next lead is accepted.
   * No restart, which is why `saveSecret` clears the cache the verifier reads.
   */
  it('accepts a signed lead immediately after the secret is pasted, with no restart', async () => {
    const owner = await signIn(base, await createTestUser({ role: 'owner' }));

    const before = await fetch(`${base}/api/webhooks/property-investment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': 'whatever' },
      body: JSON.stringify({ event: 'lead.created', lead: { id: 1 } }),
    });
    expect(before.status).toBe(503);

    const saved = await fetch(`${base}/api/integrations/property-investment`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: owner },
      body: JSON.stringify({ secret: SECRET, url: 'https://www.property-investment.ae/api/webhooks/crm' }),
    });
    expect(saved.status).toBe(200);
    const status = await readJson<Status>(saved);
    expect(status.secretConfigured).toBe(true);
    expect(status.secretSource).toBe('crm');
    expect(status.wouldAnswer).toBe(202);
    expect(status.outboundUrl).toBe('https://www.property-investment.ae/api/webhooks/crm');

    const raw = JSON.stringify({
      event: 'lead.created',
      lead: { id: 42, first_name: 'Ahmed', phone_e164: '+971501234567' },
    });
    const after = await fetch(`${base}/api/webhooks/property-investment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': createHmac('sha256', SECRET).update(raw).digest('hex'),
      },
      body: raw,
    });
    expect(after.status).toBe(202);
  });

  /*
   * A value copied out of a text file almost always brings a newline with it.
   * If that were stored as-is, every signature would fail and the cause would
   * be invisible.
   */
  it('survives a secret pasted with a trailing newline', async () => {
    const owner = await signIn(base, await createTestUser({ role: 'owner' }));
    await fetch(`${base}/api/integrations/property-investment`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: owner },
      body: JSON.stringify({ secret: `${SECRET}\n` }),
    });

    const raw = JSON.stringify({ event: 'lead.created', lead: { id: 43, phone_e164: '+971501234999' } });
    const res = await fetch(`${base}/api/webhooks/property-investment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': createHmac('sha256', SECRET).update(raw).digest('hex'),
      },
      body: raw,
    });

    expect(res.status).toBe(202);
  });

  /* ── What it must never do ────────────────────────────────────────────── */

  it('never sends the secret back to the screen, and never writes it to the audit log', async () => {
    const owner = await signIn(base, await createTestUser({ role: 'owner' }));
    const value = 'a-very-distinctive-shared-secret-value';

    const saved = await fetch(`${base}/api/integrations/property-investment`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: owner },
      body: JSON.stringify({ secret: value }),
    });
    expect(await (await fetch(`${base}/api/integrations/property-investment`, { headers: { cookie: owner } })).text())
      .not.toContain(value);
    expect(await saved.text()).not.toContain(value);

    const audit = await queryOne<{ after_json: string | null }>(
      "SELECT after_json FROM audit_log WHERE action = 'secret.saved' ORDER BY created_at DESC LIMIT 1",
    );
    expect(audit).toBeTruthy();
    expect(audit?.after_json ?? '').not.toContain(value);
  });

  /*
   * The environment wins, by design. Letting the screen appear to save over it
   * would leave an owner staring at a value that is not the one being used.
   */
  it('refuses to save over a secret that the hosting panel is supplying', async () => {
    setEnvForTesting({ ...loadEnv(process.env), PROPERTY_INVESTMENT_HMAC_SECRET: 'set-in-the-hosting-panel' });
    clearSecretCache();
    const owner = await signIn(base, await createTestUser({ role: 'owner' }));

    const res = await fetch(`${base}/api/integrations/property-investment`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: owner },
      body: JSON.stringify({ secret: SECRET }),
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('hosting panel');
  });

  it('stops accepting leads the moment the secret is removed', async () => {
    const owner = await signIn(base, await createTestUser({ role: 'owner' }));
    await fetch(`${base}/api/integrations/property-investment`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: owner },
      body: JSON.stringify({ secret: SECRET }),
    });

    const res = await fetch(`${base}/api/integrations/property-investment/secret`, {
      method: 'DELETE',
      headers: { cookie: owner },
    });

    expect((await readJson<Status>(res)).wouldAnswer).toBe(503);
  });
});
