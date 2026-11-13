import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon, type IconName } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';

/**
 * From tap to reply.
 *
 * `design/web/messaging-report.html`. There is no WhatsApp API in v2: every
 * agent messages from their own number and the CRM only opens the app with a
 * message ready. So three things can honestly be counted — the tap, the
 * agent's own answer to "What happened?", and a client opening a tracked link
 * — and this screen counts those and says so at the bottom.
 *
 * Two figures the design shows are missing, both for the same reason.
 * `message_taps.result` records *that* the client replied, not what they said,
 * so "37 interested · 21 not now" cannot be split; and tracked links are not
 * yet broken down by kind, so "brochure is opened most" would be a guess. The
 * screen shows what the column actually holds instead.
 */

interface AgentRow {
  userId: string;
  name: string;
  taps: number;
  confirmed: number;
  replied: number;
  linksOpened: number;
  noUpdate: number;
}

interface OpenedLink {
  linkId: string;
  leadId: string | null;
  client: string | null;
  label: string | null;
  kind: string;
  opens: number;
  lastOpenedAt: string | null;
  agentName: string | null;
}

interface Report {
  period: Period;
  days: number;
  taps: { total: number; whatsapp: number; telegram: number; previous: number };
  confirmed: number;
  noUpdate: number;
  replied: number;
  answers: Record<string, number>;
  links: { made: number; opened: number; opens: number };
  agents: AgentRow[];
  opened: OpenedLink[];
}

type Period = 'today' | 'week' | 'month';

const PERIODS: Array<{ key: Period; label: string; against: string }> = [
  { key: 'today', label: 'Today', against: 'vs yesterday' },
  { key: 'week', label: 'Week', against: 'vs the week before' },
  { key: 'month', label: 'Month', against: 'vs the 30 days before' },
];

/**
 * The six answers, in the order the agent sees them when they are asked.
 *
 * `colour` is the band in the bar at the top of the card; `dot` is the one
 * beside the name. Grey for "sent and waiting" because waiting is neither
 * good nor bad news.
 */
const ANSWERS: Array<{ key: string; label: string; colour: string; dot?: string }> = [
  { key: 'sent', label: 'Sent, waiting for a reply', colour: 'd-grey' },
  { key: 'replied', label: 'The client replied', colour: 'd-green', dot: 'd-green' },
  { key: 'no_reply', label: 'No reply', colour: 'd-amber', dot: 'd-amber' },
  { key: 'changed_mind', label: 'Not interested', colour: 'd-red', dot: 'd-red' },
  { key: 'wrong_number', label: 'Wrong number', colour: 'd-ink' },
  { key: 'not_sent', label: 'Did not send it', colour: 'd-ink' },
];

const LINK_ICON: Record<string, IconName> = {
  brochure: 'file-text',
  payment_plan: 'file-spreadsheet',
  location: 'map-pin',
  video: 'play',
  project: 'building',
  offer: 'file-output',
  other: 'link',
};

export function V2Messaging() {
  /*
   * `OwnerMessaging.dc.html` titles this screen "WhatsApp & Telegram" and
   * subtitles it "Owner · today · no API needed" — and the subtitle is the
   * point of the screen, because these numbers exist *because* there is no
   * WhatsApp API. `Menu.dc.html` calls the tile the same thing. The shell's
   * header draws both; the page does not draw a title of its own.
   */
  usePhoneHead({
    title: 'WhatsApp & Telegram',
    sub: 'Owner · taps, replies and links opened · no API needed',
  });
  const { user } = useAuth();
  const canSee = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'manager';
  const [period, setPeriod] = useState<Period>('today');
  const [reminded, setReminded] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const agentsCard = useRef<HTMLElement>(null);
  const toast = useToast();

  const got = useAsync<Report>(() => api.get(`/api/v2/messaging?period=${period}`), [period]);

  async function remind(row: AgentRow) {
    setBusy(row.userId);
    try {
      const answer = await api.post<{ reminded: number }>('/api/v2/messaging/remind', { userId: row.userId });
      setReminded((was) => [...was, row.userId]);
      toast(
        `${firstName(row.name)} gets one reminder with ${answer.reminded} open `
        + `${answer.reminded === 1 ? 'question' : 'questions'}`,
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That reminder did not send.');
    } finally {
      setBusy(null);
    }
  }

  if (!canSee) {
    return <div className="p-messaging"><ErrorNote>This report is for managers and owners.</ErrorNote></div>;
  }

  const report = got.data;
  const against = PERIODS.find((one) => one.key === period)?.against ?? '';
  const move = report ? report.taps.total - report.taps.previous : 0;

  return (
    <div className="p-messaging">
      <div className="d-filters">
        {/* All three of the owner's reports, in the order
            `design/web/messaging-report.html` puts them. Live was missing
            here, so this was the one of the three you could not leave
            without going back twice. */}
        <div className="d-seg">
          <Link to="/v2/activity">Activity</Link>
          <Link to="/v2/team-live">Live</Link>
          <Link to="/v2/messaging" className="d-on">Messaging</Link>
        </div>
        <span className="d-grow" />
        <span className="d-small d-muted">WhatsApp and Telegram taps</span>
      </div>

      <div className="v2-page-head">
        <h2 className="d-grow">From tap to reply</h2>
        <div className="d-seg" role="tablist">
          {PERIODS.map((one) => (
            <button
              key={one.key}
              type="button"
              role="tab"
              aria-selected={period === one.key}
              className={period === one.key ? 'd-on' : undefined}
              onClick={() => setPeriod(one.key)}
            >
              {one.label}
            </button>
          ))}
        </div>
      </div>

      {got.error && <ErrorNote>{got.error}</ErrorNote>}
      {!report && !got.error && <Spinner />}

      {report && (
        <>
          <div className="d-funnel">
            <section className="d-card d-hero">
              <span className="d-label">Taps on WhatsApp or Telegram</span>
              <div className="d-stat-row">
                <b className="d-num-hero">{report.taps.total}</b>
                {/* The arrow is the sign, so the number is written plain. */}
                {report.taps.previous > 0 || report.taps.total > 0 ? (
                  <span className={move >= 0 ? 'd-delta d-up' : 'd-delta d-down'}>
                    {Math.abs(move)} {against}
                  </span>
                ) : null}
              </div>
              <span className="d-muted d-small">
                {report.taps.whatsapp} WhatsApp · {report.taps.telegram} Telegram
              </span>
              <div className="d-step-bar"><i style={bar(1)} /></div>
            </section>

            <section className="d-card">
              <span className="d-label">Confirmed · the agent answered</span>
              <div className="d-stat-row">
                <b className="d-num">{report.confirmed}</b>
                <span className="d-of">{share(report.confirmed, report.taps.total)} of taps</span>
              </div>
              {report.noUpdate > 0 ? (
                <button
                  type="button"
                  className="v2-jump d-small d-t-red"
                  onClick={() => agentsCard.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  {report.noUpdate} with no update
                </button>
              ) : (
                <span className="d-small d-muted">Every tap has an answer</span>
              )}
              <div className="d-step-bar"><i style={bar(report.confirmed / Math.max(1, report.taps.total))} /></div>
            </section>

            <section className="d-card">
              <span className="d-label">The client replied</span>
              <div className="d-stat-row">
                <b className="d-num">{report.replied}</b>
                <span className="d-of">{share(report.replied, report.confirmed)} of confirmed</span>
              </div>
              <span className="d-small d-muted">
                {report.answers.sent ?? 0} still waiting · {report.answers.no_reply ?? 0} no reply
              </span>
              <div className="d-step-bar"><i style={bar(report.replied / Math.max(1, report.taps.total))} /></div>
            </section>

            <section className="d-card">
              <span className="d-label">Links opened by clients</span>
              <div className="d-stat-row">
                <b className="d-num">{report.links.opened}</b>
                <span className="d-of">of {report.links.made} links</span>
              </div>
              <span className="d-small d-muted">
                {report.links.opens} {report.links.opens === 1 ? 'open' : 'opens'} in total
              </span>
              <div className="d-step-bar">
                <i style={bar(report.links.opened / Math.max(1, report.links.made))} />
              </div>
            </section>
          </div>

          <div className="d-bento d-mt-16">
            <section className="d-card d-c-8" aria-label="By agent" ref={agentsCard}>
              <div className="d-card-head">
                <h3>By agent</h3>
                <span className="d-small d-muted">
                  “No update” = the agent did not answer “What happened?”
                </span>
              </div>

              {report.agents.length > 0 ? (
                <div className="d-table-wrap">
                  {/* `v2-d-cards`: one card per agent under 768px —
                      `docs/v2/phone-shell.md` §5.4. Seven columns at 390px
                      dragged the whole page to 697px and scrolled it
                      sideways. Each `<td>` carries its own heading, because
                      the `<thead>` is gone by then. */}
                  <table className="d-table d-id-agents v2-d-cards">
                    <thead>
                      <tr>
                        <th>Agent</th>
                        <th className="d-t-right">Taps</th>
                        <th className="d-t-right">Confirmed</th>
                        <th className="d-t-right">Replied</th>
                        <th>Reply rate</th>
                        <th className="d-t-right">Links opened</th>
                        <th className="d-t-right">No update</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.agents.map((row) => {
                        const rate = row.confirmed > 0
                          ? Math.round((row.replied / row.confirmed) * 100)
                          : 0;
                        return (
                          <tr key={row.userId}>
                            <td>
                              <span className="d-person">
                                <Avatar name={row.name} size={26} />
                                <b>{firstName(row.name)}</b>
                              </span>
                            </td>
                            <td className="d-t-right" data-label="Taps"><b>{row.taps}</b></td>
                            <td className="d-t-right" data-label="Confirmed">{row.confirmed}</td>
                            <td className="d-t-right" data-label="Replied">{row.replied}</td>
                            <td data-label="Reply rate">
                              <div className="d-row d-gap-8">
                                <div
                                  className={rate >= 45 ? 'd-bar d-green v2-rate-bar' : 'd-bar v2-rate-bar'}
                                  style={{ '--v': `${rate}%` } as React.CSSProperties}
                                >
                                  <i />
                                </div>
                                <span className="d-small">{row.confirmed > 0 ? `${rate}%` : '—'}</span>
                              </div>
                            </td>
                            <td className="d-t-right" data-label="Links opened">{row.linksOpened}</td>
                            <td className="d-t-right" data-label="No update">
                              {row.noUpdate === 0 && <span className="d-muted">0</span>}
                              {row.noUpdate > 0 && reminded.includes(row.userId) && (
                                <span className="d-small d-muted">Reminded</span>
                              )}
                              {row.noUpdate > 0 && !reminded.includes(row.userId) && (
                                <span className="d-nu">
                                  <b className="d-t-red">{row.noUpdate}</b>
                                  <button
                                    type="button"
                                    className="d-btn d-xs"
                                    disabled={busy === row.userId}
                                    onClick={() => remind(row)}
                                  >
                                    Remind
                                  </button>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="d-empty">
                  <span className="d-ic"><Icon name="message-circle" /></span>
                  <b>No taps {period === 'today' ? 'today' : 'in this period'}</b>
                  <p>Nobody has opened WhatsApp or Telegram from a lead yet.</p>
                </div>
              )}

              <div className="d-card-foot">
                <Icon name="info" />
                <span>
                  Most “no update” first. Remind sends one notification with every open question in
                  it.
                </span>
              </div>
            </section>

            <div className="d-stack d-c-4">
              <section className="d-card" aria-label="What the agents answered">
                <div className="d-card-head">
                  <h3>What the agents answered</h3>
                  <span className="d-small d-muted">{report.confirmed} answered</span>
                </div>

                {report.confirmed > 0 && (
                  <div className="d-segbar d-tall">
                    {ANSWERS.filter((one) => (report.answers[one.key] ?? 0) > 0).map((one) => (
                      <i
                        key={one.key}
                        className={one.colour}
                        data-tip={`${one.label} ${report.answers[one.key] ?? 0}`}
                        style={{ '--v': report.answers[one.key] ?? 0 } as React.CSSProperties}
                      />
                    ))}
                  </div>
                )}

                <div className="d-hbars d-mt-16">
                  {ANSWERS.map((one) => (
                    <div className="d-hbar v2-answer-row" key={one.key}>
                      <span>
                        {one.dot && <span className={`d-dot ${one.dot}`} />} {one.label}
                      </span>
                      <b>{report.answers[one.key] ?? 0}</b>
                    </div>
                  ))}
                  <div className="d-hbar v2-answer-row">
                    <span>Not answered yet</span>
                    <b className={report.noUpdate > 0 ? 'd-t-red' : undefined}>{report.noUpdate}</b>
                  </div>
                </div>

                <div className="d-card-foot">
                  <span>
                    The column records that a client replied, not what they said — so “interested”
                    and “not now” cannot be split apart here.
                  </span>
                </div>
              </section>
            </div>
          </div>

          <div className="d-bento d-mt-16">
            <section className="d-card d-c-8" aria-label="Links opened by clients">
              <div className="d-card-head">
                <h3>Links opened by clients</h3>
                <span className="d-small d-muted">Tracked links the CRM made</span>
              </div>

              {report.opened.length > 0 ? (
                <div className="d-divide">
                  {report.opened.map((one) => (
                    <Row key={one.linkId} link={one} />
                  ))}
                </div>
              ) : (
                <div className="d-empty">
                  <span className="d-ic"><Icon name="link" /></span>
                  <b>No link opened yet</b>
                  <p>
                    {report.links.made === 0
                      ? 'No tracked link has been made in this period.'
                      : `${report.links.made} ${report.links.made === 1 ? 'link' : 'links'} sent, none opened yet.`}
                  </p>
                </div>
              )}
            </section>

            <section className="d-card d-c-4 d-how" aria-label="How it is counted">
              <div className="d-card-head"><h3>How it is counted</h3></div>
              <ol>
                <li>
                  <b>Tap</b> · the agent presses WhatsApp or Telegram on a lead. The chat opens on
                  their phone. The CRM never writes for them.
                </li>
                <li><b>Confirmed</b> · back in the CRM the agent answers “What happened?”.</li>
                <li><b>Replied</b> · the agent said the client wrote back.</li>
                <li>
                  <b>Link opened</b> · the client opened a brochure, payment plan, location or video
                  link the CRM made.
                </li>
              </ol>
              <div className="d-card-foot">
                <Icon name="lock" />
                <span>We do not read the chats. Only taps and answers are counted.</span>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/* ── one opened link ───────────────────────────────────────────────────── */

function Row({ link }: { link: OpenedLink }) {
  const what = link.label ?? kindLabel(link.kind);
  const line = [
    `opened ${link.opens} ${link.opens === 1 ? 'time' : 'times'}`,
    link.lastOpenedAt ? `last ${clock(link.lastOpenedAt)}` : null,
  ].filter(Boolean).join(' · ');

  const inside = (
    <>
      <span className="d-card-icon"><Icon name={LINK_ICON[link.kind] ?? 'link'} /></span>
      <span className="d-grow">
        <b>{[link.client, what].filter(Boolean).join(' · ')}</b>
        <span>{line}</span>
      </span>
      {link.agentName && (
        <span className="d-person d-small">
          <Avatar name={link.agentName} size={22} />
          {firstName(link.agentName)}
        </span>
      )}
      <Icon name="chevron-right" />
    </>
  );

  /* A link whose lead was deleted is still a real open worth showing; it just
     has nowhere to go. */
  return link.leadId
    ? <Link className="d-lk" to={`/v2/leads/${link.leadId}`}>{inside}</Link>
    : <div className="d-lk">{inside}</div>;
}

/* ── small things ──────────────────────────────────────────────────────── */

function bar(fraction: number): React.CSSProperties {
  const pc = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * 100;
  return { '--v': `${Math.round(pc)}%` } as React.CSSProperties;
}

function share(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function kindLabel(kind: string): string {
  const named: Record<string, string> = {
    brochure: 'Brochure',
    payment_plan: 'Payment plan',
    location: 'Location',
    video: 'Video',
    project: 'Project page',
    offer: 'Sales offer',
    other: 'Link',
  };
  return named[kind] ?? 'Link';
}

/**
 * Dubai's clock, which is the only clock this office reads.
 *
 * A fixed +04:00 shift and then UTC hours, not a timezone library: Dubai has
 * no daylight saving, and the rest of the CRM reads the clock the same way.
 * See CLAUDE.md.
 */
function clock(at: string): string {
  const dubai = new Date(new Date(at).getTime() + 4 * 3600_000);
  return `${String(dubai.getUTCHours()).padStart(2, '0')}:${String(dubai.getUTCMinutes()).padStart(2, '0')}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
