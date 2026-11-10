import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Icon } from '../design/index.js';

/**
 * Straight on to the next one.
 *
 * Emir, 10 Nov 2026: "next in the right should be button, next leads, so it
 * will be going next leads, so it's easy." Before this, finishing a call
 * meant going back to My Leads and finding your place again — forty calls,
 * forty detours.
 *
 * Fetched rather than guessed, so the button can say whose name is next and
 * disappear when there is nobody left. Oldest open lead first, which is the
 * one going coldest and the same order the list already uses.
 */
export function NextLead({ opportunityId }: { opportunityId: string }) {
  const navigate = useNavigate();
  const [next, setNext] = useState<{ contact_id: string; full_name: string | null } | null>(null);
  const [asked, setAsked] = useState(false);

  const look = useCallback(async () => {
    try {
      const { next: found } = await api.get<{
        next: { id: string; contact_id: string; full_name: string | null } | null;
      }>(`/api/my-leads/${opportunityId}/next`);
      setNext(found);
    } catch {
      /* Not worth an error on a convenience button; it simply does not
         appear, and My Leads is one tap away. */
      setNext(null);
    } finally {
      setAsked(true);
    }
  }, [opportunityId]);

  useEffect(() => { void look(); }, [look]);

  if (!asked || !next) return null;

  return (
    <button
      type="button"
      className="btn next-lead"
      onClick={() => navigate(`/contacts/${next.contact_id}`)}
      title={next.full_name ? `Next: ${next.full_name}` : 'The next lead waiting'}
    >
      Next lead
      <Icon name="arrow-right" />
    </button>
  );
}
