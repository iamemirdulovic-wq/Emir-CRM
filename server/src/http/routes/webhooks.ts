import { Router, type Request, type Response } from 'express';
import { env } from '../../config/env.js';
import { verifyHmacSignature, verifyMetaSignature, safeEqual } from '../../lib/crypto.js';
import { logger, errorContext } from '../../lib/logger.js';
import { clientIp } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import {
  markEventFailed,
  markEventIgnored,
  markEventProcessed,
  markEventProcessing,
  recordInboundEvent,
} from '../../ingestion/events.js';
import { extractLeadgenNotifications } from '../../ingestion/sources/meta.js';
import { parseWhatsAppWebhook } from '../../ingestion/sources/whatsapp.js';
import { googleLeadSchema, normalizeGoogleLead } from '../../ingestion/sources/google.js';
import {
  isSpam,
  normalizeWebsiteLead,
  verifyRecaptcha,
  websiteExternalId,
  websiteFormSchema,
} from '../../ingestion/sources/website.js';
import { handleInboundMessage, handleStatusUpdate } from '../../ingestion/whatsapp-inbound.js';
import { ingestLead } from '../../ingestion/ingest.js';
import { enqueue } from '../../jobs/queue.js';

export const webhookRouter = Router();

/**
 * Every webhook follows the same order:
 *   verify the signature → store the raw payload → return 200 in under 2
 *   seconds → process.
 *
 * Processing happens after the response has been flushed, so a slow Graph API
 * call can never make Meta retry a webhook we already accepted.
 */
function processAfterResponse(res: Response, work: () => Promise<void>): void {
  const run = () => {
    work().catch((err) => logger.error('webhook processing failed', errorContext(err)));
  };
  if (res.writableEnded) setImmediate(run);
  else res.on('finish', run);
}

function rawBodyOf(req: Request): Buffer {
  return req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
}

// ---------------------------------------------------------------------------
// Meta webhook verification (shared by Lead Ads and WhatsApp)
// ---------------------------------------------------------------------------

function handleVerification(req: Request, res: Response): void {
  const verifyToken = env().META_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (!verifyToken) {
    logger.error('META_VERIFY_TOKEN is not configured; cannot complete webhook verification');
    res.sendStatus(500);
    return;
  }
  if (mode === 'subscribe' && typeof token === 'string' && safeEqual(token, verifyToken)) {
    res.status(200).send(String(challenge ?? ''));
    return;
  }
  logger.warn('webhook verification rejected', { mode: String(mode ?? '') });
  res.sendStatus(403);
}

webhookRouter.get('/meta/leadgen', handleVerification);
webhookRouter.get('/whatsapp', handleVerification);

// ---------------------------------------------------------------------------
// Meta Lead Ads
// ---------------------------------------------------------------------------

webhookRouter.post(
  '/meta/leadgen',
  asyncHandler(async (req: Request, res: Response) => {
    const appSecret = env().META_APP_SECRET;
    const signatureValid = appSecret
      ? verifyMetaSignature(rawBodyOf(req), req.get('x-hub-signature-256'), appSecret)
      : false;

    if (appSecret && !signatureValid) {
      logger.warn('rejected meta leadgen webhook with a bad signature');
      res.sendStatus(401);
      return;
    }

    const notifications = extractLeadgenNotifications(req.body);
    if (notifications.length === 0) {
      res.sendStatus(200);
      return;
    }

    // Store every notification before responding, so nothing is lost if the
    // process dies a millisecond later.
    const stored = await Promise.all(
      notifications.map(async (n) => ({
        notification: n,
        event: await recordInboundEvent({
          source: 'meta_lead_ads',
          externalId: n.leadgen_id,
          payload: { notification: n, envelope: req.body },
          signatureValid,
        }),
      })),
    );

    res.sendStatus(200);

    processAfterResponse(res, async () => {
      for (const { notification, event } of stored) {
        if (event.duplicate) {
          logger.info('replayed meta leadgen webhook ignored', { leadgenId: notification.leadgen_id });
          continue;
        }
        // The webhook carries only ids, so the answers are fetched in a job
        // that can retry if Graph is briefly unavailable.
        await enqueue(
          'meta.fetch_lead',
          {
            leadgenId: notification.leadgen_id,
            formId: notification.form_id ?? null,
            inboundEventId: event.id,
          },
          { priority: 1, dedupeKey: `meta-lead:${notification.leadgen_id}` },
        );
      }
    });
  }),
);

// ---------------------------------------------------------------------------
// WhatsApp Cloud API
// ---------------------------------------------------------------------------

webhookRouter.post(
  '/whatsapp',
  asyncHandler(async (req: Request, res: Response) => {
    const appSecret = env().META_APP_SECRET;
    const signatureValid = appSecret
      ? verifyMetaSignature(rawBodyOf(req), req.get('x-hub-signature-256'), appSecret)
      : false;

    if (appSecret && !signatureValid) {
      logger.warn('rejected whatsapp webhook with a bad signature');
      res.sendStatus(401);
      return;
    }

    const parsed = parseWhatsAppWebhook(req.body);
    if (parsed.messages.length === 0 && parsed.statuses.length === 0) {
      res.sendStatus(200);
      return;
    }

    const events = await Promise.all([
      ...parsed.messages.map(async (message) => ({
        kind: 'message' as const,
        message,
        event: await recordInboundEvent({
          source: 'whatsapp',
          externalId: `msg:${message.providerMessageId}`,
          payload: message.raw,
          signatureValid,
        }),
      })),
      ...parsed.statuses.map(async (status) => ({
        kind: 'status' as const,
        status,
        event: await recordInboundEvent({
          source: 'whatsapp',
          // A message moves sent → delivered → read, so the status is part of
          // the key; only an identical repeat is a duplicate.
          externalId: `status:${status.providerMessageId}:${status.status}`,
          payload: status.raw,
          signatureValid,
        }),
      })),
    ]);

    res.sendStatus(200);

    processAfterResponse(res, async () => {
      for (const item of events) {
        if (item.event.duplicate) continue;
        try {
          await markEventProcessing(item.event.id);
          if (item.kind === 'message') {
            const result = await handleInboundMessage(item.message);
            await markEventProcessed(item.event.id, { contactId: result.contactId });
          } else {
            const applied = await handleStatusUpdate(item.status);
            if (applied) await markEventProcessed(item.event.id);
            else await markEventIgnored(item.event.id, 'status did not apply (unknown or stale)');
          }
        } catch (err) {
          logger.error('whatsapp event processing failed', errorContext(err));
          await markEventFailed(item.event.id, err);
        }
      }
    });
  }),
);

// ---------------------------------------------------------------------------
// Website forms
// ---------------------------------------------------------------------------

webhookRouter.post(
  '/website',
  asyncHandler(async (req: Request, res: Response) => {
    const cfg = env();
    const payload = websiteFormSchema.parse(req.body);
    const ip = clientIp(req);

    // Either an HMAC over the raw body (server-to-server) or a reCAPTCHA token
    // (browser). Both are accepted; at least one must be configured.
    let authenticated = false;
    let method = 'none';

    if (cfg.WEBSITE_FORM_HMAC_SECRET) {
      authenticated = verifyHmacSignature(rawBodyOf(req), req.get('x-signature') ?? req.get('x-hub-signature-256'), cfg.WEBSITE_FORM_HMAC_SECRET);
      method = 'hmac';
    }
    if (!authenticated && cfg.RECAPTCHA_SECRET && payload.recaptcha_token) {
      authenticated = await verifyRecaptcha(payload.recaptcha_token, cfg.RECAPTCHA_SECRET, ip);
      method = 'recaptcha';
    }
    if (!cfg.WEBSITE_FORM_HMAC_SECRET && !cfg.RECAPTCHA_SECRET) {
      logger.error('website form endpoint has no WEBSITE_FORM_HMAC_SECRET or RECAPTCHA_SECRET configured');
      res.status(503).json({ error: { code: 'not_configured', message: 'Website form intake is not configured' } });
      return;
    }
    if (!authenticated) {
      logger.warn('rejected unauthenticated website form submission', { method });
      res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid form signature' } });
      return;
    }

    const event = await recordInboundEvent({
      source: 'website',
      externalId: websiteExternalId(payload),
      payload: req.body,
      signatureValid: true,
    });

    if (isSpam(payload)) {
      await markEventIgnored(event.id, 'honeypot field was filled');
      res.status(202).json({ ok: true });
      return;
    }

    res.status(202).json({ ok: true });

    processAfterResponse(res, async () => {
      if (event.duplicate) return;
      try {
        await markEventProcessing(event.id);
        const lead = await normalizeWebsiteLead(payload, ip, req.get('user-agent') ?? null);
        const result = await ingestLead(lead, { inboundEventId: event.id });
        await markEventProcessed(event.id, { contactId: result.contactId, opportunityId: result.opportunityId });
      } catch (err) {
        logger.error('website lead processing failed', errorContext(err));
        await markEventFailed(event.id, err);
      }
    });
  }),
);

// ---------------------------------------------------------------------------
// Google Ads lead forms
// ---------------------------------------------------------------------------

webhookRouter.post(
  '/google',
  asyncHandler(async (req: Request, res: Response) => {
    const expectedKey = env().GOOGLE_LEAD_FORM_KEY;
    if (!expectedKey) {
      logger.error('GOOGLE_LEAD_FORM_KEY is not configured');
      res.status(503).json({ error: { code: 'not_configured', message: 'Google lead intake is not configured' } });
      return;
    }

    const payload = googleLeadSchema.parse(req.body);
    if (!payload.google_key || !safeEqual(payload.google_key, expectedKey)) {
      logger.warn('rejected google lead with a bad google_key');
      res.sendStatus(401);
      return;
    }

    const event = await recordInboundEvent({
      source: 'google_ads',
      externalId: payload.lead_id,
      // Never store the shared key alongside the lead.
      payload: { ...req.body, google_key: '[redacted]' },
      signatureValid: true,
    });

    res.sendStatus(200);

    processAfterResponse(res, async () => {
      if (event.duplicate) return;
      if (payload.is_test) {
        await markEventIgnored(event.id, 'Google test lead');
        return;
      }
      try {
        await markEventProcessing(event.id);
        const lead = await normalizeGoogleLead(payload);
        const result = await ingestLead(lead, { inboundEventId: event.id });
        await markEventProcessed(event.id, { contactId: result.contactId, opportunityId: result.opportunityId });
      } catch (err) {
        logger.error('google lead processing failed', errorContext(err));
        await markEventFailed(event.id, err);
      }
    });
  }),
);
