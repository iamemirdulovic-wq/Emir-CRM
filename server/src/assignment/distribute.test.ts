import { describe, expect, it } from 'vitest';
import {
  distribute, matches, overloaded,
  type AssignableLead, type AssignmentCandidate,
} from './distribute.js';

const lead = (id: string, extra: Partial<AssignableLead> = {}): AssignableLead => ({
  id, language: null, projectName: null, emirate: null, budgetMaxAed: null, ...extra,
});

const agent = (userId: string, extra: Partial<AssignmentCandidate> = {}): AssignmentCandidate => ({
  userId, name: userId, languages: ['en'], projectsCovered: [], openLeads: 0, isEligible: true, ...extra,
});

const leads = (n: number) => Array.from({ length: n }, (_, i) => lead(`l${i + 1}`));

describe('one agent', () => {
  it('gives every lead to the named agent', () => {
    const plan = distribute({ method: 'agent', leads: leads(5), candidates: [agent('a')], userId: 'a' });
    expect(plan.counts.get('a')).toBe(5);
    expect(plan.pooled).toHaveLength(0);
  });

  it('pools the batch rather than losing it when no agent is named', () => {
    // Silently assigning nothing would leave the leads invisible; the pool is
    // somewhere a person will actually find them.
    const plan = distribute({ method: 'agent', leads: leads(3), candidates: [agent('a')], userId: null });
    expect(plan.pooled).toHaveLength(3);
    expect(plan.byLead.size).toBe(0);
  });
});

describe('round robin', () => {
  it('shares evenly', () => {
    const plan = distribute({
      method: 'team_round_robin',
      leads: leads(9),
      candidates: [agent('a'), agent('b'), agent('c')],
    });
    expect([...plan.counts.values()]).toEqual([3, 3, 3]);
  });

  it('starts with whoever is carrying least', () => {
    // A new joiner catches up instead of staying permanently behind.
    const plan = distribute({
      method: 'team_round_robin',
      leads: leads(1),
      candidates: [agent('busy', { openLeads: 40 }), agent('new', { openLeads: 0 })],
    });
    expect(plan.byLead.get('l1')).toBe('new');
  });

  it('skips agents who cannot take work', () => {
    const plan = distribute({
      method: 'team_round_robin',
      leads: leads(4),
      candidates: [agent('a'), agent('away', { isEligible: false })],
    });
    expect(plan.counts.get('a')).toBe(4);
    expect(plan.counts.has('away')).toBe(false);
  });

  it('pools the batch when nobody is available', () => {
    const plan = distribute({
      method: 'team_round_robin',
      leads: leads(4),
      candidates: [agent('away', { isEligible: false })],
    });
    expect(plan.pooled).toHaveLength(4);
  });

  it('is deterministic, so a preview matches the run', () => {
    const input = { method: 'split_even' as const, leads: leads(7), candidates: [agent('a'), agent('b')] };
    expect([...distribute(input).byLead]).toEqual([...distribute(input).byLead]);
  });
});

describe('percentage split', () => {
  it('splits 40/30/30 of ten leads as 4/3/3', () => {
    // Plain rounding would give 4/3/3 too, but 4/3/2 with a lead lost is the
    // failure mode this guards: every lead must land somewhere.
    const plan = distribute({
      method: 'split_percent',
      leads: leads(10),
      candidates: [agent('sara'), agent('omar'), agent('lina')],
      shares: [
        { userId: 'sara', percent: 40 },
        { userId: 'omar', percent: 30 },
        { userId: 'lina', percent: 30 },
      ],
    });
    expect(plan.counts.get('sara')).toBe(4);
    expect(plan.counts.get('omar')).toBe(3);
    expect(plan.counts.get('lina')).toBe(3);
    expect(plan.byLead.size).toBe(10);
  });

  it('assigns every lead even when the percentages do not divide evenly', () => {
    const plan = distribute({
      method: 'split_percent',
      leads: leads(7),
      candidates: [agent('a'), agent('b'), agent('c')],
      shares: [
        { userId: 'a', percent: 33 },
        { userId: 'b', percent: 33 },
        { userId: 'c', percent: 34 },
      ],
    });
    expect(plan.byLead.size).toBe(7);
    expect([...plan.counts.values()].reduce((a, b) => a + b, 0)).toBe(7);
  });

  it('normalises shares that do not add up to 100', () => {
    const plan = distribute({
      method: 'split_percent',
      leads: leads(4),
      candidates: [agent('a'), agent('b')],
      shares: [
        { userId: 'a', percent: 1 },
        { userId: 'b', percent: 1 },
      ],
    });
    expect(plan.counts.get('a')).toBe(2);
    expect(plan.counts.get('b')).toBe(2);
  });

  it('ignores a share for someone who cannot take work', () => {
    const plan = distribute({
      method: 'split_percent',
      leads: leads(4),
      candidates: [agent('a'), agent('away', { isEligible: false })],
      shares: [
        { userId: 'a', percent: 50 },
        { userId: 'away', percent: 50 },
      ],
    });
    expect(plan.counts.get('a')).toBe(4);
  });
});

describe('by rule', () => {
  const candidates = [agent('arabic'), agent('auh'), agent('vip')];

  it('routes on language', () => {
    const plan = distribute({
      method: 'by_rule',
      leads: [lead('l1', { language: 'ar' }), lead('l2', { language: 'en' })],
      candidates,
      clauses: [{ language: 'ar', userId: 'arabic' }],
    });
    expect(plan.byLead.get('l1')).toBe('arabic');
    expect(plan.unmatched).toEqual(['l2']);
  });

  it('takes the first matching clause, so order is the priority', () => {
    const plan = distribute({
      method: 'by_rule',
      leads: [lead('l1', { language: 'ar', emirate: 'abu_dhabi' })],
      candidates,
      clauses: [
        { emirate: 'abu_dhabi', userId: 'auh' },
        { language: 'ar', userId: 'arabic' },
      ],
    });
    expect(plan.byLead.get('l1')).toBe('auh');
  });

  it('matches a project by substring, because files spell it loosely', () => {
    const plan = distribute({
      method: 'by_rule',
      leads: [lead('l1', { projectName: 'Emaar Beachfront — Tower 2' })],
      candidates,
      clauses: [{ project: 'beachfront', userId: 'vip' }],
    });
    expect(plan.byLead.get('l1')).toBe('vip');
  });

  it('leaves a lead with no budget out of a budget rule', () => {
    // Treating "unknown" as zero would funnel every unqualified lead to the
    // cheapest agent, which is exactly the wrong way round.
    const plan = distribute({
      method: 'by_rule',
      leads: [lead('l1', { budgetMaxAed: null })],
      candidates,
      clauses: [{ budgetMinAed: 5_000_000, userId: 'vip' }],
    });
    expect(plan.unmatched).toEqual(['l1']);
  });

  it('routes a big budget to the agent who handles them', () => {
    const plan = distribute({
      method: 'by_rule',
      leads: [lead('l1', { budgetMaxAed: 8_000_000 })],
      candidates,
      clauses: [{ budgetMinAed: 5_000_000, userId: 'vip' }],
    });
    expect(plan.byLead.get('l1')).toBe('vip');
  });

  it('never assigns to someone outside the candidate set', () => {
    const plan = distribute({
      method: 'by_rule',
      leads: [lead('l1', { language: 'ru' })],
      candidates,
      clauses: [{ language: 'ru', userId: 'someone-who-left' }],
    });
    expect(plan.byLead.size).toBe(0);
    expect(plan.unmatched).toEqual(['l1']);
  });
});

describe('shared pool', () => {
  it('assigns nobody and pools everything', () => {
    const plan = distribute({ method: 'pool', leads: leads(6), candidates: [agent('a')] });
    expect(plan.byLead.size).toBe(0);
    expect(plan.pooled).toHaveLength(6);
  });
});

describe('matches', () => {
  it('treats an absent condition as "anything"', () => {
    expect(matches({ userId: 'a' }, lead('l1'))).toBe(true);
  });

  it('is case-insensitive about language', () => {
    expect(matches({ language: 'AR', userId: 'a' }, lead('l1', { language: 'ar' }))).toBe(true);
  });
});

describe('workload warning', () => {
  it('flags an agent left far above the team average', () => {
    const candidates = [agent('busy', { openLeads: 100 }), agent('a'), agent('b')];
    const plan = distribute({ method: 'agent', leads: leads(50), candidates, userId: 'busy' });
    const warnings = overloaded(candidates, plan);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.userId).toBe('busy');
    expect(warnings[0]?.after).toBe(150);
  });

  it('says nothing when the work is even', () => {
    const candidates = [agent('a', { openLeads: 10 }), agent('b', { openLeads: 10 })];
    const plan = distribute({ method: 'split_even', leads: leads(10), candidates });
    expect(overloaded(candidates, plan)).toHaveLength(0);
  });

  it('says nothing when nobody has any leads at all', () => {
    const candidates = [agent('a'), agent('b')];
    expect(overloaded(candidates, emptyPlanFor())).toHaveLength(0);
  });
});

function emptyPlanFor() {
  return distribute({ method: 'pool', leads: [], candidates: [] });
}
