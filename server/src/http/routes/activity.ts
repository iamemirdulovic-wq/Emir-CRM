import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requirePermission,
} from '../middleware/auth.js';
import { visibleUserIds } from '../../auth/scope.js';
import { execute, query, queryOne } from '../../db/client.js';
import { writeAudit } from '../../audit/audit.js';
import { heartbeat } from '../../activity/track.js';
import { hashToken } from '../../lib/crypto.js';
import { describeLastSeen, isLive, LIVE_WITHIN_MS, type SessionFlag } from '../../activity/flags.js';
import { doNowCards, greet, allClearMessage } from '../../activity/do-now.js';
import { notFound } from '../../lib/errors.js';
import { buildOwnerSummary } from '../../activity/owner-summary.js';
import { gatherSummaryNumbers, yesterdayInDubai } from '../../activity/send-owner-summary.js';

/**
 * Who is working, and what the person looking should do next.
 *
 * Team Activity is owner and manager only, and a manager sees their own team.
 * Where somebody signed in from is personal data about a colleague, not a
 * company noticeboard.
 */
export const activityRouter = Router();
activityRouter.use(requireAuth, blockUntilPasswordChanged);

/* ── The heartbeat ──────────────────────────────────────────────────────── */

const beatSchema = z.object({ path: z.string().max(160).nullable().optional() });

/**
 * The browser saying it is still there, every thirty seconds.
 *
 * Deliberately cheap and deliberately silent: it returns nothing, so a flaky
 * connection costs one failed request that nobody has to handle.
 */
activityRouter.post(
  '/beat',
  asyncHandler(async (req: Request, res: Response) => {
    const body = beatSchema.parse(req.body ?? {});
    /* The row's key is the hash of the cookie's token — requireAuth puts
       the token on the request, never the hash. */
    const token = req.sessionToken;
    if (token) await heartbeat(hashToken(token), body.path ?? null);
    res.status(204).end();
  }),
);

/* ── The agent's own morning ────────────────────────────────────────────── */

/**
 * What this person should do next, counted on the server.
 *
 * Every count is fenced to what the viewer may see, so an agent's numbers are
 * their own leads. Nothing is counted twice — a lead that is both hot and
 * overdue appears in the more urgent bucket only, because two cards for one
 * lead is how a list stops being trusted.
 */
activityRouter.get(
  '/do-now',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const visible = await visibleUserIds(user);
    const fence = visible === null
      ? { sql: '1 = 1', params: [] as string[] }
      : visible.length === 0
        ? { sql: '1 = 0', params: [] as string[] }
        : { sql: `o.owner_user_id IN (${visible.map(() => '?').join(',')})`, params: visible };

    const row = await queryOne<Record<string, number>>(
      `SELECT
         /* Assigned, untouched, and the five-minute clock still running. */
         SUM(CASE WHEN o.stage_key = 'new_lead' AND o.last_contact_at IS NULL
                   AND o.created_at > DATE_SUB(NOW(3), INTERVAL 5 MINUTE)
                  THEN 1 ELSE 0 END) AS sla_running_out,
         /* Promised for earlier and not done. Excludes the ones above so a
            lead is never counted twice. */
         SUM(CASE WHEN o.next_step_at IS NOT NULL AND o.next_step_at < NOW(3)
                   AND NOT (o.stage_key = 'new_lead' AND o.last_contact_at IS NULL
                            AND o.created_at > DATE_SUB(NOW(3), INTERVAL 5 MINUTE))
                  THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN o.score_band = 'hot' AND o.last_contact_at IS NULL
                   AND (o.next_step_at IS NULL OR o.next_step_at >= NOW(3))
                   AND NOT (o.stage_key = 'new_lead'
                            AND o.created_at > DATE_SUB(NOW(3), INTERVAL 5 MINUTE))
                  THEN 1 ELSE 0 END) AS hot_never_called,
         SUM(CASE WHEN o.next_step_at IS NOT NULL AND o.next_step_at >= NOW(3)
                   AND DATE(CONVERT_TZ(o.next_step_at, '+00:00', '+04:00'))
                     = DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
                  THEN 1 ELSE 0 END) AS due_today,
         SUM(CASE WHEN o.next_step_at IS NULL AND o.status = 'open'
                   AND o.stage_key NOT IN ('won','lost')
                  THEN 1 ELSE 0 END) AS no_next_step
       FROM opportunities o
      WHERE o.deleted_at IS NULL AND o.status = 'open' AND ${fence.sql}`,
      fence.params,
    );

    /* Unanswered inbound is a different table, so it is its own query rather
       than a join that would multiply the counts above. */
    const waiting = await queryOne<{ n: number }>(
      `SELECT COUNT(DISTINCT c.id) AS n
         FROM conversations c
         JOIN contacts ct ON ct.id = c.contact_id
        WHERE ct.deleted_at IS NULL
          AND c.unread_count > 0
          AND ${visible === null ? '1 = 1' : visible.length === 0 ? '1 = 0'
    : `c.assigned_user_id IN (${visible.map(() => '?').join(',')})`}`,
      visible === null ? [] : visible,
    );

    const counts = {
      slaRunningOut: Number(row?.sla_running_out ?? 0),
      overdue: Number(row?.overdue ?? 0),
      hotNeverCalled: Number(row?.hot_never_called ?? 0),
      repliedWaiting: Number(waiting?.n ?? 0),
      dueToday: Number(row?.due_today ?? 0),
      noNextStep: Number(row?.no_next_step ?? 0),
    };

    const firstName = user.name.trim().split(/\s+/)[0] ?? null;
    const cards = doNowCards(counts);

    res.json({
      greeting: greet(firstName),
      cards,
      counts,
      ...(cards.length === 0 ? { allClear: allClearMessage(firstName) } : {}),
    });
  }),
);

/**
 * The insight card at the top of the owner's dashboard.
 *
 * The numbers are queries; nothing here is generated. The AI layer, when it
 * is switched on, is allowed to rephrase these lines and nothing else — it
 * never sees a number it could change and never invents one. With AI off,
 * which is the default, the card still works, because a card that is empty
 * until somebody adds an API key is a card nobody ever sees.
 */
activityRouter.get(
  '/insight',
  requirePermission('reports:team'),
  asyncHandler(async (_req: Request, res: Response) => {
    const numbers = await gatherSummaryNumbers();
    const summary = buildOwnerSummary(numbers, yesterdayInDubai());
    res.json({
      lines: summary.lines,
      quiet: summary.quiet,
      /* Said out loud in the UI so nobody mistakes counted facts for a
         machine's opinion. */
      source: 'Counted from your own data',
    });
  }),
);

/**
 * This agent's week, and where they stand.
 *
 * The rank is deliberately coarse — a position out of the active agents, not
 * a score. A leaderboard with a number next to every name turns a team into
 * a scoreboard, and the agent in last place stops opening the dashboard.
 * Knowing roughly where you are is motivating; knowing you are 7th by 3
 * points is not.
 */
activityRouter.get(
  '/my-week',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);

    const mine = await queryOne<{
      contacted: number; appointments: number; won: number; new_leads: number;
    }>(
      `SELECT
         COUNT(DISTINCT CASE WHEN a.type IN ('call_logged','whatsapp_sent','email_sent','message_sent')
                             THEN a.contact_id END) AS contacted,
         COUNT(DISTINCT CASE WHEN a.type = 'meeting_booked' THEN a.contact_id END) AS appointments,
         COUNT(DISTINCT CASE WHEN a.type = 'deal_won' THEN a.contact_id END) AS won,
         0 AS new_leads
       FROM activities a
      WHERE a.user_id = ? AND a.created_at > DATE_SUB(NOW(3), INTERVAL 7 DAY)`,
      [user.id],
    );

    const leads = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM opportunities
        WHERE owner_user_id = ? AND deleted_at IS NULL
          AND created_at > DATE_SUB(NOW(3), INTERVAL 7 DAY)`,
      [user.id],
    );

    /* Everybody's contacted count this week, so a position can be worked out
       without sending the whole table to the browser. */
    const board = await query<{ user_id: string; n: number }>(
      `SELECT a.user_id, COUNT(DISTINCT a.contact_id) AS n
         FROM activities a
         JOIN users u ON u.id = a.user_id
        WHERE u.role = 'agent' AND u.is_active = 1
          AND a.type IN ('call_logged','whatsapp_sent','email_sent','message_sent')
          AND a.created_at > DATE_SUB(NOW(3), INTERVAL 7 DAY)
        GROUP BY a.user_id
        ORDER BY n DESC`,
    );

    const position = board.findIndex((row) => row.user_id === user.id);

    res.json({
      contacted: Number(mine?.contacted ?? 0),
      appointments: Number(mine?.appointments ?? 0),
      won: Number(mine?.won ?? 0),
      newLeads: Number(leads?.n ?? 0),
      rank: position >= 0 ? position + 1 : null,
      outOf: board.length,
    });
  }),
);

/* ── Team activity ──────────────────────────────────────────────────────── */

interface LiveRow {
  user_id: string;
  name: string;
  role: string;
  availability: string;
  device_label: string | null;
  city: string | null;
  country: string | null;
  current_path: string | null;
  last_seen_at: Date;
}

activityRouter.get(
  '/team',
  requirePermission('reports:team'),
  asyncHandler(async (req: Request, res: Response) => {
    const visible = await visibleUserIds(currentUser(req));
    const fence = visible === null
      ? { sql: '1 = 1', params: [] as string[] }
      : visible.length === 0
        ? { sql: '1 = 0', params: [] as string[] }
        : { sql: `u.id IN (${visible.map(() => '?').join(',')})`, params: visible };

    /* One row per person, from their most recent session — a colleague with
       three tabs open is one person working, not three. */
    const rows = await query<LiveRow>(
      `SELECT u.id AS user_id, u.name, u.role, u.availability,
              s.device_label, s.city, s.country, s.current_path, s.last_seen_at
         FROM users u
         JOIN sessions s ON s.id = (
           SELECT s2.id FROM sessions s2
            WHERE s2.user_id = u.id AND s2.expires_at > NOW(3)
            ORDER BY s2.last_seen_at DESC LIMIT 1
         )
        WHERE u.is_active = 1 AND ${fence.sql}
        ORDER BY s.last_seen_at DESC`,
      fence.params,
    );

    const now = new Date();
    res.json({
      liveWithinMs: LIVE_WITHIN_MS,
      items: rows.map((row) => ({
        userId: row.user_id,
        name: row.name,
        role: row.role,
        availability: row.availability,
        device: row.device_label,
        where: [row.city, row.country].filter(Boolean).join(', ') || null,
        doing: row.current_path,
        live: isLive(new Date(row.last_seen_at), now),
        lastSeen: describeLastSeen(new Date(row.last_seen_at), now),
        lastSeenAt: row.last_seen_at,
      })),
    });
  }),
);

/** The sign-in history, newest first, with anything odd marked. */
activityRouter.get(
  '/sessions',
  requirePermission('reports:team'),
  asyncHandler(async (req: Request, res: Response) => {
    const visible = await visibleUserIds(currentUser(req));
    const onlyFlagged = req.query.flagged === '1';
    const fence = visible === null
      ? { sql: '1 = 1', params: [] as string[] }
      : visible.length === 0
        ? { sql: '1 = 0', params: [] as string[] }
        : { sql: `sl.user_id IN (${visible.map(() => '?').join(',')})`, params: visible };

    const rows = await query<{
      id: string; name: string; device_label: string | null; city: string | null;
      country: string | null; flags: unknown; level: string; signed_in_at: Date;
      signed_out_at: Date | null; active_seconds: number;
    }>(
      `SELECT sl.id, u.name, sl.device_label, sl.city, sl.country, sl.flags, sl.level,
              sl.signed_in_at, sl.signed_out_at, sl.active_seconds
         FROM session_log sl
         JOIN users u ON u.id = sl.user_id
        WHERE ${fence.sql} ${onlyFlagged ? "AND sl.level <> 'none'" : ''}
        ORDER BY sl.signed_in_at DESC
        LIMIT 200`,
      fence.params,
    );

    res.json({
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        device: row.device_label,
        where: [row.city, row.country].filter(Boolean).join(', ') || null,
        level: row.level,
        flags: parseFlags(row.flags),
        signedInAt: row.signed_in_at,
        signedOutAt: row.signed_out_at,
        activeMinutes: Math.round(Number(row.active_seconds) / 60),
      })),
    });
  }),
);

function parseFlags(value: unknown): SessionFlag[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as SessionFlag[];
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return Array.isArray(parsed) ? (parsed as SessionFlag[]) : [];
  } catch {
    return [];
  }
}

/**
 * When somebody works, as a grid of day against hour.
 *
 * Built from the sign-in log rather than from leads, so it answers "is this
 * person actually working the hours they say" rather than "did they get
 * lucky with leads this week".
 */
activityRouter.get(
  '/heatmap',
  requirePermission('reports:team'),
  asyncHandler(async (req: Request, res: Response) => {
    const visible = await visibleUserIds(currentUser(req));
    const userId = typeof req.query.userId === 'string' ? req.query.userId : null;

    const allowed = visible === null || (userId !== null && visible.includes(userId));
    if (userId && !allowed) throw notFound('That person is not on your team');

    const fence = visible === null
      ? { sql: '1 = 1', params: [] as string[] }
      : visible.length === 0
        ? { sql: '1 = 0', params: [] as string[] }
        : { sql: `sl.user_id IN (${visible.map(() => '?').join(',')})`, params: visible };

    const rows = await query<{ dow: number; hour: number; minutes: number }>(
      /* Dubai time, so the grid matches the working day people recognise. */
      `SELECT DAYOFWEEK(CONVERT_TZ(sl.signed_in_at, '+00:00', '+04:00')) AS dow,
              HOUR(CONVERT_TZ(sl.signed_in_at, '+00:00', '+04:00')) AS hour,
              ROUND(SUM(sl.active_seconds) / 60) AS minutes
         FROM session_log sl
        WHERE ${fence.sql}
          ${userId ? 'AND sl.user_id = ?' : ''}
          AND sl.signed_in_at > DATE_SUB(NOW(3), INTERVAL 28 DAY)
        GROUP BY dow, hour`,
      userId ? [...fence.params, userId] : fence.params,
    );

    res.json({ cells: rows.map((row) => ({ day: Number(row.dow) - 1, hour: Number(row.hour), minutes: Number(row.minutes) })) });
  }),
);

/**
 * End somebody's sessions.
 *
 * Owner and admin only, and audited. The reason is required because the one
 * question asked afterwards is always "why was I signed out", and an audit
 * row that cannot answer it is not much of an audit row.
 */
const forceOutSchema = z.object({ reason: z.string().min(3).max(160) });

activityRouter.post(
  '/sign-out/:userId',
  requirePermission('users:manage'),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.params.userId);
    const body = forceOutSchema.parse(req.body);

    const target = await queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [userId]);
    if (!target) throw notFound('That person does not exist');

    await execute(
      "UPDATE session_log SET signed_out_at = NOW(3) WHERE user_id = ? AND signed_out_at IS NULL",
      [userId],
    );
    const result = await execute('DELETE FROM sessions WHERE user_id = ?', [userId]);

    await writeAudit({
      actor: actorFrom(req),
      action: 'auth.force_sign_out',
      entityType: 'user',
      entityId: userId,
      after: { reason: body.reason, sessions: result.affectedRows },
    });

    res.json({ ok: true, endedSessions: result.affectedRows, name: target.name });
  }),
);

/* ── The audit log ──────────────────────────────────────────────────────── */

/**
 * Everything that has been done, newest first.
 *
 * Owner only. The audit log carries before-and-after values from every table,
 * so being able to read it is close to being able to read everything.
 */
activityRouter.get(
  '/audit',
  requirePermission('audit:read'),
  asyncHandler(async (req: Request, res: Response) => {
    const action = typeof req.query.action === 'string' ? req.query.action : null;
    const actor = typeof req.query.actor === 'string' ? req.query.actor : null;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = 50;

    const where: string[] = ['1 = 1'];
    const args: Array<string | number> = [];
    if (action) {
      where.push('a.action = ?');
      args.push(action);
    }
    if (actor) {
      where.push('a.actor_user_id = ?');
      args.push(actor);
    }
    if (search) {
      where.push('(a.actor_label LIKE ? OR a.entity_id LIKE ? OR a.action LIKE ?)');
      args.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const items = await query(
      `SELECT a.id, a.actor_user_id, a.actor_role, a.actor_label, a.action,
              a.entity_type, a.entity_id, a.before_json, a.after_json, a.ip, a.created_at,
              u.name AS actor_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.created_at DESC
        LIMIT ? OFFSET ?`,
      [...args, pageSize, (page - 1) * pageSize],
    );

    /* The distinct actions, so the filter offers what is actually there
       rather than a hard-coded list that goes stale. */
    const actions = await query<{ action: string; n: number }>(
      `SELECT action, COUNT(*) AS n FROM audit_log
        WHERE created_at > DATE_SUB(NOW(3), INTERVAL 90 DAY)
        GROUP BY action ORDER BY n DESC LIMIT 60`,
    );

    res.json({ items, actions, page, pageSize });
  }),
);
