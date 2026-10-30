import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';

/**
 * What yesterday actually looked like, at the top of the owner's dashboard.
 *
 * Every line is a counted fact, and the card says so. The AI layer is allowed
 * to rephrase these lines when it is switched on and nothing else — it never
 * sees a number it could change. A dashboard that mixes measured figures with
 * generated ones teaches people to trust neither.
 */

interface Line {
  kind: 'problem' | 'number' | 'good';
  text: string;
}

export function InsightCard() {
  const data = useAsync<{ lines: Line[]; quiet: boolean; source: string }>(
    () => api.get('/api/activity/insight'),
    [],
  );

  if (!data.data || data.data.lines.length === 0) return null;

  return (
    <section className="insight">
      <div className="insight-head">
        <Icon name="sparkles" size={15} />
        Yesterday
        <small>{data.data.source}</small>
      </div>

      <ul className="insight-lines">
        {data.data.lines.map((line) => (
          <li key={line.text} className={line.kind}>
            <Icon
              name={line.kind === 'problem' ? 'alert-triangle' : line.kind === 'good' ? 'trophy' : 'minus'}
              size={13}
            />
            {line.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
