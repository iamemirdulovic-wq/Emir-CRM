import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../design/index.js';
import { Spinner } from '../design/ui.js';
import { api, qs } from '../lib/api.js';
import { useDebounced } from '../lib/hooks.js';
import {
  groupItems, moveSelection, rankStatic, rememberRecent, shouldSearchServer,
  type PaletteCommand, type PaletteItem,
} from '../lib/palette.js';
import { isMacLike } from '../lib/shortcuts.js';
import type { Role } from '../lib/types.js';

/**
 * Cmd+K.
 *
 * The thing it has to beat is the sidebar, which is already good. So it earns
 * its place by doing the one thing the sidebar cannot: finding a person. An
 * agent with a client on the phone types four letters of their name and is on
 * their lead page before the client has finished the sentence.
 *
 * The list is one flat sequence of rows with group headings between them, so
 * the arrow keys walk straight through from the actions into the leads. A
 * palette where Down stops at the end of a section is a palette people go
 * back to the mouse for.
 */

interface SearchHit {
  id: string;
  label: string;
  hint: string | null;
  to: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  role: Role;
  /** Named things the shell knows how to do. */
  onCommand: (command: PaletteCommand) => void;
  recents: string[];
  onRecents: (next: string[]) => void;
}

export function CommandPalette({ open, onClose, role, onCommand, recents, onRecents }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [hits, setHits] = useState<{ leads: SearchHit[]; projects: SearchHit[] }>({ leads: [], projects: [] });
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  /* Three hundred milliseconds: long enough that typing a name is one query
     rather than eight, short enough that it feels like it is keeping up. */
  const debounced = useDebounced(query, 300);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    setHits({ leads: [], projects: [] });
    /* The input is mounted in the same commit, so focus on the next frame. */
    const timer = window.setTimeout(() => input.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = debounced.trim();
    if (!shouldSearchServer(term)) {
      setHits({ leads: [], projects: [] });
      setSearching(false);
      return;
    }

    let live = true;
    setSearching(true);
    api
      .get<{ leads: SearchHit[]; projects: SearchHit[] }>(`/api/search${qs({ q: term })}`)
      .then((result) => {
        if (!live) return;
        setHits({ leads: result.leads ?? [], projects: result.projects ?? [] });
      })
      .catch(() => {
        if (live) setHits({ leads: [], projects: [] });
      })
      .finally(() => {
        if (live) setSearching(false);
      });

    return () => {
      live = false;
    };
  }, [debounced, open]);

  const items = useMemo<PaletteItem[]>(() => {
    const statics = rankStatic(query, { role, recents, limit: query.trim() ? 8 : 10 });
    const leads: PaletteItem[] = hits.leads.map((hit) => ({
      id: `lead:${hit.id}`,
      kind: 'lead',
      label: hit.label,
      hint: hit.hint,
      icon: 'user',
      to: hit.to,
    }));
    const projects: PaletteItem[] = hits.projects.map((hit) => ({
      id: `project:${hit.id}`,
      kind: 'project',
      label: hit.label,
      hint: hit.hint,
      icon: 'building-2',
      to: hit.to,
    }));
    /* Leads first when something was typed: a name is almost always what the
       person is after, and the screens are one keystroke away in the sidebar. */
    return query.trim() ? [...leads, ...projects, ...statics] : statics;
  }, [hits, query, recents, role]);

  const flat = useMemo(() => groupItems(items).flatMap((group) => group.items), [items]);

  useEffect(() => {
    setSelected((current) => (current >= flat.length ? 0 : current));
  }, [flat.length]);

  const run = useCallback(
    (item: PaletteItem) => {
      onRecents(rememberRecent(recents, item.id));
      onClose();
      if (item.command) onCommand(item.command);
      else if (item.to) navigate(item.to);
    },
    [navigate, onClose, onCommand, onRecents, recents],
  );

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      setSelected((current) => moveSelection(current, 1, flat.length));
    } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      setSelected((current) => moveSelection(current, -1, flat.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = flat[selected];
      if (item) run(item);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  /* Keep the highlighted row in view when the arrows walk past the fold. */
  useEffect(() => {
    if (!open) return;
    const row = list.current?.querySelector<HTMLElement>('[data-selected="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected, open]);

  if (!open) return null;

  const groups = groupItems(items);
  const isMac = isMacLike(navigator.platform, navigator.userAgent);
  let index = -1;

  return (
    <div className="palette-back" role="presentation" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search and jump anywhere"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={onKey}
            placeholder="Search a lead, a project, or jump to a screen"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
          />
          {searching && <Spinner label="Searching" />}
          <kbd className="palette-esc">Esc</kbd>
        </div>

        <div className="palette-list" ref={list} role="listbox" aria-label="Results">
          {groups.length === 0 && (
            <p className="palette-none">
              {searching ? 'Looking…' : 'Nothing matches that. Try a name, a number, or a project.'}
            </p>
          )}
          {groups.map((group) => (
            <div className="palette-group" key={group.kind}>
              <h4>{group.label}</h4>
              {group.items.map((item) => {
                index += 1;
                const isSelected = index === selected;
                const at = index;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={isSelected ? 'palette-row on' : 'palette-row'}
                    data-selected={isSelected ? 'true' : 'false'}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setSelected(at)}
                    onClick={() => run(item)}
                  >
                    <span className="palette-icon"><Icon name={item.icon} /></span>
                    <span className="palette-text">
                      <strong>{item.label}</strong>
                      {item.hint && <small>{item.hint}</small>}
                    </span>
                    {item.shortcut && <kbd>{isMac ? item.shortcut.replace('Ctrl', '⌘') : item.shortcut}</kbd>}
                    {!item.shortcut && item.kind === 'lead' && <Icon name="arrow-right" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <footer className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>?</kbd> all shortcuts</span>
        </footer>
      </div>
    </div>
  );
}
