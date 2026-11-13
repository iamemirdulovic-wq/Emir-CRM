/**
 * The line under the page title, one screen at a time.
 *
 * Every page in `design/web/*.html` declares its own `data-sub` on the
 * `<body>` — the 13px line the top bar draws under the title. The shell reads
 * it out of the `usePhoneHead` slot (`Shell.tsx`, `.v2-tsub`), so a screen
 * that never sets one shows nothing there, and `scripts/computer-proof.mjs`
 * found that on fifteen screens at once.
 *
 * They live here rather than inline in fourteen components for one reason:
 * **the design's own numbers are invented.** There are not really ten agents
 * and sixteen templates. A sub-line with a number in it has to carry the real
 * one, from data the screen already loaded, and the only way to prove that
 * rather than claim it is to have the builder be a pure function that a test
 * can feed two different fixtures to and watch the number move. `subs.test.ts`
 * does exactly that, and also checks the wording-only lines against the design
 * files character for character.
 *
 * Two of the design's lines could not be honoured as drawn. Both are written
 * up in `docs/v2/questions-subs.md`, with what the screen can actually supply:
 *   - Attendance wants "shift 09:00 – 18:00"; `/api/v2/attendance/me` returns
 *     the start of the shift and no end.
 *   - Best of Homes wants "Week 46 … ends Sunday 23:59"; the board counts
 *     points over a rolling thirty days and has no week and no deadline.
 *
 * And one is set here but not drawn: the computer top bar treats
 * `/v2/leads/new` as an open lead and replaces the title with a back link,
 * which takes the sub with it. The phone shows it. Same document.
 */
import { plural } from '../lib/format.js';
import { addDays, civil } from '../lib/calendar.js';

/* ── dates, in Dubai ─────────────────────────────────────────────────────── */

/**
 * A civil Dubai date formatted in the design's own order: "Wednesday,
 * 11 November 2026".
 *
 * `civil()` from `calendar.ts` is the existing helper and the only one that
 * should be used here — it holds Dubai wall-clock in a date's UTC fields, so
 * everything below formats in UTC and the zone is applied exactly once. Dubai
 * is UTC+4 with no daylight saving and the fixed offset is deliberate; see
 * `calendar.ts`.
 *
 * `en-GB` writes "Wednesday 11 November 2026" with no comma, so the weekday is
 * formatted apart and the comma put in by hand to match the design.
 */
function dubaiDate(at: Date, withYear: boolean): string {
  const day = civil(at);
  const show = (options: Intl.DateTimeFormatOptions) =>
    day.toLocaleDateString('en-GB', { timeZone: 'UTC', ...options });
  const rest = show({ day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) });
  return `${show({ weekday: 'long' })}, ${rest}`;
}

/**
 * "15 Oct", for the ends of a window.
 *
 * Takes a date that is **already civil** — Dubai wall-clock held in UTC
 * fields — and so formats in UTC. Calling `civil()` again here is the mistake
 * this comment exists to stop: it adds another four hours, and a window that
 * began at nine in the evening Dubai time then reported itself as starting a
 * day later. The build said "16 Oct – 13 Nov" for a thirty-day window while
 * the unit test, run at lunchtime, said 15 Oct and passed.
 */
function shortCivil(day: Date): string {
  return day.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
}

/* ── the fourteen ────────────────────────────────────────────────────────── */

/** `add-lead.html`. No number in it; the design's words exactly. */
export function addLeadSub(): string {
  return 'Name, phone and source are needed. The rest can wait.';
}

/** `import.html`. The step count is the screen's own stepper, not the design's. */
export function importSub(steps: number): string {
  return `Excel or CSV · ${steps} short steps`;
}

/**
 * `team.html`: "10 agents · 6 in office now".
 *
 * Both numbers are counted over the people the grid actually shows, which is
 * what the design's own filter pills count — its "All 10" and "In office now
 * 6" are the same two figures. Counting the first over everybody and the
 * second over the grid is how a sub-line comes to disagree with the pill
 * directly under it.
 */
export function teamSub(agents: number, inOfficeNow: number): string {
  return `${plural(agents, 'agent')} · ${inOfficeNow} in office now`;
}

/** `digital-card.html`. The three is the screen's own stepper. */
export function cardSub(steps: number): string {
  return `Make your card in ${steps} steps`;
}

/** `team-wall.html`. Wording only. */
export function wallSub(): string {
  return 'News and wins from the whole office';
}

/**
 * `best-of-homes.html` draws "Week 46 · Mon 9 – Sun 15 Nov · ends Sunday
 * 23:59". There is no week here: `/api/wall/sidebar` ranks points over a
 * rolling window of `BOARD_DAYS` days and there is nothing for a deadline to
 * be the end of. So the line says the window the board really uses, with its
 * two ends worked out from the Dubai clock. `docs/v2/questions-subs.md`.
 */
export function bestSub(days: number, at: Date): string {
  const today = civil(at);
  const from = addDays(today, -(days - 1));
  return `Points over the last ${days} days · ${shortCivil(from)} – ${shortCivil(today)}`;
}

/**
 * `attendance.html` (the agent) and `team-attendance.html` (the owner) are one
 * address drawn as two screens, and the design gives each its own line: the
 * agent's carries the year, the owner's does not.
 *
 * Both end "· shift 09:00 – 18:00". `/api/v2/attendance/me` gives the start of
 * the shift and no end — the end is stored in the attendance settings and is
 * not in that response — so this says what the screen knows rather than
 * inventing six o'clock. `docs/v2/questions-subs.md`.
 */
export function attendanceSub(
  seesTeam: boolean,
  at: Date,
  startsAt: string | null,
): string {
  const date = dubaiDate(at, !seesTeam);
  return startsAt ? `${date} · shift starts ${startsAt}` : date;
}

/** `team-live.html`. Wording only. */
export function liveSub(): string {
  return 'What the team does right now';
}

/** `messaging-report.html`. Wording only. */
export function messagingSub(): string {
  return 'WhatsApp and Telegram taps';
}

/** `inbox.html`. Wording only, "later phase" included — it is the design's. */
export function inboxSub(): string {
  return 'WhatsApp and Telegram chats in one place · later phase';
}

/** `email.html`. Wording only. */
export function emailSub(): string {
  return 'Email to clients from the CRM · later phase';
}

/** `templates.html`: "16 WhatsApp templates". The real count of them. */
export function templatesSub(count: number): string {
  return `${plural(count, 'WhatsApp template')} · later phase`;
}

/** `feedback.html`. Wording only. */
export function feedbackSub(): string {
  return 'Bugs, problems and ideas go straight to the owners';
}

/**
 * `my-day.html`: "Wednesday, 11 November 2026 · 14:55".
 *
 * The time comes out of the server's own `now` sentence rather than off this
 * machine's clock, for the same reason `greet()` reads the hour from it: an
 * agent in Dubai and a laptop still on European time must not see two
 * different answers on one screen. The date is the Dubai civil date, so the
 * two halves of the line cannot disagree either.
 */
export function myDaySub(serverNow: string, at: Date = new Date()): string {
  const time = serverNow.match(/(\d{1,2}:\d{2})/)?.[1];
  const date = dubaiDate(at, true);
  return time ? `${date} · ${time}` : date;
}

/** `owner-home.html`: "Wednesday, 11 November 2026". The date alone. */
export function ownerHomeSub(at: Date = new Date()): string {
  return dubaiDate(at, true);
}
