import { describe, expect, it } from 'vitest';
import { BROWSE_ALARM, recordView } from './browsing.js';

/**
 * The alarm that notices someone reading the client database rather than
 * working it.
 *
 * It has to be quiet enough that an agent having a busy morning never trips
 * it, because an owner who gets a false alarm on Tuesday ignores the real one
 * on Friday. Everything below is about where that line sits.
 */

const HOUR = 60 * 60 * 1000;

/** Open `count` different leads, one every few seconds. */
function browse(count: number, from = 0, limit = BROWSE_ALARM) {
  let window;
  let alarms = 0;
  for (let i = 0; i < count; i += 1) {
    const result = recordView(window, `lead-${i}`, from + i * 5_000, limit);
    window = result.window;
    if (result.alarm) alarms += 1;
  }
  return { window, alarms };
}

describe('counting leads opened in an hour', () => {
  it('says nothing about a normal day', () => {
    expect(browse(60).alarms).toBe(0);
  });

  it('raises the alarm at the limit', () => {
    expect(browse(BROWSE_ALARM - 1).alarms).toBe(0);
    expect(browse(BROWSE_ALARM).alarms).toBe(1);
  });

  /*
   * Once per window. An agent told to clean up a list of four hundred would
   * otherwise generate two hundred identical alerts, and the owner would
   * learn to ignore all of them.
   */
  it('raises it once, not once per lead past the line', () => {
    expect(browse(BROWSE_ALARM * 2).alarms).toBe(1);
  });

  /* Opening the same lead ten times is one lead, not ten. */
  it('counts a lead once however often it is opened', () => {
    let window;
    for (let i = 0; i < 500; i += 1) {
      window = recordView(window, 'the-same-lead', i * 1000).window;
    }
    expect(window?.seen.size).toBe(1);
  });

  it('starts again after the hour is up', () => {
    const first = browse(BROWSE_ALARM);
    expect(first.alarms).toBe(1);

    const later = recordView(first.window, 'lead-new', HOUR + 1);
    expect(later.window.seen.size).toBe(1);
    expect(later.alarm).toBe(false);
  });

  it('can alarm again in the next hour, because it is a new hour of this', () => {
    const first = browse(BROWSE_ALARM);
    let window = recordView(first.window, 'lead-0', HOUR + 1).window;
    let alarms = 0;
    for (let i = 1; i < BROWSE_ALARM; i += 1) {
      const result = recordView(window, `lead-${i}`, HOUR + 1 + i * 1000);
      window = result.window;
      if (result.alarm) alarms += 1;
    }
    expect(alarms).toBe(1);
  });

  it('starts cleanly with no window at all', () => {
    const result = recordView(undefined, 'lead-1', Date.now());
    expect(result.window.seen.size).toBe(1);
    expect(result.alarm).toBe(false);
  });

  /* The caller keeps the returned window, so the input must not be mutated —
     otherwise a shared window would be edited by whoever read it last. */
  it('does not change the window it was given', () => {
    const first = recordView(undefined, 'lead-1', 0);
    const before = first.window.seen.size;
    recordView(first.window, 'lead-2', 1000);
    expect(first.window.seen.size).toBe(before);
  });

  it('takes a limit, so the owner could tune it later', () => {
    expect(browse(10, 0, 10).alarms).toBe(1);
    expect(browse(9, 0, 10).alarms).toBe(0);
  });
});
