import { execute, getPool, queryOne, closePool } from './client.js';
import { newId } from '../lib/ids.js';
import { logger, errorContext } from '../lib/logger.js';
import { normalizeEmail } from '../lib/email.js';
import { hashPassword, generateTemporaryPassword } from '../auth/password.js';
import { DEFAULT_PIPELINE_KEY, STAGE_DEFINITIONS } from '../pipeline/stages.js';
import { TEMPLATE_LIBRARY } from '../messaging/templates/library.js';
import { ensureDatabase, runMigrations } from './migrate.js';

/** Idempotent seed: safe to re-run against an existing database. */

async function seedPipeline(): Promise<void> {
  const existing = await queryOne<{ id: string }>('SELECT id FROM pipelines WHERE `key` = ?', [DEFAULT_PIPELINE_KEY]);
  const pipelineId = existing?.id ?? newId();
  if (!existing) {
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
       ON DUPLICATE KEY UPDATE name = VALUES(name), position = VALUES(position),
                               is_won = VALUES(is_won), is_lost = VALUES(is_lost),
                               sub_statuses = VALUES(sub_statuses)`,
      [
        newId(),
        pipelineId,
        stage.key,
        stage.name,
        stage.position,
        stage.isWon ? 1 : 0,
        stage.isLost ? 1 : 0,
        JSON.stringify(stage.subStatuses),
      ],
    );
  }
  logger.info('pipeline seeded', { pipeline: DEFAULT_PIPELINE_KEY, stages: STAGE_DEFINITIONS.length });
}

async function seedTemplates(): Promise<void> {
  for (const template of TEMPLATE_LIBRARY) {
    await execute(
      `INSERT INTO wa_templates (id, name, language, category, status, components)
       VALUES (?, ?, ?, ?, 'DRAFT', ?)
       ON DUPLICATE KEY UPDATE components = VALUES(components), category = VALUES(category)`,
      [newId(), template.name, template.language, template.category, JSON.stringify(template.components)],
    );
  }
  logger.info('whatsapp templates seeded', { count: TEMPLATE_LIBRARY.length });
}

async function seedWorkflows(): Promise<void> {
  const workflows = [
    { key: 'A_instant_capture', name: 'Workflow A — Instant capture', description: 'Assign, welcome on WhatsApp, push the agent, SLA at 5 minutes.' },
    { key: 'B_no_response_followup', name: 'Workflow B — No-response follow-up', description: '+2h, +24h, +72h templates then Lost (unresponsive) at +96h.' },
    { key: 'C_inbound_routing', name: 'Workflow C — Inbound WhatsApp routing', description: 'Cancel follow-ups, move to Engaged, resolve and route intent.' },
  ];
  for (const wf of workflows) {
    await execute(
      'INSERT INTO workflows (id, `key`, name, description, is_active) VALUES (?, ?, ?, ?, 1) ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)',
      [newId(), wf.key, wf.name, wf.description],
    );
  }
  logger.info('workflows seeded', { count: workflows.length });
}

async function seedTags(): Promise<void> {
  const tags: Array<[string, string, string]> = [
    ['src', 'meta_lead_ads', 'Meta Lead Ads'],
    ['src', 'meta_ctwa', 'Click-to-WhatsApp'],
    ['src', 'whatsapp_direct', 'WhatsApp direct'],
    ['src', 'website', 'Website form'],
    ['src', 'google_ads', 'Google Ads'],
    ['src', 'csv_import', 'CSV import'],
    ['src', 'manual', 'Manual entry'],
    ['intent', 'hot', 'Hot lead'],
    ['intent', 'pricing', 'Asked for pricing'],
    ['intent', 'brochure', 'Asked for brochure'],
    ['intent', 'call_me', 'Requested a call'],
    ['lang', 'en', 'English'],
    ['lang', 'ar', 'Arabic'],
    ['ops', 'sla-breach', 'SLA breach'],
    ['ops', 'possible-duplicate', 'Possible duplicate'],
  ];
  for (const [namespace, value, label] of tags) {
    await execute(
      'INSERT INTO tags (id, namespace, value, label) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE label = VALUES(label)',
      [newId(), namespace, value, label],
    );
  }
  logger.info('tags seeded', { count: tags.length });
}

/**
 * Meta's own field names for the standard lead-form questions. Custom questions
 * are added by an admin on the Integrations page — never hard-coded.
 */
async function seedFormFieldMap(): Promise<void> {
  const rows: Array<[string, string, string]> = [
    ['meta_lead_ads', 'full_name', 'full_name'],
    ['meta_lead_ads', 'first_name', 'first_name'],
    ['meta_lead_ads', 'last_name', 'last_name'],
    ['meta_lead_ads', 'phone_number', 'phone'],
    ['meta_lead_ads', 'email', 'email'],
    ['meta_lead_ads', 'city', 'city'],
    ['website', 'name', 'full_name'],
    ['website', 'phone', 'phone'],
    ['website', 'email', 'email'],
    ['website', 'message', 'notes'],
    ['google_ads', 'FULL_NAME', 'full_name'],
    ['google_ads', 'PHONE_NUMBER', 'phone'],
    ['google_ads', 'EMAIL', 'email'],
    ['google_ads', 'CITY', 'city'],
  ];
  for (const [source, externalField, crmField] of rows) {
    await execute(
      `INSERT INTO form_field_map (id, source, form_id, external_field, crm_field)
       VALUES (?, ?, NULL, ?, ?)
       ON DUPLICATE KEY UPDATE crm_field = VALUES(crm_field)`,
      [newId(), source, externalField, crmField],
    );
  }
  logger.info('form field map seeded', { count: rows.length });
}

async function seedOwner(): Promise<void> {
  const email = normalizeEmail(process.env.SEED_OWNER_EMAIL ?? 'owner@emircrm.local');
  if (!email) throw new Error('SEED_OWNER_EMAIL is not a valid email address');

  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    logger.info('owner already exists, leaving the password alone', { email });
    return;
  }

  const temporary = process.env.SEED_OWNER_PASSWORD ?? generateTemporaryPassword();
  const { hash, algo } = await hashPassword(temporary);
  await execute(
    `INSERT INTO users (id, name, email, role, password_hash, password_algo, must_change_password, is_active)
     VALUES (?, ?, ?, 'owner', ?, ?, 1, 1)`,
    [newId(), process.env.SEED_OWNER_NAME ?? 'Owner', email, hash, algo],
  );

  // Printed once, to stdout only, so the operator can sign in. It must be
  // changed on first login.
  process.stdout.write(
    `\n  Owner account created\n    email:    ${email}\n    password: ${temporary}\n    (must be changed on first login)\n\n`,
  );
}

async function seedAssignmentState(): Promise<void> {
  await execute(
    'INSERT INTO assignment_state (id, cursor_user_id, counters) VALUES (?, NULL, ?) ON DUPLICATE KEY UPDATE id = id',
    ['round_robin', JSON.stringify({})],
  );
}

export async function seed(): Promise<void> {
  await ensureDatabase();
  await runMigrations();
  await seedPipeline();
  await seedTemplates();
  await seedWorkflows();
  await seedTags();
  await seedFormFieldMap();
  await seedAssignmentState();
  await seedOwner();
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('seed.ts');
if (invokedDirectly) {
  seed()
    .then(async () => {
      logger.info('seed complete');
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error('seed failed', errorContext(err));
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}

export { getPool };
