import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAuth,
} from '../middleware/auth.js';
import { assertCanViewContact } from '../../services/contacts.js';
import { visibleUserIds } from '../../auth/scope.js';
import {
  addNote, contactOfNote, listNotes, NOTE_TYPES, restoreNote, updateNote,
} from '../../leads/notes.js';
import {
  ALLOWED_TYPES, deleteNoteFile, filesForNotes, findNoteFile, openNoteFile, saveNoteFile,
} from '../../leads/note-files.js';
import { baseContentType, isInlineSafe, AUDIO_TYPES, IMAGE_TYPES } from '../../lib/uploads.js';
import { contentDisposition, decodeFilename } from './tasks.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { writeAudit } from '../../audit/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { env } from '../../config/env.js';

/**
 * Notes on a lead.
 *
 * Every route checks that the caller may see the lead first, using the same
 * helper the lead page uses. Notes are the most candid thing in the CRM —
 * what a client actually said about money — so there is no path to one that
 * does not go through that check.
 */
export const notesRouter = Router();
notesRouter.use(requireAuth, blockUntilPasswordChanged);

notesRouter.get(
  '/:contactId',
  asyncHandler(async (req: Request, res: Response) => {
    const contactId = String(req.params.contactId);
    await assertCanViewContact(contactId, await visibleUserIds(currentUser(req)));
    const items = await listNotes(contactId);
    res.json({ items, files: await filesForNotes(items.map((note) => note.id)) });
  }),
);

const addSchema = z.object({
  opportunityId: z.string().max(36).nullable().optional(),
  type: z.enum(NOTE_TYPES).optional(),
  body: z.string().min(1).max(5000),
  pinned: z.boolean().optional(),
  attachments: z.array(z.object({
    url: z.string().max(500),
    name: z.string().max(200),
    mime: z.string().max(100),
    size: z.number().int().nonnegative(),
  })).max(5).optional(),
  remindAt: z.string().nullable().optional(),
});

notesRouter.post(
  '/:contactId',
  asyncHandler(async (req: Request, res: Response) => {
    const contactId = String(req.params.contactId);
    await assertCanViewContact(contactId, await visibleUserIds(currentUser(req)));
    const body = addSchema.parse(req.body);
    res.status(201).json(await addNote(actorFrom(req), { contactId, ...body }));
  }),
);


/**
 * The lead a note belongs to, and the check that the caller may see it.
 *
 * A note id on its own is not authority to touch the note: without this, an
 * agent could pin or restore a note on a colleague's client just by knowing
 * the id. Every route below that changes anything goes through here.
 */
async function assertMayTouchNote(req: Request, noteId: string): Promise<string> {
  const contactId = await contactOfNote(noteId);
  if (!contactId) throw notFound('That note does not exist');
  await assertCanViewContact(contactId, await visibleUserIds(currentUser(req)));
  return contactId;
}

const patchSchema = z.object({
  body: z.string().min(1).max(5000).optional(),
  pinned: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

notesRouter.patch(
  '/item/:noteId',
  asyncHandler(async (req: Request, res: Response) => {
    const noteId = String(req.params.noteId);
    await assertMayTouchNote(req, noteId);
    const ok = await updateNote(actorFrom(req), noteId, patchSchema.parse(req.body));
    res.json({ ok });
  }),
);

/** The undo behind the toast. */
notesRouter.post(
  '/item/:noteId/restore',
  asyncHandler(async (req: Request, res: Response) => {
    const noteId = String(req.params.noteId);
    await assertMayTouchNote(req, noteId);
    res.json({ ok: await restoreNote(actorFrom(req), noteId) });
  }),
);

/* ── Files and voice notes ──────────────────────────────────────────────── */

/** Uploads write to disk, so they get their own budget, keyed per user. */
const uploadLimit = rateLimit({
  max: 60,
  windowMs: 10 * 60 * 1000,
  keyFor: (req) => `note-file:${currentUser(req).id}`,
  message: 'Too many uploads in a short time. Please wait a few minutes.',
});

/**
 * The body is the file itself, with its name and type in headers — the same
 * shape the task and import uploads use, and for the same reason: no multipart
 * parser and no buffering a whole request twice.
 *
 * A voice note arrives here too, straight from MediaRecorder, with its length
 * in `x-duration-seconds` because only the browser knows it.
 */
notesRouter.post(
  '/item/:noteId/files',
  uploadLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const noteId = String(req.params.noteId);
    const contactId = await assertMayTouchNote(req, noteId);

    const contentType = baseContentType(req.get('content-type') ?? '');
    if (!ALLOWED_TYPES.includes(contentType)) {
      throw badRequest(
        `${contentType || 'That file'} cannot be attached to a note. `
        + 'Images, PDF and voice recordings only.',
      );
    }

    const limit = env().MAX_ATTACHMENT_MB * 1024 * 1024;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) {
        throw badRequest(`That file is larger than the ${env().MAX_ATTACHMENT_MB} MB limit`);
      }
      chunks.push(chunk as Buffer);
    }

    const seconds = Number(req.get('x-duration-seconds'));
    const file = await saveNoteFile({
      noteId,
      contactId,
      filename: decodeFilename(req.get('x-filename')),
      contentType,
      body: Buffer.concat(chunks),
      durationSeconds: Number.isFinite(seconds) ? seconds : null,
      uploadedByUserId: user.id,
    });

    await writeAudit({
      actor: actorFrom(req),
      action: file.kind === 'voice' ? 'note.voice_added' : 'note.file_added',
      entityType: 'contact',
      entityId: contactId,
      after: { noteId, fileId: file.id, filename: file.filename, bytes: file.byte_size },
    });

    res.status(201).json(file);
  }),
);

/**
 * Serving an uploaded file back.
 *
 * Authenticated and scoped through the lead, never served statically: a
 * guessable public URL would make every voice note in the CRM readable by
 * anyone who found one link.
 */
notesRouter.get(
  '/files/:fileId',
  asyncHandler(async (req: Request, res: Response) => {
    const row = await findNoteFile(String(req.params.fileId));
    await assertCanViewContact(row.contact_id, await visibleUserIds(currentUser(req)));

    const stream = await openNoteFile(row);
    res.setHeader('Content-Type', row.content_type);
    res.setHeader('Content-Length', String(row.byte_size));
    /*
     * Images and audio play in the page; a PDF downloads. A PDF shown inline
     * runs in the CRM's own origin, and there is no reason to give a file
     * somebody uploaded that much reach.
     */
    res.setHeader(
      'Content-Disposition',
      contentDisposition(
        isInlineSafe(row.content_type, { ...IMAGE_TYPES, ...AUDIO_TYPES }) ? 'inline' : 'attachment',
        row.filename,
      ),
    );
    // Private: the browser may keep it, a proxy may not.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    stream.pipe(res);
  }),
);

notesRouter.delete(
  '/files/:fileId',
  asyncHandler(async (req: Request, res: Response) => {
    const row = await findNoteFile(String(req.params.fileId));
    await assertCanViewContact(row.contact_id, await visibleUserIds(currentUser(req)));
    await deleteNoteFile(row);
    await writeAudit({
      actor: actorFrom(req),
      action: 'note.file_removed',
      entityType: 'contact',
      entityId: row.contact_id,
      before: { fileId: row.id, filename: row.filename },
    });
    res.json({ ok: true });
  }),
);
