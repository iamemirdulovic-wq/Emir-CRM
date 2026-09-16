import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { budgetLabel, humanize, relativeTime } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import type { BoardColumn, Card, PipelineDefinition, StageKey, UserRow } from '../lib/types.js';
import { EmptyState, ErrorNote, Icon, Modal, ScoreChip, Spinner, Toast } from '../components/ui.js';

/**
 * The Kanban board.
 *
 * Cards move by drag-and-drop on a pointer device, and by an explicit "move"
 * menu everywhere else — the mobile-first path cannot depend on dragging.
 */
export function Board() {
  const { user, can } = useAuth();
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const debouncedSearch = useDebounced(search);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [moving, setMoving] = useState<{ card: Card; to: StageKey } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const definition = useAsync<PipelineDefinition>(() => api.get('/api/pipeline/definition'), []);
  const team = useAsync<{ items: UserRow[] }>(() => api.get('/api/users'), []);
  const board = useAsync<{ columns: BoardColumn[] }>(
    () => api.get(`/api/pipeline/board${qs({ search: debouncedSearch, ownerUserId: ownerFilter })}`),
    [debouncedSearch, ownerFilter],
  );

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';

  const stages = useMemo(() => definition.data?.stages ?? [], [definition.data]);

  const move = useCallback(
    async (card: Card, to: StageKey, extra: { subStatus?: string; lostReason?: string; lostNote?: string } = {}) => {
      try {
        await api.post(`/api/pipeline/opportunities/${card.id}/stage`, { to, ...extra });
        setToast({ message: `Moved to ${humanize(to)}`, tone: 'success' });
        board.reload();
      } catch (err) {
        setToast({ message: err instanceof Error ? err.message : 'Could not move the card', tone: 'error' });
      } finally {
        setMoving(null);
        window.setTimeout(() => setToast(null), 3000);
      }
    },
    [board],
  );

  const onDrop = (to: StageKey, card: Card | undefined) => {
    setDragging(null);
    if (!card || card.stage_key === to) return;
    // Lost needs a reason, so it always goes through the dialog.
    if (to === 'lost') setMoving({ card, to });
    else void move(card, to);
  };

  const cardsById = useMemo(() => {
    const map = new Map<string, Card>();
    for (const column of board.data?.columns ?? []) for (const card of column.cards) map.set(card.id, card);
    return map;
  }, [board.data]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-semibold text-slate-900">{t('board')}</h1>

        <div className="relative ms-auto w-full sm:w-64">
          <Icon name="search" className="pointer-events-none absolute start-2 top-1/2 !text-[18px] -translate-y-1/2 text-slate-400" />
          <input
            className="field ps-9"
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('search')}
          />
        </div>

        {isManager ? (
          <select className="field w-auto" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} aria-label={t('owner')}>
            <option value="">All agents</option>
            {(team.data?.items ?? [])
              .filter((u) => u.is_active === 1)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        ) : null}

        <button type="button" className="btn-ghost !px-2" onClick={board.reload} aria-label="Refresh">
          <Icon name="refresh" />
        </button>
      </header>

      {board.error ? <ErrorNote message={board.error} onRetry={board.reload} /> : null}
      {board.loading && !board.data ? <Spinner label={t('loading')} /> : null}

      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex min-h-full gap-4">
          {stages.map((stage) => {
            const column = board.data?.columns.find((c) => c.stageKey === stage.key);
            return (
              <section
                key={stage.key}
                className="flex w-72 shrink-0 flex-col rounded-xl bg-slate-100/70"
                onDragOver={(e) => {
                  if (dragging) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(stage.key, cardsById.get(e.dataTransfer.getData('text/plain')));
                }}
                aria-label={stage.name}
              >
                <header className="flex items-center justify-between px-3 py-2.5">
                  <h2 className="text-sm font-semibold text-slate-700">{stage.name}</h2>
                  <span className="chip bg-white text-slate-500">{column?.total ?? 0}</span>
                </header>

                <div className="flex-1 space-y-2 px-2 pb-3">
                  {(column?.cards ?? []).map((card) => (
                    <article
                      key={card.id}
                      className={`card cursor-grab p-3 active:cursor-grabbing ${dragging === card.id ? 'opacity-50' : ''}`}
                      draggable={can('opportunities:move:own') || can('opportunities:move:any')}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', card.id);
                        setDragging(card.id);
                      }}
                      onDragEnd={() => setDragging(null)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link to={`/contacts/${card.contact_id}`} className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900">{card.full_name ?? 'Unnamed lead'}</p>
                          <p className="truncate text-xs text-slate-500">{card.project_name ?? 'No project named'}</p>
                        </Link>
                        <ScoreChip score={card.lead_score} />
                      </div>

                      <dl className="mt-2 space-y-1 text-xs text-slate-500">
                        <div className="flex items-center gap-1">
                          <Icon name="payments" className="!text-[14px]" />
                          <dd>{budgetLabel(card.budget_min_aed, card.budget_max_aed, card.budget_band)}</dd>
                        </div>
                        <div className="flex items-center gap-1">
                          <Icon name="person" className="!text-[14px]" />
                          <dd className="truncate">{card.owner_name ?? 'Unassigned'}</dd>
                        </div>
                      </dl>

                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="chip bg-slate-100 text-slate-600">{humanize(card.source)}</span>
                        {card.sub_status ? <span className="chip bg-slate-100 text-slate-600">{humanize(card.sub_status)}</span> : null}
                        {card.sla_breached === 1 ? (
                          <span className="chip bg-rose-100 text-rose-700">
                            <Icon name="timer_off" className="!text-[13px]" />
                            SLA
                          </span>
                        ) : null}
                        {card.dnc === 1 ? <span className="chip bg-rose-100 text-rose-700">DNC</span> : null}
                      </div>

                      <footer className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                        <span className="text-[11px] text-slate-400">{relativeTime(card.created_at)}</span>
                        <div className="flex items-center gap-1">
                          {card.phone_e164 ? (
                            <a href={`tel:${card.phone_e164}`} className="btn-ghost !px-1.5 !py-1" aria-label="Call">
                              <Icon name="call" className="!text-[16px]" />
                            </a>
                          ) : null}
                          <Link to={`/inbox?contact=${card.contact_id}`} className="btn-ghost !px-1.5 !py-1" aria-label="Open thread">
                            <Icon name="forum" className="!text-[16px]" />
                          </Link>
                          <MoveMenu card={card} stages={stages} onMove={(to) => (to === 'lost' ? setMoving({ card, to }) : void move(card, to))} />
                        </div>
                      </footer>
                    </article>
                  ))}

                  {column && column.cards.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-slate-400">{t('noResults')}</p>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <LostDialog
        card={moving?.to === 'lost' ? (moving?.card ?? null) : null}
        reasons={definition.data?.lostReasons ?? []}
        onCancel={() => setMoving(null)}
        onConfirm={(reason, note) => moving && void move(moving.card, 'lost', { lostReason: reason, lostNote: note })}
      />

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}

function MoveMenu({
  card,
  stages,
  onMove,
}: {
  card: Card;
  stages: PipelineDefinition['stages'];
  onMove: (to: StageKey) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className="btn-ghost !px-1.5 !py-1" onClick={() => setOpen((v) => !v)} aria-label="Move card">
        <Icon name="drive_file_move" className="!text-[16px]" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <ul className="absolute end-0 z-20 mt-1 w-48 overflow-hidden rounded-lg bg-white py-1 shadow-e2">
            {stages
              .filter((s) => s.key !== card.stage_key)
              .map((s) => (
                <li key={s.key}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-start text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setOpen(false);
                      onMove(s.key);
                    }}
                  >
                    {s.name}
                  </button>
                </li>
              ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Marking a lead Lost requires a reason, so the UI collects one. */
function LostDialog({
  card,
  reasons,
  onCancel,
  onConfirm,
}: {
  card: Card | null;
  reasons: string[];
  onCancel: () => void;
  onConfirm: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  return (
    <Modal
      open={Boolean(card)}
      title={t('markLost')}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button type="button" className="btn-primary" disabled={!reason} onClick={() => onConfirm(reason, note)}>
            {t('markLost')}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-slate-600">
        {card?.full_name ?? 'This lead'} will be closed. A reason is required.
      </p>
      <label className="label" htmlFor="lost-reason">
        {t('lostReason')}
      </label>
      <select id="lost-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="">Select a reason…</option>
        {reasons.map((r) => (
          <option key={r} value={r}>
            {humanize(r)}
          </option>
        ))}
      </select>
      <label className="label mt-3" htmlFor="lost-note">
        Note (optional)
      </label>
      <textarea id="lost-note" className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}
