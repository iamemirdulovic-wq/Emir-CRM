import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, describeWithDb, execute, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { loadEnv, setEnvForTesting } from '../config/env.js';
import { clearSecretCache } from '../config/secrets.js';
import { newId } from '../lib/ids.js';
import { websiteConnection } from './integration-status.js';

/**
 * The owner has no terminal. This panel is the only way they can tell whether
 * the website connection is live, so it has to be right — and it must never
 * be the thing that leaks the shared secret to a screen.
 */
describeWithDb('the website connection panel', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { setEnvForTesting(null); clearSecretCache(); await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); clearSecretCache(); });
  afterEach(() => { setEnvForTesting(null); clearSecretCache(); });

  it('says the endpoint would answer 503 while no secret is set', async () => {
    setEnvForTesting({ ...loadEnv(process.env), PROPERTY_INVESTMENT_HMAC_SECRET: undefined });
    clearSecretCache();

    const status = await websiteConnection();

    expect(status.secretConfigured).toBe(false);
    expect(status.secretSource).toBe('none');
    expect(status.wouldAnswer).toBe(503);
  });

  it('says it would answer 202 once the secret is in the hosting panel', async () => {
    setEnvForTesting({ ...loadEnv(process.env), PROPERTY_INVESTMENT_HMAC_SECRET: 'a-long-shared-secret' });
    clearSecretCache();

    const status = await websiteConnection();

    expect(status.secretConfigured).toBe(true);
    expect(status.secretSource).toBe('env');
    expect(status.wouldAnswer).toBe(202);
  });

  /*
   * The whole point of returning a boolean rather than the value. A panel that
   * helpfully showed the last four characters would be a panel that leaks the
   * key to anyone who can open a manager's laptop.
   */
  it('never carries the secret itself, in any form', async () => {
    const value = 'a-very-distinctive-shared-secret-value';
    setEnvForTesting({ ...loadEnv(process.env), PROPERTY_INVESTMENT_HMAC_SECRET: value });
    clearSecretCache();

    const status = await websiteConnection();

    const serialised = JSON.stringify(status);
    expect(serialised).not.toContain(value);
    // Not even a fragment of it, which is what a "hint" would be.
    expect(serialised).not.toContain(value.slice(-4));
  });

  it('counts the leads that have arrived and when the last one did', async () => {
    setEnvForTesting({ ...loadEnv(process.env), PROPERTY_INVESTMENT_HMAC_SECRET: 'a-long-shared-secret' });
    clearSecretCache();

    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Ahmed Khan', '+971501234567'],
    );
    await execute(
      `INSERT INTO website_leads (id, site, external_id, contact_id, payload)
       VALUES (?, 'property-investment.ae', 'pi_1', ?, '{}')`,
      [newId(), contactId],
    );

    const status = await websiteConnection();

    expect(status.leadsReceived).toBe(1);
    expect(status.lastEventAt).toBeTruthy();
  });

  it('surfaces the last failure rather than letting it sit silently in a table', async () => {
    await execute(
      `INSERT INTO inbound_events (id, source, external_id, signature_valid, raw_payload, status, error)
       VALUES (?, 'property_investment', 'pi_broken', 1, '{}', 'failed', 'phone number was unparseable')`,
      [newId()],
    );

    const status = await websiteConnection();

    expect(status.lastFailureAt).toBeTruthy();
    expect(status.lastFailureReason).toContain('unparseable');
  });
});
