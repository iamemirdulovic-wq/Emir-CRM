import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';

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
  failed?: boolean;
}

interface DoNow {
  greeting: string;
  cards: Array<{ key: string; title: string; why: string; count: number; href: string }>;
  allClear?: { title: string; hint: string };
}

/** The design's own suggested questions, one set per role. */
const TRY_OWNER = [
  'What needs me now?',
  'Which VIP leads are not called?',
  'Who has too many leads?',
  'How is today against yesterday?',
  'Which leads are going cold?',
];

const TRY_AGENT = [
  'Who should I call first?',
  'Which of my leads have no next step?',
  'What is my day today?',
  'Which of my leads are going cold?',
  'Which project do my leads ask about most?',
];

/** Where this person's own past questions are kept. Their device, not ours. */
const ASKED_BEFORE = 'emir.v2.askedHomesAi';

export function V2Ai() {
  const { user } = useAuth();
  const seesEveryone = user?.role !== 'agent';
  const firstName = (user?.name ?? '').trim().split(/\s+/)[0] ?? null;

  const [thread, setThread] = useState<Turn[]>([]);
  const [asking, setAsking] = useState('');
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [before, setBefore] = useState<string[]>(() => readAsked());
  const bottom = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();

  const tip = useAsync<DoNow>(() => api.get('/api/activity/do-now'), []);

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
    setBefore(rememberAsked(text));

    try {
      const got = await api.post<{ answer: string; toolsUsed: string[]; conversationId: string }>(
        '/api/ai/ask', { question: text, conversationId },
      );
      setConversationId(got.conversationId ?? null);
      setThread((was) => [...was, { who: 'ai', body: got.answer, tools: got.toolsUsed }]);
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

  const suggestions = seesEveryone ? TRY_OWNER : TRY_AGENT;
  const urgent = tip.data?.cards[0] ?? null;

  return (
    /* The page class scopes the ported stylesheet, and every design element
       has to sit inside it — `.p-homes-ai .d-ai` is a descendant rule, so the
       two cannot share one element. */
    <div className="p-homes-ai">
      <div className="d-ai">
        <section className="d-card d-ai-chat d-pad-0">
          <div className="d-ai-head">
            <span className="d-ai-logo"><Icon name="sparkles" size={22} /></span>
            <div className="d-grow">
              <h2>Homes AI</h2>
              <p className="d-small d-muted">
                {seesEveryone
                  ? 'Reads the whole team. It never sends a message for anyone.'
                  : 'Reads only your own leads. It never sends a message for you.'}
              </p>
            </div>
            <button
              type="button"
              className="d-btn d-sm d-ghost"
              onClick={() => { setThread([]); setConversationId(null); setEmpty(false); }}
            >
              <Icon name="refresh-cw" size={15} />New chat
            </button>
          </div>

          <div className="d-ai-msgs">
            <Said>
              Hello{firstName ? ` ${firstName}` : ''}. Ask me in simple words. I answer from
              {seesEveryone
                ? " the team's leads, attendance and today's numbers"
                : ' your own leads, your calendar and the projects'}
              , and I give you a link to the right page.
            </Said>

            {thread.map((turn, i) => (
              <div
                key={`${turn.who}-${i}`}
                className={turn.who === 'me' ? 'd-msg d-me' : 'd-msg d-ai'}
              >
                {turn.who === 'ai' && (
                  <span className="d-who"><Icon name="sparkles" size={15} /></span>
                )}
                <div className={turn.failed ? 'd-bub v2-bub-bad' : 'd-bub'}>
                  <Answer body={turn.body} />
                  {turn.tools && turn.tools.length > 0 && (
                    /* What it read, said out loud. An answer nobody can check is
                       an answer nobody should act on. */
                    <span className="d-tiny d-muted v2-bub-read">
                      Read: {turn.tools.map((one) => one.replace(/_/g, ' ')).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="d-msg d-ai">
                <span className="d-who"><Icon name="sparkles" size={15} /></span>
                <div className="d-bub">
                  <span className="d-dots"><i /><i /><i /></span>
                </div>
              </div>
            )}

            <div ref={bottom} />
          </div>

          {thread.length === 0 && (
            <div className="d-ai-try">
              <h4>Try asking</h4>
              <div className="d-chips">
                {suggestions.map((one) => (
                  <button key={one} type="button" className="d-chip-opt" onClick={() => void ask(one)}>
                    {one}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form
            className="d-ai-form"
            onSubmit={(e) => { e.preventDefault(); void ask(asking); }}
          >
            <div className={empty ? 'd-ai-input d-bad' : 'd-ai-input'}>
              <input
                type="text"
                maxLength={300}
                autoComplete="off"
                aria-label="Ask Homes AI"
                placeholder={seesEveryone
                  ? 'Ask about the team, the leads or today'
                  : 'Ask about your leads, your day or a project'}
                value={asking}
                onChange={(e) => { setAsking(e.target.value); setEmpty(false); }}
              />
              <button type="submit" className="d-btn d-primary" disabled={busy}>
                <Icon name="arrow-up-right" size={15} />Ask
              </button>
            </div>
            <div className="d-row d-between">
              {empty && <span className="d-ai-err">Write a question first.</span>}
              <span className="d-small d-muted">
                {seesEveryone
                  ? 'It answers from your own data. It never sends a message.'
                  : 'Homes AI reads only your own leads. It never sends a message for you.'}
              </span>
              <span className="d-small d-muted">Enter to ask</span>
            </div>
          </form>
        </section>

        <aside className="d-col d-gap-16">
          <section className="d-card d-hero">
            <span className="d-label">Homes AI tip for now</span>
            <p className="d-ai-tip">
              {tip.error && 'The tip needs the day’s numbers, and they did not load.'}
              {!tip.error && !tip.data && 'Counting…'}
              {urgent && `${urgent.title}. ${urgent.why}`}
              {tip.data && !urgent && (tip.data.allClear?.title ?? 'Nothing is waiting on you.')}
            </p>
            {urgent && (
              <div className="d-card-foot">
                <Link className="d-btn d-sm d-on-dark" to={inV2(urgent.href)}>
                  Open the list <Icon name="arrow-right" size={15} />
                </Link>
              </div>
            )}
          </section>

          <section className="d-card">
            <div className="d-card-head"><h4>What it can do</h4></div>
            <div className="d-col d-gap-8 d-small d-ink-2">
              <Can yes>Find leads that need a call, a follow-up or a next step</Can>
              <Can yes>Explain a project: price, payment plan, pitch</Can>
              <Can yes>Write a message draft. You read it, change it and press send yourself.</Can>
              <Can yes>
                Prices, payment plans and handover dates come straight from the project library.
                It leaves a figure blank rather than guessing, and it never promises a return.
              </Can>
              <Can>It never sends a message, never changes a lead and never calls a client</Can>
              {!seesEveryone && <Can>It cannot see the leads of other agents</Can>}
            </div>
          </section>

          <section className="d-card d-flat">
            <div className="d-card-head"><h4>You asked before</h4></div>
            <div className="d-col d-gap-4">
              {before.length === 0 && (
                <p className="d-small d-muted">
                  Nothing yet. Your own questions are kept on this device, so you can ask one again.
                </p>
              )}
              {before.map((one) => (
                <button key={one} type="button" className="d-hist" onClick={() => void ask(one)}>
                  <Icon name="clock" size={14} />
                  <span>{one}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ── the pieces ────────────────────────────────────────────────────────── */

/** The opening line, in the design's own bubble. */
function Said({ children }: { children: ReactNode }) {
  return (
    <div className="d-msg d-ai">
      <span className="d-who"><Icon name="sparkles" size={15} /></span>
      <div className="d-bub"><p>{children}</p></div>
    </div>
  );
}

/**
 * The model's answer, as text.
 *
 * Paragraphs stay paragraphs and a line that starts with a dash or a bullet
 * becomes a list item, because that is how the model writes and the design
 * draws bullets. Everything is set as text content — the answer is never
 * handed to the browser as markup.
 */
function Answer({ body }: { body: string }) {
  const blocks: Array<{ kind: 'p' | 'ul'; lines: string[] }> = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^([-*•]|\d+[.)])\s+/.exec(line);
    const kind = bullet ? 'ul' : 'p';
    const text = bullet ? line.slice(bullet[0].length) : line;
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind) last.lines.push(text);
    else blocks.push({ kind, lines: [text] });
  }

  if (blocks.length === 0) return <p>{body}</p>;

  return (
    <>
      {blocks.map((block, i) => (block.kind === 'p'
        ? <p key={i}>{block.lines.join(' ')}</p>
        : (
          <ul key={i}>
            {block.lines.map((line, j) => <li key={j}>{line}</li>)}
          </ul>
        )))}
    </>
  );
}

function Can({ yes, children }: { yes?: boolean; children: ReactNode }) {
  return (
    <div className="d-row d-top d-gap-8">
      <Icon name={yes ? 'check' : 'x'} size={15} className={yes ? 'd-t-green' : 'd-t-red'} />
      <span>{children}</span>
    </div>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

/**
 * The tip card's link, in v2.
 *
 * `/api/activity/do-now` was written for the old screens and sends their
 * paths. The lead lists it points at exist here under `/v2`, with the same
 * tab names — except "hot", which v2's All leads does not have, so that one
 * opens the whole list rather than a tab that would silently do nothing.
 */
const V2_TABS = ['today', 'new', 'overdue', 'no_next_step', 'vip', 'lost', 'all'];

function inV2(href: string): string {
  if (!href.startsWith('/leads')) return href;
  const tab = /[?&]tab=([^&]+)/.exec(href)?.[1] ?? '';
  return V2_TABS.includes(tab) ? `/v2/leads?tab=${tab}` : '/v2/leads';
}

/** The last five questions, newest first. */
function readAsked(): string[] {
  try {
    const raw = localStorage.getItem(ASKED_BEFORE);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((one): one is string => typeof one === 'string') : [];
  } catch {
    return [];
  }
}

function rememberAsked(question: string): string[] {
  const next = [question, ...readAsked().filter((one) => one !== question)].slice(0, 5);
  try { localStorage.setItem(ASKED_BEFORE, JSON.stringify(next)); } catch { /* private window */ }
  return next;
}
