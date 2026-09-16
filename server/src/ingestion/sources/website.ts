import { createHash } from 'node:crypto';
import { z } from 'zod';
import { applyFieldMap, loadFieldMappings } from '../field-map.js';
import { normalizeLead } from '../normalize.js';
import { cleanText } from '../parse.js';
import type { LeadDTO } from '../dto.js';

/**
 * Website forms. Authenticated by HMAC over the raw body, or by reCAPTCHA when
 * the form is posted straight from a browser.
 */

export const websiteFormSchema = z
  .object({
    name: z.string().optional(),
    full_name: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    phone: z.string().optional(),
    mobile: z.string().optional(),
    email: z.string().optional(),
    message: z.string().optional(),
    project: z.string().optional(),
    city: z.string().optional(),
    budget: z.string().optional(),
    unit_type: z.string().optional(),
    timeline: z.string().optional(),
    purpose: z.string().optional(),
    language: z.string().optional(),
    consent: z.union([z.boolean(), z.string()]).optional(),
    consent_text: z.string().optional(),
    page_url: z.string().optional(),
    referrer: z.string().optional(),
    utm_source: z.string().optional(),
    utm_medium: z.string().optional(),
    utm_campaign: z.string().optional(),
    utm_term: z.string().optional(),
    utm_content: z.string().optional(),
    gclid: z.string().optional(),
    fbp: z.string().optional(),
    fbc: z.string().optional(),
    form_id: z.string().optional(),
    submitted_at: z.string().optional(),
    /** Anti-spam: a field only a bot would fill in. */
    website: z.string().optional(),
    recaptcha_token: z.string().optional(),
  })
  .passthrough();

export type WebsiteFormPayload = z.infer<typeof websiteFormSchema>;

/**
 * Website posts have no natural id, so derive a stable one from the submission
 * itself. Two identical submissions in the same minute are the same event.
 */
export function websiteExternalId(payload: WebsiteFormPayload): string {
  const minute = payload.submitted_at
    ? new Date(payload.submitted_at).toISOString().slice(0, 16)
    : new Date().toISOString().slice(0, 16);
  const identity = [payload.phone ?? payload.mobile ?? '', payload.email ?? '', payload.form_id ?? '', minute].join('|');
  return `web_${createHash('sha256').update(identity).digest('hex').slice(0, 40)}`;
}

/** A filled honeypot means a bot. */
export function isSpam(payload: WebsiteFormPayload): boolean {
  return Boolean(payload.website && payload.website.trim());
}

const truthy = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && /^(1|true|yes|on)$/i.test(value.trim()));

export async function normalizeWebsiteLead(payload: WebsiteFormPayload, clientIp: string | null, userAgent: string | null): Promise<LeadDTO> {
  const mappings = await loadFieldMappings('website', payload.form_id ?? null);

  // Everything the form posted goes through the map, so a new field on the site
  // is a configuration change rather than a deploy.
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue;
    raw[key] = String(value);
  }
  const { mapped, unmapped } = applyFieldMap(raw, mappings);

  // Fall back to the well-known field names when no mapping row exists yet.
  const merged: Record<string, string> = {
    ...(payload.full_name || payload.name ? { full_name: String(payload.full_name ?? payload.name) } : {}),
    ...(payload.first_name ? { first_name: payload.first_name } : {}),
    ...(payload.last_name ? { last_name: payload.last_name } : {}),
    ...(payload.phone || payload.mobile ? { phone: String(payload.phone ?? payload.mobile) } : {}),
    ...(payload.email ? { email: payload.email } : {}),
    ...(payload.city ? { city: payload.city } : {}),
    ...(payload.project ? { project: payload.project } : {}),
    ...(payload.budget ? { budget_band: payload.budget } : {}),
    ...(payload.unit_type ? { unit_type: payload.unit_type } : {}),
    ...(payload.timeline ? { timeline: payload.timeline } : {}),
    ...(payload.purpose ? { purpose: payload.purpose } : {}),
    ...(payload.language ? { language: payload.language } : {}),
    ...(payload.message ? { notes: payload.message } : {}),
    ...mapped,
  };

  // Honeypot and captcha fields are plumbing, not lead data.
  delete unmapped.website;
  delete unmapped.recaptcha_token;
  delete unmapped.consent;
  delete unmapped.consent_text;

  const consented = truthy(payload.consent);

  return normalizeLead({
    source: 'website',
    externalId: websiteExternalId(payload),
    /*
     * Deliberately NOT payload.submitted_at. That value comes from the site,
     * which we do not control: a wrong timezone or a stale cached page would
     * backdate the lead, and a backdated lead skews the re-inquiry window and
     * the speed-to-lead report. The claimed time is kept below as data.
     */
    mapped: merged,
    unmapped: {
      ...unmapped,
      ...(payload.submitted_at ? { claimed_submitted_at: String(payload.submitted_at) } : {}),
    },
    attribution: {
      utmSource: cleanText(payload.utm_source, 160),
      utmMedium: cleanText(payload.utm_medium, 160),
      utmCampaign: cleanText(payload.utm_campaign, 160),
      utmTerm: cleanText(payload.utm_term, 160),
      utmContent: cleanText(payload.utm_content, 160),
      landingPage: cleanText(payload.page_url, 1024),
      referrer: cleanText(payload.referrer, 1024),
      gclid: cleanText(payload.gclid, 255),
      fbp: cleanText(payload.fbp, 255),
      fbc: cleanText(payload.fbc, 255),
      formId: cleanText(payload.form_id, 64),
      clientIp,
      clientUserAgent: cleanText(userAgent, 512),
    },
    consent: {
      whatsapp: consented,
      email: consented,
      sms: consented,
      text: cleanText(payload.consent_text, 2000),
    },
  });
}

/** Verify a reCAPTCHA token with Google. */
export async function verifyRecaptcha(token: string, secret: string, remoteIp: string | null): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean; score?: number };
  if (!result.success) return false;
  // reCAPTCHA v3 returns a score; v2 does not.
  return result.score === undefined || result.score >= 0.5;
}
