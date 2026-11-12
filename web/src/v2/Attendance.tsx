import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';

/**
 * Attendance and leave.
 *
 * `docs/v2/pages.md` §25 and §26. An agent sees their own record and asks for
 * days off; an owner sees who is in and answers.
 *
 * What is deliberately not on this screen: "14 days left". There is no
 * allowance anywhere in this database, and a number nobody set is a number
 * somebody plans a holiday around. It shows days taken, which is true, and
 * the allowance can join it the day it exists.
 */

interface DayState {
  closed: boolean;
  marked: 'office' | 'outside' | null;
  markedAt: string | null;
  wasLate: boolean;
  note: string | null;
  onOfficeNetwork: boolean;
  enabled: boolean;
  startsAt: string | null;
}

interface Leave {
  id: string;
  userId: string;
  userName?: string;
  kind: string;
  fromDate: string;
  toDate: string;
  workingDays: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'refused' | 'cancelled';
  decisionNote: string | null;
}

interface Mine {
  today: DayState;
  from: string;
  to: string;
  days: Array<{ on_date: string; kind: string; was_late: number; note: string | null }>;
  leave: Leave[];
  taken: Record<string, number>;
}

/** Exactly what `attendanceMonth` returns, plus the leave to answer. */
interface Team {
  from: string;
  to: string;
  dates: Array<{ date: string; closed: boolean }>;
  people: Array<{
    userId: string;
    name: string;
    photoUrl: string | null;
    days: Array<{ date: string; kind: string | null; late: boolean; note: string | null }>;
    inOffice: number;
    outside: number;
    late: number;
    absent: number;
  }>;
  leave: Leave[];
}

const KINDS = [
  { value: 'annual', label: 'Annual' },
  { value: 'sick', label: 'Sick' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'other', label: 'Something else' },
];

export function V2Attendance() {
  const { user } = useAuth();
  const isOwner = user?.role !== 'agent';
  const mine = useAsync<Mine>(() => api.get('/api/v2/attendance/me'), []);
  const team = useAsync<Team>(
    () => (isOwner ? api.get('/api/v2/attendance/team') : Promise.resolve(null as never)),
    [isOwner],
  );

  if (mine.error) return <ErrorNote>{mine.error}</ErrorNote>;
  if (!mine.data) return <Spinner />;

  return (
    <div className="v2-att">
      <header className="v2-inc-head">
        <h1 className="v2-hi">Attendance</h1>
        <p className="d-muted">
          {mine.data.today.closed
            ? 'The office is closed today.'
            : mine.data.today.startsAt
              ? `The office opens at ${mine.data.today.startsAt}.`
              : 'Check in when you get in.'}
        </p>
      </header>

      <Today day={mine.data.today} reload={mine.reload} />

      <MyMonth mine={mine.data} />

      <MyLeave mine={mine.data} reload={mine.reload} />

      {isOwner && team.data && <TeamGrid team={team.data} reload={team.reload} />}
    </div>
  );
}

function Today({ day, reload }: { day: DayState; reload: () => void }) {
  const [where, setWhere] = useState<string | null>(null);
  const [saying, setSaying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function mark(what: 'check-in' | 'outside') {
    setBusy(true);
    setSaying(null);
    try {
      await api.post(`/api/attendance/${what}`,
        what === 'outside' ? { note: (where ?? '').trim() } : {});
      setWhere(null);
      reload();
    } catch (err) {
      setSaying(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (day.closed) {
    return (
      <section className="d-card v2-att-today">
        <h2 className="d-card-t">The office is closed today</h2>
        <p className="d-muted">Nothing to mark. Enjoy it.</p>
      </section>
    );
  }

  if (day.marked) {
    return (
      <section className="d-card v2-att-today">
        <span className={day.marked === 'office' ? 'd-chip d-green' : 'd-chip d-blue'}>
          {day.marked === 'office' ? 'In office' : 'Working outside'}
          {day.wasLate && ' · late'}
        </span>
        <h2 className="d-card-t">
          Marked at {day.markedAt
            ? new Date(day.markedAt).toLocaleTimeString('en-GB', {
              hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai',
            })
            : '—'}
        </h2>
        {day.note && <p className="d-muted">{day.note}</p>}
        <p className="d-small d-muted">
          First tap of the day counts. Nothing you press now will change it.
        </p>
      </section>
    );
  }

  return (
    <section className="d-card v2-att-today">
      <span className={day.onOfficeNetwork ? 'd-chip d-green' : 'd-chip'}>
        {day.onOfficeNetwork ? 'Office Wi-Fi found' : 'Not on the office network'}
      </span>
      <h2 className="d-card-t">Ready to start your day?</h2>
      {where === null ? (
        <div className="v2-att-acts">
          <button
            type="button"
            className="d-btn d-primary"
            disabled={!day.onOfficeNetwork || busy}
            onClick={() => mark('check-in')}
          >
            <Icon name="check" />Check in
          </button>
          <button type="button" className="d-btn" onClick={() => setWhere('')}>
            <Icon name="pin" />I&apos;m working outside today
          </button>
        </div>
      ) : (
        <form
          className="v2-att-acts"
          onSubmit={(e) => { e.preventDefault(); if (where.trim()) void mark('outside'); }}
        >
          <label className="v2-field v2-field-wide">
            <span>Where are you, and with whom?</span>
            <input
              className="d-input"
              value={where}
              autoFocus
              placeholder="Emaar sales centre, with Lucas"
              onChange={(e) => setWhere(e.target.value)}
            />
          </label>
          <button type="submit" className="d-btn d-primary" disabled={!where.trim() || busy}>
            Save
          </button>
          <button type="button" className="d-btn d-ghost" onClick={() => setWhere(null)}>
            Back
          </button>
        </form>
      )}
      {!day.onOfficeNetwork && (
        <p className="d-small d-muted">
          Check-in only works on the office Wi-Fi. If you are out, say where instead.
        </p>
      )}
      {saying && <p className="v2-problem">{saying}</p>}
    </section>
  );
}

function MyMonth({ mine }: { mine: Mine }) {
  const byDate = new Map(mine.days.map((d) => [d.on_date, d]));
  const days: string[] = [];
  for (let at = Date.parse(`${mine.from}T00:00:00Z`);
    at <= Date.parse(`${mine.to}T00:00:00Z`); at += 86_400_000) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }

  const office = mine.days.filter((d) => d.kind === 'office').length;
  const outside = mine.days.filter((d) => d.kind === 'outside').length;
  const late = mine.days.filter((d) => Number(d.was_late) === 1).length;

  return (
    <section className="d-card">
      <div className="d-card-head">
        <h3>The last sixty days</h3>
        <span className="d-small d-muted">{office} in office · {outside} outside · {late} late</span>
      </div>
      <div className="v2-att-grid">
        {days.map((date) => {
          const got = byDate.get(date);
          const mark = !got ? 'none'
            : got.kind === 'outside' ? 'outside'
              : Number(got.was_late) === 1 ? 'late' : 'office';
          return (
            <span
              key={date}
              className={`v2-att-day v2-att-${mark}`}
              title={`${date}${got ? ` · ${got.kind}${Number(got.was_late) === 1 ? ' · late' : ''}` : ' · not marked'}`}
            />
          );
        })}
      </div>
      <div className="v2-att-key">
        <span><i className="v2-att-day v2-att-office" />In office</span>
        <span><i className="v2-att-day v2-att-late" />Late</span>
        <span><i className="v2-att-day v2-att-outside" />Outside</span>
        <span><i className="v2-att-day v2-att-none" />Not marked</span>
      </div>
    </section>
  );
}

function MyLeave({ mine, reload }: { mine: Mine; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('annual');
  const [from, setFrom] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  async function ask() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/v2/leave', {
        kind, fromDate: from, toDate: to, reason: reason.trim() || null,
      });
      setOpen(false);
      setReason('');
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    try {
      await api.post(`/api/v2/leave/${id}/cancel`, {});
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    }
  }

  const taken = Object.entries(mine.taken);

  return (
    <section className="d-card">
      <div className="d-card-head">
        <h3>Days off</h3>
        <button type="button" className="d-btn d-sm" onClick={() => setOpen((was) => !was)}>
          {open ? 'Not now' : 'Ask for days off'}
        </button>
      </div>

      <p className="d-small d-muted">
        {taken.length === 0
          ? 'Nothing taken this year.'
          : `Taken this year: ${taken.map(([k, n]) => `${n} ${k}`).join(' · ')}.`}
      </p>

      {open && (
        <div className="v2-leave-form">
          <div className="v2-chips">
            {KINDS.map((one) => (
              <button key={one.value} type="button"
                className={kind === one.value ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
                onClick={() => setKind(one.value)}>{one.label}</button>
            ))}
          </div>
          <div className="v2-two">
            <label className="v2-field v2-field-wide">
              <span>From</span>
              <input className="d-input" type="date" value={from} min={today}
                onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} />
            </label>
            <label className="v2-field v2-field-wide">
              <span>To</span>
              <input className="d-input" type="date" value={to} min={from}
                onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <label className="v2-field v2-field-wide">
            <span>Why</span>
            <input className="d-input" value={reason} placeholder="Family wedding"
              onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" className="d-btn d-primary" disabled={busy} onClick={ask}>
            {busy ? 'Asking…' : 'Send the request'}
          </button>
        </div>
      )}

      {problem && <p className="v2-problem">{problem}</p>}

      {mine.leave.length === 0
        ? <p className="v2-none">You have not asked for any days off.</p>
        : (
          <ul className="v2-leave-list">
            {mine.leave.map((one) => (
              <li key={one.id} className="v2-leave-row">
                <span className={`d-chip ${statusChip(one.status)}`}>{one.status}</span>
                <span className="v2-leave-what">
                  <b>
                    <span className="v2-leave-kind">{one.kind}</span>
                    {' · '}{one.workingDays} {one.workingDays === 1 ? 'day' : 'days'}
                  </b>
                  <span>{one.fromDate} → {one.toDate}{one.reason ? ` · ${one.reason}` : ''}</span>
                  {one.decisionNote && <span className="v2-leave-why">“{one.decisionNote}”</span>}
                </span>
                {one.status === 'pending' && (
                  <button type="button" className="d-btn d-xs" onClick={() => cancel(one.id)}>
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function TeamGrid({ team, reload }: { team: Team; reload: () => void }) {
  const [note, setNote] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);

  async function answer(id: string, status: 'approved' | 'refused') {
    setProblem(null);
    try {
      await api.patch(`/api/v2/leave/${id}`, { status, note: note[id]?.trim() || null });
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    }
  }

  const waiting = team.leave.filter((one) => one.status === 'pending');

  return (
    <>
      <section className="d-card">
        <div className="d-card-head">
          <h3>Leave to answer</h3>
          {waiting.length > 0 && <span className="d-badge d-accent">{waiting.length}</span>}
        </div>
        {waiting.length === 0
          ? <p className="v2-none">Nothing waiting on you.</p>
          : (
            <ul className="v2-leave-list">
              {waiting.map((one) => (
                <li key={one.id} className="v2-leave-row v2-leave-answer">
                  <span className="v2-leave-what">
                    <b>
                      {one.userName}{' · '}
                      <span className="v2-leave-kind">{one.kind}</span>
                      {' · '}{one.workingDays} {one.workingDays === 1 ? 'day' : 'days'}
                    </b>
                    <span>{one.fromDate} → {one.toDate}{one.reason ? ` · ${one.reason}` : ''}</span>
                  </span>
                  <input
                    className="d-input v2-leave-note"
                    placeholder="A reason, if you are saying no"
                    value={note[one.id] ?? ''}
                    onChange={(e) => setNote((was) => ({ ...was, [one.id]: e.target.value }))}
                  />
                  <button type="button" className="d-btn d-xs d-primary" onClick={() => answer(one.id, 'approved')}>
                    Approve
                  </button>
                  <button type="button" className="d-btn d-xs d-danger" onClick={() => answer(one.id, 'refused')}>
                    Refuse
                  </button>
                </li>
              ))}
            </ul>
          )}
        {problem && <p className="v2-problem">{problem}</p>}
      </section>

      <section className="d-card">
        <div className="d-card-head">
          <h3>The team, last two weeks</h3>
          <span className="d-small d-muted">{team.from} → {team.to}</span>
        </div>
        <div className="v2-att-team">
          <table className="v2-table">
            <thead>
              <tr>
                <th>Who</th>
                {team.dates.map((d) => (
                  <th key={d.date} className={d.closed ? 'v2-att-closed' : undefined}>
                    {d.date.slice(8)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {team.people.map((person) => (
                <tr key={person.userId}>
                  <td>
                    <span className="person">
                      <Avatar name={person.name} src={person.photoUrl ?? undefined} />
                      <span className="who">
                        <b>{person.name}</b>
                        <span className="d-small d-muted">
                          {person.inOffice} in · {person.outside} out · {person.late} late
                        </span>
                      </span>
                    </span>
                  </td>
                  {team.dates.map((d) => {
                    const got = dayOf(person, d.date);
                    const mark = d.closed ? 'closed'
                      : !got ? 'none'
                        : got.kind === 'outside' ? 'outside'
                          : got.late ? 'late' : 'office';
                    return (
                      <td key={d.date}>
                        <span className={`v2-att-day v2-att-${mark}`} title={`${d.date} · ${mark}`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/** One person's mark on one day, or nothing if they did not mark it. */
function dayOf(
  person: Team['people'][number],
  date: string,
): { kind: string; late: boolean } | null {
  const got = person.days.find((d) => d.date === date);
  if (!got?.kind) return null;
  return { kind: got.kind, late: got.late };
}

function statusChip(status: Leave['status']): string {
  if (status === 'approved') return 'd-green';
  if (status === 'refused') return 'd-red';
  if (status === 'cancelled') return '';
  return 'd-amber';
}
