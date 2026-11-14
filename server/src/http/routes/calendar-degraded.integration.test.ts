import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { execute } from '../../db/client.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * The calendar on a database that is behind the code.
 *
 * On 14 Nov the live site answered "Internal server error" on every calendar
 * request, for every person, on every device, for days: the database was
 * stuck on migration 0038 and `meetings.booked_project` did not exist. The
 * migration is repaired, but a repair only helps once it has run, and a
 * blank month for ten people is too high a price for being right about
 * whose fault it is.
 *
 * So the booking columns are asked for separately and the screen survives
 * without them. This proves it, by removing those columns AFTER the harness
 * has migrated — the obvious version of this test, which drops them first,
 * proves nothing, because `prepareTestDatabase` migrates them straight back
 * and the suite goes green having tested the opposite of what it claims.
 */
let server: Server;
let base = '';

const BOOKED = [
  'result_by', 'booked_project', 'booked_unit', 'booked_price_aed',
  'booked_paid_aed', 'receipt_name',
];

describeWithDb('the calendar when the database is behind', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    /* Put them back, so a later file in the same database is not surprised. */
    for (const col of BOOKED) {
      await execute(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS ${col} VARCHAR(160) NULL`)
        .catch(() => execute(`ALTER TABLE meetings ADD COLUMN ${col} VARCHAR(160) NULL`).catch(() => {}));
    }
    setEnvForTesting(null);
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });
  beforeEach(async () => { await resetTables(); resetRateLimits(); });

  it('still answers when the booking columns are missing', async () => {
    for (const col of BOOKED) {
      await execute(`ALTER TABLE meetings DROP COLUMN ${col}`).catch(() => {});
    }
    /* Prove the premise: the column really is gone, so a pass here cannot be
       the harness having quietly migrated it back. */
    const { rows } = await import('../../db/client.js').then(async (db) => ({
      rows: await db.query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meetings'
            AND COLUMN_NAME = 'booked_project'`,
      ),
    }));
    expect(Number(rows[0]?.n ?? -1)).toBe(0);

    const user = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, user);
    const from = new Date('2026-11-01T00:00:00.000Z').toISOString();
    const to = new Date('2026-12-01T00:00:00.000Z').toISOString();
    const res = await fetch(`${base}/api/v2/calendar?from=${from}&to=${to}&scope=mine`, {
      headers: { cookie },
    });
    const text = await res.text();
    if (res.status !== 200) throw new Error(`${res.status}: ${text.slice(0, 400)}`);
    const body = JSON.parse(text) as { meetings: unknown[]; tasks: unknown[] };
    expect(Array.isArray(body.meetings)).toBe(true);
    expect(Array.isArray(body.tasks)).toBe(true);
  });
});
