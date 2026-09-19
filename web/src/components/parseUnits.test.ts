import { describe, expect, it } from 'vitest';
import { parseUnits } from './ProjectDetail.js';

/*
 * A developer's price list arrives as whatever the developer's spreadsheet
 * looks like. These are the shapes that actually turn up, and the rule is the
 * same as everywhere else in this CRM: keep the row if it names a unit, never
 * invent a figure that is not on it.
 */
describe('reading a pasted price list', () => {
  it('reads tab-separated rows, which is what Excel pastes', () => {
    const { rows } = parseUnits('1204\t2\t12\t1150\tSea view\t2250000');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      unitNo: '1204', bedrooms: 2, floor: '12', internalAreaSqft: 1150,
      view: 'Sea view', priceAed: 2250000,
    });
  });

  it('reads comma-separated rows', () => {
    const { rows } = parseUnits('A-101,1,1,780,Park,1450000');
    expect(rows[0]?.unitNo).toBe('A-101');
    expect(rows[0]?.priceAed).toBe(1450000);
  });

  it('reads columns separated by runs of spaces', () => {
    const { rows } = parseUnits('1204   2   12   1150   Sea view   2250000');
    expect(rows[0]?.unitNo).toBe('1204');
    expect(rows[0]?.priceAed).toBe(2250000);
  });

  it('strips the thousands separators and currency out of a price', () => {
    const { rows } = parseUnits('1204\t2\t12\t1150\tSea\tAED 2,250,000');
    expect(rows[0]?.priceAed).toBe(2250000);
  });

  it('skips a header row', () => {
    const { rows, skipped } = parseUnits('Unit\tBR\tFloor\tArea\tView\tPrice\n1204\t2\t12\t1150\tSea\t2250000');
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
    expect(rows[0]?.unitNo).toBe('1204');
  });

  it('skips blank lines without counting them as problems', () => {
    const { rows, skipped } = parseUnits('1204\t2\n\n\n1205\t1');
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(0);
  });

  it('keeps a row that only has a unit number and a price', () => {
    // Half the sheets in Dubai look like this.
    const { rows } = parseUnits('1204\t2250000');
    expect(rows[0]?.unitNo).toBe('1204');
    expect(rows[0]?.priceAed).toBe(2250000);
    expect(rows[0]?.internalAreaSqft).toBeNull();
    expect(rows[0]?.view).toBeNull();
  });

  it('leaves a missing figure missing rather than guessing a zero', () => {
    const { rows } = parseUnits('1204\t\t\t\t\t');
    expect(rows[0]?.priceAed).toBeNull();
    expect(rows[0]?.bedrooms).toBeNull();
    expect(rows[0]?.floor).toBeNull();
  });

  it('reads a whole pasted block', () => {
    const { rows } = parseUnits([
      'Unit\tBR\tFloor\tArea\tView\tPrice',
      '1204\t2\t12\t1150\tSea view\tAED 2,250,000',
      '1205\t1\t12\t780\tPark view\tAED 1,450,000',
      '1206\t3\t14\t1680\tMarina\tAED 3,900,000',
    ].join('\n'));
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.unitNo)).toEqual(['1204', '1205', '1206']);
    expect(rows.map((r) => r.priceAed)).toEqual([2250000, 1450000, 3900000]);
  });

  it('returns nothing for empty input', () => {
    expect(parseUnits('').rows).toHaveLength(0);
    expect(parseUnits('   \n  \n').rows).toHaveLength(0);
  });

  it('keeps a unit number that is not a number', () => {
    // Villas and townhouses are named, not numbered.
    const { rows } = parseUnits('Villa-7B\t4\tG\t3200\tGarden\t8500000');
    expect(rows[0]?.unitNo).toBe('Villa-7B');
    expect(rows[0]?.priceAed).toBe(8500000);
  });
});
