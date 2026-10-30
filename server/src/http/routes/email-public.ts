import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from '../middleware/error.js';
import { execute, queryOne } from '../../db/client.js';
import { env } from '../../config/env.js';
import { logger, errorContext } from '../../lib/logger.js';
import { verifyHmacSignature } from '../../lib/crypto.js';
import { contactFromToken } from '../../email/unsubscribe.js';
import { recordUnsubscribe } from '../../email/send-client.js';
import { addActivity } from '../../ingestion/ingest.js';
import { getPool } from '../../db/client.js';

/**
 * The two email routes that have no login: the unsubscribe page a client
 * clicks, and the webhook the provider posts to.
 *
 * Neither can be behind auth — one is clicked by a member of the public and
 * the other by a server — so both prove themselves another way. The
 * unsubscribe link carries a signature of the contact id; the webhook carries
 * the provider's signature of its own body.
 */
export const emailPublicRouter = Router();

/* ── Unsubscribe ────────────────────────────────────────────────────────── */

function page(title: string, message: string, tone: 'ok' | 'bad' = 'ok'): string {
  const accent = tone === 'ok' ? '#0AA3BA' : '#D98A8A';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#EAF3F8;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0E1B2C}
  .card{max-width:460px;margin:16px;padding:32px;background:#fff;border-radius:18px;
        box-shadow:0 8px 30px rgba(15,50,90,.08);text-align:center}
  h1{margin:0 0 10px;font-size:21px;color:${accent}}
  p{margin:0;line-height:1.6;color:#4A5B70;font-size:15px}
  @media (prefers-color-scheme:dark){
    body{background:#060D1A;color:#EAF4FF}
    .card{background:#162234;box-shadow:none}
    p{color:#A7B7CC}
  }
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

/**
 * One click from an email.
 *
 * GET unsubscribes immediately rather than showing a confirm button. A
 * confirmation step is one more thing between somebody asking to be left
 * alone and it happening, and the people who click this are already annoyed.
 * The risk a mail client "prefetches" the link and unsubscribes somebody by
 * accident is real but small, and far smaller than the risk of ignoring a
 * request to stop.
 */
emailPublicRouter.get(
  '/u/:token',
  asyncHandler(async (req: Request, res: Response) => {
    const contactId = contactFromToken(String(req.params.token));
    if (!contactId) {
      return void res
        .status(400)
        .type('html')
        .send(page('That link is not valid', 'Please reply to any of our emails and we will take you off the list by hand.', 'bad'));
    }

    await recordUnsubscribe(contactId, 'email_link');
    await addActivity(getPool(), {
      contactId,
      type: 'email_unsubscribed',
      title: 'Unsubscribed from email',
      body: 'They used the unsubscribe link in an email.',
    }).catch((err: unknown) => logger.warn('could not record the unsubscribe activity', errorContext(err)));

    res.type('html').send(page(
      'You are unsubscribed',
      'You will not get any more marketing emails from us. '
      + 'If you are working with one of our advisors, they can still reply to you directly.',
    ));
  }),
);

/** The RFC 8058 one-click form Gmail and Outlook POST to. */
emailPublicRouter.post(
  '/u/:token',
  asyncHandler(async (req: Request, res: Response) => {
    const contactId = contactFromToken(String(req.params.token));
    if (!contactId) return void res.status(400).json({ ok: false });
    await recordUnsubscribe(contactId, 'one_click');
    res.json({ ok: true });
  }),
);

/* ── Tracking webhook ───────────────────────────────────────────────────── */

/** The provider's words for what happened, in ours. */
const EVENT_TYPES: Record<string, string> = {
  delivered: 'delivered',
  opened: 'opened',
  unique_opened: 'opened',
  open: 'opened',
  click: 'clicked',
  clicked: 'clicked',
  hard_bounce: 'bounced',
  soft_bounce: 'bounced',
  bounce: 'bounced',
  blocked: 'bounced',
  spam: 'complained',
  complaint: 'complained',
  unsubscribed: 'unsubscribed',
  deferred: 'deferred',
};

interface ProviderEvent {
  event?: string;
  type?: string;
  'message-id'?: string;
  messageId?: string;
  link?: string;
  url?: string;
  id?: string | number;
  ts?: number;
  date?: string;
}

/**
 * What the provider says happened after a message left.
 *
 * Unsigned requests are refused outright rather than trusted: this endpoint
 * writes to the database from the open internet, and "opened" events a
 * stranger can post are worse than no tracking at all — they would feed a
 * lead score and tell an agent to ring somebody who never looked.
 */
emailPublicRouter.post(
  '/webhooks/email',
  asyncHandler(async (req: Request, res: Response) => {
    const secret = env().EMAIL_WEBHOOK_SECRET;
    if (!secret) {
      logger.warn('an email webhook arrived but no EMAIL_WEBHOOK_SECRET is set; ignoring it');
      return void res.status(503).json({ ok: false });
    }

    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const signature = req.get('x-mailin-signature') ?? req.get('x-webhook-signature') ?? req.get('svix-signature');
    if (!verifyHmacSignature(raw, signature, secret)) {
      logger.warn('an email webhook had a bad signature; ignoring it');
      return void res.status(401).json({ ok: false });
    }

    /* Answer first, work after: a provider that waits on us retries, and a
       retry storm is how tracking takes the CRM down. */
    res.json({ ok: true });

    const body = req.body as ProviderEvent | ProviderEvent[];
    const events = Array.isArray(body) ? body : [body];
    for (const event of events) {
      await recordEmailEvent(event).catch((err: unknown) =>
        logger.warn('could not record an email event', errorContext(err)));
    }
  }),
);

export async function recordEmailEvent(event: ProviderEvent): Promise<void> {
  const rawType = String(event.event ?? event.type ?? '').toLowerCase();
  const type = EVENT_TYPES[rawType];
  if (!type) return;

  const providerMessageId = event['message-id'] ?? event.messageId ?? null;
  if (!providerMessageId) return;

  const message = await queryOne<{ id: string; contact_id: string; email_campaign_id: string | null }>(
    'SELECT id, contact_id, email_campaign_id FROM messages WHERE provider_message_id = ? LIMIT 1',
    [providerMessageId],
  );
  /* An event for a message we have no record of is not an error — it may be
     a staff email, or one sent before this CRM existed. */
  if (!message) return;

  const occurredAt = event.ts ? new Date(event.ts * 1000) : event.date ? new Date(event.date) : new Date();

  await execute(
    `INSERT IGNORE INTO email_events
       (id, message_id, contact_id, campaign_id, type, url, provider_event_id, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(), message.id, message.contact_id, message.email_campaign_id, type,
      (event.link ?? event.url ?? null)?.slice(0, 1024) ?? null,
      event.id ? `${providerMessageId}:${rawType}:${event.id}` : null,
      occurredAt,
    ],
  );

  /* The summary columns the inbox reads, set once and never moved backwards:
     the first open is the interesting one. */
  if (type === 'opened') {
    await execute('UPDATE messages SET opened_at = COALESCE(opened_at, ?) WHERE id = ?', [occurredAt, message.id]);
  }
  if (type === 'clicked') {
    await execute('UPDATE messages SET clicked_at = COALESCE(clicked_at, ?) WHERE id = ?', [occurredAt, message.id]);
  }
  if (type === 'bounced' || type === 'complained') {
    await execute("UPDATE messages SET status = 'failed', error_code = ? WHERE id = ?", [type, message.id]);
  }

  if (message.email_campaign_id) {
    const column = {
      opened: 'opened_count', clicked: 'clicked_count',
      bounced: 'bounced_count', complained: 'bounced_count',
    }[type];
    if (column) {
      await execute(
        `UPDATE email_campaigns SET ${column} = ${column} + 1 WHERE id = ?`,
        [message.email_campaign_id],
      );
    }
  }

  /*
   * An open or a click is a thing the agent should see on the lead, not just
   * a number in a report. A bounce is too — it usually means the address is
   * wrong and the lead needs a phone call instead.
   */
  if (type === 'opened' || type === 'clicked' || type === 'bounced') {
    await addActivity(getPool(), {
      contactId: message.contact_id,
      type: `email_${type}`,
      title: {
        opened: 'Opened your email',
        clicked: 'Clicked a link in your email',
        bounced: 'Your email bounced',
      }[type] as string,
      body: type === 'clicked' ? (event.link ?? event.url ?? null) : null,
    }).catch((err: unknown) => logger.warn('could not record an email activity', errorContext(err)));
  }

  /* A complaint is a stronger signal than an unsubscribe and gets the same
     treatment: stop emailing this person. */
  if (type === 'complained' || type === 'unsubscribed') {
    await recordUnsubscribe(message.contact_id, `provider_${type}`, message.email_campaign_id)
      .catch((err: unknown) => logger.warn('could not act on a complaint', errorContext(err)));
  }
}

