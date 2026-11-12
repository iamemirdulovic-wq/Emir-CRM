import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote } from '../design/ui.js';
import { clockIn, flagOf, originOf, whenToCall } from '../lib/dialling.js';
import { TransferLead } from './TransferLead.js';
import { ActionButton, LeadAction, type LeadActionKind } from './LeadAction.js';

/**
 * One lead, and everything you can do to it.
 *
 * `docs/v2/pages.md` §9. The header's shape is the design's most deliberate
 * decision and worth saying out loud: **the phone number is the largest thing
 * on the page**, larger than the person's name. An agent opens this screen to
 * call somebody. The name tells them who is about to answer; the number is
 * what the next three seconds are about.
 *
 * Built against the real record — what is not wired yet says so rather than
 * pretending. Four of the brokers who tested the design hit a screen that
 * claimed to have saved something it had not, and that is the one mistake
 * this page is not allowed to make.
 */

interface Lead {
  id: string;
  contact_id: string;
  full_name: string | null;
  phone_e164: string | null;
  email: string | null;
  language: string | null;
  stage_key: string;
  status: string;
  is_vip: number;
  returned_at: string | null;
  lead_score: number | null;
  score_band: string | null;
  score_reason: string | null;
  project_name: string | null;
  unit_type: string | null;
  preferred_location: string | null;
  budget_min_aed: number | null;
  budget_max_aed: number | null;
  source: string | null;
  owner_name: string | null;
  next_step_at: string | null;
  next_step_note: string | null;
  last_contact_at: string | null;
  created_at: string;
}

interface Detail {
  lead: Lead;
  contact: Record<string, unknown>;
  activities: Array<{ id: string; type: string; body: string | null; created_at: string }>;
  tags: string[];
  importedRow?: { sourceLabel: string | null; lineNumber: number; fields: { label: string; value: string }[] } | null;
}

const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New', attempted_contact: 'Called', engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting', deal_sent: 'Offer', won: 'Won', lost: 'Lost',
};

const AED = (n: number | null): string =>
  n === null ? '—' : `AED ${n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n.toLocaleString()}`;

export function V2Lead() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState<'notes' | 'timeline' | 'info' | 'files'>('timeline');
  const [handingOver, setHandingOver] = useState(false);
  const [doing, setDoing] = useState<LeadActionKind | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const detail = useAsync<Detail>(() => api.get(`/api/my-leads/${id}`), [id]);

  if (detail.error) return <ErrorNote>{detail.error}</ErrorNote>;
  if (!detail.data) return <Spinner />;

  const { lead, activities, tags } = detail.data;
  const phone = lead.phone_e164 ?? '';
  const origin = originOf(phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  const advice = whenToCall(local, origin?.timeZone ?? null);
  const isOwner = user?.role !== 'agent';

  return (
    <div className="v2-lead">
      {/*
        * The number first and biggest. Everything else on this header is
        * context for it.
        */}
      <header className="v2-lead-head">
        <div className="v2-lead-id">
          <a className="v2-lead-phone" href={phone ? `tel:${phone}` : undefined} dir="ltr">
            {phone || 'No number'}
          </a>
          <div className="v2-lead-name">
            <span dir="auto">{lead.full_name ?? 'Unnamed lead'}</span>
            {lead.is_vip === 1 && <span className="v2-vip">VIP</span>}
            {lead.owner_name && <span className="v2-with">with {lead.owner_name}</span>}
          </div>

          <div className="v2-lead-chips">
            <span className={`v2-stage v2-stage-${(STAGE_LABEL[lead.stage_key] ?? 'new').toLowerCase()}`}>
              {STAGE_LABEL[lead.stage_key] ?? lead.stage_key}
            </span>
            {lead.lead_score !== null && (
              <span className="v2-score" title={lead.score_reason ?? undefined}>
                Score {lead.lead_score}
              </span>
            )}
            {tags.map((t) => <span className="v2-tag" key={t}>{t.replace(/^[a-z]+:/, '')}</span>)}
          </div>
        </div>

        {/* Where they are, what time it is there, and whether now is a decent
            hour to ring. The same card as the live CRM's, which Emir asked
            for on 10 Nov after an agent rang Germany at six in the morning. */}
        {origin && local && (
          <div className={advice?.ok ? 'v2-where' : 'v2-where v2-where-warn'}>
            <div className="v2-where-row">
              <span className="v2-flag">{flagOf(origin.iso2)}</span>
              <span>This number is from <b>{origin.name}</b></span>
            </div>
            <div className="v2-where-row">
              <Icon name="clock-3" />
              <span><b>{local.time}</b> there{origin.zoneLabel ? ` (${origin.zoneLabel})` : ''} · {local.offset}</span>
            </div>
            {advice && <div className="v2-advice">{advice.line}</div>}
          </div>
        )}
      </header>

      {/*
        * The actions. Call, WhatsApp and Telegram work now, because they are
        * links the phone handles. The rest open sheets that are not built
        * yet, and say so when pressed rather than doing nothing -- a button
        * that silently does nothing is the worst of the three options.
        */}
      <nav className="v2-acts" aria-label="What to do with this lead">
        <a className="v2-act v2-act-call" href={phone ? `tel:${phone}` : undefined}>
          <Icon name="phone" />Call
        </a>
        <a
          className="v2-act v2-act-wa"
          href={phone ? `https://wa.me/${phone.replace(/[^\d]/g, '')}` : undefined}
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="message-circle" />WhatsApp
        </a>
        <Soon icon="send" label="Telegram" phase="phase 6" />
        <ActionButton kind="follow_up" label="Follow-up" onClick={() => setDoing('follow_up')} />
        <ActionButton kind="meeting" label="Meeting" onClick={() => setDoing('meeting')} />
        <ActionButton kind="won" label="Won" onClick={() => setDoing('won')} />
        <ActionButton kind="lost" label="Lost" onClick={() => setDoing('lost')} />
      </nav>

      {doing && (
        <LeadAction
          kind={doing}
          opportunityId={lead.id}
          onCancel={() => setDoing(null)}
          onDone={(told) => { setDoing(null); setSaid(told); detail.reload(); }}
        />
      )}

      {/* Handing it on. The lead stays here until the other person accepts,
          which is what the screen says rather than implying it has gone. */}
      {said && <p className="v2-said">{said}</p>}

      {handingOver ? (
        <TransferLead
          opportunityId={lead.id}
          onCancel={() => setHandingOver(false)}
          onDone={(told) => { setHandingOver(false); setSaid(told); detail.reload(); }}
        />
      ) : (
        <p className="v2-transfer-row">
          <button
            type="button"
            className="v2-act v2-act-wide"
            onClick={() => setHandingOver(true)}
          >
            <Icon name="repeat" />
            {lead.is_vip === 1
              ? 'A VIP lead goes back to whoever gave it, not sideways'
              : 'Give this lead to somebody else'}
          </button>
        </p>
      )}

      <div className="v2-lead-cols">
        <section className="v2-card">
          <h2 className="v2-card-t">What {firstName(lead.full_name)} wants</h2>
          <dl className="v2-kv">
            <Row label="Project" value={lead.project_name} />
            <Row label="Unit" value={lead.unit_type} />
            <Row
              label="Budget"
              value={lead.budget_min_aed || lead.budget_max_aed
                ? `${AED(lead.budget_min_aed)} – ${AED(lead.budget_max_aed)}`
                : null}
            />
            <Row label="Where" value={lead.preferred_location} />
            <Row label="Language" value={lead.language} />
            <Row label="Came from" value={lead.source} />
          </dl>
          <p className="v2-note-small">
            Editing a line writes it on the timeline. That arrives in phase 4.
          </p>
        </section>

        <section className="v2-card">
          <div className="v2-card-tabs" role="tablist">
            {(['timeline', 'notes', 'info', 'files'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? 'v2-ctab v2-ctab-on' : 'v2-ctab'}
                onClick={() => setTab(t)}
              >
                {t === 'timeline' ? 'Timeline' : t === 'notes' ? 'Notes' : t === 'info' ? 'Info' : 'Files'}
              </button>
            ))}
          </div>

          {tab === 'timeline' && (
            activities.length === 0
              ? <p className="v2-none">Nothing has happened to this lead yet.</p>
              : (
                <ol className="v2-time">
                  {activities.map((a) => (
                    <li key={a.id}>
                      <span className="v2-time-when">
                        {new Date(a.created_at).toLocaleString('en-GB', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
                        })}
                      </span>
                      <span className="v2-time-what">
                        <b>{a.type.replace(/[._]/g, ' ')}</b>
                        {a.body ? ` · ${a.body}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              )
          )}

          {tab === 'notes' && <p className="v2-none">Notes, voice notes and reminders arrive in phase 4.</p>}

          {tab === 'info' && (
            <dl className="v2-kv">
              <Row label="Phone" value={lead.phone_e164} />
              <Row label="Email" value={lead.email} />
              <Row label="Lead" value={`#${lead.id.slice(0, 8)}`} />
              <Row
                label="Added"
                value={new Date(lead.created_at).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              />
              <Row
                label="Last spoken to"
                value={lead.last_contact_at
                  ? new Date(lead.last_contact_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                  : 'Never'}
              />
            </dl>
          )}

          {tab === 'files' && <p className="v2-none">Photos, booking forms and ID arrive in phase 4.</p>}
        </section>
      </div>

      {/* Every column of the sheet this lead came in on, if it came from one.
          Built 10 Nov, kept here because it is where an agent looks. */}
      {detail.data.importedRow && detail.data.importedRow.fields.length > 0 && (
        <section className="v2-card">
          <h2 className="v2-card-t">
            From the sheet
            {detail.data.importedRow.sourceLabel && (
              <span className="v2-from">{detail.data.importedRow.sourceLabel}</span>
            )}
          </h2>
          <dl className="v2-kv">
            {detail.data.importedRow.fields.map((f, i) => (
              <Row key={`${i}-${f.label}`} label={f.label} value={f.value} />
            ))}
          </dl>
        </section>
      )}

      <p className="v2-back-row">
        <Link to="/v2/leads">← Back to leads</Link>
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt>{label}</dt>
      <dd dir="auto">{value && String(value).trim() !== '' ? value : '—'}</dd>
    </>
  );
}

/**
 * A button that is drawn but not wired, and says which phase wires it.
 *
 * It is a button rather than a gap because the row has to look like the
 * design now, and it refuses out loud rather than doing nothing, because a
 * control that silently ignores a press is the thing every tester hated most.
 */
function Soon({ icon, label, phase, wide }: { icon: string; label: string; phase: string; wide?: boolean }) {
  const [said, setSaid] = useState(false);
  return (
    <button
      type="button"
      className={wide ? 'v2-act v2-act-wide v2-act-soon' : 'v2-act v2-act-soon'}
      onClick={() => setSaid(true)}
      title={`Not built yet — ${phase}`}
    >
      <Icon name={icon as never} />
      {said ? `Not built yet — ${phase}` : label}
    </button>
  );
}

function firstName(full: string | null): string {
  if (!full) return 'they';
  return full.trim().split(/\s+/)[0] ?? 'they';
}
