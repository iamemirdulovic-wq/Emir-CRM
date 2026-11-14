import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';
import type { LeadFacets } from './facets.js';

/**
 * The country and language chips, counted against a real database.
 *
 * The one thing a count on a screen has to be is true. Three separate numbers
 * on this product have been wrong in exactly the same way — a tab reading 419
 * over a list of thirty, a day band reading "50 leads" because fifty is the
 * page size — so the chips get the same line under them before they ship:
 *
 *   - the number is the whole filtered list, not the page;
 *   - an agent's number is their own leads and nobody else's;
 *   - an unknown dialling code is counted as unknown and carries no flag;
 *   - clicking a chip returns exactly the leads the chip counted.
 */
let server: Server;
let base = '';

describeWithDb('country and language chips', () => {
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

  async function aLead(
    owner: string,
    opts: { phone?: string | null; language?: string; name?: string } = {},
  ): Promise<string> {
    const stage = await queryOne<{ id: string; pipeline_id: string; key: string }>(
      'SELECT id, pipeline_id, `key` FROM pipeline_stages ORDER BY position LIMIT 1',
    );
    const contactId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164, language) VALUES (?, ?, ?, ?)',
      [contactId, opts.name ?? 'Someone', opts.phone ?? null, opts.language ?? 'en'],
    );
    const id = newId();
    await execute(
      `INSERT INTO opportunities
         (id, contact_id, pipeline_id, stage_id, stage_key, owner_user_id, status, title, source)
       VALUES (?, ?, ?, ?, ?, ?, 'open', 'x', 'manual')`,
      [id, contactId, stage!.pipeline_id, stage!.id, stage!.key, owner],
    );
    return id;
  }

  const get = async <T>(path: string, cookie: string): Promise<T> => {
    const res = await fetch(`${base}${path}`, { headers: { cookie } });
    expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
    return await res.json() as T;
  };

  /* ── the count is the whole list, not the page ────────────────────────── */

  it('counts every lead behind the filters, not the ones on the page', async () => {
    const agent = await createTestUser({ role: 'agent' });
    /* 60 UAE numbers, which is more than one page of 30, plus 3 British and
       1 Indian. The page the list sends back holds 30 rows; the chip must
       still say 60. */
    for (let i = 0; i < 60; i += 1) {
      await aLead(agent.id, { phone: `+9715${String(10_000_000 + i)}` });
    }
    for (let i = 0; i < 3; i += 1) {
      await aLead(agent.id, { phone: `+447700${String(900_100 + i)}` });
    }
    await aLead(agent.id, { phone: '+919876543210' });
    const cookie = await signIn(base, agent);

    const list = await get<{ items: unknown[]; total: number }>('/api/my-leads?tab=all&pageSize=30', cookie);
    expect(list.items).toHaveLength(30);
    expect(list.total).toBe(64);

    const facets = await get<LeadFacets>('/api/my-leads/facets?tab=all&pageSize=30', cookie);
    const byCountry = new Map(facets.countries.map((one) => [one.iso2, one.count]));
    expect(byCountry.get('AE')).toBe(60);
    expect(byCountry.get('GB')).toBe(3);
    expect(byCountry.get('IN')).toBe(1);
    expect(facets.countryTotal).toBe(64);
    /* The chips add up to the "All" chip, which is the arithmetic the owner's
       own reference picture shows: All 26 = 24 + 1 + 1. */
    expect(facets.countries.reduce((sum, one) => sum + one.count, 0)).toBe(facets.countryTotal);
  });

  /* ── the fence ─────────────────────────────────────────────────────────── */

  it('never counts another agent’s leads for an agent', async () => {
    const mine = await createTestUser({ role: 'agent' });
    const theirs = await createTestUser({ role: 'agent' });
    await aLead(mine.id, { phone: '+971501110001' });
    await aLead(theirs.id, { phone: '+971501110002' });
    await aLead(theirs.id, { phone: '+971501110003' });
    await aLead(theirs.id, { phone: '+447700900999', language: 'ar' });

    const facets = await get<LeadFacets>('/api/my-leads/facets?tab=all', await signIn(base, mine));
    expect(facets.countryTotal).toBe(1);
    expect(facets.countries.map((one) => [one.iso2, one.count])).toEqual([['AE', 1]]);
    /* And not a whisper of the Arabic lead that belongs to somebody else. */
    expect(facets.languages.map((one) => one.code)).toEqual(['en']);
  });

  it('counts everybody’s leads for the owner', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { phone: '+971501110001' });
    await aLead(agent.id, { phone: '+447700900998', language: 'ar' });
    await aLead(owner.id, { phone: '+971501110004' });

    const facets = await get<LeadFacets>('/api/my-leads/facets?tab=all', await signIn(base, owner));
    expect(facets.countryTotal).toBe(3);
    expect(new Map(facets.countries.map((one) => [one.iso2, one.count])).get('AE')).toBe(2);
    expect(new Map(facets.languages.map((one) => [one.code, one.count])).get('ar')).toBe(1);
  });

  /* ── what the chip says, the list shows ────────────────────────────────── */

  it('hands back exactly the leads the chip counted', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { phone: '+971501110001', name: 'Local one' });
    await aLead(agent.id, { phone: '+971501110002', name: 'Local two' });
    await aLead(agent.id, { phone: '+447700900997', name: 'London' });
    const cookie = await signIn(base, agent);

    const uae = await get<{ total: number; items: Array<{ full_name: string }> }>(
      '/api/my-leads?tab=all&country=AE', cookie,
    );
    expect(uae.total).toBe(2);
    expect(uae.items.map((one) => one.full_name).sort()).toEqual(['Local one', 'Local two']);

    const gb = await get<{ total: number; items: Array<{ full_name: string }> }>(
      '/api/my-leads?tab=all&country=GB', cookie,
    );
    expect(gb.total).toBe(1);
    expect(gb.items[0]!.full_name).toBe('London');
  });

  it('counts, and finds, a number whose dialling code we cannot read', async () => {
    const agent = await createTestUser({ role: 'agent' });
    /* +599 (Curaçao) is not in the table, and a lead with no number at all
       has nothing to read a country out of. Both are "unknown", neither is
       guessed, and neither carries a flag. */
    await aLead(agent.id, { phone: '+5999123456', name: 'Curaçao' });
    await aLead(agent.id, { phone: null, name: 'No number' });
    await aLead(agent.id, { phone: '+971501110005', name: 'Local' });
    const cookie = await signIn(base, agent);

    const facets = await get<LeadFacets>('/api/my-leads/facets?tab=all', cookie);
    const unknown = facets.countries.find((one) => one.iso2 === 'unknown')!;
    expect(unknown.count).toBe(2);
    expect(unknown.flag).toBe('');
    expect(unknown.localTime).toBeNull();
    expect(unknown.night).toBeNull();
    /* The unknown chip is last, however many are in it. */
    expect(facets.countries[facets.countries.length - 1]!.iso2).toBe('unknown');

    const list = await get<{ total: number; items: Array<{ full_name: string }> }>(
      '/api/my-leads?tab=all&country=unknown', cookie,
    );
    expect(list.total).toBe(2);
    expect(list.items.map((one) => one.full_name).sort()).toEqual(['Curaçao', 'No number']);
  });

  it('ignores a country nobody could have meant rather than emptying the screen', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { phone: '+971501110006' });
    const cookie = await signIn(base, agent);
    const list = await get<{ total: number }>('/api/my-leads?tab=all&country=zz', cookie);
    expect(list.total).toBe(1);
  });

  /* ── language ──────────────────────────────────────────────────────────── */

  it('counts the languages, and keeps a blank one out of English', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { phone: '+971501110007', language: 'en' });
    await aLead(agent.id, { phone: '+971501110008', language: 'ar' });
    await aLead(agent.id, { phone: '+971501110009', language: 'ar' });
    await aLead(agent.id, { phone: '+971501110010', language: '' });
    const cookie = await signIn(base, agent);

    const facets = await get<LeadFacets>('/api/my-leads/facets?tab=all', cookie);
    expect(facets.languages.map((one) => [one.code, one.label, one.count])).toEqual([
      ['ar', 'Arabic', 2],
      ['en', 'English', 1],
      ['unknown', 'Not known', 1],
    ]);
    /* The screen has to be able to say that English is also the column's
       default, so the endpoint tells it which code that is. */
    expect(facets.languageDefault).toBe('en');

    const arabic = await get<{ total: number }>('/api/my-leads?tab=all&language=ar', cookie);
    expect(arabic.total).toBe(2);
    const blank = await get<{ total: number }>('/api/my-leads?tab=all&language=unknown', cookie);
    expect(blank.total).toBe(1);
  });

  /* ── one chip's count ignores only its own chip ────────────────────────── */

  it('keeps every other country’s count visible while one is picked', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { phone: '+971501110011', language: 'ar' });
    await aLead(agent.id, { phone: '+971501110012', language: 'en' });
    await aLead(agent.id, { phone: '+447700900996', language: 'en' });
    const cookie = await signIn(base, agent);

    const facets = await get<LeadFacets>('/api/my-leads/facets?tab=all&country=AE', cookie);
    /* Standing on UAE, the British chip still says 1 — otherwise there is no
       way to move from one country to another except Clear all. */
    expect(new Map(facets.countries.map((one) => [one.iso2, one.count])).get('GB')).toBe(1);
    expect(facets.countryTotal).toBe(3);
    /* The language chips, though, are counted inside the country that is
       picked: two UAE leads, one of each language, and no sign of the
       British one. */
    expect(facets.languageTotal).toBe(2);
    expect(facets.languages.map((one) => [one.code, one.count])).toEqual([
      ['ar', 1], ['en', 1],
    ]);
  });

  /* ── search ────────────────────────────────────────────────────────────── */

  it('searches by country, by dialling code and by language', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { phone: '+919876543211', name: 'Delhi', language: 'hi' });
    await aLead(agent.id, { phone: '+971501110013', name: 'Dubai', language: 'ar' });
    const cookie = await signIn(base, agent);

    const byName = await get<{ items: Array<{ full_name: string }> }>(
      '/api/my-leads?tab=all&search=india', cookie,
    );
    expect(byName.items.map((one) => one.full_name)).toEqual(['Delhi']);

    const byCode = await get<{ items: Array<{ full_name: string }> }>(
      '/api/my-leads?tab=all&search=%2B971', cookie,
    );
    expect(byCode.items.map((one) => one.full_name)).toEqual(['Dubai']);

    const byLanguage = await get<{ items: Array<{ full_name: string }> }>(
      '/api/my-leads?tab=all&search=arabic', cookie,
    );
    expect(byLanguage.items.map((one) => one.full_name)).toEqual(['Dubai']);
  });

  it('searches for who is awake and who is asleep', async () => {
    const agent = await createTestUser({ role: 'agent' });
    /* Sydney and Los Angeles are never both inside 09:00–20:00 local, and
       never both outside it — they are nineteen hours apart. So whatever the
       hour this test runs at, one word finds one of them and the other word
       finds the other, and the two lists together are both leads. */
    await aLead(agent.id, { phone: '+61412345678', name: 'Sydney' });
    await aLead(agent.id, { phone: '+13105550123', name: 'Los Angeles' });
    const cookie = await signIn(base, agent);

    const asleep = await get<{ items: Array<{ full_name: string }> }>(
      '/api/my-leads?tab=all&search=asleep', cookie,
    );
    const awake = await get<{ items: Array<{ full_name: string }> }>(
      '/api/my-leads?tab=all&search=awake', cookie,
    );
    const names = (rows: Array<{ full_name: string }>) => rows.map((one) => one.full_name).sort();
    expect([...names(asleep.items), ...names(awake.items)].sort())
      .toEqual(['Los Angeles', 'Sydney']);
    /* And no lead is in both answers at once. */
    expect(names(asleep.items).filter((one) => names(awake.items).includes(one))).toEqual([]);
  });

  /* ── the chips narrow the tabs too ─────────────────────────────────────── */

  it('narrows the tab counts by the chip that is picked', async () => {
    const agent = await createTestUser({ role: 'agent' });
    await aLead(agent.id, { phone: '+971501110014' });
    await aLead(agent.id, { phone: '+971501110015' });
    await aLead(agent.id, { phone: '+447700900995' });
    const cookie = await signIn(base, agent);

    const all = await get<Record<string, number>>('/api/my-leads/counts', cookie);
    expect(all.all).toBe(3);
    const uae = await get<Record<string, number>>('/api/my-leads/counts?country=AE', cookie);
    expect(uae.all).toBe(2);
  });
});
