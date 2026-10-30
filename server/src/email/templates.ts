/**
 * The template library: the six the CRM ships with, plus whatever the team
 * writes.
 *
 * Seeding only ever inserts what is missing. An owner who rewrites "First
 * reply" keeps their wording through every deploy — a seed that overwrote on
 * each start would quietly undo their work, and they would never know which
 * release did it.
 */
import { randomUUID } from 'node:crypto';
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { logger } from '../lib/logger.js';
import { SYSTEM_TEMPLATES } from './system-templates.js';
import { unknownFields } from './merge.js';

export interface EmailTemplateRow {
  id: string;
  template_key: string | null;
  name: string;
  category: string;
  language: string;
  subject: string;
  body: string;
  preview_text: string | null;
  is_system: number;
  enabled: number;
  updated_at: string;
}

export async function seedSystemTemplates(exec: Executor = getPool()): Promise<number> {
  let added = 0;
  for (const template of SYSTEM_TEMPLATES) {
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM email_templates WHERE template_key = ? AND language = ?',
      [template.key, 'en'],
      exec,
    );
    if (existing) continue;

    await execute(
      `INSERT INTO email_templates
         (id, template_key, name, category, language, subject, body, preview_text, is_system)
       VALUES (?, ?, ?, ?, 'en', ?, ?, ?, 1)`,
      [
        randomUUID(), template.key, template.name, template.category,
        template.subject, template.body, template.previewText,
      ],
      exec,
    );
    added += 1;
  }
  if (added > 0) logger.info('seeded the email templates the CRM ships with', { added });
  return added;
}

export async function listTemplates(
  options: { includeDisabled?: boolean } = {},
  exec: Executor = getPool(),
): Promise<EmailTemplateRow[]> {
  return query<EmailTemplateRow>(
    `SELECT id, template_key, name, category, language, subject, body, preview_text,
            is_system, enabled, updated_at
       FROM email_templates
      WHERE deleted_at IS NULL ${options.includeDisabled ? '' : 'AND enabled = 1'}
      ORDER BY is_system DESC, category, name`,
    [],
    exec,
  );
}

export async function getTemplate(id: string, exec: Executor = getPool()): Promise<EmailTemplateRow | null> {
  return queryOne<EmailTemplateRow>(
    `SELECT id, template_key, name, category, language, subject, body, preview_text,
            is_system, enabled, updated_at
       FROM email_templates WHERE id = ? AND deleted_at IS NULL`,
    [id],
    exec,
  );
}

export interface TemplateInput {
  name: string;
  category: string;
  language?: string;
  subject: string;
  body: string;
  previewText?: string | null;
  enabled?: boolean;
}

/** A template whose merge fields do not exist would go out broken. */
function assertFieldsExist(input: TemplateInput): void {
  const bad = [...new Set([...unknownFields(input.subject), ...unknownFields(input.body)])];
  if (bad.length > 0) {
    throw Object.assign(
      new Error(`These fields do not exist: ${bad.join(', ')}`),
      { status: 400 },
    );
  }
}

export async function createTemplate(actor: AuditActor, input: TemplateInput): Promise<string> {
  assertFieldsExist(input);
  const id = randomUUID();
  await execute(
    `INSERT INTO email_templates
       (id, name, category, language, subject, body, preview_text, enabled, created_by_user_id, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.name, input.category, input.language ?? 'en', input.subject, input.body,
      input.previewText ?? null, input.enabled === false ? 0 : 1, actor.userId, actor.userId,
    ],
  );
  await writeAudit({
    actor, action: 'email_template.created', entityType: 'email_template', entityId: id,
    after: { name: input.name, category: input.category },
  });
  return id;
}

export async function updateTemplate(
  actor: AuditActor,
  id: string,
  input: Partial<TemplateInput>,
): Promise<boolean> {
  const before = await getTemplate(id);
  if (!before) return false;

  assertFieldsExist({
    name: input.name ?? before.name,
    category: input.category ?? before.category,
    subject: input.subject ?? before.subject,
    body: input.body ?? before.body,
  });

  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    args.push(value);
  };

  if (input.name !== undefined) set('name', input.name);
  if (input.category !== undefined) set('category', input.category);
  if (input.subject !== undefined) set('subject', input.subject);
  if (input.body !== undefined) set('body', input.body);
  if (input.previewText !== undefined) set('preview_text', input.previewText);
  if (input.enabled !== undefined) set('enabled', input.enabled ? 1 : 0);
  if (sets.length === 0) return false;
  set('updated_by_user_id', actor.userId);

  await execute(`UPDATE email_templates SET ${sets.join(', ')} WHERE id = ?`, [...args, id]);
  await writeAudit({
    actor, action: 'email_template.updated', entityType: 'email_template', entityId: id,
    before: { subject: before.subject, name: before.name },
    after: input as Record<string, unknown>,
  });
  return true;
}

/**
 * Remove a template.
 *
 * A system one is switched off rather than deleted: an agent who deletes
 * "First reply" leaves the team with no first reply and no way back.
 */
export async function removeTemplate(actor: AuditActor, id: string): Promise<'disabled' | 'deleted' | null> {
  const template = await getTemplate(id);
  if (!template) return null;

  if (template.is_system === 1) {
    await execute('UPDATE email_templates SET enabled = 0, updated_by_user_id = ? WHERE id = ?', [actor.userId, id]);
    await writeAudit({
      actor, action: 'email_template.disabled', entityType: 'email_template', entityId: id,
      before: { name: template.name },
    });
    return 'disabled';
  }

  await execute('UPDATE email_templates SET deleted_at = NOW(3), updated_by_user_id = ? WHERE id = ?', [actor.userId, id]);
  await writeAudit({
    actor, action: 'email_template.deleted', entityType: 'email_template', entityId: id,
    before: { name: template.name },
  });
  return 'deleted';
}
