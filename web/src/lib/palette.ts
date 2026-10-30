import type { IconName } from '../design/Icon.js';
import type { Role } from './types.js';

/**
 * What Cmd+K knows about.
 *
 * The matching is deliberately not fuzzy in the usual sense. "lead" should find
 * My Leads, "wa" should find the WhatsApp templates, and "ahm" should find
 * Ahmed — but "slt" should NOT find Settings, because an agent typing three
 * letters and getting a screen they did not mean is worse than getting nothing.
 * So: a word has to start with what you typed, or the whole label has to
 * contain it. No letter-skipping.
 *
 * Everything here is pure. The component is a list and a key handler; the
 * decisions live in this file where they can be argued with by a test.
 */

export type PaletteKind = 'action' | 'page' | 'lead' | 'project';

export interface PaletteItem {
  id: string;
  kind: PaletteKind;
  label: string;
  /** The second line: a stage, a project, what the action does. */
  hint?: string | null;
  icon: IconName;
  /** Where it goes. Actions have a `command` instead. */
  to?: string;
  /** A named thing the shell knows how to do. */
  command?: PaletteCommand;
  /** Who sees it. Everybody, when omitted. */
  roles?: Role[];
  /** Extra words that should find it. "dialler" finds the calling screen. */
  keywords?: string[];
  /** Shown on the right, e.g. "G then D". */
  shortcut?: string;
}

export type PaletteCommand =
  | 'add-lead'
  | 'show-shortcuts'
  | 'replay-tour'
  | 'toggle-theme'
  | 'toggle-sound'
  | 'sign-out';

/** The order groups appear in, and what they are called. */
export const GROUP_ORDER: PaletteKind[] = ['action', 'lead', 'project', 'page'];

export const GROUP_LABEL: Record<PaletteKind, string> = {
  action: 'Do',
  lead: 'Leads',
  project: 'Projects',
  page: 'Go to',
};

/**
 * The fixed half of the palette: screens and actions.
 *
 * Pages carry the keywords people actually type. An agent looking for the
 * dialler types "call", not "campaign", and a palette that cannot find a
 * screen by the word for what you do on it is a palette nobody opens twice.
 */
export const STATIC_ITEMS: PaletteItem[] = [
  /* --- actions ---------------------------------------------------------- */
  {
    id: 'action:add-lead',
    kind: 'action',
    label: 'Add a lead',
    hint: 'Type in somebody who called or walked in',
    icon: 'user-plus',
    command: 'add-lead',
    keywords: ['new', 'create', 'contact', 'walk-in'],
    shortcut: 'N',
  },
  {
    id: 'action:shortcuts',
    kind: 'action',
    label: 'Keyboard shortcuts',
    hint: 'Everything you can do without the mouse',
    icon: 'key-round',
    command: 'show-shortcuts',
    keywords: ['keys', 'help', 'hotkeys'],
    shortcut: '?',
  },
  {
    id: 'action:tour',
    kind: 'action',
    label: 'Show me around',
    hint: 'The five-minute tour, again',
    icon: 'sparkles',
    command: 'replay-tour',
    keywords: ['tour', 'guide', 'onboarding', 'walkthrough', 'help'],
  },
  {
    id: 'action:theme',
    kind: 'action',
    label: 'Switch light and dark',
    icon: 'moon',
    command: 'toggle-theme',
    keywords: ['dark', 'light', 'theme', 'night'],
  },
  {
    id: 'action:sound',
    kind: 'action',
    label: 'Turn the new-lead sound on or off',
    icon: 'bell-ring',
    command: 'toggle-sound',
    keywords: ['sound', 'mute', 'alert', 'noise'],
  },
  {
    id: 'action:sign-out',
    kind: 'action',
    label: 'Sign out',
    icon: 'log-out',
    command: 'sign-out',
    keywords: ['log out', 'leave', 'exit'],
  },

  /* --- pages ------------------------------------------------------------ */
  {
    id: 'page:incoming',
    kind: 'page',
    label: 'Incoming',
    hint: 'Leads nobody has taken yet',
    icon: 'inbox',
    to: '/incoming',
    roles: ['owner', 'admin', 'manager'],
    keywords: ['unassigned', 'queue', 'new leads'],
    shortcut: 'G then I',
  },
  { id: 'page:dashboard', kind: 'page', label: 'Dashboard', icon: 'layout-dashboard', to: '/dashboard', keywords: ['home', 'today', 'numbers'], shortcut: 'G then D' },
  { id: 'page:leads', kind: 'page', label: 'My Leads', icon: 'users', to: '/leads', keywords: ['contacts', 'people', 'clients'], shortcut: 'G then L' },
  { id: 'page:today', kind: 'page', label: 'Follow-ups due today', icon: 'calendar-check', to: '/leads?tab=today', keywords: ['due', 'owed', 'next step', 'overdue'] },
  { id: 'page:pipeline', kind: 'page', label: 'Pipeline', icon: 'kanban', to: '/pipeline', keywords: ['board', 'stages', 'kanban'], shortcut: 'G then P' },
  { id: 'page:inbox', kind: 'page', label: 'Inbox', icon: 'message-circle', to: '/inbox', keywords: ['whatsapp', 'messages', 'chat', 'email'], shortcut: 'G then M' },
  { id: 'page:tasks', kind: 'page', label: 'Tasks', icon: 'check-square', to: '/tasks', keywords: ['to do', 'reminders', 'calendar'], shortcut: 'G then T' },
  { id: 'page:lists', kind: 'page', label: 'Lists', icon: 'list', to: '/lists', keywords: ['smart list', 'segment'] },
  { id: 'page:campaigns', kind: 'page', label: 'Call campaigns', icon: 'megaphone', to: '/campaigns', keywords: ['dialler', 'dialer', 'calling', 'power dial'] },
  {
    id: 'page:email-campaigns',
    kind: 'page',
    label: 'Email campaigns',
    icon: 'mail',
    to: '/email-campaigns',
    roles: ['owner', 'admin', 'manager'],
    keywords: ['newsletter', 'blast', 'send email'],
  },
  { id: 'page:pool', kind: 'page', label: 'Lead pool', icon: 'inbox', to: '/pool', roles: ['agent'], keywords: ['claim', 'grab'] },
  { id: 'page:wall', kind: 'page', label: 'Team Wall', icon: 'message-square-heart', to: '/wall', keywords: ['kudos', 'points', 'leaderboard', 'wins'], shortcut: 'G then W' },
  { id: 'page:projects', kind: 'page', label: 'Projects', icon: 'building-2', to: '/projects', keywords: ['library', 'off-plan', 'developers', 'inventory'], shortcut: 'G then R' },
  { id: 'page:offers', kind: 'page', label: 'Sales offers', icon: 'sparkles', to: '/offers', keywords: ['proposal', 'presentation', 'quote'], shortcut: 'G then O' },
  { id: 'page:imports', kind: 'page', label: 'Imports', icon: 'file-up', to: '/imports', keywords: ['csv', 'excel', 'upload', 'bulk'] },
  {
    id: 'page:automations',
    kind: 'page',
    label: 'Automations',
    icon: 'zap',
    to: '/automations',
    roles: ['owner', 'admin', 'manager'],
    keywords: ['workflow', 'follow-up', 'rules'],
  },
  {
    id: 'page:team-activity',
    kind: 'page',
    label: 'Team activity',
    icon: 'users-round',
    to: '/team-activity',
    roles: ['owner', 'admin', 'manager'],
    keywords: ['who is online', 'agents', 'reports'],
  },
  { id: 'page:audit', kind: 'page', label: 'Audit log', icon: 'shield', to: '/audit', roles: ['owner'], keywords: ['history', 'who changed'] },
  { id: 'page:profile', kind: 'page', label: 'My profile', icon: 'id-card', to: '/profile', keywords: ['card', 'photo', 'badges', 'me'] },
  { id: 'page:settings', kind: 'page', label: 'Settings', icon: 'settings', to: '/settings', keywords: ['users', 'integrations', 'keys', 'templates'] },
];

/**
 * How well `item` matches `query`, or null for no match at all.
 *
 * Higher is better. The bands are wide enough that a word-start match always
 * beats a mid-word one, whatever the label lengths — the tie-breaking inside a
 * band is on label length, so the shorter, more exact thing comes first.
 */
export function matchScore(query: string, item: PaletteItem): number | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;

  const label = item.label.toLowerCase();
  if (label === needle) return 1000;
  if (label.startsWith(needle)) return 900 - Math.min(label.length, 99);

  /* A word inside the label starting with what was typed: "leads" → "My Leads". */
  if (startsAWord(label, needle)) return 800 - Math.min(label.length, 99);

  const keywords = (item.keywords ?? []).map((word) => word.toLowerCase());
  if (keywords.some((word) => word === needle || word.startsWith(needle))) return 700;
  if (keywords.some((word) => startsAWord(word, needle))) return 650;

  /* Anywhere in the label at all: last resort, still ranked above nothing. */
  if (label.includes(needle)) return 500 - Math.min(label.length, 99);

  const hint = (item.hint ?? '').toLowerCase();
  if (hint && startsAWord(hint, needle)) return 300;

  /* A multi-word query matches when every word matches something. */
  const words = needle.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const haystack = `${label} ${keywords.join(' ')} ${hint}`;
    if (words.every((word) => startsAWord(haystack, word) || haystack.includes(word))) return 400;
  }

  return null;
}

function startsAWord(haystack: string, needle: string): boolean {
  if (haystack.startsWith(needle)) return true;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = haystack[at - 1];
    if (before !== undefined && /[\s\-–/·,(]/.test(before)) return true;
    from = at + 1;
  }
}

/** How many actions the opening list shows before anything is typed. */
export const EMPTY_ACTION_LIMIT = 3;

export interface RankOptions {
  role: Role;
  /** Item ids opened recently, newest first. Lifts them when nothing is typed. */
  recents?: string[];
  limit?: number;
}

/**
 * The static items a person may see, ranked for what they typed.
 *
 * With an empty query this is the useful default: what they last used, then
 * the actions, then the screens in the order the navigation has them — not an
 * alphabetical list, which is an order nobody thinks in.
 */
export function rankStatic(query: string, options: RankOptions): PaletteItem[] {
  const allowed = STATIC_ITEMS.filter((item) => !item.roles || item.roles.includes(options.role));
  const limit = options.limit ?? 12;

  if (!query.trim()) {
    const recents = options.recents ?? [];
    const recent = recents
      .map((id) => allowed.find((item) => item.id === id))
      .filter((item): item is PaletteItem => Boolean(item));
    const rest = allowed.filter((item) => !recent.includes(item));

    /*
     * At most three actions before anything is typed. There are six of them
     * and they sit above the screens, so without this the opening list is
     * "sign out, switch light and dark" and one page — which is not what
     * anybody opened the palette for.
     */
    const trimmed: PaletteItem[] = [];
    let actions = recent.filter((item) => item.kind === 'action').length;
    for (const item of rest) {
      if (item.kind === 'action') {
        if (actions >= EMPTY_ACTION_LIMIT) continue;
        actions += 1;
      }
      trimmed.push(item);
    }

    return [...recent, ...trimmed].slice(0, limit);
  }

  const scored = allowed
    .map((item, index) => ({ item, index, score: matchScore(query, item) }))
    .filter((entry): entry is { item: PaletteItem; index: number; score: number } => entry.score !== null);

  scored.sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score));
  return scored.slice(0, limit).map((entry) => entry.item);
}

/** Group a flat, already-ranked list for display, keeping each group's order. */
export function groupItems(items: PaletteItem[]): Array<{ kind: PaletteKind; label: string; items: PaletteItem[] }> {
  return GROUP_ORDER.map((kind) => ({
    kind,
    label: GROUP_LABEL[kind],
    items: items.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);
}

/**
 * Is it worth asking the server?
 *
 * Two characters is not a search, it is somebody still typing, and firing a
 * query on it means every palette open costs a round trip that returns forty
 * leads nobody wanted. A phone number is the exception: six digits is already
 * specific enough to be worth looking up.
 */
export function shouldSearchServer(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length >= 3) return true;
  return /^\d{6,}$/.test(trimmed.replace(/[\s+()-]/g, ''));
}

/** Move an id to the front of the recents, capped. */
export function rememberRecent(recents: string[], id: string, max = 5): string[] {
  return [id, ...recents.filter((existing) => existing !== id)].slice(0, max);
}

/**
 * Where the highlight goes when the arrow keys are pressed.
 *
 * Wraps, because a list that stops at the bottom makes somebody press Down
 * eleven times to get back to the first thing.
 */
export function moveSelection(current: number, delta: number, count: number): number {
  if (count === 0) return 0;
  return (((current + delta) % count) + count) % count;
}
