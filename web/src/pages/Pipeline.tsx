import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { humanize } from '../lib/format.js';
import { useShellSearch } from '../components/Layout.js';
import type { BoardColumn, Card, PipelineDefinition, StageKey, UserRow } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { sourceStyle, stageStyle } from '../design/stages.js';
import {
  Avatar, budgetLabel, Chip, Empty, ErrorNote, Field, Score, Select, Spinner, Tag, TextArea,
  Toolbar, useCountdown, useToast,
} from '../design/ui.js';
import { LeadDrawer } from '../components/LeadDrawer.js';

/**
 * The Kanban board.
 *
 * Cards drag on a pointer device and move through an explicit menu everywhere
 * else, because the mobile-first path cannot depend on dragging. Marking a lead
 * Lost always goes through the dialog: the specification requires a reason.
 *
 * Ported from the pipeline view in design/emir-crm-design.html.
 */
export function Pipeline() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const search = useShellSearch();
  const debounced = useDebounced(search.value);

  const [ownerFilter, setOwnerFilter] = useState('');
  const [hotOnly, setHotOnly] = useState(false);
  const [breachedOnly, setBreachedOnly] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<StageKey | null>(null);
  const [losing, setLosing] = useState<Card | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);

  const definition = useAsync<PipelineDefinition>(() => api.get('/api/pipeline/definition'), []);
  const board = useAsync<{ columns: BoardColumn[] }>(
    () => api.get(`/api/pipeline/board${qs({ search: debounced, ownerUserId: ownerFilter })}`),
    [debounced, ownerFilter],
  );
  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';
  const team = useAsync<{ items: UserRow[] }>(
    () => (isManager ? api.get('/api/users') : Promise.resolve({ items: [] })),
    [isManager],
  );

  const cardsById = useMemo(() => {
    const map = new Map<string, Card>();
    for (const column of board.data?.columns ?? []) for (const card of column.cards) map.set(card.id, card);
    return map;
  }, [board.data]);

  const move = useCallback(
    async (card: Card, to: StageKey, extra: { lostReason?: string; lostNote?: string } = {}) => {
      try {
        await api.post(`/api/pipeline/opportunities/${card.id}/stage`, { to, ...extra });
        toast(`${card.full_name ?? 'Lead'} moved to ${humanize(to)}`);
        board.reload();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not move the card');
      } finally {
        setLosing(null);
      }
    },
    [board, toast],
  );

  function drop(to: StageKey) {
    const card = dragging ? cardsById.get(dragging) : undefined;
    setDragging(null);
    setOver(null);
    if (!card || card.stage_key === to) return;
    if (to === 'lost') setLosing(card);
    else void move(card, to);
  }

  /** Client-side chips; the server already applied search and owner. */
  function visibleCards(cards: Card[]): Card[] {
    return cards.filter(
      (card) => (!hotOnly || card.lead_score >= 70) && (!breachedOnly || card.sla_breached === 1),
    );
  }

  if (board.error) return <ErrorNote>{board.error}</ErrorNote>;
  if (board.loading && !board.data) return <Spinner />;

  const stages = definition.data?.stages ?? [];
  const columns = board.data?.columns ?? [];
  const openCard = openCardId ? cardsById.get(openCardId) ?? null : null;

  return (
    <>
      <Toolbar
        right={
          isManager ? (
            <Select
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              aria-label="Filter by agent"
              style={{ width: 'auto' }}
            >
              <option value="">All agents</option>
              {(team.data?.items ?? [])
                .filter((member) => member.is_active === 1)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </Select>
          ) : undefined
        }
      >
        <Chip
          icon="user"
          on={ownerFilter === user?.id}
          onClick={() => setOwnerFilter(ownerFilter === user?.id ? '' : (user?.id ?? ''))}
        >
          My leads
        </Chip>
        <Chip icon="flame" on={hotOnly} onClick={() => setHotOnly(!hotOnly)}>
          Hot only
        </Chip>
        <Chip icon="timer" on={breachedOnly} onClick={() => setBreachedOnly(!breachedOnly)}>
          Missed SLA
        </Chip>
      </Toolbar>

      <div className="board">
        {stages.map((stage) => {
          const column = columns.find((item) => item.stageKey === stage.key);
          const cards = visibleCards(column?.cards ?? []);
          const style = stageStyle(stage.key);
          return (
            <section
              className="col"
              key={stage.key}
              aria-label={stage.name}
              style={{ ['--c' as string]: style.colour }}
            >
              <div className="col-head">
                <div className="t">
                  <Icon name={style.icon} />
                  {stage.name}
                  <span className="n">{column?.total ?? 0}</span>
                </div>
                <div className="v">{cards.length ? `${cards.length} shown` : 'No leads here'}</div>
              </div>
              <div
                className={over === stage.key ? 'col-body over' : 'col-body'}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOver(stage.key);
                }}
                onDragLeave={() => setOver((current) => (current === stage.key ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  drop(stage.key);
                }}
              >
                {cards.map((card, index) => (
                  <BoardCard
                    key={card.id}
                    card={card}
                    index={index}
                    dragging={dragging === card.id}
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => setDragging(null)}
                    onOpen={() => setOpenCardId(card.id)}
                    stages={stages}
                    onMove={(to) => (to === 'lost' ? setLosing(card) : void move(card, to))}
                  />
                ))}
                {cards.length === 0 && (
                  <p className="muted" style={{ textAlign: 'center', fontSize: 12, padding: '18px 0' }}>
                    Nothing here yet
                  </p>
                )}
              </div>
            </section>
          );
        })}
        {stages.length === 0 && <Empty icon="kanban" title="The pipeline has no stages configured" />}
      </div>

      <LostDialog
        card={losing}
        reasons={definition.data?.lostReasons ?? []}
        onCancel={() => setLosing(null)}
        onConfirm={(reason, note) => losing && void move(losing, 'lost', { lostReason: reason, lostNote: note })}
      />

      <LeadDrawer
        card={openCard}
        onClose={() => setOpenCardId(null)}
        onOpenThread={(contactId) => navigate(`/inbox?contact=${contactId}`)}
      />
    </>
  );
}

function BoardCard({
  card, index, dragging, onDragStart, onDragEnd, onOpen, stages, onMove,
}: {
  card: Card;
  index: number;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  stages: PipelineDefinition['stages'];
  onMove: (to: StageKey) => void;
}) {
  const style = stageStyle(card.stage_key);
  const source = sourceStyle(card.source);
  // Workflow A reassigns at five minutes, so the card counts down to that.
  const slaDeadline =
    card.sla_breached === 1 || card.stage_key !== 'new_lead'
      ? null
      : new Date(new Date(card.created_at).getTime() + 5 * 60 * 1000).toISOString();
  const countdown = useCountdown(slaDeadline);
  const rawBudget = budgetLabel(card.budget_min_aed, card.budget_max_aed, card.budget_band);
  const budget = rawBudget === '—' ? null : rawBudget;

  return (
    <article
      className={dragging ? 'card dragging' : 'card'}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${card.full_name ?? 'Lead'}, ${card.project_name ?? 'no project'}`}
      style={{ ['--c' as string]: style.colour, ['--i' as string]: index }}
    >
      <div className="h">
        <span className="name">{card.full_name ?? 'Unnamed lead'}</span>
        <Score value={card.lead_score} />
      </div>
      <div className="proj">
        {card.project_name ?? 'No project yet'}
        {/* An em dash on its own line reads as a mistake, so an unknown budget
            simply does not print. */}
        {budget && (
          <>
            <br />
            <b style={{ color: 'var(--ink)' }}>{budget}</b>
          </>
        )}
      </div>
      <div className="tags">
        {card.sub_status && <Tag>{humanize(card.sub_status)}</Tag>}
        {card.language && card.language !== 'en' && <Tag>lang:{card.language}</Tag>}
        {card.dnc === 1 && <Tag>DNC</Tag>}
      </div>
      <div className="f">
        <span className="src">
          <span className="ch" style={{ background: source.colour }}>
            <Icon name={source.icon} />
          </span>
          {source.label}
        </span>

        {card.sla_breached === 1 ? (
          <span className="sla">
            <Icon name="timer" />
            SLA
          </span>
        ) : countdown ? (
          <span className="sla">
            <Icon name="timer" />
            {countdown}
          </span>
        ) : card.last_inbound_at ? (
          <span className="replied">
            <Icon name="check" />
            Replied
          </span>
        ) : null}

        <span onClick={(event) => event.stopPropagation()}>
          <MoveMenu card={card} stages={stages} onMove={onMove} />
        </span>
        <Avatar name={card.owner_name} size={24} className="" />
      </div>
    </article>
  );
}

/** The keyboard and touch path for moving a card. */
function MoveMenu({
  card, stages, onMove,
}: { card: Card; stages: PipelineDefinition['stages']; onMove: (to: StageKey) => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [at, setAt] = useState<Placement | null>(null);
  const open = at !== null;

  /*
   * Rendered into document.body rather than beside the button.
   *
   * The card sits inside `.col-body`, which scrolls vertically, inside
   * `.board`, which scrolls horizontally. An absolutely positioned menu is
   * therefore clipped by both — it appeared cut off at the edge of the column
   * and ran off the side of the screen. A fixed-position portal is outside
   * every scroll container, so nothing can trim it.
   */
  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAt(placeMenu(rect, MENU_WIDTH, document.documentElement.dir === 'rtl'));
  }, []);

  /*
   * A fixed menu does not travel with the column it was opened from, so it
   * would hang in mid-air the moment anything scrolled. Closing is both
   * simpler and less surprising than chasing the button.
   */
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setAt(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <span style={{ display: 'inline-flex' }}>
      <button
        ref={buttonRef}
        type="button"
        className="rowbtn"
        onClick={() => (open ? setAt(null) : place())}
        aria-label={`Move ${card.full_name ?? 'this lead'} to another stage`}
        aria-expanded={open}
      >
        <Icon name="git-compare" size={15} />
      </button>
      {at
        && createPortal(
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 60 }}
              onClick={() => setAt(null)}
              aria-hidden
            />
            <ul
              style={{
                position: 'fixed', left: at.left, zIndex: 61, listStyle: 'none',
                ...(at.top !== undefined ? { top: at.top } : { bottom: at.bottom }),
                margin: 0, padding: 6, width: MENU_WIDTH, borderRadius: 14,
                maxHeight: at.maxHeight, overflowY: 'auto',
                background: 'var(--glass-strong)', border: '1px solid var(--glass-line)',
                boxShadow: 'var(--shadow)',
              }}
            >
              {stages
                .filter((stage) => stage.key !== card.stage_key)
                .map((stage) => (
                  <li key={stage.key}>
                    <button
                      type="button"
                      className="task"
                      style={{ width: '100%', background: 'none', border: 0, marginBottom: 2 }}
                      onClick={() => {
                        setAt(null);
                        onMove(stage.key);
                      }}
                    >
                      <Icon name={stageStyle(stage.key).icon} size={15} />
                      {stage.name}
                    </button>
                  </li>
                ))}
            </ul>
          </>,
          document.body,
        )}
    </span>
  );
}

const MENU_WIDTH = 200;
/** Breathing room from the edge of the screen, and the space a menu needs to be worth opening downwards. */
const EDGE = 8;
const MIN_ROOM = 160;

type Placement = { left: number; top?: number; bottom?: number; maxHeight: number };

/**
 * Where to put the menu, given where the button is.
 *
 * Exported for its tests: the cases that matter are a button near the right
 * edge, near the bottom, and in a right-to-left layout, and all three are
 * awkward to reproduce in a browser.
 */
export function placeMenu(
  rect: { top: number; bottom: number; left: number; right: number },
  width: number,
  rtl: boolean,
  viewport: { width: number; height: number } = { width: window.innerWidth, height: window.innerHeight },
): Placement {
  // Aligned to the button's near edge, then pulled back on screen if that put
  // it outside — which is what happened to a card in the first column.
  const preferred = rtl ? rect.left : rect.right - width;
  const left = Math.max(EDGE, Math.min(preferred, viewport.width - width - EDGE));

  const below = viewport.height - rect.bottom - EDGE - 6;
  if (below >= MIN_ROOM) {
    return { left, top: rect.bottom + 6, maxHeight: below };
  }

  // Not enough room underneath: open upwards instead, and never taller than
  // the space there actually is.
  const above = rect.top - EDGE - 6;
  return { left, bottom: viewport.height - rect.top + 6, maxHeight: Math.max(MIN_ROOM, above) };
}

/** Marking a lead Lost requires a reason, so the UI insists on one. */
function LostDialog({
  card, reasons, onCancel, onConfirm,
}: {
  card: Card | null;
  reasons: string[];
  onCancel: () => void;
  onConfirm: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  if (!card) return null;

  return (
    <>
      <div className="scrim show" onClick={onCancel} aria-hidden />
      <div
        className="newlead show"
        role="dialog"
        aria-label="Mark lead as lost"
        style={{ top: '18vh', left: '50%', right: 'auto', transform: 'translateX(-50%)', width: 'min(400px, calc(100% - 28px))' }}
      >
        <b>
          <Icon name="circle-x" style={{ color: 'var(--s-lost)' }} />
          Mark {card.full_name ?? 'this lead'} as lost
        </b>
        <p>This closes the opportunity. A reason is required and is recorded in the audit trail.</p>
        <Field label="Lost reason">
          <Select value={reason} onChange={(event) => setReason(event.target.value)}>
            <option value="">Select a reason…</option>
            {reasons.map((item) => (
              <option key={item} value={item}>
                {humanize(item)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note (optional)">
          <TextArea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!reason}
            onClick={() => onConfirm(reason, note)}
          >
            Mark lost
          </button>
        </div>
      </div>
    </>
  );
}
