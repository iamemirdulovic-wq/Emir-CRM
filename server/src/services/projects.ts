import { query, queryOne } from '../db/client.js';

/**
 * The verified off-plan library.
 *
 * HARD RULE: never invent prices, handover dates, payment plans or ROI. Every
 * lookup here filters on `verified_at IS NOT NULL`, so an unverified row can
 * never reach a lead. If a project is not verified, the bot says nothing about
 * it and hands the conversation to a human.
 */

export type VerifiedProject = {
  id: string;
  slug: string;
  name: string;
  developer: string;
  emirate: string;
  area: string | null;
  unit_types: unknown;
  starting_price_aed: number | null;
  price_per_sqft_aed: number | null;
  payment_plan: string | null;
  handover_date: string | null;
  golden_visa_eligible: number;
  brochure_url: string | null;
  image_url: string | null;
  location_lat: string | null;
  location_lng: string | null;
  location_label: string | null;
  description: string | null;
};

const VERIFIED_COLUMNS = `id, slug, name, developer, emirate, area, unit_types, starting_price_aed,
  price_per_sqft_aed, payment_plan, handover_date, golden_visa_eligible, brochure_url, image_url,
  location_lat, location_lng, location_label, description`;

/** Look a project up by name. Returns null unless it is active and verified. */
export async function findVerifiedProject(name: string | null | undefined): Promise<VerifiedProject | null> {
  if (!name || !name.trim()) return null;
  const needle = name.trim();

  const exact = await queryOne<VerifiedProject>(
    `SELECT ${VERIFIED_COLUMNS} FROM projects
      WHERE is_active = 1 AND verified_at IS NOT NULL AND (name = ? OR slug = ?)
      LIMIT 1`,
    [needle, slugify(needle)],
  );
  if (exact) return exact;

  // Fall back to a prefix match so "Emaar Beachfront Tower 2" finds
  // "Emaar Beachfront". Never a fuzzy match: quoting the wrong project's price
  // is exactly what the hard rule forbids.
  return queryOne<VerifiedProject>(
    `SELECT ${VERIFIED_COLUMNS} FROM projects
      WHERE is_active = 1 AND verified_at IS NOT NULL AND ? LIKE CONCAT(name, '%')
      ORDER BY CHAR_LENGTH(name) DESC
      LIMIT 1`,
    [needle],
  );
}

export async function getVerifiedProjectBySlug(slug: string): Promise<VerifiedProject | null> {
  return queryOne<VerifiedProject>(
    `SELECT ${VERIFIED_COLUMNS} FROM projects WHERE slug = ? AND is_active = 1 AND verified_at IS NOT NULL`,
    [slug],
  );
}

export async function listVerifiedProjects(): Promise<VerifiedProject[]> {
  return query<VerifiedProject>(
    `SELECT ${VERIFIED_COLUMNS} FROM projects WHERE is_active = 1 AND verified_at IS NOT NULL ORDER BY name`,
  );
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function formatAed(amount: number | null | undefined): string | null {
  if (amount === null || amount === undefined) return null;
  return new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(amount);
}

/**
 * The pricing reply, built only from verified columns. Returns null when the
 * project is unknown or has no verified price — the caller then escalates to a
 * human rather than guessing.
 */
export function pricingMessage(project: VerifiedProject, language: string): string | null {
  const price = formatAed(project.starting_price_aed);
  if (!price) return null;

  const lines: string[] = [];
  if (language === 'ar') {
    lines.push(`${project.name} — ${project.developer}`);
    lines.push(`تبدأ الأسعار من ${price} درهم.`);
    if (project.payment_plan) lines.push(`خطة السداد: ${project.payment_plan}`);
    if (project.handover_date) lines.push(`التسليم: ${project.handover_date}`);
    if (project.golden_visa_eligible === 1) lines.push('مؤهل للإقامة الذهبية.');
  } else {
    lines.push(`${project.name} — ${project.developer}`);
    lines.push(`Prices start from AED ${price}.`);
    if (project.payment_plan) lines.push(`Payment plan: ${project.payment_plan}`);
    if (project.handover_date) lines.push(`Handover: ${project.handover_date}`);
    if (project.golden_visa_eligible === 1) lines.push('Eligible for the Golden Visa.');
  }
  return lines.join('\n');
}

export function hasLocation(project: VerifiedProject): boolean {
  return project.location_lat !== null && project.location_lng !== null;
}
