/**
 * The email a new person gets with their way in.
 *
 * Emir, Nov 9 2026, on what it has to say: here is your access; use the CRM
 * every day; mark that you are in when you arrive; answer a new lead inside
 * five minutes; your manager checks every lead; and the CRM is still being
 * built, so tell us what is wrong.
 *
 * Two things this file is careful about.
 *
 * The temporary password is in the body because there is nowhere else to put
 * it — there is no reset-by-email flow in this CRM by design. So it is never
 * written to the audit log, never logged, and the account is forced to change
 * it on first sign-in. An email sitting in an inbox with a password that still
 * works is the thing to avoid, and `must_change_password` is what avoids it.
 *
 * It is a staff email, not a client one: no unsubscribe, no tracking pixel,
 * no marketing layout. People cannot unsubscribe from being told how to log
 * in to their own job.
 */
import { sendInternalEmail } from '../messaging/email/internal.js';
import { companyDetails, displayName } from '../config/company.js';
import { env } from '../config/env.js';
import { escapeHtml } from '../email/merge.js';

export interface WelcomeInput {
  name: string;
  email: string;
  temporaryPassword: string;
}

/** What everyone is asked to do, in the owner's own words, kept in one place. */
export const HOUSE_RULES: Array<{ title: string; detail: string }> = [
  {
    title: 'Open the CRM every day',
    detail: 'Everything is here — your leads, your messages, your tasks. If it is not in the CRM, it did not happen.',
  },
  {
    title: 'Mark that you are in, every morning',
    detail: 'There is one button at the top of your Dashboard when you arrive. It only works on the office Wi-Fi. If you are out at a sales centre or a viewing, press “Working outside” instead and say where you are — that is not an absence.',
  },
  {
    title: 'Answer a new lead within five minutes',
    detail: 'You get a push the moment one lands. After five minutes untouched it goes back to the pool and somebody else takes it.',
  },
  {
    title: 'Your manager sees every lead',
    detail: 'Every lead is checked. Keep the notes and the stage up to date and that check takes a second.',
  },
  {
    title: 'Tell us what is wrong',
    detail: 'The CRM is still being built, so there will be rough edges. If something is broken, slow or missing, say so — anything you ask for can be changed.',
  },
];

function rulesHtml(): string {
  return HOUSE_RULES.map((rule, i) => `
    <tr>
      <td style="padding:0 0 14px 0;vertical-align:top;width:30px">
        <div style="width:24px;height:24px;border-radius:8px;background:#EDF6DF;color:#2F5208;
                    font:600 12px/24px Arial,sans-serif;text-align:center">${i + 1}</div>
      </td>
      <td style="padding:0 0 14px 0;vertical-align:top">
        <div style="font:600 14px/1.45 Arial,sans-serif;color:#16181B">${escapeHtml(rule.title)}</div>
        <div style="font:400 13px/1.55 Arial,sans-serif;color:#5F656D">${escapeHtml(rule.detail)}</div>
      </td>
    </tr>`).join('');
}

/**
 * Plain text as well as HTML, always.
 *
 * This one carries a password, and a person whose mail client blocks HTML
 * must still be able to read it rather than receive a blank message with
 * their only credential inside it.
 */
function plainText(input: WelcomeInput, company: string, url: string): string {
  return [
    `Hi ${input.name.split(' ')[0] ?? 'there'},`,
    '',
    `Your ${company} CRM account is ready. Everything you need is in it — leads, WhatsApp, email, tasks and the project library.`,
    '',
    'Sign in here:',
    url,
    '',
    `Email:    ${input.email}`,
    `Password: ${input.temporaryPassword}`,
    '',
    'It will ask you to choose your own password the first time. Do that straight away, and delete this email afterwards.',
    '',
    'A few things we ask of everyone:',
    '',
    ...HOUSE_RULES.map((rule, i) => `${i + 1}. ${rule.title}\n   ${rule.detail}`),
    '',
    'Close more, earn more.',
    '',
    company,
  ].join('\n');
}

/** Separated from the send so it can be rendered and looked at. */
export function welcomeEmailHtml(input: WelcomeInput, company: string, url: string): string {
  const first = escapeHtml(input.name.split(' ')[0] ?? 'there');
  return `
<div style="margin:0;padding:24px 12px;background:#F2F5EE">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
         style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:18px;
                border:1px solid #E2E6DF;overflow:hidden">
    <tr><td style="padding:28px 28px 0 28px">
      <div style="font:700 13px/1 Arial,sans-serif;color:#F1511B;letter-spacing:.08em;
                  text-transform:uppercase">${escapeHtml(company)}</div>
      <h1 style="margin:14px 0 6px;font:700 25px/1.2 Arial,sans-serif;color:#16181B">
        Welcome to the CRM, ${first}.
      </h1>
      <p style="margin:0 0 22px;font:400 14.5px/1.6 Arial,sans-serif;color:#5F656D">
        Everything you need is in here — your leads, every WhatsApp and email in one
        place, your tasks, and the whole off-plan project library.
      </p>
    </td></tr>

    <tr><td style="padding:0 28px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
             style="background:#F7FAF2;border:1px solid #E2E6DF;border-radius:14px">
        <tr><td style="padding:18px 20px">
          <div style="font:600 11.5px/1 Arial,sans-serif;color:#6B7466;letter-spacing:.07em;
                      text-transform:uppercase;padding-bottom:10px">Your sign-in</div>
          <div style="font:400 13px/1.9 Arial,sans-serif;color:#16181B">
            <span style="color:#6B7466">Email</span>&nbsp;&nbsp;
            <b style="font-family:Courier New,monospace">${escapeHtml(input.email)}</b><br>
            <span style="color:#6B7466">Password</span>&nbsp;&nbsp;
            <b style="font-family:Courier New,monospace;letter-spacing:.04em">${escapeHtml(input.temporaryPassword)}</b>
          </div>
          <div style="padding-top:16px">
            <a href="${escapeHtml(url)}"
               style="display:inline-block;background:#9BE01E;color:#11240A;text-decoration:none;
                      font:700 14px/1 Arial,sans-serif;padding:13px 22px;border-radius:11px">
              Open the CRM
            </a>
          </div>
          <div style="padding-top:12px;font:400 12.5px/1.55 Arial,sans-serif;color:#6B7466">
            It asks you to pick your own password the first time. Do that straight away,
            then delete this email.
          </div>
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:26px 28px 6px">
      <div style="font:600 11.5px/1 Arial,sans-serif;color:#6B7466;letter-spacing:.07em;
                  text-transform:uppercase;padding-bottom:14px">What we ask of everyone</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        ${rulesHtml()}
      </table>
    </td></tr>

    <tr><td style="padding:10px 28px 28px">
      <div style="border-top:1px solid #E2E6DF;padding-top:16px;
                  font:600 15px/1.5 Arial,sans-serif;color:#2F5208">
        Close more, earn more.
      </div>
      <div style="padding-top:4px;font:400 12.5px/1.55 Arial,sans-serif;color:#868D93">
        ${escapeHtml(company)}
      </div>
    </td></tr>
  </table>
</div>`.trim();
}

export async function sendWelcomeEmail(
  input: WelcomeInput,
): Promise<{ sent: boolean; reason?: string }> {
  const company = displayName(await companyDetails());
  const url = `${env().APP_URL}/login`;

  return sendInternalEmail({
    to: input.email,
    subject: `Your ${company} CRM account is ready`,
    text: plainText(input, company, url),
    html: welcomeEmailHtml(input, company, url),
  });
}
