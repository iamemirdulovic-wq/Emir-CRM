import { useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon, type IconName } from '../design/index.js';
import { ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';
import { feedbackSub } from './subs.js';
import { VoiceRecorder, canRecord, formatDuration } from '../lib/recorder.js';

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
  ref: number | null;
  kind: string;
  kindWord: string;
  title: string;
  body: string;
  screen: string | null;
  status: 'new' | 'planned' | 'fixed' | 'declined';
  urgency: 'low' | 'normal' | 'blocking';
  blocking: boolean;
  reply: string | null;
  repliedBy: string | null;
  createdAt: string;
}

/* The four the design draws, with the design's own wording under each. */
const KINDS: Array<{ value: string; title: string; note: string; icon: IconName }> = [
  { value: 'bug', title: 'Bug', note: 'Something is broken', icon: 'alert-triangle' },
  { value: 'issue', title: 'Issue', note: 'Works, but hard to use', icon: 'help-circle' },
  { value: 'feature', title: 'New feature', note: 'Something is missing', icon: 'plus' },
  { value: 'idea', title: 'Idea', note: 'A thought for later', icon: 'sparkles' },
];

const URGENCIES = [
  { value: 'low' as const, label: 'Low' },
  { value: 'normal' as const, label: 'Normal' },
  { value: 'blocking' as const, label: 'Blocking my work' },
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

const STATUS: Record<Ticket['status'], { label: string; chip: string }> = {
  new: { label: 'Not looked at yet', chip: 'd-chip' },
  planned: { label: 'On the list', chip: 'd-chip d-blue' },
  fixed: { label: 'Done', chip: 'd-chip d-green d-pip' },
  declined: { label: 'Not doing this', chip: 'd-chip' },
};

export function V2Feedback() {
  const location = useLocation();
  const [kind, setKind] = useState('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [where, setWhere] = useState('');
  const [urgency, setUrgency] = useState<'low' | 'normal' | 'blocking'>('normal');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  /** The ticket the design's thank-you quotes: "Thank you · ticket #1042". */
  const [sent, setSent] = useState<Ticket | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /* A screenshot and a voice note, held until the report exists to attach
     them to — a file cannot be attached to a report that has no id yet. */
  const [shot, setShot] = useState<File | null>(null);
  const [voice, setVoice] = useState<{ blob: Blob; seconds: number; mimeType: string } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recorder = useRef<VoiceRecorder | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const mine = useAsync<{ items: Ticket[] }>(() => api.get('/api/v2/feedback/mine'), []);

  /*
   * `Feedback.dc.html`: "Help us improve" over "Report a bug or suggest a
   * feature". `titleFor()` had no entry for this address, so the phone header
   * read "homes.me" — the screen had no name at all.
   *
   * `design/web/feedback.html` writes "Bugs, problems and ideas go straight
   * to the owners", which says where it lands rather than what to type, and
   * the computer design wins where the two differ.
   */
  usePhoneHead({
    compact: true,
    title: 'Help us improve',
    sub: feedbackSub(),
  });

  /* Where they came from. The bell and the sidebar both link here, so the
     referrer is more useful than this page's own address. */
  const from = (location.state as { from?: string } | null)?.from ?? document.referrer ?? null;

  /* The microphone is released when the page goes away, whatever state it is
     in — otherwise the recording dot stays lit in the tab all afternoon. */
  useEffect(() => () => recorder.current?.release(), []);

  /* The timer while recording, which is the only way to know it is running. */
  useEffect(() => {
    if (!recording) return undefined;
    const timer = window.setInterval(() => setRecordSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  async function toggleRecording() {
    setProblem(null);
    if (recording) {
      setRecording(false);
      try {
        const got = await recorder.current?.stop();
        if (got && got.seconds >= 1) setVoice(got);
        else toast('Too short. Hold the recording for at least 1 second.');
      } catch (err) {
        setProblem(err instanceof Error ? err.message : 'The recording did not save.');
      }
      return;
    }
    recorder.current = new VoiceRecorder();
    try {
      await recorder.current.start();
      setRecordSeconds(0);
      setRecording(true);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not start recording.');
    }
  }

  async function send() {
    setTouched(true);
    /* A voice note stands in for the text, as the design's own validator
       does: somebody who cannot work has most to say out loud. */
    const needsText = !voice;
    if (title.trim().length < 4) return;
    if (needsText && body.trim().length < 10) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await api.post<Ticket>('/api/v2/feedback', {
        kind,
        title: title.trim(),
        body: body.trim() || 'Sent as a voice note.',
        /* What they chose, or else the page they came from. */
        screen: where || (from ? String(from).slice(0, 160) : null),
        urgency,
      });
      /* The attachments go up second, against the report that now exists.
         A failure here does not lose the report — it says so and keeps it. */
      try {
        if (shot) await api.upload(`/api/v2/feedback/${made.id}/screenshot`, shot);
        if (voice) {
          await api.upload(
            `/api/v2/feedback/${made.id}/voice`,
            new File([voice.blob], 'voice-note', { type: voice.mimeType }),
            { 'X-Duration-Seconds': String(voice.seconds) },
          );
        }
      } catch (err) {
        toast(err instanceof Error
          ? `Report sent, but the attachment did not: ${err.message}`
          : 'Report sent, but the attachment did not.');
      }
      setTitle('');
      setBody('');
      setWhere('');
      setUrgency('normal');
      setShot(null);
      setVoice(null);
      setTouched(false);
      setSent(made);
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
            <b>Thank you · ticket #{sent.ref ?? '—'}</b>
            <p>
              We got your report. You will see the status in the list below and get an alert
              when it changes.
            </p>
            <span className="d-chip d-green d-lg">+15 points</span>
            <button
              type="button"
              className="d-btn d-sm d-primary d-mt-8"
              onClick={() => setSent(null)}
            >
              <Icon name="plus" />Write another
            </button>
          </div>
        </section>
      )}

      {!sent && (
      <section className="d-card">
        <div className="d-card-head">
          <h2 className="d-grow">Tell us what to fix or build</h2>
          <span className="d-chip d-green">+15 points for each report</span>
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

          {/* A short title and where, side by side, then what happened —
              the design's own 1.6fr / 1fr grid. The title is what the owner's
              inbox scans by: without one, the body became the heading and a
              long report filled the row. */}
          <div className="d-form-grid v2-fb-grid">
            <div className={touched && title.trim().length < 4 ? 'd-field d-invalid' : 'd-field'}>
              <label htmlFor="fb-title">Short title <span className="d-req">*</span></label>
              <input
                id="fb-title"
                className="d-input"
                value={title}
                aria-label="Short title"
                placeholder="Call button does nothing on the lead page"
                onChange={(e) => setTitle(e.target.value)}
              />
              <span className="d-error">Write a short title.</span>
            </div>

            <div className="d-field">
              <label htmlFor="fb-where">Where</label>
              <select
                id="fb-where"
                className="d-select"
                value={where}
                onChange={(e) => setWhere(e.target.value)}
              >
                <option value="">Choose a page…</option>
                {SCREENS.map((one) => <option key={one} value={one}>{one}</option>)}
              </select>
            </div>

            <div className={touched && !voice && body.trim().length < 10
              ? 'd-field d-full d-invalid' : 'd-field d-full'}
            >
              <label>
                {kind === 'bug' ? 'What happened?' : kind === 'idea' ? 'What would help?' : 'What is awkward?'}
                {' '}{!voice && <span className="d-req">*</span>}
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
              <span className="d-error">Write what happened, at least 10 letters.</span>
            </div>
          </div>

          {/* A screenshot and a voice note. Both end up on the report the
              owner opens, and the voice note can stand in for the text. */}
          <div className="d-row d-gap-8 d-wrap">
            <button
              type="button"
              className="d-btn d-sm"
              disabled={recording}
              onClick={() => picker.current?.click()}
            >
              <Icon name="image-up" />Add a screenshot
            </button>
            {canRecord() && (
              <button
                type="button"
                className={recording ? 'd-btn d-sm d-danger d-solid' : 'd-btn d-sm'}
                onClick={() => void toggleRecording()}
              >
                <Icon name="mic" />
                {recording
                  ? `Stop · ${formatDuration(recordSeconds)}`
                  : voice ? 'Record again' : 'Record a voice note'}
              </button>
            )}
            <span className="d-small d-muted">
              Or press Print Screen and paste here with Ctrl V.
            </span>
          </div>

          {(shot || voice) && (
            <div className="d-row d-gap-8 d-wrap">
              {shot && (
                <span className="d-chip">
                  <Icon name="image-up" />
                  {shot.name} · {Math.round(shot.size / 1024)} KB
                  <button
                    type="button" className="v2-fb-x" aria-label="Remove the screenshot"
                    onClick={() => setShot(null)}
                  >
                    <Icon name="x" />
                  </button>
                </span>
              )}
              {voice && (
                <span className="d-chip">
                  <Icon name="mic" />
                  Voice note · {formatDuration(voice.seconds)}
                  <button
                    type="button" className="v2-fb-x" aria-label="Remove the voice note"
                    onClick={() => setVoice(null)}
                  >
                    <Icon name="x" />
                  </button>
                </span>
              )}
            </div>
          )}

          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            aria-label="Choose a screenshot"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) setShot(chosen);
              if (picker.current) picker.current.value = '';
            }}
          />

          <div className="d-field">
            <span className="d-field-label">How urgent?</span>
            <div className="d-row d-gap-16 d-wrap">
              <div className="d-seg" role="group" aria-label="How urgent">
                {URGENCIES.map((one) => (
                  <button
                    key={one.value}
                    type="button"
                    className={urgency === one.value ? 'd-on' : undefined}
                    onClick={() => setUrgency(one.value)}
                  >
                    {one.label}
                  </button>
                ))}
              </div>
              <span className={urgency === 'blocking' ? 'd-small d-t-red' : 'd-small d-muted'}>
                {urgency === 'blocking'
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
                  <b className="d-bold">{one.title}</b>
                  {/* The design's line is kind, then where, then the date —
                      "Bug · Lead page · 4 Nov". The build showed the date
                      alone, so three reports read the same. */}
                  <div className="d-small d-muted">
                    {[
                      one.ref ? `#${one.ref}` : null,
                      one.kindWord,
                      screenWord(one.screen),
                      when(one.createdAt),
                    ].filter(Boolean).join(' · ')}
                    {one.urgency === 'blocking' ? ' · stopped you working' : ''}
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
