import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, query, resetTables,
} from '../testing/db.js';
import { createDeveloper, addDeveloperContact, publicDeveloper, getDeveloper } from './developers.js';
import {
  archiveProject, createProject, deleteProject, importUnits, libraryStats, listLibrary,
  listPaymentPlans, listUnits, savePaymentPlan, setUnitStatus, updateProject,
} from './project-library.js';
import { findVerifiedProject } from './projects.js';
import { newId } from '../lib/ids.js';
import type { AuditActor } from '../audit/audit.js';

const owner = (id: string): AuditActor => ({ userId: id, role: 'owner' });
const manager = (id: string): AuditActor => ({ userId: id, role: 'manager' });

describeWithDb('the project library', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); });

  it('creates a project under a developer and keeps the name in both places', async () => {
    const user = await createTestUser({ role: 'owner' });
    const devId = await createDeveloper(owner(user.id), { legalName: 'Emaar Properties PJSC', shortName: 'Emaar' });

    const id = await createProject(owner(user.id), {
      name: 'Dubai Hills Estate', developerId: devId, emirate: 'dubai', community: 'Dubai Hills',
    });

    const rows = await query<{ developer: string; developer_id: string; slug: string }>(
      'SELECT developer, developer_id, slug FROM projects WHERE id = ?', [id],
    );
    // The text column is what the live WhatsApp replies read, so it has to
    // carry the developer's name even though there is now a link as well.
    expect(rows[0]?.developer).toBe('Emaar');
    expect(rows[0]?.developer_id).toBe(devId);
    expect(rows[0]?.slug).toBe('dubai-hills-estate');
  });

  it('gives a second project with the same name its own slug', async () => {
    const user = await createTestUser({ role: 'owner' });
    await createProject(owner(user.id), { name: 'Creek Views', developer: 'Emaar', emirate: 'dubai' });
    const second = await createProject(owner(user.id), { name: 'Creek Views', developer: 'Emaar', emirate: 'dubai' });
    const rows = await query<{ slug: string }>('SELECT slug FROM projects WHERE id = ?', [second]);
    expect(rows[0]?.slug).toBe('creek-views-2');
  });

  it('refuses a project with no developer at all', async () => {
    const user = await createTestUser({ role: 'owner' });
    await expect(
      createProject(owner(user.id), { name: 'Nowhere Tower', emirate: 'dubai' }),
    ).rejects.toThrow(/developer/i);
  });

  /*
   * The whole point of the library: a price the CRM can quote. These figures
   * have to survive a re-import of the developer's sheet without duplicating.
   */
  it('imports units as a price version, and re-imports update rather than duplicate', async () => {
    const user = await createTestUser({ role: 'owner' });
    const id = await createProject(owner(user.id), { name: 'Saadiyat Grove', developer: 'Aldar', emirate: 'abu_dhabi' });

    const first = await importUnits(owner(user.id), id, [
      { unitNo: '1204', bedrooms: 2, priceAed: 2_250_000, internalAreaSqft: 1150, status: 'available' },
      { unitNo: '1205', bedrooms: 1, priceAed: 1_450_000, status: 'available' },
    ], { label: 'Launch price list' });
    expect(first.written).toBe(2);

    // The developer sends a revised sheet: 1204 goes up, 1205 is sold.
    const second = await importUnits(owner(user.id), id, [
      { unitNo: '1204', bedrooms: 2, priceAed: 2_400_000, internalAreaSqft: 1150, status: 'available' },
      { unitNo: '1205', bedrooms: 1, priceAed: 1_450_000, status: 'sold' },
    ], { label: 'March revision' });
    expect(second.written).toBe(2);

    const units = await listUnits(id);
    expect(units).toHaveLength(2); // not four
    expect(units.find((u) => u.unit_no === '1204')?.price_aed).toBe(2_400_000);
    expect(units.find((u) => u.unit_no === '1205')?.status).toBe('sold');

    // Both versions are on record, so an offer can say which one it quoted.
    const versions = await query<{ label: string }>('SELECT label FROM unit_price_versions WHERE project_id = ?', [id]);
    expect(versions.map((v) => v.label).sort()).toEqual(['Launch price list', 'March revision']);
  });

  it('counts only available units in the library card', async () => {
    const user = await createTestUser({ role: 'owner' });
    const id = await createProject(owner(user.id), { name: 'Yas Acres', developer: 'Aldar', emirate: 'abu_dhabi' });
    await importUnits(owner(user.id), id, [
      { unitNo: 'A', status: 'available' }, { unitNo: 'B', status: 'available' },
      { unitNo: 'C', status: 'sold' }, { unitNo: 'D', status: 'reserved' },
    ], { label: 'x' });

    const card = (await listLibrary()).find((row) => row.id === id);
    expect(Number(card?.units_available)).toBe(2);
    expect(Number(card?.units_total)).toBe(4);
  });

  it('saves a payment plan with its milestones, and only one plan is the default', async () => {
    const user = await createTestUser({ role: 'owner' });
    const id = await createProject(owner(user.id), { name: 'Palm Jebel Ali', developer: 'Nakheel', emirate: 'dubai' });

    await savePaymentPlan(owner(user.id), id, {
      name: 'Standard 60/40', isDefault: true,
      rows: [
        { milestone: 'On booking', percent: 20 },
        { milestone: 'During construction', percent: 40 },
        { milestone: 'On handover', percent: 40 },
      ],
    });
    await savePaymentPlan(owner(user.id), id, {
      name: 'Post-handover 40/60', isDefault: true,
      rows: [{ milestone: 'On booking', percent: 10 }],
    });

    const plans = await listPaymentPlans(id);
    expect(plans).toHaveLength(2);
    expect(plans.filter((p) => p.is_default === 1)).toHaveLength(1);
    expect(plans.find((p) => p.name === 'Post-handover 40/60')?.is_default).toBe(1);
    expect(plans.find((p) => p.name === 'Standard 60/40')?.rows).toHaveLength(3);
  });

  /*
   * Developers publish plans that do not total 100 — a DLD fee or a service
   * charge year sits outside the schedule. Refusing to save one would just mean
   * the real plan lives on paper.
   */
  it('accepts a plan whose percentages do not total 100', async () => {
    const user = await createTestUser({ role: 'owner' });
    const id = await createProject(owner(user.id), { name: 'Sobha Hartland', developer: 'Sobha', emirate: 'dubai' });
    await expect(
      savePaymentPlan(owner(user.id), id, { name: 'Odd', rows: [{ milestone: 'Booking', percent: 20 }] }),
    ).resolves.toBeTruthy();
  });

  it('archives without touching the leads that point at the project', async () => {
    const user = await createTestUser({ role: 'owner' });
    const id = await createProject(owner(user.id), { name: 'Emaar Beachfront', developer: 'Emaar', emirate: 'dubai' });

    await archiveProject(owner(user.id), id, true);
    expect((await listLibrary()).find((row) => row.id === id)).toBeUndefined();
    expect((await listLibrary({ includeArchived: true })).find((row) => row.id === id)).toBeTruthy();

    await archiveProject(owner(user.id), id, false);
    expect((await listLibrary()).find((row) => row.id === id)).toBeTruthy();
  });

  it('will not delete unless the exact project name is typed back', async () => {
    const user = await createTestUser({ role: 'owner' });
    const id = await createProject(owner(user.id), { name: 'Al Reem Renad Tower', developer: 'Aldar', emirate: 'abu_dhabi' });

    await expect(deleteProject(owner(user.id), id, 'Renad Tower')).rejects.toThrow(/type the project name/i);
    await expect(deleteProject(owner(user.id), id, '')).rejects.toThrow();
    // Still there.
    expect(await query('SELECT id FROM projects WHERE id = ?', [id])).toHaveLength(1);

    await deleteProject(owner(user.id), id, 'Al Reem Renad Tower');
    expect(await query('SELECT id FROM projects WHERE id = ?', [id])).toHaveLength(0);
  });

  it('will not let a manager delete a project even with the right name', async () => {
    const user = await createTestUser({ role: 'manager' });
    const id = await createProject(manager(user.id), { name: 'Manager Tower', developer: 'Emaar', emirate: 'dubai' });
    await expect(deleteProject(manager(user.id), id, 'Manager Tower')).rejects.toThrow(/owner or an admin/i);
  });

  it('takes the units and plans with the project when it is deleted', async () => {
    const user = await createTestUser({ role: 'owner' });
    const id = await createProject(owner(user.id), { name: 'Cascade', developer: 'Emaar', emirate: 'dubai' });
    await importUnits(owner(user.id), id, [{ unitNo: '1', priceAed: 1 }], { label: 'x' });
    await savePaymentPlan(owner(user.id), id, { name: 'P', rows: [{ milestone: 'Booking', percent: 10 }] });

    await deleteProject(owner(user.id), id, 'Cascade');
    expect(await query('SELECT id FROM units WHERE project_id = ?', [id])).toHaveLength(0);
    expect(await query('SELECT id FROM payment_plans WHERE project_id = ?', [id])).toHaveLength(0);
    expect(await query('SELECT id FROM unit_price_versions WHERE project_id = ?', [id])).toHaveLength(0);
  });

  it('keeps the developer when a project under them is deleted, and vice versa', async () => {
    const user = await createTestUser({ role: 'owner' });
    const devId = await createDeveloper(owner(user.id), { legalName: 'Nakheel PJSC', shortName: 'Nakheel' });
    const id = await createProject(owner(user.id), { name: 'Deira Islands', developerId: devId, emirate: 'dubai' });

    await execute('DELETE FROM developers WHERE id = ?', [devId]);
    const rows = await query<{ developer: string; developer_id: string | null }>(
      'SELECT developer, developer_id FROM projects WHERE id = ?', [id],
    );
    // The link is gone but the name survives, so the WhatsApp reply still works.
    expect(rows[0]?.developer_id).toBeNull();
    expect(rows[0]?.developer).toBe('Nakheel');
  });

  it('records a unit status change in the audit log', async () => {
    const user = await createTestUser({ role: 'owner' });
    const id = await createProject(owner(user.id), { name: 'Audit Tower', developer: 'Emaar', emirate: 'dubai' });
    await importUnits(owner(user.id), id, [{ unitNo: '801', priceAed: 1_000_000 }], { label: 'x' });
    const unit = (await listUnits(id))[0];

    await setUnitStatus(owner(user.id), unit!.id, 'reserved');
    const audit = await query<{ action: string }>('SELECT action FROM audit_log WHERE entity_id = ?', [id]);
    expect(audit.map((a) => a.action)).toContain('project.unit_status_changed');
    expect((await listUnits(id))[0]?.status).toBe('reserved');
  });

  /*
   * The library must not disturb what is already live. A project created here
   * is invisible to the WhatsApp reply path until a human verifies it, exactly
   * as the hard rule requires.
   */
  it('does not let an unverified project reach a lead', async () => {
    const user = await createTestUser({ role: 'owner' });
    await createProject(owner(user.id), { name: 'Unverified Heights', developer: 'Emaar', emirate: 'dubai' });
    expect(await findVerifiedProject('Unverified Heights')).toBeNull();

    await execute("UPDATE projects SET verified_at = NOW(3) WHERE name = 'Unverified Heights'");
    expect(await findVerifiedProject('Unverified Heights')).not.toBeNull();
  });

  it('hides the developer commercial terms from the public shape', async () => {
    const user = await createTestUser({ role: 'owner' });
    const devId = await createDeveloper(owner(user.id), {
      legalName: 'Sobha Realty LLC', shortName: 'Sobha', commissionPct: 4.5, paymentTerms: '60 days', notes: 'internal',
    });
    const full = await getDeveloper(devId);
    expect(full.commission_pct).not.toBeNull();

    const shown = publicDeveloper(full) as Record<string, unknown>;
    expect(shown.commission_pct).toBeUndefined();
    expect(shown.payment_terms).toBeUndefined();
    expect(shown.notes).toBeUndefined();
    // But the facts a client may see survive.
    expect(shown.legal_name).toBe('Sobha Realty LLC');
    expect(shown.short_name).toBe('Sobha');
  });

  it('keeps the developer sales contacts', async () => {
    const user = await createTestUser({ role: 'owner' });
    const devId = await createDeveloper(owner(user.id), { legalName: 'Aldar Properties PJSC', shortName: 'Aldar' });
    await addDeveloperContact(owner(user.id), devId, {
      name: 'Layla Hassan', role: 'Broker relations', phone: '+971501112233', isPrimary: true,
    });
    const rows = await query<{ name: string; is_primary: number }>(
      'SELECT name, is_primary FROM developer_contacts WHERE developer_id = ?', [devId],
    );
    expect(rows[0]?.name).toBe('Layla Hassan');
    expect(rows[0]?.is_primary).toBe(1);
  });

  it('renames the text developer when the link is changed', async () => {
    const user = await createTestUser({ role: 'owner' });
    const emaar = await createDeveloper(owner(user.id), { legalName: 'Emaar Properties PJSC', shortName: 'Emaar' });
    const aldar = await createDeveloper(owner(user.id), { legalName: 'Aldar Properties PJSC', shortName: 'Aldar' });
    const id = await createProject(owner(user.id), { name: 'Switching Tower', developerId: emaar, emirate: 'dubai' });

    await updateProject(owner(user.id), id, { developerId: aldar });
    const rows = await query<{ developer: string }>('SELECT developer FROM projects WHERE id = ?', [id]);
    expect(rows[0]?.developer).toBe('Aldar');
  });
  /*
   * These four queries went out returning a 500: they referenced an aggregate
   * by its alias in HAVING, which MySQL allows and MariaDB — the live database
   * — does not. Running them for real is the only way that shows up.
   */
  it('computes the KPI cards without falling over on an empty library', async () => {
    const stats = await libraryStats();
    expect(stats.mostLeads).toBeNull();
    expect(stats.trending).toBeNull();
    expect(stats.bestConverting).toBeNull();
    expect(stats.inventory).toEqual({ available: 0, value_aed: 0, top: [] });
  });

  it('counts available inventory and its value', async () => {
    const user = await createTestUser({ role: 'owner' });
    const a = await createProject(owner(user.id), { name: 'Tower A', developer: 'Emaar', emirate: 'dubai' });
    const b = await createProject(owner(user.id), { name: 'Tower B', developer: 'Aldar', emirate: 'abu_dhabi' });

    await importUnits(owner(user.id), a, [
      { unitNo: '1', priceAed: 1_000_000 },
      { unitNo: '2', priceAed: 2_000_000 },
      { unitNo: '3', priceAed: 9_000_000, status: 'sold' },
    ], { label: 'x' });
    await importUnits(owner(user.id), b, [{ unitNo: '1', priceAed: 3_000_000 }], { label: 'x' });

    const stats = await libraryStats();
    // The sold unit is counted in neither the number nor the value.
    expect(stats.inventory.available).toBe(3);
    expect(stats.inventory.value_aed).toBe(6_000_000);
    expect(stats.inventory.top.map((row) => row.name)).toContain('Tower A');
  });

  it('names the project bringing the most leads', async () => {
    const user = await createTestUser({ role: 'owner' });
    // A real pipeline stage, because opportunities.stage_id is a foreign key —
    // the seeded stages survive resetTables.
    const stage = await query<{ id: string; pipeline_id: string }>(
      "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'new_lead' LIMIT 1",
    );
    const { id: stageId, pipeline_id: pipelineId } = stage[0]!;

    const addLead = async (project: string) => {
      const contactId = newId();
      await execute(
        'INSERT INTO contacts (id, full_name, phone_e164, owner_user_id, first_source) VALUES (?, ?, ?, ?, ?)',
        [contactId, 'Lead', `+9715${Math.floor(Math.random() * 1e8).toString().padStart(8, '0')}`, user.id, 'csv_import'],
      );
      await execute(
        `INSERT INTO opportunities (id, contact_id, pipeline_id, stage_id, stage_key, project_name, source, owner_user_id)
         VALUES (?, ?, ?, ?, 'new_lead', ?, 'csv_import', ?)`,
        [newId(), contactId, pipelineId, stageId, project, user.id],
      );
    };

    await addLead('Emaar Beachfront');
    await addLead('Emaar Beachfront');
    await addLead('Emaar Beachfront');
    await addLead('Sobha Hartland');

    const stats = await libraryStats();
    expect(stats.mostLeads?.project_name).toBe('Emaar Beachfront');
    expect(stats.mostLeads?.leads).toBe(3);
  });

  /**
   * Emir AI reads "ALDAR" off a brochure and the wizard stored it as loose text
   * with `developer_id` left null — so the project never appeared under Aldar on
   * the Developers screen, and an offer built from it had no ORN, no escrow bank
   * and nobody to ring.
   */
  it('files a typed developer name under the developer we already hold', async () => {
    const user = await createTestUser({ role: 'owner' });
    const devId = await createDeveloper(owner(user.id), {
      legalName: 'Aldar Properties PJSC', shortName: 'Aldar',
    });

    // The brochure's spelling, not the record's.
    const id = await createProject(owner(user.id), {
      name: 'Sei Saadiyat', developer: 'ALDAR', emirate: 'abu_dhabi',
    });

    const rows = await query<{ developer_id: string | null; developer: string }>(
      'SELECT developer_id, developer FROM projects WHERE id = ?', [id],
    );
    expect(rows[0]?.developer_id).toBe(devId);
    // And the text column follows the record, so the WhatsApp replies agree.
    expect(rows[0]?.developer).toBe('Aldar');
  });

  it('matches a short name against the full legal name', async () => {
    const user = await createTestUser({ role: 'owner' });
    const devId = await createDeveloper(owner(user.id), {
      legalName: 'Emaar Properties PJSC', shortName: 'Emaar',
    });

    const id = await createProject(owner(user.id), {
      name: 'Creek Harbour', developer: 'Emaar Properties', emirate: 'dubai',
    });

    const rows = await query<{ developer_id: string | null }>(
      'SELECT developer_id FROM projects WHERE id = ?', [id],
    );
    expect(rows[0]?.developer_id).toBe(devId);
  });

  /* Guessing between two look-alike records would file a project under the wrong
     company, which is worse than filing it under none. */
  it('leaves an ambiguous name unlinked rather than guessing', async () => {
    const user = await createTestUser({ role: 'owner' });
    await createDeveloper(owner(user.id), { legalName: 'Damac Lagoons LLC', shortName: 'Damac Lagoons' });
    await createDeveloper(owner(user.id), { legalName: 'Damac Islands LLC', shortName: 'Damac Islands' });

    // Prefixes both and is neither: two companies could be meant.
    const id = await createProject(owner(user.id), {
      name: 'Somewhere', developer: 'Damac', emirate: 'dubai',
    });

    const rows = await query<{ developer_id: string | null; developer: string }>(
      'SELECT developer_id, developer FROM projects WHERE id = ?', [id],
    );
    expect(rows[0]?.developer_id).toBeNull();
    // The name is still kept, so nothing is lost.
    expect(rows[0]?.developer).toBe('Damac');
  });

  it('never invents a developer from a name on a brochure', async () => {
    const user = await createTestUser({ role: 'owner' });

    await createProject(owner(user.id), {
      name: 'Somewhere New', developer: 'A Developer Nobody Has Heard Of', emirate: 'dubai',
    });

    expect(await query('SELECT id FROM developers', [])).toHaveLength(0);
  });

  it('keeps an explicitly chosen developer over anything typed', async () => {
    const user = await createTestUser({ role: 'owner' });
    const chosen = await createDeveloper(owner(user.id), { legalName: 'Sobha Realty', shortName: 'Sobha' });
    await createDeveloper(owner(user.id), { legalName: 'Emaar Properties PJSC', shortName: 'Emaar' });

    const id = await createProject(owner(user.id), {
      name: 'A Tower', developerId: chosen, developer: 'Emaar', emirate: 'dubai',
    });

    const rows = await query<{ developer_id: string | null; developer: string }>(
      'SELECT developer_id, developer FROM projects WHERE id = ?', [id],
    );
    expect(rows[0]?.developer_id).toBe(chosen);
    expect(rows[0]?.developer).toBe('Sobha');
  });
});
