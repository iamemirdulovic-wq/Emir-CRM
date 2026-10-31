/**
 * Sending one email to one client.
 *
 * Everything a client-facing email needs, in the order it has to happen:
 *
 *   guards → merge → brand → test-mode redirect → provider → record
 *
 * The order is the point. Guards first, because the cheapest send is the one
 * that never happens to someone who asked us to stop. Record last and always,
 * including when the send failed, because a message the CRM cannot see is a
 * message nobody follows up.
 *
 * The composer and the campaign runner both come through here. There is no
 * second path to a client's inbox.
 */
import { randomUUID } from 'node:crypto';
import { execute, queryOne } from '../db/client.js';
import { env } from '../config/env.js';
import { brandingFrom, companyDetails } from '../config/company.js';
import { logger, errorContext } from '../lib/logger.js';
import { maskEmail } from '../lib/redact.js';
import { evaluateGuards, isRetryable } from '../workflows/guards.js';
import { loadGuardContext, recordOutbound, type SendOutcome } from '../messaging/send.js';
import { buildReplyAddress } from '../lib/email.js';
import { mailer } from '../messaging/email/send.js';
import { merge, unknownFields, type MergeValues } from './merge.js';
import { paragraphsToHtml, plainTextFallback, renderEmail, type Branding, type Sender } from './layout.js';
import { unsubscribeHeaders, unsubscribeUrl } from './unsubscribe.js';
import { applyTestMode, emailProvider } from './provider.js';

export interface ClientEmailRequest {
  contactId: string;
  opportunityId?: string | null;
  /** The agent sending. Their name and address are on the email. */
  userId: string | null;
  subject: string;
  /** Paragraphs as typed, with {{merge_fields}} still in them. */
  body: string;
  previewText?: string | null;
  templateKey?: string | null;
  /** Campaigns carry an unsubscribe link and a tracking pixel; replies do not. */
  campaignId?: string | null;
  automated?: boolean;
}

/** Everything the merge and the signature need, in one query each. */
async function loadSender(userId: string | null): Promise<Sender & { address: string | null }> {
  const cfg = env();
  const fallback = {
    name: cfg.MAIL_FROM ? cfg.MAIL_FROM.split('@')[0] ?? 'Emigeo Homes' : 'Emigeo Homes',
    address: cfg.MAIL_FROM ?? null,
  };
  if (!userId) return fallback;

  /*
   * Not wrapped in a catch. An error here means the query is wrong — a
   * renamed column, a missing one — and swallowing it would send every email
   * signed by the company instead of the agent, for ever, silently. A broken
   * query should be loud.
   */
  const user = await queryOne<{
    name: string; email: string; phone_e164: string | null; job_title: string | null;
    brn: string | null; photo_url: string | null;
  }>(
    `SELECT name, email, phone_e164, job_title, brn, photo_url
       FROM users WHERE id = ? AND is_active = 1`,
    [userId],
  );

  if (!user) return fallback;
  return {
    name: user.name,
    title: user.job_title,
    phone: user.phone_e164,
    email: user.email,
    brn: user.brn,
    photoUrl: user.photo_url,
    address: user.email || cfg.MAIL_FROM || null,
  };
}

/**
 * The company block at the foot of a client email.
 *
 * Same bug as the business card had: this read an `app_settings` row called
 * `company` and pulled `.name` out of its JSON, and nothing has written that
 * row since the Company screen was built — it stores one setting per field. So
 * every email to a client carried the hard-coded name no matter what the owner
 * had saved, with nothing anywhere to say so.
 */
async function loadBranding(): Promise<Branding> {
  return { ...brandingFrom(await companyDetails()), accent: null };
}

/** What a template's placeholders become for this particular contact. */
export async function mergeValuesFor(
  contactId: string,
  opportunityId: string | null,
  sender: Sender,
  companyName: string,
): Promise<MergeValues> {
  const row = await queryOne<{
    full_name: string | null;
    project_name: string | null;
    budget_band: string | null;
    unit_type: string | null;
    emirate: string | null;
  }>(
    `SELECT c.full_name, o.project_name, o.budget_band, o.unit_type, o.emirate
       FROM contacts c
       LEFT JOIN opportunities o
         ON o.id = COALESCE(?, (SELECT id FROM opportunities
                                 WHERE contact_id = c.id AND deleted_at IS NULL
                                 ORDER BY created_at DESC LIMIT 1))
      WHERE c.id = ?`,
    [opportunityId, contactId],
  );

  const full = row?.full_name ?? null;
  return {
    fullName: full,
    firstName: full ? (full.trim().split(/\s+/)[0] ?? null) : null,
    projectName: row?.project_name ?? null,
    budget: row?.budget_band ?? null,
    unitType: row?.unit_type ?? null,
    emirate: row?.emirate ?? null,
    agentName: sender.name,
    agentFirstName: sender.name.trim().split(/\s+/)[0] ?? sender.name,
    agentPhone: sender.phone ?? null,
    agentEmail: sender.email ?? null,
    companyName,
  };
}

export interface PreviewResult {
  subject: string;
  html: string;
  text: string;
  /** Merge fields the template used that do not exist. Blocks sending. */
  unknown: string[];
  /** Fields that fell back because this contact has no value for them. */
  usedFallback: string[];
  to: string | null;
}

/**
 * Exactly what would be sent, without sending it.
 *
 * The same code path as the send, deliberately — a preview built separately
 * is a preview that stops matching.
 */
export async function previewClientEmail(request: ClientEmailRequest): Promise<PreviewResult> {
  const [sender, branding] = await Promise.all([loadSender(request.userId), loadBranding()]);
  const values = await mergeValuesFor(
    request.contactId, request.opportunityId ?? null, sender, branding.companyName,
  );

  const subject = merge(request.subject, values, { html: false });
  const bodyText = merge(request.body, values, { html: false });
  const bodyHtml = merge(paragraphsToHtml(request.body), values);

  const contact = await queryOne<{ email: string | null }>(
    'SELECT email FROM contacts WHERE id = ?', [request.contactId],
  );

  /* Campaigns must carry an unsubscribe link; a one-to-one reply must not —
     offering to unsubscribe from a personal answer reads as a mailing list. */
  const unsubscribe = request.campaignId ? unsubscribeUrl(request.contactId) : null;

  return {
    subject: subject.text,
    html: renderEmail({
      bodyHtml: bodyHtml.text,
      sender,
      branding,
      unsubscribeUrl: unsubscribe,
      previewText: request.previewText ?? null,
    }),
    text: plainTextFallback({ bodyText: bodyText.text, sender, branding, unsubscribeUrl: unsubscribe }),
    unknown: [...new Set([...unknownFields(request.subject), ...unknownFields(request.body)])],
    usedFallback: [...new Set([...subject.usedFallback, ...bodyText.usedFallback])],
    to: contact?.email ?? null,
  };
}

/**
 * `SendOutcome` plus whether test mode redirected it.
 *
 * An intersection rather than an interface: SendOutcome is a union of three
 * shapes, and an interface extending it would quietly flatten the three into
 * one that allows nonsense like `{ sent: true, blocked: … }`.
 */
export type ClientEmailOutcome = SendOutcome & { redirected?: boolean };

export async function sendClientEmail(request: ClientEmailRequest): Promise<ClientEmailOutcome> {
  const automated = request.automated ?? Boolean(request.campaignId);

  /* 1. Guards. Consent, do-not-contact, the suppression list, quiet hours and
     the daily cap — the same ones WhatsApp faces, from the same code. */
  const { context, contact, conversationId } = await loadGuardContext(request.contactId, 'email');
  const decision = evaluateGuards(context, { channel: 'email', automated, isTemplate: false });
  if (!decision.allowed) {
    logger.info('client email blocked by a guard', {
      contactId: request.contactId, reason: decision.reason,
    });
    return { sent: false, blocked: decision, retryable: isRetryable(decision) };
  }

  if (!contact.email) {
    return {
      sent: false,
      blocked: { allowed: false, reason: 'no_consent', message: 'This contact has no email address' },
      retryable: false,
    };
  }

  /* 2. Merge and brand. */
  const built = await previewClientEmail(request);
  if (built.unknown.length > 0) {
    return {
      sent: false,
      blocked: {
        allowed: false,
        reason: 'no_consent',
        message: `This email uses fields that do not exist: ${built.unknown.join(', ')}`,
      },
      retryable: false,
    };
  }

  const sender = await loadSender(request.userId);
  const cfg = env();

  /* 3. Test mode, at the last possible moment. */
  const { message, redirected } = applyTestMode({
    to: contact.email,
    toLabel: undefined,
    from: sender.address ?? cfg.MAIL_FROM ?? 'no-reply@localhost',
    fromName: sender.name,
    ...(conversationId && cfg.MAIL_REPLY_DOMAIN
      ? { replyTo: buildReplyAddress(conversationId, cfg.MAIL_REPLY_DOMAIN) }
      : {}),
    subject: built.subject,
    html: built.html,
    text: built.text,
    headers: request.campaignId ? unsubscribeHeaders(request.contactId) : {},
  } as never);

  /* 4. Send. */
  const provider = emailProvider(mailer());
  const result = await provider.send(message);

  if (!result.sent) {
    logger.warn('client email did not send', {
      contactId: request.contactId,
      to: maskEmail(contact.email),
      provider: result.provider,
      reason: result.reason,
    });
  }

  /* 5. Record, whether or not it sent. A message the CRM cannot see is a
     message nobody follows up. */
  const outcome = await recordOutbound({
    contactId: request.contactId,
    conversationId,
    channel: 'email',
    provider: result.provider,
    providerMessageId: result.providerMessageId ?? null,
    userId: request.userId,
    isAutomated: automated,
    templateName: request.templateKey ?? null,
    templateLanguage: null,
    subject: built.subject,
    body: built.text,
    payload: {
      ...(request.campaignId ? { campaignId: request.campaignId } : {}),
      ...(redirected ? { testRedirectedTo: message.to } : {}),
    },
    ok: result.sent,
    errorCode: result.sent ? null : 'send_failed',
    errorMessage: result.sent ? null : (result.reason ?? 'The provider refused it').slice(0, 500),
    opportunityId: request.opportunityId ?? null,
  });

  /* The message row exists for a success and for a recorded failure; only a
     guard block has none to tag. */
  const messageId = 'messageId' in outcome ? outcome.messageId : null;
  if (request.campaignId && messageId) {
    await execute(
      'UPDATE messages SET email_campaign_id = ? WHERE id = ?',
      [request.campaignId, messageId],
    ).catch((err: unknown) => logger.warn('could not tag the message with its campaign', errorContext(err)));
  }

  return { ...outcome, redirected };
}

/* ── Opting out ─────────────────────────────────────────────────────────── */

/**
 * Stop emailing someone, for good.
 *
 * Three writes, and all three matter. The consent row is what the guards
 * read. The suppression is on the address itself, so the same person under a
 * second contact record is still covered. And the event is what the campaign
 * report counts — without it an unsubscribe looks like silence.
 */
export async function recordUnsubscribe(
  contactId: string,
  source: string,
  campaignId: string | null = null,
): Promise<{ email: string | null }> {
  const contact = await queryOne<{ email: string | null }>(
    'SELECT email FROM contacts WHERE id = ?', [contactId],
  );

  await execute(
    `INSERT INTO consents (id, contact_id, channel, granted, source, consent_text)
     VALUES (?, ?, 'email', 0, ?, 'Unsubscribed from a link in an email')`,
    [randomUUID(), contactId, source.slice(0, 60)],
  );

  if (contact?.email) {
    await execute(
      `INSERT IGNORE INTO suppressions (id, kind, value, reason)
       VALUES (?, 'email', ?, 'user_opt_out')`,
      [randomUUID(), contact.email],
    );
  }

  await execute(
    `INSERT INTO email_events (id, contact_id, campaign_id, type, occurred_at)
     VALUES (?, ?, ?, 'unsubscribed', NOW(3))`,
    [randomUUID(), contactId, campaignId],
  ).catch((err: unknown) => logger.warn('could not record the unsubscribe event', errorContext(err)));

  if (campaignId) {
    await execute(
      'UPDATE email_campaigns SET unsubscribed_count = unsubscribed_count + 1 WHERE id = ?',
      [campaignId],
    ).catch(() => undefined);
  }

  logger.info('contact unsubscribed from email', { contactId, source });
  return { email: contact?.email ?? null };
}
