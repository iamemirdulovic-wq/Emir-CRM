/**
 * Reading and writing one agent's welcome.
 *
 * Scoped to the caller by construction everywhere but `listForOwner`: the
 * user id comes from the session, never from the request body, so there is no
 * path by which one agent reads or writes another's answers. `listForOwner`
 * is the single exception and its route checks the role.
 */
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import {
  cleanAnswers, cleanAvatarSet, isComplete,
  type AvatarSet, type OnboardingQuestion,
} from './questions.js';

export interface OnboardingRow {
  user_id: string;
  preferred_name: string | null;
  avatar_set: string | null;
  answers: unknown;
  completed_at: Date | null;
  skipped_at: Date | null;
}

export interface OnboardingState {
  preferredName: string | null;
  /** Which set of illustrations the welcome shows. Null until they pick. */
  avatarSet: AvatarSet | null;
  answers: Record<string, string>;
  completed: boolean;
  skipped: boolean;
}

/* mysql2 gives a JSON column back already parsed, but a row written before the
   column existed, or by hand, can still be a string. Both are handled rather
   than trusting one. */
function readAnswers(value: unknown): Record<string, string> {
  if (typeof value === 'string') {
    try { return cleanAnswers(JSON.parse(value)); } catch { return {}; }
  }
  return cleanAnswers(value);
}

export async function getOnboarding(
  userId: string,
  exec: Executor = getPool(),
): Promise<OnboardingState> {
  const row = await queryOne<OnboardingRow>(
    `SELECT user_id, preferred_name, avatar_set, answers, completed_at, skipped_at
       FROM user_onboarding WHERE user_id = ?`,
    [userId],
    exec,
  );
  return {
    preferredName: row?.preferred_name ?? null,
    avatarSet: cleanAvatarSet(row?.avatar_set),
    answers: readAnswers(row?.answers),
    completed: Boolean(row?.completed_at),
    skipped: Boolean(row?.skipped_at),
  };
}

/**
 * Save progress.
 *
 * Answers are merged, not replaced, so a half-finished welcome picked up on a
 * different device adds to what is there instead of wiping it. Finishing
 * clears `skipped_at`: somebody who put it off and later came back has not
 * skipped it.
 */
export async function saveOnboarding(
  userId: string,
  input: {
    preferredName?: string | null;
    avatarSet?: unknown;
    answers?: unknown;
    skip?: boolean;
  },
  exec: Executor = getPool(),
): Promise<OnboardingState> {
  const current = await getOnboarding(userId, exec);
  const answers = { ...current.answers, ...cleanAnswers(input.answers) };
  const name = input.preferredName === undefined
    ? current.preferredName
    : (input.preferredName?.trim().slice(0, 80) || null);
  /* Left alone when the step is not the one being saved, so a later step
     does not wipe the picture they already chose. */
  const avatarSet = input.avatarSet === undefined
    ? current.avatarSet
    : cleanAvatarSet(input.avatarSet);

  const done = isComplete(answers);
  const skipped = done ? false : (input.skip ?? current.skipped);

  await execute(
    `INSERT INTO user_onboarding
       (user_id, preferred_name, avatar_set, answers, completed_at, skipped_at)
     VALUES (?, ?, ?, ?, ${done ? 'NOW(3)' : 'NULL'}, ${skipped ? 'NOW(3)' : 'NULL'})
     ON DUPLICATE KEY UPDATE
       preferred_name = VALUES(preferred_name),
       avatar_set     = VALUES(avatar_set),
       answers        = VALUES(answers),
       completed_at   = ${done ? 'COALESCE(completed_at, NOW(3))' : 'NULL'},
       skipped_at     = ${skipped ? 'COALESCE(skipped_at, NOW(3))' : 'NULL'}`,
    [userId, name, avatarSet, JSON.stringify(answers)],
    exec,
  );

  return { preferredName: name, avatarSet, answers, completed: done, skipped };
}

export interface AgentWelcome {
  userId: string;
  name: string;
  preferredName: string | null;
  email: string;
  role: string;
  isActive: boolean;
  jobTitle: string | null;
  photoUrl: string | null;
  headline: string | null;
  /** Of the fields a client actually sees, how many are filled in. */
  profileFilled: number;
  profileTotal: number;
  /** The empty ones, in the words the profile page uses for them. */
  profileMissing: string[];
  answers: Record<string, string>;
  completedAt: Date | null;
  skippedAt: Date | null;
}

/*
 * What counts as a finished profile.
 *
 * Only the fields a client sees on a business card or an offer. WhatsApp and
 * the social links are extras — chasing somebody for an Instagram handle is
 * how a completeness number stops meaning anything.
 */
const PROFILE_FIELDS: Array<{ label: string; of: (row: ProfileBits) => unknown }> = [
  { label: 'photo', of: (row) => row.photo_url },
  { label: 'job title', of: (row) => row.job_title },
  { label: 'headline', of: (row) => row.headline },
  { label: 'about them', of: (row) => row.bio },
  { label: 'languages', of: (row) => jsonList(row.languages).length || null },
  { label: 'what they sell', of: (row) => jsonList(row.specialities).length || null },
  { label: 'phone for clients', of: (row) => row.public_phone },
  { label: 'email for clients', of: (row) => row.public_email },
];

interface ProfileBits {
  job_title: string | null;
  photo_url: string | null;
  headline: string | null;
  bio: string | null;
  languages: unknown;
  specialities: unknown;
  public_phone: string | null;
  public_email: string | null;
}

/* A JSON column, so it arrives parsed, as a string, or as null. */
function jsonList(value: unknown): string[] {
  const raw = typeof value === 'string'
    ? ((): unknown => { try { return JSON.parse(value); } catch { return []; } })()
    : value;
  return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
}

function missingFrom(row: ProfileBits): string[] {
  return PROFILE_FIELDS
    .filter((field) => {
      const value = field.of(row);
      return value === null || value === undefined || value === '';
    })
    .map((field) => field.label);
}

/**
 * Everyone's answers, for the owner's screen.
 *
 * Includes people who have not answered, because "who has not done it" is
 * most of what the screen is for. The route checks the role; this does not.
 */
export async function listForOwner(exec: Executor = getPool()): Promise<AgentWelcome[]> {
  const rows = await query<ProfileBits & {
    id: string; name: string; email: string; role: string; is_active: number;
    preferred_name: string | null; answers: unknown;
    completed_at: Date | null; skipped_at: Date | null;
  }>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active, u.job_title, u.photo_url,
            p.headline, p.bio, p.languages, p.specialities,
            p.public_phone, p.public_email,
            o.preferred_name, o.answers, o.completed_at, o.skipped_at
       FROM users u
       LEFT JOIN user_onboarding o ON o.user_id = u.id
       LEFT JOIN agent_profiles p ON p.user_id = u.id
      WHERE u.role <> 'automation'
      ORDER BY u.is_active DESC, o.completed_at IS NULL, u.name`,
    [],
    exec,
  );

  return rows.map((row) => {
    const missing = missingFrom(row);
    return {
      userId: row.id,
      name: row.name,
      preferredName: row.preferred_name,
      email: row.email,
      role: row.role,
      isActive: row.is_active === 1,
      jobTitle: row.job_title,
      photoUrl: row.photo_url,
      headline: row.headline,
      profileFilled: PROFILE_FIELDS.length - missing.length,
      profileTotal: PROFILE_FIELDS.length,
      profileMissing: missing,
      answers: readAnswers(row.answers),
      completedAt: row.completed_at,
      skippedAt: row.skipped_at,
    };
  });
}

export type { OnboardingQuestion };
