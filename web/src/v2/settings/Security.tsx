import { usePhoneHead } from '../phone.js';
import { SettingsShell } from './Shell.js';

/**
 * "Sign-in and security" — `design/screens/Security.dc.html`.
 *
 * The audit found no address for it. A stub so the address exists and no
 * two people have to edit App.tsx. Group C fills it in from the design
 * file, and only with what the server really offers: password change and
 * the session list exist, anything the design draws that does not is left
 * out and written down, never invented.
 */
export function V2SettingsSecurity() {
  usePhoneHead({});
  return (
    <SettingsShell>
      <h1 className="d-sec-label">Sign-in and security</h1>
      <div className="d-card">
        <div className="d-empty"><p className="d-muted">Not built yet.</p></div>
      </div>
    </SettingsShell>
  );
}
