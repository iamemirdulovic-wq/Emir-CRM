import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { FileDrop } from '../components/FileDrop.js';
import { useAsync } from '../lib/hooks.js';
import { useAuth } from '../lib/auth.js';
import { Button } from '../design/forms.js';
import { Icon, SkeletonRows } from '../design/index.js';
import type { IconName } from '../design/Icon.js';
import {
  Avatar, Chip, ErrorNote, Field, Note, Panel, Select, TextArea, Toolbar, useToast,
} from '../design/ui.js';
import { humanize } from '../lib/format.js';

/**
 * An agent's own page.
 *
 * The numbers and the badges are not editable, on purpose. An agent writes
 * their own bio and picks a cover; they cannot type in how many deals they
 * have done. A profile where the figures are typed is a profile nobody
 * believes, starting with the person whose profile it is.
 */

interface Profile {
  user_id: string;
  slug: string;
  name: string;
  email: string;
  role: string;
  job_title: string | null;
  brn: string | null;
  photo_url: string | null;
  phone_e164: string | null;
  headline: string | null;
  bio: string | null;
  cover_key: string;
  languages: unknown;
  specialities: unknown;
  public_phone: string | null;
  public_email: string | null;
  whatsapp: string | null;
  instagram: string | null;
  linkedin: string | null;
  is_public: number;
}

interface Badge {
  key: string;
  name: string;
  how: string;
  icon: string;
  earned: boolean;
  progress: number | null;
}

interface Response {
  profile: Profile;
  stats: {
    leadsWorking: number;
    dealsWon: number;
    appointments: number;
    speedToLeadSeconds: number | null;
    monthsHere: number;
  };
  badges: Badge[];
  level: { level: string; index: number; earned: number; of: number };
  editable: boolean;
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** "24s", "3 min", or nothing when they have never replied. */
function speed(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

export function Profile() {
  const { userId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const who = userId ?? 'me';
  const [reloadKey, setReloadKey] = useState(0);
  const data = useAsync<Response>(() => api.get(`/api/profiles/${who}`), [who, reloadKey]);
  const covers = useAsync<{ items: Array<{ key: string; name: string }> }>(
    () => api.get('/api/profiles/covers'),
    [],
  );

  const [draft, setDraft] = useState<Partial<Profile> | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  /* The draft starts as whatever is saved, once it has arrived. */
  useEffect(() => {
    if (data.data && draft === null) setDraft({ ...data.data.profile });
  }, [data.data, draft]);

  async function save() {
    if (!draft || !data.data) return;
    setSaving(true);
    try {
      await api.patch(`/api/profiles/${data.data.profile.user_id}`, {
        headline: draft.headline ?? null,
        bio: draft.bio ?? null,
        coverKey: draft.cover_key,
        jobTitle: draft.job_title ?? null,
        brn: draft.brn ?? null,
        whatsapp: draft.whatsapp ?? null,
        publicPhone: draft.public_phone ?? null,
        publicEmail: draft.public_email ?? null,
        instagram: draft.instagram ?? null,
        linkedin: draft.linkedin ?? null,
        languages: asList(draft.languages),
        specialities: asList(draft.specialities),
        isPublic: draft.is_public === 1,
      });
      toast('Profile saved');
      setReloadKey((n) => n + 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not save');
    } finally {
      setSaving(false);
    }
  }

  if (data.error) return <ErrorNote>{data.error}</ErrorNote>;
  if (!data.data || !draft) return <SkeletonRows rows={6} />;

  const { profile, stats, badges, level, editable } = data.data;
  const cardUrl = `/card/${profile.slug}`;

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      await api.upload<{ photoUrl: string }>(`/api/profiles/${profile.user_id}/photo`, file);
      toast('Photo saved');
      setReloadKey((n) => n + 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not upload that');
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto() {
    setUploading(true);
    try {
      await api.del(`/api/profiles/${profile.user_id}/photo`);
      toast('Photo removed');
      setReloadKey((n) => n + 1);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not remove that');
    } finally {
      setUploading(false);
    }
  }
  const earned = badges.filter((badge) => badge.earned);
  const locked = badges.filter((badge) => !badge.earned);

  return (
    <>
      <Toolbar
        right={editable ? (
          <Button variant="primary" icon="save" loading={saving} onClick={() => void save()}>
            Save
          </Button>
        ) : undefined}
      >
        <Chip on icon="user">{profile.name}</Chip>
      </Toolbar>

      <div className="dash">
        <Panel span={8} index={1} icon="user" title="Profile">
          <div className="profile-head">
            {profile.photo_url ? (
              <img className="profile-photo" src={profile.photo_url} alt={profile.name} width={64} height={64} />
            ) : (
              <Avatar name={profile.name} size={64} />
            )}
            <div>
              <h2>{profile.name}</h2>
              <p className="muted">
                {profile.job_title ?? humanize(profile.role)}
                {profile.brn ? ` · BRN ${profile.brn}` : ''}
              </p>
              <span className="level-pill">
                {level.level} · {level.earned} of {level.of} badges
              </span>
            </div>
          </div>

          {editable ? (
            <>
              <div className="two">
                <Field label="Job title" hint="Goes on your emails and your card.">
                  <input
                    className="input"
                    value={draft.job_title ?? ''}
                    onChange={(event) => setDraft({ ...draft, job_title: event.target.value })}
                    placeholder="Property Consultant"
                  />
                </Field>
                <Field label="BRN" hint="Required on anything a client sees.">
                  <input
                    className="input"
                    value={draft.brn ?? ''}
                    onChange={(event) => setDraft({ ...draft, brn: event.target.value })}
                  />
                </Field>
              </div>

              <Field label="One line about you" hint="Shown under your name on your card.">
                <input
                  className="input"
                  value={draft.headline ?? ''}
                  onChange={(event) => setDraft({ ...draft, headline: event.target.value })}
                  placeholder="Off-plan in Dubai Marina. I answer in minutes, not days."
                />
              </Field>

              <Field label="About you">
                <TextArea
                  rows={4}
                  value={draft.bio ?? ''}
                  onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
                />
              </Field>

              <div className="two">
                <Field label="Languages" hint="Separate with commas.">
                  <input
                    className="input"
                    value={asList(draft.languages).join(', ')}
                    onChange={(event) => setDraft({
                      ...draft,
                      languages: event.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })}
                    placeholder="English, Arabic"
                  />
                </Field>
                <Field label="What you sell" hint="Separate with commas.">
                  <input
                    className="input"
                    value={asList(draft.specialities).join(', ')}
                    onChange={(event) => setDraft({
                      ...draft,
                      specialities: event.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })}
                    placeholder="Off-plan, Dubai Marina"
                  />
                </Field>
              </div>

              <Field label="Cover" hint="Six to choose from. All drawn for this CRM.">
                <Select
                  value={draft.cover_key ?? 'marina-dusk'}
                  onChange={(event) => setDraft({ ...draft, cover_key: event.target.value })}
                >
                  {covers.data?.items.map((item) => (
                    <option key={item.key} value={item.key}>{item.name}</option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <>
              {profile.headline && <p className="headline">{profile.headline}</p>}
              {profile.bio && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{profile.bio}</p>}
            </>
          )}
        </Panel>

        <Panel span={4} index={2} icon="bar-chart-3" title="How they work">
          <div className="vat-big">
            <div>
              <small>Deals won</small>
              <b>{stats.dealsWon}</b>
            </div>
            <div>
              <small>Viewings</small>
              <b>{stats.appointments}</b>
            </div>
            <div>
              <small>Answers in</small>
              <b>{speed(stats.speedToLeadSeconds)}</b>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Counted from the CRM. Nobody can type these in.
          </p>

          {editable && (
            <>
              <div className="sec-t">Your photo</div>
              {profile.photo_url ? (
                <div className="co-logo">
                  <img src={profile.photo_url} alt="Your photo" />
                  <Button icon="trash-2" size="sm" loading={uploading} onClick={() => void removePhoto()}>
                    Remove it
                  </Button>
                </div>
              ) : (
                <FileDrop
                  accept="image/png,image/jpeg,image/webp"
                  multiple={false}
                  icon="image-up"
                  title="Add your photo"
                  hint="PNG, JPG or WebP, up to 4 MB. A head-and-shoulders photo works best."
                  disabled={uploading}
                  onFiles={(files) => files[0] && void uploadPhoto(files[0])}
                />
              )}
              <Note>
                It is on your business card and at the bottom of every email you send a client.
                Without one they see your initials.
              </Note>

              <div className="sec-t">Your card</div>
              <label className="routing-switch">
                <input
                  type="checkbox"
                  checked={draft.is_public === 1}
                  onChange={(event) => setDraft({ ...draft, is_public: event.target.checked ? 1 : 0 })}
                />
                <div>
                  <b>Share my card publicly</b>
                  <small>
                    Anyone with the link can see your name, photo, number and what you sell.
                    Off means the link shows nothing.
                  </small>
                </div>
              </label>

              {profile.is_public === 1 && (
                <a className="btn" href={cardUrl} target="_blank" rel="noreferrer" style={{ marginTop: 10 }}>
                  <Icon name="external-link" size={14} />
                  Open my card
                </a>
              )}
            </>
          )}
        </Panel>

        <Panel span={12} index={3} icon="trophy" title={`Badges (${earned.length} of ${badges.length})`}>
          <div className="badges">
            {[...earned, ...locked].map((badge) => (
              <div key={badge.key} className={badge.earned ? 'shelf-badge got' : 'shelf-badge'}>
                <span className="badge-icon">
                  <Icon name={badge.icon as IconName} size={18} />
                </span>
                <b>{badge.name}</b>
                <small>{badge.how}</small>
                {!badge.earned && badge.progress !== null && badge.progress > 0 && (
                  <span className="badge-bar">
                    <i style={{ width: `${Math.round(badge.progress * 100)}%` }} />
                  </span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
