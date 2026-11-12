import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote } from '../design/ui.js';
import { clockIn, flagOf, originOf, whenToCall } from '../lib/dialling.js';
import { useCheckIn } from './check-in.js';

/**
 * Calling: one lead at a time, until the list is done.
 *
 * `docs/v2/pages.md` §13. The rule that shapes the whole screen: **an outcome
 * cannot be set before the agent has pressed Call or WhatsApp.** The CRM has
 * no way of knowing whether a call happened, so the only honest sequence is
 * tap first, then say what happened — and a result recorded without a tap is
 * a figure nobody should trust afterwards.
 *
 * The second rule: *Next* is locked until the result is saved, or the agent
 * presses *Skip*. A lead walked past without an answer is the thing that
 * leaves a queue looking done when it is not.
 */

interface QueueLead {
  id: string;
  contactId: string;
  name: string | null;
  phone: string | null;
  project: string | null;
  unitType: string | null;
  budgetMinAed: number | null;
  budgetMaxAed: number | null;
  language: string | null;
  stage: string;
  score: number | null;
  scoreReason: string | null;
  isVip: boolean;
  nextStepAt: string | null;
  nextStepNote: string | null;
  lastContactAt: string | null;
  noAnswerCount: number;
  calledToday: boolean;
}

type Outcome = 'interested' | 'no_answer' | 'busy' | 'call_back' | 'wrong_number' | 'not_interested';

const OUTCOMES: Array<{ key: Outcome; label: string; icon: string }> = [
  { key: 'interested', label: 'Interested', icon: 'star' },
  { key: 'no_answer', label: 'No answer', icon: 'phone' },
  { key: 'busy', label: 'Busy', icon: 'clock' },
  { key: 'call_back', label: 'Call back', icon: 'calendar-days' },
  { key: 'wrong_number', label: 'Wrong number', icon: 'alert-triangle' },
  { key: 'not_interested', label: 'Not interested', icon: 'x' },
];

const LOST_REASONS = [
  { key: 'bought_elsewhere', label: 'Bought somewhere else' },
  { key: 'budget_too_low', label: 'Budget too low' },
  { key: 'just_browsing', label: 'Only looking' },
  { key: 'changed_plans', label: 'Changed their plans' },
  { key: 'other', label: 'Something else' },
];

/** The six stages, in the words the board uses. */
const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New', attempted_contact: 'Called', engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting', deal_sent: 'Offer', won: 'Won', lost: 'Lost',
};

const AED = (n: number | null): string =>
  (n === null ? '—' : `AED ${n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n.toLocaleString()}`);

export function V2Calling() {
  const queue = useAsync<{ items: QueueLead[] }>(() => api.get('/api/v2/queue'), []);
  const [at, setAt] = useState(0);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [calls, setCalls] = useState(0);
  const [taps, setTaps] = useState(0);

  const items = queue.data?.items ?? [];
  const lead = items[at];

  if (queue.error) return <ErrorNote>{queue.error}</ErrorNote>;
  if (!queue.data) return <Spinner />;

  if (items.length === 0) {
    return (
      <div className="p-calling v2-calling">
        <div className="v2-empty">
          <span className="v2-empty-mark"><Icon name="check-check" /></span>
          <h2>Nothing to call today</h2>
          <p>Every follow-up you promised is done. Worth a look at your hot leads.</p>
          <Link className="d-btn d-primary" to="/v2/leads?tab=hot">See my hot leads</Link>
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="p-calling v2-calling">
        <Summary calls={calls} taps={taps} saved={done.size} left={items.length - done.size} />
      </div>
    );
  }

  return (
    <div className="p-calling v2-calling">
      <Topline
        at={at}
        total={items.length}
        calls={calls}
        taps={taps}
        saved={done.size}
      />

      <div className="v2-call-grid">
        <div className="v2-call-main">
          <LeadCard
            key={lead.id}
            lead={lead}
            onCalled={() => setCalls((n) => n + 1)}
            onTapped={() => setTaps((n) => n + 1)}
            onSaved={() => {
              setDone((was) => new Set(was).add(lead.id));
              queue.reload();
            }}
            onNext={() => setAt((n) => n + 1)}
            onPrev={() => setAt((n) => Math.max(0, n - 1))}
            canGoBack={at > 0}
            saved={done.has(lead.id)}
          />
        </div>

        <aside className="d-card v2-queue">
          <div className="d-card-head v2-queue-head">
            <h3>Today&apos;s list</h3>
            <span className="d-small d-muted">VIP first</span>
          </div>
          <ol className="v2-queue-list">
            {items.map((row, i) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={
                    `v2-qrow${i === at ? ' v2-qrow-on' : ''}${done.has(row.id) ? ' v2-qrow-done' : ''}`
                  }
                  onClick={() => setAt(i)}
                >
                  <span className="v2-qrow-n">{i + 1}</span>
                  <span className="v2-qrow-who">
                    <b>{row.name ?? 'Unnamed lead'}</b>
                    <span>{row.project ?? 'No project'}</span>
                  </span>
                  {row.isVip && <span className="v2-vip">VIP</span>}
                  {done.has(row.id) && <Icon name="check" />}
                </button>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}

function Topline({ at, total, calls, taps, saved }: {
  at: number; total: number; calls: number; taps: number; saved: number;
}) {
  return (
    <div className="v2-topline">
      <span className="v2-pos">Lead {at + 1} <span>of {total}</span></span>
      <div className="d-bar d-accent" style={{ '--v': `${Math.round((at / total) * 100)}%` } as React.CSSProperties}><i /></div>
      <div className="v2-counts">
        <span><b>{calls}</b> calls</span>
        <span><b>{taps}</b> WhatsApp</span>
        <span><b>{saved}</b> results saved</span>
      </div>
      <Link className="d-btn d-sm" to="/v2">End session</Link>
    </div>
  );
}

function LeadCard({ lead, onCalled, onTapped, onSaved, onNext, onPrev, canGoBack, saved }: {
  lead: QueueLead;
  onCalled: () => void;
  onTapped: () => void;
  onSaved: () => void;
  onNext: () => void;
  onPrev: () => void;
  canGoBack: boolean;
  saved: boolean;
}) {
  const gate = useCheckIn();
  const [callId, setCallId] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState<string | null>(null);
  const [callBack, setCallBack] = useState(() => defaultCallBack());
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const origin = originOf(lead.phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  const advice = whenToCall(local, origin?.timeZone ?? null);

  /* A new lead is a clean slate: nothing from the last one may carry over. */
  useEffect(() => {
    setCallId(null); setTouched(false); setOutcome(null); setNote('');
    setReason(null); setSaid(null); setError(null);
  }, [lead.id]);

  const call = useCallback(async () => {
    const answer = await gate.ask();
    if (answer === 'cancel') return;
    try {
      const started = await api.post<{ id: string }>('/api/v2/calls', {
        opportunityId: lead.id,
        source: 'dialler',
        notCheckedIn: answer === 'anyway',
      });
      setCallId(started.id);
      setTouched(true);
      onCalled();
      if (lead.phone) window.location.href = `tel:${lead.phone}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  }, [gate, lead.id, lead.phone, onCalled]);

  const whatsapp = useCallback(async () => {
    try {
      await api.post('/api/v2/taps', { opportunityId: lead.id, app: 'whatsapp' });
      setTouched(true);
      onTapped();
      if (lead.phone) {
        window.open(`https://wa.me/${lead.phone.replace(/[^\d]/g, '')}`, '_blank', 'noreferrer');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  }, [lead.id, lead.phone, onTapped]);

  const needsReason = outcome === 'not_interested';
  const needsWhy = outcome === 'call_back';
  const ready = outcome !== null
    && (!needsReason || reason !== null)
    && (!needsWhy || note.trim().length > 0);

  async function save() {
    if (!ready || !outcome) return;
    setSaving(true);
    setError(null);
    try {
      /*
       * WhatsApp-only outcomes have no call behind them. A call row is still
       * what carries the result, so one is opened and closed in the same
       * breath — the alternative is a second shape of record that every
       * report would then have to know about.
       */
      const id = callId ?? (await api.post<{ id: string }>('/api/v2/calls', {
        opportunityId: lead.id, source: 'dialler',
      })).id;

      const result = await api.patch<{ said: string }>(`/api/v2/calls/${id}`, {
        outcome,
        note: note.trim() || null,
        reason,
        callBackAt: outcome === 'call_back' ? new Date(callBack).toISOString() : null,
      });
      setSaid(result.said);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {gate.banner}

      <section className="d-card d-hero v2-call-lead" aria-label="Lead">
        <div className="v2-call-l">
          <div className="v2-c-name">
            <span>{lead.name ?? 'Unnamed lead'}</span>
            {lead.isVip && <span className="v2-vip">VIP</span>}
            <span className="d-hero-chip">{STAGE_LABEL[lead.stage] ?? lead.stage}</span>
          </div>
          <a className="v2-c-phone" href={lead.phone ? `tel:${lead.phone}` : undefined} dir="ltr">
            {lead.phone ?? 'No number'}
          </a>
          <div className="v2-c-meta">
            {origin && local && (
              <span>
                <span className="d-flag">{flagOf(origin.iso2)}</span>
                <b>{origin.name} {local.time}</b> their time
              </span>
            )}
            {lead.language && <span>Speaks <b>{lead.language}</b></span>}
          </div>
          {(lead.isVip || lead.scoreReason || (advice && !advice.ok)) && (
            <div className="v2-c-why">
              <Icon name="zap" />
              <span>
                {lead.isVip ? 'VIP lead — the owner gave this one personally'
                  : advice && !advice.ok ? advice.line
                    : lead.scoreReason}
              </span>
            </div>
          )}

          <div className="v2-c-btns">
            <button type="button" className="d-btn d-lg d-on-dark d-primary" onClick={call}>
              <Icon name="phone" />Call
            </button>
            <button type="button" className="d-btn d-lg d-on-dark" onClick={whatsapp}>
              <Icon name="message-circle" />WhatsApp
            </button>
            <Link className="d-btn d-lg d-on-dark" to={`/v2/leads/${lead.id}`}>Open the lead</Link>
          </div>
          <span className="v2-logged">
            Every tap is logged. The message itself is sent by you, in WhatsApp.
          </span>
        </div>

        <div className="v2-call-r">
          <dl className="v2-c-kv">
            <dt>Project</dt><dd>{lead.project ?? '—'}</dd>
            <dt>Budget</dt>
            <dd>
              {lead.budgetMinAed || lead.budgetMaxAed
                ? `${AED(lead.budgetMinAed)} – ${AED(lead.budgetMaxAed)}`
                : '—'}
            </dd>
            <dt>Wants</dt><dd>{lead.unitType ?? '—'}</dd>
            <dt>Tried</dt>
            <dd>{lead.noAnswerCount > 0 ? `${lead.noAnswerCount} times, no answer` : 'Not yet'}</dd>
          </dl>
        </div>
      </section>

      <section className={touched ? 'd-card' : 'd-card v2-locked'} aria-label="Result">
        <div className="d-card-head">
          <h3>What happened?</h3>
          {!touched && (
            <span className="v2-lockmsg"><Icon name="lock" />Press Call or WhatsApp first</span>
          )}
        </div>

        <div className="v2-outs">
          {OUTCOMES.map((one) => (
            <button
              key={one.key}
              type="button"
              disabled={!touched || saved}
              className={outcome === one.key ? 'v2-outb v2-outb-on' : 'v2-outb'}
              onClick={() => { setOutcome(one.key); setReason(null); }}
            >
              <Icon name={one.icon as never} />{one.label}
            </button>
          ))}
        </div>

        {outcome === 'no_answer' && (
          <p className="v2-sub"><Icon name="refresh-cw" /> This lead comes back in your list in <b>2 hours</b>.</p>
        )}
        {outcome === 'busy' && (
          <p className="v2-sub"><Icon name="refresh-cw" /> This lead comes back in your list in <b>1 hour</b>.</p>
        )}
        {outcome === 'interested' && (
          <p className="v2-sub">
            The lead moves to <b>Interested</b>. Choose what happens next on the lead page.
          </p>
        )}
        {outcome === 'wrong_number' && (
          <p className="v2-sub">
            The lead leaves your list and the owner sees “wrong number” on it.
          </p>
        )}
        {outcome === 'call_back' && (
          <div className="v2-sub v2-sub-form">
            <label className="v2-field">
              <span>When</span>
              <input
                className="d-input"
                type="datetime-local"
                value={callBack}
                min={localNow()}
                onChange={(e) => setCallBack(e.target.value)}
              />
            </label>
            <label className="v2-field v2-field-wide">
              <span>Why *</span>
              <input
                className="d-input"
                value={note}
                placeholder="In a meeting, asked for the evening…"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
        )}
        {outcome === 'not_interested' && (
          <div className="v2-sub">
            <span className="v2-field-label">Why? *</span>
            <div className="v2-chips">
              {LOST_REASONS.map((one) => (
                <button
                  key={one.key}
                  type="button"
                  className={reason === one.key ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
                  onClick={() => setReason(one.key)}
                >
                  {one.label}
                </button>
              ))}
            </div>
            <p className="d-small d-muted">The lead moves to Lost, with the reason you give.</p>
          </div>
        )}

        {outcome && outcome !== 'call_back' && (
          <label className="v2-field v2-field-wide">
            <span>Note (optional)</span>
            <input
              className="d-input"
              value={note}
              placeholder="Anything worth remembering"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        {said && (
          <p className="v2-saved"><Icon name="check" />{said}</p>
        )}

        <div className="v2-navrow">
          <button type="button" className="d-btn" onClick={onPrev} disabled={!canGoBack}>
            <Icon name="arrow-left" />Previous
          </button>
          <span className="d-small d-muted v2-nav-hint">
            {saved ? 'Saved. On to the next one.'
              : touched ? 'Save a result before Next, or skip this lead.'
                : 'Press Call or WhatsApp to start.'}
          </span>
          {!saved && (
            <button
              type="button"
              className="d-btn d-dark"
              onClick={save}
              disabled={!ready || saving}
            >
              {saving ? 'Saving…' : 'Save result'}
            </button>
          )}
          <button type="button" className="d-btn d-ghost" onClick={onNext}>Skip</button>
          <button
            type="button"
            className={saved ? 'd-btn d-primary' : 'd-btn v2-disabled'}
            onClick={() => saved && onNext()}
            disabled={!saved}
          >
            Next lead<Icon name="arrow-right" />
          </button>
        </div>
      </section>
    </>
  );
}

function Summary({ calls, taps, saved, left }: {
  calls: number; taps: number; saved: number; left: number;
}) {
  return (
    <div className="v2-empty">
      <span className="v2-empty-mark"><Icon name="trophy" /></span>
      <h2>That is the list</h2>
      <div className="v2-sumgrid">
        <div><b>{calls}</b><span>Calls</span></div>
        <div><b>{taps}</b><span>WhatsApps</span></div>
        <div><b>{saved}</b><span>Results saved</span></div>
      </div>
      {left > 0 && <p>{left} still have no result. They stay on your list.</p>}
      <Link className="d-btn d-primary" to="/v2">Back to My Day</Link>
    </div>
  );
}

/** Tomorrow at 11:00, which is what the design offers and what agents pick. */
function defaultCallBack(): string {
  const when = new Date(Date.now() + 86_400_000);
  when.setHours(11, 0, 0, 0);
  return toLocalInput(when);
}

function localNow(): string {
  return toLocalInput(new Date());
}

/**
 * A `datetime-local` input wants local wall-clock text, never an ISO string:
 * `toISOString()` is UTC, so in Dubai it would offer a time four hours before
 * the one the agent chose. No past dates anywhere (pages.md, global rules).
 */
function toLocalInput(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
    + `T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}
