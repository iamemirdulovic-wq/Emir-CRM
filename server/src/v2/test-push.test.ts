import { describe, expect, it } from 'vitest';
import { sayFor } from './test-push.js';
import type { PushOutcome } from '../messaging/push.js';

/**
 * The sentences the owner reads after pressing "Send a test".
 *
 * No database needed, and that is the point: these run on every suite, with
 * or without MySQL, because the thing that failed on 15 Nov was not a query.
 * It was a button that said **"it works"** having sent nothing at all, to any
 * device, ever. The owner read it, believed it, and spent an hour looking for
 * a Firebase problem that was not there.
 *
 * So the rule under test is narrow and absolute: that phrase belongs to
 * exactly one outcome.
 */

const OUTCOMES: PushOutcome[] = [
  'sent', 'no-credentials', 'no-device', 'token-rejected', 'failed', 'test-copy',
];

describe('what a person is told after pressing "Send a test"', () => {
  it('says "it works" only when a device actually got it', () => {
    for (const outcome of OUTCOMES) {
      const { say } = sayFor({
        outcome,
        delivered: outcome === 'sent' ? 1 : 0,
        removed: outcome === 'token-rejected' ? 1 : 0,
      });
      if (outcome === 'sent') expect(say).toContain('It works');
      else expect(say.toLowerCase(), `${outcome} must not claim success`).not.toContain('it works');
    }
  });

  it('says plainly that nothing was sent, whenever nothing was', () => {
    for (const outcome of OUTCOMES.filter((one) => one !== 'sent')) {
      const { say } = sayFor({ outcome, delivered: 0, removed: outcome === 'token-rejected' ? 1 : 0 });
      expect(say, outcome).toContain('Nothing was sent');
    }
  });

  it('gives each failure its own answer, not one shared shrug', () => {
    const said = OUTCOMES.map((outcome) => sayFor({
      outcome,
      delivered: outcome === 'sent' ? 1 : 0,
      removed: outcome === 'token-rejected' ? 1 : 0,
    }).say);
    expect(new Set(said).size, 'two outcomes share a sentence').toBe(OUTCOMES.length);
  });

  /*
   * The one that would have saved the hour. "No phone is registered" is only
   * useful if it says where the registering happens — and that is the card on
   * My Day, not the settings screen the person is already standing on.
   */
  it('sends somebody with no device to the place that registers one', () => {
    const { say, to } = sayFor({ outcome: 'no-device', delivered: 0, removed: 0 });
    expect(to).toBe('/v2/home');
    expect(say).toContain('My Day');
    expect(say).toContain('Turn on notifications');
  });

  it('sends a dead device back to the same place, having removed it', () => {
    const one = sayFor({ outcome: 'token-rejected', delivered: 0, removed: 1 });
    expect(one.to).toBe('/v2/home');
    expect(one.say).toContain('removed');
    expect(one.say).toContain('device is gone');

    /* Plural when there were several, because "your registered device is
       gone" reads as a different fact when two were. */
    const many = sayFor({ outcome: 'token-rejected', delivered: 0, removed: 3 });
    expect(many.say).toContain('devices are gone');
  });

  it('counts the devices it reached, singular and plural', () => {
    expect(sayFor({ outcome: 'sent', delivered: 1, removed: 0 }).say).toContain('1 device.');
    expect(sayFor({ outcome: 'sent', delivered: 4, removed: 0 }).say).toContain('4 devices.');
  });

  it('names the hosting panel when the key is what is missing', () => {
    const { say, to } = sayFor({ outcome: 'no-credentials', delivered: 0, removed: 0 });
    /* Not "ask the office": on this screen the person reading it IS the
       office, and the fix is a place rather than a person. */
    expect(say).toContain('hosting panel');
    expect(say).toContain('Firebase');
    expect(to).toBeNull();
  });

  it('does not blame the person\'s device when Firebase is what failed', () => {
    const { say } = sayFor({ outcome: 'failed', delivered: 0, removed: 0 });
    expect(say).toContain('Your device is fine');
  });

  it('never writes a sentence too long to read on a phone', () => {
    for (const outcome of OUTCOMES) {
      const { say } = sayFor({ outcome, delivered: 1, removed: 1 });
      expect(say.length, `${outcome}: ${say}`).toBeLessThan(320);
      /* One line per sentence, so the card can show it. */
      expect(say).not.toContain('\n');
    }
  });
});
