import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { usePhoneHead } from './phone.js';

/**
 * Homes AI, from `design/web/homes-ai.html`.
 *
 * The chat on the left, and on the right the three cards the design puts
 * there: one tip worth acting on now, what it can and cannot do, and the
 * questions this person has asked before.
 *
 * **Nothing on this screen is a number the model made up.** The tip card is
 * `/api/activity/do-now` — counted by SQL, fenced to what the viewer may see.
 * The answers come from `/api/ai/ask`, which reaches the database through
 * read-only tools with the same fence, and the reply is rendered as **plain
 * text**: not because of styling, but because a model's words must never
 * arrive on this page as markup it chose.
 *
 * The "what it can do" card carries the two rules this product cannot bend
 * (CLAUDE.md, HARD RULES): it never sends anything to a client, and a price,
 * a payment plan or a handover date only ever comes out of the project
 * library. No yields, no returns, no forecasts — that is regulated here and
 * the brokerage carries it.
 */

interface Turn {
  who: 'me' | 'ai';
  body: string;
  tools?: string[];
  drafts?: Draft[];
  failed?: boolean;
}

/** A message Homes AI wrote for this person to send. It sends nothing. */
export interface Draft {
  contactId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  channel: 'whatsapp' | 'email';
  subject: string | null;
  body: string;
}

/** One past conversation, as the rail lists it. */
interface PastChat {
  id: string;
  title: string;
  at: string;
  who: string | null;
  mine: boolean;
}

/**
 * The four things an agent actually opens this page to do.
 *
 * Not a list of everything it can answer — four, big, tappable, in the order
 * a morning goes: who first, then write to them, then the project they asked
 * about. The long "what it can do" card this replaced told people what was
 * possible without making any of it one tap away.
 */
const STARTERS = [
  {
    icon: 'phone', title: 'Who should I call first?',
    sub: 'The order to work your list in, and why',
    ask: 'Who should I call first today, and why?',
  },
  {
    icon: 'message-circle', title: 'Write a WhatsApp',
    sub: 'For a lead, in their own language',
    ask: 'Write a WhatsApp follow-up for the lead I should call first, in the language they speak.',
  },
  {
    icon: 'mail', title: 'Write an email',
    sub: 'A follow-up you can read and send',
    ask: 'Write a follow-up email for one of my leads who has gone quiet.',
  },
  {
    icon: 'building-2', title: 'Tell me about a project',
    sub: 'Price, payment plan, what to say',
    ask: 'Which project do my leads ask about most, and what should I tell them about it?',
  },
] as const;

interface DoNow {
  greeting: string;
  cards: Array<{ key: string; title: string; why: string; count: number; href: string }>;
  allClear?: { title: string; hint: string };
}

/** The design's own suggested questions, one set per role. */
const TRY_OWNER = [
  'What needs me now?',
  'What is happening in the Dubai market this month?',
  'Which VIP leads are not called?',
  'Who has too many leads?',
  'How is today against yesterday?',
  'Which leads are going cold?',
];

/*
 * The last two are the two cases `AskAI.dc.html` puts chips on and the build
 * had neither: write me a message in the client's language, and read a
 * payment plan out of the project library. They are what the brief says Emir
 * AI is for. The prototype names a lead and a project in them because it is a
 * demo; these ask the same questions without inventing either.
 */
const TRY_AGENT = [
  'Who should I call first?',
  'What are prices doing in Dubai Marina right now?',
  'Which of my leads have no next step?',
  'What is my day today?',
  'Which of my leads are going cold?',
  'Which project do my leads ask about most?',
  'Write a WhatsApp message for my next follow-up, in the language they speak',
  'What is the payment plan of the project my leads ask about most?',
];

export function V2Ai() {
  const { user } = useAuth();
  const seesEveryone = user?.role !== 'agent';
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] ?? null;

  const [thread, setThread] = useState<Turn[]>([]);
  const [asking, setAsking] = useState('');
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();

  const tip = useAsync<DoNow>(() => api.get('/api/activity/do-now'), []);

  /* Past chats, from the server rather than this device: an agent who asked
     something on their phone should find it on the office computer. */
  const past = useAsync<{ canSeeEveryone: boolean; items: PastChat[] }>(
    () => api.get('/api/ai/conversations'), [],
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread.length, busy]);

  /*
   * `/v2/ai?q=…` asks the question on arrival, as the design does.
   *
   * The ref is what stops React's double-mount in development asking it
   * twice, which would be two rows in `ai_usage` and two charges for one
   * question.
   */
  const asked = useRef(false);
  const fromLink = params.get('q');
  useEffect(() => {
    if (!fromLink || asked.current) return;
    asked.current = true;
    void ask(fromLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLink]);

  async function ask(question: string) {
    const text = question.trim();
    if (busy) return;
    if (!text) { setEmpty(true); return; }

    setThread((was) => [...was, { who: 'me', body: text }]);
    setAsking('');
    setEmpty(false);
    setBusy(true);

    try {
      const got = await api.post<{
        answer: string; toolsUsed: string[]; conversationId: string; drafts?: Draft[];
      }>('/api/ai/ask', { question: text, conversationId });
      setConversationId(got.conversationId ?? null);
      setThread((was) => [...was, {
        who: 'ai', body: got.answer, tools: got.toolsUsed, drafts: got.drafts ?? [],
      }]);
      past.reload();
    } catch (err) {
      /*
       * A failure stays in the thread rather than flashing past as a toast.
       * The question is still on screen, and the usual cause — no API key yet
       * — is something only the office can fix, so it has to stay readable.
       */
      setThread((was) => [...was, {
        who: 'ai',
        failed: true,
        body: err instanceof Error ? err.message : 'That did not work.',
      }]);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Open a chat from the rail.
   *
   * Named `openChat`, not `open`: a function called `open` inside a component
   * resolves to `window.open` when it is missing, and TypeScript says nothing
   * — the rail's buttons would have quietly tried to launch pop-up windows.
   */
  async function openChat(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const got = await api.get<{ turns: Turn[] }>(`/api/ai/conversations/${id}`);
      setThread(got.turns.map((turn) => ({
        who: turn.who,
        body: turn.body,
        tools: turn.tools ?? [],
        drafts: turn.drafts ?? [],
      })));
      setConversationId(id);
      setEmpty(false);
    } catch {
      setThread([{ who: 'ai', failed: true, body: 'That chat could not be opened.' }]);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = seesEveryone ? TRY_OWNER : TRY_AGENT;
  const urgent = tip.data?.cards[0] ?? null;

  /*
   * `AskAI.dc.html`: "Homes AI" over "Asks your leads, calendar and
   * projects". The privacy line stays inside the page, under the composer,
   * where the design puts it.
   */
  usePhoneHead({
    compact: true,
    title: 'Homes AI',
    sub: seesEveryone
      ? 'Asks the team’s leads, attendance and today’s numbers'
      : 'Asks your leads, calendar and projects',
  });

  return (
    /* The page class scopes the ported stylesheet, and every design element
       has to sit inside it — `.p-homes-ai .d-ai` is a descendant rule, so the
       two cannot share one element. */
    <div className="p-homes-ai v2-ai2">
      <div className="v2-ai2-wrap">

        {/* Past chats. Hidden on a phone, where the screen is the chat. */}
        <aside className="v2-ai2-rail">
          <button
            type="button"
            className="v2-ai2-new"
            onClick={() => { setThread([]); setConversationId(null); setEmpty(false); }}
          >
            <Icon name="plus" size={15} />New chat
          </button>

          <h4 className="v2-ai2-railttl">Your chats</h4>
          {past.data?.items.length === 0 && (
            <p className="d-small d-muted v2-ai2-none">Nothing yet. Ask something below.</p>
          )}
          <div className="v2-ai2-list">
            {(past.data?.items ?? []).map((one) => (
              <button
                key={one.id}
                type="button"
                className={one.id === conversationId ? 'v2-ai2-past v2-ai2-past-on' : 'v2-ai2-past'}
                onClick={() => void openChat(one.id)}
              >
                <span className="v2-ai2-pastttl">{one.title}</span>
                <span className="d-tiny d-muted">{when(one.at)}</span>
              </button>
            ))}
          </div>

          {/* Emir, 17 Nov: an owner or admin may read anyone's chats. An
              agent never sees this control, and never sees the list either —
              `/api/ai/conversations` hands them their own whatever they ask
              for. */}
          {past.data?.canSeeEveryone && (
            <p className="d-tiny d-muted v2-ai2-seen">
              You can open any agent's chats from
              {' '}<Link to="/v2/team">Team</Link>. They are told you can.
            </p>
          )}
        </aside>

        {/* The chat. One column, nothing beside it competing for the eye. */}
        <section className="v2-ai2-chat">
          {thread.length === 0 ? (
            <div className="v2-ai2-empty">
              <span className="v2-ai2-mark"><Icon name="sparkles" size={30} /></span>
              <h2 className="v2-ai2-hi">
                {partOfDay()}{firstName ? `, ${firstName}` : ''}.
              </h2>
              <p className="v2-ai2-sub">What do you need?</p>

              <div className="v2-ai2-cards">
                {STARTERS.map((one) => (
                  <button
                    key={one.title}
                    type="button"
                    className="v2-ai2-card"
                    onClick={() => void ask(one.ask)}
                  >
                    <span className="v2-ai2-cardi"><Icon name={one.icon} size={19} /></span>
                    <span className="v2-ai2-cardt">{one.title}</span>
                    <span className="v2-ai2-cards2">{one.sub}</span>
                  </button>
                ))}
              </div>

              {urgent && (
                <button type="button" className="v2-ai2-now" onClick={() => void ask('What needs me now?')}>
                  <Icon name="zap" size={15} />
                  <span>{urgent.title}. {urgent.why}</span>
                </button>
              )}

              <div className="v2-ai2-more">
                {suggestions.slice(0, 4).map((one) => (
                  <button key={one} type="button" className="v2-ai2-chip" onClick={() => void ask(one)}>
                    {one}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="v2-ai2-msgs">
              {thread.map((turn, i) => (
                <div
                  key={`${turn.who}-${i}`}
                  className={turn.who === 'me' ? 'v2-ai2-turn v2-ai2-mine' : 'v2-ai2-turn'}
                >
                  {turn.who === 'ai' && (
                    <span className="v2-ai2-who"><Icon name="sparkles" size={15} /></span>
                  )}
                  <div className="v2-ai2-body">
                    <div className={turn.failed ? 'v2-ai2-bub v2-bub-bad' : 'v2-ai2-bub'}>
                      <Answer body={turn.body} />
                    </div>
                    {(turn.drafts ?? []).map((draft, d) => (
                      <DraftCard key={`${i}-${d}`} draft={draft} />
                    ))}
                    {turn.tools && turn.tools.length > 0 && (
                      /* What it read, said out loud. An answer nobody can
                         check is an answer nobody should act on. */
                      <span className="d-tiny d-muted v2-ai2-read">
                        Read: {turn.tools.map((one) => one.replace(/_/g, ' ')).join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {busy && (
                <div className="v2-ai2-turn">
                  <span className="v2-ai2-who"><Icon name="sparkles" size={15} /></span>
                  <div className="v2-ai2-bub">
                    <span className="d-dots"><i /><i /><i /></span>
                  </div>
                </div>
              )}
              <div ref={bottom} />
            </div>
          )}

          {/* Pinned to the bottom, the way every chat anybody uses is. On the
              phone this was below five stacked buttons and a card: you
              scrolled to type. */}
          <form
            className="v2-ai2-form"
            onSubmit={(e) => { e.preventDefault(); void ask(asking); }}
          >
            <div className={empty ? 'v2-ai2-input v2-ai2-bad' : 'v2-ai2-input'}>
              <input
                type="text"
                maxLength={300}
                autoComplete="off"
                aria-label="Ask Homes AI"
                placeholder={seesEveryone
                  ? 'Ask about the team, the leads or today'
                  : 'Ask, or say "write a WhatsApp to…"'}
                value={asking}
                onChange={(e) => { setAsking(e.target.value); setEmpty(false); }}
              />
              <button
                type="submit"
                className="v2-ai2-send"
                disabled={busy || asking.trim().length === 0}
                aria-label="Ask"
              >
                <Icon name="arrow-up" size={17} />
              </button>
            </div>
            <p className="d-tiny d-muted v2-ai2-foot">
              {/* "Reads your own CRM only" stopped being true the moment it
                  could search the web. The line under the box is the one
                  sentence everybody on this screen reads, so it is the one
                  that most has to be right. */}
              {empty
                ? <span className="d-ai-err">Write a question first.</span>
                : seesEveryone
                  ? 'Reads your own CRM, and the web for market questions. It never sends a message.'
                  : 'Reads only your own leads, and the web for market questions. It never sends a message for you.'}
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}

/* ── when it writes you a message ──────────────────────────────────────── */

/**
 * A draft, as a card with a way to send it.
 *
 * The button opens WhatsApp — or the mail app — with the words already in
 * it, and the agent presses send there. That is the whole safety story in one
 * sentence: the CRM never has a path that puts these words in front of a
 * client without a person pressing send on their own device. CLAUDE.md's hard
 * rule, held in the shape of the thing rather than only in the prompt.
 */
function DraftCard({ draft }: { draft: Draft }) {
  const [copied, setCopied] = useState(false);
  const isWa = draft.channel === 'whatsapp';
  const digits = (draft.phone ?? '').replace(/[^\d]/g, '');

  const href = isWa
    ? (digits ? `https://wa.me/${digits}?text=${encodeURIComponent(draft.body)}` : null)
    : (draft.email
      ? `mailto:${draft.email}?subject=${encodeURIComponent(draft.subject ?? '')}`
        + `&body=${encodeURIComponent(draft.body)}`
      : null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* a browser that refuses the clipboard; the text is on screen */ }
  }

  return (
    <div className="v2-ai2-draft">
      <div className="v2-ai2-drafthd">
        <span className={isWa ? 'v2-ai2-dchan v2-ai2-dwa' : 'v2-ai2-dchan'}>
          <Icon name={isWa ? 'message-circle' : 'mail'} size={14} />
          {isWa ? 'WhatsApp' : 'Email'}
        </span>
        <span className="d-grow v2-ai2-dto">to {draft.name ?? 'this lead'}</span>
        <Link className="v2-ai2-dlead" to={`/v2/leads/${draft.contactId}`}>Open lead</Link>
      </div>

      {draft.subject && <p className="v2-ai2-dsub">{draft.subject}</p>}
      <p className="v2-ai2-dbody">{draft.body}</p>

      <div className="v2-ai2-dacts">
        <button type="button" className="v2-ai2-dcopy" onClick={() => void copy()}>
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span className="d-grow" />
        {href ? (
          <a className="v2-ai2-dsend" href={href} target="_blank" rel="noreferrer">
            <Icon name="arrow-up-right" size={14} />
            {isWa ? 'Open WhatsApp' : 'Open email'}
          </a>
        ) : (
          <span className="d-tiny d-muted">
            No {isWa ? 'number' : 'email address'} on this lead — copy it instead.
          </span>
        )}
      </div>
      <p className="d-tiny d-muted v2-ai2-dnote">
        Read it, change it, and press send yourself. Homes AI never sends it.
      </p>
    </div>
  );
}

/** "Good morning" and the rest, on Dubai's clock. */
function partOfDay(): string {
  /* Dubai is UTC+4 all year, so a fixed offset is right here — the same
     assumption `v2/dubai.ts` makes, deliberately. */
  const hour = new Date(Date.now() + 4 * 3600_000).getUTCHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "2h ago", "Yesterday", "14 Nov" — short enough for the rail. */
function when(at: string): string {
  const then = new Date(at).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 48) return 'Yesterday';
  return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* ── the pieces ────────────────────────────────────────────────────────── */

/**
 * The model's answer, as text.
 *
 * Paragraphs stay paragraphs and a line that starts with a dash or a bullet
 * becomes a list item, because that is how the model writes and the design
 * draws bullets. Everything is set as text content — the answer is never
 * handed to the browser as markup. The one exception is the lead token the
 * server asks the model for (`server/src/ai/ask.ts`, rule 6), which becomes
 * a link; that is how an answer gets "a link to the right page".
 */
function Answer({ body }: { body: string }) {
  const blocks: Array<{ kind: 'p' | 'ul'; lines: string[] }> = [];
  let blank = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) { blank = true; continue; }
    const bullet = /^([-*•]|\d+[.)])\s+/.exec(line);
    const kind = bullet ? 'ul' : 'p';
    const text = bullet ? line.slice(bullet[0].length) : line;
    const last = blocks[blocks.length - 1];
    /* A blank line ends a paragraph. It does not end a list: a model that
       double-spaces its bullets still means one list. */
    const join = last && last.kind === kind && !(blank && kind === 'p');
    if (join) last.lines.push(text);
    else blocks.push({ kind, lines: [text] });
    blank = false;
  }

  if (blocks.length === 0) return <p>{linked(body, 'x')}</p>;

  return (
    <>
      {blocks.map((block, i) => (block.kind === 'p'
        ? <p key={i}>{linked(block.lines.join(' '), `p${i}`)}</p>
        : (
          <ul key={i}>
            {block.lines.map((line, j) => <li key={j}>{linked(line, `l${i}-${j}`)}</li>)}
          </ul>
        )))}
    </>
  );
}

/**
 * `Sara Al Mansoori [lead:o-1]` becomes the name, then a link to that lead.
 *
 * The server tells the model to write the id in square brackets so the CRM
 * can link to it; without this the agent reads the bracket out loud. The link
 * is an arrow rather than borrowed words: the model writes the name, the
 * project and the score in whatever order suits the sentence, and a label
 * guessed from the words in front of the token was as often the project as
 * the person.
 */
const LEAD = /\[lead:([A-Za-z0-9_-]{1,64})\]/g;

function linked(line: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  let n = 0;
  for (const found of line.matchAll(LEAD)) {
    out.push(line.slice(at, found.index));
    out.push(
      <Link
        key={`${key}-${n}`}
        className="v2-bub-lead"
        to={`/v2/leads/${found[1]}`}
        title="Open this lead"
        aria-label="Open this lead"
      >
        <Icon name="arrow-up-right" size={13} />
      </Link>,
    );
    at = (found.index ?? 0) + found[0].length;
    n += 1;
  }
  if (n === 0) return [line];
  out.push(line.slice(at));
  return out;
}
