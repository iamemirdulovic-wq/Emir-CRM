import { describe, expect, it } from 'vitest';
import { leadCardHtml, leadFacts, type LeadRow } from './new-lead-email.js';

/**
 * The card that tells someone a lead arrived.
 *
 * The rule worth guarding is the one a future change would break without
 * anyone noticing: the buyer's phone number must never ride in an internal
 * email (Emir, Nov 3, 2026). An email is forwarded, synced to several devices
 * and left open on screens; the number stays in the CRM behind a login.
 */
const lead = (over: Partial<LeadRow> = {}): LeadRow => ({
  full_name: 'Ahmed Khan',
  phone_e164: '+971501234567',
  language: 'en',
  project_name: 'Sorrento',
  budget_max_aed: 2_500_000,
  source: 'meta_lead_ads',
  lead_score: 82,
  ...over,
});

const card = (over: Partial<Parameters<typeof leadCardHtml>[0]> = {}) => leadCardHtml({
  kicker: 'New lead, five minutes',
  name: 'Ahmed Khan',
  facts: leadFacts(lead()),
  score: 82,
  link: 'https://crm.example.ae/contacts/c-1?lead=o-1',
  action: 'Open the lead',
  note: 'Touch it within five minutes.',
  ...over,
});

describe('the buyer\'s number never leaves the CRM', () => {
  it('is nowhere in the card, not even in a tel: link', () => {
    const html = card();
    expect(html).not.toContain('971501234567');
    expect(html).not.toContain('+971');
    expect(html.toLowerCase()).not.toContain('tel:');
  });

  it('says where the number actually is, so nobody thinks it was forgotten', () => {
    expect(card()).toContain("number is on the lead");
  });
});

describe('the styling survives the HTML', () => {
  /*
   * This one shipped broken for a moment and only a render caught it. The font
   * stack is interpolated into style="..." attributes, so a family in double
   * quotes closes the attribute early; the browser then drops the whole
   * declaration and the email arrives as 16px Times with no colour.
   */
  it('quotes font names with single quotes, never double', () => {
    const html = card();
    expect(html).toContain("'Segoe UI'");
    expect(html).not.toContain('"Segoe UI"');
  });

  it('keeps the size and the colour in the same attribute as the font', () => {
    expect(card()).toMatch(/font:700 21px\/1\.25 [^"]*;color:#0E1B2C/);
  });
});

describe('what the card shows', () => {
  it('leads with the name and the way in', () => {
    const html = card();
    expect(html).toContain('Ahmed Khan');
    expect(html).toContain('Open the lead');
    expect(html).toContain('https://crm.example.ae/contacts/c-1?lead=o-1');
  });

  it('reads a budget rather than counting it', () => {
    expect(leadFacts(lead())).toContainEqual(['Budget', 'AED 2.5M']);
  });

  it('names the source in words the team uses', () => {
    expect(leadFacts(lead())).toContainEqual(['Source', 'Meta ad']);
  });

  /* 70 is the same line the scorer and the pipeline draw, so the pill and the
     board can never disagree about what counts as hot. */
  it('calls 70 hot and 69 good', () => {
    expect(card({ score: 70 })).toContain('Hot');
    expect(card({ score: 69 })).toContain('Good');
    expect(card({ score: 39 })).toContain('Weak');
  });

  it('leaves the pill out when nothing scored the lead', () => {
    const html = card({ score: null });
    expect(html).not.toContain('of 100');
  });

  it('drops a fact rather than printing an empty row', () => {
    expect(leadFacts(lead({ project_name: null, budget_max_aed: null })))
      .toEqual([['Source', 'Meta ad']]);
  });

  it('escapes a name that would otherwise break the markup', () => {
    expect(card({ name: 'A <script>alert(1)</script> B' }))
      .toContain('&lt;script&gt;');
  });
});
