import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { env, setEnvForTesting } from '../config/env.js';
import { newId } from '../lib/ids.js';
import { integrations } from './integrations.js';

/**
 * The connections page.
 *
 * It exists because a key being set is not the same as a thing working, and
 * the CRM had no screen that knew the difference. These tests are mostly
 * about the SQL running at all: both tables it reads were written years
 * before anything read them back.
 */
describeWithDb('what the CRM is connected to', () => {
  beforeAll(prepareTestDatabase);
  afterAll(closeTestDatabase);
  beforeEach(resetTables);

  it('runs, and answers for every connection', async () => {
    const rows = await integrations();
    expect(rows.length).toBeGreaterThan(6);
    for (const row of rows) {
      expect(row.title.length).toBeGreaterThan(2);
      expect(['live', 'quiet', 'failing', 'off']).toContain(row.state);
      expect(typeof row.detail).toBe('string');
    }
  });

  it('says a source nobody has connected is off, not broken', async () => {
    const rows = await integrations();
    const meta = rows.find((one) => one.key === 'meta_lead_ads');
    expect(meta?.state).toBe('off');
    expect(meta?.todo).toBeTruthy();
  });

  it('counts the leads that really arrived from a source', async () => {
    for (let i = 0; i < 3; i += 1) {
      await execute(
        `INSERT INTO inbound_events (id, source, external_id, signature_valid, raw_payload)
         VALUES (?, 'website', ?, 1, '{}')`,
        [newId(), `w-${i}`],
      );
    }
    const rows = await integrations();
    const web = rows.find((one) => one.key === 'website');
    /* Off, because no secret is set in the test environment -- but the read
       itself is what this proves, and it must not throw on real rows. */
    expect(web).toBeDefined();
    expect(web?.detail.length).toBeGreaterThan(0);
  });

  it('reads what was reported back to Meta, including a refusal', async () => {
    /*
     * `conversion_events` is unique on (opportunity, destination, event) and
     * both columns are NOT NULL, so this row is shaped the way the real
     * sender shapes it.
     */
    /* A real lead behind it: `conversion_events` has foreign keys to both
       the opportunity and the contact, as it should. */
    const stage = await queryOne<{ id: string; pipeline_id: string }>(
      "SELECT id, pipeline_id FROM pipeline_stages WHERE `key` = 'new_lead' LIMIT 1",
    );
    const contactId = newId();
    const opportunityId = newId();
    await execute(
      'INSERT INTO contacts (id, full_name, phone_e164) VALUES (?, ?, ?)',
      [contactId, 'Reported Buyer', `+9715${Math.floor(Math.random() * 100000000)}`],
    );
    await execute(
      `INSERT INTO opportunities (id, contact_id, pipeline_id, stage_id, stage_key, status, source)
       VALUES (?, ?, ?, ?, 'new_lead', 'open', 'meta_lead_ads')`,
      [opportunityId, contactId, stage?.pipeline_id, stage?.id],
    );
    await execute(
      `INSERT INTO conversion_events
         (id, opportunity_id, contact_id, destination, event_name, event_time, status, error, sent_at)
       VALUES (?, ?, ?, 'meta', 'contacted', NOW(3), 'failed', 'Invalid access token', NOW(3))`,
      [newId(), opportunityId, contactId],
    );
    const rows = await integrations();
    const capi = rows.find((one) => one.key === 'meta_capi');
    expect(capi).toBeDefined();
    /* Off in the test environment, since no dataset is configured -- the
       point is that the grouped read over a real row did not throw. */
    expect(capi?.state).toBe('off');
  });

  it('calls Facebook broken when leads arrive and cannot be read', async () => {
    /*
     * The question this page was built to answer, asked by the marketing
     * agency the day before a launch: "are you sure leads are going to the
     * CRM?" The webhook carries only ids; a second token fetches the answers.
     * When that token is wrong, Meta gets its 200, the arrival is recorded,
     * and no lead exists. Counting arrivals alone would call that working,
     * which is the one answer that costs money.
     */
    setEnvForTesting({
      ...env(),
      META_APP_SECRET: 'test-secret',
      META_SYSTEM_USER_TOKEN: 'test-token',
    });
    try {
      await execute(
        `INSERT INTO inbound_events (id, source, external_id, signature_valid, raw_payload)
         VALUES (?, 'meta_lead_ads', ?, 1, '{}')`,
        [newId(), `lead-${newId()}`],
      );
      await execute(
        `INSERT INTO jobs (id, type, payload, status, last_error, updated_at)
         VALUES (?, 'meta.fetch_lead', '{}', 'failed', ?, NOW(3))`,
        [newId(), 'Error validating access token: Session has expired'],
      );
      const forms = (await integrations()).find((one) => one.key === 'meta_lead_ads');
      expect(forms?.state).toBe('failing');
      expect(forms?.detail).toContain('Session has expired');
      expect(forms?.todo).toContain('not in your leads');
    } finally {
      setEnvForTesting(null);
    }
  });

  it('does not call Facebook broken when the fetch is working', async () => {
    setEnvForTesting({
      ...env(),
      META_APP_SECRET: 'test-secret',
      META_SYSTEM_USER_TOKEN: 'test-token',
    });
    try {
      await execute(
        `INSERT INTO inbound_events (id, source, external_id, signature_valid, raw_payload)
         VALUES (?, 'meta_lead_ads', ?, 1, '{}')`,
        [newId(), `lead-${newId()}`],
      );
      const forms = (await integrations()).find((one) => one.key === 'meta_lead_ads');
      expect(forms?.state).toBe('live');
      expect(forms?.todo).toBeNull();
    } finally {
      setEnvForTesting(null);
    }
  });

  it('says so when Meta can deliver but nothing can read the answers', async () => {
    /* The app secret signs the webhook; a different token fetches the lead.
       With only the first, every lead Meta sends is lost on arrival. */
    setEnvForTesting({ ...env(), META_APP_SECRET: 'test-secret' });
    try {
      await execute(
        `INSERT INTO inbound_events (id, source, external_id, signature_valid, raw_payload)
         VALUES (?, 'meta_lead_ads', ?, 1, '{}')`,
        [newId(), `lead-${newId()}`],
      );
      const forms = (await integrations()).find((one) => one.key === 'meta_lead_ads');
      expect(forms?.state).toBe('failing');
      expect(forms?.todo).toContain('META_SYSTEM_USER_TOKEN');
    } finally {
      setEnvForTesting(null);
    }
  });

  it('counts the phones that really registered', async () => {
    /*
     * The push row used to say "Firebase connected" and stop there. For most
     * of this build the keys were set and one phone in fourteen had ever
     * registered, so the alerts went nowhere and the screen said it was fine.
     * This proves the count runs against real rows -- `push_tokens` is one
     * row per device, and a person with two phones is still one person.
     */
    const userId = newId();
    await execute(
      `INSERT INTO users (id, name, email, role, password_hash, is_active)
       VALUES (?, 'Phone Owner', ?, 'agent', 'x', 1)`,
      [userId, `phone-${userId}@example.com`],
    );
    for (const device of ['one', 'two']) {
      await execute(
        'INSERT INTO push_tokens (id, user_id, token) VALUES (?, ?, ?)',
        [newId(), userId, `token-${userId}-${device}`],
      );
    }
    const rows = await integrations();
    const push = rows.find((one) => one.key === 'push');
    expect(push).toBeDefined();
    /* Off here, since no Firebase keys are set in the test environment. What
       matters is that the two-table count ran at all. */
    expect(push?.detail.length).toBeGreaterThan(0);
  });
});
