/**
 * Which country a lead's number is from, counted over the whole book.
 *
 * The browser has known this since 10 November — `web/src/lib/dialling.ts`
 * turns "+447700900123" into a flag, a clock and "too early there". But the
 * browser only ever sees the fifty rows on the page, so it cannot answer the
 * question the owner actually asked on 14 November: *"country based leads,
 * language based leads, add also with flag, so our agents can see easily
 * which country"*. A chip reading "UAE 24" over a book of 2,041 would be a
 * lie, and the one thing a count on a screen has to be is true.
 *
 * So the same table lives here, and the server does the counting.
 *
 * ── Why the table is copied rather than imported ──────────────────────────
 *
 * `server/` and `web/` are separate workspaces and the server's `tsconfig`
 * has `rootDir: src`, so a relative import of a file in `web/src` does not
 * typecheck. The copy is kept honest by `countries.parity.test.ts`, which
 * reads `web/src/lib/dialling.ts` off disk and fails if one row differs —
 * the same trick as `schema-map.test.ts` and `config/env-docs.test.ts`.
 *
 * It has to be the same table, not merely a similar one. `libphonenumber-js`
 * is a server dependency and knows ~240 calling codes to this table's 83, so
 * using it here would count a Bahamas number under "Bahamas" while the row
 * beside the chip drew the flag of the United States — or drew none at all.
 * One table means the chip, the flag and the clock cannot disagree.
 *
 * ── Why no column, no migration and no backfill ───────────────────────────
 *
 * A persisted `phone_country` would be faster to filter on, and it would have
 * to be written by every path that touches a phone number — ingestion,
 * import, the merge tool, an agent correcting a typo — and backfilled on a
 * live site where every push is a release. A number's country is a pure
 * function of its digits; storing it only creates somewhere for it to go
 * stale. The counting query groups on the leading digits instead, which is a
 * tiny result set, and this file folds those buckets into countries.
 */

/** 0–23 in the client's own clock: the window an agent may ring inside. */
export const CALL_FROM = 9;
export const CALL_UNTIL = 20;

/**
 * How many leading digits the count query groups on.
 *
 * Four, because the longest code the table could hold is four (+1242 is the
 * Bahamas). The bucket is folded into a country here by longest-prefix match,
 * exactly as the browser does it.
 */
export const PREFIX_LEN = 4;

export interface Country {
  /** ISO 3166-1 alpha-2, which is also what makes the flag. */
  iso2: string;
  name: string;
  /** An IANA zone. Null only where no sensible default exists. */
  timeZone: string | null;
  /** Set where the country spans several zones, naming the city this clock is. */
  zoneLabel?: string;
}

/**
 * Dialling code → country. Longest match wins, so +1242 would beat +1.
 *
 * Verbatim from `web/src/lib/dialling.ts`. Do not edit one without the other;
 * `countries.parity.test.ts` is what stops you.
 */
export const DIALLING_CODES: Record<string, Country> = {

  // The Gulf
  971: { iso2: 'AE', name: 'UAE', timeZone: 'Asia/Dubai' },
  966: { iso2: 'SA', name: 'Saudi Arabia', timeZone: 'Asia/Riyadh' },
  974: { iso2: 'QA', name: 'Qatar', timeZone: 'Asia/Qatar' },
  965: { iso2: 'KW', name: 'Kuwait', timeZone: 'Asia/Kuwait' },
  973: { iso2: 'BH', name: 'Bahrain', timeZone: 'Asia/Bahrain' },
  968: { iso2: 'OM', name: 'Oman', timeZone: 'Asia/Muscat' },
  962: { iso2: 'JO', name: 'Jordan', timeZone: 'Asia/Amman' },
  961: { iso2: 'LB', name: 'Lebanon', timeZone: 'Asia/Beirut' },
  20: { iso2: 'EG', name: 'Egypt', timeZone: 'Africa/Cairo' },
  964: { iso2: 'IQ', name: 'Iraq', timeZone: 'Asia/Baghdad' },
  963: { iso2: 'SY', name: 'Syria', timeZone: 'Asia/Damascus' },
  967: { iso2: 'YE', name: 'Yemen', timeZone: 'Asia/Aden' },

  // Europe
  44: { iso2: 'GB', name: 'United Kingdom', timeZone: 'Europe/London' },
  353: { iso2: 'IE', name: 'Ireland', timeZone: 'Europe/Dublin' },
  49: { iso2: 'DE', name: 'Germany', timeZone: 'Europe/Berlin' },
  43: { iso2: 'AT', name: 'Austria', timeZone: 'Europe/Vienna' },
  41: { iso2: 'CH', name: 'Switzerland', timeZone: 'Europe/Zurich' },
  39: { iso2: 'IT', name: 'Italy', timeZone: 'Europe/Rome' },
  34: { iso2: 'ES', name: 'Spain', timeZone: 'Europe/Madrid' },
  351: { iso2: 'PT', name: 'Portugal', timeZone: 'Europe/Lisbon' },
  33: { iso2: 'FR', name: 'France', timeZone: 'Europe/Paris' },
  32: { iso2: 'BE', name: 'Belgium', timeZone: 'Europe/Brussels' },
  31: { iso2: 'NL', name: 'Netherlands', timeZone: 'Europe/Amsterdam' },
  45: { iso2: 'DK', name: 'Denmark', timeZone: 'Europe/Copenhagen' },
  46: { iso2: 'SE', name: 'Sweden', timeZone: 'Europe/Stockholm' },
  47: { iso2: 'NO', name: 'Norway', timeZone: 'Europe/Oslo' },
  358: { iso2: 'FI', name: 'Finland', timeZone: 'Europe/Helsinki' },
  48: { iso2: 'PL', name: 'Poland', timeZone: 'Europe/Warsaw' },
  420: { iso2: 'CZ', name: 'Czechia', timeZone: 'Europe/Prague' },
  421: { iso2: 'SK', name: 'Slovakia', timeZone: 'Europe/Bratislava' },
  36: { iso2: 'HU', name: 'Hungary', timeZone: 'Europe/Budapest' },
  40: { iso2: 'RO', name: 'Romania', timeZone: 'Europe/Bucharest' },
  359: { iso2: 'BG', name: 'Bulgaria', timeZone: 'Europe/Sofia' },
  30: { iso2: 'GR', name: 'Greece', timeZone: 'Europe/Athens' },
  357: { iso2: 'CY', name: 'Cyprus', timeZone: 'Asia/Nicosia' },
  90: { iso2: 'TR', name: 'Türkiye', timeZone: 'Europe/Istanbul' },
  380: { iso2: 'UA', name: 'Ukraine', timeZone: 'Europe/Kyiv' },
  375: { iso2: 'BY', name: 'Belarus', timeZone: 'Europe/Minsk' },
  385: { iso2: 'HR', name: 'Croatia', timeZone: 'Europe/Zagreb' },
  386: { iso2: 'SI', name: 'Slovenia', timeZone: 'Europe/Ljubljana' },
  381: { iso2: 'RS', name: 'Serbia', timeZone: 'Europe/Belgrade' },
  371: { iso2: 'LV', name: 'Latvia', timeZone: 'Europe/Riga' },
  370: { iso2: 'LT', name: 'Lithuania', timeZone: 'Europe/Vilnius' },
  372: { iso2: 'EE', name: 'Estonia', timeZone: 'Europe/Tallinn' },
  352: { iso2: 'LU', name: 'Luxembourg', timeZone: 'Europe/Luxembourg' },
  356: { iso2: 'MT', name: 'Malta', timeZone: 'Europe/Malta' },

  // Central Asia and the Caucasus, which show up constantly in Dubai data
  994: { iso2: 'AZ', name: 'Azerbaijan', timeZone: 'Asia/Baku' },
  995: { iso2: 'GE', name: 'Georgia', timeZone: 'Asia/Tbilisi' },
  374: { iso2: 'AM', name: 'Armenia', timeZone: 'Asia/Yerevan' },
  998: { iso2: 'UZ', name: 'Uzbekistan', timeZone: 'Asia/Tashkent' },
  996: { iso2: 'KG', name: 'Kyrgyzstan', timeZone: 'Asia/Bishkek' },
  992: { iso2: 'TJ', name: 'Tajikistan', timeZone: 'Asia/Dushanbe' },

  // Asia
  91: { iso2: 'IN', name: 'India', timeZone: 'Asia/Kolkata' },
  92: { iso2: 'PK', name: 'Pakistan', timeZone: 'Asia/Karachi' },
  880: { iso2: 'BD', name: 'Bangladesh', timeZone: 'Asia/Dhaka' },
  94: { iso2: 'LK', name: 'Sri Lanka', timeZone: 'Asia/Colombo' },
  977: { iso2: 'NP', name: 'Nepal', timeZone: 'Asia/Kathmandu' },
  63: { iso2: 'PH', name: 'Philippines', timeZone: 'Asia/Manila' },
  60: { iso2: 'MY', name: 'Malaysia', timeZone: 'Asia/Kuala_Lumpur' },
  65: { iso2: 'SG', name: 'Singapore', timeZone: 'Asia/Singapore' },
  66: { iso2: 'TH', name: 'Thailand', timeZone: 'Asia/Bangkok' },
  62: { iso2: 'ID', name: 'Indonesia', timeZone: 'Asia/Jakarta' },
  84: { iso2: 'VN', name: 'Vietnam', timeZone: 'Asia/Ho_Chi_Minh' },
  852: { iso2: 'HK', name: 'Hong Kong', timeZone: 'Asia/Hong_Kong' },
  81: { iso2: 'JP', name: 'Japan', timeZone: 'Asia/Tokyo' },
  82: { iso2: 'KR', name: 'South Korea', timeZone: 'Asia/Seoul' },
  98: { iso2: 'IR', name: 'Iran', timeZone: 'Asia/Tehran' },
  972: { iso2: 'IL', name: 'Israel', timeZone: 'Asia/Jerusalem' },
  86: { iso2: 'CN', name: 'China', timeZone: 'Asia/Shanghai' },

  // Africa
  27: { iso2: 'ZA', name: 'South Africa', timeZone: 'Africa/Johannesburg' },
  212: { iso2: 'MA', name: 'Morocco', timeZone: 'Africa/Casablanca' },
  213: { iso2: 'DZ', name: 'Algeria', timeZone: 'Africa/Algiers' },
  216: { iso2: 'TN', name: 'Tunisia', timeZone: 'Africa/Tunis' },
  234: { iso2: 'NG', name: 'Nigeria', timeZone: 'Africa/Lagos' },
  254: { iso2: 'KE', name: 'Kenya', timeZone: 'Africa/Nairobi' },

  /*
   * Several zones. The clock is the country's main one and is labelled as
   * such, so the card is useful without pretending the whole country shares
   * it — Russia alone spans eleven.
   */
  7: { iso2: 'RU', name: 'Russia / Kazakhstan', timeZone: 'Europe/Moscow', zoneLabel: 'Moscow' },
  1: { iso2: 'US', name: 'USA / Canada', timeZone: 'America/New_York', zoneLabel: 'New York' },
  61: { iso2: 'AU', name: 'Australia', timeZone: 'Australia/Sydney', zoneLabel: 'Sydney' },
  55: { iso2: 'BR', name: 'Brazil', timeZone: 'America/Sao_Paulo', zoneLabel: 'São Paulo' },
  52: { iso2: 'MX', name: 'Mexico', timeZone: 'America/Mexico_City' },
  54: { iso2: 'AR', name: 'Argentina', timeZone: 'America/Argentina/Buenos_Aires' },
  57: { iso2: 'CO', name: 'Colombia', timeZone: 'America/Bogota' },
  64: { iso2: 'NZ', name: 'New Zealand', timeZone: 'Pacific/Auckland' },};

/** 'AE' → 🇦🇪, by shifting the letters into regional indicators. */
export function flagOf(iso2: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso2)) return '';
  return String.fromCodePoint(
    ...iso2.toUpperCase().split('').map((c) => 0x1f1a5 + c.charCodeAt(0)),
  );
}

/**
 * The country behind a bucket of leading digits, or null when nothing matches.
 *
 * Longest first: a four-digit code must not be read as the one-digit code it
 * starts with. Null is the honest answer and never a wrong flag — the rule
 * `web/src/lib/dialling.ts` was written to, and the rule the "Unknown" chip
 * exists for.
 */
export function countryOfPrefix(digits: string | null | undefined): Country | null {
  const clean = (digits ?? '').replace(/[^\d]/g, '');
  if (!clean) return null;
  for (let length = PREFIX_LEN; length >= 1; length -= 1) {
    const hit = DIALLING_CODES[clean.slice(0, length)];
    if (hit) return hit;
  }
  return null;
}

/** The same, from a whole number. */
export function countryOf(phoneE164: string | null | undefined): Country | null {
  return countryOfPrefix((phoneE164 ?? '').replace(/[^\d]/g, '').slice(0, PREFIX_LEN));
}

/** Every dialling code that resolves to this country, longest first. */
export function codesFor(iso2: string): string[] {
  return Object.keys(DIALLING_CODES)
    .filter((code) => DIALLING_CODES[code]?.iso2 === iso2.toUpperCase())
    .sort((a, b) => b.length - a.length);
}

/** Every country in the table, once each, named as the browser names it. */
export function allCountries(): Country[] {
  const seen = new Map<string, Country>();
  for (const code of Object.keys(DIALLING_CODES)) {
    const one = DIALLING_CODES[code];
    if (one && !seen.has(one.iso2)) seen.set(one.iso2, one);
  }
  return [...seen.values()];
}

/* ── The clock where they are ─────────────────────────────────────────────── */

/** 0–23 in that zone right now, or null when the zone is not one Node knows. */
export function hourIn(timeZone: string | null, now: Date = new Date()): number | null {
  if (!timeZone) return null;
  try {
    return Number(new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', hour12: false,
    }).format(now).slice(0, 2));
  } catch {
    return null;
  }
}

/** "14:05" there, 24-hour, like every other time in the CRM. */
export function timeIn(timeZone: string | null, now: Date = new Date()): string | null {
  if (!timeZone) return null;
  try {
    /* `en-GB`, not `en-AE`: the AE tag quietly means 12-hour. */
    return new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now);
  } catch {
    return null;
  }
}

/**
 * Is it the wrong hour to ring them?
 *
 * The one rule, shared: outside `CALL_FROM`–`CALL_UNTIL` in the client's own
 * clock, which is exactly what `whenToCall()` in `web/src/lib/dialling.ts`
 * answers `ok: false` to. The moon on a country chip and the word "asleep" in
 * the search box are both this function, so they cannot drift apart.
 *
 * Null when the zone is unknown: no moon rather than a guessed one.
 */
export function isNight(timeZone: string | null, now: Date = new Date()): boolean | null {
  const hour = hourIn(timeZone, now);
  if (hour === null) return null;
  return hour < CALL_FROM || hour >= CALL_UNTIL;
}

/** The countries where it is the wrong hour to ring, right now. */
export function asleepNow(now: Date = new Date()): string[] {
  return allCountries().filter((one) => isNight(one.timeZone, now) === true).map((one) => one.iso2);
}

/** And the ones where it is a decent hour. */
export function awakeNow(now: Date = new Date()): string[] {
  return allCountries().filter((one) => isNight(one.timeZone, now) === false).map((one) => one.iso2);
}

/* ── SQL ──────────────────────────────────────────────────────────────────── */

/**
 * The number's digits, as SQL — no plus, no spaces, no dashes.
 *
 * Written once, here, so the expression the counts group on is character for
 * character the expression the filter narrows on. Two spellings of this is
 * how a chip comes to say 24 over a list of 23.
 */
export function digitsSql(column: string): string {
  return `REGEXP_REPLACE(COALESCE(${column}, ''), '[^0-9]', '')`;
}

/** What the count query groups on: the first `PREFIX_LEN` digits. */
export function prefixSql(column: string): string {
  return `SUBSTRING(${digitsSql(column)}, 1, ${PREFIX_LEN})`;
}

export interface Clause { sql: string; params: string[] }

/**
 * Narrow to one country, or to the leads whose code we do not know.
 *
 * `iso2` is a country in the table, or `'unknown'`. Anything else returns
 * null, so a hand-typed `?country=xx` in the URL is ignored rather than
 * silently emptying the screen.
 *
 * For a country it is one equality per code, at that code's own length, plus
 * a guard against any longer code that extends it and belongs elsewhere.
 * There are no such pairs in the table today — `countries.test.ts` asserts
 * it — and the guard means adding +1242 tomorrow cannot quietly start
 * counting Bahamas numbers as American ones.
 */
export function countryClause(column: string, iso2: string): Clause | null {
  const digits = digitsSql(column);
  if (iso2 === 'unknown') {
    /* Nothing in the table matches at any length — which is also the answer
       for a lead with no phone number at all, since SUBSTRING('',1,n) is ''. */
    const byLength = new Map<number, string[]>();
    for (const code of Object.keys(DIALLING_CODES)) {
      byLength.set(code.length, [...(byLength.get(code.length) ?? []), code]);
    }
    const parts: string[] = [];
    const params: string[] = [];
    for (const [length, codes] of [...byLength.entries()].sort((a, b) => a[0] - b[0])) {
      parts.push(`SUBSTRING(${digits}, 1, ${length}) NOT IN (${codes.map(() => '?').join(', ')})`);
      params.push(...codes);
    }
    return { sql: `(${parts.join(' AND ')})`, params };
  }

  const codes = codesFor(iso2);
  if (codes.length === 0) return null;
  const parts: string[] = [];
  const params: string[] = [];
  for (const code of codes) {
    const longer = Object.keys(DIALLING_CODES).filter(
      (other) => other.length > code.length
        && other.startsWith(code)
        && DIALLING_CODES[other]?.iso2 !== iso2.toUpperCase(),
    );
    let part = `SUBSTRING(${digits}, 1, ${code.length}) = ?`;
    params.push(code);
    for (const other of longer) {
      part += ` AND SUBSTRING(${digits}, 1, ${other.length}) <> ?`;
      params.push(other);
    }
    parts.push(`(${part})`);
  }
  return { sql: `(${parts.join(' OR ')})`, params };
}

/**
 * Narrow to the countries in a set — what "asleep" and "awake" are made of.
 *
 * An empty set returns null rather than `1=0`: at 06:00 Dubai every country
 * in the book might be awake, and a search that silently matches nothing is
 * worse than one that matches on the other fields.
 */
export function countriesClause(column: string, list: string[]): Clause | null {
  const clauses = list.map((iso2) => countryClause(column, iso2)).filter((one): one is Clause => one !== null);
  if (clauses.length === 0) return null;
  return {
    sql: `(${clauses.map((one) => one.sql).join(' OR ')})`,
    params: clauses.flatMap((one) => one.params),
  };
}

/* ── Language ─────────────────────────────────────────────────────────────── */

/**
 * The language names the CRM actually sees on a contact.
 *
 * `contacts.language` is `VARCHAR(8) NOT NULL DEFAULT 'en'`, so a lead nobody
 * ever asked reads `en` exactly like one who said "English, please". The
 * screen says so in words rather than pretending otherwise, and
 * `docs/v2/questions-filters.md` records it.
 *
 * A code that is not in this list is shown as it is stored, upper-cased. No
 * name is invented for it.
 */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ar: 'Arabic',
  ru: 'Russian',
  hi: 'Hindi',
  ur: 'Urdu',
  fa: 'Persian',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  tr: 'Turkish',
  zh: 'Chinese',
  tl: 'Filipino',
  ml: 'Malayalam',
  ta: 'Tamil',
  bn: 'Bengali',
  pt: 'Portuguese',
  nl: 'Dutch',
  pl: 'Polish',
  uk: 'Ukrainian',
};

/** "ar" → "Arabic"; an unknown code is shown as it is stored. */
export function languageName(code: string): string {
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

/** The language codes whose name or code somebody could have typed. */
export function languagesMatching(term: string): string[] {
  const want = term.trim().toLowerCase();
  if (!want) return [];
  return Object.keys(LANGUAGE_NAMES).filter(
    (code) => code === want || LANGUAGE_NAMES[code]?.toLowerCase().startsWith(want),
  );
}

/**
 * The countries whose name, code or dialling code somebody could have typed.
 *
 * Matched on the start of the name rather than anywhere inside it, so "in"
 * finds India and not Argentina, Ukraine and Finland as well. "uae", "ae",
 * "971" and "+971" all find the UAE.
 */
export function countriesMatching(term: string): string[] {
  const want = term.trim().toLowerCase().replace(/^\+/, '');
  if (!want) return [];
  const hits = new Set<string>();
  for (const one of allCountries()) {
    if (one.iso2.toLowerCase() === want) hits.add(one.iso2);
    /* "usa / canada" is one country here, so each half is matched on its own. */
    else if (one.name.toLowerCase().split(/\s*[/·]\s*/).some((part) => part.startsWith(want))) {
      hits.add(one.iso2);
    } else if (one.zoneLabel?.toLowerCase().startsWith(want)) hits.add(one.iso2);
  }
  const byCode = DIALLING_CODES[want];
  if (byCode) hits.add(byCode.iso2);
  /* Sorted, so the same word always gives the same answer in the same order:
     the table's own key order is numeric (1, 7, 20, 27, …), which is nobody's
     idea of alphabetical. */
  return [...hits].sort();
}
