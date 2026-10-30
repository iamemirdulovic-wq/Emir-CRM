import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon, SkeletonRows } from '../design/index.js';
import { Chip, Empty, ErrorNote, Panel, Select, Toolbar } from '../design/ui.js';
import { formatDateTime, humanize, relativeTime } from '../lib/format.js';

/**
 * Everything that has been done, newest first.
 *
 * Owner only. The log carries before-and-after values from every table, so
 * being able to read it is close to being able to read everything — which is
 * exactly why it exists, and exactly why it is not shared around.
 *
 * Each row is collapsed to one line by default. An audit log that opens as a
 * wall of JSON is an audit log nobody reads, and one nobody reads is the same
 * as not having one.
 */

interface Entry {
  id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_label: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: unknown;
  after_json: unknown;
  ip: string | null;
  created_at: string;
}

/** Actions worth colouring, because they are the ones that lose things. */
const SERIOUS = /delete|remove|export|bulk|force|reopen|undo|deactivat/i;

export function AuditLog() {
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const data = useAsync<{
    items: Entry[];
    actions: Array<{ action: string; n: number }>;
    pageSize: number;
  }>(
    () => api.get(`/api/activity/audit?page=${page}${action ? `&action=${encodeURIComponent(action)}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
    [action, search, page],
  );

  const items = data.data?.items ?? [];

  return (
    <>
      <Toolbar>
        <Chip on icon="shield">Audit log</Chip>
      </Toolbar>

      {data.error && <ErrorNote>{data.error}</ErrorNote>}

      <Panel index={1} icon="shield" title="Everything that has been done">
        <div className="audit-filters">
          <Select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Everything</option>
            {data.data?.actions.map((row) => (
              <option key={row.action} value={row.action}>
                {humanize(row.action)} ({row.n})
              </option>
            ))}
          </Select>
          <input
            className="input"
            placeholder="Search by person, action or id"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>

        {!data.data && <SkeletonRows rows={8} />}
        {data.data && items.length === 0 && (
          <Empty icon="shield-check" title="Nothing matches" hint="Try a different action or clear the search." />
        )}

        <ul className="audit-list">
          {items.map((entry) => {
            const expanded = open === entry.id;
            const serious = SERIOUS.test(entry.action);
            return (
              <li key={entry.id} className={serious ? 'audit-row serious' : 'audit-row'}>
                <button
                  type="button"
                  className="audit-line"
                  onClick={() => setOpen(expanded ? null : entry.id)}
                  aria-expanded={expanded}
                >
                  <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
                  <b>{entry.actor_name ?? entry.actor_label ?? 'The system'}</b>
                  <span className="audit-action">{humanize(entry.action)}</span>
                  <span className="muted">{entry.entity_type}</span>
                  <time dateTime={entry.created_at} title={formatDateTime(entry.created_at)}>
                    {relativeTime(entry.created_at)}
                  </time>
                </button>

                {expanded && (
                  <div className="audit-detail">
                    <div className="kv">
                      <span>Who</span>
                      <b>
                        {entry.actor_name ?? entry.actor_label ?? 'The system'}
                        {entry.actor_role ? ` · ${humanize(entry.actor_role)}` : ''}
                      </b>
                    </div>
                    <div className="kv">
                      <span>When</span>
                      <b>{formatDateTime(entry.created_at)}</b>
                    </div>
                    {entry.entity_id && (
                      <div className="kv">
                        <span>On</span>
                        <b>{entry.entity_type} {entry.entity_id}</b>
                      </div>
                    )}
                    {entry.ip && (
                      <div className="kv">
                        <span>From</span>
                        <b>{entry.ip}</b>
                      </div>
                    )}

                    {/* Before and after side by side: the question an audit
                        log is opened to answer is always "what changed". */}
                    <div className="audit-diff">
                      <div>
                        <div className="sec-t">Before</div>
                        <pre>{pretty(entry.before_json)}</pre>
                      </div>
                      <div>
                        <div className="sec-t">After</div>
                        <pre>{pretty(entry.after_json)}</pre>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {items.length > 0 && (
          <div className="audit-pager">
            <button type="button" className="btn" disabled={page === 1} onClick={() => setPage((n) => n - 1)}>
              <Icon name="chevron-left" size={14} />
              Newer
            </button>
            <span className="muted">Page {page}</span>
            <button
              type="button"
              className="btn"
              disabled={items.length < (data.data?.pageSize ?? 50)}
              onClick={() => setPage((n) => n + 1)}
            >
              Older
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        )}
      </Panel>
    </>
  );
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(value);
  }
}
