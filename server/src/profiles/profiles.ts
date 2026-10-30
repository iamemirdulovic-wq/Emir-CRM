/**
 * An agent's own page, and the stats on it.
 *
 * The stats are not editable. An agent can write their own bio and choose a
 * cover; they cannot type in how many deals they have done. A profile where
 * the numbers are typed is a profile nobody believes, including the person
 * whose profile it is.
 */
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { writeAudit, type AuditActor } from '../audit/audit.js';
import { COVERS } from './covers.js';

export interface ProfileRow {
  user_id: string;
  slug: string;
  headline: string | null;
  bio: string | null;
  cover_key: string;
  languages: unknown;
  specialities: unknown;
  public_phone: string | null;
  public_email: string | null;
  whatsapp: string | null;
  instagram: string | null;
  linkedin: string | null;
  joined_on: string | null;
  is_public: number;
  /* From users, joined. */
  name: string;
  email: string;
  job_title: string | null;
  brn: string | null;
  photo_url: string | null;
  phone_e164: string | null;
  role: string;
}

/**
 * A slug for a person's card.
 *
 * Their name, and a number only if somebody already has it. Two agents called
 * Sara get `sara-ahmed` and `sara-ahmed-2`, which is ugly but honest — better
 * than a random string nobody can read out over the phone.
 */
export async function uniqueSlug(name: string, userId: string, exec: Executor = getPool()): Promise<string> {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'agent';

  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const taken = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM agent_profiles WHERE slug = ?',
      [candidate],
      exec,
    );
    if (!taken || taken.user_id === userId) return candidate;
  }
  return `${base}-${userId.slice(0, 6)}`;
}

/** The profile, making one with sensible defaults if there is none yet. */
export async function getOrCreateProfile(userId: string): Promise<ProfileRow | null> {
  const user = await queryOne<{ id: string; name: string; role: string }>(
    'SELECT id, name, role FROM users WHERE id = ? AND is_active = 1',
    [userId],
  );
  if (!user) return null;

  const existing = await loadProfile(userId);
  if (existing) return existing;

  /* The cover is picked from the user id rather than at random, so the same
     person always gets the same one and two colleagues rarely clash. */
  const index = [...userId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % COVERS.length;

  await execute(
    `INSERT INTO agent_profiles (user_id, slug, cover_key, joined_on)
     VALUES (?, ?, ?, (SELECT DATE(created_at) FROM users WHERE id = ?))
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId, await uniqueSlug(user.name, userId), (COVERS[index] as { key: string }).key, userId],
  );
  return loadProfile(userId);
}

export async function loadProfile(userId: string, exec: Executor = getPool()): Promise<ProfileRow | null> {
  return queryOne<ProfileRow>(
    `SELECT p.user_id, p.slug, p.headline, p.bio, p.cover_key, p.languages, p.specialities,
            p.public_phone, p.public_email, p.whatsapp, p.instagram, p.linkedin, p.joined_on,
            p.is_public,
            u.name, u.email, u.job_title, u.brn, u.photo_url, u.phone_e164, u.role
       FROM agent_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ? AND u.is_active = 1`,
    [userId],
    exec,
  );
}

/** By slug, for the public card. Only a profile that has been switched on. */
export async function loadPublicProfile(slug: string, exec: Executor = getPool()): Promise<ProfileRow | null> {
  return queryOne<ProfileRow>(
    `SELECT p.user_id, p.slug, p.headline, p.bio, p.cover_key, p.languages, p.specialities,
            p.public_phone, p.public_email, p.whatsapp, p.instagram, p.linkedin, p.joined_on,
            p.is_public,
            u.name, u.email, u.job_title, u.brn, u.photo_url, u.phone_e164, u.role
       FROM agent_profiles p
       JOIN users u ON u.id = p.user_id
      WHERE p.slug = ? AND p.is_public = 1 AND u.is_active = 1`,
    [slug],
    exec,
  );
}

export interface ProfileStats {
  leadsWorking: number;
  dealsWon: number;
  appointments: number;
  /** Median seconds to first reply, over the last 90 days. */
  speedToLeadSeconds: number | null;
  monthsHere: number;
}

/**
 * The numbers on a profile, all counted.
 *
 * Deliberately a short list, and deliberately not a lead count: "working 180
 * leads" says nothing good about anybody. Deals, appointments and how fast
 * they answer are the three things that describe how somebody works.
 */
export async function profileStats(userId: string): Promise<ProfileStats> {
  const row = await queryOne<{
    working: number; won: number; appointments: number; months: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM opportunities
         WHERE owner_user_id = ? AND status = 'open' AND deleted_at IS NULL) AS working,
       (SELECT COUNT(*) FROM opportunities
         WHERE owner_user_id = ? AND status = 'won' AND deleted_at IS NULL) AS won,
       (SELECT COUNT(*) FROM activities
         WHERE user_id = ? AND type = 'meeting_booked'
           AND created_at > DATE_SUB(NOW(3), INTERVAL 365 DAY)) AS appointments,
       (SELECT TIMESTAMPDIFF(MONTH, created_at, NOW(3)) FROM users WHERE id = ?) AS months`,
    [userId, userId, userId, userId],
  );

  /* The median rather than the mean: one lead answered three days late drags
     an average into uselessness and says nothing about the usual day. */
  const times = await query<{ seconds: number }>(
    `SELECT TIMESTAMPDIFF(SECOND, o.created_at, o.last_contact_at) AS seconds
       FROM opportunities o
      WHERE o.owner_user_id = ? AND o.last_contact_at IS NOT NULL
        AND o.created_at > DATE_SUB(NOW(3), INTERVAL 90 DAY)
        AND o.last_contact_at >= o.created_at
      ORDER BY seconds`,
    [userId],
  );

  const median = times.length
    ? Number(times[Math.floor(times.length / 2)]?.seconds ?? 0)
    : null;

  return {
    leadsWorking: Number(row?.working ?? 0),
    dealsWon: Number(row?.won ?? 0),
    appointments: Number(row?.appointments ?? 0),
    speedToLeadSeconds: median,
    monthsHere: Number(row?.months ?? 0),
  };
}

export interface ProfilePatch {
  headline?: string | null;
  bio?: string | null;
  coverKey?: string;
  languages?: string[];
  specialities?: string[];
  publicPhone?: string | null;
  publicEmail?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  linkedin?: string | null;
  isPublic?: boolean;
  jobTitle?: string | null;
  brn?: string | null;
  photoUrl?: string | null;
}

export async function updateProfile(
  actor: AuditActor,
  userId: string,
  patch: ProfilePatch,
): Promise<boolean> {
  await getOrCreateProfile(userId);

  const sets: string[] = [];
  const args: Array<string | number | null> = [];
  const set = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    args.push(value);
  };

  if (patch.headline !== undefined) set('headline', patch.headline);
  if (patch.bio !== undefined) set('bio', patch.bio);
  if (patch.coverKey !== undefined) {
    /* An unknown key would render as the default anyway, but storing it
       would make the Settings page show a cover that is not selected. */
    const known = COVERS.some((item) => item.key === patch.coverKey);
    set('cover_key', known ? patch.coverKey : (COVERS[0] as { key: string }).key);
  }
  if (patch.languages !== undefined) set('languages', JSON.stringify(patch.languages.slice(0, 12)));
  if (patch.specialities !== undefined) set('specialities', JSON.stringify(patch.specialities.slice(0, 12)));
  if (patch.publicPhone !== undefined) set('public_phone', patch.publicPhone);
  if (patch.publicEmail !== undefined) set('public_email', patch.publicEmail);
  if (patch.whatsapp !== undefined) set('whatsapp', patch.whatsapp);
  if (patch.instagram !== undefined) set('instagram', patch.instagram);
  if (patch.linkedin !== undefined) set('linkedin', patch.linkedin);
  if (patch.isPublic !== undefined) set('is_public', patch.isPublic ? 1 : 0);

  if (sets.length > 0) {
    await execute(`UPDATE agent_profiles SET ${sets.join(', ')} WHERE user_id = ?`, [...args, userId]);
  }

  /* These three live on the user because the email signature reads them. */
  const userSets: string[] = [];
  const userArgs: Array<string | null> = [];
  if (patch.jobTitle !== undefined) {
    userSets.push('job_title = ?');
    userArgs.push(patch.jobTitle);
  }
  if (patch.brn !== undefined) {
    userSets.push('brn = ?');
    userArgs.push(patch.brn);
  }
  if (patch.photoUrl !== undefined) {
    userSets.push('photo_url = ?');
    userArgs.push(patch.photoUrl);
  }
  if (userSets.length > 0) {
    await execute(`UPDATE users SET ${userSets.join(', ')} WHERE id = ?`, [...userArgs, userId]);
  }

  if (sets.length === 0 && userSets.length === 0) return false;

  await writeAudit({
    actor,
    action: 'profile.updated',
    entityType: 'user',
    entityId: userId,
    after: {
      ...(patch.isPublic !== undefined ? { isPublic: patch.isPublic } : {}),
      fields: [...Object.keys(patch)],
    },
  });
  return true;
}
