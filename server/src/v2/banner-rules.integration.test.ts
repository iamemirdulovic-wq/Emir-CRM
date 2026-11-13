import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';
import { newId } from '../lib/ids.js';
import { bannerProblem, bannerState } from './banners.js';

/**
 * The home banners, as `design/web/home-banners.html` asks for them.
 *
 * `docs/v2/audit-2.md` §21 counted thirteen things missing from that screen,
 * and most of them were missing because the table had nowhere to put them.
 * The rules worth testing are the two that have a consequence if they are
 * only enforced on screen: **who sees a banner**, because a banner meant for
 * the Arabic desk showing to the whole office is not a setting but a lie, and
 * **the dates**, because an "until" before its "from" is a banner that never
 * appears and never says why.
 */
let server: Server;
let base = '';

const json = { 'content-type': 'application/json' } as const;

describe('a banner’s state and its rules, without a database', () => {
  it('is Live, Scheduled or Ended, from its dates', () => {
    const today = '2026-11-11';
    expect(bannerState(null, null, true, today)).toBe('Live');
    expect(bannerState('2026-11-16', null, true, today)).toBe('Scheduled');
    expect(bannerState('2026-10-20', '2026-10-31', true, today)).toBe('Ended');
    /* Its last day counts, so one that ends today is still live today. */
    expect(bannerState('2026-11-01', '2026-11-11', true, today)).toBe('Live');
    /* Switched off is ended, whatever its dates say. */
    expect(bannerState(null, null, false, today)).toBe('Ended');
  });

  it('refuses the four things the design’s own form refuses', () => {
    const today = '2026-11-11';
    expect(bannerProblem({ startsAt: '2026-11-20', endsAt: '2026-11-12' }, true, today))
      .toContain('“Until” is before “Show from”');
    expect(bannerProblem({ startsAt: '2026-11-01' }, true, today))
      .toContain('The start day is in the past.');
    /* Changing an existing banner may keep a start day in the past: it has
       already started. */
    expect(bannerProblem({ startsAt: '2026-11-01' }, false, today)).toBeNull();
    expect(bannerProblem({ opens: 'A web link', linkUrl: 'crm.homes.me' }, true, today))
      .toContain('starts with https://');
    expect(bannerProblem({ audience: 'desk' }, true, today)).toBe('Choose a desk.');
    expect(bannerProblem({ audience: 'desk', deskId: 'abc' }, true, today)).toBeNull();
  });
});

describeWithDb('the home banners', () => {
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

  it('keeps the label, the button and where it goes', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);

    const made = await (await send('POST', '/api/v2/banners', cookie, {
      title: 'Cityscape Global · 17–19 Nov',
      label: 'From Emir',
      body: 'We are at DWTC, stand B12.',
      buttonText: 'See the plan',
      opens: 'Team wall',
      audience: 'everyone',
    })).json() as {
      label: string; buttonText: string; opens: string; audience: string; state: string;
    };

    expect(made.label).toBe('From Emir');
    expect(made.buttonText).toBe('See the plan');
    expect(made.opens).toBe('Team wall');
    expect(made.audience).toBe('everyone');
    expect(made.state).toBe('Live');
  });

  it('refuses a web link that is not one, on the server as well as on screen', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const res = await send('POST', '/api/v2/banners', cookie, {
      title: 'Open the calendar', opens: 'A web link', linkUrl: 'calendar',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('https://');
  });

  it('shows an agents-only banner to an agent and not to an owner', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const agent = await createTestUser({ role: 'agent' });
    const ownerCookie = await signIn(base, owner);

    await send('POST', '/api/v2/banners', ownerCookie, {
      title: 'Everybody sees this', audience: 'everyone',
    });
    await send('POST', '/api/v2/banners', ownerCookie, {
      title: 'Agents only', audience: 'agents',
    });

    const agentCookie = await signIn(base, agent);
    const theirs = await (await send('GET', '/api/v2/home', agentCookie)).json() as {
      banners: Array<{ title: string }>;
    };
    expect(theirs.banners.map((one) => one.title).sort())
      .toEqual(['Agents only', 'Everybody sees this']);

    const ours = await (await send('GET', '/api/v2/home', ownerCookie)).json() as {
      banners: Array<{ title: string }>;
    };
    expect(ours.banners.map((one) => one.title)).toEqual(['Everybody sees this']);
  });

  it('shows a desk banner only to that desk', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const onDesk = await createTestUser({ role: 'agent', email: 'arabic@emircrm.test' });
    const offDesk = await createTestUser({ role: 'agent', email: 'dubai@emircrm.test' });
    const deskId = newId();
    await execute('INSERT INTO desks (id, name) VALUES (?, ?)', [deskId, 'Arabic desk']);
    await execute('INSERT INTO desk_members (desk_id, user_id) VALUES (?, ?)', [deskId, onDesk.id]);

    const ownerCookie = await signIn(base, owner);
    const res = await send('POST', '/api/v2/banners', ownerCookie, {
      title: 'Arabic desk meeting', audience: 'desk', deskId,
    });
    expect(res.status, await res.clone().text()).toBe(201);

    const theirs = await (await send('GET', '/api/v2/home', await signIn(base, onDesk))).json() as {
      banners: Array<{ title: string }>;
    };
    expect(theirs.banners.map((one) => one.title)).toEqual(['Arabic desk meeting']);

    const others = await (await send('GET', '/api/v2/home', await signIn(base, offDesk))).json() as {
      banners: Array<{ title: string }>;
    };
    expect(others.banners).toEqual([]);
  });

  it('counts how many of the people it is for have seen it', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const one = await createTestUser({ role: 'agent', email: 'one@emircrm.test' });
    await createTestUser({ role: 'agent', email: 'two@emircrm.test' });
    const ownerCookie = await signIn(base, owner);
    await send('POST', '/api/v2/banners', ownerCookie, {
      title: 'Read me', audience: 'agents',
    });

    /* Two loads by the same person is still one reader. */
    const theirs = await signIn(base, one);
    await send('GET', '/api/v2/home', theirs);
    await send('GET', '/api/v2/home', theirs);

    const list = await (await send('GET', '/api/v2/banners', ownerCookie)).json() as {
      items: Array<{ seenBy: number; audienceSize: number }>;
    };
    expect(list.items[0]?.seenBy).toBe(1);
    expect(list.items[0]?.audienceSize).toBe(2);
  });

  it('takes a picture, and refuses one that is not a picture', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const cookie = await signIn(base, owner);
    const made = await (await send('POST', '/api/v2/banners', cookie, {
      title: 'With a photograph',
    })).json() as { id: string };

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    const up = await fetch(`${base}/api/v2/banners/${made.id}/image`, {
      method: 'POST',
      headers: { Cookie: cookie, 'content-type': 'image/png' },
      body: png,
    });
    expect(up.status, await up.clone().text()).toBe(201);
    expect((await up.json() as { imagePath: string | null }).imagePath).toContain(made.id);

    const back = await fetch(`${base}/api/v2/banners/${made.id}/image`, {
      headers: { Cookie: cookie },
    });
    expect(back.status).toBe(200);
    expect(back.headers.get('content-type')).toBe('image/png');

    const bad = await fetch(`${base}/api/v2/banners/${made.id}/image`, {
      method: 'POST',
      headers: { Cookie: cookie, 'content-type': 'application/pdf' },
      body: Buffer.from('%PDF-1.4'),
    });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('not a picture');
  });

  it('is shut to an agent, every verb of it', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const cookie = await signIn(base, agent);
    for (const [method, path] of [
      ['GET', '/api/v2/banners'],
      ['POST', '/api/v2/banners'],
      ['POST', '/api/v2/banners/any/image'],
    ] as Array<[string, string]>) {
      const res = await send(
        method, path, cookie, method === 'GET' ? undefined : { title: 'Mine now' },
      );
      expect(res.status, `${method} ${path} let an agent through`).toBe(403);
    }
  });
});
