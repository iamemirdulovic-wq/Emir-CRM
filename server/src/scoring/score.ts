import { HOT_SCORE_THRESHOLD } from '../config/constants.js';

/**
 * Lead score, 0–100.
 *
 * Signals: a valid number, budget fit, timeline, a WhatsApp reply, CALL_ME,
 * pricing or brochure requests, re-inquiry, and spam signals. 70 or more is
 * `hot` and triggers a manager push.
 *
 * Pure, so the weights can be reasoned about and tuned against real outcomes.
 */

export type ScoreSignals = {
  hasValidPhone: boolean;
  isMobile: boolean;
  hasEmail: boolean;
  /** Budget stated and inside the range the brokerage actually sells. */
  budgetMinAed: number | null;
  budgetMaxAed: number | null;
  timeline: 'immediate' | '1_3_months' | '3_6_months' | '6_12_months' | '12_plus' | 'unknown';
  purpose: 'investment' | 'end_use' | 'unknown';
  repliedOnWhatsApp: boolean;
  requestedCall: boolean;
  requestedPricing: boolean;
  requestedBrochure: boolean;
  /** Distinct inquiries from the same person. */
  inquiryCount: number;
  goldenVisaInterest: boolean;
  /** Obvious junk: test names, throwaway addresses, gibberish. */
  spamSignals: number;
  /** The number failed validation, or the form was submitted by a bot. */
  invalidNumber: boolean;
};

export type ScoreBand = 'hot' | 'warm' | 'cold';

export type ScoreBreakdown = {
  score: number;
  isHot: boolean;
  band: ScoreBand;
  /** The three things that moved it most, in words an agent can act on. */
  reason: string;
  components: Array<{ signal: string; points: number }>;
};

/** The band the brokerage actually sells in. Outside it, the fit is poorer. */
const TARGET_MIN_AED = 700_000;
const TARGET_MAX_AED = 30_000_000;

export function scoreLead(signals: ScoreSignals): ScoreBreakdown {
  const components: Array<{ signal: string; points: number }> = [];
  const add = (signal: string, points: number) => {
    if (points !== 0) components.push({ signal, points });
  };

  // --- reachability (up to 20) ---
  if (signals.invalidNumber) add('invalid_number', -25);
  else if (signals.hasValidPhone) add('valid_phone', signals.isMobile ? 15 : 10);
  if (signals.hasEmail) add('has_email', 5);

  // --- budget fit (up to 20) ---
  const budget = signals.budgetMaxAed ?? signals.budgetMinAed;
  if (budget !== null) {
    if (budget >= TARGET_MIN_AED && budget <= TARGET_MAX_AED) add('budget_in_range', 20);
    else if (budget < TARGET_MIN_AED) add('budget_below_range', 5);
    else add('budget_above_range', 12);
  }

  // --- intent to transact (up to 20) ---
  switch (signals.timeline) {
    case 'immediate':
      add('timeline_immediate', 20);
      break;
    case '1_3_months':
      add('timeline_1_3_months', 15);
      break;
    case '3_6_months':
      add('timeline_3_6_months', 8);
      break;
    case '6_12_months':
      add('timeline_6_12_months', 4);
      break;
    case '12_plus':
      add('timeline_12_plus', 1);
      break;
    default:
      break;
  }
  if (signals.purpose === 'investment') add('purpose_investment', 5);
  else if (signals.purpose === 'end_use') add('purpose_end_use', 4);

  // --- engagement (up to 35) ---
  if (signals.repliedOnWhatsApp) add('replied_on_whatsapp', 15);
  if (signals.requestedCall) add('requested_call', 15);
  if (signals.requestedPricing) add('requested_pricing', 8);
  if (signals.requestedBrochure) add('requested_brochure', 5);

  // --- repeat interest ---
  if (signals.inquiryCount > 1) add('re_inquiry', Math.min(10, (signals.inquiryCount - 1) * 5));
  if (signals.goldenVisaInterest) add('golden_visa_interest', 5);

  // --- penalties ---
  if (signals.spamSignals > 0) add('spam_signals', -15 * signals.spamSignals);

  const raw = components.reduce((total, c) => total + c.points, 0);
  const score = Math.max(0, Math.min(100, raw));

  return {
    score,
    isHot: score >= HOT_SCORE_THRESHOLD,
    band: bandFor(score),
    reason: explain(components, signals),
    components,
  };
}

/**
 * Three bands, because an agent deciding who to call next is making a
 * three-way choice, not reading a percentage.
 */
export function bandFor(score: number): ScoreBand {
  if (score >= HOT_SCORE_THRESHOLD) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

/**
 * The score in words: "Budget AED 2.5M · ready now · replied on WhatsApp".
 *
 * A number out of a hundred tells an agent who to call first. It does not tell
 * them what to open with, and that is the part that decides how the call goes.
 * Only what the lead actually told us appears here — a missing budget is left
 * out rather than guessed at.
 */
function explain(components: Array<{ signal: string; points: number }>, signals: ScoreSignals): string {
  const parts: string[] = [];

  const budget = signals.budgetMaxAed ?? signals.budgetMinAed;
  if (budget !== null) parts.push(`Budget ${aed(budget)}`);

  const TIMELINE: Record<string, string> = {
    immediate: 'ready now',
    '1_3_months': 'buying in 1–3 months',
    '3_6_months': 'buying in 3–6 months',
    '6_12_months': 'buying in 6–12 months',
    '12_plus': 'buying in a year or more',
  };
  const timeline = TIMELINE[signals.timeline];
  if (timeline) parts.push(timeline);

  if (signals.requestedCall) parts.push('asked for a call');
  else if (signals.repliedOnWhatsApp) parts.push('replied on WhatsApp');
  else if (signals.requestedPricing) parts.push('asked for prices');
  else if (signals.requestedBrochure) parts.push('asked for the brochure');

  if (signals.inquiryCount > 1) parts.push(`enquired ${signals.inquiryCount} times`);
  if (signals.goldenVisaInterest) parts.push('Golden Visa');

  /* The problems matter more than the positives, so they go first and are
     never crowded out by a long list of good news. */
  const warnings: string[] = [];
  if (signals.invalidNumber) warnings.push('number did not validate');
  if (signals.spamSignals > 0) warnings.push('looks like junk');
  else if (!signals.hasValidPhone && !signals.hasEmail) warnings.push('no way to reach them');
  else if (!signals.hasValidPhone) warnings.push('no phone number');

  const said = [...warnings, ...parts.slice(0, 3)];
  if (said.length === 0) return 'Nothing to go on yet';
  return said.join(' · ').slice(0, 255);
}

/** AED 2,500,000 is a number to count; AED 2.5M is a number to say out loud. */
function aed(amount: number): string {
  if (amount >= 1_000_000) {
    return `AED ${(amount / 1_000_000).toFixed(amount % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  return `AED ${Math.round(amount / 1_000)}K`;
}

/** Cheap heuristics for obvious junk, before anything is sent. */
export function detectSpamSignals(input: {
  fullName: string | null;
  email: string | null;
  phoneValid: boolean;
  notes: string | null;
}): number {
  let signals = 0;

  const name = (input.fullName ?? '').trim().toLowerCase();
  if (name && /^(test|testing|asdf|qwerty|aaa+|xxx+|abc|na|n\/a|none|. )$/.test(name)) signals += 1;
  // A "name" with no vowels and no Arabic letters is almost always keyboard mash.
  if (name.length >= 5 && !/[aeiou؀-ۿ]/.test(name)) signals += 1;

  const email = (input.email ?? '').toLowerCase();
  if (email && /@(mailinator|guerrillamail|10minutemail|yopmail|tempmail|trashmail)\./.test(email)) signals += 1;
  if (email && /^(test|asdf|noreply|no-reply)@/.test(email)) signals += 1;

  if (!input.phoneValid && !email) signals += 1;

  return signals;
}
