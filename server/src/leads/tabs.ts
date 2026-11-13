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

/*
 * `vip` and `lost` are v2's, and they are added rather than swapped in: the
 * live My Leads reads this same list, so removing a tab would empty a screen
 * ten people use today. The v2 screen shows the seven the design asks for;
 * the live one keeps showing its six.
 */
export const LEAD_TABS = [
  'today', 'new', 'hot', 'cold', 'overdue', 'no_next_step', 'vip', 'lost', 'all',
] as const;
export type LeadTab = (typeof LEAD_TABS)[number];

/** Dubai is UTC+4 all year — no daylight saving to reason about. */
const DUBAI = "'+04:00'";

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

  cold: {
    label: 'Going cold',
    /*
     * `design/web/all-leads.html`'s second tab, and the one an owner opens the
     * screen to look at: leads nobody has touched and nobody is coming back
     * to. The wording is the office rule's own — "No call, no message and no
     * plan for 7 days" (`v2/office-rules.ts`, `markGoingCold`) — so the tab
     * and the automation mean the same thing.
     *
     * A lead with a plan is not going cold however long ago it was last
     * spoken to: somebody is coming back to it on a date they chose. And a
     * lead that was never contacted is counted from the day it arrived,
     * because a week in Incoming is a week going cold just the same.
     */
    where: `${OPEN} AND o.next_step_at IS NULL
            AND COALESCE(o.last_contact_at, o.created_at) < DATE_SUB(NOW(3), INTERVAL 7 DAY)`,
    /* Coldest first — the longest anybody has been left waiting. */
    orderBy: 'COALESCE(o.last_contact_at, o.created_at) ASC',
    emptyTitle: 'Nothing is going cold',
    emptyHint: 'Every open lead has been spoken to, or has somebody coming back to it.',
  },

  overdue: {
    label: 'Overdue',
    /*
     * Overdue means one thing across the whole CRM: you promised a time and
     * the time has passed. The dashboard card, the Tasks list and this tab all
     * read it the same way now.
     *
     * It used to mean "gone cold" here — no contact for 48 hours, or never
     * contacted and more than two hours old. That is a fair thing to measure,
     * but under the same name it made the product contradict itself: the
     * dashboard said 2 overdue, this tab said 9, and Tasks said 94. Worse, a
     * lead nobody had promised anything appeared here AND in "No next step",
     * so the same neglect was counted twice and neither number could be
     * trusted.
     *
     * A lead with no promise at all is not overdue, it is unplanned, and "No
     * next step" is the tab built to catch it.
     */
    where: `${OPEN} AND o.next_step_at IS NOT NULL AND o.next_step_at < NOW(3)`,
    orderBy: 'o.next_step_at ASC',
    emptyTitle: 'Every follow-up is on time',
    emptyHint: 'Nothing you promised has slipped past its time.',
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

  vip: {
    label: 'VIP',
    /*
     * A lead the owner handed over personally, with a deadline on it. Open
     * only: a VIP lead that is Won has stopped being a promise to keep.
     */
    where: `${OPEN} AND o.is_vip = 1`,
    orderBy: 'o.created_at DESC',
    emptyTitle: 'No VIP leads',
    emptyHint: 'A VIP lead is one the owner gives you personally, with a time to call by.',
  },

  lost: {
    label: 'Lost',
    /*
     * The one tab that is deliberately not "open". Lost leads are the reason
     * the tab exists -- to be looked back over, and sometimes reopened.
     */
    where: "o.status = 'lost' AND o.deleted_at IS NULL",
    orderBy: 'o.stage_changed_at DESC',
    emptyTitle: 'Nothing lost',
    emptyHint: 'Leads you mark Lost collect here, with the reason you gave.',
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
