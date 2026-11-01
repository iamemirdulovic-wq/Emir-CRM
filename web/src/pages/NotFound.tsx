import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../design/index.js';

/**
 * A page that does not exist.
 *
 * Every unknown address used to redirect to the Dashboard without a word,
 * which looks identical to "your link worked and there was nothing in it".
 * A mistyped URL, a stale bookmark and a lead that has been deleted all
 * landed in the same silent place, so nobody could tell which had happened.
 */
export function NotFound() {
  const location = useLocation();

  return (
    <div className="notfound">
      <Icon name="search" />
      <h2>That page does not exist</h2>
      <p>
        Nothing is at <code>{location.pathname}</code>. The link may be old, or
        the lead may have been deleted.
      </p>
      <div className="notfound-actions">
        <Link className="btn btn-primary" to="/dashboard">
          <Icon name="layout-dashboard" />
          Go to the Dashboard
        </Link>
        <Link className="btn" to="/leads">
          <Icon name="users" />
          My Leads
        </Link>
      </div>
    </div>
  );
}
