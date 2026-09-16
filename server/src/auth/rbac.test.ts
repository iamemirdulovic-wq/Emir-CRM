import { describe, expect, it } from 'vitest';
import { assertCan, can, isAdminOrAbove, isManagerOrAbove, ROLES, scopeFor } from './rbac.js';

describe('rbac', () => {
  it('agents see only their own leads and cannot export', () => {
    expect(scopeFor('agent')).toBe('own');
    expect(can('agent', 'contacts:read:own')).toBe(true);
    expect(can('agent', 'contacts:read:all')).toBe(false);
    expect(can('agent', 'export')).toBe(false);
    expect(can('agent', 'opportunities:reassign')).toBe(false);
  });

  it('agents can move their own cards forward but not anyone else’s', () => {
    expect(can('agent', 'opportunities:move:own')).toBe(true);
    expect(can('agent', 'opportunities:move:any')).toBe(false);
  });

  it('managers see their team, can reassign and move any stage', () => {
    expect(scopeFor('manager')).toBe('team');
    expect(can('manager', 'opportunities:reassign')).toBe(true);
    expect(can('manager', 'opportunities:move:any')).toBe(true);
    expect(can('manager', 'contacts:merge')).toBe(true);
    expect(can('manager', 'export')).toBe(false);
    expect(can('manager', 'users:manage')).toBe(false);
  });

  it('owner and admin see everything and can export', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(scopeFor(role)).toBe('all');
      expect(can(role, 'export')).toBe(true);
      expect(can(role, 'bulk:delete')).toBe(true);
      expect(can(role, 'integrations:manage')).toBe(true);
      expect(can(role, 'users:manage')).toBe(true);
    }
  });

  it('automation acts on records but never exports or manages users', () => {
    expect(can('automation', 'messages:send')).toBe(true);
    expect(can('automation', 'opportunities:move:any')).toBe(true);
    expect(can('automation', 'export')).toBe(false);
    expect(can('automation', 'users:manage')).toBe(false);
    expect(can('automation', 'bulk:delete')).toBe(false);
  });

  it('assertCan throws a 403 for a missing permission', () => {
    expect(() => assertCan('agent', 'export')).toThrowError(/not allowed/);
    expect(() => assertCan('owner', 'export')).not.toThrow();
  });

  it('every role resolves to a scope', () => {
    for (const role of ROLES) expect(['own', 'team', 'all']).toContain(scopeFor(role));
  });

  it('role ladder helpers', () => {
    expect(isManagerOrAbove('manager')).toBe(true);
    expect(isManagerOrAbove('agent')).toBe(false);
    expect(isAdminOrAbove('manager')).toBe(false);
    expect(isAdminOrAbove('admin')).toBe(true);
  });
});
