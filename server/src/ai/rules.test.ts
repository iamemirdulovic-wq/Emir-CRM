import { describe, expect, it } from 'vitest';
import {
  BUCKET_LABEL, PRIORITY_BUCKETS, TUNING,
  agentRisks, bucketsOf, goldenHour, heatFromSignals, heatScore, leadRisks,
  minutesLeftOfDay, priorityOrder, spoken, wakesIn,
  type AgentFacts, type LeadFacts,
} from './rules.js';
import { HOT_SCORE_THRESHOLD } from '../config/constants.js';
import { TABS } from '../leads/tabs.js';
import { OVERLOAD_FACTOR } from '../assignment/distribute.js';
import { CALL_FROM, CALL_UNTIL } from '../leads/countries.js';
import type { TakeBack } from '../v2/office-rules.js';

/**
 * The rules, boundary by boundary.
 *
 * Every number in `TUNING` is read from `TUNING` here rather than typed again,
 * so changing a threshold changes the test with it — except where the test is
 * *about* the number being a particular value, which is said out loud when it
 * is (the 7 days of "going cold", and the 70 that means hot).
 *
 * `NOW` is a fixed instant on purpose, and a Saturday in November: Dubai is
 * UTC+4 all year, and the other zones used below (Kolkata, London, New York)
 * are all out of any daylight-saving change by mid-November, so every clock
 * in here is the same clock on any machine in any month.
 */
const NOW = new Date('2026-11-14T06:00:00.000Z'); // 10:00 Dubai
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A lead with nothing going for it and nothing against it. */
function lead(over: Partial<LeadFacts> = {}): LeadFacts {
  return {
    id: 'lead-1',
    contactId: 'contact-1',
    name: 'Ahmed Khan',
    phone: '+971501234567',
    project: 'Emaar Beachfront',
    stage: 'attempted_contact',
    subStatus: null,
    status: 'open',
    ownerUserId: 'agent-1',
    score: 40,
    band: 'warm',
    scoreReason: 'Budget AED 2.5M · ready now',
    isVip: false,
    createdAt: new Date(NOW.getTime() - 30 * DAY),
    assignedAt: new Date(NOW.getTime() - 30 * DAY),
    lastContactAt: new Date(NOW.getTime() - 1 * DAY),
    lastInboundAt: null,
    nextStepAt: new Date(NOW.getTime() + 2 * DAY),
    nextStepType: 'call',
    noAnswerCount: 0,
    dnc: false,
    importId: null,
    vipDeadlineAt: null,
    vipFirstCallAt: null,
    lastLinkOpenAt: null,
    nextMeetingAt: null,
    ...over,
  };
}

/* ── 1. Heat ──────────────────────────────────────────────────────────── */

describe('heat score', () => {
  it('starts from the stored score and says so', () => {
    const heat = heatScore(lead({ score: 55 }), NOW);
    expect(heat.base).toBe(55);
    expect(heat.score).toBe(55);
    expect(heat.reasons[0]).toEqual({
      key: 'quality', text: 'Budget AED 2.5M · ready now', points: 55,
    });
    expect(heat.why).toContain('Budget AED 2.5M');
  });

  it('says so plainly when the lead has never been scored', () => {
    const heat = heatScore(lead({ score: 0, scoreReason: null }), NOW);
    expect(heat.base).toBe(0);
    expect(heat.reasons[0]?.text).toBe('Nothing to go on yet');
  });

  it('adds for a brand-new lead nobody has rung', () => {
    const fresh = lead({
      createdAt: new Date(NOW.getTime() - 2 * HOUR), lastContactAt: null, nextStepAt: null,
    });
    const heat = heatScore(fresh, NOW);
    expect(heat.reasons.map((r) => r.key)).toContain('new_lead');
    expect(heat.score).toBe(40 + TUNING.heat.newLeadPoints);
  });

  it('stops calling a lead new the moment it is older than the window', () => {
    const base = { lastContactAt: null, nextStepAt: null } as Partial<LeadFacts>;
    const onTheHour = heatScore(lead({
      ...base, createdAt: new Date(NOW.getTime() - TUNING.heat.newLeadHours * HOUR),
    }), NOW);
    const aMinuteLater = heatScore(lead({
      ...base, createdAt: new Date(NOW.getTime() - TUNING.heat.newLeadHours * HOUR - MINUTE),
    }), NOW);

    expect(onTheHour.reasons.map((r) => r.key)).toContain('new_lead');
    expect(aMinuteLater.reasons.map((r) => r.key)).not.toContain('new_lead');
  });

  it('does not call a lead new when somebody has already rung them', () => {
    const heat = heatScore(lead({
      createdAt: new Date(NOW.getTime() - HOUR),
      lastContactAt: new Date(NOW.getTime() - 30 * MINUTE),
    }), NOW);
    expect(heat.reasons.map((r) => r.key)).not.toContain('new_lead');
  });

  it('adds for a VIP hand-over', () => {
    expect(heatScore(lead({ isVip: true }), NOW).score).toBe(40 + TUNING.heat.vipPoints);
  });

  it('adds most when they wrote and nobody has answered', () => {
    const waiting = heatScore(lead({
      lastInboundAt: new Date(NOW.getTime() - 2 * HOUR),
      lastContactAt: new Date(NOW.getTime() - 5 * HOUR),
    }), NOW);
    expect(waiting.reasons.map((r) => r.key)).toContain('reply_waiting');
    expect(waiting.score).toBe(40 + TUNING.heat.replyWaitingPoints);
  });

  it('adds less when they wrote and somebody did answer', () => {
    const answered = heatScore(lead({
      lastInboundAt: new Date(NOW.getTime() - 5 * HOUR),
      lastContactAt: new Date(NOW.getTime() - 2 * HOUR),
    }), NOW);
    expect(answered.reasons.map((r) => r.key)).toContain('reply_answered');
    expect(answered.score).toBe(40 + TUNING.heat.replyAnsweredPoints);
  });

  it('forgets a reply once it is older than the window', () => {
    const stale = heatScore(lead({
      lastInboundAt: new Date(NOW.getTime() - TUNING.heat.replyFreshHours * HOUR - MINUTE),
    }), NOW);
    expect(stale.reasons.map((r) => r.key)).not.toContain('reply_waiting');
    expect(stale.reasons.map((r) => r.key)).not.toContain('reply_answered');
  });

  it('adds for a link they opened, up to the day it stops counting', () => {
    const inside = heatScore(lead({
      lastLinkOpenAt: new Date(NOW.getTime() - TUNING.heat.linkOpenDays * DAY + MINUTE),
    }), NOW);
    const outside = heatScore(lead({
      lastLinkOpenAt: new Date(NOW.getTime() - TUNING.heat.linkOpenDays * DAY - MINUTE),
    }), NOW);
    expect(inside.score).toBe(40 + TUNING.heat.linkOpenPoints);
    expect(outside.score).toBe(40);
  });

  it('adds for a meeting still to come, and not for one already held', () => {
    const ahead = heatScore(lead({ nextMeetingAt: new Date(NOW.getTime() + DAY) }), NOW);
    const past = heatScore(lead({ nextMeetingAt: new Date(NOW.getTime() - DAY) }), NOW);
    expect(ahead.score).toBe(40 + TUNING.heat.meetingBookedPoints);
    expect(past.score).toBe(40);
  });

  it('takes off for silence, but only once it is past the grace', () => {
    const quiet = (days: number) => heatScore(lead({
      nextStepAt: null, lastContactAt: new Date(NOW.getTime() - days * DAY),
    }), NOW);

    expect(quiet(TUNING.heat.quietAfterDays).score).toBe(40);
    expect(quiet(TUNING.heat.quietAfterDays + 1).score).toBe(40 - TUNING.heat.quietPerDay);
    expect(quiet(60).score).toBe(40 - TUNING.heat.quietMax);
  });

  it('does not count silence against a lead somebody is coming back to', () => {
    const planned = heatScore(lead({
      nextStepAt: new Date(NOW.getTime() + DAY),
      lastContactAt: new Date(NOW.getTime() - 40 * DAY),
    }), NOW);
    expect(planned.reasons.map((r) => r.key)).not.toContain('quiet');
  });

  it('takes off per unanswered ring, from the third', () => {
    const tries = (n: number) => heatScore(lead({ noAnswerCount: n }), NOW);

    expect(tries(TUNING.heat.triesBeforePenalty).score).toBe(40);
    expect(tries(TUNING.heat.triesBeforePenalty + 1).score).toBe(40 - TUNING.heat.triesPerTry);
    expect(tries(20).score).toBe(40 - TUNING.heat.triesMax);
  });

  it('takes off for a follow-up that has gone past its time', () => {
    const justNow = heatScore(lead({ nextStepAt: new Date(NOW.getTime() - MINUTE) }), NOW);
    const threeDaysLate = heatScore(lead({ nextStepAt: new Date(NOW.getTime() - 3 * DAY) }), NOW);
    const ancient = heatScore(lead({ nextStepAt: new Date(NOW.getTime() - 200 * DAY) }), NOW);

    expect(justNow.score).toBe(40 - TUNING.heat.overduePoints);
    expect(threeDaysLate.score)
      .toBe(40 - TUNING.heat.overduePoints - 3 * TUNING.heat.overduePerDay);
    expect(ancient.score).toBe(40 - TUNING.heat.overdueMax);
  });

  it('never leaves the 0–100 range', () => {
    const coldest = heatScore(lead({
      score: 2, nextStepAt: new Date(NOW.getTime() - 100 * DAY), noAnswerCount: 12,
      lastContactAt: new Date(NOW.getTime() - 100 * DAY),
    }), NOW);
    const hottest = heatScore(lead({
      score: 100, isVip: true, nextMeetingAt: new Date(NOW.getTime() + DAY),
      lastInboundAt: new Date(NOW.getTime() - HOUR),
      lastLinkOpenAt: new Date(NOW.getTime() - HOUR),
    }), NOW);

    expect(coldest.score).toBe(0);
    expect(hottest.score).toBe(100);
  });

  it('calls it hot at exactly the threshold the rest of the CRM uses', () => {
    const just = heatScore(lead({ score: HOT_SCORE_THRESHOLD - TUNING.heat.vipPoints, isVip: true }), NOW);
    const under = heatScore(lead({ score: HOT_SCORE_THRESHOLD - TUNING.heat.vipPoints - 1, isVip: true }), NOW);

    expect(just.score).toBe(HOT_SCORE_THRESHOLD);
    expect(just.isHot).toBe(true);
    expect(just.band).toBe('hot');
    expect(under.isHot).toBe(false);
    expect(under.band).toBe('warm');
  });

  it('puts the biggest mover first in the reasons, after the base', () => {
    const heat = heatScore(lead({
      isVip: true, lastLinkOpenAt: new Date(NOW.getTime() - HOUR), noAnswerCount: 3,
    }), NOW);
    expect(heat.reasons[0]?.key).toBe('quality');
    expect(heat.reasons[1]?.key).toBe('vip');
    expect(heat.why.startsWith('The owner gave this one over personally')).toBe(true);
  });

  it('scores from signals when the row has no stored score yet', () => {
    const heat = heatFromSignals(
      {
        hasValidPhone: true, isMobile: true, hasEmail: true,
        budgetMinAed: 1_500_000, budgetMaxAed: 2_000_000,
        timeline: 'immediate', purpose: 'investment',
        repliedOnWhatsApp: false, requestedCall: false, requestedPricing: false,
        requestedBrochure: false, inquiryCount: 1, goldenVisaInterest: false,
        spamSignals: 0, invalidNumber: false,
      },
      lead({ isVip: true }),
      NOW,
    );
    /* 15 phone + 5 email + 20 budget + 20 timeline + 5 investment = 65, +15 VIP. */
    expect(heat.base).toBe(65);
    expect(heat.score).toBe(80);
    expect(heat.isHot).toBe(true);
  });
});

/* ── 2. Priority ──────────────────────────────────────────────────────── */

describe('which bucket a lead is in', () => {
  it('puts a VIP on the clock above everything else', () => {
    const buckets = bucketsOf(lead({
      isVip: true,
      vipDeadlineAt: new Date(NOW.getTime() + 10 * MINUTE),
      nextStepAt: new Date(NOW.getTime() - DAY),
      band: 'hot',
    }), NOW);
    expect(buckets[0]).toBe('vip_countdown');
    expect(buckets).toContain('overdue');
    expect(buckets).toContain('hot');
  });

  it('keeps a VIP on the clock even after the clock has run out', () => {
    expect(bucketsOf(lead({
      isVip: true, vipDeadlineAt: new Date(NOW.getTime() - 5 * MINUTE),
    }), NOW)).toContain('vip_countdown');
  });

  it('drops a VIP out of the countdown once somebody has called', () => {
    expect(bucketsOf(lead({
      isVip: true,
      vipDeadlineAt: new Date(NOW.getTime() + 10 * MINUTE),
      vipFirstCallAt: new Date(NOW.getTime() - MINUTE),
    }), NOW)).not.toContain('vip_countdown');
  });

  it('separates overdue from due today, at the minute', () => {
    expect(bucketsOf(lead({ nextStepAt: new Date(NOW.getTime() - MINUTE) }), NOW))
      .toContain('overdue');
    /* 23:30 Dubai is still today; 00:30 tomorrow is not. */
    expect(bucketsOf(lead({ nextStepAt: new Date('2026-11-14T19:30:00.000Z') }), NOW))
      .toContain('due_today');
    expect(bucketsOf(lead({ nextStepAt: new Date('2026-11-14T20:30:00.000Z') }), NOW))
      .not.toContain('due_today');
  });

  it('counts a lead nobody has ever reached as new, not called', () => {
    expect(bucketsOf(lead({ lastContactAt: null }), NOW)).toContain('new_not_called');
    expect(bucketsOf(lead({ lastContactAt: NOW }), NOW)).not.toContain('new_not_called');
  });

  it('reads hot off the stored band, which is what the Hot tab counts', () => {
    expect(TABS.hot.where).toContain("score_band = 'hot'");
    expect(bucketsOf(lead({ band: 'hot' }), NOW)).toContain('hot');
    /* A high heat score does not make the bucket: the tab would disagree. */
    expect(bucketsOf(lead({ band: 'warm', score: 95 }), NOW)).not.toContain('hot');
  });

  it('calls a lead going cold on exactly the tab s rule: no plan, seven days', () => {
    expect(TUNING.priority.coldAfterDays).toBe(7);
    expect(TABS.cold.where).toContain('INTERVAL 7 DAY');

    const cold = lead({
      nextStepAt: null, lastContactAt: new Date(NOW.getTime() - 7 * DAY - MINUTE),
    });
    const notYet = lead({
      nextStepAt: null, lastContactAt: new Date(NOW.getTime() - 7 * DAY + MINUTE),
    });
    const planned = lead({
      nextStepAt: new Date(NOW.getTime() + DAY), lastContactAt: new Date(NOW.getTime() - 40 * DAY),
    });

    expect(bucketsOf(cold, NOW)).toContain('going_cold');
    expect(bucketsOf(notYet, NOW)).not.toContain('going_cold');
    expect(bucketsOf(planned, NOW)).not.toContain('going_cold');
  });

  it('counts a lead nobody has ever contacted from the day it arrived', () => {
    expect(bucketsOf(lead({
      nextStepAt: null, lastContactAt: null, createdAt: new Date(NOW.getTime() - 9 * DAY),
    }), NOW)).toContain('going_cold');
  });

  it('gives a won or lost lead no bucket at all', () => {
    expect(bucketsOf(lead({ status: 'won' }), NOW)).toEqual([]);
    expect(bucketsOf(lead({ status: 'lost', nextStepAt: new Date(NOW.getTime() - DAY) }), NOW))
      .toEqual([]);
  });
});

describe('the order to work in', () => {
  it('ranks the buckets in the order the owner asked for', () => {
    const list = priorityOrder([
      lead({ id: 'cold', nextStepAt: null, lastContactAt: new Date(NOW.getTime() - 20 * DAY) }),
      lead({ id: 'hot', band: 'hot' }),
      lead({ id: 'new', lastContactAt: null, nextStepAt: null, createdAt: new Date(NOW.getTime() - HOUR) }),
      lead({ id: 'today', nextStepAt: new Date(NOW.getTime() + 3 * HOUR) }),
      lead({ id: 'overdue', nextStepAt: new Date(NOW.getTime() - 2 * DAY) }),
      lead({ id: 'vip', isVip: true, vipDeadlineAt: new Date(NOW.getTime() + 20 * MINUTE) }),
    ], NOW);

    expect(list.now.map((r) => r.leadId))
      .toEqual(['vip', 'overdue', 'today', 'new', 'hot', 'cold']);
    expect(list.now.map((r) => r.bucket)).toEqual([...PRIORITY_BUCKETS]);
    expect(list.now.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('puts the longest wait first inside a bucket', () => {
    const list = priorityOrder([
      lead({ id: 'late-1', nextStepAt: new Date(NOW.getTime() - HOUR) }),
      lead({ id: 'late-3', nextStepAt: new Date(NOW.getTime() - 3 * DAY) }),
      lead({ id: 'late-2', nextStepAt: new Date(NOW.getTime() - DAY) }),
    ], NOW);
    expect(list.now.map((r) => r.leadId)).toEqual(['late-3', 'late-2', 'late-1']);
  });

  it('sorts the hot bucket by heat, since it has no clock', () => {
    const list = priorityOrder([
      lead({ id: 'warm-ish', band: 'hot', score: 72 }),
      lead({ id: 'scorching', band: 'hot', score: 95 }),
    ], NOW);
    expect(list.now.map((r) => r.leadId)).toEqual(['scorching', 'warm-ish']);
  });

  it('holds back a client who is asleep in their own country', () => {
    /* 06:00 UTC is 01:00 in New York and 10:00 in Dubai. */
    const list = priorityOrder([
      lead({ id: 'dubai', phone: '+971501234567', nextStepAt: new Date(NOW.getTime() - DAY) }),
      lead({ id: 'new-york', phone: '+12125550123', nextStepAt: new Date(NOW.getTime() - 2 * DAY) }),
    ], NOW);

    expect(list.now.map((r) => r.leadId)).toEqual(['dubai']);
    expect(list.asleep.map((r) => r.leadId)).toEqual(['new-york']);
    expect(list.asleep[0]?.asleep).toBe(true);
    expect(list.asleep[0]?.wakesInMinutes).toBe(8 * 60);
    expect(list.skipped.asleep).toBe(1);
  });

  it('still counts the asleep ones, so no number goes missing', () => {
    const list = priorityOrder([
      lead({ id: 'new-york', phone: '+12125550123', nextStepAt: new Date(NOW.getTime() - DAY) }),
    ], NOW);
    expect(list.counts.overdue).toBe(1);
    expect(list.now).toHaveLength(0);
  });

  it('treats a number we cannot place as callable rather than guessing', () => {
    const list = priorityOrder([
      lead({ id: 'unknown', phone: '+99912345678', nextStepAt: new Date(NOW.getTime() - DAY) }),
      lead({ id: 'none', phone: null, nextStepAt: new Date(NOW.getTime() - 2 * DAY) }),
    ], NOW);

    /* Both callable, longest wait first, and neither given a country. */
    expect(list.now.map((r) => r.leadId)).toEqual(['none', 'unknown']);
    expect(list.asleep).toHaveLength(0);
    expect(list.now.map((r) => r.where)).toEqual([null, null]);
    expect(list.now.map((r) => r.asleep)).toEqual([false, false]);
    expect(list.now.map((r) => r.wakesInMinutes)).toEqual([null, null]);
  });

  it('leaves somebody who asked us to stop out of both lists, and counts them', () => {
    const list = priorityOrder([
      lead({ id: 'stop', dnc: true, nextStepAt: new Date(NOW.getTime() - DAY) }),
    ], NOW);
    expect(list.now).toHaveLength(0);
    expect(list.asleep).toHaveLength(0);
    expect(list.skipped.dnc).toBe(1);
    /* The lead is still overdue, and the count still says so. */
    expect(list.counts.overdue).toBe(1);
  });

  it('counts a lead with nothing owed rather than listing it', () => {
    const list = priorityOrder([lead({ id: 'quiet' })], NOW);
    expect(list.now).toHaveLength(0);
    expect(list.skipped.nothingOwed).toBe(1);
  });

  it('carries the next step from the one place that decides it', () => {
    const row = priorityOrder([lead({
      id: 'overdue', nextStepType: 'whatsapp', nextStepAt: new Date(NOW.getTime() - DAY),
    })], NOW).now[0];
    expect(row?.nextStep.suggest?.rule).toBe('overdue_promise');
    expect(row?.doThis).toBe('Send a WhatsApp, today');
  });

  it('says why each row is where it is, in words', () => {
    const list = priorityOrder([
      lead({ id: 'vip', isVip: true, vipDeadlineAt: new Date(NOW.getTime() + 8 * MINUTE) }),
      lead({ id: 'overdue', nextStepAt: new Date(NOW.getTime() - 2 * DAY) }),
      lead({ id: 'cold', nextStepAt: null, lastContactAt: new Date(NOW.getTime() - 9 * DAY) }),
    ], NOW);
    expect(list.now[0]?.why).toBe('VIP lead · 8 min left to call');
    expect(list.now[1]?.why).toBe('Overdue by 2 days');
    expect(list.now[2]?.why).toBe('Nothing planned and quiet for 9 days');
  });

  it('names every bucket, for the chips', () => {
    for (const bucket of PRIORITY_BUCKETS) expect(BUCKET_LABEL[bucket]).toBeTruthy();
  });
});

/* ── 3. Golden hour ───────────────────────────────────────────────────── */

describe('golden hour', () => {
  it('groups the leads by country and counts them', () => {
    const hour = goldenHour([
      lead({ phone: '+971501234567' }),
      lead({ phone: '+971509876543' }),
      lead({ phone: '+919820098200' }),
      lead({ phone: '+12125550123' }),
      lead({ phone: null }),
    ], NOW);

    expect(hour.now).toBe('10:00');
    expect(hour.countries.map((c) => [c.iso2, c.leads]))
      .toEqual([['IN', 1], ['AE', 2]]);
    expect(hour.asleep.map((c) => c.iso2)).toEqual(['US']);
    expect(hour.leadsAwake).toBe(3);
    expect(hour.unknown).toBe(1);
  });

  it('counts the minutes left of their day, closing soonest first', () => {
    const hour = goldenHour([
      lead({ phone: '+971501234567' }), // 10:00, 10 hours left
      lead({ phone: '+919820098200' }), // 11:30, 8h30 left
    ], NOW);
    expect(hour.countries[0]?.iso2).toBe('IN');
    expect(hour.countries[0]?.minutesLeft).toBe(8 * 60 + 30);
    expect(hour.countries[1]?.minutesLeft).toBe(10 * 60);
    expect(hour.countries[1]?.left).toBe('10 hours');
  });

  it('counts the minutes until an asleep country wakes', () => {
    const hour = goldenHour([lead({ phone: '+12125550123' })], NOW); // 01:00 New York
    expect(hour.asleep[0]?.wakesInMinutes).toBe(8 * 60);
    expect(hour.asleep[0]?.localTime).toBe('01:00');
  });

  it('uses the same calling window as the dialler and the country chips', () => {
    expect(TUNING.golden.fromHour).toBe(CALL_FROM);
    expect(TUNING.golden.untilHour).toBe(CALL_UNTIL);
  });

  it('is awake at the first minute of the window and asleep at the last', () => {
    /* 05:00 UTC is 09:00 in Dubai — the first callable minute. */
    const opens = new Date('2026-11-14T05:00:00.000Z');
    const closes = new Date('2026-11-14T16:00:00.000Z'); // 20:00 Dubai

    expect(goldenHour([lead({ phone: '+971501234567' })], opens).countries[0]?.minutesLeft)
      .toBe((CALL_UNTIL - CALL_FROM) * 60);
    expect(goldenHour([lead({ phone: '+971501234567' })], closes).asleep[0]?.wakesInMinutes)
      .toBe((24 - CALL_UNTIL + CALL_FROM) * 60);
  });

  it('answers the two clock questions on their own too', () => {
    expect(minutesLeftOfDay('Asia/Dubai', NOW)).toBe(10 * 60);
    expect(wakesIn('America/New_York', NOW)).toBe(8 * 60);
    expect(minutesLeftOfDay('Mars/Olympus', NOW)).toBe(0);
    expect(wakesIn(null, NOW)).toBe(0);
  });

  it('leaves closed leads out', () => {
    expect(goldenHour([lead({ status: 'won' }), lead({ status: 'lost' })], NOW).leadsAwake).toBe(0);
  });
});

/* ── 4. Risks ─────────────────────────────────────────────────────────── */

const TAKE_BACK: TakeBack = { enabled: true, vipMinutes: 30, importHours: 24 };

describe('what is about to go wrong on a lead', () => {
  it('warns before a VIP lead goes back to Incoming', () => {
    const soon = leadRisks(lead({
      isVip: true,
      vipDeadlineAt: new Date(NOW.getTime() + TUNING.risk.vipWarnMinutes * MINUTE),
    }), TAKE_BACK, NOW);
    const notYet = leadRisks(lead({
      isVip: true,
      vipDeadlineAt: new Date(NOW.getTime() + (TUNING.risk.vipWarnMinutes + 1) * MINUTE),
    }), TAKE_BACK, NOW);

    expect(soon.map((r) => r.key)).toContain('back_to_incoming');
    expect(soon[0]?.text).toBe('Ahmed Khan goes back to Incoming in 10 min');
    expect(soon[0]?.severity).toBe('high');
    expect(notYet.map((r) => r.key)).not.toContain('back_to_incoming');
  });

  it('says so when the VIP clock has already run out', () => {
    const past = leadRisks(lead({
      isVip: true, vipDeadlineAt: new Date(NOW.getTime() - 5 * MINUTE),
    }), TAKE_BACK, NOW);
    expect(past[0]?.text).toBe('Ahmed Khan is 5 min past the time and going back');
  });

  it('warns on an imported lead against the owner s own saved clock', () => {
    const imported = (assignedHoursAgo: number, hours: number) => leadRisks(
      lead({
        importId: 'import-1',
        lastContactAt: null,
        assignedAt: new Date(NOW.getTime() - assignedHoursAgo * HOUR),
      }),
      { ...TAKE_BACK, importHours: hours },
      NOW,
    ).filter((r) => r.key === 'back_to_incoming');

    /* 24-hour clock, 23 hours gone: one hour left, which is the warning. */
    expect(imported(23, 24)).toHaveLength(1);
    expect(imported(22, 24)).toHaveLength(0);
    /* Change the setting to 4 hours and the warning moves with it. */
    expect(imported(3.5, 4)).toHaveLength(1);
  });

  it('says nothing about a take-back the owner has switched off', () => {
    const risks = leadRisks(
      lead({ isVip: true, vipDeadlineAt: new Date(NOW.getTime() + MINUTE) }),
      { ...TAKE_BACK, enabled: false },
      NOW,
    );
    expect(risks.map((r) => r.key)).not.toContain('back_to_incoming');
  });

  it('flags a lead nobody has touched, once it is old enough to count', () => {
    const old = leadRisks(lead({
      lastContactAt: null,
      createdAt: new Date(NOW.getTime() - TUNING.risk.notTouchedHours * HOUR),
    }), TAKE_BACK, NOW);
    const minutesOld = leadRisks(lead({
      lastContactAt: null, createdAt: new Date(NOW.getTime() - 10 * MINUTE), nextStepAt: null,
    }), TAKE_BACK, NOW);

    expect(old.map((r) => r.key)).toContain('not_touched');
    expect(minutesOld.map((r) => r.key)).not.toContain('not_touched');
  });

  it('reports an untouched lead once, not twice', () => {
    const risks = leadRisks(lead({
      lastContactAt: null, nextStepAt: null, createdAt: new Date(NOW.getTime() - DAY),
    }), TAKE_BACK, NOW);
    expect(risks.map((r) => r.key)).toEqual(['not_touched']);
  });

  it('flags a lead with nothing planned', () => {
    expect(TABS.no_next_step.where).toContain('next_step_at IS NULL');
    const risks = leadRisks(lead({ nextStepAt: null }), TAKE_BACK, NOW);
    expect(risks.map((r) => r.key)).toEqual(['no_next_step']);
    expect(risks[0]?.text).toBe('Ahmed Khan has nothing planned');
  });

  it('says nothing about a lead that is closed', () => {
    expect(leadRisks(lead({ status: 'won', nextStepAt: null }), TAKE_BACK, NOW)).toEqual([]);
  });

  it('uses a number or a plain word when the lead has no name', () => {
    const noName = leadRisks(lead({ name: null, nextStepAt: null }), TAKE_BACK, NOW);
    const nothing = leadRisks(
      lead({ name: null, phone: null, nextStepAt: null }), TAKE_BACK, NOW,
    );
    expect(noName[0]?.text).toContain('+971501234567');
    expect(nothing[0]?.text).toBe('A lead has nothing planned');
  });
});

describe('what is about to go wrong with an agent', () => {
  const HOURS = { startMinute: 10 * 60, endMinute: 19 * 60 };

  function agent(over: Partial<AgentFacts> = {}): AgentFacts {
    return {
      userId: 'agent-1',
      name: 'Rania',
      openLeads: 30,
      overdue: 2,
      deskName: null,
      deskMax: null,
      markedIn: true,
      onLeave: false,
      lastClickAt: new Date(NOW.getTime() - 5 * MINUTE),
      ...over,
    };
  }

  it('flags an idle agent at exactly the threshold', () => {
    const quiet = agentRisks(agent({
      lastClickAt: new Date(NOW.getTime() - TUNING.risk.idleMinutes * MINUTE),
    }), [], HOURS, NOW);
    const busy = agentRisks(agent({
      lastClickAt: new Date(NOW.getTime() - (TUNING.risk.idleMinutes - 1) * MINUTE),
    }), [], HOURS, NOW);

    expect(quiet.map((r) => r.key)).toContain('agent_idle');
    expect(quiet[0]?.text).toBe('Rania has made no call and no message for 2 hours');
    expect(busy.map((r) => r.key)).not.toContain('agent_idle');
  });

  it('measures from the office opening when they have clicked nothing at all', () => {
    /* 10:00 Dubai, office opened at 10:00: nothing yet is not yet idle. */
    const onOpening = agentRisks(agent({ lastClickAt: null }), [], HOURS, NOW);
    const later = agentRisks(
      agent({ lastClickAt: null }), [], HOURS, new Date('2026-11-14T08:00:00.000Z'), // 12:00
    );

    expect(onOpening.map((r) => r.key)).not.toContain('agent_idle');
    expect(later.map((r) => r.key)).toContain('agent_idle');
    expect(later[0]?.text).toBe('Rania has made no call and no message today');
  });

  it('says nothing about somebody who has not started, or is on leave', () => {
    const notIn = agent({ markedIn: false, lastClickAt: null });
    const away = agent({ onLeave: true, lastClickAt: null });
    const noon = new Date('2026-11-14T08:00:00.000Z');

    expect(agentRisks(notIn, [], HOURS, noon).map((r) => r.key)).not.toContain('agent_idle');
    expect(agentRisks(away, [], HOURS, noon).map((r) => r.key)).not.toContain('agent_idle');
  });

  it('says nothing about idleness outside office hours', () => {
    const night = new Date('2026-11-14T18:00:00.000Z'); // 22:00 Dubai
    expect(agentRisks(agent({ lastClickAt: null }), [], HOURS, night).map((r) => r.key))
      .not.toContain('agent_idle');
  });

  it('flags an agent over their desk s agreed maximum', () => {
    const over = agentRisks(
      agent({ openLeads: 41, deskMax: 40, deskName: 'Arabic desk' }), [], HOURS, NOW,
    );
    const at = agentRisks(agent({ openLeads: 40, deskMax: 40 }), [], HOURS, NOW);

    expect(over.map((r) => r.key)).toContain('agent_overloaded');
    expect(over.find((r) => r.key === 'agent_overloaded')?.text)
      .toBe('Rania has 41 leads · maximum is 40');
    expect(at.map((r) => r.key)).not.toContain('agent_overloaded');
  });

  it('falls back to the assignment screen s own rule when no desk maximum is set', () => {
    const team = [
      agent({ userId: 'a', openLeads: 100 }),
      agent({ userId: 'b', openLeads: 10 }),
      agent({ userId: 'c', openLeads: 10 }),
    ];
    const average = 40;
    expect(TUNING.risk.overloadFactor).toBe(OVERLOAD_FACTOR);

    const loaded = agentRisks(agent({ openLeads: 100 }), team, HOURS, NOW);
    expect(loaded.find((r) => r.key === 'agent_overloaded')?.text)
      .toBe(`Rania has 100 leads · the team averages ${average}`);

    const fine = agentRisks(agent({ openLeads: 10 }), team, HOURS, NOW);
    expect(fine.map((r) => r.key)).not.toContain('agent_overloaded');
  });

  it('will not call a quiet day an overload', () => {
    const team = [agent({ userId: 'a', openLeads: 3 }), agent({ userId: 'b', openLeads: 1 })];
    const under = agentRisks(
      agent({ openLeads: TUNING.risk.overloadFloor - 1 }), team, HOURS, NOW,
    );
    expect(under.map((r) => r.key)).not.toContain('agent_overloaded');
  });
});

/* ── words ────────────────────────────────────────────────────────────── */

describe('lengths of time, as somebody would say them', () => {
  it('reads naturally at every size', () => {
    expect(spoken(0)).toBe('0 min');
    expect(spoken(59)).toBe('59 min');
    expect(spoken(60)).toBe('1 hour');
    expect(spoken(150)).toBe('3 hours');
    expect(spoken(60 * 24)).toBe('1 day');
    expect(spoken(60 * 24 * 3)).toBe('3 days');
    expect(spoken(-5)).toBe('0 min');
  });
});
