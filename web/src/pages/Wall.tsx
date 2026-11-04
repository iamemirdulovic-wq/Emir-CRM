import { useEffect, useRef, useState } from 'react';
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
  /* A JSON column, so whatever is in the row. Read through asMedia(), never
     trusted to be a list of pictures because an old row says it is. */
  media: unknown;
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
interface WallMedia { id: string; url: string; kind: string; name: string }

/**
 * Read a post's media column.
 *
 * It is a JSON column written by this CRM and by anything that posted before
 * today, so a row can hold an object, a string, a list with holes in it, or a
 * url pointing anywhere. Only a path on our own origin is rendered. A stored
 * `https://someone-else/track.gif` in an <img> is how a wall post tells a
 * stranger who read it and from where, and that is worth closing whether or
 * not anything can write one today.
 */
function sameOrigin(url: string): boolean {
  /* One leading slash: `//host/x.gif` is protocol-relative and goes off-site,
     and a scheme (`https:`, `data:`, `javascript:`) has a colon before the
     first slash. */
  return url.startsWith('/') && !url.startsWith('//') && !/^[^/]*:/.test(url);
}

function asMedia(value: unknown): WallMedia[] {
  if (!Array.isArray(value)) return [];
  const out: WallMedia[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url : '';
    if (!sameOrigin(url)) continue;
    out.push({
      id: typeof item.id === 'string' ? item.id : url,
      url,
      kind: 'image',
      name: typeof item.name === 'string' ? item.name : 'Picture',
    });
  }
  return out.slice(0, 8);
}

export const __test = { asMedia, sameOrigin };
interface TopPoster { id: string; name: string; photo_url: string | null; posts: number }
interface TeamMate {
  id: string; name: string; role: string; jobTitle: string | null;
  photoUrl: string | null; headline: string | null;
  languages: string[]; specialities: string[];
}

/* Enough to react with, few enough to fit one row on a phone. */
const COMPOSE_EMOJI = ['\u{1F525}', '\u{1F389}', '\u{1F4AA}', '\u{1F44F}', '\u{1F911}', '\u{1F680}', '\u{1F60D}', '\u{1F91D}', '\u2705', '\u{1F3C6}'];

/* Only used when somebody has not given themselves a job title. */
const ROLE_WORDS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Sales manager',
  agent: 'Property consultant',
  accountant: 'Accountant',
};

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
  const [tab, setTab] = useState<'feed' | 'team'>('feed');
  /* Uploaded before the post exists, so a picture that fails to upload never
     becomes a post with a broken image in it. */
  const [media, setMedia] = useState<WallMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const posts = useAsync<{ items: Post[] }>(() => api.get('/api/wall'), [reloadKey]);
  const side = useAsync<Sidebar>(() => api.get('/api/wall/sidebar'), [reloadKey]);
  const topPosters = useAsync<{ items: TopPoster[] }>(() => api.get('/api/wall/top-posters'), [reloadKey]);
  const team = useAsync<{ items: TeamMate[] }>(() => api.get('/api/wall/team'), []);

  const refresh = () => setReloadKey((n) => n + 1);

  async function attach(files: FileList | null) {
    const picked = Array.from(files ?? []).slice(0, 4);
    if (!picked.length) return;
    setUploading(true);
    try {
      for (const file of picked) {
        const saved = await api.upload<WallMedia>('/api/wall/media', file);
        setMedia((prev) => [...prev, saved].slice(0, 4));
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That picture did not upload');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function post() {
    if (!body.trim() && !media.length) return;
    setPosting(true);
    try {
      await api.post('/api/wall', { body, media });
      setBody('');
      setMedia([]);
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
        <Chip on={tab === 'feed'} icon="message-square" onClick={() => setTab('feed')}>
          The wall
        </Chip>
        <Chip on={tab === 'team'} icon="users-round" onClick={() => setTab('team')}>
          The team
          {team.data && ` (${team.data.items.length})`}
        </Chip>
      </Toolbar>

      {tab === 'feed' ? (
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

            {media.length > 0 && (
              <div className="wall-thumbs">
                {media.map((item) => (
                  <span className="wall-thumb" key={item.id}>
                    <img src={item.url} alt={item.name} />
                    <button
                      type="button"
                      className="wall-thumb-x"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => setMedia(media.filter((m) => m.id !== item.id))}
                    >
                      <Icon name="x" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="wall-tools">
              {/* GIF is just an image file here. A search box over Giphy or
                  Tenor needs an account and a key, so it arrives when one is
                  set rather than being a dead button until then. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                hidden
                onChange={(event) => void attach(event.target.files)}
              />
              <button
                type="button"
                className="wall-tool"
                disabled={uploading || media.length >= 4}
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="image-up" />
                {uploading ? 'Adding\u2026' : 'Photo or GIF'}
              </button>

              <div className="wall-emoji-wrap">
                <button
                  type="button"
                  className="wall-tool"
                  aria-expanded={emojiOpen}
                  onClick={() => setEmojiOpen(!emojiOpen)}
                >
                  <Icon name="smile" />
                  Emoji
                </button>
                {emojiOpen && (
                  <div className="wall-emoji-pop">
                    {COMPOSE_EMOJI.map((char) => (
                      <button
                        type="button"
                        key={char}
                        onClick={() => { setBody(`${body}${char}`); setEmojiOpen(false); }}
                      >
                        {char}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Button
                variant="primary"
                icon="send"
                loading={posting}
                disabled={!body.trim() && !media.length}
                onClick={() => void post()}
              >
                Post
              </Button>
            </div>
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

              <Panel index={3} icon="megaphone" title="Most posts this week">
                {topPosters.data?.items.length === 0 && (
                  <p className="muted">Nobody has posted this week. Be first.</p>
                )}
                <ol className="leaderboard">
                  {(topPosters.data?.items ?? []).map((row, index) => (
                    <li key={row.id} className={row.id === user?.id ? 'me' : undefined}>
                      <span className="rank">{index + 1}</span>
                      <Avatar name={row.name} src={row.photo_url ?? undefined} size={26} />
                      <Link to={`/profile/${row.id}`}>{row.name}</Link>
                      <b>{row.posts}</b>
                    </li>
                  ))}
                </ol>
              </Panel>

              <Panel index={4} icon="radio" title={`On now (${side.data.online.length})`}>
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
      ) : (
        <TeamTab state={team} />
      )}

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

/**
 * Who everybody is.
 *
 * Emir asked for a way to see the rest of the team properly. What this shows
 * is deliberately only the working half of a person: name, role, job title,
 * languages, what they sell, and buttons to reach them. Birthdays, home
 * country, phone numbers and anything else personal stay on their own profile
 * where they chose to put it. A directory is read by everyone, so it holds
 * what helps you pass a lead to the right colleague and nothing more.
 */
function TeamTab({ state }: { state: ReturnType<typeof useAsync<{ items: TeamMate[] }>> }) {
  const [find, setFind] = useState('');
  const everyone = state.data?.items ?? [];
  const needle = find.trim().toLowerCase();
  const shown = needle
    ? everyone.filter((mate) => [
        mate.name, mate.jobTitle ?? '', mate.headline ?? '',
        ...mate.languages, ...mate.specialities,
      ].join(' ').toLowerCase().includes(needle))
    : everyone;

  return (
    <div className="team-tab">
      <div className="team-find">
        <Icon name="search" size={16} />
        <input
          className="input"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          placeholder="A name, a language, a project…"
          aria-label="Find someone"
        />
      </div>

      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {!state.data && <SkeletonRows rows={4} />}
      {state.data && shown.length === 0 && (
        <Empty
          icon="users-round"
          title={needle ? 'Nobody matches that' : 'Nobody to show yet'}
          hint={needle ? 'Try a first name, or a language.' : 'Accounts added in Settings appear here.'}
        />
      )}

      <div className="team-grid">
        {shown.map((mate) => (
          <Link className="teammate" to={`/profile/${mate.id}`} key={mate.id}>
            <Avatar name={mate.name} src={mate.photoUrl ?? undefined} size={62} />
            <b>{mate.name}</b>
            <span className="teammate-role">{mate.jobTitle || ROLE_WORDS[mate.role] || mate.role}</span>
            {mate.headline && <p className="teammate-line">{mate.headline}</p>}
            {mate.languages.length > 0 && (
              <span className="teammate-tags">
                <Icon name="globe" size={13} />
                {mate.languages.join(', ')}
              </span>
            )}
            {mate.specialities.length > 0 && (
              <span className="teammate-tags">
                <Icon name="building-2" size={13} />
                {mate.specialities.slice(0, 3).join(', ')}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
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
  const [full, setFull] = useState<WallMedia | null>(null);
  const auto = AUTO_KINDS[post.kind];
  const pictures = asMedia(post.media);

  /* Escape closes the picture. Clicking does too, but a full-screen image with
     no keyboard way out is a trap for anyone not using a mouse. */
  useEffect(() => {
    if (!full) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFull(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

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

      {pictures.length > 0 && (
        /* One picture fills the width; two or more tile. A GIF is an <img>
           like any other, so it animates with nothing extra. */
        <div className="wall-pics" data-n={Math.min(pictures.length, 4)}>
          {pictures.map((picture) => (
            <button
              type="button"
              className="wall-pic"
              key={picture.id}
              onClick={() => setFull(picture)}
              aria-label={`Open ${picture.name}`}
            >
              <img src={picture.url} alt={picture.name} loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {full && (
        <div
          className="wall-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={full.name}
          onClick={() => setFull(null)}
        >
          <img src={full.url} alt={full.name} />
          <button type="button" className="wall-lightbox-x" aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
      )}

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
