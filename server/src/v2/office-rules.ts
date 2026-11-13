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
import { getPool, queryOne, type Executor } from '../db/client.js';
import { attendanceSettings } from '../attendance/settings.js';

interface Rule {
  key: string;
  name: SettingName;
  title: string;
  note: string;
  /** Off unless an owner turns it on. Everything else starts on. */
  startsOff?: boolean;
  /**
   * A count the note ends with, read from the database.
   *
   * `design/web/automations.html` writes "No call, no message and no plan for
   * 7 days · 12 leads now" — the switch plus how many rows it would touch
   * right now. That number is what makes it a decision instead of a guess,
   * and it cannot be written into the file.
   */
  countSql?: string;
  countNote?: (n: number) => string;
  /**
   * The title with the office's own times in it.
   *
   * The design writes "Check-in reminder at 09:00", "Mark late after 09:10"
   * and "Tell owners about an absent agent at 10:00". Those three times are
   * the saved shift, so they are filled in here rather than hard-coded —
   * hard-coding them would make the page say 09:00 to an office that opens
   * at 10:00, which is what it actually does.
   */
  titleWithTimes?: (shift: { start: string; graceMinutes: number }) => string;
}

/** "09:00" plus n minutes, as "09:10". */
function plus(hhmm: string, minutes: number): string {
  const [h = '0', m = '0'] = hhmm.split(':');
  const total = (Number(h) * 60 + Number(m) + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
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
        note: '10 min before for a VIP lead, 1 hour before for an imported lead',
      },
      {
        key: 'markGoingCold',
        name: 'AUTO_MARK_GOING_COLD',
        title: 'Mark leads as “going cold”',
        note: 'No call, no message and no plan for 7 days',
        /* The design puts a live count after the note — "· 12 leads now" —
           which is what makes the switch a decision rather than a guess. The
           number comes from the database, appended by `officeRules`. */
/* The same condition as the "Going cold" tab in `leads/tabs.ts`, word for
           word, so the switch and the list it fills mean the same thing. */
        countSql: `SELECT COUNT(*) AS n FROM opportunities o
                    WHERE o.status = 'open' AND o.deleted_at IS NULL
                      AND o.next_step_at IS NULL
                      AND COALESCE(o.last_contact_at, o.created_at)
                          < DATE_SUB(NOW(3), INTERVAL 7 DAY)`,
        countNote: (n: number) => `${n} lead${n === 1 ? '' : 's'} now`,
      },
      {
        key: 'askWhatHappened',
        name: 'AUTO_ASK_WHAT_HAPPENED',
        title: 'Ask “What happened?” after WhatsApp or Telegram',
        note: 'The agent must answer. Open ones show on My Day and in the messaging report.',
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
        note: 'At the planned time, and again after 1 hour',
      },
      {
        key: 'meetingSoon',
        name: 'AUTO_MEETING_REMINDER',
        title: 'Remind 2 hours before a meeting',
        note: 'Agent only. The client message is ready, the agent presses send.',
      },
      {
        key: 'howDidItGo',
        name: 'AUTO_ASK_HOW_IT_WENT',
        title: 'Ask “How did it go?” after each meeting',
        note: 'Answer before 21:00. Owners see who did not answer.',
      },
      {
        key: 'flagNoShows',
        name: 'AUTO_FLAG_NO_SHOWS',
        title: 'Red flag after 2 no-shows',
        note: 'Cancelled is not a no-show',
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
        title: 'Check-in reminder',
        titleWithTimes: (shift) => `Check-in reminder at ${shift.start}`,
        note: 'Only on working days, only if not checked in',
      },
      {
        key: 'markLate',
        name: 'AUTO_MARK_LATE',
        title: 'Mark late',
        titleWithTimes: (shift) => `Mark late after ${plus(shift.start, shift.graceMinutes)}`,
        note: 'The agent can write a reason',
      },
      {
        key: 'tellOwnersAbsent',
        name: 'AUTO_TELL_OWNERS_ABSENT',
        title: 'Tell owners about an absent agent',
        titleWithTimes: (shift) => `Tell owners about an absent agent at ${plus(shift.start, 60)}`,
        note: 'No check-in and no leave',
      },
      /*
       * The fourth.
       *
       * `sage.md` §1 item 40 says ATTENDANCE (4) and the design draws four
       * switches here. The build had three, because this one had been moved
       * to Attendance rules — where it also belongs, since that page is about
       * working outside. It is the same stored setting read from both places,
       * not a second switch: whichever page you move it on, the other shows
       * the new state.
       */
      {
        key: 'askBackInOffice',
        name: 'ATT_OUTSIDE_ASK_BACK',
        title: 'Ask “Are you back in the office?”',
        note: 'Asked once at the back-by time',
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
  shift: { start: string; end: string; graceMinutes: number };
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

  /* The office's own hours, for the three Attendance switches that name a
     time, and the counts the design puts at the end of a note. */
  const shift = await attendanceSettings(exec);
  const counts = new Map<string, number>();
  await Promise.all(ALL_RULES.filter((rule) => rule.countSql).map(async (rule) => {
    /* A count that fails is a count left off the note, never a page that
       will not load. */
    const row = await queryOne<{ n: number }>(rule.countSql as string, [], exec)
      .catch(() => null);
    if (row) counts.set(rule.key, Number(row.n ?? 0));
  }));

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
      rules: group.rules.map((rule) => {
        const n = counts.get(rule.key);
        const extra = n !== undefined && rule.countNote ? ` · ${rule.countNote(n)}` : '';
        return {
          key: rule.key,
          title: rule.titleWithTimes ? rule.titleWithTimes(shift) : rule.title,
          note: `${rule.note}${extra}`,
        };
      }),
    })),
    vipChoices: VIP_MINUTES,
    importChoices: IMPORT_HOURS,
    /* The shift the clock strip and the warning notes are drawn from. */
    shift: { start: shift.start, end: shift.end, graceMinutes: shift.graceMinutes },
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
