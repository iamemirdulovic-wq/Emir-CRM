/**
 * Running an import.
 *
 * The file is read in one streaming pass and committed in chunks, so a
 * hundred-thousand-row file never sits in memory and the progress bar moves
 * while it runs. The job re-enqueues itself for the next chunk, which means a
 * worker restart costs one chunk rather than the whole import.
 *
 * Nothing here decides *policy* — how a row becomes a lead is in normalize.ts,
 * who it goes to is in assignment/ — so this file is mostly bookkeeping, which
 * is what it should be.
 */
import { execute, getPool, query, queryOne, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';
import { enqueue } from '../jobs/queue.js';
import { writeAudit, SYSTEM_ACTOR, type AuditActor } from '../audit/audit.js';
import { ingestLead } from '../ingestion/ingest.js';
import { tagContact } from '../ingestion/ingest.js';
import { assign } from '../assignment/apply.js';
import type { AssignmentMethod, AssignmentRuleClause, SplitShare } from '../assignment/distribute.js';
import { readRows, type FileKind } from './rows.js';
import { mapRow, rowToLead, type ImportSettings } from './normalize.js';
import type { ColumnMapping } from './mapping.js';

/** Rows committed per chunk. Small enough to keep transactions short. */
export const CHUNK_SIZE = 1000;

/** How long an import can be taken back. */
export const UNDO_WINDOW_HOURS = 24;

export interface ImportAssignment {
  method: AssignmentMethod;
  userId?: string | null;
  teamId?: string | null;
  shares?: SplitShare[];
  clauses?: AssignmentRuleClause[];
}

export interface ImportRecord {
  id: string;
  file_path: string | null;
  file_kind: FileKind;
  status: string;
  total_rows: number;
  processed_rows: number;
  mapping: unknown;
  settings: unknown;
  assignment: unknown;
}

function asJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

export async function loadImport(importId: string, exec: Executor = getPool()): Promise<ImportRecord | null> {
  return queryOne<ImportRecord>(
    `SELECT id, file_path, file_kind, status, total_rows, processed_rows, mapping, settings, assignment
       FROM imports WHERE id = ?`,
    [importId],
    exec,
  );
}

/**
 * Reads the file once, writing every row into `import_rows` as pending.
 *
 * Staging the rows first is what makes the rest possible: an accurate row
 * count for the progress bar, a failed-rows download, and an undo that knows
 * exactly which contacts this import created.
 */
export async function stageRows(importId: string, exec: Executor = getPool()): Promise<number> {
  const record = await loadImport(importId, exec);
  if (!record?.file_path) throw new Error('That import has no file');

  await execute("UPDATE imports SET status = 'validating', started_at = NOW(3) WHERE id = ?", [importId], exec);

  const source = await readRows(record.file_path, record.file_kind);
  await execute('UPDATE imports SET headers = ? WHERE id = ?', [JSON.stringify(source.headers), importId], exec);

  let lineNumber = 0;
  let batch: unknown[][] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const placeholders = batch.map(() => '(?, ?, ?, ?)').join(',');
    await execute(
      `INSERT INTO import_rows (id, import_id, line_number, raw) VALUES ${placeholders}`,
      batch.flat() as never[],
      exec,
    );
    batch = [];
  };

  for await (const values of source.rows) {
    lineNumber += 1;
    batch.push([newId(), importId, lineNumber, JSON.stringify(values)]);
    if (batch.length >= CHUNK_SIZE) {
      await flush();
      await execute('UPDATE imports SET total_rows = ? WHERE id = ?', [lineNumber, importId], exec);
    }
  }
  await flush();

  await execute("UPDATE imports SET total_rows = ?, status = 'ready' WHERE id = ?", [lineNumber, importId], exec);
  logger.info('import rows staged', { importId, rows: lineNumber });
  return lineNumber;
}

export interface ChunkResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  failed: number;
  done: boolean;
}

/**
 * Imports the next chunk of staged rows.
 *
 * Each row is its own transaction inside `ingestLead`, so one bad row cannot
 * roll back the 999 good ones next to it.
 */
export async function runChunk(importId: string, exec: Executor = getPool()): Promise<ChunkResult> {
  const record = await loadImport(importId, exec);
  if (!record) throw new Error(`Import ${importId} not found`);
  if (record.status === 'undone') return emptyChunk(true);

  const mapping = asJson<ColumnMapping>(record.mapping, {});
  const settings = asJson<ImportSettings>(record.settings, null as never);
  if (!settings) throw new Error('That import has no settings');

  const headers = asJson<string[]>(
    (await queryOne<{ headers: unknown }>('SELECT headers FROM imports WHERE id = ?', [importId], exec))?.headers,
    [],
  );

  const rows = await query<{ id: string; line_number: number; raw: unknown }>(
    `SELECT id, line_number, raw FROM import_rows
      WHERE import_id = ? AND status = 'pending'
      ORDER BY line_number
      LIMIT ${CHUNK_SIZE}`,
    [importId],
    exec,
  );

  if (rows.length === 0) {
    await finish(importId, exec);
    return emptyChunk(true);
  }

  await execute("UPDATE imports SET status = 'importing' WHERE id = ?", [importId], exec);

  const result = emptyChunk(false);
  const seen = await loadSeenKeys(importId, exec);

  for (const row of rows) {
    const values = asJson<string[]>(row.raw, []);
    const { mapped, unmapped } = mapRow(headers, values, mapping);
    const outcome = rowToLead(mapped, unmapped, settings, row.line_number);

    if (!outcome.ok) {
      await markRow(exec, row.id, 'invalid', outcome.reason);
      result.invalid += 1;
      continue;
    }

    // The same person twice in one file is not a CRM duplicate, it is a file
    // duplicate: the second occurrence is dropped before ingestion sees it.
    if (outcome.dedupeKey && seen.has(outcome.dedupeKey)) {
      await markRow(exec, row.id, 'skipped', 'Appears earlier in this file');
      result.skipped += 1;
      continue;
    }
    if (outcome.dedupeKey) seen.add(outcome.dedupeKey);

    try {
      /*
       * Step 4 of the wizard: what to do about someone already in the CRM.
       * The check runs before ingestion so "skip" really skips — it must not
       * touch the existing record at all.
       */
      const existing = await findExisting(exec, outcome.lead.person.phoneE164, outcome.lead.person.email);

      if (existing && settings.duplicateStrategy === 'skip') {
        await markRow(exec, row.id, 'skipped', 'Already in the CRM', existing, undefined, outcome.dedupeKey);
        result.skipped += 1;
        result.processed += 1;
        continue;
      }

      const ingested = await ingestLead(outcome.lead, {
        importId,
        // "create anyway" opens a fresh inquiry instead of folding the row into
        // the existing card under the 30-day re-inquiry rule.
        forceNewOpportunity: settings.duplicateStrategy === 'create_anyway',
      });

      if (ingested.isNewContact) {
        await markRow(exec, row.id, 'created', null, ingested.contactId, ingested.opportunityId, outcome.dedupeKey);
        result.created += 1;
      } else {
        await markRow(
          exec,
          row.id,
          'updated',
          settings.duplicateStrategy === 'create_anyway'
            ? 'Existing contact, new inquiry opened'
            : 'Matched an existing contact; empty fields filled',
          ingested.contactId,
          ingested.opportunityId,
          outcome.dedupeKey,
        );
        result.updated += 1;
      }

      await applyRowTags(exec, ingested.contactId, settings, mapped.tags ?? null);
      if (existing && settings.duplicateStrategy === 'create_anyway') {
        await tagContact(exec, ingested.contactId, 'ops', 'import_duplicate');
      }
    } catch (err) {
      logger.warn('import row failed', { importId, lineNumber: row.line_number, error: String(err) });
      await markRow(exec, row.id, 'failed', String(err).slice(0, 250));
      result.failed += 1;
    }
    result.processed += 1;
  }

  await execute(
    `UPDATE imports
        SET processed_rows = processed_rows + ?,
            created_count  = created_count + ?,
            updated_count  = updated_count + ?,
            skipped_count  = skipped_count + ?,
            failed_count   = failed_count + ?
      WHERE id = ?`,
    [rows.length, result.created, result.updated, result.skipped + result.invalid, result.failed, importId],
    exec,
  );

  const remaining = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM import_rows WHERE import_id = ? AND status = 'pending'",
    [importId],
    exec,
  );
  result.done = Number(remaining?.n ?? 0) === 0;
  if (result.done) await finish(importId, exec);

  return result;
}

function emptyChunk(done: boolean): ChunkResult {
  return { processed: 0, created: 0, updated: 0, skipped: 0, invalid: 0, failed: 0, done };
}

/** Dedupe keys already used by this import, so a resumed chunk still dedupes. */
async function loadSeenKeys(importId: string, exec: Executor): Promise<Set<string>> {
  const rows = await query<{ normalized: unknown }>(
    `SELECT normalized FROM import_rows
      WHERE import_id = ? AND normalized IS NOT NULL`,
    [importId],
    exec,
  );
  const keys = new Set<string>();
  for (const row of rows) {
    const key = asJson<{ dedupeKey?: string }>(row.normalized, {}).dedupeKey;
    if (key) keys.add(key);
  }
  return keys;
}

async function markRow(
  exec: Executor,
  rowId: string,
  status: string,
  reason: string | null,
  contactId?: string,
  opportunityId?: string,
  dedupeKey?: string | null,
): Promise<void> {
  await execute(
    `UPDATE import_rows
        SET status = ?, reason = ?, contact_id = ?, opportunity_id = ?, normalized = ?
      WHERE id = ?`,
    [
      status,
      reason,
      contactId ?? null,
      opportunityId ?? null,
      // The dedupe key is persisted so a chunk that resumes after a restart
      // still knows which people this file has already produced.
      dedupeKey ? JSON.stringify({ dedupeKey }) : null,
      rowId,
    ],
    exec,
  );
}

/** Is this person already in the CRM? Phone first, then wa_id, then email. */
async function findExisting(
  exec: Executor,
  phoneE164: string | null,
  email: string | null,
): Promise<string | undefined> {
  if (phoneE164) {
    const byPhone = await queryOne<{ id: string }>(
      'SELECT id FROM contacts WHERE (phone_e164 = ? OR wa_id = ?) AND merged_into_id IS NULL LIMIT 1',
      [phoneE164, phoneE164.replace(/^\+/, '')],
      exec,
    );
    if (byPhone) return byPhone.id;
  }
  if (email) {
    const byEmail = await queryOne<{ id: string }>(
      'SELECT id FROM contacts WHERE email = ? AND merged_into_id IS NULL LIMIT 1',
      [email],
      exec,
    );
    if (byEmail) return byEmail.id;
  }
  return undefined;
}

/** Import-wide tags plus anything the file's own tag column carried. */
async function applyRowTags(
  exec: Executor,
  contactId: string,
  settings: ImportSettings,
  rowTags: string | null,
): Promise<void> {
  const tags = [...settings.tags, `import:${settings.sourceLabel}`];
  if (rowTags) tags.push(...rowTags.split(/[,;|]/).map((tag) => tag.trim()).filter(Boolean));
  for (const tag of tags) {
    // "proj:beachfront" keeps its namespace; a bare tag lands under src:,
    // which is where an import's provenance belongs.
    const [namespace, value] = tag.includes(':') ? tag.split(/:(.+)/) : ['src', tag];
    if (namespace && value) await tagContact(exec, contactId, namespace, value);
  }
}

/** Assign what the import created, then close it out. */
async function finish(importId: string, exec: Executor): Promise<void> {
  const record = await loadImport(importId, exec);
  if (!record || record.status === 'completed' || record.status === 'undone') return;

  const assignment = asJson<ImportAssignment | null>(record.assignment, null);
  if (assignment) {
    const created = await query<{ opportunity_id: string }>(
      `SELECT opportunity_id FROM import_rows
        WHERE import_id = ? AND status IN ('created','updated') AND opportunity_id IS NOT NULL`,
      [importId],
      exec,
    );
    if (created.length > 0) {
      await assign(
        SYSTEM_ACTOR,
        {
          method: assignment.method,
          userId: assignment.userId ?? null,
          teamId: assignment.teamId ?? null,
          shares: assignment.shares ?? [],
          clauses: assignment.clauses ?? [],
          opportunityIds: created.map((row) => row.opportunity_id),
          reason: 'bulk import',
        },
        exec,
      );
    }
  }

  await execute(
    `UPDATE imports
        SET status = 'completed', finished_at = NOW(3),
            undo_deadline_at = DATE_ADD(NOW(3), INTERVAL ? HOUR)
      WHERE id = ?`,
    [UNDO_WINDOW_HOURS, importId],
    exec,
  );
  logger.info('import completed', { importId });
}

/** Kicks off the chunk loop. */
export async function startImport(importId: string): Promise<void> {
  await enqueue(
    'import.run_chunk',
    { importId },
    { priority: 5, dedupeKey: `import-chunk:${importId}` },
  );
}

/* ── Undo ─────────────────────────────────────────────────────────────── */

export interface UndoPreview {
  deletable: number;
  keptBecauseWorkedOn: number;
  expired: boolean;
}

/**
 * Has anyone worked on this contact since the import created them?
 *
 * The bar is deliberately low. Deleting a lead an agent has already called is
 * far worse than leaving a few rows behind, so anything that looks like human
 * attention protects the record:
 *   - any message on their conversation, in either direction;
 *   - any activity beyond the two the import itself writes;
 *   - any task;
 *   - the opportunity moved off the stage it was imported into;
 *   - the contact replied, so `last_inbound_at` is set;
 *   - they were added to a list or worked in a campaign.
 */
const WORKED_ON = `(
  EXISTS (SELECT 1 FROM conversations cv JOIN messages m ON m.conversation_id = cv.id WHERE cv.contact_id = ir.contact_id)
  OR EXISTS (SELECT 1 FROM activities a WHERE a.contact_id = ir.contact_id
               AND a.type NOT IN ('lead.created', 'lead.assigned'))
  OR EXISTS (SELECT 1 FROM tasks t WHERE t.contact_id = ir.contact_id)
  OR EXISTS (SELECT 1 FROM campaign_members cm WHERE cm.contact_id = ir.contact_id
               AND (cm.outcome IS NOT NULL OR cm.attempts > 0))
  OR EXISTS (SELECT 1 FROM list_members lm WHERE lm.contact_id = ir.contact_id)
  OR EXISTS (SELECT 1 FROM contacts c WHERE c.id = ir.contact_id AND c.last_inbound_at IS NOT NULL)
  OR EXISTS (SELECT 1 FROM opportunities o WHERE o.id = ir.opportunity_id
               AND (o.stage_key <> 'new_lead' OR o.first_touch_at IS NOT NULL))
)`;

export async function previewUndo(importId: string, exec: Executor = getPool()): Promise<UndoPreview> {
  const record = await queryOne<{ undo_deadline_at: Date | null; undone_at: Date | null }>(
    'SELECT undo_deadline_at, undone_at FROM imports WHERE id = ?',
    [importId],
    exec,
  );
  const expired =
    !record ||
    record.undone_at !== null ||
    record.undo_deadline_at === null ||
    record.undo_deadline_at.getTime() < Date.now();

  const counts = await queryOne<{ deletable: number; kept: number }>(
    `SELECT
       SUM(CASE WHEN NOT ${WORKED_ON} THEN 1 ELSE 0 END) AS deletable,
       SUM(CASE WHEN ${WORKED_ON} THEN 1 ELSE 0 END) AS kept
     FROM import_rows ir
     WHERE ir.import_id = ? AND ir.status = 'created' AND ir.contact_id IS NOT NULL`,
    [importId],
    exec,
  );

  return {
    deletable: Number(counts?.deletable ?? 0),
    keptBecauseWorkedOn: Number(counts?.kept ?? 0),
    expired,
  };
}

/**
 * Takes an import back.
 *
 * Only contacts this import *created* — never one it merely updated, which
 * existed before and would take an agent's history with it — and only those
 * nobody has worked on. Everything else is left in place and reported.
 */
export async function undoImport(
  actor: AuditActor,
  importId: string,
  exec: Executor = getPool(),
): Promise<{ deleted: number; kept: number }> {
  const preview = await previewUndo(importId, exec);
  if (preview.expired) {
    throw new Error(`An import can only be undone within ${UNDO_WINDOW_HOURS} hours`);
  }

  const rows = await query<{ contact_id: string }>(
    `SELECT ir.contact_id FROM import_rows ir
      WHERE ir.import_id = ? AND ir.status = 'created' AND ir.contact_id IS NOT NULL
        AND NOT ${WORKED_ON}`,
    [importId],
    exec,
  );

  let deleted = 0;
  for (const row of rows) {
    // Contacts cascade to their opportunities, conversations, tags and
    // consents; import_rows.contact_id is ON DELETE SET NULL, so the row keeps
    // its history of what happened.
    const result = await execute('DELETE FROM contacts WHERE id = ?', [row.contact_id], exec);
    deleted += result.affectedRows;
  }

  await execute("UPDATE imports SET status = 'undone', undone_at = NOW(3) WHERE id = ?", [importId], exec);
  await writeAudit(
    {
      actor,
      action: 'import.undone',
      entityType: 'import',
      entityId: importId,
      after: { deleted, keptBecauseWorkedOn: preview.keptBecauseWorkedOn },
    },
    exec,
  );

  logger.info('import undone', { importId, deleted, kept: preview.keptBecauseWorkedOn });
  return { deleted, kept: preview.keptBecauseWorkedOn };
}
