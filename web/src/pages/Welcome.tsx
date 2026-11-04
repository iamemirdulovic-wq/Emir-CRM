/**
 * The welcome an agent gets on their first sign-in.
 *
 * Emir, Nov 4, 2026, wanted this to feel like an arrival rather than a form:
 * a skyline, some money, their name, then five questions about where they are
 * going. It is the first thing a new person sees of the company, so it is
 * worth the animation.
 *
 * Three things that are not decoration:
 *
 * **It can be skipped.** An agent signing in at a sales centre with a client
 * in front of them gets past this in one tap. The answers are worth having;
 * they are not worth standing between somebody and a lead.
 *
 * **It says the owner will read it**, before the first question rather than
 * in a footer. Answers somebody thought were private, quoted back later, is
 * how a team learns not to write anything honest in a CRM.
 *
 * **Every step saves.** A dropped connection on question four loses question
 * four, not the first three.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Button } from '../design/forms.js';
import { Spinner } from '../design/ui.js';
import { Icon } from '../design/index.js';

interface Question {
  id: string;
  emoji: string;
  prompt: string;
  hint?: string;
  kind: 'text' | 'number';
  placeholder?: string;
  min?: number;
  max?: number;
  maxLength?: number;
}

interface WelcomeState {
  questions: Question[];
  preferredName: string | null;
  answers: Record<string, string>;
  completed: boolean;
  skipped: boolean;
}

/* The scenes before the questions, then one scene per question, then thanks. */
type Scene = 'arrive' | 'name' | 'hello' | 'ready' | 'question' | 'thanks';

/** Dubai, drawn rather than photographed, so nothing waits on an image. */
function Skyline() {
  return (
    <svg className="wc-sky" viewBox="0 0 420 150" fill="none" aria-hidden="true">
      <g className="wc-sky-line" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M0 150 L0 118 L26 118 L26 96 L48 96 L48 150" />
        <path d="M56 150 L56 86 L78 74 L100 86 L100 150" />
        {/* The one everybody knows: a spire with three setbacks. */}
        <path d="M186 150 L190 70 L198 68 L202 30 L206 6 L210 30 L214 68 L222 70 L226 150" />
        <path d="M118 150 L118 104 L126 104 L126 62 L148 62 L148 104 L158 104 L158 150" />
        <path d="M240 150 L240 58 L250 50 L272 50 L282 58 L282 150" />
        <path d="M294 150 L294 92 L316 92 L316 70 L338 70 L338 150" />
        <path d="M350 150 L350 110 L372 110 L372 88 L394 88 L394 150" />
        <path d="M404 150 L404 120 L420 120 L420 150" />
      </g>
    </svg>
  );
}

/** Coins coming up past the skyline. Eight is enough to read as "money". */
function Coins() {
  return (
    <div className="wc-coins" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <span className="wc-coin" key={i} style={{ '--i': i } as React.CSSProperties}>
          <span>AED</span>
        </span>
      ))}
    </div>
  );
}

export function Welcome() {
  const navigate = useNavigate();
  const { user, refresh } = useAuth();

  const [state, setState] = useState<WelcomeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scene, setScene] = useState<Scene>('arrive');
  const [index, setIndex] = useState(0);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let alive = true;
    api.get<WelcomeState>('/api/onboarding')
      .then((data) => {
        if (!alive) return;
        setState(data);
        setDraft(data.answers);
        setName(data.preferredName ?? user?.name?.split(' ')[0] ?? '');
        /* Somebody part way through comes back to the first unanswered
           question, not to the skyline they have already seen. */
        if (Object.keys(data.answers).length) {
          const next = data.questions.findIndex((q) => !data.answers[q.id]);
          setScene('question');
          setIndex(next === -1 ? data.questions.length - 1 : next);
        }
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load this');
      });
    return () => { alive = false; };
  }, [user?.name]);

  /* The opening holds for a beat, then moves on by itself. Anyone who taps
     gets there sooner; nobody has to wait for it. */
  useEffect(() => {
    if (scene !== 'arrive') return undefined;
    const timer = window.setTimeout(() => setScene('name'), 2600);
    return () => window.clearTimeout(timer);
  }, [scene]);

  useEffect(() => { inputRef.current?.focus(); }, [scene, index]);

  const questions = state?.questions ?? [];
  const question = questions[index];
  const firstName = useMemo(
    () => (name.trim() || user?.name?.split(' ')[0] || 'there').trim(),
    [name, user?.name],
  );

  const save = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const next = await api.put<WelcomeState>('/api/onboarding', body);
      setState((prev) => (prev ? { ...prev, ...next } : prev));
      return next;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not save');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  async function leave() {
    await refresh();
    navigate('/profile', { replace: true });
  }

  async function finishLater() {
    await save({ preferredName: name.trim() || null, answers: draft, skip: true });
    await leave();
  }

  async function next() {
    if (!question) return;
    const value = (draft[question.id] ?? '').trim();
    if (!value) return;
    const saved = await save({ answers: { [question.id]: value } });
    if (!saved) return;
    if (index + 1 < questions.length) setIndex(index + 1);
    else setScene('thanks');
  }

  if (error && !state) {
    return (
      <div className="wc" data-scene="error">
        <div className="wc-card">
          <p className="wc-lede">{error}</p>
          <Button variant="primary" onClick={() => navigate('/dashboard', { replace: true })}>
            Go to the CRM
          </Button>
        </div>
      </div>
    );
  }
  if (!state) return <div className="wc"><Spinner /></div>;

  return (
    <div className="wc" data-scene={scene}>
      <div className="wc-bg" aria-hidden="true">
        <Skyline />
        <Coins />
      </div>

      <div className="wc-stage">
        {scene === 'arrive' && (
          <div className="wc-card wc-in">
            <div className="wc-mark">homes.me</div>
            <p className="wc-lede">Let us begin.</p>
            <button type="button" className="wc-skipline" onClick={() => setScene('name')}>
              Skip the intro
            </button>
          </div>
        )}

        {scene === 'name' && (
          <form
            className="wc-card wc-in"
            onSubmit={(event) => { event.preventDefault(); if (name.trim()) setScene('hello'); }}
          >
            <h1 className="wc-h1">First, what should we call you?</h1>
            <p className="wc-lede">The name your team uses, not the one on your passport.</p>
            <input
              ref={inputRef as React.Ref<HTMLInputElement>}
              className="wc-input"
              value={name}
              maxLength={80}
              placeholder="Mahi"
              onChange={(event) => setName(event.target.value)}
              aria-label="What should we call you"
            />
            <Button variant="primary" type="submit" disabled={!name.trim()}>
              That is me
            </Button>
          </form>
        )}

        {scene === 'hello' && (
          <div className="wc-card wc-in">
            <h1 className="wc-h1">
              Hey {firstName}, welcome to the <span>homes.me</span> world.
            </h1>
            <p className="wc-lede">
              We are glad you are here, and we are going to grow together.
            </p>
            <p className="wc-lede">
              One target: <strong>the number one property platform in the UAE.</strong>
            </p>
            <Button variant="primary" onClick={() => setScene('ready')}>Yallah</Button>
          </div>
        )}

        {scene === 'ready' && (
          <div className="wc-card wc-in">
            <div className="wc-kicker">Five questions, two minutes</div>
            <h1 className="wc-h1">Yallah, future multi-millionaire. Ready?</h1>
            <p className="wc-lede">
              Nothing here is a test and nothing is a promise. We just want to know
              where you are headed, so we can help you get there.
            </p>
            <p className="wc-note">
              <Icon name="eye" /> Emir will read your answers.
            </p>
            <div className="wc-actions">
              <Button variant="primary" onClick={() => setScene('question')}>Let us go</Button>
              <button type="button" className="wc-skipline" onClick={() => void finishLater()}>
                Finish later
              </button>
            </div>
          </div>
        )}

        {scene === 'question' && question && (
          <form
            className="wc-card wc-in"
            key={question.id}
            onSubmit={(event) => { event.preventDefault(); void next(); }}
          >
            <div className="wc-dots" aria-label={`Question ${index + 1} of ${questions.length}`}>
              {questions.map((q, i) => (
                <span key={q.id} className={i <= index ? 'on' : undefined} />
              ))}
            </div>
            <div className="wc-emoji" aria-hidden="true">{question.emoji}</div>
            <h1 className="wc-h1">{question.prompt}</h1>
            {question.hint && <p className="wc-lede">{question.hint}</p>}

            {question.kind === 'number' ? (
              <input
                ref={inputRef as React.Ref<HTMLInputElement>}
                className="wc-input wc-input-n"
                type="number"
                inputMode="numeric"
                min={question.min}
                max={question.max}
                value={draft[question.id] ?? ''}
                placeholder="4"
                onChange={(event) => setDraft({ ...draft, [question.id]: event.target.value })}
                aria-label={question.prompt}
              />
            ) : (
              <textarea
                ref={inputRef as React.Ref<HTMLTextAreaElement>}
                className="wc-input wc-area"
                rows={3}
                maxLength={question.maxLength ?? 280}
                value={draft[question.id] ?? ''}
                placeholder={question.placeholder}
                onChange={(event) => setDraft({ ...draft, [question.id]: event.target.value })}
                aria-label={question.prompt}
              />
            )}

            <div className="wc-actions">
              {index > 0 && (
                <button type="button" className="wc-skipline" onClick={() => setIndex(index - 1)}>
                  Back
                </button>
              )}
              <Button
                variant="primary"
                type="submit"
                loading={busy}
                disabled={!(draft[question.id] ?? '').trim()}
              >
                {index + 1 === questions.length ? 'Finish' : 'Next'}
              </Button>
              <button type="button" className="wc-skipline" onClick={() => void finishLater()}>
                Finish later
              </button>
            </div>
            {error && <p className="wc-err">{error}</p>}
          </form>
        )}

        {scene === 'thanks' && (
          <div className="wc-card wc-in">
            <div className="wc-emoji wc-pop" aria-hidden="true">🎉</div>
            <h1 className="wc-h1">Thank you so much, {firstName}.</h1>
            <p className="wc-lede">
              We are really happy to have you with us. Now finish your profile, so
              your clients see a person and not a set of initials.
            </p>
            <Button variant="primary" onClick={() => void leave()}>Go to my profile</Button>
          </div>
        )}
      </div>
    </div>
  );
}
