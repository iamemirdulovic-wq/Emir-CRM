import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';

/**
 * Probe once for a reachable database and record the answer in the environment,
 * so `describeWithDb` can decide synchronously inside each test file.
 *
 * This also gives the run its own database, and that part is not a nicety.
 *
 * Every integration test calls `resetTables()`, which TRUNCATEs the whole
 * schema. `vitest.config.ts` keeps the files inside one run from overlapping
 * (`singleFork`), but nothing stopped two *runs* from sharing one database —
 * two terminals, a watch process, a colleague on the same MySQL, several
 * agents on one box. When that happens, one run empties `users` and
 * `sessions` in the middle of another run's test, and the symptom is a user
 * that was created two lines earlier failing to sign in, or a cookie that
 * suddenly resolves to nobody. A different test every time, and passing when
 * run on its own. It cost a day to find.
 *
 * So the name of the database is now the run's own, derived from the process
 * id and the clock, created here and dropped again at the end. Setting
 * `TEST_DB_NAME` yourself still wins: that is how you point a run at a
 * database you want to keep and inspect afterwards.
 */

/** How this harness names a database it made for one run, and only ever that. */
const RUN_DB_PREFIX = 'emir_crm_run_';
const RUN_DB_NAME = /^emir_crm_run_(\d+)_(\d+)_[0-9a-f]{4}$/;

/**
 * When a run's database counts as abandoned and may be dropped by the next
 * run. Generous on purpose: a killed run leaves its database behind, and the
 * only thing worse than a stale database is dropping one out from under a
 * suite that is still using it. The full suite has been seen take an hour on
 * a busy machine; six is well clear of that, and an abandoned database costs
 * nothing but disk until the next run sweeps it.
 */
const ABANDONED_AFTER_MS = 6 * 60 * 60 * 1000;

/** The database this run made, and is therefore allowed to drop. */
let owned: string | null = null;

function connectionOptions(): mysql.ConnectionOptions {
  return {
    host: process.env.TEST_DB_HOST ?? process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.TEST_DB_PORT ?? process.env.DB_PORT ?? 3306),
    user: process.env.TEST_DB_USER ?? process.env.DB_USER ?? 'root',
    password: process.env.TEST_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
    connectTimeout: 3000,
  };
}

function runDatabaseName(): string {
  const startedAt = Math.floor(Date.now() / 1000);
  return `${RUN_DB_PREFIX}${process.pid}_${startedAt}_${randomBytes(2).toString('hex')}`;
}

/**
 * Drop the databases left behind by runs that were killed before they could
 * tidy up. Only names this harness generates are ever considered, so a
 * hand-made `emir_crm_test` — or anything else on the server — is untouched.
 */
async function dropAbandoned(conn: mysql.Connection): Promise<void> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>('SHOW DATABASES');
  const now = Date.now();

  for (const row of rows) {
    const name = String(Object.values(row)[0] ?? '');
    if (name === owned) continue;
    const match = RUN_DB_NAME.exec(name);
    if (!match) continue;
    const startedAt = Number(match[2]) * 1000;
    if (now - startedAt < ABANDONED_AFTER_MS) continue;
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
      process.stdout.write(`  dropped an abandoned test database: ${name}\n`);
    } catch {
      /* Another run may have got there first, or may still hold it. Leave it. */
    }
  }
}

/**
 * Say so, loudly, when a database named with `TEST_DB_NAME` already has
 * somebody connected to it.
 *
 * Naming the database yourself turns the per-run isolation off, which is the
 * point of the setting — but then nothing stops a second run joining the same
 * one and truncating its tables mid-test. That failure is silent and reads
 * like a bug in the code under test, so it is worth a line of output. A
 * warning rather than a refusal: a sleeping connection left by a crashed run
 * looks the same from here, and that must not stop anybody working.
 */
async function warnIfInUse(conn: mysql.Connection, name: string): Promise<void> {
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM information_schema.processlist WHERE db = ? AND id <> CONNECTION_ID()',
      [name],
    );
    const others = Number(rows[0]?.n ?? 0);
    if (!others) return;
    process.stdout.write(
      `\n  TEST_DB_NAME=${name} already has ${others} other connection(s).\n` +
        '  If that is another test run, both will truncate these tables and both\n' +
        '  will fail in ways that look like bugs. Unset TEST_DB_NAME to get a\n' +
        '  database of your own.\n\n',
    );
  } catch {
    /* No PROCESS privilege, most likely. Not worth failing a run over. */
  }
}

export async function setup(): Promise<void> {
  // The logger reads process.env directly, so quieten it for the whole run.
  process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'error';

  if (process.env.SKIP_DB_TESTS === '1') {
    process.env.__EMIR_DB_AVAILABLE__ = '0';
    return;
  }
  let conn: mysql.Connection;
  try {
    conn = await mysql.createConnection(connectionOptions());
  } catch {
    process.env.__EMIR_DB_AVAILABLE__ = '0';
    process.stdout.write(
      '\n  No database reachable — integration suites will be skipped.\n' +
        '  Set TEST_DB_HOST / TEST_DB_USER / TEST_DB_PASSWORD to run them.\n\n',
    );
    return;
  }

  try {
    /*
     * A name the caller asked for is theirs: use it as it is, and leave it
     * alone afterwards. Otherwise this run gets its own, so no other run can
     * truncate the tables out from under it.
     *
     * Forked workers inherit `process.env` as it stands when they start,
     * which is after this file has run — the same channel that has always
     * carried `__EMIR_DB_AVAILABLE__` into them.
     */
    if (process.env.TEST_DB_NAME) {
      await warnIfInUse(conn, process.env.TEST_DB_NAME);
    } else {
      await claimOwnDatabase(conn);
    }
    /*
     * The server answered, so the suites run. Deliberately not inside the
     * attempt above: a user who cannot CREATE a database can still run every
     * test against `emir_crm_test`, and reporting that as "no database" would
     * skip 269 integration tests and call the run green.
     */
    process.env.__EMIR_DB_AVAILABLE__ = '1';
  } finally {
    await conn.end();
  }
}

/** Make this run its own database, or say why it could not and carry on. */
async function claimOwnDatabase(conn: mysql.Connection): Promise<void> {
  const name = runDatabaseName();
  try {
    await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (err) {
    process.stdout.write(
      `\n  Could not make this run its own database (${err instanceof Error ? err.message : String(err)}).\n` +
        '  Falling back to emir_crm_test. That is shared, so a second test run\n' +
        "  against this server will empty these tables in the middle of this run's\n" +
        '  tests. Grant CREATE to the test user, or set TEST_DB_NAME.\n\n',
    );
    return;
  }
  owned = name;
  process.env.__EMIR_TEST_DB__ = name;
  try {
    await dropAbandoned(conn);
  } catch {
    /* Tidying up after other runs is a courtesy, not a reason to fail this one. */
  }
}

/**
 * Give the run's database back. Only ever the one this run created: a
 * database named with `TEST_DB_NAME` is the caller's to keep.
 */
export async function teardown(): Promise<void> {
  if (!owned) return;
  const name = owned;
  owned = null;
  try {
    const conn = await mysql.createConnection(connectionOptions());
    try {
      await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
    } finally {
      await conn.end();
    }
  } catch {
    /* A database left behind is a nuisance, not a failed test run. The next
       run's sweep clears it. */
  }
}
