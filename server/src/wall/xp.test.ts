import { describe, expect, it } from 'vitest';
import {
  KUDOS_PER_WEEK, LEVEL_THRESHOLDS, XP_RULES, canGiveKudos, decideAward,
  levelFromPoints, streakFrom, weekOf,
} from './xp.js';

describe('what earns points', () => {
  it('pays for outcomes, not for activity', () => {
    /* A person paid by activity logs calls that did not happen. Nothing in
       here pays for logging something; it pays for a client doing
       something a client has to be present for. */
    expect(XP_RULES.call_logged).toBeUndefined();
    expect(XP_RULES.note_written).toBeUndefined();
    expect(XP_RULES.lead_reached).toBeDefined();
    expect(XP_RULES.meeting_happened).toBeDefined();
  });

  it('pays nothing for posting on the wall', () => {
    /* The moment points come from posting, the wall fills with posts. */
    expect(Object.keys(XP_RULES).some((key) => key.includes('post') || key.includes('comment')))
      .toBe(false);
  });

  it('values a deal far above anything else', () => {
    const deal = XP_RULES.deal_won?.points ?? 0;
    for (const [key, rule] of Object.entries(XP_RULES)) {
      if (key !== 'deal_won') expect(rule.points).toBeLessThan(deal / 5);
    }
  });

  it('caps everything that could be repeated', () => {
    for (const [key, rule] of Object.entries(XP_RULES)) {
      if (key === 'deal_won') continue;
      expect(rule.dailyCap, `${key} has no daily cap`).not.toBeNull();
      expect(rule.dailyCap as number).toBeGreaterThan(0);
    }
  });

  it('describes each rule in words somebody would say', () => {
    for (const rule of Object.values(XP_RULES)) {
      expect(rule.label).not.toMatch(/_|opportunit|stage_key|XP/);
      expect(rule.label.length).toBeGreaterThan(10);
    }
  });
});

describe('deciding whether to pay', () => {
  const fresh = { todayCount: 0, alreadyAwarded: false };

  it('pays the first time', () => {
    expect(decideAward('deal_won', fresh)).toEqual({ award: true, points: 100 });
  });

  it('never pays twice for the same thing', () => {
    /* A retried job or a double-click must not pay again. */
    expect(decideAward('deal_won', { ...fresh, alreadyAwarded: true }))
      .toEqual({ award: false, reason: 'already_awarded' });
  });

  it('stops at the daily cap', () => {
    const cap = XP_RULES.lead_reached?.dailyCap as number;
    expect(decideAward('lead_reached', { todayCount: cap - 1, alreadyAwarded: false }).award).toBe(true);
    expect(decideAward('lead_reached', { todayCount: cap, alreadyAwarded: false }))
      .toEqual({ award: false, reason: 'daily_cap' });
  });

  it('has no cap on closing deals, because there is no gaming a deal', () => {
    expect(decideAward('deal_won', { todayCount: 99, alreadyAwarded: false }).award).toBe(true);
  });

  it('refuses a rule it does not know, rather than inventing points', () => {
    expect(decideAward('made_up', fresh)).toEqual({ award: false, reason: 'unknown_rule' });
  });
});

describe('levels', () => {
  it('starts everybody at one', () => {
    expect(levelFromPoints(0)).toMatchObject({ level: 1, name: 'New here' });
  });

  it('never goes backwards as points go up', () => {
    let previous = 0;
    for (let points = 0; points < 8000; points += 37) {
      const level = levelFromPoints(points).level;
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('gets harder, so the first few arrive quickly and the last takes a season', () => {
    const gaps = LEVEL_THRESHOLDS.slice(1).map((value, i) => value - (LEVEL_THRESHOLDS[i] as number));
    for (let i = 1; i < gaps.length; i += 1) {
      expect(gaps[i] as number).toBeGreaterThan(gaps[i - 1] as number);
    }
  });

  it('shows how far through the current level somebody is', () => {
    const level = levelFromPoints(100);  // between 50 and 150
    expect(level.from).toBe(50);
    expect(level.next).toBe(150);
    expect(level.progress).toBeCloseTo(0.5, 2);
  });

  it('sits at the top of the last level rather than overflowing', () => {
    const top = levelFromPoints(999_999);
    expect(top.next).toBeNull();
    expect(top.progress).toBe(1);
    expect(top.name).toBe('Legend of the floor');
  });

  it('is not confused by nonsense', () => {
    expect(levelFromPoints(-50).level).toBe(1);
    expect(levelFromPoints(3.7).points).toBe(3);
  });
});

describe('the streak', () => {
  /* 2026-10-30 is a Friday. 31st Saturday, 1 Nov Sunday, 2 Nov Monday. */
  it('counts days in a row', () => {
    expect(streakFrom(['2026-10-30', '2026-10-29', '2026-10-28'], '2026-10-30')).toBe(3);
  });

  it('does not break because today has not happened yet', () => {
    expect(streakFrom(['2026-10-29', '2026-10-28'], '2026-10-30')).toBe(2);
  });

  it('survives the weekend without counting it', () => {
    /*
     * The UAE week is Monday to Friday. A streak that breaks because somebody
     * did not work Saturday is a streak that tells people to work Saturday.
     */
    const worked = ['2026-11-02', '2026-10-30', '2026-10-29'];  // Mon, Fri, Thu
    expect(streakFrom(worked, '2026-11-02')).toBe(3);
  });

  it('counts a weekend day that was worked, without requiring it', () => {
    const worked = ['2026-11-02', '2026-10-31', '2026-10-30'];  // Mon, Sat, Fri
    expect(streakFrom(worked, '2026-11-02')).toBe(3);
  });

  it('breaks on a missed working day', () => {
    /* Thursday worked, Friday missed, Monday worked: the streak is today's. */
    expect(streakFrom(['2026-11-02', '2026-10-29'], '2026-11-02')).toBe(1);
  });

  it('is zero for somebody who has done nothing', () => {
    expect(streakFrom([], '2026-10-30')).toBe(0);
  });

  it('does not run for ever on a long history', () => {
    const everyDay: string[] = [];
    const cursor = new Date('2020-01-01T00:00:00Z');
    while (cursor < new Date('2026-11-01T00:00:00Z')) {
      everyDay.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    expect(streakFrom(everyDay, '2026-10-30')).toBeLessThanOrEqual(400);
  });
});

describe('which week a day belongs to', () => {
  it('is the Monday', () => {
    expect(weekOf(new Date('2026-10-30T08:00:00Z'))).toBe('2026-10-26');  // Fri → Mon
    expect(weekOf(new Date('2026-10-26T08:00:00Z'))).toBe('2026-10-26');  // Mon → itself
  });

  it('puts Sunday in the week that is ending, not the one starting', () => {
    expect(weekOf(new Date('2026-11-01T08:00:00Z'))).toBe('2026-10-26');
  });

  it('follows Dubai time, so a Sunday evening is not already Monday', () => {
    /* 21:00 UTC Sunday is 01:00 Monday in Dubai, and belongs to the new week. */
    expect(weekOf(new Date('2026-11-01T21:00:00Z'))).toBe('2026-11-02');
    expect(weekOf(new Date('2026-11-01T19:00:00Z'))).toBe('2026-10-26');
  });
});

describe('thanking a colleague', () => {
  const base = {
    fromUserId: 'a', toUserId: 'b', givenThisWeek: 0, alreadyThankedThisWeek: false,
  };

  it('is allowed, and says how many are left', () => {
    expect(canGiveKudos(base)).toEqual({ allowed: true, left: KUDOS_PER_WEEK - 1 });
  });

  it('refuses thanking yourself', () => {
    expect(canGiveKudos({ ...base, toUserId: 'a' }).allowed).toBe(false);
  });

  it('refuses thanking the same person twice in a week', () => {
    /* Otherwise two people trade five each and both end the week with
       twenty-five points for nothing. */
    const result = canGiveKudos({ ...base, alreadyThankedThisWeek: true });
    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining('already thanked them') });
  });

  it('runs out at five, and says when they come back', () => {
    const result = canGiveKudos({ ...base, givenThisWeek: KUDOS_PER_WEEK });
    expect(result.allowed).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringContaining('Monday') });
  });

  it('allows the fifth and refuses the sixth', () => {
    expect(canGiveKudos({ ...base, givenThisWeek: 4 }).allowed).toBe(true);
    expect(canGiveKudos({ ...base, givenThisWeek: 5 }).allowed).toBe(false);
  });
});
