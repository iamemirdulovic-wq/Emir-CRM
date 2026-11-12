import { describe, expect, it } from 'vitest';
import {
  isLeadTab, LEAD_TABS, sameDubaiDay, TABS, urgencyOf,
} from './tabs.js';

/**
 * The tabs decide what an agent sees when they open the CRM, which means a
 * mistake here does not look like a bug — it looks like a lead that quietly
 * stopped appearing anywhere. Every boundary is pinned.
 */

const hours = (n: number) => n * 60 * 60 * 1000;
/** A moment at a given Dubai wall-clock time. Dubai is UTC+4, no DST. */
const dubai = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, day, hour - 4, minute, 0));

describe('how urgent a promise looks', () => {
  const now = dubai(15, 10, 0);

  it('marks a promise that has already passed', () => {
    expect(urgencyOf(dubai(15, 9, 0), now)).toBe('overdue');
    expect(urgencyOf(dubai(14, 18, 0), now)).toBe('overdue');
  });

  it('marks the rest of today as due today', () => {
    expect(urgencyOf(dubai(15, 16, 0), now)).toBe('due_today');
    expect(urgencyOf(dubai(15, 23, 59), now)).toBe('due_today');
  });

  it('treats tomorrow as simply coming up', () => {
    expect(urgencyOf(dubai(16, 9, 0), now)).toBe('soon');
  });

  /* A promise due at exactly this second is owed now, not later. */
  it('counts the moment itself as overdue', () => {
    expect(urgencyOf(now, now)).toBe('overdue');
  });

  it('says nothing when nothing was promised', () => {
    expect(urgencyOf(null, now)).toBe('none');
    expect(urgencyOf('not a date', now)).toBe('none');
  });

  /*
   * Midnight in Dubai, not in UTC. At 01:00 Dubai the UTC date is still
   * yesterday, and a naive comparison would call a 23:00 promise "tomorrow".
   */
  it('splits days on Dubai midnight, not UTC', () => {
    const lateNight = dubai(15, 1, 0);
    expect(urgencyOf(dubai(15, 23, 0), lateNight)).toBe('due_today');
    expect(urgencyOf(dubai(16, 1, 0), lateNight)).toBe('soon');
  });

  it('knows which day two moments fall on in Dubai', () => {
    expect(sameDubaiDay(dubai(15, 0, 30), dubai(15, 23, 30))).toBe(true);
    expect(sameDubaiDay(dubai(15, 23, 30), dubai(16, 0, 30))).toBe(false);
  });
});

describe('the tab definitions', () => {
  it('has one for every name', () => {
    for (const tab of LEAD_TABS) expect(TABS[tab]).toBeDefined();
  });

  /*
   * Won and Lost leads are history, not work. A tab that counts them is a tab
   * that never reaches zero, and a counter nobody can clear gets ignored.
   *
   * Two tabs are history on purpose and say so in their names: All, and Lost,
   * which v2 adds. Naming them here rather than loosening the rule keeps the
   * rule meaning what it says -- a third exemption has to be argued for in
   * this file, not slipped in beside a new tab.
   */
  const HISTORY_TABS = new Set(['all', 'lost']);

  it('keeps closed leads out of every working tab', () => {
    for (const tab of LEAD_TABS) {
      if (HISTORY_TABS.has(tab)) continue;
      expect(TABS[tab].where, tab).toContain("o.status = 'open'");
    }
  });

  it('has exactly two tabs that show closed leads', () => {
    const showsClosed = LEAD_TABS.filter((tab) => !TABS[tab].where.includes("o.status = 'open'"));
    expect(new Set(showsClosed)).toEqual(HISTORY_TABS);
  });

  /* Deleted leads must not reappear through any tab, including All. */
  it('excludes deleted leads everywhere', () => {
    for (const tab of LEAD_TABS) {
      expect(TABS[tab].where, tab).toContain('o.deleted_at IS NULL');
    }
  });

  it('carries no placeholder, so a tab can never shift a parameter list', () => {
    for (const tab of LEAD_TABS) {
      expect(TABS[tab].where, tab).not.toContain('?');
      expect(TABS[tab].orderBy, tab).not.toContain('?');
    }
  });

  /* Every empty state tells the agent what to do next rather than just
     reporting that there is nothing. */
  it('has an empty state with a way forward', () => {
    for (const tab of LEAD_TABS) {
      expect(TABS[tab].emptyTitle.length, tab).toBeGreaterThan(0);
      expect(TABS[tab].emptyHint.length, tab).toBeGreaterThan(10);
    }
  });

  it('recognises only real tab names', () => {
    expect(isLeadTab('today')).toBe(true);
    expect(isLeadTab('no_next_step')).toBe(true);
    expect(isLeadTab('everything')).toBe(false);
    expect(isLeadTab(null)).toBe(false);
  });
});
