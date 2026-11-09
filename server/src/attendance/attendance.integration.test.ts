import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { execute, queryOne } from '../db/client.js';
import { saveSetting } from '../config/secrets.js';
import { clearSecretCache } from '../config/secrets.js';
import {
  attendanceMonth, dayState, dubaiDate, dubaiDay, markOffice, markOutside,
} from './attendance.js';

/**
 * Attendance against a real database.
 *
 * The rules that matter, each of which would be noticed by somebody standing
 * in the office at ten in the morning:
 *
 *   - the office address lets you in, any other refuses;
 *   - "working outside" is allowed from anywhere, because that is the point
 *     of it, and never counts as late;
 *   - one row a day, so a double tap is not two arrivals;
 *   - a closed day and a day still to come are not absences.
 */
const OFFICE = '203.0.113.10';
const ELSEWHERE = '5.195.40.7';

const ACTOR = {
  userId: null, role: 'owner', label: 'test', ip: null, userAgent: null,
} as const;

async function switchOn(): Promise<void> {
  await saveSetting(ACTOR, 'ATT_OFFICE_IPS', JSON.stringify([OFFICE]));
  await saveSetting(ACTOR, 'ATT_ENABLED', '1');
  await saveSetting(ACTOR, 'ATT_START', '10:00');
  await saveSetting(ACTOR, 'ATT_SAT_START', '11:00');
  await saveSetting(ACTOR, 'ATT_CLOSED_DAYS', JSON.stringify([0]));
  await saveSetting(ACTOR, 'ATT_GRACE_MINUTES', '10');
  clearSecretCache();
}

describeWithDb('office attendance', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); clearSecretCache(); });

  it('is off until an owner saves an address', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const state = await dayState(agent.id, OFFICE);
    expect(state.enabled).toBe(false);
    await expect(markOffice(agent.id, OFFICE)).rejects.toThrow(/not switched on/i);
  });

  it('refuses even the office address while it is switched off', async () => {
    await saveSetting(ACTOR, 'ATT_OFFICE_IPS', JSON.stringify([OFFICE]));
    clearSecretCache();
    const agent = await createTestUser({ role: 'agent' });
    await expect(markOffice(agent.id, OFFICE)).rejects.toThrow(/not switched on/i);
  });

  it('lets somebody on the office Wi-Fi check in', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    const state = await markOffice(agent.id, OFFICE);
    expect(state.marked).toBe('office');
    expect(state.onOfficeNetwork).toBe(true);
  });

  it('refuses a check-in from anywhere else', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    await expect(markOffice(agent.id, ELSEWHERE)).rejects.toThrow(/office Wi-Fi/i);
    expect((await dayState(agent.id, ELSEWHERE)).marked).toBeNull();
  });

  it('records the address the tap came from', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    await markOffice(agent.id, OFFICE);
    const row = await queryOne<{ seen_ip: string }>(
      'SELECT seen_ip FROM attendance WHERE user_id = ?', [agent.id],
    );
    expect(row?.seen_ip).toBe(OFFICE);
  });

  /* The whole reason this exists: an agent at a developer's sales centre is
     working, and must not read as absent. */
  it('lets somebody mark working outside from any network', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    const state = await markOutside(agent.id, 'Emaar sales centre', ELSEWHERE);
    expect(state.marked).toBe('outside');
    expect(state.note).toBe('Emaar sales centre');
    expect(state.wasLate).toBe(false);
  });

  it('asks where they are before accepting it', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    await expect(markOutside(agent.id, '   ', ELSEWHERE)).rejects.toThrow(/where you are/i);
  });

  /* A double tap, or a check-in followed by a change of mind, must not turn
     one morning into two arrivals. */
  it('keeps one row a day, first tap wins', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    await markOffice(agent.id, OFFICE);
    await markOffice(agent.id, OFFICE);
    await markOutside(agent.id, 'changed my mind', OFFICE);

    const row = await queryOne<{ n: number; kind: string }>(
      'SELECT COUNT(*) AS n, MIN(kind) AS kind FROM attendance WHERE user_id = ?', [agent.id],
    );
    expect(Number(row?.n)).toBe(1);
    expect(row?.kind).toBe('office');
  });

  it('marks a late arrival late, and an early one not', async () => {
    await switchOn();
    const early = await createTestUser({ role: 'agent' });
    const late = await createTestUser({ role: 'agent' });

    /* A Monday, so the weekday 10:00 start applies rather than Saturday's. */
    const monday = '2026-11-09';
    await markOffice(early.id, OFFICE, new Date(`${monday}T05:55:00Z`)); // 09:55 Dubai
    await markOffice(late.id, OFFICE, new Date(`${monday}T06:40:00Z`)); // 10:40 Dubai

    expect((await dayState(early.id, OFFICE, new Date(`${monday}T05:55:00Z`))).wasLate).toBe(false);
    expect((await dayState(late.id, OFFICE, new Date(`${monday}T06:40:00Z`))).wasLate).toBe(true);
  });

  /* Ten minutes' grace means 10:09 is on time and 10:11 is not. */
  it('honours the grace minutes', async () => {
    await switchOn();
    const a = await createTestUser({ role: 'agent' });
    const b = await createTestUser({ role: 'agent' });
    const monday = '2026-11-09';
    await markOffice(a.id, OFFICE, new Date(`${monday}T06:09:00Z`)); // 10:09
    await markOffice(b.id, OFFICE, new Date(`${monday}T06:11:00Z`)); // 10:11
    expect((await dayState(a.id, OFFICE, new Date(`${monday}T06:09:00Z`))).wasLate).toBe(false);
    expect((await dayState(b.id, OFFICE, new Date(`${monday}T06:11:00Z`))).wasLate).toBe(true);
  });

  it('says the office is closed on a Sunday', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    const sunday = new Date('2026-11-08T08:00:00Z');
    expect(dubaiDay(sunday)).toBe(0);
    expect((await dayState(agent.id, OFFICE, sunday)).closed).toBe(true);
  });

  /*
   * The server runs on UTC. A tap at half past midnight Dubai is still the
   * previous UTC day, and filing it under the UTC date would put somebody's
   * Tuesday on Monday's row.
   */
  it('files a tap under the Dubai day, not the UTC one', () => {
    expect(dubaiDate(new Date('2026-11-09T20:30:00Z'))).toBe('2026-11-10');
    expect(dubaiDate(new Date('2026-11-09T19:59:00Z'))).toBe('2026-11-09');
  });

  it('leaves the owner out of the month, and counts the rest', async () => {
    await switchOn();
    await createTestUser({ role: 'owner', email: 'owner@attendance.test' });
    const agent = await createTestUser({ role: 'agent', name: 'Layla Hassan' });
    await markOffice(agent.id, OFFICE);

    const month = await attendanceMonth(dubaiDate(), dubaiDate());
    expect(month.people.every((p) => p.role !== 'owner')).toBe(true);
    const mine = month.people.find((p) => p.userId === agent.id);
    expect(mine?.inOffice).toBe(1);
    expect(mine?.absent).toBe(0);
  });

  /* A day the office was shut is not a day anybody failed to come in. */
  it('does not count a closed day as an absence', async () => {
    await switchOn();
    await createTestUser({ role: 'agent' });
    const month = await attendanceMonth('2026-11-08', '2026-11-08'); // a Sunday
    expect(month.dates[0]?.closed).toBe(true);
    expect(month.people[0]?.absent).toBe(0);
  });

  /* Nor is a day that has not happened yet. */
  it('does not count a future day as an absence', async () => {
    await switchOn();
    await createTestUser({ role: 'agent' });
    const ahead = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const month = await attendanceMonth(ahead, ahead);
    expect(month.people[0]?.absent).toBe(0);
  });

  it('counts a missed open day that has already passed', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    /* A Monday well in the past, so it is neither closed nor ahead. */
    const month = await attendanceMonth('2026-11-02', '2026-11-02');
    expect(month.people.find((p) => p.userId === agent.id)?.absent).toBe(1);
  });

  it('keeps one person out of another’s day', async () => {
    await switchOn();
    const one = await createTestUser({ role: 'agent' });
    const two = await createTestUser({ role: 'agent' });
    await markOffice(one.id, OFFICE);
    expect((await dayState(two.id, OFFICE)).marked).toBeNull();
  });

  it('leaves a deactivated person out of the month', async () => {
    await switchOn();
    const gone = await createTestUser({ role: 'agent' });
    await execute('UPDATE users SET is_active = 0 WHERE id = ?', [gone.id]);
    const month = await attendanceMonth(dubaiDate(), dubaiDate());
    expect(month.people.some((p) => p.userId === gone.id)).toBe(false);
  });
});
