import path from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CALL_FROM, CALL_UNTIL, DIALLING_CODES, allCountries, asleepNow, awakeNow, codesFor,
  countriesMatching, countryClause, countryOf, countryOfPrefix, flagOf, hourIn, isNight,
  languageName, languagesMatching, prefixSql, timeIn,
} from './countries.js';
import { foldLanguages, foldPrefixes } from './facets.js';

/**
 * The country a lead's number is from.
 *
 * Every rule here is one the browser already obeys and the chips now have to
 * obey as well, because the two sit on the same screen: the flag on a row and
 * the count on the chip above it cannot be worked out two different ways.
 */

/* ── 1. the longest code wins, and an unknown one is not guessed ────────── */

describe('reading a country off a number', () => {
  it('matches the longest dialling code, not the first one', () => {
    expect(countryOf('+971501234567')?.iso2).toBe('AE');
    expect(countryOf('+447700900123')?.iso2).toBe('GB');
    /* +9 is not a code; +97 is not a code; +971 is. */
    expect(countryOf('+97')).toBeNull();
  });

  it('reads a number however it happens to be written', () => {
    for (const written of ['+971 50 123 4567', '971501234567', '+971-50-123-4567']) {
      expect(countryOf(written)?.iso2, written).toBe('AE');
    }
  });

  it('gives no country, and so no flag, for a code it does not know', () => {
    /* +599 (Curaçao) is not in the table. The rule in `dialling.ts`'s own
       header: an unknown code produces no flag rather than a wrong one. */
    expect(countryOf('+5999123456')).toBeNull();
    const facets = foldPrefixes([{ p: '5999', n: 3 }]);
    expect(facets).toHaveLength(1);
    expect(facets[0]!.iso2).toBe('unknown');
    expect(facets[0]!.flag).toBe('');
    expect(facets[0]!.name).toBe('Unknown');
    expect(facets[0]!.count).toBe(3);
  });

  it('gives no country for a lead with no number at all', () => {
    expect(countryOf(null)).toBeNull();
    expect(countryOf('')).toBeNull();
    expect(countryOfPrefix('')).toBeNull();
    expect(foldPrefixes([{ p: '', n: 2 }])[0]!.iso2).toBe('unknown');
  });

  it('makes the flag out of the letters', () => {
    expect(flagOf('AE')).toBe('🇦🇪');
    expect(flagOf('GB')).toBe('🇬🇧');
    /* Never a half-made flag from something that is not a country code. */
    expect(flagOf('unknown')).toBe('');
    expect(flagOf('')).toBe('');
  });

  it('holds no code that is the start of another one', () => {
    /*
     * The invariant the filter relies on. With +1242 (the Bahamas) added
     * beside +1, "every American number" would have to exclude it — which
     * `countryClause` does generate a guard for, but nothing in the table
     * exercises that guard today, so this test is what says so out loud.
     */
    const codes = Object.keys(DIALLING_CODES);
    const overlaps = codes.flatMap(
      (a) => codes.filter((b) => b !== a && b.startsWith(a)).map((b) => `${a} ⊂ ${b}`),
    );
    expect(overlaps).toEqual([]);
  });
});

/* ── 2. the table is the browser's table ───────────────────────────────── */

describe('the dialling table matches the browser’s', () => {
  /*
   * Read off disk rather than imported: `web/` is a different workspace and
   * the server's `rootDir` is `src`, so an import of it would not typecheck.
   * This is the same trick as `schema-map.test.ts` and `config/env-docs.test.ts` —
   * a check that reads the source rather than trusting it.
   */
  const file = path.join(process.cwd(), '..', 'web', 'src', 'lib', 'dialling.ts');
  const source = readFileSync(file, 'utf8');

  const ROW = /^\s*(\d+):\s*\{\s*iso2:\s*'([A-Z]{2})',\s*name:\s*'([^']*)',\s*timeZone:\s*(?:'([^']*)'|null)(?:,\s*zoneLabel:\s*'([^']*)')?\s*\},?\s*$/gm;

  function browserTable(): Record<string, { iso2: string; name: string; timeZone: string | null; zoneLabel?: string }> {
    const out: Record<string, { iso2: string; name: string; timeZone: string | null; zoneLabel?: string }> = {};
    ROW.lastIndex = 0;
    let row = ROW.exec(source);
    while (row) {
      out[row[1]!] = {
        iso2: row[2]!,
        name: row[3]!,
        timeZone: row[4] ?? null,
        ...(row[5] ? { zoneLabel: row[5] } : {}),
      };
      row = ROW.exec(source);
    }
    return out;
  }

  it('reads the browser’s file at all', () => {
    /* A silently-empty parse would make every assertion below pass on
       nothing, which is the one way this check could be worse than none. */
    expect(Object.keys(browserTable()).length).toBeGreaterThan(70);
  });

  it('has the same codes, names, zones and labels', () => {
    expect(DIALLING_CODES).toEqual(browserTable());
  });

  it('calls at the same hours the browser recommends', () => {
    /* `whenToCall()` is what puts "too early there" on a lead page. The moon
       on a chip and the word "asleep" in the search box are the same hours. */
    expect(source).toContain(`export const CALL_FROM = ${CALL_FROM};`);
    expect(source).toContain(`export const CALL_UNTIL = ${CALL_UNTIL};`);
  });
});

/* ── 3. the clock, in the country's own zone ───────────────────────────── */

describe('the moon', () => {
  /* 06:00 in Dubai, which is 02:00 in London and 03:00 in Moscow. */
  const dawnInDubai = new Date('2026-11-14T02:00:00.000Z');

  it('is worked out in the country’s own zone, not Dubai’s', () => {
    expect(hourIn('Asia/Dubai', dawnInDubai)).toBe(6);
    expect(hourIn('Europe/London', dawnInDubai)).toBe(2);
    expect(hourIn('Asia/Kolkata', dawnInDubai)).toBe(7);

    /* All three are outside calling hours at that instant. */
    expect(isNight('Asia/Dubai', dawnInDubai)).toBe(true);
    expect(isNight('Europe/London', dawnInDubai)).toBe(true);

    /* And at 10:00 Dubai it is 06:00 in London — still too early there, but
       a perfectly good hour here. The point of the whole feature. */
    const tenInDubai = new Date('2026-11-14T06:00:00.000Z');
    expect(isNight('Asia/Dubai', tenInDubai)).toBe(false);
    expect(isNight('Europe/London', tenInDubai)).toBe(true);
    expect(isNight('Asia/Tokyo', tenInDubai)).toBe(false);
  });

  it('says 24-hour times', () => {
    expect(timeIn('Asia/Dubai', dawnInDubai)).toBe('06:00');
    expect(timeIn('America/New_York', new Date('2026-11-14T20:30:00.000Z'))).toBe('15:30');
  });

  it('has no opinion where the zone is unknown', () => {
    expect(isNight(null)).toBeNull();
    expect(timeIn(null)).toBeNull();
    expect(hourIn('Mars/Olympus', dawnInDubai)).toBeNull();
    /* And the chip then carries no moon and no clock, rather than a made-up one. */
    const facet = foldPrefixes([{ p: '5999', n: 1 }])[0]!;
    expect(facet.night).toBeNull();
    expect(facet.localTime).toBeNull();
  });

  it('splits every country in the table into asleep or awake', () => {
    const asleep = asleepNow(dawnInDubai);
    const awake = awakeNow(dawnInDubai);
    expect(asleep).toContain('AE');
    expect(asleep).toContain('GB');
    expect(awake).toContain('AU');
    /* No country is in both, and the two together are every zone we can read. */
    expect(asleep.filter((one) => awake.includes(one))).toEqual([]);
    expect(asleep.length + awake.length).toBe(
      allCountries().filter((one) => one.timeZone !== null).length,
    );
  });
});

/* ── 4. the SQL ────────────────────────────────────────────────────────── */

describe('the clauses', () => {
  it('groups on the leading digits of the number, however it is written', () => {
    /* The point of the regex: "+971 50…" and "971-50…" group together. */
    expect(prefixSql('c.phone_e164')).toContain("REGEXP_REPLACE(COALESCE(c.phone_e164, ''), '[^0-9]', '')");
    expect(prefixSql('c.phone_e164')).toContain('SUBSTRING');
  });

  it('narrows to one country by its code, at that code’s own length', () => {
    const clause = countryClause('c.phone_e164', 'AE')!;
    expect(clause.params).toEqual(['971']);
    expect(clause.sql).toContain('SUBSTRING');
    expect(clause.sql).toContain('1, 3');
  });

  it('narrows "unknown" to every code at once, so nothing known slips in', () => {
    const clause = countryClause('c.phone_e164', 'unknown')!;
    expect(clause.params).toEqual(expect.arrayContaining(['971', '44', '1', '91']));
    expect(clause.sql).toContain('NOT IN');
    /* One NOT IN per code length present in the table: 1, 2 and 3 digits. */
    expect(clause.sql.match(/NOT IN/g)).toHaveLength(
      new Set(Object.keys(DIALLING_CODES).map((code) => code.length)).size,
    );
  });

  it('ignores a country nobody could have meant', () => {
    expect(countryClause('c.phone_e164', 'XX')).toBeNull();
    expect(countryClause('c.phone_e164', '')).toBeNull();
  });

  it('lists the codes behind a country, longest first', () => {
    expect(codesFor('AE')).toEqual(['971']);
    expect(codesFor('XX')).toEqual([]);
  });
});

/* ── 5. what the search box takes ──────────────────────────────────────── */

describe('typed words', () => {
  it('finds a country by name, code or dialling code', () => {
    expect(countriesMatching('india')).toEqual(['IN']);
    expect(countriesMatching('UAE')).toEqual(['AE']);
    expect(countriesMatching('ae')).toEqual(['AE']);
    expect(countriesMatching('971')).toEqual(['AE']);
    expect(countriesMatching('+971')).toEqual(['AE']);
    /* "USA / Canada" is one row here, so each half finds it. */
    expect(countriesMatching('canada')).toEqual(['US']);
    expect(countriesMatching('usa')).toEqual(['US']);
    /* And the city a multi-zone clock is named for. */
    expect(countriesMatching('moscow')).toEqual(['RU']);
  });

  it('matches the start of a name, so one word does not drag in five countries', () => {
    /* "in" is inside Argentina, Ukraine and Finland, and must not drag any of
       them in. India and Indonesia both start with it, and both are meant. */
    expect(countriesMatching('in')).toEqual(['ID', 'IN']);
    expect(countriesMatching('indi')).toEqual(['IN']);
    expect(countriesMatching('')).toEqual([]);
    expect(countriesMatching('zzz')).toEqual([]);
  });

  it('finds a language by name or code', () => {
    expect(languagesMatching('arabic')).toEqual(['ar']);
    expect(languagesMatching('ar')).toEqual(['ar']);
    expect(languagesMatching('russ')).toEqual(['ru']);
    expect(languagesMatching('zzz')).toEqual([]);
  });

  it('names a language, and leaves an unknown code as it is stored', () => {
    expect(languageName('ar')).toBe('Arabic');
    expect(languageName('EN')).toBe('English');
    /* No name is invented for a code the CRM does not know. */
    expect(languageName('qq')).toBe('QQ');
  });
});

/* ── 6. folding the buckets ────────────────────────────────────────────── */

describe('one row per country', () => {
  it('adds the buckets of one country together', () => {
    /* Three UAE buckets — different fourth digits — are one chip reading 6. */
    const out = foldPrefixes([{ p: '9715', n: 4 }, { p: '9714', n: 1 }, { p: '9712', n: 1 }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.iso2).toBe('AE');
    expect(out[0]!.count).toBe(6);
  });

  it('puts the biggest first and the unknowns last, whatever their size', () => {
    const out = foldPrefixes([
      { p: '5999', n: 90 }, { p: '9715', n: 4 }, { p: '4477', n: 9 },
    ]);
    expect(out.map((one) => one.iso2)).toEqual(['GB', 'AE', 'unknown']);
  });

  it('gathers a blank language under "Not known" and never calls it English', () => {
    const out = foldLanguages([{ lang: 'en', n: 5 }, { lang: '', n: 2 }, { lang: null, n: 1 }]);
    expect(out.map((one) => [one.code, one.label, one.count])).toEqual([
      ['en', 'English', 5],
      ['unknown', 'Not known', 3],
    ]);
  });
});
