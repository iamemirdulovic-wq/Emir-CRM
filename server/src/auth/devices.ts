/**
 * A user-agent string, as a person would name the thing in front of them.
 *
 * `design/web/profile.html` lists signed-in devices as "Chrome on Windows",
 * "iPhone 15 · homes.me app", "Safari on MacBook". The only thing the CRM
 * knows about a device is the `user_agent` column `createSession` writes, so
 * this turns that into the shortest true sentence it can and nothing more.
 *
 * Deliberately crude. A UA parser that tries to name "iPhone 15" from a
 * string that says `iPhone` is a parser that will one day say iPhone 15 to
 * somebody holding an iPhone 12 — and the whole point of this list is that a
 * person can spot a device that is not theirs. Where the string says nothing
 * useful the answer is "Unknown device", which is also the honest answer.
 */

export interface DeviceName {
  /** "Chrome on Windows" */
  label: string;
  /** True for a phone or tablet, so the screen can pick the right icon. */
  handheld: boolean;
}

const BROWSERS: Array<[RegExp, string]> = [
  /* Edge and Opera carry "Chrome" in their own strings, so they go first. */
  [/edg(?:e|a|ios)?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/samsungbrowser/i, 'Samsung Internet'],
  [/firefox|fxios/i, 'Firefox'],
  [/chrome|crios/i, 'Chrome'],
  [/safari/i, 'Safari'],
];

const SYSTEMS: Array<[RegExp, string, boolean]> = [
  [/iphone/i, 'iPhone', true],
  [/ipad/i, 'iPad', true],
  [/android/i, 'Android', true],
  [/windows/i, 'Windows', false],
  [/macintosh|mac os x/i, 'Mac', false],
  [/cros/i, 'Chromebook', false],
  [/linux/i, 'Linux', false],
];

export function deviceName(userAgent: string | null | undefined): DeviceName {
  const ua = (userAgent ?? '').trim();
  if (!ua) return { label: 'Unknown device', handheld: false };

  const system = SYSTEMS.find(([pattern]) => pattern.test(ua));
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua));

  if (!system && !browser) return { label: 'Unknown device', handheld: false };
  if (!system) return { label: browser?.[1] ?? 'Unknown device', handheld: false };
  if (!browser) return { label: system[1], handheld: system[2] };

  return { label: `${browser[1]} on ${system[1]}`, handheld: system[2] };
}
