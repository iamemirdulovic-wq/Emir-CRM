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

export type ScoreBreakdown = {
  score: number;
  isHot: boolean;
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

  return { score, isHot: score >= HOT_SCORE_THRESHOLD, components };
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
