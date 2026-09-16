import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatAed, humanize } from '../lib/format.js';
import { t } from '../lib/i18n.js';
import type { ProjectRow } from '../lib/types.js';
import { EmptyState, ErrorNote, Icon, Modal, Spinner, Toast } from '../components/ui.js';

/**
 * The off-plan library.
 *
 * A project must be verified before anything it holds can be quoted to a lead,
 * so verification state is the most prominent thing on the card.
 */
export function Projects() {
  const { can } = useAuth();
  const manage = can('projects:manage');
  const list = useAsync<{ items: ProjectRow[] }>(() => api.get(`/api/projects${manage ? '?includeUnverified=1' : ''}`), [manage]);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const flash = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3000);
  };

  const setVerified = async (project: ProjectRow, verified: boolean) => {
    try {
      await api.post(`/api/projects/${project.id}/${verified ? 'verify' : 'unverify'}`);
      list.reload();
      flash(verified ? `${project.name} verified` : `${project.name} is no longer verified`);
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not update', 'error');
    }
  };

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-slate-900">{t('projects')}</h1>
        {manage ? (
          <button type="button" className="btn-primary ms-auto" onClick={() => setCreating(true)}>
            <Icon name="add" className="!text-[18px]" />
            Add project
          </button>
        ) : null}
      </header>

      <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        <Icon name="verified" className="!text-[16px] align-text-bottom" /> Only a <strong>verified</strong> project's price,
        payment plan and handover date are ever sent to a lead. Editing any of those figures clears verification.
      </div>

      {list.error ? <ErrorNote message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <Spinner /> : null}
      {list.data?.items.length === 0 ? <EmptyState icon="apartment" title="No projects yet" /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(list.data?.items ?? []).map((project) => (
          <article key={project.id} className="card space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-slate-900">{project.name}</h2>
                <p className="truncate text-xs text-slate-500">
                  {project.developer} · {humanize(project.emirate)}
                  {project.area ? ` · ${project.area}` : ''}
                </p>
              </div>
              <span className={`chip ${project.verified_at ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                <Icon name={project.verified_at ? 'verified' : 'pending'} className="!text-[14px]" />
                {project.verified_at ? 'Verified' : 'Unverified'}
              </span>
            </div>

            <dl className="space-y-1 text-sm">
              <Row label="From" value={project.starting_price_aed ? `AED ${formatAed(project.starting_price_aed)}` : null} />
              <Row label="Plan" value={project.payment_plan} />
              <Row label="Handover" value={project.handover_date} />
              {project.golden_visa_eligible === 1 ? <Row label="Golden Visa" value="Eligible" /> : null}
            </dl>

            {manage ? (
              <div className="flex gap-2 pt-1">
                {project.verified_at ? (
                  <button type="button" className="btn-ghost text-amber-800" onClick={() => void setVerified(project, false)}>
                    Unverify
                  </button>
                ) : (
                  <button type="button" className="btn-tonal" onClick={() => void setVerified(project, true)}>
                    <Icon name="verified" className="!text-[16px]" />
                    Verify
                  </button>
                )}
                {project.brochure_url ? (
                  <a className="btn-ghost" href={`/b/${project.slug}`} target="_blank" rel="noreferrer">
                    <Icon name="picture_as_pdf" className="!text-[16px]" />
                    Brochure
                  </a>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <CreateProject
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          list.reload();
          flash('Project added — verify it before it can be quoted');
        }}
        onError={(message) => flash(message, 'error')}
      />

      {toast ? <Toast message={toast.message} tone={toast.tone} /> : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className="truncate text-end text-slate-700">{value ?? '—'}</dd>
    </div>
  );
}

function CreateProject({
  open,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    developer: '',
    emirate: 'dubai',
    area: '',
    startingPriceAed: '',
    paymentPlan: '',
    handoverDate: '',
    brochureUrl: '',
    locationLat: '',
    locationLng: '',
    goldenVisaEligible: false,
  });
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/projects', {
        name: form.name,
        developer: form.developer,
        emirate: form.emirate,
        area: form.area || null,
        startingPriceAed: form.startingPriceAed ? Number(form.startingPriceAed) : null,
        paymentPlan: form.paymentPlan || null,
        handoverDate: form.handoverDate || null,
        brochureUrl: form.brochureUrl || null,
        locationLat: form.locationLat ? Number(form.locationLat) : null,
        locationLng: form.locationLng ? Number(form.locationLng) : null,
        goldenVisaEligible: form.goldenVisaEligible,
      });
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create the project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Add a project"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" className="btn-primary" disabled={busy || !form.name || !form.developer} onClick={() => void submit()}>
            {t('save')}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={form.name} onChange={(v) => set('name', v)} required />
        <Input label="Developer" value={form.developer} onChange={(v) => set('developer', v)} required />
        <div>
          <label className="label">Emirate</label>
          <select className="field" value={form.emirate} onChange={(e) => set('emirate', e.target.value)}>
            {['dubai', 'abu_dhabi', 'sharjah', 'ras_al_khaimah', 'ajman', 'fujairah', 'umm_al_quwain', 'other'].map((e) => (
              <option key={e} value={e}>
                {humanize(e)}
              </option>
            ))}
          </select>
        </div>
        <Input label="Area" value={form.area} onChange={(v) => set('area', v)} />
        <Input label="Starting price (AED)" value={form.startingPriceAed} onChange={(v) => set('startingPriceAed', v)} type="number" />
        <Input label="Payment plan" value={form.paymentPlan} onChange={(v) => set('paymentPlan', v)} />
        <Input label="Handover" value={form.handoverDate} onChange={(v) => set('handoverDate', v)} placeholder="Q4 2027" />
        <Input label="Brochure URL" value={form.brochureUrl} onChange={(v) => set('brochureUrl', v)} />
        <Input label="Latitude" value={form.locationLat} onChange={(v) => set('locationLat', v)} type="number" />
        <Input label="Longitude" value={form.locationLng} onChange={(v) => set('locationLng', v)} type="number" />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-brand-600"
          checked={form.goldenVisaEligible}
          onChange={(e) => set('goldenVisaEligible', e.target.checked)}
        />
        Golden Visa eligible
      </label>
      <p className="mt-3 text-xs text-amber-800">
        The project is created unverified. Nothing it holds will be quoted to a lead until someone verifies it.
      </p>
    </Modal>
  );
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </label>
      <input className="field" type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
