/**
 * Where a Dubai day starts and ends, as SQL.
 *
 * Every "today" in this product is a Dubai today. The server runs on UTC, so
 * a lead created at 02:00 Dubai belongs to that day's figures even though UTC
 * still says yesterday — and an agent reading "3 new leads today" at nine in
 * the morning must not be shown a number that changed at 04:00.
 *
 * Dubai is UTC+4 all year. There is no daylight saving to reason about, which
 * is why this is a fixed offset rather than a timezone library. See CLAUDE.md.
 */
export const DUBAI = "'+04:00'";

/** Midnight at the start of today in Dubai, expressed in UTC. */
export const DAY_START = `CONVERT_TZ(DATE(CONVERT_TZ(NOW(3), '+00:00', ${DUBAI})), ${DUBAI}, '+00:00')`;

/** Midnight at the end of today in Dubai, expressed in UTC. */
export const DAY_END = `DATE_ADD(${DAY_START}, INTERVAL 1 DAY)`;

/** Today's date in Dubai, as the database sees it. */
export const TODAY = `DATE(CONVERT_TZ(NOW(3), '+00:00', ${DUBAI}))`;
