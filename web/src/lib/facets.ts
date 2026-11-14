/**
 * The country and language chips above the leads list.
 *
 * Emir, 14 November 2026, with a picture of chips reading
 * `All 26 · UAE 24 · USA/Canada 1 🌙 · India 1`: *"we need to add also this
 * option, like country based leads, language based leads, add also with flag,
 * so our agents can see easily which country they can filter the leads
 * easily."*
 *
 * Every number in here is the server's — `/api/my-leads/facets`, one
 * `GROUP BY` over the whole filtered book, fenced to what the person signed
 * in may see. Nothing in this file counts anything. That is the point: the
 * browser only ever has the fifty rows on the page, and a chip saying
 * "UAE 24" over a book of 2,041 would have been made up.
 *
 * `CALL_FROM` and `CALL_UNTIL` are not repeated here either; the server
 * decides whether it is the wrong hour to ring a country and sends `night`,
 * so the moon on a chip and the word "asleep" in the search box are one rule.
 */

export interface CountryFacet {
  /** ISO 3166-1 alpha-2, or `'unknown'` for a dialling code we cannot read. */
  iso2: string;
  name: string;
  /** 🇦🇪. Empty for the unknown bucket, which must never carry a flag. */
  flag: string;
  count: number;
  timeZone: string | null;
  /** Set where a country spans zones — "Moscow", "New York". */
  zoneLabel: string | null;
  localTime: string | null;
  localHour: number | null;
  /** True when it is outside calling hours there. Null when the zone is unknown. */
  night: boolean | null;
}

export interface LanguageFacet {
  /** The code as stored, or `'unknown'` for a blank one. */
  code: string;
  label: string;
  count: number;
}

export interface LeadFacets {
  countries: CountryFacet[];
  languages: LanguageFacet[];
  countryTotal: number;
  languageTotal: number;
  /**
   * The code `contacts.language` defaults to — `'en'`.
   *
   * It is sent because it is true and somebody should know it: a lead nobody
   * ever asked reads English exactly like one who said "English, please". The
   * screen no longer says so in words (Emir took the grey sentence off on 14
   * November), so the honest remainder is the separate "Not known" row, which
   * only covers rows that are literally blank. `docs/v2/questions-filters.md`
   * §2 is the open question.
   */
  languageDefault: string;
}

/**
 * What the clock where they are means for the agent about to ring them.
 *
 * Returns null where there is nothing honest to say — an unknown dialling
 * code has no zone, and a chip with no zone carries no clock rather than a
 * guessed one.
 */
export function callNote(one: CountryFacet): string | null {
  if (one.localTime === null) return null;
  const where = one.zoneLabel ?? one.name;
  if (one.night !== true) return `${one.localTime} in ${where}`;
  /* Which side of the window it is, because they are different problems:
     too early means wait, too late means tomorrow. */
  const side = one.localHour !== null && one.localHour < 12 ? 'too early' : 'too late';
  return `${one.localTime} in ${where} — ${side} to call`;
}
