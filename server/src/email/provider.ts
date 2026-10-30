/**
 * Where a client email actually goes.
 *
 * Two things live here and they are the two that matter most in this whole
 * step, because both failure modes are "a real email reached a real client
 * who should not have got it".
 *
 * **The off switch.** `FEATURE_EMAIL_SENDING` is false by default. With it
 * off, everything upstream works — the template merges, the message is
 * recorded, the campaign reports — and nothing leaves the building. That is
 * the state the CRM should be in while it is being built and demonstrated.
 *
 * **Test mode.** With `EMAIL_TEST_MODE` on, every message is redirected to
 * one address with the real recipient written into the subject, so the whole
 * path can be exercised against a real provider without a client ever seeing
 * it. The redirect happens here, at the last possible moment, rather than in
 * a caller that might be bypassed.
 *
 * Providers themselves are deliberately thin. The CRM owns the content, the
 * guards and the record; a provider only carries bytes.
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { maskEmail } from '../lib/redact.js';

export interface OutboundEmail {
  to: string;
  toName?: string | null;
  from: string;
  fromName?: string | null;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  sent: boolean;
  providerMessageId?: string | null;
  provider: string;
  /** Why not, in words that can be shown to a person. */
  reason?: string;
  /** Worth trying again — a timeout, a 503. A rejected address is not. */
  retryable?: boolean;
}

export interface EmailProvider {
  readonly name: string;
  send(message: OutboundEmail): Promise<SendResult>;
}

/* ── Test mode ──────────────────────────────────────────────────────────── */

export interface Redirected {
  message: OutboundEmail;
  redirected: boolean;
}

/**
 * Point a message at the test address, if test mode is on.
 *
 * The real recipient goes into the subject rather than being dropped, because
 * the question being asked in test mode is always "did the right person get
 * the right thing", and an inbox of forty identical subjects cannot answer it.
 */
export function applyTestMode(message: OutboundEmail): Redirected {
  const cfg = env();
  if (!cfg.EMAIL_TEST_MODE) return { message, redirected: false };

  const to = cfg.EMAIL_TEST_REDIRECT;
  if (!to) {
    /* Test mode on with nowhere to send is a configuration mistake, and the
       safe reading of it is "do not send", never "send to the client". */
    throw new Error('EMAIL_TEST_MODE is on but EMAIL_TEST_REDIRECT is not set');
  }

  return {
    redirected: true,
    message: {
      ...message,
      to,
      toName: null,
      subject: `[TEST → ${message.to}] ${message.subject}`,
      headers: { ...message.headers, 'X-Emir-Real-Recipient': message.to },
    },
  };
}

/* ── Providers ──────────────────────────────────────────────────────────── */

/** Records and discards. What runs when sending is switched off. */
export class NullProvider implements EmailProvider {
  readonly name = 'none';

  async send(message: OutboundEmail): Promise<SendResult> {
    logger.info('email not sent: sending is switched off', {
      to: maskEmail(message.to),
      subject: message.subject.slice(0, 80),
    });
    return { sent: false, provider: this.name, reason: 'Email sending is switched off', retryable: false };
  }
}

/** The existing SMTP transport, wrapped in the provider interface. */
export class SmtpProvider implements EmailProvider {
  readonly name = 'smtp';

  constructor(private readonly transport: {
    sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }>;
  }) {}

  async send(message: OutboundEmail): Promise<SendResult> {
    try {
      const info = await this.transport.sendMail({
        from: message.fromName ? `"${message.fromName}" <${message.from}>` : message.from,
        to: message.toName ? `"${message.toName}" <${message.to}>` : message.to,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.headers ? { headers: message.headers } : {}),
      });
      return { sent: true, provider: this.name, providerMessageId: info.messageId ?? null };
    } catch (err) {
      return {
        sent: false,
        provider: this.name,
        reason: err instanceof Error ? err.message : 'SMTP refused the message',
        retryable: isTransient(err),
      };
    }
  }
}

/** Brevo (formerly Sendinblue), which is what the owner already has. */
export class BrevoProvider implements EmailProvider {
  readonly name = 'brevo';

  constructor(private readonly apiKey: string) {}

  async send(message: OutboundEmail): Promise<SendResult> {
    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { email: message.from, ...(message.fromName ? { name: message.fromName } : {}) },
          to: [{ email: message.to, ...(message.toName ? { name: message.toName } : {}) }],
          ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
          subject: message.subject,
          htmlContent: message.html,
          textContent: message.text,
          ...(message.headers && Object.keys(message.headers).length
            ? { headers: message.headers }
            : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          sent: false,
          provider: this.name,
          reason: `Brevo refused the message (${response.status})`,
          /* 4xx is our mistake and will be our mistake again; 5xx and 429
             are worth another go. */
          retryable: response.status >= 500 || response.status === 429,
          ...(body ? {} : {}),
        };
      }

      const payload = (await response.json().catch(() => ({}))) as { messageId?: string };
      return { sent: true, provider: this.name, providerMessageId: payload.messageId ?? null };
    } catch (err) {
      return {
        sent: false,
        provider: this.name,
        reason: err instanceof Error ? err.message : 'Could not reach Brevo',
        retryable: true,
      };
    }
  }
}

/** Resend, for a deployment that prefers it. Same shape, different body. */
export class ResendProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(private readonly apiKey: string) {}

  async send(message: OutboundEmail): Promise<SendResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
          to: [message.to],
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.headers && Object.keys(message.headers).length
            ? { headers: message.headers }
            : {}),
        }),
      });

      if (!response.ok) {
        return {
          sent: false,
          provider: this.name,
          reason: `Resend refused the message (${response.status})`,
          retryable: response.status >= 500 || response.status === 429,
        };
      }
      const payload = (await response.json().catch(() => ({}))) as { id?: string };
      return { sent: true, provider: this.name, providerMessageId: payload.id ?? null };
    } catch (err) {
      return {
        sent: false,
        provider: this.name,
        reason: err instanceof Error ? err.message : 'Could not reach Resend',
        retryable: true,
      };
    }
  }
}

/** A timeout or a dropped connection is worth retrying; a refusal is not. */
function isTransient(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? '';
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ESOCKET'].includes(code);
}

/* ── Choosing one ───────────────────────────────────────────────────────── */

let override: EmailProvider | null = null;

/** Test helper: run the whole path against a provider that records calls. */
export function setProviderForTesting(provider: EmailProvider | null): void {
  override = provider;
}

/**
 * The provider in force right now.
 *
 * The feature flag is checked first and nothing gets past it. A deployment
 * that has a Brevo key sitting in `.env` but has not switched sending on is
 * telling us it is not ready, and the key being present is not consent.
 */
export function emailProvider(smtp?: {
  sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }>;
} | null): EmailProvider {
  if (override) return override;

  const cfg = env();
  if (!cfg.FEATURE_EMAIL_SENDING) return new NullProvider();

  switch (cfg.EMAIL_PROVIDER) {
    case 'brevo':
      return cfg.BREVO_API_KEY ? new BrevoProvider(cfg.BREVO_API_KEY) : new NullProvider();
    case 'resend':
      return cfg.RESEND_API_KEY ? new ResendProvider(cfg.RESEND_API_KEY) : new NullProvider();
    case 'none':
      return new NullProvider();
    case 'smtp':
    default:
      return smtp ? new SmtpProvider(smtp) : new NullProvider();
  }
}

/** What the Settings screen shows about email, without revealing a key. */
export function emailReadiness(): {
  sendingOn: boolean;
  provider: string;
  configured: boolean;
  testMode: boolean;
  testRedirect: string | null;
  problems: string[];
} {
  const cfg = env();
  const problems: string[] = [];

  let configured = false;
  switch (cfg.EMAIL_PROVIDER) {
    case 'brevo':
      configured = Boolean(cfg.BREVO_API_KEY);
      if (!configured) problems.push('Brevo is selected but there is no API key.');
      break;
    case 'resend':
      configured = Boolean(cfg.RESEND_API_KEY);
      if (!configured) problems.push('Resend is selected but there is no API key.');
      break;
    case 'smtp':
      configured = Boolean(cfg.SMTP_HOST);
      if (!configured) problems.push('SMTP is selected but no mail server is set.');
      break;
    default:
      configured = false;
  }

  if (!cfg.MAIL_FROM) problems.push('No From address is set, so nothing can be sent.');
  if (cfg.EMAIL_TEST_MODE && !cfg.EMAIL_TEST_REDIRECT) {
    problems.push('Test mode is on but there is no address to redirect to, so nothing will send.');
  }
  if (cfg.FEATURE_EMAIL_SENDING && !cfg.EMAIL_TEST_MODE) {
    problems.push('Sending is live: emails go to real clients.');
  }

  return {
    sendingOn: cfg.FEATURE_EMAIL_SENDING,
    provider: cfg.EMAIL_PROVIDER,
    configured,
    testMode: cfg.EMAIL_TEST_MODE,
    testRedirect: cfg.EMAIL_TEST_REDIRECT ?? null,
    problems,
  };
}
