import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Spinner, ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';
import { useCheckIn } from './check-in.js';

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

/** §4 of `docs/v2/phone-shell.md`: under this, the phone layout. */
const PHONE = 768;

/**
 * Whether this is a phone, in the component and not only in CSS.
 *
 * Two things here are a different shape rather than a narrower one: the week
 * strip, which `Tasks.dc.html` draws as five days with an arrow either side,
 * and the follow-up list, which the design draws as cards and the build as a
 * seven-column table — 779px of it, which pushed the whole document to 803px
 * and made the page itself scroll sideways.
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

/** The four answers `FollowUps.dc.html` gives when a promise is marked Done. */
const FU_ANSWERS = [
  { key: 'spoke', label: 'Spoke · all done', after: 'Done · nothing else needed.' },
  {
    key: 'no_answer',
    label: 'No answer · try again tomorrow',
    after: 'Moved to tomorrow, same time.',
  },
  {
    key: 'meeting',
    label: 'Booked a meeting',
    after: 'Done · open the lead to set the day and time.',
  },
  {
    key: 'not_interested',
    label: 'Not interested',
    after: 'Done · open the lead to mark Lost with a reason.',
  },
] as const;

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
  const [editing, setEditing] = useState<Task | null>(null);
  const [menu, setMenu] = useState<Task | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const phone = useIsPhone();
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

  /*
   * §1.4: the live count under the title, and the screen's one round action.
   * `Tasks.dc.html` says "3 left today · 1 overdue"; `FollowUps.dc.html`
   * says "Promises you made to clients". The + means **Add task** here —
   * before this it meant Add lead, which is the shell's fallback.
   */
  const todayLeft = (byDay.get(dayKey(new Date())) ?? []).filter((t) => !t.completed_at).length;
  usePhoneHead(panel === 'follow-ups'
    ? { sub: 'Promises you made to clients' }
    : {
      sub: `${todayLeft} left today · ${
        overdue.length === 0 ? 'nothing overdue' : `${overdue.length} overdue`}`,
      action: { icon: 'plus', label: 'Add task', onClick: () => setAdding(true) },
    });

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
            {/* `Tasks.dc.html` draws **five** days — Mon to Fri of the week
                being looked at — with an arrow either side. Seven cards at
                390px is 28px of padding each before a single word. */}
            {(phone ? week.slice(0, 5) : week).map((date) => {
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
                  {/* The ⋯ every row carries in `Tasks.dc.html`, and the
                      three things behind it: change it, move it one day
                      later, delete it. */}
                  <button
                    type="button"
                    className="d-btn d-xs d-icon d-ghost v2-b-more"
                    aria-label={`More for ${task.title}`}
                    onClick={() => setMenu(task)}
                  >
                    <Icon name="more-horizontal" />
                  </button>
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
          onMoved={() => { open.reload(); done.reload(); }}
          scope={scope}
          phone={phone}
        />
      )}

      {adding && (
        <NewTask
          day={day}
          onClose={() => setAdding(false)}
          onMade={() => { setAdding(false); open.reload(); toast('Task added'); }}
        />
      )}

      {editing && (
        <NewTask
          day={day}
          task={editing}
          onClose={() => setEditing(null)}
          onMade={() => { setEditing(null); open.reload(); done.reload(); toast('Saved'); }}
        />
      )}

      {menu && (
        <RowMenu
          task={menu}
          onClose={() => setMenu(null)}
          onEdit={() => { setEditing(menu); setMenu(null); }}
          onDone={(said) => {
            setMenu(null);
            open.reload();
            done.reload();
            toast(said);
          }}
        />
      )}
    </div>
  );
}

/* ── the ⋯ on a row ────────────────────────────────────────────────────── */

/**
 * Change it, move it one day later, delete it.
 *
 * `Tasks.dc.html` puts all three behind a ⋯ on every row, and the delete is
 * two-step rather than a confirm dialog — the label becomes "Tap again to
 * delete". `docs/v2/phone-shell.md` §6: "Two-step destructive actions, never
 * a confirm dialog."
 */
function RowMenu({
  task, onClose, onEdit, onDone,
}: {
  task: Task;
  onClose: () => void;
  onEdit: () => void;
  onDone: (said: string) => void;
}) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function moveADay() {
    setBusy(true);
    try {
      const to = new Date(new Date(task.due_at).getTime() + 86_400_000);
      await api.patch(`/api/tasks/${task.id}`, { dueAt: to.toISOString() });
      onDone(`Moved to ${to.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, same time`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
      setBusy(false);
    }
  }

  async function remove() {
    if (!sure) { setSure(true); return; }
    setBusy(true);
    try {
      await api.del(`/api/tasks/${task.id}`);
      onDone('Deleted');
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
      setBusy(false);
    }
  }

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label={task.title}>
        <div className="d-panel-head">
          <h2 className="d-truncate">{task.title}</h2>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="d-panel-body d-col d-gap-8">
          <button type="button" className="d-opt" onClick={onEdit}>
            <Icon name="pencil" />
            <span className="d-grow">Change the text, day or time</span>
          </button>
          <button type="button" className="d-opt" disabled={busy} onClick={moveADay}>
            <Icon name="calendar-days" />
            <span className="d-grow">Move one day later</span>
          </button>
          <button type="button" className="d-opt d-danger" disabled={busy} onClick={remove}>
            <Icon name="trash-2" />
            <span className="d-grow">{sure ? 'Tap again to delete' : 'Delete'}</span>
          </button>
          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>
      </aside>
    </>
  );
}

/* ── the follow-ups tab ────────────────────────────────────────────────── */

function FollowUps({
  items, overdue, busy, onFinish, onMoved, scope, phone,
}: {
  items: Task[];
  overdue: Task[];
  busy: string | null;
  onFinish: (task: Task) => void;
  onMoved: () => void;
  scope: string;
  phone: boolean;
}) {
  const [when, setWhen] = useState<'overdue' | 'today' | 'tomorrow' | 'week'>('overdue');
  const [asking, setAsking] = useState<Task | null>(null);
  /* The sheet only: the amber "you are not checked in" strip belongs at the
     top of a page, and this is a tab inside one. */
  const gate = useCheckIn({ strip: false });
  const toast = useToast();

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
      ) : phone ? (
        /*
         * `FollowUps.dc.html` has no table. Each promise is a card: the time
         * in red when it is overdue, the name, what was promised, the
         * project, a round call button — then Done and "Move to tomorrow"
         * under it. The table this replaces was 779px wide inside a 358px
         * wrapper whose `overflow-x` was `visible`, so the document itself
         * scrolled sideways, carrying the floating bar with it.
         */
        <div className="v2-b-fu">
          {showing.map((task) => {
            const due = new Date(task.due_at);
            const late = due.getTime() < Date.now();
            return (
              <div className="v2-b-fu-row" key={task.id}>
                <div className="v2-b-fu-top">
                  <span className={late ? 'v2-b-fu-when v2-b-fu-late' : 'v2-b-fu-when'}>
                    {clock(due)}
                  </span>
                  <Link
                    className="v2-b-fu-who"
                    to={task.opportunity_id ? `/v2/leads/${task.opportunity_id}` : '/v2/leads'}
                  >
                    <b>{task.full_name ?? 'A lead'}</b>
                    <span>{task.title}</span>
                    {task.project_name && <small>{task.project_name}</small>}
                  </Link>
                  {task.phone_e164 && (
                    <button
                      type="button"
                      className="d-btn d-icon"
                      aria-label={`Call ${task.full_name ?? 'this lead'}`}
                      onClick={() => {
                        void gate.ask().then((answer) => {
                          if (answer === 'cancel') return;
                          window.location.href = `tel:${task.phone_e164}`;
                        });
                      }}
                    >
                      <Icon name="phone" />
                    </button>
                  )}
                </div>
                <div className="v2-b-fu-btns">
                  <button
                    type="button"
                    className="d-btn d-sm"
                    disabled={busy === task.id}
                    onClick={() => setAsking(task)}
                  >
                    Done
                  </button>
                  <button
                    type="button"
                    className="d-btn d-sm d-ghost"
                    disabled={busy === task.id}
                    onClick={() => void moveOne(task)}
                  >
                    Move to tomorrow
                  </button>
                </div>
              </div>
            );
          })}
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

      {gate.banner}

      {/*
        * "What happened with {name}?" — the four answers `FollowUps.dc.html`
        * gives, each writing a different follow-on line. Three of them finish
        * the promise; "No answer" moves it to tomorrow instead, because a
        * promise nobody answered is not a promise kept.
        */}
      {asking && (
        <>
          <div className="v2-panel-back" onClick={() => setAsking(null)} aria-hidden />
          <aside className="d-panel d-open" aria-label="What happened?">
            <div className="d-panel-head">
              <h2>What happened with {asking.full_name ?? 'this lead'}?</h2>
              <button
                type="button"
                className="d-btn d-icon d-sm d-ghost"
                aria-label="Close"
                onClick={() => setAsking(null)}
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="d-panel-body d-col d-gap-8">
              {FU_ANSWERS.map((one) => (
                <button
                  key={one.key}
                  type="button"
                  className="d-opt"
                  onClick={() => {
                    const task = asking;
                    setAsking(null);
                    if (one.key === 'no_answer') void moveOne(task, one.after);
                    else { onFinish(task); toast(one.after); }
                  }}
                >
                  <span className="d-grow">{one.label}</span>
                  <Icon name="chevron-right" />
                </button>
              ))}
            </div>
          </aside>
        </>
      )}
    </>
  );

  /** "Move to tomorrow, same time" — the design's second button on a row. */
  async function moveOne(task: Task, said?: string) {
    try {
      const to = new Date(new Date(task.due_at).getTime() + 86_400_000);
      await api.patch(`/api/tasks/${task.id}`, { dueAt: to.toISOString() });
      onMoved();
      toast(said ?? `${task.full_name ?? 'The lead'} moved to tomorrow, same time`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    }
  }
}

/* ── making one ────────────────────────────────────────────────────────── */

function NewTask({
  day, task, onClose, onMade,
}: { day: string; task?: Task; onClose: () => void; onMade: () => void }) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [type, setType] = useState<Task['type']>(task?.type ?? 'call');
  const [on, setOn] = useState(task ? dayKey(new Date(task.due_at)) : day);
  const [at, setAt] = useState(task ? clock(new Date(task.due_at)) : '10:00');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  /* The design's own refusals, in its own words. The build checked only that
     the title was two characters long. */
  const why = title.trim().length < 2 ? 'Write what must be done.'
    : on.length !== 10 ? 'Pick a day.'
      : at.length < 4 ? 'Pick the time.'
        : !task && new Date(`${on}T${at}:00`).getTime() < Date.now() - 60_000
          ? 'This day is in the past. Pick today or later.'
          : null;

  async function save() {
    setTouched(true);
    if (why) return;
    setBusy(true);
    setProblem(null);
    try {
      const body = {
        title: title.trim(),
        type,
        /* Built in the reader's own timezone: a task at 10:00 is 10:00 where
           the person setting it is standing. */
        dueAt: new Date(`${on}T${at}:00`).toISOString(),
      };
      if (task) await api.patch(`/api/tasks/${task.id}`, body);
      else await api.post('/api/tasks', body);
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
      <aside className="d-panel d-open" aria-label={task ? 'Change the task' : 'New task'}>
        <div className="d-panel-head">
          <h2>{task ? 'Change the task' : 'New task'}</h2>
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
            {touched && why && <span className="v2-field-error">{why}</span>}
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
            {busy ? 'Saving…' : task ? 'Save changes' : 'Add the task'}
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
