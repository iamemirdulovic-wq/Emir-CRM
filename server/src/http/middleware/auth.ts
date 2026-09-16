import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { resolveSession, type SessionUser } from '../../auth/sessions.js';
import { assertCan, isAdminOrAbove, isManagerOrAbove, type Permission, type Role } from '../../auth/rbac.js';
import type { AuditActor } from '../../audit/audit.js';

export function sessionTokenFrom(req: Request): string | undefined {
  const cookieName = env().SESSION_COOKIE_NAME;
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[cookieName];
  return fromCookie;
}

/** Populates req.user. 401 when there is no live session. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = sessionTokenFrom(req);
    const resolved = await resolveSession(token);
    if (!resolved) throw unauthorized();
    req.user = resolved.user;
    req.sessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Most endpoints are unusable until a temporary password has been replaced.
 * The change-password endpoint itself opts out.
 */
export function blockUntilPasswordChanged(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.mustChangePassword) {
    next(forbidden('You must change your temporary password before continuing'));
    return;
  }
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.user) throw unauthorized();
      assertCan(req.user.role, permission);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden(`This action requires one of: ${roles.join(', ')}`));
    next();
  };
}

export const requireManager = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) return next(unauthorized());
  if (!isManagerOrAbove(req.user.role)) return next(forbidden('Manager access required'));
  next();
};

export const requireAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) return next(unauthorized());
  if (!isAdminOrAbove(req.user.role)) return next(forbidden('Administrator access required'));
  next();
};

export function currentUser(req: Request): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function actorFrom(req: Request): AuditActor {
  const user = req.user;
  return {
    userId: user?.id ?? null,
    role: user?.role ?? null,
    label: user?.email ?? null,
    ip: clientIp(req),
    userAgent: req.get('user-agent') ?? null,
  };
}

export function clientIp(req: Request): string | null {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return req.ip ?? req.socket.remoteAddress ?? null;
}
