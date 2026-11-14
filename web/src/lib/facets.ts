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
   * The code `contacts.language` defaults to. The screen says so out loud,
   * because a lead nobody ever asked reads English exactly like one who said
   * "English, please" — see `docs/v2/questions-filters.md`.
   */
  languageDefault: string;
}

/**
 * How many chips a row shows before it folds.
 *
 * Emir's own export runs fifty-odd countries. Fifty pills is not a filter,
 * it is a wall, so the row shows the ones with the most leads and offers the
 * rest behind one press.
 */
export const FACETS_SHOWN = 8;

/**
 * Which chips to draw, and how many are left behind "+N more".
 *
 * The one that is picked is always drawn, however far down the list it is.
 * Without that rule, choosing a small country from the expanded row and then
 * collapsing it hides the only chip saying what the list is narrowed to.
 */
export function visibleFacets<T>(
  all: T[],
  opts: { expanded: boolean; picked: (one: T) => boolean; limit?: number },
): { shown: T[]; hidden: number } {
  const limit = opts.limit ?? FACETS_SHOWN;
  if (opts.expanded || all.length <= limit) return { shown: all, hidden: 0 };
  const shown = all.slice(0, limit);
  const chosen = all.slice(limit).filter(opts.picked);
  return { shown: [...shown, ...chosen], hidden: all.length - limit - chosen.length };
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

/**
 * The words the search box takes, for the line that says so under it.
 *
 * Written here rather than in the screen so the list cannot drift from
 * `searchClause` on the server, which is the thing that actually matches.
 */
export const SEARCH_UNDERSTANDS = [
  'name', 'phone', 'email', 'project', 'country', 'language', 'awake', 'asleep',
];
