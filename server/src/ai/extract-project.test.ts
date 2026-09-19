import { describe, expect, it } from 'vitest';
import { filledFields, safeParse } from './extract-project.js';

/**
 * These tests guard one thing: whatever Gemini hands back must already be
 * saveable by the endpoints the wizard posts it to. A model returning
 * 1_790_000.4 or a fifty-character floor label used to sail through here and be
 * rejected at import, which lost the whole price list the agent had just
 * watched Emir AI read.
 */
describe('reading a developer document into a project', () => {
  it('keeps what the document actually said', () => {
    const result = safeParse(JSON.stringify({
      name: 'Bay Residences',
      developer: 'Emaar',
      emirate: 'dubai',
      handoverDate: 'Q4 2027',
      startingPriceAed: 1790000,
      paymentPlan: '60 / 40',
      confidence: { name: 0.98, startingPriceAed: 0.9 },
    }));

    expect(result?.name).toBe('Bay Residences');
    expect(result?.startingPriceAed).toBe(1790000);
    expect(result?.handoverDate).toBe('Q4 2027');
    expect(result?.confidence).toEqual({ name: 0.98, startingPriceAed: 0.9 });
  });

  it('leaves out what it did not say, rather than inventing it', () => {
    const result = safeParse(JSON.stringify({ name: 'Bay Residences' }));

    expect(result?.startingPriceAed).toBeNull();
    expect(result?.handoverDate).toBeNull();
    expect(result?.paymentPlan).toBeNull();
    expect(result?.units).toBeNull();
    expect(filledFields(result!)).toEqual(['name']);
  });

  it('reads a reply the model wrapped in a code fence', () => {
    const result = safeParse('```json\n{"name":"Bay Residences"}\n```');
    expect(result?.name).toBe('Bay Residences');
  });

  it('reads a reply the model buried in prose', () => {
    const result = safeParse('Here is what I found:\n{"name":"Bay Residences"}\nHope that helps.');
    expect(result?.name).toBe('Bay Residences');
  });

  it('rounds a price to what the units endpoint stores', () => {
    const result = safeParse(JSON.stringify({
      startingPriceAed: 1_790_000.4,
      units: [{ unitNo: '1204', bedrooms: 2.0, floor: '12', internalAreaSqft: 1180.5, view: 'Marina', priceAed: 2_250_000.6 }],
    }));

    expect(result?.startingPriceAed).toBe(1_790_000);
    expect(result?.units?.[0]?.priceAed).toBe(2_250_001);
    // Areas are not money and keep their decimal.
    expect(result?.units?.[0]?.internalAreaSqft).toBe(1180.5);
  });

  it('trims a field to the length the library column holds', () => {
    const result = safeParse(JSON.stringify({
      handoverDate: 'x'.repeat(200),
      units: [{ unitNo: 'u'.repeat(200), floor: 'f'.repeat(80), bedrooms: null, internalAreaSqft: null, view: null, priceAed: null }],
    }));

    expect(result?.handoverDate).toHaveLength(48);
    expect(result?.units?.[0]?.unitNo).toHaveLength(64);
    expect(result?.units?.[0]?.floor).toHaveLength(24);
  });

  /*
   * One unreadable row must not cost the other forty. A unit with no number
   * cannot be stored, so it is dropped and the rest are kept.
   */
  it('drops a row it could not name and keeps the others', () => {
    const result = safeParse(JSON.stringify({
      units: [
        { unitNo: '  ', bedrooms: null, floor: null, internalAreaSqft: null, view: null, priceAed: null },
        { unitNo: '1204', bedrooms: 2, floor: '12', internalAreaSqft: 1180, view: null, priceAed: 2250000 },
      ],
      amenities: ['Pool', '   ', 'Gym'],
      paymentMilestones: [
        { milestone: '', percent: 10, dueNote: null },
        { milestone: 'On booking', percent: 20, dueNote: 'Immediate' },
      ],
    }));

    expect(result?.units?.map((u) => u.unitNo)).toEqual(['1204']);
    expect(result?.amenities).toEqual(['Pool', 'Gym']);
    expect(result?.paymentMilestones?.map((m) => m.milestone)).toEqual(['On booking']);
  });

  it('calls a list that emptied out absent, not empty', () => {
    const result = safeParse(JSON.stringify({
      name: 'Bay Residences',
      units: [{ unitNo: '', bedrooms: null, floor: null, internalAreaSqft: null, view: null, priceAed: null }],
    }));

    expect(result?.units).toBeNull();
    expect(filledFields(result!)).toEqual(['name']);
  });

  it('drops a field whose value is nonsense instead of failing the lot', () => {
    const result = safeParse(JSON.stringify({
      name: 'Bay Residences',
      emirate: 'riyadh',
      startingPriceAed: 1790000,
    }));

    expect(result?.name).toBe('Bay Residences');
    expect(result?.startingPriceAed).toBe(1790000);
    expect(result?.emirate).toBeNull();
  });

  it('gives up on a reply with no JSON in it at all', () => {
    expect(safeParse('I could not read that document.')).toBeNull();
    expect(safeParse('')).toBeNull();
  });
});
