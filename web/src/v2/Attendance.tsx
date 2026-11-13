import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { celebrate } from '../lib/celebrate.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';
import { attendanceSub } from './subs.js';

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
 *   - Checking out, and with it the design's "Day finished" hero and its
 *     "I'm back in the office" button. There is one tap a day and the first
 *     one wins; the hero says so rather than offering a button that does
 *     nothing. It needs a column and three answers from the owner —
 *     `docs/decisions-to-confirm.md` §43.
 *   - Hours. Nothing records when anybody leaves, so the week's "24 h 14 min
 *     so far" and the month's "Hours in the office" have nothing to add up.
 *     Days are counted instead, and the card says so.
 *   - The shared-location map, and the buttons beside each row of the team
 *     table. Nothing stores a location, and there is no endpoint behind
 *     "Mark as leave"; the note an agent writes on their way out is what the
 *     office gets.
 */

export interface Shift {
  start: string;
  end: string;
  satStart: string;
  satEnd: string;
  /** JS day numbers, 0 = Sunday. */
  closedDays: number[];
  graceMinutes: number;
}

export interface DayState {
  closed: boolean;
  marked: 'office' | 'outside' | null;
  markedAt: string | null;
  wasLate: boolean;
  note: string | null;
  onOfficeNetwork: boolean;
  enabled: boolean;
  /** What the network the caller is on is called, when the owner named it. */
  officeName?: string | null;
  /** Every office network's name, for the "Where" row. */
  officeNames?: string[];
  startsAt: string | null;
  endsAt: string | null;
  /** A tap after this counts as late. The design's "Late · after 09:10". */
  lateAfter: string | null;
  /*
   * Optional on purpose: a tab left open across a deploy is holding the old
   * answer, which has no shift in it, and a screen that throws on a stale
   * field is a screen that throws in front of ten people at once. `shiftOf`
   * leaves the facts blank rather than inventing office hours.
   */
  shift?: Shift;
}

export interface Leave {
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

export interface Mine {
  today: DayState;
  from: string;
  to: string;
  days: Array<{
    on_date: string; kind: string; marked_at: string | null; was_late: number; note: string | null;
  }>;
  leave: Leave[];
  taken: Record<string, number>;
  /** First names of the people who answer a leave request. */
  answerers?: string[];
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

/*
 * The five the server takes (`LEAVE_KINDS` in `server/src/v2/leave.ts`).
 * `LeaveRequest.dc.html` offers six — Annual, Sick, Personal, Half day, Work
 * from home, Other — and three of those have nowhere to be stored. The last
 * one is the design's word, which "Something else" was not.
 */
const KINDS = [
  { value: 'annual', label: 'Annual' },
  { value: 'sick', label: 'Sick' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'other', label: 'Other' },
];

/** A refusal must carry a reason, so the owner picks one of these. */
const REFUSALS = ['Too many people away', 'Busy week', 'Talk to me first'];

/** The five states a day can be in, and how each is drawn. */
export type Mark = 'ok' | 'late' | 'out' | 'leave' | 'asked' | 'abs' | 'future' | 'none';

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

  /*
   * §1.4: the 13px line under the title.
   *
   * Both computer design files put today's date and the shift there:
   * `attendance.html` "Wednesday, 11 November 2026 · shift 09:00 – 18:00" and
   * `team-attendance.html` the same without the year. The phone prototypes
   * write something else again — "Shift 09:00 – 18:00 · Business Bay office"
   * and "Owner · today, Wed 11 Nov" — and the computer design wins.
   *
   * The end of the shift is the one thing neither can have: it is in the
   * attendance settings and `/api/v2/attendance/me` returns only `startsAt`,
   * so the line says when the shift starts rather than inventing six
   * o'clock. `docs/v2/questions-subs.md`.
   */
  const today = mine.data?.today;
  usePhoneHead({
    /* `TeamAttendance.dc.html` calls the owner's screen "Team attendance",
       and `Attendance.dc.html` calls the agent's "Attendance". One address,
       two screens, two names. Both draw the §1.4 pattern-A header: a 17px
       title centred over its sub, because the screen below wants the room. */
    compact: true,
    title: seesTeam ? 'Team attendance' : 'Attendance',
    sub: attendanceSub(seesTeam, new Date(), today?.enabled ? today.startsAt : null),
  });

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

      {!seesTeam && tab === 'today' && (
        <AgentToday mine={mine.data} reload={mine.reload} onGoto={setTab} />
      )}
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
        <AskPanel
          mine={mine.data}
          onClose={() => setAsking(false)}
          onAsked={() => { setAsking(false); mine.reload(); }}
        />
      )}
    </div>
  );
}

/* ── the agent's day ───────────────────────────────────────────────────── */

function AgentToday({ mine, reload, onGoto }: {
  mine: Mine;
  reload: () => void;
  onGoto: (tab: string) => void;
}) {
  const [outside, setOutside] = useState(false);
  const marks = useMarks(mine);
  const week = weekOf(dubaiToday());
  const [picked, setPicked] = useState(dubaiToday());

  const month = useMemo(() => monthFacts(mine), [mine]);
  const asked = mine.leave.filter((one) => one.status === 'pending');
  const annualTaken = mine.taken.annual ?? 0;

  const detail = markOn(marks, picked);
  const shift = shiftOf(mine.today);

  return (
    <>
      <div className="d-bento">
        <Hero day={mine.today} onOutside={() => setOutside(true)} />

        <section className="d-card d-c-5">
          <div className="d-card-head">
            <h3>This week</h3>
            {/* The design's "Week 46 · 24 h 14 min so far". The hours are not
                here: nothing records when anybody leaves, so the week has no
                total to add up. `docs/v2/questions-inbox.md`. */}
            <span className="d-small d-muted">
              Week {weekNumber(dubaiToday())} · {nice(week[0]!)} – {nice(week[6]!)}
            </span>
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
                  {/* The design puts the check-in time in the cell, and falls
                      back to a word only where there is no time to show —
                      "off" on a day the office is shut. */}
                  <span className="d-tt">
                    {timeOn(mine, date)
                      ?? (shift.closedDays.includes(dayOfWeek(date)) ? 'off' : SHORT[mark])}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="d-card d-flat v2-wk-detail">
            <div className="d-row">
              <b className="d-bold d-grow">
                {nice(picked)}{picked === dubaiToday() ? ' · today' : ''}
              </b>
              <span className={CHIP[detail]}>
                {shift.closedDays.includes(dayOfWeek(picked)) && detail === 'none'
                  ? 'Day off'
                  : WORD[detail] || 'Not yet'}
              </span>
            </div>
            <div className="d-small d-muted d-mt-4">{lineFor(picked, detail, mine)}</div>
          </div>
          <div className="d-guide d-mt-auto v2-guide">
            <span><span className="d-dot d-green" />In office, on time</span>
            <span>
              <span className="d-dot d-amber" />
              Late{mine.today.lateAfter ? ` · after ${mine.today.lateAfter}` : ''}
            </span>
            <span><span className="d-dot d-blue" />Working outside</span>
            <span><span className="d-dot d-violet" />Leave</span>
            <span><span className="d-dot d-red" />Absent</span>
            <span><span className="d-dot v2-dot-none" />Day off or not yet</span>
          </div>
        </section>
      </div>

      {/* The design's four tiles, each a link into the tab that explains it.
          `Attendance.dc.html` ends its month with the same row of counts. */}
      <div className="d-bento v2-b-tiles">
        <Tile
          label={`On time in ${MONTHS[Number(dubaiToday().slice(5, 7)) - 1]}`}
          value={month.onTime}
          note={`of ${month.marked} days`}
          up
          onGoto={() => onGoto('month')}
        />
        <Tile
          label="Late"
          value={month.late}
          note={month.lastLate
            ? `${nice(month.lastLate.date)}${month.lastLate.minutes !== null ? ` · ${month.lastLate.minutes} min` : ''}`
            : 'none this month'}
          onGoto={() => onGoto('month')}
        />
        <Tile
          label="Working outside"
          value={month.outside}
          note={month.lastOutside
            ? `${nice(month.lastOutside.date)}${month.lastOutside.why ? ` · ${month.lastOutside.why}` : ''}`
            : 'none this month'}
          onGoto={() => onGoto('month')}
        />
        {/*
          * The design's tile is "Annual leave left · 14 · 3 days asked".
          * There is no allowance in this database, so the number is the one
          * that is true — days taken — under a label that says so. The day
          * Emir sets the allowance this becomes his tile exactly.
          */}
        <Tile
          label="Annual leave taken"
          value={annualTaken}
          note={asked.length > 0
            ? `${askedDays(asked)} day${askedDays(asked) === 1 ? '' : 's'} asked`
            : 'nothing asked'}
          onGoto={() => onGoto('leave')}
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
              <dd>
                {shift.start
                  ? `${shift.start} – ${shift.end}, ${openDays(shift.closedDays)}`
                  : mine.today.closed
                    ? 'The office is closed today'
                    : `Starts at ${mine.today.startsAt ?? '—'}`}
              </dd>
            </div>
            <div className="d-kv-row">
              <dt>Late</dt>
              <dd>
                {mine.today.lateAfter
                  ? `Check-in after ${mine.today.lateAfter}`
                  : `Check-in more than ${shift.graceMinutes} minutes after the shift starts`}
              </dd>
            </div>
            <div className="d-kv-row">
              <dt>Where</dt>
              <dd>{whereLine(mine.today.officeNames)}</dd>
            </div>
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

/**
 * A tile that is a link, as the design draws it: `<a class="card tile"
 * href="#month" data-goto="month">`. Pressing it moves to the tab that holds
 * the detail, which is the only reason the number is interesting.
 */
function Tile({ label, value, note, up, onGoto }: {
  label: string;
  value: number;
  note: string;
  up?: boolean;
  onGoto?: () => void;
}) {
  const body = (
    <>
      <span className="d-label">{label}</span>
      <div className="d-stat-row d-mt-4">
        <b className="d-num">{value}</b>
        <span className={up ? 'd-delta d-up' : 'd-delta'}>{note}</span>
      </div>
    </>
  );
  if (!onGoto) return <div className="d-card d-c-3 d-tile">{body}</div>;
  return (
    <button type="button" className="d-card d-c-3 d-tile d-click" onClick={onGoto}>
      {body}
    </button>
  );
}

/**
 * Check in.
 *
 * The page is reloaded rather than refetched: checking in changes the pill in
 * the top bar as well as this screen, and the shell reads that once, when it
 * mounts.
 */
function useCheckIn(): { checkIn: () => void; busy: boolean; problem: string | null } {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  async function checkIn() {
    setBusy(true);
    setProblem(null);
    try {
      const saved = await api.post<DayState>('/api/attendance/check-in', {});
      /* The design throws confetti on check-in, and `celebrate()` already
         does nothing at all for anybody who has asked their device to stop
         animating things. The time is the server's, never this clock's. */
      celebrate();
      toast(`Checked in at ${clock(saved.markedAt)}. Have a good day.`);
      window.location.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return { checkIn, busy, problem };
}

function CheckInButton({ enabled }: { enabled: boolean }) {
  const { checkIn, busy } = useCheckIn();
  return (
    <button type="button" className="d-btn" disabled={!enabled || busy} onClick={checkIn}>
      <Icon name="check" />Check in
    </button>
  );
}

/**
 * The hero, in the three states this CRM has.
 *
 * The design draws a fourth — "Day finished" after checking out — which is
 * not built: there is one tap a day and the first one wins.
 */
function Hero({ day, onOutside }: { day: DayState; onOutside: () => void }) {
  const { checkIn, busy, problem } = useCheckIn();

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
    /*
     * The design's outside hero is "Outside · back by 16:30" over the place,
     * who with and why. All four are in the one line the agent wrote on the
     * way out — the table keeps a single note per day — so the headline takes
     * the "back by" out of it and the rest stays as the sub.
     */
    const back = backFrom(day.note);
    return (
      <section className="d-card d-hero d-c-7 v2-att-hero">
        <div>
          <span className="d-h-eyebrow">
            <span className={`d-dot ${out ? 'd-blue' : day.wasLate ? 'd-amber' : 'd-green'}`} />
            {out
              ? `Working outside · marked once at ${clock(day.markedAt)}`
              : `Checked in · ${day.wasLate ? 'late' : 'on time'}`}
          </span>
          <div className="d-h-big">
            {out
              ? (back ? `Outside · back by ${back}` : 'Outside today')
              : `In office since ${clock(day.markedAt)}`}
          </div>
          {out && day.note && <p className="d-h-sub">{day.note}</p>}
          <div className="d-h-facts">
            <div><b>{workedSince(day.markedAt)}</b><span>worked today</span></div>
            <div><b>{day.endsAt ?? '—'}</b><span>shift ends</span></div>
            <div>
              <b>{out ? 'Outside' : day.officeName ?? 'Office Wi-Fi'}</b>
              <span>{out ? 'where' : 'office Wi-Fi'}</span>
            </div>
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
          {day.onOfficeNetwork
            ? `Office Wi-Fi found${day.officeName ? ` · ${day.officeName}` : ''}`
            : 'Not on the office network'}
        </span>
        <div className="d-h-big">Ready to start your day?</div>
        {/* The design warns, in this exact shape, that a check-in at this
            hour counts as late: "Shift 09:00 – 18:00. It is 14:55 now, so
            this check-in counts as late. The real time is saved." */}
        <p className="d-h-sub">
          {day.startsAt
            ? `Shift ${day.startsAt} – ${day.endsAt ?? '—'}. ${lateWarning(day)} `
              + 'The real time is saved.'
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
      body: day.note ?? (day.officeName
        ? `Office Wi-Fi ${day.officeName}`
        : 'On the office Wi-Fi.'),
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
      body: day.startsAt
        ? `Shift started ${day.startsAt}${day.lateAfter ? ` · late after ${day.lateAfter}` : ''}`
        : 'Check in when you get in.',
      at: nowClock(),
    });
  }
  steps.push({
    tone: '', icon: 'clock', title: 'One tap a day',
    body: 'The first tap is the one that is saved. A second one changes nothing.',
    at: '',
  });
  /*
   * The design's last row is "Shift ends · 18:00 · if you forget, the day
   * closes at 18:00", which is about checking out. Nothing in this CRM
   * records when anybody leaves, so the row says when the shift ends and
   * stops there rather than promising a close that does not happen.
   */
  if (day.endsAt) {
    steps.push({
      tone: '', icon: 'clock', title: 'Shift ends',
      body: `The office day ends at ${day.endsAt}.`,
      at: day.endsAt,
    });
  }
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
  const shift = shiftOf(mine.today);
  /* Without the shift there is no way to tell a day the office was shut from
     a day nobody came in, so the sixth total stays "Not marked". */
  const knowsClosed = shift.start !== '';
  const closed = shift.closedDays;
  const totals = useMemo(() => {
    const count: Record<string, number> = { ok: 0, late: 0, out: 0, leave: 0, abs: 0, none: 0 };
    for (const date of cells) {
      if (!date || date > dubaiToday()) continue;
      const mark = markOn(marks, date);
      /* A day the office was shut is not an absence. `closedDays` reaches
         the agent's own screen now, so the two can finally be told apart —
         until today every unmarked Sunday read as "not marked". */
      if (mark === 'none') {
        if (!knowsClosed) count.none = (count.none ?? 0) + 1;
        else if (!closed.includes(dayOfWeek(date))) count.abs = (count.abs ?? 0) + 1;
      } else if (mark === 'asked') count.leave = (count.leave ?? 0) + 1;
      else if (count[mark] !== undefined) count[mark] = (count[mark] ?? 0) + 1;
    }
    return count;
  }, [cells, marks, closed, knowsClosed]);

  const worked = (totals.ok ?? 0) + (totals.late ?? 0) + (totals.out ?? 0);
  const detail = markOn(marks, picked);
  const row = mine.days.find((one) => one.on_date === picked) ?? null;
  const late = row ? minutesLate(row, shift) : null;

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
            /* The design draws a day the office was shut as `.md.off` — an
               outline, no colour and nothing to press. It could not tell
               those from an absence until `closedDays` reached this screen. */
            const off = knowsClosed && closed.includes(dayOfWeek(date))
              && (mark === 'none' || mark === 'future');
            return (
              <button
                key={date}
                type="button"
                className={[
                  'd-md', off ? 'd-off' : `d-${mark}`,
                  date === dubaiToday() ? 'd-today' : '',
                  date === picked ? 'd-on' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setPicked(date)}
              >
                <b>{Number(date.slice(8))}</b>
                {/* The design's own cell: "Late 09:18", "Outside 09:30", or
                    the bare time; nothing at all on a closed or future day. */}
                <span>{cellWord(mine, date, mark, off)}</span>
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
            {knowsClosed ? (
              <div><b>{totals.abs ?? 0}</b><span><span className="d-dot d-red" />Absent</span></div>
            ) : (
              <div><b>{totals.none ?? 0}</b><span><span className="d-dot" />Not marked</span></div>
            )}
            <div><b>{worked}</b><span>Days worked</span></div>
          </div>
          {/* The design's foot is "Hours in the office: 60 h 12 min". Nothing
              records when anybody leaves, so there are no hours to add up —
              written down in `docs/v2/questions-inbox.md`. */}
          <div className="d-card-foot">
            Days, not hours: the CRM saves when you arrive, not when you leave.
          </div>
        </section>

        <section className="d-card">
          <div className="d-card-head d-mb-8">
            <h3>{nice(picked)}{picked === dubaiToday() ? ' · today' : ''}</h3>
            <span className={CHIP[detail]}>{WORD[detail] || 'Not yet'}</span>
          </div>
          {/*
            * The design's rows, and only the ones this CRM can fill. It
            * writes Check in (with the minutes late), Check out, Worked,
            * Where and Note; nothing records when anybody leaves, so the
            * middle two are not drawn rather than drawn empty.
            */}
          <dl className="d-kv">
            {detail === 'leave' || detail === 'asked' ? (
              <>
                <div className="d-kv-row"><dt>Type</dt><dd>{WORD[detail]}</dd></div>
                <div className="d-kv-row">
                  <dt>Answer</dt>
                  <dd>{detail === 'asked' ? 'Waiting for an answer' : 'Approved'}</dd>
                </div>
              </>
            ) : detail === 'future' || detail === 'none' || detail === 'abs' ? (
              <>
                <div className="d-kv-row">
                  <dt>Check in</dt>
                  <dd>{detail === 'future' ? 'Still to come' : 'Not yet'}</dd>
                </div>
                <div className="d-kv-row">
                  <dt>Shift</dt>
                  <dd>
                    {/* The design's own two: "Started at 09:00" on a day
                        that has passed, the hours on one still to come. */}
                    {startOn(picked, shift)
                      ? (detail === 'future'
                        ? `${startOn(picked, shift)} – ${shift.end}`
                        : `Started at ${startOn(picked, shift)}`)
                      : lineFor(picked, detail, mine)}
                  </dd>
                </div>
              </>
            ) : (
              <>
                <div className="d-kv-row">
                  <dt>Check in</dt>
                  <dd>
                    {timeOn(mine, picked)
                      ? `${timeOn(mine, picked)}${late !== null ? ` · ${late} min late` : ' · on time'}`
                      : WORD[detail]}
                  </dd>
                </div>
                <div className="d-kv-row">
                  <dt>Where</dt>
                  <dd>
                    {detail === 'out'
                      ? (row?.note ?? mine.today.note ?? 'Outside, no place written down')
                      : mine.today.officeName && picked === dubaiToday()
                        ? `Office Wi-Fi ${mine.today.officeName}`
                        : 'Office Wi-Fi'}
                  </dd>
                </div>
                {(row?.note || (picked === dubaiToday() && mine.today.note)) && detail !== 'out' && (
                  <div className="d-kv-row">
                    <dt>Note</dt>
                    <dd>{row?.note ?? mine.today.note}</dd>
                  </div>
                )}
              </>
            )}
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
  const lastSick = lastOf(mine.leave, 'sick');

  return (
    <>
      <div className="d-bento">
        {/*
          * The design's first card is "Annual leave left · 14 · of 22 days
          * this year" with a 64% bar. No allowance is stored anywhere, so
          * this is the same card counting what is true. The bar needs the 22
          * to mean anything, so it is not drawn.
          */}
        <section className="d-card d-c-4">
          <span className="d-label">Annual leave taken</span>
          <div className="d-stat-row d-mt-4">
            <b className="d-num-hero v2-att-big">{mine.taken.annual ?? 0}</b>
            <span className="d-delta">working days this year</span>
          </div>
          <div className="d-card-foot">
            {taken === 0
              ? 'Nothing taken yet.'
              : `${taken} day${taken === 1 ? '' : 's'} off in all: `
                + Object.entries(mine.taken).map(([kind, n]) => `${n} ${kindWord(kind).toLowerCase()}`).join(' · ')}
          </div>
        </section>

        <section className="d-card d-c-4">
          <span className="d-label">Sick days used</span>
          <div className="d-stat-row d-mt-4">
            <b className="d-num-hero v2-att-big">{mine.taken.sick ?? 0}</b>
            <span className="d-delta">{lastSick ? `last: ${nice(lastSick.fromDate)}` : 'none this year'}</span>
          </div>
          <div className="d-card-foot">A sick note is needed from day 2.</div>
        </section>

        <section className="d-card d-c-4">
          <span className="d-label">Waiting for an answer</span>
          <div className="d-stat-row d-mt-4">
            <b className="d-num-hero v2-att-big">{waiting.length}</b>
            <span className="d-delta">
              {waiting.length === 0
                ? 'No open request'
                : `${sentence(answerList(mine.answerers))} answers`}
            </span>
          </div>
          <div className="d-card-foot">
            <button type="button" className="d-btn d-primary" onClick={onAsk}>
              <Icon name="plus" />Request leave
            </button>
          </div>
        </section>
      </div>

      <MyWaiting rows={waiting} reload={reload} answerers={mine.answerers} />
      <MyHistory rows={answered} />
    </>
  );
}

function MyWaiting({ rows, reload, answerers }: {
  rows: Leave[];
  reload: () => void;
  answerers?: string[];
}) {
  const toast = useToast();
  /* The design asks twice before anything is undone — `data-confirm="Tap
     again to cancel"` — and then offers an Undo on the toast. */
  const [armed, setArmed] = useState<string | null>(null);

  async function cancel(one: Leave) {
    try {
      await api.post(`/api/v2/leave/${one.id}/cancel`, {});
      setArmed(null);
      reload();
      toast(`Leave request cancelled · ${span(one)}`, {
        /* A cancelled request cannot be un-cancelled, so Undo asks for the
           same days again. The owner sees one new request, not two. */
        action: {
          label: 'Undo',
          onClick: () => {
            void api.post('/api/v2/leave', {
              kind: one.kind,
              fromDate: one.fromDate,
              toDate: one.toDate,
              reason: one.reason,
            }).then(() => { toast('Asked again'); reload(); })
              .catch((err: unknown) => toast(err instanceof Error ? err.message : 'That did not work.'));
          },
        },
      });
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
            <p>
              When you ask for leave it shows here until {answerList(answerers)}{' '}
              {(answerers?.length ?? 0) === 1 ? 'answers' : 'answer'}.
            </p>
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
                  {one.reason ? `“${one.reason}” · ` : ''}
                  {one.createdAt ? `asked ${askedWhen(one.createdAt)} · ` : ''}
                  waiting for {answerList(answerers)}
                </span>
              </span>
              <span className="d-chip d-violet d-pip">Waiting</span>
              <button
                type="button"
                className={armed === one.id ? 'd-btn d-sm d-danger' : 'd-btn d-sm'}
                onClick={() => (armed === one.id ? void cancel(one) : setArmed(one.id))}
                onBlur={() => setArmed((was) => (was === one.id ? null : was))}
              >
                {armed === one.id ? 'Tap again to cancel' : 'Cancel request'}
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
              <tr>
                <th>Type</th><th>Days</th><th>Working days</th><th>Reason</th><th>Asked</th>
                <th>Answer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((one) => (
                <tr key={one.id}>
                  <td><span className="d-t-main">{kindWord(one.kind)}</span></td>
                  <td className="d-t-sub">{span(one)}</td>
                  <td>{one.workingDays}</td>
                  <td className="d-t-sub">{one.reason ?? '—'}</td>
                  <td className="d-t-sub">{one.createdAt ? askedWhen(one.createdAt) : '—'}</td>
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
  /* The reason is only asked for once somebody presses Refuse. Showing it the
     moment the box opens reads as a complaint about nothing. */
  const [needWhy, setNeedWhy] = useState(false);
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
      setNeedWhy(false);
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
                      onClick={() => { setWhy(text); setNeedWhy(false); }}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                {needWhy && <span className="d-small d-t-red">Choose a reason first.</span>}
                <div className="d-row">
                  <button
                    type="button"
                    className="d-btn d-sm d-danger d-solid"
                    onClick={() => {
                      if (why === null) { setNeedWhy(true); return; }
                      answer(one.id, 'refused', why);
                    }}
                  >
                    Refuse the request
                  </button>
                  <button
                    type="button"
                    className="d-btn d-sm d-ghost"
                    onClick={() => { setRefusing(null); setWhy(null); setNeedWhy(false); }}
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
                    <button
                      type="button"
                      className="d-btn"
                      onClick={() => { setRefusing(one.id); setWhy(null); setNeedWhy(false); }}
                    >
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
                    : today.startsAt ? `The shift starts at ${today.startsAt}`
                      : 'Check in when you get in'}
            </span>
          </div>
          {!today.closed && !today.marked && (
            <div className="d-card-foot">
              <CheckInButton enabled={today.onOfficeNetwork} />
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

      <MyWaiting rows={waiting} reload={reload} answerers={mine.answerers} />

      {outside && (
        <OutsidePanel onClose={() => setOutside(false)} onSaved={() => { setOutside(false); reload(); }} />
      )}
    </>
  );
}

/* ── the two side panels ───────────────────────────────────────────────── */

/*
 * The six reasons, in `design/web/attendance.html`'s words.
 *
 * `WorkOutside.dc.html` names four of them differently — Developer sales
 * centre, Client meeting, Event / roadshow, Bank / paperwork — and the
 * computer design is the newer of the two, so these are its. The last one
 * was "Something else" in the build and is "Other" in both designs.
 */
const WHY_OUTSIDE = [
  'Viewing with a client', 'Site visit', 'Meeting at the developer',
  'Event or expo', 'Bank or papers', 'Other',
];

function OutsidePanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [why, setWhy] = useState<string | null>(null);
  const [where, setWhere] = useState('');
  const [withWho, setWithWho] = useState('');
  const [back, setBack] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  /*
   * "With who", picked from your own leads.
   *
   * The design's field is a `<datalist>` over the agent's lead names, and the
   * build had a free-text box with a made-up name in the placeholder. These
   * are the caller's own leads — `/api/my-leads` is fenced to what the viewer
   * may see, so an agent gets theirs and nobody else's.
   */
  const leads = useAsync<{ items: Array<{ full_name: string | null }> }>(
    () => api.get('/api/my-leads?tab=all&pageSize=50'), [],
  );
  const names = (leads.data?.items ?? [])
    .map((one) => one.full_name)
    .filter((one): one is string => Boolean(one && one.trim()))
    .slice(0, 50);

  const missing = {
    why: why === null,
    where: where.trim() === '',
    /* The design marks "Back by" required and refuses to send without it. */
    back: back === null,
  };

  async function save() {
    setTouched(true);
    if (missing.why || missing.where || missing.back) return;
    setBusy(true);
    setProblem(null);
    /* One line, because the server keeps a single note per day. It is the
       line the office reads on the team screen, so it carries everything. */
    const line = [
      why,
      where.trim(),
      withWho.trim() && `with ${withWho.trim()}`,
      back && `back by ${back}`,
      note.trim(),
    ].filter(Boolean).join(' · ');
    try {
      await api.post('/api/attendance/outside', { note: line.slice(0, 160) });
      toast(`You are working outside · back by ${(back ?? '').toLowerCase()}. The office can see it.`);
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

          {/*
            * The design's first field is "Share my location · one time only",
            * over "We read it once, now. We do not follow you." Nothing in
            * this CRM stores a location — there is no column for one and no
            * endpoint that takes one — so the field is not drawn and the
            * place is typed instead. `docs/v2/questions-inbox.md`.
            */}

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

          {/* Both designs ask who before where: "With who" is a lead name,
              then "Where exactly" is the free line under it. The build had
              the two the other way round. */}
          <div className="d-field">
            <label htmlFor="v2-out-who">With who</label>
            <input
              id="v2-out-who"
              className="d-input"
              value={withWho}
              list="v2-out-leads"
              placeholder="Start typing a lead's name"
              onChange={(e) => setWithWho(e.target.value)}
            />
            <datalist id="v2-out-leads">
              {names.map((one) => <option key={one} value={one} />)}
            </datalist>
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

          <div className={touched && missing.back ? 'd-field d-invalid' : 'd-field'}>
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
            <span className="d-error">Choose when you are back.</span>
          </div>

          <div className="d-field">
            <label htmlFor="v2-out-note">Note</label>
            <textarea
              id="v2-out-note"
              className="d-textarea v2-lv-why"
              value={note}
              placeholder="Anything the office should know"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        <div className="d-panel-foot">
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
          <span className="d-grow" />
          {/*
            * `WorkOutside.dc.html` names the missing field in the button
            * itself rather than letting you press it and be refused —
            * "Pick why you are outside" → "Write where exactly" → the
            * computer design's own "Start working outside". Under a thumb
            * that is the only place anybody looks.
            */}
          <button type="button" className="d-btn d-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…'
              : missing.why ? 'Pick why you are outside'
                : missing.where ? 'Write where exactly'
                  : missing.back ? 'Choose when you are back'
                    : 'Start working outside'}
          </button>
        </div>
      </aside>
    </>
  );
}

function AskPanel({ mine, onClose, onAsked }: {
  mine: Mine;
  onClose: () => void;
  onAsked: () => void;
}) {
  /* The next day the office is open, not simply tomorrow: opening the panel
     on a Saturday and being told "Saturday is a day off" is the kind of
     first screen that makes people stop using a form. */
  const first = nextOpenDay(dubaiToday(), shiftOf(mine.today).closedDays);
  const [kind, setKind] = useState('annual');
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(first);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  const closed = shiftOf(mine.today).closedDays;
  const waiting = mine.leave.filter((one) => one.status === 'pending');

  /*
   * Every rule `design/web/attendance.html` checks before it will send,
   * in its own words.
   *
   * The working days are counted here against the days the office is shut —
   * the same rule the server applies when it stores the request, so the
   * number on the banner is the number that gets saved. It was a plain count
   * of calendar days before, which told an agent asking for Thursday to
   * Sunday that they were asking for four.
   */
  const fromError = !from ? 'Choose the first day.'
    : from < dubaiToday() ? 'This day has passed.'
      : closed.includes(dayOfWeek(from)) ? `${dayName(from)} is a day off.`
        : '';
  const toError = !to ? 'Choose the last day.'
    : to < from ? 'The last day is before the first day.'
      : closed.includes(dayOfWeek(to)) ? 'This is a day off. Choose a working day.'
        : '';
  const clash = fromError || toError ? null : overlapping(waiting, from, to);
  const days = fromError || toError ? 0 : workingDays(from, to, closed);
  const noReason = reason.trim().length < 3;
  const stop = Boolean(fromError || toError || clash);

  async function send() {
    setTouched(true);
    if (stop || noReason || days === 0) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/v2/leave', {
        kind, fromDate: from, toDate: to, reason: reason.trim(),
      });
      toast(
        `Leave request is with ${answerList(mine.answerers)} · ${range(from, to)}`
        + ' · you get a notification with the answer',
      );
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
      <aside className="d-panel d-open" aria-label="Request leave">
        <div className="d-panel-head">
          {/* `LeaveRequest.dc.html` calls it "Request leave", over "Emir or
              George approves it" — the owner's name is theirs, so this says
              what it does rather than who. */}
          <h2>Request leave</h2>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          {/*
            * The design's three chips are "14 annual days left · 3 sick days
            * used · 1 waiting". There is no allowance, so the first one
            * counts what has been taken instead and says so.
            */}
          <div className="d-row d-gap-8 d-wrap">
            <span className="d-chip d-green">{mine.taken.annual ?? 0} annual days taken</span>
            <span className="d-chip">{mine.taken.sick ?? 0} sick days used</span>
            <span className="d-chip d-violet">{waiting.length} waiting</span>
          </div>

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
            <div className={touched && fromError ? 'd-field d-invalid' : 'd-field'}>
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
              <span className="d-error">{fromError}</span>
            </div>
            <div className={touched && toError ? 'd-field d-invalid' : 'd-field'}>
              <label htmlFor="v2-lv-to">To</label>
              <input
                id="v2-lv-to"
                className="d-input"
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
              />
              <span className="d-error">{toError}</span>
            </div>
          </div>

          {clash ? (
            <div className="d-banner d-red">
              <Icon name="calendar-days" />
              <span className="d-grow">
                <b>You already asked for these days.</b>
                {' '}{kindWord(clash.kind)} · {span(clash)} is waiting for an answer.
                {' '}Choose other days or cancel that request first.
              </span>
            </div>
          ) : days > 0 ? (
            <div className="d-banner d-green">
              <Icon name="calendar-days" />
              <span className="d-grow">
                <b>{days} working day{days === 1 ? '' : 's'}</b> · {range(from, to)}
                {days !== calendarDays(from, to) ? ' · days off are not counted' : ''}
              </span>
            </div>
          ) : (
            <div className="d-banner">
              <Icon name="calendar-days" />
              <span className="d-grow">
                Choose the days. {closedNames(closed)} are days off and are not counted.
              </span>
            </div>
          )}

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

          {/* Sick leave: the design puts a "Add the sick note" upload here,
              "needed from day 2". Nothing stores a file against a leave
              request, so the rule is said and the upload is not drawn.
              `docs/v2/questions-inbox.md`. */}
          {kind === 'sick' && days >= 2 && (
            <p className="d-small d-muted">
              A sick note is needed from day 2. Hand it to the office — the CRM cannot
              hold the file yet.
            </p>
          )}

          <p className="d-small d-muted">
            {sentence(answerList(mine.answerers))}
            {' '}{(mine.answerers?.length ?? 0) === 1 ? 'answers' : 'answer'}.
            {' '}You get a notification. Your leads stay with you.
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
  const shift = shiftOf(mine.today);
  const start = startOn(date, shift);
  if (mark === 'ok' || mark === 'late') {
    const at = timeOn(mine, date);
    const late = row ? minutesLate(row, shift) : null;
    if (!at) return mark === 'late' ? 'In the office, after the shift started.' : 'In the office, on time.';
    return `In ${at}${late !== null ? ` · ${late} min late` : ' · on time'}`;
  }
  if (mark === 'out') return 'Working outside the office.';
  /* The design's own three lines for a day with no mark on it. */
  if (shift.start && shift.closedDays.includes(dayOfWeek(date))) {
    return `${closedNames(shift.closedDays)} ${shift.closedDays.length === 1 ? 'is a day off' : 'are days off'}.`;
  }
  if (date > dubaiToday()) {
    return shift.start ? `Shift ${shift.start} – ${shift.end}.` : 'Still to come.';
  }
  if (start) return `No check-in yet. The shift started at ${start}.`;
  return 'Nothing marked. It may have been a day the office was shut.';
}

/** When the shift starts on that date, or null when the office is shut. */
export function startOn(date: string, shift: Shift): string | null {
  if (!shift.start) return null;
  const day = dayOfWeek(date);
  if (shift.closedDays.includes(day)) return null;
  return day === 6 ? shift.satStart : shift.start;
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

/* ── the facts the design's tiles and panels name ──────────────────────── */

/** 0 = Sunday, like `Date.getUTCDay()` and like the stored `closedDays`. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dayName(date: string): string {
  return DAY_NAMES[dayOfWeek(date)] ?? '';
}

/**
 * "Monday to Friday", from the days the office is shut.
 *
 * Said as a run where the open days are one — which they are in every office
 * anybody has described — and as a list where they are not, rather than
 * writing a sentence that is only true for a five-day week.
 */
export function openDays(closedDays: number[]): string {
  /* Monday first, which is how everybody says it and how the week strip is
     drawn; the stored numbers are Sunday-first. */
  const order = [1, 2, 3, 4, 5, 6, 0];
  const open = order.filter((day) => !closedDays.includes(day));
  if (open.length === 0) return 'the office is shut every day';
  if (open.length === 7) return 'every day';
  const run = open.every((day, i) => i === 0 || order.indexOf(day) === order.indexOf(open[i - 1]!) + 1);
  if (run && open.length > 2) return `${DAY_NAMES[open[0]!]} to ${DAY_NAMES[open[open.length - 1]!]}`;
  return open.map((day) => DAY_NAMES[day]?.slice(0, 3)).join(', ');
}

/** "Saturday and Sunday", for the line under the dates. */
export function closedNames(closedDays: number[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const shut = order.filter((day) => closedDays.includes(day)).map((day) => DAY_NAMES[day] ?? '');
  if (shut.length === 0) return 'No days';
  if (shut.length === 1) return shut[0] ?? '';
  return `${shut.slice(0, -1).join(', ')} and ${shut[shut.length - 1]}`;
}

/** The same count the server keeps: days in the range the office is open. */
export function workingDays(from: string, to: string, closedDays: number[]): number {
  let days = 0;
  for (let at = from; at <= to; at = addDays(at, 1)) {
    if (!closedDays.includes(dayOfWeek(at))) days += 1;
  }
  return days;
}

function calendarDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** A request already waiting that covers any of these days. */
export function overlapping(waiting: Leave[], from: string, to: string): Leave | null {
  return waiting.find((one) => from <= one.toDate && to >= one.fromDate) ?? null;
}

export function askedDays(waiting: Leave[]): number {
  return waiting.reduce((sum, one) => sum + one.workingDays, 0);
}

/** The most recent approved leave of one kind, for "last: Wed 14 Oct". */
export function lastOf(leave: Leave[], kind: string): Leave | null {
  return leave
    .filter((one) => one.kind === kind && one.status === 'approved')
    .sort((a, b) => b.fromDate.localeCompare(a.fromDate))[0] ?? null;
}

/**
 * "Emir or George", from the real owners. Never a name nobody set.
 *
 * Lower case, because it is read inside a sentence more often than at the
 * start of one — "waiting for an owner". `sentence()` is for the other two.
 */
export function answerList(names: string[] | undefined): string {
  const clean = (names ?? []).filter(Boolean);
  if (clean.length === 0) return 'an owner';
  if (clean.length === 1) return clean[0] as string;
  return `${clean.slice(0, -1).join(', ')} or ${clean[clean.length - 1]}`;
}

/** The same words at the start of a sentence. */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "today 14:07", or "2 Nov 09:12" — 24-hour, in Dubai, like everything else. */
export function askedWhen(at: string): string {
  const on = new Date(Date.parse(at) + DUBAI_MS).toISOString().slice(0, 10);
  const time = clock(at);
  if (on === dubaiToday()) return `today ${time}`;
  return `${new Date(`${on}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  })} ${time}`;
}

/** The check-in time on one date, when there is one. */
function timeOn(mine: Mine, date: string): string | null {
  if (date === dubaiToday() && mine.today.markedAt) return clock(mine.today.markedAt);
  const row = mine.days.find((one) => one.on_date === date);
  return row?.marked_at ? clock(row.marked_at) : null;
}

/** Minutes past the start of that day's shift, for "· 8 min late". */
export function minutesLate(
  row: { on_date: string; marked_at: string | null; was_late: number },
  shift: Shift,
): number | null {
  if (Number(row.was_late) !== 1 || !row.marked_at) return null;
  const day = dayOfWeek(row.on_date);
  if (shift.closedDays.includes(day)) return null;
  const start = day === 6 ? shift.satStart : shift.start;
  const late = minutesOf(row.marked_at) - toMinutes(start);
  return late > 0 ? late : null;
}

function toMinutes(clockValue: string): number {
  const [h, m] = clockValue.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minutes past midnight in Dubai. */
function minutesOf(at: string): number {
  const on = new Date(Date.parse(at) + DUBAI_MS);
  return on.getUTCHours() * 60 + on.getUTCMinutes();
}

/** "4 h 20 min", since the morning's tap. The design's "worked today". */
export function workedSince(at: string | null): string {
  if (!at) return '—';
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60_000));
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "It is 14:55 now, so this check-in counts as late." */
export function lateWarning(day: DayState): string {
  if (!day.lateAfter) return '';
  const now = nowClock();
  return toMinutes(now) > toMinutes(day.lateAfter)
    ? `It is ${now} now, so this check-in counts as late.`
    : `A check-in after ${day.lateAfter} counts as late.`;
}

/** "back by 16:30" out of the one line the agent wrote on the way out. */
export function backFrom(note: string | null): string | null {
  const found = /back by ([^·]+)/i.exec(note ?? '');
  return found?.[1]?.trim() ?? null;
}

/** ISO week number, for the design's "Week 46". */
export function weekNumber(date: string): number {
  const at = new Date(`${date}T00:00:00Z`);
  /* Thursday of this week decides the year's week, which is the ISO rule. */
  const thursday = new Date(at.getTime() + (3 - ((at.getUTCDay() + 6) % 7)) * 86_400_000);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const offset = (firstThursday.getUTCDay() + 6) % 7;
  const week1 = new Date(firstThursday.getTime() - offset * 86_400_000);
  return Math.round((thursday.getTime() - week1.getTime()) / (7 * 86_400_000)) + 1;
}

interface MonthFacts {
  onTime: number;
  late: number;
  outside: number;
  marked: number;
  lastLate: { date: string; minutes: number | null } | null;
  lastOutside: { date: string; why: string | null } | null;
}

/**
 * This month's four tiles, counted from the days that are actually stored.
 *
 * The design's own numbers — "6 of 8 days", "Wed 4 Nov · 8 min", "Fri 6 Nov ·
 * viewing" — are all of this month, not of the sixty-day window the endpoint
 * returns, which is why they are counted here rather than off `mine.days`.
 */
function monthFacts(mine: Mine): MonthFacts {
  const month = dubaiToday().slice(0, 7);
  const rows = mine.days.filter((one) => one.on_date.startsWith(month));
  const late = rows.filter((one) => Number(one.was_late) === 1);
  const outside = rows.filter((one) => one.kind === 'outside');
  const today = mine.today;

  /* Today is in `today`, not in `days`, until tomorrow's read. */
  const todayIn = today.marked && dubaiToday().startsWith(month)
    && !rows.some((one) => one.on_date === dubaiToday());
  const office = rows.filter((one) => one.kind === 'office').length
    + (todayIn && today.marked === 'office' ? 1 : 0);
  const lateCount = late.length + (todayIn && today.wasLate ? 1 : 0);
  const outsideCount = outside.length + (todayIn && today.marked === 'outside' ? 1 : 0);

  const lastLate = late[0] ?? null;
  const lastOutside = outside[0] ?? null;

  return {
    onTime: Math.max(0, office - (todayIn && today.wasLate ? 1 : 0) - late.length),
    late: lateCount,
    outside: outsideCount,
    marked: office + outsideCount,
    lastLate: lastLate
      ? { date: lastLate.on_date, minutes: minutesLate(lastLate, shiftOf(today)) }
      : null,
    lastOutside: lastOutside
      ? { date: lastOutside.on_date, why: (lastOutside.note ?? '').split(' · ')[0] ?? null }
      : null,
  };
}

/** "Mon 18 – Fri 20 Nov", or one day on its own. */
function range(from: string, to: string): string {
  return from === to ? nice(from) : `${nice(from)} – ${nice(to)}`;
}

/** "Only on the office Wi-Fi “homes.me-Office”", when the owner named it. */
function whereLine(names: string[] | undefined): string {
  const clean = (names ?? []).filter(Boolean);
  if (clean.length === 0) return 'Only on the office Wi-Fi';
  if (clean.length === 1) return `Only on the office Wi-Fi “${clean[0]}”`;
  return `Only on the office Wi-Fi: ${clean.map((one) => `“${one}”`).join(' or ')}`;
}

/** The shift, or blanks — never invented office hours. See `DayState.shift`. */
const BLANK_SHIFT: Shift = {
  start: '', end: '', satStart: '', satEnd: '', closedDays: [], graceMinutes: 0,
};

function shiftOf(day: DayState): Shift {
  return day.shift ?? BLANK_SHIFT;
}

/** The design's month cell: "Late 09:18", "Outside 09:30", or just the time. */
export function cellWord(mine: Mine, date: string, mark: Mark, off: boolean): string {
  if (off || mark === 'future') return '';
  const at = timeOn(mine, date);
  if (mark === 'late') return at ? `Late ${at}` : 'Late';
  if (mark === 'out') return at ? `Outside ${at}` : 'Outside';
  if (mark === 'leave' || mark === 'asked') return WORD[mark];
  if (at) return at;
  return SHORT[mark] === '–' ? '' : SHORT[mark];
}

/** The first open day on or after tomorrow. */
export function nextOpenDay(today: string, closedDays: number[]): string {
  let at = addDays(today, 1);
  for (let guard = 0; guard < 14 && closedDays.includes(dayOfWeek(at)); guard += 1) {
    at = addDays(at, 1);
  }
  return at;
}
