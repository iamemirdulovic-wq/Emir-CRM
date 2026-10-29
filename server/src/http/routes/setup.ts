import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { clientIp } from '../middleware/auth.js';
import { execute, queryOne, withTransaction, type Executor } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { normalizeEmail } from '../../lib/email.js';
import { hashPassword } from '../../auth/password.js';
import { createSession } from '../../auth/sessions.js';
import { writeAudit } from '../../audit/audit.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * First-run setup: create the owner account from a browser.
 *
 * There is no public sign-up in this product, and there never will be — the
 * owner creates every account from the Users page. But the *first* account has
 * to come from somewhere, and on managed hosting there may be no console to run
 * a seed script in. So this endpoint exists for exactly as long as the `users`
 * table is empty, and refuses forever afterwards.
 *
 * That is the whole security model, and it is worth being precise about it: the
 * window is open only while an attacker and the owner are in an identical
 * position — the CRM holds nothing yet. The moment a first account exists there
 * is something to protect, and the door is shut. So the owner should open the
 * site as soon as it deploys; a CRM left un-set-up on a public address for a
 * week is one someone else can claim.
 */
export const setupRouter = Router();

// Generous enough for a mistyped password, mean enough that the window is not
// something to grind against.
setupRouter.use(rateLimit({ max: 20, windowMs: 10 * 60 * 1000, message: 'Too many setup attempts. Please wait a few minutes.' }));

async function ownerExists(exec?: Executor): Promise<boolean> {
  const row = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM users', [], exec);
  return Number(row?.n ?? 0) > 0;
}

/**
 * Does this CRM still need its first account?
 *
 * Public on purpose: the sign-in page asks before rendering, so a fresh
 * deployment shows the setup form rather than a login nobody can pass. It
 * reveals only that the CRM is new, which is already obvious from the fact that
 * no password works.
 */
setupRouter.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const needed = !(await ownerExists());
    res.json({
      needed,
      // Shown on the setup page so the owner can finish configuring the host
      // without a terminal. Generated per request and never stored: it is only
      // a suggestion until they paste it into their hosting panel.
      ...(needed && !env().ENCRYPTION_KEY ? { suggestedEncryptionKey: randomBytes(32).toString('hex') } : {}),
    });
  }),
);

const ownerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().min(3).max(255),
  // The rule from the specification: at least 8 characters. Deliberately not a
  // composition rule — length is what helps, and a rule people work around by
  // appending "1!" does not.
  password: z.string().min(8).max(200),
});

setupRouter.post(
  '/owner',
  asyncHandler(async (req: Request, res: Response) => {
    const body = ownerSchema.parse(req.body);
    const email = normalizeEmail(body.email);
    if (!email) throw badRequest('That email address is not valid');

    if (await ownerExists()) {
      throw conflict('This CRM has already been set up. Sign in instead.');
    }

    const { hash, algo } = await hashPassword(body.password);
    const id = newId();

    await withTransaction(async (tx) => {
      /*
       * Two people opening the page at once must not both become the owner.
       * A named lock rather than a row lock, because there is no row to lock:
       * the check is "the table is empty", and an empty table has nothing to
       * take a lock on.
       */
      const lock = await queryOne<{ got: number }>("SELECT GET_LOCK('emir_crm_setup', 10) AS got", [], tx);
      if (Number(lock?.got ?? 0) !== 1) {
        throw conflict('Another setup is in progress. Please try again in a moment.');
      }
      try {
        if (await ownerExists(tx)) {
          throw conflict('This CRM has already been set up. Sign in instead.');
        }

        await execute(
          `INSERT INTO users (id, name, email, role, password_hash, password_algo, must_change_password, is_active,
                              routing_weight, locale)
           VALUES (?, ?, ?, 'owner', ?, ?, 0, 1, 10, 'en')`,
          [id, body.name, email, hash, algo],
          tx,
        );
      } finally {
        await queryOne("SELECT RELEASE_LOCK('emir_crm_setup')", [], tx);
      }
    });

    // must_change_password is 0 above: they chose this password themselves a
    // second ago, so demanding they change it teaches people to ignore the
    // prompt.
    await writeAudit({
      actor: { userId: id, role: 'owner', label: 'first-run setup' },
      action: 'setup.owner_created',
      entityType: 'user',
      entityId: id,
      after: { name: body.name, email, role: 'owner' },
    });
    logger.info('first-run setup created the owner account', { userId: id });

    const { token } = await createSession(id, {
      ip: clientIp(req),
      userAgent: req.get('user-agent') ?? null,
    });
    const cfg = env();
    res.cookie(cfg.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: cfg.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 60 * 60 * 1000,
    });

    res.status(201).json({
      ok: true,
      user: { id, name: body.name, email, role: 'owner' },
    });
  }),
);
