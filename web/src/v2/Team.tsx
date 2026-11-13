import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote } from '../design/ui.js';

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

  if (team.error) return <ErrorNote>{team.error}</ErrorNote>;
  if (!team.data) return <Spinner />;

  const inOffice = everyone.filter((one) => presence(one).kind === 'office').length;
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
      <div className="v2-page-head">
        <span className="v2-page-sub">
          {everyone.length} {everyone.length === 1 ? 'person' : 'people'}
          {' · '}{inOffice} in the office now
        </span>
      </div>

      {/* The design's second tab is "Best of Homes", a leaderboard that is not
          part of this build. The Team wall is the screen beside this one in
          the menu, so it takes the place. */}
      <div className="d-tabs d-top-tabs">
        <span className="d-tab d-on">Meet the team</span>
        <Link to="/v2/wall" className="d-tab">Team wall</Link>
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
            <p className="d-small d-muted d-mt-8">
              A call or message to a colleague is private. Nothing is logged.
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

          {/* Four figures, from the same endpoint the person's own page reads.
              The design's fifth block — deals month by month — has nothing
              behind it, so it is left out rather than drawn empty. */}
          {stats && (
            <div className="d-stats4">
              <div><b>{stats.dealsWon ?? 0}</b><span>Deals won</span></div>
              <div><b>{stats.appointments ?? 0}</b><span>Viewings booked</span></div>
              <div>
                <b>{one.openLeads ?? stats.leadsWorking ?? 0}</b>
                <span>Open leads</span>
              </div>
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
    languages: unknown; specialities: unknown; public_phone: string | null;
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
  const mine = !id || id === user?.id;
  const got = useAsync<Profile>(
    () => api.get(mine ? '/api/profiles/me' : `/api/profiles/${id}`), [id, mine],
  );

  if (got.error) return <ErrorNote>{got.error}</ErrorNote>;
  if (!got.data) return <Spinner />;

  const { profile, stats, level } = got.data;
  const name = profile.name ?? (mine ? user?.name : null) ?? 'Somebody';
  const languages = asList(profile.languages);
  const specialities = asList(profile.specialities);
  const badges = got.data.badges ?? [];
  const earned = badges.filter((badge) => badge.earned);

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
        <a className="d-shortcut" href="/tools/business-card">
          <Icon name="id-card" />
          <span className="d-grow">Business card</span>
          <Icon name="arrow-right" />
        </a>
        <Link className="d-shortcut" to={mine ? '/v2/attendance' : '/v2/team'}>
          <Icon name={mine ? 'pin' : 'users-round'} />
          <span className="d-grow">{mine ? 'My attendance' : 'The team'}</span>
          <Icon name="arrow-right" />
        </Link>
      </div>

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

      {got.data.editable && mine && (
        <p className="v2-back-row"><Link to="/profile">Edit my profile</Link></p>
      )}
      {!mine && <p className="v2-back-row"><Link to="/v2/team">← The team</Link></p>}
    </div>
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
