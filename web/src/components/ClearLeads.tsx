import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Input, Note, Panel, Spinner, useToast } from '../design/ui.js';

/**
 * Start the leads again.
 *
 * Emir asked for this on 10 Nov 2026 after a supplier's spreadsheet arrived
 * with its columns sorted apart — 694 rows where the name, the number and the
 * email each belonged to a different person, already imported and already
 * being worked. He chose a clean start over a repair.
 *
 * Everything about this screen is built to be slow to press by accident and
 * impossible to misread: the counts are real and fetched before anything
 * happens, what stays is listed beside what goes, and the button does nothing
 * until the phrase is typed exactly. It is the only control in the CRM that
 * cannot be undone, and it says so three times.
 */

interface Counts {
  contacts: number;
  opportunities: number;
  offers: number;
  messages: number;
  activities: number;
  inboundEvents: number;
  imports: number;
  jobs: number;
}

export function ClearLeads() {
  const { user } = useAuth();
  const toast = useToast();
  const data = useAsync<{ counts: Counts; phrase: string }>(() => api.get('/api/company/lead-data'), []);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Counts | null>(null);

  /* The server refuses anybody else; this stops the panel being rendered at
     all for a manager who lands on the tab. */
  if (user?.role !== 'owner') return null;

  const phrase = data.data?.phrase ?? 'DELETE ALL LEADS';
  const counts = data.data?.counts;
  const armed = typed.trim() === phrase;

  async function run() {
    if (!armed || busy) return;
    setBusy(true);
    try {
      const result = await api.post<{ removed: Counts; leftBehind: { table: string; rows: number }[] }>(
        '/api/company/clear-leads',
        { confirm: typed.trim() },
      );
      setDone(result.removed);
      setTyped('');
      /* Read back from the server rather than assume: if anything survived,
         say so instead of reporting a clean sweep. */
      if (result.leftBehind.length > 0) {
        toast(`Cleared, but ${result.leftBehind.length} table(s) still hold rows. Tell Claude.`);
      } else {
        toast('Every lead removed. The CRM is empty and ready for the clean file.');
      }
      data.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not clear the leads');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Panel span={12} index={0} icon="check-circle-2" title="The CRM is empty">
        <p className="note-ok">
          <Icon name="check-circle-2" />
          Removed {done.contacts.toLocaleString()} contacts, {done.opportunities.toLocaleString()} leads,{' '}
          {done.messages.toLocaleString()} messages and {done.offers.toLocaleString()} offers.
        </p>
        <Note>
          Import the corrected file now — <b>Import leads</b> in the sidebar. Every row lands as a new
          person, so what the file says is what the CRM will hold.
        </Note>
      </Panel>
    );
  }

  return (
    <Panel span={12} index={0} icon="alert-triangle" title="Start the leads again">
      {!data.data && <Spinner label="Counting what is in there…" />}
      {counts && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            This removes every lead in the CRM, permanently. There is no undo, in the CRM or anywhere
            else. The only way back is a database backup from your hosting panel.
          </p>

          <div className="clear-cols">
            <div className="clear-side goes">
              <b><Icon name="trash-2" /> Deleted for good</b>
              <ul>
                <li>{counts.contacts.toLocaleString()} contacts</li>
                <li>{counts.opportunities.toLocaleString()} leads in the pipeline</li>
                <li>{counts.messages.toLocaleString()} WhatsApp and email messages</li>
                <li>{counts.activities.toLocaleString()} notes, calls and history</li>
                <li>{counts.offers.toLocaleString()} sales offers</li>
                <li>{counts.imports.toLocaleString()} past imports</li>
                <li>Tasks, follow-ups and everything queued</li>
              </ul>
            </div>
            <div className="clear-side stays">
              <b><Icon name="shield-check" /> Kept</b>
              <ul>
                <li>Your team and their logins</li>
                <li>Desks and teams</li>
                <li>The project library and developers</li>
                <li>WhatsApp templates</li>
                <li>Every setting, including routing</li>
                <li>Attendance and the Team Wall</li>
                <li>The audit log</li>
              </ul>
            </div>
          </div>

          <Note>
            Take a database backup in your hosting panel first. It costs a minute and it is the only
            thing that can bring any of this back.
          </Note>

          <label className="field" style={{ marginTop: 14 }}>
            <span>Type <b>{phrase}</b> to turn the button on</span>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={phrase}
              autoComplete="off"
              spellCheck={false}
              aria-label={`Type ${phrase} to confirm`}
            />
          </label>

          <button
            type="button"
            className="btn btn-danger"
            style={{ marginTop: 12 }}
            disabled={!armed || busy}
            onClick={() => void run()}
          >
            <Icon name="trash-2" />
            {busy ? 'Removing every lead…' : `Delete all ${counts.contacts.toLocaleString()} leads for ever`}
          </button>
        </>
      )}
    </Panel>
  );
}
