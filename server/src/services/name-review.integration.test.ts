import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { findSuspectNames, repairNames } from './name-review.js';
import { newId } from '../lib/ids.js';
import type { AuditActor } from '../audit/audit.js';

const actor = (id: string): AuditActor => ({ userId: id, role: 'manager' });

async function addContact(name: string | null, ownerId: string, phone: string): Promise<string> {
  const id = newId();
  await execute(
    'INSERT INTO contacts (id, full_name, phone_e164, owner_user_id, first_source) VALUES (?, ?, ?, ?, ?)',
    [id, name, phone, ownerId, 'csv_import'],
  );
  return id;
}

describeWithDb('repairing names that are not names', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
  });
  afterAll(async () => {
    await closeTestDatabase();
  });
  beforeEach(async () => {
    await resetTables();
  });

  it('finds the form answers and leaves the real names alone', async () => {
    const manager = await createTestUser({ role: 'manager' });

    await addContact('Matio Caetano', manager.id, '+971500000001');
    await addContact('Paulo de A. L. Neto', manager.id, '+971500000002');
    await addContact('أحمد الهاشمي', manager.id, '+971500000003');
    await addContact('Ahmed', manager.id, '+971500000004');
    const bad1 = await addContact('2pm / 6pm', manager.id, '+971500000005');
    const bad2 = await addContact('Katalog', manager.id, '+971500000006');
    const bad3 = await addContact(
      'I am on holiday till 25.05 and have time. From 9 am to 8 pm ( Cyprus time)',
      manager.id, '+971500000007',
    );
    const bad4 = await addContact('asdasdasd', manager.id, '+971500000008');
    // A contact with no name at all is not a problem to be fixed.
    await addContact(null, manager.id, '+971500000009');

    const suspects = await findSuspectNames(null);
    expect(suspects.map((s) => s.id).sort()).toEqual([bad1, bad2, bad3, bad4].sort());
    // Every one carries the reason, so the screen can explain itself.
    for (const suspect of suspects) expect(suspect.reason).toBeTruthy();
  });

  it('clears the name and keeps the text on the timeline', async () => {
    const manager = await createTestUser({ role: 'manager' });
    const id = await addContact('2pm / 6pm', manager.id, '+971500000010');

    const result = await repairNames(actor(manager.id), [id], null);
    expect(result).toEqual({ repaired: 1, skipped: 0 });

    const after = await query<{ full_name: string | null }>(
      'SELECT full_name FROM contacts WHERE id = ?', [id],
    );
    expect(after[0]?.full_name).toBeNull();

    // Nothing is destroyed: the answer is on the record.
    const activities = await query<{ title: string; body: string }>(
      'SELECT title, body FROM activities WHERE contact_id = ?', [id],
    );
    expect(activities[0]?.body).toMatch(/2pm \/ 6pm/);

    const audit = await query<{ action: string }>(
      'SELECT action FROM audit_log WHERE entity_id = ?', [id],
    );
    expect(audit.map((a) => a.action)).toContain('contact.name_repaired');
  });

  /*
   * The important guard. The screen is a list read at one moment and applied at
   * another; in between, an agent may have typed the customer's real name in.
   * Re-checking at apply time is what stops this feature destroying the very
   * thing it exists to produce.
   */
  it('will not clear a name somebody has since corrected by hand', async () => {
    const manager = await createTestUser({ role: 'manager' });
    const id = await addContact('Katalog', manager.id, '+971500000011');

    // The list was taken... and then an agent fixed it.
    await execute('UPDATE contacts SET full_name = ? WHERE id = ?', ['Mehmet Yilmaz', id]);

    const result = await repairNames(actor(manager.id), [id], null);
    expect(result).toEqual({ repaired: 0, skipped: 1 });

    const after = await query<{ full_name: string | null }>(
      'SELECT full_name FROM contacts WHERE id = ?', [id],
    );
    expect(after[0]?.full_name).toBe('Mehmet Yilmaz');
  });

  it('only touches contacts the viewer can see', async () => {
    const mine = await createTestUser({ role: 'manager' });
    const theirs = await createTestUser({ role: 'agent' });
    const otherTeam = await addContact('Katalog', theirs.id, '+971500000012');

    // Scoped to this manager's own contacts only.
    const suspects = await findSuspectNames([mine.id]);
    expect(suspects).toHaveLength(0);

    const result = await repairNames(actor(mine.id), [otherTeam], [mine.id]);
    expect(result).toEqual({ repaired: 0, skipped: 0 });

    const after = await query<{ full_name: string | null }>(
      'SELECT full_name FROM contacts WHERE id = ?', [otherTeam],
    );
    expect(after[0]?.full_name).toBe('Katalog');
  });

  it('does nothing when given an empty list', async () => {
    const manager = await createTestUser({ role: 'manager' });
    expect(await repairNames(actor(manager.id), [], null)).toEqual({ repaired: 0, skipped: 0 });
  });
});
