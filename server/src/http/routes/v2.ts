import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { schemaState } from '../../db/migration-state.js';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requireRole,
} from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  agentHome, ownerHome, HOME_PERIODS, type Home, type HomePeriod,
} from '../../v2/home.js';
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
  officeRules, saveOfficeRules, saveSchema as rulesSchema,
} from '../../v2/office-rules.js';
import {
  answerFeedback, answerSchema as feedbackAnswerSchema, attachToFeedback, feedbackCsv,
  feedbackFile, feedbackInbox, myFeedback, sendFeedback, sendSchema, type FeedbackStatus,
} from '../../v2/feedback.js';
import {
  BANNER_LABELS, BANNER_OPENS, BANNER_ROTATE_SECONDS, MAX_BANNERS, MAX_BANNER_IMAGE_BYTES,
  bannerImage, bannerSchema, createBanner, deleteBanner, listBanners, reorderBanners,
  saveBannerImage, updateBanner,
} from '../../v2/banners.js';
import { remindAboutAlerts, teamRoles } from '../../v2/team-roles.js';
import { runChecks, serviceHistory } from '../../v2/health-checks.js';
import { websiteConnection } from '../../services/integration-status.js';
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
import { messagingReport, openQuestions, PERIODS, type Period } from '../../v2/messaging.js';
import {
  fullDashboard, movePool, PERIODS as DASH_PERIODS, type Period as DashPeriod,
} from '../../v2/dashboard.js';
import { teamLive } from '../../v2/live.js';
import { createDesk, deleteDesk, listDesks, updateDesk } from '../../v2/desks.js';
import { notify } from '../../messaging/notify.js';
import { listLibrary } from '../../services/project-library.js';
import {
  ASKED_BY, createPlan, deletePlan, movePlan, openReceipt, PLAN_KINDS, PLAN_RESULTS,
  planFor, saveReceipt, savePlanResult,
} from '../../v2/meetings.js';
import { contentDisposition, decodeFilename } from './tasks.js';
import { env } from '../../config/env.js';

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
 *
 * `?period=` moves the owner's calls and meetings-and-units cards and nothing
 * else. An unknown period reads as today rather than failing, because the only
 * way to send one is to type it into the address.
 */
v2Router.get(
  '/home',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const ip = networkIp(req);
    const asked = String(req.query.period ?? 'today');
    const period = (HOME_PERIODS as readonly string[]).includes(asked)
      ? (asked as HomePeriod) : 'today';
    const home: Home = user.role === 'agent'
      ? await agentHome(user, ip)
      : await ownerHome(user, ip, period);
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

    const [today, days, leave, taken, answerers] = await Promise.all([
      dayState(user.id, networkIp(req)),
      /*
       * `marked_at` as well as the date.
       *
       * `design/web/attendance.html` puts the check-in time in every cell of
       * the week strip and the month grid, and the Late tile reads "1 · Wed 4
       * Nov · 8 min" — none of which can be worked out from a date and a
       * late flag. The column has always been there; this read left it out,
       * so every cell showed a word instead of a time.
       */
      query<{ on_date: string; kind: string; marked_at: Date; was_late: number; note: string | null }>(
        `SELECT DATE_FORMAT(on_date, '%Y-%m-%d') AS on_date, kind, marked_at, was_late, note
           FROM attendance
          WHERE user_id = ? AND on_date >= ?
          ORDER BY on_date DESC`,
        [user.id, from],
      ),
      myLeave(user.id),
      leaveTakenThisYear(user.id),
      /*
       * Who answers a leave request, by name.
       *
       * The design says "Emir or George answers" — the real names, because
       * "an owner answers" is the sentence that makes an agent ask a
       * colleague who that is. First names only, of the people who can
       * actually answer, and every one of them is on the Team page anyway.
       */
      query<{ name: string }>(
        `SELECT name FROM users
          WHERE is_active = 1 AND role IN ('owner','admin')
          ORDER BY role = 'owner' DESC, name
          LIMIT 4`,
      ),
    ]);

    res.json({
      today,
      from,
      to,
      days,
      leave,
      taken,
      answerers: answerers.map((one) => one.name.split(' ')[0]).filter(Boolean),
    });
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
        `SELECT m.id, m.opportunity_id AS opportunityId, m.contact_id AS contactId,
                m.kind, m.title, m.starts_at AS startsAt,
                m.ends_at AS endsAt, m.all_day AS allDay, m.place, m.result, m.interest,
                m.result_note AS resultNote, m.result_by AS resultBy,
                m.reminder_minutes AS reminderMinutes,
                m.booked_project AS bookedProject,
                m.booked_unit AS bookedUnit, m.booked_price_aed AS bookedPriceAed,
                m.booked_paid_aed AS bookedPaidAed, m.receipt_name AS receiptName,
                m.user_id AS userId,
                /* How many times this lead has not turned up, all of them, so
                   the no-show form can say "No-show 2" and mean it. */
                (SELECT COUNT(*) FROM meetings x
                  WHERE x.opportunity_id = m.opportunity_id
                    AND x.result = 'no_show' AND x.deleted_at IS NULL) AS noShows,
                c.full_name AS who, c.phone_e164 AS phone, u.name AS agent,
                o.project_name AS project, o.unit_type AS unitType
           FROM meetings m
           LEFT JOIN contacts c ON c.id = m.contact_id
           LEFT JOIN opportunities o ON o.id = m.opportunity_id
           JOIN users u ON u.id = m.user_id
          WHERE m.deleted_at IS NULL AND ${fence.sql}
            AND m.starts_at < ? AND m.ends_at > ?
          ORDER BY m.starts_at ASC
          LIMIT 500`,
        /*
         * `Date`, never the raw `…T00:00:00.000Z` string the browser sent.
         *
         * MySQL 8 takes that literal, warns 1292 "Incorrect datetime value"
         * and truncates it to the right instant, so this worked here and in
         * every test. MariaDB — which is what runs in production, see the KPI
         * 500 in CHANGELOG — refuses it outright, which is why the calendar
         * returned "Internal server error" for every person on every device
         * while the whole suite stayed green. `tasksInRange`, the other half
         * of this same handler, already passed Dates; only this query did not.
         */
        [...fence.params, new Date(to), new Date(from)],
      ),
    ]);

    res.json({
      from,
      to,
      tasks,
      meetings: meetings.map((m) => ({
        id: String(m.id),
        opportunityId: (m.opportunityId as string | null) ?? null,
        contactId: (m.contactId as string | null) ?? null,
        kind: String(m.kind),
        title: (m.title as string | null) ?? null,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        allDay: Number(m.allDay ?? 0) === 1,
        place: (m.place as string | null) ?? null,
        result: (m.result as string | null) ?? null,
        resultNote: (m.resultNote as string | null) ?? null,
        /* Who asked to move it, or who cancelled. */
        resultBy: (m.resultBy as string | null) ?? null,
        interest: (m.interest as string | null) ?? null,
        reminderMinutes: m.reminderMinutes === null || m.reminderMinutes === undefined
          ? null : Number(m.reminderMinutes),
        bookedProject: (m.bookedProject as string | null) ?? null,
        bookedUnit: (m.bookedUnit as string | null) ?? null,
        bookedPriceAed: m.bookedPriceAed === null || m.bookedPriceAed === undefined
          ? null : Number(m.bookedPriceAed),
        bookedPaidAed: m.bookedPaidAed === null || m.bookedPaidAed === undefined
          ? null : Number(m.bookedPaidAed),
        /* Whether a booking form is on file. The file itself is served, with
           its own permission check, by `/meetings/:id/receipt`. */
        receiptName: (m.receiptName as string | null) ?? null,
        noShows: Number(m.noShows ?? 0),
        who: (m.who as string | null) ?? null,
        phone: (m.phone as string | null) ?? null,
        wants: [m.project, m.unitType].filter(Boolean).join(' · ') || null,
        agent: String(m.agent),
        /* Whose plan it is, so the screen knows if it may be changed. */
        mine: String(m.userId) === user.id,
      })),
    });
  }),
);

const meetingSchema = z.object({
  opportunityId: z.string().max(36).nullable().optional(),
  contactId: z.string().max(36).nullable().optional(),
  kind: z.enum(PLAN_KINDS).default('meeting'),
  title: z.string().max(160).nullable().optional(),
  startsAt: z.string().min(10).max(40),
  endsAt: z.string().min(10).max(40),
  /* A plan that runs over several days. `endsAt` is then the midnight after
     the last day, so the window query returns it on every day it covers. */
  allDay: z.boolean().optional(),
  place: z.string().max(200).nullable().optional(),
  reminderMinutes: z.number().int().min(0).max(1440).nullable().optional(),
});

/**
 * Put something in the diary. It is always yours; there is no "for" field.
 *
 * The two rules the screen also applies, applied here so they are real: a
 * meeting, a site visit or a call belongs to a lead, and nothing can be
 * planned in the past. A refusal names the field that is wrong.
 */
v2Router.post(
  '/meetings',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const input = meetingSchema.parse(req.body);
    const id = await createPlan(actorFrom(req), user, input);
    res.status(201).json({ id });
  }),
);

const movedSchema = z.object({
  startsAt: z.string().min(10).max(40),
  endsAt: z.string().min(10).max(40),
});

/**
 * "Change day or time".
 *
 * The one thing the calendar could not do: a plan was writable once and then
 * frozen, so a viewing moved by an hour had to be deleted -- which it also
 * could not be -- and planned again.
 */
v2Router.patch(
  '/meetings/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const input = movedSchema.parse(req.body);
    await movePlan(actorFrom(req), currentUser(req), String(req.params.id), input);
    res.json({ saved: true });
  }),
);

/** Delete a plan. Soft: the lead's history still says it was planned. */
v2Router.delete(
  '/meetings/:id',
  asyncHandler(async (req: Request, res: Response) => {
    await deletePlan(actorFrom(req), currentUser(req), String(req.params.id));
    res.json({ deleted: true });
  }),
);

/* ── the booking form, which an owner checks before a deal counts ──────── */

/**
 * The body is the file itself, with its name in a header -- the same shape
 * every other upload in the CRM uses, so there is no multipart parser and no
 * buffering a whole request twice.
 */
v2Router.post(
  '/meetings/:id/receipt',
  rateLimit({
    max: 60,
    windowMs: 10 * 60 * 1000,
    keyFor: (req) => `meeting-receipt:${currentUser(req).id}`,
    message: 'Too many uploads in a short time. Please wait a few minutes.',
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const id = String(req.params.id);
    /* Checked before a byte is read, so a file for somebody else's plan is
       refused rather than uploaded and then rejected. */
    await planFor(user, id);

    const contentType = (req.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    const limit = env().MAX_ATTACHMENT_MB * 1024 * 1024;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) {
        throw badRequest(`That file is larger than the ${env().MAX_ATTACHMENT_MB} MB limit.`);
      }
      chunks.push(chunk as Buffer);
    }

    const saved = await saveReceipt(actorFrom(req), user, id, {
      filename: decodeFilename(req.get('x-filename')),
      contentType,
      body: Buffer.concat(chunks),
    });
    res.status(201).json(saved);
  }),
);

/** The booking form back again. Never served statically: it is a client's. */
v2Router.get(
  '/meetings/:id/receipt',
  asyncHandler(async (req: Request, res: Response) => {
    const file = await openReceipt(currentUser(req), String(req.params.id));
    res.setHeader('Content-Type', file.contentType);
    if (file.bytes > 0) res.setHeader('Content-Length', String(file.bytes));
    res.setHeader(
      'Content-Disposition',
      contentDisposition(file.inline ? 'inline' : 'attachment', file.name),
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    file.stream.pipe(res);
  }),
);

const resultSchema = z.object({
  result: z.enum(PLAN_RESULTS),
  note: z.string().max(500).nullable().optional(),
  interest: z.enum(['hot', 'warm', 'cold']).nullable().optional(),
  /** Who asked: "Moved it" and "Cancelled" both need an answer. */
  by: z.enum(ASKED_BY).nullable().optional(),
  /** Where "Moved it" moves it to. The plan moves; it does not finish. */
  movedTo: movedSchema.nullable().optional(),
  /** The next thing in the diary. Required after "They came". */
  next: z.object({
    kind: z.enum(PLAN_KINDS),
    title: z.string().max(160).nullable().optional(),
    startsAt: z.string().min(10).max(40),
    endsAt: z.string().min(10).max(40),
    place: z.string().max(200).nullable().optional(),
  }).nullable().optional(),
  /** What they booked. Required after "They booked", receipt included. */
  booked: z.object({
    project: z.string().max(160).nullable().optional(),
    unit: z.string().trim().min(1).max(80),
    priceAed: z.number().int().min(1).max(10_000_000_000),
    paidAed: z.number().int().min(0).max(10_000_000_000),
  }).nullable().optional(),
});

/**
 * How the meeting went.
 *
 * Five answers, and each one asks for something: how interested and what is
 * next, the new day and time, who cancelled, the unit and the receipt. The
 * endpoint used to take a single word and drop the rest on the floor, so a
 * week later nobody could say what any meeting had produced.
 */
v2Router.patch(
  '/meetings/:id/result',
  asyncHandler(async (req: Request, res: Response) => {
    const input = resultSchema.parse(req.body);
    res.json(await savePlanResult(
      actorFrom(req), currentUser(req), String(req.params.id), input,
    ));
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

/**
 * Team and roles, the owner's administrative view.
 *
 * Separate from `/team` above, and from `GET /api/users`, because those two
 * are read by every screen that needs a colleague's name and so cannot be
 * shut. This one carries email addresses, last sign-ins, open-lead counts and
 * whose phone is registered for alerts, and is owner and admin only — on the
 * server, not only in the nav. `web/src/v2/settings/Team.tsx` is its screen.
 */
v2Router.get(
  '/team/roles',
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await teamRoles());
  }),
);

/**
 * "Remind" — the button beside somebody with no phone registered.
 *
 * It writes "Turn on notifications" into their bell, which My Day reads. It
 * does not send a push, because the whole reason they are on this list is
 * that a push cannot reach them.
 */
v2Router.post(
  '/team/remind-alerts',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({
      userIds: z.array(z.string().max(36)).min(1).max(50),
    }).parse(req.body);
    res.json(await remindAboutAlerts(actorFrom(req), body.userIds));
  }),
);

/* ── feedback ──────────────────────────────────────────────────────────── */

/**
 * "Report a bug or an idea."
 *
 * Anybody may send one and see their own. The inbox and the replies are the
 * owner's: an agent reading everybody's complaints is not what this is for.
 */
v2Router.post(
  '/feedback',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.status(201).json(await sendFeedback(user.id, sendSchema.parse(req.body)));
  }),
);

v2Router.get(
  '/feedback/mine',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json({ items: await myFeedback(user.id) });
  }),
);

v2Router.get(
  '/feedback',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const asked = String(req.query.filter ?? 'all');
    const known = ['all', 'blocking', 'new', 'planned', 'fixed', 'declined'];
    res.json(await feedbackInbox(
      (known.includes(asked) ? asked : 'all') as FeedbackStatus | 'all' | 'blocking',
    ));
  }),
);

/**
 * "Export file" — the whole inbox as a spreadsheet.
 *
 * The design's toast names an .xlsx; this is a CSV, which Excel and Numbers
 * both open and which needs nothing installed on the server. The button says
 * CSV so nobody is told otherwise. `docs/decisions-to-confirm.md`.
 */
v2Router.get(
  '/feedback/export.csv',
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const csv = await feedbackCsv();
    const stamp = new Date(Date.now() + 4 * 3_600_000)
      .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .replace(' ', '-');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="feedback-${stamp}.csv"`);
    /* Excel reads a CSV as the machine's own code page unless it finds this. */
    res.send(`﻿${csv}`);
  }),
);

/**
 * A screenshot or a voice note on a report.
 *
 * The bytes come up as the request body with the type in the header, the same
 * way every other upload in this CRM works. Everybody may attach to their own
 * report; an owner may attach to anybody's.
 */
v2Router.post(
  '/feedback/:id/:kind(screenshot|voice)',
  rateLimit({
    max: 20,
    windowMs: 10 * 60 * 1000,
    keyFor: (req) => `feedback-file:${currentUser(req).id}`,
    message: 'Too many attachments in a short time. Wait a few minutes.',
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const kind = String(req.params.kind) as 'screenshot' | 'voice';
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      /* Refused as it arrives rather than after the whole thing is in memory. */
      if (size > 2 * 1024 * 1024) throw badRequest('That file is larger than 2 MB.');
      chunks.push(chunk as Buffer);
    }
    const seconds = Number(req.get('x-duration-seconds'));
    res.status(201).json(await attachToFeedback(actorFrom(req), String(req.params.id), {
      userId: user.id,
      kind,
      contentType: req.get('content-type') ?? '',
      body: Buffer.concat(chunks),
      seconds: Number.isFinite(seconds) ? seconds : null,
    }));
  }),
);

v2Router.get(
  '/feedback/:id/:kind(screenshot|voice)',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const { file, contentType } = await feedbackFile(
      String(req.params.id),
      String(req.params.kind) as 'screenshot' | 'voice',
      { id: user.id, role: user.role },
    );
    res.setHeader('Content-Type', contentType);
    /* Never cached by a shared cache: it can carry a client's name. */
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(file);
  }),
);

v2Router.patch(
  '/feedback/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json(await answerFeedback(
      { ...actorFrom(req), id: user.id }, String(req.params.id),
      feedbackAnswerSchema.parse(req.body),
    ));
  }),
);

/* ── the banners on My Day ─────────────────────────────────────────────── */

v2Router.get(
  '/banners',
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    /* The desks come with them: the form's "One desk" picker needs the real
       list, and a desk typed by hand is a banner nobody sees. */
    res.json({
      items: await listBanners(),
      desks: await listDesks(),
      labels: BANNER_LABELS,
      opens: BANNER_OPENS,
      max: MAX_BANNERS,
      rotateSeconds: BANNER_ROTATE_SECONDS,
    });
  }),
);

v2Router.post(
  '/banners',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    res.status(201).json(await createBanner(actorFrom(req), bannerSchema.parse(req.body)));
  }),
);

v2Router.patch(
  '/banners/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateBanner(
      actorFrom(req), String(req.params.id), bannerSchema.partial().parse(req.body),
    ));
  }),
);

v2Router.delete(
  '/banners/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await deleteBanner(actorFrom(req), String(req.params.id)));
  }),
);

/**
 * The banner's picture.
 *
 * Owner and admin to change it; everybody may fetch it, because My Day draws
 * it for every agent and an image the page cannot load is a blank card.
 */
v2Router.post(
  '/banners/:id/image',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BANNER_IMAGE_BYTES) throw badRequest('That picture is larger than 4 MB.');
      chunks.push(chunk as Buffer);
    }
    res.status(201).json(await saveBannerImage(
      actorFrom(req), String(req.params.id), req.get('content-type') ?? '', Buffer.concat(chunks),
    ));
  }),
);

v2Router.get(
  '/banners/:id/image',
  asyncHandler(async (req: Request, res: Response) => {
    const { file, contentType } = await bannerImage(String(req.params.id));
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(file);
  }),
);

v2Router.post(
  '/banners/order',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ ids: z.array(z.string().max(36)).max(20) }).parse(req.body);
    res.json({ items: await reorderBanners(actorFrom(req), body.ids) });
  }),
);

/* ── is anything actually working ──────────────────────────────────────── */

/**
 * System health.
 *
 * `design/web/system-health.html`. Every one of these fails silently and
 * separately — email answers inside a conversation nobody is reading, push
 * has no devices so the five-minute rule only works while the CRM is open —
 * so the point of the screen is that they are counted in one place, from the
 * same places the features themselves read.
 */
v2Router.get(
  '/health',
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const [report, setup, website, push, schema] = await Promise.all([
      serviceHistory(), setupChecklist(), websiteConnection(), pushReadiness(), schemaState(),
    ]);
    res.json({
      /*
       * The state of the database schema, and when this server started.
       *
       * Here because the calendar was broken on the live site for days and
       * the reason -- a migration failing on every boot, blocking every
       * migration behind it -- went only to a log nobody outside the server
       * can read. It was guessed at three times and got wrong twice. These
       * four numbers answer it without guessing: which build is running,
       * whether the schema is up to date, what is stuck, and why.
       */
      schema,
      /* The six the design draws, each with its thirty days of recorded
         checks. `setup` is the separate "what has never been switched on"
         list, kept because email and WhatsApp templates are on it and are
         not services this page measures. */
      ...report,
      setup: setup.items,
      setupOutstanding: setup.outstanding,
      website,
      push,
    });
  }),
);

/**
 * "Run a check now."
 *
 * The same six checks the `health.check` job runs every five minutes, run on
 * demand and written down the same way, so pressing the button adds a sample
 * rather than showing a different number from a different place.
 */
v2Router.post(
  '/health/check',
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    await runChecks();
    res.json(await serviceHistory());
  }),
);

/* ── what the CRM does on its own ──────────────────────────────────────── */

/**
 * The office's rules.
 *
 * Everyone may read them — an agent whose lead went back deserves to know the
 * rule that took it — and only an owner or admin may move a switch.
 */
v2Router.get(
  '/rules',
  /* Shut to agents with the rest of the Automations page. It used to be open
     on the grounds that "an agent whose lead went back deserves to know the
     rule that took it" — which is true, and is why the take-back message
     says what happened. Reading the owner's switch panel is a different
     thing. Noted in docs/decisions-to-confirm.md. */
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await officeRules());
  }),
);

v2Router.patch(
  '/rules',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await saveOfficeRules(actorFrom(req), rulesSchema.parse(req.body)));
  }),
);

/**
 * The leads that went back today.
 *
 * The take-back rule's own receipts. A rule with a number beside it is a rule
 * somebody can judge; a switch on its own is a leap of faith.
 */
v2Router.get(
  '/rules/taken-back',
  requireRole('owner', 'admin', 'manager'),
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await query<{
      id: string; name: string; project: string | null; isVip: number;
      returnedAt: string; agentName: string | null; source: string | null;
    }>(
      /* `source` so the row can say "· import", which is how the design
         tells the two take-back clocks apart on sight. */
      `SELECT o.id,
              c.full_name    AS name,
              o.project_name AS project,
              o.is_vip       AS isVip,
              o.returned_at  AS returnedAt,
              o.source       AS source,
              u.name         AS agentName
         FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
         LEFT JOIN users u ON u.id = o.owner_user_id
        WHERE o.returned_at IS NOT NULL
          AND o.returned_at >= DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
        ORDER BY o.returned_at DESC
        LIMIT 20`,
      [],
    );
    res.json({
      items: rows.map((row) => ({ ...row, isVip: Number(row.isVip) === 1 })),
    });
  }),
);

/* ── desks ─────────────────────────────────────────────────────────────── */

/**
 * Desks: `design/web/desks.html`.
 *
 * Owner and admin only, every one of them, because a desk is how the office
 * is arranged and the limit on it is a management number. The nav hides the
 * page from everybody else; these are what actually refuse.
 */
const deskSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /* The design offers 40, 50, 60 and 80. The column takes any number and the
     screen may later let one be typed, so the range is generous and null is
     "no limit set". */
  maxOpenLeads: z.number().int().min(1).max(500).nullable(),
  memberIds: z.array(z.string().max(36)).max(200),
});

v2Router.get(
  '/desks',
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await listDesks());
  }),
);

v2Router.post(
  '/desks',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = deskSchema.parse(req.body);
    res.status(201).json(await createDesk(actorFrom(req), body));
  }),
);

v2Router.patch(
  '/desks/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = deskSchema.partial().parse(req.body);
    await updateDesk(actorFrom(req), String(req.params.id), body);
    res.json({ ok: true });
  }),
);

v2Router.delete(
  '/desks/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    await deleteDesk(actorFrom(req), String(req.params.id));
    res.json({ ok: true });
  }),
);

/* ── what the team is doing right now ──────────────────────────────────── */

/**
 * Today's clicks, by hour and by agent.
 *
 * `design/web/team-live.html`. Owner and admin only, and said twice: the role
 * is checked here, and the figures are fenced inside the service by the
 * session's own visibility, so neither half alone can leak a colleague's day.
 */
v2Router.get(
  '/live',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await teamLive(currentUser(req)));
  }),
);

/* ── from tap to reply ─────────────────────────────────────────────────── */

/**
 * The messaging report.
 *
 * `design/web/messaging-report.html`. Scoped inside the service by the
 * session's role, so a manager sees their team and nobody can ask for
 * somebody else's figures by changing a parameter.
 */
v2Router.get(
  '/messaging',
  requireRole('owner', 'admin', 'manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const asked = String(req.query.period ?? 'today');
    const period = (PERIODS as readonly string[]).includes(asked) ? (asked as Period) : 'today';
    res.json(await messagingReport(currentUser(req), period));
  }),
);

/*
 * The full dashboard — `design/web/dashboard.html`, page 32.
 *
 * Owner and admin only, as the design marks it: the page shows every agent's
 * numbers side by side and the whole company's money, and a manager's own
 * team view is `/v2/team`. An unknown period reads as today rather than
 * failing, because the only way to send one is to type it into the address.
 */
v2Router.get(
  '/dashboard',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const asked = String(req.query.period ?? 'today');
    const period = (DASH_PERIODS as readonly string[]).includes(asked)
      ? (asked as DashPeriod) : 'today';
    res.json(await fullDashboard(currentUser(req), period));
  }),
);

/*
 * "Move 31" on the Going cold card: every open lead of one agent goes back to
 * Incoming, for the owner to give out again. Nobody new is chosen here — see
 * `movePool`. Owner and admin only, audited by the bulk machinery it calls.
 */
v2Router.post(
  '/dashboard/move',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({
      userId: z.string().min(1).max(36),
      /* The Move dialog's three choices. Absent means Incoming, which is
         what the button did before the dialog existed. */
      to: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('pool') }),
        z.object({ kind: z.literal('agent'), userId: z.string().min(1).max(36) }),
        z.object({
          kind: z.literal('share'),
          userIds: z.array(z.string().min(1).max(36)).min(1).max(50),
        }),
      ]).optional(),
    }).parse(req.body);
    res.json(await movePool(actorFrom(req), body.userId, body.to ?? { kind: 'pool' }));
  }),
);

/**
 * "Remind" — one notification with the agent's open questions in it.
 *
 * One, not one per tap: six separate pushes about six leads is how somebody
 * turns notifications off. The agent must be somebody this manager can
 * already see, which is the same rule the report itself is scoped by.
 */
v2Router.post(
  '/messaging/remind',
  requireRole('owner', 'admin', 'manager'),
  asyncHandler(async (req: Request, res: Response) => {
    const body = z.object({ userId: z.string().max(36) }).parse(req.body);
    const visible = await visibleUserIds(currentUser(req));
    if (visible !== null && !visible.includes(body.userId)) {
      throw forbidden('That person is not on your team.');
    }

    const open = await openQuestions(body.userId);
    if (open === 0) throw badRequest('There is nothing left to answer.');

    await notify({
      userId: body.userId,
      type: 'tap_reminder',
      title: open === 1 ? 'One message needs an answer' : `${open} messages need an answer`,
      body: 'Tell us what happened after you opened WhatsApp or Telegram.',
      link: '/v2',
    });
    await writeAudit({
      actor: actorFrom(req),
      action: 'messaging.reminded',
      entityType: 'user',
      entityId: body.userId,
      after: { openQuestions: open },
    });
    res.json({ reminded: open });
  }),
);

/* ── which projects the agents can see ─────────────────────────────────── */

/**
 * The owner's view of the library.
 *
 * `design/web/manage-projects.html`. The library list already holds everything
 * the table shows except the lead count, which lives on `opportunities` and is
 * matched by project name — that column is a string on purpose, so a deleted
 * project never orphans a lead.
 *
 * Archived projects are included here and nowhere else: archiving is what the
 * design calls "Hidden", and `/api/library` leaves them out for everybody,
 * which is what makes the label true.
 */
v2Router.get(
  '/projects/manage',
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const [projects, leads, brochures] = await Promise.all([
      listLibrary({ includeArchived: true }),
      query<{ project_name: string; leads: number }>(
        `SELECT project_name, COUNT(*) AS leads
           FROM opportunities
          WHERE project_name IS NOT NULL AND project_name <> '' AND deleted_at IS NULL
          GROUP BY project_name`,
        [],
      ),
      /* The brochure the agents send. Either kind counts: an English one is
         what the table means by "has a brochure", and an Arabic-only project
         still has something to send. */
      query<{ project_id: string; id: string; filename: string; byte_size: number }>(
        `SELECT project_id, id, filename, byte_size FROM project_documents
          WHERE kind IN ('brochure_en', 'brochure_ar')
          ORDER BY created_at DESC`,
        [],
      ),
    ]);

    /* Matched on the name, case-folded: the lead's project was typed or came
       off a form, and "The Archive" and "the archive" are one project. */
    const counted = new Map(leads.map((row) => [row.project_name.trim().toLowerCase(), Number(row.leads)]));
    const brochure = new Map<string, { id: string; filename: string; byteSize: number }>();
    for (const row of brochures) {
      if (!brochure.has(row.project_id)) {
        brochure.set(row.project_id, {
          id: row.id, filename: row.filename, byteSize: Number(row.byte_size),
        });
      }
    }

    res.json({
      items: projects.map((one) => ({
        ...one,
        leads: counted.get(one.name.trim().toLowerCase()) ?? 0,
        brochure: brochure.get(one.id) ?? null,
      })),
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
    const [attendance, automations, company, spend, push, setup, feedback] = await Promise.all([
      attendanceSettings(),
      listAutomations(),
      companyDetails(),
      monthSpend(),
      pushReadiness(),
      setupChecklist(),
      feedbackInbox('new'),
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
      feedback: { open: feedback.items.length },
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
