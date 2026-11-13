import { usePhoneHead } from './phone.js';

/**
 * "VIP leads I gave" — `design/screens/OwnerAssign.dc.html`.
 *
 * The audit found this one read as a dialog on Incoming and built as
 * nothing. It is a whole owner screen: *who took the VIP leads I handed
 * out, and how fast* — All / Needs you / Going well tabs, a row per
 * hand-off with who holds it and how long it has been sitting.
 *
 * A stub so the address exists and no two people have to edit App.tsx.
 * Group A fills it in from the design file.
 */
export function V2VipGiven() {
  usePhoneHead({ sub: 'Owner · who took them and how fast' });
  return (
    <div className="p-incoming">
      <h1 className="d-sec-label">VIP leads I gave</h1>
      <div className="d-card">
        <div className="d-empty"><p className="d-muted">Not built yet.</p></div>
      </div>
    </div>
  );
}
