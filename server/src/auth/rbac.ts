import { forbidden } from '../lib/errors.js';

export const ROLES = ['owner', 'admin', 'manager', 'agent', 'automation'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Every permission the server enforces. Enforcement happens on the server for
 * every endpoint and query, not only in the UI.
 */
export const PERMISSIONS = [
  'contacts:read:own',
  'contacts:read:team',
  'contacts:read:all',
  'contacts:write',
  'contacts:merge',
  'contacts:delete',
  'opportunities:move:own',
  'opportunities:move:any',
  'opportunities:reassign',
  'messages:send',
  'messages:read:all',
  'templates:manage',
  'projects:manage',
  'workflows:manage',
  'integrations:manage',
  'users:manage',
  'reports:team',
  'reports:all',
  'export',
  'bulk:delete',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const AGENT: Permission[] = ['contacts:read:own', 'contacts:write', 'opportunities:move:own', 'messages:send'];

const MANAGER: Permission[] = [
  ...AGENT,
  'contacts:read:team',
  'contacts:merge',
  'opportunities:move:any',
  'opportunities:reassign',
  'messages:read:all',
  'reports:team',
];

const ADMIN: Permission[] = [
  ...MANAGER,
  'contacts:read:all',
  'templates:manage',
  'projects:manage',
  'workflows:manage',
  'integrations:manage',
  'users:manage',
  'reports:all',
];

/**
 * What only the owner may do.
 *
 * The client database is the business. An export is a copy of it that walks
 * out of the building and cannot be called back, and a bulk delete is the
 * same loss in the other direction — so both stop at one person, and so does
 * reading the record of who did what. An admin runs the CRM day to day;
 * taking the whole database out of it is not day to day.
 */
const OWNER: Permission[] = [
  ...ADMIN,
  'contacts:delete',
  'export',
  'bulk:delete',
  'audit:read',
];

/** The automation service account: acts on records, but never exports or manages people. */
const AUTOMATION: Permission[] = [
  'contacts:read:all',
  'contacts:write',
  'opportunities:move:any',
  'opportunities:reassign',
  'messages:send',
  'messages:read:all',
];

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: OWNER,
  admin: ADMIN,
  manager: MANAGER,
  agent: AGENT,
  automation: AUTOMATION,
};

export function permissionsFor(role: Role): readonly Permission[] {
  return MATRIX[role] ?? [];
}

export function can(role: Role, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw forbidden(`Role "${role}" is not allowed to ${permission}`);
  }
}

/** How wide a view of the data this role gets. */
export type Scope = 'own' | 'team' | 'all';

export function scopeFor(role: Role): Scope {
  if (role === 'owner' || role === 'admin' || role === 'automation') return 'all';
  if (role === 'manager') return 'team';
  return 'own';
}

export function isManagerOrAbove(role: Role): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export function isAdminOrAbove(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}
