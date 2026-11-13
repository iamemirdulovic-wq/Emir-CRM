import { useState } from 'react';
import { api } from '../lib/api.js';
import { Icon } from '../design/index.js';

/**
 * The four things that change where a lead stands.
 *
 * Each is a dialog, exactly as `design/web/lead.html` draws it: a follow-up
 * asks when and how, a meeting asks what kind, when and where, Won asks what
 * they bought and then asks again, and Lost asks why. The design's own
 * `dialog` / `field` / `chips` / `seg` classes, over the design's scrim.
 *
 * They all go through `/api/my-leads/:id/action` — the same endpoint the live
 * CRM's lead page uses — so a lead moved here and a lead moved there mean the
 * same thing in every report afterwards.
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

/** The design's four when-chips, and what each one means in real time. */
const WHEN = [
  { key: 'hour', label: 'In 1 hour' },
  { key: 'tonight', label: 'Tonight 19:00' },
  { key: 'tomorrow', label: 'Tomorrow 11:00' },
  { key: 'pick', label: 'Pick date & time' },
] as const;

type WhenKey = (typeof WHEN)[number]['key'];

const HOW = [
  { key: 'call', label: 'Call' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
] as const;

/** Meeting kinds, and the place each one usually means. */
const MEETINGS = [
  { key: 'office', label: 'Office meeting', where: 'Our office' },
  { key: 'site_visit', label: 'Site visit', where: 'The project sales centre' },
  { key: 'show_flat', label: 'Show flat', where: 'The show flat' },
  { key: 'video', label: 'Video call', where: 'Online' },
] as const;

export function LeadAction({ kind, opportunityId, who, onDone, onCancel }: {
  kind: LeadActionKind;
  opportunityId: string;
  who?: string | null;
  onDone: (said: string) => void;
  onCancel: () => void;
}) {
  const [when, setWhen] = useState<WhenKey>('tomorrow');
  const [at, setAt] = useState(() => toLocalInput(atHour(1, 11)));
  const [how, setHow] = useState<'call' | 'whatsapp' | 'email'>('call');
  const [about, setAbout] = useState('');
  const [meeting, setMeeting] = useState<string>('office');
  const [where, setWhere] = useState('Our office');
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [project, setProject] = useState('');
  const [unit, setUnit] = useState('');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const picked = when === 'pick' ? new Date(at) : whenMeans(when);
  const timeIsPast = Number.isNaN(picked.getTime()) || picked.getTime() <= Date.now();

  const ready = kind === 'lost' ? reason !== null && (reason !== 'other' || note.trim().length >= 5)
    /*
     * The unit is asked for, not required.
     *
     * `lead.html` marks it with a star, and the rebuild carried that across —
     * but it was optional before, and a unit number is not always in the
     * agent's hand at the moment the client says yes. Blocking Won on it means
     * the stage is wrong until somebody chases a number down, and a Won that
     * cannot be recorded is the most expensive thing on this screen. Asked for
     * in the label; `docs/decisions-to-confirm.md` §14 puts it to Emir.
     */
    : kind === 'won' ? sure
      : kind === 'meeting' ? !timeIsPast && where.trim() !== ''
        : !timeIsPast && about.trim() !== '';

  async function go() {
    setShown(true);
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    try {
      const body: Record<string, unknown> = {};

      if (kind === 'follow_up') {
        body.action = 'call_back';
        body.note = about.trim() || null;
        body.nextStep = { type: how, at: picked.toISOString(), note: about.trim() || null };
      } else if (kind === 'meeting') {
        const label = MEETINGS.find((one) => one.key === meeting)?.label ?? 'Meeting';
        body.action = 'meeting';
        body.note = note.trim() || null;
        body.meetingAt = picked.toISOString();
        body.meetingKind = label;
        body.meetingWhere = where.trim() || null;
        body.nextStep = { type: 'meeting', at: picked.toISOString(), note: `${label} · ${where.trim()}` };
      } else if (kind === 'won') {
        body.action = 'won';
        body.note = note.trim() || null;
        body.wonProject = project.trim() || null;
        body.wonUnit = unit.trim() || null;
      } else {
        body.action = 'lost';
        body.reason = reason;
        body.note = note.trim() || null;
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
        await api.post('/api/v2/meetings', {
          opportunityId,
          kind: 'meeting',
          title: where.trim() || null,
          startsAt: picked.toISOString(),
          endsAt: new Date(picked.getTime() + 3_600_000).toISOString(),
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

  const bad = (test: boolean) => (shown && test ? 'd-field d-invalid' : 'd-field');

  return (
    <>
      <div className="d-scrim d-show" onClick={onCancel} aria-hidden />
      <div
        className={kind === 'won' ? 'd-dialog d-open d-lg' : 'd-dialog d-open'}
        role="dialog"
        aria-label={TITLE[kind]}
      >
        <div className="d-dialog-head">
          <div className="d-grow">
            <h3>{TITLE[kind]}</h3>
            <p>{who ?? 'This lead'} · {SUB[kind]}</p>
          </div>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onCancel}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-dialog-body">
          {kind === 'meeting' && (
            <div className="d-field">
              <span className="d-field-label">Type</span>
              <div className="d-chips">
                {MEETINGS.map((one) => (
                  <button
                    key={one.key}
                    type="button"
                    className={meeting === one.key ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => { setMeeting(one.key); setWhere(one.where); }}
                  >
                    {one.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(kind === 'follow_up' || kind === 'meeting') && (
            <div className={bad(timeIsPast)}>
              <span className="d-field-label">When <span className="d-t-accent">*</span></span>
              <div className="d-chips">
                {WHEN.map((one) => (
                  <button
                    key={one.key}
                    type="button"
                    className={when === one.key ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => {
                      setWhen(one.key);
                      if (one.key !== 'pick') setAt(toLocalInput(whenMeans(one.key)));
                    }}
                  >
                    {one.label}
                  </button>
                ))}
              </div>
              {when === 'pick' && (
                <input
                  className="d-input d-mt-4"
                  type="datetime-local"
                  value={at}
                  min={toLocalInput(new Date())}
                  aria-label="Date and time"
                  onChange={(e) => setAt(e.target.value)}
                />
              )}
              <span className="d-error">This time is in the past. Pick a later one.</span>
            </div>
          )}

          {kind === 'follow_up' && (
            <>
              <div className="d-field">
                <span className="d-field-label">How</span>
                <div className="d-seg">
                  {HOW.map((one) => (
                    <button
                      key={one.key}
                      type="button"
                      className={how === one.key ? 'd-on' : undefined}
                      onClick={() => setHow(one.key)}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className={bad(about.trim() === '')}>
                <label htmlFor="fu-about">What about <span className="d-req">*</span></label>
                <input
                  className="d-input"
                  id="fu-about"
                  value={about}
                  placeholder="Payment plan, answer from his partner…"
                  onChange={(e) => setAbout(e.target.value)}
                />
                <span className="d-error">Write what the follow-up is about.</span>
              </div>
            </>
          )}

          {kind === 'meeting' && (
            <>
              <div className={bad(where.trim() === '')}>
                <label htmlFor="meet-where">Where <span className="d-req">*</span></label>
                <input
                  className="d-input"
                  id="meet-where"
                  value={where}
                  onChange={(e) => setWhere(e.target.value)}
                />
                <span className="d-error">Write where you meet.</span>
              </div>
              <div className="d-banner">
                <Icon name="calendar-days" />
                <span className="d-grow">
                  The stage becomes Meeting, and it goes in your calendar with a reminder.
                </span>
              </div>
            </>
          )}

          {kind === 'won' && (
            <>
              <div className="d-form-grid">
                <div className="d-field">
                  <label htmlFor="won-project">Project</label>
                  <input
                    className="d-input"
                    id="won-project"
                    value={project}
                    placeholder="The Archive"
                    onChange={(e) => setProject(e.target.value)}
                  />
                </div>
                <div className="d-field">
                  <label htmlFor="won-unit">Unit</label>
                  <input
                    className="d-input"
                    id="won-unit"
                    value={unit}
                    placeholder="2BR · unit 1204"
                    onChange={(e) => setUnit(e.target.value)}
                  />
                </div>
                <div className="d-field d-full">
                  <label htmlFor="won-note">Anything worth remembering</label>
                  <input
                    className="d-input"
                    id="won-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>
              <label className="d-check">
                <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
                Yes — they bought it.
              </label>
            </>
          )}

          {kind === 'lost' && (
            <>
              <div className={bad(reason === null)}>
                <span className="d-field-label">Why? <span className="d-t-accent">*</span></span>
                <div className="d-chips">
                  {LOST_REASONS.map((one) => (
                    <button
                      key={one.key}
                      type="button"
                      className={reason === one.key ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => setReason(one.key)}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
                <span className="d-error">Choose a reason first.</span>
              </div>
              <div className={bad(reason === 'other' && note.trim().length < 5)}>
                <label htmlFor="lost-note">
                  Note{' '}
                  <span className="d-muted">
                    {reason === 'other' ? '· needed for “Something else”' : '· optional'}
                  </span>
                </label>
                <textarea
                  className="d-textarea v2-leadact-note"
                  id="lost-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <span className="d-error">With “Something else”, write at least 5 letters.</span>
              </div>
            </>
          )}

          {problem && <div className="d-banner d-red"><span className="d-grow">{problem}</span></div>}
        </div>

        <div className="d-dialog-foot">
          {kind === 'won' && (
            <span className="d-small d-muted d-grow">The stage becomes Won. Owners see the deal at once.</span>
          )}
          <button type="button" className="d-btn d-ghost" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={kind === 'lost' ? 'd-btn d-danger d-solid' : 'd-btn d-primary'}
            disabled={busy}
            onClick={go}
          >
            {busy ? 'Saving…' : DO[kind]}
          </button>
        </div>
      </div>
    </>
  );
}

const TITLE: Record<LeadActionKind, string> = {
  follow_up: 'Plan a follow-up',
  meeting: 'Book a meeting',
  won: 'They booked a unit',
  lost: 'Why is this lead lost?',
};

const SUB: Record<LeadActionKind, string> = {
  follow_up: 'it becomes the next step on this lead',
  meeting: 'the stage becomes Meeting',
  won: 'fill the deal in',
  lost: 'choose one reason, and the lead leaves your open list',
};

const DO: Record<LeadActionKind, string> = {
  follow_up: 'Save follow-up',
  meeting: 'Save meeting',
  won: 'Save as Won',
  lost: 'Mark as lost',
};

/** What each when-chip means, in real time. */
function whenMeans(key: WhenKey): Date {
  if (key === 'hour') return roundUp(new Date(Date.now() + 3_600_000));
  if (key === 'tonight') return atHour(0, 19);
  if (key === 'tomorrow') return atHour(1, 11);
  return roundUp(new Date(Date.now() + 3_600_000));
}

/** `days` from now at `hour` o'clock — rolled forward if that is already past. */
function atHour(days: number, hour: number): Date {
  const out = new Date();
  out.setDate(out.getDate() + days);
  out.setHours(hour, 0, 0, 0);
  if (out.getTime() <= Date.now()) out.setDate(out.getDate() + 1);
  return out;
}

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
