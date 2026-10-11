/**
 * Is the property-investment.ae connection actually wired up?
 *
 * This exists because the answer is otherwise only knowable by making a real
 * request and reading an HTTP code, which the owner has no way to do. The
 * screen tells them instead: the secret is set or it is not, leads are
 * arriving or they are not, and the last one that failed says why.
 *
 * It never returns the secret, in any form — not the value, not a hint, not a
 * length. Whether one is configured is operational; what it is, is not.
 */
import { getPool, query, queryOne, type Executor } from '../db/client.js';
import { secret, secretSource, setting } from '../config/secrets.js';
import { env } from '../config/env.js';
import { SITE } from '../ingestion/sources/property-investment.js';

export type WebsiteConnection = {
  site: string;
  /** True when a shared secret is available. The value is never returned. */
  secretConfigured: boolean;
  /** 'env' (hosting panel), 'crm' (stored encrypted), or 'none'. */
  secretSource: 'env' | 'crm' | 'none';
  /** Where stage changes are reported back to, if anywhere. */
  outboundUrl: string | null;
  /** What the endpoint would answer right now to a correctly signed event. */
  wouldAnswer: 202 | 503;
  leadsReceived: number;
  lastEventAt: string | null;
  lastEventStatus: string | null;
  /** The most recent delivery that did not work, so a failure is visible. */
  lastFailureAt: string | null;
  lastFailureReason: string | null;
};

export async function websiteConnection(exec: Executor = getPool()): Promise<WebsiteConnection> {
  const sharedSecret = await secret('PROPERTY_INVESTMENT_HMAC_SECRET', exec);
  const source = sharedSecret
    ? (env().PROPERTY_INVESTMENT_HMAC_SECRET ? 'env' : await secretSource('PROPERTY_INVESTMENT_HMAC_SECRET', exec))
    : 'none';

  const counted = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM website_leads WHERE site = ?', [SITE], exec,
  );
  const latest = await queryOne<{ last_event_at: string }>(
    'SELECT MAX(last_event_at) AS last_event_at FROM website_leads WHERE site = ?', [SITE], exec,
  );
  const lastEvent = await queryOne<{ status: string; received_at: string }>(
    `SELECT status, received_at FROM inbound_events
      WHERE source = 'property_investment' ORDER BY received_at DESC LIMIT 1`,
    [], exec,
  );
  const lastFailure = await queryOne<{ received_at: string; error: string | null }>(
    `SELECT received_at, error FROM inbound_events
      WHERE source = 'property_investment' AND status = 'failed'
      ORDER BY received_at DESC LIMIT 1`,
    [], exec,
  );

  return {
    site: SITE,
    secretConfigured: Boolean(sharedSecret),
    secretSource: source as WebsiteConnection['secretSource'],
    outboundUrl: (await setting('PROPERTY_INVESTMENT_URL', exec)) ?? null,
    // The one number the owner is actually asking about.
    wouldAnswer: sharedSecret ? 202 : 503,
    leadsReceived: Number(counted?.n ?? 0),
    lastEventAt: latest?.last_event_at ?? null,
    lastEventStatus: lastEvent?.status ?? null,
    lastFailureAt: lastFailure?.received_at ?? null,
    lastFailureReason: lastFailure?.error ?? null,
  };
}

/** The last few leads, for the screen to show that real ones are landing. */
export async function recentWebsiteLeads(
  limit = 5,
  exec: Executor = getPool(),
): Promise<Array<{
  external_id: string; public_ref: string | null; temperature: string | null;
  full_name: string | null; site_project_name: string | null; last_event_at: string;
  contact_id: string;
}>> {
  return query(
    `SELECT w.external_id, w.public_ref, w.temperature, w.site_project_name,
            w.last_event_at, w.contact_id, c.full_name
       FROM website_leads w
       JOIN contacts c ON c.id = w.contact_id
      WHERE w.site = ?
      ORDER BY w.last_event_at DESC
      LIMIT ?`,
    [SITE, limit],
    exec,
  );
}
