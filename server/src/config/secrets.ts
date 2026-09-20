/**
 * Secrets and settings the owner can change without a redeploy.
 *
 * The rule is unchanged: an environment variable always wins. This is the
 * fallback for an owner on managed hosting who has no terminal, where every
 * environment variable means a control panel and a restart — and an API key
 * that can only be set that way is an API key that never gets set.
 *
 * What is stored here is encrypted with AES-256-GCM. The encryption key itself
 * is `ENCRYPTION_KEY` and stays in the environment, because a key kept beside
 * the data it protects protects nothing.
 */
import { env } from './env.js';
import { execute, getPool, query, queryOne, type Executor } from '../db/client.js';
import { decryptSecret, encryptSecret } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';

export type SecretName = 'GEMINI_API_KEY' | 'OPENAI_API_KEY';
export type SettingName = 'AI_PROVIDER' | 'AI_MODEL' | 'AI_MONTHLY_CAP_USD';

/*
 * Cached, because this is read on the path of every AI call and a database
 * round trip per call is a silly price for a value that changes twice a year.
 * Cleared the moment anything is written, so a new key takes effect at once.
 */
let cache: {
  secrets: Map<string, string>;
  settings: Map<string, string>;
  /** Stored but undecryptable: not saved with the key we now hold. */
  unreadable: Set<string>;
  at: number;
} | null = null;
const TTL_MS = 30_000;

export function clearSecretCache(): void {
  cache = null;
}

async function load(exec: Executor): Promise<NonNullable<typeof cache>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;

  const secrets = new Map<string, string>();
  const settings = new Map<string, string>();
  const unreadable = new Set<string>();

  try {
    for (const row of await query<{ name: string; value_enc: string }>('SELECT name, value_enc FROM app_secrets', [], exec)) {
      try {
        secrets.set(row.name, decryptSecret(row.value_enc));
      } catch {
        /*
         * A secret that will not decrypt means ENCRYPTION_KEY has changed since
         * it was stored. Logged by name only — never the value, and never the
         * error, which can echo the ciphertext.
         */
        logger.warn('a stored secret could not be decrypted; re-enter it in Settings', { name: row.name });
        unreadable.add(row.name);
      }
    }
    for (const row of await query<{ name: string; value: string | null }>('SELECT name, value FROM app_settings', [], exec)) {
      if (row.value !== null) settings.set(row.name, row.value);
    }
  } catch {
    // Before the migration runs, or if the database is briefly unavailable:
    // fall back to the environment rather than taking the whole app down.
  }

  cache = { secrets, settings, unreadable, at: Date.now() };
  return cache;
}

/**
 * Secrets that are stored but cannot be read.
 *
 * Not the same as "not configured": the owner did connect a key, and the
 * encryption key has changed underneath it since. The difference matters,
 * because the screen otherwise says "not connected" to someone who connected
 * it last week and has no idea what happened.
 */
export async function unreadableSecrets(exec: Executor = getPool()): Promise<string[]> {
  return [...(await load(exec)).unreadable];
}

/** The environment first, then what the owner saved in the CRM. */
export async function secret(name: SecretName, exec: Executor = getPool()): Promise<string | null> {
  const fromEnv = env()[name];
  if (fromEnv) return fromEnv;
  return (await load(exec)).secrets.get(name) ?? null;
}

export async function setting(name: SettingName, exec: Executor = getPool()): Promise<string | null> {
  const cfg = env();
  const fromEnv = process.env[name];
  /*
   * An explicit environment value wins — except `AI_PROVIDER=none`, which is
   * the absence of a choice rather than a choice. Treating it as an override
   * means an owner who once set it to `none` in their hosting panel could press
   * Connect in the CRM and have nothing happen, with nothing on screen to say
   * why. That is the one state this screen exists to change.
   */
  if (fromEnv && !(name === 'AI_PROVIDER' && fromEnv === 'none')) return fromEnv;
  const stored = (await load(exec)).settings.get(name);
  if (stored) return stored;
  if (name === 'AI_PROVIDER') return cfg.AI_PROVIDER;
  if (name === 'AI_MONTHLY_CAP_USD') return String(cfg.AI_MONTHLY_CAP_USD);
  return cfg.AI_MODEL ?? null;
}

/** Where a value came from, so the screen can say "set in Hostinger" honestly. */
export async function secretSource(name: SecretName, exec: Executor = getPool()): Promise<'env' | 'crm' | 'none'> {
  if (env()[name]) return 'env';
  return (await load(exec)).secrets.has(name) ? 'crm' : 'none';
}

export async function saveSecret(
  actor: AuditActor,
  name: SecretName,
  value: string,
  exec: Executor = getPool(),
): Promise<void> {
  const trimmed = value.trim();
  // Encrypting an empty string would store a valid-looking secret that is not
  // one; clearing is a separate, explicit action.
  if (!trimmed) throw new Error('That key is empty');

  const enc = encryptSecret(trimmed);
  await execute(
    `INSERT INTO app_secrets (name, value_enc, hint, updated_by_user_id) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value_enc = VALUES(value_enc), hint = VALUES(hint), updated_by_user_id = VALUES(updated_by_user_id)`,
    [name, enc, trimmed.slice(-4), actor.userId],
    exec,
  );
  clearSecretCache();

  await writeAudit(
    // The value is never audited, only that it changed and who by.
    { actor, action: 'secret.saved', entityType: 'secret', entityId: name, after: { name, endsWith: trimmed.slice(-4) } },
    exec,
  );
}

export async function clearSecret(actor: AuditActor, name: SecretName, exec: Executor = getPool()): Promise<void> {
  await execute('DELETE FROM app_secrets WHERE name = ?', [name], exec);
  clearSecretCache();
  await writeAudit({ actor, action: 'secret.cleared', entityType: 'secret', entityId: name }, exec);
}

export async function saveSetting(
  actor: AuditActor,
  name: SettingName,
  value: string | null,
  exec: Executor = getPool(),
): Promise<void> {
  await execute(
    `INSERT INTO app_settings (name, value, updated_by_user_id) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by_user_id = VALUES(updated_by_user_id)`,
    [name, value, actor.userId],
    exec,
  );
  clearSecretCache();
  await writeAudit({ actor, action: 'setting.saved', entityType: 'setting', entityId: name, after: { value } }, exec);
}

/** The last four characters, for telling one key from another on screen. */
export async function secretHint(name: SecretName, exec: Executor = getPool()): Promise<string | null> {
  if (env()[name]) return null; // set in the environment; nothing to show
  const row = await queryOne<{ hint: string | null }>('SELECT hint FROM app_secrets WHERE name = ?', [name], exec);
  return row?.hint ?? null;
}
