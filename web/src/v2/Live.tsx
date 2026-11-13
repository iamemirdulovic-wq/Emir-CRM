import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';
import { usePhoneHead } from './phone.js';
import { liveSub } from './subs.js';

/**
 * What the team is doing right now.
 *
 * `design/web/team-live.html`, the screen an owner opens in the middle of the
 * afternoon to answer one question: is anybody actually ringing these leads.
 * So it is today only, it refreshes itself, and every figure is a count of
 * something that happened rather than a rate or an average.
 *
 * Four endpoints, one screen, and each block says which:
 *
 *  - `/api/v2/live` — the clicks: totals, the hour columns, the per-agent
 *    table, and who called before checking in.
 *  - `/api/activity/team` — who has the CRM open and on which screen, which
 *    is what the "Right now" list is.
 *  - `/api/v2/attendance/team` — today's marks, for the attendance bar and
 *    the two away rows under it.
 *  - `/api/activity/insight` — the line at the top. The numbers in it are
 *    counted on the server; nothing on this screen is generated.
 *
 * Three things the design draws are not here, and all three for the same
 * reason — nothing records them:
 *
 *  - **"On a call · Aisha Noor".** The heartbeat stores the path somebody is
 *    on, not the lead they are reading, so the list says "On the dialler"
 *    and not whose name is on the screen.
 *  - **A Telegram column in the chart.** The design's own toggle offers Calls
 *    and WhatsApp; Telegram is counted in the figure above it.
 *  - **"2 are away".** Who is *signed in* is known and who is *marked in* is
 *    known; "away from their desk" is neither, so the hero counts the people
 *    whose CRM is live and says plainly what the rest are.
 */

/* ── what the endpoints send ───────────────────────────────────────────── */

interface LiveHour {
  hour: number;
  calls: number;
  whatsapp: number;
  telegram: number;
  future: boolean;
}

interface LiveAgent {
  userId: string;
  name: string;
  photoUrl: string | null;
  calls: number;
  whatsapp: number;
  telegram: number;
  spark: number[];
  lastClickAt: string | null;
}

interface NotCheckedIn {
  userId: string;
  name: string;
  calls: number;
  times: string[];
  checkedInAt: string | null;
}

interface TeamLive {
  now: string;
  closed: boolean;
  hours: LiveHour[];
  nowAcross: number | null;
  totals: { calls: number; whatsapp: number; telegram: number };
  yesterday: { calls: number; whatsapp: number; telegram: number };
  agents: LiveAgent[];
  notCheckedIn: NotCheckedIn[];
}

interface Signed {
  userId: string;
  name: string;
  role: string;
  device: string | null;
  where: string | null;
  doing: string | null;
  live: boolean;
  lastSeen: string;
  lastSeenAt: string;
}

interface AttendanceDay {
  date: string;
  kind: 'office' | 'outside' | null;
  late: boolean;
}

interface AttendancePerson {
  userId: string;
  name: string;
  photoUrl: string | null;
  days: AttendanceDay[];
}

interface LeaveRow {
  id: string;
  userId: string;
  userName?: string;
  kind: string;
  fromDate: string;
  toDate: string;
  status: string;
}

interface AttendanceTeam {
  to: string;
  dates: Array<{ date: string; closed: boolean }>;
  people: AttendancePerson[];
  leave: LeaveRow[];
}

/**
 * `/api/activity/insight`.
 *
 * A line is `{ kind, text }` — a problem, a counted fact or good news. Older
 * callers of this endpoint are served plain strings, so both are read here
 * rather than letting the line render as an empty paragraph.
 */
type InsightLine = string | { kind?: string; text?: string };

interface Insight {
  quiet: boolean;
  source: string;
  lines: InsightLine[];
}

function lineText(line: InsightLine | undefined): string | null {
  if (typeof line === 'string') return line.trim() || null;
  return line?.text?.trim() || null;
}

/* ── small helpers ─────────────────────────────────────────────────────── */

/** "10:00" from the hour number, as the chart labels it. */
function clock(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * What somebody is doing, from the screen they are on.
 *
 * The heartbeat records the path and nothing else, so this is as far as the
 * truth goes. Anything not listed is "In the CRM" rather than a guess.
 */
const DOING: Array<{ path: string; word: string }> = [
  { path: '/v2/calling', word: 'On the dialler' },
  { path: '/v2/incoming', word: 'Taking a new lead' },
  { path: '/v2/leads/', word: 'Reading a lead' },
  { path: '/v2/leads', word: 'Going through leads' },
  { path: '/v2/pipeline', word: 'On the pipeline' },
  { path: '/v2/inbox', word: 'In the inbox' },
  { path: '/v2/email', word: 'Writing an email' },
  { path: '/v2/tasks', word: 'On their tasks' },
  { path: '/v2/calendar', word: 'In the calendar' },
  { path: '/v2/projects', word: 'In the projects' },
  { path: '/v2/offers', word: 'On a sales offer' },
  { path: '/v2/transfers', word: 'On a transfer' },
  { path: '/v2/wall', word: 'On the team wall' },
  { path: '/v2/team', word: 'Looking at the team' },
  { path: '/v2', word: 'On their day' },
  { path: '/leads', word: 'Going through leads' },
  { path: '/inbox', word: 'In the inbox' },
];

function doingWord(path: string | null): string {
  if (!path) return 'In the CRM';
  for (const one of DOING) if (path.startsWith(one.path)) return one.word;
  return 'In the CRM';
}

/** How long ago, in the design's own words. */
function sinceWord(iso: string | null): string {
  if (!iso) return 'no clicks yet';
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? '1 h ago' : `${hours} h ago`;
}

/**
 * Today against yesterday *by this time of day*, which is what the endpoint
 * sends. `word` is the headline figure's phrase; `brief` is what fits beside
 * the two smaller ones, as the design has it.
 */
function move(today: number, before: number): {
  word: string; brief: string; dir: '' | 'd-up' | 'd-down';
} {
  if (before === 0) {
    if (today === 0) return { word: 'none yet today', brief: 'none yet', dir: '' };
    return { word: 'none by now yesterday', brief: 'new today', dir: 'd-up' };
  }
  const percent = Math.round(((today - before) / before) * 100);
  if (percent === 0) return { word: 'same as yesterday', brief: 'same', dir: '' };
  const sign = percent > 0 ? '+' : '';
  return {
    word: `${sign}${percent}% vs yesterday`,
    brief: `${sign}${percent}%`,
    dir: percent > 0 ? 'd-up' : 'd-down',
  };
}

/**
 * The design's sparkline, drawn the way `design/web/app.js` draws it.
 *
 * Written out here rather than reusing the live app's `Spark`, which paints
 * its own classes and colours; `.d-spark` styles a `path`, a `polyline` and a
 * `circle`, and this is that markup.
 */
function HourSpark({ values, label }: { values: number[]; label: string }) {
  const W = 72;
  const H = 22;
  if (values.length < 2) return <svg className="d-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden />;

  const top = Math.max(...values);
  const low = Math.min(...values);
  const span = top - low || 1;
  const points = values.map((value, i) => [
    (i / (values.length - 1)) * (W - 6) + 3,
    H - 4 - ((value - low) / span) * (H - 8),
  ] as const);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1] as readonly [number, number];

  return (
    <svg
      className={top === 0 ? 'd-spark d-flat' : 'd-spark'}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      focusable={false}
    >
      <path d={`M${line.replace(/ /g, ' L')} L${W - 3},${H} L3,${H} Z`} />
      <polyline points={line} vectorEffect="non-scaling-stroke" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.4" />
    </svg>
  );
}

/**
 * Whether this is a phone, in markup rather than in a stylesheet. The tiles
 * across the top carry a different comparison word at 390px, and a
 * stylesheet cannot change what a word says.
 */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width:767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width:767px)');
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/** The coloured ring on an avatar, by where somebody is today. */
function Face({ name, photoUrl, where }: { name: string; photoUrl: string | null; where: string }) {
  const ring = where === 'office' ? 'v2-face-office'
    : where === 'outside' ? 'v2-face-outside'
      : where === 'leave' ? 'v2-face-leave'
        : where === 'late' ? 'v2-live-face-late' : '';
  return (
    <span className={`v2-face ${ring}`}>
      <Avatar name={name} src={photoUrl ?? undefined} size={32} />
    </span>
  );
}

type Kind = 'calls' | 'whatsapp';
type Band = 'office' | 'late' | 'outside' | 'leave' | 'absent';

/** The five states of a day, in the design's order and its colours. */
const BANDS: Array<{ key: Band; colour: string; word: string }> = [
  { key: 'office', colour: 'd-green', word: 'In office' },
  { key: 'late', colour: 'd-amber', word: 'Late' },
  { key: 'outside', colour: 'd-blue', word: 'Outside' },
  { key: 'leave', colour: 'd-violet', word: 'Leave' },
  { key: 'absent', colour: 'd-red', word: 'Not marked' },
];

/* ── the screen ────────────────────────────────────────────────────────── */

export function V2Live() {
  /*
   * `OwnerLive.dc.html` opens with "Team live" over "Owner view · updated
   * 10 sec ago"; `design/web/team-live.html` writes "What the team does right
   * now". The computer design wins. How often it is counted again is on the
   * page itself, beside the numbers it applies to.
   */
  usePhoneHead({ title: 'Team live', sub: liveSub() });
  const isPhone = useIsPhone();
  const { user } = useAuth();
  const canSee = user?.role === 'owner' || user?.role === 'admin';

  /* "Live" has to mean something, so the clicks and who is signed in are
     asked for again every half minute. Attendance and the line at the top
     are a morning's facts and are read once. */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!canSee) return undefined;
    const timer = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [canSee]);

  const live = useAsync<TeamLive>(() => api.get('/api/v2/live'), [tick, canSee]);
  const signed = useAsync<{ items: Signed[] }>(() => api.get('/api/activity/team'), [tick, canSee]);
  const marks = useAsync<AttendanceTeam>(() => api.get('/api/v2/attendance/team'), [canSee]);
  const insight = useAsync<Insight>(() => api.get('/api/activity/insight'), [canSee]);

  const [kind, setKind] = useState<Kind>('calls');

  /* The design's bars grow from nothing on arrival: `d-grow-in` pins them at
     zero height and the design's own script takes it off a moment later. */
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setGrown(true), 80);
    return () => window.clearTimeout(timer);
  }, []);

  /* Which rows have clicked since the last refresh, so the table shows it
     moving rather than silently changing numbers. */
  const seen = useRef<Map<string, string>>(new Map());
  const [fresh, setFresh] = useState<string[]>([]);
  useEffect(() => {
    const agents = live.data?.agents;
    if (!agents) return undefined;
    const moved: string[] = [];
    const first = seen.current.size === 0;
    for (const agent of agents) {
      const last = agent.lastClickAt ?? '';
      if (!first && last && seen.current.get(agent.userId) !== last) moved.push(agent.userId);
      seen.current.set(agent.userId, last);
    }
    if (moved.length === 0) return undefined;
    setFresh(moved);
    const timer = window.setTimeout(() => setFresh([]), 1400);
    return () => window.clearTimeout(timer);
  }, [live.data]);

  /* Where everybody is today, from the last day of the attendance window. */
  const today = useMemo(() => {
    const out = new Map<string, { where: string; name: string; photoUrl: string | null; back: string | null }>();
    const month = marks.data;
    if (!month) return out;
    const date = month.to;
    const onLeave = new Map<string, LeaveRow>();
    for (const row of month.leave) {
      if (row.status !== 'approved') continue;
      if (row.fromDate <= date && row.toDate >= date) onLeave.set(row.userId, row);
    }
    const closed = month.dates[month.dates.length - 1]?.closed ?? false;
    for (const person of month.people) {
      const day = person.days.find((one) => one.date === date);
      const leave = onLeave.get(person.userId);
      const where = day?.kind === 'office' ? (day.late ? 'late' : 'office')
        : day?.kind === 'outside' ? 'outside'
          : leave ? 'leave'
            : closed ? 'closed' : 'absent';
      out.set(person.userId, {
        where,
        name: person.name,
        photoUrl: person.photoUrl,
        back: leave ? leave.toDate : null,
      });
    }
    return out;
  }, [marks.data]);

  if (!canSee) {
    return (
      <div className="v2-live p-team-live">
        <ErrorNote>This screen is for the owner and admins.</ErrorNote>
      </div>
    );
  }

  if (live.error) return <ErrorNote>{live.error}</ErrorNote>;
  if (!live.data) return <Spinner />;

  const data = live.data;
  const people = signed.data?.items ?? [];
  const online = people.filter((one) => one.live);
  const idle = people.length - online.length;

  const shown = [...people].sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
  });

  const hours = data.hours;
  const biggest = Math.max(1, ...hours.map((one) => one[kind]));
  const done = hours.filter((one) => !one.future);
  const best = done.reduce<LiveHour | null>(
    (top, one) => (top === null || one[kind] > top[kind] ? one : top), null,
  );
  /* This hour is the last one that has started: the design paints it orange
     and puts the dashed "now" marker over it. */
  const nowHour = done[done.length - 1] ?? null;

  const calls = move(data.totals.calls, data.yesterday.calls);
  const whatsapp = move(data.totals.whatsapp, data.yesterday.whatsapp);
  const telegram = move(data.totals.telegram, data.yesterday.telegram);

  /* The one line worth acting on: a problem if the server found one, else
     the first thing it counted. Gemini may reword these; it never writes a
     number into them. */
  const said = insight.data?.lines ?? [];
  const line = lineText(said.find((one) => typeof one !== 'string' && one.kind === 'problem'))
    ?? lineText(said[0]);

  const away = [...today.entries()]
    .filter(([, one]) => one.where === 'absent' || one.where === 'leave')
    .slice(0, 4);

  const clicked = new Map(data.agents.map((one) => [one.userId, one]));

  const counts = {
    office: [...today.values()].filter((one) => one.where === 'office').length,
    late: [...today.values()].filter((one) => one.where === 'late').length,
    outside: [...today.values()].filter((one) => one.where === 'outside').length,
    leave: [...today.values()].filter((one) => one.where === 'leave').length,
    absent: [...today.values()].filter((one) => one.where === 'absent').length,
  };
  const marked = counts.office + counts.late + counts.outside + counts.leave + counts.absent;

  return (
    <div className="v2-live p-team-live">
      <div className="d-filters">
        <div className="d-seg">
          <Link to="/v2/activity">Activity</Link>
          <Link to="/v2/team-live" className="d-on">Live</Link>
          <Link to="/v2/messaging">Messaging</Link>
        </div>
        <span className="d-grow" />
        <span className="v2-live-stamp">Live · {data.now}</span>
      </div>

      {line && (
        <div className="d-ai-line d-fade-in">
          <span className="d-ai-tag"><Icon name="sparkles" size={14} />Homes AI</span>
          <p>{line}</p>
          <Link className="d-btn d-sm d-ghost" to="/v2/activity">
            The full report <Icon name="arrow-right" size={14} />
          </Link>
        </div>
      )}

      <div className="d-bento d-row1">
        {/* ── Right now ─────────────────────────────────────────────── */}
        <section className="d-card d-hero d-c-5" aria-label="Right now">
          <div className="d-hero-top d-row d-gap-16">
            <b className="d-num-hero">{online.length}</b>
            <div className="d-grow">
              <h2 className="v2-live-hero-title">Right now · {online.length} online</h2>
              <p className="d-muted d-small">
                {people.length === 0
                  ? 'Nobody has the CRM open'
                  : `Of ${people.length} signed in · ${idle} idle`}
              </p>
            </div>
            <span className="d-hero-chip">Live</span>
          </div>
          <div className="d-now-list">
            {shown.length === 0 && (
              <p className="d-muted d-small v2-live-empty">
                Nobody is signed in. The list fills as people open the CRM.
              </p>
            )}
            {shown.map((one) => (
              <Link
                className={one.live ? 'd-now-row d-fresh' : 'd-now-row'}
                to={`/v2/team/${one.userId}`}
                key={one.userId}
              >
                <Face
                  name={one.name}
                  photoUrl={today.get(one.userId)?.photoUrl ?? null}
                  where={today.get(one.userId)?.where ?? ''}
                />
                <span className="d-grow">
                  <b>{one.name}</b>
                  <span>{one.live ? doingWord(one.doing) : 'Away from the CRM'}</span>
                </span>
                <span className="d-ago">{one.live ? 'now' : one.lastSeen}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Clicks today ──────────────────────────────────────────── */}
        <section className="d-card d-c-7" aria-label="Clicks today">
          <div className="d-card-head">
            <h3>Clicks today</h3>
            <div className="d-seg d-sm" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={kind === 'calls'}
                className={kind === 'calls' ? 'd-on' : undefined}
                onClick={() => setKind('calls')}
              >
                Calls
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={kind === 'whatsapp'}
                className={kind === 'whatsapp' ? 'd-on' : undefined}
                onClick={() => setKind('whatsapp')}
              >
                WhatsApp
              </button>
            </div>
            <Link className="d-card-link" to="/v2/messaging">
              Messaging report <Icon name="arrow-right" size={14} />
            </Link>
          </div>

          <div className="d-trio">
            <div className="d-stat">
              <div className="d-stat-row">
                <b className="d-num-hero">{data.totals.calls}</b>
                {/* "+12% vs yesterday" is two lines in a 99px tile, which
                    pushes "Call clicks" a line below the other two labels.
                    The design has no comparison on these tiles at all, so
                    the short form is the closer of the two. */}
                <span className={`d-delta ${calls.dir}`}>{isPhone ? calls.brief : calls.word}</span>
              </div>
              <span className="d-label">Call clicks</span>
            </div>
            <Link className="d-stat" to="/v2/messaging">
              <div className="d-stat-row">
                <b className="d-num">{data.totals.whatsapp}</b>
                <span className={`d-delta ${whatsapp.dir}`}>{whatsapp.brief}</span>
              </div>
              <span className="d-label">WhatsApp clicks</span>
            </Link>
            <Link className="d-stat" to="/v2/messaging">
              <div className="d-stat-row">
                <b className="d-num">{data.totals.telegram}</b>
                <span className={`d-delta ${telegram.dir}`}>{telegram.brief}</span>
              </div>
              <span className="d-label">Telegram clicks</span>
            </Link>
          </div>

          <div
            className={grown ? 'd-bars d-id-hours' : 'd-bars d-grow-in d-id-hours'}
            style={{ '--max': biggest } as CSSProperties}
          >
            {hours.map((one) => {
              const value = one[kind];
              const classes = ['d-bar-col'];
              if (one.future) classes.push('d-future');
              else {
                if (best && one.hour === best.hour && value > 0) classes.push('d-best');
                if (nowHour && one.hour === nowHour.hour) classes.push('d-now');
              }
              return (
                <div className={classes.join(' ')} key={one.hour}>
                  <div className="d-bar-track">
                    {one.future
                      ? <i />
                      : <i style={{ '--v': value } as CSSProperties} data-val={value} />}
                  </div>
                  <span className="d-bar-lab">{String(one.hour).padStart(2, '0')}</span>
                </div>
              );
            })}
            {data.nowAcross !== null && (
              <div
                className="d-bars-now"
                style={{ '--x': `${(data.nowAcross * 100).toFixed(1)}%` } as CSSProperties}
              >
                <span>now</span>
              </div>
            )}
          </div>

          <div className="d-card-foot">
            <Icon name="info" size={14} />
            <span>A click is counted when an agent presses Call, WhatsApp or Telegram on a lead.</span>
            <span className="d-right">
              {best && best[kind] > 0
                ? <>Best hour <b className="d-ink-2">{clock(best.hour)}</b></>
                : <>No clicks yet today</>}
            </span>
          </div>
        </section>
      </div>

      <div className="d-bento d-mt-16">
        {/* ── Today by agent ───────────────────────────────────────── */}
        <section className="d-card d-c-8" aria-label="Today by agent">
          <div className="d-card-head">
            <h3>Today by agent</h3>
            <span className="d-small d-muted">Counted again every 30 seconds</span>
          </div>
          {/* Not `d-table-wrap`: that is a card of its own, and this table is
              already inside one. The wrapper is here so seven columns scroll
              on a phone rather than pushing the page sideways. */}
          <div className="v2-live-table">
            <table className="d-table d-id-agents v2-d-cards">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Doing now</th>
                  <th className="d-t-right">Calls</th>
                  <th className="d-t-right">WhatsApp</th>
                  <th className="d-t-right">Telegram</th>
                  <th>By hour</th>
                  <th className="d-t-right">Last click</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((agent) => {
                  const here = people.find((one) => one.userId === agent.userId);
                  return (
                    <tr
                      key={agent.userId}
                      className={fresh.includes(agent.userId) ? 'v2-live-flash' : undefined}
                    >
                      <td>
                        <Link className="d-person" to={`/v2/team/${agent.userId}`}>
                          <Avatar name={agent.name} src={agent.photoUrl ?? undefined} size={26} />
                          <b>{agent.name}</b>
                        </Link>
                      </td>
                      <td className="d-t-sub">
                        {here?.live
                          ? doingWord(here.doing)
                          : whereWord(today.get(agent.userId)?.where)}
                      </td>
                      <td className="d-t-right d-cellnum" data-label="Calls">{agent.calls}</td>
                      <td className="d-t-right" data-label="WhatsApp">{agent.whatsapp}</td>
                      <td className="d-t-right" data-label="Telegram">
                        {agent.telegram || <span className="d-muted">0</span>}
                      </td>
                      <td>
                        <HourSpark
                          values={agent.spark}
                          label={`${agent.name}: clicks by hour today`}
                        />
                      </td>
                      <td className="d-t-right d-t-sub" data-label="Last click">{sinceWord(agent.lastClickAt)}</td>
                    </tr>
                  );
                })}
                {data.agents.length === 0 && (
                  <tr><td colSpan={7} className="d-t-sub">Nobody works leads yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <div className="d-stack d-c-4">
          {/* ── Attendance ─────────────────────────────────────────── */}
          <section className="d-card" aria-label="Attendance">
            <div className="d-card-head">
              <h3>Attendance</h3>
              <Link className="d-card-link" to="/v2/attendance">
                Open <Icon name="arrow-right" size={14} />
              </Link>
            </div>

            {marks.error && <p className="d-muted d-small">{marks.error}</p>}
            {!marks.error && marked === 0 && (
              <p className="d-muted d-small">Nobody is asked to check in today.</p>
            )}
            {marked > 0 && (
              <>
                <div className="d-segbar d-tall">
                  {BANDS.filter((band) => counts[band.key] > 0).map((band) => (
                    <i
                      key={band.key}
                      className={band.colour}
                      data-tip={`${counts[band.key]} ${band.word.toLowerCase()}`}
                      style={{ '--v': counts[band.key] } as CSSProperties}
                    />
                  ))}
                </div>
                <div className="d-legend d-mt-12">
                  {BANDS.map((band) => (
                    <span key={band.key}>
                      <span className={`d-dot ${band.colour}`} />
                      <b>{counts[band.key]}</b> {band.word}
                    </span>
                  ))}
                </div>
              </>
            )}

            {away.length > 0 && (
              <div className="d-divide d-mt-12">
                {away.map(([userId, one]) => (
                  <div className="d-away" key={userId}>
                    <Face name={one.name} photoUrl={one.photoUrl} where={one.where} />
                    <span className="d-grow">
                      <b className="d-bold">{one.name}</b>
                      <div className="d-small d-muted">
                        {one.where === 'leave'
                          ? `On leave · back after ${one.back ?? 'their leave'}`
                          : `Not marked in · ${(clicked.get(userId)?.calls ?? 0) === 0
                            ? 'no calls today'
                            : `${clicked.get(userId)?.calls} calls today`}`}
                      </div>
                    </span>
                    <Link className="d-btn d-sm" to={`/v2/leads?agent=${userId}`}>Their leads</Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Called before checking in ──────────────────────────── */}
          <section className="d-card v2-live-flagged" aria-label="Calls marked not checked in">
            <div className="d-card-head d-mb-0"><h3>Calls marked “not checked in”</h3></div>
            <div className="d-row d-gap-16 d-mt-8">
              <b className="d-num">
                {data.notCheckedIn.reduce((sum, one) => sum + one.calls, 0)}
              </b>
              <span className="d-small d-muted">
                {data.notCheckedIn.length === 0
                  ? 'Everybody marked themselves in before their first call today.'
                  : data.notCheckedIn.map((one) => (
                    <span className="v2-live-flagged-line" key={one.userId}>
                      {one.name} called {one.calls === 1 ? '1 lead' : `${one.calls} leads`} at{' '}
                      {one.times.join(' and ')}
                      {one.checkedInAt
                        ? `, before checking in at ${hhmm(one.checkedInAt)}.`
                        : ', and has not checked in at all today.'}
                    </span>
                  ))}
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Where somebody is, for the "Doing now" column when the CRM is shut. */
function whereWord(where: string | undefined): string {
  if (where === 'outside') return 'Working outside';
  if (where === 'leave') return 'On leave';
  if (where === 'absent') return 'Not marked in';
  return 'Not signed in';
}

/** A timestamp as Dubai's clock reads it. */
function hhmm(iso: string): string {
  const at = new Date(Date.parse(iso) + 4 * 3_600_000);
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
}
