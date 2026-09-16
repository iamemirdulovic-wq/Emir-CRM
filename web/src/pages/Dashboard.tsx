import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import type { DashboardResponse } from '../lib/types.js';
import { AreaChart, ChartDefs, CountUp, Donut, Funnel, Gauge, Heat, Icon, Spark } from '../design/index.js';
import { Avatar, duration, Empty, ErrorNote, Panel, Seg, Spinner } from '../design/ui.js';
import type { IconName } from '../design/Icon.js';

const RANGES = [
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 90, label: '90D' },
];

/** Formats a large dirham figure the way agents say it out loud. */
function aed(value: number): string {
  if (value >= 1_000_000) return `AED ${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1000) return `AED ${Math.round(value / 1000)}K`;
  return `AED ${value}`;
}

function delta(current: number, previous: number, unit = ''): { text: string; bad: boolean } {
  const difference = current - previous;
  if (previous === 0 && difference === 0) return { text: 'No change', bad: false };
  const sign = difference >= 0 ? '+' : '';
  return { text: `${sign}${difference}${unit} vs previous`, bad: difference < 0 };
}

/**
 * The dashboard.
 *
 * Every number here is scoped on the server to what the viewer may see, so an
 * agent's dashboard is their own leads and a manager's is their team's. One
 * request fills the whole screen.
 */
export function Dashboard() {
  const { user } = useAuth();
  const [days, setDays] = useState(30);
  const { data, error, loading } = useAsync<DashboardResponse>(
    () => api.get<DashboardResponse>(`/api/reports/dashboard${qs({ days })}`),
    [days],
  );

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const { kpis, speedToLead, arrivals } = data;
  const kpiCards: {
    icon: IconName;
    label: string;
    value: number;
    suffix?: string;
    foot: { text: string; bad: boolean };
    spark: number[];
  }[] = [
    {
      icon: 'user-plus',
      label: 'New leads today',
      value: kpis.newLeads.value,
      foot: delta(kpis.newLeads.value, kpis.newLeads.previous),
      spark: kpis.newLeads.spark,
    },
    {
      icon: 'message-circle',
      label: 'Replied on WhatsApp',
      value: kpis.whatsappRepliedPct.value,
      suffix: '%',
      foot: delta(kpis.whatsappRepliedPct.value, kpis.whatsappRepliedPct.previous, ' pts'),
      spark: kpis.whatsappRepliedPct.spark,
    },
    {
      icon: 'calendar-check',
      label: 'Appointments',
      value: kpis.appointments.value,
      foot: { text: `in the last ${data.range.days} days`, bad: false },
      spark: kpis.appointments.spark,
    },
    {
      icon: 'badge-check',
      label: 'Reservations',
      value: kpis.reservations.value,
      foot: { text: `${aed(kpis.reservations.pipelineValueAed)} pipeline`, bad: false },
      spark: kpis.reservations.spark,
    },
  ];

  return (
    <>
      <ChartDefs />
      <div className="dash">
        {kpiCards.map((kpi, i) => (
          <div className="kpi span-3 rise" key={kpi.label} style={{ ['--i' as string]: i }}>
            <div className="lbl">
              <Icon name={kpi.icon} />
              {kpi.label}
            </div>
            <div className="foot">
              <div>
                <div className="val">
                  <CountUp value={kpi.value} suffix={kpi.suffix} />
                </div>
                <div className={kpi.foot.bad ? 'delta bad' : 'delta'}>{kpi.foot.text}</div>
              </div>
              {kpi.spark.some((n) => n > 0) && <Spark values={kpi.spark} label={`${kpi.label} trend`} />}
            </div>
          </div>
        ))}

        <Panel
          span={8}
          index={4}
          icon="activity"
          title={
            <>
              Leads over time
              <Seg value={days} options={RANGES} onChange={setDays} />
            </>
          }
        >
          <AreaChart points={data.series} unit="leads" />
          <div className="legend">
            <span>
              <i />
              This period
            </span>
            <span>
              <i className="b" />
              Previous period
            </span>
          </div>
        </Panel>

        <Panel span={4} index={5} icon="timer" title="Speed to lead">
          <Gauge
            value={
              // The gauge fills as the reply gets slower, so a short bar is good
              // news. Nothing recorded yet leaves it empty rather than perfect.
              speedToLead.medianSeconds ?? 0
            }
            max={speedToLead.maxSeconds}
            footStart="0s"
            footEnd={`${speedToLead.maxSeconds}s`}
          >
            <div className="gauge-num">
              <b>
                {speedToLead.medianSeconds === null ? (
                  '—'
                ) : (
                  <>
                    <CountUp value={speedToLead.medianSeconds} />s
                  </>
                )}
              </b>
              <small>median first reply · target {speedToLead.targetSeconds}s</small>
            </div>
          </Gauge>
          {speedToLead.slaBreaches > 0 && (
            <div className="task" style={{ marginTop: 14 }}>
              <Icon name="alarm-clock" style={{ color: 'var(--hot)' }} />
              {speedToLead.slaBreaches} {speedToLead.slaBreaches === 1 ? 'lead' : 'leads'} missed the
              5-minute rule
              <span className="due">Reassigned</span>
            </div>
          )}
        </Panel>

        <Panel span={5} index={6} icon="pie-chart" title="Where leads come from">
          {data.sources.length === 0 ? (
            <Empty icon="pie-chart" title="No leads in this period" />
          ) : (
            <Donut slices={data.sources} centreLabel={`leads in ${data.range.days} days`} />
          )}
        </Panel>

        <Panel span={7} index={7} icon="filter" title="Lead quality funnel">
          <Funnel steps={data.funnel} />
        </Panel>

        <Panel
          span={7}
          index={8}
          icon="clock-3"
          title={
            <>
              When leads arrive
              {arrivals.busiest && (
                <span className="live" style={{ fontWeight: 500 }}>
                  {arrivals.busiest}
                </span>
              )}
            </>
          }
        >
          <Heat
            hours={arrivals.hours}
            rows={arrivals.rows}
            describe={(day, hour, value) =>
              `${day} ${hour} — ${value} ${value === 1 ? 'lead' : 'leads'}`
            }
          />
        </Panel>

        <Panel span={5} index={9} icon="crown" title="King of Emir">
          {data.leaderboard.length === 0 ? (
            <Empty icon="crown" title="No leads assigned yet" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>First reply</th>
                    <th>Qualified</th>
                    <th>Deals</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leaderboard.map((row, i) => {
                    // Anything past the 30-second target is called out in amber.
                    const slow =
                      row.medianFirstReplySeconds !== null &&
                      row.medianFirstReplySeconds > speedToLead.targetSeconds;
                    return (
                      <tr key={row.userId}>
                        <td>
                          <div className="rank">
                            {i === 0 ? (
                              <Icon name="crown" className="crown" />
                            ) : (
                              <span style={{ width: 18, textAlign: 'center', color: 'var(--ink-3)' }}>
                                {i + 1}
                              </span>
                            )}
                            <Avatar name={row.name} />
                            {row.name}
                            {row.userId === user?.id && <span className="ai-chip">You</span>}
                          </div>
                        </td>
                        <td className={slow ? 'speed slow' : 'speed'}>
                          {duration(row.medianFirstReplySeconds)}
                        </td>
                        <td>{row.qualified}</td>
                        <td>{row.deals}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="note" style={{ marginTop: 12 }}>
            <Icon name="info" />
            <span>
              Ranked on reservations first, then appointments and speed.{' '}
              <Link to="/pipeline" className="rowbtn">
                Open the pipeline
              </Link>
            </span>
          </p>
        </Panel>
      </div>
    </>
  );
}
