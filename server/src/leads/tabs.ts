/**
 * The tabs on My Leads.
 *
 * Each one is a question an agent actually asks, not a filter they have to
 * assemble: what do I owe today, who is new, who is hot, who have I let go
 * cold, and — the one that exists to be emptied — who has nobody coming back
 * to them at all.
 *
 * The SQL lives here rather than in the route so the definitions can be read
 * in one place and tested without a database. Getting "overdue" subtly wrong
 * is silent: leads simply stop appearing in a tab, and nobody notices until a
 * client goes elsewhere.
 *
 * Every boundary is Dubai time. A lead promised "today" is promised by
 * midnight in Dubai, not by midnight wherever the server happens to be.
 */

export const LEAD_TABS = ['today', 'new', 'hot', 'overdue', 'no_next_step', 'all'] as const;
export type LeadTab = (typeof LEAD_TABS)[number];

/** Dubai is UTC+4 all year — no daylight saving to reason about. */
const DUBAI = "'+04:00'";

/** A lead is stale after this long with nobody reaching out. */
export const OVERDUE_HOURS = 48;
/** A brand-new lead is not overdue the second it arrives. */
export const GRACE_HOURS = 2;

export interface TabDefinition {
  label: string;
  /** SQL over `opportunities o`, already fenced for deleted and status. */
  where: string;
  /** How the list reads best for this question. */
  orderBy: string;
  /** Shown when the tab is empty, in the agent's own terms. */
  emptyTitle: string;
  emptyHint: string;
}

/**
 * Open means the lead is still live. Won and Lost leads belong in history,
 * not in a list of work — a tab that counts them is a tab that never empties.
 */
const OPEN = "o.status = 'open' AND o.deleted_at IS NULL";

export const TABS: Record<LeadTab, TabDefinition> = {
  today: {
    label: 'Follow-up today',
    /*
     * Everything promised up to the end of today, which deliberately includes
     * what was promised yesterday and missed. A follow-up that silently
     * disappears the day after it was due is how a client is lost politely.
     */
    where: `${OPEN} AND o.next_step_at IS NOT NULL
            AND o.next_step_at < DATE_ADD(
              CONVERT_TZ(DATE(CONVERT_TZ(NOW(3), '+00:00', ${DUBAI})), ${DUBAI}, '+00:00'),
              INTERVAL 1 DAY)`,
    /* Oldest promise first: the one furthest past due is the one going cold. */
    orderBy: 'o.next_step_at ASC',
    emptyTitle: 'No follow-ups today 🎉',
    emptyHint: 'You are all caught up. Worth a look at your hot leads?',
  },

  new: {
    label: 'New',
    where: `${OPEN} AND o.stage_key = 'new_lead'`,
    orderBy: 'o.created_at DESC',
    emptyTitle: 'Nothing new',
    emptyHint: 'Every lead you have been given has been picked up.',
  },

  hot: {
    label: 'Hot',
    where: `${OPEN} AND o.score_band = 'hot'`,
    orderBy: 'o.lead_score DESC, o.created_at DESC',
    emptyTitle: 'No hot leads right now',
    emptyHint: 'A lead turns hot when the budget, the timeline and the replies all line up.',
  },

  overdue: {
    label: 'Overdue',
    /*
     * Two kinds of neglect, and both count. One: contacted, but not for two
     * days. Two: never contacted at all and no longer brand new — the worse
     * of the two, and the one a "last contact" filter alone would miss
     * entirely, because NULL is not older than anything.
     */
    where: `${OPEN} AND (
              o.last_contact_at < DATE_SUB(NOW(3), INTERVAL ${OVERDUE_HOURS} HOUR)
              OR (o.last_contact_at IS NULL AND o.created_at < DATE_SUB(NOW(3), INTERVAL ${GRACE_HOURS} HOUR))
            )`,
    orderBy: 'COALESCE(o.last_contact_at, o.created_at) ASC',
    emptyTitle: 'Nobody has gone cold',
    emptyHint: 'Everyone open has heard from you in the last two days.',
  },

  no_next_step: {
    label: 'No next step',
    /*
     * The tab that exists to be emptied. A lead with nothing promised is not
     * being worked — it is being remembered, which lasts about a week.
     */
    where: `${OPEN} AND o.next_step_at IS NULL`,
    orderBy: 'o.lead_score DESC, o.created_at DESC',
    emptyTitle: 'Everything has a next step',
    emptyHint: 'Every open lead has somebody coming back to it. This is the one to keep at zero.',
  },

  all: {
    label: 'All',
    where: 'o.deleted_at IS NULL',
    orderBy: 'o.created_at DESC',
    emptyTitle: 'No leads yet',
    emptyHint: 'Add one with the + button, or wait for the next enquiry.',
  },
};

export function isLeadTab(value: unknown): value is LeadTab {
  return typeof value === 'string' && (LEAD_TABS as readonly string[]).includes(value);
}

/**
 * How a row should read in the list, given the tab it came from.
 *
 * Pure so the awkward cases — a promise an hour from now, one that was due
 * yesterday, a lead nobody has ever rung — are settled in a test rather than
 * argued about from a screenshot.
 */
export type Urgency = 'overdue' | 'due_today' | 'soon' | 'none';

export function urgencyOf(
  nextStepAt: Date | string | null,
  now: Date = new Date(),
): Urgency {
  if (!nextStepAt) return 'none';
  const due = typeof nextStepAt === 'string' ? new Date(nextStepAt) : nextStepAt;
  if (Number.isNaN(due.getTime())) return 'none';

  if (due.getTime() <= now.getTime()) return 'overdue';
  return sameDubaiDay(due, now) ? 'due_today' : 'soon';
}

/** Both moments as the calendar day they fall on in Dubai. */
export function sameDubaiDay(a: Date, b: Date): boolean {
  const day = (date: Date) => Math.floor((date.getTime() + 4 * 60 * 60 * 1000) / 86_400_000);
  return day(a) === day(b);
}

/**
 * Has this lead gone quiet?
 *
 * Mirrors the `overdue` tab above in JavaScript, for the places that have a
 * row in hand rather than a query to run. The two must agree, which is why
 * the thresholds are shared constants rather than numbers typed twice.
 */
export function isStale(
  lastContactAt: Date | string | null,
  createdAt: Date | string,
  now: Date = new Date(),
): boolean {
  const created = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  if (!lastContactAt) {
    return now.getTime() - created.getTime() > GRACE_HOURS * 60 * 60 * 1000;
  }
  const last = typeof lastContactAt === 'string' ? new Date(lastContactAt) : lastContactAt;
  return now.getTime() - last.getTime() > OVERDUE_HOURS * 60 * 60 * 1000;
}
