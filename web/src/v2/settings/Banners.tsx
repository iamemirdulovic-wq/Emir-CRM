import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { Icon } from '../../design/index.js';
import { Spinner, ErrorNote, useToast } from '../../design/ui.js';
import { usePhoneHead } from '../phone.js';

/**
 * Settings → Home banners.
 *
 * Built from `design/web/home-banners.html`: a live preview of what an agent
 * will see, the list of banners in the order they take turns in, and the form
 * beside it.
 *
 * Five is the limit and the server enforces it, not just this screen. Six
 * banners rotating is not five plus one — it is a carousel nobody waits
 * through, and the sixth is the one nobody ever sees.
 *
 * "seen by 9 of 10" is a real count: one row per person the first time they
 * are shown a banner (`banner_views`, written by My Day). An owner writing to
 * the whole office deserves to know whether the office read it, and before
 * this nothing counted.
 *
 * This page is **not** inside the settings shell, because the design is not:
 * `design/web/home-banners.html` is a standalone page with
 * `data-back="projects.html|Projects"`, and the preview beside the form needs
 * the width — the design lays it out at `1fr / 500px`.
 */

interface Desk {
  id: string;
  name: string;
}

interface Banner {
  id: string;
  title: string;
  label: string;
  body: string | null;
  buttonText: string | null;
  opens: string;
  audience: 'everyone' | 'agents' | 'desk';
  deskId: string | null;
  deskName: string | null;
  linkUrl: string | null;
  imagePath: string | null;
  startsAt: string | null;
  endsAt: string | null;
  position: number;
  isActive: boolean;
  state: 'Live' | 'Scheduled' | 'Ended';
  seenBy: number;
  audienceSize: number;
}

interface Answer {
  items: Banner[];
  desks: { items?: Desk[] } | Desk[];
  labels: string[];
  opens: string[];
  max: number;
  rotateSeconds: number;
}

/**
 * The five cover styles.
 *
 * The design names them after four of the brokerage's own projects and a
 * "Plain". Nothing here knows which project a banner is about, so naming them
 * would be putting a project's name on a coloured rectangle that has nothing
 * to do with it — so they are numbered, and Upload is how a real photograph
 * of a real project gets on a banner. `docs/decisions-to-confirm.md`.
 */
const COVERS = ['', 'p2', 'p3', 'p4', 'p5'];

const AUDIENCES = [
  { value: 'everyone' as const, label: 'Everyone' },
  { value: 'agents' as const, label: 'Agents' },
  { value: 'desk' as const, label: 'One desk' },
];

interface Draft {
  title: string;
  label: string;
  body: string;
  buttonText: string;
  opens: string;
  linkUrl: string;
  startsAt: string;
  endsAt: string;
  audience: 'everyone' | 'agents' | 'desk';
  deskId: string;
  cover: string;
}

const EMPTY: Draft = {
  title: '', label: 'From Emir', body: '', buttonText: '', opens: 'Project page',
  linkUrl: '', startsAt: '', endsAt: '', audience: 'everyone', deskId: '', cover: '',
};

export function V2SettingsBanners() {
  const got = useAsync<Answer>(() => api.get('/api/v2/banners'), []);
  /** `null` is "a new one", which is what the New banner button opens. */
  const [editing, setEditing] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const toast = useToast();

  usePhoneHead({
    title: 'Home banners',
    sub: "The banners at the top of every agent's My Day.",
  });

  const banners = got.data?.items ?? [];
  const max = got.data?.max ?? 5;
  const desks = Array.isArray(got.data?.desks) ? got.data.desks : (got.data?.desks?.items ?? []);
  /* A banner that has ended does not count against the five: the limit is on
     what is rotating, not on what was ever written. */
  const used = banners.filter((one) => one.state !== 'Ended').length;
  const chosen = banners.find((one) => one.id === editing) ?? null;

  /* The first banner is the one the page opens on, as the design does. */
  useEffect(() => {
    if (!got.data || editing !== null || isNew) return;
    const first = got.data.items[0];
    if (first) { setEditing(first.id); setDraft(draftOf(first)); }
  }, [got.data, editing, isNew]);

  useEffect(() => {
    if (!confirming) return undefined;
    const timer = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  if (got.error) {
    return <div className="p-banners"><ErrorNote>{got.error}</ErrorNote></div>;
  }
  if (!got.data) {
    return <div className="p-banners"><Spinner /></div>;
  }

  function openOne(one: Banner) {
    setEditing(one.id);
    setIsNew(false);
    setDraft(draftOf(one));
    setProblem(null);
    setConfirming(false);
  }

  function openNew() {
    setEditing(null);
    setIsNew(true);
    setDraft({ ...EMPTY, startsAt: today() });
    setConfirming(false);
    setProblem(used >= max
      ? `You already have ${max} banners. Remove one or let one end first.`
      : null);
  }

  /** Every rule the design's own form checks before it will publish. */
  function wrong(): string | null {
    if (draft.title.trim().length < 2) return 'Write a title.';
    if (draft.endsAt && draft.startsAt && draft.endsAt < draft.startsAt) {
      return '“Until” is before “Show from”. Choose a later day.';
    }
    if (isNew && draft.startsAt && draft.startsAt < today()) return 'The start day is in the past.';
    if (draft.opens === 'A web link' && !/^https:\/\/\S+\.\S+/.test(draft.linkUrl.trim())) {
      return 'Write the full web link. It starts with https://';
    }
    if (draft.audience === 'desk' && !draft.deskId) return 'Choose a desk.';
    if (isNew && used >= max) {
      return `You can have ${max} banners. Remove one or let one end first.`;
    }
    return null;
  }

  async function save() {
    const bad = wrong();
    setProblem(bad);
    if (bad) return;
    setBusy(true);
    try {
      const body = {
        title: draft.title.trim(),
        label: draft.label,
        body: draft.body.trim() || null,
        buttonText: draft.buttonText.trim() || null,
        opens: draft.opens,
        audience: draft.audience,
        deskId: draft.audience === 'desk' ? draft.deskId : null,
        linkUrl: draft.opens === 'A web link' ? draft.linkUrl.trim() : null,
        startsAt: draft.startsAt || null,
        endsAt: draft.endsAt || null,
      };
      const saved = isNew
        ? await api.post<Banner>('/api/v2/banners', body)
        : await api.patch<Banner>(`/api/v2/banners/${chosen?.id}`, body);
      toast(saved.state === 'Scheduled'
        ? `Banner saved · it starts ${shortDate(saved.startsAt)}`
        : saved.state === 'Ended' ? 'Banner saved · it has ended'
          : 'Banner is live on My Day');
      setIsNew(false);
      setEditing(saved.id);
      setProblem(null);
      got.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!chosen) return;
    if (!confirming) { setConfirming(true); return; }
    setConfirming(false);
    try {
      await api.del(`/api/v2/banners/${chosen.id}`);
      toast('Banner removed');
      setEditing(null);
      setIsNew(false);
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not delete.');
    }
  }

  async function uploadPicture(file: File) {
    if (!chosen) {
      setProblem('Publish the banner first, then add a picture to it.');
      return;
    }
    setBusy(true);
    try {
      await api.upload(`/api/v2/banners/${chosen.id}/image`, file);
      toast(`${file.name} · we cut it to 1200 × 500 px`);
      got.reload();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That picture was not accepted.');
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = '';
    }
  }

  /** Drag to reorder, which is what the design asks for. */
  async function drop(onto: Banner) {
    if (dragFrom === null) return;
    setDragOver(null);
    const order = banners.map((one) => one.id);
    const to = order.indexOf(onto.id);
    if (to === dragFrom) { setDragFrom(null); return; }
    const moved = order.splice(dragFrom, 1)[0] as string;
    order.splice(to, 0, moved);
    setDragFrom(null);
    try {
      await api.post('/api/v2/banners/order', { ids: order });
      toast('Order saved · agents see the new order now');
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    }
  }

  const picture = chosen?.imagePath ? `/api/v2/banners/${chosen.id}/image` : null;

  return (
    <div className="p-banners">
      <div className="v2-page-head">
        <span className="v2-page-sub">
          The banners at the top of every agent&apos;s My Day. Up to {max} · they change
          every {got.data.rotateSeconds} seconds.
        </span>
        <span className="d-grow" />
        <span className={used >= max ? 'd-chip d-lg d-amber' : 'd-chip d-lg'}>
          {used} of {max} used
        </span>
        <button type="button" className="d-btn" onClick={openNew}>
          <Icon name="plus" />New banner
        </button>
      </div>

      <div className="d-hb">
          {/* LEFT: preview + list */}
          <div className="d-col d-gap-16">
            <section className="d-card">
              <div className="d-card-head">
                <h3>Preview</h3>
                <span className="d-small d-muted">How agents see it · 1200 × 500 px</span>
              </div>
              <div
                className={`d-photo d-prev ${picture ? '' : coverClass(draft.cover)}`}
                style={picture ? { background: `url(${picture}) center/cover` } : undefined}
              >
                <span className="d-lab">{draft.label}</span>
                <h2>{draft.title.trim() || 'Your title shows here'}</h2>
                <p>{draft.body}</p>
                <span className="d-cta">{draft.buttonText}</span>
              </div>
            </section>

            <div className="d-row">
              <h3 className="d-grow">Your banners</h3>
              <span className="d-small d-muted">Drag to change the order</span>
            </div>

            <div className="d-col d-gap-8">
              {banners.length === 0 && (
                <p className="d-small d-muted">None yet. Write one on the right.</p>
              )}
              {banners.map((one, index) => (
                <div
                  key={one.id}
                  className={[
                    'd-bn',
                    one.id === editing ? 'd-on' : '',
                    one.state === 'Ended' ? 'd-ended' : '',
                    dragFrom === index ? 'd-drag' : '',
                    dragOver === one.id ? 'd-over' : '',
                  ].join(' ').replace(/\s+/g, ' ').trim()}
                  draggable
                  onClick={() => openOne(one)}
                  onDragStart={() => setDragFrom(index)}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(one.id); }}
                  onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                  onDrop={(e) => { e.preventDefault(); void drop(one); }}
                >
                  <span className="d-grip" aria-hidden><Icon name="more-horizontal" /></span>
                  <span
                    className={`d-photo ${one.imagePath ? '' : coverClass('')}`}
                    style={one.imagePath
                      ? { background: `url(/api/v2/banners/${one.id}/image) center/cover` }
                      : undefined}
                  />
                  <span className="d-grow">
                    <b>{one.title}</b>
                    <span>
                      {[
                        one.label,
                        dateRange(one.startsAt, one.endsAt),
                        audienceWord(one),
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {one.state === 'Live' && (
                    <span className="d-small d-muted d-nowrap">
                      seen by {Math.min(one.seenBy, one.audienceSize)} of {one.audienceSize}
                    </span>
                  )}
                  <span className={`d-chip ${
                    one.state === 'Live' ? 'd-green d-pip' : one.state === 'Scheduled' ? 'd-blue' : ''}`}
                  >
                    {one.state}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: the form */}
          <section className="d-card" aria-label="Banner form">
            <div className="d-card-head d-mb-0">
              <h3 className="d-grow">{isNew ? 'New banner' : 'Change banner'}</h3>
              {chosen && (
                <button
                  type="button"
                  className={confirming ? 'd-btn d-xs d-danger d-solid' : 'd-btn d-xs d-danger'}
                  onClick={() => void remove()}
                >
                  {confirming ? 'Tap again to remove' : 'Remove'}
                </button>
              )}
            </div>

            <div className="d-field">
              <span className="d-field-label">Picture</span>
              <div className="d-sw">
                {COVERS.map((cover, i) => (
                  <button
                    key={cover || 'first'}
                    type="button"
                    aria-label={i === COVERS.length - 1 ? 'Plain' : `Style ${i + 1}`}
                    className={[
                      'd-photo',
                      coverClass(cover),
                      !picture && draft.cover === cover ? 'd-on' : '',
                    ].join(' ').trim()}
                    onClick={() => setDraft((was) => ({ ...was, cover }))}
                  />
                ))}
                <button
                  type="button"
                  className="d-btn d-sm"
                  disabled={busy || !chosen}
                  onClick={() => picker.current?.click()}
                >
                  <Icon name="upload" />Upload
                </button>
              </div>
              <span className="d-hint">
                {chosen
                  ? 'Use a cover style or upload your own · 1200 × 500 px'
                  : 'Publish the banner first, then a picture can be uploaded to it.'}
              </span>
            </div>

            <div className="d-field">
              <span className="d-field-label">Label</span>
              <div className="d-chips">
                {got.data.labels.map((one) => (
                  <button
                    key={one}
                    type="button"
                    className={draft.label === one ? 'd-chip-opt d-on' : 'd-chip-opt'}
                    onClick={() => setDraft((was) => ({ ...was, label: one }))}
                  >
                    {one}
                  </button>
                ))}
              </div>
            </div>

            <div className="d-field">
              <label htmlFor="bn-title">Title <span className="d-req">*</span></label>
              <input
                id="bn-title"
                className="d-input"
                value={draft.title}
                maxLength={48}
                aria-label="Title"
                onChange={(e) => setDraft((was) => ({ ...was, title: e.target.value }))}
              />
            </div>

            <div className="d-field">
              <label htmlFor="bn-text">Short text</label>
              <input
                id="bn-text"
                className="d-input"
                value={draft.body}
                maxLength={90}
                aria-label="Short text"
                onChange={(e) => setDraft((was) => ({ ...was, body: e.target.value }))}
              />
            </div>

            <div className="d-form-grid">
              <div className="d-field">
                <label htmlFor="bn-btn">Button text</label>
                <input
                  id="bn-btn"
                  className="d-input"
                  value={draft.buttonText}
                  maxLength={22}
                  placeholder="See the plan"
                  aria-label="Button text"
                  onChange={(e) => setDraft((was) => ({ ...was, buttonText: e.target.value }))}
                />
              </div>
              <div className="d-field">
                <label htmlFor="bn-opens">Opens</label>
                <select
                  id="bn-opens"
                  className="d-select"
                  value={draft.opens}
                  onChange={(e) => setDraft((was) => ({ ...was, opens: e.target.value }))}
                >
                  {got.data.opens.map((one) => <option key={one} value={one}>{one}</option>)}
                </select>
              </div>
              {draft.opens === 'A web link' && (
                <div className="d-field d-full">
                  <label htmlFor="bn-url">Web link</label>
                  <div className="d-input-icon">
                    <Icon name="link" />
                    <input
                      id="bn-url"
                      className="d-input"
                      value={draft.linkUrl}
                      placeholder="https://"
                      aria-label="Web link"
                      onChange={(e) => setDraft((was) => ({ ...was, linkUrl: e.target.value }))}
                    />
                  </div>
                </div>
              )}
              <div className="d-field">
                <label htmlFor="bn-from">Show from</label>
                <input
                  id="bn-from"
                  className="d-input"
                  type="date"
                  value={draft.startsAt}
                  min={isNew ? today() : undefined}
                  aria-label="Show from"
                  onChange={(e) => setDraft((was) => ({ ...was, startsAt: e.target.value }))}
                />
              </div>
              <div className="d-field">
                <label htmlFor="bn-until">Until</label>
                <input
                  id="bn-until"
                  className="d-input"
                  type="date"
                  value={draft.endsAt}
                  min={draft.startsAt || today()}
                  aria-label="Until"
                  onChange={(e) => setDraft((was) => ({ ...was, endsAt: e.target.value }))}
                />
              </div>
            </div>

            <div className="d-field">
              <span className="d-field-label">Who sees it</span>
              <div className="d-row d-wrap d-gap-8">
                <div className="d-seg" role="group" aria-label="Who sees it">
                  {AUDIENCES.map((one) => (
                    <button
                      key={one.value}
                      type="button"
                      className={draft.audience === one.value ? 'd-on' : undefined}
                      onClick={() => setDraft((was) => ({ ...was, audience: one.value }))}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
                {draft.audience === 'desk' && (
                  <select
                    className="d-select d-sm v2-bn-desk"
                    value={draft.deskId}
                    aria-label="Which desk"
                    onChange={(e) => setDraft((was) => ({ ...was, deskId: e.target.value }))}
                  >
                    <option value="">Choose a desk…</option>
                    {desks.map((one) => <option key={one.id} value={one.id}>{one.name}</option>)}
                  </select>
                )}
              </div>
              {desks.length === 0 && draft.audience === 'desk' && (
                <span className="d-hint">
                  There are no desks yet. Make one under Settings → Desks.
                </span>
              )}
            </div>

            {problem && (
              <div className="d-banner d-red">
                <Icon name="alert-triangle" />
                <span className="d-grow">{problem}</span>
              </div>
            )}

            <div className="d-row d-mt-12">
              <span className="d-small d-muted d-grow">
                {isNew ? 'Agents see it from the start day.' : seenLine(chosen)}
              </span>
              <button
                type="button"
                className="d-btn d-primary"
                disabled={busy}
                onClick={() => void save()}
              >
                {busy ? 'Saving…' : isNew ? 'Publish' : 'Save and publish'}
              </button>
            </div>

            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              aria-label="Choose a picture"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadPicture(file);
              }}
            />
          </section>
      </div>
    </div>
  );
}

/* ── small helpers ────────────────────────────────────────────────────── */

function draftOf(one: Banner): Draft {
  return {
    title: one.title,
    label: one.label,
    body: one.body ?? '',
    buttonText: one.buttonText ?? '',
    opens: one.opens,
    linkUrl: one.linkUrl ?? '',
    startsAt: dateOnly(one.startsAt),
    endsAt: dateOnly(one.endsAt),
    audience: one.audience,
    deskId: one.deskId ?? '',
    cover: '',
  };
}

const coverClass = (cover: string) => (cover ? `d-${cover}` : '');

/** Dubai is UTC+4 with no daylight saving. */
function today(): string {
  return new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
}

function dateOnly(value: string | null): string {
  if (!value) return '';
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? String(value).slice(0, 10) : at.toISOString().slice(0, 10);
}

/** "9 Nov", as the design's own `d()` writes a day. */
function shortDate(value: string | null): string {
  const only = dateOnly(value);
  if (!only) return '';
  return new Date(`${only}T12:00:00Z`)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function dateRange(from: string | null, to: string | null): string {
  const a = shortDate(from);
  const b = shortDate(to);
  if (!a && !b) return 'Always';
  if (!b || a === b) return a || b;
  return `${a} – ${b}`;
}

function audienceWord(one: Banner): string {
  if (one.audience === 'agents') return 'Agents';
  if (one.audience === 'desk') return `One desk: ${one.deskName ?? 'not chosen'}`;
  return 'Everyone';
}

/** The line beside the Publish button, which says what state it is in. */
function seenLine(one: Banner | null): string {
  if (!one) return 'Agents see it from the start day.';
  if (one.state === 'Live') {
    return `Live now · seen by ${Math.min(one.seenBy, one.audienceSize)} of ${one.audienceSize}`;
  }
  if (one.state === 'Scheduled') return `Starts ${shortDate(one.startsAt)}`;
  return `Ended ${shortDate(one.endsAt)} · set new days to show it again`;
}
