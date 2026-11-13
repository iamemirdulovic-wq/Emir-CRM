/**
 * Team and roles: who can sign in, what they can do, and who gets alerts.
 *
 * `design/web/settings-team.html`. Three tabs, and this is what fills them.
 *
 * It is a separate endpoint from `GET /api/users` on purpose. That one is read
 * by half the CRM — assignment, @mentions, a card that says "assigned to
 * Layla" — so everybody needs it, and it already trims an agent's view down to
 * names. This is the owner's administrative view: email addresses, last
 * sign-in, open-lead counts, whose phone is registered. Guarding `/api/users`
 * would break the screens that only want a name; leaving this on it would hand
 * an agent the whole staff file. So: two endpoints, one guard.
 *
 * Two things the design asks for and the server genuinely cannot know, both
 * written down in `docs/decisions-to-confirm.md`:
 *
 *  - **"Blocked in phone settings" versus "Switched off".** Both are states of
 *    the phone's own notification permission, which the phone never reports
 *    back. What the server has is whether a device ever registered a token. So
 *    there are three states here, not four, and the third says what is true:
 *    no phone registered.
 *  - **A pending invite.** `POST /api/users` makes the account immediately and
 *    hands back a one-time password, because nothing here can send an email.
 *    There is no invited-but-not-yet-joined state to show, so the count the
 *    design puts beside "People" is of people who have never signed in, which
 *    is the same question answered from what we actually have.
 */
import { getPool, query, queryOne, execute, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { badRequest, notFound } from '../lib/errors.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { pushReadiness } from '../services/integration-status.js';

export type AttendanceStatus = 'office' | 'late' | 'outside' | 'leave' | 'absent' | 'off';

export interface Member {
  id: string;
  name: string;
  email: string | null;
  role: string;
  /** "Founder & CEO", "Agent · Dubai off-plan" — the line under the name. */
  title: string | null;
  photoUrl: string | null;
  isActive: boolean;
  /** Never signed in, which is as close to "invite waiting" as we can get. */
  neverSignedIn: boolean;
  lastLoginAt: string | null;
  openLeads: number;
  /** The dot on the avatar. */
  attendance: AttendanceStatus;
  /** 'ios' | 'android' | null — null means no phone has registered. */
  phonePlatform: 'ios' | 'android' | null;
  /** Whether a browser on a computer is registered for alerts. */
  computerAlerts: boolean;
  lastAlertAt: string | null;
  lastAlertOpened: boolean;
}

export interface TeamRoles {
  members: Member[];
  counts: {
    people: number;
    owners: number;
    admins: number;
    managers: number;
    agents: number;
    deactivated: number;
    neverSignedIn: number;
    withAlerts: number;
    withoutAlerts: number;
  };
}

/**
 * The line under a person's name.
 *
 * The design writes "Agent · Dubai off-plan" — the role and the desk. The desk
 * is real (`desks` / `desk_members`, migration 0036) and was simply never read
 * here, which is why every row said the role word twice.
 */
function titleFor(
  jobTitle: string | null, title: string | null, role: string, desk: string | null,
): string | null {
  const written = (jobTitle ?? title ?? '').trim();
  if (written) return desk ? `${written} · ${desk}` : written;
  const word = role === 'agent' ? 'Agent'
    : role === 'manager' ? 'Manager'
      : role === 'admin' ? 'Admin'
        : role === 'owner' ? 'Owner' : role;
  return desk ? `${word} · ${desk}` : word;
}

export async function teamRoles(exec: Executor = getPool()): Promise<TeamRoles> {
  const rows = await query<Record<string, unknown>>(
    `SELECT u.id, u.name, u.email, u.role, u.title, u.job_title AS jobTitle,
            u.photo_url AS photoUrl, u.is_active AS isActive, u.last_login_at AS lastLoginAt,
            (SELECT d.name FROM desk_members dm JOIN desks d ON d.id = dm.desk_id
              WHERE dm.user_id = u.id ORDER BY d.name LIMIT 1) AS deskName,
            (SELECT COUNT(*) FROM opportunities o
              WHERE o.owner_user_id = u.id AND o.status = 'open' AND o.deleted_at IS NULL)
              AS openLeads,
            a.kind AS markedToday, a.was_late AS wasLate,
            EXISTS (SELECT 1 FROM leave_requests l
                     WHERE l.user_id = u.id AND l.status = 'approved'
                       AND DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
                           BETWEEN l.from_date AND l.to_date) AS onLeave,
            (SELECT t.platform FROM push_tokens t
              WHERE t.user_id = u.id AND t.platform IN ('ios','android')
              ORDER BY t.last_used_at DESC LIMIT 1) AS phonePlatform,
            EXISTS (SELECT 1 FROM push_tokens t WHERE t.user_id = u.id AND t.platform = 'web')
              AS computerAlerts,
            (SELECT n.created_at FROM notifications n
              WHERE n.user_id = u.id ORDER BY n.created_at DESC LIMIT 1) AS lastAlertAt,
            (SELECT n.read_at FROM notifications n
              WHERE n.user_id = u.id ORDER BY n.created_at DESC LIMIT 1) AS lastAlertRead
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id
            AND a.on_date = DATE(CONVERT_TZ(NOW(3), '+00:00', '+04:00'))
      WHERE u.role <> 'automation'
      ORDER BY u.is_active DESC, FIELD(u.role, 'owner', 'admin', 'manager', 'agent'), u.name`,
    [],
    exec,
  );

  const members: Member[] = rows.map((row) => {
    const marked = (row.markedToday as string | null) ?? null;
    const onLeave = Number(row.onLeave ?? 0) === 1;
    const attendance: AttendanceStatus = !Number(row.isActive) ? 'off'
      : onLeave ? 'leave'
        : marked === 'outside' ? 'outside'
          : marked === 'office' ? (Number(row.wasLate ?? 0) === 1 ? 'late' : 'office')
            : 'absent';
    return {
      id: String(row.id),
      name: String(row.name),
      email: (row.email as string | null) ?? null,
      role: String(row.role),
      title: titleFor(
        row.jobTitle as string | null, row.title as string | null,
        String(row.role), (row.deskName as string | null) ?? null,
      ),
      photoUrl: (row.photoUrl as string | null) ?? null,
      isActive: Number(row.isActive) === 1,
      neverSignedIn: row.lastLoginAt === null,
      lastLoginAt: row.lastLoginAt ? String(row.lastLoginAt) : null,
      openLeads: Number(row.openLeads ?? 0),
      attendance,
      phonePlatform: (row.phonePlatform as 'ios' | 'android' | null) ?? null,
      computerAlerts: Number(row.computerAlerts ?? 0) === 1,
      lastAlertAt: row.lastAlertAt ? String(row.lastAlertAt) : null,
      lastAlertOpened: Boolean(row.lastAlertRead),
    };
  });

  const live = members.filter((one) => one.isActive);
  const byRole = (role: string) => live.filter((one) => one.role === role).length;
  const withAlerts = live.filter((one) => one.phonePlatform !== null || one.computerAlerts).length;

  return {
    members,
    counts: {
      people: live.length,
      owners: byRole('owner'),
      admins: byRole('admin'),
      managers: byRole('manager'),
      agents: byRole('agent'),
      deactivated: members.length - live.length,
      neverSignedIn: live.filter((one) => one.neverSignedIn).length,
      withAlerts,
      withoutAlerts: live.length - withAlerts,
    },
  };
}

/* ── "Remind" ──────────────────────────────────────────────────────────── */

/**
 * Nudge somebody whose phone is not registered.
 *
 * The design's toast is "Tej sees “Turn on notifications” on My Day", and that
 * is exactly what this does: it writes the line into their bell, which My Day
 * reads. It does not send a push — the whole point is that a push cannot
 * reach them.
 */
export async function remindAboutAlerts(
  actor: AuditActor,
  userIds: string[],
  exec: Executor = getPool(),
): Promise<{ reminded: string[] }> {
  if (userIds.length === 0) throw badRequest('Nobody to remind.');
  const reminded: string[] = [];

  for (const userId of userIds.slice(0, 50)) {
    const person = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM users WHERE id = ? AND is_active = 1', [userId], exec,
    );
    if (!person) continue;
    await execute(
      `INSERT INTO notifications (id, user_id, type, title, body, link, priority)
       VALUES (?, ?, 'alerts.remind', ?, ?, ?, 'normal')`,
      [
        newId(), person.id,
        'Turn on notifications',
        'Without them a VIP lead can run out of time without a sound. It takes one tap.',
        '/v2/settings/phone-app',
      ],
      exec,
    );
    reminded.push(person.name);
  }

  await writeAudit({
    actor, action: 'team.alerts_reminded', entityType: 'user',
    entityId: userIds[0] ?? 'none',
    after: { reminded: reminded.length },
  }, exec);

  return { reminded };
}

/* ── sign out everywhere ───────────────────────────────────────────────── */

/**
 * End every session a person has.
 *
 * The design's row menu offers it next to the password reset, and for the same
 * reason: a laptop left in a taxi is not a reason to change somebody's
 * password, it is a reason to make the laptop forget them.
 */
export async function signOutEverywhere(
  actor: AuditActor,
  userId: string,
  exec: Executor = getPool(),
): Promise<{ sessionsEnded: number; name: string }> {
  const person = await queryOne<{ id: string; name: string }>(
    'SELECT id, name FROM users WHERE id = ?', [userId], exec,
  );
  if (!person) throw notFound('That person is not in the team.');

  const ended = await execute('DELETE FROM sessions WHERE user_id = ?', [userId], exec);
  await writeAudit({
    actor, action: 'user.signed_out_everywhere', entityType: 'user', entityId: userId,
    after: { sessionsEnded: ended.affectedRows },
  }, exec);
  return { sessionsEnded: ended.affectedRows, name: person.name };
}
