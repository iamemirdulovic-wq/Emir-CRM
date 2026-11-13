import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.js';
import { Icon } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { SaveBar, SettingsRow, SettingsShell, SettingsTitle } from './Shell.js';

/**
 * Settings → Company.
 *
 * Ported from `design/web/company.html`: the form on the left, and on the
 * right a live preview of the two places these details actually appear — the
 * back of a business card and the footer of a sales offer.
 *
 * The preview is the point of the screen. "TRN" means nothing on its own;
 * seeing the offer footer fill in as you type is what makes somebody notice
 * it is blank. So it updates from the draft, not from what is saved.
 */

interface Company {
  legalName: string;
  tradingName: string;
  trn: string;
  orn: string;
  licenceNo: string;
  licenceExpiry: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  logoUrl: string;
}

interface Answer {
  company: Partial<Company>;
  issues: string[];
}

const BLANK: Company = {
  legalName: '', tradingName: '', trn: '', orn: '', licenceNo: '', licenceExpiry: '',
  address: '', phone: '', whatsapp: '', email: '', website: '', logoUrl: '',
};

export function V2SettingsCompany() {
  const { user } = useAuth();
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const got = useAsync<Answer>(() => api.get('/api/company'), []);
  const [draft, setDraft] = useState<Company>(BLANK);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  const saved: Company = { ...BLANK, ...(got.data?.company ?? {}) };
  useEffect(() => { if (got.data) setDraft({ ...BLANK, ...got.data.company }); }, [got.data]);

  const dirty = (Object.keys(BLANK) as Array<keyof Company>).some((key) => draft[key] !== saved[key]);
  const set = (key: keyof Company) => (value: string) =>
    setDraft((was) => ({ ...was, [key]: value }));

  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await api.put('/api/company', draft);
      toast('Company details saved');
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
              <SettingsRow
                label="Names"
                note="The legal name is on documents. The brand name is what clients see."
              >
                <div className="d-form-grid">
                  <Text
                    label="Legal name" required full value={draft.legalName}
                    disabled={!canEdit} onChange={set('legalName')}
                    hint="As on the trade licence"
                  />
                  <Text
                    label="Brand name" required full value={draft.tradingName}
                    disabled={!canEdit} onChange={set('tradingName')}
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
                    onChange={set('orn')} hint="Office registration number"
                  />
                  <Text
                    label="TRN" value={draft.trn} disabled={!canEdit} onChange={set('trn')}
                    hint="Tax registration number · 15 digits"
                    /* Checked here as well as on the server, because a wrong
                       TRN is not found until a client's accountant finds it. */
                    error={draft.trn.trim() && !/^\d{15}$/.test(draft.trn.replace(/\s/g, ''))
                      ? 'A TRN has 15 digits.'
                      : undefined}
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
                    label="Office address" required full value={draft.address}
                    disabled={!canEdit} onChange={set('address')}
                  />
                </div>
              </SettingsRow>

              <SettingsRow label="Contact" note="The office line, not a personal number.">
                <div className="d-form-grid">
                  <Text
                    label="Phone" required value={draft.phone} disabled={!canEdit}
                    onChange={set('phone')} icon="phone"
                  />
                  <Text
                    label="WhatsApp" value={draft.whatsapp} disabled={!canEdit}
                    onChange={set('whatsapp')} icon="message-circle"
                  />
                  <Text
                    label="Email" required value={draft.email} disabled={!canEdit}
                    onChange={set('email')} icon="mail" type="email"
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
                note={dirty ? 'Not saved yet' : 'Saved'}
                dirty={dirty}
                busy={busy}
                onUndo={() => setDraft(saved)}
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
          <span className="d-co-mini"><Icon name="building" /></span>
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
          {or(company.address, 'office address')}
          <br />
          {or(company.phone, 'phone')} · {or(company.email, 'email')}
          {company.website.trim() ? ` · ${company.website}` : ''}
        </div>
      </div>
      <span className="d-small d-muted">Footer of every sales offer</span>
    </aside>
  );
}

/* ── one field ────────────────────────────────────────────────────────── */

function Text({
  label, value, onChange, hint, error, required, full, disabled, icon, type = 'text',
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
  type?: string;
}) {
  const input = (
    <input
      className="d-input"
      type={type}
      value={value}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  return (
    <div className={full ? 'd-field d-full' : 'd-field'}>
      <label>
        {label}
        {required && <span className="d-req">*</span>}
      </label>
      {icon ? <div className="d-input-icon"><Icon name={icon} />{input}</div> : input}
      {error ? <span className="v2-field-error">{error}</span> : hint && <span className="d-hint">{hint}</span>}
    </div>
  );
}
