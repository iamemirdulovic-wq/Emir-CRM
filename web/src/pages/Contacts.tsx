import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatDateTime, humanize } from '../lib/format.js';
import { useShellSearch } from '../components/Layout.js';
import type { Card, StageKey } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { sourceStyle, stageStyle } from '../design/stages.js';
import {
  Avatar, Chip, Empty, ErrorNote, Modal, Note, Panel, Score, Spinner, Toolbar, useToast,
} from '../design/ui.js';

/** A contact whose name came out of the wrong lead-form answer. */
type SuspectName = {
  id: string;
  full_name: string;
  phone_e164: string | null;
  email: string | null;
  owner_name: string | null;
  reason: string;
};

type ContactRow = {
  id: string;
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  language: string | null;
  lead_score: number;
  first_source: string | null;
  dnc: number;
  created_at: string;
  owner_name: string | null;
  stage_key: StageKey | null;
  project_name: string | null;
};

/**
 * Every person in the CRM, as a list rather than a board. Agents see their own,
 * managers their team's, owners everything — the server decides, not this page.
 */
export function Contacts() {
  const { user, can } = useAuth();
  const toast = useToast();
  const shellSearch = useShellSearch();
  const search = useDebounced(shellSearch.value);
  const [dncOnly, setDncOnly] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const list = useAsync<{ items: ContactRow[] }>(
    () => api.get(`/api/contacts${qs({ search, pageSize: 100 })}`),
    [search],
  );
  // Agents cannot see the duplicate queue, so a 403 here is expected, not an
  // error worth surfacing.
  const duplicates = useAsync<{ items: unknown[] }>(
    () =>
      api
        .get<{ items: unknown[] }>('/api/contacts/duplicates/pending')
        .catch(() => ({ items: [] as unknown[] })),
    [],
  );

  /*
   * Contacts imported before the name fix, whose name field holds an answer to
   * a form question. Manager and up, so a 403 for an agent is expected and must
   * not turn the page into an error.
   */
  const suspects = useAsync<{ items: SuspectName[] }>(
    () =>
      api
        .get<{ items: SuspectName[] }>('/api/contacts/name-review')
        .catch(() => ({ items: [] as SuspectName[] })),
    [],
  );

  const isManager = user?.role === 'manager' || user?.role === 'admin' || user?.role === 'owner';
  const items = (list.data?.items ?? []).filter((row) => !dncOnly || row.dnc === 1);

  async function fixNames() {
    const ids = (suspects.data?.items ?? []).map((row) => row.id);
    if (ids.length === 0) return;
    setFixing(true);
    try {
      // The ids that were on screen, so nothing is changed that was not read.
      const result = await api.post<{ repaired: number; skipped: number }>(
        '/api/contacts/name-review/apply',
        { ids },
      );
      toast(
        result.skipped > 0
          ? `${result.repaired} fixed · ${result.skipped} left alone (already corrected)`
          : `${result.repaired} name${result.repaired === 1 ? '' : 's'} cleared`,
      );
      setReviewOpen(false);
      suspects.reload();
      list.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not fix the names');
    } finally {
      setFixing(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allShownSelected = items.length > 0 && items.every((row) => selected.has(row.id));

  function toggleAll() {
    setSelected(allShownSelected ? new Set() : new Set(items.map((row) => row.id)));
  }

  /**
   * Delete the selected contacts.
   *
   * Owner only, and the server checks that too — the button is hidden for
   * everyone else, but a hidden button is not a permission.
   */
  async function deleteSelected() {
    setDeleting(true);
    try {
      const result = await api.post<{ deleted: number }>('/api/lists/bulk-delete', {
        contactIds: [...selected],
        confirm: true,
      });
      toast(`${result.deleted} contact${result.deleted === 1 ? '' : 's'} deleted`);
      setSelected(new Set());
      setConfirmDelete(false);
      list.reload();
      suspects.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete those contacts');
    } finally {
      setDeleting(false);
    }
  }

  async function exportCsv() {
    try {
      // The server logs every export; this only follows the link.
      window.location.href = '/api/contacts/export/csv';
      toast('Preparing the export…');
    } catch {
      toast('Could not start the export');
    }
  }

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;

  return (
    <>
      <Toolbar
        right={
          can('export') ? (
            <button type="button" className="btn" onClick={() => void exportCsv()}>
              <Icon name="download" />
              <span>Export CSV</span>
            </button>
          ) : undefined
        }
      >
        <Chip on={!dncOnly} onClick={() => setDncOnly(false)} icon="users">
          All contacts
        </Chip>
        <Chip on={dncOnly} onClick={() => setDncOnly(true)} icon="ban">
          Do not contact
        </Chip>
        {isManager && (suspects.data?.items.length ?? 0) > 0 && (
          <Chip on={false} icon="alert-triangle" onClick={() => setReviewOpen(true)}>
            {suspects.data?.items.length} name
            {suspects.data?.items.length === 1 ? '' : 's'} to fix
          </Chip>
        )}
        {isManager && (duplicates.data?.items.length ?? 0) > 0 && (
          <span className="pill wait">
            {duplicates.data?.items.length} possible duplicate
            {duplicates.data?.items.length === 1 ? '' : 's'} to review
          </span>
        )}
      </Toolbar>

      {selected.size > 0 && (
        <div className="bulkbar rise">
          <b>
            {selected.size} selected
          </b>
          <button type="button" className="btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          {/* Owner only, matching the server. Everyone else simply does not see it. */}
          {user?.role === 'owner' && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash-2" size={15} />
              <span>Delete</span>
            </button>
          )}
        </div>
      )}

      <Panel index={1} icon="users" title={`${items.length} contact${items.length === 1 ? '' : 's'}`}>
        {list.loading && items.length === 0 && <Spinner />}
        {!list.loading && items.length === 0 && (
          <Empty icon="users" title="No contacts match" hint="Try a different search." />
        )}

        {items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <input
                      type="checkbox"
                      checked={allShownSelected}
                      onChange={toggleAll}
                      aria-label={allShownSelected ? 'Clear the selection' : 'Select every contact shown'}
                    />
                  </th>
                  <th>Name</th>
                  <th>Stage</th>
                  <th className="col-wide">Project</th>
                  <th className="col-wider">Source</th>
                  <th>Owner</th>
                  <th>Score</th>
                  <th className="col-wide">Added</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const source = sourceStyle(row.first_source);
                  return (
                    <tr key={row.id} className={selected.has(row.id) ? 'picked' : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                          aria-label={`Select ${row.full_name ?? row.phone_e164 ?? 'this contact'}`}
                        />
                      </td>
                      <td>
                        <div className="rank">
                          <Avatar name={row.full_name} size={26} />
                          <div style={{ minWidth: 0 }}>
                            <Link to={`/contacts/${row.id}`} style={{ fontWeight: 600, color: 'var(--ink)' }}>
                              {row.full_name ?? 'Unnamed'}
                            </Link>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {row.phone_e164 ?? row.email ?? '—'}
                            </div>
                          </div>
                          {row.dnc === 1 && <span className="pill due">DNC</span>}
                        </div>
                      </td>
                      <td>
                        {row.stage_key ? (
                          <span
                            className="pill"
                            style={{ color: stageStyle(row.stage_key).colour, borderColor: 'transparent' }}
                          >
                            {humanize(row.stage_key)}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="col-wide">{row.project_name ?? <span className="muted">—</span>}</td>
                      <td className="col-wider">
                        <span className="src">
                          <span className="ch" style={{ background: source.colour }}>
                            <Icon name={source.icon} />
                          </span>
                          {source.label}
                        </span>
                      </td>
                      <td>{row.owner_name ?? <span className="muted">Unassigned</span>}</td>
                      <td>
                        <Score value={row.lead_score} />
                      </td>
                      <td className="muted col-wide">{formatDateTime(row.created_at)}</td>
                      <td>
                        <Link className="rowbtn" to={`/inbox?contact=${row.id}`}>
                          Open thread
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${selected.size} contact${selected.size === 1 ? '' : 's'}?`}
        icon="alert-triangle"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              Keep them
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void deleteSelected()}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : `Yes, delete ${selected.size}`}
            </button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          This cannot be undone. Their conversations, tasks, notes and pipeline history go with
          them.
        </p>
        <Note>
          The deletion is recorded in the audit log against your name. Only the owner can do this.
        </Note>
      </Modal>

      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Names that are not names"
        icon="alert-triangle"
        wide
        footer={
          <>
            <button type="button" className="btn" onClick={() => setReviewOpen(false)}>
              Leave them
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void fixNames()}
              disabled={fixing || (suspects.data?.items.length ?? 0) === 0}
            >
              {fixing ? 'Fixing…' : `Fix all ${suspects.data?.items.length ?? 0}`}
            </button>
          </>
        }
      >
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          These came from an import where the file stacked several Meta forms together, so the name
          column held an answer to a question instead of a name. Fixing them clears the name — the
          inbox then shows the phone number — and keeps the text on each contact&rsquo;s timeline,
          because for some of them it is the most useful line in the record.
        </p>

        {suspects.loading && <Spinner />}

        {!suspects.loading && (suspects.data?.items.length ?? 0) === 0 && (
          <Empty icon="check-circle-2" title="Nothing to fix" hint="Every name looks like a name." />
        )}

        {(suspects.data?.items.length ?? 0) > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Stored as a name</th>
                  <th>Why it is wrong</th>
                  <th>Reachable on</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {(suspects.data?.items ?? []).map((row) => (
                  <tr key={row.id}>
                    {/* Clipped in CSS as well as in JS: a 300-character answer
                        with no spaces would otherwise stretch the cell and push
                        the reason out of its own column. */}
                    <td className="clip" title={row.full_name}>
                      <Link to={`/inbox?contact=${row.id}`} className="rowbtn">
                        {row.full_name.length > 44 ? `${row.full_name.slice(0, 44)}…` : row.full_name}
                      </Link>
                    </td>
                    <td className="muted">{row.reason}</td>
                    <td className="muted">{row.phone_e164 ?? row.email ?? '—'}</td>
                    <td className="muted">{row.owner_name ?? 'Unassigned'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}
