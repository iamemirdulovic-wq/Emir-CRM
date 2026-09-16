/**
 * Defence in depth for the few places that build a column list dynamically.
 *
 * Every user-supplied *value* in this codebase goes through a `?` placeholder.
 * A handful of updates still interpolate column *names*, and today those names
 * all come from fixed allowlists — but that is a property of the current code,
 * not something the compiler enforces. This makes it enforced at runtime, so a
 * later edit that starts feeding request keys into a patch object fails loudly
 * instead of opening an injection hole.
 */

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function assertIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`Refusing to build SQL with an unsafe identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

/** `a = ?, b = ?` from a list of column names, each validated. */
export function assignmentList(columns: string[]): string {
  return columns.map((column) => `${assertIdentifier(column)} = ?`).join(', ');
}

/** `(?,?,?)` — placeholders only, never values. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',');
}
