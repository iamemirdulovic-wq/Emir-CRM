import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';

/**
 * The team wall.
 *
 * `docs/v2/pages.md` §23, reading the wall the live CRM already keeps — one
 * wall, two front ends, so a post written on either is seen on both. Posts the
 * CRM writes itself (a Won deal, a badge) have no author and draw their own
 * mark; the rest are people talking to each other.
 */

interface Post {
  id: string;
  author_id: string | null;
  author_name: string | null;
  author_photo_url: string | null;
  kind: string;
  body: string | null;
  media: unknown;
  poll: unknown;
  show_value: number;
  pinned_at: string | null;
  created_at: string;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  comments: Array<{ id: string; author_name: string | null; body: string; created_at: string }>;
  commentCount: number;
}

const QUICK = ['👏', '🔥', '🎉', '💪', '❤️'];

export function V2Wall() {
  const { user } = useAuth();
  const feed = useAsync<{ items: Post[] }>(() => api.get('/api/wall'), []);
  const [writing, setWriting] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function post() {
    if (!writing.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/wall', { body: writing.trim() });
      setWriting('');
      feed.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not post.');
    } finally {
      setBusy(false);
    }
  }

  async function react(id: string, emoji: string) {
    try {
      await api.post(`/api/wall/${id}/react`, { emoji });
      feed.reload();
    } catch {
      /* The post is still there; pressing again retries. */
    }
  }

  if (feed.error) return <ErrorNote>{feed.error}</ErrorNote>;
  if (!feed.data) return <Spinner />;

  return (
    <div className="v2-wall">
      <header className="v2-inc-head">
        <h1 className="v2-hi">Team wall</h1>
        <p className="d-muted">What everybody is up to.</p>
      </header>

      <section className="d-card v2-write">
        <Avatar name={user?.name ?? '?'} src={user?.photoUrl ?? undefined} />
        <div className="v2-write-box">
          <textarea
            className="d-input v2-write-area"
            value={writing}
            rows={writing ? 3 : 1}
            placeholder="Say something to the team"
            onChange={(e) => setWriting(e.target.value)}
          />
          {writing.trim() && (
            <div className="v2-write-acts">
              <button type="button" className="d-btn d-sm d-ghost" onClick={() => setWriting('')}>
                Not now
              </button>
              <button type="button" className="d-btn d-sm d-primary" disabled={busy} onClick={post}>
                {busy ? 'Posting…' : 'Post it'}
              </button>
            </div>
          )}
        </div>
      </section>

      {problem && <p className="v2-problem">{problem}</p>}

      {feed.data.items.length === 0 && (
        <div className="v2-empty">
          <span className="v2-empty-mark"><Icon name="message-square" /></span>
          <h2>Nothing on the wall yet</h2>
          <p>Be the first. A Won deal lands here on its own.</p>
        </div>
      )}

      <ul className="v2-posts">
        {feed.data.items.map((one) => (
          <li key={one.id} className="d-card v2-post">
            <div className="v2-post-top">
              {one.author_id
                ? <Avatar name={one.author_name ?? '?'} src={one.author_photo_url ?? undefined} />
                : <span className="v2-post-mark"><Icon name="trophy" /></span>}
              <span className="v2-post-who">
                <b>
                  {one.author_name ?? 'homes.me'}
                  {one.pinned_at && <span className="d-chip d-accent">Pinned</span>}
                </b>
                <span>{ago(one.created_at)}</span>
              </span>
            </div>

            {one.body && <p className="v2-post-body">{one.body}</p>}

            <div className="v2-post-foot">
              {one.reactions.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  className={r.mine ? 'v2-react v2-react-mine' : 'v2-react'}
                  onClick={() => react(one.id, r.emoji)}
                >
                  {r.emoji} {r.count}
                </button>
              ))}
              <span className="v2-react-add">
                {QUICK.filter((e) => !one.reactions.some((r) => r.emoji === e)).slice(0, 3).map((e) => (
                  <button key={e} type="button" className="v2-react" onClick={() => react(one.id, e)}>
                    {e}
                  </button>
                ))}
              </span>
              {one.commentCount > 0 && (
                <Link className="d-card-link" to="/wall">
                  {one.commentCount} {one.commentCount === 1 ? 'comment' : 'comments'}
                </Link>
              )}
            </div>

            {one.comments.slice(0, 2).map((c) => (
              <p className="v2-post-comment" key={c.id}>
                <b>{c.author_name ?? 'Somebody'}</b> {c.body}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "4 min", "2 h", "3 d" — short, because the row is already full. */
function ago(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / (60 * 24))} d ago`;
}
