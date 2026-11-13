import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.js';
import { Icon } from '../../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SettingsShell, SettingsTitle } from './Shell.js';

/**
 * Settings → Team and roles.
 *
 * From `design/web/settings-team.html`: three tabs — the people, who has
 * notifications on, and what each role can actually do.
 *
 * The second tab is the one that earns its place. Somebody with no phone
 * registered gets no alert, so a VIP lead handed to them can run out of time
 * in silence, and nothing anywhere else in the CRM says so. Each person turns
 * alerts on for themselves; an owner can only see who has not and go and ask.
 */

interface Person {
  id: string;
  name: string;
  email?: string;
  role: string;
  is_active: number;
  last_login_at?: string | null;
}

interface Candidate {
  userId: string;
  name: string;
  openLeads: number;
}

interface Push {
  configured: boolean;
  agentsWithoutDevice: number;
  agentsTotal: number;
  missing: string[];
}

const ROLES = ['agent', 'manager', 'admin', 'owner'] as const;

/** What each role can do. The server enforces it; this only says it out loud. */
const CAN: Array<{ what: string; agent: string; admin: string; owner: string }> = [
  { what: 'Own leads, calls, follow-ups, calendar', agent: 'yes', admin: 'yes', owner: 'yes' },
  { what: 'See every lead and every agent', agent: 'no', admin: 'yes', owner: 'yes' },
  { what: 'Give out, move and import leads', agent: 'no', admin: 'yes', owner: 'yes' },
  { what: 'Approve transfers and leave', agent: 'no', admin: 'yes', owner: 'yes' },
  { what: 'Export leads', agent: 'no', admin: 'yes', owner: 'yes' },
  { what: 'Projects, automations, office rules', agent: 'no', admin: 'yes', owner: 'yes' },
  { what: 'Invite people and change roles', agent: 'no', admin: 'not owners', owner: 'yes' },
  { what: 'Deactivate somebody', agent: 'no', admin: 'not owners', owner: 'yes' },
  { what: 'Company details and the AI budget', agent: 'no', admin: 'no', owner: 'yes' },
];

export function V2SettingsTeam() {
  const { user } = useAuth();
  const canEdit = user?.role === 'owner' || user?.role === 'admin';

  const [tab, setTab] = useState<'people' | 'alerts' | 'roles'>('people');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const people = useAsync<{ items: Person[] }>(() => api.get('/api/users'), []);
  const health = useAsync<{ push: Push }>(() => api.get('/api/v2/health'), []);
  const loads = useAsync<{ items: Candidate[] }>(() => api.get('/api/teams/candidates'), []);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (people.data?.items ?? []).filter((one) => {
      if (filter && one.role !== filter) return false;
      if (!needle) return true;
      return one.name.toLowerCase().includes(needle)
        || (one.email ?? '').toLowerCase().includes(needle);
    });
  }, [people.data, search, filter]);

  const byRole = (role: string) => (people.data?.items ?? []).filter((one) => one.role === role).length;
  const openOf = (id: string) => loads.data?.items.find((one) => one.userId === id)?.openLeads;

  async function changeRole(person: Person, role: string) {
    setBusy(person.id);
    try {
      await api.patch(`/api/users/${person.id}`, { role });
      toast(`${person.name} is now ${role === 'agent' ? 'an agent' : `an ${role}`}`);
      people.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  if (people.error) {
    return <SettingsShell page="p-set-team"><div className="d-set-body"><ErrorNote>{people.error}</ErrorNote></div></SettingsShell>;
  }
  if (!people.data) {
    return <SettingsShell page="p-set-team"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  const push = health.data?.push;
  const withAlerts = push ? push.agentsTotal - push.agentsWithoutDevice : null;

  return (
    <SettingsShell page="p-set-team">
      <div className="d-set-body">
        <SettingsTitle
          title="Team and roles"
          note="Who can sign in, what they can do, and who gets alerts."
        />

        <div className="d-tm-stats">
          <div className="d-card">
            <span className="d-label">People</span>
            <div className="d-stat-row d-mt-8">
              <b className="d-num">{people.data.items.filter((one) => one.is_active).length}</b>
            </div>
          </div>
          <div className="d-card">
            <span className="d-label">Roles</span>
            <div className="d-row d-gap-16 d-mt-8 v2-tm-roles">
              <span><b className="d-num-sm">{byRole('owner')}</b> <span className="d-small d-muted">owner</span></span>
              <span><b className="d-num-sm">{byRole('admin')}</b> <span className="d-small d-muted">admin</span></span>
              <span><b className="d-num-sm">{byRole('agent')}</b> <span className="d-small d-muted">agents</span></span>
            </div>
          </div>
          <button type="button" className="d-card d-click" onClick={() => setTab('alerts')}>
            <span className="d-label">Notifications on</span>
            <div className="d-stat-row d-mt-8">
              <b className="d-num">{withAlerts ?? '—'}</b>
              {push && <span className="d-num-sm d-muted">of {push.agentsTotal}</span>}
              {push && push.agentsWithoutDevice > 0 && (
                <span className="d-delta d-down">{push.agentsWithoutDevice} get no alerts</span>
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
              People <span className="d-count">{people.data.items.length}</span>
            </button>
            <button
              type="button" role="tab" aria-selected={tab === 'alerts'}
              className={tab === 'alerts' ? 'd-tab d-on' : 'd-tab'}
              onClick={() => setTab('alerts')}
            >
              Who has notifications on
              {push && push.agentsWithoutDevice > 0 && (
                <span className="d-count d-red">{push.agentsWithoutDevice} off</span>
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
                  <button type="button" className={filter === '' ? 'd-on' : undefined} onClick={() => setFilter('')}>All</button>
                  {ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={filter === role ? 'd-on' : undefined}
                      onClick={() => setFilter(role)}
                    >
                      {role === 'agent' ? 'Agents' : role === 'owner' ? 'Owners' : role}
                    </button>
                  ))}
                </div>
                <span className="d-grow" />
                <span className="d-result-count">{rows.length} {rows.length === 1 ? 'person' : 'people'}</span>
              </div>

              <div className="d-table-wrap">
                <table className="d-table v2-tm-table">
                  <thead>
                    <tr>
                      <th>Person</th><th>Work email</th><th>Role</th><th>Open leads</th><th>Last sign-in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((one) => (
                      <tr key={one.id} className={one.is_active ? undefined : 'v2-tm-off'}>
                        <td>
                          <span className="d-person">
                            <Avatar name={one.name} size={32} />
                            <span className="d-who">
                              <b>{one.name}</b>
                              <span>{one.id === user?.id ? 'You' : roleWord(one.role)}</span>
                            </span>
                          </span>
                        </td>
                        <td className="d-t-sub">{one.email ?? '—'}</td>
                        <td>
                          {one.id === user?.id || !canEdit ? (
                            <span className="d-chip d-dark">{roleWord(one.role)}</span>
                          ) : (
                            <select
                              className="d-select d-sm"
                              value={one.role}
                              disabled={busy === one.id}
                              aria-label={`Role of ${one.name}`}
                              onChange={(e) => void changeRole(one, e.target.value)}
                            >
                              {ROLES.map((role) => (
                                <option key={role} value={role}>{roleWord(role)}</option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="d-t-sub">{openOf(one.id) ?? '—'}</td>
                        <td className="d-t-sub">{one.last_login_at ? ago(one.last_login_at) : 'Never'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="d-small d-muted d-mt-12">
                An admin can do nearly everything an owner can, but cannot change or remove an
                owner. You cannot change your own role.
              </p>
            </>
          )}

          {tab === 'alerts' && (
            <>
              {push && push.agentsWithoutDevice > 0 && (
                <div className="d-banner d-amber d-mb-16">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">
                    <b>{push.agentsWithoutDevice} get no alerts.</b> A VIP lead for them can run
                    out of time without a sound.
                  </span>
                </div>
              )}
              {!push?.configured && (
                <div className="d-banner d-amber d-mb-16">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">
                    Phone alerts are not connected at all yet, so nobody is getting them.
                  </span>
                </div>
              )}
              <div className="d-mini-list">
                {(push?.missing ?? []).map((name) => (
                  <div key={name}>
                    <span className="d-grow">{name}</span>
                    <span className="d-chip d-red d-pip">No phone registered</span>
                  </div>
                ))}
                {push && push.agentsWithoutDevice === 0 && (
                  <div><span className="d-grow d-muted">Everybody has a phone registered.</span></div>
                )}
                {push && push.agentsWithoutDevice > (push.missing?.length ?? 0) && (
                  <div>
                    <span className="d-grow d-muted">
                      and {push.agentsWithoutDevice - push.missing.length} more
                    </span>
                  </div>
                )}
              </div>
              <p className="d-small d-muted d-mt-12">
                Each person turns alerts on for themselves, on their own phone. You can only see
                who has not and ask them.
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
                            ? <Icon name="check" />
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
    </SettingsShell>
  );
}

function roleWord(role: string): string {
  if (role === 'agent') return 'Agent';
  if (role === 'manager') return 'Manager';
  if (role === 'admin') return 'Admin';
  if (role === 'owner') return 'Owner';
  return role;
}

function ago(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  const days = Math.round(mins / (60 * 24));
  return days < 30 ? `${days} days ago` : new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
