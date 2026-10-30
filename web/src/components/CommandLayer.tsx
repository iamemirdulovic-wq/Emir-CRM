import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../design/index.js';
import { Modal, useToast } from '../design/ui.js';
import { useAppearance } from '../design/theme.js';
import { api } from '../lib/api.js';
import {
  groupedShortcuts, isMacLike, isTypingTarget, keyOf, resolveKey, shortcutLabel,
  type Pending, type ShortcutId, type ShortcutScope,
} from '../lib/shortcuts.js';
import {
  EMPTY_TOUR, packTourState, parseTourState, shouldOfferTour, type TourState,
} from '../lib/tour.js';
import type { PaletteCommand } from '../lib/palette.js';
import { CommandPalette } from './CommandPalette.js';
import { Tour } from './Tour.js';
import type { Role } from '../lib/types.js';

/**
 * One keyboard listener for the whole app, and the three things it opens: the
 * command palette, the shortcut list, and the tour.
 *
 * One listener rather than one per screen, because two listeners both deciding
 * what N means is how a keystroke ends up doing two things. Screens that want
 * a shortcut of their own — the lead page wants C to call — hand their
 * handlers to this layer through `useLeadShortcuts`, and the layer decides
 * which scope is live.
 */

/** What the lead page fills in while it is open. */
export interface LeadShortcutHandlers {
  call?: () => void;
  whatsapp?: () => void;
  email?: () => void;
  note?: () => void;
  nextStep?: () => void;
}

/*
 * A mutable box passed through context rather than state: the handlers are
 * read inside a key handler, never rendered, so writing to them should not
 * re-render the whole shell on every keystroke of the lead page.
 */
const LeadShortcuts = createContext<{ current: LeadShortcutHandlers | null } | null>(null);

/**
 * The three things the layer opens, for the screens that offer them with a
 * button as well as a key — Settings is where people look for "show me around
 * again", not the command palette.
 */
export interface Commands {
  openPalette: () => void;
  openHelp: () => void;
  startTour: () => void;
}

const CommandContext = createContext<Commands | null>(null);

export function useCommands(): Commands | null {
  return useContext(CommandContext);
}

/**
 * Register this screen's lead shortcuts for as long as it is mounted.
 *
 * Safe to call with a fresh object every render — the box is written to, not
 * subscribed to.
 */
export function useLeadShortcuts(handlers: LeadShortcutHandlers | null): void {
  const box = useContext(LeadShortcuts);
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!box) return;
    box.current = latest.current;
    return () => {
      box.current = null;
    };
    /* `handlers` is read through the ref, so this runs once per mount. */
  }, [box]);

  /* Keep the box in step when the handlers change identity mid-mount. */
  useEffect(() => {
    if (box && box.current !== null) box.current = handlers;
  });
}

/** What the layer needs from the shell. */
export interface CommandLayerProps {
  role: Role;
  onAddLead: () => void;
  onToggleSound: () => void;
  onSignOut: () => void;
  children?: React.ReactNode;
}

export function CommandLayer({ role, onAddLead, onToggleSound, onSignOut, children }: CommandLayerProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const { cycle } = useAppearance();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [tour, setTour] = useState<TourState>(EMPTY_TOUR);
  const [tourOpen, setTourOpen] = useState(false);
  const [recents, setRecents] = useState<string[]>(() => readRecents());

  const pending = useRef<Pending | null>(null);
  /* A ref is already stable, so it is the context value as it stands. */
  const leadBox = useRef<LeadShortcutHandlers | null>(null);
  const shortcutsSeen = useRef(true);

  /* The tour and whether the shortcut hint has been shown come from the
     server, so finishing the tour on a laptop finishes it on the phone too. */
  useEffect(() => {
    let live = true;
    api
      .get<{ prefs: Record<string, string | null> }>('/api/prefs')
      .then(({ prefs }) => {
        if (!live) return;
        const state = parseTourState(prefs.tour_state);
        setTour(state);
        shortcutsSeen.current = prefs.shortcuts_seen === 'yes';
        /* Only somebody who has never seen it gets it unasked, and only after
           a breath, so the app has painted before anything covers it. */
        if (shouldOfferTour(state)) window.setTimeout(() => live && setTourOpen(true), 900);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const savePref = useCallback((name: string, value: string | null) => {
    void api.put('/api/prefs', { name, value }).catch(() => undefined);
  }, []);

  const saveTour = useCallback(
    (next: TourState) => {
      setTour(next);
      savePref('tour_state', packTourState(next));
    },
    [savePref],
  );

  const runCommand = useCallback(
    (command: PaletteCommand) => {
      switch (command) {
        case 'add-lead':
          onAddLead();
          break;
        case 'show-shortcuts':
          setHelpOpen(true);
          break;
        case 'replay-tour':
          saveTour({ step: 0, doneAt: null, skipped: false });
          setTourOpen(true);
          break;
        case 'toggle-theme':
          cycle();
          break;
        case 'toggle-sound':
          onToggleSound();
          break;
        case 'sign-out':
          onSignOut();
          break;
        default:
          break;
      }
    },
    [cycle, onAddLead, onSignOut, onToggleSound, saveTour],
  );

  const fire = useCallback(
    (id: ShortcutId) => {
      const lead = leadBox.current;
      switch (id) {
        case 'palette':
          setPaletteOpen(true);
          return;
        case 'help':
          setHelpOpen(true);
          return;
        case 'add-lead':
          onAddLead();
          return;
        case 'search': {
          /* The top bar's own box, which filters whatever screen is showing —
             a different job from the palette, and worth its own key. */
          const input = document.querySelector<HTMLInputElement>('.top .search input');
          if (input) input.focus();
          else setPaletteOpen(true);
          return;
        }
        case 'go-dashboard':
          navigate('/dashboard');
          return;
        case 'go-leads':
          navigate('/leads');
          return;
        case 'go-today':
          navigate('/leads?tab=today');
          return;
        case 'go-pipeline':
          navigate('/pipeline');
          return;
        case 'go-inbox':
          navigate('/inbox');
          return;
        case 'go-tasks':
          navigate('/tasks');
          return;
        case 'go-incoming':
          navigate('/incoming');
          return;
        case 'go-wall':
          navigate('/wall');
          return;
        case 'go-projects':
          navigate('/projects');
          return;
        case 'go-offers':
          navigate('/offers');
          return;
        case 'go-settings':
          navigate('/settings');
          return;
        case 'lead-call':
          lead?.call?.();
          return;
        case 'lead-whatsapp':
          lead?.whatsapp?.();
          return;
        case 'lead-email':
          lead?.email?.();
          return;
        case 'lead-note':
          lead?.note?.();
          return;
        case 'lead-next-step':
          lead?.nextStep?.();
          return;
        default:
          return;
      }
    },
    [navigate, onAddLead],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      /* While the palette or the tour is open they own the keyboard. */
      if (paletteOpen || tourOpen) return;

      const scopes: ShortcutScope[] = leadBox.current ? ['global', 'lead'] : ['global'];
      const resolved = resolveKey(keyOf(event), {
        pending: pending.current,
        scopes,
        now: Date.now(),
        typing: isTypingTarget(event.target),
      });
      pending.current = resolved.pending;

      if (resolved.action === 'fire') {
        /* Only now, once something is definitely happening: a key we ignore
           must still do whatever the browser would have done with it. */
        event.preventDefault();
        if (helpOpen) setHelpOpen(false);
        fire(resolved.id);
      } else if (resolved.action === 'wait') {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fire, helpOpen, paletteOpen, tourOpen]);

  const finishTour = useCallback(
    (how: 'done' | 'skipped') => {
      setTourOpen(false);
      saveTour({ step: 0, doneAt: new Date().toISOString(), skipped: how === 'skipped' });
      if (how === 'done' && !shortcutsSeen.current) {
        shortcutsSeen.current = true;
        savePref('shortcuts_seen', 'yes');
        toast('That is the tour. Press ? any time to see the keyboard shortcuts.', {
          action: { label: 'Show me', onClick: () => setHelpOpen(true) },
        });
      }
    },
    [savePref, saveTour, toast],
  );

  const onRecents = useCallback((next: string[]) => {
    setRecents(next);
    writeRecents(next);
  }, []);

  const commands = useMemo<Commands>(
    () => ({
      openPalette: () => setPaletteOpen(true),
      openHelp: () => setHelpOpen(true),
      startTour: () => {
        saveTour({ step: 0, doneAt: null, skipped: false });
        setTourOpen(true);
      },
    }),
    [saveTour],
  );

  return (
    <CommandContext.Provider value={commands}>
    <LeadShortcuts.Provider value={leadBox}>
      {children}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        role={role}
        onCommand={runCommand}
        recents={recents}
        onRecents={onRecents}
      />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} hasLead={Boolean(leadBox.current)} />
      <Tour
        open={tourOpen}
        role={role}
        startAt={tour.step}
        onStep={(step) => saveTour({ ...tour, step })}
        onFinish={finishTour}
      />
    </LeadShortcuts.Provider>
    </CommandContext.Provider>
  );
}

/** The `?` sheet. */
export function ShortcutHelp({
  open, onClose, hasLead,
}: {
  open: boolean;
  onClose: () => void;
  hasLead: boolean;
}) {
  const isMac = isMacLike(
    typeof navigator === 'undefined' ? undefined : navigator.platform,
    typeof navigator === 'undefined' ? undefined : navigator.userAgent,
  );

  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" icon="key-round">
      <div className="keys">
        {groupedShortcuts().map((group) => (
          <section key={group.group}>
            <h4>
              {group.group}
              {group.group === 'On a lead' && !hasLead && <small>only on a lead page</small>}
            </h4>
            <dl>
              {group.items.map((shortcut) => (
                <div className="keys-row" key={shortcut.id}>
                  <dt>{shortcut.label}</dt>
                  <dd>
                    {shortcutLabel(shortcut, isMac)
                      .split(' ')
                      .map((part, index) =>
                        part === 'then' ? (
                          <em key={`then-${index}`}>then</em>
                        ) : (
                          <kbd key={`${part}-${index}`}>{part}</kbd>
                        ),
                      )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="keys-note">
        <Icon name="info" />
        <span>Single letters never fire while you are typing in a box.</span>
      </p>
    </Modal>
  );
}

/* --- where the palette's recents live ----------------------------------- */

const RECENTS_KEY = 'homes.palette.recents';

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string').slice(0, 5) : [];
  } catch {
    /* Private mode, blocked storage, or somebody's cleaner. Not worth a word. */
    return [];
  }
}

function writeRecents(ids: string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, 5)));
  } catch {
    /* As above. */
  }
}
