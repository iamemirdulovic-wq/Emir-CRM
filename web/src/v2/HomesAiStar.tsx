import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../design/index.js';


/**
 * Homes AI, in the top bar of every screen.
 *
 * It replaced the floating orb on 17 November. The orb had a problem that no
 * amount of styling fixes: it held its own little conversation that answered
 * eight fixed questions and said "still being built" to everything else, while
 * the real assistant sat on a page nobody could find. Emir typed "hello" into
 * the orb and was told Homes AI did not work yet. There is one Homes AI now,
 * and this is the way in.
 *
 * It breathes rather than blinks — slowly, and not at all for anyone who has
 * asked their device to reduce motion. A thing that sits on every screen all
 * day has to be ignorable.
 */
export function HomesAiStar({ compact = false }: { compact?: boolean }) {
  const { pathname } = useLocation();
  /* On the page itself the way in is the page: a button that goes nowhere is
     a button people press twice before they trust anything else. */
  const here = pathname.startsWith('/v2/ai');

  return (
    <Link
      to="/v2/ai"
      className={`v2-aistar${compact ? ' v2-aistar-sm' : ''}${here ? ' v2-aistar-here' : ''}`}
      aria-label="Ask Homes AI"
      aria-current={here ? 'page' : undefined}
      title="Ask Homes AI"
    >
      <span className="v2-aistar-glow" aria-hidden />
      <Icon name="sparkles" size={compact ? 18 : 19} />
    </Link>
  );
}
