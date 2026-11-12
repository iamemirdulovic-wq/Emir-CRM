import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Icon } from '../design/index.js';
import { Avatar } from '../design/ui.js';

/**
 * One search across everything.
 *
 * `docs/v2/pages.md` §6. Two rules from the design, and both are about not
 * wasting the half second an agent has:
 *
 *  - **Any phone format works.** "050 123 4567", "+971 50 123 4567" and
 *    "971501234567" are the same number to a person, so they are the same
 *    number here: everything but the digits is stripped before asking.
 *  - **It is never an empty box.** Opened with nothing typed it says what it
 *    searches, rather than showing a blank panel that looks broken.
 *
 * Ctrl-K (and ⌘K) open it from anywhere.
 */

/** What `/api/search` returns, in its own words. */
interface SearchHit {
  id: string;
  label: string;
  hint: string | null;
  to: string;
}

interface Hit extends SearchHit {
  kind: 'lead' | 'project';
}

export function Find({ compact }: { compact?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [looking, setLooking] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || term.trim().length < 2) { setHits([]); return undefined; }
    /* A keystroke is not a question. Waiting a moment turns "ahmed" into one
       request instead of five. */
    const timer = window.setTimeout(async () => {
      setLooking(true);
      try {
        const asked = /^[\d\s+()-]+$/.test(term) ? term.replace(/[^\d]/g, '') : term.trim();
        const found = await api.get<{ leads: SearchHit[]; projects: SearchHit[] }>(
          `/api/search?q=${encodeURIComponent(asked)}`,
        );
        setHits([
          ...(found.leads ?? []).map((hit) => ({ ...hit, kind: 'lead' as const })),
          ...(found.projects ?? []).map((hit) => ({ ...hit, kind: 'project' as const })),
        ]);
      } catch {
        setHits([]);
      } finally {
        setLooking(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [open, term]);

  /**
   * Where a hit goes.
   *
   * The search service answers with live-CRM paths (`/leads/o-1`), because it
   * is the live CRM's endpoint. In v2 the same record lives under `/v2`, so
   * the path is moved across rather than a second search being written —
   * one search, two front ends.
   */
  function go(hit: Hit) {
    setOpen(false);
    setTerm('');
    navigate(hit.to.startsWith('/v2') ? hit.to : `/v2${hit.to}`);
  }

  return (
    <>
      <button
        type="button"
        className={compact ? 'v2-search v2-search-compact' : 'v2-search'}
        aria-label="Search"
        onClick={() => setOpen(true)}
      >
        <Icon name="search" />
        {!compact && (
          <>
            <span>Search leads, phone, project…</span>
            <kbd>Ctrl K</kbd>
          </>
        )}
      </button>

      {open && (
        <div className="v2-scrim v2-scrim-top" onMouseDown={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}>
          <div className="v2-finder" role="dialog" aria-label="Search">
            <div className="v2-finder-top">
              <Icon name="search" />
              <input
                ref={field}
                className="v2-finder-input"
                value={term}
                placeholder="Name, phone, project"
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) go(hits[0]); }}
              />
              <kbd>Esc</kbd>
            </div>

            {term.trim().length < 2 && (
              <p className="v2-none v2-finder-hint">
                Type a name, any phone format, or a project. Two letters is enough.
              </p>
            )}

            {term.trim().length >= 2 && looking && <p className="v2-none v2-finder-hint">Looking…</p>}

            {term.trim().length >= 2 && !looking && hits.length === 0 && (
              <div className="v2-finder-hint">
                <p className="v2-none">Nothing found for “{term.trim()}”.</p>
                <button
                  type="button"
                  className="d-btn d-sm d-primary"
                  onClick={() => { setOpen(false); navigate('/v2/leads/new'); }}
                >
                  <Icon name="plus" />Add as a new lead
                </button>
              </div>
            )}

            <ul className="v2-finder-list">
              {hits.slice(0, 12).map((hit) => (
                <li key={`${hit.kind}-${hit.id}`}>
                  <button type="button" className="v2-finder-row" onClick={() => go(hit)}>
                    <Avatar name={hit.label} />
                    <span className="v2-finder-what">
                      <b>{hit.label}</b>
                      {hit.hint && <span>{hit.hint}</span>}
                    </span>
                    <span className="v2-finder-kind">{hit.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
