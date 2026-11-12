import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { Icon } from '../design/index.js';
import { Spinner, ErrorNote } from '../design/ui.js';

/**
 * The project library.
 *
 * `docs/v2/pages.md` §18, reading the library the live CRM already holds —
 * one set of projects, not two. The rule from CLAUDE.md that matters most is
 * negative: **nothing on this screen is a price, a handover or a plan that
 * did not come out of the `projects` table.** A missing figure is left blank.
 * The AI, the WhatsApp replies and the offer builder all read the same rows.
 */

interface Card {
  id: string;
  slug: string | null;
  name: string;
  developer: string | null;
  emirate: string | null;
  community: string | null;
  property_type: string | null;
  sale_status: 'selling_now' | 'coming_soon' | 'sold_out' | null;
  starting_price_aed: number | null;
  handover_date: string | null;
  payment_plan: string | null;
  image_url: string | null;
  cover_photo_id: string | null;
  starred: number;
  units_available: number;
  units_total: number;
}

const STATUS: Record<string, { label: string; chip: string }> = {
  selling_now: { label: 'Selling now', chip: 'd-green' },
  coming_soon: { label: 'Coming soon', chip: 'd-amber' },
  sold_out: { label: 'Sold out', chip: '' },
};

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'emirate=Dubai', label: 'Dubai' },
  { key: 'emirate=Abu Dhabi', label: 'Abu Dhabi' },
  { key: 'status=selling_now', label: 'Selling now' },
  { key: 'status=coming_soon', label: 'Coming soon' },
  { key: 'starred=1', label: 'Our picks' },
];

export function V2Projects() {
  const [filter, setFilter] = useState('');
  const [find, setFind] = useState('');

  const qs = useMemo(() => {
    const next = new URLSearchParams(filter);
    if (find.trim()) next.set('search', find.trim());
    return next.toString();
  }, [filter, find]);

  const list = useAsync<{ items: Card[] }>(() => api.get(`/api/library?${qs}`), [qs]);

  return (
    <div className="v2-projects">
      <header className="v2-inc-head">
        <h1 className="v2-hi">Projects</h1>
        <p className="d-muted">
          Every price, plan and handover date the CRM will ever quote comes from here.
        </p>
      </header>

      <div className="v2-leads-bar">
        <label className="v2-find">
          <Icon name="search" />
          <input type="search" value={find} placeholder="Project, developer or community"
            onChange={(e) => setFind(e.target.value)} />
        </label>
      </div>

      <div className="v2-tabs" role="tablist">
        {FILTERS.map((one) => (
          <button key={one.label} type="button" role="tab" aria-selected={filter === one.key}
            className={filter === one.key ? 'v2-tab-b v2-tab-b-on' : 'v2-tab-b'}
            onClick={() => setFilter(one.key)}>
            {one.label}
          </button>
        ))}
      </div>

      {list.error && <ErrorNote>{list.error}</ErrorNote>}
      {!list.data && !list.error && <Spinner />}

      {list.data && list.data.items.length === 0 && (
        <div className="v2-empty">
          <span className="v2-empty-mark"><Icon name="building" /></span>
          <h2>Nothing here</h2>
          <p>
            {find.trim() || filter
              ? 'Nothing matches that. Try another filter.'
              : 'No projects in the library yet. They are added on the old Projects screen.'}
          </p>
          <Link className="d-btn d-primary" to="/projects">Open the old library</Link>
        </div>
      )}

      <ul className="v2-proj-grid">
        {(list.data?.items ?? []).map((one) => (
          <li key={one.id}>
            <Link to={`/projects/${one.id}`} className="d-card v2-proj">
              <span
                className="v2-proj-photo"
                style={cover(one) ? { backgroundImage: `url(${cover(one)})` } : undefined}
              >
                {!cover(one) && <Icon name="building" />}
                {one.starred === 1 && <span className="v2-proj-star"><Icon name="star" /></span>}
              </span>

              <span className="v2-proj-body">
                <b>{one.name}</b>
                <span className="v2-proj-sub">
                  {[one.developer, one.community, one.emirate].filter(Boolean).join(' · ') || '—'}
                </span>

                <span className="v2-proj-facts">
                  <span>
                    <i>From</i>
                    {one.starting_price_aed ? aed(one.starting_price_aed) : '—'}
                  </span>
                  <span>
                    <i>Handover</i>
                    {one.handover_date
                      ? new Date(one.handover_date).toLocaleDateString('en-GB', {
                        month: 'short', year: 'numeric',
                      })
                      : '—'}
                  </span>
                  <span>
                    <i>Plan</i>
                    {one.payment_plan ?? '—'}
                  </span>
                </span>

                <span className="v2-proj-foot">
                  {one.sale_status && (
                    <span className={`d-chip ${STATUS[one.sale_status]?.chip ?? ''}`}>
                      {STATUS[one.sale_status]?.label ?? one.sale_status}
                    </span>
                  )}
                  <span className="v2-proj-units">
                    {one.units_total > 0
                      ? `${one.units_available} of ${one.units_total} left`
                      : 'No unit list yet'}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The cover photo.
 *
 * A project may carry an uploaded photo (served by id) or a link somebody
 * pasted. Neither is required, and a card with no photo shows the building
 * mark rather than a broken image.
 */
function cover(card: Card): string | null {
  if (card.cover_photo_id) return `/api/library/photos/${card.cover_photo_id}`;
  return card.image_url ?? null;
}

/** "AED 1.4M", "AED 940,000" — the way an agent says it out loud. */
function aed(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `AED ${millions.toFixed(millions % 1 === 0 ? 0 : 1)}M`;
  }
  return `AED ${value.toLocaleString()}`;
}
