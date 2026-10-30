import { describe, expect, it } from 'vitest';
import { isPrivateAddress, lookupLocation, resetGeoipForTesting } from './geoip.js';

describe('addresses that mean "inside this building"', () => {
  it('knows the private ranges', () => {
    expect(isPrivateAddress('192.168.1.4')).toBe(true);
    expect(isPrivateAddress('10.0.0.8')).toBe(true);
    expect(isPrivateAddress('172.16.4.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.254')).toBe(true);
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('169.254.1.1')).toBe(true);
  });

  it('does not mistake a neighbouring public range for a private one', () => {
    /* 172.15 and 172.32 are public; only 172.16–172.31 are not. */
    expect(isPrivateAddress('172.15.0.1')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('11.0.0.1')).toBe(false);
    expect(isPrivateAddress('193.168.1.4')).toBe(false);
  });

  it('knows a real public address when it sees one', () => {
    expect(isPrivateAddress('94.200.12.45')).toBe(false);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });

  it('handles IPv6 loopback and local ranges', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('unwraps an IPv4 written as IPv6', () => {
    expect(isPrivateAddress('::ffff:192.168.1.4')).toBe(true);
    expect(isPrivateAddress('::ffff:94.200.12.45')).toBe(false);
  });

  it('treats nothing as inside, rather than looking it up', () => {
    expect(isPrivateAddress('')).toBe(true);
    expect(isPrivateAddress('   ')).toBe(true);
  });
});

describe('looking a sign-in up', () => {
  it('answers nothing, rather than failing, with no database configured', async () => {
    resetGeoipForTesting();
    delete process.env.MAXMIND_DB_PATH;
    expect(await lookupLocation('94.200.12.45')).toEqual({ city: null, country: null });
  });

  it('does not bother looking up an office address', async () => {
    expect(await lookupLocation('192.168.1.4')).toEqual({ city: null, country: null });
  });

  it('copes with no address at all', async () => {
    expect(await lookupLocation(null)).toEqual({ city: null, country: null });
    expect(await lookupLocation(undefined)).toEqual({ city: null, country: null });
  });

  it('carries on when the configured database is not there', async () => {
    resetGeoipForTesting();
    process.env.MAXMIND_DB_PATH = '/nowhere/GeoLite2-City.mmdb';
    expect(await lookupLocation('94.200.12.45')).toEqual({ city: null, country: null });
    delete process.env.MAXMIND_DB_PATH;
    resetGeoipForTesting();
  });
});
