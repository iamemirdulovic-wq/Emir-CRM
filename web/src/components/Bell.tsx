import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';
import { Icon, type IconName } from '../design/index.js';
import { Empty } from '../design/ui.js';

/**
 * The bell: everything the CRM told this person, kept.
 *
 * It exists because push is fire-and-forget. An agent whose phone was
 * face-down, or who never allowed notifications, used to have no way of
 * discovering that a lead was given to them at 11:40 — the information existed
 * for a second and then did not.
 *
 * Grouped by day rather than listed flat, because "today" and "earlier" is the
 * distinction someone opening this actually cares about.
 */

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  contact_id: string | null;
  priority: 'normal' | 'high';
  read_at: string | null;
  created_at: string;
}

/** One icon per kind, so the list is scannable without reading it. */
const ICONS: Record<string, IconName> = {
  lead_assigned: 'flame',
  sla_reminder: 'alarm-clock',
  lead_bounced: 'undo-2',
  new_incoming: 'inbox',
  enquiry_again: 'repeat',
  followup_due: 'phone-outgoing',
  mention: 'message-square',
  deal_won: 'trophy',
  suspicious_activity: 'shield',
  flagged_login: 'shield',
};

const POLL_MS = 60_000;

export function Bell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  /* Closed, only the count is fetched — the list behind it is fifty rows
     nobody is looking at. */
  const refresh = useCallback(async (full: boolean) => {
    try {
      if (full) {
        const data = await api.get<{ items: Notification[]; unread: number }>('/api/notifications');
        setItems(data.items);
        setUnread(data.unread);
      } else {
        const { unread: count } = await api.get<{ unread: number }>('/api/notifications/count');
        setUnread(count);
      }
    } catch {
      /* Offline or signed out. The next poll settles it; a toast every minute
         on a bad connection would be worse than the silence. */
    }
  }, []);

  useEffect(() => {
    void refresh(false);
    const timer = window.setInterval(() => void refresh(false), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function openList() {
    setOpen(true);
    await refresh(true);
  }

  async function markAll() {
    setUnread(0);
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })));
    await api.post('/api/notifications/read', {}).catch(() => undefined);
  }

  async function openOne(item: Notification) {
    setOpen(false);
    if (!item.read_at) {
      setUnread((count) => Math.max(0, count - 1));
      await api.post('/api/notifications/read', { id: item.id }).catch(() => undefined);
    }
    if (item.link) navigate(item.link);
  }

  const groups = groupByDay(items);

  return (
    <div className="bell-wrap" ref={box}>
      <button
        type="button"
        className="icon-btn bell-btn"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : void openList())}
      >
        <Icon name={unread > 0 ? 'bell-ring' : 'bell'} />
        {unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <header>
            <b>Notifications</b>
            {unread > 0 && (
              <button type="button" className="bell-clear" onClick={() => void markAll()}>
                Mark all read
              </button>
            )}
          </header>

          <div className="bell-list">
            {items.length === 0 && (
              <Empty icon="bell" title="Nothing yet" hint="New leads and reminders will show up here." />
            )}
            {groups.map(([day, rows]) => (
              <section key={day}>
                <h4>{day}</h4>
                {rows.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.read_at ? 'bell-item' : 'bell-item unread'}
                    onClick={() => void openOne(item)}
                  >
                    <span className={`bell-icon ${item.priority}`}>
                      <Icon name={ICONS[item.type] ?? 'bell'} size={15} />
                    </span>
                    <span className="bell-text" dir="auto">
                      <b>{item.title}</b>
                      {item.body && <small>{item.body}</small>}
                    </span>
                    <time dateTime={item.created_at}>{relativeTime(item.created_at)}</time>
                  </button>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Today, Yesterday, then the date — the distinction people actually use. */
function groupByDay(items: Notification[]): Array<[string, Notification[]]> {
  const groups = new Map<string, Notification[]>();
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));

  for (const item of items) {
    const key = dayKey(new Date(item.created_at));
    const label = key === today ? 'Today' : key === yesterday ? 'Yesterday' : longDate(item.created_at);
    const list = groups.get(label) ?? [];
    list.push(item);
    groups.set(label, list);
  }
  return [...groups.entries()];
}

/** The day in Dubai, which is the day the business happened on. */
function dayKey(date: Date): string {
  return new Date(date.getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-AE', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short' })
    .format(new Date(iso));
}
