import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Select, useToast } from '../design/ui.js';

/**
 * Hand a lead to an agent, from wherever you are looking at it.
 *
 * It belongs on the lead and not only on a queue screen: the moment an owner
 * decides who should have a lead is the moment they are reading it, and
 * making them go somewhere else to act on that is how a lead sits unassigned
 * for an afternoon.
 *
 * Agents see who owns it and nothing else — reassigning is a manager's call.
 */
export function AssignLead({
  opportunityId, ownerName, onAssigned,
}: {
  opportunityId: string;
  ownerName: string | null;
  onAssigned?: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const canAssign = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';
  // Only fetched for the people who can act on it; an agent's panel makes no
  // request at all.
  const agents = useAsync<{ items: { id: string; name: string; role: string; is_active: number }[] }>(
    () => (canAssign ? api.get('/api/users') : Promise.resolve({ items: [] })),
    [canAssign],
  );

  if (!canAssign) return <>{ownerName ?? 'Unassigned'}</>;

  const options = (agents.data?.items ?? [])
    .filter((person) => person.is_active && person.role !== 'automation')
    .sort((a, b) => a.name.localeCompare(b.name));

  async function assign(agentUserId: string, name: string) {
    setBusy(true);
    try {
      await api.post('/api/incoming/assign', { opportunityIds: [opportunityId], agentUserId });
      toast(`Given to ${name} — they have a few minutes to accept it`);
      onAssigned?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not assign that lead');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Select
      className="assign-select"
      aria-label="Who this lead belongs to"
      disabled={busy || options.length === 0}
      /*
       * Uncontrolled on purpose: the value is whatever the lead says it is
       * after a reload, not what was last picked here. A select that keeps
       * showing a name the save failed on is a lie.
       */
      value=""
      onChange={(event) => {
        const chosen = options.find((person) => person.id === event.target.value);
        if (chosen) void assign(chosen.id, chosen.name);
      }}
    >
      <option value="">{busy ? 'Giving it over…' : (ownerName ?? 'Unassigned — give it to…')}</option>
      {options.map((person) => (
        <option key={person.id} value={person.id}>{person.name}</option>
      ))}
    </Select>
  );
}
