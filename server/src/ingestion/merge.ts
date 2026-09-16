import { REINQUIRY_WINDOW_DAYS } from '../config/constants.js';
import type { LeadDTO } from './dto.js';

/**
 * The merge rules from the master prompt, kept pure so they can be reasoned
 * about and tested without a database:
 *  - fill only empty fields; never overwrite agent-edited data
 *  - keep the first-touch source
 *  - a returning lead stays with their existing agent
 */

export type ExistingContact = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  phoneE164: string | null;
  waId: string | null;
  email: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
  ownerUserId: string | null;
  firstSource: string | null;
  firstTouchAt: Date | null;
  /** Field names an agent has edited by hand. These are never overwritten. */
  lockedFields: string[];
};

export type ContactPatch = Partial<{
  full_name: string;
  first_name: string;
  last_name: string;
  phone_e164: string;
  wa_id: string;
  email: string;
  language: string;
  country: string;
  city: string;
  first_source: string;
  first_touch_at: Date;
  last_source: string;
}>;

const FIELD_SOURCES: Array<{
  column: keyof ContactPatch;
  existing: (c: ExistingContact) => string | null;
  incoming: (l: LeadDTO) => string | null;
}> = [
  { column: 'full_name', existing: (c) => c.fullName, incoming: (l) => l.person.fullName },
  { column: 'first_name', existing: (c) => c.firstName, incoming: (l) => l.person.firstName },
  { column: 'last_name', existing: (c) => c.lastName, incoming: (l) => l.person.lastName },
  { column: 'phone_e164', existing: (c) => c.phoneE164, incoming: (l) => l.person.phoneE164 },
  { column: 'wa_id', existing: (c) => c.waId, incoming: (l) => l.person.waId },
  { column: 'email', existing: (c) => c.email, incoming: (l) => l.person.email },
  { column: 'language', existing: (c) => c.language, incoming: (l) => l.person.language },
  { column: 'country', existing: (c) => c.country, incoming: (l) => l.person.country },
  { column: 'city', existing: (c) => c.city, incoming: (l) => l.person.city },
];

/**
 * Work out which contact columns this lead is allowed to fill. Only empty
 * columns are touched, and never one the agent has edited.
 */
export function mergeContactFields(existing: ExistingContact, lead: LeadDTO): ContactPatch {
  const patch: ContactPatch = {};
  const locked = new Set(existing.lockedFields ?? []);

  for (const field of FIELD_SOURCES) {
    if (locked.has(field.column)) continue;
    const current = field.existing(existing);
    if (current !== null && current !== undefined && String(current).trim() !== '') continue;
    const next = field.incoming(lead);
    if (next === null || next === undefined || String(next).trim() === '') continue;
    patch[field.column] = next as never;
  }

  // First touch is written once and then never changes.
  if (!existing.firstSource) patch.first_source = lead.source;
  if (!existing.firstTouchAt) patch.first_touch_at = lead.receivedAt;
  // Last touch always reflects the most recent inquiry.
  patch.last_source = lead.source;

  return patch;
}

/** A returning lead stays with their existing agent. */
export function resolveOwner(existing: ExistingContact | null): { ownerUserId: string | null; sticky: boolean } {
  if (existing?.ownerUserId) return { ownerUserId: existing.ownerUserId, sticky: true };
  return { ownerUserId: null, sticky: false };
}

export type ExistingOpportunity = {
  id: string;
  projectName: string | null;
  stageKey: string;
  status: 'open' | 'won' | 'lost';
  createdAt: Date;
};

export type OpportunityDecision =
  | { action: 'create'; reason: string }
  | { action: 'attach'; opportunityId: string; reason: string };

/**
 * A re-inquiry within 30 days on the same project adds an activity to the open
 * opportunity instead of creating a second one.
 */
export function decideOpportunity(
  existing: ExistingOpportunity[],
  lead: LeadDTO,
  now: Date = new Date(),
): OpportunityDecision {
  const open = existing.filter((o) => o.status === 'open');
  if (open.length === 0) return { action: 'create', reason: 'no_open_opportunity' };

  const windowMs = REINQUIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = open.filter((o) => now.getTime() - o.createdAt.getTime() <= windowMs);
  if (recent.length === 0) return { action: 'create', reason: 'outside_reinquiry_window' };

  const incomingProject = normalizeProject(lead.realEstate.projectName);

  // An inquiry with no project named belongs to the most recent open card.
  if (!incomingProject) {
    const newest = mostRecent(recent);
    return { action: 'attach', opportunityId: newest.id, reason: 'reinquiry_no_project_named' };
  }

  const sameProject = recent.filter((o) => normalizeProject(o.projectName) === incomingProject);
  if (sameProject.length > 0) {
    return { action: 'attach', opportunityId: mostRecent(sameProject).id, reason: 'reinquiry_same_project' };
  }

  // A different project is genuinely a new inquiry.
  return { action: 'create', reason: 'different_project' };
}

function mostRecent(list: ExistingOpportunity[]): ExistingOpportunity {
  return [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] as ExistingOpportunity;
}

function normalizeProject(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim();
  return cleaned || null;
}

/**
 * An email-only match with a different phone number is suspicious: shared
 * family inboxes and typo'd addresses both look like this. Flag it for a
 * manager rather than merging two people together.
 */
export function isPossibleDuplicate(
  matchedBy: MatchKind,
  existing: ExistingContact,
  lead: LeadDTO,
): boolean {
  if (matchedBy !== 'email') return false;
  if (!lead.person.phoneE164 || !existing.phoneE164) return false;
  return lead.person.phoneE164 !== existing.phoneE164;
}

export type MatchKind = 'phone' | 'wa_id' | 'email' | 'none';
