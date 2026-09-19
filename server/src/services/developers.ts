/**
 * Developers — the companies whose projects we sell.
 *
 * Kept separate from `projects` because one developer has many projects and,
 * more importantly, because our commercial terms with them (rate, payment
 * terms, who to ring) belong to the relationship and not to any one tower.
 *
 * Two fields here are commercially sensitive and must never reach a client or
 * an agent: `commission_pct` and `payment_terms`. `publicDeveloper` strips
 * them, and every read path that could end up in front of a client uses it.
 */
import { execute, getPool, query, queryOne, type Executor, type SqlParam } from '../db/client.js';
import { badRequest, notFound } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { slugify } from './projects.js';

export type Developer = {
  id: string;
  slug: string;
  legal_name: string;
  short_name: string;
  orn: string | null;
  trn: string | null;
  head_office: string | null;
  escrow_bank: string | null;
  logo_url: string | null;
  website: string | null;
  commission_pct: string | null;
  payment_terms: string | null;
  agreement_date: string | null;
  avg_days_to_pay: number | null;
  track_record: string | null;
  notes: string | null;
  created_at: string;
};

export type DeveloperContact = {
  id: string;
  developer_id: string;
  name: string;
  role: string | null;
  phone_e164: string | null;
  whatsapp_e164: string | null;
  email: string | null;
  is_primary: number;
};

/** Everything commercially sensitive, removed. */
export function publicDeveloper(row: Developer): Omit<Developer, 'commission_pct' | 'payment_terms' | 'avg_days_to_pay' | 'notes'> {
  const { commission_pct: _c, payment_terms: _p, avg_days_to_pay: _a, notes: _n, ...rest } = row;
  return rest;
}

const COLUMNS = `id, slug, legal_name, short_name, orn, trn, head_office, escrow_bank, logo_url,
  website, commission_pct, payment_terms, agreement_date, avg_days_to_pay, track_record, notes, created_at`;

export type DeveloperSummary = Developer & { project_count: number; contact_count: number };

export async function listDevelopers(exec: Executor = getPool()): Promise<DeveloperSummary[]> {
  return query<DeveloperSummary>(
    `SELECT ${COLUMNS.split(',').map((c) => `d.${c.trim()}`).join(', ')},
            (SELECT COUNT(*) FROM projects p WHERE p.developer_id = d.id AND p.archived_at IS NULL) AS project_count,
            (SELECT COUNT(*) FROM developer_contacts c WHERE c.developer_id = d.id) AS contact_count
       FROM developers d
      ORDER BY d.short_name ASC`,
    [],
    exec,
  );
}

export async function getDeveloper(id: string, exec: Executor = getPool()): Promise<Developer> {
  const row = await queryOne<Developer>(`SELECT ${COLUMNS} FROM developers WHERE id = ?`, [id], exec);
  if (!row) throw notFound('That developer does not exist');
  return row;
}

export async function developerContacts(developerId: string, exec: Executor = getPool()): Promise<DeveloperContact[]> {
  return query<DeveloperContact>(
    `SELECT id, developer_id, name, role, phone_e164, whatsapp_e164, email, is_primary
       FROM developer_contacts WHERE developer_id = ? ORDER BY is_primary DESC, name ASC`,
    [developerId],
    exec,
  );
}

export type DeveloperInput = {
  legalName: string;
  shortName?: string | null;
  orn?: string | null;
  trn?: string | null;
  headOffice?: string | null;
  escrowBank?: string | null;
  logoUrl?: string | null;
  website?: string | null;
  commissionPct?: number | null;
  paymentTerms?: string | null;
  agreementDate?: string | null;
  avgDaysToPay?: number | null;
  trackRecord?: string | null;
  notes?: string | null;
};

/**
 * A unique, readable slug. Two developers can legitimately share a short name
 * ("Select Group" exists more than once in the UAE), so a collision gets a
 * numeric suffix rather than an error the user cannot act on.
 */
async function uniqueSlug(base: string, exec: Executor, ignoreId?: string): Promise<string> {
  const root = slugify(base) || 'developer';
  for (let n = 0; n < 50; n += 1) {
    const candidate = n === 0 ? root : `${root}-${n + 1}`;
    const clash = await queryOne<{ id: string }>(
      'SELECT id FROM developers WHERE slug = ? LIMIT 1',
      [candidate],
      exec,
    );
    if (!clash || clash.id === ignoreId) return candidate;
  }
  return `${root}-${Date.now()}`;
}

export async function createDeveloper(
  actor: AuditActor,
  input: DeveloperInput,
  exec: Executor = getPool(),
): Promise<string> {
  const legalName = input.legalName.trim();
  if (!legalName) throw badRequest('A developer needs a legal name');
  const shortName = (input.shortName ?? '').trim() || legalName;

  const id = newId();
  const slug = await uniqueSlug(shortName, exec);

  await execute(
    `INSERT INTO developers (id, slug, legal_name, short_name, orn, trn, head_office, escrow_bank,
                             logo_url, website, commission_pct, payment_terms, agreement_date,
                             avg_days_to_pay, track_record, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, slug, legalName, shortName,
      input.orn ?? null, input.trn ?? null, input.headOffice ?? null, input.escrowBank ?? null,
      input.logoUrl ?? null, input.website ?? null, input.commissionPct ?? null,
      input.paymentTerms ?? null, input.agreementDate ?? null, input.avgDaysToPay ?? null,
      input.trackRecord ?? null, input.notes ?? null,
    ],
    exec,
  );

  await writeAudit(
    { actor, action: 'developer.created', entityType: 'developer', entityId: id, after: { legalName, shortName } },
    exec,
  );
  return id;
}

const EDITABLE: Record<keyof DeveloperInput, string> = {
  legalName: 'legal_name',
  shortName: 'short_name',
  orn: 'orn',
  trn: 'trn',
  headOffice: 'head_office',
  escrowBank: 'escrow_bank',
  logoUrl: 'logo_url',
  website: 'website',
  commissionPct: 'commission_pct',
  paymentTerms: 'payment_terms',
  agreementDate: 'agreement_date',
  avgDaysToPay: 'avg_days_to_pay',
  trackRecord: 'track_record',
  notes: 'notes',
};

export async function updateDeveloper(
  actor: AuditActor,
  id: string,
  patch: Partial<DeveloperInput>,
  exec: Executor = getPool(),
): Promise<void> {
  const before = await getDeveloper(id, exec);

  const columns: string[] = [];
  const params: SqlParam[] = [];
  const after: Record<string, unknown> = {};

  for (const [key, column] of Object.entries(EDITABLE) as [keyof DeveloperInput, string][]) {
    const value = patch[key];
    if (value === undefined) continue;
    columns.push(`${column} = ?`);
    params.push((typeof value === 'string' ? value.trim() || null : value) as SqlParam);
    after[column] = value;
  }
  if (columns.length === 0) return;

  await execute(`UPDATE developers SET ${columns.join(', ')} WHERE id = ?`, [...params, id], exec);
  await writeAudit(
    {
      actor, action: 'developer.updated', entityType: 'developer', entityId: id,
      before: { legalName: before.legal_name, shortName: before.short_name },
      after,
    },
    exec,
  );
}

/**
 * Deleting a developer never deletes their projects: the foreign key nulls the
 * link, and `projects.developer` keeps the name as text, so the leads and
 * WhatsApp replies that reference it carry on working.
 */
export async function deleteDeveloper(actor: AuditActor, id: string, exec: Executor = getPool()): Promise<void> {
  const before = await getDeveloper(id, exec);
  await execute('DELETE FROM developers WHERE id = ?', [id], exec);
  await writeAudit(
    { actor, action: 'developer.deleted', entityType: 'developer', entityId: id, before: { legalName: before.legal_name } },
    exec,
  );
}

/* ── Their sales people ─────────────────────────────────────────────────── */

export type ContactInput = {
  name: string;
  role?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  isPrimary?: boolean;
};

export async function addDeveloperContact(
  actor: AuditActor,
  developerId: string,
  input: ContactInput,
  exec: Executor = getPool(),
): Promise<string> {
  await getDeveloper(developerId, exec);
  const name = input.name.trim();
  if (!name) throw badRequest('A contact needs a name');

  const id = newId();
  await execute(
    `INSERT INTO developer_contacts (id, developer_id, name, role, phone_e164, whatsapp_e164, email, is_primary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, developerId, name, input.role ?? null, input.phone ?? null, input.whatsapp ?? null,
     input.email?.toLowerCase() ?? null, input.isPrimary ? 1 : 0],
    exec,
  );
  await writeAudit(
    { actor, action: 'developer.contact_added', entityType: 'developer', entityId: developerId, after: { name, role: input.role } },
    exec,
  );
  return id;
}

export async function removeDeveloperContact(
  actor: AuditActor,
  contactId: string,
  exec: Executor = getPool(),
): Promise<void> {
  const row = await queryOne<{ developer_id: string; name: string }>(
    'SELECT developer_id, name FROM developer_contacts WHERE id = ?',
    [contactId],
    exec,
  );
  if (!row) throw notFound('That contact does not exist');
  await execute('DELETE FROM developer_contacts WHERE id = ?', [contactId], exec);
  await writeAudit(
    { actor, action: 'developer.contact_removed', entityType: 'developer', entityId: row.developer_id, before: { name: row.name } },
    exec,
  );
}
