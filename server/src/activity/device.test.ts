import { describe, expect, it } from 'vitest';
import { deviceKey, networkOf, parseDevice } from './device.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  curl: 'curl/8.4.0',
};

describe('recognising the machine somebody is signed in on', () => {
  it('knows an iPhone', () => {
    expect(parseDevice(UA.iphone)).toMatchObject({ kind: 'phone', os: 'iPhone', browser: 'Safari' });
  });

  it('knows an Android phone from an Android tablet', () => {
    /* Android without "Mobile" is a tablet, which is Google's own rule. */
    expect(parseDevice(UA.androidPhone).kind).toBe('phone');
    expect(parseDevice(UA.androidTablet).kind).toBe('tablet');
  });

  it('knows an iPad', () => {
    expect(parseDevice(UA.ipad).kind).toBe('tablet');
  });

  it('knows a Mac', () => {
    expect(parseDevice(UA.mac)).toMatchObject({ kind: 'desktop', os: 'Mac', browser: 'Chrome' });
  });

  it('does not read "Windows NT" as a phone', () => {
    expect(parseDevice(UA.windowsEdge).kind).toBe('desktop');
  });

  it('calls Edge Edge, not Chrome, although it claims to be both', () => {
    expect(parseDevice(UA.windowsEdge).browser).toBe('Edge');
  });

  it('calls Chrome Chrome, although it claims to be Safari', () => {
    expect(parseDevice(UA.mac).browser).toBe('Chrome');
  });

  it('knows Firefox', () => {
    expect(parseDevice(UA.firefox).browser).toBe('Firefox');
  });

  it('spots something that is not a person', () => {
    expect(parseDevice(UA.curl).kind).toBe('bot');
    expect(parseDevice('Mozilla/5.0 HeadlessChrome/125').kind).toBe('bot');
  });

  it('says so plainly when it has no idea', () => {
    expect(parseDevice(null)).toMatchObject({ kind: 'unknown', label: 'Unknown device' });
    expect(parseDevice('')).toMatchObject({ kind: 'unknown' });
    expect(parseDevice('   ')).toMatchObject({ kind: 'unknown' });
  });

  it('gives a label a person can read in a table', () => {
    expect(parseDevice(UA.iphone).label).toBe('iPhone · Safari');
    expect(parseDevice(UA.windowsEdge).label).toBe('Windows · Edge');
  });
});

describe('telling the same device from a new one', () => {
  it('matches the same phone again', () => {
    expect(deviceKey(UA.iphone)).toBe(deviceKey(UA.iphone));
  });

  it('ignores a browser version bump, which happens every few weeks', () => {
    /* A flag that fires on every Chrome update is a flag nobody reads. */
    const may = UA.mac;
    const june = UA.mac.replace('125.0.0.0', '126.0.0.0');
    expect(deviceKey(may)).toBe(deviceKey(june));
  });

  it('separates a phone from a laptop', () => {
    expect(deviceKey(UA.iphone)).not.toBe(deviceKey(UA.mac));
  });

  it('separates two browsers on the same machine', () => {
    expect(deviceKey(UA.windowsEdge)).not.toBe(deviceKey(UA.firefox));
  });
});

describe('the network an address belongs to', () => {
  it('keeps the first three groups of an IPv4', () => {
    expect(networkOf('94.200.12.45')).toBe('94.200.12');
    expect(networkOf('94.200.12.99')).toBe('94.200.12');
  });

  it('separates two different networks', () => {
    expect(networkOf('94.200.12.45')).not.toBe(networkOf('94.201.12.45'));
  });

  it('unwraps an IPv4 written as IPv6', () => {
    expect(networkOf('::ffff:94.200.12.45')).toBe('94.200.12');
  });

  it('handles IPv6', () => {
    expect(networkOf('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:0db8:85a3:0000');
  });

  it('says nothing for nothing', () => {
    expect(networkOf(null)).toBeNull();
    expect(networkOf('')).toBeNull();
    expect(networkOf('   ')).toBeNull();
    expect(networkOf('not-an-ip')).toBeNull();
  });
});
