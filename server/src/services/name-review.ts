/**
 * Finding and repairing contacts whose name is not a name.
 *
 * The importer no longer creates these (see `imports/names.ts`), but the leads
 * imported before that fix are already in the database, and an agent opening
 * the inbox sees "Katalog" and "2pm / 6pm" where a customer's name should be.
 *
 * Deliberately *not* a migration that runs on start. Rewriting a column across
 * every contact in a live CRM, silently, at deploy time, is the kind of thing
 * that is only ever noticed when it was wrong. So: a manager sees the list and
 * the reason for each one, presses a button, and every change is audited.
 *
 * Repair keeps the value. The name goes to null — which makes the inbox fall
 * back to the phone number, the thing an agent actually needs — and the old
 * text is written to the contact's timeline, because "I am on holiday till
 * 25.05, 9am to 8pm Cyprus time" is the most useful sentence in that lead's
 * whole record.
 */
import { execute, getPool, query, type Executor } from '../db/client.js';
import { ownerPredicate } from '../auth/scope.js';
import { notAName } from '../imports/names.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { newId } from '../lib/ids.js';

export type SuspectName = {
  id: string;
  full_name: string;
  phone_e164: string | null;
  email: string | null;
  owner_name: string | null;
  created_at: string;
  /** Why it was flagged, in words, so the list is reviewable rather than magic. */
  reason: string;
};

/**
 * Contacts whose stored name fails the same test the importer now applies.
 *
 * The filtering happens here rather than in SQL because the test knows about
 * form answers in six languages, keyboard mashing and sentence structure —
 * none of which is expressible in a WHERE clause worth reading. The candidate
 * set is narrowed in SQL first (a name that is set at all), and the cap keeps
 * one screen's worth of work on one screen.
 */
export async function findSuspectNames(
  visible: string[] | null,
  limit = 500,
  exec: Executor = getPool(),
): Promise<SuspectName[]> {
  const owner = ownerPredicate('c.owner_user_id', visible);
  const rows = await query<Omit<SuspectName, 'reason'>>(
    `SELECT c.id, c.full_name, c.phone_e164, c.email, c.created_at, u.name AS owner_name
       FROM contacts c
       LEFT JOIN users u ON u.id = c.owner_user_id
      WHERE ${owner.sql}
        AND c.full_name IS NOT NULL
        AND c.full_name <> ''
      ORDER BY c.created_at DESC
      LIMIT 5000`,
    owner.params,
    exec,
  );

  const suspects: SuspectName[] = [];
  for (const row of rows) {
    const reason = notAName(row.full_name);
    if (reason === false) continue;
    suspects.push({ ...row, reason });
    if (suspects.length >= limit) break;
  }
  return suspects;
}

export type RepairResult = { repaired: number; skipped: number };

/**
 * Clear the names that are not names, keeping the text on the timeline.
 *
 * `ids` is required rather than optional: "fix everything you think is wrong"
 * is a different and more dangerous instruction than "fix these, which I have
 * just read". The caller passes back the list it showed.
 */
export async function repairNames(
  actor: AuditActor,
  ids: string[],
  visible: string[] | null,
  exec: Executor = getPool(),
): Promise<RepairResult> {
  if (ids.length === 0) return { repaired: 0, skipped: 0 };

  const owner = ownerPredicate('c.owner_user_id', visible);
  const rows = await query<{ id: string; full_name: string | null }>(
    `SELECT c.id, c.full_name FROM contacts c
      WHERE ${owner.sql} AND c.id IN (${ids.map(() => '?').join(',')})`,
    [...owner.params, ...ids],
    exec,
  );

  let repaired = 0;
  let skipped = 0;

  for (const row of rows) {
    /*
     * Re-checked here, not trusted from the request. Otherwise a stale screen —
     * or a hand-made request — could clear the name of a contact somebody had
     * since corrected by hand, which is the one outcome this whole feature is
     * supposed to prevent.
     */
    const reason = notAName(row.full_name);
    if (reason === false || !row.full_name) {
      skipped += 1;
      continue;
    }

    await execute('UPDATE contacts SET full_name = NULL WHERE id = ?', [row.id], exec);
    await execute(
      `INSERT INTO activities (id, contact_id, user_id, type, title, body)
       VALUES (?, ?, ?, 'note', ?, ?)`,
      [
        newId(),
        row.id,
        actor.userId,
        'Name cleared — it was a form answer',
        `The name field held "${row.full_name}" (${reason}). It came from a lead-form answer rather than the name question, so it has been cleared and kept here instead.`,
      ],
      exec,
    );
    await writeAudit(
      {
        actor,
        action: 'contact.name_repaired',
        entityType: 'contact',
        entityId: row.id,
        before: { fullName: row.full_name },
        after: { fullName: null, reason },
      },
      exec,
    );
    repaired += 1;
  }

  return { repaired, skipped };
}
