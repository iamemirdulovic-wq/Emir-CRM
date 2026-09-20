import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Icon } from '../design/index.js';

type Turn = { role: 'user' | 'assistant'; body: string; tools?: string[] };

/** The four the design puts under the first message. */
const SUGGESTIONS = [
  'Which leads should I call first?',
  'Why so many junk leads?',
  'Which campaign works best?',
  'What should we do today?',
];

/**
 * Ask Emir AI — the assistant on every CRM screen.
 *
 * It answers from the CRM's own data through read-only tools, fenced to what
 * the person asking is allowed to see. It suggests and explains; it never
 * changes anything, which is why there is no confirm step anywhere in here.
 */
export function AskEmirAi() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [thinking, setThinking] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const box = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);

  // Always looking at the newest message, as a chat should.
  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [turns, thinking]);

  useEffect(() => {
    if (open) window.setTimeout(() => box.current?.focus(), 200);
  }, [open]);

  // Escape closes it, like every other panel in the CRM.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  async function send(text: string) {
    const asked = text.trim();
    if (!asked || thinking) return;

    setTurns((current) => [...current, { role: 'user', body: asked }]);
    setQuestion('');
    setThinking(true);

    try {
      const result = await api.post<{ answer: string; toolsUsed: string[]; conversationId: string }>(
        '/api/ai/ask', { question: asked, conversationId },
      );
      setConversationId(result.conversationId);
      setTurns((current) => [...current, { role: 'assistant', body: result.answer, tools: result.toolsUsed }]);
    } catch (err) {
      setTurns((current) => [...current, {
        role: 'assistant',
        body: err instanceof Error ? err.message : 'Something went wrong. Try again.',
      }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ask-fab"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className="orb" />
        <span>Ask Emir AI</span>
      </button>

      <div className={open ? 'ask show' : 'ask'} role="dialog" aria-label="Ask Emir AI" aria-hidden={!open}>
        <div className="ask-h">
          <span className="orb" />
          <div>
            <b>Emir AI</b>
            <small>Knows your leads, chats and team</small>
          </div>
          <button type="button" className="icon-btn" style={{ marginInlineStart: 'auto' }} onClick={() => setOpen(false)} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>

        <div className="ask-body" ref={body}>
          {turns.length === 0 && (
            <div className="bubble">
              Ask me anything about your leads: who to call, which campaigns work, how the team is
              doing, or what a project actually costs. I only use what is in your CRM.
            </div>
          )}

          {turns.map((turn, index) => (
            <div className={turn.role === 'user' ? 'bubble me' : 'bubble'} key={index}>
              <Answer text={turn.body} onOpenLead={(id) => { setOpen(false); navigate(`/contacts/${id}`); }} />
              {turn.tools?.length ? (
                <div className="by" style={{ marginTop: 6, marginBottom: 0, opacity: 0.6 }}>
                  Looked at: {turn.tools.map(prettyTool).join(', ')}
                </div>
              ) : null}
            </div>
          ))}

          {thinking && (
            <div className="bubble">
              <span className="dots"><i /><i /><i /></span>
            </div>
          )}
        </div>

        {turns.length === 0 && (
          <div className="sugg">
            {SUGGESTIONS.map((text) => (
              <button type="button" key={text} onClick={() => void send(text)}>{text}</button>
            ))}
          </div>
        )}

        <div className="ask-in">
          <input
            className="input"
            ref={box}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void send(question); }}
            placeholder="Ask a question"
            disabled={thinking}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void send(question)}
            disabled={thinking || !question.trim()}
            aria-label="Send"
          >
            <Icon name="arrow-up" />
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The answer, with `[lead:id]` turned into something clickable.
 *
 * The model is asked to mark leads that way so an answer about a person is one
 * tap from that person, rather than a name to go and search for.
 */
function Answer({ text, onOpenLead }: { text: string; onOpenLead: (id: string) => void }) {
  const pieces = text.split(/(\[lead:[a-zA-Z0-9-]+\])/g);

  return (
    <>
      {pieces.map((piece, index) => {
        const match = /^\[lead:([a-zA-Z0-9-]+)\]$/.exec(piece);
        if (!match?.[1]) return <span key={index}>{piece}</span>;
        return (
          /* A small mark after the name rather than the word "open", which
             read as part of the sentence: "…scores 84 open." */
          <button
            type="button"
            className="lead-link"
            key={index}
            onClick={() => onOpenLead(match[1] as string)}
            title="Open this lead"
            aria-label="Open this lead"
          >
            <Icon name="arrow-up-right" size={12} />
          </button>
        );
      })}
    </>
  );
}

/** Tool names as a person would say them. */
function prettyTool(name: string): string {
  const words: Record<string, string> = {
    search_leads: 'your leads',
    get_lead: 'a lead',
    get_pipeline_stats: 'the pipeline',
    get_source_quality: 'where leads come from',
    get_agent_stats: 'the team',
    get_conversation: 'a conversation',
    get_projects: 'the projects',
  };
  return words[name] ?? name;
}
