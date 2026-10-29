import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { parentsFirst, postgresTables, type Queryable } from './copy-to-postgres.js';

/**
 * The order the live data is copied in.
 *
 * Every row has to arrive after the rows it points at. Get this wrong and the
 * copy dies halfway through a foreign key, leaving the new database holding
 * part of the business — which is the worst possible place to stop.
 *
 * Tested against the real schema, built from the real migration files in a
 * real Postgres, rather than against a hand-written example that would agree
 * with whatever the code happens to do.
 */
describe('copying the live data in a safe order', () => {
  let db: Queryable;
  let order: string[];
  let tables: Map<string, { name: string; isGenerated: boolean }[]>;

  beforeAll(async () => {
    const pg = await new PGlite();
    await pg.exec(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
      BEGIN NEW.updated_at = now(); RETURN NEW; END;
      $$ LANGUAGE plpgsql;
    `);
    for (const file of readdirSync('migrations-pg').filter((f) => f.endsWith('.sql')).sort()) {
      await pg.exec(readFileSync(`migrations-pg/${file}`, 'utf8'));
    }
    db = pg as unknown as Queryable;
    tables = await postgresTables(db) as typeof tables;
    order = await parentsFirst(db, [...tables.keys()]);
  }, 60_000);

  it('covers every table exactly once', () => {
    expect(order).toHaveLength(tables.size);
    expect(new Set(order).size).toBe(order.length);
  });

  /*
   * The property that actually matters, checked against every foreign key in
   * the schema rather than a few by hand. A self-reference is excluded: those
   * rows go in together and Postgres checks the constraint at the end of the
   * statement.
   */
  it('always places a parent before its children', async () => {
    const { rows } = await db.query(
      `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
         FROM pg_constraint c WHERE c.contype = 'f'`,
    );
    const position = new Map(order.map((t, i) => [t, i]));

    const wrong: string[] = [];
    for (const raw of rows) {
      const { child, parent } = raw as { child: string; parent: string };
      if (child === parent) continue;
      if (position.get(parent)! > position.get(child)!) wrong.push(`${child} before ${parent}`);
    }

    expect(wrong).toEqual([]);
    // A schema with no foreign keys would pass the above vacuously.
    expect(rows.length).toBeGreaterThan(50);
  });

  it('puts the tables everything else hangs off at the very start', () => {
    // contacts and opportunities carry most of the foreign keys in the system.
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('contacts'));
    expect(order.indexOf('contacts')).toBeLessThan(order.indexOf('opportunities'));
    expect(order.indexOf('opportunities')).toBeLessThan(order.indexOf('offers'));
  });

  it('reports a loop rather than guessing an order', async () => {
    const looped: Queryable = {
      query: async (text: string) => (
        text.includes('pg_constraint')
          ? { rows: [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }] }
          : { rows: [] }
      ),
    };

    await expect(parentsFirst(looped, ['a', 'b'])).rejects.toThrow(/loop/i);
  });

  /*
   * login_attempts has the schema's only auto-numbered id. Copying explicit
   * values into it needs OVERRIDING SYSTEM VALUE, and the sequence has to be
   * moved past them afterwards or the next sign-in collides.
   */
  it('notices the one table with an auto-numbered id', () => {
    const identity = [...tables.entries()]
      .filter(([, cols]) => cols.some((c) => c.isGenerated))
      .map(([table]) => table);

    expect(identity).toEqual(['login_attempts']);
  });
});
