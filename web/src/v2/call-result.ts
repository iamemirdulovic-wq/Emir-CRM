/**
 * What a call result is, in one place.
 *
 * The shape is fixed by `docs/v2/call-results-contract.md`, which four agents
 * built against at once on 14 Nov. Nothing here invents a field: every value
 * below is one the endpoint takes or one it answers with.
 *
 * It is a plain module rather than a component so the bar, the note box, the
 * saved-notes list and the two screens all read the same words. "No answer"
 * is written one way in this CRM.
 */

/** The six answers `POST /api/v2/leads/:id/call-result` takes. */
export const CALL_RESULTS = [
  'answered', 'no_answer', 'busy', 'call_back', 'wrong_number', 'not_interested',
] as const;

export type CallResult = (typeof CALL_RESULTS)[number];

/**
 * The words a person reads, never the stored key.
 *
 * The rule at the top of the owner's list: *"Never show raw codes to people:
 * no 'en', 'walk_in', 'csv_import', file names, or database ids."* So there
 * is exactly one place in the web app that turns `no_answer` into "No
 * answer", and it is this.
 */
export const RESULT_LABEL: Record<CallResult, string> = {
  answered: 'Answered',
  no_answer: 'No answer',
  busy: 'Busy',
  call_back: 'Call back',
  wrong_number: 'Wrong number',
  not_interested: 'Not interested',
};

/**
 * The state of the "did we reach them" run, exactly as the endpoint answers.
 *
 * `tries` counts `no_answer` and `busy` together — they are both "did not
 * speak to them". Anything else ends the run and sets `tries` back to 0.
 */
export interface NoAnswerState {
  tries: number;
  maxTries: number;
  lastTryAt: string | null;
  nextTryAt: string | null;
  exhausted: boolean;
  /**
   * The approved "I tried to call you" message in the client's own language.
   * **The server never sends it.** The agent presses send in WhatsApp.
   */
  whatsapp: { lang: string; text: string } | null;
}

/** What the endpoint is given. `callBackAt` only for `call_back`. */
export interface CallResultInput {
  result: CallResult;
  callBackAt?: string;
  note?: string;
}

/**
 * One line of the run, for the thin rows in the notes list.
 *
 * `tries` is null for a result read out of the lead's own history: nothing
 * stores which attempt a past "no answer" was, so the line says the result,
 * who and when, and leaves the count out rather than guessing at it.
 */
export interface CallResultLine {
  id: string;
  result: CallResult;
  tries: number | null;
  maxTries: number | null;
  who: string | null;
  at: string;
}

/** `answered` is stored as `interested` by the older call log. */
const FROM_ACTION: Record<string, CallResult> = {
  no_answer: 'no_answer',
  call_back: 'call_back',
};

/**
 * The call results already on a lead, read out of its timeline.
 *
 * `runLeadAction` writes `meta.action` on every activity it makes, so a "no
 * answer" logged from the dialler, from the lead page or from the new
 * endpoint all arrive here the same way. Only the two actions that can mean
 * nothing else are taken: `problem` and `lost` are also what the Wrong number
 * and Lost *dialogs* write, and a Lost recorded from the Lost dialog is not a
 * call result.
 */
export function resultsFromActivities(
  activities: Array<{
    id: string;
    type: string;
    meta?: unknown;
    user_name?: string | null;
    created_at: string;
  }>,
): CallResultLine[] {
  const out: CallResultLine[] = [];
  for (const one of activities) {
    const meta = one.meta as { action?: unknown } | null | undefined;
    const action = typeof meta?.action === 'string' ? meta.action : one.type;
    const result = FROM_ACTION[action];
    if (!result) continue;
    out.push({
      id: one.id,
      result,
      tries: null,
      maxTries: null,
      who: one.user_name ?? null,
      at: one.created_at,
    });
  }
  return out;
}

/**
 * A sentence with the emoji taken out of it.
 *
 * The owner has asked three times for no emoji anywhere in the CRM. Some of
 * the sentences on these screens are written by the server — `SAID` in
 * `server/src/leads/actions.ts` answers "Moved to Interested 🔥" and "Deal
 * won! 🏆" — and the server is another pair of hands this week. Rather than
 * print what arrives, it is cleaned on the way to the screen. Older notes in
 * the database start "🎤 Voice note" for the same reason: the note box used
 * to write that, and those rows are already saved.
 *
 * It only removes pictographs. Arabic, Cyrillic, accents and punctuation are
 * left exactly as they were typed.
 */
export function plain(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}]/gu,
      '',
    )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
