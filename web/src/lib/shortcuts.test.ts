import { describe, expect, it } from 'vitest';
import {
  groupedShortcuts, isMacLike, isTypingTarget, keyLabel, keyOf, PREFIX_KEY, resolveKey,
  SEQUENCE_TIMEOUT_MS, SHORTCUT_GROUPS, SHORTCUTS, shortcutLabel, type KeyLike, type Pending,
} from './shortcuts.js';

const NOW = 1_000_000;

function resolve(key: string | null, over: Partial<Parameters<typeof resolveKey>[1]> = {}) {
  return resolveKey(key, { pending: null, scopes: ['global'], now: NOW, typing: false, ...over });
}

describe('keyOf', () => {
  const event = (over: Partial<KeyLike>): KeyLike => ({ key: 'a', ...over });

  it('reads a plain letter', () => {
    expect(keyOf(event({ key: 'n' }))).toBe('n');
  });

  it('lowercases a shifted letter', () => {
    expect(keyOf(event({ key: 'G', shiftKey: true }))).toBe('g');
  });

  it('claims only Cmd/Ctrl+K', () => {
    expect(keyOf(event({ key: 'k', metaKey: true }))).toBe('mod+k');
    expect(keyOf(event({ key: 'k', ctrlKey: true }))).toBe('mod+k');
    expect(keyOf(event({ key: 'K', metaKey: true, shiftKey: true }))).toBe('mod+k');
  });

  it('hands every other browser shortcut back', () => {
    for (const key of ['r', 't', 'w', 'l', 'f', 's', 'p']) {
      expect(keyOf(event({ key, metaKey: true }))).toBeNull();
      expect(keyOf(event({ key, ctrlKey: true }))).toBeNull();
    }
  });

  it('never claims anything with Alt', () => {
    expect(keyOf(event({ key: 'n', altKey: true }))).toBeNull();
    expect(keyOf(event({ key: 'k', altKey: true, metaKey: true }))).toBeNull();
  });

  it('reads the punctuation keys', () => {
    expect(keyOf(event({ key: '?', shiftKey: true }))).toBe('?');
    expect(keyOf(event({ key: '/' }))).toBe('/');
    expect(keyOf(event({ key: 'Escape' }))).toBe('escape');
  });

  it('ignores keys with no shortcut on them', () => {
    for (const key of ['ArrowDown', 'Shift', 'Tab', 'F5', 'Enter', '4', '-']) {
      expect(keyOf(event({ key }))).toBeNull();
    }
  });
});

describe('isTypingTarget', () => {
  const node = (over: Record<string, unknown>) => ({ getAttribute: () => null, ...over }) as unknown as EventTarget;

  it('spots the fields', () => {
    expect(isTypingTarget(node({ tagName: 'INPUT' }))).toBe(true);
    expect(isTypingTarget(node({ tagName: 'TEXTAREA' }))).toBe(true);
    expect(isTypingTarget(node({ tagName: 'SELECT' }))).toBe(true);
  });

  it('spots a contenteditable, and a span inside one', () => {
    expect(isTypingTarget(node({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
    const editor = node({ tagName: 'DIV', isContentEditable: true });
    expect(isTypingTarget(node({ tagName: 'SPAN', parentElement: editor }))).toBe(true);
  });

  it('spots role=textbox', () => {
    expect(isTypingTarget(node({ tagName: 'DIV', getAttribute: (name: string) => (name === 'role' ? 'textbox' : null) }))).toBe(true);
  });

  it('says no to a button or the body', () => {
    expect(isTypingTarget(node({ tagName: 'BUTTON' }))).toBe(false);
    expect(isTypingTarget(node({ tagName: 'BODY' }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('does not loop forever on a cycle', () => {
    const a: Record<string, unknown> = { tagName: 'DIV', getAttribute: () => null };
    a.parentElement = a;
    expect(isTypingTarget(a as unknown as EventTarget)).toBe(false);
  });
});

describe('resolveKey — while typing', () => {
  it('lets the palette through', () => {
    expect(resolve('mod+k', { typing: true })).toEqual({ action: 'fire', id: 'palette', pending: null });
  });

  it('swallows every plain letter', () => {
    for (const key of ['n', 'c', 'w', 'e', 'a', 's', 'g', '?', '/']) {
      expect(resolve(key, { typing: true }).action).toBe('none');
    }
  });

  it('does not start a sequence from inside a field', () => {
    expect(resolve('g', { typing: true }).pending).toBeNull();
  });

  it('leaves Escape to whatever is open', () => {
    expect(resolve('escape', { typing: true }).action).toBe('none');
  });
});

describe('resolveKey — single keys', () => {
  it('fires the global singles', () => {
    expect(resolve('n')).toMatchObject({ action: 'fire', id: 'add-lead' });
    expect(resolve('?')).toMatchObject({ action: 'fire', id: 'help' });
    expect(resolve('/')).toMatchObject({ action: 'fire', id: 'search' });
    expect(resolve('mod+k')).toMatchObject({ action: 'fire', id: 'palette' });
  });

  it('does not fire a lead shortcut when no lead is open', () => {
    expect(resolve('c').action).toBe('none');
    expect(resolve('w').action).toBe('none');
  });

  it('fires a lead shortcut when a lead is open', () => {
    expect(resolve('c', { scopes: ['global', 'lead'] })).toMatchObject({ action: 'fire', id: 'lead-call' });
    expect(resolve('w', { scopes: ['global', 'lead'] })).toMatchObject({ action: 'fire', id: 'lead-whatsapp' });
    expect(resolve('a', { scopes: ['global', 'lead'] })).toMatchObject({ action: 'fire', id: 'lead-note' });
  });

  it('does nothing for an unmapped key', () => {
    expect(resolve('z').action).toBe('none');
    expect(resolve(null).action).toBe('none');
  });
});

describe('resolveKey — the G sequence', () => {
  const pending: Pending = { prefix: PREFIX_KEY, at: NOW };

  it('waits after G', () => {
    const result = resolve('g');
    expect(result.action).toBe('wait');
    expect(result.pending).toEqual({ prefix: 'g', at: NOW });
  });

  it('goes where the second key says', () => {
    expect(resolveKey('d', { pending, scopes: ['global'], now: NOW + 100, typing: false })).toMatchObject({
      action: 'fire',
      id: 'go-dashboard',
    });
    expect(resolveKey('k', { pending, scopes: ['global'], now: NOW + 100, typing: false })).toMatchObject({
      action: 'fire',
      id: 'go-pipeline',
    });
  });

  it('clears the prefix once it has fired', () => {
    expect(resolveKey('d', { pending, scopes: ['global'], now: NOW, typing: false }).pending).toBeNull();
  });

  it('cancels rather than falling through to a single-key shortcut', () => {
    /* G then N must not add a lead. */
    const result = resolveKey('n', { pending, scopes: ['global'], now: NOW, typing: false });
    expect(result.action).toBe('none');
    expect(result.pending).toBeNull();
  });

  it('cancels rather than calling a client', () => {
    const result = resolveKey('c', { pending, scopes: ['global', 'lead'], now: NOW, typing: false });
    expect(result.action).toBe('none');
  });

  it('forgets the prefix after a pause', () => {
    const late = NOW + SEQUENCE_TIMEOUT_MS + 1;
    expect(resolveKey('d', { pending, scopes: ['global'], now: late, typing: false }).action).toBe('none');
    /* Just inside the window still works. */
    expect(
      resolveKey('d', { pending, scopes: ['global'], now: NOW + SEQUENCE_TIMEOUT_MS, typing: false }).action,
    ).toBe('fire');
  });

  it('starts a fresh sequence when G is pressed twice', () => {
    const result = resolveKey('g', { pending, scopes: ['global'], now: NOW + 50, typing: false });
    /* The second G is an unknown second key, so it cancels. Pressing G again
       after that starts over, which is what somebody expects. */
    expect(result.action).toBe('none');
    expect(resolve('g').action).toBe('wait');
  });

  it('keeps waiting through a key that means nothing', () => {
    const result = resolveKey(null, { pending, scopes: ['global'], now: NOW + 50, typing: false });
    expect(result.pending).toEqual(pending);
  });
});

describe('the table itself', () => {
  it('has no duplicate ids', () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no two shortcuts on the same keys in the same scope', () => {
    const seen = new Set<string>();
    for (const shortcut of SHORTCUTS) {
      const key = `${shortcut.scope}:${shortcut.keys.join('+')}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('never gives a lead action the same letter as a global one', () => {
    const globals = new Set(
      SHORTCUTS.filter((s) => s.scope === 'global' && s.keys.length === 1).map((s) => s.keys[0]),
    );
    for (const shortcut of SHORTCUTS.filter((s) => s.scope === 'lead' && s.keys.length === 1)) {
      expect(globals.has(shortcut.keys[0])).toBe(false);
    }
  });

  it('never uses the prefix key as a single shortcut', () => {
    expect(SHORTCUTS.some((s) => s.keys.length === 1 && s.keys[0] === PREFIX_KEY)).toBe(false);
  });

  it('puts every shortcut in a known group', () => {
    for (const shortcut of SHORTCUTS) {
      expect(SHORTCUT_GROUPS).toContain(shortcut.group as (typeof SHORTCUT_GROUPS)[number]);
    }
  });

  it('groups them all, in order', () => {
    const groups = groupedShortcuts();
    expect(groups.map((entry) => entry.group)).toEqual([...SHORTCUT_GROUPS]);
    expect(groups.reduce((sum, entry) => sum + entry.items.length, 0)).toBe(SHORTCUTS.length);
  });

  it('gives every shortcut a label somebody could read out', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.label.length).toBeGreaterThan(3);
      expect(shortcutLabel(shortcut, false)).not.toMatch(/undefined/);
    }
  });
});

describe('how the keys read', () => {
  it('shows the Mac modifier on a Mac', () => {
    expect(keyLabel('mod', true)).toBe('⌘');
    expect(keyLabel('mod', false)).toBe('Ctrl');
    expect(keyLabel('mod+k', true)).toBe('⌘ K');
    expect(keyLabel('mod+k', false)).toBe('Ctrl K');
  });

  it('spells a sequence out', () => {
    const go = SHORTCUTS.find((s) => s.id === 'go-dashboard')!;
    expect(shortcutLabel(go, false)).toBe('G then D');
  });

  it('spells the palette out', () => {
    const palette = SHORTCUTS.find((s) => s.id === 'palette')!;
    expect(shortcutLabel(palette, true)).toBe('⌘ K');
  });

  it('shortens Escape', () => {
    expect(keyLabel('escape', false)).toBe('Esc');
  });

  it('recognises the Apple platforms', () => {
    expect(isMacLike('MacIntel', undefined)).toBe(true);
    expect(isMacLike(undefined, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(true);
    expect(isMacLike('iPad', undefined)).toBe(true);
    expect(isMacLike('Win32', 'Mozilla/5.0 (Windows NT 10.0)')).toBe(false);
    expect(isMacLike('Linux armv8l', 'Mozilla/5.0 (Linux; Android 14)')).toBe(false);
    expect(isMacLike(undefined, undefined)).toBe(false);
  });
});
