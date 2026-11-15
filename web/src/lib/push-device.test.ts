import { describe, expect, it } from 'vitest';
import { pushLook, pushSaid } from './push-device.js';
import type { PushState } from './push.js';

/**
 * Whether a device can get alerts, read once for all three screens.
 *
 * Before 15 Nov each of them answered it separately, and the v2 ones answered
 * it wrong: the settings panel had no switch at all, and the phone-app guide
 * asked the browser for permission and then said "This computer will show
 * alerts" without ever registering a token, so nothing could be delivered.
 *
 * The two rules worth pinning down are both about honesty. A switch is only
 * drawn as on when a device is really registered, and it is only drawn as
 * pressable when pressing it can do something.
 */

const STATES: Array<PushState | null> = [
  null, 'unsupported', 'not-configured', 'off', 'blocked', 'on',
];

describe('what a device can be told about alerts', () => {
  it('is on for exactly one state', () => {
    for (const state of STATES) {
      expect(pushLook(state, false).on, `${state}`).toBe(state === 'on');
    }
  });

  it('offers a switch only where pressing it could do something', () => {
    /* No Firebase key, a browser that cannot, an iPhone that is not
       installed, and a browser that has already refused: a switch on any of
       those is a switch that does nothing and says it did. */
    expect(pushLook('off', false).canToggle).toBe(true);
    expect(pushLook('on', false).canToggle).toBe(true);
    expect(pushLook('not-configured', false).canToggle).toBe(false);
    expect(pushLook('unsupported', false).canToggle).toBe(false);
    expect(pushLook('blocked', false).canToggle).toBe(false);
    expect(pushLook(null, false).canToggle).toBe(false);
    expect(pushLook('off', true).canToggle).toBe(false);
  });

  it('tells an iPhone to install first rather than that it is impossible', () => {
    /* An iPhone Safari tab reports itself unable, and the cure is the Share
       button, not a switch buried in iOS settings. Saying "not possible in
       this browser" there sends an agent looking for something that does not
       exist. */
    expect(pushLook('unsupported', true).label).toBe('Add to your home screen first');
    expect(pushLook('unsupported', false).label).toBe('Not possible in this browser');
    expect(pushLook('off', true).label).toBe('Add to your home screen first');
  });

  it('gives each state its own words and a tone that matches', () => {
    expect(pushLook('on', false)).toMatchObject({ label: 'On for this device', tone: 'ok' });
    expect(pushLook('off', false)).toMatchObject({ tone: 'warn' });
    expect(pushLook('off', false).label).toContain('you will miss new leads');
    expect(pushLook('blocked', false)).toMatchObject({
      label: 'Blocked in your phone settings', tone: 'warn',
    });
    expect(pushLook('not-configured', false)).toMatchObject({ label: 'Not set up yet', tone: 'plain' });
    expect(pushLook(null, false).label).toBe('Checking…');

    /* No state is drawn in the colour of something that is working unless it
       is the one state that is. */
    for (const state of STATES.filter((one) => one !== 'on')) {
      expect(pushLook(state, false).tone, `${state}`).not.toBe('ok');
    }
  });

  it('never claims a device was registered when it was not', () => {
    for (const state of STATES.filter((one) => one !== null && one !== 'on') as PushState[]) {
      const said = pushSaid(state, false);
      expect(said.toLowerCase(), state).not.toContain('are on');
    }
    expect(pushSaid('on', false)).toBe('Notifications are on for this device.');
  });

  it('says what turning it off did, and what it did not do', () => {
    const said = pushSaid('off', true);
    expect(said).toContain('This device will not get alerts');
    /* The thing an agent fears when they press it: that they have just
       switched off their phone as well. */
    expect(said).toContain('Your other devices still will');
  });

  it('separates a refusal from a missing key', () => {
    expect(pushSaid('blocked', false)).toContain('its own settings');
    expect(pushSaid('not-configured', false)).toContain('no Firebase key');
    expect(pushSaid('off', false)).toContain('nothing was registered');
  });
});
