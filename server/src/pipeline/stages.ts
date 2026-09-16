/**
 * The pipeline is fixed by the master prompt:
 * New Lead → Attempted Contact → Engaged/Qualified → Appointment Scheduled →
 * Deal Sent → Won / Lost.
 */

export const STAGE_KEYS = [
  'new_lead',
  'attempted_contact',
  'engaged_qualified',
  'appointment_scheduled',
  'deal_sent',
  'won',
  'lost',
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const SUB_STATUSES = {
  new_lead: ['raw', 'invalid', 'duplicate'],
  attempted_contact: ['attempt_1', 'attempt_2', 'attempt_3', 'attempt_4', 'attempt_5', 'attempt_6', 'no_answer', 'wrong_number'],
  engaged_qualified: ['engaged', 'qualified', 'nurture'],
  appointment_scheduled: ['booked', 'confirmed', 'showed', 'no_show'],
  deal_sent: ['eoi_sent', 'eoi_signed', 'awaiting_payment'],
  won: ['reserved', 'spa_signed', 'commission_received'],
  lost: [],
} as const satisfies Record<StageKey, readonly string[]>;

export type SubStatus = (typeof SUB_STATUSES)[StageKey][number];

export const LOST_REASONS = [
  'not_interested',
  'budget_mismatch',
  'bought_elsewhere',
  'unresponsive',
  'invalid',
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const STAGE_DEFINITIONS: ReadonlyArray<{
  key: StageKey;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  subStatuses: readonly string[];
}> = [
  { key: 'new_lead', name: 'New Lead', position: 1, isWon: false, isLost: false, subStatuses: SUB_STATUSES.new_lead },
  { key: 'attempted_contact', name: 'Attempted Contact', position: 2, isWon: false, isLost: false, subStatuses: SUB_STATUSES.attempted_contact },
  { key: 'engaged_qualified', name: 'Engaged / Qualified', position: 3, isWon: false, isLost: false, subStatuses: SUB_STATUSES.engaged_qualified },
  { key: 'appointment_scheduled', name: 'Appointment Scheduled', position: 4, isWon: false, isLost: false, subStatuses: SUB_STATUSES.appointment_scheduled },
  { key: 'deal_sent', name: 'Deal Sent', position: 5, isWon: false, isLost: false, subStatuses: SUB_STATUSES.deal_sent },
  { key: 'won', name: 'Won', position: 6, isWon: true, isLost: false, subStatuses: SUB_STATUSES.won },
  { key: 'lost', name: 'Lost', position: 7, isWon: false, isLost: true, subStatuses: SUB_STATUSES.lost },
];

export const DEFAULT_PIPELINE_KEY = 'offplan_sales';

const ORDER: Record<StageKey, number> = Object.fromEntries(
  STAGE_DEFINITIONS.map((s) => [s.key, s.position]),
) as Record<StageKey, number>;

export function stagePosition(key: StageKey): number {
  return ORDER[key];
}

export function isStageKey(value: string): value is StageKey {
  return (STAGE_KEYS as readonly string[]).includes(value);
}

export function isValidSubStatus(stage: StageKey, subStatus: string | null | undefined): boolean {
  if (subStatus === null || subStatus === undefined || subStatus === '') return true;
  return (SUB_STATUSES[stage] as readonly string[]).includes(subStatus);
}

export function isLostReason(value: string | null | undefined): value is LostReason {
  return typeof value === 'string' && (LOST_REASONS as readonly string[]).includes(value);
}

/** True once the lead has moved past Attempted Contact — cancels Workflow B. */
export function isPastAttemptedContact(stage: StageKey): boolean {
  return stagePosition(stage) > stagePosition('attempted_contact');
}

export function isClosed(stage: StageKey): boolean {
  return stage === 'won' || stage === 'lost';
}

/** The default sub-status a card lands on when it enters a stage. */
export function defaultSubStatus(stage: StageKey): string | null {
  const first = SUB_STATUSES[stage][0];
  return first ?? null;
}
