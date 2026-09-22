import mysql from 'mysql2/promise';
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
 * MySQL while still running for real in CI and locally.
 */

const TEST_DB = process.env.TEST_DB_NAME ?? 'emir_crm_test';

function testEnvSource(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DB_HOST: process.env.TEST_DB_HOST ?? process.env.DB_HOST ?? '127.0.0.1',
    DB_PORT: process.env.TEST_DB_PORT ?? process.env.DB_PORT ?? '3306',
    DB_USER: process.env.TEST_DB_USER ?? process.env.DB_USER ?? 'root',
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

/** Can we reach a MySQL-compatible server for the integration suites? */
export async function databaseAvailable(): Promise<boolean> {
  if (available !== null) return available;
  const source = testEnvSource();
  try {
    const conn = await mysql.createConnection({
      host: source.DB_HOST,
      port: Number(source.DB_PORT),
      user: source.DB_USER,
      password: source.DB_PASSWORD,
      connectTimeout: 3000,
    });
    await conn.end();
    available = true;
  } catch {
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
  const existing = await query<{ id: string }>('SELECT id FROM pipelines WHERE `key` = ?', [DEFAULT_PIPELINE_KEY]);
  const pipelineId = existing[0]?.id ?? newId();
  if (!existing[0]) {
    await execute('INSERT INTO pipelines (id, `key`, name, is_default) VALUES (?, ?, ?, 1)', [
      pipelineId,
      DEFAULT_PIPELINE_KEY,
      'Off-plan Sales',
    ]);
  }
  for (const stage of STAGE_DEFINITIONS) {
    await execute(
      `INSERT INTO pipeline_stages (id, pipeline_id, \`key\`, name, position, is_won, is_lost, sub_statuses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
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
     ON DUPLICATE KEY UPDATE crm_field = VALUES(crm_field)`,
    Array.from({ length: 11 }, () => newId()),
  );
}

/**
 * Tables emptied between tests, children before parents. Reference rows that
 * tests customise (field mappings, tags, projects) are included and re-seeded,
 * so no test can depend on a previous one's leftovers.
 */
const TRUNCATE_ORDER = [
  'ai_messages',
  'ai_conversations',
  // Sales offers — children first.
  'offer_events',
  'offer_views',
  'offer_units',
  'offers',
  'offer_folders',
  // Project library — children first, though FOREIGN_KEY_CHECKS is off anyway.
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
  await execute('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of TRUNCATE_ORDER) {
    await execute(`TRUNCATE TABLE ${table}`);
  }
  await execute('SET FOREIGN_KEY_CHECKS = 1');
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
