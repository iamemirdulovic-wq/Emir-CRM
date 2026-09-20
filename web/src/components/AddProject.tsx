import { useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { formatAed, humanize } from '../lib/format.js';
import type { DeveloperRow, LibraryCard, ProjectDraft, SaleStatus, Visibility } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { Field, Input, Note, Select, TextArea, useToast } from '../design/ui.js';
import { FileDrop, fileSize } from './FileDrop.js';

/* The shape Emir AI returns. Every field may be null — a missing figure stays
   missing rather than being guessed. */
type Extracted = {
  name: string | null;
  developer: string | null;
  emirate: string | null;
  community: string | null;
  propertyType: string | null;
  saleStatus: SaleStatus | null;
  handoverDate: string | null;
  startingPriceAed: number | null;
  paymentPlan: string | null;
  reraNo: string | null;
  serviceChargeSqft: number | null;
  ownership: string | null;
  description: string | null;
  amenities: string[] | null;
  units: { unitNo: string; bedrooms: number | null; floor: string | null; internalAreaSqft: number | null; view: string | null; priceAed: number | null }[] | null;
  paymentMilestones: { milestone: string; percent: number; dueNote: string | null }[] | null;
  confidence: Record<string, number> | null;
};

const STEPS: [string, string][] = [
  ['Basics', 'building-2'],
  ['Prices & units', 'banknote'],
  ['Description', 'sparkles'],
  ['Media & documents', 'camera'],
  ['Commission & visibility', 'eye'],
];

const READING = [
  'Project name and developer',
  'Community and emirate',
  'Handover date and status',
  'Prices and payment plan',
  'Unit list and floor plans',
  'Amenities and photos',
];

const EMIRATES = [
  ['dubai', 'Dubai'], ['abu_dhabi', 'Abu Dhabi'], ['sharjah', 'Sharjah'],
  ['ras_al_khaimah', 'Ras Al Khaimah'], ['ajman', 'Ajman'], ['fujairah', 'Fujairah'],
  ['umm_al_quwain', 'Umm Al Quwain'], ['other', 'Other'],
] as const;

const TYPES = [
  ['apartment', 'Apartments'], ['townhouse', 'Townhouses'], ['villa', 'Villas'],
  ['penthouse', 'Penthouses'], ['plot', 'Plots'], ['office', 'Offices'], ['mixed', 'Mixed'],
] as const;

/**
 * Send one file as a raw body.
 *
 * Not multipart: the server reads the stream straight through, and the name
 * rides in a header because an HTTP header is Latin-1 and a developer's file
 * is as likely to be named in Arabic as in English.
 */
async function uploadFile(path: string, file: File, headers: Record<string, string> = {}): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': file.type,
      'X-Filename': encodeURIComponent(file.name),
      ...headers,
    },
    body: file,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Upload failed (${response.status})`);
  }
}

/** The document kinds a developer actually sends, in the order they matter. */
const DOC_KINDS: [string, string][] = [
  ['developer_offer', 'Developer sales offer'],
  ['brochure_en', 'Brochure (English)'],
  ['brochure_ar', 'Brochure (Arabic)'],
  ['price_list', 'Price list'],
  ['floor_plan_pack', 'Floor plans'],
  ['master_plan', 'Master plan'],
  ['payment_plan_sheet', 'Payment plan'],
  ['rera_certificate', 'RERA / DLD certificate'],
  ['commission_agreement', 'Commission agreement'],
  ['spa_template', 'SPA template'],
  ['other', 'Something else'],
];

/**
 * A first guess at what a file is, from what the developer called it.
 *
 * Only a guess — the dropdown beside each row is the real answer, and it is
 * right there because the file name is often no help at all.
 */
function guessKind(filename: string): string {
  const name = filename.toLowerCase();
  if (name.includes('offer')) return 'developer_offer';
  if (name.includes('price')) return 'price_list';
  if (name.includes('floor') || name.includes('plan') && name.includes('unit')) return 'floor_plan_pack';
  if (name.includes('master')) return 'master_plan';
  if (name.includes('payment')) return 'payment_plan_sheet';
  if (name.includes('rera') || name.includes('dld')) return 'rera_certificate';
  if (name.includes('spa')) return 'spa_template';
  if (name.includes('commission')) return 'commission_agreement';
  if (name.includes('brochure') && (name.includes('ar') || name.includes('arabic'))) return 'brochure_ar';
  if (name.includes('brochure')) return 'brochure_en';
  return 'other';
}

/** Stable per pick, so a preview URL survives re-renders and reordering. */
function fileKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

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

function num(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[, ]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Add a project, the way the design draws it.
 *
 * It opens by asking *how* to start rather than with a form, because typing a
 * project by hand is the slow way and the slow way is why a library stays
 * empty. Drop the developer's PDF and Emir AI fills the fields; every one it
 * touched is highlighted and carries a confidence score, and nothing reaches
 * the library until a person presses the button.
 */
export function AddProject({ developers, onDone, onCancel }: {
  developers: DeveloperRow[];
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  // -1 is the "how do you want to start?" screen; 0–4 are the wizard steps.
  const [step, setStep] = useState(-1);
  const [draft, setDraft] = useState<ProjectDraft>(blank);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState<number | null>(null);
  const [readingWhat, setReadingWhat] = useState<'the document' | 'the page'>('the document');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  /*
   * The project has no id until it is saved, so photos and documents are held
   * here and uploaded straight after. Nothing is stored on the server for a
   * project the user then abandons.
   */
  const [photos, setPhotos] = useState<File[]>([]);
  const [documents, setDocuments] = useState<{ file: File; kind: string }[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<LibraryCard[] | null>(null);
  const [checkingDupes, setCheckingDupes] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  function addPhotos(files: File[]) {
    setPhotos((current) => [...current, ...files]);
    // Shown from the browser's own copy, so nothing is uploaded to preview it.
    setPreviews((current) => {
      const next = { ...current };
      for (const file of files) next[fileKey(file)] = URL.createObjectURL(file);
      return next;
    });
  }

  function removePhoto(file: File) {
    setPhotos((current) => current.filter((row) => row !== file));
    const url = previews[fileKey(file)];
    if (url) URL.revokeObjectURL(url);
  }

  const set = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /*
   * The duplicate check the spec asks for beside the name. Two rows for the
   * same tower is how a library stops being the single source of truth — and
   * how two agents quote two different prices for the same unit.
   */
  async function checkDuplicates() {
    const name = draft.name.trim();
    if (name.length < 3) return;
    setCheckingDupes(true);
    try {
      const { items } = await api.get<{ items: LibraryCard[] }>(`/api/library/similar?name=${encodeURIComponent(name)}`);
      setDupes(items);
    } catch {
      setDupes(null);
      toast('Could not check for duplicates just now');
    } finally {
      setCheckingDupes(false);
    }
  }

  /* The completeness ring: the six fields that make a project usable. */
  const RING_FIELDS: (keyof ProjectDraft)[] = ['name', 'developer', 'community', 'handoverDate', 'startingPriceAed', 'description'];
  const pct = Math.round(
    (RING_FIELDS.filter((key) => String(draft[key] ?? '').trim()).length / RING_FIELDS.length) * 100,
  );

  /** Walk the checklist while the request is in flight, as the design does. */
  function startTicking(): () => void {
    setReading(0);
    const timer = window.setInterval(() => {
      setReading((current) => (current === null ? 0 : Math.min(current + 1, READING.length - 1)));
    }, 700);
    return () => window.clearInterval(timer);
  }

  function applyExtraction(result: { extracted: Extracted; filled: string[] }) {
    const e = result.extracted;
    setExtracted(e);
    setAiFilled(new Set(result.filled));
    setDraft((current) => ({
      ...current,
      name: e.name ?? current.name,
      developer: e.developer ?? current.developer,
      emirate: e.emirate ?? current.emirate,
      community: e.community ?? current.community,
      propertyType: e.propertyType ?? current.propertyType,
      saleStatus: e.saleStatus ?? current.saleStatus,
      handoverDate: e.handoverDate ?? current.handoverDate,
      startingPriceAed: e.startingPriceAed ?? current.startingPriceAed,
      paymentPlan: e.paymentPlan ?? current.paymentPlan,
      reraNo: e.reraNo ?? current.reraNo,
      serviceChargeSqft: e.serviceChargeSqft ?? current.serviceChargeSqft,
      ownership: e.ownership ?? current.ownership,
      description: e.description ?? current.description,
    }));
    setStep(0);
    toast(`Emir AI filled ${result.filled.length} field${result.filled.length === 1 ? '' : 's'} · check them before saving`);
  }

  async function readFile(file: File) {
    setError(null);
    setReadingWhat('the document');
    const stop = startTicking();
    try {
      const response = await fetch('/api/library/extract/file', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) throw new Error(payload?.error?.message ?? 'Could not read that file');
      applyExtraction(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file');
      setStep(-1);
    } finally {
      stop();
      setReading(null);
    }
  }

  async function readLink() {
    if (!linkUrl.trim()) return;
    setError(null);
    setReadingWhat('the page');
    const stop = startTicking();
    try {
      applyExtraction(await api.post('/api/library/extract/link', { url: linkUrl.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that page');
      setStep(-1);
    } finally {
      stop();
      setReading(null);
    }
  }

  async function save() {
    if (!draft.name.trim()) { setError('Give the project a name.'); setStep(0); return; }
    if (!draft.developerId && !draft.developer?.trim()) { setError('Choose or type a developer.'); setStep(0); return; }

    setSaving(true);
    setError(null);
    try {
      const { id } = await api.post<{ id: string }>('/api/library', draft);

      /*
       * The units, the plan and the amenities Emir AI read come with it. The
       * project itself is already saved, so a failure here is not a reason to
       * lose it — but it is a reason to say so out loud, because a price list
       * that quietly did not arrive is the one thing an agent would not think
       * to check.
       */
      const missed: string[] = [];

      if (extracted?.units?.length) {
        try {
          await api.post(`/api/library/${id}/units`, {
            units: extracted.units.map((u) => ({
              unitNo: u.unitNo,
              bedrooms: u.bedrooms,
              floor: u.floor,
              internalAreaSqft: u.internalAreaSqft,
              view: u.view,
              priceAed: u.priceAed,
            })),
            label: 'Read from the developer file',
          });
        } catch {
          missed.push('the unit list');
        }
      }

      if (extracted?.paymentMilestones?.length) {
        try {
          await api.post(`/api/library/${id}/plans`, {
            name: draft.paymentPlan || 'Developer plan',
            isDefault: true,
            rows: extracted.paymentMilestones.map((m) => ({
              milestone: m.milestone, percent: m.percent, dueNote: m.dueNote,
            })),
          });
        } catch {
          missed.push('the payment plan');
        }
      }

      if (extracted?.amenities?.length) {
        try {
          await api.put(`/api/library/${id}/amenities`, { names: extracted.amenities });
        } catch {
          missed.push('the amenities');
        }
      }

      /*
       * Photos and documents go up now the project has an id. Uploaded one at
       * a time on purpose: forty photos in one request is one failure that
       * loses all forty, and this way the ones that arrived stay.
       */
      let photosFailed = 0;
      for (const file of photos) {
        try {
          await uploadFile(`/api/library/${id}/photos`, file);
        } catch {
          photosFailed += 1;
        }
      }
      if (photosFailed) missed.push(`${photosFailed} photo${photosFailed === 1 ? '' : 's'}`);

      let documentsFailed = 0;
      for (const { file, kind } of documents) {
        try {
          await uploadFile(`/api/library/${id}/documents`, file, { 'X-Kind': kind });
        } catch {
          documentsFailed += 1;
        }
      }
      if (documentsFailed) missed.push(`${documentsFailed} document${documentsFailed === 1 ? '' : 's'}`);

      if (missed.length) {
        toast(`Project saved, but ${missed.join(' and ')} did not — add ${missed.length > 1 ? 'them' : 'it'} from the project page.`);
      }

      onDone(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the project');
    } finally {
      setSaving(false);
    }
  }

  /* ── Emir AI is reading… ──────────────────────────────────────────────── */
  if (reading !== null) {
    return (
      <div className="panel rise" style={{ maxWidth: 640, margin: '40px auto', textAlign: 'center' }}>
        <span className="orb" style={{ margin: '0 auto 16px', display: 'block' }} />
        <h3 style={{ justifyContent: 'center' }}>Emir AI is reading {readingWhat}…</h3>
        <div className="close-list" style={{ marginTop: 18, textAlign: 'left' }}>
          {READING.map((row, i) => (
            <div className={`close-item ${i < reading ? 'ok' : i === reading ? 'run' : ''}`} key={row}>
              <span className="ck"><Icon name="check" /></span>
              {row}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── How do you want to start? ────────────────────────────────────────── */
  if (step === -1) {
    return (
      <>
        <div className="sof-bar rise">
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Back">
            <Icon name="arrow-left" />
          </button>
          <div className="crumb"><b>Add a project</b></div>
        </div>

        <div className="panel rise" style={{ ['--i' as string]: 1 }}>
          <div className="ai-head" style={{ marginBottom: 16 }}>
            <span className="orb" />
            <div>
              <h3 style={{ margin: 0 }}>How do you want to start?</h3>
              <small>Emir AI can build the whole project from one file — usually under a minute.</small>
            </div>
            <span className="gem"><i />Emir AI</span>
          </div>

          {error && <div className="err" style={{ display: 'block', marginBottom: 12 }} role="alert">{error}</div>}

          <div className="startgrid">
            <button type="button" className="startcard hero" onClick={() => picker.current?.click()}>
              <div className="ic"><Icon name="file-up" /></div>
              <b>Drop a developer file</b>
              <p>Sales offer, brochure or price list. Emir AI reads it and fills the name, developer,
                prices, payment plan, units, amenities and handover.</p>
              <span className="tag"><Icon name="zap" size={11} />Fastest</span>
            </button>

            <button type="button" className="startcard" onClick={() => setStep(-2)}>
              <div className="ic"><Icon name="link" /></div>
              <b>Paste a link</b>
              <p>The developer&rsquo;s project page or a portal listing. Emir AI pulls the facts and
                the photos.</p>
            </button>

            <button type="button" className="startcard" onClick={() => setStep(0)}>
              <div className="ic"><Icon name="pencil-line" /></div>
              <b>Type it myself</b>
              <p>A blank form with Emir AI beside every field to help you write.</p>
            </button>
          </div>

          <div className="aihint" style={{ marginTop: 16 }}>
            <Icon name="shield-check" />
            <div>
              <b>Nothing is saved until you check it.</b> Emir AI fills the fields and marks each one
              with a confidence score. You confirm before the project goes live in the library.
            </div>
          </div>
        </div>

        <input
          ref={picker}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void readFile(file);
          }}
        />
      </>
    );
  }

  /* ── Paste a link ─────────────────────────────────────────────────────── */
  if (step === -2) {
    return (
      <>
        <div className="sof-bar rise">
          <button type="button" className="icon-btn" onClick={() => setStep(-1)} aria-label="Back">
            <Icon name="arrow-left" />
          </button>
          <div className="crumb"><b>Paste a link</b></div>
        </div>
        <div className="panel rise" style={{ ['--i' as string]: 1, maxWidth: 640 }}>
          {error && <div className="err" style={{ display: 'block', marginBottom: 12 }} role="alert">{error}</div>}
          <Field label="The developer's project page" hint="Emir AI reads the page and fills what it finds.">
            <Input
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://properties.emaar.com/en/…"
              autoFocus
            />
          </Field>
          <div className="ai-row">
            <button type="button" className="btn btn-primary" onClick={() => void readLink()} disabled={!linkUrl.trim()}>
              <Icon name="sparkles" size={15} />
              <span>Read it</span>
            </button>
          </div>
        </div>
      </>
    );
  }

  /* ── The five steps ───────────────────────────────────────────────────── */
  const conf = (field: string) => {
    const score = extracted?.confidence?.[field];
    if (score === undefined) return null;
    const level = score >= 0.85 ? 'hi' : score >= 0.6 ? 'mid' : 'lo';
    return <span className={`conf ${level}`}>{Math.round(score * 100)}%</span>;
  };
  const cls = (field: string) => (aiFilled.has(field) ? 'filled' : undefined);

  return (
    <>
      <div className="sof-bar rise">
        <button type="button" className="icon-btn" onClick={onCancel} aria-label="Back">
          <Icon name="arrow-left" />
        </button>
        <div className="crumb"><b>{draft.name || 'New project'}</b></div>
        <div className="right">
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            <Icon name="check" size={15} />
            <span>{saving ? 'Saving…' : 'Add to library'}</span>
          </button>
        </div>
      </div>

      <div className="steps2 rise" style={{ ['--i' as string]: 1, marginBottom: 14 }}>
        {STEPS.map(([label], k) => (
          <button
            type="button"
            key={label}
            className={`${k === step ? 'on' : ''} ${k < step ? 'done' : ''}`}
            onClick={() => setStep(k)}
          >
            <span className="n">{k + 1}</span>
            {label}
          </button>
        ))}
      </div>

      {error && <div className="err" style={{ display: 'block', marginBottom: 12 }} role="alert">{error}</div>}

      <div className="npgrid">
        <div className="panel rise" style={{ ['--i' as string]: 2 }}>
          {step === 0 && (
            <>
              <h3><Icon name="building-2" />Basics</h3>
              <div className="field-row">
                <Field label={<>Project name {conf('name')}</>}>
                  <Input
                    className={cls('name')}
                    value={draft.name}
                    onChange={(e) => { set('name', e.target.value); setDupes(null); }}
                    maxLength={160}
                  />
                </Field>
                <Field label="Developer">
                  <Select value={draft.developerId ?? ''} onChange={(e) => set('developerId', e.target.value || null)}>
                    <option value="">— choose —</option>
                    {developers.map((d) => <option key={d.id} value={d.id}>{d.short_name}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="ai-row" style={{ marginTop: -6, marginBottom: 14 }}>
                <button
                  type="button"
                  className="rowbtn"
                  onClick={() => void checkDuplicates()}
                  disabled={checkingDupes || draft.name.trim().length < 3}
                >
                  <Icon name="search" size={13} />
                  <span>{checkingDupes ? 'Checking…' : 'Check for duplicates'}</span>
                </button>
              </div>

              {dupes !== null && (
                dupes.length === 0
                  ? <Note>No project with a name like that yet.</Note>
                  : (
                    <div className="aihint" style={{ borderColor: 'color-mix(in srgb, var(--hot) 35%, transparent)' }}>
                      <Icon name="alert-triangle" />
                      <div>
                        <b>Already in the library:</b>{' '}
                        {dupes.map((row) => `${row.name}${row.developer ? ` (${row.developer})` : ''}`).join(', ')}.
                        Adding it twice means two prices for the same unit — open the existing one instead
                        unless this really is a different project.
                      </div>
                    </div>
                  )
              )}

              {!draft.developerId && (
                <Field label={<>Or type the developer {conf('developer')}</>}>
                  <Input className={cls('developer')} value={draft.developer ?? ''} onChange={(e) => set('developer', e.target.value || null)} maxLength={160} />
                </Field>
              )}
              <div className="field-row">
                <Field label="Emirate">
                  <Select className={cls('emirate')} value={draft.emirate} onChange={(e) => set('emirate', e.target.value)}>
                    {EMIRATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
                <Field label={<>Community {conf('community')}</>}>
                  <Input className={cls('community')} value={draft.community ?? ''} onChange={(e) => set('community', e.target.value || null)} maxLength={160} />
                </Field>
              </div>
              <div className="field-row">
                <Field label="Property type">
                  <Select className={cls('propertyType')} value={draft.propertyType ?? ''} onChange={(e) => set('propertyType', e.target.value || null)}>
                    <option value="">—</option>
                    {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </Field>
                <Field label={<>Handover {conf('handoverDate')}</>} hint="As the developer writes it.">
                  <Input className={cls('handoverDate')} value={draft.handoverDate ?? ''} onChange={(e) => set('handoverDate', e.target.value || null)} maxLength={48} />
                </Field>
              </div>
              <div className="field-row">
                <Field label="Status">
                  <Select value={draft.saleStatus} onChange={(e) => set('saleStatus', e.target.value as SaleStatus)}>
                    <option value="selling_now">Selling now</option>
                    <option value="coming_soon">Coming soon</option>
                    <option value="sold_out">Sold out</option>
                  </Select>
                </Field>
                <Field label={<>DLD / RERA number {conf('reraNo')}</>}>
                  <Input className={cls('reraNo')} value={draft.reraNo ?? ''} onChange={(e) => set('reraNo', e.target.value || null)} maxLength={64} />
                </Field>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h3><Icon name="banknote" />Prices &amp; units</h3>
              <Note>These are what the CRM quotes on WhatsApp. Leave anything you are unsure about
                blank — a blank field is left out of the reply, a wrong one is sent to a buyer.</Note>
              <div className="field-row">
                <Field label={<>Price from (AED) {conf('startingPriceAed')}</>}>
                  <Input className={cls('startingPriceAed')} inputMode="numeric" value={draft.startingPriceAed ?? ''} onChange={(e) => set('startingPriceAed', num(e.target.value))} />
                </Field>
                <Field label={<>Payment plan {conf('paymentPlan')}</>}>
                  <Input className={cls('paymentPlan')} value={draft.paymentPlan ?? ''} onChange={(e) => set('paymentPlan', e.target.value || null)} maxLength={255} />
                </Field>
              </div>
              <div className="field-row">
                <Field label={<>Service charge per sq ft {conf('serviceChargeSqft')}</>}>
                  <Input className={cls('serviceChargeSqft')} inputMode="decimal" value={draft.serviceChargeSqft ?? ''} onChange={(e) => set('serviceChargeSqft', num(e.target.value))} />
                </Field>
                <Field label="Golden Visa threshold (AED)">
                  <Input inputMode="numeric" value={draft.goldenVisaThresholdAed ?? ''} onChange={(e) => set('goldenVisaThresholdAed', num(e.target.value))} />
                </Field>
              </div>

              {extracted?.units?.length ? (
                <>
                  <div className="sec-t">
                    Emir AI read {extracted.units.length} unit{extracted.units.length === 1 ? '' : 's'}
                    <span className="muted" style={{ fontWeight: 400 }}> — they are added with the project.</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Unit</th><th>BR</th><th className="col-wide">Floor</th><th className="col-wide">Area</th><th>Price</th></tr></thead>
                      <tbody>
                        {extracted.units.slice(0, 8).map((u) => (
                          <tr key={u.unitNo}>
                            <td><b>{u.unitNo}</b></td>
                            <td>{u.bedrooms ?? '—'}</td>
                            <td className="col-wide">{u.floor ?? '—'}</td>
                            <td className="col-wide">{u.internalAreaSqft ?? '—'}</td>
                            <td>{u.priceAed ? `AED ${formatAed(u.priceAed)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {extracted.units.length > 8 && (
                    <p className="muted" style={{ fontSize: 12.5 }}>…and {extracted.units.length - 8} more.</p>
                  )}
                </>
              ) : (
                <Note>No unit list yet. Add one from the project&rsquo;s Units &amp; prices tab once it is saved.</Note>
              )}

              {extracted?.paymentMilestones?.length ? (
                <>
                  <div className="sec-t">And a payment plan with {extracted.paymentMilestones.length} milestones</div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Milestone</th><th>%</th><th className="col-wide">Due</th></tr></thead>
                      <tbody>
                        {extracted.paymentMilestones.map((m, i) => (
                          <tr key={`${m.milestone}-${i}`}>
                            <td>{m.milestone}</td><td><b>{m.percent}%</b></td>
                            <td className="col-wide muted">{m.dueNote ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </>
          )}

          {step === 2 && (
            <>
              <h3><Icon name="sparkles" />Description</h3>
              <Note>Emir AI writes from the project facts only. It never invents a price, a date or
                a feature that is not above.</Note>
              <Field label={<>About this project {conf('description')}</>}>
                <TextArea className={cls('description')} rows={7} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value || null)} maxLength={10000} />
              </Field>
              {extracted?.amenities?.length ? (
                <>
                  <div className="sec-t">Amenities Emir AI found</div>
                  <div className="thumbs">
                    {extracted.amenities.slice(0, 24).map((a) => <span className="pill" key={a}>{a}</span>)}
                  </div>
                </>
              ) : null}
            </>
          )}

          {step === 3 && (
            <>
              <h3><Icon name="camera" />Media &amp; documents</h3>

              <FileDrop
                accept="image/jpeg,image/png,image/webp"
                icon="image-up"
                title="Add photos"
                hint="Drag them here, or tap to choose. The first one becomes the cover."
                onFiles={addPhotos}
              />

              {photos.length > 0 && (
                <>
                  <div className="sec-t">
                    {photos.length} photo{photos.length === 1 ? '' : 's'}
                    <span className="muted" style={{ fontWeight: 400 }}> — the first is the cover</span>
                  </div>
                  <div className="shots">
                    {photos.map((file, index) => (
                      <figure className="shot" key={fileKey(file)}>
                        <img src={previews[fileKey(file)]} alt={file.name} />
                        {index === 0 && <span className="pill ok">Cover</span>}
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => removePhoto(file)}
                          aria-label={`Remove ${file.name}`}
                        >
                          <Icon name="trash-2" />
                        </button>
                        <figcaption>{fileSize(file.size)}</figcaption>
                      </figure>
                    ))}
                  </div>
                </>
              )}

              <div className="sec-t">Documents</div>
              <FileDrop
                accept="application/pdf,image/jpeg,image/png,image/webp"
                icon="file-up"
                title="Add the developer's files"
                hint="Sales offer, brochure, price list, floor plans. PDF or a photo of the page."
                onFiles={(files) => setDocuments((current) => [
                  ...current,
                  ...files.map((file) => ({ file, kind: guessKind(file.name) })),
                ])}
              />

              {documents.length > 0 && (
                <div className="close-list" style={{ marginTop: 10 }}>
                  {documents.map(({ file, kind }, index) => (
                    <div className="close-item" key={`${file.name}-${index}`}>
                      <Icon name="file-text" />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <b style={{ display: 'block' }}>{file.name}</b>
                        <small className="muted">{fileSize(file.size)}</small>
                      </div>
                      <Select
                        value={kind}
                        onChange={(event) => setDocuments((current) =>
                          current.map((row, i) => (i === index ? { ...row, kind: event.target.value } : row)))}
                        style={{ width: 'auto', maxWidth: 190 }}
                      >
                        {DOC_KINDS.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </Select>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setDocuments((current) => current.filter((_, i) => i !== index))}
                        aria-label={`Remove ${file.name}`}
                      >
                        <Icon name="trash-2" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="sec-t">Or link to them instead</div>
              <div className="field-row">
                <Field label="Cover image URL" hint="Only needed if you are not uploading a photo.">
                  <Input value={draft.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value || null)} maxLength={1024} />
                </Field>
                <Field label="Brochure URL" hint="What the BROCHURE reply sends on WhatsApp.">
                  <Input value={draft.brochureUrl ?? ''} onChange={(e) => set('brochureUrl', e.target.value || null)} maxLength={1024} />
                </Field>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h3><Icon name="eye" />Commission &amp; visibility</h3>
              <div className="field-row">
                <Field label="Who can see it" hint="Public is built but stays off until the website exists.">
                  <Select value={draft.visibility} onChange={(e) => set('visibility', e.target.value as Visibility)}>
                    <option value="private">Private — team only</option>
                    <option value="team">Specific team only</option>
                    <option value="public" disabled>Public on the website (coming later)</option>
                  </Select>
                </Field>
                <Field label="Golden Visa">
                  <label className="check" style={{ paddingTop: 8 }}>
                    <input type="checkbox" checked={draft.goldenVisaEligible} onChange={(e) => set('goldenVisaEligible', e.target.checked)} />
                    <span>Eligible</span>
                  </label>
                </Field>
              </div>
              <div className="aihint">
                <Icon name="shield-check" />
                <div>
                  <b>Emir AI check:</b> the project saves unverified, so the WhatsApp auto-replies
                  will not quote it until someone opens it and presses Verify.
                </div>
              </div>
              <Note>Commission is set on the project&rsquo;s own Commission tab, where only owners,
                admins and managers can see it.</Note>
            </>
          )}

          <div className="ai-row">
            {step > 0 && (
              <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>
            )}
            {step < STEPS.length - 1 ? (
              <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)}>Next</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
                {saving ? 'Saving…' : 'Add to library'}
              </button>
            )}
          </div>
        </div>

        {/* ── The live card and the completeness ring ─────────────────── */}
        <div className="panel rise" style={{ ['--i' as string]: 3 }}>
          <div className="ring">
            <svg viewBox="0 0 100 100" aria-hidden>
              <circle className="bg" cx="50" cy="50" r="42" />
              <circle className="fg" cx="50" cy="50" r="42" strokeDasharray={`${(pct / 100) * 264} 264`} />
            </svg>
            <b>{pct}%</b>
          </div>
          <p className="muted" style={{ textAlign: 'center', fontSize: 12, margin: '0 0 12px' }}>Project completeness</p>

          <article className="proj-card">
            <div className="proj-cover" style={draft.imageUrl ? { backgroundImage: `url(${draft.imageUrl})` } : undefined}>
              <div className="proj-badges">
                <span className="pill ok">{humanize(draft.saleStatus)}</span>
                <span className="pill">Private</span>
              </div>
              <div className="proj-title">
                <b>{draft.name || 'Project name'}</b>
                <small>{draft.developer || 'Developer'}{draft.community ? ` · ${draft.community}` : ''}</small>
              </div>
            </div>
            <div className="proj-body">
              <div className="proj-price">
                {draft.startingPriceAed
                  ? <><b>AED {formatAed(draft.startingPriceAed)}</b> <span className="muted">from</span></>
                  : <span className="muted">AED —</span>}
              </div>
              <div className="proj-facts muted">
                {[draft.propertyType ? humanize(draft.propertyType) : null, draft.handoverDate, draft.paymentPlan]
                  .filter(Boolean).join('  ·  ') || '—'}
              </div>
            </div>
          </article>

          {aiFilled.size > 0 && (
            <div className="aihint" style={{ marginTop: 12 }}>
              <Icon name="sparkles" />
              <div>
                <b>Emir AI filled {aiFilled.size} fields.</b> The highlighted ones came from your
                document — check them before saving.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
