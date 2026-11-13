/**
 * "Report a bug or an idea", and what the owner did about it.
 *
 * `design/web/feedback.html` is the agent's side — one box, one tap — and
 * `design/web/feedback-inbox.html` is the owner's list of what came in.
 *
 * Several things here are deliberate:
 *
 *  - **The screen the agent was on is captured, not asked for.** It is the
 *    first question anybody would ask back, and an agent who has to answer it
 *    before they can report a bug usually does not report the bug.
 *  - **"It stops me working" sorts to the top and stays there.** An agent who
 *    cannot do their job today is a different problem from an idea for next
 *    month, and a single list sorted by date buries the first under the
 *    second.
 *  - **Every report has a number.** `#1042` is how an owner and an agent refer
 *    to the same report out loud. It is a counter rather than the primary key,
 *    which is a CHAR(36) nobody can read over the phone.
 *  - **Replies are a thread.** The one `reply` column overwrote itself, so
 *    "planned for the later phase" erased "we are looking at it". It is kept
 *    as *the latest* reply, because the agent's own page reads it, and the
 *    whole exchange lives in `feedback_replies`.
 *
 * Everyone may report. Only an owner or admin reads the inbox and replies.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getPool, query, queryOne, execute, type Executor, type SqlParam } from '../db/client.js';
import {
  AUDIO_TYPES, IMAGE_TYPES, baseContentType, extensionFor, insideUploadDir, uploadDir,
} from '../lib/uploads.js';
import { notFound, badRequest } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';

/* The design's four type chips, in the design's order. */
export const FEEDBACK_KINDS = ['bug', 'issue', 'feature', 'idea'] as const;
export const FEEDBACK_STATES = ['new', 'planned', 'fixed', 'declined'] as const;
export const FEEDBACK_URGENCIES = ['low', 'normal', 'blocking'] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATES)[number];
export type FeedbackUrgency = (typeof FEEDBACK_URGENCIES)[number];

/** What each chip reads, so the server and the screen cannot drift apart. */
export const KIND_WORDS: Record<string, string> = {
  bug: 'Bug',
  issue: 'Issue',
  feature: 'New feature',
  idea: 'Idea',
  /* Stored by the CRM before migration 0039 and still readable. */
  question: 'Issue',
};

/**
 * The nearest of `feedback_tickets.kind`'s own three values.
 *
 * `kind` is an ENUM written in migration 0036 — bug, idea, question — and
 * widening it would be an `ALTER TABLE ... MODIFY`, which the migration
 * safety test refuses because a MODIFY can truncate real values on a live
 * database. So the design's four live in `kind_v2` and the old column keeps
 * being written with whichever of its three is closest, so anything still
 * reading it carries on working. The same shape as `lost_reason_v2`.
 */
function legacyKind(kind: FeedbackKind): 'bug' | 'idea' | 'question' {
  if (kind === 'bug') return 'bug';
  if (kind === 'feature') return 'idea';
  if (kind === 'idea') return 'idea';
  /* "Issue" was shown for `question` before 0039, and still maps to it. */
  return 'question';
}

export const URGENCY_WORDS: Record<FeedbackUrgency, string> = {
  low: 'Low',
  normal: 'Normal',
  blocking: 'Blocking my work',
};

/** §4.10 of the spec: a report is worth fifteen points to whoever sent it. */
export const FEEDBACK_POINTS = 15;

export interface Reply {
  id: string;
  body: string;
  author: string | null;
  createdAt: string;
}

export interface Ticket {
  id: string;
  /** The number an owner quotes: `#1042`. */
  ref: number | null;
  kind: FeedbackKind;
  kindWord: string;
  /** One short line. Older reports have none, so the body stands in. */
  title: string;
  body: string;
  screen: string | null;
  status: FeedbackStatus;
  urgency: FeedbackUrgency;
  urgencyWord: string;
  blocking: boolean;
  /** Whether something is attached. Never the path, which is on disk. */
  hasScreenshot: boolean;
  hasVoice: boolean;
  voiceSeconds: number | null;
  reply: string | null;
  repliedBy: string | null;
  repliedAt: string | null;
  replies: Reply[];
  fromName: string | null;
  fromId: string;
  createdAt: string;
}

/* `kind_v2` is the design's four; `kind` is the three the ENUM has held
   since 0036. A row written before the migration has no `kind_v2`, and its
   old value is mapped on the way out. */
const COLUMNS = `f.id, f.ref,
  COALESCE(f.kind_v2, CASE f.kind WHEN 'question' THEN 'issue' ELSE f.kind END) AS kind,
  f.title, f.body, f.screen, f.status, f.blocking, f.urgency,
  f.screenshot_path IS NOT NULL AS hasScreenshot, f.voice_path IS NOT NULL AS hasVoice,
  f.voice_seconds AS voiceSeconds,
  f.reply, f.replied_at AS repliedAt, f.user_id AS fromId, f.created_at AS createdAt,
  u.name AS fromName, r.name AS repliedBy`;

const JOINS = `FROM feedback_tickets f
  JOIN users u ON u.id = f.user_id
  LEFT JOIN users r ON r.id = f.replied_by`;

/**
 * A report's heading.
 *
 * The design puts a short title in the table's second column with the body in
 * the side panel. Reports sent before there was a title field have only a
 * body, and a row whose heading is a three-sentence paragraph is the fault
 * that made the table unreadable — so the first sentence, clipped, stands in.
 */
export function headingFor(title: string | null, body: string): string {
  const written = (title ?? '').trim();
  if (written) return written;
  const first = body.trim().split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? body.trim();
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
}

function shape(row: Record<string, unknown>, replies: Reply[] = []): Ticket {
  const kind = String(row.kind) as FeedbackKind;
  const urgency = (row.urgency as FeedbackUrgency) ?? 'normal';
  return {
    ...(row as unknown as Ticket),
    kind,
    kindWord: KIND_WORDS[kind] ?? 'Bug',
    title: headingFor(row.title as string | null, String(row.body ?? '')),
    urgency,
    urgencyWord: URGENCY_WORDS[urgency] ?? URGENCY_WORDS.normal,
    blocking: Number(row.blocking) === 1,
    hasScreenshot: Number(row.hasScreenshot) === 1,
    hasVoice: Number(row.hasVoice) === 1,
    voiceSeconds: row.voiceSeconds === null || row.voiceSeconds === undefined
      ? null : Number(row.voiceSeconds),
    replies,
  };
}

export const sendSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  /* Optional, because `design/web/feedback.html` is one box and the agent is
     not made to invent a subject line before they can report anything. */
  title: z.string().max(160).nullable().optional(),
  body: z.string().min(4).max(4000),
  /* The path, captured by the screen rather than typed by the person. */
  screen: z.string().max(160).nullable().optional(),
  urgency: z.enum(FEEDBACK_URGENCIES).optional(),
  blocking: z.boolean().optional(),
});

/**
 * The next number.
 *
 * `MAX(ref) + 1` under the unique key: two reports sent in the same second
 * race, one of them loses on `uq_feedback_ref`, and the retry picks up the
 * number the winner just took. Three tries is far more than a ten-person
 * office will ever need and is a hard stop rather than a loop.
 */
async function nextRef(exec: Executor): Promise<number> {
  const row = await queryOne<{ n: number | null }>(
    'SELECT MAX(ref) AS n FROM feedback_tickets', [], exec,
  );
  return Number(row?.n ?? 1000) + 1;
}

export async function sendFeedback(
  userId: string,
  input: z.infer<typeof sendSchema>,
  exec: Executor = getPool(),
): Promise<Ticket> {
  const id = newId();
  /* `blocking` and `urgency` say the same thing two ways, and the running CRM
     reads the boolean. Whichever the caller sent, both are written. */
  const urgency: FeedbackUrgency = input.urgency ?? (input.blocking ? 'blocking' : 'normal');

  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
    try {
      await execute(
        `INSERT INTO feedback_tickets
           (id, ref, user_id, kind, kind_v2, title, body, screen, blocking, urgency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, await nextRef(exec), userId, legacyKind(input.kind), input.kind,
          input.title?.trim()?.slice(0, 160) || null, input.body.trim(),
          input.screen?.slice(0, 160) ?? null,
          urgency === 'blocking' ? 1 : 0, urgency,
        ],
        exec,
      );
      saved = true;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'ER_DUP_ENTRY' || attempt === 2) throw err;
    }
  }

  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${COLUMNS} ${JOINS} WHERE f.id = ?`, [id], exec,
  );
  return shape(row as Record<string, unknown>);
}

/** What one person has sent, so they can see it was not swallowed. */
export async function myFeedback(
  userId: string,
  exec: Executor = getPool(),
): Promise<Ticket[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT ${COLUMNS} ${JOINS} WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 50`,
    [userId],
    exec,
  );
  return rows.map((row) => shape(row));
}

export interface Inbox {
  items: Ticket[];
  counts: Record<FeedbackStatus | 'blocking' | 'all', number>;
  /** So the page can say "+15 points" without the number written twice. */
  points: number;
}

/** Every reply to a set of tickets, in one query rather than N. */
async function repliesFor(ids: string[], exec: Executor): Promise<Map<string, Reply[]>> {
  const out = new Map<string, Reply[]>();
  if (ids.length === 0) return out;
  const rows = await query<{
    id: string; ticket_id: string; body: string; author: string | null; created_at: string;
  }>(
    `SELECT r.id, r.ticket_id, r.body, u.name AS author, r.created_at
       FROM feedback_replies r
       LEFT JOIN users u ON u.id = r.author_id
      WHERE r.ticket_id IN (${ids.map(() => '?').join(',')})
      ORDER BY r.created_at`,
    ids as SqlParam[],
    exec,
  );
  for (const row of rows) {
    const list = out.get(row.ticket_id) ?? [];
    list.push({ id: row.id, body: row.body, author: row.author, createdAt: row.created_at });
    out.set(row.ticket_id, list);
  }
  return out;
}

export async function feedbackInbox(
  filter: FeedbackStatus | 'all' | 'blocking' = 'all',
  exec: Executor = getPool(),
): Promise<Inbox> {
  const where: string[] = [];
  const params: SqlParam[] = [];
  if (filter === 'blocking') where.push("f.urgency = 'blocking'");
  else if (filter !== 'all') { where.push('f.status = ?'); params.push(filter); }

  const rows = await query<Record<string, unknown>>(
    `SELECT ${COLUMNS} ${JOINS}
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      /* Blocking first whatever its date: somebody who cannot work today
         comes before an idea from last week. */
      ORDER BY f.blocking DESC, f.created_at DESC
      LIMIT 200`,
    params,
    exec,
  );

  const replies = await repliesFor(rows.map((row) => String(row.id)), exec);

  const counted = await queryOne<Record<string, number>>(
    `SELECT ${FEEDBACK_STATES.map((one) => `SUM(status = '${one}') AS \`${one}\``).join(', ')},
            SUM(urgency = 'blocking' AND status = 'new') AS blocking,
            COUNT(*) AS \`all\`
       FROM feedback_tickets`,
    [],
    exec,
  );

  return {
    items: rows.map((row) => shape(row, replies.get(String(row.id)) ?? [])),
    counts: Object.fromEntries(
      [...FEEDBACK_STATES, 'blocking', 'all'].map((key) => [key, Number(counted?.[key] ?? 0)]),
    ) as Record<FeedbackStatus | 'blocking' | 'all', number>,
    points: FEEDBACK_POINTS,
  };
}

/** One report with its thread, for the side panel. */
export async function oneTicket(id: string, exec: Executor = getPool()): Promise<Ticket> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT ${COLUMNS} ${JOINS} WHERE f.id = ?`, [id], exec,
  );
  if (!row) throw notFound('That report does not exist.');
  return shape(row, (await repliesFor([id], exec)).get(id) ?? []);
}

export const answerSchema = z.object({
  status: z.enum(FEEDBACK_STATES).optional(),
  reply: z.string().max(4000).nullable().optional(),
});

export async function answerFeedback(
  actor: AuditActor & { id: string },
  id: string,
  input: z.infer<typeof answerSchema>,
  exec: Executor = getPool(),
): Promise<Ticket> {
  const before = await queryOne<{ status: string; ref: number | null }>(
    'SELECT status, ref FROM feedback_tickets WHERE id = ?', [id], exec,
  );
  if (!before) throw notFound('That report does not exist.');

  /*
   * The design's own validator: `data-error="Write your reply first."` on the
   * reply box. An empty reply used to change the status quietly, so pressing
   * Reply with nothing typed looked like it had sent something.
   */
  const written = input.reply?.trim() ?? '';
  if (input.reply !== undefined && input.reply !== null && !written) {
    throw badRequest('Write your reply first.');
  }

  const sets: string[] = [];
  const params: SqlParam[] = [];
  if (input.status) { sets.push('status = ?'); params.push(input.status); }
  if (written) {
    sets.push('reply = ?', 'replied_by = ?', 'replied_at = NOW(3)');
    params.push(written, actor.id);
  } else if (input.reply === null) {
    sets.push('reply = NULL');
  }

  if (sets.length > 0) {
    await execute(`UPDATE feedback_tickets SET ${sets.join(', ')} WHERE id = ?`, [...params, id], exec);
  }
  /* The thread keeps every answer, not only the latest one. */
  if (written) {
    await execute(
      'INSERT INTO feedback_replies (id, ticket_id, author_id, body) VALUES (?, ?, ?, ?)',
      [newId(), id, actor.id, written],
      exec,
    );
  }

  if (sets.length > 0 || written) {
    await writeAudit({
      actor, action: 'feedback.answered', entityType: 'feedback', entityId: id,
      before: { status: before.status },
      after: { status: input.status ?? before.status, replied: Boolean(written), ref: before.ref },
    }, exec);
  }

  return oneTicket(id, exec);
}

/* ── the export file ───────────────────────────────────────────────────── */

/**
 * "Export file", which the design's button toasts as `feedback-11-Nov.xlsx`.
 *
 * CSV rather than xlsx: Excel opens it, nothing has to be installed on the
 * server to write it, and a spreadsheet library on the critical path of a
 * deploy for one button is a poor trade. Named `.csv` so nobody is told it is
 * something it is not. Noted in `docs/decisions-to-confirm.md`.
 */
export async function feedbackCsv(exec: Executor = getPool()): Promise<string> {
  const inbox = await feedbackInbox('all', exec);
  const head = [
    'Number', 'Status', 'Type', 'Urgency', 'From', 'Where', 'Sent', 'Report', 'Detail', 'Replies',
  ];
  const rows = inbox.items.map((one) => [
    one.ref === null ? '' : `#${one.ref}`,
    one.status,
    one.kindWord,
    one.urgencyWord,
    one.fromName ?? '',
    one.screen ?? '',
    one.createdAt,
    one.title,
    one.body,
    one.replies.map((reply) => `${reply.author ?? 'Owner'}: ${reply.body}`).join(' | '),
  ]);
  return [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function csvCell(value: string): string {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  /* A cell starting with =, +, - or @ is run as a formula by Excel. */
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/* ── a screenshot and a voice note ─────────────────────────────────────── */

/**
 * What an agent attaches to a report.
 *
 * `design/web/feedback.html` offers "Add a screenshot" and "Record a voice
 * note", and `design/web/feedback-inbox.html`'s side panel draws a block for
 * each. Neither existed: there was no column, no endpoint and no bytes, so
 * the panel's two blocks would have been decoration.
 *
 * The voice note is the one that earns its place. An agent who cannot work
 * has most to say in the thirty seconds before they give up and phone
 * somebody, and that is exactly when they will not type three paragraphs.
 *
 * One of each per report rather than the design's three screenshots: the
 * panel draws one block, and three is a gallery nobody built. Written down in
 * `docs/decisions-to-confirm.md`.
 */
export const FEEDBACK_FILE_TYPES = { ...IMAGE_TYPES, ...AUDIO_TYPES };

/** Two megabytes. A screenshot larger than that is a photograph by mistake. */
const MAX_FEEDBACK_BYTES = 2 * 1024 * 1024;

export interface Attached {
  kind: 'screenshot' | 'voice';
  bytes: number;
  seconds: number | null;
}

export async function attachToFeedback(
  actor: AuditActor,
  ticketId: string,
  input: {
    userId: string;
    kind: 'screenshot' | 'voice';
    contentType: string;
    body: Buffer;
    seconds?: number | null;
  },
  exec: Executor = getPool(),
): Promise<Attached> {
  const ticket = await queryOne<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM feedback_tickets WHERE id = ?', [ticketId], exec,
  );
  if (!ticket) throw notFound('That report does not exist.');
  /* Only the person who sent it, or an owner adding to it for them. */
  if (ticket.user_id !== input.userId && actor.role !== 'owner' && actor.role !== 'admin') {
    throw badRequest('That is not your report.');
  }

  const extension = extensionFor(input.contentType, FEEDBACK_FILE_TYPES);
  const isAudio = baseContentType(input.contentType) in AUDIO_TYPES;
  if (!extension || extension === '.pdf' || (input.kind === 'voice') !== isAudio) {
    throw badRequest(input.kind === 'voice'
      ? 'That is not a recording the CRM can store.'
      : `${input.contentType || 'That file'} is not a picture. PNG, JPG or WebP.`);
  }
  if (input.body.length === 0) throw badRequest('That file is empty.');
  if (input.body.length > MAX_FEEDBACK_BYTES) {
    throw badRequest('That file is larger than 2 MB.');
  }

  const dir = uploadDir('feedback');
  await mkdir(dir, { recursive: true });
  /* Named after the row and the kind, never after what the uploader called
     it: a filename from a browser is attacker-controlled text. */
  const name = `${ticketId}-${input.kind}${extension}`;
  await writeFile(path.join(dir, name), input.body);

  const seconds = input.kind === 'voice' && input.seconds && input.seconds > 0
    ? Math.min(Math.round(input.seconds), 60 * 10)
    : null;

  if (input.kind === 'voice') {
    await execute(
      'UPDATE feedback_tickets SET voice_path = ?, voice_seconds = ? WHERE id = ?',
      [name, seconds, ticketId], exec,
    );
  } else {
    await execute(
      'UPDATE feedback_tickets SET screenshot_path = ? WHERE id = ?', [name, ticketId], exec,
    );
  }

  await writeAudit({
    actor, action: 'feedback.attached', entityType: 'feedback', entityId: ticketId,
    after: { kind: input.kind, bytes: input.body.length },
  }, exec);

  return { kind: input.kind, bytes: input.body.length, seconds };
}

/**
 * The bytes back, for the panel.
 *
 * Owner and admin, or the person who sent the report. A screenshot of
 * somebody's own screen can carry a client's name and number, so it is not
 * something the whole office may fetch by guessing an id.
 */
export async function feedbackFile(
  ticketId: string,
  kind: 'screenshot' | 'voice',
  reader: { id: string; role: string },
  exec: Executor = getPool(),
): Promise<{ file: string; contentType: string }> {
  const ticket = await queryOne<{
    user_id: string; screenshot_path: string | null; voice_path: string | null;
  }>(
    'SELECT user_id, screenshot_path, voice_path FROM feedback_tickets WHERE id = ?',
    [ticketId], exec,
  );
  if (!ticket) throw notFound('That report does not exist.');
  if (ticket.user_id !== reader.id && reader.role !== 'owner' && reader.role !== 'admin') {
    throw notFound('That report does not exist.');
  }

  const name = kind === 'voice' ? ticket.voice_path : ticket.screenshot_path;
  if (!name) throw notFound('There is nothing attached to that report.');

  const file = path.join(uploadDir('feedback'), path.basename(name));
  if (!insideUploadDir(file)) throw notFound('There is nothing attached to that report.');

  const extension = path.extname(file);
  const contentType = Object.entries(FEEDBACK_FILE_TYPES)
    .find(([, ext]) => ext === extension)?.[0] ?? 'application/octet-stream';
  return { file, contentType };
}
