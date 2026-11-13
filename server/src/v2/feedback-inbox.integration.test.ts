import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';
import { headingFor } from './feedback.js';

/**
 * The feedback inbox, as `design/web/feedback-inbox.html` draws it.
 *
 * Four things were missing behind that screen and each is tested here: the
 * number an owner quotes, the title the table scans by, the urgency the
 * design gives a column, and a reply thread rather than one column that
 * overwrote itself.
 *
 * The empty reply is the one worth having. Pressing Reply with nothing typed
 * used to change the status quietly, so it looked like something had been
 * sent to the agent waiting for an answer.
 */
let server: Server;
let base = '';

const json = { 'content-type': 'application/json' } as const;

describe('a report heading', () => {
  it('is the title when there is one', () => {
    expect(headingFor('Call button does nothing', 'anything')).toBe('Call button does nothing');
  });

  it('is the first sentence of the body when there is not', () => {
    /* Reports sent before there was a title field have only a body, and a row
       whose heading is a three-sentence paragraph is the fault that made the
       table unreadable. */
    expect(headingFor(null, 'It does not work. I pressed Call three times.'))
      .toBe('It does not work.');
  });

  it('clips a very long first sentence rather than filling the row', () => {
    const long = `${'a'.repeat(200)}.`;
    const heading = headingFor('', long);
    expect(heading.length).toBeLessThanOrEqual(90);
    expect(heading.endsWith('…')).toBe(true);
  });
});

describeWithDb('the feedback inbox', () => {
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
      headers: { Cookie: cookie, ...json },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('gives every report a number, counting up', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);

    const first = await (await send('POST', '/api/v2/feedback', cookie, {
      kind: 'bug', title: 'Call button does nothing', body: 'I press Call and nothing happens.',
    })).json() as { ref: number };
    const second = await (await send('POST', '/api/v2/feedback', cookie, {
      kind: 'idea', title: 'Show the local time', body: 'I check the time on Google every call.',
    })).json() as { ref: number };

    expect(first.ref).toBeGreaterThan(1000);
    expect(second.ref).toBe(first.ref + 1);
  });

  it('keeps the design’s four types and three urgencies', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const owner = await createTestUser({ role: 'owner' });
    const theirs = await signIn(base, agent);

    for (const kind of ['bug', 'issue', 'feature', 'idea']) {
      const res = await send('POST', '/api/v2/feedback', theirs, {
        kind, title: `A ${kind}`, body: 'Something to say about it.', urgency: 'low',
      });
      expect(res.status, `${kind} was refused`).toBe(201);
    }

    const cookie = await signIn(base, owner);
    const inbox = await (await send('GET', '/api/v2/feedback?filter=all', cookie)).json() as {
      items: Array<{ kindWord: string; urgencyWord: string }>;
    };
    expect(inbox.items.map((one) => one.kindWord).sort())
      .toEqual(['Bug', 'Idea', 'Issue', 'New feature']);
    expect(new Set(inbox.items.map((one) => one.urgencyWord))).toEqual(new Set(['Low']));
  });

  it('puts “blocking my work” at the top whatever its date', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const owner = await createTestUser({ role: 'owner' });
    const theirs = await signIn(base, agent);

    await send('POST', '/api/v2/feedback', theirs, {
      kind: 'idea', title: 'Dark mode', body: 'My eyes are tired after 17:00.', urgency: 'low',
    });
    await send('POST', '/api/v2/feedback', theirs, {
      kind: 'bug', title: 'Cannot call anybody', body: 'Every Call button is dead.',
      urgency: 'blocking',
    });

    const cookie = await signIn(base, owner);
    const inbox = await (await send('GET', '/api/v2/feedback?filter=all', cookie)).json() as {
      items: Array<{ title: string; blocking: boolean }>;
      counts: Record<string, number>;
    };
    expect(inbox.items[0]?.title).toBe('Cannot call anybody');
    expect(inbox.items[0]?.blocking).toBe(true);
    expect(inbox.counts.blocking).toBe(1);
    /* "All" is a real count, not the four states added up by the screen. */
    expect(inbox.counts.all).toBe(2);
  });

  it('keeps every reply rather than overwriting the last one', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const owner = await createTestUser({ role: 'owner', name: 'Emir' });
    const theirs = await signIn(base, agent);
    const made = await (await send('POST', '/api/v2/feedback', theirs, {
      kind: 'bug', title: 'Search misses numbers with spaces', body: '050 555 0101 finds nothing.',
    })).json() as { id: string };

    const cookie = await signIn(base, owner);
    await send('PATCH', `/api/v2/feedback/${made.id}`, cookie, { reply: 'We are looking at it.' });
    const after = await (await send('PATCH', `/api/v2/feedback/${made.id}`, cookie, {
      status: 'planned', reply: 'Planned with the templates, later phase.',
    })).json() as { replies: Array<{ body: string; author: string | null }>; reply: string };

    expect(after.replies.map((one) => one.body)).toEqual([
      'We are looking at it.',
      'Planned with the templates, later phase.',
    ]);
    expect(after.replies[0]?.author).toBe('Emir');
    /* The single column stays as the latest reply, which the agent's own page
       reads. */
    expect(after.reply).toBe('Planned with the templates, later phase.');
  });

  it('refuses an empty reply instead of changing the status quietly', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const owner = await createTestUser({ role: 'owner' });
    const theirs = await signIn(base, agent);
    const made = await (await send('POST', '/api/v2/feedback', theirs, {
      kind: 'bug', title: 'Something', body: 'Something happened.',
    })).json() as { id: string };

    const cookie = await signIn(base, owner);
    const res = await send('PATCH', `/api/v2/feedback/${made.id}`, cookie, {
      status: 'fixed', reply: '   ',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Write your reply first.');

    const inbox = await (await send('GET', '/api/v2/feedback?filter=all', cookie)).json() as {
      items: Array<{ status: string }>;
    };
    expect(inbox.items[0]?.status, 'the status changed anyway').toBe('new');
  });

  it('exports the whole inbox as a CSV, with formulas defused', async () => {
    const agent = await createTestUser({ role: 'agent', name: 'Rocky' });
    const owner = await createTestUser({ role: 'owner' });
    const theirs = await signIn(base, agent);
    await send('POST', '/api/v2/feedback', theirs, {
      kind: 'bug',
      /* A cell starting with `=` is run as a formula by Excel. */
      title: '=cmd|calc',
      body: 'A title that Excel would try to run.',
    });

    const cookie = await signIn(base, owner);
    const res = await fetch(`${base}/api/v2/feedback/export.csv`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('feedback-');
    const csv = await res.text();
    expect(csv).toContain('Number,Status,Type,Urgency,From');
    expect(csv).toContain('Rocky');
    expect(csv, 'a formula reached the spreadsheet').toContain("'=cmd|calc");
  });

  /* ── attachments ────────────────────────────────────────────────────── */

  describe('a screenshot and a voice note', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );

    it('goes up against the report and comes back to its owner', async () => {
      const agent = await createTestUser({ role: 'agent' });
      const owner = await createTestUser({ role: 'owner' });
      const theirs = await signIn(base, agent);
      const made = await (await send('POST', '/api/v2/feedback', theirs, {
        kind: 'bug', title: 'Looks wrong', body: 'See the picture.',
      })).json() as { id: string };

      const up = await fetch(`${base}/api/v2/feedback/${made.id}/screenshot`, {
        method: 'POST',
        headers: { Cookie: theirs, 'content-type': 'image/png' },
        body: png,
      });
      expect(up.status, await up.clone().text()).toBe(201);

      const cookie = await signIn(base, owner);
      const inbox = await (await send('GET', '/api/v2/feedback?filter=all', cookie)).json() as {
        items: Array<{ hasScreenshot: boolean; hasVoice: boolean }>;
      };
      expect(inbox.items[0]?.hasScreenshot).toBe(true);
      expect(inbox.items[0]?.hasVoice).toBe(false);

      const back = await fetch(`${base}/api/v2/feedback/${made.id}/screenshot`, {
        headers: { Cookie: cookie },
      });
      expect(back.status).toBe(200);
      expect(back.headers.get('content-type')).toBe('image/png');
    });

    it('is not another agent’s to fetch', async () => {
      const mine = await createTestUser({ role: 'agent' });
      const theirs = await createTestUser({ role: 'agent', email: 'nosy@emircrm.test' });
      const cookie = await signIn(base, mine);
      const made = await (await send('POST', '/api/v2/feedback', cookie, {
        kind: 'bug', title: 'A client’s name is in this picture', body: 'Look.',
      })).json() as { id: string };
      await fetch(`${base}/api/v2/feedback/${made.id}/screenshot`, {
        method: 'POST',
        headers: { Cookie: cookie, 'content-type': 'image/png' },
        body: png,
      });

      const nosy = await signIn(base, theirs);
      const peek = await fetch(`${base}/api/v2/feedback/${made.id}/screenshot`, {
        headers: { Cookie: nosy },
      });
      /* Not found rather than forbidden: an agent should not learn that a
         report exists by being refused it. */
      expect(peek.status).toBe(404);

      const push = await fetch(`${base}/api/v2/feedback/${made.id}/screenshot`, {
        method: 'POST',
        headers: { Cookie: nosy, 'content-type': 'image/png' },
        body: png,
      });
      expect(push.status).toBe(400);
    });

    it('refuses a file that is not what it claims to be', async () => {
      const agent = await createTestUser({ role: 'agent' });
      const cookie = await signIn(base, agent);
      const made = await (await send('POST', '/api/v2/feedback', cookie, {
        kind: 'bug', title: 'Anything at all', body: 'Something happened.',
      })).json() as { id: string };

      /* An audio type on the screenshot endpoint, and a PDF on either. */
      const wrongKind = await fetch(`${base}/api/v2/feedback/${made.id}/screenshot`, {
        method: 'POST',
        headers: { Cookie: cookie, 'content-type': 'audio/webm' },
        body: Buffer.from('not a picture'),
      });
      expect(wrongKind.status).toBe(400);

      const pdf = await fetch(`${base}/api/v2/feedback/${made.id}/voice`, {
        method: 'POST',
        headers: { Cookie: cookie, 'content-type': 'application/pdf' },
        body: Buffer.from('%PDF-1.4'),
      });
      expect(pdf.status).toBe(400);
    });
  });
});
