import { z } from 'zod';
import { applyFieldMap, loadFieldMappings } from '../field-map.js';
import { normalizeLead } from '../normalize.js';
import type { LeadDTO } from '../dto.js';

/**
 * Google Ads lead form extensions. Google authenticates its webhook with a
 * shared `google_key` in the body, which we compare against GOOGLE_LEAD_FORM_KEY.
 */

export const googleLeadSchema = z.object({
  lead_id: z.string(),
  api_version: z.string().optional(),
  form_id: z.union([z.string(), z.number()]).transform(String).optional(),
  campaign_id: z.union([z.string(), z.number()]).transform(String).optional(),
  adgroup_id: z.union([z.string(), z.number()]).transform(String).optional(),
  creative_id: z.union([z.string(), z.number()]).transform(String).optional(),
  gcl_id: z.string().optional(),
  is_test: z.boolean().optional(),
  google_key: z.string().optional(),
  user_column_data: z
    .array(
      z.object({
        column_id: z.string(),
        string_value: z.string().optional(),
        column_name: z.string().optional(),
      }),
    )
    .default([]),
});

export type GoogleLeadPayload = z.infer<typeof googleLeadSchema>;

export function columnsToRecord(payload: GoogleLeadPayload): Record<string, string> {
  const out: Record<string, string> = {};
  for (const column of payload.user_column_data) {
    const value = (column.string_value ?? '').trim();
    if (!value) continue;
    // Prefer the stable column_id; fall back to the human question text.
    out[column.column_id || column.column_name || 'unknown'] = value;
  }
  return out;
}

export async function normalizeGoogleLead(payload: GoogleLeadPayload): Promise<LeadDTO> {
  const fields = columnsToRecord(payload);
  const mappings = await loadFieldMappings('google_ads', payload.form_id ?? null);
  const { mapped, unmapped } = applyFieldMap(fields, mappings);

  return normalizeLead({
    source: 'google_ads',
    externalId: payload.lead_id,
    mapped,
    unmapped,
    attribution: {
      gclid: payload.gcl_id ?? null,
      campaignId: payload.campaign_id ?? null,
      adsetId: payload.adgroup_id ?? null,
      adId: payload.creative_id ?? null,
      formId: payload.form_id ?? null,
      utmSource: 'google',
      utmMedium: 'cpc',
    },
    consent: { whatsapp: true, email: true, sms: false, text: null },
  });
}
