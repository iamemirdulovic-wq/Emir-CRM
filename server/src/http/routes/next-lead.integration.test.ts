import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../../testing/db.js';
import { execute, queryOne } from '../../db/client.js';
import { newId } from '../../lib/ids.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { createApp } from '../app.js';
import { signIn } from '../../testing/http.js';

/**
 * "Next lead", and the mistake that hid it.
 *
 * I scoped it to `owner_user_id = me` first. For an agent that is right; for
 * Emir it meant the button never rendered at all, because an owner
 * personally holds almost no leads while the screen behind him shows
 * hundreds. He opened a lead, saw no button, and asked where it was.
 *
 * These tests are written from the roles rather than the query: what does
 * the owner get, what does the agent get, what does a manager get.
 */
let server: Server;
let base = '';

async function stage(ownerUserId: string | null, name: string, minutesAgo: number): Promise<string> {
  const stageRow = await queryOne<{ id: string; pipeline_id: string }>(
    "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'new_lead' ORDER BY position LIMIT 1", [],
  );
  if (!stageRow) throw new Error('no new_lead stage: the test database was not seeded');
  const contactId = newId();
  const opportunityId = newId();
  await execute(
    'INSERT INTO contacts (id, full_name, phone_e164, language) VALUES (?, ?, ?, ?)',
    [contactId, name, `+9715${String(60_000_000 + minutesAgo)}`, 'en'],
  );
  await execute(
    `INSERT INTO opportunities
       (id, contact_id, pipeline_id, stage_id, stage_key, status, source, title, owner_user_id, created_at)
     VALUES (?, ?, ?, ?, 'new_lead', 'open', 'walk_in', ?, ?, DATE_SUB(NOW(3), INTERVAL ? MINUTE))`,
    [opportunityId, contactId, stageRow.pipeline_id, stageRow.id, name, ownerUserId, minutesAgo],
  );
  return opportunityId;
}

const nextAfter = async (cookie: string, id: string) => {
  const res = await fetch(`${base}/api/my-leads/${id}/next`, { headers: { cookie } });
  return (await res.json() as { next: { id: string; full_name: string } | null }).next;
};

describeWithDb('the Next lead button', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });
  beforeEach(async () => { await resetTables(); resetRateLimits(); });

  /* The one that was broken. */
  it('gives the owner a next lead even when he owns none himself', async () => {
    const emir = await createTestUser({ role: 'owner', name: 'Emir' });
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    const oldest = await stage(tej.id, 'Oldest', 300);
    const here = await stage(tej.id, 'The one he is reading', 100);

    const next = await nextAfter(await signIn(base, emir), here);
    expect(next, 'the button was invisible for him before this').not.toBeNull();
    expect(next?.id).toBe(oldest);
    expect(next?.full_name).toBe('Oldest');
  });

  it('sends the agent only to their own leads', async () => {
    const tej = await createTestUser({ role: 'agent', name: 'Tej' });
    const talha = await createTestUser({ role: 'agent', name: 'Talha' });
    await stage(talha.id, 'Talha’s, and older', 500);
    const mine = await stage(tej.id, 'Tej’s other one', 200);
    const here = await stage(tej.id, 'Reading this', 100);

    const next = await nextAfter(await signIn(base, tej), here);
    expect(next?.id, 'never a colleague’s lead, however old').toBe(mine);
  });

  it('skips the lead being read', async () => {
    const emir = await createTestUser({ role: 'owner' });
    const tej = await createTestUser({ role: 'agent' });
    const here = await stage(tej.id, 'Only one open', 100);

    expect(await nextAfter(await signIn(base, emir), here), 'nothing else to go to').toBeNull();
  });

  it('oldest first, because that is the one going coldest', async () => {
    const emir = await createTestUser({ role: 'owner' });
    const tej = await createTestUser({ role: 'agent' });
    const oldest = await stage(tej.id, 'Three days cold', 4320);
    await stage(tej.id, 'An hour old', 60);
    const here = await stage(tej.id, 'Reading this', 10);

    expect((await nextAfter(await signIn(base, emir), here))?.id).toBe(oldest);
  });

  it('never offers a closed lead', async () => {
    const emir = await createTestUser({ role: 'owner' });
    const tej = await createTestUser({ role: 'agent' });
    const won = await stage(tej.id, 'Already won', 900);
    await execute("UPDATE opportunities SET status = 'won' WHERE id = ?", [won]);
    const here = await stage(tej.id, 'Reading this', 100);

    expect(await nextAfter(await signIn(base, emir), here)).toBeNull();
  });

  /* An unowned lead belongs in Incoming, where a person places it, and is
     not somewhere this button should drop an agent. */
  it('never offers a lead nobody owns', async () => {
    const emir = await createTestUser({ role: 'owner' });
    const tej = await createTestUser({ role: 'agent' });
    await stage(null, 'Waiting in Incoming', 999);
    const here = await stage(tej.id, 'Reading this', 100);

    expect(await nextAfter(await signIn(base, emir), here)).toBeNull();
  });
});
