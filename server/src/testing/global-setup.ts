import mysql from 'mysql2/promise';

/**
 * Probe once for a reachable database and record the answer in the environment,
 * so `describeWithDb` can decide synchronously inside each test file.
 */
export async function setup(): Promise<void> {
  // The logger reads process.env directly, so quieten it for the whole run.
  process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'error';

  if (process.env.SKIP_DB_TESTS === '1') {
    process.env.__EMIR_DB_AVAILABLE__ = '0';
    return;
  }
  try {
    const conn = await mysql.createConnection({
      host: process.env.TEST_DB_HOST ?? process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.TEST_DB_PORT ?? process.env.DB_PORT ?? 3306),
      user: process.env.TEST_DB_USER ?? process.env.DB_USER ?? 'root',
      password: process.env.TEST_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '',
      connectTimeout: 3000,
    });
    await conn.end();
    process.env.__EMIR_DB_AVAILABLE__ = '1';
  } catch {
    process.env.__EMIR_DB_AVAILABLE__ = '0';
    process.stdout.write(
      '\n  No database reachable — integration suites will be skipped.\n' +
        '  Set TEST_DB_HOST / TEST_DB_USER / TEST_DB_PASSWORD to run them.\n\n',
    );
  }
}
