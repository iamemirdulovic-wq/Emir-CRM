/**
 * Sharing a batch of leads out between people.
 *
 * Six methods, all pure: given the leads and the candidates, decide who gets
 * what. Nothing here touches the database, so the rules that decide an agent's
 * workload for the month are testable in milliseconds.
 *
 * The round-robin and the splits are deterministic for a given input, which
 * matters more than it sounds: an owner who previews an assignment and then
 * runs it must get the assignment they were shown.
 */

export type AssignmentMethod =
  | 'agent'
  | 'team_round_robin'
  | 'split_even'
  | 'split_percent'
  | 'by_rule'
  | 'pool';

export interface AssignableLead {
  id: string;
  language: string | null;
  projectName: string | null;
  emirate: string | null;
  budgetMaxAed: number | null;
}

export interface AssignmentCandidate {
  userId: string;
  name: string;
  /** Languages the agent speaks, lowercased. */
  languages: string[];
  /** Projects the agent covers; empty means all of them. */
  projectsCovered: string[];
  /** How many open leads they already hold. Shown before assigning. */
  openLeads: number;
  isEligible: boolean;
}

/** One condition in a by_rule assignment. An absent field matches anything. */
export interface AssignmentRuleClause {
  language?: string;
  project?: string;
  emirate?: string;
  /** Inclusive bounds on the lead's maximum budget, in AED. */
  budgetMinAed?: number;
  budgetMaxAed?: number;
  userId: string;
}

export interface SplitShare {
  userId: string;
  /** 0–100. Shares are normalised, so they need not add up exactly. */
  percent: number;
}

export interface DistributionPlan {
  method: AssignmentMethod;
  /** lead id -> user id. A lead absent from this map goes to the pool. */
  byLead: Map<string, string>;
  /** user id -> how many they were given, for the preview. */
  counts: Map<string, number>;
  /** Leads deliberately left unassigned, for the shared pool. */
  pooled: string[];
  /** Leads no rule matched, which a by_rule assignment leaves for a person. */
  unmatched: string[];
}

export interface DistributionInput {
  method: AssignmentMethod;
  leads: AssignableLead[];
  candidates: AssignmentCandidate[];
  /** For 'agent'. */
  userId?: string | null;
  /** For split_percent. */
  shares?: SplitShare[];
  /** For by_rule, in priority order — the first match wins. */
  clauses?: AssignmentRuleClause[];
}

function emptyPlan(method: AssignmentMethod): DistributionPlan {
  return { method, byLead: new Map(), counts: new Map(), pooled: [], unmatched: [] };
}

function give(plan: DistributionPlan, leadId: string, userId: string): void {
  plan.byLead.set(leadId, userId);
  plan.counts.set(userId, (plan.counts.get(userId) ?? 0) + 1);
}

/** Only agents who can actually take work; order is stable for reproducibility. */
function eligible(candidates: AssignmentCandidate[]): AssignmentCandidate[] {
  return candidates.filter((candidate) => candidate.isEligible).sort((a, b) => a.userId.localeCompare(b.userId));
}

export function distribute(input: DistributionInput): DistributionPlan {
  const plan = emptyPlan(input.method);
  const leads = input.leads;

  if (input.method === 'pool') {
    plan.pooled = leads.map((lead) => lead.id);
    return plan;
  }

  if (input.method === 'agent') {
    const target = input.userId;
    // No named agent is a configuration error, not a silent no-op: the leads go
    // to the pool where a person will see them, rather than nowhere.
    if (!target) {
      plan.pooled = leads.map((lead) => lead.id);
      return plan;
    }
    for (const lead of leads) give(plan, lead.id, target);
    return plan;
  }

  const people = eligible(input.candidates);
  if (people.length === 0) {
    plan.pooled = leads.map((lead) => lead.id);
    return plan;
  }

  if (input.method === 'team_round_robin' || input.method === 'split_even') {
    /*
     * Round-robin starting from whoever is least loaded, so a new agent who
     * joins mid-month catches up instead of staying permanently behind. Within
     * the batch it is a plain rotation, which keeps it even and predictable.
     */
    const order = [...people].sort((a, b) => a.openLeads - b.openLeads || a.userId.localeCompare(b.userId));
    leads.forEach((lead, index) => {
      give(plan, lead.id, (order[index % order.length] as AssignmentCandidate).userId);
    });
    return plan;
  }

  if (input.method === 'split_percent') {
    const shares = (input.shares ?? []).filter(
      (share) => share.percent > 0 && people.some((person) => person.userId === share.userId),
    );
    if (shares.length === 0) {
      plan.pooled = leads.map((lead) => lead.id);
      return plan;
    }

    /*
     * Largest-remainder apportionment. Handing out floor(share) each and then
     * giving the leftovers to the biggest fractions means 10 leads at
     * 40/30/30 come out 4/3/3, not 4/3/2 with one lead quietly lost.
     */
    const total = shares.reduce((sum, share) => sum + share.percent, 0);
    const exact = shares.map((share) => ({
      userId: share.userId,
      quota: (share.percent / total) * leads.length,
    }));
    const counts = exact.map((entry) => ({ userId: entry.userId, n: Math.floor(entry.quota) }));
    let remaining = leads.length - counts.reduce((sum, entry) => sum + entry.n, 0);

    const byRemainder = [...exact]
      .map((entry, index) => ({ index, remainder: entry.quota - Math.floor(entry.quota) }))
      .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (const entry of byRemainder) {
      if (remaining <= 0) break;
      (counts[entry.index] as { n: number }).n += 1;
      remaining -= 1;
    }

    let cursor = 0;
    for (const entry of counts) {
      for (let i = 0; i < entry.n && cursor < leads.length; i++, cursor++) {
        give(plan, (leads[cursor] as AssignableLead).id, entry.userId);
      }
    }
    return plan;
  }

  // by_rule: the first clause that matches wins, so order is the priority.
  const clauses = input.clauses ?? [];
  for (const lead of leads) {
    const clause = clauses.find((candidate) => matches(candidate, lead));
    if (clause && people.some((person) => person.userId === clause.userId)) {
      give(plan, lead.id, clause.userId);
    } else {
      // No rule fits. Left for a person rather than forced onto someone who
      // does not speak the language or cover the project.
      plan.unmatched.push(lead.id);
    }
  }
  return plan;
}

export function matches(clause: AssignmentRuleClause, lead: AssignableLead): boolean {
  if (clause.language && (lead.language ?? '').toLowerCase() !== clause.language.toLowerCase()) return false;
  if (clause.project) {
    const project = (lead.projectName ?? '').toLowerCase();
    if (!project.includes(clause.project.toLowerCase())) return false;
  }
  if (clause.emirate && (lead.emirate ?? '') !== clause.emirate) return false;
  if (clause.budgetMinAed !== undefined) {
    // A lead with no budget cannot satisfy a budget rule; it falls through to
    // the next clause rather than being treated as zero.
    if (lead.budgetMaxAed === null || lead.budgetMaxAed < clause.budgetMinAed) return false;
  }
  if (clause.budgetMaxAed !== undefined) {
    if (lead.budgetMaxAed === null || lead.budgetMaxAed > clause.budgetMaxAed) return false;
  }
  return true;
}

/**
 * Whether a candidate would be overloaded by their share, so the UI can warn
 * before the assignment runs rather than after.
 *
 * The threshold is a multiple of the team's average, not a fixed number: a
 * desk of three carrying 200 leads each is normal; one agent on 200 while the
 * others are on 40 is not.
 */
export const OVERLOAD_FACTOR = 1.5;

export function overloaded(
  candidates: AssignmentCandidate[],
  plan: DistributionPlan,
): { userId: string; after: number; average: number }[] {
  const after = candidates.map((candidate) => ({
    userId: candidate.userId,
    after: candidate.openLeads + (plan.counts.get(candidate.userId) ?? 0),
  }));
  if (after.length === 0) return [];

  const average = after.reduce((sum, entry) => sum + entry.after, 0) / after.length;
  if (average === 0) return [];

  return after
    .filter((entry) => entry.after > average * OVERLOAD_FACTOR)
    .map((entry) => ({ ...entry, average: Math.round(average) }));
}
