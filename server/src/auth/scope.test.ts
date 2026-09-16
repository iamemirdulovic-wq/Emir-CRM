import { describe, expect, it } from 'vitest';
import { canActOnOwner, ownerPredicate } from './scope.js';

describe('ownerPredicate', () => {
  it('is unrestricted for owner/admin (null ids)', () => {
    expect(ownerPredicate('o.owner_user_id', null)).toEqual({ sql: '1=1', params: [] });
  });

  it('restricts to a single agent', () => {
    expect(ownerPredicate('o.owner_user_id', ['u1'])).toEqual({
      sql: 'o.owner_user_id IN (?)',
      params: ['u1'],
    });
  });

  it('restricts a manager to their team', () => {
    expect(ownerPredicate('o.owner_user_id', ['m1', 'a1', 'a2'])).toEqual({
      sql: 'o.owner_user_id IN (?,?,?)',
      params: ['m1', 'a1', 'a2'],
    });
  });

  it('matches nothing for an empty scope rather than everything', () => {
    expect(ownerPredicate('o.owner_user_id', [])).toEqual({ sql: '1=0', params: [] });
  });
});

describe('canActOnOwner', () => {
  it('lets unrestricted viewers act on anything, including unowned records', () => {
    expect(canActOnOwner(null, 'someone')).toBe(true);
    expect(canActOnOwner(null, null)).toBe(true);
  });

  it('blocks an agent from another agent’s record', () => {
    expect(canActOnOwner(['a1'], 'a2')).toBe(false);
    expect(canActOnOwner(['a1'], 'a1')).toBe(true);
  });

  it('blocks a scoped viewer from an unassigned record', () => {
    expect(canActOnOwner(['a1'], null)).toBe(false);
  });
});
