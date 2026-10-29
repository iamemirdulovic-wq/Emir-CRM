import { execute, query, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { pushToManagers } from '../push.js';
import { whatsapp } from '../whatsapp/index.js';
import { TEMPLATE_LIBRARY } from './library.js';
import { validateTemplate } from './validator.js';

/**
 * Pull template status from the provider and alert when one is paused or
 * rejected — a paused `lead_welcome` silently breaks the 30-second promise,
 * so it must be noisy.
 */

export type SyncResult = {
  synced: number;
  newlyBroken: Array<{ name: string; language: string; status: string; reason: string | null }>;
  missingFromProvider: string[];
};

const BROKEN = new Set(['REJECTED', 'PAUSED', 'DISABLED']);

export async function syncTemplates(): Promise<SyncResult> {
  const adapter = whatsapp();
  const remote = await adapter.listTemplates();

  if (remote.length === 0) {
    logger.info('template sync returned nothing; the provider may not expose template status', { provider: adapter.name });
    return { synced: 0, newlyBroken: [], missingFromProvider: [] };
  }

  const before = await query<{ name: string; language: string; status: string }>(
    'SELECT name, language, status FROM wa_templates',
  );
  const previousStatus = new Map(before.map((row) => [`${row.name}:${row.language}`, row.status]));

  const newlyBroken: SyncResult['newlyBroken'] = [];
  const seen = new Set<string>();

  for (const template of remote) {
    const key = `${template.name}:${template.language}`;
    seen.add(key);

    await execute(
      `INSERT INTO wa_templates (id, name, language, category, status, provider_template_id, components,
                                 quality_score, rejected_reason, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         category = VALUES(category), status = VALUES(status),
         provider_template_id = VALUES(provider_template_id), components = VALUES(components),
         quality_score = VALUES(quality_score), rejected_reason = VALUES(rejected_reason),
         last_synced_at = NOW(3)`,
      [
        newId(),
        template.name,
        template.language,
        normalizeCategory(template.category),
        normalizeStatus(template.status),
        template.id ?? null,
        JSON.stringify(template.components ?? []),
        template.qualityScore ?? null,
        template.rejectedReason ?? null,
      ],
    );

    const status = normalizeStatus(template.status);
    const wasBroken = BROKEN.has(previousStatus.get(key) ?? '');
    if (BROKEN.has(status) && !wasBroken) {
      newlyBroken.push({
        name: template.name,
        language: template.language,
        status,
        reason: template.rejectedReason ?? null,
      });
    }
  }

  // A template we rely on that the provider has never heard of is just as
  // broken as a rejected one.
  const missingFromProvider = TEMPLATE_LIBRARY.filter((t) => !seen.has(`${t.name}:${t.language}`)).map((t) => t.name);

  if (newlyBroken.length > 0) {
    logger.error('whatsapp templates are no longer usable', { templates: newlyBroken });
    await pushToManagers({
      title: 'WhatsApp template problem',
      body: newlyBroken.map((t) => `${t.name} (${t.language}) is ${t.status}`).join('; ').slice(0, 300),
      link: '/templates',
      priority: 'high',
    }).catch(() => 0);
  }
  if (missingFromProvider.length > 0) {
    logger.warn('templates in the day-one library are missing at the provider', { templates: missingFromProvider });
  }

  return { synced: remote.length, newlyBroken, missingFromProvider };
}

function normalizeStatus(status: string): string {
  const upper = status.toUpperCase();
  return ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED'].includes(upper) ? upper : 'PENDING';
}

function normalizeCategory(category: string): string {
  const upper = category.toUpperCase();
  return ['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(upper) ? upper : 'UTILITY';
}

/** Is this template safe to send right now? */
export async function isTemplateApproved(name: string, language: string): Promise<boolean> {
  const row = await queryOne<{ status: string }>('SELECT status FROM wa_templates WHERE name = ? AND language = ?', [
    name,
    language,
  ]);
  return row?.status === 'APPROVED';
}

/** Seed the local library, validating before anything is submitted to Meta. */
export async function seedLocalTemplates(): Promise<{ inserted: number; invalid: string[] }> {
  const invalid: string[] = [];
  let inserted = 0;

  for (const template of TEMPLATE_LIBRARY) {
    const result = validateTemplate(template);
    if (!result.valid) {
      invalid.push(`${template.name}: ${result.issues.map((i) => i.message).join(', ')}`);
      continue;
    }
    await execute(
      `INSERT INTO wa_templates (id, name, language, category, status, components)
       VALUES (?, ?, ?, ?, 'DRAFT', ?)
       ON DUPLICATE KEY UPDATE components = VALUES(components)`,
      [newId(), template.name, template.language, template.category, JSON.stringify(template.components)],
    );
    inserted += 1;
  }
  return { inserted, invalid };
}
