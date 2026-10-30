import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Button } from '../design/forms.js';
import { Field, Input, Note, Panel, Spinner, ErrorNote, useToast } from '../design/ui.js';

/**
 * The dials behind the five-minute rule.
 *
 * Every field says in plain words what it does to a lead, because the person
 * changing them runs a brokerage and should not have to guess what "SLA"
 * means or what happens at zero.
 */

interface Routing {
  slaMinutes: number;
  reminderMinutes: number;
  autoAssign: boolean;
  bounceToOwner: boolean;
  emailOwnerOnNewLead: boolean;
  quietHours: boolean;
  quietStart: string;
  quietEnd: string;
}

export function RoutingSettings() {
  const toast = useToast();
  const loaded = useAsync<Routing>(() => api.get('/api/incoming/settings'), []);
  const [draft, setDraft] = useState<Routing | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loaded.data) setDraft(loaded.data);
  }, [loaded.data]);

  if (loaded.error) return <ErrorNote>{loaded.error}</ErrorNote>;
  if (!draft) return <Spinner />;

  const set = <K extends keyof Routing>(key: K, value: Routing[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await api.patch<Routing>('/api/incoming/settings', draft);
      setDraft(saved);
      /* Show what was stored, not what was typed: the server caps the
         reminder against the deadline, and the owner should see that happen. */
      toast('Saved');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save that');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel span={12} index={0} icon="timer" title="How leads are given out">
      <div className="routing-grid">
        <Field
          label="How long an agent has"
          hint={`They have ${draft.slaMinutes} minute${draft.slaMinutes === 1 ? '' : 's'} to accept a new lead, then the same again to call. Miss either and it comes back to you.`}
        >
          <Input
            type="number" min={1} max={120} value={draft.slaMinutes}
            onChange={(event) => set('slaMinutes', Number(event.target.value))}
          />
        </Field>

        <Field
          label="Remind them when this many minutes are left"
          hint={draft.reminderMinutes === 0
            ? 'No reminder — the agent only finds out when the lead is taken away.'
            : `A nudge on their phone with ${draft.reminderMinutes} minute${draft.reminderMinutes === 1 ? '' : 's'} to go. Set 0 to turn it off.`}
        >
          <Input
            type="number" min={0} max={Math.max(0, draft.slaMinutes - 1)} value={draft.reminderMinutes}
            onChange={(event) => set('reminderMinutes', Number(event.target.value))}
          />
        </Field>
      </div>

      <Switch
        label="Give new leads out automatically"
        on={draft.autoAssign}
        onChange={(on) => set('autoAssign', on)}
        hint={draft.autoAssign
          ? 'A lead arriving at 3am is given to an agent straight away and the client gets a WhatsApp within seconds.'
          : 'Every lead waits in Incoming until you hand it to someone. Nothing goes out until you do.'}
      />

      <Switch
        label="Bring a missed lead back to me"
        on={draft.bounceToOwner}
        onChange={(on) => set('bounceToOwner', on)}
        hint={draft.bounceToOwner
          ? 'When an agent runs out of time, the lead comes back to Incoming for you to place.'
          : 'When an agent runs out of time, the lead goes straight to the next available agent instead.'}
      />

      <Switch
        label="Email me when a lead arrives"
        on={draft.emailOwnerOnNewLead}
        onChange={(on) => set('emailOwnerOnNewLead', on)}
        hint="Turn this off once the volume gets high — fifty leads a day is fifty emails."
      />

      <Switch
        label="Pause the clock overnight"
        on={draft.quietHours}
        onChange={(on) => set('quietHours', on)}
        hint={draft.quietHours
          ? 'Clients still get their WhatsApp reply at any hour. Agents are not held to the clock while they are asleep — it starts again in the morning.'
          : 'The clock runs all night. A lead arriving at 3am is taken off the agent at 3:05.'}
      />

      {draft.quietHours && (
        <div className="routing-grid">
          {/*
            * The browser draws this control in its own language, so it may
            * show 10:00 PM however the page is tagged. The stored value is
            * echoed underneath, in the 24-hour form the rest of the CRM uses,
            * so there is never a question of which hour was meant.
            */}
          <Field label="Night starts" hint={`Dubai time. Saved as ${draft.quietStart}.`}>
            <Input
              type="time" value={draft.quietStart}
              onChange={(event) => set('quietStart', event.target.value)}
            />
          </Field>
          <Field label="Morning starts" hint={`The clock starts again at ${draft.quietEnd}.`}>
            <Input
              type="time" value={draft.quietEnd}
              onChange={(event) => set('quietEnd', event.target.value)}
            />
          </Field>
        </div>
      )}

      <Note>
        These change what happens to the next lead, not the ones already with an agent.
      </Note>

      <Button variant="primary" loading={saving} onClick={() => void save()}>Save</Button>
    </Panel>
  );
}

function Switch({
  label, hint, on, onChange,
}: { label: string; hint: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="routing-switch">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={on ? 'switch' : 'switch off'}
        onClick={() => onChange(!on)}
      />
      <div>
        <b>{label}</b>
        {/* The consequence, not the setting restated — it changes with the
            switch so the owner reads what will actually happen. */}
        <small>{hint}</small>
      </div>
    </div>
  );
}
