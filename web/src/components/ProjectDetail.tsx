import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatAed, humanize } from '../lib/format.js';
import type { PaymentPlan, UnitRow, UnitStatus } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { Chip, Empty, ErrorNote, Field, Input, Modal, Note, Panel, Select, Spinner, Toolbar, useToast } from '../design/ui.js';
import { ProjectMedia } from './ProjectMedia.js';

type Detail = {
  project: Record<string, unknown>;
  units: UnitRow[];
  plans: PaymentPlan[];
  commission: Record<string, unknown> | null;
  location: Record<string, unknown> | null;
  amenities: { id: string; name: string; enabled: number }[];
};

type Tab = 'overview' | 'units' | 'plans' | 'media' | 'commission';

const UNIT_PILL: Record<UnitStatus, string> = {
  available: 'pill ok',
  on_hold: 'pill wait',
  reserved: 'pill info',
  sold: 'pill',
};

/**
 * One project.
 *
 * Five tabs are here; the spec lists eleven. The rest — floor plans,
 * amenities, location, developer, visibility — are the next slice. What is
 * here is what the WhatsApp replies and the offer builder read: the facts, the
 * inventory, the plans, the pictures and the commission.
 */
export function ProjectDetail({ projectId, onBack, onEdit }: {
  projectId: string;
  onBack: () => void;
  onEdit: (project: Record<string, unknown>) => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [addingUnits, setAddingUnits] = useState(false);
  const [addingPlan, setAddingPlan] = useState(false);

  const detail = useAsync<Detail>(() => api.get(`/api/library/${projectId}`), [projectId]);

  const canManage = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';

  if (detail.error) return <ErrorNote>{detail.error}</ErrorNote>;
  if (detail.loading && !detail.data) return <Spinner />;
  if (!detail.data) return null;

  const { project, units, plans, commission } = detail.data;
  const p = project as Record<string, string | number | null>;
  const available = units.filter((unit) => unit.status === 'available').length;

  async function verify(on: boolean) {
    try {
      await api.post(`/api/projects/${projectId}/${on ? 'verify' : 'unverify'}`);
      toast(on ? 'Verified — the WhatsApp replies can quote it now' : 'Marked unverified');
      detail.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change that');
    }
  }

  async function setStatus(unit: UnitRow, status: UnitStatus) {
    try {
      await api.post(`/api/library/units/${unit.id}/status`, { status });
      detail.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change the unit');
    }
  }

  return (
    <>
      <Toolbar
        right={
          canManage ? (
            <>
              <button type="button" className="btn" onClick={() => onEdit(project)}>
                <Icon name="pencil" size={15} />
                <span>Edit</span>
              </button>
              <button
                type="button"
                className={p.verified_at ? 'btn' : 'btn btn-primary'}
                onClick={() => void verify(!p.verified_at)}
              >
                <Icon name="shield-check" size={15} />
                <span>{p.verified_at ? 'Verified' : 'Verify'}</span>
              </button>
            </>
          ) : undefined
        }
      >
        <button type="button" className="chip" onClick={onBack}>
          <Icon name="chevron-left" size={14} />
          All projects
        </button>
        <Chip on={tab === 'overview'} onClick={() => setTab('overview')}>Overview</Chip>
        <Chip on={tab === 'units'} onClick={() => setTab('units')}>
          Units &amp; prices{units.length > 0 && <span className="n" style={{ marginInlineStart: 6, opacity: 0.75 }}>{units.length}</span>}
        </Chip>
        <Chip on={tab === 'plans'} onClick={() => setTab('plans')}>Payment plans</Chip>
        <Chip on={tab === 'media'} onClick={() => setTab('media')}>Photos &amp; documents</Chip>
        {canManage && <Chip on={tab === 'commission'} onClick={() => setTab('commission')}>Commission</Chip>}
      </Toolbar>

      {!p.verified_at && (
        <Note>
          Not verified yet, so the WhatsApp auto-replies will not quote this project. Check the price,
          handover and payment plan, then press Verify.
        </Note>
      )}

      {tab === 'overview' && (
        <Panel index={1} icon="building-2" title={String(p.name ?? '')}>
          <div className="stat-strip">
            <Stat label="Price from" value={p.starting_price_aed ? `AED ${formatAed(Number(p.starting_price_aed))}` : '—'} />
            <Stat label="Handover" value={String(p.handover_date ?? '—')} />
            <Stat label="Payment plan" value={String(p.payment_plan ?? '—')} />
            <Stat label="Units" value={units.length ? `${available} of ${units.length}` : '—'} />
            <Stat label="Construction" value={p.construction_pct !== null ? `${p.construction_pct}%` : '—'} />
            <Stat label="DLD number" value={String(p.rera_no ?? '—')} />
          </div>

          {p.description && <p style={{ marginTop: 16 }}>{String(p.description)}</p>}

          <div className="sec-t">Key facts</div>
          <dl className="facts">
            <dt>Developer</dt><dd>{String(p.developer ?? '—')}</dd>
            <dt>Emirate</dt><dd>{humanize(String(p.emirate ?? ''))}</dd>
            <dt>Community</dt><dd>{String(p.community ?? '—')}</dd>
            <dt>Type</dt><dd>{p.property_type ? humanize(String(p.property_type)) : '—'}</dd>
            <dt>Ownership</dt><dd>{p.ownership ? humanize(String(p.ownership)) : '—'}</dd>
            <dt>Service charge</dt><dd>{p.service_charge_sqft ? `AED ${p.service_charge_sqft} / sq ft` : '—'}</dd>
            <dt>Golden Visa</dt>
            <dd>
              {Number(p.golden_visa_eligible) === 1
                ? p.golden_visa_threshold_aed
                  ? `Yes, from AED ${formatAed(Number(p.golden_visa_threshold_aed))}`
                  : 'Yes'
                : 'No'}
            </dd>
          </dl>
        </Panel>
      )}

      {tab === 'units' && (
        <Panel
          index={1}
          icon="layout-grid"
          title="Units and prices"
          action={
            canManage ? (
              <button type="button" className="btn btn-primary" onClick={() => setAddingUnits(true)}>
                <Icon name="plus" size={15} />
                <span>Add units</span>
              </button>
            ) : undefined
          }
        >
          <Note>This table is the only price the CRM will ever quote. Nothing is calculated or guessed.</Note>

          {units.length === 0 ? (
            <Empty icon="layout-grid" title="No units yet" hint="Add the developer's price list to start quoting." />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Unit</th>
                    <th>Type</th>
                    <th className="col-wide">Floor</th>
                    <th className="col-wide">Area</th>
                    <th className="col-wider">View</th>
                    <th>Price</th>
                    <th className="col-wide">Per sq ft</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => (
                    <tr key={unit.id}>
                      <td><b>{unit.unit_no}</b></td>
                      <td>{unit.bedrooms !== null ? `${unit.bedrooms} BR` : unit.unit_type ?? '—'}</td>
                      <td className="col-wide">{unit.floor ?? '—'}</td>
                      <td className="col-wide">{unit.internal_area_sqft ? `${Number(unit.internal_area_sqft)} sq ft` : '—'}</td>
                      <td className="col-wider">{unit.view_text ?? '—'}</td>
                      <td>{unit.price_aed ? `AED ${formatAed(unit.price_aed)}` : '—'}</td>
                      <td className="col-wide">{unit.price_per_sqft_aed ? formatAed(unit.price_per_sqft_aed) : '—'}</td>
                      <td>
                        {canManage ? (
                          <select
                            className="input"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            value={unit.status}
                            onChange={(event) => void setStatus(unit, event.target.value as UnitStatus)}
                            aria-label={`Status of unit ${unit.unit_no}`}
                          >
                            <option value="available">Available</option>
                            <option value="on_hold">On hold</option>
                            <option value="reserved">Reserved</option>
                            <option value="sold">Sold</option>
                          </select>
                        ) : (
                          <span className={UNIT_PILL[unit.status]}>{humanize(unit.status)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'plans' && (
        <Panel
          index={1}
          icon="file-text"
          title="Payment plans"
          action={
            canManage ? (
              <button type="button" className="btn btn-primary" onClick={() => setAddingPlan(true)}>
                <Icon name="plus" size={15} />
                <span>Add plan</span>
              </button>
            ) : undefined
          }
        >
          {plans.length === 0 ? (
            <Empty icon="file-text" title="No payment plans yet" hint="An offer can only use a plan listed here." />
          ) : (
            plans.map((plan) => {
              const total = plan.rows.reduce((sum, row) => sum + Number(row.percent), 0);
              return (
                <div key={plan.id} style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <b>{plan.name}</b>
                    {plan.is_default === 1 && <span className="pill info">Default</span>}
                    <span className="muted" style={{ marginInlineStart: 'auto', fontSize: 12.5 }}>
                      {total}% total
                    </span>
                  </div>
                  <div className="table-wrap" style={{ marginTop: 6 }}>
                    <table>
                      <thead><tr><th>#</th><th>Milestone</th><th>%</th><th className="col-wide">Due</th></tr></thead>
                      <tbody>
                        {plan.rows.map((row) => (
                          <tr key={row.id}>
                            <td className="muted">{row.seq}</td>
                            <td>{row.milestone}</td>
                            <td><b>{Number(row.percent)}%</b></td>
                            <td className="col-wide muted">{row.due_note ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </Panel>
      )}

      {tab === 'media' && <ProjectMedia projectId={projectId} canManage={canManage} />}

      {tab === 'commission' && canManage && (
        <Panel index={1} icon="hand-coins" title="Commission">
          <Note>Owner, admin and managers only. This never appears in a client offer.</Note>
          <dl className="facts">
            <dt>Our rate</dt><dd>{commission?.rate_pct ? `${commission.rate_pct}%` : 'Not set'}</dd>
            <dt>Payment terms</dt><dd>{String(commission?.payment_terms ?? 'Not set')}</dd>
            <dt>Agreement date</dt><dd>{String(commission?.agreement_date ?? 'Not set')}</dd>
            <dt>Average days to be paid</dt><dd>{String(commission?.avg_days_to_pay ?? 'Not set')}</dd>
            <dt>Default agent split</dt>
            <dd>{commission?.default_agent_split_pct ? `${commission.default_agent_split_pct}%` : 'Not set'}</dd>
          </dl>
        </Panel>
      )}

      <AddUnits
        open={addingUnits}
        projectId={projectId}
        onClose={() => setAddingUnits(false)}
        onSaved={() => { setAddingUnits(false); detail.reload(); toast('Units added'); }}
      />
      <AddPlan
        open={addingPlan}
        projectId={projectId}
        onClose={() => setAddingPlan(false)}
        onSaved={() => { setAddingPlan(false); detail.reload(); toast('Payment plan saved'); }}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="muted">{label}</span>
      <b>{value}</b>
    </div>
  );
}

/**
 * Adding units by pasting the developer's price list.
 *
 * Paste rather than a form with twelve boxes: a price list arrives as a
 * spreadsheet, and retyping ninety rows by hand is how the library stays empty.
 */
function AddUnits({ open, projectId, onClose, onSaved }: {
  open: boolean; projectId: string; onClose: () => void; onSaved: () => void;
}) {
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = parseUnits(text);

  async function save() {
    if (parsed.rows.length === 0) {
      setError('Nothing to add — paste at least one row.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/library/${projectId}/units`, {
        units: parsed.rows,
        label: label.trim() || 'Pasted price list',
      });
      setText('');
      setLabel('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the units');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add units"
      icon="layout-grid"
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || parsed.rows.length === 0}>
            {saving ? 'Adding…' : `Add ${parsed.rows.length} unit${parsed.rows.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      {error && <div className="err" style={{ display: 'block', marginBottom: 12 }} role="alert">{error}</div>}

      <Note>
        Copy the rows straight out of the developer's spreadsheet. Columns: unit, bedrooms, floor,
        area (sq ft), view, price. A unit number that already exists is updated, not duplicated.
      </Note>

      <Field label="What is this price list called?" hint="Shown against any offer that quotes it.">
        <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="March 2026 price list" maxLength={160} />
      </Field>

      <Field label="Paste the rows">
        <textarea
          className="input"
          rows={10}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'1204\t2\t12\t1150\tSea view\t2250000\n1205\t1\t12\t780\tPark view\t1450000'}
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}
        />
      </Field>

      {text.trim() && (
        <>
          <div className="sec-t">
            Reading {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}
            {parsed.skipped > 0 && <span className="muted"> · {parsed.skipped} skipped</span>}
          </div>
          {parsed.rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Unit</th><th>BR</th><th>Floor</th><th>Area</th><th>View</th><th>Price</th></tr></thead>
                <tbody>
                  {parsed.rows.slice(0, 8).map((row, i) => (
                    <tr key={`${row.unitNo}-${i}`}>
                      <td><b>{row.unitNo}</b></td>
                      <td>{row.bedrooms ?? '—'}</td>
                      <td>{row.floor ?? '—'}</td>
                      <td>{row.internalAreaSqft ?? '—'}</td>
                      <td>{row.view ?? '—'}</td>
                      <td>{row.priceAed ? `AED ${formatAed(row.priceAed)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 8 && (
                <p className="muted" style={{ fontSize: 12.5 }}>…and {parsed.rows.length - 8} more.</p>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

type ParsedUnit = {
  unitNo: string;
  bedrooms: number | null;
  floor: string | null;
  internalAreaSqft: number | null;
  view: string | null;
  priceAed: number | null;
};

/**
 * Read pasted spreadsheet rows.
 *
 * Deliberately forgiving about everything except the unit number: a developer's
 * sheet has whatever columns it has, and a row that yields a unit number and a
 * price is worth keeping even if the rest is missing. Exported so the parsing
 * can be tested without a browser.
 */
export function parseUnits(text: string): { rows: ParsedUnit[]; skipped: number } {
  const rows: ParsedUnit[] = [];
  let skipped = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    /*
     * One delimiter per line, chosen in order, rather than a regex that allows
     * all three at once: a price written "AED 2,250,000" is a single cell in a
     * tab-separated paste, and splitting on commas as well turned it into three
     * cells and read the price as 2.
     */
    const cells = (line.includes('\t')
      ? line.split('\t')
      : /\s{2,}/.test(line)
        ? line.split(/\s{2,}/)
        : line.split(',')
    ).map((cell) => cell.trim());
    const unitNo = cells[0] ?? '';
    // A header row starts with something that is not a unit number.
    if (!unitNo || /^(unit|no\.?|apartment|#)$/i.test(unitNo)) {
      skipped += 1;
      continue;
    }

    const asNumber = (value: string | undefined): number | null => {
      if (!value) return null;
      const cleaned = value.replace(/[^\d.]/g, '');
      if (!cleaned) return null;
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : null;
    };

    rows.push({
      unitNo,
      bedrooms: asNumber(cells[1]),
      floor: cells[2] || null,
      internalAreaSqft: asNumber(cells[3]),
      view: cells[4] || null,
      // The price is the last numeric cell, because sheets put it in different
      // places and it is always the biggest number on the row.
      priceAed: asNumber(cells[5]) ?? asNumber(cells[cells.length - 1]),
    });
  }
  return { rows, skipped };
}

/** A payment plan and its milestones. */
function AddPlan({ open, projectId, onClose, onSaved }: {
  open: boolean; projectId: string; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(true);
  const [rows, setRows] = useState([{ milestone: 'On booking', percent: '20', dueNote: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = rows.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);

  async function save() {
    if (!name.trim()) { setError('Give the plan a name.'); return; }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/library/${projectId}/plans`, {
        name: name.trim(),
        isDefault,
        rows: rows
          .filter((row) => row.milestone.trim())
          .map((row) => ({ milestone: row.milestone.trim(), percent: Number(row.percent) || 0, dueNote: row.dueNote.trim() || null })),
      });
      setName('');
      setRows([{ milestone: 'On booking', percent: '20', dueNote: '' }]);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the plan');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a payment plan"
      icon="file-text"
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save plan'}
          </button>
        </>
      }
    >
      {error && <div className="err" style={{ display: 'block', marginBottom: 12 }} role="alert">{error}</div>}

      <div className="field-row">
        <Field label="Plan name">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Standard 60 / 40" maxLength={160} />
        </Field>
        <Field label="Default plan">
          <label className="check" style={{ paddingTop: 8 }}>
            <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />
            <span>Use this one by default</span>
          </label>
        </Field>
      </div>

      <div className="sec-t">
        Milestones
        <span className="muted" style={{ marginInlineStart: 8, fontWeight: 400 }}>{total}% total</span>
      </div>

      {rows.map((row, index) => (
        <div className="field-row" key={index} style={{ gridTemplateColumns: '2fr 80px 1fr auto', alignItems: 'end' }}>
          <Field label={index === 0 ? 'Milestone' : ''}>
            <Input
              value={row.milestone}
              onChange={(event) => setRows(rows.map((r, i) => (i === index ? { ...r, milestone: event.target.value } : r)))}
              placeholder="On handover"
            />
          </Field>
          <Field label={index === 0 ? '%' : ''}>
            <Input
              inputMode="decimal"
              value={row.percent}
              onChange={(event) => setRows(rows.map((r, i) => (i === index ? { ...r, percent: event.target.value } : r)))}
            />
          </Field>
          <Field label={index === 0 ? 'Due' : ''}>
            <Input
              value={row.dueNote}
              onChange={(event) => setRows(rows.map((r, i) => (i === index ? { ...r, dueNote: event.target.value } : r)))}
              placeholder="Q4 2027"
            />
          </Field>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setRows(rows.filter((_, i) => i !== index))}
            aria-label={`Remove milestone ${index + 1}`}
            disabled={rows.length === 1}
          >
            <Icon name="x" />
          </button>
        </div>
      ))}

      <button
        type="button"
        className="btn"
        onClick={() => setRows([...rows, { milestone: '', percent: '', dueNote: '' }])}
      >
        <Icon name="plus" size={14} />
        <span>Add a milestone</span>
      </button>

      <Note>
        The percentages do not have to add up to 100 — developers often leave the DLD fee or a
        service-charge year outside the schedule.
      </Note>
    </Modal>
  );
}
