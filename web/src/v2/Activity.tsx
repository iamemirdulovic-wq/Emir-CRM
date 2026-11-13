import { useState, type CSSProperties } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../design/ui.js';

/**
 * Who used the CRM, from where, and anything unusual.
 *
 * `design/web/team-activity.html`, with the number cards drawn the way
 * `design/web/dashboard.html` draws an owner's numbers: a hero for the one
 * figure that matters and three plain cards beside it.
 *
 * Three tabs, one source. Everything on this screen is worked out from the
 * sign-in log (`/api/activity/sessions`), the live list
 * (`/api/activity/team`) and the team roster (`/api/v2/team`) — all three
 * already fenced on the server to the people this viewer may see. A manager
 * sees their own team here and an owner sees everybody, and that fence is in
 * the SQL rather than on this screen.
 *
 * Two columns the design draws are missing, and left missing on purpose: a
 * seven-day sparkline and a "leads opened" count. Neither has an endpoint,
 * and a column of plausible-looking hours against a colleague's name is the
 * worst possible thing to guess at.
 */

interface Person {
  id: string;
  name: string;
  role: string;
  photoUrl: string | null;
  markedToday: string | null;
  onLeave: boolean;
  phone: string | null;
}

interface SessionRow {
  id: string;
  name: string;
  device: string | null;
  where: string | null;
  level: 'none' | 'info' | 'watch' | 'alarm';
  flags: Array<{ key: string; level: string; message: string }>;
  signedInAt: string;
  signedOutAt: string | null;
  activeMinutes: number;
}

interface LiveRow {
  userId: string;
  name: string;
  live: boolean;
  lastSeen: string;
  device: string | null;
  where: string | null;
}

/** What today looked like for one person, added up from their sign-ins. */
interface Worked {
  minutes: number;
  firstAt: string;
  lastAt: string | null;
  device: string | null;
  newDevice: boolean;
}

type Tab = 'time' | 'signins' | 'unusual';

/** The headline on an unusual sign-in, by what the server flagged. */
const FLAG_TITLE: Record<string, string> = {
  impossible_travel: 'Two places too close together',
  new_country: 'New country',
  new_device: 'New device',
  new_network: 'Different internet connection',
  odd_hour: 'Signed in during the night',
  first_sign_in: 'First sign-in',
};

export function V2Activity() {
  const { user } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('time');
  const [again, setAgain] = useState(0);
  const [hidden, setHidden] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState<SessionRow | null>(null);

  const roster = useAsync<{ items: Person[] }>(() => api.get('/api/v2/team'), []);
  const sessions = useAsync<{ items: SessionRow[] }>(
    () => api.get('/api/activity/sessions'), [again],
  );
  const live = useAsync<{ items: LiveRow[] }>(() => api.get('/api/activity/team'), [again]);

  if (sessions.error || roster.error) return <ErrorNote>{sessions.error ?? roster.error}</ErrorNote>;
  if (!sessions.data || !roster.data) return <Spinner />;

  const people = roster.data.items.filter((one) => one.role !== 'automation');
  const rows = sessions.data.items;
  const liveBy = new Map((live.data?.items ?? []).map((one) => [one.name, one]));

  const worked = workedToday(rows);
  const everyone = people
    .map((person) => ({ person, today: worked.get(person.name) ?? null }))
    .sort((a, b) => (b.today?.minutes ?? -1) - (a.today?.minutes ?? -1));

  const working = everyone.filter((one) => (one.today?.minutes ?? 0) > 0);
  const away = everyone.filter((one) => (one.today?.minutes ?? 0) === 0);
  const average = working.length
    ? Math.round(working.reduce((sum, one) => sum + (one.today?.minutes ?? 0), 0) / working.length)
    : 0;
  const quietest = working.length ? working[working.length - 1]!.today!.minutes : 0;
  const busiest = Math.max(1, working[0]?.today?.minutes ?? 1);

  const unusual = rows.filter((one) => one.level !== 'none' && !hidden.includes(one.id));

  return (
    <div className="p-activity">
      <div className="d-tabs" role="tablist">
        <Tabs tab={tab} onPick={setTab} signins={rows.length} unusual={unusual.length} />
      </div>

      {/* ── Time in the CRM ──────────────────────────────────────────── */}
      {tab === 'time' && (
        <>
          <div className="d-tops">
            <section className="d-card d-hero">
              <span className="d-label">Average time in the CRM today</span>
              <b className="d-num-hero">{working.length ? shortHours(average) : '—'}</b>
              <span className="d-muted d-small">
                {working.length
                  ? `per person who has worked today · ${working.length} of ${people.length}`
                  : 'Nobody has used the CRM yet today'}
              </span>
            </section>

            <section className="d-card">
              <span className="d-label">Most active</span>
              <b className="d-num">{working[0]?.person.name.split(' ')[0] ?? '—'}</b>
              {working[0] && (
                <span className="d-delta d-up">{hours(working[0].today!.minutes)}</span>
              )}
            </section>

            <section className="d-card">
              <span className="d-label">Least active (working)</span>
              <b className="d-num">
                {working.length > 1
                  ? working[working.length - 1]!.person.name.split(' ')[0]
                  : '—'}
              </b>
              {working.length > 1 && <span className="d-delta d-down">{hours(quietest)}</span>}
            </section>

            <section className="d-card">
              <span className="d-label">Not seen today</span>
              <b className={away.length > 0 ? 'd-num d-t-red' : 'd-num'}>{away.length}</b>
              <span className="d-small d-muted">
                {away.length === 0
                  ? 'Everybody has been in'
                  : [...away.slice(0, 3).map(why), ...(away.length > 3 ? [`+${away.length - 3} more`] : [])]
                    .join(' · ')}
              </span>
            </section>
          </div>

          <div className="d-table-wrap">
            <table className="d-table d-id-time">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Active today</th>
                  <th>First seen</th>
                  <th>Last seen</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {everyone.map(({ person, today }) => (
                  <tr key={person.id}>
                    <td>
                      <span className="d-person">
                        <Avatar name={person.name} src={person.photoUrl ?? undefined} size={26} />
                        <b>{person.name}</b>
                      </span>
                    </td>
                    <td>
                      <div className="d-tbar">
                        <b className={today ? undefined : 'd-muted'}>
                          {today ? hours(today.minutes) : '–'}
                        </b>
                        <div
                          className={today && today.minutes < average / 2 ? 'd-bar d-amber' : 'd-bar'}
                          style={{ '--v': `${Math.round(((today?.minutes ?? 0) / busiest) * 100)}%` } as CSSProperties}
                        >
                          <i />
                        </div>
                      </div>
                    </td>
                    <td className="d-t-mono">{today ? clock(today.firstAt) : '–'}</td>
                    <td className="d-t-sub">
                      {liveBy.get(person.name)?.live
                        ? 'now'
                        : today?.lastAt ? clock(today.lastAt) : (liveBy.get(person.name)?.lastSeen ?? '–')}
                    </td>
                    <td className="d-t-sub">
                      {today?.device ?? liveBy.get(person.name)?.device ?? '–'}
                      {today?.newDevice && <span className="d-chip d-amber v2-newdev">New</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="d-table-foot">
              <Icon name="info" size={14} />
              <span>
                Time counts only while the CRM is open and being used. More than two minutes
                without the page checking in stops the clock.
              </span>
            </div>
          </div>
        </>
      )}

      {/* ── Sign-ins ─────────────────────────────────────────────────── */}
      {tab === 'signins' && (
        <SignIns
          rows={rows}
          people={people}
          meName={user?.name ?? ''}
          onSignOut={(row) => setReviewing(row)}
        />
      )}

      {/* ── Unusual ──────────────────────────────────────────────────── */}
      {tab === 'unusual' && (
        <div className="d-col d-gap-16 v2-un-list">
          {unusual.map((row) => (
            <Unusual
              key={row.id}
              row={row}
              phone={people.find((one) => one.name === row.name)?.phone ?? null}
              onReview={() => setReviewing(row)}
            />
          ))}

          {unusual.length === 0 && (
            <section className="d-card">
              <div className="d-empty">
                <span className="d-ic"><Icon name="shield" size={26} /></span>
                <b>Nothing unusual</b>
                <p>New devices, new places and sign-ins in the night show up here.</p>
              </div>
            </section>
          )}
        </div>
      )}

      {reviewing && (
        <Review
          row={reviewing}
          /* The sign-in log carries the person's name, not their id, so the
             only way to end their sessions is to match the name against the
             roster. Two colleagues with the same name is rare and would end
             the wrong sessions, so the button is simply not offered. */
          userId={onlyMatch(people, reviewing.name)}
          onClose={() => setReviewing(null)}
          onHide={() => {
            setHidden((was) => [...was, reviewing.id]);
            setReviewing(null);
            toast(`Hidden for now. ${reviewing.name}’s sign-in comes back if you reload.`);
          }}
          onSignedOut={(name) => {
            setReviewing(null);
            setAgain((n) => n + 1);
            toast(`${name} is signed out everywhere`);
          }}
        />
      )}
    </div>
  );
}

/* ── the tabs ──────────────────────────────────────────────────────────── */

function Tabs({ tab, onPick, signins, unusual }: {
  tab: Tab; onPick: (next: Tab) => void; signins: number; unusual: number;
}) {
  const list: Array<{ key: Tab; label: string; n?: number; red?: boolean }> = [
    { key: 'time', label: 'Time in CRM' },
    { key: 'signins', label: 'Sign-ins', n: signins },
    { key: 'unusual', label: 'Unusual', n: unusual, red: unusual > 0 },
  ];
  return (
    <>
      {list.map((one) => (
        <button
          key={one.key}
          type="button"
          role="tab"
          aria-selected={tab === one.key}
          className={tab === one.key ? 'd-tab d-on' : 'd-tab'}
          onClick={() => onPick(one.key)}
        >
          {one.label}
          {one.n !== undefined && one.n > 0 && (
            <span className={one.red ? 'd-count d-red' : 'd-count'}>{one.n}</span>
          )}
        </button>
      ))}
    </>
  );
}

/* ── sign-ins ──────────────────────────────────────────────────────────── */

function SignIns({ rows, people, meName, onSignOut }: {
  rows: SessionRow[];
  people: Person[];
  meName: string;
  onSignOut: (row: SessionRow) => void;
}) {
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState<'' | 'now' | 'new'>('');

  const text = search.trim().toLowerCase();
  const shown = rows.filter((row) => {
    if (only === 'now' && row.signedOutAt) return false;
    if (only === 'new' && !row.flags.some((flag) => flag.key === 'new_device')) return false;
    if (!text) return true;
    return `${row.name} ${row.device ?? ''} ${row.where ?? ''}`.toLowerCase().includes(text);
  });

  const filters: Array<{ key: '' | 'now' | 'new'; label: string }> = [
    { key: '', label: 'All' },
    { key: 'now', label: 'Signed in now' },
    { key: 'new', label: 'New device' },
  ];

  return (
    <>
      <div className="d-filters">
        <div className="d-input-icon">
          <Icon name="search" />
          <input
            className="d-input d-sm"
            value={search}
            aria-label="Search a person or a place"
            placeholder="Search a person or a place"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="d-chips">
          {filters.map((one) => (
            <button
              key={one.key || 'all'}
              type="button"
              className={only === one.key ? 'd-chip-opt d-on' : 'd-chip-opt'}
              onClick={() => setOnly(one.key)}
            >
              {one.label}
            </button>
          ))}
        </div>
        <span className="d-grow" />
        <span className="d-result-count">
          {shown.length} sign-in{shown.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="d-table-wrap">
        <table className="d-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Device</th>
              <th>Place</th>
              <th>Signed in</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const isNew = row.flags.some((flag) => flag.key === 'new_device');
              /* The design turns the place amber whenever the device is new,
                 because in its sample both were new at once. Ours colours the
                 place only when the place is the thing that changed. */
              const oddPlace = row.flags.some(
                (flag) => flag.key === 'new_country' || flag.key === 'impossible_travel',
              );
              const me = row.name === meName;
              return (
                <tr key={row.id}>
                  <td>
                    <span className="d-person">
                      <Avatar
                        name={row.name}
                        src={people.find((one) => one.name === row.name)?.photoUrl ?? undefined}
                        size={26}
                      />
                      <b>{row.name}</b>
                    </span>
                  </td>
                  <td>
                    <span className="d-row d-gap-8">
                      <Icon name={phoneLike(row.device) ? 'smartphone' : 'monitor'} size={14} />
                      {row.device ?? 'Not recorded'}
                      {isNew && <span className="d-chip d-amber">New device</span>}
                    </span>
                  </td>
                  <td className={oddPlace ? 'd-t-amber' : undefined}>{row.where ?? 'Not recorded'}</td>
                  <td className="d-t-sub">{dayAndClock(row.signedInAt)}</td>
                  <td>
                    {row.signedOutAt
                      ? <span className="d-chip">Signed out {clock(row.signedOutAt)}</span>
                      : <span className="d-chip d-green d-pip">Signed in now</span>}
                  </td>
                  <td className="d-t-right">
                    {me && <span className="d-small d-muted">This is you</span>}
                    {!me && !row.signedOutAt && onlyMatch(people, row.name) && (
                      <button type="button" className="d-btn d-xs" onClick={() => onSignOut(row)}>
                        Sign out
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="d-table-foot">
          <Icon name="info" size={14} />
          <span>The two hundred most recent sign-ins, newest first.</span>
        </div>
      </div>
    </>
  );
}

/* ── one unusual sign-in ───────────────────────────────────────────────── */

function Unusual({ row, phone, onReview }: {
  row: SessionRow; phone: string | null; onReview: () => void;
}) {
  const worst = row.flags.find((flag) => flag.level === row.level) ?? row.flags[0];
  const newDevice = row.flags.some((flag) => flag.key === 'new_device');
  const newPlace = row.flags.some(
    (flag) => flag.key === 'new_country' || flag.key === 'impossible_travel',
  );

  return (
    <section className="d-card d-un">
      <div className="d-row">
        <span className={row.level === 'alarm' ? 'd-card-icon d-accent' : 'd-card-icon'}>
          <Icon name={newDevice ? 'monitor' : 'shield'} />
        </span>
        <div className="d-grow">
          <h3>{FLAG_TITLE[worst?.key ?? ''] ?? 'Worth a look'} · {row.name}</h3>
          <span className="d-small d-muted">{worst?.message ?? 'Something about this sign-in is new.'}</span>
        </div>
        <span className={row.level === 'alarm' ? 'd-chip d-red d-pip' : 'd-chip d-amber d-pip'}>
          {row.level === 'alarm' ? 'Look now' : 'Needs a look'}
        </span>
      </div>

      <div className="d-facts">
        <div className={newDevice ? 'd-fact d-new' : 'd-fact'}>
          <b>{row.device ?? 'Device not recorded'}</b>
          <span>{newDevice ? 'New device' : 'Known device'}</span>
        </div>
        <div className={newPlace ? 'd-fact d-new' : 'd-fact'}>
          <b>{row.where ?? 'Place not recorded'}</b>
          <span>{newPlace ? 'New place' : 'Usual place'}</span>
        </div>
        <div className="d-fact">
          <b>{clock(row.signedInAt)}</b>
          <span>{dayOf(row.signedInAt)}</span>
        </div>
        <div className={row.signedOutAt ? 'd-fact' : 'd-fact d-new'}>
          <b>{row.signedOutAt ? 'Signed out' : 'Still signed in'}</b>
          <span>{hours(row.activeMinutes)} in the CRM</span>
        </div>
      </div>

      <div className="d-row">
        <button
          type="button"
          className={row.level === 'alarm' ? 'd-btn d-primary' : 'd-btn'}
          onClick={onReview}
        >
          Review
        </button>
        {phone && (
          <a className="d-btn" href={`tel:${phone}`}>
            <Icon name="phone" size={15} />Phone {row.name.split(' ')[0]}
          </a>
        )}
      </div>
    </section>
  );
}

/* ── the one decision this screen can make ─────────────────────────────── */

/**
 * Was this them?
 *
 * The design's dialog offers "reset the password" alongside signing out. It
 * does not say that here, because this endpoint does not do it: it ends every
 * session and writes an audit row. Resetting a password is a separate, owner
 * job on the Users screen, and a button that claims to do it would leave an
 * owner believing a stolen password had been changed when it had not.
 */
function Review({ row, userId, onClose, onHide, onSignedOut }: {
  row: SessionRow;
  userId: string | null;
  onClose: () => void;
  onHide: () => void;
  onSignedOut: (name: string) => void;
}) {
  const [why, setWhy] = useState(
    `Unusual sign-in: ${[row.device, row.where].filter(Boolean).join(' · ') || 'reviewed from Activity'}`,
  );
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function signOut() {
    if (!userId) return;
    if (!sure) { setSure(true); return; }
    setBusy(true);
    setProblem(null);
    try {
      const done = await api.post<{ name: string }>(
        `/api/activity/sign-out/${userId}`, { reason: why.trim() },
      );
      onSignedOut(done.name ?? row.name);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="d-scrim d-show" onClick={onClose} aria-hidden />
      <div className="d-dialog d-open d-sm" role="dialog" aria-label={`Was this ${row.name}?`}>
        <div className="d-dialog-head">
          <div className="d-grow">
            <h3>Was this {row.name}?</h3>
            <p>{[row.device, row.where, dayAndClock(row.signedInAt)].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-dialog-body">
          <div className="d-banner">
            <Icon name="info" />
            <span className="d-grow">
              Ask them first if you are not sure. Signing out everywhere stops their work until
              they sign in again.
            </span>
          </div>

          <button type="button" className="d-btn d-block" onClick={onHide}>
            <Icon name="check" size={15} />It was them
          </button>

          {userId && (
            <>
              <div className="d-field">
                <label htmlFor="v2-act-why">Why <span className="d-req">*</span></label>
                <input
                  id="v2-act-why"
                  className="d-input"
                  value={why}
                  maxLength={160}
                  onChange={(e) => { setWhy(e.target.value); setSure(false); }}
                />
                <span className="d-hint">This goes in the audit log, and they may ask.</span>
              </div>
              <button
                type="button"
                className="d-btn d-block d-danger"
                disabled={busy || why.trim().length < 3}
                onClick={signOut}
              >
                {sure
                  ? 'Tap again · sign out everywhere'
                  : <><Icon name="log-out" size={15} />Sign out everywhere</>}
              </button>
            </>
          )}

          {!userId && (
            <p className="d-small d-muted">
              Signing out is not offered here: the sign-in log records the name, and more than
              one person on the team has this one.
            </p>
          )}

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        <div className="d-dialog-foot">
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Decide later</button>
        </div>
      </div>
    </>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

/**
 * Today's sign-ins, added up per person.
 *
 * One person with three tabs open is one person working, so the minutes of
 * every session they opened today are added together rather than taken from
 * the newest one. "Today" is Dubai's day: the office works to it, and Dubai
 * is UTC+4 all year with no summer time.
 */
function workedToday(rows: SessionRow[]): Map<string, Worked> {
  const today = dubaiDay(Date.now());
  const out = new Map<string, Worked>();

  for (const row of rows) {
    const at = new Date(row.signedInAt).getTime();
    if (Number.isNaN(at) || dubaiDay(at) !== today) continue;

    const was = out.get(row.name);
    const ended = row.signedOutAt;
    out.set(row.name, {
      minutes: (was?.minutes ?? 0) + Math.max(0, row.activeMinutes),
      firstAt: was && new Date(was.firstAt).getTime() < at ? was.firstAt : row.signedInAt,
      /* Rows arrive newest first, so the first one seen is the newest. */
      lastAt: was?.lastAt ?? ended,
      device: was?.device ?? row.device,
      newDevice: (was?.newDevice ?? false) || row.flags.some((flag) => flag.key === 'new_device'),
    });
  }

  return out;
}

/** Why somebody has not been seen: what attendance already knows. */
function why({ person }: { person: Person }): string {
  if (person.onLeave) return `${person.name.split(' ')[0]} on leave`;
  if (person.markedToday) return `${person.name.split(' ')[0]} ${person.markedToday}`;
  return `${person.name.split(' ')[0]} no check-in`;
}

/** Exactly one person with this name, or nobody. */
function onlyMatch(people: Person[], name: string): string | null {
  const found = people.filter((one) => one.name === name);
  return found.length === 1 ? found[0]!.id : null;
}

function phoneLike(device: string | null): boolean {
  return /iphone|android|ipad|mobile/i.test(device ?? '');
}

/** "4 h 38 min", or "52 min" under the hour. */
function hours(minutes: number): string {
  if (minutes <= 0) return '0 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "4 h 38" — the hero, where the word "min" is noise. */
function shortHours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Dubai's calendar day for an instant. UTC+4, fixed, all year. */
function dubaiDay(ms: number): string {
  return new Date(ms + 4 * 3_600_000).toISOString().slice(0, 10);
}

/** "09:26", in Dubai. */
function clock(at: string): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return '–';
  const dubai = new Date(then.getTime() + 4 * 3_600_000);
  return `${String(dubai.getUTCHours()).padStart(2, '0')}:${String(dubai.getUTCMinutes()).padStart(2, '0')}`;
}

/** "Today" or "4 Nov", in Dubai. */
function dayOf(at: string): string {
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return '';
  if (dubaiDay(then.getTime()) === dubaiDay(Date.now())) return 'Today';
  return new Date(then.getTime() + 4 * 3_600_000)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function dayAndClock(at: string): string {
  const day = dayOf(at);
  return day ? `${day} ${clock(at)}` : clock(at);
}
