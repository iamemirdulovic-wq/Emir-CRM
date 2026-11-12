import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote } from '../design/ui.js';

/**
 * The calendar.
 *
 * `docs/v2/pages.md` §16. Tasks and meetings in one grid, because a day with
 * a viewing at four and a call at five is one day to the person living it.
 *
 * The window sent to the server is a pair of real instants covering the whole
 * visible grid in the reader's own timezone — not two dates. A meeting at
 * 23:30 belongs to the day it is 23:30 in for whoever is looking, and only
 * the browser knows which day that is.
 */

interface Task {
  id: string;
  type: string;
  title: string;
  due_at: string;
  completed_at: string | null;
  opportunity_id: string | null;
  full_name: string | null;
}

interface Meeting {
  id: string;
  opportunityId: string | null;
  kind: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  place: string | null;
  result: string | null;
  who: string | null;
  phone: string | null;
  agent: string;
}

interface Window_ { tasks: Task[]; meetings: Meeting[] }

const RESULTS = [
  { value: 'showed', label: 'They came' },
  { value: 'booked', label: 'They booked' },
  { value: 'no_show', label: 'They did not come' },
  { value: 'rescheduled', label: 'Moved it' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function V2Calendar() {
  const { user } = useAuth();
  const [monthAt, setMonthAt] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [picked, setPicked] = useState<string | null>(() => dayKey(new Date()));

  /* The grid always shows whole weeks, so the window starts on the Monday
     before the 1st and ends on the Sunday after the last day. */
  const grid = useMemo(() => {
    const first = new Date(monthAt);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const days: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    }
    return days;
  }, [monthAt]);

  const from = grid[0] as Date;
  const to = new Date((grid[41] as Date).getTime() + 86_400_000);

  const window_ = useAsync<Window_>(
    () => api.get(`/api/v2/calendar?from=${from.toISOString()}&to=${to.toISOString()}&scope=${scope}`),
    [from.toISOString(), to.toISOString(), scope],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, { tasks: Task[]; meetings: Meeting[] }>();
    const put = (key: string) => {
      if (!map.has(key)) map.set(key, { tasks: [], meetings: [] });
      return map.get(key) as { tasks: Task[]; meetings: Meeting[] };
    };
    for (const task of window_.data?.tasks ?? []) put(dayKey(new Date(task.due_at))).tasks.push(task);
    for (const meeting of window_.data?.meetings ?? []) {
      put(dayKey(new Date(meeting.startsAt))).meetings.push(meeting);
    }
    return map;
  }, [window_.data]);

  const chosen = picked ? byDay.get(picked) : undefined;

  return (
    <div className="v2-cal">
      <header className="v2-cal-head">
        <div className="v2-cal-move">
          <button type="button" className="d-btn d-sm" aria-label="Previous month"
            onClick={() => setMonthAt(new Date(monthAt.getFullYear(), monthAt.getMonth() - 1, 1))}>
            <Icon name="chevron-left" />
          </button>
          <h1 className="v2-hi">
            {monthAt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
          </h1>
          <button type="button" className="d-btn d-sm" aria-label="Next month"
            onClick={() => setMonthAt(new Date(monthAt.getFullYear(), monthAt.getMonth() + 1, 1))}>
            <Icon name="chevron-right" />
          </button>
          <button type="button" className="d-btn d-sm" onClick={() => {
            const now = new Date();
            setMonthAt(new Date(now.getFullYear(), now.getMonth(), 1));
            setPicked(dayKey(now));
          }}>
            Today
          </button>
        </div>

        {user?.role !== 'agent' && (
          <div className="v2-tabs" role="tablist">
            <button type="button" className={scope === 'mine' ? 'v2-tab-b v2-tab-b-on' : 'v2-tab-b'}
              onClick={() => setScope('mine')}>Mine</button>
            <button type="button" className={scope === 'team' ? 'v2-tab-b v2-tab-b-on' : 'v2-tab-b'}
              onClick={() => setScope('team')}>The team</button>
          </div>
        )}
      </header>

      {window_.error && <ErrorNote>{window_.error}</ErrorNote>}
      {!window_.data && !window_.error && <Spinner />}

      <div className="v2-cal-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span className="v2-cal-dow" key={d}>{d}</span>
        ))}

        {grid.map((day) => {
          const key = dayKey(day);
          const got = byDay.get(key);
          const thisMonth = day.getMonth() === monthAt.getMonth();
          const isToday = key === dayKey(new Date());
          const late = (got?.tasks ?? []).some(
            (t) => !t.completed_at && new Date(t.due_at) < new Date(),
          );
          return (
            <button
              type="button"
              key={key}
              className={[
                'v2-cal-day',
                thisMonth ? '' : 'v2-cal-off',
                isToday ? 'v2-cal-today' : '',
                picked === key ? 'v2-cal-picked' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setPicked(key)}
            >
              <span className="v2-cal-n">{day.getDate()}</span>
              <span className="v2-cal-marks">
                {(got?.meetings ?? []).slice(0, 3).map((m) => (
                  <i key={m.id} className="v2-cal-mark v2-cal-meeting" title={m.who ?? 'Meeting'} />
                ))}
                {(got?.tasks ?? []).slice(0, 3).map((t) => (
                  <i
                    key={t.id}
                    className={`v2-cal-mark ${t.completed_at ? 'v2-cal-done' : late ? 'v2-cal-late' : 'v2-cal-task'}`}
                    title={t.title}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <section className="d-card v2-cal-day-panel">
        <div className="d-card-head">
          <h3>
            {picked
              ? new Date(`${picked}T12:00:00`).toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long',
              })
              : 'Pick a day'}
          </h3>
          <Link className="d-card-link" to="/v2/tasks">All tasks <Icon name="arrow-right" /></Link>
        </div>

        {!chosen || (chosen.meetings.length === 0 && chosen.tasks.length === 0) ? (
          <p className="v2-none">Nothing in the diary that day.</p>
        ) : (
          <ul className="v2-day-list">
            {chosen.meetings.map((m) => (
              <MeetingRow key={m.id} meeting={m} reload={window_.reload} />
            ))}
            {chosen.tasks.map((t) => (
              <li key={t.id} className="v2-day-row">
                <span className="v2-day-when">
                  {new Date(t.due_at).toLocaleTimeString('en-GB', {
                    hour: '2-digit', minute: '2-digit', hour12: false,
                  })}
                </span>
                <span className="v2-day-what">
                  <b className={t.completed_at ? 'v2-done' : undefined}>{t.title}</b>
                  <span>{t.full_name ?? 'Task'}</span>
                </span>
                {t.opportunity_id && (
                  <Link className="d-btn d-xs" to={`/v2/leads/${t.opportunity_id}`}>Open</Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MeetingRow({ meeting, reload }: { meeting: Meeting; reload: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const past = new Date(meeting.endsAt) < new Date();

  async function say(result: string) {
    setBusy(true);
    try {
      await api.patch(`/api/v2/meetings/${meeting.id}/result`, { result });
      setAsking(false);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="v2-day-row v2-day-meeting">
      <span className="v2-day-when">
        {new Date(meeting.startsAt).toLocaleTimeString('en-GB', {
          hour: '2-digit', minute: '2-digit', hour12: false,
        })}
      </span>
      <span className="v2-day-what">
        <b>{meeting.title ?? <span className="v2-day-kind">{meeting.kind.replace(/_/g, ' ')}</span>}</b>
        <span>
          {[meeting.who, meeting.place, meeting.agent].filter(Boolean).join(' · ')}
        </span>
        {asking && (
          <span className="v2-chips">
            {RESULTS.map((one) => (
              <button key={one.value} type="button" className="v2-chip-opt" disabled={busy}
                onClick={() => say(one.value)}>{one.label}</button>
            ))}
          </span>
        )}
      </span>

      {meeting.result
        ? <span className="d-chip">{RESULTS.find((r) => r.value === meeting.result)?.label ?? meeting.result}</span>
        : past && (
          <button type="button" className="d-btn d-xs d-primary" onClick={() => setAsking((was) => !was)}>
            {asking ? 'Not now' : 'How did it go?'}
          </button>
        )}

      {meeting.opportunityId && (
        <Link className="d-btn d-xs" to={`/v2/leads/${meeting.opportunityId}`}>Open</Link>
      )}
    </li>
  );
}

/** The local calendar day, as the reader's own clock sees it. */
function dayKey(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}
