import { describe, expect, it } from 'vitest';
import { BADGES, badgesFor, LEVELS, levelFor, type BadgeStats } from './badges.js';

const nothing: BadgeStats = {
  dealsWon: 0, appointments: 0, leadsContacted: 0, speedToLeadSeconds: null,
  streakDays: 0, monthsHere: 0, tidiness: 0, notesWritten: 0,
};

describe('the badges on offer', () => {
  it('has a unique key, a name and a plain explanation for each', () => {
    const keys = BADGES.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const badge of BADGES) {
      expect(badge.name.length).toBeGreaterThan(3);
      expect(badge.how.length).toBeGreaterThan(8);
      /* Written for the person reading it, not for the database. */
      expect(badge.how).not.toMatch(/opportunit|stage_key|SLA|_/);
    }
  });

  it('has none that anybody can hand out', () => {
    /* A badge somebody can give is a badge somebody can withhold. Every one
       of these is a fact, checked against the same data the reports use. */
    for (const badge of BADGES) {
      expect(typeof badge.earned).toBe('function');
    }
  });

  it('has some that are reachable in a first month', () => {
    const firstMonth: BadgeStats = {
      ...nothing, dealsWon: 1, streakDays: 7, speedToLeadSeconds: 90, tidiness: 1,
    };
    const earned = badgesFor(firstMonth).filter((b) => b.earned);
    expect(earned.length).toBeGreaterThanOrEqual(4);
  });
});

describe('earning them', () => {
  it('gives nothing on day one', () => {
    expect(badgesFor(nothing).every((b) => !b.earned)).toBe(true);
  });

  it('gives the first deal for the first deal', () => {
    const badges = badgesFor({ ...nothing, dealsWon: 1 });
    expect(badges.find((b) => b.key === 'first_deal')?.earned).toBe(true);
    expect(badges.find((b) => b.key === 'ten_deals')?.earned).toBe(false);
  });

  it('gives both speed badges to somebody genuinely fast', () => {
    const badges = badgesFor({ ...nothing, speedToLeadSeconds: 24 });
    expect(badges.find((b) => b.key === 'fast_hands')?.earned).toBe(true);
    expect(badges.find((b) => b.key === 'under_thirty')?.earned).toBe(true);
  });

  it('gives neither to somebody who has never replied', () => {
    /* No replies is not infinite speed. */
    const badges = badgesFor({ ...nothing, speedToLeadSeconds: null });
    expect(badges.find((b) => b.key === 'fast_hands')?.earned).toBe(false);
    expect(badges.find((b) => b.key === 'under_thirty')?.earned).toBe(false);
  });

  it('gives the week before the month', () => {
    const badges = badgesFor({ ...nothing, streakDays: 7 });
    expect(badges.find((b) => b.key === 'week_streak')?.earned).toBe(true);
    expect(badges.find((b) => b.key === 'month_streak')?.earned).toBe(false);
  });

  it('wants a next step on every open lead for the tidy one, not most', () => {
    expect(badgesFor({ ...nothing, tidiness: 0.95 }).find((b) => b.key === 'tidy_desk')?.earned).toBe(false);
    expect(badgesFor({ ...nothing, tidiness: 1 }).find((b) => b.key === 'tidy_desk')?.earned).toBe(true);
  });
});

describe('showing how far along somebody is', () => {
  it('is a fraction for the counted ones', () => {
    expect(badgesFor({ ...nothing, dealsWon: 5 }).find((b) => b.key === 'ten_deals')?.progress).toBe(0.5);
  });

  it('is null for the ones that are simply true or false', () => {
    expect(badgesFor(nothing).find((b) => b.key === 'fast_hands')?.progress).toBeNull();
  });

  it('never goes over one, however many deals there are', () => {
    for (const badge of badgesFor({ ...nothing, dealsWon: 500, appointments: 900, notesWritten: 5000 })) {
      if (badge.progress !== null) expect(badge.progress).toBeLessThanOrEqual(1);
    }
  });

  it('never goes below zero', () => {
    for (const badge of badgesFor({ ...nothing, tidiness: -1 })) {
      if (badge.progress !== null) expect(badge.progress).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the level', () => {
  const at = (earned: number) => {
    const badges = badgesFor(nothing).map((b, i) => ({ ...b, earned: i < earned }));
    return levelFor(badges);
  };

  it('is a word, not a number', () => {
    expect(LEVELS).toContain(at(0).level);
    expect(at(0).level).toBe('New');
  });

  it('moves on the first badge, so the first one feels like something', () => {
    expect(at(1).level).toBe('Getting going');
  });

  it('gets harder towards the top', () => {
    expect(at(4).level).toBe('Solid');
    expect(at(6).level).toBe('Senior');
    expect(at(8).level).toBe('Top of the floor');
  });

  it('does not go past the top', () => {
    expect(at(10).level).toBe('Top of the floor');
    expect(at(10).index).toBe(LEVELS.length - 1);
  });

  it('says how many of how many, so the shelf is honest', () => {
    const result = at(3);
    expect(result.earned).toBe(3);
    expect(result.of).toBe(BADGES.length);
  });
});
