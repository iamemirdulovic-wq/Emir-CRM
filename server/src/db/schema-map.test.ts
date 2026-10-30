import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSchema, findUnknownColumns } from './schema-map.js';

const MIGRATIONS = join(import.meta.dirname, '..', '..', 'migrations');
const SRC = join(import.meta.dirname, '..');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('reading the schema out of the migrations', () => {
  it('finds the columns of a created table', () => {
    const schema = buildSchema([`
      CREATE TABLE widgets (
        id CHAR(36) NOT NULL PRIMARY KEY,
        name VARCHAR(80) NOT NULL,
        created_at DATETIME(3) NOT NULL
      );`]);
    expect([...(schema.get('widgets') ?? [])]).toEqual(['id', 'name', 'created_at']);
  });

  it('does not mistake a key or a constraint for a column', () => {
    const schema = buildSchema([`
      CREATE TABLE widgets (
        id CHAR(36) NOT NULL PRIMARY KEY,
        owner_id CHAR(36) NULL,
        KEY idx_widget_owner (owner_id),
        UNIQUE KEY uq_widget (id),
        CONSTRAINT fk_widget_owner FOREIGN KEY (owner_id) REFERENCES users (id)
      );`]);
    expect([...(schema.get('widgets') ?? [])]).toEqual(['id', 'owner_id']);
  });

  it('does not mistake a comment for a column', () => {
    const schema = buildSchema([`
      CREATE TABLE widgets (
        -- the widget's own id
        id CHAR(36) NOT NULL PRIMARY KEY,
        /* a name, which people type */
        name VARCHAR(80) NULL
      );`]);
    expect([...(schema.get('widgets') ?? [])]).toEqual(['id', 'name']);
  });

  it('picks up a column added later', () => {
    const schema = buildSchema([
      'CREATE TABLE widgets (id CHAR(36) NOT NULL PRIMARY KEY);',
      'ALTER TABLE widgets ADD COLUMN colour VARCHAR(20) NULL;',
      'ALTER TABLE widgets ADD shape VARCHAR(20) NULL;',
    ]);
    expect(schema.get('widgets')).toContain('colour');
    expect(schema.get('widgets')).toContain('shape');
  });

  it('picks up every column of a multi-column ALTER, not just the first', () => {
    /* This is how `deleted_by_user_id` went missing and made the check cry
       wolf about the soft-delete code. */
    const schema = buildSchema([
      'CREATE TABLE widgets (id CHAR(36) NOT NULL PRIMARY KEY);',
      `ALTER TABLE widgets
         ADD COLUMN deleted_at DATETIME(3) NULL,
         ADD COLUMN deleted_by_user_id CHAR(36) NULL AFTER deleted_at;`,
    ]);
    expect(schema.get('widgets')).toContain('deleted_at');
    expect(schema.get('widgets')).toContain('deleted_by_user_id');
  });

  it('treats a column actually called `key` as a column', () => {
    /* `pipelines` and `workflows` both have one. */
    const schema = buildSchema([
      'CREATE TABLE pipelines (id CHAR(36) NOT NULL, `key` VARCHAR(48) NOT NULL, name VARCHAR(80) NULL);',
    ]);
    expect(schema.get('pipelines')).toContain('key');
    expect(findUnknownColumns('INSERT INTO pipelines (id, `key`, name) VALUES (?, ?, ?)', schema))
      .toEqual([]);
  });

  it('still ignores an index line that starts with KEY', () => {
    const schema = buildSchema([`
      CREATE TABLE widgets (
        id CHAR(36) NOT NULL,
        owner_id CHAR(36) NULL,
        KEY idx_widget_owner (owner_id)
      );`]);
    expect([...(schema.get('widgets') ?? [])]).toEqual(['id', 'owner_id']);
  });

  it('ignores an ADD KEY, which adds an index and not a column', () => {
    const schema = buildSchema([
      'CREATE TABLE widgets (id CHAR(36) NOT NULL);',
      'ALTER TABLE widgets ADD KEY idx_widget (id);',
    ]);
    expect([...(schema.get('widgets') ?? [])]).toEqual(['id']);
  });

  it('handles a type whose definition contains a comma', () => {
    const schema = buildSchema([`
      CREATE TABLE widgets (
        id CHAR(36) NOT NULL PRIMARY KEY,
        size DECIMAL(10,2) NOT NULL,
        kind ENUM('small','large') NOT NULL
      );`]);
    expect([...(schema.get('widgets') ?? [])]).toEqual(['id', 'size', 'kind']);
  });

  it('handles IF NOT EXISTS and backticks', () => {
    const schema = buildSchema(['CREATE TABLE IF NOT EXISTS `widgets` (`id` CHAR(36) NOT NULL);']);
    expect(schema.get('widgets')).toContain('id');
  });
});

describe('catching a query that names a column that is not there', () => {
  const schema = buildSchema([
    'CREATE TABLE users (id CHAR(36), name VARCHAR(160), email VARCHAR(255), phone_e164 VARCHAR(32));',
  ]);

  it('catches the mistake that prompted this check', () => {
    /* `phone` instead of `phone_e164` — it type-checks, and it would have
       signed every client email with the company name. */
    const found = findUnknownColumns('SELECT name, email, phone FROM users WHERE id = ?', schema);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ table: 'users', column: 'phone' });
  });

  it('passes a query that is right', () => {
    expect(findUnknownColumns('SELECT name, email, phone_e164 FROM users WHERE id = ?', schema))
      .toEqual([]);
  });

  it('catches it in an INSERT', () => {
    const found = findUnknownColumns('INSERT INTO users (id, name, nickname) VALUES (?, ?, ?)', schema);
    expect(found.map((p) => p.column)).toEqual(['nickname']);
  });

  it('catches it in an UPDATE', () => {
    const found = findUnknownColumns('UPDATE users SET name = ?, nickname = ? WHERE id = ?', schema);
    expect(found.map((p) => p.column)).toEqual(['nickname']);
  });

  it('says nothing about a table it has never heard of', () => {
    expect(findUnknownColumns('SELECT anything FROM tmp_scratch', schema)).toEqual([]);
  });

  it('skips a query with a join, where a column could come from either side', () => {
    expect(findUnknownColumns(
      'SELECT u.name, c.anything FROM users u JOIN contacts c ON c.id = u.id', schema,
    )).toEqual([]);
  });

  it('skips expressions rather than guessing at them', () => {
    expect(findUnknownColumns(
      "SELECT COUNT(*) AS n, COALESCE(name, 'x') AS label FROM users", schema,
    )).toEqual([]);
  });

  it('skips SELECT *', () => {
    expect(findUnknownColumns('SELECT * FROM users', schema)).toEqual([]);
  });

  it('reads an aliased column by its real name', () => {
    expect(findUnknownColumns('SELECT name AS who FROM users', schema)).toEqual([]);
    expect(findUnknownColumns('SELECT nickname AS who FROM users', schema).map((p) => p.column))
      .toEqual(['nickname']);
  });
});

describe('every query in the server', () => {
  const schema = buildSchema(migrationFiles().map((f) => readFileSync(join(MIGRATIONS, f), 'utf8')));
  const files = sourceFiles(SRC);

  it('read a real schema from the migrations', () => {
    expect(schema.size).toBeGreaterThan(50);
    expect(schema.get('users')).toContain('phone_e164');
    expect(schema.get('contacts')).toContain('full_name');
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))(
    'names only columns that exist, in %s',
    (_name, path) => {
      const problems = findUnknownColumns(readFileSync(path as string, 'utf8'), schema);
      expect(
        problems.map((p) => `${p.table}.${p.column} does not exist — in: ${p.snippet}`),
      ).toEqual([]);
    },
  );
});
