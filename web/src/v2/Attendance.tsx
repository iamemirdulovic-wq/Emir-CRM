import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../design/ui.js';

/**
 * Attendance and leave.
 *
 * Two designs behind one address, as the design package has them. An agent
 * gets `design/web/attendance.html` — Today, Month, Leave. An owner (and a
 * manager, who may look but not answer) gets `design/web/team-attendance.html`
 * — Team today, Leave requests, My attendance. Each role carries that page's
 * own class so the two sets of ported rules never meet.
 *
 * What is deliberately not on this screen:
 *
 *   - "14 days left". There is no allowance anywhere in this database, and a
 *     number nobody set is a number somebody plans a holiday around. It shows
 *     days taken, which is true, and the allowance can join it the day it
 *     exists.
 *   - Checking out. There is one tap a day and the first one wins; the hero
 *     says so rather than offering a button that does nothing.
 *   - Absences on an agent's own month. `/attendance/me` does not say which
 *     days the office was shut, so an unmarked Friday cannot be told apart
 *     from a public holiday. The team grid does know, and marks them.
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
  createdAt?: string;
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
    days: Array<{ date: string; kind: string | null; at?: string | null; late: boolean; note: string | null }>;
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

/** A refusal must carry a reason, so the owner picks one of these. */
const REFUSALS = ['Too many people away', 'Busy week', 'Talk to me first'];

/** The five states a day can be in, and how each is drawn. */
type Mark = 'ok' | 'late' | 'out' | 'leave' | 'asked' | 'abs' | 'future' | 'none';

const WORD: Record<Mark, string> = {
  ok: 'In office', late: 'Late', out: 'Working outside', leave: 'On leave',
  asked: 'Leave asked', abs: 'Absent', future: '', none: 'Not marked',
};

const CHIP: Record<Mark, string> = {
  ok: 'd-chip d-att-office', late: 'd-chip d-att-late', out: 'd-chip d-att-outside',
  leave: 'd-chip d-att-leave', asked: 'd-chip d-att-leave', abs: 'd-chip d-att-absent',
  future: 'd-chip', none: 'd-chip',
};

export function V2Attendance() {
  const { user } = useAuth();
  const seesTeam = user?.role !== 'agent';
  const mine = useAsync<Mine>(() => api.get('/api/v2/attendance/me'), []);
  const team = useAsync<Team>(
    () => (seesTeam ? api.get('/api/v2/attendance/team') : Promise.resolve(null as never)),
    [seesTeam],
  );
  const [tab, setTab] = useState(seesTeam ? 'team' : 'today');
  const [asking, setAsking] = useState(false);

  if (mine.error) return <ErrorNote>{mine.error}</ErrorNote>;
  if (!mine.data) return <Spinner />;

  const waiting = (seesTeam ? team.data?.leave ?? [] : mine.data.leave)
    .filter((one) => one.status === 'pending');
  const myWaiting = mine.data.leave.filter((one) => one.status === 'pending');

  const tabs = seesTeam
    ? [
      /* Red, because somebody is waiting on this person for an answer. The
         agent's own pending request is not urgent, so theirs stays grey. */
      { key: 'team', label: 'Team today', count: 0, urgent: true },
      { key: 'leave', label: 'Leave requests', count: waiting.length, urgent: true },
      { key: 'mine', label: 'My attendance', count: 0, urgent: true },
    ]
    : [
      { key: 'today', label: 'Today', count: 0, urgent: false },
      { key: 'month', label: 'Month', count: 0, urgent: false },
      { key: 'leave', label: 'Leave', count: myWaiting.length, urgent: false },
    ];

  return (
    <div className={seesTeam ? 'v2-att p-team-attendance' : 'v2-att p-attendance'}>
      <div className="d-tabs d-top-tabs" role="tablist">
        {tabs.map((one) => (
          <button
            key={one.key}
            type="button"
            role="tab"
            aria-selected={tab === one.key}
            className={tab === one.key ? 'd-tab d-on' : 'd-tab'}
            onClick={() => setTab(one.key)}
          >
            {one.label}
            {one.count > 0 && (
              <span className={one.urgent ? 'd-count d-red' : 'd-count'}>{one.count}</span>
            )}
          </button>
        ))}
        {seesTeam && (
          <>
            <span className="d-grow" />
            <Link className="d-tab" to="/v2/settings/attendance">
              <Icon name="settings" size={14} />Rules
            </Link>
          </>
        )}
      </div>

      {!seesTeam && tab === 'today' && <AgentToday mine={mine.data} reload={mine.reload} />}
      {!seesTeam && tab === 'month' && <AgentMonth mine={mine.data} />}
      {!seesTeam && tab === 'leave' && (
        <AgentLeave mine={mine.data} reload={mine.reload} onAsk={() => setAsking(true)} />
      )}

      {seesTeam && tab === 'team' && (
        team.error ? <ErrorNote>{team.error}</ErrorNote>
          : !team.data ? <Spinner />
            : <TeamToday team={team.data} />
      )}
      {seesTeam && tab === 'leave' && (
        team.error ? <ErrorNote>{team.error}</ErrorNote>
          : !team.data ? <Spinner />
            : <TeamLeave team={team.data} reload={team.reload} />
      )}
      {seesTeam && tab === 'mine' && (
        <OwnerMine mine={mine.data} reload={mine.reload} onAsk={() => setAsking(true)} />
      )}

      {asking && (
        <AskPanel onClose={() => setAsking(false)} onAsked={() => { setAsking(false); mine.reload(); }} />
      )}
    </div>
  );
}

/* ── the agent's day ───────────────────────────────────────────────────── */

function AgentToday({ mine, reload }: { mine: Mine; reload: () => void }) {
  const [outside, setOutside] = useState(false);
  const marks = useMarks(mine);
  const week = weekOf(dubaiToday());
  const [picked, setPicked] = useState(dubaiToday());

  const office = mine.days.filter((d) => d.kind === 'office').length;
  const away = mine.days.filter((d) => d.kind === 'outside').length;
  const late = mine.days.filter((d) => Number(d.was_late) === 1).length;
  const taken = Object.values(mine.taken).reduce((sum, n) => sum + n, 0);
  const asked = mine.leave.filter((one) => one.status === 'pending').length;

  const detail = markOn(marks, picked);

  return (
    <>
      <div className="d-bento">
        <Hero day={mine.today} onOutside={() => setOutside(true)} />

        <section className="d-card d-c-5">
          <div className="d-card-head">
            <h3>This week</h3>
            <span className="d-small d-muted">{nice(week[0]!)} – {nice(week[6]!)}</span>
          </div>
          <div className="d-wk7">
            {week.map((date, i) => {
              const mark = markOn(marks, date);
              return (
                <button
                  key={date}
                  type="button"
                  className={[
                    date === dubaiToday() ? 'd-today' : '',
                    date === picked ? 'd-on' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setPicked(date)}
                >
                  <span className="d-dn">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}</span>
                  <span className="d-dd">{Number(date.slice(8))}</span>
                  <span className={`d-st ${BAR[mark]}`} />
                  <span className="d-tt">{SHORT[mark]}</span>
                </button>
              );
            })}
          </div>
          <div className="d-card d-flat v2-wk-detail">
            <div className="d-row">
              <b className="d-bold d-grow">
                {nice(picked)}{picked === dubaiToday() ? ' · today' : ''}
              </b>
              <span className={CHIP[detail]}>{WORD[detail] || 'Not yet'}</span>
            </div>
            <div className="d-small d-muted d-mt-4">{lineFor(picked, detail, mine)}</div>
          </div>
          <div className="d-guide d-mt-auto v2-guide">
            <span><span className="d-dot d-green" />In office, on time</span>
            <span><span className="d-dot d-amber" />Late</span>
            <span><span className="d-dot d-blue" />Working outside</span>
            <span><span className="d-dot d-violet" />Leave</span>
            <span><span className="d-dot" />Not marked, or still to come</span>
          </div>
        </section>
      </div>

      <div className="d-bento">
        <Tile label="In the office" value={office} note={`of ${mine.days.length} days marked`} />
        <Tile label="Late" value={late} note={late === 0 ? 'none in sixty days' : 'in sixty days'} />
        <Tile label="Working outside" value={away} note="in sixty days" />
        <Tile
          label="Days off taken"
          value={taken}
          note={asked > 0 ? `${asked} waiting for an answer` : 'this year'}
        />
      </div>

      <div className="d-bento">
        <section className="d-card d-c-7">
          <div className="d-card-head">
            <h3>Today, step by step</h3>
            <span className="d-small d-muted">{nice(dubaiToday())}</span>
          </div>
          <div className="d-timeline">
            {stepsFor(mine.today).map((step) => (
              <div className="d-tl-item" key={step.title}>
                <span className={`d-tl-dot ${step.tone}`}><Icon name={step.icon} /></span>
                <div className="d-tl-body">
                  <b>{step.title}</b>
                  <p>{step.body}</p>
                  {step.at && <span className="d-tl-time">{step.at}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="d-card d-c-5">
          <div className="d-card-head"><h3>How check-in works</h3></div>
          <dl className="d-kv">
            <div className="d-kv-row">
              <dt>Shift</dt>
              <dd>{mine.today.closed ? 'The office is closed today' : `Starts at ${mine.today.startsAt ?? '—'}`}</dd>
            </div>
            <div className="d-kv-row"><dt>Where</dt><dd>Only on the office Wi-Fi</dd></div>
            <div className="d-kv-row"><dt>Not in office</dt><dd>Use “I&apos;m working outside”</dd></div>
            <div className="d-kv-row"><dt>One tap</dt><dd>The first tap of the day counts. A second one changes nothing.</dd></div>
            <div className="d-kv-row"><dt>Time</dt><dd>The real time is saved. Nobody can change it.</dd></div>
          </dl>
        </section>
      </div>

      {outside && (
        <OutsidePanel onClose={() => setOutside(false)} onSaved={() => { setOutside(false); reload(); }} />
      )}
    </>
  );
}

function Tile({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="d-card d-c-3 d-tile">
      <span className="d-label">{label}</span>
      <div className="d-stat-row d-mt-4">
        <b className="d-num">{value}</b>
        <span className="d-delta">{note}</span>
      </div>
    </div>
  );
}

/**
 * The hero, in the three states this CRM has.
 *
 * The design draws a fourth — "Day finished" after checking out — which is
 * not built: there is one tap a day and the first one wins.
 */
function Hero({ day, onOutside }: { day: DayState; onOutside: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  async function checkIn() {
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/attendance/check-in', {});
      toast('Checked in. Have a good day.');
      window.location.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (day.closed) {
    return (
      <section className="d-card d-hero d-c-7 v2-att-hero">
        <div>
          <span className="d-h-eyebrow"><span className="d-dot" />Office closed</span>
          <div className="d-h-big">Nothing to mark today</div>
          <p className="d-h-sub">The office is shut. Enjoy it.</p>
        </div>
      </section>
    );
  }

  if (day.marked) {
    const out = day.marked === 'outside';
    return (
      <section className="d-card d-hero d-c-7 v2-att-hero">
        <div>
          <span className="d-h-eyebrow">
            <span className={`d-dot ${out ? 'd-blue' : day.wasLate ? 'd-amber' : 'd-green'}`} />
            {out ? 'Working outside' : `Checked in · ${day.wasLate ? 'late' : 'on time'}`}
          </span>
          <div className="d-h-big">
            {out ? 'Outside today' : `In office since ${clock(day.markedAt)}`}
          </div>
          {out && day.note && <p className="d-h-sub">{day.note}</p>}
          <div className="d-h-facts">
            <div><b>{clock(day.markedAt)}</b><span>marked at</span></div>
            <div><b>{day.startsAt ?? '—'}</b><span>shift starts</span></div>
            <div><b>{out ? 'Outside' : 'Office Wi-Fi'}</b><span>where</span></div>
          </div>
        </div>
        <p className="d-small v2-hero-note">
          The first tap of the day counts. Nothing you press now will change it.
        </p>
      </section>
    );
  }

  return (
    <section className="d-card d-hero d-c-7 v2-att-hero">
      <div>
        <span className="d-h-eyebrow">
          <span className={`d-dot ${day.onOfficeNetwork ? 'd-green' : 'd-red'}`} />
          {day.onOfficeNetwork ? 'Office Wi-Fi found' : 'Not on the office network'}
        </span>
        <div className="d-h-big">Ready to start your day?</div>
        <p className="d-h-sub">
          {day.startsAt
            ? `The shift starts at ${day.startsAt}. The real time is saved.`
            : 'Check in when you get in. The real time is saved.'}
        </p>
      </div>
      <div className="d-btn-row">
        <button
          type="button"
          className="d-btn d-lg d-on-dark d-primary"
          disabled={!day.onOfficeNetwork || busy}
          onClick={checkIn}
        >
          <Icon name="check" />Check in
        </button>
        <button type="button" className="d-btn d-lg d-on-dark" onClick={onOutside}>
          <Icon name="pin" />I&apos;m working outside today
        </button>
      </div>
      {!day.onOfficeNetwork && (
        <p className="d-small v2-hero-note">
          Check-in only works on the office Wi-Fi. If you are out, say where instead.
        </p>
      )}
      {problem && <p className="d-small v2-hero-note">{problem}</p>}
    </section>
  );
}

interface Step { tone: string; icon: IconName; title: string; body: string; at: string }

function stepsFor(day: DayState): Step[] {
  const steps: Step[] = [];
  if (day.closed) {
    return [{
      tone: '', icon: 'clock', title: 'The office is closed',
      body: 'Nothing is expected of anybody today.', at: '',
    }];
  }
  if (day.marked === 'office') {
    steps.push({
      tone: day.wasLate ? 'd-amber' : 'd-green',
      icon: 'check',
      title: `Checked in · ${day.wasLate ? 'late' : 'on time'}`,
      body: day.note ?? 'On the office Wi-Fi.',
      at: clock(day.markedAt),
    });
  } else if (day.marked === 'outside') {
    steps.push({
      tone: 'd-blue', icon: 'pin', title: 'Working outside',
      body: day.note ?? 'Away from the office today.',
      at: clock(day.markedAt),
    });
  } else {
    steps.push({
      tone: 'd-red', icon: 'alert-triangle', title: 'Not checked in yet',
      body: day.startsAt ? `The shift started at ${day.startsAt}.` : 'Check in when you get in.',
      at: nowClock(),
    });
  }
  steps.push({
    tone: '', icon: 'clock', title: 'One tap a day',
    body: 'The first tap is the one that is saved. A second one changes nothing.',
    at: '',
  });
  return steps;
}

/* ── the agent's month ─────────────────────────────────────────────────── */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function AgentMonth({ mine }: { mine: Mine }) {
  const marks = useMarks(mine);

  /* Only the months the sixty-day window actually reaches. Offering January
     when nothing is loaded for it would draw an empty month that reads as a
     month nobody turned up. */
  const months = useMemo(() => {
    const seen = new Set<string>([dubaiToday().slice(0, 7)]);
    for (const row of mine.days) seen.add(row.on_date.slice(0, 7));
    return [...seen].sort().slice(-3);
  }, [mine.days]);

  const [month, setMonth] = useState(dubaiToday().slice(0, 7));
  const [picked, setPicked] = useState(dubaiToday());

  const cells = useMemo(() => monthGrid(month), [month]);
  const totals = useMemo(() => {
    const count: Record<string, number> = { ok: 0, late: 0, out: 0, leave: 0, none: 0 };
    for (const date of cells) {
      if (!date || date > dubaiToday()) continue;
      const mark = markOn(marks, date);
      if (mark === 'asked') count.leave = (count.leave ?? 0) + 1;
      else if (count[mark] !== undefined) count[mark] = (count[mark] ?? 0) + 1;
    }
    return count;
  }, [cells, marks]);

  const worked = (totals.ok ?? 0) + (totals.late ?? 0) + (totals.out ?? 0);
  const detail = markOn(marks, picked);

  return (
    <div className="d-bento">
      <section className="d-card d-c-8">
        <div className="d-card-head">
          <h3 className="v2-month-title">
            {MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}
          </h3>
          <div className="d-seg d-sm" role="group" aria-label="Month">
            {months.map((one) => (
              <button
                key={one}
                type="button"
                className={month === one ? 'd-on' : undefined}
                onClick={() => setMonth(one)}
              >
                {MONTHS[Number(one.slice(5, 7)) - 1]?.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>
        <div className="d-mcal">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name) => (
            <div className="d-mh" key={name}>{name}</div>
          ))}
          {cells.map((date, i) => {
            if (!date) return <div className="d-md d-blank" key={`blank-${i}`} />;
            const mark = markOn(marks, date);
            return (
              <button
                key={date}
                type="button"
                className={[
                  'd-md', `d-${mark}`,
                  date === dubaiToday() ? 'd-today' : '',
                  date === picked ? 'd-on' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setPicked(date)}
              >
                <b>{Number(date.slice(8))}</b>
                <span>{SHORT[mark] === '–' ? '' : SHORT[mark]}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="d-stack d-c-4">
        <section className="d-card">
          <div className="d-card-head">
            <h3>Totals · {MONTHS[Number(month.slice(5, 7)) - 1]}</h3>
          </div>
          <div className="d-tot">
            <div><b>{totals.ok ?? 0}</b><span><span className="d-dot d-green" />On time</span></div>
            <div><b>{totals.late ?? 0}</b><span><span className="d-dot d-amber" />Late</span></div>
            <div><b>{totals.out ?? 0}</b><span><span className="d-dot d-blue" />Outside</span></div>
            <div><b>{totals.leave ?? 0}</b><span><span className="d-dot d-violet" />Leave</span></div>
            <div><b>{totals.none ?? 0}</b><span><span className="d-dot" />Not marked</span></div>
            <div><b>{worked}</b><span>Days worked</span></div>
          </div>
          <div className="d-card-foot">
            A day with no mark may have been a day the office was shut.
          </div>
        </section>

        <section className="d-card">
          <div className="d-card-head d-mb-8">
            <h3>{nice(picked)}{picked === dubaiToday() ? ' · today' : ''}</h3>
            <span className={CHIP[detail]}>{WORD[detail] || 'Not yet'}</span>
          </div>
          <dl className="d-kv">
            <div className="d-kv-row">
              <dt>What</dt><dd>{WORD[detail] || 'Still to come'}</dd>
            </div>
            <div className="d-kv-row">
              <dt>Note</dt><dd>{lineFor(picked, detail, mine)}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}

/* ── the agent's leave ─────────────────────────────────────────────────── */

function AgentLeave({ mine, reload, onAsk }: { mine: Mine; reload: () => void; onAsk: () => void }) {
  const waiting = mine.leave.filter((one) => one.status === 'pending');
  const answered = mine.leave.filter((one) => one.status !== 'pending');
  const taken = Object.values(mine.taken).reduce((sum, n) => sum + n, 0);

  return (
    <>
      <div className="d-bento">
        <section className="d-card d-c-4">
          <span className="d-label">Days off taken this year</span>
          <div className="d-stat-row d-mt-4">
            <b className="d-num-hero v2-att-big">{taken}</b>
            <span className="d-delta">working days</span>
          </div>
          <div className="d-card-foot">
            {Object.entries(mine.taken).length === 0
              ? 'Nothing taken yet.'
              : Object.entries(mine.taken).map(([kind, n]) => `${n} ${kind}`).join(' · ')}
          </div>
        </section>

        <section className="d-card d-c-4">
          <span className="d-label">Sick days used</span>
          <div className="d-stat-row d-mt-4">
            <b className="d-num-hero v2-att-big">{mine.taken.sick ?? 0}</b>
            <span className="d-delta">this year</span>
          </div>
          <div className="d-card-foot">A sick note is needed from day two.</div>
        </section>

        <section className="d-card d-c-4">
          <span className="d-label">Waiting for an answer</span>
          <div className="d-stat-row d-mt-4">
            <b className="d-num-hero v2-att-big">{waiting.length}</b>
            <span className="d-delta">{waiting.length === 0 ? 'nothing open' : 'an owner answers'}</span>
          </div>
          <div className="d-card-foot">
            <button type="button" className="d-btn d-primary" onClick={onAsk}>
              <Icon name="plus" />Ask for days off
            </button>
          </div>
        </section>
      </div>

      <MyWaiting rows={waiting} reload={reload} />
      <MyHistory rows={answered} />
    </>
  );
}

function MyWaiting({ rows, reload }: { rows: Leave[]; reload: () => void }) {
  const toast = useToast();

  async function cancel(id: string) {
    try {
      await api.post(`/api/v2/leave/${id}/cancel`, {});
      toast('Request cancelled');
      reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not work.');
    }
  }

  return (
    <>
      <div className="v2-section-title"><h2>Waiting</h2></div>
      {rows.length === 0 ? (
        <div className="d-card">
          <div className="d-empty v2-empty-tight">
            <b>Nothing is waiting</b>
            <p>When you ask for days off it shows here until an owner answers.</p>
          </div>
        </div>
      ) : (
        <div className="d-col">
          {rows.map((one) => (
            <div className="v2-pend-row" key={one.id}>
              <span className="d-card-icon v2-pend-ic"><Icon name="calendar-days" /></span>
              <span className="d-grow">
                <b>{kindWord(one.kind)} · {span(one)} · {one.workingDays} working {one.workingDays === 1 ? 'day' : 'days'}</b>
                <span className="d-small">
                  {one.reason ? `“${one.reason}” · ` : ''}waiting for an owner
                </span>
              </span>
              <span className="d-chip d-violet d-pip">Waiting</span>
              <button type="button" className="d-btn d-sm" onClick={() => cancel(one.id)}>
                Cancel request
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MyHistory({ rows }: { rows: Leave[] }) {
  return (
    <>
      <div className="v2-section-title">
        <h2>History</h2>
        <span className="d-small d-muted">What has been answered</span>
      </div>
      {rows.length === 0 ? (
        <div className="d-card">
          <div className="d-empty v2-empty-tight">
            <b>Nothing yet</b>
            <p>Days off you have asked for appear here once they are answered.</p>
          </div>
        </div>
      ) : (
        <div className="d-table-wrap">
          <table className="d-table v2-leave-table">
            <thead>
              <tr><th>Type</th><th>Days</th><th>Working days</th><th>Reason</th><th>Answer</th></tr>
            </thead>
            <tbody>
              {rows.map((one) => (
                <tr key={one.id}>
                  <td><span className="d-t-main">{kindWord(one.kind)}</span></td>
                  <td className="d-t-sub">{span(one)}</td>
                  <td>{one.workingDays}</td>
                  <td className="d-t-sub">{one.reason ?? '—'}</td>
                  <td><Answer one={one} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Answer({ one }: { one: Leave }) {
  if (one.status === 'approved') return <span className="d-chip d-green">Approved</span>;
  if (one.status === 'cancelled') return <span className="d-chip">Cancelled</span>;
  return (
    <span className="d-chip d-red">
      Refused{one.decisionNote ? ` · ${one.decisionNote}` : ''}
    </span>
  );
}

/* ── the owner's team ──────────────────────────────────────────────────── */

const COUNTERS: Array<{ key: Mark; label: string; dot: string }> = [
  { key: 'ok', label: 'In office', dot: 'd-green' },
  { key: 'late', label: 'Late', dot: 'd-amber' },
  { key: 'out', label: 'Outside', dot: 'd-blue' },
  { key: 'leave', label: 'On leave', dot: 'd-violet' },
  { key: 'abs', label: 'Absent', dot: 'd-red' },
];

function TeamToday({ team }: { team: Team }) {
  const [only, setOnly] = useState<Mark | ''>('');

  const today = team.dates[team.dates.length - 1]?.date ?? dubaiToday();
  const onLeave = useMemo(() => {
    const out = new Set<string>();
    for (const one of team.leave) {
      if (one.status === 'approved' && one.fromDate <= today && one.toDate >= today) out.add(one.userId);
    }
    return out;
  }, [team.leave, today]);

  /* Problems first, as the design orders them: the absent, then the late,
     then whoever is out, then whoever is away, then everybody who is in. An
     owner opens this screen to find the person who has not turned up. */
  const ORDER: Mark[] = ['abs', 'late', 'out', 'leave', 'ok'];
  const rows = team.people.map((person) => {
    const day = person.days.find((d) => d.date === today);
    const mark: Mark = onLeave.has(person.userId) ? 'leave'
      : day?.kind === 'outside' ? 'out'
        : day?.kind === 'office' ? (day.late ? 'late' : 'ok')
          : 'abs';
    return { person, day, mark };
  }).sort((a, b) => ORDER.indexOf(a.mark) - ORDER.indexOf(b.mark)
    || a.person.name.localeCompare(b.person.name));

  const counts = Object.fromEntries(
    COUNTERS.map((one) => [one.key, rows.filter((r) => r.mark === one.key).length]),
  ) as Record<Mark, number>;
  const away = (counts.leave ?? 0) + (counts.abs ?? 0);
  const shown = only === '' ? rows : rows.filter((r) => r.mark === only);

  /* The last eight days the office was actually open — a column per closed
     day would be eight columns of nothing in a row designed for eight. */
  const open = team.dates.filter((d) => !d.closed).slice(-8);

  return (
    <>
      <div className="d-counters">
        <button
          type="button"
          className={only === '' ? 'd-cnt d-all d-on' : 'd-cnt d-all'}
          onClick={() => setOnly('')}
        >
          <b className="d-num-hero v2-cnt-big">{rows.length}</b>
          <span>
            <b className="v2-cnt-lab">agents today</b>
            <span className="d-label">{rows.length - away} working now · {away} away</span>
          </span>
        </button>
        {COUNTERS.map((one) => (
          <button
            key={one.key}
            type="button"
            className={only === one.key ? 'd-cnt d-on' : 'd-cnt'}
            onClick={() => setOnly(one.key)}
          >
            <b className={one.key === 'abs' && (counts.abs ?? 0) > 0 ? 'd-num d-t-red' : 'd-num'}>
              {counts[one.key] ?? 0}
            </b>
            <span className="d-label"><span className={`d-dot ${one.dot}`} />{one.label}</span>
          </button>
        ))}
      </div>

      <div className="d-table-wrap d-mt-16">
        <table className="d-table d-id-today">
          <thead>
            <tr><th>Agent</th><th>Status</th><th>Check-in</th><th>Place · reason</th></tr>
          </thead>
          <tbody>
            {shown.map(({ person, day, mark }) => (
              <tr key={person.userId}>
                <td>
                  <span className="d-person">
                    <Avatar name={person.name} src={person.photoUrl ?? undefined} />
                    <span className="d-who"><b>{person.name}</b></span>
                  </span>
                </td>
                <td><span className={CHIP[mark]}>{WORD[mark]}</span></td>
                <td className="d-t-mono">{day?.at ? clock(day.at) : '–'}</td>
                <td className="d-why">{placeOf(mark, day?.note ?? null)}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={4} className="d-t-sub">Nobody is in that group right now.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="d-card d-mt-16" aria-label="The last eight open days">
        <div className="d-card-head">
          <h3>The last {open.length} open days</h3>
          <div className="d-legend">
            <span><span className="d-dot d-green" />In office</span>
            <span><span className="d-dot d-amber" />Late</span>
            <span><span className="d-dot d-blue" />Outside</span>
            <span><span className="d-dot d-violet" />Leave</span>
            <span><span className="d-dot d-red" />Absent</span>
          </div>
        </div>
        <div className="d-grid8">
          <span />
          {open.map((d) => (
            <span className={d.date === today ? 'd-hd d-today' : 'd-hd'} key={d.date}>
              {d.date === today ? 'Today' : nice(d.date).replace(/ \w{3}$/, '')}
            </span>
          ))}
          <span />
          {team.people.map((person) => {
            const cells = open.map((d) => {
              const got = person.days.find((x) => x.date === d.date);
              const leave = team.leave.some((l) => l.status === 'approved'
                && l.userId === person.userId && l.fromDate <= d.date && l.toDate >= d.date);
              const mark: Mark = leave ? 'leave'
                : got?.kind === 'outside' ? 'out'
                  : got?.kind === 'office' ? (got.late ? 'late' : 'ok') : 'abs';
              return { date: d.date, mark };
            });
            const late = cells.filter((c) => c.mark === 'late').length;
            const abs = cells.filter((c) => c.mark === 'abs').length;
            const lv = cells.filter((c) => c.mark === 'leave').length;
            const sum = [late && `${late} late`, abs && `${abs} absent`, lv && `${lv} leave`]
              .filter(Boolean).join(' · ') || 'All on time';
            return (
              <Row8 key={person.userId} person={person} cells={cells} sum={sum} bad={abs > 0 || late > 1} />
            );
          })}
        </div>
      </section>
    </>
  );
}

const CELL: Record<string, { cls: string; letter: string }> = {
  ok: { cls: '', letter: '✓' },
  late: { cls: 'd-late', letter: 'L' },
  out: { cls: 'd-out', letter: 'O' },
  leave: { cls: 'd-leave', letter: 'V' },
  abs: { cls: 'd-abs', letter: 'A' },
};

function Row8({ person, cells, sum, bad }: {
  person: Team['people'][number];
  cells: Array<{ date: string; mark: Mark }>;
  sum: string;
  bad: boolean;
}) {
  return (
    <>
      <span className="d-person">
        <Avatar name={person.name} src={person.photoUrl ?? undefined} size={26} />
        <b className="d-truncate">{person.name}</b>
      </span>
      {cells.map((cell) => {
        const look = CELL[cell.mark] ?? CELL.ok!;
        return (
          <span
            className={`d-cell ${look.cls}`}
            key={cell.date}
            title={`${person.name} · ${nice(cell.date)} · ${WORD[cell.mark]}`}
          >
            {look.letter}
          </span>
        );
      })}
      <span className={bad ? 'd-sum d-t-red' : 'd-sum'}>{sum}</span>
    </>
  );
}

/* ── the owner's leave requests ────────────────────────────────────────── */

function TeamLeave({ team, reload }: { team: Team; reload: () => void }) {
  const { user } = useAuth();
  const canAnswer = user?.role === 'owner' || user?.role === 'admin';
  const [refusing, setRefusing] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  const waiting = team.leave.filter((one) => one.status === 'pending');
  const answered = team.leave.filter((one) => one.status === 'approved' || one.status === 'refused');

  async function answer(id: string, status: 'approved' | 'refused', note: string | null) {
    setProblem(null);
    try {
      await api.patch(`/api/v2/leave/${id}`, { status, note });
      toast(status === 'approved' ? 'Approved · the agent is told now' : 'Refused · the agent is told now');
      setRefusing(null);
      setWhy(null);
      reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    }
  }

  return (
    <div className="d-bento">
      <div className="d-c-7 d-col d-gap-16">
        <div className="d-row">
          <h3 className="d-grow">Waiting for your answer</h3>
          <span className="d-small d-muted">The agent is told as soon as you answer</span>
        </div>

        {problem && <ErrorNote>{problem}</ErrorNote>}

        {waiting.length === 0 ? (
          <div className="d-card">
            <div className="d-empty">
              <span className="d-ic v2-ic-green"><Icon name="check" size={28} /></span>
              <b>No leave request is waiting</b>
              <p>New requests show here and in the menu.</p>
            </div>
          </div>
        ) : waiting.map((one) => (
          <section className="d-card d-req" key={one.id}>
            <div className="d-row">
              <span className="d-person d-grow">
                <Avatar name={one.userName ?? '?'} size={44} />
                <span className="d-who">
                  <b className="d-big">{one.userName} · {kindWord(one.kind)} leave</b>
                  {one.createdAt && <span>Asked {nice(one.createdAt.slice(0, 10))}</span>}
                </span>
              </span>
              <span className="d-chip d-amber d-pip">Waiting</span>
            </div>

            <div className="d-row d-gap-24">
              <div className="d-stat">
                <b className="d-num-sm">{span(one)}</b>
                <span className="d-label">
                  {one.workingDays} working {one.workingDays === 1 ? 'day' : 'days'}
                </span>
              </div>
            </div>

            {one.reason && (
              <div className="d-facts"><span className="d-chip d-lg">“{one.reason}”</span></div>
            )}

            {refusing === one.id && (
              <div className="d-refuse-box">
                <span className="d-field-label">Why do you refuse? The agent sees this.</span>
                <div className="d-chips">
                  {REFUSALS.map((text) => (
                    <button
                      key={text}
                      type="button"
                      className={why === text ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => setWhy(text)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                {why === null && <span className="d-small d-t-red">Choose a reason first.</span>}
                <div className="d-row">
                  <button
                    type="button"
                    className="d-btn d-sm d-danger d-solid"
                    disabled={why === null}
                    onClick={() => answer(one.id, 'refused', why)}
                  >
                    Refuse the request
                  </button>
                  <button
                    type="button"
                    className="d-btn d-sm d-ghost"
                    onClick={() => { setRefusing(null); setWhy(null); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {refusing !== one.id && (
              <div className="d-row">
                {canAnswer ? (
                  <>
                    <button
                      type="button"
                      className="d-btn d-dark"
                      onClick={() => answer(one.id, 'approved', null)}
                    >
                      <Icon name="check" />Approve
                    </button>
                    <button type="button" className="d-btn" onClick={() => setRefusing(one.id)}>
                      Refuse
                    </button>
                  </>
                ) : (
                  <span className="d-small d-muted">Only an owner or admin can answer this.</span>
                )}
                <span className="d-grow" />
                <Link className="d-card-link" to="/v2/calendar">
                  See the calendar <Icon name="arrow-right" size={14} />
                </Link>
              </div>
            )}
          </section>
        ))}
      </div>

      <section className="d-card d-c-5" aria-label="Answered">
        <div className="d-card-head">
          <h3>Answered</h3>
          <span className="d-small d-muted">most recent first</span>
        </div>
        {answered.length === 0 ? (
          <p className="d-small d-muted">Nothing has been answered yet.</p>
        ) : (
          <div className="d-divide">
            {answered.slice(0, 12).map((one) => (
              <div className="d-ans-row" key={one.id}>
                <Avatar name={one.userName ?? '?'} />
                <span className="d-grow">
                  <b className="d-bold">{one.userName}</b>
                  <div className="d-small d-muted d-truncate">
                    {kindWord(one.kind)} · {span(one)} · {one.workingDays} days
                  </div>
                  {one.decisionNote && (
                    <div className="d-small d-muted d-truncate">{one.decisionNote}</div>
                  )}
                </span>
                <span className={one.status === 'approved' ? 'd-chip d-green' : 'd-chip d-red'}>
                  {one.status === 'approved' ? 'Approved' : 'Refused'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ── the owner's own attendance ────────────────────────────────────────── */

function OwnerMine({ mine, reload, onAsk }: { mine: Mine; reload: () => void; onAsk: () => void }) {
  const [outside, setOutside] = useState(false);
  const marks = useMarks(mine);
  const week = weekOf(dubaiToday());

  const today = mine.today;
  const mark: Mark = today.closed ? 'none'
    : today.marked === 'outside' ? 'out'
      : today.marked === 'office' ? (today.wasLate ? 'late' : 'ok') : 'none';

  const month = dubaiToday().slice(0, 7);
  const inMonth = mine.days.filter((d) => d.on_date.startsWith(month));
  const office = inMonth.filter((d) => d.kind === 'office').length;
  const away = inMonth.filter((d) => d.kind === 'outside').length;
  const late = inMonth.filter((d) => Number(d.was_late) === 1).length;
  const leaveDays = Object.values(mine.taken).reduce((sum, n) => sum + n, 0);
  const waiting = mine.leave.filter((one) => one.status === 'pending');

  return (
    <>
      <div className="d-bento">
        <section className="d-card d-c-4">
          <div className="d-card-head">
            <h3>Today</h3>
            <span className={CHIP[mark]}>{today.closed ? 'Office closed' : WORD[mark]}</span>
          </div>
          <div className="d-stat">
            {today.marked
              ? <b className="d-num-hero v2-att-big">{clock(today.markedAt)}</b>
              : <b className="d-num-sm">{today.closed ? 'Office closed' : 'Not marked yet'}</b>}
            <span className="d-label">
              {today.closed ? 'Nothing is expected of anybody today'
                : today.marked === 'outside' ? (today.note ?? 'Working outside')
                  : today.marked ? 'Checked in on the office Wi-Fi'
                    : 'You can check in like anybody else'}
            </span>
          </div>
          {!today.closed && !today.marked && (
            <div className="d-card-foot">
              <button type="button" className="d-btn" onClick={() => setOutside(true)}>
                <Icon name="pin" />I&apos;m working outside
              </button>
              <span>Owners can call without a check-in.</span>
            </div>
          )}
        </section>

        <section className="d-card d-c-8">
          <div className="d-card-head">
            <h3>This week</h3>
            <span className="d-small d-muted">{nice(week[0]!)} – {nice(week[6]!)}</span>
          </div>
          <div className="d-week">
            {week.map((date, i) => {
              const one = markOn(marks, date);
              return (
                <div
                  className={date === dubaiToday() ? 'd-wd d-today' : 'd-wd'}
                  key={date}
                >
                  <b>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]} {Number(date.slice(8))}</b>
                  {/* The design puts the hours here. `/attendance/me` sends the
                      day and whether it was late, but not the time it was
                      marked, so the cell carries the word instead. */}
                  {one === 'future' || one === 'none'
                    ? <span>–</span>
                    : <span className={CHIP[one]}>{WORD[one]}</span>}
                </div>
              );
            })}
          </div>
          <div className="d-row d-gap-24 d-mt-24 d-wrap">
            <div className="d-stat"><b className="d-num">{office}</b><span className="d-label">Days in office</span></div>
            <div className="d-stat"><b className="d-num">{away}</b><span className="d-label">Days outside</span></div>
            <div className="d-stat"><b className="d-num">{late}</b><span className="d-label">Late</span></div>
            <div className="d-stat"><b className="d-num">{leaveDays}</b><span className="d-label">Leave days</span></div>
            <span className="d-grow" />
            <button type="button" className="d-btn d-sm" onClick={onAsk}>
              <Icon name="plus" />Ask for days off
            </button>
          </div>
        </section>
      </div>

      <MyWaiting rows={waiting} reload={reload} />

      {outside && (
        <OutsidePanel onClose={() => setOutside(false)} onSaved={() => { setOutside(false); reload(); }} />
      )}
    </>
  );
}

/* ── the two side panels ───────────────────────────────────────────────── */

const WHY_OUTSIDE = [
  'Viewing with a client', 'Site visit', 'Meeting at the developer',
  'Event or expo', 'Bank or papers', 'Something else',
];

function OutsidePanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [why, setWhy] = useState<string | null>(null);
  const [where, setWhere] = useState('');
  const [withWho, setWithWho] = useState('');
  const [back, setBack] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  const missing = { why: why === null, where: where.trim() === '' };

  async function save() {
    setTouched(true);
    if (missing.why || missing.where) return;
    setBusy(true);
    setProblem(null);
    /* One line, because the server keeps a single note per day. It is the
       line the office reads on the team screen, so it carries everything. */
    const note = [why, where.trim(), withWho.trim() && `with ${withWho.trim()}`, back && `back by ${back}`]
      .filter(Boolean).join(' · ');
    try {
      await api.post('/api/attendance/outside', { note });
      toast('You are working outside. The office can see it.');
      onSaved();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="Working outside">
        <div className="d-panel-head">
          <h2>I&apos;m working outside</h2>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          <p className="d-muted">
            Tell the office where you are. It shows on the team screen, and it is the
            same as checking in.
          </p>

          <div className={touched && missing.why ? 'd-field d-invalid' : 'd-field'}>
            <span className="d-field-label">Why are you outside?</span>
            <div className="d-chips">
              {WHY_OUTSIDE.map((text) => (
                <button
                  key={text}
                  type="button"
                  className={why === text ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => setWhy(text)}
                >
                  {text}
                </button>
              ))}
            </div>
            <span className="d-error">Choose why you are outside.</span>
          </div>

          <div className={touched && missing.where ? 'd-field d-invalid' : 'd-field'}>
            <label htmlFor="v2-out-where">Where exactly</label>
            <input
              id="v2-out-where"
              className="d-input"
              value={where}
              placeholder="Valia sales centre, The Oasis"
              onChange={(e) => setWhere(e.target.value)}
            />
            <span className="d-error">Write where exactly you are.</span>
          </div>

          <div className="d-field">
            <label htmlFor="v2-out-who">With who</label>
            <input
              id="v2-out-who"
              className="d-input"
              value={withWho}
              placeholder="Omar K."
              onChange={(e) => setWithWho(e.target.value)}
            />
          </div>

          <div className="d-field">
            <span className="d-field-label">Back by</span>
            <div className="d-chips">
              {['16:30', '17:30', '18:00', 'Tomorrow'].map((text) => (
                <button
                  key={text}
                  type="button"
                  className={back === text ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => setBack(back === text ? null : text)}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        <div className="d-panel-foot">
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
          <span className="d-grow" />
          <button type="button" className="d-btn d-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Start working outside'}
          </button>
        </div>
      </aside>
    </>
  );
}

function AskPanel({ onClose, onAsked }: { onClose: () => void; onAsked: () => void }) {
  const tomorrow = addDays(dubaiToday(), 1);
  const [kind, setKind] = useState('annual');
  const [from, setFrom] = useState(tomorrow);
  const [to, setTo] = useState(tomorrow);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  const badDates = to < from;
  const noReason = reason.trim().length < 3;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

  async function send() {
    setTouched(true);
    if (badDates || noReason) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/v2/leave', {
        kind, fromDate: from, toDate: to, reason: reason.trim(),
      });
      toast('Your request is with the owner. You get a notification with the answer.');
      onAsked();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="Ask for days off">
        <div className="d-panel-head">
          <h2>Ask for days off</h2>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          <div className="d-field">
            <span className="d-field-label">Type</span>
            <div className="d-chips">
              {KINDS.map((one) => (
                <button
                  key={one.value}
                  type="button"
                  className={kind === one.value ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => setKind(one.value)}
                >
                  {one.label}
                </button>
              ))}
            </div>
          </div>

          <div className="v2-two">
            <div className="d-field">
              <label htmlFor="v2-lv-from">From</label>
              <input
                id="v2-lv-from"
                className="d-input"
                type="date"
                value={from}
                min={dubaiToday()}
                onChange={(e) => {
                  setFrom(e.target.value);
                  if (to < e.target.value) setTo(e.target.value);
                }}
              />
            </div>
            <div className={touched && badDates ? 'd-field d-invalid' : 'd-field'}>
              <label htmlFor="v2-lv-to">To</label>
              <input
                id="v2-lv-to"
                className="d-input"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
              <span className="d-error">The last day is before the first day.</span>
            </div>
          </div>

          {/* The office decides which days it is shut, so the working-day
              count is the server's to make. Saying a number here that the
              server then changes is worse than not saying one. */}
          <div className="d-banner">
            <Icon name="calendar-days" />
            <span className="d-grow">
              {badDates
                ? 'Choose the last day after the first one.'
                : `${days} day${days === 1 ? '' : 's'} chosen. Days the office is shut are not counted.`}
            </span>
          </div>

          <div className={touched && noReason ? 'd-field d-invalid' : 'd-field'}>
            <label htmlFor="v2-lv-why">Reason</label>
            <textarea
              id="v2-lv-why"
              className="d-textarea v2-lv-why"
              value={reason}
              placeholder="Family visit"
              onChange={(e) => setReason(e.target.value)}
            />
            <span className="d-error">Write a short reason.</span>
          </div>

          <p className="d-small d-muted">
            An owner answers. You get a notification. Your leads stay with you.
          </p>

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        <div className="d-panel-foot">
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
          <span className="d-grow" />
          <button type="button" className="d-btn d-primary" disabled={busy} onClick={send}>
            {busy ? 'Sending…' : 'Send the request'}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ── working out what each day was ─────────────────────────────────────── */

const BAR: Record<Mark, string> = {
  ok: 'd-s-ok', late: 'd-s-late', out: 'd-s-out', leave: 'd-s-leave',
  asked: 'd-s-leave', abs: 'd-s-abs', future: '', none: '',
};

const SHORT: Record<Mark, string> = {
  ok: 'In', late: 'Late', out: 'Out', leave: 'Leave', asked: 'Asked',
  abs: 'No', future: '–', none: '–',
};

/**
 * One mark per date, from the attendance rows and the leave requests
 * together. Leave only wins where nothing was marked: somebody who came in on
 * a day they had booked off was in the office, whatever the request says.
 */
function useMarks(mine: Mine): Map<string, Mark> {
  return useMemo(() => {
    const out = new Map<string, Mark>();
    for (const one of mine.leave) {
      if (one.status !== 'approved' && one.status !== 'pending') continue;
      const mark: Mark = one.status === 'approved' ? 'leave' : 'asked';
      for (let at = one.fromDate; at <= one.toDate; at = addDays(at, 1)) out.set(at, mark);
    }
    for (const row of mine.days) {
      out.set(row.on_date, row.kind === 'outside' ? 'out'
        : Number(row.was_late) === 1 ? 'late' : 'ok');
    }
    const today = mine.today;
    if (today.marked) {
      out.set(dubaiToday(), today.marked === 'outside' ? 'out' : today.wasLate ? 'late' : 'ok');
    }
    return out;
  }, [mine]);
}

/** The "place · reason" column, which only means Wi-Fi for somebody in. */
function placeOf(mark: Mark, note: string | null): string {
  if (note) return note;
  if (mark === 'abs') return 'No check-in and no leave today';
  if (mark === 'leave') return 'Approved days off';
  if (mark === 'out') return 'Outside, no place written down';
  return 'Office Wi-Fi';
}

/** A day nobody has reached yet is "still to come", not "nobody turned up". */
function markOn(marks: Map<string, Mark>, date: string): Mark {
  return marks.get(date) ?? (date > dubaiToday() ? 'future' : 'none');
}

function lineFor(date: string, mark: Mark, mine: Mine): string {
  if (date === dubaiToday() && mine.today.note) return mine.today.note;
  const row = mine.days.find((d) => d.on_date === date);
  if (row?.note) return row.note;
  if (mark === 'leave') return 'Approved days off.';
  if (mark === 'asked') return 'Asked for, waiting for an answer.';
  if (mark === 'ok') return 'In the office, on time.';
  if (mark === 'late') return 'In the office, after the shift started.';
  if (mark === 'out') return 'Working outside the office.';
  if (date > dubaiToday()) return 'Still to come.';
  return 'Nothing marked. It may have been a day the office was shut.';
}

/* ── dates, the Dubai way ──────────────────────────────────────────────── */

/* Dubai is UTC+4 the whole year and has no daylight saving, so the wall clock
   is the instant plus four hours. A timezone library would be four hundred
   kilobytes to say the same thing. */
const DUBAI_MS = 4 * 3600_000;

function dubaiToday(): string {
  return new Date(Date.now() + DUBAI_MS).toISOString().slice(0, 10);
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Monday to Sunday, the week the date falls in. */
function weekOf(date: string): string[] {
  const monday = addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_u, i) => addDays(monday, i));
}

/** A month's cells, Monday first, with nulls for the blanks before the 1st. */
function monthGrid(month: string): Array<string | null> {
  const first = `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const length = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_u, i) => addDays(first, i)),
  ];
}

function nice(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

function clock(at: string | null): string {
  if (!at) return '—';
  const on = new Date(Date.parse(at) + DUBAI_MS);
  return `${String(on.getUTCHours()).padStart(2, '0')}:${String(on.getUTCMinutes()).padStart(2, '0')}`;
}

function nowClock(): string {
  return clock(new Date().toISOString());
}

function span(one: Leave): string {
  return one.fromDate === one.toDate ? nice(one.fromDate) : `${nice(one.fromDate)} – ${nice(one.toDate)}`;
}

function kindWord(kind: string): string {
  return KINDS.find((one) => one.value === kind)?.label ?? kind;
}
