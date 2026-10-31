import type { StageKey } from '../pipeline/stages.js';
import type { Role } from '../auth/rbac.js';

/**
 * Writing a note means you already tried.
 *
 * Asked for by the team: an agent who has just rung a client and typed what
 * was said should not then have to drag the card to Attempted Contact. The
 * note *is* the evidence of the attempt, and a stage somebody has to remember
 * to update is a stage that is wrong by Thursday — which then makes every
 * report built on it wrong too.
 *
 * It only ever moves a lead **forward out of New Lead**, and the reasons for
 * each limit are worth stating, because this fires without anybody asking:
 *
 *  - **Only from New Lead.** A lead already at Attempted Contact or beyond has
 *    a stage that is already at least as true as "we tried". Moving one back
 *    from Appointment Scheduled because somebody typed "client called to
 *    confirm Saturday" would be destroying information, not recording it.
 *  - **Only while the lead is open.** A note on a Won or Lost lead is history
 *    being written down — a handover detail, why it died — and must not reopen
 *    anything.
 *  - **Never for the automation account.** The system writes notes of its own,
 *    and a stage that moves because a robot filed a summary is a stage nobody
 *    can trust. A human attempt is the whole claim being made.
 *
 * Returning null means "leave the stage alone", which is the common case.
 */
export const STAGE_AFTER_NOTE: StageKey = 'attempted_contact';

/** The honest sub-status for a first attempt we inferred rather than counted. */
export const SUB_STATUS_AFTER_NOTE = 'attempt_1';

export function stageAfterNote(lead: {
  stageKey: StageKey | string;
  status: string;
  authorRole: Role | null;
}): { to: StageKey; subStatus: string } | null {
  if (lead.authorRole === 'automation' || lead.authorRole === null) return null;
  if (lead.status !== 'open') return null;
  if (lead.stageKey !== 'new_lead') return null;
  return { to: STAGE_AFTER_NOTE, subStatus: SUB_STATUS_AFTER_NOTE };
}
