/**
 * Homes AI — the brain, as rules.
 *
 * Emir's decision of 14 November (`DECISIONS.md`, first entry): **no outside
 * AI.** No Gemini, no OpenAI, no key, no cost, and no client data leaving the
 * server. Everything Homes AI says about a lead, a day or an agent is counted
 * here from our own MySQL. His instruction about this file was exact: *"Put
 * all rules in ONE file, so we can change them easily."* So every number a
 * rule turns on sits in `TUNING` at the top, with a sentence saying what it
 * does, and nothing below it holds a second copy of one.
 *
 * Four things live here, and they are the four from the brief's section C:
 *
 *  1. **Heat** — 0–100 for every lead, with the reasons that made it, so the
 *     card can show "why" on a tap.
 *  2. **Priority** — what to do now, in order, with the people who are asleep
 *     in their own country taken out of it.
 *  3. **Golden hour** — who is awake right now, and for how long.
 *  4. **Risks** — a lead about to go back to Incoming, one with no next step,
 *     one nobody has touched, an idle agent, an overloaded agent.
 *
 * ── Three rules this file obeys ───────────────────────────────────────────
 *
 * **It reuses, it does not re-decide.** The quality half of heat is the lead's
 * stored `lead_score`, which is `scoring/score.ts`'s own output written by the
 * `lead.score` job — the same number the pipeline card and the Hot tab show.
 * What to *do* with a lead is `leads/next-step.ts`, called, never guessed at
 * again. Overdue, due today, going cold and hot are `leads/tabs.ts`'s
 * definitions, read in JavaScript here and proved equal to the tab counts by
 * `rules.integration.test.ts`. Night where the client is, is
 * `leads/countries.ts`. Office hours are `routing/hours.ts`. Overload is
 * `assignment/distribute.ts`'s own factor. The take-back clocks are the
 * owner's saved settings in `v2/office-rules.ts`.
 *
 * **Every answer is fenced on the server.** Each function that touches the
 * database takes the viewer and narrows on `ownerPredicate` over
 * `visibleUserIds` — an agent gets their own leads, a manager their team,
 * owner and admin everything. Nothing a caller passes can widen that.
 *
 * **Nothing is invented.** A missing field is left out of the reasons rather
 * than guessed, and no price, handover date or payment plan is read from
 * anywhere but `projects` / `units` — which is to say, not from this file at
 * all.
 */
import { query, getPool, type Executor, type SqlParam } from '../db/client.js';
import { ownerPredicate, visibleUserIds } from '../auth/scope.js';
import type { Role } from '../auth/rbac.js';
import { HOT_SCORE_THRESHOLD } from '../config/constants.js';
import { bandFor, scoreLead, type ScoreBand, type ScoreSignals } from '../scoring/score.js';
import { TABS, urgencyOf } from '../leads/tabs.js';
import {
  describeSuggestion, suggestNextStep,
  type LeadForAdvice, type NextStepAdvice, type NextStepType,
} from '../leads/next-step.js';
import { CALL_FROM, CALL_UNTIL, countryOf, flagOf, isNight, timeIn } from '../leads/countries.js';
import { dubaiMinuteOfDay, parseClock } from '../routing/hours.js';
import { OVERLOAD_FACTOR } from '../assignment/distribute.js';
import { officeRules, type TakeBack } from '../v2/office-rules.js';
import { attendanceSettings } from '../attendance/settings.js';
import { countedAgentSql } from '../users/counting.js';
import { DAY_START, TODAY } from '../v2/dubai.js';
import type { StageKey } from '../pipeline/stages.js';

/* ════════════════════════════════════════════════════════════════════════
   THE NUMBERS. Change them here and nowhere else.
   ════════════════════════════════════════════════════════════════════════ */

export const TUNING = {
  heat: {
    /** A lead this new counts as new, in hours since it arrived. */
    newLeadHours: 24,
    /** What a brand-new lead nobody has rung yet is worth. */
    newLeadPoints: 12,
    /** The owner handed this one over personally. */
    vipPoints: 15,
    /** They wrote and nobody has answered yet. The strongest live signal. */
    replyWaitingPoints: 12,
    /** They wrote recently and we did answer. Still warm. */
    replyAnsweredPoints: 6,
    /** How recent a reply has to be to count at all, in hours. */
    replyFreshHours: 48,
    /** They opened a link we sent — a brochure, an offer, a project page. */
    linkOpenPoints: 10,
    /** How recent that open has to be, in days. */
    linkOpenDays: 7,
    /** A meeting in the diary that has not happened yet. */
    meetingBookedPoints: 10,
    /** Days of silence allowed before the lead starts cooling. */
    quietAfterDays: 3,
    /** Taken off per day of silence past that. */
    quietPerDay: 2,
    /** The most silence can take off. */
    quietMax: 20,
    /** Rings with no answer allowed before it counts against the lead. */
    triesBeforePenalty: 2,
    /** Taken off per unanswered ring past that. */
    triesPerTry: 3,
    /** The most unanswered rings can take off. */
    triesMax: 15,
    /** A follow-up promised and missed. */
    overduePoints: 8,
    /** Taken off per further day late. */
    overduePerDay: 2,
    /** The most lateness can take off. */
    overdueMax: 20,
  },

  priority: {
    /**
     * Days of silence with nothing planned before a lead is "going cold".
     *
     * **This must stay 7.** It is the "Going cold" tab in `leads/tabs.ts` and
     * the `markGoingCold` office rule, both of which say it in SQL; a third
     * spelling of the same rule is what makes two screens disagree.
     * `rules.integration.test.ts` fails if this drifts from the tab.
     */
    coldAfterDays: 7,
  },

  golden: {
    /**
     * The hours it is decent to ring somebody, in their own clock.
     *
     * Not set here: they are `CALL_FROM` and `CALL_UNTIL` in
     * `leads/countries.ts`, which is also what draws the moon on a country
     * chip and what the browser's dialler obeys. Named here so this file
     * reads completely, and read from there so there is one of them.
     */
    fromHour: CALL_FROM,
    untilHour: CALL_UNTIL,
  },

  risk: {
    /** Minutes before a VIP lead goes back to Incoming to start warning. */
    vipWarnMinutes: 10,
    /** The same for an imported lead, which gets a longer clock. */
    importWarnMinutes: 60,
    /** How old a lead has to be before "nobody has touched it" is a problem. */
    notTouchedHours: 2,
    /** Minutes an agent who is checked in may make no call and no message. */
    idleMinutes: 90,
    /**
     * Open leads an agent must hold before the team-average test can fire.
     *
     * Without a floor, three leads against a team average of one reads as an
     * overload, which is nonsense on a quiet Monday.
     */
    overloadFloor: 20,
    /**
     * How far above the team average counts as overloaded.
     *
     * `assignment/distribute.ts`'s own constant, reused rather than copied:
     * the warning before an assignment and the warning after it must be the
     * same warning.
     */
    overloadFactor: OVERLOAD_FACTOR,
  },

  limits: {
    /**
     * How many open leads one answer reads.
     *
     * Everything here is counted in JavaScript over rows, which is honest and
     * cheap up to a few thousand. Past this the answer says `truncated` and
     * the counts are over the newest work rather than the whole book — the
     * page's own totals come from `leadTabCounts` either way.
     */
    leads: 1000,
  },
} as const;

/* ════════════════════════════════════════════════════════════════════════
   WHAT A RULE IS GIVEN
   ════════════════════════════════════════════════════════════════════════ */

/** Who is asking. Anything with an id and a role fits, session user included. */
export type Viewer = { id: string; role: Role };

/**
 * One open lead, as the rules need it.
 *
 * Deliberately flat and deliberately only facts: every field is a column, and
 * nothing in here was worked out by anybody's opinion.
 */
export interface LeadFacts {
  id: string;
  contactId: string;
  name: string | null;
  phone: string | null;
  project: string | null;
  stage: StageKey;
  subStatus: string | null;
  status: 'open' | 'won' | 'lost';
  ownerUserId: string | null;
  /** The stored score. `scoring/score.ts`'s answer, as the page shows it. */
  score: number;
  /** The stored band, which is what the Hot tab counts. */
  band: ScoreBand | null;
  /** The stored sentence behind the score: "Budget AED 2.5M · ready now". */
  scoreReason: string | null;
  isVip: boolean;
  createdAt: Date;
  assignedAt: Date | null;
  lastContactAt: Date | null;
  lastInboundAt: Date | null;
  nextStepAt: Date | null;
  nextStepType: NextStepType | null;
  noAnswerCount: number;
  dnc: boolean;
  /** Set when the lead came in on a spreadsheet, which gets its own clock. */
  importId: string | null;
  /** The clock the owner put on a VIP hand-over, while one is running. */
  vipDeadlineAt: Date | null;
  vipFirstCallAt: Date | null;
  /** The last time they opened something we sent them. */
  lastLinkOpenAt: Date | null;
  /** The next meeting in the diary, if one is booked. */
  nextMeetingAt: Date | null;
}

/** One agent, as the risk rules need them. */
export interface AgentFacts {
  userId: string;
  name: string;
  openLeads: number;
  overdue: number;
  deskName: string | null;
  deskMax: number | null;
  /** They marked themselves in today. */
  markedIn: boolean;
  onLeave: boolean;
  /** The last call or message tap of any kind, today. */
  lastClickAt: Date | null;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/* ════════════════════════════════════════════════════════════════════════
   1. HEAT
   ════════════════════════════════════════════════════════════════════════ */

export interface HeatReason {
  /** Stable, for the tests and for a chip the UI can colour. */
  key: string;
  /** The same thing in words a person reads. */
  text: string;
  points: number;
}

export interface Heat {
  score: number;
  band: ScoreBand;
  isHot: boolean;
  /** What the base score was before anything recent moved it. */
  base: number;
  /** Everything that moved it, biggest first. The "why" on a tap. */
  reasons: HeatReason[];
  /** The three that moved it most, as one line. */
  why: string;
}

/**
 * How warm this lead is right now, 0–100.
 *
 * Two halves, and keeping them apart is the whole design.
 *
 * The **base** is the lead's stored `lead_score`: budget, timeline, a valid
 * number, whether they ever replied, spam signals. That is `scoreLead`'s
 * answer, already written to the row by the `lead.score` job, and reading it
 * rather than working it out again is what stops this file disagreeing with
 * the number printed on the card.
 *
 * The **heat** is what the base cannot see, because the base is about what the
 * lead *said* and heat is about what has *happened since*: a lead that arrived
 * an hour ago, a message waiting for an answer, a brochure opened last night,
 * a meeting on Thursday — against silence, unanswered rings and a follow-up
 * nobody kept.
 *
 * So "budget set" and "they replied" from the owner's list are in the base and
 * appear in the reasons through the stored sentence. They are not added again
 * here; a signal counted twice is a score nobody can explain.
 */
export function heatScore(lead: LeadFacts, now: Date = new Date()): Heat {
  const t = TUNING.heat;
  const base = clamp(Math.round(lead.score), 0, 100);
  const reasons: HeatReason[] = [{
    key: 'quality',
    text: lead.scoreReason ?? 'Nothing to go on yet',
    points: base,
  }];

  const add = (key: string, text: string, points: number) => {
    if (points !== 0) reasons.push({ key, text, points });
  };

  /* ── up ── */

  const ageHours = hoursBetween(lead.createdAt, now);
  if (ageHours <= t.newLeadHours && lead.lastContactAt === null) {
    add('new_lead', `New, arrived ${spoken(Math.round(ageHours * 60))} ago`, t.newLeadPoints);
  }

  if (lead.isVip) add('vip', 'The owner gave this one over personally', t.vipPoints);

  if (lead.lastInboundAt !== null && hoursBetween(lead.lastInboundAt, now) <= t.replyFreshHours) {
    const waiting = lead.lastContactAt === null
      || lead.lastInboundAt.getTime() > lead.lastContactAt.getTime();
    if (waiting) {
      add('reply_waiting', 'They wrote and nobody has answered', t.replyWaitingPoints);
    } else {
      add('reply_answered', 'They wrote back recently', t.replyAnsweredPoints);
    }
  }

  if (lead.lastLinkOpenAt !== null
    && daysBetween(lead.lastLinkOpenAt, now) <= t.linkOpenDays) {
    add('link_open', 'They opened a link we sent', t.linkOpenPoints);
  }

  if (lead.nextMeetingAt !== null && lead.nextMeetingAt.getTime() > now.getTime()) {
    add('meeting_booked', 'A meeting is in the diary', t.meetingBookedPoints);
  }

  /* ── down ── */

  /*
   * Silence only counts against a lead nobody is coming back to. A lead with
   * a date on it is being worked, however long ago it was last spoken to —
   * the same reading as the "Going cold" tab, which excludes anything with a
   * next step for exactly this reason.
   */
  const planned = lead.nextStepAt !== null && lead.nextStepAt.getTime() > now.getTime();
  const quietDays = Math.floor(daysBetween(lead.lastContactAt ?? lead.createdAt, now));
  if (!planned && quietDays > t.quietAfterDays) {
    const off = Math.min(t.quietMax, (quietDays - t.quietAfterDays) * t.quietPerDay);
    add('quiet', `No contact for ${quietDays} days`, -off);
  }

  if (lead.noAnswerCount > t.triesBeforePenalty) {
    const over = lead.noAnswerCount - t.triesBeforePenalty;
    add(
      'no_answer',
      `Rung ${lead.noAnswerCount} times with no answer`,
      -Math.min(t.triesMax, over * t.triesPerTry),
    );
  }

  if (lead.nextStepAt !== null && urgencyOf(lead.nextStepAt, now) === 'overdue') {
    const lateDays = Math.floor(daysBetween(lead.nextStepAt, now));
    const off = Math.min(t.overdueMax, t.overduePoints + lateDays * t.overduePerDay);
    add(
      'overdue',
      lateDays >= 1
        ? `A follow-up was promised ${spoken(lateDays * 24 * 60)} ago and missed`
        : 'A follow-up is past its time',
      -off,
    );
  }

  const score = clamp(reasons.reduce((total, r) => total + r.points, 0), 0, 100);

  /* Biggest mover first, and the base is never the headline on its own. */
  const ranked = [...reasons.slice(1)].sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const said = [...ranked.slice(0, 2).map((r) => r.text), reasons[0]?.text ?? ''].filter(Boolean);

  return {
    score,
    band: bandFor(score),
    isHot: score >= HOT_SCORE_THRESHOLD,
    base,
    reasons: [reasons[0] as HeatReason, ...ranked],
    why: said.join(' · ').slice(0, 255),
  };
}

/**
 * Heat for a lead whose signals are in hand rather than on the row.
 *
 * The one place `scoreLead` is called directly: an importer or a what-if
 * screen that has the answers but has not written them yet. Everything else
 * reads the stored score, which is this same function's output from the job.
 */
export function heatFromSignals(
  signals: ScoreSignals,
  lead: Omit<LeadFacts, 'score' | 'scoreReason' | 'band'>,
  now: Date = new Date(),
): Heat {
  const breakdown = scoreLead(signals);
  return heatScore(
    { ...lead, score: breakdown.score, scoreReason: breakdown.reason, band: breakdown.band },
    now,
  );
}

/* ════════════════════════════════════════════════════════════════════════
   2. PRIORITY — what do I do now
   ════════════════════════════════════════════════════════════════════════ */

/**
 * The order, and it is an order of *questions*, not of scores.
 *
 * A VIP lead with the owner's clock on it beats a promise you made yourself;
 * a promise you made and missed beats one that is still due; both beat a lead
 * nobody has rung; a hot lead beats one going cold. Put a score first and the
 * list quietly stops being about what you owe people.
 */
export const PRIORITY_BUCKETS = [
  'vip_countdown', 'overdue', 'due_today', 'new_not_called', 'hot', 'going_cold',
] as const;
export type PriorityBucket = (typeof PRIORITY_BUCKETS)[number];

export const BUCKET_LABEL: Record<PriorityBucket, string> = {
  vip_countdown: 'VIP, on the clock',
  overdue: 'Overdue',
  due_today: 'Due today',
  new_not_called: 'New, not called',
  hot: 'Hot',
  going_cold: 'Going cold',
};

export interface PriorityRow {
  leadId: string;
  contactId: string;
  name: string | null;
  phone: string | null;
  project: string | null;
  /** The question this lead is the answer to. The list is sorted by it. */
  bucket: PriorityBucket;
  /** The other questions it also answers, so nothing is hidden by the first. */
  alsoIn: PriorityBucket[];
  /** 1-based, across the whole list. */
  rank: number;
  /** Why it is this high, in words. */
  why: string;
  heat: Heat;
  /** What to do, from `leads/next-step.ts`. Never a second opinion. */
  nextStep: NextStepAdvice;
  /** The same as one line — "Call them, today" — or null when nothing is owed. */
  doThis: string | null;
  where: { iso2: string; name: string; flag: string; localTime: string | null } | null;
  asleep: boolean;
  /** Minutes until it is a decent hour there, when it is not. */
  wakesInMinutes: number | null;
  /** Minutes left of their day, when it is. */
  minutesLeftAwake: number | null;
}

export interface WhatNow {
  /** In order, awake, ready to be worked. */
  now: PriorityRow[];
  /** Real work, held back because it is the middle of the night there. */
  asleep: PriorityRow[];
  /**
   * How many leads are in each bucket, counted over every lead read —
   * asleep ones, do-not-contact ones and all. These are the page's numbers:
   * `rules.integration.test.ts` holds them against `leadTabCounts`.
   */
  counts: Record<PriorityBucket, number>;
  /** Nothing disappears quietly, so what was left out is counted too. */
  skipped: { asleep: number; dnc: number; nothingOwed: number };
  /** True when the read hit `TUNING.limits.leads` and the counts are partial. */
  truncated: boolean;
}

/**
 * Every bucket a lead belongs in, in priority order.
 *
 * Each test is one of `leads/tabs.ts`'s own definitions, read here in
 * JavaScript so a row can carry its reasons. They are the same definitions,
 * not similar ones, and the integration test is what keeps them that way.
 */
export function bucketsOf(lead: LeadFacts, now: Date = new Date()): PriorityBucket[] {
  if (lead.status !== 'open') return [];
  const out: PriorityBucket[] = [];

  /* The owner's own hand-over, with a clock still running on it. Past the
     deadline counts too, and counts hardest — it is about to be taken away. */
  if (lead.isVip && lead.vipDeadlineAt !== null && lead.vipFirstCallAt === null) {
    out.push('vip_countdown');
  }

  const urgency = urgencyOf(lead.nextStepAt, now);
  if (urgency === 'overdue') out.push('overdue');
  else if (urgency === 'due_today') out.push('due_today');

  /* The dashboard's "untouched": nobody has ever reached this person. */
  if (lead.lastContactAt === null) out.push('new_not_called');

  /* The Hot tab, which counts the stored band and nothing else. */
  if (lead.band === 'hot') out.push('hot');

  /* The Going cold tab, word for word: no plan, and quiet for a week. */
  if (lead.nextStepAt === null
    && (lead.lastContactAt ?? lead.createdAt).getTime()
      < now.getTime() - TUNING.priority.coldAfterDays * DAY_MS) {
    out.push('going_cold');
  }

  return out.sort((a, b) => PRIORITY_BUCKETS.indexOf(a) - PRIORITY_BUCKETS.indexOf(b));
}

/**
 * The list an agent opens the morning with.
 *
 * Asleep clients are taken out, because a priority list that puts somebody
 * at the top who cannot be rung for nine hours is a list people stop reading.
 * They are not dropped: they come back in `asleep`, with how long until it is
 * a decent hour there, so the screen can say so.
 *
 * People who asked us to stop are left out of both lists and counted in
 * `skipped.dnc`. `suggestNextStep` already refuses to suggest anything for
 * them, and the one thing worse than a quiet omission is a call list that
 * includes somebody who opted out.
 */
export function priorityOrder(leads: LeadFacts[], now: Date = new Date()): WhatNow {
  const counts = Object.fromEntries(
    PRIORITY_BUCKETS.map((bucket) => [bucket, 0]),
  ) as Record<PriorityBucket, number>;

  /*
   * The row and the moment it sorts on, kept together while the list is
   * built. The moment never goes on the wire: it is the bucket's own clock —
   * a deadline, a promise, an arrival — and a screen reads the words instead.
   */
  const awake: Array<{ row: PriorityRow; at: number }> = [];
  const asleep: Array<{ row: PriorityRow; at: number }> = [];
  let dnc = 0;
  let nothingOwed = 0;

  for (const lead of leads) {
    const buckets = bucketsOf(lead, now);
    for (const bucket of buckets) counts[bucket] += 1;

    if (buckets.length === 0) {
      nothingOwed += 1;
      continue;
    }
    if (lead.dnc) {
      dnc += 1;
      continue;
    }

    const bucket = buckets[0] as PriorityBucket;
    const clock = clockFor(lead, now);
    const advice = suggestNextStep(toAdvice(lead), now);
    const row: PriorityRow = {
      leadId: lead.id,
      contactId: lead.contactId,
      name: lead.name,
      phone: lead.phone,
      project: lead.project,
      bucket,
      alsoIn: buckets.slice(1),
      rank: 0,
      why: whyIn(bucket, lead, now),
      heat: heatScore(lead, now),
      nextStep: advice,
      doThis: advice.suggest ? describeSuggestion(advice.suggest) : null,
      where: clock.where,
      asleep: clock.asleep,
      wakesInMinutes: clock.wakesInMinutes,
      minutesLeftAwake: clock.minutesLeftAwake,
    };
    (clock.asleep ? asleep : awake).push({ row, at: sortMoment(bucket, lead) });
  }

  const ordered = (list: Array<{ row: PriorityRow; at: number }>): PriorityRow[] => {
    list.sort(compareRows);
    return list.map((entry, i) => {
      entry.row.rank = i + 1;
      return entry.row;
    });
  };

  const nowRows = ordered(awake);
  const asleepRows = ordered(asleep);

  return {
    now: nowRows,
    asleep: asleepRows,
    counts,
    skipped: { asleep: asleepRows.length, dnc, nothingOwed },
    truncated: leads.length >= TUNING.limits.leads,
  };
}

/** Bucket first, then the clock inside it, then heat as the tie-break. */
function compareRows(
  a: { row: PriorityRow; at: number },
  b: { row: PriorityRow; at: number },
): number {
  const byBucket = PRIORITY_BUCKETS.indexOf(a.row.bucket) - PRIORITY_BUCKETS.indexOf(b.row.bucket);
  if (byBucket !== 0) return byBucket;
  if (a.at !== b.at) return a.at - b.at;
  return b.row.heat.score - a.row.heat.score;
}

/**
 * How a bucket orders itself: the moment it is measured from, soonest first.
 *
 * Four of the six are a date — a deadline, a promise kept or missed, the
 * arrival of a lead nobody has rung — and `hot` has none, so it falls through
 * to heat. `new_not_called` is deliberately oldest-first, where the New tab is
 * newest-first: the tab is a list to read, this is a list to work through, and
 * the lead nobody has rung for three hours is the one about to be lost.
 */
function sortMoment(bucket: PriorityBucket, lead: LeadFacts): number {
  switch (bucket) {
    case 'vip_countdown':
      return lead.vipDeadlineAt?.getTime() ?? 0;
    case 'overdue':
    case 'due_today':
      return lead.nextStepAt?.getTime() ?? 0;
    case 'new_not_called':
      return lead.createdAt.getTime();
    case 'going_cold':
      return (lead.lastContactAt ?? lead.createdAt).getTime();
    case 'hot':
    default:
      return 0;
  }
}

function whyIn(bucket: PriorityBucket, lead: LeadFacts, now: Date): string {
  switch (bucket) {
    case 'vip_countdown': {
      const deadline = lead.vipDeadlineAt as Date;
      const minutes = Math.round((deadline.getTime() - now.getTime()) / 60_000);
      return minutes >= 0
        ? `VIP lead · ${spoken(minutes)} left to call`
        : `VIP lead · ${spoken(-minutes)} past the time`;
    }
    case 'overdue': {
      const late = Math.round((now.getTime() - (lead.nextStepAt as Date).getTime()) / 60_000);
      return `Overdue by ${spoken(late)}`;
    }
    case 'due_today':
      return `Due today at ${hhmm(dubaiMinuteOfDay(lead.nextStepAt as Date))}`;
    case 'new_not_called':
      return `Nobody has called yet · ${spoken(Math.round(hoursBetween(lead.createdAt, now) * 60))} old`;
    case 'hot':
      return `Hot · scores ${lead.score}`;
    case 'going_cold':
    default: {
      const days = Math.floor(daysBetween(lead.lastContactAt ?? lead.createdAt, now));
      return `Nothing planned and quiet for ${days} days`;
    }
  }
}

/** `LeadFacts` as `suggestNextStep` wants it. No new opinions, just a shape. */
function toAdvice(lead: LeadFacts): LeadForAdvice {
  return {
    stage: lead.stage,
    subStatus: lead.subStatus,
    status: lead.status,
    lastContactAt: lead.lastContactAt,
    lastInboundAt: lead.lastInboundAt,
    noAnswerCount: lead.noAnswerCount,
    nextStepAt: lead.nextStepAt,
    nextStepType: lead.nextStepType,
    dnc: lead.dnc,
    createdAt: lead.createdAt,
  };
}

/* ════════════════════════════════════════════════════════════════════════
   3. GOLDEN HOUR — who is awake, and for how long
   ════════════════════════════════════════════════════════════════════════ */

export interface AwakeCountry {
  iso2: string;
  name: string;
  flag: string;
  /** Their clock, 24-hour, like every other time in the CRM. */
  localTime: string | null;
  /** How many of your open leads are there. */
  leads: number;
  /** Minutes left of their calling day. */
  minutesLeft: number;
  /** "2 hours 40 min left", for the chip. */
  left: string;
}

export interface SleepingCountry {
  iso2: string;
  name: string;
  flag: string;
  localTime: string | null;
  leads: number;
  /** Minutes until it is a decent hour there. */
  wakesInMinutes: number;
  wakesIn: string;
}

export interface GoldenHour {
  /** Dubai's own clock, because that is the office. */
  now: string;
  /** Awake, the one closing soonest first — ring those before they go. */
  countries: AwakeCountry[];
  /** Asleep, the one waking soonest first. */
  asleep: SleepingCountry[];
  /** Open leads that can be rung right now. */
  leadsAwake: number;
  /** And the ones whose country we cannot tell from the number. */
  unknown: number;
}

/**
 * Which of your clients are awake, and for how long.
 *
 * The country, the clock and the word "asleep" all come from
 * `leads/countries.ts` — the same table the browser draws a flag from and the
 * same `CALL_FROM`/`CALL_UNTIL` the dialler obeys, so a chip reading "asleep"
 * and a list that hides them cannot disagree.
 *
 * A number we cannot place is counted as unknown and left callable. A guessed
 * country would be a guessed clock, and the honest answer to "where is this
 * +99 number" is that we do not know.
 */
export function goldenHour(leads: LeadFacts[], now: Date = new Date()): GoldenHour {
  const awake = new Map<string, AwakeCountry>();
  const sleeping = new Map<string, SleepingCountry>();
  let unknown = 0;

  for (const lead of leads) {
    if (lead.status !== 'open') continue;
    const country = countryOf(lead.phone);
    const night = country ? isNight(country.timeZone, now) : null;
    if (!country || night === null) {
      unknown += 1;
      continue;
    }

    const localTime = timeIn(country.timeZone, now);
    const name = country.zoneLabel ? `${country.name} (${country.zoneLabel})` : country.name;

    if (night) {
      const row = sleeping.get(country.iso2);
      if (row) { row.leads += 1; continue; }
      const minutes = wakesIn(country.timeZone, now);
      sleeping.set(country.iso2, {
        iso2: country.iso2,
        name,
        flag: flagOf(country.iso2),
        localTime,
        leads: 1,
        wakesInMinutes: minutes,
        wakesIn: spoken(minutes),
      });
      continue;
    }

    const row = awake.get(country.iso2);
    if (row) { row.leads += 1; continue; }
    const minutes = minutesLeftOfDay(country.timeZone, now);
    awake.set(country.iso2, {
      iso2: country.iso2,
      name,
      flag: flagOf(country.iso2),
      localTime,
      leads: 1,
      minutesLeft: minutes,
      left: spoken(minutes),
    });
  }

  return {
    now: hhmm(dubaiMinuteOfDay(now)),
    countries: [...awake.values()].sort((a, b) => a.minutesLeft - b.minutesLeft),
    asleep: [...sleeping.values()].sort((a, b) => a.wakesInMinutes - b.wakesInMinutes),
    leadsAwake: [...awake.values()].reduce((total, c) => total + c.leads, 0),
    unknown,
  };
}

/** Minutes until `CALL_UNTIL` in that zone. Only meaningful while awake. */
export function minutesLeftOfDay(timeZone: string | null, now: Date = new Date()): number {
  const minute = minuteInZone(timeZone, now);
  if (minute === null) return 0;
  return Math.max(0, TUNING.golden.untilHour * 60 - minute);
}

/** Minutes until `CALL_FROM` in that zone. Only meaningful while asleep. */
export function wakesIn(timeZone: string | null, now: Date = new Date()): number {
  const minute = minuteInZone(timeZone, now);
  if (minute === null) return 0;
  const open = TUNING.golden.fromHour * 60;
  if (minute < open) return open - minute;
  return 24 * 60 - minute + open;
}

/** Minutes past midnight in that zone, read off `timeIn` so there is one table. */
function minuteInZone(timeZone: string | null, now: Date): number | null {
  const clock = timeIn(timeZone, now);
  if (!clock) return null;
  const [h, m] = clock.split(':');
  const minutes = Number(h) * 60 + Number(m);
  return Number.isFinite(minutes) ? minutes : null;
}

/** Where one lead is, and whether it is the wrong hour to ring them. */
function clockFor(lead: LeadFacts, now: Date): {
  where: PriorityRow['where'];
  asleep: boolean;
  wakesInMinutes: number | null;
  minutesLeftAwake: number | null;
} {
  const country = countryOf(lead.phone);
  if (!country) {
    return { where: null, asleep: false, wakesInMinutes: null, minutesLeftAwake: null };
  }
  const where = {
    iso2: country.iso2,
    name: country.zoneLabel ? `${country.name} (${country.zoneLabel})` : country.name,
    flag: flagOf(country.iso2),
    localTime: timeIn(country.timeZone, now),
  };
  const night = isNight(country.timeZone, now);
  if (night === null) return { where, asleep: false, wakesInMinutes: null, minutesLeftAwake: null };
  return night
    ? { where, asleep: true, wakesInMinutes: wakesIn(country.timeZone, now), minutesLeftAwake: null }
    : {
      where,
      asleep: false,
      wakesInMinutes: null,
      minutesLeftAwake: minutesLeftOfDay(country.timeZone, now),
    };
}

/* ════════════════════════════════════════════════════════════════════════
   4. RISKS
   ════════════════════════════════════════════════════════════════════════ */

export const RISK_KEYS = [
  'back_to_incoming', 'no_next_step', 'not_touched', 'agent_idle', 'agent_overloaded',
] as const;
export type RiskKey = (typeof RISK_KEYS)[number];

export interface Risk {
  key: RiskKey;
  /** The whole sentence, counts and names already in it. */
  text: string;
  /** The line under it, which says since when or against what. */
  sub: string | null;
  severity: 'high' | 'medium' | 'low';
  leadId: string | null;
  userId: string | null;
  /** Where the screen should send somebody who taps it. */
  to: string;
}

/**
 * What is about to go wrong on one lead.
 *
 * Three rules, and the first of them is the only one in the CRM that takes
 * something away from an agent, so it warns before it bites. The clocks are
 * the owner's own saved settings from Automations, read rather than copied:
 * change the take-back to an hour there and this warns against an hour.
 */
export function leadRisks(
  lead: LeadFacts,
  takeBack: TakeBack,
  now: Date = new Date(),
): Risk[] {
  if (lead.status !== 'open') return [];
  const out: Risk[] = [];
  const to = `/v2/leads/${lead.id}`;

  if (takeBack.enabled) {
    /* A VIP lead goes back when the owner's clock runs out. */
    if (lead.vipDeadlineAt !== null && lead.vipFirstCallAt === null) {
      const minutes = Math.round((lead.vipDeadlineAt.getTime() - now.getTime()) / 60_000);
      if (minutes <= TUNING.risk.vipWarnMinutes) {
        out.push({
          key: 'back_to_incoming',
          text: minutes >= 0
            ? `${named(lead)} goes back to Incoming in ${spoken(minutes)}`
            : `${named(lead)} is ${spoken(-minutes)} past the time and going back`,
          sub: 'A VIP lead the owner gave over. Call, or hand it back yourself.',
          severity: 'high',
          leadId: lead.id,
          userId: lead.ownerUserId,
          to,
        });
      }
    /* An imported lead gets the longer clock from the same settings. */
    } else if (lead.importId !== null && lead.assignedAt !== null && lead.lastContactAt === null) {
      const deadline = lead.assignedAt.getTime() + takeBack.importHours * HOUR_MS;
      const minutes = Math.round((deadline - now.getTime()) / 60_000);
      if (minutes <= TUNING.risk.importWarnMinutes) {
        out.push({
          key: 'back_to_incoming',
          text: minutes >= 0
            ? `${named(lead)} goes back to Incoming in ${spoken(minutes)}`
            : `${named(lead)} is ${spoken(-minutes)} past the time and going back`,
          sub: `An imported lead, ${takeBack.importHours} hours to first contact.`,
          severity: minutes >= 0 ? 'medium' : 'high',
          leadId: lead.id,
          userId: lead.ownerUserId,
          to,
        });
      }
    }
  }

  /*
   * Nobody has ever reached this person. The dashboard's "untouched", plus an
   * age, because a lead that arrived ninety seconds ago is not yet a failure.
   *
   * It stands in for "no next step" when both are true: a lead nobody has
   * rung and nobody has planned is one problem, not two, and listing it twice
   * is how the old Overdue and No-next-step tabs came to double-count.
   */
  const untouchedLongEnough = lead.lastContactAt === null
    && hoursBetween(lead.createdAt, now) >= TUNING.risk.notTouchedHours;

  if (untouchedLongEnough) {
    out.push({
      key: 'not_touched',
      text: `${named(lead)} has had no call and no message`,
      sub: `Arrived ${spoken(Math.round(hoursBetween(lead.createdAt, now) * 60))} ago`,
      severity: 'high',
      leadId: lead.id,
      userId: lead.ownerUserId,
      to,
    });
  } else if (lead.nextStepAt === null) {
    /* The tab that exists to be emptied: `leads/tabs.ts`, `no_next_step`. */
    out.push({
      key: 'no_next_step',
      text: `${named(lead)} has nothing planned`,
      sub: lead.lastContactAt
        ? `Last spoken to ${spoken(Math.round(hoursBetween(lead.lastContactAt, now) * 60))} ago`
        : 'Nobody is coming back to this one',
      severity: 'medium',
      leadId: lead.id,
      userId: lead.ownerUserId,
      to,
    });
  }

  return out;
}

/**
 * What is about to go wrong with one agent.
 *
 * Idle is measured against clicks, not against feelings: a call tap or a
 * WhatsApp tap, the same two things Team live and the messaging report count.
 * It only fires while the office is open and only for somebody who marked
 * themselves in, because an agent who has not started their day is not idle,
 * they are not here — and that is a different row on a different screen.
 */
export function agentRisks(
  agent: AgentFacts,
  team: AgentFacts[],
  hours: { startMinute: number; endMinute: number },
  now: Date = new Date(),
): Risk[] {
  const out: Risk[] = [];
  const to = `/v2/team/${agent.userId}`;
  const minuteNow = dubaiMinuteOfDay(now);
  const open = minuteNow >= hours.startMinute && minuteNow < hours.endMinute;

  if (agent.markedIn && !agent.onLeave && open) {
    const since = agent.lastClickAt === null
      ? minuteNow - hours.startMinute
      : Math.floor((now.getTime() - agent.lastClickAt.getTime()) / 60_000);
    if (since >= TUNING.risk.idleMinutes) {
      out.push({
        key: 'agent_idle',
        text: agent.lastClickAt === null
          ? `${agent.name} has made no call and no message today`
          : `${agent.name} has made no call and no message for ${spoken(since)}`,
        sub: agent.openLeads > 0
          ? `${agent.openLeads} open leads${agent.overdue > 0 ? `, ${agent.overdue} overdue` : ''}`
          : 'No open leads',
        severity: 'medium',
        leadId: null,
        userId: agent.userId,
        to,
      });
    }
  }

  /*
   * Overloaded, two ways, and the desk's own maximum wins where there is one
   * because somebody agreed to it. Failing that, the assignment screen's
   * rule: well above the team's average, with a floor so a quiet day cannot
   * make three leads look like a crisis.
   */
  if (agent.deskMax !== null && agent.openLeads > agent.deskMax) {
    out.push({
      key: 'agent_overloaded',
      text: `${agent.name} has ${agent.openLeads} leads · maximum is ${agent.deskMax}`,
      sub: agent.deskName ?? 'Their desk',
      severity: 'medium',
      leadId: null,
      userId: agent.userId,
      to,
    });
  } else if (agent.deskMax === null && agent.openLeads >= TUNING.risk.overloadFloor) {
    const counted = team.length > 0 ? team : [agent];
    const average = counted.reduce((total, one) => total + one.openLeads, 0) / counted.length;
    if (average > 0 && agent.openLeads > average * TUNING.risk.overloadFactor) {
      out.push({
        key: 'agent_overloaded',
        text: `${agent.name} has ${agent.openLeads} leads · the team averages ${Math.round(average)}`,
        sub: 'No desk maximum is set, so this is against the team',
        severity: 'low',
        leadId: null,
        userId: agent.userId,
        to,
      });
    }
  }

  return out;
}

/* ════════════════════════════════════════════════════════════════════════
   THE DATABASE HALF — fenced, every time
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Open leads the viewer is allowed to see, as facts.
 *
 * The fence is `ownerPredicate` over `visibleUserIds`, the same one My Leads,
 * the inbox and the offers library use, and the "still live" test is
 * `TABS.all.where` itself rather than a fourth spelling of it.
 *
 * Every date is returned as a `Date` by mysql2 and every date bound into the
 * statement is `NOW(3)` rather than a string from a caller: production is
 * MariaDB and it rejects an ISO string that MySQL quietly truncates, which has
 * taken this site down twice.
 */
export async function loadLeadFacts(
  viewer: Viewer,
  opts: { leadIds?: string[]; limit?: number } = {},
  exec: Executor = getPool(),
): Promise<LeadFacts[]> {
  const fence = ownerPredicate('o.owner_user_id', await visibleUserIds(viewer, exec));
  const where = [fence.sql, TABS.all.where];
  const params: SqlParam[] = [...fence.params];

  if (opts.leadIds) {
    if (opts.leadIds.length === 0) return [];
    where.push(`o.id IN (${opts.leadIds.map(() => '?').join(',')})`);
    params.push(...opts.leadIds);
  }

  const limit = Math.max(1, Math.min(opts.limit ?? TUNING.limits.leads, 5000));

  const rows = await query<Record<string, unknown>>(
    `SELECT o.id, o.contact_id AS contactId, c.full_name AS name, c.phone_e164 AS phone,
            o.project_name AS project, o.stage_key AS stage, o.sub_status AS subStatus,
            o.status, o.owner_user_id AS ownerUserId, o.lead_score AS score,
            o.score_band AS band, o.score_reason AS scoreReason, o.is_vip AS isVip,
            o.created_at AS createdAt, o.assigned_at AS assignedAt,
            o.last_contact_at AS lastContactAt, c.last_inbound_at AS lastInboundAt,
            o.next_step_at AS nextStepAt, o.next_step_type AS nextStepType,
            o.no_answer_count AS noAnswerCount, c.dnc AS dnc, o.import_id AS importId,
            (SELECT v.deadline_at FROM vip_handoffs v
              WHERE v.opportunity_id = o.id AND v.refused_at IS NULL AND v.returned_at IS NULL
              ORDER BY v.created_at DESC LIMIT 1) AS vipDeadlineAt,
            (SELECT v.first_call_at FROM vip_handoffs v
              WHERE v.opportunity_id = o.id AND v.refused_at IS NULL AND v.returned_at IS NULL
              ORDER BY v.created_at DESC LIMIT 1) AS vipFirstCallAt,
            (SELECT MAX(lo.opened_at) FROM link_opens lo
              JOIN tracking_links tl ON tl.id = lo.link_id
              WHERE tl.opportunity_id = o.id) AS lastLinkOpenAt,
            (SELECT MIN(m.starts_at) FROM meetings m
              WHERE m.opportunity_id = o.id AND m.deleted_at IS NULL
                AND m.starts_at >= NOW(3)) AS nextMeetingAt
       FROM opportunities o
       JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL
      WHERE ${where.join(' AND ')}
      ORDER BY o.is_vip DESC, o.next_step_at IS NULL ASC, o.next_step_at ASC,
               o.lead_score DESC, o.created_at DESC
      LIMIT ${limit}`,
    params,
    exec,
  );

  return rows.map(asFacts);
}

function asFacts(r: Record<string, unknown>): LeadFacts {
  return {
    id: String(r.id),
    contactId: String(r.contactId),
    name: (r.name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    project: (r.project as string | null) ?? null,
    stage: String(r.stage) as StageKey,
    subStatus: (r.subStatus as string | null) ?? null,
    status: String(r.status) as LeadFacts['status'],
    ownerUserId: (r.ownerUserId as string | null) ?? null,
    score: Number(r.score ?? 0),
    band: (r.band as ScoreBand | null) ?? null,
    scoreReason: (r.scoreReason as string | null) ?? null,
    isVip: Number(r.isVip ?? 0) === 1,
    createdAt: date(r.createdAt) as Date,
    assignedAt: date(r.assignedAt),
    lastContactAt: date(r.lastContactAt),
    lastInboundAt: date(r.lastInboundAt),
    nextStepAt: date(r.nextStepAt),
    nextStepType: (r.nextStepType as NextStepType | null) ?? null,
    noAnswerCount: Number(r.noAnswerCount ?? 0),
    dnc: Number(r.dnc ?? 0) === 1,
    importId: (r.importId as string | null) ?? null,
    vipDeadlineAt: date(r.vipDeadlineAt),
    vipFirstCallAt: date(r.vipFirstCallAt),
    lastLinkOpenAt: date(r.lastLinkOpenAt),
    nextMeetingAt: date(r.nextMeetingAt),
  };
}

/** Whatever the driver handed back, as a `Date` or nothing. Never a string. */
function date(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const at = new Date(value as string);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The priority list for whoever is asking, fenced to what they may see. */
export async function whatNow(
  viewer: Viewer,
  opts: { limit?: number; now?: Date } = {},
  exec: Executor = getPool(),
): Promise<WhatNow> {
  const limit = opts.limit ?? TUNING.limits.leads;
  const leads = await loadLeadFacts(viewer, { limit }, exec);
  /* `priorityOrder` only sees the rows, so the cap it was read under is
     settled here, where the number actually used is known. */
  return { ...priorityOrder(leads, opts.now ?? new Date()), truncated: leads.length >= limit };
}

/** Who is awake right now, among the leads this person may see. */
export async function goldenHourNow(
  viewer: Viewer,
  opts: { limit?: number; now?: Date } = {},
  exec: Executor = getPool(),
): Promise<GoldenHour> {
  const leads = await loadLeadFacts(
    viewer, { limit: opts.limit ?? TUNING.limits.leads }, exec,
  );
  return goldenHour(leads, opts.now ?? new Date());
}

/** Heat for one lead, or null when it is not theirs to see. */
export async function heatFor(
  viewer: Viewer,
  leadId: string,
  opts: { now?: Date } = {},
  exec: Executor = getPool(),
): Promise<Heat | null> {
  const [lead] = await loadLeadFacts(viewer, { leadIds: [leadId] }, exec);
  return lead ? heatScore(lead, opts.now ?? new Date()) : null;
}

/**
 * Every agent the viewer may be told about, with today's attendance and
 * today's clicks.
 *
 * Fenced the same way as the leads, so an agent asking about idleness is told
 * about their own and nobody else's — and "agent" here is
 * `users/counting.ts`'s own rule, so the owner is not measured as one of his
 * own floor.
 */
export async function loadAgentFacts(
  viewer: Viewer,
  exec: Executor = getPool(),
): Promise<AgentFacts[]> {
  const fence = ownerPredicate('u.id', await visibleUserIds(viewer, exec));

  const rows = await query<Record<string, unknown>>(
    `SELECT u.id, u.name,
            (SELECT COUNT(*) FROM opportunities o
              WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL)
              AS openLeads,
            (SELECT COUNT(*) FROM opportunities o
              WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL
                AND o.next_step_at IS NOT NULL AND o.next_step_at < NOW(3)) AS overdue,
            (SELECT d.name FROM desk_members dm JOIN desks d ON d.id = dm.desk_id
              WHERE dm.user_id = u.id AND d.is_active = 1 AND d.max_open_leads IS NOT NULL
              ORDER BY d.max_open_leads ASC LIMIT 1) AS deskName,
            (SELECT d.max_open_leads FROM desk_members dm JOIN desks d ON d.id = dm.desk_id
              WHERE dm.user_id = u.id AND d.is_active = 1 AND d.max_open_leads IS NOT NULL
              ORDER BY d.max_open_leads ASC LIMIT 1) AS deskMax,
            (SELECT COUNT(*) FROM attendance a
              WHERE a.user_id = u.id AND a.on_date = ${TODAY}) AS markedIn,
            (SELECT COUNT(*) FROM leave_requests lr
              WHERE lr.user_id = u.id AND lr.status = 'approved'
                AND lr.from_date <= ${TODAY} AND lr.to_date >= ${TODAY}) AS onLeave,
            (SELECT MAX(cl.started_at) FROM call_logs cl
              WHERE cl.user_id = u.id AND cl.started_at >= ${DAY_START}) AS lastCallAt,
            (SELECT MAX(mt.tapped_at) FROM message_taps mt
              WHERE mt.user_id = u.id AND mt.tapped_at >= ${DAY_START}) AS lastTapAt
       FROM users u
      WHERE u.is_active = 1 AND ${countedAgentSql()} AND ${fence.sql}
      ORDER BY u.name ASC`,
    fence.params,
    exec,
  );

  return rows.map((r) => {
    /*
     * The last click of either kind, taken in JavaScript rather than with
     * GREATEST: a correlated MAX() over two tables cannot be combined in one
     * expression without a derived table, and a derived table cannot see
     * `u.id`. Two scalar subqueries and a comparison here work on both MySQL
     * and MariaDB, which is the only test that matters.
     */
    const call = date(r.lastCallAt);
    const tap = date(r.lastTapAt);
    const lastClickAt = call && tap ? (call > tap ? call : tap) : (call ?? tap);

    return {
      userId: String(r.id),
      name: String(r.name),
      openLeads: Number(r.openLeads ?? 0),
      overdue: Number(r.overdue ?? 0),
      deskName: (r.deskName as string | null) ?? null,
      deskMax: r.deskMax === null || r.deskMax === undefined ? null : Number(r.deskMax),
      markedIn: Number(r.markedIn ?? 0) > 0,
      onLeave: Number(r.onLeave ?? 0) > 0,
      lastClickAt,
    };
  });
}

export interface RisksNow {
  leads: Risk[];
  agents: Risk[];
  /** True when the lead read hit its cap, so the lead risks are partial. */
  truncated: boolean;
}

/**
 * Everything at risk, for whoever is asking.
 *
 * Worst first, and the lead risks are capped the same way the priority list
 * is — a screen that lists nine hundred rows has told nobody anything.
 */
export async function risksNow(
  viewer: Viewer,
  opts: { limit?: number; now?: Date } = {},
  exec: Executor = getPool(),
): Promise<RisksNow> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? TUNING.limits.leads;
  const [leads, agents, rules, shift] = await Promise.all([
    loadLeadFacts(viewer, { limit }, exec),
    loadAgentFacts(viewer, exec),
    officeRules(exec),
    attendanceSettings(exec),
  ]);

  const hours = {
    startMinute: parseClock(shift.start, 10 * 60),
    endMinute: parseClock(shift.end, 19 * 60),
  };

  const leadRows = leads.flatMap((lead) => leadRisks(lead, rules.takeBack, now)).sort(bySeverity);
  const agentRows = agents.flatMap((agent) => agentRisks(agent, agents, hours, now)).sort(bySeverity);

  return { leads: leadRows, agents: agentRows, truncated: leads.length >= limit };
}

const SEVERITY_ORDER: Record<Risk['severity'], number> = { high: 0, medium: 1, low: 2 };
const bySeverity = (a: Risk, b: Risk) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];

/* ════════════════════════════════════════════════════════════════════════
   WORDS AND ARITHMETIC
   ════════════════════════════════════════════════════════════════════════ */

/** The lead's name, or something true when there is not one. */
function named(lead: LeadFacts): string {
  return lead.name?.trim() || lead.phone?.trim() || 'A lead';
}

/** "42 min", "3 hours", "2 days" — a length of time somebody would say. */
export function spoken(minutes: number): string {
  const n = Math.max(0, Math.round(minutes));
  if (n < 60) return `${n} min`;
  if (n < 60 * 24) {
    const hours = Math.round(n / 60);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(n / (60 * 24));
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** Minutes past a Dubai midnight as "14:05". */
function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}
