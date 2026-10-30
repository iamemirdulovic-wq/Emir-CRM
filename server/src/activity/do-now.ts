/**
 * "Do this now": the three or four things an agent should actually do next.
 *
 * The dashboard it replaces showed six charts. An agent opening the CRM at
 * 9am does not need a chart — they need to know which of their ninety leads
 * to ring first, and a chart cannot answer that.
 *
 * The ordering below is the opinion. It is not "most recent" or "highest
 * score", it is roughly "what costs the most to leave undone":
 *
 *   1. A lead that is about to be taken away. Minutes left.
 *   2. A promise already broken. Today's follow-up, overdue.
 *   3. A hot lead nobody has rung at all.
 *   4. A client who replied and has been left hanging.
 *   5. Today's follow-ups, not yet due.
 *   6. Leads with nothing promised at all.
 *
 * Each card says what to do, how many, and where to go. Nothing is counted
 * twice: a lead that is both hot and overdue appears in the more urgent one
 * only, because two cards for one lead is how a list stops being trusted.
 */

export type DoNowKey =
  | 'sla_running_out'
  | 'overdue'
  | 'hot_never_called'
  | 'replied_waiting'
  | 'due_today'
  | 'no_next_step';

export interface DoNowCounts {
  /** Assigned minutes ago and still untouched; the clock is running. */
  slaRunningOut: number;
  /** A follow-up that was promised for earlier and has not happened. */
  overdue: number;
  /** Score 70+ and no call has ever been logged. */
  hotNeverCalled: number;
  /** They replied on WhatsApp or email and nobody has answered. */
  repliedWaiting: number;
  /** Promised for later today. */
  dueToday: number;
  /** Open, and nothing promised at all. */
  noNextStep: number;
}

export interface DoNowCard {
  key: DoNowKey;
  /** The instruction, not a label. "Call 3 leads before they bounce." */
  title: string;
  /** One line on why it matters, in plain words. */
  why: string;
  count: number;
  urgency: 'now' | 'today' | 'soon';
  icon: string;
  /** Where the button goes. */
  href: string;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * Turn the counts into the cards to show, most urgent first.
 *
 * Empty counts produce no card at all. A dashboard full of "0 overdue" is a
 * dashboard that teaches people to skim, and the one morning something is
 * wrong they will skim past that too.
 */
export function doNowCards(counts: DoNowCounts): DoNowCard[] {
  const cards: DoNowCard[] = [];

  if (counts.slaRunningOut > 0) {
    cards.push({
      key: 'sla_running_out',
      title: `Call ${counts.slaRunningOut} new ${plural(counts.slaRunningOut, 'lead', 'leads')} now`,
      why: counts.slaRunningOut === 1
        ? 'It goes back to the pool in a few minutes if you do not touch it.'
        : 'They go back to the pool in a few minutes if you do not touch them.',
      count: counts.slaRunningOut,
      urgency: 'now',
      icon: 'alarm-clock',
      href: '/leads?tab=new',
    });
  }

  if (counts.overdue > 0) {
    cards.push({
      key: 'overdue',
      title: `${counts.overdue} ${plural(counts.overdue, 'follow-up is', 'follow-ups are')} overdue`,
      why: 'You said you would come back to them and the time has passed.',
      count: counts.overdue,
      urgency: 'now',
      icon: 'clock-3',
      href: '/leads?tab=overdue',
    });
  }

  if (counts.hotNeverCalled > 0) {
    cards.push({
      key: 'hot_never_called',
      title: `${counts.hotNeverCalled} hot ${plural(counts.hotNeverCalled, 'lead has', 'leads have')} never been called`,
      why: 'These are the most likely to buy and nobody has spoken to them yet.',
      count: counts.hotNeverCalled,
      urgency: 'now',
      icon: 'flame',
      href: '/leads?tab=hot',
    });
  }

  if (counts.repliedWaiting > 0) {
    cards.push({
      key: 'replied_waiting',
      title: `${counts.repliedWaiting} ${plural(counts.repliedWaiting, 'client is', 'clients are')} waiting for an answer`,
      why: 'They wrote to you and the message has not been answered.',
      count: counts.repliedWaiting,
      urgency: 'now',
      icon: 'message-circle',
      href: '/inbox?filter=unread',
    });
  }

  if (counts.dueToday > 0) {
    cards.push({
      key: 'due_today',
      title: `${counts.dueToday} ${plural(counts.dueToday, 'follow-up', 'follow-ups')} due later today`,
      why: 'Promised for today. Do them before the day runs out.',
      count: counts.dueToday,
      urgency: 'today',
      icon: 'calendar-check',
      href: '/leads?tab=today',
    });
  }

  if (counts.noNextStep > 0) {
    cards.push({
      key: 'no_next_step',
      title: `${counts.noNextStep} ${plural(counts.noNextStep, 'lead has', 'leads have')} nothing planned`,
      why: 'Nobody is coming back to these. Decide what happens next, or close them.',
      count: counts.noNextStep,
      urgency: 'soon',
      icon: 'circle-alert',
      href: '/leads?tab=no_next_step',
    });
  }

  return cards;
}

/**
 * What to say when there is nothing to do.
 *
 * Which is a real state and worth saying well: an agent who has cleared their
 * list should be told so, not shown an empty grid.
 */
export function allClearMessage(firstName: string | null): { title: string; hint: string } {
  return {
    title: `Nothing owing, ${firstName ?? 'and well done'}`,
    hint: 'Every lead has a next step and nothing is overdue. Good time to work the pool or follow up a quiet one.',
  };
}

/** The greeting at the top, by Dubai time. */
export function greet(firstName: string | null, at: Date = new Date()): string {
  const hour = new Date(at.getTime() + 4 * 60 * 60 * 1000).getUTCHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return firstName ? `${part}, ${firstName}` : part;
}
