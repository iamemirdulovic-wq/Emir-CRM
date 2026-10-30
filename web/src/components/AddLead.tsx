import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { BudgetRange, Button, Combobox, CurrencyInput, PhoneInput } from '../design/forms.js';
import { Icon } from '../design/index.js';
import { Chip, Field, Input, Modal, TextArea, useToast } from '../design/ui.js';
import { celebrate } from '../lib/celebrate.js';

/**
 * Adding a lead by hand: a walk-in, a referral, a number from a roadshow.
 *
 * Three steps, not one long form. An agent standing in front of a client has
 * about twenty seconds of their attention, and a wall of twenty fields gets
 * the first two filled in and abandoned. Only the name and a way to reach them
 * are required; everything after step one can be left blank and filled in from
 * the lead page later.
 */

type Step = 1 | 2 | 3;

interface Agent { id: string; name: string; open_leads: number }

interface Duplicate {
  found: boolean;
  canOpen?: boolean;
  contactId?: string;
  name?: string | null;
  ownerName?: string | null;
}

const UNIT_TYPES = ['Studio', '1 BR', '2 BR', '3 BR', '4 BR', '5 BR+', 'Villa', 'Townhouse', 'Penthouse', 'Plot'];

const SOURCES: { value: string; label: string; icon: Parameters<typeof Chip>[0]['icon'] }[] = [
  { value: 'walk_in', label: 'Walk-in', icon: 'building' },
  { value: 'referral', label: 'Referral', icon: 'users' },
  { value: 'instagram', label: 'Instagram', icon: 'instagram' },
  { value: 'meta_lead_ads', label: 'Meta', icon: 'facebook' },
  { value: 'google_ads', label: 'Google', icon: 'globe' },
  { value: 'whatsapp_direct', label: 'WhatsApp', icon: 'message-circle' },
  { value: 'event', label: 'Event', icon: 'megaphone' },
  { value: 'website', label: 'Website', icon: 'globe' },
  { value: 'manual', label: 'Other', icon: 'plus' },
];

export function AddLead({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneOk, setPhoneOk] = useState(true);
  const [email, setEmail] = useState('');
  const [project, setProject] = useState('');
  const [location, setLocation] = useState('');
  const [unitType, setUnitType] = useState('');
  const [budget, setBudget] = useState<[number | null, number | null]>([null, null]);
  const [purpose, setPurpose] = useState<'investment' | 'end_use' | ''>('');
  const [timeline, setTimeline] = useState('');
  const [source, setSource] = useState('walk_in');
  const [referredBy, setReferredBy] = useState('');
  const [note, setNote] = useState('');
  const [assignTo, setAssignTo] = useState<string | null>(null);

  const canAssign = user?.role !== 'agent';

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setProblem(null);
    setDuplicate(null);
    if (canAssign) {
      void api.get<{ items: Agent[] }>('/api/leads/agents')
        .then((data) => setAgents(data.items))
        .catch(() => setAgents([]));
    }
  }, [open, canAssign]);

  /*
   * The duplicate check runs while they type, but only after a pause: firing
   * on every keystroke would ask the server about "+9715", "+97150", "+971501"
   * and so on, none of which is a number.
   */
  const checkTimer = useRef<number | null>(null);
  const checkDuplicate = useCallback((nextPhone: string, nextEmail: string) => {
    if (checkTimer.current) window.clearTimeout(checkTimer.current);
    if (!nextPhone && !nextEmail) {
      setDuplicate(null);
      return;
    }
    checkTimer.current = window.setTimeout(() => {
      void api.post<Duplicate>('/api/leads/check', { phone: nextPhone, email: nextEmail })
        .then(setDuplicate)
        .catch(() => setDuplicate(null));
    }, 400);
  }, []);

  useEffect(() => () => {
    if (checkTimer.current) window.clearTimeout(checkTimer.current);
  }, []);

  const step1Done = fullName.trim().length > 0 && (phone !== '' || email.trim() !== '') && phoneOk;

  async function save() {
    setSaving(true);
    setProblem(null);
    try {
      const created = await api.post<{ contactId: string; isNewContact: boolean }>('/api/leads', {
        fullName: fullName.trim(),
        ...(phone ? { phone } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(project ? { projectName: project } : {}),
        ...(location ? { preferredLocation: location } : {}),
        ...(unitType ? { unitType } : {}),
        ...(budget[0] !== null ? { budgetMinAed: budget[0] } : {}),
        ...(budget[1] !== null ? { budgetMaxAed: budget[1] } : {}),
        ...(purpose ? { purpose } : {}),
        ...(timeline ? { timeline } : {}),
        source,
        ...(referredBy.trim() ? { referredBy: referredBy.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(canAssign && assignTo ? { assignToUserId: assignTo } : {}),
      });

      celebrate();
      toast('Lead added — now let’s close the deal! 🤝');
      onClose();
      /* Straight to the lead, where the call buttons are. Adding a lead is
         never the goal; calling them is. */
      navigate(`/contacts/${created.contactId}`);
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add your lead 🚀"
      icon="user-plus"
      footer={
        <div className="add-foot">
          <span className="add-dots" aria-hidden>
            {([1, 2, 3] as Step[]).map((n) => (
              <i key={n} className={n === step ? 'on' : n < step ? 'done' : undefined} />
            ))}
          </span>
          {step > 1 && (
            <Button onClick={() => setStep((s) => (s - 1) as Step)}>Back</Button>
          )}
          {step < 3 ? (
            <Button variant="primary" disabled={step === 1 && !step1Done} onClick={() => setStep((s) => (s + 1) as Step)}>
              Next
            </Button>
          ) : (
            <Button variant="primary" loading={saving} onClick={() => void save()}>Save lead</Button>
          )}
        </div>
      }
    >
      <p className="add-sub">Every lead is a deal waiting to close. Yallah!</p>

      <nav className="add-steps" aria-label="Steps">
        <span className={step === 1 ? 'on' : undefined}>Who</span>
        <span className={step === 2 ? 'on' : undefined}>What they want</span>
        <span className={step === 3 ? 'on' : undefined}>Where from</span>
      </nav>

      {step === 1 && (
        <>
          <Field label={<>Full name <em className="req">*</em></>}>
            <Input
              autoFocus value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Ahmed Khan"
            />
          </Field>

          <PhoneInput
            value={phone}
            required
            onChange={(e164, valid) => {
              setPhone(e164);
              setPhoneOk(valid);
              checkDuplicate(e164, email);
            }}
          />

          <Field label="Email" hint="Optional, but a second way to reach them.">
            <Input
              type="email" value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                checkDuplicate(phone, event.target.value);
              }}
              placeholder="ahmed@example.com"
            />
          </Field>

          {duplicate?.found && <DuplicateNote duplicate={duplicate} onOpen={onClose} />}
        </>
      )}

      {step === 2 && (
        <>
          <Field label="Project">
            <Combobox
              allowFree value={project} onChange={setProject}
              placeholder="Search the library, or type it"
              options={[]}
            />
          </Field>

          <Field label="Area">
            <Input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Dubai Marina" />
          </Field>

          <Field label="What are they after?">
            <div className="chip-row">
              {UNIT_TYPES.map((type) => (
                <Chip key={type} on={unitType === type} onClick={() => setUnitType(unitType === type ? '' : type)}>
                  {type}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label="Budget">
            <BudgetRange min={budget[0]} max={budget[1]} onChange={(low, high) => setBudget([low, high])} />
          </Field>

          <Field label="Why are they buying?">
            <div className="chip-row">
              <Chip on={purpose === 'investment'} onClick={() => setPurpose(purpose === 'investment' ? '' : 'investment')}>
                Investment
              </Chip>
              <Chip on={purpose === 'end_use'} onClick={() => setPurpose(purpose === 'end_use' ? '' : 'end_use')}>
                To live in
              </Chip>
            </div>
          </Field>

          <Field label="When?">
            <div className="chip-row">
              {[
                ['immediate', 'Now'],
                ['1_3_months', '1–3 months'],
                ['3_6_months', '3–6 months'],
                ['6_12_months', '6–12 months'],
                ['12_plus', 'Later'],
              ].map(([value, label]) => (
                <Chip key={value} on={timeline === value} onClick={() => setTimeline(timeline === value ? '' : value as string)}>
                  {label}
                </Chip>
              ))}
            </div>
          </Field>
        </>
      )}

      {step === 3 && (
        <>
          <Field label="Where did they come from?">
            <div className="chip-row">
              {SOURCES.map((item) => (
                <Chip key={item.value} icon={item.icon} on={source === item.value} onClick={() => setSource(item.value)}>
                  {item.label}
                </Chip>
              ))}
            </div>
          </Field>

          {source === 'referral' && (
            <Field label="Referred by">
              <Input value={referredBy} onChange={(event) => setReferredBy(event.target.value)} placeholder="Who sent them?" />
            </Field>
          )}

          <Field label="Anything worth remembering?" hint="What they said, what they are worried about.">
            <TextArea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>

          {canAssign ? (
            <Field label="Who should work it?" hint="Leave it unassigned and it waits in Incoming.">
              <div className="chip-row">
                <Chip on={assignTo === null} onClick={() => setAssignTo(null)}>Leave in Incoming</Chip>
                {agents.map((agent) => (
                  <Chip key={agent.id} on={assignTo === agent.id} onClick={() => setAssignTo(agent.id)}>
                    {agent.name} · {agent.open_leads}
                  </Chip>
                ))}
              </div>
            </Field>
          ) : (
            <p className="add-mine">
              <Icon name="user-check" />
              This lead will be yours. No timer — you have already spoken to them.
            </p>
          )}

          {problem && <p className="field-problem" role="alert">{problem}</p>}
        </>
      )}
    </Modal>
  );
}

/**
 * The client is already in the CRM.
 *
 * What an agent is told depends on whose lead it is. Their own, or a
 * manager's view: open it. Somebody else's: that it exists, and nothing more
 * — naming the owner would be telling them who to go and argue with about a
 * commission, and the server does not send the name either.
 */
function DuplicateNote({ duplicate, onOpen }: { duplicate: Duplicate; onOpen: () => void }) {
  const navigate = useNavigate();

  if (!duplicate.canOpen) {
    return (
      <div className="add-dupe" role="status">
        <Icon name="info" />
        <span>This client is already in the CRM with another agent. Emir has been told.</span>
      </div>
    );
  }

  return (
    <div className="add-dupe" role="status">
      <Icon name="info" />
      <span>
        <b>{duplicate.name ?? 'This client'}</b> is already here
        {duplicate.ownerName ? `, with ${duplicate.ownerName}` : ''}.
      </span>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          onOpen();
          navigate(`/contacts/${duplicate.contactId}`);
        }}
      >
        Open it
      </button>
    </div>
  );
}
