import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger, errorContext } from '../../lib/logger.js';
import { maskEmail } from '../../lib/redact.js';
import { queryOne } from '../../db/client.js';
import { buildReplyAddress } from '../../lib/email.js';
import { evaluateGuards, isRetryable } from '../../workflows/guards.js';
import { loadGuardContext, recordOutbound, type SendOutcome } from '../send.js';

let transporter: Transporter | null = null;

export function mailer(): Transporter | null {
  const cfg = env();
  if (!cfg.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: cfg.SMTP_PORT,
      secure: cfg.SMTP_SECURE,
      auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

export function setMailerForTesting(next: Transporter | null): void {
  transporter = next;
}

export type EmailSendRequest = {
  contactId: string;
  opportunityId?: string | null;
  automated: boolean;
  /** The agent sending by hand; their address becomes the From. */
  userId?: string | null;
  bypassQuietHours?: boolean;
  subject: string;
  text: string;
  html?: string;
};

/**
 * Send an email through the same guards as WhatsApp.
 *
 * Outbound mail is sent from the agent's own address with
 * `Reply-To: reply+{conversation_id}@domain`, so the lead's reply lands back in
 * the right thread via the IMAP poll.
 */
export async function sendEmail(request: EmailSendRequest): Promise<SendOutcome> {
  const { context, contact, conversationId } = await loadGuardContext(request.contactId, 'email');

  const decision = evaluateGuards(context, {
    channel: 'email',
    automated: request.automated,
    isTemplate: false,
    ...(request.bypassQuietHours === undefined ? {} : { bypassQuietHours: request.bypassQuietHours }),
  });
  if (!decision.allowed) {
    logger.info('email send blocked by a guard', { contactId: request.contactId, reason: decision.reason });
    return { sent: false, blocked: decision, retryable: isRetryable(decision) };
  }

  if (!contact.email) {
    return {
      sent: false,
      blocked: { allowed: false, reason: 'no_consent', message: 'Contact has no email address' },
      retryable: false,
    };
  }

  const cfg = env();
  const agent = request.userId
    ? await queryOne<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = ?', [request.userId])
    : null;

  const from = agent ? `"${agent.name}" <${agent.email}>` : (cfg.MAIL_FROM ?? cfg.SMTP_USER ?? 'no-reply@localhost');
  const replyTo =
    cfg.MAIL_REPLY_DOMAIN && conversationId ? buildReplyAddress(conversationId, cfg.MAIL_REPLY_DOMAIN) : undefined;

  const transport = mailer();
  let providerMessageId: string | null = null;
  let ok = false;
  let errorMessage: string | null = null;

  if (!transport) {
    // No SMTP configured: record the message so the thread is still complete,
    // and say plainly that it was not delivered.
    logger.warn('SMTP is not configured; email recorded but not delivered', {
      to: maskEmail(contact.email),
      subject: request.subject,
    });
    errorMessage = 'SMTP is not configured';
  } else {
    try {
      const info = await transport.sendMail({
        from,
        to: contact.email,
        subject: request.subject,
        text: request.text,
        ...(request.html ? { html: request.html } : {}),
        ...(replyTo ? { replyTo } : {}),
        headers: {
          ...(conversationId ? { 'X-Emir-Conversation': conversationId } : {}),
        },
      });
      providerMessageId = info.messageId ?? null;
      ok = true;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('email send failed', { to: maskEmail(contact.email), ...errorContext(err) });
    }
  }

  return recordOutbound({
    contactId: request.contactId,
    conversationId,
    channel: 'email',
    provider: 'smtp',
    providerMessageId,
    userId: request.userId ?? null,
    isAutomated: request.automated,
    templateName: null,
    templateLanguage: null,
    subject: request.subject,
    body: request.text,
    payload: { replyTo: replyTo ?? null },
    ok,
    errorCode: ok ? null : 'smtp_error',
    errorMessage,
    opportunityId: request.opportunityId ?? null,
    toLabel: maskEmail(contact.email),
  });
}
