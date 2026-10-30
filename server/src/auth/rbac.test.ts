import { describe, expect, it } from 'vitest';
import {
  ROLES, PERMISSIONS, assertCan, can, isAdminOrAbove, isManagerOrAbove, permissionsFor, scopeFor,
} from './rbac.js';
import type { Permission, Role } from './rbac.js';

/**
 * The permission matrix, stated as tests.
 *
 * This is the file that decides whether an agent can take the client database
 * home with them. It is checked on the server for every endpoint, so if a rule
 * is wrong here it is wrong everywhere at once — which is why each rule is
 * written out by hand below rather than generated from the same table the code
 * uses, where a mistake would simply agree with itself.
 */

/** The whole matrix, written independently of the implementation. */
const EXPECTED: Record<Role, Permission[]> = {
  agent: [
    'contacts:read:own', 'contacts:write', 'opportunities:move:own', 'messages:send',
  ],
  manager: [
    'contacts:read:own', 'contacts:write', 'opportunities:move:own', 'messages:send',
    'contacts:read:team', 'contacts:merge', 'opportunities:move:any', 'opportunities:reassign',
    'messages:read:all', 'reports:team',
  ],
  admin: [
    'contacts:read:own', 'contacts:write', 'opportunities:move:own', 'messages:send',
    'contacts:read:team', 'contacts:merge', 'opportunities:move:any', 'opportunities:reassign',
    'messages:read:all', 'reports:team',
    'contacts:read:all', 'templates:manage', 'projects:manage', 'workflows:manage',
    'integrations:manage', 'users:manage', 'reports:all',
  ],
  owner: [
    'contacts:read:own', 'contacts:write', 'opportunities:move:own', 'messages:send',
    'contacts:read:team', 'contacts:merge', 'opportunities:move:any', 'opportunities:reassign',
    'messages:read:all', 'reports:team',
    'contacts:read:all', 'templates:manage', 'projects:manage', 'workflows:manage',
    'integrations:manage', 'users:manage', 'reports:all',
    'contacts:delete', 'export', 'bulk:delete', 'audit:read',
  ],
  automation: [
    'contacts:read:all', 'contacts:write', 'opportunities:move:any', 'opportunities:reassign',
    'messages:send', 'messages:read:all',
  ],
};

describe('the permission matrix', () => {
  for (const role of ROLES) {
    it(`gives ${role} exactly what it should have, and nothing else`, () => {
      const granted = [...permissionsFor(role)].sort();
      expect(granted).toEqual([...EXPECTED[role]].sort());
    });
  }

  it('grants nothing that is not a known permission', () => {
    for (const role of ROLES) {
      for (const permission of permissionsFor(role)) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });
});

/**
 * The client database is the business. These four are the ones that take a
 * copy of it out of the building, destroy it in bulk, or hide the record of
 * either — so each is named here on its own, where a change has to be
 * deliberate.
 */
describe('only the owner can take the database out of the CRM', () => {
  for (const permission of ['export', 'bulk:delete', 'contacts:delete', 'audit:read'] as const) {
    it(`${permission} is the owner's alone`, () => {
      expect(can('owner', permission)).toBe(true);
      expect(can('admin', permission)).toBe(false);
      expect(can('manager', permission)).toBe(false);
      expect(can('agent', permission)).toBe(false);
      expect(can('automation', permission)).toBe(false);
    });
  }

  /* The service account acts on records all day. It must never be the way
     round the export rule. */
  it('the automation account cannot export either', () => {
    expect(can('automation', 'export')).toBe(false);
    expect(can('automation', 'users:manage')).toBe(false);
  });
});

describe('what an agent cannot reach', () => {
  const forbidden: Permission[] = [
    'contacts:read:team', 'contacts:read:all', 'contacts:merge', 'contacts:delete',
    'opportunities:move:any', 'opportunities:reassign', 'messages:read:all',
    'templates:manage', 'projects:manage', 'workflows:manage', 'integrations:manage',
    'users:manage', 'reports:team', 'reports:all', 'export', 'bulk:delete', 'audit:read',
  ];

  for (const permission of forbidden) {
    it(`an agent cannot ${permission}`, () => {
      expect(can('agent', permission)).toBe(false);
    });
  }

  it('an agent can still do their own job', () => {
    expect(can('agent', 'contacts:read:own')).toBe(true);
    expect(can('agent', 'contacts:write')).toBe(true);
    expect(can('agent', 'messages:send')).toBe(true);
    expect(can('agent', 'opportunities:move:own')).toBe(true);
  });
});

describe('how wide a view each role gets', () => {
  it('fences an agent to their own leads and a manager to their team', () => {
    expect(scopeFor('agent')).toBe('own');
    expect(scopeFor('manager')).toBe('team');
    expect(scopeFor('admin')).toBe('all');
    expect(scopeFor('owner')).toBe('all');
    expect(scopeFor('automation')).toBe('all');
  });

  it('answers the two role questions the routes ask', () => {
    expect(isManagerOrAbove('manager')).toBe(true);
    expect(isManagerOrAbove('agent')).toBe(false);
    expect(isAdminOrAbove('admin')).toBe(true);
    expect(isAdminOrAbove('manager')).toBe(false);
  });

  /*
   * `automation` is a service account, not a person. It is deliberately not
   * "manager or above": the routes use that to decide what a human may see
   * and reassign, and a service account appearing there would widen a screen
   * nobody is looking at.
   */
  it('does not treat the automation account as a person in charge', () => {
    expect(isManagerOrAbove('automation')).toBe(false);
    expect(isAdminOrAbove('automation')).toBe(false);
  });
});

describe('refusing', () => {
  it('assertCan throws for a missing permission and is silent for a granted one', () => {
    expect(() => assertCan('agent', 'export')).toThrowError(/not allowed/);
    expect(() => assertCan('admin', 'export')).toThrowError(/not allowed/);
    expect(() => assertCan('owner', 'export')).not.toThrow();
  });

  /* A role with no scope would fall through every fenced query. */
  it('every role resolves to a scope', () => {
    for (const role of ROLES) expect(['own', 'team', 'all']).toContain(scopeFor(role));
  });
});
