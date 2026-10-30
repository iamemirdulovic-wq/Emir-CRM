import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Button } from '../design/forms.js';
import { Icon, SkeletonRows } from '../design/index.js';
import type { IconName } from '../design/Icon.js';
import {
  Avatar, Chip, Empty, ErrorNote, Field, Panel, Select, TextArea, Toolbar, useToast,
} from '../design/ui.js';
import { BottomSheet } from '../design/feedback.js';
import { relativeTime } from '../lib/format.js';
import { celebrate } from '../lib/celebrate.js';

/**
 * The Team Wall.
 *
 * The CRM posts here itself — a deal closing, somebody's first day, Monday's
 * roundup — which is what makes it worth opening on a quiet Tuesday. A wall
 * with only what people typed is empty by the second week.
 */

interface Post {
  id: string;
  author_id: string | null;
  author_name: string | null;
  kind: string;
  body: string | null;
  poll: unknown;
  show_value: number;
  pinned_at: string | null;
  created_at: string;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  comments: Array<{ id: string; author_name: string | null; body: string; created_at: string }>;
  commentCount: number;
}

interface Sidebar {
  leaderboard: Array<{ id: string; name: string; points: number }>;
  online: Array<{ id: string; name: string }>;
  me: {
    points: number;
    level: { level: number; name: string; points: number; from: number; next: number | null; progress: number };
    streak: number;
    kudosLeft: number;
    badges: string[];
  };
  badgeCount: number;
}

const EMOJI = ['👏', '🔥', '🎉', '💪', '👍'];

/** What the CRM's own posts look like, so they read as announcements. */
const AUTO_KINDS: Record<string, { icon: IconName; tone: string }> = {
  deal_won: { icon: 'trophy', tone: 'won' },
  welcome: { icon: 'user-plus', tone: 'welcome' },
  anniversary: { icon: 'badge-check', tone: 'welcome' },
  best_of_week: { icon: 'crown', tone: 'best' },
  badge: { icon: 'star', tone: 'best' },
};

export function Wall() {
  const { user } = useAuth();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [thanking, setThanking] = useState(false);

  const posts = useAsync<{ items: Post[] }>(() => api.get('/api/wall'), [reloadKey]);
  const side = useAsync<Sidebar>(() => api.get('/api/wall/sidebar'), [reloadKey]);

  const refresh = () => setReloadKey((n) => n + 1);

  async function post() {
    if (!body.trim()) return;
    setPosting(true);
    try {
      await api.post('/api/wall', { body });
      setBody('');
      refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not post');
    } finally {
      setPosting(false);
    }
  }

  async function react(postId: string, emoji: string) {
    await api.post(`/api/wall/${postId}/react`, { emoji }).catch(() => undefined);
    refresh();
  }

  const items = posts.data?.items ?? [];

  return (
    <>
      <Toolbar
        right={
          <Button icon="message-square-heart" onClick={() => setThanking(true)}>
            Say thank you
            {side.data && ` (${side.data.me.kudosLeft})`}
          </Button>
        }
      >
        <Chip on icon="users-round">Team wall</Chip>
      </Toolbar>

      <div className="wall">
        <div className="wall-feed">
          <div className="wall-compose">
            <Avatar name={user?.name ?? '?'} />
            <TextArea
              rows={2}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Something worth telling the floor… use @name to tag someone"
            />
            <Button
              variant="primary"
              icon="send"
              loading={posting}
              disabled={!body.trim()}
              onClick={() => void post()}
            >
              Post
            </Button>
          </div>

          {posts.error && <ErrorNote>{posts.error}</ErrorNote>}
          {!posts.data && <SkeletonRows rows={4} />}
          {posts.data && items.length === 0 && (
            <Empty
              icon="users-round"
              title="Nothing on the wall yet"
              hint="Deals, new starters and Monday's roundup appear here on their own. You can post too."
            />
          )}

          {items.map((item) => (
            <PostCard
              key={item.id}
              post={item}
              canModerate={user?.role === 'owner' || user?.role === 'admin'}
              isMine={item.author_id === user?.id}
              onReact={(emoji) => void react(item.id, emoji)}
              onChanged={refresh}
            />
          ))}
        </div>

        <aside className="wall-side">
          {side.data && (
            <>
              <Panel index={1} icon="zap" title="You">
                <div className="level-row">
                  <b>{side.data.me.level.name}</b>
                  <span className="muted">{side.data.me.points} points</span>
                </div>
                <div className="level-bar">
                  <i style={{ width: `${Math.round(side.data.me.level.progress * 100)}%` }} />
                </div>
                {side.data.me.level.next !== null && (
                  <small className="muted">
                    {side.data.me.level.next - side.data.me.points} to the next level
                  </small>
                )}

                <div className="level-row" style={{ marginTop: 12 }}>
                  <span>
                    <Icon name="flame" size={14} />
                    {' '}
                    {side.data.me.streak === 0
                      ? 'No streak yet'
                      : `${side.data.me.streak} ${side.data.me.streak === 1 ? 'day' : 'days'} running`}
                  </span>
                  <Link to="/profile" className="muted">
                    {side.data.me.badges.length} of {side.data.badgeCount} badges
                  </Link>
                </div>
                {/* Said plainly so nobody thinks they lost a streak at the
                    weekend and stops trying. */}
                <small className="muted">Saturdays and Sundays do not break it.</small>
              </Panel>

              <Panel index={2} icon="trophy" title="Last 30 days">
                <ol className="leaderboard">
                  {side.data.leaderboard.map((row, index) => (
                    <li key={row.id} className={row.id === user?.id ? 'me' : undefined}>
                      <span className="rank">{index + 1}</span>
                      <Avatar name={row.name} size={26} />
                      <Link to={`/profile/${row.id}`}>{row.name}</Link>
                      <b>{row.points}</b>
                    </li>
                  ))}
                </ol>
              </Panel>

              <Panel index={3} icon="radio" title={`On now (${side.data.online.length})`}>
                {side.data.online.length === 0 && <p className="muted">Nobody is signed in.</p>}
                <div className="online">
                  {side.data.online.map((person) => (
                    <span key={person.id} title={person.name}>
                      <Avatar name={person.name} size={28} />
                    </span>
                  ))}
                </div>
              </Panel>
            </>
          )}
        </aside>
      </div>

      <ThankYou
        open={thanking}
        onClose={() => setThanking(false)}
        left={side.data?.me.kudosLeft ?? 0}
        onDone={() => {
          setThanking(false);
          refresh();
          celebrate({});
        }}
      />
    </>
  );
}

function PostCard({
  post, canModerate, isMine, onReact, onChanged,
}: {
  post: Post;
  canModerate: boolean;
  isMine: boolean;
  onReact: (emoji: string) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [open, setOpen] = useState(false);
  const auto = AUTO_KINDS[post.kind];

  async function send() {
    if (!comment.trim()) return;
    try {
      await api.post(`/api/wall/${post.id}/comments`, { body: comment });
      setComment('');
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not send');
    }
  }

  async function remove() {
    try {
      await api.del(`/api/wall/${post.id}`);
      toast('Removed');
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not remove it');
    }
  }

  return (
    <article className={`wall-post${auto ? ` auto ${auto.tone}` : ''}${post.pinned_at ? ' pinned' : ''}`}>
      <header>
        {auto
          ? <span className="auto-icon"><Icon name={auto.icon} size={16} /></span>
          : <Avatar name={post.author_name ?? '?'} size={34} />}
        <span className="who">
          <b>{post.author_name ?? 'Emigeo Homes'}</b>
          <time dateTime={post.created_at}>{relativeTime(post.created_at)}</time>
        </span>
        {post.pinned_at && <Icon name="pin" size={13} />}
        {(isMine || canModerate) && (
          <button type="button" className="wall-remove" onClick={() => void remove()} title="Remove">
            <Icon name="x" size={14} />
          </button>
        )}
      </header>

      {post.body && <p className="wall-body">{post.body}</p>}

      <div className="wall-reactions">
        {EMOJI.map((emoji) => {
          const found = post.reactions.find((reaction) => reaction.emoji === emoji);
          return (
            <button
              key={emoji}
              type="button"
              className={found?.mine ? 'react on' : 'react'}
              onClick={() => onReact(emoji)}
            >
              <span aria-hidden>{emoji}</span>
              {found && found.count > 0 && <b>{found.count}</b>}
            </button>
          );
        })}
        <button type="button" className="react" onClick={() => setOpen((on) => !on)}>
          <Icon name="message-square" size={14} />
          {post.commentCount > 0 && <b>{post.commentCount}</b>}
        </button>
      </div>

      {(open || post.comments.length > 0) && (
        <div className="wall-comments">
          {post.commentCount > post.comments.length && (
            <small className="muted">
              {post.commentCount - post.comments.length} earlier{' '}
              {post.commentCount - post.comments.length === 1 ? 'reply' : 'replies'}
            </small>
          )}
          {post.comments.map((item) => (
            <div className="wall-comment" key={item.id}>
              <b>{item.author_name ?? 'Someone'}</b>
              <span>{item.body}</span>
            </div>
          ))}

          {open && (
            <div className="wall-reply">
              <input
                className="input"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void send();
                }}
                placeholder="Reply…"
              />
              <Button icon="send" disabled={!comment.trim()} onClick={() => void send()} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function ThankYou({
  open, onClose, left, onDone,
}: { open: boolean; onClose: () => void; left: number; onDone: () => void }) {
  const toast = useToast();
  const team = useAsync<{ items: Array<{ id: string; name: string; role: string; is_active: number }> }>(
    () => api.get('/api/users'),
    [],
  );
  const { user } = useAuth();
  const [toUserId, setToUserId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await api.post('/api/wall/kudos', { toUserId, reason });
      toast('Thank you sent');
      setToUserId('');
      setReason('');
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not send');
    } finally {
      setBusy(false);
    }
  }

  const people = (team.data?.items ?? []).filter(
    (person) => person.is_active === 1 && person.id !== user?.id && person.role !== 'automation',
  );

  return (
    <BottomSheet open={open} title="Say thank you" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        {left > 0
          ? `You have ${left} left this week. They come back on Monday.`
          : 'You have used all of yours this week. They come back on Monday.'}
      </p>

      <Field label="Who?">
        <Select value={toUserId} onChange={(event) => setToUserId(event.target.value)}>
          <option value="">Choose someone</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>{person.name}</option>
          ))}
        </Select>
      </Field>

      <Field label="What for?" hint="They will see this, and so will the floor.">
        <TextArea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Covered my viewing at Beachfront when I was stuck in traffic."
        />
      </Field>

      <Button
        variant="primary"
        block
        loading={busy}
        disabled={!toUserId || reason.trim().length < 3 || left === 0}
        onClick={() => void send()}
      >
        Send it
      </Button>
    </BottomSheet>
  );
}
