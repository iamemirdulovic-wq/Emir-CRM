import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';
import { newId } from '../lib/ids.js';

/**
 * Sales offers, as `design/web/sales-offers.html` draws them.
 *
 * The rules worth a test are the ones that cost money or trust when they
 * break: an offer is never built for somebody else's lead, a price is an
 * integer of whole AED and survives the round trip, an offer the client has
 * already seen cannot be deleted, and nothing here sends anything.
 */
let server: Server;
let base = '';

const day = (offset: number) =>
  new Date(Date.now() + 4 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

describeWithDb('sales offers', () => {
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
  beforeEach(async () => { await resetTables(); resetRateLimits(); });
  afterEach(() => resetRateLimits());

  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** A lead belonging to someone, with a contact behind it. */
  async function aLead(ownerId: string, name = 'Ahmed Khan'): Promise<string> {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    const oppId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, name, `+9715${Math.floor(Math.random() * 90_000_000 + 10_000_000)}`],
    );
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'x', 'manual')`,
      [oppId, contactId, stage!.pipeline_id, stage!.id, stage!.key, ownerId],
    );
    return oppId;
  }

  const anOffer = (opportunityId: string) => ({
    opportunityId,
    unitLabel: '2BR · 1204',
    priceAed: 2_050_000,
    paymentPlan: '60 / 40',
    validUntil: day(7),
    note: 'High floor, canal view.',
  });

  it('makes a draft that has sent nothing', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);

    const res = await send('POST', '/api/v2/offers', cookie, anOffer(lead));
    expect(res.status, await res.clone().text()).toBe(201);
    const made = await res.json() as {
      id: string; status: string; priceAed: number; reference: string; slug: string;
      sharedAt: string | null; opens: number;
    };

    expect(made.status).toBe('draft');
    expect(made.sharedAt).toBeNull();
    expect(made.opens).toBe(0);
    /* The price is a whole number of AED, not a float and not fils. */
    expect(made.priceAed).toBe(2_050_000);
    expect(made.reference).toMatch(/^SO-\d{4}$/);
    /* The public address is long enough not to be guessed. */
    expect(made.slug.length).toBeGreaterThanOrEqual(32);

    const row = await queryOne<{ status: string; sent_at: string | null; price_aed: number }>(
      'SELECT status, sent_at, price_aed FROM offers WHERE id = ?', [made.id],
    );
    expect(row?.status).toBe('draft');
    expect(row?.sent_at).toBeNull();
    expect(Number(row?.price_aed)).toBe(2_050_000);
  });

  it('refuses to build an offer on somebody else\'s lead', async () => {
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    const theirLead = await aLead(theirs.id);

    const res = await send('POST', '/api/v2/offers', await signIn(base, mine), anOffer(theirLead));
    expect(res.status).toBe(404);
  });

  it('refuses a valid-until day in the past', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const lead = await aLead(agent.id);
    const res = await send('POST', '/api/v2/offers', await signIn(base, agent), {
      ...anOffer(lead), validUntil: day(-1),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('past');
  });

  it('moves draft → shared → accepted, and records who did it', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    const made = await (await send('POST', '/api/v2/offers', cookie, anOffer(lead))).json() as { id: string };

    /* Accepted before it has been shared makes no sense and is refused. */
    expect((await send('POST', `/api/v2/offers/${made.id}/accepted`, cookie)).status).toBe(400);

    const shared = await (await send('POST', `/api/v2/offers/${made.id}/shared`, cookie)).json() as {
      status: string; sharedAt: string | null;
    };
    expect(shared.status).toBe('shared');
    expect(shared.sharedAt).not.toBeNull();

    const accepted = await (await send('POST', `/api/v2/offers/${made.id}/accepted`, cookie)).json() as {
      status: string; acceptedAt: string | null;
    };
    expect(accepted.status).toBe('accepted');
    expect(accepted.acceptedAt).not.toBeNull();

    const trail = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM audit_log
        WHERE entity_id = ? AND action IN
          ('offer.sheet.created','offer.sheet.shared','offer.sheet.accepted')`,
      [made.id],
    );
    expect(Number(trail?.n)).toBe(3);
  });

  it('will not delete an offer the client has been sent', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    const made = await (await send('POST', '/api/v2/offers', cookie, anOffer(lead))).json() as { id: string };

    /* A draft goes. */
    const other = await (await send('POST', '/api/v2/offers', cookie, anOffer(lead))).json() as { id: string };
    expect((await send('DELETE', `/api/v2/offers/${other.id}`, cookie)).status).toBe(200);

    await send('POST', `/api/v2/offers/${made.id}/shared`, cookie);
    const res = await send('DELETE', `/api/v2/offers/${made.id}`, cookie);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('shared');

    /* And it is still there, not quietly gone. */
    const row = await queryOne<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM offers WHERE id = ?', [made.id],
    );
    expect(row?.deleted_at).toBeNull();
  });

  it('shows an agent only their own, and an owner everybody\'s', async () => {
    const one = await createTestUser({ role: 'agent' });
    const two = await createTestUser({ role: 'agent' });
    const owner = await createTestUser({ role: 'owner' });

    await send('POST', '/api/v2/offers', await signIn(base, one), anOffer(await aLead(one.id)));
    await send('POST', '/api/v2/offers', await signIn(base, two), anOffer(await aLead(two.id)));

    const asAgent = await (await send('GET', '/api/v2/offers', await signIn(base, one))).json() as {
      items: unknown[]; counts: Record<string, number>; stats: { thisMonth: number; valueAed: number };
    };
    expect(asAgent.items).toHaveLength(1);
    expect(asAgent.counts.all).toBe(1);
    expect(asAgent.stats.thisMonth).toBe(1);
    expect(asAgent.stats.valueAed).toBe(2_050_000);

    const asOwner = await (await send('GET', '/api/v2/offers', await signIn(base, owner))).json() as {
      items: unknown[]; stats: { valueAed: number };
    };
    expect(asOwner.items).toHaveLength(2);
    /* The total adds up rather than overflowing or coming back as a string. */
    expect(asOwner.stats.valueAed).toBe(4_100_000);
  });

  it('counts each tab as that tab would show it', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);

    const a = await (await send('POST', '/api/v2/offers', cookie, anOffer(lead))).json() as { id: string };
    const b = await (await send('POST', '/api/v2/offers', cookie, anOffer(lead))).json() as { id: string };
    await send('POST', '/api/v2/offers', cookie, anOffer(lead));

    await send('POST', `/api/v2/offers/${a.id}/shared`, cookie);
    await send('POST', `/api/v2/offers/${b.id}/shared`, cookie);
    await send('POST', `/api/v2/offers/${b.id}/accepted`, cookie);

    const got = await (await send('GET', '/api/v2/offers', cookie)).json() as {
      counts: Record<string, number>; stats: { accepted: number; waiting: number };
    };
    expect(got.counts).toEqual({ all: 3, draft: 1, shared: 1, accepted: 1 });
    expect(got.stats.accepted).toBe(1);
    expect(got.stats.waiting).toBe(1);

    /* And the tab itself returns what its count promised. */
    for (const [tab, n] of Object.entries(got.counts)) {
      const page = await (await send('GET', `/api/v2/offers?tab=${tab}`, cookie)).json() as { items: unknown[] };
      expect(page.items, `the ${tab} tab`).toHaveLength(n);
    }
  });

  it('offers only leads this person may work', async () => {
    const one = await createTestUser({ role: 'agent' });
    const two = await createTestUser({ role: 'agent' });
    await aLead(one.id, 'Mine');
    await aLead(two.id, 'Theirs');

    const form = await (await send('GET', '/api/v2/offers-form', await signIn(base, one))).json() as {
      leads: Array<{ name: string }>;
    };
    expect(form.leads.map((lead) => lead.name)).toEqual(['Mine']);
  });

  it('keeps the price exact when it is edited', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    const lead = await aLead(agent.id);
    const made = await (await send('POST', '/api/v2/offers', cookie, anOffer(lead))).json() as { id: string };

    const changed = await (await send('PATCH', `/api/v2/offers/${made.id}`, cookie, {
      priceAed: 3_499_999,
    })).json() as { priceAed: number };
    expect(changed.priceAed).toBe(3_499_999);

    const row = await queryOne<{ price_aed: number }>(
      'SELECT price_aed FROM offers WHERE id = ?', [made.id],
    );
    expect(Number(row?.price_aed)).toBe(3_499_999);
  });
});
