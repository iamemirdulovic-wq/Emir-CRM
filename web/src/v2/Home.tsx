import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';
import { clockIn, originOf, whenToCall } from '../lib/dialling.js';
import { iosNeedsInstall, pushState, enablePush, type PushState } from '../lib/push.js';
import { useCallAction, type CallActions } from './call.js';
import { usePhoneHead } from './phone.js';
import { myDaySub, ownerHomeSub } from './subs.js';
import { HomeBanner } from './HomeBanner.js';

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

type Period = 'today' | 'week' | 'month' | 'year';

interface OwnerTeamRow {
  id: string;
  name: string;
  photoUrl: string | null;
  marked: string | null;
  wasLate: boolean;
  onLeave: boolean;
  checkedInAt: string | null;
  openLeads: number;
  callsToday: number;
  callsPerDay: number[];
  deskMax: number | null;
  deskName: string | null;
  overdue: number;
  lastSeenAt: string | null;
}

interface OwnerHome {
  role: 'owner';
  me: { name: string; firstName: string };
  now: string;
  clock: string;
  period: Period;
  needsYou: Array<{
    kind: string; text: string; sub: string | null; n: number;
    action: string; to: string; waitMinutes: number | null;
  }>;
  teamToday: {
    inOffice: number; late: number; outside: number; leave: number;
    absent: number; closed: boolean;
  };
  todayNumbers: Record<string, number>;
  work: {
    calls: number; callsPrevious: number; meetings: number; units: number;
    lastUnit: { agent: string | null; project: string | null; valueAed: number | null } | null;
    newLeadsToday: number; newLeadsYesterday: number;
    firstContactMinutes: number | null;
  };
  hours: Array<{ hour: number; calls: number; future: boolean }>;
  nowAcross: number | null;
  bestHour: number | null;
  pipeline: {
    total: number; open: number;
    stages: Array<{ key: string; label: string; tone: string; n: number; pct: number }>;
    lost: { n: number; pct: number };
  };
  teamRightNow: OwnerTeamRow[];
  desks: Array<{ name: string; maxOpenLeads: number | null }>;
  watch: {
    overdue: { n: number; who: Array<{ name: string; n: number }> };
    noNextStep: number;
    transfers: { n: number; needApproval: number };
    taps: { n: number; unanswered: number };
    cold: number;
  };
  latestLeads: Array<{
    id: string; name: string | null; phone: string | null; project: string | null;
    stage: string; agent: string | null; isVip: boolean; createdAt: string;
  }>;
  vipGiven: {
    total: number;
    rows: Array<{
      id: string; leadId: string; name: string | null; agent: string;
      project: string | null; givenAt: string; deadlineAt: string | null;
      acceptedAt: string | null; firstCallAt: string | null; returnedAt: string | null;
      stage: string;
    }>;
  };
  freeLeads: number;
  banners: Array<{ id: string; title: string; body: string | null; linkUrl: string | null }>;
  unread: number;
}

type HomeData = AgentHome | OwnerHome;

export function V2Home() {
  /*
   * The owner's period switch is a different answer from the server, not a
   * filter in the browser: the window decides which calls, meetings and units
   * are counted, and counting them here would mean shipping a year of rows to
   * draw four numbers. An agent's day has no period, so the parameter costs
   * them nothing.
   */
  const [period, setPeriod] = useState<Period>('today');
  const home = useAsync<HomeData>(() => api.get(`/api/v2/home?period=${period}`), [period]);

  if (home.error) return <ErrorNote>{home.error}</ErrorNote>;
  if (!home.data) return <Spinner />;

  return home.data.role === 'agent'
    ? <MyDay home={home.data} reload={home.reload} />
    : <OwnerDay home={home.data} period={period} onPeriod={setPeriod} />;
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
  const isPhone = useIsPhone();
  /*
   * `my-day.html` writes the date and the Dubai clock under the title. On the
   * phone the greeting in the page body carries it, and the header draws no
   * title at home at all -- so this line only ever shows on the computer,
   * where the design's page body has no greeting and the date would otherwise
   * be nowhere on the screen.
   *
   * The phone was showing it in both places: "Saturday 14 November 2026 ·
   * 15:30" under the title and "Saturday 14 November at 15:30" again over the
   * greeting. `Main.dc.html` writes the day once, above the greeting.
   */
  usePhoneHead(isPhone ? {} : { sub: myDaySub(home.now) });
  const [saying, setSaying] = useState<string | null>(null);
  /* One for the whole screen, handed to the hero and the call rows. Every
     Call on My day is recorded before the phone opens. */
  const dial = useCallAction({ source: 'lead' });
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

  /*
   * The phone draws the VIP lead as its own white card (`Main.dc.html`), so
   * the hero there never wears the VIP state — it falls back to whatever the
   * day would otherwise be saying. On the computer one card still carries all
   * four, as `my-day.html` has it.
   */
  const heroState = !isPhone || state !== 'vip' ? state
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

  /*
   * The hero card, built once and placed differently on the two screens.
   *
   * `Main.dc.html` puts the check-in card straight under the banner and
   * keeps "Today’s calls" for further down the screen, under the VIP lead
   * and the notifications card. The computer page has one slot for all
   * four states, which is why this is a value rather than two copies.
   */
  const hero = (
    <section className="d-card d-hero d-c-8" data-state={heroState} aria-label="What to do now">
      {heroState === 'vip' && home.vip && (
        <VipHero
          vip={home.vip}
          onAccept={() => act(`/api/v2/vip/${home.vip?.id}/accept`, `${home.vip?.givenBy} is told you accepted.`)}
          onRefuse={() => act(
            `/api/v2/vip/${home.vip?.id}/refuse`,
            `Sent back to ${home.vip?.givenBy}.`,
          )}
          saying={saying}
          dial={dial}
        />
      )}

      {heroState === 'over' && home.vip && (
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

      {heroState === 'out' && (
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

      {heroState === 'ready' && (
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
  );

  return (
    /* `p-my-day` turns on the design's own styles for this page. Every page
       block in `v2-home.css` is scoped to one of these, so two pages can use
       the same class name for different things, exactly as the design does. */
    <div className="v2-home p-my-day">
      {/* The check-in sheet and anything a recording could not do. */}
      {dial.banner}
      <h1 className="v2-hi">
        {/* One flex item, not three: on a phone `.v2-hi` is turned over so
            the date sits above the greeting, and a loose name would be
            turned over with it. */}
        {isPhone
          ? (
            <span className="v2-b-hi-line">
              {greet(home.now)}, <span className="v2-b-hi-name">{home.me.firstName}</span>
            </span>
          )
          : <>{greet(home.now)}, {home.me.firstName}</>}
        <span>{home.now}</span>
      </h1>

      {/* `Main.dc.html` puts the banner carousel directly under the greeting,
          above everything the day holds, and never leaves the space empty.
          The computer page keeps its own at the foot of the column. */}
      {isPhone && <HomeBanner banners={home.banners} />}

      {/* What Homes AI would say, when it can say it from real figures. The
          phone design keeps it for the very bottom ("Homes AI tip"), so on a
          phone it is rendered at the end of this screen instead. */}
      {!isPhone && <AiLine home={home} />}

      {/* The check-in card comes above the VIP lead on the phone, which is
          the order `Main.dc.html` draws them in. */}
      {isPhone && heroState !== 'ready' && hero}

      {/* The VIP lead, as its own card rather than the dark hero: the star,
          the clock, the owner's note and the two answers. */}
      {isPhone && state === 'vip' && home.vip && (
        <PhoneVip
          vip={home.vip}
          onAccept={() => act(`/api/v2/vip/${home.vip?.id}/accept`, `${home.vip?.givenBy} is told you accepted.`)}
          onRefuse={() => act(
            `/api/v2/vip/${home.vip?.id}/refuse`,
            `Sent back to ${home.vip?.givenBy}.`,
          )}
          saying={saying}
          dial={dial}
        />
      )}

      {/* `Main.dc.html` draws this under the VIP card, and the computer page
          has it too. It is the phone that needs it: a lead handed over with
          thirty minutes on it is missed unless the phone buzzes. */}
      {isPhone && <NotifyCard />}

      <div className="d-bento v2-row1">
        {(!isPhone || heroState === 'ready') && hero}

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
      {isPhone && heroState !== 'ready' && toCall > 0 && (
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
            : home.callNow.slice(0, 6).map((lead) => <CallRow key={lead.id} lead={lead} dial={dial} />)}
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
          <BestTime leads={home.callNow} dial={dial} />
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

      {/* "Homes AI tip" is the last block on `Main.dc.html`. */}
      {isPhone && <AiLine home={home} />}

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
    /*
     * `Main.dc.html` draws this one dark, with the bell in a bright square
     * and the three answers in a row underneath — not as a white card like
     * the rest of the screen. That is the point of it: it is the one thing on
     * My Day that is asking for something.
     */
    <section className="v2-b-notify" aria-label="Turn on notifications">
      <div className="v2-b-notify-top">
        <span className="v2-b-notify-ic"><Icon name="bell-ring" /></span>
        <div className="d-grow">
          <b>Turn on notifications</b>
          <p>
            New leads, meetings and follow-ups on your lock screen, like WhatsApp.
            Tap one and it opens the right page.
          </p>
        </div>
      </div>
      {said && <p className="v2-b-notify-said">{said}</p>}
      <div className="v2-b-notify-btns">
        {canAsk && (
          <button type="button" className="v2-b-notify-yes" disabled={busy} onClick={() => void turnOn()}>
            {busy ? 'Asking…' : 'Turn on'}
          </button>
        )}
        {install && (
          <Link className="v2-b-notify-how" to="/v2/settings/phone-app">How to install</Link>
        )}
        <button
          type="button"
          className="v2-b-notify-x"
          aria-label="Not now"
          onClick={() => {
            try { localStorage.setItem('emir-notify-ask', 'no'); } catch { /* private mode */ }
            setGone(true);
          }}
        >
          <Icon name="x" />
        </button>
      </div>
    </section>
  );
}

/**
 * The VIP lead on a phone — `design/screens/Main.dc.html`, card for card.
 *
 * A white card with an orange edge, not the dark hero the computer uses: the
 * star and the words "VIP LEAD FROM <who>" on the left, the clock counting
 * down on the right, the person, the owner's own note in a grey box, and two
 * plain answers — take it, or say you cannot. Under them, in small grey type,
 * what happens if neither is pressed.
 *
 * Every word on it is the owner's or the lead's. Where the design shows
 * "2BR · The Archive · AED 2.5M · cash buyer" this shows the project and the
 * number, because that is what a handed-over lead actually carries.
 */
function PhoneVip({ vip, onAccept, onRefuse, saying, dial }: {
  vip: NonNullable<AgentHome['vip']>;
  onAccept: () => void;
  onRefuse: () => void;
  saying: string | null;
  dial: CallActions;
}) {
  const left = useCountdown(vip.deadlineAt);
  /* Two taps to send a VIP lead back, as the prototype has it: `refuseLabel:
     s.refConf ? 'Tap again to send it back' : 'I can’t take it'`. */
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <section className="v2-b-vip" aria-label="VIP lead">
      <div className="v2-b-vip-top">
        <span className="v2-b-vip-from">
          <Icon name="star" size={14} />
          VIP lead from {vip.givenBy}
        </span>
        <span className="v2-b-vip-left">
          <Icon name="clock" size={14} />
          {vip.deadlineAt ? `${left.text} left to call` : 'No time limit'}
        </span>
      </div>

      <div className="v2-b-vip-who">
        {/* The design tints this one orange rather than giving it the usual
            colour from the name, because the whole card is the VIP card. */}
        <Avatar name={vip.name ?? '?'} size={50} colour="var(--accent-soft)" />
        <span className="d-grow">
          <b>{vip.name ?? 'Unnamed lead'}</b>
          <span dir="ltr">
            {vip.project ?? 'No project yet'}
            {vip.phone ? ` · ${vip.phone}` : ' · no number'}
          </span>
        </span>
      </div>

      {vip.note && (
        <p className="v2-b-vip-note">
          <b>{vip.givenBy}’s note: </b>{vip.note}
        </p>
      )}

      {vip.accepted ? (
        <>
          <p className="v2-b-vip-done">
            <Icon name="check" size={16} />
            Accepted · {vip.givenBy} was told · it is first in My leads
          </p>
          <div className="v2-b-vip-btns">
            <a
              className="v2-b-vip-yes"
              href={vip.phone ? `tel:${vip.phone}` : undefined}
              onClick={(e) => {
                if (!vip.phone) return;
                e.preventDefault();
                /* `leadId`, not `id`: `id` is the hand-over row, and a call
                   is recorded against the opportunity. */
                void dial.call({ id: vip.leadId, phone: vip.phone, name: vip.name });
              }}
            >
              <Icon name="phone" size={18} />Call now
            </a>
            <Link className="v2-b-vip-no" to={`/v2/leads/${vip.leadId}`}>Open the lead</Link>
          </div>
        </>
      ) : (
        <>
          <div className="v2-b-vip-btns">
            <button type="button" className="v2-b-vip-yes" onClick={onAccept}>
              <Icon name="check" size={18} />Accept VIP lead
            </button>
            <button
              type="button"
              className="v2-b-vip-no"
              onClick={() => { if (armed) { onRefuse(); setArmed(false); } else setArmed(true); }}
            >
              {armed ? 'Tap again to send it back' : 'I can’t take it'}
            </button>
          </div>
          <p className="v2-b-vip-foot">
            If you don’t call in time, the lead goes back to Incoming and {vip.givenBy} is told.
          </p>
        </>
      )}
      {saying && <p className="v2-b-vip-said">{saying}</p>}
    </section>
  );
}

function VipHero({ vip, onAccept, onRefuse, saying, dial }: {
  vip: NonNullable<AgentHome['vip']>;
  onAccept: () => void;
  onRefuse: () => void;
  saying: string | null;
  dial: CallActions;
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
        <a
          className="d-hero-phone"
          href={vip.phone ? `tel:${vip.phone}` : undefined}
          dir="ltr"
          onClick={(e) => {
            if (!vip.phone) return;
            e.preventDefault();
            /* `leadId`, not `id`: `id` is the hand-over row, and a call is
               recorded against the opportunity. */
            void dial.call({ id: vip.leadId, phone: vip.phone, name: vip.name });
          }}
        >
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
              <a
                className="d-btn d-on-dark d-primary"
                href={vip.phone ? `tel:${vip.phone}` : undefined}
                onClick={(e) => {
                  if (!vip.phone) return;
                  e.preventDefault();
                  void dial.call({ id: vip.leadId, phone: vip.phone, name: vip.name });
                }}
              >
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

function CallRow({ lead, dial }: { lead: Lead; dial: CallActions }) {
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
      <a
        className="d-btn d-xs"
        href={lead.phone ? `tel:${lead.phone}` : undefined}
        onClick={(e) => { if (!lead.phone) return; e.preventDefault(); void dial.call(lead); }}
      >
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
function BestTime({ leads, dial }: { leads: Lead[]; dial: CallActions }) {
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
          <a
            className="d-btn d-xs"
            href={lead.phone ? `tel:${lead.phone}` : undefined}
            onClick={(e) => { if (!lead.phone) return; e.preventDefault(); void dial.call(lead); }}
          >
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

/**
 * The computer's own banner card — `my-day.html` and `owner-home.html`.
 *
 * The phone draws a different thing entirely (`HomeBanner`), which is why
 * this one no longer has a phone branch.
 */
function Banners({ banners }: { banners: AgentHome['banners'] }) {
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
 * `owner-home.html`'s own six: a crown on the VIP row, the swap arrows on a
 * transfer, the tray on Incoming, a calendar on leave, the warning triangle on
 * somebody absent and the flag on a bug. Five identical lines of text is a
 * list nobody reads down.
 */
const NEEDS_ICON: Record<string, IconName> = {
  vip_late: 'crown',
  transfer: 'repeat',
  waiting: 'inbox',
  leave: 'calendar-days',
  absent: 'alert-triangle',
  bug: 'alert-circle',
};

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

/** What the calls card calls itself, by window. */
const CALLS_TITLE: Record<Period, string> = {
  today: 'Calls today',
  week: 'Calls this week',
  month: 'Calls this month',
  year: 'Calls this year',
};

/** What the delta is measured against, in the design's own words. */
const AGAINST: Record<Period, string> = {
  today: 'vs yesterday',
  week: 'vs last week',
  month: 'vs the month before',
  year: 'vs last year',
};

const STAGE_WORD: Record<string, string> = {
  new_lead: 'New',
  attempted_contact: 'Called',
  engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting',
  deal_sent: 'Offer',
  won: 'Won',
  lost: 'Lost',
};

/**
 * The phone's own icons for "Needs you now" — `OwnerHome.dc.html`.
 *
 * The owner named them himself on 14 Nov: "star, calendar, pin, inbox, pen".
 * They differ from the computer's six on purpose: the phone draws them small
 * inside a coloured square, where a crown and a warning triangle are the same
 * dark smudge, and the computer draws them larger on a black hero.
 */
const NEEDS_PHONE_ICON: Record<string, IconName> = {
  vip_late: 'star',
  leave: 'calendar-days',
  absent: 'map-pin',
  waiting: 'inbox',
  bug: 'pencil-line',
  transfer: 'repeat',
};

/** And the colour of the square behind each, the design's own six. */
const NEEDS_TONE: Record<string, string> = {
  vip_late: 'v2-b-ic-accent',
  leave: 'v2-b-ic-violet',
  absent: 'v2-b-ic-red',
  waiting: 'v2-b-ic-amber',
  bug: 'v2-b-ic-blue',
  transfer: 'v2-b-ic-green',
};

/**
 * The owner's home — `design/web/owner-home.html`, every block of it.
 *
 * The one rule over the top of the drawing: **no number here is invented.**
 * Where the design shows a figure this database cannot produce, the block
 * says what it is waiting for or is left out, and `docs/v2/questions-owner.md`
 * names the missing field. The first screen of the owner's morning is the
 * worst possible place to be confidently wrong.
 */
function OwnerDay({ home, period, onPeriod }: {
  home: OwnerHome; period: Period; onPeriod: (period: Period) => void;
}) {
  const isPhone = useIsPhone();
  /* `owner-home.html` writes the date alone -- no clock, unlike the agent's
     screen, which is the design's own distinction and not an oversight. On
     the phone `OwnerHome.dc.html` writes the day above the greeting and the
     top bar carries no sub-line at all, so showing it in both places put the
     date on the screen twice. */
  usePhoneHead(isPhone ? {} : { sub: ownerHomeSub() });

  /*
   * Two drawings, not one scaled down. `owner-home.html` is the computer page
   * — a twelve-column bento, a fixed-height hero, nine hour columns and a
   * six-column table. `OwnerHome.dc.html` is the phone, and it asks for a
   * different screen: the greeting, three actions, the same six things that
   * need the owner, the team, the day's numbers, and a way into the full
   * dashboard. Neither is a worse version of the other.
   */
  return isPhone
    ? <OwnerPhone home={home} />
    : <OwnerComputer home={home} period={period} onPeriod={onPeriod} />;
}

/* ── the owner's home on a phone — `design/screens/OwnerHome.dc.html` ───── */

function OwnerPhone({ home }: { home: OwnerHome }) {
  const n = home.todayNumbers;
  const t = home.teamToday;
  return (
    <div className="v2-home p-owner-home">
      <h1 className="v2-hi">
        <span className="v2-b-hi-line">
          {greet(home.now)}, <span className="v2-b-hi-name">{home.me.firstName}</span>
        </span>
        <span>{home.now}</span>
      </h1>

      {/* The same banner the agent gets, under the greeting — the owner's
          change list of 14 Nov, point 6 — and never an empty space. */}
      <HomeBanner banners={home.banners} />

      {/* The first action gets a card of its own with the line that says what
          it does; the other two share a row under it. */}
      <Link className="v2-a-bigact" to="/v2/leads/new">
        <span className="v2-a-bigact-ic"><Icon name="plus" /></span>
        <span className="d-grow">
          <b>Add a lead and give it</b>
          <span>Type it once, pick the agent, mark it VIP</span>
        </span>
        <Icon name="chevron-right" />
      </Link>
      {/* Each with its own soft colour square, as `OwnerHome.dc.html` draws
          them: violet on the import, orange on Incoming. Two plain black
          line icons read as one thing twice. */}
      <div className="v2-a-acts2">
        <Link className="v2-a-act2" to="/v2/import">
          <span className="v2-b-act-ic v2-b-ic-violet"><Icon name="upload" /></span>
          Import Excel
        </Link>
        <Link className="v2-a-act2" to="/v2/incoming">
          <span className="v2-b-act-ic v2-b-ic-accent"><Icon name="inbox" /></span>
          Incoming · {home.freeLeads}
        </Link>
      </div>

      <section className="d-card v2-b-needs" aria-label="Needs you now">
        <p className="v2-b-cardlabel">NEEDS YOU NOW</p>
        {home.needsYou.length === 0
          ? (
            <p className="v2-none">
              Nothing is waiting on you. No unowned leads, no transfer to approve,
              no leave to answer.
            </p>
          )
          : home.needsYou.map((row) => (
            <Link className="v2-b-need" key={`${row.kind}-${row.to}`} to={row.to}>
              <span className={`v2-b-need-ic ${NEEDS_TONE[row.kind] ?? 'v2-b-ic-plain'}`}>
                <Icon name={NEEDS_PHONE_ICON[row.kind] ?? 'circle-alert'} />
              </span>
              <span className="d-grow">
                <b>{row.text}</b>
                {/* The reason, which is what makes the row worth a tap:
                    "Bassam had 30 min · now back in Incoming". */}
                {row.sub && <span>{row.sub}</span>}
              </span>
              {/* A word, not a boxed button: five outlined buttons down one
                  card is five things shouting at once. */}
              <span className="v2-b-need-go">{row.action} ›</span>
            </Link>
          ))}
      </section>

      <div className="v2-b-teamhead">
        <h2>Team today</h2>
        <Link to="/v2/attendance">Attendance</Link>
      </div>
      {t.closed
        ? <p className="v2-none">The office is closed today.</p>
        : (
          <div className="v2-b-team4">
            <Link className="v2-b-t4 v2-b-t4-green" to="/v2/attendance?show=office">
              <b>{t.inOffice}</b><span>In office</span>
            </Link>
            <Link className="v2-b-t4 v2-b-t4-amber" to="/v2/attendance?show=late">
              <b>{t.late}</b><span>Late</span>
            </Link>
            <Link className="v2-b-t4 v2-b-t4-blue" to="/v2/attendance?show=outside">
              <b>{t.outside}</b><span>Outside</span>
            </Link>
            {/* The design's fourth box is "Absent / leave", because at 390px
                five will not fit and the two are one question. */}
            <Link
              className="v2-b-t4 v2-b-t4-red"
              to={`/v2/attendance?show=${t.absent > 0 ? 'absent' : 'leave'}`}
            >
              <b>{t.absent + t.leave}</b><span>Absent / leave</span>
            </Link>
          </div>
        )}

      <p className="v2-a-sectionlabel">TODAY IN NUMBERS</p>

      {/* Two across, so the block is half as long — the owner's point 5. */}
      <div className="d-bento v2-b-nums">
        <Tile to="/v2/leads?tab=new" label="New leads today" n={n.newLeads ?? 0} note="came in today" />
        <Tile
          to="/v2/team-live"
          label="Calls today"
          n={n.calls ?? 0}
          note={`${n.whatsapp ?? 0} WhatsApp · ${n.telegram ?? 0} Telegram`}
        />
        <Tile to="/v2/calendar" label="Meetings today" n={n.meetings ?? 0} note="in the calendar" />
        <Tile
          to="/v2/wall"
          label="Units booked today"
          n={n.unitsBooked ?? 0}
          note={unitNote(home.work.lastUnit, home.work.units)}
        />
        <Tile
          to="/v2/leads?tab=overdue"
          label="Follow-ups overdue"
          n={n.overdue ?? 0}
          note={(n.overdue ?? 0) > 0 ? 'past their time' : 'all on time'}
          urgent={(n.overdue ?? 0) > 0}
        />
        <Tile
          to="/v2/leads?tab=no_next_step"
          label="No next step"
          n={n.noNextStep ?? 0}
          note="nobody coming back to them"
          urgent={(n.noNextStep ?? 0) > 0}
        />
      </div>

      <Link className="v2-b-dashbtn" to="/v2/dashboard">
        <Icon name="layout-dashboard" size={18} />Open the full dashboard
      </Link>

      {/*
        * `OwnerHome.dc.html` ends at the dashboard button, so this sits below
        * it rather than in the middle of the design's own order. It is kept
        * because it is the only place on a phone that shows every agent's
        * open leads and what is overdue on them.
        *
        * Six columns at 390px put the last cell off the right-hand edge with
        * nothing to say it was there. Each person is a row instead, which is
        * how every other list in the phone design works.
        */}
      <section className="d-card" aria-label="Team right now">
        <div className="d-card-head">
          <h3>Team right now</h3>
          <Link className="d-card-link" to="/v2/team">Team <Icon name="arrow-right" /></Link>
        </div>
        <div className="v2-a-live-head">
          <span className="v2-a-live-name">Agent</span>
          <span>Open</span><span>Calls</span><span>Due</span>
        </div>
        {home.teamRightNow.map((row) => (
          <Link className="v2-a-live-row" key={row.id} to={`/v2/team/${row.id}`}>
            <Avatar name={row.name} src={row.photoUrl ?? undefined} size={30} />
            <span className="v2-a-live-name">
              {row.name}
              <em>{whereWord(row)}</em>
            </span>
            <span>{row.openLeads}</span>
            <span>{row.callsToday}</span>
            <span>{row.overdue}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}


/* ── the owner's home on a computer — `design/web/owner-home.html` ──────── */

function OwnerComputer({ home, period, onPeriod }: {
  home: OwnerHome; period: Period; onPeriod: (period: Period) => void;
}) {
  return (
    <div className="v2-home p-owner-home">
      {/* The page's title is the shell's. The design opens on its own top bar:
          the period switch, which moves the calls card and the meetings-and-
          units card and nothing else, and the live stamp. */}
      <div className="d-filters">
        <div className="d-seg" role="tablist" aria-label="Period">
          {PERIODS.map((one) => (
            <button
              key={one.key}
              type="button"
              role="tab"
              aria-selected={period === one.key}
              className={period === one.key ? 'd-on' : undefined}
              onClick={() => onPeriod(one.key)}
            >
              {one.label}
            </button>
          ))}
        </div>
        <span className="d-grow" />
        <span className="v2-live-stamp">Live · {home.clock}</span>
      </div>

      <OwnerAiLine home={home} />

      {/* ── row 1: the hero, the calls, and two small cards ─────────────── */}
      <div className="d-bento d-row1">
        <NeedsYou rows={home.needsYou} />
        <CallsToday home={home} period={period} />

        <div className="d-stack d-c-3">
          <section className="d-card d-mini" aria-label="New leads">
            <div className="d-card-head d-mb-0">
              <h3>New leads</h3>
              <span className="d-card-icon"><Icon name="users" /></span>
            </div>
            <div className="d-stat-row">
              <Link className="d-num" to="/v2/leads?tab=new">{home.work.newLeadsToday}</Link>
              <Delta
                n={home.work.newLeadsToday - home.work.newLeadsYesterday}
                note="vs yesterday"
              />
            </div>
            <Link className="d-card-link" to="/v2/incoming">
              <span className={home.freeLeads > 0 ? 'd-dot d-red' : 'd-dot d-green'} />
              <b className={home.freeLeads > 0 ? 'd-t-red' : 'd-t-green'}>
                {home.freeLeads > 0
                  ? `${home.freeLeads} ${home.freeLeads === 1 ? 'waits' : 'wait'} in Incoming`
                  : 'Incoming is empty'}
              </b>
              <Icon name="arrow-right" />
            </Link>
          </section>

          <section className="d-card d-mini" aria-label="Meetings and units">
            <div className="d-card-head d-mb-0">
              <h3>Meetings and units</h3>
              <span className="d-card-icon"><Icon name="calendar-days" /></span>
            </div>
            <div className="d-duo">
              <Link className="d-stat" to="/v2/calendar">
                <b className="d-num">{home.work.meetings}</b>
                <span className="d-label">Meetings booked</span>
              </Link>
              <Link className="d-stat" to="/v2/wall">
                <b className="d-num">{home.work.units}</b>
                <span className="d-label">
                  {home.work.units === 1 ? 'Unit booked' : 'Units booked'}
                </span>
              </Link>
            </div>
            <Link className="d-card-link" to="/v2/wall">
              {home.work.lastUnit?.agent && (
                <Avatar name={home.work.lastUnit.agent} size={20} />
              )}
              <span>{unitNote(home.work.lastUnit, home.work.units)}</span>
            </Link>
          </section>
        </div>
      </div>

      {/* ── row 2: the pipeline strip ───────────────────────────────────── */}
      <section className="d-card d-mt-16 v2-stage-card" aria-label="Pipeline">
        <div className="v2-stage-side">
          <h3>Pipeline</h3>
          <span className="d-small d-muted">
            <Link to="/v2/leads?tab=all">
              <b className="d-ink-2">{home.pipeline.total.toLocaleString()}</b> leads
            </Link>
            {' · '}
            <Link to="/v2/leads?tab=all">{home.pipeline.open.toLocaleString()} open</Link>
          </span>
          <Link className="d-card-link d-mt-4" to="/v2/pipeline">
            Open pipeline <Icon name="arrow-right" />
          </Link>
        </div>
        <div className="d-pstrip">
          {home.pipeline.stages.map((stage) => (
            <Link
              className={`d-pstage d-${stage.tone}`}
              key={stage.key}
              style={{ '--g': Math.max(stage.n, 1) } as React.CSSProperties}
              to={`/v2/pipeline?stage=${stage.key}`}
            >
              <span className="d-nm">{stage.label}</span>
              <span className="d-ct">
                <b>{stage.n.toLocaleString()}</b><span>{stage.pct}%</span>
              </span>
              <i />
            </Link>
          ))}
          <Link className="d-pstage d-lost" to="/v2/leads?tab=lost">
            <span className="d-nm">Lost · kept apart</span>
            <span className="d-ct">
              <b>{home.pipeline.lost.n.toLocaleString()}</b><span>{home.pipeline.lost.pct}%</span>
            </span>
            <i />
          </Link>
        </div>
      </section>

      {/* ── row 3: the team, the watch list and the shortcuts ───────────── */}
      <div className="d-bento d-mt-16">
        <TeamRightNow home={home} />

        <div className="d-stack d-c-4">
          <section className="d-card" aria-label="Watch list">
            <div className="d-card-head d-mb-0">
              <h3>Watch list</h3>
              <Link className="d-card-link" to="/v2/dashboard">
                Full dashboard <Icon name="arrow-right" />
              </Link>
            </div>
            <Watch
              to="/v2/leads?tab=overdue"
              title="Follow-ups overdue"
              note={home.watch.overdue.who.length > 0
                ? home.watch.overdue.who.map((one) => `${one.n} with ${one.name}`).join(' · ')
                : 'Nobody is late on a promise'}
              n={home.watch.overdue.n}
              red
              first
            />
            <Watch
              to="/v2/leads?tab=no_next_step"
              title="No next step"
              note="Leads with nothing planned"
              n={home.watch.noNextStep}
            />
            <Watch
              to="/v2/transfers"
              title="Transfers today"
              note={home.watch.transfers.needApproval > 0
                ? `${home.watch.transfers.needApproval} `
                  + `${home.watch.transfers.needApproval === 1 ? 'waits' : 'wait'} for your approval`
                : 'None waiting for you'}
              n={home.watch.transfers.n}
            />
            <Watch
              to="/v2/messaging"
              title="WhatsApp taps"
              note={home.watch.taps.unanswered > 0
                ? `${home.watch.taps.unanswered} with no “What happened?”`
                : 'Every one has an answer'}
              n={home.watch.taps.n}
            />
            {/*
              * "Going cold" is leads with no contact for seven days. The leads
              * list has no tab of its own for them yet, so this opens the
              * overdue list, which is the nearest true thing — see
              * `docs/v2/questions-owner.md`.
              */}
            <Watch
              to="/v2/leads?tab=overdue"
              title="Going cold"
              note="No contact for 7 days"
              n={home.watch.cold}
            />
          </section>

          <section className="d-card v2-dash-more" aria-label="Shortcuts">
            <Link className="d-shortcut" to="/v2/leads/new">
              <Icon name="crown" />
              <span className="d-grow">Add a lead and give it</span>
              <Icon name="arrow-right" />
            </Link>
            <Link className="d-shortcut" to="/v2/import">
              <Icon name="upload" />
              <span className="d-grow">Import Excel</span>
              <Icon name="arrow-right" />
            </Link>
            <Link className="d-shortcut" to="/v2/incoming">
              <Icon name="inbox" />
              <span className="d-grow">Incoming</span>
              {home.freeLeads > 0 && <span className="d-badge d-red">{home.freeLeads}</span>}
              <Icon name="arrow-right" />
            </Link>
          </section>
        </div>
      </div>

      {/* ── below the fold: the newest leads, and the VIP ones given out ── */}
      <div className="d-bento d-mt-32">
        <section className="d-card d-c-7" aria-label="Latest leads">
          <div className="d-card-head">
            <h3>Latest leads</h3>
            <Link className="d-card-link" to="/v2/leads?tab=all">
              All {home.pipeline.total.toLocaleString()} leads <Icon name="arrow-right" />
            </Link>
          </div>
          {home.latestLeads.length === 0
            ? <p className="v2-none">No lead has arrived yet.</p>
            : (
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Name</th><th>Project</th><th>Stage</th><th>Agent</th>
                    <th className="d-t-right">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {home.latestLeads.map((lead) => (
                    <tr key={lead.id}>
                      <td>
                        <Link to={`/v2/leads/${lead.id}`}>
                          <span className="d-t-main">{lead.name ?? 'Unnamed lead'}</span>
                          {lead.isVip && <> <span className="d-vip-tag">VIP</span></>}
                        </Link>
                        <div className="d-t-sub" dir="ltr">{lead.phone ?? 'No number'}</div>
                      </td>
                      <td>{lead.project ?? <span className="d-muted">No project</span>}</td>
                      <td>
                        <span className={`d-chip d-stage-${toneOf(lead.stage)}`}>
                          {STAGE_WORD[lead.stage] ?? lead.stage}
                        </span>
                      </td>
                      <td>
                        {lead.agent
                          ? (
                            <span className="d-person">
                              <Avatar name={lead.agent} size={26} />
                              {lead.agent}
                            </span>
                          )
                          : <Link className="d-chip d-red d-pip" to="/v2/incoming">Incoming</Link>}
                      </td>
                      <td className="d-t-right d-t-sub">{at(lead.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </section>

        <section className="d-card d-c-5" aria-label="VIP leads I gave">
          <div className="d-card-head">
            <h3>VIP leads I gave</h3>
            <Link className="d-card-link" to="/v2/vip">
              See all {home.vipGiven.total} <Icon name="arrow-right" />
            </Link>
          </div>
          {home.vipGiven.rows.length === 0
            ? (
              <p className="v2-none">
                You have not handed anybody a VIP lead yet. Mark one VIP when you add it and
                it shows here with its clock.
              </p>
            )
            : (
              <div className="d-divide">
                {home.vipGiven.rows.map((row) => (
                  <Link
                    className="d-list-row d-vip-row"
                    key={row.id}
                    to={`/v2/leads/${row.leadId}`}
                  >
                    <Avatar name={row.name ?? '?'} />
                    <span className="d-grow">
                      <b className="d-bold">{row.name ?? 'Unnamed lead'}</b>
                      <div className="d-small d-muted d-truncate">
                        <VipLine row={row} />
                      </div>
                    </span>
                    <VipChip row={row} />
                  </Link>
                ))}
              </div>
            )}
        </section>
      </div>

      {home.banners.length > 0 && <Banners banners={home.banners} />}
    </div>
  );
}

/**
 * The black hero — "Needs you now".
 *
 * The design's own: the count, "Only you can do these", the oldest wait, and
 * one row per thing with an icon, a name, a reason and a button. When nothing
 * is waiting it turns into the All clear card rather than an empty list,
 * which is `.d-clear` in the design's stylesheet and is why the empty state is
 * markup rather than a `return null`.
 */
function NeedsYou({ rows }: { rows: OwnerHome['needsYou'] }) {
  const waits = rows
    .map((row) => row.waitMinutes)
    .filter((one): one is number => one !== null);
  const oldest = waits.length > 0 ? Math.max(...waits) : null;

  return (
    <section
      className={rows.length === 0
        ? 'd-card d-hero d-c-5 d-id-needs d-clear'
        : 'd-card d-hero d-c-5 d-id-needs'}
      aria-label="Needs you now"
    >
      <div className="d-hero-top d-row d-gap-16">
        <b className="d-num-hero">{rows.length}</b>
        <div className="d-grow">
          {/* The design sizes this one heading by hand, as an inline style. */}
          <h2 style={{ fontSize: 20 }}>Needs you now</h2>
          <p className="d-muted d-small">Only you can do these</p>
        </div>
        <span className="d-hero-chip">
          {oldest === null ? 'No one is waiting' : `Oldest waits ${waited(oldest)}`}
        </span>
      </div>

      <div className="d-arows">
        {rows.map((row) => (
          <div className="d-arow" key={`${row.kind}-${row.to}`}>
            <span className={row.kind === 'vip_late' ? 'd-arow-ic d-accent' : 'd-arow-ic'}>
              <Icon name={NEEDS_ICON[row.kind] ?? 'circle-alert'} />
            </span>
            <Link className="d-arow-txt" to={row.to}>
              <b>
                {row.kind === 'vip_late' && <span className="d-vip-tag">VIP</span>}
                {row.text}
              </b>
              {row.sub && <span className="d-s">{row.sub}</span>}
            </Link>
            {/* Only the VIP row is the filled button, as the design has it:
                six orange buttons in a column is six things shouting. */}
            <Link
              className={row.kind === 'vip_late'
                ? 'd-btn d-sm d-on-dark d-primary' : 'd-btn d-sm d-on-dark'}
              to={row.to}
            >
              {row.action}
            </Link>
          </div>
        ))}
      </div>

      <div className="d-all-clear">
        <span className="d-ic"><Icon name="check" size={32} /></span>
        <b>All clear</b>
        <p>Nothing waits for you. New things show up here first.</p>
      </div>
    </section>
  );
}

/**
 * Calls, by the hour, with a "now" marker.
 *
 * The bars are always today, whatever the period switch says — the design
 * puts "Bars: today by hour" in its own foot for exactly that reason. The
 * number above them is the window's. A column later than this hour is drawn
 * as an empty slot rather than a zero, because nobody has had the chance yet.
 */
function CallsToday({ home, period }: { home: OwnerHome; period: Period }) {
  const biggest = Math.max(1, ...home.hours.map((one) => one.calls));
  const move = percent(home.work.calls, home.work.callsPrevious);

  return (
    <section className="d-card d-c-4" aria-label="Calls">
      <div className="d-card-head">
        <h3>{CALLS_TITLE[period]}</h3>
        <Link className="d-card-link" to="/v2/team-live">
          Team live <Icon name="arrow-right" />
        </Link>
      </div>

      <div className="d-calls-top">
        <Link className="d-num-hero" to="/v2/team-live">
          {home.work.calls.toLocaleString()}
        </Link>
        <div className="d-calls-side">
          <span>
            <span className={move.dir}>{move.word} {AGAINST[period]}</span>
          </span>
          <Link to="/v2/messaging">
            {period !== 'today' && 'Today: '}
            <b>{home.todayNumbers.whatsapp ?? 0}</b> WhatsApp
            {' · '}
            <b>{home.todayNumbers.telegram ?? 0}</b> Telegram
          </Link>
        </div>
      </div>

      <div
        className="d-bars d-id-calls-bars"
        style={{ '--max': biggest } as React.CSSProperties}
      >
        {home.hours.map((one) => {
          const classes = ['d-bar-col'];
          if (one.future) classes.push('d-future');
          else {
            if (home.bestHour !== null && one.hour === home.bestHour) classes.push('d-best');
            if (one.hour === thisHour(home.hours)) classes.push('d-now');
          }
          return (
            <div
              className={classes.join(' ')}
              key={one.hour}
              title={`${one.calls} ${one.calls === 1 ? 'call' : 'calls'} at ${clockOf(one.hour)}`}
            >
              <div className="d-bar-track">
                {one.future
                  ? <i />
                  : <i style={{ '--v': one.calls } as React.CSSProperties} data-val={one.calls} />}
              </div>
              <span className="d-bar-lab">{String(one.hour).padStart(2, '0')}</span>
            </div>
          );
        })}
        {home.nowAcross !== null && (
          <div
            className="d-bars-now"
            style={{ '--x': `${(home.nowAcross * 100).toFixed(1)}%` } as React.CSSProperties}
          >
            <span>now</span>
          </div>
        )}
      </div>

      <div className="d-card-foot">
        <Icon name="zap" />
        {period !== 'today' && <span>Bars: today by hour&nbsp;·&nbsp;</span>}
        <span>
          {home.work.firstContactMinutes === null
            ? 'No first answer recorded yet'
            : <>First contact: <b className="d-t-green">{home.work.firstContactMinutes} min</b> median</>}
        </span>
        <span className="d-right">
          {home.bestHour === null
            ? 'No calls yet today'
            : <>Best hour <b className="d-ink-2">{clockOf(home.bestHour)}</b></>}
        </span>
      </div>
    </section>
  );
}

/**
 * Team right now — the attendance bar, then everybody, problems first.
 *
 * Six columns: who, where, when they came in, calls today with a week behind
 * them, their open leads against the desk maximum, and what is overdue. The
 * order comes from the server, which puts the people who need something at
 * the top; an owner reads down until the rows stop being interesting.
 */
function TeamRightNow({ home }: { home: OwnerHome }) {
  const t = home.teamToday;
  const bands: Array<{ key: string; colour: string; word: string; n: number }> = [
    { key: 'office', colour: 'd-green', word: 'In office', n: t.inOffice },
    { key: 'late', colour: 'd-amber', word: 'Late', n: t.late },
    { key: 'outside', colour: 'd-blue', word: 'Outside', n: t.outside },
    { key: 'leave', colour: 'd-violet', word: 'Leave', n: t.leave },
    { key: 'absent', colour: 'd-red', word: 'Absent', n: t.absent },
  ];
  const marked = bands.reduce((sum, one) => sum + one.n, 0);

  return (
    <section className="d-card d-c-8" aria-label="Team right now">
      <div className="d-card-head">
        <h3>Team right now</h3>
        <Link className="d-card-link" to="/v2/attendance">
          Attendance <Icon name="arrow-right" />
        </Link>
      </div>

      {t.closed
        ? <p className="v2-none">The office is closed today.</p>
        : marked === 0
          ? <p className="v2-none">Nobody is asked to check in today.</p>
          : (
            <div className="d-att-head">
              <div className="d-segbar d-tall">
                {bands.filter((band) => band.n > 0).map((band) => (
                  <Link
                    key={band.key}
                    className={band.colour}
                    style={{ '--v': band.n } as React.CSSProperties}
                    to={`/v2/attendance?show=${band.key}`}
                    aria-label={`${band.n} ${band.word.toLowerCase()}`}
                  />
                ))}
              </div>
              <div className="d-legend">
                {bands.map((band) => (
                  <Link key={band.key} to={`/v2/attendance?show=${band.key}`}>
                    <span className={`d-dot ${band.colour}`} />
                    <b>{band.n}</b> {band.word}
                  </Link>
                ))}
              </div>
            </div>
          )}

      <table className="d-table d-compact d-id-team">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th>In</th>
              <th>Calls today · 7 days</th>
              <th>Open · desk max</th>
              <th className="d-t-right">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {home.teamRightNow.map((row) => {
              const over = row.deskMax !== null && row.openLeads > row.deskMax;
              return (
                <tr key={row.id}>
                  <td>
                    <Link className="d-person" to={`/v2/team/${row.id}`}>
                      <Avatar name={row.name} src={row.photoUrl ?? undefined} size={26} />
                      <span className="d-who"><b>{row.name}</b></span>
                    </Link>
                  </td>
                  <td>
                    <span className={`d-chip d-att-${whereKey(row)}`}>{whereWord(row)}</span>
                  </td>
                  <td className="d-t-mono">{row.checkedInAt ?? '–'}</td>
                  <td>
                    <Link className="d-cell-bar" to="/v2/team-live">
                      <b className={row.callsToday === 0 ? 'd-muted' : undefined}>
                        {row.callsToday}
                      </b>
                      <Spark days={row.callsPerDay} label={`${row.name}: calls over seven days`} />
                    </Link>
                  </td>
                  <td>
                    <Link
                      className="d-cell-bar"
                      to={`/v2/leads?tab=all&agent=${row.id}`}
                      title={row.deskMax === null
                        ? `${row.openLeads} open · no desk maximum set`
                        : `${row.openLeads} of ${row.deskMax} · ${row.deskName}`}
                    >
                      <b className={over ? 'd-t-red' : undefined}>{row.openLeads}</b>
                      {row.deskMax === null
                        ? <span className="d-small d-muted">no max</span>
                        : (
                          <span
                            className={over ? 'd-bar d-load d-red' : 'd-bar d-load'}
                            style={{
                              '--v': `${Math.min(100, (row.openLeads / row.deskMax) * 80).toFixed(0)}%`,
                              '--max': '80%',
                            } as React.CSSProperties}
                          >
                            <i />
                          </span>
                        )}
                    </Link>
                  </td>
                  <td className="d-t-right">
                    {row.overdue > 0
                      ? (
                        <Link className="d-overdue" to={`/v2/leads?tab=overdue&agent=${row.id}`}>
                          {row.overdue}
                        </Link>
                      )
                      : <span className="d-muted">0</span>}
                  </td>
                </tr>
              );
            })}
            {home.teamRightNow.length === 0 && (
              <tr><td colSpan={6}><span className="d-small d-muted">No agents yet.</span></td></tr>
            )}
        </tbody>
      </table>

      <div className="d-card-foot">
        <Icon name="info" />
        <span>
          Problems first. The small line on each bar is the desk maximum
          {home.desks.length > 0
            ? `: ${home.desks.map((desk) => `${desk.name} ${desk.maxOpenLeads}`).join(' · ')}.`
            : '. No desk has one set yet.'}
        </span>
        <Link className="d-card-link v2-dash-right" to="/v2/settings/desks">
          Desks <Icon name="arrow-right" />
        </Link>
      </div>
    </section>
  );
}

/** One row of the watch list. */
function Watch({ to, title, note, n, red, first }: {
  to: string; title: string; note: string; n: number; red?: boolean; first?: boolean;
}) {
  return (
    <Link className={first ? 'd-watch d-mt-8' : 'd-watch'} to={to}>
      <span className="d-grow">
        <b>{title}</b>
        <span>{note}</span>
      </span>
      <b className={red && n > 0 ? 'd-n d-red' : 'd-n'}>{n.toLocaleString()}</b>
      <Icon name="chevron-right" />
    </Link>
  );
}

/**
 * The one line at the top, written from the figures already on the page.
 *
 * Not asked of a model: this is the sentence most likely to be read and least
 * likely to be checked, so it must never be the thing that invents something.
 * When nothing stands out it says so rather than reaching.
 */
function OwnerAiLine({ home }: { home: OwnerHome }) {
  const said = useMemo((): { text: string; to: string | null; link: string | null } => {
    const vip = home.needsYou.find((row) => row.kind === 'vip_late');
    if (vip) {
      return {
        text: `${vip.text}. `,
        link: 'Give it to somebody who can call now',
        to: '/v2/incoming',
      };
    }
    if (home.freeLeads > 0) {
      return {
        text: `${home.freeLeads} ${home.freeLeads === 1 ? 'lead has' : 'leads have'} nobody on them. `,
        link: 'Give them out',
        to: '/v2/incoming',
      };
    }
    if (home.watch.overdue.n > 0) {
      const worst = home.watch.overdue.who[0];
      return {
        text: `${home.watch.overdue.n} follow-ups are past their time`
          + `${worst ? `, ${worst.n} of them with ${worst.name}` : ''}. `,
        link: 'See what is late',
        to: '/v2/leads?tab=overdue',
      };
    }
    if (home.work.calls > home.work.callsPrevious && home.work.callsPrevious > 0) {
      const move = percent(home.work.calls, home.work.callsPrevious);
      return {
        text: `Calls are ${move.word} ${AGAINST[home.period]}, and nothing is waiting on you. `,
        link: null,
        to: null,
      };
    }
    if (home.watch.cold > 0) {
      return {
        text: `${home.watch.cold} leads have had no contact for a week. `,
        link: 'Move them before they are lost',
        to: '/v2/dashboard',
      };
    }
    return { text: 'Nothing is waiting on you and nothing is overdue.', link: null, to: null };
  }, [home]);

  return (
    <div className="d-ai-line d-fade-in">
      <span className="d-ai-tag"><Icon name="sparkles" size={14} />Homes AI</span>
      <p>
        {said.text}
        {said.link && said.to && <Link to={said.to}>{said.link}</Link>}
      </p>
      <Link className="d-btn d-sm d-ghost" to="/v2/ai">
        Ask Homes AI <Icon name="arrow-right" size={14} />
      </Link>
    </div>
  );
}

/* ── the owner's small pieces ──────────────────────────────────────────── */

/** "4 vs yesterday", up or down, the design's own pill. */
function Delta({ n, note }: { n: number; note: string }) {
  if (n === 0) return <span className="d-delta">same {note}</span>;
  return (
    <span className={n > 0 ? 'd-delta d-up' : 'd-delta d-down'}>
      {Math.abs(n)} {note}
    </span>
  );
}

/**
 * A week of calls as a line.
 *
 * Inline SVG because that is what `.d-spark` styles: `stroke` on a polyline,
 * a filled path behind it and a dot at the end. A flat week draws a flat line
 * rather than nothing, which is the honest picture of a quiet week.
 */
function Spark({ days, label }: { days: number[]; label: string }) {
  const W = 72;
  const H = 22;
  if (days.length < 2) return <svg className="d-spark" viewBox={`0 0 ${W} ${H}`} aria-hidden />;

  const top = Math.max(...days);
  const low = Math.min(...days);
  const span = top - low || 1;
  const points = days.map((value, i) => [
    (i / (days.length - 1)) * (W - 6) + 3,
    H - 4 - ((value - low) / span) * (H - 8),
  ] as const);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1] as readonly [number, number];

  return (
    <svg
      className={top === 0 ? 'd-spark d-flat' : 'd-spark'}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      focusable={false}
    >
      <path d={`M${line.replace(/ /g, ' L')} L${W - 3},${H} L3,${H} Z`} />
      <polyline points={line} vectorEffect="non-scaling-stroke" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.4" />
    </svg>
  );
}

/** What became of a VIP lead the owner handed out. */
function VipChip({ row }: { row: OwnerHome['vipGiven']['rows'][number] }) {
  if (row.returnedAt) return <span className="d-chip d-red d-pip">Came back</span>;
  if (row.stage === 'won') return <span className="d-chip d-stage-won">Won</span>;
  if (row.firstCallAt) {
    return (
      <span className={`d-chip d-stage-${toneOf(row.stage)}`}>
        {STAGE_WORD[row.stage] ?? 'Called'}
      </span>
    );
  }
  if (row.acceptedAt) return <span className="d-chip d-green">Accepted</span>;
  return <span className="d-chip d-amber d-pip">Waiting</span>;
}

/** The line under a VIP lead's name: who has it, when, and what is left. */
function VipLine({ row }: { row: OwnerHome['vipGiven']['rows'][number] }) {
  const left = useCountdown(row.firstCallAt || row.returnedAt ? null : row.deadlineAt);
  const given = `${row.agent} · given ${at(row.givenAt)}`;
  if (row.returnedAt) return <>{given} · not called</>;
  if (row.firstCallAt) {
    return <>{given}{row.project ? ` · ${row.project}` : ''}</>;
  }
  if (!row.deadlineAt) return <>{given} · no time limit</>;
  return <>{given} · <span className="d-cd">{left.text}</span> left to call</>;
}

/* ── small helpers the owner's day needs ───────────────────────────────── */

/** "12% up", "the same" — a move between two counts, in words. */
function percent(now: number, before: number): { word: string; dir: string } {
  if (before === 0) {
    if (now === 0) return { word: 'none yet', dir: 'd-delta' };
    return { word: 'all new', dir: 'd-delta d-up' };
  }
  const move = Math.round(((now - before) / before) * 100);
  if (move === 0) return { word: 'the same', dir: 'd-delta' };
  return {
    word: `${Math.abs(move)}%`,
    dir: move > 0 ? 'd-delta d-up' : 'd-delta d-down',
  };
}

/** "10:00", from the hour number. */
const clockOf = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/** The last hour that has started, which the design paints orange. */
function thisHour(hours: OwnerHome['hours']): number | null {
  const done = hours.filter((one) => !one.future);
  return done.length === 0 ? null : (done[done.length - 1] as { hour: number }).hour;
}

/** Which of the five attendance colours somebody is wearing. */
function whereKey(row: OwnerTeamRow): string {
  if (row.marked === 'office') return row.wasLate ? 'late' : 'office';
  if (row.marked === 'outside') return 'outside';
  if (row.onLeave) return 'leave';
  return 'absent';
}

function whereWord(row: OwnerTeamRow): string {
  if (row.marked === 'office') {
    return row.wasLate ? `Late${row.checkedInAt ? ` · ${row.checkedInAt}` : ''}` : 'In office';
  }
  if (row.marked === 'outside') return 'Outside';
  if (row.onLeave) return 'On leave';
  return 'Absent';
}

/**
 * How long the oldest thing has waited.
 *
 * Minutes while minutes still mean something — the design writes "Oldest
 * waits 75 min" and that is more use to an owner than "1 hour" — and the
 * spoken form once a bug report has been sitting for days.
 */
function waited(minutes: number): string {
  return minutes < 120 ? `${minutes} min` : gap(minutes);
}

/** The stage's colour class, which the design keys off the stage's own name. */
function toneOf(stage: string): string {
  const tone: Record<string, string> = {
    new_lead: 'new',
    attempted_contact: 'called',
    engaged_qualified: 'interested',
    appointment_scheduled: 'meeting',
    deal_sent: 'offer',
    won: 'won',
    lost: 'lost',
  };
  return tone[stage] ?? 'new';
}

/**
 * The line under "Meetings and units".
 *
 * The newest deal in the window, named. Money only when the deal carries a
 * value — a unit booked with no figure on it says so rather than showing a
 * zero that reads as a free flat.
 */
function unitNote(
  last: OwnerHome['work']['lastUnit'], units: number,
): string {
  if (units === 0) return 'No unit booked in this period';
  if (!last) return `${units} booked`;
  const parts = [last.agent, last.project].filter(Boolean) as string[];
  if (last.valueAed !== null) {
    parts.push(`AED ${(last.valueAed / 1_000_000).toFixed(1)}M`);
  }
  return parts.length > 0 ? parts.join(' · ') : `${units} booked`;
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
