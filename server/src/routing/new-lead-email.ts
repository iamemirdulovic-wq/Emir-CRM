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

interface LeadRow {
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
    lead.phone_e164 ? `Phone: ${lead.phone_e164}` : null,
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
    lead.phone_e164 ? `Call: ${lead.phone_e164}` : null,
    lead.lead_score !== null ? `Score: ${lead.lead_score} of 100` : null,
    '',
    'You have five minutes to touch this lead before it goes back to the pool.',
    '',
    `Open it: ${link}`,
  ].filter((line) => line !== null).join('\n');

  const result = await sendInternalEmail({
    to: agent.email,
    subject: `New lead: ${name}${lead.project_name ? ` — ${lead.project_name}` : ''}`,
    text,
    html: agentLeadHtml({ name, facts, link, phone: lead.phone_e164, score: lead.lead_score }),
  }).catch((err: unknown) => {
    /* Never throw: a mail server having a bad minute must not stop the lead
       being assigned or the clock being set. */
    logger.warn('could not email an agent about their new lead', errorContext(err));
    return { sent: false as const };
  });

  return { sent: result.sent };
}

/** One column, inline styles, no images — the only layout email clients agree on. */
function agentLeadHtml(input: {
  name: string;
  facts: string;
  link: string;
  phone: string | null;
  score: number | null;
}): string {
  const esc = (value: string) => value.replace(/[&<>"]/g, (ch) => (
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'
  ));
  const call = input.phone
    ? `<a href="tel:${esc(input.phone)}" style="display:inline-block;padding:12px 20px;border-radius:10px;
         background:#ffffff;border:1px solid #D7DEE6;color:#0E1B2C;text-decoration:none;
         font-weight:700;font-size:15px">Call ${esc(input.phone)}</a>`
    : '';

  return `<!doctype html><html><body style="margin:0;padding:0;background:#EAF3F8">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EAF3F8">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:#EE3D02;padding:14px 22px;color:#ffffff;font:700 15px/1.3 Helvetica,Arial,sans-serif">
        New lead — five minutes
      </td></tr>
      <tr><td style="padding:22px;font-family:Helvetica,Arial,sans-serif;color:#0E1B2C">
        <div style="font-size:21px;font-weight:700;line-height:1.25">${esc(input.name)}</div>
        ${input.facts ? `<div style="font-size:15px;color:#4A5B70;margin-top:4px">${esc(input.facts)}</div>` : ''}
        ${input.score !== null ? `<div style="font-size:13px;color:#4A5B70;margin-top:8px">Score ${input.score} of 100</div>` : ''}
        <div style="font-size:14px;line-height:1.55;color:#4A5B70;margin:16px 0 20px">
          This lead is yours. Touch it within five minutes or it goes back to the
          pool and somebody else gets it.
        </div>
        <div>
          <a href="${esc(input.link)}" style="display:inline-block;padding:12px 22px;border-radius:10px;
             background:#EE3D02;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;
             margin:0 8px 8px 0">Open the lead</a>
          ${call}
        </div>
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
