/**
 * Keyboard shortcuts.
 *
 * Three rules shaped all of this:
 *
 *  1. A single letter must never fire while somebody is typing. An agent
 *     writing "we agreed on the corner unit" in a note would otherwise call
 *     the client, open WhatsApp and jump to the pipeline halfway through the
 *     sentence. So every plain-letter shortcut is dead inside any field.
 *  2. Nothing may steal a browser shortcut. Only Cmd/Ctrl+K is claimed;
 *     anything else with a modifier is handed straight back.
 *  3. The "go to" shortcuts are two keys — G then D — because single letters
 *     for navigation collide with everything, and the two-key form is the one
 *     people already know from other tools.
 *
 * All of the deciding happens in `resolveKey`, which is a pure function of the
 * key, what is pending, and the clock. The React side is a listener and a
 * sheet.
 */

export type ShortcutScope = 'global' | 'lead';

export type ShortcutId =
  | 'palette'
  | 'search'
  | 'help'
  | 'add-lead'
  | 'go-dashboard'
  | 'go-leads'
  | 'go-today'
  | 'go-pipeline'
  | 'go-inbox'
  | 'go-tasks'
  | 'go-incoming'
  | 'go-wall'
  | 'go-projects'
  | 'go-offers'
  | 'go-settings'
  | 'lead-call'
  | 'lead-whatsapp'
  | 'lead-email'
  | 'lead-note'
  | 'lead-next-step';

export interface Shortcut {
  id: ShortcutId;
  /** The keys as they are pressed: ['mod','k'] or ['g','d']. */
  keys: string[];
  /** What it does, in the words the help sheet shows. */
  label: string;
  group: string;
  scope: ShortcutScope;
}

/** The prefix key that starts a two-key shortcut. */
export const PREFIX_KEY = 'g';

/** How long the prefix waits for its second key. */
export const SEQUENCE_TIMEOUT_MS = 1500;

export const SHORTCUTS: Shortcut[] = [
  { id: 'palette', keys: ['mod', 'k'], label: 'Search and jump anywhere', group: 'Anywhere', scope: 'global' },
  { id: 'search', keys: ['/'], label: 'Search this screen', group: 'Anywhere', scope: 'global' },
  { id: 'add-lead', keys: ['n'], label: 'Add a lead', group: 'Anywhere', scope: 'global' },
  { id: 'help', keys: ['?'], label: 'Show this list', group: 'Anywhere', scope: 'global' },

  { id: 'go-dashboard', keys: ['g', 'd'], label: 'Dashboard', group: 'Go to', scope: 'global' },
  { id: 'go-leads', keys: ['g', 'l'], label: 'My Leads', group: 'Go to', scope: 'global' },
  { id: 'go-today', keys: ['g', 'y'], label: "Today's follow-ups", group: 'Go to', scope: 'global' },
  /* K for kanban, which frees P for Projects — the two screens people mix up
     least when the letter matches the word they say out loud. */
  { id: 'go-pipeline', keys: ['g', 'k'], label: 'Pipeline board', group: 'Go to', scope: 'global' },
  { id: 'go-inbox', keys: ['g', 'm'], label: 'Inbox (messages)', group: 'Go to', scope: 'global' },
  { id: 'go-tasks', keys: ['g', 't'], label: 'Tasks', group: 'Go to', scope: 'global' },
  { id: 'go-incoming', keys: ['g', 'i'], label: 'Incoming leads', group: 'Go to', scope: 'global' },
  { id: 'go-wall', keys: ['g', 'w'], label: 'Team Wall', group: 'Go to', scope: 'global' },
  { id: 'go-projects', keys: ['g', 'p'], label: 'Projects', group: 'Go to', scope: 'global' },
  { id: 'go-offers', keys: ['g', 'o'], label: 'Sales offers', group: 'Go to', scope: 'global' },
  { id: 'go-settings', keys: ['g', 's'], label: 'Settings', group: 'Go to', scope: 'global' },

  { id: 'lead-call', keys: ['c'], label: 'Call them', group: 'On a lead', scope: 'lead' },
  { id: 'lead-whatsapp', keys: ['w'], label: 'Open WhatsApp', group: 'On a lead', scope: 'lead' },
  { id: 'lead-email', keys: ['e'], label: 'Write an email', group: 'On a lead', scope: 'lead' },
  { id: 'lead-note', keys: ['a'], label: 'Add a note', group: 'On a lead', scope: 'lead' },
  { id: 'lead-next-step', keys: ['s'], label: 'Set the next step', group: 'On a lead', scope: 'lead' },
];

/** The groups in the order the help sheet shows them. */
export const SHORTCUT_GROUPS = ['Anywhere', 'Go to', 'On a lead'] as const;

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * The key as the table above spells it, or null when it is not ours.
 *
 * Alt is never used, so anything holding it belongs to the operating system.
 * A modifier with anything but K belongs to the browser.
 */
export function keyOf(event: KeyLike): string | null {
  if (event.altKey) return null;
  const mod = Boolean(event.ctrlKey || event.metaKey);
  const key = event.key;

  if (mod) {
    return key.toLowerCase() === 'k' ? 'mod+k' : null;
  }
  if (key === 'Escape') return 'escape';
  if (key === '?' || key === '/') return key;
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toLowerCase();
  return null;
}

/**
 * Is this keystroke somebody typing rather than somebody navigating?
 *
 * A node is a field if it is one, or if it is inside one — a rich-text editor
 * is a contenteditable div full of spans, and the event target is the span.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  let node: unknown = target;
  for (let depth = 0; depth < 20 && node; depth += 1) {
    const element = node as {
      tagName?: string;
      isContentEditable?: boolean;
      getAttribute?: (name: string) => string | null;
      parentElement?: unknown;
    };
    const tag = (element.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (element.isContentEditable) return true;
    if (element.getAttribute?.('role') === 'textbox') return true;
    node = element.parentElement;
  }
  return false;
}

export interface Pending {
  prefix: string;
  at: number;
}

export type Resolution =
  | { action: 'fire'; id: ShortcutId; pending: null }
  | { action: 'wait'; pending: Pending }
  /* `pending` is carried through rather than cleared: a key that means
     nothing — an arrow, F5, a dead Shift — should not cancel a prefix
     somebody has only just pressed. */
  | { action: 'none'; pending: Pending | null };

export interface ResolveOptions {
  /** What the prefix key is waiting for, if anything. */
  pending: Pending | null;
  /** Which scopes are live. 'global' is always; 'lead' only on a lead. */
  scopes: ShortcutScope[];
  now: number;
  /** True when the keystroke came from a field: only `mod+k` and Escape survive. */
  typing: boolean;
}

/**
 * What this keystroke means.
 *
 * Pure, and the only place that knows the rules. The order matters: a pending
 * prefix is resolved before anything else, so G then N goes nowhere rather
 * than adding a lead.
 */
export function resolveKey(key: string | null, options: ResolveOptions): Resolution {
  if (key === null) return { action: 'none', pending: options.pending };

  /* While typing, only the palette gets through. Escape is left to whichever
     dialog is open — swallowing it here would stop a field clearing. */
  if (options.typing) {
    if (key === 'mod+k') return { action: 'fire', id: 'palette', pending: null };
    return { action: 'none', pending: null };
  }

  const expired = options.pending !== null && options.now - options.pending.at > SEQUENCE_TIMEOUT_MS;
  const pending = expired ? null : options.pending;

  if (pending) {
    const match = SHORTCUTS.find(
      (shortcut) =>
        shortcut.keys.length === 2 &&
        shortcut.keys[0] === pending.prefix &&
        shortcut.keys[1] === key &&
        options.scopes.includes(shortcut.scope),
    );
    if (match) return { action: 'fire', id: match.id, pending: null };
    /* An unknown second key cancels rather than falling through: somebody who
       pressed G meant to go somewhere, and firing "call them" instead would
       ring a client. */
    return { action: 'none', pending: null };
  }

  if (key === PREFIX_KEY) return { action: 'wait', pending: { prefix: key, at: options.now } };

  const single = SHORTCUTS.find(
    (shortcut) =>
      shortcut.keys.length === 1 && shortcut.keys[0] === key && options.scopes.includes(shortcut.scope),
  );
  if (single) return { action: 'fire', id: single.id, pending: null };

  if (key === 'mod+k') return { action: 'fire', id: 'palette', pending: null };

  return { action: 'none', pending: null };
}

/** The shortcuts in groups, for the help sheet. */
export function groupedShortcuts(): Array<{ group: string; items: Shortcut[] }> {
  return SHORTCUT_GROUPS.map((group) => ({
    group,
    items: SHORTCUTS.filter((shortcut) => shortcut.group === group),
  })).filter((entry) => entry.items.length > 0);
}

/**
 * How the keys read on screen. `mod` becomes ⌘ on a Mac and Ctrl everywhere
 * else, which is the one piece of platform-sniffing worth doing: showing a Mac
 * user "Ctrl K" makes the shortcut look broken.
 */
export function keyLabel(key: string, isMac: boolean): string {
  if (key === 'mod') return isMac ? '⌘' : 'Ctrl';
  if (key === 'mod+k') return isMac ? '⌘ K' : 'Ctrl K';
  if (key === 'escape') return 'Esc';
  return key.length === 1 ? key.toUpperCase() : key;
}

export function shortcutLabel(shortcut: Shortcut, isMac: boolean): string {
  if (shortcut.keys.length === 2 && shortcut.keys[0] === PREFIX_KEY) {
    return `${keyLabel(shortcut.keys[0], isMac)} then ${keyLabel(shortcut.keys[1] as string, isMac)}`;
  }
  return shortcut.keys.map((key) => keyLabel(key, isMac)).join(' ');
}

/** True on a Mac or an iPad, where the modifier is ⌘. */
export function isMacLike(platform: string | undefined, userAgent: string | undefined): boolean {
  const haystack = `${platform ?? ''} ${userAgent ?? ''}`.toLowerCase();
  return /mac|iphone|ipad|ipod/.test(haystack);
}
