import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { actorFrom, blockUntilPasswordChanged, currentUser, requireAdmin, requireAuth } from '../middleware/auth.js';
import { execute, query, queryOne } from '../../db/client.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { normalizeEmail } from '../../lib/email.js';
import { assignmentList } from '../../lib/sql.js';
import { ROLES } from '../../auth/rbac.js';
import { generateTemporaryPassword, hashPassword } from '../../auth/password.js';
import { destroyAllSessionsForUser } from '../../auth/sessions.js';
import { writeAudit, diffFields } from '../../audit/audit.js';

export const usersRouter = Router();
usersRouter.use(requireAuth, blockUntilPasswordChanged);

/** Everyone can see the roster — assignment and @mentions need it. */
usersRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const items = await query(
      `SELECT id, name, email, role, is_active, availability, routing_weight, shift_start, shift_end,
              languages, projects_covered, manager_id, locale, last_login_at, created_at
         FROM users ORDER BY is_active DESC, name`,
    );
    res.json({ items });
  }),
);

const createSchema = z.object({
  name: z.string().min(1).max(160),
  email: z.string().min(3).max(255),
  role: z.enum(ROLES),
  temporaryPassword: z.string().min(8).max(200).optional(),
  managerId: z.string().max(36).nullable().optional(),
  languages: z.array(z.string().max(8)).max(10).optional(),
  projectsCovered: z.array(z.string().max(160)).max(100).optional(),
  routingWeight: z.number().int().min(0).max(1000).optional(),
  shiftStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  shiftEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  locale: z.enum(['en', 'ar']).optional(),
});

/**
 * The owner or admin creates accounts. There is no public sign-up, and the
 * temporary password must be changed on first login.
 */
usersRouter.post(
  '/',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const body = createSchema.parse(req.body);
    const email = normalizeEmail(body.email);
    if (!email) throw badRequest('That email address is not valid');

    const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) throw conflict('A user with that email already exists');

    const temporary = body.temporaryPassword ?? generateTemporaryPassword();
    const { hash, algo } = await hashPassword(temporary);
    const id = newId();

    await execute(
      `INSERT INTO users (id, name, email, role, password_hash, password_algo, must_change_password, is_active,
                          manager_id, languages, projects_covered, routing_weight, shift_start, shift_end, locale)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.name,
        email,
        body.role,
        hash,
        algo,
        body.managerId ?? null,
        body.languages ? JSON.stringify(body.languages) : null,
        body.projectsCovered ? JSON.stringify(body.projectsCovered) : null,
        body.routingWeight ?? 10,
        body.shiftStart ?? null,
        body.shiftEnd ?? null,
        body.locale ?? 'en',
      ],
    );

    await writeAudit({
      actor: actorFrom(req),
      action: 'user.created',
      entityType: 'user',
      entityId: id,
      // The password itself is never written to the audit log.
      after: { name: body.name, email, role: body.role },
    });

    // Returned once so the admin can hand it over; never stored in plain text.
    res.status(201).json({ id, email, temporaryPassword: temporary });
  }),
);

const updateSchema = createSchema.partial().omit({ temporaryPassword: true }).extend({
  isActive: z.boolean().optional(),
  availability: z.enum(['available', 'busy', 'off']).optional(),
});

usersRouter.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const actingUser = currentUser(req);
    const targetId = String(req.params.id);
    const body = updateSchema.parse(req.body);

    // An agent may set their own availability; everything else is admin-only.
    const selfServiceOnly = Object.keys(body).every((k) => k === 'availability');
    const isSelf = targetId === actingUser.id;
    if (!(isSelf && selfServiceOnly) && actingUser.role !== 'owner' && actingUser.role !== 'admin') {
      throw badRequest('Only an owner or admin can change another user');
    }

    const before = await queryOne<Record<string, unknown>>(
      'SELECT id, name, email, role, is_active, availability, routing_weight, manager_id FROM users WHERE id = ?',
      [targetId],
    );
    if (!before) throw notFound('User not found');

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.role !== undefined) patch.role = body.role;
    if (body.managerId !== undefined) patch.manager_id = body.managerId;
    if (body.languages !== undefined) patch.languages = JSON.stringify(body.languages);
    if (body.projectsCovered !== undefined) patch.projects_covered = JSON.stringify(body.projectsCovered);
    if (body.routingWeight !== undefined) patch.routing_weight = body.routingWeight;
    if (body.shiftStart !== undefined) patch.shift_start = body.shiftStart;
    if (body.shiftEnd !== undefined) patch.shift_end = body.shiftEnd;
    if (body.locale !== undefined) patch.locale = body.locale;
    if (body.availability !== undefined) patch.availability = body.availability;
    if (body.isActive !== undefined) {
      patch.is_active = body.isActive ? 1 : 0;
      patch.deactivated_at = body.isActive ? null : new Date();
    }
    if (body.email !== undefined) {
      const email = normalizeEmail(body.email);
      if (!email) throw badRequest('That email address is not valid');
      patch.email = email;
    }
    if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');

    const entries = Object.entries(patch);
    await execute(
      `UPDATE users SET ${assignmentList(entries.map(([k]) => k))} WHERE id = ?`,
      [...entries.map(([, v]) => v as never), targetId],
    );

    // Deactivating a user ends all of their sessions immediately. Their leads
    // stay in the system for reassignment.
    if (body.isActive === false) {
      const ended = await destroyAllSessionsForUser(targetId);
      await writeAudit({
        actor: actorFrom(req),
        action: 'user.deactivated',
        entityType: 'user',
        entityId: targetId,
        after: { sessionsEnded: ended },
      });
    }

    const diff = diffFields(before, patch);
    await writeAudit({
      actor: actorFrom(req),
      action: 'user.updated',
      entityType: 'user',
      entityId: targetId,
      before: diff.before,
      after: diff.after,
    });

    res.json({ ok: true });
  }),
);

const resetSchema = z.object({ temporaryPassword: z.string().min(8).max(200).optional() });

/**
 * There is no email reset flow. The owner or admin resets the password here and
 * the user sets a new one on next login.
 */
usersRouter.post(
  '/:id/reset-password',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const targetId = String(req.params.id);
    const body = resetSchema.parse(req.body ?? {});

    const user = await queryOne<{ id: string; email: string }>('SELECT id, email FROM users WHERE id = ?', [targetId]);
    if (!user) throw notFound('User not found');

    const temporary = body.temporaryPassword ?? generateTemporaryPassword();
    const { hash, algo } = await hashPassword(temporary);

    await execute(
      'UPDATE users SET password_hash = ?, password_algo = ?, must_change_password = 1, failed_login_count = 0, locked_until = NULL WHERE id = ?',
      [hash, algo, targetId],
    );
    const ended = await destroyAllSessionsForUser(targetId);

    await writeAudit({
      actor: actorFrom(req),
      action: 'user.password_reset',
      entityType: 'user',
      entityId: targetId,
      after: { sessionsEnded: ended, mustChangePassword: true },
    });

    res.json({ temporaryPassword: temporary });
  }),
);

/** Unlock an account locked by failed sign-in attempts. */
usersRouter.post(
  '/:id/unlock',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const targetId = String(req.params.id);
    await execute('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?', [targetId]);
    await writeAudit({ actor: actorFrom(req), action: 'user.unlocked', entityType: 'user', entityId: targetId });
    res.json({ ok: true });
  }),
);

const pushTokenSchema = z.object({
  token: z.string().min(10).max(512),
  platform: z.enum(['web', 'android', 'ios']).default('web'),
});

/** Register this device for push. */
usersRouter.post(
  '/me/push-tokens',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const body = pushTokenSchema.parse(req.body);
    await execute(
      `INSERT INTO push_tokens (id, user_id, token, platform, last_used_at)
       VALUES (?, ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform), last_used_at = NOW(3)`,
      [newId(), user.id, body.token, body.platform],
    );
    res.status(201).json({ ok: true });
  }),
);

usersRouter.delete(
  '/me/push-tokens',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const token = typeof req.body?.token === 'string' ? req.body.token : null;
    if (!token) throw badRequest('token is required');
    await execute('DELETE FROM push_tokens WHERE user_id = ? AND token = ?', [user.id, token]);
    res.json({ ok: true });
  }),
);
