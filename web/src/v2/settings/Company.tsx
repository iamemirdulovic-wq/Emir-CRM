import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.js';
import { Icon } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SaveBar, SettingsRow, SettingsShell, SettingsTitle } from './Shell.js';

/**
 * Settings → Company.
 *
 * Built from `design/web/company.html`: the logo, the names, the licence
 * numbers, the two address lines and the contact details on the left, and on
 * the right a live preview of the two places these details actually leave the
 * CRM — the back of a business card and the footer of a sales offer.
 *
 * The preview is the point of the screen. "TRN" means nothing on its own;
 * seeing the offer footer fill in as you type is what makes somebody notice
 * it is blank. So it updates from the draft, not from what is saved, and a
 * field that has not been filled in says what is missing rather than leaving
 * a gap that reads as "nothing goes here".
 *
 * **Nothing on this page is ever filled in with a plausible value.** The legal
 * name, the TRN, the ORN and the trade licence are facts about a real company,
 * and a document carrying an invented one is a document that says something
 * false to a buyer. An empty field stays empty and is listed in the banner.
 */

interface Company {
  legalName: string;
  tradingName: string;
  trn: string;
  orn: string;
  licenceNo: string;
  licenceExpiry: string;
  address: string;
  addressLine2: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  logoUrl: string;
}

interface Answer {
  company: Partial<Company>;
  issues: string[];
  lastChange: { at: string; by: string | null } | null;
  logoFile: { name: string; bytes: number } | null;
}

const BLANK: Company = {
  legalName: '', tradingName: '', trn: '', orn: '', licenceNo: '', licenceExpiry: '',
  address: '', addressLine2: '', phone: '', whatsapp: '', email: '', website: '', logoUrl: '',
};

/** Digits only, for the three fields the design marks `data-digits`. */
const digits = (value: string) => value.replace(/\D/g, '');

export function V2SettingsCompany() {
  const { user } = useAuth();
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const got = useAsync<Answer>(() => api.get('/api/company'), []);
  const [draft, setDraft] = useState<Company>(BLANK);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const toast = useToast();

  const saved: Company = { ...BLANK, ...(got.data?.company ?? {}) };
  useEffect(() => { if (got.data) setDraft({ ...BLANK, ...got.data.company }); }, [got.data]);

  const dirty = (Object.keys(BLANK) as Array<keyof Company>)
    /* The logo is its own control with its own buttons, not part of the form. */
    .filter((key) => key !== 'logoUrl')
    .some((key) => draft[key] !== saved[key]);
  const set = (key: keyof Company) => (value: string) =>
    setDraft((was) => ({ ...was, [key]: value }));

  /* Every rule the design's own form checks, with the design's own words. */
  const errors: Partial<Record<keyof Company, string>> = {
    legalName: draft.legalName.trim().length < 3 ? 'Write the legal name, as on the licence.' : undefined,
    tradingName: draft.tradingName.trim() ? undefined : 'Write the brand name.',
    orn: digits(draft.orn).length >= 4 ? undefined : 'Digits only, at least 4.',
    trn: !draft.trn.trim() || digits(draft.trn).length === 15 ? undefined : 'A TRN has 15 digits.',
    address: draft.address.trim() ? undefined : 'Write the office address.',
    addressLine2: draft.addressLine2.trim() ? undefined : 'Write the area and city.',
    phone: digits(draft.phone).length >= 9 ? undefined : 'Digits only, at least 9.',
    email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email.trim())
      ? undefined : 'This email does not look right.',
  };
  const anyError = Object.values(errors).some(Boolean);

  async function save() {
    setTried(true);
    if (anyError) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.put('/api/company', draft);
      toast('Company details saved');
      setTried(false);
      got.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (got.error) {
    return <SettingsShell page="p-company"><div className="d-set-body"><ErrorNote>{got.error}</ErrorNote></div></SettingsShell>;
  }
  if (!got.data) {
    return <SettingsShell page="p-company"><div className="d-set-body"><Spinner /></div></SettingsShell>;
  }

  /** Only once the person has tried to save: errors while typing nag. */
  const show = (key: keyof Company) => (tried ? errors[key] : undefined);

  return (
    <SettingsShell page="p-company">
      <div className="d-set-body">
        <SettingsTitle
          title="Company"
          note="These details show on business cards, sales offers and the sign-in page."
        />

        <div className="d-co-grid">
          <div className="d-col d-gap-16">
            {got.data.issues.length > 0 && (
              <div className="d-banner d-amber">
                <Icon name="alert-triangle" />
                <span className="d-grow">
                  <b>
                    {got.data.issues.length} detail
                    {got.data.issues.length === 1 ? '' : 's'} to check.
                  </b>{' '}
                  {got.data.issues[0]}
                </span>
              </div>
            )}

            <section className="d-card">
              <Logo
                logoUrl={draft.logoUrl}
                file={got.data.logoFile}
                canEdit={canEdit}
                onChanged={() => got.reload()}
              />

              <SettingsRow
                label="Names"
                note="The legal name is on documents. The brand name is what clients see."
              >
                <div className="d-form-grid">
                  <Text
                    label="Legal name" required full value={draft.legalName}
                    disabled={!canEdit} onChange={set('legalName')}
                    hint="As on the trade licence" error={show('legalName')}
                  />
                  <Text
                    label="Brand name" required full value={draft.tradingName}
                    disabled={!canEdit} onChange={set('tradingName')} error={show('tradingName')}
                  />
                </div>
              </SettingsRow>

              <SettingsRow
                label="Licence numbers"
                note="ORN is on every business card. TRN is on invoices and sales offers."
              >
                <div className="d-form-grid">
                  <Text
                    label="ORN" required value={draft.orn} disabled={!canEdit}
                    onChange={(v) => set('orn')(digits(v))}
                    hint="Office registration number" error={show('orn')}
                  />
                  <Text
                    label="TRN" value={draft.trn} disabled={!canEdit}
                    onChange={(v) => set('trn')(v.replace(/[^\d\s]/g, ''))}
                    hint="Tax registration number · 15 digits"
                    maxLength={19}
                    /* Checked while typing as well as on save, because a wrong
                       TRN is otherwise found by a client's accountant. */
                    error={show('trn') ?? errors.trn}
                  />
                  <Text
                    label="Trade licence" value={draft.licenceNo} disabled={!canEdit}
                    onChange={set('licenceNo')}
                  />
                  <Text
                    label="Licence expires" value={draft.licenceExpiry} disabled={!canEdit}
                    onChange={set('licenceExpiry')} type="date"
                  />
                </div>
              </SettingsRow>
            </section>

            <section className="d-card">
              <SettingsRow label="Address" note="Two short lines fit on the business card.">
                <div className="d-form-grid">
                  <Text
                    label="Line 1" required full value={draft.address}
                    disabled={!canEdit} onChange={set('address')} error={show('address')}
                  />
                  <Text
                    label="Line 2" required full value={draft.addressLine2}
                    disabled={!canEdit} onChange={set('addressLine2')} error={show('addressLine2')}
                  />
                </div>
              </SettingsRow>

              <SettingsRow label="Contact" note="The office line, not a personal number.">
                <div className="d-form-grid">
                  <Text
                    label="Phone" required value={draft.phone} disabled={!canEdit}
                    onChange={(v) => set('phone')(v.replace(/[^\d+\s]/g, ''))}
                    icon="phone" error={show('phone')}
                  />
                  <Text
                    label="WhatsApp" value={draft.whatsapp} disabled={!canEdit}
                    onChange={set('whatsapp')} icon="message-circle"
                  />
                  <Text
                    label="Email" required value={draft.email} disabled={!canEdit}
                    onChange={set('email')} icon="mail" type="email" error={show('email')}
                  />
                  <Text
                    label="Website" full value={draft.website} disabled={!canEdit}
                    onChange={set('website')} icon="globe"
                  />
                </div>
              </SettingsRow>
            </section>

            {problem && <ErrorNote>{problem}</ErrorNote>}

            {canEdit && (
              <SaveBar
                note={dirty
                  ? <span className="d-t-amber">You have changes that are not saved</span>
                  : lastChangeLine(got.data.lastChange)}
                dirty={dirty}
                busy={busy}
                onUndo={() => { setDraft(saved); setTried(false); }}
                onSave={save}
                saveLabel="Save company"
              />
            )}
          </div>

          <Preview company={draft} />
        </div>
      </div>
    </SettingsShell>
  );
}

/** "Saved · last change 3 Nov by Emir", or just "Saved" when nobody knows. */
function lastChangeLine(last: Answer['lastChange']): string {
  if (!last) return 'Saved';
  const when = new Date(last.at).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Dubai',
  });
  return last.by
    ? `Saved · last change ${when} by ${last.by.split(' ')[0]}`
    : `Saved · last change ${when}`;
}

/* ── the logo ─────────────────────────────────────────────────────────── */

/**
 * The logo row, which was missing from this page entirely.
 *
 * `POST /api/company/logo` and `DELETE` have been on the server since the
 * company screen was built, and nothing in v2 called either, so the only way
 * to change the mark on every offer and every client email was the old
 * settings page.
 *
 * One difference from the design, in `docs/decisions-to-confirm.md`: it says
 * "PNG or SVG". An SVG is a script-capable document, and the logo is served
 * inline from the API's own origin to every client who opens an offer, so the
 * server accepts PNG, JPG and WebP and the hint says so rather than offering
 * a format the upload would refuse.
 */
function Logo({
  logoUrl, file, canEdit, onChanged,
}: {
  logoUrl: string;
  file: Answer['logoFile'];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!confirming) return undefined;
    const timer = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  async function upload(chosen: File) {
    setBusy(true);
    setProblem(null);
    try {
      await api.upload('/api/company/logo', chosen);
      toast('Logo uploaded');
      onChanged();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That logo was not accepted.');
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = '';
    }
  }

  async function remove() {
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    setBusy(true);
    try {
      await api.del('/api/company/logo');
      toast('Logo removed', { action: { label: 'Upload another', onClick: () => picker.current?.click() } });
      onChanged();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsRow label="Logo" note="PNG, JPG or WebP, square, at least 512 px.">
      <div className="d-row d-gap-16">
        <span className={logoUrl ? 'd-co-logo' : 'd-co-logo d-none'}>
          {logoUrl
            ? <img src={logoUrl} alt="The company logo" className="v2-co-logo-img" />
            : <Icon name="building" />}
        </span>
        <div className="d-col d-gap-8">
          {canEdit && (
            <div className="d-btn-row">
              <button
                type="button"
                className="d-btn d-sm"
                disabled={busy}
                onClick={() => picker.current?.click()}
              >
                <Icon name="upload" />
                {busy ? 'Uploading…' : 'Upload a new logo'}
              </button>
              {logoUrl && (
                <button
                  type="button"
                  className={confirming ? 'd-btn d-sm d-danger d-solid' : 'd-btn d-sm d-danger'}
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {confirming ? 'Tap again to remove' : 'Remove'}
                </button>
              )}
            </div>
          )}
          <span className="d-small d-muted">
            {file
              ? `${file.name} · ${kb(file.bytes)}`
              : 'No logo. Cards and offers show the brand name only.'}
          </span>
          {problem && <span className="v2-field-error">{problem}</span>}
        </div>
      </div>
      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label="Choose a logo file"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) void upload(chosen);
        }}
      />
    </SettingsRow>
  );
}

function kb(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ── where it shows ───────────────────────────────────────────────────── */

/**
 * The two places these details leave the CRM.
 *
 * Deliberately not a pretty mock-up: it is the actual wording of the card
 * back and the offer footer, so a blank TRN looks as wrong here as it will
 * look to a client.
 */
function Preview({ company }: { company: Company }) {
  const or = (value: string, missing: string) =>
    value.trim() ? value : <span className="v2-co-blank">{missing}</span>;

  return (
    <aside className="d-co-side">
      <h4>Where it shows</h4>

      <div className="d-co-card">
        <div className="d-row d-gap-8">
          <span className="d-co-mini">
            {company.logoUrl
              ? <img src={company.logoUrl} alt="" className="v2-co-logo-img" />
              : <Icon name="building" />}
          </span>
          <b>{or(company.tradingName, 'brand name')}</b>
        </div>
        <div className="d-mt-auto">
          <div className="d-tiny v2-co-faint">{or(company.legalName, 'legal name')}</div>
          <div className="d-tiny v2-co-faint">ORN {or(company.orn, '—')}</div>
        </div>
      </div>
      <span className="d-small d-muted">Business card · back side</span>

      <div className="d-co-doc">
        <div className="d-row d-between">
          <b>{or(company.tradingName, 'brand name')}</b>
          <span className="d-chip">Sales offer</span>
        </div>
        <div className="d-sk" />
        <div className="d-sk" style={{ width: '70%' }} />
        <div className="d-sk" style={{ width: '82%' }} />
        <div className="d-tiny d-muted d-mt-8">
          {or(company.legalName, 'legal name')} · TRN {or(company.trn, 'not set')}
          <br />
          {or(company.address, 'office address')}, {or(company.addressLine2, 'area and city')}
          <br />
          {or(company.phone, 'phone')} · {or(company.email, 'email')}
          {company.website.trim() ? ` · ${company.website}` : ''}
        </div>
      </div>
      <span className="d-small d-muted">Footer of every sales offer</span>

      {/* The design's shortcut at the foot of the column: the other place
          these details are used, which is where somebody goes next. */}
      <Link className="d-shortcut" to="/v2/card">
        <Icon name="id-card" />
        <span className="d-grow">Business card tool</span>
        <Icon name="arrow-right" />
      </Link>
    </aside>
  );
}

/* ── one field ────────────────────────────────────────────────────────── */

function Text({
  label, value, onChange, hint, error, required, full, disabled, icon, maxLength, type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  required?: boolean;
  full?: boolean;
  disabled?: boolean;
  icon?: 'phone' | 'mail' | 'globe' | 'message-circle';
  maxLength?: number;
  type?: string;
}) {
  const input = (
    <input
      className="d-input"
      type={type}
      value={value}
      disabled={disabled}
      maxLength={maxLength}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  return (
    <div className={[full ? 'd-field d-full' : 'd-field', error ? 'd-invalid' : ''].join(' ').trim()}>
      <label>
        {label}
        {required && <span className="d-req">*</span>}
      </label>
      {icon ? <div className="d-input-icon"><Icon name={icon} />{input}</div> : input}
      {error ? <span className="d-error">{error}</span> : hint && <span className="d-hint">{hint}</span>}
    </div>
  );
}
