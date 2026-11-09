/**
 * Who came in, over thirty days.
 *
 * Owner and admin only; the server refuses the data to anyone else.
 *
 * A grid rather than a list of events, because the question an owner actually
 * has is "who is not turning up", and that is a shape you see rather than
 * read: one row a person, one square a day, and a gap down a row answers it
 * before any number does.
 *
 * Four things a square can be, and the reason each exists:
 *   in       — tapped on the office Wi-Fi
 *   late     — tapped, but after the start plus the grace
 *   outside  — at a sales centre or a viewing, which is the job, not an absence
 *   missing  — an open working day, already past, with no tap at all
 * A closed day and a day still to come are neither, and are left blank.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Avatar, Chip, Empty, ErrorNote, Panel, Spinner, Toolbar } from '../design/ui.js';

interface Day {
  date: string;
  kind: 'office' | 'outside' | null;
  at: string | null;
  late: boolean;
  note: string | null;
}

interface Person {
  userId: string;
  name: string;
  role: string;
  photoUrl: string | null;
  days: Day[];
  inOffice: number;
  outside: number;
  late: number;
  absent: number;
}

interface Month {
  from: string;
  to: string;
  dates: Array<{ date: string; closed: boolean }>;
  people: Person[];
}

const RANGES: Array<{ label: string; days: number }> = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

function dubaiToday(): string {
  return new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
}

function back(days: number): string {
  return new Date(Date.parse(`${dubaiToday()}T00:00:00Z`) - (days - 1) * 86_400_000)
    .toISOString().slice(0, 10);
}

/**
 * "M" over "9".
 *
 * Two short lines, not one turned sideways: a rotated label is taller than the
 * row it sits in, and the scrolling box cut the top off every one of them.
 * The letter alone is ambiguous — two Tuesdays and two Saturdays share one —
 * which is what the number underneath is for.
 */
function weekdayLetter(date: string): string {
  return new Date(`${date}T00:00:00Z`)
    .toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' });
}

function dayNumber(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDate();
}

/** A line down the first of the month, so thirty or ninety days stay readable. */
function startsMonth(date: string, i: number): boolean {
  return i > 0 && date.endsWith('-01');
}

function longDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function stateOf(day: Day, closed: boolean, today: string): string {
  if (day.kind === 'outside') return 'outside';
  if (day.kind === 'office') return day.late ? 'late' : 'in';
  if (closed) return 'closed';
  if (day.date > today) return 'ahead';
  return 'missing';
}

const WORDS: Record<string, string> = {
  in: 'In the office',
  late: 'In, late',
  outside: 'Working outside',
  missing: 'Not in',
  closed: 'Office closed',
  ahead: 'Still to come',
};

interface Picked {
  who: string;
  day: Day;
  state: string;
}

export function Attendance() {
  const [days, setDays] = useState(30);
  /* A phone has no hover, so the time and the place need somewhere to land. */
  const [picked, setPicked] = useState<Picked | null>(null);
  const from = back(days);
  const to = dubaiToday();

  const month = useAsync<Month>(
    () => api.get(`/api/attendance/month${qs({ from, to })}`),
    [from, to],
  );

  const data = month.data;
  const today = dubaiToday();

  /* One summary line for the whole team, so the headline is not buried in
     the grid. */
  const totals = useMemo(() => {
    const people = data?.people ?? [];
    return {
      people: people.length,
      absent: people.reduce((sum, p) => sum + p.absent, 0),
      late: people.reduce((sum, p) => sum + p.late, 0),
      outside: people.reduce((sum, p) => sum + p.outside, 0),
    };
  }, [data]);

  return (
    <>
      <Toolbar>
        {RANGES.map((range) => (
          <Chip key={range.days} on={days === range.days} onClick={() => setDays(range.days)}>
            {range.label}
          </Chip>
        ))}
      </Toolbar>

      {month.error && <ErrorNote>{month.error}</ErrorNote>}
      {!data && !month.error && <Spinner />}

      {data && data.people.length === 0 && (
        <Empty
          icon="users-round"
          title="Nobody to show"
          hint="Attendance covers everyone except you. Accounts added in Settings appear here."
        />
      )}

      {data && data.people.length > 0 && (
        <>
          <Panel index={0} icon="calendar-check" title={`${from} to ${to}`}>
            <div className="att-totals">
              <span><b>{totals.people}</b> people</span>
              <span className="att-t-missing"><b>{totals.absent}</b> days not in</span>
              <span className="att-t-late"><b>{totals.late}</b> late</span>
              <span className="att-t-outside"><b>{totals.outside}</b> working outside</span>
            </div>
            <div className="att-key">
              {(['in', 'late', 'outside', 'missing'] as const).map((kind) => (
                <span key={kind}><i className={`att-dot ${kind}`} />{WORDS[kind]}</span>
              ))}
            </div>
          </Panel>

          <Panel index={1} className="att-panel">
            <div className="att-scroll">
              <table className="att-grid">
                <thead>
                  <tr>
                    <th className="att-who">Who</th>
                    {data.dates.map((d, i) => (
                      <th
                        key={d.date}
                        className={[
                          d.closed ? 'att-closed-head' : '',
                          startsMonth(d.date, i) ? 'att-m1' : '',
                        ].filter(Boolean).join(' ') || undefined}
                      >
                        <span className="att-dw">{weekdayLetter(d.date)}</span>
                        <span className="att-dn">{dayNumber(d.date)}</span>
                      </th>
                    ))}
                    <th className="att-sum">In</th>
                    <th className="att-sum">Out</th>
                    <th className="att-sum">Late</th>
                    <th className="att-sum">Missed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.people.map((person) => (
                    <tr key={person.userId}>
                      <td className="att-who">
                        <Link to={`/profile/${person.userId}`}>
                          <Avatar name={person.name} src={person.photoUrl ?? undefined} size={26} />
                          <span>{person.name}</span>
                        </Link>
                      </td>
                      {person.days.map((day, i) => {
                        const closed = data.dates[i]?.closed ?? false;
                        const state = stateOf(day, closed, today);
                        const said = `${person.name} · ${longDate(day.date)} · ${WORDS[state]}`;
                        return (
                          <td
                            key={day.date}
                            className={startsMonth(day.date, i) ? 'att-m1' : undefined}
                          >
                            <button
                              type="button"
                              className="att-cell"
                              title={said}
                              aria-label={said}
                              onClick={() => setPicked({ who: person.name, day, state })}
                            >
                              <i className={`att-dot ${state}`} />
                            </button>
                          </td>
                        );
                      })}
                      <td className="att-sum"><b>{person.inOffice}</b></td>
                      <td className="att-sum">{person.outside}</td>
                      <td className="att-sum att-t-late">{person.late || ''}</td>
                      <td className="att-sum att-t-missing">{person.absent || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="att-foot" aria-live="polite">
              <Icon name={picked ? 'calendar-check' : 'info'} size={14} />
              {picked ? (
                <span>
                  <b>{picked.who}</b> · {longDate(picked.day.date)} · {WORDS[picked.state]}
                  {picked.day.at && ` at ${new Date(picked.day.at).toLocaleTimeString('en-GB', {
                    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai',
                  })}`}
                  {picked.day.note && ` · ${picked.day.note}`}
                </span>
              ) : (
                <span>
                  Tap a square for the time and the place. Blank squares are closed days
                  and days still to come.
                </span>
              )}
            </p>
          </Panel>
        </>
      )}
    </>
  );
}
