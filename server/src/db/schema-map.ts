/**
 * What columns each table actually has, read from the migrations.
 *
 * Hand-written SQL does not fail at compile time. A query naming a column
 * that was renamed, or never existed, type-checks perfectly and throws in
 * production — or worse, sits inside a `catch` and quietly degrades for
 * months. That happened here: a signature query asked `users` for `phone`
 * when the column is `phone_e164`, which would have signed every client
 * email with the company name instead of the agent's.
 *
 * The migrations are the only description of the schema this repository has,
 * so they are the thing to read.
 */

export type Schema = Map<string, Set<string>>;

const CREATE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z_][a-z0-9_]*)`?\s*\(/gi;
/* One ALTER may carry several ADDs, separated by commas:
     ALTER TABLE contacts
       ADD COLUMN deleted_at DATETIME(3) NULL,
       ADD COLUMN deleted_by_user_id CHAR(36) NULL AFTER deleted_at;
   Matching only the first is how `deleted_by_user_id` went missing. */
const ALTER_TABLE = /ALTER\s+TABLE\s+`?([a-z_][a-z0-9_]*)`?([\s\S]*?);/gi;
const ADD_COLUMN = /\bADD\s+(?:COLUMN\s+)?`?([a-z_][a-z0-9_]*)`?/gi;
const DROP_TABLE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?([a-z_][a-z0-9_]*)`?/gi;

/**
 * Words that start a constraint or index line rather than a column.
 *
 * `key` is deliberately absent: `pipelines` and `workflows` both have a
 * column actually called `key`, written as `` `key` ``. A constraint line is
 * recognised by the word that follows instead.
 */
const NOT_A_COLUMN = new Set([
  'primary', 'unique', 'index', 'constraint', 'foreign', 'fulltext', 'spatial', 'check',
]);

/** `KEY idx_x (a)` is an index; `` `key` VARCHAR(40) `` is a column. */
function isIndexLine(line: string): boolean {
  return /^(?:`?(?:primary|unique|fulltext|spatial)`?\s+)?key\s+/i.test(line.trim())
    && !/^`key`/i.test(line.trim());
}

/** The body between the outermost parentheses of a CREATE TABLE. */
function tableBody(sql: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(openParen + 1, i);
    }
  }
  return '';
}

/** Split a table body on commas that are not inside parentheses. */
function splitDefinitions(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/** Strip comments, which otherwise look like column definitions. */
function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Build the schema from migration file contents, in order. */
export function buildSchema(migrations: string[]): Schema {
  const schema: Schema = new Map();

  for (const raw of migrations) {
    const sql = stripComments(raw);

    for (const match of sql.matchAll(CREATE)) {
      const table = (match[1] ?? '').toLowerCase();
      const body = tableBody(sql, (match.index ?? 0) + match[0].length - 1);
      const columns = schema.get(table) ?? new Set<string>();

      for (const definition of splitDefinitions(body)) {
        const line = definition.trim();
        if (!line) continue;
        const first = /^`?([a-z_][a-z0-9_]*)`?/i.exec(line);
        if (!first) continue;
        const name = (first[1] ?? '').toLowerCase();
        if (NOT_A_COLUMN.has(name) || isIndexLine(line)) continue;
        columns.add(name);
      }
      schema.set(table, columns);
    }

    for (const statement of sql.matchAll(ALTER_TABLE)) {
      const table = (statement[1] ?? '').toLowerCase();
      const body = statement[2] ?? '';
      const columns = schema.get(table) ?? new Set<string>();
      for (const add of body.matchAll(ADD_COLUMN)) {
        const column = (add[1] ?? '').toLowerCase();
        /* `ADD KEY`, `ADD CONSTRAINT`, `ADD INDEX` are not columns. */
        if (NOT_A_COLUMN.has(column) || column === 'key') continue;
        columns.add(column);
      }
      if (columns.size > 0) schema.set(table, columns);
    }

    for (const match of sql.matchAll(DROP_TABLE)) {
      schema.delete((match[1] ?? '').toLowerCase());
    }
  }

  return schema;
}

export interface ColumnProblem {
  table: string;
  column: string;
  /** The statement it came from, trimmed, so the finding can be located. */
  snippet: string;
}

/*
 * Only the shapes that can be read without ambiguity:
 *
 *   SELECT a, b, c FROM table            — no alias, no join
 *   INSERT INTO table (a, b, c)
 *   UPDATE table SET a = ?, b = ?
 *
 * Anything with a join, an alias or a subquery is skipped rather than
 * guessed at. A check that cries wolf gets switched off.
 */
const SIMPLE_SELECT = /SELECT\s+([\s\S]+?)\s+FROM\s+`?([a-z_][a-z0-9_]*)`?\s*(?:WHERE|ORDER|LIMIT|GROUP|$|\n)/gi;
const INSERT_INTO = /INSERT\s+(?:IGNORE\s+)?INTO\s+`?([a-z_][a-z0-9_]*)`?\s*\(([^)]+)\)/gi;
const UPDATE_SET = /UPDATE\s+`?([a-z_][a-z0-9_]*)`?\s+SET\s+([\s\S]+?)(?:\s+WHERE|\s*$)/gi;

/** A column reference, or null when the item is an expression we skip. */
function columnOf(item: string): string | null {
  const text = item.trim();
  if (!text || text === '*') return null;
  /* Functions, literals, arithmetic, subqueries, aliases with a dot: skip. */
  if (/[(),'"*+\-/|]/.test(text)) return null;
  if (/\./.test(text)) return null;
  if (/^\d/.test(text)) return null;
  const bare = /^`?([a-z_][a-z0-9_]*)`?$/i.exec(text.split(/\s+AS\s+/i)[0]?.trim() ?? '');
  return bare ? (bare[1] ?? '').toLowerCase() : null;
}

/** Columns a statement names that the table does not have. */
export function findUnknownColumns(source: string, schema: Schema): ColumnProblem[] {
  const problems: ColumnProblem[] = [];
  const sql = stripComments(source);

  const check = (table: string, items: string[], snippet: string) => {
    const columns = schema.get(table.toLowerCase());
    /* An unknown table is not this check's business: it may be a temporary
       table, or one made by a test. */
    if (!columns) return;
    for (const item of items) {
      const column = columnOf(item);
      if (column && !columns.has(column)) {
        problems.push({ table, column, snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, 120) });
      }
    }
  };

  for (const match of sql.matchAll(SIMPLE_SELECT)) {
    const list = match[1] ?? '';
    /* A join or a subquery in the select list means the columns could come
       from anywhere. */
    if (/\bJOIN\b|\bSELECT\b/i.test(list)) continue;
    check(match[2] ?? '', list.split(','), match[0]);
  }

  for (const match of sql.matchAll(INSERT_INTO)) {
    check(match[1] ?? '', (match[2] ?? '').split(','), match[0]);
  }

  for (const match of sql.matchAll(UPDATE_SET)) {
    const assignments = (match[2] ?? '').split(',').map((part) => part.split('=')[0] ?? '');
    check(match[1] ?? '', assignments, match[0]);
  }

  return problems;
}
