/**
 * Working out what somebody is signed in on.
 *
 * Deliberately crude. A full user-agent library is a dependency that needs
 * updating every time a browser ships, and what this is for does not need
 * that precision: an owner looking at Team Activity wants to recognise a row
 * — "Sara, iPhone, Dubai" — and to notice the one that does not belong.
 *
 * So it answers three questions and no more: roughly what kind of machine,
 * roughly which browser, and whether the two together look like the same
 * device as last time.
 */

export interface Device {
  kind: 'phone' | 'tablet' | 'desktop' | 'bot' | 'unknown';
  os: string | null;
  browser: string | null;
  /** What a person reads in a table: "iPhone · Safari". */
  label: string;
}

const BOTS = /bot|crawler|spider|curl|wget|python-requests|postman|headless/i;

function osOf(ua: string): string | null {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  /* Windows NT before Windows, so "Windows NT 10.0" is not read as a phone. */
  if (/Windows NT/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'Mac';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return null;
}

function browserOf(ua: string): string | null {
  /*
   * Order matters and is the whole trick. Every Chromium browser claims to be
   * Chrome and Safari; Chrome claims to be Safari. So the specific names are
   * tested first and the generic ones last.
   */
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/FxiOS|Firefox/i.test(ua)) return 'Firefox';
  if (/CriOS/i.test(ua)) return 'Chrome';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return null;
}

export function parseDevice(userAgent: string | null | undefined): Device {
  const ua = (userAgent ?? '').trim();
  if (!ua) return { kind: 'unknown', os: null, browser: null, label: 'Unknown device' };

  if (BOTS.test(ua)) return { kind: 'bot', os: null, browser: null, label: 'Automated client' };

  const os = osOf(ua);
  const browser = browserOf(ua);

  const kind: Device['kind'] = (() => {
    if (/iPad|Tablet/i.test(ua)) return 'tablet';
    /* Android without "Mobile" is a tablet — that is Google's own rule. */
    if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
    if (/iPhone|iPod|Android|Mobile|Windows Phone/i.test(ua)) return 'phone';
    if (os) return 'desktop';
    return 'unknown';
  })();

  const label = [os ?? (kind === 'unknown' ? 'Unknown device' : kind), browser]
    .filter(Boolean)
    .join(' · ');

  return { kind, os, browser, label: label || 'Unknown device' };
}

/**
 * A stable-enough fingerprint to tell "the same phone again" from "a new one".
 *
 * Browser version is left out on purpose: Chrome updates every few weeks, and
 * a flag that fires on every update is a flag everybody learns to ignore.
 */
export function deviceKey(userAgent: string | null | undefined): string {
  const device = parseDevice(userAgent);
  return `${device.kind}:${device.os ?? '?'}:${device.browser ?? '?'}`;
}

/** The first three groups of an IPv4, or the first four of an IPv6. */
export function networkOf(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const clean = ip.trim().replace(/^::ffff:/i, '');
  if (!clean) return null;
  if (clean.includes(':')) return clean.split(':').slice(0, 4).join(':');
  const parts = clean.split('.');
  return parts.length === 4 ? parts.slice(0, 3).join('.') : null;
}
