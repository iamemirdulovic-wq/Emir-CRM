/**
 * How leads are routed, and how long an agent has before one is taken back.
 *
 * Stored in `app_settings` rather than a table of its own: there is one row of
 * this, it is read on every assignment, and `saveSetting` already caches it,
 * audits it and clears the cache on write. Only the owner may change it.
 */
import { saveSetting, setting } from '../config/secrets.js';
import type { AuditActor } from '../audit/audit.js';
import type { Executor } from '../db/client.js';
import { getPool } from '../db/client.js';
import { SLA_FIRST_TOUCH_MS } from '../config/constants.js';

export interface RoutingSettings {
  /**
   * Minutes an agent has to accept a lead, and then again to do something
   * about it. Five is the number the business runs on; it is a setting so it
   * can be tightened to three on a launch day without a code change.
   */
  slaMinutes: number;
  /** Minutes before the deadline to nudge the agent. 0 turns the nudge off. */
  reminderMinutes: number;
  /**
   * Assign a new lead the moment it arrives.
   *
   * On by default, and it is the whole reason a client gets a reply inside
   * thirty seconds at three in the morning. Turning it off means every lead
   * waits in Incoming for a person to hand it out — which is sometimes what an
   * owner wants, and is a decision rather than an accident.
   */
  autoAssign: boolean;
  /**
   * Where a lead goes when the clock runs out: back to Incoming for the owner
   * to look at (on), or straight to the next available agent (off).
   */
  bounceToOwner: boolean;
}

export const ROUTING_DEFAULTS: RoutingSettings = {
  // The same five minutes the speed-to-lead target has always meant, read from
  // the constant so the two cannot drift apart.
  slaMinutes: SLA_FIRST_TOUCH_MS / 60_000,
  reminderMinutes: 3,
  autoAssign: true,
  bounceToOwner: true,
};

/** Bounds, so a typo cannot switch the timer off or make it meaningless. */
const MIN_SLA = 1;
const MAX_SLA = 120;

/**
 * Read a stored value into the shape above.
 *
 * Exported and pure so the awkward cases — an empty string, a word where a
 * number should be, a reminder longer than the deadline it is reminding about
 * — are settled in a test rather than on a live lead.
 */
export function parseRoutingSettings(raw: Partial<Record<keyof RoutingSettings, string | null>>): RoutingSettings {
  const slaMinutes = clamp(number(raw.slaMinutes, ROUTING_DEFAULTS.slaMinutes), MIN_SLA, MAX_SLA);
  /*
   * A reminder at or after the deadline would arrive with, or after, the
   * bounce — so it is capped one minute short of it rather than rejected.
   */
  const reminderMinutes = clamp(number(raw.reminderMinutes, ROUTING_DEFAULTS.reminderMinutes), 0, slaMinutes - 1);
  return {
    slaMinutes,
    reminderMinutes,
    autoAssign: bool(raw.autoAssign, ROUTING_DEFAULTS.autoAssign),
    bounceToOwner: bool(raw.bounceToOwner, ROUTING_DEFAULTS.bounceToOwner),
  };
}

function number(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
}

function bool(value: string | null | undefined, fallback: boolean): boolean {
  if (value === null || value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export async function routingSettings(exec: Executor = getPool()): Promise<RoutingSettings> {
  const [slaMinutes, reminderMinutes, autoAssign, bounceToOwner] = await Promise.all([
    setting('ROUTING_SLA_MINUTES', exec),
    setting('ROUTING_REMINDER_MINUTES', exec),
    setting('ROUTING_AUTO_ASSIGN', exec),
    setting('ROUTING_BOUNCE_TO_OWNER', exec),
  ]);
  return parseRoutingSettings({ slaMinutes, reminderMinutes, autoAssign, bounceToOwner });
}

/** Save a change, and hand back what the settings now are. */
export async function saveRoutingSettings(
  actor: AuditActor,
  patch: Partial<RoutingSettings>,
  exec: Executor = getPool(),
): Promise<RoutingSettings> {
  const current = await routingSettings(exec);
  /*
   * The patch is merged onto what is stored and then put through the same
   * parser the reader uses, so a value can never be written that reading it
   * back would silently change — and a reminder is re-capped when the deadline
   * it belongs to moves.
   */
  const next = parseRoutingSettings({
    slaMinutes: String(patch.slaMinutes ?? current.slaMinutes),
    reminderMinutes: String(patch.reminderMinutes ?? current.reminderMinutes),
    autoAssign: String(patch.autoAssign ?? current.autoAssign),
    bounceToOwner: String(patch.bounceToOwner ?? current.bounceToOwner),
  });

  // Only what actually moved, so the audit log reads as a list of decisions
  // rather than four rows every time someone opens the screen.
  if (next.slaMinutes !== current.slaMinutes) {
    await saveSetting(actor, 'ROUTING_SLA_MINUTES', String(next.slaMinutes), exec);
  }
  if (next.reminderMinutes !== current.reminderMinutes) {
    await saveSetting(actor, 'ROUTING_REMINDER_MINUTES', String(next.reminderMinutes), exec);
  }
  if (next.autoAssign !== current.autoAssign) {
    await saveSetting(actor, 'ROUTING_AUTO_ASSIGN', next.autoAssign ? '1' : '0', exec);
  }
  if (next.bounceToOwner !== current.bounceToOwner) {
    await saveSetting(actor, 'ROUTING_BOUNCE_TO_OWNER', next.bounceToOwner ? '1' : '0', exec);
  }
  return next;
}
