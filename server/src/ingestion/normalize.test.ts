import { describe, expect, it } from 'vitest';
import { normalizeLead } from './normalize.js';

describe('normalizeLead', () => {
  it('normalizes the person', () => {
    const lead = normalizeLead({
      source: 'website',
      externalId: 'x1',
      mapped: { full_name: 'Sara Al Mansoori', phone: '050 123 4567', email: ' SARA@Example.com ', city: 'Dubai' },
    });
    expect(lead.person.fullName).toBe('Sara Al Mansoori');
    expect(lead.person.firstName).toBe('Sara');
    expect(lead.person.lastName).toBe('Al Mansoori');
    expect(lead.person.phoneE164).toBe('+971501234567');
    expect(lead.person.waId).toBe('971501234567');
    expect(lead.person.email).toBe('sara@example.com');
    expect(lead.person.country).toBe('AE');
  });

  it('keeps the raw phone for the audit trail even when it cannot be parsed', () => {
    const lead = normalizeLead({ source: 'website', externalId: 'x2', mapped: { phone: '12345' } });
    expect(lead.person.phoneRaw).toBe('12345');
    expect(lead.person.phoneE164).toBeNull();
  });

  it('derives the real estate fields from free text', () => {
    const lead = normalizeLead({
      source: 'meta_lead_ads',
      externalId: 'x3',
      mapped: {
        project: 'Emaar Beachfront',
        budget_band: 'AED 1M - 2M',
        purpose: 'Investment',
        timeline: '1-3 months',
        payment_method: 'Developer payment plan',
        golden_visa: 'Yes',
        emirate: 'Dubai',
      },
    });
    expect(lead.realEstate.projectName).toBe('Emaar Beachfront');
    expect(lead.realEstate.budgetMinAed).toBe(1_000_000);
    expect(lead.realEstate.budgetMaxAed).toBe(2_000_000);
    expect(lead.realEstate.purpose).toBe('investment');
    expect(lead.realEstate.timeline).toBe('1_3_months');
    expect(lead.realEstate.paymentMethod).toBe('payment_plan');
    expect(lead.realEstate.goldenVisaInterest).toBe(true);
    expect(lead.realEstate.emirate).toBe('dubai');
  });

  it('puts a back-to-front budget range the right way round', () => {
    const lead = normalizeLead({
      source: 'website',
      externalId: 'x4',
      mapped: { budget_min: '3000000', budget_max: '1000000' },
    });
    expect(lead.realEstate.budgetMinAed).toBe(1_000_000);
    expect(lead.realEstate.budgetMaxAed).toBe(3_000_000);
  });

  it('keeps unmapped answers in the notes rather than dropping them', () => {
    const lead = normalizeLead({
      source: 'meta_lead_ads',
      externalId: 'x5',
      mapped: {},
      unmapped: { which_floor: 'High floor', parking: '2 spaces' },
    });
    expect(lead.notes).toContain('which_floor: High floor');
    expect(lead.notes).toContain('parking: 2 spaces');
  });

  it('never accepts a receivedAt in the future', () => {
    const anHourAhead = new Date(Date.now() + 60 * 60 * 1000);
    const lead = normalizeLead({ source: 'website', externalId: 'x6', receivedAt: anHourAhead, mapped: {} });
    expect(lead.receivedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('accepts a receivedAt in the past, which a late webhook legitimately has', () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const lead = normalizeLead({ source: 'meta_lead_ads', externalId: 'x7', receivedAt: tenMinutesAgo, mapped: {} });
    expect(lead.receivedAt.getTime()).toBe(tenMinutesAgo.getTime());
  });

  it('detects Arabic from the lead’s own words', () => {
    const lead = normalizeLead({
      source: 'whatsapp_direct',
      externalId: 'x8',
      mapped: { notes: 'مرحبا، أريد معلومات عن المشروع' },
    });
    expect(lead.person.language).toBe('ar');
  });
});
