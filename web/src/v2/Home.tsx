import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';
import { clockIn, originOf, whenToCall } from '../lib/dialling.js';
import { iosNeedsInstall, pushState, enablePush, type PushState } from '../lib/push.js';

/**
 * Under this, the phone layout — `design/screens/Main.dc.html` and
 * `OwnerHome.dc.html` rather than the two computer pages.
 *
 * `Shell.tsx` keeps its own copy of this number and this hook and this group
 * may not edit it, so the six lines are repeated rather than shared.
 */
const PHONE = 768;

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

/**
 * Home: My Day for an agent, the company's day for an owner.
 *
 * `design/web/my-day.html` and `owner-home.html` are the drawings; this is
 * them, with one rule laid over the top: **nothing on this screen is a
 * number I made up.** Where the design shows a figure this database cannot
 * produce yet, the block says what it is waiting for instead of filling in
 * something plausible. The first screen of somebody's morning is the worst
 * possible place to be confidently wrong.
 *
 * The hero has four states and only one is ever visible, exactly as the
 * design has it: a VIP lead waiting, ready to start calling, not checked in,
 * and the VIP clock run out. Which one shows is decided by the data, not by a
 * switch.
 */

interface Lead {
  id: string;
  name: string | null;
  phone: string | null;
  project: string | null;
  stage: string;
  score: number | null;
  nextStepAt: string | null;
  nextStepNote: string | null;
  lastContactAt: string | null;
  isVip: boolean;
}

interface AgentHome {
  role: 'agent';
  me: { name: string; firstName: string };
  now: string;
  attendance: {
    closed: boolean; marked: 'office' | 'outside' | null; markedAt: string | null;
    wasLate: boolean; note: string | null; onOfficeNetwork: boolean;
    enabled: boolean; startsAt: string | null;
  };
  counts: Record<string, number>;
  freeLeads: number;
  today: { calls: number; answered: number; messages: number; meetings: number; newLeads: number };
  goals: { calls: number; messages: number; meetings: number };
  streakDays: number;
  kudosThisMonth: number;
  byStage: Array<{ stage: string; n: number }>;
  nextUp: Lead | null;
  callNow: Lead[];
  vip: {
    id: string; leadId: string; name: string | null; phone: string | null;
    project: string | null; givenBy: string; note: string | null;
    deadlineAt: string | null; accepted: boolean;
  } | null;
  waitingUpdate: Array<{
    id: string; app: 'whatsapp' | 'telegram'; name: string | null;
    leadId: string | null; tappedAt: string;
  }>;
  linkOpens: Array<{
    name: string | null; leadId: string | null; label: string | null;
    kind: string; openedAt: string; opens: number;
  }>;
  transfersForMe: number;
  tasksOverdue: number;
  unread: number;
  banners: Array<{ id: string; title: string; body: string | null; linkUrl: string | null }>;
}

interface OwnerHome {
  role: 'owner';
  me: { name: string; firstName: string };
  now: string;
  needsYou: Array<{ kind: string; text: string; n: number; action: string; to: string }>;
  teamToday: { inOffice: number; late: number; outside: number; absent: number; closed: boolean };
  todayNumbers: Record<string, number>;
  teamRightNow: Array<{
    id: string; name: string; photoUrl: string | null; marked: string | null;
    openLeads: number; callsToday: number; lastSeenAt: string | null;
  }>;
  freeLeads: number;
  banners: Array<{ id: string; title: string; body: string | null; linkUrl: string | null }>;
  unread: number;
}

type HomeData = AgentHome | OwnerHome;

export function V2Home() {
  const home = useAsync<HomeData>(() => api.get('/api/v2/home'), []);

  if (home.error) return <ErrorNote>{home.error}</ErrorNote>;
  if (!home.data) return <Spinner />;

  return home.data.role === 'agent'
    ? <MyDay home={home.data} reload={home.reload} />
    : <OwnerDay home={home.data} />;
}

/* ── greeting ──────────────────────────────────────────────────────────── */

/**
 * Morning, afternoon or evening — in Dubai.
 *
 * The server sends the Dubai wall clock as a sentence; the word in front of
 * the name has to agree with it, so the hour is read out of that sentence
 * rather than from the browser. An agent in Dubai and a laptop still on
 * European time must not see different greetings.
 */
function greet(now: string): string {
  const hour = Number(now.match(/(\d{2}):\d{2}$/)?.[1] ?? '12');
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ── the agent's day ───────────────────────────────────────────────────── */

function MyDay({ home, reload }: { home: AgentHome; reload: () => void }) {
  const [saying, setSaying] = useState<string | null>(null);
  const isPhone = useIsPhone();
  const toCall = home.counts.today ?? 0;
  const checkedIn = home.attendance.marked !== null;

  /*
   * Which hero. The order is the order of urgency, and it is the data that
   * decides: a VIP lead with a deadline beats everything, a run-out clock
   * beats the call list, and not being checked in beats being told to start.
   */
  const vipOver = home.vip !== null
    && !home.vip.accepted
    && home.vip.deadlineAt !== null
    && new Date(home.vip.deadlineAt).getTime() <= Date.now();
  const state = home.vip && !vipOver ? 'vip'
    : vipOver ? 'over'
      : (!checkedIn && home.attendance.enabled && !home.attendance.closed) ? 'out'
        : 'ready';

  async function act(path: string, said: string) {
    try {
      await api.post(path, {});
      setSaying(said);
      reload();
    } catch (err) {
      setSaying(err instanceof Error ? err.message : 'That did not work.');
    }
  }

  return (
    /* `p-my-day` turns on the design's own styles for this page. Every page
       block in `v2-home.css` is scoped to one of these, so two pages can use
       the same class name for different things, exactly as the design does. */
    <div className="v2-home p-my-day">
      <h1 className="v2-hi">
        {greet(home.now)}, {home.me.firstName}
        <span>{home.now}</span>
      </h1>

      {/* `Main.dc.html` puts the banner carousel directly under the greeting,
          above everything the day holds. The computer page keeps it at the
          foot of the column, so only the phone moves it. */}
      {isPhone && home.banners.length > 0 && <Banners banners={home.banners} phone />}

      {/* What Homes AI would say, when it can say it from real figures. */}
      <AiLine home={home} />

      <div className="d-bento v2-row1">
        <section className="d-card d-hero d-c-8" data-state={state} aria-label="What to do now">
          {state === 'vip' && home.vip && (
            <VipHero
              vip={home.vip}
              onAccept={() => act(`/api/v2/vip/${home.vip?.id}/accept`, `${home.vip?.givenBy} is told you accepted.`)}
              onRefuse={() => act(
                `/api/v2/vip/${home.vip?.id}/refuse`,
                `Sent back to ${home.vip?.givenBy}.`,
              )}
              saying={saying}
            />
          )}

          {state === 'over' && home.vip && (
            <div className="d-hs d-h-over">
              <div className="d-left">
                <div className="d-row"><span className="d-hero-chip">VIP LEAD · the time has passed</span></div>
                <h2>Time is over · back in Incoming</h2>
                <p className="d-muted">
                  {home.vip.name ?? 'The lead'} was not called in time. It goes back for
                  {' '}{home.vip.givenBy} to give again.
                </p>
                <div className="d-hero-btns">
                  <Link className="d-btn d-on-dark d-lg" to="/v2/leads?tab=today">OK, show my call list</Link>
                </div>
              </div>
              <div className="d-side"><div className="d-lockbox v2-lock-red"><Icon name="clock" /></div></div>
            </div>
          )}

          {state === 'out' && (
            <div className="d-hs d-h-out">
              <div className="d-left">
                <div className="d-row">
                  <span className="d-hero-chip">
                    {home.attendance.onOfficeNetwork
                      ? 'OFFICE WI-FI FOUND'
                      : 'NOT ON THE OFFICE NETWORK'}
                  </span>
                </div>
                <h2>Ready to start your day?</h2>
                <p className="d-muted">
                  {home.attendance.startsAt
                    ? `Shift starts ${home.attendance.startsAt} · check-in works only on the office network.`
                    : 'Check-in works only on the office network.'}
                </p>
                <div className="d-hero-btns">
                  <button
                    type="button"
                    className="d-btn d-on-dark d-primary d-lg"
                    disabled={!home.attendance.onOfficeNetwork}
                    onClick={() => act('/api/attendance/check-in', 'You are checked in. Have a good day.')}
                  >
                    <Icon name="check" />Check in
                  </button>
                  <Link className="d-btn d-on-dark d-lg" to="/v2/attendance">
                    <Icon name="pin" />I&apos;m working outside today
                  </Link>
                  {saying && <span className="d-said">{saying}</span>}
                </div>
              </div>
              <div className="d-side">
                <div className="d-lockbox"><Icon name="lock" /></div>
                <span className="d-ring-cap">
                  <b>Check in to start calling</b><br />
                  {toCall > 0 ? `${toCall} leads wait for you` : 'Nothing is due yet today'}
                </span>
              </div>
            </div>
          )}

          {state === 'ready' && (
            <div className="d-hs d-h-ready">
              <div className="d-left">
                <div className="d-row d-gap-16 v2-ready-top">
                  <b className="d-num-hero">{toCall}</b>
                  <div className="d-grow">
                    <h2>{toCall > 0 ? 'Start calling' : 'Nothing is due today'}</h2>
                    <p className="d-muted">
                      {toCall > 0
                        ? `${toCall} ${toCall === 1 ? 'lead is' : 'leads are'} ready today, one at a time.`
                        : 'Every follow-up you promised is done. Worth a look at your hot leads.'}
                    </p>
                  </div>
                </div>
                {home.nextUp && <Next lead={home.nextUp} />}
                <div className="d-hero-btns">
                  {toCall > 0 ? (
                    <Link className="d-btn d-on-dark d-primary d-lg" to="/v2/calling">
                      <Icon name="phone" />Start calling · {toCall} ready
                    </Link>
                  ) : (
                    <Link className="d-btn d-on-dark d-primary d-lg" to="/v2/leads?tab=hot">
                      <Icon name="flame" />See my hot leads
                    </Link>
                  )}
                  <Link className="d-btn d-on-dark d-lg" to="/v2/leads?tab=today">See the list</Link>
                </div>
              </div>
              <div className="d-side d-goals">
                <Goal label="calls today" done={home.today.calls} of={home.goals.calls} accent />
                <Goal label="WhatsApp" done={home.today.messages} of={home.goals.messages} />
                <Goal label="meetings" done={home.today.meetings} of={home.goals.meetings} />
                <div className="d-streak">
                  <span><b>{home.streakDays} {home.streakDays === 1 ? 'day' : 'days'}</b>in a row</span>
                  <span><b>{home.kudosThisMonth}</b>kudos this month</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* `Main.dc.html` draws this between the VIP card and Next up, and
            the computer page has it too. It is the phone that needs it: a
            lead handed over with thirty minutes on it is missed unless the
            phone buzzes. */}
        {isPhone && <NotifyCard />}

        {/* Next plan. The promise with the nearest time on it. */}
        <section className="d-card d-c-4" aria-label="Next plan">
          <div className="d-card-head v2-head-tight">
            <h3>Next plan</h3>
            <Link className="d-card-link" to="/v2/calendar">Calendar <Icon name="arrow-right" /></Link>
          </div>
          {home.nextUp?.nextStepAt ? <NextPlan lead={home.nextUp} /> : (
            <p className="v2-none">
              Nothing is planned. Every lead should have a next step —
              {' '}<Link to="/v2/leads?tab=no_next_step">
                {home.counts.no_next_step ?? 0} have none
              </Link>.
            </p>
          )}
          {home.waitingUpdate.length > 0 && (
            <div className="d-np-ask">
              <Icon name="help-circle" />
              <div className="d-grow">
                <b>How did it go?</b>
                <span>
                  {home.waitingUpdate[0]?.name ?? 'A lead'} ·{' '}
                  {home.waitingUpdate[0]?.app === 'telegram' ? 'Telegram' : 'WhatsApp'} ·{' '}
                  {at(home.waitingUpdate[0]?.tappedAt)}
                </span>
              </div>
              <Link className="d-btn d-sm" to={`/v2/leads/${home.waitingUpdate[0]?.leadId ?? ''}`}>
                Answer
              </Link>
            </div>
          )}
        </section>
      </div>

      {/* Four tiles. Each number is a tab of the leads list, and clicking one
          opens exactly that tab — so the figure can always be checked. */}
      <div className="d-bento">
        <Tile to="/v2/leads?tab=all" label="My leads" n={home.counts.all ?? 0}
          note={home.today.newLeads > 0 ? `${home.today.newLeads} new today` : 'open right now'} />
        <Tile to="/v2/leads?tab=today" label="To call today" n={toCall}
          note={(home.counts.overdue ?? 0) > 0 ? `${home.counts.overdue} overdue` : 'all on time'}
          urgent={(home.counts.overdue ?? 0) > 0} />
        <Tile to="/v2/leads?tab=hot" label="Hot leads" n={home.counts.hot ?? 0} note="ready to buy" />
        <Tile to="/v2/calendar" label="Meetings today" n={home.today.meetings} note="in the calendar" />
      </div>

      {/* `Main.dc.html` keeps "Start calling · N ready" on the screen whatever
          else is on it. The hero only carries that button in its "ready"
          state, so a morning that opens on a VIP lead or on the check-in card
          had no way into the call list at all. */}
      {isPhone && state !== 'ready' && toCall > 0 && (
        <Link className="v2-a-start" to="/v2/calling">
          <Icon name="phone" />Start calling · {toCall} ready
        </Link>
      )}

      <div className="d-bento">
        {/* The call list: the same rows the dialler will walk, in the same order. */}
        <section className="d-card d-c-5" aria-label="Call list">
          <div className="d-card-head v2-head-tight">
            <h3>Call list <span className="d-muted">· VIP first</span></h3>
            <Link className="d-card-link" to="/v2/calling">One by one <Icon name="arrow-right" /></Link>
          </div>
          {home.callNow.length === 0
            ? <p className="v2-none">Nobody is waiting for a call. </p>
            : home.callNow.slice(0, 6).map((lead) => <CallRow key={lead.id} lead={lead} />)}
          <div className="d-card-foot v2-foot">
            <span className="d-nowrap">
              <b className="d-ink-2">{home.today.calls}</b> of {home.goals.calls} calls today
            </span>
            <div className="d-bar d-accent" style={{ '--v': `${pc(home.today.calls, home.goals.calls)}%` } as React.CSSProperties}><i /></div>
            <Link className="d-card-link" to="/v2/leads?tab=today">All {toCall} <Icon name="arrow-right" /></Link>
          </div>
        </section>

        {/* Best time to call now — the client's own clock, worked out in the
            browser from the phone number's country. */}
        <section className="d-card d-c-4" aria-label="Best time to call now">
          <div className="d-card-head v2-head-tight">
            <h3>Best time to call now</h3>
            <span className="d-chip">client&apos;s clock</span>
          </div>
          <BestTime leads={home.callNow} />
        </section>

        <div className="d-stack d-c-3">
          <section className="d-card v2-card-tight" aria-label="Follow-ups">
            <div className="d-card-head v2-head-tight">
              <h3>Follow-ups</h3>
              <Link className="d-card-link" to="/v2/follow-ups">All <Icon name="arrow-right" /></Link>
            </div>
            <div className="d-mini-stats">
              <Link className={(home.counts.overdue ?? 0) > 0 ? 'd-red' : ''} to="/v2/leads?tab=overdue">
                <b>{home.counts.overdue ?? 0}</b>Overdue
              </Link>
              <Link to="/v2/leads?tab=today"><b>{toCall}</b>Today</Link>
            </div>
          </section>

          <section className="d-card v2-card-tight" aria-label="Transfers">
            <div className="d-card-head v2-head-tight">
              <h3>Transfers</h3>
              {home.transfersForMe > 0 && (
                <span className="d-badge d-accent">{home.transfersForMe} for you</span>
              )}
            </div>
            {home.transfersForMe > 0
              ? (
                <Link className="d-srow" to="/v2/transfers">
                  <div className="d-grow">
                    <b>{home.transfersForMe} waiting for your answer</b>
                    <span>A colleague wants to pass you a lead</span>
                  </div>
                  <Icon name="chevron-right" />
                </Link>
              )
              : <p className="v2-none">Nothing to answer.</p>}
          </section>

          <section className="d-card v2-card-tight" aria-label="Waiting for your update">
            <div className="d-card-head v2-head-tight">
              <h3>Waiting for your update</h3>
              {home.waitingUpdate.length > 0 && <span className="d-badge">{home.waitingUpdate.length}</span>}
            </div>
            {home.waitingUpdate.length === 0
              ? <p className="v2-none">Nothing open.</p>
              : home.waitingUpdate.slice(0, 4).map((tap) => (
                <div className="d-srow" key={tap.id}>
                  <div className="d-grow">
                    <b>{tap.name ?? 'A lead'}</b>
                    <span>{tap.app === 'telegram' ? 'Telegram' : 'WhatsApp'} · {at(tap.tappedAt)}</span>
                  </div>
                  <Link className="d-btn d-xs" to={`/v2/leads/${tap.leadId ?? ''}`}>What happened?</Link>
                </div>
              ))}
            {home.linkOpens.map((open) => (
              <Link
                className="d-srow v2-srow-top"
                key={`${open.leadId}-${open.openedAt}`}
                to={`/v2/leads/${open.leadId ?? ''}`}
              >
                <span className="d-card-icon v2-icon-blue"><Icon name="link" /></span>
                <div className="d-grow">
                  <b>{open.name ?? 'Someone'} opened your link</b>
                  <span>
                    {open.label ?? open.kind} · {at(open.openedAt)}
                    {open.opens > 1 ? ` · ${open.opens} times` : ''}
                  </span>
                </div>
              </Link>
            ))}
          </section>
        </div>
      </div>

      {/* My leads by stage. The widths are the real proportions. */}
      <ByStage byStage={home.byStage} total={home.counts.all ?? 0} />

      {!isPhone && home.banners.length > 0 && <Banners banners={home.banners} />}
    </div>
  );
}

/**
 * "Turn on notifications" — `Main.dc.html`, and `my-day.html` has it too.
 *
 * Both designs draw this card and neither half of the build had it, so the
 * permission was never asked for on the one device where it matters. The
 * wording is the prototype's own. It shows itself only when there is
 * something to ask for: never once notifications are on, never when nobody
 * has set the Firebase keys, and never again after "not now".
 */
function NotifyCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [gone, setGone] = useState(() => {
    try { return localStorage.getItem('emir-notify-ask') === 'no'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void pushState().then((got) => { if (alive) setState(got); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  if (gone || state === null || state === 'on') return null;
  /* An iPhone in Safari has no switch to press and a browser that has been
     refused cannot be asked again: both are told what to do instead. */
  const canAsk = state === 'off' || state === 'not-configured';
  const install = state === 'unsupported' ? iosNeedsInstall() : true;

  async function turnOn() {
    setBusy(true);
    try {
      const got = await enablePush();
      if (got === 'not-configured') {
        /*
         * Nobody has set the Firebase keys yet, so nothing can be delivered
         * to a closed app — but the browser can still be asked, exactly as
         * the install guide asks it for a computer, and the answer is worth
         * having before the keys arrive. It says plainly what is missing
         * rather than claiming the lock screen now works.
         */
        const answer = await Notification.requestPermission();
        setSaid(answer === 'granted'
          ? 'This phone will show alerts. Leads on the lock screen need one more switch from the office.'
          : 'Your phone said no. Turn them on in its own settings.');
        return;
      }
      setState(got);
      setSaid(got === 'on'
        ? 'Notifications are on.'
        : got === 'blocked'
          ? 'Your phone refused. Turn them on in its own settings.'
          : 'That did not work.');
    } catch {
      setSaid('That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="d-card d-c-12 v2-a-notify" aria-label="Turn on notifications">
      <span className="v2-a-notify-ic"><Icon name="bell-ring" /></span>
      <div className="d-grow">
        <b>Turn on notifications</b>
        <p>
          New leads, meetings and follow-ups on your lock screen, like WhatsApp.
          Tap one and it opens the right page.
        </p>
        {said && <p className="v2-a-notify-said">{said}</p>}
        <div className="v2-a-notify-btns">
          {canAsk && (
            <button type="button" className="d-btn d-primary d-sm" disabled={busy} onClick={() => void turnOn()}>
              {busy ? 'Asking…' : 'Turn on'}
            </button>
          )}
          {install && <Link className="d-btn d-sm" to="/v2/settings/phone-app">How to install</Link>}
        </div>
      </div>
      <button
        type="button"
        className="v2-a-notify-x"
        aria-label="Not now"
        onClick={() => {
          try { localStorage.setItem('emir-notify-ask', 'no'); } catch { /* private mode */ }
          setGone(true);
        }}
      >
        <Icon name="x" />
      </button>
    </section>
  );
}

function VipHero({ vip, onAccept, onRefuse, saying }: {
  vip: NonNullable<AgentHome['vip']>;
  onAccept: () => void;
  onRefuse: () => void;
  saying: string | null;
}) {
  const left = useCountdown(vip.deadlineAt);
  /*
   * "I can't take it", which both designs draw and neither half of the build
   * offered — so an agent who could not take a VIP lead had no way to say so
   * and simply let the clock run out.
   *
   * Two taps, because sending a VIP lead back is not something to do by
   * brushing the screen. The wording is the prototype's own:
   * `refuseLabel: s.refConf ? 'Tap again to send it back' : 'I can’t take it'`.
   */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    /* Disarm itself, so a tap left armed does not fire on the next visit. */
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <div className="d-hs d-h-vip">
      <div className="d-left">
        <div className="d-row d-gap-8">
          <span className="d-hero-chip">
            {vip.accepted ? 'VIP LEAD · accepted · call now' : `VIP LEAD FROM ${vip.givenBy.toUpperCase()}`}
          </span>
        </div>
        <a className="d-hero-phone" href={vip.phone ? `tel:${vip.phone}` : undefined} dir="ltr">
          {vip.phone ?? 'No number'}
        </a>
        <div className="d-hero-who">
          <b>{vip.name ?? 'Unnamed lead'}</b>
          {vip.project && <span> · {vip.project}</span>}
        </div>
        {vip.note && <p className="d-hero-note"><b>{vip.givenBy}:</b> “{vip.note}”</p>}
        <div className="d-hero-btns">
          {vip.accepted ? (
            <>
              <a className="d-btn d-on-dark d-primary" href={vip.phone ? `tel:${vip.phone}` : undefined}>
                <Icon name="phone" />Call now
              </a>
              <Link className="d-btn d-on-dark" to={`/v2/leads/${vip.leadId}`}>Open the lead</Link>
            </>
          ) : (
            <>
              <button type="button" className="d-btn d-on-dark d-primary" onClick={onAccept}>
                <Icon name="check" />Accept VIP lead
              </button>
              <button
                type="button"
                className="d-btn d-on-dark"
                onClick={() => { if (armed) { onRefuse(); setArmed(false); } else setArmed(true); }}
              >
                {armed ? 'Tap again to send it back' : "I can’t take it"}
              </button>
            </>
          )}
          {saying && <span className="d-said">{saying}</span>}
        </div>
      </div>
      <div className="d-side">
        <div className="d-ring d-lg">
          <b className={left.urgent ? 'd-warn' : undefined}>{left.text}</b>
          <span>left to call</span>
        </div>
        <span className="d-ring-cap">Not called in time → back to Incoming</span>
      </div>
    </div>
  );
}

/**
 * The VIP clock.
 *
 * Counted down from the deadline the server sent, not from a number of
 * minutes handed to the browser: a phone whose clock is two minutes out would
 * otherwise show a countdown that disagrees with the one actually running,
 * and an agent would think they had time they did not.
 */
function useCountdown(deadlineAt: string | null): { text: string; urgent: boolean } {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!deadlineAt) return undefined;
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  if (!deadlineAt) return { text: 'no limit', urgent: false };
  const left = new Date(deadlineAt).getTime() - Date.now();
  if (left <= 0) return { text: 'time is over', urgent: true };
  const mins = Math.floor(left / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  return {
    text: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    urgent: left < 5 * 60_000,
  };
}

function Goal({ label, done, of, accent }: {
  label: string; done: number; of: number; accent?: boolean;
}) {
  return (
    <div className="d-goal">
      <div className="d-row">
        <b>{done}</b> of {of} {label}
        <span className="d-right">{pc(done, of)}%</span>
      </div>
      <div
        className={accent ? 'd-bar' : 'd-bar d-thin'}
        style={{ '--v': `${pc(done, of)}%` } as React.CSSProperties}
      >
        <i />
      </div>
    </div>
  );
}

function Next({ lead }: { lead: Lead }) {
  const origin = originOf(lead.phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  return (
    <div className="d-hero-who v2-next">
      <span>Next:</span> <b>{lead.name ?? 'Unnamed lead'}</b>
      <span>
        {lead.nextStepAt && ` · ${due(lead.nextStepAt)}`}
        {local && ` · ${origin?.name} ${local.time}`}
      </span>
    </div>
  );
}

function NextPlan({ lead }: { lead: Lead }) {
  const when = new Date(String(lead.nextStepAt));
  const mins = Math.round((when.getTime() - Date.now()) / 60_000);
  return (
    <>
      <div className="d-row gap-12 v2-np-row">
        <b className="d-np-time">
          {when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}
        </b>
        <span className={mins < 0 ? 'd-chip d-red' : 'd-chip d-amber'}>
          {mins < 0 ? `${gap(-mins)} late` : `in ${gap(mins)}`}
        </span>
      </div>
      <Link className="d-bold v2-np-what" to={`/v2/leads/${lead.id}`}>
        {lead.nextStepNote ?? 'Follow up'} · {lead.name ?? 'Unnamed lead'}
      </Link>
    </>
  );
}

function Tile({ to, label, n, note, urgent }: {
  to: string; label: string; n: number; note: string; urgent?: boolean;
}) {
  return (
    <Link className="d-card d-c-3 d-tile d-click" to={to}>
      <span className="d-label">{label}</span>
      <div className="d-stat-row">
        <b className="d-num">{n.toLocaleString()}</b>
        <span className={urgent ? 'd-chip d-red' : 'd-state'}>{note}</span>
      </div>
      <Icon name="arrow-up-right" />
    </Link>
  );
}

function CallRow({ lead }: { lead: Lead }) {
  const origin = originOf(lead.phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  return (
    <div className="d-crow">
      <Avatar name={lead.name ?? '?'} />
      <Link className="d-nm" to={`/v2/leads/${lead.id}`}>
        <b><em>{lead.name ?? 'Unnamed lead'}</em>{lead.isVip && <span className="v2-vip">VIP</span>}</b>
        <span className={lead.nextStepAt && new Date(lead.nextStepAt) < new Date() ? 'd-red' : undefined}>
          {lead.nextStepAt ? due(lead.nextStepAt) : (lead.project ?? 'No next step')}
          {local && ` · ${origin?.name} ${local.time}`}
        </span>
      </Link>
      <a className="d-btn d-xs" href={lead.phone ? `tel:${lead.phone}` : undefined}>
        <Icon name="phone" />Call
      </a>
    </div>
  );
}

/**
 * The three leads it is a decent hour to ring right now.
 *
 * Decided in the browser, because that is where the country-to-timezone table
 * lives (`lib/dialling.ts`). A lead whose local time is unknown is not a
 * candidate — guessing would be exactly the mistake that had an agent ringing
 * Germany at six in the morning.
 */
function BestTime({ leads }: { leads: Lead[] }) {
  const picks = useMemo(() => leads
    .map((lead) => {
      const origin = originOf(lead.phone);
      if (!origin) return null;
      const local = clockIn(origin.timeZone);
      if (!local) return null;
      const advice = whenToCall(local, origin.timeZone);
      return advice?.ok ? { lead, origin, local } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .slice(0, 3), [leads]);

  if (picks.length === 0) {
    return (
      <p className="v2-none">
        Nobody on your list is in a good hour to ring right now. The clock beside
        each lead says when they are.
      </p>
    );
  }

  return (
    <>
      {picks.map(({ lead, origin, local }) => (
        <div className="d-crow" key={lead.id}>
          <Avatar name={lead.name ?? '?'} />
          <Link className="d-nm" to={`/v2/leads/${lead.id}`}>
            <b><em>{lead.name ?? 'Unnamed lead'}</em></b>
            <span>{origin.name} {local.time} · good hour to ring</span>
          </Link>
          <a className="d-btn d-xs" href={lead.phone ? `tel:${lead.phone}` : undefined}>
            <Icon name="phone" />Call
          </a>
        </div>
      ))}
    </>
  );
}

const STAGES: Array<{ key: string; label: string; cls: string }> = [
  { key: 'new_lead', label: 'New', cls: 'd-new' },
  { key: 'attempted_contact', label: 'Called', cls: 'd-called' },
  { key: 'engaged_qualified', label: 'Interested', cls: 'd-interested' },
  { key: 'appointment_scheduled', label: 'Meeting', cls: 'd-meeting' },
  { key: 'deal_sent', label: 'Offer', cls: 'd-offer' },
  { key: 'won', label: 'Won', cls: 'd-won' },
];

function ByStage({ byStage, total }: { byStage: Array<{ stage: string; n: number }>; total: number }) {
  const found = new Map(byStage.map((row) => [row.stage, row.n]));
  if (total === 0) return null;

  return (
    <section className="d-card v2-stage-card" aria-label="My leads by stage">
      <div className="v2-stage-side">
        <h3>My leads by stage</h3>
        <Link className="d-small d-muted" to="/v2/leads?tab=all"><b className="d-ink-2">{total}</b> open leads</Link>
        <Link className="d-card-link" to="/v2/pipeline">Open pipeline <Icon name="arrow-right" /></Link>
      </div>
      <div className="d-pstrip">
        {STAGES.map((stage) => {
          const n = found.get(stage.key) ?? 0;
          return (
            <Link
              className={`d-pstage ${stage.cls}`}
              key={stage.key}
              to={`/v2/leads?tab=all&stage=${stage.key}`}
              style={{ '--g': Math.max(n, 1) } as React.CSSProperties}
            >
              <span className="d-nm">{stage.label}</span>
              <span className="d-ct">
                <b>{n}</b>
                <span>{total > 0 ? `${Math.round((n / total) * 100)}%` : '0%'}</span>
              </span>
              <i />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Banners({ banners, phone }: { banners: AgentHome['banners']; phone?: boolean }) {
  const [at_, setAt] = useState(0);
  useEffect(() => {
    if (banners.length < 2) return undefined;
    /* 4.5 s, as the design has it. Paused for anyone who asked for less
       motion — the whole product respects that setting. */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => setAt((n) => (n + 1) % banners.length), 4500);
    return () => window.clearInterval(timer);
  }, [banners.length]);

  const slide = banners[at_ % banners.length];
  if (!slide) return null;

  /*
   * On a phone the card loses its "From the office" heading and the dots go
   * under the slide, which is how `Main.dc.html` draws the carousel: the
   * chip inside the slide already says where the message came from, and the
   * heading cost a line of a 844px screen.
   */
  if (phone) {
    return (
      <section className="v2-a-banner" aria-label="From the office">
        <div className="v2-a-banner-slide">
          <span className="v2-a-banner-tag">FROM THE OFFICE</span>
          <b>{slide.title}</b>
          {slide.body && <p>{slide.body}</p>}
          {slide.linkUrl && (
            <a className="d-btn d-sm" href={slide.linkUrl} target="_blank" rel="noreferrer">
              Open <Icon name="arrow-right" />
            </a>
          )}
        </div>
        {banners.length > 1 && (
          <div className="v2-a-banner-dots">
            {banners.map((banner, i) => (
              <button
                type="button"
                key={banner.id}
                className={i === at_ ? 'v2-a-banner-dot v2-a-banner-dot-on' : 'v2-a-banner-dot'}
                aria-label={`Banner ${i + 1}`}
                onClick={() => setAt(i)}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="d-card v2-banners" aria-label="From the office">
      <div className="d-card-head">
        <h3>From the office</h3>
        <div className="d-dots">
          {banners.map((banner, i) => (
            <button
              type="button"
              key={banner.id}
              className={i === at_ ? 'd-on' : undefined}
              aria-label={`Slide ${i + 1}`}
              onClick={() => setAt(i)}
            />
          ))}
        </div>
      </div>
      <div className="d-slide d-on">
        <div className="d-txt">
          <h3>{slide.title}</h3>
          {slide.body && <p className="d-small d-muted">{slide.body}</p>}
          {slide.linkUrl && (
            <a className="d-btn d-sm d-mt-auto v2-self-start" href={slide.linkUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The one-line read at the top.
 *
 * Written here from the figures already on the page, not asked of a model:
 * it must never be the thing that invents something. When nothing stands out
 * it says so rather than reaching.
 */
function AiLine({ home }: { home: AgentHome }) {
  const line = useMemo((): string => {
    if ((home.counts.overdue ?? 0) > 0) {
      const n = home.counts.overdue ?? 0;
      return n === 1
        ? 'One follow-up is already past its time — start there.'
        : `${n} follow-ups are already past their time — start there.`;
    }
    if (home.linkOpens.length > 0) {
      const open = home.linkOpens[0];
      return `${open?.name ?? 'A lead'} opened your link`
        + `${(open?.opens ?? 1) > 1 ? ` ${open?.opens} times` : ''}. Worth a call.`;
    }
    if ((home.counts.no_next_step ?? 0) > 0) {
      return `${home.counts.no_next_step} leads have nobody coming back to them. `
        + 'That is the list to empty.';
    }
    if ((home.counts.today ?? 0) > 0) {
      return `${home.counts.today} to call today, and nothing overdue. A clean start.`;
    }
    return 'Nothing is overdue and nothing is due today.';
  }, [home]);

  return (
    <div className="d-ai-line">
      <span className="d-ai-tag"><Icon name="sparkles" />Homes AI</span>
      <p>{line}</p>
    </div>
  );
}

/* ── the owner's day ───────────────────────────────────────────────────── */

/**
 * One icon per kind of thing waiting on the owner.
 *
 * The same six the dashboard's brief uses, because they are the same six
 * rows: a lead late in one place and late in the other should not wear two
 * different faces.
 */
const NEEDS_ICON: Record<string, IconName> = {
  vip_late: 'alert-triangle',
  waiting: 'inbox',
  transfer: 'repeat',
  leave: 'calendar-days',
  absent: 'user-x',
  bug: 'alert-circle',
};

function OwnerDay({ home }: { home: OwnerHome }) {
  const n = home.todayNumbers;
  const isPhone = useIsPhone();
  return (
    <div className="v2-home p-owner-home">
      <h1 className="v2-hi">
        {greet(home.now)}, {home.me.firstName}
        <span>{home.now}</span>
      </h1>

      {/* `OwnerHome.dc.html` gives the first action a card of its own, with
          the line that says what it does, and puts the other two in a row
          under it. Three equal buttons is the computer layout. */}
      {isPhone ? (
        <>
          <Link className="v2-a-bigact" to="/v2/leads/new">
            <span className="v2-a-bigact-ic"><Icon name="plus" /></span>
            <span className="d-grow">
              <b>Add a lead and give it</b>
              <span>Type it once, pick the agent, mark it VIP</span>
            </span>
            <Icon name="chevron-right" />
          </Link>
          <div className="v2-a-acts2">
            <Link className="v2-a-act2" to="/v2/import"><Icon name="upload" />Import Excel</Link>
            <Link className="v2-a-act2" to="/v2/incoming">
              <Icon name="inbox" />Incoming · {home.freeLeads}
            </Link>
          </div>
        </>
      ) : (
        <div className="v2-owner-acts">
          <Link className="d-btn d-primary" to="/v2/leads/new"><Icon name="plus" />Add a lead and give it</Link>
          <Link className="d-btn" to="/v2/import"><Icon name="upload" />Import Excel</Link>
          <Link className="d-btn" to="/v2/incoming"><Icon name="inbox" />Incoming · {home.freeLeads}</Link>
        </div>
      )}

      <div className="d-bento">
        <section className="d-card d-c-7" aria-label="Needs you now">
          <div className="d-card-head"><h3>Needs you now</h3></div>
          {home.needsYou.length === 0
            ? (
              <p className="v2-none">
                Nothing is waiting on you. No unowned leads, no transfer to approve,
                no leave to answer.
              </p>
            )
            : home.needsYou.map((row) => (
              /* `OwnerHome.dc.html` gives every row an icon of its own: five
                 identical lines of text is a list nobody reads down. */
              <div className="d-srow" key={row.kind}>
                <span className="d-card-icon v2-a-need-ic"><Icon name={NEEDS_ICON[row.kind] ?? 'circle-alert'} /></span>
                <div className="d-grow">
                  <b>{row.n} {row.text}</b>
                </div>
                <Link className="d-btn d-xs" to={row.to}>{row.action}</Link>
              </div>
            ))}
        </section>

        <section className="d-card d-c-5" aria-label="Team today">
          <div className="d-card-head">
            <h3>Team today</h3>
            <Link className="d-card-link" to="/v2/attendance">Attendance <Icon name="arrow-right" /></Link>
          </div>
          {home.teamToday.closed
            ? <p className="v2-none">The office is closed today.</p>
            : (
              <div className="d-mini-stats">
                <Link to="/v2/attendance"><b>{home.teamToday.inOffice}</b>In office</Link>
                <Link className={home.teamToday.late > 0 ? 'd-red' : ''} to="/v2/attendance">
                  <b>{home.teamToday.late}</b>Late
                </Link>
                <Link to="/v2/attendance"><b>{home.teamToday.outside}</b>Outside</Link>
                <Link className={home.teamToday.absent > 0 ? 'd-red' : ''} to="/v2/attendance">
                  <b>{home.teamToday.absent}</b>Not marked
                </Link>
              </div>
            )}
        </section>
      </div>

      {/* `OwnerHome.dc.html` names this block before it starts counting. */}
      {isPhone && <p className="v2-a-sectionlabel">TODAY IN NUMBERS</p>}

      <div className="d-bento">
        <Tile to="/v2/leads?tab=new" label="New leads today" n={n.newLeads ?? 0} note="came in today" />
        {/* `owner-home.html` sends this one to Team live, which is where the
            same clicks are broken down by hour and by agent. */}
        <Tile to="/v2/team-live" label="Calls today" n={n.calls ?? 0} note={`${n.whatsapp ?? 0} WhatsApp · ${n.telegram ?? 0} Telegram`} />
        <Tile to="/v2/calendar" label="Meetings today" n={n.meetings ?? 0} note="in the calendar" />
        <Tile to="/v2/leads?tab=all" label="Units booked today" n={n.unitsBooked ?? 0} note="moved to Won" />
      </div>

      <div className="d-bento">
        <Tile to="/v2/leads?tab=overdue" label="Follow-ups overdue" n={n.overdue ?? 0}
          note={(n.overdue ?? 0) > 0 ? 'past their time' : 'all on time'} urgent={(n.overdue ?? 0) > 0} />
        <Tile to="/v2/leads?tab=no_next_step" label="No next step" n={n.noNextStep ?? 0}
          note="nobody coming back to them" urgent={(n.noNextStep ?? 0) > 0} />
        <Link className="d-card d-c-6 d-tile d-click" to="/v2/dashboard">
          <span className="d-label">The full dashboard</span>
          <div className="d-stat-row"><span className="d-state">Sources, agents, the funnel and the money</span></div>
          <Icon name="arrow-up-right" />
        </Link>
      </div>

      <section className="d-card" aria-label="Team right now">
        <div className="d-card-head">
          <h3>Team right now</h3>
          <Link className="d-card-link" to="/v2/team">Team <Icon name="arrow-right" /></Link>
        </div>
        {/*
          * Five columns at 390px put "Calls today" and "Last seen" off the
          * right-hand edge with nothing to say they were there. The phone
          * reads each person as a row instead, which is how every other list
          * in the phone design works.
          */}
        {isPhone ? (
          <>
            <div className="v2-a-live-head">
              <span className="v2-a-live-name">Agent</span>
              <span>Open</span><span>Calls</span><span>Seen</span>
            </div>
            {home.teamRightNow.map((row) => (
              <div className="v2-a-live-row" key={row.id}>
                <Avatar name={row.name} src={row.photoUrl ?? undefined} size={30} />
                <span className="v2-a-live-name">
                  {row.name}
                  <em>
                    {row.marked === 'office' ? 'In office'
                      : row.marked === 'outside' ? 'Outside' : 'Not marked'}
                  </em>
                </span>
                <span>{row.openLeads}</span>
                <span>{row.callsToday}</span>
                <span>{row.lastSeenAt ? at(row.lastSeenAt) : '—'}</span>
              </div>
            ))}
          </>
        ) : (
        <table className="v2-table">
          <thead>
            <tr><th>Who</th><th>Today</th><th>Open leads</th><th>Calls today</th><th>Last seen</th></tr>
          </thead>
          <tbody>
            {home.teamRightNow.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className="d-person">
                    <Avatar name={row.name} src={row.photoUrl ?? undefined} />
                    <span className="d-who"><b>{row.name}</b></span>
                  </span>
                </td>
                <td>
                  {row.marked === 'office' ? <span className="d-chip d-green">In office</span>
                    : row.marked === 'outside' ? <span className="d-chip d-blue">Outside</span>
                      : <span className="d-chip">Not marked</span>}
                </td>
                <td>{row.openLeads}</td>
                <td>{row.callsToday}</td>
                <td>{row.lastSeenAt ? at(row.lastSeenAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </section>

      {home.banners.length > 0 && <Banners banners={home.banners} phone={isPhone} />}
    </div>
  );
}

/* ── small shared helpers ──────────────────────────────────────────────── */

const pc = (done: number, of: number): number =>
  (of <= 0 ? 0 : Math.min(100, Math.round((done / of) * 100)));

/** A time, 24-hour, as the whole product writes them (v3 §5). */
function at(value: string | undefined): string {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

/**
 * A length of time a person would say out loud.
 *
 * "180 min late" is a number to decode; "3 hours late" is not, and "2 days
 * late" is the one that makes somebody pick up the phone.
 */
function gap(mins: number): string {
  if (mins < 60) return `${mins} min`;
  if (mins < 60 * 24) {
    const hours = Math.round(mins / 60);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  const days = Math.round(mins / (60 * 24));
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** "Overdue since 11:00", or "due 15:30" — whichever is true. */
function due(value: string): string {
  const when = new Date(value);
  const late = when.getTime() < Date.now();
  const sameDay = when.toDateString() === new Date().toDateString();
  const clock = at(value);
  const day = sameDay ? '' : ` ${when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  return late ? `Overdue since ${clock}${day}` : `Due ${clock}${day}`;
}
