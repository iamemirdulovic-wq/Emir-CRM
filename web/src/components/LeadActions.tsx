import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { Button } from '../design/forms.js';
import { WhenField, localInputValue } from '../design/forms.js';
import { BottomSheet } from '../design/feedback.js';
import { Icon } from '../design/index.js';
import { Chip, Field, TextArea, useToast } from '../design/ui.js';
import { celebrate } from '../lib/celebrate.js';

/**
 * The buttons an agent presses all day, and the two questions that follow.
 *
 * The design rule here is three taps: Call → how did it go → when next. Every
 * sheet below is one of those taps, and none of them has a field that can be
 * left blank without the CRM knowing what that means.
 */

export type LeadAction =
  | 'call' | 'whatsapp' | 'no_answer' | 'call_back'
  | 'interested' | 'meeting' | 'problem' | 'lost' | 'won';

export interface ActionResult {
  stageKey: string | null;
  status: 'open' | 'won' | 'lost';
  nextStepAt: string | null;
  needsNextStep: boolean;
  said: string;
}

const LOST_REASONS: [string, string][] = [
  ['bought_elsewhere', 'Bought elsewhere'],
  ['budget_too_low', 'Budget too low'],
  ['just_browsing', 'Just browsing'],
  ['not_reachable', 'Not reachable'],
  ['changed_plans', 'Changed plans'],
  ['other', 'Something else'],
];

const PROBLEM_REASONS: [string, string][] = [
  ['wrong_number', 'Wrong number'],
  ['not_reachable', 'Not reachable'],
  ['budget_too_low', 'Budget too low'],
  ['not_decision_maker', 'Not the decision-maker'],
  ['other', 'Something else'],
];

const MEETING_KINDS = ['Office meeting', 'Site visit', 'Show flat', 'Video call'];

type Sheet = null | 'call_result' | 'next_step' | 'meeting' | 'problem' | 'lost' | 'won';

export function useLeadActions(opportunityId: string, onChanged: () => void) {
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [pendingNext, setPendingNext] = useState(false);

  async function run(action: LeadAction, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const result = await api.post<ActionResult>(`/api/my-leads/${opportunityId}/action`, { action, ...extra });
      toast(result.said);
      if (action === 'won') celebrate({ big: true });
      onChanged();

      /*
       * The rule that keeps the No next step tab empty: after anything that
       * leaves the lead open with nothing promised, ask. Skipping is allowed
       * — the lead then shows up in that tab, which is the point.
       */
      if (result.needsNextStep) {
        setPendingNext(true);
        setSheet('next_step');
      } else {
        setSheet(null);
      }
      return result;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not save. Try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Set what is owed next, on its own, without another action. */
  async function setNextStep(type: string, at: string, note: string | null) {
    setBusy(true);
    try {
      await api.post(`/api/my-leads/${opportunityId}/next-step`, { type, at, note });
      toast('Next step set');
      onChanged();
      setSheet(null);
      setPendingNext(false);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return { sheet, setSheet, busy, run, pendingNext, setPendingNext, setNextStep };
}

export function LeadActionSheets({ state }: { state: ReturnType<typeof useLeadActions> }) {
  const { sheet, setSheet, busy, run, pendingNext, setPendingNext } = state;
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const [kind, setKind] = useState(MEETING_KINDS[0] as string);
  const [where, setWhere] = useState('');
  const [unit, setUnit] = useState('');

  function close() {
    setSheet(null);
    setPendingNext(false);
    setReason('');
    setNote('');
    setWhen('');
    setUnit('');
    setWhere('');
  }

  return (
    <>
      {/* How did the call go? Four answers, each of which moves the lead. */}
      <BottomSheet open={sheet === 'call_result'} title="How did it go?" onClose={close}>
        <Button variant="primary" block icon="check-circle-2" disabled={busy}
          onClick={() => void run('interested')}>
          Talked — interested
        </Button>
        <Button block icon="clock-3" disabled={busy}
          onClick={() => { setSheet('next_step'); }}>
          Talked — not now
        </Button>
        <Button block icon="phone-outgoing" disabled={busy} onClick={() => void run('no_answer')}>
          No answer
        </Button>
        <Button block icon="circle-x" disabled={busy}
          onClick={() => { setReason('wrong_number'); setSheet('problem'); }}>
          Wrong number
        </Button>
      </BottomSheet>

      {/* What's next? The question that stops a lead being forgotten. */}
      <BottomSheet
        open={sheet === 'next_step'}
        title={pendingNext ? 'What’s next?' : 'When should you come back?'}
        onClose={close}
        footer={
          <Button
            variant="ghost"
            block
            onClick={close}
          >
            {/* Skipping is allowed and honest about the consequence. */}
            Skip — it goes in “No next step”
          </Button>
        }
      >
        <WhenField value={when} onChange={setWhen} />
        <Field label="A word about why, so future-you knows">
          <TextArea rows={2} value={note} onChange={(event) => setNote(event.target.value)}
            placeholder="Waiting on the payment plan" />
        </Field>
        <Button
          variant="primary" block loading={busy} disabled={!when}
          onClick={() => void state.setNextStep('call', when, note || null)}
        >
          Set it
        </Button>
      </BottomSheet>

      <BottomSheet open={sheet === 'meeting'} title="Book it in" onClose={close}>
        <Field label="What kind?">
          <div className="chip-row">
            {MEETING_KINDS.map((item) => (
              <Chip key={item} on={kind === item} onClick={() => setKind(item)}>{item}</Chip>
            ))}
          </div>
        </Field>
        <Field label="When?">
          <WhenField value={when} onChange={setWhen} />
        </Field>
        <Field label="Where?">
          <TextArea rows={2} value={where} onChange={(event) => setWhere(event.target.value)}
            placeholder="Sales centre, Dubai Marina" />
        </Field>
        <Button variant="primary" block loading={busy} disabled={!when}
          onClick={() => void run('meeting', { meetingAt: when, meetingKind: kind, meetingWhere: where })}>
          Book it
        </Button>
      </BottomSheet>

      {/* Both of these require a reason — the reports depend on it. */}
      <ReasonSheet
        open={sheet === 'problem'}
        title="What’s the problem?"
        reasons={PROBLEM_REASONS}
        reason={reason} setReason={setReason}
        note={note} setNote={setNote}
        busy={busy}
        confirm="Flag it"
        onClose={close}
        onConfirm={() => void run('problem', { reason, note })}
      />

      <ReasonSheet
        open={sheet === 'lost'}
        title="Why is it lost?"
        reasons={LOST_REASONS}
        reason={reason} setReason={setReason}
        note={note} setNote={setNote}
        busy={busy}
        confirm="Mark it Lost"
        danger
        onClose={close}
        onConfirm={() => void run('lost', { reason, note })}
      />

      <BottomSheet open={sheet === 'won'} title="Nice one 🏆" onClose={close}>
        <Field label="Which unit?" hint="Optional — it goes on the Team Wall.">
          <TextArea rows={1} value={unit} onChange={(event) => setUnit(event.target.value)}
            placeholder="2 BR, floor 14" />
        </Field>
        <Button variant="primary" block loading={busy} onClick={() => void run('won', { wonUnit: unit })}>
          Mark it Won
        </Button>
      </BottomSheet>
    </>
  );
}

function ReasonSheet({
  open, title, reasons, reason, setReason, note, setNote, busy, confirm, danger, onClose, onConfirm,
}: {
  open: boolean;
  title: string;
  reasons: [string, string][];
  reason: string;
  setReason: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  busy: boolean;
  confirm: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      <div className="chip-row">
        {reasons.map(([value, label]) => (
          <Chip key={value} on={reason === value} onClick={() => setReason(value)}>{label}</Chip>
        ))}
      </div>
      <Field label="Anything to add?">
        <TextArea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      {/* Disabled until a reason is picked: without one the lost-reasons
          report, which is what tells the owner what to fix, says nothing. */}
      <Button
        variant={danger ? 'danger' : 'primary'}
        block loading={busy} disabled={!reason}
        onClick={onConfirm}
      >
        {confirm}
      </Button>
    </BottomSheet>
  );
}

/** The row of buttons itself, used on the list and on the lead page. */
export function LeadActionBar({
  lead, state, compact,
}: {
  lead: { id: string; contact_id: string; phone_e164: string | null; full_name: string | null; project_name: string | null };
  state: ReturnType<typeof useLeadActions>;
  compact?: boolean;
}) {
  const { setSheet, run, busy } = state;
  const tel = lead.phone_e164 ? `tel:${lead.phone_e164}` : null;
  const greeting = encodeURIComponent(
    `Hi ${(lead.full_name ?? '').split(' ')[0] || 'there'}, this is your advisor at Emigeo Homes 👋 `
    + `Thank you for your interest${lead.project_name ? ` in ${lead.project_name}` : ''}. `
    + 'When is a good time for a quick call?',
  );
  const wa = lead.phone_e164 ? `https://wa.me/${lead.phone_e164.replace(/\D/g, '')}?text=${greeting}` : null;

  return (
    <div className={compact ? 'lead-actions compact' : 'lead-actions'}>
      {tel && (
        <a
          className="btn btn-primary" href={tel}
          /* The keyboard shortcut presses this button rather than
             reimplementing it, so C does exactly what the mouse does —
             including logging the call and opening the "how did it go" sheet. */
          data-lead-action="call"
          onClick={() => {
            /* Logged on the way out, then the sheet asks how it went when
               they come back to the tab. */
            void run('call');
            setSheet('call_result');
          }}
        >
          <Icon name="phone" />
          {!compact && 'Call'}
        </a>
      )}
      {wa && (
        <a
          className="btn btn-wa" href={wa} target="_blank" rel="noreferrer"
          data-lead-action="whatsapp"
          onClick={() => void run('whatsapp')}
        >
          <Icon name="message-circle" />
          {!compact && 'WhatsApp'}
        </a>
      )}
      <Button icon="clock-3" disabled={busy} onClick={() => setSheet('next_step')}>
        {!compact && 'Call back'}
      </Button>
      {!compact && (
        <>
          <Button icon="calendar-check" disabled={busy} onClick={() => setSheet('meeting')}>Meeting</Button>
          <Button icon="alert-triangle" disabled={busy} onClick={() => setSheet('problem')}>Problem</Button>
          <Button icon="circle-x" disabled={busy} onClick={() => setSheet('lost')}>Lost</Button>
          <Button variant="primary" icon="trophy" disabled={busy} onClick={() => setSheet('won')}>Won</Button>
        </>
      )}
    </div>
  );
}

export { localInputValue };
