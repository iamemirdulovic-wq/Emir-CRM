import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';
import { bestSub, wallSub } from './subs.js';

/**
 * The team wall, and Best of Homes beside it.
 *
 * Built from `design/web/team-wall.html` and `design/web/best-of-homes.html`.
 * One wall, two front ends: both screens read the endpoints the live CRM
 * already serves, so a post written on either is seen on both and the
 * leaderboard cannot say two different things in two places.
 *
 * The design's three kinds of post are three the server already stores: a
 * `post` is somebody talking, a pinned one is owner news and sits on top, and
 * a `deal_won` or `badge` is written by the CRM itself when something is won.
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

interface Sidebar {
  leaderboard: Array<{ id: string; name: string; photo_url: string | null; points: number }>;
  online: Array<{ id: string; name: string; photo_url: string | null }>;
  me: {
    points: number;
    level: { level: number; name: string; from: number; next: number | null; progress: number };
    streak: number;
    kudosLeft: number;
    badges: string[];
  };
  badgeCount: number;
}

interface Meeting {
  id: string;
  kind: string;
  title: string | null;
  startsAt: string;
  place: string | null;
  who: string | null;
  agent: string;
}

/**
 * How many days of points the board ranks, mirroring `BOARD_DAYS` in
 * `server/src/wall/wall.ts`. `/api/wall/sidebar` does not say, and the figure
 * was already written into the podium's own heading, so it is named once here
 * rather than typed out twice more.
 */
const BOARD_DAYS = 30;

/** The two reactions the design draws, in the design's order. */
const REACTIONS: Array<{ emoji: string; label: string }> = [
  { emoji: '👏', label: 'Clap' },
  { emoji: '🔥', label: 'Fire' },
];

const LIMIT = 500;

/**
 * What earns a point.
 *
 * The design's card invents four rules; these are the eight the server
 * actually awards on, copied from `XP_RULES` in `server/src/wall/xp.ts` with
 * its own wording. There is no endpoint for the table, so it is written here
 * — and if that table changes, this list has to change with it, because a
 * leaderboard that explains itself wrongly is worse than one that says
 * nothing.
 */
const POINT_RULES = [
  { label: 'Closed a deal', points: 100 },
  { label: 'The client turned up to a viewing', points: 15 },
  { label: 'Booked a viewing', points: 10 },
  { label: 'Sent a sales offer', points: 8 },
  { label: 'Ended the day with a next step on every lead', points: 5 },
  { label: 'A colleague said thank you', points: 5 },
  { label: 'Answered a new lead inside five minutes', points: 3 },
  { label: 'Actually spoke to a lead', points: 2 },
];

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'news', label: 'Owner news' },
  { key: 'win', label: 'Wins' },
] as const;

/** Which of the design's three shapes a stored post is drawn as. */
function shapeOf(post: Post): 'news' | 'win' | 'post' {
  if (post.kind === 'deal_won' || post.kind === 'badge') return 'win';
  if (post.pinned_at) return 'news';
  return 'post';
}

export function V2Wall() {
  const { user } = useAuth();
  const toast = useToast();
  const feed = useAsync<{ items: Post[] }>(() => api.get('/api/wall'), []);
  const side = useAsync<Sidebar>(() => api.get('/api/wall/sidebar'), []);

  const [writing, setWriting] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tab, setTab] = useState<string>('all');
  const [asNews, setAsNews] = useState(true);

  const canPin = user?.role === 'owner' || user?.role === 'admin';

  /* The next fortnight, for "Coming up". Dubai is UTC+4 all year, so the day
     boundary is a fixed offset and never a timezone library. */
  const window_ = useMemo(() => {
    const now = Date.now();
    return { from: new Date(now).toISOString(), to: new Date(now + 14 * 86_400_000).toISOString() };
  }, []);
  const diary = useAsync<{ meetings: Meeting[] }>(
    () => api.get(`/api/v2/calendar?from=${window_.from}&to=${window_.to}&scope=team`),
    [window_.from],
  );

  const posts = feed.data?.items ?? [];
  const shown = tab === 'all' ? posts : posts.filter((one) => shapeOf(one) === tab);
  /* Pinned first, as the design has it — owner news is the one post that is
     meant to stay where everybody will see it. */
  const ordered = [...shown].sort((a, b) => Number(Boolean(b.pinned_at)) - Number(Boolean(a.pinned_at)));

  async function post() {
    const body = writing.trim();
    if (!body) { setProblem('Write something first.'); return; }
    if (body.length > LIMIT) { setProblem(`Too long. Keep it under ${LIMIT} letters.`); return; }
    setBusy(true);
    setProblem(null);
    try {
      const made = await api.post<{ id: string }>('/api/wall', { body });
      /* Owner news is a pinned post, which is a second call because pinning
         is its own permission on the server. */
      if (canPin && asNews) await api.post(`/api/wall/${made.id}/pin`, { pinned: true });
      setWriting('');
      setTab('all');
      feed.reload();
      toast(canPin && asNews
        ? 'Posted as owner news · it stays on top'
        : 'Posted · the team gets one notification');
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not post.');
    } finally {
      setBusy(false);
    }
  }

  /*
   * `TeamWall.dc.html`: "Team wall" over "Wins and news · 13 people".
   * `design/web/team-wall.html` writes "News and wins from the whole office"
   * — no count at all — and the computer design wins where the two differ.
   */
  usePhoneHead({
    compact: true,
    title: 'Team wall',
    sub: wallSub(),
  });

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
    <div className="v2-wall-page p-wall">
      <div className="d-lay">
        <div className="d-feed">
          <section className="d-card">
            <div className="d-postbox">
              <Avatar name={user?.name ?? '?'} src={user?.photoUrl ?? undefined} size={44} />
              <div className={problem ? 'd-field d-invalid' : 'd-field'}>
                <textarea
                  className="d-textarea"
                  value={writing}
                  aria-label="Say something to the team"
                  placeholder="Share a win or a tip with the team"
                  onChange={(e) => { setWriting(e.target.value); setProblem(null); }}
                />
                {problem && <span className="d-error">{problem}</span>}
              </div>
            </div>
            <div className="d-postbox-foot">
              {canPin ? (
                <label className="d-switch">
                  <input type="checkbox" checked={asNews} onChange={(e) => setAsNews(e.target.checked)} />
                  <span className="d-track" />
                  Owner news · stays on top
                </label>
              ) : (
                <span className="d-small d-muted">Everyone in the office sees it.</span>
              )}
              <span className="d-grow" />
              <span className={writing.length > LIMIT ? 'd-small d-t-red' : 'd-small d-muted'}>
                {writing.length} / {LIMIT}
              </span>
              <button type="button" className="d-btn d-primary" disabled={busy} onClick={post}>
                <Icon name="megaphone" />{busy ? 'Posting…' : 'Post to the team'}
              </button>
            </div>
          </section>

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
                  <span className="d-count">
                    {posts.filter((p) => shapeOf(p) === one.key).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="d-feed">
            {ordered.map((one) => (
              <PostCard
                key={one.id}
                post={one}
                mine={one.author_id !== null && one.author_id === user?.id}
                canPin={canPin}
                onReact={(emoji) => react(one.id, emoji)}
                onChanged={() => feed.reload()}
              />
            ))}
          </div>

          {ordered.length === 0 && (
            <div className="d-card">
              <div className="d-empty">
                <span className="d-ic"><Icon name="megaphone" /></span>
                <b>Nothing here yet</b>
                <p>Be the first to post. A won deal lands here on its own.</p>
              </div>
            </div>
          )}
        </div>

        <aside className="d-side">
          <section className="d-card">
            <div className="d-card-head">
              <h3>Coming up</h3>
              <Link className="d-card-link" to="/v2/calendar">
                Calendar <Icon name="arrow-right" />
              </Link>
            </div>
            {(diary.data?.meetings ?? []).slice(0, 4).map((one) => (
              <div className="d-ev-row" key={one.id}>
                <span className="d-ev-date">
                  {dayName(one.startsAt)}<b>{dayNumber(one.startsAt)}</b>
                </span>
                <div className="d-grow">
                  <b className="d-bold">{one.title ?? one.who ?? 'Meeting'}</b>
                  <div className="d-small d-muted">
                    {[clock(one.startsAt), one.place, one.agent].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
            {diary.data && diary.data.meetings.length === 0 && (
              <p className="d-small d-muted">Nothing in the diary for the next two weeks.</p>
            )}
          </section>

          <section className="d-card">
            <div className="d-card-head">
              <h3>Best of Homes</h3>
              <Link className="d-card-link" to="/v2/best">
                Ranking <Icon name="arrow-right" />
              </Link>
            </div>
            {(side.data?.leaderboard ?? []).slice(0, 3).map((one, i) => (
              <Link className="d-list-row" to="/v2/best" key={one.id}>
                <b className="d-num-sm v2-rank-n">{i + 1}</b>
                <Avatar name={one.name} src={one.photo_url ?? undefined} size={26} />
                <span className="d-grow d-bold">{one.name.split(' ')[0]}</span>
                <b>{one.points.toLocaleString('en-GB')}</b>
              </Link>
            ))}
            {side.data && side.data.leaderboard.length === 0 && (
              <p className="d-small d-muted">No points yet this month.</p>
            )}
          </section>

          <section className="d-card d-flat">
            <b className="d-bold">What goes on the wall</b>
            <p className="d-small d-muted d-mt-4">
              News, wins and questions for everyone. A booked unit is posted by the CRM. Client
              names and phone numbers stay on the lead page.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** One post, in whichever of the design's three shapes it is. */
function PostCard({
  post, mine, canPin, onReact, onChanged,
}: {
  post: Post;
  mine: boolean;
  canPin: boolean;
  onReact: (emoji: string) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const shape = shapeOf(post);
  const dark = shape === 'win';
  const [menu, setMenu] = useState(false);
  /* Delete asks twice, in the same button, the way the design's own
     `data-confirm` does: a second press, not a dialog in the way. */
  const [sure, setSure] = useState(false);
  const canEdit = mine || canPin;

  useEffect(() => {
    if (!menu) return undefined;
    const away = () => { setMenu(false); setSure(false); };
    document.addEventListener('click', away);
    return () => document.removeEventListener('click', away);
  }, [menu]);

  async function pin() {
    try {
      await api.post(`/api/wall/${post.id}/pin`, { pinned: !post.pinned_at });
      toast(post.pinned_at ? 'Not pinned any more' : 'Pinned on top of the wall');
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setMenu(false);
    }
  }

  async function remove() {
    if (!sure) { setSure(true); return; }
    try {
      await api.del(`/api/wall/${post.id}`);
      toast('Post deleted');
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not delete.');
    } finally {
      setMenu(false);
      setSure(false);
    }
  }

  return (
    <article className={`d-card d-post${shape === 'post' ? '' : ` d-${shape}`}`}>
      <div className="d-post-head">
        {post.author_id
          ? <Avatar name={post.author_name ?? '?'} src={post.author_photo_url ?? undefined} size={44} />
          : <span className="d-card-icon d-accent"><Icon name="trophy" /></span>}
        <div className="d-who">
          <b>
            {post.author_name ?? 'homes.me'}
            {mine && <span className="d-chip">You</span>}
          </b>
          <span>{when(post.created_at)}</span>
        </div>
        {post.pinned_at && (
          <span className="d-chip d-orange"><Icon name="pin" />Pinned</span>
        )}
        {shape === 'news' && <span className="d-chip d-dark">Owner news</span>}
        {shape === 'win' && (
          <span className="d-chip d-green"><Icon name="trophy" />Win</span>
        )}
        {canEdit && (
          <span className="v2-post-more">
            <button
              type="button"
              aria-label="More"
              className={dark ? 'd-btn d-icon d-sm d-ghost d-on-dark' : 'd-btn d-icon d-sm d-ghost'}
              onClick={(e) => { e.stopPropagation(); setMenu((was) => !was); setSure(false); }}
            >
              <Icon name="more-horizontal" />
            </button>
            {menu && (
              <div className="d-menu d-open v2-post-menu" onClick={(e) => e.stopPropagation()}>
                {canPin && (
                  <button type="button" className="d-menu-item" onClick={pin}>
                    <Icon name="pin" />{post.pinned_at ? 'Unpin it' : 'Pin it on top'}
                  </button>
                )}
                <button type="button" className="d-menu-item d-danger" onClick={remove}>
                  <Icon name="trash-2" />{sure ? 'Press again to delete' : 'Delete the post'}
                </button>
              </div>
            )}
          </span>
        )}
      </div>

      {shape === 'win'
        ? (
          <>
            <div className="d-win-line">{firstLine(post.body) || 'A unit is booked'}</div>
            <div className="d-win-sub">{restLines(post.body) || 'Posted by the CRM'}</div>
          </>
        )
        : post.body && <p className="d-txt">{post.body}</p>}

      <div className="d-reacts">
        {REACTIONS.map((one) => {
          const got = post.reactions.find((r) => r.emoji === one.emoji);
          return (
            <button
              key={one.emoji}
              type="button"
              aria-label={one.label}
              className={got?.mine ? 'd-react d-on' : 'd-react'}
              onClick={() => onReact(one.emoji)}
            >
              <span className="d-em">{one.emoji}</span>
              <span>{got?.count ?? 0}</span>
            </button>
          );
        })}
        <span className="d-grow" />
        {post.commentCount > 0 && (
          <span className={dark ? 'd-small' : 'd-small d-muted'}>
            {post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}
          </span>
        )}
      </div>
    </article>
  );
}

/* ── Best of Homes ─────────────────────────────────────────────────────── */

/**
 * The ranking.
 *
 * Points come from `xp_events` over the last thirty days — the same numbers
 * the wall's sidebar shows, from the same endpoint, so the panel and the page
 * cannot disagree. The design's per-agent calls and meetings columns are not
 * drawn: nothing counts those by agent for a week, and a column of invented
 * numbers on a leaderboard people are judged by is worse than no column.
 */
export function V2Best() {
  const { user } = useAuth();
  const side = useAsync<Sidebar>(() => api.get('/api/wall/sidebar'), []);
  const badges = useAsync<{ badges: Array<{ key: string; name: string; how: string; icon: string; earned: boolean }> }>(
    () => api.get('/api/profiles/me'), [],
  );

  /*
   * `Leaderboard.dc.html` titles this "Best of Homes" and dates it "Week 46 ·
   * ends Sunday 23:59"; `design/web/best-of-homes.html` spells the window out
   * — "Week 46 · Mon 9 – Sun 15 Nov · ends Sunday 23:59". Neither can be had:
   * the server ranks points over a rolling `BOARD_DAYS` days, so there is no
   * week number and nothing for a deadline to be the end of. The line gives
   * the board's own window instead, with both ends off the Dubai clock.
   * Written up in `docs/v2/questions-subs.md` and `phone-questions-c.md`.
   *
   * The design's round "Show on office TV" action is not here: there is no TV
   * mode anywhere in this build, and an action that does nothing is worse
   * than none.
   */
  usePhoneHead({
    compact: true,
    title: 'Best of Homes',
    sub: side.data ? bestSub(BOARD_DAYS, new Date()) : undefined,
  });

  if (side.error) return <ErrorNote>{side.error}</ErrorNote>;
  if (!side.data) return <Spinner />;

  const board = side.data.leaderboard;
  const top = board[0]?.points ?? 0;
  const mySeat = board.findIndex((one) => one.id === user?.id);
  const me = side.data.me;
  const isAgent = user?.role === 'agent';

  /* Second, first, third — the order the podium is drawn in, and the heights
     the design gives each block. */
  const podium = [
    { who: board[1], place: 2, height: '92px', first: false },
    { who: board[0], place: 1, height: '134px', first: true },
    { who: board[2], place: 3, height: '62px', first: false },
  ].filter((one) => one.who);

  return (
    <div className="v2-best-page p-best">
      <div className="d-tabs d-top-tabs">
        <Link className="d-tab" to="/v2/team">Meet the team</Link>
        <Link className="d-tab d-on" to="/v2/best">Best of Homes</Link>
      </div>

      <div className="d-bento d-row1">
        <section className="d-card d-hero d-c-7 d-id-podium-card">
          <div className="d-row">
            <h2 className="d-grow">Podium · last 30 days</h2>
            <span className="d-hero-chip">Live</span>
          </div>
          <div className="d-podium">
            {podium.map((one) => (
              <div className={one.first ? 'd-pod d-first' : 'd-pod'} key={one.who?.id}>
                <Avatar
                  name={one.who?.name ?? '?'}
                  src={one.who?.photo_url ?? undefined}
                  size={one.first ? 64 : 44}
                />
                <b className="d-nm">
                  {(one.who?.name ?? '').split(' ')[0]}
                  {one.who?.id === user?.id ? ' · you' : ''}
                </b>
                <span className="d-pts">{(one.who?.points ?? 0).toLocaleString('en-GB')}</span>
                <span className="d-sm">points</span>
                <div className="d-block" style={{ '--h': one.height } as never}>{one.place}</div>
              </div>
            ))}
          </div>
          {podium.length === 0 && (
            <p className="d-small">Nobody has earned a point in the last thirty days.</p>
          )}
          {/*
            * The design's nudge under the podium — "6 calls or 1 meeting puts
            * you in first place" — which is the sentence that makes a
            * leaderboard do any work. The two numbers are the real gap
            * divided by the real point values in `POINT_RULES`, not a guess.
            */}
          {nudge(board[0]?.points ?? 0, me.points, mySeat) && (
            <p className="d-quote v2-c-nudge">{nudge(board[0]?.points ?? 0, me.points, mySeat)}</p>
          )}
        </section>

        <section className="d-card d-c-5">
          <div className="d-card-head">
            <h3>{seatWord(mySeat, isAgent)}</h3>
            <span className="d-chip d-green">{me.points.toLocaleString('en-GB')} points</span>
          </div>
          <p className="d-quote">
            {me.level.next
              ? <>You are <em>{(me.level.next - me.points).toLocaleString('en-GB')} points</em> from the next level.</>
              : <>You are at the <em>top level</em>.</>}
          </p>
          <div className="d-lvl d-mt-16">
            <span className="d-n">{me.level.level}</span>
            <div className="d-grow">
              <b>Level {me.level.level} · {me.level.name}</b>
              <div
                className="d-bar d-accent d-mt-8"
                style={{ '--v': `${Math.round(me.level.progress * 100)}%` } as never}
              >
                <i />
              </div>
              <div className="d-small d-muted d-mt-4">
                {me.points.toLocaleString('en-GB')}
                {me.level.next ? ` of ${me.level.next.toLocaleString('en-GB')} points` : ' points'}
              </div>
            </div>
          </div>
          <div className="d-trio d-mt-16">
            <div>
              <b>{me.streak} day{me.streak === 1 ? '' : 's'}</b>
              <span>streak</span>
            </div>
            <div>
              <b>{me.badges.length} of {side.data.badgeCount}</b>
              <span>badges</span>
            </div>
            <div>
              <b>{me.kudosLeft}</b>
              <span>thank-yous left</span>
            </div>
          </div>
          <div className="d-card-foot d-mt-auto">
            <Link className="d-btn d-primary" to="/v2/calling"><Icon name="phone" />Start calling</Link>
            <Link className="d-btn d-ghost" to="/v2/wall">Open the team wall</Link>
          </div>
        </section>
      </div>

      <div className="d-bento">
        <section className="d-card d-c-8">
          <div className="d-card-head">
            <h3>Ranking</h3>
            <span className="d-small d-muted">
              {board.length} {board.length === 1 ? 'person' : 'people'} · points over 30 days
            </span>
          </div>
          <table className="d-table d-no-lines d-id-rank">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th className="d-t-right">Points</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {board.map((one, i) => (
                <tr key={one.id} className={one.id === user?.id ? 'd-you' : undefined}>
                  <td className="d-rk">{i + 1}</td>
                  <td>
                    <span className="d-person">
                      <Avatar name={one.name} src={one.photo_url ?? undefined} size={26} />
                      <b className="d-bold">{one.name}</b>
                      {one.id === user?.id && <span className="d-chip d-dark">You</span>}
                    </span>
                  </td>
                  <td className="d-t-right d-pt">{one.points.toLocaleString('en-GB')}</td>
                  <td>
                    <div
                      className={i === 0 || one.id === user?.id ? 'd-bar d-accent' : 'd-bar'}
                      style={{ '--v': `${top > 0 ? Math.round((one.points / top) * 100) : 0}%` } as never}
                    >
                      <i />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <div className="d-stack d-c-4">
          <section className="d-card">
            <div className="d-card-head">
              <h3>Your badges</h3>
              <span className="d-small d-muted">
                {me.badges.length} of {side.data.badgeCount}
              </span>
            </div>
            <div className="d-badge-grid">
              {(badges.data?.badges ?? []).map((one) => (
                <div className={one.earned ? 'd-bdg' : 'd-bdg d-locked'} key={one.key}>
                  <span className="d-ic">
                    <Icon name={one.earned ? badgeIcon(one.icon) : 'lock'} />
                  </span>
                  <span>
                    <b>{one.name}</b>
                    <span>{one.how}</span>
                  </span>
                </div>
              ))}
            </div>
            {badges.data && badges.data.badges.length === 0 && (
              <p className="d-small d-muted">No badges set up yet.</p>
            )}
          </section>

          <section className="d-card">
            <div className="d-card-head d-mb-8"><h3>How you get points</h3></div>
            <dl className="d-kv">
              {POINT_RULES.map((one) => (
                <div className="d-kv-row" key={one.label}>
                  <dt>{one.label}</dt>
                  <dd><b>+{one.points}</b></dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

/** A badge's icon, which comes from the server as a name this app may not have. */
function badgeIcon(name: string): IconName {
  const known: Record<string, IconName> = {
    'badge-check': 'badge-check', 'calendar-check': 'calendar-check',
    'check-check': 'check-check', crown: 'crown', flame: 'flame', 'map-pin': 'map-pin',
    'sticky-note': 'sticky-note', target: 'target', trophy: 'trophy', zap: 'zap',
  };
  return known[name] ?? 'star';
}

/**
 * What it would take to get to the top, in things an agent does.
 *
 * Both numbers come out of `POINT_RULES`, which is what the points screen
 * itself shows: speaking to a lead is +2, booking a viewing is +10. Nothing
 * here is estimated — if the gap cannot be worked out the line is left out.
 */
function nudge(topPoints: number, myPoints: number, seat: number): string | null {
  if (seat === 0) return 'You are in first place. Keep it.';
  if (seat < 0) return null;
  const gap = topPoints - myPoints;
  if (gap <= 0) return null;
  const perCall = POINT_RULES.find((one) => one.label === 'Actually spoke to a lead')?.points ?? 2;
  const perViewing = POINT_RULES.find((one) => one.label === 'Booked a viewing')?.points ?? 10;
  const calls = Math.ceil(gap / perCall);
  const viewings = Math.ceil(gap / perViewing);
  return `${calls} call${calls === 1 ? '' : 's'} or ${viewings} booked `
    + `viewing${viewings === 1 ? '' : 's'} puts you in first place.`;
}

function seatWord(seat: number, isAgent: boolean): string {
  if (seat < 0) return isAgent ? 'You are not ranked yet' : 'Your month';
  const place = seat + 1;
  const suffix = ['st', 'nd', 'rd'][place - 1] ?? 'th';
  return `You are ${place}${suffix}`;
}

/** "Today 09:12", "Yesterday 17:45", "Mon 9 Nov 08:30" — the design's wording. */
function when(at: string): string {
  const then = new Date(at);
  const days = Math.floor((startOfDubaiDay(Date.now()) - startOfDubaiDay(then.getTime())) / 86_400_000);
  if (days === 0) return `Today ${clock(at)}`;
  if (days === 1) return `Yesterday ${clock(at)}`;
  return `${then.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${clock(at)}`;
}

/** Dubai is UTC+4 with no daylight saving, so the day starts at a fixed offset. */
function startOfDubaiDay(ms: number): number {
  const shifted = ms + 4 * 3_600_000;
  return shifted - (shifted % 86_400_000) - 4 * 3_600_000;
}

function clock(at: string): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function dayName(at: string): string {
  return new Date(at).toLocaleDateString('en-GB', { weekday: 'short' });
}

function dayNumber(at: string): string {
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric' });
}

function firstLine(body: string | null): string {
  return (body ?? '').split('\n')[0]?.trim() ?? '';
}

function restLines(body: string | null): string {
  return (body ?? '').split('\n').slice(1).join(' · ').trim();
}
