import { useState } from 'react';
import { Icon } from '../design/index.js';
import { Button } from '../design/forms.js';
import { useToast } from '../design/ui.js';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';

/**
 * The panel at the top of a lead: what the notes add up to, what the CRM makes
 * of the lead, and what to do next.
 *
 * The next step is the part that earns the space. Everything else on the lead
 * page is a record of what happened; this is the only thing that says what to
 * do, and it says it in one line with a button that does it. The reason is
 * always shown next to it — an agent who disagrees with "ring them again" can
 * see it is because three calls went unanswered, and decide for themselves.
 *
 * The notes summary is whatever was last worked out. It is not refreshed on
 * every page load, because that is a paid model call for a lead somebody is
 * only glancing at; a "Re-read the notes" button appears when a note has been
 * added since.
 */

interface Brief {
  notes: { lines: string[]; watchOut: string | null; at: string | null; stale: boolean };
  verdict: { value: 'hot' | 'good' | 'weak' | 'junk'; why: string | null; source: 'ai' | 'rules'; at: string | null } | null;
  advice: {
    type: string;
    at: string;
    note: string;
    why: string;
    urgency: string;
    headline: string;
  } | null;
  adviceWhy: string | null;
  suggestInvalid: boolean;
}

const VERDICT_ICON: Record<string, 'flame' | 'circle-check' | 'clock-3' | 'ban'> = {
  hot: 'flame',
  good: 'circle-check',
  weak: 'clock-3',
  junk: 'ban',
};

const VERDICT_WORD: Record<string, string> = {
  hot: 'Hot',
  good: 'Good',
  weak: 'Weak',
  junk: 'Looks like junk',
};

export function LeadBrief({
  opportunityId,
  onChanged,
}: {
  opportunityId: string;
  /** Called after the next step is taken, so the page reloads around it. */
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const brief = useAsync<Brief>(() => api.get(`/api/my-leads/${opportunityId}/brief`), [opportunityId]);

  async function useSuggestion() {
    const advice = brief.data?.advice;
    if (!advice) return;
    setBusy(true);
    try {
      await api.post(`/api/my-leads/${opportunityId}/next-step`, {
        type: advice.type,
        at: advice.at,
        note: advice.note,
      });
      toast(`${advice.headline} — in your list now`);
      brief.reload();
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function reread() {
    setBusy(true);
    try {
      const result = await api.post<{ refreshed?: boolean }>(`/api/my-leads/${opportunityId}/brief`, {});
      toast(result.refreshed ? 'Notes re-read' : 'Nothing new to read — Emir AI is switched off');
      brief.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not read the notes');
    } finally {
      setBusy(false);
    }
  }

  /* Nothing yet, or nothing to say: no panel rather than an empty one. */
  if (!brief.data) return null;
  const { notes, verdict, advice, adviceWhy } = brief.data;
  if (!advice && !adviceWhy && notes.lines.length === 0 && !verdict) return null;

  return (
    <div className="brief">
      <div className="brief-head">
        <h4>
          <Icon name="radar" />
          <span>Where this stands</span>
        </h4>
        {verdict && (
          <span className={`brief-verdict is-${verdict.value}`} title={verdict.why ?? undefined}>
            <Icon name={VERDICT_ICON[verdict.value] ?? 'circle'} />
            <span>{VERDICT_WORD[verdict.value] ?? verdict.value}</span>
          </span>
        )}
      </div>

      {advice ? (
        <div className={`brief-do is-${advice.urgency}`}>
          <div className="brief-do-text">
            <strong>{advice.headline}</strong>
            <small>{advice.why}</small>
          </div>
          <Button variant="primary" size="sm" icon="check" loading={busy} onClick={() => void useSuggestion()}>
            Put it in my list
          </Button>
        </div>
      ) : (
        <p className="brief-clear">
          <Icon name="check-circle-2" />
          <span>{adviceWhy ?? 'Nothing is owed on this lead today.'}</span>
        </p>
      )}

      {notes.lines.length > 0 && (
        <ul className="brief-notes">
          {notes.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {notes.watchOut && (
        <p className="brief-watch">
          <Icon name="alert-triangle" />
          <span>{notes.watchOut}</span>
        </p>
      )}

      <footer className="brief-foot">
        {verdict?.why && <span className="brief-why">{verdict.why}</span>}
        {notes.stale && (
          <button type="button" className="brief-link" disabled={busy} onClick={() => void reread()}>
            <Icon name="refresh-cw" />
            <span>{notes.lines.length > 0 ? 'Notes have changed — re-read them' : 'Summarise the notes'}</span>
          </button>
        )}
      </footer>
    </div>
  );
}
