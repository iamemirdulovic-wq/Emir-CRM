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

/*
 * Follow-ups is the Tasks page's second tab, not a page of its own — the
 * design's own sidebar points at `tasks.html#follow-ups`. We carry it as a
 * query (`?tab=follow-ups`) rather than a hash, because a hash is how the
 * preview build routes. `/v2/follow-ups` still answers, as the overdue leads
 * list, and the tab links across to it.
 */
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
      { to: '/v2/tasks?tab=follow-ups', label: 'Follow-ups', icon: 'calendar-check', badge: 'followups', urgent: true },
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
      { to: '/v2/tasks?tab=follow-ups', label: 'Follow-ups', icon: 'calendar-check', badge: 'followups', urgent: true },
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
 * Messages: everything that reaches a client in writing.
 *
 * v3 drew these three greyed as "later" (§1) while insisting nothing the live
 * CRM can do may be lost (§4). They are built now, so the greying is gone and
 * each one leads to its v2 screen. The group keeps its own heading because the
 * three belong together: a chat, the email behind it, and the templates the
 * chat may use once Meta's 24-hour window has closed.
 *
 * The v1 addresses (`/inbox`, `/email-campaigns`) still answer, as
 * `docs/v2/decisions.md` §6.3 requires.
 */
export const MESSAGE_ITEMS: NavItem[] = [
  { to: '/v2/inbox', label: 'Inbox', icon: 'message-circle' },
  { to: '/v2/email', label: 'Email', icon: 'mail' },
  { to: '/v2/templates', label: 'Templates', icon: 'files' },
];

/**
 * Everything the sidebar does not hold.
 *
 * The design's sidebar is deliberately short — nine or ten rows, nothing
 * behind a "More" entry (S-8). Its answer to "then how do I reach the
 * business card, or system health, or the install guide?" is the command
 * palette: `design/web/app.js` builds a `Screens` group out of exactly this
 * list. Without it those pages exist at an address nobody can type.
 *
 * `words` are the other things somebody might type looking for that screen.
 */
export interface Screen {
  to: string;
  label: string;
  icon: IconName;
  words?: string;
  /** Owner and admin only — a manager cannot open these either. */
  ownerOnly?: boolean;
  /** Only an agent needs it. */
  agentOnly?: boolean;
}

export const EXTRA_SCREENS: Screen[] = [
  { to: '/v2/notifications', label: 'Notifications', icon: 'bell', words: 'alerts bell' },
  { to: '/v2/profile', label: 'My profile', icon: 'user' },
  { to: '/v2/card', label: 'My business card', icon: 'id-card', words: 'digital card share qr' },
  { to: '/v2/best', label: 'Best of Homes', icon: 'trophy', words: 'leaderboard points level badges' },
  { to: '/v2/feedback', label: 'Report a problem', icon: 'message-square', words: 'feedback bug idea' },
  { to: '/v2/search', label: 'Search', icon: 'search', words: 'find' },
  { to: '/v2/settings/notifications', label: 'What reaches me', icon: 'bell', words: 'quiet hours sound alerts' },
  { to: '/v2/settings', label: 'Light or dark', icon: 'moon', words: 'theme appearance language sounds' },
  { to: '/v2/settings/phone-app', label: 'Phone app · how to install', icon: 'download', words: 'iphone android pwa notifications' },
  { to: '/v2/attendance', label: 'Days off', icon: 'calendar-days', words: 'leave holiday sick annual' },
  { to: '/v2/calling', label: 'Start calling', icon: 'phone', words: 'dialler queue', agentOnly: true },
  { to: '/v2/attendance', label: 'Check in', icon: 'clock', words: 'office outside late attendance', agentOnly: true },
  { to: '/v2/dashboard', label: 'The full dashboard', icon: 'bar-chart-3', words: 'totals stages sources going cold', ownerOnly: true },
  { to: '/v2/team-live', label: 'Team live', icon: 'activity', words: 'right now online clicks', ownerOnly: true },
  { to: '/v2/messaging', label: 'Messaging report', icon: 'message-circle', words: 'whatsapp taps replied', ownerOnly: true },
  { to: '/v2/projects/manage', label: 'Manage projects', icon: 'building', words: 'add project brochure prices', ownerOnly: true },
  { to: '/v2/settings/team', label: 'Team and roles', icon: 'users-round', words: 'invite agent deactivate', ownerOnly: true },
  { to: '/v2/settings/desks', label: 'Desks', icon: 'building', words: 'arabic russian abu dhabi', ownerOnly: true },
  { to: '/v2/settings/company', label: 'Company', icon: 'building', words: 'trn licence address', ownerOnly: true },
  { to: '/v2/settings/attendance', label: 'Attendance rules', icon: 'clock', words: 'wifi shift late days off', ownerOnly: true },
  { to: '/v2/settings/ai', label: "Homes AI's settings", icon: 'sparkles', words: 'gemini budget limit', ownerOnly: true },
  { to: '/v2/settings/banners', label: 'Home banners', icon: 'megaphone', words: 'my day slides news', ownerOnly: true },
  { to: '/v2/settings/feedback', label: 'Feedback inbox', icon: 'inbox', words: 'bugs ideas reported', ownerOnly: true },
  { to: '/v2/settings/health', label: 'System health', icon: 'activity', words: 'keys whatsapp email push setup', ownerOnly: true },
];

/**
 * The extras this person can actually open.
 *
 * `ownerOnly` means owner and admin, which is not the same as "not an agent":
 * a manager is neither. Offering a manager the full dashboard and letting the
 * server answer 403 is a door painted on a wall.
 */
export function extraScreensFor(role: Role): Screen[] {
  const boss = role === 'owner' || role === 'admin';
  return EXTRA_SCREENS.filter((one) => (
    (!one.ownerOnly || boss) && (!one.agentOnly || role === 'agent')
  ));
}
