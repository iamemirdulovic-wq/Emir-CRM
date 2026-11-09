/**
 * Several people at once.
 *
 * Nine agents joined on one day. Adding them one form at a time is nine
 * chances to mistype a role, and a wrong role is somebody seeing the whole
 * team's leads.
 *
 * Only an address is asked for. There is no name to ask for yet, and an
 * invented one is worse than an obvious placeholder: the part before the @
 * is capitalised, and each person fixes their own on first sign-in, in the
 * welcome flow that already asks them who they are.
 *
 * The passwords come back once and are shown here to be copied. They are
 * never stored in plain text and never written to the audit log, and every
 * account is forced to choose its own password at the first sign-in.
 */
import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { Button } from '../design/forms.js';
import { Icon } from '../design/index.js';
import { Field, Note, useToast } from '../design/ui.js';
import { AccessCardModal, type Access } from './AccessCard.js';

type Role = 'admin' | 'manager' | 'agent';

interface Result {
  email: string;
  status: 'created' | 'already_exists' | 'invalid';
  temporaryPassword?: string;
  emailSent?: boolean;
  emailReason?: string;
}

/** Mirrors `nameFromEmail` on the server, so the card and the account agree. */
function titleCase(local: string): string {
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || local;
}

const WHY: Record<Result['status'], string> = {
  created: '',
  already_exists: 'already has an account',
  invalid: 'not a valid email address',
};

export function InviteTeam({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [role, setRole] = useState<Role>('agent');
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  /* The card is how these actually get handed over while email is off. */
  const [showing, setShowing] = useState<Access | null>(null);

  /* One address per line, but a pasted column from a spreadsheet arrives with
     commas and spaces in it just as often. */
  const emails = text.split(/[\s,;]+/).map((line) => line.trim()).filter(Boolean);

  async function invite() {
    setBusy(true);
    try {
      const res = await api.post<{ results: Result[]; created: number }>('/api/users/invite', {
        emails, role, sendEmail,
      });
      setResults(res.results);
      onDone();
      toast(res.created === 1 ? '1 account created' : `${res.created} accounts created`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not create the accounts');
    } finally {
      setBusy(false);
    }
  }

  const made = results?.filter((r) => r.status === 'created') ?? [];
  const sheet = made.map((r) => `${r.email}  ${r.temporaryPassword}`).join('\n');

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(sheet);
      toast('Copied — paste it somewhere safe, then delete it once everyone is in');
    } catch {
      toast('Could not copy. Select the list and copy it by hand.');
    }
  }

  if (results) {
    const noEmail = made.some((r) => r.emailSent === false);
    return (
      <div className="invite" aria-live="polite">
        <div className="invite-head">
          <b>{made.length === 1 ? '1 account created' : `${made.length} accounts created`}</b>
          <Button onClick={() => { setResults(null); setText(''); }}>Invite more</Button>
        </div>

        {made.length > 0 && (
          <>
            <p className="muted invite-lede">
              Each password is shown once, here. Hand them over on WhatsApp or in
              person, and everyone is asked to choose their own at their first sign-in.
            </p>
            <div className="invite-sheet">
              {made.map((r) => (
                <div className="invite-row" key={r.email}>
                  <span>{r.email}</span>
                  <code>{r.temporaryPassword}</code>
                  {r.emailSent === true && <em className="invite-sent"><Icon name="check" size={13} /> emailed</em>}
                  <button
                    type="button"
                    className="link"
                    onClick={() => setShowing({
                      /* The same name the server gave the account:
                         "tej@homes.me" -> "Tej", not "tej". */
                      name: titleCase(r.email.split('@')[0] ?? r.email),
                      email: r.email,
                      password: r.temporaryPassword ?? '',
                      url: 'crm.homes.me',
                    })}
                  >
                    Card
                  </button>
                </div>
              ))}
            </div>
            <div className="invite-actions">
              <Button variant="primary" icon="copy" onClick={() => void copyAll()}>
                Copy the list
              </Button>
            </div>
          </>
        )}

        {noEmail && (
          <Note>
            The welcome emails could not be sent, because email is not connected
            yet — Settings → Health. Nothing was lost: copy the list above and
            send it yourself.
          </Note>
        )}

        {showing && <AccessCardModal access={showing} onClose={() => setShowing(null)} />}

        {results.some((r) => r.status !== 'created') && (
          <div className="invite-skipped">
            {results.filter((r) => r.status !== 'created').map((r) => (
              <div key={r.email}><b>{r.email}</b> — {WHY[r.status]}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="invite">
      <Field label="Their email addresses, one on each line">
        <textarea
          className="input"
          rows={6}
          value={text}
          placeholder={'tej@homes.me\ntalha@homes.me\nsultan@homes.me'}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>

      <div className="invite-opts">
        <Field label="They join as">
          <select className="input" value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="agent">Agent — sees only their own leads</option>
            <option value="manager">Manager — sees their team</option>
            <option value="admin">Admin — sees everything</option>
          </select>
        </Field>
      </div>

      <label className="att-switch">
        <input
          type="checkbox"
          checked={sendEmail}
          onChange={(event) => setSendEmail(event.target.checked)}
        />
        <span>Email each of them their sign-in and how we work</span>
      </label>

      <Note>
        Everyone is asked to choose their own password the first time they sign
        in. You can change anybody&rsquo;s role afterwards in the table below.
      </Note>

      <div className="invite-actions">
        <Button variant="primary" loading={busy} disabled={emails.length === 0} onClick={() => void invite()}>
          {emails.length <= 1 ? 'Create the account' : `Create ${emails.length} accounts`}
        </Button>
      </div>
    </div>
  );
}
