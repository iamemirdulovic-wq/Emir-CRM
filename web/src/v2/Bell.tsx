import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';

/**
 * The bell, and what is behind it.
 *
 * `docs/v2/pages.md` §5. Every row opens the exact screen it is about — a
 * notification that drops you on a dashboard is one you have to go and find
 * the subject of, which is most of the reason people stop opening them.
 *
 * The count is read on its own endpoint because it is on every page for
 * everybody, and the list behind it is fifty rows this only needs the number
 * of.
 */

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

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
        <div className="v2-panel" role="dialog" aria-label="Notifications">
          <div className="v2-panel-head">
            <b>{unread > 0 ? `${unread} new` : 'Notifications'}</b>
            {unread > 0 && (
              <button type="button" className="d-card-link" onClick={markAll}>Mark all read</button>
            )}
          </div>

          {!list.data && <p className="v2-none">Reading…</p>}

          {list.data && list.data.items.length === 0 && (
            <p className="v2-none">Nothing yet. This is where a new lead or a VIP hand-over lands.</p>
          )}

          <ul className="v2-panel-list">
            {(list.data?.items ?? []).slice(0, 20).map((row) => (
              <li key={row.id}>
                <Link
                  to={row.link ?? '/v2'}
                  className={row.read_at ? 'v2-note-row' : 'v2-note-row v2-note-new'}
                  onClick={() => setOpen(false)}
                >
                  <span className="v2-note-what">
                    <b>{row.title}</b>
                    {row.body && <span>{row.body}</span>}
                  </span>
                  <span className="v2-note-when">{ago(row.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>

          <Link className="d-card-link v2-panel-foot" to="/v2/settings" onClick={() => setOpen(false)}>
            Choose what reaches you
          </Link>
        </div>
      )}
    </div>
  );
}

/** "4 min", "2 h", "3 d" — short, because the row is already full. */
function ago(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / (60 * 24))} d`;
}
