import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, createTestUser, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { clearSecretCache, saveSetting } from '../config/secrets.js';
import { dayState } from './attendance.js';

/**
 * What an agent's own screen is told about the shift.
 *
 * `design/web/attendance.html` writes three facts the agent's screen could
 * not reach: "Shift 09:00 – 18:00, Monday to Friday", "Late · check-in after
 * 09:10", and the hero's warning that a check-in at this hour counts as late.
 * All three live in the attendance settings, and that endpoint is owner-only
 * — rightly, because it also carries the office's addresses.
 *
 * So `dayState` carries the hours and nothing else. The rule this file holds
 * is the second half of that sentence: **the office's addresses never reach
 * an agent's screen through it.**
 */
const OFFICE = '203.0.113.10';
const ELSEWHERE = '5.195.40.7';

const ACTOR = {
  userId: null, role: 'owner', label: 'test', ip: null, userAgent: null,
} as const;

async function switchOn(): Promise<void> {
  await saveSetting(ACTOR, 'ATT_OFFICE_IPS', JSON.stringify([OFFICE]));
  await saveSetting(ACTOR, 'ATT_OFFICE_NAMES', JSON.stringify({ [OFFICE]: 'homes.me-Office' }));
  await saveSetting(ACTOR, 'ATT_ENABLED', '1');
  await saveSetting(ACTOR, 'ATT_START', '09:00');
  await saveSetting(ACTOR, 'ATT_END', '18:00');
  await saveSetting(ACTOR, 'ATT_SAT_START', '11:00');
  await saveSetting(ACTOR, 'ATT_SAT_END', '15:00');
  await saveSetting(ACTOR, 'ATT_CLOSED_DAYS', JSON.stringify([0, 6]));
  await saveSetting(ACTOR, 'ATT_GRACE_MINUTES', '10');
  clearSecretCache();
}

/** A Wednesday and a Sunday in Dubai, both at 08:00 local. */
const WEDNESDAY = new Date('2026-11-11T04:00:00.000Z');
const SUNDAY = new Date('2026-11-15T04:00:00.000Z');

describeWithDb('the shift an agent is told about', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); clearSecretCache(); });

  it('carries the whole week, and when a tap counts as late', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    const state = await dayState(agent.id, OFFICE, WEDNESDAY);

    expect(state.startsAt).toBe('09:00');
    expect(state.endsAt).toBe('18:00');
    /* The design's "Late · after 09:10": the start plus the grace. */
    expect(state.lateAfter).toBe('09:10');
    expect(state.shift).toEqual({
      start: '09:00', end: '18:00', satStart: '11:00', satEnd: '15:00',
      closedDays: [0, 6], graceMinutes: 10,
    });
  });

  it('says nothing about today on a day the office is shut', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    const state = await dayState(agent.id, OFFICE, SUNDAY);

    expect(state.closed).toBe(true);
    expect(state.startsAt).toBe(null);
    expect(state.endsAt).toBe(null);
    expect(state.lateAfter).toBe(null);
    /* The week itself is still there, for "How check-in works". */
    expect(state.shift.closedDays).toEqual([0, 6]);
  });

  it('names the network the agent is on, and only that', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });

    const inOffice = await dayState(agent.id, OFFICE, WEDNESDAY);
    expect(inOffice.officeName).toBe('homes.me-Office');
    expect(inOffice.officeNames).toEqual(['homes.me-Office']);

    const away = await dayState(agent.id, ELSEWHERE, WEDNESDAY);
    expect(away.officeName).toBe(null);
    /* The names are the label on the door, so the "Where" row can say which
       network to be on. The addresses are not here. */
    expect(JSON.stringify(away)).not.toContain(OFFICE);
  });

  it('never carries the office addresses to an agent', async () => {
    await switchOn();
    const agent = await createTestUser({ role: 'agent' });
    const state = await dayState(agent.id, ELSEWHERE, WEDNESDAY);
    /* `seenIp` is the address the server saw of *this* caller, which is
       theirs and is already on their own screen. The office's list is not
       in the answer at all. */
    expect(state.seenIp).toBe(ELSEWHERE);
    expect(JSON.stringify(state)).not.toContain(OFFICE);
  });

  it('keeps the defaults when an owner has set nothing', async () => {
    const agent = await createTestUser({ role: 'agent' });
    const state = await dayState(agent.id, null, WEDNESDAY);
    expect(state.enabled).toBe(false);
    expect(state.shift.start).toBe('10:00');
    expect(state.officeName).toBe(null);
    expect(state.officeNames).toEqual([]);
  });
});
