import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { connectRealtime } from '../lib/realtime.js';
import { formatTime, humanize, relativeTime } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import type { Conversation, TemplateRow, ThreadResponse } from '../lib/types.js';
import {
  Avatar,
  ChannelBadge,
  DeliveryTicks,
  EmptyState,
  ErrorNote,
  Icon,
  ScoreChip,
  Spinner,
  Toast,
} from '../components/ui.js';

/**
 * The unified inbox: one thread per contact, every channel in one timeline.
 *
 * Two panes on desktop; on mobile the thread takes over the screen once a
 * conversation is selected.
 */
export function Inbox() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'mine' | 'unassigned' | 'all'>('mine');
  const [filterChosen, setFilterChosen] = useState(false);
  const [channel, setChannel] = useState<'any' | 'whatsapp' | 'email' | 'sms'>('any');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const selectedId = params.get('conversation');
  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';

  /*
   * Managers and owners rarely own conversations themselves, so defaulting them
   * to "Mine" showed an empty inbox that looks broken. Start them on "All" and
   * leave agents on "Mine" — and never override a filter they picked.
   */
  useEffect(() => {
    if (filterChosen || !user) return;
    if (isManager) setFilter('all');
    setFilterChosen(true);
  }, [user, isManager, filterChosen]);

  const list = useAsync<{ items: Conversation[] }>(
    () =>
      api.get(
        `/api/inbox/conversations${qs({
          filter,
          channel,
          unread: unreadOnly ? '1' : undefined,
          search: debouncedSearch,
        })}`,
      ),
    [filter, channel, unreadOnly, debouncedSearch, version],
  );

  // Realtime keeps both panes fresh; it degrades to polling by itself.
  useEffect(() => {
    const connection = connectRealtime(() => setVersion((v) => v + 1));
    return () => connection.close();
  }, []);

  const select = (conversationId: string) => {
    const next = new URLSearchParams(params);
    next.set('conversation', conversationId);
    setParams(next, { replace: true });
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] lg:h-screen">
      {/* Thread list */}
      <section className={`flex w-full flex-col border-e border-slate-200 bg-white lg:w-96 ${selectedId ? 'hidden lg:flex' : 'flex'}`}>
        <header className="space-y-3 border-b border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-900">{t('inbox')}</h1>
            <button type="button" className="btn-ghost !px-2" onClick={() => setVersion((v) => v + 1)} aria-label="Refresh">
              <Icon name="refresh" />
            </button>
          </div>

          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute start-2 top-1/2 !text-[18px] -translate-y-1/2 text-slate-400" />
            <input className="field ps-9" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(['mine', 'unassigned', ...(isManager ? (['all'] as const) : [])] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`chip ${filter === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                onClick={() => {
                  setFilterChosen(true);
                  setFilter(value);
                }}
              >
                {t(value)}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${unreadOnly ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              onClick={() => setUnreadOnly((v) => !v)}
            >
              {t('unread')}
            </button>
            <select
              className="chip border-0 bg-slate-100 text-slate-600"
              value={channel}
              onChange={(e) => setChannel(e.target.value as typeof channel)}
              aria-label="Channel"
            >
              <option value="any">All channels</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
            </select>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {list.error ? <ErrorNote message={list.error} onRetry={list.reload} /> : null}
          {list.loading && !list.data ? <Spinner /> : null}
          {list.data?.items.length === 0 ? (
            <EmptyState icon="forum" title={t('noResults')} hint="Conversations appear here as leads reply." />
          ) : null}

          <ul>
            {(list.data?.items ?? []).map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  onClick={() => select(conversation.id)}
                  className={`flex w-full items-start gap-3 border-b border-slate-100 p-3 text-start transition hover:bg-slate-50 ${
                    selectedId === conversation.id ? 'bg-brand-50/60' : ''
                  }`}
                >
                  <Avatar name={conversation.full_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-900">{conversation.full_name ?? 'Unknown'}</p>
                      <span className="shrink-0 text-[11px] text-slate-400">{relativeTime(conversation.last_message_at)}</span>
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {conversation.last_direction === 'outbound' ? 'You: ' : ''}
                      {conversation.last_body ?? 'No messages yet'}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {conversation.last_channel ? <ChannelBadge channel={conversation.last_channel} /> : null}
                      {conversation.stage_key ? (
                        <span className="chip bg-slate-100 text-slate-600">{humanize(conversation.stage_key)}</span>
                      ) : null}
                      {conversation.dnc === 1 ? <span className="chip bg-rose-100 text-rose-700">DNC</span> : null}
                    </div>
                  </div>
                  {conversation.unread_count > 0 ? (
                    <span className="mt-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">
                      {conversation.unread_count}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Thread */}
      <section className={`min-w-0 flex-1 ${selectedId ? 'flex' : 'hidden lg:flex'} flex-col bg-sand-50`}>
        {selectedId ? (
          <Thread
            conversationId={selectedId}
            version={version}
            onBack={() => {
              const next = new URLSearchParams(params);
              next.delete('conversation');
              setParams(next, { replace: true });
            }}
            onSent={() => setVersion((v) => v + 1)}
            onToast={(message) => {
              setToast(message);
              window.setTimeout(() => setToast(null), 3500);
            }}
          />
        ) : (
          <EmptyState icon="chat" title="Select a conversation" hint="Threads mix WhatsApp, email, SMS and internal notes." />
        )}
      </section>

      {toast ? <Toast message={toast} tone="error" /> : null}
    </div>
  );
}

function Thread({
  conversationId,
  version,
  onBack,
  onSent,
  onToast,
}: {
  conversationId: string;
  version: number;
  onBack: () => void;
  onSent: () => void;
  onToast: (message: string) => void;
}) {
  const { user } = useAuth();
  const thread = useAsync<ThreadResponse>(() => api.get(`/api/inbox/conversations/${conversationId}`), [conversationId, version]);
  const templates = useAsync<{ items: TemplateRow[] }>(() => api.get('/api/templates'), []);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'whatsapp' | 'email' | 'note'>('whatsapp');
  const [subject, setSubject] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const conversation = thread.data?.conversation;
  const windowOpen = conversation?.whatsappWindowOpen ?? false;
  const templateOnly = mode === 'whatsapp' && !windowOpen;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.data?.messages.length]);

  // Mark read once the thread is open.
  useEffect(() => {
    if (conversation && conversation.unread_count > 0) {
      void api.post(`/api/inbox/conversations/${conversationId}/read`).then(onSent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, conversation?.unread_count]);

  const approvedTemplates = useMemo(
    () => (templates.data?.items ?? []).filter((template) => template.status === 'APPROVED'),
    [templates.data],
  );

  // The collision guard: tell the others this agent is replying.
  const announceTyping = useCallback(() => {
    void api.post(`/api/inbox/conversations/${conversationId}/typing`).catch(() => undefined);
  }, [conversationId]);

  const send = async () => {
    setSending(true);
    try {
      if (mode === 'note') {
        await api.post(`/api/inbox/conversations/${conversationId}/send`, { channel: 'note', text: draft });
      } else if (mode === 'email') {
        await api.post(`/api/inbox/conversations/${conversationId}/send`, { channel: 'email', subject, text: draft });
      } else if (templateOnly) {
        await api.post(`/api/inbox/conversations/${conversationId}/send`, {
          channel: 'whatsapp',
          kind: 'template',
          templateName,
          templateLanguage: approvedTemplates.find((tpl) => tpl.name === templateName)?.language ?? 'en',
          bodyParams: draft ? draft.split('|').map((p) => p.trim()) : [],
        });
      } else {
        await api.post(`/api/inbox/conversations/${conversationId}/send`, { channel: 'whatsapp', kind: 'text', text: draft });
      }
      setDraft('');
      setSubject('');
      thread.reload();
      onSent();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not send the message');
    } finally {
      setSending(false);
    }
  };

  if (thread.error) return <ErrorNote message={thread.error} onRetry={thread.reload} />;
  if (!thread.data) return <Spinner label={t('loading')} />;

  const canSend =
    !sending &&
    (mode === 'note'
      ? draft.trim().length > 0
      : mode === 'email'
        ? subject.trim().length > 0 && draft.trim().length > 0
        : templateOnly
          ? templateName.length > 0
          : draft.trim().length > 0);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5">
        <button type="button" className="btn-ghost !px-2 lg:hidden" onClick={onBack} aria-label="Back">
          <Icon name="arrow_back" />
        </button>
        <Avatar name={conversation?.full_name ?? null} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{conversation?.full_name ?? 'Unknown'}</p>
          <p className="truncate text-xs text-slate-500">
            {conversation?.phone_e164 ?? conversation?.email ?? '—'}
            {conversation?.assignee_name ? ` · ${conversation.assignee_name}` : ''}
          </p>
        </div>
        {conversation ? <ScoreChip score={conversation.lead_score} /> : null}
        {conversation?.contact_id ? (
          <Link to={`/contacts/${conversation.contact_id}`} className="btn-ghost !px-2" aria-label="Open contact">
            <Icon name="person" />
          </Link>
        ) : null}
        {conversation?.phone_e164 ? (
          <a href={`tel:${conversation.phone_e164}`} className="btn-ghost !px-2" aria-label="Call">
            <Icon name="call" />
          </a>
        ) : null}
      </header>

      {/* The 24-hour window indicator drives what the composer will allow. */}
      <div
        className={`flex items-center gap-2 px-4 py-1.5 text-xs ${
          windowOpen ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'
        }`}
      >
        <Icon name={windowOpen ? 'lock_open' : 'lock_clock'} className="!text-[16px]" />
        <span>
          {windowOpen ? t('windowOpen') : t('windowClosed')}
          {conversation?.whatsappWindowExpiresAt && windowOpen
            ? ` · closes ${relativeTime(conversation.whatsappWindowExpiresAt)}`
            : ''}
        </span>
      </div>

      {conversation?.replyLock ? (
        <div className="flex items-center gap-2 bg-violet-50 px-4 py-1.5 text-xs text-violet-800">
          <Icon name="edit_note" className="!text-[16px]" />
          Someone else is replying to this conversation…
        </div>
      ) : null}

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {thread.data.messages.length === 0 ? <EmptyState icon="chat" title="No messages yet" /> : null}

        {thread.data.messages.map((message) => {
          const outbound = message.direction === 'outbound';
          const isNote = message.channel === 'note';
          return (
            <div key={message.id} className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-e1 sm:max-w-[70%] ${
                  isNote
                    ? 'bg-amber-50 text-amber-900'
                    : outbound
                      ? 'bg-brand-600 text-white'
                      : 'bg-white text-slate-800'
                }`}
              >
                <div className="mb-1 flex items-center gap-1.5">
                  <ChannelBadge channel={message.channel} />
                  {message.is_automated === 1 ? (
                    <span className="chip bg-white/20 text-current">
                      <Icon name="smart_toy" className="!text-[13px]" />
                      Auto
                    </span>
                  ) : null}
                  {message.template_name ? (
                    <span className="chip bg-white/20 text-current">{message.template_name}</span>
                  ) : null}
                </div>

                {message.subject ? <p className="mb-1 text-xs font-semibold opacity-90">{message.subject}</p> : null}
                <p className="whitespace-pre-wrap break-words text-sm">{message.body ?? '—'}</p>

                <div className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${outbound && !isNote ? 'text-white/70' : 'text-slate-400'}`}>
                  {message.user_name ? <span>{message.user_name}</span> : null}
                  <span>{formatTime(message.created_at)}</span>
                  {outbound ? <DeliveryTicks status={message.status} /> : null}
                </div>

                {message.status === 'failed' && message.error_message ? (
                  <p className="mt-1 rounded bg-rose-100 px-2 py-1 text-[11px] text-rose-800">{message.error_message}</p>
                ) : null}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <footer className="border-t border-slate-200 bg-white p-3">
        <div className="mb-2 flex gap-1.5">
          {(['whatsapp', 'email', 'note'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`chip ${mode === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              onClick={() => setMode(value)}
            >
              {value === 'note' ? t('note') : value === 'email' ? 'Email' : 'WhatsApp'}
            </button>
          ))}
        </div>

        {mode === 'email' ? (
          <input
            className="field mb-2"
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={sending}
          />
        ) : null}

        {templateOnly ? (
          <div className="mb-2 space-y-2">
            <p className="text-xs text-amber-800">
              The 24-hour window has closed, so only an approved template can be sent.
            </p>
            <select className="field" value={templateName} onChange={(e) => setTemplateName(e.target.value)} disabled={sending}>
              <option value="">Choose an approved template…</option>
              {approvedTemplates.map((template) => (
                <option key={template.id} value={template.name}>
                  {template.name} ({template.language})
                </option>
              ))}
            </select>
            {approvedTemplates.length === 0 ? (
              <p className="text-xs text-rose-700">No approved templates are available. Ask an admin to sync them.</p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <textarea
            className="field min-h-[44px] flex-1 resize-y"
            rows={2}
            placeholder={
              templateOnly ? 'Template variables, separated by |' : mode === 'note' ? 'Visible to your team only' : 'Type a message…'
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={announceTyping}
            disabled={sending}
          />
          <button type="button" className="btn-primary !px-3" onClick={() => void send()} disabled={!canSend} aria-label={t('send')}>
            <Icon name="send" className="!text-[20px]" />
          </button>
        </div>
      </footer>
    </div>
  );
}
