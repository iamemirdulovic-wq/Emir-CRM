/**
 * Which country a number is from, and what the time is there.
 *
 * Emir, 10 Nov 2026: "this number from which country with flag, and that
 * country time also ... also you can add option, when you can call them, like
 * you can recommend time to call them."
 *
 * The reason it earns its place: his leads are not local. His own export runs
 * 186 UK numbers, 184 UAE, 31 Russian and fifty other countries, and an agent
 * in Dubai ringing a London number at 10am is calling someone at 6am. The
 * number already says where they are; nothing was reading it.
 *
 * No library for this. `libphonenumber-js` is on the server and not in the
 * browser bundle, and adding 150KB to every page load to turn "+44" into "UK"
 * is not a trade worth making. Longest-prefix match over the table below does
 * the same job in a few lines.
 *
 * The table is the fifty-odd codes that appear in real UAE brokerage data,
 * plus the big ones. An unknown code is not guessed: the strip simply does
 * not appear, which is the honest answer and never a wrong flag.
 */

/** Where the people reading this sit. */
export const HOME = 'Dubai';

export interface Origin {
  /** ISO 3166-1 alpha-2, which is also what makes the flag. */
  iso2: string;
  name: string;
  /** An IANA zone. Null only where no sensible default exists. */
  timeZone: string | null;
  /**
   * Set where the country spans several zones, naming the city this clock
   * belongs to — "Moscow", "New York". The card then says "3:26 PM in
   * Moscow" instead of implying the whole country is on that clock.
   *
   * Showing the main city beats showing nothing: most Russian mobiles in
   * Dubai lead data are European Russia, and an agent told "3:26 PM in
   * Moscow" knows both what it probably is and that it is worth a glance.
   */
  zoneLabel?: string;
}

/** Dialling code → country. Longest match wins, so +1242 beats +1. */
const CODES: Record<string, Origin> = {
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
  64: { iso2: 'NZ', name: 'New Zealand', timeZone: 'Pacific/Auckland' },
};

/** 'AE' → 🇦🇪, by shifting the letters into regional indicators. */
export function flagOf(iso2: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso2)) return '';
  return String.fromCodePoint(
    ...iso2.toUpperCase().split('').map((c) => 0x1f1a5 + c.charCodeAt(0)),
  );
}

/** The country behind an E.164 number, or null when the code is not known. */
export function originOf(phoneE164: string | null | undefined): Origin | null {
  const digits = (phoneE164 ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  /* Longest first: +1242 (Bahamas) must not be read as +1. */
  for (const length of [4, 3, 2, 1]) {
    const hit = CODES[Number(digits.slice(0, length))];
    if (hit) return hit;
  }
  return null;
}

export interface LocalClock {
  /**
   * "3:05 PM" where they are.
   *
   * Twelve hour, not twenty-four. Emir, 10 Nov 2026: "should be 12 hours
   * time, is like not 16 17 18, like should be 3 a.m. 4 p.m. 12 p.m." An
   * agent glancing at a card reads 3 PM without converting; 15:00 is one
   * small sum, and the card exists precisely so nobody has to do sums.
   */
  time: string;
  /** 0–23 there, for deciding whether now is a decent hour. */
  hour: number;
  /** "3 hours behind Dubai", or "Same time as Dubai". */
  offset: string;
  /** The gap in hours, signed. Positive is ahead of us. */
  gap: number;
}

/** What the clock says where they are. Null when the zone is unknown. */
export function clockIn(timeZone: string | null, now: Date = new Date()): LocalClock | null {
  if (!timeZone) return null;
  try {
    /* Read the 24-hour value for the arithmetic, show the 12-hour one. */
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', hour12: false,
    }).format(now).slice(0, 2));

    const time = new Intl.DateTimeFormat('en-US', {
      timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(now);

    /*
     * The gap, worked out by formatting the same instant in both zones rather
     * than by arithmetic on offsets, so summer time is somebody else's problem.
     */
    const here = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false }).format(now);
    let gap = hour - Number(here.slice(0, 2));
    if (gap > 12) gap -= 24;
    if (gap < -12) gap += 24;

    /*
     * Named against the office rather than "you": every agent reading this
     * is sitting in Dubai, and "3 hours behind Dubai" is a fact they can
     * repeat to a colleague, where "behind you" depends on who is looking.
     */
    const offset = gap === 0
      ? `Same time as ${HOME}`
      : `${Math.abs(gap)} hour${Math.abs(gap) === 1 ? '' : 's'} ${gap > 0 ? 'ahead of' : 'behind'} ${HOME}`;

    return { time, hour, offset, gap };
  } catch {
    /* An IANA zone the browser does not know. Better no clock than a wrong one. */
    return null;
  }
}

/**
 * Is now a reasonable moment to ring them, and if not, when?
 *
 * 9am to 8pm where they are. Deliberately wider than office hours: a buyer
 * looking at Dubai property takes a call in the evening, and an agent held to
 * 9–5 in the client's zone would never reach the UK at all from here.
 */
export const CALL_FROM = 9;
export const CALL_UNTIL = 20;

export interface CallAdvice {
  ok: boolean;
  /** One line for the agent. */
  line: string;
}

export function whenToCall(clock: LocalClock | null, timeZone: string | null): CallAdvice | null {
  if (!clock || !timeZone) return null;
  if (clock.hour >= CALL_FROM && clock.hour < CALL_UNTIL) {
    return { ok: true, line: 'Good time to call them now' };
  }

  /*
   * The next sensible hour there, said in the agent's own clock — "after
   * 13:00 your time" is the only version an agent can act on without doing
   * the arithmetic themselves, which is the whole point.
   */
  const now = new Date();
  for (let ahead = 1; ahead <= 24; ahead += 1) {
    const at = new Date(now.getTime() + ahead * 60 * 60 * 1000);
    const theirHour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', hour12: false,
    }).format(at).slice(0, 2));
    if (theirHour === CALL_FROM) {
      /*
       * On the hour there, not on this minute.
       *
       * The loop steps forward in whole hours from right now, so at 9:41 PM
       * it lands on 9:41 AM and the advice read "call after 9:41 AM" -- a
       * time with no meaning to anybody. Taking off the minutes it is there
       * gives the moment it is exactly 09:00 for the client, which is the
       * thing the sentence is actually about. The minutes are subtracted in
       * THEIR clock rather than ours, because half-hour zones exist: 09:00
       * in India is 07:30 in Dubai, and rounding in the wrong clock would
       * tell an agent to call at 07:00.
       */
      const theirMinute = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone, minute: '2-digit',
      }).format(at));
      const onTheHour = new Date(at.getTime() - theirMinute * 60_000);
      const yours = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true,
      }).format(onTheHour);
      const early = clock.hour < CALL_FROM;
      return {
        ok: false,
        line: `${early ? 'Too early there' : 'Too late there'} — call after ${yours} ${HOME} time`,
      };
    }
  }
  return { ok: false, line: clock.hour < CALL_FROM ? 'Too early there' : 'Too late there' };
}
