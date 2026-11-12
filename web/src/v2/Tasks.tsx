import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote } from '../design/ui.js';

/**
 * Tasks.
 *
 * `docs/v2/pages.md` §17, on the endpoints the live CRM already has — one
 * task list, two front ends. The tabs are the four questions an agent
 * actually asks (what is late, what is today, what is open at all, what did
 * I finish), and the count beside each one comes back with the list, so the
 * tab and the rows under it cannot disagree.
 */

interface Task {
  id: string;
  type: 'call' | 'whatsapp' | 'email' | 'meeting' | 'other';
  title: string;
  notes: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  due_at: string;
  completed_at: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  full_name: string | null;
  phone_e164: string | null;
  project_name: string | null;
  assignee_name: string | null;
}

interface Answer {
  items: Task[];
  counts: { overdue: number; today: number; open: number; done?: number };
}

const TABS = [
  { key: 'overdue', label: 'Late' },
  { key: 'today', label: 'Today' },
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
] as const;

const ICON: Record<Task['type'], string> = {
  call: 'phone', whatsapp: 'message-circle', email: 'mail',
  meeting: 'calendar-days', other: 'check-check',
};

export function V2Tasks() {
  const { user } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('today');
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const list = useAsync<Answer>(
    () => api.get(`/api/tasks?filter=${tab}&scope=${scope}`),
    [tab, scope],
  );

  async function finish(task: Task) {
    setBusy(task.id);
    try {
      await api.post(`/api/tasks/${task.id}/${task.completed_at ? 'reopen' : 'complete'}`, {});
      list.reload();
    } catch {
      /* The row stays as it was; pressing again retries. */
    } finally {
      setBusy(null);
    }
  }

  const counts = list.data?.counts;

  return (
    <div className="v2-tasks">
      <header className="v2-inc-head">
        <h1 className="v2-hi">Tasks</h1>
        <p className="d-muted">
          {counts
            ? `${counts.overdue} late · ${counts.today} today · ${counts.open} open`
            : 'Everything you promised yourself you would do.'}
        </p>
      </header>

      <div className="v2-leads-bar">
        <div className="v2-tabs" role="tablist">
          {TABS.map((one) => (
            <button
              key={one.key}
              type="button"
              role="tab"
              aria-selected={tab === one.key}
              className={tab === one.key ? 'v2-tab-b v2-tab-b-on' : 'v2-tab-b'}
              onClick={() => setTab(one.key)}
            >
              {one.label}
              {one.key !== 'done' && counts?.[one.key] ? (
                <span className="v2-tab-n">{counts[one.key]}</span>
              ) : null}
            </button>
          ))}
        </div>

        {user?.role !== 'agent' && (
          <div className="v2-tabs" role="tablist">
            <button type="button" className={scope === 'mine' ? 'v2-tab-b v2-tab-b-on' : 'v2-tab-b'}
              onClick={() => setScope('mine')}>Mine</button>
            <button type="button" className={scope === 'team' ? 'v2-tab-b v2-tab-b-on' : 'v2-tab-b'}
              onClick={() => setScope('team')}>The team</button>
          </div>
        )}

        <button type="button" className="d-btn d-sm d-primary" onClick={() => setAdding((was) => !was)}>
          <Icon name="plus" />{adding ? 'Not now' : 'New task'}
        </button>
      </div>

      {adding && <NewTask onDone={() => { setAdding(false); list.reload(); }} />}

      {list.error && <ErrorNote>{list.error}</ErrorNote>}
      {!list.data && !list.error && <Spinner />}

      {list.data && list.data.items.length === 0 && (
        <div className="v2-empty">
          <span className="v2-empty-mark"><Icon name="check-check" /></span>
          <h2>{tab === 'done' ? 'Nothing finished yet' : 'Nothing here'}</h2>
          <p>
            {tab === 'overdue' ? 'Nothing you promised has slipped past its time.'
              : tab === 'today' ? 'Nothing is due today.'
                : 'No open tasks.'}
          </p>
        </div>
      )}

      <ul className="v2-task-list">
        {(list.data?.items ?? []).map((task) => {
          const late = !task.completed_at && new Date(task.due_at) < new Date();
          return (
            <li key={task.id} className={task.completed_at ? 'd-card v2-task v2-task-done' : 'd-card v2-task'}>
              <button
                type="button"
                className={task.completed_at ? 'v2-tick v2-tick-on' : 'v2-tick'}
                aria-label={task.completed_at ? 'Reopen' : 'Mark done'}
                disabled={busy === task.id}
                onClick={() => finish(task)}
              >
                {task.completed_at && <Icon name="check" />}
              </button>

              <span className="v2-task-what">
                <b>{task.title}</b>
                <span>
                  <Icon name={ICON[task.type] as never} />
                  {when(task.due_at, late)}
                  {task.full_name && ` · ${task.full_name}`}
                  {task.project_name && ` · ${task.project_name}`}
                  {task.assignee_name && scopeNote(task.assignee_name)}
                </span>
                {task.notes && <span className="v2-task-note">{task.notes}</span>}
              </span>

              {task.priority === 'urgent' && <span className="d-chip d-red">Urgent</span>}
              {task.opportunity_id && (
                <Link className="d-btn d-xs" to={`/v2/leads/${task.opportunity_id}`}>Open lead</Link>
              )}
              {task.phone_e164 && (
                <a className="d-btn d-xs" href={`tel:${task.phone_e164}`} aria-label="Call">
                  <Icon name="phone" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewTask({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<Task['type']>('call');
  const [due, setDue] = useState(() => {
    const at = new Date(Date.now() + 3_600_000);
    at.setMinutes(0, 0, 0);
    return toLocalInput(at);
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) { setProblem('Give it a name.'); return; }
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/tasks', {
        title: title.trim(), type, dueAt: new Date(due).toISOString(),
      });
      onDone();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="d-card v2-newtask">
      <label className="v2-field v2-field-wide">
        <span>What is it?</span>
        <input className="d-input" value={title} autoFocus placeholder="Call Marco about the payment plan"
          onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="v2-two">
        <label className="v2-field v2-field-wide">
          <span>When</span>
          <input className="d-input" type="datetime-local" value={due} min={toLocalInput(new Date())}
            onChange={(e) => setDue(e.target.value)} />
        </label>
        <label className="v2-field v2-field-wide">
          <span>Kind</span>
          <select className="d-input" value={type} onChange={(e) => setType(e.target.value as Task['type'])}>
            <option value="call">Call</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="meeting">Meeting</option>
            <option value="other">Something else</option>
          </select>
        </label>
      </div>
      {problem && <p className="v2-problem">{problem}</p>}
      <button type="button" className="d-btn d-primary" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Add it'}
      </button>
    </section>
  );
}

function scopeNote(name: string): string {
  return ` · ${name}`;
}

/** "Late since 11:00", "Today 15:30", "Thu 14 · 10:00". */
function when(at: string, late: boolean): string {
  const due = new Date(at);
  const clock = due.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay = due.toDateString() === new Date().toDateString();
  if (late) return `Late since ${clock}${sameDay ? '' : ` ${due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}`;
  if (sameDay) return `Today ${clock}`;
  return `${due.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · ${clock}`;
}

/** Local wall-clock text for a `datetime-local`, never a UTC ISO string. */
function toLocalInput(when_: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when_.getFullYear()}-${pad(when_.getMonth() + 1)}-${pad(when_.getDate())}`
    + `T${pad(when_.getHours())}:${pad(when_.getMinutes())}`;
}
