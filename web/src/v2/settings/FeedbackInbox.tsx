import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { Icon } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SettingsShell, SettingsTitle } from './Shell.js';

/**
 * Settings → Feedback inbox.
 *
 * From `design/web/feedback-inbox.html`. What the team sent, newest first,
 * except that **anything marked "it stops me working" comes first whatever
 * its date** — an agent who cannot do their job today buried under last
 * week's ideas is the failure this ordering exists to prevent.
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
  fromName: string | null;
  createdAt: string;
}

interface Inbox {
  items: Ticket[];
  counts: Record<string, number>;
}

/*
 * `OwnerFeedback.dc.html` draws four: New · Planned · Fixed · All, and
 * `design/web/feedback-inbox.html` names the same four in the same order.
 * The build had five of its own words for them. "Stopping somebody" is not
 * in either design but it is a filter that exists, so it keeps its place at
 * the end rather than being taken away.
 */
const TABS = [
  { key: 'new', label: 'New' },
  { key: 'planned', label: 'Planned' },
  { key: 'fixed', label: 'Fixed' },
  { key: 'all', label: 'All' },
  { key: 'blocking', label: 'Stopping somebody' },
] as const;

const NEXT: Array<{ value: Ticket['status']; label: string }> = [
  { value: 'planned', label: 'Plan it' },
  { value: 'fixed', label: 'Mark fixed' },
  { value: 'declined', label: 'Not doing this' },
];

/** What kind of report it is, as the design's chip says it. */
function kindWord(kind: string): string {
  if (kind === 'idea') return 'Idea';
  if (kind === 'question') return 'Question';
  return 'Bug';
}

/**
 * Whether this is a phone, in markup rather than in a stylesheet.
 *
 * Every rule in `v2-phone-d.css` lives inside `@media (max-width: 767px)` by
 * rule, so there is no way from there to hide something on a computer. The
 * two quick buttons below exist on a phone and not on a computer, which is a
 * difference of markup, not of width.
 */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width:767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width:767px)');
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

export function V2FeedbackInbox() {
  const isPhone = useIsPhone();
  const [tab, setTab] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const got = useAsync<Inbox>(() => api.get(`/api/v2/feedback?filter=${tab}`), [tab]);

  /**
   * @param withReply whether whatever is in the reply box goes with it. The
   *   quick buttons on a card must not: the box belongs to whichever card is
   *   open, and sending its half-written text under somebody else's report is
   *   the kind of thing nobody notices until the sender reads it.
   */
  async function answer(ticket: Ticket, status: Ticket['status'], withReply = true) {
    setBusy(true);
    try {
      const note = withReply ? reply.trim() : '';
      await api.patch(`/api/v2/feedback/${ticket.id}`, {
        status,
        ...(note ? { reply: note } : {}),
      });
      toast(note
        ? 'Answered. They can see it on their own page.'
        : status === 'planned' ? 'On the list. They can see it on their own page.'
          : status === 'fixed' ? 'Marked fixed. They can see it on their own page.'
            : 'Saved. They can see it on their own page.');
      setOpen(null);
      setReply('');
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (got.error) {
    return <SettingsShell page="p-feedback-inbox"><div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div></SettingsShell>;
  }
  if (!got.data) {
    return <SettingsShell page="p-feedback-inbox"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  const inbox = got.data;
  const blocking = inbox.counts.blocking ?? 0;
  /* The server counts one row per state; "All" is the four added up, and
     `blocking` is not one of them — it is a flag on a new report, so adding
     it would count those twice. */
  const everything = (['new', 'planned', 'fixed', 'declined'] as const)
    .reduce((sum, key) => sum + (inbox.counts[key] ?? 0), 0);

  return (
    <SettingsShell page="p-feedback-inbox">
      <div className="d-set-body">
        <SettingsTitle
          title="Feedback inbox"
          note="Bugs, problems and ideas from the team."
        />

        {blocking > 0 && (
          <div className="d-banner d-amber">
            <Icon name="alert-triangle" />
            <span className="d-grow">
              <b>{blocking} {blocking === 1 ? 'person' : 'people'} cannot work
              properly right now.</b> Those are at the top of the list.
            </span>
          </div>
        )}

        <div className="d-tabs d-pills" role="tablist">
          {TABS.map((one) => (
            <button
              key={one.key}
              type="button"
              role="tab"
              aria-selected={tab === one.key}
              className={tab === one.key ? 'd-tab d-on' : 'd-tab'}
              onClick={() => setTab(one.key)}
            >
              {one.label}
              {/* Every chip carries its count, "All · 6" included: both
                  designs draw it and it is how you see there is nothing
                  waiting without pressing anything. */}
              <span className={one.key === 'blocking' && blocking > 0 ? 'd-count d-red' : 'd-count'}>
                {one.key === 'all' ? everything : inbox.counts[one.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        {inbox.items.length === 0 ? (
          <div className="d-empty">
            <span className="d-ic"><Icon name="inbox" /></span>
            <b>Nothing here</b>
            <p>When somebody reports a bug or sends an idea it appears here.</p>
          </div>
        ) : (
          <section className="d-card">
            <div className="d-divide">
              {inbox.items.map((one) => (
                <div className="v2-fb-row" key={one.id}>
                  <div className="d-row d-gap-16 d-top">
                    <span className={one.blocking ? 'd-card-icon d-accent' : 'd-card-icon'}>
                      <Icon name={one.kind === 'idea' ? 'sparkles' : one.kind === 'question' ? 'help-circle' : 'alert-triangle'} />
                    </span>
                    <span className="d-grow">
                      <b className="d-bold">{one.body}</b>
                      <div className="d-small d-muted d-mt-4">
                        {one.fromName ?? 'Somebody'} · {when(one.createdAt)}
                        {one.screen ? ` · on ${one.screen}` : ''}
                      </div>
                      {one.reply && (
                        <div className="d-msg-box d-mt-8">
                          <b>{one.repliedBy ?? 'Answered'}:</b> {one.reply}
                        </div>
                      )}
                    </span>
                    {one.blocking && <span className="d-chip d-red d-pip">Stops them working</span>}
                    {/* Bug · Idea · Question. The design puts the word
                        beside the status; the build had only the icon, and
                        an icon does not say "Idea". */}
                    <span className="d-chip">{kindWord(one.kind)}</span>
                    <span className="d-chip">{label(one.status)}</span>
                  </div>

                  {open === one.id ? (
                    <div className="d-col d-gap-8 d-mt-12">
                      <textarea
                        className="d-textarea v2-fb-reply"
                        value={reply}
                        aria-label="Reply"
                        placeholder="What are you doing about it? They will see this."
                        onChange={(e) => setReply(e.target.value)}
                      />
                      <div className="d-row d-gap-8 d-wrap">
                        {NEXT.map((next) => (
                          <button
                            key={next.value}
                            type="button"
                            className="d-btn d-sm"
                            disabled={busy}
                            onClick={() => void answer(one, next.value)}
                          >
                            {next.label}
                          </button>
                        ))}
                        <span className="d-grow" />
                        <button type="button" className="d-btn d-sm d-ghost" onClick={() => setOpen(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* `OwnerFeedback.dc.html` puts Plan it · Mark fixed ·
                       Reply on the card itself, so the two things an owner
                       does ninety times out of a hundred are one tap, not
                       two. The computer keeps its single button and its
                       panel, which is what `design/web` draws. */
                    <div className="d-row d-mt-8 d-gap-8">
                      <span className="d-grow" />
                      {isPhone && one.status === 'new' && (
                        <button
                          type="button"
                          className="d-btn d-xs"
                          disabled={busy}
                          onClick={() => void answer(one, 'planned', false)}
                        >
                          Plan it
                        </button>
                      )}
                      {isPhone && one.status !== 'fixed' && (
                        <button
                          type="button"
                          className="d-btn d-xs"
                          disabled={busy}
                          onClick={() => void answer(one, 'fixed', false)}
                        >
                          Mark fixed
                        </button>
                      )}
                      <button
                        type="button"
                        className="d-btn d-xs"
                        onClick={() => { setOpen(one.id); setReply(one.reply ?? ''); }}
                      >
                        Reply
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </SettingsShell>
  );
}

/* The words the designs use on the chip: New · Planned · Fixed. */
function label(status: Ticket['status']): string {
  if (status === 'new') return 'New';
  if (status === 'planned') return 'Planned';
  if (status === 'fixed') return 'Fixed';
  return 'Not doing this';
}

function when(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
