import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Link } from 'react-router-dom';

interface Item {
  key: string;
  title: string;
  consequence: string;
  ready: boolean;
  to: string;
}

/**
 * The things that are not switched on yet, said once.
 *
 * Each of these fails quietly and separately: an email recorded as not sent
 * inside a conversation nobody reopens, a WhatsApp follow-up that never goes
 * because no template was approved, a lead alert that only arrives if the CRM
 * is already open, and an AI that answers every question with a key error.
 *
 * Four silences look like four mysteries. One list looks like an afternoon's
 * work. Owner and admin only, because nobody else can do anything about it.
 */
export function SetupChecklist() {
  const { data } = useAsync<{ items: Item[]; outstanding: number }>(
    () => api.get('/api/integrations/setup-checklist'),
    [],
  );

  if (!data || data.outstanding === 0) return null;
  const missing = data.items.filter((item) => !item.ready);

  return (
    <section className="setup-check" aria-label="Setup still needed">
      <header>
        <Icon name="alert-triangle" />
        <div>
          <b>
            {missing.length === 1
              ? 'One thing is not switched on yet'
              : `${missing.length} things are not switched on yet`}
          </b>
          <span>Until they are, these parts of the CRM stay silent rather than telling anyone.</span>
        </div>
      </header>
      <ul>
        {missing.map((item) => (
          <li key={item.key}>
            <Link to={item.to}>
              <b>{item.title}</b>
              <span>{item.consequence}</span>
              <Icon name="chevron-right" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
