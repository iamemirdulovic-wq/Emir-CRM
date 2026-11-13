import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth.js';
import { Icon, type IconName } from '../../design/index.js';

/**
 * The settings shell: the section list on the left, one panel on the right.
 *
 * Ported from the `.set` / `.set-nav` markup that every one of the design's
 * settings pages shares (`design/web/settings.html`, `company.html`,
 * `settings-team.html`, `settings-attendance.html`, `ai-settings.html`). The
 * nav is identical on all of them with only the `.on` link moving, so it
 * lives here once rather than in each panel.
 *
 * The design marks the office links `data-only="owner"`. That is honoured
 * here by not rendering them, and again on the server by each endpoint — a
 * nav that hides a link is a tidier screen, not a permission.
 */

interface Section {
  to: string;
  icon: IconName;
  label: string;
  ownerOnly?: boolean;
}

const MINE: Section[] = [
  { to: '/v2/settings', icon: 'settings', label: 'General' },
  { to: '/v2/settings/notifications', icon: 'bell', label: 'Notifications' },
  { to: '/v2/me', icon: 'user', label: 'My profile' },
  { to: '/v2/settings/phone-app', icon: 'download', label: 'Phone app' },
];

const OFFICE: Section[] = [
  { to: '/v2/settings/team', icon: 'users', label: 'Team and roles', ownerOnly: true },
  { to: '/v2/settings/attendance', icon: 'pin', label: 'Attendance rules', ownerOnly: true },
  { to: '/v2/settings/automations', icon: 'zap', label: 'Automations', ownerOnly: true },
  { to: '/v2/settings/company', icon: 'building', label: 'Company', ownerOnly: true },
  { to: '/v2/settings/banners', icon: 'megaphone', label: 'Home banners', ownerOnly: true },
  { to: '/v2/settings/ai', icon: 'sparkles', label: 'Homes AI', ownerOnly: true },
  { to: '/v2/settings/health', icon: 'shield', label: 'System health', ownerOnly: true },
  { to: '/v2/settings/feedback', icon: 'inbox', label: 'Feedback inbox', ownerOnly: true },
];

/**
 * @param page the `p-*` class of the design page this panel came from. Each
 *   settings page in the design carries its own `<style>` block, ported and
 *   scoped to one class; a panel that does not name its own gets Settings'
 *   and loses its layout. The Company page's two-column grid is what caught
 *   this: the preview column sat under the form instead of beside it.
 */
export function SettingsShell({
  children, page = 'p-settings',
}: { children: ReactNode; page?: string }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const inOffice = user?.role === 'owner' || user?.role === 'admin';

  /* `/v2/settings` is the General panel, so it must not light up for every
     page beneath it — an exact match for that one, prefix for the rest. */
  const isHere = (to: string) =>
    to === '/v2/settings' ? pathname === to || pathname === `${to}/` : pathname.startsWith(to);

  const link = (one: Section) => (
    <Link key={one.to} to={one.to} className={isHere(one.to) ? 'd-on' : undefined}>
      <Icon name={one.icon} />
      {one.label}
    </Link>
  );

  return (
    <div className={`d-set ${page}`}>
      <nav className="d-set-nav" aria-label="Settings sections">
        <div className="d-set-label">Mine</div>
        {MINE.map(link)}
        {inOffice && (
          <>
            <div className="d-set-label">Office</div>
            {OFFICE.map(link)}
          </>
        )}
        <Link className="d-set-out" to="/logout">
          <Icon name="log-out" />
          Sign out
        </Link>
      </nav>
      {children}
    </div>
  );
}

/** The heading every panel opens with, plus an optional action on the right. */
export function SettingsTitle({
  title, note, children,
}: { title: string; note: string; children?: ReactNode }) {
  return (
    <div className="d-set-title">
      <div className="d-grow">
        <h1>{title}</h1>
        <p>{note}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * One row of a settings card: what it is on the left, the controls on the right.
 *
 * `.set-row` in the design, which lays the label column out at a fixed width
 * and lets the controls take the rest.
 */
export function SettingsRow({
  label, note, children,
}: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="d-set-row">
      <div className="d-lab">
        <b>{label}</b>
        {note && <span>{note}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/**
 * A switch with its own line, as `.switch-row`.
 *
 * Disabled when the person may not change it, and `alwaysOn` renders the
 * design's orange "always on" chip rather than a switch that does nothing —
 * a control that silently refuses is worse than no control.
 */
export function SettingsSwitch({
  on, title, note, disabled, alwaysOn, chip, onChange,
}: {
  on: boolean;
  title: string;
  note?: string;
  disabled?: boolean;
  alwaysOn?: boolean;
  chip?: ReactNode;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="d-switch-row">
      <div className="d-txt">
        <b>{title}</b>
        {note && <span>{note}</span>}
      </div>
      {chip}
      {alwaysOn && <span className="d-chip d-orange">always on</span>}
      <label className="d-switch">
        <input
          type="checkbox"
          checked={on}
          disabled={disabled || alwaysOn}
          aria-label={title}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="d-track" />
      </label>
    </div>
  );
}

/**
 * The bar at the foot of a settings form.
 *
 * `.set-savebar` in the design. It carries the one line that says what the
 * change will do, which is the part people read.
 */
export function SaveBar({
  note, dirty, busy, onUndo, onSave, saveLabel = 'Save', children,
}: {
  note: ReactNode;
  dirty: boolean;
  busy?: boolean;
  onUndo?: () => void;
  onSave: () => void;
  saveLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="d-set-savebar">
      <span className="d-small d-muted d-grow">{note}</span>
      {children}
      {onUndo && (
        <button type="button" className="d-btn d-ghost" disabled={!dirty || busy} onClick={onUndo}>
          Undo changes
        </button>
      )}
      <button type="button" className="d-btn d-primary" disabled={!dirty || busy} onClick={onSave}>
        {busy ? 'Saving…' : saveLabel}
      </button>
    </div>
  );
}
