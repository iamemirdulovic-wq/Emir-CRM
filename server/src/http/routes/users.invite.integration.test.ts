import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { queryOne } from '../../db/client.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * Inviting several people at once.
 *
 * Nine agents joined on one day, and creating them one form at a time is how
 * a role gets mistyped on the seventh.
 *
 * This endpoint makes real accounts with real passwords, so what it must NOT
 * do matters more than what it does: no account that skips the forced password
 * change, no second account on an address that already has one, no owner role
 * handed out from a textarea, no password left in the audit log, and nothing
 * at all for anyone below admin.
 */
let server: Server;
let base = '';

async function post(path: string, cookie: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) as Record<string, unknown> };
}

describeWithDb('inviting the team', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });
  beforeEach(async () => { await resetTables(); resetRateLimits(); });

  async function asOwner(): Promise<string> {
    return signIn(base, await createTestUser({ role: 'owner' }));
  }

  it('creates one account per address, each with its own password', async () => {
    const cookie = await asOwner();
    const res = await post('/api/users/invite', cookie, {
      emails: ['tej@homes.me', 'talha@homes.me'], role: 'agent',
    });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);

    const results = res.body.results as Array<{ temporaryPassword: string }>;
    expect(results[0]?.temporaryPassword).toBeTruthy();
    /* One shared password would let any of them sign in as any other until
       everybody had changed theirs. */
    expect(results[0]?.temporaryPassword).not.toBe(results[1]?.temporaryPassword);
  });

  it('forces a password change on every account it makes', async () => {
    const cookie = await asOwner();
    await post('/api/users/invite', cookie, { emails: ['sultan@homes.me'], role: 'agent' });

    const row = await queryOne<{ must_change_password: number; role: string; is_active: number }>(
      'SELECT must_change_password, role, is_active FROM users WHERE email = ?', ['sultan@homes.me'],
    );
    expect(row?.must_change_password).toBe(1);
    expect(row?.role).toBe('agent');
    expect(row?.is_active).toBe(1);
  });

  it('takes the name from the address until they tell us otherwise', async () => {
    const cookie = await asOwner();
    await post('/api/users/invite', cookie, { emails: ['yuliia@homes.me'], role: 'agent' });
    const row = await queryOne<{ name: string }>(
      'SELECT name FROM users WHERE email = ?', ['yuliia@homes.me'],
    );
    expect(row?.name).toBe('Yuliia');
  });

  /* Pasting the same list twice is the normal way this gets used. It must not
     make a second account, and it must not reset the first one's password. */
  it('skips an address that already has an account, and does not touch it', async () => {
    const cookie = await asOwner();
    await post('/api/users/invite', cookie, { emails: ['rocky@homes.me'], role: 'agent' });
    const before = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = ?', ['rocky@homes.me'],
    );

    const again = await post('/api/users/invite', cookie, {
      emails: ['rocky@homes.me'], role: 'agent',
    });
    expect(again.body.created).toBe(0);
    const results = again.body.results as Array<{ status: string; temporaryPassword?: string }>;
    expect(results[0]?.status).toBe('already_exists');
    expect(results[0]?.temporaryPassword).toBeUndefined();

    const after = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = ?', ['rocky@homes.me'],
    );
    expect(after?.password_hash).toBe(before?.password_hash);
  });

  it('counts a repeat inside one paste only once', async () => {
    const cookie = await asOwner();
    const res = await post('/api/users/invite', cookie, {
      emails: ['olga@homes.me', 'OLGA@homes.me '], role: 'agent',
    });
    expect(res.body.created).toBe(1);
  });

  it('refuses a line that is not an address, and still creates the rest', async () => {
    const cookie = await asOwner();
    const res = await post('/api/users/invite', cookie, {
      emails: ['not an email', 'shan@homes.me'], role: 'agent',
    });
    expect(res.body.created).toBe(1);
    const results = res.body.results as Array<{ status: string }>;
    expect(results[0]?.status).toBe('invalid');
  });

  /* An owner can do anything, including removing other owners. It is not
     something to hand out nine at a time from a textarea. */
  it('will not hand out owner in bulk', async () => {
    const cookie = await asOwner();
    const res = await post('/api/users/invite', cookie, {
      emails: ['nelson@homes.me'], role: 'owner',
    });
    expect(res.status).toBe(400);
    expect(await queryOne('SELECT id FROM users WHERE email = ?', ['nelson@homes.me'])).toBeNull();
  });

  it('refuses an agent, who would otherwise be making colleagues', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));
    const res = await post('/api/users/invite', cookie, {
      emails: ['bassam@homes.me'], role: 'agent',
    });
    expect(res.status).toBe(403);
    expect(await queryOne('SELECT id FROM users WHERE email = ?', ['bassam@homes.me'])).toBeNull();
  });

  it('refuses a manager too', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'manager' }));
    const res = await post('/api/users/invite', cookie, {
      emails: ['someone@homes.me'], role: 'agent',
    });
    expect(res.status).toBe(403);
  });

  /* The password comes back once, on purpose, to be handed over. It must not
     also sit in the audit log, where it would outlive the handover. */
  it('keeps the password out of the audit log', async () => {
    const cookie = await asOwner();
    const res = await post('/api/users/invite', cookie, {
      emails: ['talha@homes.me'], role: 'agent',
    });
    const results = res.body.results as Array<{ temporaryPassword: string }>;
    const secret = results[0]?.temporaryPassword as string;
    expect(secret).toBeTruthy();

    const hit = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM audit_log WHERE after_json LIKE ?', [`%${secret}%`],
    );
    expect(Number(hit?.n)).toBe(0);
  });

  it('writes one audit row per account it creates', async () => {
    const cookie = await asOwner();
    await post('/api/users/invite', cookie, {
      emails: ['a@homes.me', 'b@homes.me'], role: 'agent',
    });
    const row = await queryOne<{ n: number }>(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user.created'", [],
    );
    expect(Number(row?.n)).toBe(2);
  });

  /* Nothing leaves the building unless it was asked for. */
  it('sends no email unless asked', async () => {
    const cookie = await asOwner();
    const res = await post('/api/users/invite', cookie, {
      emails: ['quiet@homes.me'], role: 'agent',
    });
    const results = res.body.results as Array<{ emailSent?: boolean }>;
    expect(results[0]?.emailSent).toBeUndefined();
  });
});
