import { execute, query, queryOne, withTransaction } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { notify } from '../messaging/notify.js';
import { recordAssignment } from '../routing/assignments.js';
import type { SessionUser } from '../auth/sessions.js';
import { countedAgentSql } from '../users/counting.js';
import { dubaiDay, dubaiMinutes, startFor } from '../attendance/attendance.js';
import { attendanceSettings, type AttendanceSettings } from '../attendance/settings.js';

/**
 * Handing a lead to a colleague.
 *
 * The rules are the design's (pages.md §15) and every one of them exists to
 * stop a lead going quiet in the gap between two people:
 *
 *  - **The lead stays with the sender until the receiver accepts.** A lead in
 *    transit belonging to nobody is a lead nobody calls.
 *  - **A reason is required.** "Speaks Arabic" and "I have too many" are
 *    different problems, and the second one is the owner's to fix.
 *  - **Meeting and Offer need the owner first.** A lead that far along is a
 *    deal in progress, and two agents swapping it between themselves without
 *    the owner knowing is how one gets dropped.
 *  - **A VIP lead cannot be transferred at all.** It was given by name; it
 *    goes back to whoever gave it, not sideways.
 *  - **One open request per lead.** Two people cannot both be deciding.
 */

export const TRANSFER_REASONS = [
  'language', 'leave', 'client_asked', 'knows_project', 'too_many', 'other',
] as const;
export type TransferReason = (typeof TRANSFER_REASONS)[number];

/** The stages where the owner has to agree before the receiver even sees it. */
const NEEDS_OWNER = new Set(['appointment_scheduled', 'deal_sent']);

export interface Transfer {
  id: string;
  opportunityId: string;
  leadName: string | null;
  project: string | null;
  stage: string;
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  reason: TransferReason;
  note: string | null;
  status: string;
  requestedAt: Date;
  expiresAt: Date | null;
}

const SELECT = `
  SELECT t.id, t.opportunity_id AS opportunityId, c.full_name AS leadName,
         o.project_name AS project, o.stage_key AS stage,
         t.from_user_id AS fromUserId, uf.name AS fromName,
         t.to_user_id AS toUserId, ut.name AS toName,
         t.reason, t.note, t.status, t.requested_at AS requestedAt, t.expires_at AS expiresAt
    FROM lead_transfers t
    JOIN opportunities o ON o.id = t.opportunity_id
    JOIN contacts c ON c.id = o.contact_id
    JOIN users uf ON uf.id = t.from_user_id
    JOIN users ut ON ut.id = t.to_user_id`;

const row = (r: Record<string, unknown>): Transfer => ({
  id: String(r.id),
  opportunityId: String(r.opportunityId),
  leadName: (r.leadName as string | null) ?? null,
  project: (r.project as string | null) ?? null,
  stage: String(r.stage),
  fromUserId: String(r.fromUserId),
  fromName: String(r.fromName),
  toUserId: String(r.toUserId),
  toName: String(r.toName),
  reason: r.reason as TransferReason,
  note: (r.note as string | null) ?? null,
  status: String(r.status),
  requestedAt: r.requestedAt as Date,
  expiresAt: (r.expiresAt as Date | null) ?? null,
});

/** End of the working day in Dubai: a request nobody answers lapses then. */
function endOfDay(at: Date = new Date()): Date {
  const dubai = new Date(at.getTime() + 4 * 3_600_000);
  dubai.setUTCHours(18, 0, 0, 0);
  const out = new Date(dubai.getTime() - 4 * 3_600_000);
  return out > at ? out : new Date(out.getTime() + 86_400_000);
}

export async function listTransfers(user: SessionUser): Promise<{
  forMe: Transfer[]; iSent: Transfer[]; toApprove: Transfer[]; recent: Transfer[];
}> {
  const isOwner = user.role === 'owner' || user.role === 'admin';

  const [forMe, iSent, toApprove, recent] = await Promise.all([
    query<Record<string, unknown>>(
      `${SELECT} WHERE t.to_user_id = ? AND t.status = 'pending' ORDER BY t.requested_at DESC`,
      [user.id],
    ),
    query<Record<string, unknown>>(
      `${SELECT} WHERE t.from_user_id = ? AND t.status IN ('pending','needs_approval')
        ORDER BY t.requested_at DESC`,
      [user.id],
    ),
    isOwner
      ? query<Record<string, unknown>>(
        `${SELECT} WHERE t.status = 'needs_approval' ORDER BY t.requested_at ASC`,
      )
      : Promise.resolve([]),
    isOwner
      ? query<Record<string, unknown>>(
        `${SELECT} WHERE t.requested_at >= DATE_SUB(NOW(3), INTERVAL 7 DAY)
          ORDER BY t.requested_at DESC LIMIT 60`,
      )
      : Promise.resolve([]),
  ]);

  return {
    forMe: forMe.map(row),
    iSent: iSent.map(row),
    toApprove: toApprove.map(row),
    recent: recent.map(row),
  };
}

export async function askToTransfer(
  actor: AuditActor,
  user: SessionUser,
  input: { opportunityId: string; toUserId: string; reason: TransferReason; note?: string | null },
): Promise<Transfer> {
  if (input.toUserId === user.id) throw badRequest('That lead is already yours.');
  if (input.reason === 'other' && (input.note ?? '').trim().length < 5) {
    throw badRequest('Say why in a few words — "Other" on its own tells the next person nothing.');
  }

  const lead = await queryOne<{
    id: string; owner_user_id: string | null; stage_key: string; status: string; is_vip: number;
  }>(
    `SELECT id, owner_user_id, stage_key, status, is_vip
       FROM opportunities WHERE id = ? AND deleted_at IS NULL`,
    [input.opportunityId],
  );
  if (!lead) throw notFound('That lead is no longer there.');
  if (lead.status !== 'open') throw badRequest('That lead is closed.');
  if (lead.owner_user_id !== user.id) throw forbidden('You can only pass on your own leads.');
  if (Number(lead.is_vip) === 1) {
    throw badRequest(
      'A VIP lead cannot be passed sideways. Send it back to whoever gave it to you.',
    );
  }

  const open = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM lead_transfers
      WHERE opportunity_id = ? AND status IN ('pending','needs_approval')`,
    [input.opportunityId],
  );
  if (Number(open?.n) > 0) throw badRequest('Somebody is already deciding on that lead.');

  const to = await queryOne<{ id: string; name: string; is_active: number }>(
    'SELECT id, name, is_active FROM users WHERE id = ?', [input.toUserId],
  );
  if (!to || !to.is_active) throw badRequest('That person cannot take leads.');

  /* On leave today, so not selectable — the design is explicit, and a lead
     handed to somebody who is away is a lead nobody rings. */
  const away = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM leave_requests
      WHERE user_id = ? AND status = 'approved'
        AND DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00')) BETWEEN from_date AND to_date`,
    [input.toUserId],
  );
  if (Number(away?.n) > 0) throw badRequest(`${to.name} is on leave.`);

  const needsOwner = NEEDS_OWNER.has(lead.stage_key);
  const id = newId();
  await execute(
    `INSERT INTO lead_transfers
       (id, opportunity_id, from_user_id, to_user_id, reason, note, status, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.opportunityId, user.id, input.toUserId, input.reason,
      input.note ?? null, needsOwner ? 'needs_approval' : 'pending', endOfDay(),
    ],
  );

  if (needsOwner) {
    const owners = await query<{ id: string }>(
      "SELECT id FROM users WHERE is_active = 1 AND role IN ('owner','admin')",
    );
    for (const owner of owners) {
      await notify({
        userId: owner.id,
        type: 'mention',
        title: `${user.name} wants to pass a lead at ${lead.stage_key.replace(/_/g, ' ')}`,
        body: `To ${to.name}. It needs you first.`,
        link: '/v2/transfers',
        opportunityId: input.opportunityId,
        priority: 'high',
      }).catch(() => undefined);
    }
  } else {
    await notify({
      userId: input.toUserId,
      type: 'lead_assigned',
      title: `${user.name} wants to pass you a lead`,
      body: input.note ?? null,
      link: '/v2/transfers',
      opportunityId: input.opportunityId,
    }).catch(() => undefined);
  }

  await writeAudit({
    actor, action: 'transfer.asked', entityType: 'lead_transfer', entityId: id, after: input,
  });

  const made = await queryOne<Record<string, unknown>>(`${SELECT} WHERE t.id = ?`, [id]);
  return row(made as Record<string, unknown>);
}

async function load(id: string): Promise<Record<string, unknown>> {
  const got = await queryOne<Record<string, unknown>>(`${SELECT} WHERE t.id = ?`, [id]);
  if (!got) throw notFound('That request is no longer there.');
  return got;
}

/** The owner agreeing that a Meeting or Offer lead may move at all. */
export async function approveTransfer(
  actor: AuditActor,
  user: SessionUser,
  id: string,
  agree: boolean,
): Promise<Transfer> {
  const got = await load(id);
  if (got.status !== 'needs_approval') throw badRequest('That request is not waiting on you.');

  if (!agree) {
    await execute(
      "UPDATE lead_transfers SET status = 'refused', decided_at = NOW(3) WHERE id = ?", [id],
    );
    await notify({
      userId: String(got.fromUserId),
      type: 'mention',
      title: 'Your transfer was not approved',
      body: `${got.leadName ?? 'The lead'} stays with you.`,
      link: '/v2/transfers',
    }).catch(() => undefined);
  } else {
    await execute(
      `UPDATE lead_transfers
          SET status = 'pending', approved_by = ?, approved_at = NOW(3), expires_at = ?
        WHERE id = ?`,
      [user.id, endOfDay(), id],
    );
    await notify({
      userId: String(got.toUserId),
      type: 'lead_assigned',
      title: `${got.fromName} wants to pass you a lead`,
      body: 'The owner has agreed. It is yours if you accept.',
      link: '/v2/transfers',
      opportunityId: String(got.opportunityId),
    }).catch(() => undefined);
  }

  await writeAudit({
    actor, action: agree ? 'transfer.approved' : 'transfer.refused_by_owner',
    entityType: 'lead_transfer', entityId: id,
  });
  return row(await load(id));
}

/** The receiver's answer. Accepting is the moment the lead actually moves. */
export async function answerTransfer(
  actor: AuditActor,
  user: SessionUser,
  id: string,
  accept: boolean,
): Promise<Transfer> {
  const got = await load(id);
  if (String(got.toUserId) !== user.id) throw forbidden('That request is for somebody else.');
  if (got.status !== 'pending') throw badRequest('That request has already been answered.');

  if (!accept) {
    await execute(
      "UPDATE lead_transfers SET status = 'refused', decided_at = NOW(3) WHERE id = ?", [id],
    );
    await notify({
      userId: String(got.fromUserId),
      type: 'mention',
      title: `${user.name} did not take the lead`,
      body: `${got.leadName ?? 'The lead'} is still yours.`,
      link: `/v2/leads/${String(got.opportunityId)}`,
    }).catch(() => undefined);
  } else {
    const opportunityId = String(got.opportunityId);
    const lead = await queryOne<{ contact_id: string }>(
      'SELECT contact_id FROM opportunities WHERE id = ?', [opportunityId],
    );

    await withTransaction(async (tx) => {
      await execute(
        "UPDATE lead_transfers SET status = 'accepted', decided_at = NOW(3) WHERE id = ?", [id], tx,
      );
      await execute(
        `UPDATE opportunities
            SET owner_user_id = ?, assigned_at = NOW(3), accepted_at = NOW(3), returned_at = NULL
          WHERE id = ?`,
        [user.id, opportunityId], tx,
      );
      if (lead) {
        await execute('UPDATE contacts SET owner_user_id = ? WHERE id = ?',
          [user.id, lead.contact_id], tx);
        await execute('UPDATE conversations SET assigned_user_id = ? WHERE contact_id = ?',
          [user.id, lead.contact_id], tx);
        await recordAssignment(tx, {
          opportunityId,
          contactId: lead.contact_id,
          agentUserId: user.id,
          assignedByUserId: String(got.fromUserId),
        });
      }
    });

    await notify({
      userId: String(got.fromUserId),
      type: 'mention',
      title: `${user.name} took the lead`,
      body: `${got.leadName ?? 'The lead'} is theirs now.`,
      link: '/v2/transfers',
    }).catch(() => undefined);
  }

  await writeAudit({
    actor, action: accept ? 'transfer.accepted' : 'transfer.declined',
    entityType: 'lead_transfer', entityId: id,
  });
  return row(await load(id));
}

/** Taking your own request back, while nobody has answered it. */
export async function cancelTransfer(
  actor: AuditActor,
  user: SessionUser,
  id: string,
): Promise<{ cancelled: true }> {
  const got = await load(id);
  if (String(got.fromUserId) !== user.id) throw forbidden('That is somebody else’s request.');
  if (!['pending', 'needs_approval'].includes(String(got.status))) {
    throw badRequest('That request has already been answered.');
  }
  await execute(
    "UPDATE lead_transfers SET status = 'cancelled', decided_at = NOW(3) WHERE id = ?", [id],
  );
  await writeAudit({
    actor, action: 'transfer.cancelled', entityType: 'lead_transfer', entityId: id,
  });
  return { cancelled: true };
}

export interface CouldTakeIt {
  id: string;
  name: string;
  photoUrl: string | null;
  openLeads: number;
  /** The languages this person actually speaks, as their profile lists them. */
  languages: string[];
  /** `attendance.kind` for today: office, outside, or nothing yet. */
  markedToday: string | null;
  /** True when today's check-in landed after the grace minutes. */
  wasLate: boolean;
  /** How many minutes after the shift started, for "Late · 24 min". */
  lateMinutes: number | null;
  /** When they said they would be back, if they are out right now. */
  backBy: string | null;
  onLeave: boolean;
  /** Deals won this month, Dubai's month. */
  dealsThisMonth: number;
  /** Median seconds from being given a lead to touching it, last 90 days. */
  replySeconds: number | null;
  /** The desk's ceiling on open leads, where the person is on a desk. */
  maxOpenLeads: number | null;
}

/**
 * Who to offer it to, best first.
 *
 * "Best" is the design's order and not a score: people who can take it right
 * now, then whoever is holding the fewest leads. Somebody on leave is not
 * offered at all.
 *
 * Three things this used to get wrong, all of which the owner saw:
 *
 *  - **`u.locale AS language`.** That is which language the CRM's own buttons
 *    are in, not what the person speaks. With one locale in the office every
 *    row came back saying "en", so the language chips had one entry and the
 *    panel hid them altogether — on the one screen whose first question is
 *    "who speaks Russian". The real answer is `agent_profiles.languages`,
 *    which the profile page writes, falling back to `users.languages`, which
 *    the Users screen writes. `/api/v2/team` already read it that way; this
 *    did not.
 *  - **No status.** The design puts a chip on every card — In office, Late ·
 *    24 min, Outside until 16:00 — because "who can take it now" is the
 *    question, and a name with a number beside it does not answer it.
 *  - **No deals and no reply time.** They are the two figures that say
 *    whether handing this person a lead is a good idea.
 */
export async function whoCouldTakeIt(exceptUserId: string): Promise<CouldTakeIt[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT u.id, u.name, u.photo_url AS photoUrl,
            p.languages AS profileLanguages, u.languages AS userLanguages,
            a.kind AS markedToday, a.was_late AS wasLate, a.marked_at AS markedAt,
            MIN(t.back_by) AS backBy,
            MIN(d.max_open_leads) AS maxOpenLeads,
            r.reply_seconds AS replySeconds,
            (SELECT COUNT(*) FROM opportunities o
              WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL)
              AS openLeads,
            /* Won this month, counted over Dubai's month: the server runs on
               UTC and a deal closed at 02:00 on the 1st belongs to the new
               month for the person who closed it. */
            (SELECT COUNT(*) FROM opportunities o
              WHERE o.owner_user_id = u.id AND o.status = 'won' AND o.deleted_at IS NULL
                AND o.closed_at >= CONVERT_TZ(
                      DATE_FORMAT(CONVERT_TZ(NOW(3), '+00:00', '+04:00'), '%Y-%m-01'),
                      '+04:00', '+00:00'))
              AS dealsThisMonth,
            EXISTS (SELECT 1 FROM leave_requests l
                     WHERE l.user_id = u.id AND l.status = 'approved'
                       AND DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
                           BETWEEN l.from_date AND l.to_date) AS onLeave
       FROM users u
       LEFT JOIN agent_profiles p ON p.user_id = u.id
       LEFT JOIN attendance a ON a.user_id = u.id
            AND a.on_date = DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
       LEFT JOIN outside_trips t ON t.user_id = u.id
            AND t.on_date = DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
            AND t.returned_at IS NULL
       LEFT JOIN desk_members dm ON dm.user_id = u.id
       LEFT JOIN desks d ON d.id = dm.desk_id AND d.is_active = 1
       /*
        * How long this person usually takes to pick a lead up. The median,
        * not the average: one lead answered three days late drags a mean into
        * uselessness and says nothing about the usual day. The same measure
        * as the profile page's own speed-to-lead figure.
        */
       LEFT JOIN (
         SELECT owner_user_id, AVG(secs) AS reply_seconds FROM (
           SELECT o.owner_user_id,
                  TIMESTAMPDIFF(SECOND, o.assigned_at, o.first_touch_at) AS secs,
                  ROW_NUMBER() OVER (
                    PARTITION BY o.owner_user_id
                    ORDER BY TIMESTAMPDIFF(SECOND, o.assigned_at, o.first_touch_at)
                  ) AS seat,
                  COUNT(*) OVER (PARTITION BY o.owner_user_id) AS n
             FROM opportunities o
            WHERE o.assigned_at IS NOT NULL AND o.first_touch_at IS NOT NULL
              AND o.first_touch_at >= o.assigned_at
              AND o.assigned_at > DATE_SUB(NOW(3), INTERVAL 90 DAY)
              AND o.deleted_at IS NULL
         ) walk
          WHERE seat IN (FLOOR((n + 1) / 2), CEIL((n + 1) / 2))
          GROUP BY owner_user_id
       ) r ON r.owner_user_id = u.id
      WHERE u.is_active = 1 AND ${countedAgentSql()} AND u.id <> ?
      /* One row per person: the desk and trip joins can each match more. */
      GROUP BY u.id, u.name, u.photo_url, p.languages, u.languages,
               a.kind, a.was_late, a.marked_at, r.reply_seconds
      ORDER BY onLeave ASC, (a.kind IS NULL) ASC, openLeads ASC, u.name ASC`,
    [exceptUserId],
  );

  /* How late is late. The office's own start time, so the chip says the same
     thing the attendance register says. */
  const office = await attendanceSettings();

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    photoUrl: (r.photoUrl as string | null) ?? null,
    openLeads: Number(r.openLeads),
    languages: readLanguages(r.profileLanguages ?? r.userLanguages),
    markedToday: (r.markedToday as string | null) ?? null,
    wasLate: Number(r.wasLate ?? 0) === 1,
    lateMinutes: Number(r.wasLate ?? 0) === 1 && r.markedAt
      ? minutesLate(new Date(r.markedAt as string | Date), office)
      : null,
    /* mysql2 hands a DATETIME back as a Date; the cast says so rather than
       pretending it is a string that happens to parse. */
    backBy: r.backBy ? new Date(r.backBy as string | Date).toISOString() : null,
    onLeave: Number(r.onLeave ?? 0) === 1,
    dealsThisMonth: Number(r.dealsThisMonth ?? 0),
    replySeconds: r.replySeconds === null || r.replySeconds === undefined
      ? null
      : Math.round(Number(r.replySeconds)),
    maxOpenLeads: r.maxOpenLeads === null || r.maxOpenLeads === undefined
      ? null
      : Number(r.maxOpenLeads),
  }));
}

/** Minutes after the shift started, or null when the office keeps no hours. */
function minutesLate(markedAt: Date, office: AttendanceSettings): number | null {
  const start = startFor(dubaiDay(markedAt), office);
  if (start === null) return null;
  const late = dubaiMinutes(markedAt) - start;
  return late > 0 ? late : null;
}

/**
 * A language list that may be JSON or may be comma-separated.
 *
 * `agent_profiles.languages` has been written both ways over the life of this
 * app, and a screen that throws on the older shape is a screen that works
 * until somebody opens an old profile. `routes/v2.ts` reads it the same way.
 */
function readLanguages(value: unknown): string[] {
  const tidy = (list: unknown[]) => list.map(String).map((one) => one.trim()).filter(Boolean);
  if (Array.isArray(value)) return tidy(value);
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return tidy(parsed);
  } catch {
    /* Not JSON, so the older comma-separated form. */
  }
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}
