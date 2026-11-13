import { describe, expect, it } from 'vitest';
import { COUNTED_AGENT_ROLES, countedAgentSql, isCountedAgent } from './counting.js';

/**
 * One rule for "how many agents", because there were four of them.
 *
 * The owner opened four screens on 13 Nov and was told his floor had 14, 11,
 * 12 and 17 people on it. The headcount itself is pinned against the database
 * in `counting.integration.test.ts`; this is the rule on its own.
 */

describe('who counts as an agent', () => {
  it('counts agents and managers', () => {
    expect(isCountedAgent('agent')).toBe(true);
    expect(isCountedAgent('manager')).toBe(true);
  });

  /* The whole point of the fix: an owner is not one of his own agents, and
     neither is the admin who runs the CRM for him. */
  it('never counts the owner, the admin or the service account', () => {
    expect(isCountedAgent('owner')).toBe(false);
    expect(isCountedAgent('admin')).toBe(false);
    expect(isCountedAgent('automation')).toBe(false);
    expect(isCountedAgent('accountant')).toBe(false);
  });

  it('says no to a role it has never heard of rather than guessing', () => {
    expect(isCountedAgent('')).toBe(false);
    expect(isCountedAgent(null)).toBe(false);
    expect(isCountedAgent(undefined)).toBe(false);
    expect(isCountedAgent('AGENT')).toBe(false);
  });

  it('is exactly two roles, so a fifth rule cannot appear by accident', () => {
    expect([...COUNTED_AGENT_ROLES]).toEqual(['agent', 'manager']);
  });
});

describe('the same rule as SQL', () => {
  it('writes the predicate every query now shares', () => {
    expect(countedAgentSql()).toBe("u.role IN ('agent','manager')");
    expect(countedAgentSql('role')).toBe("role IN ('agent','manager')");
  });

  it('agrees with the function it is the SQL of', () => {
    const inSql = countedAgentSql();
    for (const role of ['owner', 'admin', 'manager', 'agent', 'automation']) {
      expect(inSql.includes(`'${role}'`)).toBe(isCountedAgent(role));
    }
  });

  /*
   * The role names are this module's own constants and never anything a
   * request carries, so they go straight into the statement. The column name
   * is checked all the same — a caller passing something clever into a string
   * that becomes SQL is the mistake worth making impossible rather than
   * unlikely.
   */
  it('refuses anything that is not a column name', () => {
    expect(() => countedAgentSql("u.role) OR 1=1 -- ")).toThrow(/not a column name/);
    expect(() => countedAgentSql('')).toThrow(/not a column name/);
    expect(() => countedAgentSql('a.b.c')).toThrow(/not a column name/);
  });
});
