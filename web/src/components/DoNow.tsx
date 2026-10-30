import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon, SkeletonRows } from '../design/index.js';
import type { IconName } from '../design/Icon.js';
import { Empty } from '../design/ui.js';

/**
 * The top of an agent's morning.
 *
 * It replaces a row of charts. An agent opening the CRM at 9am does not need
 * a chart — they need to know which of their ninety leads to ring first, and
 * a chart cannot answer that. Every card here is an instruction with a count
 * and a button that goes to exactly those leads.
 *
 * The order and the words come from the server, so the rule lives in one
 * place and is tested there rather than being re-decided in the browser.
 */

interface Card {
  key: string;
  title: string;
  why: string;
  count: number;
  urgency: 'now' | 'today' | 'soon';
  icon: string;
  href: string;
}

interface DoNowResponse {
  greeting: string;
  cards: Card[];
  allClear?: { title: string; hint: string };
}

interface MyWeek {
  contacted: number;
  appointments: number;
  won: number;
  newLeads: number;
  rank: number | null;
  outOf: number;
}

/**
 * Where this agent stands, said loosely on purpose.
 *
 * "Near the top" rather than "4th of 9". A leaderboard with a number against
 * every name turns a team into a scoreboard, and the person in last place
 * stops opening the dashboard — which is the opposite of what a nudge is for.
 */
function standing(rank: number | null, outOf: number): string | null {
  if (rank === null || outOf < 3) return null;
  if (rank === 1) return 'Most people spoken to this week';
  if (rank <= Math.ceil(outOf / 3)) return 'Near the top this week';
  if (rank <= Math.ceil((outOf * 2) / 3)) return 'Middle of the team this week';
  return 'Quieter week than most';
}

export function DoNow() {
  const data = useAsync<DoNowResponse>(() => api.get('/api/activity/do-now'), []);
  const week = useAsync<MyWeek>(() => api.get('/api/activity/my-week'), []);

  if (!data.data && !data.error) return <SkeletonRows rows={2} />;
  if (!data.data) return null;

  const { greeting, cards, allClear } = data.data;

  return (
    <section className="do-now">
      <h2 className="do-now-greeting">{greeting}</h2>

      {cards.length === 0 && allClear && (
        <Empty icon="check-check" title={allClear.title} hint={allClear.hint} />
      )}

      {week.data && (
        <div className="my-week">
          <span><b>{week.data.newLeads}</b> new</span>
          <span><b>{week.data.contacted}</b> spoken to</span>
          <span><b>{week.data.appointments}</b> booked</span>
          <span><b>{week.data.won}</b> won</span>
          <small>this week</small>
          {standing(week.data.rank, week.data.outOf) && (
            <em>{standing(week.data.rank, week.data.outOf)}</em>
          )}
        </div>
      )}

      {cards.length > 0 && (
        <div className="do-now-cards">
          {cards.map((card, index) => (
            <Link
              key={card.key}
              to={card.href}
              className={`do-now-card u-${card.urgency} rise`}
              style={{ ['--i' as string]: index }}
            >
              <span className="do-now-icon">
                <Icon name={card.icon as IconName} size={18} />
              </span>
              <span className="do-now-body">
                <b>{card.title}</b>
                <small>{card.why}</small>
              </span>
              <Icon name="chevron-right" size={16} />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
