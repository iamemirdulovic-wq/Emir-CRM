/**
 * The website context attached to a lead.
 *
 * A lead from property-investment.ae is an ordinary contact and opportunity —
 * see the note at the top of migration 0012 for why there is no second leads
 * table. This file keeps the part the site knows and the CRM has nowhere else
 * to put: the matchmaker answers, the projects the buyer browsed before
 * enquiring, the site's own score, and the whole event as received.
 */
import { execute, getPool, query, queryOne, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import {
  SITE, parseSiteDate, propertyInvestmentExternalId,
  type PropertyInvestmentEvent, type PropertyInvestmentLead,
} from '../ingestion/sources/property-investment.js';

export type WebsiteLeadRow = {
  id: string;
  site: string;
  external_id: string;
  public_ref: string | null;
  contact_id: string;
  opportunity_id: string | null;
  site_status: string | null;
  temperature: string | null;
  request_type: string | null;
  cta_location: string | null;
  site_project_id: string | null;
  site_project_slug: string | null;
  site_project_name: string | null;
  advisor_id: string | null;
  advisor_name: string | null;
  ai_summary: string | null;
  score_reasons: unknown;
  matchmaker: unknown;
  viewed_projects: unknown;
  payload: unknown;
  site_created_at: string | null;
  sent_at: string | null;
  first_seen_at: string;
  last_event_at: string;
  event_count: number;
};

/** JSON columns take a string or NULL; `undefined` would bind as a literal. */
function json(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

function text(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str ? str.slice(0, max) : null;
}

/**
 * Write the website context for a lead, creating it or updating it in place.
 *
 * Keyed on (site, external id), so `lead.updated` lands on the same row as the
 * `lead.created` that preceded it — and so a replayed event changes a counter
 * rather than producing a second anything.
 *
 * The CRM's own stage is never touched from here. `site_status` is what the
 * website thinks; the pipeline stage is what the agent has actually done, and
 * letting one overwrite the other would undo an agent's work every time the
 * site re-sent an event.
 */
export async function saveWebsiteContext(
  input: {
    event: PropertyInvestmentEvent;
    contactId: string;
    opportunityId: string | null;
    site?: string;
  },
  exec: Executor = getPool(),
): Promise<{ id: string; created: boolean }> {
  const { event } = input;
  const lead: PropertyInvestmentLead = event.lead;
  const site = input.site ?? SITE;
  const externalId = propertyInvestmentExternalId(lead);

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM website_leads WHERE site = ? AND external_id = ?',
    [site, externalId],
    exec,
  );

  const values = [
    text(lead.public_ref, 64),
    input.contactId,
    input.opportunityId,
    text(lead.status, 48),
    text(lead.temperature, 24),
    text(lead.request_type, 48),
    text(lead.cta_location, 120),
    text(lead.project?.id, 64),
    text(lead.project?.slug, 160),
    text(lead.project?.name, 200),
    text(lead.advisor?.id, 64),
    text(lead.advisor?.name, 160),
    text(lead.ai_summary, 65535),
    json(lead.score_reasons ?? null),
    json(lead.matchmaker ?? null),
    json(lead.viewed_projects ?? null),
    json(event),
    parseSiteDate(lead.created_at),
    parseSiteDate(event.sent_at),
  ];

  if (existing) {
    await execute(
      `UPDATE website_leads SET
         public_ref = ?, contact_id = ?, opportunity_id = ?,
         site_status = ?, temperature = ?, request_type = ?, cta_location = ?,
         site_project_id = ?, site_project_slug = ?, site_project_name = ?,
         advisor_id = ?, advisor_name = ?,
         ai_summary = ?, score_reasons = ?, matchmaker = ?, viewed_projects = ?,
         payload = ?, site_created_at = ?, sent_at = ?,
         event_count = event_count + 1
       WHERE id = ?`,
      [...values, existing.id],
      exec,
    );
    return { id: existing.id, created: false };
  }

  const id = newId();
  await execute(
    `INSERT INTO website_leads
       (id, site, external_id, public_ref, contact_id, opportunity_id,
        site_status, temperature, request_type, cta_location,
        site_project_id, site_project_slug, site_project_name,
        advisor_id, advisor_name,
        ai_summary, score_reasons, matchmaker, viewed_projects,
        payload, site_created_at, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, site, externalId, ...values],
    exec,
  );
  return { id, created: true };
}

/** The website context for a contact, newest first. */
export async function websiteContextFor(
  contactId: string,
  exec: Executor = getPool(),
): Promise<WebsiteLeadRow[]> {
  return query<WebsiteLeadRow>(
    `SELECT * FROM website_leads WHERE contact_id = ? ORDER BY last_event_at DESC LIMIT 20`,
    [contactId],
    exec,
  );
}

/** The site's id for a lead, so a stage change can be reported back to them. */
export async function externalRefFor(
  opportunityId: string,
  exec: Executor = getPool(),
): Promise<{ site: string; external_id: string; public_ref: string | null } | null> {
  return queryOne<{ site: string; external_id: string; public_ref: string | null }>(
    `SELECT site, external_id, public_ref FROM website_leads
      WHERE opportunity_id = ? ORDER BY last_event_at DESC LIMIT 1`,
    [opportunityId],
    exec,
  );
}

/**
 * A one-line summary of what the site knew, for the activity trail.
 * Short on purpose: the whole payload is on the row, and an activity nobody
 * reads is worse than no activity at all.
 */
export function describeEvent(event: PropertyInvestmentEvent): string {
  const lead = event.lead;
  const parts = [
    lead.request_type ? `asked to ${lead.request_type.replace(/_/g, ' ')}` : null,
    lead.project?.name ? `about ${lead.project.name}` : null,
    lead.cta_location ? `from ${lead.cta_location}` : null,
    lead.temperature ? `${lead.temperature} on the site's own reading` : null,
    Array.isArray(lead.viewed_projects) && lead.viewed_projects.length
      ? `${lead.viewed_projects.length} project${lead.viewed_projects.length === 1 ? '' : 's'} viewed first`
      : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No extra detail sent';
}
