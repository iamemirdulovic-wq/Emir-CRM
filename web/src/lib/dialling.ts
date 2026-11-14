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
 *
 * Where one dialling code covers several countries or several clocks — +1,
 * +7, +61, +55, +52 — the digits after it are read as well. See `AREAS`.
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
   * Several zones, and sometimes several countries. These five are the last
   * resort: the area code after the dialling code is read first (see `AREAS`
   * below), and only a number whose area code is not in that table lands
   * here — a toll-free +1, a Russian mobile, an Australian mobile. The clock
   * is then the country's main one and `zoneLabel` says which city it is, so
   * the card never pretends the whole country shares it. Russia alone spans
   * eleven.
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

/* ── Dial codes that cover more than one country or clock ─────────────────
 *
 * Emir, 14 Nov 2026: "+1 numbers: 'USA / Canada' is one group. Use the
 * 3-digit area code after +1 to find the country (USA, Canada, Caribbean) and
 * the state or province, and set the lead's time zone from it. Do the same for
 * +7 and other countries with several time zones."
 *
 * He is right, and the old table was wrong in a way that showed on screen
 * every day: a Toronto number flew an American flag, a Kazakh number flew a
 * Russian one, every Caribbean number was called American, and a Los Angeles
 * lead was given New York's clock — three hours out, which is the difference
 * between a good hour to ring and six in the morning.
 *
 * The fix is the same shape as the dial-code lookup above it: a table, and a
 * longest-prefix match. `originOf` finds the dial code first, then, if that
 * code has an area table here, matches the digits that follow it — four, then
 * three, then two, then one — so `889` (Darwin) beats `88` (Adelaide) beats
 * `8` (Perth). No country-by-country branching, and a new area code is one
 * line of data.
 *
 * Where a code is not in the table the dial code's own entry is used, exactly
 * as before, so nothing can get worse than it is today. Where a code is
 * positively identified the clock is that place's real clock and `zoneLabel`
 * names it, so the card reads "09:12 in California" rather than a bare time
 * the agent has to trust.
 */

/** One area inside a dial code: a country, maybe a state, and its clock. */
interface Area {
  iso2: string;
  name: string;
  /** State, province or region. Becomes `zoneLabel`, so it is read out loud. */
  region?: string;
  /** Null for a non-geographic range — a toll-free number is nowhere. */
  timeZone: string | null;
}

/**
 * Expand "205 251 256" into one entry per code.
 *
 * The space-separated string is the point: a state's area codes belong on one
 * line where they can be read and checked against a list, not spread over six
 * object literals that drift apart.
 */
function spread(
  codes: string,
  iso2: string,
  name: string,
  timeZone: string | null,
  region?: string,
): Record<string, Area> {
  const area: Area = { iso2, name, timeZone, ...(region ? { region } : {}) };
  return Object.fromEntries(codes.trim().split(/\s+/).map((code) => [code, area]));
}

/*
 * The North American Numbering Plan. Twenty-five countries share +1, and the
 * three digits after it are the only thing that tells them apart.
 *
 * Grouped by what decides the clock: a US state, a Canadian province, or a
 * Caribbean country. Where a state straddles two zones the minority codes get
 * their own line — El Paso is on Mountain time while the rest of Texas is on
 * Central, and east Tennessee is an hour ahead of Nashville.
 */
const NANP: Record<string, Area> = {
  /* ── The United States, by state ─────────────────────────────────────── */
  ...spread('205 251 256 334 659 938', 'US', 'USA', 'America/Chicago', 'Alabama'),
  ...spread('907', 'US', 'USA', 'America/Anchorage', 'Alaska'),
  ...spread('480 520 602 623 928', 'US', 'USA', 'America/Phoenix', 'Arizona'),
  ...spread('479 501 870', 'US', 'USA', 'America/Chicago', 'Arkansas'),
  ...spread(`209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628
             650 657 661 669 707 714 747 760 805 818 820 831 837 840 858 909 916 925 949 951`,
    'US', 'USA', 'America/Los_Angeles', 'California'),
  ...spread('303 719 720 970 983', 'US', 'USA', 'America/Denver', 'Colorado'),
  ...spread('203 475 860 959', 'US', 'USA', 'America/New_York', 'Connecticut'),
  ...spread('302', 'US', 'USA', 'America/New_York', 'Delaware'),
  ...spread('202', 'US', 'USA', 'America/New_York', 'Washington DC'),
  ...spread(`239 305 321 324 352 386 407 448 561 645 656 689 727 754 772 786 813 863 904 941 954`,
    'US', 'USA', 'America/New_York', 'Florida'),
  /* The panhandle keeps Central time, which is where Pensacola sits. */
  ...spread('850', 'US', 'USA', 'America/New_York', 'Florida'),
  ...spread('229 404 470 478 678 706 762 770 912 943', 'US', 'USA', 'America/New_York', 'Georgia'),
  ...spread('808', 'US', 'USA', 'Pacific/Honolulu', 'Hawaii'),
  ...spread('208 986', 'US', 'USA', 'America/Boise', 'Idaho'),
  ...spread(`217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872`,
    'US', 'USA', 'America/Chicago', 'Illinois'),
  ...spread('260 317 463 574 765 812 930', 'US', 'USA', 'America/Indiana/Indianapolis', 'Indiana'),
  /* North-west Indiana runs on Chicago's clock, and commutes there. */
  ...spread('219', 'US', 'USA', 'America/Chicago', 'Indiana'),
  ...spread('319 515 563 641 712', 'US', 'USA', 'America/Chicago', 'Iowa'),
  ...spread('316 620 785 913', 'US', 'USA', 'America/Chicago', 'Kansas'),
  ...spread('502 606 859', 'US', 'USA', 'America/New_York', 'Kentucky'),
  ...spread('270 364', 'US', 'USA', 'America/Chicago', 'Kentucky'),
  ...spread('225 318 337 504 985', 'US', 'USA', 'America/Chicago', 'Louisiana'),
  ...spread('207', 'US', 'USA', 'America/New_York', 'Maine'),
  ...spread('227 240 301 410 443 667', 'US', 'USA', 'America/New_York', 'Maryland'),
  ...spread('339 351 413 508 617 774 781 857 978', 'US', 'USA', 'America/New_York', 'Massachusetts'),
  ...spread('231 248 269 313 517 586 616 679 734 810 947 989', 'US', 'USA', 'America/Detroit', 'Michigan'),
  /* The western Upper Peninsula is on Central time. */
  ...spread('906', 'US', 'USA', 'America/Detroit', 'Michigan'),
  ...spread('218 320 507 612 651 763 952', 'US', 'USA', 'America/Chicago', 'Minnesota'),
  ...spread('228 601 662 769', 'US', 'USA', 'America/Chicago', 'Mississippi'),
  ...spread('314 417 557 573 636 660 816 975', 'US', 'USA', 'America/Chicago', 'Missouri'),
  ...spread('406', 'US', 'USA', 'America/Denver', 'Montana'),
  ...spread('308 402 531', 'US', 'USA', 'America/Chicago', 'Nebraska'),
  ...spread('702 725 775', 'US', 'USA', 'America/Los_Angeles', 'Nevada'),
  ...spread('603', 'US', 'USA', 'America/New_York', 'New Hampshire'),
  ...spread('201 551 609 640 732 848 856 862 908 973', 'US', 'USA', 'America/New_York', 'New Jersey'),
  ...spread('505 575', 'US', 'USA', 'America/Denver', 'New Mexico'),
  ...spread(`212 315 329 332 347 363 516 518 585 607 631 646 680 716 718 838 845 914 917 929 934`,
    'US', 'USA', 'America/New_York', 'New York'),
  ...spread('252 336 472 743 828 910 919 980 984', 'US', 'USA', 'America/New_York', 'North Carolina'),
  ...spread('701', 'US', 'USA', 'America/Chicago', 'North Dakota'),
  ...spread('216 220 234 326 330 380 419 436 440 513 567 614 740 937', 'US', 'USA', 'America/New_York', 'Ohio'),
  ...spread('405 539 572 580 918', 'US', 'USA', 'America/Chicago', 'Oklahoma'),
  ...spread('458 503 541 971', 'US', 'USA', 'America/Los_Angeles', 'Oregon'),
  ...spread(`215 223 267 272 412 445 484 570 582 610 717 724 814 835 878`,
    'US', 'USA', 'America/New_York', 'Pennsylvania'),
  ...spread('401', 'US', 'USA', 'America/New_York', 'Rhode Island'),
  ...spread('803 821 839 854 864', 'US', 'USA', 'America/New_York', 'South Carolina'),
  ...spread('605', 'US', 'USA', 'America/Chicago', 'South Dakota'),
  ...spread('615 629 731 901 931', 'US', 'USA', 'America/Chicago', 'Tennessee'),
  /* Knoxville and Chattanooga are an hour ahead of Nashville. */
  ...spread('423 865', 'US', 'USA', 'America/New_York', 'Tennessee'),
  ...spread(`210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832
             903 936 940 945 956 972 979`,
    'US', 'USA', 'America/Chicago', 'Texas'),
  /* El Paso keeps Mountain time, with New Mexico next door. */
  ...spread('915', 'US', 'USA', 'America/Denver', 'Texas'),
  ...spread('385 435 801', 'US', 'USA', 'America/Denver', 'Utah'),
  ...spread('802', 'US', 'USA', 'America/New_York', 'Vermont'),
  ...spread('276 434 540 571 686 703 757 804 826 948', 'US', 'USA', 'America/New_York', 'Virginia'),
  ...spread('206 253 360 425 509 564', 'US', 'USA', 'America/Los_Angeles', 'Washington'),
  ...spread('304 681', 'US', 'USA', 'America/New_York', 'West Virginia'),
  ...spread('262 274 353 414 534 608 715 920', 'US', 'USA', 'America/Chicago', 'Wisconsin'),
  ...spread('307', 'US', 'USA', 'America/Denver', 'Wyoming'),

  /* ── Canada, by province ─────────────────────────────────────────────── */
  ...spread('236 250 257 604 672 778', 'CA', 'Canada', 'America/Vancouver', 'British Columbia'),
  ...spread('368 403 587 780 825', 'CA', 'Canada', 'America/Edmonton', 'Alberta'),
  ...spread('306 474 639', 'CA', 'Canada', 'America/Regina', 'Saskatchewan'),
  ...spread('204 431 584', 'CA', 'Canada', 'America/Winnipeg', 'Manitoba'),
  ...spread(`226 249 289 343 365 382 416 437 519 613 647 683 705 742 753 807 905 942`,
    'CA', 'Canada', 'America/Toronto', 'Ontario'),
  ...spread('263 354 367 438 450 468 514 579 581 819 873', 'CA', 'Canada', 'America/Toronto', 'Quebec'),
  ...spread('428 506', 'CA', 'Canada', 'America/Moncton', 'New Brunswick'),
  ...spread('782 902', 'CA', 'Canada', 'America/Halifax', 'Nova Scotia'),
  ...spread('709 879', 'CA', 'Canada', 'America/St_Johns', 'Newfoundland'),
  ...spread('867', 'CA', 'Canada', 'America/Edmonton', 'Northern Canada'),

  /* ── The Caribbean and the Pacific: each one its own country ─────────── */
  ...spread('242', 'BS', 'Bahamas', 'America/Nassau'),
  ...spread('246', 'BB', 'Barbados', 'America/Barbados'),
  ...spread('264', 'AI', 'Anguilla', 'America/Anguilla'),
  ...spread('268', 'AG', 'Antigua and Barbuda', 'America/Antigua'),
  ...spread('284', 'VG', 'British Virgin Islands', 'America/Tortola'),
  ...spread('340', 'VI', 'US Virgin Islands', 'America/St_Thomas'),
  ...spread('345', 'KY', 'Cayman Islands', 'America/Cayman'),
  ...spread('441', 'BM', 'Bermuda', 'Atlantic/Bermuda'),
  ...spread('473', 'GD', 'Grenada', 'America/Grenada'),
  ...spread('649', 'TC', 'Turks and Caicos', 'America/Grand_Turk'),
  ...spread('664', 'MS', 'Montserrat', 'America/Montserrat'),
  ...spread('670', 'MP', 'Northern Mariana Islands', 'Pacific/Saipan'),
  ...spread('671', 'GU', 'Guam', 'Pacific/Guam'),
  ...spread('684', 'AS', 'American Samoa', 'Pacific/Pago_Pago'),
  ...spread('721', 'SX', 'Sint Maarten', 'America/Lower_Princes'),
  ...spread('758', 'LC', 'Saint Lucia', 'America/St_Lucia'),
  ...spread('767', 'DM', 'Dominica', 'America/Dominica'),
  ...spread('784', 'VC', 'Saint Vincent and the Grenadines', 'America/St_Vincent'),
  ...spread('787 939', 'PR', 'Puerto Rico', 'America/Puerto_Rico'),
  ...spread('809 829 849', 'DO', 'Dominican Republic', 'America/Santo_Domingo'),
  ...spread('868', 'TT', 'Trinidad and Tobago', 'America/Port_of_Spain'),
  ...spread('869', 'KN', 'Saint Kitts and Nevis', 'America/St_Kitts'),
  ...spread('876 658', 'JM', 'Jamaica', 'America/Jamaica'),

  /*
   * Toll-free and premium ranges are not places. No clock at all rather than
   * a confident wrong one: the card then shows the flag and the country and
   * drops the time, which is the truth about an 1-800 number.
   */
  ...spread('800 833 844 855 866 877 888 822 880 889 710 900', 'US', 'USA / Canada', null),
};

/*
 * Russia and Kazakhstan share +7, and Russia alone spans eleven clocks.
 *
 * Kazakhstan has every code beginning 6 or 7 — one country, and since
 * March 2024 one clock. Everything else is Russia, where the three digits
 * after +7 name the region. Russian mobiles are 9xx and are not geographic
 * at all (a Vladivostok man keeps his Moscow number when he moves), so those
 * fall through to the Moscow fallback and keep the label that says so.
 */
const PLUS_SEVEN: Record<string, Area> = {
  /*
   * The first digit alone settles the country, which is the thing the old
   * single row got wrong: 6 and 7 are Kazakhstan, and 3, 4, 5, 8 and 9 are
   * Russia. The three-digit rows below override these, longest match first,
   * so a Vladivostok landline is not left on Moscow's clock. These two lines
   * also keep `CODES` untouched — `server/src/leads/countries.ts` holds a
   * copy of that literal and `countries.test.ts` fails on any difference.
   */
  ...spread('6 7', 'KZ', 'Kazakhstan', 'Asia/Almaty'),
  ...spread('3 4 5 8 9', 'RU', 'Russia', 'Europe/Moscow', 'Moscow'),
  ...spread('495 496 498 499', 'RU', 'Russia', 'Europe/Moscow', 'Moscow'),
  ...spread('812', 'RU', 'Russia', 'Europe/Moscow', 'Saint Petersburg'),
  ...spread('401', 'RU', 'Russia', 'Europe/Kaliningrad', 'Kaliningrad'),
  ...spread('471 472 473 474 475 481 482 483 484 485 486 487 491 492 493 494',
    'RU', 'Russia', 'Europe/Moscow', 'Moscow'),
  ...spread('815 816 817 818 820 821', 'RU', 'Russia', 'Europe/Moscow', 'Moscow'),
  ...spread('831 833 834 835 836 841 843 855', 'RU', 'Russia', 'Europe/Moscow', 'Moscow'),
  ...spread('844', 'RU', 'Russia', 'Europe/Volgograd', 'Volgograd'),
  ...spread('845', 'RU', 'Russia', 'Europe/Saratov', 'Saratov'),
  ...spread('846 848', 'RU', 'Russia', 'Europe/Samara', 'Samara'),
  ...spread('851', 'RU', 'Russia', 'Europe/Astrakhan', 'Astrakhan'),
  ...spread('861 862 863 865 866 867 871 872 873 877 878 879',
    'RU', 'Russia', 'Europe/Moscow', 'Moscow'),
  ...spread('342 343 345 346 347 349 351 352 353', 'RU', 'Russia', 'Asia/Yekaterinburg', 'Yekaterinburg'),
  ...spread('381', 'RU', 'Russia', 'Asia/Omsk', 'Omsk'),
  ...spread('382 383', 'RU', 'Russia', 'Asia/Novosibirsk', 'Novosibirsk'),
  ...spread('384', 'RU', 'Russia', 'Asia/Novokuznetsk', 'Kemerovo'),
  ...spread('385 388', 'RU', 'Russia', 'Asia/Barnaul', 'Barnaul'),
  ...spread('390 391 394', 'RU', 'Russia', 'Asia/Krasnoyarsk', 'Krasnoyarsk'),
  ...spread('301 395', 'RU', 'Russia', 'Asia/Irkutsk', 'Irkutsk'),
  ...spread('302 411 416', 'RU', 'Russia', 'Asia/Yakutsk', 'Yakutsk'),
  ...spread('421 423 426', 'RU', 'Russia', 'Asia/Vladivostok', 'Vladivostok'),
  ...spread('424', 'RU', 'Russia', 'Asia/Sakhalin', 'Sakhalin'),
  ...spread('413', 'RU', 'Russia', 'Asia/Magadan', 'Magadan'),
  ...spread('415', 'RU', 'Russia', 'Asia/Kamchatka', 'Kamchatka'),
};

/*
 * Australia: one digit after +61 is the state, and the two or three after it
 * split the ones that share a digit. 08 covers Perth, Adelaide and Darwin,
 * which are three different clocks. Mobiles are 04xx and go nowhere near a
 * state, so they keep the Sydney fallback and its label.
 */
const PLUS_SIXTY_ONE: Record<string, Area> = {
  ...spread('2', 'AU', 'Australia', 'Australia/Sydney', 'New South Wales'),
  ...spread('3', 'AU', 'Australia', 'Australia/Melbourne', 'Victoria'),
  ...spread('36', 'AU', 'Australia', 'Australia/Hobart', 'Tasmania'),
  ...spread('7', 'AU', 'Australia', 'Australia/Brisbane', 'Queensland'),
  ...spread('8 86 89', 'AU', 'Australia', 'Australia/Perth', 'Western Australia'),
  ...spread('88', 'AU', 'Australia', 'Australia/Adelaide', 'South Australia'),
  ...spread('889', 'AU', 'Australia', 'Australia/Darwin', 'Northern Territory'),
};

/*
 * Brazil: the two-digit DDD. Most of the country is on São Paulo's clock;
 * the west and the north are one or two hours behind it.
 */
const PLUS_FIFTY_FIVE: Record<string, Area> = {
  ...spread('92 97', 'BR', 'Brazil', 'America/Manaus', 'Amazonas'),
  ...spread('95', 'BR', 'Brazil', 'America/Boa_Vista', 'Roraima'),
  ...spread('69', 'BR', 'Brazil', 'America/Porto_Velho', 'Rondônia'),
  ...spread('65 66', 'BR', 'Brazil', 'America/Cuiaba', 'Mato Grosso'),
  ...spread('68', 'BR', 'Brazil', 'America/Rio_Branco', 'Acre'),
};

/*
 * Mexico: four clocks. Only the ones that are confidently somewhere else than
 * Mexico City are listed; the rest fall through to the capital's clock, which
 * is where most of the country is.
 */
const MEXICAN_AREAS: Record<string, Area> = {
  ...spread('664 646 686', 'MX', 'Mexico', 'America/Tijuana', 'Baja California'),
  ...spread('622 631 642 644 662', 'MX', 'Mexico', 'America/Hermosillo', 'Sonora'),
  ...spread('656', 'MX', 'Mexico', 'America/Ciudad_Juarez', 'Ciudad Juárez'),
  ...spread('667 669', 'MX', 'Mexico', 'America/Mazatlan', 'Sinaloa'),
  ...spread('984 998', 'MX', 'Mexico', 'America/Cancun', 'Quintana Roo'),
};

const PLUS_FIFTY_TWO: Record<string, Area> = {
  ...MEXICAN_AREAS,
  /*
   * Mexican mobiles were written +52 **1** NPA … until 2019, and plenty of
   * rows imported from old spreadsheets still are. Listing every code a
   * second time with that 1 in front costs nothing and is read by the same
   * longest-prefix match — four digits are tried before three.
   */
  ...Object.fromEntries(Object.entries(MEXICAN_AREAS).map(([code, area]) => [`1${code}`, area])),
};

/** Dial code → its area table. A code with no table keeps its own entry. */
const AREAS: Record<string, Record<string, Area>> = {
  1: NANP,
  7: PLUS_SEVEN,
  61: PLUS_SIXTY_ONE,
  55: PLUS_FIFTY_FIVE,
  52: PLUS_FIFTY_TWO,
};

/** 'AE' → 🇦🇪, by shifting the letters into regional indicators. */
export function flagOf(iso2: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso2)) return '';
  return String.fromCodePoint(
    ...iso2.toUpperCase().split('').map((c) => 0x1f1a5 + c.charCodeAt(0)),
  );
}

/**
 * The area inside a dial code, for the codes that cover more than one.
 *
 * Longest prefix wins, so `889` (Darwin) beats `88` (Adelaide) beats `8`
 * (Perth). Returns null when the digits match nothing, and the caller then
 * keeps the dial code's own entry — so an area code nobody has added yet
 * behaves exactly as it did before this table existed.
 */
function areaOf(code: string, rest: string): Origin | null {
  const table = AREAS[code];
  if (!table || !rest) return null;
  for (const length of [4, 3, 2, 1]) {
    const area = table[rest.slice(0, length)];
    if (!area) continue;
    return {
      iso2: area.iso2,
      name: area.name,
      timeZone: area.timeZone,
      /* The state, province or zone city, which the card reads out loud. */
      ...(area.region ? { zoneLabel: area.region } : {}),
    };
  }
  return null;
}

/**
 * The country behind an E.164 number, or null when the code is not known.
 *
 * Two passes. The dialling code first, longest match wins so +998 is not read
 * as +99. Then, for +1, +7 and the others that span several countries or
 * clocks, the digits after it — which is what actually tells Toronto from
 * Texas and Almaty from Moscow.
 */
export function originOf(phoneE164: string | null | undefined): Origin | null {
  const digits = (phoneE164 ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  /* Longest first: +998 (Uzbekistan) must not be read as +99 or +9. */
  for (const length of [4, 3, 2, 1]) {
    const code = digits.slice(0, length);
    const hit = CODES[Number(code)];
    if (!hit) continue;
    return areaOf(code, digits.slice(length)) ?? hit;
  }
  return null;
}

export interface LocalClock {
  /**
   * "15:05" where they are.
   *
   * Twenty-four hour. It was twelve — Emir, 10 Nov 2026: "should be 12 hours
   * time, is like not 16 17 18" — and on 13 Nov he reversed it: the CRM is
   * 24-hour everywhere, and this clock was the one place that was not, which
   * put "3:05 PM" on My Day, My leads, the lead page and the dialler beside
   * follow-up times written 15:05. One clock on a screen is worth more than
   * the saved sum.
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
    /* The hour on its own, for the arithmetic below. */
    const hour = Number(new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', hour12: false,
    }).format(now).slice(0, 2));

    /* 24-hour, like every other time in the CRM. `en-GB` rather than `en-AE`:
       the AE tag quietly means 12-hour, which is the bug this is fixing. */
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
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
      /* 24-hour, like the rest of the CRM: "call after 09:00 Dubai time". */
      const yours = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false,
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
