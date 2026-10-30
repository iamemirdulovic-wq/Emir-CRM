import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Button } from '../design/forms.js';
import { Icon } from '../design/index.js';
import { ErrorNote, Field, Input, Note, Panel, Spinner, useToast } from '../design/ui.js';
import { FileDrop } from './FileDrop.js';

/**
 * The company, as a client sees it, and the limits on automated messaging.
 *
 * Every field here reaches somebody outside the office — the footer of a
 * WhatsApp template, the signature on a follow-up email, the letterhead of an
 * offer, the business card an agent hands over. So each one says where it
 * shows up rather than just what it is called: an owner should not have to
 * guess what changing "ORN" will do.
 *
 * These used to be constants in the source. Changing the company's name meant
 * a developer and a deploy.
 */

interface Company {
  legalName: string;
  tradingName: string;
  localityEn: string;
  localityAr: string;
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

interface Messaging {
  quietStartHour: number;
  quietEndHour: number;
  maxPer24h: number;
  botPauseHours: number;
  describes: string;
  customised: boolean;
  defaults: { quietStartHour: number; quietEndHour: number; maxPer24h: number; botPauseHours: number };
  limits: { maxPer24hCeiling: number; botPauseHours: [number, number] };
}

interface Loaded {
  company: Company;
  issues: string[];
  renameWarning: string;
  messaging: Messaging;
}

export function CompanySettings() {
  const toast = useToast();
  const loaded = useAsync<Loaded>(() => api.get('/api/company'), []);
  const [draft, setDraft] = useState<Company | null>(null);
  const [rules, setRules] = useState<Messaging | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!loaded.data) return;
    setDraft(loaded.data.company);
    setRules(loaded.data.messaging);
    setIssues(loaded.data.issues);
  }, [loaded.data]);

  if (loaded.error) return <ErrorNote>{loaded.error}</ErrorNote>;
  if (!draft || !rules || !loaded.data) return <Spinner />;

  const original = loaded.data.company;
  const set = <K extends keyof Company>(key: K, value: Company[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const renaming = draft.legalName !== original.legalName || draft.tradingName !== original.tradingName;
  const dirty = Object.keys(draft).some((key) => draft[key as keyof Company] !== original[key as keyof Company]);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await api.put<{ company: Company; issues: string[]; changed: string[] }>('/api/company', draft);
      setDraft(saved.company);
      setIssues(saved.issues);
      loaded.reload();
      toast(saved.changed.length === 0 ? 'Nothing had changed' : 'Saved');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  }

  async function saveMessaging(next: Messaging) {
    setRules(next);
    try {
      const saved = await api.put<Messaging>('/api/company/messaging', {
        quietStartHour: next.quietStartHour,
        quietEndHour: next.quietEndHour,
        maxPer24h: next.maxPer24h,
        botPauseHours: next.botPauseHours,
      });
      /* What was stored, not what was typed: the limits are clamped on the
         server and the owner should see that happen. */
      setRules((current) => (current ? { ...current, ...saved } : current));
      toast('Saved');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that');
      loaded.reload();
    }
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    try {
      const result = await api.upload<{ logoUrl: string }>('/api/company/logo', file);
      set('logoUrl', result.logoUrl);
      loaded.reload();
      toast('Logo saved');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not upload that');
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    setUploading(true);
    try {
      await api.del('/api/company/logo');
      set('logoUrl', '');
      loaded.reload();
      toast('Logo removed');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not remove it');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="dash">
      <Panel span={8} index={0} icon="building" title="Your company">
        <p className="muted" style={{ marginTop: 0 }}>
          What a client sees. These appear at the bottom of every WhatsApp template, in the
          signature of every follow-up email, and on every offer and business card.
        </p>

        <div className="routing-grid">
          <Field
            label="Registered name"
            hint="As it appears on the trade licence. This is the name on an offer and an invoice."
          >
            <Input value={draft.legalName} maxLength={160} onChange={(e) => set('legalName', e.target.value)} />
          </Field>
          <Field
            label="What people call us"
            hint="The short name used in conversation. Leave it blank to use the registered name."
          >
            <Input
              value={draft.tradingName} maxLength={160} placeholder={draft.legalName}
              onChange={(e) => set('tradingName', e.target.value)}
            />
          </Field>
        </div>

        {renaming && (
          <Note>
            <strong>Before you save: </strong>
            {loaded.data.renameWarning}
          </Note>
        )}

        <div className="routing-grid">
          <Field label="Where we are, in English" hint="Goes after the name in the footer: “Dubai & Abu Dhabi”.">
            <Input value={draft.localityEn} maxLength={120} onChange={(e) => set('localityEn', e.target.value)} />
          </Field>
          <Field label="Where we are, in Arabic" hint="The same line for an Arabic-speaking client.">
            <Input
              value={draft.localityAr} maxLength={120} dir="rtl"
              onChange={(e) => set('localityAr', e.target.value)}
            />
          </Field>
        </div>

        <h4 className="co-head">Registration</h4>
        <div className="routing-grid">
          <Field label="TRN" hint="Fifteen digits. It has to appear on every tax invoice.">
            <Input
              value={draft.trn} maxLength={20} inputMode="numeric"
              onChange={(e) => set('trn', e.target.value)}
            />
          </Field>
          <Field label="ORN" hint="The RERA office registration number, on every offer.">
            <Input value={draft.orn} maxLength={20} onChange={(e) => set('orn', e.target.value)} />
          </Field>
          <Field label="Trade licence number" hint="Shown on an offer beside the ORN.">
            <Input value={draft.licenceNo} maxLength={40} onChange={(e) => set('licenceNo', e.target.value)} />
          </Field>
          <Field label="Licence expires" hint="The CRM warns you a month before.">
            <Input
              type="date" value={draft.licenceExpiry}
              onChange={(e) => set('licenceExpiry', e.target.value)}
            />
          </Field>
        </div>

        <h4 className="co-head">How a client reaches us</h4>
        <div className="routing-grid">
          <Field label="Office address" hint="On the offer letterhead and in the email footer.">
            <Input value={draft.address} maxLength={240} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Office phone" hint="Written in full, starting +971.">
            <Input value={draft.phone} maxLength={32} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Company WhatsApp" hint="The number on the business card and the offer page.">
            <Input value={draft.whatsapp} maxLength={32} onChange={(e) => set('whatsapp', e.target.value)} />
          </Field>
          <Field label="Email" hint="Where a client replying to an offer should land.">
            <Input
              type="email" value={draft.email} maxLength={160}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
          <Field label="Website" hint="Starts with https://">
            <Input value={draft.website} maxLength={200} onChange={(e) => set('website', e.target.value)} />
          </Field>
        </div>

        <div className="co-save">
          <Button variant="primary" icon="save" loading={saving} disabled={!dirty} onClick={() => void save()}>
            {dirty ? 'Save the company details' : 'Saved'}
          </Button>
          {dirty && (
            <button type="button" className="brief-link" onClick={() => setDraft(original)}>
              Undo my changes
            </button>
          )}
        </div>
      </Panel>

      <Panel span={4} index={1} icon="image-up" title="Logo">
        {draft.logoUrl ? (
          <div className="co-logo">
            <img src={draft.logoUrl} alt="The company logo" />
            <Button icon="trash-2" size="sm" loading={uploading} onClick={() => void removeLogo()}>
              Remove it
            </Button>
          </div>
        ) : (
          <FileDrop
            accept="image/png,image/jpeg,image/webp"
            multiple={false}
            icon="image-up"
            title="Drop the logo here"
            hint="PNG, JPG or WebP, up to 2 MB. A wide logo on a transparent background works best."
            disabled={uploading}
            onFiles={(files) => files[0] && void uploadLogo(files[0])}
          />
        )}
        <Note>
          It appears at the top of every offer page, in the footer of every email, and on the
          business card. Without one, those fall back to the company initials.
        </Note>
      </Panel>

      {issues.length > 0 && (
        <Panel span={12} index={2} icon="alert-triangle" title="Worth fixing">
          <ul className="co-issues">
            {issues.map((issue) => (
              <li key={issue}>
                <Icon name="alert-triangle" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel span={12} index={3} icon="message-circle" title="Automated messaging">
        <p className="muted" style={{ marginTop: 0 }}>
          The limits every automatic message obeys. They do not apply to anything you or an agent
          sends by hand, and the instant WhatsApp reply to a brand-new lead is always sent.
        </p>

        <div className="routing-grid">
          <Field
            label="No automatic messages from"
            hint={`Currently ${rules.describes}. Clients are never messaged automatically during these hours.`}
          >
            <Input
              type="number" min={0} max={23} value={rules.quietStartHour}
              onChange={(e) => setRules({ ...rules, quietStartHour: Number(e.target.value) })}
              onBlur={() => void saveMessaging(rules)}
            />
          </Field>
          <Field label="Until" hint="Dubai time. The night cannot be made shorter than four hours.">
            <Input
              type="number" min={0} max={23} value={rules.quietEndHour}
              onChange={(e) => setRules({ ...rules, quietEndHour: Number(e.target.value) })}
              onBlur={() => void saveMessaging(rules)}
            />
          </Field>
          <Field
            label="Messages per person, per day"
            hint={`At most ${rules.limits.maxPer24hCeiling} automatic messages, whatever you type. More than that and people block the number.`}
          >
            <Input
              type="number" min={1} max={rules.limits.maxPer24hCeiling} value={rules.maxPer24h}
              onChange={(e) => setRules({ ...rules, maxPer24h: Number(e.target.value) })}
              onBlur={() => void saveMessaging(rules)}
            />
          </Field>
          <Field
            label="Pause after an agent writes"
            hint={`${rules.botPauseHours} hours. Nothing automatic goes to a client an agent is already talking to.`}
          >
            <Input
              type="number" min={rules.limits.botPauseHours[0]} max={rules.limits.botPauseHours[1]}
              value={rules.botPauseHours}
              onChange={(e) => setRules({ ...rules, botPauseHours: Number(e.target.value) })}
              onBlur={() => void saveMessaging(rules)}
            />
          </Field>
        </div>

        {rules.customised ? (
          <Note>
            These are not the defaults. The standard is {rules.defaults.quietStartHour}:00 to{' '}
            {String(rules.defaults.quietEndHour).padStart(2, '0')}:00, {rules.defaults.maxPer24h} messages a
            day and a {rules.defaults.botPauseHours}-hour pause.{' '}
            <button
              type="button"
              className="brief-link"
              onClick={() => void saveMessaging({ ...rules, ...rules.defaults })}
            >
              Put them back
            </button>
          </Note>
        ) : (
          <Note>These are the standard limits. Tighten them if the number’s quality rating drops.</Note>
        )}
      </Panel>
    </div>
  );
}
