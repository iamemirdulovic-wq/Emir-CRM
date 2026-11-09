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
    res.json({
      ...(await attendanceSettings()),
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
  start: z.string().max(5).optional(),
  end: z.string().max(5).optional(),
  satStart: z.string().max(5).optional(),
  satEnd: z.string().max(5).optional(),
  closedDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  graceMinutes: z.number().int().min(0).max(120).optional(),
});

attendanceRouter.put(
  '/settings',
  requireRole('owner'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = settingsSchema.parse(req.body);
    const saved = await saveAttendanceSettings(actorFrom(req), input);
    res.json({ ...saved, yourIp: networkIp(req) });
  }),
);
