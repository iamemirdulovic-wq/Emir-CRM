import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { relativeTime } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import { Avatar, EmptyState, ErrorNote, Icon, ScoreChip, Spinner } from '../components/ui.js';

type Row = {
  id: string;
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  lead_score: number;
  dnc: number;
  owner_name: string | null;
  first_source: string | null;
  last_inbound_at: string | null;
  created_at: string;
};

export function Contacts() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  const list = useAsync<{ items: Row[]; total: number; pageSize: number }>(
    () => api.get(`/api/contacts${qs({ search: debounced, page })}`),
    [debounced, page],
  );

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-900">{t('contacts')}</h1>
        <div className="relative ms-auto w-full sm:w-72">
          <Icon name="search" className="pointer-events-none absolute start-2 top-1/2 !text-[18px] -translate-y-1/2 text-slate-400" />
          <input
            className="field ps-9"
            placeholder="Name, phone or email"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {can('export') ? (
          <a className="btn-tonal" href="/api/contacts/export/csv">
            <Icon name="download" className="!text-[18px]" />
            Export CSV
          </a>
        ) : null}
      </header>

      {list.error ? <ErrorNote message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Spinner /> : null}
      {list.data?.items.length === 0 ? <EmptyState icon="contacts" title={t('noResults')} /> : null}

      {list.data && list.data.items.length > 0 ? (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {list.data.items.map((row) => (
              <li key={row.id}>
                <Link to={`/contacts/${row.id}`} className="flex items-center gap-3 p-3 transition hover:bg-slate-50">
                  <Avatar name={row.full_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{row.full_name ?? 'Unnamed'}</p>
                    <p className="truncate text-xs text-slate-500">{row.phone_e164 ?? row.email ?? '—'}</p>
                  </div>
                  <div className="hidden text-end sm:block">
                    <p className="text-xs text-slate-500">{row.owner_name ?? 'Unassigned'}</p>
                    <p className="text-[11px] text-slate-400">{relativeTime(row.created_at)}</p>
                  </div>
                  {row.dnc === 1 ? <span className="chip bg-rose-100 text-rose-700">DNC</span> : null}
                  <ScoreChip score={row.lead_score} />
                </Link>
              </li>
            ))}
          </ul>

          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-slate-100 p-3 text-sm">
              <button type="button" className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <Icon name="chevron_left" className="!text-[18px]" />
                Previous
              </button>
              <span className="text-slate-500">
                Page {page} of {pages}
              </span>
              <button type="button" className="btn-ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
                <Icon name="chevron_right" className="!text-[18px]" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
