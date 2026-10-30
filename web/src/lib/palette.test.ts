import { describe, expect, it } from 'vitest';
import {
  EMPTY_ACTION_LIMIT, GROUP_LABEL, GROUP_ORDER, groupItems, matchScore, moveSelection, rankStatic,
  rememberRecent,
  shouldSearchServer, STATIC_ITEMS, type PaletteItem,
} from './palette.js';
import { ICON_NAMES } from '../design/Icon.js';

const item = (over: Partial<PaletteItem> = {}): PaletteItem => ({
  id: 'x',
  kind: 'page',
  label: 'My Leads',
  icon: 'users',
  ...over,
});

describe('matchScore', () => {
  it('ranks an exact label above everything', () => {
    expect(matchScore('my leads', item())).toBe(1000);
  });

  it('ranks a label that starts with the query next', () => {
    expect(matchScore('my', item())).toBeGreaterThan(matchScore('leads', item()) as number);
  });

  it('finds a word inside the label', () => {
    expect(matchScore('leads', item())).not.toBeNull();
    expect(matchScore('lea', item())).not.toBeNull();
  });

  it('finds an item by a keyword somebody would actually type', () => {
    const dialler = STATIC_ITEMS.find((entry) => entry.id === 'page:campaigns') as PaletteItem;
    expect(matchScore('dialler', dialler)).not.toBeNull();
    expect(matchScore('dialer', dialler)).not.toBeNull();
    expect(matchScore('calling', dialler)).not.toBeNull();
  });

  it('refuses to skip letters', () => {
    /* The whole point: "slt" must not find Settings. */
    const settings = STATIC_ITEMS.find((entry) => entry.id === 'page:settings') as PaletteItem;
    expect(matchScore('slt', settings)).toBeNull();
    expect(matchScore('mld', item())).toBeNull();
  });

  it('is case-insensitive and ignores surrounding spaces', () => {
    expect(matchScore('  MY LeAdS ', item())).toBe(1000);
  });

  it('matches every item on an empty query', () => {
    expect(matchScore('', item())).toBe(0);
  });

  it('matches a word after a hyphen or a slash', () => {
    const followUps = item({ label: 'Follow-ups due today' });
    expect(matchScore('ups', followUps)).not.toBeNull();
  });

  it('falls back to the hint', () => {
    const withHint = item({ label: 'Pipeline', hint: 'Drag cards between stages' });
    expect(matchScore('stages', withHint)).not.toBeNull();
  });

  it('handles a two-word query where each word matches something different', () => {
    const withHint = item({ label: 'Email campaigns', keywords: ['newsletter'], hint: 'Send to a list' });
    expect(matchScore('email list', withHint)).not.toBeNull();
    expect(matchScore('email zebra', withHint)).toBeNull();
  });

  it('prefers the shorter label when two start with the query', () => {
    const short = item({ label: 'Leads' });
    const long = item({ label: 'Leads that went quiet last month' });
    expect(matchScore('lead', short)).toBeGreaterThan(matchScore('lead', long) as number);
  });
});

describe('rankStatic', () => {
  it('shows an agent only what an agent may open', () => {
    const ids = rankStatic('', { role: 'agent', limit: 100 }).map((entry) => entry.id);
    expect(ids).not.toContain('page:audit');
    expect(ids).not.toContain('page:team-activity');
    expect(ids).not.toContain('page:incoming');
    expect(ids).toContain('page:pool');
  });

  it('shows an owner everything except the agent-only screens', () => {
    const ids = rankStatic('', { role: 'owner', limit: 100 }).map((entry) => entry.id);
    expect(ids).toContain('page:audit');
    expect(ids).toContain('page:incoming');
    expect(ids).not.toContain('page:pool');
  });

  it('hides the audit log from an admin, who is not the owner', () => {
    const ids = rankStatic('', { role: 'admin', limit: 100 }).map((entry) => entry.id);
    expect(ids).not.toContain('page:audit');
    expect(ids).toContain('page:automations');
  });

  it('puts what you last used first when nothing is typed', () => {
    const ranked = rankStatic('', { role: 'owner', recents: ['page:wall', 'page:offers'] });
    expect(ranked[0]?.id).toBe('page:wall');
    expect(ranked[1]?.id).toBe('page:offers');
  });

  it('ignores a recent id that no longer exists or is not allowed', () => {
    const ranked = rankStatic('', { role: 'agent', recents: ['page:audit', 'page:gone'] });
    expect(ranked[0]?.id).not.toBe('page:audit');
  });

  it('never repeats a recent item further down the list', () => {
    const ranked = rankStatic('', { role: 'owner', recents: ['page:wall'], limit: 100 });
    expect(ranked.filter((entry) => entry.id === 'page:wall')).toHaveLength(1);
  });

  it('does not let the actions crowd out the screens', () => {
    const ranked = rankStatic('', { role: 'owner', limit: 10 });
    const actions = ranked.filter((entry) => entry.kind === 'action');
    expect(actions.length).toBeLessThanOrEqual(EMPTY_ACTION_LIMIT);
    expect(ranked.filter((entry) => entry.kind === 'page').length).toBeGreaterThanOrEqual(5);
  });

  it('still finds every action once something is typed', () => {
    expect(rankStatic('sign out', { role: 'agent' })[0]?.id).toBe('action:sign-out');
    expect(rankStatic('sound', { role: 'agent' })[0]?.id).toBe('action:sound');
  });

  it('counts a recent action against the opening limit', () => {
    const ranked = rankStatic('', {
      role: 'owner',
      recents: ['action:sign-out', 'action:theme', 'action:sound'],
      limit: 12,
    });
    expect(ranked.filter((entry) => entry.kind === 'action').length).toBe(EMPTY_ACTION_LIMIT);
  });

  it('respects the limit', () => {
    expect(rankStatic('', { role: 'owner', limit: 4 })).toHaveLength(4);
  });

  it('finds a screen by what you do on it', () => {
    expect(rankStatic('whatsapp', { role: 'agent' })[0]?.id).toBe('page:inbox');
    expect(rankStatic('csv', { role: 'agent' })[0]?.id).toBe('page:imports');
    expect(rankStatic('kudos', { role: 'agent' })[0]?.id).toBe('page:wall');
  });

  it('finds the actions by their plain names', () => {
    expect(rankStatic('add', { role: 'agent' })[0]?.id).toBe('action:add-lead');
    expect(rankStatic('tour', { role: 'agent' })[0]?.id).toBe('action:tour');
    expect(rankStatic('dark', { role: 'agent' })[0]?.id).toBe('action:theme');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(rankStatic('zzzzqqq', { role: 'owner' })).toEqual([]);
  });
});

describe('groupItems', () => {
  it('groups in a fixed order with no empty groups', () => {
    const groups = groupItems([
      item({ id: 'a', kind: 'page' }),
      item({ id: 'b', kind: 'action' }),
      item({ id: 'c', kind: 'lead' }),
    ]);
    expect(groups.map((group) => group.kind)).toEqual(['action', 'lead', 'page']);
  });

  it('keeps the order inside a group', () => {
    const groups = groupItems([
      item({ id: 'first', kind: 'page' }),
      item({ id: 'second', kind: 'page' }),
    ]);
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(['first', 'second']);
  });

  it('returns nothing for nothing', () => {
    expect(groupItems([])).toEqual([]);
  });

  it('has a label for every group', () => {
    for (const kind of GROUP_ORDER) expect(GROUP_LABEL[kind]).toBeTruthy();
  });
});

describe('shouldSearchServer', () => {
  it('waits for three characters', () => {
    expect(shouldSearchServer('a')).toBe(false);
    expect(shouldSearchServer('ah')).toBe(false);
    expect(shouldSearchServer('ahm')).toBe(true);
  });

  it('does not count surrounding spaces as characters', () => {
    expect(shouldSearchServer('  a  ')).toBe(false);
  });

  it('searches on a short phone number, because digits are specific', () => {
    expect(shouldSearchServer('501234')).toBe(true);
    expect(shouldSearchServer('+971 50')).toBe(true);
    expect(shouldSearchServer('50')).toBe(false);
  });
});

describe('rememberRecent', () => {
  it('puts the newest first', () => {
    expect(rememberRecent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('moves an existing id rather than duplicating it', () => {
    expect(rememberRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });

  it('caps the list', () => {
    expect(rememberRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toHaveLength(5);
  });
});

describe('moveSelection', () => {
  it('moves down and up', () => {
    expect(moveSelection(0, 1, 3)).toBe(1);
    expect(moveSelection(2, -1, 3)).toBe(1);
  });

  it('wraps at both ends', () => {
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
  });

  it('copes with an empty list', () => {
    expect(moveSelection(0, 1, 0)).toBe(0);
    expect(moveSelection(5, -1, 0)).toBe(0);
  });
});

describe('the static list itself', () => {
  it('has no duplicate ids', () => {
    const ids = STATIC_ITEMS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses icons that exist', () => {
    for (const entry of STATIC_ITEMS) expect(ICON_NAMES).toContain(entry.icon);
  });

  it('gives every item somewhere to go or something to do', () => {
    for (const entry of STATIC_ITEMS) {
      expect(Boolean(entry.to) || Boolean(entry.command)).toBe(true);
    }
  });

  it('uses the id prefix that matches the kind', () => {
    for (const entry of STATIC_ITEMS) expect(entry.id.startsWith(`${entry.kind}:`)).toBe(true);
  });
});
