import { Client } from 'pg';
import { describe } from 'vitest';
import { closePool, execute, getPool, query } from '../db/client.js';
import { loadEnv, setEnvForTesting } from '../config/env.js';
import { runMigrations, ensureDatabase } from '../db/migrate.js';
import { newId } from '../lib/ids.js';
import { hashPassword } from '../auth/password.js';
import { DEFAULT_PIPELINE_KEY, STAGE_DEFINITIONS } from '../pipeline/stages.js';

/**
 * Integration-test harness. The suites that need a database skip themselves
 * when one is not reachable, so `npm test` stays green on a machine without
 * Postgres while still running for real in CI and locally.
 */

/*
 * One database per test worker.
 *
 * Vitest runs test files in parallel workers. Sharing one database means a
 * worker's `resetTables()` TRUNCATE takes an exclusive lock on every table
 * while another worker is mid-insert — which deadlocks, and when it does not
 * deadlock it is worse: one file silently empties another file's rows. A
 * database each costs a few seconds of migrations per worker and removes the
 * whole class of problem.
 */
const TEST_DB = `${process.env.TEST_DB_NAME ?? 'emir_crm_test'}${workerSuffix()}`;

function workerSuffix(): string {
  const id = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID;
  return id ? `_${id}` : '';
}

function testEnvSource(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DB_HOST: process.env.TEST_DB_HOST ?? process.env.DB_HOST ?? '127.0.0.1',
    DB_PORT: process.env.TEST_DB_PORT ?? process.env.DB_PORT ?? '5432',
    DB_USER: process.env.TEST_DB_USER ?? process.env.DB_USER ?? 'postgres',
    DB_PASSWORD: process.env.TEST_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    DB_NAME: TEST_DB,
    DATABASE_URL: '',
    ENCRYPTION_KEY: '0'.repeat(64),
    WHATSAPP_PROVIDER: 'log',
    AI_PROVIDER: 'none',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'error',
  };
}

let available: boolean | null = null;

/** Can we reach a Postgres server for the integration suites? */
export async function databaseAvailable(): Promise<boolean> {
  if (available !== null) return available;
  const source = testEnvSource();
  const client = new Client({
    host: source.DB_HOST,
    port: Number(source.DB_PORT),
    user: source.DB_USER,
    password: source.DB_PASSWORD,
    database: 'postgres',
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
    await client.end();
    available = true;
  } catch {
    await client.end().catch(() => undefined);
    available = false;
  }
  return available;
}

let prepared = false;

/** Create the test database, migrate it and seed the reference rows once. */
export async function prepareTestDatabase(): Promise<void> {
  setEnvForTesting(loadEnv(testEnvSource()));
  if (prepared) return;

  await ensureDatabase();
  await runMigrations();
  await seedReference();
  prepared = true;
}

async function seedReference(): Promise<void> {
  const existing = await query<{ id: string }>('SELECT id FROM pipelines WHERE "key" = ?', [DEFAULT_PIPELINE_KEY]);
  const pipelineId = existing[0]?.id ?? newId();
  if (!existing[0]) {
    await execute('INSERT INTO pipelines (id, "key", name, is_default) VALUES (?, ?, ?, 1)', [
      pipelineId,
      DEFAULT_PIPELINE_KEY,
      'Off-plan Sales',
    ]);
  }
  for (const stage of STAGE_DEFINITIONS) {
    await execute(
      `INSERT INTO pipeline_stages (id, pipeline_id, "key", name, position, is_won, is_lost, sub_statuses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT ON CONSTRAINT uq_stage_pipeline_key DO UPDATE SET name = EXCLUDED.name`,
      [newId(), pipelineId, stage.key, stage.name, stage.position, stage.isWon ? 1 : 0, stage.isLost ? 1 : 0, JSON.stringify(stage.subStatuses)],
    );
  }
  await seedFieldMappings();
}

/** The source-wide default mappings, restored after every reset. */
export async function seedFieldMappings(): Promise<void> {
  await execute(
    `INSERT INTO form_field_map (id, source, form_id, external_field, crm_field)
     VALUES (?, 'meta_lead_ads', NULL, 'full_name', 'full_name'),
            (?, 'meta_lead_ads', NULL, 'phone_number', 'phone'),
            (?, 'meta_lead_ads', NULL, 'email', 'email'),
            (?, 'meta_lead_ads', NULL, 'city', 'city'),
            (?, 'website', NULL, 'name', 'full_name'),
            (?, 'website', NULL, 'phone', 'phone'),
            (?, 'website', NULL, 'email', 'email'),
            (?, 'google_ads', NULL, 'FULL_NAME', 'full_name'),
            (?, 'google_ads', NULL, 'PHONE_NUMBER', 'phone'),
            (?, 'google_ads', NULL, 'EMAIL', 'email'),
            (?, 'google_ads', NULL, 'CITY', 'city')
     ON CONFLICT ON CONSTRAINT uq_form_field DO UPDATE SET crm_field = EXCLUDED.crm_field`,
    Array.from({ length: 11 }, () => newId()),
  );
}

/**
 * Tables emptied between tests. Reference rows that tests customise (field
 * mappings, tags, projects) are included and re-seeded, so no test can depend
 * on a previous one's leftovers. The order no longer matters — Postgres empties
 * them in one statement — but it is kept, grouped by feature, because that is
 * how the list is read and added to.
 */
const TRUNCATE_ORDER = [
  'website_leads',
  'ai_messages',
  'ai_conversations',
  // Sales offers — children first.
  'offer_events',
  'offer_views',
  'offer_units',
  'offers',
  'offer_folders',
  // Project library — children first.
  'payment_plan_rows',
  'payment_plans',
  'units',
  'unit_price_versions',
  'project_media',
  'project_floorplans',
  'project_amenities',
  'project_documents',
  'project_locations',
  'project_commissions',
  'project_imports',
  'developer_contacts',
  'developers',
  'campaign_members',
  'campaigns',
  'list_members',
  'lists',
  'import_rows',
  'imports',
  'import_mappings',
  'lead_pool_claims',
  'assignment_rules',
  'team_members',
  'teams',
  'ai_field_suggestions',
  'brochure_views',
  'conversion_events',
  'push_tokens',
  'unassigned_queue',
  'jobs',
  'workflow_runs',
  'messages',
  'conversations',
  'tasks',
  'activities',
  'consents',
  'contact_tags',
  'contact_identities',
  'opportunities',
  'contacts',
  'suppressions',
  'inbound_events',
  'login_attempts',
  'sessions',
  'audit_log',
  'users',
  'form_field_map',
  'tags',
  'projects',
];

export async function resetTables(): Promise<void> {
  /*
   * One statement, so no foreign key is ever looked at while the database is
   * half empty. CASCADE reaches any table these point at that is not already
   * listed, and RESTART IDENTITY puts login_attempts' counter back to 1 so a
   * test can assert on an id.
   *
   * Retried, because of the webhook tests. Those endpoints answer 200 and then
   * process the lead — that is the product requirement — so when a test ends,
   * work it started can still be writing. TRUNCATE wants an exclusive lock on
   * every table at once, and against a half-finished ingestion that is a
   * deadlock. The lock_timeout keeps a wait short, and a few attempts outlast
   * the leftover work. Only the harness needs this; nothing in the CRM
   * truncates anything.
   */
  const statement = `TRUNCATE ${TRUNCATE_ORDER.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await execute("SET lock_timeout = '4s'");
      await execute(statement);
      break;
    } catch (err) {
      if (attempt >= 6) throw err;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    } finally {
      await execute('SET lock_timeout = 0').catch(() => undefined);
    }
  }
  await seedFieldMappings();
}

export async function closeTestDatabase(): Promise<void> {
  await closePool();
}

export type TestUser = { id: string; email: string; role: string };

export async function createTestUser(
  over: Partial<{ name: string; email: string; role: string; managerId: string | null; weight: number; languages: string[]; projects: string[]; availability: string }> = {},
): Promise<TestUser> {
  const id = newId();
  const email = over.email ?? `user-${id.slice(0, 8)}@emircrm.test`;
  const { hash, algo } = await hashPassword('test-password-1', 'bcrypt');
  await execute(
    `INSERT INTO users (id, name, email, role, password_hash, password_algo, must_change_password, is_active,
                        availability, routing_weight, languages, projects_covered, manager_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?)`,
    [
      id,
      over.name ?? 'Test User',
      email,
      over.role ?? 'agent',
      hash,
      algo,
      over.availability ?? 'available',
      over.weight ?? 10,
      over.languages ? JSON.stringify(over.languages) : null,
      over.projects ? JSON.stringify(over.projects) : null,
      over.managerId ?? null,
    ],
  );
  return { id, email, role: over.role ?? 'agent' };
}

export { getPool, query, execute };

/**
 * `describe` that skips the whole block when no database is reachable.
 * Vitest needs the decision synchronously, so we probe once up front.
 */
export function describeWithDb(name: string, fn: () => void): void {
  const canConnect = process.env.SKIP_DB_TESTS === '1' ? false : probeSync();
  if (!canConnect) {
    describe.skip(`${name} (skipped: no database reachable)`, fn);
    return;
  }
  describe(name, fn);
}

function probeSync(): boolean {
  // vitest evaluates describe() bodies synchronously, so use a cheap TCP probe
  // performed once by the globalSetup file, which records the result here.
  return process.env.__EMIR_DB_AVAILABLE__ === '1';
}
