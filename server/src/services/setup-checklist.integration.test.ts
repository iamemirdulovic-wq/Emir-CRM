import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  closeTestDatabase, describeWithDb, prepareTestDatabase, resetTables,
} from '../testing/db.js';
import { clearSecretCache, saveSetting } from '../config/secrets.js';
import { setupChecklist } from './setup-checklist.js';

/**
 * The checklist is the only place the CRM admits that something is off.
 *
 * Every feature on it fails silently by design — an email recorded as not
 * sent, a follow-up that never goes, an attendance card that renders nothing.
 * Attendance was built without being added here, and the owner opened an
 * agent's dashboard, found no check-in button and had no way at all to learn
 * why. That is the failure this file exists to stop happening again.
 */
const ACTOR = {
  userId: null, role: 'owner', label: 'test', ip: null, userAgent: null,
} as const;

describeWithDb('what is still switched off', () => {
  beforeAll(async () => { await prepareTestDatabase(); });
  afterAll(async () => { await closeTestDatabase(); });
  beforeEach(async () => { await resetTables(); clearSecretCache(); });

  it('lists attendance, and counts it as not ready out of the box', async () => {
    const list = await setupChecklist();
    const item = list.items.find((entry) => entry.key === 'attendance');
    expect(item, 'attendance must appear on the checklist').toBeDefined();
    expect(item?.ready).toBe(false);
    expect(list.outstanding).toBeGreaterThan(0);
  });

  /* The two reasons it can be off read differently, because the fix differs:
     one needs an address, the other needs the switch. */
  it('says an address is missing before it says the switch is off', async () => {
    const before = (await setupChecklist()).items.find((e) => e.key === 'attendance');
    expect(before?.consequence).toMatch(/add the office wi-fi address/i);

    await saveSetting(ACTOR, 'ATT_OFFICE_IPS', JSON.stringify(['203.0.113.10']));
    clearSecretCache();

    const after = (await setupChecklist()).items.find((e) => e.key === 'attendance');
    expect(after?.ready).toBe(false);
    expect(after?.consequence).toMatch(/switch is off/i);
  });

  it('stops nagging once an address is saved and the switch is on', async () => {
    await saveSetting(ACTOR, 'ATT_OFFICE_IPS', JSON.stringify(['203.0.113.10']));
    await saveSetting(ACTOR, 'ATT_ENABLED', '1');
    clearSecretCache();

    const item = (await setupChecklist()).items.find((e) => e.key === 'attendance');
    expect(item?.ready).toBe(true);
  });

  /*
   * The link is the whole point of the row: it is what the owner presses.
   * `?tab=` was being ignored by the Settings screen until this was written,
   * so every one of these rows quietly landed on the wrong tab.
   */
  it('points every row at a settings tab, with the tab named', async () => {
    for (const item of (await setupChecklist()).items) {
      expect(item.to, `${item.key} must link somewhere`).toMatch(/^\/settings\?tab=[a-z]+$/);
    }
  });
});
