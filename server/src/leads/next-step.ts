import { DUBAI_OFFSET_MINUTES } from '../routing/hours.js';
import type { StageKey } from '../pipeline/stages.js';

/**
 * What to do next with this lead, decided by rules rather than by a model.
 *
 * The AI is allowed to reword the note. It is not allowed to choose the date,
 * the channel or whether to contact somebody at all, because those three are
 * the ones that cost money when they are wrong: a suggested viewing on a date
 * the model made up, a WhatsApp to somebody who asked us to stop, a call at
 * 2am. Rules decide those, the same way every time, and they work with AI
 * switched off entirely — which is how this CRM will run most days.
 *
 * Nothing here writes anything. A suggestion is shown with a button, and the
 * agent presses it or ignores it.
 */

export type NextStepType = 'call' | 'whatsapp' | 'email' | 'meeting' | 'viewing' | 'other';

export type NextStepUrgency = 'now' | 'soon' | 'later';

export interface NextStepSuggestion {
  type: NextStepType;
  /** 0 means today. The date itself is worked out by `dueAt`. */
  inDays: number;
  /** What goes in the next-step note, in the agent's words. */
  note: string;
  /** Why this, so the agent can disagree with the reasoning and not just the answer. */
  why: string;
  urgency: NextStepUrgency;
  /** The rule that fired, for the tests and for the audit trail. */
  rule: string;
}

/** No suggestion, and the reason — which is often the useful part. */
export interface NoSuggestion {
  suggest: null;
  why: string;
}

export type NextStepAdvice = { suggest: NextStepSuggestion } | NoSuggestion;

export interface LeadForAdvice {
  stage: StageKey;
  subStatus: string | null;
  /** Closed leads get no advice. */
  status: 'open' | 'won' | 'lost' | string;
  /** When a human last reached out. */
  lastContactAt: Date | null;
  /** When the lead last wrote to us. */
  lastInboundAt: Date | null;
  /** Rung and not answered, counted. */
  noAnswerCount: number;
  /** A step already promised, if there is one. */
  nextStepAt: Date | null;
  nextStepType: NextStepType | null;
  /** They asked us to stop. */
  dnc: boolean;
  createdAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The next step, or nothing.
 *
 * Ordered by what beats what. The first rule that fires wins, and the order is
 * the argument: an unanswered reply beats a scheduled follow-up, and a lead
 * nobody has rung beats everything.
 */
export function suggestNextStep(lead: LeadForAdvice, now: Date = new Date()): NextStepAdvice {
  if (lead.status === 'won') return { suggest: null, why: 'This one is won. Books takes it from here.' };
  if (lead.status === 'lost') return { suggest: null, why: 'This lead is closed.' };

  /*
   * Asked us to stop. Not a step with a different channel — no step at all.
   * An agent who wants to ring them anyway can, and should think about it
   * first, which is exactly what an empty suggestion makes them do.
   */
  if (lead.dnc) {
    return { suggest: null, why: 'They asked us not to contact them. Nothing to suggest.' };
  }

  const overdue = lead.nextStepAt !== null && lead.nextStepAt.getTime() < now.getTime();
  const promised = lead.nextStepAt !== null && !overdue;

  /* Unanswered inbound beats everything that is not already overdue. */
  const theyWroteLast =
    lead.lastInboundAt !== null &&
    (lead.lastContactAt === null || lead.lastInboundAt.getTime() > lead.lastContactAt.getTime());

  if (theyWroteLast) {
    const waitingHours = Math.floor((now.getTime() - (lead.lastInboundAt as Date).getTime()) / (60 * 60 * 1000));
    return {
      suggest: {
        type: 'whatsapp',
        inDays: 0,
        note: 'Answer their message',
        why:
          waitingHours >= 1
            ? `They wrote ${waitingHours === 1 ? 'an hour' : `${waitingHours} hours`} ago and nobody has replied.`
            : 'They have just written and nobody has replied yet.',
        urgency: 'now',
        rule: 'unanswered_inbound',
      },
    };
  }

  if (overdue) {
    const lateDays = Math.floor((now.getTime() - (lead.nextStepAt as Date).getTime()) / DAY_MS);
    return {
      suggest: {
        type: lead.nextStepType ?? 'call',
        inDays: 0,
        note: 'The step you promised',
        why:
          lateDays >= 1
            ? `You promised this ${lateDays === 1 ? 'yesterday' : `${lateDays} days ago`} and it has not happened.`
            : 'You promised this earlier today.',
        urgency: 'now',
        rule: 'overdue_promise',
      },
    };
  }

  if (promised) {
    return { suggest: null, why: 'You have already promised a next step. Nothing to add.' };
  }

  const silentDays =
    lead.lastContactAt === null
      ? Math.floor((now.getTime() - lead.createdAt.getTime()) / DAY_MS)
      : Math.floor((now.getTime() - lead.lastContactAt.getTime()) / DAY_MS);

  /* Nobody has ever reached out. The oldest failure in this business. */
  if (lead.lastContactAt === null) {
    return {
      suggest: {
        type: 'call',
        inDays: 0,
        note: 'First call',
        why:
          silentDays >= 1
            ? `Nobody has spoken to them yet and the lead is ${silentDays === 1 ? 'a day' : `${silentDays} days`} old.`
            : 'Nobody has spoken to them yet.',
        urgency: 'now',
        rule: 'never_contacted',
      },
    };
  }

  const byStage = stageRule(lead, silentDays);
  if (byStage) return { suggest: byStage };

  /* Nothing the stage asks for, but it has gone quiet. */
  if (silentDays >= 7) {
    return {
      suggest: {
        type: 'whatsapp',
        inDays: 0,
        note: 'Check in',
        why: `Nobody has been in touch for ${silentDays} days.`,
        urgency: 'soon',
        rule: 'gone_quiet',
      },
    };
  }

  return { suggest: null, why: 'Nothing is owed on this lead today.' };
}

/** The stage-by-stage part, split out to keep the priority order above readable. */
function stageRule(lead: LeadForAdvice, silentDays: number): NextStepSuggestion | null {
  const sub = lead.subStatus;

  switch (lead.stage) {
    case 'new_lead':
      if (sub === 'invalid' || sub === 'duplicate') return null;
      return {
        type: 'call',
        inDays: 0,
        note: 'First call',
        why: 'Still sitting in New Lead.',
        urgency: 'now',
        rule: 'new_lead',
      };

    case 'attempted_contact': {
      if (sub === 'wrong_number') {
        return {
          type: 'email',
          inDays: 0,
          note: 'Try email — the number is wrong',
          why: 'The number does not work, so the phone is not the way in.',
          urgency: 'soon',
          rule: 'wrong_number',
        };
      }
      if (lead.noAnswerCount >= 6) {
        return {
          type: 'whatsapp',
          inDays: 0,
          note: 'Last try, then close the file',
          why: `Rung ${lead.noAnswerCount} times with no answer. One message, then mark them unresponsive.`,
          urgency: 'soon',
          rule: 'six_attempts',
        };
      }
      /*
       * Alternate the channel. Somebody who has not picked up twice is not
       * going to pick up the third time either, and a WhatsApp gets read.
       */
      if (lead.noAnswerCount >= 3) {
        return {
          type: 'whatsapp',
          inDays: silentDays >= 2 ? 0 : 2,
          note: 'Message instead of ringing',
          why: `${lead.noAnswerCount} calls, no answer. Try the other channel.`,
          urgency: 'soon',
          rule: 'switch_channel',
        };
      }
      return {
        type: 'call',
        inDays: silentDays >= 1 ? 0 : 1,
        note: 'Try again',
        why:
          lead.noAnswerCount > 0
            ? `${lead.noAnswerCount === 1 ? 'One call' : `${lead.noAnswerCount} calls`} so far, no answer.`
            : 'Contact attempted, nothing back yet.',
        urgency: 'soon',
        rule: 'try_again',
      };
    }

    case 'engaged_qualified':
      if (sub === 'nurture') {
        return {
          type: 'whatsapp',
          inDays: silentDays >= 14 ? 0 : 14,
          note: 'Nurture check-in',
          why: 'On the long list. A note every couple of weeks keeps it warm.',
          urgency: 'later',
          rule: 'nurture',
        };
      }
      if (sub === 'qualified') {
        return {
          type: 'meeting',
          inDays: silentDays >= 2 ? 0 : 2,
          note: 'Get a meeting in the diary',
          why: 'Qualified and talking. The next thing that moves this is a meeting.',
          urgency: 'soon',
          rule: 'qualified_to_meeting',
        };
      }
      return {
        type: 'viewing',
        inDays: silentDays >= 1 ? 0 : 1,
        note: 'Offer a viewing',
        why: 'Engaged but nothing booked. Ask for the viewing.',
        urgency: 'soon',
        rule: 'engaged_to_viewing',
      };

    case 'appointment_scheduled':
      if (sub === 'no_show') {
        return {
          type: 'call',
          inDays: 0,
          note: 'They did not turn up — find out why',
          why: 'A no-show is not a no. Ring them the same day.',
          urgency: 'now',
          rule: 'no_show',
        };
      }
      if (sub === 'showed') {
        return {
          type: 'whatsapp',
          inDays: 0,
          note: 'Send the offer while it is fresh',
          why: 'They have seen it. The offer goes out today, not next week.',
          urgency: 'now',
          rule: 'showed_send_offer',
        };
      }
      if (sub === 'booked') {
        return {
          type: 'whatsapp',
          inDays: 0,
          note: 'Confirm the appointment',
          why: 'Booked but not confirmed. A confirmed appointment is the one they turn up to.',
          urgency: 'soon',
          rule: 'confirm_appointment',
        };
      }
      return null;

    case 'deal_sent':
      if (sub === 'awaiting_payment') {
        return {
          type: 'call',
          inDays: silentDays >= 2 ? 0 : 2,
          note: 'Chase the payment',
          why: 'Signed and waiting on the money. This is the call that closes it.',
          urgency: 'now',
          rule: 'chase_payment',
        };
      }
      return {
        type: 'call',
        inDays: silentDays >= 1 ? 0 : 1,
        note: 'Chase the signature',
        why: 'The offer is with them. Nothing happens until somebody asks.',
        urgency: 'now',
        rule: 'chase_signature',
      };

    default:
      return null;
  }
}

/**
 * The actual moment a suggestion is due, in Dubai working hours.
 *
 * Office hours rather than quiet hours: a reminder is for a person, and a
 * person does not ring a client at 07:00 even though the rule that stops
 * automated messages has already let go.
 */
export const WORK_START_MINUTE = 9 * 60 + 30;
export const WORK_END_MINUTE = 19 * 60 + 30;
/** How long "today" means when it is said during working hours. */
const SOON_MINUTES = 90;

export function dueAt(suggestion: Pick<NextStepSuggestion, 'inDays'>, now: Date = new Date()): Date {
  const minuteNow = dubaiMinuteOfDay(now);

  if (suggestion.inDays <= 0) {
    if (minuteNow < WORK_START_MINUTE) return atDubaiMinute(now, 0, WORK_START_MINUTE);
    const soon = minuteNow + SOON_MINUTES;
    if (soon <= WORK_END_MINUTE) return new Date(now.getTime() + SOON_MINUTES * 60_000);
    /* Too late in the day to be a real plan. First thing tomorrow instead. */
    return atDubaiMinute(now, 1, WORK_START_MINUTE);
  }

  return atDubaiMinute(now, suggestion.inDays, 10 * 60);
}

function dubaiMinuteOfDay(at: Date): number {
  const shifted = new Date(at.getTime() + DUBAI_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** `days` from now, at `minute` past midnight Dubai, returned as a real instant. */
function atDubaiMinute(now: Date, days: number, minute: number): Date {
  const shifted = new Date(now.getTime() + DUBAI_OFFSET_MINUTES * 60_000);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() + minute * 60_000 - DUBAI_OFFSET_MINUTES * 60_000);
}

/**
 * How a suggestion reads on screen: "Call them, today" / "WhatsApp, in 2 days".
 */
export function describeSuggestion(suggestion: NextStepSuggestion): string {
  const ACTION: Record<NextStepType, string> = {
    call: 'Call them',
    whatsapp: 'Send a WhatsApp',
    email: 'Send an email',
    meeting: 'Book a meeting',
    viewing: 'Book a viewing',
    other: 'Follow up',
  };
  const when =
    suggestion.inDays <= 0
      ? 'today'
      : suggestion.inDays === 1
        ? 'tomorrow'
        : suggestion.inDays >= 14
          ? `in ${Math.round(suggestion.inDays / 7)} weeks`
          : `in ${suggestion.inDays} days`;
  return `${ACTION[suggestion.type]}, ${when}`;
}
