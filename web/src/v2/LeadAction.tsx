import { useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from '../design/index.js';

/**
 * The four buttons that change where a lead stands.
 *
 * They all go through `/api/my-leads/:id/action` — the same endpoint the live
 * CRM's lead page uses — so a lead moved here and a lead moved there mean the
 * same thing in every report afterwards.
 *
 * Each one asks for exactly what the business rule needs and nothing else:
 * a follow-up needs a time, a meeting needs a time and a place, Lost needs a
 * reason, and Won asks twice because it is the one nobody wants to press by
 * accident.
 */

export type LeadActionKind = 'follow_up' | 'meeting' | 'won' | 'lost';

const LOST_REASONS = [
  { key: 'bought_elsewhere', label: 'Bought somewhere else' },
  { key: 'budget_too_low', label: 'Budget too low' },
  { key: 'just_browsing', label: 'Only looking' },
  { key: 'not_reachable', label: 'Never reachable' },
  { key: 'changed_plans', label: 'Changed their plans' },
  { key: 'other', label: 'Something else' },
];

const SOON = [
  { minutes: 120, label: 'In 2 hours' },
  { minutes: 24 * 60, label: 'Tomorrow' },
  { minutes: 3 * 24 * 60, label: 'In 3 days' },
  { minutes: 7 * 24 * 60, label: 'Next week' },
];

export function LeadAction({ kind, opportunityId, onDone, onCancel }: {
  kind: LeadActionKind;
  opportunityId: string;
  onDone: (said: string) => void;
  onCancel: () => void;
}) {
  const [at, setAt] = useState(() => toLocalInput(roundUp(new Date(Date.now() + 2 * 3_600_000))));
  const [note, setNote] = useState('');
  const [where, setWhere] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [project, setProject] = useState('');
  const [unit, setUnit] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const ready = kind === 'lost' ? reason !== null
    : kind === 'won' ? sure
      : at.length > 0;

  async function go() {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      const body: Record<string, unknown> = { note: note.trim() || null };

      if (kind === 'follow_up') {
        body.action = 'call_back';
        body.nextStep = { type: 'call', at: new Date(at).toISOString(), note: note.trim() || null };
      } else if (kind === 'meeting') {
        body.action = 'meeting';
        body.meetingAt = new Date(at).toISOString();
        body.meetingWhere = where.trim() || null;
        body.nextStep = { type: 'meeting', at: new Date(at).toISOString(), note: where.trim() || null };
      } else if (kind === 'won') {
        body.action = 'won';
        body.wonProject = project.trim() || null;
        body.wonUnit = unit.trim() || null;
      } else {
        body.action = 'lost';
        body.reason = reason;
      }

      const result = await api.post<{ said: string }>(
        `/api/my-leads/${opportunityId}/action`, body,
      );

      /*
       * A meeting also goes in the diary. The action moves the stage; the
       * calendar is where the agent looks on the morning of. Doing one
       * without the other is how a booked viewing gets missed.
       */
      if (kind === 'meeting') {
        const starts = new Date(at);
        await api.post('/api/v2/meetings', {
          opportunityId,
          kind: 'meeting',
          title: where.trim() || null,
          startsAt: starts.toISOString(),
          endsAt: new Date(starts.getTime() + 3_600_000).toISOString(),
          place: where.trim() || null,
        }).catch(() => undefined);
      }

      onDone(result.said);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="v2-card v2-action">
      <div className="v2-action-head">
        <h2 className="v2-card-t">{TITLE[kind]}</h2>
        <button type="button" className="d-card-link" onClick={onCancel}>Not now</button>
      </div>

      {(kind === 'follow_up' || kind === 'meeting') && (
        <>
          <div className="v2-chips">
            {SOON.map((one) => (
              <button key={one.minutes} type="button" className="v2-chip-opt"
                onClick={() => setAt(toLocalInput(roundUp(new Date(Date.now() + one.minutes * 60_000))))}>
                {one.label}
              </button>
            ))}
          </div>
          <label className="v2-field v2-field-wide">
            <span>When</span>
            <input className="d-input" type="datetime-local" value={at}
              min={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} />
          </label>
        </>
      )}

      {kind === 'meeting' && (
        <label className="v2-field v2-field-wide">
          <span>Where</span>
          <input className="d-input" value={where} placeholder="Emaar sales centre, or our office"
            onChange={(e) => setWhere(e.target.value)} />
        </label>
      )}

      {kind === 'won' && (
        <>
          <div className="v2-two">
            <label className="v2-field v2-field-wide">
              <span>Project</span>
              <input className="d-input" value={project} onChange={(e) => setProject(e.target.value)} />
            </label>
            <label className="v2-field v2-field-wide">
              <span>Unit</span>
              <input className="d-input" value={unit} placeholder="1204" onChange={(e) => setUnit(e.target.value)} />
            </label>
          </div>
          <label className="v2-switch">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            <span>Yes — they bought it.</span>
          </label>
        </>
      )}

      {kind === 'lost' && (
        <>
          <span className="v2-field-label">Why? *</span>
          <div className="v2-chips">
            {LOST_REASONS.map((one) => (
              <button key={one.key} type="button"
                className={reason === one.key ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
                onClick={() => setReason(one.key)}>{one.label}</button>
            ))}
          </div>
          <p className="d-small d-muted">
            It moves to Lost with the reason you give. You can reopen it later.
          </p>
        </>
      )}

      {kind !== 'lost' && (
        <label className="v2-field v2-field-wide">
          <span>Note</span>
          <input className="d-input" value={note} placeholder="Anything worth remembering"
            onChange={(e) => setNote(e.target.value)} />
        </label>
      )}

      {problem && <p className="v2-problem">{problem}</p>}

      <button
        type="button"
        className={kind === 'lost' ? 'd-btn d-danger d-solid' : 'd-btn d-primary'}
        disabled={!ready || busy}
        onClick={go}
      >
        {busy ? 'Saving…' : DO[kind]}
      </button>
    </section>
  );
}

const TITLE: Record<LeadActionKind, string> = {
  follow_up: 'When will you come back to them?',
  meeting: 'Book the meeting',
  won: 'They bought',
  lost: 'Close this lead',
};

const DO: Record<LeadActionKind, string> = {
  follow_up: 'Set the follow-up',
  meeting: 'Book it',
  won: 'Mark it Won',
  lost: 'Mark it Lost',
};

/** The next whole hour, because nobody plans a call for 14:37. */
function roundUp(at: Date): Date {
  const out = new Date(at);
  out.setMinutes(0, 0, 0);
  if (out <= at) out.setHours(out.getHours() + 1);
  return out;
}

/** Local wall-clock text for a `datetime-local`, never a UTC ISO string. */
function toLocalInput(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
    + `T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/** The icon on each of the four buttons. */
export const ACTION_ICON: Record<LeadActionKind, string> = {
  follow_up: 'calendar-check',
  meeting: 'calendar-days',
  won: 'trophy',
  lost: 'x',
};

export function ActionButton({ kind, label, onClick }: {
  kind: LeadActionKind; label: string; onClick: () => void;
}) {
  return (
    <button type="button" className={`v2-act v2-act-${kind}`} onClick={onClick}>
      <Icon name={ACTION_ICON[kind] as never} />{label}
    </button>
  );
}
