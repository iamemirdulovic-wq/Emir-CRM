/**
 * The owners' morning summary.
 *
 * Written to be read on a phone before the first meeting, so it is short,
 * it leads with the problem rather than the total, and every line is a thing
 * somebody could do something about today.
 *
 * It deliberately does not congratulate. An email that opens "Great work
 * yesterday!" every morning is an email that gets filtered, and then the one
 * morning something is actually wrong, nobody reads that either.
 */

export interface SummaryNumbers {
  newLeads: number;
  newLeadsPrevious: number;
  contacted: number;
  /** Leads assigned yesterday that nobody touched inside the five minutes. */
  slaBreaches: number;
  appointments: number;
  reservations: number;
  /** Open leads with a follow-up promised for a time that has passed. */
  overdue: number;
  /** Open leads with nothing promised at all. */
  noNextStep: number;
  /** Leads that arrived and were never assigned to anybody. */
  unassigned: number;
  /** Whoever did the most yesterday, for the one line of good news. */
  topAgent: { name: string; contacted: number } | null;
  /** Sign-ins that looked wrong. */
  flaggedSignIns: number;
}

export interface SummaryLine {
  kind: 'problem' | 'number' | 'good';
  text: string;
}

export interface Summary {
  subject: string;
  lines: SummaryLine[];
  /** True when there is nothing wrong and nothing much happened. */
  quiet: boolean;
}

function pct(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Build yesterday's summary.
 *
 * `for` is the Dubai date the numbers describe, used only in the subject.
 */
export function buildOwnerSummary(numbers: SummaryNumbers, forDate: string): Summary {
  const problems: SummaryLine[] = [];
  const facts: SummaryLine[] = [];

  /* Problems first and in the order they cost money. A lead nobody owns is
     worse than a lead nobody rang back, which is worse than a quiet day. */
  if (numbers.unassigned > 0) {
    problems.push({
      kind: 'problem',
      text: `${plural(numbers.unassigned, 'lead', 'leads')} arrived with nobody to work ${numbers.unassigned === 1 ? 'it' : 'them'}.`,
    });
  }

  if (numbers.slaBreaches > 0) {
    problems.push({
      kind: 'problem',
      text: `${plural(numbers.slaBreaches, 'lead was', 'leads were')} not touched inside five minutes.`,
    });
  }

  if (numbers.overdue > 0) {
    problems.push({
      kind: 'problem',
      text: `${plural(numbers.overdue, 'follow-up is', 'follow-ups are')} overdue across the team.`,
    });
  }

  if (numbers.noNextStep > 0) {
    problems.push({
      kind: 'problem',
      text: `${plural(numbers.noNextStep, 'open lead has', 'open leads have')} nothing planned at all.`,
    });
  }

  if (numbers.flaggedSignIns > 0) {
    problems.push({
      kind: 'problem',
      text: `${plural(numbers.flaggedSignIns, 'sign-in', 'sign-ins')} looked unusual. Worth a glance at Team activity.`,
    });
  }

  /* Then the numbers, with the comparison that makes them mean something. */
  const change = numbers.newLeads - numbers.newLeadsPrevious;
  facts.push({
    kind: 'number',
    text: `${plural(numbers.newLeads, 'new lead', 'new leads')}`
      + (numbers.newLeadsPrevious === 0 && numbers.newLeads === 0
        ? '.'
        : `, ${change === 0 ? 'the same as' : change > 0 ? `${change} more than` : `${Math.abs(change)} fewer than`} the day before.`),
  });

  if (numbers.newLeads > 0) {
    facts.push({
      kind: 'number',
      text: `${numbers.contacted} of them were contacted (${pct(numbers.contacted, numbers.newLeads)}%).`,
    });
  }

  if (numbers.appointments > 0 || numbers.reservations > 0) {
    const parts: string[] = [];
    if (numbers.appointments > 0) parts.push(plural(numbers.appointments, 'appointment', 'appointments'));
    if (numbers.reservations > 0) parts.push(plural(numbers.reservations, 'reservation', 'reservations'));
    facts.push({ kind: 'number', text: `${parts.join(' and ')} booked.` });
  }

  const good: SummaryLine[] = [];
  if (numbers.topAgent && numbers.topAgent.contacted > 0) {
    good.push({
      kind: 'good',
      text: `${numbers.topAgent.name} spoke to the most people — ${plural(numbers.topAgent.contacted, 'lead', 'leads')}.`,
    });
  }

  const quiet = problems.length === 0 && numbers.newLeads === 0;

  const subject = problems.length > 0
    ? `Emigeo — ${plural(problems.length, 'thing', 'things')} to look at (${forDate})`
    : numbers.newLeads > 0
      ? `Emigeo — ${plural(numbers.newLeads, 'new lead', 'new leads')} yesterday (${forDate})`
      : `Emigeo — a quiet day (${forDate})`;

  return { subject, lines: [...problems, ...facts, ...good], quiet };
}

/** The summary as plain text, for the email body. */
export function summaryText(summary: Summary, appUrl: string): string {
  const lines = summary.lines.map((line) => `${line.kind === 'problem' ? '!' : '-'} ${line.text}`);
  return [
    ...lines,
    '',
    `Open the CRM: ${appUrl.replace(/\/+$/, '')}/dashboard`,
  ].join('\n');
}
