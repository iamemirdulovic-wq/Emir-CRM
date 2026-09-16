/**
 * Stage and source presentation.
 *
 * The colours and icons are the design's own (`STAGES` and `SRC` in
 * design/emir-crm-design.html), re-keyed to the stage and source values the
 * server actually returns. Everything that draws a stage — board column, card
 * stripe, pill, timeline dot — reads from here, so the seven stage colours
 * cannot drift apart across screens.
 */
import type { IconName } from './Icon.js';
import type { StageKey } from '../lib/types.js';

export interface StageStyle {
  /** A CSS colour token, used as the --c custom property. */
  colour: string;
  icon: IconName;
}

export const STAGE_STYLES: Record<StageKey, StageStyle> = {
  new_lead: { colour: 'var(--s-new)', icon: 'sparkles' },
  attempted_contact: { colour: 'var(--s-att)', icon: 'phone-outgoing' },
  engaged_qualified: { colour: 'var(--s-eng)', icon: 'message-square-heart' },
  appointment_scheduled: { colour: 'var(--s-apt)', icon: 'calendar-days' },
  deal_sent: { colour: 'var(--s-deal)', icon: 'file-signature' },
  won: { colour: 'var(--s-won)', icon: 'trophy' },
  lost: { colour: 'var(--s-lost)', icon: 'circle-x' },
};

export function stageStyle(stage: StageKey | null | undefined): StageStyle {
  return (stage && STAGE_STYLES[stage]) || { colour: 'var(--ink-3)', icon: 'circle' };
}

export interface SourceStyle {
  colour: string;
  icon: IconName;
  label: string;
}

/** Keyed by the LEAD_SOURCES values the server stores. */
export const SOURCE_STYLES: Record<string, SourceStyle> = {
  meta_lead_ads: { colour: '#5B7FB8', icon: 'facebook', label: 'Meta form' },
  meta_ctwa: { colour: 'var(--wa)', icon: 'message-circle', label: 'WhatsApp ad' },
  whatsapp_direct: { colour: 'var(--wa)', icon: 'message-circle', label: 'WhatsApp' },
  google_ads: { colour: '#B98264', icon: 'search', label: 'Google Ads' },
  website: { colour: '#6E8CA0', icon: 'globe', label: 'Website' },
  csv_import: { colour: '#8C9AAE', icon: 'upload', label: 'Imported' },
  manual: { colour: '#8C9AAE', icon: 'pencil', label: 'Added by hand' },
};

export function sourceStyle(source: string | null | undefined): SourceStyle {
  return (
    (source && SOURCE_STYLES[source]) || {
      colour: '#8C9AAE',
      icon: 'circle',
      label: (source ?? 'Unknown').replace(/_/g, ' '),
    }
  );
}

/**
 * A stable colour for an avatar, taken from the design's calm stage palette so
 * a wall of avatars still looks like one picture. The same name always gets the
 * same colour, which is what makes a face recognisable in a list.
 */
const AVATAR_COLOURS = [
  'var(--s-new)', 'var(--s-eng)', 'var(--s-apt)', 'var(--s-att)',
  'var(--s-deal)', 'var(--s-won)', '#6F8FAF', '#7F9C9A', '#9A8FB3', '#B09A7E',
];

export function avatarColour(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length] as string;
}

/** Two initials, from however many words the name has. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first[0]}${(words[words.length - 1] as string)[0]}`.toUpperCase();
}
