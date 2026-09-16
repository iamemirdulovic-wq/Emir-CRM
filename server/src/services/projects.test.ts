import { describe, expect, it } from 'vitest';
import { formatAed, hasLocation, pricingMessage, slugify, type VerifiedProject } from './projects.js';

const project = (over: Partial<VerifiedProject> = {}): VerifiedProject => ({
  id: 'p1',
  slug: 'emaar-beachfront',
  name: 'Emaar Beachfront',
  developer: 'Emaar',
  emirate: 'dubai',
  area: 'Dubai Harbour',
  unit_types: ['1BR', '2BR', '3BR'],
  starting_price_aed: 1_850_000,
  price_per_sqft_aed: 2600,
  payment_plan: '80/20 until handover',
  handover_date: 'Q4 2027',
  golden_visa_eligible: 1,
  brochure_url: 'https://cdn.example.ae/emaar-beachfront.pdf',
  image_url: null,
  location_lat: '25.0940000',
  location_lng: '55.1440000',
  location_label: 'Dubai Harbour, Dubai',
  description: null,
  ...over,
});

describe('pricingMessage', () => {
  it('quotes only verified figures', () => {
    const message = pricingMessage(project(), 'en');
    expect(message).toContain('Emaar Beachfront — Emaar');
    expect(message).toContain('AED 1,850,000');
    expect(message).toContain('80/20 until handover');
    expect(message).toContain('Q4 2027');
    expect(message).toContain('Golden Visa');
  });

  it('returns null when there is no verified price, rather than guessing', () => {
    expect(pricingMessage(project({ starting_price_aed: null }), 'en')).toBeNull();
  });

  it('omits a payment plan and handover date that are not recorded', () => {
    const message = pricingMessage(project({ payment_plan: null, handover_date: null }), 'en');
    expect(message).toContain('AED 1,850,000');
    expect(message).not.toContain('Payment plan');
    expect(message).not.toContain('Handover');
  });

  it('writes Arabic for an Arabic-speaking lead', () => {
    const message = pricingMessage(project(), 'ar');
    expect(message).toContain('تبدأ الأسعار من 1,850,000 درهم');
    expect(message).toContain('خطة السداد');
  });

  it('does not claim Golden Visa eligibility unless it is recorded', () => {
    expect(pricingMessage(project({ golden_visa_eligible: 0 }), 'en')).not.toContain('Golden Visa');
  });
});

describe('helpers', () => {
  it('formats AED with separators', () => {
    expect(formatAed(1_850_000)).toBe('1,850,000');
    expect(formatAed(null)).toBeNull();
  });

  it('slugifies project names', () => {
    expect(slugify('Emaar Beachfront — Tower 2')).toBe('emaar-beachfront-tower-2');
  });

  it('knows when a project has map coordinates', () => {
    expect(hasLocation(project())).toBe(true);
    expect(hasLocation(project({ location_lat: null }))).toBe(false);
  });
});
