/**
 * Notes on a lead.
 *
 * The thing that makes these worth having over the old shared text blob is
 * that each one belongs to somebody and can be found again. The budget the
 * client actually said, the objection they raised, the fact that they cannot
 * talk before six — those are worth pinning, and everything else is history
 * that should stay out of the way.
 */
import { randomUUID } from 'node:crypto';
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { notify } from '../messaging/notify.js';
import { logger, errorContext } from '../lib/logger.js';
import { moveStage, type MoveStageResult } from '../services/opportunities.js';
import { stageAfterNote } from './note-stage.js';
import type { Role } from '../auth/rbac.js';

export const NOTE_TYPES = [
  'general', 'call_summary', 'viewing_feedback', 'budget', 'objection', 'next_step',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export interface NoteRow {
  id: string;
  contact_id: string;
  opportunity_id: string | null;
  author_id: string | null;
  author_name: string | null;
  type: NoteType;
  body: string;
  pinned: number;
  attachments: unknown;
  mentions: unknown;
  edited_at: Date | null;
  created_at: Date;
}

/**
 * Who was tagged in this note.
 *
 * Matched against the team by name rather than by a dropdown, because an
 * agent typing "@sara" in the middle of a sentence should not have to stop
 * and pick from a list. Names are matched longest-first so "@sara al mansoori"
 * does not match the "@sara" who is somebody else.
 */
export function findMentions(
  body: string,
  team: Array<{ id: string; name: string }>,
): string[] {
  const lower = body.toLowerCase();
  const found = new Set<string>();

  const byLength = [...team].sort((a, b) => b.name.length - a.name.length);
  for (const person of byLength) {
    const handle = `@${person.name.toLowerCase()}`;
    if (lower.includes(handle)) {
      found.add(person.id);
      continue;
    }
    /* Also the first name on its own, which is how people actually write it
       — but only when it is unambiguous across the team. */
    const first = person.name.split(/\s+/)[0]?.toLowerCase();
    if (!first || first.length < 3) continue;
    const sameFirst = team.filter((other) => other.name.toLowerCase().startsWith(first)).length;
    if (sameFirst === 1 && new RegExp(`@${first}\\b`).test(lower)) found.add(person.id);
  }
  return [...found];
}

/**
 * Which lead a note belongs to, deleted ones included.
 *
 * Every route that changes a note calls this first and checks the caller may
 * see that lead. Without it, a note id is enough: an agent could pin, or
 * restore, a note on a colleague's client, and notes are the most candid
 * thing in the CRM.
 */
export async function contactOfNote(
  noteId: string,
  exec: Executor = getPool(),
): Promise<string | null> {
  const row = await queryOne<{ contact_id: string }>(
    'SELECT contact_id FROM lead_notes WHERE id = ?',
    [noteId],
    exec,
  );
  return row?.contact_id ?? null;
}

export async function listNotes(
  contactId: string,
  exec: Executor = getPool(),
): Promise<NoteRow[]> {
  return query<NoteRow>(
    `SELECT n.id, n.contact_id, n.opportunity_id, n.author_id, u.name AS author_name,
            n.type, n.body, n.pinned, n.attachments, n.mentions, n.edited_at, n.created_at
       FROM lead_notes n
       LEFT JOIN users u ON u.id = n.author_id
      WHERE n.contact_id = ? AND n.deleted_at IS NULL
      ORDER BY n.pinned DESC, n.created_at DESC
      LIMIT 200`,
    [contactId],
    exec,
  );
}

export async function addNote(
  actor: AuditActor,
  input: {
    contactId: string;
    opportunityId?: string | null;
    type?: NoteType;
    body: string;
    pinned?: boolean;
    attachments?: Array<{ url: string; name: string; mime: string; size: number }> | null;
    /** When set, the note also becomes the lead's next step. */
    remindAt?: string | null;
  },
): Promise<{ id: string; mentions: string[]; movedStage: MoveStageResult | null }> {
  const body = input.body.trim();
  if (!body) throw Object.assign(new Error('A note needs something in it'), { status: 400 });

  const team = await query<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE is_active = 1 AND role <> 'automation'`,
  );
  const mentions = findMentions(body, team);
  const id = randomUUID();

  await execute(
    `INSERT INTO lead_notes (id, contact_id, opportunity_id, author_id, type, body, pinned, attachments, mentions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.contactId,
      input.opportunityId ?? null,
      actor.userId,
      input.type ?? 'general',
      body.slice(0, 5000),
      input.pinned ? 1 : 0,
      input.attachments?.length ? JSON.stringify(input.attachments) : null,
      mentions.length ? JSON.stringify(mentions) : null,
    ],
  );

  /*
   * A reminder written into a note is a promise like any other, so it goes on
   * the lead's next step rather than living only in the words. A note saying
   * "call him Thursday" that does not put Thursday anywhere is how Thursday
   * is missed.
   */
  if (input.remindAt && input.opportunityId) {
    await execute(
      `UPDATE opportunities
          SET next_step_type = 'call', next_step_at = ?, next_step_note = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [new Date(input.remindAt), body.slice(0, 255), input.opportunityId],
    );
  }

  for (const userId of mentions) {
    if (userId === actor.userId) continue;
    await notify({
      userId,
      type: 'mention',
      title: `${actor.label ?? 'Someone'} mentioned you in a note`,
      body: body.slice(0, 200),
      link: `/contacts/${input.contactId}`,
      contactId: input.contactId,
    }).catch((err: unknown) => logger.warn('could not notify a mention', errorContext(err)));
  }

  await writeAudit({
    actor,
    action: 'note.added',
    entityType: 'contact',
    entityId: input.contactId,
    after: { noteId: id, type: input.type ?? 'general', pinned: Boolean(input.pinned) },
  });

  /*
   * A note is evidence that somebody already tried, so a lead still sitting in
   * New Lead moves itself to Attempted Contact. `stageAfterNote` holds the
   * limits and the reasons; everything beyond New Lead is left alone.
   *
   * It goes through `moveStage` rather than an UPDATE, so the move is recorded
   * exactly like a move somebody made by hand — the activity on the timeline,
   * the audit row, the lead-quality event to Meta. A stage that changed with no
   * trail is a stage an agent cannot argue with.
   *
   * It never fails the note. The agent's words are the thing being saved; if
   * the stage cannot follow, that is worth a log line and nothing more.
   */
  const movedStage = await maybeAdvanceAfterNote(actor, input.opportunityId ?? null)
    .catch((err: unknown) => {
      logger.warn('note saved, but the stage did not follow', errorContext(err));
      return null;
    });

  return { id, mentions, movedStage };
}

/** New Lead → Attempted Contact, when a human writes a note on an open lead. */
async function maybeAdvanceAfterNote(
  actor: AuditActor,
  opportunityId: string | null,
): Promise<MoveStageResult | null> {
  if (!opportunityId) return null;

  const lead = await queryOne<{ stage_key: string; status: string }>(
    'SELECT stage_key, status FROM opportunities WHERE id = ? AND deleted_at IS NULL',
    [opportunityId],
  );
  if (!lead) return null;

  const next = stageAfterNote({
    stageKey: lead.stage_key,
    status: lead.status,
    authorRole: actor.role,
  });
  if (!next) return null;

  return moveStage({
    opportunityId,
    to: next.to,
    subStatus: next.subStatus,
    actor: { ...actor, role: actor.role as Role },
    actingUserId: actor.userId,
  });
}

/**
 * Edit, pin or remove a note.
 *
 * Only the author or the owner, and a delete is a timestamp — the same rule
 * as everywhere else. A note is somebody's record of a conversation, and a
 * manager quietly rewriting one is worse than leaving it wrong.
 */
export async function updateNote(
  actor: AuditActor,
  noteId: string,
  patch: { body?: string; pinned?: boolean; deleted?: boolean },
): Promise<boolean> {
  const note = await queryOne<{ author_id: string | null; contact_id: string }>(
    'SELECT author_id, contact_id FROM lead_notes WHERE id = ? AND deleted_at IS NULL',
    [noteId],
  );
  if (!note) return false;

  const isAuthor = note.author_id && note.author_id === actor.userId;
  const isOwner = actor.role === 'owner';
  /* Pinning is not editing: deciding which note matters on a shared lead is
     a judgement anyone working it can make. */
  const onlyPinning = patch.body === undefined && patch.deleted === undefined;
  if (!isAuthor && !isOwner && !onlyPinning) {
    throw Object.assign(new Error('Only the person who wrote a note can change it'), { status: 403 });
  }

  const sets: string[] = [];
  const args: Array<string | number | Date | null> = [];
  if (patch.body !== undefined) {
    sets.push('body = ?', 'edited_at = NOW(3)');
    args.push(patch.body.trim().slice(0, 5000));
  }
  if (patch.pinned !== undefined) {
    sets.push('pinned = ?');
    args.push(patch.pinned ? 1 : 0);
  }
  if (patch.deleted) sets.push('deleted_at = NOW(3)');
  if (sets.length === 0) return false;

  await execute(`UPDATE lead_notes SET ${sets.join(', ')} WHERE id = ?`, [...args, noteId]);
  await writeAudit({
    actor,
    action: patch.deleted ? 'note.deleted' : 'note.updated',
    entityType: 'contact',
    entityId: note.contact_id,
    after: { noteId, ...patch },
  });
  return true;
}

/** Put a deleted note back. The undo behind the toast. */
export async function restoreNote(actor: AuditActor, noteId: string): Promise<boolean> {
  const result = await execute(
    'UPDATE lead_notes SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL',
    [noteId],
  );
  if (result.affectedRows === 0) return false;
  await writeAudit({
    actor, action: 'note.restored', entityType: 'contact', entityId: null, after: { noteId },
  });
  return true;
}
