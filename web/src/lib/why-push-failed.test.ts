import { describe, expect, it } from 'vitest';
import { whyPushFailed } from './push-device.js';

/**
 * Turning alerts on can fail six ways and the screen used to name none of them.
 *
 * On 15 Nov the owner set up Firebase correctly — `/api/users/me/push-config`
 * answered `configured: true`, the service worker was registered, the keys were
 * right — pressed "Turn on", and got **"That did not work."** Neither of us
 * could tell which failure it was, because the error was caught and discarded.
 * He was on a phone, so there was no console to look at either.
 *
 * So every branch gets a sentence naming what to do, and the browser's own
 * short code is kept on the end: a photograph of the card is then enough to
 * diagnose it.
 */
describe('why turning alerts on failed', () => {
  it('names the phone’s own settings when the browser refused permission', () => {
    for (const err of [{ code: 'messaging/permission-blocked' }, { name: 'NotAllowedError' }]) {
      const said = whyPushFailed(err);
      expect(said).toMatch(/phone.s own settings/i);
    }
  });

  it('sends an iPhone to the home screen rather than to its settings', () => {
    /* The cure on iOS is the Share button, not a switch. Telling somebody to
       hunt through iOS settings for a switch that is not there is the failure
       `iosNeedsInstall` exists to prevent, and it has to hold here too. */
    const said = whyPushFailed({ code: 'messaging/unsupported-browser' });
    expect(said).toMatch(/home screen/i);
    expect(said).not.toMatch(/phone.s own settings/i);
  });

  it('tells somebody to reopen the app when the background part failed', () => {
    const said = whyPushFailed({ code: 'messaging/failed-service-worker-registration' });
    expect(said).toMatch(/open it again/i);
  });

  it('names the VAPID value when Google refused the registration', () => {
    /* This is the one that needs Emir rather than the person pressing the
       button, so it says so and names the value worth re-checking. */
    for (const err of [
      { code: 'messaging/token-subscribe-failed' },
      { name: 'AbortError', message: 'Registration failed - push service error' },
    ]) {
      const said = whyPushFailed(err);
      expect(said).toMatch(/FCM_VAPID_KEY/);
      expect(said).toMatch(/Emir/);
    }
  });

  it('still says something useful for an error it has never seen', () => {
    const said = whyPushFailed(new Error('something nobody predicted'));
    expect(said).toMatch(/failed before anything was registered/i);
    expect(said).toMatch(/something nobody predicted/);
  });

  it('never throws, whatever it is handed', () => {
    for (const err of [null, undefined, 0, '', [], {}, new Error('')]) {
      expect(() => whyPushFailed(err)).not.toThrow();
      expect(whyPushFailed(err).length).toBeGreaterThan(10);
    }
  });

  it('always carries the short code, so a screenshot is enough to diagnose', () => {
    expect(whyPushFailed({ code: 'messaging/token-subscribe-failed' }))
      .toMatch(/\(messaging\/token-subscribe-failed\)$/);
    expect(whyPushFailed({})).toMatch(/\(unknown\)$/);
  });

  it('writes no emoji, like every other sentence a person reads', () => {
    const pictograph = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const err of [{ code: 'messaging/permission-blocked' }, {}, new Error('x')]) {
      expect(pictograph.test(whyPushFailed(err))).toBe(false);
    }
  });
});
