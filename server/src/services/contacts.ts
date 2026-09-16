import { execute, query, queryOne, withRetryingTransaction } from '../db/client.js';
import { forbidden, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { writeAudit, diffFields, type AuditActor } from '../audit/audit.js';
import { addActivity, tagContact } from '../ingestion/ingest.js';
import { canActOnOwner } from '../auth/scope.js';
import { normalizeEmail } from '../lib/email.js';
import { parsePhone } from '../lib/phone.js';

/** Columns an agent may edit by hand. Editing one locks it against automation. */
export const EDITABLE_CONTACT_FIELDS = [
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone_e164',
  'language',
  'country',
  'city',
  'notes',
] as const;
export type EditableContactField = (typeof EDITABLE_CONTACT_FIELDS)[number];

export async function assertCanViewContact(contactId: string, visibleUserIds: string[] | null): Promise<void> {
  if (visibleUserIds === null) return;
  const row = await queryOne<{ owner_user_id: string | null }>('SELECT owner_user_id FROM contacts WHERE id = ?', [contactId]);
  if (!row) throw notFound('Contact not found');
  if (!canActOnOwner(visibleUserIds, row.owner_user_id)) throw forbidden('This lead belongs to another agent');
}

/** Everything the Contact 360 panel needs, in one round trip. */
export async function contact360(contactId: string): Promise<Record<string, unknown>> {
  const contact = await queryOne<Record<string, unknown>>(
    `SELECT c.*, u.name AS owner_name, u.email AS owner_email
       FROM contacts c LEFT JOIN users u ON u.id = c.owner_user_id
      WHERE c.id = ?`,
    [contactId],
  );
  if (!contact) throw notFound('Contact not found');
  delete contact.locked_fields_raw;

  const [opportunities, activities, tasks, tags, consents, identities, aiSuggestions, conversation] = await Promise.all([
    query(
      `SELECT id, title, stage_key, sub_status, status, lost_reason, owner_user_id, project_name, developer,
              emirate, unit_type, budget_min_aed, budget_max_aed, budget_band, purpose, payment_method, timeline,
              golden_visa_interest, deal_value_aed, expected_commission_aed, lead_score, source,
              campaign_name, adset_name, ad_name, created_at, stage_changed_at, closed_at, sla_breached
         FROM opportunities WHERE contact_id = ? ORDER BY created_at DESC`,
      [contactId],
    ),
    query(
      `SELECT a.id, a.type, a.title, a.body, a.meta, a.created_at, a.user_id, u.name AS user_name
         FROM activities a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.contact_id = ? ORDER BY a.created_at DESC LIMIT 100`,
      [contactId],
    ),
    query(
      `SELECT t.id, t.type, t.title, t.notes, t.priority, t.due_at, t.completed_at, t.assigned_user_id, u.name AS assignee_name
         FROM tasks t LEFT JOIN users u ON u.id = t.assigned_user_id
        WHERE t.contact_id = ? ORDER BY t.completed_at IS NOT NULL, t.due_at ASC LIMIT 50`,
      [contactId],
    ),
    query(
      `SELECT t.namespace, t.value, t.label FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.contact_id = ? ORDER BY t.namespace, t.value`,
      [contactId],
    ),
    query(
      `SELECT channel, granted, source, consent_text, created_at FROM consents
        WHERE contact_id = ? ORDER BY created_at DESC LIMIT 20`,
      [contactId],
    ),
    query('SELECT kind, value, source, created_at FROM contact_identities WHERE contact_id = ?', [contactId]),
    query(
      `SELECT id, field, value, confidence, status, created_at FROM ai_field_suggestions
        WHERE contact_id = ? AND status IN ('suggested','applied') ORDER BY created_at DESC LIMIT 30`,
      [contactId],
    ),
    queryOne(
      `SELECT id, assigned_user_id, last_message_at, last_inbound_at, wa_window_expires_at, unread_count, status
         FROM conversations WHERE contact_id = ?`,
      [contactId],
    ),
  ]);

  return {
    contact,
    opportunities,
    activities,
    tasks,
    tags: (tags as Array<{ namespace: string; value: string }>).map((t) => `${t.namespace}:${t.value}`),
    tagDetails: tags,
    consents,
    identities,
    aiSuggestions,
    conversation,
  };
}

export type UpdateContactInput = {
  contactId: string;
  patch: Partial<Record<EditableContactField, string | null>>;
  actor: AuditActor;
  actingUserId: string | null;
};

/**
 * Update a contact by hand. Every field an agent touches is added to
 * `locked_fields`, so no later automated ingest can overwrite their work.
 */
export async function updateContact(input: UpdateContactInput): Promise<void> {
  await withRetryingTransaction(async (tx) => {
    const current = await queryOne<Record<string, unknown> & { locked_fields: unknown }>(
      'SELECT * FROM contacts WHERE id = ? FOR UPDATE',
      [input.contactId],
      tx,
    );
    if (!current) throw notFound('Contact not found');

    const patch: Record<string, string | null> = {};
    for (const field of EDITABLE_CONTACT_FIELDS) {
      const value = input.patch[field];
      if (value === undefined) continue;
      if (field === 'email') {
        patch.email = value ? normalizeEmail(value) : null;
      } else if (field === 'phone_e164') {
        const parsed = parsePhone(value);
        patch.phone_e164 = value ? parsed.e164 : null;
        // Keep wa_id consistent with the phone an agent corrected.
        if (parsed.waId) patch.wa_id = parsed.waId;
      } else {
        patch[field] = value === null ? null : String(value).trim() || null;
      }
    }
    if (Object.keys(patch).length === 0) return;

    const locked = new Set<string>(parseLocked(current.locked_fields));
    for (const key of Object.keys(patch)) locked.add(key);

    const entries = Object.entries(patch);
    await execute(
      `UPDATE contacts SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, locked_fields = ? WHERE id = ?`,
      [...entries.map(([, v]) => v), JSON.stringify([...locked]), input.contactId],
      tx,
    );

    const before: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) before[key] = current[key] ?? null;
    const diff = diffFields(before, patch);

    await addActivity(tx, {
      contactId: input.contactId,
      userId: input.actingUserId,
      type: 'contact.updated',
      title: `Updated ${Object.keys(patch).join(', ')}`,
      meta: { fields: Object.keys(patch) },
    });
    await writeAudit(
      {
        actor: input.actor,
        action: 'contact.updated',
        entityType: 'contact',
        entityId: input.contactId,
        before: diff.before,
        after: diff.after,
      },
      tx,
    );
  });
}

function parseLocked(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as string[];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Merge two contacts. Managers and above only.
 *
 * Everything hanging off the loser moves to the winner, the loser is kept as a
 * tombstone pointing at the winner, and the whole thing is audited.
 */
export async function mergeContacts(input: {
  winnerId: string;
  loserId: string;
  actor: AuditActor;
}): Promise<{ moved: Record<string, number> }> {
  if (input.winnerId === input.loserId) throw notFound('Cannot merge a contact into itself');

  return withRetryingTransaction(async (tx) => {
    // Lock both rows in a stable order so two merges cannot deadlock.
    const [firstId, secondId] = [input.winnerId, input.loserId].sort() as [string, string];
    await queryOne('SELECT id FROM contacts WHERE id = ? FOR UPDATE', [firstId], tx);
    await queryOne('SELECT id FROM contacts WHERE id = ? FOR UPDATE', [secondId], tx);

    const winner = await queryOne<Record<string, unknown>>('SELECT * FROM contacts WHERE id = ?', [input.winnerId], tx);
    const loser = await queryOne<Record<string, unknown>>('SELECT * FROM contacts WHERE id = ?', [input.loserId], tx);
    if (!winner || !loser) throw notFound('Both contacts must exist to merge them');

    const moved: Record<string, number> = {};
    const move = async (table: string, column = 'contact_id') => {
      const result = await execute(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, [input.winnerId, input.loserId], tx);
      moved[table] = result.affectedRows;
    };

    await move('opportunities');
    await move('activities');
    await move('tasks');
    await move('consents');
    await move('ai_field_suggestions');
    await move('conversion_events');

    // The unique keys mean these need to tolerate collisions.
    await execute('UPDATE IGNORE contact_identities SET contact_id = ? WHERE contact_id = ?', [input.winnerId, input.loserId], tx);
    await execute('DELETE FROM contact_identities WHERE contact_id = ?', [input.loserId], tx);
    await execute('UPDATE IGNORE contact_tags SET contact_id = ? WHERE contact_id = ?', [input.winnerId, input.loserId], tx);
    await execute('DELETE FROM contact_tags WHERE contact_id = ?', [input.loserId], tx);

    // One thread per contact: fold the loser's messages into the winner's.
    const winnerConversation = await queryOne<{ id: string }>('SELECT id FROM conversations WHERE contact_id = ?', [input.winnerId], tx);
    const loserConversation = await queryOne<{ id: string }>('SELECT id FROM conversations WHERE contact_id = ?', [input.loserId], tx);
    if (loserConversation && winnerConversation) {
      await execute('UPDATE messages SET conversation_id = ?, contact_id = ? WHERE conversation_id = ?', [
        winnerConversation.id,
        input.winnerId,
        loserConversation.id,
      ], tx);
      await execute('DELETE FROM conversations WHERE id = ?', [loserConversation.id], tx);
    } else if (loserConversation) {
      await execute('UPDATE conversations SET contact_id = ? WHERE id = ?', [input.winnerId, loserConversation.id], tx);
      await execute('UPDATE messages SET contact_id = ? WHERE conversation_id = ?', [input.winnerId, loserConversation.id], tx);
    }

    // Fill the winner's gaps from the loser, but never overwrite what it has.
    const fillable = ['full_name', 'first_name', 'last_name', 'email', 'city', 'country', 'language'];
    const fills = fillable.filter((f) => !winner[f] && loser[f]);
    if (fills.length) {
      await execute(
        `UPDATE contacts SET ${fills.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
        [...fills.map((f) => loser[f] as string), input.winnerId],
        tx,
      );
    }
    // A DNC on either record applies to the merged person.
    if (loser.dnc === 1) {
      await execute('UPDATE contacts SET dnc = 1, dnc_reason = COALESCE(dnc_reason, ?), dnc_at = COALESCE(dnc_at, NOW(3)) WHERE id = ?', [
        (loser.dnc_reason as string) ?? 'merged from duplicate',
        input.winnerId,
      ], tx);
    }

    // Keep the loser as a tombstone so old links and reports still resolve.
    await execute(
      `UPDATE contacts
          SET merged_into_id = ?, phone_e164 = NULL, wa_id = NULL, email = NULL,
              possible_duplicate_of = NULL, notes = CONCAT(COALESCE(notes, ''), '\n[merged into ', ?, ']')
        WHERE id = ?`,
      [input.winnerId, input.winnerId, input.loserId],
      tx,
    );
    await execute('UPDATE contacts SET possible_duplicate_of = NULL WHERE possible_duplicate_of = ?', [input.loserId], tx);

    await tagContact(tx, input.winnerId, 'ops', 'merged');
    await addActivity(tx, {
      contactId: input.winnerId,
      userId: input.actor.userId,
      type: 'contact.merged',
      title: 'Merged a duplicate contact into this one',
      meta: { loserId: input.loserId, moved },
    });
    await writeAudit(
      {
        actor: input.actor,
        action: 'contact.merged',
        entityType: 'contact',
        entityId: input.winnerId,
        before: { loser: { id: input.loserId, phone_e164: loser.phone_e164, email: loser.email } },
        after: { moved },
      },
      tx,
    );

    return { moved };
  });
}

/** Add the contact to the do-not-contact list. Used by the STOP intent and by agents. */
export async function setDnc(input: {
  contactId: string;
  reason: string;
  actor: AuditActor;
}): Promise<void> {
  await withRetryingTransaction(async (tx) => {
    const contact = await queryOne<{ phone_e164: string | null; wa_id: string | null; email: string | null; dnc: number }>(
      'SELECT phone_e164, wa_id, email, dnc FROM contacts WHERE id = ? FOR UPDATE',
      [input.contactId],
      tx,
    );
    if (!contact) throw notFound('Contact not found');

    await execute('UPDATE contacts SET dnc = 1, dnc_reason = ?, dnc_at = NOW(3) WHERE id = ?', [
      input.reason.slice(0, 160),
      input.contactId,
    ], tx);

    // Also suppress by identifier, so a STOP survives a merge and applies even
    // before a contact record exists next time.
    const identifiers: Array<[string, string | null]> = [
      ['phone', contact.phone_e164],
      ['wa_id', contact.wa_id],
      ['email', contact.email],
    ];
    for (const [kind, value] of identifiers) {
      if (!value) continue;
      await execute(
        'INSERT IGNORE INTO suppressions (id, kind, value, reason, created_by_user_id) VALUES (?, ?, ?, ?, ?)',
        [newId(), kind, value, input.reason.slice(0, 160), input.actor.userId],
        tx,
      );
    }

    await addActivity(tx, {
      contactId: input.contactId,
      userId: input.actor.userId,
      type: 'contact.dnc',
      title: 'Added to the do-not-contact list',
      body: input.reason,
    });
    await writeAudit(
      {
        actor: input.actor,
        action: 'contact.dnc_added',
        entityType: 'contact',
        entityId: input.contactId,
        before: { dnc: contact.dnc === 1 },
        after: { dnc: true, reason: input.reason },
      },
      tx,
    );
  });
}
