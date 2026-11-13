import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote, useToast } from '../design/ui.js';

/**
 * Sales offers.
 *
 * Built from `design/web/sales-offers.html`, including its own description of
 * what this is: *"A sales offer is a one-page price sheet for one unit. You
 * share the link yourself in WhatsApp. The CRM shows when the client opens
 * it."*
 *
 * Nothing on this screen sends anything. Making an offer writes a draft;
 * "Share on WhatsApp" opens WhatsApp with the message ready and records that
 * the agent shared it. That is deliberate and it is the design's: an offer
 * carries a price a client will hold the brokerage to, and no automation
 * should be able to put one in front of somebody.
 */

interface Sheet {
  id: string;
  slug: string;
  reference: string;
  contactId: string | null;
  opportunityId: string | null;
  leadName: string | null;
  projectId: string | null;
  projectName: string | null;
  unitLabel: string | null;
  priceAed: number | null;
  paymentPlan: string | null;
  handover: string | null;
  note: string | null;
  validUntil: string | null;
  agentUserId: string;
  agentName: string | null;
  status: 'draft' | 'shared' | 'accepted';
  createdAt: string;
  sharedAt: string | null;
  acceptedAt: string | null;
  opens: number;
  lastOpenedAt: string | null;
}

interface SheetList {
  items: Sheet[];
  counts: Record<string, number>;
  stats: { thisMonth: number; valueAed: number; accepted: number; waiting: number };
}

interface FormData {
  leads: Array<{ id: string; name: string; project: string | null; projectId: string | null }>;
  projects: Array<{ id: string; name: string; priceFrom: number | null }>;
}

const TABS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'shared', label: 'Shared' },
  { key: 'accepted', label: 'Accepted' },
];

export function V2Offers() {
  const { user } = useAuth();
  const seesEveryone = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('');
  const [agent, setAgent] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  const query = new URLSearchParams({ tab });
  if (search.trim()) query.set('q', search.trim());
  if (project) query.set('project', project);
  if (agent) query.set('agent', agent);

  const list = useAsync<SheetList>(
    () => api.get(`/api/v2/offers?${query.toString()}`),
    [tab, search, project, agent],
  );
  const form = useAsync<FormData>(() => api.get('/api/v2/offers-form'), []);

  const filtered = Boolean(search.trim() || project || agent);
  const open = list.data?.items.find((one) => one.id === openId) ?? null;

  return (
    <div className="v2-offers p-offers">
      <div className="d-so-top">
        <Stat value={String(list.data?.stats.thisMonth ?? '—')} label="offers this month" />
        <Stat value={roughMoney(list.data?.stats.valueAed)} label="total value" />
        <Stat value={String(list.data?.stats.accepted ?? '—')} label="accepted" green />
        <Stat value={String(list.data?.stats.waiting ?? '—')} label="shared, waiting for the client" />
        <span className="d-grow" />
        <button type="button" className="d-btn d-primary" onClick={() => setMaking(true)}>
          <Icon name="plus" />New sales offer
        </button>
      </div>

      <div className="d-tabs d-pills" role="tablist">
        {TABS.map((one) => (
          <button
            key={one.key}
            type="button"
            role="tab"
            aria-selected={tab === one.key}
            className={tab === one.key ? 'd-tab d-on' : 'd-tab'}
            onClick={() => setTab(one.key)}
          >
            {one.label}
            {list.data && <span className="d-count">{list.data.counts[one.key] ?? 0}</span>}
          </button>
        ))}
      </div>

      <div className="d-filters">
        <div className="d-input-icon">
          <Icon name="search" />
          <input
            className="d-input d-sm"
            value={search}
            aria-label="Search lead, unit or number"
            placeholder="Search lead, unit or number"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="d-select d-sm"
          value={project}
          aria-label="Project"
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">Project: all</option>
          {form.data?.projects.map((one) => (
            <option key={one.id} value={one.id}>{one.name}</option>
          ))}
        </select>
        {seesEveryone && (
          <select
            className="d-select d-sm"
            value={agent}
            aria-label="Agent"
            onChange={(e) => setAgent(e.target.value)}
          >
            <option value="">Agent: all</option>
            {agentsIn(list.data?.items ?? []).map((one) => (
              <option key={one.id} value={one.id}>{one.name}</option>
            ))}
          </select>
        )}
        {filtered && (
          <button
            type="button"
            className="d-btn d-xs d-ghost"
            onClick={() => { setSearch(''); setProject(''); setAgent(''); }}
          >
            Clear all
          </button>
        )}
        <span className="d-grow" />
        {list.data && (
          <span className="d-result-count">
            {list.data.items.length} offer{list.data.items.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {list.error && <ErrorNote>{list.error}</ErrorNote>}
      {!list.data && !list.error && <Spinner />}

      {list.data && list.data.items.length > 0 && (
        <div className="d-table-wrap">
          <table className="d-table v2-offer-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Project</th>
                <th>Unit</th>
                <th className="d-t-right">Price</th>
                <th>Status</th>
                {seesEveryone && <th>Agent</th>}
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((one) => (
                <tr key={one.id} onClick={() => setOpenId(one.id)} className="v2-offer-row">
                  <td className="d-t-main">{one.leadName ?? '—'}</td>
                  <td className="d-t-sub">{one.projectName ?? '—'}</td>
                  <td className="d-t-sub">{one.unitLabel ?? '—'}</td>
                  <td className="d-t-right">{money(one.priceAed)}</td>
                  <td><StatusPill sheet={one} /></td>
                  {seesEveryone && <td className="d-t-sub">{one.agentName ?? '—'}</td>}
                  <td className="d-t-sub">{shortDate(one.createdAt)}</td>
                  <td className="d-t-right">
                    <Icon name="chevron-right" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {list.data && list.data.items.length === 0 && (
        <div className="d-empty">
          <span className="d-ic"><Icon name="file-text" /></span>
          <b>No sales offers here</b>
          <p>
            {filtered
              ? 'Change the filters, or make a new offer for a lead.'
              : 'Make the first one for a lead who has asked about a unit.'}
          </p>
          {filtered
            ? (
              <button
                type="button"
                className="d-btn d-sm"
                onClick={() => { setSearch(''); setProject(''); setAgent(''); setTab('all'); }}
              >
                Show everything
              </button>
            )
            : (
              <button type="button" className="d-btn d-sm d-primary" onClick={() => setMaking(true)}>
                <Icon name="plus" />New sales offer
              </button>
            )}
        </div>
      )}

      <p className="d-small d-muted d-mt-12">
        A sales offer is a one-page price sheet for one unit. You share the link yourself in
        WhatsApp. The CRM shows when the client opens it.
      </p>

      {open && (
        <SheetPanel
          sheet={open}
          onClose={() => setOpenId(null)}
          onChanged={() => list.reload()}
        />
      )}

      {making && (
        <NewSheet
          form={form.data}
          onClose={() => setMaking(false)}
          onMade={(id) => { setMaking(false); list.reload(); setOpenId(id); }}
        />
      )}
    </div>
  );
}

/* ── the pieces ────────────────────────────────────────────────────────── */

function Stat({ value, label, green }: { value: string; label: string; green?: boolean }) {
  return (
    <div className="d-so-stat">
      <b className={green ? 'd-num d-t-green' : 'd-num'}>{value}</b>
      <span className="d-label">{label}</span>
    </div>
  );
}

/**
 * The status, including whether the client has actually opened it.
 *
 * "Shared" and "Shared · opened" are a different conversation to have with an
 * agent, which is why the design puts the opens count on the panel and the
 * state here.
 */
function StatusPill({ sheet }: { sheet: Sheet }) {
  if (sheet.status === 'accepted') return <span className="d-chip d-green d-pip">Accepted</span>;
  if (sheet.status === 'draft') return <span className="d-chip">Draft</span>;
  if (sheet.opens > 0) return <span className="d-chip d-blue d-pip">Opened</span>;
  return <span className="d-chip d-amber d-pip">Shared</span>;
}

/* ── the offer, open ───────────────────────────────────────────────────── */

function SheetPanel({
  sheet, onClose, onChanged,
}: { sheet: Sheet; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const toast = useToast();

  const link = `${window.location.origin}/offer/${sheet.slug}`;

  async function act(what: 'shared' | 'accepted') {
    setBusy(true);
    try {
      await api.post(`/api/v2/offers/${sheet.id}/${what}`, {});
      toast(what === 'shared' ? 'Marked as shared' : 'Marked as accepted');
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (confirming !== 'delete') { setConfirming('delete'); return; }
    setBusy(true);
    try {
      await api.del(`/api/v2/offers/${sheet.id}`);
      toast('Draft deleted');
      onChanged();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not delete.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Share on WhatsApp.
   *
   * Opens WhatsApp with the message written and the link in it; the agent
   * presses send. Marking it shared happens here because this is the moment
   * it leaves — not when the client opens it, which may be days later.
   */
  function shareOn(where: 'whatsapp' | 'telegram') {
    const message = [
      `${sheet.leadName ?? 'Hello'},`,
      '',
      `Here is the offer for ${sheet.unitLabel ?? 'the unit'}${sheet.projectName ? ` at ${sheet.projectName}` : ''}.`,
      sheet.priceAed ? `Price: ${money(sheet.priceAed)}.` : '',
      sheet.validUntil ? `It is held until ${longDate(sheet.validUntil)}.` : '',
      '',
      link,
    ].filter(Boolean).join('\n');

    const url = where === 'whatsapp'
      ? `https://wa.me/?text=${encodeURIComponent(message)}`
      : `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    if (sheet.status === 'draft') void act('shared');
  }

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open v2-offer-panel" aria-label="Sales offer">
        <div className="d-panel-head">
          <h2>{sheet.reference}</h2>
          <StatusPill sheet={sheet} />
          <button
            type="button"
            className="d-btn d-icon d-sm d-ghost"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          {/* The sheet itself, as the client will see it. */}
          <div className="d-doc">
            <div className="d-row d-between">
              <b className="d-doc-brand">homes<span>.</span>me</b>
              <span className="d-tiny d-muted">SALES OFFER · {sheet.reference}</span>
            </div>
            <div>
              <div className="d-small d-muted">Prepared for</div>
              <b className="d-big d-bold">{sheet.leadName ?? '—'}</b>
            </div>
            <div className="d-doc-price">
              <span className="d-small d-muted">{sheet.unitLabel ?? '—'}</span>
              <b>{money(sheet.priceAed)}</b>
            </div>
            <dl className="d-kv">
              <Kv term="Project" value={sheet.projectName} />
              <Kv term="Payment plan" value={sheet.paymentPlan} />
              <Kv term="Handover" value={sheet.handover} />
              <Kv term="Valid until" value={sheet.validUntil ? longDate(sheet.validUntil) : null} />
              <Kv term="Your agent" value={sheet.agentName} />
            </dl>
            {sheet.note && <p className="d-small d-muted">{sheet.note}</p>}
          </div>

          {/* Whether the client has read it, which is the whole reason the
              offer is a link rather than a PDF. */}
          <div className={sheet.opens > 0 ? 'd-banner d-blue' : 'd-banner'}>
            <Icon name="eye" />
            <span className="d-grow">
              {sheet.status === 'draft'
                ? 'Not shared yet. Nothing has gone to the client.'
                : sheet.opens === 0
                  ? 'Shared, but the client has not opened it yet.'
                  : `Opened ${sheet.opens} time${sheet.opens === 1 ? '' : 's'}${
                    sheet.lastOpenedAt ? ` · last ${ago(sheet.lastOpenedAt)}` : ''}`}
            </span>
          </div>

          <div className="d-pub-link">
            <Icon name="link" />
            <span className="d-grow d-truncate">{link}</span>
            <button
              type="button"
              className="d-btn d-xs"
              onClick={() => {
                void navigator.clipboard?.writeText(link);
                toast('Link copied');
              }}
            >
              Copy link
            </button>
          </div>

          <div className="d-btn-row">
            <button type="button" className="d-btn" onClick={() => shareOn('whatsapp')}>
              <Icon name="message-circle" />Share on WhatsApp
            </button>
            <button type="button" className="d-btn" onClick={() => shareOn('telegram')}>
              <Icon name="send" />Telegram
            </button>
          </div>
          <p className="d-tiny d-muted">
            Both open the app with the message ready. You press send.
          </p>
        </div>

        <div className="d-panel-foot">
          {sheet.opportunityId && (
            <Link className="d-btn" to={`/v2/leads/${sheet.opportunityId}`}>Open the lead</Link>
          )}
          <span className="d-grow" />
          {sheet.status === 'draft' && (
            <button type="button" className="d-btn d-danger" disabled={busy} onClick={remove}>
              {confirming === 'delete' ? 'Tap again to delete' : 'Delete draft'}
            </button>
          )}
          {sheet.status === 'shared' && (
            <button
              type="button"
              className="d-btn d-green"
              disabled={busy}
              onClick={() => {
                if (confirming !== 'accept') { setConfirming('accept'); return; }
                void act('accepted');
              }}
            >
              {confirming === 'accept' ? 'Tap again · client said yes' : 'Mark as accepted'}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function Kv({ term, value }: { term: string; value: string | null }) {
  return (
    <div className="d-kv-row">
      <dt>{term}</dt>
      <dd>{value ?? <span className="d-muted">—</span>}</dd>
    </div>
  );
}

/* ── making one ────────────────────────────────────────────────────────── */

function NewSheet({
  form, onClose, onMade,
}: { form: FormData | null; onClose: () => void; onMade: (id: string) => void }) {
  const [leadId, setLeadId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [plan, setPlan] = useState('60 / 40');
  const [validUntil, setValidUntil] = useState(inDays(7));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  /* Picking the lead fills the project in, because the lead usually already
     has one and retyping it is how the two drift apart. */
  useEffect(() => {
    const lead = form?.leads.find((one) => one.id === leadId);
    if (lead?.projectId) setProjectId(lead.projectId);
  }, [leadId, form]);

  const chosenProject = form?.projects.find((one) => one.id === projectId);
  const priceAed = Number(price.replace(/[^\d]/g, ''));
  const today = inDays(0);

  const problems = useMemo(() => {
    const found: Record<string, string> = {};
    if (!leadId) found.lead = 'Choose a lead from your list.';
    if (unit.trim().length < 2) found.unit = 'Write the unit, like 2BR · 1204.';
    if (!priceAed) found.price = 'Write the price in numbers.';
    if (validUntil < today) found.valid = 'The day cannot be in the past.';
    return found;
  }, [leadId, unit, priceAed, validUntil, today]);

  const [touched, setTouched] = useState(false);

  async function save() {
    setTouched(true);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await api.post<{ id: string }>('/api/v2/offers', {
        opportunityId: leadId,
        projectId: projectId || null,
        unitLabel: unit.trim(),
        priceAed,
        paymentPlan: plan.trim() || null,
        validUntil,
        note: note.trim() || null,
      });
      toast('Saved as a draft');
      onMade(made.id);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  const show = (key: string) => (touched ? problems[key] : undefined);

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="New sales offer">
        <div className="d-panel-head">
          <h2>New sales offer</h2>
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          <div className="d-field">
            <label>Lead <span className="d-req">*</span></label>
            <select
              className="d-select"
              value={leadId}
              aria-label="Lead"
              onChange={(e) => setLeadId(e.target.value)}
            >
              <option value="">Choose a lead…</option>
              {form?.leads.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}{one.project ? ` · ${one.project}` : ''}
                </option>
              ))}
            </select>
            {show('lead')
              ? <span className="v2-field-error">{show('lead')}</span>
              : <span className="d-hint">The offer is saved on the lead timeline.</span>}
          </div>

          <div className="d-field">
            <span className="d-field-label">Project</span>
            <div className="d-chips">
              {form?.projects.slice(0, 8).map((one) => (
                <button
                  key={one.id}
                  type="button"
                  className={projectId === one.id ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => setProjectId(projectId === one.id ? '' : one.id)}
                >
                  {one.name}
                </button>
              ))}
            </div>
          </div>

          <div className="d-form-grid">
            <div className="d-field">
              <label>Unit <span className="d-req">*</span></label>
              <input
                className="d-input"
                value={unit}
                placeholder="2BR · 1204"
                aria-label="Unit"
                onChange={(e) => setUnit(e.target.value)}
              />
              {show('unit') && <span className="v2-field-error">{show('unit')}</span>}
            </div>

            <div className="d-field">
              <label>Price in AED <span className="d-req">*</span></label>
              <input
                className="d-input"
                value={price}
                inputMode="numeric"
                placeholder="2,050,000"
                aria-label="Price in AED"
                /* Shown with separators, sent as an integer. Typing into a
                   field that reformats under the cursor is maddening, so it
                   only tidies up when the field is left. */
                onChange={(e) => setPrice(e.target.value)}
                onBlur={() => setPrice(priceAed ? priceAed.toLocaleString('en-GB') : '')}
              />
              {show('price')
                ? <span className="v2-field-error">{show('price')}</span>
                : chosenProject?.priceFrom
                  ? <span className="d-hint">{chosenProject.name} starts from {roughMoney(chosenProject.priceFrom)}</span>
                  : null}
            </div>

            <div className="d-field">
              <label>Payment plan</label>
              <input
                className="d-input"
                value={plan}
                aria-label="Payment plan"
                onChange={(e) => setPlan(e.target.value)}
              />
            </div>

            <div className="d-field">
              <label>Valid until <span className="d-req">*</span></label>
              <input
                className="d-input"
                type="date"
                value={validUntil}
                min={today}
                aria-label="Valid until"
                onChange={(e) => setValidUntil(e.target.value)}
              />
              {show('valid') && <span className="v2-field-error">{show('valid')}</span>}
            </div>

            <div className="d-field d-full">
              <label>Note for the client</label>
              <textarea
                className="d-textarea"
                value={note}
                aria-label="Note for the client"
                placeholder="High floor, canal view. Price from the developer list of 10 Nov."
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <div className="d-banner">
            <Icon name="info" />
            <span className="d-grow">
              It is saved as a draft. Nothing goes to the client until you share the link
              yourself.
            </span>
          </div>

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        <div className="d-panel-foot">
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
          <span className="d-grow" />
          <button type="button" className="d-btn d-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save as draft'}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

/**
 * A price, in full.
 *
 * Used everywhere a figure belongs to one offer: the table, the sheet, the
 * WhatsApp message. "AED 2.0M" for a unit priced at 2,050,000 is a fifty
 * thousand dirham difference, and the sheet is a document a client will hold
 * the brokerage to.
 */
function money(aed: number | null | undefined): string {
  if (aed === null || aed === undefined) return '—';
  return `AED ${aed.toLocaleString('en-GB')}`;
}

/**
 * A total, rounded.
 *
 * Only for the four tiles across the top, where the design writes
 * "AED 20.9M" — a month's worth of offers added together is a sense of
 * scale, not a figure anybody quotes.
 */
function roughMoney(aed: number | null | undefined): string {
  if (aed === null || aed === undefined) return '—';
  if (aed < 1_000_000) return `AED ${aed.toLocaleString('en-GB')}`;
  const millions = aed / 1_000_000;
  return `AED ${millions >= 100 ? Math.round(millions) : millions.toFixed(1)}M`;
}

/** Dubai's date, N days from now, as a date input wants it. */
function inDays(n: number): string {
  return new Date(Date.now() + 4 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
}

function shortDate(at: string): string {
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function longDate(at: string): string {
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function ago(at: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / (60 * 24))} d ago`;
}

/** The agents who appear in what is on screen, for the owner's filter. */
function agentsIn(items: Sheet[]): Array<{ id: string; name: string }> {
  const seen = new Map<string, string>();
  for (const one of items) if (one.agentName) seen.set(one.agentUserId, one.agentName);
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
