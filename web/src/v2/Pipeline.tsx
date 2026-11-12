import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';

/**
 * The board.
 *
 * `docs/v2/pages.md` §12. Six columns, every card a lead, and a card dragged
 * to another column moves the lead — through the same endpoint the live CRM
 * uses, so the board and the lead page cannot disagree about what a stage
 * change means.
 *
 * Two things the design insists on and this keeps:
 *  - **Lost needs a reason.** Dropping a card on Lost opens the question
 *    rather than moving it quietly; a lost lead with no reason teaches nobody
 *    anything, and it is the one number an owner actually reads.
 *  - **Won is a celebration, not a filing cabinet.** The move is confirmed
 *    first, because it is the one nobody wants to undo.
 */

interface Card {
  id: string;
  contact_id: string;
  title?: string | null;
  full_name?: string | null;
  project_name?: string | null;
  owner_name?: string | null;
  lead_score?: number | null;
  score_band?: string | null;
  next_step_at?: string | null;
  is_vip?: number;
  budget_max_aed?: number | null;
}

interface Column {
  stageKey: string;
  stageName: string;
  position: number;
  total: number;
  cards: Card[];
}

const LABEL: Record<string, string> = {
  new_lead: 'New', attempted_contact: 'Called', engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting', deal_sent: 'Offer', won: 'Won', lost: 'Lost',
};

const LOST_REASONS = [
  { key: 'bought_elsewhere', label: 'Bought somewhere else' },
  { key: 'budget_too_low', label: 'Budget too low' },
  { key: 'just_browsing', label: 'Only looking' },
  { key: 'not_reachable', label: 'Never reachable' },
  { key: 'changed_plans', label: 'Changed their plans' },
  { key: 'other', label: 'Something else' },
];

export function V2Pipeline() {
  const { user } = useAuth();
  const board = useAsync<{ columns: Column[] }>(() => api.get('/api/pipeline/board'), []);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ id: string; to: string } | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const move = useCallback(async (id: string, to: string, lostReason?: string) => {
    setBusy(true);
    try {
      await api.post(`/api/pipeline/opportunities/${id}/stage`, {
        to,
        ...(lostReason ? { lostReason } : {}),
      });
      setSaid(`Moved to ${LABEL[to] ?? to}.`);
      board.reload();
    } catch (err) {
      setSaid(err instanceof Error ? err.message : 'That did not move.');
    } finally {
      setBusy(false);
      setAsking(null);
      setReason(null);
    }
  }, [board]);

  if (board.error) return <ErrorNote>{board.error}</ErrorNote>;
  if (!board.data) return <Spinner />;

  const columns = board.data.columns.filter((c) => c.stageKey !== 'lost');
  const lost = board.data.columns.find((c) => c.stageKey === 'lost');

  function drop(stageKey: string) {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id) return;
    /* Lost and Won both ask first — one needs a reason, the other is the one
       move nobody wants to make by accident. */
    if (stageKey === 'lost' || stageKey === 'won') {
      setAsking({ id, to: stageKey });
      return;
    }
    void move(id, stageKey);
  }

  return (
    <div className="v2-pipe">
      <header className="v2-pipe-head">
        <h1 className="v2-hi">Pipeline</h1>
        <p className="d-muted">
          Drag a lead to move it. {user?.role === 'agent' ? 'These are yours.' : 'Everyone’s.'}
        </p>
      </header>

      {said && <p className="v2-said">{said}</p>}

      <div className="v2-board">
        {[...columns, ...(lost ? [lost] : [])].map((column) => (
          <section
            key={column.stageKey}
            className={over === column.stageKey ? 'v2-col v2-col-over' : 'v2-col'}
            onDragOver={(e) => { e.preventDefault(); setOver(column.stageKey); }}
            onDragLeave={() => setOver((was) => (was === column.stageKey ? null : was))}
            onDrop={(e) => { e.preventDefault(); drop(column.stageKey); }}
          >
            <div className="v2-col-head">
              <span className={`v2-stage-dot v2-dot-${column.stageKey}`} />
              <h2>{LABEL[column.stageKey] ?? column.stageName}</h2>
              <span className="v2-col-n">{column.total}</span>
            </div>

            <ol className="v2-col-list">
              {column.cards.map((card) => (
                <li key={card.id}>
                  <div
                    className={dragging === card.id ? 'v2-card-lead v2-card-dragging' : 'v2-card-lead'}
                    draggable
                    onDragStart={() => setDragging(card.id)}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                  >
                    <Link to={`/v2/leads/${card.id}`} className="v2-card-main">
                      <Avatar name={card.full_name ?? card.title ?? '?'} />
                      <span className="v2-card-who">
                        <b>
                          {card.full_name ?? card.title ?? 'Unnamed lead'}
                          {card.is_vip === 1 && <span className="v2-vip">VIP</span>}
                        </b>
                        <span>{card.project_name ?? 'No project'}</span>
                      </span>
                    </Link>
                    <span className="v2-card-foot">
                      {card.owner_name && <span>{card.owner_name}</span>}
                      {card.next_step_at && (
                        <span className={new Date(card.next_step_at) < new Date() ? 'v2-late' : undefined}>
                          {new Date(card.next_step_at).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short',
                          })}
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
              {column.cards.length === 0 && <li className="v2-col-empty">Nothing here</li>}
              {column.total > column.cards.length && (
                <li className="v2-col-more">
                  <Link to={`/v2/leads?tab=all&stage=${column.stageKey}`}>
                    {column.total - column.cards.length} more
                  </Link>
                </li>
              )}
            </ol>
          </section>
        ))}
      </div>

      {asking && (
        <div className="v2-scrim" role="dialog" aria-modal="true">
          <div className="v2-dialog">
            {asking.to === 'lost' ? (
              <>
                <h2>Why is it lost?</h2>
                <p>A lost lead with no reason teaches nobody anything.</p>
                <div className="v2-chips">
                  {LOST_REASONS.map((one) => (
                    <button
                      key={one.key}
                      type="button"
                      className={reason === one.key ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
                      onClick={() => setReason(one.key)}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
                <div className="v2-dialog-acts">
                  <button
                    type="button"
                    className="d-btn d-danger d-solid"
                    disabled={!reason || busy}
                    onClick={() => reason && move(asking.id, 'lost', reason)}
                  >
                    Mark it lost
                  </button>
                  <button type="button" className="d-btn d-ghost" onClick={() => setAsking(null)}>
                    Keep it open
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>Won?</h2>
                <p>This is the one nobody wants to press by accident.</p>
                <div className="v2-dialog-acts">
                  <button
                    type="button"
                    className="d-btn d-primary"
                    disabled={busy}
                    onClick={() => move(asking.id, 'won')}
                  >
                    <Icon name="trophy" />Yes — they bought
                  </button>
                  <button type="button" className="d-btn d-ghost" onClick={() => setAsking(null)}>
                    Not yet
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
