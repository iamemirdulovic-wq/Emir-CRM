import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatDateTime, humanize } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import type { TaskFilter, TaskRow, TasksResponse, TaskScope } from '../lib/types.js';
import { Icon, type IconName } from '../design/index.js';
import { stageStyle } from '../design/stages.js';
import { Avatar, Chip, Empty, ErrorNote, Panel, Score, Spinner, Toolbar, useToast } from '../design/ui.js';

const TYPE_ICON: Record<TaskRow['type'], IconName> = {
  call: 'phone',
  whatsapp: 'message-circle',
  email: 'mail',
  meeting: 'calendar-check',
  other: 'check-square',
};

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: 'overdue', label: t('overdue') },
  { value: 'today', label: t('today') },
  { value: 'open', label: t('open') },
  { value: 'done', label: t('done') },
];

/**
 * The working list: what Workflows A and B asked for, plus whatever agents
 * added themselves. Overdue leads the order because a call task that has slipped
 * is the single clearest way a lead goes cold.
 */
export function Tasks() {
  const { user } = useAuth();
  const toast = useToast();
  const [filter, setFilter] = useState<TaskFilter>('overdue');
  const [scope, setScope] = useState<TaskScope>('mine');
  const [busy, setBusy] = useState<string | null>(null);

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';
  const list = useAsync<TasksResponse>(
    () => api.get(`/api/tasks${qs({ scope, filter })}`),
    [scope, filter],
  );

  async function toggle(task: TaskRow) {
    setBusy(task.id);
    try {
      await api.post(`/api/tasks/${task.id}/${task.completed_at ? 'reopen' : 'complete'}`);
      toast(task.completed_at ? 'Task reopened' : 'Task completed');
      list.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the task');
    } finally {
      setBusy(null);
    }
  }

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;

  const counts = list.data?.counts;
  const items = list.data?.items ?? [];

  return (
    <>
      <Toolbar
        right={
          isManager ? (
            <>
              <Chip on={scope === 'mine'} icon="user" onClick={() => setScope('mine')}>
                Mine
              </Chip>
              <Chip on={scope === 'team'} icon="users" onClick={() => setScope('team')}>
                {t('team')}
              </Chip>
            </>
          ) : undefined
        }
      >
        {FILTERS.map((option) => (
          <Chip key={option.value} on={filter === option.value} onClick={() => setFilter(option.value)}>
            {option.label}
            {counts && counts[option.value] > 0 && (
              <span className="n" style={{ marginInlineStart: 6, opacity: 0.75 }}>
                {counts[option.value]}
              </span>
            )}
          </Chip>
        ))}
      </Toolbar>

      <Panel index={1} icon="check-square" title={`${humanize(filter)} tasks`}>
        {list.loading && items.length === 0 && <Spinner />}
        {!list.loading && items.length === 0 && (
          <Empty
            icon="check-circle-2"
            title={filter === 'overdue' ? 'Nothing overdue' : 'Nothing here'}
            hint={filter === 'overdue' ? 'Every follow-up is on time.' : 'Try another filter.'}
          />
        )}

        {items.map((task) => {
          const overdue = !task.completed_at && new Date(task.due_at).getTime() < Date.now();
          return (
            <div className="task" key={task.id} style={{ alignItems: 'flex-start', padding: '12px 12px' }}>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 30, height: 30, borderRadius: 9 }}
                onClick={() => void toggle(task)}
                disabled={busy === task.id}
                aria-label={task.completed_at ? 'Reopen this task' : 'Mark this task done'}
              >
                <Icon name={task.completed_at ? 'check-circle-2' : 'circle'} size={16} />
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Icon name={TYPE_ICON[task.type]} size={15} style={{ color: 'var(--primary)' }} />
                  <b style={{ textDecoration: task.completed_at ? 'line-through' : undefined }}>{task.title}</b>
                  {task.priority === 'urgent' && <span className="pill due">Urgent</span>}
                  {task.stage_key && (
                    <span
                      className="pill"
                      style={{ color: stageStyle(task.stage_key).colour, borderColor: 'transparent' }}
                    >
                      {humanize(task.stage_key)}
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                  {task.contact_id ? (
                    <Link to={`/contacts/${task.contact_id}`} className="rowbtn">
                      {task.full_name ?? 'Contact'}
                    </Link>
                  ) : (
                    'No contact'
                  )}
                  {task.project_name ? ` · ${task.project_name}` : ''}
                  {` · due ${formatDateTime(task.due_at)}`}
                </div>
                {task.notes && (
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                    {task.notes}
                  </p>
                )}
              </div>

              {task.lead_score !== null && <Score value={task.lead_score} />}
              {task.phone_e164 && (
                <a className="icon-btn" href={`tel:${task.phone_e164}`} aria-label={`Call ${task.full_name ?? ''}`}>
                  <Icon name="phone" />
                </a>
              )}
              {task.contact_id && (
                <Link className="icon-btn" to={`/inbox?contact=${task.contact_id}`} aria-label="Open the conversation">
                  <Icon name="message-circle" />
                </Link>
              )}
              {scope !== 'mine' && <Avatar name={task.assignee_name} size={26} />}
              {overdue && <span className="due">Overdue</span>}
            </div>
          );
        })}
      </Panel>
    </>
  );
}
