import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import type { DeveloperContactRow, DeveloperRow } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { avatarColour, initials } from '../design/stages.js';
import {
  Avatar, Drawer, DrawerHead, Empty, ErrorNote, Field, Input, Note, Select, Spinner, TextArea, useToast,
} from '../design/ui.js';

/** What Emir AI hands back when it looks a developer up. */
type LookedUp = {
  legalName: string | null;
  shortName: string | null;
  orn: string | null;
  trn: string | null;
  headOffice: string | null;
  escrowBank: string | null;
  website: string | null;
  trackRecord: string | null;
  confidence: Record<string, number> | null;
};

type Draft = {
  legalName: string;
  shortName: string;
  orn: string;
  trn: string;
  headOffice: string;
  escrowBank: string;
  website: string;
  commissionPct: string;
  paymentTerms: string;
  trackRecord: string;
};

type NewContact = { name: string; role: string; phone: string; email: string };

const TERMS = ['30 days from SPA', '45 days from SPA', '60 days from SPA', '90 days from SPA'];

function blankDraft(): Draft {
  return {
    legalName: '', shortName: '', orn: '', trn: '', headOffice: '', escrowBank: '',
    website: '', commissionPct: '4', paymentTerms: TERMS[0] as string, trackRecord: '',
  };
}

export function draftFrom(row: DeveloperRow): Draft {
  return {
    legalName: row.legal_name,
    shortName: row.short_name,
    orn: row.orn ?? '',
    trn: row.trn ?? '',
    headOffice: row.head_office ?? '',
    escrowBank: row.escrow_bank ?? '',
    website: row.website ?? '',
    // A DECIMAL column arrives as "4.00"; nobody writes a commission that way.
    commissionPct: row.commission_pct == null ? '' : String(Number(row.commission_pct)),
    paymentTerms: row.payment_terms ?? '',
    /*
     * Read, not blanked. `payloadFrom` sends every field in the draft, so a
     * hard-coded '' here would quietly wipe the stored track record the first
     * time anyone opened a developer and pressed Save.
     */
    trackRecord: row.track_record ?? '',
  };
}

/** Only what has a value, so a blank box never overwrites a stored field. */
export function payloadFrom(draft: Draft) {
  const text = (value: string) => (value.trim() ? value.trim() : null);
  const rate = Number(draft.commissionPct);
  return {
    legalName: draft.legalName.trim(),
    shortName: text(draft.shortName),
    orn: text(draft.orn),
    trn: text(draft.trn),
    headOffice: text(draft.headOffice),
    escrowBank: text(draft.escrowBank),
    website: text(draft.website),
    commissionPct: draft.commissionPct.trim() && Number.isFinite(rate) ? rate : null,
    paymentTerms: text(draft.paymentTerms),
    trackRecord: text(draft.trackRecord),
  };
}

/**
 * The developers behind the projects.
 *
 * Two things live here that live nowhere else: our commercial terms with each
 * developer, and the direct mobiles of their own sales people — the number an
 * agent rings to hold a unit. Both are for the team only. The server strips
 * the commercial fields for an agent's role, and neither ever reaches a client
 * offer.
 */
export function Developers() {
  const { user } = useAuth();
  const toast = useToast();

  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const canManage = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';
  const list = useAsync<{ items: DeveloperRow[] }>(() => api.get('/api/library/developers'), []);
  const items = list.data?.items ?? [];

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;

  return (
    <>
      {list.loading && items.length === 0 && <Spinner />}

      {!list.loading && items.length === 0 && !canManage && (
        <Empty
          icon="building"
          title="No developers yet"
          hint="Your manager has not added any developers."
        />
      )}

      <div className="dev-grid">
        {items.map((row, index) => (
          <article
            className="devcard"
            key={row.id}
            style={{ animationDelay: `${index * 40}ms` }}
            onClick={() => setOpenId(row.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpenId(row.id); } }}
          >
            <span className="lg" style={{ background: avatarColour(row.legal_name) }}>
              {initials(row.short_name || row.legal_name).slice(0, 1)}
            </span>
            <div style={{ minWidth: 0 }}>
              <b>{row.short_name || row.legal_name}</b>
              <small>{[row.head_office, row.orn ? `ORN ${row.orn}` : null].filter(Boolean).join(' · ') || 'No head office yet'}</small>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, whiteSpace: 'nowrap' }}>
                <span className="pill">{row.project_count} project{row.project_count === 1 ? '' : 's'}</span>
                <span className="pill">{row.contact_count} contact{row.contact_count === 1 ? '' : 's'}</span>
              </div>
            </div>
            {row.commission_pct != null && (
              <div className="st2"><b>{Number(row.commission_pct)}%</b>commission</div>
            )}
          </article>
        ))}

        {canManage && (
          <button
            type="button"
            className="startcard"
            style={{ display: 'grid', placeItems: 'center', textAlign: 'center', minHeight: 120 }}
            onClick={() => setAdding(true)}
          >
            <div>
              <div className="ic" style={{ margin: '0 auto 8px' }}><Icon name="plus" /></div>
              <b>Add developer</b>
              <p>Name, ORN, escrow bank and their sales contacts</p>
            </div>
          </button>
        )}
      </div>

      <DeveloperDrawer
        developerId={openId}
        isNew={adding}
        canManage={canManage}
        onClose={() => { setOpenId(null); setAdding(false); }}
        onSaved={(message) => { toast(message); list.reload(); }}
      />
    </>
  );
}

function DeveloperDrawer({ developerId, isNew, canManage, onClose, onSaved }: {
  developerId: string | null;
  isNew: boolean;
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const open = isNew || developerId !== null;
  return (
    <Drawer open={open} onClose={onClose} label={isNew ? 'Add developer' : 'Developer'}>
      <DeveloperPanel
        key={developerId ?? 'new'}
        developerId={developerId}
        isNew={isNew}
        canManage={canManage}
        onClose={onClose}
        onSaved={onSaved}
      />
    </Drawer>
  );
}

function DeveloperPanel({ developerId, isNew, canManage, onClose, onSaved }: {
  developerId: string | null;
  isNew: boolean;
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const toast = useToast();
  const loaded = useAsync<{ developer: DeveloperRow; contacts: DeveloperContactRow[] } | null>(
    () => (developerId ? api.get(`/api/library/developers/${developerId}`) : Promise.resolve(null)),
    [developerId],
  );

  const [draft, setDraft] = useState<Draft | null>(isNew ? blankDraft() : null);
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  const [confidence, setConfidence] = useState<Record<string, number> | null>(null);
  const [lookup, setLookup] = useState('');
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newContact, setNewContact] = useState<NewContact | null>(null);

  // The loaded record becomes the draft once, then the user owns it.
  const current = draft ?? (loaded.data ? draftFrom(loaded.data.developer) : null);
  const contacts = loaded.data?.contacts ?? [];

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...(current ?? blankDraft()), [key]: value });

  const cls = (field: string) => (aiFilled.has(field) ? 'filled' : undefined);
  const conf = (field: string) => {
    const score = confidence?.[field];
    if (score === undefined) return null;
    return <span className={`conf ${score >= 0.85 ? 'hi' : score >= 0.6 ? 'mid' : 'lo'}`}>{Math.round(score * 100)}%</span>;
  };

  async function askEmirAi() {
    if (lookup.trim().length < 2) return;
    setLooking(true);
    setError(null);
    try {
      const { extracted, filled } = await api.post<{ extracted: LookedUp; filled: string[] }>(
        '/api/library/developers/lookup', { query: lookup.trim() },
      );
      const base = current ?? blankDraft();
      setDraft({
        ...base,
        legalName: extracted.legalName ?? base.legalName,
        shortName: extracted.shortName ?? base.shortName,
        orn: extracted.orn ?? base.orn,
        trn: extracted.trn ?? base.trn,
        headOffice: extracted.headOffice ?? base.headOffice,
        escrowBank: extracted.escrowBank ?? base.escrowBank,
        website: extracted.website ?? base.website,
        trackRecord: extracted.trackRecord ?? base.trackRecord,
      });
      setAiFilled(new Set(filled));
      setConfidence(extracted.confidence);
      toast(
        filled.length
          ? `Emir AI filled ${filled.length} field${filled.length === 1 ? '' : 's'} · please check them`
          : "Emir AI did not recognise them — type the details in",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not look that up');
    } finally {
      setLooking(false);
    }
  }

  async function save() {
    if (!current?.legalName.trim()) { setError('Give the developer a legal name.'); return; }
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const { id } = await api.post<{ id: string }>('/api/library/developers', payloadFrom(current));
        // The contact the user typed while adding goes in with them.
        if (newContact?.name.trim()) {
          await api.post(`/api/library/developers/${id}/contacts`, contactPayload(newContact));
        }
        onSaved('Developer added');
      } else if (developerId) {
        await api.patch(`/api/library/developers/${developerId}`, payloadFrom(current));
        onSaved('Saved');
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function addContact() {
    if (!newContact?.name.trim() || !developerId) return;
    try {
      await api.post(`/api/library/developers/${developerId}/contacts`, contactPayload(newContact));
      setNewContact(null);
      loaded.reload();
      onSaved('Contact added');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that contact');
    }
  }

  async function removeContact(contact: DeveloperContactRow) {
    try {
      await api.del(`/api/library/developers/contacts/${contact.id}`);
      loaded.reload();
      toast(`${contact.name} removed`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that contact');
    }
  }

  if (!current) return <div className="drawer-body"><Spinner /></div>;

  const title = isNew ? 'Add developer' : current.shortName || current.legalName;

  return (
    <>
      <DrawerHead onClose={onClose}>
        <span
          className="lg"
          style={{
            width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center',
            background: avatarColour(current.legalName || 'new'), color: '#fff', fontWeight: 700,
          }}
          aria-hidden
        >
          {isNew && !current.legalName ? '+' : initials(current.legalName).slice(0, 1)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 16 }}>{title}</b>
          <div className="muted" style={{ fontSize: 13 }}>
            {isNew ? 'Emir AI can fill this from their website' : current.headOffice || 'No head office yet'}
          </div>
        </div>
      </DrawerHead>

      <div className="drawer-body">
        {error && <div className="err" style={{ display: 'block', marginBottom: 12 }} role="alert">{error}</div>}

        {isNew && canManage && (
          <>
            <div className="fieldrow">
              <Field label="Developer website or name">
                <Input
                  value={lookup}
                  onChange={(event) => setLookup(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void askEmirAi(); } }}
                  placeholder="emaar.com"
                  autoFocus
                />
              </Field>
              <button
                type="button"
                className="wand"
                onClick={() => void askEmirAi()}
                disabled={looking || lookup.trim().length < 2}
                title="Fill with Emir AI"
                aria-label="Fill with Emir AI"
              >
                <Icon name={looking ? 'loader-2' : 'sparkles'} className={looking ? 'spin' : undefined} />
              </button>
            </div>
            <div className="aihint">
              <Icon name="sparkles" />
              <div>
                Emir AI fills the legal name, ORN, TRN and address from what it knows about them.
                It leaves a field blank rather than guessing — check them before saving.
              </div>
            </div>
            <div style={{ height: 14 }} />
          </>
        )}

        <div className="two">
          <Field label={<>Legal name {conf('legalName')}</>}>
            <Input className={cls('legalName')} value={current.legalName} onChange={(e) => set('legalName', e.target.value)} maxLength={200} disabled={!canManage} />
          </Field>
          <Field label={<>Short name {conf('shortName')}</>}>
            <Input className={cls('shortName')} value={current.shortName} onChange={(e) => set('shortName', e.target.value)} maxLength={120} disabled={!canManage} />
          </Field>
        </div>

        <div className="two">
          <Field label={<>ORN {conf('orn')}</>}>
            <Input className={cls('orn')} value={current.orn} onChange={(e) => set('orn', e.target.value)} maxLength={64} disabled={!canManage} />
          </Field>
          <Field label={<>TRN {conf('trn')}</>}>
            <Input className={cls('trn')} value={current.trn} onChange={(e) => set('trn', e.target.value)} maxLength={64} disabled={!canManage} />
          </Field>
        </div>

        <Field label={<>Head office {conf('headOffice')}</>}>
          <Input className={cls('headOffice')} value={current.headOffice} onChange={(e) => set('headOffice', e.target.value)} maxLength={255} disabled={!canManage} />
        </Field>

        <div className="two">
          <Field label={<>Escrow bank {conf('escrowBank')}</>}>
            <Input className={cls('escrowBank')} value={current.escrowBank} onChange={(e) => set('escrowBank', e.target.value)} maxLength={160} disabled={!canManage} />
          </Field>
          <Field label={<>Website {conf('website')}</>}>
            <Input className={cls('website')} value={current.website} onChange={(e) => set('website', e.target.value)} maxLength={255} disabled={!canManage} />
          </Field>
        </div>

        {/* Commercial terms. The server does not send these to an agent at all,
            so an agent simply never sees this block. */}
        {current.commissionPct !== undefined && (loaded.data?.developer.commission_pct !== undefined || isNew) && (
          <div className="two">
            <Field label="Our commission" hint="Per cent of the sale price.">
              <Input
                className="input"
                inputMode="decimal"
                value={current.commissionPct}
                onChange={(e) => set('commissionPct', e.target.value)}
                disabled={!canManage}
              />
            </Field>
            <Field label="Payment terms">
              <Select value={current.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} disabled={!canManage}>
                <option value="">—</option>
                {TERMS.map((term) => <option key={term} value={term}>{term}</option>)}
                {current.paymentTerms && !TERMS.includes(current.paymentTerms) && (
                  <option value={current.paymentTerms}>{current.paymentTerms}</option>
                )}
              </Select>
            </Field>
          </div>
        )}

        <Field
          label={<>Track record {conf('trackRecord')}</>}
          hint="Shown on the project's Developer tab and in an offer's About the developer section."
        >
          <TextArea
            className={cls('trackRecord')}
            rows={3}
            value={current.trackRecord}
            onChange={(e) => set('trackRecord', e.target.value)}
            maxLength={5000}
            disabled={!canManage}
            placeholder={isNew ? 'Founded, what they have delivered, the communities they are known for.' : undefined}
          />
        </Field>

        {/* ── Their sales contacts ──────────────────────────────────────── */}
        <div className="sec-t" style={{ display: 'flex', alignItems: 'center' }}>
          Their sales contacts
          {canManage && !newContact && (
            <button
              type="button"
              className="rowbtn"
              style={{ marginInlineStart: 'auto' }}
              onClick={() => setNewContact({ name: '', role: '', phone: '', email: '' })}
            >
              <Icon name="plus" size={13} />
              <span>Add contact</span>
            </button>
          )}
        </div>

        {contacts.length === 0 && !newContact && (
          <p className="muted" style={{ fontSize: 13 }}>
            No contacts yet. Add the broker-relations person and the bookings desk.
          </p>
        )}

        {contacts.map((contact) => (
          <div className="ctc" key={contact.id}>
            <Avatar name={contact.name} size={34} />
            <div style={{ minWidth: 0 }}>
              <b>{contact.name}</b>
              <small className="muted" style={{ display: 'block' }}>
                {[contact.role, contact.phone_e164].filter(Boolean).join(' · ') || '—'}
              </small>
            </div>
            <div className="acts2">
              {contact.phone_e164 && (
                <a className="icon-btn" href={`tel:${contact.phone_e164}`} title={`Call ${contact.name}`} aria-label={`Call ${contact.name}`}>
                  <Icon name="phone" />
                </a>
              )}
              {(contact.whatsapp_e164 ?? contact.phone_e164) && (
                <a
                  className="icon-btn"
                  href={`https://wa.me/${(contact.whatsapp_e164 ?? contact.phone_e164 ?? '').replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`WhatsApp ${contact.name}`}
                  aria-label={`WhatsApp ${contact.name}`}
                >
                  <Icon name="message-circle" />
                </a>
              )}
              {contact.email && (
                <a className="icon-btn" href={`mailto:${contact.email}`} title={`Email ${contact.name}`} aria-label={`Email ${contact.name}`}>
                  <Icon name="mail" />
                </a>
              )}
              {canManage && (
                <button type="button" className="icon-btn" onClick={() => void removeContact(contact)} title="Remove" aria-label={`Remove ${contact.name}`}>
                  <Icon name="trash-2" />
                </button>
              )}
            </div>
          </div>
        ))}

        {newContact && (
          <div style={{ paddingTop: 10 }}>
            <div className="two">
              <Field label="Name">
                <Input value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} maxLength={160} autoFocus />
              </Field>
              <Field label="Role">
                <Input value={newContact.role} onChange={(e) => setNewContact({ ...newContact, role: e.target.value })} maxLength={120} placeholder="Broker relations" />
              </Field>
            </div>
            <div className="two">
              <Field label="Mobile / WhatsApp">
                <Input value={newContact.phone} onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })} maxLength={24} placeholder="+971 50 111 2233" />
              </Field>
              <Field label="Email">
                <Input value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} maxLength={255} placeholder="brokers@developer.ae" />
              </Field>
            </div>
            <div className="ai-row">
              <button type="button" className="rowbtn" onClick={() => setNewContact(null)}>Cancel</button>
              {!isNew && (
                <button type="button" className="btn btn-primary" onClick={() => void addContact()} disabled={!newContact.name.trim()}>
                  Add contact
                </button>
              )}
            </div>
            {isNew && <Note>This contact is saved together with the developer.</Note>}
          </div>
        )}

        <Note>These numbers are for your team only. They never appear in a client offer.</Note>
      </div>

      {canManage && (
        <div className="drawer-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            <Icon name="check" size={15} />
            <span>{saving ? 'Saving…' : isNew ? 'Add developer' : 'Save'}</span>
          </button>
        </div>
      )}
    </>
  );
}

/** Whatever the user typed, shaped to what the contacts endpoint accepts. */
function contactPayload(contact: NewContact) {
  const text = (value: string) => (value.trim() ? value.trim() : null);
  const phone = text(contact.phone);
  return {
    name: contact.name.trim(),
    role: text(contact.role),
    phone,
    // Same number unless someone says otherwise — in the UAE it almost always is.
    whatsapp: phone,
    email: text(contact.email),
  };
}
