import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { ErrorNote, Spinner, useToast } from '../design/ui.js';
import { formatDateTime } from '../lib/format.js';
import { usePhoneHead } from './phone.js';

/** §4 of `docs/v2/phone-shell.md`: under this, the phone layout. */
const PHONE = 768;

/** Whether this is a phone, in the component and not only in CSS. */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${PHONE - 1}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${PHONE - 1}px)`);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

/**
 * WhatsApp templates.
 *
 * Ported from `design/web/templates.html`: a grid of cards, each with the text
 * and whether Meta has approved it, and a panel showing it as a WhatsApp
 * bubble.
 *
 * The groups on the design's tabs — Hello, Meeting, Brochure and links — do
 * not exist anywhere in the CRM. Meta's own grouping does, and it is the one
 * that decides what a template may be used for: MARKETING, UTILITY,
 * AUTHENTICATION. So the tabs are Meta's categories, which also means the
 * counts are real.
 *
 * Why this screen matters: outside the 24-hour window a template Meta has
 * approved is the only thing that can reach a client on WhatsApp. A paused or
 * rejected template is a follow-up that silently did not happen, which is why
 * the status is the loudest thing on each card.
 *
 * Two reads, merged. `GET /api/templates` is what Meta says about each one
 * today — the status, the quality score, when it was last checked. The text
 * lives in the `components` column, and a template that has never been synced
 * has none, so `GET /api/templates/library` fills the gap with the definition
 * the CRM would submit. Neither invents anything.
 */

interface TemplateRow {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  provider_template_id: string | null;
  components: unknown;
  quality_score: string | null;
  rejected_reason: string | null;
  last_synced_at: string | null;
}

interface LibraryRow {
  name: string;
  language: string;
  category: string;
  components: Component[];
  validation?: { valid: boolean; issues: Array<{ field: string; message: string }> };
}

interface Component {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: string;
  text?: string;
  example?: { body_text?: string[][]; header_handle?: string[] };
  buttons?: Array<{ type: string; text: string; payload?: string }>;
}

/** One template, after the two reads have been put together. */
interface Card {
  id: string;
  name: string;
  title: string;
  language: string;
  category: string;
  status: string;
  body: string | null;
  footer: string | null;
  header: string | null;
  buttons: string[];
  /** The example values Meta was given, used to fill the preview bubble. */
  example: string[];
  qualityScore: string | null;
  rejectedReason: string | null;
  lastSyncedAt: string | null;
  problems: string[];
}

const LANGUAGE: Record<string, string> = { en: 'English', ar: 'Arabic', ru: 'Russian', hi: 'Hindi' };

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Service',
  AUTHENTICATION: 'Codes',
};

export function V2Templates() {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const toast = useToast();

  const [category, setCategory] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const phone = useIsPhone();
  const [syncing, setSyncing] = useState(false);

  const live = useAsync<{ items: TemplateRow[]; blocked: number }>(() => api.get('/api/templates'), []);
  const library = useAsync<{ items: LibraryRow[] }>(() => api.get('/api/templates/library'), []);

  const cards = useMemo(
    () => merge(live.data?.items ?? [], library.data?.items ?? []),
    [live.data, library.data],
  );

  const tabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const one of cards) counts.set(one.category, (counts.get(one.category) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [cards]);

  const shown = category ? cards.filter((one) => one.category === category) : cards;
  const approved = cards.filter((one) => one.status === 'APPROVED').length;
  const open = cards.find((one) => one.id === openId) ?? null;

  /* §1.4. `Templates.dc.html` centres "WhatsApp templates" over "Messages
     agents send in one tap", and puts the count on the list's own header
     ("16 TEMPLATES") rather than under the title. */
  usePhoneHead({
    compact: true,
    title: 'WhatsApp templates',
    sub: 'Messages agents send in one tap',
  });

  async function sync() {
    setSyncing(true);
    try {
      const result = await api.post<{ synced: number; newlyBroken: unknown[] }>('/api/templates/sync', {});
      toast(`Checked ${result.synced} with WhatsApp`);
      live.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'WhatsApp would not answer.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="v2-templates p-templates">
      <div className="d-row d-mb-16 d-wrap">
        <div className="d-tabs d-pills v2-tp-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={category === ''}
            className={category === '' ? 'd-tab d-on' : 'd-tab'}
            onClick={() => setCategory('')}
          >
            All <span className="d-count">{cards.length}</span>
          </button>
          {tabs.map(([key, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={category === key}
              className={category === key ? 'd-tab d-on' : 'd-tab'}
              onClick={() => setCategory(key)}
            >
              {CATEGORY_LABEL[key] ?? key} <span className="d-count">{count}</span>
            </button>
          ))}
        </div>
        <span className="d-grow" />
        {canManage && (
          <button type="button" className="d-btn" disabled={syncing} onClick={() => void sync()}>
            <Icon name="refresh-cw" />{syncing ? 'Checking…' : 'Check with WhatsApp'}
          </button>
        )}
      </div>

      {live.error && <ErrorNote>{live.error}</ErrorNote>}
      {!live.data && !live.error && <Spinner />}

      {/* `Templates.dc.html` opens with this, in a green box, because it is
          the one rule an agent has to hold in their head when they pick a
          template. The computer design says it at the foot instead, which is
          where the build already has it — on a phone nobody scrolls to it. */}
      {phone && live.data && cards.length > 0 && (
        <p className="v2-tp-rule">
          Templates with a <b>green</b> tag are approved by Meta and can be sent any
          time. Others work only inside 24 h after the client writes to you.
        </p>
      )}

      {phone && shown.length > 0 && (
        <div className="v2-tp-count">
          {shown.length} template{shown.length === 1 ? '' : 's'}
        </div>
      )}

      {live.data && cards.length === 0 && (
        <div className="d-empty">
          <span className="d-ic"><Icon name="files" /></span>
          <b>No templates yet</b>
          <p>
            The CRM has sixteen ready to submit. They appear here once the WhatsApp
            Business account is connected and they have been sent for approval.
          </p>
        </div>
      )}

      {shown.length > 0 && (
        <div className="d-tp-grid">
          {shown.map((one) => (
            <button key={one.id} type="button" className="d-tp" onClick={() => setOpenId(one.id)}>
              <span className="d-row d-gap-6">
                <b className="d-grow d-truncate">{one.title}</b>
                <span className="d-chip">{one.language.toUpperCase()}</span>
              </span>
              <span className="d-tp-body" dir={one.language === 'ar' ? 'rtl' : 'ltr'}>
                {/* The four-line clamp lives on this inner span, not on the
                    bubble. `.d-tp` is a flex column, so the bubble is a flex
                    item and the browser blockifies it — which throws away
                    `display:-webkit-box` and with it the clamp's effect on
                    layout, leaving half a fifth line showing under the
                    ellipsis. Inside the bubble it is an ordinary block and
                    the clamp works. */}
                <span className="v2-tp-clamp">
                  {one.body
                    ? <Marked text={one.body} example={one.example} />
                    : <span className="d-muted">No text yet — it arrives with the next check.</span>}
                </span>
              </span>
              <span className="d-row d-gap-6">
                <StatusChip status={one.status} />
                <span className="d-grow" />
                <span className="d-tiny d-muted">{CATEGORY_LABEL[one.category] ?? one.category}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {live.data && cards.length > 0 && (
        <p className="d-small d-muted d-mt-16">
          {approved} approved · {cards.length - approved} waiting or blocked at WhatsApp.
          The highlighted words are filled in from the lead — these are the examples
          WhatsApp was given. Only an approved template can go out more than 24 hours
          after a client last wrote.
        </p>
      )}

      {open && <Panel card={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* ── the pieces ────────────────────────────────────────────────────────── */

function StatusChip({ status }: { status: string }) {
  if (status === 'APPROVED') return <span className="d-chip d-green d-pip">Approved</span>;
  if (status === 'PENDING') return <span className="d-chip d-amber d-pip">In review</span>;
  if (status === 'DRAFT') return <span className="d-chip d-pip">Not submitted</span>;
  if (status === 'PAUSED') return <span className="d-chip d-amber d-pip">Paused by WhatsApp</span>;
  if (status === 'REJECTED') return <span className="d-chip d-red d-pip">Rejected</span>;
  return <span className="d-chip d-red d-pip">Cannot be sent</span>;
}

function Panel({ card, onClose }: { card: Card; onClose: () => void }) {
  const toast = useToast();
  const rtl = card.language === 'ar';
  const preview = card.body ? fill(card.body, card.example) : '';

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label={card.title}>
        <div className="d-panel-head">
          <h2>{card.title}</h2>
          <StatusChip status={card.status} />
          <button type="button" className="d-btn d-icon d-sm d-ghost" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        <div className="d-panel-body d-col d-gap-16">
          <div className="d-tp-phone">
            {card.header && <span className="v2-tp-header">{card.header}</span>}
            <div className="d-tp-bub" dir={rtl ? 'rtl' : 'ltr'}>{preview || '—'}</div>
            {card.buttons.length > 0 && (
              <span className="v2-tp-buttons">
                {card.buttons.map((label) => <span key={label}>{label}</span>)}
              </span>
            )}
            <span className="d-tiny v2-tp-tick">Sent ✓✓</span>
          </div>
          <div className="d-small d-muted">
            Filled in with the example WhatsApp was given when the template was submitted.
          </div>

          {card.status !== 'APPROVED' && (
            <div className="d-banner d-amber">
              <Icon name="alert-triangle" />
              <span className="d-grow">
                {card.rejectedReason
                  ?? 'Until WhatsApp approves this, it cannot be sent outside the 24-hour window.'}
              </span>
            </div>
          )}

          {card.problems.length > 0 && (
            <div className="d-banner d-red">
              <Icon name="circle-alert" />
              <span className="d-grow">{card.problems.join(' · ')}</span>
            </div>
          )}

          <div className="d-field">
            <label htmlFor="v2-tp-text">Text</label>
            <textarea
              id="v2-tp-text"
              className="d-textarea v2-tp-text"
              readOnly
              dir={rtl ? 'rtl' : 'ltr'}
              value={card.body ?? ''}
            />
            <span className="d-hint">
              Changing a template means asking WhatsApp to approve it again, so it is edited
              in the code and submitted, never typed here.
            </span>
          </div>

          <dl className="d-kv">
            <Kv term="Name at WhatsApp" value={card.name} />
            <Kv term="Group" value={CATEGORY_LABEL[card.category] ?? card.category} />
            <Kv term="Language" value={LANGUAGE[card.language] ?? card.language} />
            <Kv term="Quality" value={card.qualityScore} />
            <Kv term="Last checked" value={card.lastSyncedAt ? formatDateTime(card.lastSyncedAt) : null} />
            <Kv term="Footer" value={card.footer} />
          </dl>
        </div>

        <div className="d-panel-foot">
          <button
            type="button"
            className="d-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(preview);
              toast('Text copied.');
            }}
          >
            <Icon name="copy" />Copy the text
          </button>
          <span className="d-grow" />
          <button type="button" className="d-btn" onClick={onClose}>Close</button>
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

/**
 * The template as it will read, with the blanks marked.
 *
 * Meta numbers its variables — `{{1}}`, `{{2}}` — which tells an agent
 * nothing. The example WhatsApp was given with the template does, so the card
 * shows that word highlighted instead of the digit. The raw text with the
 * numbers in it is on the panel, where it belongs.
 */
function Marked({ text, example }: { text: string; example: string[] }) {
  const parts = text.split(/(\{\{\d+\}\})/);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\{\{(\d+)\}\}$/.exec(part);
        if (!match) return <Fragment key={i}>{part}</Fragment>;
        const index = Number(match[1]);
        return <mark key={i}>{example[index - 1] ?? index}</mark>;
      })}
    </>
  );
}

/* ── putting the two reads together ────────────────────────────────────── */

function merge(rows: TemplateRow[], library: LibraryRow[]): Card[] {
  const byKey = new Map(library.map((one) => [`${one.name}|${one.language}`, one]));
  const seen = new Set<string>();
  const cards: Card[] = [];

  for (const row of rows) {
    const key = `${row.name}|${row.language}`;
    seen.add(key);
    const definition = byKey.get(key);
    const components = parseComponents(row.components) ?? definition?.components ?? [];
    cards.push(cardFrom({
      id: row.id,
      name: row.name,
      language: row.language,
      category: row.category,
      status: row.status,
      components,
      qualityScore: row.quality_score,
      rejectedReason: row.rejected_reason,
      lastSyncedAt: row.last_synced_at,
      problems: (definition?.validation?.issues ?? []).map((one) => one.message),
    }));
  }

  /* A template the CRM would submit but which WhatsApp has never heard of.
     Showing it as a draft is the difference between "we have sixteen" and
     "sixteen are live", which is a fortnight of review apart. */
  for (const definition of library) {
    const key = `${definition.name}|${definition.language}`;
    if (seen.has(key)) continue;
    cards.push(cardFrom({
      id: `lib-${key}`,
      name: definition.name,
      language: definition.language,
      category: definition.category,
      status: 'DRAFT',
      components: definition.components,
      qualityScore: null,
      rejectedReason: null,
      lastSyncedAt: null,
      problems: (definition.validation?.issues ?? []).map((one) => one.message),
    }));
  }

  return cards.sort((a, b) => a.title.localeCompare(b.title) || a.language.localeCompare(b.language));
}

function cardFrom(input: {
  id: string; name: string; language: string; category: string; status: string;
  components: Component[]; qualityScore: string | null; rejectedReason: string | null;
  lastSyncedAt: string | null; problems: string[];
}): Card {
  const body = input.components.find((one) => one.type === 'BODY');
  const footer = input.components.find((one) => one.type === 'FOOTER');
  const header = input.components.find((one) => one.type === 'HEADER');
  const buttons = input.components.find((one) => one.type === 'BUTTONS');

  return {
    id: input.id,
    name: input.name,
    title: friendly(input.name),
    language: input.language,
    category: input.category,
    status: input.status,
    body: body?.text ?? null,
    footer: footer?.text ?? null,
    header: header ? headerLabel(header) : null,
    buttons: (buttons?.buttons ?? []).map((one) => one.text),
    example: body?.example?.body_text?.[0] ?? [],
    qualityScore: input.qualityScore,
    rejectedReason: input.rejectedReason,
    lastSyncedAt: input.lastSyncedAt,
    problems: input.problems,
  };
}

function headerLabel(header: Component): string {
  if (header.text) return header.text;
  const format = (header.format ?? 'TEXT').toLowerCase();
  if (format === 'document') return 'A document on top — the project brochure';
  if (format === 'image') return 'A picture on top';
  if (format === 'video') return 'A video on top';
  return 'A line on top';
}

function parseComponents(value: unknown): Component[] | null {
  if (Array.isArray(value)) return value as Component[];
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as Component[]) : null;
  } catch {
    return null;
  }
}

/**
 * `lead_welcome_en` → "Lead welcome".
 *
 * The name Meta knows is on the panel; the cards read better with words. The
 * language suffix comes off because the chip beside it already says EN.
 */
function friendly(name: string): string {
  const words = name.replace(/_(en|ar|ru|hi)$/i, '').replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `{{1}}` filled with the example that was submitted with the template. */
function fill(body: string, example: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (whole, index: string) => {
    const value = example[Number(index) - 1];
    return value ?? whole;
  });
}
