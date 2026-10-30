import { describe, expect, it } from 'vitest';
import { parseRoutingSettings, ROUTING_DEFAULTS } from './settings.js';

/**
 * These four numbers decide how long a client waits before someone calls them,
 * and whether a lead is ever assigned at all. A value typed wrong on a Sunday
 * evening must not quietly switch the timer off, so every awkward input is
 * settled here rather than on a live lead.
 */
describe('reading the lead routing settings', () => {
  it('uses the defaults when nothing has been set', () => {
    expect(parseRoutingSettings({})).toEqual(ROUTING_DEFAULTS);
  });

  it('reads the values an owner saved', () => {
    expect(parseRoutingSettings({
      slaMinutes: '3', reminderMinutes: '1', autoAssign: '0', bounceToOwner: '1',
    })).toEqual({ slaMinutes: 3, reminderMinutes: 1, autoAssign: false, bounceToOwner: true });
  });

  /* An empty field in a form posts as "", which is not a decision to change anything. */
  it('treats an empty value as unset', () => {
    expect(parseRoutingSettings({ slaMinutes: '', autoAssign: '  ' })).toEqual(ROUTING_DEFAULTS);
  });

  it('falls back rather than taking a word as a number', () => {
    expect(parseRoutingSettings({ slaMinutes: 'five' }).slaMinutes).toBe(ROUTING_DEFAULTS.slaMinutes);
  });

  /*
   * Zero would mean every lead bounces the instant it is assigned; a negative
   * would mean the deadline is already past. Both are the timer switched off
   * by accident, which is the one outcome worth refusing.
   */
  it('never lets the deadline reach zero', () => {
    expect(parseRoutingSettings({ slaMinutes: '0' }).slaMinutes).toBe(1);
    expect(parseRoutingSettings({ slaMinutes: '-5' }).slaMinutes).toBe(1);
  });

  it('caps a deadline nobody meant to type', () => {
    expect(parseRoutingSettings({ slaMinutes: '99999' }).slaMinutes).toBe(120);
  });

  /* A reminder at or after the deadline would arrive with the bounce. */
  it('keeps the reminder inside the deadline', () => {
    expect(parseRoutingSettings({ slaMinutes: '5', reminderMinutes: '5' }).reminderMinutes).toBe(4);
    expect(parseRoutingSettings({ slaMinutes: '5', reminderMinutes: '9' }).reminderMinutes).toBe(4);
  });

  it('re-caps the reminder when the deadline is shortened under it', () => {
    expect(parseRoutingSettings({ slaMinutes: '2', reminderMinutes: '3' }).reminderMinutes).toBe(1);
  });

  it('allows the reminder to be switched off', () => {
    expect(parseRoutingSettings({ reminderMinutes: '0' }).reminderMinutes).toBe(0);
    expect(parseRoutingSettings({ reminderMinutes: '-1' }).reminderMinutes).toBe(0);
  });

  it('rounds a fractional minute rather than carrying it', () => {
    expect(parseRoutingSettings({ slaMinutes: '4.6' }).slaMinutes).toBe(5);
  });

  it('reads the spellings a person or a checkbox might send', () => {
    for (const yes of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(parseRoutingSettings({ autoAssign: yes }).autoAssign).toBe(true);
    }
    for (const no of ['0', 'false', 'no', 'off', 'anything else']) {
      expect(parseRoutingSettings({ autoAssign: no }).autoAssign).toBe(false);
    }
  });

  /*
   * The 30-second reply is the product. Leaving it on unless someone has
   * deliberately written "off" is the safe direction for this one to fail in.
   */
  it('leaves automatic assignment on unless it was deliberately turned off', () => {
    expect(parseRoutingSettings({}).autoAssign).toBe(true);
    expect(parseRoutingSettings({ autoAssign: null }).autoAssign).toBe(true);
    expect(parseRoutingSettings({ autoAssign: '0' }).autoAssign).toBe(false);
  });
});
