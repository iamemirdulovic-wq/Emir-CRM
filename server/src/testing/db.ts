import mysql from 'mysql2/promise';
import { describe } from 'vitest';
import { closePool, execute, getPool, query } from '../db/client.js';
import { loadEnv, setEnvForTesting } from '../config/env.js';
import { runMigrations, ensureDatabase } from '../db/migrate.js';
import { newId } from '../lib/ids.js';
import { hashPassword } from '../auth/password.js';
import { DEFAULT_PIPELINE_KEY, STAGE_DEFINITIONS } from '../pipeline/stages.js';
import { clearSecretCache } from '../config/secrets.js';

/**
 * Integration-test harness. The suites that need a database skip themselves
 * when one is not reachable, so `npm test` stays green on a machine without
 * MySQL while still running for real in CI and locally.
 */

/*
 * Which database the integration suites run against.
 *
 * `TEST_DB_NAME` is the caller's own choice and wins. Otherwise it is the one
 * `global-setup.ts` made for this run and will drop again at the end — see
 * the note at the top of that file for why a run must not share a database
 * with another run. `emir_crm_test` is the last resort, for a run started
 * without this project's vitest config and so without that global setup.
 */
const TEST_DB = process.env.TEST_DB_NAME ?? process.env.__EMIR_TEST_DB__ ?? 'emir_crm_test';

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
export const TRUNCATE_ORDER = [
  /*
   * Settings first, and this one matters: a test that changes how routing
   * behaves used to leave that change in the database for every test after
   * it. Clearing the in-memory cache was not enough — the row was still
   * there. The failure then lands on whichever test happens to run next,
   * which is the worst kind to find.
   */
  'app_settings',
  'app_secrets',
  /*
   * v2's tables (migration 0036). Children before parents, like the rest of
   * this list -- though FOREIGN_KEY_CHECKS is off while it runs, so the order
   * is for the reader rather than the database.
   *
   * Every one of these was missing until the guard below caught it. A table
   * that is never emptied hands its rows to the next test, and the failure
   * lands on whichever test happens to run after the one that wrote them.
   */
  'link_opens',
  'tracking_links',
  'message_taps',
  'call_logs',
  'meetings',
  'outside_trips',
  'leave_requests',
  'office_networks',
  'lead_transfers',
  'vip_handoffs',
  'desk_members',
  'desks',
  'live_projects',
  'banners',
  'feedback_tickets',
  'notification_prefs',
  'telegram_links',
  'website_leads',
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
  'login_links',
  'sessions',
  'session_log',
  'notifications',
  'audit_log',
  // Step 10 — email, children first.
  'email_events',
  'email_campaign_members',
  'email_campaigns',
  'email_templates',
  'wa_templates',
  'workflows',
  // Steps 7 and 8 — the lead's own working data.
  'note_files',
  'lead_notes',
  'task_attachments',
  'lead_ai_scores',
  'lead_assignments',
  'assignment_state',
  // Steps 12 and 13 — profiles, badges and the wall.
  'wall_reactions',
  'wall_comments',
  'wall_posts',
  'kudos',
  'xp_events',
  'user_badges',
  'agent_profiles',
  // Step 14 — preferences and what the AI has been asked.
  'user_prefs',
  'user_onboarding',
  'wall_media',
  'attendance',
  'ai_usage',
  'ai_knowledge_versions',
  'ai_knowledge',
  /*
   * Step 17. Without this, the first test to set up the CRM claimed it for the
   * whole file and every later setup test got a 409 — which is exactly the
   * failure the comment at the top of this list describes, landing on whichever
   * test happened to run next.
   */
  'setup_claims',
  'users',
  'form_field_map',
  'tags',
  'projects',
];

/*
 * A table name from `TRUNCATE_ORDER` goes into SQL as text, because a table
 * name cannot be a bound parameter. The list is hand-written in this file and
 * `reset-complete.test.ts` already checks every entry against the migrations,
 * so there is nothing here an outsider can reach — but check the shape once
 * at load anyway, so that stays true if someone pastes something odd in.
 */
for (const table of TRUNCATE_ORDER) {
  if (!/^[a-z][a-z0-9_]*$/.test(table)) {
    throw new Error(`TRUNCATE_ORDER contains a name that is not a plain table name: ${table}`);
  }
}

/**
 * Tables that have been seen holding a row at any point in this run.
 *
 * Emptying a hundred-odd tables before every single test was almost the whole
 * cost of an integration run — measured at four to six seconds a test, against
 * a suite where the tests themselves are milliseconds. Nearly all of those
 * tables are already empty, and that does not make it cheaper: `TRUNCATE` on
 * an empty InnoDB table still drops and recreates its tablespace, so it costs
 * the same as one with rows in it.
 *
 * So a reset now asks, in one query, which tables actually hold a row, and
 * empties those. The answer is remembered for the rest of the run and never
 * forgotten: once a table has held a row it is emptied on every later reset
 * whether the probe found anything in it or not. That is what keeps this as
 * thorough as emptying everything — a row written by work that is still in
 * flight when the next test starts cannot hide behind a probe that ran a
 * moment earlier, because its table is on this list from then on.
 */
const everHeldRows = new Set<string>();

/** One query, one row per table that is not empty. */
async function tablesHoldingRows(conn: mysql.PoolConnection): Promise<string[]> {
  const probe = TRUNCATE_ORDER
    .map((table) => `(SELECT '${table}' AS t FROM \`${table}\` LIMIT 1)`)
    .join(' UNION ALL ');
  const rows = await query<{ t: string }>(probe, [], conn);
  return rows.map((row) => row.t);
}

export async function resetTables(): Promise<void> {
  /*
   * One connection for the whole reset. `FOREIGN_KEY_CHECKS` is a session
   * setting, and `execute()` takes whichever connection the pool hands it —
   * so switching it off and truncating on two different connections is a
   * flake waiting for a busy pool, and leaving it off on a connection the
   * pool then gives to someone else is worse.
   */
  const conn = await getPool().getConnection();
  try {
    for (const table of await tablesHoldingRows(conn)) everHeldRows.add(table);
    /* In TRUNCATE_ORDER's order: settings first, children before parents. */
    const toEmpty = TRUNCATE_ORDER.filter((table) => everHeldRows.has(table));

    if (toEmpty.length) {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const table of toEmpty) await conn.query(`TRUNCATE TABLE \`${table}\``);
      } finally {
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      }
    }
  } finally {
    conn.release();
  }

  /*
   * Settings and secrets are cached in memory for thirty seconds, and
   * truncating the table does not touch that. Nothing here relies on a test
   * finishing inside that window — the cache is dropped on every reset, so a
   * test that changed a setting cannot hand its value to the test after it
   * however long either of them takes. (An earlier version of this comment
   * argued from "a whole suite runs well inside thirty seconds", which has
   * not been true for a long time; the clearing is what makes it safe, not
   * the timing.)
   */
  clearSecretCache();
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
