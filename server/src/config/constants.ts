/**
 * What the product calls itself in anything an agent reads — an email
 * signature, the name on an export. The web app has its own copy in
 * `web/src/brand.tsx`; the two have to agree, and there is no sensible way to
 * share one file across the two builds.
 *
 * This is the product's name, not the company's. The company's name is a
 * business detail that reaches clients, and it lives in Settings.
 */
export const PRODUCT_NAME = 'homes.me';

/**
 * The company, as it introduces itself to a lead.
 *
 * It was written out in six places that send to clients — the WhatsApp welcome
 * template, three follow-up emails, two template footers — so a rename reached
 * some of them and not others, and a lead could be welcomed by one company and
 * followed up by another.
 *
 * `COMPANY_LOCALITY_AR` exists because the legal name is registered in Latin
 * script and is not ours to translate. The Arabic footer carries the name as
 * registered and says where we are in Arabic, which is what UAE brokerages
 * normally do.
 *
 * These belong in Settings eventually, beside the TRN and the ORN. Until then
 * they are here, where there is one of each.
 */
export const COMPANY_NAME = 'Emigeo Homes Real Estate LLC';
export const COMPANY_LOCALITY_EN = 'Dubai & Abu Dhabi';
export const COMPANY_LOCALITY_AR = 'دبي وأبوظبي';

/** Business constants that the workflows and guards depend on. */

export const TIMEZONE = 'Asia/Dubai';

/**
 * Asia/Dubai is UTC+4 all year — the UAE has not observed daylight saving since
 * 1990. Reporting SQL adds this offset directly instead of calling CONVERT_TZ,
 * which silently returns NULL on a server whose timezone tables were never
 * loaded, and that is a common default on shared hosting.
 */
export const TIMEZONE_UTC_OFFSET_HOURS = 4;

/** Speed-to-lead target: the specification asks for a first reply inside 30s. */
export const SPEED_TO_LEAD_TARGET_SECONDS = 30;

/** Quiet hours: no automated messages between 22:00 and 08:00 Asia/Dubai. */
export const QUIET_HOURS = { startHour: 22, endHour: 8 } as const;

/** At most 3 automated messages per contact per 24 hours. */
export const MAX_AUTOMATED_MESSAGES_PER_24H = 3;

/** The bot pauses for 24 hours after an agent sends a manual message. */
export const BOT_PAUSE_AFTER_HUMAN_MS = 24 * 60 * 60 * 1000;

/** WhatsApp customer service window. */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Workflow A SLA: reassign if the agent has not touched the lead in 5 minutes. */
export const SLA_FIRST_TOUCH_MS = 5 * 60 * 1000;

/** A re-inquiry within this window on the same project does not open a new opportunity. */
export const REINQUIRY_WINDOW_DAYS = 30;

/** Session lifetimes. */
export const SESSION_TTL_REMEMBER_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_DEFAULT_MS = 12 * 60 * 60 * 1000;

/** Brute-force protection. */
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

/** Lead score at or above this is `hot`. */
export const HOT_SCORE_THRESHOLD = 70;

/** Inbox collision guard: soft lock while an agent is replying. */
export const REPLY_LOCK_MS = 90 * 1000;

/** Default phone region for libphonenumber parsing. */
export const DEFAULT_PHONE_REGION = 'AE';
