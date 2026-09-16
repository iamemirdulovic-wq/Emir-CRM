import { badRequest, forbidden } from '../lib/errors.js';
import { can, type Role } from '../auth/rbac.js';
import {
  isLostReason,
  isValidSubStatus,
  stagePosition,
  type LostReason,
  type StageKey,
} from './stages.js';

/**
 * The rules for moving a card, kept pure so the API, the workflow engine and
 * the tests all agree on them.
 */

export type MoveRequest = {
  from: StageKey;
  to: StageKey;
  subStatus?: string | null;
  lostReason?: string | null;
  lostNote?: string | null;
};

export type Mover = {
  role: Role;
  /** Whether this user owns the card. Managers and above do not need to. */
  ownsCard: boolean;
};

export type ValidatedMove = {
  to: StageKey;
  subStatus: string | null;
  lostReason: LostReason | null;
  lostNote: string | null;
  status: 'open' | 'won' | 'lost';
  isBackwards: boolean;
};

/**
 * Validate a stage move. Throws an AppError the HTTP layer can return directly.
 */
export function validateMove(request: MoveRequest, mover: Mover): ValidatedMove {
  /*
   * Read the authority from the permission matrix rather than the role name:
   * the `automation` service account also moves cards (Workflow B closes an
   * unresponsive lead, Workflow C advances one to Engaged) and owns nothing.
   */
  const canMoveAny = can(mover.role, 'opportunities:move:any');

  if (!canMoveAny && !mover.ownsCard) {
    throw forbidden('Agents can only move their own leads');
  }

  const isBackwards = stagePosition(request.to) < stagePosition(request.from);
  // Agents move their cards forward. Pulling a card back through the pipeline
  // rewrites history and skews the funnel report, so it needs a manager.
  if (isBackwards && !canMoveAny) {
    throw forbidden('Moving a lead back to an earlier stage requires a manager');
  }

  if (request.subStatus && !isValidSubStatus(request.to, request.subStatus)) {
    throw badRequest(`"${request.subStatus}" is not a valid sub-status for the ${request.to} stage`);
  }

  let lostReason: LostReason | null = null;
  if (request.to === 'lost') {
    // Marking a lead Lost requires a reason.
    if (!isLostReason(request.lostReason)) {
      throw badRequest(
        'A lost reason is required: not_interested, budget_mismatch, bought_elsewhere, unresponsive or invalid',
      );
    }
    lostReason = request.lostReason;
  } else if (request.lostReason) {
    throw badRequest('A lost reason only applies when moving a lead to Lost');
  }

  return {
    to: request.to,
    subStatus: request.subStatus ?? null,
    lostReason,
    lostNote: request.lostNote ?? null,
    status: request.to === 'won' ? 'won' : request.to === 'lost' ? 'lost' : 'open',
    isBackwards,
  };
}

/**
 * Lead-quality events reported back to the ad platforms. Meta calls this the
 * Conversions API for CRM; Google calls it an offline conversion upload.
 */
export const STAGE_QUALITY_EVENTS: Partial<Record<StageKey, string>> = {
  new_lead: 'valid_lead',
  attempted_contact: 'contacted',
  engaged_qualified: 'qualified',
  appointment_scheduled: 'appointment',
  deal_sent: 'qualified',
  won: 'reservation',
};

/** Sub-statuses that carry their own, stronger signal than the stage does. */
const SUB_STATUS_QUALITY_EVENTS: Record<string, string> = {
  showed: 'show',
  reserved: 'reservation',
  spa_signed: 'reservation',
  commission_received: 'reservation',
};

export function qualityEventFor(stage: StageKey, subStatus: string | null): string | null {
  if (subStatus && SUB_STATUS_QUALITY_EVENTS[subStatus]) return SUB_STATUS_QUALITY_EVENTS[subStatus] as string;
  // A lead marked invalid is not a valid lead, whatever stage it sits in.
  if (stage === 'new_lead' && subStatus === 'invalid') return null;
  if (stage === 'lost') return null;
  return STAGE_QUALITY_EVENTS[stage] ?? null;
}
