import { z } from 'zod';
import { normalizeLead } from '../normalize.js';
import { cleanText } from '../parse.js';
import type { LeadDTO } from '../dto.js';

/**
 * property-investment.ae.
 *
 * Their site knows a great deal about a buyer before we ever speak to them —
 * which projects they browsed, what the matchmaker asked and what they
 * answered, the site's own read on how hot they are. None of that fits the
 * plain contact-form shape the generic `/webhooks/website` endpoint takes, so
 * this source exists to carry it across intact.
 *
 * The lead itself still becomes an ordinary contact and opportunity. Only the
 * site-specific part is kept separately, in `website_leads`.
 */

export const SITE = 'property-investment.ae';

const campaignSchema = z.object({
  utm_source: z.string().nullish(),
  utm_medium: z.string().nullish(),
  utm_campaign: z.string().nullish(),
  utm_content: z.string().nullish(),
  utm_term: z.string().nullish(),
  gclid: z.string().nullish(),
  fbclid: z.string().nullish(),
  landing_path: z.string().nullish(),
}).partial();

const projectSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  slug: z.string().nullish(),
  name: z.string().nullish(),
});

const matchmakerSchema = z.object({
  answers: z.unknown().nullish(),
  best_areas: z.array(z.unknown()).nullish(),
  best_projects: z.array(z.unknown()).nullish(),
}).passthrough();

export const propertyInvestmentLeadSchema = z.object({
  id: z.union([z.string(), z.number()]),
  public_ref: z.string().nullish(),
  created_at: z.string().nullish(),
  status: z.string().nullish(),
  temperature: z.string().nullish(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  phone_e164: z.string().nullish(),
  email: z.string().nullish(),
  country: z.string().nullish(),
  language: z.string().nullish(),
  source: z.string().nullish(),
  cta_location: z.string().nullish(),
  campaign: campaignSchema.nullish(),
  project: projectSchema.nullish(),
  request_type: z.string().nullish(),
  message: z.string().nullish(),
  matchmaker: matchmakerSchema.nullish(),
  viewed_projects: z.array(z.unknown()).nullish(),
  ai_summary: z.string().nullish(),
  score_reasons: z.array(z.unknown()).nullish(),
  advisor: z.object({
    id: z.union([z.string(), z.number()]).nullish(),
    name: z.string().nullish(),
  }).nullish(),
  /*
   * Not in the agreed payload, and accepted here so the site can start sending
   * it without another release on our side. Absent means *no* consent, never
   * assumed consent: the instant WhatsApp reply is blocked without it, and
   * UAE PDPL wants the exact wording the person was shown.
   */
  consent: z.union([z.boolean(), z.string()]).nullish(),
  consent_text: z.string().nullish(),
}).passthrough();

export const propertyInvestmentEventSchema = z.object({
  event: z.enum(['lead.created', 'lead.updated']),
  sent_at: z.string().nullish(),
  lead: propertyInvestmentLeadSchema,
});

export type PropertyInvestmentEvent = z.infer<typeof propertyInvestmentEventSchema>;
export type PropertyInvestmentLead = z.infer<typeof propertyInvestmentLeadSchema>;

/** Their primary key is ours too: every event for a lead upserts one row. */
export function propertyInvestmentExternalId(lead: PropertyInvestmentLead): string {
  return `pi_${String(lead.id)}`;
}

const truthy = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && /^(1|true|yes|on)$/i.test(value.trim()));

/** True when the payload said nothing either way about consent. */
export function consentUnknown(lead: PropertyInvestmentLead): boolean {
  return lead.consent === undefined || lead.consent === null;
}

/**
 * Meta's click id as the Conversions API wants it.
 *
 * The site sends `fbclid`, the raw click id; CAPI matches on `fbc`, which is
 * the browser cookie built from it. Meta's own guidance is to assemble it as
 * `fb.1.<milliseconds when the click was observed>.<fbclid>` when the cookie
 * itself was not captured. The lead's creation time is the closest honest
 * reading of "when", so that is what goes in — never `Date.now()`, which would
 * be the moment we happened to receive the webhook.
 */
export function fbcFromClickId(fbclid: string | null | undefined, observedAt: Date): string | null {
  const id = cleanText(fbclid, 255);
  if (!id) return null;
  return `fb.1.${observedAt.getTime()}.${id}`;
}

/** Their clock is data, not truth. Returns null rather than an Invalid Date. */
export function parseSiteDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizePropertyInvestmentLead(
  lead: PropertyInvestmentLead,
  clientIp: string | null,
  userAgent: string | null,
): LeadDTO {
  const campaign = lead.campaign ?? {};
  const createdAt = parseSiteDate(lead.created_at);
  const fullName = [lead.first_name, lead.last_name]
    .map((part) => cleanText(part, 100))
    .filter(Boolean)
    .join(' ')
    .trim();

  // Consent is false unless the site said otherwise. See the schema above.
  const consented = truthy(lead.consent);

  return normalizeLead({
    /*
     * `website`, not a new source of its own. Identity resolution, the source
     * quality report, the CAPI mapping and every workflow key off this value,
     * and a new one would appear as an empty column in each of them. Which
     * site it came from is recorded on the `website_leads` row instead.
     */
    source: 'website',
    externalId: propertyInvestmentExternalId(lead),
    /*
     * Deliberately not `lead.created_at`. normalizeLead clamps a future date,
     * but a site running slow could still backdate a lead and quietly skew
     * speed-to-lead, which is the number this brokerage is judged on. The
     * claimed time is kept on the website_leads row as data.
     */
    mapped: {
      ...(fullName ? { full_name: fullName } : {}),
      ...(lead.first_name ? { first_name: lead.first_name } : {}),
      ...(lead.last_name ? { last_name: lead.last_name } : {}),
      ...(lead.phone_e164 ? { phone: lead.phone_e164 } : {}),
      ...(lead.email ? { email: lead.email } : {}),
      ...(lead.country ? { country: lead.country } : {}),
      ...(lead.language ? { language: lead.language } : {}),
      ...(lead.project?.name ? { project: lead.project.name } : {}),
      ...(lead.message ? { notes: lead.message } : {}),
    },
    /*
     * Everything the site knows that has no column here. It is shown to the
     * agent rather than dropped, which is the point: "which CTA did they press"
     * is often the most useful line on the card.
     */
    unmapped: {
      ...(lead.public_ref ? { public_ref: lead.public_ref } : {}),
      ...(lead.source ? { site_source: lead.source } : {}),
      ...(lead.cta_location ? { cta_location: lead.cta_location } : {}),
      ...(lead.request_type ? { request_type: lead.request_type } : {}),
      ...(lead.temperature ? { site_temperature: lead.temperature } : {}),
      ...(lead.status ? { site_status: lead.status } : {}),
      ...(lead.created_at ? { claimed_created_at: String(lead.created_at) } : {}),
    },
    attribution: {
      utmSource: cleanText(campaign.utm_source, 160),
      utmMedium: cleanText(campaign.utm_medium, 160),
      utmCampaign: cleanText(campaign.utm_campaign, 160),
      utmTerm: cleanText(campaign.utm_term, 160),
      utmContent: cleanText(campaign.utm_content, 160),
      landingPage: cleanText(campaign.landing_path, 1024),
      gclid: cleanText(campaign.gclid, 255),
      fbc: fbcFromClickId(campaign.fbclid, createdAt ?? new Date()),
      clientIp,
      clientUserAgent: cleanText(userAgent, 512),
    },
    consent: {
      whatsapp: consented,
      email: consented,
      sms: consented,
      text: cleanText(lead.consent_text, 2000),
    },
  });
}
