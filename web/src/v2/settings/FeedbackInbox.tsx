import { useState } from 'react';
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

const TABS = [
  { key: 'all', label: 'Everything' },
  { key: 'blocking', label: 'Stopping somebody' },
  { key: 'new', label: 'Not looked at' },
  { key: 'planned', label: 'On the list' },
  { key: 'fixed', label: 'Done' },
] as const;

const NEXT: Array<{ value: Ticket['status']; label: string }> = [
  { value: 'planned', label: 'Put it on the list' },
  { value: 'fixed', label: 'Done' },
  { value: 'declined', label: 'Not doing this' },
];

export function V2FeedbackInbox() {
  const [tab, setTab] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const got = useAsync<Inbox>(() => api.get(`/api/v2/feedback?filter=${tab}`), [tab]);

  async function answer(ticket: Ticket, status: Ticket['status']) {
    setBusy(true);
    try {
      await api.patch(`/api/v2/feedback/${ticket.id}`, {
        status,
        ...(reply.trim() ? { reply: reply.trim() } : {}),
      });
      toast('Answered. They can see it on their own page.');
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
              {one.key !== 'all' && (
                <span className={one.key === 'blocking' && blocking > 0 ? 'd-count d-red' : 'd-count'}>
                  {inbox.counts[one.key] ?? 0}
                </span>
              )}
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
                  <div className="d-row d-gap-12 d-top">
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
                    <span className="d-chip">{label(one.status)}</span>
                  </div>

                  {open === one.id ? (
                    <div className="d-col d-gap-8 d-mt-12">
                      <textarea
                        className="d-textarea v2-fb-reply"
                        value={reply}
                        aria-label="Answer"
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
                    <div className="d-row d-mt-8">
                      <span className="d-grow" />
                      <button
                        type="button"
                        className="d-btn d-xs"
                        onClick={() => { setOpen(one.id); setReply(one.reply ?? ''); }}
                      >
                        Answer
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

function label(status: Ticket['status']): string {
  if (status === 'new') return 'Not looked at';
  if (status === 'planned') return 'On the list';
  if (status === 'fixed') return 'Done';
  return 'Not doing this';
}

function when(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
