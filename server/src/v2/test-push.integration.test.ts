import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, query, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { loadEnv, setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';
import { forgetFcmToken } from '../messaging/push.js';

/**
 * "Send a test" — the button that used to lie.
 *
 * On 15 Nov the owner finished setting up Firebase, pressed this button, read
 * "it works", and spent an hour wondering where the alert had gone. Nothing
 * had been sent: the button called no endpoint, showed its own toast, and
 * flipped the card's subtitle to "test sent just now".
 *
 * The test that would have caught it is the fourth one down: pressing the
 * button with no device registered must not report success. The rest are the
 * four other ways it can fail, each of which needs a different person to do a
 * different thing, and each of which the old screen reported as "it works".
 *
 * Firebase is intercepted rather than called. The stub passes anything aimed
 * at this test server straight through to the real `fetch`, so the suite can
 * still talk to its own app while Google is fiction.
 */
let server: Server;
let base = '';

/**
 * Enough for `pushConfigured()` to be true, and for the JWT the server signs
 * to actually sign. A real key pair, generated here and thrown away with the
 * process — a made-up string would make OpenSSL throw and turn every one of
 * these tests into the same "the key is unusable" answer, which is its own
 * test further down.
 */
const KEYS = {
  FCM_PROJECT_ID: 'emir-crm-test',
  FCM_CLIENT_EMAIL: 'sender@emir-crm-test.iam.gserviceaccount.com',
  FCM_PRIVATE_KEY: generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey,
};

type Reply = { outcome: string; reached: number; registered: number; removed: number; say: string; to: string | null };

/**
 * Stand in for Google.
 *
 * `token` is whether minting an OAuth token works at all; `send` answers each
 * `messages:send`. Everything else — in practice only this suite's own
 * requests to 127.0.0.1 — goes to the real network stack.
 */
function fakeFirebase(options: { token?: boolean; send?: () => Response }) {
  const real = globalThis.fetch;
  const sends: string[] = [];
  /* The server's own `fetch` types, rather than the DOM's: this package does
     not pull in `lib.dom`. */
  type Args = Parameters<typeof fetch>;
  vi.stubGlobal('fetch', async (input: Args[0], init?: Args[1]) => {
    const url = String(
      typeof input === 'object' && input !== null && 'url' in input
        ? (input as { url: string }).url
        : input,
    );
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return options.token === false
        ? new Response('{"error":"invalid_grant"}', { status: 400 })
        : new Response(JSON.stringify({ access_token: 'pretend-token', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('fcm.googleapis.com')) {
      sends.push(url);
      return options.send ? options.send() : new Response('{"name":"ok"}', { status: 200 });
    }
    return real(input, init);
  });
  return sends;
}

/** Firebase's own shape for "that device is gone". */
const unregistered = () => new Response(
  JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.' } }),
  { status: 404 },
);

async function registerDevice(userId: string, token = `tok-${newId()}`) {
  await execute(
    "INSERT INTO push_tokens (id, user_id, token, platform) VALUES (?, ?, ?, 'web')",
    [newId(), userId, token],
  );
  return token;
}

describeWithDb('sending yourself a test alert', () => {
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
  beforeEach(async () => { await resetTables(); resetRateLimits(); forgetFcmToken(); });
  afterEach(() => {
    forgetFcmToken();
    vi.unstubAllGlobals();
    setEnvForTesting(null);
    resetRateLimits();
  });

  const press = (cookie: string, body?: unknown) =>
    fetch(`${base}/api/v2/notifications/test`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });

  const reply = async (res: Response): Promise<Reply> => {
    expect(res.status, await res.clone().text()).toBe(200);
    return await res.json() as Reply;
  };

  /* ── the bug ─────────────────────────────────────────────────────────── */

  /**
   * The regression test. This is the exact press the owner made.
   */
  it('does not report success when no device is registered', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    const sends = fakeFirebase({});
    const owner = await createTestUser({ role: 'owner' });

    const got = await reply(await press(await signIn(base, owner)));

    expect(got.outcome).toBe('no-device');
    expect(got.reached).toBe(0);
    expect(got.say.toLowerCase()).not.toContain('it works');
    expect(got.say).toContain('Nothing was sent');
    /* And it points at the one place a phone can be registered, which is not
       the screen the button is on. */
    expect(got.to).toBe('/v2/home');
    /* Nothing was even attempted, so nothing can have been "sent". */
    expect(sends).toHaveLength(0);
  });

  /* ── the other four reasons ──────────────────────────────────────────── */

  it('says the key is missing, and does not blame the device', async () => {
    setEnvForTesting({
      ...loadEnv(process.env), FCM_PROJECT_ID: undefined, FCM_CLIENT_EMAIL: undefined, FCM_PRIVATE_KEY: undefined,
    });
    const sends = fakeFirebase({});
    const owner = await createTestUser({ role: 'owner' });
    /* A device IS registered: the answer must still be about the key, which
       is the distinction the health page draws and the old screen did not. */
    await registerDevice(owner.id);

    const got = await reply(await press(await signIn(base, owner)));

    expect(got.outcome).toBe('no-credentials');
    expect(got.reached).toBe(0);
    expect(got.say).toContain('Firebase key');
    expect(sends).toHaveLength(0);
  });

  it('removes a device Firebase has disowned, and says so', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    fakeFirebase({ send: unregistered });
    const owner = await createTestUser({ role: 'owner' });
    await registerDevice(owner.id);

    const got = await reply(await press(await signIn(base, owner)));

    expect(got.outcome).toBe('token-rejected');
    expect(got.reached).toBe(0);
    expect(got.registered).toBe(1);
    expect(got.removed).toBe(1);
    expect(got.say).toContain('Nothing was sent');
    expect(got.to).toBe('/v2/home');
    /* Cleaned up, as the existing push path already did — so the next press
       honestly reports "no device" rather than failing on a dead token for
       ever. */
    const left = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = ?', [owner.id],
    );
    expect(Number(left?.n)).toBe(0);
  });

  it('says Firebase failed when Firebase failed, and keeps the device', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    fakeFirebase({
      send: () => new Response(
        JSON.stringify({ error: { code: 500, status: 'INTERNAL', message: 'Internal error' } }),
        { status: 500 },
      ),
    });
    const owner = await createTestUser({ role: 'owner' });
    await registerDevice(owner.id);

    const got = await reply(await press(await signIn(base, owner)));

    expect(got.outcome).toBe('failed');
    expect(got.reached).toBe(0);
    expect(got.removed).toBe(0);
    expect(got.say.toLowerCase()).not.toContain('it works');
    /* A working phone must not be unregistered because Google had a bad
       minute. */
    const left = await queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = ?', [owner.id],
    );
    expect(Number(left?.n)).toBe(1);
  });

  it('says Firebase failed when it cannot even get a token', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    const sends = fakeFirebase({ token: false });
    const owner = await createTestUser({ role: 'owner' });
    await registerDevice(owner.id);

    const got = await reply(await press(await signIn(base, owner)));

    expect(got.outcome).toBe('failed');
    expect(got.registered).toBe(1);
    expect(sends).toHaveLength(0);
  });

  /**
   * The likeliest Firebase mistake of all: the private key is one long block
   * copied out of a JSON file into a hosting panel. OpenSSL answers a bad one
   * by throwing, and until 15 Nov that came back to the owner as "Internal
   * server error" — which says nothing about the thing he had just pasted.
   */
  it('says the key needs checking when the key cannot be used', async () => {
    setEnvForTesting({
      ...loadEnv(process.env),
      ...KEYS,
      FCM_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----pasted-wrong-----END PRIVATE KEY-----',
    });
    fakeFirebase({});
    const owner = await createTestUser({ role: 'owner' });
    await registerDevice(owner.id);

    const got = await reply(await press(await signIn(base, owner)));

    expect(got.outcome).toBe('failed');
    expect(got.say).toContain('Firebase values need checking');
    /* Never the key, in any form, in anything the browser is handed. */
    expect(JSON.stringify(got)).not.toContain('pasted-wrong');
  });

  it('refuses to send at all from the test copy of the CRM', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS, IS_TEST_COPY: true });
    const sends = fakeFirebase({});
    const owner = await createTestUser({ role: 'owner' });
    await registerDevice(owner.id);

    const got = await reply(await press(await signIn(base, owner)));

    expect(got.outcome).toBe('test-copy');
    expect(got.say).toContain('test copy');
    expect(sends).toHaveLength(0);
  });

  /* ── the one case that may say "it works" ────────────────────────────── */

  it('reaches both devices and counts them', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    const sends = fakeFirebase({});
    const owner = await createTestUser({ role: 'owner' });
    await registerDevice(owner.id);
    await registerDevice(owner.id);

    const got = await reply(await press(await signIn(base, owner)));

    expect(got.outcome).toBe('sent');
    expect(got.reached).toBe(2);
    expect(got.say).toBe('It works. The test alert reached 2 devices.');
    expect(sends).toHaveLength(2);
    /* The send is recorded against the device, which is what the health page
       and the team page read. */
    const used = await query<{ last_used_at: Date | null }>(
      'SELECT last_used_at FROM push_tokens WHERE user_id = ?', [owner.id],
    );
    expect(used.every((row) => row.last_used_at !== null)).toBe(true);
  });

  it('still says it works when one of two devices is dead', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    let nth = 0;
    fakeFirebase({ send: () => (++nth === 1 ? unregistered() : new Response('{}', { status: 200 })) });
    const owner = await createTestUser({ role: 'owner' });
    await registerDevice(owner.id);
    await registerDevice(owner.id);

    const got = await reply(await press(await signIn(base, owner)));

    expect(got.outcome).toBe('sent');
    expect(got.reached).toBe(1);
    expect(got.removed).toBe(1);
  });

  /* ── whose phone it reaches ──────────────────────────────────────────── */

  /**
   * The fence. There is no `userId` on this endpoint and there must never be
   * one: a button that can make somebody else's phone buzz is a button an
   * owner can be tricked into pressing.
   */
  it('never touches another person\'s device', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    const sends = fakeFirebase({});
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const theirs = await registerDevice(agent.id);
    const mine = await registerDevice(owner.id);

    const got = await reply(await press(await signIn(base, owner)));

    expect(got.outcome).toBe('sent');
    expect(got.reached).toBe(1);
    expect(sends).toHaveLength(1);
    /* Only the presser's own device was written to. */
    const rows = await query<{ token: string; last_used_at: Date | null }>(
      'SELECT token, last_used_at FROM push_tokens',
    );
    expect(rows.find((row) => row.token === mine)?.last_used_at).not.toBeNull();
    expect(rows.find((row) => row.token === theirs)?.last_used_at).toBeNull();
  });

  it('refuses a request that tries to name somebody else', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    fakeFirebase({});
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });

    const res = await press(await signIn(base, owner), { userId: agent.id });

    expect(res.status).toBe(400);
  });

  it('is not pressable without signing in', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    fakeFirebase({});
    const res = await fetch(`${base}/api/v2/notifications/test`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('is open to an agent, for their own phone', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    fakeFirebase({});
    const agent = await createTestUser({ role: 'agent' });
    await registerDevice(agent.id);

    const got = await reply(await press(await signIn(base, agent)));

    expect(got.outcome).toBe('sent');
  });

  it('stops somebody holding the button down', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    fakeFirebase({});
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);

    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) codes.push((await press(cookie)).status);

    expect(codes.filter((code) => code === 429).length).toBeGreaterThan(0);
  });

  /* ── the heading ─────────────────────────────────────────────────────── */

  /**
   * The card above the button said "Notifications are on" as a hardcoded
   * heading, whatever was true. `/api/v2/notify` now carries the real state,
   * drawn the same way `measureNotifications` draws it on the health page:
   * key first, then this person's own devices.
   */
  it('tells the settings screen the truth about this person', async () => {
    const alerts = async (cookie: string) => {
      const res = await fetch(`${base}/api/v2/notify`, { headers: { cookie } });
      expect(res.status, await res.clone().text()).toBe(200);
      const body = await res.json() as { alerts: { state: string; keySet: boolean; devices: number; say: string; to: string | null } };
      return body.alerts;
    };

    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);

    setEnvForTesting({
      ...loadEnv(process.env), FCM_PROJECT_ID: undefined, FCM_CLIENT_EMAIL: undefined, FCM_PRIVATE_KEY: undefined,
    });
    const noKey = await alerts(cookie);
    expect(noKey.state).toBe('no-key');
    expect(noKey.keySet).toBe(false);
    expect(noKey.say).not.toContain('are on');

    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    const noDevice = await alerts(cookie);
    expect(noDevice.state).toBe('no-device');
    expect(noDevice.keySet).toBe(true);
    expect(noDevice.devices).toBe(0);
    expect(noDevice.say).not.toContain('are on');
    expect(noDevice.to).toBe('/v2/home');

    await registerDevice(owner.id);
    const ok = await alerts(cookie);
    expect(ok.state).toBe('ok');
    expect(ok.devices).toBe(1);
    expect(ok.say).toBe('Notifications are on · 1 device');

    await registerDevice(owner.id);
    expect((await alerts(cookie)).say).toBe('Notifications are on · 2 devices');
  });

  it('counts only the asker\'s own devices in the heading', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...KEYS });
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    await registerDevice(agent.id);
    await registerDevice(agent.id);
    await registerDevice(agent.id);

    const res = await fetch(`${base}/api/v2/notify`, { headers: { cookie: await signIn(base, owner) } });
    const body = await res.json() as { alerts: { state: string; devices: number } };

    expect(body.alerts.devices).toBe(0);
    expect(body.alerts.state).toBe('no-device');
  });
});
