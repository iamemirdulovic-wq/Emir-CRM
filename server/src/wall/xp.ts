/**
 * Points.
 *
 * The question that decides whether this is worth having: what does somebody
 * do if they want to win without doing the work? Every rule below is shaped
 * by an answer to that.
 *
 *   * Points are for outcomes, not activity. Logging a call earns nothing —
 *     a person who is paid by activity will log calls that did not happen.
 *     Reaching somebody earns something, because the client is a witness.
 *   * Everything is awarded once per thing. The uniqueness is in the database,
 *     not in a check here, so a retried job or a double-click cannot pay twice.
 *   * Every rule that could be repeated has a daily cap. Without one, the
 *     winner is whoever has the most leads, which is a fact about the router
 *     rather than about them.
 *   * Nothing is awarded for posting on the wall. The moment points come from
 *     posting, the wall fills with posts.
 */

export interface XpRule {
  key: string;
  points: number;
  /** What it is for, in words a person would use. */
  label: string;
  /** How many times a day it can be earned. Null means no limit is needed. */
  dailyCap: number | null;
}

export const XP_RULES: Record<string, XpRule> = {
  lead_reached: {
    key: 'lead_reached',
    points: 2,
    label: 'Actually spoke to a lead',
    /* Twenty real conversations is a very full day. Beyond that the number
       says something about the lead router, not about the person. */
    dailyCap: 20,
  },
  reply_under_5_min: {
    key: 'reply_under_5_min',
    points: 3,
    label: 'Answered a new lead inside five minutes',
    dailyCap: 20,
  },
  meeting_booked: {
    key: 'meeting_booked',
    points: 10,
    label: 'Booked a viewing',
    dailyCap: 8,
  },
  meeting_happened: {
    key: 'meeting_happened',
    points: 15,
    label: 'The client turned up',
    dailyCap: 8,
  },
  offer_sent: {
    key: 'offer_sent',
    points: 8,
    label: 'Sent a sales offer',
    dailyCap: 10,
  },
  deal_won: {
    key: 'deal_won',
    points: 100,
    label: 'Closed a deal',
    dailyCap: null,
  },
  /* Housekeeping, worth a little because it is what keeps the pipeline
     honest, and capped low so nobody farms it. */
  tidy_day: {
    key: 'tidy_day',
    points: 5,
    label: 'Ended the day with a next step on every lead',
    dailyCap: 1,
  },
  kudos_received: {
    key: 'kudos_received',
    points: 5,
    label: 'A colleague said thank you',
    /* Five a week each, so a ring of colleagues trading thanks is capped by
       the kudos allowance itself, not here. Three a day is generous. */
    dailyCap: 3,
  },
};

export interface XpAward {
  rule: string;
  points: number;
  userId: string;
  subjectType: string;
  subjectId: string;
}

export interface CapCheck {
  /** How many times this rule has already paid today. */
  todayCount: number;
  /** Whether this exact thing has already paid. */
  alreadyAwarded: boolean;
}

export type AwardDecision =
  | { award: true; points: number }
  | { award: false; reason: 'unknown_rule' | 'already_awarded' | 'daily_cap' };

/**
 * Whether this award should be paid.
 *
 * Pure, so the rules can be read and argued about without a database. The
 * uniqueness is enforced in the schema as well — this is the explanation,
 * not the lock.
 */
export function decideAward(rule: string, check: CapCheck): AwardDecision {
  const definition = XP_RULES[rule];
  if (!definition) return { award: false, reason: 'unknown_rule' };
  if (check.alreadyAwarded) return { award: false, reason: 'already_awarded' };
  if (definition.dailyCap !== null && check.todayCount >= definition.dailyCap) {
    return { award: false, reason: 'daily_cap' };
  }
  return { award: true, points: definition.points };
}

/* ── Levels ─────────────────────────────────────────────────────────────── */

/**
 * The thresholds.
 *
 * They widen, so the first few arrive quickly and the last takes a season.
 * A ladder with even rungs either ends in a week or never starts.
 */
export const LEVEL_THRESHOLDS = [0, 50, 150, 400, 900, 1800, 3200, 5500] as const;

export const LEVEL_NAMES = [
  'New here',
  'Finding your feet',
  'Getting going',
  'Steady',
  'Strong',
  'Senior',
  'Top of the floor',
  'Legend of the floor',
] as const;

export interface LevelState {
  level: number;
  name: string;
  points: number;
  /** Points at the start of this level and at the start of the next. */
  from: number;
  next: number | null;
  /** 0–1 through the current level. 1 at the top. */
  progress: number;
}

export function levelFromPoints(points: number): LevelState {
  const safe = Math.max(0, Math.floor(points));
  let index = 0;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i += 1) {
    if (safe >= (LEVEL_THRESHOLDS[i] as number)) index = i;
  }

  const from = LEVEL_THRESHOLDS[index] as number;
  const next = index + 1 < LEVEL_THRESHOLDS.length ? (LEVEL_THRESHOLDS[index + 1] as number) : null;

  return {
    level: index + 1,
    name: LEVEL_NAMES[index] as string,
    points: safe,
    from,
    next,
    progress: next === null ? 1 : Math.min(1, (safe - from) / (next - from)),
  };
}

/* ── Streaks ────────────────────────────────────────────────────────────── */

/**
 * Days in a row with something done.
 *
 * Sunday does not break it. The UAE working week is Monday to Friday with
 * Saturday and Sunday off, and a streak that punishes somebody for not
 * working the weekend is a streak that tells people to work the weekend.
 * Saturday counts if they did something; it just is not required.
 */
export function streakFrom(days: string[], today: string): number {
  const worked = new Set(days);
  let streak = 0;
  const cursor = new Date(`${today}T00:00:00Z`);

  /* Today not being done yet is not a broken streak — it is the morning. */
  if (!worked.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);

  for (let guard = 0; guard < 400; guard += 1) {
    const key = cursor.toISOString().slice(0, 10);
    const weekday = cursor.getUTCDay();

    if (worked.has(key)) {
      streak += 1;
    } else if (weekday === 0 || weekday === 6) {
      /* The weekend. Skipped over, not counted and not fatal. */
    } else {
      break;
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}

/* ── Kudos ──────────────────────────────────────────────────────────────── */

/** Five a week each. Enough to be used, few enough to mean something. */
export const KUDOS_PER_WEEK = 5;

/** The Monday of a date's week, in Dubai, as `2026-10-26`. */
export function weekOf(date: Date): string {
  const dubai = new Date(date.getTime() + 4 * 60 * 60 * 1000);
  const day = dubai.getUTCDay();
  /* Monday is the start: Sunday (0) belongs to the week that is ending. */
  const back = day === 0 ? 6 : day - 1;
  dubai.setUTCDate(dubai.getUTCDate() - back);
  return dubai.toISOString().slice(0, 10);
}

export type KudosDecision =
  | { allowed: true; left: number }
  | { allowed: false; reason: string };

export function canGiveKudos(input: {
  fromUserId: string;
  toUserId: string;
  givenThisWeek: number;
  alreadyThankedThisWeek: boolean;
}): KudosDecision {
  if (input.fromUserId === input.toUserId) {
    return { allowed: false, reason: 'You cannot thank yourself.' };
  }
  if (input.alreadyThankedThisWeek) {
    /* Otherwise two people can trade five each and both end the week with
       twenty-five points for nothing. */
    return { allowed: false, reason: 'You have already thanked them this week.' };
  }
  if (input.givenThisWeek >= KUDOS_PER_WEEK) {
    return {
      allowed: false,
      reason: `You have used all ${KUDOS_PER_WEEK} of your thank-yous this week. They come back on Monday.`,
    };
  }
  return { allowed: true, left: KUDOS_PER_WEEK - input.givenThisWeek - 1 };
}
