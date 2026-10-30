import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Button } from '../design/forms.js';
import { Icon, SkeletonRows } from '../design/index.js';
import {
  Chip, Empty, ErrorNote, Field, Panel, Select, Spinner, TextArea, Toolbar, useToast,
} from '../design/ui.js';
import { humanize, relativeTime } from '../lib/format.js';

/**
 * Email campaigns: the same email to a list, slowly.
 *
 * The screen is built around the one number that matters before you press
 * send — how many people will actually get it, and who will be skipped and
 * why. Everything else is reporting after the fact.
 */

interface Campaign {
  id: string;
  name: string;
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'cancelled';
  subject: string;
  list_name: string | null;
  created_by: string | null;
  throttle_per_hour: number;
  total_members: number;
  sent_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  unsubscribed_count: number;
  failed_count: number;
  created_at: string;
}

interface Audience {
  willReceive: number;
  skipped: Array<{ reason: string; count: number }>;
  minutes: number;
}

const STATUS_CLASS: Record<Campaign['status'], string> = {
  draft: 'pill',
  scheduled: 'pill s-apt',
  sending: 'pill s-eng',
  paused: 'pill s-att',
  sent: 'pill s-won',
  cancelled: 'pill s-lost',
};

export function EmailCampaigns() {
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const campaigns = useAsync<{ items: Campaign[] }>(() => api.get('/api/email/campaigns'), [reloadKey]);

  async function act(id: string, what: 'start' | 'pause') {
    try {
      await api.post(`/api/email/campaigns/${id}/${what}`);
      toast(what === 'start' ? 'Sending has begun' : 'Paused');
      setReloadKey((n) => n + 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work');
    }
  }

  const items = campaigns.data?.items ?? [];

  return (
    <>
      <Toolbar
        right={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New campaign
          </Button>
        }
      >
        <Chip on icon="mail">Email campaigns</Chip>
      </Toolbar>

      {campaigns.error && <ErrorNote>{campaigns.error}</ErrorNote>}

      <Panel index={1} icon="mail" title="Campaigns">
        {!campaigns.data && <SkeletonRows rows={4} />}
        {campaigns.data && items.length === 0 && (
          <Empty
            icon="mail"
            title="No campaigns yet"
            hint="A campaign sends one email to a saved list, slowly, and only to people who agreed to be emailed."
          />
        )}

        {items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className="money">Sent</th>
                  <th className="money">Opened</th>
                  <th className="money">Clicked</th>
                  <th className="money">Bounced</th>
                  <th className="money">Unsubscribed</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.name}</b>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {row.subject}
                        {row.list_name ? ` · ${row.list_name}` : ''}
                      </div>
                    </td>
                    <td><span className={STATUS_CLASS[row.status]}>{humanize(row.status)}</span></td>
                    <td className="money">
                      {row.sent_count.toLocaleString()}
                      {row.total_members > 0 && (
                        <small className="muted"> / {row.total_members.toLocaleString()}</small>
                      )}
                    </td>
                    <td className="money">{rate(row.opened_count, row.sent_count)}</td>
                    <td className="money">{rate(row.clicked_count, row.sent_count)}</td>
                    {/* Bounces in red once they are high enough to matter:
                        5% is where mailbox providers start blocking. */}
                    <td className={row.bounced_count / Math.max(1, row.sent_count) >= 0.05 ? 'money err' : 'money'}>
                      {row.bounced_count.toLocaleString()}
                    </td>
                    <td className="money">{row.unsubscribed_count.toLocaleString()}</td>
                    <td className="muted">{relativeTime(row.created_at)}</td>
                    <td>
                      {(row.status === 'draft' || row.status === 'paused') && (
                        <button type="button" className="btn" onClick={() => void act(row.id, 'start')}>
                          <Icon name="play" size={14} />
                          {row.status === 'paused' ? 'Resume' : 'Send'}
                        </button>
                      )}
                      {row.status === 'sending' && (
                        <button type="button" className="btn" onClick={() => void act(row.id, 'pause')}>
                          <Icon name="minus" size={14} />
                          Pause
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {creating && (
        <NewCampaign
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setReloadKey((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function rate(count: number, of: number): string {
  if (of === 0) return '—';
  return `${count.toLocaleString()} · ${Math.round((count / of) * 100)}%`;
}

function NewCampaign({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const lists = useAsync<{ items: Array<{ id: string; name: string; member_count?: number }> }>(
    () => api.get('/api/lists'),
    [],
  );
  const templates = useAsync<{ items: Array<{ id: string; name: string; subject: string; body: string }> }>(
    () => api.get('/api/email/templates'),
    [],
  );

  const [name, setName] = useState('');
  const [listId, setListId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [throttle, setThrottle] = useState(200);
  const [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    try {
      const result = await api.post<{ id: string }>('/api/email/campaigns', {
        name, listId: listId || null, subject, body, throttlePerHour: throttle,
      });
      setCreatedId(result.id);
      /* The audience is checked after saving because the server works it out
         from the real list, not from what the browser believes is in it. */
      setAudience(await api.get<Audience>(`/api/email/campaigns/${result.id}/audience`));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save it');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!createdId) return;
    setBusy(true);
    try {
      await api.post(`/api/email/campaigns/${createdId}/start`);
      toast('Sending has begun');
      onCreated();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not start it');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel index={2} icon="mail" title={createdId ? 'Ready to send' : 'New campaign'}>
      {!createdId && (
        <>
          <div className="two">
            <Field label="What is this campaign called?" hint="Only your team sees this.">
              <input className="input" value={name} onChange={(event) => setName(event.target.value)}
                placeholder="October — Beachfront launch" />
            </Field>
            <Field label="Who gets it?" hint="A saved list.">
              {!lists.data ? <Spinner /> : (
                <Select value={listId} onChange={(event) => setListId(event.target.value)}>
                  <option value="">Choose a list</option>
                  {lists.data.items.map((list) => (
                    <option key={list.id} value={list.id}>{list.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {templates.data && templates.data.items.length > 0 && (
            <Field label="Start from a template">
              <Select
                value=""
                onChange={(event) => {
                  const template = templates.data?.items.find((item) => item.id === event.target.value);
                  if (!template) return;
                  setSubject(template.subject);
                  setBody(template.body);
                }}
              >
                <option value="">Write it myself</option>
                {templates.data.items.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Subject">
            <input className="input" value={subject} onChange={(event) => setSubject(event.target.value)} />
          </Field>

          <Field label="Message" hint="Merge fields like {{first_name}} work here too.">
            <TextArea rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
          </Field>

          <Field
            label="How fast?"
            hint="Slower is safer. A new sending domain that fires a thousand emails in a minute gets blocked."
          >
            <Select value={String(throttle)} onChange={(event) => setThrottle(Number(event.target.value))}>
              <option value="50">Very slow — 50 an hour</option>
              <option value="200">Steady — 200 an hour</option>
              <option value="500">Fast — 500 an hour</option>
              <option value="1000">Very fast — 1,000 an hour</option>
            </Select>
          </Field>

          <div className="compose-actions">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary" loading={busy}
              disabled={!name.trim() || !listId || !subject.trim() || !body.trim()}
              onClick={() => void create()}
            >
              Check who gets it
            </Button>
          </div>
        </>
      )}

      {createdId && audience && (
        <>
          <div className="vat-big">
            <div>
              <small>Will receive it</small>
              <b>{audience.willReceive.toLocaleString()}</b>
            </div>
            <div>
              <small>Takes about</small>
              <b>{audience.minutes < 60
                ? `${audience.minutes} min`
                : `${Math.round(audience.minutes / 60)} h`}</b>
            </div>
          </div>

          {audience.skipped.length > 0 && (
            <>
              <div className="sec-t">Who will be skipped, and why</div>
              {audience.skipped.map((entry) => (
                <div className="kv" key={entry.reason}>
                  <span>{entry.reason}</span>
                  <b>{entry.count.toLocaleString()}</b>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
                Nobody in that list is emailed without having agreed to it. That is not a setting —
                emailing people who never opted in is how the sending domain gets blocked, and it
                takes the one-to-one emails down with it.
              </p>
            </>
          )}

          <div className="compose-actions">
            <Button variant="ghost" onClick={onClose}>Leave it as a draft</Button>
            <Button variant="primary" icon="send" loading={busy}
              disabled={audience.willReceive === 0} onClick={() => void send()}>
              Send to {audience.willReceive.toLocaleString()}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
