import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  TRUNCATE_ORDER, closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from './db.js';
import { execute, query } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { setEnvForTesting } from '../config/env.js';

/**
 * The reset between tests actually resets.
 *
 * `resetTables` used to TRUNCATE all hundred-odd tables every time, which was
 * most of an integration run's clock — four to six seconds a test, against
 * tests measured in milliseconds. It now asks in one query which tables hold
 * a row and empties those, remembering the answer for the rest of the run so
 * that a table which has ever been written to is emptied from then on whether
 * the probe catches anything in it or not.
 *
 * That is a saving worth having and a correctness claim worth checking, because
 * the damage from getting it wrong is the one `TRUNCATE_ORDER`'s own comments
 * warn about twice: a row left behind, and the failure landing on whichever
 * test happens to run next.
 *
 * `reset-complete.test.ts` checks the *list* against the migrations. This
 * checks the *behaviour* against a real database.
 */

/** Which tables hold a row right now — the same question the reset asks. */
async function holdingRows(): Promise<string[]> {
  const probe = TRUNCATE_ORDER
    .map((table) => `(SELECT '${table}' AS t FROM \`${table}\` LIMIT 1)`)
    .join(' UNION ALL ');
  const rows = await query<{ t: string }>(probe);
  return rows.map((row) => row.t).sort();
}

/**
 * Rows in four tables chosen for their variety rather than their meaning: the
 * two the sign-in path needs, the one every audited action writes, and the
 * settings table the reset has to clear first.
 */
async function writeSomethingEverywhere(): Promise<void> {
  const user = await createTestUser();
  await execute(
    'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
    [newId(), 'Reset Check', '+971500000111'],
  );
  await execute(
    'INSERT INTO audit_log (id, actor_user_id, action, entity_type) VALUES (?, ?, ?, ?)',
    [newId(), user.id, 'test.reset_check', 'test'],
  );
  await execute('INSERT INTO app_settings (name, value) VALUES (?, ?)', ['reset_check', 'x']);
}

const TOUCHED = ['app_settings', 'audit_log', 'contacts', 'users'];

/** The one table the reset re-seeds after emptying, so it is never empty after. */
const SEEDED = ['form_field_map'];

describeWithDb('the reset between tests', () => {
  beforeAll(prepareTestDatabase);
  afterAll(async () => {
    setEnvForTesting(null);
    await closeTestDatabase();
  });
  beforeEach(() => resetTables());

  it('empties a table the first time anything has been written to it', async () => {
    const before = await holdingRows();
    for (const table of TOUCHED) expect(before, `${table} should start empty`).not.toContain(table);

    await writeSomethingEverywhere();
    for (const table of TOUCHED) expect(await holdingRows()).toContain(table);

    await resetTables();
    expect(await holdingRows(), 'every table emptied, bar the one the reset re-seeds').toEqual(SEEDED);
  });

  it('empties it again every time after that', async () => {
    /*
     * The second pass is the one that exercises the remembered set: these
     * tables have now been seen holding rows, so they are emptied on every
     * reset from here on whatever the probe finds.
     */
    await writeSomethingEverywhere();
    await resetTables();
    expect(await holdingRows()).toEqual(SEEDED);

    await writeSomethingEverywhere();
    await resetTables();
    expect(await holdingRows()).toEqual(SEEDED);
  });

  it('hands the next test a database with nothing of the last one in it', async () => {
    /* Whatever the test above left, `beforeEach` has dealt with by now. */
    expect(await holdingRows()).toEqual(SEEDED);
  });
});
