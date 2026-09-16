import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { formatDateTime, humanize } from '../lib/format.js';
import type { Card, Contact360, StageKey } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { stageStyle } from '../design/stages.js';
import { Avatar, budgetLabel, Drawer, DrawerHead, Score, Spinner, StagePill, Tag } from '../design/ui.js';

/**
 * The lead drawer: everything about one lead, slid in over the board.
 * Ported from `openLead()` in design/emir-crm-design.html.
 */

const STAGE_ORDER: StageKey[] = [
  'new_lead', 'attempted_contact', 'engaged_qualified',
  'appointment_scheduled', 'deal_sent', 'won',
];

/** Timeline dot colour by activity type, so the trail reads at a glance. */
function activityColour(type: string): string {
  if (type.startsWith('message') || type.includes('whatsapp')) return 'var(--wa)';
  if (type.includes('stage')) return 'var(--s-apt)';
  if (type.includes('assign')) return 'var(--s-eng)';
  if (type.includes('brochure') || type.includes('open')) return 'var(--hot)';
  return 'var(--s-new)';
}

export function LeadDrawer({
  card, onClose, onOpenThread,
}: {
  card: Card | null;
  onClose: () => void;
  onOpenThread: (contactId: string) => void;
}) {
  const contactId = card?.contact_id ?? null;
  const detail = useAsync<Contact360>(
    () => (contactId ? api.get(`/api/contacts/${contactId}`) : Promise.resolve(null as never)),
    [contactId],
  );

  const style = stageStyle(card?.stage_key);
  const reached = card ? STAGE_ORDER.indexOf(card.stage_key) : -1;

  return (
    <Drawer open={Boolean(card)} onClose={onClose} label="Lead details">
      {card && (
        <>
          <DrawerHead onClose={onClose}>
            <Avatar name={card.full_name} size={44} colour={style.colour} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 16 }}>{card.full_name ?? 'Unnamed lead'}</b>
              <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>
                {card.phone_e164 ?? 'No number'} · {humanize(card.source)}
              </div>
            </div>
          </DrawerHead>

          <div className="drawer-body">
            <StagePill stage={card.stage_key} label={humanize(card.stage_key)} />
            <div className="stagebar" aria-hidden>
              {STAGE_ORDER.map((stage, i) => (
                <span
                  key={stage}
                  style={
                    // A lost lead gets an empty bar: it did not reach these
                    // stages, it stopped.
                    i <= reached && card.stage_key !== 'lost'
                      ? { background: stageStyle(stage).colour }
                      : undefined
                  }
                />
              ))}
            </div>

            {detail.data?.contact.ai_summary && (
              <div className="ai">
                <b>
                  <Icon name="sparkles" />
                  AI summary
                </b>
                <p>{detail.data.contact.ai_summary}</p>
              </div>
            )}

            <dl className="facts">
              <dt>Project</dt>
              <dd>{card.project_name ?? '—'}</dd>
              <dt>Budget</dt>
              <dd>{budgetLabel(card.budget_min_aed, card.budget_max_aed, card.budget_band)}</dd>
              <dt>Unit type</dt>
              <dd>{humanize(card.unit_type)}</dd>
              <dt>Emirate</dt>
              <dd>{humanize(card.emirate)}</dd>
              <dt>Timeline</dt>
              <dd>{humanize(card.timeline)}</dd>
              <dt>Lead score</dt>
              <dd>
                <Score value={card.lead_score} /> / 100
              </dd>
              <dt>Owner</dt>
              <dd>{card.owner_name ?? 'Unassigned'}</dd>
              <dt>Campaign</dt>
              <dd>{card.campaign_name ?? '—'}</dd>
            </dl>

            {(detail.data?.tags.length ?? 0) > 0 && (
              <>
                <div className="sec-t">Tags</div>
                <div className="tags">
                  {detail.data?.tags.map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </div>
              </>
            )}

            <div className="sec-t">Activity</div>
            {detail.loading && <Spinner label="Loading the trail…" />}
            {detail.data && detail.data.activities.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>Nothing recorded yet.</p>
            )}
            {detail.data && detail.data.activities.length > 0 && (
              <div className="timeline">
                {detail.data.activities.slice(0, 20).map((activity) => (
                  <div className="ev" key={activity.id} style={{ ['--c' as string]: activityColour(activity.type) }}>
                    {activity.title}
                    <small>
                      {formatDateTime(activity.created_at)}
                      {activity.user_name ? ` · ${activity.user_name}` : ''}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="drawer-foot">
            {card.phone_e164 ? (
              <a className="btn" href={`tel:${card.phone_e164}`}>
                <Icon name="phone" />
                Call
              </a>
            ) : (
              <button className="btn" type="button" disabled>
                <Icon name="phone" />
                No number
              </button>
            )}
            <button
              className="btn btn-wa"
              type="button"
              onClick={() => {
                onClose();
                onOpenThread(card.contact_id);
              }}
            >
              <Icon name="message-circle" />
              WhatsApp
            </button>
            <Link className="btn btn-primary" to={`/contacts/${card.contact_id}`} onClick={onClose}>
              <Icon name="external-link" />
              Open
            </Link>
          </div>
        </>
      )}
    </Drawer>
  );
}
