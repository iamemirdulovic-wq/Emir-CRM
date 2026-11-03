/**
 * The email that tells the owner a lead has arrived.
 *
 * An owner is not sitting in the CRM all day; they are in a meeting, on a
 * site visit, in the car. Email reaches them where they already are, and it
 * is the thing that makes them open the CRM and place the lead. The push
 * notification goes to the agent who got it; this goes to the people who
 * decide where it should be.
 */
import { query, queryOne } from '../db/client.js';
import { env } from '../config/env.js';
import { logger, errorContext } from '../lib/logger.js';
import { sendInternalEmail } from '../messaging/email/internal.js';
import { PRODUCT_NAME } from '../config/constants.js';
import { companyDetails, displayName } from '../config/company.js';
import { routingSettings } from './settings.js';

export interface LeadRow {
  full_name: string | null;
  phone_e164: string | null;
  language: string | null;
  project_name: string | null;
  budget_max_aed: number | null;
  source: string | null;
  lead_score: number | null;
}

/** AED 2,500,000 is a number to count; AED 2.5M is a number to read. */
function budget(aed: number | null): string | null {
  if (!aed) return null;
  if (aed >= 1_000_000) return `AED ${(aed / 1_000_000).toFixed(aed % 1_000_000 === 0 ? 0 : 1)}M`;
  return `AED ${Math.round(aed / 1_000)}K`;
}

/** The three things that decide whether a lead is worth dropping everything for. */
export function leadFacts(lead: LeadRow): [string, string][] {
  const rows: [string, string][] = [];
  if (lead.project_name) rows.push(['Project', lead.project_name]);
  const b = budget(lead.budget_max_aed);
  if (b) rows.push(['Budget', b]);
  if (lead.source) rows.push(['Source', SOURCES[lead.source] ?? lead.source.replace(/_/g, ' ')]);
  return rows;
}

const SOURCES: Record<string, string> = {
  meta_lead_ads: 'Meta ad',
  meta_ctwa: 'WhatsApp ad',
  google_ads: 'Google ad',
  website: 'Website',
  property_investment: 'property-investment.ae',
  whatsapp_direct: 'WhatsApp',
  csv_import: 'Imported',
  manual: 'Added by hand',
};

export async function emailOwnersAboutLead(input: {
  contactId: string;
  opportunityId: string;
  assignedToName: string | null;
}): Promise<{ sent: number }> {
  if (!(await routingSettings()).emailOwnerOnNewLead) return { sent: 0 };

  const lead = await queryOne<LeadRow>(
    `SELECT c.full_name, c.phone_e164, c.language,
            o.project_name, o.budget_max_aed, o.source, o.lead_score
       FROM opportunities o JOIN contacts c ON c.id = o.contact_id
      WHERE o.id = ?`,
    [input.opportunityId],
  );
  if (!lead) return { sent: 0 };

  /*
   * Owners and admins, not managers: this is the "where should this go?"
   * decision, and a manager who is handed a lead does not need telling twice.
   */
  const recipients = await query<{ email: string; name: string }>(
    `SELECT email, name FROM users
      WHERE role IN ('owner','admin') AND is_active = 1 AND email <> ''`,
  );
  if (recipients.length === 0) return { sent: 0 };

  const name = lead.full_name ?? 'A new lead';
  const facts = [
    lead.project_name,
    budget(lead.budget_max_aed),
    lead.source ? (SOURCES[lead.source] ?? lead.source.replace(/_/g, ' ')) : null,
  ].filter(Boolean).join(' · ');

  const link = `${env().APP_URL}/contacts/${input.contactId}`;
  const whereItWent = input.assignedToName
    ? `It has gone to ${input.assignedToName}, who has a few minutes to accept it. If you would rather someone else had it, open the lead and change the owner.`
    : 'Nobody was available, so it is waiting in Incoming for you to place.';

  const lines = [
    `${name}${facts ? ` — ${facts}` : ''}`,
    lead.lead_score !== null ? `Score: ${lead.lead_score} of 100` : null,
    '',
    whereItWent,
    '',
    `Open the lead: ${link}`,
    '',
    displayName(await companyDetails()),
    PRODUCT_NAME,
  ].filter((line) => line !== null);

  let sent = 0;
  for (const person of recipients) {
    const result = await sendInternalEmail({
      to: person.email,
      subject: `New lead: ${name}${lead.project_name ? ` — ${lead.project_name}` : ''}`,
      text: lines.join('\n'),
      html: leadCardHtml({
        kicker: null,
        name,
        facts: leadFacts(lead),
        score: lead.lead_score,
        link,
        action: 'Open the lead',
        note: whereItWent,
      }),
    }).catch((err: unknown) => {
      logger.warn('could not email an owner about a new lead', errorContext(err));
      return { sent: false as const };
    });
    if (result.sent) sent += 1;
  }
  return { sent };
}

/**
 * The email that tells the agent the lead is theirs.
 *
 * Until this existed, an agent was only told while they had the CRM open in
 * front of them: the bell, the pop-up card and the sound all need a live tab,
 * and the push notification needs Firebase, which is not configured. An agent
 * with their phone in their pocket heard nothing at all — the lead was
 * assigned, the five-minute clock ran, the system took it back and gave it to
 * somebody else, and nobody had told them.
 *
 * It is written for a phone's lock screen: the subject carries the name and
 * the project, the first line carries the deadline, and the two things worth
 * doing — ring them, or open the lead — are the first two things on it.
 *
 * Deliberately plain and small. A heavy marketing layout to a colleague is
 * slower to load on a site visit and more likely to be filed as promotional.
 */
export async function emailAgentAboutLead(input: {
  contactId: string;
  opportunityId: string;
  agentUserId: string;
}): Promise<{ sent: boolean }> {
  if (!(await routingSettings()).emailAgentOnNewLead) return { sent: false };

  const agent = await queryOne<{ email: string; name: string }>(
    "SELECT email, name FROM users WHERE id = ? AND is_active = 1 AND email <> ''",
    [input.agentUserId],
  );
  if (!agent) return { sent: false };

  const lead = await queryOne<LeadRow>(
    `SELECT c.full_name, c.phone_e164, c.language,
            o.project_name, o.budget_max_aed, o.source, o.lead_score
       FROM opportunities o JOIN contacts c ON c.id = o.contact_id
      WHERE o.id = ?`,
    [input.opportunityId],
  );
  if (!lead) return { sent: false };

  const name = lead.full_name ?? 'A new lead';
  const facts = [
    lead.project_name,
    budget(lead.budget_max_aed),
    lead.source ? (SOURCES[lead.source] ?? lead.source.replace(/_/g, ' ')) : null,
  ].filter(Boolean).join(' · ');

  /* Carries the opportunity, so an agent with two enquiries from the same
     person lands on the right one. */
  const link = `${env().APP_URL}/contacts/${input.contactId}?lead=${input.opportunityId}`;

  const text = [
    `${name} is yours.`,
    facts || null,
    lead.lead_score !== null ? `Score: ${lead.lead_score} of 100` : null,
    '',
    'You have five minutes to touch this lead before it goes back to the pool.',
    '',
    `Open it: ${link}`,
    '',
    "The buyer's number is on the lead, not in this email.",
  ].filter((line) => line !== null).join('\n');

  const result = await sendInternalEmail({
    to: agent.email,
    subject: `New lead: ${name}${lead.project_name ? ` — ${lead.project_name}` : ''}`,
    text,
    html: leadCardHtml({
      kicker: 'New lead, five minutes',
      name,
      facts: leadFacts(lead),
      score: lead.lead_score,
      link,
      action: 'Open the lead',
      note: 'Touch it within five minutes or it goes back to the pool and '
        + 'somebody else gets it.',
    }),
  }).catch((err: unknown) => {
    /* Never throw: a mail server having a bad minute must not stop the lead
       being assigned or the clock being set. */
    logger.warn('could not email an agent about their new lead', errorContext(err));
    return { sent: false as const };
  });

  return { sent: result.sent };
}

/* The CRM's teal, carried into a deep gradient so the mail looks like the
   product rather than a system notice (Emir, Nov 3, 2026, pointing at
   Instantly and respond.io: a dark ground, a white card floating on it).
   Every gradient sits on top of a bgcolor, because Outlook's Word engine
   ignores gradients and would otherwise paint the text on nothing. */
const C = {
  deep: '#0B2233', mid: '#0C4A5C', end: '#0E8099', teal: '#00AFC8',
  card: '#FFFFFF', line: '#E3EBF2', rule: '#F0F5F9',
  ink: '#0E1B2C', ink2: '#4A5B70', ink3: '#7E8DA0',
  onDeep: '#FFFFFF', onDeepSoft: '#A8C6D6',
};
/* Single quotes around Segoe UI, not double. This string lands inside
   style="..." attributes, so a double quote closes the attribute early and the
   browser throws away everything after it: size, weight, colour, the lot, and
   the mail arrives as 16px Times. Found by rendering it, not by reading it. */
const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => (
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'
  ));
}

/** Hot at 70, the same line the scorer and the pipeline draw. */
function scoreBand(score: number): { label: string; ink: string; wash: string } {
  if (score >= 70) return { label: 'Hot', ink: '#B5370B', wash: '#FFEDE5' };
  if (score >= 40) return { label: 'Good', ink: '#00707F', wash: '#E2F6F9' };
  return { label: 'Weak', ink: '#5C6B7C', wash: '#EEF2F6' };
}

/** Two letters standing in for a face, since an email cannot be trusted with images. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * One lead, as a card on a deep ground.
 *
 * It carries no phone number, on purpose (Emir, Nov 3, 2026). An email is
 * forwarded, synced to several devices and left open on screens, so the
 * buyer's number stays in the CRM behind a login and the button is the way to
 * it. The agent loses one tap and the number stops travelling.
 *
 * Tables and inline styles throughout: the only layout every mail client
 * agrees on. No images either, so nothing waits on a remote load or breaks
 * when a client blocks them; the avatar is two letters in a circle.
 */
export function leadCardHtml(input: {
  kicker: string | null;
  name: string;
  facts: [string, string][];
  score: number | null;
  link: string;
  action: string;
  note: string;
}): string {
  const band = input.score === null ? null : scoreBand(input.score);

  const kicker = input.kicker
    ? `<tr><td align="center" style="padding:0 0 16px">
         <span style="display:inline-block;padding:7px 15px;border-radius:999px;
                      background:rgba(255,255,255,.14);color:${C.onDeep};
                      font:700 11px/1 ${FONT};letter-spacing:.1em;text-transform:uppercase">
           ${esc(input.kicker)}</span>
       </td></tr>`
    : '';

  const score = band
    ? `<span style="display:inline-block;margin-top:5px;padding:4px 10px;border-radius:999px;
                    background:${band.wash};color:${band.ink};font:700 12px/1 ${FONT}">
         ${band.label} &middot; ${input.score} of 100</span>`
    : '';

  const rows = input.facts.map(([label, value], i) => {
    const edge = i === input.facts.length - 1 ? '' : `border-bottom:1px solid ${C.rule};`;
    return `<tr>
      <td style="padding:13px 0;${edge}font:400 13px/1.4 ${FONT};color:${C.ink3};white-space:nowrap">${esc(label)}</td>
      <td align="right" style="padding:13px 0;${edge}font:600 14px/1.4 ${FONT};color:${C.ink}">${esc(value)}</td>
    </tr>`;
  }).join('');

  const facts = input.facts.length
    ? `<tr><td style="padding:4px 24px 0">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
       </td></tr>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;padding:0;background:${C.end}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       bgcolor="${C.deep}"
       style="background:${C.deep};background-image:linear-gradient(170deg,${C.deep} 0%,${C.mid} 58%,${C.end} 100%)">
  <tr><td align="center" style="padding:34px 16px 40px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px">

      <tr><td align="center" style="padding:0 0 22px;font:700 15px/1 ${FONT};color:${C.onDeep};letter-spacing:.01em">
        ${esc(PRODUCT_NAME)}
      </td></tr>

      ${kicker}

      <tr><td style="background:${C.card};border-radius:20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

          <tr><td style="padding:24px 24px 18px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="52" valign="top">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="46">
                    <tr><td align="center" height="46" bgcolor="#E2F6F9"
                            style="width:46px;height:46px;border-radius:23px;
                                   font:700 17px/46px ${FONT};color:#00707F">
                      ${esc(initials(input.name))}
                    </td></tr>
                  </table>
                </td>
                <td valign="middle" style="padding-left:14px">
                  <div style="font:700 21px/1.25 ${FONT};color:${C.ink};letter-spacing:-.012em">${esc(input.name)}</div>
                  ${score}
                </td>
              </tr>
            </table>
          </td></tr>

          ${facts}

          <tr><td style="padding:22px 24px 24px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td align="center" bgcolor="${C.teal}" style="border-radius:13px">
                <a href="${esc(input.link)}"
                   style="display:block;padding:15px 22px;border-radius:13px;color:#ffffff;
                          text-decoration:none;font:700 16px/1 ${FONT}">${esc(input.action)}</a>
              </td></tr>
            </table>
          </td></tr>

        </table>
      </td></tr>

      <tr><td align="center" style="padding:20px 10px 0;font:400 13px/1.6 ${FONT};color:${C.onDeepSoft}">
        ${esc(input.note)}
      </td></tr>

      <tr><td align="center" style="padding:14px 10px 0;font:400 12px/1.6 ${FONT};color:${C.onDeepSoft};opacity:.85">
        The buyer's number is on the lead, not in this email.
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Tell the managers a lead was dropped.
 *
 * The five-minute rule already reassigned it or put it back in Incoming, so
 * this is not a call to action on the lead itself — it is the only way anyone
 * finds out that the rule fired. Until now that event reached managers as an
 * in-app notification and a push, and push does nothing without Firebase, so
 * in practice a dropped lead was silent unless somebody happened to be
 * looking at the bell.
 *
 * Owner, admin and manager, matching who `notifyManagers` tells, so the two
 * channels never disagree about who is responsible for this.
 */
export async function emailManagersAboutBreach(input: {
  contactId: string;
  opportunityId: string;
  missedByUserId: string | null;
  reassignedToUserId: string | null;
  /** More than zero when a backlog of timers fired together after an outage. */
  alsoWaiting: number;
}): Promise<{ sent: number }> {
  const lead = await queryOne<LeadRow>(
    `SELECT c.full_name, c.phone_e164, c.language,
            o.project_name, o.budget_max_aed, o.source, o.lead_score
       FROM opportunities o JOIN contacts c ON c.id = o.contact_id
      WHERE o.id = ?`,
    [input.opportunityId],
  );
  if (!lead) return { sent: 0 };

  const recipients = await query<{ email: string; name: string }>(
    `SELECT email, name FROM users
      WHERE role IN ('owner','admin','manager') AND is_active = 1 AND email <> ''`,
  );
  if (recipients.length === 0) return { sent: 0 };

  const nameOf = async (userId: string | null): Promise<string | null> => {
    if (!userId) return null;
    const row = await queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [userId]);
    return row?.name ?? null;
  };
  const missedBy = await nameOf(input.missedByUserId);
  const nowWith = await nameOf(input.reassignedToUserId);

  const name = lead.full_name ?? 'A lead';
  const facts = [
    lead.project_name,
    budget(lead.budget_max_aed),
    lead.source ? (SOURCES[lead.source] ?? lead.source.replace(/_/g, ' ')) : null,
  ].filter(Boolean).join(' · ');

  const whereNow = nowWith
    ? `It has been reassigned to ${nowWith}, whose own five minutes are now running.`
    : 'Nobody else was available, so it is waiting in Incoming for you to place.';

  const link = `${env().APP_URL}/contacts/${input.contactId}?lead=${input.opportunityId}`;

  const lines = [
    `${name}${facts ? ` — ${facts}` : ''}`,
    '',
    missedBy
      ? `${missedBy} did not touch it within five minutes.`
      : 'It was not touched within five minutes.',
    whereNow,
    input.alsoWaiting > 1
      ? `\n${input.alsoWaiting} leads ran out of time at once. That usually means the CRM was offline for a while rather than anything the team did.`
      : null,
    '',
    `Open it: ${link}`,
    '',
    displayName(await companyDetails()),
    PRODUCT_NAME,
  ].filter((line) => line !== null);

  let sent = 0;
  for (const person of recipients) {
    const result = await sendInternalEmail({
      to: person.email,
      subject: `Lead not picked up: ${name}${lead.project_name ? ` — ${lead.project_name}` : ''}`,
      text: lines.join('\n'),
    }).catch((err: unknown) => {
      logger.warn('could not email a manager about an SLA breach', errorContext(err));
      return { sent: false as const };
    });
    if (result.sent) sent += 1;
  }
  return { sent };
}
