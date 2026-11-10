import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { execute, query } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { setEnvForTesting } from '../../config/env.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';
import { defaultSettings } from '../../imports/normalize.js';
import { suggestMapping } from '../../imports/mapping.js';
import { runChunk, stageRows } from '../../imports/run.js';
import { loadBoard } from '../../services/opportunities.js';
import { runSlaCheck } from '../../workflows/workflow-a.js';
import { saveRoutingSettings } from '../../routing/settings.js';
import { SYSTEM_ACTOR } from '../../audit/audit.js';
import { DEFAULT_PIPELINE_KEY } from '../../pipeline/stages.js';

/**
 * A countdown on a card means a countdown that is running.
 *
 * Emir, three times, with screenshots: he uploads a file, hands the leads to
 * an agent, and every card on the board is counting down from five minutes.
 * Nothing is going to bounce those leads -- he placed them deliberately --
 * so the clock is a lie, and a lie that makes agents panic.
 *
 * The pieces were each fixed and tested on their own: the importer arms no
 * timer, the migration called off the ones already armed, and the board reads
 * the real job rather than guessing `created_at + 5 minutes`. What was never
 * tested is the whole path he actually walks, which is the only thing that
 * settles the question. So this walks it: upload, import, hand out, look at
 * the board.
 *
 * It also holds the other direction. "Hot" has to keep working, or the fix
 * for the countdown quietly removes the five-minute rule.
 */
let server: Server;
let base = '';
let workDir = '';

describeWithDb('an imported lead carries no clock', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    workDir = await mkdtemp(join(tmpdir(), 'emir-clock-'));
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setEnvForTesting(null);
    await rm(workDir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
    resetRateLimits();
  });
  afterEach(() => resetRateLimits());

  /** Upload a small file and import it, the way the CRM does. */
  async function importThreeLeads(): Promise<string[]> {
    const csv = [
      'Full Name,Phone,Project',
      'Sunitha Jaichandran,0501111111,KORE by Imtiaz',
      'Jack,0502222222,KORE by Imtiaz',
      'Artur Miguel,0503333333,KORE by Imtiaz',
    ].join('\n');

    const importId = newId();
    const path = join(workDir, `${importId}.csv`);
    await writeFile(path, csv, 'utf8');
    const headers = (csv.split('\n')[0] ?? '').split(',');

    await execute(
      `INSERT INTO imports (id, filename, file_path, file_kind, byte_size, status, headers, mapping, settings)
       VALUES (?, 'leads.csv', ?, 'csv', ?, 'uploaded', ?, ?, ?)`,
      [
        importId, path, Buffer.byteLength(csv),
        JSON.stringify(headers),
        JSON.stringify(suggestMapping(headers)),
        JSON.stringify({ ...defaultSettings(), sourceLabel: 'agent_1_leads' }),
      ],
    );

    await stageRows(importId);
    for (let guard = 0; guard < 20; guard++) {
      if ((await runChunk(importId)).done) break;
    }

    const rows = await query<{ id: string }>(
      "SELECT id FROM opportunities WHERE stage_key = 'new_lead' ORDER BY created_at",
    );
    expect(rows).toHaveLength(3);
    return rows.map((row) => row.id);
  }

  /**
   * What the board would draw: the deadline on each New Lead card.
   *
   * `visibleUserIds` null is everything, which is what the owner sees; an
   * agent is scoped to their own.
   */
  async function clocksOnTheBoard(visibleUserIds: string[] | null): Promise<unknown[]> {
    const board = await loadBoard({ visibleUserIds, pipelineKey: DEFAULT_PIPELINE_KEY });
    const stage = board.find((s) => s.stageKey === 'new_lead');
    return (stage?.cards ?? []).map((card) => card.sla_due_at);
  }

  async function handOut(cookie: string, ids: string[], agentUserId: string, urgent?: boolean) {
    const res = await fetch(`${base}/api/incoming/assign`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        opportunityIds: ids,
        agentUserId,
        ...(urgent === undefined ? {} : { urgent }),
      }),
    });
    expect(res.status).toBe(200);
    return res.json() as Promise<{ assigned: number }>;
  }

  /*
   * Through the real endpoint, not just the function behind it.
   *
   * The first version of these tests called `loadBoard` directly, so it had
   * nothing to say when /pipeline answered "Internal server error" on the
   * live site. The board is what the route returns, so the route is what
   * has to be asked.
   */
  it('serves the board over HTTP, with the clock column on every card', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir' });
    await importThreeLeads();
    const cookie = await signIn(base, boss);

    const res = await fetch(`${base}/api/pipeline/board`, { headers: { cookie } });
    expect(res.status, await res.clone().text()).toBe(200);

    const body = await res.json() as { columns: { stageKey: string; cards: Record<string, unknown>[] }[] };
    const newLead = body.columns.find((c) => c.stageKey === 'new_lead');
    expect(newLead?.cards).toHaveLength(3);
    for (const card of newLead?.cards ?? []) {
      expect(card, 'every card carries the field, even when empty').toHaveProperty('sla_due_at');
      expect(card.sla_due_at).toBeNull();
    }
  });

  it('shows no countdown after a file is imported', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir' });
    await importThreeLeads();

    expect(await clocksOnTheBoard(null)).toEqual([null, null, null]);
    /* And nothing armed behind the scenes that could bounce them later. */
    expect(await query("SELECT id FROM jobs WHERE type = 'workflow.a.sla_check' AND status = 'pending'"))
      .toHaveLength(0);
  });

  it('still shows no countdown once the leads are handed to an agent', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir' });
    const agent = await createTestUser({ role: 'agent', name: 'Test Agents' });
    const ids = await importThreeLeads();
    const cookie = await signIn(base, boss);

    const result = await handOut(cookie, ids, agent.id);
    expect(result.assigned).toBe(3);

    /* The screenshot that started this: three cards, "4:29 left" on each. */
    expect(await clocksOnTheBoard(null)).toEqual([null, null, null]);
    expect(await clocksOnTheBoard([agent.id])).toEqual([null, null, null]);
  });

  /*
   * The fourth way in. Assigning an imported lead arms nothing, but the agent
   * then presses Accept -- or "Take them all" -- and the action clock starts,
   * which is what Emir photographed: cards counting 4:29, 4:31, 4:26, all
   * different, so all real.
   */
  it('starts no clock when the agent accepts an imported lead', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir' });
    const agent = await createTestUser({ role: 'agent', name: 'Test Agents' });
    const ids = await importThreeLeads();
    await handOut(await signIn(base, boss), ids, agent.id);

    const agentCookie = await signIn(base, agent);
    const accepted = await fetch(`${base}/api/incoming/${ids[0]}/accept`, {
      method: 'POST', headers: { cookie: agentCookie },
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);

    expect(await clocksOnTheBoard(null)).toEqual([null, null, null]);
  });

  it('starts no clock when the agent takes them all at once', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir' });
    const agent = await createTestUser({ role: 'agent', name: 'Test Agents' });
    const ids = await importThreeLeads();
    await handOut(await signIn(base, boss), ids, agent.id);

    const agentCookie = await signIn(base, agent);
    const res = await fetch(`${base}/api/incoming/accept-all`, {
      method: 'POST', headers: { cookie: agentCookie },
    });
    expect(res.status, await res.clone().text()).toBe(200);

    expect(await clocksOnTheBoard(null)).toEqual([null, null, null]);
    expect(await query("SELECT id FROM jobs WHERE type LIKE 'workflow.a.sla%' AND status = 'pending'"))
      .toHaveLength(0);
  });

  /*
   * Six hundred of these were already queued against imported leads before
   * the rule existed. They are not cancelled -- that would be another bulk
   * UPDATE over `jobs`, and one of those took the site down twice today.
   * They fire, decline, and clear themselves.
   */
  it('a clock already queued against an imported lead takes nobody off the agent', async () => {
    const boss = await createTestUser({ role: 'owner', name: 'Emir' });
    const agent = await createTestUser({ role: 'agent', name: 'Test Agents' });
    const ids = await importThreeLeads();
    await handOut(await signIn(base, boss), ids, agent.id);

    const opportunityId = ids[0]!;
    const contactId = (await query<{ contact_id: string }>(
      'SELECT contact_id FROM opportunities WHERE id = ?', [opportunityId],
    ))[0]!.contact_id;

    const outcome = await runSlaCheck({
      opportunityId, contactId, assignedUserId: agent.id, phase: 'action',
    });

    expect(outcome.breached).toBe(false);
    expect(outcome.bounced).toBeFalsy();
    const after = await query<{ owner_user_id: string | null; sla_breached: number }>(
      'SELECT owner_user_id, sla_breached FROM opportunities WHERE id = ?', [opportunityId],
    );
    expect(after[0]?.owner_user_id, 'the lead stays with the agent').toBe(agent.id);
    expect(Number(after[0]?.sla_breached)).toBe(0);
  });

  it('starts the clock when, and only when, Hot is chosen', async () => {
    /* The rule is off by default since 10 Nov; Hot only means something
       once the owner has switched it back on. */
    await saveRoutingSettings(SYSTEM_ACTOR, { slaEnabled: true });
    const boss = await createTestUser({ role: 'owner', name: 'Emir' });
    const agent = await createTestUser({ role: 'agent', name: 'Test Agents' });
    const ids = await importThreeLeads();
    const cookie = await signIn(base, boss);

    await handOut(cookie, ids, agent.id, true);

    const clocks = await clocksOnTheBoard(null);
    expect(clocks).toHaveLength(3);
    for (const due of clocks) expect(due).not.toBeNull();
  });
});
