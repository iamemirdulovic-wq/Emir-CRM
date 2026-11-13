import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestDatabase, describeWithDb, execute, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { setEnvForTesting } from '../config/env.js';
import { newId } from '../lib/ids.js';
import {
  SERVICE_KEYS, measureAll, runChecks, serviceHistory,
} from './health-checks.js';

/**
 * The thirty-day bars on `design/web/system-health.html`.
 *
 * These used to be left out of the build, and the reason was right: nothing
 * recorded uptime, so thirty green rectangles would have been the page
 * telling the owner something nobody had counted. What this file proves is
 * that they are now counted — a bar is a day that was sampled, a grey bar is
 * a day nobody checked, and a run of bad samples becomes one incident rather
 * than 288 rows a day.
 */
describeWithDb('measuring whether anything works', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { setEnvForTesting(null); await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); });

  it('measures all six services and says which are not fine', async () => {
    const measured = await measureAll();
    expect(measured.map((one) => one.service).sort()).toEqual([...SERVICE_KEYS].sort());

    /* The database and the site are answering, because this test is talking
       to them. Both have a real number beside them. */
    const db = measured.find((one) => one.service === 'database');
    expect(db?.state).toBe('ok');
    expect(typeof db?.ms).toBe('number');

    /* With no key and no FCM credentials in the test environment, these two
       are down — and "down" here means "nothing will ever happen", which is
       the whole point of the page. */
    expect(measured.find((one) => one.service === 'ai')?.state).toBe('down');
    expect(measured.find((one) => one.service === 'notifications')?.state).toBe('down');
  });

  it('never puts a key, or any part of one, in what it records', async () => {
    const measured = await runChecks();
    const text = JSON.stringify(measured);
    /* The AI row says whether a key is set and what the month cost. Not the
       key, not a hint, not a length. */
    expect(text).not.toMatch(/AIza|api[_-]?key["\s:]+[A-Za-z0-9]/i);
    const ai = measured.find((one) => one.service === 'ai');
    expect(ai?.note).toContain('No key');
  });

  it('writes one row per service per check', async () => {
    await runChecks();
    const rows = await (await import('../db/client.js')).query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM service_checks',
    );
    expect(Number(rows[0]?.n)).toBe(SERVICE_KEYS.length);
  });

  it('is honest about a day nobody checked', async () => {
    const fresh = await serviceHistory();
    /* Nothing recorded: the page is told so rather than shown green bars. */
    expect(fresh.neverChecked).toBe(true);
    for (const service of fresh.services) {
      expect(service.upPercent).toBeNull();
      expect(service.samples).toBe(0);
      expect(service.days.every((day) => day.state === null)).toBe(true);
    }

    await runChecks();
    const after = await serviceHistory();
    expect(after.neverChecked).toBe(false);
    const db = after.services.find((one) => one.key === 'database');
    expect(db?.samples).toBe(1);
    expect(db?.upPercent).toBe(100);
    /* Today has a bar; the twenty-nine days before it still do not. */
    expect(db?.days.at(-1)?.state).toBe('ok');
    expect(db?.days.at(0)?.state).toBeNull();
    expect(db?.days).toHaveLength(after.days);
  });

  it('turns a run of bad samples into one incident, named by its worst state', async () => {
    const write = async (state: string, minutesAgo: number, note: string) => execute(
      `INSERT INTO service_checks (id, service, state, ms, note, checked_at)
       VALUES (?, 'notifications', ?, 48000, ?, DATE_SUB(NOW(3), INTERVAL ? MINUTE))`,
      [newId(), state, note, minutesAgo],
    );

    /* Fine, then slow for three samples, then down, then fine again. One
       incident, closed, called "not working" because that is the worst it
       got. */
    await write('ok', 60, 'fine');
    await write('slow', 50, 'Alerts take 48 seconds');
    await write('slow', 45, 'Alerts take 48 seconds');
    await write('down', 40, 'No alert was sent');
    await write('ok', 30, 'fine');
    /* And a second stretch, still open. */
    await write('slow', 10, 'Alerts take 48 seconds');

    const report = await serviceHistory();
    const mine = report.incidents.filter((one) => one.service === 'notifications');
    expect(mine).toHaveLength(2);

    /* Still-open first: what is wrong now matters more than last week. */
    expect(mine[0]?.open).toBe(true);
    expect(mine[0]?.to).toBeNull();
    expect(mine[0]?.title).toContain('slow');

    expect(mine[1]?.open).toBe(false);
    expect(mine[1]?.to).not.toBeNull();
    expect(mine[1]?.title).toContain('not working');

    /* Four of six samples were fine. */
    const service = report.services.find((one) => one.key === 'notifications');
    expect(service?.samples).toBe(6);
    expect(service?.upPercent).toBeCloseTo(33.3, 1);
    /* And the last sample is the one the chip shows. */
    expect(service?.state).toBe('slow');
  });

  it('counts how many are not fine right now', async () => {
    await execute(
      `INSERT INTO service_checks (id, service, state, checked_at)
       VALUES (?, 'database', 'ok', NOW(3)), (?, 'storage', 'down', NOW(3))`,
      [newId(), newId()],
    );
    const report = await serviceHistory();
    /* The four with no sample read as fine, because nothing says otherwise;
       storage is the one that was measured as down. */
    expect(report.outstanding).toBe(1);
    expect(report.fine).toBe(SERVICE_KEYS.length - 1);
    expect(report.checkedAt).not.toBeNull();
  });
});
