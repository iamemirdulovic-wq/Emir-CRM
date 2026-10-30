/**
 * Noticing when someone is reading the client database rather than working it.
 *
 * An agent legitimately opens a few dozen leads a day: the ones they were
 * given, the ones they are calling back, the ones they search for by name.
 * Paging through hundreds in an hour is a different activity, and it is the
 * shape copying the database takes once exporting it is closed off.
 *
 * This does not block anyone — a false positive that stops an agent working is
 * worse than the thing it is guarding against. It counts, and it tells the
 * owner, who knows which of their people is doing what and why.
 */
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { logger } from '../lib/logger.js';

/** Distinct leads in the window before the owner hears about it. */
export const BROWSE_ALARM = 200;
const WINDOW_MS = 60 * 60 * 1000;

interface Window {
  /** The leads seen, so opening the same one ten times counts once. */
  seen: Set<string>;
  startedAt: number;
  alarmed: boolean;
}

const windows = new Map<string, Window>();

/**
 * Pure, so the rule can be tested without a clock or a database.
 * Returns the window to keep and whether this view crosses the line.
 */
export function recordView(
  window: Window | undefined,
  leadId: string,
  now: number,
  limit = BROWSE_ALARM,
): { window: Window; alarm: boolean } {
  const fresh = !window || now - window.startedAt >= WINDOW_MS;
  const next: Window = fresh
    ? { seen: new Set([leadId]), startedAt: now, alarmed: false }
    : { ...window, seen: new Set(window.seen).add(leadId) };

  /*
   * Once per window, not once per lead past the line. An agent who is told to
   * clean up a list of four hundred would otherwise generate two hundred
   * identical alerts, and the owner would learn to ignore all of them.
   */
  const alarm = next.seen.size >= limit && !next.alarmed;
  if (alarm) next.alarmed = true;
  return { window: next, alarm };
}

/**
 * Call when a user opens one lead. Agents and managers only — an owner
 * reading their own database is not a finding.
 */
export async function noteLeadViewed(actor: AuditActor, leadId: string): Promise<void> {
  if (actor.role !== 'agent' && actor.role !== 'manager') return;
  const userId = actor.userId;
  if (!userId) return;

  const { window, alarm } = recordView(windows.get(userId), leadId, Date.now());
  windows.set(userId, window);
  if (!alarm) return;

  logger.warn('a user opened an unusual number of leads in an hour', {
    userId,
    role: actor.role,
    distinctLeads: window.seen.size,
  });

  await writeAudit({
    actor,
    action: 'suspicious_activity',
    entityType: 'user',
    entityId: userId,
    /* The count, never the leads. An audit entry listing two hundred client
       ids would itself be a copy of the thing being protected. */
    after: { distinctLeadsInAnHour: window.seen.size, limit: BROWSE_ALARM },
  }).catch(() => undefined);
}

/** Tests and a restarting worker both want a clean slate. */
export function resetBrowsing(): void {
  windows.clear();
}
