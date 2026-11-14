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

export interface HandoverStep {
  id: string;
  /** When this person got it, ISO. */
  at: string;
  /** The agent who received it. */
  toName: string | null;
  /** Who had it before. Null means this is the first hand-out on record. */
  fromName: string | null;
  /** `person` names `byName`; `crm` means the CRM did it; `unknown` names nobody. */
  by: 'person' | 'crm' | 'unknown';
  byName: string | null;
  /** The transfer reason as its stored key, or null where none was recorded. */
  reason: string | null;
  note: string | null;
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
            return (
              <div className="d-row v2-leadhand-row" key={step.id}>
                <span className="d-grow">
                  {handoverLine(step)}
                  {why !== null && <span className="v2-leadhand-why">{why}</span>}
                </span>
                <span className="d-muted v2-leadhand-when" title={line.exact ?? undefined}>
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

/** "Given out by Emir to Talha", "Transferred from Talha to Raj". */
export function handoverLine(step: HandoverStep): ReactNode {
  const to = <b className="d-bold">{step.toName ?? 'an agent'}</b>;

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
