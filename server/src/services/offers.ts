/**
 * Sales offers — the library side.
 *
 * An offer is one lead plus one project turned into a private page the client
 * opens on their phone. This file is the Drive: folders, cards, the row menu
 * and the trash. The builder, the client page and the tracking sit beside it.
 *
 * Two rules run through everything here:
 *
 *  - **Whose offer it is decides who may see it.** `agent_user_id` is the only
 *    column the fence reads, and the fence is applied in SQL from the signed-in
 *    session — never from anything the caller sent. An agent asking for another
 *    agent's offer by id gets the same answer as asking for one that was never
 *    written: it does not exist.
 *
 *  - **Nothing here quotes a figure.** Prices reach an offer only as a snapshot
 *    copied from `units` when the agent picks them, which is the builder's job.
 */
import {
  execute, getPool, query, queryOne, withTransaction, type Executor, type SqlParam,
} from '../db/client.js';
import { ownerPredicate, visibleUserIds } from '../auth/scope.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { newId, newToken } from '../lib/ids.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { slugify } from './projects.js';
import type { Role } from '../auth/rbac.js';

export type Viewer = { id: string; role: Role };

/** What the card shows. 'opened' and 'reading' are read from views, not stored. */
export type OfferState = 'draft' | 'sent' | 'opened' | 'reading' | 'revoked';

/**
 * How recently a page must have checked in to count as being read right now.
 * The client page sends a heartbeat every 30 seconds, so this leaves room for
 * one missed beat before the card stops claiming someone is on it.
 */
const READING_WINDOW_MS = 90 * 1000;

/** Trash is emptied after this long, as the specification asks. */
export const TRASH_DAYS = 30;

export type OfferCard = {
  id: string;
  slug: string;
  title: string;
  folder_id: string | null;
  contact_id: string | null;
  project_id: string | null;
  agent_user_id: string;
  client_name: string | null;
  project_name: string | null;
  agent_name: string | null;
  language: string;
  cover_style: number;
  status: 'draft' | 'sent' | 'revoked';
  starred: number;
  hold_until: string | null;
  sent_at: string | null;
  deleted_at: string | null;
  updated_at: string;
  opens: number;
  total_secs: number;
  last_view_at: string | null;
  /** Derived, added by `decorate`. */
  state: OfferState;
};

export type OfferFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  is_shared: number;
  created_by: string | null;
  /** Offers inside it that this viewer may see. */
  offer_count: number;
};

export type LibraryFilter = 'all' | 'star' | 'viewed' | 'draft' | 'trash';

export type ListFilters = {
  filter?: LibraryFilter;
  folderId?: string | null;
  search?: string;
};

/* ── The fence ──────────────────────────────────────────────────────────── */

/**
 * The SQL predicate restricting a query to the offers this viewer may see.
 *
 * Built from the session's role, never from a request body. Owner and admin
 * are unrestricted; a manager gets their team; everyone else gets their own.
 */
async function fence(viewer: Viewer, column = 'o.agent_user_id', exec: Executor = getPool()) {
  const visible = await visibleUserIds(viewer, exec);
  return ownerPredicate(column, visible);
}

/** True for the roles allowed to write in the shared Templates folder. */
function canWriteShared(role: Role): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

/** Only these may empty the trash for good. */
function canPurge(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

/* ── Reading ────────────────────────────────────────────────────────────── */

/*
 * Views are aggregated in a derived table rather than with a correlated
 * subquery per column: one pass over `offer_views` instead of three.
 */
const CARD_COLUMNS = `o.id, o.slug, o.title, o.folder_id, o.contact_id, o.project_id,
  o.agent_user_id, o.language, o.cover_style, o.status, o.starred, o.hold_until,
  o.sent_at, o.deleted_at, o.updated_at,
  c.full_name AS client_name,
  p.name      AS project_name,
  u.name      AS agent_name,
  COALESCE(v.opens, 0)      AS opens,
  COALESCE(v.total_secs, 0) AS total_secs,
  v.last_view_at            AS last_view_at`;

const CARD_JOINS = `FROM offers o
  LEFT JOIN contacts c ON c.id = o.contact_id
  LEFT JOIN projects p ON p.id = o.project_id
  LEFT JOIN users    u ON u.id = o.agent_user_id
  LEFT JOIN (
    SELECT offer_id,
           COUNT(*)                 AS opens,
           SUM(duration_secs)       AS total_secs,
           MAX(last_seen_at)        AS last_view_at
      FROM offer_views GROUP BY offer_id
  ) v ON v.offer_id = o.id`;

/** Add the state the card shows, which is read from the views, not stored. */
function decorate(row: Omit<OfferCard, 'state'>, now = Date.now()): OfferCard {
  const state: OfferState = (() => {
    if (row.status === 'revoked') return 'revoked';
    if (row.status === 'draft') return 'draft';
    if (!row.opens) return 'sent';
    const seen = row.last_view_at ? new Date(row.last_view_at).getTime() : 0;
    return now - seen <= READING_WINDOW_MS ? 'reading' : 'opened';
  })();
  return { ...row, state };
}

export async function listOffers(
  viewer: Viewer,
  filters: ListFilters = {},
  exec: Executor = getPool(),
): Promise<OfferCard[]> {
  const scope = await fence(viewer, 'o.agent_user_id', exec);
  const where: string[] = [scope.sql];
  const params: SqlParam[] = [...scope.params];

  const filter = filters.filter ?? 'all';
  if (filter === 'trash') {
    where.push('o.deleted_at IS NOT NULL');
  } else {
    where.push('o.deleted_at IS NULL');
    // The chips look across every folder; only "All" stays inside the one open.
    if (filter === 'all') {
      if (filters.folderId) { where.push('o.folder_id = ?'); params.push(filters.folderId); }
      else where.push('o.folder_id IS NULL');
    }
    if (filter === 'star') where.push('o.starred = 1');
    if (filter === 'draft') where.push("o.status = 'draft'");
    if (filter === 'viewed') where.push('COALESCE(v.opens, 0) > 0');
  }

  if (filters.search?.trim()) {
    // Offer title, client and project — what an agent actually types.
    where.push('(o.title LIKE ? OR c.full_name LIKE ? OR p.name LIKE ?)');
    const needle = `%${filters.search.trim()}%`;
    params.push(needle, needle, needle);
  }

  const rows = await query<Omit<OfferCard, 'state'>>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS}
      WHERE ${where.join(' AND ')}
      ORDER BY o.starred DESC, o.updated_at DESC
      LIMIT 500`,
    params,
    exec,
  );
  const now = Date.now();
  return rows.map((row) => decorate(row, now));
}

/**
 * One offer, or `notFound` when this viewer may not see it.
 *
 * Deliberately not `forbidden`: telling an agent that an offer exists but is
 * not theirs is itself a leak — it confirms a client is being worked.
 */
export async function getOffer(
  viewer: Viewer,
  id: string,
  exec: Executor = getPool(),
): Promise<OfferCard> {
  const scope = await fence(viewer, 'o.agent_user_id', exec);
  const row = await queryOne<Omit<OfferCard, 'state'>>(
    `SELECT ${CARD_COLUMNS} ${CARD_JOINS} WHERE o.id = ? AND ${scope.sql}`,
    [id, ...scope.params],
    exec,
  );
  if (!row) throw notFound('That offer does not exist');
  return decorate(row);
}

/**
 * The folders, each counting only the offers this viewer may see — so an
 * agent is not told a folder holds twelve offers and then shown two.
 *
 * The folders themselves are shared, deliberately: this is a Drive, and a team
 * that cannot agree on where things go has no filing system. What is fenced is
 * what is *inside* them. An agent can see that "VIP investors" exists and open
 * it; they will find their own offers in it and nobody else's.
 */
export async function listFolders(
  viewer: Viewer,
  exec: Executor = getPool(),
): Promise<OfferFolder[]> {
  const scope = await fence(viewer, 'o.agent_user_id', exec);
  return query<OfferFolder>(
    `SELECT f.id, f.name, f.parent_id, f.is_shared, f.created_by,
            (SELECT COUNT(*) FROM offers o
              WHERE o.folder_id = f.id AND o.deleted_at IS NULL AND ${scope.sql}) AS offer_count
       FROM offer_folders f
      ORDER BY f.is_shared DESC, f.name ASC
      LIMIT 200`,
    scope.params,
    exec,
  );
}

/* ── Writing ────────────────────────────────────────────────────────────── */

/**
 * The public address of an offer.
 *
 * A readable stem so an agent can tell two links apart in their sent messages,
 * then 128 bits of randomness. The page behind it has no login and carries a
 * named client and a price list, so the link itself has to be the secret.
 */
function offerSlug(title: string): string {
  const stem = slugify(title).slice(0, 60);
  return `${stem ? `${stem}-` : ''}${newToken(16)}`;
}

export type NewOffer = {
  title?: string;
  folderId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  projectId?: string | null;
  /** Owner and admin may build an offer for someone else; nobody else may. */
  agentUserId?: string;
  language?: 'en' | 'ar' | 'ru' | 'hi';
};

export async function createOffer(
  actor: AuditActor & { id: string; role: Role },
  input: NewOffer,
  exec: Executor = getPool(),
): Promise<OfferCard> {
  const viewer: Viewer = { id: actor.id, role: actor.role };
  const agentUserId = await resolveAgent(viewer, input.agentUserId, exec);
  const folderId = await checkFolderWritable(viewer, input.folderId ?? null, exec);

  const title = (input.title ?? '').trim() || 'New sales offer';
  const id = newId();
  await execute(
    `INSERT INTO offers (id, slug, title, folder_id, contact_id, opportunity_id, project_id,
                         agent_user_id, created_by, language)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, offerSlug(title), title, folderId,
      input.contactId ?? null, input.opportunityId ?? null, input.projectId ?? null,
      agentUserId, actor.id, input.language ?? 'en',
    ],
    exec,
  );
  await writeAudit({
    actor, action: 'offer.create', entityType: 'offer', entityId: id,
    after: { title, agent_user_id: agentUserId, folder_id: folderId },
  }, exec);
  return getOffer(viewer, id, exec);
}

/** An agent may only ever build an offer for themselves. */
async function resolveAgent(
  viewer: Viewer,
  requested: string | undefined,
  exec: Executor,
): Promise<string> {
  if (!requested || requested === viewer.id) return viewer.id;
  const visible = await visibleUserIds(viewer, exec);
  if (visible !== null && !visible.includes(requested)) {
    throw forbidden('You can only create offers for yourself');
  }
  return requested;
}

/**
 * Check a folder exists and this viewer may put things in it.
 * The shared Templates folder is read-only below manager.
 */
async function checkFolderWritable(
  viewer: Viewer,
  folderId: string | null,
  exec: Executor,
): Promise<string | null> {
  if (!folderId) return null;
  const folder = await queryOne<{ id: string; is_shared: number }>(
    'SELECT id, is_shared FROM offer_folders WHERE id = ?', [folderId], exec,
  );
  if (!folder) throw notFound('That folder does not exist');
  if (folder.is_shared && !canWriteShared(viewer.role)) {
    throw forbidden('The Templates folder is read-only');
  }
  return folder.id;
}

export type OfferPatch = {
  title?: string;
  folderId?: string | null;
  starred?: boolean;
};

/** Rename, move and star — the three the row menu offers. */
export async function updateOffer(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  patch: OfferPatch,
  exec: Executor = getPool(),
): Promise<OfferCard> {
  const viewer: Viewer = { id: actor.id, role: actor.role };
  const before = await getOffer(viewer, id, exec);

  const sets: string[] = [];
  const params: SqlParam[] = [];
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw badRequest('An offer needs a name');
    sets.push('title = ?'); params.push(title.slice(0, 200));
  }
  if (patch.folderId !== undefined) {
    const folderId = await checkFolderWritable(viewer, patch.folderId, exec);
    sets.push('folder_id = ?'); params.push(folderId);
  }
  if (patch.starred !== undefined) { sets.push('starred = ?'); params.push(patch.starred ? 1 : 0); }
  if (!sets.length) return before;

  await execute(`UPDATE offers SET ${sets.join(', ')} WHERE id = ?`, [...params, id], exec);
  const after = await getOffer(viewer, id, exec);
  await writeAudit({
    actor, action: 'offer.update', entityType: 'offer', entityId: id,
    before: { title: before.title, folder_id: before.folder_id, starred: before.starred },
    after: { title: after.title, folder_id: after.folder_id, starred: after.starred },
  }, exec);
  return after;
}

/**
 * Duplicate. The copy is a fresh draft with its own link: the old link keeps
 * working for the client who already has it, and the copy has not been sent.
 */
export async function duplicateOffer(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  exec: Executor = getPool(),
): Promise<OfferCard> {
  const viewer: Viewer = { id: actor.id, role: actor.role };
  const source = await getOffer(viewer, id, exec);

  const copyId = newId();
  const title = `${source.title} (copy)`.slice(0, 200);
  await withTransaction(async (tx) => {
    /*
     * Copied column-for-column in SQL rather than read into JavaScript and
     * written back. A round trip would have to re-encode the `sections` JSON,
     * and a copy that silently loses a section is worse than no copy at all.
     */
    const inserted = await execute(
      `INSERT INTO offers (id, slug, title, folder_id, contact_id, opportunity_id, project_id,
                           agent_user_id, created_by, language, doc_types, who_appears,
                           cover_style, sections, greeting, description, whatsapp_message,
                           video_url, project_url, hold_until, notify_on_open, require_phone,
                           allow_reactions)
       SELECT ?, ?, ?, folder_id, contact_id, opportunity_id, project_id,
              agent_user_id, ?, language, doc_types, who_appears,
              cover_style, sections, greeting, description, whatsapp_message,
              video_url, project_url, hold_until, notify_on_open, require_phone,
              allow_reactions
         FROM offers WHERE id = ?`,
      [copyId, offerSlug(title), title, actor.id, id],
      tx,
    );
    if (!inserted.affectedRows) throw notFound('That offer does not exist');

    // The held units come with it. The views, hearts and questions do not:
    // they belong to the client who read the original.
    await execute(
      `INSERT INTO offer_units (id, offer_id, unit_id, price_version_id, unit_no, unit_type,
                                bedrooms, floor, internal_area_sqft, balcony_sqft, view_text,
                                parking, price_aed, price_per_sqft_aed, status, sort_order)
       SELECT UUID(), ?, unit_id, price_version_id, unit_no, unit_type, bedrooms, floor,
              internal_area_sqft, balcony_sqft, view_text, parking, price_aed,
              price_per_sqft_aed, status, sort_order
         FROM offer_units WHERE offer_id = ?`,
      [copyId, id],
      tx,
    );
  });

  await writeAudit({
    actor, action: 'offer.duplicate', entityType: 'offer', entityId: copyId,
    after: { copied_from: id, title },
  }, exec);
  return getOffer(viewer, copyId, exec);
}

/** Move to trash. Recoverable for 30 days; the client's link stops working now. */
export async function trashOffer(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  exec: Executor = getPool(),
): Promise<void> {
  const viewer: Viewer = { id: actor.id, role: actor.role };
  const before = await getOffer(viewer, id, exec);
  if (before.deleted_at) return;
  await execute('UPDATE offers SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [id], exec);
  await writeAudit({
    actor, action: 'offer.trash', entityType: 'offer', entityId: id,
    before: { title: before.title, deleted_at: null },
    after: { deleted_at: 'now' },
  }, exec);
}

export async function restoreOffer(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  exec: Executor = getPool(),
): Promise<OfferCard> {
  const viewer: Viewer = { id: actor.id, role: actor.role };
  await getOffer(viewer, id, exec);
  await execute('UPDATE offers SET deleted_at = NULL WHERE id = ?', [id], exec);
  await writeAudit({ actor, action: 'offer.restore', entityType: 'offer', entityId: id }, exec);
  return getOffer(viewer, id, exec);
}

/**
 * Delete for good. Owner and admin only, and only from the trash — so a
 * mis-tapped row menu can never be the last thing that happens to an offer.
 */
export async function purgeOffer(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  exec: Executor = getPool(),
): Promise<void> {
  if (!canPurge(actor.role)) throw forbidden('Only the owner or an admin can delete an offer for good');
  const viewer: Viewer = { id: actor.id, role: actor.role };
  const before = await getOffer(viewer, id, exec);
  if (!before.deleted_at) throw badRequest('Move the offer to the trash first');
  await execute('DELETE FROM offers WHERE id = ?', [id], exec);
  await writeAudit({
    actor, action: 'offer.purge', entityType: 'offer', entityId: id,
    before: { title: before.title, client: before.client_name, slug: before.slug },
  }, exec);
}

/** Housekeeping: empty the trash of anything older than 30 days. */
export async function purgeStaleTrash(exec: Executor = getPool()): Promise<number> {
  const result = await execute(
    `DELETE FROM offers
      WHERE deleted_at IS NOT NULL
        AND deleted_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? DAY)`,
    [TRASH_DAYS],
    exec,
  );
  return result.affectedRows ?? 0;
}

/* ── Folders ────────────────────────────────────────────────────────────── */

export async function createFolder(
  actor: AuditActor & { id: string; role: Role },
  input: { name: string; parentId?: string | null },
  exec: Executor = getPool(),
): Promise<OfferFolder> {
  const name = input.name.trim();
  if (!name) throw badRequest('A folder needs a name');

  let parentId: string | null = null;
  if (input.parentId) {
    const parent = await queryOne<{ id: string; parent_id: string | null; is_shared: number }>(
      'SELECT id, parent_id, is_shared FROM offer_folders WHERE id = ?', [input.parentId], exec,
    );
    if (!parent) throw notFound('That folder does not exist');
    // One level, as the specification asks: no folder inside a subfolder.
    if (parent.parent_id) throw badRequest('Folders can only be one level deep');
    if (parent.is_shared && !canWriteShared(actor.role)) {
      throw forbidden('The Templates folder is read-only');
    }
    parentId = parent.id;
  }

  const id = newId();
  await execute(
    'INSERT INTO offer_folders (id, name, parent_id, created_by) VALUES (?, ?, ?, ?)',
    [id, name.slice(0, 160), parentId, actor.id],
    exec,
  );
  await writeAudit({
    actor, action: 'offer_folder.create', entityType: 'offer_folder', entityId: id,
    after: { name, parent_id: parentId },
  }, exec);
  const folder = await queryOne<OfferFolder>(
    'SELECT id, name, parent_id, is_shared, created_by, 0 AS offer_count FROM offer_folders WHERE id = ?',
    [id], exec,
  );
  if (!folder) throw notFound('That folder does not exist');
  return folder;
}

export async function renameFolder(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  name: string,
  exec: Executor = getPool(),
): Promise<void> {
  const folder = await requireWritableFolder(actor.role, id, exec);
  const trimmed = name.trim();
  if (!trimmed) throw badRequest('A folder needs a name');
  await execute('UPDATE offer_folders SET name = ? WHERE id = ?', [trimmed.slice(0, 160), id], exec);
  await writeAudit({
    actor, action: 'offer_folder.rename', entityType: 'offer_folder', entityId: id,
    before: { name: folder.name }, after: { name: trimmed },
  }, exec);
}

/**
 * Delete a folder. The offers inside it are not deleted — `folder_id` is set to
 * NULL by the foreign key and they reappear at the top level, because losing a
 * folder should never lose a client's offer.
 */
export async function deleteFolder(
  actor: AuditActor & { id: string; role: Role },
  id: string,
  exec: Executor = getPool(),
): Promise<void> {
  const folder = await requireWritableFolder(actor.role, id, exec);
  await execute('DELETE FROM offer_folders WHERE id = ?', [id], exec);
  await writeAudit({
    actor, action: 'offer_folder.delete', entityType: 'offer_folder', entityId: id,
    before: { name: folder.name },
  }, exec);
}

async function requireWritableFolder(
  role: Role,
  id: string,
  exec: Executor,
): Promise<{ id: string; name: string; is_shared: number }> {
  const folder = await queryOne<{ id: string; name: string; is_shared: number }>(
    'SELECT id, name, is_shared FROM offer_folders WHERE id = ?', [id], exec,
  );
  if (!folder) throw notFound('That folder does not exist');
  if (folder.is_shared && !canWriteShared(role)) throw forbidden('The Templates folder is read-only');
  return folder;
}
