import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { execute, queryOne } from '../../db/client.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { loadEnv, setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * Pictures on the team wall, from upload to <img>.
 *
 * `wall_posts.media` has held a list of descriptors since the wall was built
 * and the API has always accepted them; nothing could put a file on the
 * server, so the feature had never actually run. These drive the whole way
 * through — upload, post, read back, fetch the bytes — because the parts that
 * matter here are the ones no unit test sees:
 *
 *   - the allow-list is on the **content type the request declares**, so a
 *     .exe renamed to .gif is still refused;
 *   - the stored file is named after its row, never after what the uploader
 *     typed, so `../../etc/passwd` is a filename and not a path;
 *   - a signed-out request gets nothing, including the bytes.
 */
let server: Server;
let base = '';
let uploads = '';

/* The smallest real GIF: 1x1, transparent. */
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

describeWithDb('pictures on the wall', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    uploads = await mkdtemp(path.join(tmpdir(), 'wall-media-'));
    setEnvForTesting({ ...loadEnv(process.env), UPLOAD_DIR: uploads });
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setEnvForTesting(null);
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
    await rm(uploads, { recursive: true, force: true });
  });

  beforeEach(async () => { await resetTables(); resetRateLimits(); });
  afterEach(() => resetRateLimits());

  async function upload(cookie: string, type: string, filename: string, body: Buffer) {
    return fetch(`${base}/api/wall/media`, {
      method: 'POST',
      headers: { cookie, 'content-type': type, 'x-filename': encodeURIComponent(filename) },
      body: new Uint8Array(body),
    });
  }

  it('takes a GIF, stores it, and gives it back', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));

    const res = await upload(cookie, 'image/gif', 'celebration.gif', GIF);
    expect(res.status).toBe(201);
    const saved = await res.json() as { id: string; url: string; name: string };
    expect(saved.url).toBe(`/api/wall/media/${saved.id}`);
    expect(saved.name).toBe('celebration.gif');

    const back = await fetch(`${base}${saved.url}`, { headers: { cookie } });
    expect(back.status).toBe(200);
    expect(back.headers.get('content-type')).toContain('image/gif');
    expect(Buffer.from(await back.arrayBuffer()).equals(GIF)).toBe(true);
  });

  /* The whole point of the upload: a post that carries it. */
  it('comes back on the post that used it', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));
    const saved = await (await upload(cookie, 'image/gif', 'site.gif', GIF)).json() as
      { id: string; url: string; kind: string; name: string };

    const posted = await fetch(`${base}/api/wall`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Site visit this morning', media: [saved] }),
    });
    expect(posted.status).toBeLessThan(300);

    const feed = await (await fetch(`${base}/api/wall`, { headers: { cookie } })).json() as
      { items: Array<{ body: string | null; media: unknown }> };
    const mine = feed.items.find((row) => row.body === 'Site visit this morning');
    expect(mine).toBeDefined();
    const media = (typeof mine?.media === 'string' ? JSON.parse(mine.media) : mine?.media) as
      Array<{ url: string }>;
    expect(media[0]?.url).toBe(saved.url);
  });

  it('refuses a type that is not a picture', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));
    // A PDF is a fine attachment on a task and is not something you look at
    // on a wall; the point is that the list is an allow-list either way.
    const res = await upload(cookie, 'application/pdf', 'price-list.pdf', Buffer.from('%PDF-'));
    expect(res.status).toBe(400);
  });

  /* Renaming the file does not change what the request says it is. */
  it('goes by the declared type, not the extension', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));
    const res = await upload(cookie, 'application/x-msdownload', 'harmless.gif', Buffer.from('MZ'));
    expect(res.status).toBe(400);
  });

  it('names the stored file after its row, not after the uploader', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));
    const saved = await (await upload(cookie, 'image/png', '../../etc/passwd', GIF)).json() as
      { id: string };

    const row = await queryOne<{ storage_path: string; filename: string }>(
      'SELECT storage_path, filename FROM wall_media WHERE id = ?', [saved.id],
    );
    expect(row?.storage_path).toBe(path.join(uploads, 'wall', `${saved.id}.png`));
    // Kept for display, and it is only ever displayed.
    expect(row?.filename).toBe('../../etc/passwd');
  });

  it('refuses an empty file', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));
    expect((await upload(cookie, 'image/png', 'nothing.png', Buffer.alloc(0))).status).toBe(400);
  });

  it('gives a signed-out request nothing, bytes included', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));
    const saved = await (await upload(cookie, 'image/gif', 'x.gif', GIF)).json() as { url: string };

    expect((await upload('', 'image/gif', 'x.gif', GIF)).status).toBe(401);
    expect((await fetch(`${base}${saved.url}`)).status).toBe(401);
  });

  /*
   * A stored path that resolves outside the upload directory is never opened,
   * however it got into the row. Nothing writes one today; the check is there
   * because the day something does, the alternative is this CRM serving
   * whatever that path names.
   */
  it('will not serve a row pointing outside the upload directory', async () => {
    const cookie = await signIn(base, await createTestUser({ role: 'agent' }));
    const saved = await (await upload(cookie, 'image/gif', 'x.gif', GIF)).json() as
      { id: string; url: string };

    await execute('UPDATE wall_media SET storage_path = ? WHERE id = ?',
      ['/etc/passwd', saved.id]);
    expect((await fetch(`${base}${saved.url}`, { headers: { cookie } })).status).toBe(404);
  });
});
