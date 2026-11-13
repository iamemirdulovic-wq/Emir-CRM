/**
 * What the CRM does on its own.
 *
 * `design/web/automations.html`. Two different things live on that page and
 * it is worth being clear which is which:
 *
 *  - **The take-back rule**, at the top, with its own times. A lead that
 *    nobody calls goes back to Incoming. This is the one rule in the CRM that
 *    takes something away from an agent, so it gets the whole hero card, both
 *    of its clocks, and a sentence saying what it will do.
 *  - **The rest**, a list of switches in three groups. Each is a thing the
 *    CRM would otherwise do silently.
 *
 * The three *workflows* — assign and welcome, chase for four days, route a
 * reply — are a different list in `services/automations.ts` and stay there.
 * This page is the office's rules, not the message machinery.
 *
 * As with the notification settings, the groups are sent to the screen rather
 * than written there twice, so a rule on screen is always one the server
 * actually honours.
 */
import { z } from 'zod';
import { saveSetting, setting, type SettingName } from '../config/secrets.js';
import type { AuditActor } from '../audit/audit.js';
import { getPool, type Executor } from '../db/client.js';

interface Rule {
  key: string;
  name: SettingName;
  title: string;
  note: string;
  /** Off unless an owner turns it on. Everything else starts on. */
  startsOff?: boolean;
}

export const RULE_GROUPS: Array<{ key: string; title: string; rules: Rule[] }> = [
  {
    key: 'leads',
    title: 'Leads',
    rules: [
      {
        key: 'warnBeforeBack',
        name: 'AUTO_WARN_BEFORE_BACK',
        title: 'Warn the agent before a lead goes back',
        note: '10 minutes before a VIP lead, an hour before an imported one',
      },
      {
        key: 'markGoingCold',
        name: 'AUTO_MARK_GOING_COLD',
        title: 'Mark leads as “going cold”',
        note: 'No call, no message and no plan for 7 days',
      },
      {
        key: 'askWhatHappened',
        name: 'AUTO_ASK_WHAT_HAPPENED',
        title: 'Ask “What happened?” after WhatsApp or Telegram',
        note: 'The agent answers. Open ones show on My Day.',
      },
    ],
  },
  {
    key: 'followups',
    title: 'Follow-ups and meetings',
    rules: [
      {
        key: 'followupDue',
        name: 'AUTO_FOLLOWUP_REMINDER',
        title: 'Remind the agent when a follow-up is due',
        note: 'At the planned time, and again after an hour',
      },
      {
        key: 'meetingSoon',
        name: 'AUTO_MEETING_REMINDER',
        title: 'Remind 2 hours before a meeting',
        note: 'The agent only. The client message is ready; the agent presses send.',
      },
      {
        key: 'howDidItGo',
        name: 'AUTO_ASK_HOW_IT_WENT',
        title: 'Ask “How did it go?” after each meeting',
        note: 'Answered before 21:00. Owners see who did not answer.',
      },
      {
        key: 'flagNoShows',
        name: 'AUTO_FLAG_NO_SHOWS',
        title: 'Red flag after 2 no-shows',
        note: 'A cancelled meeting is not a no-show',
      },
    ],
  },
  {
    key: 'attendance',
    title: 'Attendance',
    rules: [
      {
        key: 'checkInReminder',
        name: 'AUTO_CHECKIN_REMINDER',
        title: 'Remind people to check in',
        note: 'At the start of the shift, on working days, only if they have not',
      },
      {
        key: 'markLate',
        name: 'AUTO_MARK_LATE',
        title: 'Mark somebody late',
        note: 'After the grace minutes. The agent can write a reason.',
      },
      {
        key: 'tellOwnersAbsent',
        name: 'AUTO_TELL_OWNERS_ABSENT',
        title: 'Tell owners about an absent agent',
        note: 'An hour into the shift, with no check-in and no leave',
      },
    ],
  },
];

const ALL_RULES = RULE_GROUPS.flatMap((group) => group.rules);

/* ── the take-back rule ────────────────────────────────────────────────── */

/** The choices the design offers, and the only ones accepted. */
export const VIP_MINUTES = [15, 30, 60, 120] as const;
export const IMPORT_HOURS = [4, 24, 48, 72] as const;

export interface TakeBack {
  enabled: boolean;
  /** How long an agent has on a VIP lead before it goes back. */
  vipMinutes: number;
  /** The same for an imported lead, counted in working hours. */
  importHours: number;
}

export const TAKE_BACK_DEFAULTS: TakeBack = {
  enabled: true,
  vipMinutes: 30,
  importHours: 24,
};

export interface OfficeRules {
  takeBack: TakeBack;
  rules: Record<string, boolean>;
  groups: Array<{
    key: string;
    title: string;
    rules: Array<{ key: string; title: string; note: string }>;
  }>;
  vipChoices: readonly number[];
  importChoices: readonly number[];
}

/** Unset means never chosen, which is the default — not false. */
function flag(raw: string | null, fallback: boolean): boolean {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return fallback;
}

function oneOf(raw: string | null, allowed: readonly number[], fallback: number): number {
  const n = Number(raw);
  return allowed.includes(n) ? n : fallback;
}

export async function officeRules(exec: Executor = getPool()): Promise<OfficeRules> {
  const [enabled, vip, imported, ...values] = await Promise.all([
    setting('TAKEBACK_ENABLED', exec),
    setting('TAKEBACK_VIP_MINUTES', exec),
    setting('TAKEBACK_IMPORT_HOURS', exec),
    ...ALL_RULES.map((rule) => setting(rule.name, exec)),
  ]);

  return {
    takeBack: {
      enabled: flag(enabled, TAKE_BACK_DEFAULTS.enabled),
      vipMinutes: oneOf(vip, VIP_MINUTES, TAKE_BACK_DEFAULTS.vipMinutes),
      importHours: oneOf(imported, IMPORT_HOURS, TAKE_BACK_DEFAULTS.importHours),
    },
    rules: Object.fromEntries(
      ALL_RULES.map((rule, i) => [rule.key, flag(values[i] ?? null, !rule.startsOff)]),
    ),
    groups: RULE_GROUPS.map((group) => ({
      key: group.key,
      title: group.title,
      rules: group.rules.map((rule) => ({ key: rule.key, title: rule.title, note: rule.note })),
    })),
    vipChoices: VIP_MINUTES,
    importChoices: IMPORT_HOURS,
  };
}

/** Is one rule on? Read at the point of use, not only on screen. */
export async function ruleOn(key: string, exec: Executor = getPool()): Promise<boolean> {
  const rule = ALL_RULES.find((one) => one.key === key);
  if (!rule) return false;
  return flag(await setting(rule.name, exec), !rule.startsOff);
}

export const saveSchema = z.object({
  takeBack: z.object({
    enabled: z.boolean().optional(),
    vipMinutes: z.number().int().optional(),
    importHours: z.number().int().optional(),
  }).optional(),
  rules: z.record(z.string(), z.boolean()).optional(),
});

export async function saveOfficeRules(
  actor: AuditActor,
  input: z.infer<typeof saveSchema>,
  exec: Executor = getPool(),
): Promise<OfficeRules> {
  const writes: Array<Promise<unknown>> = [];

  if (input.takeBack?.enabled !== undefined) {
    writes.push(saveSetting(actor, 'TAKEBACK_ENABLED', input.takeBack.enabled ? '1' : '0', exec));
  }
  if (input.takeBack?.vipMinutes !== undefined) {
    /* Only a value the screen offers. A take-back clock of four minutes, or
       of a week, is not a thing anybody meant to set. */
    const n = VIP_MINUTES.includes(input.takeBack.vipMinutes as typeof VIP_MINUTES[number])
      ? input.takeBack.vipMinutes
      : TAKE_BACK_DEFAULTS.vipMinutes;
    writes.push(saveSetting(actor, 'TAKEBACK_VIP_MINUTES', String(n), exec));
  }
  if (input.takeBack?.importHours !== undefined) {
    const n = IMPORT_HOURS.includes(input.takeBack.importHours as typeof IMPORT_HOURS[number])
      ? input.takeBack.importHours
      : TAKE_BACK_DEFAULTS.importHours;
    writes.push(saveSetting(actor, 'TAKEBACK_IMPORT_HOURS', String(n), exec));
  }

  for (const [key, on] of Object.entries(input.rules ?? {})) {
    const rule = ALL_RULES.find((one) => one.key === key);
    /* An unknown key is a typo or an older client, never a new rule. */
    if (!rule) continue;
    writes.push(saveSetting(actor, rule.name, on ? '1' : '0', exec));
  }

  await Promise.all(writes);
  return officeRules(exec);
}
