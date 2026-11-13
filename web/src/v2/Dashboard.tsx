import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, ErrorNote, Spinner, useToast } from '../design/ui.js';

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

interface NeedsYou {
  kind: string;
  text: string;
  n: number;
  action: string;
  to: string;
}

interface OwnerHome {
  needsYou?: NeedsYou[];
}

type Period = 'today' | 'week' | 'month' | 'year';

const PERIODS: Array<{ key: Period; label: string; against: string }> = [
  { key: 'today', label: 'Today', against: 'vs yesterday' },
  { key: 'week', label: 'Week', against: 'vs the week before' },
  { key: 'month', label: 'Month', against: 'vs the 30 days before' },
  { key: 'year', label: 'Year', against: 'vs the year before' },
];

/** The icon tile beside each row of the brief, by what the row is about. */
const NEEDS_ICON: Record<string, IconName> = {
  vip_late: 'alert-triangle',
  waiting: 'inbox',
  transfer: 'repeat',
  leave: 'calendar-days',
  absent: 'user-x',
  bug: 'alert-circle',
};

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
  const { user } = useAuth();
  const canSee = user?.role === 'owner' || user?.role === 'admin';
  const [period, setPeriod] = useState<Period>('today');
  const [moving, setMoving] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [moved, setMoved] = useState<string[]>([]);
  const toast = useToast();

  const got = useAsync<Dash>(() => api.get(`/api/v2/dashboard?period=${period}`), [period]);
  /* The brief's two halves. Neither is required for the page to be useful, so
     both are read separately and the card simply shows less if one is quiet. */
  const insight = useAsync<Insight>(() => api.get('/api/activity/insight'), []);
  const home = useAsync<OwnerHome>(() => api.get('/api/v2/home'), []);

  async function move(row: ColdAgent) {
    setMoving(row.userId);
    try {
      const answer = await api.post<{ moved: number; name: string | null }>(
        '/api/v2/dashboard/move', { userId: row.userId },
      );
      setMoved((was) => [...was, row.userId]);
      toast(
        answer.moved === 0
          ? `${row.name} has no open leads to move.`
          : `${answer.moved} ${answer.moved === 1 ? 'lead' : 'leads'} went back to Incoming.`,
      );
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Those leads did not move.');
    } finally {
      setMoving(null);
      setAsked(null);
    }
  }

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
   * cut off, which looks like a bug rather than a list. So the work that needs
   * a decision comes first, and the counted lines fill whatever is left.
   */
  const needsYou = (home.data?.needsYou ?? []).slice(0, 3);
  const spare = Math.max(0, 3 - Math.max(needsYou.length, 1));
  const extraLines = (insight.data?.lines ?? []).slice(1, 1 + spare);

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
                {needsYou.length > 0 && (
                  <>
                    {' '}
                    <em>
                      {needsYou.length} {needsYou.length === 1 ? 'thing needs' : 'things need'} a
                      decision.
                    </em>
                  </>
                )}
              </p>

              <div className="d-arows">
                {needsYou.map((row) => (
                  <div className="d-arow" key={`${row.kind}-${row.to}`}>
                    <span className={row.kind === 'vip_late' ? 'd-arow-ic d-accent' : 'd-arow-ic'}>
                      <Icon name={NEEDS_ICON[row.kind] ?? 'circle-alert'} />
                    </span>
                    <Link className="d-arow-txt" to={row.to}>
                      <b>{row.n} {row.text}</b>
                      <span className="d-s">{row.action}</span>
                    </Link>
                    <Link className="d-btn d-sm d-on-dark" to={row.to}>{row.action}</Link>
                  </div>
                ))}
                {needsYou.length === 0 && (
                  <div className="d-arow">
                    <span className="d-arow-ic"><Icon name="check" /></span>
                    <span className="d-arow-txt">
                      <b>Nothing is waiting on you</b>
                      <span className="d-s">
                        No VIP is late, no lead is unclaimed and no transfer needs approval
                      </span>
                    </span>
                  </div>
                )}
                {extraLines.map((line) => (
                  <div className="d-arow" key={line.text}>
                    <span className={line.kind === 'problem' ? 'd-arow-ic d-accent' : 'd-arow-ic'}>
                      <Icon name={line.kind === 'problem' ? 'circle-alert' : 'bar-chart-3'} />
                    </span>
                    <span className="d-arow-txt"><b>{line.text}</b></span>
                  </div>
                ))}
              </div>
            </section>

            <section className="d-card d-c-7" aria-label="Totals">
              <div className="d-card-head">
                <h3>Totals</h3>
                <span className="d-small d-muted">
                  Calls, meetings and units: <b className="d-ink-2">{period}</b>
                </span>
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
                  <span className="d-label">Never contacted</span>
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
                  <span className="d-k">Calls made</span>
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
                <div className="d-ptile">
                  <span className="d-k">Answered in 2 h</span>
                  <b className="d-num-sm">
                    {d.work.touchedIn2hPct === null ? '—' : `${d.work.touchedIn2hPct}%`}
                  </b>
                  <span className="d-s">
                    {d.work.firstAnswerMinutes === null
                      ? `of ${count(d.work.touchedIn2hOf)} new leads`
                      : <>First answer <b className="d-t-green">{d.work.firstAnswerMinutes} min</b></>}
                  </span>
                </div>
              </div>
            </section>
          </div>

          {/* ── row 2: by stage ───────────────────────────────────────── */}
          <section className="d-card d-mt-16 v2-dash-stages" aria-label="Leads by stage">
            <div className="v2-dash-stages-head">
              <h3>By stage</h3>
              <span className="d-small d-muted">Open a stage to see its leads</span>
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
                <Delta
                  n={d.perDay.total - d.perDay.previous}
                  note="vs the 14 days before"
                />
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
                      {project.won > 0 ? `${project.won} won` : '—'}
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
                <h3>Team today</h3>
                <Link className="d-card-link" to="/v2/attendance">
                  Attendance <Icon name="arrow-right" />
                </Link>
              </div>

              <div className="d-att-head">
                <div className="d-segbar d-tall">
                  <Link className="d-green" style={{ ['--v' as string]: String(d.teamToday.inOffice) }} to="/v2/attendance" aria-label={`${d.teamToday.inOffice} in office`} />
                  <Link className="d-amber" style={{ ['--v' as string]: String(d.teamToday.late) }} to="/v2/attendance" aria-label={`${d.teamToday.late} late`} />
                  <Link className="d-blue" style={{ ['--v' as string]: String(d.teamToday.outside) }} to="/v2/attendance" aria-label={`${d.teamToday.outside} outside`} />
                  <Link className="d-violet" style={{ ['--v' as string]: String(d.teamToday.leave) }} to="/v2/attendance" aria-label={`${d.teamToday.leave} on leave`} />
                  <Link className="d-red" style={{ ['--v' as string]: String(d.teamToday.absent) }} to="/v2/attendance" aria-label={`${d.teamToday.absent} not marked`} />
                </div>
                <div className="d-legend">
                  <span><span className="d-dot d-green" /><b>{d.teamToday.inOffice}</b> In office</span>
                  <span><span className="d-dot d-amber" /><b>{d.teamToday.late}</b> Late</span>
                  <span><span className="d-dot d-blue" /><b>{d.teamToday.outside}</b> Outside</span>
                  <span><span className="d-dot d-violet" /><b>{d.teamToday.leave}</b> Leave</span>
                  <span><span className="d-dot d-red" /><b>{d.teamToday.absent}</b> Not marked</span>
                </div>
              </div>

              {/* Side-scrolls on a phone rather than squeezing seven columns
                  into 390px: see `.v2-dash-scroll` in v2-shell.css. */}
              <div className="v2-dash-scroll">
              <table className="d-table d-compact d-id-team">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Where</th>
                    <th>Calls {period === 'today' ? 'today' : `this ${period}`} · 7 days</th>
                    <th className="d-t-right">Meetings</th>
                    <th className="d-t-right">Units</th>
                    <th className="d-t-right">Open</th>
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
                      <td>{whereWord(row)}</td>
                      <td>
                        <span className="d-cell-bar">
                          <b>{count(row.calls)}</b>
                          <Spark days={row.callsPerDay} />
                        </span>
                      </td>
                      <td className="d-t-right">{count(row.meetings)}</td>
                      <td className="d-t-right">{count(row.units)}</td>
                      <td className="d-t-right">{count(row.open)}</td>
                      <td className="d-t-right">
                        {row.overdue > 0
                          ? <b className="d-t-red">{count(row.overdue)}</b>
                          : row.overdue}
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
                  {d.cold.agents.map((row) => (
                    <div className="d-cold-row" key={row.userId}>
                      <Avatar name={row.name} />
                      <span className="d-grow">
                        <b>{row.name}{whereSuffix(row)}</b>
                        <span>
                          {count(row.leads)} open · {count(row.cold)} cold
                        </span>
                      </span>
                      {moved.includes(row.userId) ? (
                        <span className="d-small d-muted">moved</span>
                      ) : asked === row.userId ? (
                        <button
                          type="button"
                          className="d-btn d-sm d-dark"
                          disabled={moving === row.userId}
                          onClick={() => move(row)}
                        >
                          {moving === row.userId ? 'Moving…' : `Yes, move ${row.leads}`}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="d-btn d-sm"
                          onClick={() => setAsked(row.userId)}
                        >
                          Move {row.leads}
                        </button>
                      )}
                      <Link className="d-btn d-sm" to={`/v2/team/${row.userId}`}>View</Link>
                    </div>
                  ))}
                  {d.cold.agents.length === 0 && (
                    <span className="d-small d-muted">
                      Nobody is sitting on a cold lead. Rare, and worth saying.
                    </span>
                  )}
                </div>

                <div className="d-card-foot">
                  <Icon name="info" />
                  <span>
                    Moving sends that person&rsquo;s open leads back to Incoming for you to give
                    out. It never picks the next agent.
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
                  <span className="d-grow">Who did what</span>
                  <Icon name="arrow-right" />
                </Link>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Where somebody is, in one word, for the team table. */
function whereWord(row: { marked: string | null; wasLate: boolean; onLeave: boolean }): string {
  if (row.onLeave) return 'On leave';
  if (row.marked === 'outside') return 'Outside';
  if (row.marked === 'office') return row.wasLate ? 'Late' : 'In office';
  return 'Not marked';
}

/** The same, as a tail on a name: "Sultan · on leave". */
function whereSuffix(row: { marked: string | null; onLeave: boolean }): string {
  if (row.onLeave) return ' · on leave';
  if (row.marked === null) return ' · not marked in';
  return '';
}
