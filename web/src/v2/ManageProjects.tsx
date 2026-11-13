import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote, useToast } from '../design/ui.js';

/**
 * Which projects the agents can see.
 *
 * `design/web/manage-projects.html`: one row per project, a status control
 * that says who sees it, the brochure, and the lead count.
 *
 * The design's three statuses map onto two columns that already exist, and
 * the mapping is the interesting part:
 *
 *  - **Selling now** and **Launching soon** are `projects.sale_status`, which
 *    is what the agents' library already shows as a pill.
 *  - **Hidden** is `archived_at`. It is not `visibility`, which says who a
 *    project may be shown to and has nothing behind it yet — `/api/library`
 *    leaves archived projects out for everybody, which is what makes "agents
 *    do not see it" true rather than a label. Archiving is also the thing
 *    CLAUDE.md asks us to offer instead of deleting, and it keeps the leads,
 *    the offers and the units.
 *
 * A project whose inventory is `sold_out` shows that as a chip and no status
 * is lit: it is a fact about the units, not a decision about who sees it, and
 * pressing one of the three buttons is how you change the decision.
 */

interface Row {
  id: string;
  slug: string | null;
  name: string;
  developer: string | null;
  emirate: string | null;
  community: string | null;
  sale_status: 'selling_now' | 'coming_soon' | 'sold_out' | null;
  starting_price_aed: number | null;
  payment_plan: string | null;
  handover_date: string | null;
  image_url: string | null;
  cover_photo_id: string | null;
  archived_at: string | null;
  starred: number;
  units_available: number;
  units_total: number;
  leads: number;
  brochure: { id: string; filename: string; byteSize: number } | null;
}

type Who = 'selling_now' | 'coming_soon' | 'hidden';

const WHO: Array<{ key: Who; label: string; says: string }> = [
  { key: 'selling_now', label: 'Selling now', says: 'agents see it and can send the brochure' },
  { key: 'coming_soon', label: 'Launching soon', says: 'agents see it with a “soon” tag' },
  { key: 'hidden', label: 'Hidden', says: 'agents do not see it' },
];

const EMIRATES = [
  { key: 'dubai', label: 'Dubai' },
  { key: 'abu_dhabi', label: 'Abu Dhabi' },
  { key: 'sharjah', label: 'Sharjah' },
  { key: 'ras_al_khaimah', label: 'Ras Al Khaimah' },
  { key: 'ajman', label: 'Ajman' },
  { key: 'other', label: 'Somewhere else' },
];

/** 30 MB, as the design's drop zone says. */
const MAX_BROCHURE_MB = 30;

export function V2ManageProjects() {
  const { user } = useAuth();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const got = useAsync<{ items: Row[] }>(() => api.get('/api/v2/projects/manage'), []);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* Hiding a project with leads on it asks twice, as the design does: the
     first press arms the button and says what will happen. */
  const [armed, setArmed] = useState<string | null>(null);
  const toast = useToast();

  const rows = got.data?.items ?? [];
  const counts = {
    selling_now: rows.filter((one) => whoSees(one) === 'selling_now').length,
    coming_soon: rows.filter((one) => whoSees(one) === 'coming_soon').length,
    hidden: rows.filter((one) => whoSees(one) === 'hidden').length,
  };

  async function setWho(row: Row, next: Who) {
    if (whoSees(row) === next) return;
    if (next === 'hidden' && row.leads > 0 && armed !== row.id) {
      setArmed(row.id);
      toast(
        `Press “Hidden” again to hide ${row.name}. Agents will not see it. `
        + `Its ${row.leads} ${row.leads === 1 ? 'lead stays' : 'leads stay'} as they are.`,
      );
      window.setTimeout(() => setArmed((was) => (was === row.id ? null : was)), 6000);
      return;
    }
    setArmed(null);
    setBusy(row.id);
    try {
      /* Two different writes behind three buttons: coming back from Hidden
         un-archives first, then sets the status the owner asked for. */
      if (next === 'hidden') {
        await api.post(`/api/library/${row.id}/archive`, { archived: true });
      } else {
        if (row.archived_at) await api.post(`/api/library/${row.id}/archive`, { archived: false });
        await api.patch(`/api/library/${row.id}`, { saleStatus: next });
      }
      const said = WHO.find((one) => one.key === next);
      toast(
        next === 'selling_now' && !row.brochure
          ? `${row.name} is now “Selling now” · agents see it, but there is no brochure yet.`
          : `${row.name} is now “${said?.label}” · ${said?.says}`,
      );
      got.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  if (!canManage) {
    return (
      <div className="p-manage-projects">
        <ErrorNote>Projects are managed by the owner. You can see them under Projects.</ErrorNote>
      </div>
    );
  }

  return (
    <div className="p-manage-projects">
      <div className="v2-page-head">
        <span className="v2-page-sub">
          Agents see only projects that are “Selling now” or “Launching soon”.
        </span>
        <span className="d-grow" />
        <Link className="d-btn" to="/v2/projects"><Icon name="eye" />See as an agent</Link>
        <Link className="d-btn" to="/v2/settings/banners">
          <Icon name="image-up" />Home banners
        </Link>
        <button type="button" className="d-btn d-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" />Add project
        </button>
      </div>

      <div className="d-tiles">
        {WHO.map((one) => (
          <section className="d-card" key={one.key}>
            <b className="d-num">{counts[one.key]}</b>
            <div>
              <b className="d-bold">{one.label}</b>
              <div className="d-small d-muted">
                {one.key === 'selling_now' && 'Agents can send brochures'}
                {one.key === 'coming_soon' && 'Shown with a “soon” tag'}
                {one.key === 'hidden' && 'Only owners and admin see it'}
              </div>
            </div>
          </section>
        ))}
      </div>

      {got.error && <ErrorNote>{got.error}</ErrorNote>}
      {!got.data && !got.error && <Spinner />}

      {rows.length > 0 && (
        <div className="d-table-wrap">
          <table className="d-table d-id-prj">
            <thead>
              <tr>
                <th>Project</th>
                <th>Starting from</th>
                <th>Brochure</th>
                <th className="d-t-right">Leads</th>
                <th>Status · who sees it</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const who = whoSees(row);
                return (
                  <tr key={row.id} className={who === 'hidden' ? 'd-hid' : undefined}>
                    <td>
                      <div className="d-row">
                        <span
                          className={`d-photo d-ph ${gradient(row.id)}`}
                          style={cover(row)}
                        />
                        <div>
                          <b className="d-t-main">{row.name}</b>
                          {row.sale_status === 'sold_out' && <span className="d-chip">Sold out</span>}
                          <div className="d-t-sub">
                            {[row.developer, row.community ?? emirateWord(row.emirate)]
                              .filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td>
                      <b>
                        {row.starting_price_aed
                          ? roughMoney(row.starting_price_aed)
                          : <span className="d-muted">Not set</span>}
                      </b>
                      {(row.payment_plan || row.handover_date) && (
                        <div className="d-t-sub">
                          {[row.payment_plan, handover(row.handover_date)]
                            .filter((one) => one && one !== '—').join(' · ')}
                        </div>
                      )}
                    </td>

                    <td>
                      <Brochure
                        row={row}
                        busy={busy === `file-${row.id}`}
                        onBusy={(on) => setBusy(on ? `file-${row.id}` : null)}
                        onDone={() => got.reload()}
                      />
                    </td>

                    <td className="d-t-right">
                      {row.leads > 0
                        ? (
                          <Link to={`/v2/leads?tab=all&project=${encodeURIComponent(row.name)}`}>
                            <b>{row.leads}</b>
                          </Link>
                        )
                        : <span className="d-muted">0</span>}
                    </td>

                    <td>
                      <div className="d-seg d-sm">
                        {WHO.map((one) => (
                          <button
                            key={one.key}
                            type="button"
                            disabled={busy === row.id}
                            aria-pressed={who === one.key}
                            className={who === one.key ? 'd-on' : undefined}
                            onClick={() => setWho(row, one.key)}
                          >
                            {one.key === 'hidden' && armed === row.id ? 'Again?' : one.label}
                          </button>
                        ))}
                      </div>
                    </td>

                    <td className="d-act">
                      <div className="d-row-actions d-show">
                        <button
                          type="button"
                          className="d-btn d-xs"
                          onClick={() => setEditing(row)}
                        >
                          <Icon name="pencil" />Edit
                        </button>
                        <Link className="d-btn d-xs" to={`/v2/projects/${row.id}`}>
                          <Icon name="eye" />View
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {got.data && rows.length === 0 && (
        <div className="d-card">
          <div className="d-empty">
            <span className="d-ic"><Icon name="building" /></span>
            <b>No projects yet</b>
            <p>Add the first one. It starts hidden, so nothing reaches a client until you say so.</p>
            <button type="button" className="d-btn d-sm d-primary" onClick={() => setEditing('new')}>
              <Icon name="plus" />Add project
            </button>
          </div>
        </div>
      )}

      <p className="d-small d-muted d-mt-12">
        Hiding a project archives it: the leads, the sales offers already sent and the units all
        stay. Prices, plans and handover dates live on the project itself — everything an agent
        quotes comes from there.
      </p>

      {editing && (
        <ProjectPanel
          row={editing}
          rows={rows}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); got.reload(); }}
        />
      )}
    </div>
  );
}

/* ── the brochure cell ─────────────────────────────────────────────────── */

function Brochure({
  row, busy, onBusy, onDone,
}: { row: Row; busy: boolean; onBusy: (on: boolean) => void; onDone: () => void }) {
  const pick = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      toast('Only a PDF file can be a brochure.');
      return;
    }
    if (file.size > MAX_BROCHURE_MB * 1024 * 1024) {
      toast(`That file is bigger than ${MAX_BROCHURE_MB} MB. Make it smaller and try again.`);
      return;
    }
    onBusy(true);
    try {
      await api.upload(`/api/library/${row.id}/documents`, file, { 'X-Kind': 'brochure_en' });
      toast(`${file.name} is on ${row.name}`);
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That did not upload.');
    } finally {
      onBusy(false);
      if (pick.current) pick.current.value = '';
    }
  }

  return (
    <>
      <input
        type="file"
        accept=".pdf"
        ref={pick}
        hidden
        aria-label={`Brochure for ${row.name}`}
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      {row.brochure
        ? (
          <>
            <a
              className="d-chip d-green"
              href={`/api/library/documents/${row.brochure.id}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="file-text" />PDF
            </a>{' '}
            <span className="d-t-sub">{megabytes(row.brochure.byteSize)}</span>
          </>
        )
        : (
          <button
            type="button"
            className="d-btn d-xs"
            disabled={busy}
            onClick={() => pick.current?.click()}
          >
            <Icon name="upload" />{busy ? 'Uploading…' : 'Upload'}
          </button>
        )}
    </>
  );
}

/* ── add and edit ──────────────────────────────────────────────────────── */

function ProjectPanel({
  row, rows, onClose, onSaved,
}: { row: Row | 'new'; rows: Row[]; onClose: () => void; onSaved: () => void }) {
  const making = row === 'new';
  const [name, setName] = useState(making ? '' : row.name);
  const [developer, setDeveloper] = useState(making ? '' : row.developer ?? '');
  const [emirate, setEmirate] = useState(making ? 'dubai' : row.emirate ?? 'dubai');
  const [area, setArea] = useState(making ? '' : row.community ?? '');
  const [price, setPrice] = useState(
    making || row.starting_price_aed === null ? '' : String(row.starting_price_aed),
  );
  const [who, setWho] = useState<Who>(making ? 'hidden' : whoSees(row));
  const [file, setFile] = useState<File | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  const priceAed = Number(price.replace(/[^\d]/g, ''));
  const taken = rows
    .filter((one) => making || one.id !== row.id)
    .some((one) => one.name.trim().toLowerCase() === name.trim().toLowerCase());

  const problems: Record<string, string> = {};
  if (name.trim().length < 2) problems.name = 'Write the project name.';
  else if (taken) problems.name = 'There is already a project with this name.';
  if (developer.trim().length < 2) problems.developer = 'Write the developer.';
  if (price.trim() && !priceAed) problems.price = 'Write a number, like 1600000.';
  const show = (key: string) => (touched ? problems[key] : undefined);

  async function save() {
    setTouched(true);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        developer: developer.trim(),
        emirate,
        community: area.trim() || null,
        startingPriceAed: priceAed || null,
      };
      /* Hidden says nothing about the inventory, so it leaves `sale_status`
         alone: a sold-out project that is hidden and shown again is still
         sold out. A brand-new hidden one has no status to keep. */
      if (who !== 'hidden') body.saleStatus = who;
      else if (making) body.saleStatus = 'coming_soon';

      const id = making
        ? (await api.post<{ id: string }>('/api/library', body)).id
        : row.id;
      if (!making) await api.patch(`/api/library/${row.id}`, body);

      /* Hidden is archived, and that is a separate call. A new project is
         archived straight away when it is meant to be hidden, so nothing
         reaches an agent in the second between the two writes. */
      const wasHidden = making ? false : Boolean(row.archived_at);
      if (who === 'hidden' && !wasHidden) {
        await api.post(`/api/library/${id}/archive`, { archived: true });
      }
      if (who !== 'hidden' && wasHidden) {
        await api.post(`/api/library/${id}/archive`, { archived: false });
      }

      /* The brochure needs the project to exist, so it goes last. */
      if (file) {
        await api.upload(`/api/library/${id}/documents`, file, { 'X-Kind': 'brochure_en' });
      }

      toast(making ? `${body.name} is added · ${WHO.find((one) => one.key === who)?.label}` : `${body.name} is saved`);
      onSaved();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="v2-panel-back" onClick={onClose} aria-hidden />
      <aside className="d-panel d-open" aria-label="Project">
        <div className="d-panel-head">
          <h2>{making ? 'Add project' : `Edit ${row.name}`}</h2>
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
          <div className="d-field">
            <label htmlFor="pr-name">Project name <span className="d-req">*</span></label>
            <input
              id="pr-name"
              className="d-input"
              value={name}
              placeholder="Sei Saadiyat"
              onChange={(e) => setName(e.target.value)}
            />
            {show('name') && <span className="v2-field-error">{show('name')}</span>}
          </div>

          <div className="d-field">
            <label htmlFor="pr-dev">Developer <span className="d-req">*</span></label>
            <input
              id="pr-dev"
              className="d-input"
              value={developer}
              placeholder="Aldar"
              onChange={(e) => setDeveloper(e.target.value)}
            />
            {show('developer') && <span className="v2-field-error">{show('developer')}</span>}
          </div>

          <div className="d-form-grid">
            <div className="d-field">
              {/* Not in the design's panel, and the library cannot store a
                  project without it. Two of these are what we sell. */}
              <label htmlFor="pr-emirate">Emirate</label>
              <select
                id="pr-emirate"
                className="d-select"
                value={emirate}
                onChange={(e) => setEmirate(e.target.value)}
              >
                {EMIRATES.map((one) => (
                  <option key={one.key} value={one.key}>{one.label}</option>
                ))}
              </select>
            </div>

            <div className="d-field">
              <label htmlFor="pr-area">Area</label>
              <input
                id="pr-area"
                className="d-input"
                value={area}
                placeholder="Saadiyat Island"
                onChange={(e) => setArea(e.target.value)}
              />
            </div>

            <div className="d-field">
              <label htmlFor="pr-price">Starting price in AED</label>
              <div className="d-input-icon">
                <Icon name="banknote" />
                <input
                  id="pr-price"
                  className="d-input"
                  value={price}
                  inputMode="numeric"
                  placeholder="1600000"
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
              {show('price')
                ? <span className="v2-field-error">{show('price')}</span>
                : (
                  <span className="d-hint">
                    {priceAed ? roughMoney(priceAed) : 'Leave it empty until the price list is in.'}
                  </span>
                )}
            </div>
          </div>

          <div className="d-field">
            <span className="d-field-label">Brochure</span>
            <label className={file ? 'd-up d-has' : 'd-up'}>
              <span className="d-card-icon"><Icon name="file-text" /></span>
              <span className="d-grow">
                <b className="d-bold">{file ? file.name : 'Upload brochure'}</b>
                <div className="d-small d-muted">
                  {file ? `${megabytes(file.size)} · ready` : `PDF · up to ${MAX_BROCHURE_MB} MB`}
                </div>
              </span>
              <input
                type="file"
                accept=".pdf"
                hidden
                aria-label="Brochure"
                onChange={(e) => {
                  const picked = e.target.files?.[0];
                  if (!picked) return;
                  if (!/\.pdf$/i.test(picked.name)) {
                    setProblem('Only a PDF file can be a brochure.');
                    return;
                  }
                  if (picked.size > MAX_BROCHURE_MB * 1024 * 1024) {
                    setProblem(`That file is bigger than ${MAX_BROCHURE_MB} MB.`);
                    return;
                  }
                  setProblem(null);
                  setFile(picked);
                }}
              />
              <span className="d-btn d-sm">Choose file</span>
            </label>
            {!making && row.brochure && !file && (
              <span className="d-hint">
                {row.brochure.filename} is on this project. Choosing a file adds another.
              </span>
            )}
          </div>

          <div className="d-field">
            <span className="d-field-label">Status · who sees it</span>
            <div className="d-seg d-block">
              {WHO.map((one) => (
                <button
                  key={one.key}
                  type="button"
                  aria-pressed={who === one.key}
                  className={who === one.key ? 'd-on' : undefined}
                  onClick={() => setWho(one.key)}
                >
                  {one.label}
                </button>
              ))}
            </div>
            <span className="d-hint">
              {making
                ? 'A new project starts Hidden. Agents see it when you choose “Selling now” or “Launching soon”.'
                : WHO.find((one) => one.key === who)?.says}
            </span>
          </div>

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>

        <div className="d-panel-foot">
          {!making && (
            <Link className="d-btn" to={`/v2/projects/${row.id}`}>Open the project</Link>
          )}
          <span className="d-grow" />
          <button type="button" className="d-btn d-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="d-btn d-primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save project'}
          </button>
        </div>
      </aside>
    </>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

/** Which of the three the row is in. Archived wins: it is the one that hides. */
function whoSees(row: Row): Who {
  if (row.archived_at) return 'hidden';
  return row.sale_status === 'coming_soon' ? 'coming_soon' : 'selling_now';
}

function cover(row: Row): React.CSSProperties | undefined {
  const photo = row.cover_photo_id ? `/api/library/photos/${row.cover_photo_id}` : row.image_url;
  return photo ? { backgroundImage: `url(${photo})`, backgroundSize: 'cover' } : undefined;
}

/** Stable from the id, so a project keeps the same placeholder every time. */
function gradient(id: string): string {
  let sum = 0;
  for (const letter of id) sum += letter.charCodeAt(0);
  const pick = sum % 5;
  return pick === 0 ? '' : `d-p${pick + 1}`;
}

/** "AED 1.6M", "AED 940,000" — the way an agent says a starting price. */
function roughMoney(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `AED ${millions.toFixed(millions % 1 === 0 ? 0 : 1)}M`;
  }
  return `AED ${value.toLocaleString('en-GB')}`;
}

function megabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_048_576))} MB`;
}

/** The handover, however it was stored — developers quote quarters. */
function handover(value: string | null): string {
  if (!value) return '—';
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  return new Date(value).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function emirateWord(value: string | null): string | null {
  if (!value) return null;
  return EMIRATES.find((one) => one.key === value)?.label ?? value;
}
