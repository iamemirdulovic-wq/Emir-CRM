/**
 * What the notes add up to.
 *
 * An agent coming back to a lead after three weeks has eleven notes to read,
 * written by two people, half of them one line long. The digest is the three
 * lines they would have written themselves if they had had time: what this
 * person wants, where it stands, and the thing not to say.
 *
 * Everything here is pure. The prompt is built from rows, the reply is parsed
 * and checked, and the one rule that matters is enforced in code rather than
 * asked for in the prompt: a figure that is not in the notes does not come out
 * of the digest. A model that invents "budget AED 3M" has invented a client.
 */

export interface NoteForDigest {
  type: string;
  body: string;
  pinned: boolean;
  authorName: string | null;
  createdAt: Date;
}

export interface LeadForDigest {
  name: string | null;
  stage: string;
  subStatus: string | null;
  project: string | null;
  /** The band as the lead stated it, e.g. "1.5M - 2M". Never a figure we worked out. */
  budgetBand: string | null;
  unitType: string | null;
}

export interface NotesDigest {
  /** Up to three short lines. */
  lines: string[];
  /** The thing an agent should not blunder into. Often the most useful part. */
  watchOut: string | null;
  /** Figures the model produced that are not in the notes, dropped and counted. */
  dropped: string[];
}

/** How many notes to feed it. Beyond this the oldest stop mattering. */
export const MAX_NOTES_IN_PROMPT = 40;

export const DIGEST_VERSION = 'v1';

/**
 * The prompt. Pinned notes first because that is what pinning means, then the
 * rest newest-first, which is the order an agent would read them in.
 */
export function buildNotesDigestPrompt(
  lead: LeadForDigest,
  notes: NoteForDigest[],
): { system: string; user: string } {
  const ordered = [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  const body = ordered
    .slice(0, MAX_NOTES_IN_PROMPT)
    .map((note) => {
      const when = note.createdAt.toISOString().slice(0, 10);
      const who = note.authorName ? ` by ${note.authorName}` : '';
      const pin = note.pinned ? ' [PINNED]' : '';
      return `- ${when}${who} (${note.type})${pin}: ${note.body.replace(/\s+/g, ' ').trim().slice(0, 600)}`;
    })
    .join('\n');

  return {
    system:
      'You brief a Dubai and Abu Dhabi off-plan real estate agent on one of their own leads, from the notes their ' +
      'team has written. Reply with JSON only: {"lines": ["...", "...", "..."], "watchOut": "..." or null}. ' +
      'Each line is one short sentence, at most 90 characters, written the way one colleague tells another: ' +
      'what this person is after, where it stands, and what moves it. ' +
      'watchOut is the one thing that would go wrong if the agent forgot it — an objection, a sensitivity, ' +
      'a promise made — or null if the notes do not contain one. ' +
      'CRITICAL: never state a price, a size, a handover date, a payment plan or a percentage that is not ' +
      'written verbatim in the notes below. Do not estimate, convert or round one. Leave it out instead. ' +
      'Do not repeat the stage back; the agent can see it.',
    user:
      `LEAD: ${lead.name ?? 'unnamed'}\n` +
      `STAGE: ${lead.stage}${lead.subStatus ? ` / ${lead.subStatus}` : ''}\n` +
      `PROJECT: ${lead.project ?? 'not stated'}\n` +
      `BUDGET AS STATED: ${lead.budgetBand ?? 'not stated'}\n` +
      `UNIT: ${lead.unitType ?? 'not stated'}\n\n` +
      `NOTES (${ordered.length}):\n${body || '(none)'}`,
  };
}

/**
 * Parse the reply and strip anything ungrounded.
 *
 * `source` is every character the model was given. A figure that does not
 * appear in it was made up, so the line carrying it is dropped — not corrected,
 * because there is no way to know what it should have said.
 */
export function parseNotesDigest(parsed: unknown, source: string): NotesDigest | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed as { lines?: unknown; watchOut?: unknown };

  const candidates = Array.isArray(raw.lines)
    ? raw.lines.filter((line): line is string => typeof line === 'string')
    : [];

  const dropped: string[] = [];
  const lines: string[] = [];
  for (const line of candidates) {
    const cleaned = line.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    const invented = ungroundedFigures(cleaned, source);
    if (invented.length > 0) {
      dropped.push(...invented);
      continue;
    }
    lines.push(cleaned.slice(0, 160));
    if (lines.length === 3) break;
  }

  let watchOut: string | null = null;
  if (typeof raw.watchOut === 'string') {
    const cleaned = raw.watchOut.replace(/\s+/g, ' ').trim();
    const invented = cleaned ? ungroundedFigures(cleaned, source) : [];
    if (invented.length > 0) dropped.push(...invented);
    else if (cleaned && !/^(none|null|n\/a|nothing)$/i.test(cleaned)) watchOut = cleaned.slice(0, 200);
  }

  if (lines.length === 0 && !watchOut) return null;
  return { lines, watchOut, dropped };
}

/**
 * Figures in `text` that are not in `source`.
 *
 * Money, areas, percentages and years — the four kinds of number that get a
 * brokerage into trouble. A bare count ("three calls", "2 bedrooms") is left
 * alone: it is not a claim about the deal.
 */
export function ungroundedFigures(text: string, source: string): string[] {
  const haystack = normaliseFigures(source);
  const found: string[] = [];

  const patterns: RegExp[] = [
    /\bAED\s?[\d.,]+\s?[mk]?\b/gi,
    /\b[\d.,]+\s?(?:million|m)\s?(?:AED|dirhams?)\b/gi,
    /\b[\d.,]+\s?(?:sq\.?\s?ft|sqft|square feet|sq\.?\s?m)\b/gi,
    /\b\d{1,3}(?:\.\d+)?\s?%/g,
    /\b(?:19|20)\d{2}\b/g,
    /\b\d{1,3}\s?\/\s?\d{1,3}\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const figure = normaliseFigures(match[0]);
      if (!haystack.includes(figure)) found.push(match[0].trim());
    }
  }
  return found;
}

/** Same figure, same string: "AED 2.5 M", "aed2.5m" and "AED 2.5M" all match. */
function normaliseFigures(value: string): string {
  return value.toLowerCase().replace(/[\s,]/g, '');
}

/**
 * Is the cached digest out of date?
 *
 * The count is the whole check. Notes are append-only in practice — people add
 * one, they do not rewrite the fourth — so "there are more notes than the
 * digest read" catches every case that matters for the price of a column.
 */
export function digestIsStale(
  cached: { digest: string | null; count: number; at: Date | null },
  noteCount: number,
  now: Date = new Date(),
  maxAgeDays = 30,
): boolean {
  if (noteCount === 0) return false;
  if (!cached.digest || !cached.at) return true;
  if (noteCount !== cached.count) return true;
  return now.getTime() - cached.at.getTime() > maxAgeDays * 24 * 60 * 60 * 1000;
}

/** Store it as one string: three lines, then the warning behind a marker. */
export function packDigest(digest: NotesDigest): string {
  const parts = [...digest.lines];
  if (digest.watchOut) parts.push(`!! ${digest.watchOut}`);
  return parts.join('\n').slice(0, 1000);
}

export function unpackDigest(stored: string | null): { lines: string[]; watchOut: string | null } {
  if (!stored) return { lines: [], watchOut: null };
  const lines: string[] = [];
  let watchOut: string | null = null;
  for (const line of stored.split('\n')) {
    if (line.startsWith('!! ')) watchOut = line.slice(3);
    else if (line.trim()) lines.push(line);
  }
  return { lines, watchOut };
}
