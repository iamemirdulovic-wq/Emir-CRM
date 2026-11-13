import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';
import { importSub } from './subs.js';

/**
 * Import, as `design/web/import.html` lays it out: six steps, one card each.
 *
 * Upload · Columns · Check · Give · Confirm · Done.
 *
 * The one that earns the screen is **Check**. The import has always split a
 * file into new, duplicate and bad — it just did it while running, which is
 * after the moment anybody could change their mind. Step 3 now runs the same
 * split with the writes taken out (`imports/preflight.ts`) and shows it, so
 * "208 new leads" is a number somebody decides on rather than discovers.
 *
 * Two promises this screen makes and the server keeps:
 *
 *  - **Nothing is in the CRM until step 5.** Upload, mapping and the check all
 *    write to the import's own tables and nothing else.
 *  - **An imported lead gets no clock.** It is not a new lead somebody must
 *    ring in five minutes; it is a list to work through. The design says so
 *    on step 4 and the run has always behaved that way.
 */

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: 'Upload' },
  { n: 2, label: 'Columns' },
  { n: 3, label: 'Check' },
  { n: 4, label: 'Give' },
  { n: 5, label: 'Confirm' },
  { n: 6, label: 'Done' },
];

/** What a column can become. The server's list, in the owner's words. */
const FIELDS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Do not import' },
  { value: 'fullName', label: 'Name' },
  { value: 'phone', label: 'Phone' },
  { value: 'altPhone', label: 'Second phone' },
  { value: 'email', label: 'Email' },
  { value: 'language', label: 'Language' },
  { value: 'projectName', label: 'Project' },
  { value: 'developer', label: 'Developer' },
  { value: 'emirate', label: 'Emirate' },
  { value: 'preferredLocation', label: 'Preferred location' },
  { value: 'unitType', label: 'Unit type' },
  { value: 'budgetMinAed', label: 'Budget from' },
  { value: 'budgetMaxAed', label: 'Budget to' },
  { value: 'budgetBand', label: 'Budget band' },
  { value: 'purpose', label: 'Purpose' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'source', label: 'Source' },
  { value: 'campaignName', label: 'Campaign' },
  { value: 'notes', label: 'Notes' },
  { value: 'tags', label: 'Tags' },
  { value: 'ownerEmail', label: 'Agent email' },
  { value: 'createdAt', label: 'Date added' },
];

interface ImportRecord {
  id: string;
  filename: string;
  status: string;
  total_rows: number;
  processed_rows: number;
  created_count: number;
  updated_count: number;
  skipped_count: number;
  failed_count: number;
  headers: string[] | null;
  mapping: Record<string, string | null> | null;
  undo_deadline_at: string | null;
}

interface Preflight {
  total: number;
  fresh: number;
  duplicates: number;
  invalid: number;
  duplicateRows: Array<{ line: number; name: string | null; phone: string | null; detail: string | null }>;
  invalidRows: Array<{ line: number; name: string | null; phone: string | null; detail: string | null }>;
  invalidReasons: Array<{ reason: string; n: number }>;
  contactsInCrm: number;
}

interface Candidate {
  userId: string;
  name: string;
  openLeads: number;
  isEligible: boolean;
}

type Give = 'agents' | 'desk' | 'incoming';

export function V2Import() {
  /* `Import.dc.html`: "Import leads" over "Owner & admin · Excel or CSV";
     `design/web/import.html` writes "Excel or CSV · 6 short steps", and the
     computer design wins. The six is `STEPS.length` — this screen's own
     stepper — rather than the design's figure, so adding a step changes the
     line with it. */
  usePhoneHead({ title: 'Import leads', sub: importSub(STEPS.length) });
  const [step, setStep] = useState<Step>(1);
  const [importId, setImportId] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const [record, setRecord] = useState<ImportRecord | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [sample, setSample] = useState<string[][]>([]);
  const [check, setCheck] = useState<Preflight | null>(null);

  const [dupes, setDupes] = useState<'skip' | 'fill_empty' | 'create_anyway'>('skip');
  const [give, setGive] = useState<Give>('agents');
  const [chosen, setChosen] = useState<string[]>([]);
  const [teamId, setTeamId] = useState<string>('');
  const [project, setProject] = useState<string>('');
  const [sourceLabel, setSourceLabel] = useState('Import (Excel)');

  const toast = useToast();
  const agents = useAsync<{ items: Candidate[] }>(() => api.get('/api/teams/candidates'), []);
  const teams = useAsync<{ items: Array<{ id: string; name: string }> }>(() => api.get('/api/teams'), []);

  const furthest = useRef<Step>(1);
  useEffect(() => { if (step > furthest.current) furthest.current = step; }, [step]);

  const mapped = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping]);
  const hasName = mapped.has('fullName');
  const hasPhone = mapped.has('phone');

  /* ── step 1 ─────────────────────────────────────────────────────────── */

  const upload = useCallback(async (chosenFile: File) => {
    setBusy(true);
    setProblem(null);
    try {
      /* The server reads the first twenty rows, guesses the mapping from the
         headers and from the values under them, and hands both back. */
      const made = await api.upload<{
        id: string;
        headers: string[];
        preview: string[][];
        suggestedMapping: Record<string, string | null>;
      }>('/api/imports', chosenFile);

      setImportId(made.id);
      setFile({ name: chosenFile.name, size: chosenFile.size });
      setSample(made.preview ?? []);
      /* Keyed by header, in the file's own column order, so the table on the
         next step reads top to bottom the way the file does. */
      setMapping(Object.fromEntries(
        made.headers.map((header) => [header, made.suggestedMapping?.[header] ?? '']),
      ));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  }, []);

  /* ── moving between steps ───────────────────────────────────────────── */

  async function go(to: Step) {
    setProblem(null);

    if (to === 2 && !importId) {
      setProblem('Choose a file first.');
      return;
    }

    if (to === 3) {
      if (!hasName || !hasPhone) {
        setProblem('Name and Phone are needed before we can check the file.');
        return;
      }
      setBusy(true);
      try {
        /* Save the mapping, stage the rows, then look at them. Nothing here
           touches a contact. */
        await api.patch(`/api/imports/${importId}`, {
          mapping: Object.fromEntries(
            Object.entries(mapping).map(([header, field]) => [header, field || null]),
          ),
        });
        await api.post(`/api/imports/${importId}/validate`, {});
        setCheck(await api.post<Preflight>(`/api/imports/${importId}/preflight`, {}));
      } catch (err) {
        setProblem(err instanceof Error ? err.message : 'That file could not be checked.');
        setBusy(false);
        return;
      }
      setBusy(false);
    }

    if (to === 5 && give === 'agents' && chosen.length === 0) {
      setProblem('Choose at least one agent.');
      return;
    }

    setStep(to);
  }

  async function run() {
    if (!importId) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.patch(`/api/imports/${importId}`, {
        settings: {
          sourceLabel,
          source: 'csv_import',
          tags: [],
          projectName: project || null,
          pipelineKey: 'sales',
          stageKey: 'new_lead',
          consent: 'unknown',
          duplicateStrategy: dupes,
          phoneRegion: 'AE',
        },
        assignment: give === 'incoming'
          ? { method: 'pool' }
          : give === 'desk'
            ? { method: 'team_round_robin', teamId: teamId || null }
            : { method: 'split_even', userIds: chosen },
      });
      await api.post(`/api/imports/${importId}/start`, {});
      setStep(6);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'The import could not be started.');
    } finally {
      setBusy(false);
    }
  }

  /* While it runs, follow it. The design's step 6 counts up as it goes. */
  useEffect(() => {
    if (step !== 6 || !importId) return;
    let alive = true;
    const tick = async () => {
      try {
        const got = await api.get<{ import: ImportRecord }>(`/api/imports/${importId}`);
        if (!alive) return;
        setRecord(got.import);
        if (got.import.status === 'importing' || got.import.status === 'validating') {
          window.setTimeout(() => void tick(), 1200);
        }
      } catch {
        /* A poll that fails is not worth an error on a finished screen; the
           next one will say the same thing or better. */
      }
    };
    void tick();
    return () => { alive = false; };
  }, [step, importId]);

  const total = check?.total ?? 0;
  const fresh = check?.fresh ?? 0;

  return (
    <div className="v2-import p-import">
      <div className="d-imp">
        <div className="d-stepper">
          {STEPS.map((one, index) => (
            <span key={one.n} className="v2-step-wrap">
              <button
                type="button"
                className={
                  step === one.n ? 'd-step d-on'
                    : one.n < step ? 'd-step d-done'
                      : 'd-step'
                }
                /* Only backwards, and only to a step already passed: the
                   file has to be read before its columns mean anything. */
                disabled={one.n >= step || step === 6}
                onClick={() => setStep(one.n)}
              >
                {/* The label is its own element so the phone can keep the
                    six circles and show only the step you are on: six names
                    is 719px of strip at 390px. */}
                <span className="d-n">{one.n}</span>
                <span className="v2-d-steplabel">{one.label}</span>
              </button>
              {index < STEPS.length - 1 && <span className="d-line" />}
            </span>
          ))}
        </div>

        {step === 1 && (
          <StepUpload file={file} busy={busy} onFile={upload} onRemove={() => { setFile(null); setImportId(null); }} />
        )}

        {step === 2 && (
          <StepColumns
            headers={Object.keys(mapping)}
            sample={sample}
            mapping={mapping}
            onChange={(header, field) => setMapping((was) => ({ ...was, [header]: field }))}
            hasName={hasName}
            hasPhone={hasPhone}
          />
        )}

        {step === 3 && check && (
          <StepCheck check={check} dupes={dupes} setDupes={setDupes} />
        )}

        {step === 4 && (
          <StepGive
            n={fresh}
            give={give}
            setGive={setGive}
            agents={agents.data?.items ?? []}
            chosen={chosen}
            setChosen={setChosen}
            teams={teams.data?.items ?? []}
            teamId={teamId}
            setTeamId={setTeamId}
            project={project}
            setProject={setProject}
          />
        )}

        {step === 5 && check && (
          <StepConfirm
            file={file}
            check={check}
            dupes={dupes}
            give={give}
            chosen={chosen}
            agents={agents.data?.items ?? []}
            teams={teams.data?.items ?? []}
            teamId={teamId}
            project={project}
            sourceLabel={sourceLabel}
            setSourceLabel={setSourceLabel}
          />
        )}

        {step === 6 && (
          <StepDone importId={importId} record={record} file={file} check={check} />
        )}

        {problem && <div className="d-mt-16"><ErrorNote>{problem}</ErrorNote></div>}

        {step < 6 && (
          <div className="d-imp-foot">
            <button
              type="button"
              className="d-btn d-ghost"
              disabled={step === 1 || busy}
              onClick={() => setStep((was) => (was - 1) as Step)}
            >
              <Icon name="arrow-left" />Back
            </button>
            <span className="d-grow" />
            <span className="d-small d-muted">Step {step} of 6</span>
            {step < 5 && (
              <button
                type="button"
                className="d-btn d-primary d-lg"
                disabled={busy || (step === 1 && !importId)}
                onClick={() => void go((step + 1) as Step)}
              >
                {busy ? 'Working…' : `Next: ${STEPS[step]?.label}`}
                <Icon name="arrow-right" />
              </button>
            )}
            {step === 5 && (
              <button type="button" className="d-btn d-primary d-lg" disabled={busy} onClick={run}>
                {busy ? 'Starting…' : `Import ${fresh} leads`}
                <Icon name="arrow-right" />
              </button>
            )}
          </div>
        )}
      </div>
      {total > 0 && step < 6 && (
        <p className="d-small d-muted d-mt-12 v2-import-note">
          Nothing is in the CRM until you press Import on step 5.
        </p>
      )}
    </div>
  );
}

/* ── 1 · upload ────────────────────────────────────────────────────────── */

function StepUpload({
  file, busy, onFile, onRemove,
}: {
  file: { name: string; size: number } | null;
  busy: boolean;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const [over, setOver] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="d-card d-stage">
      <header>
        <h2>Upload your file</h2>
        <p>One row is one lead. The first row holds the column names.</p>
      </header>
      <div className="d-two">
        <div className="d-col d-gap-16">
          <label
            className={over ? 'd-drop d-over' : 'd-drop'}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const dropped = e.dataTransfer.files[0];
              if (dropped) onFile(dropped);
            }}
          >
            <span className="d-ic"><Icon name="upload" /></span>
            <b>{busy ? 'Reading your file…' : 'Drop your Excel or CSV file here'}</b>
            <span className="d-muted">or click to choose a file from this computer</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked) onFile(picked);
              }}
            />
            <span className="d-chip d-mt-8">.xlsx · .xls · .csv</span>
          </label>

          {file && (
            <div className="d-file-card">
              <span className="d-ic"><Icon name="file-text" /></span>
              <div className="d-grow">
                <b className="d-bold">{file.name}</b>
                <div className="d-small">{Math.max(1, Math.round(file.size / 1024))} KB</div>
              </div>
              <button
                type="button"
                className="d-btn d-sm"
                onClick={() => {
                  if (!confirming) { setConfirming(true); return; }
                  setConfirming(false);
                  onRemove();
                }}
              >
                {confirming ? 'Tap again to remove' : 'Remove'}
              </button>
            </div>
          )}
        </div>

        <div className="d-card d-flat">
          <h4 className="d-mb-16">A good file</h4>
          <ul className="d-rules">
            <li><Icon name="check" /><span>Has a <b>name</b> and a <b>phone</b> column. Everything else is optional.</span></li>
            <li><Icon name="check" /><span>Phone numbers with the country code, for example +971 50 555 0101.</span></li>
            <li><Icon name="check" /><span>One row for one person. The first row is the column names.</span></li>
            <li><Icon name="check" /><span>We check every number. A number already in the CRM is never added twice without your OK.</span></li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ── 2 · columns ───────────────────────────────────────────────────────── */

function StepColumns({
  headers, sample, mapping, onChange, hasName, hasPhone,
}: {
  headers: string[];
  sample: string[][];
  mapping: Record<string, string>;
  onChange: (header: string, field: string) => void;
  hasName: boolean;
  hasPhone: boolean;
}) {
  /* A field used twice would silently lose a column, so the second one is
     marked rather than quietly accepted. */
  const used = new Map<string, number>();
  for (const field of Object.values(mapping)) {
    if (field) used.set(field, (used.get(field) ?? 0) + 1);
  }

  return (
    <section className="d-card d-stage">
      <header className="d-row">
        <div className="d-grow">
          <h2>Match the columns</h2>
          <p>Tell us where each column of your file goes. We guessed for you.</p>
        </div>
        <div className="d-need">
          <span className={hasName ? 'd-chip d-green d-pip' : 'd-chip d-red d-pip'}>
            Name {hasName ? 'found' : 'needed'}
          </span>
          <span className={hasPhone ? 'd-chip d-green d-pip' : 'd-chip d-red d-pip'}>
            Phone {hasPhone ? 'found' : 'needed'}
          </span>
        </div>
      </header>

      <table className="d-table v2-map-table">
        <thead>
          <tr>
            <th>Column in your file</th>
            <th>First rows</th>
            <th className="v2-map-to">Goes to</th>
          </tr>
        </thead>
        <tbody>
          {headers.map((header, index) => {
            const field = mapping[header] ?? '';
            const twice = Boolean(field) && (used.get(field) ?? 0) > 1;
            return (
              <tr key={header} className={twice ? 'd-bad' : undefined}>
                <td className="d-t-main">{header}</td>
                <td className="d-t-sub">
                  {sample.slice(0, 2).map((row) => row[index]).filter(Boolean).join(' · ') || '—'}
                </td>
                <td>
                  <select
                    className="d-select"
                    value={field}
                    aria-label={`Where ${header} goes`}
                    onChange={(e) => onChange(header, e.target.value)}
                  >
                    {FIELDS.map((one) => (
                      <option key={one.value} value={one.value}>{one.label}</option>
                    ))}
                  </select>
                  {twice && <span className="v2-field-error">Used by another column too</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="d-small d-muted d-mt-16">
        Name and Phone are needed. A field can be used once. Columns set to “Do not import” are
        left out.
      </p>
    </section>
  );
}

/* ── 3 · check ─────────────────────────────────────────────────────────── */

function StepCheck({
  check, dupes, setDupes,
}: {
  check: Preflight;
  dupes: 'skip' | 'fill_empty' | 'create_anyway';
  setDupes: (what: 'skip' | 'fill_empty' | 'create_anyway') => void;
}) {
  const hint = dupes === 'skip'
    ? `The ${check.duplicates} leads stay as they are, with their agent.`
    : dupes === 'fill_empty'
      ? 'Empty details are filled in. Nothing an agent wrote is overwritten.'
      : 'They are added again as new leads, flagged as possible duplicates.';

  return (
    <section className="d-card d-stage">
      <header>
        <h2>We checked {check.total} rows</h2>
        <p>
          Every phone number was compared with the {check.contactsInCrm.toLocaleString('en-GB')}{' '}
          leads already in the CRM.
        </p>
      </header>

      <div className="d-sum3">
        <div className="d-stat"><b className="d-num-hero">{check.total}</b><span className="d-label">rows in the file</span></div>
        <span className="d-op">=</span>
        <div className="d-stat"><b className="d-num d-t-green">{check.fresh}</b><span className="d-label">new leads</span></div>
        <span className="d-op">+</span>
        <div className="d-stat"><b className="d-num d-t-amber">{check.duplicates}</b><span className="d-label">duplicates</span></div>
        <span className="d-op">+</span>
        <div className="d-stat"><b className="d-num d-t-red">{check.invalid}</b><span className="d-label">bad rows</span></div>
      </div>

      <div className="d-segbar d-tall">
        <i className="d-green" style={{ '--v': check.fresh } as React.CSSProperties} />
        <i className="d-amber" style={{ '--v': check.duplicates } as React.CSSProperties} />
        <i className="d-red" style={{ '--v': check.invalid } as React.CSSProperties} />
      </div>

      <div className="d-two d-mt-24 v2-check-two">
        <div className="d-card d-flat">
          <div className="d-card-head">
            <h3>{check.duplicates} duplicates</h3>
            <span className="d-chip d-amber">already in the CRM</span>
          </div>
          <div className="d-field">
            <span className="d-field-label">What do we do with them?</span>
            <div className="d-chips">
              {([
                ['skip', 'Skip them'],
                ['fill_empty', 'Fill empty details only'],
                ['create_anyway', 'Import them again as new'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={dupes === value ? 'd-chip-opt d-on' : 'd-chip-opt'}
                  onClick={() => setDupes(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="d-hint">{hint}</span>
          </div>
          <div className="d-mini-list d-mt-8">
            {check.duplicateRows.map((row) => (
              <div key={row.line}>
                <span className="d-grow">
                  <b className="d-bold">{row.name ?? `Row ${row.line}`}</b>
                  {row.phone ? ` · ${row.phone}` : ''}
                </span>
                <span className="d-muted">{row.detail}</span>
              </div>
            ))}
            {check.duplicates > check.duplicateRows.length && (
              <div><span className="d-grow d-muted">and {check.duplicates - check.duplicateRows.length} more</span></div>
            )}
            {check.duplicates === 0 && (
              <div><span className="d-grow d-muted">None. Every row is somebody new.</span></div>
            )}
          </div>
        </div>

        <div className="d-card d-flat">
          <div className="d-card-head">
            <h3>{check.invalid} bad rows</h3>
            <span className="d-chip d-red">not imported</span>
          </div>
          <p className="d-small d-muted">
            These rows cannot become leads. Fix them in the file and import them later.
          </p>
          <div className="d-mini-list d-mt-8">
            {check.invalidRows.map((row) => (
              <div key={row.line}>
                <span className="d-grow">
                  <b className="d-bold">Row {row.line}</b>
                  {row.name ? ` · ${row.name}` : ' · (empty)'}
                </span>
                <span className="d-t-red">{row.detail}</span>
              </div>
            ))}
            {/* One line each. Joined into a sentence they ran past the end of
                the card and the last reason was the one nobody could read. */}
            {check.invalidReasons.map((one) => (
              <div key={one.reason}>
                <span className="d-grow d-muted">{one.reason}</span>
                <b className="d-muted">{one.n}</b>
              </div>
            ))}
            {check.invalid === 0 && (
              <div><span className="d-grow d-muted">None. Every row can become a lead.</span></div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 4 · give ──────────────────────────────────────────────────────────── */

function StepGive({
  n, give, setGive, agents, chosen, setChosen, teams, teamId, setTeamId, project, setProject,
}: {
  n: number;
  give: Give;
  setGive: (what: Give) => void;
  agents: Candidate[];
  chosen: string[];
  setChosen: (who: string[]) => void;
  teams: Array<{ id: string; name: string }>;
  teamId: string;
  setTeamId: (id: string) => void;
  project: string;
  setProject: (name: string) => void;
}) {
  const each = chosen.length > 0 ? Math.floor(n / chosen.length) : 0;
  const spare = chosen.length > 0 ? n % chosen.length : 0;

  return (
    <section className="d-card d-stage">
      <header className="d-row">
        <div className="d-grow">
          <h2>Who gets the {n} leads?</h2>
          <p>An imported lead has no countdown. It is a list to work through, not a race.</p>
        </div>
        <div className="d-field v2-give-project">
          <label>Project</label>
          <input
            className="d-input"
            value={project}
            placeholder="Keep the project from the file"
            aria-label="Project"
            onChange={(e) => setProject(e.target.value)}
          />
        </div>
      </header>

      <div className="d-how d-opt-list">
        {([
          ['agents', 'users', 'Agents I choose', 'Equal split between them'],
          ['desk', 'building', 'A desk', 'Everyone working on that desk'],
          ['incoming', 'inbox', 'Incoming', 'Free leads · agents take them'],
        ] as const).map(([value, icon, title, note]) => (
          <button
            key={value}
            type="button"
            className={give === value ? 'd-opt d-on' : 'd-opt'}
            onClick={() => setGive(value)}
          >
            <span className="d-card-icon"><Icon name={icon} /></span>
            <b className="d-bold">{title}</b>
            <span className="d-small d-muted">{note}</span>
          </button>
        ))}
      </div>

      {give === 'agents' && (
        <div className="d-mt-16">
          <div className="d-row d-mb-8">
            <h4 className="d-grow">Choose the agents</h4>
            <button
              type="button"
              className="d-btn d-xs d-ghost"
              onClick={() => setChosen(agents.filter((one) => one.isEligible).map((one) => one.userId))}
            >
              All {agents.filter((one) => one.isEligible).length}
            </button>
            <button type="button" className="d-btn d-xs d-ghost" onClick={() => setChosen([])}>
              None
            </button>
          </div>
          <div className="d-ag-grid">
            {agents.map((one, index) => {
              const on = chosen.includes(one.userId);
              /* The spare leads go to the first few, which is what an even
                 split of 208 across 6 actually means. */
              const gets = on ? each + (chosen.indexOf(one.userId) < spare ? 1 : 0) : 0;
              return (
                <button
                  key={one.userId}
                  type="button"
                  className={on ? 'd-opt d-on' : 'd-opt'}
                  disabled={!one.isEligible}
                  onClick={() => setChosen(
                    on ? chosen.filter((id) => id !== one.userId) : [...chosen, one.userId],
                  )}
                >
                  <span className="d-grow">
                    <b className="d-bold">{one.name}</b>
                    <div className="d-small d-muted">{one.openLeads} open now</div>
                  </span>
                  <span className="d-get">{on ? `+${gets}` : '—'}</span>
                </button>
              );
            })}
            {agents.length === 0 && (
              <p className="d-small d-muted">No agents to choose from yet.</p>
            )}
          </div>
        </div>
      )}

      {give === 'desk' && (
        <div className="d-mt-16">
          <h4 className="d-mb-8">Choose the desk</h4>
          <div className="d-chips">
            {teams.map((one) => (
              <button
                key={one.id}
                type="button"
                className={teamId === one.id ? 'd-chip-opt d-on' : 'd-chip-opt'}
                onClick={() => setTeamId(one.id)}
              >
                {one.name}
              </button>
            ))}
            {teams.length === 0 && <span className="d-small d-muted">No desks set up yet.</span>}
          </div>
        </div>
      )}

      {give === 'incoming' && (
        <div className="d-banner d-mt-16">
          <Icon name="inbox" />
          <span className="d-grow">
            All {n} leads wait in Incoming. Any agent can take one, or you give them out later.
          </span>
          <Link className="d-link" to="/v2/incoming">Open Incoming</Link>
        </div>
      )}
    </section>
  );
}

/* ── 5 · confirm ───────────────────────────────────────────────────────── */

function StepConfirm({
  file, check, dupes, give, chosen, agents, teams, teamId, project, sourceLabel, setSourceLabel,
}: {
  file: { name: string; size: number } | null;
  check: Preflight;
  dupes: string;
  give: Give;
  chosen: string[];
  agents: Candidate[];
  teams: Array<{ id: string; name: string }>;
  teamId: string;
  project: string;
  sourceLabel: string;
  setSourceLabel: (label: string) => void;
}) {
  const picked = agents.filter((one) => chosen.includes(one.userId));
  const each = picked.length > 0 ? Math.floor(check.fresh / picked.length) : 0;
  const spare = picked.length > 0 ? check.fresh % picked.length : 0;

  const goesTo = give === 'incoming'
    ? 'Incoming'
    : give === 'desk'
      ? teams.find((one) => one.id === teamId)?.name ?? 'a desk'
      : `${picked.length} agent${picked.length === 1 ? '' : 's'}`;

  const dupeWords = dupes === 'skip'
    ? 'skipped'
    : dupes === 'fill_empty' ? 'empty details filled' : 'imported again as new';

  return (
    <section className="d-card d-stage">
      <header>
        <h2>Check and import</h2>
        <p>Nothing is in the CRM yet. Read once, then import.</p>
      </header>

      <div className="d-two v2-check-two">
        <dl className="d-kv">
          <Row term="File" value={file ? `${file.name} · ${check.total} rows` : `${check.total} rows`} />
          <Row term="New leads" value={<b className="d-t-green">{check.fresh}</b>} />
          <Row term="Duplicates" value={`${check.duplicates} · ${dupeWords}`} />
          <Row term="Bad rows" value={`${check.invalid} · not imported`} />
          <Row term="Project" value={project || 'Keep the project from the file'} />
          <Row
            term="Source"
            value={(
              <input
                className="d-input d-sm"
                value={sourceLabel}
                aria-label="Source"
                onChange={(e) => setSourceLabel(e.target.value)}
              />
            )}
          />
          <Row term="Countdown" value="None. An imported lead is not a five-minute lead." />
        </dl>

        <div className="d-card d-flat">
          <div className="d-card-head"><h3>Goes to {goesTo}</h3></div>
          <div className="d-mini-list">
            {give === 'agents' && picked.map((one, index) => (
              <div key={one.userId}>
                <span className="d-grow">{one.name}</span>
                <span className="d-muted">+{each + (index < spare ? 1 : 0)}</span>
              </div>
            ))}
            {give === 'desk' && (
              <div><span className="d-grow">Round-robin across the desk, least loaded first.</span></div>
            )}
            {give === 'incoming' && (
              <div><span className="d-grow">Nobody yet. Agents take them from Incoming.</span></div>
            )}
          </div>
          <div className="d-card-foot">
            <Icon name="bell" />
            <span>Each agent gets <b>one</b> notification, not one per lead.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ term, value }: { term: string; value: React.ReactNode }) {
  return (
    <div className="d-kv-row">
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/* ── 6 · done ──────────────────────────────────────────────────────────── */

function StepDone({
  importId, record, file, check,
}: {
  importId: string | null;
  record: ImportRecord | null;
  file: { name: string; size: number } | null;
  check: Preflight | null;
}) {
  const [undone, setUndone] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();

  const running = record?.status === 'importing' || record?.status === 'validating';
  const created = Number(record?.created_count ?? 0) + Number(record?.updated_count ?? 0);
  const done = Number(record?.processed_rows ?? 0);
  const total = Number(record?.total_rows ?? check?.total ?? 0);

  async function undo() {
    if (!importId) return;
    if (!confirming) { setConfirming(true); return; }
    try {
      await api.post(`/api/imports/${importId}/undo`, {});
      setUndone(true);
      toast('Import undone');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That could not be undone.');
    }
  }

  return (
    <section className="d-card d-stage">
      <div className="d-done-top">
        <span className="d-ic">
          <Icon name={running ? 'loader-2' : undone ? 'undo-2' : 'check'} />
        </span>
        <div className="d-grow">
          <h2 className="v2-done-h">
            {running
              ? `Importing… ${done} of ${total}`
              : undone
                ? 'Import undone'
                : `${created} leads are in the CRM`}
          </h2>
          <p className="d-muted">
            {file?.name ?? 'Your file'}
            {check ? ` · ${check.duplicates} duplicates · ${check.invalid} bad rows left out` : ''}
          </p>
        </div>
        {!running && !undone && (
          <>
            <Link className="d-btn" to="/v2/import"><Icon name="upload" />Import another file</Link>
            <Link className="d-btn d-dark" to="/v2/leads?tab=all">
              Open the leads<Icon name="arrow-right" />
            </Link>
          </>
        )}
      </div>

      {running && (
        <div className="d-bar-track v2-import-bar">
          <i style={{ width: `${total > 0 ? Math.round((done / total) * 100) : 0}%` }} />
        </div>
      )}

      {!running && !undone && (
        <div className="d-two v2-check-two">
          <div className="d-card d-flat">
            <div className="d-card-head"><h3>What happened</h3></div>
            <div className="d-mini-list">
              <div><span className="d-grow">New leads</span><b className="d-t-green">{record?.created_count ?? 0}</b></div>
              <div><span className="d-grow">Already in the CRM</span><b>{record?.updated_count ?? 0}</b></div>
              <div><span className="d-grow">Skipped and bad rows</span><b>{record?.skipped_count ?? 0}</b></div>
              {Number(record?.failed_count ?? 0) > 0 && (
                <div><span className="d-grow">Failed</span><b className="d-t-red">{record?.failed_count}</b></div>
              )}
            </div>
            {Number(record?.skipped_count ?? 0) > 0 && importId && (
              <div className="d-card-foot">
                <a className="d-btn d-sm" href={`/api/imports/${importId}/failed.csv`}>
                  <Icon name="download" />Download the rows that did not import
                </a>
              </div>
            )}
          </div>

          <div className="d-card d-flat">
            <h4 className="d-mb-8">Made a mistake?</h4>
            <p className="d-small d-muted">
              You can undo this import for 24 hours
              {record?.undo_deadline_at ? `, until ${deadline(record.undo_deadline_at)}` : ''}.
              Leads an agent has already called stay in the CRM.
            </p>
            <div className="d-card-foot">
              <button type="button" className="d-btn d-danger" onClick={undo}>
                <Icon name="undo-2" />
                {confirming ? 'Tap again to undo the import' : 'Undo this import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function deadline(at: string): string {
  return new Date(at).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
