import { API_VERSIONS } from '../config/api-versions.js';
import { env } from '../config/env.js';
import { execute, queryOne } from '../db/client.js';
import { logger } from '../lib/logger.js';

/**
 * Google Ads offline conversion uploads, keyed on gclid.
 *
 * Same idea as Meta's CAPI: tell Google which clicks turned into real buyers.
 */

/** OAuth access tokens are short-lived; mint one per upload burst. */
async function accessToken(): Promise<string | null> {
  const cfg = env();
  if (!cfg.GOOGLE_ADS_CLIENT_ID || !cfg.GOOGLE_ADS_CLIENT_SECRET || !cfg.GOOGLE_ADS_REFRESH_TOKEN) return null;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.GOOGLE_ADS_CLIENT_ID,
      client_secret: cfg.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: cfg.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) {
    logger.warn('google ads token refresh failed', { status: response.status });
    return null;
  }
  const json = (await response.json()) as { access_token?: string };
  return json.access_token ?? null;
}

/** Google wants "yyyy-mm-dd hh:mm:ss+|-hh:mm". Dubai is always +04:00. */
export function googleConversionTime(date: Date): string {
  const dubai = new Date(date.getTime() + 4 * 60 * 60 * 1000);
  return `${dubai.toISOString().slice(0, 19).replace('T', ' ')}+04:00`;
}

export type GoogleUploadResult = { sent: boolean; skipped?: string; error?: string };

export async function uploadConversion(input: {
  opportunityId: string;
  contactId: string;
  eventName: string;
}): Promise<GoogleUploadResult> {
  const cfg = env();
  if (!cfg.GOOGLE_ADS_CUSTOMER_ID || !cfg.GOOGLE_ADS_DEVELOPER_TOKEN || !cfg.GOOGLE_ADS_CONVERSION_ACTION) {
    return { sent: false, skipped: 'google_ads_not_configured' };
  }

  const row = await queryOne<{ gclid: string | null; deal_value_aed: number | null; created_at: Date }>(
    'SELECT gclid, deal_value_aed, created_at FROM opportunities WHERE id = ?',
    [input.opportunityId],
  );
  if (!row) return { sent: false, skipped: 'opportunity_not_found' };

  // Without a gclid there is no click to attribute the conversion to.
  if (!row.gclid) {
    await record(input, 'skipped', null, 'no gclid on this opportunity');
    return { sent: false, skipped: 'no_gclid' };
  }

  const token = await accessToken();
  if (!token) {
    await record(input, 'failed', null, 'could not obtain a Google Ads access token');
    return { sent: false, error: 'oauth_failed' };
  }

  const customerId = cfg.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');
  const payload = {
    conversions: [
      {
        gclid: row.gclid,
        conversionAction: cfg.GOOGLE_ADS_CONVERSION_ACTION,
        conversionDateTime: googleConversionTime(new Date()),
        // The stage name travels as a custom variable so one conversion action
        // can carry the whole funnel.
        ...(row.deal_value_aed ? { conversionValue: Number(row.deal_value_aed), currencyCode: 'AED' } : {}),
        orderId: `${input.opportunityId}:${input.eventName}`,
      },
    ],
    partialFailure: true,
  };

  try {
    const response = await fetch(
      `https://googleads.googleapis.com/${API_VERSIONS.googleAds}/customers/${customerId}:uploadClickConversions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'developer-token': cfg.GOOGLE_ADS_DEVELOPER_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    const json = (await response.json()) as { partialFailureError?: { message?: string }; error?: { message?: string } };

    if (!response.ok || json.error) {
      const message = json.error?.message ?? `HTTP ${response.status}`;
      logger.warn('google offline conversion upload failed', { message });
      await record(input, 'failed', json, message);
      return { sent: false, error: message };
    }
    if (json.partialFailureError?.message) {
      await record(input, 'failed', json, json.partialFailureError.message);
      return { sent: false, error: json.partialFailureError.message };
    }

    await record(input, 'sent', json, null);
    logger.info('uploaded an offline conversion to Google', { eventName: input.eventName, opportunityId: input.opportunityId });
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await record(input, 'failed', null, message);
    return { sent: false, error: message };
  }
}

async function record(
  input: { opportunityId: string; contactId: string; eventName: string },
  status: 'sent' | 'failed' | 'skipped',
  response: unknown,
  error: string | null,
): Promise<void> {
  await execute(
    `INSERT INTO conversion_events (id, opportunity_id, contact_id, destination, event_name, event_time, status, response, error, sent_at)
     VALUES (UUID(), ?, ?, 'google', ?, NOW(3), ?, ?, ?, ?)
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
