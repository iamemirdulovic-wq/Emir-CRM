/**
 * "No answer" — the result, the tag, the tab's columns and the one button.
 *
 * ── Why this is its own file ────────────────────────────────────────────────
 *
 * Four agents were building against `docs/v2/call-results-contract.md` at the
 * same time, and this half of it — the leads list — had to be able to land
 * without waiting for the lead page, the dialler or the quick panel. Anything
 * about a call result that the leads list needs is here, so `Leads.tsx` reads
 * as a list again and the next screen that wants the same tag imports it
 * rather than wording it a second way.
 *
 * ── The contract, in one place ──────────────────────────────────────────────
 *
 *   POST   /api/v2/leads/:opportunityId/call-result   { result, callBackAt?, note? }
 *   DELETE /api/v2/leads/:opportunityId/call-result   — takes the last one back
 *
 * Both answer with the whole no-answer state afterwards (§1 and §1b). Nothing
 * here computes when the next try is: that is the server's, from Automations,
 * so the owner can change it in one place. A screen that worked out
 * "+2 hours" for itself would be the second answer to that question, and the
 * two would drift the first time the owner moved the setting.
 *
 * ── Three rules this file exists to keep ────────────────────────────────────
 *
 *  1. **Never invent a number.** `tries` is read from the server; when the
 *     server has not sent the `noAnswer` block yet (another agent's half), the
 *     count falls back to `opportunities.no_answer_count`, which is a real
 *     column written by `leads/actions.ts` — never to a guess. `lastTryAt`
 *     and `nextTryAt` have no fallback at all: a missing one reads as
 *     "Not recorded" or "Nothing planned", in words.
 *  2. **Never a raw code.** `no_answer` is never drawn; the screen says
 *     "No answer". `RESULT_LABEL` is the only place that mapping lives.
 *  3. **24-hour Dubai time, in plain English.** "try again tomorrow 11:00",
 *     never an ISO timestamp and never 11:00 PM. Every clock below passes
 *     `timeZone: 'Asia/Dubai'` explicitly, which is the house style for a
 *     displayed time (`check-in.tsx`, `Calling.tsx`, `lib/assigned.ts`) —
 *     an agent in Dubai and the owner on a plane must read the same row.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { ApiError, api } from '../lib/api.js';
import { Icon } from '../design/index.js';
import '../styles/v2-no-answer.css';

/* ── the contract's own shapes ─────────────────────────────────────────── */

/** §1. The six results an agent can save on a call. */
export type CallResult =
  | 'answered' | 'no_answer' | 'busy' | 'call_back' | 'wrong_number' | 'not_interested';

/** Plain English for each. §6: never a raw code on screen. */
export const RESULT_LABEL: Record<CallResult, string> = {
  answered: 'Answered',
  no_answer: 'No answer',
  busy: 'Busy',
  call_back: 'Call back',
  wrong_number: 'Wrong number',
  not_interested: 'Not interested',
};

/**
 * The four results that go in the row's "⋯" menu — C.3.
 *
 * "No answer" is not among them: it is the pill in the row itself, which is
 * the whole point of C.1. "Answered" is not either — an answered call is a
 * conversation, and what came out of it belongs on the lead, not in a menu
 * on a list. Both are deliberate; see the report for 14 Nov.
 */
export const MENU_RESULTS: Array<{ result: CallResult; icon: 'clock' | 'calendar-days' | 'alert-triangle' | 'circle-x' }> = [
  { result: 'busy', icon: 'clock' },
  { result: 'call_back', icon: 'calendar-days' },
  { result: 'wrong_number', icon: 'alert-triangle' },
  { result: 'not_interested', icon: 'circle-x' },
];

/** §1: what the server answers with after a result is saved or taken back. */
export interface NoAnswerState {
  tries: number;
  maxTries: number;
  lastTryAt: string | null;
  nextTryAt: string | null;
  exhausted: boolean;
  whatsapp: { lang: string; text: string } | null;
}

/** §3: the optional block every lead row now carries. */
export interface RowNoAnswer {
  tries: number;
  lastTryAt: string | null;
  nextTryAt: string | null;
  /**
   * Which of the two "did not speak to them" results the last try was.
   *
   * The owner's picture draws the Tries column reading `Busy ×1` as well as
   * `No answer ×2`, and the count alone could never say which: `tries` is a
   * total of both, which is §1's own rule. The server reads it off the same
   * timeline row it reads `lastTryAt` from, so an undone try undoes this too.
   *
   * Null on a lead whose last try was logged before the server started
   * recording it, and on one logged by a path that does not go through the
   * call-result endpoint. The pill then says "No answer", which is what it
   * said for every lead before this field existed and what the action itself
   * means — never a guess at "Busy".
   */
  lastResult?: 'no_answer' | 'busy' | null;
}

/** As much of a lead row as anything in this file needs. */
export interface NoAnswerRow {
  id: string;
  noAnswer?: RowNoAnswer | null;
  /**
   * `opportunities.no_answer_count`, which `/api/my-leads` has always sent.
   *
   * The fallback for `tries` until §3's block lands, and a real number
   * either way — `runLeadAction` increments it on every `no_answer`. It does
   * not count Busy, which §1 does, so the two can differ by the number of
   * Busys; the block wins whenever it is there.
   */
  no_answer_count?: number | null;
}

/* ── reading a row ─────────────────────────────────────────────────────── */

/** How many tries this lead has had, from the server and never guessed. */
export function triesOf(row: NoAnswerRow): number {
  const block = row.noAnswer;
  if (block && Number.isFinite(block.tries)) return Math.max(0, Math.trunc(block.tries));
  const column = Number(row.no_answer_count ?? 0);
  return Number.isFinite(column) ? Math.max(0, Math.trunc(column)) : 0;
}

/** When the last try was, or null. No fallback: a missing time stays missing. */
export function lastTryOf(row: NoAnswerRow): string | null {
  return row.noAnswer?.lastTryAt ?? null;
}

/** When the next try is, or null. */
export function nextTryOf(row: NoAnswerRow): string | null {
  return row.noAnswer?.nextTryAt ?? null;
}

/**
 * What the last try was, in words: "Busy" or "No answer".
 *
 * Never a raw code (§6), and never a guess: a row the server has not told
 * reads "No answer", which is the action both results run and the word the
 * column carried for every lead until the server learnt the difference.
 */
export function lastResultLabel(row: NoAnswerRow): string {
  const said = row.noAnswer?.lastResult;
  return said === 'busy' ? RESULT_LABEL.busy : RESULT_LABEL.no_answer;
}

/* ── the clock, in Dubai, 24 hours, in words ───────────────────────────── */

const DUBAI = 'Asia/Dubai';

/** "2026-11-15" — the Dubai calendar day a moment falls on. */
function dubaiDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBAI, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
}

/** "11:00". Never "11:00 AM": v3 §5, a 24-hour clock everywhere. */
function dubaiClock(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
}

/** "17 Nov". */
function dubaiDate(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI, day: 'numeric', month: 'short',
  }).format(at);
}

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * "tomorrow 11:00", "today 16:30", "17 Nov 11:00" — the sentence B.5 asks
 * for, in the middle of a line.
 *
 * Emir's own words: *"'try again tomorrow 11:00' is Dubai time, 24-hour, and
 * must read in plain English — never a raw code or an ISO timestamp."* Today,
 * tomorrow and yesterday are named; anything further out carries the date,
 * because "in 4 days" makes an agent do the sum.
 */
export function whenAgain(value: string | null | undefined, now: Date = new Date()): string | null {
  const at = parse(value);
  if (!at) return null;
  const day = dubaiDay(at);
  const clock = dubaiClock(at);
  if (day === dubaiDay(now)) return `today ${clock}`;
  if (day === dubaiDay(new Date(now.getTime() + 86_400_000))) return `tomorrow ${clock}`;
  if (day === dubaiDay(new Date(now.getTime() - 86_400_000))) return `yesterday ${clock}`;
  return `${dubaiDate(at)} ${clock}`;
}

/** The same, as a column reads it: "Tomorrow 11:00", "Today 16:40". */
export function nextTryText(value: string | null | undefined, now: Date = new Date()): string {
  const said = whenAgain(value, now);
  if (!said) return 'Nothing planned';
  return said.charAt(0).toUpperCase() + said.slice(1);
}

/** "14 Nov 16:40" — the LAST TRY column, as the design draws it. */
export function lastTryText(value: string | null | undefined): string {
  const at = parse(value);
  if (!at) return 'Not recorded';
  return `${dubaiDate(at)} ${dubaiClock(at)}`;
}

/** Today in Dubai as a date field wants it: "2026-11-14". */
export function todayInDubai(now: Date = new Date()): string {
  return dubaiDay(now);
}

/** And tomorrow, which is what a call back defaults to. */
export function tomorrowInDubai(now: Date = new Date()): string {
  return dubaiDay(new Date(now.getTime() + 86_400_000));
}

/**
 * A day and a clock time the agent typed, as the moment it is in Dubai.
 *
 * `+04:00` rather than a time-zone library on purpose: Dubai is UTC+4 all
 * year with no daylight saving, and CLAUDE.md asks for the fixed offset by
 * name. Null when either half is missing, so a half-filled dialog cannot
 * save a wrong time.
 */
export function dubaiMoment(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const at = new Date(`${day}T${time}:00.000+04:00`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** True once the next try is due — the design draws that one red. */
export function tryIsDue(value: string | null | undefined, now: Date = new Date()): boolean {
  const at = parse(value);
  return at !== null && at.getTime() <= now.getTime();
}

/**
 * "No answer ×2 · try again tomorrow 11:00" — B.5's Next step column.
 *
 * `fallback` is the row's ordinary next step, which is shown after the tag
 * when the server has not sent a `nextTryAt`. That keeps the column honest
 * in both worlds: a real planned time either way, never a made-up one.
 */
export function nextStepWithTries(
  row: NoAnswerRow,
  fallback: string,
  options: { short?: boolean; now?: Date } = {},
): { text: string; full: string; tries: number; tag: string; when: string } {
  const now = options.now ?? new Date();
  const tries = triesOf(row);
  if (tries === 0) return { text: fallback, full: fallback, tries: 0, tag: '', when: fallback };
  /* The same words as the pill in the Tries column: "Busy ×1" where the
     last try was a busy line, which is what the owner's picture draws. */
  const tag = `${lastResultLabel(row)} ×${tries}`;
  const again = whenAgain(nextTryOf(row), now);
  const full = again ? `${tag} · try again ${again}` : `${tag} · ${fallback}`;
  /*
   * "try again" comes off below 1700px, and only there.
   *
   * Measured in a browser: the whole sentence is 277px and the Next step
   * column is 240px at 1440 and 122 at 1280, so Emir's own wording is cut
   * at both of the widths his team works at — and it is the column §2.2
   * calls "wide and always readable". Without the two words it is 215px and
   * reads whole at 1440. The pill in the Tries column already says what the
   * time is for, the hover carries the sentence in full, and above 1700
   * nothing is dropped. It is in the report as a deviation.
   */
  const text = options.short && again ? `${tag} · ${again}` : full;
  /* The two halves on their own, for the laptop's two-line cell. */
  return { text, full, tries, tag, when: again ?? fallback };
}

/**
 * What the toast says — the design's own line, word for word:
 *
 *   "Saved · No answer · try 2 of 5 · next try tomorrow 11:00"
 *
 * Each half is dropped rather than guessed: no `maxTries` and it reads
 * "try 2"; no `nextTryAt` and the sentence simply ends.
 */
export function savedLine(
  result: CallResult,
  state: NoAnswerState | null,
  now: Date = new Date(),
): string {
  const parts = ['Saved', RESULT_LABEL[result]];
  if (state && state.tries > 0) {
    parts.push(state.maxTries > 0 ? `try ${state.tries} of ${state.maxTries}` : `try ${state.tries}`);
  }
  const again = whenAgain(state?.nextTryAt ?? null, now);
  if (again) parts.push(`next try ${again}`);
  return parts.join(' · ');
}

/* ── saving one, and taking it back ────────────────────────────────────── */

const PATH = (opportunityId: string) => `/api/v2/leads/${opportunityId}/call-result`;

/** §1. One tap, no typing — every field in the answer is the server's. */
export function saveCallResult(
  opportunityId: string,
  result: CallResult,
  extra: { callBackAt?: string; note?: string } = {},
): Promise<NoAnswerState> {
  return api.post<NoAnswerState>(PATH(opportunityId), {
    result,
    ...(extra.callBackAt ? { callBackAt: extra.callBackAt } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  });
}

/** §1b. Takes the most recent result back; 409 once the window has passed. */
export function undoCallResult(opportunityId: string): Promise<NoAnswerState> {
  return api.del<NoAnswerState>(PATH(opportunityId));
}

/**
 * Why an undo did not go through, in words an agent can act on.
 *
 * §1b answers 409 once the ten minutes are up or once something else has
 * happened on the lead. "Request failed (409)" is not a sentence, and
 * failing quietly is what the contract forbids outright.
 */
export function undoRefused(problem: unknown): string {
  if (problem instanceof ApiError) {
    if (problem.status === 409) {
      return 'Too late to undo that — it is no longer the last thing on this lead. '
        + 'Open the lead and save the right result.';
    }
    if (problem.status === 403) return 'That result was somebody else’s to undo.';
    if (problem.message) return problem.message;
  }
  return 'That could not be undone. Open the lead and save the right result.';
}

/**
 * And why a save did not go through.
 *
 * The one worth naming is the 404 the server answers while the endpoint is
 * still being built next door: an agent reading "Request failed (404)" has
 * no idea whether their client was recorded or not.
 */
export function saveRefused(problem: unknown): string {
  if (problem instanceof ApiError) {
    if (problem.status === 404 || problem.status === 501) {
      return 'Saving a call result is not switched on yet. Nothing was recorded.';
    }
    if (problem.message) return problem.message;
  }
  return 'That result could not be saved. Nothing was recorded.';
}

/* ── the tag, the pill and the button ──────────────────────────────────── */

/**
 * The pale grey pill: `No answer ×2`.
 *
 * `×` is the multiplication sign, not the letter x — the owner wrote it that
 * way in both his list and his picture, and `no-answer.test.ts` checks it.
 */
export function TriesPill({ tries, said, title }: {
  tries: number;
  /**
   * What the last try was — `lastResultLabel(row)`.
   *
   * Left out, it reads "No answer", which is what the pill said for every
   * lead before the row carried the result. The owner's picture draws both:
   * `No answer ×2`, `No answer ×4`, `Busy ×1`.
   */
  said?: string;
  title?: string;
}) {
  if (tries <= 0) return null;
  const word = said ?? RESULT_LABEL.no_answer;
  /* A busy line is a clock in the design's own pills, a no-answer a struck
     handset — the result bar uses the same two icons for the same two
     results, so the column and the bar cannot say it two ways. */
  const icon = word === RESULT_LABEL.busy ? 'clock' : 'phone-off';
  return (
    <span className="v2-na-pill" title={title ?? `${word} · ${tries} ${tries === 1 ? 'try' : 'tries'}`}>
      <Icon name={icon} size={12} />
      {word} ×{tries}
    </span>
  );
}

/**
 * The same words beside the stage pill — B.5's *"a small grey tag
 * 'No answer ×2' beside the stage"*.
 *
 * One pill, one line, beside the stage pill and never under it, and no icon
 * in it. It was a phone-off glyph with `×2` stacked underneath, which is
 * what Emir called messy on 14 Nov — *"this icon, it's not showing properly
 * … it looks a little messy"* — and he is right: a symbol on a row of its
 * own reads as debris rather than information. He has asked three times for
 * plain English and no pictures standing in for words, and an icon in place
 * of "No answer" is that same request arriving by a side door.
 *
 * **Where the words do not fit, nothing is drawn here at all.** Beside the
 * stage the cell needs about 198px and it has 108 at 1440, and the 90px are
 * not spare anywhere on a ten-column book at that width. So the tag appears
 * from 1600px up and is simply absent below, by the rule in
 * `v2-no-answer.css`. Nothing is lost by that: the Next step cell on the
 * same row says "No answer ×2 · try again tomorrow 11:00" at every width.
 * One clear statement beats two half ones.
 */
export function StageTriesTag({ tries, said }: { tries: number; said?: string }) {
  if (tries <= 0) return null;
  const word = said ?? RESULT_LABEL.no_answer;
  return (
    <span
      className="v2-na-stagetag"
      title={`${word} · ${tries} ${tries === 1 ? 'try' : 'tries'}`}
    >
      {word} ×{tries}
    </span>
  );
}

/**
 * The row's "No answer" button — C.1 and C.5.
 *
 * Filled pale grey with a phone-off icon: *"visibly the quietest of the
 * three"*, which is the owner's picture. And it does nothing until the agent
 * has actually tried, because a result recorded before the call is a lie in
 * the timeline and in every number built on it.
 *
 * `tried` is the same rule the dialler already enforces — `touched` in
 * `Calling.tsx`, which goes true when `/api/v2/calls` or `/api/v2/taps`
 * accepts the tap and shows *"Tap Call or WhatsApp first"* until it does.
 * There is one rule, and this is it; the button reads "Call first" until the
 * tap is recorded.
 */
export function NoAnswerButton({ tried, busy, tight, onSave, onLocked, name }: {
  /** The agent has tapped Call or WhatsApp on this lead and it was recorded. */
  tried: boolean;
  busy?: boolean;
  /** Narrow window: the icon alone, with the word in the label and the title. */
  tight?: boolean;
  onSave: () => void;
  /** Pressed before trying: say what to do rather than doing nothing. */
  onLocked: () => void;
  name: string;
}) {
  const label = tried ? RESULT_LABEL.no_answer : 'Call first';
  return (
    <button
      type="button"
      className={tried ? 'd-btn d-xs v2-na-btn' : 'd-btn d-xs v2-na-btn v2-na-btn-locked'}
      disabled={busy === true}
      title={tried
        ? `${RESULT_LABEL.no_answer} — ${name}`
        : `Call first — tap Call or WhatsApp on ${name} before saving a result`}
      aria-label={tried
        ? `${RESULT_LABEL.no_answer} — ${name}`
        : `Call ${name} first, then save No answer`}
      /*
       * Not disabled, on purpose. A dead button in every row with no words
       * on it — there is no room for words below 1700px — is a bug report
       * waiting to be filed. Pressing it says what to do instead, which is
       * the dialler's own visible "Tap Call or WhatsApp first" in the one
       * place a table row has for it. It still cannot record anything.
       */
      onClick={tried ? onSave : onLocked}
    >
      <Icon name="phone-off" />
      {tight ? '' : label}
    </button>
  );
}

/* ── the tries an agent has made in this sitting ───────────────────────── */

export interface TriedLeads {
  /** True once Call or WhatsApp on this lead has been recorded. */
  has: (id: string) => boolean;
  /** Called with the id when a tap comes back recorded. */
  mark: (id: string) => void;
}

/**
 * Which leads this agent has tapped Call or WhatsApp on, in this sitting.
 *
 * Deliberately not persisted, and deliberately not read back from the
 * server: `/api/my-leads` does not say whether this agent rang this lead
 * today (`callQueue` does, as `calledToday`, and the list endpoint is
 * somebody else's file this week). So after a reload the button says "Call
 * first" again, exactly as the dialler forgets `touched` on a reload. The
 * safe direction: it can only ever refuse a result that was not earned, and
 * never record one that was not given. The gap is in the report.
 */
export function useTried(): TriedLeads {
  const [tried, setTried] = useState<Record<string, true>>({});
  const has = useCallback((id: string) => tried[id] === true, [tried]);
  const mark = useCallback((id: string) => {
    setTried((was) => (was[id] ? was : { ...was, [id]: true }));
  }, []);
  return { has, mark };
}

/**
 * The banner on the No answer tab while the server does not know it yet.
 *
 * `/api/my-leads` falls back to the Today tab for a name `isLeadTab` does
 * not know, and answers with `tab: "today"` — so without this the screen
 * would draw today's follow-ups under a No answer heading, which is the one
 * thing worse than an empty tab. The server half is another agent's; the
 * moment `no_answer` joins `LEAD_TABS` this disappears on its own.
 */
export function TabNotReady({ children }: { children?: ReactNode }) {
  return (
    <div className="v2-na-waiting">
      <span className="v2-na-waiting-ic"><Icon name="phone-off" size={22} /></span>
      <b>The No answer list is not switched on yet</b>
      <p>
        Nothing is shown here rather than the wrong leads. The tag on each lead and the
        “No answer” button in every row work already.
      </p>
      {children}
    </div>
  );
}
