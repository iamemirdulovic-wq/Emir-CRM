import { useState } from 'react';
import { api, qs } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatAed, humanize } from '../lib/format.js';
import { useShellSearch } from '../components/Layout.js';
import { ProjectModal } from '../components/ProjectModal.js';
import { ProjectDetail } from '../components/ProjectDetail.js';
import type { DeveloperRow, LibraryCard, LibraryStats, SaleStatus } from '../lib/types.js';
import { Icon } from '../design/index.js';
import {
  Chip, Empty, ErrorNote, Input, Modal, Note, Panel, Spinner, Toolbar, useToast,
} from '../design/ui.js';

const STATUS_PILL: Record<SaleStatus, string> = {
  selling_now: 'pill ok',
  coming_soon: 'pill wait',
  sold_out: 'pill',
};

const STATUS_LABEL: Record<SaleStatus, string> = {
  selling_now: 'Selling now',
  coming_soon: 'Coming soon',
  sold_out: 'Sold out',
};

type Filter = { emirate?: string; status?: SaleStatus; starred?: boolean };

/**
 * The off-plan library.
 *
 * Everything the CRM is allowed to quote lives here: a price, a handover date
 * or a payment plan that is not on one of these rows is never sent to a lead.
 * That is also why a new project starts unverified — the figures get read by a
 * person before the bot can repeat them.
 */
export function Library() {
  const { user } = useAuth();
  const toast = useToast();
  const shellSearch = useShellSearch();
  const search = useDebounced(shellSearch.value);

  const [filter, setFilter] = useState<Filter>({});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LibraryCard | null>(null);
  const [typedName, setTypedName] = useState('');
  const [busy, setBusy] = useState(false);

  const canManage = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';
  const canDelete = user?.role === 'owner' || user?.role === 'admin';

  const list = useAsync<{ items: LibraryCard[] }>(
    () => api.get(`/api/library${qs({
      emirate: filter.emirate,
      status: filter.status,
      starred: filter.starred ? '1' : undefined,
      search,
    })}`),
    [filter.emirate, filter.status, filter.starred, search],
  );
  const stats = useAsync<LibraryStats>(() => api.get('/api/library/stats'), []);
  const developers = useAsync<{ items: DeveloperRow[] }>(() => api.get('/api/library/developers'), []);

  const items = list.data?.items ?? [];

  async function toggleStar(card: LibraryCard) {
    // On screen first; the list reloads behind it.
    try {
      await api.post(`/api/library/${card.id}/star`, { starred: card.starred !== 1 });
      list.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change that');
    }
  }

  async function archive(card: LibraryCard) {
    try {
      await api.post(`/api/library/${card.id}/archive`, { archived: true });
      toast(`${card.name} archived`);
      list.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not archive it');
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.del(`/api/library/${deleting.id}`, { confirmName: typedName });
      toast(`${deleting.name} deleted`);
      setDeleting(null);
      setTypedName('');
      list.reload();
      stats.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete it');
    } finally {
      setBusy(false);
    }
  }

  if (openId) {
    return (
      <ProjectDetail
        projectId={openId}
        onBack={() => { setOpenId(null); list.reload(); stats.reload(); }}
        onEdit={(project) => setEditing(project)}
      />
    );
  }

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;

  return (
    <>
      <Toolbar
        right={
          canManage ? (
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              <Icon name="plus" size={15} />
              <span>Add project</span>
            </button>
          ) : undefined
        }
      >
        <Chip on={!filter.emirate && !filter.status && !filter.starred} onClick={() => setFilter({})}>All</Chip>
        <Chip on={filter.emirate === 'dubai'} onClick={() => setFilter({ emirate: 'dubai' })}>Dubai</Chip>
        <Chip on={filter.emirate === 'abu_dhabi'} onClick={() => setFilter({ emirate: 'abu_dhabi' })}>Abu Dhabi</Chip>
        <Chip on={filter.status === 'selling_now'} onClick={() => setFilter({ status: 'selling_now' })}>Selling now</Chip>
        <Chip on={filter.status === 'coming_soon'} onClick={() => setFilter({ status: 'coming_soon' })}>Coming soon</Chip>
        <Chip on={filter.starred === true} icon="star" onClick={() => setFilter({ starred: true })}>Our picks</Chip>
      </Toolbar>

      {/* ── The four KPI cards. Every number is a real query. ───────────── */}
      <div className="kpis">
        <Kpi
          label="Most leads this month"
          value={stats.data?.mostLeads?.project_name ?? '—'}
          sub={stats.data?.mostLeads ? `${stats.data.mostLeads.leads} leads` : 'No leads yet'}
          icon="users"
        />
        <Kpi
          label="Trending now"
          value={stats.data?.trending?.project_name ?? '—'}
          sub={stats.data?.trending ? `+${stats.data.trending.rise_pct}% this week` : 'Not enough history'}
          icon="trending-up"
          warm
        />
        <Kpi
          label="Best converting"
          value={stats.data?.bestConverting?.project_name ?? '—'}
          sub={
            stats.data?.bestConverting
              ? `${stats.data.bestConverting.rate_pct}% · ${stats.data.bestConverting.deals} deals`
              : 'No deals yet'
          }
          icon="target"
        />
        <Kpi
          label="Available inventory"
          value={stats.data ? `${stats.data.inventory.available} units` : '—'}
          sub={stats.data ? `AED ${formatAed(stats.data.inventory.value_aed)} across the library` : ''}
          icon="building-2"
        />
      </div>

      <Panel index={1} icon="building-2" title={`${items.length} project${items.length === 1 ? '' : 's'}`}>
        {list.loading && items.length === 0 && <Spinner />}

        {!list.loading && items.length === 0 && (
          <Empty
            icon="building-2"
            title="Nothing here yet"
            hint={
              canManage
                ? 'Add your first project — until one is here, the WhatsApp replies cannot quote a price.'
                : 'Your manager has not added any projects yet.'
            }
          />
        )}

        <div className="proj-grid">
          {items.map((card) => (
            <article className="proj-card" key={card.id}>
              <div
                className="proj-cover"
                style={card.image_url ? { backgroundImage: `url(${card.image_url})` } : undefined}
              >
                <div className="proj-badges">
                  <span className={STATUS_PILL[card.sale_status]}>{STATUS_LABEL[card.sale_status]}</span>
                  {card.visibility === 'private' && <span className="pill">Private</span>}
                  {!card.verified_at && <span className="pill wait">Not verified</span>}
                </div>
                {canManage && (
                  <button
                    type="button"
                    className="proj-star"
                    onClick={() => void toggleStar(card)}
                    aria-label={card.starred === 1 ? `Remove ${card.name} from our picks` : `Add ${card.name} to our picks`}
                    aria-pressed={card.starred === 1}
                  >
                    <Icon name="star" size={15} />
                  </button>
                )}
                <div className="proj-title">
                  <b>{card.name}</b>
                  <small>{card.developer}{card.community ? ` · ${card.community}` : ''}</small>
                </div>
              </div>

              <div className="proj-body">
                <div className="proj-price">
                  {card.starting_price_aed ? (
                    <>
                      <b>AED {formatAed(card.starting_price_aed)}</b> <span className="muted">from</span>
                    </>
                  ) : (
                    <span className="muted">No price yet</span>
                  )}
                </div>
                <div className="proj-facts muted">
                  {[card.property_type ? humanize(card.property_type) : null, card.handover_date, card.payment_plan]
                    .filter(Boolean)
                    .join('  ·  ') || '—'}
                </div>
                <div className="proj-foot">
                  <span className="muted">
                    {Number(card.units_total) > 0
                      ? `${card.units_available} of ${card.units_total} available`
                      : 'No units yet'}
                  </span>
                  <button type="button" className="btn btn-primary" onClick={() => setOpenId(card.id)}>
                    Open
                  </button>
                </div>
                {canManage && (
                  <div className="proj-actions">
                    <button type="button" className="rowbtn" onClick={() => setOpenId(card.id)}>Units &amp; prices</button>
                    <button type="button" className="rowbtn" onClick={() => void archive(card)}>Archive</button>
                    {canDelete && (
                      <button
                        type="button"
                        className="rowbtn danger"
                        onClick={() => { setDeleting(card); setTypedName(''); }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </Panel>

      <ProjectModal
        open={adding || editing !== null}
        project={editing}
        developers={developers.data?.items ?? []}
        onClose={() => { setAdding(false); setEditing(null); }}
        onSaved={(id) => {
          setAdding(false);
          setEditing(null);
          toast('Project saved');
          list.reload();
          stats.reload();
          if (!editing) setOpenId(id);
        }}
      />

      {/* ── Delete, with the name typed back ───────────────────────────── */}
      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? ''}?`}
        icon="alert-triangle"
        footer={
          <>
            <button type="button" className="btn" onClick={() => { setDeleting(null); void (deleting && archive(deleting)); }}>
              Archive instead
            </button>
            <button type="button" className="btn" onClick={() => setDeleting(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy || typedName.trim() !== deleting?.name}
              onClick={() => void confirmDelete()}
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}><b>This deletes:</b> the project, its units and prices, payment plans,
          photos, floor plans and documents.</p>
        <p><b>This stays:</b> the leads (they keep the project name as text), any sales offers already sent
          to clients, and Won deals and commissions.</p>
        <Note>Archiving does the same job without losing anything, and can be undone.</Note>
        <Field label={`Type ${deleting?.name ?? ''} to confirm`}>
          <Input value={typedName} onChange={(event) => setTypedName(event.target.value)} autoComplete="off" />
        </Field>
      </Modal>
    </>
  );
}

function Kpi({ label, value, sub, icon, warm }: {
  label: string; value: string; sub: string; icon: 'users' | 'trending-up' | 'target' | 'building-2'; warm?: boolean;
}) {
  return (
    <div className={warm ? 'kpi warm' : 'kpi'}>
      <span className="k-label">
        <Icon name={icon} size={14} />
        {label}
      </span>
      <b className="k-value">{value}</b>
      <span className="k-sub muted">{sub}</span>
    </div>
  );
}

/** Local import to keep the delete dialog's label tidy. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
