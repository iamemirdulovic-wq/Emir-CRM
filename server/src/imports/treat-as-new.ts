/**
 * Whether an import's leads should be treated as leads that just arrived.
 *
 * The default is no, and that default is load-bearing. A file of forty
 * thousand old leads run through Workflow A would send forty thousand
 * WhatsApp templates, wake every agent's phone forty thousand times and bounce
 * most of them five minutes later for not being answered. Imports exist to put
 * a list somewhere, not to start a stampede.
 *
 * But the opposite case is real too, and it is the one agents complain about:
 * twenty names collected on a stand at Cityscape, uploaded that evening, which
 * are new leads in every sense that matters. Those should ring.
 *
 * So the switch exists, it is off unless someone turns it on, and it is capped
 * — because the difference between the two cases is simply how many rows there
 * are, and a number is something the CRM can check.
 */

/**
 * Above this many rows, "treat as new" is refused rather than warned about.
 *
 * Two hundred is roughly a day's genuine new leads for a brokerage this size.
 * A file bigger than that is a database, not a morning — and the cost of being
 * wrong is not a bad screen, it is every agent's phone going off all night and
 * a WhatsApp number at risk.
 */
export const TREAT_AS_NEW_MAX_ROWS = 200;

export interface TreatAsNewDecision {
  /** Whether the timer and the alerts actually run. */
  allowed: boolean;
  /** Shown in the wizard, in plain words. Null when there is nothing to say. */
  reason: string | null;
}

export function decideTreatAsNew(
  requested: boolean,
  totalRows: number,
  limit: number = TREAT_AS_NEW_MAX_ROWS,
): TreatAsNewDecision {
  if (!requested) return { allowed: false, reason: null };

  if (totalRows > limit) {
    return {
      allowed: false,
      reason:
        `This file has ${totalRows.toLocaleString('en-AE')} rows, and the five-minute timer `
        + `is only available up to ${limit.toLocaleString('en-AE')}. `
        + 'A list this size would alert every agent hundreds of times and bounce most of the '
        + 'leads before anyone could answer. Import it without the timer and work it through a '
        + 'list or a call campaign.',
    };
  }

  return {
    allowed: true,
    reason:
      `These ${totalRows.toLocaleString('en-AE')} leads will be treated as if they just came in: `
      + 'the agent gets the new-lead alert and the five-minute timer starts. '
      + 'No WhatsApp or email is sent automatically.',
  };
}
