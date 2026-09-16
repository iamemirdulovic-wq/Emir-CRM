import { execute, type Executor, getPool } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger, errorContext } from '../lib/logger.js';
import type { Role } from '../auth/rbac.js';

export type AuditActor = {
  userId: string | null;
  role: Role | null;
  label?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/** The automation service account. Every one of its actions is audited. */
export const SYSTEM_ACTOR: AuditActor = { userId: null, role: 'automation', label: 'system' };

export type AuditEntry = {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

/**
 * Every data-changing action writes here, with actor, role, before and after.
 * Auditing must never break the operation it is recording, so failures are
 * logged rather than thrown.
 */
export async function writeAudit(entry: AuditEntry, exec: Executor = getPool()): Promise<void> {
  try {
    await execute(
      `INSERT INTO audit_log
         (id, actor_user_id, actor_role, actor_label, action, entity_type, entity_id, before_json, after_json, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        entry.actor.userId,
        entry.actor.role,
        entry.actor.label ?? null,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === undefined ? null : JSON.stringify(entry.after),
        entry.actor.ip ?? null,
        entry.actor.userAgent ?? null,
      ],
      exec,
    );
  } catch (err) {
    logger.error('audit write failed', { action: entry.action, entityType: entry.entityType, ...errorContext(err) });
  }
}

/**
 * Reduce `before`/`after` to the fields that actually changed, so the audit log
 * stays readable and does not duplicate whole records.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    const prev = before?.[key];
    const next = after?.[key];
    if (JSON.stringify(prev ?? null) === JSON.stringify(next ?? null)) continue;
    if (prev !== undefined) b[key as keyof T] = prev as T[keyof T];
    if (next !== undefined) a[key as keyof T] = next as T[keyof T];
  }
  return { before: b, after: a };
}
