import { describe, expect, it } from 'vitest';
import { clockIn, flagOf, originOf, whenToCall } from './dialling.js';

/**
 * Reading a foreign clock before dialling.
 *
 * This is the card an agent glances at before ringing somebody three time
 * zones away. It was built on 10 Nov after an agent rang Germany at six in
 * the morning, and the thing it must never do is give a time that cannot be
 * acted on.
 */

describe('where a number is from', () => {
  it('reads the country from the dialling code', () => {
    expect(originOf('+971501234567')?.iso2).toBe('AE');
    expect(originOf('+393331234567')?.iso2).toBe('IT');
    expect(originOf('+447911123456')?.iso2).toBe('GB');
  });

  it('says nothing rather than guessing', () => {
    expect(originOf(null)).toBeNull();
    expect(originOf('')).toBeNull();
    expect(originOf('0501234567')).toBeNull();
  });

  it('makes a flag from the country', () => {
    expect(flagOf('AE')).toBe('🇦🇪');
    expect(flagOf('')).toBe('');
  });
});

describe('what time it is there', () => {
  /*
   * 24-hour, everywhere, Emir on 13 Nov. This clock was deliberately
   * twelve-hour (his own instruction of 10 Nov) and it was the only time in
   * the CRM that was, so a lead page showed "3:00 PM" on the client's clock
   * next to a follow-up at 15:30 on ours. One clock beats one saved sum.
   */
  it('is twenty-four hour, like every other time in the CRM', () => {
    const at = new Date('2026-11-12T11:00:00Z'); // 15:00 in Dubai
    expect(clockIn('Asia/Dubai', at)?.time).toBe('15:00');
  });

  it('writes the small hours with a leading zero, not as 24:xx', () => {
    const at = new Date('2026-11-12T20:30:00Z'); // 00:30 in Dubai
    expect(clockIn('Asia/Dubai', at)?.time).toBe('00:30');
  });

  it('never says AM or PM', () => {
    const at = new Date('2026-11-12T11:00:00Z');
    for (const zone of ['Asia/Dubai', 'Europe/London', 'Asia/Kolkata', 'America/New_York']) {
      expect(clockIn(zone, at)?.time).not.toMatch(/[ap]\.?m/i);
    }
  });

  it('says how far from Dubai they are', () => {
    const at = new Date('2026-11-12T11:00:00Z');
    expect(clockIn('Asia/Dubai', at)?.offset).toMatch(/same time/i);
    expect(clockIn('Europe/Rome', at)?.offset).toMatch(/behind/i);
  });
});

describe('whether now is a decent hour', () => {
  it('says yes inside working hours', () => {
    const at = new Date('2026-11-12T07:00:00Z'); // 11:00 Dubai
    const advice = whenToCall(clockIn('Asia/Dubai', at), 'Asia/Dubai');
    expect(advice?.ok).toBe(true);
  });

  /*
   * The bug this test exists for: the next-good-hour search stepped forward
   * in whole hours from right now, so at 9:41 PM it reported "call after
   * 9:41 AM" -- a time that means nothing. Seen on the v2 lead page on
   * 12 Nov, and live on crm.homes.me before that.
   */
  it('names a time on the hour, not whatever minute it is now', () => {
    const at = new Date('2026-11-12T17:41:00Z'); // 21:41 Dubai, too late
    const advice = whenToCall(clockIn('Asia/Dubai', at), 'Asia/Dubai');

    expect(advice?.ok).toBe(false);
    expect(advice?.line).toContain('09:00');
    expect(advice?.line, 'never the current minute').not.toContain(':41');
    expect(advice?.line, '24-hour, like the rest of the CRM').not.toMatch(/[ap]\.?m/i);
  });

  it('keeps half-hour zones honest', () => {
    /* 09:00 in Mumbai is 07:30 in Dubai. Rounding in the wrong clock would
       say 07:00, and an agent would ring half an hour early. */
    const at = new Date('2026-11-12T17:41:00Z');
    const advice = whenToCall(clockIn('Asia/Kolkata', at), 'Asia/Kolkata');
    expect(advice?.ok).toBe(false);
    expect(advice?.line).toContain(':30');
  });

  it('tells an agent it is too early, not just too late', () => {
    const at = new Date('2026-11-12T02:30:00Z'); // 06:30 Dubai
    const advice = whenToCall(clockIn('Asia/Dubai', at), 'Asia/Dubai');
    expect(advice?.line).toMatch(/too early/i);
  });
});

/**
 * Emir, 14 Nov 2026: "+1 numbers: 'USA / Canada' is one group. Use the
 * 3-digit area code after +1 to find the country (USA, Canada, Caribbean) and
 * the state or province, and set the lead's time zone from it. Do the same for
 * +7 and other countries with several time zones."
 *
 * Before this, every +1 number was American and on New York's clock, so a Los
 * Angeles lead was shown a time three hours out, a Toronto lead flew the wrong
 * flag, and a Kazakh number was called Russian. These are the cases that were
 * wrong on screen.
 */
describe('dialling codes that cover more than one country', () => {
  it('tells the three +1 countries apart by their area code', () => {
    expect(originOf('+12125551234')?.iso2, 'Manhattan').toBe('US');
    expect(originOf('+14165551234')?.iso2, 'Toronto').toBe('CA');
    expect(originOf('+16045551234')?.iso2, 'Vancouver').toBe('CA');
    expect(originOf('+18765551234')?.iso2, 'Jamaica').toBe('JM');
    expect(originOf('+12425551234')?.iso2, 'Nassau').toBe('BS');
    expect(originOf('+18685551234')?.iso2, 'Port of Spain').toBe('TT');
    expect(originOf('+17875551234')?.iso2, 'San Juan').toBe('PR');
  });

  it('names the state or the province', () => {
    expect(originOf('+13105551234')?.zoneLabel).toBe('California');
    expect(originOf('+12125551234')?.zoneLabel).toBe('New York');
    expect(originOf('+14165551234')?.zoneLabel).toBe('Ontario');
    expect(originOf('+13065551234')?.zoneLabel).toBe('Saskatchewan');
    expect(originOf('+14165551234')?.name).toBe('Canada');
  });

  it('gives a Los Angeles lead Los Angeles time, not New York time', () => {
    const at = new Date('2026-11-14T12:00:00Z');
    expect(clockIn(originOf('+12125551234')!.timeZone, at)?.time).toBe('07:00');
    expect(clockIn(originOf('+13105551234')!.timeZone, at)?.time).toBe('04:00');
    expect(clockIn(originOf('+18085551234')!.timeZone, at)?.time, 'Honolulu').toBe('02:00');
    /* Newfoundland is on the half hour, which is the kind of thing that gets
       rounded away by hand and never by a table. */
    expect(clockIn(originOf('+17095551234')!.timeZone, at)?.time).toBe('08:30');
  });

  it('keeps the states that straddle two zones honest', () => {
    const at = new Date('2026-11-14T12:00:00Z');
    /* El Paso keeps Mountain time while Dallas is on Central. */
    expect(clockIn(originOf('+19155551234')!.timeZone, at)?.time, 'El Paso').toBe('05:00');
    expect(clockIn(originOf('+12145551234')!.timeZone, at)?.time, 'Dallas').toBe('06:00');
    /* Knoxville is an hour ahead of Nashville, in the same state. */
    expect(clockIn(originOf('+14235551234')!.timeZone, at)?.time, 'Knoxville').toBe('07:00');
    expect(clockIn(originOf('+16155551234')!.timeZone, at)?.time, 'Nashville').toBe('06:00');
  });

  it('shows no clock at all for a toll-free number, which is nowhere', () => {
    const origin = originOf('+18005551234');
    expect(origin?.name).toBe('USA / Canada');
    expect(origin?.timeZone, 'a 1-800 number has no local time').toBeNull();
    expect(clockIn(origin!.timeZone)).toBeNull();
  });

  it('falls back to the old answer for an area code nobody has added yet', () => {
    /* 999 is unassigned. The honest answer is the one this screen gave before
       the table existed: the country pair, labelled with the clock's city. */
    const origin = originOf('+19995551234');
    expect(origin?.name).toBe('USA / Canada');
    expect(origin?.zoneLabel).toBe('New York');
  });

  it('tells Kazakhstan from Russia, which share +7', () => {
    expect(originOf('+77017001122')?.iso2, 'Kazakh mobile').toBe('KZ');
    expect(originOf('+77273001122')?.iso2, 'Almaty').toBe('KZ');
    expect(originOf('+76012345678')?.iso2, 'a 6xx Kazakh code').toBe('KZ');
    expect(originOf('+79161234567')?.iso2, 'Russian mobile').toBe('RU');
    expect(originOf('+74951234567')?.iso2, 'Moscow').toBe('RU');
  });

  it('puts a Vladivostok number seven hours away from a Moscow one', () => {
    const at = new Date('2026-11-14T12:00:00Z');
    expect(clockIn(originOf('+74951234567')!.timeZone, at)?.time, 'Moscow').toBe('15:00');
    expect(clockIn(originOf('+74232345678')!.timeZone, at)?.time, 'Vladivostok').toBe('22:00');
    expect(clockIn(originOf('+74012345678')!.timeZone, at)?.time, 'Kaliningrad').toBe('14:00');
    expect(clockIn(originOf('+73432345678')!.timeZone, at)?.time, 'Yekaterinburg').toBe('17:00');
  });

  it('keeps the Moscow warning on a Russian mobile, which is not a place', () => {
    /*
     * A Russian mobile number keeps its code when its owner moves across the
     * country, so 9xx says nothing about where they are. Moscow is the best
     * guess for Dubai lead data and the label is what makes it a guess rather
     * than a claim.
     */
    expect(originOf('+79161234567')?.zoneLabel).toBe('Moscow');
    /* The country is still settled, though: 9xx is Russia, never Kazakhstan. */
    expect(originOf('+79161234567')?.name).toBe('Russia');
    expect(originOf('+77017001122')?.name).toBe('Kazakhstan');
  });

  it('splits the three Australian clocks that share 08', () => {
    const at = new Date('2026-11-14T12:00:00Z');
    expect(clockIn(originOf('+61892012345')!.timeZone, at)?.time, 'Perth').toBe('20:00');
    expect(clockIn(originOf('+61882012345')!.timeZone, at)?.time, 'Adelaide').toBe('22:30');
    expect(clockIn(originOf('+61889412345')!.timeZone, at)?.time, 'Darwin').toBe('21:30');
    expect(clockIn(originOf('+61292345678')!.timeZone, at)?.time, 'Sydney').toBe('23:00');
    expect(originOf('+61889412345')?.zoneLabel).toBe('Northern Territory');
    /* A mobile is 04xx and belongs to no state, so it keeps the fallback. */
    expect(originOf('+61412345678')?.zoneLabel).toBe('Sydney');
  });

  it('reads the Brazilian and Mexican codes that are not on the capital clock', () => {
    const at = new Date('2026-11-14T12:00:00Z');
    expect(clockIn(originOf('+5511987654321')!.timeZone, at)?.time, 'São Paulo').toBe('09:00');
    expect(clockIn(originOf('+5592987654321')!.timeZone, at)?.time, 'Manaus').toBe('08:00');
    expect(originOf('+526641234567')?.zoneLabel, 'Tijuana').toBe('Baja California');
    /* Mobiles written the pre-2019 way, +52 1 NPA, are all over old imports. */
    expect(originOf('+5216641234567')?.zoneLabel, 'Tijuana, old spelling').toBe('Baja California');
  });

  it('leaves every single-zone country exactly as it was', () => {
    expect(originOf('+447911123456')?.iso2).toBe('GB');
    expect(originOf('+971501234567')?.iso2).toBe('AE');
    expect(originOf('+998901234567')?.iso2, '+998 must not be read as +99').toBe('UZ');
    expect(originOf('+393331234567')?.iso2).toBe('IT');
    expect(originOf('+911234567890')?.iso2).toBe('IN');
    expect(originOf('+4203331234567')?.iso2, 'Czechia, not a +1 area code').toBe('CZ');
  });
});

/**
 * Every IANA zone named in this file has to be one the browser knows.
 *
 * `clockIn` swallows an unknown zone and returns null, which is the right
 * behaviour at runtime and means a single mistyped zone name would quietly
 * remove the clock for a whole state and never fail a test. There are over a
 * hundred of them now, so they are checked by reading the file rather than by
 * trusting it.
 */
describe('the time zones this file names', () => {
  it('are all zones the browser can format', async () => {
    const { readFile } = await import('node:fs/promises');
    /* `import.meta.url` is an http URL under vitest's browser-like
       environment, so the file is found from the test's own path instead. */
    const here = expect.getState().testPath;
    expect(here, 'vitest did not say where this test lives').toBeTruthy();
    const source = await readFile(String(here).replace(/\.test\.ts$/, '.ts'), 'utf8');
    const zones = [...new Set(
      [...source.matchAll(/'((?:Africa|America|Asia|Atlantic|Australia|Europe|Pacific)\/[A-Za-z_/]+)'/g)]
        .map((hit) => hit[1] as string),
    )];
    /* A floor, so a regex that stopped matching cannot pass by finding none. */
    expect(zones.length).toBeGreaterThan(100);
    const broken = zones.filter((zone) => {
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit' }).format(new Date());
        return false;
      } catch {
        return true;
      }
    });
    expect(broken, `unknown IANA zones: ${broken.join(', ')}`).toEqual([]);
  });
});
