import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIVE_CONTACT, LIVE_CONTACT_BARE, LIVE_OPPORTUNITY, LIVE_OPPORTUNITY_BARE } from './deleted.js';

/**
 * Deleting a lead must never destroy one.
 *
 * Every foreign key into `contacts` cascades, so a single `DELETE FROM
 * contacts` takes the opportunities, the activities, the WhatsApp thread and
 * the notes an agent wrote after a viewing. This file is the standing guard
 * that no such statement comes back — including by someone reaching for the
 * obvious verb in six months' time.
 */

const SRC = join(import.meta.dirname, '..');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (name.endsWith('.ts') && !name.includes('.test.')) found.push(path);
  }
  return found;
}

/** Comments and strings describing the rule are not the rule being broken. */
function statementsOnly(code: string): string {
  return code.replace(/\/\/[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

const FILES = sourceFiles(SRC);

describe('nothing hard-deletes a lead', () => {
  it('reads the server source', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  /*
   * `db/demo.ts` is the only exception: it wipes and rebuilds a demo dataset
   * on a developer's own machine, and is never pointed at production.
   */
  const EXEMPT = ['db/demo.ts', 'testing/'];

  for (const file of FILES) {
    const relative = file.slice(SRC.length + 1);
    if (EXEMPT.some((allowed) => relative.startsWith(allowed))) continue;

    it(`${relative} does not DELETE a contact or an opportunity`, () => {
      const code = statementsOnly(readFileSync(file, 'utf8'));
      const hit = /DELETE\s+FROM\s+(contacts|opportunities)\b/i.exec(code);
      expect(
        hit,
        `${relative} contains "${hit?.[0]}". Deleting a lead must set deleted_at instead: `
          + 'every foreign key into contacts cascades, so this takes their whole history with them.',
      ).toBeNull();
    });
  }
});

describe('the fence constants', () => {
  /*
   * These strings are concatenated straight into SQL. A typo in one would not
   * fail to compile — it would quietly stop fencing, and deleted leads would
   * reappear in a list with nothing to show that anything was wrong.
   */
  it('are the exact predicates the queries need', () => {
    expect(LIVE_CONTACT).toBe('c.deleted_at IS NULL');
    expect(LIVE_CONTACT_BARE).toBe('contacts.deleted_at IS NULL');
    expect(LIVE_OPPORTUNITY).toBe('o.deleted_at IS NULL');
    expect(LIVE_OPPORTUNITY_BARE).toBe('opportunities.deleted_at IS NULL');
  });

  it('carry no placeholder, so they can never shift a parameter list', () => {
    for (const fence of [LIVE_CONTACT, LIVE_CONTACT_BARE, LIVE_OPPORTUNITY, LIVE_OPPORTUNITY_BARE]) {
      expect(fence).not.toContain('?');
    }
  });
});

describe('the screens a person browses are fenced', () => {
  const mustFence: { file: string; what: string }[] = [
    { file: 'http/routes/contacts.ts', what: 'the contacts list, the duplicate review and the export' },
    { file: 'http/routes/inbox.ts', what: 'the inbox threads' },
    { file: 'http/routes/incoming.ts', what: 'the incoming queue and its badge' },
    { file: 'http/routes/pipeline.ts', what: 'the unassigned queue' },
    { file: 'services/opportunities.ts', what: 'the pipeline board' },
    { file: 'lists/store.ts', what: 'lists and smart lists' },
  ];

  for (const { file, what } of mustFence) {
    it(`${what} excludes deleted leads`, () => {
      const code = readFileSync(join(SRC, file), 'utf8');
      expect(
        /deleted_at IS NULL|LIVE_CONTACT|LIVE_OPPORTUNITY/.test(code),
        `${file} reads leads for a person to browse but never excludes deleted ones.`,
      ).toBe(true);
    });
  }

  /*
   * And the one that must NOT be fenced. Identity resolution has to find a
   * deleted contact by phone, because the number is still unique in the table
   * — a second row for the same person would fail to insert. It revives the
   * old record instead, which keeps their history.
   */
  it('identity resolution still finds a deleted contact, so it can revive them', () => {
    const code = readFileSync(join(SRC, 'ingestion/identity.ts'), 'utf8');
    expect(code).toContain('reviveIfDeleted');
    const lookup = /SELECT id FROM contacts WHERE phone_e164 = \?[^`]*/.exec(code)?.[0] ?? '';
    expect(
      lookup.includes('deleted_at'),
      'The phone lookup in identity resolution must NOT filter deleted contacts: '
        + 'the number is unique, so a second row cannot be inserted. Revive instead.',
    ).toBe(false);
  });
});
