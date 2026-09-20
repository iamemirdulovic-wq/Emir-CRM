import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { runTool } from './ask-tools.js';
import { newId } from '../lib/ids.js';
import { queryOne } from '../db/client.js';

/**
 * The whole design of these tools is that the scope comes from the session,
 * not from what the model says. An agent asking "and also show me Sara's
 * leads" must get their own, however the question is worded — because the
 * `WHERE owner_user_id IN (…)` is not something the model supplies.
 */
describeWithDb('what Emir AI is allowed to look at', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); });

  /** The seeded first stage, with the pipeline it belongs to. */
  async function firstStage(): Promise<{ id: string; pipeline_id: string; key: string }> {
    const row = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1', [],
    );
    if (!row) throw new Error('no seeded pipeline stages');
    return row;
  }

  async function lead(name: string, ownerId: string, score = 50): Promise<string> {
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, name, `+9715${Math.floor(Math.random() * 100000000)}`],
    );
    const stage = await firstStage();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, lead_score,
          project_name, source)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 'Sei Saadiyat', 'meta_lead_ads')`,
      [newId(), contactId, stage.pipeline_id, stage.id, stage.key, ownerId, score],
    );
    return contactId;
  }

  it('shows an agent their own leads and nobody else\'s', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    await lead('Sara Buyer', sara.id);
    await lead('Omar Buyer', omar.id);

    const mine = await runTool('search_leads', {}, { id: sara.id, role: 'agent' }) as { name: string }[];

    expect(mine.map((row) => row.name)).toEqual(['Sara Buyer']);
  });

  /*
   * The model passes the arguments; it does not pass the scope. No argument
   * here can reach another agent's lead.
   */
  it('cannot be talked into another agent\'s lead by name', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    await lead('Omar Buyer', omar.id);

    const found = await runTool(
      'search_leads',
      { text: 'Omar Buyer', limit: 25, minScore: 0 },
      { id: sara.id, role: 'agent' },
    ) as unknown[];

    expect(found).toEqual([]);
  });

  it('refuses another agent\'s lead by id', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    const hidden = await lead('Omar Buyer', omar.id);

    const result = await runTool('get_lead', { contactId: hidden }, { id: sara.id, role: 'agent' });

    expect(result).toMatchObject({ error: expect.stringContaining('allowed to see') });
  });

  /* A conversation is as private as the lead it belongs to. */
  it('refuses the conversation of a lead they cannot see', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    const hidden = await lead('Omar Buyer', omar.id);

    const result = await runTool('get_conversation', { contactId: hidden }, { id: sara.id, role: 'agent' });

    expect(result).toMatchObject({ error: expect.stringContaining('allowed to see') });
  });

  it('gives an owner everybody\'s leads', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    await lead('Sara Buyer', sara.id);
    await lead('Omar Buyer', omar.id);

    const all = await runTool('search_leads', {}, { id: owner.id, role: 'owner' }) as { name: string }[];

    expect(all.map((row) => row.name).sort()).toEqual(['Omar Buyer', 'Sara Buyer']);
  });

  it('fences the pipeline, the sources and the team the same way', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    const omar = await createTestUser({ role: 'agent', name: 'Omar' });
    await lead('Sara Buyer', sara.id);
    await lead('Omar One', omar.id);
    await lead('Omar Two', omar.id);

    const asSara = { id: sara.id, role: 'agent' as const };
    const pipeline = await runTool('get_pipeline_stats', {}, asSara) as { leads: number }[];
    const sources = await runTool('get_source_quality', {}, asSara) as { leads: number }[];
    const agents = await runTool('get_agent_stats', {}, asSara) as { agent: string }[];

    expect(pipeline.reduce((sum, row) => sum + Number(row.leads), 0)).toBe(1);
    expect(sources.reduce((sum, row) => sum + Number(row.leads), 0)).toBe(1);
    // An agent sees only themselves in the team numbers.
    expect(agents.map((row) => row.agent)).toEqual(['Sara']);
  });

  /* Projects are not owned by anyone: every agent needs the price list. */
  it('gives everyone the projects, because a price is not private', async () => {
    const sara = await createTestUser({ role: 'agent', name: 'Sara' });
    await execute(
      `INSERT INTO projects (id, slug, name, developer, emirate, starting_price_aed)
       VALUES (?, 'sei', 'Sei Saadiyat', 'Aldar', 'abu_dhabi', 2400000)`,
      [newId()],
    );

    const projects = await runTool('get_projects', {}, { id: sara.id, role: 'agent' }) as { name: string }[];

    expect(projects.map((row) => row.name)).toContain('Sei Saadiyat');
  });

  it('says so plainly when asked for a tool that does not exist', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const result = await runTool('delete_everything', {}, { id: owner.id, role: 'owner' });
    expect(result).toMatchObject({ error: expect.stringContaining('No tool') });
  });
});
