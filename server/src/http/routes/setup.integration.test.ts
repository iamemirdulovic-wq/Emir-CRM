import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, query, resetTables,
} from '../../testing/db.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { loadEnv, setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';

let server: Server;
let base = '';

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** `res.json()` is `unknown`; every field this suite reads is declared here. */
type SetupStatus = { needed: boolean; suggestedEncryptionKey?: string };
type OwnerCreated = { user: { id: string; name: string; email: string; role: string } };
const readJson = <T,>(res: Response): Promise<T> => res.json() as Promise<T>;

const OWNER = { name: 'Emir Dulovic', email: 'Owner@EmirCRM.ae', password: 'a-good-long-password' };

describeWithDb('first-run setup', () => {
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

  it('asks to be set up while there are no users', async () => {
    const body = await readJson<SetupStatus>(await fetch(`${base}/api/setup/status`));
    expect(body.needed).toBe(true);
  });

  it('offers a key to paste into the hosting panel when none is configured', async () => {
    // The point of the suggestion is to spare the owner a terminal. It is
    // generated per request and never stored: it is only a suggestion until
    // they paste it into their host.
    const configured = loadEnv(process.env);
    setEnvForTesting({ ...configured, ENCRYPTION_KEY: undefined });
    try {
      const body = await readJson<SetupStatus>(await fetch(`${base}/api/setup/status`));
      expect(body.suggestedEncryptionKey).toMatch(/^[0-9a-f]{64}$/);

      // Never the same one twice.
      const again = await readJson<SetupStatus>(await fetch(`${base}/api/setup/status`));
      expect(again.suggestedEncryptionKey).not.toBe(body.suggestedEncryptionKey);
    } finally {
      setEnvForTesting(configured);
    }
  });

  it('offers no key when the host already has one', async () => {
    // Arranged rather than assumed: whether ENCRYPTION_KEY happens to be in the
    // shell that ran the suite is not what this test is about.
    const configured = loadEnv(process.env);
    setEnvForTesting({ ...configured, ENCRYPTION_KEY: 'f'.repeat(64) });
    try {
      const body = await readJson<SetupStatus>(await fetch(`${base}/api/setup/status`));
      expect(body.suggestedEncryptionKey).toBeUndefined();
    } finally {
      setEnvForTesting(configured);
    }
  });

  it('creates the owner, lowercases the email, and signs them straight in', async () => {
    const res = await post('/api/setup/owner', OWNER);
    expect(res.status).toBe(201);
    const body = await readJson<OwnerCreated>(res);
    expect(body.user).toMatchObject({ email: 'owner@emircrm.ae', role: 'owner' });
    expect(res.headers.get('set-cookie')).toMatch(/emir_sid=/);

    const rows = await query<{ role: string; must_change_password: number; is_active: number }>(
      'SELECT role, must_change_password, is_active FROM users',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('owner');
    // They chose this password ten seconds ago; demanding a change teaches
    // people to click through the prompt.
    expect(rows[0]?.must_change_password).toBe(0);
    expect(rows[0]?.is_active).toBe(1);
  });

  it('shuts the door for good once an account exists', async () => {
    expect((await post('/api/setup/owner', OWNER)).status).toBe(201);

    const status = await readJson<SetupStatus>(await fetch(`${base}/api/setup/status`));
    expect(status.needed).toBe(false);
    expect(status.suggestedEncryptionKey).toBeUndefined();

    const second = await post('/api/setup/owner', { ...OWNER, email: 'someone-else@example.com' });
    expect(second.status).toBe(409);
  });

  it('refuses when the CRM already has users, even non-owners', async () => {
    // The door is "any account exists", not "an owner exists": a CRM seeded
    // from the command line has agents before it has a second owner.
    await createTestUser({ role: 'agent' });
    expect((await post('/api/setup/owner', OWNER)).status).toBe(409);
  });

  it('gives exactly one owner when several people submit at once', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        post('/api/setup/owner', { ...OWNER, email: `owner${i}@example.ae` }).then((r) => r.status),
      ),
    );
    expect(attempts.filter((s) => s === 201)).toHaveLength(1);
    expect(await query('SELECT id FROM users')).toHaveLength(1);
  });

  it('holds the password rule from the specification', async () => {
    const res = await post('/api/setup/owner', { ...OWNER, password: 'short' });
    expect(res.status).toBe(400);
    expect(await query('SELECT id FROM users')).toHaveLength(0);
  });

  it('rejects an email that is not one', async () => {
    const res = await post('/api/setup/owner', { ...OWNER, email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(await query('SELECT id FROM users')).toHaveLength(0);
  });

  it('records the account it created in the audit log', async () => {
    await post('/api/setup/owner', OWNER);
    const entries = await query<{ action: string; entity_type: string }>(
      "SELECT action, entity_type FROM audit_log WHERE action = 'setup.owner_created'",
    );
    expect(entries).toHaveLength(1);
  });
});
