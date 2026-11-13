import { execute, query, queryOne, withTransaction } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest, notFound } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { TODAY } from './dubai.js';

/**
 * Desks: a group of agents with one number on it.
 *
 * `design/web/desks.html`. The tables are already here — migration 0036 made
 * `desks` and `desk_members` and nothing had used them yet. Its own comment
 * says why they are not `teams`: a team carries a manager and drives the live
 * assignment rules, a desk carries a maximum number of open leads. Widening
 * `teams` was considered there and refused, so this reads the table that was
 * built for it rather than adding a second column meaning the same thing.
 *
 * `max_open_leads` is a number the office agrees and the screen measures
 * against. **Nothing is blocked by it yet**: assignment reads `users`
 * availability and open-lead counts (`assignment/apply.ts`,
 * `v2/incoming.ts`), not this. So the screen says what is true — it shows who
 * is over — and does not promise that new leads skip them.
 */

export interface DeskMember {
  userId: string;
  name: string;
  photoUrl: string | null;
  openLeads: number;
  /** Where they said they are today, when they have checked in. */
  markedToday: 'office' | 'outside' | null;
}

export interface Desk {
  id: string;
  name: string;
  maxOpenLeads: number | null;
  members: DeskMember[];
}

/** Everybody who could be put on a desk, and where they already are. */
export interface Candidate extends DeskMember {
  languages: string[];
  deskIds: string[];
}

export interface DeskList {
  items: Desk[];
  agents: Candidate[];
}

/* One subquery, written once: every count on this screen must agree. */
const OPEN_LEADS = `(SELECT COUNT(*) FROM opportunities o
   WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL)`;

const TODAYS_KIND = `(SELECT a.kind FROM attendance a
   WHERE a.user_id = u.id AND a.on_date = ${TODAY} LIMIT 1)`;

function languagesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((one) => String(one));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map((one) => String(one)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function listDesks(): Promise<DeskList> {
  const [desks, members, agents] = await Promise.all([
    query<{ id: string; name: string; max_open_leads: number | null }>(
      'SELECT id, name, max_open_leads FROM desks WHERE is_active = 1 ORDER BY name',
    ),
    query<Record<string, unknown>>(
      `SELECT dm.desk_id AS deskId, u.id AS userId, u.name, u.photo_url AS photoUrl,
              ${OPEN_LEADS} AS openLeads, ${TODAYS_KIND} AS markedToday
         FROM desk_members dm
         JOIN users u ON u.id = dm.user_id
         JOIN desks d ON d.id = dm.desk_id AND d.is_active = 1
        WHERE u.is_active = 1
        ORDER BY ${OPEN_LEADS} DESC, u.name`,
    ),
    query<Record<string, unknown>>(
      `SELECT u.id AS userId, u.name, u.photo_url AS photoUrl, u.languages,
              ${OPEN_LEADS} AS openLeads, ${TODAYS_KIND} AS markedToday
         FROM users u
        WHERE u.is_active = 1 AND u.role IN ('agent', 'manager')
        ORDER BY u.name`,
    ),
  ]);

  const read = (row: Record<string, unknown>): DeskMember => ({
    userId: String(row.userId),
    name: String(row.name),
    photoUrl: (row.photoUrl as string | null) ?? null,
    openLeads: Number(row.openLeads ?? 0),
    markedToday: (row.markedToday as 'office' | 'outside' | null) ?? null,
  });

  const onDesks = new Map<string, string[]>();
  for (const row of members) {
    const userId = String(row.userId);
    onDesks.set(userId, [...(onDesks.get(userId) ?? []), String(row.deskId)]);
  }

  return {
    items: desks.map((desk) => ({
      id: desk.id,
      name: desk.name,
      maxOpenLeads: desk.max_open_leads === null ? null : Number(desk.max_open_leads),
      members: members.filter((row) => String(row.deskId) === desk.id).map(read),
    })),
    agents: agents.map((row) => ({
      ...read(row),
      languages: languagesOf(row.languages),
      deskIds: onDesks.get(String(row.userId)) ?? [],
    })),
  };
}

export interface DeskInput {
  name: string;
  maxOpenLeads: number | null;
  memberIds: string[];
}

/**
 * The desk, active or not, that already holds this name.
 *
 * `desks.name` is UNIQUE and a deleted desk keeps its row, so both halves of
 * this matter: an active clash is a message for the person typing, and an
 * inactive one is a row to bring back rather than a database error nobody can
 * read.
 */
async function deskNamed(name: string): Promise<{ id: string; is_active: number } | null> {
  return queryOne<{ id: string; is_active: number }>(
    'SELECT id, is_active FROM desks WHERE name = ? LIMIT 1',
    [name],
  );
}

async function refuseIfNameTaken(name: string, exceptId?: string): Promise<void> {
  const clash = await deskNamed(name);
  if (clash && clash.id !== exceptId && Number(clash.is_active) === 1) {
    throw badRequest('There is already a desk with this name.');
  }
  if (clash && clash.id !== exceptId) {
    throw badRequest('A deleted desk had this name. Choose another one.');
  }
}

export async function createDesk(actor: AuditActor, input: DeskInput): Promise<{ id: string }> {
  const existing = await deskNamed(input.name);
  if (existing && Number(existing.is_active) === 1) {
    throw badRequest('There is already a desk with this name.');
  }

  /* A desk deleted earlier still owns its name in the unique index. Adding it
     again brings that row back rather than failing on a key nobody can see. */
  const restored = Boolean(existing);
  const id = existing?.id ?? newId();

  await withTransaction(async (tx) => {
    if (restored) {
      await execute(
        'UPDATE desks SET is_active = 1, max_open_leads = ? WHERE id = ?',
        [input.maxOpenLeads, id],
        tx,
      );
      await execute('DELETE FROM desk_members WHERE desk_id = ?', [id], tx);
    } else {
      await execute(
        'INSERT INTO desks (id, name, max_open_leads) VALUES (?, ?, ?)',
        [id, input.name, input.maxOpenLeads],
        tx,
      );
    }
    for (const userId of input.memberIds) {
      await execute(
        'INSERT IGNORE INTO desk_members (desk_id, user_id) VALUES (?, ?)',
        [id, userId],
        tx,
      );
    }
  });

  await writeAudit({
    actor,
    action: 'desk.created',
    entityType: 'desk',
    entityId: id,
    after: {
      name: input.name,
      maxOpenLeads: input.maxOpenLeads,
      members: input.memberIds.length,
      ...(restored ? { restored: true } : {}),
    },
  });
  return { id };
}

export async function updateDesk(
  actor: AuditActor, id: string, patch: Partial<DeskInput>,
): Promise<void> {
  const before = await queryOne<{ id: string; name: string; max_open_leads: number | null }>(
    'SELECT id, name, max_open_leads FROM desks WHERE id = ? AND is_active = 1',
    [id],
  );
  if (!before) throw notFound('That desk is not there.');
  if (patch.name !== undefined) await refuseIfNameTaken(patch.name, id);

  await withTransaction(async (tx) => {
    if (patch.name !== undefined) {
      await execute('UPDATE desks SET name = ? WHERE id = ?', [patch.name, id], tx);
    }
    if (patch.maxOpenLeads !== undefined) {
      await execute('UPDATE desks SET max_open_leads = ? WHERE id = ?', [patch.maxOpenLeads, id], tx);
    }
    if (patch.memberIds !== undefined) {
      /* The list replaces the membership wholesale, which is what the panel
         means when it saves. Nobody's leads move: a desk is a grouping. */
      await execute('DELETE FROM desk_members WHERE desk_id = ?', [id], tx);
      for (const userId of patch.memberIds) {
        await execute(
          'INSERT IGNORE INTO desk_members (desk_id, user_id) VALUES (?, ?)',
          [id, userId],
          tx,
        );
      }
    }
  });

  await writeAudit({
    actor,
    action: 'desk.updated',
    entityType: 'desk',
    entityId: id,
    before: { name: before.name, maxOpenLeads: before.max_open_leads },
    after: {
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.maxOpenLeads === undefined ? {} : { maxOpenLeads: patch.maxOpenLeads }),
      ...(patch.memberIds === undefined ? {} : { members: patch.memberIds.length }),
    },
  });
}

/**
 * Deleting a desk.
 *
 * Switched off rather than removed, the way a team is: the audit trail refers
 * to it by id, and the agents keep every lead they had — which is what the
 * screen promises when it asks.
 */
export async function deleteDesk(actor: AuditActor, id: string): Promise<void> {
  const desk = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM desks WHERE id = ? AND is_active = 1',
    [id],
  );
  if (!desk) throw notFound('That desk is not there.');

  await execute('UPDATE desks SET is_active = 0 WHERE id = ?', [id]);
  await writeAudit({
    actor,
    action: 'desk.deleted',
    entityType: 'desk',
    entityId: id,
    before: { name: desk.name },
  });
}
