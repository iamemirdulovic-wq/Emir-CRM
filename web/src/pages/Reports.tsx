import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { formatAed, humanize } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import { EmptyState, ErrorNote, Icon, Spinner } from '../components/ui.js';

type SourceRow = {
  source: string;
  campaign_name: string | null;
  ad_name: string | null;
  leads: number;
  validPct: number;
  contactedPct: number;
  qualifiedPct: number;
  appointmentPct: number;
  showPct: number;
  reservationPct: number;
  deal_value_aed: number;
  avg_score: number;
};

type AgentRow = {
  userId: string;
  name: string;
  leads: number;
  medianSpeedToLeadSeconds: number | null;
  slaBreaches: number;
  contactRatePct: number;
  qualifiedRatePct: number;
  appointments: number;
  reservations: number;
};

export function Reports() {
  const sources = useAsync<{ items: SourceRow[]; note: string }>(() => api.get('/api/reports/source-quality'), []);
  const agents = useAsync<{ items: AgentRow[]; leaderboard: AgentRow[]; kingOfEmir: AgentRow | null }>(
    () => api.get('/api/reports/agents'),
    [],
  );
  const health = useAsync<Record<string, unknown>>(() => api.get('/api/reports/health'), []);

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-semibold text-slate-900">{t('reports')}</h1>

      {agents.data?.kingOfEmir ? (
        <section className="card flex items-center gap-4 bg-gradient-to-r from-brand-600 to-brand-700 p-4 text-white">
          <Icon name="crown" className="!text-[32px]" />
          <div>
            <p className="text-xs uppercase tracking-wide opacity-80">King of Emir this period</p>
            <p className="text-lg font-semibold">{agents.data.kingOfEmir.name}</p>
            <p className="text-sm opacity-90">
              {agents.data.kingOfEmir.reservations} reservations · {agents.data.kingOfEmir.appointments} appointments ·{' '}
              {agents.data.kingOfEmir.qualifiedRatePct}% qualified
            </p>
          </div>
        </section>
      ) : null}

      <section className="card p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Agent performance</h2>
        <p className="mb-3 text-xs text-slate-500">Median speed-to-lead, not average — one late reply should not define a week.</p>
        {agents.error ? <ErrorNote message={agents.error} onRetry={agents.reload} /> : null}
        {agents.loading && !agents.data ? <Spinner /> : null}
        {agents.data?.items.length === 0 ? <EmptyState icon="group" title="No data for this period" /> : null}

        {agents.data && agents.data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="p-2 text-start">Agent</th>
                  <th className="p-2 text-end">Leads</th>
                  <th className="p-2 text-end">Speed to lead</th>
                  <th className="p-2 text-end">SLA breaches</th>
                  <th className="p-2 text-end">Contact</th>
                  <th className="p-2 text-end">Qualified</th>
                  <th className="p-2 text-end">Appts</th>
                  <th className="p-2 text-end">Reservations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.data.leaderboard.map((row) => (
                  <tr key={row.userId}>
                    <td className="p-2 font-medium text-slate-800">{row.name}</td>
                    <td className="p-2 text-end text-slate-600">{row.leads}</td>
                    <td className="p-2 text-end text-slate-600">{formatDuration(row.medianSpeedToLeadSeconds)}</td>
                    <td className={`p-2 text-end ${row.slaBreaches > 0 ? 'text-rose-700' : 'text-slate-600'}`}>{row.slaBreaches}</td>
                    <td className="p-2 text-end text-slate-600">{row.contactRatePct}%</td>
                    <td className="p-2 text-end text-slate-600">{row.qualifiedRatePct}%</td>
                    <td className="p-2 text-end text-slate-600">{row.appointments}</td>
                    <td className="p-2 text-end font-semibold text-emerald-700">{row.reservations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Source quality</h2>
        <p className="mb-3 text-xs text-slate-500">{sources.data?.note ?? 'Funnel conversion by campaign and ad.'}</p>
        {sources.error ? <ErrorNote message={sources.error} onRetry={sources.reload} /> : null}
        {sources.loading && !sources.data ? <Spinner /> : null}
        {sources.data?.items.length === 0 ? <EmptyState icon="insights" title="No leads in this period" /> : null}

        {sources.data && sources.data.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="p-2 text-start">Source / campaign</th>
                  <th className="p-2 text-end">Leads</th>
                  <th className="p-2 text-end">Valid</th>
                  <th className="p-2 text-end">Contacted</th>
                  <th className="p-2 text-end">Qualified</th>
                  <th className="p-2 text-end">Appt</th>
                  <th className="p-2 text-end">Show</th>
                  <th className="p-2 text-end">Reserved</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sources.data.items.map((row, index) => (
                  <tr key={index}>
                    <td className="p-2">
                      <p className="font-medium text-slate-800">{humanize(row.source)}</p>
                      <p className="text-xs text-slate-500">{row.campaign_name ?? row.ad_name ?? '—'}</p>
                    </td>
                    <td className="p-2 text-end text-slate-600">{row.leads}</td>
                    <td className="p-2 text-end text-slate-600">{row.validPct}%</td>
                    <td className="p-2 text-end text-slate-600">{row.contactedPct}%</td>
                    <td className="p-2 text-end text-slate-600">{row.qualifiedPct}%</td>
                    <td className="p-2 text-end text-slate-600">{row.appointmentPct}%</td>
                    <td className="p-2 text-end text-slate-600">{row.showPct}%</td>
                    <td className="p-2 text-end font-semibold text-emerald-700">{row.reservationPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">System health</h2>
        {health.data ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Unassigned leads" value={String(health.data.unassignedLeads ?? 0)} tone={Number(health.data.unassignedLeads) > 0 ? 'warn' : 'ok'} />
            <Stat
              label="Templates not approved"
              value={String((health.data.templatesNotApproved as unknown[] | undefined)?.length ?? 0)}
              tone={((health.data.templatesNotApproved as unknown[] | undefined)?.length ?? 0) > 0 ? 'warn' : 'ok'}
            />
            <Stat
              label="Unverified projects"
              value={String(health.data.unverifiedActiveProjects ?? 0)}
              tone={Number(health.data.unverifiedActiveProjects) > 0 ? 'warn' : 'ok'}
            />
            <Stat label="Realtime clients" value={String(health.data.realtimeClients ?? 0)} tone="ok" />
          </div>
        ) : (
          <Spinner />
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' }) {
  return (
    <div className={`rounded-lg p-3 ${tone === 'warn' ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-semibold ${tone === 'warn' ? 'text-amber-800' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
