import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requireRole,
} from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  attendanceMonth, dayState, dubaiDate, markOffice, markOutside,
} from '../../attendance/attendance.js';
import { attendanceSettings, saveAttendanceSettings } from '../../attendance/settings.js';
import { attendanceCsv, monthSummary, recentMonths } from '../../attendance/report.js';
import { query } from '../../db/client.js';

/**
 * Checking in, and the month the owner reads.
 *
 * The caller's own state comes from the session, never from the body: there
 * is no route here that lets one person mark another's day.
 */
export const attendanceRouter = Router();
attendanceRouter.use(requireAuth, blockUntilPasswordChanged);

/**
 * The address the office is seen from.
 *
 * NOT `clientIp`, which takes the first entry of X-Forwarded-For — the one a
 * browser can set itself. Behind one reverse proxy the LAST entry is the one
 * the proxy appended and the only one a client cannot forge, so whatever an
 * agent at home prepends, the truth is still on the end.
 *
 * It is a deterrent rather than a lock: a VPN into the office defeats it, and
 * so would a second proxy hop appending its own address. That is why Settings
 * shows an owner the address the server actually sees — if this ever read
 * something that is not the office, it shows up there the first time anybody
 * looks, instead of silently letting the wrong network in.
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

const markLimit = rateLimit({
  windowMs: 60_000,
  max: 12,
  keyFor: (req) => `attendance:${currentUser(req).id}`,
  message: 'Too many taps in a minute. Please wait a moment.',
});

/** My day: whether I am on the office network, and whether I have marked it. */
attendanceRouter.get(
  '/today',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await dayState(currentUser(req).id, networkIp(req)));
  }),
);

/** I am in the office. Refused off the office network. */
attendanceRouter.post(
  '/check-in',
  markLimit,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await markOffice(currentUser(req).id, networkIp(req)));
  }),
);

const outsideSchema = z.object({ note: z.string().min(1).max(160) });

/** I am working, but not from the office. Allowed from anywhere, by design. */
attendanceRouter.post(
  '/outside',
  markLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { note } = outsideSchema.parse(req.body);
    res.json(await markOutside(currentUser(req).id, note, networkIp(req)));
  }),
);

/* ── The owner's view ───────────────────────────────────────────────────── */

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

attendanceRouter.get(
  '/month',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const { from, to } = rangeSchema.parse(req.query);
    const end = to ?? dubaiDate();
    /* Default window is the last 30 days ending today, which is what Emir
       asked to see. */
    const start = from
      ?? new Date(Date.parse(`${end}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
    res.json(await attendanceMonth(start, end));
  }),
);

attendanceRouter.get(
  '/settings',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const settings = await attendanceSettings();
    /*
     * "Main office · 9 people on it now".
     *
     * The design puts a headcount under each network, and it is the line that
     * tells an owner whether a saved address is still the office's: an
     * address nobody has checked in from in a week is an address the internet
     * provider has changed underneath them.
     */
    const seen = await query<{ seen_ip: string; n: number }>(
      `SELECT seen_ip, COUNT(DISTINCT user_id) AS n
         FROM attendance
        WHERE on_date = DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
          AND seen_ip IS NOT NULL
        GROUP BY seen_ip`,
    );
    res.json({
      ...settings,
      onIpNow: Object.fromEntries(seen.map((row) => [row.seen_ip, Number(row.n)])),
      /* So an owner standing in the office can see what the server sees and
         save it without typing it, and can tell at a glance whether the
         stored address is still the right one. */
      yourIp: networkIp(req),
    });
  }),
);

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  officeIps: z.array(z.string().max(45)).max(10).optional(),
  officeNames: z.record(z.string().max(45), z.string().max(60)).optional(),
  start: z.string().max(5).optional(),
  end: z.string().max(5).optional(),
  satStart: z.string().max(5).optional(),
  satEnd: z.string().max(5).optional(),
  closedDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  graceMinutes: z.number().int().min(0).max(120).optional(),
  outsideAllowed: z.boolean().optional(),
  outsideLocationOnce: z.boolean().optional(),
  outsideAskBack: z.boolean().optional(),
  outsideTellOwners: z.boolean().optional(),
  callNeedsCheckIn: z.boolean().optional(),
  callAnyway: z.boolean().optional(),
});

/*
 * Admin as well as owner.
 *
 * `design/web/research/sage.md` §1 is explicit that an admin does what an
 * owner does on these screens, and the design's own nav marks Attendance
 * rules `data-only="owner"` — meaning the owner group, which admin is in.
 * Reading was already open to both; only saving was owner-only, so an admin
 * got the whole form with a Save button that answered 403.
 */
attendanceRouter.put(
  '/settings',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = settingsSchema.parse(req.body);
    const saved = await saveAttendanceSettings(actorFrom(req), input);
    res.json({ ...saved, yourIp: networkIp(req) });
  }),
);

/* ── the monthly file ──────────────────────────────────────────────────── */

const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });

/**
 * Which months the picker offers, and what each one holds.
 *
 * The design's own line under the picker — "22 working days · 10 agents" —
 * changes with the month, so the numbers come from here rather than being
 * written into the screen.
 */
attendanceRouter.get(
  '/report/months',
  requireRole('owner', 'admin'),
  asyncHandler(async (_req: Request, res: Response) => {
    const months = recentMonths();
    res.json({
      months: await Promise.all(months.map((one) => monthSummary(one.key))),
    });
  }),
);

/**
 * "Download Excel" — every agent, every day, late minutes, leave, outside
 * work, as one file. §4.21.
 *
 * A CSV rather than a real workbook; the button says so. See
 * `attendance/report.ts` and `docs/decisions-to-confirm.md`.
 */
attendanceRouter.get(
  '/report.csv',
  requireRole('owner', 'admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const { month } = monthSchema.parse(req.query);
    const key = month ?? recentMonths()[0]?.key ?? dubaiDate().slice(0, 7);
    const { filename, csv } = await attendanceCsv(key);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    /* Excel reads a CSV as the machine's own code page unless it finds this. */
    res.send(`﻿${csv}`);
  }),
);
