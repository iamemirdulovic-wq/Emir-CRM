import { describe, expect, it } from 'vitest';
import { draftFrom, payloadFrom } from './Developers.js';
import type { DeveloperRow } from '../lib/types.js';

const STORED: DeveloperRow = {
  id: 'd1',
  slug: 'emaar',
  legal_name: 'Emaar Properties PJSC',
  short_name: 'Emaar',
  orn: '1234',
  trn: '100123456700003',
  head_office: 'Emaar Square, Downtown Dubai',
  escrow_bank: 'Mashreq Bank',
  website: 'emaar.com',
  track_record: 'Founded 1997. Delivered Downtown Dubai, Dubai Marina and Emaar Beachfront.',
  commission_pct: '4.00',
  payment_terms: '30 days from SPA',
  project_count: 3,
  contact_count: 2,
};

/**
 * The drawer sends every field it holds, so anything `draftFrom` fails to read
 * is a field the next Save silently erases. This is the test for that: open a
 * developer, change nothing, save — and nothing may be lost.
 */
describe('opening a developer and saving it back', () => {
  it('loses nothing when the user changes nothing', () => {
    const payload = payloadFrom(draftFrom(STORED));

    expect(payload).toEqual({
      legalName: 'Emaar Properties PJSC',
      shortName: 'Emaar',
      orn: '1234',
      trn: '100123456700003',
      headOffice: 'Emaar Square, Downtown Dubai',
      escrowBank: 'Mashreq Bank',
      website: 'emaar.com',
      trackRecord: 'Founded 1997. Delivered Downtown Dubai, Dubai Marina and Emaar Beachfront.',
      commissionPct: 4,
      paymentTerms: '30 days from SPA',
    });
  });

  /* A DECIMAL column comes back as "4.00". Nobody writes a commission that way,
     and it must still save as the same number. */
  it('shows the commission the way a person writes it, and saves the same number', () => {
    expect(draftFrom(STORED).commissionPct).toBe('4');
    expect(payloadFrom(draftFrom(STORED)).commissionPct).toBe(4);
    expect(draftFrom({ ...STORED, commission_pct: '4.50' }).commissionPct).toBe('4.5');
  });

  it('keeps a missing field missing rather than turning it into an empty string', () => {
    const sparse: DeveloperRow = {
      ...STORED, orn: null, trn: null, escrow_bank: null, website: null, track_record: null,
    };
    const payload = payloadFrom(draftFrom(sparse));

    expect(payload.orn).toBeNull();
    expect(payload.trn).toBeNull();
    expect(payload.escrowBank).toBeNull();
    expect(payload.trackRecord).toBeNull();
  });

  /* An agent's copy has no commercial terms at all — the server strips them.
     Saving must not invent a zero. */
  it('does not invent a commission the server never sent', () => {
    const { commission_pct: _c, payment_terms: _p, ...forAgent } = STORED;
    const payload = payloadFrom(draftFrom(forAgent as DeveloperRow));

    expect(payload.commissionPct).toBeNull();
    expect(payload.paymentTerms).toBeNull();
  });

  it('trims what the user typed', () => {
    const payload = payloadFrom({ ...draftFrom(STORED), legalName: '  Emaar Properties PJSC  ', orn: '   ' });

    expect(payload.legalName).toBe('Emaar Properties PJSC');
    expect(payload.orn).toBeNull();
  });
});
