import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { loadEnv, setEnvForTesting } from '../config/env.js';
import { createProject } from './project-library.js';
import {
  deletePhoto, findPhoto, listDocuments, listPhotos, saveDocument, savePhoto, setCover,
} from './project-files.js';
import type { AuditActor } from '../audit/audit.js';

const owner = (id: string): AuditActor => ({ userId: id, role: 'owner' });
const png = () => Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let uploads = '';

describeWithDb('a project\'s photos and documents', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });

  beforeEach(async () => {
    await resetTables();
    // A directory per test, so nothing written here touches the real one.
    uploads = await mkdtemp(path.join(tmpdir(), 'emir-files-'));
    setEnvForTesting({ ...loadEnv(process.env), UPLOAD_DIR: uploads });
  });

  afterEach(async () => {
    setEnvForTesting(null);
    await rm(uploads, { recursive: true, force: true });
  });

  async function project(): Promise<{ id: string; userId: string }> {
    const user = await createTestUser({ role: 'owner' });
    const id = await createProject(owner(user.id), {
      name: 'Sei Saadiyat', developer: 'ALDAR', emirate: 'abu_dhabi',
    });
    return { id, userId: user.id };
  }

  it('stores a photo and makes the first one the cover', async () => {
    const { id, userId } = await project();

    const first = await savePhoto(owner(userId), {
      projectId: id, filename: 'pool.png', contentType: 'image/png', body: png(),
    });
    const second = await savePhoto(owner(userId), {
      projectId: id, filename: 'lobby.png', contentType: 'image/png', body: png(),
    });

    expect(first.is_cover).toBe(1);
    // A later photo must not take the cover from under the user.
    expect(second.is_cover).toBe(0);
    expect(await listPhotos(id)).toHaveLength(2);
  });

  /*
   * The file is named after the row, never after what the uploader typed —
   * otherwise a filename is a path, and a path is a way out of the directory.
   */
  it('names the file on disk after its row, not after the upload', async () => {
    const { id, userId } = await project();

    const photo = await savePhoto(owner(userId), {
      projectId: id, filename: '../../etc/passwd.png', contentType: 'image/png', body: png(),
    });

    const files = await readdir(path.join(uploads, 'projects'));
    expect(files).toEqual([`${photo.id}.png`]);
    // The name the user gave is kept as a label, and only as a label.
    expect(photo.filename).toBe('../../etc/passwd.png');
  });

  /*
   * An SVG is a document that can carry script. Served from the CRM's own
   * origin it would run with the session cookie in scope, so it is refused
   * although it is an image.
   */
  it('refuses a type it will not serve back safely', async () => {
    const { id, userId } = await project();

    await expect(savePhoto(owner(userId), {
      projectId: id, filename: 'x.svg', contentType: 'image/svg+xml', body: png(),
    })).rejects.toThrow(/JPEG, PNG or WebP/);

    await expect(saveDocument(owner(userId), {
      projectId: id, kind: 'other', filename: 'x.html', contentType: 'text/html',
      body: png(), uploadedByUserId: userId,
    })).rejects.toThrow(/cannot be stored/);
  });

  it('refuses an empty file', async () => {
    const { id, userId } = await project();

    await expect(savePhoto(owner(userId), {
      projectId: id, filename: 'nothing.png', contentType: 'image/png', body: Buffer.alloc(0),
    })).rejects.toThrow(/empty/);
  });

  it('moves the cover, keeping exactly one', async () => {
    const { id, userId } = await project();
    const first = await savePhoto(owner(userId), { projectId: id, filename: 'a.png', contentType: 'image/png', body: png() });
    const second = await savePhoto(owner(userId), { projectId: id, filename: 'b.png', contentType: 'image/png', body: png() });

    await setCover(owner(userId), second.id);

    const rows = await listPhotos(id);
    expect(rows.filter((row) => row.is_cover === 1).map((row) => row.id)).toEqual([second.id]);
    expect(rows.find((row) => row.id === first.id)?.is_cover).toBe(0);
  });

  /* A project must never be left holding photos and no cover. */
  it('hands the cover to another photo when the cover is deleted', async () => {
    const { id, userId } = await project();
    const first = await savePhoto(owner(userId), { projectId: id, filename: 'a.png', contentType: 'image/png', body: png() });
    await savePhoto(owner(userId), { projectId: id, filename: 'b.png', contentType: 'image/png', body: png() });

    await deletePhoto(owner(userId), await findPhoto(first.id));

    const rows = await listPhotos(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_cover).toBe(1);
  });

  it('takes the file off disk when the row goes', async () => {
    const { id, userId } = await project();
    const photo = await savePhoto(owner(userId), { projectId: id, filename: 'a.png', contentType: 'image/png', body: png() });

    await deletePhoto(owner(userId), await findPhoto(photo.id));

    expect(await readdir(path.join(uploads, 'projects'))).toEqual([]);
  });

  it('stores a document under the kind it was filed as', async () => {
    const { id, userId } = await project();

    await saveDocument(owner(userId), {
      projectId: id, kind: 'developer_offer', filename: 'offer.pdf',
      contentType: 'application/pdf', body: Buffer.from('%PDF-1.4'), uploadedByUserId: userId,
    });

    const rows = await listDocuments(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'developer_offer', filename: 'offer.pdf' });
  });

  it('writes every add and removal to the audit log', async () => {
    const { id, userId } = await project();
    const photo = await savePhoto(owner(userId), { projectId: id, filename: 'a.png', contentType: 'image/png', body: png() });
    await deletePhoto(owner(userId), await findPhoto(photo.id));

    const actions = await query<{ action: string }>(
      "SELECT action FROM audit_log WHERE entity_id = ? AND action LIKE 'project.photo%' ORDER BY created_at",
      [id],
    );
    expect(actions.map((row) => row.action)).toEqual(['project.photo_added', 'project.photo_removed']);
  });
});
