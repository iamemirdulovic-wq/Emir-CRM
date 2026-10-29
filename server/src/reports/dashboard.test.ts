import { describe, expect, it } from 'vitest';
import {
  alignDays,
  ARRIVAL_DAYS,
  ARRIVAL_HOURS,
  buildArrivalGrid,
  describeBusiest,
  initials,
  median,
  percentage,
  sourceLabel,
} from './dashboard.js';

describe('median', () => {
  it('returns null for nothing, not zero', () => {
    // Zero would render on the gauge as an instant reply, which is a lie.
    expect(median([])).toBeNull();
  });

  it('takes the middle of an odd set', () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it('averages the middle pair of an even set', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it('is not dragged by one very late reply', () => {
    // The reason the specification asks for median rather than mean.
    expect(median([18, 22, 25, 27, 259200])).toBe(25);
  });
});

describe('percentage', () => {
  it('rounds to a whole number', () => {
    expect(percentage(2, 3)).toBe(67);
  });

  it('is zero, not NaN, when nothing happened', () => {
    expect(percentage(0, 0)).toBe(0);
  });
});

describe('alignDays', () => {
  it('fills days the query returned nothing for', () => {
    // Without this a quiet Sunday disappears and the line jumps straight from
    // Saturday to Monday, which reads as a busier week than it was.
    const filled = alignDays([{ date: '2026-09-14', value: 5 }], '2026-09-16', 3);
    expect(filled).toEqual([
      { date: '2026-09-14', value: 5 },
      { date: '2026-09-15', value: 0 },
      { date: '2026-09-16', value: 0 },
    ]);
  });

  it('ends on the requested day', () => {
    const filled = alignDays([], '2026-09-16', 30);
    expect(filled).toHaveLength(30);
    expect(filled[29]?.date).toBe('2026-09-16');
    expect(filled[0]?.date).toBe('2026-08-18');
  });

  it('ignores days outside the window', () => {
    const filled = alignDays([{ date: '2020-01-01', value: 99 }], '2026-09-16', 2);
    expect(filled.every((day) => day.value === 0)).toBe(true);
  });
});

describe('buildArrivalGrid', () => {
  it('is empty but well formed with no data', () => {
    const grid = buildArrivalGrid([]);
    expect(grid.rows).toHaveLength(ARRIVAL_DAYS.length);
    expect(grid.rows[0]?.values).toHaveLength(ARRIVAL_HOURS.length);
    expect(grid.busiest).toBeNull();
  });

  it('puts Monday first, however MySQL numbers the week', () => {
    // DAYOFWEEK is Sunday-first (1 = Sunday); the design's grid starts Monday.
    const grid = buildArrivalGrid([{ dow: 2, hour: 8, n: 4 }]);
    expect(grid.rows[0]?.label).toBe('Mon');
    expect(grid.rows[0]?.values[0]).toBe(4);
  });

  it('puts Sunday last', () => {
    const grid = buildArrivalGrid([{ dow: 1, hour: 8, n: 3 }]);
    expect(grid.rows[6]?.label).toBe('Sun');
    expect(grid.rows[6]?.values[0]).toBe(3);
  });

  it('buckets two hours into one column, starting at 08:00', () => {
    const grid = buildArrivalGrid([
      { dow: 2, hour: 8, n: 1 },
      { dow: 2, hour: 9, n: 2 },
      { dow: 2, hour: 10, n: 5 },
    ]);
    expect(grid.rows[0]?.values[0]).toBe(3);
    expect(grid.rows[0]?.values[1]).toBe(5);
  });

  it('wraps the small hours round to the end of the row', () => {
    // 2 AM is the eleventh column, not a negative index.
    const grid = buildArrivalGrid([{ dow: 2, hour: 2, n: 7 }]);
    expect(grid.rows[0]?.values[9]).toBe(7);
  });
});

describe('describeBusiest', () => {
  it('names the hottest cell in plain language', () => {
    const grid = ARRIVAL_DAYS.map(() => ARRIVAL_HOURS.map(() => 0));
    (grid[6] as number[])[6] = 40; // Sunday, the 8 PM column
    expect(describeBusiest(grid)).toBe('Busiest: Sun, 8–10 PM');
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeBusiest(ARRIVAL_DAYS.map(() => ARRIVAL_HOURS.map(() => 0)))).toBeNull();
  });

  it('spells out both halves when the window crosses noon or midnight', () => {
    const grid = ARRIVAL_DAYS.map(() => ARRIVAL_HOURS.map(() => 0));
    (grid[0] as number[])[2] = 12; // the 12 PM column, running into the afternoon
    expect(describeBusiest(grid)).toBe('Busiest: Mon, 12–2 PM');
  });
});

describe('initials', () => {
  it('takes the first and last word', () => {
    expect(initials('Sara Ahmed')).toBe('SA');
    expect(initials('Mohammed bin Rashid Al Maktoum')).toBe('MM');
  });

  it('falls back to two letters of a single name', () => {
    expect(initials('Omar')).toBe('OM');
  });

  it('never renders as empty', () => {
    expect(initials('   ')).toBe('?');
  });
});

describe('sourceLabel', () => {
  it('reads the way the business talks', () => {
    expect(sourceLabel('meta_lead_ads')).toBe('Meta forms');
    expect(sourceLabel('meta_ctwa')).toBe('Click-to-WhatsApp');
  });

  it('degrades readably for a source it has not met', () => {
    expect(sourceLabel('portal_bayut')).toBe('portal bayut');
  });
});
