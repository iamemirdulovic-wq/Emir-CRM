import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../design/ui.js';
import { SettingsShell } from './settings/Shell.js';
import { usePhoneHead } from './phone.js';
import { V2Person } from './Team.js';
import { V2PersonalInfo } from './PersonalInfo.js';

/**
 * My profile — `design/web/profile.html`, exactly as it is drawn.
 *
 * The design's page is one screen: the hero with this month's bar and three
 * stats, the three shortcuts, and then a card with two tabs — Personal info
 * and Security. The build had it as three separate addresses (`/v2/profile`,
 * `/v2/me`, `/v2/settings/security`), none of them inside the settings shell
 * the design draws around it. This is the one page, at both of the first two
 * addresses, with the section list down the left where the design has it.
 *
 * Only on a computer. Under 768px the phone package has its own three
 * screens for this — `Profile.dc.html` is a hub of menu rows,
 * `PersonalInfo.dc.html` and `Security.dc.html` are the two halves of the
 * form — and all three are built already, so a phone is handed those rather
 * than this page made narrower.
 *
 * Six things the design shows that are **not** here, each because the number
 * behind it does not exist. Every one is written up in
 * `docs/v2/questions-inbox.md` and in `docs/decisions-to-confirm.md`:
 *
 *  - **"Performance this month · 86%"** against a monthly target. No target
 *    is stored anywhere in this CRM, so the bar shows the badges earned —
 *    a real count out of a real total — in the design's own place.
 *  - **Two-step sign-in.** There is no second factor in this build; CLAUDE.md
 *    says email and password only, "no OTP". A switch that claims an account
 *    is protected by something that does not exist is worse than no switch,
 *    so both roles get the block that says what is true.
 *  - **"Last changed 24 Sep 2026"** under Password. Nothing records when a
 *    password was last changed.
 *  - **The place a device signed in from** ("Dubai · active now") and the
 *    **"new place"** flag. The session row keeps an address, not a city.
 *  - **The desk** in the hero's first chip ("Arabic desk"). No desk is stored
 *    against a person; what they sell is, and that is what the chip shows.
 */

interface Profile {
  profile: {
    user_id: string;
    name: string;
    email: string;
    slug: string | null;
    job_title: string | null;
    brn: string | null;
    photo_url: string | null;
    public_phone: string | null;
    public_email: string | null;
    whatsapp: string | null;
    languages: unknown;
    specialities: unknown;
    role?: string;
  };
  stats: {
    dealsWon: number;
    appointments: number;
    speedToLeadSeconds: number | null;
  } | null;
  level: { level: string; index: number; earned: number; of: number } | null;
  badges?: Array<{ key: string; earned: boolean }>;
  editable: boolean;
}

interface Board {
  leaderboard: Array<{ id: string; name: string; points: number }>;
  me: { points: number };
}

interface TeamMonth {
  work: {
    units: number;
    meetings: number;
    firstAnswerMinutes: number | null;
    /** Share of the month's new leads answered inside two hours. */
    touchedIn2hPct: number | null;
    touchedIn2hOf: number;
  };
}

/** The ten the design offers, in its order. */
const LANGUAGES = [
  'English', 'Arabic', 'Russian', 'Hindi', 'Urdu',
  'Portuguese', 'Serbian', 'Ukrainian', 'Punjabi', 'French',
];

const ROLE_WORD: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Manager', agent: 'Agent', accountant: 'Accountant',
};

/** 768 is the line the owner drew, and the number `Shell.tsx` uses. */
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

/** `/v2/profile`: the phone's hub, or the computer's page. */
export function V2Profile() {
  const phone = useIsPhone();
  return phone ? <V2Person /> : <MyProfile />;
}

/**
 * `/v2/me`: where the settings list's "My profile" row points.
 *
 * The design's settings nav points that row at `profile.html`, which is this
 * page, so on a computer the two addresses are the same screen. On a phone
 * `PersonalInfo.dc.html` is its own screen and keeps it.
 */
export function V2MyInfo() {
  const phone = useIsPhone();
  return phone ? <V2PersonalInfo /> : <MyProfile />;
}

function MyProfile() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'info' | 'security'>('info');
  const [reloadKey, setReloadKey] = useState(0);
  const got = useAsync<Profile>(() => api.get('/api/profiles/me'), [reloadKey]);

  /* The rank and the points on the first shortcut, from the same board Best
     of Homes ranks on — so the two screens cannot print different numbers. */
  const board = useAsync<Board>(() => api.get('/api/wall/sidebar'), []);

  /*
   * The owner's hero is the team's month, not their own: "Team performance
   * this month", 27 deals, 67 viewings, 9 min. These are the dashboard's own
   * figures for the last 30 days, read from the dashboard's own endpoint, so
   * the profile and the dashboard agree. Owner and admin only, which is who
   * that endpoint answers.
   */
  const inOffice = user?.role === 'owner' || user?.role === 'admin';
  const team = useAsync<TeamMonth | null>(
    () => (inOffice ? api.get('/api/v2/dashboard?period=month') : Promise.resolve(null)),
    [inOffice],
  );

  /*
   * The top bar reads the same slot the phone header does, so the title has
   * to be set here — `/v2/me` is not in `titleFor`'s list and showed
   * "homes.me". `profile.html` carries `data-title="My profile"` and no line
   * under it.
   */
  usePhoneHead({ title: 'My profile' });

  if (got.error) return <SettingsShell page="p-profile"><div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div></SettingsShell>;
  if (!got.data) return <SettingsShell page="p-profile"><div className="d-set-body"><Spinner /></div></SettingsShell>;

  const me = got.data.profile;
  const level = got.data.level;
  const badges = got.data.badges ?? [];
  const earned = badges.filter((one) => one.earned).length;
  const done = badges.length > 0 ? Math.round((earned / badges.length) * 100) : 0;
  const specialities = asList(me.specialities);

  const role = ROLE_WORD[me.role ?? user?.role ?? 'agent'] ?? 'Agent';
  const rank = board.data
    ? board.data.leaderboard.findIndex((one) => one.id === me.user_id) + 1
    : 0;
  const top = board.data?.leaderboard[0] ?? null;

  const stats = got.data.stats;
  const teamWork = team.data?.work ?? null;
  const reply = teamWork
    ? replyFromMinutes(teamWork.firstAnswerMinutes)
    : replyTime(stats?.speedToLeadSeconds ?? null);

  return (
    <SettingsShell page="p-profile">
      <div className="d-set-body">
        <section className="d-card d-hero d-pf-hero">
          <div className="d-pf-id">
            <Avatar name={me.name} src={me.photo_url ?? undefined} size={84} />
            <div className="d-grow">
              <h1>{me.name}</h1>
              <p className="d-muted d-mt-4">{me.job_title ?? 'Property Consultant'} · homes.me</p>
              <div className="d-row d-gap-8 d-mt-12 d-wrap v2-pf-chips">
                {/* The design's "Agent · Dubai off-plan · Arabic desk" — three
                    parts and no more, or the chip runs under the bar beside
                    it. The desk is not stored; what somebody sells is. */}
                <span className="d-hero-chip v2-pf-chip">
                  {/* The chip is a flex row with its own dot, so the text
                      has to be the thing that truncates, not the chip. */}
                  <span className="v2-pf-chip-text">
                    {[role, ...specialities.slice(0, 2)].join(' · ')}
                  </span>
                </span>
                {level && (
                  <span className="d-hero-chip">Level {level.index + 1} · {level.level}</span>
                )}
              </div>
            </div>
          </div>

          <div className="d-pf-perf">
            <div>
              {/*
                * The design's block is "Performance this month · 86%" over a
                * bar, against a monthly target. No target is stored anywhere
                * in this CRM, so neither number here is a score against one:
                * the owner's is the share of the month's new leads answered
                * inside two hours — the team number this company actually
                * manages by — and an agent's is the badges they have earned.
                * Both are counted, and both say which number they are.
                */}
              <span className="d-label">
                {inOffice ? 'Answered in 2 hours this month' : 'Badges earned'}
              </span>
              <div className="d-stat-row d-mt-8">
                <b className="d-num-hero">{teamWork ? `${teamWork.touchedIn2hPct ?? 0}%` : `${done}%`}</b>
                <span className="d-delta">
                  {teamWork ? `of ${teamWork.touchedIn2hOf} new leads` : `${earned} of ${badges.length}`}
                </span>
              </div>
              <div
                className="d-bar d-accent d-mt-12"
                style={{ ['--v' as string]: `${teamWork ? teamWork.touchedIn2hPct ?? 0 : done}%` }}
              >
                <i />
              </div>
              <span className="d-small d-muted d-mt-8 v2-pf-how">
                {inOffice
                  ? 'The whole team, this month. No monthly target is set.'
                  : 'Deals, replies, viewings and days in a row. No target is set.'}
              </span>
            </div>
            <div className="d-pf-stats">
              <Link to="/v2/pipeline">
                <b className="d-num">{teamWork ? teamWork.units : stats?.dealsWon ?? 0}</b>
                <span>Deals</span>
              </Link>
              <Link to="/v2/calendar">
                <b className="d-num">{teamWork ? teamWork.meetings : stats?.appointments ?? 0}</b>
                <span>Viewings</span>
              </Link>
              <Link to="/v2/leads">
                {/* The design writes the unit small beside the number:
                    `<b class="num">5<small> min</small></b>`. */}
                <b className="d-num">
                  {reply.value}<small> {reply.unit}</small>
                </b>
                <span>Avg reply</span>
              </Link>
            </div>
          </div>
        </section>

        <div className="d-pf-links">
          {/* "Best of Homes · rank 2 · 1,740 points", with the real rank and
              the real points. An owner is not ranked among their own agents,
              so theirs reads the way the design's owner variant does. */}
          <Link className="d-shortcut" to="/v2/best">
            <Icon name="trophy" />
            <span className="d-grow">
              {rank > 0
                ? `Best of Homes · rank ${rank} · ${(board.data?.me.points ?? 0).toLocaleString('en-GB')} points`
                : top
                  ? `Best of Homes · ${top.name.split(' ')[0]} leads with ${top.points.toLocaleString('en-GB')}`
                  : 'Best of Homes'}
            </span>
            <Icon name="arrow-right" />
          </Link>
          <Link className="d-shortcut" to="/v2/card">
            <Icon name="id-card" />
            <span className="d-grow">Business card</span>
            <Icon name="arrow-right" />
          </Link>
          <Link className="d-shortcut" to="/v2/attendance">
            <Icon name="pin" />
            <span className="d-grow">{inOffice ? 'Team attendance' : 'My attendance'}</span>
            <Icon name="arrow-right" />
          </Link>
        </div>

        <section className="d-card">
          <div className="d-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'info'}
              className={tab === 'info' ? 'd-tab d-on' : 'd-tab'}
              onClick={() => setTab('info')}
            >
              Personal info
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'security'}
              className={tab === 'security' ? 'd-tab d-on' : 'd-tab'}
              onClick={() => setTab('security')}
            >
              Security
            </button>
          </div>

          {tab === 'info'
            ? <InfoPanel got={got.data} onSaved={() => setReloadKey((n) => n + 1)} />
            : <SecurityPanel />}
        </section>
      </div>
    </SettingsShell>
  );
}

/* ── Personal info ─────────────────────────────────────────────────────── */

interface Draft {
  name: string;
  jobTitle: string;
  brn: string;
  publicPhone: string;
  whatsapp: string;
  publicEmail: string;
  languages: string[];
}

function InfoPanel({ got, onSaved }: { got: Profile; onSaved: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const me = got.profile;
  const pick = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<Draft>({
    name: me.name ?? '',
    jobTitle: me.job_title ?? '',
    brn: me.brn ?? '',
    publicPhone: me.public_phone ?? '',
    whatsapp: me.whatsapp ?? '',
    publicEmail: me.public_email ?? '',
    languages: asList(me.languages),
  });
  const [same, setSame] = useState(!me.whatsapp || me.whatsapp === me.public_phone);
  const [bad, setBad] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [photo, setPhoto] = useState(me.photo_url);
  /* The panel keeps its own draft across a save, so the photo has to be told
     when the answer changes underneath it — otherwise uploading one leaves
     the Remove button hidden until the page is opened again. */
  useEffect(() => { setPhoto(me.photo_url); }, [me.photo_url]);
  /* The design asks twice before the photo goes, then offers an undo. */
  const [armed, setArmed] = useState(false);

  /* A name an agent cannot save is a field an agent should not be given:
     `PATCH /api/users/:id` is admin-only and the server refuses them. */
  const canRename = user?.role === 'owner' || user?.role === 'admin';

  function set(patch: Partial<Draft>) {
    setDraft((was) => ({ ...was, ...patch }));
    setBad({});
    setProblem(null);
  }

  /* The design's own eight: a photo, the seven fields, and the languages. */
  const parts: Array<[string, boolean]> = [
    ['a photo', Boolean(photo)],
    ['your name', draft.name.trim().length >= 3],
    ['a title', draft.jobTitle.trim().length > 0],
    ['your BRN', /^\d{4,6}$/.test(draft.brn.trim())],
    ['your phone', digits(draft.publicPhone).length >= 9],
    ['your WhatsApp', same || digits(draft.whatsapp).length >= 9],
    ['your email', draft.publicEmail.trim().length > 0],
    ['a language', draft.languages.length > 0],
  ];
  const missing = parts.filter(([, filled]) => !filled).map(([label]) => label);
  const percent = Math.round(((parts.length - missing.length) / parts.length) * 100);

  async function save() {
    const found: Record<string, string> = {};
    if (draft.name.trim().length < 3) found.name = 'Write your full name.';
    if (!/^\d{4,6}$/.test(draft.brn.trim())) found.brn = 'A BRN has 4 to 6 digits.';
    if (!telLike(draft.publicPhone)) found.phone = 'Digits only, at least 9.';
    if (!same && draft.whatsapp.trim() && !telLike(draft.whatsapp)) {
      found.whatsapp = 'Digits only, at least 9.';
    }
    if (draft.languages.length === 0) found.languages = 'Choose at least one language.';
    setBad(found);
    if (Object.keys(found).length > 0) {
      /* The design's own words when a form is refused. */
      toast('Not saved yet. Check the red fields.');
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      await api.patch(`/api/profiles/${me.user_id}`, {
        jobTitle: draft.jobTitle.trim() || null,
        brn: draft.brn.trim() || null,
        publicPhone: draft.publicPhone.trim() || null,
        whatsapp: (same ? draft.publicPhone.trim() : draft.whatsapp.trim()) || null,
        publicEmail: draft.publicEmail.trim() || null,
        languages: draft.languages,
      });
      if (canRename && draft.name.trim() !== me.name) {
        await api.patch(`/api/users/${me.user_id}`, { name: draft.name.trim() });
      }
      toast('Profile saved');
      onSaved();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await api.upload(`/api/profiles/${me.user_id}/photo`, file);
      toast('New photo is in place');
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not upload that');
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    try {
      await api.del(`/api/profiles/${me.user_id}/photo`);
      setPhoto(null);
      setArmed(false);
      toast('Photo removed', { action: { label: 'Undo', onClick: () => pick.current?.click() } });
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="d-pf-done">
        <div className="d-grow">
          <b className="d-bold">Profile {percent}% complete</b>
          <div
            className={percent === 100 ? 'd-bar d-green d-mt-8' : 'd-bar d-accent d-mt-8'}
            style={{ ['--v' as string]: `${percent}%` }}
          >
            <i />
          </div>
        </div>
        <span className="d-small d-muted v2-pf-missing">
          {missing.length === 0
            ? 'Colleagues and transfers use this.'
            : `Missing: ${missing.join(', ')}.`}
        </span>
      </div>

      <div className="d-set-row">
        <div className="d-lab">
          <b>Photo</b>
          <span>A clear face photo. Shown to the team and on your card.</span>
        </div>
        <div className="d-row d-gap-16">
          <Avatar name={me.name} src={photo ?? undefined} size={84} />
          <div className="d-btn-row">
            <button
              type="button"
              className="d-btn d-sm"
              disabled={busy}
              onClick={() => pick.current?.click()}
            >
              <Icon name="camera" />Change photo
            </button>
            {photo && (
              <button
                type="button"
                className="d-btn d-sm d-danger"
                disabled={busy}
                onClick={() => (armed ? void removePhoto() : setArmed(true))}
                onBlur={() => setArmed(false)}
              >
                {armed ? 'Tap again to remove' : 'Remove'}
              </button>
            )}
            <input
              ref={pick}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </div>
        </div>
      </div>

      <div className="d-set-row">
        <div className="d-lab">
          <b>About you</b>
          <span>Your name and title show on the business card.</span>
        </div>
        <div className="d-form-grid">
          <div className={bad.name ? 'd-field d-invalid' : 'd-field'}>
            <label htmlFor="pf-name">Full name <span className="d-req">*</span></label>
            {canRename ? (
              <input
                id="pf-name"
                className="d-input"
                autoComplete="name"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            ) : (
              <>
                <div className="v2-readonly-box">{me.name}</div>
                <span className="d-hint">Your name is on your account. Ask an owner to change it.</span>
              </>
            )}
            <span className="d-error">{bad.name}</span>
          </div>
          <div className="d-field">
            <label htmlFor="pf-title">Title</label>
            <input
              id="pf-title"
              className="d-input"
              placeholder="Property Consultant"
              value={draft.jobTitle}
              onChange={(e) => set({ jobTitle: e.target.value })}
            />
          </div>
          <div className={bad.brn ? 'd-field d-invalid' : 'd-field'}>
            <label htmlFor="pf-brn">BRN <span className="d-req">*</span></label>
            <input
              id="pf-brn"
              className="d-input"
              inputMode="numeric"
              value={draft.brn}
              onChange={(e) => set({ brn: e.target.value })}
            />
            <span className="d-hint">Broker registration number · 4 to 6 digits</span>
            <span className="d-error">{bad.brn}</span>
          </div>
        </div>
      </div>

      <div className="d-set-row">
        <div className="d-lab">
          <b>Contact</b>
          <span>Colleagues can phone or write to you from the Team page.</span>
        </div>
        <div className="d-form-grid">
          <div className={bad.phone ? 'd-field d-invalid' : 'd-field'}>
            <label htmlFor="pf-phone">Phone <span className="d-req">*</span></label>
            <div className="d-input-icon">
              <Icon name="phone" />
              <input
                id="pf-phone"
                className="d-input"
                type="tel"
                inputMode="tel"
                placeholder="+971 …"
                value={draft.publicPhone}
                onChange={(e) => set({ publicPhone: e.target.value })}
              />
            </div>
            <span className="d-error">{bad.phone}</span>
          </div>
          <div className={bad.whatsapp ? 'd-field d-invalid' : 'd-field'}>
            <label htmlFor="pf-wa">WhatsApp</label>
            <div className="d-input-icon">
              <Icon name="message-circle" />
              <input
                id="pf-wa"
                className="d-input"
                type="tel"
                inputMode="tel"
                disabled={same}
                value={same ? draft.publicPhone : draft.whatsapp}
                onChange={(e) => set({ whatsapp: e.target.value })}
              />
            </div>
            <label className="d-switch d-small d-mt-4">
              <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} />
              <span className="d-track" />
              WhatsApp is the same number
            </label>
            <span className="d-error">{bad.whatsapp}</span>
          </div>
          <div className="d-field d-full">
            <label htmlFor="pf-email">Email</label>
            <div className="d-input-icon">
              <Icon name="mail" />
              <input
                id="pf-email"
                className="d-input"
                type="email"
                placeholder="name@homes.me"
                value={draft.publicEmail}
                onChange={(e) => set({ publicEmail: e.target.value })}
              />
            </div>
            {/*
              * The design's field is the sign-in email, read-only, "Ask an
              * owner to change it". This one is the address on the card and
              * the profile, which is the editable one — taking it away would
              * leave an agent no way to put an email on their own card. The
              * sign-in address is named beside it, and it is still the
              * owner's to change.
              */}
            <span className="d-hint">
              Shown on your card. You sign in with {me.email} — ask an owner to change that.
            </span>
          </div>
        </div>
      </div>

      <div className="d-set-row">
        <div className="d-lab">
          <b>Languages</b>
          <span>Used to find the best agent in transfers, and in the team filters.</span>
        </div>
        <div className={bad.languages ? 'd-field d-invalid' : 'd-field'}>
          <div className="d-chips">
            {LANGUAGES.map((one) => {
              const on = draft.languages.includes(one);
              return (
                <button
                  key={one}
                  type="button"
                  className={on ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  aria-pressed={on}
                  onClick={() => set({
                    languages: on
                      ? draft.languages.filter((lang) => lang !== one)
                      : [...draft.languages, one],
                  })}
                >
                  {one}
                </button>
              );
            })}
          </div>
          <span className="d-error">Choose at least one language.</span>
        </div>
      </div>

      {problem && <ErrorNote>{problem}</ErrorNote>}

      <div className="d-set-savebar d-mt-16">
        <button type="button" className="d-btn d-primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </div>
  );
}

/* ── Security ──────────────────────────────────────────────────────────── */

interface Device {
  id: string;
  current: boolean;
  device: string;
  handheld: boolean;
  lastSeenAt: string;
  createdAt: string;
}

function SecurityPanel() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [bad, setBad] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const devices = useAsync<{ items: Device[] }>(() => api.get('/api/auth/sessions'), [reloadKey]);
  const others = (devices.data?.items ?? []).filter((one) => !one.current);
  const [armed, setArmed] = useState<string | null>(null);

  async function change() {
    const found: Record<string, string> = {};
    if (!current) found.now = 'Write your password.';
    if (next.length < 8) found.next = 'At least 8 letters or numbers.';
    /* The design's own two, in its own words. */
    else if (next === current) found.next = 'The new password must be different.';
    else if (again && next !== again) found.again = 'The two passwords are not the same.';
    else if (!again) found.again = 'Write the new password again.';
    setBad(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setProblem(null);
    try {
      await api.post('/api/auth/change-password', {
        currentPassword: current, newPassword: next,
      });
      setCurrent('');
      setNext('');
      setAgain('');
      setReloadKey((n) => n + 1);
      toast('Password changed · other devices are signed out');
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  async function signOutOne(one: Device) {
    try {
      await api.del(`/api/auth/sessions/${one.id}`);
      setArmed(null);
      setReloadKey((n) => n + 1);
      toast(`${one.device} is signed out`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not work.');
    }
  }

  async function signOutOthers() {
    try {
      const done = await api.del<{ signedOut: number }>('/api/auth/sessions');
      setArmed(null);
      setReloadKey((n) => n + 1);
      toast(`${done.signedOut} other device${done.signedOut === 1 ? '' : 's'} signed out`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not work.');
    }
  }

  const leave = () => { void signOut().then(() => navigate('/login', { replace: true })); };
  const strength = strengthOf(next);

  return (
    <div>
      <div className="d-set-row">
        <div className="d-lab">
          <b>Password</b>
          {/* The design writes the date it was last changed here. Nothing
              records it. */}
          <span>Changing it signs out every other device.</span>
        </div>
        <div className="d-form-grid">
          <div className={bad.now ? 'd-field d-full d-invalid' : 'd-field d-full'}>
            <label htmlFor="pw-now">Password now <span className="d-req">*</span></label>
            <input
              id="pw-now"
              className="d-input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => { setCurrent(e.target.value); setBad({}); }}
            />
            <span className="d-error">{bad.now}</span>
          </div>
          <div className={bad.next ? 'd-field d-invalid' : 'd-field'}>
            <label htmlFor="pw-new">New password <span className="d-req">*</span></label>
            <input
              id="pw-new"
              className="d-input"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => { setNext(e.target.value); setBad({}); }}
            />
            {/* The design's three-bar meter, with its changing hint. */}
            <div className={strength.score > 0 ? `d-pw-meter d-s${strength.score}` : 'd-pw-meter'}>
              <i /><i /><i />
            </div>
            <span className="d-hint">{strength.hint}</span>
            <span className="d-error">{bad.next}</span>
          </div>
          <div className={bad.again ? 'd-field d-invalid' : 'd-field'}>
            <label htmlFor="pw-again">New password again <span className="d-req">*</span></label>
            <input
              id="pw-again"
              className="d-input"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => { setAgain(e.target.value); setBad({}); }}
            />
            <span className="d-error">{bad.again}</span>
          </div>
          <div className="d-full">
            <button type="button" className="d-btn" disabled={busy} onClick={change}>
              <Icon name="key-round" />{busy ? 'Changing…' : 'Change password'}
            </button>
          </div>
          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>
      </div>

      <div className="d-set-row">
        <div className="d-lab">
          <b>Two-step sign-in</b>
          <span>A second code after the password.</span>
        </div>
        {/*
          * The design gives an owner a switch that is on, with backup codes
          * and a "move to a new phone" button. There is no second factor in
          * this build at all — CLAUDE.md's LOGIN section is email and
          * password, "no OTP" — so nobody is shown a switch that would claim
          * their account is protected by something that is not there.
          */}
        <div className="d-banner">
          <Icon name="shield" />
          <span className="d-grow">
            Two-step sign-in is not switched on for anybody yet. Your account is
            protected by your password, by the 15-minute lock after five wrong tries,
            and by the device list below.
          </span>
        </div>
      </div>

      <div className="d-set-row">
        <div className="d-lab">
          <b>Signed-in devices</b>
          <span>Do you not know a device? Sign it out and change your password.</span>
        </div>
        <div>
          {devices.error && <ErrorNote>{devices.error}</ErrorNote>}
          {!devices.data && !devices.error && <Spinner />}
          <div className="d-divide">
            {(devices.data?.items ?? []).map((one) => (
              <div className="d-dev" key={one.id}>
                <span className="d-card-icon">
                  <Icon name={one.handheld ? 'smartphone' : 'monitor'} />
                </span>
                <div className="d-grow">
                  <b className="d-bold">{one.device}</b>
                  <div className="d-small d-muted v2-dev-when">{seen(one.lastSeenAt)}</div>
                </div>
                {one.current ? (
                  <span className="d-chip d-green d-pip">This device</span>
                ) : (
                  <button
                    type="button"
                    className={armed === one.id ? 'd-btn d-sm d-danger' : 'd-btn d-sm'}
                    onClick={() => (armed === one.id ? void signOutOne(one) : setArmed(one.id))}
                    onBlur={() => setArmed((was) => (was === one.id ? null : was))}
                  >
                    {armed === one.id ? 'Tap again to sign out' : 'Sign out'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="d-row d-mt-12">
            <button
              type="button"
              className="d-btn d-danger"
              disabled={others.length === 0}
              onClick={() => (armed === 'all' ? void signOutOthers() : setArmed('all'))}
              onBlur={() => setArmed((was) => (was === 'all' ? null : was))}
            >
              {armed === 'all'
                ? `Tap again · sign out ${others.length} device${others.length === 1 ? '' : 's'}`
                : 'Sign out all others'}
            </button>
            <span className="d-grow" />
            <button type="button" className="d-btn d-ghost" onClick={leave}>
              <Icon name="log-out" />Sign out here
            </button>
          </div>
          <p className="d-small d-muted d-mt-8">
            Signed in as {user?.email ?? 'you'}. A session lasts 7 days, or 12 hours without
            “keep me signed in”.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/** The design's own rule: digits, spaces and brackets, at least nine digits. */
function telLike(value: string): boolean {
  return !/[^\d\s+()-]/.test(value) && digits(value).length >= 9;
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

/** "5" and "min", from the median seconds to a first reply. */
export function replyTime(seconds: number | null): { value: string; unit: string } {
  if (seconds === null) return { value: '—', unit: '' };
  if (seconds < 90) return { value: String(Math.max(1, Math.round(seconds))), unit: 'sec' };
  return { value: String(Math.round(seconds / 60)), unit: 'min' };
}

function replyFromMinutes(minutes: number | null): { value: string; unit: string } {
  return minutes === null ? { value: '—', unit: '' } : { value: String(minutes), unit: 'min' };
}

/**
 * The three bars and the hint under the new password.
 *
 * The design's own thresholds: under 8 is one red bar, 8 or more is two
 * amber, and ten with both letters and digits is three green.
 */
export function strengthOf(value: string): { score: 0 | 1 | 2 | 3; hint: string } {
  if (!value) return { score: 0, hint: 'At least 8. Mix letters and numbers.' };
  if (value.length < 8) return { score: 1, hint: 'Too short.' };
  if (/[a-z]/i.test(value) && /\d/.test(value) && value.length >= 10) {
    return { score: 3, hint: 'Strong password.' };
  }
  return { score: 2, hint: 'Good. Longer is stronger.' };
}

/** "active now", or the day and the 24-hour time it was last used. */
function seen(at: string): string {
  const when = Date.parse(at);
  if (Number.isNaN(when)) return '';
  if (Date.now() - when < 3 * 60_000) return 'active now';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(when));
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short' })
    .format(new Date());
  return parts.startsWith(today) ? `today ${parts.slice(today.length).replace(/^,\s*/, '')}` : parts;
}
