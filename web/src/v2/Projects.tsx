import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../design/ui.js';

/**
 * The project library, and one project.
 *
 * Built from `design/web/projects.html` and `design/web/project.html`. It was
 * built once from the written spec instead, which is why it is being built
 * again: the colours were right and the layout was invented.
 *
 * The rule from CLAUDE.md that governs both screens is negative: **nothing
 * here is a price, a handover date, a payment plan or a size that did not come
 * out of the `projects` and `units` tables.** A missing figure is left blank.
 * So where the design shows a figure the API does not hold — the pitch on a
 * list card, a per-project lead count, the desk new leads go to — the slot is
 * either filled with something real or left out. It is never guessed.
 */

interface Card {
  id: string;
  slug: string | null;
  name: string;
  developer: string | null;
  emirate: string | null;
  community: string | null;
  property_type: string | null;
  sale_status: 'selling_now' | 'coming_soon' | 'sold_out' | null;
  starting_price_aed: number | null;
  handover_date: string | null;
  payment_plan: string | null;
  image_url: string | null;
  cover_photo_id: string | null;
  visibility: 'private' | 'team' | 'public' | null;
  verified_at: string | null;
  starred: number;
  units_available: number;
  units_total: number;
}

/** A pinned post on the Team wall, which is where the owner's note comes from. */
interface WallPost {
  id: string;
  author_name: string | null;
  author_photo_url: string | null;
  body: string | null;
  pinned_at: string | null;
  created_at: string;
}

const STATUS: Record<string, { label: string; chip: string }> = {
  selling_now: { label: 'Selling now', chip: '' },
  coming_soon: { label: 'Launching soon', chip: 'd-soon' },
  sold_out: { label: 'Sold out', chip: 'd-hid' },
};

/**
 * The filter strip.
 *
 * These six are the ones CLAUDE.md names, rendered as the design's segmented
 * control. The design file's own fourth segment is "Hidden", which has no
 * column behind it — `projects.visibility` says who may see a project, not
 * whether it is withheld from agents — so it is not offered.
 *
 * The emirate values are the enum the column actually stores. They read
 * `Dubai` and `Abu Dhabi` before this rebuild, which matched nothing on the
 * real server and only worked in the preview because the mock was wrong too.
 */
const FILTERS = [
  { key: '', label: 'All' },
  { key: 'emirate=dubai', label: 'Dubai' },
  { key: 'emirate=abu_dhabi', label: 'Abu Dhabi' },
  { key: 'status=selling_now', label: 'Selling now' },
  { key: 'status=coming_soon', label: 'Launching soon' },
  { key: 'starred=1', label: 'Our picks' },
];

export function V2Projects() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [find, setFind] = useState('');

  const qs = useMemo(() => {
    const next = new URLSearchParams(filter);
    if (find.trim()) next.set('search', find.trim());
    return next.toString();
  }, [filter, find]);

  const list = useAsync<{ items: Card[] }>(() => api.get(`/api/library?${qs}`), [qs]);
  const wall = useAsync<{ items: WallPost[] }>(() => api.get('/api/wall'), []);

  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const items = list.data?.items ?? [];
  /* The design's banner is a note from the owner. The wall already holds one
     — pinned, so it stays on top — rather than this screen keeping a second
     copy of the same sentence that could disagree with it. */
  const note = wall.data?.items.find((one) => one.pinned_at && one.body?.trim());

  return (
    <div className="v2-projects p-projects">
      {note && (
        <div className="d-owner-msg">
          <Avatar
            name={note.author_name ?? 'homes.me'}
            src={note.author_photo_url ?? undefined}
            size={44}
          />
          <p>
            <span className="d-who">
              From {note.author_name ?? 'homes.me'} · {dayAndTime(note.created_at)}
            </span>
            {firstLine(note.body)}
          </p>
          <Link className="d-btn d-on-dark" to="/v2/wall">
            Read on the team wall <Icon name="arrow-right" />
          </Link>
        </div>
      )}

      <div className="d-filters">
        <div className="d-seg" role="tablist">
          {FILTERS.map((one) => (
            <button
              key={one.label}
              type="button"
              role="tab"
              aria-selected={filter === one.key}
              className={filter === one.key ? 'd-on' : undefined}
              onClick={() => setFilter(one.key)}
            >
              {one.label}
            </button>
          ))}
        </div>

        <div className="d-input-icon">
          <Icon name="search" />
          <input
            className="d-input d-sm"
            type="search"
            value={find}
            aria-label="Search project, developer or area"
            placeholder="Search project, developer or area"
            onChange={(e) => setFind(e.target.value)}
          />
        </div>

        <span className="d-grow" />

        {list.data && (
          <span className="d-result-count">
            {items.length} project{items.length === 1 ? '' : 's'}
          </span>
        )}

        {canManage && (
          <Link className="d-btn d-sm" to="/projects">
            <Icon name="pencil" />Manage projects
          </Link>
        )}
      </div>

      {list.error && <ErrorNote>{list.error}</ErrorNote>}
      {!list.data && !list.error && <Spinner />}

      {items.length > 0 && (
        <div className="d-pgrid">
          {items.map((one) => (
            <ProjectCard key={one.id} card={one} onOpen={() => navigate(`/v2/projects/${one.id}`)} />
          ))}
        </div>
      )}

      {list.data && items.length === 0 && (
        <div className="d-card">
          <div className="d-empty">
            <span className="d-ic"><Icon name="building" /></span>
            <b>No project found</b>
            <p>
              {find.trim() || filter
                ? 'Try another word, or show all projects.'
                : 'Nothing in the library yet. The owner adds projects on the Manage projects screen.'}
            </p>
            {(find.trim() || filter) && (
              <button
                type="button"
                className="d-btn d-sm"
                onClick={() => { setFind(''); setFilter(''); }}
              >
                Show all
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One card in the grid.
 *
 * The whole card opens the project, as the design has it, and the name and the
 * two buttons inside it are real links — so it works from the keyboard as well
 * as under a thumb. A card that is only a click handler is unreachable without
 * a mouse.
 */
function ProjectCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const status = card.sale_status ? STATUS[card.sale_status] : null;
  const photo = coverUrl(card);
  const left = card.units_total > 0
    ? Math.round((card.units_available / card.units_total) * 100)
    : 0;

  return (
    <article
      className={card.sale_status === 'sold_out' ? 'd-pcard d-hidden-p' : 'd-pcard'}
      onClick={onOpen}
    >
      <div
        className={`d-photo ${gradient(card.id)}`}
        style={photo ? { backgroundImage: `url(${photo})`, backgroundSize: 'cover' } : undefined}
      >
        {status && <span className={`d-st-chip ${status.chip}`}>{status.label}</span>}
        <span className="d-from">
          {card.starting_price_aed ? 'Starting from' : ''}
          <b>{card.starting_price_aed ? roughMoney(card.starting_price_aed) : 'Price not set'}</b>
        </span>
      </div>

      <div className="d-pbody">
        <h2>
          <Link to={`/v2/projects/${card.id}`}>{card.name}</Link>
          {card.starred === 1 && <span className="d-chip d-orange">Our pick</span>}
          {card.visibility === 'private' && <span className="d-chip">Private</span>}
        </h2>
        <div className="d-dev">
          {[card.developer, card.community, emirateWord(card.emirate)].filter(Boolean).join(' · ')}
        </div>

        <div className="d-pfacts">
          <div>
            <b>{card.payment_plan ?? '—'}</b>
            <span>Payment plan</span>
          </div>
          <div>
            <b>{handover(card.handover_date)}</b>
            <span>Handover</span>
          </div>
        </div>

        {/*
          The design puts this project's lead counts here. Nothing counts
          opportunities by project id — `opportunities.project_name` is free
          text — so the slot carries what the library does hold and an agent
          does need: how much is still for sale.
        */}
        <div className="d-pleads">
          <div className="d-line">
            {card.units_total > 0 ? (
              <>
                <span>Available <b>{card.units_available}</b></span>
                <span>· of {card.units_total} units</span>
              </>
            ) : (
              <span>No unit list yet</span>
            )}
          </div>
          {card.units_total > 0 && (
            <div className="d-bar d-thin d-accent" style={{ '--v': `${left}%` } as never}><i /></div>
          )}
          <div className="d-to">{priceChecked(card.verified_at)}</div>

          <div className="d-pfoot">
            <span className="d-grow" />
            <Link className="d-btn d-sm" to={`/v2/projects/${card.id}#send`}>
              <Icon name="message-circle" />Send to a client
            </Link>
            <Link className="d-btn d-sm d-dark" to={`/v2/projects/${card.id}`}>Open</Link>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ── one project ───────────────────────────────────────────────────────── */

interface Unit {
  id: string;
  unit_no: string;
  unit_type: string | null;
  bedrooms: number | null;
  price_aed: number | null;
  status: string;
}

interface Plan {
  id: string;
  name: string;
  is_default: number;
  rows: Array<{ id: string; seq: number; milestone: string; percent: string | null; due_note: string | null }>;
}

interface ProjectDetail {
  project: Record<string, unknown>;
  units: Unit[];
  plans: Plan[];
  location: { lat: string | null; lng: string | null; address: string | null } | null;
}

interface LeadRow {
  id: string;
  contact_id: string;
  full_name: string | null;
  phone_e164: string | null;
  stage_key: string;
  unit_type: string | null;
  next_step_note: string | null;
  next_step_at: string | null;
  is_vip: number;
  owner_name: string | null;
}

/** The six stages as the design words them on a pill. */
const STAGE_WORD: Record<string, string> = {
  new_lead: 'New',
  attempted_contact: 'Called',
  engaged_qualified: 'Interested',
  appointment_scheduled: 'Meeting',
  deal_sent: 'Offer',
  won: 'Won',
  lost: 'Lost',
};

const STAGE_CLASS: Record<string, string> = {
  new_lead: 'new', attempted_contact: 'called', engaged_qualified: 'interested',
  appointment_scheduled: 'meeting', deal_sent: 'offer', won: 'won', lost: 'lost',
};

export function V2Project() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const got = useAsync<ProjectDetail>(() => api.get(`/api/library/${id}`), [id]);

  const project = got.data?.project;
  const name = typeof project?.name === 'string' ? project.name : '';

  /*
   * The leads on this project, scoped by the server to what this person may
   * see — an agent gets their own, a manager their team's. The filter is the
   * project's name because that is the column a lead carries.
   */
  const leads = useAsync<{ items: LeadRow[]; total: number }>(
    () => (name
      ? api.get(`/api/my-leads?tab=all&pageSize=10&project=${encodeURIComponent(name)}`)
      : Promise.resolve({ items: [], total: 0 })),
    [name],
  );

  if (got.error) return <ErrorNote>{got.error}</ErrorNote>;
  if (!got.data || !project) return <Spinner />;

  const status = str(project.sale_status);
  const chip = status ? STATUS[status] : null;
  const photo = coverUrl({
    cover_photo_id: str(project.cover_photo_id),
    image_url: str(project.image_url),
  });
  const price = num(project.starting_price_aed);
  const unitTypes = [...new Set(got.data.units.map((one) => one.unit_type).filter(Boolean))];
  const plan = got.data.plans.find((one) => one.is_default === 1) ?? got.data.plans[0];
  const seesTeam = user?.role !== 'agent';

  return (
    <div className="v2-project p-project">
      {/* The design puts these in the top bar through `data-topbar`, which
          this shell does not have; a strip above the layout is the same
          controls in the same order. */}
      <div className="v2-proj-top">
        <Link className="d-btn d-sm" to="/v2/projects"><Icon name="arrow-left" />Projects</Link>
        <span className="d-grow" />
        {(user?.role === 'owner' || user?.role === 'admin') && (
          <Link className="d-btn d-sm" to={`/projects/${id}`}>
            <Icon name="pencil" />Edit project
          </Link>
        )}
      </div>

      <div className="d-lay">
        <div className="d-left">
          <section className="d-card d-p-hero">
            <div
              className={`d-photo ${gradient(id)}`}
              style={photo ? { backgroundImage: `url(${photo})`, backgroundSize: 'cover' } : undefined}
            >
              {chip && <span className={`d-st-chip ${chip.chip}`}>{chip.label}</span>}
              <div className="d-name">
                <b>{name}</b>
                <span>
                  {[str(project.developer_name) ?? str(project.developer), str(project.community),
                    emirateWord(str(project.emirate))].filter(Boolean).join(' · ')}
                </span>
              </div>
            </div>

            <div className="d-facts">
              <div>
                <span>Starting from</span>
                <b>{price === null ? '—' : roughMoney(price)}</b>
              </div>
              <div>
                <span>Payment plan</span>
                <b className="d-sm">{str(project.payment_plan) ?? plan?.name ?? '—'}</b>
              </div>
              <div>
                <span>Handover</span>
                <b className="d-sm">{handover(str(project.handover_date))}</b>
              </div>
              <div>
                <span>Unit types</span>
                <b className="d-sm">{unitTypes.length > 0 ? unitTypes.join(' · ') : '—'}</b>
              </div>
            </div>
          </section>

          <div className="d-bento">
            <section className="d-card d-c-8">
              <div className="d-card-head">
                <h3>How to pitch it</h3>
              </div>
              {str(project.description)
                ? (
                  <div className="d-pitch">
                    {lines(str(project.description) ?? '').map((line, i) => (
                      <p key={i}><span>{line}</span></p>
                    ))}
                  </div>
                )
                : (
                  <p className="d-muted d-small">
                    Nobody has written the pitch yet. Whoever added the project can add it on
                    the Manage projects screen, and it will show here for everyone.
                  </p>
                )}
            </section>

            <section className="d-card d-c-4 d-mine">
              <span className="d-label">{seesTeam ? 'Team leads here' : 'Your leads here'}</span>
              <div className="d-stat-row d-mt-4">
                <Link className="d-num-hero" to={`/v2/leads?project=${encodeURIComponent(name)}`}>
                  {leads.data ? leads.data.total : '—'}
                </Link>
              </div>
              <div className="d-card-foot">
                {leads.data?.total
                  ? `Asked about ${name}`
                  : 'Nobody has asked about this one yet'}
              </div>
              {num(project.construction_pct) !== null && (
                <div className="d-small d-muted d-mt-8">
                  Built {num(project.construction_pct)}% so far
                </div>
              )}
            </section>
          </div>

          <div>
            <div className="v2-sec-title">
              <h2>{seesTeam ? 'Leads in this project' : 'Your leads in this project'}</h2>
              <Link className="d-card-link" to={`/v2/leads?project=${encodeURIComponent(name)}`}>
                See all {leads.data?.total ?? 0} <Icon name="arrow-right" />
              </Link>
            </div>

            {leads.data && leads.data.items.length > 0 && (
              <div className="d-table-wrap">
                <table className="d-table d-id-leads">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Stage</th>
                      <th>Next step</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {leads.data.items.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <Link className="d-t-main" to={`/v2/leads/${row.id}`}>
                            {row.full_name ?? 'No name'}
                          </Link>
                          {row.is_vip === 1 && <span className="d-vip-tag">VIP</span>}
                          <div className="d-t-sub">{row.unit_type ?? '—'}</div>
                        </td>
                        <td className="d-t-mono">{row.phone_e164 ?? '—'}</td>
                        <td>
                          <span className={`d-chip d-stage-${STAGE_CLASS[row.stage_key] ?? 'new'}`}>
                            {STAGE_WORD[row.stage_key] ?? row.stage_key}
                          </span>
                        </td>
                        <td className={late(row.next_step_at) ? 'd-overdue' : undefined}>
                          {row.next_step_note ?? 'No next step'}
                        </td>
                        <td>
                          <div className="d-row-actions d-show">
                            {row.phone_e164 && (
                              <a className="d-btn d-xs" href={`tel:${row.phone_e164}`}>
                                <Icon name="phone" />Call
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {leads.data && leads.data.items.length === 0 && (
              <div className="d-card">
                <div className="d-empty">
                  <span className="d-ic"><Icon name="users" /></span>
                  <b>No leads on this project yet</b>
                  <p>When one comes in asking about {name}, it shows up here.</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <SendCard
          project={project}
          plan={plan}
          location={got.data.location}
          leads={leads.data?.items ?? []}
          me={user?.name ?? ''}
        />
      </div>
    </div>
  );
}

/**
 * Send something to a client.
 *
 * Three steps, as the design has it, and the last one is deliberately not a
 * send: the CRM opens WhatsApp with the message written and the agent presses
 * send. Nothing automated puts a price in front of a client — see the offers
 * screen, which works the same way for the same reason.
 *
 * Only the things this project actually holds are offered. A project with no
 * brochure does not get a brochure button that opens nothing.
 */
function SendCard({
  project, plan, location, leads, me,
}: {
  project: Record<string, unknown>;
  plan: Plan | undefined;
  location: ProjectDetail['location'];
  leads: LeadRow[];
  me: string;
}) {
  const toast = useToast();
  const brochure = str(project.brochure_url);
  const map = location?.lat && location.lng
    ? `https://maps.google.com/?q=${location.lat},${location.lng}`
    : null;

  const choices = [
    brochure ? { key: 'brochure', label: 'Brochure', note: 'PDF', icon: 'file-text' as const } : null,
    plan || str(project.payment_plan)
      ? {
        key: 'payment plan',
        label: 'Payment plan',
        note: str(project.payment_plan) ?? plan?.name ?? '',
        icon: 'bar-chart-3' as const,
      }
      : null,
    map ? { key: 'location', label: 'Location', note: 'Map link', icon: 'map-pin' as const } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; note: string; icon: 'file-text' | 'bar-chart-3' | 'map-pin' }>;

  const [what, setWhat] = useState(choices[0]?.key ?? '');
  const [who, setWho] = useState('');
  const [missing, setMissing] = useState(false);

  const lead = leads.find((one) => one.id === who);
  const name = str(project.name) ?? 'the project';
  const link = what === 'location' ? map : what === 'brochure' ? brochure : null;

  const message = lead
    ? [
      `Hi ${(lead.full_name ?? '').split(' ')[0] || 'there'}, here is the ${what} for ${name}:`,
      link ?? '',
      `Tell me what you think. ${me.split(' ')[0]}`,
    ].filter(Boolean).join('\n')
    : null;

  function open(app: 'whatsapp' | 'telegram') {
    if (!lead) { setMissing(true); return; }
    setMissing(false);
    /* Recorded as a tap, not a message: the CRM hands over to the real app
       and cannot know what happened there. */
    void api.post('/api/v2/taps', { opportunityId: lead.id, app, text: message }).catch(() => {});
    const text = encodeURIComponent(message ?? '');
    const digits = (lead.phone_e164 ?? '').replace(/[^\d]/g, '');
    const url = app === 'whatsapp'
      ? `https://wa.me/${digits}?text=${text}`
      : `https://t.me/share/url?url=${encodeURIComponent(link ?? '')}&text=${text}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    toast(`${app === 'whatsapp' ? 'WhatsApp' : 'Telegram'} opened. You press send.`);
  }

  return (
    <section className="d-card d-send" id="send">
      <div className="d-card-head d-mb-0">
        <h3>Send to a client</h3>
        <span className="d-chip">3 steps</span>
      </div>

      <div className="d-step-h"><i>1</i>What do you send?</div>
      {choices.length > 0 ? (
        <div className="d-what">
          {choices.map((one) => (
            <button
              key={one.key}
              type="button"
              className={what === one.key ? 'd-opt d-on' : 'd-opt'}
              onClick={() => setWhat(one.key)}
            >
              <Icon name={one.icon} />
              <span className="d-grow">
                <b className="d-bold">{one.label}</b>
                <div className="d-small d-muted">{one.note}</div>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="d-small d-muted">
          This project has no brochure, plan or map saved yet, so there is nothing to send.
        </p>
      )}

      <div className="d-step-h"><i>2</i>To which lead?</div>
      <div className={missing ? 'd-field d-invalid' : 'd-field'}>
        <select
          className="d-select"
          value={who}
          aria-label="Choose a lead"
          onChange={(e) => { setWho(e.target.value); setMissing(false); }}
        >
          <option value="">Choose a lead…</option>
          {leads.map((one) => (
            <option key={one.id} value={one.id}>{one.full_name ?? one.phone_e164 ?? 'No name'}</option>
          ))}
        </select>
        {missing && <span className="d-error">Choose a lead first.</span>}
      </div>

      <div className="d-step-h"><i>3</i>Open the chat. You press send.</div>
      <div className="d-msg-box">
        {lead ? (
          <>
            Hi {(lead.full_name ?? '').split(' ')[0] || 'there'}, here is the {what} for {name}:
            <br />
            {link
              ? <a href={link} target="_blank" rel="noreferrer">{link}</a>
              : <span className="d-muted">no link saved for this one</span>}
            <br />
            Tell me what you think. {me.split(' ')[0]}
          </>
        ) : 'Choose a lead to see the message.'}
      </div>

      <div className="d-send-btns">
        <button
          type="button"
          className="d-btn d-primary d-lg"
          disabled={choices.length === 0}
          onClick={() => open('whatsapp')}
        >
          <Icon name="message-circle" />Open WhatsApp
        </button>
        <button
          type="button"
          className="d-btn"
          disabled={choices.length === 0}
          onClick={() => open('telegram')}
        >
          <Icon name="send" />Open Telegram
        </button>
        <button
          type="button"
          className="d-btn"
          disabled={!link}
          onClick={() => {
            void navigator.clipboard?.writeText(link ?? '');
            toast('Link copied');
          }}
        >
          <Icon name="copy" />Copy the link
        </button>
      </div>
    </section>
  );
}

/* ── small things ──────────────────────────────────────────────────────── */

/**
 * The cover photo.
 *
 * A project may carry an uploaded photo (served by id) or a link somebody
 * pasted. Neither is required, and without one the card falls back to the
 * design's gradient rather than a broken image.
 */
function coverUrl(card: { cover_photo_id?: string | null; image_url?: string | null }): string | null {
  if (card.cover_photo_id) return `/api/library/photos/${card.cover_photo_id}`;
  return card.image_url ?? null;
}

/**
 * Which of the design's five gradients a project gets.
 *
 * Stable from the id, so a project keeps the same one every time it is drawn
 * and two cards side by side are not the same colour. It is a placeholder for
 * a photograph, not a fact about the project.
 */
function gradient(id: string): string {
  let sum = 0;
  for (const letter of id) sum += letter.charCodeAt(0);
  const pick = sum % 5;
  return pick === 0 ? '' : `d-p${pick + 1}`;
}

/** "AED 1.6M", "AED 940,000" — the way an agent says a starting price. */
function roughMoney(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `AED ${millions.toFixed(millions % 1 === 0 ? 0 : 1)}M`;
  }
  return `AED ${value.toLocaleString('en-GB')}`;
}

/**
 * The handover, however it was stored.
 *
 * The column is free text, because developers quote quarters: "Q4 2027" is
 * what a price list says and what an agent repeats. A real date is shown as
 * the month and year; anything else is passed through as written.
 */
function handover(value: string | null | undefined): string {
  if (!value) return '—';
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  return new Date(value).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function emirateWord(value: string | null | undefined): string | null {
  if (!value) return null;
  const named: Record<string, string> = {
    dubai: 'Dubai', abu_dhabi: 'Abu Dhabi', sharjah: 'Sharjah',
    ras_al_khaimah: 'Ras Al Khaimah', ajman: 'Ajman', fujairah: 'Fujairah',
    umm_al_quwain: 'Umm Al Quwain', other: 'Other',
  };
  return named[value] ?? value;
}

/**
 * When the prices were last checked.
 *
 * It belongs on the card because an agent quoting a six-week-old price list is
 * the way this CRM loses a client's trust, and because it is the one thing in
 * this slot that is a real column.
 */
function priceChecked(at: string | null): string {
  if (!at) return 'Prices not checked yet';
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  if (days <= 0) return 'Prices checked today';
  if (days === 1) return 'Prices checked yesterday';
  if (days < 30) return `Prices checked ${days} days ago`;
  return `Prices checked ${new Date(at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
}

/** The post's own lines, so a pinned note keeps its shape in the banner. */
function firstLine(body: string | null | undefined): string {
  return (body ?? '').split('\n')[0] ?? '';
}

function lines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 5);
}

/** Dubai is UTC+4 all year, so the day never needs a zone library. */
function dayAndTime(at: string): string {
  return new Date(new Date(at).getTime() + 4 * 3_600_000).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

function late(at: string | null): boolean {
  return at !== null && new Date(at).getTime() < Date.now();
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
