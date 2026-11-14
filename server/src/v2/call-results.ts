/**
 * The no-answer rule: one tap, a counted try, and the next try worked out.
 *
 * Emir, 14 Nov 2026, section A: *"One tap on 'No answer' saves a call try with
 * date and time and counts it: 'No answer · try 2 of 5'. No typing."* Then:
 * *"It makes the next follow-up by itself: try 2 after 2 hours, try 3 next
 * morning, try 4 next evening, try 5 two days later. Only when the client is
 * awake and inside our work hours."*
 *
 * ── What this file does NOT add ───────────────────────────────────────────
 *
 * No table and no column. Everything the rule needs was already in the
 * database, and the one thing the brief is emphatic about is not building a
 * second record of "did we reach them":
 *
 *  - **The count** is `opportunities.no_answer_count`, which has existed since
 *    migration 0017 and is already incremented by `runLeadAction` for a
 *    no-answer — and for a busy, because `v2/calls.ts` already maps busy onto
 *    the same action. That is exactly the contract's rule that `tries` counts
 *    the two together. What was missing is the other half: nothing ever put it
 *    back to zero, so a lead rung three times in March still read "3" after
 *    the client answered in April. `leads/actions.ts` clears it now.
 *  - **The next try** is `opportunities.next_step_at`. It is the one promise a
 *    lead carries, it is what the Today and Overdue tabs are built from, and
 *    an agent moving it with one tap (A.2) is the next-step editor that
 *    already exists. A second "next try" column would be a second answer to
 *    the same question, and the two would disagree within a week.
 *  - **The last try** is the newest `activities` row of type `no_answer`.
 *    Every path that logs a call result goes through `runLeadAction`, which
 *    writes that row — the dialler, the lead page's buttons, and this file.
 *    `call_logs` would have been the obvious place and is the wrong one: it is
 *    written by the dialler only, so a result logged from the lead page has no
 *    row in it, and counting tries there would under-report every agent who
 *    works from the lead page.
 *  - **The undo** (§1b) reads its before-state out of `audit_log`, which is
 *    already a before/after journal of every change by design.
 *
 * ── What it never does ───────────────────────────────────────────────────
 *
 * It does not send anything. `whatsapp.text` is handed back for the agent to
 * send from his own phone, and the CRM never claims to have sent a message it
 * did not send (`v2/calls.ts`, `message_taps`). Nothing happens after try 5
 * on its own: the lead is left with no promise, visible in the No answer tab
 * and in No next step, for a person to decide about (A.5).
 */
import { execute, getPool, query, queryOne, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { runLeadAction, type LeadAction, type NextStepType } from '../leads/actions.js';
import { ownerPredicate, visibleUserIds } from '../auth/scope.js';
import { isAdminOrAbove } from '../auth/rbac.js';
import type { SessionUser } from '../auth/sessions.js';
import { countryOf, isNight, languageName } from '../leads/countries.js';
import { WORK_END_MINUTE, WORK_START_MINUTE } from '../leads/next-step.js';
import { DUBAI_OFFSET_MINUTES, dubaiMinuteOfDay } from '../routing/hours.js';
import { saveSetting, setting } from '../config/secrets.js';
import { companyDetails, displayName } from '../config/company.js';
import { DAY_END, DAY_START } from './dubai.js';

/* ── what an agent can say happened ───────────────────────────────────── */

export const CALL_RESULTS = [
  'answered', 'no_answer', 'busy', 'call_back', 'wrong_number', 'not_interested',
] as const;

/**
 * The six the contract names, plus the one the dialler has had since it was
 * built: `interested`.
 *
 * They are two lists on purpose. `CALL_RESULTS` is what
 * `POST /leads/:id/call-result` accepts, and it is the contract's six exactly.
 * `interested` is stronger than `answered` — it says the client picked up AND
 * wants to go on, and it moves the lead to Engaged — so it is not something a
 * screen should be able to send where the contract says `answered`. But it
 * has to be a result this engine understands, because `v2/calls.ts` hands it
 * here and there must be one place that decides what a call result does.
 */
export const DIALLER_RESULTS = [...CALL_RESULTS, 'interested'] as const;
export type CallResult = (typeof DIALLER_RESULTS)[number];

/**
 * What each one is called on screen and in the timeline.
 *
 * Never the raw value. "no_answer" is a column value, not something a person
 * reads, and the moment one leaks into a toast it leaks into a report.
 */
export const RESULT_LABELS: Record<CallResult, string> = {
  answered: 'Answered',
  interested: 'Interested',
  no_answer: 'No answer',
  busy: 'Busy',
  call_back: 'Call back',
  wrong_number: 'Wrong number',
  not_interested: 'Not interested',
};

/** The two that are "did not speak to them", and so count as a try. */
const COUNTS_AS_TRY = new Set<CallResult>(['no_answer', 'busy']);

/**
 * The lead action each result runs.
 *
 * One path, not two: the same `runLeadAction` the lead page's own buttons
 * call, so a result saved here moves the stage, writes the activity and the
 * audit entry exactly as the same result logged anywhere else does.
 *
 * `answered` is deliberately `call` and not `interested`. The agent said the
 * client picked up; he did not say the client wants the flat, and moving a
 * lead to Engaged on a tap that does not mean that is how a pipeline stops
 * meaning anything.
 */
const ACTION: Record<CallResult, LeadAction> = {
  answered: 'call',
  /* The dialler's own, and the one result that moves the lead forward. */
  interested: 'interested',
  no_answer: 'no_answer',
  busy: 'no_answer',
  call_back: 'call_back',
  wrong_number: 'problem',
  not_interested: 'lost',
};

/**
 * What goes in `call_logs.outcome`, which is an ENUM written in migration 0036.
 *
 * It has no `answered` value of its own, and it cannot be given one: widening
 * an ENUM is `ALTER TABLE ... MODIFY`, which `migrations.safety.test.ts`
 * refuses and is right to, because it rewrites every row of a live table.
 *
 * `interested` is the nearest value it holds, and the one place that reads the
 * column already reads it as "the call connected" — `v2/home.ts` counts
 * `outcome IN ('interested','call_back')` as the day's answered calls. So the
 * figure it feeds is correct. Nothing about the lead is changed by it: the
 * stage, the timeline and the toast all come from `ACTION` above, which says
 * `call`.
 */
const OUTCOME: Record<CallResult, 'interested' | 'no_answer' | 'busy' | 'call_back' | 'wrong_number' | 'not_interested'> = {
  answered: 'interested',
  interested: 'interested',
  no_answer: 'no_answer',
  busy: 'busy',
  call_back: 'call_back',
  wrong_number: 'wrong_number',
  not_interested: 'not_interested',
};

/** The reason written on the lead for the two results that need one. */
const REASON: Partial<Record<CallResult, string>> = {
  wrong_number: 'wrong_number',
  not_interested: 'not_interested',
};

/* ── the settings the owner can change (contract §5) ──────────────────── */

/**
 * A rung of the ladder.
 *
 * The four the contract names, plus the shorter and longer waits an owner
 * might reasonably pick instead. A value that is not one of these is ignored
 * rather than guessed at, so a hand-edited setting cannot invent a schedule.
 */
export const TRY_STEPS = [
  '30m', '1h', '2h', '4h', '6h', 'next_morning', 'next_evening', '1d', '2d', '3d', '7d',
] as const;
export type TryStep = (typeof TRY_STEPS)[number];

/** How each rung reads on the Automations screen. No raw values. */
export const STEP_LABELS: Record<TryStep, string> = {
  '30m': 'In 30 minutes',
  '1h': 'In 1 hour',
  '2h': 'In 2 hours',
  '4h': 'In 4 hours',
  '6h': 'In 6 hours',
  next_morning: 'Next morning',
  next_evening: 'Next evening',
  '1d': 'Tomorrow',
  '2d': 'In 2 days',
  '3d': 'In 3 days',
  '7d': 'In a week',
};

export interface CallTries {
  /** How many tries before the CRM stops and asks (A.5). */
  max: number;
  /** The wait after try 1, try 2, and so on. */
  steps: TryStep[];
  /** A busy line is a shorter wait and never a rung of the ladder (A.4). */
  busyMinutes: number;
}

export const CALL_TRIES_DEFAULTS: CallTries = {
  max: 5,
  steps: ['2h', 'next_morning', 'next_evening', '2d'],
  busyMinutes: 30,
};

/** The limits, so a typed-in number cannot produce a schedule nobody meant. */
const MAX_TRIES_LIMIT = 10;
const BUSY_MINUTES_LIMIT = 24 * 60;

/**
 * "Next morning" and "next evening", as minutes past midnight in Dubai.
 *
 * 11:00 is the owner's own example — A.3 writes the line as *"next try
 * tomorrow 11:00"* — and it sits an hour inside the office's day rather than
 * on the doorstep of it. The evening is 17:00: late enough to catch somebody
 * after work, early enough to be inside our hours either way.
 */
export const MORNING_MINUTE = 11 * 60;
export const EVENING_MINUTE = 17 * 60;

export async function callTriesSettings(exec: Executor = getPool()): Promise<CallTries> {
  const [max, steps, busy] = await Promise.all([
    setting('CALL_TRIES_MAX', exec),
    setting('CALL_TRIES_STEPS', exec),
    setting('CALL_TRIES_BUSY_MINUTES', exec),
  ]);
  return {
    max: wholeNumber(max, CALL_TRIES_DEFAULTS.max, 1, MAX_TRIES_LIMIT),
    steps: readSteps(steps),
    busyMinutes: wholeNumber(busy, CALL_TRIES_DEFAULTS.busyMinutes, 5, BUSY_MINUTES_LIMIT),
  };
}

function wholeNumber(raw: string | null, fallback: number, least: number, most: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < least || n > most) return fallback;
  return n;
}

/** Stored as one comma-separated row, because `app_settings.value` is one string. */
function readSteps(raw: string | null): TryStep[] {
  const parts = (raw ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const kept = parts.filter((part): part is TryStep => (TRY_STEPS as readonly string[]).includes(part));
  /* A stored value we cannot read is not a reason to invent a schedule: fall
     back to the defaults whole rather than to the half we understood. */
  return kept.length === parts.length && kept.length > 0 ? kept : [...CALL_TRIES_DEFAULTS.steps];
}

export async function saveCallTries(
  actor: AuditActor,
  input: { max?: number; steps?: string[]; busyMinutes?: number },
  exec: Executor = getPool(),
): Promise<CallTries> {
  const writes: Array<Promise<unknown>> = [];

  if (input.max !== undefined) {
    writes.push(saveSetting(
      actor, 'CALL_TRIES_MAX',
      String(wholeNumber(String(input.max), CALL_TRIES_DEFAULTS.max, 1, MAX_TRIES_LIMIT)), exec,
    ));
  }
  if (input.busyMinutes !== undefined) {
    writes.push(saveSetting(
      actor, 'CALL_TRIES_BUSY_MINUTES',
      String(wholeNumber(String(input.busyMinutes), CALL_TRIES_DEFAULTS.busyMinutes, 5, BUSY_MINUTES_LIMIT)),
      exec,
    ));
  }
  if (input.steps !== undefined) {
    const kept = input.steps.filter((step): step is TryStep => (TRY_STEPS as readonly string[]).includes(step));
    /* An unknown rung is dropped; an empty list would mean "never follow up",
       which no screen offers and nobody meant to ask for. */
    if (kept.length > 0) writes.push(saveSetting(actor, 'CALL_TRIES_STEPS', kept.join(','), exec));
  }

  await Promise.all(writes);
  return callTriesSettings(exec);
}

/* ── when the next try is (contract §2) ───────────────────────────────── */

/**
 * `days` from now, at `minute` past midnight Dubai, as a real instant.
 *
 * Mirrors the private helper of the same name in `leads/next-step.ts`, which
 * is where the work-hours rule itself lives and is imported from. It is
 * copied rather than exported because that file belongs to the next-step
 * screen and a second agent is in it today; the thing that must not be
 * written twice is the *rule*, and the rule — `WORK_START_MINUTE`,
 * `WORK_END_MINUTE`, `isNight` — is imported.
 *
 * Dubai is UTC+4 all year, so this is a fixed offset and not a timezone
 * library. See CLAUDE.md.
 */
function atDubaiMinute(from: Date, days: number, minute: number): Date {
  const shifted = new Date(from.getTime() + DUBAI_OFFSET_MINUTES * 60_000);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + minute * 60_000 - DUBAI_OFFSET_MINUTES * 60_000);
}

/** The next moment it is `minute` past midnight in Dubai: today if it is still to come. */
function nextDubaiMinute(from: Date, minute: number): Date {
  return atDubaiMinute(from, dubaiMinuteOfDay(from) < minute ? 0 : 1, minute);
}

const HOURS: Partial<Record<TryStep, number>> = { '1h': 1, '2h': 2, '4h': 4, '6h': 6 };
const DAYS: Partial<Record<TryStep, number>> = { '1d': 1, '2d': 2, '3d': 3, '7d': 7 };

/** Where a rung lands before the hours are applied. */
export function stepInstant(step: TryStep, from: Date): Date {
  if (step === '30m') return new Date(from.getTime() + 30 * 60_000);
  const hours = HOURS[step];
  if (hours !== undefined) return new Date(from.getTime() + hours * 60 * 60_000);
  if (step === 'next_morning') return nextDubaiMinute(from, MORNING_MINUTE);
  if (step === 'next_evening') return nextDubaiMinute(from, EVENING_MINUTE);
  const days = DAYS[step] ?? 1;
  /* A wait measured in days lands at the start of the office's day, not at
     whatever minute the agent happened to tap the button two days earlier. */
  return atDubaiMinute(from, days, MORNING_MINUTE);
}

/** How far forward the search for a decent hour will go before giving up. */
const FIT_GUARD = 500;
const FIT_HOP_MINUTES = 15;

/**
 * Move a moment forward until it is a decent hour in both clocks (A.2).
 *
 * Two windows, and it has to be inside both: the client's own waking hours —
 * `CALL_FROM`–`CALL_UNTIL` in `leads/countries.ts`, the same rule the moon on
 * a lead card and the word "asleep" in the search box are drawn from — and
 * our own working hours, `WORK_START_MINUTE`–`WORK_END_MINUTE` from
 * `leads/next-step.ts`. Neither is re-written here.
 *
 * Null when there is no such moment within a week. That is possible: a client
 * whose waking hours are the exact mirror of our office day has no overlap at
 * all, and the honest answer is to promise nothing and leave the lead for a
 * person, rather than to schedule a call that breaks the rule we just wrote.
 */
export function fitToHours(at: Date, timeZone: string | null): Date | null {
  let when = at;
  for (let guard = 0; guard < FIT_GUARD; guard += 1) {
    const minute = dubaiMinuteOfDay(when);
    /* Before we open: wait for the office. After we close: tomorrow morning. */
    if (minute < WORK_START_MINUTE) {
      when = atDubaiMinute(when, 0, WORK_START_MINUTE);
      continue;
    }
    if (minute >= WORK_END_MINUTE) {
      when = atDubaiMinute(when, 1, WORK_START_MINUTE);
      continue;
    }
    /* Inside our hours. Is the client awake? `null` means we cannot read
       their dialling code, and an unknown zone is not a reason to refuse a
       follow-up — the hour is ours either way. */
    if (isNight(timeZone, when) !== true) return when;
    when = new Date(when.getTime() + FIT_HOP_MINUTES * 60_000);
  }
  return null;
}

/**
 * The whole rule in one place: which rung, and what it comes to.
 *
 * `tries` is the number of tries *including* the one just saved. Past the end
 * of the ladder — try 5 of 5 — there is no next try, and nothing happens on
 * its own (A.5).
 *
 * A busy line never takes a rung: its wait is always `busyMinutes`, whichever
 * try it was. Five busy signals in an afternoon is still five tries, which is
 * what the counter says, but it does not burn the 2-hour / next-morning /
 * next-evening ladder that the owner set for a phone nobody answers.
 */
export function nextTryFor(
  result: CallResult,
  tries: number,
  settings: CallTries,
  timeZone: string | null,
  now: Date = new Date(),
): { at: Date | null; step: TryStep | null } {
  if (!COUNTS_AS_TRY.has(result)) return { at: null, step: null };
  if (tries >= settings.max) return { at: null, step: null };

  if (result === 'busy') {
    const at = fitToHours(new Date(now.getTime() + settings.busyMinutes * 60_000), timeZone);
    return { at, step: null };
  }

  /* Try 1 takes the first rung. A ladder shorter than `max` repeats its last
     rung rather than stopping early, so shortening the list in Automations
     cannot silently drop the last follow-ups. */
  const step = settings.steps[Math.min(tries, settings.steps.length) - 1] ?? CALL_TRIES_DEFAULTS.steps[0] as TryStep;
  return { at: fitToHours(stepInstant(step, now), timeZone), step };
}

/* ── the state block the screens read (contract §1) ───────────────────── */

export interface NoAnswerState {
  tries: number;
  maxTries: number;
  lastTryAt: string | null;
  nextTryAt: string | null;
  exhausted: boolean;
  whatsapp: { lang: string; langName: string; text: string } | null;
  /** The toast's own line, already in Dubai 24-hour time. */
  line: string | null;
  /** Until when §1b will take the last result back. Null when there is none. */
  undoUntil: string | null;
}

/** How long a result can be taken back (contract §1b). */
export const UNDO_WINDOW_MINUTES = 10;

/** "11:00", Dubai, 24-hour — the only clock this CRM writes. */
export function dubaiClock(at: Date): string {
  const minute = dubaiMinuteOfDay(at);
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** "today 14:20" / "tomorrow 11:00" / "Mon 17 Nov 11:00", in Dubai. */
export function dubaiWhen(at: Date, now: Date = new Date()): string {
  const day = (one: Date) => Math.floor((one.getTime() + DUBAI_OFFSET_MINUTES * 60_000) / 86_400_000);
  const days = day(at) - day(now);
  if (days <= 0) return `today ${dubaiClock(at)}`;
  if (days === 1) return `tomorrow ${dubaiClock(at)}`;
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short',
  }).format(at);
  return `${date} ${dubaiClock(at)}`;
}

/* ── the "I tried to call you" message (A.3) ──────────────────────────── */

/**
 * The text the agent sends himself.
 *
 * Not a Meta template: there is no WhatsApp API in this version — each agent
 * messages from his own number and the CRM only opens the app with the words
 * ready (see `message_taps` in migration 0036). So this is plain text in the
 * agent's own voice, in the client's language, and the server hands it back
 * rather than sending it.
 *
 * Four languages, because those are the four the offer builder already writes
 * in. Anything else gets the English one — a language we do not have words
 * for is not a reason to send nothing, and it is certainly not a reason to
 * guess at a translation.
 */
type Words = (parts: { name: string | null; agent: string; company: string; project: string | null }) => string;

const MISSED_CALL: Record<string, Words> = {
  en: ({ name, agent, company, project }) => [
    name ? `Hello ${name}, this is ${agent} from ${company}.` : `Hello, this is ${agent} from ${company}.`,
    project
      ? `I just tried to call you about ${project}.`
      : 'I just tried to call you about your enquiry.',
    'When is a good time to reach you?',
  ].join(' '),

  ar: ({ name, agent, company, project }) => [
    name ? `مرحباً ${name}، أنا ${agent} من ${company}.` : `مرحباً، أنا ${agent} من ${company}.`,
    project ? `حاولت الاتصال بك بخصوص ${project}.` : 'حاولت الاتصال بك بخصوص طلبك.',
    'ما هو الوقت المناسب للتواصل معك؟',
  ].join(' '),

  ru: ({ name, agent, company, project }) => [
    name ? `Здравствуйте, ${name}. Это ${agent} из ${company}.` : `Здравствуйте. Это ${agent} из ${company}.`,
    project ? `Я только что пытался вам позвонить по проекту ${project}.` : 'Я только что пытался вам позвонить.',
    'Когда вам удобно поговорить?',
  ].join(' '),

  hi: ({ name, agent, company, project }) => [
    name ? `नमस्ते ${name}, मैं ${agent}, ${company} से बात कर रहा हूँ।` : `नमस्ते, मैं ${agent}, ${company} से बात कर रहा हूँ।`,
    project ? `मैंने अभी आपको ${project} के बारे में कॉल किया था।` : 'मैंने अभी आपको कॉल किया था।',
    'आपसे बात करने का सही समय क्या होगा?',
  ].join(' '),
};

/** The first name only, which is how anybody actually opens a message. */
function firstName(full: string | null): string | null {
  const one = (full ?? '').trim().split(/\s+/)[0];
  return one && one.length > 1 ? one : null;
}

export async function missedCallMessage(lead: {
  fullName: string | null;
  language: string | null;
  project: string | null;
  agentName: string | null;
}): Promise<{ lang: string; langName: string; text: string }> {
  const asked = (lead.language ?? 'en').toLowerCase().slice(0, 2);
  const lang = MISSED_CALL[asked] ? asked : 'en';
  const words = MISSED_CALL[lang] ?? MISSED_CALL.en as Words;
  const company = displayName(await companyDetails());
  return {
    lang,
    /* So a screen never has to print the code itself. */
    langName: languageName(lang),
    text: words({
      name: firstName(lead.fullName),
      agent: lead.agentName?.trim() || company,
      company,
      project: lead.project?.trim() || null,
    }),
  };
}

/* ── reading and writing a result ─────────────────────────────────────── */

/** Every column on the lead that a result can change, so an undo can put it back. */
const RESTORED = [
  'stage_key', 'stage_changed_at', 'sub_status', 'status', 'closed_at',
  'lost_reason', 'lost_reason_v2', 'lost_note', 'no_answer_count', 'returned_at',
  'last_contact_at', 'first_touch_at', 'next_step_at', 'next_step_type', 'next_step_note',
] as const;
type Restored = (typeof RESTORED)[number];
type Snapshot = Record<Restored, string | number | null>;

interface LeadRow {
  id: string;
  contact_id: string;
  owner_user_id: string | null;
  owner_name: string | null;
  full_name: string | null;
  phone_e164: string | null;
  language: string | null;
  dnc: number;
  project_name: string | null;
  no_answer_count: number;
  next_step_at: Date | null;
}

/**
 * The lead, if this person may work it.
 *
 * `visibleUserIds` is the same fence as every other lead query: an agent gets
 * their own, a manager their team's, an owner everything. There is no
 * parameter that widens it, so "an agent cannot save a result on another
 * agent's lead" is enforced in SQL rather than on the screen.
 */
async function leadFor(user: SessionUser, opportunityId: string): Promise<LeadRow> {
  const visible = await visibleUserIds(user);
  const scope = ownerPredicate('o.owner_user_id', visible);
  const row = await queryOne<LeadRow>(
    `SELECT o.id, o.contact_id, o.owner_user_id, o.project_name, o.no_answer_count, o.next_step_at,
            c.full_name, c.phone_e164, c.language, c.dnc, u.name AS owner_name
       FROM opportunities o
       JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
       LEFT JOIN users u ON u.id = o.owner_user_id
      WHERE o.id = ? AND o.deleted_at IS NULL AND ${scope.sql}`,
    [opportunityId, ...scope.params],
  );
  if (!row) throw notFound('That lead is not one of yours.');
  return row;
}

/** Everything a result can change, read before it changes. */
async function snapshot(opportunityId: string, exec: Executor = getPool()): Promise<Snapshot> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${RESTORED.join(', ')} FROM opportunities WHERE id = ?`,
    [opportunityId],
    exec,
  );
  if (!row) throw notFound('That lead no longer exists.');
  const out = {} as Snapshot;
  for (const column of RESTORED) {
    const value = row[column];
    out[column] = value instanceof Date
      ? value.toISOString()
      : (value === null || value === undefined ? null : value as string | number);
  }
  return out;
}

/** The newest no-answer try on this lead that has not been taken back. */
async function lastTryAt(opportunityId: string, exec: Executor = getPool()): Promise<Date | null> {
  const row = await queryOne<{ at: Date | null }>(
    `SELECT MAX(a.created_at) AS at FROM activities a
      WHERE a.opportunity_id = ? AND a.type = 'no_answer'
        AND JSON_EXTRACT(a.meta, '$.undone') IS NULL`,
    [opportunityId],
    exec,
  );
  return row?.at ?? null;
}

/**
 * The last result on this lead that §1b would still take back.
 *
 * `audit_log` is the journal: `writeAudit` already stores a before and an
 * after for every change, which is exactly what an undo needs, so the before
 * is read back out of it rather than copied into a column of its own.
 *
 * The newest of the two actions decides. If it is the undo, the last result
 * has already been taken back and there is nothing left to take.
 */
async function lastSave(opportunityId: string): Promise<{
  id: string; actorUserId: string | null; createdAt: Date; before: Snapshot; after: { activityId?: string | null };
} | null> {
  const row = await queryOne<{
    id: string; action: string; actor_user_id: string | null; created_at: Date;
    before_json: unknown; after_json: unknown;
  }>(
    `SELECT id, action, actor_user_id, created_at, before_json, after_json
       FROM audit_log
      WHERE entity_type = 'opportunity' AND entity_id = ?
        AND action IN ('lead.call_result', 'lead.call_result_undone')
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [opportunityId],
  );
  if (!row || row.action !== 'lead.call_result') return null;
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    before: readJson<Snapshot>(row.before_json) ?? ({} as Snapshot),
    after: readJson<{ activityId?: string | null }>(row.after_json) ?? {},
  };
}

/** `mysql2` hands a JSON column back parsed or as text, depending on the driver. */
function readJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

/** The whole no-answer state of a lead, which is what both endpoints answer with. */
async function stateOf(
  lead: LeadRow,
  settings: CallTries,
  options: { whatsapp: boolean; now?: Date } = { whatsapp: false },
): Promise<NoAnswerState> {
  const now = options.now ?? new Date();
  const tries = Number(lead.no_answer_count ?? 0);
  const last = await lastTryAt(lead.id);
  const save = await lastSave(lead.id);
  const undoUntil = save
    ? new Date(save.createdAt.getTime() + UNDO_WINDOW_MINUTES * 60_000)
    : null;

  /*
   * The next TRY, which is not the same thing as the next step.
   *
   * While a run is going, the lead's one promise IS the next try, so it is
   * read straight off `next_step_at`. Once the run has ended — the client
   * answered, or asked us to call back on a day they chose — there is no next
   * try, and the contract says so: `nextTryAt` is null. Whatever the lead is
   * promised next is the next-step field's business, not this one's.
   */
  const next = tries > 0 && lead.next_step_at ? new Date(lead.next_step_at) : null;
  const exhausted = tries >= settings.max;

  return {
    tries,
    maxTries: settings.max,
    lastTryAt: last ? last.toISOString() : null,
    nextTryAt: next ? next.toISOString() : null,
    exhausted,
    whatsapp: options.whatsapp && Number(lead.dnc ?? 0) === 0
      ? await missedCallMessage({
        fullName: lead.full_name,
        language: lead.language,
        project: lead.project_name,
        agentName: lead.owner_name,
      })
      : null,
    line: tries === 0
      ? null
      : [
        `Try ${tries} of ${settings.max}`,
        next ? `next try ${dubaiWhen(next, now)}` : (exhausted ? 'no more tries' : 'no next try set'),
      ].join(' · '),
    undoUntil: undoUntil && undoUntil.getTime() > now.getTime() ? undoUntil.toISOString() : null,
  };
}

export interface SaveInput {
  result: CallResult;
  /** Required for `call_back`, and ignored for everything else. */
  callBackAt?: string | null;
  note?: string | null;
  /**
   * The agent's own reason, where a screen asked for one.
   *
   * Not part of the endpoint's body — the contract's six results each imply
   * their own reason and the agent is asked for nothing. It is here because
   * the dialler does ask: its Not-interested list offers "bought elsewhere",
   * "budget too low" and the rest, and that answer is the whole value of the
   * lost-reasons report. Without it, delegating the dialler to this engine
   * would have thrown the agent's answer away and written "not interested"
   * over every one of them.
   */
  reason?: string | null;
  /**
   * The `call_logs` row this result belongs to, when the screen started the
   * call through `POST /api/v2/calls`. Given, the outcome is written onto
   * that row; left out, a row is written here — either way there is exactly
   * one record of the call, never two.
   */
  callId?: string | null;
}

export async function saveCallResult(
  actor: AuditActor,
  user: SessionUser,
  opportunityId: string,
  input: SaveInput,
  now: Date = new Date(),
): Promise<NoAnswerState> {
  const lead = await leadFor(user, opportunityId);
  const settings = await callTriesSettings();

  let callBackAt: Date | null = null;
  if (input.result === 'call_back') {
    const parsed = input.callBackAt ? new Date(input.callBackAt) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      throw badRequest('Say when to call them back.');
    }
    callBackAt = parsed;
  }

  /* The try count, after this tap. The counter itself is kept by
     `runLeadAction`; this is the same arithmetic, needed up front to work out
     which rung of the ladder the next try is on. */
  const tries = COUNTS_AS_TRY.has(input.result) ? Number(lead.no_answer_count ?? 0) + 1 : 0;
  const zone = countryOf(lead.phone_e164)?.timeZone ?? null;
  const next = nextTryFor(input.result, tries, settings, zone, now);

  const before = await snapshot(opportunityId);

  /* One call, one row. The dialler's own row when it gave us one, otherwise
     ours -- so the day's call figures count a result logged from the lead
     page as well as one logged from the calling screen. */
  const callId = input.callId ?? newId();
  if (input.callId) {
    const existing = await queryOne<{ id: string; user_id: string; opportunity_id: string | null }>(
      'SELECT id, user_id, opportunity_id FROM call_logs WHERE id = ?',
      [input.callId],
    );
    if (!existing) throw notFound('That call is not there.');
    if (existing.user_id !== user.id) throw forbidden('That call was somebody else’s.');
    /* And it has to be a call to THIS lead, or the result would land on
       somebody else's conversation. */
    if (existing.opportunity_id !== opportunityId) {
      throw badRequest('That call was to a different lead.');
    }
    await execute(
      'UPDATE call_logs SET outcome = ?, outcome_at = ?, note = ? WHERE id = ?',
      [OUTCOME[input.result], now, input.note ?? null, input.callId],
    );
  } else {
    await execute(
      `INSERT INTO call_logs
         (id, opportunity_id, contact_id, user_id, started_at, outcome, outcome_at, note, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'lead')`,
      [
        callId, opportunityId, lead.contact_id, user.id,
        /* Bound as a Date, never as a string: production is MariaDB and the
           tests are MySQL 8, and a date bound as text is read differently by
           the two. See CLAUDE.md. */
        now, OUTCOME[input.result], now, input.note ?? null,
      ],
    );
  }

  const action = ACTION[input.result];
  await runLeadAction(actor, {
    opportunityId,
    action,
    /* The agent's own answer where a screen asked for one, and the result's
       own meaning where it did not. */
    reason: input.reason?.trim() || REASON[input.result] || null,
    note: input.note ?? null,
    nextStep: nextStepFor(input.result, next.at, callBackAt, settings, tries),
    /*
     * Which of the six it was, on the timeline row itself.
     *
     * `ACTION` maps both Busy and No answer onto the same lead action, which
     * is right — they both mean "did not speak to them" and both count a try
     * — but it leaves the row unable to say which. The owner's picture shows
     * the Tries column reading `Busy ×1`, so the row has to know. Written
     * here, read by `LAST_RESULT_SQL`, and taken back by §1b's undo along
     * with the rest of that row, because it is part of it.
     */
    meta: { result: input.result },
  });

  /*
   * When the lead should be left with nothing promised.
   *
   * Two cases, and both are deliberate:
   *
   *  - **Past the last try (A.5.)** Nothing happens on its own. Left to
   *    itself, `runLeadAction` would fill in its own two-hourly default for a
   *    no-answer with no next step given, and the screen's "Mark Lost · Give
   *    back to Incoming" question would sit under a promise nobody made.
   *  - **A run that ended with nothing to replace the promise.** An agent who
   *    gets through, or finds the number is wrong, is otherwise left holding a
   *    lead that still says "No answer — try 3 of 5, tomorrow 11:00". That
   *    promise belonged to the run and the run is over. A call-back brings its
   *    own time and Not interested closes the lead, so neither needs this.
   *
   * Either way the lead lands in No next step, where a person can see it is
   * waiting on a decision — the one list this CRM exists to empty.
   */
  const endedARun = !COUNTS_AS_TRY.has(input.result)
    && input.result !== 'call_back'
    && input.result !== 'not_interested'
    && Number(lead.no_answer_count ?? 0) > 0;

  if ((COUNTS_AS_TRY.has(input.result) && next.at === null) || endedARun) {
    await execute(
      `UPDATE opportunities
          SET next_step_at = NULL, next_step_type = NULL, next_step_note = NULL
        WHERE id = ?`,
      [opportunityId],
    );
  }

  /* The timeline row this result wrote, so §1b can mark that exact one taken
     back rather than guessing at the newest. */
  const activityId = await newestActivity(opportunityId, user.id);

  await writeAudit({
    actor,
    action: 'lead.call_result',
    entityType: 'opportunity',
    entityId: opportunityId,
    before,
    after: {
      result: input.result,
      said: RESULT_LABELS[input.result],
      reason: input.reason?.trim() || REASON[input.result] || null,
      tries,
      maxTries: settings.max,
      step: next.step,
      nextTryAt: next.at ? next.at.toISOString() : null,
      callId,
      activityId,
    },
  });

  const after = await leadFor(user, opportunityId);
  return stateOf(after, settings, { whatsapp: COUNTS_AS_TRY.has(input.result), now });
}

/** What to promise next, which is the only thing the agent is not asked for. */
function nextStepFor(
  result: CallResult,
  at: Date | null,
  callBackAt: Date | null,
  settings: CallTries,
  tries: number,
): { type: NextStepType; at: string; note: string } | null {
  if (result === 'call_back' && callBackAt) {
    return { type: 'call', at: callBackAt.toISOString(), note: 'They asked us to call back' };
  }
  if (!at) return null;
  return {
    type: 'call',
    at: at.toISOString(),
    note: result === 'busy'
      ? `Line was busy — try ${tries + 1} of ${settings.max}`
      : `No answer — try ${tries + 1} of ${settings.max}`,
  };
}

/**
 * The timeline row `runLeadAction` just wrote.
 *
 * Not matched on its type: `runLeadAction` maps an action to its own activity
 * type and the mapping is its business, not this file's. The newest row for
 * this person on this lead, read immediately after, is the one it wrote.
 */
async function newestActivity(opportunityId: string, userId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM activities
      WHERE opportunity_id = ? AND user_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 1`,
    [opportunityId, userId],
  );
  return row?.id ?? null;
}

/* ── taking one back (contract §1b) ───────────────────────────────────── */

export async function undoCallResult(
  actor: AuditActor,
  user: SessionUser,
  opportunityId: string,
  now: Date = new Date(),
): Promise<NoAnswerState> {
  const lead = await leadFor(user, opportunityId);
  const settings = await callTriesSettings();

  const save = await lastSave(opportunityId);
  if (!save) throw conflict('There is nothing to take back on this lead.');

  /* The agent who saved it, or an owner or admin. A manager may see the lead
     and still not rewrite somebody else's call. */
  if (save.actorUserId !== user.id && !isAdminOrAbove(user.role)) {
    throw forbidden('Only the agent who saved that result can take it back.');
  }

  const age = now.getTime() - save.createdAt.getTime();
  if (age > UNDO_WINDOW_MINUTES * 60_000) {
    throw conflict(
      `That result is more than ${UNDO_WINDOW_MINUTES} minutes old, so it stays on the record. `
      + 'Save the result you meant instead.',
    );
  }

  /*
   * Put the lead back exactly as it was.
   *
   * Every column a result can touch, from the snapshot taken before it ran —
   * the try count, the promise, the stage, and the status if the result closed
   * the lead. Dates come back out of JSON as strings and are bound as `Date`
   * objects, never as text.
   */
  const sets: string[] = [];
  const args: Array<string | number | Date | null> = [];
  for (const column of RESTORED) {
    const value = save.before[column] ?? null;
    sets.push(`${column} = ?`);
    args.push(typeof value === 'string' && ISO.test(value) ? new Date(value) : value);
  }
  await execute(`UPDATE opportunities SET ${sets.join(', ')} WHERE id = ?`, [...args, opportunityId]);

  /*
   * Nothing is erased. The attempt is marked taken back: the timeline keeps
   * the row and says so, and the per-agent try figures stop counting it,
   * because they read the same flag.
   */
  if (save.after.activityId) {
    await execute(
      `UPDATE activities
          SET title = CONCAT(LEFT(title, 200), ' — taken back'),
              meta = JSON_SET(COALESCE(meta, JSON_OBJECT()), '$.undone', ?, '$.undoneBy', ?)
        WHERE id = ? AND JSON_EXTRACT(meta, '$.undone') IS NULL`,
      [now.toISOString(), user.id, save.after.activityId],
    );
  }

  await writeAudit({
    actor,
    action: 'lead.call_result_undone',
    entityType: 'opportunity',
    entityId: opportunityId,
    before: { auditId: save.id, ...save.after },
    after: { restored: save.before },
  });

  const after = await leadFor(user, opportunityId);
  return stateOf(after, settings, { whatsapp: false, now });
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;

/**
 * The one line a toast says after a result is saved.
 *
 * In the agent's own words, never a column value, and never an emoji: the
 * CRM's old wording for this was "Moved to Interested" with a flame after it,
 * and E.1 is clear that the line icons are the icon set.
 *
 * For the two that count as a try it carries the ladder — "No answer · try 2
 * of 5 · next try tomorrow 11:00" — which is A.1's sentence and A.3's line in
 * one, so a screen that can only show one string still shows the useful one.
 */
export function savedWords(result: CallResult, state: NoAnswerState): string {
  if (state.line) return `${RESULT_LABELS[result]} · ${state.line.replace(/^Try /, 'try ')}`;
  if (result === 'interested') return 'Moved to Interested';
  if (result === 'call_back') return 'Call back set';
  if (result === 'not_interested') return 'Marked Lost';
  if (result === 'wrong_number') return 'Flagged as a wrong number';
  if (result === 'answered') return 'Call logged';
  return `${RESULT_LABELS[result]} saved`;
}

/* ── what the screens ask for ─────────────────────────────────────────── */

/** The state of a lead without changing anything — for a reload, or a card. */
export async function callResultState(
  user: SessionUser, opportunityId: string, now: Date = new Date(),
): Promise<NoAnswerState> {
  const lead = await leadFor(user, opportunityId);
  return stateOf(lead, await callTriesSettings(), { whatsapp: false, now });
}

/**
 * The `noAnswer` field every lead row carries (contract §3).
 *
 * A pure function of the row, so the list query stays one query. Null when
 * nothing has been tried, which is most leads most of the time.
 */
export function noAnswerOf(row: {
  no_answer_count?: unknown; last_try_at?: unknown; next_step_at?: unknown;
  last_result?: unknown;
}): {
  tries: number; lastTryAt: string | null; nextTryAt: string | null;
  lastResult: 'no_answer' | 'busy' | null;
} | null {
  const tries = Number(row.no_answer_count ?? 0);
  if (!Number.isFinite(tries) || tries <= 0) return null;
  return {
    tries,
    lastTryAt: iso(row.last_try_at),
    nextTryAt: iso(row.next_step_at),
    lastResult: lastResultOf(row.last_result),
  };
}

/**
 * Which of the two "did not speak to them" results the last try was.
 *
 * Only `busy` and `no_answer` can be the last try at all: every other result
 * ends the run and puts `no_answer_count` back to zero, so a lead with tries
 * on it was last either rung out or found engaged. Anything else that somehow
 * reaches here reads as null, and the screen then says "No answer" — which is
 * what every row said before this field existed.
 */
function lastResultOf(value: unknown): 'no_answer' | 'busy' | null {
  /* MySQL's JSON_UNQUOTE gives a plain string; a driver that hands back the
     quoted JSON instead is stripped rather than shown with its quotes. */
  const said = typeof value === 'string' ? value.replace(/^"|"$/g, '') : '';
  if (said === 'busy' || said === 'no_answer') return said;
  return null;
}

/** The SQL that puts `last_try_at` on a lead row. */
export const LAST_TRY_SQL = `
  CASE WHEN o.no_answer_count > 0 THEN (
    SELECT MAX(a.created_at) FROM activities a
     WHERE a.opportunity_id = o.id AND a.type = 'no_answer'
       AND JSON_EXTRACT(a.meta, '$.undone') IS NULL
  ) END`;

/**
 * And the SQL that puts `last_result` beside it — "Busy ×1" rather than
 * "No answer ×1" where the last try was a busy line.
 *
 * The same row `LAST_TRY_SQL` reads, chosen the same way: the newest
 * `no_answer` activity that has not been taken back. `saveCallResult` writes
 * `result` into that row's `meta`. A try logged before this existed, or one
 * logged by a path that does not go through `saveCallResult`, has no `result`
 * in its meta and comes back null — and the screen says "No answer", which
 * is both what it said before and what the action itself means.
 *
 * `created_at DESC, id DESC` rather than `MAX()`, because what is wanted is a
 * column off the newest row and not the largest value of one; two tries
 * inside the same millisecond are then still settled, which matters on
 * MariaDB as much as on MySQL. No aggregate is named in ORDER BY.
 */
export const LAST_RESULT_SQL = `
  CASE WHEN o.no_answer_count > 0 THEN (
    SELECT JSON_UNQUOTE(JSON_EXTRACT(a.meta, '$.result')) FROM activities a
     WHERE a.opportunity_id = o.id AND a.type = 'no_answer'
       AND JSON_EXTRACT(a.meta, '$.undone') IS NULL
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 1
  ) END`;

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return new Date(value).toISOString();
  return null;
}

/* ── the owner's numbers (H.1) ────────────────────────────────────────── */

export const TRY_PERIODS = ['today', 'week'] as const;
export type TryPeriod = (typeof TRY_PERIODS)[number];

export interface TriesByAgent {
  period: TryPeriod;
  /** How the period reads on screen. */
  label: string;
  agents: Array<{ userId: string; name: string; tries: number; leads: number }>;
  total: number;
}

/**
 * No-answer tries per agent, today and over the last seven days (H.1).
 *
 * Counted from `activities`, not from `call_logs`: every path that logs a
 * result writes the activity — the dialler, the lead page and
 * `saveCallResult` — while `call_logs` is only written where a call was
 * started in the CRM. A result taken back under §1b is excluded, because it
 * carries the flag the undo set.
 *
 * Fenced by `visibleUserIds` like every other figure: an agent sees their own,
 * a manager their team's, an owner everyone's.
 *
 * The window matches `v2/messaging.ts` — the last seven Dubai days including
 * today — so "this week" means the same thing on both screens.
 */
export async function triesByAgent(user: SessionUser, period: TryPeriod): Promise<TriesByAgent> {
  const visible = await visibleUserIds(user);
  const scope = ownerPredicate('a.user_id', visible);
  const from = period === 'today' ? DAY_START : `DATE_SUB(${DAY_START}, INTERVAL 6 DAY)`;

  const rows = await query<{ userId: string; name: string | null; tries: number; leads: number }>(
    `SELECT a.user_id AS userId, u.name,
            COUNT(*) AS tries,
            COUNT(DISTINCT a.opportunity_id) AS leads
       FROM activities a
       JOIN users u ON u.id = a.user_id
      WHERE ${scope.sql} AND a.type = 'no_answer'
        AND JSON_EXTRACT(a.meta, '$.undone') IS NULL
        AND a.created_at >= ${from} AND a.created_at < ${DAY_END}
      GROUP BY a.user_id, u.name
      ORDER BY COUNT(*) DESC, u.name ASC`,
    scope.params,
  );

  const agents = rows.map((row) => ({
    userId: String(row.userId),
    name: row.name ?? 'Someone who has left',
    tries: Number(row.tries ?? 0),
    leads: Number(row.leads ?? 0),
  }));

  return {
    period,
    label: period === 'today' ? 'Today' : 'Last 7 days',
    agents,
    total: agents.reduce((sum, one) => sum + one.tries, 0),
  };
}
