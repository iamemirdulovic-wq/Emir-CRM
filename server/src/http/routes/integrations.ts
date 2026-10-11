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
  actorFrom, blockUntilPasswordChanged, requireAdmin, requireAuth, requireManager,
} from '../middleware/auth.js';
import { clearSecret, saveSecret, saveSetting } from '../../config/secrets.js';
import { encryptionReady } from '../../lib/crypto.js';
import { badRequest } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { recentWebsiteLeads, websiteConnection } from '../../services/integration-status.js';

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth, blockUntilPasswordChanged);

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
