import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, ErrorNote, Spinner, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';

/**
 * The full dashboard — `design/web/dashboard.html`, page 32.
 *
 * The owner's home answers "what needs me now". This answers "how are we
 * doing": totals, the stage strip, a fortnight of new leads, the projects and
 * sources behind them, every agent in one table, and the leads going cold.
 *
 * Two rules from the design, both easy to get wrong:
 *
 *  - **The period switch moves calls, meetings and units only.** How many
 *    leads exist and what stage they are in are facts about now. An owner who
 *    picks "Year" and watches the lead total change has been told something
 *    untrue.
 *  - **Lost is drawn outside the stage strip.** A pipeline that counts its
 *    dead is not a pipeline.
 *
 * One honest departure from the design. Its hero card is headed "Homes AI ·
 * Morning brief" over a written-sounding sentence. What the server has is
 * `/api/activity/insight`, which counts facts and says so in its own answer:
 * "Counted from your own data". So the card carries that label and those
 * lines, and the three rows under it are the owner home's own "needs you now"
 * list — real work, each with somewhere to go. Nothing here is a machine's
 * opinion dressed as one, and nothing is invented.
 */

/** Under this, the phone layout. See the note in `Leads.tsx` about the copy. */
const PHONE = 768;

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${PHONE - 1}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${PHONE - 1}px)`);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

interface AgentRow {
  userId: string;
  name: string;
  photoUrl: string | null;
  marked: string | null;
  wasLate: boolean;
  onLeave: boolean;
  calls: number;
  meetings: number;
  units: number;
  callsPerDay: number[];
  open: number;
  overdue: number;
  deskMax: number | null;
  deskName: string | null;
}

interface BriefRow {
  kind: 'leave' | 'overload' | 'untouched';
  text: string;
  sub: string;
  action: string;
  to: string;
  move: { userId: string; name: string; leads: number } | null;
}

interface Assignable {
  userId: string;
  name: string;
  openLeads: number;
  where: string;
  canTake: boolean;
}

interface ColdAgent {
  userId: string;
  name: string;
  marked: string | null;
  onLeave: boolean;
  leads: number;
  cold: number;
}

interface Dash {
  period: Period;
  days: number;
  now: string;
  totals: {
    all: number; open: number; lost: number; untouched: number;
    newToday: number; newTodayDelta: number;
  };
  work: {
    calls: number; callsPrevious: number;
    meetings: number; meetingsPrevious: number;
    units: number; unitsValueAed: number | null;
    touchedIn2hPct: number | null; touchedIn2hOf: number;
    firstAnswerMinutes: number | null;
  };
  stages: Array<{ key: string; label: string; tone: string; n: number; pct: number }>;
  lost: { n: number; pct: number };
  perDay: {
    total: number; previous: number;
    days: Array<{ date: string; label: string; n: number; weekend: boolean }>;
  };
  projects: Array<{ name: string; n: number; won: number }>;
  sources: Array<{ key: string; n: number }>;
  teamToday: {
    inOffice: number; late: number; outside: number; leave: number; absent: number;
    closed: boolean;
  };
  agents: AgentRow[];
  cold: { total: number; agents: ColdAgent[] };
  brief: BriefRow[];
  desks: Array<{ name: string; maxOpenLeads: number | null }>;
  assignable: Assignable[];
}

/**
 * What `/api/activity/insight` really sends.
 *
 * `lines` are `{ kind, text }`, not strings — `server/src/activity/owner-
 * summary.ts`. A preview mock that sends strings renders empty paragraphs
 * against the real server, which is how this was nearly shipped.
 */
interface Insight {
  lines: Array<{ kind: 'problem' | 'number' | 'good'; text: string }>;
  quiet: boolean;
  source: string;
}

type Period = 'today' | 'week' | 'month' | 'year';

const PERIODS: Array<{ key: Period; label: string; against: string }> = [
  { key: 'today', label: 'Today', against: 'vs yesterday' },
  { key: 'week', label: 'Week', against: 'vs the week before' },
  { key: 'month', label: 'Month', against: 'vs the 30 days before' },
  { key: 'year', label: 'Year', against: 'vs the year before' },
];

/**
 * The icon tile beside each row of the brief.
 *
 * `dashboard.html`'s own three: the warning triangle on somebody away, the
 * people on somebody carrying too much, and the clock on leads nobody has
 * touched.
 */
const BRIEF_ICON: Record<BriefRow['kind'], IconName> = {
  leave: 'alert-triangle',
  overload: 'users',
  untouched: 'clock',
};

/** What the team card calls itself, by window. */
const TEAM_TITLE: Record<Period, string> = {
  today: 'Team today',
  week: 'Team this week',
  month: 'Team this month',
  year: 'Team this year',
};

/**
 * The five states of a day, in the design's order and its colours.
 *
 * Each one also names the filter it opens attendance on, so the bar and the
 * legend lead somewhere rather than to the whole month.
 */
const BANDS: Array<{
  key: string; colour: string; word: string; of: (t: Dash['teamToday']) => number;
}> = [
  { key: 'office', colour: 'd-green', word: 'In office', of: (t) => t.inOffice },
  { key: 'late', colour: 'd-amber', word: 'Late', of: (t) => t.late },
  { key: 'outside', colour: 'd-blue', word: 'Outside', of: (t) => t.outside },
  { key: 'leave', colour: 'd-violet', word: 'Leave', of: (t) => t.leave },
  { key: 'absent', colour: 'd-red', word: 'Absent', of: (t) => t.absent },
];

/** Where an owner may send one agent's open leads. */
type MoveTo =
  | { kind: 'pool' }
  | { kind: 'agent'; userId: string }
  | { kind: 'share'; userIds: string[] };

/** The source names agents use, for the Sources card. */
const SOURCE_LABEL: Record<string, string> = {
  meta_lead_ads: 'Meta form',
  meta_ctwa: 'WhatsApp ad',
  whatsapp_direct: 'WhatsApp',
  google_ads: 'Google Ads',
  website: 'Website',
  csv_import: 'Imported',
  manual: 'Added by hand',
  unknown: 'Not recorded',
};

const money = (fils: number): string => `AED ${fils.toLocaleString('en-AE')}`;

/** A whole number with thousands separators, which is how money reads here. */
const count = (n: number): string => n.toLocaleString('en-AE');

function Delta({ n, note }: { n: number; note?: string }) {
  if (n === 0) return <span className="d-delta">{note ?? 'no change'}</span>;
  return (
    <span className={n > 0 ? 'd-delta d-up' : 'd-delta d-down'}>
      {Math.abs(n)}{note ? ` ${note}` : ''}
    </span>
  );
}

/** The same pill, as a percentage of what came before. */
function Pct({ now, before, note }: { now: number; before: number; note: string }) {
  if (before === 0) {
    return <span className="d-delta">{now === 0 ? `nothing ${note}` : `nothing ${note}`}</span>;
  }
  const move = Math.round(((now - before) / before) * 100);
  if (move === 0) return <span className="d-delta">the same {note}</span>;
  return (
    <span className={move > 0 ? 'd-delta d-up' : 'd-delta d-down'}>
      {Math.abs(move)}% {note}
    </span>
  );
}

/**
 * A week of calls as a line.
 *
 * Drawn as an inline SVG polyline because that is what the design's `.d-spark`
 * styles: it sets `stroke` and `fill:none` on a `polyline` inside an element
 * 72 by 22. A flat week draws a flat line rather than nothing.
 */
function Spark({ days }: { days: number[] }) {
  if (days.length === 0) return null;
  const top = Math.max(...days, 1);
  const step = days.length > 1 ? 70 / (days.length - 1) : 0;
  const points = days
    .map((n, i) => `${(i * step + 1).toFixed(1)},${(20 - (n / top) * 18).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="d-spark" viewBox="0 0 72 22" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

export function V2Dashboard() {
  const isPhone = useIsPhone();
  const { user } = useAuth();
  const canSee = user?.role === 'owner' || user?.role === 'admin';
  const [period, setPeriod] = useState<Period>('today');
  const [moving, setMoving] = useState(false);
  const [moved, setMoved] = useState<string[]>([]);
  /* Who the Move dialog is open about, or null when it is shut. */
  const [movingWho, setMovingWho] = useState<{ userId: string; name: string; leads: number } | null>(null);
  const toast = useToast();

  const got = useAsync<Dash>(() => api.get(`/api/v2/dashboard?period=${period}`), [period]);
  /* The line at the top of the brief. The card is useful without it, so it is
     read separately and simply shows less when it is quiet. */
  const insight = useAsync<Insight>(() => api.get('/api/activity/insight'), []);

  async function move(
    who: { userId: string; name: string; leads: number },
    to: MoveTo,
  ) {
    setMoving(true);
    try {
      const answer = await api.post<{ moved: number; name: string | null; to: string }>(
        '/api/v2/dashboard/move', { userId: who.userId, to },
      );
      setMoved((was) => [...was, who.userId]);
      setMovingWho(null);
      toast(
        answer.moved === 0
          ? `${who.name} has no open leads to move.`
          : `${answer.moved} ${answer.moved === 1 ? 'lead' : 'leads'} moved from ${who.name} `
            + `to ${answer.to}${to.kind === 'pool' ? ' · free for every agent' : ''}.`,
      );
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Those leads did not move.');
    } finally {
      setMoving(false);
    }
  }

  /**
   * The Totals card's Download button.
   *
   * A CSV of what is on the screen, built in the browser from the figures
   * already loaded — nothing is asked of the server and nothing is rounded on
   * the way out, so the file and the page always agree.
   */
  function download(d: Dash) {
    const lines: string[][] = [
      ['Homes CRM — dashboard', d.now],
      ['Period', period],
      [],
      ['All leads', String(d.totals.all)],
      ['Open', String(d.totals.open)],
      ['Lost', String(d.totals.lost)],
      ['Untouched', String(d.totals.untouched)],
      ['New today', String(d.totals.newToday)],
      ['Call clicks', String(d.work.calls)],
      ['Meetings booked', String(d.work.meetings)],
      ['Units booked', String(d.work.units)],
      [],
      ['Stage', 'Leads', 'Share'],
      ...d.stages.map((s) => [s.label, String(s.n), `${s.pct}%`]),
      ['Lost', String(d.lost.n), `${d.lost.pct}%`],
      [],
      ['Agent', 'Calls', 'Meetings', 'Units', 'Open', 'Desk max', 'Overdue'],
      ...d.agents.map((a) => [
        a.name, String(a.calls), String(a.meetings), String(a.units),
        String(a.open), a.deskMax === null ? '' : String(a.deskMax), String(a.overdue),
      ]),
    ];
    const csv = lines
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `dashboard-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast(`Saved as ${link.download}.`);
  }

  /*
   * §1.4: the title and the live line go in the shell's header. The design's
   * sub is the company's name and "all leads"; the company's name is not on
   * this payload, so this says what the page is instead of hard-coding a
   * brand into a screen — `docs/v2/phone-questions-a.md`.
   */
  /*
   * `OwnerDashboard.dc.html` draws the compact header — a 17px centred title
   * between the back button and one round action, which on this screen goes
   * to Team live — because the screen under it is a long column of cards
   * that wants the height.
   */
  usePhoneHead({
    title: 'Dashboard',
    sub: 'Every agent · lead totals are always now',
    compact: true,
    action: { icon: 'monitor', label: 'Team live', to: '/v2/team-live' },
  });

  if (!canSee) {
    return (
      <div className="p-dashboard">
        <ErrorNote>The full dashboard is for the owner and admins.</ErrorNote>
      </div>
    );
  }

  const d = got.data;
  const against = PERIODS.find((one) => one.key === period)?.against ?? '';
  /*
   * Three rows, never four.
   *
   * The design's hero is a fixed 336px (`.d-row1 {grid-template-rows:336px}`)
   * and three rows is what fits. A fourth is drawn half-height with its text
   * cut off, which looks like a bug rather than a list.
   */
  const brief = (d?.brief ?? []).slice(0, 3);

  return (
    <div className="p-dashboard">
      <div className="d-filters">
        <div className="d-seg" role="tablist" aria-label="Period">
          {PERIODS.map((one) => (
            <button
              key={one.key}
              type="button"
              role="tab"
              aria-selected={period === one.key}
              className={period === one.key ? 'd-on' : undefined}
              onClick={() => setPeriod(one.key)}
            >
              {one.label}
            </button>
          ))}
        </div>
        <span className="d-grow" />
        <span className="d-small d-muted">
          {d ? `Live · ${d.now}` : 'Calls, meetings and units follow the period'}
        </span>
      </div>

      {got.error && <ErrorNote>{String(got.error)}</ErrorNote>}
      {!d && !got.error && <Spinner />}

      {d && (
        <>
          {/* ── row 1: the brief, and the totals ──────────────────────── */}
          <div className="d-bento d-row1">
            <section className="d-card d-hero d-c-5" aria-label="What yesterday looked like">
              <div className="d-brief-top">
                <span className="d-brief-tag">
                  <Icon name="sparkles" />
                  {insight.data?.source ?? 'Counted from your own data'}
                </span>
                <span className="d-grow" />
                <span className="d-hero-chip">{d.now}</span>
              </div>

              <p className="d-brief-say">
                {insight.data && insight.data.lines.length > 0
                  ? insight.data.lines[0]?.text
                  : `${count(d.work.calls)} calls and ${count(d.work.meetings)} meetings `
                    + `${period === 'today' ? 'today' : `in the ${period}`}.`}
                {brief.length > 0 && (
                  <>
                    {' '}
                    <em>
                      {brief.length} {brief.length === 1 ? 'thing needs' : 'things need'} a
                      decision.
                    </em>
                  </>
                )}
              </p>

              <div className="d-arows">
                {brief.map((row) => (
                  <div className="d-arow" key={`${row.kind}-${row.to}`}>
                    <span className={row.kind === 'leave' ? 'd-arow-ic d-accent' : 'd-arow-ic'}>
                      <Icon name={BRIEF_ICON[row.kind]} />
                    </span>
                    <Link className="d-arow-txt" to={row.to}>
                      <b>{row.text}</b>
                      {/* The reason the row is here, not the button's own
                          word — which is what made the card read
                          "Move 31 / Move 31". */}
                      <span className="d-s">{row.sub}</span>
                    </Link>
                    {row.move
                      ? (
                        <button
                          type="button"
                          className="d-btn d-sm d-on-dark d-primary"
                          onClick={() => setMovingWho(row.move)}
                        >
                          {row.action}
                        </button>
                      )
                      : <Link className="d-btn d-sm d-on-dark" to={row.to}>{row.action}</Link>}
                  </div>
                ))}
                {brief.length === 0 && (
                  <div className="d-arow">
                    <span className="d-arow-ic"><Icon name="check" /></span>
                    <span className="d-arow-txt">
                      <b>Nothing needs a decision</b>
                      <span className="d-s">
                        Nobody is away with leads stranded, nobody is over their desk maximum
                        and every lead has been touched
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="d-card d-c-7" aria-label="Totals">
              <div className="d-card-head">
                <h3>Totals</h3>
                <span className="d-small d-muted">
                  Calls, meetings and units: <b className="d-ink-2">{period}</b>
                </span>
                <button type="button" className="d-btn d-xs" onClick={() => download(d)}>
                  <Icon name="download" />Download
                </button>
              </div>

              <div className="d-tot">
                <div className="d-stat">
                  <div className="d-stat-row">
                    <Link className="d-num-hero" to="/v2/leads?tab=all">{count(d.totals.all)}</Link>
                  </div>
                  <span className="d-label">
                    All leads · <Link to="/v2/leads?tab=lost">{count(d.totals.lost)} lost</Link>
                  </span>
                </div>
                <div className="d-stat">
                  <div className="d-stat-row">
                    <Link className="d-num" to="/v2/leads?tab=all">{count(d.totals.open)}</Link>
                  </div>
                  <span className="d-label">Open</span>
                </div>
                <div className="d-stat">
                  <div className="d-stat-row">
                    <Link
                      className={d.totals.untouched > 0 ? 'd-num d-t-red' : 'd-num'}
                      to="/v2/leads?tab=new"
                    >
                      {count(d.totals.untouched)}
                    </Link>
                  </div>
                  <span className="d-label">Untouched</span>
                </div>
                <div className="d-stat">
                  <div className="d-stat-row">
                    <Link className="d-num" to="/v2/leads?tab=today">{count(d.totals.newToday)}</Link>
                    <Delta n={d.totals.newTodayDelta} note="vs yesterday" />
                  </div>
                  <span className="d-label">New today</span>
                </div>
              </div>

              <div className="d-ptiles">
                <Link className="d-ptile" to="/v2/messaging">
                  <span className="d-k">Call clicks</span>
                  <b className="d-num-sm">{count(d.work.calls)}</b>
                  <Delta n={d.work.calls - d.work.callsPrevious} note={against} />
                </Link>
                <Link className="d-ptile" to="/v2/calendar">
                  <span className="d-k">Meetings booked</span>
                  <b className="d-num-sm">{count(d.work.meetings)}</b>
                  <Delta n={d.work.meetings - d.work.meetingsPrevious} note={against} />
                </Link>
                <Link className="d-ptile" to="/v2/wall">
                  <span className="d-k">Units booked</span>
                  <b className="d-num-sm">{count(d.work.units)}</b>
                  <span className="d-s">
                    {d.work.unitsValueAed ? money(d.work.unitsValueAed) : 'no value recorded'}
                  </span>
                </Link>
                <div
                  className="d-ptile"
                  title={d.work.touchedIn2hPct === null
                    ? 'No lead has arrived in this period yet'
                    : `${Math.round((d.work.touchedIn2hPct / 100) * d.work.touchedIn2hOf)} of the `
                      + `${count(d.work.touchedIn2hOf)} new leads in this period got a call or a `
                      + 'message inside 2 hours'}
                >
                  <span className="d-k">Touched in 2 h</span>
                  <b className="d-num-sm">
                    {d.work.touchedIn2hPct === null ? '—' : `${d.work.touchedIn2hPct}%`}
                  </b>
                  <span className="d-s">
                    {d.work.firstAnswerMinutes === null
                      ? `of ${count(d.work.touchedIn2hOf)} new leads`
                      : <>First click <b className="d-t-green">{d.work.firstAnswerMinutes} min</b></>}
                  </span>
                </div>
              </div>
            </section>
          </div>

          {/* ── row 2: by stage ───────────────────────────────────────── */}
          <section className="d-card d-mt-16 v2-dash-stages" aria-label="Leads by stage">
            <div className="v2-dash-stages-head">
              <h3>By stage</h3>
              <span className="d-small d-muted">Click a stage to open its list</span>
              <Link className="d-card-link d-mt-4" to="/v2/pipeline">
                Open pipeline <Icon name="arrow-right" />
              </Link>
            </div>
            <div className="d-pstrip">
              {d.stages.map((stage) => (
                <Link
                  key={stage.key}
                  className={`d-pstage d-${stage.tone}`}
                  style={{ ['--g' as string]: String(Math.max(stage.n, 1)) }}
                  to={`/v2/pipeline?stage=${stage.key}`}
                >
                  <span className="d-nm">{stage.label}</span>
                  <span className="d-ct"><b>{count(stage.n)}</b><span>{stage.pct}%</span></span>
                  <i />
                </Link>
              ))}
              <Link className="d-pstage d-lost" to="/v2/leads?tab=lost">
                <span className="d-nm">Lost · kept apart</span>
                <span className="d-ct"><b>{count(d.lost.n)}</b><span>{d.lost.pct}%</span></span>
                <i />
              </Link>
            </div>
          </section>

          {/* ── row 3: per day · by project · sources ─────────────────── */}
          <div className="d-bento d-mt-16">
            <section className="d-card d-c-5" aria-label="New leads per day">
              <div className="d-card-head">
                <h3>New leads per day</h3>
                <span className="d-small d-muted">14 days · imports not counted</span>
              </div>
              <div className="d-stat-row">
                <b className="d-num">{count(d.perDay.total)}</b>
                {/* A percentage, as the design writes it: "9% vs the 14 days
                    before". A bare count of twenty-one says nothing about
                    whether a fortnight was good. */}
                <Pct now={d.perDay.total} before={d.perDay.previous} note="vs the 14 days before" />
              </div>
              <div
                className="d-bars d-id-days"
                style={{ ['--max' as string]: String(Math.max(...d.perDay.days.map((x) => x.n), 1)) }}
              >
                {d.perDay.days.map((day, i) => (
                  <div
                    key={day.date}
                    className={[
                      'd-bar-col',
                      day.weekend ? 'd-we' : '',
                      i === d.perDay.days.length - 1 ? 'd-now' : '',
                    ].filter(Boolean).join(' ')}
                    title={`${day.n} on ${day.date}`}
                  >
                    <span className="d-bar-track">
                      <i style={{ ['--v' as string]: String(day.n) }} data-val={day.n || ''} />
                    </span>
                    <span className="d-bar-lab">{day.label}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="d-card d-c-4" aria-label="Leads by project">
              <div className="d-card-head">
                <h3>By project</h3>
                <Link className="d-card-link" to="/v2/projects/manage">
                  Manage <Icon name="arrow-right" />
                </Link>
              </div>
              <div className="d-hbars">
                {d.projects.map((project) => (
                  <div className="d-hbar d-prj" key={project.name}>
                    <Link to={`/v2/leads?project=${encodeURIComponent(project.name)}`}>
                      {project.name}
                    </Link>
                    <div
                      className="d-bar d-thick"
                      style={{
                        ['--v' as string]: `${Math.round(
                          (project.n / Math.max(d.projects[0]?.n ?? 1, 1)) * 100,
                        )}%`,
                      }}
                    >
                      <i />
                    </div>
                    <b>{count(project.n)}</b>
                    <span className="d-sub">
                      {/* "launching" is the design's own word for a project
                          that has leads and no deal yet — a dash reads as a
                          missing figure rather than a true nought. */}
                      {project.won > 0 ? `${project.won} won` : 'launching'}
                    </span>
                  </div>
                ))}
                {d.projects.length === 0 && (
                  <span className="d-small d-muted">No lead has a project on it yet.</span>
                )}
              </div>
              <div className="d-card-foot">
                <Icon name="info" />
                <span>Leads that agents work now. The others have no project yet.</span>
              </div>
            </section>

            <section className="d-card d-c-3" aria-label="Lead sources">
              <div className="d-card-head">
                <h3>Sources</h3>
                <span className="d-small d-muted">{count(d.totals.all)} leads</span>
              </div>
              <div className="d-hbars">
                {d.sources.map((source) => (
                  <div className="d-hbar d-src" key={source.key}>
                    <span>{SOURCE_LABEL[source.key] ?? source.key.replace(/_/g, ' ')}</span>
                    <div
                      className="d-bar"
                      style={{
                        ['--v' as string]: `${Math.round(
                          (source.n / Math.max(d.sources[0]?.n ?? 1, 1)) * 100,
                        )}%`,
                      }}
                    >
                      <i />
                    </div>
                    <b>{count(source.n)}</b>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ── row 4: the team, and what is going cold ───────────────── */}
          <div className="d-bento d-mt-16">
            <section className="d-card d-c-8" aria-label="Team today">
              <div className="d-card-head">
                <h3>{TEAM_TITLE[period]}</h3>
                <Link className="d-card-link" to="/v2/attendance">
                  Attendance <Icon name="arrow-right" />
                </Link>
              </div>

              {/* Each band and each legend entry carries `?show=`, so a
                  click opens attendance already filtered to the people it
                  counted rather than to everybody. */}
              <div className="d-att-head">
                <div className="d-segbar d-tall">
                  {BANDS.filter((band) => band.of(d.teamToday) > 0).map((band) => (
                    <Link
                      key={band.key}
                      className={band.colour}
                      style={{ ['--v' as string]: String(band.of(d.teamToday)) }}
                      to={`/v2/attendance?show=${band.key}`}
                      aria-label={`${band.of(d.teamToday)} ${band.word.toLowerCase()}`}
                    />
                  ))}
                </div>
                <div className="d-legend">
                  {BANDS.map((band) => (
                    <Link key={band.key} to={`/v2/attendance?show=${band.key}`}>
                      <span className={`d-dot ${band.colour}`} />
                      <b>{band.of(d.teamToday)}</b> {band.word}
                    </Link>
                  ))}
                </div>
              </div>

              {/*
                * On a phone this was a seven-column table whose last cell
                * ended 282px past the right edge, reachable only by dragging
                * inside the card with nothing saying so. `OwnerDashboard.dc
                * .html` draws five narrow columns that fit 390px — agent,
                * then four numbers — so that is what a phone gets. The two
                * that go are "Where", which the attendance strip above
                * already says, and the sparkline, which is unreadable at
                * that width.
                */}
              {isPhone
                ? (
                  <div className="v2-a-team">
                    <div className="v2-a-team-head">
                      <span className="v2-a-team-name">Agent</span>
                      <span>Open</span>
                      <span>Calls</span>
                      <span>Mtg</span>
                      <span>Overdue</span>
                    </div>
                    {d.agents.map((row) => (
                      <Link className="v2-a-team-row" key={row.userId} to={`/v2/team/${row.userId}`}>
                        <Avatar name={row.name} src={row.photoUrl ?? undefined} size={34} />
                        <span className="v2-a-team-name">{row.name}</span>
                        <span>{count(row.open)}</span>
                        <span>{count(row.calls)}</span>
                        <span className="v2-a-team-good">{count(row.meetings)}</span>
                        <span className={row.overdue > 0 ? 'v2-a-team-bad' : undefined}>
                          {count(row.overdue)}
                        </span>
                      </Link>
                    ))}
                    {d.agents.length === 0 && (
                      <p className="d-small d-muted">No agents yet.</p>
                    )}
                  </div>
                )
                : (
              <div className="v2-dash-scroll">
              <table className="d-table d-compact d-id-team">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Status</th>
                    <th>Calls {period === 'today' ? 'today' : `this ${period}`} · 7 days</th>
                    <th className="d-t-right">Meetings</th>
                    <th className="d-t-right">Units</th>
                    <th className="d-t-right">Open · desk max</th>
                    <th className="d-t-right">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {d.agents.map((row) => (
                    <tr key={row.userId}>
                      <td>
                        <Link className="v2-dash-who" to={`/v2/team/${row.userId}`}>
                          <Avatar name={row.name} src={row.photoUrl ?? undefined} />
                          <span>{row.name}</span>
                        </Link>
                      </td>
                      <td>
                        <span className={`d-chip d-att-${whereKey(row)}`}>{whereWord(row)}</span>
                      </td>
                      <td>
                        <span className="d-cell-bar">
                          <b>{count(row.calls)}</b>
                          <Spark days={row.callsPerDay} />
                        </span>
                      </td>
                      <td className="d-t-right">{count(row.meetings)}</td>
                      <td className="d-t-right">{count(row.units)}</td>
                      <td className="d-t-right">
                        {/* The desk maximum as the small line on the bar, and
                            the figure red once it is past. A plain number says
                            nothing about whether it is too many. */}
                        <Link
                          className={row.open > (row.deskMax ?? Infinity)
                            ? 'd-overdue' : undefined}
                          to={`/v2/leads?tab=all&agent=${row.userId}`}
                          title={row.deskMax === null
                            ? 'No desk maximum set'
                            : `Desk maximum ${row.deskMax} · ${row.deskName}`}
                        >
                          {count(row.open)}
                        </Link>
                      </td>
                      <td className="d-t-right">
                        {row.overdue > 0
                          ? (
                            <Link
                              className="d-overdue"
                              to={`/v2/leads?tab=overdue&agent=${row.userId}`}
                            >
                              {count(row.overdue)}
                            </Link>
                          )
                          : <span className="d-muted">0</span>}
                      </td>
                    </tr>
                  ))}
                  {d.agents.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <span className="d-small d-muted">No agents yet.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>
                )}

              <div className="d-card-foot">
                <Icon name="info" />
                <span>
                  Most calls first. Calls, meetings and units follow the period at the top; open
                  and overdue are how things stand now.
                </span>
                <Link className="d-card-link v2-dash-right" to="/v2/best">
                  Best of Homes <Icon name="arrow-right" />
                </Link>
              </div>
            </section>

            <div className="d-stack d-c-4">
              <section className="d-card" aria-label="Going cold">
                <div className="d-card-head d-mb-0">
                  <h3>Going cold</h3>
                  <Link className="d-card-link" to="/v2/leads?tab=overdue">
                    All {count(d.cold.total)} <Icon name="arrow-right" />
                  </Link>
                </div>
                <div className="d-row d-gap-16 d-mt-8">
                  <Link className="d-cold-n" to="/v2/leads?tab=overdue">{count(d.cold.total)}</Link>
                  <span className="d-small d-muted">
                    open leads with no contact for 7 days.
                    <br />Move them or they are lost.
                  </span>
                </div>

                <div className="d-divide d-mt-8">
                  {d.cold.agents.map((row) => {
                    /*
                     * Move is offered for somebody who is away — on leave, or
                     * not marked in — and not for somebody at their desk who
                     * simply has too many. The design draws it that way, and
                     * it is right: an agent who is here can work their own
                     * list, and taking it off them is a conversation first.
                     */
                    const away = row.onLeave || row.marked === null;
                    return (
                      <div className="d-cold-row" key={row.userId}>
                        <Avatar name={row.name} />
                        <span className="d-grow">
                          <b>{row.name}{whereSuffix(row)}</b>
                          <span>
                            {count(row.leads)} open · {count(row.cold)} cold
                          </span>
                        </span>
                        {moved.includes(row.userId)
                          ? <span className="d-small d-muted">moved</span>
                          : away && (
                            <button
                              type="button"
                              className="d-btn d-sm d-dark"
                              onClick={() => setMovingWho({
                                userId: row.userId, name: row.name, leads: row.leads,
                              })}
                            >
                              Move {row.leads}
                            </button>
                          )}
                        <Link className="d-btn d-sm" to={`/v2/team/${row.userId}`}>View</Link>
                      </div>
                    );
                  })}
                  {d.cold.agents.length === 0 && (
                    <span className="d-small d-muted">
                      Nobody is sitting on a cold lead. Rare, and worth saying.
                    </span>
                  )}
                </div>

                <div className="d-card-foot">
                  <Icon name="info" />
                  <span>
                    Notes and history go with the leads. Moving is offered for somebody who is
                    away; an agent at their desk keeps their own list.
                  </span>
                </div>
              </section>

              <section className="d-card v2-dash-more" aria-label="More reports">
                <Link className="d-shortcut" to="/v2/team-live">
                  <Icon name="activity" />
                  <span className="d-grow">Team live</span>
                  <Icon name="arrow-right" />
                </Link>
                <Link className="d-shortcut" to="/v2/messaging">
                  <Icon name="message-circle" />
                  <span className="d-grow">Messaging report</span>
                  <Icon name="arrow-right" />
                </Link>
                <Link className="d-shortcut" to="/v2/activity">
                  <Icon name="shield" />
                  <span className="d-grow">Team activity</span>
                  <Icon name="arrow-right" />
                </Link>
              </section>
            </div>
          </div>

          {movingWho && (
            <MoveDialog
              who={movingWho}
              agents={d.assignable}
              busy={moving}
              onClose={() => setMovingWho(null)}
              onMove={(to) => void move(movingWho, to)}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * "Move leads" — the design's own dialog, and the only thing on this screen
 * that changes anything.
 *
 * Three choices and no more: share them equally between the agents who are in
 * today, give them all to one person, or put them back in Incoming where
 * anybody may take one. People on leave or absent are not offered, and the
 * server refuses them again — a hint in a dialog is not a rule.
 *
 * It asks twice. Thirty-one leads changing hands is not something to do by
 * brushing the screen.
 */
function MoveDialog({ who, agents, busy, onClose, onMove }: {
  who: { userId: string; name: string; leads: number };
  agents: Assignable[];
  busy: boolean;
  onClose: () => void;
  onMove: (to: MoveTo) => void;
}) {
  const [choice, setChoice] = useState<'share' | 'one' | 'pool'>('share');
  const free = agents.filter((one) => one.canTake && one.userId !== who.userId);
  const [one, setOne] = useState<string>(free[0]?.userId ?? '');
  const [sure, setSure] = useState(false);

  const each = free.length === 0 ? 0 : Math.ceil(who.leads / free.length);
  /* Nobody is in today, so sharing is not a thing that can happen. */
  const canShare = free.length > 0;
  const to: MoveTo = choice === 'pool' ? { kind: 'pool' }
    : choice === 'one' ? { kind: 'agent', userId: one }
      : { kind: 'share', userIds: free.map((row) => row.userId) };
  const ready = choice === 'pool' || (choice === 'one' ? one !== '' : canShare);

  return (
    <>
      <div className="d-scrim d-show" onClick={onClose} aria-hidden />
      <div className="d-dialog d-open" role="dialog" aria-label="Move leads">
        <div className="d-dialog-head">
          <div className="d-grow">
            <h3>Move {who.leads} {who.leads === 1 ? 'lead' : 'leads'} from {who.name}</h3>
            <p>Notes and history go with them. VIP leads stay where they are.</p>
          </div>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-dialog-body">
          <div className="d-opt-list">
            <button
              type="button"
              className={choice === 'share' ? 'd-opt d-on' : 'd-opt'}
              disabled={!canShare}
              onClick={() => { setChoice('share'); setSure(false); }}
            >
              <span className="d-card-icon"><Icon name="users" /></span>
              <span className="d-grow">
                <b className="d-bold">
                  Share equally · {free.length} {free.length === 1 ? 'agent' : 'agents'} in today
                </b>
                <div className="d-small d-muted">
                  {canShare
                    ? `About ${each} ${each === 1 ? 'lead' : 'leads'} each · fewest open leads first`
                    : 'Nobody has marked themselves in today'}
                </div>
              </span>
            </button>
            <button
              type="button"
              className={choice === 'one' ? 'd-opt d-on' : 'd-opt'}
              disabled={free.length === 0}
              onClick={() => { setChoice('one'); setSure(false); }}
            >
              <span className="d-card-icon"><Icon name="user" /></span>
              <span className="d-grow">
                <b className="d-bold">One agent</b>
                <div className="d-small d-muted">You choose who gets all of them</div>
              </span>
            </button>
            <button
              type="button"
              className={choice === 'pool' ? 'd-opt d-on' : 'd-opt'}
              onClick={() => { setChoice('pool'); setSure(false); }}
            >
              <span className="d-card-icon"><Icon name="inbox" /></span>
              <span className="d-grow">
                <b className="d-bold">Incoming</b>
                <div className="d-small d-muted">Free leads · any agent can take one</div>
              </span>
            </button>
          </div>

          {choice === 'one' && (
            <div className="d-field">
              <label htmlFor="v2-move-agent">Agent</label>
              <select
                id="v2-move-agent"
                className="d-select"
                value={one}
                onChange={(e) => { setOne(e.target.value); setSure(false); }}
              >
                {free.map((row) => (
                  <option key={row.userId} value={row.userId}>
                    {row.name} · {row.openLeads} open{row.where === 'outside' ? ' · outside' : ''}
                  </option>
                ))}
              </select>
              <span className="d-hint">People on leave or absent cannot be chosen.</span>
            </div>
          )}
        </div>

        <div className="d-dialog-foot">
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="d-btn d-primary"
            disabled={!ready || busy}
            onClick={() => { if (sure) onMove(to); else setSure(true); }}
          >
            {busy ? 'Moving…'
              : sure ? `Tap again to move ${who.leads}`
                : `Move ${who.leads} ${who.leads === 1 ? 'lead' : 'leads'}`}
          </button>
        </div>
      </div>
    </>
  );
}

/** Where somebody is, in one word, for the team table. */
function whereWord(row: { marked: string | null; wasLate: boolean; onLeave: boolean }): string {
  if (row.onLeave) return 'On leave';
  if (row.marked === 'outside') return 'Outside';
  if (row.marked === 'office') return row.wasLate ? 'Late' : 'In office';
  return 'Absent';
}

/** Which of the design's five attendance colours that is. */
function whereKey(row: { marked: string | null; wasLate: boolean; onLeave: boolean }): string {
  if (row.marked === 'office') return row.wasLate ? 'late' : 'office';
  if (row.marked === 'outside') return 'outside';
  if (row.onLeave) return 'leave';
  return 'absent';
}

/** The same, as a tail on a name: "Sultan · on leave". */
function whereSuffix(row: { marked: string | null; onLeave: boolean }): string {
  if (row.onLeave) return ' · on leave';
  if (row.marked === null) return ' · absent';
  return '';
}
