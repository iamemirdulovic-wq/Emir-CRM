import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { hashToken } from '../lib/crypto.js';
import { newToken } from '../lib/ids.js';
import { SESSION_TTL_DEFAULT_MS, SESSION_TTL_REMEMBER_MS } from '../config/constants.js';
import type { Role } from './rbac.js';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  managerId: string | null;
  locale: string;
};

export type CreatedSession = { token: string; expiresAt: Date };

/**
 * Sessions live server-side in MySQL. The cookie carries a random token; the
 * table stores only its SHA-256, so a database leak does not yield live
 * sessions.
 */
export async function createSession(
  userId: string,
  opts: { rememberMe?: boolean; ip?: string | null; userAgent?: string | null } = {},
  exec: Executor = getPool(),
): Promise<CreatedSession> {
  const token = newToken(32);
  const ttl = opts.rememberMe ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_DEFAULT_MS;
  const expiresAt = new Date(Date.now() + ttl);
  await execute(
    `INSERT INTO sessions (id, user_id, expires_at, remember_me, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [hashToken(token), userId, expiresAt, opts.rememberMe ? 1 : 0, opts.ip ?? null, (opts.userAgent ?? '').slice(0, 500) || null],
    exec,
  );
  return { token, expiresAt };
}

type SessionRow = {
  session_id: string;
  expires_at: Date;
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: number;
  must_change_password: number;
  manager_id: string | null;
  locale: string;
};

/** Resolve a cookie token to a live user, or null. Also refreshes last_seen_at. */
export async function resolveSession(
  token: string | undefined | null,
  exec: Executor = getPool(),
): Promise<{ user: SessionUser; sessionId: string; expiresAt: Date } | null> {
  if (!token) return null;
  const id = hashToken(token);
  const row = await queryOne<SessionRow>(
    `SELECT s.id AS session_id, s.expires_at,
            u.id, u.name, u.email, u.role, u.is_active, u.must_change_password, u.manager_id, u.locale
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > NOW(3)`,
    [id],
    exec,
  );
  // A deactivated user's sessions are destroyed on deactivation, but we check
  // again here so a race can never leave a disabled account signed in.
  if (!row || row.is_active !== 1) return null;

  await execute('UPDATE sessions SET last_seen_at = NOW(3) WHERE id = ?', [id], exec);
  return {
    sessionId: row.session_id,
    expiresAt: row.expires_at,
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      isActive: true,
      mustChangePassword: row.must_change_password === 1,
      managerId: row.manager_id,
      locale: row.locale,
    },
  };
}

/** Logout deletes the session. */
export async function destroySession(token: string | undefined | null, exec: Executor = getPool()): Promise<void> {
  if (!token) return;
  await execute('DELETE FROM sessions WHERE id = ?', [hashToken(token)], exec);
}

/** Deactivating a user ends all of that user's sessions immediately. */
export async function destroyAllSessionsForUser(userId: string, exec: Executor = getPool()): Promise<number> {
  const result = await execute('DELETE FROM sessions WHERE user_id = ?', [userId], exec);
  return result.affectedRows;
}

export async function purgeExpiredSessions(exec: Executor = getPool()): Promise<number> {
  const result = await execute('DELETE FROM sessions WHERE expires_at <= NOW(3)', [], exec);
  return result.affectedRows;
}

export async function listSessionsForUser(userId: string, exec: Executor = getPool()) {
  return query<{ id: string; ip: string | null; user_agent: string | null; created_at: Date; last_seen_at: Date; expires_at: Date }>(
    `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at
       FROM sessions WHERE user_id = ? AND expires_at > NOW(3) ORDER BY last_seen_at DESC`,
    [userId],
    exec,
  );
}
