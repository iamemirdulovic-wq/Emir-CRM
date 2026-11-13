import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';
import { Avatar, Spinner, ErrorNote, useToast } from '../design/ui.js';
import { usePhoneHead } from './phone.js';

/**
 * My personal information — `design/screens/PersonalInfo.dc.html`, and the
 * "Personal info" tab of `design/web/profile.html`.
 *
 * The audit found no address for this at all: nothing in v2 could write a
 * name, a phone number, a WhatsApp number, an email, a language or a BRN, so
 * a new agent could not fill in the record that the Team page, every transfer
 * and the public business card all read.
 *
 * Every field here is a column that exists and an endpoint that takes it —
 * `PATCH /api/profiles/:id` for the seven values, `POST`/`DELETE
 * /api/profiles/:id/photo` for the picture. Two of the design's fields are
 * not editable and say why rather than pretending:
 *
 *  - **Full name** is `users.name`. The server lets an owner or admin change
 *    it and refuses an agent (`PATCH /api/users/:id` — "An agent may set
 *    their own availability and interface language; everything else is
 *    admin-only"), so an agent sees it as a fact with the reason beside it.
 *  - **The sign-in email** is the address you log in with and only an owner
 *    changes it, which is what the computer design says in words. The
 *    editable email here is the one the card and the profile show.
 *
 * Where the two designs disagree the computer design wins, so: the languages
 * are a chip picker with "Choose at least one language", and the BRN hint is
 * "4 to 6 digits". Both cases are written down in
 * `docs/v2/phone-questions-c.md`.
 */

interface Profile {
  profile: {
    user_id: string;
    name: string;
    email: string;
    slug: string | null;
    job_title: string | null;
    brn: string | null;
    photo_url: string | null;
    public_phone: string | null;
    public_email: string | null;
    whatsapp: string | null;
    languages: unknown;
  };
  editable: boolean;
}

/** The ten the computer design offers, in its order. */
const LANGUAGES = [
  'English', 'Arabic', 'Russian', 'Hindi', 'Urdu',
  'Portuguese', 'Serbian', 'Ukrainian', 'Punjabi', 'French',
];

interface Draft {
  name: string;
  jobTitle: string;
  publicPhone: string;
  whatsapp: string;
  publicEmail: string;
  brn: string;
  languages: string[];
}

export function V2PersonalInfo() {
  const { user } = useAuth();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const got = useAsync<Profile>(() => api.get('/api/profiles/me'), [reloadKey]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sameWhatsapp, setSameWhatsapp] = useState(true);
  const pick = useRef<HTMLInputElement>(null);

  usePhoneHead({
    title: 'Personal information',
    sub: 'Shown on your digital card',
  });

  useEffect(() => {
    if (!got.data) return;
    const one = got.data.profile;
    setDraft({
      name: one.name ?? '',
      jobTitle: one.job_title ?? '',
      publicPhone: one.public_phone ?? '',
      whatsapp: one.whatsapp ?? '',
      publicEmail: one.public_email ?? '',
      brn: one.brn ?? '',
      languages: asList(one.languages),
    });
    setSameWhatsapp(!one.whatsapp || one.whatsapp === one.public_phone);
    setDirty(false);
  }, [got.data]);

  /* A name an agent cannot save is a field an agent should not be given. */
  const canRename = user?.role === 'owner' || user?.role === 'admin';

  function set(patch: Partial<Draft>) {
    setDraft((was) => (was ? { ...was, ...patch } : was));
    setDirty(true);
    setProblem(null);
  }

  async function save() {
    if (!draft || !got.data) return;
    if (canRename && draft.name.trim().length < 3) {
      setProblem('Write your full name.');
      return;
    }
    if (digits(draft.publicPhone).length < 9) {
      setProblem('Write your phone number with the country code.');
      return;
    }
    if (draft.brn.trim() && !/^\d{4,6}$/.test(draft.brn.trim())) {
      setProblem('A BRN has 4 to 6 digits.');
      return;
    }
    if (draft.languages.length === 0) {
      setProblem('Choose at least one language.');
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      await api.patch(`/api/profiles/${got.data.profile.user_id}`, {
        jobTitle: draft.jobTitle.trim() || null,
        brn: draft.brn.trim() || null,
        publicPhone: draft.publicPhone.trim() || null,
        /* The switch is the computer design's: one number, written once. */
        whatsapp: (sameWhatsapp ? draft.publicPhone.trim() : draft.whatsapp.trim()) || null,
        publicEmail: draft.publicEmail.trim() || null,
        languages: draft.languages,
      });
      /* The name is a different table and a different permission, so it is a
         second call and only when somebody may make it. */
      if (canRename && draft.name.trim() !== got.data.profile.name) {
        await api.patch(`/api/users/${got.data.profile.user_id}`, { name: draft.name.trim() });
      }
      setDirty(false);
      toast('Saved · your digital card is updated');
      setReloadKey((n) => n + 1);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function photo(file: File | undefined) {
    if (!file || !got.data) return;
    setBusy(true);
    try {
      await api.upload(`/api/profiles/${got.data.profile.user_id}/photo`, file);
      toast('Photo saved');
      setReloadKey((n) => n + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not upload that');
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    if (!got.data) return;
    setBusy(true);
    try {
      await api.del(`/api/profiles/${got.data.profile.user_id}/photo`);
      toast('Photo removed');
      setReloadKey((n) => n + 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not remove that');
    } finally {
      setBusy(false);
    }
  }

  if (got.error) return <div className="p-profile"><ErrorNote>{got.error}</ErrorNote></div>;
  if (!got.data || !draft) return <div className="p-profile"><Spinner /></div>;

  const me = got.data.profile;
  /* The design counts the seven fields plus the photo. */
  const parts: Array<[string, boolean]> = [
    ['Full name', draft.name.trim().length > 0],
    ['Job title', draft.jobTitle.trim().length > 0],
    ['Phone', digits(draft.publicPhone).length >= 9],
    ['WhatsApp', sameWhatsapp || digits(draft.whatsapp).length >= 9],
    ['Email', draft.publicEmail.trim().length > 0],
    ['Languages', draft.languages.length > 0],
    ['BRN', draft.brn.trim().length > 0],
    ['Photo', Boolean(me.photo_url)],
  ];
  const done = parts.filter(([, filled]) => filled).length;
  const percent = Math.round((done / parts.length) * 100);
  const missing = parts.filter(([, filled]) => !filled).map(([label]) => label);

  return (
    <div className="v2-c-pi p-profile">
      <section className="d-card">
        <div className="d-pf-done">
          <div className="d-grow">
            <b className="d-bold">Profile {percent}% complete</b>
            <div className="d-bar d-accent d-mt-8" style={{ ['--v' as string]: `${percent}%` }}>
              <i />
            </div>
          </div>
          <span className="d-small d-muted">
            {missing.length === 0 ? 'All done.' : `Add: ${missing.join(', ')}`}
          </span>
        </div>
      </section>

      <section className="d-card">
        <div className="d-card-head"><h3>Profile photo</h3></div>
        <div className="d-row d-gap-16">
          <Avatar name={me.name} src={me.photo_url ?? undefined} size={60} />
          <div className="d-grow">
            <b className="d-bold">{me.photo_url ? 'Photo is set' : 'No photo'}</b>
            <div className="d-small d-muted">
              {me.photo_url
                ? 'A clear face photo. Shown to the team and on your card.'
                : 'No photo · your initials are shown'}
            </div>
          </div>
        </div>
        <div className="d-btn-row d-mt-12">
          <button
            type="button"
            className="d-btn d-sm"
            disabled={busy}
            onClick={() => pick.current?.click()}
          >
            <Icon name="camera" />Change
          </button>
          {me.photo_url && (
            <button type="button" className="d-btn d-sm d-danger" disabled={busy} onClick={removePhoto}>
              Remove
            </button>
          )}
          <input
            ref={pick}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => void photo(e.target.files?.[0])}
          />
        </div>
      </section>

      <section className="d-card">
        <div className="d-card-head"><h3>About you</h3></div>
        <div className="d-col d-gap-16">
          <div className="d-field">
            <label htmlFor="pi-name">Full name</label>
            {canRename ? (
              <input
                id="pi-name"
                className="d-input"
                autoComplete="name"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            ) : (
              <>
                <div className="d-msg-box">{me.name}</div>
                <span className="d-hint">Your name is on your account. Ask an owner to change it.</span>
              </>
            )}
          </div>

          <div className="d-field">
            <label htmlFor="pi-title">Job title</label>
            <input
              id="pi-title"
              className="d-input"
              placeholder="Property Consultant"
              value={draft.jobTitle}
              onChange={(e) => set({ jobTitle: e.target.value })}
            />
            <span className="d-hint">The first name is bold on the card; this shows under it.</span>
          </div>

          <div className="d-field">
            <label htmlFor="pi-brn">BRN</label>
            <input
              id="pi-brn"
              className="d-input"
              inputMode="numeric"
              value={draft.brn}
              onChange={(e) => set({ brn: e.target.value })}
            />
            <span className="d-hint">Broker registration number · 4 to 6 digits</span>
          </div>
        </div>
      </section>

      <section className="d-card">
        <div className="d-card-head"><h3>Contact</h3></div>
        <div className="d-col d-gap-16">
          <div className="d-field">
            <label htmlFor="pi-phone">Phone for clients</label>
            <input
              id="pi-phone"
              className="d-input"
              type="tel"
              inputMode="tel"
              placeholder="+971 …"
              value={draft.publicPhone}
              onChange={(e) => set({ publicPhone: e.target.value })}
            />
          </div>

          <div className="d-field">
            <label htmlFor="pi-wa">WhatsApp number</label>
            <input
              id="pi-wa"
              className="d-input"
              type="tel"
              inputMode="tel"
              placeholder="+971 …"
              disabled={sameWhatsapp}
              value={sameWhatsapp ? draft.publicPhone : draft.whatsapp}
              onChange={(e) => set({ whatsapp: e.target.value })}
            />
            <label className="d-switch d-small d-mt-4">
              <input
                type="checkbox"
                checked={sameWhatsapp}
                onChange={(e) => { setSameWhatsapp(e.target.checked); setDirty(true); }}
              />
              <span className="d-track" />
              WhatsApp is the same number
            </label>
          </div>

          <div className="d-field">
            <label htmlFor="pi-email">Work email</label>
            <input
              id="pi-email"
              className="d-input"
              type="email"
              placeholder="name@homes.me"
              value={draft.publicEmail}
              onChange={(e) => set({ publicEmail: e.target.value })}
            />
            <span className="d-hint">
              Shown on your digital card. You sign in with {me.email} — ask an owner to change that.
            </span>
          </div>
        </div>
      </section>

      <section className="d-card">
        <div className="d-card-head">
          <h3>Languages</h3>
          <span className="d-small d-muted">Used in transfers and in the team filters</span>
        </div>
        <div className="d-chips">
          {LANGUAGES.map((one) => {
            const on = draft.languages.includes(one);
            return (
              <button
                key={one}
                type="button"
                className={on ? 'd-chip-opt d-on' : 'd-chip-opt'}
                aria-pressed={on}
                onClick={() => set({
                  languages: on
                    ? draft.languages.filter((lang) => lang !== one)
                    : [...draft.languages, one],
                })}
              >
                {one}
              </button>
            );
          })}
        </div>
      </section>

      {problem && <ErrorNote>{problem}</ErrorNote>}

      <div className="d-set-savebar">
        <span className="d-small d-muted d-grow">
          Your colleagues, every transfer and your public card read this.
        </span>
        <button
          type="button"
          className="d-btn d-primary"
          disabled={busy || !dirty}
          onClick={save}
        >
          {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>

      <p className="v2-back-row">
        <Link to="/v2/card">See my digital card ›</Link>
      </p>
    </div>
  );
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/** A column that may be JSON, a comma-separated string, or already a list. */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* The older comma-separated form. */
  }
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}
