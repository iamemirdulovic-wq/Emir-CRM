/**
 * Turning the CRM's SQL into the shape Postgres expects.
 *
 * Every statement in this codebase was written for MySQL and binds its values
 * with `?`. Postgres numbers them instead. Rewriting 939 statements by hand
 * would be 939 chances to shift a parameter by one — a bug that does not
 * crash, it just quietly asks the wrong question. So the rewrite happens here,
 * once, where it can be tested properly.
 *
 * The whole difficulty is knowing which `?` is a placeholder. One inside a
 * quoted string is part of the data.
 */

/**
 * Replace each placeholder `?` with `$1`, `$2`, … leaving anything inside a
 * string literal, a quoted identifier, a dollar-quoted block or a comment
 * exactly as it was.
 */
export function toPositional(sql: string): string {
  let out = '';
  let index = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i] as string;
    const next = sql[i + 1];

    // '...' — a string literal. Postgres doubles a quote to escape it.
    if (ch === "'") {
      const end = closingQuote(sql, i, "'");
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // "..." — a quoted identifier, e.g. the column named "key".
    if (ch === '"') {
      const end = closingQuote(sql, i, '"');
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // $tag$ … $tag$ — a dollar-quoted body, as a trigger function uses.
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const end = close === -1 ? sql.length : close + tag[0].length;
        out += sql.slice(i, end);
        i = end;
        continue;
      }
    }

    // -- to end of line.
    if (ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      out += sql.slice(i, end);
      i = end;
      continue;
    }

    // /* … */, which Postgres allows to nest.
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth += 1; j += 2; continue; }
        if (sql[j] === '*' && sql[j + 1] === '/') { depth -= 1; j += 2; continue; }
        j += 1;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    if (ch === '?') {
      index += 1;
      out += `$${index}`;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/** Index just past the closing quote, treating a doubled quote as an escape. */
function closingQuote(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) { i += 2; continue; }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

/** How many placeholders a statement carries, for checking the parameters match. */
export function countPlaceholders(sql: string): number {
  const rewritten = toPositional(sql);
  const seen = new Set<string>();
  for (const m of rewritten.matchAll(/\$(\d+)/g)) seen.add(m[1] as string);
  return seen.size;
}
