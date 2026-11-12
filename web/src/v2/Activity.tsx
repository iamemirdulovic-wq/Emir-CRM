import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';

/**
 * The full dashboard: what is actually happening.
 *
 * `docs/v2/pages.md` §32 and §34, on the report the live CRM already builds —
 * one set of numbers, two front ends. Every figure here is a query; where one
 * cannot be produced the report leaves it null and this screen says so rather
 * than drawing a zero, which reads as "none" when it means "unknown".
 */

interface Kpi { value: number; previous: number; spark: number[] }

interface Dashboard {
  range: { days: number; from: string; to: string };
  kpis: {
    newLeads: Kpi;
    whatsappRepliedPct: Kpi;
    appointments: Kpi;
    reservations: Kpi & { pipelineValueAed: number };
  };
  series: Array<{ label: string; value: number; previous: number }>;
  sources: Array<{ label: string; value: number; colour: string }>;
  totalLeads: number;
  funnel: Array<{ label: string; value: number }>;
  speedToLead: {
    medianSeconds: number | null; targetSeconds: number;
    maxSeconds: number; slaBreaches: number;
  };
  arrivals: { hours: string[]; rows: Array<{ label: string; values: number[] }>; busiest: string | null };
  leaderboard: Array<{
    userId: string; name: string; initials: string;
    medianFirstReplySeconds: number | null; qualified: number; deals: number;
  }>;
}

const RANGES = [7, 30, 90] as const;

export function V2Activity() {
  const [days, setDays] = useState<number>(30);
  const report = useAsync<Dashboard>(() => api.get(`/api/reports/dashboard?days=${days}`), [days]);

  if (report.error) return <ErrorNote>{report.error}</ErrorNote>;
  if (!report.data) return <Spinner />;

  const d = report.data;
  const busiestDay = Math.max(1, ...d.series.map((s) => s.value));

  return (
    <div className="v2-act-page">
      <header className="v2-cal-head">
        <div>
          <h1 className="v2-hi">What is happening</h1>
          <p className="d-muted">{day(d.range.from)} → {day(d.range.to)}</p>
        </div>
        <div className="v2-tabs" role="tablist">
          {RANGES.map((one) => (
            <button key={one} type="button" role="tab" aria-selected={days === one}
              className={days === one ? 'v2-tab-b v2-tab-b-on' : 'v2-tab-b'}
              onClick={() => setDays(one)}>
              {one} days
            </button>
          ))}
        </div>
      </header>

      <div className="d-bento">
        <KpiCard label="New leads" kpi={d.kpis.newLeads} to="/v2/leads?tab=new" />
        <KpiCard label="Replied on WhatsApp" kpi={d.kpis.whatsappRepliedPct} suffix="%" />
        <KpiCard label="Meetings" kpi={d.kpis.appointments} to="/v2/calendar" />
        <KpiCard
          label="Reservations"
          kpi={d.kpis.reservations}
          note={d.kpis.reservations.pipelineValueAed > 0
            ? `AED ${(d.kpis.reservations.pipelineValueAed / 1_000_000).toFixed(1)}M in the pipeline`
            : null}
        />
      </div>

      <section className="d-card">
        <div className="d-card-head">
          <h3>Leads a day</h3>
          <span className="d-small d-muted">
            {d.totalLeads.toLocaleString()} in {d.range.days} days
          </span>
        </div>
        <div className="v2-bars">
          {d.series.map((point) => (
            <span className="v2-bar-col" key={point.label} title={`${point.label}: ${point.value}`}>
              <i style={{ height: `${Math.round((point.value / busiestDay) * 100)}%` }} />
              <em>{point.label}</em>
            </span>
          ))}
        </div>
      </section>

      <div className="d-bento">
        <section className="d-card d-c-6">
          <div className="d-card-head"><h3>Where they come from</h3></div>
          {d.sources.length === 0
            ? <p className="v2-none">No leads in this window.</p>
            : (
              <ul className="v2-source-list">
                {d.sources.map((one) => (
                  <li key={one.label}>
                    <span className="v2-source-name">{one.label.replace(/_/g, ' ')}</span>
                    <span className="v2-source-bar">
                      <i style={{
                        width: `${Math.round((one.value / Math.max(1, d.totalLeads)) * 100)}%`,
                        background: one.colour,
                      }} />
                    </span>
                    <b>{one.value}</b>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <section className="d-card d-c-6">
          <div className="d-card-head"><h3>The funnel</h3></div>
          <ul className="v2-funnel">
            {d.funnel.map((step, i) => {
              const top = d.funnel[0]?.value ?? 1;
              return (
                <li key={step.label}>
                  <span className="v2-funnel-name">{step.label}</span>
                  <span className="v2-funnel-bar">
                    <i style={{ width: `${Math.round((step.value / Math.max(1, top)) * 100)}%` }} />
                  </span>
                  <b>{step.value}</b>
                  {i > 0 && top > 0 && (
                    <span className="v2-funnel-pc">{Math.round((step.value / top) * 100)}%</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="d-card">
        <div className="d-card-head">
          <h3>How fast the first reply is</h3>
          {d.speedToLead.slaBreaches > 0 && (
            <span className="d-chip d-red">{d.speedToLead.slaBreaches} too slow</span>
          )}
        </div>
        {d.speedToLead.medianSeconds === null ? (
          <p className="v2-none">
            Nothing to measure yet — no lead in this window has had a first reply.
          </p>
        ) : (
          <p className="v2-speed">
            <b>{say(d.speedToLead.medianSeconds)}</b>
            <span>
              is the middle time to a first reply. The target is {say(d.speedToLead.targetSeconds)}.
            </span>
          </p>
        )}
      </section>

      {d.arrivals.busiest && (
        <section className="d-card">
          <div className="d-card-head">
            <h3>When leads arrive</h3>
            <span className="d-small d-muted">{d.arrivals.busiest}</span>
          </div>
          {/* The number of hour columns comes from the report, not from this
              file: it buckets by two hours today and could bucket by one. */}
          <div
            className="v2-heat"
            style={{ '--cols': d.arrivals.hours.length } as React.CSSProperties}
          >
            <span />
            {d.arrivals.hours.map((h) => <span className="v2-heat-h" key={h}>{h}</span>)}
            {d.arrivals.rows.map((row) => {
              const most = Math.max(1, ...row.values);
              return (
                <Row key={row.label} label={row.label} values={row.values} most={most} />
              );
            })}
          </div>
        </section>
      )}

      <section className="d-card">
        <div className="d-card-head">
          <h3>The team</h3>
          <Link className="d-card-link" to="/v2/team">Everybody <Icon name="arrow-right" /></Link>
        </div>
        <table className="v2-table">
          <thead>
            <tr><th>Who</th><th>First reply</th><th>Qualified</th><th>Deals</th></tr>
          </thead>
          <tbody>
            {d.leaderboard.map((one) => (
              <tr key={one.userId}>
                <td>
                  <span className="person">
                    <Avatar name={one.name} />
                    <span className="who"><b>{one.name}</b></span>
                  </span>
                </td>
                <td>{one.medianFirstReplySeconds === null ? '—' : say(one.medianFirstReplySeconds)}</td>
                <td>{one.qualified}</td>
                <td>{one.deals}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Row({ label, values, most }: { label: string; values: number[]; most: number }) {
  return (
    <>
      <span className="v2-heat-d">{label}</span>
      {values.map((n, i) => (
        <span
          key={`${label}-${i}`}
          className="v2-heat-c"
          title={`${label}: ${n}`}
          style={{ opacity: n === 0 ? 0.12 : 0.25 + (n / most) * 0.75 }}
        />
      ))}
    </>
  );
}

function KpiCard({ label, kpi, suffix, note, to }: {
  label: string; kpi: Kpi; suffix?: string; note?: string | null; to?: string;
}) {
  const up = kpi.value - kpi.previous;
  const body = (
    <>
      <span className="d-label">{label}</span>
      <div className="d-stat-row">
        <b className="d-num">{kpi.value.toLocaleString()}{suffix ?? ''}</b>
        {kpi.previous > 0 && (
          <span className={up >= 0 ? 'd-chip d-green' : 'd-chip d-red'}>
            {up >= 0 ? '+' : ''}{up} vs before
          </span>
        )}
      </div>
      {note && <span className="d-state">{note}</span>}
    </>
  );
  return to
    ? <Link className="d-card d-c-3 d-tile d-click" to={to}>{body}</Link>
    : <section className="d-card d-c-3 d-tile">{body}</section>;
}

/** "13 Oct" — the report sends an instant; nobody reads an ISO string. */
function day(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return at;
  return when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "41 seconds", "4 minutes", "2 hours" — never "7320s". */
function say(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  const hours = Math.round(seconds / 3600);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
