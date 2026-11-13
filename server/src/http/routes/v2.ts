import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requireRole,
} from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { agentHome, ownerHome, type Home } from '../../v2/home.js';
import { acceptVip, refuseVip } from '../../v2/vip.js';
import {
  answerTap, callQueue, CALL_OUTCOMES, finishCall, logTap, startCall, TAP_RESULTS,
} from '../../v2/calls.js';
import {
  agentsWithLoad, cameBack, freeLeads, shareLeads, takeLead,
} from '../../v2/incoming.js';
import { query, queryOne } from '../../db/client.js';
import { visibleUserIds } from '../../auth/scope.js';
import { leadTabCounts } from '../../leads/counts.js';
import {
  allLeave, answerLeave, askForLeave, cancelLeave, LEAVE_KINDS, leaveTakenThisYear, myLeave,
} from '../../v2/leave.js';
import { attendanceMonth, dayState, dubaiDate } from '../../attendance/attendance.js';
import { tasksInRange } from '../../services/tasks.js';
import { ownerPredicate } from '../../auth/scope.js';
import { execute } from '../../db/client.js';
import {
  NOTIFY_GROUPS, ALWAYS_ON, notifySettings, saveNotifySettings, saveSchema as notifySchema,
} from '../../v2/notify-prefs.js';
import { attendanceSettings } from '../../attendance/settings.js';
import { listAutomations } from '../../services/automations.js';
import { companyDetails, companyIssues } from '../../config/company.js';
import { monthSpend, usd } from '../../ai/usage.js';
import { pushReadiness } from '../../services/integration-status.js';
import { setupChecklist } from '../../services/setup-checklist.js';
import {
  createSheet, deleteDraft, getSheet, listSheets, markAccepted, markShared,
  patchSchema, sheetSchema, SHEET_TABS, updateSheet, type SheetTab,
} from '../../v2/offers.js';
import { newId } from '../../lib/ids.js';
import { writeAudit } from '../../audit/audit.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import {
  answerTransfer, approveTransfer, askToTransfer, cancelTransfer, listTransfers,
  TRANSFER_REASONS, whoCouldTakeIt,
} from '../../v2/transfers.js';

/**
 * The v2 screens' own endpoints.
 *
 * Mounted at `/api/v2` and deliberately separate from the live routes: the
 * CRM ten people use today keeps answering exactly as it did, and nothing
 * here can change that by accident. Where a v2 screen needs the same data as
 * a live one it calls the same service, not a copy of the query.
 */
export const v2Router = Router();
v2Router.use(requireAuth, blockUntilPasswordChanged);

/**
 * The address the office is seen from.
 *
 * The LAST entry of X-Forwarded-For, not the first: behind one reverse proxy
 * the last is the one the proxy appended and the only one a browser cannot
 * set itself. Same reading as `attendance.ts`, and for the same reason.
 */
function networkIp(req: Request): string | null {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((part) => part.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return req.ip ?? req.socket.remoteAddress ?? null;
}

/**
 * Home, shaped by who is asking.
 *
 * An agent gets their day; an owner gets the company's. Which one is decided
 * here from the session, never from a query parameter — there is no way to
 * ask for the owner's figures as an agent.
 */
v2Router.get(
  '/home',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const ip = networkIp(req);
    const home: Home = user.role === 'agent'
      ? await agentHome(user, ip)
      : await ownerHome(user, ip);
    res.json(home);
  }),
);

/* ── VIP leads ─────────────────────────────────────────────────────────── */

const vipLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyFor: (req) => `vip:${currentUser(req).id}`,
  message: 'Too many taps in a minute. Please wait a moment.',
});

/** "I have it." Stops the clock and tells whoever gave it. */
v2Router.post(
  '/vip/:id/accept',
  vipLimit,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await acceptVip(actorFrom(req), String(req.params.id), currentUser(req).id));
  }),
);

const refuseSchema = z.object({ note: z.string().max(500).nullable().optional() });

/**
 * "I can't take it." The lead goes back to the giver's Incoming.
 *
 * A note is optional but asked for on screen: "busy with a viewing" is what
 * makes the owner's next decision a good one, and an unexplained refusal is
 * the thing that makes them stop handing leads over personally at all.
 */
v2Router.post(
  '/vip/:id/refuse',
  vipLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { note } = refuseSchema.parse(req.body ?? {});
    res.json(await refuseVip(
      actorFrom(req), String(req.params.id), currentUser(req).id, note ?? null,
    ));
  }),
);

/* ── calling ───────────────────────────────────────────────────────────── */

/** The day's queue: the Today list, VIP first. */
v2Router.get(
  '/queue',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ items: await callQueue(currentUser(req)) });
  }),
);

const startSchema = z.object({
  opportunityId: z.string().min(1).max(36),
  source: z.enum(['lead', 'dialler', 'followup', 'incoming', 'other']).optional(),
  /*
   * The browser says whether the agent went ahead without checking in. It is
   * not trusted as a claim of innocence -- the server can only ever be told
   * "I was not checked in", never "I was" -- but it is the only place that
   * knows the agent pressed "Call anyway", and the owner is shown it.
   */
  notCheckedIn: z.boolean().optional(),
});

v2Router.post(
  '/calls',
  rateLimit({
    windowMs: 60_000,
    max: 60,
    keyFor: (req) => `call:${currentUser(req).id}`,
    message: 'That is a lot of calls in a minute. Please wait a moment.',
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const input = startSchema.parse(req.body);
    res.json(await startCall(actorFrom(req), currentUser(req), input));
  }),
);

const outcomeSchema = z.object({
  outcome: z.enum(CALL_OUTCOMES),
  note: z.string().max(500).nullable().optional(),
  callBackAt: z.string().min(4).max(40).nullable().optional(),
  reason: z.string().max(60).nullable().optional(),
});

/** What happened on the call. This is also what moves the lead. */
v2Router.patch(
  '/calls/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const input = outcomeSchema.parse(req.body);
    res.json(await finishCall(actorFrom(req), currentUser(req), String(req.params.id), input));
  }),
);

const tapSchema = z.object({
  opportunityId: z.string().min(1).max(36),
  app: z.enum(['whatsapp', 'telegram']),
  templateKey: z.string().max(80).nullable().optional(),
  text: z.string().max(4000).nullable().optional(),
});

/**
 * The agent tapped WhatsApp or Telegram.
 *
 * Recorded as a tap, never as a message sent: the CRM hands the agent over to
 * the real app and has no way of knowing what happened there. Asking
 * afterwards is the honest version, and it is what the design asks for.
 */
v2Router.post(
  '/taps',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await logTap(currentUser(req), tapSchema.parse(req.body)));
  }),
);

const answerSchema = z.object({
  result: z.enum(TAP_RESULTS),
  note: z.string().max(500).nullable().optional(),
});

v2Router.patch(
  '/taps/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const input = answerSchema.parse(req.body);
    res.json(await answerTap(actorFrom(req), currentUser(req), String(req.params.id), input));
  }),
);

/* ── incoming ──────────────────────────────────────────────────────────── */

/**
 * The free-lead queue.
 *
 * Both roles see the same leads; an owner also gets the people to hand them
 * to and the ones that bounced back to them. An agent is never sent the team
 * list — who else holds how many leads is not their business, and it is the
 * sort of thing that leaks into a conversation.
 */
v2Router.get(
  '/incoming',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const free = await freeLeads();
    if (user.role === 'agent') {
      res.json({ role: 'agent', free });
      return;
    }
    const [agents, back] = await Promise.all([agentsWithLoad(), cameBack(user.id)]);
    res.json({ role: 'owner', free, agents, cameBack: back });
  }),
);

/** "Take this lead." */
v2Router.post(
  '/incoming/:id/take',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await takeLead(actorFrom(req), currentUser(req), String(req.params.id)));
  }),
);

const shareSchema = z.object({
  opportunityIds: z.array(z.string().min(1).max(36)).min(1).max(500),
  agentUserIds: z.array(z.string().min(1).max(36)).min(1).max(50),
});

/** "Share the normal leads equally." VIP leads are never in the share. */
v2Router.post(
  '/incoming/share',
  requireRole('owner', 'admin', 'manager'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await shareLeads(actorFrom(req), shareSchema.parse(req.body)));
  }),
);

/* ── the numbers on the menu ───────────────────────────────────────────── */

/**
 * Every badge in the sidebar, in one answer.
 *
 * Five separate endpoints polled from five components is five requests per
 * page per person per minute, and the sidebar is on every screen. One row of
 * counts costs one round trip.
 *
 * Each number means the same thing the screen behind it shows, because they
 * are the same queries. A badge that says 3 over a list of 5 is worse than no
 * badge at all (docs/v2/rules.md S-25).
 */
v2Router.get(
  '/badges',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const isAgent = user.role === 'agent';
    const visible = await visibleUserIds(user);
    const [counts, free, transfers, tasks, leave] = await Promise.all([
      leadTabCounts(visible),
      queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM opportunities
          WHERE status = 'open' AND owner_user_id IS NULL AND deleted_at IS NULL`,
      ),
      queryOne<{ n: number }>(
        isAgent
          ? "SELECT COUNT(*) AS n FROM lead_transfers WHERE to_user_id = ? AND status = 'pending'"
          : "SELECT COUNT(*) AS n FROM lead_transfers WHERE status = 'needs_approval'",
        isAgent ? [user.id] : [],
      ),
      queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM tasks
          WHERE assigned_user_id = ? AND completed_at IS NULL AND due_at < NOW(3)`,
        [user.id],
      ),
      isAgent
        ? Promise.resolve({ n: 0 })
        : queryOne<{ n: number }>(
          "SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'",
        ),
    ]);

    res.json({
      incoming: Number(free?.n ?? 0),
      followups: counts.overdue,
      transfers: Number(transfers?.n ?? 0),
      tasks: Number(tasks?.n ?? 0),
      leave: Number(leave?.n ?? 0),
    });
  }),
);

/* ── attendance and leave ──────────────────────────────────────────────── */

/**
 * My own month.
 *
 * The live `/api/attendance/month` is owner-only, which is right for the team
 * grid — but it left an agent unable to see their own record at all. This one
 * is scoped to the caller and cannot be pointed at anybody else.
 */
v2Router.get(
  '/attendance/me',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const to = dubaiDate();
    const from = new Date(Date.parse(`${to}T00:00:00Z`) - 59 * 86_400_000)
      .toISOString().slice(0, 10);

    const [today, days, leave, taken] = await Promise.all([
      dayState(user.id, networkIp(req)),
      query<{ on_date: string; kind: string; was_late: number; note: string | null }>(
        `SELECT DATE_FORMAT(on_date, '%Y-%m-%d') AS on_date, kind, was_late, note
           FROM attendance
          WHERE user_id = ? AND on_date >= ?
          ORDER BY on_date DESC`,
        [user.id, from],
      ),
      myLeave(user.id),
      leaveTakenThisYear(user.id),
    ]);

    res.json({ today, from, to, days, leave, taken });
  }),
);

/** The team grid, and every leave request there is to answer. */
v2Router.get(
  '/attendance/team',
  requireRole('owner', 'admin', 'manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const to = dubaiDate();
    const from = new Date(Date.parse(`${to}T00:00:00Z`) - 13 * 86_400_000)
      .toISOString().slice(0, 10);
    const [month, leave] = await Promise.all([attendanceMonth(from, to), allLeave()]);
    /* `attendanceMonth` already carries its own from/to; spreading it after
       ours would silently win, so it goes first. */
    res.json({ ...month, from, to, leave });
  }),
);

const askSchema = z.object({
  kind: z.enum(LEAVE_KINDS),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().max(500).nullable().optional(),
});

v2Router.post(
  '/leave',
  asyncHandler(async (req: Request, res: Response) => {
    const input = askSchema.parse(req.body);
    res.status(201).json(await askForLeave(actorFrom(req), currentUser(req), input));
  }),
);

const answerLeaveSchema = z.object({
  status: z.enum(['approved', 'refused']),
  note: z.string().max(500).nullable().optional(),
});

v2Router.patch(
  '/leave/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = answerLeaveSchema.parse(req.body);
    res.json(await answerLeave(actorFrom(req), currentUser(req), String(req.params.id), input));
  }),
);

v2Router.post(
  '/leave/:id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await cancelLeave(actorFrom(req), currentUser(req), String(req.params.id)));
  }),
);

/* ── the calendar ──────────────────────────────────────────────────────── */

const calendarSchema = z.object({
  from: z.string().min(10).max(40),
  to: z.string().min(10).max(40),
  scope: z.enum(['mine', 'team']).default('mine'),
});

/**
 * Everything in a window: tasks and meetings together.
 *
 * Two tables, one answer, because a day with a viewing at four and a call at
 * five is one day to the person living it. The browser sends real instants
 * rather than dates — a task due at 23:30 belongs to the day it is 23:30 in
 * for whoever is looking, and only the browser knows that.
 */
v2Router.get(
  '/calendar',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const { from, to, scope } = calendarSchema.parse(req.query);
    const visible = await visibleUserIds(user);
    const ids = scope === 'mine' ? [user.id] : visible;
    const fence = ownerPredicate('m.user_id', ids);

    const [tasks, meetings] = await Promise.all([
      tasksInRange(user.id, visible, { from, to, scope: scope === 'mine' ? 'mine' : 'team' }),
      query<Record<string, unknown>>(
        `SELECT m.id, m.opportunity_id AS opportunityId, m.kind, m.title, m.starts_at AS startsAt,
                m.ends_at AS endsAt, m.all_day AS allDay, m.place, m.result, m.interest,
                c.full_name AS who, c.phone_e164 AS phone, u.name AS agent
           FROM meetings m
           LEFT JOIN contacts c ON c.id = m.contact_id
           JOIN users u ON u.id = m.user_id
          WHERE m.deleted_at IS NULL AND ${fence.sql}
            AND m.starts_at < ? AND m.ends_at > ?
          ORDER BY m.starts_at ASC
          LIMIT 500`,
        [...fence.params, to, from],
      ),
    ]);

    res.json({
      from,
      to,
      tasks,
      meetings: meetings.map((m) => ({
        id: String(m.id),
        opportunityId: (m.opportunityId as string | null) ?? null,
        kind: String(m.kind),
        title: (m.title as string | null) ?? null,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        allDay: Number(m.allDay ?? 0) === 1,
        place: (m.place as string | null) ?? null,
        result: (m.result as string | null) ?? null,
        interest: (m.interest as string | null) ?? null,
        who: (m.who as string | null) ?? null,
        phone: (m.phone as string | null) ?? null,
        agent: String(m.agent),
      })),
    });
  }),
);

const meetingSchema = z.object({
  opportunityId: z.string().max(36).nullable().optional(),
  contactId: z.string().max(36).nullable().optional(),
  kind: z.enum(['meeting', 'site_visit', 'call', 'follow_up', 'team']).default('meeting'),
  title: z.string().max(160).nullable().optional(),
  startsAt: z.string().min(10).max(40),
  endsAt: z.string().min(10).max(40),
  place: z.string().max(200).nullable().optional(),
});

/** Put something in the diary. It is always yours; there is no "for" field. */
v2Router.post(
  '/meetings',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const input = meetingSchema.parse(req.body);
    if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
      throw badRequest('It has to finish after it starts.');
    }

    const id = newId();
    await execute(
      `INSERT INTO meetings
         (id, opportunity_id, contact_id, user_id, kind, title, starts_at, ends_at, place, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, input.opportunityId ?? null, input.contactId ?? null, user.id, input.kind,
        input.title ?? null, new Date(input.startsAt), new Date(input.endsAt),
        input.place ?? null, user.id,
      ],
    );
    await writeAudit({
      actor: actorFrom(req), action: 'meeting.added', entityType: 'meeting', entityId: id,
      after: input,
    });
    res.status(201).json({ id });
  }),
);

const resultSchema = z.object({
  result: z.enum(['showed', 'no_show', 'rescheduled', 'booked', 'cancelled']),
  note: z.string().max(500).nullable().optional(),
  interest: z.enum(['hot', 'warm', 'cold']).nullable().optional(),
});

/**
 * How the meeting went.
 *
 * Asked for rather than assumed: a meeting in the diary with no result is the
 * single thing an owner cannot read a week later, and "it happened" is not
 * the same as "they came".
 */
v2Router.patch(
  '/meetings/:id/result',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const input = resultSchema.parse(req.body);
    const id = String(req.params.id);

    const meeting = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM meetings WHERE id = ? AND deleted_at IS NULL', [id],
    );
    if (!meeting) throw notFound('That meeting is no longer there.');
    if (meeting.user_id !== user.id && user.role === 'agent') {
      throw forbidden('That is somebody else’s meeting.');
    }

    await execute(
      `UPDATE meetings
          SET result = ?, result_note = ?, interest = ?, result_at = NOW(3)
        WHERE id = ?`,
      [input.result, input.note ?? null, input.interest ?? null, id],
    );
    await writeAudit({
      actor: actorFrom(req), action: 'meeting.result', entityType: 'meeting', entityId: id,
      after: input,
    });
    res.json({ saved: true });
  }),
);

/* ── transfers ─────────────────────────────────────────────────────────── */

v2Router.get(
  '/transfers',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await listTransfers(currentUser(req)));
  }),
);

/** Who this lead could go to, best first. */
v2Router.get(
  '/transfers/who',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ items: await whoCouldTakeIt(currentUser(req).id) });
  }),
);

const askTransferSchema = z.object({
  opportunityId: z.string().min(1).max(36),
  toUserId: z.string().min(1).max(36),
  reason: z.enum(TRANSFER_REASONS),
  note: z.string().max(500).nullable().optional(),
});

v2Router.post(
  '/transfers',
  asyncHandler(async (req: Request, res: Response) => {
    const input = askTransferSchema.parse(req.body);
    res.status(201).json(await askToTransfer(actorFrom(req), currentUser(req), input));
  }),
);

/** The receiver's answer. Accepting is the moment the lead moves. */
v2Router.post(
  '/transfers/:id/answer',
  asyncHandler(async (req: Request, res: Response) => {
    const { accept } = z.object({ accept: z.boolean() }).parse(req.body);
    res.json(await answerTransfer(actorFrom(req), currentUser(req), String(req.params.id), accept));
  }),
);

/** The owner agreeing a Meeting or Offer lead may move at all. */
v2Router.post(
  '/transfers/:id/approve',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const { agree } = z.object({ agree: z.boolean() }).parse(req.body);
    res.json(await approveTransfer(actorFrom(req), currentUser(req), String(req.params.id), agree));
  }),
);

v2Router.post(
  '/transfers/:id/cancel',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await cancelTransfer(actorFrom(req), currentUser(req), String(req.params.id)));
  }),
);

/* ── the team ──────────────────────────────────────────────────────────── */

/**
 * Who everybody is.
 *
 * Readable by everybody, because an agent who has just joined needs to know
 * who speaks Russian and who covers Abu Dhabi — that is the whole point of
 * the screen. What an agent is **not** given is how many leads each colleague
 * is holding or how they are performing: that is the owner's to see, and it
 * is the sort of number that turns a directory into a league table in the
 * canteen.
 */
v2Router.get(
  '/team',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const isOwner = user.role !== 'agent';

    const rows = await query<Record<string, unknown>>(
      /* `job_title`, `brn` and `languages` live on `users`; the profile table
         holds the written-up version of a person. Both are read here. */
      `SELECT u.id, u.name, u.email, u.role, u.photo_url AS photoUrl, u.title,
              u.job_title AS jobTitle, u.languages AS userLanguages,
              p.headline, p.languages, p.specialities,
              p.public_phone AS phone, p.whatsapp,
              a.kind AS markedToday,
              EXISTS (SELECT 1 FROM leave_requests l
                       WHERE l.user_id = u.id AND l.status = 'approved'
                         AND DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
                             BETWEEN l.from_date AND l.to_date) AS onLeave,
              ${isOwner
    ? `(SELECT COUNT(*) FROM opportunities o
          WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL)`
    : 'NULL'} AS openLeads
         FROM users u
         LEFT JOIN agent_profiles p ON p.user_id = u.id
         LEFT JOIN attendance a ON a.user_id = u.id
              AND a.on_date = DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
        WHERE u.is_active = 1 AND u.role <> 'automation'
        ORDER BY FIELD(u.role, 'owner', 'admin', 'manager', 'agent'), u.name`,
    );

    res.json({
      items: rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        email: isOwner ? String(r.email) : null,
        role: String(r.role),
        photoUrl: (r.photoUrl as string | null) ?? null,
        title: (r.jobTitle as string | null) ?? (r.title as string | null) ?? null,
        headline: (r.headline as string | null) ?? null,
        languages: readList(r.languages ?? r.userLanguages),
        specialities: readList(r.specialities),
        phone: (r.phone as string | null) ?? null,
        whatsapp: (r.whatsapp as string | null) ?? null,
        markedToday: (r.markedToday as string | null) ?? null,
        onLeave: Number(r.onLeave ?? 0) === 1,
        openLeads: r.openLeads === null ? null : Number(r.openLeads),
      })),
      canSeeNumbers: isOwner,
    });
  }),
);

/* ── sales offers ──────────────────────────────────────────────────────── */

/**
 * The offer sheets.
 *
 * `design/web/sales-offers.html`. Everything is scoped by the session's role
 * inside the service, so there is no parameter here that widens what anybody
 * can see — `agent` filters within what the caller may already read.
 */
v2Router.get(
  '/offers',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const asked = String(req.query.tab ?? 'all');
    const tab = (SHEET_TABS as readonly string[]).includes(asked) ? (asked as SheetTab) : 'all';
    res.json(await listSheets({ id: user.id, role: user.role }, {
      tab,
      search: req.query.q ? String(req.query.q) : undefined,
      projectId: req.query.project ? String(req.query.project) : undefined,
      agentUserId: req.query.agent ? String(req.query.agent) : undefined,
    }));
  }),
);

v2Router.get(
  '/offers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json(await getSheet({ id: user.id, role: user.role }, String(req.params.id)));
  }),
);

v2Router.post(
  '/offers',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const made = await createSheet(
      { ...actorFrom(req), id: user.id, role: user.role },
      sheetSchema.parse(req.body),
    );
    res.status(201).json(made);
  }),
);

v2Router.patch(
  '/offers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json(await updateSheet(
      { ...actorFrom(req), id: user.id, role: user.role },
      String(req.params.id),
      patchSchema.parse(req.body),
    ));
  }),
);

/* Shared and accepted are two separate facts, so they are two routes rather
   than one status field a client could set to anything. */
v2Router.post(
  '/offers/:id/shared',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json(await markShared(
      { ...actorFrom(req), id: user.id, role: user.role }, String(req.params.id),
    ));
  }),
);

v2Router.post(
  '/offers/:id/accepted',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json(await markAccepted(
      { ...actorFrom(req), id: user.id, role: user.role }, String(req.params.id),
    ));
  }),
);

v2Router.delete(
  '/offers/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json(await deleteDraft(
      { ...actorFrom(req), id: user.id, role: user.role }, String(req.params.id),
    ));
  }),
);

/**
 * The leads and projects the new-offer form chooses between.
 *
 * Only open leads this person may work, so an agent's list is their own. One
 * request rather than two, because the form needs both before it can be used.
 */
v2Router.get(
  '/offers-form',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const scope = ownerPredicate('o.owner_user_id', await visibleUserIds(user));
    const [leads, projects] = await Promise.all([
      query<{ id: string; name: string; project: string | null; projectId: string | null }>(
        `SELECT o.id, c.full_name AS name, p.name AS project, o.project_id AS projectId
           FROM opportunities o
           JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
           LEFT JOIN projects p ON p.id = o.project_id
          WHERE ${scope.sql} AND o.status = 'open'
          ORDER BY o.updated_at DESC
          LIMIT 300`,
        scope.params,
      ),
      query<{ id: string; name: string; priceFrom: string | number | null }>(
        /* The design shows "The Archive starts from AED 1.6M" under the price
           field, so the form needs the starting price with the name. */
        `SELECT id, name, starting_price_aed AS priceFrom FROM projects
          WHERE archived_at IS NULL ORDER BY name LIMIT 200`,
        [],
      ),
    ]);
    res.json({
      leads,
      /* BIGINT arrives as a string from mysql2 once it is large enough. */
      projects: projects.map((row) => ({
        ...row, priceFrom: row.priceFrom === null ? null : Number(row.priceFrom),
      })),
    });
  }),
);

/* ── the line under each office shortcut ───────────────────────────────── */

/**
 * The numbers the Settings → General shortcuts show.
 *
 * `design/web/settings.html` puts a live fact under each office link — "13
 * people · 9 have notifications on", "$38 of $100 used this month" — rather
 * than a description. That is the difference between a menu and a dashboard,
 * and it is the reason an owner opens the right page instead of all eight.
 *
 * One endpoint rather than eight requests from one card. Owner and admin
 * only, because every number in it is one an agent cannot act on.
 */
v2Router.get(
  '/settings-summary',
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const [attendance, automations, company, spend, push, setup] = await Promise.all([
      attendanceSettings(),
      listAutomations(),
      companyDetails(),
      monthSpend(),
      pushReadiness(),
      setupChecklist(),
    ]);

    res.json({
      people: push.agentsTotal,
      /* "Notifications on" means a device is registered. The server having
         credentials is a separate matter, and the health page's problem. */
      notifyOn: push.agentsTotal - push.agentsWithoutDevice,
      attendance: {
        enabled: attendance.enabled,
        start: attendance.start,
        end: attendance.end,
        graceMinutes: attendance.graceMinutes,
      },
      automations: {
        on: automations.filter((one) => one.isActive).length,
        total: automations.length,
      },
      company: { missing: companyIssues(company).length },
      ai: { spentUsd: usd(spend.micros), capUsd: usd(spend.capMicros) },
      /* The setup checklist is the honest version of "system health": it
         counts the things that are switched on, from the same places the
         features read. */
      health: { ok: setup.items.length - setup.outstanding, total: setup.items.length },
    });
  }),
);

/* ── what each person wants to hear about ──────────────────────────────── */

/**
 * My notification settings.
 *
 * Scoped to the caller by construction: the user id comes from the session,
 * so there is no route here by which one person reads or writes another's.
 * The groups are sent with the values so the screen does not carry its own
 * copy of the list — a switch added on the server appears on screen without
 * a matching frontend change, and cannot drift out of step with what the
 * server actually honours.
 */
v2Router.get(
  '/notify',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json({
      ...(await notifySettings(user.id)),
      groups: Object.entries(NOTIFY_GROUPS).map(([key, group]) => ({
        key,
        title: group.title,
        forRole: group.forRole,
        switches: Object.entries(group.switches).map(([id, one]) => ({
          id,
          title: one.title,
          note: one.note,
          alwaysOn: ALWAYS_ON.has(id),
        })),
      })),
    });
  }),
);

v2Router.put(
  '/notify',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json(await saveNotifySettings(user.id, notifySchema.parse(req.body)));
  }),
);

/**
 * A list column that may be JSON or may be a comma-separated string.
 *
 * `agent_profiles.languages` has been written both ways over the life of this
 * app, and a screen that throws on the older shape is a screen that works
 * until somebody opens an old profile.
 */
function readList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* Not JSON, so the older comma-separated form. */
  }
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}
