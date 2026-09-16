import { GRAPH_BASE } from '../config/api-versions.js';
import { env } from '../config/env.js';
import { execute, queryOne } from '../db/client.js';
import { sha256Hex } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

/**
 * Meta Conversions API for CRM.
 *
 * Stage changes are mapped to lead-quality events so the ad platform learns
 * which ads produce real buyers rather than just cheap form fills.
 */

export const CAPI_EVENT_NAMES = ['valid_lead', 'contacted', 'qualified', 'appointment', 'show', 'reservation'] as const;
export type CapiEventName = (typeof CAPI_EVENT_NAMES)[number];

/** Meta expects normalized values, hashed with SHA-256. */
export function hashUserField(value: string | null | undefined, kind: 'email' | 'phone' | 'name'): string | null {
  if (!value) return null;
  let normalized = value.trim().toLowerCase();
  if (kind === 'phone') normalized = normalized.replace(/\D/g, '');
  if (!normalized) return null;
  return sha256Hex(normalized);
}

export type CapiSendResult = { sent: boolean; skipped?: string; response?: unknown; error?: string };

/**
 * Report one lead-quality event. Idempotent: `conversion_events` is unique on
 * (opportunity, destination, event), so a retried job never double-reports.
 */
export async function sendCapiEvent(input: {
  opportunityId: string;
  contactId: string;
  eventName: CapiEventName | string;
}): Promise<CapiSendResult> {
  const cfg = env();
  if (!cfg.META_DATASET_ID || !cfg.META_CAPI_ACCESS_TOKEN) {
    return { sent: false, skipped: 'meta_capi_not_configured' };
  }

  const row = await queryOne<{
    id: string;
    meta_lead_id: string | null;
    ctwa_clid: string | null;
    fbp: string | null;
    fbc: string | null;
    client_ip: string | null;
    client_user_agent: string | null;
    source: string;
    deal_value_aed: number | null;
    created_at: Date;
    phone_e164: string | null;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  }>(
    `SELECT o.id, o.meta_lead_id, o.ctwa_clid, o.fbp, o.fbc, o.client_ip, o.client_user_agent, o.source,
            o.deal_value_aed, o.created_at,
            c.phone_e164, c.email, c.first_name, c.last_name
       FROM opportunities o JOIN contacts c ON c.id = o.contact_id
      WHERE o.id = ?`,
    [input.opportunityId],
  );
  if (!row) return { sent: false, skipped: 'opportunity_not_found' };

  // Only leads that came from Meta can be reported back to Meta.
  const isMetaSourced = Boolean(row.meta_lead_id || row.ctwa_clid || row.source.startsWith('meta_'));
  if (!isMetaSourced) {
    await recordConversion(input, 'skipped', null, 'not a Meta-sourced lead');
    return { sent: false, skipped: 'not_meta_sourced' };
  }

  const userData: Record<string, unknown> = {};
  const phoneHash = hashUserField(row.phone_e164, 'phone');
  const emailHash = hashUserField(row.email, 'email');
  if (phoneHash) userData.ph = [phoneHash];
  if (emailHash) userData.em = [emailHash];
  const firstNameHash = hashUserField(row.first_name, 'name');
  const lastNameHash = hashUserField(row.last_name, 'name');
  if (firstNameHash) userData.fn = [firstNameHash];
  if (lastNameHash) userData.ln = [lastNameHash];
  if (row.meta_lead_id) userData.lead_id = Number(row.meta_lead_id);
  if (row.ctwa_clid) userData.ctwa_clid = row.ctwa_clid;
  if (row.fbp) userData.fbp = row.fbp;
  if (row.fbc) userData.fbc = row.fbc;
  if (row.client_ip) userData.client_ip_address = row.client_ip;
  if (row.client_user_agent) userData.client_user_agent = row.client_user_agent;

  if (Object.keys(userData).length === 0) {
    await recordConversion(input, 'skipped', null, 'no user identifiers to match on');
    return { sent: false, skipped: 'no_identifiers' };
  }

  const payload = {
    data: [
      {
        event_name: input.eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'system_generated',
        // One id per (opportunity, event) so Meta deduplicates retries for us.
        event_id: `${input.opportunityId}:${input.eventName}`,
        user_data: userData,
        ...(row.deal_value_aed && input.eventName === 'reservation'
          ? { custom_data: { value: Number(row.deal_value_aed), currency: 'AED' } }
          : {}),
      },
    ],
    ...(cfg.META_CAPI_TEST_EVENT_CODE ? { test_event_code: cfg.META_CAPI_TEST_EVENT_CODE } : {}),
  };

  try {
    const response = await fetch(`${GRAPH_BASE}/${cfg.META_DATASET_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.META_CAPI_ACCESS_TOKEN}` },
      body: JSON.stringify(payload),
    });
    const json = (await response.json()) as { events_received?: number; error?: { message?: string } };

    if (!response.ok || json.error) {
      const message = json.error?.message ?? `HTTP ${response.status}`;
      logger.warn('meta CAPI event failed', { eventName: input.eventName, message });
      await recordConversion(input, 'failed', json, message);
      return { sent: false, error: message };
    }

    await recordConversion(input, 'sent', json, null);
    logger.info('reported a lead-quality event to Meta', { eventName: input.eventName, opportunityId: input.opportunityId });
    return { sent: true, response: json };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordConversion(input, 'failed', null, message);
    return { sent: false, error: message };
  }
}

async function recordConversion(
  input: { opportunityId: string; contactId: string; eventName: string },
  status: 'sent' | 'failed' | 'skipped',
  response: unknown,
  error: string | null,
): Promise<void> {
  await execute(
    `INSERT INTO conversion_events (id, opportunity_id, contact_id, destination, event_name, event_time, status, response, error, sent_at)
     VALUES (UUID(), ?, ?, 'meta', ?, NOW(3), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), response = VALUES(response), error = VALUES(error), sent_at = VALUES(sent_at)`,
    [
      input.opportunityId,
      input.contactId,
      input.eventName,
      status,
      response ? JSON.stringify(response) : null,
      error?.slice(0, 512) ?? null,
      status === 'sent' ? new Date() : null,
    ],
  );
}
