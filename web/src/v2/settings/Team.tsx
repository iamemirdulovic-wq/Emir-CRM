import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.js';
import { Icon } from '../../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SettingsShell, SettingsTitle } from './Shell.js';

/**
 * Settings → Team and roles.
 *
 * Built from `design/web/settings-team.html`: three tabs — the people, who has
 * notifications on, and what each role can actually do.
 *
 * The second tab is the one that earns its place. Somebody with no phone
 * registered gets no alert, so a VIP lead handed to them can run out of time
 * in silence, and nothing anywhere else in the CRM says so. Each person turns
 * alerts on for themselves; an owner can see who has not, and remind them.
 *
 * Three rules on this page are not decoration:
 *
 *  - **Making somebody an owner, or taking it away, needs a second tap.**
 *    An owner can see and change everything including the other owners, and
 *    the select used to save on the first change of a dropdown — one stray
 *    scroll wheel over a `<select>` and an agent had the keys.
 *  - **An owner can never be deactivated.** The menu item is disabled and
 *    says why, and `PATCH /api/users/:id` refuses it too. On an installation
 *    with one owner, allowing it locks everybody out of their own CRM.
 *  - **An admin cannot touch an owner.** The design says so in its footnote
 *    and the server now enforces it.
 */

type AttendanceStatus = 'office' | 'late' | 'outside' | 'leave' | 'absent' | 'off';

interface Member {
  id: string;
  name: string;
  email: string | null;
  role: string;
  title: string | null;
  photoUrl: string | null;
  isActive: boolean;
  neverSignedIn: boolean;
  lastLoginAt: string | null;
  openLeads: number;
  attendance: AttendanceStatus;
  phonePlatform: 'ios' | 'android' | null;
  computerAlerts: boolean;
  lastAlertAt: string | null;
  lastAlertOpened: boolean;
}

interface TeamRoles {
  members: Member[];
  counts: {
    people: number;
    owners: number;
    admins: number;
    managers: number;
    agents: number;
    deactivated: number;
    neverSignedIn: number;
    withAlerts: number;
    withoutAlerts: number;
  };
}

/** The design's own four, in the design's order. */
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'owner', label: 'Owners' },
  { value: 'admin', label: 'Admin' },
  { value: 'agent', label: 'Agents' },
];

/** The roles a row's select offers, as the design lists them. */
const ROLES = ['agent', 'admin', 'owner'] as const;

/**
 * What each role can do, in the design's words.
 *
 * The server enforces it; this only says it out loud. Nine rows, as drawn.
 */
const CAN: Array<{ what: string; agent: string; admin: string; owner: string }> = [
  { what: 'Own leads, calls, follow-ups, calendar', agent: 'yes', admin: 'yes', owner: 'yes' },
  { what: 'See every lead and every agent', agent: 'no', admin: 'yes', owner: 'yes' },
  { what: 'Give, move and import leads', agent: 'no', admin: 'yes', owner: 'yes' },
  { what: 'Approve transfers and leave', agent: 'no', admin: 'yes', owner: 'yes' },
  { what: 'Export leads', agent: 'no', admin: 'yes', owner: 'yes' },
  { what: 'Projects, banners, automations, desks', agent: 'no', admin: 'yes', owner: 'yes' },
  { what: 'Invite people and change roles', agent: 'no', admin: 'not owners', owner: 'yes' },
  { what: 'Deactivate a person', agent: 'no', admin: 'not owners', owner: 'yes' },
  { what: 'Company details and Homes AI budget', agent: 'no', admin: 'no', owner: 'yes' },
];

export function V2SettingsTeam() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const canEdit = isOwner || user?.role === 'admin';

  const [tab, setTab] = useState<'people' | 'notif-on' | 'roles'>('people');
  const [inviting, setInviting] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  /** The row whose ⋯ menu is open. */
  const [menu, setMenu] = useState<string | null>(null);
  /** The row waiting for a second tap on Deactivate. */
  const [deactivating, setDeactivating] = useState<string | null>(null);
  /** `{id, role}` waiting for a second tap on an Owner change. */
  const [askOwner, setAskOwner] = useState<{ id: string; role: string } | null>(null);
  const [reminded, setReminded] = useState<Set<string>>(new Set());
  const toast = useToast();

  const got = useAsync<TeamRoles>(() => api.get('/api/v2/team/roles'), []);

  /* A click anywhere else closes the row menu, as a menu should. */
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => { setMenu(null); setDeactivating(null); };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  useEffect(() => {
    if (!askOwner) return undefined;
    const timer = window.setTimeout(() => setAskOwner(null), 4000);
    return () => window.clearTimeout(timer);
  }, [askOwner]);

  const members = got.data?.members ?? [];
  const counts = got.data?.counts;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((one) => {
      if (filter && one.role !== filter) return false;
      if (!needle) return true;
      return one.name.toLowerCase().includes(needle)
        || (one.email ?? '').toLowerCase().includes(needle)
        || (one.title ?? '').toLowerCase().includes(needle);
    });
  }, [members, search, filter]);

  async function changeRole(person: Member, role: string) {
    /* Owner in either direction needs the second tap. */
    if ((role === 'owner' || person.role === 'owner') && askOwner?.id !== person.id) {
      setAskOwner({ id: person.id, role });
      return;
    }
    setAskOwner(null);
    const was = person.role;
    setBusy(person.id);
    try {
      await api.patch(`/api/users/${person.id}`, { role });
      toast(
        `${first(person.name)} is now ${role === 'agent' ? 'an agent' : role === 'admin' ? 'admin' : 'an owner'}`,
        {
          action: {
            label: 'Undo',
            onClick: () => {
              void api.patch(`/api/users/${person.id}`, { role: was }).then(() => got.reload());
            },
          },
        },
      );
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function setActive(person: Member, active: boolean) {
    setBusy(person.id);
    try {
      await api.patch(`/api/users/${person.id}`, { isActive: active });
      if (active) toast(`${first(person.name)} can sign in again`);
      else {
        toast(
          `${first(person.name)} is deactivated${person.openLeads
            ? ` · ${person.openLeads} open leads moved to Incoming` : ''}`,
          {
            action: {
              label: 'Undo',
              onClick: () => {
                void api.patch(`/api/users/${person.id}`, { isActive: true })
                  .then(() => got.reload());
              },
            },
          },
        );
      }
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
      setMenu(null);
      setDeactivating(null);
    }
  }

  async function resetPassword(person: Member) {
    setBusy(person.id);
    try {
      const made = await api.post<{ temporaryPassword: string }>(
        `/api/users/${person.id}/reset-password`,
      );
      /* Nothing here can send an email, so the password is handed over rather
         than promised. Copied straight to the clipboard, because it is shown
         once and a toast disappears. */
      void navigator.clipboard?.writeText(made.temporaryPassword);
      toast(`New password copied: ${made.temporaryPassword} · give it to ${first(person.name)}`);
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
      setMenu(null);
    }
  }

  async function signOutEverywhere(person: Member) {
    setBusy(person.id);
    try {
      await api.post(`/api/users/${person.id}/sign-out-everywhere`);
      toast(`${first(person.name)} is signed out on every device`);
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
      setMenu(null);
    }
  }

  async function remind(who: Member[]) {
    if (who.length === 0) return;
    try {
      await api.post('/api/v2/team/remind-alerts', { userIds: who.map((one) => one.id) });
      setReminded((was) => new Set([...was, ...who.map((one) => one.id)]));
      toast(who.length === 1
        ? `${first(who[0]?.name ?? '')} sees “Turn on notifications” on My Day`
        : `${who.length} agents see “Turn on notifications” on My Day`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not work.');
    }
  }

  if (got.error) {
    return <SettingsShell page="p-set-team"><div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div></SettingsShell>;
  }
  if (!got.data || !counts) {
    return <SettingsShell page="p-set-team"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  const noAlerts = members.filter((one) => one.isActive && !one.phonePlatform && !one.computerAlerts);
  const toRemind = noAlerts.filter((one) => !reminded.has(one.id));

  return (
    <SettingsShell page="p-set-team">
      <div className="d-set-body">
        <SettingsTitle
          title="Team and roles"
          note="Who can sign in, what they can do, and who gets alerts."
          action={canEdit
            ? { icon: 'plus', label: 'Invite a person', onClick: () => setInviting(true) }
            : undefined}
        >
          {canEdit && (
            <button type="button" className="d-btn d-primary" onClick={() => setInviting(true)}>
              <Icon name="plus" />Invite a person
            </button>
          )}
        </SettingsTitle>

        <div className="d-tm-stats">
          <div className="d-card">
            <span className="d-label">People</span>
            <div className="d-stat-row d-mt-8">
              <b className="d-num">{counts.people}</b>
              {/*
                * The design's delta is "0 invites waiting". Nothing here can
                * send an invitation — `POST /api/users` makes the account and
                * hands back a one-time password — so there is no pending state
                * to count. What is countable, and is the same question, is who
                * has an account and has never used it.
                */}
              <span className="d-delta">
                {[
                  `${counts.neverSignedIn} never signed in`,
                  counts.deactivated > 0 ? `${counts.deactivated} deactivated` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          <div className="d-card">
            <span className="d-label">Roles</span>
            <div className="d-row d-gap-16 d-mt-8 v2-tm-roles">
              <span>
                <b className="d-num-sm">{counts.owners}</b>{' '}
                <span className="d-small d-muted">{counts.owners === 1 ? 'owner' : 'owners'}</span>
              </span>
              <span>
                <b className="d-num-sm">{counts.admins}</b>{' '}
                <span className="d-small d-muted">admin</span>
              </span>
              {counts.managers > 0 && (
                <span>
                  <b className="d-num-sm">{counts.managers}</b>{' '}
                  <span className="d-small d-muted">
                    {counts.managers === 1 ? 'manager' : 'managers'}
                  </span>
                </span>
              )}
              <span>
                <b className="d-num-sm">{counts.agents}</b>{' '}
                <span className="d-small d-muted">{counts.agents === 1 ? 'agent' : 'agents'}</span>
              </span>
            </div>
          </div>
          <button type="button" className="d-card d-click" onClick={() => setTab('notif-on')}>
            <span className="d-label">Notifications on</span>
            <div className="d-stat-row d-mt-8">
              <b className="d-num">{counts.withAlerts}</b>
              <span className="d-num-sm d-muted">of {counts.people}</span>
              {counts.withoutAlerts > 0 && (
                <span className="d-delta d-down">{counts.withoutAlerts} get no alerts</span>
              )}
            </div>
          </button>
        </div>

        <section className="d-card">
          <div className="d-tabs" role="tablist">
            <button
              type="button" role="tab" aria-selected={tab === 'people'}
              className={tab === 'people' ? 'd-tab d-on' : 'd-tab'}
              onClick={() => setTab('people')}
            >
              People <span className="d-count">{counts.people}</span>
            </button>
            <button
              type="button" role="tab" aria-selected={tab === 'notif-on'}
              className={tab === 'notif-on' ? 'd-tab d-on' : 'd-tab'}
              onClick={() => setTab('notif-on')}
            >
              Who has notifications on
              {counts.withoutAlerts > 0 && (
                <span className="d-count d-red">{counts.withoutAlerts} off</span>
              )}
            </button>
            <button
              type="button" role="tab" aria-selected={tab === 'roles'}
              className={tab === 'roles' ? 'd-tab d-on' : 'd-tab'}
              onClick={() => setTab('roles')}
            >
              What each role can do
            </button>
          </div>

          {tab === 'people' && (
            <>
              <div className="d-filters">
                <div className="d-input-icon">
                  <Icon name="search" />
                  <input
                    className="d-input d-sm"
                    value={search}
                    aria-label="Search name or email"
                    placeholder="Search name or email"
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="d-seg d-sm" role="group" aria-label="Role">
                  {FILTERS.map((one) => (
                    <button
                      key={one.value || 'all'}
                      type="button"
                      className={filter === one.value ? 'd-on' : undefined}
                      onClick={() => setFilter(one.value)}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
                <span className="d-grow" />
                <span className="d-result-count">
                  {rows.length === 0
                    ? 'Nobody found'
                    : `${rows.length} ${rows.length === 1 ? 'person' : 'people'}`}
                </span>
              </div>

              {rows.length === 0 ? (
                <div className="d-empty">
                  <span className="d-ic"><Icon name="search" /></span>
                  <b>Nobody found</b>
                  <p>Try another name or email, or choose “All”.</p>
                  <button
                    type="button"
                    className="d-btn d-sm"
                    onClick={() => { setSearch(''); setFilter(''); }}
                  >
                    Show everyone
                  </button>
                </div>
              ) : (
                <div className="d-table-wrap">
                  <table className="d-table d-id-tm v2-tm-table">
                    <thead>
                      <tr>
                        <th>Person</th><th>Work email</th><th>Role</th><th>Last sign-in</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((one) => {
                        const self = one.id === user?.id;
                        /* An admin may not change an owner at all, which is
                           what the design's footnote says and what the server
                           now refuses. */
                        const mayChange = canEdit && !self
                          && !(user?.role === 'admin' && one.role === 'owner');
                        return (
                          <tr key={one.id} className={one.isActive ? undefined : 'd-off v2-tm-off'}>
                            <td>
                              <span className="d-person">
                                <Face person={one} />
                                <span className="d-who">
                                  <b>{one.name}</b>
                                  <span>{one.title ?? roleWord(one.role)}</span>
                                </span>
                              </span>
                            </td>
                            <td className="d-t-sub">{one.email ?? '—'}</td>
                            <td>
                              {!one.isActive ? (
                                <span className="d-chip d-red">Deactivated</span>
                              ) : self ? (
                                <span className="d-chip d-dark">{roleWord(one.role)} · you</span>
                              ) : !mayChange ? (
                                <span className="d-chip d-dark">{roleWord(one.role)}</span>
                              ) : (
                                <>
                                  <select
                                    className="d-select d-sm v2-role-sel"
                                    value={askOwner?.id === one.id ? one.role : one.role}
                                    disabled={busy === one.id}
                                    aria-label={`Role of ${one.name}`}
                                    onChange={(e) => void changeRole(one, e.target.value)}
                                  >
                                    {ROLES.map((role) => (
                                      <option key={role} value={role}>{roleWord(role)}</option>
                                    ))}
                                    {/* Only shown for somebody who already is
                                        one: manager is not a role this page
                                        hands out, and hiding it would silently
                                        demote them on the next save. */}
                                    {one.role === 'manager' && <option value="manager">Manager</option>}
                                  </select>
                                  {askOwner?.id === one.id && (
                                    <button
                                      type="button"
                                      className="d-btn d-xs d-danger d-solid v2-own-ask"
                                      onClick={() => void changeRole(one, askOwner.role)}
                                    >
                                      {askOwner.role === 'owner'
                                        ? 'Tap again · full access'
                                        : 'Tap again · no longer owner'}
                                    </button>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="d-t-sub">
                              {one.lastLoginAt ? ago(one.lastLoginAt) : 'Not yet'}
                            </td>
                            <td className="d-t-right v2-tm-actions">
                              {!one.isActive ? (
                                <button
                                  type="button"
                                  className="d-btn d-xs"
                                  disabled={busy === one.id || !canEdit}
                                  onClick={() => void setActive(one, true)}
                                >
                                  Activate again
                                </button>
                              ) : self ? (
                                <span className="d-small d-muted">You cannot change yourself</span>
                              ) : mayChange ? (
                                <span className="v2-tm-menu-wrap">
                                  <button
                                    type="button"
                                    className="d-btn d-xs d-icon d-ghost"
                                    aria-label={`More for ${one.name}`}
                                    aria-expanded={menu === one.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setMenu(menu === one.id ? null : one.id);
                                      setDeactivating(null);
                                    }}
                                  >
                                    <Icon name="more-horizontal" />
                                  </button>
                                  {menu === one.id && (
                                    <div
                                      className="d-menu d-open v2-tm-menu"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <div className="d-menu-label">{one.name}</div>
                                      <button
                                        type="button"
                                        className="d-menu-item"
                                        onClick={() => void resetPassword(one)}
                                      >
                                        <Icon name="key-round" />Send a reset link
                                      </button>
                                      <button
                                        type="button"
                                        className="d-menu-item"
                                        onClick={() => void signOutEverywhere(one)}
                                      >
                                        <Icon name="log-out" />Sign out everywhere
                                      </button>
                                      <div className="d-menu-sep" />
                                      <button
                                        type="button"
                                        className="d-menu-item d-danger"
                                        disabled={one.role === 'owner'}
                                        onClick={() => {
                                          if (deactivating !== one.id) {
                                            setDeactivating(one.id);
                                            return;
                                          }
                                          void setActive(one, false);
                                        }}
                                      >
                                        <Icon name="trash-2" />
                                        {deactivating === one.id ? 'Tap again to deactivate' : 'Deactivate'}
                                      </button>
                                      <div className="d-small d-muted v2-tm-why">
                                        {one.role === 'owner'
                                          ? 'An owner cannot be deactivated.'
                                          : one.openLeads > 0
                                            ? `${one.openLeads} open leads go to Incoming. Notes and history stay.`
                                            : 'They cannot sign in any more. History stays.'}
                                      </div>
                                    </div>
                                  )}
                                </span>
                              ) : (
                                <span className="d-small d-muted">Only an owner can change this</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="d-small d-muted d-mt-12">
                Admin can do the same as an owner, but cannot remove or change owners. An owner
                can never be deactivated.
              </p>
            </>
          )}

          {tab === 'notif-on' && (
            <>
              {counts.withoutAlerts > 0 && (
                <div className="d-banner d-amber d-mb-16">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">
                    <b>{counts.withoutAlerts} get no alerts.</b> A VIP lead for them can run
                    out of time without a sound.
                  </span>
                  <button
                    type="button"
                    className="d-btn d-xs"
                    disabled={toRemind.length === 0}
                    onClick={() => void remind(toRemind)}
                  >
                    {toRemind.length === 0
                      ? 'Reminded'
                      : `Remind all ${toRemind.length}`}
                  </button>
                </div>
              )}

              <div className="d-table-wrap">
                <table className="d-table">
                  <thead>
                    <tr>
                      <th>Person</th><th>Phone app</th><th>Computer</th><th>Last alert</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {members.filter((one) => one.isActive).map((one) => {
                      const nothing = !one.phonePlatform && !one.computerAlerts;
                      return (
                        <tr key={one.id}>
                          <td>
                            <span className="d-person">
                              <Avatar name={one.name} src={one.photoUrl ?? undefined} size={26} />
                              <b className="d-t-main">{one.name}</b>
                            </span>
                          </td>
                          <td>
                            {one.phonePlatform
                              ? (
                                <span className="d-chip d-green d-pip">
                                  On · {one.phonePlatform === 'ios' ? 'iPhone' : 'Android'}
                                </span>
                              )
                              : <span className="d-chip d-red d-pip">Not installed</span>}
                          </td>
                          <td>
                            {one.computerAlerts
                              ? <span className="d-chip">On</span>
                              : <span className="d-muted">Off</span>}
                          </td>
                          <td className="d-t-sub">
                            {nothing
                              ? 'Gets no alerts'
                              : one.lastAlertAt
                                ? `${one.lastAlertOpened ? 'Opened an alert' : 'Sent an alert'} ${
                                  ago(one.lastAlertAt).toLowerCase()}`
                                : 'No alert sent yet'}
                          </td>
                          <td className="d-t-right">
                            {nothing && (
                              <button
                                type="button"
                                className="d-btn d-xs"
                                disabled={reminded.has(one.id)}
                                onClick={() => void remind([one])}
                              >
                                {reminded.has(one.id) ? 'Reminded' : 'Remind'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="d-small d-muted d-mt-12">
                Each person turns alerts on for themselves. You can only remind them.{' '}
                <Link className="d-link" to="/v2/settings/phone-app">Open the install guide</Link>
              </p>

              {/*
                * The design draws four phone states — On · iPhone, Not
                * installed, Blocked in phone settings, Switched off. The last
                * two are the phone's own notification permission, which the
                * phone never reports back to a server. There are three here,
                * and the third says what is true.
                */}
              <p className="d-small d-muted">
                “Not installed” means no phone has registered for alerts. Whether somebody
                installed the app and then blocked notifications is something only their phone
                knows, so it reads the same here.
              </p>
            </>
          )}

          {tab === 'roles' && (
            <div className="d-table-wrap">
              <table className="d-table">
                <thead>
                  <tr>
                    <th>Can do</th>
                    <th className="d-t-center">Agent</th>
                    <th className="d-t-center">Admin</th>
                    <th className="d-t-center">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {CAN.map((row) => (
                    <tr key={row.what}>
                      <td className="d-t-main">{row.what}</td>
                      {([row.agent, row.admin, row.owner]).map((value, i) => (
                        <td className="d-t-center" key={i}>
                          {value === 'yes'
                            ? <Icon name="check" className="d-t-green" />
                            : value === 'no'
                              ? <span className="d-muted">–</span>
                              : <span className="d-small d-muted">{value}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {inviting && (
        <Invite
          emails={members.map((one) => (one.email ?? '').toLowerCase()).filter(Boolean)}
          onClose={() => setInviting(false)}
          onDone={() => got.reload()}
        />
      )}
    </SettingsShell>
  );
}

/**
 * The avatar with the attendance dot on it.
 *
 * The design hangs it off `.av[data-status]`; our `Avatar` takes a name, a
 * photo and a size, and five screens already use it, so the dot goes on a
 * wrapper. A deactivated person gets no dot: they are not late, they are gone.
 */
function Face({ person }: { person: Member }) {
  const face = <Avatar name={person.name} src={person.photoUrl ?? undefined} size={32} />;
  if (!person.isActive) return face;
  return <span className={`v2-face v2-face-${person.attendance}`}>{face}</span>;
}

/* ── invite a person ───────────────────────────────────────────────────── */

/**
 * Name, work email, Agent or Admin — the three fields the design asks for,
 * with the design's own three error messages.
 *
 * One honest difference, in `docs/decisions-to-confirm.md`: the design says
 * "They get an email with a link to set a password". `POST /api/users` does
 * not send anything. It returns a one-time password, once, for the person who
 * made the account to hand over, and the new account must change it at the
 * first sign-in. So the dialog says that instead of promising an email that
 * never arrives.
 */
function Invite({
  emails, onClose, onDone,
}: {
  emails: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'agent' | 'admin'>('agent');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => { box.current?.focus(); }, []);

  const nameWrong = name.trim().length < 3 ? 'Write the full name.' : undefined;
  const emailWrong = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
    ? 'Write a real email, like name@homes.me.'
    : emails.includes(email.trim().toLowerCase())
      ? 'This email is already in the team.'
      : undefined;

  async function send() {
    setTried(true);
    if (nameWrong || emailWrong) return;
    setBusy(true);
    setProblem(null);
    try {
      const got = await api.post<{ id: string; email: string; temporaryPassword: string }>(
        '/api/users',
        { name: name.trim(), email: email.trim(), role },
      );
      setMade({ email: got.email, temporaryPassword: got.temporaryPassword });
      onDone();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="d-scrim d-show" onClick={onClose} aria-hidden />
      <div className="d-dialog d-open" role="dialog" aria-label="Invite a person">
        <div className="d-dialog-head">
          <div className="d-grow">
            <h3>{made ? 'Account made' : 'Invite a person'}</h3>
            <p>
              {made
                ? 'Give them this password. They change it the first time they sign in.'
                : 'They get a one-time password to sign in with, which you hand over.'}
            </p>
          </div>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-dialog-body">
          {made ? (
            <div className="d-col d-gap-16">
              <div className="d-field">
                <label>Work email</label>
                <input className="d-input" readOnly value={made.email} aria-label="Work email" />
              </div>
              <div className="d-field">
                <label>One-time password</label>
                <input
                  className="d-input"
                  readOnly
                  value={made.temporaryPassword}
                  aria-label="One-time password"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <span className="d-hint">
                  Shown once. Nothing emails it, so copy it before you close this.
                </span>
              </div>
            </div>
          ) : (
            <div className="d-col d-gap-16">
              <div className={tried && nameWrong ? 'd-field d-invalid' : 'd-field'}>
                <label htmlFor="iv-name">Full name <span className="d-req">*</span></label>
                <input
                  id="iv-name"
                  ref={box}
                  className="d-input"
                  value={name}
                  aria-label="Full name"
                  placeholder="Maria Lopez"
                  onChange={(e) => setName(e.target.value)}
                />
                <span className="d-error">{nameWrong}</span>
              </div>
              <div className={tried && emailWrong ? 'd-field d-invalid' : 'd-field'}>
                <label htmlFor="iv-email">Work email <span className="d-req">*</span></label>
                <div className="d-input-icon">
                  <Icon name="mail" />
                  <input
                    id="iv-email"
                    className="d-input"
                    type="email"
                    value={email}
                    aria-label="Work email"
                    placeholder="name@homes.me"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <span className="d-error">{emailWrong}</span>
              </div>
              <div className="d-field">
                <span className="d-field-label">Role</span>
                <div className="d-seg d-block">
                  <button
                    type="button"
                    className={role === 'agent' ? 'd-on' : undefined}
                    onClick={() => setRole('agent')}
                  >
                    Agent
                  </button>
                  <button
                    type="button"
                    className={role === 'admin' ? 'd-on' : undefined}
                    onClick={() => setRole('admin')}
                  >
                    Admin
                  </button>
                </div>
                <span className="d-hint">
                  {role === 'agent'
                    ? 'An agent sees only their own leads and the free leads in Incoming.'
                    : 'Admin can do the same as an owner, but cannot remove owners.'}
                </span>
              </div>
              {problem && <ErrorNote>{problem}</ErrorNote>}
            </div>
          )}
        </div>

        <div className="d-dialog-foot">
          {made ? (
            <>
              <span className="d-grow" />
              <button
                type="button"
                className="d-btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(made.temporaryPassword);
                  toast('Password copied');
                }}
              >
                Copy the password
              </button>
              <button type="button" className="d-btn d-primary" onClick={onClose}>Done</button>
            </>
          ) : (
            <>
              <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
              <button
                type="button"
                className="d-btn d-primary"
                disabled={busy}
                onClick={() => void send()}
              >
                {busy ? 'Making the account…' : 'Make the account'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function roleWord(role: string): string {
  if (role === 'agent') return 'Agent';
  if (role === 'manager') return 'Manager';
  if (role === 'admin') return 'Admin';
  if (role === 'owner') return 'Owner';
  return role;
}

const first = (name: string) => name.split(' ')[0] ?? name;

function ago(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 2) return 'Now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) {
    /* Inside today, the design shows the clock: "Today 09:12". 24-hour. */
    const dubai = new Date(new Date(at).getTime() + 4 * 3600_000);
    return `Today ${String(dubai.getUTCHours()).padStart(2, '0')}:${
      String(dubai.getUTCMinutes()).padStart(2, '0')}`;
  }
  const days = Math.round(mins / (60 * 24));
  return days < 30
    ? `${days} days ago`
    : new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
