/**
 * Why a lead ended up with this agent, said the way a person would say it.
 *
 * The lead's history is read by agents and by the owner, not by programmers.
 * It used to be built as `Assigned by ${reason}` straight from the routing
 * code's own word, so the timeline carried lines like **"Assigned by
 * sticky_owner"** and "Assigned by language_and_project" — one of the two
 * places did not even take the underscores out. Emir, 13 Nov: that phrase
 * goes.
 *
 * The machine-readable reason is untouched: it still goes into the activity's
 * `meta.reason` and into the audit entry, so every report and every test that
 * counts how leads were routed reads exactly what it read before. This only
 * changes the sentence a human sees.
 */

/** The routing reasons `chooseAgent` and the sticky-owner rule produce. */
const ROUTED: Record<string, string> = {
  /* A returning client goes back to the agent who already knows them. */
  sticky_owner: 'Back to the agent who dealt with them before',
  language_and_project: 'Given to an agent who speaks their language and knows the project',
  project: 'Given to an agent who knows the project',
  language: 'Given to an agent who speaks their language',
  round_robin: 'Given to the next agent in turn',
};

/** The reasons a batch hand-out passes in (imports, lists, bulk actions). */
const BATCH: Record<string, string> = {
  'bulk import': 'Given out with an imported list',
  'bulk action': 'Given out by hand',
  'agent left': 'Moved on because their agent left',
};

/**
 * One line for the lead's timeline.
 *
 * Anything this does not recognise is wrapped in a sentence rather than
 * printed raw, because the batch reasons are written by the caller and include
 * free text — `untouched for 30 days on "Expo 2026"`, for instance, which
 * reads properly after "Moved on:" and read as nonsense after "Assigned by".
 * Underscores are turned into spaces as a last resort so that a reason nobody
 * has mapped yet still comes out as words.
 */
export function assignmentTitle(reason: string | null | undefined): string {
  const key = (reason ?? '').trim();
  if (!key) return 'Given to an agent';

  const routed = ROUTED[key] ?? BATCH[key];
  if (routed) return routed;

  if (/^untouched for /i.test(key)) return `Moved on — ${key}`;

  return `Given to an agent — ${key.replace(/_/g, ' ')}`;
}
