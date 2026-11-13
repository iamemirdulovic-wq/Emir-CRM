import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { connectRealtime } from '../lib/realtime.js';
import { formatTime } from '../lib/format.js';
import { clockIn, originOf } from '../lib/dialling.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, ErrorNote, Spinner, useToast } from '../design/ui.js';
import { useFullAttention, usePhoneHead } from './phone.js';
import { inboxSub } from './subs.js';
import { useCheckIn } from './check-in.js';
import type {
  Contact360, Conversation, Message, StageKey, TemplateRow, ThreadResponse,
} from '../lib/types.js';

/**
 * The shared inbox.
 *
 * Ported from `design/web/inbox.html`: a list of chats, the thread, and the
 * lead beside it. Three columns on a computer; on a phone one at a time, the
 * list and then the thread, which is what every messaging app does and the
 * only thing that fits.
 *
 * Two of the design's choices had to change because the CRM does not do what
 * the drawing assumed:
 *
 *  - The channel filter is All · WhatsApp · Email. The design drew Telegram,
 *    and the CRM has no Telegram channel — `messages.channel` is whatsapp,
 *    email, sms or note. Drawing a filter that can never match anything is
 *    worse than not drawing it.
 *  - The design's three "ready messages" quote a payment plan ("60% during
 *    construction, 40% on handover"). Nothing here may invent a payment plan
 *    (master prompt, HARD RULES), so the openings come from the server, which
 *    builds them from the project the lead actually asked about and puts no
 *    figure in them at all.
 *
 * The composer obeys Meta's 24-hour rule, which is the one thing on this
 * screen that can get the company's WhatsApp number banned: while the window
 * is open the agent types freely, and once it has closed the only thing that
 * can go out is a template Meta has approved. The server refuses anything
 * else; this screen refuses to ask.
 */

type Scope = 'mine' | 'unassigned' | 'all';
type Channel = 'any' | 'whatsapp' | 'telegram' | 'email';
type Mode = 'whatsapp' | 'email' | 'note';

const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New',
  attempted_contact: 'Called',
  engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting',
  deal_sent: 'Offer',
  won: 'Won',
  lost: 'Lost',
};

const STAGE_CLASS: Record<string, string> = {
  new_lead: 'new', attempted_contact: 'called', engaged_qualified: 'interested',
  appointment_scheduled: 'meeting', deal_sent: 'offer', won: 'won', lost: 'lost',
};

/** Below this the three columns become one at a time. Matches v2-shell.css. */
const NARROW = 900;
/** §4 of `docs/v2/phone-shell.md`: under this, the phone layout. */
const PHONE = 768;

function useUnder(px: number): boolean {
  const [under, setUnder] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${px}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${px}px)`);
    const onChange = () => setUnder(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [px]);
  return under;
}

export function V2Inbox() {
  const { user } = useAuth();
  const narrow = useUnder(NARROW);
  /*
   * `Chat.dc.html` is a whole screen — header, thread, composer, and nothing
   * else. The build renders the Contact-360 panel under the composer, so on
   * a phone you scroll past "Nothing goes out until you press Send" into a
   * second screen's worth of lead detail. That panel is the `Lead` screen's
   * job; here it is suppressed and what the design does keep — a call button
   * and the ready messages — moves into the thread.
   */
  const phone = useUnder(PHONE - 1);

  /* §1.4, and `Inbox.dc.html`'s own line under the title. */
  /* `Inbox.dc.html` draws the same compact centred title as Follow-ups, over
     "WhatsApp, email and notes in one place". `design/web/inbox.html` writes
     "WhatsApp and Telegram chats in one place · later phase" instead, and the
     computer design wins — though it names a channel this screen does not
     carry and leaves out two it does. `docs/v2/questions-subs.md`. */
  usePhoneHead({ compact: true, title: 'Inbox', sub: inboxSub() });
  const seesEveryone = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';

  const [scope, setScope] = useState<Scope>('mine');
  const [scopeChosen, setScopeChosen] = useState(false);
  const [channel, setChannel] = useState<Channel>('any');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [typed, setTyped] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  /*
   * A thread is one of the phone design's four full-attention screens — see
   * `phone.tsx`. While one is open the bottom bar goes away, which is also
   * what gives the composer the bottom of the screen.
   */
  useFullAttention(openId !== null);
  const [version, setVersion] = useState(0);
  /* A ready message fills the composer, as the design has it: the button is
     in the side panel and the box is in the thread, so the text travels
     through here. The stamp is what makes pressing the same one twice work. */
  const [prefill, setPrefill] = useState<{ text: string; at: number } | null>(null);
  const search = useDebounced(typed);

  /* An owner owns almost no conversations, so "Mine" shows them an empty
     screen that looks broken. Start them on everything, agents on their own,
     and never argue with a choice the person has made themselves. */
  useEffect(() => {
    if (scopeChosen || !user) return;
    if (seesEveryone) setScope('all');
    setScopeChosen(true);
  }, [user, seesEveryone, scopeChosen]);

  const list = useAsync<{ items: Conversation[]; total: number }>(
    () => api.get(`/api/inbox/conversations${qs({
      filter: scope,
      /* `telegram` is not one of the server's channels, so it is never sent
         there: the list comes back whole and the filter below empties it. */
      channel: channel === 'any' || channel === 'telegram' ? undefined : channel,
      unread: unreadOnly ? '1' : undefined,
      search,
      pageSize: 60,
    })}`),
    [scope, channel, unreadOnly, search, version],
  );

  /* The master prompt asks for a websocket with a 4-second poll behind it.
     This is that one connection, shared by both panes. */
  useEffect(() => {
    const live = connectRealtime(() => setVersion((n) => n + 1));
    return () => live.close();
  }, []);

  /* The Telegram filter is the design's and matches nothing: see below. */
  const items = channel === 'telegram' ? [] : (list.data?.items ?? []);
  const unreadCount = items.filter((one) => one.unread_count > 0).length;

  /* On a computer the thread is always on screen, so open the first chat
     rather than leaving two thirds of the page blank. On a phone opening one
     replaces the list, so it waits to be asked. */
  useEffect(() => {
    if (narrow || openId || items.length === 0) return;
    setOpenId(items[0]!.id);
  }, [narrow, openId, items]);

  const open = items.find((one) => one.id === openId) ?? null;

  /*
   * The lead behind the open chat, fetched once for the whole screen.
   *
   * It was fetched inside the thread on a phone and inside the side panel on
   * a computer, which meant the computer's thread header could not link to
   * the lead at all — and the design's one button up there is "Open the
   * lead". One request, two places.
   */
  const detail = useAsync<Contact360 | null>(
    () => (open ? api.get(`/api/contacts/${open.contact_id}`) : Promise.resolve(null)),
    [open?.contact_id],
  );
  const openings = useAsync<{ openings: Array<{ key: string; label: string; text: string }> } | null>(
    () => (open
      ? api.get(`/api/email/whatsapp-openings/${open.contact_id}`)
      : Promise.resolve(null)),
    [open?.contact_id],
  );
  const showList = !narrow || !open;
  const showThread = !narrow || Boolean(open);
  const filtered = Boolean(search.trim()) || channel !== 'any' || unreadOnly;

  return (
    <div className="v2-inbox p-inbox">
      {/*
        * The design's first element on this page, and the one the audit
        * found missing: `design/web/inbox.html` marks the whole screen a
        * later phase, in these words, with one button per role.
        *
        * It is still the truth of today. WhatsApp and email go nowhere
        * without their keys (`SETUP_NEEDED.md` §12), so what actually
        * happens is what the banner says: the agent opens the chat on their
        * phone and the tap is logged, which is the messaging report.
        *
        * On the computer only: under 768px this screen is `Inbox.dc.html`,
        * which draws no banner.
        */}
      {!phone && (
        <div className="d-later-banner">
          <span className="d-tag">LATER PHASE</span>
          <p>
            <b>Not in the first build.</b> For now WhatsApp and Telegram open on the
            agent&apos;s phone and every tap is logged.
          </p>
          <span className="d-grow" />
          {seesEveryone ? (
            <Link className="d-btn d-sm" to="/v2/messaging">Open the messaging report</Link>
          ) : (
            <Link className="d-btn d-sm" to="/v2/leads">Open My leads</Link>
          )}
        </div>
      )}
      <div className="d-ib">
        {showList && (
          <section className="d-card d-pad-0 v2-ib-list">
            <div className="d-ib-pad">
              <div className="d-input-icon">
                <Icon name="search" />
                <input
                  className="d-input d-sm"
                  value={typed}
                  aria-label="Search chats"
                  placeholder="Search chats"
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>

              <div className="d-seg d-sm d-block d-mt-8" role="tablist" aria-label="Whose chats">
                {([
                  ['mine', 'Mine'],
                  ['unassigned', 'Free'],
                  ...(seesEveryone ? [['all', 'Everyone'] as const] : []),
                ] as Array<[Scope, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={scope === value}
                    className={scope === value ? 'd-on' : undefined}
                    onClick={() => { setScopeChosen(true); setScope(value); }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="d-chips d-mt-8">
                {([
                  ['any', 'All'],
                  ['whatsapp', 'WhatsApp'],
                  /*
                   * The design's third channel. There is no Telegram chat in
                   * this CRM — `messages.channel` is whatsapp, email, sms or
                   * note, and Telegram is a tap on the agent's own phone,
                   * counted on the messaging report. The filter is drawn
                   * because the design draws it, and what it finds is
                   * nothing, with the empty state saying why rather than
                   * leaving somebody to wonder.
                   */
                  ['telegram', 'Telegram'],
                  ['email', 'Email'],
                ] as Array<[Channel, string]>)
                  .map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={channel === value}
                      className={channel === value ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => setChannel(value)}
                    >
                      {label}
                    </button>
                  ))}
                <button
                  type="button"
                  aria-pressed={unreadOnly}
                  className={unreadOnly ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => setUnreadOnly(!unreadOnly)}
                >
                  Unread{unreadCount > 0 ? ` · ${unreadCount}` : ''}
                </button>
              </div>
            </div>

            <div className="d-ib-scroll">
              {list.error && <ErrorNote>{list.error}</ErrorNote>}
              {list.loading && items.length === 0 && <Spinner />}
              {!list.loading && items.length === 0 && (
                <div className="d-empty">
                  <span className="d-ic"><Icon name="message-circle" /></span>
                  <b>No chats here</b>
                  <p>
                    {channel === 'telegram'
                      ? 'No Telegram chat is in the CRM. On Telegram the agent writes from '
                        + 'their own phone, and every tap is counted on the messaging report.'
                      : filtered ? 'Try another filter.'
                        : 'A chat appears as soon as a lead writes in.'}
                  </p>
                </div>
              )}
              {items.map((one) => (
                <ChatRow
                  key={one.id}
                  chat={one}
                  on={one.id === openId}
                  onOpen={() => setOpenId(one.id)}
                />
              ))}
            </div>
          </section>
        )}

        {showThread && open && (
          <Thread
            key={open.id}
            chat={open}
            narrow={narrow}
            phone={phone}
            detail={detail.data}
            openings={openings.data?.openings ?? []}
            prefill={prefill}
            onBack={() => setOpenId(null)}
            onChanged={() => setVersion((n) => n + 1)}
          />
        )}

        {showThread && !open && (
          <section className="d-card v2-ib-chat">
            <div className="d-empty">
              <span className="d-ic"><Icon name="message-circle" /></span>
              <b>Pick a chat</b>
              <p>Every WhatsApp, email and note for one person sits in one thread.</p>
            </div>
          </section>
        )}

        {showThread && open && !phone && (
          <LeadSide
            detail={detail.data}
            error={detail.error}
            openings={openings.data?.openings ?? []}
            onUse={(text) => setPrefill({ text, at: Date.now() })}
          />
        )}
      </div>
    </div>
  );
}

/* ── the list ──────────────────────────────────────────────────────────── */

function ChatRow({ chat, on, onOpen }: { chat: Conversation; on: boolean; onOpen: () => void }) {
  /* A send that failed — no WhatsApp key, a template not approved — used to
     preview here as "You: Hello Fatima…", so a chat nobody had answered
     looked answered. The server sends the last message's status for exactly
     this line; say plainly that it did not go. */
  const failed = chat.last_direction === 'outbound' && chat.last_status === 'failed';
  const preview = chat.last_body
    ? (chat.last_direction === 'outbound' ? `You: ${chat.last_body}` : chat.last_body)
    : 'No messages yet';

  return (
    <button type="button" className={on ? 'd-cv d-on' : 'd-cv'} onClick={onOpen}>
      <Avatar name={chat.full_name} />
      <span className="d-grow">
        <span className="d-row d-gap-6">
          <b className="d-truncate">{chat.full_name ?? chat.phone_e164 ?? 'Unknown'}</b>
          <ChannelMark channel={chat.last_channel} />
          <span className="d-grow" />
          <span className="d-tiny d-muted">{whenShort(chat.last_message_at)}</span>
        </span>
        <span className="d-row d-gap-6">
          <span className="d-grow">
            <span className={failed ? 'd-sub d-truncate v2-ib-failed' : 'd-sub d-truncate'}>
              {failed ? 'Not sent — needs you' : preview}
            </span>
          </span>
          {chat.unread_count > 0 && <span className="d-badge d-accent">{chat.unread_count}</span>}
        </span>
      </span>
    </button>
  );
}

/**
 * "WhatsApp", "Email", "Note" — the word the design's chat header carries
 * before the number. The CRM's `messages.channel` is one of four; "Telegram"
 * is never one of them, which is why the filter beside it finds nothing.
 */
function channelWord(channel: string | null): string {
  if (channel === 'email') return 'Email';
  if (channel === 'note') return 'Note';
  if (channel === 'sms') return 'SMS';
  return 'WhatsApp';
}

/** The little green square in the design, one per channel. */
function ChannelMark({ channel }: { channel: string | null }) {
  if (channel === 'email') {
    return <span className="d-ch v2-ch-mail" title="Email"><Icon name="mail" /></span>;
  }
  if (channel === 'note') {
    return <span className="d-ch v2-ch-note" title="Internal note"><Icon name="sticky-note" /></span>;
  }
  return <span className="d-ch d-wa" title="WhatsApp"><Icon name="message-circle" /></span>;
}

/* ── the thread ────────────────────────────────────────────────────────── */

function Thread({
  chat, narrow, phone, detail, openings, prefill, onBack, onChanged,
}: {
  chat: Conversation;
  narrow: boolean;
  phone: boolean;
  detail: Contact360 | null;
  openings: Array<{ key: string; label: string; text: string }>;
  prefill: { text: string; at: number } | null;
  onBack: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  /* Every call affordance in the prototypes exists twice — a link when the
     agent is checked in, a button that opens the gate when they are not.
     This is the shared gate, not a second one. */
  const gate = useCheckIn({ strip: false });
  const scroller = useRef<HTMLDivElement | null>(null);

  const thread = useAsync<ThreadResponse>(
    () => api.get(`/api/inbox/conversations/${chat.id}`),
    [chat.id, chat.last_message_at, chat.unread_count],
  );
  const templates = useAsync<{ items: TemplateRow[] }>(() => api.get('/api/templates'), []);

  /*
   * On a phone the lead panel is gone, so the two things it carried that the
   * design keeps on the chat itself come here: the name as a link to the
   * lead page, and the ready messages as a row of chips above the composer.
   * Both are handed down from the screen, which fetches them once for the
   * thread and the side panel together.
   */
  const leadId = detail?.opportunities?.[0]?.id ?? null;

  const [mode, setMode] = useState<Mode>('whatsapp');
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [sending, setSending] = useState(false);

  const conversation = thread.data?.conversation ?? null;
  const windowOpen = conversation?.whatsappWindowOpen ?? false;
  const templateOnly = mode === 'whatsapp' && !windowOpen;

  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [thread.data?.messages.length]);

  /* A ready message pressed in the side panel lands in the box here. */
  useEffect(() => {
    if (prefill) setDraft(prefill.text);
  }, [prefill]);

  /* Opening a chat is reading it. */
  useEffect(() => {
    if (!conversation || conversation.unread_count === 0) return;
    void api.post(`/api/inbox/conversations/${chat.id}/read`).then(onChanged).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, conversation?.unread_count]);

  /* The collision guard: a 90-second soft lock so two agents do not answer
     the same client in the same minute. */
  const announceTyping = useCallback(() => {
    void api.post(`/api/inbox/conversations/${chat.id}/typing`).catch(() => undefined);
  }, [chat.id]);

  const approved = useMemo(
    () => (templates.data?.items ?? []).filter((one) => one.status === 'APPROVED'),
    [templates.data],
  );

  const timeline = useMemo(() => buildTimeline(thread.data), [thread.data]);

  /* What the chosen template actually says. It is in `wa_templates.components`
     once the templates have been synced from Meta, and missing before that. */
  const chosenBody = useMemo(
    () => bodyOf(approved.find((one) => one.name === templateName)),
    [approved, templateName],
  );

  async function send() {
    const url = `/api/inbox/conversations/${chat.id}/send`;
    setSending(true);
    try {
      if (mode === 'note') {
        await api.post(url, { channel: 'note', text: draft.trim() });
      } else if (mode === 'email') {
        await api.post(url, { channel: 'email', subject: subject.trim(), text: draft.trim() });
      } else if (templateOnly) {
        await api.post(url, {
          channel: 'whatsapp',
          kind: 'template',
          templateName,
          templateLanguage: approved.find((one) => one.name === templateName)?.language ?? 'en',
          /* The template's own blanks, in order, as the agent typed them. */
          bodyParams: draft.split('|').map((part) => part.trim()).filter(Boolean),
        });
      } else {
        await api.post(url, { channel: 'whatsapp', kind: 'text', text: draft.trim() });
      }
      setDraft('');
      setSubject('');
      thread.reload();
      onChanged();
    } catch (err) {
      /* The server answers 409 when nothing went out — no key, no consent, on
         the do-not-contact list. Say which, rather than pretending it sent. */
      toast(err instanceof Error ? err.message : 'That did not send.');
    } finally {
      setSending(false);
    }
  }

  const canSend = !sending && (
    mode === 'note' ? draft.trim().length > 0
      : mode === 'email' ? subject.trim().length > 0 && draft.trim().length > 0
        : templateOnly ? templateName.length > 0
          : draft.trim().length > 0);

  return (
    <section className="d-card d-pad-0 v2-ib-chat">
      <div className="d-ib-head">
        {narrow && (
          <button
            type="button"
            className="d-btn d-icon d-sm d-ghost"
            aria-label="Back to the chats"
            onClick={onBack}
          >
            <Icon name="arrow-left" />
          </button>
        )}
        <Avatar name={chat.full_name} />
        <div className="d-grow">
          {/* `Chat.dc.html` wraps the name and the line under it in a link to
              the lead. Without it the only way through was "Open the lead" at
              the foot of a panel that a phone does not show. */}
          {leadId ? (
            <Link className="d-bold d-truncate" to={`/v2/leads/${String(leadId)}`}>
              {chat.full_name ?? 'Unknown'}
            </Link>
          ) : (
            <b className="d-bold d-truncate">{chat.full_name ?? 'Unknown'}</b>
          )}
          {/* The design's line is the channel and the number — "WhatsApp ·
              +39 333 455 4821". The channel word had gone missing, and it is
              the one thing on the line that says which way a reply leaves. */}
          <div className="d-small d-muted d-truncate">
            {channelWord(chat.last_channel)} · {chat.phone_e164 ?? chat.email ?? '—'}
          </div>
        </div>
        {/* `Chat.dc.html` puts a round call button in the thread header: the
            one action a thread has that opening the lead page is a detour
            for. It asks the check-in gate, as every call affordance does. */}
        {phone && chat.phone_e164 && (
          <button
            type="button"
            className="v2-b-call"
            aria-label={`Call ${chat.full_name ?? 'this lead'}`}
            onClick={() => {
              void gate.ask().then((answer) => {
                if (answer === 'cancel') return;
                window.location.href = `tel:${chat.phone_e164}`;
              });
            }}
          >
            <Icon name="phone" />
          </button>
        )}
        <WindowChip conversation={conversation} />
        {/* The design's one button up here: "Open the lead". It was moved to
            the foot of the side panel, which a narrow window does not show
            at all. Both are kept — this is the design's. */}
        {leadId && !phone && (
          <Link className="d-btn d-sm" to={`/v2/leads/${String(leadId)}`}>Open the lead</Link>
        )}
      </div>

      <div className="d-ib-msgs" ref={scroller}>
        {thread.error && <ErrorNote>{thread.error}</ErrorNote>}
        {!thread.data && !thread.error && <Spinner />}
        {thread.data && timeline.length === 0 && (
          <span className="d-bb-sys">Nothing has been said yet.</span>
        )}
        {timeline.map((entry) => (
          entry.kind === 'day' ? <span className="d-bb-day" key={entry.key}>{entry.text}</span>
            : entry.kind === 'event' ? <span className="d-bb-sys" key={entry.key}>{entry.text}</span>
              : <Bubble key={entry.key} message={entry.message} who={chat.full_name} />
        ))}
      </div>

      {conversation?.replyLock && (
        <p className="d-ib-foot v2-ib-lock">
          <Icon name="pencil" />
          Somebody else is replying to this chat.
        </p>
      )}

      {/* One thread, three channels — the composer says which one is about to
          be used, because WhatsApp and email reach the client and a note
          does not. */}
      <div className="d-ib-compose v2-ib-modes">
        {([['whatsapp', 'WhatsApp'], ['email', 'Email'], ['note', 'Note']] as Array<[Mode, string]>)
          .map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              className={mode === value ? 'd-chip-opt d-on' : 'd-chip-opt'}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
      </div>

      {templateOnly && (
        <>
          <div className="d-ib-compose v2-ib-tpl">
            <span className="d-chip d-amber d-pip">Window closed</span>
            <select
              className="d-select d-sm d-grow"
              value={templateName}
              aria-label="Approved template"
              onChange={(e) => setTemplateName(e.target.value)}
            >
              <option value="">Choose an approved template…</option>
              {approved.map((one) => (
                <option key={one.id} value={one.name}>{one.name} · {one.language}</option>
              ))}
            </select>
          </div>
          {/* The wording, so the agent can see which blank is which before
              typing them into one line. Meta numbers them {{1}}, {{2}}. */}
          {chosenBody && (
            <p className="d-ib-compose v2-ib-tpl-body">{chosenBody}</p>
          )}
        </>
      )}

      {mode === 'email' && (
        <div className="d-ib-compose">
          <input
            className="d-input d-sm"
            value={subject}
            aria-label="Subject"
            placeholder="Subject"
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
      )}

      {/* The design's quick-send row above the composer, horizontally
          scrolling. Its own five chips name a payment plan and a video the
          CRM does not hold; these are the server's openings, written from
          the project the lead actually asked about, and tapping one fills
          the box rather than sending anything. */}
      {phone && !templateOnly && mode === 'whatsapp' && openings.length > 0 && (
        <div className="v2-b-quick">
          {openings.map((one) => (
            <button
              key={one.key}
              type="button"
              className="d-chip-opt"
              onClick={() => setDraft(one.text)}
            >
              {one.label}
            </button>
          ))}
        </div>
      )}

      <div className="d-ib-compose">
        <input
          className="d-input"
          value={draft}
          aria-label="Message"
          disabled={sending}
          placeholder={
            templateOnly
              ? 'What goes in the blanks, separated by |'
              : mode === 'note'
                ? 'A note for your team. The client never sees it.'
                : 'Write a message…'
          }
          onFocus={announceTyping}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canSend) void send(); }}
        />
        <button
          type="button"
          className="d-btn d-primary"
          disabled={!canSend}
          onClick={() => void send()}
        >
          <Icon name="send" />{sending ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div className="d-ib-foot d-lt-note">
        {templateOnly
          ? approved.length === 0
            ? 'No template is approved yet, so nothing can go out on WhatsApp until one is. '
              + 'Ask the owner to check Templates.'
            : 'More than 24 hours since this client last wrote, so WhatsApp only accepts a '
              + 'template Meta has approved. Free typing comes back the moment they reply.'
          : mode === 'note'
            ? 'A note stays inside the CRM.'
            : 'Nothing goes out until you press Send.'}
      </div>

      {/* The design's own foot line, which says what today really is. The
          line above it is Meta's 24-hour rule, which the drawing has no
          state for and which can get the company's number banned. */}
      {!phone && (
        <div className="d-ib-foot d-lt-note">
          In this later phase messages go out from the company WhatsApp number. Today
          the agent presses send on the phone.
        </div>
      )}

      {gate.banner}
    </section>
  );
}

/** "Italy 11:55" beside the stage, from the dialling code and nothing else. */
function LocalTime({ phone }: { phone: string | null }) {
  const origin = originOf(phone);
  const clock = clockIn(origin?.timeZone ?? null);
  if (!origin || !clock) return null;
  return (
    <span className="d-small d-muted" title={clock.offset}>
      {origin.zoneLabel ?? origin.name} {clock.time}
    </span>
  );
}

function WindowChip({ conversation }: { conversation: ThreadResponse['conversation'] | null }) {
  if (!conversation) return null;
  if (!conversation.whatsappWindowOpen) {
    return (
      <span className="d-chip d-amber d-pip" title="Meta only accepts approved templates now">
        Templates only
      </span>
    );
  }
  const closes = conversation.whatsappWindowExpiresAt;
  const left = closes ? Math.round((new Date(closes).getTime() - Date.now()) / 3_600_000) : null;
  return (
    <span className="d-chip d-green d-pip" title="You can type freely for now">
      Open{left !== null && left > 0 ? ` · ${left} h left` : ''}
    </span>
  );
}

function Bubble({ message, who }: { message: Message; who: string | null }) {
  const outbound = message.direction === 'outbound';
  const failed = message.status === 'failed';
  const classes = ['d-bb'];
  if (outbound) classes.push('d-me');
  if (message.channel === 'note') classes.push('v2-bb-note');
  if (failed) classes.push('v2-bb-failed');

  return (
    <div className={classes.join(' ')}>
      <span className="d-tiny d-muted v2-bb-by">
        {message.channel === 'note'
          ? `Note · ${message.user_name ?? 'team'}`
          : message.is_automated === 1
            ? 'Sent automatically'
            : message.user_name ?? (outbound ? 'You' : who ?? '')}
        {message.template_name ? ` · ${message.template_name}` : ''}
        {message.channel === 'email' ? ' · email' : ''}
      </span>
      {message.subject && <b className="v2-bb-subject">{message.subject}</b>}
      <span className="v2-bb-text">{message.body ?? '—'}</span>
      {failed && (
        <span className="v2-bb-why">
          Not sent{message.error_message ? ` — ${message.error_message}` : ''}
        </span>
      )}
      <small>
        {formatTime(message.created_at)}
        {outbound && !failed && <Ticks status={message.status} />}
      </small>
    </div>
  );
}

/** Delivery ticks, as WhatsApp draws them. */
function Ticks({ status }: { status: Message['status'] }) {
  const mark: Record<string, IconName> = {
    queued: 'clock', sent: 'check', delivered: 'check-check', read: 'check-check',
  };
  const icon = mark[status];
  if (!icon) return null;
  return (
    <span className={status === 'read' ? 'v2-tick v2-tick-read' : 'v2-tick'} title={status}>
      <Icon name={icon} size={13} />
    </span>
  );
}

/* ── the lead, beside the thread ───────────────────────────────────────── */

function LeadSide({ detail, error, openings, onUse }: {
  detail: Contact360 | null;
  error: string | null;
  openings: Array<{ key: string; label: string; text: string }>;
  onUse: (text: string) => void;
}) {
  const toast = useToast();
  /* The real count, so the link can say it the way the design does —
     "All 16 templates". */
  const templates = useAsync<{ items: TemplateRow[] }>(() => api.get('/api/templates'), []);

  const contact = detail?.contact ?? null;
  const lead = detail?.opportunities?.[0] ?? null;
  const task = detail?.tasks?.find((one) => !one.completed_at) ?? null;
  const stage = (lead?.stage_key ?? null) as StageKey | null;

  return (
    <aside className="d-card d-ib-side v2-ib-side" aria-label="The lead">
      <h4>Lead</h4>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!detail && !error && <Spinner />}

      {contact && (
        <>
          <div>
            <div className="d-phone-big v2-ib-phone">{contact.phone_e164 ?? '—'}</div>
            <div className="d-row d-gap-8 d-mt-8 d-wrap">
              {stage && (
                <span className={`v2-stage v2-stage-${STAGE_CLASS[stage] ?? 'new'}`}>
                  {STAGE_LABEL[stage] ?? stage}
                </span>
              )}
              {/*
                * The design's "Milan 11:55" — what the clock says where the
                * client is, so nobody rings Moscow at six in the morning.
                * §4.5 of the research, and it was on no screen here.
                *
                * The place is the country the dialling code names, or the
                * city whose clock it is where a country spans several zones.
                * The design writes a city for every lead; the CRM knows the
                * number, not the town, and a town it does not know is not
                * one it will invent.
                */}
              <LocalTime phone={contact.phone_e164} />
              <span className="d-small d-muted">Score {contact.lead_score}</span>
              {contact.dnc === 1 && <span className="d-chip d-red d-pip">Do not contact</span>}
            </div>
          </div>

          <dl className="d-kv">
            <Kv term="Wants" value={wants(lead)} />
            <Kv term="Agent" value={contact.owner_name} />
            <Kv term="Next step" value={task ? `${task.title} · ${formatTime(task.due_at)}` : null} />
            <Kv term="Language" value={contact.language} />
          </dl>

          {contact.ai_summary && <p className="d-small d-muted">{contact.ai_summary}</p>}

          {/* The design calls these "ready messages". They are written by the
              server from the project this lead asked about, so no price,
              plan or handover date can creep into one. */}
          <h4 className="d-mt-8">Ready messages</h4>
          <div className="d-col d-gap-6">
            {openings.map((one) => (
              <button
                key={one.key}
                type="button"
                className="d-btn d-sm d-block"
                /* The design fills the composer with it. It used to copy to
                   the clipboard, because the box is in another component —
                   which it still is, so the text goes up and across. */
                onClick={() => {
                  onUse(one.text);
                  toast('In the box. Change it if you like, then press Send.');
                }}
              >
                {one.label}
              </button>
            ))}
            {lead && (
              <Link className="d-btn d-sm d-block d-ghost" to={`/v2/leads/${String(lead.id)}`}>
                Open the lead
              </Link>
            )}
            <Link className="d-btn d-sm d-block d-ghost" to="/v2/templates">
              {templates.data ? `All ${templates.data.items.length} templates` : 'All templates'}
            </Link>
          </div>
        </>
      )}
    </aside>
  );
}

function Kv({ term, value }: { term: string; value: string | null | undefined }) {
  return (
    <div className="d-kv-row">
      <dt>{term}</dt>
      <dd>{value ?? <span className="d-muted">—</span>}</dd>
    </div>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

type Entry =
  | { kind: 'day'; key: string; text: string }
  | { kind: 'event'; key: string; text: string }
  | { kind: 'message'; key: string; message: Message };

/**
 * Messages and system events in one timeline, with a day marker.
 *
 * The master prompt asks for one thread per contact mixing WhatsApp, email,
 * notes and system events, so the events are not a second list beside the
 * messages — they are in the same column, in the order things happened.
 */
function buildTimeline(thread: ThreadResponse | null): Entry[] {
  if (!thread) return [];

  const rows: Array<{ at: number; entry: Entry }> = [];
  for (const message of thread.messages) {
    rows.push({
      at: new Date(message.created_at).getTime(),
      entry: { kind: 'message', key: `m-${message.id}`, message },
    });
  }
  for (const event of thread.events) {
    rows.push({
      at: new Date(event.created_at).getTime(),
      entry: { kind: 'event', key: `e-${event.id}`, text: event.title },
    });
  }
  rows.sort((a, b) => a.at - b.at);

  const out: Entry[] = [];
  let day = '';
  for (const row of rows) {
    const label = dayLabel(row.at);
    if (label !== day) {
      day = label;
      out.push({ kind: 'day', key: `d-${label}-${row.at}`, text: label });
    }
    out.push(row.entry);
  }
  return out;
}

/** A template's body text, when the sync has brought it down from Meta. */
function bodyOf(template: TemplateRow | undefined): string | null {
  if (!template) return null;
  const raw = (template as TemplateRow & { components?: unknown }).components;
  const parsed = Array.isArray(raw)
    ? raw
    : typeof raw === 'string' && raw.trim() !== ''
      ? safeParse(raw)
      : null;
  if (!Array.isArray(parsed)) return null;
  const body = parsed.find((one) => (one as { type?: string }).type === 'BODY');
  return (body as { text?: string } | undefined)?.text ?? null;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Dubai's day, so a message at 01:00 is not filed under yesterday. */
function dayLabel(at: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short',
  }).format(new Date(at));
}

function whenShort(at: string | null): string {
  if (!at) return '';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = dayLabel(date.getTime()) === dayLabel(Date.now());
  if (sameDay) return formatTime(date);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai', day: 'numeric', month: 'short',
  }).format(date);
}

/** What the lead asked for, from their own enquiry. Never a guess. */
function wants(lead: Record<string, unknown> | null): string | null {
  if (!lead) return null;
  const budget = Number(lead.budget_max_aed ?? 0);
  const parts = [
    lead.project_name,
    lead.unit_type,
    budget > 0 ? `AED ${budget.toLocaleString('en-GB')}` : lead.budget_band,
  ].filter((part): part is string => typeof part === 'string' && part.length > 0);
  return parts.length > 0 ? parts.join(' · ') : null;
}
