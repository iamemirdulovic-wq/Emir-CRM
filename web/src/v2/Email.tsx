import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, ErrorNote, Spinner } from '../design/ui.js';

/**
 * Email.
 *
 * Ported from `design/web/email.html`: a list down the left, and the email
 * itself drawn on the right as the client will see it, with a Computer and a
 * Phone width.
 *
 * What the list holds had to change. The design draws a mailbox — Inbox 4,
 * Drafts 2, Sent, one row per client with "Opened 2 times" beside it. The CRM
 * has no mailbox: email goes out from the lead's own page and its opens are
 * recorded against that lead, so there is no endpoint that lists sent mail
 * across the company. What there is, and what agents actually need to see, is
 * the library of emails the CRM sends — `GET /api/email/templates` — so that
 * is the list, and the right-hand side draws the chosen one.
 *
 * Nothing on this screen sends anything. The Send button is on the lead, where
 * the person being written to is known.
 */

interface EmailTemplate {
  id: string;
  template_key: string | null;
  name: string;
  category: string;
  language: string | null;
  subject: string;
  body: string;
  preview_text: string | null;
  is_system: number;
  enabled: number;
}

interface TemplateList {
  items: EmailTemplate[];
  mergeFields: Array<{ key: string; label: string }>;
}

interface Readiness {
  sendingOn: boolean;
  provider: string;
  configured: boolean;
  testMode: boolean;
  testRedirect: string | null;
  problems: string[];
}

interface CompanyResponse {
  company: { legalName?: string; tradingName?: string; address?: string; trn?: string };
}

const CATEGORY_LABEL: Record<string, string> = {
  first_reply: 'First reply',
  follow_up: 'Follow-up',
  project: 'Project',
  appointment: 'Appointment',
  offer: 'Offer',
  nurture: 'Keeping in touch',
  other: 'Other',
};

export function V2Email() {
  const { user } = useAuth();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);

  const list = useAsync<TemplateList>(() => api.get('/api/email/templates'), []);
  const readiness = useAsync<Readiness>(() => api.get('/api/email/readiness'), []);
  const company = useAsync<CompanyResponse>(() => api.get('/api/company'), []);

  const items = list.data?.items ?? [];
  const known = useMemo(
    () => new Set((list.data?.mergeFields ?? []).map((one) => one.key)),
    [list.data],
  );
  const chosen = items.find((one) => one.id === chosenId) ?? items[0] ?? null;

  return (
    <div className="v2-email p-email">
      {/* Email is off until SMTP is set, and a screen that does not say so
          leaves an agent believing a client was written to. */}
      {readiness.data && !readiness.data.sendingOn && (
        <div className="d-banner d-amber v2-em-note">
          <Icon name="alert-triangle" />
          <span className="d-grow">
            <b>Email is off.</b>{' '}
            {readiness.data.problems.join(' · ') || 'Nothing can be delivered until it is set up.'}
          </span>
          {(user?.role === 'owner' || user?.role === 'admin') && (
            <Link className="d-btn d-sm" to="/v2/settings/health">Check the setup</Link>
          )}
        </div>
      )}
      {readiness.data?.testMode && (
        <div className="d-banner d-blue v2-em-note">
          <Icon name="info" />
          <span className="d-grow">
            Test mode: every email goes to {readiness.data.testRedirect ?? 'the test address'},
            never to the client.
          </span>
        </div>
      )}

      <div className="d-em">
        <section className="d-card d-pad-0">
          <div className="d-ib-pad">
            <div className="d-row">
              <b className="d-bold d-grow">The emails we send</b>
              <span className="d-small d-muted">{items.length}</span>
            </div>
            <p className="d-small d-muted d-mt-4">
              You send one of these from a lead, so it lands on their timeline.
            </p>
          </div>

          <div className="d-em-list">
            {list.error && <ErrorNote>{list.error}</ErrorNote>}
            {!list.data && !list.error && <Spinner />}
            {list.data && items.length === 0 && (
              <div className="d-empty">
                <span className="d-ic"><Icon name="mail" /></span>
                <b>No emails yet</b>
                <p>The CRM ships with six. Ask the owner to seed them.</p>
              </div>
            )}
            {items.map((one) => (
              <button
                key={one.id}
                type="button"
                className={one.id === chosen?.id ? 'd-ml d-on' : 'd-ml'}
                onClick={() => setChosenId(one.id)}
              >
                <span className="d-row d-gap-6">
                  <b className="d-truncate d-grow">{one.name}</b>
                  {one.is_system === 1 && <span className="d-vip-tag">BUILT IN</span>}
                  {/* The language is on the row because the same email exists in
                      English and Arabic, and sending the wrong one is a bad first
                      impression. An older row may not carry one. */}
                  {one.language && (
                    <span className="d-tiny d-muted">{one.language.toUpperCase()}</span>
                  )}
                </span>
                <span className="d-sj d-truncate">{one.subject}</span>
                <span className="d-row d-gap-6">
                  {/* `d-row` is a flex box, so the preview actually ellipsises.
                      As a bare inline span it ran on under the chip. */}
                  <span className="d-sub d-truncate d-grow">
                    {one.preview_text ?? firstLine(one.body)}
                  </span>
                  {one.enabled === 1
                    ? <span className="d-chip">{CATEGORY_LABEL[one.category] ?? one.category}</span>
                    : <span className="d-chip d-amber">Switched off</span>}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="d-card d-pad-0 v2-em-view">
          <div className="d-em-bar">
            <div className="d-grow">
              <div className="d-row d-gap-8">
                <h3 className="d-truncate">{chosen ? chosen.name : 'Email'}</h3>
                {chosen?.is_system === 1 && <span className="d-vip-tag">BUILT IN</span>}
              </div>
              <div className="d-small d-muted d-mt-4">
                This is what the client gets. The words in brackets are filled in from
                their record when you send it.
              </div>
            </div>
            <div className="d-seg d-sm" role="group" aria-label="Width">
              <button
                type="button"
                className={phone ? undefined : 'd-on'}
                aria-pressed={!phone}
                onClick={() => setPhone(false)}
              >
                Computer
              </button>
              <button
                type="button"
                className={phone ? 'd-on' : undefined}
                aria-pressed={phone}
                onClick={() => setPhone(true)}
              >
                Phone
              </button>
            </div>
          </div>

          {chosen && (
            <>
              <div className="d-em-meta">
                <div>
                  <span>From</span>
                  <b>{user?.name ?? '—'}{user?.email ? ` <${user.email}>` : ''}</b>
                </div>
                <div>
                  <span>To</span>
                  <b>The lead you send it to</b>
                </div>
                <div>
                  <span>Subject</span>
                  <b><Filled text={chosen.subject} known={known} /></b>
                </div>
              </div>

              <div className="d-em-stage">
                <div className={phone ? 'd-em-mail d-ph' : 'd-em-mail'}>
                  <div className="d-em-top">
                    <span className="d-em-logo"><Icon name="building" /></span>
                    {/* The brand on the client's email is whatever Settings
                        says it is, not a name baked into the page. */}
                    <b>{brand(company.data)}</b>
                    <span className="d-grow" />
                    <span className="d-em-vip">
                      {(CATEGORY_LABEL[chosen.category] ?? chosen.category).toUpperCase()}
                    </span>
                  </div>

                  <div className="d-em-body">
                    {chosen.body.split(/\n{2,}/).filter(Boolean).map((block, i) => (
                      i === 0
                        ? <h2 key={i}><Filled text={block} known={known} /></h2>
                        : <p key={i}><Filled text={block} known={known} /></p>
                    ))}

                    <div className="d-em-sign">
                      <Avatar name={user?.name ?? '?'} size={44} src={user?.photoUrl ?? undefined} />
                      <div>
                        <b>{user?.name ?? 'Your name'}</b>
                        <span>Property Consultant</span>
                        <span>{user?.email ?? ''}</span>
                      </div>
                    </div>
                  </div>

                  {/* The footer is the company's real registered detail or
                      nothing — an invented licence number in a client's inbox
                      is the company's problem, not a placeholder. */}
                  <div className="d-em-foot">
                    {companyFooter(company.data) ?? 'Set the company details in Settings · Company '
                      + 'and they appear here.'}
                  </div>
                </div>
              </div>
            </>
          )}

          {!chosen && list.data && (
            <div className="d-empty">
              <span className="d-ic"><Icon name="mail" /></span>
              <b>Nothing to show</b>
              <p>Pick an email on the left.</p>
            </div>
          )}
        </section>
      </div>

      <p className="d-small d-muted d-mt-16">
        Open a lead and press Email to send one of these. Whether the client opened it is
        recorded on that lead, not here.
      </p>
    </div>
  );
}

/**
 * The merge fields, marked rather than guessed at.
 *
 * `{{first_name}}` is filled by the server at the moment of sending, from the
 * lead's own record. Showing it filled with a made-up name here would teach an
 * agent to expect a name the CRM may not hold, so it is shown as the blank it
 * is — and a field the server does not know is flagged red, which is how a
 * typo in a template gets caught before a client sees it.
 */
function Filled({ text, known }: { text: string; known: Set<string> }) {
  const parts = text.split(/(\{\{\s*[a-z_]+\s*\}\})/i);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\{\{\s*([a-z_]+)\s*\}\}$/i.exec(part);
        if (!match) return <Fragment key={i}>{part}</Fragment>;
        const key = (match[1] ?? '').toLowerCase();
        return (
          <mark key={i} className={known.has(key) ? undefined : 'v2-em-unknown'}>
            {key.replace(/_/g, ' ')}
          </mark>
        );
      })}
    </>
  );
}

/** The trading name, split so the dot takes the accent colour the design gives it. */
function brand(data: CompanyResponse | null) {
  const name = data?.company?.tradingName?.trim() || 'homes.me';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return <>{name}</>;
  return <>{name.slice(0, dot)}<span>.</span>{name.slice(dot + 1)}</>;
}

function firstLine(body: string): string {
  return body.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
}

function companyFooter(data: CompanyResponse | null): string | null {
  const company = data?.company;
  if (!company) return null;
  const parts = [
    company.legalName,
    company.address,
    company.trn ? `TRN ${company.trn}` : null,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
  return parts.length > 0 ? parts.join(' · ') : null;
}
