import { z } from 'zod';
import { GRAPH_BASE } from '../../config/api-versions.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { applyFieldMap, loadFieldMappings } from '../field-map.js';
import { normalizeLead } from '../normalize.js';
import type { LeadDTO } from '../dto.js';

/**
 * Meta Lead Ads.
 *
 * The `leadgen` webhook carries only identifiers — no answers. We store it,
 * return 200, then fetch `/{leadgen_id}` for the field data and the campaign,
 * adset and ad names.
 */

export const leadgenChangeSchema = z.object({
  leadgen_id: z.union([z.string(), z.number()]).transform(String),
  form_id: z.union([z.string(), z.number()]).transform(String).optional(),
  page_id: z.union([z.string(), z.number()]).transform(String).optional(),
  ad_id: z.union([z.string(), z.number()]).transform(String).optional(),
  adgroup_id: z.union([z.string(), z.number()]).transform(String).optional(),
  created_time: z.number().optional(),
});

export const leadgenWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String).optional(),
      time: z.number().optional(),
      changes: z
        .array(
          z.object({
            field: z.string(),
            value: z.unknown(),
          }),
        )
        .default([]),
    }),
  ),
});

export type LeadgenNotification = z.infer<typeof leadgenChangeSchema>;

/** Pull every leadgen notification out of a webhook envelope. */
export function extractLeadgenNotifications(payload: unknown): LeadgenNotification[] {
  const parsed = leadgenWebhookSchema.safeParse(payload);
  if (!parsed.success) return [];

  const out: LeadgenNotification[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'leadgen') continue;
      const value = leadgenChangeSchema.safeParse(change.value);
      if (value.success) out.push(value.data);
    }
  }
  return out;
}

/** The shape Graph returns for `/{leadgen_id}`. */
export const metaLeadDetailSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  created_time: z.string().optional(),
  ad_id: z.union([z.string(), z.number()]).transform(String).optional(),
  ad_name: z.string().optional(),
  adset_id: z.union([z.string(), z.number()]).transform(String).optional(),
  adset_name: z.string().optional(),
  campaign_id: z.union([z.string(), z.number()]).transform(String).optional(),
  campaign_name: z.string().optional(),
  form_id: z.union([z.string(), z.number()]).transform(String).optional(),
  form_name: z.string().optional(),
  platform: z.string().optional(),
  is_organic: z.boolean().optional(),
  field_data: z
    .array(
      z.object({
        name: z.string(),
        values: z.array(z.union([z.string(), z.number()])).default([]),
      }),
    )
    .default([]),
});

export type MetaLeadDetail = z.infer<typeof metaLeadDetailSchema>;

/** The fields we request. Campaign, adset and ad names come from the same call. */
export const LEAD_DETAIL_FIELDS = [
  'id',
  'created_time',
  'ad_id',
  'ad_name',
  'adset_id',
  'adset_name',
  'campaign_id',
  'campaign_name',
  'form_id',
  'form_name',
  'platform',
  'is_organic',
  'field_data',
].join(',');

function accessToken(): string {
  const cfg = env();
  const token = cfg.META_SYSTEM_USER_TOKEN ?? cfg.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('No Meta access token configured (META_SYSTEM_USER_TOKEN or META_PAGE_ACCESS_TOKEN)');
  return token;
}

/** Fetch one lead's answers from the Graph API. */
export async function fetchLeadDetail(leadgenId: string): Promise<MetaLeadDetail> {
  const url = new URL(`${GRAPH_BASE}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set('fields', LEAD_DETAIL_FIELDS);
  url.searchParams.set('access_token', accessToken());

  const response = await fetch(url, { method: 'GET' });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Meta lead fetch failed (${response.status}): ${describeGraphError(body)}`);
  }
  return metaLeadDetailSchema.parse(body);
}

/**
 * Backfill: `/{form_id}/leads` catches anything a missed or late webhook lost.
 * Runs on a 10-minute cron.
 */
export async function fetchFormLeads(
  formId: string,
  since: Date,
  limit = 200,
): Promise<{ leads: MetaLeadDetail[]; nextCursor: string | null }> {
  const url = new URL(`${GRAPH_BASE}/${encodeURIComponent(formId)}/leads`);
  url.searchParams.set('fields', LEAD_DETAIL_FIELDS);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('filtering', JSON.stringify([
    { field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since.getTime() / 1000) },
  ]));
  url.searchParams.set('access_token', accessToken());

  const response = await fetch(url, { method: 'GET' });
  const body = (await response.json()) as { data?: unknown[]; paging?: { cursors?: { after?: string } } };
  if (!response.ok) {
    throw new Error(`Meta form leads fetch failed (${response.status}): ${describeGraphError(body)}`);
  }

  const leads: MetaLeadDetail[] = [];
  for (const raw of body.data ?? []) {
    const parsed = metaLeadDetailSchema.safeParse(raw);
    if (parsed.success) leads.push(parsed.data);
    else logger.warn('skipping unparseable lead in backfill', { formId });
  }
  return { leads, nextCursor: body.paging?.cursors?.after ?? null };
}

function describeGraphError(body: unknown): string {
  const error = (body as { error?: { message?: string; code?: number; error_subcode?: number } }).error;
  if (!error) return 'unknown error';
  return `${error.message ?? 'unknown'} (code ${error.code ?? '?'}/${error.error_subcode ?? '?'})`;
}

/** Turn Graph's field_data into a plain question → answer map. */
export function fieldDataToRecord(detail: MetaLeadDetail): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of detail.field_data) {
    const value = field.values.map(String).filter((v) => v.trim()).join(', ');
    if (value) out[field.name] = value;
  }
  return out;
}

/**
 * Normalize a fetched Meta lead. Custom questions go through `form_field_map`,
 * so a new question on a form never needs a code change.
 */
export async function normalizeMetaLead(detail: MetaLeadDetail): Promise<LeadDTO> {
  const fields = fieldDataToRecord(detail);
  const mappings = await loadFieldMappings('meta_lead_ads', detail.form_id ?? null);
  const { mapped, unmapped } = applyFieldMap(fields, mappings);

  return normalizeLead({
    source: 'meta_lead_ads',
    externalId: detail.id,
    receivedAt: detail.created_time ? new Date(detail.created_time) : new Date(),
    mapped,
    unmapped,
    attribution: {
      campaignId: detail.campaign_id ?? null,
      campaignName: detail.campaign_name ?? null,
      adsetId: detail.adset_id ?? null,
      adsetName: detail.adset_name ?? null,
      adId: detail.ad_id ?? null,
      adName: detail.ad_name ?? null,
      formId: detail.form_id ?? null,
      formName: detail.form_name ?? null,
      metaLeadId: detail.id,
    },
    // Submitting a Meta lead form is consent for the channels the form declared.
    // The form's own privacy text is stored with the consent record.
    consent: { whatsapp: true, email: true, sms: false, text: null },
  });
}
