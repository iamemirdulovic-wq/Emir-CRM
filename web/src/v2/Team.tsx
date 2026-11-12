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
 * `docs/v2/pages.md` §22 and §27. Everybody can see who everybody is — an
 * agent who has just joined needs to know who speaks Russian and who covers
 * Abu Dhabi, and that is the whole point of the screen.
 *
 * What an agent is not shown is how many leads a colleague is holding. The
 * server does not send it to them, so it cannot leak through a screen: that
 * number turns a directory into a league table in the canteen, and it is the
 * owner's to read.
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

export function V2Team() {
  const { user } = useAuth();
  const team = useAsync<{ items: Person[]; canSeeNumbers: boolean }>(
    () => api.get('/api/v2/team'), [],
  );
  const [find, setFind] = useState('');

  const shown = useMemo(() => {
    const term = find.trim().toLowerCase();
    if (!term) return team.data?.items ?? [];
    return (team.data?.items ?? []).filter((one) => [
      one.name, one.title, one.headline, ...one.languages, ...one.specialities,
    ].filter(Boolean).join(' ').toLowerCase().includes(term));
  }, [team.data, find]);

  if (team.error) return <ErrorNote>{team.error}</ErrorNote>;
  if (!team.data) return <Spinner />;

  const inOffice = team.data.items.filter((o) => o.markedToday === 'office').length;

  return (
    <div className="v2-team">
      <header className="v2-inc-head">
        <h1 className="v2-hi">The team</h1>
        <p className="d-muted">
          {team.data.items.length} people · {inOffice} in the office right now
        </p>
      </header>

      <label className="v2-find">
        <Icon name="search" />
        <input
          type="search"
          value={find}
          placeholder="A name, a language, a project"
          onChange={(e) => setFind(e.target.value)}
        />
      </label>

      <ul className="v2-people">
        {shown.map((one) => (
          <li key={one.id}>
            <Link to={`/v2/team/${one.id}`} className="d-card v2-person">
              <Avatar name={one.name} src={one.photoUrl ?? undefined} size={52} />
              <span className="v2-person-who">
                <b>
                  {one.name}
                  {one.id === user?.id && <span className="d-chip">You</span>}
                </b>
                <span>{one.title ?? ROLE[one.role] ?? one.role}</span>
                {one.headline && <span className="v2-person-line">{one.headline}</span>}
              </span>

              <span className="v2-person-tags">
                {one.languages.slice(0, 3).map((lang) => (
                  <span className="d-chip" key={lang}>{lang}</span>
                ))}
              </span>

              <span className="v2-person-now">
                {one.onLeave ? <span className="d-chip d-amber">On leave</span>
                  : one.markedToday === 'office' ? <span className="d-chip d-green">In office</span>
                    : one.markedToday === 'outside' ? <span className="d-chip d-blue">Outside</span>
                      : <span className="d-chip">Not marked</span>}
                {one.openLeads !== null && (
                  <span className="v2-person-n">{one.openLeads} open</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {shown.length === 0 && <p className="v2-none">Nobody matches “{find.trim()}”.</p>}
    </div>
  );
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
  stats: Record<string, number>;
  badges: Array<{ key: string; label: string; earned: boolean }>;
  level: { name?: string } | string | null;
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

  const { profile, stats, badges } = got.data;
  const name = profile.name ?? (mine ? user?.name : null) ?? 'Somebody';
  const languages = asList(profile.languages);
  const specialities = asList(profile.specialities);
  const earned = (badges ?? []).filter((b) => b.earned);

  return (
    <div className="v2-person-page">
      <section className="d-card v2-person-top">
        <Avatar name={name} src={profile.photo_url ?? undefined} size={84} />
        <div className="v2-person-head">
          <h1 className="v2-hi">{name}</h1>
          <p className="d-muted">{profile.job_title ?? 'Property consultant'}</p>
          {profile.headline && <p className="v2-person-line">{profile.headline}</p>}
          <div className="v2-person-acts">
            {profile.public_phone && (
              <a className="d-btn d-sm" href={`tel:${profile.public_phone}`}>
                <Icon name="phone" />Call
              </a>
            )}
            {profile.whatsapp && (
              <a className="d-btn d-sm" target="_blank" rel="noreferrer"
                href={`https://wa.me/${profile.whatsapp.replace(/[^\d]/g, '')}`}>
                <Icon name="message-circle" />WhatsApp
              </a>
            )}
            {profile.public_email && (
              <a className="d-btn d-sm" href={`mailto:${profile.public_email}`}>
                <Icon name="mail" />Email
              </a>
            )}
            {got.data.editable && (
              <Link className="d-btn d-sm" to="/profile">Edit on the old screen</Link>
            )}
          </div>
        </div>
      </section>

      {profile.bio && (
        <section className="d-card">
          <h2 className="d-card-t">About</h2>
          <p className="v2-person-bio">{profile.bio}</p>
        </section>
      )}

      {(languages.length > 0 || specialities.length > 0 || profile.brn) && (
        <section className="d-card">
          <h2 className="d-card-t">Good to know</h2>
          <dl className="v2-kv">
            {languages.length > 0 && (
              <><dt>Speaks</dt><dd>{languages.join(' · ')}</dd></>
            )}
            {specialities.length > 0 && (
              <><dt>Knows</dt><dd>{specialities.join(' · ')}</dd></>
            )}
            {profile.brn && (<><dt>BRN</dt><dd>{profile.brn}</dd></>)}
          </dl>
        </section>
      )}

      {Object.keys(stats ?? {}).length > 0 && (
        <section className="d-card">
          <h2 className="d-card-t">This month</h2>
          <div className="v2-person-stats">
            {Object.entries(stats).slice(0, 6).map(([key, value]) => (
              <div key={key}>
                <b>{typeof value === 'number' ? value.toLocaleString() : String(value)}</b>
                <span>{key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase()}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {earned.length > 0 && (
        <section className="d-card">
          <h2 className="d-card-t">Badges</h2>
          <div className="v2-chips">
            {earned.map((badge) => (
              <span className="v2-chip-opt v2-chip-opt-on" key={badge.key}>{badge.label}</span>
            ))}
          </div>
        </section>
      )}

      <p className="v2-back-row"><Link to="/v2/team">← The team</Link></p>
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
