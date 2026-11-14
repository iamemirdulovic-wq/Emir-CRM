import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { blockUntilPasswordChanged, requireAdmin, requireAuth } from '../middleware/auth.js';
import { query } from '../../db/client.js';
import { sourceLabel } from '../../reports/dashboard.js';

/**
 * The leads whose name is really a note from the import file.
 *
 * Emir, 14 Nov §G.2: *"A lead is named 'Looks fake – verify'. This is a note
 * from the import file, not a name. Find all leads where the name is an
 * import note and give me the list. Do not change them yourself."*
 *
 * So this reads and nothing else. There is no POST, no PATCH and no DELETE in
 * this file, and nothing it returns can be acted on from the screen that shows
 * it — the owner decides what happens to each lead, as he asked.
 *
 * **The decision is not made here.** Telling a note from a name means folding
 * accents, splitting words and looking at capitals, which SQL cannot do. It is
 * made in one place, `web/src/lib/note-names.ts`, so the list the owner reads
 * and the greeting the dialler speaks can never disagree about the same name.
 * This query casts the wider net that SQL *can* cast, and the screen makes the
 * real decision on what comes back. Wider is safe; narrower would silently
 * miss leads, which is what `note-names-sql.test.ts` is for — it reads the
 * terms below and checks the module's list is still inside them.
 *
 * Owner and admin only. It is a list of names and phone numbers, which is the
 * sort of thing an agent has no reason to ask for in bulk.
 */
export const noteNamesRouter = Router();
noteNamesRouter.use(requireAuth, blockUntilPasswordChanged, requireAdmin);

/**
 * What the query looks for — the same list as `LIKE_TERMS` in
 * `web/src/lib/note-names.ts`, kept here as plain strings because this file
 * cannot import from the web workspace.
 *
 * `utf8mb4_unicode_ci` ignores accents when it compares, so `%prufen%` finds
 * "Prüfen" without this file knowing anything about German.
 *
 * Keep it in step with the module. The test named above fails if it drifts.
 */
const LIKE_TERMS: readonly string[] = [
  '%fake%', '%verify%', '%verified%', '%unverified%', '%check%', '%checked%',
  '%recheck%', '%invalid%', '%duplicate%', '%dupe%', '%unknown%', '%spam%',
  '%junk%', '%test%', '%testing%', '%dummy%', '%tbc%', '%tba%', '%unsure%',
  '%suspicious%',
  '%prufen%', '%pruefen%', '%gepruft%', '%nachprufen%', '%falsch%',
  '%looks fake%', '%look fake%', '%looks wrong%', '%no name%', '%not a name%',
  '%wrong number%', '%bad number%', '%do not call%', '%to check%',
  '%needs check%', '%check number%', '%check this%', '%needs review%',
  '%to review%',
  '%.', '%!', '%?', '%:',
];

/**
 * How many rows to carry back at most.
 *
 * These names are rare, so in practice the answer is a handful. The cap is
 * here so that a database where somebody has imported a whole column of notes
 * cannot turn one screen into a ten-megabyte response; the screen says plainly
 * when it has been reached rather than quietly showing part of the answer.
 */
const CAP = 1000;

interface Row {
  contact_id: string;
  opportunity_id: string | null;
  full_name: string | null;
  phone_e164: string | null;
  first_source: string | null;
  created_at: Date | string;
}

noteNamesRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const where = LIKE_TERMS.map(() => 'c.full_name LIKE ?').join(' OR ');
    const rows = await query<Row>(
      `SELECT c.id AS contact_id,
              (SELECT o.id FROM opportunities o
                WHERE o.contact_id = c.id
                ORDER BY o.created_at DESC LIMIT 1) AS opportunity_id,
              c.full_name, c.phone_e164, c.first_source, c.created_at
         FROM contacts c
        WHERE c.merged_into_id IS NULL
          AND c.full_name IS NOT NULL
          AND c.full_name <> ''
          AND (${where})
        ORDER BY c.created_at DESC
        LIMIT ?`,
      [...LIKE_TERMS, CAP + 1],
    );

    const capped = rows.length > CAP;
    res.json({
      /* Candidates, not findings: the screen decides which of these really
         are notes. The word is in the field name so nobody reads the length
         of this list as the answer. */
      candidates: rows.slice(0, CAP).map((row) => ({
        contactId: row.contact_id,
        opportunityId: row.opportunity_id,
        name: row.full_name,
        phone: row.phone_e164,
        /* Plain English, never the stored code: "Imported", not csv_import. */
        source: row.first_source ? sourceLabel(row.first_source) : null,
        addedAt: new Date(row.created_at).toISOString(),
      })),
      capped,
    });
  }),
);
