import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, qs } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { formatDateTime, humanize } from '../lib/format.js';
import type {
  AssignmentChoice, AssignmentMethod, AssignmentPreview, ColumnMapping, ImportDetail, ImportField,
  ImportSettings, UploadResponse, UserRow,
} from '../lib/types.js';
import { Icon } from '../design/index.js';
import {
  Chip, Empty, ErrorNote, Field, Note, Panel, Select, Spinner, TextArea, Toolbar, useToast,
} from '../design/ui.js';
import { AssignmentPicker } from '../components/AssignmentPicker.js';

/** The fields a column can be mapped to, in the order the wizard lists them. */
const FIELDS: ImportField[] = [
  'fullName', 'firstName', 'lastName', 'phone', 'altPhone', 'email', 'language',
  'projectName', 'developer', 'emirate', 'preferredLocation', 'unitType',
  'budgetBand', 'budgetMinAed', 'budgetMaxAed', 'purpose', 'paymentMethod', 'timeline',
  'goldenVisaInterest', 'source', 'campaignName', 'notes', 'tags', 'ownerEmail', 'createdAt',
];

const FIELD_LABELS: Partial<Record<ImportField, string>> = {
  fullName: 'Full name', firstName: 'First name', lastName: 'Last name',
  phone: 'Phone', altPhone: 'Second phone', email: 'Email', language: 'Language',
  projectName: 'Project', developer: 'Developer', emirate: 'Emirate',
  preferredLocation: 'Preferred location', unitType: 'Unit type',
  budgetBand: 'Budget (range or text)', budgetMinAed: 'Budget min (AED)', budgetMaxAed: 'Budget max (AED)',
  purpose: 'Purpose', paymentMethod: 'Payment method', timeline: 'Timeline',
  goldenVisaInterest: 'Golden Visa interest', source: 'Source', campaignName: 'Campaign',
  notes: 'Notes', tags: 'Tags', ownerEmail: 'Owner email', createdAt: 'Date added',
};

const STEPS = [
  'Upload', 'Map columns', 'Clean and check', 'Duplicates', 'Settings', 'Assign', 'Import',
];

/* ── The list of past imports ─────────────────────────────────────────── */

export function Imports() {
  const list = useAsync<{ items: (ImportDetail['import'] & { created_by: string | null })[] }>(
    () => api.get('/api/imports'),
    [],
  );

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;

  const items = list.data?.items ?? [];

  return (
    <>
      <Toolbar
        right={
          <Link className="btn btn-primary" to="/imports/new">
            <Icon name="upload" />
            <span>New import</span>
          </Link>
        }
      >
        <Chip on icon="file-spreadsheet">
          Imports
        </Chip>
      </Toolbar>

      <Panel index={1} icon="file-spreadsheet" title="Recent imports">
        {list.loading && items.length === 0 && <Spinner />}
        {!list.loading && items.length === 0 && (
          <Empty
            icon="upload"
            title="No imports yet"
            hint="Bring in a CSV or Excel file of leads — up to a hundred thousand rows."
          />
        )}

        {items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Status</th>
                  <th className="money">Rows</th>
                  <th className="money">Created</th>
                  <th className="money">Updated</th>
                  <th className="money">Skipped</th>
                  <th className="money">Failed</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.filename}</b>
                      <div className="muted" style={{ fontSize: 12 }}>{row.created_by ?? 'System'}</div>
                    </td>
                    <td>
                      <span className={statusClass(row.status)}>{humanize(row.status)}</span>
                    </td>
                    <td className="money">{row.total_rows}</td>
                    <td className="money">{row.created_count}</td>
                    <td className="money">{row.updated_count}</td>
                    <td className="money">{row.skipped_count}</td>
                    <td className="money">{row.failed_count}</td>
                    <td className="muted">{formatDateTime(row.created_at)}</td>
                    <td>
                      <Link className="rowbtn" to={`/imports/${row.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function statusClass(status: string): string {
  if (status === 'completed') return 'pill ok';
  if (status === 'failed') return 'pill due';
  if (status === 'importing' || status === 'validating') return 'pill wait';
  if (status === 'undone') return 'pill';
  return 'pill info';
}

/* ── The wizard ───────────────────────────────────────────────────────── */

export function ImportWizard() {
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [settings, setSettings] = useState<ImportSettings | null>(null);
  const [assignment, setAssignment] = useState<AssignmentChoice>({ method: 'pool' });
  const [staged, setStaged] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const team = useAsync<{ items: UserRow[] }>(() => api.get('/api/users'), []);

  async function onFile(file: File) {
    setBusy(true);
    try {
      const response = await fetch('/api/imports', {
        method: 'POST',
        credentials: 'same-origin',
        // The file is the body. No multipart envelope, so a 60 MB export
        // streams to disk instead of being buffered to be parsed.
        headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name },
        body: file,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message ?? 'Could not read that file');
      }
      const data = (await response.json()) as UploadResponse;
      setUpload(data);
      setMapping(data.suggestedMapping);
      setSettings({ ...data.defaults, sourceLabel: file.name.replace(/\.[^.]+$/, '') });
      setStep(1);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not upload that file');
    } finally {
      setBusy(false);
    }
  }

  async function onPaste(text: string) {
    setBusy(true);
    try {
      const data = await api.post<UploadResponse>('/api/imports/paste', { text, filename: 'Pasted rows' });
      setUpload(data);
      setMapping(data.suggestedMapping);
      setSettings({ ...data.defaults, sourceLabel: 'Pasted rows' });
      setStep(1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not read those rows');
    } finally {
      setBusy(false);
    }
  }

  async function save(patch: Record<string, unknown>) {
    if (!upload) return;
    await api.patch(`/api/imports/${upload.id}`, patch);
  }

  async function validate() {
    if (!upload) return;
    setBusy(true);
    try {
      await save({ mapping });
      const result = await api.post<{ total: number }>(`/api/imports/${upload.id}/validate`);
      setStaged(result.total);
      setStep(3);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not read the file');
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!upload || !settings) return;
    setBusy(true);
    try {
      await save({ settings, assignment });
      await api.post(`/api/imports/${upload.id}/start`);
      toast('Import started — you can leave this page');
      navigate(`/imports/${upload.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not start the import');
    } finally {
      setBusy(false);
    }
  }

  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const hasContactColumn = Object.values(mapping).some((field) => field === 'phone' || field === 'email');

  return (
    <>
      <Toolbar>
        {STEPS.map((label, index) => (
          <Chip
            key={label}
            on={index === step}
            onClick={() => (upload || index === 0) && index <= step && setStep(index)}
          >
            {index + 1}. {label}
          </Chip>
        ))}
      </Toolbar>

      <div className="dash">
        {step === 0 && <UploadStep busy={busy} onFile={onFile} onPaste={onPaste} />}

        {step === 1 && upload && (
          <Panel span={12} index={1} icon="git-compare" title="Map the columns">
            <p className="muted" style={{ marginTop: 0 }}>
              {mappedCount} of {upload.headers.length} columns mapped. Anything left unmapped is kept
              on the lead as a note rather than thrown away.
            </p>

            {upload.generatedHeaders && (
              /*
               * Raw ad exports often have no header row. Saying so turns a
               * confusing screen into an obvious one: the columns are numbered
               * because the file never named them, and the values beside each
               * are what to map by.
               */
              <p className="sub" style={{ marginTop: -10 }}>
                This file has no column names, so the columns are numbered. Match them using the
                values shown beside each one — name, email and phone have been matched already.
              </p>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Column in your file</th>
                    <th>First values</th>
                    <th>Import as</th>
                  </tr>
                </thead>
                <tbody>
                  {upload.headers.map((header, index) => (
                    <tr key={header}>
                      <td><b>{header}</b></td>
                      <td className="muted">
                        {upload.preview.slice(0, 3).map((row) => row[index]).filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td>
                        <Select
                          value={mapping[header] ?? ''}
                          onChange={(event) =>
                            setMapping({ ...mapping, [header]: (event.target.value || null) as ImportField | null })
                          }
                        >
                          <option value="">Do not import</option>
                          {FIELDS.map((field) => (
                            <option key={field} value={field}>
                              {FIELD_LABELS[field] ?? field}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!hasContactColumn && (
              <p className="err" style={{ display: 'block', marginTop: 12 }}>
                Map a phone or an email column. A lead with neither cannot be contacted, so every row
                would be rejected.
              </p>
            )}

            <div className="two" style={{ marginTop: 14 }}>
              <SaveMapping mapping={mapping} />
              <button type="button" className="btn btn-primary" disabled={!hasContactColumn || busy} onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </Panel>
        )}

        {step === 2 && upload && (
          <Panel span={12} index={1} icon="shield-check" title="Clean and check">
            <p className="muted" style={{ marginTop: 0 }}>
              Every row goes through the same cleaning as a lead from Meta or the website: phone
              numbers into E.164 with a UAE default, emails lowercased, budgets parsed, and duplicates
              inside the file removed.
            </p>
            <Field label="Default country for phone numbers">
              <Select
                value={settings?.phoneRegion ?? 'AE'}
                onChange={(event) => settings && setSettings({ ...settings, phoneRegion: event.target.value })}
              >
                <option value="AE">United Arab Emirates (+971)</option>
                <option value="SA">Saudi Arabia (+966)</option>
                <option value="IN">India (+91)</option>
                <option value="GB">United Kingdom (+44)</option>
                <option value="RU">Russia (+7)</option>
              </Select>
            </Field>
            <Note>
              A number that cannot be read is not imported. You get those rows back as a CSV at the
              end, with the reason, to fix and upload again.
            </Note>
            <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} disabled={busy} onClick={() => void validate()}>
              {busy ? 'Reading the file…' : 'Check the file'}
            </button>
          </Panel>
        )}

        {step === 3 && settings && (
          <Panel span={12} index={1} icon="users" title="People already in the CRM">
            <p className="muted" style={{ marginTop: 0 }}>
              {staged === null ? '' : `${staged.toLocaleString()} rows read. `}
              Matching uses the same rules as every other lead source: phone, then WhatsApp id, then
              email.
            </p>

            {(
              [
                ['skip', 'Skip them', 'Leave the existing record completely alone.'],
                ['fill_empty', 'Fill empty fields only', 'Never overwrites anything an agent has edited.'],
                ['create_anyway', 'Open a new inquiry', 'Keeps one contact but logs this as a fresh inquiry, flagged for review.'],
              ] as const
            ).map(([value, label, hint]) => (
              <label className="bank" key={value} style={{ cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="duplicates"
                  checked={settings.duplicateStrategy === value}
                  onChange={() => setSettings({ ...settings, duplicateStrategy: value })}
                />
                <div>
                  <b style={{ display: 'block' }}>{label}</b>
                  <small className="muted">{hint}</small>
                </div>
              </label>
            ))}

            <Note>
              One person can never become two contacts: phone numbers are unique, and that is what
              keeps the CRM free of duplicates.
            </Note>

            <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setStep(4)}>
              Continue
            </button>
          </Panel>
        )}

        {step === 4 && settings && (
          <Panel span={12} index={1} icon="settings" title="Settings for this import">
            <div className="two">
              <Field label="Name this import" hint="Becomes a tag on every contact, so you can find them later.">
                <input
                  className="input"
                  value={settings.sourceLabel}
                  onChange={(event) => setSettings({ ...settings, sourceLabel: event.target.value })}
                />
              </Field>
              <Field label="Project interest" hint="Applied to rows with no project of their own.">
                <input
                  className="input"
                  value={settings.projectName ?? ''}
                  placeholder="Leave blank if mixed"
                  onChange={(event) => setSettings({ ...settings, projectName: event.target.value || null })}
                />
              </Field>
            </div>

            <Field label="Consent">
              <Select
                value={settings.consent}
                onChange={(event) => setSettings({ ...settings, consent: event.target.value as ImportSettings['consent'] })}
              >
                <option value="unknown">Unknown — no automated messages</option>
                <option value="none">No consent — no automated messages</option>
                <option value="opted_in">These people opted in to be contacted</option>
              </Select>
            </Field>

            {settings.consent === 'opted_in' ? (
              <p className="err" style={{ display: 'block' }}>
                You are confirming these contacts previously agreed to be contacted about property
                offers. The wording and today&rsquo;s date are stored against each of them, as UAE
                PDPL requires. Messaging people who never opted in is the fastest way to get the
                WhatsApp number banned.
              </p>
            ) : (
              <Note>
                With no recorded consent these contacts can be called, but no automated WhatsApp or
                email will go to them, and a bulk WhatsApp campaign will skip them.
              </Note>
            )}

            <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setStep(5)}>
              Continue
            </button>
          </Panel>
        )}

        {step === 5 && upload && (
          <Panel span={12} index={1} icon="users-round" title="Who works these leads">
            <AssignmentPicker
              value={assignment}
              onChange={setAssignment}
              agents={(team.data?.items ?? []).filter((user) => user.role === 'agent' && user.is_active === 1)}
              previewUrl={`/api/imports/${upload.id}/assignment-preview`}
            />
            <Note>
              Imported leads never trigger the instant WhatsApp welcome. A file of forty thousand old
              leads would otherwise send forty thousand messages — work them through a list or a
              campaign instead.
            </Note>
            <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => setStep(6)}>
              Continue
            </button>
          </Panel>
        )}

        {step === 6 && upload && settings && (
          <Panel span={12} index={1} icon="play" title="Ready to import">
            <dl className="facts">
              <dt>File</dt>
              <dd>{upload.filename}</dd>
              <dt>Rows</dt>
              <dd>{staged === null ? '—' : staged.toLocaleString()}</dd>
              <dt>Columns mapped</dt>
              <dd>{mappedCount}</dd>
              <dt>Named</dt>
              <dd>{settings.sourceLabel}</dd>
              <dt>Duplicates</dt>
              <dd>{humanize(settings.duplicateStrategy)}</dd>
              <dt>Consent</dt>
              <dd>{humanize(settings.consent)}</dd>
              <dt>Assignment</dt>
              <dd>{humanize(assignment.method)}</dd>
            </dl>
            <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 16 }} disabled={busy} onClick={() => void start()}>
              {busy ? 'Starting…' : `Import ${staged === null ? '' : `${staged.toLocaleString()} rows`}`}
            </button>
          </Panel>
        )}
      </div>
    </>
  );
}

function UploadStep({
  busy, onFile, onPaste,
}: { busy: boolean; onFile: (file: File) => void; onPaste: (text: string) => void }) {
  const [over, setOver] = useState(false);
  const [pasted, setPasted] = useState('');
  const input = useRef<HTMLInputElement>(null);

  return (
    <>
      <Panel span={7} index={0} icon="upload" title="Upload a file">
        <div
          className={over ? 'drop over' : 'drop'}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            const file = event.dataTransfer.files[0];
            if (file) onFile(file);
          }}
          onClick={() => input.current?.click()}
        >
          <div className="ic">
            <Icon name="file-spreadsheet" size={24} />
          </div>
          <b>{busy ? 'Reading the file…' : 'Drop a CSV or Excel file here'}</b>
          <small>or click to choose one. Up to 100,000 rows.</small>
          <input
            ref={input}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xlsm"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </div>
      </Panel>

      <Panel span={5} index={1} icon="layout-grid" title="Or paste from a sheet">
        <TextArea
          rows={8}
          placeholder={'Name\tMobile\tEmail\nSara Ahmed\t0501234567\tsara@example.com'}
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: 10 }}
          disabled={busy || pasted.trim().length === 0}
          onClick={() => onPaste(pasted)}
        >
          Read these rows
        </button>
        <Note>Copy the cells straight out of Excel or Google Sheets, header row included.</Note>
      </Panel>
    </>
  );
}

function SaveMapping({ mapping }: { mapping: ColumnMapping }) {
  const toast = useToast();
  const [name, setName] = useState('');

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      <Field label="Save this mapping for next time">
        <input
          className="input"
          placeholder="e.g. Portal export"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <button
        type="button"
        className="btn"
        disabled={!name}
        onClick={() => {
          void api
            .post('/api/imports/mappings', { name, mapping })
            .then(() => toast('Mapping saved'))
            .catch(() => toast('Could not save the mapping'));
        }}
      >
        Save
      </button>
    </div>
  );
}

/* ── The progress and report screen ───────────────────────────────────── */

export function ImportDetailScreen() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const detail = useAsync<ImportDetail>(() => api.get(`/api/imports/${id}`), [id, tick]);
  const undo = useAsync<{ deletable: number; keptBecauseWorkedOn: number; expired: boolean }>(
    () => api.get(`/api/imports/${id}/undo`),
    [id, tick],
  );

  const record = detail.data?.import;
  const running = record?.status === 'importing' || record?.status === 'validating';

  // Poll while it runs; the job carries on whether or not this page is open.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 2000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (detail.error) return <ErrorNote>{detail.error}</ErrorNote>;
  if (!record) return <Spinner />;

  const percent = record.total_rows > 0 ? Math.round((record.processed_rows / record.total_rows) * 100) : 0;

  return (
    <>
      <Toolbar
        right={
          record.failed_count + record.skipped_count > 0 ? (
            <a className="btn" href={`/api/imports/${id}/failed.csv`}>
              <Icon name="file-down" />
              <span>Download the rows that failed</span>
            </a>
          ) : undefined
        }
      >
        <Link className="chip" to="/imports">
          <Icon name="arrow-left" />
          All imports
        </Link>
        <span className={statusClass(record.status)}>{humanize(record.status)}</span>
      </Toolbar>

      <div className="dash">
        <Panel span={8} index={0} icon="file-spreadsheet" title={record.filename}>
          {running && (
            <>
              <div className="funnel-bar" style={{ height: 14, marginBottom: 10 }}>
                <i className="go" style={{ ['--w' as string]: `${percent}%`, width: `${percent}%` }} />
              </div>
              <p className="muted">
                {record.processed_rows.toLocaleString()} of {record.total_rows.toLocaleString()} rows
                ({percent}%). You can close this page — the import keeps going.
              </p>
            </>
          )}

          <div className="vat-big" style={{ marginTop: 14 }}>
            <div>
              <small>Created</small>
              <b>{record.created_count.toLocaleString()}</b>
            </div>
            <div>
              <small>Updated</small>
              <b>{record.updated_count.toLocaleString()}</b>
            </div>
            <div>
              <small>Skipped</small>
              <b>{record.skipped_count.toLocaleString()}</b>
            </div>
          </div>

          {record.failed_count > 0 && (
            <p className="err" style={{ display: 'block' }}>
              {record.failed_count.toLocaleString()} rows could not be imported. Download them above,
              fix them, and upload the file again.
            </p>
          )}

          {(detail.data?.problems.length ?? 0) > 0 && (
            <>
              <div className="sec-t">First problems</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data?.problems.map((problem) => (
                      <tr key={problem.line_number}>
                        <td>{problem.line_number}</td>
                        <td className="muted">{problem.reason ?? humanize(problem.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>

        <Panel span={4} index={1} icon="refresh-cw" title="Undo">
          {record.undone_at ? (
            <p className="muted">This import was undone on {formatDateTime(record.undone_at)}.</p>
          ) : undo.data?.expired ? (
            <Note>
              The {detail.data?.undoWindowHours}-hour window has passed, so this import can no longer
              be taken back.
            </Note>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                {undo.data?.deletable ?? 0} contacts can still be removed.
                {(undo.data?.keptBecauseWorkedOn ?? 0) > 0 &&
                  ` ${undo.data?.keptBecauseWorkedOn} will be kept because somebody has already worked them.`}
              </p>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void api
                    .post(`/api/imports/${id}/undo`)
                    .then((result) => {
                      const typed = result as { deleted: number; kept: number };
                      toast(`Removed ${typed.deleted} contacts, kept ${typed.kept}`);
                      setTick((value) => value + 1);
                    })
                    .catch((err: unknown) => toast(err instanceof ApiError ? err.message : 'Could not undo'));
                }}
              >
                <Icon name="trash-2" />
                Undo this import
              </button>
              <Note>
                Only contacts this import created, and only those nobody has called, messaged, tasked
                or moved. Anything an agent has touched stays.
              </Note>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}
