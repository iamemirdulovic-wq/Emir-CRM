/**
 * Ringing a lead, and opening WhatsApp on one, from anywhere in the CRM.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `POST /api/v2/calls` and `POST /api/v2/taps` are what every figure the owner
 * reads is built from: calls today, WhatsApp clicks today, who has not rung
 * anybody since nine, the messaging report, speed-to-lead, the clicks-by-hour
 * chart on Team live, and the "not checked in" card beside it. Until now only
 * the power dialler (`Calling.tsx`) posted to them. Every other Call and
 * WhatsApp button in the app was a plain `tel:` or `wa.me` link, so a call an
 * agent made from the lead page, from My day, from the pipeline board, from a
 * task or from the inbox simply did not happen as far as the CRM was
 * concerned. The owner found it on 13 Nov. One helper, so a screen cannot get
 * this half right.
 *
 * ── How to use it ───────────────────────────────────────────────────────────
 *
 *     import { useCallAction } from './call.js';
 *
 *     function LeadPage({ lead }: { lead: Lead }) {
 *       const dial = useCallAction({ source: 'lead' });
 *
 *       return (
 *         <>
 *           {dial.banner}
 *           <button type="button" onClick={() => void dial.call(lead)}>Call</button>
 *           <button type="button" onClick={() => void dial.whatsapp(lead)}>WhatsApp</button>
 *         </>
 *       );
 *     }
 *
 * Four things worth knowing:
 *
 *  1. **`banner` must be rendered**, once, anywhere inside the component. It
 *     carries the check-in sheet — the dialog that asks an agent whether they
 *     are in the office before their first call of the day — and anything the
 *     helper has to say when a tap could not be recorded. Without it on the
 *     page the question cannot be asked, so `call()` would hang.
 *  2. **`call` and `whatsapp` take the lead, not a number.** They accept
 *     either spelling the screens use: `phone` or `phone_e164`, `name` or
 *     `full_name`. `id` is the **opportunity** id, because that is what a call
 *     is recorded against. A screen that only has a contact cannot use this
 *     yet (see the note on the inbox at the foot of this comment).
 *  3. **Both are `async` and never throw.** A recording that fails must not
 *     stop an agent ringing a client, so the `tel:`/`wa.me` hand-off happens
 *     either way and the failure goes in `banner` and in `error`. They return
 *     the id of the row that was written, or null when nothing was written —
 *     pass that id to `PATCH /api/v2/calls/{id}` or `/api/v2/taps/{id}` if the
 *     screen asks "what happened?" afterwards.
 *  4. **The check-in gate is on calls only**, which is how the dialler and the
 *     phone bar already behave: the sheet's own words are about calls ("Call
 *     anyway", "calls need a check-in"), and `message_taps` has no column to
 *     record the answer in, so asking before a WhatsApp tap would collect an
 *     answer and throw it away. `useCheckIn` is reused as it is — there is one
 *     gate in this CRM, in `check-in.tsx`, and it is not reimplemented here.
 *
 * A tap is never written down as "sent". The CRM hands over to the real app
 * and cannot know what happened there; the agent presses send themselves.
 * That is the rule the whole figure depends on (pages.md, global rules).
 *
 * Still to wire up, and one of them needs the server first: the inbox thread
 * header has a Call button but the inbox payload carries no opportunity id, so
 * that one cannot be recorded until the id is added to it. Noted in
 * `docs/v2/questions-bugs.md`.
 */
import { createElement, Fragment, useCallback, useState, type ReactNode } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../design/ui.js';
import { useCheckIn } from './check-in.js';

/**
 * What a screen has to know about a lead to ring it.
 *
 * Both field spellings are accepted on purpose. The v2 screens were built
 * from different endpoints and some call the number `phone` while others call
 * it `phone_e164`; a helper that insisted on one of them would be wired in
 * with a mapping object at every call site, and the mapping is where the
 * mistakes would live.
 */
export interface CallableLead {
  /** The **opportunity** id. A call is recorded against the lead, not the person. */
  id: string;
  phone?: string | null;
  phone_e164?: string | null;
  name?: string | null;
  full_name?: string | null;
}

/** Where the tap came from, so the owner can tell the dialler from the rest. */
export type CallSource = 'lead' | 'dialler' | 'followup' | 'incoming' | 'other';

export interface CallActions {
  /** Record a call and open the phone. Returns the call id, or null. */
  call: (lead: CallableLead, options?: { source?: CallSource }) => Promise<string | null>;
  /** Record a tap and open WhatsApp (or Telegram). Returns the tap id, or null. */
  whatsapp: (
    lead: CallableLead,
    options?: { text?: string | null; app?: 'whatsapp' | 'telegram'; templateKey?: string | null },
  ) => Promise<string | null>;
  /** The check-in sheet and anything that went wrong. Render it once. */
  banner: ReactNode;
  /** The last problem, for a screen that would rather place it itself. */
  error: string | null;
}

export interface CallActionOptions {
  /** Default for every `call` from this screen. Overridable per call. */
  source?: CallSource;
  /**
   * Show the amber "you are not checked in" strip as part of `banner`.
   *
   * Off by default, like every screen that uses the gate inside a page. The
   * strip belongs at the top of a whole screen, and a second copy of it
   * halfway down a lead page is noise rather than a warning.
   */
  strip?: boolean;
}

/** The digits `wa.me` wants: no plus, no spaces, no brackets. */
function waDigits(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

function numberOf(lead: CallableLead): string | null {
  const raw = (lead.phone ?? lead.phone_e164 ?? '').trim();
  return raw.length > 0 ? raw : null;
}

function said(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function useCallAction(options: CallActionOptions = {}): CallActions {
  const defaultSource: CallSource = options.source ?? 'lead';
  const gate = useCheckIn({ strip: options.strip ?? false });
  /* Destructured: `useCheckIn` hands back a fresh object every render, so
     depending on the object itself would rebuild these callbacks on every
     keystroke of whatever screen is using them. `ask` is stable. */
  const { ask } = gate;
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (
    lead: CallableLead,
    over: { source?: CallSource } = {},
  ): Promise<string | null> => {
    const phone = numberOf(lead);
    if (!phone) {
      setError('There is no phone number on this lead.');
      return null;
    }
    setError(null);

    /* The check-in question, if this agent has not answered it today. All
       three answers let the call happen — "Call anyway" marks the call as not
       checked in, which is the whole point of asking rather than blocking. */
    const answer = await ask();
    if (answer === 'cancel') return null;

    let id: string | null = null;
    try {
      const started = await api.post<{ id: string }>('/api/v2/calls', {
        opportunityId: lead.id,
        source: over.source ?? defaultSource,
        notCheckedIn: answer === 'anyway',
      });
      id = started.id;
    } catch (err) {
      /*
       * The recording failed; the call still goes through.
       *
       * An agent with a client waiting is not going to stop and read an
       * error, and a CRM that refuses to dial because it could not write a
       * row is a CRM people work around. The owner sees the gap in the
       * figures, which is the honest outcome, so it is said out loud rather
       * than swallowed.
       */
      setError(said(err, 'The call could not be recorded. Dialling anyway.'));
    }

    /* `location.href` rather than `window.open`: a `tel:` link opens the
       phone's dialler and is never caught by a popup blocker. */
    window.location.href = `tel:${phone}`;
    return id;
  }, [ask, defaultSource]);

  const whatsapp = useCallback(async (
    lead: CallableLead,
    over: { text?: string | null; app?: 'whatsapp' | 'telegram'; templateKey?: string | null } = {},
  ): Promise<string | null> => {
    const phone = numberOf(lead);
    if (!phone) {
      setError('There is no phone number on this lead.');
      return null;
    }
    setError(null);

    const app = over.app ?? 'whatsapp';
    const text = (over.text ?? '').trim();

    /*
     * Started, then the window, then awaited.
     *
     * `window.open` has to happen while the browser still counts this as the
     * agent's own click — after an awaited request Safari treats it as a
     * popup and blocks it. So the request is kicked off, the app is opened,
     * and only then is the id waited for.
     */
    const posting = api.post<{ id: string }>('/api/v2/taps', {
      opportunityId: lead.id,
      app,
      ...(text ? { text } : {}),
      ...(over.templateKey ? { templateKey: over.templateKey } : {}),
    });

    const query = text ? `?text=${encodeURIComponent(text)}` : '';
    /* `t.me/+<digits>` is Telegram's own form for opening a chat with a
       number; `wa.me/<digits>` is WhatsApp's. Neither carries a session, so
       the agent sees their own app with the message typed in. */
    const url = app === 'telegram'
      ? `https://t.me/+${waDigits(phone)}`
      : `https://wa.me/${waDigits(phone)}${query}`;
    window.open(url, '_blank', 'noreferrer');
    toast(`${app === 'telegram' ? 'Telegram' : 'WhatsApp'} opened. You press send.`);

    try {
      return (await posting).id;
    } catch (err) {
      setError(said(err, 'That message could not be recorded.'));
      return null;
    }
  }, [toast]);

  const banner = createElement(
    Fragment,
    null,
    gate.banner,
    error ? createElement('p', { className: 'v2-gate-said', key: 'call-error' }, error) : null,
  );

  return { call, whatsapp, banner, error };
}
