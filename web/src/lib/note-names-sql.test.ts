import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIKE_TERMS } from './note-names.js';

/**
 * The server's query still looks for everything the rule can flag.
 *
 * There are two halves to the owner's list of note-names: a SQL query that
 * fetches candidates and the rule in `note-names.ts` that decides which of
 * them really are notes. The decision is in one place on purpose — the
 * dialler's greeting reads the same function — but the query is written in
 * SQL in the server workspace and cannot import it.
 *
 * So the one thing that can drift is the net. Adding a word to `NOTE_WORDS`
 * without adding it to the query means a lead the rule would flag is never
 * fetched, and the list quietly says "none" about a name Emir is looking at.
 * Nothing on screen would show it. This does.
 *
 * If it fails: paste the missing term into `LIKE_TERMS` in
 * `server/src/http/routes/note-names.ts`. Do not narrow the rule to match the
 * query.
 */
const REPO = path.join(import.meta.dirname, '..', '..', '..');
const ROUTE = 'server/src/http/routes/note-names.ts';

describe('the note-name query and the note-name rule', () => {
  const sql = readFileSync(path.join(REPO, ROUTE), 'utf8');

  it('reads the route that fetches the candidates', () => {
    expect(sql).toContain('const LIKE_TERMS');
    expect(sql).toContain('c.full_name LIKE ?');
  });

  it('looks for every term the rule can flag', () => {
    const missing = LIKE_TERMS.filter((term) => !sql.includes(`'${term}'`));
    expect(missing).toEqual([]);
  });

  it('stays read-only — nothing on this address changes a lead', () => {
    /* §G.2: "Do not change them yourself." The screen has no way to, and
       neither has the server. */
    expect(sql).not.toMatch(/\.(post|patch|put|delete)\(/);
    expect(sql).not.toMatch(/\b(UPDATE\s+\w|INSERT\s+INTO|DELETE\s+FROM)/);
  });
});
