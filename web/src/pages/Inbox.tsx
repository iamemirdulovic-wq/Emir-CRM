import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { connectRealtime } from '../lib/realtime.js';
import { formatTime, humanize } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import { useShellSearch } from '../components/Layout.js';
import type { Contact360, Conversation, Message, TemplateRow, ThreadResponse } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { stageStyle } from '../design/stages.js';
import {
  ago, Avatar, budgetLabel, ChannelBadge, Chip, Empty, ErrorNote, Score, Spinner, StagePill, Tag,
  useToast,
} from '../design/ui.js';

type Filter = 'mine' | 'unassigned' | 'all';

/**
 * The unified inbox: one thread per contact, every channel in one timeline,
 * with Contact 360 alongside.
 *
 * Ported from the inbox view in design/emir-crm-design.html. Three panes on a
 * desktop; on a phone the thread takes over the screen, which is what the
 * design's `.inbox.open` class does.
 */
export function Inbox() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const shellSearch = useShellSearch();
  const search = useDebounced(shellSearch.value);
  const toast = useToast();

  const [filter, setFilter] = useState<Filter>('mine');
  const [filterChosen, setFilterChosen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [version, setVersion] = useState(0);

  const selectedId = params.get('conversation');
  const contactParam = params.get('contact');
  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';

  /*
   * Managers and owners rarely own conversations themselves, so defaulting them
   * to "Mine" showed an inbox that looks broken. Start them on "All", leave
   * agents on "Mine", and never override a filter the user picked.
   */
  useEffect(() => {
    if (filterChosen || !user) return;
    if (isManager) setFilter('all');
    setFilterChosen(true);
  }, [user, isManager, filterChosen]);

  const list = useAsync<{ items: Conversation[] }>(
    () => api.get(`/api/inbox/conversations${qs({ filter, unread: unreadOnly ? '1' : undefined, search })}`),
    [filter, unreadOnly, search, version],
  );

  // Realtime keeps both panes fresh; it falls back to polling on its own.
  useEffect(() => {
    const connection = connectRealtime(() => setVersion((value) => value + 1));
    return () => connection.close();
  }, []);

  const items = list.data?.items ?? [];

  // Arriving from the board with ?contact=… opens that person's thread.
  useEffect(() => {
    if (!contactParam || selectedId || items.length === 0) return;
    const match = items.find((conversation) => conversation.contact_id === contactParam);
    if (match) select(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactParam, selectedId, items]);

  function select(conversationId: string) {
    const next = new URLSearchParams(params);
    next.set('conversation', conversationId);
    setParams(next, { replace: true });
  }

  function back() {
    const next = new URLSearchParams(params);
    next.delete('conversation');
    setParams(next, { replace: true });
  }

  const selected = items.find((conversation) => conversation.id === selectedId) ?? null;

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;

  return (
    <div className={selectedId ? 'inbox rise open' : 'inbox rise'} style={{ ['--i' as string]: 0 }}>
      <div className="threads">
        <div className="tabs">
          <Chip on={filter === 'mine'} onClick={() => { setFilterChosen(true); setFilter('mine'); }}>
            {t('mine')}
          </Chip>
          <Chip on={filter === 'unassigned'} onClick={() => { setFilterChosen(true); setFilter('unassigned'); }}>
            {t('unassigned')}
          </Chip>
          {isManager && (
            <Chip on={filter === 'all'} onClick={() => { setFilterChosen(true); setFilter('all'); }}>
              {t('all')}
            </Chip>
          )}
          <Chip on={unreadOnly} onClick={() => setUnreadOnly(!unreadOnly)}>
            {t('unread')}
          </Chip>
        </div>

        <div className="thread-list">
          {list.loading && items.length === 0 && <Spinner />}
          {!list.loading && items.length === 0 && (
            <Empty icon="message-circle" title="No conversations here" hint="Try another filter." />
          )}
          {items.map((conversation) => (
            <button
              type="button"
              key={conversation.id}
              className={conversation.id === selectedId ? 'thread active' : 'thread'}
              onClick={() => select(conversation.id)}
            >
              <Avatar name={conversation.full_name} />
              <span className="meta">
                <span className="l1">
                  {conversation.last_channel && <ChannelBadge channel={conversation.last_channel} />}
                  {conversation.full_name ?? conversation.phone_e164 ?? 'Unknown'}
                  <time>{ago(conversation.last_message_at)}</time>
                </span>
                <span className="l2">
                  {conversation.last_direction === 'outbound' ? 'You: ' : ''}
                  {conversation.last_body ?? 'No messages yet'}
                </span>
              </span>
              {conversation.unread_count > 0 && <span className="unread">{conversation.unread_count}</span>}
            </button>
          ))}
        </div>
      </div>

      {selectedId ? (
        <Thread
          key={selectedId}
          conversationId={selectedId}
          version={version}
          onBack={back}
          onChanged={() => setVersion((value) => value + 1)}
          onError={toast}
        />
      ) : (
        <div className="convo">
          <Empty icon="message-circle" title="Pick a conversation" hint="Threads mix WhatsApp, email, SMS and notes." />
        </div>
      )}

      {selected?.contact_id ? <Contact360Panel contactId={selected.contact_id} /> : <div className="side360" />}
    </div>
  );
}

/* ── Thread ───────────────────────────────────────────────────────────── */

function DeliveryTicks({ status }: { status: Message['status'] }) {
  if (status === 'read') return <Icon name="check-check" style={{ color: '#9BE6FF' }} />;
  if (status === 'delivered') return <Icon name="check-check" />;
  if (status === 'sent') return <Icon name="check" />;
  if (status === 'failed') return <Icon name="alert-circle" />;
  if (status === 'queued') return <Icon name="clock" />;
  return null;
}

/** "23h left" / "40m left", short enough for the window pill on a phone. */
function hoursUntil(deadline: string | null): string | null {
  if (!deadline) return null;
  const remaining = new Date(deadline).getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  const hours = Math.floor(remaining / 3_600_000);
  return hours >= 1 ? `${hours}h left` : `${Math.max(1, Math.round(remaining / 60_000))}m left`;
}

/** WhatsApp, email and notes each need a different composer. */
type Mode = 'whatsapp' | 'email' | 'note';

function Thread({
  conversationId, version, onBack, onChanged, onError,
}: {
  conversationId: string;
  version: number;
  onBack: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const thread = useAsync<ThreadResponse>(
    () => api.get(`/api/inbox/conversations/${conversationId}`),
    [conversationId, version],
  );
  const templates = useAsync<{ items: TemplateRow[] }>(() => api.get('/api/templates'), []);

  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<Mode>('whatsapp');
  const [subject, setSubject] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [sending, setSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  const conversation = thread.data?.conversation;
  const windowOpen = conversation?.whatsappWindowOpen ?? false;
  const templateOnly = mode === 'whatsapp' && !windowOpen;
  const closesIn = hoursUntil(conversation?.whatsappWindowExpiresAt ?? null);

  // Scroll the message list itself rather than calling scrollIntoView, which
  // also scrolls every ancestor and dragged the whole inbox off the top.
  useEffect(() => {
    const box = messagesRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [thread.data?.messages.length]);

  // Opening a thread marks it read.
  useEffect(() => {
    if (conversation && conversation.unread_count > 0) {
      void api.post(`/api/inbox/conversations/${conversationId}/read`).then(onChanged);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, conversation?.unread_count]);

  const approved = useMemo(
    () => (templates.data?.items ?? []).filter((template) => template.status === 'APPROVED'),
    [templates.data],
  );

  // The collision guard: tell the rest of the team this agent is replying.
  const announceTyping = useCallback(() => {
    void api.post(`/api/inbox/conversations/${conversationId}/typing`).catch(() => undefined);
  }, [conversationId]);

  async function send() {
    setSending(true);
    try {
      const url = `/api/inbox/conversations/${conversationId}/send`;
      if (mode === 'note') await api.post(url, { channel: 'note', text: draft });
      else if (mode === 'email') await api.post(url, { channel: 'email', subject, text: draft });
      else if (templateOnly)
        await api.post(url, {
          channel: 'whatsapp',
          kind: 'template',
          templateName,
          templateLanguage: approved.find((template) => template.name === templateName)?.language ?? 'en',
          // The design's composer takes the variables as one pipe-separated line.
          bodyParams: draft ? draft.split('|').map((part) => part.trim()) : [],
        });
      else await api.post(url, { channel: 'whatsapp', kind: 'text', text: draft });

      setDraft('');
      setSubject('');
      thread.reload();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not send the message');
    } finally {
      setSending(false);
    }
  }

  if (thread.error) return <div className="convo"><ErrorNote>{thread.error}</ErrorNote></div>;
  if (!thread.data) return <div className="convo"><Spinner /></div>;

  const canSend =
    !sending &&
    (mode === 'note'
      ? draft.trim().length > 0
      : mode === 'email'
        ? subject.trim().length > 0 && draft.trim().length > 0
        : templateOnly
          ? templateName.length > 0
          : draft.trim().length > 0);

  let lastDay = '';

  return (
    <div className="convo">
      <div className="convo-head">
        <button type="button" className="icon-btn back-btn" onClick={onBack} aria-label="Back to conversations">
          <Icon name="arrow-left" />
        </button>
        <Avatar name={conversation?.full_name ?? null} />
        <div style={{ minWidth: 0 }}>
          <div className="nm">{conversation?.full_name ?? 'Unknown'}</div>
          <small>
            {conversation?.phone_e164 ?? conversation?.email ?? '—'}
            {conversation?.assignee_name ? ` · ${conversation.assignee_name}` : ''}
          </small>
        </div>
        {/* Short enough to stay on one line on a phone; the title carries the
            full explanation for anyone who hovers or uses a screen reader. */}
        <span
          className={windowOpen ? 'window' : 'window closed'}
          title={windowOpen ? t('windowOpen') : t('windowClosed')}
        >
          <Icon name={windowOpen ? 'message-circle' : 'hourglass'} />
          {windowOpen ? `Open${closesIn ? ` · ${closesIn}` : ''}` : 'Templates only'}
        </span>
      </div>

      <div className="msgs" ref={messagesRef}>
        {thread.data.messages.length === 0 && <Empty icon="message-circle" title="No messages yet" />}

        {thread.data.messages.map((message) => {
          const day = new Date(message.created_at).toDateString();
          const showDay = day !== lastDay;
          lastDay = day;
          const outbound = message.direction === 'outbound';
          const bubble =
            message.channel === 'note'
              ? 'bubble note'
              : message.channel === 'email'
                ? outbound ? 'bubble email' : 'bubble'
                : outbound
                  ? message.is_automated === 1 ? 'bubble bot' : 'bubble out'
                  : 'bubble';

          return (
            <div key={message.id} style={{ display: 'contents' }}>
              {showDay && (
                <span className="day">
                  {new Date(message.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              )}
              <div className={bubble}>
                <div className="by">
                  {message.channel === 'note'
                    ? `Note · ${message.user_name ?? 'team'}`
                    : message.is_automated === 1
                      ? 'Automated'
                      : message.user_name ?? (outbound ? 'You' : conversation?.full_name ?? '')}
                  {message.template_name ? ` · ${message.template_name}` : ''}
                </div>
                {message.subject && <b style={{ display: 'block', marginBottom: 3 }}>{message.subject}</b>}
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{message.body ?? '—'}</div>
                {message.status === 'failed' && message.error_message && (
                  <div className="err" style={{ display: 'block', margin: '6px 0 0' }}>
                    {message.error_message}
                  </div>
                )}
                <div className="t">
                  {formatTime(message.created_at)}
                  {outbound && <DeliveryTicks status={message.status} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="composer">
        {conversation?.replyLock && (
          <p className="typing">
            <Icon name="pencil" />
            Someone else is replying to this conversation…
          </p>
        )}

        <div className="chs">
          {(['whatsapp', 'email', 'note'] as const).map((value) => (
            <Chip key={value} on={mode === value} onClick={() => setMode(value)}>
              {value === 'note' ? t('note') : value === 'email' ? 'Email' : 'WhatsApp'}
            </Chip>
          ))}
        </div>

        {mode === 'email' && (
          <input
            className="input"
            style={{ marginBottom: 8 }}
            placeholder="Subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={sending}
          />
        )}

        {/* Outside the 24-hour window Meta only accepts approved templates, so
            the composer stops offering free text rather than failing on send. */}
        {templateOnly && (
          <div className="tpl-picker show">
            <b style={{ fontSize: 13 }}>The 24-hour window has closed</b>
            <p className="muted" style={{ margin: '2px 0 8px', fontSize: 12.5 }}>
              Only an approved template can be sent now.
            </p>
            <select
              className="input"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              disabled={sending}
            >
              <option value="">Choose an approved template…</option>
              {approved.map((template) => (
                <option key={template.id} value={template.name}>
                  {template.name} ({template.language})
                </option>
              ))}
            </select>
            {approved.length === 0 && (
              <p className="err" style={{ display: 'block', marginTop: 8 }}>
                No approved templates are available. Ask an admin to sync them.
              </p>
            )}
          </div>
        )}

        <div className="box">
          <textarea
            placeholder={
              templateOnly
                ? 'Template variables, separated by |'
                : mode === 'note'
                  ? 'Visible to your team only'
                  : 'Type a message…'
            }
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={announceTyping}
            disabled={sending}
          />
          <button
            type="button"
            className={mode === 'whatsapp' ? 'btn btn-wa' : 'btn btn-primary'}
            onClick={() => void send()}
            disabled={!canSend}
            aria-label={t('send')}
          >
            <Icon name="send" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Contact 360 side panel ───────────────────────────────────────────── */

function Contact360Panel({ contactId }: { contactId: string }) {
  const detail = useAsync<Contact360>(() => api.get(`/api/contacts/${contactId}`), [contactId]);

  if (!detail.data) {
    return (
      <div className="side360">
        <Spinner />
      </div>
    );
  }

  const { contact, opportunities, tasks, tags } = detail.data;
  const opportunity = opportunities[0];
  const open = tasks.filter((task) => !task.completed_at);

  return (
    <div className="side360">
      <div className="p360-top">
        <Avatar
          name={contact.full_name}
          size={60}
          colour={opportunity ? stageStyle(opportunity.stage_key).colour : undefined}
        />
        <h4>{contact.full_name ?? 'Unnamed contact'}</h4>
        <p>{contact.phone_e164 ?? contact.email ?? '—'}</p>
        <div className="quick">
          {contact.phone_e164 && (
            <a className="icon-btn" href={`tel:${contact.phone_e164}`} aria-label="Call">
              <Icon name="phone" />
            </a>
          )}
          <Link className="icon-btn" to={`/contacts/${contactId}`} aria-label="Open the full record">
            <Icon name="external-link" />
          </Link>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 0' }}>
        {opportunity && (
          <StagePill stage={opportunity.stage_key} label={humanize(opportunity.stage_key)} />
        )}
        <Score value={contact.lead_score} />
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
        <dt>Language</dt>
        <dd>{contact.language.toUpperCase()}</dd>
        <dt>Owner</dt>
        <dd>{contact.owner_name ?? 'Unassigned'}</dd>
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

      <div className="sec-t">Open tasks</div>
      {open.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Nothing due.</p>
      ) : (
        open.slice(0, 5).map((task) => (
          <div className="task" key={task.id}>
            <Icon name="check-square" size={15} />
            {task.title}
            <span className="due">{ago(task.due_at)}</span>
          </div>
        ))
      )}

      {contact.dnc === 1 && (
        <p className="err" style={{ display: 'block', marginTop: 14 }}>
          This contact is on the do-not-contact list. Automated messages are suppressed.
        </p>
      )}
    </div>
  );
}
