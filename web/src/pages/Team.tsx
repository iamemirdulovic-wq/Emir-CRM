import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatDateTime } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import type { Role, UserRow } from '../lib/types.js';
import { Avatar, EmptyState, ErrorNote, Icon, Modal, Spinner, Toast } from '../components/ui.js';

const ROLES: Role[] = ['owner', 'admin', 'manager', 'agent', 'automation'];

/** User management. There is no public sign-up: accounts are created here. */
export function Team() {
  const { user, can } = useAuth();
  const list = useAsync<{ items: UserRow[] }>(() => api.get('/api/users'), []);
  const [creating, setCreating] = useState(false);
  const [credential, setCredential] = useState<{ email: string; password: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const manage = can('users:manage');
  const flash = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4000);
  };

  const resetPassword = async (row: UserRow) => {
    try {
      const result = await api.post<{ temporaryPassword: string }>(`/api/users/${row.id}/reset-password`);
      setCredential({ email: row.email, password: result.temporaryPassword });
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not reset the password', 'error');
    }
  };

  const setActive = async (row: UserRow, isActive: boolean) => {
    try {
      await api.patch(`/api/users/${row.id}`, { isActive });
      list.reload();
      flash(isActive ? `${row.name} reactivated` : `${row.name} deactivated — their sessions have ended`);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not update', 'error');
    }
  };

  const setAvailability = async (row: UserRow, availability: UserRow['availability']) => {
    try {
      await api.patch(`/api/users/${row.id}`, { availability });
      list.reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not update', 'error');
    }
  };

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold text-slate-900">{t('team')}</h1>
        {manage ? (
          <button type="button" className="btn-primary ms-auto" onClick={() => setCreating(true)}>
            <Icon name="person_add" className="!text-[18px]" />
            Add user
          </button>
        ) : null}
      </header>

      {list.error ? <ErrorNote message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Spinner /> : null}
      {list.data?.items.length === 0 ? <EmptyState icon="group" title="No users yet" /> : null}

      <div className="card divide-y divide-slate-100">
        {(list.data?.items ?? []).map((row) => (
          <div key={row.id} className="flex flex-wrap items-center gap-3 p-3">
            <Avatar name={row.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {row.name}
                {row.id === user?.id ? <span className="ms-2 text-xs text-slate-400">(you)</span> : null}
              </p>
              <p className="truncate text-xs text-slate-500">{row.email}</p>
            </div>

            <span className="chip bg-slate-100 capitalize text-slate-600">{row.role}</span>

            {row.role === 'agent' ? (
              <select
                className="chip border-0 bg-slate-100 text-slate-600"
                value={row.availability}
                onChange={(e) => void setAvailability(row, e.target.value as UserRow['availability'])}
                disabled={!manage && row.id !== user?.id}
                aria-label="Availability"
              >
                <option value="available">Available</option>
                <option value="busy">Busy</option>
                <option value="off">Off</option>
              </select>
            ) : null}

            {row.is_active === 1 ? null : <span className="chip bg-rose-100 text-rose-700">Deactivated</span>}

            <span className="hidden text-xs text-slate-400 sm:block">{formatDateTime(row.last_login_at)}</span>

            {manage && row.id !== user?.id ? (
              <div className="flex gap-1">
                <button type="button" className="btn-ghost !px-2" onClick={() => void resetPassword(row)} title="Reset password">
                  <Icon name="lock_reset" className="!text-[18px]" />
                </button>
                <button
                  type="button"
                  className="btn-ghost !px-2"
                  onClick={() => void setActive(row, row.is_active !== 1)}
                  title={row.is_active === 1 ? 'Deactivate' : 'Reactivate'}
                >
                  <Icon name={row.is_active === 1 ? 'person_off' : 'person_check'} className="!text-[18px]" />
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <CreateUser
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(email, password) => {
          setCreating(false);
          list.reload();
          setCredential({ email, password });
        }}
        onError={(message) => flash(message, 'error')}
      />

      {/* Shown once. The password is never stored in plain text or emailed. */}
      <Modal
        open={Boolean(credential)}
        title="Temporary password"
        onClose={() => setCredential(null)}
        footer={
          <button type="button" className="btn-primary" onClick={() => setCredential(null)}>
            Done
          </button>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          Hand this to <strong>{credential?.email}</strong>. It is shown once and must be changed at their first sign-in.
        </p>
        <code className="block select-all rounded-lg bg-slate-100 p-3 text-center font-mono text-lg tracking-wide">
          {credential?.password}
        </code>
      </Modal>

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}

function CreateUser({
  open,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (email: string, password: string) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({ name: '', email: '', role: 'agent' as Role, languages: 'en', projects: '', weight: '10' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ email: string; temporaryPassword: string }>('/api/users', {
        name: form.name,
        email: form.email,
        role: form.role,
        languages: form.languages.split(',').map((s) => s.trim()).filter(Boolean),
        projectsCovered: form.projects.split(',').map((s) => s.trim()).filter(Boolean),
        routingWeight: Number(form.weight) || 10,
      });
      onCreated(result.email, result.temporaryPassword);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create the user');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Add a user"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="btn-primary" disabled={busy || !form.name || !form.email} onClick={() => void submit()}>
            Create
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Name</label>
          <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">{t('email')}</label>
          <input className="field" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="field" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        {form.role === 'agent' ? (
          <>
            <div>
              <label className="label">Languages (comma separated)</label>
              <input className="field" value={form.languages} onChange={(e) => setForm({ ...form, languages: e.target.value })} placeholder="en, ar" />
            </div>
            <div>
              <label className="label">Projects covered (comma separated)</label>
              <input className="field" value={form.projects} onChange={(e) => setForm({ ...form, projects: e.target.value })} placeholder="Emaar Beachfront" />
            </div>
            <div>
              <label className="label">Round-robin weight</label>
              <input className="field" type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
              <p className="mt-1 text-xs text-slate-400">Higher takes a larger share of new leads. 0 pauses this agent.</p>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
