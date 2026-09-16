import type { PoolConnection } from 'mysql2/promise';
import { execute, isDuplicateKeyError, queryOne, query } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import type { LeadDTO } from './dto.js';
import {
  isPossibleDuplicate,
  mergeContactFields,
  resolveOwner,
  type ContactPatch,
  type ExistingContact,
  type MatchKind,
} from './merge.js';

export type ResolvedContact = {
  contactId: string;
  isNew: boolean;
  matchedBy: MatchKind;
  possibleDuplicate: boolean;
  /** Sticky owner, if the contact already had one. */
  ownerUserId: string | null;
  appliedPatch: ContactPatch;
};

type ContactRow = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_e164: string | null;
  wa_id: string | null;
  email: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
  owner_user_id: string | null;
  first_source: string | null;
  first_touch_at: Date | null;
  locked_fields: unknown;
};

const CONTACT_COLUMNS = `id, full_name, first_name, last_name, phone_e164, wa_id, email, language,
  country, city, owner_user_id, first_source, first_touch_at, locked_fields`;

function toExisting(row: ContactRow): ExistingContact {
  return {
    id: row.id,
    fullName: row.full_name,
    firstName: row.first_name,
    lastName: row.last_name,
    phoneE164: row.phone_e164,
    waId: row.wa_id,
    email: row.email,
    language: row.language,
    country: row.country,
    city: row.city,
    ownerUserId: row.owner_user_id,
    firstSource: row.first_source,
    firstTouchAt: row.first_touch_at,
    lockedFields: parseLockedFields(row.locked_fields),
  };
}

function parseLockedFields(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Snapshot read: cheap, and good enough to find an existing contact. */
async function findCandidate(tx: PoolConnection, lead: LeadDTO): Promise<{ id: string; matchedBy: MatchKind } | null> {
  // Match on phone → wa_id → email, in that order.
  if (lead.person.phoneE164) {
    const row = await queryOne<{ id: string }>('SELECT id FROM contacts WHERE phone_e164 = ?', [lead.person.phoneE164], tx);
    if (row) return { id: row.id, matchedBy: 'phone' };
  }
  if (lead.person.waId) {
    const row = await queryOne<{ id: string }>('SELECT id FROM contacts WHERE wa_id = ?', [lead.person.waId], tx);
    if (row) return { id: row.id, matchedBy: 'wa_id' };
  }
  if (lead.person.email) {
    // Email is not unique — a household can share one. Take the oldest record
    // so repeated inquiries converge on the same contact.
    const row = await queryOne<{ id: string }>(
      'SELECT id FROM contacts WHERE email = ? ORDER BY created_at ASC LIMIT 1',
      [lead.person.email],
      tx,
    );
    if (row) return { id: row.id, matchedBy: 'email' };
  }
  return null;
}

/** Current read with a row lock. Locks an existing row only — never a gap. */
async function lockContact(tx: PoolConnection, id: string): Promise<ContactRow | null> {
  return queryOne<ContactRow>(`SELECT ${CONTACT_COLUMNS} FROM contacts WHERE id = ? FOR UPDATE`, [id], tx);
}

/**
 * After a duplicate-key collision the winning row is committed, so a locking
 * read by unique key finds it without taking a gap lock.
 */
async function lockContactByUniqueKey(tx: PoolConnection, lead: LeadDTO): Promise<{ row: ContactRow; matchedBy: MatchKind } | null> {
  if (lead.person.phoneE164) {
    const row = await queryOne<ContactRow>(
      `SELECT ${CONTACT_COLUMNS} FROM contacts WHERE phone_e164 = ? FOR UPDATE`,
      [lead.person.phoneE164],
      tx,
    );
    if (row) return { row, matchedBy: 'phone' };
  }
  if (lead.person.waId) {
    const row = await queryOne<ContactRow>(
      `SELECT ${CONTACT_COLUMNS} FROM contacts WHERE wa_id = ? FOR UPDATE`,
      [lead.person.waId],
      tx,
    );
    if (row) return { row, matchedBy: 'wa_id' };
  }
  return null;
}

/**
 * Resolve this lead to exactly one contact, inside the caller's transaction.
 *
 * Concurrency: the unique keys on `phone_e164` and `wa_id` are the real
 * guarantee. Twenty copies of the same lead racing each other produce one
 * winner; the losers catch the duplicate-key error and re-read the winning row
 * under a row lock. The initial lookup is deliberately a snapshot read so that
 * a miss does not take a gap lock and deadlock the other writers.
 */
export async function resolveContact(tx: PoolConnection, lead: LeadDTO): Promise<ResolvedContact> {
  const candidate = await findCandidate(tx, lead);

  if (candidate) {
    const row = await lockContact(tx, candidate.id);
    if (row) {
      const existing = toExisting(row);

      // An email-only match whose phone disagrees is two different people far
      // more often than one: a shared household inbox, or a typo. Merging would
      // silently discard the new lead's phone number, so keep the records apart
      // and link them for a manager to merge by hand.
      if (isPossibleDuplicate(candidate.matchedBy, existing, lead)) {
        return createContact(tx, lead, { possibleDuplicateOf: existing.id });
      }
      return updateExisting(tx, row, lead, candidate.matchedBy);
    }
  }

  return createContact(tx, lead, {});
}

/**
 * Create the contact, falling back to the winner's row if a concurrent writer
 * claimed the same phone or wa_id first.
 */
async function createContact(
  tx: PoolConnection,
  lead: LeadDTO,
  opts: { possibleDuplicateOf?: string },
): Promise<ResolvedContact> {
  const contactId = newId();
  try {
    await execute(
      `INSERT INTO contacts
         (id, full_name, first_name, last_name, phone_e164, wa_id, email, language, country, city,
          first_source, first_touch_at, last_source, possible_duplicate_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        contactId,
        lead.person.fullName,
        lead.person.firstName,
        lead.person.lastName,
        lead.person.phoneE164,
        lead.person.waId,
        lead.person.email,
        lead.person.language ?? 'en',
        lead.person.country,
        lead.person.city,
        lead.source,
        lead.receivedAt,
        lead.source,
        opts.possibleDuplicateOf ?? null,
      ],
      tx,
    );
    await recordIdentities(tx, contactId, lead);
    return {
      contactId,
      isNew: true,
      matchedBy: 'none',
      possibleDuplicate: Boolean(opts.possibleDuplicateOf),
      ownerUserId: null,
      appliedPatch: {},
    };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;

    // Someone else created this contact while we were working. Take their row.
    const locked = await lockContactByUniqueKey(tx, lead);
    if (!locked) {
      // The collision was on some other unique key we do not own; surface it.
      throw err;
    }
    logger.debug('contact insert lost a race, merging into the winner', { contactId: locked.row.id });
    return updateExisting(tx, locked.row, lead, locked.matchedBy);
  }
}

async function updateExisting(
  tx: PoolConnection,
  row: ContactRow,
  lead: LeadDTO,
  matchedBy: MatchKind,
): Promise<ResolvedContact> {
  const existing = toExisting(row);
  const patch = await applyPatch(tx, existing.id, mergeContactFields(existing, lead));
  await recordIdentities(tx, existing.id, lead);

  return {
    contactId: existing.id,
    isNew: false,
    matchedBy,
    possibleDuplicate: false,
    ownerUserId: resolveOwner(existing).ownerUserId,
    appliedPatch: patch,
  };
}

/**
 * Apply the patch. If filling a unique column would collide with a different
 * contact, drop those columns and keep the rest — losing one field is better
 * than losing the lead.
 */
async function applyPatch(tx: PoolConnection, contactId: string, patch: ContactPatch): Promise<ContactPatch> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return {};

  try {
    await execute(
      `UPDATE contacts SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...entries.map(([, v]) => v as never), contactId],
      tx,
    );
    return Object.fromEntries(entries) as ContactPatch;
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const safe = entries.filter(([k]) => k !== 'phone_e164' && k !== 'wa_id' && k !== 'email');
    logger.warn('contact patch collided on a unique identifier; applying the rest', { contactId });
    if (safe.length === 0) return {};
    await execute(
      `UPDATE contacts SET ${safe.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
      [...safe.map(([, v]) => v as never), contactId],
      tx,
    );
    return Object.fromEntries(safe) as ContactPatch;
  }
}

/** Every identifier we have seen for this person, so future leads match faster. */
async function recordIdentities(tx: PoolConnection, contactId: string, lead: LeadDTO): Promise<void> {
  const identities: Array<[string, string | null]> = [
    ['phone', lead.person.phoneE164],
    ['wa_id', lead.person.waId],
    ['email', lead.person.email],
    ['meta_lead_id', lead.attribution.metaLeadId],
    ['ctwa_clid', lead.attribution.ctwaClid],
    ['gclid', lead.attribution.gclid],
    ['fbp', lead.attribution.fbp],
    ['fbc', lead.attribution.fbc],
  ];

  for (const [kind, value] of identities) {
    if (!value) continue;
    // INSERT IGNORE: a repeat of a known identifier is expected, not an error.
    await execute(
      'INSERT IGNORE INTO contact_identities (id, contact_id, kind, value, source) VALUES (?, ?, ?, ?, ?)',
      [newId(), contactId, kind, value, lead.source],
      tx,
    );
  }
}

/** Open opportunities for a contact, used by the re-inquiry rule. */
export async function loadOpenOpportunities(tx: PoolConnection, contactId: string) {
  return query<{ id: string; project_name: string | null; stage_key: string; status: 'open' | 'won' | 'lost'; created_at: Date }>(
    `SELECT id, project_name, stage_key, status, created_at
       FROM opportunities WHERE contact_id = ? ORDER BY created_at DESC LIMIT 50`,
    [contactId],
    tx,
  );
}
