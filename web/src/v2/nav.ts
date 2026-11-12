/**
 * What is in the sidebar, in what order, and what carries a badge.
 *
 * Straight from `docs/v2/rules.md` S-7 to S-25, which is the design research
 * reading of `design/web/research/nova.md`. The rule ids are quoted against
 * each decision so a reviewer can check this file against the design without
 * opening either.
 *
 * The shape is data rather than JSX on purpose: the computer sidebar, the
 * folded rail and the phone's More screen are three renderings of this one
 * list, and they must not drift apart.
 */

import type { IconName } from '../design/index.js';
import type { Role } from '../lib/types.js';

/** Where a badge's number comes from. Nothing else may carry one (S-25). */
export type BadgeSource =
  | 'incoming'      // leads waiting (owner) / free leads (agent)
  | 'followups'     // overdue
  | 'transfers'     // waiting for approval (owner) / to answer (agent)
  | 'tasks'         // overdue
  | 'leave';        // leave requests (owner only)

export interface NavItem {
  /** The path under /v2. */
  to: string;
  label: string;
  icon: IconName;
  badge?: BadgeSource;
  /**
   * Red means late, or waiting on you. Everything else is grey — S-22, and
   * the reason the sidebar does not look like a Christmas tree.
   */
  urgent?: boolean;
  /** Drawn, but not part of this build. Shown greyed and not clickable. */
  later?: boolean;
}

export interface NavGroup {
  /** Null for the unlabelled top group (S-7, S-9, S-15). */
  label: string | null;
  items: NavItem[];
}

/**
 * Owner and admin see the same thing (v3 §2: admin is "like owner", minus
 * removing owners — a difference in what a page lets you do, not in which
 * pages exist).
 */
const OWNER_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { to: '/v2', label: 'Dashboard', icon: 'layout-dashboard' },
      { to: '/v2/incoming', label: 'Incoming', icon: 'inbox', badge: 'incoming', urgent: true },
    ],
  },
  {
    label: 'LEADS',
    items: [
      { to: '/v2/leads', label: 'All leads', icon: 'users' },
      { to: '/v2/follow-ups', label: 'Follow-ups', icon: 'calendar-check', badge: 'followups', urgent: true },
      { to: '/v2/pipeline', label: 'Pipeline', icon: 'kanban' },
      { to: '/v2/transfers', label: 'Transfers', icon: 'repeat', badge: 'transfers' },
      { to: '/v2/import', label: 'Import', icon: 'upload' },
    ],
  },
  {
    label: 'PLAN',
    items: [
      { to: '/v2/calendar', label: 'Calendar', icon: 'calendar-days' },
      { to: '/v2/tasks', label: 'Tasks', icon: 'check-check', badge: 'tasks', urgent: true },
    ],
  },
  {
    label: 'PROJECTS',
    items: [
      { to: '/v2/projects', label: 'Projects', icon: 'building' },
      { to: '/v2/offers', label: 'Sales offers', icon: 'file-text' },
    ],
  },
  {
    label: 'TEAM',
    items: [
      { to: '/v2/team', label: 'Team', icon: 'users-round' },
      { to: '/v2/wall', label: 'Team wall', icon: 'message-square' },
      { to: '/v2/attendance', label: 'Attendance', icon: 'clock', badge: 'leave' },
      { to: '/v2/activity', label: 'Activity', icon: 'activity' },
    ],
  },
];

/**
 * The agent's list. Four differences from the owner's, each one a rule:
 * My Day instead of Dashboard (S-15), no Import (S-16), no Activity (S-19),
 * no Automations (S-20). Attendance carries no badge for an agent (S-24).
 */
const AGENT_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { to: '/v2', label: 'My Day', icon: 'sun' },
      { to: '/v2/incoming', label: 'Incoming', icon: 'inbox', badge: 'incoming' },
    ],
  },
  {
    label: 'LEADS',
    items: [
      { to: '/v2/leads', label: 'My leads', icon: 'users' },
      { to: '/v2/follow-ups', label: 'Follow-ups', icon: 'calendar-check', badge: 'followups', urgent: true },
      { to: '/v2/pipeline', label: 'Pipeline', icon: 'kanban' },
      { to: '/v2/transfers', label: 'Transfers', icon: 'repeat', badge: 'transfers' },
    ],
  },
  {
    label: 'PLAN',
    items: [
      { to: '/v2/calendar', label: 'Calendar', icon: 'calendar-days' },
      { to: '/v2/tasks', label: 'Tasks', icon: 'check-check', badge: 'tasks', urgent: true },
    ],
  },
  {
    label: 'PROJECTS',
    items: [
      { to: '/v2/projects', label: 'Projects', icon: 'building' },
      { to: '/v2/offers', label: 'Sales offers', icon: 'file-text' },
    ],
  },
  {
    label: 'TEAM',
    items: [
      { to: '/v2/team', label: 'Team', icon: 'users-round' },
      { to: '/v2/wall', label: 'Team wall', icon: 'message-square' },
      { to: '/v2/attendance', label: 'Attendance', icon: 'clock' },
    ],
  },
];

/** The block pinned to the bottom, above the profile row (S-14, S-20). */
export function pinnedFor(role: Role): NavItem[] {
  const ai: NavItem = { to: '/v2/ai', label: 'Homes AI', icon: 'sparkles' };
  const settings: NavItem = { to: '/v2/settings', label: 'Settings', icon: 'settings' };
  if (role === 'agent') return [ai, settings];
  return [ai, { to: '/v2/automations', label: 'Automations', icon: 'zap' }, settings];
}

export function groupsFor(role: Role): NavGroup[] {
  return role === 'agent' ? AGENT_GROUPS : OWNER_GROUPS;
}

/**
 * The phone's floating bar: five fixed items, the same on 64 of the 68 screens
 * in `design/screens/`. The dial button sits beside it, never over it.
 *
 * "More" is not a hiding place — the sidebar rule that nothing lives behind a
 * More entry (S-8) is a computer rule, where there is room for everything. On a
 * phone there is not, so More holds the rest of the same list, in the same
 * order, which is why it reads from `groupsFor` too.
 */
export const PHONE_BAR: NavItem[] = [
  { to: '/v2', label: 'Home', icon: 'sun' },
  { to: '/v2/leads', label: 'Leads', icon: 'users' },
  { to: '/v2/calendar', label: 'Calendar', icon: 'calendar-days' },
  { to: '/v2/tasks', label: 'Tasks', icon: 'check-check', badge: 'tasks', urgent: true },
  { to: '/v2/more', label: 'More', icon: 'menu' },
];

/**
 * Built, working, and not part of this build.
 *
 * v3 contradicts itself here: §1 says show Inbox, Email and Templates greyed
 * as "later"; §4 says nothing the live CRM can do may be lost. Both hold — the
 * menu shows them greyed exactly as drawn, and the old routes keep working for
 * anyone who opens one. See `docs/v2/decisions.md` §6.3.
 */
export const LATER_ITEMS: NavItem[] = [
  { to: '/inbox', label: 'Inbox', icon: 'message-circle', later: true },
  { to: '/email-campaigns', label: 'Email', icon: 'mail', later: true },
  { to: '/v2/templates', label: 'Templates', icon: 'files', later: true },
];
