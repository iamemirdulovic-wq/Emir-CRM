import { useMemo, useState } from 'react';
import {
  type CalendarView, dayKey, dayNumber, groupByDay, isToday, monthGrid, periodLabel, step,
  weekDays, weekdayNames,
} from '../lib/calendar.js';
import { clockOf, PRIORITY_COLOUR } from '../lib/tasks.js';
import { locale } from '../lib/i18n.js';
import type { TaskRow } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { Empty, Seg, Spinner } from '../design/ui.js';

/** How many chips fit in a month cell before it collapses to "+3 more". */
const PER_CELL = 3;

/**
 * Tasks on a grid.
 *
 * Month is a real seven-column grid; week and day are a row per day, because a
 * 60px-wide column cannot show a task title and a calendar that shows only
 * coloured slivers is a heat map, not a plan.
 */
export function TaskCalendar({
  view, anchor, tasks, loading, onView, onAnchor, onOpen,
}: {
  view: CalendarView;
  anchor: Date;
  tasks: TaskRow[];
  loading: boolean;
  onView: (next: CalendarView) => void;
  onAnchor: (next: Date) => void;
  onOpen: (task: TaskRow) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const byDay = useMemo(() => groupByDay(tasks, (task) => task.due_at), [tasks]);
  const days = useMemo(
    () => (view === 'month' ? monthGrid(anchor) : view === 'week' ? weekDays(anchor) : [anchor]),
    [view, anchor],
  );
  const month = anchor.getUTCMonth();
  const lang = locale() === 'ar' ? 'ar-AE' : 'en-GB';

  const cell = (day: Date) => {
    const key = dayKey(day);
    const items = byDay.get(key) ?? [];
    const showAll = view !== 'month' || expanded === key;
    const visible = showAll ? items : items.slice(0, PER_CELL);
    const hidden = items.length - visible.length;
    return { key, items, visible, hidden };
  };

  return (
    <>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <button type="button" className="icon-btn" onClick={() => onAnchor(step(view, anchor, -1))} aria-label="Previous">
          <Icon name="chevron-left" />
        </button>
        <button type="button" className="icon-btn" onClick={() => onAnchor(step(view, anchor, 1))} aria-label="Next">
          <Icon name="chevron-right" />
        </button>
        <b style={{ fontSize: 15, marginInlineStart: 4 }}>{periodLabel(view, anchor, lang)}</b>
        <button type="button" className="chip" onClick={() => onAnchor(new Date())}>
          Today
        </button>
        <div className="right">
          <Seg
            value={view}
            onChange={onView}
            options={[
              { value: 'month' as CalendarView, label: 'Month' },
              { value: 'week' as CalendarView, label: 'Week' },
              { value: 'day' as CalendarView, label: 'Day' },
            ]}
          />
        </div>
      </div>

      {loading && tasks.length === 0 && <Spinner />}

      {view === 'month' ? (
        <>
          <div className="cal-head" aria-hidden>
            {weekdayNames(lang).map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="cal-grid">
            {days.map((day) => {
              const { key, visible, hidden } = cell(day);
              const classes = ['cal-day'];
              // A day from the month either side stays readable but recedes.
              if (day.getUTCMonth() !== month) classes.push('dim');
              if (isToday(day)) classes.push('today');
              return (
                <div className={classes.join(' ')} key={key}>
                  <span className="d">{dayNumber(day)}</span>
                  {visible.map((task) => (
                    <Chip key={task.id} task={task} onOpen={onOpen} />
                  ))}
                  {hidden > 0 && (
                    <button type="button" className="cal-more" onClick={() => setExpanded(key)}>
                      +{hidden} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="cal-list">
          {days.map((day) => {
            const { key, items } = cell(day);
            return (
              <div className={isToday(day) ? 'cal-day today' : 'cal-day'} key={key}>
                <span className="d">
                  {day.toLocaleDateString(lang, { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}
                </span>
                <div className="cal-evs">
                  {items.length === 0 ? (
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      Nothing due
                    </span>
                  ) : (
                    items.map((task) => <Chip key={task.id} task={task} onOpen={onOpen} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && tasks.length === 0 && (
        <Empty icon="calendar-days" title="Nothing scheduled" hint="No tasks are due in this period." />
      )}
    </>
  );
}

function Chip({ task, onOpen }: { task: TaskRow; onOpen: (task: TaskRow) => void }) {
  return (
    <button
      type="button"
      className={task.completed_at ? 'cal-ev done' : 'cal-ev'}
      style={{ ['--c' as string]: PRIORITY_COLOUR[task.priority] }}
      onClick={() => onOpen(task)}
      title={`${clockOf(task)} · ${task.title}`}
    >
      <time>{clockOf(task)}</time>
      <span className="t">{task.title}</span>
    </button>
  );
}
