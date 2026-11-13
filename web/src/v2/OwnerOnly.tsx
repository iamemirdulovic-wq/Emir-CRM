import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { Icon } from '../design/index.js';

/**
 * The gate on every owner page.
 *
 * The owner typed `/v2/import`, `/v2/settings/team`, `/v2/settings/automations`
 * and `/v2/settings/company` into the address bar while signed in as an agent,
 * and every one of them opened. The server refused the data behind them, so
 * what an agent actually saw was the page frame and a red line reading "This
 * action requires one of: owner, admin" — which tells them nothing, and reads
 * like the CRM is broken rather than like a door that is not theirs.
 *
 * This is what they see instead: the design's own block, with a way out.
 *
 * It is a screen, not a permission. The permission is on the server, on every
 * endpoint, and stays there — a page that hides a button is tidiness. Both are
 * needed and neither replaces the other.
 */
export function OwnerOnly({ children, page = 'p-settings' }: { children: ReactNode; page?: string }) {
  const { user } = useAuth();
  const mayOpen = user?.role === 'owner' || user?.role === 'admin';
  if (mayOpen) return <>{children}</>;

  return (
    <div className={page}>
      <div className="d-card">
        <div className="d-empty">
          <span className="d-ic"><Icon name="lock" /></span>
          <b>Only for owners and admin</b>
          <p>
            You are signed in as an agent. This page is not in your menu and you cannot
            open it. Your own work is under My Day and My leads.
          </p>
          <div className="d-btn-row">
            <Link className="d-btn d-primary d-sm" to="/v2">Go to My Day</Link>
            <Link className="d-btn d-sm" to="/v2/leads"><Icon name="users" />My leads</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
