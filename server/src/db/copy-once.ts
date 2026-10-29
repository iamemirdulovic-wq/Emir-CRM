/**
 * Move the live data into Postgres as part of a deploy.
 *
 * The CRM is deployed by pressing Deploy in the hosting panel, not from a
 * terminal, and the owner is not a developer. Asking them to SSH in and run a
 * copy by hand is the step most likely to go wrong, at the moment when going
 * wrong is most expensive. So the copy can run inside the deploy instead:
 * set `COPY_FROM_MYSQL_ONCE=1` alongside the Neon `DATABASE_URL`, keep the old
 * `DB_*` settings pointing at MySQL, and press Deploy.
 *
 * It runs after the migrations, which create the empty tables, and before the
 * reference seed, which would otherwise put rows in those tables and make the
 * database look as though it had already been filled.
 *
 * What it will not do:
 *
 *  - Copy into a database that already holds rows. Running twice would double
 *    every lead, and there is no clean way back from that. It warns and starts
 *    normally instead, so a later routine deploy with the flag still set is a
 *    no-op rather than a failure.
 *  - Start the server with an empty database when a copy was asked for and
 *    MySQL cannot be reached. Coming up empty looks exactly like losing
 *    everything, so it refuses and says why.
 *  - Write to MySQL. It only ever reads.
 */
import mysql from 'mysql2/promise';
import { Client } from 'pg';
import { env } from '../config/env.js';
import { logger, errorContext } from '../lib/logger.js';
import { isEntrypoint } from '../lib/entrypoint.js';
import { copyToPostgres, postgresTables } from './copy-to-postgres.js';

export type CopyDecision =
  | { act: 'skip'; reason: 'not_requested' }
  | { act: 'skip'; reason: 'already_populated' }
  | { act: 'copy' }
  | { act: 'refuse'; reason: 'no_database_url' }
  | { act: 'refuse'; reason: 'mysql_unreachable' };

/**
 * The whole decision, as a pure function, because this is the part that must
 * not be wrong: three of these four answers are quiet and one of them stops a
 * deploy, and the difference between them is a lead board that is full, empty,
 * or doubled.
 */
export function decideCopy(state: {
  requested: boolean;
  hasDatabaseUrl: boolean;
  postgresRows: number;
  mysqlReachable: boolean;
}): CopyDecision {
  if (!state.requested) return { act: 'skip', reason: 'not_requested' };
  if (!state.hasDatabaseUrl) return { act: 'refuse', reason: 'no_database_url' };
  // Checked before MySQL: once Postgres holds the data, MySQL being gone is
  // the expected steady state and not a problem to report.
  if (state.postgresRows > 0) return { act: 'skip', reason: 'already_populated' };
  if (!state.mysqlReachable) return { act: 'refuse', reason: 'mysql_unreachable' };
  return { act: 'copy' };
}

/** Rows across every table Postgres holds, stopping at the first one found. */
async function postgresRowCount(url: string): Promise<number> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const tables = await postgresTables(client);
    for (const table of tables.keys()) {
      const { rows } = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM "${table}"`);
      const n = Number(rows[0]?.n ?? 0);
      if (n > 0) return n;
    }
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function mysqlReachable(): Promise<boolean> {
  const cfg = env();
  if (!cfg.DB_HOST || !cfg.DB_NAME) return false;
  try {
    const conn = await mysql.createConnection({
      host: cfg.DB_HOST,
      port: cfg.DB_PORT,
      user: cfg.DB_USER,
      password: cfg.DB_PASSWORD,
      database: cfg.DB_NAME,
      connectTimeout: 8000,
    });
    await conn.end();
    return true;
  } catch (err) {
    logger.debug('MySQL did not answer', errorContext(err));
    return false;
  }
}

/** Exit code for the deploy: 0 carries on, 1 stops it. */
export async function copyOnce(): Promise<number> {
  const cfg = env();
  if (!cfg.COPY_FROM_MYSQL_ONCE) return 0;

  const url = process.env.DATABASE_URL ?? '';
  const decision = decideCopy({
    requested: true,
    hasDatabaseUrl: Boolean(url),
    postgresRows: url ? await postgresRowCount(url) : 0,
    mysqlReachable: url ? await mysqlReachable() : false,
  });

  switch (decision.act) {
    case 'skip':
      logger.warn(
        'COPY_FROM_MYSQL_ONCE is set but the database already holds data, so nothing was '
        + 'copied. This is the safe outcome — copying again would double every lead. Remove '
        + 'COPY_FROM_MYSQL_ONCE from the settings so later deploys do not have to check.',
      );
      return 0;

    case 'refuse':
      logger.error(
        decision.reason === 'no_database_url'
          ? 'COPY_FROM_MYSQL_ONCE is set but DATABASE_URL is empty, so there is nowhere to '
            + 'copy to. Paste the Neon connection string into DATABASE_URL and deploy again.'
          : 'COPY_FROM_MYSQL_ONCE is set and the new database is empty, but the old MySQL '
            + 'database did not answer. Starting now would look exactly like losing every '
            + 'lead, so this deploy is stopping instead. Check DB_HOST, DB_USER, DB_PASSWORD '
            + 'and DB_NAME still point at the old database, then deploy again.',
      );
      return 1;

    case 'copy':
      logger.info('copying the live data into the new database — this can take a few minutes');
      try {
        await copyToPostgres();
        logger.info(
          'the copy is done and verified. Remove COPY_FROM_MYSQL_ONCE from the settings now; '
          + 'leaving it does no harm, but there is no reason to check again on every deploy.',
        );
        return 0;
      } catch (err) {
        logger.error(
          'the copy failed, so this deploy is stopping rather than starting against a '
          + 'half-filled database. Nothing was written to the old database, which still has '
          + 'everything.',
          errorContext(err),
        );
        return 1;
      }
  }
}

if (isEntrypoint(import.meta.url)) {
  copyOnce()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      logger.error('the one-time copy could not run', errorContext(err));
      process.exit(1);
    });
}
