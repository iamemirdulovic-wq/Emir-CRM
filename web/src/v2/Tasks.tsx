import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Spinner, ErrorNote, useToast } from '../design/ui.js';

/**
 * Tasks and follow-ups.
 *
 * Built from `design/web/tasks.html`: two tabs at the top, a strip of the
 * week under them, and then the day's list beside a card that says how much
 * of it is left.
 *
 * The split between the two tabs is the design's and it is a real one. A
 * **task** is something the agent has to do — send a floor plan, book a car.
 * A **follow-up** is a promise made to a client, so it belongs to the lead
 * and being late with one is a different kind of late. They are the same rows
 * in the database and two different screens, because they are two different
 * feelings.
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

const TYPES: Array<{ value: Task['type']; label: string; icon: IconName }> = [
  { value: 'call', label: 'Call', icon: 'phone' },
  { value: 'whatsapp', label: 'WhatsApp', icon: 'message-circle' },
  { value: 'meeting', label: 'Meeting', icon: 'calendar-days' },
  { value: 'other', label: 'Other', icon: 'check-check' },
];

const ICON: Record<Task['type'], IconName> = {
  call: 'phone', whatsapp: 'message-circle', email: 'mail',
  meeting: 'calendar-days', other: 'check-check',
};

export function V2Tasks() {
  const { user } = useAuth();
  const canSeeTeam = user?.role !== 'agent';

  /*
   * Which tab is open lives in the address, not in a useState.
   *
   * The sidebar's Follow-ups row is this page's second tab, as the design has
   * it (`tasks.html#follow-ups`), so it arrives as `?tab=follow-ups`. Keeping
   * the tab in the address is what makes the sidebar able to light the right
   * row of the two, and it means a follow-up list can be sent to somebody as
   * a link.
   */
  const [query, setQuery] = useSearchParams();
  const panel: 'tasks' | 'follow-ups' = query.get('tab') === 'follow-ups' ? 'follow-ups' : 'tasks';
  const setPanel = (next: 'tasks' | 'follow-ups') => {
    const q = new URLSearchParams(query);
    if (next === 'tasks') q.delete('tab');
    else q.set('tab', 'follow-ups');
    setQuery(q, { replace: true });
  };
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [state, setState] = useState<'todo' | 'done'>('todo');
  const [weekAt, setWeekAt] = useState(() => new Date());
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  /* Everything open, in one request. The week strip, the day's list and the
     "left today" card are three readings of the same rows, and three
     requests would let them disagree with each other on screen. */
  const open = useAsync<Answer>(
    () => api.get(`/api/tasks?filter=open&scope=${scope}`),
    [scope],
  );
  const done = useAsync<Answer>(
    () => api.get(`/api/tasks?filter=done&scope=${scope}`),
    [scope],
  );

  const week = useMemo(() => {
    const monday = new Date(weekAt);
    monday.setDate(weekAt.getDate() - ((weekAt.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_unused, i) =>
      new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  }, [weekAt]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of [...(open.data?.items ?? []), ...(done.data?.items ?? [])]) {
      const key = dayKey(new Date(task.due_at));
      if (!map.has(key)) map.set(key, []);
      (map.get(key) as Task[]).push(task);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
    }
    return map;
  }, [open.data, done.data]);

  const chosen = byDay.get(day) ?? [];
  const todo = chosen.filter((task) => !task.completed_at);
  const finished = chosen.filter((task) => task.completed_at);
  const showing = state === 'todo' ? todo : finished;

  /* A follow-up is a task against a lead. Everything else is the agent's own. */
  const followUps = useMemo(
    () => (open.data?.items ?? []).filter((task) => task.opportunity_id),
    [open.data],
  );
  const overdue = followUps.filter((task) => new Date(task.due_at).getTime() < Date.now());

  const next = todo.find((task) => new Date(task.due_at).getTime() >= Date.now()) ?? todo[0];

  async function finish(task: Task) {
    setBusy(task.id);
    try {
      await api.post(`/api/tasks/${task.id}/${task.completed_at ? 'reopen' : 'complete'}`, {});
      open.reload();
      done.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  if (open.error) return <ErrorNote>{open.error}</ErrorNote>;
  if (!open.data) return <Spinner />;

  return (
    <div className="v2-tasks p-tasks">
      <div className="d-tabs d-top-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={panel === 'tasks'}
          className={panel === 'tasks' ? 'd-tab d-on' : 'd-tab'}
          onClick={() => setPanel('tasks')}
        >
          Tasks <span className="d-count">{open.data.counts.open}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === 'follow-ups'}
          className={panel === 'follow-ups' ? 'd-tab d-on' : 'd-tab'}
          onClick={() => setPanel('follow-ups')}
        >
          Follow-ups{' '}
          <span className={overdue.length > 0 ? 'd-count d-red' : 'd-count'}>
            {overdue.length > 0 ? overdue.length : followUps.length}
          </span>
        </button>
        <span className="d-grow" />
        {canSeeTeam && (
          <div className="d-seg d-sm" role="group" aria-label="Whose tasks">
            <button type="button" className={scope === 'mine' ? 'd-on' : undefined} onClick={() => setScope('mine')}>
              Mine
            </button>
            <button type="button" className={scope === 'team' ? 'd-on' : undefined} onClick={() => setScope('team')}>
              The team
            </button>
          </div>
        )}
      </div>

      {panel === 'tasks' && (
        <>
          {/* The week, as seven cards. Each says how much is left on it,
              which is what makes it worth looking at rather than a date. */}
          <div className="d-week">
            <div className="d-nav">
              <button
                type="button"
                className="d-btn d-icon d-sm"
                aria-label="The week before"
                onClick={() => setWeekAt((was) => new Date(was.getTime() - 7 * 86_400_000))}
              >
                <Icon name="chevron-left" />
              </button>
              <button
                type="button"
                className="d-btn d-icon d-sm"
                aria-label="The week after"
                onClick={() => setWeekAt((was) => new Date(was.getTime() + 7 * 86_400_000))}
              >
                <Icon name="chevron-right" />
              </button>
            </div>
            {week.map((date) => {
              const key = dayKey(date);
              const all = byDay.get(key) ?? [];
              const left = all.filter((task) => !task.completed_at).length;
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    'd-wd',
                    key === day ? 'd-on' : '',
                    key === dayKey(new Date()) ? 'd-today' : '',
                    date.getDay() === 0 ? 'd-off' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => setDay(key)}
                >
                  <span className="d-dn">{date.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                  <span className="d-dd">{date.getDate()}</span>
                  <span className={left > 0 ? 'd-lf d-has' : 'd-lf'}>
                    {all.length === 0 ? 'Nothing' : left === 0 ? 'All done' : `${left} left`}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="d-lay">
            <section className="d-card">
              <div className="d-card-head">
                <h3 className="v2-task-title">
                  {day === dayKey(new Date()) ? 'Today · ' : ''}
                  {new Date(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                </h3>
                <button type="button" className="d-btn d-sm" onClick={() => setDay(dayKey(new Date()))}>
                  Today
                </button>
                <div className="d-seg d-sm" role="group" aria-label="Done or not">
                  <button type="button" className={state === 'todo' ? 'd-on' : undefined} onClick={() => setState('todo')}>
                    To do <span>{todo.length}</span>
                  </button>
                  <button type="button" className={state === 'done' ? 'd-on' : undefined} onClick={() => setState('done')}>
                    Done <span>{finished.length}</span>
                  </button>
                </div>
                <button type="button" className="d-btn d-primary" onClick={() => setAdding(true)}>
                  <Icon name="plus" />New task
                </button>
              </div>

              {showing.length === 0 && (
                <div className="d-empty">
                  <span className="d-ic"><Icon name="check" /></span>
                  <b>{state === 'todo' ? 'Nothing left on this day' : 'Nothing finished yet'}</b>
                  <p>
                    {state === 'todo'
                      ? 'Add a task, or take a look at another day.'
                      : 'What you finish on this day shows here.'}
                  </p>
                </div>
              )}

              {showing.map((task) => (
                <div className={task.completed_at ? 'd-trow d-done' : 'd-trow'} key={task.id}>
                  <label className="d-check">
                    <input
                      type="checkbox"
                      checked={Boolean(task.completed_at)}
                      disabled={busy === task.id}
                      aria-label={task.completed_at ? `Reopen ${task.title}` : `Finish ${task.title}`}
                      onChange={() => void finish(task)}
                    />
                  </label>
                  <span className="d-tm">{clock(new Date(task.due_at))}</span>
                  <span className="d-ty">
                    <span className="d-chip">
                      <Icon name={ICON[task.type] ?? 'check-check'} />
                      {TYPES.find((one) => one.value === task.type)?.label ?? 'Other'}
                    </span>
                  </span>
                  <span className="d-tx">
                    <b>{task.title}</b>
                    <span>
                      {task.full_name ?? 'No lead'}
                      {task.project_name ? ` · ${task.project_name}` : ''}
                      {scope === 'team' && task.assignee_name ? ` · ${task.assignee_name}` : ''}
                    </span>
                  </span>
                  {task.opportunity_id && (
                    <Link className="d-btn d-xs" to={`/v2/leads/${task.opportunity_id}`}>Open</Link>
                  )}
                </div>
              ))}
            </section>

            <aside className="d-col d-gap-16">
              <section className="d-card d-hero">
                <span className="d-label">
                  {day === dayKey(new Date()) ? 'Left today' : 'Left on this day'}
                </span>
                <div className="d-row d-base d-gap-8 d-mt-4">
                  <b className="d-big-left">{todo.length}</b>
                  <span className="d-muted">of {chosen.length} task{chosen.length === 1 ? '' : 's'}</span>
                </div>
                <div
                  className="d-bar d-accent d-mt-16"
                  style={{ '--v': `${chosen.length === 0 ? 0 : Math.round((finished.length / chosen.length) * 100)}%` } as React.CSSProperties}
                >
                  <i />
                </div>
                <div className="d-card-foot v2-task-next">
                  {next
                    ? `Next: ${clock(new Date(next.due_at))} · ${next.title}`
                    : chosen.length === 0 ? 'Nothing planned on this day' : 'Everything is done.'}
                </div>
              </section>

              <section className="d-card">
                <button
                  type="button"
                  className="d-watch"
                  onClick={() => setPanel('follow-ups')}
                >
                  <span className="d-grow">
                    <b>Follow-ups overdue</b>
                    <span>
                      {overdue[0]
                        ? `${overdue[0].full_name ?? 'A lead'} · since ${clock(new Date(overdue[0].due_at))}`
                        : 'None. Every promise is still in time.'}
                    </span>
                  </span>
                  <b className={overdue.length > 0 ? 'd-n d-red' : 'd-n'}>{overdue.length}</b>
                  <Icon name="chevron-right" />
                </button>
                <Link className="d-watch" to="/v2/calendar">
                  <span className="d-grow">
                    <b>Plans today</b>
                    <span>Meetings, site visits and calls</span>
                  </span>
                  <Icon name="chevron-right" />
                </Link>
              </section>
            </aside>
          </div>
        </>
      )}

      {panel === 'follow-ups' && (
        <FollowUps
          items={followUps}
          overdue={overdue}
          busy={busy}
          onFinish={finish}
          scope={scope}
        />
      )}

      {adding && (
        <NewTask
          day={day}
          onClose={() => setAdding(false)}
          onMade={() => { setAdding(false); open.reload(); toast('Task added'); }}
        />
      )}
    </div>
  );
}

/* ── the follow-ups tab ────────────────────────────────────────────────── */

function FollowUps({
  items, overdue, busy, onFinish, scope,
}: {
  items: Task[];
  overdue: Task[];
  busy: string | null;
  onFinish: (task: Task) => void;
  scope: string;
}) {
  const [when, setWhen] = useState<'overdue' | 'today' | 'tomorrow' | 'week'>('overdue');

  const groups = useMemo(() => {
    const today = dayKey(new Date());
    const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
    const weekEnd = Date.now() + 7 * 86_400_000;
    return {
      overdue,
      today: items.filter((task) => dayKey(new Date(task.due_at)) === today),
      tomorrow: items.filter((task) => dayKey(new Date(task.due_at)) === tomorrow),
      week: items.filter((task) => {
        const at = new Date(task.due_at).getTime();
        return at > Date.now() && at <= weekEnd;
      }),
    };
  }, [items, overdue]);

  const showing = groups[when];

  return (
    <>
      <div className="d-fu-head">
        <div className="d-tabs d-pills" role="tablist">
          {([
            ['overdue', 'Overdue'],
            ['today', 'Today'],
            ['tomorrow', 'Tomorrow'],
            ['week', 'This week'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={when === key}
              className={when === key ? 'd-tab d-on' : 'd-tab'}
              onClick={() => setWhen(key)}
            >
              {label}{' '}
              <span className={key === 'overdue' && groups.overdue.length > 0 ? 'd-count d-red' : 'd-count'}>
                {groups[key].length}
              </span>
            </button>
          ))}
        </div>
        <span className="d-grow" />
        <span className="d-result-count">
          {showing.length} follow-up{showing.length === 1 ? '' : 's'}
        </span>
        {showing.length > 0 && (
          <>
            {/* The same people, as a list of leads rather than of promises.
                `/v2/follow-ups` is that list, and this is the only way in
                now that the sidebar row points at this tab. */}
            <Link className="d-btn d-sm" to="/v2/follow-ups">
              <Icon name="users" />
              <span>See them as leads</span>
            </Link>
            <Link className="d-btn d-primary" to="/v2/calling">
              <Icon name="phone" />
              <span>Call these {showing.length} one by one</span>
            </Link>
          </>
        )}
      </div>

      {showing.length === 0 ? (
        <div className="d-empty">
          <span className="d-ic"><Icon name="check" /></span>
          <b>No follow-ups here</b>
          <p>When you plan a follow-up on a lead it shows here.</p>
          <Link className="d-btn d-sm" to="/v2/leads">Open my leads</Link>
        </div>
      ) : (
        <div className="d-table-wrap">
          <table className="d-table v2-fu-table">
            <thead>
              <tr>
                <th>Lead</th><th>Phone</th><th>What about</th><th>How</th><th>When</th>
                {scope === 'team' && <th>Agent</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {showing.map((task) => {
                const late = new Date(task.due_at).getTime() < Date.now();
                return (
                  <tr key={task.id}>
                    <td className="d-t-main">
                      {task.opportunity_id
                        ? <Link to={`/v2/leads/${task.opportunity_id}`}>{task.full_name ?? 'A lead'}</Link>
                        : task.full_name ?? 'A lead'}
                    </td>
                    <td className="d-t-sub">{task.phone_e164 ?? '—'}</td>
                    <td className="d-t-sub">{task.title}</td>
                    <td>
                      <span className="d-chip">
                        <Icon name={ICON[task.type] ?? 'check-check'} />
                        {TYPES.find((one) => one.value === task.type)?.label ?? 'Other'}
                      </span>
                    </td>
                    <td className={late ? 'd-t-sub d-t-red' : 'd-t-sub'}>{whenWords(new Date(task.due_at))}</td>
                    {scope === 'team' && <td className="d-t-sub">{task.assignee_name ?? '—'}</td>}
                    <td className="d-t-right">
                      <button
                        type="button"
                        className="d-btn d-xs"
                        disabled={busy === task.id}
                        onClick={() => onFinish(task)}
                      >
                        Done
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="d-small d-muted d-mt-12">
        A follow-up not done by the end of its day moves to Overdue. It stays on the lead either
        way, so nothing is forgotten by being late.
      </p>
    </>
  );
}

/* ── making one ────────────────────────────────────────────────────────── */

function NewTask({
  day, onClose, onMade,
}: { day: string; onClose: () => void; onMade: () => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<Task['type']>('call');
  const [on, setOn] = useState(day);
  const [at, setAt] = useState('10:00');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  async function save() {
    setTouched(true);
    if (title.trim().length < 2) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/tasks', {
        title: title.trim(),
        type,
        /* Built in the reader's own timezone: a task at 10:00 is 10:00 where
           the person setting it is standing. */
        dueAt: new Date(`${on}T${at}:00`).toISOString(),
      });
      onMade();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="New task">
        <div className="d-panel-head">
          <h2>New task</h2>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="d-panel-body d-col d-gap-16">
          <p className="d-small d-muted">A task is for you. It shows on My Day on its day.</p>

          <div className="d-field">
            <label>What do you need to do? <span className="d-req">*</span></label>
            <input
              className="d-input"
              value={title}
              aria-label="What do you need to do?"
              placeholder="Send the floor plan to Dave"
              onChange={(e) => setTitle(e.target.value)}
            />
            {touched && title.trim().length < 2 && (
              <span className="v2-field-error">Write what needs doing.</span>
            )}
          </div>

          <div className="d-field">
            <span className="d-field-label">Type</span>
            <div className="d-chips">
              {TYPES.map((one) => (
                <button
                  key={one.value}
                  type="button"
                  className={type === one.value ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => setType(one.value)}
                >
                  {one.label}
                </button>
              ))}
            </div>
          </div>

          <div className="d-two">
            <div className="d-field">
              <label>Day <span className="d-req">*</span></label>
              <input className="d-input" type="date" value={on} aria-label="Day"
                onChange={(e) => setOn(e.target.value)} />
            </div>
            <div className="d-field">
              <label>Time</label>
              <input className="d-input" type="time" value={at} aria-label="Time"
                onChange={(e) => setAt(e.target.value)} />
            </div>
          </div>

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>
        <div className="d-panel-foot">
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
          <span className="d-grow" />
          <button type="button" className="d-btn d-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Add the task'}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ── dates ─────────────────────────────────────────────────────────────── */

function dayKey(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

function clock(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** "since 11:00", "in 2 h", "Tue 09:30" — whichever says most. */
function whenWords(at: Date): string {
  const mins = Math.round((at.getTime() - Date.now()) / 60_000);
  if (mins < 0 && mins > -600) return `since ${clock(at)}`;
  if (mins >= 0 && mins < 60) return `in ${mins} min`;
  if (mins >= 60 && mins < 600) return `in ${Math.round(mins / 60)} h`;
  return `${at.toLocaleDateString('en-GB', { weekday: 'short' })} ${clock(at)}`;
}
