/**
 * Email to our own people, not to leads.
 *
 * Deliberately separate from `sendEmail`. That path exists to protect leads: it
 * checks consent, the do-not-contact list, quiet hours and the three-a-day cap,
 * and it records the message in the contact's conversation. None of that
 * belongs on a note telling an agent their own task is due — a colleague has
 * not "opted in" to their job, there is no conversation to file it under, and a
 * deadline at 08:15 should be warned about at 07:45 whatever quiet hours say.
 *
 * Keeping them apart is also what stops a staff notification ever being
 * mistaken for contact with a lead in the audit trail.
 */
import { env } from '../../config/env.js';
import { logger, errorContext } from '../../lib/logger.js';
import { maskEmail } from '../../lib/redact.js';
import { mailer } from './send.js';

export type InternalEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type InternalEmailResult = { sent: boolean; reason?: string };

export async function sendInternalEmail(message: InternalEmail): Promise<InternalEmailResult> {
  const cfg = env();
  const transport = mailer();

  if (!transport) {
    /*
     * No SMTP configured yet, which is the normal state of a CRM on its first
     * day. Logged rather than thrown: a missing mail server must not make the
     * background worker retry a task reminder forever.
     */
    logger.info('internal email not sent: no SMTP host configured', { subject: message.subject });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const from = cfg.MAIL_FROM ?? cfg.SMTP_USER ?? 'no-reply@localhost';
  try {
    await transport.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
    });
    logger.info('internal email sent', { to: maskEmail(message.to), subject: message.subject });
    return { sent: true };
  } catch (err) {
    logger.warn('internal email failed', { to: maskEmail(message.to), ...errorContext(err) });
    return { sent: false, reason: 'send_failed' };
  }
}
