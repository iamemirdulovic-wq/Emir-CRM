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

  it('starts the clock when, and only when, Hot is chosen', async () => {
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
