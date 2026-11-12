import { useAuth } from '../lib/auth.js';

/**
 * A band across the top of the test copy.
 *
 * `newcrm.emirdulovic.com` runs the same code against a copy of the real
 * data, which means it looks exactly like the CRM and contains exactly the
 * same clients. Somebody will have both open on the same phone. This is how
 * they know, in one glance and before typing anything, which one they are in.
 *
 * It cannot be dismissed. A banner you can close is a banner that is closed
 * at the moment it matters.
 */
export function TestCopyBanner() {
  const { isTestCopy } = useAuth();
  if (!isTestCopy) return null;
  return (
    <div className="test-copy-band" role="status">
      <b>TEST VERSION</b>
      <span>The leads here are a copy. Nothing you do reaches a real client.</span>
    </div>
  );
}
