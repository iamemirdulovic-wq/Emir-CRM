/** Business constants that the workflows and guards depend on. */

export const TIMEZONE = 'Asia/Dubai';

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
