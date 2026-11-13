import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar } from '../design/ui.js';
import {
  COUNTRIES, DEFAULT_COUNTRY, flagOf, readPhone, type Country,
} from '../design/phone.js';
import { usePhoneHead } from './phone.js';

/**
 * Add a lead.
 *
 * Built from `design/web/add-lead.html`: two numbered cards down the left —
 * what is needed, then what can wait — and "Who works it?" sticky on the
 * right with the save button under it.
 *
 * Three rules out of that design that are easy to lose and matter:
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
  { value: 'referral', label: 'Referral', asks: 'Who referred this lead?' },
  { value: 'event', label: 'Event / expo', asks: 'Which event?' },
  { value: 'whatsapp_direct', label: 'My own call' },
  { value: 'manual', label: 'Old client' },
  { value: 'instagram', label: 'Social media (mine)' },
];

const OWNER_SOURCES = [
  { value: 'website', label: 'Email to owner' },
  { value: 'manual', label: 'Owner’s contact' },
  { value: 'referral', label: 'Referral', asks: 'Who referred this lead?' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'event', label: 'Event / expo', asks: 'Which event?' },
];

const UNITS = ['Studio', '1BR', '2BR', '3BR+', 'Villa'];
const BUDGETS: Array<{ label: string; max: number | null }> = [
  { label: 'Under 1M', max: 1_000_000 },
  { label: '1–2M', max: 2_000_000 },
  { label: '2–3M', max: 3_000_000 },
  { label: '3–5M', max: 5_000_000 },
  { label: '5M+', max: null },
];
const PURPOSES = [
  { value: 'end_use', label: 'Live in' },
  { value: 'investment', label: 'Invest' },
  { value: 'unknown', label: 'Both' },
];
/*
 * When they want to buy.
 *
 * `design/web/add-lead.html` has no slot for it, and the lead record has a
 * column for it that the rest of the CRM reads — the follow-up rules and the
 * lead score both use it. So it keeps its place in the optional card, beside
 * the other things an agent learns in the same breath.
 */
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
  { code: 'ur', label: 'Urdu' }, { code: 'fr', label: 'Other' },
];
/** Under this, the phone layout. See the note in `Leads.tsx` about the copy. */
const PHONE = 768;

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${PHONE - 1}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${PHONE - 1}px)`);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

const WITHIN: Array<{ value: 15 | 30 | 60 | null; label: string }> = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: null, label: 'Today' },
];

/**
 * The regions the country picker groups by.
 *
 * `design/phone.ts` orders its countries by who walks through the door and
 * carries no region, so the grouping lives here. Anything not named falls
 * under "All", which is the chip that always shows every country.
 */
const REGION: Record<string, string> = {
  AE: 'GCC', SA: 'GCC', QA: 'GCC', KW: 'GCC', BH: 'GCC', OM: 'GCC',
  IN: 'Asia', PK: 'Asia', CN: 'Asia', KZ: 'Asia', TR: 'Asia', BD: 'Asia',
  LK: 'Asia', NP: 'Asia', PH: 'Asia', ID: 'Asia', MY: 'Asia', SG: 'Asia',
  TH: 'Asia', JP: 'Asia', KR: 'Asia', JO: 'Asia', LB: 'Asia', SY: 'Asia',
  IQ: 'Asia', IR: 'Asia', AZ: 'Asia', AM: 'Asia', GE: 'Asia', UZ: 'Asia',
  GB: 'Europe', RU: 'Europe', DE: 'Europe', FR: 'Europe', IT: 'Europe',
  ES: 'Europe', NL: 'Europe', BE: 'Europe', CH: 'Europe', AT: 'Europe',
  PL: 'Europe', RO: 'Europe', SE: 'Europe', NO: 'Europe', DK: 'Europe',
  IE: 'Europe', PT: 'Europe', GR: 'Europe', CZ: 'Europe', RS: 'Europe',
  BA: 'Europe', UA: 'Europe',
  EG: 'Africa', NG: 'Africa', KE: 'Africa', MA: 'Africa', DZ: 'Africa',
  TN: 'Africa', SD: 'Africa', ZA: 'Africa',
  US: 'Americas', CA: 'Americas', BR: 'Americas', AR: 'Americas', MX: 'Americas',
  AU: 'Oceania', NZ: 'Oceania',
};

/** The six the brokerage sees most, which is the order `phone.ts` is in. */
const POPULAR = ['AE', 'SA', 'IN', 'GB', 'RU', 'IT'];
const REGIONS = ['Popular', 'GCC', 'Europe', 'Asia', 'Africa', 'Americas', 'Oceania', 'All'];

interface Duplicate {
  found: boolean;
  canOpen?: boolean;
  contactId?: string;
  opportunityId?: string | null;
  name?: string | null;
  ownerName?: string | null;
}

interface Agent { id: string; name: string; open_leads: number }

export function V2AddLead() {
  const isPhone = useIsPhone();
  const { user } = useAuth();
  const isOwner = user?.role !== 'agent';
  const sources = isOwner ? OWNER_SOURCES : AGENT_SOURCES;

  const [name, setName] = useState('');
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [phoneRaw, setPhoneRaw] = useState('');
  const [ccOpen, setCcOpen] = useState(false);
  const [sameWhatsapp, setSameWhatsapp] = useState(true);
  const [whatsappRaw, setWhatsappRaw] = useState('');
  const [telegram, setTelegram] = useState('');
  const [email, setEmail] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [detail, setDetail] = useState('');
  const [project, setProject] = useState<string | null>(null);
  const [projectOther, setProjectOther] = useState('');
  const [unitType, setUnitType] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<string | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const [who, setWho] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isVip, setIsVip] = useState(false);
  const [within, setWithin] = useState<15 | 30 | 60 | null>(30);
  const [privateNote, setPrivateNote] = useState('');

  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [saved, setSaved] = useState<{ opportunityId: string; name: string } | null>(null);

  /* §1.4: the shell draws the header, so without this it reads "My leads"
     over a form for adding one — the audit found two titles on this screen. */
  usePhoneHead({ title: 'Add a lead', sub: 'Name, phone and lead source are needed' });

  const phone = useMemo(() => readPhone(phoneRaw, country), [phoneRaw, country]);
  const whatsapp = useMemo(() => readPhone(whatsappRaw, country), [whatsappRaw, country]);
  const chosenSource = sources.find((s) => s.value === source);
  const projects = useAsyncProjects();

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

  const blocked = Boolean(duplicate?.found);
  const phoneOk = Boolean(phone.e164) && phone.valid && !blocked;
  const needsDetail = Boolean(chosenSource?.asks);

  /* What is still missing, in the design's own words under the button. */
  const missing: string[] = [];
  if (!name.trim()) missing.push('name');
  if (!phoneOk && !email.trim()) missing.push('phone');
  if (!source) missing.push('source');
  if (needsDetail && !detail.trim()) missing.push('the detail');
  if (!who) missing.push('who works it');

  const emailBad = Boolean(email.trim()) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const vipNeedsAgent = isVip && (who === null || who === 'incoming');

  async function save() {
    setShown(true);
    if (blocked) { setProblem('That person is already in the CRM.'); return; }
    if (missing.length > 0 || emailBad || vipNeedsAgent) {
      setProblem(null);
      return;
    }
    if (phone.e164 && !phone.valid) { setProblem(phone.problem); return; }

    setSaving(true);
    setProblem(null);
    try {
      const projectName = project === 'Other' ? projectOther.trim()
        : project && project !== 'Not sure yet' ? project : '';
      const budgetMaxAed = BUDGETS.find((one) => one.label === budget)?.max ?? null;

      const body: Record<string, unknown> = {
        fullName: name.trim(),
        source,
        ...(phone.e164 ? { phone: phone.e164 } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(sameWhatsapp ? {} : whatsapp.e164 ? { whatsapp: whatsapp.e164 } : {}),
        ...(telegram.trim() ? { telegram: telegram.trim() } : {}),
        ...(languages.length ? { languages } : {}),
        ...(projectName ? { projectName } : {}),
        ...(unitType ? { unitType } : {}),
        ...(budgetMaxAed ? { budgetMaxAed } : {}),
        ...(purpose ? { purpose } : {}),
        ...(timeline ? { timeline } : {}),
        ...(needsDetail && detail.trim() ? { referredBy: detail.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      };

      if (who === 'me') body.assignToUserId = user?.id ?? null;
      else if (who === 'incoming') body.assignToUserId = null;
      else body.assignToUserId = who;

      if (isOwner && isVip && who && who !== 'incoming' && who !== 'me') {
        body.isVip = true;
        body.callWithinMinutes = within;
        if (privateNote.trim()) body.privateNote = privateNote.trim();
      }

      const made = await api.post<{ opportunityId: string }>('/api/leads', body);
      setSaved({ opportunityId: made.opportunityId, name: name.trim() });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  }

  function again() {
    setSaved(null); setShown(false);
    setName(''); setPhoneRaw(''); setWhatsappRaw(''); setSameWhatsapp(true);
    setTelegram(''); setEmail(''); setSource(null); setDetail('');
    setProject(null); setProjectOther(''); setUnitType(null); setBudget(null);
    setPurpose(null); setTimeline(null); setLanguages([]); setNote('');
    setWho(null); setIsVip(false); setWithin(30); setPrivateNote('');
    setDuplicate(null); setProblem(null);
    setCountry(DEFAULT_COUNTRY);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* Once it is saved the form behind the card is history: the design makes
     every field read-only rather than letting somebody edit a lead that is
     already in the CRM and think the change went with it. */
  const frozen = Boolean(saved);

  const agentName = agents.find((one) => one.id === who)?.name ?? null;
  const saveLabel = who === 'me' ? 'Save to My leads'
    : who === 'incoming' ? 'Save to Incoming'
      : agentName ? `${isVip ? 'Save and give as VIP to ' : 'Save and give to '}${agentName}`
        : 'Save lead';

  const summary = blocked
    ? (duplicate?.ownerName ? 'Open the lead that already has this number.' : 'This lead is already in the CRM.')
    : missing.length > 0 ? `Still needed: ${missing.join(', ')}.`
      : isVip && agentName ? `${agentName} must call within ${(WITHIN.find((one) => one.value === within)?.label ?? '').toLowerCase()}, or the lead comes back to you.`
        : who === 'incoming' ? 'The lead waits in Incoming.'
          : 'Ready to save.';

  return (
    <div className="p-add-lead">
      <div className="v2-page-head">
        <span className="v2-page-sub">
          Name, phone and source are needed. The rest can wait.
        </span>
      </div>

      <div className="d-add-grid">
        <div className="d-col d-gap-16">
          {/* 1 · what is needed */}
          <section className="d-card" aria-label="The lead">
            <div className="d-card-head">
              <span className="d-num-step">1</span>
              <h3>Who is it?</h3>
            </div>

            <div className="d-form-grid">
              <div className={shown && !name.trim() ? 'd-field d-full d-invalid' : 'd-field d-full'}>
                <label htmlFor="v2-al-name">Full name <span className="d-req">*</span></label>
                <input
                  id="v2-al-name"
                  readOnly={frozen}
                  className="d-input d-lg"
                  value={name}
                  autoFocus
                  placeholder="Name and family name"
                  onChange={(e) => setName(e.target.value)}
                />
                <span className="d-error">Write the full name.</span>
              </div>

              <div
                className={shown && !phoneOk && !email.trim() ? 'd-field d-full d-invalid' : 'd-field d-full'}
              >
                <label htmlFor="v2-al-phone">Phone <span className="d-req">*</span></label>
                <div className="d-phone-row">
                  <div className="v2-cc-wrap">
                    <button
                      type="button"
                      className="d-cc"
                      aria-label="Country code"
                      aria-expanded={ccOpen}
                      onClick={() => setCcOpen((was) => !was)}
                    >
                      <b>+{country.dial}</b>
                      <span>{shortName(country)}</span>
                      <Icon name="chevron-down" size={14} />
                    </button>
                    {ccOpen && (
                      <CountryMenu
                        chosen={country}
                        sheet={isPhone}
                        onPick={(picked) => { setCountry(picked); setCcOpen(false); }}
                        onClose={() => setCcOpen(false)}
                      />
                    )}
                  </div>
                  <input
                    id="v2-al-phone"
                    readOnly={frozen}
                    className="d-input d-lg d-grow d-id-phone"
                    value={phone.display}
                    inputMode="numeric"
                    placeholder="50 555 0101"
                    onChange={(e) => setPhoneRaw(e.target.value)}
                  />
                </div>

                <Check duplicate={duplicate} checking={checking} phone={phone} />
                <span className="d-error">
                  {phoneRaw.trim() ? 'That number does not look right.' : 'Write the phone number.'}
                </span>

                {blocked && (
                  <div className="d-banner d-red">
                    <Icon name="alert-triangle" />
                    <span className="d-grow">
                      {duplicate?.canOpen === false
                        ? 'This number is already with another agent. Ask them, or an owner.'
                        : <>
                            <b>{duplicate?.name ?? 'Somebody'}</b> has this number
                            {duplicate?.ownerName ? ` · with ${duplicate.ownerName}` : ' · free lead in Incoming'}
                          </>}
                    </span>
                    {duplicate?.opportunityId && duplicate.canOpen !== false && (
                      <Link className="d-btn d-xs" to={`/v2/leads/${duplicate.opportunityId}`}>Open</Link>
                    )}
                    {/* Free: it is sitting in Incoming and anybody may take it.
                        With an agent: `/check` sends a contact, and there is no
                        screen that opens a contact, so the name is all there is
                        to say. */}
                    {!duplicate?.opportunityId && !duplicate?.ownerName && duplicate?.canOpen !== false && (
                      <Link className="d-btn d-xs" to="/v2/incoming">Open Incoming</Link>
                    )}
                  </div>
                )}
              </div>

              <div className={shown && !source ? 'd-field d-full d-invalid' : 'd-field d-full'}>
                <span className="d-field-label">Lead source <span className="d-t-accent">*</span></span>
                <div className="d-chips d-tight">
                  {sources.map((one) => (
                    <button
                      key={one.value}
                      type="button"
                      className={source === one.value ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => { setSource(one.value); setDetail(''); }}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
                <span className="d-error">Choose where the lead came from.</span>
              </div>

              {needsDetail && (
                <div className={shown && !detail.trim() ? 'd-field d-full d-invalid' : 'd-field d-full'}>
                  <label htmlFor="v2-al-detail">
                    {chosenSource?.asks} <span className="d-req">*</span>
                  </label>
                  <input
                    id="v2-al-detail"
                    readOnly={frozen}
                    className="d-input"
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                  />
                  <span className="d-error">Write this detail.</span>
                </div>
              )}
            </div>
          </section>

          {/* 2 · what can wait */}
          <section className="d-card" aria-label="More details">
            <div className="d-card-head">
              <span className="d-num-step d-soft">2</span>
              <h3>More details <span className="d-muted v2-al-optional">· optional</span></h3>
            </div>

            <div className="d-form-grid">
              <div className="d-field d-full">
                <label className="d-switch">
                  <input
                    type="checkbox"
                    checked={sameWhatsapp}
                    onChange={(e) => setSameWhatsapp(e.target.checked)}
                  />
                  <span className="d-track" />
                  WhatsApp is the same number
                </label>
              </div>

              {!sameWhatsapp && (
                <div className="d-field">
                  <label htmlFor="v2-al-wa">WhatsApp number</label>
                  <input
                    id="v2-al-wa"
                    readOnly={frozen}
                    className="d-input"
                    value={whatsapp.display}
                    inputMode="numeric"
                    placeholder="With country code"
                    onChange={(e) => setWhatsappRaw(e.target.value)}
                  />
                </div>
              )}

              <div className="d-field">
                <label htmlFor="v2-al-tg">Telegram</label>
                <input
                  id="v2-al-tg"
                  readOnly={frozen}
                  className="d-input"
                  value={telegram}
                  placeholder="@name or number"
                  onChange={(e) => setTelegram(e.target.value)}
                />
              </div>

              <div className={shown && emailBad ? 'd-field d-invalid' : 'd-field'}>
                <label htmlFor="v2-al-email">Email</label>
                <input
                  id="v2-al-email"
                  readOnly={frozen}
                  className="d-input"
                  type="email"
                  value={email}
                  placeholder="name@mail.com"
                  onChange={(e) => setEmail(e.target.value)}
                />
                <span className="d-error">This email does not look right.</span>
              </div>

              <div className="d-field d-full">
                <span className="d-field-label">Project</span>
                <div className="d-chips d-tight">
                  {projects.map((one) => (
                    <button
                      key={one}
                      type="button"
                      className={project === one ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => setProject(one)}
                    >
                      {one}
                    </button>
                  ))}
                </div>
                {project === 'Other' && (
                  <input
                    className="d-input d-mt-4"
                    readOnly={frozen}
                    value={projectOther}
                    placeholder="Type the project name"
                    onChange={(e) => setProjectOther(e.target.value)}
                  />
                )}
              </div>

              <Pick
                label="Looking for"
                options={UNITS.map((one) => ({ value: one, label: one }))}
                chosen={unitType}
                onPick={setUnitType}
              />
              <Pick
                label="Budget, AED"
                options={BUDGETS.map((one) => ({ value: one.label, label: one.label }))}
                chosen={budget}
                onPick={setBudget}
              />
              <Pick
                label="Buying to"
                options={PURPOSES}
                chosen={purpose}
                onPick={setPurpose}
              />
              <Pick
                label="When"
                options={TIMELINES}
                chosen={timeline}
                onPick={setTimeline}
              />

              <div className="d-field">
                <span className="d-field-label">
                  Speaks <span className="d-muted v2-al-optional">· choose all</span>
                </span>
                <div className="d-chips d-tight">
                  {LANGUAGES.map((one) => (
                    <button
                      key={one.code}
                      type="button"
                      className={languages.includes(one.code) ? 'd-chip-opt d-on' : 'd-chip-opt'}
                      onClick={() => setLanguages((was) => (was.includes(one.code)
                        ? was.filter((code) => code !== one.code)
                        : [...was, one.code]))}
                    >
                      {one.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="d-field d-full">
                <label htmlFor="v2-al-note">Note</label>
                <textarea
                  id="v2-al-note"
                  readOnly={frozen}
                  className="d-textarea"
                  value={note}
                  placeholder="What does the client want? One line is enough."
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
          </section>
        </div>

        {/* 3 · who works it, and save */}
        <div className="d-side">
          {saved ? (
            <section className="d-card d-saved" aria-label="Saved">
              <span className="d-ic"><Icon name="check" size={28} /></span>
              <h2>{saved.name || 'The lead'} is saved</h2>
              <p className="d-muted">
                {who === 'me' ? 'The lead is in My leads · stage New.'
                  : who === 'incoming' ? 'The lead waits in Incoming.'
                    : isVip ? `${agentName} is told now and has ${(WITHIN.find((one) => one.value === within)?.label ?? '').toLowerCase()} to call.`
                      : `${agentName} is told now. The lead is in their list.`}
              </p>
              <div className="d-row d-gap-8 d-mt-8">
                <Link className="d-btn d-dark" to={`/v2/leads/${saved.opportunityId}`}>Open lead</Link>
                <button type="button" className="d-btn" onClick={again}>
                  <Icon name="plus" size={15} />Add another
                </button>
              </div>
            </section>
          ) : (
            <section className="d-card d-who" aria-label="Who works it?">
              <div className="d-card-head">
                <span className="d-num-step">3</span>
                <h3>Who works it?</h3>
              </div>

              {isOwner ? (
                <div className="d-col">
                  <div className={shown && (!who || vipNeedsAgent) ? 'd-field d-invalid' : 'd-field'}>
                    <div className="d-opt-list">
                      {agents.map((agent) => (
                        <button
                          key={agent.id}
                          type="button"
                          className={who === agent.id ? 'd-opt d-on' : 'd-opt'}
                          onClick={() => setWho(agent.id)}
                        >
                          <Avatar name={agent.name} size={32} />
                          <span className="d-grow">
                            <b className="d-bold">{agent.name}</b>
                          </span>
                          <span className="d-small d-muted">{agent.open_leads} open</span>
                        </button>
                      ))}
                      <button
                        type="button"
                        className={who === 'incoming' ? 'd-opt d-on' : 'd-opt'}
                        onClick={() => { setWho('incoming'); setIsVip(false); }}
                      >
                        <span className="d-card-icon v2-al-inbox"><Icon name="inbox" size={16} /></span>
                        <span className="d-grow">
                          <b className="d-bold">Leave in Incoming</b>
                          <div className="d-small d-muted">Give it later</div>
                        </span>
                      </button>
                    </div>
                    <span className="d-error">
                      {vipNeedsAgent
                        ? 'A VIP lead needs an agent. Choose one.'
                        : 'Choose an agent, or leave the lead in Incoming.'}
                    </span>
                  </div>

                  <div className={isVip ? 'd-vipbox d-on' : 'd-vipbox'}>
                    <div className="d-switch-row">
                      <div className="d-txt">
                        <b>Give as a VIP lead</b>
                        <span>The agent gets a clock. Not called in time → back to you.</span>
                      </div>
                      <label className="d-switch">
                        <input
                          type="checkbox"
                          checked={isVip}
                          onChange={(e) => setIsVip(e.target.checked)}
                        />
                        <span className="d-track" />
                      </label>
                    </div>
                    {isVip && (
                      <div className="d-field v2-al-within">
                        <span className="d-field-label">Must call within</span>
                        <div className="d-seg d-block">
                          {WITHIN.map((one) => (
                            <button
                              key={String(one.value)}
                              type="button"
                              className={within === one.value ? 'd-on' : ''}
                              onClick={() => setWithin(one.value)}
                            >
                              {one.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="d-field">
                    <label htmlFor="v2-al-private">Private note for the agent</label>
                    <textarea
                      id="v2-al-private"
                      className="d-textarea v2-al-private"
                      value={privateNote}
                      placeholder="Only you and the agent see it"
                      onChange={(e) => setPrivateNote(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className={shown && !who ? 'd-field d-invalid' : 'd-field'}>
                  <div className="d-opt-list">
                    <button
                      type="button"
                      className={who === 'me' ? 'd-opt d-on' : 'd-opt'}
                      onClick={() => setWho('me')}
                    >
                      <Avatar name={user?.name ?? 'Me'} size={32} />
                      <span className="d-grow">
                        <b className="d-bold">Me</b>
                        <div className="d-small d-muted">The lead goes to My leads</div>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={who === 'incoming' ? 'd-opt d-on' : 'd-opt'}
                      onClick={() => setWho('incoming')}
                    >
                      <span className="d-card-icon v2-al-inbox"><Icon name="inbox" size={16} /></span>
                      <span className="d-grow">
                        <b className="d-bold">Leave in Incoming</b>
                        <div className="d-small d-muted">An owner gives it, or a colleague takes it</div>
                      </span>
                    </button>
                  </div>
                  <span className="d-error">Choose who works this lead.</span>
                </div>
              )}

              {blocked && (
                <div className="d-banner d-red d-mt-12">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">
                    This number is already in the CRM. The lead cannot be saved twice.
                  </span>
                </div>
              )}

              {problem && (
                <div className="d-banner d-red d-mt-12">
                  <Icon name="alert-triangle" />
                  <span className="d-grow">{problem}</span>
                </div>
              )}

              <button
                type="button"
                className={blocked ? 'd-btn d-primary d-lg d-block d-mt-16 d-disabled' : 'd-btn d-primary d-lg d-block d-mt-16'}
                disabled={blocked || saving}
                onClick={save}
              >
                <Icon name="check" size={16} />{saving ? 'Saving…' : saveLabel}
              </button>
              <p className="d-sum d-center d-mt-8">{summary}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** One row of chips that picks exactly one thing. */
function Pick({ label, options, chosen, onPick }: {
  label: string;
  options: Array<{ value: string; label: string }>;
  chosen: string | null;
  onPick: (value: string | null) => void;
}) {
  return (
    <div className="d-field">
      <span className="d-field-label">{label}</span>
      <div className="d-chips d-tight">
        {options.map((one) => (
          <button
            key={one.value}
            type="button"
            className={chosen === one.value ? 'd-chip-opt d-on' : 'd-chip-opt'}
            onClick={() => onPick(chosen === one.value ? null : one.value)}
          >
            {one.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * What the live number check found, on the design's one `check-line`.
 *
 * A duplicate blocks the save and the banner under it names who holds the
 * lead, because the alternative is two records for one person and two agents
 * ringing them — the single complaint the design research heard most.
 */
function Check({ duplicate, checking, phone }: {
  duplicate: Duplicate | null;
  checking: boolean;
  phone: { e164: string; valid: boolean; problem: string | null };
}) {
  if (phone.e164 && !phone.valid) {
    return (
      <div className="d-check-line d-bad">
        <Icon name="shield" size={14} /><span>{phone.problem}</span>
      </div>
    );
  }
  if (checking) {
    return (
      <div className="d-check-line">
        <Icon name="shield" size={14} /><span>Checking…</span>
      </div>
    );
  }
  if (duplicate?.found) {
    return (
      <div className="d-check-line d-bad">
        <Icon name="shield" size={14} /><span>Already in the CRM.</span>
      </div>
    );
  }
  if (duplicate && !duplicate.found && phone.e164) {
    return (
      <div className="d-check-line d-ok">
        <Icon name="check" size={14} /><span>New number.</span>
      </div>
    );
  }
  return (
    <div className="d-check-line">
      <Icon name="shield" size={14} />
      <span>We check every number for duplicates while you type.</span>
    </div>
  );
}

/**
 * The country picker: search, region chips, then the list.
 *
 * On a computer it is a dropdown anchored under the code button. On a phone
 * it is a full bottom sheet with its own title and close button, which is
 * what `AddLead.dc.html` draws and the only shape that works: a 320px menu
 * hanging off a button holds four countries above the keyboard.
 */
function CountryMenu({ chosen, sheet, onPick, onClose }: {
  chosen: Country;
  sheet: boolean;
  onPick: (country: Country) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const [region, setRegion] = useState('Popular');
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  const asked = term.trim().toLowerCase();
  const rows = COUNTRIES.filter((country) => {
    if (asked) {
      return country.name.toLowerCase().includes(asked)
        || `+${country.dial}`.startsWith(asked.startsWith('+') ? asked : `+${asked}`);
    }
    if (region === 'All') return true;
    if (region === 'Popular') return POPULAR.includes(country.iso);
    return REGION[country.iso] === region;
  });

  const body = (
    <>
    {sheet && <div className="d-scrim v2-a-ccdim" onClick={onClose} aria-hidden />}
    <div
      className={sheet ? 'd-menu d-open d-id-cc-menu v2-cc-menu v2-a-ccsheet' : 'd-menu d-open d-id-cc-menu v2-cc-menu'}
      ref={box}
      role={sheet ? 'dialog' : undefined}
      aria-label={sheet ? 'Choose country' : undefined}
    >
      {sheet && (
        <div className="v2-a-cchead">
          <b>Choose country</b>
          <button type="button" className="d-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
      )}
      <div className="d-input-icon">
        <Icon name="search" size={15} />
        <input
          className="d-input d-sm"
          value={term}
          autoFocus
          placeholder={sheet ? 'Search country or code, e.g. India or +91' : 'Country or code'}
          onChange={(e) => setTerm(e.target.value)}
        />
      </div>
      <div className="d-chips">
        {REGIONS.map((one) => (
          <button
            key={one}
            type="button"
            className={region === one && !asked ? 'd-chip-opt d-on' : 'd-chip-opt'}
            onClick={() => { setRegion(one); setTerm(''); }}
          >
            {one}
          </button>
        ))}
      </div>
      <div className="d-id-cc-list">
        {rows.length === 0 ? (
          <div className="d-small d-muted v2-cc-none">
            {sheet ? 'No country found. Try the code, e.g. +44' : 'No country found.'}
          </div>
        ) : rows.map((country) => (
          <button
            key={country.iso}
            type="button"
            className="d-menu-item"
            onClick={() => onPick(country)}
          >
            <b>+{country.dial}</b>
            <span className="d-grow">{flagOf(country.iso)} {country.name}</span>
            {country.iso === chosen.iso && <Icon name="check" size={15} />}
          </button>
        ))}
      </div>
    </div>
    </>
  );

  /*
   * The sheet is moved up to the shell's own root.
   *
   * It lives five levels down inside `.d-add-grid`, and that element is the
   * one the shell's rise-in animates — an animated transform makes a
   * stacking context, so everything inside it is painted below the floating
   * bottom bar whatever z-index it carries. The bar sat on top of the
   * country list.
   *
   * It goes to `.v2`, not to `document.body`: every rule in this app is
   * written `.v2 .d-…`, so a sheet outside that element renders with no
   * styling at all. The computer's dropdown stays where it is, because it is
   * anchored to the button it hangs off.
   */
  const root = typeof document === 'undefined' ? null : document.querySelector('.v2');
  return sheet && root ? createPortal(body, root) : body;
}

/**
 * The projects to offer as chips.
 *
 * The library is the only place a project name may come from, so the chips
 * are what it holds. If the call fails the field is still usable: "Other"
 * takes a typed name.
 */
function useAsyncProjects(): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    void api.get<{ items: Array<{ name: string }> }>('/api/projects')
      .then((got) => setNames(got.items.map((one) => one.name).slice(0, 6)))
      .catch(() => setNames([]));
  }, []);
  return [...names, 'Not sure yet', 'Other'];
}

/** "UAE" rather than "United Arab Emirates" on a 48-pixel button. */
function shortName(country: Country): string {
  if (country.name.length <= 12) return country.name;
  return country.name.split(/[\s-]+/).map((word) => word[0]).join('');
}
