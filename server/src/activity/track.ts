/**
 * Recording who is working, and noticing the sign-in that does not belong.
 *
 * Two writes per sign-in: the session itself gains the device and the city
 * so Team Activity can read it, and `session_log` gets a row that outlives
 * the session — a session is deleted on logout, and the history of who was
 * in the CRM last Tuesday has to survive that.
 */
import { randomUUID } from 'node:crypto';
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { logger, errorContext } from '../lib/logger.js';
import { deviceKey, networkOf, parseDevice } from './device.js';
import { flagsFor, worstLevel, type SessionFlag } from './flags.js';
import { lookupLocation } from './geoip.js';

export interface SignInContext {
  userId: string;
  userName: string;
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Record a sign-in and work out whether anything about it is odd.
 *
 * Never allowed to fail the sign-in. An agent locked out of the CRM because
 * the activity log had a bad day is a worse outcome than a missing row.
 */
export async function recordSignIn(
  context: SignInContext,
  exec: Executor = getPool(),
): Promise<SessionFlag[]> {
  try {
    const device = parseDevice(context.userAgent);
    const key = deviceKey(context.userAgent);
    const network = networkOf(context.ip);
    const location = await lookupLocation(context.ip);

    /* What this person has done before, so "new" means something. */
    const history = await query<{ device_key: string | null; network: string | null; country: string | null }>(
      `SELECT DISTINCT device_key, network, country FROM session_log
        WHERE user_id = ? AND signed_in_at > DATE_SUB(NOW(3), INTERVAL 180 DAY)
        LIMIT 200`,
      [context.userId],
      exec,
    );

    const previous = await queryOne<{ signed_in_at: Date; country: string | null; city: string | null }>(
      `SELECT signed_in_at, country, city FROM session_log
        WHERE user_id = ? ORDER BY signed_in_at DESC LIMIT 1`,
      [context.userId],
      exec,
    );

    const flags = flagsFor({
      userName: context.userName,
      deviceKey: key,
      deviceLabel: device.label,
      network,
      city: location.city,
      country: location.country,
      at: new Date(),
      knownDevices: history.map((row) => row.device_key).filter(Boolean) as string[],
      knownNetworks: history.map((row) => row.network).filter(Boolean) as string[],
      knownCountries: history.map((row) => row.country).filter(Boolean) as string[],
      previous: previous
        ? { at: new Date(previous.signed_in_at), country: previous.country, city: previous.city }
        : null,
      firstEver: history.length === 0,
    });

    await execute(
      `UPDATE sessions SET device_key = ?, device_label = ?, city = ?, country = ? WHERE id = ?`,
      [key, device.label, location.city, location.country, context.sessionId],
      exec,
    );

    await execute(
      `INSERT INTO session_log
         (id, user_id, session_id, ip, network, device_key, device_label, city, country, flags, level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(), context.userId, context.sessionId, context.ip, network, key, device.label,
        location.city, location.country,
        flags.length ? JSON.stringify(flags) : null,
        worstLevel(flags) ?? 'none',
      ],
      exec,
    );

    if (flags.some((flag) => flag.level === 'alarm')) {
      logger.warn('a sign-in looked wrong', {
        userId: context.userId,
        flags: flags.map((flag) => flag.key),
      });
    }

    return flags;
  } catch (err) {
    /* Never fail the sign-in over this. */
    logger.warn('could not record a sign-in', errorContext(err));
    return [];
  }
}

/**
 * The browser says it is still there.
 *
 * `active_seconds` only grows by the gap since the last beat, and only when
 * that gap is short. A laptop left open over a weekend sends nothing, so the
 * next beat is three days later and must not count as three days of work —
 * that is how every "hours worked" report becomes a lie.
 */
export const HEARTBEAT_MAX_GAP_SECONDS = 120;

export async function heartbeat(
  sessionId: string,
  path: string | null,
  exec: Executor = getPool(),
): Promise<void> {
  await execute(
    `UPDATE sessions SET last_seen_at = NOW(3), current_path = ? WHERE id = ?`,
    [path ? path.slice(0, 160) : null, sessionId],
    exec,
  );

  await execute(
    `UPDATE session_log
        SET active_seconds = active_seconds + LEAST(
              TIMESTAMPDIFF(SECOND, last_seen_at, NOW(3)), ?),
            last_seen_at = NOW(3)
      WHERE session_id = ? AND signed_out_at IS NULL`,
    [HEARTBEAT_MAX_GAP_SECONDS, sessionId],
    exec,
  );
}

export async function recordSignOut(sessionId: string, exec: Executor = getPool()): Promise<void> {
  await execute(
    `UPDATE session_log SET signed_out_at = NOW(3)
      WHERE session_id = ? AND signed_out_at IS NULL`,
    [sessionId],
    exec,
  ).catch((err: unknown) => logger.warn('could not record a sign-out', errorContext(err)));
}
