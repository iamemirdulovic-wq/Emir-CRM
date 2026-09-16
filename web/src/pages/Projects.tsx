import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { formatAed, formatDateTime, humanize } from '../lib/format.js';
import { useShellSearch } from '../components/Layout.js';
import type { ProjectRow } from '../lib/types.js';
import { Icon } from '../design/index.js';
import { Chip, Empty, ErrorNote, Note, Panel, Spinner, Toolbar, useToast } from '../design/ui.js';

/**
 * The off-plan library.
 *
 * This is the only place prices, handover dates and payment plans may come
 * from: a hard rule of the specification is that the CRM never invents them.
 * A project that has not been verified is shown as unverified, and the
 * automations will not quote from it.
 */
export function Projects() {
  const { user } = useAuth();
  const toast = useToast();
  const shellSearch = useShellSearch();
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const list = useAsync<{ items: ProjectRow[] }>(() => api.get('/api/projects'), []);
  const [busy, setBusy] = useState<string | null>(null);

  const canVerify = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';
  const query = shellSearch.value.trim().toLowerCase();

  const items = (list.data?.items ?? [])
    .filter((project) => !verifiedOnly || project.verified_at)
    .filter(
      (project) =>
        !query ||
        project.name.toLowerCase().includes(query) ||
        project.developer.toLowerCase().includes(query) ||
        (project.area ?? '').toLowerCase().includes(query),
    );

  async function setVerified(project: ProjectRow, verified: boolean) {
    setBusy(project.id);
    try {
      await api.post(`/api/projects/${project.id}/${verified ? 'verify' : 'unverify'}`);
      toast(verified ? `${project.name} verified` : `${project.name} marked unverified`);
      list.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not change the project');
    } finally {
      setBusy(null);
    }
  }

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;
  if (list.loading && !list.data) return <Spinner />;

  const unverified = (list.data?.items ?? []).filter((project) => !project.verified_at).length;

  return (
    <>
      <Toolbar>
        <Chip on={!verifiedOnly} icon="building-2" onClick={() => setVerifiedOnly(false)}>
          All projects
        </Chip>
        <Chip on={verifiedOnly} icon="shield-check" onClick={() => setVerifiedOnly(true)}>
          Verified only
        </Chip>
        {unverified > 0 && (
          <span className="pill wait">
            {unverified} not verified
          </span>
        )}
      </Toolbar>

      <Panel index={1} icon="building-2" title={`${items.length} project${items.length === 1 ? '' : 's'}`}>
        {items.length === 0 && <Empty icon="building-2" title="No projects match" />}

        {items.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Developer</th>
                  <th>Emirate</th>
                  <th className="money">From</th>
                  <th>Handover</th>
                  <th>Golden Visa</th>
                  <th>Verified</th>
                  {canVerify && <th />}
                </tr>
              </thead>
              <tbody>
                {items.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <b>{project.name}</b>
                      {project.area && (
                        <div className="muted" style={{ fontSize: 12 }}>{project.area}</div>
                      )}
                    </td>
                    <td>{project.developer}</td>
                    <td>{humanize(project.emirate)}</td>
                    <td className="money">
                      {project.starting_price_aed ? `AED ${formatAed(project.starting_price_aed)}` : '—'}
                    </td>
                    <td>{project.handover_date ? formatDateTime(project.handover_date) : '—'}</td>
                    <td>{project.golden_visa_eligible === 1 ? <span className="pill ok">Eligible</span> : '—'}</td>
                    <td>
                      {project.verified_at ? (
                        <span className="pill ok">{formatDateTime(project.verified_at)}</span>
                      ) : (
                        <span className="pill due">Not verified</span>
                      )}
                    </td>
                    {canVerify && (
                      <td>
                        <button
                          type="button"
                          className="rowbtn"
                          disabled={busy === project.id}
                          onClick={() => void setVerified(project, !project.verified_at)}
                        >
                          {project.verified_at ? 'Unverify' : 'Verify'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Note>
          Prices, handover dates and payment plans are quoted to leads only from verified rows here.
          Nothing in the CRM invents them. <Icon name="shield-check" size={14} />
        </Note>
      </Panel>
    </>
  );
}
