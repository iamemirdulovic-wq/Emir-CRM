import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { newId } from '../lib/ids.js';
import { SYSTEM_ACTOR } from '../audit/audit.js';
import { defaultSettings, type ImportSettings } from './normalize.js';
import { suggestMapping } from './mapping.js';
import { previewUndo, runChunk, stageRows, undoImport } from './run.js';

let workDir = '';

/** Writes a CSV and registers it as an uploaded import, ready to stage. */
async function createImport(
  csv: string,
  over: Partial<ImportSettings> = {},
  assignment: unknown = null,
): Promise<{ importId: string; headers: string[] }> {
  const importId = newId();
  const path = join(workDir, `${importId}.csv`);
  await writeFile(path, csv, 'utf8');

  const headers = (csv.split('\n')[0] ?? '').split(',').map((header) => header.trim());
  const settings: ImportSettings = { ...defaultSettings(), sourceLabel: 'Test import', ...over };

  await execute(
    `INSERT INTO imports (id, filename, file_path, file_kind, byte_size, status, headers, mapping, settings, assignment)
     VALUES (?, 'test.csv', ?, 'csv', ?, 'uploaded', ?, ?, ?, ?)`,
    [
      importId, path, Buffer.byteLength(csv),
      JSON.stringify(headers),
      JSON.stringify(suggestMapping(headers)),
      JSON.stringify(settings),
      assignment ? JSON.stringify(assignment) : null,
    ],
  );
  return { importId, headers };
}

/** Stage and import everything, however many chunks it takes. */
async function runToCompletion(importId: string): Promise<void> {
  await stageRows(importId);
  for (let guard = 0; guard < 50; guard++) {
    const result = await runChunk(importId);
    if (result.done) return;
  }
  throw new Error('import did not finish');
}

describeWithDb('bulk import (integration)', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    workDir = await mkdtemp(join(tmpdir(), 'emir-import-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
  });

  it('imports a file end to end', async () => {
    const { importId } = await createImport(
      [
        'Full Name,Mobile No.,Email,Project,Budget AED',
        'Sara Ahmed,0501234567,sara@example.com,Emaar Beachfront,AED 1.5M - 2.5M',
        'Omar Haddad,0559876543,omar@example.com,Damac Lagoons,AED 2M - 3M',
      ].join('\n'),
    );

    await runToCompletion(importId);

    const record = await query<{ status: string; total_rows: number; created_count: number }>(
      'SELECT status, total_rows, created_count FROM imports WHERE id = ?',
      [importId],
    );
    expect(record[0]?.status).toBe('completed');
    expect(Number(record[0]?.total_rows)).toBe(2);
    expect(Number(record[0]?.created_count)).toBe(2);

    const contacts = await query<{ phone_e164: string; full_name: string }>(
      'SELECT phone_e164, full_name FROM contacts ORDER BY full_name',
    );
    expect(contacts.map((c) => c.phone_e164)).toEqual(['+971559876543', '+971501234567']);
  });

  /*
   * The file the first real import came from: several Meta forms concatenated,
   * so the column holding a name in one block holds an answer to a question in
   * the next. The importer picks the column once, from the top of the file, and
   * used to trust every value in it — which is how contacts called "2pm / 6pm"
   * and "I am on holiday till 25.05" ended up in the live CRM.
   */
  it('does not take a form answer as somebody\'s name', async () => {
    const { importId } = await createImport(
      [
        'Full Name,Mobile No.,Email,When can we call?',
        // First block: the column holds real names.
        'Matio Caetano,0501234567,matio@example.com,Morning',
        'Paulo de A. L. Neto,0559876543,paulo@example.com,Afternoon',
        // Second block: the same column now holds the answer, and the name has
        // moved one column over.
        '2pm / 6pm,0521112233,carlos@example.com,Carlos Veiga',
        'I am on holiday till 25.05 and have time. From 9 am to 8 pm ( Cyprus time),0524445566,lilian@example.com,Nothing useful here',
        'Katalog,0527778899,edson@example.com,Şimdi',
      ].join('\n'),
    );

    await runToCompletion(importId);

    const record = await query<{ created_count: number; failed_count: number }>(
      'SELECT created_count, failed_count FROM imports WHERE id = ?', [importId],
    );
    // Every row is a reachable person: a bad name never costs us the lead.
    expect(Number(record[0]?.created_count)).toBe(5);
    expect(Number(record[0]?.failed_count)).toBe(0);

    const contacts = await query<{ id: string; phone_e164: string; full_name: string | null }>(
      'SELECT id, phone_e164, full_name FROM contacts ORDER BY phone_e164',
    );
    const byPhone = new Map(contacts.map((c) => [c.phone_e164, c]));

    // The real names are kept, including the one with initials.
    expect(byPhone.get('+971501234567')?.full_name).toBe('Matio Caetano');
    expect(byPhone.get('+971559876543')?.full_name).toBe('Paulo de A. L. Neto');

    // "Carlos Veiga" was in the answer column; it is found and used.
    expect(byPhone.get('+971521112233')?.full_name).toBe('Carlos Veiga');

    // Nothing name-shaped anywhere, so the name stays empty rather than a lie.
    // The inbox shows the phone number for these.
    expect(byPhone.get('+971524445566')?.full_name).toBeNull();
    expect(byPhone.get('+971527778899')?.full_name).toBeNull();

    /*
     * And the answer is not thrown away. It lands on the contact's timeline,
     * where the rest of the lead's detail goes — for the holiday row it is the
     * most useful line in the file for whoever has to ring this person.
     */
    const timeline = async (phone: string) => {
      const rows = await query<{ body: string }>(
        'SELECT body FROM activities WHERE contact_id = ?',
        [byPhone.get(phone)?.id ?? ''],
      );
      return rows.map((row) => row.body).join('\n');
    };
    expect(await timeline('+971524445566')).toMatch(/was in the name column/);
    expect(await timeline('+971524445566')).toMatch(/holiday till 25\.05/);
    expect(await timeline('+971527778899')).toMatch(/Katalog/);
    // A row whose name was fine gains no such note.
    expect(await timeline('+971501234567')).not.toMatch(/was in the name column/);
  });

  /*
   * A stacked export often carries each file's header row with it. The row is
   * rejected on the phone column before the name is even looked at, and the
   * reason names the value that failed — which is what you need when you are
   * fixing four hundred rows, and better than "is this a second header row?".
   */
  it('still rejects a header row repeated in the middle of a file', async () => {
    const { importId } = await createImport(
      [
        'Full Name,Mobile No.',
        'Sara Ahmed,0501234567',
        'Full Name,Mobile No.',
      ].join('\n'),
    );
    await runToCompletion(importId);

    const rows = await query<{ status: string; reason: string | null }>(
      'SELECT status, reason FROM import_rows WHERE import_id = ? ORDER BY line_number', [importId],
    );
    expect(rows[0]?.status).toBe('created');
    expect(rows[1]?.status).toBe('invalid');
    expect(rows[1]?.reason).toMatch(/Mobile No\./);

    // And no contact was created from it.
    const contacts = await query<{ n: number }>('SELECT COUNT(*) AS n FROM contacts');
    expect(Number(contacts[0]?.n)).toBe(1);
  });

  /**
   * The rule the owner signed off on. A file of forty thousand old leads must
   * not fire forty thousand welcome messages: it would breach the consent
   * rules, exhaust Meta's messaging limits and very likely get the WhatsApp
   * number banned.
   */
  it('never starts Workflow A for an imported lead', async () => {
    const { importId } = await createImport(
      ['Full Name,Mobile No.', 'Sara Ahmed,0501234567', 'Omar Haddad,0559876543'].join('\n'),
    );

    await runToCompletion(importId);

    const jobs = await query<{ type: string }>("SELECT type FROM jobs WHERE type LIKE 'workflow.%'");
    expect(jobs).toHaveLength(0);

    const opportunities = await query<{ import_id: string | null }>('SELECT import_id FROM opportunities');
    expect(opportunities).toHaveLength(2);
    // Recorded on the row, so the decision is auditable rather than implicit.
    expect(opportunities.every((row) => row.import_id === importId)).toBe(true);
  });

  it('still starts Workflow A for a lead that arrives normally', async () => {
    // The guard above must not have switched instant capture off everywhere.
    const { ingestLead } = await import('../ingestion/ingest.js');
    const { normalizeLead } = await import('../ingestion/normalize.js');
    await createTestUser({ role: 'agent' });

    await ingestLead(
      normalizeLead({
        source: 'website',
        externalId: `web-${newId()}`,
        mapped: { full_name: 'Walk In', phone: '0507654321' },
      }),
    );

    const jobs = await query<{ type: string }>("SELECT type FROM jobs WHERE type = 'workflow.a.instant_capture'");
    expect(jobs).toHaveLength(1);
  });

  it('rejects rows with no way to contact the person, and keeps the reason', async () => {
    const { importId } = await createImport(
      [
        'Full Name,Mobile No.,Email',
        'Sara Ahmed,0501234567,sara@example.com',
        'No Contact,,',
        'Bad Phone,call the office,',
      ].join('\n'),
    );

    await runToCompletion(importId);

    const rows = await query<{ line_number: number; status: string; reason: string }>(
      'SELECT line_number, status, reason FROM import_rows ORDER BY line_number',
    );
    expect(rows[0]?.status).toBe('created');
    expect(rows[1]?.status).toBe('invalid');
    expect(rows[2]?.status).toBe('invalid');
    // The bad value is named, because you are fixing hundreds of these at once.
    expect(rows[2]?.reason).toContain('call the office');
  });

  it('drops a person who appears twice in the same file', async () => {
    const { importId } = await createImport(
      [
        'Full Name,Mobile No.',
        'Sara Ahmed,0501234567',
        'Sara A,+971501234567',
        'Omar Haddad,0559876543',
      ].join('\n'),
    );

    await runToCompletion(importId);

    // Two spellings of one number are one person.
    expect(await query('SELECT id FROM contacts')).toHaveLength(2);
    const skipped = await query<{ reason: string }>("SELECT reason FROM import_rows WHERE status = 'skipped'");
    expect(skipped[0]?.reason).toMatch(/earlier in this file/i);
  });

  it('leaves an existing contact alone when the strategy is skip', async () => {
    const first = await createImport(['Full Name,Mobile No.', 'Sara Ahmed,0501234567'].join('\n'));
    await runToCompletion(first.importId);

    const second = await createImport(
      ['Full Name,Mobile No.,Email', 'Sara Renamed,0501234567,new@example.com'].join('\n'),
      { duplicateStrategy: 'skip' },
    );
    await runToCompletion(second.importId);

    const contact = await query<{ full_name: string; email: string | null }>('SELECT full_name, email FROM contacts');
    expect(contact).toHaveLength(1);
    expect(contact[0]?.full_name).toBe('Sara Ahmed');
    // Skip means skip: not even an empty field is filled.
    expect(contact[0]?.email).toBeNull();
  });

  it('fills only empty fields when the strategy says so', async () => {
    const first = await createImport(['Full Name,Mobile No.', 'Sara Ahmed,0501234567'].join('\n'));
    await runToCompletion(first.importId);

    const second = await createImport(
      ['Full Name,Mobile No.,Email', 'Sara Renamed,0501234567,new@example.com'].join('\n'),
      { duplicateStrategy: 'fill_empty' },
    );
    await runToCompletion(second.importId);

    const contact = await query<{ full_name: string; email: string | null }>('SELECT full_name, email FROM contacts');
    expect(contact).toHaveLength(1);
    // The empty email is filled; the name an agent may have corrected is not.
    expect(contact[0]?.email).toBe('new@example.com');
    expect(contact[0]?.full_name).toBe('Sara Ahmed');
  });

  it('opens a second inquiry when the strategy is create anyway', async () => {
    const first = await createImport(['Full Name,Mobile No.,Project', 'Sara Ahmed,0501234567,Emaar'].join('\n'));
    await runToCompletion(first.importId);

    const second = await createImport(
      ['Full Name,Mobile No.,Project', 'Sara Ahmed,0501234567,Emaar'].join('\n'),
      { duplicateStrategy: 'create_anyway' },
    );
    await runToCompletion(second.importId);

    // One person, because phone_e164 is unique and that guarantee holds; two
    // inquiries, which is what "create anyway" can honestly mean here.
    expect(await query('SELECT id FROM contacts')).toHaveLength(1);
    expect(await query('SELECT id FROM opportunities')).toHaveLength(2);
  });

  it('records consent wording only when the owner confirms an opt-in', async () => {
    const withConsent = await createImport(
      ['Full Name,Mobile No.', 'Sara Ahmed,0501234567'].join('\n'),
      { consent: 'opted_in', sourceLabel: 'Expo 2026' },
    );
    await runToCompletion(withConsent.importId);

    const consents = await query<{ channel: string; granted: number; consent_text: string | null }>(
      'SELECT channel, granted, consent_text FROM consents',
    );
    const whatsapp = consents.find((row) => row.channel === 'whatsapp');
    expect(whatsapp?.granted).toBe(1);
    // UAE PDPL: we must be able to show what the person agreed to.
    expect(whatsapp?.consent_text).toContain('Expo 2026');
  });

  it('grants no consent when the status is unknown', async () => {
    const { importId } = await createImport(
      ['Full Name,Mobile No.', 'Sara Ahmed,0501234567'].join('\n'),
      { consent: 'unknown' },
    );
    await runToCompletion(importId);

    const granted = await query('SELECT id FROM consents WHERE granted = 1');
    expect(granted).toHaveLength(0);
  });

  it('assigns the imported leads by the chosen method', async () => {
    const a = await createTestUser({ name: 'Agent A', role: 'agent' });
    const b = await createTestUser({ name: 'Agent B', role: 'agent' });

    const { importId } = await createImport(
      [
        'Full Name,Mobile No.',
        'One,0501111111',
        'Two,0502222222',
        'Three,0503333333',
        'Four,0504444444',
      ].join('\n'),
      {},
      { method: 'split_even' },
    );
    await runToCompletion(importId);

    const counts = await query<{ owner_user_id: string; n: number }>(
      'SELECT owner_user_id, COUNT(*) AS n FROM opportunities GROUP BY owner_user_id',
    );
    const byOwner = new Map(counts.map((row) => [row.owner_user_id, Number(row.n)]));
    expect(byOwner.get(a.id)).toBe(2);
    expect(byOwner.get(b.id)).toBe(2);
  });

  it('leaves imported leads unowned when the method is the shared pool', async () => {
    await createTestUser({ role: 'agent' });
    const { importId } = await createImport(
      ['Full Name,Mobile No.', 'One,0501111111', 'Two,0502222222'].join('\n'),
      {},
      { method: 'pool' },
    );
    await runToCompletion(importId);

    const owners = await query<{ owner_user_id: string | null }>('SELECT owner_user_id FROM opportunities');
    expect(owners.every((row) => row.owner_user_id === null)).toBe(true);
  });

  it('imports across several chunks without losing or double-counting a row', async () => {
    // 2,500 rows against a chunk size of 1,000: three chunks, and the counts
    // have to add up exactly.
    const rows = ['Full Name,Mobile No.'];
    for (let i = 0; i < 2500; i++) {
      rows.push(`Person ${i},+9715${String(10_000_000 + i).slice(0, 8)}`);
    }
    const { importId } = await createImport(rows.join('\n'));

    await runToCompletion(importId);

    const record = await query<{ total_rows: number; processed_rows: number; created_count: number }>(
      'SELECT total_rows, processed_rows, created_count FROM imports WHERE id = ?',
      [importId],
    );
    expect(Number(record[0]?.total_rows)).toBe(2500);
    expect(Number(record[0]?.processed_rows)).toBe(2500);

    const contacts = await query<{ n: number }>('SELECT COUNT(*) AS n FROM contacts');
    expect(Number(contacts[0]?.n)).toBe(Number(record[0]?.created_count));
    const pending = await query("SELECT id FROM import_rows WHERE status = 'pending'");
    expect(pending).toHaveLength(0);
  }, 120_000);
});

describeWithDb('undoing an import', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    workDir = await mkdtemp(join(tmpdir(), 'emir-undo-'));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
  });

  it('removes the contacts it created', async () => {
    const { importId } = await createImport(
      ['Full Name,Mobile No.', 'One,0501111111', 'Two,0502222222'].join('\n'),
    );
    await runToCompletion(importId);
    expect(await query('SELECT id FROM contacts')).toHaveLength(2);

    const result = await undoImport(SYSTEM_ACTOR, importId);
    expect(result.deleted).toBe(2);
    expect(await query('SELECT id FROM contacts')).toHaveLength(0);
  });

  it('keeps a lead somebody has already worked', async () => {
    const { importId } = await createImport(
      ['Full Name,Mobile No.', 'Worked,0501111111', 'Untouched,0502222222'].join('\n'),
    );
    await runToCompletion(importId);

    // A call task is human attention: deleting that lead would throw away an
    // agent's work, which is far worse than leaving a row behind.
    const worked = await query<{ contact_id: string }>(
      "SELECT contact_id FROM import_rows WHERE reason IS NULL AND status = 'created' ORDER BY line_number LIMIT 1",
    );
    await execute(
      `INSERT INTO tasks (id, contact_id, type, title, due_at) VALUES (?, ?, 'call', 'Call back', NOW(3))`,
      [newId(), worked[0]?.contact_id],
    );

    const preview = await previewUndo(importId);
    expect(preview.deletable).toBe(1);
    expect(preview.keptBecauseWorkedOn).toBe(1);

    const result = await undoImport(SYSTEM_ACTOR, importId);
    expect(result.deleted).toBe(1);
    expect(await query('SELECT id FROM contacts')).toHaveLength(1);
  });

  it('never deletes a contact it merely updated', async () => {
    const first = await createImport(['Full Name,Mobile No.', 'Existing,0501111111'].join('\n'));
    await runToCompletion(first.importId);

    const second = await createImport(
      ['Full Name,Mobile No.,Email', 'Existing,0501111111,new@example.com'].join('\n'),
      { duplicateStrategy: 'fill_empty' },
    );
    await runToCompletion(second.importId);

    // The second import only touched a contact that already existed; undoing
    // it must not take that person's whole history with it.
    const result = await undoImport(SYSTEM_ACTOR, second.importId);
    expect(result.deleted).toBe(0);
    expect(await query('SELECT id FROM contacts')).toHaveLength(1);
  });

  it('refuses once the 24-hour window has passed', async () => {
    const { importId } = await createImport(['Full Name,Mobile No.', 'One,0501111111'].join('\n'));
    await runToCompletion(importId);

    await execute('UPDATE imports SET undo_deadline_at = DATE_SUB(NOW(3), INTERVAL 1 HOUR) WHERE id = ?', [importId]);

    expect(await previewUndo(importId)).toMatchObject({ expired: true });
    await expect(undoImport(SYSTEM_ACTOR, importId)).rejects.toThrow(/24 hours/);
    expect(await query('SELECT id FROM contacts')).toHaveLength(1);
  });
});
