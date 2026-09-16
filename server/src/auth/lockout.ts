import { execute, queryOne, type Executor, getPool } from '../db/client.js';
import { LOGIN_LOCKOUT_MS, LOGIN_MAX_ATTEMPTS } from '../config/constants.js';

/** Per-IP rate limit, independent of the per-account lockout. */
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_FAILURES = 30;

export type LockState = { locked: boolean; until: Date | null; remainingAttempts: number };

export async function recordLoginAttempt(
  email: string,
  ip: string | null,
  successful: boolean,
  exec: Executor = getPool(),
): Promise<void> {
  await execute('INSERT INTO login_attempts (email, ip, successful) VALUES (?, ?, ?)', [email, ip, successful ? 1 : 0], exec);
}

/** Lock the account for 15 minutes after 5 failed attempts. */
export async function registerFailure(email: string, exec: Executor = getPool()): Promise<LockState> {
  await execute(
    `UPDATE users
        SET failed_login_count = failed_login_count + 1,
            locked_until = CASE WHEN failed_login_count + 1 >= ? THEN DATE_ADD(NOW(3), INTERVAL ? SECOND) ELSE locked_until END
      WHERE email = ?`,
    [LOGIN_MAX_ATTEMPTS, Math.floor(LOGIN_LOCKOUT_MS / 1000), email],
    exec,
  );
  return getLockState(email, exec);
}

export async function clearFailures(userId: string, exec: Executor = getPool()): Promise<void> {
  await execute('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW(3) WHERE id = ?', [userId], exec);
}

export async function getLockState(email: string, exec: Executor = getPool()): Promise<LockState> {
  const row = await queryOne<{ failed_login_count: number; locked_until: Date | null }>(
    'SELECT failed_login_count, locked_until FROM users WHERE email = ?',
    [email],
    exec,
  );
  if (!row) return { locked: false, until: null, remainingAttempts: LOGIN_MAX_ATTEMPTS };
  const locked = Boolean(row.locked_until && row.locked_until.getTime() > Date.now());
  return {
    locked,
    until: locked ? row.locked_until : null,
    remainingAttempts: Math.max(0, LOGIN_MAX_ATTEMPTS - row.failed_login_count),
  };
}

/** True when this IP has produced too many failures recently. */
export async function isIpRateLimited(ip: string | null, exec: Executor = getPool()): Promise<boolean> {
  if (!ip) return false;
  const row = await queryOne<{ failures: number }>(
    `SELECT COUNT(*) AS failures FROM login_attempts
      WHERE ip = ? AND successful = 0 AND created_at > DATE_SUB(NOW(3), INTERVAL ? SECOND)`,
    [ip, Math.floor(IP_WINDOW_MS / 1000)],
    exec,
  );
  return Number(row?.failures ?? 0) >= IP_MAX_FAILURES;
}

export async function purgeOldLoginAttempts(exec: Executor = getPool()): Promise<number> {
  const result = await execute('DELETE FROM login_attempts WHERE created_at < DATE_SUB(NOW(3), INTERVAL 30 DAY)', [], exec);
  return result.affectedRows;
}
