import type { Executor } from '../db/client.js';
import { getPool } from '../db/client.js';
import {
  goldenHourNow, risksNow, whatNow, type PriorityRow, type Viewer,
} from '../ai/rules.js';

/**
 * The answers behind Homes AI's ready questions.
 *
 * Emir's decision of 14 November: no outside AI. Every word here comes from
 * `ai/rules.ts`, which reads only our own database. Nothing is sent anywhere,
 * nothing is generated, and no number is written here that the rules did not
 * work out — §53 asks for at most ten leads, a reason each and the time it was
 * counted, and that is the shape of every answer below.
 */

export const ASKS = ['call-first', 'going-cold', 'needs-me', 'awake-now'] as const;
export type Ask = typeof ASKS[number];

export interface AskLead {
  leadId: string;
  name: string | null;
  phone: string | null;
  project: string | null;
  /** 0–100, with the flame band the card already uses. */
  heat: number;
  band: string;
  /** One line, why this one. */
  why: string;
  /** Where it opens. */
  to: string;
}

export interface AskAnswer {
  /** The question, as the button says it. */
  asked: string;
  /** The headline sentence. */
  say: string;
  leads: AskLead[];
  /** How many there are in total, when more than the ten shown. */
  total: number;
  /** "Counted now, 19:00" — §53. */
  countedAt: string;
  /** Only when there is a list worth starting. */
  startCalling: boolean;
}

const MAX = 10;

/** Dubai is UTC+4 all year; `v2/dubai.ts` makes the same assumption. */
function dubaiClock(now: Date): string {
  const d = new Date(now.getTime() + 4 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function toLead(row: PriorityRow): AskLead {
  return {
    leadId: row.leadId,
    name: row.name,
    phone: row.phone,
    project: row.project,
    heat: row.heat.score,
    band: row.heat.band,
    why: row.doThis ? `${row.why} · ${row.doThis}` : row.why,
    to: `/v2/leads/${row.leadId}`,
  };
}

function answer(
  asked: string,
  say: string,
  rows: PriorityRow[],
  now: Date,
  startCalling = true,
): AskAnswer {
  return {
    asked,
    say,
    leads: rows.slice(0, MAX).map(toLead),
    total: rows.length,
    countedAt: `Counted now, ${dubaiClock(now)}`,
    startCalling: startCalling && rows.length > 0,
  };
}

const none = (asked: string, say: string, now: Date): AskAnswer =>
  answer(asked, say, [], now, false);

/**
 * Answer one of the ready questions.
 *
 * Every read is fenced by `Viewer` inside `rules.ts` — an agent asking gets
 * only their own leads, a manager their team's. That is checked there and
 * tested there; this file never widens it.
 */
export async function ask(
  viewer: Viewer,
  what: Ask,
  now: Date = new Date(),
  exec: Executor = getPool(),
): Promise<AskAnswer> {
  if (what === 'awake-now') {
    /* `whatNow().now` is already the awake ones — that is what the brain
       means by `now`. Golden hour supplies only the headline, so the list
       and the sentence cannot disagree about who is callable. */
    const [plan, golden] = await Promise.all([
      whatNow(viewer, { now }, exec),
      goldenHourNow(viewer, { now }, exec),
    ]);
    if (plan.now.length === 0) {
      return none('Who is awake now?', 'Nobody on your list is in a decent hour to ring right now.', now);
    }
    const closing = golden.countries[0];
    const soonest = [...plan.now].sort(
      (a, b) => (a.minutesLeftAwake ?? 1e9) - (b.minutesLeftAwake ?? 1e9),
    );
    return answer(
      'Who is awake now?',
      closing
        ? `${plan.now.length} to ring now. ${closing.flag} ${closing.name} closes first — ${closing.left}.`
        : `${plan.now.length} to ring now.`,
      soonest,
      now,
    );
  }

  if (what === 'needs-me' && viewer.role !== 'agent') {
    const risks = await risksNow(viewer, { now }, exec);
    const all = [...risks.leads, ...risks.agents];
    if (all.length === 0) {
      return none('What needs me now?', 'Nothing needs you. No lead is at risk and nobody is stuck.', now);
    }
    return {
      asked: 'What needs me now?',
      say: `${all.length} thing${all.length === 1 ? '' : 's'} need you.`,
      leads: risks.leads.slice(0, MAX).map((r) => ({
        leadId: r.leadId ?? '',
        name: null,
        phone: null,
        project: null,
        heat: 0,
        band: 'warn',
        why: r.sub ? `${r.text} · ${r.sub}` : r.text,
        to: r.to,
      })),
      total: all.length,
      countedAt: `Counted now, ${dubaiClock(now)}`,
      startCalling: false,
    };
  }

  const plan = await whatNow(viewer, { now }, exec);

  if (what === 'going-cold') {
    const cold = plan.now.filter((r) => r.bucket === 'going_cold' || r.alsoIn.includes('going_cold'));
    return cold.length === 0
      ? none('Which of these are going cold?', 'None are going cold. Everybody has been touched recently.', now)
      : answer('Which of these are going cold?',
        `${cold.length} going cold. Oldest first.`, cold, now);
  }

  /* 'call-first', and an agent's 'needs-me', are the same question: the
     priority order the brain already decides. */
  if (plan.now.length === 0) {
    const asleep = plan.asleep.length;
    return none(
      what === 'needs-me' ? 'What needs me now?' : 'Who should I call first?',
      asleep > 0
        ? `Nothing to ring now. ${asleep} ${asleep === 1 ? 'is' : 'are'} asleep where they live.`
        : 'Nothing is waiting. Your list is clear.',
      now,
    );
  }
  const first = plan.now[0] as PriorityRow;
  return answer(
    what === 'needs-me' ? 'What needs me now?' : 'Who should I call first?',
    `${first.name ?? 'This lead'} first — ${first.why}.`,
    plan.now,
    now,
  );
}
