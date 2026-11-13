import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { Icon } from '../../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { usePhoneHead } from '../phone.js';

/**
 * Settings → Feedback inbox.
 *
 * Built from `design/web/feedback-inbox.html`: a table, one row per report,
 * and a side panel with the whole thing in it.
 *
 * It was a list of cards, and `sage.md` §1 is explicit about tables rather
 * than cards for a list an owner scans. The card list had a second fault that
 * only shows with real data: with no title field, the body was the heading,
 * so a three-sentence report became a paragraph-tall row and the row below it
 * was off the bottom of the screen.
 *
 * Two orderings matter and both are the server's: **anything marked "it stops
 * me working" comes first whatever its date** — an agent who cannot do their
 * job today buried under last week's ideas is the failure this exists to
 * prevent — and within that, newest first.
 *
 * Every status change offers Undo rather than asking first. A dialog in front
 * of a harmless change trains people to click through dialogs, which is how
 * the one that mattered gets clicked through too.
 *
 * This page is **not** inside the settings shell, and the design is why:
 * `design/web/feedback-inbox.html` is a standalone page with
 * `data-back="settings.html|Settings"`, not one of the `.set` panels. The
 * table needs the width — seven columns inside the shell's remaining 900px
 * ran off the right-hand edge — and the header carries the title, so the page
 * does not draw a second one under it.
 */

interface Reply {
  id: string;
  body: string;
  author: string | null;
  createdAt: string;
}

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
  urgencyWord: string;
  blocking: boolean;
  hasScreenshot: boolean;
  hasVoice: boolean;
  voiceSeconds: number | null;
  reply: string | null;
  repliedBy: string | null;
  replies: Reply[];
  fromName: string | null;
  createdAt: string;
}

interface Inbox {
  items: Ticket[];
  counts: Record<string, number>;
  points: number;
}

/* The four the design draws, in the design's order, and "New" is the one that
   opens — an inbox that opens on "All" shows a fortnight of fixed reports
   above the one that came in this morning. */
const TABS = [
  { key: 'new', label: 'New' },
  { key: 'planned', label: 'Planned' },
  { key: 'fixed', label: 'Fixed' },
  { key: 'all', label: 'All' },
] as const;

/** The design's own chip colour per type. */
const KIND_COLOUR: Record<string, string> = {
  bug: 'd-red',
  issue: 'd-amber',
  feature: 'd-blue',
  idea: 'd-violet',
  question: 'd-blue',
};

const STATUS_CHIP: Record<Ticket['status'], string> = {
  new: 'd-amber d-pip',
  planned: 'd-blue',
  fixed: 'd-green',
  declined: '',
};

const STATUS_WORD: Record<Ticket['status'], string> = {
  new: 'New',
  planned: 'Planned',
  fixed: 'Fixed',
  declined: 'Not doing this',
};

/** What each status change is called, for the toast. */
const SAID: Record<Ticket['status'], string> = {
  new: 'open again',
  planned: 'planned',
  fixed: 'marked as fixed',
  declined: 'not being done',
};

export function V2FeedbackInbox() {
  const [tab, setTab] = useState<string>('new');
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [replyTried, setReplyTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const got = useAsync<Inbox>(() => api.get(`/api/v2/feedback?filter=${tab}`), [tab]);

  usePhoneHead({ title: 'Feedback inbox', sub: 'Bugs, problems and ideas from the team.' });

  /* Escape closes the panel, as it does everywhere else in the design. */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function setStatus(ticket: Ticket, status: Ticket['status']) {
    const was = ticket.status;
    setBusy(true);
    try {
      await api.patch(`/api/v2/feedback/${ticket.id}`, { status });
      toast(
        `#${ticket.ref ?? '—'} is ${SAID[status]} · ${ticket.fromName ?? 'the sender'} is told`,
        {
          action: {
            label: 'Undo',
            onClick: () => {
              void api.patch(`/api/v2/feedback/${ticket.id}`, { status: was })
                .then(() => got.reload());
            },
          },
        },
      );
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(ticket: Ticket) {
    setReplyTried(true);
    if (reply.trim().length < 3) return;
    setBusy(true);
    try {
      await api.patch(`/api/v2/feedback/${ticket.id}`, { reply: reply.trim() });
      toast(`Reply saved · ${ticket.fromName ?? 'the sender'} gets a notification`);
      setReply('');
      setReplyTried(false);
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (got.error) {
    return <div className="p-feedback-inbox"><ErrorNote>{got.error}</ErrorNote></div>;
  }
  if (!got.data) {
    return <div className="p-feedback-inbox"><Spinner /></div>;
  }

  const inbox = got.data;
  const blocking = inbox.counts.blocking ?? 0;
  const chosen = inbox.items.find((one) => one.id === open) ?? null;

  return (
    <div className="p-feedback-inbox">
      <div className="v2-page-head">
          <div className="d-tabs d-pills v2-fb-tabs" role="tablist">
            {TABS.map((one) => (
              <button
                key={one.key}
                type="button"
                role="tab"
                aria-selected={tab === one.key}
                className={tab === one.key ? 'd-tab d-on' : 'd-tab'}
                onClick={() => { setTab(one.key); setOpen(null); }}
              >
                {one.label}
                <span className={one.key === 'new' && (inbox.counts.new ?? 0) > 0 ? 'd-count d-red' : 'd-count'}>
                  {inbox.counts[one.key] ?? 0}
                </span>
              </button>
            ))}
          </div>
          <span className="d-grow" />
          {/* §4.10: a report is worth fifteen points to whoever sent it, and
              nothing anywhere else on the page said so. */}
          <span className="v2-page-sub">
            Every report gives the sender +{inbox.points} points
          </span>
          <a
            className="d-btn d-sm"
            href="/api/v2/feedback/export.csv"
            onClick={() => toast(`File saved · feedback-${stampName()}.csv`)}
          >
            <Icon name="download" />Export file
          </a>
        </div>

        {blocking > 0 && (
          <div className="d-banner d-amber d-mb-16">
            <Icon name="alert-triangle" />
            <span className="d-grow">
              <b>{blocking} {blocking === 1 ? 'person' : 'people'} cannot work
              properly right now.</b> Those are at the top of the list.
            </span>
          </div>
        )}

        {/*
          * `v2-d-cards` is the phone half: under 768px each row becomes a
          * card, with the heading of every cell read off its `data-label`.
          * Seven columns is 1,050px, which a 390px screen can only
          * side-scroll or crush — and `OwnerFeedback.dc.html` draws this
          * list as cards for exactly that reason. The computer keeps the
          * design's table.
          */}
        <div className="d-table-wrap">
          {inbox.items.length === 0 ? (
            <div className="d-empty">
              <span className="d-ic"><Icon name="check" /></span>
              <b>Nothing here</b>
              <p>No report has this status now.</p>
            </div>
          ) : (
            <table className="d-table d-id-fb v2-fb-table v2-d-cards">
              <thead>
                <tr>
                  <th>#</th><th>Report</th><th>Type</th><th>From</th>
                  <th>Urgency</th><th>Status</th><th />
                </tr>
              </thead>
              <tbody>
                {inbox.items.map((one) => (
                  <tr
                    key={one.id}
                    className={open === one.id ? 'v2-fb-open' : undefined}
                    onClick={() => { setOpen(one.id); setReply(''); setReplyTried(false); }}
                  >
                    <td className="d-t-mono">#{one.ref ?? '—'}</td>
                    <td className="d-tt">
                      <span className="d-t-main">{one.title}</span>
                      <span className="d-t-sub">
                        {[one.screen, when(one.createdAt)].filter(Boolean).join(' · ')}
                      </span>
                    </td>
                    <td data-label="Type">
                      <span className={`d-chip ${KIND_COLOUR[one.kind] ?? ''}`}>{one.kindWord}</span>
                    </td>
                    <td data-label="From">
                      <span className="d-person">
                        <Avatar name={one.fromName ?? 'Somebody'} size={26} />
                        {one.fromName ?? 'Somebody'}
                      </span>
                    </td>
                    <td
                      data-label="Urgency"
                      className={one.urgency === 'blocking' ? 'd-overdue' : undefined}
                    >
                      {one.urgencyWord}
                    </td>
                    <td data-label="Status">
                      <span className={`d-chip ${STATUS_CHIP[one.status]}`}>{STATUS_WORD[one.status]}</span>
                    </td>
                    <td className="d-act">
                      <div className="d-row-actions">
                        {actions(one).map((next) => (
                          <button
                            key={next.status}
                            type="button"
                            className="d-btn d-xs"
                            disabled={busy}
                            onClick={(e) => { e.stopPropagation(); void setStatus(one, next.status); }}
                          >
                            {next.icon && <Icon name="check" />}
                            {next.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      {/* ── the panel ──────────────────────────────────────────────────── */}
      {chosen && (
        <>
          <div className="d-scrim d-show" onClick={() => setOpen(null)} aria-hidden />
          <aside className="d-panel d-open" aria-label="Report">
            <div className="d-panel-head">
              <h2>#{chosen.ref ?? '—'} · {chosen.title}</h2>
              <button
                type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close"
                onClick={() => setOpen(null)}
              >
                <Icon name="x" />
              </button>
            </div>

            <div className="d-panel-body d-col d-gap-16">
              <div className="d-row d-gap-8 d-wrap">
                <span className={`d-chip ${KIND_COLOUR[chosen.kind] ?? ''}`}>{chosen.kindWord}</span>
                <span className={`d-chip ${STATUS_CHIP[chosen.status]}`}>{STATUS_WORD[chosen.status]}</span>
                <span className={chosen.urgency === 'blocking' ? 'd-chip d-red' : 'd-chip'}>
                  {chosen.urgencyWord}
                </span>
              </div>

              <p className="v2-fb-text">{chosen.body}</p>

              <dl className="d-kv">
                <div className="d-kv-row">
                  <dt>From</dt>
                  <dd>
                    <span className="d-person">
                      <Avatar name={chosen.fromName ?? 'Somebody'} size={26} />
                      {chosen.fromName ?? 'Somebody'}
                    </span>
                  </dd>
                </div>
                <div className="d-kv-row">
                  <dt>Where</dt>
                  <dd>{chosen.screen ?? 'Not recorded'}</dd>
                </div>
                <div className="d-kv-row">
                  <dt>Sent</dt>
                  <dd>{full(chosen.createdAt)}</dd>
                </div>
              </dl>

              {/* Both blocks only when there is something behind them, which
                  is what the design's own `hidden` does. */}
              {chosen.hasScreenshot && (
                <a
                  className="d-shot"
                  href={`/api/v2/feedback/${chosen.id}/screenshot`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span><Icon name="image-up" /> Screenshot from the sender · click to open</span>
                </a>
              )}

              {chosen.hasVoice && (
                <div className="d-voice">
                  {/* A real player, not a button that toasts: the recording
                      exists, so it can be played. */}
                  <audio
                    className="v2-fb-audio"
                    controls
                    preload="none"
                    src={`/api/v2/feedback/${chosen.id}/voice`}
                  />
                  <span className="d-small d-muted">{length(chosen.voiceSeconds)}</span>
                </div>
              )}

              <div>
                <h4 className="d-mb-8">Replies</h4>
                <div className="d-thread">
                  {chosen.replies.length === 0 ? (
                    <span className="d-small d-muted">No reply yet.</span>
                  ) : chosen.replies.map((one) => (
                    <div className="d-msg d-me" key={one.id}>
                      <b>{one.author ?? 'Owner'}</b> · {one.body}
                      <span>{full(one.createdAt)}</span>
                    </div>
                  ))}
                </div>

                <div className={replyTried && reply.trim().length < 3
                  ? 'd-field d-invalid d-mt-12' : 'd-field d-mt-12'}
                >
                  <textarea
                    className="d-textarea v2-fb-reply"
                    value={reply}
                    aria-label="Write a reply"
                    placeholder="Write a reply. The sender gets a notification."
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <span className="d-error">Write your reply first.</span>
                </div>
                <div className="d-row d-mt-8">
                  <span className="d-grow" />
                  <button
                    type="button"
                    className="d-btn d-sm"
                    disabled={busy}
                    onClick={() => void sendReply(chosen)}
                  >
                    <Icon name="message-square" />Reply
                  </button>
                </div>
              </div>
            </div>

            <div className="d-panel-foot">
              {actions(chosen).map((next) => (
                <button
                  key={next.status}
                  type="button"
                  className={next.primary ? 'd-btn d-primary' : 'd-btn'}
                  disabled={busy}
                  onClick={() => void setStatus(chosen, next.status)}
                >
                  {next.icon && <Icon name="check" />}
                  {next.label}
                </button>
              ))}
              <span className="d-grow" />
              <button type="button" className="d-btn d-ghost" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

/**
 * Which buttons a report shows, exactly as the design's `btns()` decides.
 *
 * Plan it on a new one, Mark fixed on anything not already fixed, Open again
 * on anything that is not new. "Not doing this" is the fourth status the CRM
 * stores and the design has no button for it, so it is offered only from the
 * panel, where there is room to mean it.
 */
function actions(ticket: Ticket): Array<{
  status: Ticket['status']; label: string; primary?: boolean; icon?: boolean;
}> {
  const out: Array<{ status: Ticket['status']; label: string; primary?: boolean; icon?: boolean }> = [];
  if (ticket.status === 'new') out.push({ status: 'planned', label: 'Plan it', primary: true });
  if (ticket.status !== 'fixed') out.push({ status: 'fixed', label: 'Mark fixed', icon: true });
  if (ticket.status !== 'new') out.push({ status: 'new', label: 'Open again' });
  return out;
}

/** "0:18", as the design writes a recording's length. */
function length(seconds: number | null): string {
  if (!seconds) return '—';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The file name the export toast names. */
function stampName(): string {
  return new Date(Date.now() + 4 * 3600_000)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(' ', '-');
}

/** 24-hour, Dubai. */
function clock(at: string): string {
  const dubai = new Date(new Date(at).getTime() + 4 * 3600_000);
  return `${String(dubai.getUTCHours()).padStart(2, '0')}:${String(dubai.getUTCMinutes()).padStart(2, '0')}`;
}

/** "Today 13:40", "Yesterday 17:25", "Mon 9 Nov". */
function when(at: string): string {
  const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  const then = new Date(new Date(at).getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  if (then === today) return `Today ${clock(at)}`;
  const yesterday = new Date(Date.now() + 4 * 3600_000 - 86_400_000).toISOString().slice(0, 10);
  if (then === yesterday) return `Yesterday ${clock(at)}`;
  return new Date(at).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Dubai',
  });
}

function full(at: string): string {
  return `${when(at)}${when(at).includes(':') ? '' : ` ${clock(at)}`}`;
}
