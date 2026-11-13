import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { useAuth } from '../../lib/auth.js';
import { Icon, type IconName } from '../../design/index.js';
import { Avatar, useToast } from '../../design/ui.js';
import { useAppearance, useGlassReduced, type Appearance } from '../../design/theme.js';
import { SettingsRow, SettingsShell, SettingsTitle } from './Shell.js';
import type { Notify } from './notify.js';

/**
 * Settings → General.
 *
 * Ported from `design/web/settings.html`, the General panel: appearance as
 * three preview cards, sounds with a test button, language, the fixed
 * date-and-time facts, the office shortcuts, and the account row.
 *
 * Two things here save to different places on purpose. The theme and the
 * glass setting are this *browser's*, kept in `localStorage`, because the
 * same person wants dark on their phone at night and light on the office
 * screen. The sounds are the *person's*, kept on the server with the rest of
 * their notification choices, because a sound they switched off should stay
 * off wherever they sign in.
 */

const THEMES: Array<{ value: Appearance; preview: string; title: string; note: string }> = [
  { value: 'light', preview: '', title: 'Light', note: 'Bright office' },
  { value: 'dark', preview: 'd-dk', title: 'Dark', note: 'Easy at night' },
  { value: 'system', preview: 'd-au', title: 'Auto', note: 'Follows this computer' },
];

const VOLUMES: Array<{ value: number; label: string }> = [
  { value: 0.04, label: 'Quiet' },
  { value: 0.12, label: 'Normal' },
  { value: 0.3, label: 'Loud' },
];

export function V2SettingsGeneral() {
  const { user } = useAuth();
  const inOffice = user?.role === 'owner' || user?.role === 'admin';

  return (
    <SettingsShell>
      <div className="d-set-body">
        <SettingsTitle title="General" note="How the CRM looks and sounds on this computer." />
        <Appearance_ />
        <SoundsAndLanguage />
        {inOffice && <OfficeShortcuts />}
        <AccountRow />
      </div>
    </SettingsShell>
  );
}

/* ── appearance ────────────────────────────────────────────────────────── */

function Appearance_() {
  const { appearance, resolved, setAppearance } = useAppearance();
  const [glassReduced, setGlassReduced] = useGlassReduced();
  const toast = useToast();

  const note = appearance === 'system'
    ? `Auto · this computer is ${resolved} now`
    : `${appearance === 'dark' ? 'Dark' : 'Light'} theme`;

  return (
    <section className="d-card">
      <div className="d-card-head">
        <h3>Appearance</h3>
        <span className="d-small d-muted">{note}</span>
      </div>
      <div className="d-th-grid">
        {THEMES.map((one) => (
          <button
            key={one.value}
            type="button"
            className={appearance === one.value ? 'd-th d-on' : 'd-th'}
            aria-pressed={appearance === one.value}
            onClick={() => {
              setAppearance(one.value);
              toast(one.value === 'system'
                ? 'Theme follows this computer'
                : `${one.title} theme is on`);
            }}
          >
            {/* The design draws a miniature of the CRM rather than a swatch:
                a colour chip does not tell anybody what dark mode looks like. */}
            <span className={one.preview ? `d-th-pre ${one.preview}` : 'd-th-pre'} aria-hidden>
              <i /><b /><u /><em />
            </span>
            <span className="d-th-lab">
              <b>{one.title}</b>
              <span>{one.note}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="d-switch-row" style={{ paddingBottom: 0 }}>
        <div className="d-txt">
          <b>Reduce the glass effect</b>
          <span>Turn on if the CRM feels slow on this computer or phone</span>
        </div>
        <label className="d-switch">
          <input
            type="checkbox"
            checked={glassReduced}
            aria-label="Reduce the glass effect"
            onChange={(e) => {
              setGlassReduced(e.target.checked);
              toast(e.target.checked ? 'Glass effect reduced' : 'Glass effect is back on');
            }}
          />
          <span className="d-track" />
        </label>
      </div>
    </section>
  );
}

/* ── sounds, language, clock ───────────────────────────────────────────── */

/**
 * The new-lead sound, made here rather than fetched.
 *
 * Two rising notes, which is what the design's own script plays. A bundled
 * audio file would be one more thing to load on a phone for a sound that is
 * four lines of arithmetic.
 */
function playBeep(volume: number) {
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    for (const [hz, at] of [[660, 0], [880, 0.13]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(volume, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.24);
    }
  } catch {
    /* No audio on this device, or the browser wants a gesture it did not get.
       A settings screen that throws because a test sound failed is worse than
       a test sound that does not play. */
  }
}

function SoundsAndLanguage() {
  const got = useAsync<Notify>(() => api.get('/api/v2/notify'), []);
  const [draft, setDraft] = useState<Notify | null>(null);
  const toast = useToast();
  /* The first load must not fire a save; only a click should. */
  const loaded = useRef(false);

  useEffect(() => {
    if (got.data) {
      setDraft(got.data);
      loaded.current = true;
    }
  }, [got.data]);

  async function change(patch: Partial<Notify>) {
    if (!draft) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    /* Saved on the tap, like the design: there is no Save button on this card
       and a switch that needs one gets left half-set. */
    try {
      await api.put('/api/v2/notify', patch);
    } catch {
      setDraft(draft);
      toast('That did not save. Try again.');
    }
  }

  if (!draft) return null;

  return (
    <section className="d-card">
      <SettingsRow label="Sounds" note="A short sound when something needs you.">
        <div className="d-switch-row" style={{ paddingTop: 0 }}>
          <div className="d-txt">
            <b>Play sounds</b>
            <span>Turn off for a silent CRM</span>
          </div>
          <button
            type="button"
            className="d-btn d-sm"
            onClick={() => {
              if (!draft.sounds) {
                toast('Sounds are off. Turn them on first.');
                return;
              }
              playBeep(draft.volume);
              toast('This is the new lead sound');
            }}
          >
            <Icon name="play" />Test sound
          </button>
          <label className="d-switch">
            <input
              type="checkbox"
              checked={draft.sounds}
              aria-label="Play sounds"
              onChange={(e) => {
                void change({ sounds: e.target.checked });
                toast(e.target.checked ? 'Sounds are on' : 'Sounds are off');
              }}
            />
            <span className="d-track" />
          </label>
        </div>

        {/* Dimmed rather than hidden, so it is clear what turning sounds back
            on would restore. */}
        <div className={draft.sounds ? undefined : 'v2-set-dim'}>
          <div className="d-switch-row">
            <div className="d-txt">
              <b>New lead and VIP lead</b>
              <span>Two rising notes</span>
            </div>
            <label className="d-switch">
              <input
                type="checkbox"
                checked={draft.soundNewLead}
                disabled={!draft.sounds}
                aria-label="Sound for a new lead and a VIP lead"
                onChange={(e) => void change({ soundNewLead: e.target.checked })}
              />
              <span className="d-track" />
            </label>
          </div>
          <div className="d-switch-row">
            <div className="d-txt">
              <b>Won · unit booked</b>
              <span>With confetti</span>
            </div>
            <label className="d-switch">
              <input
                type="checkbox"
                checked={draft.soundWon}
                disabled={!draft.sounds}
                aria-label="Sound when a unit is booked"
                onChange={(e) => void change({ soundWon: e.target.checked })}
              />
              <span className="d-track" />
            </label>
          </div>
          <div className="d-switch-row" style={{ paddingBottom: 0 }}>
            <div className="d-txt">
              <b>Volume</b>
              <span>For all CRM sounds</span>
            </div>
            <div className="d-seg" role="group" aria-label="Volume">
              {VOLUMES.map((one) => (
                <button
                  key={one.value}
                  type="button"
                  className={draft.volume === one.value ? 'd-on' : undefined}
                  disabled={!draft.sounds}
                  onClick={() => {
                    void change({ volume: one.value });
                    playBeep(one.value);
                  }}
                >
                  {one.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </SettingsRow>

      <SettingsRow
        label="Language"
        note="For menus and buttons. Lead notes stay as you wrote them."
      >
        <div className="d-opt-list v2-set-two">
          <button type="button" className="d-opt d-on">
            <span className="d-card-icon">EN</span>
            <span className="d-grow">
              <b className="d-bold">English</b>
              <div className="d-small d-muted">Used now</div>
            </span>
            <Icon name="check" />
          </button>
          <button
            type="button"
            className="d-opt"
            onClick={() => toast('Arabic comes in a later phase. The CRM stays in English for now.')}
          >
            <span className="d-card-icon">ع</span>
            <span className="d-grow">
              <b className="d-bold">العربية</b>
              <div className="d-small d-muted">Arabic · comes later</div>
            </span>
            <span className="d-chip">later</span>
          </button>
        </div>
      </SettingsRow>

      {/* Facts rather than controls: these are the same for the whole office
          and there is nothing here for one person to change. */}
      <SettingsRow label="Date and time" note="The same for the whole office.">
        <div className="d-row d-wrap d-gap-8">
          <span className="d-chip d-lg"><Icon name="clock" />24-hour clock · {clockNow()}</span>
          <span className="d-chip d-lg"><Icon name="globe" />Dubai time</span>
          <span className="d-chip d-lg"><Icon name="calendar-days" />Week starts on Monday</span>
        </div>
      </SettingsRow>
    </section>
  );
}

/** Dubai's wall clock, which is UTC+4 all year and has no daylight saving. */
function clockNow(): string {
  const now = new Date(Date.now() + 4 * 3600_000);
  return `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
}

/* ── the office shortcuts ──────────────────────────────────────────────── */

interface Shortcut {
  to: string;
  icon: IconName;
  label: string;
  /** The design shows a live fact under each one, not a description. */
  detail: (s: Summary) => string;
}

interface Summary {
  people: number;
  notifyOn: number;
  attendance: { start: string; end: string; graceMinutes: number; enabled: boolean };
  automations: { on: number; total: number };
  company: { missing: number };
  ai: { spentUsd: string; capUsd: string };
  health: { ok: number; total: number };
  feedback: { open: number };
}

const SHORTCUTS: Shortcut[] = [
  {
    to: '/v2/settings/team', icon: 'users', label: 'Team and roles',
    detail: (s) => `${s.people} people · ${s.notifyOn} have notifications on`,
  },
  {
    to: '/v2/settings/attendance', icon: 'pin', label: 'Attendance rules',
    detail: (s) => (s.attendance.enabled
      ? `Shift ${s.attendance.start} – ${s.attendance.end} · late after ${s.attendance.graceMinutes} min`
      : 'Off · no office network set yet'),
  },
  {
    to: '/v2/settings/automations', icon: 'zap', label: 'Automations',
    detail: (s) => `${s.automations.on} of ${s.automations.total} switched on`,
  },
  {
    to: '/v2/settings/company', icon: 'building', label: 'Company',
    detail: (s) => (s.company.missing === 0
      ? 'Logo, names, ORN, TRN, address'
      : `${s.company.missing} detail${s.company.missing === 1 ? '' : 's'} still missing`),
  },
  {
    to: '/v2/settings/ai', icon: 'sparkles', label: 'Homes AI',
    detail: (s) => `$${s.ai.spentUsd} of $${s.ai.capUsd} used this month`,
  },
  {
    to: '/v2/settings/health', icon: 'shield', label: 'System health',
    detail: (s) => `${s.health.ok} of ${s.health.total} services are set up`,
  },
  {
    to: '/v2/settings/feedback', icon: 'inbox', label: 'Feedback inbox',
    detail: (s) => ((s.feedback?.open ?? 0) === 0
      ? 'Bugs and ideas from the team'
      : `${s.feedback?.open ?? 0} waiting for an answer`),
  },
];

function OfficeShortcuts() {
  const got = useAsync<Summary>(() => api.get('/api/v2/settings-summary'), []);

  return (
    <section className="d-card">
      <div className="d-card-head">
        <h3>Office settings</h3>
        <span className="d-chip"><Icon name="lock" />Owners and admin</span>
      </div>
      <div className="d-office-grid">
        {SHORTCUTS.map((one) => (
          <Link className="d-shortcut" key={one.to} to={one.to}>
            <Icon name={one.icon} />
            <span className="d-grow">
              {one.label}
              {/* Until the numbers arrive the line is left out rather than
                  filled with a placeholder that reads as real. */}
              <small>{got.data ? one.detail(got.data) : ' '}</small>
            </span>
            <Icon name="arrow-right" />
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ── who is signed in ─────────────────────────────────────────────────── */

function AccountRow() {
  const { user } = useAuth();
  return (
    <section className="d-card v2-set-account">
      <Avatar name={user?.name ?? null} size={48} src={user?.photoUrl ?? undefined} />
      <div className="d-grow">
        <b className="d-bold">{user?.name}</b>
        <div className="d-small d-muted">{user?.email} · signed in on this computer</div>
      </div>
      <Link className="d-btn" to="/v2/me"><Icon name="lock" />Security</Link>
      <Link className="d-btn d-danger" to="/logout"><Icon name="log-out" />Sign out</Link>
    </section>
  );
}
