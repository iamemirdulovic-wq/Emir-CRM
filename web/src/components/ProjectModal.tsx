import { useEffect, useState } from 'react';
import { api, qs } from '../lib/api.js';
import type { DeveloperRow, LibraryCard, ProjectDraft, SaleStatus, Visibility } from '../lib/types.js';
import { Field, Input, Modal, Note, Select, TextArea } from '../design/ui.js';

const EMIRATES = [
  ['dubai', 'Dubai'], ['abu_dhabi', 'Abu Dhabi'], ['sharjah', 'Sharjah'],
  ['ras_al_khaimah', 'Ras Al Khaimah'], ['ajman', 'Ajman'], ['fujairah', 'Fujairah'],
  ['umm_al_quwain', 'Umm Al Quwain'], ['other', 'Other'],
] as const;

const TYPES = [
  ['apartment', 'Apartments'], ['townhouse', 'Townhouses'], ['villa', 'Villas'],
  ['penthouse', 'Penthouses'], ['plot', 'Plots'], ['office', 'Offices'], ['mixed', 'Mixed'],
] as const;

const STATUSES: [SaleStatus, string][] = [
  ['selling_now', 'Selling now'], ['coming_soon', 'Coming soon'], ['sold_out', 'Sold out'],
];

function blank(): ProjectDraft {
  return {
    name: '', developerId: null, developer: null, emirate: 'dubai', community: null,
    propertyType: 'apartment', saleStatus: 'selling_now', startingPriceAed: null,
    handoverDate: null, paymentPlan: null, reraNo: null, ownership: 'freehold',
    serviceChargeSqft: null, goldenVisaThresholdAed: null, constructionPct: null,
    description: null, brochureUrl: null, imageUrl: null, visibility: 'private',
    goldenVisaEligible: false,
  };
}

/** Empty string from an input means "not set", not zero. */
function num(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[, ]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Add or edit a project.
 *
 * This is the form that did not exist, which is why the library was empty and
 * the WhatsApp auto-replies had nothing to quote. Prices and plans live on
 * their own tabs — what is captured here is the project itself.
 */
export function ProjectModal({
  open, onClose, onSaved, project, developers,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  /** Null when adding. */
  project: Record<string, unknown> | null;
  developers: DeveloperRow[];
}) {
  const [draft, setDraft] = useState<ProjectDraft>(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<LibraryCard[] | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSimilar(null);
    if (!project) {
      setDraft(blank());
      return;
    }
    const p = project as Record<string, string | number | null>;
    setDraft({
      name: String(p.name ?? ''),
      developerId: (p.developer_id as string) ?? null,
      developer: (p.developer as string) ?? null,
      emirate: String(p.emirate ?? 'dubai'),
      community: (p.community as string) ?? null,
      propertyType: (p.property_type as string) ?? null,
      saleStatus: (p.sale_status as SaleStatus) ?? 'selling_now',
      startingPriceAed: p.starting_price_aed === null ? null : Number(p.starting_price_aed),
      handoverDate: (p.handover_date as string) ?? null,
      paymentPlan: (p.payment_plan as string) ?? null,
      reraNo: (p.rera_no as string) ?? null,
      ownership: (p.ownership as string) ?? null,
      serviceChargeSqft: p.service_charge_sqft === null ? null : Number(p.service_charge_sqft),
      goldenVisaThresholdAed: p.golden_visa_threshold_aed === null ? null : Number(p.golden_visa_threshold_aed),
      constructionPct: p.construction_pct === null ? null : Number(p.construction_pct),
      description: (p.description as string) ?? null,
      brochureUrl: (p.brochure_url as string) ?? null,
      imageUrl: (p.image_url as string) ?? null,
      visibility: (p.visibility as Visibility) ?? 'private',
      goldenVisaEligible: Number(p.golden_visa_eligible ?? 0) === 1,
    });
  }, [open, project]);

  const set = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /** The wizard's duplicate check: a warning, never a block — "Phase 2" is real. */
  async function checkDuplicate() {
    if (draft.name.trim().length < 3) return;
    setChecking(true);
    try {
      const result = await api.get<{ items: LibraryCard[] }>(`/api/library/similar${qs({ name: draft.name })}`);
      setSimilar(result.items.filter((row) => row.id !== (project?.id as string)));
    } catch {
      setSimilar(null);
    } finally {
      setChecking(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      setError('Give the project a name.');
      return;
    }
    if (!draft.developerId && !draft.developer?.trim()) {
      setError('Choose a developer, or type the developer name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (project) {
        await api.patch(`/api/library/${project.id as string}`, draft);
        onSaved(project.id as string);
      } else {
        const { id } = await api.post<{ id: string }>('/api/library', draft);
        onSaved(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the project');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? 'Edit project' : 'Add project'}
      icon="building-2"
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" form="project-form" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : project ? 'Save changes' : 'Add project'}
          </button>
        </>
      }
    >
      <form id="project-form" onSubmit={(event) => void save(event)}>
        {error && <div className="err" style={{ display: 'block', marginBottom: 12 }} role="alert">{error}</div>}

        <div className="field-row">
          <Field label="Project name">
            <Input
              value={draft.name}
              onChange={(event) => set('name', event.target.value)}
              onBlur={() => void checkDuplicate()}
              placeholder="Emaar Beachfront"
              maxLength={160}
              required
            />
          </Field>
          <Field label="Developer">
            <Select
              value={draft.developerId ?? ''}
              onChange={(event) => set('developerId', event.target.value || null)}
            >
              <option value="">— choose —</option>
              {developers.map((dev) => (
                <option key={dev.id} value={dev.id}>{dev.short_name}</option>
              ))}
            </Select>
          </Field>
        </div>

        {!draft.developerId && (
          <Field label="Or type the developer name" hint="Add them properly on the Developers tab later.">
            <Input
              value={draft.developer ?? ''}
              onChange={(event) => set('developer', event.target.value || null)}
              placeholder="Emaar"
              maxLength={160}
            />
          </Field>
        )}

        {checking && <p className="muted" style={{ fontSize: 12.5 }}>Checking for duplicates…</p>}
        {similar !== null && similar.length > 0 && (
          <Note>
            Already in the library with a similar name: {similar.map((row) => row.name).join(', ')}. That is
            fine if this is a different phase — just checking.
          </Note>
        )}

        <div className="field-row">
          <Field label="Emirate">
            <Select value={draft.emirate} onChange={(event) => set('emirate', event.target.value)}>
              {EMIRATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Community">
            <Input
              value={draft.community ?? ''}
              onChange={(event) => set('community', event.target.value || null)}
              placeholder="Dubai Harbour"
              maxLength={160}
            />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Property type">
            <Select value={draft.propertyType ?? ''} onChange={(event) => set('propertyType', event.target.value || null)}>
              <option value="">—</option>
              {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={draft.saleStatus} onChange={(event) => set('saleStatus', event.target.value as SaleStatus)}>
              {STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
        </div>

        <div className="sec-t">Prices and handover</div>
        <Note>
          These are what the CRM quotes on WhatsApp. Leave anything you are not sure about blank —
          a blank field is left out of the reply, a wrong one is sent to a buyer.
        </Note>

        <div className="field-row">
          <Field label="Price from (AED)">
            <Input
              inputMode="numeric"
              value={draft.startingPriceAed ?? ''}
              onChange={(event) => set('startingPriceAed', num(event.target.value))}
              placeholder="1750000"
            />
          </Field>
          <Field label="Handover" hint="As the developer writes it, e.g. Q4 2027.">
            <Input
              value={draft.handoverDate ?? ''}
              onChange={(event) => set('handoverDate', event.target.value || null)}
              placeholder="Q4 2027"
              maxLength={48}
            />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Headline payment plan" hint="The detailed milestones go on the Payment plans tab.">
            <Input
              value={draft.paymentPlan ?? ''}
              onChange={(event) => set('paymentPlan', event.target.value || null)}
              placeholder="60 / 40"
              maxLength={255}
            />
          </Field>
          <Field label="DLD / RERA number">
            <Input
              value={draft.reraNo ?? ''}
              onChange={(event) => set('reraNo', event.target.value || null)}
              maxLength={64}
            />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Ownership">
            <Select value={draft.ownership ?? ''} onChange={(event) => set('ownership', event.target.value || null)}>
              <option value="">—</option>
              <option value="freehold">Freehold</option>
              <option value="leasehold">Leasehold</option>
            </Select>
          </Field>
          <Field label="Service charge (AED per sq ft)">
            <Input
              inputMode="decimal"
              value={draft.serviceChargeSqft ?? ''}
              onChange={(event) => set('serviceChargeSqft', num(event.target.value))}
              placeholder="18"
            />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Construction complete (%)">
            <Input
              inputMode="numeric"
              value={draft.constructionPct ?? ''}
              onChange={(event) => set('constructionPct', num(event.target.value))}
              placeholder="35"
            />
          </Field>
          <Field label="Golden Visa threshold (AED)">
            <Input
              inputMode="numeric"
              value={draft.goldenVisaThresholdAed ?? ''}
              onChange={(event) => set('goldenVisaThresholdAed', num(event.target.value))}
              placeholder="2000000"
            />
          </Field>
        </div>

        <div className="sec-t">Description and files</div>

        <Field label="Description" hint="Shown to a lead. Facts only — no invented figures.">
          <TextArea
            value={draft.description ?? ''}
            onChange={(event) => set('description', event.target.value || null)}
            rows={4}
            maxLength={10000}
          />
        </Field>

        <div className="field-row">
          <Field label="Cover image URL">
            <Input value={draft.imageUrl ?? ''} onChange={(event) => set('imageUrl', event.target.value || null)} maxLength={1024} />
          </Field>
          <Field label="Brochure URL" hint="What the BROCHURE reply sends.">
            <Input value={draft.brochureUrl ?? ''} onChange={(event) => set('brochureUrl', event.target.value || null)} maxLength={1024} />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Who can see it" hint="Public is built but stays off until the website exists.">
            <Select value={draft.visibility} onChange={(event) => set('visibility', event.target.value as Visibility)}>
              <option value="private">Private — team only</option>
              <option value="team">Specific team only</option>
              <option value="public" disabled>Public on the website (coming later)</option>
            </Select>
          </Field>
          <Field label="Golden Visa">
            <label className="check" style={{ paddingTop: 8 }}>
              <input
                type="checkbox"
                checked={draft.goldenVisaEligible}
                onChange={(event) => set('goldenVisaEligible', event.target.checked)}
              />
              <span>Eligible</span>
            </label>
          </Field>
        </div>

        {!project && (
          <Note>
            A new project starts unverified, so the WhatsApp auto-replies will not quote it yet. Check
            the figures, then press Verify on the project to switch it on.
          </Note>
        )}
      </form>
    </Modal>
  );
}
