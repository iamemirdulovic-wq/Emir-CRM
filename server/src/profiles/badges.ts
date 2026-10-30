/**
 * Badges, earned from the numbers rather than awarded by anybody.
 *
 * The rule that makes this worth having: a badge nobody can be given is a
 * badge nobody can be denied. There is no "employee of the month" here,
 * because that is a thing a manager hands out and an agent resents. Every one
 * of these is a fact about what somebody did, checked against the same data
 * the reports use.
 *
 * They are also deliberately reachable. A badge that takes a year is not a
 * badge, it is a retirement gift — the first few land in the first month, so
 * a new agent's shelf is not empty on their second day.
 */

export interface BadgeDefinition {
  key: string;
  name: string;
  /** What it takes, said plainly. Shown on the locked ones too. */
  how: string;
  icon: string;
  earned: (stats: BadgeStats) => boolean;
  /** Progress towards it, 0–1, for the ones that are a count. */
  progress?: (stats: BadgeStats) => number;
}

export interface BadgeStats {
  dealsWon: number;
  appointments: number;
  leadsContacted: number;
  /** Median seconds to first reply. Null when they have not replied to any. */
  speedToLeadSeconds: number | null;
  /** Days in a row with at least one lead contacted. */
  streakDays: number;
  monthsHere: number;
  /** Leads with a next step set, as a fraction of their open leads. */
  tidiness: number;
  notesWritten: number;
}

export const BADGES: BadgeDefinition[] = [
  {
    key: 'first_deal',
    name: 'First deal',
    how: 'Close your first deal',
    icon: 'trophy',
    earned: (s) => s.dealsWon >= 1,
    progress: (s) => Math.min(1, s.dealsWon),
  },
  {
    key: 'ten_deals',
    name: 'Ten deals',
    how: 'Close ten deals',
    icon: 'crown',
    earned: (s) => s.dealsWon >= 10,
    progress: (s) => Math.min(1, s.dealsWon / 10),
  },
  {
    key: 'fast_hands',
    name: 'Fast hands',
    how: 'Answer new leads in under two minutes, typically',
    icon: 'zap',
    earned: (s) => s.speedToLeadSeconds !== null && s.speedToLeadSeconds <= 120,
  },
  {
    key: 'under_thirty',
    name: 'Under thirty',
    how: 'Answer new leads in under thirty seconds, typically',
    icon: 'flame',
    earned: (s) => s.speedToLeadSeconds !== null && s.speedToLeadSeconds <= 30,
  },
  {
    key: 'week_streak',
    name: 'Seven days running',
    how: 'Speak to at least one lead every day for a week',
    icon: 'calendar-check',
    earned: (s) => s.streakDays >= 7,
    progress: (s) => Math.min(1, s.streakDays / 7),
  },
  {
    key: 'month_streak',
    name: 'Thirty days running',
    how: 'Speak to at least one lead every day for a month',
    icon: 'target',
    earned: (s) => s.streakDays >= 30,
    progress: (s) => Math.min(1, s.streakDays / 30),
  },
  {
    key: 'fifty_meetings',
    name: 'Fifty viewings',
    how: 'Book fifty viewings',
    icon: 'map-pin',
    earned: (s) => s.appointments >= 50,
    progress: (s) => Math.min(1, s.appointments / 50),
  },
  {
    key: 'tidy_desk',
    name: 'Tidy desk',
    how: 'Have a next step on every open lead',
    icon: 'check-check',
    earned: (s) => s.tidiness >= 0.99,
    progress: (s) => s.tidiness,
  },
  {
    key: 'note_taker',
    name: 'Note taker',
    how: 'Write a hundred notes',
    icon: 'sticky-note',
    earned: (s) => s.notesWritten >= 100,
    progress: (s) => Math.min(1, s.notesWritten / 100),
  },
  {
    key: 'one_year',
    name: 'One year',
    how: 'Be here a year',
    icon: 'badge-check',
    earned: (s) => s.monthsHere >= 12,
    progress: (s) => Math.min(1, s.monthsHere / 12),
  },
];

export interface Badge {
  key: string;
  name: string;
  how: string;
  icon: string;
  earned: boolean;
  /** 0–1, or null for a badge that is simply true or false. */
  progress: number | null;
}

export function badgesFor(stats: BadgeStats): Badge[] {
  return BADGES.map((badge) => ({
    key: badge.key,
    name: badge.name,
    how: badge.how,
    icon: badge.icon,
    earned: badge.earned(stats),
    progress: badge.progress ? Math.max(0, Math.min(1, badge.progress(stats))) : null,
  }));
}

/**
 * A level, from the badges earned.
 *
 * Five of them, named rather than numbered. "Level 7" means nothing to
 * anybody; "Senior" is a word people already use about each other.
 */
export const LEVELS = ['New', 'Getting going', 'Solid', 'Senior', 'Top of the floor'] as const;
export type Level = (typeof LEVELS)[number];

export function levelFor(badges: Badge[]): { level: Level; index: number; earned: number; of: number } {
  const earned = badges.filter((badge) => badge.earned).length;
  /* Thresholds, not a straight division: the step from nothing to one badge
     should feel like something, and the last step should be hard. */
  const index = earned >= 8 ? 4 : earned >= 6 ? 3 : earned >= 4 ? 2 : earned >= 1 ? 1 : 0;
  return { level: LEVELS[index] as Level, index, earned, of: badges.length };
}
