import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { sourceStyle } from '../design/stages.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, budgetLabel } from '../design/ui.js';
import { clockIn, flagOf, originOf, whenToCall } from '../lib/dialling.js';
import { spacedE164 } from '../design/phone.js';
import { TransferLead } from './TransferLead.js';
import { LeadAction, type LeadActionKind } from './LeadAction.js';
import { usePhoneHead } from './phone.js';
import { LeadNotes } from '../components/LeadNotes.js';

/**
 * One lead, and everything you can do to it.
 *
 * Built from `design/web/lead.html`: three columns, and each one answers a
 * different question. The left is *who they are and what you can do right
 * now*; the middle is *what is owed and what has happened*; the right is
 * *what they asked for*. The page root carries `p-lead` so that page's own
 * ported stylesheet applies — without it the grid never happens and the page
 * falls into one tall column.
 *
 * The header's shape is the design's most deliberate decision and worth
 * saying out loud: **the phone number is the largest thing on the page**,
 * larger than the person's name. An agent opens this screen to call
 * somebody. The name tells them who is about to answer; the number is what
 * the next three seconds are about.
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
  budget_band?: string | null;
  source: string | null;
  owner_name: string | null;
  next_step_at: string | null;
  next_step_note: string | null;
  last_contact_at: string | null;
  created_at: string;
}

interface Task {
  id: string;
  type: string | null;
  title: string | null;
  due_at: string | null;
  completed_at: string | null;
}

interface Detail {
  lead: Lead;
  contact: Record<string, unknown>;
  activities: Array<{
    id: string; type: string; title?: string | null; body: string | null;
    user_name?: string | null; created_at: string;
  }>;
  tasks?: Task[];
  tags: string[];
  importedRow?: { sourceLabel: string | null; lineNumber: number; fields: { label: string; value: string }[] } | null;
}

const STAGE_LABEL: Record<string, string> = {
  new_lead: 'New', attempted_contact: 'Called', engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting', deal_sent: 'Offer', won: 'Won', lost: 'Lost',
};

const STAGE_CHIP: Record<string, string> = {
  new_lead: 'new', attempted_contact: 'called', engaged_qualified: 'interested',
  appointment_scheduled: 'meeting', deal_sent: 'offer', won: 'won', lost: 'lost',
};

/** The dot beside a line of history: its glyph, and how loud it is. */
function mark(type: string): { icon: IconName; tone: string } {
  if (/call/.test(type)) return { icon: 'phone', tone: 'd-accent' };
  if (/whatsapp|message|tap/.test(type)) return { icon: 'message-circle', tone: 'd-green' };
  if (/email/.test(type)) return { icon: 'mail', tone: 'd-blue' };
  if (/note/.test(type)) return { icon: 'pencil', tone: '' };
  if (/stage|moved/.test(type)) return { icon: 'arrow-right', tone: '' };
  if (/transfer|assign/.test(type)) return { icon: 'repeat', tone: '' };
  if (/won/.test(type)) return { icon: 'trophy', tone: 'd-green' };
  if (/lost/.test(type)) return { icon: 'x', tone: 'd-red' };
  if (/created|added|import/.test(type)) return { icon: 'check', tone: 'd-green' };
  if (/meeting|viewing/.test(type)) return { icon: 'calendar-days', tone: 'd-accent' };
  return { icon: 'circle', tone: '' };
}

/** "Today 15:30" / "Fri 13 Nov 11:00" — how the design writes a moment. */
function moment(value: string | null): string {
  if (!value) return '';
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  const day = (d: Date) => Math.floor((d.getTime() + 4 * 3_600_000) / 86_400_000);
  const clock = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const gap = day(at) - day(new Date());
  if (gap === 0) return `Today ${clock}`;
  if (gap === 1) return `Tomorrow ${clock}`;
  if (gap === -1) return `Yesterday ${clock}`;
  return `${at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${clock}`;
}

export function V2Lead() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [tab, setTab] = useState<'notes' | 'timeline' | 'info' | 'files'>('timeline');
  const [handingOver, setHandingOver] = useState(false);
  const [doing, setDoing] = useState<LeadActionKind | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const detail = useAsync<Detail>(() => api.get(`/api/my-leads/${id}`), [id]);

  /*
   * §1.4 / the audit: the shell draws the header, so this page must not draw
   * a title of its own — two titles appeared, "My leads" over the record.
   * `Lead.dc.html` gives this screen no page title at all: the header *is*
   * the record, back button then stage and score. The nearest the shell can
   * do is carry the name and those two pills, which is what this says.
   *
   * It is above the early returns on purpose: a hook after a `return` runs on
   * the second render and not the first, and blanks the page. That has
   * happened on this very page before — `hook-order.test.ts`.
   */
  const loaded = detail.data?.lead;
  usePhoneHead({
    title: loaded?.full_name ?? 'Lead',
    sub: loaded
      ? [
        STAGE_LABEL[loaded.stage_key] ?? loaded.stage_key,
        loaded.lead_score === null ? null : `Score ${loaded.lead_score}`,
        loaded.owner_name ? `with ${loaded.owner_name}` : 'in Incoming',
      ].filter(Boolean).join(' · ')
      : '',
  });

  if (detail.error) return <ErrorNote>{detail.error}</ErrorNote>;
  if (!detail.data) return <Spinner />;

  const { lead, activities, tags } = detail.data;
  const tasks = (detail.data.tasks ?? []).filter((one) => !one.completed_at && one.due_at);
  const phone = lead.phone_e164 ?? '';
  const origin = originOf(phone);
  const local = origin ? clockIn(origin.timeZone) : null;
  const advice = whenToCall(local, origin?.timeZone ?? null);
  const first = firstName(lead.full_name);
  const closed = lead.status === 'won' || lead.status === 'lost';
  const budget = lead.budget_min_aed || lead.budget_max_aed
    ? budgetLabel(lead.budget_min_aed, lead.budget_max_aed, lead.budget_band ?? null)
    : null;

  return (
    <div className="v2-leadpage p-lead">
      <div className="d-lead-grid">

        {/* ── LEFT: who they are, and what you can do right now ────────── */}
        <aside className="d-lcol">
          <section className="d-card">
            <span className="d-sec-label">Phone</span>
            {/*
              * Grouped for reading aloud. The calling screen has printed
              * `+971 50 123 4567` since it was built and this one printed the
              * raw `+971501234567` — and this is the one an agent dictates
              * from. `tel:` still carries the unspaced number.
              */}
            <a
              className="d-lead-phone"
              href={phone ? `tel:${phone}` : undefined}
              dir="ltr"
              title={phone ? 'Call' : undefined}
            >
              {spacedE164(phone) ?? 'No number'}
            </a>
            <div className="d-lead-name" dir="auto">{lead.full_name ?? 'Unnamed lead'}</div>

            <div className="d-row d-gap-6 d-wrap d-mt-8">
              <span className={`d-chip d-stage-${STAGE_CHIP[lead.stage_key] ?? 'new'}`}>
                {STAGE_LABEL[lead.stage_key] ?? lead.stage_key}
              </span>
              {lead.lead_score !== null && (
                <span className="d-chip d-green" title={lead.score_reason ?? undefined}>
                  Score {lead.lead_score}
                </span>
              )}
              {lead.is_vip === 1 && <span className="d-vip-tag">VIP</span>}
              {lead.score_band === 'hot' && <span className="d-chip d-orange">Hot</span>}
              {tags.map((one) => (
                <span className="d-chip" key={one}>{one.replace(/^[a-z]+:/, '')}</span>
              ))}
            </div>

            {/* Where they are, what time it is there, and whether now is a
                decent hour to ring. Emir asked for this on 10 Nov after an
                agent rang Germany at six in the morning. */}
            <div className="d-facts">
              <div>
                {lead.owner_name
                  ? (
                    <>
                      <Avatar name={lead.owner_name} size={20} />
                      <span>with <b>{lead.owner_name}</b></span>
                    </>
                  )
                  : (
                    <>
                      <Icon name="inbox" />
                      <span>in <b>Incoming</b> · no agent yet</span>
                    </>
                  )}
              </div>
              {origin && local && (
                <div>
                  <span className="v2-leadpage-flag">{flagOf(origin.iso2)}</span>
                  <span>
                    {origin.name} · <b>{origin.zoneLabel ? `${origin.zoneLabel} ` : ''}{local.time}</b> now
                  </span>
                </div>
              )}
              {advice && (
                <div>
                  <Icon name="clock" />
                  <span className={advice.ok ? undefined : 'd-t-amber'}>{advice.line}</span>
                </div>
              )}
              {lead.language && (
                <div>
                  <Icon name="message-square" />
                  <span>Speaks <b>{lead.language}</b></span>
                </div>
              )}
            </div>

            <div className="d-acts">
              <a
                className={phone ? 'd-btn d-primary d-lg d-full' : 'd-btn d-primary d-lg d-full d-disabled'}
                href={phone ? `tel:${phone}` : undefined}
              >
                <Icon name="phone" />Call
              </a>
              <a
                className={phone ? 'd-btn' : 'd-btn d-disabled'}
                href={phone ? `https://wa.me/${phone.replace(/[^\d]/g, '')}` : undefined}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="message-circle" />WhatsApp
              </a>
              <Soon icon="send" label="Telegram" phase="phase 6" />
              <button type="button" className="d-btn" onClick={() => setDoing('follow_up')}>
                <Icon name="clock" />Follow-up
              </button>
              <button type="button" className="d-btn" onClick={() => setDoing('meeting')}>
                <Icon name="calendar-days" />Meeting
              </button>
              <button
                type="button"
                className={closed ? 'd-btn d-won d-disabled' : 'd-btn d-won'}
                disabled={closed}
                onClick={() => setDoing('won')}
              >
                <Icon name="trophy" />Won
              </button>
              <button
                type="button"
                className={closed ? 'd-btn d-danger d-disabled' : 'd-btn d-danger'}
                disabled={closed}
                onClick={() => setDoing('lost')}
              >
                <Icon name="x" />Lost
              </button>
            </div>

            {/* Handing it on. The lead stays here until the other person
                accepts, which is what the form says rather than implying it
                has gone. */}
            <button type="button" className="d-tr-link" onClick={() => setHandingOver(true)}>
              <Icon name="repeat" />
              <span className="d-grow">
                {lead.is_vip === 1
                  ? 'A VIP lead goes back to whoever gave it'
                  : user?.role === 'agent'
                    ? 'Transfer this lead to another agent'
                    : 'Give this lead to another agent'}
              </span>
            </button>
          </section>
        </aside>

        {/* ── MIDDLE: what is owed, and what has happened ──────────────── */}
        <div className="d-mid">
          {said && (
            <div className="d-banner d-green">
              <Icon name="check" />
              <span className="d-grow">{said}</span>
            </div>
          )}

          <section className={lead.next_step_at ? 'd-card d-next-card' : 'd-card d-next-card d-none'}>
            <span className="d-card-icon d-accent v2-leadpage-flagicon"><Icon name="calendar-check" /></span>
            <div className="d-grow">
              <span className="d-sec-label">Next step</span>
              <div className="d-big">{lead.next_step_note || (lead.next_step_at ? 'Follow up' : 'No next step')}</div>
              <span className="d-small d-muted">
                {lead.next_step_at
                  ? moment(lead.next_step_at)
                  : 'Plan a follow-up or a meeting so the lead does not go cold.'}
              </span>
            </div>
            <button type="button" className="d-btn d-sm d-ghost" onClick={() => setDoing('follow_up')}>
              {lead.next_step_at ? 'Change' : 'Add one'}
            </button>
          </section>

          <section className="d-card v2-leadpage-tabs">
            <div className="d-tabs" role="tablist">
              {(['notes', 'timeline', 'info', 'files'] as const).map((one) => (
                <button
                  key={one}
                  type="button"
                  role="tab"
                  aria-selected={tab === one}
                  className={tab === one ? 'd-tab d-on' : 'd-tab'}
                  onClick={() => setTab(one)}
                >
                  {one === 'notes' ? 'Notes' : one === 'timeline' ? 'Timeline' : one === 'info' ? 'Info' : 'Files'}
                  {one === 'timeline' && activities.length > 0 && (
                    <span className="d-count">{activities.length}</span>
                  )}
                </button>
              ))}
            </div>

            {/*
              * Notes, for real.
              *
              * The tab said "not built yet · phase 4" while `/api/notes` has
              * been complete since phase 2 — list, add, pin, edit, restore,
              * attachments and voice files — and `components/LeadNotes.tsx`
              * already drives all of it. `Notes.dc.html` asks for the type
              * chip, the PINNED badge, who and when, the quick phrases, the
              * hold-to-record voice note and the reminder, and that
              * component has every one of them. What it has not got is the
              * transcript, the AI-extracted fields and the four named
              * folders, because the server stores none of those — see
              * `docs/v2/phone-questions-a.md`.
              */}
            {tab === 'notes' && (
              <LeadNotes
                contactId={lead.contact_id}
                opportunityId={lead.id}
                onLeadChanged={detail.reload}
              />
            )}

            {tab === 'timeline' && (
              activities.length === 0
                ? (
                  <div className="d-empty">
                    <span className="d-ic"><Icon name="activity" size={26} /></span>
                    <b>Nothing has happened yet</b>
                    <p>Calls, messages and stage changes appear here as they happen.</p>
                  </div>
                )
                : (
                  <div className="d-timeline">
                    {activities.map((one) => {
                      const dot = mark(one.type);
                      return (
                        <div className="d-tl-item" key={one.id}>
                          <span className={dot.tone ? `d-tl-dot ${dot.tone}` : 'd-tl-dot'}>
                            <Icon name={dot.icon} size={14} />
                          </span>
                          <div className="d-tl-body">
                            <b>{sentence(one.title?.trim() || one.type.replace(/[._]/g, ' '))}</b>
                            {one.body && <p>{one.body}</p>}
                            <span className="d-tl-time">
                              {moment(one.created_at)}
                              {one.user_name ? ` · ${one.user_name}` : ''}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
            )}

            {tab === 'info' && (
              <dl className="d-kv">
                <Row label="Phone" value={lead.phone_e164} />
                <Row label="Email" value={lead.email} />
                <Row label="Language" value={lead.language} />
                <Row label="Lead #" value={`#${lead.id.slice(0, 8)}`} />
                <Row
                  label="Added"
                  value={new Date(lead.created_at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  })}
                />
                <Row
                  label="Last spoken to"
                  value={lead.last_contact_at ? moment(lead.last_contact_at) : 'Never'}
                />
              </dl>
            )}

            {tab === 'files' && (
              <div className="d-empty">
                <span className="d-ic"><Icon name="paperclip" size={26} /></span>
                <b>Files live on a note</b>
                <p>
                  A photo, a booking form or a voice note is attached to the note
                  it belongs to, so it keeps the words that go with it. Open
                  Notes to add one or to look at what is there.
                </p>
                <button type="button" className="d-btn d-sm" onClick={() => setTab('notes')}>
                  Open Notes
                </button>
              </div>
            )}
          </section>

          {/* Every column of the row this lead came in on, if it came from
              one. The design has no slot for it, and it belongs where an
              agent looks: with the rest of the history. */}
          {detail.data.importedRow && detail.data.importedRow.fields.length > 0 && (
            <section className="d-card">
              <div className="d-card-head">
                <h3>From the sheet</h3>
                {detail.data.importedRow.sourceLabel && (
                  <span className="d-chip">{detail.data.importedRow.sourceLabel}</span>
                )}
              </div>
              <dl className="d-kv">
                {detail.data.importedRow.fields.map((one, i) => (
                  <Row key={`${i}-${one.label}`} label={one.label} value={one.value} />
                ))}
              </dl>
            </section>
          )}

          <p className="v2-back-row">
            <Link to="/v2/leads">← Back to leads</Link>
          </p>
        </div>

        {/* ── RIGHT: what they asked for ───────────────────────────────── */}
        <div className="d-rcol">
          <section className="d-card" aria-label={`What ${first} wants`}>
            <div className="d-card-head v2-leadpage-wants-head">
              <h3>What {first} wants</h3>
            </div>
            <dl className="d-kv">
              <Row label="Project" value={lead.project_name} />
              <Row label="Unit" value={lead.unit_type} />
              <Row label="Budget" value={budget} />
              <Row label="Where" value={lead.preferred_location} />
              <Row label="Language" value={lead.language} />
            </dl>
            <dl className="d-kv d-mt-12 v2-leadpage-wants-foot">
              <Row label="Source" value={sourceStyle(lead.source).label} />
              <Row label="Lead #" value={`#${lead.id.slice(0, 8)}`} />
            </dl>
          </section>

          <section className="d-card" aria-label="Coming up">
            <div className="d-card-head v2-leadpage-wants-head">
              <h3>Coming up</h3>
              <Link className="d-card-link" to="/v2/calendar">
                Calendar <Icon name="arrow-right" size={14} />
              </Link>
            </div>
            {tasks.length === 0
              ? <p className="d-small d-muted">Nothing planned yet.</p>
              : tasks.map((one) => {
                const when = one.due_at ? new Date(one.due_at) : null;
                return (
                  <div className="d-up" key={one.id}>
                    <span className="d-d">
                      {when ? when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }) : '—'}
                      <b>
                        {when
                          ? when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
                          : ''}
                      </b>
                    </span>
                    <div className="d-grow">
                      <b className="d-bold">{one.title ?? 'Task'}</b>
                      <div className="d-small d-muted">{(one.type ?? 'task').replace(/_/g, ' ')}</div>
                    </div>
                  </div>
                );
              })}
          </section>
        </div>
      </div>

      {doing && (
        <LeadAction
          kind={doing}
          opportunityId={lead.id}
          who={lead.full_name}
          onCancel={() => setDoing(null)}
          onDone={(told) => { setDoing(null); setSaid(told); detail.reload(); }}
        />
      )}

      {handingOver && (
        <TransferLead
          opportunityId={lead.id}
          who={lead.full_name}
          isVip={lead.is_vip === 1}
          onCancel={() => setHandingOver(false)}
          onDone={(told) => { setHandingOver(false); setSaid(told); detail.reload(); }}
        />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="d-kv-row">
      <dt>{label}</dt>
      <dd dir="auto">{value && String(value).trim() !== '' ? value : '—'}</dd>
    </div>
  );
}

/**
 * A button that is drawn but not wired, and says which phase wires it.
 *
 * It is a button rather than a gap because the row has to look like the
 * design now, and it refuses out loud rather than doing nothing, because a
 * control that silently ignores a press is the thing every tester hated most.
 */
function Soon({ icon, label, phase }: { icon: IconName; label: string; phase: string }) {
  const [said, setSaid] = useState(false);
  return (
    <button
      type="button"
      className="d-btn"
      onClick={() => setSaid(true)}
      title={`Not built yet — ${phase}`}
    >
      <Icon name={icon} />
      {said ? `Not yet — ${phase}` : label}
    </button>
  );
}

/** `call.logged` arrives as "call logged"; a line of history starts big. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function firstName(full: string | null): string {
  if (!full) return 'they';
  return full.trim().split(/\s+/)[0] ?? 'they';
}
