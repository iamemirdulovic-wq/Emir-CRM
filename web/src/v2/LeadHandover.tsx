import type { ReactNode } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { given, NOT_GIVEN } from '../lib/assigned.js';
import { REASONS } from './Transfers.js';

/**
 * The owner's "two dates", on the lead page.
 *
 * Emir, 14 Nov 2026, after the single "Given out" date shipped that morning:
 *
 * > "We can add like something kind of like, exact date when leads coming from
 * > admin and owner, always need to show date, and if we have another agents
 * > like transfer leads date it's need to also showing like on the leads page,
 * > this leads transfer from this agent with the date, mean 2 dates."
 *
 * `opportunities.assigned_at` is one date — the current holder's — so the
 * second one cannot come off the lead row at all. It comes from
 * `lead_assignments`, which has held one row per hand-out since migration
 * 0013; `server/src/leads/handovers.ts` says why that table and not
 * `lead_transfers`, and does the reconciling.
 *
 * **Oldest first.** This is a chain of custody, not a log: read down it and
 * the story arrives in the order it happened, which is the order the owner
 * described it in — and the left column of the lead page already says who
 * holds it now. The page's other list, Change history, is newest first,
 * because that one *is* a log and the latest change is the interesting one.
 *
 * **Nothing here is guessed.** A hand-out the CRM made by itself says so
 * rather than naming a person; one this CRM recorded without a giver gives
 * the date and names nobody; a transfer with no reason stored shows no
 * reason.
 *
 * The design file has no block for a hand-over chain, so this borrows the one
 * idiom it does have for a short list of past events with a date on the right
 * — the Change history's `divide small` of `row`s — and sits in the middle
 * column, under "In short", which is the column for what has happened.
 */

/** What a transfer request came to, where the lead did not actually move. */
export type AttemptOutcome = 'pending' | 'needs_approval' | 'refused' | 'cancelled' | 'expired';

export interface HandoverStep {
  id: string;
  /** For a hand-over, when this person got it; for an attempt, when it was asked. */
  at: string;
  /** `handover` — the lead moved. `attempt` — a request that did not move it. */
  kind: 'handover' | 'attempt';
  /** The agent who received it, or would have. */
  toName: string | null;
  /** Who had it before. Null means this is the first hand-out on record. */
  fromName: string | null;
  /** `person` names `byName`; `crm` means the CRM did it; `unknown` names nobody. */
  by: 'person' | 'crm' | 'unknown';
  byName: string | null;
  /** The transfer reason as its stored key, or null where none was recorded. */
  reason: string | null;
  note: string | null;
  /** Only on an attempt: the stored status, which this file turns into words. */
  outcome: AttemptOutcome | null;
  /** Only on an attempt that ended. Null while it is still waiting. */
  decidedAt: string | null;
}

/**
 * The stored status, in words a person reads.
 *
 * Emir's first rule on the 14 Nov list: *"Never show raw codes to people… no
 * 'en', 'walk_in', 'csv_import', file names, or database ids. Always simple
 * English words."* `needs_approval` is a column value, not a sentence.
 *
 * `refused` says no name on purpose. Two different people can refuse — the
 * agent it was offered to, and the owner whose approval a Meeting or Offer
 * lead needs — and `lead_transfers` stores the same `refused` for both. We
 * cannot tell them apart, so we do not guess which.
 */
export function outcomeWord(outcome: AttemptOutcome, toName: string | null): string {
  switch (outcome) {
    /* Still live: nobody has answered it yet. Named, because "waiting" with
       no name is the thing an owner has to go and look up. */
    case 'pending': return `waiting for ${toName ?? 'the other agent'}`;
    case 'needs_approval': return 'waiting for the owner';
    case 'refused': return 'refused';
    case 'cancelled': return 'cancelled';
    case 'expired': return 'ran out of time';
    default: return 'not completed';
  }
}

export function LeadHandover({ leadId }: { leadId: string }) {
  const rows = useAsync<{ items: HandoverStep[] }>(
    () => api.get(`/api/my-leads/${leadId}/handover`),
    [leadId],
  );
  const items = rows.data?.items ?? [];

  return (
    <section className="d-card" aria-label="Who has had this lead">
      <div className="d-card-head d-mb-8">
        <h3>Who has had this lead</h3>
      </div>
      {rows.error && <p className="d-small d-muted">{rows.error}</p>}
      {!rows.data && !rows.error && <p className="d-small d-muted">Reading the history…</p>}
      {/* The one wording for a lead nobody has been given, from the one module
          that owns it — `lib/assigned.ts`, so this screen cannot word it a
          second way. */}
      {rows.data && items.length === 0 && <p className="d-small d-muted">{NOT_GIVEN}</p>}
      {items.length > 0 && (
        <div className="d-divide d-small">
          {items.map((step) => {
            /* Dubai at the fixed +04:00, 24-hour, and the whole date with its
               weekday on the hover — the same helper the three leads screens
               use, so a date cannot read one way here and another there. */
            const line = given(step.at);
            const why = handoverWhy(step);
            const attempt = step.kind === 'attempt';
            return (
              <div
                className={attempt ? 'd-row v2-leadhand-row v2-leadhand-off' : 'd-row v2-leadhand-row'}
                key={step.id}
              >
                <span className="d-grow">
                  {handoverLine(step)}
                  {why !== null && <span className="v2-leadhand-why">{why}</span>}
                </span>
                <span className="d-muted v2-leadhand-when" title={whenTitle(step, line.exact)}>
                  {line.when}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * The hover: the asked-for date in full, and when a request ended.
 *
 * Two dates on one line would be noise, and the row's own date is the one
 * that matters — when the transfer was asked for. The moment it was cancelled
 * or refused lives here, where it is one hover away and nothing is lost.
 */
export function whenTitle(step: HandoverStep, exact: string | null): string | undefined {
  if (step.kind !== 'attempt') return exact ?? undefined;
  const asked = exact === null ? null : `Asked ${exact}`;
  const ended = step.decidedAt === null || step.outcome === null
    ? null
    : `${sentence(outcomeWord(step.outcome, step.toName))} ${given(step.decidedAt).exact ?? ''}`.trim();
  const parts = [asked, ended].filter((one): one is string => one !== null && one !== '');
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** `cancelled` at the start of a sentence is `Cancelled`. */
function sentence(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * "Given out by Emir to Talha", "Transferred from Talha to Raj", and — since
 * 14 Nov — "Transfer from Talha to Tej · cancelled".
 *
 * The verb is the tell, and it is deliberate: **"Transferred"** is the past
 * tense and means the lead moved; **"Transfer"** is the noun and names a
 * request that did not move it. The outcome word says which in plain English
 * beside it, and the whole row is greyed, so a cancelled request cannot be
 * mistaken for a hand-over at a glance.
 */
export function handoverLine(step: HandoverStep): ReactNode {
  const to = <b className="d-bold">{step.toName ?? 'an agent'}</b>;

  if (step.kind === 'attempt') {
    return (
      <>
        Transfer from <b className="d-bold">{step.fromName ?? 'an agent'}</b> to {to}
        {step.outcome !== null && (
          <>
            {' · '}
            <span className="v2-leadhand-out">{outcomeWord(step.outcome, step.toName)}</span>
          </>
        )}
      </>
    );
  }

  if (step.fromName === null) {
    /*
     * The first hand-out. `crm` is the normal case for a lead the CRM placed
     * by itself — `lead_assignments.assigned_by_user_id` is NULL — and
     * `unknown` is a hand-out this CRM recorded without a giver. Neither one
     * names a person who did not do it.
     */
    if (step.by === 'person' && step.byName !== null) {
      return <>Given out by <b className="d-bold">{step.byName}</b> to {to}</>;
    }
    if (step.by === 'crm') return <>Given out by the CRM to {to}</>;
    return <>Given out to {to}</>;
  }

  return <>Transferred from <b className="d-bold">{step.fromName}</b> to {to}</>;
}

/** The quiet second line: who moved it, why, and what they typed. */
export function handoverWhy(step: HandoverStep): string | null {
  const parts: string[] = [];
  /* On an attempt the sender is already in the sentence, and the reason is
     the point of the line — `lead_transfers.reason` is NOT NULL, so there is
     always one to show. */
  if (step.kind === 'attempt') {
    if (step.reason !== null) parts.push(REASONS[step.reason] ?? step.reason.replace(/_/g, ' '));
    if (step.note !== null) parts.push(`“${step.note}”`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  /* Only on a move: on the first line the giver is already in the sentence. */
  if (step.fromName !== null) {
    if (step.by === 'person' && step.byName !== null && step.byName !== step.fromName) {
      parts.push(`Moved by ${step.byName}`);
    }
    if (step.by === 'crm') parts.push('Moved by the CRM');
  }
  /* The stored value is a key, not words. The words are the ones the transfer
     screen offers, from the one map that holds them. */
  if (step.reason !== null) parts.push(REASONS[step.reason] ?? step.reason.replace(/_/g, ' '));
  if (step.note !== null) parts.push(`“${step.note}”`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
