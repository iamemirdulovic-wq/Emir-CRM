import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar } from '../design/ui.js';
import {
  COUNTRIES, DEFAULT_COUNTRY, flagOf, readPhone, type Country,
} from '../design/phone.js';

/**
 * Add a lead.
 *
 * `docs/v2/pages.md` §10. Three rules out of the design that are easy to
 * lose and matter:
 *
 *  - **Nothing is preselected.** Not the source, not the project, not the
 *    agent. A form that guesses gets a wrong answer saved by somebody in a
 *    hurry, and nobody ever goes back to correct it.
 *  - **A duplicate blocks the save** and says who holds the lead. Two records
 *    for one person is how two agents end up ringing them.
 *  - **The source list depends on who is adding it.** An agent's "walk-in"
 *    and an owner's "email to me" are different things, and a shared list
 *    gets filled in with whatever is nearest.
 */

const AGENT_SOURCES = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'referral', label: 'Referral', asks: 'Who referred them?' },
  { value: 'event', label: 'Event / expo', asks: 'Which event?' },
  { value: 'whatsapp_direct', label: 'My own call or message' },
  { value: 'manual', label: 'Old client' },
  { value: 'instagram', label: 'Social media (mine)' },
];

const OWNER_SOURCES = [
  { value: 'website', label: 'Email to me' },
  { value: 'manual', label: 'My own contact' },
  { value: 'referral', label: 'Referral', asks: 'Who referred them?' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'event', label: 'Event / expo', asks: 'Which event?' },
];

const UNITS = ['Studio', '1 Bedroom', '2 Bedroom', '3 Bedroom', '4+ / Villa', 'Not sure yet'];
const PURPOSES = [
  { value: 'investment', label: 'To invest' },
  { value: 'end_use', label: 'To live in' },
  { value: 'unknown', label: 'Not sure yet' },
];
const TIMELINES = [
  { value: 'immediate', label: 'Now' },
  { value: '1_3_months', label: '1–3 months' },
  { value: '3_6_months', label: '3–6 months' },
  { value: '6_12_months', label: '6–12 months' },
  { value: 'unknown', label: 'Not sure' },
];
const LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'ar', label: 'Arabic' },
  { code: 'ru', label: 'Russian' }, { code: 'hi', label: 'Hindi' },
  { code: 'ur', label: 'Urdu' }, { code: 'fr', label: 'French' },
];
const WITHIN: Array<{ value: 15 | 30 | 60 | null; label: string }> = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: null, label: 'Today' },
];

interface Duplicate {
  found: boolean;
  contactId?: string;
  opportunityId?: string | null;
  name?: string | null;
  ownerName?: string | null;
}

interface Agent { id: string; name: string; open_leads: number }

export function V2AddLead() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isOwner = user?.role !== 'agent';
  const sources = isOwner ? OWNER_SOURCES : AGENT_SOURCES;

  const [name, setName] = useState('');
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [phoneRaw, setPhoneRaw] = useState('');
  const [sameWhatsapp, setSameWhatsapp] = useState(true);
  const [whatsappRaw, setWhatsappRaw] = useState('');
  const [telegram, setTelegram] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [project, setProject] = useState('');
  const [unitType, setUnitType] = useState<string | null>(null);
  const [budgetMax, setBudgetMax] = useState('');
  const [purpose, setPurpose] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<string | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const [keepIt, setKeepIt] = useState(true);
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isVip, setIsVip] = useState(false);
  const [within, setWithin] = useState<15 | 30 | 60 | null>(30);
  const [privateNote, setPrivateNote] = useState('');

  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ opportunityId: string } | null>(null);

  const phone = useMemo(() => readPhone(phoneRaw, country), [phoneRaw, country]);
  const whatsapp = useMemo(() => readPhone(whatsappRaw, country), [whatsappRaw, country]);
  const chosenSource = sources.find((s) => s.value === source);

  useEffect(() => {
    if (!isOwner) return;
    void api.get<{ items: Agent[] }>('/api/leads/agents')
      .then((got) => setAgents(got.items))
      .catch(() => setAgents([]));
  }, [isOwner]);

  /* The live check. It runs on the number the server would store, not on
     what is on screen, so "050 123 4567" and "+971501234567" ask once. */
  useEffect(() => {
    if (!phone.e164 && !email) { setDuplicate(null); return undefined; }
    const timer = window.setTimeout(async () => {
      setChecking(true);
      try {
        setDuplicate(await api.post<Duplicate>('/api/leads/check', {
          phone: phone.e164 || undefined,
          email: email || undefined,
        }));
      } catch {
        setDuplicate(null);
      } finally {
        setChecking(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [phone.e164, email]);

  function missing(): string | null {
    if (!name.trim()) return 'Write their name.';
    if (!phone.e164 && !email.trim()) return 'A lead needs a phone number or an email.';
    if (phone.e164 && !phone.valid) return phone.problem ?? 'That number does not look right.';
    if (!source) return 'Where did this lead come from?';
    if (chosenSource?.asks && !detail.trim()) return chosenSource.asks;
    if (isOwner && !keepIt && !assignTo && !isVip) return null;
    if (isVip && !assignTo) return 'A VIP lead needs an agent to give it to.';
    return null;
  }

  async function save() {
    const wrong = missing();
    if (wrong) { setProblem(wrong); return; }
    if (duplicate?.found) { setProblem('That person is already in the CRM.'); return; }

    setSaving(true);
    setProblem(null);
    try {
      const body: Record<string, unknown> = {
        fullName: name.trim(),
        source,
        ...(phone.e164 ? { phone: phone.e164 } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(sameWhatsapp ? {} : whatsapp.e164 ? { whatsapp: whatsapp.e164 } : {}),
        ...(telegram.trim() ? { telegram: telegram.trim() } : {}),
        ...(languages.length ? { languages } : {}),
        ...(project.trim() ? { projectName: project.trim() } : {}),
        ...(unitType && unitType !== 'Not sure yet' ? { unitType } : {}),
        ...(budgetMax ? { budgetMaxAed: Number(budgetMax.replace(/[^\d]/g, '')) } : {}),
        ...(purpose ? { purpose } : {}),
        ...(timeline ? { timeline } : {}),
        ...(chosenSource?.asks && detail.trim() ? { referredBy: detail.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      };

      if (isOwner) {
        body.assignToUserId = keepIt ? user?.id ?? null : assignTo;
        if (isVip) {
          body.isVip = true;
          body.callWithinMinutes = within;
          if (privateNote.trim()) body.privateNote = privateNote.trim();
        }
      } else {
        /* An agent chooses between keeping it and leaving it for anyone. */
        body.assignToUserId = keepIt ? user?.id ?? null : null;
      }

      const made = await api.post<{ opportunityId: string }>('/api/leads', body);
      setSaved(made);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  }

  function again() {
    setSaved(null);
    setName(''); setPhoneRaw(''); setWhatsappRaw(''); setTelegram(''); setEmail('');
    setSource(null); setDetail(''); setProject(''); setUnitType(null); setBudgetMax('');
    setPurpose(null); setTimeline(null); setLanguages([]); setNote('');
    setIsVip(false); setPrivateNote(''); setDuplicate(null); setProblem(null);
  }

  if (saved) {
    return (
      <div className="v2-addlead">
        <div className="v2-empty">
          <span className="v2-empty-mark"><Icon name="check" /></span>
          <h2>{name || 'The lead'} is in</h2>
          <p>
            {isVip
              ? 'The agent has been told, and the clock is running.'
              : keepIt ? 'It is in your leads.' : 'It is in Incoming, waiting for an agent.'}
          </p>
          <div className="v2-dialog-acts">
            <Link className="d-btn d-primary" to={`/v2/leads/${saved.opportunityId}`}>Open the lead</Link>
            <button type="button" className="d-btn" onClick={again}>Add another</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="v2-addlead">
      <header className="v2-inc-head">
        <h1 className="v2-hi">Add a lead</h1>
        <p className="d-muted">Nothing is filled in for you. Only the name, a way to reach them, and where they came from are needed.</p>
      </header>

      <section className="d-card v2-addlead-card">
        <h3>Who are they?</h3>

        <label className="v2-field v2-field-wide">
          <span>Full name *</span>
          <input className="d-input" value={name} autoFocus
            placeholder="As they would say it" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="v2-phone-row">
          <label className="v2-field">
            <span>Country</span>
            <select
              className="d-input"
              value={country.iso}
              onChange={(e) => setCountry(COUNTRIES.find((c) => c.iso === e.target.value) ?? DEFAULT_COUNTRY)}
            >
              {COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>{flagOf(c.iso)} {c.name} +{c.dial}</option>
              ))}
            </select>
          </label>
          <label className="v2-field v2-field-wide">
            <span>Phone *</span>
            <input
              className="d-input"
              value={phone.display}
              inputMode="numeric"
              placeholder="50 123 4567"
              onChange={(e) => setPhoneRaw(e.target.value)}
            />
          </label>
        </div>
        {phone.problem && <p className="v2-field-problem">{phone.problem}</p>}

        <Dupe duplicate={duplicate} checking={checking} hasInput={Boolean(phone.e164 || email)} />

        <label className="v2-switch">
          <input type="checkbox" checked={sameWhatsapp} onChange={(e) => setSameWhatsapp(e.target.checked)} />
          <span>WhatsApp is the same number</span>
        </label>
        {!sameWhatsapp && (
          <label className="v2-field v2-field-wide">
            <span>WhatsApp number</span>
            <input className="d-input" value={whatsapp.display} inputMode="numeric"
              onChange={(e) => setWhatsappRaw(e.target.value)} />
          </label>
        )}

        <div className="v2-two">
          <label className="v2-field v2-field-wide">
            <span>Telegram</span>
            <input className="d-input" value={telegram} placeholder="@name"
              onChange={(e) => setTelegram(e.target.value)} />
          </label>
          <label className="v2-field v2-field-wide">
            <span>Email</span>
            <input className="d-input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)} />
          </label>
        </div>

        <span className="v2-field-label">Speaks</span>
        <div className="v2-chips">
          {LANGUAGES.map((one) => (
            <button
              key={one.code}
              type="button"
              className={languages.includes(one.code) ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
              onClick={() => setLanguages((was) => (was.includes(one.code)
                ? was.filter((c) => c !== one.code)
                : [...was, one.code]))}
            >
              {one.label}
            </button>
          ))}
        </div>
      </section>

      <section className="d-card v2-addlead-card">
        <h3>Where did they come from? *</h3>
        <div className="v2-chips">
          {sources.map((one) => (
            <button
              key={one.value + one.label}
              type="button"
              className={source === one.value ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
              onClick={() => { setSource(one.value); setDetail(''); }}
            >
              {one.label}
            </button>
          ))}
        </div>
        {chosenSource?.asks && (
          <label className="v2-field v2-field-wide">
            <span>{chosenSource.asks} *</span>
            <input className="d-input" value={detail} onChange={(e) => setDetail(e.target.value)} />
          </label>
        )}
      </section>

      <section className="d-card v2-addlead-card">
        <h3>What are they looking for?</h3>
        <div className="v2-two">
          <label className="v2-field v2-field-wide">
            <span>Project</span>
            <input className="d-input" value={project} placeholder="Leave empty if not sure"
              onChange={(e) => setProject(e.target.value)} />
          </label>
          <label className="v2-field v2-field-wide">
            <span>Budget up to (AED)</span>
            <input className="d-input" value={budgetMax} inputMode="numeric" placeholder="2,000,000"
              onChange={(e) => setBudgetMax(e.target.value)} />
          </label>
        </div>

        <span className="v2-field-label">Looking for</span>
        <div className="v2-chips">
          {UNITS.map((one) => (
            <button key={one} type="button"
              className={unitType === one ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
              onClick={() => setUnitType(one)}>{one}</button>
          ))}
        </div>

        <span className="v2-field-label">Buying to</span>
        <div className="v2-chips">
          {PURPOSES.map((one) => (
            <button key={one.value} type="button"
              className={purpose === one.value ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
              onClick={() => setPurpose(one.value)}>{one.label}</button>
          ))}
        </div>

        <span className="v2-field-label">When</span>
        <div className="v2-chips">
          {TIMELINES.map((one) => (
            <button key={one.value} type="button"
              className={timeline === one.value ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
              onClick={() => setTimeline(one.value)}>{one.label}</button>
          ))}
        </div>

        <label className="v2-field v2-field-wide">
          <span>Note</span>
          <input className="d-input" value={note} placeholder="Anything they said that matters"
            onChange={(e) => setNote(e.target.value)} />
        </label>
      </section>

      <section className="d-card v2-addlead-card">
        <h3>Who works it?</h3>
        <div className="v2-chips">
          <button type="button" className={keepIt ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
            onClick={() => { setKeepIt(true); setAssignTo(null); setIsVip(false); }}>
            Me
          </button>
          <button type="button" className={!keepIt ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
            onClick={() => setKeepIt(false)}>
            {isOwner ? 'Give it to somebody' : 'Leave it in Incoming'}
          </button>
        </div>

        {isOwner && !keepIt && (
          <>
            <ul className="v2-agent-list">
              {agents.map((agent) => (
                <li key={agent.id}>
                  <label className={assignTo === agent.id ? 'v2-agent v2-agent-on' : 'v2-agent'}>
                    <input type="radio" name="who" checked={assignTo === agent.id}
                      onChange={() => setAssignTo(agent.id)} />
                    <Avatar name={agent.name} />
                    <span className="v2-agent-who">
                      <b>{agent.name}</b>
                      <span>{agent.open_leads} open</span>
                    </span>
                  </label>
                </li>
              ))}
              <li>
                <label className={assignTo === null ? 'v2-agent v2-agent-on' : 'v2-agent'}>
                  <input type="radio" name="who" checked={assignTo === null}
                    onChange={() => { setAssignTo(null); setIsVip(false); }} />
                  <span className="v2-agent-who"><b>Leave it in Incoming</b><span>Anyone can take it</span></span>
                </label>
              </li>
            </ul>

            <label className="v2-switch">
              <input
                type="checkbox"
                checked={isVip}
                disabled={!assignTo}
                onChange={(e) => setIsVip(e.target.checked)}
              />
              <span>
                Give it as a <b>VIP lead</b>
                {!assignTo && <em> — pick an agent first</em>}
              </span>
            </label>

            {isVip && (
              <>
                <span className="v2-field-label">They must call within</span>
                <div className="v2-chips">
                  {WITHIN.map((one) => (
                    <button key={String(one.value)} type="button"
                      className={within === one.value ? 'v2-chip-opt v2-chip-opt-on' : 'v2-chip-opt'}
                      onClick={() => setWithin(one.value)}>{one.label}</button>
                  ))}
                </div>
                <label className="v2-field v2-field-wide">
                  <span>What should they know? (only the agent sees this)</span>
                  <input className="d-input" value={privateNote}
                    placeholder="Friend of the family. Call him yourself."
                    onChange={(e) => setPrivateNote(e.target.value)} />
                </label>
              </>
            )}
          </>
        )}
      </section>

      {problem && <p className="v2-problem">{problem}</p>}

      <div className="v2-addlead-foot">
        <button type="button" className="d-btn d-ghost" onClick={() => navigate(-1)}>Cancel</button>
        <button
          type="button"
          className="d-btn d-primary d-lg"
          disabled={saving || Boolean(duplicate?.found)}
          onClick={save}
        >
          {saving ? 'Saving…' : isVip ? 'Add and give as VIP' : 'Add the lead'}
        </button>
      </div>
    </div>
  );
}

/**
 * What the live number check found.
 *
 * A duplicate blocks the save and names who holds it, because the alternative
 * is two records for one person and two agents ringing them — the single
 * complaint the design research heard most.
 */
function Dupe({ duplicate, checking, hasInput }: {
  duplicate: Duplicate | null; checking: boolean; hasInput: boolean;
}) {
  if (!hasInput) {
    return <p className="v2-check">We check every number against the CRM as you type.</p>;
  }
  if (checking) return <p className="v2-check">Checking…</p>;
  if (!duplicate) return null;
  if (!duplicate.found) return <p className="v2-check v2-check-ok"><Icon name="check" />New number.</p>;

  return (
    <div className="v2-dupe">
      <Icon name="alert-triangle" />
      <span className="d-grow">
        <b>{duplicate.name ?? 'Somebody'} is already in the CRM</b>
        <span>
          {duplicate.ownerName
            ? `${duplicate.ownerName} is working on them.`
            : 'Nobody is working on them — they are in Incoming.'}
        </span>
      </span>
      {duplicate.opportunityId && (
        <Link className="d-btn d-xs" to={`/v2/leads/${duplicate.opportunityId}`}>Open</Link>
      )}
    </div>
  );
}
