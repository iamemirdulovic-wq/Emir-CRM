import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute as run, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import type { Role } from '../auth/rbac.js';
import {
  createFolder, createOffer, deleteFolder, duplicateOffer, getOffer, listFolders, listOffers,
  purgeOffer, purgeStaleTrash, renameFolder, restoreOffer, trashOffer, updateOffer,
} from './offers.js';

/**
 * An offer carries a named client, the prices they were quoted and a link that
 * has no login in front of it. Whose offer it is therefore decides who may see
 * it, and that decision is taken in SQL from the session — which is what these
 * tests exist to hold in place.
 */
describeWithDb('the sales offers library', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); });

  /** An actor shaped the way the service wants it. */
  function actorFor(user: { id: string; role: string }) {
    return { id: user.id, role: user.role as Role, userId: user.id, label: null, ip: null, userAgent: null };
  }

  async function contact(name: string): Promise<string> {
    const id = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [id, name, `+9715${Math.floor(Math.random() * 100000000)}`],
    );
    return id;
  }

  /* ── The fence ────────────────────────────────────────────────────────── */

  it('shows an agent their own offers and nobody else\'s', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    await createOffer(actorFor(sara), { title: 'Sei Saadiyat · 2BR' });
    await createOffer(actorFor(omar), { title: 'Yas Acres · Townhouse' });

    const mine = await listOffers({ id: sara.id, role: 'agent' });

    expect(mine.map((row) => row.title)).toEqual(['Sei Saadiyat · 2BR']);
  });

  /*
   * The id is the obvious way round a list filter, so it gets its own test.
   * "Does not exist" rather than "not allowed": telling an agent an offer
   * exists but is someone else's confirms a client is being worked.
   */
  it('refuses another agent\'s offer by id, and does not admit it exists', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    const hers = await createOffer(actorFor(sara), { title: 'Sei Saadiyat · 2BR' });

    await expect(getOffer({ id: omar.id, role: 'agent' }, hers.id))
      .rejects.toMatchObject({ status: 404 });
  });

  it('refuses to trash, star or rename another agent\'s offer', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    const hers = await createOffer(actorFor(sara), { title: 'Sei Saadiyat · 2BR' });

    await expect(trashOffer(actorFor(omar), hers.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateOffer(actorFor(omar), hers.id, { starred: true })).rejects.toMatchObject({ status: 404 });
    await expect(updateOffer(actorFor(omar), hers.id, { title: 'Mine now' })).rejects.toMatchObject({ status: 404 });
    await expect(duplicateOffer(actorFor(omar), hers.id)).rejects.toMatchObject({ status: 404 });

    // Untouched.
    const still = await getOffer({ id: sara.id, role: 'agent' }, hers.id);
    expect(still.title).toBe('Sei Saadiyat · 2BR');
    expect(still.deleted_at).toBeNull();
  });

  it('gives a manager their team\'s offers, and an owner everyone\'s', async () => {
    const boss = await createTestUser({ role: 'manager', name: 'Boss' });
    const sara = await createTestUser({ role: 'agent', name: 'Sara', managerId: boss.id });
    const outsider = await createTestUser({ role: 'agent', name: 'Outsider' });
    const owner = await createTestUser({ role: 'owner', name: 'Owner' });

    await createOffer(actorFor(sara), { title: 'Sara offer' });
    await createOffer(actorFor(outsider), { title: 'Outsider offer' });

    const team = await listOffers({ id: boss.id, role: 'manager' });
    expect(team.map((row) => row.title)).toEqual(['Sara offer']);

    const all = await listOffers({ id: owner.id, role: 'owner' });
    expect(all.map((row) => row.title).sort()).toEqual(['Outsider offer', 'Sara offer']);
  });

  it('will not let an agent build an offer in someone else\'s name', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });

    await expect(createOffer(actorFor(sara), { title: 'Not mine', agentUserId: omar.id }))
      .rejects.toMatchObject({ status: 403 });
  });

  it('counts only the offers a viewer may see when it labels a folder', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    const folder = await createFolder(actorFor(sara), { name: 'Saadiyat Island' });
    await createOffer(actorFor(sara), { title: 'Hers', folderId: folder.id });
    await createOffer(actorFor(omar), { title: 'His', folderId: folder.id });

    const seen = await listFolders({ id: sara.id, role: 'agent' });
    const seenBySara = seen.find((row) => row.id === folder.id);

    // Two offers are in it; one is hers. A folder claiming "2 offers" and then
    // showing one looks like the CRM has lost something.
    expect(Number(seenBySara?.offer_count)).toBe(1);
  });

  /* ── The link ─────────────────────────────────────────────────────────── */

  it('gives every offer a long, unguessable link', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const one = await createOffer(actorFor(sara), { title: 'Sei Saadiyat · 2BR' });
    const two = await createOffer(actorFor(sara), { title: 'Sei Saadiyat · 2BR' });

    expect(one.slug).not.toBe(two.slug);
    expect(one.slug.startsWith('sei-saadiyat-2br-')).toBe(true);
    // The random tail is what keeps the page private, so it is checked, not
    // assumed: 16 bytes of base64url is 22 characters.
    const tail = one.slug.slice('sei-saadiyat-2br-'.length);
    expect(tail).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  /* ── Trash ────────────────────────────────────────────────────────────── */

  it('keeps a trashed offer out of the library and brings it back on restore', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const offer = await createOffer(actorFor(sara), { title: 'Sei Saadiyat · 2BR' });

    await trashOffer(actorFor(sara), offer.id);
    expect(await listOffers({ id: sara.id, role: 'agent' })).toHaveLength(0);
    expect(await listOffers({ id: sara.id, role: 'agent' }, { filter: 'trash' })).toHaveLength(1);

    await restoreOffer(actorFor(sara), offer.id);
    expect(await listOffers({ id: sara.id, role: 'agent' })).toHaveLength(1);
  });

  it('lets only the owner or an admin delete for good, and only from the trash', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const owner = await createTestUser({ role: 'owner', name: 'Owner' });
    const offer = await createOffer(actorFor(sara), { title: 'Sei Saadiyat · 2BR' });

    // Not from the library — the trash is the safety net.
    await expect(purgeOffer(actorFor(owner), offer.id)).rejects.toMatchObject({ status: 400 });

    await trashOffer(actorFor(sara), offer.id);
    await expect(purgeOffer(actorFor(sara), offer.id)).rejects.toMatchObject({ status: 403 });

    await purgeOffer(actorFor(owner), offer.id);
    expect(await listOffers({ id: owner.id, role: 'owner' }, { filter: 'trash' })).toHaveLength(0);
  });

  it('empties the trash after thirty days and leaves fresher offers alone', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const old = await createOffer(actorFor(sara), { title: 'Long gone' });
    const recent = await createOffer(actorFor(sara), { title: 'Yesterday' });
    await trashOffer(actorFor(sara), old.id);
    await trashOffer(actorFor(sara), recent.id);
    await run('UPDATE offers SET deleted_at = DATE_SUB(NOW(), INTERVAL 31 DAY) WHERE id = ?', [old.id]);

    expect(await purgeStaleTrash()).toBe(1);

    const left = await listOffers({ id: sara.id, role: 'agent' }, { filter: 'trash' });
    expect(left.map((row) => row.title)).toEqual(['Yesterday']);
  });

  /* ── Folders ──────────────────────────────────────────────────────────── */

  it('allows one level of nesting and no more', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const top = await createFolder(actorFor(sara), { name: 'Saadiyat Island' });
    const inner = await createFolder(actorFor(sara), { name: 'VIP', parentId: top.id });

    await expect(createFolder(actorFor(sara), { name: 'Deeper', parentId: inner.id }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('keeps the shared Templates folder read-only for an agent', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const owner = await createTestUser({ role: 'owner', name: 'Owner' });
    const templates = await createFolder(actorFor(owner), { name: 'Templates' });
    await run('UPDATE offer_folders SET is_shared = 1 WHERE id = ?', [templates.id]);

    await expect(renameFolder(actorFor(sara), templates.id, 'Mine')).rejects.toMatchObject({ status: 403 });
    await expect(deleteFolder(actorFor(sara), templates.id)).rejects.toMatchObject({ status: 403 });
    await expect(createOffer(actorFor(sara), { title: 'Into templates', folderId: templates.id }))
      .rejects.toMatchObject({ status: 403 });

    // She can still read it — that is the point of a templates folder.
    const folders = await listFolders({ id: sara.id, role: 'agent' });
    expect(folders.map((row) => row.name)).toContain('Templates');
  });

  /*
   * Deleting a folder must never delete a client's offer with it. The offers
   * come back to the top level instead.
   */
  it('returns the offers to the top level when their folder is deleted', async () => {
    const owner = await createTestUser({ role: 'owner', name: 'Owner' });
    const folder = await createFolder(actorFor(owner), { name: 'Saadiyat Island' });
    const offer = await createOffer(actorFor(owner), { title: 'Sei Saadiyat · 2BR', folderId: folder.id });

    await deleteFolder(actorFor(owner), folder.id);

    const survivor = await getOffer({ id: owner.id, role: 'owner' }, offer.id);
    expect(survivor.folder_id).toBeNull();
  });

  /* ── The card's state ─────────────────────────────────────────────────── */

  it('reads Draft, Sent, Opened and Reading now from the views rather than a column', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const offer = await createOffer(actorFor(sara), { title: 'Sei Saadiyat · 2BR' });
    const mine = async () => {
      const [row] = await listOffers({ id: sara.id, role: 'agent' });
      if (!row) throw new Error('the offer vanished from the library');
      return row;
    };

    expect((await mine()).state).toBe('draft');

    await run("UPDATE offers SET status = 'sent', sent_at = NOW(3) WHERE id = ?", [offer.id]);
    expect((await mine()).state).toBe('sent');

    // Opened ten minutes ago: read, but nobody is on it now.
    await run(
      `INSERT INTO offer_views (id, offer_id, opened_at, last_seen_at, duration_secs)
       VALUES (?, ?, DATE_SUB(NOW(3), INTERVAL 10 MINUTE), DATE_SUB(NOW(3), INTERVAL 10 MINUTE), 252)`,
      [newId(), offer.id],
    );
    const opened = await mine();
    expect(opened.state).toBe('opened');
    expect(Number(opened.opens)).toBe(1);
    expect(Number(opened.total_secs)).toBe(252);

    // Still on the page.
    await run(
      `INSERT INTO offer_views (id, offer_id, duration_secs) VALUES (?, ?, 20)`,
      [newId(), offer.id],
    );
    expect((await mine()).state).toBe('reading');
  });

  it('copies the held units but not the client\'s reading history', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const buyer = await contact('Ahmed Khan');
    const offer = await createOffer(actorFor(sara), { title: 'Sei Saadiyat · 2BR', contactId: buyer });
    await run(
      `INSERT INTO offer_units (id, offer_id, unit_no, price_aed) VALUES (?, ?, '1204', 1850000)`,
      [newId(), offer.id],
    );
    await run(
      `INSERT INTO offer_views (id, offer_id, duration_secs) VALUES (?, ?, 240)`,
      [newId(), offer.id],
    );

    const copy = await duplicateOffer(actorFor(sara), offer.id);

    expect(copy.title).toBe('Sei Saadiyat · 2BR (copy)');
    expect(copy.slug).not.toBe(offer.slug);
    expect(copy.state).toBe('draft');
    expect(Number(copy.opens)).toBe(0);
    const units = await queryOne<{ n: number; price: number }>(
      'SELECT COUNT(*) AS n, MAX(price_aed) AS price FROM offer_units WHERE offer_id = ?', [copy.id],
    );
    expect(Number(units?.n)).toBe(1);
    expect(Number(units?.price)).toBe(1850000);
  });
});
