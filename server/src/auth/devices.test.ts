import { describe, expect, it } from 'vitest';
import { deviceName } from './devices.js';

describe('deviceName', () => {
  it('names a desktop browser and its system', () => {
    expect(deviceName(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
      + ' Chrome/131.0.0.0 Safari/537.36',
    )).toEqual({ label: 'Chrome on Windows', handheld: false });
  });

  it('reads Edge before Chrome, which Edge also claims to be', () => {
    expect(deviceName(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
      + ' Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    ).label).toBe('Edge on Windows');
  });

  it('marks a phone as handheld so the row gets the phone icon', () => {
    const got = deviceName(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15'
      + ' (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    );
    expect(got).toEqual({ label: 'Safari on iPhone', handheld: true });
  });

  it('says it does not know rather than guessing', () => {
    expect(deviceName(null).label).toBe('Unknown device');
    expect(deviceName('').label).toBe('Unknown device');
    expect(deviceName('curl/8.4.0').label).toBe('Unknown device');
  });
});
