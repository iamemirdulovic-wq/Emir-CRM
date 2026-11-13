import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { actorFrom, blockUntilPasswordChanged, currentUser, requireAdmin, requireAuth } from '../middleware/auth.js';
import { execute, query, queryOne } from '../../db/client.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';
import { normalizeEmail } from '../../lib/email.js';
import { assignmentList } from '../../lib/sql.js';
import { isManagerOrAbove, ROLES } from '../../auth/rbac.js';
import { generateTemporaryPassword, hashPassword } from '../../auth/password.js';
import { destroyAllSessionsForUser } from '../../auth/sessions.js';
import { writeAudit, diffFields } from '../../audit/audit.js';
import { returnLeadsToIncoming } from '../../routing/handover.js';
import { env } from '../../config/env.js';
import { sendWelcomeEmail } from '../../users/welcome-email.js';
import { signOutEverywhere } from '../../v2/team-roles.js';

export const usersRouter = Router();
usersRouter.use(requireAuth, blockUntilPasswordChanged);

/** Everyone can see the roster — assignment and @mentions need it. */
/**
 * The team.
 *
 * Agents need colleagues' names — to read "assigned to Layla" on a card — but
 * not their email addresses, shifts, routing weights or last sign-in. Those are
 * administrative details, so the row is trimmed for anyone below manager rather
 * than the endpoint being refused, which would break the screens that only want
 * a name.
 */
usersRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const full = isManagerOrAbove(user.role);

    const items = await query<Record<string, unknown>>(
      `SELECT id, name, email, role, is_active, availability, routing_weight, shift_start, shift_end,
              languages, projects_covered, manager_id, locale, last_login_at, created_at
         FROM users ORDER BY is_active DESC, name`,
    );

    res.json({
      items: full
        ? items
        : items.map((row) => ({
            id: row.id,
            name: row.name,
            role: row.role,
            is_active: row.is_active,
            availability: row.availability,
            // Their own row keeps its detail; everyone else's is just a name.
            ...(row.id === user.id ? { email: row.email, locale: row.locale } : {}),
          })),
    });
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

/*
 * Nine people joined at once, and doing that one form at a time is how a role
 * gets mistyped on the seventh.
 *
 * A name is not asked for: there isn't one to ask for yet, and a wrong name is
 * worse than an obvious placeholder. The part before the @ is capitalised and
 * everybody fixes their own on first sign-in, in the welcome flow that already
 * asks them who they are.
 */
const inviteSchema = z.object({
  emails: z.array(z.string().min(3).max(255)).min(1).max(50),
  role: z.enum(ROLES),
  managerId: z.string().max(36).nullable().optional(),
  /** Off by default: nothing leaves the building unless it was asked for. */
  sendEmail: z.boolean().optional(),
});

/** "tej@homes.me" -> "Tej", until they tell us otherwise. */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || email;
}

export interface InviteResult {
  email: string;
  status: 'created' | 'already_exists' | 'invalid';
  /** Shown once, to be handed over. Never stored in plain text or audited. */
  temporaryPassword?: string;
  emailSent?: boolean;
  emailReason?: string;
}

usersRouter.post(
  '/invite',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const body = inviteSchema.parse(req.body);
    /* An owner is not something you hand out in bulk. */
    if (body.role === 'owner') throw badRequest('Invite people as admin, manager or agent, not owner');

    const results: InviteResult[] = [];
    const seen = new Set<string>();

    for (const raw of body.emails) {
      const email = normalizeEmail(raw);
      if (!email || seen.has(email)) {
        results.push({ email: raw.trim(), status: 'invalid' });
        continue;
      }
      seen.add(email);

      const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        results.push({ email, status: 'already_exists' });
        continue;
      }

      const temporary = generateTemporaryPassword();
      const { hash, algo } = await hashPassword(temporary);
      const id = newId();
      const name = nameFromEmail(email);

      await execute(
        `INSERT INTO users (id, name, email, role, password_hash, password_algo, must_change_password,
                            is_active, manager_id, routing_weight, locale)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, 10, 'en')`,
        [id, name, email, body.role, hash, algo, body.managerId ?? null],
      );

      await writeAudit({
        actor: actorFrom(req),
        action: 'user.created',
        entityType: 'user',
        entityId: id,
        // The password is never written here, the same as the single create.
        after: { name, email, role: body.role, via: 'invite' },
      });

      const result: InviteResult = { email, status: 'created', temporaryPassword: temporary };
      if (body.sendEmail) {
        const sent = await sendWelcomeEmail({ name, email, temporaryPassword: temporary });
        result.emailSent = sent.sent;
        if (!sent.sent) result.emailReason = sent.reason;
      }
      results.push(result);
    }

    res.status(201).json({
      results,
      created: results.filter((r) => r.status === 'created').length,
      skipped: results.filter((r) => r.status !== 'created').length,
    });
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

    // An agent may set their own availability and interface language;
    // everything else is admin-only.
    const selfServiceOnly = Object.keys(body).every((k) => k === 'availability' || k === 'locale');
    const isSelf = targetId === actingUser.id;
    if (!(isSelf && selfServiceOnly) && actingUser.role !== 'owner' && actingUser.role !== 'admin') {
      throw badRequest('Only an owner or admin can change another user');
    }

    const before = await queryOne<Record<string, unknown>>(
      'SELECT id, name, email, role, is_active, availability, routing_weight, manager_id FROM users WHERE id = ?',
      [targetId],
    );
    if (!before) throw notFound('User not found');

    /*
     * An owner can never be deactivated.
     *
     * `design/web/settings-team.html` disables the menu item and says so —
     * "An owner cannot be deactivated." — and §4.13 of the spec names the
     * rule. The screen had neither, and neither did this endpoint: a PATCH
     * with `isActive: false` would end an owner's sessions and empty their
     * leads into Incoming. On an installation with one owner that locks
     * everybody out of their own CRM, with no way back in.
     */
    if (body.isActive === false && before.role === 'owner') {
      throw badRequest('An owner cannot be deactivated.');
    }

    /*
     * And an admin cannot touch an owner at all.
     *
     * The design's own footnote: "Admin can do the same as an owner, but
     * cannot remove or change owners." Without this an admin could demote
     * every owner to agent and be the only one left who can let them back in.
     */
    if (actingUser.role === 'admin' && !isSelf) {
      if (before.role === 'owner') {
        throw badRequest('An admin cannot change an owner. Ask an owner to do it.');
      }
      if (body.role === 'owner') {
        throw badRequest('Only an owner can make somebody else an owner.');
      }
    }

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

    /*
     * Deactivating someone ends their sessions, and sends their open leads
     * back to Incoming. The second half matters more than it looks: a lead
     * left assigned to an account that cannot sign in is never called again
     * — no card moves, no follow-up fires, no timer bounces it. It is not
     * lost on paper, it is just dead.
     */
    if (body.isActive === false) {
      const ended = await destroyAllSessionsForUser(targetId);
      const handover = await returnLeadsToIncoming(actorFrom(req), targetId, 'deactivated');
      await writeAudit({
        actor: actorFrom(req),
        action: 'user.deactivated',
        entityType: 'user',
        entityId: targetId,
        after: { sessionsEnded: ended, leadsReturnedToIncoming: handover.returned },
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

/**
 * End every session this person has, without changing their password.
 *
 * `design/web/settings-team.html` puts "Sign out everywhere" in the row menu
 * beside the password reset, and it is the right thing to reach for when a
 * laptop is left in a taxi: the laptop forgets them, they keep their password.
 * There was no endpoint, so the only way to do it was to reset the password
 * and make them pick a new one.
 */
usersRouter.post(
  '/:id/sign-out-everywhere',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const targetId = String(req.params.id);
    const actingUser = currentUser(req);
    const target = await queryOne<{ id: string; role: string }>(
      'SELECT id, role FROM users WHERE id = ?', [targetId],
    );
    if (!target) throw notFound('User not found');
    /* The same rule as everywhere else on this router: an admin does not
       reach into an owner's account. */
    if (actingUser.role === 'admin' && target.role === 'owner' && targetId !== actingUser.id) {
      throw badRequest('An admin cannot sign an owner out. Ask an owner to do it.');
    }
    res.json(await signOutEverywhere(actorFrom(req), targetId));
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

/**
 * What the browser needs to subscribe to notifications.
 *
 * Every value here is public: Google ships them to each phone that opens the
 * app, and they identify the project rather than authorise anything. The key
 * that actually permits *sending* is FCM_PRIVATE_KEY, which stays on the
 * server and is never in this response.
 *
 * `configured: false` rather than an error when the keys are unset, so the
 * Settings screen can say "notifications are not set up yet" instead of
 * showing a broken button.
 */
usersRouter.get(
  '/me/push-config',
  asyncHandler(async (_req: Request, res: Response) => {
    const cfg = env();
    const ready = Boolean(
      cfg.FCM_PROJECT_ID && cfg.FCM_WEB_API_KEY && cfg.FCM_WEB_APP_ID
      && cfg.FCM_MESSAGING_SENDER_ID && cfg.FCM_VAPID_KEY,
    );
    if (!ready) {
      res.json({ configured: false });
      return;
    }
    res.json({
      configured: true,
      vapidKey: cfg.FCM_VAPID_KEY,
      firebase: {
        apiKey: cfg.FCM_WEB_API_KEY,
        // Firebase always serves this at the project's own subdomain.
        authDomain: `${cfg.FCM_PROJECT_ID}.firebaseapp.com`,
        projectId: cfg.FCM_PROJECT_ID,
        messagingSenderId: cfg.FCM_MESSAGING_SENDER_ID,
        appId: cfg.FCM_WEB_APP_ID,
      },
    });
  }),
);

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
