import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';
import { usePhoneHead } from './phone.js';
import { teamSub } from './subs.js';

/**
 * Narrow enough to be a phone, asked in JavaScript rather than in CSS.
 *
 * The phone's `Profile` is a different screen from the computer's — a hub of
 * nine menu rows, where the computer page has a sidebar instead — so the rows
 * are markup that only a phone should get. A phone stylesheet cannot hide
 * something on a computer: every rule in it lives inside
 * `@media (max-width: 767px)` by rule, so the decision has to be made here.
 *
 * 768 is the line the owner drew, and it is the same number `Shell.tsx` uses.
 */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width:767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width:767px)');
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/**
 * The team, and one person's page.
 *
 * Built from `design/web/team.html`: a grid of cards, a colleague panel that
 * slides in, and the owners on their own row underneath. One person's page is
 * the hero and the shortcut row from `design/web/profile.html`; the editing
 * form on that design page is Settings' job and lives on `/profile`.
 *
 * Everybody can see who everybody is — an agent who has just joined needs to
 * know who speaks Russian and who covers Abu Dhabi, and that is the whole
 * point of the screen.
 *
 * What an agent is not shown is how many leads a colleague is holding. The
 * server sends `openLeads: null` to them, so it cannot leak through a screen:
 * that number turns a directory into a league table in the canteen, and it is
 * the owner's to read.
 *
 * Three things the design draws are not here because nothing behind the
 * screen knows them: the desk a person sits on ("Dubai off-plan", "Arabic
 * desk"), the deals-and-meetings pair on each card, and the six-month bar
 * chart in the panel. The filter pills use what people actually cover
 * instead, and the panel's four figures come from the profile endpoint.
 *
 * The middle one is worth naming precisely, because the phone design puts it
 * in bold on every card — "7 deals this month · 14 meetings". `/api/v2/team`
 * sends no such pair, and `profileStats` counts deals for all time and
 * meetings over a year, one request per person. Two monthly counts on the
 * team query would finish the card; until then the line is left out rather
 * than filled with a number that means something else.
 */

interface Person {
  id: string;
  name: string;
  email: string | null;
  role: string;
  photoUrl: string | null;
  title: string | null;
  headline: string | null;
  languages: string[];
  specialities: string[];
  phone: string | null;
  whatsapp: string | null;
  markedToday: string | null;
  onLeave: boolean;
  openLeads: number | null;
}

const ROLE: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Manager', agent: 'Agent', accountant: 'Accountant',
};

/** Where somebody is today, in the design's five attendance colours. */
function presence(one: Person): { kind: string; word: string; chip: string } {
  if (one.onLeave) return { kind: 'leave', word: 'On leave', chip: 'd-chip d-att-leave' };
  if (one.markedToday === 'office') return { kind: 'office', word: 'In office', chip: 'd-chip d-att-office' };
  if (one.markedToday === 'outside') return { kind: 'outside', word: 'Working outside', chip: 'd-chip d-att-outside' };
  return { kind: 'none', word: 'Not marked today', chip: 'd-chip' };
}

/**
 * The design's avatar carries a coloured dot for where the person is. Ours
 * does not take one, so the dot is painted on a wrapper instead of forking a
 * component four screens already use.
 */
function Face({ one, size }: { one: Person; size?: number }) {
  const { kind } = presence(one);
  return (
    <span className={`v2-face v2-face-${kind}`}>
      <Avatar name={one.name} src={one.photoUrl ?? undefined} size={size} />
    </span>
  );
}

export function V2Team() {
  const { user } = useAuth();
  const isPhone = useIsPhone();
  const team = useAsync<{ items: Person[]; canSeeNumbers: boolean }>(
    () => api.get('/api/v2/team'), [],
  );
  const [find, setFind] = useState('');
  const [only, setOnly] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const everyone = useMemo(() => team.data?.items ?? [], [team.data]);

  /* The design filters by desk. There are no desks in this database, so the
     pills are built from what people say they cover — the nearest true thing,
     and the same words the cards and the panel already show. */
  const working = useMemo(
    () => everyone.filter((one) => one.role === 'agent' || one.role === 'manager'),
    [everyone],
  );
  const office = useMemo(
    () => everyone.filter((one) => one.role === 'owner' || one.role === 'admin'),
    [everyone],
  );

  /* Counted over the people the grid actually shows, so a pill that says 6
     never filters down to 4. */
  const covers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const one of working) {
      for (const what of one.specialities) seen.set(what, (seen.get(what) ?? 0) + 1);
    }
    return [...seen].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4);
  }, [working]);

  const shown = useMemo(() => {
    const term = find.trim().toLowerCase();
    return working.filter((one) => {
      if (only === 'office' && presence(one).kind !== 'office') return false;
      if (only !== 'all' && only !== 'office' && !one.specialities.includes(only)) return false;
      if (!term) return true;
      return [one.name, one.title, one.headline, ...one.languages, ...one.specialities]
        .filter(Boolean).join(' ').toLowerCase().includes(term);
    });
  }, [working, find, only]);

  /*
   * `TeamDirectory.dc.html`: "Meet the team", with the live count on the
   * 13px sub-line and no action in the right slot. The build's own header
   * drew the same count inside the page; it belongs up here.
   *
   * `design/web/team.html` writes "10 agents · 6 in office now" there, and
   * its two filter pills say "All 10" and "In office now 6" — one pair of
   * numbers, counted over the grid. So the sub counts `working`, the people
   * the grid shows, and not `everyone`, which includes the three in the
   * "Owners and office" row below it. The design's ten and six are invented;
   * these are the real ones.
   */
  const inGridNow = useMemo(
    () => working.filter((one) => presence(one).kind === 'office').length,
    [working],
  );
  usePhoneHead({
    compact: true,
    title: 'Meet the team',
    sub: team.data ? teamSub(working.length, inGridNow) : undefined,
  });

  if (team.error) return <ErrorNote>{team.error}</ErrorNote>;
  if (!team.data) return <Spinner />;

  const open = everyone.find((one) => one.id === openId) ?? null;
  const owner = user?.role === 'owner' || user?.role === 'admin';

  const pills: Array<{ key: string; label: string; count: number }> = [
    { key: 'all', label: 'All', count: working.length },
    {
      key: 'office',
      label: 'In office now',
      count: working.filter((one) => presence(one).kind === 'office').length,
    },
    ...covers.map(([what, n]) => ({ key: what, label: what, count: n })),
  ];

  return (
    <div className="v2-team p-team">
      {/*
        * The count used to be drawn here as well, over `everyone` -- "5
        * people · 2 in the office now" thirty pixels under a top bar saying
        * "4 agents · 1 in office now", because this one counted the owner and
        * the office admin and the other counted the grid. Two answers to one
        * question on one screen is the fault the owner reported, so the line
        * is gone and the top bar's is the only one. `design/web/team.html`
        * puts it in the top bar and nowhere else.
        */}
      {/*
        * `design/web/team.html` pairs this screen with **Best of Homes**, and
        * `/v2/best` already draws the same two tabs the other way round. The
        * second one here said "Team wall", from when the leaderboard was not
        * built: the pair disagreed, and from this screen the tab row could
        * not reach the screen it is a pair with. The wall is in More, on the
        * profile menu and at the foot of a colleague's sheet.
        *
        * `TeamDirectory.dc.html` draws no tab row at all — it goes from the
        * header to the search box. The computer design is the newer of the
        * two and wins; it is written down in `docs/v2/phone-questions-c.md`.
        */}
      <div className="d-tabs d-top-tabs">
        <span className="d-tab d-on">Meet the team</span>
        <Link to="/v2/best" className="d-tab">Best of Homes</Link>
      </div>

      <div className="d-filters">
        <div className="d-input-icon">
          <Icon name="search" />
          <input
            className="d-input d-sm"
            value={find}
            aria-label="Search a name or a language"
            placeholder="Search a name or a language"
            onChange={(e) => setFind(e.target.value)}
          />
        </div>
        <div className="d-tabs d-pills v2-team-pills">
          {pills.map((pill) => (
            <button
              key={pill.key}
              type="button"
              className={only === pill.key ? 'd-tab d-on' : 'd-tab'}
              onClick={() => setOnly(pill.key)}
            >
              {pill.label}<span className="d-count">{pill.count}</span>
            </button>
          ))}
        </div>
        <span className="d-grow" />
        <span className="d-result-count">
          {shown.length} {shown.length === 1 ? 'agent' : 'agents'}
          {find.trim() && ` · “${find.trim()}”`}
        </span>
        {owner && (
          <Link className="d-btn d-sm" to="/v2/settings/team">
            <Icon name="settings" />Team and roles
          </Link>
        )}
      </div>

      {shown.length > 0 && (
        <div className="d-tgrid">
          {shown.map((one) => {
            const now = presence(one);
            return (
              <button
                key={one.id}
                type="button"
                className={openId === one.id ? 'd-tcard d-sel' : 'd-tcard'}
                onClick={() => setOpenId(one.id)}
              >
                {one.id === user?.id && <span className="d-chip d-dark d-you">You</span>}
                <Face one={one} size={64} />
                <h3>{one.name}</h3>
                <div className="d-desk">{one.title ?? ROLE[one.role] ?? one.role}</div>
                <span className={now.chip}>{now.word}</span>
                <div className="d-langs">
                  {one.languages.length > 0 ? one.languages.join(' · ') : 'No languages set'}
                </div>
                {one.openLeads !== null && (
                  <div className="d-mini">
                    <div><b>{one.openLeads}</b><span>open leads</span></div>
                  </div>
                )}
                {/* `TeamDirectory.dc.html` draws a chevron on every row,
                    because on a phone the card is a link to the person and
                    nothing else on it says so. The computer's card is a tile
                    in a grid and has none. */}
                {isPhone && <Icon name="chevron-right" className="v2-c-go" />}
              </button>
            );
          })}
        </div>
      )}

      {shown.length === 0 && (
        <div className="d-card">
          <div className="d-empty">
            <span className="d-ic"><Icon name="users" size={28} /></span>
            <b>Nobody found</b>
            <p>Try another name or language, for example “Russian”.</p>
            <button
              type="button"
              className="d-btn d-sm"
              onClick={() => { setFind(''); setOnly('all'); }}
            >
              Show everyone
            </button>
          </div>
        </div>
      )}

      {office.length > 0 && (
        <>
          <div className="v2-section-title"><h2>Owners and office</h2></div>
          <div className="d-ogrid">
            {office.map((one) => (
              <div className="d-card v2-ocard" key={one.id}>
                <Face one={one} size={44} />
                <div className="d-grow">
                  <b className="d-bold d-big">{one.name}</b>
                  <div className="d-small d-muted">
                    {[one.title ?? ROLE[one.role] ?? one.role, one.languages.join(', ')]
                      .filter(Boolean).join(' · ')}
                  </div>
                </div>
                {one.phone && (
                  <a className="d-btn d-sm" href={`tel:${one.phone}`}>
                    <Icon name="phone" />Phone
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* The rule the design prints at the foot of the screen, because it is
          the first thing a new agent wants to know about a directory. */}
      <p className="d-small d-muted v2-c-rule">
        You see results and profiles of colleagues, never their leads.
      </p>

      {open && <Colleague one={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* ── the colleague panel ───────────────────────────────────────────────── */

function Colleague({ one, onClose }: { one: Person; onClose: () => void }) {
  const { user } = useAuth();
  const got = useAsync<Profile>(() => api.get(`/api/profiles/${one.id}`), [one.id]);

  const now = presence(one);
  const mine = one.id === user?.id;
  const owner = user?.role === 'owner' || user?.role === 'admin';
  const away = now.kind === 'leave';
  const first = one.name.split(' ')[0] ?? one.name;
  const stats = got.data?.stats;
  const earned = (got.data?.badges ?? []).filter((badge) => badge.earned);

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="Colleague">
        <div className="d-panel-head">
          <h3 className="d-muted v2-panel-kind">Colleague</h3>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-24">
          <div className="d-p-top">
            <Face one={one} size={64} />
            <div className="d-grow">
              <h2>{one.name}</h2>
              <div className="d-muted">{one.title ?? ROLE[one.role] ?? one.role}</div>
              <div className="d-mt-8">
                <span className={now.chip}>{now.word}</span>
                {one.headline && <div className="d-small d-muted d-mt-4">{one.headline}</div>}
              </div>
            </div>
          </div>

          <div>
            <div className="d-btn-row">
              {one.phone && (
                <a className="d-btn d-primary" href={`tel:${one.phone}`}>
                  <Icon name="phone" />Phone
                </a>
              )}
              {one.whatsapp && (
                <a
                  className="d-btn"
                  href={`https://wa.me/${one.whatsapp.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="message-circle" />WhatsApp
                </a>
              )}
              <span className="d-grow" />
              <span className="d-t-mono d-muted">{one.phone ?? ''}</span>
            </div>
            {/* The design's words. "No check-in is asked" is the half an
                agent actually worries about, and it was missing. */}
            <p className="d-small d-muted d-mt-8">
              Opens your own phone or WhatsApp. Nothing is logged and no check-in is asked.
            </p>
          </div>

          <div className="d-p-sec">
            <h4>Speaks</h4>
            <div className="d-row d-wrap d-gap-6">
              {one.languages.length > 0
                ? one.languages.map((lang) => <span className="d-chip d-lg" key={lang}>{lang}</span>)
                : <span className="d-small d-muted">Not written down yet.</span>}
            </div>
          </div>

          <div className="d-p-sec">
            <h4>Sells</h4>
            <div className="d-row d-wrap d-gap-6">
              {one.specialities.length > 0
                ? one.specialities.map((what) => (
                  <Link className="d-chip d-lg d-line" to="/v2/projects" key={what}>{what}</Link>
                ))
                : <span className="d-small d-muted">Not written down yet.</span>}
            </div>
          </div>

          {/* The design's figures, from the same endpoint the person's own page
              reads. Two things are not here: how many leads a colleague is
              holding, unless the team endpoint sent it — an agent is not shown
              that, and this panel is not the way round it — and the design's
              six-month bar chart, which nothing behind the screen can fill. */}
          {stats && (
            <div className={one.openLeads === null ? 'd-stats4 v2-stats-3' : 'd-stats4'}>
              <div><b>{stats.dealsWon ?? 0}</b><span>Deals won</span></div>
              <div><b>{stats.appointments ?? 0}</b><span>Viewings booked</span></div>
              {one.openLeads !== null && (
                <div><b>{one.openLeads}</b><span>Open leads</span></div>
              )}
              <div><b>{replyTime(stats.speedToLeadSeconds)}</b><span>Usual reply</span></div>
            </div>
          )}

          <div className="d-p-sec">
            <h4>Badges</h4>
            <div className="d-row d-wrap d-gap-6">
              {earned.length > 0
                ? earned.map((badge) => (
                  <span className="d-chip d-lg" key={badge.key}>
                    <Icon name="trophy" size={14} />{badge.name}
                  </span>
                ))
                : <span className="d-small d-muted">No badges yet.</span>}
            </div>
          </div>
        </div>

        <div className="d-panel-foot">
          {mine && (
            <Link className="d-btn" to="/v2/profile"><Icon name="user" />Open my profile</Link>
          )}
          {!mine && owner && (
            <>
              <Link className="d-btn" to={`/v2/team/${one.id}`}>
                <Icon name="user" />{first}&apos;s page
              </Link>
              <Link className="d-btn" to="/v2/attendance"><Icon name="pin" />Attendance</Link>
            </>
          )}
          {!mine && !owner && (
            away
              ? <span className="d-small d-muted d-grow">{first} is away today and cannot take a lead.</span>
              : <Link className="d-btn" to="/v2/leads"><Icon name="repeat" />Transfer a lead to {first}</Link>
          )}
          <span className="d-grow" />
          <Link className="d-btn d-ghost" to="/v2/wall">Team wall</Link>
        </div>
      </aside>
    </>
  );
}

/** The median first reply, said the way an agent would say it. */
function replyTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `${mins} min`;
  return `${Math.round(mins / 60)} h`;
}

/* ── one person ────────────────────────────────────────────────────────── */

interface Profile {
  profile: {
    user_id: string; name?: string; headline: string | null; bio: string | null;
    languages: unknown; specialities: unknown;
    public_phone: string | null; phone_e164: string | null;
    public_email: string | null; whatsapp: string | null; instagram: string | null;
    linkedin: string | null; job_title: string | null; brn: string | null;
    photo_url: string | null; cover_key: string | null; slug: string | null;
  };
  stats: {
    leadsWorking?: number; dealsWon?: number; appointments?: number;
    speedToLeadSeconds?: number | null; monthsHere?: number;
  };
  badges: Array<{ key: string; name: string; how: string; earned: boolean }>;
  /** `{ level, index, earned, of }` from `badgesFor`, or null on an old row. */
  level: { level?: string; earned?: number; of?: number } | null;
  editable: boolean;
}

export function V2Person() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const isPhone = useIsPhone();
  const mine = !id || id === user?.id;
  const got = useAsync<Profile>(
    () => api.get(mine ? '/api/profiles/me' : `/api/profiles/${id}`), [id, mine],
  );

  /*
   * Two different screens from one component, and the design draws them that
   * way too: `Profile.dc.html` is a hub with the settings gear in the header,
   * `Colleague.dc.html` is a results page titled with the person's name.
   */
  usePhoneHead({
    compact: true,
    title: mine ? 'Profile' : (got.data?.profile.name ?? undefined),
    sub: got.data
      ? (mine
        ? `${got.data.profile.name ?? user?.name ?? ''} · ${got.data.profile.job_title ?? 'Property Consultant'}`
        : got.data.profile.job_title ?? 'Property Consultant')
      : undefined,
    action: mine
      ? { icon: 'settings', label: 'Settings', to: '/v2/settings' }
      : undefined,
  });

  if (got.error) return <ErrorNote>{got.error}</ErrorNote>;
  if (!got.data) return <Spinner />;

  const { profile, stats, level } = got.data;
  const name = profile.name ?? (mine ? user?.name : null) ?? 'Somebody';
  const languages = asList(profile.languages);
  const specialities = asList(profile.specialities);
  const badges = got.data.badges ?? [];
  const earned = badges.filter((badge) => badge.earned);
  /*
   * `Colleague.dc.html` draws Phone and WhatsApp side by side, and the Phone
   * button went missing whenever somebody had not set a separate public
   * number. `loadProfile` sends `u.phone_e164` too, and the business card
   * already prefers the public number over the sign-in one; this does the
   * same, so a colleague can always be rung.
   */
  const callNumber = profile.public_phone?.trim() || profile.phone_e164?.trim() || '';

  /*
   * The design's hero shows "Performance this month · 86%" against a monthly
   * target. There is no target anywhere in this database and a percentage
   * nobody set is a percentage somebody argues about, so the bar shows the
   * badges earned instead — a real number, from the same answer.
   */
  const done = badges.length > 0 ? Math.round((earned.length / badges.length) * 100) : 0;

  return (
    <div className="v2-person-page p-profile">
      <section className="d-card d-hero d-pf-hero">
        <div className="d-pf-id">
          <Avatar name={name} src={profile.photo_url ?? undefined} size={84} />
          <div className="d-grow">
            <h1>{name}</h1>
            <p className="d-muted d-mt-4">{profile.job_title ?? 'Property consultant'} · homes.me</p>
            <div className="d-row d-gap-8 d-mt-12 d-wrap">
              {level?.level && <span className="d-hero-chip">Level · {level.level}</span>}
              {profile.brn && <span className="d-hero-chip">BRN {profile.brn}</span>}
            </div>
          </div>
        </div>

        <div className="d-pf-perf">
          <div>
            <span className="d-label">Badges earned</span>
            <div className="d-stat-row d-mt-8">
              <b className="d-num-hero">{done}%</b>
              <span className="d-delta">{earned.length} of {badges.length}</span>
            </div>
            <div className="d-bar d-accent d-mt-12" style={{ ['--v' as string]: `${done}%` }}><i /></div>
            <span className="d-small d-muted d-mt-8 v2-pf-how">
              Deals, speed of reply, viewings booked and days in a row.
            </span>
          </div>
          <div className="d-pf-stats">
            <Link to="/v2/pipeline">
              <b className="d-num">{stats?.dealsWon ?? 0}</b><span>Deals</span>
            </Link>
            <Link to="/v2/calendar">
              <b className="d-num">{stats?.appointments ?? 0}</b><span>Viewings</span>
            </Link>
            <Link to="/v2/leads">
              <b className="d-num">{replyTime(stats?.speedToLeadSeconds)}</b><span>Usual reply</span>
            </Link>
          </div>
        </div>
      </section>

      <div className="d-pf-links">
        <Link className="d-shortcut" to="/v2/wall">
          <Icon name="trophy" />
          <span className="d-grow">Team wall</span>
          <Icon name="arrow-right" />
        </Link>
        {/* `/v2/card` is the v2 screen; `/tools/business-card` is v1's and
            leaving the link on it dropped you out of v2 mid-journey. */}
        <Link className="d-shortcut" to="/v2/card">
          <Icon name="id-card" />
          <span className="d-grow">Business card</span>
          <Icon name="arrow-right" />
        </Link>
        <Link className="d-shortcut" to={mine ? '/v2/attendance' : '/v2/team'}>
          <Icon name={mine ? 'pin' : 'users-round'} />
          <span className="d-grow">{mine ? 'My attendance' : 'The team'}</span>
          <Icon name="arrow-right" />
        </Link>
      </div>

      {/*
        * A colleague's page had no way to reach them: the sheet carries Phone
        * and WhatsApp, the page showed the number as a read-only line. It is
        * the whole reason an agent opens a colleague.
        */}
      {!mine && (callNumber || profile.whatsapp) && (
        <section className="d-card">
          <div className="d-btn-row">
            {callNumber && (
              <a className="d-btn d-primary" href={`tel:${callNumber}`}>
                <Icon name="phone" />Phone
              </a>
            )}
            {profile.whatsapp && (
              <a
                className="d-btn"
                href={`https://wa.me/${profile.whatsapp.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="message-circle" />WhatsApp
              </a>
            )}
          </div>
          <p className="d-small d-muted d-mt-8">
            Opens your own phone or WhatsApp. Nothing is logged and no check-in is asked.
          </p>
        </section>
      )}

      {/* `Profile.dc.html`'s two menu cards — the phone's answer to the
          sidebar a computer has. Phone only: the computer page keeps its own
          shape, which is what the owner was promised. */}
      {isPhone && mine && (
        <ProfileMenu
          slug={profile.slug}
          badgesEarned={earned.length}
          badgesOf={badges.length}
        />
      )}


      {profile.bio && (
        <section className="d-card">
          <div className="d-card-head"><h3>About</h3></div>
          <p className="v2-person-bio">{profile.bio}</p>
        </section>
      )}

      {(languages.length > 0 || specialities.length > 0 || profile.public_phone) && (
        <section className="d-card">
          <div className="d-card-head"><h3>Good to know</h3></div>
          <dl className="d-kv">
            {languages.length > 0 && (
              <div className="d-kv-row"><dt>Speaks</dt><dd>{languages.join(' · ')}</dd></div>
            )}
            {specialities.length > 0 && (
              <div className="d-kv-row"><dt>Sells</dt><dd>{specialities.join(' · ')}</dd></div>
            )}
            {profile.public_phone && (
              <div className="d-kv-row"><dt>Phone</dt><dd>{profile.public_phone}</dd></div>
            )}
            {profile.public_email && (
              <div className="d-kv-row"><dt>Email</dt><dd>{profile.public_email}</dd></div>
            )}
          </dl>
        </section>
      )}

      {badges.length > 0 && (
        <section className="d-card">
          <div className="d-card-head">
            <h3>Badges</h3>
            <span className="d-small d-muted">{earned.length} of {badges.length}</span>
          </div>
          <div className="d-row d-wrap d-gap-6">
            {badges.map((badge) => (
              <span
                className={badge.earned ? 'd-chip d-lg' : 'd-chip d-lg d-line v2-badge-locked'}
                key={badge.key}
                title={badge.how}
              >
                <Icon name="trophy" size={14} />{badge.name}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* `/v2/me` is the v2 editor. This pointed at `/profile`, the v1 one,
          which drops the person out of v2 halfway through a journey. */}
      {got.data.editable && mine && !isPhone && (
        <p className="v2-back-row"><Link to="/v2/me">Edit my personal information</Link></p>
      )}
      {/* The design's last control on the screen, under everything else. */}
      {isPhone && mine && <SignOut />}
      {!mine && <p className="v2-back-row"><Link to="/v2/team">← The team</Link></p>}
    </div>
  );
}

/**
 * The nine rows `Profile.dc.html` puts under the stats, in its two groups,
 * and the Log out button under them.
 *
 * Every sub-line is a real fact or a plain description. The design's own
 * "opened 38 times" on the card row is not here: nothing counts how often a
 * public card is opened, and `Card.tsx` already says so on the card screen.
 * The attendance row's "6 of 7 working days" is the same — the month figure
 * is on the attendance screen itself, not in this answer.
 */
function ProfileMenu({
  slug, badgesEarned, badgesOf,
}: { slug: string | null; badgesEarned: number; badgesOf: number }) {
  const mine: Array<{ to: string; icon: IconName; title: string; note: string }> = [
    {
      to: '/v2/me', icon: 'user', title: 'Personal information',
      note: 'Photo, BRN, languages, what I sell',
    },
    {
      to: '/v2/card', icon: 'id-card', title: 'My digital card',
      note: slug ? `homes.me/card/${slug}` : 'Your link and your printed card',
    },
    {
      to: '/v2/best', icon: 'trophy', title: 'Badges & level',
      note: `${badgesEarned} of ${badgesOf} badges`,
    },
    {
      to: '/v2/attendance', icon: 'pin', title: 'My attendance',
      note: 'Check in, working outside, leave',
    },
  ];

  const rest: Array<{ to: string; icon: IconName; title: string; note: string }> = [
    {
      to: '/v2/settings/notifications', icon: 'bell', title: 'Notifications',
      note: 'Phone alerts, sounds, quiet hours',
    },
    {
      to: '/v2/settings/security', icon: 'lock', title: 'Security',
      note: 'Password, signed-in devices',
    },
    {
      to: '/v2/ai', icon: 'sparkles', title: 'Homes AI',
      note: 'Ask anything about your leads',
    },
    {
      to: '/v2/feedback', icon: 'pencil', title: 'Report a bug or suggest',
      note: 'Goes straight to the owners',
    },
  ];

  const row = (one: { to: string; icon: IconName; title: string; note: string }) => (
    <Link className="d-shortcut" to={one.to} key={one.to}>
      <Icon name={one.icon} />
      <span className="d-grow">
        {one.title}
        <small>{one.note}</small>
      </span>
      <Icon name="chevron-right" />
    </Link>
  );

  return (
    <>
      <section className="d-card v2-c-menu">{mine.map(row)}</section>
      <section className="d-card v2-c-menu">
        {/* The design's Language row is a read-only pill, not a link: there
            is one language today and Arabic comes later. */}
        <span className="d-shortcut v2-c-menu-flat">
          <Icon name="globe" />
          <span className="d-grow">
            Language
            <small>English</small>
          </span>
          <span className="d-chip">EN</span>
        </span>
        {rest.map(row)}
      </section>
    </>
  );
}

/** The way out of the app, which on a phone exists nowhere else. */
function SignOut() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="d-btn d-danger v2-c-signout"
      onClick={() => { void signOut().then(() => navigate('/login', { replace: true })); }}
    >
      <Icon name="log-out" />Log out{user?.name ? ` · ${user.name.split(' ')[0]}` : ''}
    </button>
  );
}

/** A column that may be JSON, a comma-separated string, or already a list. */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* The older comma-separated form. */
  }
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}
