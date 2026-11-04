/**
 * Reading and writing one agent's welcome.
 *
 * Scoped to the caller by construction everywhere but `listForOwner`: the
 * user id comes from the session, never from the request body, so there is no
 * path by which one agent reads or writes another's answers. `listForOwner`
 * is the single exception and its route checks the role.
 */
import { execute, query, queryOne, type Executor, getPool } from '../db/client.js';
import { cleanAnswers, isComplete, type OnboardingQuestion } from './questions.js';

export interface OnboardingRow {
  user_id: string;
  preferred_name: string | null;
  answers: unknown;
  completed_at: Date | null;
  skipped_at: Date | null;
}

export interface OnboardingState {
  preferredName: string | null;
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
    'SELECT user_id, preferred_name, answers, completed_at, skipped_at FROM user_onboarding WHERE user_id = ?',
    [userId],
    exec,
  );
  return {
    preferredName: row?.preferred_name ?? null,
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
  input: { preferredName?: string | null; answers?: unknown; skip?: boolean },
  exec: Executor = getPool(),
): Promise<OnboardingState> {
  const current = await getOnboarding(userId, exec);
  const answers = { ...current.answers, ...cleanAnswers(input.answers) };
  const name = input.preferredName === undefined
    ? current.preferredName
    : (input.preferredName?.trim().slice(0, 80) || null);

  const done = isComplete(answers);
  const skipped = done ? false : (input.skip ?? current.skipped);

  await execute(
    `INSERT INTO user_onboarding (user_id, preferred_name, answers, completed_at, skipped_at)
     VALUES (?, ?, ?, ${done ? 'NOW(3)' : 'NULL'}, ${skipped ? 'NOW(3)' : 'NULL'})
     ON DUPLICATE KEY UPDATE
       preferred_name = VALUES(preferred_name),
       answers        = VALUES(answers),
       completed_at   = ${done ? 'COALESCE(completed_at, NOW(3))' : 'NULL'},
       skipped_at     = ${skipped ? 'COALESCE(skipped_at, NOW(3))' : 'NULL'}`,
    [userId, name, JSON.stringify(answers)],
    exec,
  );

  return { preferredName: name, answers, completed: done, skipped };
}

export interface AgentWelcome {
  userId: string;
  name: string;
  preferredName: string | null;
  email: string;
  role: string;
  isActive: boolean;
  answers: Record<string, string>;
  completedAt: Date | null;
  skippedAt: Date | null;
}

/**
 * Everyone's answers, for the owner's screen.
 *
 * Includes people who have not answered, because "who has not done it" is
 * most of what the screen is for. The route checks the role; this does not.
 */
export async function listForOwner(exec: Executor = getPool()): Promise<AgentWelcome[]> {
  const rows = await query<{
    id: string; name: string; email: string; role: string; is_active: number;
    preferred_name: string | null; answers: unknown;
    completed_at: Date | null; skipped_at: Date | null;
  }>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active,
            o.preferred_name, o.answers, o.completed_at, o.skipped_at
       FROM users u
       LEFT JOIN user_onboarding o ON o.user_id = u.id
      WHERE u.role <> 'automation'
      ORDER BY u.is_active DESC, o.completed_at IS NULL, u.name`,
    [],
    exec,
  );

  return rows.map((row) => ({
    userId: row.id,
    name: row.name,
    preferredName: row.preferred_name,
    email: row.email,
    role: row.role,
    isActive: row.is_active === 1,
    answers: readAnswers(row.answers),
    completedAt: row.completed_at,
    skippedAt: row.skipped_at,
  }));
}

export type { OnboardingQuestion };
