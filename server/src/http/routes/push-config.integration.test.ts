import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { loadEnv, setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * What the browser is told in order to subscribe to notifications.
 *
 * The four Firebase web values are public by design — Google ships them to
 * every phone. The one that authorises *sending* is the private key, and the
 * point of this suite is that it never appears here.
 */
let server: Server;
let base = '';

const WEB_KEYS = {
  FCM_PROJECT_ID: 'emir-crm-demo',
  FCM_WEB_API_KEY: 'AIzaSy-public-web-api-key',
  FCM_WEB_APP_ID: '1:123456789:web:abcdef',
  FCM_MESSAGING_SENDER_ID: '123456789',
  FCM_VAPID_KEY: 'BPublicVapidKeyForTheBrowser',
};

const readJson = <T,>(res: Response): Promise<T> => res.json() as Promise<T>;
type Config = { configured: boolean; vapidKey?: string; firebase?: { authDomain: string; projectId: string } };

describeWithDb('what the phone is told about notifications', () => {
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
  afterEach(() => setEnvForTesting(null));

  it('says it is not set up rather than half-answering', async () => {
    setEnvForTesting({ ...loadEnv(process.env), FCM_PROJECT_ID: undefined, FCM_WEB_API_KEY: undefined });
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));

    const body = await readJson<Config>(await fetch(`${base}/api/users/me/push-config`, { headers: { cookie } }));

    // A screen can say "not set up yet" honestly; a broken button cannot.
    expect(body.configured).toBe(false);
    expect(body.firebase).toBeUndefined();
  });

  /*
   * Every key missing but one would otherwise produce a config the browser
   * accepts and then fails on, with nothing on screen to explain it.
   */
  it('treats a partly filled set of keys as not set up', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...WEB_KEYS, FCM_VAPID_KEY: undefined });
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));

    const body = await readJson<Config>(await fetch(`${base}/api/users/me/push-config`, { headers: { cookie } }));

    expect(body.configured).toBe(false);
  });

  it('gives an agent what their phone needs once the keys are set', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...WEB_KEYS });
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));

    const body = await readJson<Config>(await fetch(`${base}/api/users/me/push-config`, { headers: { cookie } }));

    expect(body.configured).toBe(true);
    expect(body.firebase?.projectId).toBe('emir-crm-demo');
    expect(body.firebase?.authDomain).toBe('emir-crm-demo.firebaseapp.com');
    expect(body.vapidKey).toBe('BPublicVapidKeyForTheBrowser');
  });

  /*
   * The one that matters. FCM_PRIVATE_KEY is what lets anybody holding it send
   * a notification to every agent in the brokerage.
   */
  it('never sends the private key to the browser', async () => {
    const privateKey = '-----BEGIN PRIVATE KEY-----THIS-MUST-NEVER-LEAVE-THE-SERVER-----';
    setEnvForTesting({
      ...loadEnv(process.env),
      ...WEB_KEYS,
      FCM_PRIVATE_KEY: privateKey,
      FCM_CLIENT_EMAIL: 'sender@emir-crm-demo.iam.gserviceaccount.com',
    });
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));

    const text = await (await fetch(`${base}/api/users/me/push-config`, { headers: { cookie } })).text();

    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain('THIS-MUST-NEVER-LEAVE-THE-SERVER');
    expect(text).not.toContain('iam.gserviceaccount.com');
  });

  it('is not readable without signing in', async () => {
    setEnvForTesting({ ...loadEnv(process.env), ...WEB_KEYS });

    const res = await fetch(`${base}/api/users/me/push-config`);

    expect(res.status).toBe(401);
  });
});
