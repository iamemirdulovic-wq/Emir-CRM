import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';

/**
 * The phone-only parts of the v2 shell.
 *
 * Everything here is read from the 59 prototypes in `design/screens/` and from
 * `docs/v2/phone-shell.md`, which is the careful reading of them. Three things
 * the computer design has no opinion about, because it is a computer design:
 *
 *  1. **Four screens have no bottom bar.** The dialler, a chat, email and the
 *     sign-in page are full-attention: you finish them or you leave them on
 *     purpose. `docs/v2/phone-shell.md` §1.2 — "treat no bar as the signal that
 *     the user is in a single task".
 *  2. **A bottom sheet is the only modal.** §1.5: there is no centre-screen
 *     dialog in the whole phone design except one small "are you back in the
 *     office?" card. Every decision, form and confirmation rises from the
 *     bottom edge, carries a grab handle, and closes by swiping it down or
 *     tapping the dim behind it.
 *  3. **Cards rise in.** §1.1: the scroller's children animate up 14px and fade
 *     in, staggered 50ms apart for the first six. It is what makes a screen
 *     feel like it opened rather than appeared.
 *
 * The CSS for all three lives in `v2-phone.css`, under `@media (max-width:
 * 768px)`, which is the line the owner drew: 768 and wider must not change.
 */

/* ── Who gets to hide the bottom bar ─────────────────────────────────────── */

/**
 * Two of the four full-attention screens are an address of their own, and two
 * are a state inside one. The dialler and email are routes; a chat is a thread
 * opened inside the inbox, and the sign-in page is not inside this shell at
 * all. So the route list covers what it can and `useFullAttention` covers the
 * rest.
 */
const NO_BAR_ROUTES = ['/v2/calling', '/v2/email'];

export function barIsHiddenAt(pathname: string): boolean {
  return NO_BAR_ROUTES.some((one) => pathname === one || pathname.startsWith(`${one}/`));
}

const FullAttention = createContext<(on: boolean) => void>(() => {});

/**
 * Called by a screen that is a single task while it is in one — the inbox
 * while a thread is open. Takes the bottom bar away for as long as it is true,
 * and puts it back when the screen leaves.
 */
export function useFullAttention(on: boolean): void {
  const set = useContext(FullAttention);
  useEffect(() => {
    set(on);
    return () => set(false);
  }, [set, on]);
}

export function FullAttentionProvider(
  { children }: { children: (hidden: boolean) => ReactNode },
) {
  const [hidden, setHidden] = useState(false);
  const set = useCallback((on: boolean) => setHidden(on), []);
  return (
    <FullAttention.Provider value={set}>
      {children(hidden)}
    </FullAttention.Provider>
  );
}


/* ── what a screen puts in its own header ───────────────────────────────── */

export interface PhoneHead {
  /**
   * What the header calls this screen. Overrides the name derived from the
   * address, which only knows the first part of it — so `/v2/settings/team`
   * and `/v2/settings/security` both read "Settings" without this.
   *
   * A screen that sets a title must not draw one of its own as well: the
   * header is static and the page scrolls under it, so two titles appear at
   * once rather than one scrolling away.
   */
  title?: string;

  /**
   * Draw the title small and centred, in the row with the buttons, instead
   * of large on a line of its own.
   *
   * §1.4 is two patterns, not one. Most screens get the 30px title on its
   * own line. Some — Follow-ups, the inbox, a sheet-like sub-screen — draw
   * a 17px centred one between a back button and a single action, because
   * the screen below it is a list that wants the height.
   */
  compact?: boolean;
  /** The live count under the title — "62 open · 12 to call today". */
  sub?: string;
  /**
   * The one round action on the right. §1.4: "an optional single round action
   * button sits on the right". One, not three, and not the same one on every
   * screen — the design puts `+ Add lead` on My Leads, `+ Add event` on the
   * calendar, `Manage projects` on the project library, and nothing at all on
   * a business card or a feedback form.
   */
  action?: { icon: string; label: string; to?: string; onClick?: () => void };
}

const HeadSlot = createContext<{
  head: PhoneHead;
  set: (head: PhoneHead) => void;
}>({ head: {}, set: () => {} });

/**
 * A screen declares its own header, and it is cleared when the screen leaves.
 *
 * Without this every screen got the same three buttons, including an "Add
 * lead" on a colleague's profile and on the feedback form — which is how the
 * audit found it. The design gives each screen one action of its own, or none.
 */
export function usePhoneHead(head: PhoneHead): void {
  const { set } = useContext(HeadSlot);
  const { sub, action } = head;
  const key = `${sub ?? ''}|${action?.label ?? ''}|${action?.to ?? ''}`;
  useEffect(() => {
    set(head);
    return () => set({});
    /* The head is rebuilt every render; its contents are what matter. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, key]);
}

export function usePhoneHeadSlot(): PhoneHead {
  return useContext(HeadSlot).head;
}

export function PhoneHeadProvider({ children }: { children: ReactNode }) {
  const [head, setHead] = useState<PhoneHead>({});
  const set = useCallback((next: PhoneHead) => setHead(next), []);
  const value = useMemo(() => ({ head, set }), [head, set]);
  return <HeadSlot.Provider value={value}>{children}</HeadSlot.Provider>;
}

/* ── Bottom sheets ───────────────────────────────────────────────────────── */

/** How far down you have to drag before letting go closes the sheet. */
const CLOSE_AFTER_PX = 90;

/**
 * Make every dialog and side panel behave like a sheet, on a phone.
 *
 * The CSS does the look — the sheet is already pinned to the bottom edge with
 * a grab handle by then. This does the two things CSS cannot: dragging it down
 * with a thumb, and finding the control that closes it so the drag can press
 * it. A sheet you can only dismiss with a small × is not a sheet.
 *
 * It works on whatever is on screen rather than being wired into each dialog,
 * because there are forty-odd of them across the build and the alternative is
 * forty-odd chances to forget.
 */
export function usePhoneSheets(enabled: boolean): void {
  const drag = useRef<{ el: HTMLElement; from: number; moved: number } | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const sheetAt = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      return target.closest('.d-dialog, .d-panel, .v2-sheet') as HTMLElement | null;
    };

    /* Only a drag that starts on the handle or the sheet's own head moves it.
       Starting anywhere else would fight every list inside it. */
    const onHandle = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      const sheet = sheetAt(target);
      if (!sheet) return false;
      const box = sheet.getBoundingClientRect();
      const y = (target as HTMLElement).getBoundingClientRect().top;
      return y - box.top < 72;
    };

    const close = (sheet: HTMLElement) => {
      /* Whatever this sheet's own close is: its × button, its Cancel, or the
         dim behind it. Tried in that order because the first two are the ones
         that also tidy up state. */
      const own = sheet.querySelector<HTMLElement>(
        '[data-sheet-close], [aria-label="Close"], [aria-label="close"]',
      );
      if (own) { own.click(); return; }
      const scrim = document.querySelector<HTMLElement>('.d-scrim, .v2-scrim');
      if (scrim) { scrim.click(); return; }
      /* Nothing to press: Escape is what the rest of the app listens for. */
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };

    const start = (e: TouchEvent) => {
      const sheet = sheetAt(e.target);
      if (!sheet || !onHandle(e.target)) return;
      drag.current = { el: sheet, from: e.touches[0]?.clientY ?? 0, moved: 0 };
      sheet.style.transition = 'none';
    };

    const move = (e: TouchEvent) => {
      const d = drag.current;
      if (!d) return;
      const moved = (e.touches[0]?.clientY ?? 0) - d.from;
      if (moved < 0) return;
      d.moved = moved;
      d.el.style.transform = `translateY(${moved}px)`;
    };

    const end = () => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      d.el.style.transition = '';
      d.el.style.transform = '';
      if (d.moved > CLOSE_AFTER_PX) close(d.el);
    };

    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
    return () => {
      document.removeEventListener('touchstart', start);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', end);
    };
  }, [enabled]);
}

/* ── Cards rising in ─────────────────────────────────────────────────────── */

/**
 * Replay the rise-in whenever the screen changes.
 *
 * The animation is a CSS one on the scroller's children, and CSS plays it once
 * per element. React keeps the same elements across a route change often
 * enough that the second screen would appear with no movement at all, which
 * reads as a page that failed to load. Bumping a key on the page element
 * restarts it.
 */
export function useRiseIn(pathname: string, enabled: boolean): number {
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    setRun((n) => n + 1);
  }, [pathname, enabled]);
  return run;
}

/* ── The More screen's tiles ─────────────────────────────────────────────── */

export interface Tile {
  to: string;
  label: string;
  icon: string;
  badge?: string;
  urgent?: boolean;
  ownerOnly?: boolean;
}

/**
 * Everything a phone can reach, as tiles.
 *
 * `Menu.dc.html` is the phone design's answer to a sidebar: one screen of
 * tiles, the owner's tools in their own block below the shared ones. The list
 * is built from the real menu so a tool added to one cannot go missing from
 * the other.
 */
export function tilesFrom(
  groups: Array<{ label: string | null; items: Tile[] }>,
  pinned: Tile[],
  extras: Tile[],
  messages: Tile[],
): Array<{ label: string; items: Tile[] }> {
  const seen = new Set<string>();
  const take = (items: Tile[]): Tile[] => items.filter((one) => {
    const key = `${one.to}|${one.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const out: Array<{ label: string; items: Tile[] }> = [];
  for (const group of groups) {
    const items = take(group.items);
    if (items.length > 0) out.push({ label: group.label ?? 'Today', items });
  }
  const msg = take(messages);
  if (msg.length > 0) out.push({ label: 'Messages', items: msg });
  const rest = take([...pinned, ...extras]);
  if (rest.length > 0) out.push({ label: 'Everything else', items: rest });
  return out;
}
