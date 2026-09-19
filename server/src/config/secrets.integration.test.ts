import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { clearSecret, clearSecretCache, saveSecret, saveSetting, secret, secretHint, secretSource, setting } from './secrets.js';
import { env, setEnvForTesting } from './env.js';
import type { AuditActor } from '../audit/audit.js';

const owner = (id: string): AuditActor => ({ userId: id, role: 'owner' });
const KEY = 'AQ.TestKeyDoNotUse_abcdefghijklmnop1234';

describeWithDb('secrets the owner can set from inside the CRM', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => {
    await resetTables();
    await execute('DELETE FROM app_secrets');
    await execute('DELETE FROM app_settings');
    clearSecretCache();
  });
  afterEach(() => {
    delete process.env.AI_MODEL;
    // The parsed config is cached at boot, as it is in production; null makes
    // the next call re-read the real environment.
    setEnvForTesting(null);
    clearSecretCache();
  });

  it('saves a key and reads it back', async () => {
    const user = await createTestUser({ role: 'owner' });
    await saveSecret(owner(user.id), 'GEMINI_API_KEY', KEY);
    expect(await secret('GEMINI_API_KEY')).toBe(KEY);
  });

  /*
   * The value in the database is ciphertext. If this ever fails, a key is
   * sitting in plain text in a table that gets backed up and copied around.
   */
  it('never stores the key in plain text', async () => {
    const user = await createTestUser({ role: 'owner' });
    await saveSecret(owner(user.id), 'GEMINI_API_KEY', KEY);

    const rows = await query<{ value_enc: string }>('SELECT value_enc FROM app_secrets');
    expect(rows[0]?.value_enc).not.toContain(KEY);
    expect(rows[0]?.value_enc).not.toContain('TestKeyDoNotUse');
    expect(rows[0]?.value_enc.startsWith('v1:')).toBe(true);
  });

  it('never writes the key into the audit log', async () => {
    const user = await createTestUser({ role: 'owner' });
    await saveSecret(owner(user.id), 'GEMINI_API_KEY', KEY);

    const audit = await query<{ after_json: Record<string, unknown> | null }>(
      "SELECT after_json FROM audit_log WHERE action = 'secret.saved'",
    );
    const json = JSON.stringify(audit[0]?.after_json ?? {});
    expect(json).not.toContain(KEY);
    expect(json).not.toContain('TestKeyDoNotUse');
    // Only enough to tell one key from another.
    expect(json).toContain('1234');
  });

  it('shows only the last four characters as a hint', async () => {
    const user = await createTestUser({ role: 'owner' });
    await saveSecret(owner(user.id), 'GEMINI_API_KEY', KEY);
    expect(await secretHint('GEMINI_API_KEY')).toBe('1234');
  });

  /*
   * The hard rule is unchanged: secrets belong in the environment. This table
   * is the fallback for an owner with no terminal, and it must never quietly
   * override a key the host is already providing.
   */
  it('lets the environment win over what is stored', async () => {
    const user = await createTestUser({ role: 'owner' });
    await saveSecret(owner(user.id), 'GEMINI_API_KEY', 'stored-key');
    clearSecretCache();
    expect(await secret('GEMINI_API_KEY')).toBe('stored-key');

    // In production the variable is present before the process starts, so the
    // config is swapped rather than process.env poked after the fact.
    setEnvForTesting({ ...env(), GEMINI_API_KEY: 'environment-key' });
    clearSecretCache();
    expect(await secret('GEMINI_API_KEY')).toBe('environment-key');
    expect(await secretSource('GEMINI_API_KEY')).toBe('env');
    // And the screen is told not to offer an edit it cannot honour.
    expect(await secretHint('GEMINI_API_KEY')).toBeNull();
  });

  it('says where a key came from', async () => {
    const user = await createTestUser({ role: 'owner' });
    expect(await secretSource('GEMINI_API_KEY')).toBe('none');
    await saveSecret(owner(user.id), 'GEMINI_API_KEY', KEY);
    clearSecretCache();
    expect(await secretSource('GEMINI_API_KEY')).toBe('crm');
  });

  it('clears a key', async () => {
    const user = await createTestUser({ role: 'owner' });
    await saveSecret(owner(user.id), 'GEMINI_API_KEY', KEY);
    clearSecretCache();
    await clearSecret(owner(user.id), 'GEMINI_API_KEY');
    clearSecretCache();
    expect(await secret('GEMINI_API_KEY')).toBeNull();
  });

  it('refuses to store an empty key', async () => {
    const user = await createTestUser({ role: 'owner' });
    await expect(saveSecret(owner(user.id), 'GEMINI_API_KEY', '   ')).rejects.toThrow(/empty/i);
  });

  it('takes effect immediately rather than after the cache expires', async () => {
    const user = await createTestUser({ role: 'owner' });
    expect(await secret('GEMINI_API_KEY')).toBeNull(); // warms the cache
    await saveSecret(owner(user.id), 'GEMINI_API_KEY', KEY);
    // No manual clear: saving must do it, or a new key looks broken for 30s.
    expect(await secret('GEMINI_API_KEY')).toBe(KEY);
  });

  it('stores the model and the budget, with the environment still winning', async () => {
    const user = await createTestUser({ role: 'owner' });
    await saveSetting(owner(user.id), 'AI_MODEL', 'gemini-2.0-flash');
    expect(await setting('AI_MODEL')).toBe('gemini-2.0-flash');

    process.env.AI_MODEL = 'gemini-from-host';
    clearSecretCache();
    expect(await setting('AI_MODEL')).toBe('gemini-from-host');
  });

  it('defaults the budget to 5 dollars when nobody has set one', async () => {
    expect(await setting('AI_MONTHLY_CAP_USD')).toBe('5');
  });

  /*
   * An owner who once set AI_PROVIDER=none in their hosting panel must still be
   * able to switch the AI on from the CRM. `none` is the absence of a choice,
   * not a choice, and treating it as an override made Connect do nothing with
   * nothing on screen to explain why.
   */
  it('lets the CRM switch the AI on even when the host says none', async () => {
    const user = await createTestUser({ role: 'owner' });
    process.env.AI_PROVIDER = 'none';
    await saveSetting(owner(user.id), 'AI_PROVIDER', 'gemini');
    expect(await setting('AI_PROVIDER')).toBe('gemini');
    delete process.env.AI_PROVIDER;
  });

  it('still lets a host that names a real provider win', async () => {
    const user = await createTestUser({ role: 'owner' });
    process.env.AI_PROVIDER = 'openai';
    await saveSetting(owner(user.id), 'AI_PROVIDER', 'gemini');
    expect(await setting('AI_PROVIDER')).toBe('openai');
    delete process.env.AI_PROVIDER;
  });
});
