/**
 * What the AI costs, and the ceiling it cannot go past.
 *
 * The owner asked for this to stay cheap and set a low monthly cap. A cap that
 * is only a number in Settings is a wish; this is the part that makes it true —
 * every call is recorded, and the next one is refused once the month's spend
 * reaches the limit.
 *
 * Money is kept in micro-dollars as integers. Floats drift, and a total that
 * drifts is exactly the thing a spending cap must not do.
 */
import { setting } from '../config/secrets.js';
import { execute, getPool, queryOne, type Executor } from '../db/client.js';
import { newId } from '../lib/ids.js';
import { logger } from '../lib/logger.js';

const MICROS_PER_DOLLAR = 1_000_000;

/**
 * Price per million tokens, in micro-dollars.
 *
 * These are a *local estimate* used to enforce the owner's cap — Google's own
 * billing is the real number, and published prices change. They are set
 * deliberately a little high: a cap that stops slightly early costs nothing,
 * while one that stops late has already spent the money.
 */
const PRICE: [prefix: string, price: { input: number; output: number }][] = [
  // Longest prefix first: 'gemini-2.5-flash-lite' must win over 'gemini-2.5-flash'.
  ['gemini-2.5-flash-lite', { input: 120_000, output: 450_000 }],
  ['gemini-2.0-flash-lite', { input: 75_000, output: 300_000 }],
  ['gemini-flash-lite', { input: 120_000, output: 450_000 }],
  ['gemini-2.5-flash', { input: 350_000, output: 2_600_000 }],
  ['gemini-2.0-flash', { input: 100_000, output: 400_000 }],
  ['gemini-1.5-flash', { input: 100_000, output: 400_000 }],
  ['gemini-flash', { input: 350_000, output: 2_600_000 }],
  ['gemini-2.5-pro', { input: 1_400_000, output: 11_000_000 }],
  ['gemini-1.5-pro', { input: 1_400_000, output: 11_000_000 }],
  ['gemini-pro', { input: 1_400_000, output: 11_000_000 }],
  ['gpt-4o-mini', { input: 200_000, output: 800_000 }],
  ['gpt-4o', { input: 3_000_000, output: 12_000_000 }],
];

/**
 * An unknown model is priced as the dearest one we know of.
 *
 * Not a middling guess: Pro costs roughly twelve times Flash, so a fallback
 * set between them would let a Pro call spend most of the month's budget
 * before the cap noticed. Over-estimating an unknown model stops the CRM
 * slightly early, which costs nothing.
 */
const FALLBACK_PRICE = { input: 1_400_000, output: 11_000_000 };

/**
 * Matched by prefix, because Google ships dated releases
 * (`gemini-2.5-flash-lite-preview-09-2025`) that an exact-name table misses —
 * and a miss used to mean the cheapest model in the list was billed at the
 * fallback rate, or an expensive one at far less than it costs.
 */
export function estimateCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const match = PRICE.find(([prefix]) => model.startsWith(prefix));
  const price = match?.[1] ?? FALLBACK_PRICE;
  return Math.ceil((inputTokens * price.input + outputTokens * price.output) / 1_000_000);
}

/**
 * Rough token count for text.
 *
 * Four characters per token is the usual English approximation. Arabic runs
 * denser, so this under-counts it — which is why the divisor is 3 rather than
 * 4: over-estimating spend keeps the cap honest.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export type MonthSpend = { micros: number; calls: number; capMicros: number; remaining: number };

/** What has been spent this calendar month, against the cap. */
export async function monthSpend(exec: Executor = getPool()): Promise<MonthSpend> {
  // The cap can be changed from Settings as well as the environment, so it is
  // read the same way everything else is.
  const capUsd = Number((await setting('AI_MONTHLY_CAP_USD', exec)) ?? 5);
  const capMicros = Math.round((Number.isFinite(capUsd) ? capUsd : 5) * MICROS_PER_DOLLAR);
  const row = await queryOne<{ micros: string | null; calls: number }>(
    `SELECT COALESCE(SUM(cost_micros), 0) AS micros, COUNT(*) AS calls
       FROM ai_usage
      WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')`,
    [],
    exec,
  );
  const micros = Number(row?.micros ?? 0);
  return { micros, calls: Number(row?.calls ?? 0), capMicros, remaining: Math.max(0, capMicros - micros) };
}

/**
 * May another call be made?
 *
 * Checked before the request goes out, not after: the point is to not spend the
 * money, and a check that runs afterwards has already spent it.
 */
export async function withinCap(exec: Executor = getPool()): Promise<boolean> {
  const spend = await monthSpend(exec);
  if (spend.capMicros <= 0) return true; // 0 means no cap
  return spend.micros < spend.capMicros;
}

export async function recordUsage(
  input: {
    userId: string | null;
    feature: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    ok?: boolean;
  },
  exec: Executor = getPool(),
): Promise<void> {
  const cost = estimateCostMicros(input.model, input.inputTokens, input.outputTokens);
  await execute(
    `INSERT INTO ai_usage (id, user_id, feature, model, input_tokens, output_tokens, cost_micros, ok)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId(), input.userId, input.feature, input.model, input.inputTokens, input.outputTokens, cost, input.ok === false ? 0 : 1],
    exec,
  );

  // Warn once the month is nearly gone, so the owner hears it from the CRM
  // rather than from Google.
  const spend = await monthSpend(exec);
  if (spend.capMicros > 0 && spend.micros >= spend.capMicros * 0.8) {
    logger.warn('AI spend is near the monthly cap', {
      spentUsd: (spend.micros / MICROS_PER_DOLLAR).toFixed(2),
      capUsd: (spend.capMicros / MICROS_PER_DOLLAR).toFixed(2),
    });
  }
}

export function usd(micros: number): string {
  return (micros / MICROS_PER_DOLLAR).toFixed(2);
}
