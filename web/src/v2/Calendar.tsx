import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';

/**
 * The calendar.
 *
 * Built from `design/web/calendar.html`: Month, Week and Day across the top
 * with the date controls and the legend, the grid on the left, and a side
 * column carrying "How did it go?" and the chosen day's plans.
 *
 * Tasks and meetings are one grid, because a day with a viewing at four and a
 * call at five is one day to the person living it.
 *
 * The window sent to the server is a pair of real instants covering the whole
 * visible grid in the reader's own timezone — not two dates. A meeting at
 * 23:30 belongs to the day it is 23:30 in for whoever is looking, and only
 * the browser knows which day that is.
 */

interface Task {
  id: string;
  type: string;
  title: string;
  due_at: string;
  completed_at: string | null;
  opportunity_id: string | null;
  full_name: string | null;
}

interface Meeting {
  id: string;
  opportunityId: string | null;
  kind: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  place: string | null;
  result: string | null;
  who: string | null;
  phone: string | null;
  agent: string;
}

interface Window_ { tasks: Task[]; meetings: Meeting[] }

type View = 'month' | 'week' | 'day';

/** One plan on the grid: a meeting or a task, flattened so they sort together. */
interface Plan {
  id: string;
  kind: 'meeting' | 'visit' | 'call' | 'follow' | 'team';
  title: string;
  sub: string | null;
  at: Date;
  until: Date;
  allDay: boolean;
  done: boolean;
  late: boolean;
  /** A meeting that happened and has no answer yet. */
  needsResult: boolean;
  leadId: string | null;
  meeting: Meeting | null;
}

const LEGEND: Array<{ kind: Plan['kind']; label: string; dot: string }> = [
  { kind: 'meeting', label: 'Meeting', dot: 'v2-dot-accent' },
  { kind: 'visit', label: 'Site visit', dot: 'd-green' },
  { kind: 'call', label: 'Call', dot: 'd-blue' },
  { kind: 'follow', label: 'Follow-up', dot: 'd-amber' },
  { kind: 'team', label: 'Team', dot: 'd-violet' },
];

const RESULTS = [
  { value: 'showed', label: 'They came', icon: 'check' },
  { value: 'booked', label: 'They booked', icon: 'badge-check' },
  { value: 'no_show', label: 'They did not come', icon: 'user-x' },
  { value: 'rescheduled', label: 'Moved it', icon: 'calendar-days' },
  { value: 'cancelled', label: 'Cancelled', icon: 'x' },
] as const;

/** 07:00 to 22:00, which is the window anything in this office happens in. */
const DAY_FROM = 7;
const DAY_TO = 22;
const HOUR_PX = 46;

export function V2Calendar() {
  /* §1.4: this screen's one round action in the shell's header. */
  usePhoneHead({ action: { icon: 'plus', label: 'Add event', to: '/v2/calendar?new=1' } });
  const { user } = useAuth();
  const canSeeTeam = user?.role !== 'agent';

  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [picked, setPicked] = useState(() => dayKey(new Date()));
  const [open, setOpen] = useState<Plan | null>(null);
  const toast = useToast();

  /* The visible window, whole weeks for the month and whole days otherwise. */
  const days = useMemo(() => {
    if (view === 'day') return [anchor];
    if (view === 'week') return weekOf(anchor);
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_unused, i) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [view, anchor]);

  const from = days[0] as Date;
  const to = new Date((days[days.length - 1] as Date).getTime() + 86_400_000);

  const got = useAsync<Window_>(
    () => api.get(`/api/v2/calendar?from=${from.toISOString()}&to=${to.toISOString()}&scope=${scope}`),
    [from.toISOString(), to.toISOString(), scope],
  );

  const plans = useMemo(() => toPlans(got.data), [got.data]);

  const byDay = useMemo(() => {
    const map = new Map<string, Plan[]>();
    for (const plan of plans) {
      const key = dayKey(plan.at);
      if (!map.has(key)) map.set(key, []);
      (map.get(key) as Plan[]).push(plan);
    }
    for (const list of map.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
    return map;
  }, [plans]);

  /* Meetings that have happened and nobody has said how they went. The design
     puts this at the top of the side column, in accent, with a deadline. */
  const waiting = useMemo(
    () => plans.filter((plan) => plan.needsResult).sort((a, b) => a.at.getTime() - b.at.getTime()),
    [plans],
  );

  const chosen = byDay.get(picked) ?? [];
  const title = view === 'month'
    ? anchor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : view === 'week'
      ? `${(days[0] as Date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${(days[6] as Date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
      : anchor.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  function move(by: number) {
    setAnchor((was) => {
      if (view === 'month') return new Date(was.getFullYear(), was.getMonth() + by, 1);
      const step = view === 'week' ? 7 : 1;
      return new Date(was.getFullYear(), was.getMonth(), was.getDate() + by * step);
    });
  }

  return (
    <div className="v2-cal p-calendar">
      <div className="d-cal-top">
        <div className="d-seg" role="group" aria-label="How much to show">
          {(['month', 'week', 'day'] as View[]).map((one) => (
            <button
              key={one}
              type="button"
              className={view === one ? 'd-on' : undefined}
              onClick={() => {
                setView(one);
                /* Moving to a day view should land on the day being looked
                   at, not on whatever month the anchor happened to be. */
                if (one !== 'month') setAnchor(startOfDay(new Date(picked)));
              }}
            >
              {one === 'month' ? 'Month' : one === 'week' ? 'Week' : 'Day'}
            </button>
          ))}
        </div>

        <button type="button" className="d-btn d-icon d-sm" aria-label="Earlier" onClick={() => move(-1)}>
          <Icon name="chevron-left" />
        </button>
        <button type="button" className="d-btn d-icon d-sm" aria-label="Later" onClick={() => move(1)}>
          <Icon name="chevron-right" />
        </button>
        <button
          type="button"
          className="d-btn d-sm"
          onClick={() => {
            const now = startOfDay(new Date());
            setAnchor(view === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : now);
            setPicked(dayKey(now));
          }}
        >
          Today
        </button>
        <h2>{title}</h2>

        <div className="d-legend">
          {LEGEND.map((one) => (
            <span key={one.kind}>
              <span className={`d-dot ${one.dot}`} />{one.label}
            </span>
          ))}
        </div>

        <span className="d-grow" />

        {canSeeTeam && (
          <div className="d-seg d-sm" role="group" aria-label="Whose plans">
            <button type="button" className={scope === 'mine' ? 'd-on' : undefined} onClick={() => setScope('mine')}>
              Mine
            </button>
            <button type="button" className={scope === 'team' ? 'd-on' : undefined} onClick={() => setScope('team')}>
              Everyone
            </button>
          </div>
        )}
        <Link className="d-btn d-primary" to="/v2/tasks?new=1">
          <Icon name="plus" />New plan
        </Link>
      </div>

      {got.error && <ErrorNote>{got.error}</ErrorNote>}
      {!got.data && !got.error && <Spinner />}

      {got.data && (
        <div className="d-cal-layout">
          <div>
            {view === 'month' && (
              <MonthGrid
                days={days}
                anchor={anchor}
                byDay={byDay}
                picked={picked}
                onPick={setPicked}
                onOpen={setOpen}
              />
            )}
            {view !== 'month' && (
              <TimeGrid
                days={days}
                byDay={byDay}
                picked={picked}
                onPick={setPicked}
                onOpen={setOpen}
                dayView={view === 'day'}
              />
            )}
          </div>

          <aside className="d-side">
            {waiting.length > 0 && (
              <section className="d-card d-wait-card">
                <div className="d-card-head d-mb-0">
                  <h3>How did it go?</h3>
                  <span className="d-chip d-orange">Answer before 21:00</span>
                </div>
                <div className="d-col d-gap-8 d-mt-12">
                  {waiting.slice(0, 4).map((plan) => (
                    <button
                      type="button"
                      className="d-plan-row"
                      key={plan.id}
                      onClick={() => setOpen(plan)}
                    >
                      <span className="d-tm">{clock(plan.at)}</span>
                      <span className="d-bd">
                        <b>{plan.title}</b>
                        <span>{plan.sub ?? 'Say what happened'}</span>
                      </span>
                      <Icon name="chevron-right" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="d-card">
              <div className="d-card-head d-mb-8">
                <h3>{new Date(picked).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</h3>
                {picked === dayKey(new Date()) && <span className="d-chip">Today</span>}
              </div>

              {chosen.length >= 5 && (
                <div className="d-banner d-amber d-small v2-cal-busy">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">{chosen.length} plans on one day. That is a lot.</span>
                </div>
              )}

              {chosen.length === 0 && (
                <p className="d-small d-muted">Nothing planned. A quiet day.</p>
              )}

              {chosen.map((plan) => (
                <button
                  type="button"
                  className={plan.done ? 'd-plan-row d-is-done' : 'd-plan-row'}
                  key={plan.id}
                  onClick={() => setOpen(plan)}
                >
                  <span className="d-tm">{plan.allDay ? 'All' : clock(plan.at)}</span>
                  <span className={`d-tdot d-${plan.kind}`} />
                  <span className="d-bd">
                    <b>{plan.title}</b>
                    <span>{plan.sub ?? ''}</span>
                  </span>
                </button>
              ))}

              <div className="d-card-foot v2-cal-foot">
                <Link className="d-btn d-sm d-block" to={`/v2/tasks?new=1&on=${picked}`}>
                  <Icon name="plus" />Add a plan on this day
                </Link>
              </div>
            </section>
          </aside>
        </div>
      )}

      {open && (
        <PlanPanel
          plan={open}
          onClose={() => setOpen(null)}
          onSaved={() => { setOpen(null); got.reload(); toast('Saved'); }}
        />
      )}
    </div>
  );
}

/* ── month ─────────────────────────────────────────────────────────────── */

function MonthGrid({
  days, anchor, byDay, picked, onPick, onOpen,
}: {
  days: Date[];
  anchor: Date;
  byDay: Map<string, Plan[]>;
  picked: string;
  onPick: (key: string) => void;
  onOpen: (plan: Plan) => void;
}) {
  const today = dayKey(new Date());
  /* One seven-column grid holding the day names and then the days, which is
     how `ui.css` builds it: the heading cells are part of the same grid. */
  return (
    <div className="d-cal">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
        <div className="d-cal-head" key={d}>{d}</div>
      ))}
      {days.map((day) => {
          const key = dayKey(day);
          const plans = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              className={[
                'd-cal-day',
                day.getMonth() === anchor.getMonth() ? '' : 'd-muted',
                day.getDay() === 0 ? 'd-off' : '',
                key === today ? 'd-today' : '',
                key === picked ? 'd-sel' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => onPick(key)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onPick(key); }}
            >
              <span className="d-cal-num">{day.getDate()}</span>
              {plans.slice(0, 3).map((plan) => (
                <span
                  key={plan.id}
                  role="button"
                  tabIndex={0}
                  className={[
                    'd-cal-ev', `d-${plan.kind}`,
                    plan.done ? 'd-is-done' : '',
                    plan.late ? 'd-late' : '',
                    plan.needsResult ? 'd-need' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={(e) => { e.stopPropagation(); onOpen(plan); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpen(plan); } }}
                >
                  {plan.allDay ? plan.title : `${clock(plan.at)} ${plan.title}`}
                </span>
              ))}
              {plans.length > 3 && (
                <span className="d-cal-ev v2-cal-more">+{plans.length - 3} more</span>
              )}
            </div>
          );
      })}
    </div>
  );
}

/* ── week and day ──────────────────────────────────────────────────────── */

function TimeGrid({
  days, byDay, picked, onPick, onOpen, dayView,
}: {
  days: Date[];
  byDay: Map<string, Plan[]>;
  picked: string;
  onPick: (key: string) => void;
  onOpen: (plan: Plan) => void;
  dayView: boolean;
}) {
  const today = dayKey(new Date());
  const hours = Array.from({ length: DAY_TO - DAY_FROM }, (_unused, i) => DAY_FROM + i);
  const now = new Date();
  const nowTop = (now.getHours() + now.getMinutes() / 60 - DAY_FROM) * HOUR_PX;
  const showNow = now.getHours() >= DAY_FROM && now.getHours() < DAY_TO
    && days.some((day) => dayKey(day) === today);

  return (
    <div className={dayView ? 'd-wk d-day-view' : 'd-wk'}>
      <div className="d-wk-row d-wk-head" style={{ '--n': days.length } as React.CSSProperties}>
        <div />
        {days.map((day) => {
          const key = dayKey(day);
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              className={[key === today ? 'd-today' : '', key === picked ? 'd-sel' : ''].filter(Boolean).join(' ')}
              onClick={() => onPick(key)}
              onKeyDown={(e) => { if (e.key === 'Enter') onPick(key); }}
            >
              {day.toLocaleDateString('en-GB', { weekday: 'short' })}
              <b>{day.getDate()}</b>
            </div>
          );
        })}
      </div>

      {/* All-day plans get their own band, so they do not sit at midnight. */}
      <div className="d-wk-row d-wk-all" style={{ '--n': days.length } as React.CSSProperties}>
        <div />
        {days.map((day) => (
          <div key={dayKey(day)}>
            {(byDay.get(dayKey(day)) ?? []).filter((plan) => plan.allDay).map((plan) => (
              <span
                key={plan.id}
                role="button"
                tabIndex={0}
                className={`d-cal-ev d-band d-${plan.kind}`}
                onClick={() => onOpen(plan)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpen(plan); }}
              >
                {plan.title}
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="d-wk-row d-wk-body" style={{ '--n': days.length } as React.CSSProperties}>
        <div className="d-wk-hours">
          {hours.map((h) => <span key={h}>{String(h).padStart(2, '0')}:00</span>)}
        </div>
        {days.map((day) => {
          const key = dayKey(day);
          const timed = (byDay.get(key) ?? []).filter((plan) => !plan.allDay);
          return (
            <div
              key={key}
              className={day.getDay() === 0 ? 'd-wk-col d-off' : 'd-wk-col'}
              role="button"
              tabIndex={-1}
              onClick={() => onPick(key)}
            >
              {timed.map((plan) => {
                const top = (plan.at.getHours() + plan.at.getMinutes() / 60 - DAY_FROM) * HOUR_PX;
                const mins = Math.max(30, (plan.until.getTime() - plan.at.getTime()) / 60_000);
                return (
                  <span
                    key={plan.id}
                    role="button"
                    tabIndex={0}
                    className={[
                      'd-wk-ev', `d-${plan.kind}`,
                      plan.done ? 'd-is-done' : '',
                      plan.needsResult ? 'd-need' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ top: Math.max(0, top), height: (mins / 60) * HOUR_PX - 2 }}
                    onClick={(e) => { e.stopPropagation(); onOpen(plan); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpen(plan); } }}
                  >
                    {plan.title}
                    <span>{clock(plan.at)}{plan.sub ? ` · ${plan.sub}` : ''}</span>
                  </span>
                );
              })}
              {showNow && key === today && (
                <span className="d-wk-now" style={{ top: nowTop }}><span>{clock(now)}</span></span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── one plan ──────────────────────────────────────────────────────────── */

function PlanPanel({
  plan, onClose, onSaved,
}: { plan: Plan; onClose: () => void; onSaved: () => void }) {
  const [result, setResult] = useState<string | null>(plan.meeting?.result ?? null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /* Escape closes it, which is what everyone tries. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    if (!plan.meeting || !result) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.patch(`/api/v2/meetings/${plan.meeting.id}/result`, { result });
      onSaved();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="Plan">
        <div className="d-panel-head">
          <h2>{plan.title}</h2>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          <div>
            <div className="d-plan-time">{plan.allDay ? 'All day' : clock(plan.at)}</div>
            <p className="d-muted">
              {plan.at.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              {plan.allDay ? '' : ` · until ${clock(plan.until)}`}
            </p>
          </div>

          {plan.sub && <div className="d-msg-box">{plan.sub}</div>}

          {plan.meeting?.place && (
            <div className="d-row d-gap-8">
              <Icon name="map-pin" />
              <span className="d-grow">{plan.meeting.place}</span>
            </div>
          )}

          {plan.needsResult && (
            <div className="d-field">
              <span className="d-field-label">How did it go?</span>
              <div className="d-res-grid">
                {RESULTS.map((one) => (
                  <button
                    key={one.value}
                    type="button"
                    className={result === one.value ? 'd-opt d-on' : 'd-opt'}
                    onClick={() => setResult(one.value)}
                  >
                    <Icon name={one.icon} />
                    <span className="d-grow">{one.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        <div className="d-panel-foot">
          {plan.leadId && (
            <Link className="d-btn" to={`/v2/leads/${plan.leadId}`}>Open the lead</Link>
          )}
          <span className="d-grow" />
          {plan.needsResult && (
            <button type="button" className="d-btn d-primary" disabled={!result || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

/* ── turning what the server sends into plans ──────────────────────────── */

function toPlans(data: Window_ | null): Plan[] {
  if (!data) return [];
  const now = Date.now();
  const out: Plan[] = [];

  for (const meeting of data.meetings) {
    const at = new Date(meeting.startsAt);
    const until = new Date(meeting.endsAt);
    out.push({
      id: `m-${meeting.id}`,
      kind: meeting.kind === 'site_visit' ? 'visit' : meeting.kind === 'team' ? 'team' : 'meeting',
      title: meeting.who ?? meeting.title ?? 'Meeting',
      sub: meeting.title && meeting.who ? meeting.title : meeting.place,
      at,
      until,
      allDay: Boolean(meeting.allDay),
      done: Boolean(meeting.result),
      late: false,
      /* It has finished and nobody has said what happened. This is the one
         thing on the screen that asks something of the person reading it. */
      needsResult: !meeting.result && until.getTime() < now,
      leadId: meeting.opportunityId,
      meeting,
    });
  }

  for (const task of data.tasks) {
    const at = new Date(task.due_at);
    out.push({
      id: `t-${task.id}`,
      kind: task.type === 'call' ? 'call' : 'follow',
      title: task.title,
      sub: task.full_name,
      at,
      until: new Date(at.getTime() + 30 * 60_000),
      allDay: false,
      done: Boolean(task.completed_at),
      late: !task.completed_at && at.getTime() < now,
      needsResult: false,
      leadId: task.opportunity_id,
      meeting: null,
    });
  }

  return out;
}

/* ── dates ─────────────────────────────────────────────────────────────── */

function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

function dayKey(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

function weekOf(at: Date): Date[] {
  const monday = new Date(at);
  monday.setDate(at.getDate() - ((at.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_unused, i) =>
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

function clock(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
