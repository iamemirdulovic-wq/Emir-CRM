import { describe, expect, it } from 'vitest';
import {
  describeSuggestion, dueAt, suggestNextStep, WORK_END_MINUTE, WORK_START_MINUTE,
  type LeadForAdvice,
} from './next-step.js';

/* 12:00 Dubai on a Wednesday. Dubai is UTC+4 with no daylight saving, so
   08:00Z is 12:00 local all year. */
const NOW = new Date('2026-03-04T08:00:00.000Z');

function lead(over: Partial<LeadForAdvice> = {}): LeadForAdvice {
  return {
    stage: 'new_lead',
    subStatus: 'raw',
    status: 'open',
    lastContactAt: null,
    lastInboundAt: null,
    noAnswerCount: 0,
    nextStepAt: null,
    nextStepType: null,
    dnc: false,
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    ...over,
  };
}

const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const inDays = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

describe('suggestNextStep — what beats what', () => {
  it('suggests nothing on a won lead', () => {
    const advice = suggestNextStep(lead({ status: 'won', stage: 'won' }), NOW);
    expect(advice.suggest).toBeNull();
    expect((advice as { why: string }).why).toMatch(/won/i);
  });

  it('suggests nothing on a lost lead', () => {
    expect(suggestNextStep(lead({ status: 'lost', stage: 'lost' }), NOW).suggest).toBeNull();
  });

  it('never suggests a channel for somebody who asked us to stop', () => {
    const advice = suggestNextStep(lead({ dnc: true, lastContactAt: daysAgo(30) }), NOW);
    expect(advice.suggest).toBeNull();
    expect((advice as { why: string }).why).toMatch(/not to contact/i);
  });

  it('puts an unanswered reply above everything else', () => {
    /* Overdue promise AND an unanswered message: the message wins, because
       the client is sitting there watching for a reply. */
    const advice = suggestNextStep(
      lead({
        stage: 'attempted_contact',
        lastContactAt: hoursAgo(26),
        lastInboundAt: hoursAgo(3),
        nextStepAt: daysAgo(2),
        nextStepType: 'call',
      }),
      NOW,
    );
    expect(advice.suggest?.rule).toBe('unanswered_inbound');
    expect(advice.suggest?.type).toBe('whatsapp');
    expect(advice.suggest?.urgency).toBe('now');
    expect(advice.suggest?.why).toMatch(/3 hours ago/);
  });

  it('says "an hour ago", not "1 hours ago"', () => {
    const advice = suggestNextStep(lead({ lastContactAt: hoursAgo(5), lastInboundAt: hoursAgo(1) }), NOW);
    expect(advice.suggest?.why).toMatch(/an hour ago/);
  });

  it('treats a reply in the last few minutes as just-written', () => {
    const advice = suggestNextStep(
      lead({ lastContactAt: hoursAgo(5), lastInboundAt: new Date(NOW.getTime() - 4 * 60 * 1000) }),
      NOW,
    );
    expect(advice.suggest?.why).toMatch(/just written/i);
  });

  it('does not count our own later message as them writing last', () => {
    const advice = suggestNextStep(
      lead({ stage: 'attempted_contact', lastInboundAt: hoursAgo(10), lastContactAt: hoursAgo(2) }),
      NOW,
    );
    expect(advice.suggest?.rule).not.toBe('unanswered_inbound');
  });

  it('raises an overdue promise', () => {
    const advice = suggestNextStep(
      lead({ stage: 'engaged_qualified', subStatus: 'qualified', lastContactAt: daysAgo(3), nextStepAt: daysAgo(1), nextStepType: 'meeting' }),
      NOW,
    );
    expect(advice.suggest?.rule).toBe('overdue_promise');
    /* The channel is the one that was promised, not one we picked. */
    expect(advice.suggest?.type).toBe('meeting');
    expect(advice.suggest?.why).toMatch(/yesterday/);
  });

  it('keeps quiet when a step is already promised for later', () => {
    const advice = suggestNextStep(
      lead({ stage: 'engaged_qualified', lastContactAt: daysAgo(1), nextStepAt: inDays(2), nextStepType: 'call' }),
      NOW,
    );
    expect(advice.suggest).toBeNull();
    expect((advice as { why: string }).why).toMatch(/already promised/i);
  });

  it('falls back to a call when an overdue promise has no type', () => {
    const advice = suggestNextStep(lead({ lastContactAt: daysAgo(3), nextStepAt: daysAgo(1), nextStepType: null }), NOW);
    expect(advice.suggest?.type).toBe('call');
  });
});

describe('suggestNextStep — never contacted', () => {
  it('asks for the first call', () => {
    const advice = suggestNextStep(lead({ createdAt: hoursAgo(2) }), NOW);
    expect(advice.suggest?.rule).toBe('never_contacted');
    expect(advice.suggest?.type).toBe('call');
    expect(advice.suggest?.inDays).toBe(0);
    expect(advice.suggest?.urgency).toBe('now');
  });

  it('says how old the lead is once it is a day old', () => {
    expect(suggestNextStep(lead({ createdAt: daysAgo(4) }), NOW).suggest?.why).toMatch(/4 days old/);
    expect(suggestNextStep(lead({ createdAt: daysAgo(1) }), NOW).suggest?.why).toMatch(/a day old/);
  });

  it('still asks for the first call on a lead sitting in a later stage', () => {
    /* Somebody dragged the card without ringing. The advice is the same. */
    const advice = suggestNextStep(lead({ stage: 'engaged_qualified', subStatus: 'engaged', createdAt: daysAgo(2) }), NOW);
    expect(advice.suggest?.rule).toBe('never_contacted');
  });
});

describe('suggestNextStep — attempted contact', () => {
  it('alternates to WhatsApp after three unanswered calls', () => {
    const advice = suggestNextStep(
      lead({ stage: 'attempted_contact', subStatus: 'attempt_3', noAnswerCount: 3, lastContactAt: hoursAgo(5) }),
      NOW,
    );
    expect(advice.suggest?.rule).toBe('switch_channel');
    expect(advice.suggest?.type).toBe('whatsapp');
    /* Rung five hours ago: give it two days before trying the other channel. */
    expect(advice.suggest?.inDays).toBe(2);
  });

  it('does not make the agent wait when the last attempt was days ago', () => {
    const advice = suggestNextStep(
      lead({ stage: 'attempted_contact', noAnswerCount: 4, lastContactAt: daysAgo(5) }),
      NOW,
    );
    expect(advice.suggest?.rule).toBe('switch_channel');
    expect(advice.suggest?.inDays).toBe(0);
  });

  it('calls time after six attempts', () => {
    const advice = suggestNextStep(
      lead({ stage: 'attempted_contact', subStatus: 'no_answer', noAnswerCount: 6, lastContactAt: daysAgo(2) }),
      NOW,
    );
    expect(advice.suggest?.rule).toBe('six_attempts');
    expect(advice.suggest?.note).toMatch(/last try/i);
    expect(advice.suggest?.why).toMatch(/unresponsive/);
  });

  it('switches to email on a wrong number rather than ringing it again', () => {
    const advice = suggestNextStep(
      lead({ stage: 'attempted_contact', subStatus: 'wrong_number', noAnswerCount: 1, lastContactAt: hoursAgo(2) }),
      NOW,
    );
    expect(advice.suggest?.type).toBe('email');
    expect(advice.suggest?.rule).toBe('wrong_number');
  });

  it('asks for one more call after a single miss, tomorrow', () => {
    const advice = suggestNextStep(
      lead({ stage: 'attempted_contact', noAnswerCount: 1, lastContactAt: hoursAgo(3) }),
      NOW,
    );
    expect(advice.suggest?.type).toBe('call');
    expect(advice.suggest?.inDays).toBe(1);
    expect(advice.suggest?.why).toMatch(/One call/);
  });
});

describe('suggestNextStep — the middle of the pipeline', () => {
  it('asks for the viewing when a lead is engaged', () => {
    const advice = suggestNextStep(
      lead({ stage: 'engaged_qualified', subStatus: 'engaged', lastContactAt: hoursAgo(4) }),
      NOW,
    );
    expect(advice.suggest?.type).toBe('viewing');
    expect(advice.suggest?.rule).toBe('engaged_to_viewing');
  });

  it('asks for a meeting once they are qualified', () => {
    const advice = suggestNextStep(
      lead({ stage: 'engaged_qualified', subStatus: 'qualified', lastContactAt: hoursAgo(4) }),
      NOW,
    );
    expect(advice.suggest?.type).toBe('meeting');
  });

  it('spaces a nurture lead a fortnight out', () => {
    const advice = suggestNextStep(
      lead({ stage: 'engaged_qualified', subStatus: 'nurture', lastContactAt: daysAgo(3) }),
      NOW,
    );
    expect(advice.suggest?.inDays).toBe(14);
    expect(advice.suggest?.urgency).toBe('later');
  });

  it('sends the offer the same day after a viewing', () => {
    const advice = suggestNextStep(
      lead({ stage: 'appointment_scheduled', subStatus: 'showed', lastContactAt: hoursAgo(2) }),
      NOW,
    );
    expect(advice.suggest?.note).toMatch(/offer/i);
    expect(advice.suggest?.inDays).toBe(0);
    expect(advice.suggest?.urgency).toBe('now');
  });

  it('rings a no-show the same day', () => {
    const advice = suggestNextStep(
      lead({ stage: 'appointment_scheduled', subStatus: 'no_show', lastContactAt: hoursAgo(6) }),
      NOW,
    );
    expect(advice.suggest?.type).toBe('call');
    expect(advice.suggest?.rule).toBe('no_show');
  });

  it('confirms a booked appointment', () => {
    const advice = suggestNextStep(
      lead({ stage: 'appointment_scheduled', subStatus: 'booked', lastContactAt: hoursAgo(6) }),
      NOW,
    );
    expect(advice.suggest?.rule).toBe('confirm_appointment');
  });

  it('chases the signature on a sent deal', () => {
    const advice = suggestNextStep(
      lead({ stage: 'deal_sent', subStatus: 'eoi_sent', lastContactAt: hoursAgo(6) }),
      NOW,
    );
    expect(advice.suggest?.rule).toBe('chase_signature');
    expect(advice.suggest?.urgency).toBe('now');
  });

  it('chases the money once it is signed', () => {
    const advice = suggestNextStep(
      lead({ stage: 'deal_sent', subStatus: 'awaiting_payment', lastContactAt: daysAgo(3) }),
      NOW,
    );
    expect(advice.suggest?.rule).toBe('chase_payment');
    expect(advice.suggest?.inDays).toBe(0);
  });
});

describe('suggestNextStep — silence', () => {
  it('leaves an invalid lead alone', () => {
    const advice = suggestNextStep(
      lead({ stage: 'new_lead', subStatus: 'invalid', lastContactAt: hoursAgo(2) }),
      NOW,
    );
    expect(advice.suggest).toBeNull();
  });

  it('nudges a confirmed appointment that has gone quiet for a week', () => {
    const advice = suggestNextStep(
      lead({ stage: 'appointment_scheduled', subStatus: 'confirmed', lastContactAt: daysAgo(9) }),
      NOW,
    );
    expect(advice.suggest?.rule).toBe('gone_quiet');
    expect(advice.suggest?.why).toMatch(/9 days/);
  });

  it('says nothing is owed when the lead was just dealt with', () => {
    const advice = suggestNextStep(
      lead({ stage: 'appointment_scheduled', subStatus: 'confirmed', lastContactAt: hoursAgo(3) }),
      NOW,
    );
    expect(advice.suggest).toBeNull();
    expect((advice as { why: string }).why).toMatch(/Nothing is owed/i);
  });
});

describe('dueAt', () => {
  const minuteOf = (date: Date) => {
    const shifted = new Date(date.getTime() + 4 * 60 * 60 * 1000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  };
  const dubaiDay = (date: Date) => new Date(date.getTime() + 4 * 60 * 60 * 1000).getUTCDate();

  it('puts "today" ninety minutes out during working hours', () => {
    const due = dueAt({ inDays: 0 }, NOW);
    expect(due.getTime() - NOW.getTime()).toBe(90 * 60 * 1000);
  });

  it('opens the office before suggesting an early-morning step', () => {
    /* 06:30 Dubai. */
    const early = new Date('2026-03-04T02:30:00.000Z');
    const due = dueAt({ inDays: 0 }, early);
    expect(minuteOf(due)).toBe(WORK_START_MINUTE);
    expect(dubaiDay(due)).toBe(dubaiDay(early));
  });

  it('never lands a step in the evening — it goes to tomorrow morning', () => {
    /* 19:00 Dubai: ninety minutes later is 20:30, past the end of the day. */
    const evening = new Date('2026-03-04T15:00:00.000Z');
    const due = dueAt({ inDays: 0 }, evening);
    expect(minuteOf(due)).toBe(WORK_START_MINUTE);
    expect(dubaiDay(due)).toBe(dubaiDay(evening) + 1);
  });

  it('keeps a late-evening step inside working hours', () => {
    /* 23:30 Dubai is already tomorrow in no sense an agent cares about. */
    const night = new Date('2026-03-04T19:30:00.000Z');
    const due = dueAt({ inDays: 0 }, night);
    expect(minuteOf(due)).toBeGreaterThanOrEqual(WORK_START_MINUTE);
    expect(minuteOf(due)).toBeLessThanOrEqual(WORK_END_MINUTE);
  });

  it('puts a future step at 10:00 Dubai', () => {
    const due = dueAt({ inDays: 2 }, NOW);
    expect(minuteOf(due)).toBe(600);
    expect(dubaiDay(due)).toBe(dubaiDay(NOW) + 2);
  });

  it('crosses a month boundary correctly', () => {
    /* 30 March + 3 days = 2 April. */
    const due = dueAt({ inDays: 3 }, new Date('2026-03-30T08:00:00.000Z'));
    const shifted = new Date(due.getTime() + 4 * 60 * 60 * 1000);
    expect(shifted.getUTCMonth()).toBe(3);
    expect(shifted.getUTCDate()).toBe(2);
  });
});

describe('describeSuggestion', () => {
  const base = { type: 'call', inDays: 0, note: '', why: '', urgency: 'now', rule: 'x' } as const;

  it('reads as a sentence', () => {
    expect(describeSuggestion({ ...base })).toBe('Call them, today');
    expect(describeSuggestion({ ...base, type: 'whatsapp', inDays: 1 })).toBe('Send a WhatsApp, tomorrow');
    expect(describeSuggestion({ ...base, type: 'viewing', inDays: 3 })).toBe('Book a viewing, in 3 days');
  });

  it('counts a fortnight in weeks, not days', () => {
    expect(describeSuggestion({ ...base, type: 'whatsapp', inDays: 14 })).toBe('Send a WhatsApp, in 2 weeks');
  });

  it('has a phrase for every channel', () => {
    for (const type of ['call', 'whatsapp', 'email', 'meeting', 'viewing', 'other'] as const) {
      expect(describeSuggestion({ ...base, type })).not.toMatch(/undefined/);
    }
  });
});
