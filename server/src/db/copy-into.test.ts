import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { copyInto, type Queryable, type SourceDatabase } from './copy-to-postgres.js';

/**
 * The copy, run for real.
 *
 * This is the one step of the move with no way back: it runs once, against the
 * owner's only copy of every lead, on a server nobody is watching. The source
 * is a stand-in because there is no MySQL here, but everything downstream of it
 * is the real thing — the real schema, a real Postgres, the real batching,
 * the real JSON handling, the real count that decides whether the copy is
 * allowed to call itself finished.
 */

/** A source that answers from rows held in memory. */
function sourceOf(tables: Record<string, Array<Record<string, unknown>>>): SourceDatabase {
  return {
    count: async (table) => (tables[table] ?? []).length,
    rows: async (table, columns) =>
      (tables[table] ?? []).map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null]))),
    close: async () => undefined,
  };
}

const ROLE = 'agent';

function user(n: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `user-${n}`,
    name: `Agent ${n}`,
    email: `agent${n}@example.ae`,
    role: ROLE,
    password_hash: 'x',
    password_algo: 'bcrypt',
    must_change_password: 0,
    is_active: 1,
    availability: 'available',
    routing_weight: 10,
    locale: 'en',
    failed_login_count: 0,
    created_at: '2026-01-02 03:04:05',
    updated_at: '2026-01-02 03:04:05',
    ...over,
  };
}

describe('copying the live data into Postgres', () => {
  let pg: Queryable & { exec: (sql: string) => Promise<unknown> };

  beforeEach(async () => {
    const db = await new PGlite();
    for (const file of readdirSync('migrations-pg').filter((f) => f.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(`migrations-pg/${file}`, 'utf8'));
    }
    pg = db as unknown as typeof pg;
  }, 60_000);

  const rowsOf = async (sql: string) => (await pg.query(sql)).rows as Array<Record<string, unknown>>;
  /** The single number a COUNT/MAX query returns. */
  const numberOf = async (sql: string): Promise<number> => Number(Object.values((await rowsOf(sql))[0] ?? {})[0]);

  it('copies rows across and proves the counts match', async () => {
    await copyInto(sourceOf({ users: [user(1), user(2)] }), pg);

    const rows = await rowsOf('SELECT id, name, email FROM users ORDER BY id');
    expect(rows).toEqual([
      { id: 'user-1', name: 'Agent 1', email: 'agent1@example.ae' },
      { id: 'user-2', name: 'Agent 2', email: 'agent2@example.ae' },
    ]);
  }, 60_000);

  /*
   * mysql2 parses a JSON column into an object; jsonb wants text. Left alone
   * it arrives as "[object Object]" — which inserts without complaint and is
   * only noticed later, when an agent's languages or an event's raw payload
   * turns out to be gibberish.
   */
  it('keeps JSON columns as JSON rather than stringifying the object', async () => {
    await copyInto(sourceOf({
      users: [
        user(1, { languages: ['en', 'ar'], projects_covered: { ids: [7] } }),
        user(2, { languages: null }),
      ],
    }), pg);

    const rows = await rowsOf('SELECT id, languages, projects_covered FROM users ORDER BY id');
    expect(rows[0]).toEqual({ id: 'user-1', languages: ['en', 'ar'], projects_covered: { ids: [7] } });
    expect(rows[1]).toEqual({ id: 'user-2', languages: null, projects_covered: null });
  }, 60_000);

  /* A JSON column that already arrives as text must not be double-encoded. */
  it('leaves JSON that is already text alone', async () => {
    await copyInto(sourceOf({ users: [user(1, { languages: '["ru"]' })] }), pg);
    expect((await rowsOf('SELECT languages FROM users'))[0]).toEqual({ languages: ['ru'] });
  }, 60_000);

  /*
   * More rows than fit in one INSERT. The batch size exists because Postgres
   * caps the parameters in a single statement, and users is a wide table.
   */
  it('copies a table larger than one batch', async () => {
    const many = Array.from({ length: 1_250 }, (_, i) => user(i));
    await copyInto(sourceOf({ users: many }), pg);

    expect(await numberOf('SELECT COUNT(*) AS n FROM users')).toBe(1_250);
  }, 120_000);

  /*
   * login_attempts is the schema's only auto-numbered id. Copying explicit
   * values into it needs OVERRIDING SYSTEM VALUE, and the sequence has to be
   * moved past them or the next sign-in collides with a copied row.
   */
  it('carries the auto-numbered ids over and moves the sequence past them', async () => {
    await copyInto(sourceOf({
      login_attempts: [
        { id: 41, email: 'a@example.ae', ip: '1.1.1.1', successful: 1, created_at: '2026-01-01 00:00:00' },
        { id: 42, email: 'b@example.ae', ip: null, successful: 0, created_at: '2026-01-01 00:00:00' },
      ],
    }), pg);

    expect(await rowsOf('SELECT id FROM login_attempts ORDER BY id'))
      .toEqual([{ id: 41 }, { id: 42 }]);

    // The next sign-in must not collide with a copied row.
    await pg.query("INSERT INTO login_attempts (email, successful) VALUES ('c@example.ae', 0)");
    expect(await numberOf('SELECT MAX(id) AS max FROM login_attempts')).toBeGreaterThan(42);
  }, 60_000);

  /*
   * The guard that matters most. A second run would double every lead, and
   * there is no clean way back from that.
   */
  it('refuses a database that already holds rows', async () => {
    await copyInto(sourceOf({ users: [user(1)] }), pg);

    await expect(copyInto(sourceOf({ users: [user(2)] }), pg))
      .rejects.toThrow(/already holds rows/i);

    expect(await numberOf('SELECT COUNT(*) AS n FROM users')).toBe(1);
  }, 60_000);

  it('empties first when told to replace, and does not double', async () => {
    await copyInto(sourceOf({ users: [user(1)] }), pg);
    await copyInto(sourceOf({ users: [user(2), user(3)] }), pg, { replace: true });

    expect(await rowsOf('SELECT id FROM users ORDER BY id'))
      .toEqual([{ id: 'user-2' }, { id: 'user-3' }]);
  }, 60_000);

  it('copies nothing when asked only to check', async () => {
    await copyInto(sourceOf({ users: [user(1)] }), pg, { check: true });

    expect(await numberOf('SELECT COUNT(*) AS n FROM users')).toBe(0);
  }, 60_000);

  /*
   * A source that under-reports its own rows is the quiet failure this is all
   * guarding against: the copy looks like it worked and leads are missing.
   */
  it('fails loudly when the counts do not match afterwards', async () => {
    const lying: SourceDatabase = {
      ...sourceOf({ users: [user(1)] }),
      count: async () => 9,
    };

    await expect(copyInto(lying, pg)).rejects.toThrow(/do not match/i);
  }, 60_000);
});
