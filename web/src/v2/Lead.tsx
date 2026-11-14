import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { sourceStyle } from '../design/stages.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, budgetLabel } from '../design/ui.js';
import { clockIn, flagOf, originOf, whenToCall } from '../lib/dialling.js';
import { spacedE164 } from '../design/phone.js';
import { TransferLead } from './TransferLead.js';
import { LeadHandover } from './LeadHandover.js';
import { given } from '../lib/assigned.js';
import { civil } from '../lib/calendar.js';
import { formatTime } from '../lib/format.js';
import { LeadAction, type LeadActionKind } from './LeadAction.js';
import { usePhoneHead } from './phone.js';
import { useCallAction } from './call.js';
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
  /* The three lines of "What the client wants" the endpoint never sent. */
  purpose: string | null;
  timeline: string | null;
  payment_method: string | null;
  source: string | null;
  owner_name: string | null;
  next_step_at: string | null;
  next_step_note: string | null;
  last_contact_at: string | null;
  /** When the lead was given to the agent holding it. Null in the pool. */
  assigned_at: string | null;
  created_at: string;
  /* The deal, for a lead that is Won. */
  deal_value_aed: number | null;
  won_paid_aed: number | null;
  won_signed: string | null;
  won_unit: string | null;
  lost_reason_v2: string | null;
}

interface Task {
  id: string;
  type: string | null;
  title: string | null;
  due_at: string | null;
  completed_at: string | null;
}

/** The columns of `contacts` the Info tab draws, all of which were already sent. */
interface Person {
  telegram?: string | null;
  whatsapp_number?: string | null;
  nationality?: string | null;
  email?: string | null;
  phone_e164?: string | null;
  language?: string | null;
}

interface Detail {
  lead: Lead;
  contact: Record<string, unknown> & Person;
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
  /* An edited field, which is a kind of row this timeline could not draw
     because nothing on the page could make one. */
  if (/field_edit|updated/.test(type)) return { icon: 'pencil', tone: '' };
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
  const { day, clock } = dubaiParts(at);
  return `${day} ${clock}`;
}

/**
 * A moment, in Dubai, split into the day word and the clock.
 *
 * It used to bucket the day at +04:00 and then print the clock and the date
 * with `toLocaleTimeString` and `toLocaleDateString` and **no timezone** —
 * so on any laptop outside Dubai the day said "Today" off the Dubai clock
 * while the time beside it was the reader's own, four or more hours out, on
 * every timestamp on this page. Emir's rule is flat: times are 24-hour and
 * Dubai time. `civil()` and `formatTime()` are the two helpers that promise
 * both, and `calendar.ts` reads the offset out of `Intl` rather than
 * hard-coding four hours.
 */
function dubaiParts(at: Date): { day: string; clock: string } {
  const dayNumber = (d: Date) => Math.floor(civil(d).getTime() / 86_400_000);
  const gap = dayNumber(at) - dayNumber(new Date());
  const clock = formatTime(at);
  if (gap === 0) return { day: 'Today', clock };
  if (gap === 1) return { day: 'Tomorrow', clock };
  if (gap === -1) return { day: 'Yesterday', clock };
  return {
    day: civil(at).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    }),
    clock,
  };
}

const TAB_KEYS = ['notes', 'timeline', 'info', 'files'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export function V2Lead() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  /*
   * The leads list's "⋯" menu points straight at a tab or a dialog —
   * "Add note", "Plan a follow-up", "Transfer to another agent" — so the
   * address carries which one. Without it those three menu items would all
   * land on the same page and leave the agent to find the thing themselves.
   */
  const [params] = useSearchParams();
  const asked = params.get('tab');
  /*
   * Notes first. Emir, 14 Nov, §5.3e: *"Tabs: Notes (opens first, with count)
   * | Timeline | Info | Files."* It opened on Timeline, which is the record
   * of what the CRM did; Notes is the record of what the client said, and
   * that is what an agent opens a lead to read.
   */
  const [tab, setTab] = useState<TabKey>(
    () => ((TAB_KEYS as readonly string[]).includes(asked ?? '') ? asked as TabKey : 'notes'),
  );
  const [handingOver, setHandingOver] = useState(params.get('do') === 'transfer');
  const [doing, setDoing] = useState<LeadActionKind | null>(
    params.get('do') === 'follow_up' ? 'follow_up'
      : params.get('do') === 'meeting' ? 'meeting'
        : null,
  );
  const [said, setSaid] = useState<string | null>(null);
  /*
   * The tap we are waiting on an answer for. `whatsapp()` hands back the
   * id of the row it wrote, which is what `PATCH /api/v2/taps/:id` wants.
   */
  const [tapped, setTapped] = useState<{ id: string; app: 'whatsapp' | 'telegram' } | null>(null);
  const detail = useAsync<Detail>(() => api.get(`/api/my-leads/${id}`), [id]);
  /*
   * The brief behind "In short". A plain read — no model call — so opening a
   * lead is never slower for it, and it may legitimately come back with
   * nothing to say, which is why the card below falls back to the record's
   * own facts rather than to an empty box.
   */
  const brief = useAsync<Brief>(() => api.get(`/api/my-leads/${id}/brief`), [id]);
  /* What the three menu lines may say. Sent by the server rather than written
     here as well, so a choice on the page is one the column can hold. */
  const choices = useAsync<Choices>(() => api.get('/api/my-leads/wants/choices'), []);

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
  const tabsAt = useRef<HTMLElement>(null);
  /*
   * Every Call and WhatsApp on this page goes through the one helper, so the
   * call is recorded before the phone opens. Above the early returns with the
   * rest of them — it holds state and the check-in sheet.
   */
  const dial = useCallAction({ source: 'lead' });

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
  /* An edit writes a timeline entry and a change-history row on the server,
     so the page is re-read rather than patched in place: the new line has to
     appear on the timeline beside the change, which is the point of it. */
  function afterEdit(told: string) {
    setSaid(told);
    detail.reload();
    brief.reload();
  }

  /** The words for a stored enum value, from the list the server sent. */
  function choiceLabel(field: 'purpose' | 'timeline' | 'payment', stored: string | null): string | null {
    if (!stored) return null;
    const found = choices.data?.[field]?.find((one) => one.value === stored);
    if (found) return found.value === 'unknown' ? null : found.label;
    /* Before the choices land, show the stored word rather than a blank. */
    return stored === 'unknown' ? null : stored.replace(/_/g, ' ');
  }

  const closed = lead.status === 'won' || lead.status === 'lost';
  const budget = lead.budget_min_aed || lead.budget_max_aed
    ? budgetLabel(lead.budget_min_aed, lead.budget_max_aed, lead.budget_band ?? null)
    : lead.budget_band ?? null;
  const person = detail.data.contact;

  return (
    <div className="v2-leadpage p-lead">
      {/* The check-in sheet and anything the recording could not do. Without
          it on the page the question cannot be asked and Call would hang. */}
      {dial.banner}
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
              onClick={(e) => {
                if (!phone) return;
                /* The href stays — it is what a long press on a phone offers
                   and what right-click copies. The click is taken over so the
                   call is written down first. */
                e.preventDefault();
                void dial.call(lead);
              }}
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
              {/* The design's third chip. `purpose` has been on the row since
                  the first migration and was never sent to the screen. */}
              {lead.purpose === 'investment' && <span className="d-chip">Investor</span>}
              {lead.purpose === 'end_use' && <span className="d-chip">To live in</span>}
              {/*
                * No raw tags here. Emir, 14 Nov, §5.2: *"Only clean tags:
                * Stage, Score, Hot, VIP, Investor."* The row underneath used
                * to print every tag on the contact, which on an imported lead
                * is `leads_gesamtliste_12nov_f3d5`, `csv_import` and `en` —
                * the spreadsheet's own file name, a database word and a
                * language code, three things no agent needs and all three
                * against the rule at the top of his list.
                *
                * They are not thrown away: the Info tab lists them under
                * "Tags", tidied into words, so nothing is lost and the card
                * an agent reads before dialling is the five chips the design
                * draws.
                */}
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
                      {/*
                        * "with Rocky · since Mon 9 Nov" — §5.2. The name
                        * alone does not say how long they have been sitting
                        * on it, which is the question an owner asks of this
                        * line. The date is `assigned_at`, through the one
                        * helper the leads list uses, so it cannot read one
                        * way here and another there; a lead with no date
                        * says so rather than borrowing another.
                        */}
                      <span>
                        with <b>{lead.owner_name}</b>
                        {given(lead.assigned_at).missing
                          ? ''
                          : ` · since ${given(lead.assigned_at).when}`}
                      </span>
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
                  {/* The name, not the code: this line read "Speaks en". */}
                  <span>Speaks <b>{languageName(lead.language)}</b></span>
                </div>
              )}
            </div>

            <div className="d-acts">
              <a
                className={phone ? 'd-btn d-primary d-lg d-full' : 'd-btn d-primary d-lg d-full d-disabled'}
                href={phone ? `tel:${phone}` : undefined}
                onClick={(e) => { if (!phone) return; e.preventDefault(); void dial.call(lead); }}
              >
                <Icon name="phone" />Call
              </a>
              <a
                className={phone ? 'd-btn' : 'd-btn d-disabled'}
                href={phone ? `https://wa.me/${phone.replace(/[^\d]/g, '')}` : undefined}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (!phone) return;
                  e.preventDefault();
                  /* The blue line goes up the moment WhatsApp opens, so the
                     question is on screen when the agent comes back. */
                  void dial.whatsapp(lead).then((id) => {
                    if (id) setTapped({ id, app: 'whatsapp' });
                  });
                }}
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

          {/*
            * §5.3a / §5.10, the first thing in the middle column: the blue
            * line that appears after a WhatsApp or Telegram tap.
            *
            * The CRM opens the app with the message typed in; it cannot see
            * what happened next, and `/api/v2/taps/:id` has been waiting for
            * the answer since it was written — nothing in the web app ever
            * asked for it. So every tap was recorded as a tap and never as
            * an outcome, and the owner's figures had a hole the shape of
            * every WhatsApp this company sends.
            */}
          {tapped !== null && (
            <WhatsappAsked
              tapId={tapped.id}
              app={tapped.app}
              onAnswered={(told) => { setTapped(null); setSaid(told); detail.reload(); }}
              onClose={() => setTapped(null)}
            />
          )}

          {/*
            * A closed lead's card says what became of it rather than nagging
            * for a next step it must not have — the design's own `won` and
            * `lost` states. The money is what the Won dialog recorded.
            */}
          {lead.status === 'won'
            ? (
              <section className="d-card d-next-card">
                <span className="d-card-icon d-accent v2-leadpage-flagicon"><Icon name="trophy" /></span>
                <div className="d-grow">
                  <span className="d-sec-label">Deal done</span>
                  <div className="d-big">{lead.won_unit || lead.project_name || 'Unit booked'}</div>
                  <span className="d-small d-muted">{dealLine(lead)}</span>
                </div>
              </section>
            )
            : lead.status === 'lost'
              ? (
                <section className="d-card d-next-card d-none">
                  <span className="d-card-icon v2-leadpage-flagicon"><Icon name="x" /></span>
                  <div className="d-grow">
                    <span className="d-sec-label">Lost</span>
                    <div className="d-big">
                      {(lead.lost_reason_v2 ?? 'no reason given').replace(/_/g, ' ')}
                    </div>
                    <span className="d-small d-muted">
                      The lead is not in your open list. Add a follow-up to try again.
                    </span>
                  </div>
                </section>
              )
              : (
                <section className={lead.next_step_at ? 'd-card d-next-card' : 'd-card d-next-card d-none'}>
                  <span className="d-card-icon d-accent v2-leadpage-flagicon"><Icon name="calendar-check" /></span>
                  <div className="d-grow">
                    <span className="d-sec-label">Next step</span>
                    <div className="d-big">
                      {lead.next_step_note || (lead.next_step_at ? 'Follow up' : 'No next step')}
                    </div>
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
              )}

          {/*
            * "In short" — the design's second card, and the one an agent
            * reads before they dial. It had no equivalent at all.
            *
            * The AI's three lines when the model has read the notes; the
            * record's own facts when it has not, which is what the design
            * itself falls back to for any lead but its sample one. The Homes
            * AI chip appears only when the AI really wrote it.
            */}
          <InShort lead={lead} brief={brief.data ?? null} budget={budget} />

          {/*
            * The owner's "two dates", 14 Nov. Always on the page, because the
            * whole complaint was that a lead carried no date at all.
            */}
          <LeadHandover leadId={lead.id} />

          {/*
            * §5.3d: a note box that is always there.
            *
            * Emir's own words for what was wrong: *"no place to write a
            * note."* There was one, two scrolls down and behind a tab, which
            * is the same as not having one — an agent puts the phone down
            * and writes while it is fresh or not at all. This is the
            * design's `composer`, in the design's own place: under "In
            * short", above the tabs.
            *
            * It writes through the same `POST /api/notes/{contact}` the
            * Notes tab uses, so a note typed here is the same note, in the
            * same list, with the same type chips. Voice notes stay in the
            * tab below, where the recorder lives.
            */}
          {/*
            * Not drawn while the Notes tab is open: the full note box —
            * quick phrases, attachments, voice, "remind me" — is two inches
            * below in the same column, and two places to type on one screen
            * is the fault this was written to fix, not a second instance of
            * it. On every other tab this is the only one, which is what
            * "always visible" is for.
            */}
          {tab !== 'notes' && (
            <NoteBox
              contactId={lead.contact_id}
              opportunityId={lead.id}
              who={firstName(lead.full_name)}
              onSaved={(told) => { setSaid(told); detail.reload(); setTab('notes'); }}
            />
          )}

          <section className="d-card v2-leadpage-tabs" ref={tabsAt}>
            <div className="d-tabs" role="tablist">
              {TAB_KEYS.map((one) => (
                <button
                  key={one}
                  type="button"
                  role="tab"
                  aria-selected={tab === one}
                  className={tab === one ? 'd-tab d-on' : 'd-tab'}
                  onClick={() => {
                    setTab(one);
                    /*
                     * `Notes.dc.html` is a screen of its own — "Notes & files",
                     * the lead's name under it — not a tab two screenfuls down
                     * a page. This build has no route of its own for it, so
                     * pressing a tab brings it to the top of the phone, which
                     * is the nearest honest thing to what the design draws.
                     */
                    if (window.matchMedia('(max-width:767px)').matches) {
                      tabsAt.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
                    }
                  }}
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
                      /* §5.8: plain English, and the spreadsheet's own words
                         left out of it — they are on the Info tab, under
                         "From the file", where they belong. */
                      const said = plainly(one, lead.owner_name);
                      return (
                        <div className="d-tl-item" key={one.id}>
                          <span className={dot.tone ? `d-tl-dot ${dot.tone}` : 'd-tl-dot'}>
                            <Icon name={dot.icon} size={14} />
                          </span>
                          <div className="d-tl-body">
                            <b>{said.title}</b>
                            {said.body !== null && <p>{said.body}</p>}
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
              <>
                <dl className="d-kv">
                  <Row label="Phone" value={spacedE164(lead.phone_e164 ?? '') ?? lead.phone_e164} />
                  {/* All three are columns of `contacts` from migration 0036,
                      sent with the record all along and drawn by nothing. */}
                  <Row label="WhatsApp 2" value={text(person.whatsapp_number)} />
                  <Row label="Telegram" value={text(person.telegram)} />
                  <Row label="Email" value={lead.email} />
                  <Row label="Nationality" value={text(person.nationality)} />
                  <Row label="Language" value={languageName(lead.language)} />
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

                {/*
                  * The tags, out of the left card and into here — §5.2.
                  * Tidied into words on the way: `src:csv_import` is a
                  * namespace and a database word, and "CSV import" is what
                  * it means. The list's own name is kept as it was typed,
                  * because that is a real name somebody chose.
                  */}
                {tags.length > 0 && (
                  <>
                    <h4 className="d-mt-24 d-mb-8">Tags</h4>
                    <div className="d-row d-gap-6 d-wrap">
                      {tags.map((one) => (
                        <span className="d-chip" key={one}>{tagWords(one)}</span>
                      ))}
                    </div>
                  </>
                )}

                {/*
                  * §5.8: the spreadsheet's own columns belong here, under
                  * "From the file", and not in the timeline. Emir found the
                  * German text out of his Excel sheet — "Prüfen
                  * Ländervorwahl: +91 Hinweis: 10-stellig ohne Vorwahl…" —
                  * printed as a line of the lead's history, where it reads
                  * as something the CRM did.
                  */}
                {detail.data.importedRow && detail.data.importedRow.fields.length > 0 && (
                  <>
                    <h4 className="d-mt-24 d-mb-8">
                      From the file
                      {detail.data.importedRow.sourceLabel
                        ? ` · ${detail.data.importedRow.sourceLabel}`
                        : ''}
                    </h4>
                    <dl className="d-kv">
                      {detail.data.importedRow.fields.map((one, i) => (
                        <Row key={`${i}-${one.label}`} label={one.label} value={one.value} />
                      ))}
                    </dl>
                  </>
                )}

                <History leadId={lead.id} />
              </>
            )}

            {tab === 'files' && <Files leadId={lead.id} onChanged={detail.reload} />}
          </section>

          <p className="v2-back-row">
            <Link to="/v2/leads">← Back to leads</Link>
          </p>
        </div>

        {/* ── RIGHT: what they asked for ───────────────────────────────── */}
        <div className="d-rcol">
          <section className="d-card" aria-label={`What ${first} wants`}>
            <div className="d-card-head v2-leadpage-wants-head">
              <h3>What {first} wants</h3>
              <span className="d-small d-muted">click a line to edit</span>
            </div>
            {/*
              * All seven lines, and every one of them editable in place —
              * `design/web/lead.html`'s own `[data-edit]` rows. Three of them
              * (Purpose, Timeline, Payment) were never sent to the screen,
              * and none of the seven could be changed, so a budget somebody
              * misheard could only be corrected by writing a note about it.
              *
              * The three with a fixed vocabulary are a menu rather than a
              * text box: they are ENUM columns, and MySQL refuses a word that
              * is not in the list rather than storing an approximation.
              */}
            <dl className="d-kv">
              <EditRow
                leadId={lead.id}
                field="project"
                label="Project"
                value={lead.project_name}
                onSaved={afterEdit}
              />
              <EditRow
                leadId={lead.id}
                field="unit"
                label="Unit"
                value={lead.unit_type}
                onSaved={afterEdit}
              />
              <EditRow
                leadId={lead.id}
                field="budget"
                label="Budget"
                value={budget}
                editAs={lead.budget_band ?? budget}
                onSaved={afterEdit}
              />
              <EditRow
                leadId={lead.id}
                field="purpose"
                label="Purpose"
                value={choiceLabel('purpose', lead.purpose)}
                choices={choices.data?.purpose}
                stored={lead.purpose}
                onSaved={afterEdit}
              />
              <EditRow
                leadId={lead.id}
                field="timeline"
                label="Timeline"
                value={choiceLabel('timeline', lead.timeline)}
                choices={choices.data?.timeline}
                stored={lead.timeline}
                onSaved={afterEdit}
              />
              <EditRow
                leadId={lead.id}
                field="payment"
                label="Payment"
                value={choiceLabel('payment', lead.payment_method)}
                choices={choices.data?.payment}
                stored={lead.payment_method}
                onSaved={afterEdit}
              />
              <EditRow
                leadId={lead.id}
                field="language"
                label="Language"
                value={languageName(lead.language)}
                editAs={lead.language}
                onSaved={afterEdit}
              />
            </dl>
            <dl className="d-kv d-mt-12 v2-leadpage-wants-foot">
              <Row label="Where" value={lead.preferred_location} />
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
            {/*
              * §5.6: the date, the time and the kind of each plan. The day
              * and the clock are Dubai's — this card printed the reader's
              * own clock beside a Dubai day — and the kind is a word rather
              * than the stored key.
              */}
            {tasks.length === 0
              ? <p className="d-small d-muted">Nothing planned yet.</p>
              : tasks.map((one) => {
                const when = one.due_at ? dubaiParts(new Date(one.due_at)) : null;
                return (
                  <div className="d-up" key={one.id}>
                    <span className="d-d">
                      {when ? when.day : '—'}
                      <b>{when ? when.clock : ''}</b>
                    </span>
                    <div className="d-grow">
                      <b className="d-bold">{one.title ?? 'Task'}</b>
                      <div className="d-small d-muted">{planKind(one.type)}</div>
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

/* ── After a WhatsApp tap: what happened? ──────────────────────────────── */

/** The six answers `/api/v2/taps/:id` takes, in words a person reads. */
const TAP_ANSWERS: Array<{ value: string; label: string }> = [
  { value: 'sent', label: 'I sent it' },
  { value: 'replied', label: 'They replied' },
  { value: 'no_reply', label: 'No reply yet' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'changed_mind', label: 'I did not send it' },
  { value: 'not_sent', label: 'It would not send' },
];

/**
 * "WhatsApp opened · waiting for your update" — §5.3a and §5.10.
 *
 * The design draws it as a blue line across the top of the middle column
 * with one button on the right. Pressing the button opens the six answers;
 * choosing one writes the outcome and the line goes away.
 *
 * It can be dismissed, because an agent who got distracted and came back an
 * hour later should not have to answer a question about a tap they no longer
 * remember. Dismissing records nothing, which is the honest outcome — the tap
 * itself is already saved and simply has no result on it.
 */
function WhatsappAsked({ tapId, app, onAnswered, onClose }: {
  tapId: string;
  app: 'whatsapp' | 'telegram';
  onAnswered: (said: string) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const name = app === 'telegram' ? 'Telegram' : 'WhatsApp';

  async function answer(value: string, label: string) {
    setBusy(true);
    setProblem(null);
    try {
      await api.patch(`/api/v2/taps/${tapId}`, { result: value });
      onAnswered(`${name}: ${label.toLowerCase()}.`);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
      setBusy(false);
    }
  }

  return (
    <div className="d-banner d-blue">
      <Icon name="message-circle" />
      {/*
        * The six answers go *under* the sentence, not beside it.
        * `.d-banner` is one flex row that does not wrap, and six buttons in
        * it squeezed "waiting for your update" into a four-word column and
        * pushed the last two outside the blue. Inside the growing span they
        * take the width they need and the sentence keeps its line.
        */}
      <span className="d-grow">
        <b>{name} opened</b> · waiting for your update
        {problem !== null && <> · {problem}</>}
        {open && (
          <span className="d-row d-gap-6 d-wrap d-mt-8">
            {TAP_ANSWERS.map((one) => (
              <button
                key={one.value}
                type="button"
                className="d-btn d-xs"
                disabled={busy}
                onClick={() => { void answer(one.value, one.label); }}
              >
                {one.label}
              </button>
            ))}
          </span>
        )}
      </span>
      {!open && (
        <button type="button" className="d-btn d-xs d-dark" onClick={() => setOpen(true)}>
          What happened?
        </button>
      )}
      <button type="button" className="d-btn d-xs d-ghost" onClick={onClose} aria-label="Hide">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

/* ── The note box that is always there ─────────────────────────────────── */

/** The note types the design's composer offers, in its own order. */
const NOTE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'general', label: 'Note' },
  { value: 'call', label: 'Call' },
  { value: 'viewing', label: 'Viewing' },
  { value: 'budget', label: 'Budget' },
  { value: 'objection', label: 'Objection' },
  { value: 'next_step', label: 'Next step' },
];

/**
 * "Write a note about Marco…" — §5.3d, the design's `composer`.
 *
 * Closed it is one line and a mic. Typing opens the type chips and the Save
 * button, which is what `.d-composer.d-open` is in the ported stylesheet: the
 * design wrote this behaviour and we are using its classes rather than
 * inventing a second note box.
 *
 * The mic is not wired here. Recording lives in the Notes tab below, where
 * the recorder and its permission prompt already are, and a second recorder
 * on one page is two things to keep in step. Pressing it opens that tab.
 */
function NoteBox({ contactId, opportunityId, who, onSaved }: {
  contactId: string;
  opportunityId: string;
  who: string;
  onSaved: (said: string) => void;
}) {
  const [body, setBody] = useState('');
  const [type, setType] = useState('general');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const open = body.trim() !== '';

  async function save() {
    const text = body.trim();
    if (text === '' || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/api/notes/${contactId}`, { body: text, type, opportunityId });
      setBody('');
      setType('general');
      onSaved('Note saved.');
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That note did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={open ? 'd-card d-composer d-open' : 'd-card d-composer'} aria-label="Add note">
      <div className="d-row d-gap-8">
        <textarea
          className="d-textarea d-grow"
          placeholder={`Write a note about ${who}…`}
          aria-label={`Write a note about ${who}`}
          value={body}
          disabled={busy}
          onChange={(e) => setBody(e.target.value)}
        />
        <a className="d-btn d-icon" href="?tab=notes" title="Record a voice note" aria-label="Record a voice note">
          <Icon name="mic" />
        </a>
      </div>
      <div className="d-more">
        <div className="d-chips">
          {NOTE_TYPES.map((one) => (
            <button
              key={one.value}
              type="button"
              className={type === one.value ? 'd-chip-opt d-on' : 'd-chip-opt'}
              onClick={() => setType(one.value)}
            >
              {one.label}
            </button>
          ))}
        </div>
        <div className="d-row d-gap-8">
          {problem !== null && <span className="d-small d-t-amber d-grow">{problem}</span>}
          {problem === null && <span className="d-grow" />}
          <button
            type="button"
            className="d-btn d-sm d-ghost"
            disabled={busy}
            onClick={() => { setBody(''); setProblem(null); }}
          >
            Cancel
          </button>
          <button type="button" className="d-btn d-sm d-dark" disabled={busy} onClick={() => { void save(); }}>
            {busy ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    </section>
  );
}

/* ── What the client wants, one editable line ──────────────────────────── */

/**
 * A line that reads as text and behaves as a button.
 *
 * Inline rather than a class: there is no design class for it — the design's
 * own editable line is a `<dd>` with a click handler on the row, which a
 * keyboard cannot reach — and `v2-shell.css` belongs to another pair of hands
 * this week.
 */
const PLAIN_LINE = {
  font: 'inherit',
  color: 'inherit',
  background: 'none',
  border: 0,
  padding: 0,
  margin: 0,
  width: '100%',
  textAlign: 'left',
  cursor: 'text',
} as const;

interface Choice { value: string; label: string }
type Choices = Record<'purpose' | 'timeline' | 'payment', Choice[]>;

/**
 * One line of "What the client wants", editable where it stands.
 *
 * Click it, type, press Enter. Escape puts it back. The design's own classes
 * do the work — `[data-edit]` draws the hover "Edit" and `.d-editing` draws
 * "Enter to save" — so this is markup rather than a widget.
 *
 * A line with a fixed vocabulary becomes a menu instead of a box, because the
 * column behind it is an ENUM: a free-text purpose is not stored "nearly", it
 * is refused outright, and the agent is told the CRM broke.
 */
function EditRow({ leadId, field, label, value, editAs, choices, stored, onSaved }: {
  leadId: string;
  field: 'project' | 'unit' | 'budget' | 'purpose' | 'timeline' | 'payment' | 'language';
  label: string;
  value: string | null | undefined;
  /** What goes in the box when it is not what is shown — the budget's own words. */
  editAs?: string | null;
  choices?: Choice[];
  stored?: string | null;
  onSaved: (said: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  /*
   * Enter saves, and so does clicking away. One of those can follow the other
   * while the first request is still in the air, so the line is settled once —
   * the same `fin` flag the design's own chip editor uses.
   */
  const settled = useRef(false);

  useEffect(() => {
    if (editing) box.current?.focus();
  }, [editing]);

  function start() {
    if (busy) return;
    settled.current = false;
    setDraft((editAs ?? value ?? '').toString());
    setEditing(true);
  }

  async function save(next: string | null) {
    if (settled.current) return;
    settled.current = true;
    setBusy(true);
    try {
      const result = await api.patch<{ said: string; changed: string[] }>(
        `/api/my-leads/${leadId}/wants`,
        { [field]: next },
      );
      setEditing(false);
      if (result.changed.length > 0) onSaved(result.said);
    } catch (problem) {
      onSaved(problem instanceof Error ? problem.message : 'That did not save.');
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  const shown = value && String(value).trim() !== '' ? value : 'Not said yet';

  /* A menu line. Changing the selection is the save: there is nothing to
     type, so waiting for an Enter would be waiting for nothing. */
  if (choices) {
    return (
      <div className={editing ? 'd-kv-row d-editing' : 'd-kv-row'} data-edit>
        <dt>{label}</dt>
        <dd>
          {editing
            ? (
              <select
                className="d-select d-sm"
                aria-label={label}
                autoFocus
                defaultValue={stored ?? 'unknown'}
                disabled={busy}
                onChange={(e) => { void save(e.target.value); }}
                onBlur={() => setEditing(false)}
              >
                {choices.map((one) => (
                  <option key={one.value} value={one.value}>{one.label}</option>
                ))}
              </select>
            )
            : (
              <button type="button" style={PLAIN_LINE} onClick={start}>
                {shown}
              </button>
            )}
        </dd>
      </div>
    );
  }

  return (
    <div className={editing ? 'd-kv-row d-editing' : 'd-kv-row'} data-edit>
      <dt>{label}</dt>
      <dd dir="auto">
        {editing
          ? (
            <input
              ref={box}
              value={draft}
              aria-label={label}
              disabled={busy}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void save(draft.trim() || null); }
                /* Escape puts the line back and saves nothing. */
                if (e.key === 'Escape') {
                  e.preventDefault();
                  settled.current = true;
                  setEditing(false);
                }
              }}
              onBlur={() => { void save(draft.trim() || null); }}
            />
          )
          : (
            <button type="button" style={PLAIN_LINE} onClick={start}>
              {shown}
            </button>
          )}
      </dd>
    </div>
  );
}

/* ── In short ──────────────────────────────────────────────────────────── */

interface Brief {
  notes: { lines: string[]; watchOut: string | null; at: string | null; stale: boolean };
  verdict: { value: string; why: string | null; source: 'ai' | 'rules'; at: string | null } | null;
  advice: { headline: string; note: string; why: string } | null;
}

/**
 * The card an agent reads before they dial.
 *
 * Two sources, and it never mixes them up. When the model has read the notes
 * it prints its three lines and wears the Homes AI chip. When it has not —
 * no notes yet, or AI switched off — it writes the same sentence the design
 * writes for every lead but its sample one, out of the record's own facts,
 * and wears no chip. A card that credits the AI for a sentence the AI did not
 * write is the one thing this page may not do.
 */
function InShort({ lead, brief, budget }: { lead: Lead; brief: Brief | null; budget: string | null }) {
  const lines = brief?.notes.lines ?? [];
  const what = [lead.project_name, lead.unit_type, budget].filter(Boolean).join(' · ');
  const spoke = lead.last_contact_at
    ? `Last spoken to ${moment(lead.last_contact_at).toLowerCase()}`
    : 'Not called yet';

  return (
    <section className="d-card d-short" aria-label="In short">
      <div className="d-card-head d-mb-8">
        <h3>In short</h3>
        {lines.length > 0 && (
          <span className="d-chip d-dark">
            <Icon name="sparkles" size={13} />Homes AI
          </span>
        )}
      </div>
      {lines.length > 0
        ? (
          <>
            {lines.map((line) => <p key={line}>{line}</p>)}
            {brief?.notes.watchOut && (
              <p className="d-t-amber">{brief.notes.watchOut}</p>
            )}
          </>
        )
        : (
          <p>
            <b>{what || 'Nothing said about what they want yet'}</b>.
            {' '}Stage {STAGE_LABEL[lead.stage_key] ?? lead.stage_key}. {spoke}.
            {lead.language ? ` Speaks ${languageName(lead.language)}.` : ''}
            {lead.stage_key === 'new_lead'
              ? ' Homes AI writes more after the first call.'
              : ''}
          </p>
        )}
      {brief?.advice && (
        <p className="d-small d-muted">
          Next: {brief.advice.headline.toLowerCase()} — {brief.advice.why}
        </p>
      )}
    </section>
  );
}

/* ── The change history, on the Info tab ───────────────────────────────── */

/**
 * "Rocky changed Budget · 1.5M → 2M".
 *
 * `audit_log` has held every one of these rows since the first week. There
 * was simply no endpoint that served a single record's history, so the tab
 * could not draw it.
 */
function History({ leadId }: { leadId: string }) {
  const rows = useAsync<{ items: HistoryRow[] }>(
    () => api.get(`/api/my-leads/${leadId}/history`),
    [leadId],
  );

  return (
    <>
      <h4 className="d-mt-24 d-mb-8">Change history</h4>
      {rows.error && <p className="d-small d-muted">{rows.error}</p>}
      {!rows.data && !rows.error && <p className="d-small d-muted">Reading the log…</p>}
      {rows.data && rows.data.items.length === 0 && (
        <p className="d-small d-muted">Nothing has been changed on this lead yet.</p>
      )}
      {rows.data && rows.data.items.length > 0 && (
        <div className="d-divide d-small">
          {rows.data.items.map((one) => (
            /* The design writes this row's padding inline too. */
            <div className="d-row" style={{ padding: '8px 0' }} key={one.id}>
              <span className="d-grow">
                {one.what}
                {one.detail ? <> · <b className="d-bold">{one.detail}</b></> : null}
              </span>
              <span className="d-muted">{moment(one.at)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

interface HistoryRow {
  id: string;
  what: string;
  detail: string | null;
  who: string | null;
  at: string;
}

/* ── Files ─────────────────────────────────────────────────────────────── */

interface LeadFile {
  id: string;
  note_id: string;
  kind: 'file' | 'voice';
  filename: string;
  content_type: string;
  byte_size: number;
  folder: string;
  view_count: number;
  created_at: string;
  added_by: string | null;
  private: boolean;
}

interface FolderCount { key: string; label: string; count: number }

/** The folder icons, in the design's order. */
const FOLDER_ICON: Record<string, IconName> = {
  photo: 'camera',
  id: 'shield',
  booking: 'file-signature',
  whatsapp: 'message-circle',
  receipt: 'receipt',
  other: 'paperclip',
};

/**
 * The Files tab, with files in it.
 *
 * It used to hold a paragraph explaining that files live on a note. They do —
 * that is the right place for them, because a photo keeps the words that came
 * with it — but the design asks for one list with folders over it, three
 * buttons that add one, and two sentences about who can see a passport. None
 * of that existed, and nothing classified a file at all.
 */
function Files({ leadId, onChanged }: { leadId: string; onChanged: () => void }) {
  const listing = useAsync<{ items: LeadFile[]; folders: FolderCount[] }>(
    () => api.get(`/api/my-leads/${leadId}/files`),
    [leadId],
  );
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const into = useRef<string>('other');

  const items = listing.data?.items ?? [];
  const shown = folder ? items.filter((one) => one.folder === folder) : items;
  /* Only the folders with something in them, plus All — the design draws four
     and says the fifth appears "when you add the first one". */
  const folders = (listing.data?.folders ?? []).filter(
    (one) => one.count > 0 || one.key === 'id' || one.key === 'booking' || one.key === 'whatsapp',
  );

  function add(where: string) {
    into.current = where;
    setProblem(null);
    pick.current?.click();
  }

  async function upload(file: File) {
    setBusy(into.current);
    setProblem(null);
    try {
      const made = await api.post<{ noteId: string }>(
        `/api/my-leads/${leadId}/files/note`,
        { folder: into.current, filename: file.name },
      );
      await api.upload(`/api/notes/item/${made.noteId}/files`, file, { 'X-Folder': into.current });
      listing.reload();
      onChanged();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That file did not go up.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="d-folders">
        <button
          type="button"
          className={folder === '' ? 'd-folder d-on' : 'd-folder'}
          onClick={() => setFolder('')}
        >
          <Icon name="paperclip" size={15} />All files
          <span>{items.length} {items.length === 1 ? 'file' : 'files'}</span>
        </button>
        {folders.map((one) => (
          <button
            key={one.key}
            type="button"
            className={folder === one.key ? 'd-folder d-on' : 'd-folder'}
            onClick={() => setFolder(one.key)}
          >
            <Icon name={FOLDER_ICON[one.key] ?? 'paperclip'} size={15} />{one.label}
            <span>{one.count} {one.count === 1 ? 'file' : 'files'}</span>
          </button>
        ))}
      </div>

      {listing.error && <ErrorNote>{listing.error}</ErrorNote>}

      {shown.map((one) => (
        <div className="d-frow" key={one.id}>
          <span className="d-ic">
            <Icon name={one.kind === 'voice' ? 'mic' : FOLDER_ICON[one.folder] ?? 'paperclip'} size={16} />
          </span>
          <div className="d-grow">
            <b className="d-bold">{one.filename}</b>
            <div className="d-small d-muted">
              {[
                FOLDER_LABEL[one.folder] ?? 'Other files',
                `added ${moment(one.created_at).toLowerCase()}`,
                one.added_by ? `by ${one.added_by}` : null,
                one.view_count > 0
                  ? `viewed ${one.view_count} ${one.view_count === 1 ? 'time' : 'times'}`
                  : null,
              ].filter(Boolean).join(' · ')}
            </div>
          </div>
          {one.private && (
            <span className="d-chip">
              <Icon name="lock" size={12} />You and owners
            </span>
          )}
          <a
            className="d-btn d-xs"
            href={`/api/notes/files/${one.id}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => window.setTimeout(() => listing.reload(), 1500)}
          >
            Open
          </a>
        </div>
      ))}

      {shown.length === 0 && (
        <div className="d-empty">
          <span className="d-ic"><Icon name="paperclip" size={26} /></span>
          <b>{items.length === 0 ? 'No files yet' : 'No files in this folder'}</b>
          <p>Payment receipts also get their own folder when you add the first one.</p>
        </div>
      )}

      {problem && <ErrorNote>{problem}</ErrorNote>}

      <div className="d-btn-row d-mt-16">
        <button type="button" className="d-btn d-sm" disabled={busy !== null} onClick={() => add('photo')}>
          <Icon name="plus" />{busy === 'photo' ? 'Adding…' : 'Photo'}
        </button>
        <button type="button" className="d-btn d-sm" disabled={busy !== null} onClick={() => add('booking')}>
          <Icon name="plus" />{busy === 'booking' ? 'Adding…' : 'Booking form'}
        </button>
        <button type="button" className="d-btn d-sm" disabled={busy !== null} onClick={() => add('id')}>
          <Icon name="plus" />{busy === 'id' ? 'Adding…' : 'ID or passport'}
        </button>
        <button
          type="button"
          className="d-btn d-sm d-ghost"
          disabled={busy !== null}
          onClick={() => add('other')}
        >
          <Icon name="upload" />{busy === 'other' ? 'Adding…' : 'Scan / upload'}
        </button>
      </div>
      <p className="d-small d-muted d-mt-12">
        <Icon name="lock" size={13} /> IDs and passports: only you and owners see them.
        Every view is logged.
      </p>

      <input
        ref={pick}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

/** The folder names, in the design's words. Kept in step with the server's. */
const FOLDER_LABEL: Record<string, string> = {
  photo: 'Photos',
  id: 'Passport & ID',
  booking: 'Booking forms',
  whatsapp: 'WhatsApp screenshots',
  receipt: 'Payment receipts',
  other: 'Other files',
};

/** The deal line under "Deal done". Only figures the Won dialog recorded. */
function dealLine(lead: Lead): string {
  const money = (value: number | null) => (value === null
    ? null
    : `AED ${Number(value).toLocaleString('en-US')}`);
  return [
    money(lead.deal_value_aed),
    lead.won_paid_aed === null ? null : `paid now ${money(lead.won_paid_aed)}`,
    lead.won_signed ? lead.won_signed.replace(/_/g, ' ') : null,
  ].filter(Boolean).join(' · ') || 'Recorded without a figure.';
}

/** A blank that is really blank, rather than the string "null". */
function text(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const tidy = String(value).trim();
  return tidy === '' ? null : tidy;
}

/**
 * "en" is a code, not a language.
 *
 * The lead page printed the raw column. Only the languages this brokerage
 * actually works in are named; anything else is shown as it was stored rather
 * than guessed at.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ar: 'Arabic',
  ru: 'Russian',
  hi: 'Hindi',
  ur: 'Urdu',
  fa: 'Persian',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  es: 'Spanish',
  tr: 'Turkish',
  zh: 'Chinese',
  pt: 'Portuguese',
  sr: 'Serbian',
  uk: 'Ukrainian',
};

function languageName(code: string | null): string | null {
  const tidy = text(code);
  if (!tidy) return null;
  return LANGUAGE_NAMES[tidy.toLowerCase()] ?? tidy;
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

/**
 * A tag, as words — §5.2 and the rule at the top of Emir's list.
 *
 * `src:csv_import` is a namespace, a database word and an underscore;
 * "CSV import" is the same fact said out loud. The *value* of a `list:` tag
 * is a name somebody typed and is left exactly as they typed it.
 */
export function planKind(type: string | null | undefined): string {
  const known: Record<string, string> = {
    call: 'Call',
    whatsapp: 'WhatsApp',
    email: 'Email',
    meeting: 'Meeting',
    viewing: 'Viewing',
    follow_up: 'Follow-up',
    callback: 'Call back',
    task: 'Task',
    other: 'Task',
  };
  const key = (type ?? 'task').trim();
  return known[key] ?? sentence(key.replace(/_/g, ' '));
}

export function tagWords(tag: string): string {
  const colon = tag.indexOf(':');
  const value = colon === -1 ? tag : tag.slice(colon + 1);
  const known: Record<string, string> = {
    csv_import: 'CSV import',
    bulk_import: 'Bulk import',
    manual: 'Added by hand',
    walk_in: 'Walk-in',
    whatsapp_direct: 'WhatsApp',
    meta_ctwa: 'WhatsApp ad',
    meta_lead_ads: 'Facebook form',
    google_ads: 'Google ad',
    website: 'Website',
    referral: 'Referral',
    sla_breach: 'Missed the 5-minute rule',
    hot: 'Hot',
  };
  if (known[value]) return known[value] as string;
  /* A language tag is a code; `languageName` already owns that mapping. */
  if (tag.startsWith('lang:')) return languageName(value) ?? value;
  /* Anything else is somebody's own word. Underscores become spaces, and the
     first letter goes up; nothing else is touched, because a list called
     "leads_gesamtliste_12nov" is a name and not a code to be translated. */
  return sentence(value.replace(/_/g, ' '));
}

/** One line of the timeline, said in English and without the sheet's own text. */
export function plainly(
  one: { type: string; title?: string | null; body: string | null },
  agent: string | null,
): { title: string; body: string | null } {
  const raw = (one.title ?? '').trim();
  const lower = raw.toLowerCase();

  /*
   * An imported lead. Emir, §5.8: *"Timeline in simple English: 'Imported
   * from Excel on 12 Nov', 'Given to <agent> by import'. Text from the Excel
   * file goes to Info under 'From the file', not into the timeline."*
   *
   * The title the import writes carries the source key — "New lead from
   * csv_import" — and the body carries the spreadsheet's own columns, in
   * whatever language the sheet was written in. Both are replaced here;
   * neither is lost, because the columns are on the Info tab and the source
   * is on the right-hand card.
   */
  if (/csv_import|from import|bulk import|imported/i.test(`${raw} ${one.type}`)) {
    if (/assign|given|owner/i.test(lower)) {
      return { title: agent ? `Given to ${agent} by import` : 'Given out by import', body: null };
    }
    return { title: 'Imported from a spreadsheet', body: null };
  }

  return {
    title: sentence(raw || one.type.replace(/[._]/g, ' ')),
    body: one.body === null || one.body.trim() === '' ? null : one.body,
  };
}

function firstName(full: string | null): string {
  if (!full) return 'they';
  return full.trim().split(/\s+/)[0] ?? 'they';
}
