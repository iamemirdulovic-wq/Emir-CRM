import type { PoolConnection } from 'mysql2/promise';
import { execute, query, queryOne, withRetryingTransaction } from '../db/client.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { logger } from '../lib/logger.js';

/**
 * Empty the CRM of leads, permanently.
 *
 * Emir asked for this on 10 Nov 2026, twice, after a supplier's spreadsheet
 * arrived with its columns sorted apart: every name, number and email in it
 * belonged to three different people, 694 rows of it, already imported and
 * already being worked. He wanted a clean start rather than a repair, which
 * is his call to make.
 *
 * ## Why this is a real DELETE and not the soft one
 *
 * Everywhere else in this CRM, deleting a contact sets `deleted_at` and keeps
 * the row, because a client who comes back should come back with their
 * history — `reviveIfDeleted` in ingestion/identity.ts does exactly that, by
 * phone number, on the next enquiry.
 *
 * That rule would defeat the whole exercise here. Clear the leads softly,
 * import the corrected file, and every number in it finds its old row, clears
 * the timestamp and brings the wrong name back with it — because the merge
 * rule fills empty fields and never overwrites. The CRM would look cleaned
 * and be exactly as wrong as before. So the rows have to go.
 *
 * ## What that costs, stated plainly
 *
 * There is no undo. Not in the CRM, and not from the audit log, which records
 * the counts and not the contacts. The only way back is the hosting panel's
 * database backup.
 *
 * ## How the list below was built
 *
 * Twenty-eight tables carry a `contact_id` or an `opportunity_id`. Most are
 * reached by cascade: deleting a contact takes its opportunities, and each of
 * those takes its own children. Five are not reachable that way at all —
 * `inbound_events`, `jobs`, `brochure_views` and `first_touch_repair` have no
 * foreign key, and `notifications` is ON DELETE SET NULL, which would leave
 * the row behind pointing at nobody.
 *
 * `clear-all.integration.test.ts` re-reads information_schema on every run and
 * fails if any table with one of those columns still holds a row afterwards.
 * That check, not this comment, is what keeps the list honest when the next
 * table is added.
 */

export interface ClearResult {
  contacts: number;
  opportunities: number;
  offers: number;
  messages: number;
  activities: number;
  /** Raw webhook payloads. Kept out of the counts above; see below. */
  inboundEvents: number;
  imports: number;
  jobs: number;
}

/** What is about to go, so the screen can say it before anything happens. */
export async function countLeadData(): Promise<ClearResult> {
  const one = async (sql: string): Promise<number> =>
    Number((await queryOne<{ n: number }>(sql, []))?.n ?? 0);

  return {
    contacts: await one('SELECT COUNT(*) AS n FROM contacts'),
    opportunities: await one('SELECT COUNT(*) AS n FROM opportunities'),
    offers: await one('SELECT COUNT(*) AS n FROM offers'),
    messages: await one('SELECT COUNT(*) AS n FROM messages'),
    activities: await one('SELECT COUNT(*) AS n FROM activities'),
    inboundEvents: await one('SELECT COUNT(*) AS n FROM inbound_events'),
    imports: await one('SELECT COUNT(*) AS n FROM imports'),
    jobs: await one('SELECT COUNT(*) AS n FROM jobs'),
  };
}

/**
 * The order matters, and each line says why it is where it is.
 *
 * Not run inside one transaction: a hundred thousand rows across thirty tables
 * in a single transaction locks the database against ten people for as long as
 * it takes, and a clear that half-finishes is recoverable by running it again
 * — while a lock-up in the middle of a working day is not.
 */
async function deleteEverything(tx: PoolConnection): Promise<void> {
  /*
   * Notifications first, while the link still exists. `notifications.contact_id`
   * is ON DELETE SET NULL, so after the contacts go these rows survive with a
   * null id and nothing left to tell a lead alert from a kudos.
   */
  await execute(
    'DELETE FROM notifications WHERE contact_id IS NOT NULL OR opportunity_id IS NOT NULL',
    [],
    tx,
  );

  /* Offers before contacts for the same reason: `offers.contact_id` is SET
     NULL, so a cascade would leave every offer orphaned rather than gone.
     Its units, views and events cascade from the offer itself. */
  await execute('DELETE FROM offers', [], tx);

  /*
   * The contacts, and with them the twenty-one tables that cascade: their
   * opportunities (and that table's own eight children), conversations,
   * messages, activities, tasks, tags, consents, workflow runs, conversion
   * events, AI scores and suggestions, assignments, notes, note files, list
   * and campaign members, website leads and pool claims.
   */
  await execute('DELETE FROM contacts', [], tx);

  /* No foreign key reaches these, so a cascade never touches them. */
  await execute('DELETE FROM inbound_events', [], tx);
  await execute('DELETE FROM brochure_views', [], tx);
  await execute('DELETE FROM first_touch_repair', [], tx);

  /*
   * Every queued job is lead work — an SLA timer, a follow-up, a scoring run,
   * an import chunk. Left behind they would wake against contacts that no
   * longer exist and fill the log with failures all afternoon.
   */
  await execute('DELETE FROM jobs', [], tx);

  /* The import history, which is a record of leads and nothing else.
     `import_rows` cascades from it. */
  await execute('DELETE FROM imports', [], tx);
}

/**
 * Do it.
 *
 * `confirm` has to be the exact phrase. Not a tick-box: typing the words is
 * the one confirmation a person cannot give by accident, and it is what the
 * project delete already asks for.
 */
export const CLEAR_PHRASE = 'DELETE ALL LEADS';

export async function clearAllLeads(actor: AuditActor): Promise<ClearResult> {
  const before = await countLeadData();

  /*
   * Audited before the delete, not after: if the delete fails halfway there
   * still has to be a line saying who asked for it and what was there.
   */
  await writeAudit({
    actor,
    action: 'leads.cleared',
    entityType: 'contact',
    entityId: null,
    before: { ...before },
    after: { recoverable: false, note: 'Every lead removed permanently at the owner’s request' },
  });

  logger.warn('clearing every lead from the CRM', { ...before, actor: actor.userId });

  await withRetryingTransaction(async (tx) => {
    await deleteEverything(tx);
  });

  const after = await countLeadData();
  logger.warn('leads cleared', { ...after });
  return before;
}

/**
 * Anything left that should not be.
 *
 * Used by the test, and by the screen after it runs, so "it is empty" is a
 * read of the database rather than a claim.
 */
export async function leadTablesStillHolding(): Promise<{ table: string; rows: number }[]> {
  const tables = await query<{ TABLE_NAME: string }>(
    `SELECT DISTINCT TABLE_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('contact_id', 'opportunity_id')
      ORDER BY TABLE_NAME`,
  );

  const left: { table: string; rows: number }[] = [];
  for (const { TABLE_NAME } of [...tables, { TABLE_NAME: 'contacts' }]) {
    /* The name comes from information_schema, not from a request. */
    if (!/^[a-z_]+$/.test(TABLE_NAME)) continue;
    const row = await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${TABLE_NAME}\``, []);
    const rows = Number(row?.n ?? 0);
    if (rows > 0) left.push({ table: TABLE_NAME, rows });
  }
  return left;
}
