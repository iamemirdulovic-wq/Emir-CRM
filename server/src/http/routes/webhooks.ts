import { Router, type Request, type Response } from 'express';
import { env } from '../../config/env.js';
import { verifyHmacSignature, verifyMetaSignature, safeEqual } from '../../lib/crypto.js';
import { logger, errorContext } from '../../lib/logger.js';
import { processAfterResponse } from '../../lib/after-response.js';
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
import {
  SITE,
  consentUnknown,
  normalizePropertyInvestmentLead,
  propertyInvestmentEventSchema,
  propertyInvestmentExternalId,
} from '../../ingestion/sources/property-investment.js';
import { describeEvent, saveWebsiteContext } from '../../services/website-leads.js';
import { secret } from '../../config/secrets.js';
import { withRetryingTransaction } from '../../db/client.js';
import { handleInboundMessage, handleStatusUpdate } from '../../ingestion/whatsapp-inbound.js';
import { addActivity, ingestLead } from '../../ingestion/ingest.js';
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

// ---------------------------------------------------------------------------
// property-investment.ae
// ---------------------------------------------------------------------------

/**
 * Their site knows a great deal about a buyer before we speak to them — which
 * projects they browsed, what the matchmaker asked, the site's own score. The
 * generic `/webhooks/website` endpoint above takes a plain contact form and
 * has nowhere to put any of it, which is why this one exists.
 *
 * The lead itself goes through the ordinary path: one contact, one
 * opportunity, identity resolution, sticky ownership, the SLA. Only the
 * site-specific part is stored separately. See migration 0012.
 */
webhookRouter.post(
  '/property-investment',
  asyncHandler(async (req: Request, res: Response) => {
    const sharedSecret = await secret('PROPERTY_INVESTMENT_HMAC_SECRET');
    if (!sharedSecret) {
      logger.error('property-investment webhook has no shared secret configured');
      res.status(503).json({
        error: { code: 'not_configured', message: 'property-investment.ae intake is not configured' },
      });
      return;
    }

    /*
     * Signature before parsing. An unsigned caller must not be able to reach
     * the schema, the database or the logs with a body of their choosing.
     */
    const signatureValid = verifyHmacSignature(
      rawBodyOf(req),
      req.get('x-signature') ?? req.get('x-hub-signature-256'),
      sharedSecret,
    );
    if (!signatureValid) {
      logger.warn('rejected unsigned property-investment event');
      res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid signature' } });
      return;
    }

    const parsed = propertyInvestmentEventSchema.safeParse(req.body);
    if (!parsed.success) {
      /*
       * 400, not 500, and the reason is returned: their developer is the one
       * who has to fix it, and a silent failure here is a lead nobody ever
       * learns was lost.
       */
      logger.warn('property-investment event failed validation', { issues: parsed.error.issues.length });
      res.status(400).json({
        error: { code: 'bad_request', message: 'Event did not match the agreed shape', details: parsed.error.issues },
      });
      return;
    }

    const event = parsed.data;
    const externalId = propertyInvestmentExternalId(event.lead);

    /*
     * One raw row per delivery, keyed by the event as well as the lead: a
     * `lead.updated` must be stored, not swallowed as a duplicate of the
     * `lead.created` that came before it.
     */
    const recorded = await recordInboundEvent({
      source: 'property_investment',
      externalId: `${externalId}:${event.event}:${event.sent_at ?? ''}`,
      payload: req.body,
      signatureValid: true,
    });

    // Answer first. A duplicate is a success: replaying must never look broken
    // to the sender, or their retry logic will hammer us or give up.
    res.status(202).json({ ok: true, external_id: externalId, duplicate: recorded.duplicate });

    processAfterResponse(res, async () => {
      if (recorded.duplicate) return;
      try {
        await markEventProcessing(recorded.id);
        const lead = normalizePropertyInvestmentLead(
          event.lead,
          clientIp(req),
          req.get('user-agent') ?? null,
        );
        const result = await ingestLead(lead, { inboundEventId: recorded.id });

        await saveWebsiteContext({
          event,
          contactId: result.contactId,
          opportunityId: result.opportunityId,
        });

        await withRetryingTransaction(async (tx) => {
          await addActivity(tx, {
            contactId: result.contactId,
            opportunityId: result.opportunityId,
            type: 'website_lead',
            title: event.event === 'lead.created'
              ? `New lead from ${SITE}`
              : `Updated on ${SITE}`,
            body: describeEvent(event),
            meta: {
              site: SITE,
              external_id: externalId,
              public_ref: event.lead.public_ref ?? null,
              site_status: event.lead.status ?? null,
              temperature: event.lead.temperature ?? null,
              /*
               * Flagged because it decides whether the instant WhatsApp reply
               * may go out at all. A site that never sends consent silently
               * turns speed-to-lead off, and the agent should be able to see
               * that on the card rather than wonder why nothing was sent.
               */
              consent_missing: consentUnknown(event.lead),
            },
          });
        });

        await markEventProcessed(recorded.id, {
          contactId: result.contactId,
          opportunityId: result.opportunityId,
        });
      } catch (err) {
        logger.error('property-investment lead processing failed', errorContext(err));
        await markEventFailed(recorded.id, err);
      }
    });
  }),
);
