/**
 * Connecting the CRM to the outside, from inside the CRM.
 *
 * The shared secret for property-investment.ae could only be set in the
 * hosting panel, which meant a trip to hPanel and a restart — and the owner
 * waiting on someone else to do it. It can be pasted here instead: encrypted
 * at rest with the same key as every other secret, and live immediately,
 * because saving clears the cache the verifier reads.
 *
 * The environment still wins when it is set, so an owner who prefers the
 * hosting panel is never silently overridden by a screen.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAdmin, requireAuth, requireManager,
} from '../middleware/auth.js';
import { clearSecret, saveSecret, saveSetting } from '../../config/secrets.js';
import { encryptionReady } from '../../lib/crypto.js';
import { badRequest } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { recentWebsiteLeads, websiteConnection } from '../../services/integration-status.js';
import { setupChecklist } from '../../services/setup-checklist.js';
import { sendInternalEmail } from '../../messaging/email/internal.js';
import { queryOne } from '../../db/client.js';
import { logger, errorContext } from '../../lib/logger.js';
import { rateLimit } from '../middleware/rate-limit.js';

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth, blockUntilPasswordChanged);

/**
 * What is still not switched on, as one list.
 *
 * Owner and admin only. Each of these fails quietly and in its own corner —
 * a send recorded as not sent, a workflow that never runs, a lead alert that
 * only arrives if the CRM happens to be open — so the owner had no way to see
 * that four separate things were waiting on them.
 */
integrationsRouter.get(
  '/setup-checklist',
  requireAdmin,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(await setupChecklist());
  }),
);

/**
 * Send the signed-in person a test email.
 *
 * Email is the one integration whose failure is completely silent: a wrong
 * SMTP key, a port the host blocks, a domain not yet verified — all of them
 * look exactly like "nothing happened". Without this the only way to find out
 * was to create a real lead and watch, which is a poor way to test anything
 * and worse on a live CRM with real clients in it.
 *
 * It sends only to the address of whoever pressed the button. Never to an
 * address supplied in the request: that would be an open relay, and an open
 * relay on an authenticated endpoint is still an open relay.
 */
integrationsRouter.post(
  '/email-test',
  requireAdmin,
  rateLimit({
    max: 6,
    windowMs: 10 * 60 * 1000,
    keyFor: (req) => `email-test:${currentUser(req).id}`,
    message: 'That is a lot of test emails. Give it a few minutes.',
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const me = await queryOne<{ email: string; name: string }>(
      'SELECT email, name FROM users WHERE id = ?',
      [user.id],
    );
    if (!me?.email) throw badRequest('Your own account has no email address on it.');

    const now = new Date().toISOString();
    const result = await sendInternalEmail({
      to: me.email,
      subject: 'Test email from your CRM',
      text: [
        `Hello ${me.name},`,
        '',
        'If you are reading this, the CRM can send email. That means new leads',
        'will reach your agents, and sales offers will reach your clients.',
        '',
        `Sent at ${now}.`,
      ].join('\n'),
    }).catch((err: unknown) => {
      logger.warn('test email failed', errorContext(err));
      return {
        sent: false as const,
        reason: err instanceof Error ? err.message : 'unknown',
      };
    });

    res.json({
      sent: result.sent,
      to: me.email,
      /* The real reason, not a tidy one: "Invalid login: 535 Authentication
         failed" is the sentence that tells somebody they pasted the API key
         where the SMTP key goes. Admin-only, so it is safe to show. */
      reason: result.sent ? null : (result.reason ?? 'unknown'),
    });
  }),
);

/** Reading the state is a manager's business; changing it is not. */
integrationsRouter.get(
  '/property-investment',
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      ...await websiteConnection(),
      recentLeads: await recentWebsiteLeads(),
    });
  }),
);

const body = z.object({
  /*
   * Trailing whitespace is the single most likely way this goes wrong: a value
   * copied out of a text file usually brings a newline, and the signature then
   * never matches. `saveSecret` trims, and this says so out loud rather than
   * leaving a 401 to be puzzled over.
   */
  secret: z.string().min(16).max(512).optional(),
  url: z.string().url().max(1024).nullish(),
});

integrationsRouter.put(
  '/property-investment',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const input = body.parse(req.body);
    const actor = actorFrom(req);

    if (input.secret !== undefined) {
      if (env().PROPERTY_INVESTMENT_HMAC_SECRET) {
        throw badRequest(
          'This secret is set in your hosting panel, which takes priority over anything saved here. '
          + 'Remove PROPERTY_INVESTMENT_HMAC_SECRET from the hosting panel first, or change it there instead.',
        );
      }
      if (!encryptionReady()) {
        throw badRequest(
          'The CRM cannot encrypt secrets yet, so it will not store one in the clear. '
          + 'Set a valid ENCRYPTION_KEY (64 hex characters) in your hosting settings, or remove it '
          + 'entirely and the CRM will look after its own key.',
        );
      }
      await saveSecret(actor, 'PROPERTY_INVESTMENT_HMAC_SECRET', input.secret);
    }

    if (input.url !== undefined) {
      await saveSetting(actor, 'PROPERTY_INVESTMENT_URL', input.url || null);
    }

    // The state as it now is, so the screen never has to guess what it did.
    res.json(await websiteConnection());
  }),
);

/** Disconnect. Leads stop being accepted at once, which is the point. */
integrationsRouter.delete(
  '/property-investment/secret',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    await clearSecret(actorFrom(req), 'PROPERTY_INVESTMENT_HMAC_SECRET');
    res.json(await websiteConnection());
  }),
);
