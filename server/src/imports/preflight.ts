/**
 * What this file would do, before it does it.
 *
 * `design/web/import.html` step 3 is a page that says *"We checked 240 rows"*
 * and splits them into new, duplicate and bad before anything is written. The
 * import itself has always made that split — it just made it while running,
 * which is too late for somebody to change their mind about duplicates.
 *
 * So this is the same loop as `runImport`, with the writes taken out. It is
 * deliberately built from the same pieces — `mapRow`, `rowToLead`,
 * `findExisting` — rather than a second implementation, because two answers
 * to "is this person already in the CRM" eventually disagree, and the way
 * that shows up is a screen promising 208 new leads and an import creating
 * 191.
 *
 * It reads. It never writes a contact, an opportunity or a row's status.
 */
import { getPool, query, queryOne, type Executor } from '../db/client.js';
import { mapRow, rowToLead, defaultSettings, type ImportSettings } from './normalize.js';
import type { ColumnMapping } from './mapping.js';
import { asJson, findExisting, loadImport } from './run.js';

/** How many examples of each kind the screen shows before "and N more". */
const EXAMPLES = 8;

export interface PreflightRow {
  line: number;
  name: string | null;
  phone: string | null;
  /** For a duplicate: who has them now. For a bad row: what is wrong. */
  detail: string | null;
}

export interface Preflight {
  total: number;
  fresh: number;
  duplicates: number;
  invalid: number;
  /** A few of each, for the two lists the screen shows. */
  duplicateRows: PreflightRow[];
  invalidRows: PreflightRow[];
  /** "9 without a phone · 4 broken numbers · 1 without a name". */
  invalidReasons: Array<{ reason: string; n: number }>;
  /** How many leads the CRM already holds, for the line above the split. */
  contactsInCrm: number;
}

export async function preflight(
  importId: string,
  exec: Executor = getPool(),
): Promise<Preflight> {
  const record = await loadImport(importId, exec);
  if (!record) throw new Error('That import does not exist');

  /*
   * Read straight from the row rather than through `loadImport`, which does
   * not select `headers`. Reaching for it there returned undefined, every
   * column mapped to nothing, and every row in the file came back "no name,
   * no phone" — a screen that would have told an owner their whole file was
   * rubbish.
   */
  const stored = await queryOne<{ headers: unknown }>(
    'SELECT headers FROM imports WHERE id = ?', [importId], exec,
  );
  const headers = asJson<string[]>(stored?.headers, []);
  const mapping = asJson<ColumnMapping>(record.mapping, {});
  const settings: ImportSettings = { ...defaultSettings(), ...asJson<Partial<ImportSettings>>(record.settings, {}) };

  const rows = await query<{ line_number: number; raw: unknown }>(
    'SELECT line_number, raw FROM import_rows WHERE import_id = ? ORDER BY line_number',
    [importId],
    exec,
  );

  const out: Preflight = {
    total: rows.length,
    fresh: 0,
    duplicates: 0,
    invalid: 0,
    duplicateRows: [],
    invalidRows: [],
    invalidReasons: [],
    contactsInCrm: 0,
  };

  const reasons = new Map<string, number>();
  /* The same person twice in one file is a file duplicate, counted with the
     others because the effect on the person reading the screen is the same:
     that row will not become a new lead. */
  const seen = new Set<string>();

  /*
   * Who each duplicate belongs to, looked up once at the end rather than per
   * row. A file of five thousand rows where every one is a duplicate would
   * otherwise be five thousand extra queries.
   */
  const dupContactIds: Array<{ line: number; contactId: string; name: string | null; phone: string | null }> = [];

  for (const row of rows) {
    const values = asJson<string[]>(row.raw, []);
    const { mapped, unmapped } = mapRow(headers, values, mapping);
    const outcome = rowToLead(mapped, unmapped, settings, row.line_number);

    if (!outcome.ok) {
      out.invalid += 1;
      reasons.set(outcome.reason, (reasons.get(outcome.reason) ?? 0) + 1);
      if (out.invalidRows.length < EXAMPLES) {
        out.invalidRows.push({
          line: row.line_number,
          name: mapped.fullName ?? null,
          phone: mapped.phone ?? null,
          detail: outcome.reason,
        });
      }
      continue;
    }

    const key = outcome.dedupeKey;
    if (key && seen.has(key)) {
      out.duplicates += 1;
      if (out.duplicateRows.length < EXAMPLES) {
        out.duplicateRows.push({
          line: row.line_number,
          name: outcome.lead.person.fullName ?? null,
          phone: outcome.lead.person.phoneE164 ?? null,
          detail: 'Appears earlier in this file',
        });
      }
      continue;
    }
    if (key) seen.add(key);

    const existing = await findExisting(
      exec, outcome.lead.person.phoneE164, outcome.lead.person.email,
    );
    if (existing) {
      out.duplicates += 1;
      if (dupContactIds.length < EXAMPLES) {
        dupContactIds.push({
          line: row.line_number,
          contactId: existing,
          name: outcome.lead.person.fullName ?? null,
          phone: outcome.lead.person.phoneE164 ?? null,
        });
      }
      continue;
    }

    out.fresh += 1;
  }

  /* Who holds each duplicate now — "with Rocky", "in Incoming" — which is the
     thing that decides whether skipping them is the right call. */
  if (dupContactIds.length > 0) {
    const owners = await query<{ contact_id: string; owner_name: string | null }>(
      `SELECT o.contact_id, u.name AS owner_name
         FROM opportunities o
         LEFT JOIN users u ON u.id = o.owner_user_id
        WHERE o.contact_id IN (${dupContactIds.map(() => '?').join(',')})
          AND o.status = 'open'
        ORDER BY o.updated_at DESC`,
      dupContactIds.map((one) => one.contactId),
      exec,
    );
    const byContact = new Map<string, string | null>();
    for (const row of owners) {
      if (!byContact.has(row.contact_id)) byContact.set(row.contact_id, row.owner_name);
    }
    for (const one of dupContactIds) {
      const owner = byContact.get(one.contactId);
      out.duplicateRows.push({
        line: one.line,
        name: one.name,
        phone: one.phone,
        detail: owner === undefined
          ? 'already in the CRM'
          : owner === null ? 'in Incoming' : `with ${owner}`,
      });
    }
    out.duplicateRows.sort((a, b) => a.line - b.line);
    out.duplicateRows = out.duplicateRows.slice(0, EXAMPLES);
  }

  out.invalidReasons = [...reasons]
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => b.n - a.n);

  const crm = await query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM contacts WHERE deleted_at IS NULL AND merged_into_id IS NULL',
    [],
    exec,
  );
  out.contactsInCrm = Number(crm[0]?.n ?? 0);

  return out;
}
