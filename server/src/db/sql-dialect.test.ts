import { describe, expect, it } from 'vitest';
import { countPlaceholders, toPositional } from './sql-dialect.js';

/**
 * Every query in the CRM passes through this. A `?` turned into the wrong
 * number does not crash — it asks a different question and returns a confident
 * wrong answer, which on a lead board means showing one agent another agent's
 * buyers. So the awkward cases are tested, not assumed.
 */
describe('rewriting placeholders for Postgres', () => {
  it('numbers them in order', () => {
    expect(toPositional('SELECT * FROM contacts WHERE id = ? AND owner_user_id = ?'))
      .toBe('SELECT * FROM contacts WHERE id = $1 AND owner_user_id = $2');
  });

  it('leaves a statement with no placeholders alone', () => {
    expect(toPositional('SELECT COUNT(*) FROM contacts')).toBe('SELECT COUNT(*) FROM contacts');
  });

  /* The whole reason this is a parser and not a `.replace()`. */
  it('does not touch a question mark inside a string', () => {
    expect(toPositional("SELECT * FROM t WHERE note = 'who?' AND id = ?"))
      .toBe("SELECT * FROM t WHERE note = 'who?' AND id = $1");
  });

  it('handles a doubled quote inside a string', () => {
    expect(toPositional("SELECT 'it''s here? really' , ? FROM t"))
      .toBe("SELECT 'it''s here? really' , $1 FROM t");
  });

  /* "key" is a column name in pipelines and workflows, and is quoted. */
  it('does not touch a question mark inside a quoted identifier', () => {
    expect(toPositional('SELECT "odd?name" FROM t WHERE id = ?'))
      .toBe('SELECT "odd?name" FROM t WHERE id = $1');
  });

  it('ignores one inside a line comment', () => {
    expect(toPositional('SELECT 1 -- why? because\nWHERE id = ?'))
      .toBe('SELECT 1 -- why? because\nWHERE id = $1');
  });

  it('ignores one inside a block comment, including a nested one', () => {
    expect(toPositional('SELECT /* what? /* really? */ */ ? FROM t'))
      .toBe('SELECT /* what? /* really? */ */ $1 FROM t');
  });

  it('ignores one inside a dollar-quoted body', () => {
    const sql = "CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RAISE NOTICE 'eh?'; END; $$ LANGUAGE plpgsql";
    expect(toPositional(sql)).toBe(sql);
  });

  /*
   * The shape the identity-resolution code actually sends: a long statement
   * with many placeholders, one of them inside a LIKE pattern.
   */
  it('numbers a real statement correctly', () => {
    const sql = `SELECT c.id FROM contacts c
       JOIN opportunities o ON o.contact_id = c.id
      WHERE (c.full_name LIKE ? OR c.phone_e164 LIKE ?)
        AND o.owner_user_id IN (?,?,?)
        AND o.created_at > ?
      LIMIT ?`;

    const out = toPositional(sql);

    expect(out).toContain('LIKE $1 OR c.phone_e164 LIKE $2');
    expect(out).toContain('IN ($3,$4,$5)');
    expect(out).toContain('created_at > $6');
    expect(out.trimEnd().endsWith('LIMIT $7')).toBe(true);
    expect(countPlaceholders(sql)).toBe(7);
  });

  it('counts what a statement needs, so a mismatch is caught early', () => {
    expect(countPlaceholders('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(2);
    expect(countPlaceholders("SELECT * FROM t WHERE a = 'x?'")).toBe(0);
  });

  /* An unterminated quote is malformed SQL; it must not loop forever. */
  it('gives up cleanly on an unterminated string', () => {
    expect(() => toPositional("SELECT * FROM t WHERE a = 'oops")).not.toThrow();
  });
});
