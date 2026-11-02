import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { SESSION_TTL_DEFAULT_MS, SESSION_TTL_REMEMBER_MS } from '../../config/constants.js';
import { queryOne, execute } from '../../db/client.js';
import { badRequest, tooManyRequests, unauthorized } from '../../lib/errors.js';
import { normalizeEmail } from '../../lib/email.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../../auth/password.js';
import { createSession, destroySession, destroyAllSessionsForUser } from '../../auth/sessions.js';
import { clearFailures, getLockState, isIpRateLimited, recordLoginAttempt, registerFailure } from '../../auth/lockout.js';
import { permissionsFor, type Role } from '../../auth/rbac.js';
import { writeAudit } from '../../audit/audit.js';
import { actorFrom, clientIp, currentUser, requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { recordSignIn } from '../../activity/track.js';
import { canUseLoginLink, consumeLoginLink, issueLoginLink } from '../../auth/magic-link.js';
import { sendLoginLinkEmail } from '../../auth/login-link-email.js';
import { rateLimit } from '../middleware/rate-limit.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().min(3).max(255),
  password: z.string().min(1).max(200),
  rememberMe: z.boolean().optional().default(false),
});

function setSessionCookie(res: Response, token: string, rememberMe: boolean): void {
  const cfg = env();
  res.cookie(cfg.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: cfg.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: rememberMe ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_DEFAULT_MS,
  });
}

function clearSessionCookie(res: Response): void {
  const cfg = env();
  res.clearCookie(cfg.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: cfg.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  password_hash: string;
  is_active: number;
  must_change_password: number;
  manager_id: string | null;
  locale: string;
  availability: 'available' | 'busy' | 'off';
};

/* ── Sign-in links ──────────────────────────────────────────────────────── */

const linkRequestSchema = z.object({ email: z.string().min(3).max(255) });

/**
 * Ask for a sign-in link.
 *
 * Always answers the same way. Whether the address belongs to an agent, to
 * the owner, to a deactivated account or to nobody at all, the reply is "if
 * that address is on an account, a link is on its way" — otherwise this
 * endpoint becomes a way to find out who works here, one guess at a time.
 *
 * The one exception is the CRM having no mail server configured, which is
 * true for everybody and reveals nothing about any account.
 */
authRouter.post(
  '/magic-link',
  rateLimit({
    max: 5,
    windowMs: 15 * 60 * 1000,
    keyFor: (req) => `magic-link:${clientIp(req) ?? 'unknown'}`,
    message: 'Too many sign-in links requested from this network. Try again in a few minutes.',
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = linkRequestSchema.parse(req.body);
    const ip = clientIp(req);

    if (!env().SMTP_HOST) {
      throw badRequest('Sign-in links are not switched on yet. Use your password for now.');
    }

    const email = normalizeEmail(body.email);
    /* Said once, used for every outcome below. */
    const sameAnswer = {
      ok: true,
      message: 'If that address is on an account, a sign-in link is on its way.',
    };

    if (!email) {
      res.json(sameAnswer);
      return;
    }

    const user = await queryOne<{ id: string; name: string; email: string; role: Role; is_active: number }>(
      'SELECT id, name, email, role, is_active FROM users WHERE email = ?',
      [email],
    );

    if (!user || user.is_active !== 1 || !canUseLoginLink(user.role)) {
      await writeAudit({
        actor: { userId: user?.id ?? null, role: null, label: email, ip, userAgent: req.get('user-agent') },
        action: 'auth.link_requested_refused',
        entityType: 'user',
        entityId: user?.id ?? null,
        after: {
          email,
          reason: !user ? 'unknown_email' : user.is_active !== 1 ? 'inactive' : 'role_keeps_password',
        },
      });
      res.json(sameAnswer);
      return;
    }

    const { token, expiresAt } = await issueLoginLink(user.id, ip);
    await sendLoginLinkEmail({ to: user.email, name: user.name, token, expiresAt });

    await writeAudit({
      actor: { userId: user.id, role: user.role, label: user.email, ip, userAgent: req.get('user-agent') },
      action: 'auth.link_requested',
      entityType: 'user',
      entityId: user.id,
      after: { expiresAt: expiresAt.toISOString() },
    });

    res.json(sameAnswer);
  }),
);

const linkConsumeSchema = z.object({
  token: z.string().min(10).max(200),
  rememberMe: z.boolean().optional().default(false),
});

/** Why a link did not work, in words the person holding it can act on. */
const LINK_PROBLEM: Record<string, string> = {
  unknown: 'That sign-in link is not valid. Ask for a new one.',
  expired: 'That link has expired. They last fifteen minutes — ask for a new one.',
  already_used: 'That link has already been used. Ask for a new one.',
  user_inactive: 'That account is no longer active.',
  role_not_allowed: 'This account signs in with a password.',
};

/** Spend a link and start a session, exactly as a password login would. */
authRouter.post(
  '/magic-link/consume',
  rateLimit({
    max: 20,
    windowMs: 15 * 60 * 1000,
    keyFor: (req) => `magic-consume:${clientIp(req) ?? 'unknown'}`,
    message: 'Too many attempts from this network. Try again in a few minutes.',
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = linkConsumeSchema.parse(req.body);
    const ip = clientIp(req);

    const result = await consumeLoginLink(body.token, ip);
    if (!result.ok) {
      await writeAudit({
        actor: { userId: null, role: null, label: 'sign-in link', ip, userAgent: req.get('user-agent') },
        action: 'auth.link_failed',
        entityType: 'user',
        entityId: null,
        after: { reason: result.why },
      });
      throw unauthorized(LINK_PROBLEM[result.why] ?? LINK_PROBLEM.unknown as string);
    }

    const user = await queryOne<UserRow>(
      `SELECT id, name, email, role, password_hash, is_active, must_change_password, manager_id, locale, availability
         FROM users WHERE id = ?`,
      [result.userId],
    );
    if (!user) throw unauthorized(LINK_PROBLEM.unknown as string);

    /*
     * Reading the inbox is proof enough to clear a lockout. The lock exists to
     * stop somebody guessing a password; holding a link from that mailbox is
     * not guessing. Leaving it on would also hand an attacker a way to lock a
     * colleague out of their own account for a quarter of an hour at a time.
     */
    await clearFailures(user.id);

    const { token, sessionId } = await createSession(user.id, {
      rememberMe: body.rememberMe,
      ip,
      userAgent: req.get('user-agent') ?? null,
    });
    setSessionCookie(res, token, body.rememberMe);

    await recordSignIn({
      userId: user.id,
      userName: user.name,
      sessionId,
      ip: ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    await writeAudit({
      actor: { userId: user.id, role: user.role, label: user.email, ip, userAgent: req.get('user-agent') },
      action: 'auth.login_link',
      entityType: 'user',
      entityId: user.id,
      after: { rememberMe: body.rememberMe },
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        locale: user.locale,
        availability: user.availability,
        mustChangePassword: user.must_change_password === 1,
        permissions: permissionsFor(user.role),
      },
    });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req: Request, res: Response) => {
    const body = loginSchema.parse(req.body);
    const email = normalizeEmail(body.email);
    const ip = clientIp(req);

    if (await isIpRateLimited(ip)) {
      throw tooManyRequests('Too many failed sign-in attempts from this network. Try again later.');
    }
    // A malformed address can never match an account; charge it against the IP
    // budget and fail the same way a wrong password does.
    if (!email) {
      await recordLoginAttempt(String(body.email).slice(0, 255), ip, false);
      throw unauthorized('Invalid email or password');
    }

    const lock = await getLockState(email);
    if (lock.locked) {
      await recordLoginAttempt(email, ip, false);
      await writeAudit({
        actor: { userId: null, role: null, label: email, ip, userAgent: req.get('user-agent') },
        action: 'auth.login_blocked_locked',
        entityType: 'user',
        entityId: null,
        after: { email, lockedUntil: lock.until },
      });
      throw tooManyRequests('This account is temporarily locked. Try again in a few minutes.');
    }

    const user = await queryOne<UserRow>(
      `SELECT id, name, email, role, password_hash, is_active, must_change_password, manager_id, locale, availability
         FROM users WHERE email = ?`,
      [email],
    );

    const passwordOk = user ? await verifyPassword(body.password, user.password_hash) : false;

    if (!user || !passwordOk || user.is_active !== 1) {
      await recordLoginAttempt(email, ip, false);
      if (user) await registerFailure(email);
      await writeAudit({
        actor: { userId: user?.id ?? null, role: null, label: email, ip, userAgent: req.get('user-agent') },
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user?.id ?? null,
        after: { email, reason: !user ? 'unknown_email' : !passwordOk ? 'bad_password' : 'inactive' },
      });
      // Identical response for every failure mode — no account enumeration.
      throw unauthorized('Invalid email or password');
    }

    await clearFailures(user.id);
    await recordLoginAttempt(email, ip, true);
    const { token, sessionId } = await createSession(user.id, {
      rememberMe: body.rememberMe,
      ip,
      userAgent: req.get('user-agent') ?? null,
    });
    setSessionCookie(res, token, body.rememberMe);

    /* Records the device and the city, and works out whether anything about
       this sign-in is worth telling the owner about. Never fails the login. */
    await recordSignIn({
      userId: user.id,
      userName: user.name,
      sessionId,
      ip: ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    await writeAudit({
      actor: { userId: user.id, role: user.role, label: user.email, ip, userAgent: req.get('user-agent') },
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      after: { rememberMe: body.rememberMe },
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        locale: user.locale,
        availability: user.availability,
        mustChangePassword: user.must_change_password === 1,
        permissions: permissionsFor(user.role),
      },
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const token = (req.cookies as Record<string, string> | undefined)?.[env().SESSION_COOKIE_NAME];
    if (token) {
      await destroySession(token);
      await writeAudit({ actor: actorFrom(req), action: 'auth.logout', entityType: 'session', entityId: null });
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        locale: user.locale,
        availability: user.availability,
        mustChangePassword: user.mustChangePassword,
        permissions: permissionsFor(user.role),
      },
    });
  }),
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const body = changePasswordSchema.parse(req.body);
    const user = currentUser(req);
    assertPasswordPolicy(body.newPassword);

    const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [user.id]);
    if (!row || !(await verifyPassword(body.currentPassword, row.password_hash))) {
      throw unauthorized('Current password is incorrect');
    }
    if (await verifyPassword(body.newPassword, row.password_hash)) {
      throw badRequest('Choose a password you have not used before');
    }

    const { hash, algo } = await hashPassword(body.newPassword);
    await execute(
      'UPDATE users SET password_hash = ?, password_algo = ?, must_change_password = 0 WHERE id = ?',
      [hash, algo, user.id],
    );

    // Changing a password signs every other device out; keep this one alive.
    await destroyAllSessionsForUser(user.id);
    const { token } = await createSession(user.id, { ip: clientIp(req), userAgent: req.get('user-agent') ?? null });
    setSessionCookie(res, token, false);

    await writeAudit({
      actor: actorFrom(req),
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: user.id,
      after: { byUser: true },
    });

    res.json({ ok: true });
  }),
);
