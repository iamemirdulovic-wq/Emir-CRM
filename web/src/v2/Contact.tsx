import { Link, Navigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote } from '../design/ui.js';

/**
 * A person, sent on to their lead.
 *
 * Notifications are written once and read by both front ends, and they carry
 * the person (`/contacts/c-1`) because that is the live CRM's address for
 * them. v2 has no screen for a person on their own — it has a screen for a
 * lead, which is what an agent opens a notification to work on — so this is
 * the one hop between the two.
 *
 * It exists because the alternative was what shipped: `/v2/contacts/c-1`,
 * which the router has never known, so every notification about a lead ended
 * on "That page does not exist".
 *
 * The newest enquiry wins when somebody has more than one, which is the same
 * order the contact's own record returns them in. Search results never come
 * through here: they carry the enquiry's own id and go straight to it.
 */
interface Opportunity {
  id: string;
  created_at: string;
}

interface Contact360 {
  contact: { id: string; full_name: string | null } | null;
  opportunities: Opportunity[];
}

export function V2Contact() {
  const { id = '' } = useParams();
  const detail = useAsync<Contact360>(() => api.get(`/api/contacts/${id}`), [id]);

  if (detail.error) return <ErrorNote>{detail.error}</ErrorNote>;
  if (!detail.data) return <Spinner />;

  const lead = detail.data.opportunities[0];
  if (lead) return <Navigate to={`/v2/leads/${lead.id}`} replace />;

  /* A contact with no enquiry at all. Rare, and a dead end rather than a
     dead link: say so and give a way on. */
  return (
    <div className="p-leads">
      <div className="d-card">
        <div className="d-empty">
          <span className="d-ic"><Icon name="user" /></span>
          <b>{detail.data.contact?.full_name?.trim() || 'This person'} has no lead</b>
          <p>Nothing is in the pipeline for them, so there is no lead page to open.</p>
          <div className="d-btn-row">
            <Link className="d-btn d-primary d-sm" to="/v2/leads">
              <Icon name="users" />My leads
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
