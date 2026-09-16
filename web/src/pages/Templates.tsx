import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { formatDateTime } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import type { TemplateRow } from '../lib/types.js';
import { EmptyState, ErrorNote, Icon, Spinner, Toast } from '../components/ui.js';

const STATUS_TONE: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800',
  PENDING: 'bg-amber-100 text-amber-800',
  DRAFT: 'bg-slate-100 text-slate-600',
  REJECTED: 'bg-rose-100 text-rose-700',
  PAUSED: 'bg-rose-100 text-rose-700',
  DISABLED: 'bg-rose-100 text-rose-700',
};

/** Template status, and the worklist of unmapped lead-form questions. */
export function Templates() {
  const list = useAsync<{ items: TemplateRow[]; blocked: number }>(() => api.get('/api/templates'), []);
  const unmapped = useAsync<{ items: Array<{ field: string; count: number; sample: string }> }>(
    () => api.get('/api/templates/field-map/unmapped'),
    [],
  );
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4000);
  };

  const run = async (path: string, label: string) => {
    setBusy(true);
    try {
      await api.post(path);
      list.reload();
      flash(label);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const blocked = list.data?.blocked ?? 0;

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-900">{t('templates')}</h1>
        <div className="ms-auto flex gap-2">
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void run('/api/templates/seed-library', 'Library seeded')}>
            <Icon name="library_add" className="!text-[18px]" />
            Seed library
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void run('/api/templates/sync', 'Synced from the provider')}>
            <Icon name="sync" className="!text-[18px]" />
            Sync
          </button>
        </div>
      </header>

      {blocked > 0 ? (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <Icon name="warning" className="!text-[16px] align-text-bottom" /> {blocked} template
          {blocked === 1 ? '' : 's'} not approved. Outside the 24-hour window only approved templates can be sent, so
          follow-ups relying on these will fall back to email.
        </div>
      ) : null}

      {list.error ? <ErrorNote message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Spinner /> : null}

      {list.data && list.data.items.length > 0 ? (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-start text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="p-3 text-start">Name</th>
                <th className="p-3 text-start">Language</th>
                <th className="p-3 text-start">Category</th>
                <th className="p-3 text-start">Status</th>
                <th className="p-3 text-start">Last synced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.items.map((template) => (
                <tr key={template.id}>
                  <td className="p-3 font-medium text-slate-800">{template.name}</td>
                  <td className="p-3 text-slate-600">{template.language}</td>
                  <td className="p-3 text-slate-600">{template.category}</td>
                  <td className="p-3">
                    <span className={`chip ${STATUS_TONE[template.status] ?? 'bg-slate-100 text-slate-600'}`}>{template.status}</span>
                    {template.rejected_reason ? (
                      <p className="mt-1 text-[11px] text-rose-700">{template.rejected_reason}</p>
                    ) : null}
                  </td>
                  <td className="p-3 text-xs text-slate-500">{formatDateTime(template.last_synced_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon="description" title="No templates yet" hint="Seed the day-one library, then sync from Meta." />
      )}

      <section className="card p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Unmapped lead-form questions</h2>
        <p className="mb-3 text-xs text-slate-500">
          Questions that have arrived on a lead form with no mapping. Map one and it starts populating the CRM — no deploy needed.
        </p>
        {unmapped.data?.items.length === 0 ? (
          <p className="text-sm text-slate-400">Everything on your forms is mapped.</p>
        ) : (
          <ul className="space-y-2">
            {(unmapped.data?.items ?? []).map((row) => (
              <li key={row.field} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{row.field}</p>
                  <p className="truncate text-xs text-slate-500">e.g. “{row.sample}”</p>
                </div>
                <span className="chip bg-slate-100 text-slate-600">{row.count}×</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}
