/**
 * The email carrying a sign-in link.
 *
 * Written to be read in two seconds on a lock screen, because that is when it
 * is read: somebody is standing outside a sales centre trying to get into the
 * CRM. One button, one sentence about how long it lasts, one line about what
 * to do if they did not ask for it.
 *
 * Deliberately *not* run through the client email layout. That wrapper adds an
 * unsubscribe link and a marketing-shaped footer, and a sign-in email that can
 * be unsubscribed from is a sign-in email somebody will eventually fail to
 * receive. It also goes through `sendInternalEmail`, which skips consent and
 * quiet hours — a colleague signing in at 23:40 is not a marketing contact.
 */
import { env } from '../config/env.js';
import { sendInternalEmail } from '../messaging/email/internal.js';
import { logger, errorContext } from '../lib/logger.js';

export interface LoginLinkEmail {
  to: string;
  name: string;
  token: string;
  expiresAt: Date;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => (
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'
  ));
}

/**
 * Send it, and never throw.
 *
 * A failure here must not turn into a 500 on the sign-in screen: the honest
 * answer to the person waiting is the same either way ("if that address is on
 * an account, a link is on its way"), and a stack trace would tell an attacker
 * that the address exists.
 */
export async function sendLoginLinkEmail(input: LoginLinkEmail): Promise<{ sent: boolean }> {
  const minutes = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 60_000));
  /* The token rides in the URL because it has to; everything else about the
     design — single use, fifteen minutes, killing the previous link — is
     there because of that. */
  const url = `${env().APP_URL}/login/link?token=${encodeURIComponent(input.token)}`;

  const text = [
    `Hello ${input.name},`,
    '',
    'Here is your sign-in link for the CRM:',
    url,
    '',
    `It works once and expires in ${minutes} minutes.`,
    '',
    'If you did not ask for this, ignore it — nobody can get in without the',
    'link, and it stops working on its own.',
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#EAF3F8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EAF3F8">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#EE3D02;padding:14px 22px;color:#ffffff;
                     font:700 15px/1.3 Helvetica,Arial,sans-serif">Sign in to the CRM</td></tr>
      <tr><td style="padding:24px 22px;font-family:Helvetica,Arial,sans-serif;color:#0E1B2C">
        <div style="font-size:16px;margin-bottom:18px">Hello ${escapeHtml(input.name)},</div>
        <a href="${escapeHtml(url)}"
           style="display:inline-block;padding:13px 26px;border-radius:10px;background:#EE3D02;
                  color:#ffffff;text-decoration:none;font-weight:700;font-size:16px">Sign me in</a>
        <div style="font-size:13px;line-height:1.6;color:#4A5B70;margin-top:20px">
          This link works once and expires in ${minutes} minutes.
        </div>
        <div style="font-size:13px;line-height:1.6;color:#4A5B70;margin-top:10px">
          If you did not ask for it, ignore this email. Nobody can get in
          without the link, and it stops working on its own.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  return sendInternalEmail({ to: input.to, subject: 'Your sign-in link', text, html })
    .then((result) => ({ sent: result.sent }))
    .catch((err: unknown) => {
      /* Never the token, in any log line. */
      logger.warn('could not send a sign-in link', errorContext(err));
      return { sent: false };
    });
}
