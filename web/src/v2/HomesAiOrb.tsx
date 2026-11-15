import {
  Fragment, useCallback, useEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Icon } from '../design/index.js';
import { useMaybeAuth } from '../lib/auth.js';
import type { Role } from '../lib/types.js';
import {
  extraScreensFor, groupsFor, MESSAGE_ITEMS, PHONE_BAR, pinnedFor,
} from './nav.js';
import '../styles/v2-homes-ai.css';

/**
 * Homes AI: the orb in the corner of every v2 screen, and the panel it grows
 * into.
 *
 * Emir, 14 Nov: *"A small glowing Homes AI orb sits in the corner of EVERY
 * page, on computer and phone. It is never hidden. One tap on the orb opens
 * Homes AI as a panel over the page, so the agent never leaves what he is
 * doing. It knows which page I am on. Ctrl + J opens it on computer."*
 *
 * ── What this file is, and what it is not ───────────────────────────────
 *
 * This is the **shell**: the thing that looks alive, opens from any screen,
 * knows where it was opened from, and gets out of the way of the phone's
 * bottom bar. The part that answers — the reading of leads, messages and the
 * project library — is being built in `server/` at the same time, so **this
 * calls no API at all**. It takes its content through `HomesAiBrain` and,
 * until one is handed to it, shows a stand-in that says plainly that it is
 * not connected yet.
 *
 * That stand-in is deliberately dull. CLAUDE.md's hard rules are explicit
 * that nothing invents a number, a price or a payment plan, and a mocked-up
 * answer with a count in it is exactly how a demo becomes a belief. So the
 * stand-in answers with what it is, not with data.
 *
 * ── How the brain plugs in ──────────────────────────────────────────────
 *
 * ```tsx
 * <HomesAiOrb brain={{ view, ask, stop }} />
 * ```
 *
 * `view` is a plain, serialisable snapshot — status, turns, hints — so the
 * brain can live anywhere (a hook, a context, a store) without this file
 * knowing. `ask` is given the question *and the place it was asked from*,
 * because "it knows which page I am on" is a property of the question.
 *
 * ── Where the orb sits ──────────────────────────────────────────────────
 *
 * Three placements, and each of them is a decision somebody made after
 * looking at a screenshot of the one before it.
 *
 *  1. **Phone, bottom bar showing — bottom LEFT**, a bar's height clear of
 *     it. It was above the dial button, and two orange circles stacked in one
 *     corner read as a mistake rather than a design. Opposite corners read as
 *     deliberate. All in CSS, keyed off the `v2-has-bar` class the shell sets.
 *  2. **Phone, no bottom bar — docked in that screen's own header**, beside
 *     the control already at its top right. Those screens are full attention
 *     and a floating orb on them sits on a client's details while somebody is
 *     on a call, so it does not float there at all: `usePlacement` finds the
 *     header and the orb is portalled into it, which lets that header's own
 *     flex row make room instead of this file reaching into its stylesheet.
 *     Email and a chat take it for nothing — measured, their rows have slack.
 *  3. **The dialler — no orb at all**, because its header had no slack and
 *     the screen has no free corner. Homes AI is an item in the ☰ menu it
 *     already has. The full reckoning is above `NO_ORB`, and it is worth
 *     reading before anyone puts an orb back on that screen.
 *  4. **Computer — bottom right, stepping aside when a control is under it.**
 *     It sat on the ⋯ at the end of the last visible row of the leads table.
 *     `useDodge` measures and shifts it left to the first clear place.
 */

/* ── The typed surface the brain fills ───────────────────────────────────── */

/**
 * What the orb is doing, in the owner's own four words.
 *
 *  - `idle` — breathing.
 *  - `working` — spinning faster and brighter.
 *  - `speaking` — it has something to say; a soft ring pulses out.
 *  - `done` — green for one second.
 */
export type HomesAiStatus = 'idle' | 'working' | 'speaking' | 'done';

/** Where the question was asked from. */
export interface HomesAiPlace {
  /** The route, e.g. `/v2/leads`. */
  path: string;
  /** What that screen is called in the menu, e.g. `My leads`. */
  page: string;
}

/** One turn of the conversation. `body` is plain text and is rendered as such. */
export interface HomesAiTurn {
  id: string;
  who: 'me' | 'ai';
  body: string;
  /** The read-only tools an answer went through, shown as a quiet line. */
  tools?: string[];
  /** An answer that failed, drawn in the red tint rather than silently. */
  failed?: boolean;
}

/** A suggested question. Tapping it asks `ask ?? label`. */
export interface HomesAiHint {
  id: string;
  label: string;
  ask?: string;
}

/** Everything the panel draws. Plain data, so it can come from anywhere. */
export interface HomesAiView {
  status: HomesAiStatus;
  /** The line above the hints when there is no conversation yet. */
  greeting?: string;
  turns: HomesAiTurn[];
  hints: HomesAiHint[];
  /** How many things it wants to say. Shown on the orb while it is shut. */
  waiting?: number;
  /** The field's placeholder. */
  prompt?: string;
  /** The small print under the field. */
  footnote?: string;
}

/** The brain. One snapshot out, one question in. */
export interface HomesAiBrain {
  view: HomesAiView;
  ask: (question: string, place: HomesAiPlace) => void;
  /** Offered while it is working, if the brain can be interrupted. */
  stop?: () => void;
}

export interface HomesAiOrbProps {
  /** The brain. Without one, the stand-in below. */
  brain?: HomesAiBrain;
  /** Open on mount. For tests and for the proof screenshots. */
  startOpen?: boolean;
}

/* ── Opening it from elsewhere ───────────────────────────────────────────── */

const OPEN_EVENT = 'homes-ai:open';
const STATUS_EVENT = 'homes-ai:status';

/**
 * Open the panel from anywhere — a button on a screen, a notification.
 *
 * A window event rather than a context, because a context needs a provider
 * above every screen and the orb is mounted once by the shell. One line in
 * `Shell.tsx` is the whole of its footprint, and that is on purpose.
 */
export function openHomesAi(): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

/**
 * Put the orb into a state from outside.
 *
 * It is how a long job says "done" (green for a second) and how anything that
 * finds something worth saying makes it pulse. It only moves the stand-in: a
 * brain of its own reports status through `view`, which always wins.
 */
export function showHomesAiStatus(status: HomesAiStatus): void {
  window.dispatchEvent(new CustomEvent<HomesAiStatus>(STATUS_EVENT, { detail: status }));
}

/* ── Which page am I on ──────────────────────────────────────────────────── */

/**
 * The name of the screen, from `nav.ts` rather than a second list.
 *
 * The menu already knows what every screen is called and who may open it, so
 * a copy here would be a copy that drifts. Longest match wins: `/v2/settings`
 * and `/v2/settings/team` are both rows, and the deeper one is the answer.
 */
export function pageName(pathname: string, role: Role): string {
  const items = [
    ...groupsFor(role).flatMap((group) => group.items),
    ...MESSAGE_ITEMS,
    ...pinnedFor(role),
    ...extraScreensFor(role),
    ...PHONE_BAR,
  ];

  let best: { to: string; label: string } | null = null;
  for (const one of items) {
    const [path] = one.to.split('?');
    if (!path) continue;
    /* `/v2` is every route's prefix, so it only ever matches exactly — or
       every unknown screen would report itself as the dashboard. */
    const hit = path === '/v2' ? pathname === '/v2' : (pathname === path || pathname.startsWith(`${path}/`));
    if (!hit) continue;
    if (!best || path.length > best.to.length) best = { to: path, label: one.label };
  }
  if (best) return best.label;

  /* Something `nav.ts` does not name: say the last part of the address rather
     than "homes.me", which tells the person nothing. */
  const last = pathname.replace(/\/$/, '').split('/').pop() ?? '';
  if (!last || last === 'v2') return 'homes.me';
  return last.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/* ── The stand-in, until the brain lands ─────────────────────────────────── */

/** Questions that are safe to suggest anywhere: none of them is an answer. */
const HINTS: { at: string; ask: string[] }[] = [
  { at: '/v2/leads', ask: ['Who should I call first?', 'Which of these are going cold?'] },
  { at: '/v2/pipeline', ask: ['What is stuck here?', 'Which deals need me today?'] },
  { at: '/v2/projects', ask: ['Which project do my leads ask about most?'] },
  { at: '/v2/calendar', ask: ['What is my day today?'] },
  { at: '/v2/tasks', ask: ['What should I do first?'] },
  { at: '/v2/inbox', ask: ['Who is waiting for a reply?'] },
  { at: '/v2/team', ask: ['How is the team doing today?'] },
  { at: '/v2/offers', ask: ['Which offers were opened and not answered?'] },
];

const EVERYWHERE = ['What needs me now?', 'What should I do next?'];

function hintsFor(path: string): HomesAiHint[] {
  const found = HINTS.find((one) => path === one.at || path.startsWith(`${one.at}/`));
  const asks = [...(found?.ask ?? []), ...EVERYWHERE].slice(0, 3);
  return asks.map((label, i) => ({ id: `h${i}`, label }));
}

/**
 * What the stand-in says when asked.
 *
 * It is not an answer and does not pretend to be one. The alternative — a
 * plausible sentence with a number in it — is how a placeholder gets quoted
 * back as fact, and CLAUDE.md is explicit that nothing here invents a figure.
 */
function standInAnswer(place: HomesAiPlace): string {
  return `I can see you are on ${place.page}.\n\n`
    + 'The part of me that reads the CRM is still being built, so I cannot '
    + 'answer this one yet. I would rather say that than make something up.';
}

let turnId = 0;

/** A brain-shaped stand-in: it holds a conversation, it just knows nothing. */
function useStandIn(place: HomesAiPlace, open: boolean): HomesAiBrain {
  const [turns, setTurns] = useState<HomesAiTurn[]>([]);
  const [status, setStatus] = useState<HomesAiStatus>('idle');
  const timers = useRef<number[]>([]);

  /* Every timer is cancellable, and all of them go on unmount. A `done` flash
     that fires after the orb has gone is a React warning in the console and a
     setState on nothing. */
  useEffect(() => () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  /* Anything outside can set the state — see `showHomesAiStatus`. */
  useEffect(() => {
    const onStatus = (e: Event) => {
      const next = (e as CustomEvent<HomesAiStatus>).detail;
      if (next) setStatus(next);
    };
    window.addEventListener(STATUS_EVENT, onStatus);
    return () => window.removeEventListener(STATUS_EVENT, onStatus);
  }, []);

  /* Opened: there is nothing left to announce. */
  useEffect(() => {
    if (open) setStatus((was) => (was === 'speaking' ? 'idle' : was));
  }, [open]);

  const ask = useCallback((question: string, asked: HomesAiPlace) => {
    turnId += 1;
    setTurns((was) => [...was, { id: `me-${turnId}`, who: 'me', body: question }]);
    setStatus('working');

    const answer = window.setTimeout(() => {
      turnId += 1;
      setTurns((was) => [...was, { id: `ai-${turnId}`, who: 'ai', body: standInAnswer(asked) }]);
      setStatus('done');
      /* Green for one second, then back to breathing. */
      timers.current.push(window.setTimeout(() => setStatus('idle'), 1000));
    }, 850);
    timers.current.push(answer);
  }, []);

  return useMemo(() => ({
    view: {
      status,
      /*
       * Not "ask me about ${page}": the menu's labels are not all nouns, and
       * lower-casing one gives "Ask me about start calling". The screen's
       * name is stated once, in the head, where it is a fact rather than a
       * sentence that has to parse.
       */
      greeting: 'I am here on every screen. Ask me about what you are looking at, '
        + 'or anything else in the CRM.',
      turns,
      hints: hintsFor(place.path),
      prompt: 'Ask Homes AI…',
      footnote: 'It reads your own CRM only, and never messages a client by itself.',
    },
    ask,
  }), [ask, place.page, place.path, status, turns]);
}

/* ── A device that cannot afford the heavy version ───────────────────────── */

const LITE_KEY = 'homes.v2.ai-orb-lite';

function remembered(): boolean | null {
  try {
    const seen = window.sessionStorage.getItem(LITE_KEY);
    return seen === null ? null : seen === '1';
  } catch {
    /* A private window is not a reason to refuse to draw the orb. */
    return null;
  }
}

function remember(lite: boolean): void {
  try {
    window.sessionStorage.setItem(LITE_KEY, lite ? '1' : '0');
  } catch { /* see above */ }
}

/** Phones that say up front that they are small. */
function weakDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2) return true;
  return typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0
    && nav.hardwareConcurrency <= 2;
}

/**
 * "On a slow phone, switch the heavy effects off by itself."
 *
 * It measures the thing it is about to be judged on: the orb is already
 * animating, so after a second and a bit — long enough for the screen's own
 * rise-in to finish — it times two dozen frames and takes the median. The
 * answer is kept for the tab, so it is measured once and not once per screen.
 *
 * The median, not the mean: one 300ms garbage collection in the middle of the
 * sample would otherwise condemn a fast phone to the flat orb all day.
 *
 * **It measures the page, not the orb**, because that is all a frame clock
 * can see — and it is the right thing to measure anyway: what matters is
 * whether this device, on this screen, can afford what the orb is doing.
 * Measured in a software-rendered container, the orb itself costs nothing
 * either way (60fps at 390px with it and without it, on the same screen);
 * the leads table at 1440px was at 20fps with the orb removed entirely.
 *
 * So the bar is set low on purpose: 26ms a frame is under 40fps, which is a
 * screen that is already stuttering without any help from us. Anything
 * tighter demotes phones that were coping.
 */
const SLOW_FRAME_MS = 26;

function useLiteMode(): boolean {
  const [lite, setLite] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return remembered() ?? weakDevice();
  });

  useEffect(() => {
    if (remembered() !== null) return undefined;
    if (typeof window.requestAnimationFrame !== 'function') return undefined;

    let frame = 0;
    const gaps: number[] = [];
    let last = 0;

    const start = window.setTimeout(() => {
      /* A hidden tab throttles rAF to a crawl; that is the browser saving
         battery, not a slow phone. */
      if (document.visibilityState !== 'visible') return;
      const step = (now: number) => {
        if (last) gaps.push(now - last);
        last = now;
        if (gaps.length < 24) {
          frame = window.requestAnimationFrame(step);
          return;
        }
        const sorted = [...gaps].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] ?? 16;
        const slow = median > SLOW_FRAME_MS;
        remember(slow);
        setLite(slow);
      };
      frame = window.requestAnimationFrame(step);
    }, 1200);

    return () => {
      window.clearTimeout(start);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return lite;
}

/* ── Where it goes on this screen ────────────────────────────────────────── */

/** Under this, the phone layout. The same line the shell draws. */
const PHONE = 768;

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia(`(max-width:${PHONE - 1}px)`).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(`(max-width:${PHONE - 1}px)`);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/**
 * Is the phone's floating bar on screen?
 *
 * The shell already knows — it puts `v2-has-bar` on the root `.v2` element —
 * and it knows two things this component cannot work out from the address
 * alone: a chat thread takes the bar away without changing the route, and so
 * does any other screen that calls `useFullAttention`. So rather than keep a
 * second list that drifts, this watches the class the shell sets. One
 * observer, one element, one attribute.
 */
function useHasBar(dock: { current: HTMLElement | null }): boolean {
  const [hasBar, setHasBar] = useState(false);
  useEffect(() => {
    const root = dock.current?.parentElement;
    if (!root || typeof MutationObserver !== 'function') return undefined;
    const read = () => setHasBar(root.classList.contains('v2-has-bar'));
    read();
    const watch = new MutationObserver(read);
    watch.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => watch.disconnect();
  }, [dock]);
  return hasBar;
}

/**
 * The header rows the orb docks into on the full-attention screens.
 *
 * In the order they are looked for, and only one of them is ever on screen: a
 * chat draws its own header and email keeps the shell's. The sign-in page is
 * outside this shell altogether, so it has no orb at all, and the dialler is
 * `NO_ORB` below.
 */
const DOCK_HOSTS = ['.d-ib-head', '.v2-ptop-row'];

/**
 * The phone dialler gets no orb at all — not floating, not docked.
 *
 * **Read this before putting one back.** Three placements were tried on this
 * screen and each was rejected after a screenshot:
 *
 *  1. *Bottom right, where the hidden bar would have been.* It landed on
 *     **Next lead**, and `v2-dialler.css` carries Emir's rule in capitals:
 *     "Nothing may cover the bottom bar: Back, Skip, Next lead."
 *  2. *Floating halfway down the right edge.* Rejected on reviewing the
 *     screenshot: half over the "Wants · 2 Bedroom" chip, attached to
 *     nothing. On a full-attention screen it should not float at all.
 *  3. *Docked in the header, like the chat and email.* Those two cost 0px —
 *     measured, their rows have slack. This one does not: the header row is
 *     ✕ + title + the points pill + ☰ edge to edge at 390px, so a 36px orb
 *     took the title's column from 126px to 83px. The header grew 46px → 71px,
 *     "POWER DIALLER · 11 LEFT AFTER THIS" wrapped to four lines, "Lead 1 of
 *     12" truncated to "Lead 1 …", and the 25px pushed the lead card down far
 *     enough to clip **"Emaar Beachfront"** mid-word — the client's project
 *     name, on the screen an agent uses all day.
 *
 * **Attribution.** The three rejections above were decided inside the build,
 * on screenshots. Emir has not seen these placements and did not say any of
 * this; an earlier draft of this comment quoted him for two of them and it
 * was wrong. Covering the points pill was refused for a reason that IS his:
 * he asked for "+2 if they answer" by name, so it is a reward signal, not
 * decoration. Do not quote a decision back to him as his own words.
 *
 * Covering the points pill instead was considered and refused: the owner
 * asked for that pill by name and it is a reward signal, not decoration.
 *
 * So on this one screen Homes AI lives in the ☰ menu — `MENU_HOST` — which
 * reflows nothing and covers nothing. That is the honest reading of "never
 * hidden" for a screen with no room left.
 */
const NO_ORB = '.v2-a-dial';

/** The foot of the dialler's ☰ sheet, where "Ask Homes AI" is added. */
const MENU_HOST = '.v2-a-dial .d-dialog-foot';

/** Where the orb goes on the screen that is open right now. */
interface Placement {
  /** The header to dock into, or null to float. */
  host: HTMLElement | null;
  /** True on the dialler: no orb at all, and the panel rides above it. */
  suppressed: boolean;
  /** The foot of the dialler's ☰ sheet, while it is open. */
  menu: HTMLElement | null;
}

/**
 * Follow the screen: whether there is an orb at all, and where it goes.
 *
 * It watches rather than looking once, because none of these appear on a
 * schedule: the screen that owns a header may mount a second after the route
 * changes, a chat's header appears when a thread opens (not a route change at
 * all), and the dialler's ☰ sheet comes and goes while the route stands
 * still.
 *
 * The watching matters. The first version gave up after forty tries at 50ms,
 * and on a cold load of `/v2/calling` in a slow container the dialler had not
 * drawn its header inside those two seconds: the orb fell back to floating
 * and landed on the Back button. Arriving at the same screen from inside the
 * app worked — the worst kind of bug to be told about.
 */
function usePlacement(active: boolean, pathname: string, hasBar: boolean): Placement {
  const [place, setPlace] = useState<Placement>({ host: null, suppressed: false, menu: null });

  useEffect(() => {
    if (!active) {
      setPlace((was) => (was.host || was.suppressed || was.menu
        ? { host: null, suppressed: false, menu: null } : was));
      return undefined;
    }

    const look = () => {
      const dialler = document.querySelector<HTMLElement>(NO_ORB);
      const next: Placement = dialler
        /* The dialler: no orb, and the ☰ sheet's foot if it is open. */
        ? { host: null, suppressed: true, menu: document.querySelector<HTMLElement>(MENU_HOST) }
        : {
          host: DOCK_HOSTS.reduce<HTMLElement | null>(
            (found, one) => found ?? document.querySelector<HTMLElement>(one),
            null,
          ),
          suppressed: false,
          menu: null,
        };
      setPlace((was) => (was.host === next.host && was.suppressed === next.suppressed
        && was.menu === next.menu ? was : next));
    };

    look();
    if (typeof MutationObserver !== 'function') return undefined;
    /*
     * This one stays connected for as long as the screen does, rather than
     * stopping at the first match: the ☰ sheet opens and closes, and a thread
     * is opened and left, all without the route changing.
     */
    const watch = new MutationObserver(look);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [active, pathname, hasBar]);

  /* A host that has left the document would take the orb with it. */
  useEffect(() => {
    const { host } = place;
    if (!host) return undefined;
    const check = window.setInterval(() => {
      if (!host.isConnected) setPlace((was) => ({ ...was, host: null }));
    }, 400);
    return () => window.clearInterval(check);
  }, [place]);

  return place;
}

/** How far left the orb may step on a computer, and in what increments. */
const DODGE_CAP = 180;
const DODGE_STEP = 8;

/**
 * Step out of the way of a control on a computer.
 *
 * The owner's rule, 14 Nov: *"Content is fine to overlap; a control is not."*
 * In the bottom-right corner of the leads table that is the ⋯ at the end of
 * the last visible row, and no single inset fixes it everywhere — measured
 * over twelve screens at 1440×900, the corner is clear on five of them and
 * what it takes to be clear runs from 22px to 280px depending on the screen.
 * So it is measured, once per screen, rather than guessed:
 *
 *  - only elements in the horizontal band the orb sits in are considered,
 *    because the orb only ever moves sideways;
 *  - it steps left to the first clear place, in 8px steps;
 *  - past `DODGE_CAP` it stops looking and stays in the corner, because an
 *    orb a third of the way across the screen is not in the corner any more.
 *
 * Twice per screen: once on arrival, and again when the data has landed and
 * the table has rows in it.
 */
function useDodge(active: boolean, pathname: string, still: boolean, orb: { current: HTMLElement | null }): number {
  const [dodge, setDodge] = useState(0);
  const now = useRef(0);
  now.current = dodge;

  useEffect(() => {
    if (!active || !still) return undefined;

    const measure = () => {
      const node = orb.current;
      if (!node) return;
      const box = node.getBoundingClientRect();
      if (box.width === 0) return;
      /* Where it would be with no dodge at all. */
      const home = box.left + now.current;

      const inTheWay: DOMRect[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [role="button"], [role="switch"]',
      )) {
        if (el.closest('.v2-ai-dock') || el.closest('.v2-ai-docked')) continue;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        if (b.bottom <= box.top || b.top >= box.bottom) continue;
        inTheWay.push(b);
      }

      const clearAt = (left: number) => !inTheWay.some(
        (b) => b.right > left && b.left < left + box.width,
      );
      for (let step = 0; step <= DODGE_CAP; step += DODGE_STEP) {
        if (clearAt(home - step)) {
          setDodge(step);
          return;
        }
      }
      setDodge(0);
    };

    measure();
    const again = window.setTimeout(measure, 900);
    let settle = 0;
    const onResize = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(measure, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(again);
      window.clearTimeout(settle);
      window.removeEventListener('resize', onResize);
    };
  }, [active, pathname, still, orb]);

  return dodge;
}

/* ── The orb ─────────────────────────────────────────────────────────────── */

/** How long the closing animation lasts, and `v2-homes-ai.css` agrees. */
const SHUT_MS = 220;

export function HomesAiOrb({ brain, startOpen = false }: HomesAiOrbProps = {}) {
  const { pathname } = useLocation();
  const auth = useMaybeAuth();
  const role: Role = auth?.user?.role ?? 'agent';

  /* `shut` and `closing` rather than one boolean: the panel has to stay
     mounted while it flows back into the orb. */
  const [open, setOpen] = useState(startOpen);
  const [closing, setClosing] = useState(false);
  const [typed, setTyped] = useState('');

  const orb = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const shutTimer = useRef<number | null>(null);

  const place = useMemo<HomesAiPlace>(
    () => ({ path: pathname, page: pageName(pathname, role) }),
    [pathname, role],
  );

  const standIn = useStandIn(place, open);
  const mind = brain ?? standIn;
  const view = mind.view;
  const lite = useLiteMode();

  /* The placements — see the head of this file. */
  const isPhone = useIsPhone();
  const hasBar = useHasBar(dock);
  const { host, suppressed, menu } = usePlacement(isPhone && !hasBar, pathname, hasBar);
  const dodge = useDodge(!isPhone, pathname, !open && !closing, orb);

  /*
   * Where the panel hangs from when the orb is in a header: just under that
   * header, measured, because the three of them are different heights and a
   * number typed into the stylesheet would be wrong on two.
   */
  const [dockY, setDockY] = useState(0);
  useEffect(() => {
    if (!host) return undefined;
    const read = () => setDockY(Math.round(host.getBoundingClientRect().bottom));
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [host, open]);

  const shut = useCallback(() => {
    setOpen(false);
    setClosing(true);
    if (shutTimer.current) window.clearTimeout(shutTimer.current);
    shutTimer.current = window.setTimeout(() => setClosing(false), SHUT_MS);
    orb.current?.focus();
  }, []);

  useEffect(() => () => {
    if (shutTimer.current) window.clearTimeout(shutTimer.current);
  }, []);

  /* Ctrl-J, and ⌘J on a Mac. Escape closes. Both work while typing on a
     screen, the way Ctrl-K does for search — the combination is nobody's
     text input. */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (open) shut();
        else setOpen(true);
        return;
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        shut();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, shut]);

  useEffect(() => {
    const onOpen = () => { setClosing(false); setOpen(true); };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  /* The field is where a person wants to be the moment it opens. */
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);

  /* New turns scroll into view, including the one just sent. The optional
     call is for jsdom, which has no `scrollIntoView` at all. */
  useEffect(() => {
    if (!open) return;
    foot.current?.scrollIntoView?.({ block: 'end' });
  }, [open, view.turns.length, view.status]);

  const send = useCallback(() => {
    const question = typed.trim();
    if (!question || view.status === 'working') return;
    setTyped('');
    /* The field grows as you type, so it has to shrink again when it empties
       — otherwise the panel keeps the height of the longest question asked. */
    if (field.current) field.current.style.height = '';
    mind.ask(question, place);
  }, [mind, place, typed, view.status]);

  const onKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  /*
   * The orb's own state. `speaking` is only worth drawing while the panel is
   * shut: a ring pulsing to get your attention, while you are looking
   * straight at it, is noise.
   */
  const status: HomesAiStatus = open && view.status === 'speaking' ? 'idle' : view.status;
  const waiting = !open && view.status === 'speaking' ? view.waiting ?? 0 : 0;
  const thinking = view.status === 'working';

  const orbClass = [
    'v2-ai-orb',
    status === 'working' ? 'v2-ai-orb-work' : '',
    status === 'speaking' ? 'v2-ai-orb-say' : '',
    status === 'done' ? 'v2-ai-orb-done' : '',
  ].filter(Boolean).join(' ');

  const said: Record<HomesAiStatus, string> = {
    idle: 'Homes AI',
    working: 'Homes AI, working',
    speaking: 'Homes AI has something to say',
    done: 'Homes AI, done',
  };

  /*
   * The orb itself, built once and then put in one of two places: inside the
   * floating dock, or — on the four full-attention phone screens — portalled
   * into that screen's own header, where its flex row makes room for it the
   * way it does for every other control in there.
   */
  const theOrb = (
    <button
      type="button"
      ref={orb}
      className={orbClass}
      onClick={() => (open ? shut() : setOpen(true))}
      aria-label={said[status]}
      aria-expanded={open}
      aria-haspopup="dialog"
      title="Homes AI  Ctrl+J"
    >
      <span className="v2-ai-glow" aria-hidden="true" />
      <span className="v2-ai-ball" aria-hidden="true">
        <span className="v2-ai-liq v2-ai-liq-1" />
        <span className="v2-ai-liq v2-ai-liq-2" />
        <span className="v2-ai-liq v2-ai-liq-3" />
        <span className="v2-ai-sheen" />
        <span className="v2-ai-ok" />
      </span>
      <span className="v2-ai-swoop" aria-hidden="true" />
      <span className="v2-ai-ping" aria-hidden="true" />
      <span className="v2-ai-ping v2-ai-ping-2" aria-hidden="true" />
      {waiting > 0 && <span className="v2-ai-count">{waiting}</span>}
    </button>
  );

  return (
    <div
      ref={dock}
      className={[
        'v2-ai-dock',
        lite ? 'v2-ai-lite' : '',
        host ? 'v2-ai-dock-docked' : '',
        /*
         * The dialler is `position:fixed; z-index:130` and opaque, so without
         * this the panel opens *underneath* it and nothing appears at all.
         * That is not a guess: `phone-light-calling-panel-open.png` showed a
         * dialler with no panel on it, and `elementFromPoint` in the middle
         * of where the panel should have been returned the dialler's own
         * check-in banner.
         */
        suppressed ? 'v2-ai-dock-over' : '',
      ].filter(Boolean).join(' ')}
      data-ai-status={status}
      style={{
        ...(dodge > 0 ? { '--v2-ai-dodge': `${dodge}px` } : {}),
        ...(host ? { '--v2-ai-dock-y': `${dockY}px` } : {}),
      } as Record<string, string>}
    >
      {/* Phone only: the dim behind the panel. Not focusable — Escape and the
          close button are the keyboard's way out. */}
      {(open || closing) && (
        <button
          type="button"
          className={open ? 'v2-ai-dim' : 'v2-ai-dim v2-ai-dim-out'}
          aria-hidden="true"
          tabIndex={-1}
          onClick={shut}
        />
      )}

      {(open || closing) && (
        <section
          className={open ? 'v2-ai-panel v2-ai-panel-in' : 'v2-ai-panel v2-ai-panel-out'}
          role="dialog"
          aria-label="Homes AI"
        >
          <header className="v2-ai-head">
            <span className="v2-ai-mark" aria-hidden="true" />
            <span className="v2-ai-who">
              <span className="v2-ai-name">Homes AI</span>
              {/* "It knows which page I am on", said out loud so the person
                  can see that it does. "This screen: X" rather than "Looking
                  at X", because not every name in the menu is a noun —
                  "Looking at Start calling" is not a sentence. */}
              <span className="v2-ai-where">This screen: {place.page}</span>
            </span>
            {thinking && mind.stop && (
              <button type="button" className="v2-ai-shut" onClick={mind.stop} aria-label="Stop">
                <Icon name="square" />
              </button>
            )}
            <button type="button" className="v2-ai-shut" onClick={shut} aria-label="Close Homes AI">
              <Icon name="x" />
            </button>
          </header>

          {/* Three waves, never a spinner. */}
          {thinking && (
            <div className="v2-ai-waves" role="status" aria-label="Thinking">
              <span className="v2-ai-wave" />
              <span className="v2-ai-wave v2-ai-wave-2" />
              <span className="v2-ai-wave v2-ai-wave-3" />
            </div>
          )}

          {/* A screen reader hears an answer arrive without having to go
              looking for it, and `polite` means it waits its turn. */}
          <div className="v2-ai-body" role="log" aria-live="polite">
            {view.turns.length === 0 && (
              <>
                {view.greeting && <p className="v2-ai-hello">{view.greeting}</p>}
                {view.hints.length > 0 && (
                  <div className="v2-ai-hints">
                    {view.hints.map((hint) => (
                      <button
                        key={hint.id}
                        type="button"
                        className="v2-ai-hint"
                        onClick={() => mind.ask(hint.ask ?? hint.label, place)}
                      >
                        {hint.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/*
              * A turn is one or two children of the body, not a wrapper round
              * them: `align-self` is what puts mine on the right and its on
              * the left, and inside a wrapper that lines up against the
              * wrapper instead of the panel.
              */}
            {view.turns.map((turn) => (
              <Fragment key={turn.id}>
                {turn.tools && turn.tools.length > 0 && (
                  <p className="v2-ai-tools">Read {turn.tools.join(', ')}</p>
                )}
                <div
                  className={[
                    'v2-ai-turn',
                    turn.who === 'me' ? 'v2-ai-turn-me' : 'v2-ai-turn-ai',
                    turn.failed ? 'v2-ai-turn-bad' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {turn.body}
                </div>
              </Fragment>
            ))}
            <div ref={foot} />
          </div>

          <div className="v2-ai-compose">
            <div className="v2-ai-ask">
              <textarea
                ref={field}
                className="v2-ai-field"
                rows={1}
                value={typed}
                placeholder={view.prompt ?? 'Ask Homes AI…'}
                aria-label="Ask Homes AI"
                onChange={(e) => {
                  setTyped(e.target.value);
                  /* Grow with the question up to the height the stylesheet
                     caps it at, rather than hiding the first line of a long
                     one behind a scrollbar. */
                  const box = e.target;
                  box.style.height = 'auto';
                  /* jsdom reports 0 for every measurement; a 0px field is
                     worse than a one-line one. */
                  if (box.scrollHeight > 0) box.style.height = `${box.scrollHeight}px`;
                }}
                onKeyDown={onKey}
              />
              <button
                type="button"
                className="v2-ai-send"
                onClick={send}
                disabled={typed.trim().length === 0 || thinking}
                aria-label="Send"
              >
                <Icon name="arrow-up" />
              </button>
            </div>
            {view.footnote && <p className="v2-ai-small">{view.footnote}</p>}
          </div>
        </section>
      )}

      {/* Floating, unless it is docked in a header — or suppressed. */}
      {!host && !suppressed && theOrb}

      {host && createPortal(
        <span className={lite ? 'v2-ai-docked v2-ai-lite' : 'v2-ai-docked'}>{theOrb}</span>,
        host,
      )}

      {/*
        * The dialler's one way in: an item in the ☰ sheet it already has.
        *
        * It carries `d-btn` so it is the sheet's own button, at the sheet's
        * own size — `v2-phone.css` makes every `.d-dialog-foot > .d-btn` full
        * width and 48px tall, and lays that foot out `column-reverse`, so
        * appending puts this *above* "End session" where a secondary action
        * belongs.
        */}
      {suppressed && menu && createPortal(
        <button
          type="button"
          className="d-btn v2-ai-menu"
          onClick={() => {
            /*
             * Shut the sheet on the way through, the way choosing any item in
             * a menu does. It is the sheet's own close button because the
             * sheet's open/shut is `Calling.tsx`'s state, not ours; if that
             * button is ever renamed this does nothing and the sheet simply
             * stays open behind the panel, which is untidy rather than
             * broken. `homes-ai-orb.test.tsx` checks the label still exists.
             */
            (menu.closest('.d-dialog')?.querySelector('[aria-label="Close"]') as HTMLElement | null)
              ?.click();
            /* `openHomesAi()`, not `setOpen` — the same call any screen would
               make, so moving this item into `Calling.tsx` one day is a copy
               and paste rather than a rewrite. */
            openHomesAi();
          }}
        >
          <span className="v2-ai-mark" aria-hidden="true" />
          Ask Homes AI
        </button>,
        menu,
      )}
    </div>
  );
}
