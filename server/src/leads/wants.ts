/**
 * "What the client wants", and the record of every time it changed.
 *
 * `design/web/lead.html` draws seven lines in the right-hand column — Project,
 * Unit, Budget, Purpose, Timeline, Payment, Language — and puts one sentence
 * above them: *click a line to edit*. An edit writes a line on the timeline
 * and a row in the change history, which is the Info tab's bottom half:
 * "Rocky changed Budget · 1.5M → 2M".
 *
 * None of that existed. Three of the seven lines were not even sent to the
 * screen, and all seven were read-only, so the only way to correct a budget
 * somebody misheard was to write a note about it and hope.
 *
 * Two rules hold here:
 *
 *   * **Nothing is invented.** Purpose, Timeline and Payment are ENUM columns
 *     with a fixed vocabulary, so the screen offers that vocabulary rather
 *     than a free-text box the database would refuse. The budget parser only
 *     ever reads digits the agent typed; where it cannot read a figure it
 *     keeps their words and stores no number at all.
 *   * **Every change is recorded twice** — once as an activity, which is the
 *     timeline, and once in `audit_log`, which is the change history and the
 *     thing that answers "who put that there" six months later.
 */
import {
  execute, getPool, query, queryOne, withRetryingTransaction, type Executor,
} from '../db/client.js';
import { addActivity } from '../ingestion/ingest.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { notFound } from '../lib/errors.js';
import { assignmentList } from '../lib/sql.js';

export const PURPOSES = ['investment', 'end_use', 'unknown'] as const;
export const TIMELINES = [
  'immediate', '1_3_months', '3_6_months', '6_12_months', '12_plus', 'unknown',
] as const;
export const PAYMENTS = ['cash', 'mortgage', 'payment_plan', 'unknown'] as const;

/**
 * The words the screen shows for each stored value.
 *
 * Sent to the screen rather than written there as well, so a choice on the
 * page is always one the column can hold. The design's own examples for these
 * three lines are free text ("Q1 2027", "60 / 40 plan"); see
 * `docs/v2/questions-leads.md`.
 */
export const WANT_CHOICES = {
  purpose: [
    { value: 'investment', label: 'Investment' },
    { value: 'end_use', label: 'To live in' },
    { value: 'unknown', label: 'Not said yet' },
  ],
  timeline: [
    { value: 'immediate', label: 'Right away' },
    { value: '1_3_months', label: 'In 1–3 months' },
    { value: '3_6_months', label: 'In 3–6 months' },
    { value: '6_12_months', label: 'In 6–12 months' },
    { value: '12_plus', label: 'After a year' },
    { value: 'unknown', label: 'Not said yet' },
  ],
  payment: [
    { value: 'cash', label: 'Cash' },
    { value: 'mortgage', label: 'Mortgage' },
    { value: 'payment_plan', label: 'Payment plan' },
    { value: 'unknown', label: 'Not said yet' },
  ],
} as const;

export interface WantsPatch {
  project?: string | null;
  unit?: string | null;
  budget?: string | null;
  purpose?: (typeof PURPOSES)[number];
  timeline?: (typeof TIMELINES)[number];
  payment?: (typeof PAYMENTS)[number];
  language?: string | null;
}

export interface ParsedBudget {
  min: number | null;
  max: number | null;
  /** The agent's own words, kept whether a figure was found or not. */
  band: string | null;
}

/**
 * Read a budget out of what somebody typed.
 *
 * Accepts the forms agents actually write: `2M`, `AED 2M`, `2,000,000`,
 * `1.5M - 2M`, `1.5–2M`, `800K`. A single figure sets both ends, which is how
 * `budgetLabel` renders one number rather than a range that is not a range.
 *
 * Returns nulls for both ends when there is no figure in the text at all. It
 * never guesses: "needs a mortgage first" is a perfectly good thing to have
 * on the budget line, and it is kept as written with no number behind it.
 */
export function parseBudget(text: string | null): ParsedBudget {
  const band = text === null ? null : text.trim() || null;
  if (!band) return { min: null, max: null, band: null };

  const found: number[] = [];
  /* A number, then optionally the letter that multiplies it. `2.5m`, `800k`,
     `2,000,000`. The separator between two of them is anything non-numeric. */
  for (const match of band.matchAll(/(\d[\d,.\s]*)\s*([mk])?/gi)) {
    const digits = (match[1] ?? '').replace(/[,\s]/g, '');
    if (!digits || digits === '.') continue;
    const value = Number(digits);
    if (!Number.isFinite(value) || value <= 0) continue;
    const suffix = (match[2] ?? '').toLowerCase();
    const scaled = suffix === 'm' ? value * 1_000_000 : suffix === 'k' ? value * 1_000 : value;
    /* A plain "2" on the budget line means two million, not two dirhams.
       Anything under a thousand with no letter after it is read as millions —
       no brokerage in Dubai sells a flat for AED 800. */
    const sane = !suffix && scaled < 1_000 ? scaled * 1_000_000 : scaled;
    found.push(Math.round(sane));
    if (found.length === 2) break;
  }

  if (found.length === 0) return { min: null, max: null, band };
  const [first, second] = found;
  if (second === undefined) return { min: first ?? null, max: first ?? null, band };
  return { min: Math.min(first!, second), max: Math.max(first!, second), band };
}

/** Column names, in the words the change history uses. */
export const FIELD_LABELS: Record<string, string> = {
  project_name: 'Project',
  unit_type: 'Unit',
  budget_band: 'Budget',
  budget_min_aed: 'Budget (lowest)',
  budget_max_aed: 'Budget (highest)',
  purpose: 'Purpose',
  timeline: 'Timeline',
  payment_method: 'Payment',
  preferred_location: 'Where',
  language: 'Language',
  full_name: 'Name',
  phone_e164: 'Phone',
  whatsapp_number: 'WhatsApp 2',
  telegram: 'Telegram',
  nationality: 'Nationality',
  email: 'Email',
  country: 'Country',
  city: 'City',
  stageKey: 'Stage',
  status: 'Status',
  reason: 'Reason',
  owner_user_id: 'Agent',
  toUserId: 'Agent',
  priceAed: 'Price',
  paidNowAed: 'Paid now',
  signed: 'Signed',
  unit: 'Unit',
};

interface Row { column: string; value: string | number | null }

/**
 * Apply an edit, and record it.
 *
 * One transaction: the columns, the timeline entry and the audit row either
 * all happen or none of them do. A field edit that is not on the timeline is
 * how a budget changes overnight and nobody can say who did it.
 */
export async function updateWants(
  actor: AuditActor,
  opportunityId: string,
  patch: WantsPatch,
): Promise<{ changed: string[] }> {
  const changed: string[] = [];

  await withRetryingTransaction(async (tx) => {
    const before = await queryOne<Record<string, unknown>>(
      `SELECT o.id, o.contact_id, o.project_name, o.unit_type, o.budget_min_aed, o.budget_max_aed,
              o.budget_band, o.purpose, o.payment_method, o.timeline, c.language
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id
        WHERE o.id = ? AND o.deleted_at IS NULL
          FOR UPDATE`,
      [opportunityId],
      tx,
    );
    if (!before) throw notFound('That lead no longer exists.');

    const rows: Row[] = [];
    const was: Record<string, unknown> = {};
    const now: Record<string, unknown> = {};

    const note = (column: string, value: string | number | null) => {
      const old = before[column] ?? null;
      const next = value ?? null;
      /* The database hands a BIGINT back as a string sometimes, so compare
         the printed forms: otherwise every save looks like a change. */
      if (String(old ?? '') === String(next ?? '')) return;
      rows.push({ column, value: next });
      was[column] = old;
      now[column] = next;
    };

    if (patch.project !== undefined) note('project_name', trimmed(patch.project, 160));
    if (patch.unit !== undefined) note('unit_type', trimmed(patch.unit, 64));
    if (patch.budget !== undefined) {
      const parsed = parseBudget(patch.budget);
      note('budget_band', parsed.band);
      note('budget_min_aed', parsed.min);
      note('budget_max_aed', parsed.max);
    }
    if (patch.purpose !== undefined) note('purpose', patch.purpose);
    if (patch.timeline !== undefined) note('timeline', patch.timeline);
    if (patch.payment !== undefined) note('payment_method', patch.payment);

    const contactId = String(before.contact_id);
    /* The language lives on the person, not on the enquiry: somebody who
       speaks Russian speaks Russian about every project. */
    const languageChanged = patch.language !== undefined
      && String(before.language ?? '') !== String(trimmed(patch.language, 12) ?? '');

    if (rows.length === 0 && !languageChanged) return;

    if (rows.length > 0) {
      await execute(
        `UPDATE opportunities SET ${assignmentList(rows.map((r) => r.column))} WHERE id = ?`,
        [...rows.map((r) => r.value), opportunityId],
        tx,
      );
    }

    if (languageChanged) {
      const next = trimmed(patch.language ?? null, 12);
      /*
       * Locked, like every hand edit of a contact: ingestion fills empty
       * fields only and must never overwrite what an agent typed.
       */
      const locked = new Set(parseLocked(await lockedFields(contactId, tx)));
      locked.add('language');
      await execute(
        'UPDATE contacts SET language = ?, locked_fields = ? WHERE id = ?',
        [next, JSON.stringify([...locked]), contactId],
        tx,
      );
      was.language = before.language ?? null;
      now.language = next;
    }

    const names = Object.keys(now)
      .map((column) => FIELD_LABELS[column] ?? column)
      /* Budget is three columns and one line on the screen. */
      .map((label) => (label.startsWith('Budget') ? 'Budget' : label));
    const unique = [...new Set(names)];
    changed.push(...unique);

    await addActivity(tx, {
      contactId,
      opportunityId,
      userId: actor.userId,
      type: 'field_edit',
      title: `Changed ${unique.join(', ').toLowerCase()}`,
      body: unique
        .map((label) => `${label}: ${shown(was, label)} → ${shown(now, label)}`)
        .join(' · ')
        .slice(0, 2000),
      meta: { fields: unique, before: was, after: now },
    });

    await writeAudit(
      {
        actor,
        action: 'lead.wants_changed',
        entityType: 'opportunity',
        entityId: opportunityId,
        before: was,
        after: now,
      },
      tx,
    );
  });

  return { changed };
}

/** What a field reads as in a sentence, across the three budget columns. */
function shown(bag: Record<string, unknown>, label: string): string {
  if (label === 'Budget') {
    const band = bag.budget_band;
    if (band) return String(band);
    const min = bag.budget_min_aed;
    const max = bag.budget_max_aed;
    if (min || max) return `AED ${Number(min ?? max).toLocaleString('en-US')}`;
    return 'not said';
  }
  const column = Object.keys(FIELD_LABELS).find((key) => FIELD_LABELS[key] === label);
  const value = column ? bag[column] : null;
  if (value === null || value === undefined || value === '') return 'not said';
  return String(value).replace(/_/g, ' ');
}

function trimmed(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const tidy = value.trim();
  return tidy === '' ? null : tidy.slice(0, max);
}

async function lockedFields(contactId: string, exec: Executor): Promise<unknown> {
  const row = await queryOne<{ locked_fields: unknown }>(
    'SELECT locked_fields FROM contacts WHERE id = ?',
    [contactId],
    exec,
  );
  return row?.locked_fields ?? null;
}

function parseLocked(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  try {
    const parsed: unknown = JSON.parse(String(raw));
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export interface HistoryRow {
  id: string;
  /** "Rocky changed Budget", "Lead created". */
  what: string;
  /** "1.5M → 2M", or null when the change has no two sides. */
  detail: string | null;
  who: string | null;
  at: string;
}

/** Audit actions worth a line even when nothing was diffed. */
const PLAIN_WORDS: Record<string, string> = {
  'lead.won': 'marked the deal Won',
  'lead.lost': 'marked the lead Lost',
  'lead.meeting': 'booked a meeting',
  'lead.call_back': 'planned a follow-up',
  'lead.problem': 'flagged a problem',
  'lead.wants_changed': 'changed the details',
  'opportunity.reassigned': 'gave the lead to another agent',
  'opportunity.stage_changed': 'moved the stage',
  'contact.updated': 'changed the contact',
  'note.file_added': 'added a file',
  'note.file_opened': 'opened a file',
  'note.file_removed': 'removed a file',
  'note.voice_added': 'added a voice note',
  'transfer.requested': 'asked another agent to take it',
  'transfer.accepted': 'took the lead',
  'transfer.declined': 'said no to the transfer',
};

/**
 * The change history on the Info tab.
 *
 * Read out of `audit_log`, which has held every one of these rows all along —
 * there was simply no endpoint that served a single record's history, so the
 * tab could not show it.
 */
export async function fieldHistory(
  opportunityId: string,
  exec: Executor = getPool(),
): Promise<HistoryRow[]> {
  const lead = await queryOne<{ contact_id: string; created_at: Date; source: string | null }>(
    'SELECT contact_id, created_at, source FROM opportunities WHERE id = ?',
    [opportunityId],
    exec,
  );
  if (!lead) throw notFound('That lead no longer exists.');

  const rows = await query<{
    id: string; action: string; before_json: unknown; after_json: unknown;
    actor_label: string | null; actor_user_id: string | null; who: string | null; created_at: Date;
  }>(
    `SELECT a.id, a.action, a.before_json, a.after_json, a.actor_label, a.actor_user_id,
            u.name AS who, a.created_at
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE (a.entity_type = 'opportunity' AND a.entity_id = ?)
         OR (a.entity_type = 'contact' AND a.entity_id = ?)
      ORDER BY a.created_at DESC
      LIMIT 60`,
    [opportunityId, lead.contact_id],
    exec,
  );

  const out: HistoryRow[] = [];
  for (const row of rows) {
    const was = asBag(row.before_json);
    const now = asBag(row.after_json);
    const who = row.who ?? row.actor_label ?? null;
    const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])]
      .filter((key) => FIELD_LABELS[key] !== undefined);

    const wasCount = out.length;
    for (const key of keys) {
      const from = plain(was[key]);
      const to = plain(now[key]);
      if (from === to) continue;
      out.push({
        id: `${row.id}:${key}`,
        what: `${who ?? 'The CRM'} changed ${FIELD_LABELS[key]}`,
        detail: from === null ? `added ${to ?? 'nothing'}` : `${from} → ${to ?? 'nothing'}`,
        who,
        at: row.created_at.toISOString(),
      });
    }
    /* A row that produced its own lines does not also need the generic one. */
    if (out.length > wasCount) continue;

    const words = PLAIN_WORDS[row.action];
    if (!words) continue;
    out.push({
      id: row.id,
      what: `${who ?? 'The CRM'} ${words}`,
      detail: null,
      who,
      at: row.created_at.toISOString(),
    });
  }

  /* The last line of the design's list, and the one that is always there. */
  out.push({
    id: `${opportunityId}:created`,
    what: 'Lead created',
    detail: lead.source ? `source ${lead.source.replace(/_/g, ' ')}` : null,
    who: null,
    at: lead.created_at.toISOString(),
  });

  return out.slice(0, 40);
}

function asBag(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      /* Not an object, so nothing to diff. */
    }
  }
  return {};
}

function plain(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value.toLocaleString('en-US');
  return String(value).replace(/_/g, ' ');
}
