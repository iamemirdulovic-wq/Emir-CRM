/**
 * Lead assignment for Workflow A.
 *
 * Sticky owner first; otherwise weighted round-robin over agents who are
 * active, available and on shift, preferring agents who speak the lead's
 * language and cover the project.
 *
 * The selection rule is pure so it can be tested exhaustively; the caller does
 * the `SELECT … FOR UPDATE` that makes it safe under concurrency.
 */

export type Candidate = {
  id: string;
  name: string;
  isActive: boolean;
  availability: 'available' | 'busy' | 'off';
  shiftStart: string | null;
  shiftEnd: string | null;
  languages: string[];
  projectsCovered: string[];
  /** Relative share of the round-robin. Higher takes more leads. */
  weight: number;
  /** Leads already assigned in the current window, used to balance the split. */
  assignedCount: number;
};

export type AssignmentRequest = {
  language: string | null;
  projectName: string | null;
  /** Local time in Asia/Dubai, as minutes past midnight. */
  dubaiMinutes: number;
};

export type AssignmentChoice =
  | { assigned: true; userId: string; reason: string; matchedLanguage: boolean; matchedProject: boolean }
  | { assigned: false; reason: string };

/** Is this agent on shift right now? No shift recorded means always on. */
export function isOnShift(candidate: Candidate, dubaiMinutes: number): boolean {
  if (!candidate.shiftStart || !candidate.shiftEnd) return true;
  const start = toMinutes(candidate.shiftStart);
  const end = toMinutes(candidate.shiftEnd);
  if (start === null || end === null) return true;
  // A shift that ends before it starts runs through midnight.
  if (end <= start) return dubaiMinutes >= start || dubaiMinutes < end;
  return dubaiMinutes >= start && dubaiMinutes < end;
}

function toMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function isEligible(candidate: Candidate, dubaiMinutes: number): boolean {
  return candidate.isActive && candidate.availability === 'available' && isOnShift(candidate, dubaiMinutes);
}

const normalize = (value: string): string =>
  value.toLowerCase().trim().replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

export function speaksLanguage(candidate: Candidate, language: string | null): boolean {
  if (!language) return false;
  return candidate.languages.some((l) => l.toLowerCase() === language.toLowerCase());
}

export function coversProject(candidate: Candidate, projectName: string | null): boolean {
  if (!projectName) return false;
  const needle = normalize(projectName);
  return candidate.projectsCovered.some((p) => {
    const covered = normalize(p);
    return covered === needle || needle.startsWith(`${covered} `) || covered.startsWith(`${needle} `);
  });
}

/**
 * Pick the next agent.
 *
 * Preference tiers, best first:
 *   1. speaks the language AND covers the project
 *   2. covers the project
 *   3. speaks the language
 *   4. anyone eligible
 *
 * Within a tier the winner is the agent furthest below their weighted share —
 * that is what makes the split follow the weights over time rather than just
 * rotating.
 */
export function chooseAgent(candidates: Candidate[], request: AssignmentRequest): AssignmentChoice {
  const eligible = candidates.filter((c) => isEligible(c, request.dubaiMinutes) && c.weight > 0);
  if (eligible.length === 0) {
    return { assigned: false, reason: 'no_agent_available' };
  }

  const tiers: Array<{ name: string; members: Candidate[] }> = [
    {
      name: 'language_and_project',
      members: eligible.filter((c) => speaksLanguage(c, request.language) && coversProject(c, request.projectName)),
    },
    { name: 'project', members: eligible.filter((c) => coversProject(c, request.projectName)) },
    { name: 'language', members: eligible.filter((c) => speaksLanguage(c, request.language)) },
    { name: 'round_robin', members: eligible },
  ];

  const tier = tiers.find((t) => t.members.length > 0);
  if (!tier) return { assigned: false, reason: 'no_agent_available' };

  const winner = leastLoaded(tier.members);
  return {
    assigned: true,
    userId: winner.id,
    reason: tier.name,
    matchedLanguage: speaksLanguage(winner, request.language),
    matchedProject: coversProject(winner, request.projectName),
  };
}

/**
 * The agent with the lowest load-per-unit-of-weight. Ties break on the lowest
 * raw count, then on id, so the choice is deterministic.
 */
function leastLoaded(members: Candidate[]): Candidate {
  return [...members].sort((a, b) => {
    const ratioA = a.assignedCount / a.weight;
    const ratioB = b.assignedCount / b.weight;
    if (ratioA !== ratioB) return ratioA - ratioB;
    if (a.assignedCount !== b.assignedCount) return a.assignedCount - b.assignedCount;
    return a.id < b.id ? -1 : 1;
  })[0] as Candidate;
}
