/**
 * Sign-in links.
 *
 * An agent on a phone at a sales centre does not want to type a password, and
 * the ones who do type one choose something they can type — which is the
 * problem. A link proves they can read the inbox the account was created
 * with, which for this team is a stronger claim than anything they would
 * willingly type on a handset.
 *
 * Four rules shape all of it:
 *
 *  1. **Owners and admins keep passwords.** A sign-in link needs working
 *     email. If the CRM's only way in needed email, then the day email breaks
 *     is the day nobody can get in to fix it — including the person who would
 *     fix it. So the roles that can repair the system never depend on it.
 *  2. **The token is never stored.** Only its SHA-256 hash, as with sessions.
 *     A copy of `login_links` is not a set of working keys.
 *  3. **Once, and not for long.** Fifteen minutes, single use, and asking for
 *     a new one kills the old. A link in a browser history or a forwarded
 *     email is already spent.
 *  4. **The answer never says whether the account exists.** Asking for a link
 *     for a stranger's address and asking for one for a colleague's must look
 *     identical from outside, or this becomes a way to enumerate the staff.
 *
 * The decisions are pure functions at the bottom of the file, so the awkward
 * cases are settled in tests rather than argued about from a screenshot.
 */
import { execute, getPool, queryOne, type Executor } from '../db/client.js';
import { newId, newToken } from '../lib/ids.js';
import { hashToken } from '../lib/crypto.js';
import type { Role } from './rbac.js';

/**
 * Long enough to walk to a desk and open the laptop; short enough that a link
 * left in a chat thread is worthless by the time anybody else reads it.
 */
export const LINK_TTL_MS = 15 * 60 * 1000;

/**
 * Who may sign in with a link.
 *
 * Owner and admin are excluded deliberately — see rule 1 above. This is not a
 * permission check on something they lack; it is a floor under the whole CRM.
 */
export function canUseLoginLink(role: Role): boolean {
  return role !== 'owner' && role !== 'admin' && role !== 'automation';
}

export type LinkRejection =
  | 'unknown'
  | 'expired'
  | 'already_used'
  | 'user_inactive'
  | 'role_not_allowed';

export interface LinkRow {
  id: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
}

/**
 * Is this link still good?
 *
 * Separated from the database so every reason a link can fail is tested, and
 * so the order of the checks is visible: used before expired, because a link
 * that was used and has since expired should read as used.
 */
export function checkLink(
  link: LinkRow | null,
  now: Date,
): { ok: true } | { ok: false; why: LinkRejection } {
  if (!link) return { ok: false, why: 'unknown' };
  if (link.used_at) return { ok: false, why: 'already_used' };
  if (link.expires_at.getTime() <= now.getTime()) return { ok: false, why: 'expired' };
  return { ok: true };
}

export interface IssuedLink {
  token: string;
  expiresAt: Date;
}

/**
 * Create a link for a user who has already been found and checked.
 *
 * Any unused link the user already has is expired first. Two live links mean
 * an old email still works after somebody asked for a new one because the
 * first went astray — which is the moment they are most likely to have been
 * phished.
 */
export async function issueLoginLink(
  userId: string,
  ip: string | null,
  exec: Executor = getPool(),
): Promise<IssuedLink> {
  await execute(
    'UPDATE login_links SET expires_at = NOW(3) WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW(3)',
    [userId],
    exec,
  );

  const token = newToken(32);
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  await execute(
    'INSERT INTO login_links (id, user_id, token_hash, expires_at, requested_ip) VALUES (?, ?, ?, ?, ?)',
    [newId(), userId, hashToken(token), expiresAt, ip],
    exec,
  );
  return { token, expiresAt };
}

export interface ConsumedLink {
  userId: string;
}

/**
 * Spend a link, or say why it cannot be spent.
 *
 * The UPDATE is the lock: `used_at IS NULL` in the WHERE and a check on how
 * many rows changed means two requests arriving together cannot both win.
 * Doing it as a read then a write would let a forwarded link be redeemed
 * twice by two people clicking at the same moment.
 */
export async function consumeLoginLink(
  token: string,
  ip: string | null,
  exec: Executor = getPool(),
): Promise<{ ok: true; userId: string; role: Role } | { ok: false; why: LinkRejection }> {
  const link = await queryOne<LinkRow>(
    'SELECT id, user_id, expires_at, used_at FROM login_links WHERE token_hash = ?',
    [hashToken(token)],
    exec,
  );

  const state = checkLink(link ?? null, new Date());
  if (!state.ok) return { ok: false, why: state.why };
  const found = link as LinkRow;

  const user = await queryOne<{ id: string; role: Role; is_active: number }>(
    'SELECT id, role, is_active FROM users WHERE id = ?',
    [found.user_id],
    exec,
  );
  if (!user || user.is_active !== 1) return { ok: false, why: 'user_inactive' };
  /* Checked again here, not only when the link was sent: somebody promoted to
     admin between the two should not finish signing in this way. */
  if (!canUseLoginLink(user.role)) return { ok: false, why: 'role_not_allowed' };

  const spent = await execute(
    'UPDATE login_links SET used_at = NOW(3), used_ip = ? WHERE id = ? AND used_at IS NULL',
    [ip, found.id],
    exec,
  );
  if (spent.affectedRows !== 1) return { ok: false, why: 'already_used' };

  return { ok: true, userId: user.id, role: user.role };
}
