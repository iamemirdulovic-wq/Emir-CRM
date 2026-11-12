import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar } from '../design/ui.js';

/**
 * Homes AI.
 *
 * `docs/v2/pages.md` §7. It answers from the CRM's own data through
 * permission-checked tools, so an agent's answer is about their leads and an
 * owner's is about everybody's — the fence is in the SQL, not on this screen.
 *
 * Two things are said out loud on the page rather than assumed, because both
 * are what makes it safe to use with a client on the phone: it reads only
 * what you can see, and it never sends anything to anybody.
 */

interface Turn {
  who: 'me' | 'ai';
  body: string;
  tools?: string[];
  failed?: boolean;
}

const TRY = [
  'Which leads should I call first?',
  'Why so many junk leads?',
  'How is the team doing this week?',
  'Summarise what happened with Ahmed Khan',
  'Which project is bringing the most leads?',
];

export function V2Ai() {
  const { user } = useAuth();
  const [thread, setThread] = useState<Turn[]>([]);
  const [asking, setAsking] = useState('');
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread.length, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setThread((was) => [...was, { who: 'me', body: text }]);
    setAsking('');
    setBusy(true);
    try {
      const got = await api.post<{ answer: string; toolsUsed: string[]; conversationId: string }>(
        '/api/ai/ask', { question: text, conversationId },
      );
      setConversationId(got.conversationId ?? null);
      setThread((was) => [...was, { who: 'ai', body: got.answer, tools: got.toolsUsed }]);
    } catch (err) {
      /*
       * A failure is shown in the thread rather than as a toast that vanishes:
       * the question is still on screen, and the usual cause — no API key yet
       * — is something only Emir can fix, so it has to stay readable.
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

  return (
    <div className="v2-ai">
      <header className="v2-inc-head">
        <h1 className="v2-hi">Homes AI</h1>
        <p className="d-muted">
          It reads only what you can see, and it never sends a message to anybody.
        </p>
      </header>

      <div className="v2-ai-thread">
        {thread.length === 0 && (
          <div className="v2-ai-start">
            <span className="v2-ai-mark"><Icon name="sparkles" /></span>
            <h2>Ask it anything about the CRM</h2>
            <p className="d-muted">
              It looks the answer up in your own leads, calls and projects. If it cannot
              find something it says so rather than guessing.
            </p>
            <div className="v2-chips">
              {TRY.map((one) => (
                <button key={one} type="button" className="v2-chip-opt" onClick={() => ask(one)}>
                  {one}
                </button>
              ))}
            </div>
          </div>
        )}

        {thread.map((turn, i) => (
          <div
            key={`${turn.who}-${i}`}
            className={turn.who === 'me' ? 'v2-turn v2-turn-me' : 'v2-turn'}
          >
            {turn.who === 'me'
              ? <Avatar name={user?.name ?? '?'} src={user?.photoUrl ?? undefined} />
              : <span className="v2-ai-face"><Icon name="sparkles" /></span>}
            <div className={turn.failed ? 'v2-turn-body v2-turn-failed' : 'v2-turn-body'}>
              <p>{turn.body}</p>
              {turn.tools && turn.tools.length > 0 && (
                <span className="v2-turn-tools">
                  Looked at: {turn.tools.map((t) => t.replace(/_/g, ' ')).join(', ')}
                </span>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="v2-turn">
            <span className="v2-ai-face"><Icon name="sparkles" /></span>
            <div className="v2-turn-body"><p className="d-muted">Looking…</p></div>
          </div>
        )}

        <div ref={bottom} />
      </div>

      <form
        className="d-card v2-ai-ask"
        onSubmit={(e) => { e.preventDefault(); void ask(asking); }}
      >
        <input
          className="d-input"
          value={asking}
          placeholder="Ask about your leads, your week, a project…"
          onChange={(e) => setAsking(e.target.value)}
        />
        <button type="submit" className="d-btn d-primary" disabled={busy || !asking.trim()}>
          <Icon name="send" />Ask
        </button>
      </form>
    </div>
  );
}
