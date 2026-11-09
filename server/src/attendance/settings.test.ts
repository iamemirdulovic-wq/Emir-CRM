import { describe, expect, it } from 'vitest';
import { isOfficeIp, normaliseIp } from './settings.js';

/**
 * The address check is the whole feature. If it is too loose, anybody can
 * check in from a beach; if it is too tight, nobody can check in at all and
 * the office spends a morning on the phone.
 */
describe('reading an address', () => {
  it('takes a plain IPv4 address', () => {
    expect(normaliseIp('203.0.113.10')).toBe('203.0.113.10');
    expect(normaliseIp('  203.0.113.10 ')).toBe('203.0.113.10');
  });

  /*
   * This is the one that would have broken it silently. A Node server
   * listening on IPv6 sees an IPv4 client as ::ffff:203.0.113.10, which is
   * the same machine; comparing the two as strings never matches, and the
   * office would have had a button that refused everybody with no clue why.
   */
  it('treats an IPv4-mapped IPv6 address as the same machine', () => {
    expect(normaliseIp('::ffff:203.0.113.10')).toBe('203.0.113.10');
    expect(isOfficeIp('::ffff:203.0.113.10', ['203.0.113.10'])).toBe(true);
  });

  it('drops a port that came along for the ride', () => {
    expect(normaliseIp('203.0.113.10:51234')).toBe('203.0.113.10');
  });

  it('keeps an IPv6 address, lower-cased', () => {
    expect(normaliseIp('2001:DB8::1')).toBe('2001:db8::1');
  });

  it('refuses what is not an address', () => {
    for (const bad of ['', '   ', 'office', '999.1.1.1', '203.0.113', null, undefined]) {
      expect(normaliseIp(bad)).toBeNull();
    }
  });
});

describe('deciding whether somebody is in the office', () => {
  const office = ['203.0.113.10', '203.0.113.11'];

  it('lets the office in', () => {
    expect(isOfficeIp('203.0.113.10', office)).toBe(true);
    expect(isOfficeIp('203.0.113.11', office)).toBe(true);
  });

  it('keeps everybody else out', () => {
    expect(isOfficeIp('5.195.1.1', office)).toBe(false);
    /* One digit out is a different building, not a rounding error. */
    expect(isOfficeIp('203.0.113.12', office)).toBe(false);
  });

  it('is not fooled by a near miss written oddly', () => {
    expect(isOfficeIp('203.0.113.010', office)).toBe(true);
    expect(isOfficeIp(' 203.0.113.10 ', office)).toBe(true);
  });

  /* No address saved means attendance is not set up. It must refuse, not
     wave everybody through on an empty list. */
  it('refuses when no office address is saved', () => {
    expect(isOfficeIp('203.0.113.10', [])).toBe(false);
  });

  it('refuses a missing address', () => {
    expect(isOfficeIp(null, office)).toBe(false);
    expect(isOfficeIp(undefined, office)).toBe(false);
    expect(isOfficeIp('', office)).toBe(false);
  });
});
