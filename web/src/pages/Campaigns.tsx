import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatDateTime, humanize } from '../lib/format.js';
import type {
  CampaignDetail, CampaignOutcome, CampaignRow, DiallerCard, ListRow, TemplateRow,
} from '../lib/types.js';
import { Icon, type IconName } from '../design/index.js';
import { stageStyle } from '../design/stages.js';
import {
  Avatar, budgetLabel, Chip, Empty, ErrorNote, Field, Note, Panel, Score, Select, Spinner, StagePill,
  TextArea, Toolbar, useToast,
} from '../design/ui.js';

const OUTCOMES: { value: CampaignOutcome; label: string; icon: IconName; tone: string }[] = [
  { value: 'interested', label: 'Interested', icon: 'flame', tone: 'btn btn-primary' },
  { value: 'answered', label: 'Answered', icon: 'phone', tone: 'btn' },
  { value: 'no_answer', label: 'No answer', icon: 'phone-outgoing', tone: 'btn' },
  { value: 'busy', label: 'Busy', icon: 'clock', tone: 'btn' },
  { value: 'not_interested', label: 'Not interested', icon: 'circle-x', tone: 'btn' },
  { value: 'wrong_number', label: 'Wrong number', icon: 'ban', tone: 'btn' },
];

export function Campaigns() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const list = useAsync<{ items: CampaignRow[] }>(() => api.get('/api/campaigns'), []);
  const [creating, setCreating] = useState(Boolean(params.get('list')));

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;
  const items = list.data?.items ?? [];

  return (
    <>
      <Toolbar
        right={
          isManager ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              <span>New campaign</span>
            </button>
          ) : undefined
        }
      >
        <Chip on icon="megaphone">
          Campaigns
        </Chip>
      </Toolbar>

      {creating && (
        <Panel span={12} index={0} icon="plus" title="New campaign">
          <NewCampaign
            defaultListId={params.get('list')}
            onDone={() => { setCreating(false); list.reload(); }}
          />
        </Panel>
      )}

      <div className="dash">
        {list.loading && items.length === 0 && <Panel span={12} index={1}><Spinner /></Panel>}
        {!list.loading && items.length === 0 && (
          <Panel span={12} index={1}>
            <Empty
              icon="megaphone"
              title="No campaigns yet"
              hint="A call campaign feeds leads to an agent one at a time. A WhatsApp campaign sends an approved template, throttled."
            />
          </Panel>
        )}

        {items.map((row, index) => (
          <Panel span={6} index={index + 1} key={row.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name={row.kind === 'call' ? 'phone' : 'message-circle'} style={{ color: 'var(--primary)' }} />
              <b style={{ fontSize: 15 }}>{row.name}</b>
              <span className={statusClass(row.status)} style={{ marginInlineStart: 'auto' }}>
                {humanize(row.status)}
              </span>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              {row.list_name ?? 'No list'} · {row.done_count} of {row.total_members} done
            </p>

            {row.skipped_no_consent > 0 && (
              <p className="pill wait" style={{ marginBottom: 10 }}>
                {row.skipped_no_consent} skipped — no consent
              </p>
            )}
            {row.paused_reason && (
              <p className="err" style={{ display: 'block' }}>{row.paused_reason}</p>
            )}

            <div className="two">
              <Link className="btn" to={`/campaigns/${row.id}`}>
                Details
              </Link>
              {row.kind === 'call' && (
                <Link className="btn btn-primary" to={`/campaigns/${row.id}/dial`}>
                  <Icon name="phone" />
                  Start calling
                </Link>
              )}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}

function statusClass(status: string): string {
  if (status === 'running') return 'pill ok';
  if (status === 'paused') return 'pill due';
  if (status === 'completed') return 'pill';
  return 'pill info';
}

function NewCampaign({ defaultListId, onDone }: { defaultListId: string | null; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'call' | 'whatsapp'>('call');
  const [listId, setListId] = useState(defaultListId ?? '');
  const [templateName, setTemplateName] = useState('');
  const [throttle, setThrottle] = useState(20);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const lists = useAsync<{ items: ListRow[] }>(() => api.get('/api/lists'), []);
  const templates = useAsync<{ items: TemplateRow[] }>(() => api.get('/api/templates'), []);
  const approved = (templates.data?.items ?? []).filter((template) => template.status === 'APPROVED');

  async function create() {
    setBusy(true);
    try {
      const result = await api.post<{ id: string; warning: string; eligible: number; skipped: number }>(
        '/api/campaigns',
        {
          name,
          kind,
          listId,
          templateName: kind === 'whatsapp' ? templateName : null,
          templateLanguage: kind === 'whatsapp' ? (approved.find((t) => t.name === templateName)?.language ?? 'en') : null,
          throttlePerMinute: throttle,
        },
      );
      // The count shown here is the count the campaign will act on: membership
      // is fixed now, not re-guessed at send time.
      setWarning(result.warning);
      toast('Campaign created');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the campaign');
    } finally {
      setBusy(false);
    }
  }

  if (warning) {
    return (
      <>
        <p className={warning.includes('skipped') ? 'err' : 'note'} style={{ display: 'block' }}>
          {warning}
        </p>
        <Note>
          Contacts with no recorded WhatsApp consent are never messaged in bulk. Sending to them is
          the fastest way to get the company&rsquo;s WhatsApp number banned.
        </Note>
        <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} onClick={onDone}>
          Done
        </button>
      </>
    );
  }

  return (
    <>
      <div className="two">
        <Field label="Name">
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(event) => setKind(event.target.value as 'call' | 'whatsapp')}>
            <option value="call">Calls — worked by an agent, one at a time</option>
            <option value="whatsapp">WhatsApp — an approved template, throttled</option>
          </Select>
        </Field>
      </div>

      <Field label="List">
        <Select value={listId} onChange={(event) => setListId(event.target.value)}>
          <option value="">Choose a list…</option>
          {(lists.data?.items ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </Select>
      </Field>

      {kind === 'whatsapp' && (
        <>
          <Field label="Approved template">
            <Select value={templateName} onChange={(event) => setTemplateName(event.target.value)}>
              <option value="">Choose a template…</option>
              {approved.map((template) => (
                <option key={template.id} value={template.name}>
                  {template.name} ({template.language})
                </option>
              ))}
            </Select>
          </Field>
          {approved.length === 0 && (
            <p className="err" style={{ display: 'block' }}>
              No approved templates. Outside the 24-hour window Meta accepts nothing else, so a
              campaign cannot send without one.
            </p>
          )}
          <Field label="Messages per minute" hint="Keeps the send inside Meta's limits.">
            <input
              className="input"
              type="number"
              min={1}
              max={200}
              value={throttle}
              onChange={(event) => setThrottle(Number(event.target.value))}
            />
          </Field>
          <Note>
            The campaign pauses itself if the template&rsquo;s quality rating drops or too many
            messages start failing.
          </Note>
        </>
      )}

      <div className="two">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !name || !listId || (kind === 'whatsapp' && !templateName)}
          onClick={() => void create()}
        >
          Create
        </button>
      </div>
    </>
  );
}

/* ── Campaign detail ──────────────────────────────────────────────────── */

export function CampaignDetailScreen() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const detail = useAsync<CampaignDetail>(() => api.get(`/api/campaigns/${id}`), [id]);

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';

  if (detail.error) return <ErrorNote>{detail.error}</ErrorNote>;
  if (!detail.data) return <Spinner />;

  const { campaign, stats } = detail.data;

  async function act(action: 'start' | 'pause') {
    try {
      await api.post(`/api/campaigns/${id}/${action}`);
      toast(action === 'start' ? 'Campaign running' : 'Campaign paused');
      detail.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not change the campaign');
    }
  }

  return (
    <>
      <Toolbar
        right={
          isManager ? (
            campaign.status === 'running' ? (
              <button type="button" className="btn" onClick={() => void act('pause')}>
                <Icon name="ban" />
                <span>Pause</span>
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void act('start')}>
                <Icon name="play" />
                <span>Start</span>
              </button>
            )
          ) : undefined
        }
      >
        <Link className="chip" to="/campaigns">
          <Icon name="arrow-left" />
          All campaigns
        </Link>
        <span className={statusClass(campaign.status)}>{humanize(campaign.status)}</span>
        {campaign.kind === 'call' && (
          <Link className="chip on" to={`/campaigns/${id}/dial`}>
            <Icon name="phone" />
            Start calling
          </Link>
        )}
      </Toolbar>

      <div className="dash">
        <Panel span={12} index={0} icon="megaphone" title={campaign.name}>
          {campaign.paused_reason && (
            <p className="err" style={{ display: 'block' }}>{campaign.paused_reason}</p>
          )}
          <div className="vat-big">
            <div>
              <small>Contacted</small>
              <b>{stats.contactedPct}%</b>
            </div>
            <div>
              <small>Reached</small>
              <b>{stats.reachedPct}%</b>
            </div>
            <div>
              <small>Interested</small>
              <b>{stats.interested}</b>
            </div>
          </div>
          <div className="kv">
            <span>On the campaign</span>
            <b>{stats.total}</b>
          </div>
          <div className="kv">
            <span>Still to do</span>
            <b>{stats.pending}</b>
          </div>
          <div className="kv">
            <span>Skipped (no consent, or do-not-contact)</span>
            <b>{stats.skipped}</b>
          </div>
          <div className="kv">
            <span>Appointments since</span>
            <b>{stats.appointments}</b>
          </div>
        </Panel>

        <Panel span={6} index={1} icon="users" title="By agent">
          {stats.byAgent.length === 0 && <Empty icon="users" title="Nobody has worked it yet" />}
          {stats.byAgent.map((row) => (
            <div className="bank" key={row.userId ?? 'unassigned'}>
              <Avatar name={row.name} size={32} />
              <div>
                <b style={{ display: 'block' }}>{row.name ?? 'Unassigned'}</b>
                <small className="muted">
                  {row.done} done · {row.reached} reached
                </small>
              </div>
              <b>{row.interested} interested</b>
            </div>
          ))}
        </Panel>

        <Panel span={6} index={2} icon="pie-chart" title="Outcomes">
          {stats.outcomes.length === 0 && <Empty icon="pie-chart" title="No calls logged yet" />}
          {stats.outcomes.map((row) => (
            <div className="kv" key={row.outcome}>
              <span>{humanize(row.outcome)}</span>
              <b>{row.n}</b>
            </div>
          ))}
        </Panel>
      </div>
    </>
  );
}

/* ── The power dialler ────────────────────────────────────────────────── */

export function Dialler() {
  const { id = '' } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const [card, setCard] = useState<DiallerCard | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);

  // Pull the first lead as soon as the screen opens; that is the whole point.
  useEffect(() => {
    void next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function next() {
    setBusy(true);
    try {
      const result = await api.post<{ card: DiallerCard | null }>(`/api/campaigns/${id}/next`);
      setCard(result.card);
      setNotes('');
      if (!result.card) setFinished(true);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not load the next lead');
    } finally {
      setBusy(false);
    }
  }

  async function log(outcome: CampaignOutcome) {
    if (!card) return;
    setBusy(true);
    try {
      const result = await api.post<{ card: DiallerCard | null }>(`/api/campaigns/${id}/outcome`, {
        memberId: card.memberId,
        outcome,
        notes: notes || null,
      });
      toast(outcome === 'interested' ? 'Moved to Engaged — nice one' : `Logged: ${humanize(outcome)}`);
      setCard(result.card);
      setNotes('');
      if (!result.card) setFinished(true);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not log that');
    } finally {
      setBusy(false);
    }
  }

  if (finished && !card) {
    return (
      <Panel index={0} icon="check-circle-2" title="Campaign finished">
        <Empty icon="check-circle-2" title="Nothing left to call" hint="Every lead on this campaign has been worked." />
        <div className="two">
          <Link className="btn" to="/campaigns">
            All campaigns
          </Link>
          <Link className="btn btn-primary" to={`/campaigns/${id}`}>
            See the results
          </Link>
        </div>
      </Panel>
    );
  }

  if (!card) return <Spinner label="Finding the next lead…" />;

  const percent = card.progress.total > 0 ? Math.round((card.progress.done / card.progress.total) * 100) : 0;

  return (
    <>
      <Toolbar
        right={
          <button type="button" className="btn" disabled={busy} onClick={() => void next()}>
            <Icon name="chevron-right" />
            <span>Skip for now</span>
          </button>
        }
      >
        <Link className="chip" to={`/campaigns/${id}`}>
          <Icon name="arrow-left" />
          Campaign
        </Link>
        <span className="pill info">
          {card.progress.done} of {card.progress.total} done
        </span>
        {card.attempts > 1 && <span className="pill wait">Attempt {card.attempts}</span>}
      </Toolbar>

      <div className="dash">
        <Panel span={7} index={0}>
          <div className="p360-top" style={{ borderBottom: 0 }}>
            <Avatar name={card.fullName} size={60} colour={stageStyle(card.stageKey).colour} />
            <h4>{card.fullName ?? 'Unnamed lead'}</h4>
            <p>{card.phone ?? 'No number'}</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              {card.stageKey && <StagePill stage={card.stageKey} label={humanize(card.stageKey)} />}
              <Score value={card.leadScore} />
            </div>
          </div>

          {card.phone && (
            <a className="btn btn-primary btn-block" href={`tel:${card.phone}`} style={{ marginTop: 14 }}>
              <Icon name="phone" />
              Call {card.fullName ?? 'this lead'}
            </a>
          )}
          <div className="two" style={{ marginTop: 10 }}>
            <Link className="btn btn-wa" to={`/inbox?contact=${card.contactId}`}>
              <Icon name="message-circle" />
              WhatsApp
            </Link>
            <Link className="btn" to={`/contacts/${card.contactId}`}>
              <Icon name="external-link" />
              Full record
            </Link>
          </div>

          <dl className="facts" style={{ marginTop: 16 }}>
            <dt>Project</dt>
            <dd>{card.projectName ?? '—'}</dd>
            <dt>Budget</dt>
            <dd>{budgetLabel(card.budgetMinAed, card.budgetMaxAed, card.budgetBand)}</dd>
            <dt>Language</dt>
            <dd>{(card.language ?? 'en').toUpperCase()}</dd>
            <dt>Last contacted</dt>
            <dd>{card.lastContactedAt ? formatDateTime(card.lastContactedAt) : 'Never'}</dd>
          </dl>
        </Panel>

        <Panel span={5} index={1} icon="check-square" title="How did it go?">
          <div className="funnel-bar" style={{ height: 10, marginBottom: 14 }}>
            <i className="go" style={{ ['--w' as string]: `${percent}%`, width: `${percent}%` }} />
          </div>

          <TextArea
            rows={4}
            placeholder="Anything worth remembering"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />

          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {OUTCOMES.map((outcome) => (
              <button
                key={outcome.value}
                type="button"
                className={outcome.tone}
                disabled={busy}
                onClick={() => void log(outcome.value)}
              >
                <Icon name={outcome.icon} />
                {outcome.label}
              </button>
            ))}
          </div>

          <Note>&ldquo;Interested&rdquo; moves the lead straight into the pipeline at Engaged.</Note>
        </Panel>
      </div>
    </>
  );
}
