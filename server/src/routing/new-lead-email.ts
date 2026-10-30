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
