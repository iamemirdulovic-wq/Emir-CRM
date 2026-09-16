import { Router, type Request, type Response } from 'express';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { actorFrom, blockUntilPasswordChanged, currentUser, requireAuth, requireManager } from '../middleware/auth.js';
import { execute, query, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { badRequest } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { writeAudit } from '../../audit/audit.js';
import { toCsvRow } from '../../imports/csv.js';
import { kindFromFilename, previewRows, type FileKind } from '../../imports/rows.js';
import { suggestMappingWithAi } from '../../imports/mapping.js';
import { defaultSettings } from '../../imports/normalize.js';
import { previewUndo, stageRows, startImport, undoImport, UNDO_WINDOW_HOURS } from '../../imports/run.js';
import { loadCandidates, loadAssignable, previewPlan } from '../../assignment/apply.js';
import { distribute } from '../../assignment/distribute.js';

export const importsRouter = Router();
// A bulk import creates leads for a whole team, so it is a manager's action.
importsRouter.use(requireAuth, blockUntilPasswordChanged, requireManager);

/** Where an import's file lives on disk. */
function uploadPath(importId: string, kind: FileKind): string {
  return path.join(path.resolve(env().UPLOAD_DIR), `${importId}.${kind === 'xlsx' ? 'xlsx' : 'csv'}`);
}

/**
 * Step 1 — upload.
 *
 * The body is the file itself, streamed straight to disk. No multipart parser
 * and no buffering: a hundred-thousand-row export is tens of megabytes, and
 * holding it in memory to parse a MIME envelope would be the one place this
 * feature could fall over.
 */
importsRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const filename = String(req.get('x-filename') ?? 'import.csv').slice(0, 200);
    const kind = kindFromFilename(filename);
    if (!kind) throw badRequest('Upload a .csv or .xlsx file');

    const limitBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
    const declared = Number(req.get('content-length') ?? 0);
    if (declared > limitBytes) {
      throw badRequest(`That file is larger than the ${env().MAX_UPLOAD_MB} MB limit`);
    }

    const id = newId();
    const target = uploadPath(id, kind);
    await mkdir(path.dirname(target), { recursive: true });

    let written = 0;
    req.on('data', (chunk: Buffer) => {
      written += chunk.length;
      // A client can lie about content-length, so the real size is checked as
      // it arrives rather than trusted up front.
      if (written > limitBytes) req.destroy(new Error('upload too large'));
    });

    try {
      await pipeline(req, createWriteStream(target));
    } catch (err) {
      await unlink(target).catch(() => undefined);
      throw badRequest(`That file is larger than the ${env().MAX_UPLOAD_MB} MB limit`);
    }

    await execute(
      `INSERT INTO imports (id, filename, file_path, file_kind, byte_size, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, 'uploaded', ?)`,
      [id, filename, target, kind, written, currentUser(req).id],
    );

    const preview = await previewRows(target, kind, 20);
    const mapping = await suggestMappingWithAi(preview.headers);

    await execute('UPDATE imports SET headers = ?, mapping = ? WHERE id = ?', [
      JSON.stringify(preview.headers),
      JSON.stringify(mapping),
      id,
    ]);
    await writeAudit({
      actor: actorFrom(req),
      action: 'import.uploaded',
      entityType: 'import',
      entityId: id,
      after: { filename, bytes: written, kind },
    });

    res.status(201).json({
      id,
      filename,
      kind,
      bytes: written,
      headers: preview.headers,
      preview: preview.rows,
      suggestedMapping: mapping,
      defaults: defaultSettings(),
    });
  }),
);

/** Paste-from-sheet: the same wizard, with the rows in the request body. */
const pasteSchema = z.object({
  // The JSON body parser is capped at 2 MB, so a bigger paste would be
  // rejected by the parser with a less helpful message than this one.
  text: z.string().min(1).max(1_900_000),
  filename: z.string().max(200).default('Pasted rows'),
});

importsRouter.post(
  '/paste',
  asyncHandler(async (req: Request, res: Response) => {
    const body = pasteSchema.parse(req.body);
    const id = newId();
    const target = uploadPath(id, 'csv');
    await mkdir(path.dirname(target), { recursive: true });

    // Pasted cells are tab-separated; written as a file so everything after
    // this point is the one code path.
    const { writeFile } = await import('node:fs/promises');
    await writeFile(target, body.text, 'utf8');

    await execute(
      `INSERT INTO imports (id, filename, file_path, file_kind, byte_size, status, created_by_user_id)
       VALUES (?, ?, ?, 'paste', ?, 'uploaded', ?)`,
      [id, body.filename, target, Buffer.byteLength(body.text), currentUser(req).id],
    );

    const preview = await previewRows(target, 'csv', 20);
    const mapping = await suggestMappingWithAi(preview.headers);
    await execute('UPDATE imports SET headers = ?, mapping = ? WHERE id = ?', [
      JSON.stringify(preview.headers),
      JSON.stringify(mapping),
      id,
    ]);

    res.status(201).json({
      id,
      filename: body.filename,
      kind: 'paste',
      headers: preview.headers,
      preview: preview.rows,
      suggestedMapping: mapping,
      defaults: defaultSettings(),
    });
  }),
);

/** Steps 2–6 — the wizard saves its choices as it goes. */
const configureSchema = z.object({
  mapping: z.record(z.string(), z.string().nullable()).optional(),
  settings: z
    .object({
      sourceLabel: z.string().min(1).max(120),
      source: z.enum(['csv_import', 'manual', 'website', 'meta_lead_ads', 'google_ads']),
      tags: z.array(z.string().max(60)).max(20),
      projectName: z.string().max(160).nullable(),
      pipelineKey: z.string().max(48),
      stageKey: z.string().max(48),
      consent: z.enum(['opted_in', 'unknown', 'none']),
      duplicateStrategy: z.enum(['skip', 'fill_empty', 'create_anyway']),
      phoneRegion: z.string().length(2),
    })
    .optional(),
  assignment: z
    .object({
      method: z.enum(['agent', 'team_round_robin', 'split_even', 'split_percent', 'by_rule', 'pool']),
      userId: z.string().max(36).nullable().optional(),
      teamId: z.string().max(36).nullable().optional(),
      shares: z.array(z.object({ userId: z.string().max(36), percent: z.number().min(0).max(100) })).max(50).optional(),
      clauses: z
        .array(
          z.object({
            language: z.string().max(8).optional(),
            project: z.string().max(160).optional(),
            emirate: z.string().max(32).optional(),
            budgetMinAed: z.number().int().nonnegative().optional(),
            budgetMaxAed: z.number().int().nonnegative().optional(),
            userId: z.string().max(36),
          }),
        )
        .max(50)
        .optional(),
    })
    .optional(),
});

importsRouter.patch(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const body = configureSchema.parse(req.body);

    const patch: string[] = [];
    const args: unknown[] = [];
    if (body.mapping) {
      patch.push('mapping = ?');
      args.push(JSON.stringify(body.mapping));
    }
    if (body.settings) {
      patch.push('settings = ?');
      args.push(JSON.stringify(body.settings));
    }
    if (body.assignment) {
      patch.push('assignment = ?');
      args.push(JSON.stringify(body.assignment));
    }
    if (patch.length === 0) throw badRequest('Nothing to update');

    await execute(`UPDATE imports SET ${patch.join(', ')} WHERE id = ?`, [...args, id] as never[]);
    res.json({ ok: true });
  }),
);

/** Step 3 — stage the rows so the file's real size and shape are known. */
importsRouter.post(
  '/:id/validate',
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const total = await stageRows(id);
    res.json({ total });
  }),
);

/** Step 7 — run it. The wizard can be closed; the job carries on. */
importsRouter.post(
  '/:id/start',
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const record = await queryOne<{ status: string; settings: unknown }>(
      'SELECT status, settings FROM imports WHERE id = ?',
      [id],
    );
    if (!record) throw badRequest('That import does not exist');
    if (!record.settings) throw badRequest('Choose the import settings first');
    if (record.status === 'importing') return void res.json({ ok: true, alreadyRunning: true });

    await startImport(id);
    await writeAudit({ actor: actorFrom(req), action: 'import.started', entityType: 'import', entityId: id });
    res.json({ ok: true });
  }),
);

/** The progress bar polls this. */
importsRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const record = await queryOne<Record<string, unknown>>(
      `SELECT id, filename, file_kind, status, total_rows, processed_rows,
              created_count, updated_count, skipped_count, failed_count,
              headers, mapping, settings, assignment, error_message,
              started_at, finished_at, undo_deadline_at, undone_at, created_at
         FROM imports WHERE id = ?`,
      [id],
    );
    if (!record) throw badRequest('That import does not exist');

    const problems = await query<{ line_number: number; status: string; reason: string | null }>(
      `SELECT line_number, status, reason FROM import_rows
        WHERE import_id = ? AND status IN ('invalid','failed')
        ORDER BY line_number LIMIT 50`,
      [id],
    );

    res.json({ import: record, problems, undoWindowHours: UNDO_WINDOW_HOURS });
  }),
);

importsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const items = await query(
      `SELECT i.id, i.filename, i.status, i.total_rows, i.processed_rows,
              i.created_count, i.updated_count, i.skipped_count, i.failed_count,
              i.undo_deadline_at, i.undone_at, i.created_at, u.name AS created_by
         FROM imports i LEFT JOIN users u ON u.id = i.created_by_user_id
        ORDER BY i.created_at DESC LIMIT 50`,
    );
    res.json({ items });
  }),
);

/** The failed rows, as a CSV to fix and re-upload. */
importsRouter.get(
  '/:id/failed.csv',
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const record = await queryOne<{ filename: string; headers: unknown }>(
      'SELECT filename, headers FROM imports WHERE id = ?',
      [id],
    );
    if (!record) throw badRequest('That import does not exist');

    const headers = (typeof record.headers === 'string' ? JSON.parse(record.headers) : record.headers) as string[];
    const rows = await query<{ line_number: number; raw: unknown; reason: string | null }>(
      `SELECT line_number, raw, reason FROM import_rows
        WHERE import_id = ? AND status IN ('invalid','failed')
        ORDER BY line_number`,
      [id],
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="failed-rows-${id.slice(0, 8)}.csv"`);
    // The original columns plus why the row was rejected, so the file can be
    // corrected and uploaded again without any re-keying.
    res.write(toCsvRow(['Row', ...(headers ?? []), 'Why it failed']));
    for (const row of rows) {
      const values = (typeof row.raw === 'string' ? JSON.parse(row.raw) : row.raw) as string[];
      res.write(toCsvRow([row.line_number, ...values, row.reason ?? '']));
    }
    res.end();

    await writeAudit({
      actor: actorFrom(req),
      action: 'import.failed_rows_exported',
      entityType: 'import',
      entityId: id,
      after: { rows: rows.length },
    });
  }),
);

/** What an undo would remove, before anyone presses it. */
importsRouter.get(
  '/:id/undo',
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await previewUndo(String(req.params.id)));
  }),
);

importsRouter.post(
  '/:id/undo',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await undoImport(actorFrom(req), String(req.params.id));
    res.json(result);
  }),
);

/** Saved column mappings, so the next file from the same source is one click. */
importsRouter.get(
  '/mappings/all',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ items: await query('SELECT id, name, mapping, created_at FROM import_mappings ORDER BY name') });
  }),
);

importsRouter.post(
  '/mappings',
  asyncHandler(async (req: Request, res: Response) => {
    const body = z
      .object({ name: z.string().min(1).max(120), mapping: z.record(z.string(), z.string().nullable()) })
      .parse(req.body);
    const id = newId();
    await execute(
      `INSERT INTO import_mappings (id, name, mapping, created_by_user_id) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE mapping = VALUES(mapping)`,
      [id, body.name, JSON.stringify(body.mapping), currentUser(req).id],
    );
    res.status(201).json({ id });
  }),
);

/**
 * Step 6 — what the chosen assignment would do.
 *
 * Runs against the rows the import will create, so the owner sees the real
 * split and any overload warning before committing to it.
 */
const previewSchema = configureSchema.shape.assignment.unwrap();

importsRouter.post(
  '/:id/assignment-preview',
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const assignment = previewSchema.parse(req.body);

    const created = await query<{ opportunity_id: string }>(
      `SELECT opportunity_id FROM import_rows
        WHERE import_id = ? AND opportunity_id IS NOT NULL LIMIT 5000`,
      [id],
    );

    const candidates = await loadCandidates({ teamId: assignment.teamId ?? null });
    // Before the import runs there are no rows yet, so the preview is done
    // against placeholder leads — the counts are what matter at this stage.
    const total = created.length > 0
      ? await loadAssignable(created.map((row) => row.opportunity_id))
      : Array.from(
          { length: Number((await queryOne<{ n: number }>('SELECT total_rows AS n FROM imports WHERE id = ?', [id]))?.n ?? 0) },
          (_unused, index) => ({ id: `row-${index}`, language: null, projectName: null, emirate: null, budgetMaxAed: null }),
        );

    const plan = distribute({
      method: assignment.method,
      leads: total,
      candidates,
      userId: assignment.userId ?? null,
      shares: assignment.shares ?? [],
      clauses: assignment.clauses ?? [],
    });

    res.json({ leads: total.length, ...previewPlan(candidates, plan) });
  }),
);
