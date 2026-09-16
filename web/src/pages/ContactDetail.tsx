import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatDateTime, humanize } from '../lib/format.js';
import type { Contact360 } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { sourceStyle, stageStyle } from '../design/stages.js';
import {
  ago, Avatar, budgetLabel, Empty, ErrorNote, Field, Panel, Score, Select, Spinner, StagePill, Tag,
  TextArea, Toolbar, useToast,
} from '../design/ui.js';

const TASK_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'other'] as const;

/** Timeline dot colour by activity type. */
function activityColour(type: string): string {
  if (type.startsWith('message') || type.includes('whatsapp')) return 'var(--wa)';
  if (type.includes('stage')) return 'var(--s-apt)';
  if (type.includes('assign')) return 'var(--s-eng)';
  if (type.includes('brochure') || type.includes('open')) return 'var(--hot)';
  return 'var(--s-new)';
}

/**
 * Contact 360: one person, everything known about them, and the quick actions
 * an agent needs without leaving the page.
 */
export function ContactDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const detail = useAsync<Contact360>(() => api.get(`/api/contacts/${id}`), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/contacts/${id}/notes`, { body: note });
      setNote('');
      toast('Note added');
      detail.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the note');
    } finally {
      setBusy(false);
    }
  }

  async function setDnc(dnc: boolean) {
    setBusy(true);
    try {
      await api.post(`/api/contacts/${id}/dnc`, { dnc, reason: dnc ? 'Set by an agent' : 'Cleared by an agent' });
      toast(dnc ? 'Added to do-not-contact' : 'Removed from do-not-contact');
      detail.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change the consent status');
    } finally {
      setBusy(false);
    }
  }

  async function completeTask(taskId: string) {
    try {
      await api.post(`/api/tasks/${taskId}/complete`);
      toast('Task completed');
      detail.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not complete the task');
    }
  }

  if (detail.error) return <ErrorNote>{detail.error}</ErrorNote>;
  if (!detail.data) return <Spinner />;

  const { contact, opportunities, activities, tasks, tags, consents } = detail.data;
  const opportunity = opportunities[0];
  const style = stageStyle(opportunity?.stage_key);
  const source = sourceStyle((contact.first_source as string) ?? null);
  const openTasks = tasks.filter((task) => !task.completed_at);

  return (
    <>
      <Toolbar
        right={
          <>
            {contact.phone_e164 && (
              <a className="btn" href={`tel:${contact.phone_e164}`}>
                <Icon name="phone" />
                <span>Call</span>
              </a>
            )}
            <Link className="btn btn-wa" to={`/inbox?contact=${contact.id}`}>
              <Icon name="message-circle" />
              <span>WhatsApp</span>
            </Link>
          </>
        }
      >
        <Link className="chip" to="/contacts">
          <Icon name="arrow-left" />
          All contacts
        </Link>
      </Toolbar>

      <div className="dash">
        <Panel span={4} index={1}>
          <div className="p360-top" style={{ borderBottom: 0 }}>
            <Avatar name={contact.full_name} size={60} colour={style.colour} />
            <h4>{contact.full_name ?? 'Unnamed contact'}</h4>
            <p>{contact.phone_e164 ?? contact.email ?? '—'}</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              {opportunity && <StagePill stage={opportunity.stage_key} label={humanize(opportunity.stage_key)} />}
              <Score value={contact.lead_score} />
            </div>
          </div>

          {contact.ai_summary && (
            <div className="ai">
              <b>
                <Icon name="sparkles" />
                AI summary
              </b>
              <p>{contact.ai_summary}</p>
            </div>
          )}

          <dl className="facts" style={{ marginTop: 14 }}>
            <dt>Source</dt>
            <dd>{source.label}</dd>
            <dt>Project</dt>
            <dd>{(opportunity?.project_name as string) ?? '—'}</dd>
            <dt>Budget</dt>
            <dd>
              {budgetLabel(
                (opportunity?.budget_min_aed as number) ?? null,
                (opportunity?.budget_max_aed as number) ?? null,
                (opportunity?.budget_band as string) ?? null,
              )}
            </dd>
            <dt>Purpose</dt>
            <dd>{humanize((opportunity?.purpose as string) ?? null)}</dd>
            <dt>Timeline</dt>
            <dd>{humanize((opportunity?.timeline as string) ?? null)}</dd>
            <dt>Language</dt>
            <dd>{contact.language.toUpperCase()}</dd>
            <dt>Owner</dt>
            <dd>{contact.owner_name ?? 'Unassigned'}</dd>
            <dt>Campaign</dt>
            <dd>{(opportunity?.campaign_name as string) ?? '—'}</dd>
          </dl>

          {tags.length > 0 && (
            <>
              <div className="sec-t">Tags</div>
              <div className="tags">
                {tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            </>
          )}

          <div className="sec-t">Consent</div>
          {consents.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No consent recorded.</p>}
          {consents.map((consent) => (
            <div className="kv" key={`${consent.channel}-${consent.created_at}`}>
              <span>
                {humanize(consent.channel)}
                {/* The text shown to the lead is stored, as UAE PDPL requires. */}
                {consent.consent_text && (
                  <small className="muted" style={{ display: 'block' }}>{consent.consent_text}</small>
                )}
              </span>
              <b className={consent.granted ? 'pill ok' : 'pill due'}>{consent.granted ? 'Given' : 'Withdrawn'}</b>
            </div>
          ))}

          <div style={{ marginTop: 14 }}>
            {contact.dnc === 1 ? (
              <>
                <p className="err" style={{ display: 'block' }}>
                  On the do-not-contact list. Automated messages are suppressed.
                </p>
                <button type="button" className="btn" disabled={busy} onClick={() => void setDnc(false)}>
                  <Icon name="circle-check" />
                  Remove from DNC
                </button>
              </>
            ) : (
              <button type="button" className="btn" disabled={busy} onClick={() => void setDnc(true)}>
                <Icon name="ban" />
                Add to do-not-contact
              </button>
            )}
          </div>
        </Panel>

        <Panel span={8} index={2} icon="activity" title="Activity">
          {activities.length === 0 ? (
            <Empty icon="activity" title="Nothing recorded yet" />
          ) : (
            <div className="timeline">
              {activities.map((activity) => (
                <div className="ev" key={activity.id} style={{ ['--c' as string]: activityColour(activity.type) }}>
                  {activity.title}
                  {activity.body && (
                    <div className="muted" style={{ fontSize: 12.5 }}>{activity.body}</div>
                  )}
                  <small>
                    {formatDateTime(activity.created_at)}
                    {activity.user_name ? ` · ${activity.user_name}` : ''}
                  </small>
                </div>
              ))}
            </div>
          )}

          <div className="sec-t">Add an internal note</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <TextArea
              rows={2}
              placeholder="Visible to your team only"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void addNote()}
              disabled={busy || !note.trim()}
            >
              <Icon name="send" />
            </button>
          </div>
        </Panel>

        <Panel span={6} index={3} icon="check-square" title={`Tasks (${openTasks.length} open)`}>
          {tasks.length === 0 && <Empty icon="check-circle-2" title="No tasks" />}
          {tasks.map((task) => (
            <div className="task" key={task.id}>
              <button
                type="button"
                className="rowbtn"
                onClick={() => void completeTask(task.id)}
                disabled={Boolean(task.completed_at)}
                aria-label={task.completed_at ? 'Already done' : 'Mark done'}
              >
                <Icon name={task.completed_at ? 'check-circle-2' : 'circle'} size={16} />
              </button>
              <span style={{ textDecoration: task.completed_at ? 'line-through' : undefined }}>{task.title}</span>
              <span className="due">{task.completed_at ? 'Done' : ago(task.due_at)}</span>
            </div>
          ))}
          <NewTask contactId={contact.id} opportunityId={opportunity?.id ?? null} onCreated={detail.reload} />
        </Panel>

        <Panel span={6} index={4} icon="layers" title="Inquiries">
          {opportunities.length === 0 && <Empty icon="kanban" title="No opportunities" />}
          {opportunities.map((item) => (
            <div className="kv" key={item.id}>
              <span>
                {(item.project_name as string) ?? 'No project'}
                <small className="muted" style={{ display: 'block' }}>
                  {humanize(item.source as string)} · {formatDateTime(item.created_at as string)}
                </small>
              </span>
              <b>
                <span
                  className="pill"
                  style={{ color: stageStyle(item.stage_key).colour, borderColor: 'transparent' }}
                >
                  {humanize(item.stage_key)}
                </span>
              </b>
            </div>
          ))}
          {user?.role !== 'agent' && (
            <p className="note" style={{ marginTop: 12 }}>
              <Icon name="info" />
              <span>A re-inquiry within 30 days on the same project is recorded here, not opened again.</span>
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}

function NewTask({
  contactId, opportunityId, onCreated,
}: { contactId: string; opportunityId: string | null; onCreated: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof TASK_TYPES)[number]>('call');
  const [title, setTitle] = useState('');
  const [inHours, setInHours] = useState(2);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await api.post(`/api/contacts/${contactId}/tasks`, {
        opportunityId,
        type,
        title: title || `Follow up by ${type}`,
        priority: 'normal',
        dueAt: new Date(Date.now() + inHours * 3600 * 1000).toISOString(),
      });
      setTitle('');
      setOpen(false);
      toast('Task added');
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add the task');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        <Icon name="plus" />
        Add a task
      </button>
    );
  }

  return (
    <div className="inv-calc">
      <Field label="What">
        <Select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          {TASK_TYPES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title">
        <input
          className="input"
          value={title}
          placeholder={`Follow up by ${type}`}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="Due in">
        <Select value={inHours} onChange={(event) => setInHours(Number(event.target.value))}>
          <option value={1}>1 hour</option>
          <option value={2}>2 hours</option>
          <option value={24}>Tomorrow</option>
          <option value={72}>In 3 days</option>
        </Select>
      </Field>
      <div className="two">
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
          Add task
        </button>
      </div>
    </div>
  );
}
