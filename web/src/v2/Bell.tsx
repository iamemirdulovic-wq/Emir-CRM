import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon, type IconName } from '../design/index.js';
import { Spinner, ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';

/**
 * The bell, the panel behind it, and the whole page behind that.
 *
 * Built from `design/web/notifications.html` for the page, and from the
 * design's own shell (`design/web/app.js`, which draws `.panel` with `.notif`
 * rows) for the drop-down. The design has both, and they do different jobs:
 * the panel is the four things that just happened, the page is everything,
 * grouped by day and filtered by what kind of thing it is.
 *
 * Every row opens the exact screen it is about. A notification that drops you
 * on a dashboard is one you then have to go and find the subject of, which is
 * most of the reason people stop opening them.
 *
 * The count is read on its own endpoint because it is on every page for
 * everybody, and the list behind it is fifty rows this only needs the number
 * of.
 */

/** §4 of `docs/v2/phone-shell.md`: under this, the phone layout. */
const PHONE = 768;

/**
 * Whether this is a phone, in the component and not only in CSS.
 *
 * `Notifications.dc.html` makes the whole row one link — icon, title with the
 * time on its right, the text, then the verb line. The computer's row is a
 * div with a "Mark read" button and an "Open →" button in it, and at 390px
 * the second of those wrapped onto a line of its own.
 */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${PHONE - 1}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${PHONE - 1}px)`);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/**
 * What each kind of notification looks like, and where the page files it.
 *
 * The types are the ones `NotificationType` in `server/src/messaging/notify.ts`
 * actually writes — not a wider guess — so a new kind added there shows up
 * here as a plain grey bell rather than as nothing at all.
 */
const KINDS: Record<string, { icon: IconName; tone: string; group: string }> = {
  lead_assigned: { icon: 'user-plus', tone: 'd-accent', group: 'Leads' },
  new_incoming: { icon: 'inbox', tone: '', group: 'Leads' },
  enquiry_again: { icon: 'repeat', tone: 'd-blue', group: 'Leads' },
  lead_bounced: { icon: 'undo-2', tone: 'd-amber', group: 'Leads' },
  sla_reminder: { icon: 'clock-3', tone: 'd-red', group: 'Leads' },
  followup_due: { icon: 'clock', tone: 'd-amber', group: 'Tasks' },
  deal_won: { icon: 'trophy', tone: 'd-green', group: 'Team' },
  badge_earned: { icon: 'badge-check', tone: 'd-green', group: 'Team' },
  kudos: { icon: 'message-square-heart', tone: 'd-violet', group: 'Team' },
  mention: { icon: 'megaphone', tone: '', group: 'Team' },
  vip_accepted: { icon: 'crown', tone: 'd-accent', group: 'Team' },
  vip_refused: { icon: 'crown', tone: 'd-amber', group: 'Team' },
  suspicious_activity: { icon: 'shield', tone: 'd-red', group: 'System' },
  flagged_login: { icon: 'shield-check', tone: 'd-amber', group: 'System' },
};

const FALLBACK = { icon: 'bell' as IconName, tone: '', group: 'System' };

function kindOf(type: string): { icon: IconName; tone: string; group: string } {
  return KINDS[type] ?? FALLBACK;
}

/** The categories the page offers, in the design's order. */
const GROUPS = ['All', 'Leads', 'Meetings', 'Tasks', 'Team', 'System'];

/* ── the bell in the top bar ───────────────────────────────────────────── */

export function Bell() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const count = useAsync<{ unread: number }>(() => api.get('/api/notifications/count'), []);
  const list = useAsync<{ items: Notification[]; unread: number }>(
    () => (open ? api.get('/api/notifications') : Promise.resolve({ items: [], unread: 0 })),
    [open],
  );

  /* Click anywhere else and it closes. Escape too — a panel you cannot get
     out of with the keyboard is one that traps whoever is not using a mouse. */
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const unread = count.data?.unread ?? 0;

  async function markAll() {
    try {
      await api.post('/api/notifications/read', {});
      count.reload();
      list.reload();
    } catch {
      /* The rows are still readable; the count catches up on the next page. */
    }
  }

  return (
    <div className="v2-bell-wrap" ref={box}>
      <button
        type="button"
        className="v2-bell"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name="bell" />
        {unread > 0 && <span className="v2-bell-n">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <aside className="d-panel d-open v2-bell-panel" aria-label="Notifications">
          <div className="d-panel-head">
            <h2>{unread > 0 ? `${unread} new` : 'Notifications'}</h2>
            {unread > 0 && (
              <button type="button" className="d-btn d-sm d-ghost" onClick={markAll}>
                Mark all read
              </button>
            )}
            <button
              type="button"
              className="d-btn d-icon d-sm d-ghost"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <Icon name="x" />
            </button>
          </div>

          <div className="d-panel-body">
            {!list.data && <p className="d-small d-muted">Reading…</p>}

            {list.data && list.data.items.length === 0 && (
              <p className="d-small d-muted">
                Nothing yet. This is where a new lead or a VIP hand-over lands.
              </p>
            )}

            {(list.data?.items ?? []).slice(0, 8).map((row) => {
              const kind = kindOf(row.type);
              return (
                <Link
                  key={row.id}
                  to={where(row.link)}
                  className={row.read_at ? 'd-notif' : 'd-notif d-unread'}
                  onClick={() => setOpen(false)}
                >
                  <span className={`d-ic ${kind.tone}`}><Icon name={kind.icon} /></span>
                  <span className="d-body">
                    <b>{row.title}</b>
                    {row.body && <p>{row.body}</p>}
                    <span className="d-act">Open →</span>
                  </span>
                  <span className="d-age">{ago(row.created_at)}</span>
                </Link>
              );
            })}
          </div>

          <div className="d-panel-foot">
            <Link className="d-btn d-sm" to="/v2/notifications" onClick={() => setOpen(false)}>
              See all
            </Link>
            <span className="d-grow" />
            <Link
              className="d-card-link"
              to="/v2/settings/notifications"
              onClick={() => setOpen(false)}
            >
              Choose what reaches you <Icon name="arrow-right" />
            </Link>
          </div>
        </aside>
      )}
    </div>
  );
}

/* ── the whole page ────────────────────────────────────────────────────── */

export function V2Notifications() {
  const toast = useToast();
  const list = useAsync<{ items: Notification[]; unread: number }>(
    () => api.get('/api/notifications'), [],
  );
  /* The three lines the design puts in the side card. They are this person's
     own settings, read from the screen that owns them rather than restated
     here, so the two cannot drift apart. */
  const prefs = useAsync<{ quiet: string | null; vipIgnoresQuiet: boolean; sounds: boolean }>(
    () => api.get('/api/v2/notify'), [],
  );
  const [group, setGroup] = useState('All');
  const [onlyNew, setOnlyNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const phone = useIsPhone();

  const items = list.data?.items ?? [];
  const unread = items.filter((one) => !one.read_at).length;

  /*
   * §1.4. `Notifications.dc.html` writes "5 new" or "All read" under the
   * title; the build opened with a hero count card saying the same thing
   * twice the size.
   */
  usePhoneHead({
    compact: true,
    title: 'Notifications',
    sub: unread === 0 ? 'All read' : `${unread} new`,
    /* `Notifications.dc.html` puts "Mark all read" in the header row beside
       the title, not in a count card below it. */
    ...(unread > 0 ? { action: { icon: 'check-check', label: 'Mark all read', onClick: markAll } } : {}),
  });

  /* Only the categories that have something in them, plus All. Five empty
     tabs is five taps that do nothing. */
  const tabs = useMemo(() => {
    const live = new Set(items.map((one) => kindOf(one.type).group));
    return GROUPS.filter((name) => name === 'All' || live.has(name));
  }, [items]);

  const shown = items.filter((one) => {
    if (group !== 'All' && kindOf(one.type).group !== group) return false;
    if (onlyNew && one.read_at) return false;
    return true;
  });

  async function markAll() {
    setBusy(true);
    try {
      await api.post('/api/notifications/read', {});
      toast('Everything marked as read');
      list.reload();
    } catch {
      toast('That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function markOne(id: string) {
    try {
      await api.post('/api/notifications/read', { id });
      list.reload();
    } catch {
      /* The row is still there; pressing again retries. */
    }
  }

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;
  if (!list.data) return <Spinner />;

  return (
    <div className="v2-bell-page p-bell">
      <div className="d-lay">
        <section className="d-card v2-bell-list">
          <div className="d-n-head">
            <b className="d-num-hero">{unread}</b>
            <div className="d-grow">
              <h2>{unread === 1 ? 'new notification' : 'new notifications'}</h2>
              <p className="d-muted d-small">
                {unread > 0
                  ? 'Click a row and it opens the right page.'
                  : 'All read. Click a row and it opens the right page.'}
              </p>
            </div>
            <button
              type="button"
              className="d-btn"
              disabled={unread === 0 || busy}
              onClick={markAll}
            >
              <Icon name="check" />Mark all read
            </button>
          </div>

          <div className="d-n-tabs">
            <div className="d-tabs d-pills" role="tablist">
              {tabs.map((name) => {
                const n = items.filter(
                  (one) => !one.read_at && (name === 'All' || kindOf(one.type).group === name),
                ).length;
                return (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={group === name}
                    className={group === name ? 'd-tab d-on' : 'd-tab'}
                    onClick={() => setGroup(name)}
                  >
                    {name}
                    {n > 0 && (
                      <span className={group === name ? 'd-count' : 'd-count d-red'}>{n}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <span className="d-grow" />
            <label className="d-switch d-small">
              <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
              <span className="d-track" />
              Only new
            </label>
          </div>

          <div>
            {days(shown).map(([day, rows]) => (
              <div key={day}>
                <div className="d-grp">{day}</div>
                {rows.map((row) => {
                  const kind = kindOf(row.type);
                  if (phone) {
                    /* The design's row: one link, the time on the title's
                       right, and the unread dot at the end. Opening it marks
                       it read, which is why there is no second button. */
                    return (
                      <Link
                        key={row.id}
                        className={row.read_at ? 'v2-b-nrow' : 'v2-b-nrow v2-b-nnew'}
                        to={where(row.link)}
                        onClick={() => markOne(row.id)}
                      >
                        <span className={`d-ic ${kind.tone}`}><Icon name={kind.icon} /></span>
                        <span className="v2-b-nbd">
                          <span className="v2-b-ntop">
                            <b>{row.title}</b>
                            <span className="v2-b-nage">{ago(row.created_at)}</span>
                          </span>
                          {row.body && <span className="v2-b-ntext">{row.body}</span>}
                        </span>
                        {!row.read_at && <span className="d-udot" aria-label="New" />}
                      </Link>
                    );
                  }
                  return (
                    <div key={row.id} className={row.read_at ? 'd-nrow' : 'd-nrow d-unread'}>
                      <span className={`d-ic ${kind.tone}`}><Icon name={kind.icon} /></span>
                      <span className="d-bd">
                        <b>{row.title}</b>
                        {row.body && <p>{row.body}</p>}
                      </span>
                      {!row.read_at && (
                        <button
                          type="button"
                          className="d-btn d-xs d-ghost d-mark"
                          onClick={() => markOne(row.id)}
                        >
                          Mark read
                        </button>
                      )}
                      <Link className="d-btn d-sm" to={where(row.link)} onClick={() => markOne(row.id)}>
                        Open <Icon name="arrow-right" />
                      </Link>
                      <span className="d-age">{ago(row.created_at)}</span>
                      <span className="d-udot" aria-label="New" />
                    </div>
                  );
                })}
              </div>
            ))}

            {shown.length === 0 && (
              <div className="d-empty">
                <span className="d-ic"><Icon name="bell" /></span>
                <b>You are up to date</b>
                <p>
                  {onlyNew || group !== 'All'
                    ? `Nothing new in “${group}”. New alerts show up on top.`
                    : 'Nothing here yet. New alerts show up on top.'}
                </p>
                {(onlyNew || group !== 'All') && (
                  <button
                    type="button"
                    className="d-btn d-sm"
                    onClick={() => { setGroup('All'); setOnlyNew(false); }}
                  >
                    Show all notifications
                  </button>
                )}
              </div>
            )}
          </div>
        </section>

        <aside className="d-side">
          <section className="d-card">
            <div className="d-card-head"><h3>Choose what reaches you</h3></div>
            <p className="d-muted d-small">
              Switch each alert on or off. A VIP lead always comes through.
            </p>
            {prefs.data && (
              <dl className="d-kv d-mt-8">
                <div className="d-kv-row">
                  <dt>Quiet hours</dt>
                  <dd>{prefs.data.quiet ? prefs.data.quiet.replace('-', ' – ') : 'Off'}</dd>
                </div>
                <div className="d-kv-row">
                  <dt>VIP leads</dt>
                  <dd>
                    {prefs.data.vipIgnoresQuiet
                      ? 'Ring also in quiet hours'
                      : 'Wait until quiet hours end'}
                  </dd>
                </div>
                <div className="d-kv-row">
                  <dt>Sound</dt>
                  <dd>{prefs.data.sounds ? 'On' : 'Off'}</dd>
                </div>
              </dl>
            )}
            <div className="d-card-foot">
              <Link className="d-btn d-block" to="/v2/settings/notifications">
                <Icon name="settings" />Choose what reaches you
              </Link>
            </div>
          </section>

          <section className="d-card">
            <div className="d-card-head d-mb-8"><h3>Alerts on your phone</h3></div>
            <p className="d-muted d-small">
              Add homes.me to your phone&rsquo;s home screen to get alerts when the computer is
              closed.
            </p>
            {/* `Notifications.dc.html` closes on the sentence that explains
                why every row carries a link at all. */}
            <p className="d-muted d-small d-mt-8">
              Tap a notification on your phone and the CRM opens on that same page.
            </p>
            <div className="d-card-foot">
              <Link className="d-card-link" to="/v2/settings/phone-app">
                How to install <Icon name="arrow-right" />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

/**
 * Where a notification goes.
 *
 * The server writes live-CRM paths (`/contacts/c-1`) because the same row
 * feeds both front ends. In v2 the same record lives under `/v2`, so the path
 * is moved across rather than a second column being added to the table.
 */
function where(link: string | null): string {
  if (!link) return '/v2';
  return link.startsWith('/v2') ? link : `/v2${link}`;
}

/**
 * Today, Yesterday, then the date.
 *
 * Dubai is UTC+4 with no daylight saving, so which day something happened on
 * is a fixed offset and never a timezone library.
 */
function days(rows: Notification[]): Array<[string, Notification[]]> {
  const groups = new Map<string, Notification[]>();
  for (const row of rows) {
    const name = dayName(row.created_at);
    const got = groups.get(name);
    if (got) got.push(row); else groups.set(name, [row]);
  }
  return [...groups];
}

function dayName(at: string): string {
  const days_ = Math.floor((startOfDubaiDay(Date.now()) - startOfDubaiDay(new Date(at).getTime())) / 86_400_000);
  if (days_ <= 0) return 'Today';
  if (days_ === 1) return 'Yesterday';
  if (days_ < 7) return 'Earlier this week';
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function startOfDubaiDay(ms: number): number {
  const shifted = ms + 4 * 3_600_000;
  return shifted - (shifted % 86_400_000) - 4 * 3_600_000;
}

/** "4 min ago", "2 h ago", "3 d" — short, because the row is already full. */
function ago(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / (60 * 24))} d`;
}
