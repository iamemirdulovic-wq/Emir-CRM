import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
  type TestUser,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { clearSecretCache } from '../config/secrets.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';

/**
 * The three things the No answer list owes the screens, against a real
 * database: which result the last try was, the "3+ times" filter over the
 * whole book, and the dialler's queue for a tab other than Today.
 *
 * All three were gaps rather than bugs — nothing was wrong, the data simply
 * was not there — and all three are the kind of gap only a real database
 * shows. The last result comes out of a JSON column, the filter has to agree
 * with a COUNT over the same clause, and the queue has to pick up a tab's own
 * ORDER BY. None of that can be checked by reading the source.
 *
 * Production is MariaDB and this runs on MySQL 8 (see CLAUDE.md), so: no date
 * is bound as a string anywhere below, and no aggregate is named by its alias.
 */
let server: Server;
let base = '';

describeWithDb('the No answer list, end to end', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    setEnvForTesting(null);
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });
  beforeEach(async () => { await resetTables(); resetRateLimits(); clearSecretCache(); });
  afterEach(() => { resetRateLimits(); clearSecretCache(); });

  async function aLead(owner: string, name: string): Promise<string> {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, language) VALUES (?, ?, ?, ?)',
      [contactId, name, `+9715${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`, 'en'],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title,
          source, project_name)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, 'manual', 'Sei Saadiyat')`,
      [id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner, name],
    );
    return id;
  }

  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const save = (cookie: string, lead: string, result: string) =>
    send('POST', `/api/v2/leads/${lead}/call-result`, cookie, { result });

  interface Row {
    id: string;
    full_name: string | null;
    noAnswer: {
      tries: number;
      lastTryAt: string | null;
      nextTryAt: string | null;
      lastResult: 'no_answer' | 'busy' | null;
    } | null;
  }

  const list = async (cookie: string, qs: string) => {
    const res = await send('GET', `/api/my-leads?${qs}`, cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    return await res.json() as { items: Row[]; total: number; tab: string };
  };

  /* ── which result the last try was ──────────────────────────────────── */

  it('says on the row whether the last try was a busy line or no answer', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const rangOut = await aLead(agent.id, 'Rang out');
    const engaged = await aLead(agent.id, 'Engaged tone');
    const neverRung = await aLead(agent.id, 'Never rung');

    expect((await save(cookie, rangOut, 'no_answer')).status).toBe(200);
    expect((await save(cookie, rangOut, 'no_answer')).status).toBe(200);
    expect((await save(cookie, engaged, 'busy')).status).toBe(200);

    const got = await list(cookie, 'tab=all&pageSize=50');
    const by = new Map(got.items.map((row) => [row.id, row]));

    /* Two tries, and the last of them a no-answer: the pill reads
       "No answer ×2". */
    expect(by.get(rangOut)?.noAnswer).toMatchObject({ tries: 2, lastResult: 'no_answer' });
    /*
     * One try, and it was a busy line: "Busy ×1", which is what the owner's
     * picture draws and what the row could never say — the count is a total
     * of the two results and the row carried nothing else.
     */
    expect(by.get(engaged)?.noAnswer).toMatchObject({ tries: 1, lastResult: 'busy' });
    /* And a lead nobody has rung carries no block at all (contract §3). */
    expect(by.get(neverRung)?.noAnswer).toBeNull();
  });

  it('reads the last result and not the first, and a busy after a no answer wins', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id, 'Two tries');

    await save(cookie, lead, 'no_answer');
    await save(cookie, lead, 'busy');

    const got = await list(cookie, 'tab=no_answer&pageSize=50');
    expect(got.items[0]?.noAnswer).toMatchObject({ tries: 2, lastResult: 'busy' });
  });

  it('forgets the result with the try when the try is taken back', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id, 'Taken back');

    await save(cookie, lead, 'no_answer');
    await save(cookie, lead, 'busy');
    /*
     * §1b. The undo marks that timeline row taken back, and the last result
     * is read off the same row the last try is — so undoing the busy leaves
     * the row saying "No answer ×1" rather than keeping a result the agent
     * has withdrawn. That is the whole reason it is stored there and not on
     * the call log, which the undo does not touch.
     */
    const undone = await send('DELETE', `/api/v2/leads/${lead}/call-result`, cookie);
    expect(undone.status, await undone.clone().text()).toBe(200);

    const got = await list(cookie, 'tab=no_answer&pageSize=50');
    expect(got.items[0]?.noAnswer).toMatchObject({ tries: 1, lastResult: 'no_answer' });
  });

  it('says nothing rather than guessing for a try logged another way', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id, 'Old try');

    /* A no-answer logged through the ordinary lead action, which is the path
       every try took before the result was recorded on the row. */
    const res = await send('POST', `/api/my-leads/${lead}/action`, cookie, { action: 'no_answer' });
    expect(res.status, await res.clone().text()).toBe(200);

    const got = await list(cookie, 'tab=no_answer&pageSize=50');
    /* The try is counted; the result is null, and the screen then says "No
       answer" — the action's own meaning, never a guess at "Busy". */
    expect(got.items[0]?.noAnswer).toMatchObject({ tries: 1, lastResult: null });
  });

  /* ── "No answer 3+ times" over the whole book (H.2) ─────────────────── */

  it('filters the whole book by the fewest tries, not the page in hand', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const once = await aLead(agent.id, 'Rung once');
    const thrice = await aLead(agent.id, 'Rung three times');
    await aLead(agent.id, 'Never rung');

    await save(cookie, once, 'no_answer');
    await save(cookie, thrice, 'no_answer');
    await save(cookie, thrice, 'no_answer');
    await save(cookie, thrice, 'busy');

    const all = await list(cookie, 'tab=all&pageSize=50');
    expect(all.total).toBe(3);

    const many = await list(cookie, 'tab=all&tries=3&pageSize=50');
    /*
     * The total is the filtered total and not the book's — which is the
     * whole point. The screen used to narrow the fifty rows it had and say
     * "12 of the 50 loaded", because the parameter did not exist.
     */
    expect(many.total).toBe(1);
    expect(many.items.map((row) => row.id)).toEqual([thrice]);
    /* And a busy counts towards it, because `tries` counts the two together
       (contract §1) and the filter reads the same column. */
    expect(many.items[0]?.noAnswer?.tries).toBe(3);

    /* The tab counts narrow with it too, so the number on a tab and the list
       under it cannot disagree while the filter is on. */
    const counts = await send('GET', '/api/my-leads/counts?tries=3', cookie);
    expect(counts.status).toBe(200);
    expect((await counts.json() as Record<string, number>).all).toBe(1);
  });

  it('ignores a minimum of one, and refuses a nonsense one', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id, 'Rung once');
    await save(cookie, lead, 'no_answer');

    expect((await list(cookie, 'tab=all&tries=1&pageSize=50')).total).toBe(1);
    /* A hand-typed `?tries=x` is refused rather than silently showing an
       unfiltered list under a filter chip. */
    expect((await send('GET', '/api/my-leads?tab=all&tries=x', cookie)).status).toBe(400);
  });

  /* ── "Call these one by one" (B.7) ──────────────────────────────────── */

  it('hands the dialler the No answer tab when it asks for it', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const rungOut = await aLead(agent.id, 'Rang out');
    const engaged = await aLead(agent.id, 'Engaged tone');
    const neverRung = await aLead(agent.id, 'Never rung');

    await save(cookie, rungOut, 'no_answer');
    await save(cookie, engaged, 'busy');

    const res = await send('GET', '/api/v2/queue?tab=no_answer', cookie);
    expect(res.status, await res.clone().text()).toBe(200);
    const got = await res.json() as { tab: string; items: Array<{ id: string }> };

    expect(got.tab).toBe('no_answer');
    /* Exactly the tab's own rows: everybody rung and not spoken to, and
       nobody else. The lead with no try on it is not in a list of second
       tries. */
    expect([...got.items.map((one) => one.id)].sort()).toEqual([rungOut, engaged].sort());
    expect(got.items.map((one) => one.id)).not.toContain(neverRung);
  });

  it('still hands it Today when nothing is asked, and falls back on nonsense', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id, 'Rang out');
    await save(cookie, lead, 'no_answer');

    const plain = await (await send('GET', '/api/v2/queue', cookie)).json() as { tab: string };
    expect(plain.tab).toBe('today');
    /*
     * A tab name nothing recognises falls back to Today rather than being
     * refused: a hand-typed `?tab=` should not empty somebody's calling
     * list in the middle of a session.
     */
    const odd = await send('GET', '/api/v2/queue?tab=not-a-tab', cookie);
    expect(odd.status).toBe(200);
    expect((await odd.json() as { tab: string }).tab).toBe('today');
  });

  it('keeps the queue to the leads this person may see', async () => {
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    const myLead = await aLead(mine.id, 'Mine');
    const theirLead = await aLead(theirs.id, 'Theirs');

    const theirCookie = await signIn(base, theirs);
    await save(theirCookie, theirLead, 'no_answer');
    const cookie = await signIn(base, mine);
    await save(cookie, myLead, 'no_answer');

    const got = await (await send('GET', '/api/v2/queue?tab=no_answer', cookie))
      .json() as { items: Array<{ id: string }> };
    expect(got.items.map((one) => one.id)).toEqual([myLead]);
  });
});
