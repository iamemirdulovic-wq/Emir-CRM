import { useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { usePhoneHead } from './phone.js';

/**
 * One agent's month, on one page you can print.
 *
 * Emir asked for this on 25 November: a report per person he can keep, with
 * attendance, calls and what they let go cold. It prints through the
 * browser's own Save as PDF rather than a PDF library on the server — no new
 * software on managed hosting, nothing to pay for, and it works from his
 * phone, which a server-rendered PDF would not have done any better.
 *
 * **Every figure is counted by SQL.** Nothing here is estimated and no model
 * wrote a word of it, because this is a document about a real person that may
 * end up in a conversation about their job. The one thing the CRM cannot
 * answer — when somebody went home — is not answered: `attendance` records
 * the check-in and the Wi-Fi is matched once, at that tap. The page says
 * "last seen working" and says what that means underneath it.
 */

interface ReportDay {
  date: string;
  kind: 'office' | 'outside' | null;
  at: string | null;
  late: boolean;
  note: string | null;
  lastSeen: string | null;
  closed: boolean;
}

interface Report {
  person: { id: string; name: string; role: string; photoUrl: string | null };
  from: string;
  to: string;
  generatedAt: string;
  attendance: {
    openDays: number; inOffice: number; outside: number; late: number;
    absent: number; leave: number;
    usualArrival: string | null; usualLastSeen: string | null;
    days: ReportDay[];
  };
  calls: {
    total: number; byOutcome: Array<{ outcome: string; n: number }>;
    noOutcome: number; notCheckedIn: number; perOpenDay: number;
  };
  leads: {
    open: number; neverCalled: number; overdue: number;
    noNextStep: number; goingCold: number; takenBack: number;
  };
  results: { meetingsBooked: number; showed: number; noShow: number; won: number };
  score: {
    total: number;
    band: 'strong' | 'fine' | 'behind';
    parts: Array<{ key: string; label: string; got: number; outOf: number; why: string }>;
  };
  note: { kind: 'congratulate' | 'steady' | 'warn'; headline: string; body: string };
}

/** This month, as the two dates the server wants. */
function thisMonth(): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const two = (n: number) => String(n).padStart(2, '0');
  return { from: `${y}-${two(m + 1)}-01`, to: `${y}-${two(m + 1)}-${two(last)}` };
}

const OUTCOME_WORDS: Record<string, string> = {
  interested: 'Interested',
  no_answer: 'No answer',
  busy: 'Busy',
  call_back: 'Call back',
  wrong_number: 'Wrong number',
  not_interested: 'Not interested',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function longDate(iso: string): string {
  const [y = '', m = '', d = ''] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''} ${y}`;
}

export function V2AgentReport() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const period = useMemo(() => {
    const fallback = thisMonth();
    return {
      from: params.get('from') ?? fallback.from,
      to: params.get('to') ?? fallback.to,
    };
  }, [params]);

  const got = useAsync<Report>(
    () => api.get(`/api/v2/agent-report/${id}?from=${period.from}&to=${period.to}`),
    [id, period.from, period.to],
  );

  usePhoneHead({ compact: true, title: 'Report' });

  if (got.error) {
    return (
      <div className="v2-rep">
        <p className="d-small d-muted">{got.error}</p>
        <Link to="/v2/team" className="d-btn d-sm">Back to Team</Link>
      </div>
    );
  }
  if (!got.data) return <div className="v2-rep"><p className="d-small d-muted">Counting…</p></div>;

  const r = got.data;
  const a = r.attendance;
  const worked = a.inOffice + a.outside;

  /* Only the days worth reading. Twenty-two identical "in office, on time"
     rows are what makes a report go unread. */
  const exceptions = a.days.filter(
    (d) => !d.closed && (d.kind === null || d.late || d.kind === 'outside'),
  );

  return (
    <div className="v2-rep">
      {/* Not printed: the controls. `@media print` hides this whole bar. */}
      <div className="v2-rep-bar">
        <Link to="/v2/team" className="d-btn d-sm"><Icon name="arrow-left" size={15} />Team</Link>
        <span className="d-grow" />
        <button type="button" className="d-btn d-primary d-sm" onClick={() => window.print()}>
          <Icon name="download" size={15} />Save as PDF
        </button>
      </div>

      <article className="v2-rep-page">
        <header className="v2-rep-head">
          <div className="d-grow">
            {/* The company's own logo, served from `/api/company/logo`. It
                falls back to the word mark if none has been uploaded. */}
            <img
              className="v2-rep-logo"
              src="/api/company/logo"
              alt="homes.me"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            <h1 className="v2-rep-name">{r.person.name}</h1>
            <p className="v2-rep-when">
              {longDate(r.from)} — {longDate(r.to)} · {r.person.role}
            </p>
          </div>
          {r.person.photoUrl && (
            <img className="v2-rep-face" src={r.person.photoUrl} alt="" />
          )}
        </header>

        {/* 1 — the score, and the line written to them */}
        <section className={`v2-rep-note-card v2-rep-${r.note.kind}`}>
          <div className="v2-rep-score">
            <span className="v2-rep-scoren">{r.score.total}</span>
            <span className="v2-rep-scorel">out of 100</span>
          </div>
          <div className="d-grow">
            <h2 className="v2-rep-noteh">{r.note.headline}</h2>
            <p className="v2-rep-noteb">{r.note.body}</p>
          </div>
        </section>

        <section className="v2-rep-parts">
          {r.score.parts.map((part) => (
            <div className="v2-rep-part" key={part.key}>
              <div className="v2-rep-partt">
                <span>{part.label}</span>
                <b>{part.got}<small> / {part.outOf}</small></b>
              </div>
              {/* `v2-rep-meter`, not `v2-rep-bar`: that name already belongs
                  to the row of buttons above, which `@media print` hides —
                  so the score bars printed as nothing at all. */}
              <div className="v2-rep-meter">
                <i style={{ width: `${Math.round((part.got / part.outOf) * 100)}%` }} />
              </div>
              <span className="v2-rep-partw">{part.why}</span>
            </div>
          ))}
        </section>

        {/* 2 — the month in four numbers */}
        <section className="v2-rep-strip">
          <Big n={`${worked} of ${a.openDays}`} label="days worked" />
          <Big n={r.calls.total} label="calls" />
          <Big n={r.leads.open} label="open leads" />
          <Big n={r.results.won} label={r.results.won === 1 ? 'deal won' : 'deals won'} />
        </section>

        {/* 2 — attendance at a glance */}
        <Block title="Attendance">
          <div className="v2-rep-squares">
            {a.days.map((d) => (
              <span
                key={d.date}
                className={`v2-rep-sq ${squareOf(d)}`}
                title={`${d.date}${d.note ? ` · ${d.note}` : ''}`}
              >
                {Number(d.date.slice(8))}
              </span>
            ))}
          </div>
          <p className="v2-rep-key">
            <Key cls="v2-rep-in">In office {a.inOffice}</Key>
            <Key cls="v2-rep-late">Late {a.late}</Key>
            <Key cls="v2-rep-out">Outside {a.outside}</Key>
            <Key cls="v2-rep-leave">Leave {a.leave}</Key>
            <Key cls="v2-rep-abs">Absent {a.absent}</Key>
            <Key cls="v2-rep-shut">Closed</Key>
          </p>
          <dl className="v2-rep-kv">
            <Row k="Usually arrives" v={a.usualArrival ?? 'No check-ins'} />
            <Row k="Usually last seen working" v={a.usualLastSeen ?? 'Nothing recorded'} />
          </dl>
          <p className="v2-rep-note">
            “Last seen working” is their last call, note or stage change that day. This CRM
            records the check-in, not the way out — so it is not a leaving time.
          </p>
        </Block>

        {/* 3 — only the days that were not normal */}
        {exceptions.length > 0 && (
          <Block title="The days that were not normal">
            <table className="v2-rep-table">
              <thead>
                <tr><th>Date</th><th>What happened</th><th>In</th><th>Last seen</th><th>Their note</th></tr>
              </thead>
              <tbody>
                {exceptions.map((d) => (
                  <tr key={d.date}>
                    <td>{longDate(d.date)}</td>
                    <td>{wordFor(d)}</td>
                    <td>{d.at ? clockOf(d.at) : '—'}</td>
                    <td>{d.lastSeen ?? '—'}</td>
                    <td>{d.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        )}

        {/* 4 — calls */}
        <Block title="Calls">
          <dl className="v2-rep-kv">
            <Row k="Calls made" v={String(r.calls.total)} />
            <Row k="Per working day" v={String(r.calls.perOpenDay)} />
            <Row k="No outcome written" v={String(r.calls.noOutcome)} />
            <Row
              k="Dialled while not checked in"
              v={String(r.calls.notCheckedIn)}
              warn={r.calls.notCheckedIn > 0}
            />
          </dl>
          {r.calls.byOutcome.length > 0 && (
            <table className="v2-rep-table">
              <thead><tr><th>Outcome</th><th>Calls</th></tr></thead>
              <tbody>
                {r.calls.byOutcome.map((o) => (
                  <tr key={o.outcome}>
                    <td>{OUTCOME_WORDS[o.outcome] ?? o.outcome}</td>
                    <td>{o.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Block>

        {/* 5 — leads, as they stand today */}
        <Block title="Their leads, today">
          <dl className="v2-rep-kv">
            <Row k="Open leads" v={String(r.leads.open)} />
            <Row k="Never called" v={String(r.leads.neverCalled)} warn={r.leads.neverCalled > 0} />
            <Row k="Next step overdue" v={String(r.leads.overdue)} warn={r.leads.overdue > 0} />
            <Row k="No next step at all" v={String(r.leads.noNextStep)} />
            <Row k="Going cold" v={String(r.leads.goingCold)} />
            <Row k="Taken back in this period" v={String(r.leads.takenBack)} warn={r.leads.takenBack > 0} />
          </dl>
          <p className="v2-rep-note">
            These six count their desk as it is right now, not as it was during the period —
            a lead nobody has called is a thing to do today.
          </p>
        </Block>

        {/* 6 — results */}
        <Block title="Results">
          <dl className="v2-rep-kv">
            <Row k="Meetings booked" v={String(r.results.meetingsBooked)} />
            <Row k="Client showed up" v={String(r.results.showed)} />
            <Row k="No show" v={String(r.results.noShow)} />
            <Row k="Deals won" v={String(r.results.won)} />
          </dl>
        </Block>

        <footer className="v2-rep-foot">
          Generated {new Date(r.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })}
          {' '}· Every figure is counted from the CRM’s own records.
        </footer>
      </article>
    </div>
  );
}

/* ── the pieces ────────────────────────────────────────────────────────── */

function Big({ n, label }: { n: string | number; label: string }) {
  return (
    <div className="v2-rep-big">
      <span className="v2-rep-bign">{n}</span>
      <span className="v2-rep-bigl">{label}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="v2-rep-block">
      <h2 className="v2-rep-h2">{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="v2-rep-row">
      <dt>{k}</dt>
      <dd className={warn ? 'v2-rep-warn' : undefined}>{v}</dd>
    </div>
  );
}

function Key({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className="v2-rep-keyi"><i className={`v2-rep-dot ${cls}`} />{children}</span>;
}

function squareOf(d: ReportDay): string {
  if (d.closed) return 'v2-rep-shut';
  if (d.kind === 'office') return d.late ? 'v2-rep-late' : 'v2-rep-in';
  if (d.kind === 'outside') return 'v2-rep-out';
  return 'v2-rep-abs';
}

function wordFor(d: ReportDay): string {
  if (d.kind === 'office' && d.late) return 'Late';
  if (d.kind === 'outside') return 'Working outside the office';
  if (d.kind === null) return 'No check-in';
  return 'In office';
}

/** "2026-11-14T05:14:00.000Z" → "09:14", Dubai being UTC+4 all year. */
function clockOf(at: string): string {
  const d = new Date(new Date(at).getTime() + 4 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
