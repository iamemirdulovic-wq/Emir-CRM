import { usePhoneHead } from './phone.js';

/**
 * "My personal info" — `design/screens/PersonalInfo.dc.html`.
 *
 * The audit found no address for it at all. The settings section list
 * links "My profile · Photo, BRN, card" at `/v2/me`, which until now went
 * nowhere, so this is that screen.
 *
 * A stub so the address exists and no two people have to edit App.tsx.
 * Group C fills it in from the design file.
 */
export function V2PersonalInfo() {
  usePhoneHead({});
  return (
    <div className="p-profile">
      <h1 className="d-sec-label">My personal info</h1>
      <div className="d-card">
        <div className="d-empty"><p className="d-muted">Not built yet.</p></div>
      </div>
    </div>
  );
}
