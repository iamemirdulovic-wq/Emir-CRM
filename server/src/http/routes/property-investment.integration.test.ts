import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, describeWithDb, prepareTestDatabase, query, resetTables,
} from '../../testing/db.js';
import { queryOne } from '../../db/client.js';
import { resetRateLimits } from '../middleware/rate-limit.js';
import { loadEnv, setEnvForTesting } from '../../config/env.js';
import { clearSecretCache } from '../../config/secrets.js';
import { createApp } from '../app.js';

/**
 * The inbound half of the property-investment.ae connection.
 *
 * What these tests are really protecting: a lead this brokerage paid for must
 * arrive exactly once, must not be creatable by anyone who cannot sign for it,
 * and must bring the site's own knowledge of the buyer with it.
 */
let server: Server;
let base = '';

const SECRET = 'a-long-shared-secret-for-the-tests';

/** Sign exactly the bytes we send, which is what the endpoint verifies. */
function post(path: string, body: unknown, over: { secret?: string; signature?: string } = {}) {
  const raw = JSON.stringify(body);
  const signature = over.signature
    ?? createHmac('sha256', over.secret ?? SECRET).update(raw).digest('hex');
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': signature },
    body: raw,
  });
}

/** A full event, the shape their site agreed to send. */
function event(over: Record<string, unknown> = {}, type: 'lead.created' | 'lead.updated' = 'lead.created') {
  return {
    event: type,
    sent_at: '2026-10-11T08:30:00.000Z',
    lead: {
      id: 90210,
      public_ref: 'PI-90210',
      created_at: '2026-10-11T08:29:40.000Z',
      status: 'new',
      temperature: 'hot',
      first_name: 'Ahmed',
      last_name: 'Khan',
      phone_e164: '+971501234567',
      email: 'Ahmed.Khan@Example.com',
      country: 'AE',
      language: 'en',
      source: 'organic',
      cta_location: 'project-page-sticky-bar',
      campaign: {
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'saadiyat-2026',
        utm_content: 'hero-a',
        utm_term: 'abu dhabi off plan',
        gclid: 'GCL-123',
        fbclid: 'FB-456',
        landing_path: '/projects/sei-saadiyat',
      },
      project: { id: 'p-77', slug: 'sei-saadiyat', name: 'Sei Saadiyat' },
      request_type: 'book_viewing',
      message: 'Looking for a 2 bedroom with a sea view.',
      matchmaker: {
        answers: { budget: '2-3m', bedrooms: 2, purpose: 'investment' },
        best_areas: ['Saadiyat Island', 'Yas Island'],
        best_projects: ['sei-saadiyat', 'yas-acres'],
      },
      viewed_projects: ['sei-saadiyat', 'yas-acres', 'the-sustainable-city'],
      ai_summary: 'Investor, 2BR, AED 2–3M, ready to view this week.',
      score_reasons: ['matched budget', 'viewed 3 projects', 'asked to book a viewing'],
      advisor: { id: 'adv-4', name: 'Site Advisor' },
      ...over,
    },
  };
}

type Accepted = { ok: boolean; external_id: string; duplicate: boolean };
const readJson = <T,>(res: Response): Promise<T> => res.json() as Promise<T>;

/** The endpoint answers before it works, so tests wait for the row to land. */
async function settle(check: () => Promise<boolean>, within = 8000): Promise<void> {
  const until = Date.now() + within;
  for (;;) {
    if (await check()) return;
    if (Date.now() > until) throw new Error('the lead never landed');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const contextRows = () => query<{
  external_id: string; public_ref: string; temperature: string; event_count: number;
  site_project_slug: string; ai_summary: string; opportunity_id: string | null;
}>('SELECT * FROM website_leads');

describeWithDb('leads arriving from property-investment.ae', () => {
  beforeAll(async () => {
    await prepareTestDatabase();
    server = createApp().listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    setEnvForTesting(null);
    clearSecretCache();
    await new Promise((resolve) => server.close(resolve));
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTables();
    resetRateLimits();
    setEnvForTesting({ ...loadEnv(process.env), PROPERTY_INVESTMENT_HMAC_SECRET: SECRET });
    clearSecretCache();
  });

  /* ── The door ─────────────────────────────────────────────────────────── */

  it('turns away an unsigned event', async () => {
    const res = await fetch(`${base}/api/webhooks/property-investment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event()),
    });

    expect(res.status).toBe(401);
    expect(await contextRows()).toHaveLength(0);
  });

  it('turns away an event signed with the wrong secret', async () => {
    const res = await post('/api/webhooks/property-investment', event(), { secret: 'not-the-secret' });

    expect(res.status).toBe(401);
    expect(await contextRows()).toHaveLength(0);
  });

  /*
   * The signature covers the exact bytes. A body re-serialised anywhere in the
   * chain changes them, and this is the failure their developer will hit
   * first, so it gets a test that states what the answer should be.
   */
  it('turns away a body that changed after it was signed', async () => {
    const signed = JSON.stringify(event());
    const signature = createHmac('sha256', SECRET).update(signed).digest('hex');

    const res = await fetch(`${base}/api/webhooks/property-investment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': signature },
      body: JSON.stringify(event({ first_name: 'Someone Else' })),
    });

    expect(res.status).toBe(401);
  });

  it('says so plainly when the secret has not been configured yet', async () => {
    setEnvForTesting({ ...loadEnv(process.env), PROPERTY_INVESTMENT_HMAC_SECRET: undefined });
    clearSecretCache();

    const res = await post('/api/webhooks/property-investment', event());

    // 503, not 401: nothing is wrong with their call, the CRM is not ready.
    expect(res.status).toBe(503);
  });

  it('answers 400 with the reason when the shape is wrong, rather than failing quietly', async () => {
    const res = await post('/api/webhooks/property-investment', { event: 'lead.created', lead: {} });

    expect(res.status).toBe(400);
    expect(await contextRows()).toHaveLength(0);
  });

  /* ── The lead ─────────────────────────────────────────────────────────── */

  it('creates one contact, one opportunity and the website context', async () => {
    const res = await post('/api/webhooks/property-investment', event());
    expect(res.status).toBe(202);
    const body = await readJson<Accepted>(res);
    expect(body.external_id).toBe('pi_90210');

    await settle(async () => (await contextRows()).length === 1);

    const contact = await queryOne<{ id: string; full_name: string; phone_e164: string; email: string }>(
      'SELECT id, full_name, phone_e164, email FROM contacts',
    );
    expect(contact?.full_name).toBe('Ahmed Khan');
    expect(contact?.phone_e164).toBe('+971501234567');
    // Lowercased on the way in, so the same person does not arrive twice.
    expect(contact?.email).toBe('ahmed.khan@example.com');

    const opportunity = await queryOne<{ project_name: string; utm_campaign: string; gclid: string; source: string }>(
      'SELECT project_name, utm_campaign, gclid, source FROM opportunities',
    );
    expect(opportunity?.project_name).toBe('Sei Saadiyat');
    expect(opportunity?.utm_campaign).toBe('saadiyat-2026');
    expect(opportunity?.gclid).toBe('GCL-123');
    expect(opportunity?.source).toBe('website');
  });

  it('keeps what the site knew: matchmaker, viewed projects, score and summary', async () => {
    await post('/api/webhooks/property-investment', event());
    await settle(async () => (await contextRows()).length === 1);

    const row = await queryOne<{
      public_ref: string; temperature: string; request_type: string; cta_location: string;
      site_project_slug: string; advisor_name: string; ai_summary: string;
      matchmaker: unknown; viewed_projects: unknown; score_reasons: unknown; payload: unknown;
    }>('SELECT * FROM website_leads');

    expect(row?.public_ref).toBe('PI-90210');
    expect(row?.temperature).toBe('hot');
    expect(row?.request_type).toBe('book_viewing');
    expect(row?.cta_location).toBe('project-page-sticky-bar');
    expect(row?.site_project_slug).toBe('sei-saadiyat');
    expect(row?.advisor_name).toBe('Site Advisor');
    expect(row?.ai_summary).toContain('Investor');

    const read = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);
    expect(read(row?.viewed_projects)).toHaveLength(3);
    expect(read(row?.score_reasons)).toContain('viewed 3 projects');
    expect(read(row?.matchmaker).best_areas).toContain('Saadiyat Island');
    // The whole event is kept, so a field nobody parsed is still on the card.
    expect(read(row?.payload).lead.id).toBe(90210);
  });

  it('writes an activity the agent can read before they call', async () => {
    await post('/api/webhooks/property-investment', event());
    await settle(async () => (await contextRows()).length === 1);

    const activity = await queryOne<{ title: string; body: string; meta: unknown }>(
      "SELECT title, body, meta FROM activities WHERE type = 'website_lead'",
    );
    expect(activity?.title).toContain('property-investment.ae');
    expect(activity?.body).toContain('book viewing');
    expect(activity?.body).toContain('Sei Saadiyat');
  });

  /* ── Sending it twice ─────────────────────────────────────────────────── */

  it('never creates a second lead when the same event is replayed', async () => {
    const payload = event();
    const first = await post('/api/webhooks/property-investment', payload);
    await settle(async () => (await contextRows()).length === 1);

    const second = await post('/api/webhooks/property-investment', payload);

    // A replay is a success, not an error: anything else makes their retry
    // logic either hammer us or give up on a real lead.
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect((await readJson<Accepted>(second)).duplicate).toBe(true);

    expect(await query('SELECT id FROM contacts')).toHaveLength(1);
    expect(await query('SELECT id FROM opportunities')).toHaveLength(1);
    expect(await contextRows()).toHaveLength(1);
  });

  it('updates the same row when the site sends lead.updated', async () => {
    await post('/api/webhooks/property-investment', event());
    await settle(async () => (await contextRows()).length === 1);

    await post('/api/webhooks/property-investment', {
      ...event({ temperature: 'warm', status: 'contacted' }, 'lead.updated'),
      sent_at: '2026-10-11T09:15:00.000Z',
    });
    await settle(async () => {
      const [row] = await contextRows();
      return row?.temperature === 'warm';
    });

    const rows = await contextRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_count).toBe(2);
    // Still one lead in the CRM — an update is not a new inquiry.
    expect(await query('SELECT id FROM contacts')).toHaveLength(1);
    expect(await query('SELECT id FROM opportunities')).toHaveLength(1);
  });

  /* ── Consent ──────────────────────────────────────────────────────────── */

  /*
   * The agreed payload carries no consent field. Treating its absence as
   * permission would put the brokerage's WhatsApp number at risk and break
   * UAE PDPL, so absence means no, and the card says so.
   */
  it('treats a missing consent field as no consent, and flags it', async () => {
    await post('/api/webhooks/property-investment', event());
    await settle(async () => (await contextRows()).length === 1);

    // Either no WhatsApp consent row at all, or one that plainly says no.
    const consent = await queryOne<{ granted: number }>(
      "SELECT granted FROM consents WHERE channel = 'whatsapp'",
    );
    expect(Boolean(consent?.granted)).toBe(false);

    const activity = await queryOne<{ meta: unknown }>(
      "SELECT meta FROM activities WHERE type = 'website_lead'",
    );
    const meta = typeof activity?.meta === 'string' ? JSON.parse(activity.meta) : activity?.meta;
    expect(meta.consent_missing).toBe(true);
  });

  it('records the consent and its wording when the site does send them', async () => {
    await post('/api/webhooks/property-investment', event({
      consent: true,
      consent_text: 'I agree to be contacted about this enquiry on WhatsApp, phone and email.',
    }));
    await settle(async () => (await contextRows()).length === 1);

    const consent = await queryOne<{ granted: number; consent_text: string }>(
      "SELECT granted, consent_text FROM consents WHERE channel = 'whatsapp'",
    );
    expect(Boolean(consent?.granted)).toBe(true);
    // The exact wording the person was shown, which UAE PDPL wants kept.
    expect(consent?.consent_text).toContain('I agree to be contacted');
  });

  /* ── Their clock ──────────────────────────────────────────────────────── */

  /*
   * speed-to-lead is the number this brokerage is judged on. A site running
   * fast must not be able to backdate a lead and flatter it.
   */
  it('does not let the site backdate a lead', async () => {
    const claimed = '2020-01-01T00:00:00.000Z';
    await post('/api/webhooks/property-investment', event({ created_at: claimed }));
    await settle(async () => (await contextRows()).length === 1);

    const opportunity = await queryOne<{ created_at: Date }>('SELECT created_at FROM opportunities');
    const row = await queryOne<{ site_created_at: Date }>('SELECT site_created_at FROM website_leads');

    expect(new Date(opportunity!.created_at).getFullYear()).toBeGreaterThan(2020);
    // Kept as data, so the claim is still auditable.
    expect(new Date(row!.site_created_at).getFullYear()).toBe(2020);
  });

  it('also answers on the /webhooks path the other integrations use', async () => {
    const res = await post('/webhooks/property-investment', event());
    expect(res.status).toBe(202);
  });

  /*
   * The /api alias is as unauthenticated as the original. Mounting the router
   * there without mounting the limit would have left an endpoint anyone on the
   * internet can hammer, which is exactly what the limit on /webhooks exists
   * to prevent.
   */
  it('holds the same rate limit on the /api alias as on /webhooks', async () => {
    const limited = await Promise.all(
      Array.from({ length: 605 }, (_, i) =>
        post('/api/webhooks/property-investment', event({ id: 500000 + i }))),
    );
    expect(limited.some((res) => res.status === 429)).toBe(true);
  });
});
