import { HOT_SCORE_THRESHOLD } from '../config/constants.js';
import { bandFor, type ScoreBand, type ScoreBreakdown } from './score.js';

/**
 * The AI's second opinion on a lead, and the limits on it.
 *
 * The rules score what the lead *said*: a budget, a timeline, a valid number.
 * They cannot score how somebody writes — "can you call me now, I fly Sunday"
 * and "ok thanks" are the same to a weights table and are not remotely the
 * same lead. That is what the nightly pass is for.
 *
 * What the AI is not allowed to do is run the pipeline. So:
 *  - it moves a score, it does not set one, and never by more than 20;
 *  - a verdict it is not confident about moves nothing;
 *  - it can never make a lead with no working phone number hot;
 *  - "junk" is a suggestion with a button, never a closed lead.
 *
 * All pure, so the limits are the tests rather than a comment nobody reads.
 */

export const AI_VERDICTS = ['hot', 'good', 'weak', 'junk'] as const;
export type AiVerdict = (typeof AI_VERDICTS)[number];

export const REFINE_VERSION = 'v1';

/** The most the AI may move a score, up or down. */
export const MAX_ADJUSTMENT = 20;

/** Below this the model is guessing, so it changes nothing. */
export const MIN_CONFIDENCE = 0.5;

/** What each verdict is worth before confidence is applied. */
const BASE: Record<AiVerdict, number> = {
  hot: 18,
  good: 6,
  weak: -12,
  junk: -30,
};

export interface RefineInput {
  /** What the weights table said, 0–100. */
  ruleScore: number;
  verdict: AiVerdict;
  /** 0–1 from the model. Anything outside is treated as the nearest end. */
  confidence: number;
  /** No valid phone and no email: nobody can act on this lead however keen it reads. */
  unreachable: boolean;
}

export interface RefineResult {
  score: number;
  /** What was actually applied, after confidence and the cap. */
  adjustment: number;
  band: ScoreBand;
  verdict: AiVerdict;
  /** True when a limit bit, and which, so the result can explain itself. */
  limited: 'none' | 'confidence' | 'cap' | 'unreachable';
  /**
   * Junk, confidently. The UI offers "mark invalid" and an agent presses it.
   * Nothing in the system acts on this by itself.
   */
  suggestInvalid: boolean;
}

export function refineScore(input: RefineInput): RefineResult {
  const ruleScore = clamp(Math.round(input.ruleScore), 0, 100);
  const confidence = clamp(input.confidence, 0, 1);

  let limited: RefineResult['limited'] = 'none';
  let adjustment = 0;

  if (confidence < MIN_CONFIDENCE) {
    limited = 'confidence';
  } else {
    const scaled = Math.round(BASE[input.verdict] * confidence);
    adjustment = clamp(scaled, -MAX_ADJUSTMENT, MAX_ADJUSTMENT);
    if (Math.abs(scaled) > MAX_ADJUSTMENT) limited = 'cap';
  }

  let score = clamp(ruleScore + adjustment, 0, 100);

  /*
   * The one veto. A lead that cannot be reached is not hot, whatever it wrote,
   * because "hot" in this CRM means a manager gets a push and somebody drops
   * what they are doing. There is nothing to drop everything for.
   */
  if (input.unreachable && score >= HOT_SCORE_THRESHOLD) {
    score = HOT_SCORE_THRESHOLD - 1;
    adjustment = score - ruleScore;
    limited = 'unreachable';
  }

  return {
    score,
    adjustment,
    band: bandFor(score),
    verdict: input.verdict,
    limited,
    suggestInvalid: input.verdict === 'junk' && confidence >= 0.8,
  };
}

/**
 * A verdict from the rules alone, for the days AI is switched off — which for
 * this brokerage is most of them, and certainly every day before the owner
 * pastes a key in. The chip on the card has to say something.
 */
export function verdictFromRules(breakdown: Pick<ScoreBreakdown, 'score' | 'components'>): AiVerdict {
  const components = new Map(breakdown.components.map((c) => [c.signal, c.points]));
  if (components.has('spam_signals') || components.has('invalid_number')) return 'junk';
  if (breakdown.score >= HOT_SCORE_THRESHOLD) return 'hot';
  if (breakdown.score >= 40) return 'good';
  return 'weak';
}

/** The model's reply, validated. Anything off-shape is no verdict at all. */
export function parseVerdict(
  parsed: unknown,
): { verdict: AiVerdict; confidence: number; why: string | null } | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = parsed as { verdict?: unknown; confidence?: unknown; why?: unknown };

  const verdict = typeof raw.verdict === 'string' ? raw.verdict.trim().toLowerCase() : '';
  if (!isVerdict(verdict)) return null;

  const confidence =
    typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? clamp(raw.confidence, 0, 1) : 0.5;

  const why = typeof raw.why === 'string' && raw.why.trim() ? raw.why.replace(/\s+/g, ' ').trim().slice(0, 255) : null;

  return { verdict, confidence, why };
}

export function isVerdict(value: string): value is AiVerdict {
  return (AI_VERDICTS as readonly string[]).includes(value);
}

export interface RescoreCandidate {
  /** Null when the AI has never looked at this lead. */
  scoredAt: Date | null;
  /** Last time anything at all happened on it. */
  lastActivityAt: Date | null;
  status: string;
  createdAt: Date;
}

/** How stale a verdict has to be before it is worth spending a call on. */
export const RESCORE_AFTER_DAYS = 7;
/** Past this, the lead is cold history and not worth a nightly call. */
export const RESCORE_IGNORE_AFTER_DAYS = 45;

/**
 * Is this lead worth a model call tonight?
 *
 * The sweep runs on a cap, so this is really "who first". Open leads that
 * something happened to recently, oldest verdict first. A lead nobody has
 * touched in six weeks is not going to be re-read by a model into life.
 */
export function shouldRescore(lead: RescoreCandidate, now: Date = new Date()): boolean {
  if (lead.status !== 'open') return false;

  const lastTouch = lead.lastActivityAt ?? lead.createdAt;
  const idleDays = (now.getTime() - lastTouch.getTime()) / DAY_MS;
  if (idleDays > RESCORE_IGNORE_AFTER_DAYS) return false;

  if (lead.scoredAt === null) return true;
  /* Something happened after the last verdict: that is new evidence. */
  if (lead.lastActivityAt !== null && lead.lastActivityAt.getTime() > lead.scoredAt.getTime()) return true;

  return (now.getTime() - lead.scoredAt.getTime()) / DAY_MS >= RESCORE_AFTER_DAYS;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How a verdict reads, and what colour it wears. */
export const VERDICT_LABEL: Record<AiVerdict, string> = {
  hot: 'Hot',
  good: 'Good',
  weak: 'Weak',
  junk: 'Junk',
};

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}
