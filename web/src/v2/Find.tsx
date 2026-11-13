import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar } from '../design/ui.js';
import type { Role } from '../lib/types.js';
import { groupsFor, pinnedFor } from './nav.js';

/**
 * One search across everything: the palette, and the page behind it.
 *
 * Built from `design/web/search.html` for the page and from the design's own
 * shell (`design/web/app.js`, which draws `.cmdk`) for the palette. Two rules
 * from the design govern both, and both are about not wasting the half second
 * an agent has:
 *
 *  - **Any phone format works.** "050 123 4567", "+971 50 123 4567" and
 *    "971501234567" are the same number to a person, so they are the same
 *    number here: everything but the digits is stripped before asking.
 *  - **It is never an empty box.** Opened with nothing typed, the palette says
 *    what it searches and the page offers what you looked at last, rather than
 *    showing a blank panel that looks broken.
 *
 * Ctrl-K (and ⌘K) open the palette from anywhere.
 */

/** What `/api/search` returns, in its own words. */
interface SearchHit {
  id: string;
  label: string;
  hint: string | null;
  to: string;
}

type Kind = 'lead' | 'project' | 'screen';

interface Hit extends SearchHit {
  kind: Kind;
  icon?: IconName;
}

const RECENT_KEY = 'homes.v2.recent-searches';
const KIND_WORD: Record<Kind, string> = { lead: 'Leads', project: 'Projects', screen: 'Screens' };

/**
 * Where a hit goes.
 *
 * The search service answers with live-CRM paths (`/contacts/c-1`), because it
 * is the live CRM's endpoint. In v2 the same record lives under `/v2`, so the
 * path is moved across rather than a second search being written — one
 * search, two front ends.
 */
function where(to: string): string {
  return to.startsWith('/v2') ? to : `/v2${to}`;
}

/** Everything in this person's own menu, searchable by name. */
function screensFor(role: Role): Hit[] {
  const out: Hit[] = [];
  for (const group of groupsFor(role)) {
    for (const item of group.items) {
      if (item.later) continue;
      out.push({ id: item.to, label: item.label, hint: 'Screen', to: item.to, kind: 'screen', icon: item.icon });
    }
  }
  for (const item of pinnedFor(role)) {
    out.push({ id: item.to, label: item.label, hint: 'Screen', to: item.to, kind: 'screen', icon: item.icon });
  }
  return out;
}

/** The digits of a phone number, however it was typed. */
function asked(term: string): string {
  return /^[\d\s+()-]+$/.test(term) ? term.replace(/[^\d]/g, '') : term.trim();
}

/**
 * Ask the server, and fold in the screens this person can reach.
 *
 * The screens are matched here rather than on the server because they are not
 * data — they are this app's own menu, and the menu already knows which rows
 * a role is allowed.
 */
function useHits(term: string, role: Role, live: boolean): { hits: Hit[]; looking: boolean } {
  const [found, setFound] = useState<Hit[]>([]);
  const [looking, setLooking] = useState(false);
  const screens = useMemo(() => screensFor(role), [role]);

  useEffect(() => {
    const words = term.trim().toLowerCase();
    if (!live || words.length < 2) { setFound([]); setLooking(false); return undefined; }

    const hereAndNow = screens.filter((one) => one.label.toLowerCase().includes(words));

    /* A keystroke is not a question. Waiting a moment turns "ahmed" into one
       request instead of five. */
    const timer = window.setTimeout(async () => {
      setLooking(true);
      try {
        const got = await api.get<{ leads: SearchHit[]; projects: SearchHit[] }>(
          `/api/search?q=${encodeURIComponent(asked(term))}`,
        );
        setFound([
          ...(got.leads ?? []).map((hit) => ({ ...hit, kind: 'lead' as const })),
          ...(got.projects ?? []).map((hit) => ({ ...hit, kind: 'project' as const, icon: 'building' as const })),
          ...hereAndNow,
        ]);
      } catch {
        /* The screens still match without the server, which is the half of
           this that never needs it. */
        setFound(hereAndNow);
      } finally {
        setLooking(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [term, live, screens]);

  return { hits: found, looking };
}

/** The last few things somebody searched for, per browser. */
function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function keepRecent(term: string): void {
  const word = term.trim();
  if (word.length < 2) return;
  try {
    const next = [word, ...readRecent().filter((one) => one !== word)].slice(0, 5);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* A private window is not a reason to refuse to search. */
  }
}

/* ── the palette in the top bar ────────────────────────────────────────── */

export function Find({ compact }: { compact?: boolean } = {}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { hits, looking } = useHits(term, user?.role ?? 'agent', open);

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

  useEffect(() => setPicked(0), [term]);

  const shown = hits.slice(0, 12);

  function go(hit: Hit) {
    setOpen(false);
    keepRecent(term);
    setTerm('');
    navigate(where(hit.to));
  }

  function openAll() {
    setOpen(false);
    keepRecent(term);
    navigate(`/v2/search?q=${encodeURIComponent(term.trim())}`);
    setTerm('');
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
        <div
          className="v2-scrim v2-scrim-top"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="d-cmdk d-open" role="dialog" aria-label="Search">
            <div className="d-cmdk-input">
              <Icon name="search" />
              <input
                ref={field}
                value={term}
                placeholder="Name, phone, project, screen"
                aria-label="Search"
                onChange={(e) => setTerm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setPicked((n) => Math.min(n + 1, Math.max(0, shown.length - 1)));
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setPicked((n) => Math.max(0, n - 1));
                  }
                  if (e.key === 'Enter') {
                    const hit = shown[picked];
                    if (hit) go(hit); else if (term.trim().length >= 2) openAll();
                  }
                }}
              />
              <kbd>Esc</kbd>
            </div>

            <div className="d-cmdk-list">
              {term.trim().length < 2 && (
                <p className="d-cmdk-group">
                  Type a name, any phone format, a project or a screen. Two letters is enough.
                </p>
              )}

              {term.trim().length >= 2 && looking && shown.length === 0 && (
                <p className="d-cmdk-group">Looking…</p>
              )}

              {term.trim().length >= 2 && !looking && shown.length === 0 && (
                <p className="d-cmdk-group">Nothing found for “{term.trim()}”.</p>
              )}

              {shown.map((hit, i) => (
                <button
                  key={`${hit.kind}-${hit.id}`}
                  type="button"
                  className={i === picked ? 'd-cmdk-item d-sel' : 'd-cmdk-item'}
                  onMouseEnter={() => setPicked(i)}
                  onClick={() => go(hit)}
                >
                  <span className="d-ic">
                    <Icon name={hit.icon ?? (hit.kind === 'lead' ? 'user' : 'building')} />
                  </span>
                  <span className="d-t">
                    <b>{hit.label}</b>
                    {hit.hint && <span>{hit.hint}</span>}
                  </span>
                  <span className="d-tag">{KIND_WORD[hit.kind]}</span>
                </button>
              ))}
            </div>

            <div className="d-cmdk-foot">
              <span><kbd>↵</kbd>open</span>
              <span><kbd>↑</kbd><kbd>↓</kbd>move</span>
              <span className="d-grow" />
              {term.trim().length >= 2 && (
                <button type="button" className="d-btn d-xs" onClick={openAll}>
                  See every result
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── the whole page ────────────────────────────────────────────────────── */

const EXAMPLES = ['050', 'Dubai', 'pipeline', 'offers'];

export function V2Find() {
  const { user } = useAuth();
  const role = user?.role ?? 'agent';
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [kind, setKind] = useState<'all' | Kind>('all');
  const field = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { hits, looking } = useHits(term, role, true);
  const recent = useMemo(readRecent, [term]);

  useEffect(() => { field.current?.focus(); }, []);

  /* The address carries the search, so a result can be shared and the back
     button goes back to what was typed before. */
  useEffect(() => {
    const word = term.trim();
    const timer = window.setTimeout(() => {
      setParams(word ? { q: word } : {}, { replace: true });
      keepRecent(word);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [term, setParams]);

  const counts: Record<string, number> = {
    all: hits.length,
    lead: hits.filter((one) => one.kind === 'lead').length,
    project: hits.filter((one) => one.kind === 'project').length,
    screen: hits.filter((one) => one.kind === 'screen').length,
  };
  const shown = kind === 'all' ? hits : hits.filter((one) => one.kind === kind);
  const typed = term.trim().length >= 2;
  const looksLikePhone = /^[\d\s+()-]{5,}$/.test(term.trim());

  return (
    <div className="v2-find-page p-find">
      <div className="d-sr">
        <div className="d-sr-box">
          <Icon name="search" size={22} />
          <input
            ref={field}
            type="text"
            value={term}
            autoComplete="off"
            aria-label="Search"
            placeholder="Name, phone, project, screen"
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setTerm('');
              if (e.key === 'Enter' && shown[0]) navigate(where(shown[0].to));
            }}
          />
          {term && (
            <button
              type="button"
              className="d-btn d-icon d-sm d-ghost"
              aria-label="Clear"
              onClick={() => { setTerm(''); field.current?.focus(); }}
            >
              <Icon name="x" />
            </button>
          )}
          <kbd>Enter opens the first result</kbd>
        </div>

        <div className="d-row d-mt-16">
          <div className="d-tabs d-pills d-mb-0" role="tablist">
            {([['all', 'All'], ['lead', 'Leads'], ['project', 'Projects'], ['screen', 'Screens']] as const)
              .map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={kind === key}
                  className={kind === key ? 'd-tab d-on' : 'd-tab'}
                  onClick={() => setKind(key)}
                >
                  {label}
                  {typed && <span className="d-count">{counts[key] ?? 0}</span>}
                </button>
              ))}
          </div>
          <span className="d-grow" />
          {typed && (
            <span className="d-result-count">
              {shown.length} {shown.length === 1 ? 'result' : 'results'}
            </span>
          )}
        </div>

        {!typed && (
          <div className="d-mt-24">
            <h4 className="d-mb-8">{recent.length > 0 ? 'Recent' : 'Try one of these'}</h4>
            <div className="d-row d-wrap d-gap-8">
              {(recent.length > 0 ? recent : EXAMPLES).map((one) => (
                <button key={one} type="button" className="d-chip-opt" onClick={() => setTerm(one)}>
                  <Icon name="clock" />{one}
                </button>
              ))}
            </div>
          </div>
        )}

        {typed && shown.length > 0 && (
          <div className="d-card d-pad-sm d-mt-16">
            {(['lead', 'project', 'screen'] as const).map((group) => {
              const rows = shown.filter((one) => one.kind === group);
              if (rows.length === 0) return null;
              return (
                <div key={group}>
                  <div className="d-sr-grp">{KIND_WORD[group]} · {rows.length}</div>
                  {rows.map((hit) => (
                    <Link className="d-sr-row" to={where(hit.to)} key={`${hit.kind}-${hit.id}`}>
                      {hit.kind === 'lead'
                        ? <Avatar name={hit.label} size={34} />
                        : (
                          <span className="d-card-icon">
                            <Icon name={hit.icon ?? 'building'} />
                          </span>
                        )}
                      <span className="d-grow">
                        <b>{hit.label}</b>
                        {hit.hint && hit.kind !== 'screen' && <span className="d-sub">{hit.hint}</span>}
                      </span>
                      <span className="d-sr-type">{group}</span>
                      <Icon name="chevron-right" />
                    </Link>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {typed && looking && shown.length === 0 && (
          <div className="d-card d-mt-16"><p className="d-muted d-small">Looking…</p></div>
        )}

        {typed && !looking && shown.length === 0 && (
          <div className="d-card d-mt-16">
            <div className="d-empty">
              <span className="d-ic"><Icon name="search" /></span>
              <b>Nothing found</b>
              <p>
                {kind !== 'all' && hits.length > 0
                  ? `No ${KIND_WORD[kind].toLowerCase()} for “${term.trim()}”. There are ${hits.length} results in other groups.`
                  : looksLikePhone
                    ? `No lead has the number ${term.trim()}. It is a new number.`
                    : `No lead, project or screen for “${term.trim()}”.`}
              </p>
              <div className="d-btn-row">
                <Link
                  className="d-btn d-primary"
                  to={`/v2/leads/new?${looksLikePhone ? 'phone' : 'name'}=${encodeURIComponent(term.trim())}`}
                >
                  <Icon name="plus" />Add as a new lead
                </Link>
                <Link className="d-btn" to="/v2/ai"><Icon name="sparkles" />Ask Homes AI</Link>
              </div>
            </div>
          </div>
        )}

        <p className="d-small d-muted d-mt-16">
          {role === 'agent'
            ? 'You can open your own leads and the free leads. Type a phone number in any form: +971 50…, 050… or 0097150…'
            : 'You see every lead. Type a phone number in any form: +971 50…, 050… or 0097150…'}
        </p>
      </div>
    </div>
  );
}
