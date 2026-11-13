import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { ErrorNote, Spinner, budgetLabel, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';

/**
 * "VIP leads I gave" — `design/screens/OwnerAssign.dc.html`.
 *
 * The audit found this one read as a dialog on Incoming and built as nothing.
 * It is a whole owner screen: *who took the VIP leads I handed out, and how
 * are they getting on* — All / Needs you / Going well, a row per hand-off
 * with who holds it, what state it is in and one line of detail.
 *
 * **What it does not say, and why.** The design writes "given 14:20 to
 * Bassam", "Accepted in 2 min · called in 5 min" and "Not accepted yet · 24
 * min left of 30". Those live on `vip_handoffs` — given_by, accepted_at,
 * deadline_at — and no endpoint lists that table: `server/src/v2/vip.ts` only
 * accepts and refuses one by id, and `/api/v2/home` reads the single
 * hand-off waiting for the agent who is signed in. So this screen is built
 * from `/api/my-leads?tab=vip`, which an owner sees across every agent, and
 * it says only what those columns really hold. The clock, the accept time
 * and the "given at" are written down in `docs/v2/phone-questions-a.md`
 * rather than guessed — a made-up "accepted in 2 min" is a lie about an
 * agent's work, which is the worst kind to put on an owner's screen.
 */

interface Row {
  id: string;
  full_name: string | null;
  project_name: string | null;
  unit_type: string | null;
  budget_min_aed: number | null;
  budget_max_aed: number | null;
  budget_band?: string | null;
  stage_key: string;
  status: string;
  is_vip: number;
  returned_at: string | null;
  last_contact_at: string | null;
  next_step_at: string | null;
  owner_name: string | null;
}

interface ListResponse { items: Row[]; total: number }
interface Agent { id: string; name: string; open_leads: number }

type State = 'Came back' | 'Waiting' | 'Called' | 'Meeting' | 'Offer' | 'Won';

/** Which of the design's six states this hand-off is in, from real columns. */
function stateOf(row: Row): State {
  if (row.returned_at) return 'Came back';
  if (row.status === 'won' || row.stage_key === 'won') return 'Won';
  if (row.stage_key === 'deal_sent') return 'Offer';
  if (row.stage_key === 'appointment_scheduled') return 'Meeting';
  if (!row.last_contact_at) return 'Waiting';
  return 'Called';
}

const TONE: Record<State, string> = {
  'Came back': 'v2-a-vipbadge-back',
  Waiting: 'v2-a-vipbadge-wait',
  Called: 'v2-a-vipbadge-ok',
  Meeting: 'v2-a-vipbadge-meet',
  Offer: 'v2-a-vipbadge-offer',
  Won: 'v2-a-vipbadge-ok',
};

/** "Today 14:20" / "Mon 11 Nov 09:05". */
function moment(value: string | null): string {
  if (!value) return '';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  const day = (d: Date) => Math.floor((d.getTime() + 4 * 3_600_000) / 86_400_000);
  const clock = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const gap = day(at) - day(new Date());
  if (gap === 0) return `today ${clock}`;
  if (gap === -1) return `yesterday ${clock}`;
  if (gap === 1) return `tomorrow ${clock}`;
  return `${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${clock}`;
}

/** The one line under the row: what has happened to it. */
function detailOf(row: Row, state: State): string {
  if (state === 'Came back') {
    return `It came back to you ${moment(row.returned_at)}. Give it to somebody else.`;
  }
  if (state === 'Waiting') {
    return row.owner_name
      ? `${row.owner_name} has not called yet.`
      : 'Nobody holds this lead yet.';
  }
  const spoke = `Last spoken to ${moment(row.last_contact_at)}`;
  const next = row.next_step_at ? ` · next step ${moment(row.next_step_at)}` : '';
  return `${spoke}${next}.`;
}

export function V2VipGiven() {
  const { user } = useAuth();
  const canSee = user?.role === 'owner' || user?.role === 'admin';
  const [tab, setTab] = useState<'All' | 'Needs you' | 'Going well'>('All');
  const [giving, setGiving] = useState<Row | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const toast = useToast();

  const vip = useAsync<ListResponse>(
    () => (canSee
      ? api.get('/api/my-leads?tab=vip&pageSize=50')
      : Promise.resolve({ items: [], total: 0 })),
    [canSee],
  );
  const agents = useAsync<{ items: Agent[] }>(
    () => (canSee ? api.get('/api/leads/agents') : Promise.resolve({ items: [] })),
    [canSee],
  );

  usePhoneHead({
    title: 'VIP leads I gave',
    sub: 'Owner · who took them and how they are getting on',
    action: { icon: 'plus', label: 'Add a lead and give it', to: '/v2/leads/new' },
  });

  async function give(row: Row, toUserId: string, said: string) {
    setSending(true);
    try {
      await api.post(`/api/pipeline/opportunities/${row.id}/reassign`, { toUserId });
      toast(said);
      setGiving(null);
      setTo(null);
      vip.reload();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'That did not go through.');
    } finally {
      setSending(false);
    }
  }

  /* The design prints this on all four owner screens. */
  if (!canSee) {
    return (
      <div className="d-stack v2-a-vipgiven">
        <div className="d-card v2-a-none">
          <b>Only for owners and admin</b>
          <p className="d-muted">
            You are signed in as an agent. This page is not in your menu and you
            cannot open it.
          </p>
          <Link className="d-btn d-primary" to="/v2">Go to My Day</Link>
        </div>
      </div>
    );
  }

  const rows = (vip.data?.items ?? []).map((row) => ({ row, state: stateOf(row) }));
  const shown = rows.filter(({ state }) => {
    if (tab === 'All') return true;
    const needs = state === 'Came back' || state === 'Waiting';
    return tab === 'Needs you' ? needs : !needs;
  });

  return (
    <div className="d-stack v2-a-vipgiven">
      <Link className="d-btn d-primary v2-a-vip-add" to="/v2/leads/new">
        <Icon name="plus" />Add a lead and give it as VIP
      </Link>

      <div className="d-tabs d-pills" role="tablist">
        {(['All', 'Needs you', 'Going well'] as const).map((one) => (
          <button
            key={one}
            type="button"
            role="tab"
            aria-selected={tab === one}
            className={tab === one ? 'd-tab d-on' : 'd-tab'}
            onClick={() => setTab(one)}
          >
            {one}
          </button>
        ))}
      </div>

      {vip.error && <ErrorNote>{vip.error}</ErrorNote>}
      {!vip.data && !vip.error && <Spinner />}

      {vip.data && shown.map(({ row, state }) => {
        const budget = row.budget_min_aed || row.budget_max_aed
          ? budgetLabel(row.budget_min_aed, row.budget_max_aed, row.budget_band ?? null)
          : null;
        const needs = state === 'Came back' || state === 'Waiting';
        return (
          <div className="d-card v2-a-vipcard" key={row.id}>
            <div className="v2-a-viptop">
              <Link className="v2-a-vipname" to={`/v2/leads/${row.id}`}>
                {row.full_name ?? 'Unnamed lead'}
              </Link>
              <span className={`v2-a-vipbadge ${TONE[state]}`}>{state}</span>
            </div>
            <p className="v2-a-vipsub">
              {[row.project_name, row.unit_type, budget,
                row.owner_name ? `with ${row.owner_name}` : 'with nobody']
                .filter(Boolean).join(' · ')}
            </p>
            <p className="v2-a-vipline">{detailOf(row, state)}</p>
            {needs && (
              <div className="v2-a-vipacts">
                <button
                  type="button"
                  className="d-btn d-primary"
                  onClick={() => { setGiving(row); setTo(null); }}
                >
                  Give to another agent
                </button>
                {state === 'Came back' && user && (
                  <button
                    type="button"
                    className="d-btn"
                    disabled={sending}
                    onClick={() => give(row, user.id, `${row.full_name ?? 'The lead'} is now your own lead.`)}
                  >
                    I will call myself
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {vip.data && shown.length === 0 && (
        <div className="d-card v2-a-none">
          <b>Nothing here</b>
          <p className="d-muted">
            {tab === 'All'
              ? 'You have not given a VIP lead to anybody yet.'
              : 'No VIP lead is in that state right now.'}
          </p>
        </div>
      )}

      {giving && (
        <>
          <div className="d-scrim" onClick={() => setGiving(null)} aria-hidden />
          <div className="d-dialog d-open" role="dialog" aria-label="Give this lead">
            <div className="d-dialog-head">
              <b>Give {giving.full_name ?? 'this lead'} to</b>
              <button type="button" className="d-x" aria-label="Close" onClick={() => setGiving(null)}>×</button>
            </div>
            <div className="d-dialog-body v2-a-targets">
              {(agents.data?.items ?? []).map((one) => (
                <button
                  key={one.id}
                  type="button"
                  className={to === one.id ? 'v2-a-target v2-a-target-on' : 'v2-a-target'}
                  onClick={() => setTo(one.id)}
                >
                  {one.name}
                  <span className="d-small d-muted"> · {one.open_leads} open</span>
                </button>
              ))}
            </div>
            <div className="d-dialog-foot">
              <button
                type="button"
                className="d-btn d-primary"
                disabled={sending || !to}
                onClick={() => {
                  const who = (agents.data?.items ?? []).find((one) => one.id === to);
                  if (!to || !who) return;
                  void give(giving, to, `${giving.full_name ?? 'The lead'} given to ${who.name}.`);
                }}
              >
                {to
                  ? `Give to ${(agents.data?.items ?? []).find((one) => one.id === to)?.name ?? 'them'}`
                  : 'Pick an agent'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
