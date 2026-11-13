import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Spinner, ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';
import { useCallAction } from './call.js';
import {
  addDays, ASKED_BY, clashIn, clock, dayKey, freeGap, instantOf, nextFreeSlot, NEXT_STEPS,
  pastProblem, RESULTS, resultChip, slots, TRY_AGAIN, withSlot,
  type FieldProblem, type Occupied,
} from './plan-rules.js';

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
 *
 * Eight things the owner found by hand are fixed here and in
 * `server/src/v2/meetings.ts`. Four of them are on this screen: a plan can no
 * longer be put in the past and the refusal names the day or the time; a plan
 * can be changed and deleted; a cancelled plan says so; and the new-plan form
 * has the lead picker, the clash warning and the several-days switch the
 * design asks for. The fifth is the meeting result, which asked five
 * questions and kept one word.
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
  contactId: string | null;
  kind: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  place: string | null;
  result: string | null;
  interest: string | null;
  who: string | null;
  phone: string | null;
  agent: string;
  /*
   * Everything from here down is optional because the preview's own mock
   * (`src/preview/mock-api.ts`, which this screen does not own) answers the
   * calendar with the older, shorter payload. The server always sends them.
   */
  resultNote?: string | null;
  /** Who asked to move it, or who cancelled. */
  resultBy?: string | null;
  reminderMinutes?: number | null;
  bookedProject?: string | null;
  bookedUnit?: string | null;
  bookedPriceAed?: number | null;
  bookedPaidAed?: number | null;
  receiptName?: string | null;
  /** How often this lead has failed to turn up, over the whole book. */
  noShows?: number;
  /** The project and unit type the lead asked about. */
  wants?: string | null;
  /** Whose plan it is. Absent means the viewer's own. */
  mine?: boolean;
}

interface Window_ { tasks: Task[]; meetings: Meeting[] }

type View = 'month' | 'week' | 'day';

/** One plan on the grid: a meeting or a task, flattened so they sort together. */
interface Plan extends Occupied {
  id: string;
  kind: 'meeting' | 'visit' | 'call' | 'follow' | 'team';
  kindLabel: string;
  title: string;
  sub: string | null;
  at: Date;
  until: Date;
  allDay: boolean;
  done: boolean;
  /** What came of it, when something did. */
  result: string | null;
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

/** 07:00 to 22:00, which is the window anything in this office happens in. */
const DAY_FROM = 7;
const DAY_TO = 22;
const HOUR_PX = 46;

/** §4 of `docs/v2/phone-shell.md`: under this, the phone layout. */
const PHONE = 768;

/**
 * Whether this is a phone, in the component and not only in CSS.
 *
 * The week is a different *thing* on a phone, not a narrower one:
 * `Calendar.dc.html` draws seven full-width day rows where the computer
 * draws an hour grid. An hour grid for seven days needs 640px, so at 390 it
 * either scrolls sideways or clips six of the seven columns away.
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

/** The five kinds a plan can be, in the design's words and its order. */
const KINDS: Array<{ value: string; label: string; grid: Plan['kind'] }> = [
  { value: 'meeting', label: 'Meeting', grid: 'meeting' },
  { value: 'site_visit', label: 'Site visit', grid: 'visit' },
  { value: 'call', label: 'Call', grid: 'call' },
  { value: 'follow_up', label: 'Follow-up', grid: 'follow' },
  { value: 'team', label: 'Team', grid: 'team' },
];

/** The three kinds the design will not let you plan without a lead. */
const LEAD_REQUIRED = ['meeting', 'site_visit', 'call'];

/** Where it happens — the design's four, and nothing invented beyond them. */
const PLACES = ['Office', 'Sales centre', 'Client’s place', 'Online / Zoom'];

/** The place each kind usually happens in, as the design pre-picks it. */
const PLACE_FOR: Record<string, string | null> = {
  meeting: 'Office', site_visit: 'Sales centre', call: null, follow_up: null, team: 'Office',
};

/** How long, in minutes, and the length each kind usually runs for. */
const LENGTHS = [15, 30, 60, 120];
const LENGTH_FOR: Record<string, number> = {
  meeting: 60, site_visit: 60, call: 15, follow_up: 15, team: 60,
};

/** "Remind me before", in minutes. */
const REMINDERS = [15, 60, 120];

/** The title the design writes for you, from the kind and the lead. */
const TITLE_FOR: Record<string, string> = {
  meeting: 'Meeting with ', site_visit: 'Site visit with ', call: 'Call ', follow_up: 'Follow up ',
};

/** A lead, for the picker the new-plan form was missing entirely. */
interface LeadOption {
  id: string;
  contact_id: string;
  full_name: string | null;
  project_name: string | null;
  unit_type: string | null;
  phone_e164: string | null;
}

export function V2Calendar() {
  const { user } = useAuth();
  const canSeeTeam = user?.role !== 'agent';
  const phone = useIsPhone();

  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const [picked, setPicked] = useState(() => dayKey(new Date()));
  const [open, setOpen] = useState<Plan | null>(null);
  const [answering, setAnswering] = useState<Plan | null>(null);
  const [adding, setAdding] = useState(false);
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

  /*
   * Every day a plan covers, not only the day it starts on.
   *
   * A plan that runs over several days — the expo, a training week — is one
   * row whose `endsAt` is the midnight after its last day. Before this it was
   * drawn on day one and nowhere else, so day two of a three-day stand looked
   * like a free day.
   */
  const byDay = useMemo(() => {
    const map = new Map<string, Plan[]>();
    const put = (key: string, plan: Plan) => {
      if (!map.has(key)) map.set(key, []);
      (map.get(key) as Plan[]).push(plan);
    };
    for (const plan of plans) {
      put(dayKey(plan.at), plan);
      if (!plan.allDay) continue;
      for (let i = 1; i < 60; i += 1) {
        const next = new Date(plan.at.getFullYear(), plan.at.getMonth(), plan.at.getDate() + i);
        if (next.getTime() >= plan.until.getTime()) break;
        put(dayKey(next), plan);
      }
    }
    for (const list of map.values()) {
      /* All-day plans first, then by the hour, which is the design's order. */
      list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.at.getTime() - b.at.getTime());
    }
    return map;
  }, [plans]);

  /* Meetings that have happened and nobody has said how they went. The design
     puts this at the top of the side column, in accent, with a deadline. */
  const waiting = useMemo(
    () => plans.filter((plan) => plan.needsResult).sort((a, b) => a.at.getTime() - b.at.getTime()),
    [plans],
  );

  const chosen = byDay.get(picked) ?? [];
  const timedToday = chosen.filter((plan) => !plan.allDay);

  /*
   * §1.4: the title, the live count under it, and the one round action on
   * the right — `Calendar.dc.html` draws a `+ Add event` there.
   */
  usePhoneHead({
    /* `Calendar.dc.html` writes the whole date of the day being looked at —
       "Wed, 11 November 2026" — not how many plans are on it. The count is
       on the "Today's plan" card underneath, where the design puts it. */
    sub: new Date(picked).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    }).replace(/^(\w+) /, '$1, '),
    /* The handler is stable on purpose: `usePhoneHead` keys on the label and
       the sub, so a closure that changed every time `picked` did would be
       remembered from the render before. The sheet reads the day itself. */
    action: { icon: 'plus', label: 'Add a plan', onClick: () => setAdding(true) },
  });

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
        <button type="button" className="d-btn d-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" />New plan
        </button>
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
            {/*
              * The week, on a phone, is seven full-width day rows — day name
              * and number, two event lines, "+N more", a count on the right.
              * `Calendar.dc.html` draws it that way because an hour grid for
              * seven days wants 640px and there are 358.
              */}
            {view === 'week' && phone && (
              <WeekRows days={days} byDay={byDay} picked={picked} onPick={setPicked} />
            )}
            {view !== 'month' && !(view === 'week' && phone) && (
              <TimeGrid
                days={days}
                byDay={byDay}
                picked={picked}
                onPick={setPicked}
                onOpen={setOpen}
                dayView={view === 'day'}
              />
            )}

            {/*
              * The key to the dots, under the grid.
              *
              * `Calendar.dc.html` puts it there, and on a phone it is the
              * opposite of optional: a 51px-wide cell holds a number and
              * five coloured dots and nothing else, so the key is the only
              * thing that says what a dot means. The computer design keeps
              * it up in the top bar beside the month, which is where the
              * markup above has it; that copy is hidden at this width.
              */}
            {phone && view === 'month' && (
              <div className="d-legend v2-b-callegend">
                {LEGEND.map((one) => (
                  <span key={one.kind}>
                    <span className={`d-dot ${one.dot}`} />{one.label}
                  </span>
                ))}
              </div>
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
                      onClick={() => setAnswering(plan)}
                    >
                      <span className="d-tm">{clock(plan.at)}</span>
                      <span className="d-bd">
                        <b>{plan.meeting?.who ?? plan.title}</b>
                        <span>{plan.kindLabel} · {clock(plan.at)}</span>
                      </span>
                      <span className="d-btn d-sm d-dark">Answer</span>
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

              {/* The design's own wording, and the free gap it names. */}
              {timedToday.length >= 5 && (
                <div className="d-banner d-amber d-small v2-cal-busy">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">
                    Busy day: {timedToday.length} plans. {freeGap(timedToday, picked)}
                  </span>
                </div>
              )}

              {chosen.length === 0 && (
                <p className="d-small d-muted">Nothing planned. A quiet day.</p>
              )}

              {chosen.map((plan) => {
                const chip = resultChip(plan.result);
                return (
                  <button
                    type="button"
                    className={plan.done ? 'd-plan-row d-is-done' : 'd-plan-row'}
                    key={`${picked}-${plan.id}`}
                    onClick={() => setOpen(plan)}
                  >
                    <span className="d-tm">{plan.allDay ? 'All' : clock(plan.at)}</span>
                    <span className={`d-tdot d-${plan.kind}`} />
                    <span className="d-bd">
                      <b>{plan.title}</b>
                      <span>{daySub(plan, picked) ?? ''}</span>
                    </span>
                    {chip && <span className={chip.tone}>{chip.label}</span>}
                    {plan.needsResult && <span className="d-chip d-orange">Result?</span>}
                  </button>
                );
              })}

              <div className="d-card-foot v2-cal-foot">
                <button
                  type="button"
                  className="d-btn d-sm d-block"
                  disabled={picked < dayKey(new Date())}
                  onClick={() => setAdding(true)}
                >
                  <Icon name="plus" />Add a plan on {picked === dayKey(new Date()) ? 'today' : niceKey(picked)}
                </button>
              </div>
            </section>
          </aside>
        </div>
      )}

      {open && (
        <PlanPanel
          plan={open}
          plans={plans}
          onClose={() => setOpen(null)}
          onAnswer={() => { setAnswering(open); setOpen(null); }}
          onChanged={(said) => { setOpen(null); got.reload(); toast(said); }}
        />
      )}

      {answering?.meeting && (
        <ResultPanel
          plan={answering}
          onClose={() => setAnswering(null)}
          onSaved={(said) => { setAnswering(null); got.reload(); toast(said); }}
        />
      )}

      {adding && (
        <NewPlan
          day={picked < dayKey(new Date()) ? dayKey(new Date()) : picked}
          plans={plans}
          onClose={() => setAdding(false)}
          onMade={(said) => { setAdding(false); got.reload(); toast(said); }}
        />
      )}
    </div>
  );
}

/* ── the week, on a phone ──────────────────────────────────────────────── */

function WeekRows({
  days, byDay, picked, onPick,
}: {
  days: Date[];
  byDay: Map<string, Plan[]>;
  picked: string;
  onPick: (key: string) => void;
}) {
  const today = dayKey(new Date());
  return (
    <div className="v2-b-wkrows">
      {days.map((day) => {
        const key = dayKey(day);
        const plans = byDay.get(key) ?? [];
        return (
          <button
            key={key}
            type="button"
            className={[
              'v2-b-wkrow',
              key === today ? 'd-today' : '',
              key === picked ? 'd-on' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onPick(key)}
          >
            <span className="v2-b-wkday">
              <span>{day.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
              <b>{day.getDate()}</b>
            </span>
            <span className="v2-b-wkev">
              {plans.length === 0 && <span className="v2-b-wkempty">Nothing planned</span>}
              {plans.slice(0, 2).map((plan) => (
                <span key={plan.id}>
                  {plan.allDay ? '' : `${clock(plan.at)} · `}{plan.title}
                </span>
              ))}
              {plans.length > 2 && (
                <span className="v2-b-wkmore">+{plans.length - 2} more · tap to see all</span>
              )}
            </span>
            {plans.length > 0 && <span className="v2-b-wkn">{plans.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── putting something in the diary ────────────────────────────────────── */

/**
 * The design's "New plan" dialog, all of it.
 *
 * What was missing, and what each missing piece cost: the **lead picker**, so
 * a viewing sat in the diary with nobody's name on it; the **past check**, so
 * a plan could be saved yesterday; the **clash warning**, so two things could
 * be booked at four o'clock in silence; and the **several-days switch**, so an
 * expo had to be typed in three times.
 */
function NewPlan({
  day, plans, onClose, onMade,
}: {
  day: string;
  plans: Plan[];
  onClose: () => void;
  onMade: (said: string) => void;
}) {
  const [kind, setKind] = useState('meeting');
  const [leadId, setLeadId] = useState('');
  const [title, setTitle] = useState('');
  const [typedTitle, setTypedTitle] = useState(false);
  const [on, setOn] = useState(day);
  const [at, setAt] = useState(() => nextFreeSlot(day, plans));
  const [multi, setMulti] = useState(false);
  const [spanDays, setSpanDays] = useState(2);
  const [mins, setMins] = useState(LENGTH_FOR.meeting as number);
  const [remind, setRemind] = useState(60);
  const [place, setPlace] = useState<string | null>(PLACE_FOR.meeting ?? null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const leads = useAsync<{ items: LeadOption[] }>(
    () => api.get('/api/my-leads?tab=all&pageSize=200'),
    [],
  );
  const lead = (leads.data?.items ?? []).find((one) => one.id === leadId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const team = kind === 'team';
  const needsLead = LEAD_REQUIRED.includes(kind);
  const today = dayKey(new Date());
  const times = useMemo(() => withSlot(slots(), at), [at]);

  /* The title the design writes for you, until the agent types their own. */
  useEffect(() => {
    if (typedTitle) return;
    if (team) { setTitle(''); return; }
    const stem = TITLE_FOR[kind] ?? '';
    setTitle(lead?.full_name ? `${stem}${lead.full_name}` : '');
  }, [kind, lead?.full_name, team, typedTitle]);

  const past = multi ? pastProblem(on, null) : pastProblem(on, at);
  const clash = multi ? null : clashIn(plans, on, at, mins);
  const leadProblem = needsLead && !leadId ? 'Choose a lead from the list.' : null;
  const titleProblem = title.trim() ? null : 'Write a short title.';

  const dayError = past?.field === 'day' ? past.message : null;
  const timeError = past?.field === 'time' ? past.message : (!at ? 'Choose a time.' : null);

  async function save() {
    setShown(true);
    if (leadProblem || titleProblem || dayError || timeError) return;
    setBusy(true);
    setProblem(null);
    try {
      /* Built in the reader's own timezone: 10:00 is 10:00 where the person
         setting it is standing, which is the only reading that is ever
         right for a meeting somebody has to be at. */
      const starts = multi ? instantOf(on, '00:00') : instantOf(on, at);
      /* An all-day plan ends at the midnight after its last day, so the
         calendar's own window query returns it on every day it covers. */
      const ends = multi
        ? instantOf(addDays(on, spanDays), '00:00')
        : new Date(starts.getTime() + mins * 60_000);
      await api.post('/api/v2/meetings', {
        kind,
        title: title.trim(),
        opportunityId: team ? null : leadId || null,
        contactId: team ? null : lead?.contact_id ?? null,
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        allDay: multi,
        place,
        reminderMinutes: remind,
      });
      onMade(
        `Plan saved · ${niceKey(on)}${multi ? ` · ${spanDays} days` : ` ${at}`} · reminder ${remindWords(remind)} before`,
      );
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="d-scrim d-show" onClick={onClose} aria-hidden />
      <div className="d-dialog d-open d-lg" role="dialog" aria-label="New plan">
        <div className="d-dialog-head">
          <div className="d-grow">
            <h3>New plan</h3>
            <p>It shows in your calendar and on My Day. You get a reminder.</p>
          </div>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-dialog-body">
          <div className="d-field">
            <span className="d-field-label">Type</span>
            <div className="d-chips">
              {KINDS.map((one) => (
                <button
                  key={one.value}
                  type="button"
                  className={kind === one.value ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => {
                    setKind(one.value);
                    setMins(LENGTH_FOR[one.value] ?? 60);
                    setPlace(PLACE_FOR[one.value] ?? null);
                  }}
                >
                  {one.label}
                </button>
              ))}
            </div>
          </div>

          <div className="d-two">
            {!team && (
              <div className={shown && leadProblem ? 'd-field d-invalid' : 'd-field'}>
                <label htmlFor="v2-cal-lead">
                  Lead {needsLead && <span className="d-req">*</span>}
                </label>
                <select
                  id="v2-cal-lead"
                  className="d-select"
                  value={leadId}
                  onChange={(e) => setLeadId(e.target.value)}
                >
                  <option value="">Choose from your leads…</option>
                  {(leads.data?.items ?? []).map((one) => (
                    <option key={one.id} value={one.id}>
                      {[one.full_name ?? 'No name', one.project_name, one.unit_type]
                        .filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
                <span className="d-hint">Pick from the list. A team plan has no lead.</span>
                <span className="d-error">{leadProblem}</span>
              </div>
            )}

            <div className={shown && titleProblem ? 'd-field d-invalid' : 'd-field'}>
              <label htmlFor="v2-cal-title">Title <span className="d-req">*</span></label>
              <input
                id="v2-cal-title"
                className="d-input"
                value={title}
                placeholder={team ? 'Weekly sales meeting' : `${TITLE_FOR[kind] ?? ''}…`}
                onChange={(e) => { setTitle(e.target.value); setTypedTitle(e.target.value !== ''); }}
              />
              <span className="d-error">{titleProblem}</span>
            </div>

            <div className={shown && dayError ? 'd-field d-invalid' : 'd-field'}>
              <label htmlFor="v2-cal-day">Day <span className="d-req">*</span></label>
              <input
                id="v2-cal-day"
                className="d-input"
                type="date"
                value={on}
                /* The browser's own floor, so the past is not even offered. */
                min={today}
                onChange={(e) => setOn(e.target.value)}
              />
              <span className="d-error">{dayError}</span>
            </div>

            {!multi && (
              <div className={shown && timeError ? 'd-field d-invalid' : 'd-field'}>
                <label htmlFor="v2-cal-time">Time <span className="d-req">*</span></label>
                <select
                  id="v2-cal-time"
                  className="d-select"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                >
                  <option value="">Time…</option>
                  {times.map((one) => <option key={one} value={one}>{one}</option>)}
                </select>
                <span className="d-error">{timeError}</span>
              </div>
            )}
          </div>

          {/* A warning, not a refusal: two plans at four is sometimes meant. */}
          {clash && (
            <div className="d-banner d-amber">
              <Icon name="alert-triangle" />
              <span className="d-grow">
                <b>This time is taken.</b> You already have “{clash.title}” at {clock(clash.at)}.
                Choose another time, or save both.
              </span>
            </div>
          )}

          <div className="d-row">
            <label className="d-switch">
              <input
                type="checkbox"
                checked={multi}
                onChange={(e) => setMulti(e.target.checked)}
              />
              <span className="d-track" />
              Runs for several days
            </label>
            {multi && (
              <div className="d-chips">
                {[2, 3, 4, 5].map((one) => (
                  <button
                    key={one}
                    type="button"
                    className={spanDays === one ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => setSpanDays(one)}
                  >
                    {one} days
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="d-two">
            {!multi && (
              <div className="d-field">
                <span className="d-field-label">How long</span>
                <div className="d-chips">
                  {LENGTHS.map((one) => (
                    <button
                      key={one}
                      type="button"
                      className={mins === one ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => setMins(one)}
                    >
                      {one < 60 ? `${one} min` : `${one / 60} h`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="d-field">
              <span className="d-field-label">Remind me before</span>
              <div className="d-chips">
                {REMINDERS.map((one) => (
                  <button
                    key={one}
                    type="button"
                    className={remind === one ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => setRemind(one)}
                  >
                    {remindWords(one)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="d-field">
            <span className="d-field-label">Place</span>
            <div className="d-chips">
              {PLACES.map((one) => (
                <button
                  key={one}
                  type="button"
                  className={place === one ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => setPlace(place === one ? null : one)}
                >
                  {one}
                </button>
              ))}
            </div>
          </div>

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        <div className="d-dialog-foot">
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
          <span className="d-grow" />
          <button type="button" className="d-btn d-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : clash ? 'Save anyway' : 'Save the plan'}
          </button>
        </div>
      </div>
    </>
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
          const bands = plans.filter((plan) => plan.allDay);
          const rest = plans.filter((plan) => !plan.allDay);
          const room = Math.max(0, 3 - bands.length);
          const show = rest.slice(0, room);
          const more = rest.length - show.length;
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
              {/* A plan running over several days prints as a band across the
                  cells, written once on the day it starts and on each Monday
                  after that — which is where the design writes it. */}
              {bands.map((plan) => {
                const first = dayKey(plan.at) === key || day.getDay() === 1;
                return (
                  <span
                    key={`${key}-${plan.id}`}
                    role="button"
                    tabIndex={0}
                    className={[
                      'd-cal-ev', `d-${plan.kind}`, 'd-band', first ? '' : 'd-mid',
                      plan.done ? 'd-is-done' : '',
                    ].filter(Boolean).join(' ')}
                    title={`${plan.title}${plan.meeting?.place ? ` · ${plan.meeting.place}` : ''}`}
                    onClick={(e) => { e.stopPropagation(); onOpen(plan); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpen(plan); } }}
                  >
                    {first ? plan.title : ' '}
                  </span>
                );
              })}
              {show.map((plan) => (
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
                  title={planTitle(plan)}
                  onClick={(e) => { e.stopPropagation(); onOpen(plan); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpen(plan); } }}
                >
                  {`${clock(plan.at)} ${plan.title}`}
                </span>
              ))}
              {more > 0 && (
                <span className="d-cal-ev v2-cal-more">+{more} more</span>
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
        {days.map((day) => {
          const key = dayKey(day);
          return (
            <div key={key}>
              {(byDay.get(key) ?? []).filter((plan) => plan.allDay).map((plan) => {
                const first = dayKey(plan.at) === key || day === days[0];
                return (
                  <span
                    key={`${key}-${plan.id}`}
                    role="button"
                    tabIndex={0}
                    className={`d-cal-ev d-band d-${plan.kind}${first ? '' : ' d-mid'}`}
                    title={plan.title}
                    onClick={() => onOpen(plan)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onOpen(plan); }}
                  >
                    {first ? plan.title : ' '}
                  </span>
                );
              })}
            </div>
          );
        })}
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
                    title={planTitle(plan)}
                    onClick={(e) => { e.stopPropagation(); onOpen(plan); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onOpen(plan); } }}
                  >
                    {plan.title}
                    <span>
                      {clock(plan.at)}
                      {resultChip(plan.result) ? ` · ${resultChip(plan.result)?.label}` : ''}
                      {plan.sub ? ` · ${plan.sub}` : ''}
                    </span>
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

/**
 * The plan, open.
 *
 * The two things it could not do: **change the day or time**, and **delete**.
 * Both are here now, both check the past and warn about a clash, and the
 * delete asks twice rather than opening a dialog — `docs/v2/phone-shell.md`
 * §6, and the design's own `data-confirm="Tap again to delete"`.
 */
function PlanPanel({
  plan, plans, onClose, onAnswer, onChanged,
}: {
  plan: Plan;
  plans: Plan[];
  onClose: () => void;
  onAnswer: () => void;
  onChanged: (said: string) => void;
}) {
  const { user } = useAuth();
  const [changing, setChanging] = useState(false);
  const [on, setOn] = useState(dayKey(plan.at));
  const [at, setAt] = useState(clock(plan.at));
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /* Escape closes it, which is what everyone tries. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const meeting = plan.meeting;
  const today = dayKey(new Date());
  const times = useMemo(() => withSlot(slots(), at), [at]);
  const lengthMin = Math.max(15, (plan.until.getTime() - plan.at.getTime()) / 60_000);
  const past = pastProblem(on, at);
  const clash = clashIn(plans, on, at, lengthMin, plan.id);
  const chip = resultChip(plan.result);

  /*
   * Whose plan it is.
   *
   * An agent may change and delete their own and nothing else — the server
   * says so too, and a button that always 403s is worse than no button. The
   * design's own answer for a team plan an agent did not make is "Hide for
   * me", which has nowhere to be stored yet: see `docs/v2/questions-calendar.md`.
   */
  const mine = meeting?.mine !== false || user?.role !== 'agent';
  /* A task is not a plan: it is changed on the Tasks screen, which owns it. */
  const editable = Boolean(meeting) && !plan.done && mine;

  async function saveTime() {
    if (past) return;
    setBusy(true);
    setProblem(null);
    try {
      const starts = instantOf(on, at);
      await api.patch(`/api/v2/meetings/${meeting?.id}`, {
        startsAt: starts.toISOString(),
        endsAt: new Date(starts.getTime() + lengthMin * 60_000).toISOString(),
      });
      onChanged(`Moved to ${niceKey(on)} ${at}. The reminder moved too.`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
      setBusy(false);
    }
  }

  async function remove() {
    if (!sure) { setSure(true); return; }
    setBusy(true);
    setProblem(null);
    try {
      await api.del(`/api/v2/meetings/${meeting?.id}`);
      onChanged(`Plan deleted · ${plan.title}`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
      setBusy(false);
    }
  }

  const spanned = plan.allDay
    && Math.round((plan.until.getTime() - plan.at.getTime()) / 86_400_000) > 1;

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="Plan">
        <div className="d-panel-head">
          <h2>{plan.kindLabel}{plan.kind === 'team' ? ' plan' : ''}</h2>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          <div>
            <div className="d-plan-time">
              {plan.allDay
                ? spanned
                  ? `${niceKey(dayKey(plan.at))} – ${niceKey(dayKey(new Date(plan.until.getTime() - 86_400_000)))}`
                  : 'All day'
                : `${clock(plan.at)} – ${clock(plan.until)}`}
            </div>
            <p className="d-muted d-mt-4">
              {plan.at.toLocaleDateString('en-GB', {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
              {dayKey(plan.at) === today ? ' · today' : ''}
            </p>
            <h3 className="d-mt-12">{plan.title}</h3>

            {/* The chip row the panel never had: what it is, what came of it,
                and whether anybody still owes an answer. */}
            <div className="d-row d-gap-8 d-mt-8 d-wrap">
              <span className="d-chip">
                <span className={`d-tdot d-${plan.kind}`} />{plan.kindLabel}
              </span>
              {chip && <span className={chip.tone}>{chip.label}</span>}
              {plan.late && <span className="d-chip d-red">Overdue since {clock(plan.at)}</span>}
              {plan.needsResult && <span className="d-chip d-orange">Result needed</span>}
              {plan.kind === 'team' && (
                <span className="d-chip d-violet">From {meeting?.agent ?? 'the office'}</span>
              )}
            </div>
          </div>

          {plan.needsResult && (
            <div className="d-banner d-accent">
              <Icon name="help-circle" />
              <span className="d-grow"><b>How did it go?</b> Answer before 21:00.</span>
              <button type="button" className="d-btn d-sm d-primary" onClick={onAnswer}>Answer</button>
            </div>
          )}

          <dl className="d-kv">
            {meeting?.who && (
              <div className="d-kv-row">
                <dt>Lead</dt>
                <dd>
                  {plan.leadId
                    ? <Link className="d-link" to={`/v2/leads/${plan.leadId}`}>{meeting.who}</Link>
                    : meeting.who}
                </dd>
              </div>
            )}
            {meeting?.phone && (
              <div className="d-kv-row"><dt>Phone</dt><dd>{meeting.phone}</dd></div>
            )}
            {meeting?.wants && (
              <div className="d-kv-row"><dt>Wants</dt><dd>{meeting.wants}</dd></div>
            )}
            {meeting?.place && (
              <div className="d-kv-row"><dt>Place</dt><dd>{meeting.place}</dd></div>
            )}
            {!plan.allDay && (
              <div className="d-kv-row">
                <dt>Length</dt>
                <dd>{lengthMin >= 60 ? `${lengthMin / 60} h` : `${lengthMin} min`}</dd>
              </div>
            )}
            {meeting?.reminderMinutes != null && (
              <div className="d-kv-row">
                <dt>Reminder</dt>
                <dd>{remindWords(meeting.reminderMinutes)} before</dd>
              </div>
            )}
            {plan.kind === 'team' && (
              <div className="d-kv-row"><dt>Who</dt><dd>Everyone in the office</dd></div>
            )}
            {meeting?.bookedUnit && (
              <div className="d-kv-row">
                <dt>Booked</dt>
                <dd>
                  {[meeting.bookedProject, meeting.bookedUnit].filter(Boolean).join(' · ')}
                  {meeting.bookedPriceAed ? ` · AED ${meeting.bookedPriceAed.toLocaleString('en-GB')}` : ''}
                </dd>
              </div>
            )}
            {meeting?.resultNote && (
              <div className="d-kv-row"><dt>Note</dt><dd>{meeting.resultNote}</dd></div>
            )}
          </dl>

          {changing && (
            <div className="d-card d-flat d-col d-gap-8">
              <b className="d-bold">Change day or time</b>
              <div className="d-two">
                <div className={past?.field === 'day' ? 'd-field d-invalid' : 'd-field'}>
                  <label htmlFor="v2-cal-newday">Day</label>
                  <input
                    id="v2-cal-newday"
                    className="d-input"
                    type="date"
                    value={on}
                    min={today}
                    onChange={(e) => setOn(e.target.value)}
                  />
                  <span className="d-error">{past?.message}</span>
                </div>
                <div className={past?.field === 'time' ? 'd-field d-invalid' : 'd-field'}>
                  <label htmlFor="v2-cal-newtime">Time</label>
                  <select
                    id="v2-cal-newtime"
                    className="d-select"
                    value={at}
                    onChange={(e) => setAt(e.target.value)}
                  >
                    {times.map((one) => <option key={one} value={one}>{one}</option>)}
                  </select>
                  <span className="d-error">{past?.message}</span>
                </div>
              </div>
              {!past && clash && (
                <div className="d-banner d-amber d-small">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">
                    You already have “{clash.title}” at {clock(clash.at)}. You can still save.
                  </span>
                </div>
              )}
              <div className="d-row">
                <span className="d-grow" />
                <button type="button" className="d-btn d-sm d-ghost" onClick={() => setChanging(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="d-btn d-sm d-dark"
                  disabled={busy || Boolean(past)}
                  onClick={saveTime}
                >
                  Save the new time
                </button>
              </div>
            </div>
          )}

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        {/*
          * Wrapping, inline, because this one row can hold three buttons and
          * "Delete" grows into "Tap again to delete" on the first tap — which
          * is 70 pixels the 480px panel does not have. `d-panel-foot` is in
          * the generated stylesheet and `v2-shell.css` belongs to the shell,
          * so the one place this rule can live without reaching into either
          * is here.
          */}
        <div className="d-panel-foot" style={{ flexWrap: 'wrap', rowGap: 8 }}>
          {plan.leadId && (
            <Link className="d-btn" to={`/v2/leads/${plan.leadId}`}>
              <Icon name="user" />Open the lead
            </Link>
          )}
          {editable && !changing && (
            <button type="button" className="d-btn" onClick={() => setChanging(true)}>
              <Icon name="clock" />Change day or time
            </button>
          )}
          <span className="d-grow" />
          {meeting && mine && (
            <button type="button" className="d-btn d-danger" disabled={busy} onClick={remove}>
              <Icon name="trash-2" />{sure ? 'Tap again to delete' : 'Delete'}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

/* ── how did it go? ────────────────────────────────────────────────────── */

/**
 * The five answers, and the five forms behind them.
 *
 * Every one of those forms was missing. The panel offered five words and sent
 * one of them, so "Moved it" moved nothing, "They booked" left the lead where
 * it was, and the interest and the note the endpoint already accepted were
 * never asked for. A meeting in the diary with no result is the one thing an
 * owner cannot read a week later; a meeting with only a word is barely better.
 */
function ResultPanel({
  plan, onClose, onSaved,
}: {
  plan: Plan;
  onClose: () => void;
  onSaved: (said: string) => void;
}) {
  const meeting = plan.meeting as Meeting;
  const { user } = useAuth();
  /* The "sorry we missed you" WhatsApp, recorded like every other tap in the
     CRM. There is no Call on this panel, so the gate never comes up here. */
  const dial = useCallAction({ source: 'followup' });
  const [result, setResult] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  /* Showed up */
  const [step, setStep] = useState<string | null>(null);
  const [stepDay, setStepDay] = useState(() => addDays(dayKey(new Date()), 2));
  const [stepTime, setStepTime] = useState('11:00');
  const [interest, setInterest] = useState<string | null>(null);

  /* No-show */
  const [tryAgain, setTryAgain] = useState<string>('Tomorrow 12:00');
  const [againDay, setAgainDay] = useState(() => addDays(dayKey(new Date()), 1));
  const [againTime, setAgainTime] = useState('12:00');
  const [copied, setCopied] = useState(false);

  /* Moved it */
  const [movedDay, setMovedDay] = useState(() => dayKey(plan.at));
  const [movedTime, setMovedTime] = useState(() => clock(plan.at));
  const [askedBy, setAskedBy] = useState<string | null>(null);

  /* Booked a unit */
  const [project, setProject] = useState(() => (meeting.wants ?? '').split(' · ')[0] ?? '');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [paid, setPaid] = useState('');
  const [receipt, setReceipt] = useState<string | null>(meeting.receiptName ?? null);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement | null>(null);

  const projects = useAsync<{ items: Array<{ id: string; name: string }> }>(
    () => api.get('/api/projects?includeUnverified=1'),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const today = dayKey(new Date());
  const first = (meeting.who ?? '').split(' ')[0] || 'there';
  const me = (user?.name ?? '').split(' ')[0] || 'homes.me';
  const lengthMin = Math.max(15, (plan.until.getTime() - plan.at.getTime()) / 60_000);

  /* The message the design writes for a no-show, ready to send. */
  const sorry = `Hi ${first}, we waited for you ${
    dayKey(plan.at) === today ? 'today' : `on ${niceKey(dayKey(plan.at))}`
  } at ${clock(plan.at)}. No problem. When is a good time to meet again? ${me} · homes.me`;

  const amount = (raw: string) => Number(raw.replace(/[^\d]/g, ''));

  /** The one thing still missing, in the design's own words. */
  const why = useMemo<{ field: string; message: string } | null>(() => {
    if (!result) return { field: 'pick', message: 'Choose one result first.' };
    if (result === 'showed') {
      if (!step) return { field: 'next', message: 'Choose the next step.' };
      const past = pastProblem(stepDay, stepTime);
      if (past) return { field: past.field === 'day' ? 'nday' : 'ntime', message: past.message };
      if (!interest) return { field: 'interest', message: 'Choose Hot, Warm or Cold.' };
    }
    if (result === 'no_show' && tryAgain === 'Pick day and time') {
      const past = pastProblem(againDay, againTime);
      if (past) return { field: past.field === 'day' ? 'aday' : 'atime', message: past.message };
    }
    if (result === 'rescheduled') {
      const past = pastProblem(movedDay, movedTime);
      if (past) return { field: past.field === 'day' ? 'mday' : 'mtime', message: past.message };
      if (!askedBy) return { field: 'who', message: 'Choose who asked.' };
    }
    if (result === 'cancelled' && !askedBy) {
      return { field: 'who', message: 'Choose who cancelled.' };
    }
    if (result === 'booked') {
      if (!unit.trim()) return { field: 'unit', message: 'Write the unit.' };
      if (!(amount(price) > 0)) return { field: 'price', message: 'Write the price.' };
      if (!paid.trim()) return { field: 'paid', message: 'Write what was paid now.' };
      if (amount(paid) > amount(price)) {
        return { field: 'paid', message: 'Paid now cannot be more than the price.' };
      }
      if (!receipt) return { field: 'receipt', message: 'Upload the booking form or the receipt.' };
    }
    return null;
  }, [
    result, step, stepDay, stepTime, interest, tryAgain, againDay, againTime,
    movedDay, movedTime, askedBy, unit, price, paid, receipt,
  ]);

  const bad = (field: string) => (shown && why?.field === field ? 'd-field d-invalid' : 'd-field');
  const says = (field: string) => (why?.field === field ? why.message : '');

  async function upload(chosen: File) {
    setUploading(true);
    setProblem(null);
    try {
      const saved = await api.upload<{ name: string }>(
        `/api/v2/meetings/${meeting.id}/receipt`, chosen,
      );
      setReceipt(saved.name);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That file did not upload.');
    } finally {
      setUploading(false);
    }
  }

  /** The plan the answer puts in the diary next, if it puts one. */
  function nextPlan(): Record<string, unknown> | null {
    if (result === 'showed' && step) {
      const one = NEXT_STEPS.find((s) => s.label === step);
      if (!one) return null;
      const starts = instantOf(stepDay, stepTime);
      return {
        kind: one.kind,
        title: `${one.verb} ${meeting.who ?? 'the lead'}`,
        startsAt: starts.toISOString(),
        endsAt: new Date(starts.getTime() + one.minutes * 60_000).toISOString(),
        place: one.place,
      };
    }
    if (result === 'no_show') {
      const chip = TRY_AGAIN.find((one) => one.label === tryAgain);
      if (!chip || tryAgain === 'Do not plan now') return null;
      const day = tryAgain === 'Pick day and time' ? againDay : addDays(today, chip.days ?? 1);
      const time = tryAgain === 'Pick day and time' ? againTime : chip.time ?? clock(plan.at);
      const starts = instantOf(day, time);
      return {
        kind: meeting.kind,
        title: plan.title,
        startsAt: starts.toISOString(),
        endsAt: new Date(starts.getTime() + lengthMin * 60_000).toISOString(),
        place: meeting.place,
      };
    }
    return null;
  }

  async function save() {
    setShown(true);
    if (why) return;
    setBusy(true);
    setProblem(null);
    try {
      const moved = result === 'rescheduled'
        ? (() => {
          const starts = instantOf(movedDay, movedTime);
          return {
            startsAt: starts.toISOString(),
            endsAt: new Date(starts.getTime() + lengthMin * 60_000).toISOString(),
          };
        })()
        : null;

      const answer = await api.patch<{ leadMoved: boolean; leadNote: string | null }>(
        `/api/v2/meetings/${meeting.id}/result`,
        {
          result,
          note: note.trim() || null,
          interest: result === 'showed' ? interest : null,
          by: result === 'rescheduled' || result === 'cancelled' ? askedBy : null,
          movedTo: moved,
          next: nextPlan(),
          booked: result === 'booked'
            ? {
              project: project || null,
              unit: unit.trim(),
              priceAed: amount(price),
              paidAed: amount(paid),
            }
            : null,
        },
      );
      onSaved(said(answer.leadMoved, answer.leadNote));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
      setBusy(false);
    }
  }

  /** What the toast says, which is how the agent knows what really happened. */
  function said(leadMoved: boolean, leadNote: string | null): string {
    const who = meeting.who ?? 'The lead';
    if (result === 'showed') {
      return `${who} showed up · ${interest} · next step is in your calendar: ${step} · ${niceKey(stepDay)} ${stepTime}`;
    }
    if (result === 'no_show') {
      const made = nextPlan();
      return `No-show counted for ${who}${made ? ` · new plan: ${tryAgain}` : ' · no new plan'}`;
    }
    if (result === 'rescheduled') {
      return `Moved to ${niceKey(movedDay)} ${movedTime} · asked by ${askedBy === 'me' ? 'me' : askedBy}`;
    }
    if (result === 'booked') {
      return leadMoved
        ? `${who} booked a unit in ${project || 'the project'} · lead is Won`
        : `Booking saved · ${leadNote ?? 'the lead did not move to Won'}`;
    }
    return `Cancelled by ${askedBy === 'me' ? 'me' : askedBy} · not a no-show`;
  }

  const times = slots();

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="How did it go?">
        {dial.banner}
        <div className="d-panel-head">
          <h2>How did it go?</h2>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          <div className="d-card d-flat">
            <b className="d-bold">{plan.title}</b>
            <div className="d-small d-muted">
              {[
                dayKey(plan.at) === today ? `Today ${clock(plan.at)}` : `${niceKey(dayKey(plan.at))} ${clock(plan.at)}`,
                meeting.place,
                meeting.wants,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>

          <div className={bad('pick')}>
            <span className="d-field-label">Choose what happened</span>
            <div className="d-res-grid">
              {RESULTS.map((one) => (
                <button
                  key={one.value}
                  type="button"
                  className={result === one.value ? 'd-opt d-on' : 'd-opt'}
                  onClick={() => setResult(one.value)}
                >
                  <Icon name={one.icon as IconName} />
                  <span className="d-grow">
                    <b className="d-bold">{one.label}</b>
                    <div className="d-small d-muted">{one.sub}</div>
                  </span>
                </button>
              ))}
            </div>
            <span className="d-error">{says('pick')}</span>
          </div>

          {/* ── Showed up ── */}
          {result === 'showed' && (
            <>
              <div className={bad('next')}>
                <span className="d-field-label">What is next? <span className="d-req">*</span></span>
                <div className="d-chips">
                  {NEXT_STEPS.map((one) => (
                    <button
                      key={one.label}
                      type="button"
                      className={step === one.label ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => {
                        setStep(one.label);
                        if (one.label === 'Follow up in 2 days') setStepDay(addDays(today, 2));
                      }}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
                <span className="d-error">{says('next')}</span>
              </div>
              <div className="d-two">
                <div className={bad('nday')}>
                  <label htmlFor="v2-res-nday">Day</label>
                  <input
                    id="v2-res-nday"
                    className="d-input"
                    type="date"
                    value={stepDay}
                    min={today}
                    onChange={(e) => setStepDay(e.target.value)}
                  />
                  <span className="d-error">{says('nday')}</span>
                </div>
                <div className={bad('ntime')}>
                  <label htmlFor="v2-res-ntime">Time</label>
                  <select
                    id="v2-res-ntime"
                    className="d-select"
                    value={stepTime}
                    onChange={(e) => setStepTime(e.target.value)}
                  >
                    {times.map((one) => <option key={one} value={one}>{one}</option>)}
                  </select>
                  <span className="d-error">{says('ntime')}</span>
                </div>
              </div>
              <div className={bad('interest')}>
                <span className="d-field-label">
                  How interested is the client? <span className="d-req">*</span>
                </span>
                <div className="d-seg d-block" role="group" aria-label="How interested">
                  {['hot', 'warm', 'cold'].map((one) => (
                    <button
                      key={one}
                      type="button"
                      className={interest === one ? 'd-on' : undefined}
                      onClick={() => setInterest(one)}
                    >
                      {one === 'hot' ? 'Hot' : one === 'warm' ? 'Warm' : 'Cold'}
                    </button>
                  ))}
                </div>
                <span className="d-error">{says('interest')}</span>
              </div>
            </>
          )}

          {/* ── No-show ── */}
          {result === 'no_show' && (
            <>
              <div className="d-banner d-red">
                <Icon name="alert-triangle" />
                <span className="d-grow">
                  <b>No-show {(meeting.noShows ?? 0) + 1} for {meeting.who ?? 'this lead'}.</b>{' '}
                  {(meeting.noShows ?? 0) + 1 >= 2
                    ? 'The lead gets a red flag. The owner sees it.'
                    : 'After 2 no-shows the lead gets a red flag.'}
                </span>
              </div>
              <div className="d-field">
                <span className="d-field-label">Message is ready</span>
                <div className="d-msg-box">{sorry}</div>
                <div className="d-row d-gap-8 d-mt-8">
                  <button
                    type="button"
                    className="d-btn d-sm"
                    disabled={!meeting.phone}
                    onClick={() => {
                      if (meeting.opportunityId) {
                        void dial.whatsapp(
                          { id: meeting.opportunityId, phone: meeting.phone, name: meeting.who },
                          { text: sorry },
                        );
                        return;
                      }
                      /*
                       * A diary entry with no lead behind it — somebody's own
                       * appointment. There is no opportunity to file the tap
                       * against and one is not invented, so it opens WhatsApp
                       * and records nothing.
                       */
                      const to = (meeting.phone ?? '').replace(/[^\d]/g, '');
                      window.open(
                        `https://wa.me/${to}?text=${encodeURIComponent(sorry)}`,
                        '_blank',
                        'noreferrer',
                      );
                    }}
                  >
                    <Icon name="message-circle" />Open WhatsApp
                  </button>
                  <button
                    type="button"
                    className="d-btn d-sm d-ghost"
                    onClick={() => {
                      void navigator.clipboard?.writeText(sorry).then(() => setCopied(true));
                    }}
                  >
                    <Icon name="copy" />{copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <div className="d-field">
                <span className="d-field-label">Try again</span>
                <div className="d-chips">
                  {TRY_AGAIN.map((one) => (
                    <button
                      key={one.label}
                      type="button"
                      className={tryAgain === one.label ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => setTryAgain(one.label)}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
              </div>
              {tryAgain === 'Pick day and time' && (
                <div className="d-two">
                  <div className={bad('aday')}>
                    <label htmlFor="v2-res-aday">Day</label>
                    <input
                      id="v2-res-aday"
                      className="d-input"
                      type="date"
                      value={againDay}
                      min={today}
                      onChange={(e) => setAgainDay(e.target.value)}
                    />
                    <span className="d-error">{says('aday')}</span>
                  </div>
                  <div className={bad('atime')}>
                    <label htmlFor="v2-res-atime">Time</label>
                    <select
                      id="v2-res-atime"
                      className="d-select"
                      value={againTime}
                      onChange={(e) => setAgainTime(e.target.value)}
                    >
                      {times.map((one) => <option key={one} value={one}>{one}</option>)}
                    </select>
                    <span className="d-error">{says('atime')}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Moved it ── */}
          {result === 'rescheduled' && (
            <>
              <div className="d-two">
                <div className={bad('mday')}>
                  <label htmlFor="v2-res-mday">New day <span className="d-req">*</span></label>
                  <input
                    id="v2-res-mday"
                    className="d-input"
                    type="date"
                    value={movedDay}
                    min={today}
                    onChange={(e) => setMovedDay(e.target.value)}
                  />
                  <span className="d-error">{says('mday')}</span>
                </div>
                <div className={bad('mtime')}>
                  <label htmlFor="v2-res-mtime">New time <span className="d-req">*</span></label>
                  <select
                    id="v2-res-mtime"
                    className="d-select"
                    value={movedTime}
                    onChange={(e) => setMovedTime(e.target.value)}
                  >
                    {withSlot(times, movedTime).map((one) => (
                      <option key={one} value={one}>{one}</option>
                    ))}
                  </select>
                  <span className="d-error">{says('mtime')}</span>
                </div>
              </div>
              <div className={bad('who')}>
                <span className="d-field-label">
                  Who asked to move it? <span className="d-req">*</span>
                </span>
                <div className="d-chips">
                  {ASKED_BY.filter((one) => one.value !== 'developer').map((one) => (
                    <button
                      key={one.value}
                      type="button"
                      className={askedBy === one.value ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => setAskedBy(one.value)}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
                <span className="d-error">{says('who')}</span>
              </div>
              <p className="d-small d-muted">
                The plan moves to the new time. The reminder moves with it.
              </p>
            </>
          )}

          {/* ── Booked a unit ── */}
          {result === 'booked' && (
            <>
              <div className="d-two">
                <div className="d-field">
                  <label htmlFor="v2-res-project">Project</label>
                  <select
                    id="v2-res-project"
                    className="d-select"
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                  >
                    <option value="">Choose the project…</option>
                    {(projects.data?.items ?? []).map((one) => (
                      <option key={one.id} value={one.name}>{one.name}</option>
                    ))}
                    {project && !(projects.data?.items ?? []).some((one) => one.name === project) && (
                      <option value={project}>{project}</option>
                    )}
                  </select>
                </div>
                <div className={bad('unit')}>
                  <label htmlFor="v2-res-unit">Unit <span className="d-req">*</span></label>
                  <input
                    id="v2-res-unit"
                    className="d-input"
                    value={unit}
                    placeholder="2BR · 1204"
                    onChange={(e) => setUnit(e.target.value)}
                  />
                  <span className="d-error">{says('unit')}</span>
                </div>
                <div className={bad('price')}>
                  <label htmlFor="v2-res-price">Price in AED <span className="d-req">*</span></label>
                  <input
                    id="v2-res-price"
                    className="d-input"
                    inputMode="numeric"
                    value={price}
                    placeholder="1,400,000"
                    onChange={(e) => setPrice(e.target.value)}
                  />
                  <span className="d-error">{says('price')}</span>
                </div>
                <div className={bad('paid')}>
                  <label htmlFor="v2-res-paid">Paid now in AED <span className="d-req">*</span></label>
                  <input
                    id="v2-res-paid"
                    className="d-input"
                    inputMode="numeric"
                    value={paid}
                    placeholder="140,000"
                    onChange={(e) => setPaid(e.target.value)}
                  />
                  <span className="d-error">{says('paid')}</span>
                </div>
              </div>
              <div className={bad('receipt')}>
                <span className="d-field-label">
                  Booking form or receipt <span className="d-req">*</span>
                </span>
                <button
                  type="button"
                  className={receipt ? 'd-upl d-has' : 'd-upl'}
                  disabled={uploading}
                  onClick={() => file.current?.click()}
                >
                  <Icon name="upload" />
                  <span className="d-grow">
                    {uploading ? 'Uploading…' : receipt ?? 'Upload the booking form or the receipt'}
                  </span>
                  <span className="d-small d-muted">{receipt ? 'Uploaded' : 'PDF or photo'}</span>
                </button>
                <input
                  ref={file}
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
                  onChange={(e) => {
                    const chosen = e.target.files?.[0];
                    if (chosen) void upload(chosen);
                  }}
                />
                <span className="d-error">{says('receipt')}</span>
              </div>
              <div className="d-banner d-green d-small">
                <Icon name="trophy" />
                <span className="d-grow">The lead moves to Won. The owner sees it.</span>
              </div>
            </>
          )}

          {/* ── Cancelled ── */}
          {result === 'cancelled' && (
            <>
              <div className={bad('who')}>
                <span className="d-field-label">Who cancelled? <span className="d-req">*</span></span>
                <div className="d-chips">
                  {ASKED_BY.map((one) => (
                    <button
                      key={one.value}
                      type="button"
                      className={askedBy === one.value ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => setAskedBy(one.value)}
                    >
                      {one.value === 'client' ? 'Client' : one.label}
                    </button>
                  ))}
                </div>
                <span className="d-error">{says('who')}</span>
              </div>
              <p className="d-small d-muted">A cancelled meeting is not counted as a no-show.</p>
            </>
          )}

          {result && (
            <div className="d-field">
              <label htmlFor="v2-res-note">Note</label>
              <textarea
                id="v2-res-note"
                className="d-textarea"
                value={note}
                placeholder={result === 'cancelled' ? 'Why was it cancelled?' : 'What did the client say?'}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          )}

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        <div className="d-panel-foot">
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Later</button>
          <span className="d-grow" />
          <span className="d-small d-muted">Before 21:00</span>
          <button type="button" className="d-btn d-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save the result'}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ── turning what the server sends into plans ──────────────────────────── */

export function toPlans(data: Window_ | null): Plan[] {
  if (!data) return [];
  const now = Date.now();
  const out: Plan[] = [];

  for (const meeting of data.meetings) {
    const at = new Date(meeting.startsAt);
    const until = new Date(meeting.endsAt);
    const kind = meeting.kind === 'site_visit' ? 'visit'
      : meeting.kind === 'team' ? 'team'
        : meeting.kind === 'call' ? 'call'
          : meeting.kind === 'follow_up' ? 'follow'
            : 'meeting';
    out.push({
      id: `m-${meeting.id}`,
      kind,
      kindLabel: KINDS.find((one) => one.grid === kind)?.label ?? 'Meeting',
      title: meeting.title ?? meeting.who ?? 'Meeting',
      sub: meeting.place,
      at,
      until,
      allDay: Boolean(meeting.allDay),
      /*
       * Done means finished, and "Moved it" is not finished: the server
       * leaves `result` NULL when a plan moves, so a moved plan stays live.
       * `resultChip` is what says which kind of finished it was — before
       * this, Cancelled, No-show and Showed up all drew the same grey line.
       */
      done: Boolean(meeting.result),
      result: meeting.result,
      late: false,
      /* It has finished and nobody has said what happened. This is the one
         thing on the screen that asks something of the person reading it. */
      needsResult: !meeting.result && until.getTime() < now
        && meeting.kind !== 'team' && meeting.mine !== false,
      leadId: meeting.opportunityId,
      meeting,
    });
  }

  for (const task of data.tasks) {
    const at = new Date(task.due_at);
    out.push({
      id: `t-${task.id}`,
      kind: task.type === 'call' ? 'call' : 'follow',
      kindLabel: task.type === 'call' ? 'Call' : 'Follow-up',
      title: task.title,
      sub: task.full_name,
      at,
      until: new Date(at.getTime() + 30 * 60_000),
      allDay: false,
      done: Boolean(task.completed_at),
      result: null,
      late: !task.completed_at && at.getTime() < now,
      needsResult: false,
      leadId: task.opportunity_id,
      meeting: null,
    });
  }

  return out;
}

/** The sub-line in the day list: what it is, where, and what came of it. */
function daySub(plan: Plan, onDay: string): string | null {
  const span = plan.allDay
    ? Math.round((plan.until.getTime() - plan.at.getTime()) / 86_400_000)
    : 0;
  const which = span > 1
    ? Math.round((instantOf(onDay, '00:00').getTime()
      - instantOf(dayKey(plan.at), '00:00').getTime()) / 86_400_000) + 1
    : 0;
  /* What came of it is the chip on the right of the row, not a word in the
     middle of this line: saying it twice is how "Cancelled · Cancelled"
     happens. */
  return [
    span > 1 ? `All day · day ${which} of ${span}` : plan.allDay ? 'All day' : null,
    plan.meeting?.place,
    plan.late ? 'Overdue' : null,
  ].filter(Boolean).join(' · ') || plan.kindLabel;
}

/** What the grid shows on hover, which is where the result word fits. */
function planTitle(plan: Plan): string {
  return [clock(plan.at), plan.title, resultChip(plan.result)?.label]
    .filter(Boolean).join(' · ');
}

/** "15 min", "1 h", "2 h". */
function remindWords(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`;
}

/* ── dates ─────────────────────────────────────────────────────────────── */

function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

function weekOf(at: Date): Date[] {
  const monday = new Date(at);
  monday.setDate(at.getDate() - ((at.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_unused, i) =>
    new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}

/** "Thu 12 Nov", for a day key — the header's sub-line and the save label. */
function niceKey(key: string): string {
  return new Date(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
