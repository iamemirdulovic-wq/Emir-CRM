import { query } from '../db/client.js';
import {
  countryOfPrefix, flagOf, hourIn, isNight, languageName, prefixSql, timeIn, type Country,
} from './countries.js';

/**
 * The country and language chips above the leads list, with real numbers.
 *
 * Emir, 14 November 2026, over a screenshot of chips reading
 * `All 26 · UAE 24 · USA/Canada 1 🌙 · India 1`: *"we need to add also this
 * option, like country based leads, language based leads, add also with flag,
 * so our agents can see easily which country they can filter the leads
 * easily"*.
 *
 * Every number here is one `GROUP BY` over the whole filtered list, in the
 * same shape as the `givenDays` counts beside the day headings — never the
 * fifty rows that happen to be on the page. That is the whole reason this is
 * on the server at all: the browser's own `dialling.ts` can read a flag off a
 * number but has only ever seen one page of them, so a chip saying "UAE 24"
 * over a book of 2,041 would have been invented.
 *
 * The grouping is on the leading digits of the number — a few hundred
 * distinct buckets at most, whatever the size of the book — and the buckets
 * are folded into countries here, by the same longest-prefix match the
 * browser draws the flag with. Nothing is stored, so nothing can go stale.
 */

export interface CountryFacet {
  /** ISO 3166-1 alpha-2, or `'unknown'` for a dialling code the table does not hold. */
  iso2: string;
  name: string;
  /** 🇦🇪. Empty for the unknown bucket, which must never carry a flag. */
  flag: string;
  count: number;
  timeZone: string | null;
  /** Set where the country spans zones — "Moscow", "New York". */
  zoneLabel: string | null;
  /** "03:12" there, or null when the zone is not one we can read. */
  localTime: string | null;
  /** The same as 0–23, so the chip can say "too early" rather than only "night". */
  localHour: number | null;
  /**
   * True when it is outside calling hours there right now, which is what puts
   * the moon on the chip. Null when the zone is unknown: no moon rather than
   * a guessed one.
   */
  night: boolean | null;
}

export interface LanguageFacet {
  /** The code as stored, lower-cased, or `'unknown'` for a blank. */
  code: string;
  label: string;
  count: number;
}

export interface LeadFacets {
  countries: CountryFacet[];
  languages: LanguageFacet[];
  /** The "All" chip over the countries: every lead the other filters allow. */
  countryTotal: number;
  /** And over the languages, which is a different number when a country is picked. */
  languageTotal: number;
  /**
   * Said in the UI rather than left for somebody to work out: `contacts.language`
   * is `NOT NULL DEFAULT 'en'`, so "English" also holds every lead nobody
   * ever asked.
   */
  languageDefault: string;
}

const FROM = `FROM opportunities o
         JOIN contacts c ON c.id = o.contact_id AND c.deleted_at IS NULL`;

/**
 * Count both facets.
 *
 * The two clauses are deliberately different. A country chip's number is the
 * list as it would be *without* the country chip, and the same for language —
 * otherwise picking UAE makes every other country read 0 and there is no way
 * back out except Clear all. The reference picture reads
 * `All 26 · UAE 24 · USA/Canada 1 · India 1`, and 24 + 1 + 1 = 26, which is
 * the same arithmetic.
 */
export async function leadFacets(
  forCountries: { where: string[]; args: Array<string | number> },
  forLanguages: { where: string[]; args: Array<string | number> },
  now: Date = new Date(),
): Promise<LeadFacets> {
  const [prefixes, languages] = await Promise.all([
    query<{ p: string | null; n: number }>(
      `SELECT ${prefixSql('c.phone_e164')} AS p, COUNT(*) AS n
         ${FROM}
        WHERE ${forCountries.where.join(' AND ')}
        GROUP BY p`,
      forCountries.args,
    ),
    query<{ lang: string | null; n: number }>(
      `SELECT LOWER(TRIM(COALESCE(c.language, ''))) AS lang, COUNT(*) AS n
         ${FROM}
        WHERE ${forLanguages.where.join(' AND ')}
        GROUP BY lang`,
      forLanguages.args,
    ),
  ]);

  return {
    countries: foldPrefixes(prefixes, now),
    languages: foldLanguages(languages),
    countryTotal: prefixes.reduce((sum, row) => sum + Number(row.n), 0),
    languageTotal: languages.reduce((sum, row) => sum + Number(row.n), 0),
    languageDefault: 'en',
  };
}

/**
 * Prefix buckets → one row per country, biggest first.
 *
 * A bucket no dialling code matches lands in `unknown`, with no flag. That is
 * `dialling.ts`'s own rule, written down in its header: *"An unknown code is
 * not guessed: the strip simply does not appear, which is the honest answer
 * and never a wrong flag."* A lead with no phone number at all lands there
 * too, because there is nothing to read a country out of.
 */
export function foldPrefixes(
  rows: Array<{ p: string | null; n: number }>,
  now: Date = new Date(),
): CountryFacet[] {
  const totals = new Map<string, { country: Country | null; count: number }>();
  for (const row of rows) {
    const country = countryOfPrefix(row.p);
    const key = country?.iso2 ?? 'unknown';
    const seen = totals.get(key);
    if (seen) seen.count += Number(row.n);
    else totals.set(key, { country, count: Number(row.n) });
  }

  const out: CountryFacet[] = [];
  for (const [iso2, { country, count }] of totals) {
    if (count === 0) continue;
    out.push({
      iso2,
      name: country?.name ?? 'Unknown',
      flag: country ? flagOf(country.iso2) : '',
      count,
      timeZone: country?.timeZone ?? null,
      zoneLabel: country?.zoneLabel ?? null,
      localTime: timeIn(country?.timeZone ?? null, now),
      localHour: hourIn(country?.timeZone ?? null, now),
      night: isNight(country?.timeZone ?? null, now),
    });
  }

  /* Biggest first, the unknowns last whatever their size: they are the bucket
     you look at when something is wrong, not the one you work from. */
  return out.sort((a, b) => {
    if ((a.iso2 === 'unknown') !== (b.iso2 === 'unknown')) return a.iso2 === 'unknown' ? 1 : -1;
    return b.count - a.count || a.name.localeCompare(b.name);
  });
}

/** The same for the language column, with blanks gathered under "Not known". */
export function foldLanguages(rows: Array<{ lang: string | null; n: number }>): LanguageFacet[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const code = (row.lang ?? '').trim().toLowerCase() || 'unknown';
    totals.set(code, (totals.get(code) ?? 0) + Number(row.n));
  }
  const out: LanguageFacet[] = [...totals].map(([code, count]) => ({
    code,
    label: code === 'unknown' ? 'Not known' : languageName(code),
    count,
  }));
  return out.sort((a, b) => {
    if ((a.code === 'unknown') !== (b.code === 'unknown')) return a.code === 'unknown' ? 1 : -1;
    return b.count - a.count || a.label.localeCompare(b.label);
  });
}
