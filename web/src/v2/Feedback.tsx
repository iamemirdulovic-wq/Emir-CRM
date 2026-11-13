import { useLocation } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon, type IconName } from '../design/index.js';
import { ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';
import { feedbackSub } from './subs.js';

/**
 * Report a bug or an idea.
 *
 * From `design/web/feedback.html`. One box, one tap, and the page the person
 * was on is captured rather than asked for — it is the first question anybody
 * would ask back, and an agent who has to answer it before they can report a
 * bug usually does not report the bug.
 *
 * "It stops me working" is not decoration either: it sorts the owner's inbox.
 * Somebody who cannot do their job today is a different problem from an idea
 * for next month.
 */

interface Ticket {
  id: string;
  kind: string;
  body: string;
  screen: string | null;
  status: 'new' | 'planned' | 'fixed' | 'declined';
  blocking: boolean;
  reply: string | null;
  repliedBy: string | null;
  createdAt: string;
}

const KINDS: Array<{ value: string; title: string; note: string; icon: IconName }> = [
  { value: 'bug', title: 'Something is broken', note: 'It does not work, or it does the wrong thing', icon: 'alert-triangle' },
  { value: 'question', title: 'Hard to use', note: 'It works, but it is awkward or confusing', icon: 'help-circle' },
  { value: 'idea', title: 'An idea', note: 'Something missing, or a thought for later', icon: 'sparkles' },
];

/**
 * The pages a report can be about, as `design/web/feedback.html` lists them.
 *
 * The phone prototype offers six chips; the computer design offers every
 * screen in a dropdown and is the newer of the two, so this is its list. It
 * goes into `feedback_tickets.screen`, which the owner's inbox already shows
 * — so picking one here is a real field, not a label.
 */
const SCREENS = [
  'My Day', 'Dashboard', 'My leads', 'All leads', 'Lead page', 'Add lead', 'Incoming',
  'Pipeline', 'Calling', 'Transfers', 'Calendar', 'Tasks and follow-ups', 'Projects',
  'Team', 'Team wall', 'Best of Homes', 'Attendance', 'Notifications', 'Search',
  'Homes AI', 'Business card', 'Settings', 'Phone app', 'Other',
];

/** What each kind is called on a sent report, as the design writes it. */
const KIND_WORD: Record<string, string> = {
  bug: 'Bug', question: 'Issue', idea: 'Idea',
};

const STATUS: Record<Ticket['status'], { label: string; chip: string }> = {
  new: { label: 'Not looked at yet', chip: 'd-chip' },
  planned: { label: 'On the list', chip: 'd-chip d-blue' },
  fixed: { label: 'Done', chip: 'd-chip d-green d-pip' },
  declined: { label: 'Not doing this', chip: 'd-chip' },
};

export function V2Feedback() {
  const location = useLocation();
  const [kind, setKind] = useState('bug');
  const [body, setBody] = useState('');
  const [where, setWhere] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  const mine = useAsync<{ items: Ticket[] }>(() => api.get('/api/v2/feedback/mine'), []);

  /*
   * `Feedback.dc.html`: "Help us improve" over "Report a bug or suggest a
   * feature". `titleFor()` had no entry for this address, so the phone header
   * read "homes.me" — the screen had no name at all.
   */
  usePhoneHead({
    compact: true,
    title: 'Help us improve',
    sub: 'Report a bug or suggest a feature',
  });

  /* Where they came from. The bell and the sidebar both link here, so the
     referrer is more useful than this page's own address. */
  const from = (location.state as { from?: string } | null)?.from ?? document.referrer ?? null;

  async function send() {
    setTouched(true);
    if (body.trim().length < 10) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/v2/feedback', {
        kind,
        body: body.trim(),
        /* What they chose, or else the page they came from. */
        screen: where || (from ? String(from).slice(0, 160) : null),
        blocking,
      });
      setBody('');
      setWhere('');
      setBlocking(false);
      setTouched(false);
      setSent(true);
      toast('Sent. The owners see it straight away.');
      mine.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="v2-feedback p-feedback">
      {/*
        * The design replaces the form with a thank-you rather than showing a
        * toast over it: a toast is gone in 2.6 seconds and leaves the person
        * wondering whether anything happened.
        *
        * Two things the design puts in it are not here, and both are in
        * `docs/v2/phone-questions-c.md`: the ticket number, because a report's
        * id is not a number anybody could read out, and "+15 points", because
        * nothing awards a point for a report.
        */}
      {sent && (
        <section className="d-card">
          <div className="d-empty">
            <span className="d-ic"><Icon name="check-circle-2" size={28} /></span>
            <b>Thank you.</b>
            <p>
              Your report is with the owners. You get a notification when it is planned and
              when it is fixed, and it is in the list below until then.
            </p>
            <button
              type="button"
              className="d-btn d-sm d-primary"
              onClick={() => setSent(false)}
            >
              <Icon name="plus" />Send another
            </button>
          </div>
        </section>
      )}

      {!sent && (
      <section className="d-card">
        <div className="d-card-head">
          <h2 className="d-grow">Tell us what to fix or build</h2>
        </div>

        <div className="d-col d-gap-16">
          <div className="d-field">
            <span className="d-field-label">What is it?</span>
            <div className="d-fb-types">
              {KINDS.map((one) => (
                <button
                  key={one.value}
                  type="button"
                  className={kind === one.value ? 'd-opt d-on' : 'd-opt'}
                  onClick={() => setKind(one.value)}
                >
                  <span className="d-card-icon"><Icon name={one.icon} /></span>
                  <span className="d-grow">
                    <b className="d-bold">{one.title}</b>
                    <div className="d-small d-muted">{one.note}</div>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* `design/web/feedback.html` asks where, from a list of every
              screen. It fills the same `screen` field the page address fills
              by itself, so a report that happened somewhere else can say so. */}
          <div className="d-field">
            <label htmlFor="fb-where">Where in the CRM?</label>
            <select
              id="fb-where"
              className="d-select"
              value={where}
              onChange={(e) => setWhere(e.target.value)}
            >
              <option value="">The page I came from</option>
              {SCREENS.map((one) => <option key={one} value={one}>{one}</option>)}
            </select>
          </div>

          <div className="d-field">
            <label>
              {kind === 'bug' ? 'What happened?' : kind === 'idea' ? 'What would help?' : 'What is awkward?'}
              {' '}<span className="d-req">*</span>
            </label>
            <textarea
              className="d-textarea v2-fb-text"
              value={body}
              aria-label="What happened?"
              placeholder={kind === 'bug'
                ? 'What did you do, what did you see, and what did you expect instead?'
                : 'Say it however you like. Short is fine.'}
              onChange={(e) => setBody(e.target.value)}
            />
            {touched && body.trim().length < 10 && (
              <span className="v2-field-error">Write a little more — at least a sentence.</span>
            )}
          </div>

          <div className="d-field">
            <span className="d-field-label">How urgent?</span>
            <div className="d-row d-gap-16 d-wrap">
              <div className="d-seg" role="group" aria-label="How urgent">
                <button type="button" className={blocking ? undefined : 'd-on'} onClick={() => setBlocking(false)}>
                  Normal
                </button>
                <button type="button" className={blocking ? 'd-on' : undefined} onClick={() => setBlocking(true)}>
                  It stops me working
                </button>
              </div>
              <span className="d-small d-muted">
                {blocking
                  ? 'This goes to the top of the owners’ list, above everything else.'
                  : 'We read every report within 2 working days.'}
              </span>
            </div>
          </div>

          {problem && <ErrorNote>{problem}</ErrorNote>}

          <div className="d-row v2-fb-foot">
            <span className="d-small d-muted d-grow">
              The page you came from is added by itself, so you do not have to explain where.
            </span>
            <button type="button" className="d-btn d-primary" disabled={busy} onClick={send}>
              <Icon name="send" />{busy ? 'Sending…' : 'Send report'}
            </button>
          </div>
        </div>
      </section>
      )}

      {(mine.data?.items.length ?? 0) > 0 && (
        <section className="d-card">
          <div className="d-card-head"><h3>What you have sent</h3></div>
          <div className="d-divide">
            {mine.data?.items.map((one) => (
              <div className="d-list-row v2-fb-mine" key={one.id}>
                <span className="d-grow">
                  <b className="d-bold">{one.body.slice(0, 90)}{one.body.length > 90 ? '…' : ''}</b>
                  {/* The design's line is kind, then where, then the date —
                      "Bug · Lead page · 4 Nov". The build showed the date
                      alone, so three reports read the same. */}
                  <div className="d-small d-muted">
                    {[KIND_WORD[one.kind] ?? one.kind, screenWord(one.screen), when(one.createdAt)]
                      .filter(Boolean).join(' · ')}
                    {one.blocking ? ' · stopped you working' : ''}
                  </div>
                  {one.reply && (
                    <div className="d-msg-box d-mt-8">
                      <b>{one.repliedBy ?? 'The owner'}:</b> {one.reply}
                    </div>
                  )}
                </span>
                <span className={STATUS[one.status].chip}>{STATUS[one.status].label}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * The "where" of a report, which is either a page the person chose or the
 * address the browser handed over. A URL is not worth a line on a card, so
 * only a chosen page is shown.
 */
function screenWord(screen: string | null): string | null {
  if (!screen) return null;
  return SCREENS.includes(screen) ? screen : null;
}

function when(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
