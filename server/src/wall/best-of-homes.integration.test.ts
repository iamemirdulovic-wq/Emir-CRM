import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, execute, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { resetRateLimits } from '../http/middleware/rate-limit.js';
import { setEnvForTesting } from '../config/env.js';
import { createApp } from '../http/app.js';
import { signIn } from '../testing/http.js';
import { newId } from '../lib/ids.js';
import { BOARD_DAYS } from './wall.js';

/**
 * Best of Homes agrees with itself.
 *
 * The ranking table counts points over the last thirty days. The "you are
 * 1st" chip beside it counted all time, from `pointsFor`, so the same person
 * read two different numbers on one screen — 418 against 377 when the owner
 * checked it on 13 Nov — and the level bar under the chip printed the all-time
 * figure against a threshold the table knew nothing about.
 *
 * Thirty days won, because the page says "last 30 days" in three places that
 * the server cannot see, and because the figure people are being compared on
 * is the one that has to be true. The open question — whether a level ought to
 * be able to fall after a quiet month — is in `docs/v2/questions-bugs.md`.
 */
let server: Server;
let base = '';

interface Sidebar {
  leaderboard: Array<{ id: string; name: string; points: number }>;
  me: { points: number; level: { level: number; next: number | null }; streak: number };
}

describeWithDb('Best of Homes', () => {
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

  /** Points earned `daysAgo` days ago. `subject_id` keeps the unique key happy. */
  async function award(userId: string, points: number, daysAgo: number): Promise<void> {
    await execute(
      `INSERT INTO xp_events (id, user_id, rule, points, subject_type, subject_id, earned_on, created_at)
       VALUES (?, ?, 'deal_won', ?, 'test', ?,
               DATE(DATE_SUB(NOW(3), INTERVAL ? DAY)), DATE_SUB(NOW(3), INTERVAL ? DAY))`,
      [newId(), userId, points, newId(), daysAgo, daysAgo],
    );
  }

  const sidebar = async (cookie: string): Promise<Sidebar> => {
    const res = await fetch(`${base}/api/wall/sidebar`, { headers: { cookie } });
    expect(res.status).toBe(200);
    return await res.json() as Sidebar;
  };

  it('shows the same number in the chip as in the ranking table', async () => {
    const agent = await createTestUser({ role: 'agent', name: 'Layla Hassan' });
    /* 377 inside the window, 41 outside it: all time 418, which is the pair of
       numbers the owner actually saw. */
    await award(agent.id, 300, 2);
    await award(agent.id, 77, 20);
    await award(agent.id, 41, BOARD_DAYS + 5);

    const body = await sidebar(await signIn(base, agent));
    const mine = body.leaderboard.find((row) => row.id === agent.id);

    expect(mine?.points).toBe(377);
    expect(body.me.points, 'the chip and the table are one window').toBe(mine?.points);
    expect(body.me.points).toBe(377);
  });

  it('counts nothing from before the window, in either place', async () => {
    const agent = await createTestUser({ role: 'agent', name: 'Old Timer' });
    await award(agent.id, 500, BOARD_DAYS + 1);

    const body = await sidebar(await signIn(base, agent));
    expect(body.leaderboard.find((row) => row.id === agent.id)?.points).toBe(0);
    expect(body.me.points).toBe(0);
  });

  /*
   * The level bar prints `me.points` against `level.next`, so the level has to
   * be worked out from the same number or the bar and its own caption
   * disagree — which is the contradiction this is removing, not moving.
   */
  it('works the level out from the number it prints', async () => {
    const agent = await createTestUser({ role: 'agent', name: 'Climbing' });
    await award(agent.id, 60, 1);          // inside: level 2 starts at 50
    await award(agent.id, 2_000, BOARD_DAYS + 3); // outside: would be level 6

    const body = await sidebar(await signIn(base, agent));
    expect(body.me.points).toBe(60);
    expect(body.me.level.level).toBe(2);
    expect(body.me.level.next).toBe(150);
  });

  it('ranks everybody on that same window', async () => {
    const quiet = await createTestUser({ role: 'agent', name: 'Quiet Lately' });
    const busy = await createTestUser({ role: 'agent', name: 'Busy Lately' });
    await award(quiet.id, 900, BOARD_DAYS + 2);
    await award(quiet.id, 10, 3);
    await award(busy.id, 120, 3);

    const body = await sidebar(await signIn(base, quiet));
    expect(body.leaderboard.map((row) => row.name)).toEqual(['Busy Lately', 'Quiet Lately']);
    expect(body.me.points).toBe(10);
  });
});
