import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatDateTime, humanize } from '../lib/format.js';
import { locale, setLocale, t, type Locale } from '../lib/i18n.js';
import type { Role, TeamRow, TemplateRow, UserRow } from '../lib/types.js';
import { Icon, useAppearance, useGlassReduced, type Appearance } from '../design/index.js';
import { Avatar } from '../design/ui.js';
import {
  Chip, Empty, ErrorNote, Field, Note, Panel, Select, Spinner, Toolbar, useToast,
} from '../design/ui.js';

type Tab = 'profile' | 'team' | 'teams' | 'templates' | 'health';

const ROLES: Role[] = ['owner', 'admin', 'manager', 'agent', 'automation'];

const APPEARANCES: { value: Appearance; label: string; icon: 'monitor' | 'sun' | 'moon' }[] = [
  { value: 'system', label: 'Follow the system', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

/**
 * Settings: this account, then the administrative screens that used to be
 * separate pages — the team, the WhatsApp template library and the operational
 * health check. Which tabs appear is decided by role, and the server enforces
 * the same boundaries on every endpoint behind them.
 */
export function Settings() {
  const { user, can } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';
  const tabs: {
    value: Tab;
    label: string;
    icon: 'user' | 'users' | 'users-round' | 'layout-template' | 'activity';
  }[] = [
    { value: 'profile', label: 'You', icon: 'user' },
    ...(can('users:manage') ? ([{ value: 'team' as const, label: t('team'), icon: 'users' as const }]) : []),
    ...(isManager ? ([{ value: 'teams' as const, label: 'Desks', icon: 'users-round' as const }]) : []),
    ...(isManager
      ? ([
          { value: 'templates' as const, label: t('templates'), icon: 'layout-template' as const },
          { value: 'health' as const, label: 'Health', icon: 'activity' as const },
        ])
      : []),
  ];

  return (
    <>
      <Toolbar>
        {tabs.map((item) => (
          <Chip key={item.value} on={tab === item.value} icon={item.icon} onClick={() => setTab(item.value)}>
            {item.label}
          </Chip>
        ))}
      </Toolbar>

      {tab === 'profile' && <ProfileTab />}
      {tab === 'team' && <TeamTab />}
      {tab === 'teams' && <DesksTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'health' && <HealthTab />}
    </>
  );
}

/* ── You ──────────────────────────────────────────────────────────────── */

function ProfileTab() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const { appearance, setAppearance } = useAppearance();
  const [glassReduced, setGlassReduced] = useGlassReduced();
  const [saving, setSaving] = useState(false);

  async function changeLanguage(next: Locale) {
    setLocale(next);
    if (!user) return;
    setSaving(true);
    try {
      // Stored on the account as well, so a new device starts in the right
      // language; the local choice still wins on this one.
      await api.patch(`/api/users/${user.id}`, { locale: next });
      await refresh();
    } catch {
      toast('Saved on this device, but could not be saved to your account');
    } finally {
      setSaving(false);
    }
  }

  if (!user) return null;

  return (
    <div className="dash">
      <Panel span={6} index={0} icon="user" title="Your account">
        <div className="bank">
          <Avatar name={user.name} size={38} />
          <div style={{ minWidth: 0 }}>
            <b style={{ display: 'block' }}>{user.name}</b>
            <small className="muted">{user.email}</small>
          </div>
          <b>
            <span className="pill info">{humanize(user.role)}</span>
          </b>
        </div>

        <Field label="Interface language">
          <Select
            value={locale()}
            disabled={saving}
            onChange={(event) => void changeLanguage(event.target.value as Locale)}
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </Select>
        </Field>

        <Note>
          There is no self-service password reset by design. Ask an owner or admin to reset yours
          from the {t('team')} tab, and you will set a new one at your next sign-in.
        </Note>
      </Panel>

      <Panel span={6} index={1} icon="moon" title="Appearance">
        <p className="muted" style={{ marginTop: 0 }}>
          Saved on this device, so the phone you use in the car can differ from your desk.
        </p>

        <div className="toolbar">
          {APPEARANCES.map((option) => (
            <Chip
              key={option.value}
              icon={option.icon}
              on={appearance === option.value}
              onClick={() => setAppearance(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>

        <div className="kv">
          <span>
            Reduce glass effect
            <small className="muted" style={{ display: 'block' }}>
              Turns off the background blur. Worth it on an older phone.
            </small>
          </span>
          <button
            type="button"
            className={glassReduced ? 'switch' : 'switch off'}
            role="switch"
            aria-checked={glassReduced}
            aria-label="Reduce glass effect"
            onClick={() => setGlassReduced(!glassReduced)}
          />
        </div>

        <Note>
          Animations already follow your device&rsquo;s reduce-motion setting; nothing to switch here.
        </Note>
      </Panel>
    </div>
  );
}

/* ── Team ─────────────────────────────────────────────────────────────── */

function TeamTab() {
  const toast = useToast();
  const list = useAsync<{ items: UserRow[] }>(() => api.get('/api/users'), []);
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const [creating, setCreating] = useState(false);

  async function resetPassword(row: UserRow) {
    try {
      const result = await api.post<{ temporaryPassword: string }>(`/api/users/${row.id}/reset-password`);
      // Shown once, here, and never emailed: there is no reset flow by design.
      setCredential({ email: row.email, password: result.temporaryPassword });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not reset the password');
    }
  }

  async function setActive(row: UserRow, isActive: boolean) {
    try {
      await api.patch(`/api/users/${row.id}`, { isActive });
      list.reload();
      toast(isActive ? `${row.name} reactivated` : `${row.name} deactivated — their sessions have ended`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update the user');
    }
  }

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;
  if (!list.data) return <Spinner />;

  return (
    <div className="dash">
      <Panel
        span={12}
        index={0}
        icon="users"
        title={t('team')}
        action={
          <button type="button" className="link" onClick={() => setCreating(true)}>
            Add a user
          </button>
        }
      >
        {credential && (
          <div className="inv-calc" style={{ marginBottom: 14 }}>
            <b>Temporary password for {credential.email}</b>
            <p className="muted" style={{ fontSize: 13 }}>
              Shown once. Hand it over in person or by phone — never by email. They must change it at
              their next sign-in.
            </p>
            <code style={{ fontSize: 18, letterSpacing: '.04em' }}>{credential.password}</code>
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn" onClick={() => setCredential(null)}>
                Done
              </button>
            </div>
          </div>
        )}

        {creating && <NewUser onDone={() => { setCreating(false); list.reload(); }} onCredential={setCredential} />}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Availability</th>
                <th>Weight</th>
                <th>Last seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((row) => (
                <tr key={row.id} style={{ opacity: row.is_active === 1 ? 1 : 0.55 }}>
                  <td>
                    <div className="rank">
                      <Avatar name={row.name} size={26} />
                      <div>
                        <b>{row.name}</b>
                        <div className="muted" style={{ fontSize: 12 }}>{row.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="pill info">{humanize(row.role)}</span>
                  </td>
                  <td>
                    {row.is_active === 1 ? (
                      <span className={row.availability === 'available' ? 'pill ok' : 'pill wait'}>
                        {humanize(row.availability)}
                      </span>
                    ) : (
                      <span className="pill due">Deactivated</span>
                    )}
                  </td>
                  <td>{row.routing_weight}</td>
                  <td className="muted">{row.last_login_at ? formatDateTime(row.last_login_at) : 'Never'}</td>
                  <td>
                    <button type="button" className="rowbtn" onClick={() => void resetPassword(row)}>
                      Reset password
                    </button>
                    {' · '}
                    <button
                      type="button"
                      className="rowbtn"
                      onClick={() => void setActive(row, row.is_active !== 1)}
                    >
                      {row.is_active === 1 ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Note>
          Deactivating someone ends their sessions immediately. Their leads stay in the system for
          reassignment, and every change here is written to the audit log.
        </Note>
      </Panel>
    </div>
  );
}

function NewUser({
  onDone, onCredential,
}: {
  onDone: () => void;
  onCredential: (credential: { email: string; password: string }) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const result = await api.post<{ temporaryPassword: string }>('/api/users', { name, email, role });
      onCredential({ email, password: result.temporaryPassword });
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inv-calc" style={{ marginBottom: 14 }}>
      <b>New user</b>
      <div className="two">
        <Field label="Name">
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Email">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Role">
        <Select value={role} onChange={(event) => setRole(event.target.value as Role)}>
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {humanize(value)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="two">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !name || !email}
          onClick={() => void create()}
        >
          Create
        </button>
      </div>
    </div>
  );
}

/* ── Desks (teams) ────────────────────────────────────────────────────── */

/**
 * Teams, which the specification calls desks in practice: "Arabic desk",
 * "Abu Dhabi team". A team is who a round-robin assignment goes round.
 */
function DesksTab() {
  const { user } = useAuth();
  const toast = useToast();
  const teams = useAsync<{ items: TeamRow[] }>(() => api.get('/api/teams'), []);
  const people = useAsync<{ items: UserRow[] }>(() => api.get('/api/users'), []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);

  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const agents = (people.data?.items ?? []).filter((row) => row.role === 'agent' && row.is_active === 1);

  async function create() {
    try {
      await api.post('/api/teams', { name, memberIds: members });
      toast(`${name} created`);
      setCreating(false);
      setName('');
      setMembers([]);
      teams.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the desk');
    }
  }

  if (teams.error) return <ErrorNote>{teams.error}</ErrorNote>;
  if (!teams.data) return <Spinner />;

  return (
    <div className="dash">
      <Panel
        span={12}
        index={0}
        icon="users-round"
        title="Desks"
        action={
          canManage ? (
            <button type="button" className="link" onClick={() => setCreating(true)}>
              Add a desk
            </button>
          ) : undefined
        }
      >
        {creating && (
          <div className="inv-calc" style={{ marginBottom: 14 }}>
            <Field label="Name" hint="e.g. Arabic desk, Abu Dhabi team">
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <div className="sec-t">Members</div>
            <div className="tags">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={members.includes(agent.id) ? 'chip on' : 'chip'}
                  onClick={() =>
                    setMembers(
                      members.includes(agent.id)
                        ? members.filter((id) => id !== agent.id)
                        : [...members, agent.id],
                    )
                  }
                >
                  {agent.name}
                </button>
              ))}
            </div>
            <div className="two" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={!name} onClick={() => void create()}>
                Create
              </button>
            </div>
          </div>
        )}

        {teams.data.items.length === 0 && !creating && (
          <Empty
            icon="users-round"
            title="No desks yet"
            hint="A desk groups agents so a batch of leads can go round one team rather than everyone."
          />
        )}

        {teams.data.items.map((team) => (
          <div className="bank" key={team.id} style={{ alignItems: 'flex-start' }}>
            <span className="ic">
              <Icon name="users-round" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: 'block' }}>{team.name}</b>
              <small className="muted">
                {team.manager_name ? `Managed by ${team.manager_name} · ` : ''}
                {team.members.length} {team.members.length === 1 ? 'agent' : 'agents'}
              </small>
              <div className="tags" style={{ marginTop: 8 }}>
                {team.members.map((member) => (
                  <span className="tag" key={member.userId}>
                    {member.name} · {member.openLeads} open
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}

        <Note>
          Open-lead counts are shown here and again before any assignment runs, so nobody is handed a
          batch they cannot work.
        </Note>
      </Panel>
    </div>
  );
}

/* ── Templates ────────────────────────────────────────────────────────── */

const TEMPLATE_STATUS_CLASS: Record<string, string> = {
  APPROVED: 'pill ok',
  PENDING: 'pill wait',
  IN_APPEAL: 'pill wait',
  REJECTED: 'pill due',
  PAUSED: 'pill due',
  DISABLED: 'pill due',
};

function TemplatesTab() {
  const toast = useToast();
  const list = useAsync<{ items: TemplateRow[] }>(() => api.get('/api/templates'), []);
  const [busy, setBusy] = useState(false);

  async function sync() {
    setBusy(true);
    try {
      await api.post('/api/templates/sync');
      toast('Template status pulled from Meta');
      list.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not reach Meta');
    } finally {
      setBusy(false);
    }
  }

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;
  if (!list.data) return <Spinner />;

  const items = list.data.items;
  const notApproved = items.filter((template) => template.status !== 'APPROVED');

  return (
    <div className="dash">
      <Panel
        span={12}
        index={0}
        icon="layout-template"
        title={t('templates')}
        action={
          <button type="button" className="link" disabled={busy} onClick={() => void sync()}>
            {busy ? 'Syncing…' : 'Sync from Meta'}
          </button>
        }
      >
        {items.length === 0 && (
          <Empty
            icon="layout-template"
            title="No templates yet"
            hint="Seed the day-one library, then submit them in Meta Business Manager."
          />
        )}

        {notApproved.length > 0 && (
          <p className="err" style={{ display: 'block', marginBottom: 12 }}>
            {notApproved.length} template{notApproved.length === 1 ? '' : 's'} not approved. Outside the
            24-hour window only approved templates can be sent, so follow-ups will fall back to email.
          </p>
        )}

        {items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Language</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Last synced</th>
                </tr>
              </thead>
              <tbody>
                {items.map((template) => (
                  <tr key={template.id}>
                    <td>
                      <b>{template.name}</b>
                      {template.rejected_reason && (
                        <div className="muted" style={{ fontSize: 12 }}>{template.rejected_reason}</div>
                      )}
                    </td>
                    <td>{template.language}</td>
                    <td>{humanize(template.category)}</td>
                    <td>
                      <span className={TEMPLATE_STATUS_CLASS[template.status] ?? 'pill'}>
                        {humanize(template.status)}
                      </span>
                    </td>
                    <td className="muted">
                      {template.last_synced_at ? formatDateTime(template.last_synced_at) : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Note>
          Meta approves templates, not us. A paused or rejected template shows here as soon as a sync
          runs, and the automations stop using it.
        </Note>
      </Panel>
    </div>
  );
}

/* ── Health ───────────────────────────────────────────────────────────── */

type Health = {
  jobs: { status: string; n: number }[];
  failingJobTypes: { type: string; n: number; last_error: string | null }[];
  inboundEvents24h: { source: string; status: string; n: number }[];
  templatesNotApproved: { name: string; language: string; status: string }[];
  unassignedLeads: number;
  unverifiedActiveProjects: number;
  crons: { name: string; lastRunAt: string | null }[];
  realtimeClients: number;
};

function HealthTab() {
  const health = useAsync<Health>(() => api.get('/api/reports/health'), []);

  if (health.error) return <ErrorNote>{health.error}</ErrorNote>;
  if (!health.data) return <Spinner />;

  const data = health.data;
  const failedJobs = data.jobs.find((row) => row.status === 'failed')?.n ?? 0;

  const attention = [
    { label: 'Leads waiting for an owner', value: data.unassignedLeads, bad: data.unassignedLeads > 0 },
    { label: 'Failed background jobs', value: failedJobs, bad: Number(failedJobs) > 0 },
    {
      label: 'Templates not approved',
      value: data.templatesNotApproved.length,
      bad: data.templatesNotApproved.length > 0,
    },
    {
      label: 'Active projects not verified',
      value: data.unverifiedActiveProjects,
      bad: data.unverifiedActiveProjects > 0,
    },
  ];

  return (
    <div className="dash">
      <Panel span={6} index={0} icon="activity" title="Needs attention">
        {attention.map((row) => (
          <div className="kv" key={row.label}>
            <span>{row.label}</span>
            <b className={row.bad ? 'pill due' : 'pill ok'}>{row.value}</b>
          </div>
        ))}
        <div className="kv">
          <span>Live connections</span>
          <b>{data.realtimeClients}</b>
        </div>
      </Panel>

      <Panel span={6} index={1} icon="timer" title="Scheduled work">
        {data.crons.length === 0 && <Empty icon="timer" title="No crons registered" />}
        {data.crons.map((cron) => (
          <div className="kv" key={cron.name}>
            <span>{humanize(cron.name)}</span>
            <b className="muted">{cron.lastRunAt ? formatDateTime(cron.lastRunAt) : 'Not yet'}</b>
          </div>
        ))}
      </Panel>

      {data.failingJobTypes.length > 0 && (
        <Panel span={12} index={2} icon="alert-triangle" title="Failing jobs">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Count</th>
                  <th>Last error</th>
                </tr>
              </thead>
              <tbody>
                {data.failingJobTypes.map((row) => (
                  <tr key={row.type}>
                    <td>{row.type}</td>
                    <td>{row.n}</td>
                    <td className="muted">{row.last_error ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel span={12} index={3} icon="radio" title="Inbound events, last 24 hours">
        {data.inboundEvents24h.length === 0 ? (
          <Empty icon="radio" title="Nothing arrived in the last 24 hours" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Status</th>
                  <th className="money">Count</th>
                </tr>
              </thead>
              <tbody>
                {data.inboundEvents24h.map((row) => (
                  <tr key={`${row.source}-${row.status}`}>
                    <td>{humanize(row.source)}</td>
                    <td>
                      <span className={row.status === 'failed' ? 'pill due' : 'pill ok'}>
                        {humanize(row.status)}
                      </span>
                    </td>
                    <td className="money">{row.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
