/**
 * Every external API version lives here. Never inline a version string anywhere
 * else in the codebase (HARD RULES: "Keep external API versions in one config
 * constant; don't scatter them through the code").
 */
export const API_VERSIONS = {
  /** Meta Graph API — used for Lead Ads, WhatsApp Cloud API and Conversions API. */
  metaGraph: 'v21.0',
  /** Google Ads API — offline conversion uploads. */
  googleAds: 'v18',
  /** Twilio REST API (WhatsApp adapter fallback). */
  twilio: '2010-04-01',
  /** Wati API (WhatsApp adapter fallback). */
  wati: 'v1',
} as const;

export const GRAPH_BASE = `https://graph.facebook.com/${API_VERSIONS.metaGraph}` as const;
