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
    })).toEqual({
      slaMinutes: 3, reminderMinutes: 1, autoAssign: false, bounceToOwner: true, emailOwnerOnNewLead: true,
      quietHours: true, quietStart: '22:00', quietEnd: '08:00',
    });
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
   * An owner who is not in the CRM finds out by email, so this stays on until
   * someone decides the volume is too much and turns it off.
   */
  it('emails the owner about new leads unless that was turned off', () => {
    expect(parseRoutingSettings({}).emailOwnerOnNewLead).toBe(true);
    expect(parseRoutingSettings({ emailOwnerOnNewLead: '0' }).emailOwnerOnNewLead).toBe(false);
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

/**
 * The hours when the clock does not run.
 *
 * A lead arriving at 03:10 still gets its reply inside thirty seconds; what
 * must not happen is taking it off a sleeping agent at 03:15 for not calling.
 * A time stored wrong here would either leave the clock running all night or
 * stop it all day, and neither announces itself.
 */
describe('the quiet hours', () => {
  it('is on from ten at night until eight, unless someone changed it', () => {
    const settings = parseRoutingSettings({});
    expect(settings.quietHours).toBe(true);
    expect(settings.quietStart).toBe('22:00');
    expect(settings.quietEnd).toBe('08:00');
  });

  it('reads the times an owner set', () => {
    const settings = parseRoutingSettings({ quietStart: '21:30', quietEnd: '07:00' });
    expect(settings.quietStart).toBe('21:30');
    expect(settings.quietEnd).toBe('07:00');
  });

  /* Written back padded, so the stored value and the shown value match. */
  it('normalises a time typed without a leading zero', () => {
    expect(parseRoutingSettings({ quietStart: '9:05' }).quietStart).toBe('09:05');
  });

  /*
   * A time that cannot be read falls back rather than reaching the routing
   * code, where it would quietly mean midnight and stop the clock all day.
   */
  it('falls back on a time that is not a time', () => {
    expect(parseRoutingSettings({ quietStart: 'evening' }).quietStart).toBe('22:00');
    expect(parseRoutingSettings({ quietEnd: '25:00' }).quietEnd).toBe('08:00');
    expect(parseRoutingSettings({ quietStart: '' }).quietStart).toBe('22:00');
  });

  it('can be switched off entirely', () => {
    expect(parseRoutingSettings({ quietHours: '0' }).quietHours).toBe(false);
  });
});
