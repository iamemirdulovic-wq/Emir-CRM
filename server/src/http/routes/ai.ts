/**
 * Emir AI: what it knows, what it has cost, and a box to try it in.
 *
 * Owner, admin and managers may edit the knowledge — the owner's decision. It
 * changes what every agent's AI says, which is why it is not open to agents and
 * why every save is audited and the previous text is kept.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rate-limit.js';
import {
  actorFrom, blockUntilPasswordChanged, currentUser, requireAdmin, requireAuth, requireManager,
} from '../middleware/auth.js';
import {
  SECTIONS, buildKnowledge, completeness, loadKnowledge, restoreVersion, saveSection, sectionHistory,
} from '../../ai/knowledge.js';
import { estimateTokens, monthSpend, recordUsage, usd, withinCap } from '../../ai/usage.js';
import { aiProvider } from '../../ai/index.js';
import { env } from '../../config/env.js';
import { encryptionReady } from '../../lib/crypto.js';
import { badRequest } from '../../lib/errors.js';
import { clearSecret, saveSecret, saveSetting, secretHint, secretSource, setting } from '../../config/secrets.js';

export const aiRouter = Router();
aiRouter.use(requireAuth, blockUntilPasswordChanged);

/** The screen: the section definitions, what is saved, and the spend so far. */
aiRouter.get(
  '/knowledge',
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    const rows = await loadKnowledge();
    const spend = await monthSpend();
    res.json({
      sections: SECTIONS,
      values: rows,
      completeness: completeness(rows),
      spend: {
        spentUsd: usd(spend.micros),
        capUsd: usd(spend.capMicros),
        calls: spend.calls,
        capped: spend.capMicros > 0 && spend.micros >= spend.capMicros,
      },
      // Whether a key is configured at all — the screen says so plainly rather
      // than letting the Try box fail with something cryptic.
      // Resolved the same way a real call resolves it, so the screen cannot
      // say "ready" about a key the request path would not find.
      provider: {
        name: (await setting('AI_PROVIDER')) ?? 'none',
        ready: (await aiProvider()).enabled,
        model: (await setting('AI_MODEL')) ?? 'gemini-2.0-flash-lite',
        // Where the key came from, so the screen can be honest about it rather
        // than implying the owner can change one that is set in the host.
        keySource: await secretSource('GEMINI_API_KEY'),
        keyEndsWith: await secretHint('GEMINI_API_KEY'),
        capUsd: (await setting('AI_MONTHLY_CAP_USD')) ?? '5',
      },
    });
  }),
);

const saveSchema = z.object({
  language: z.enum(['en', 'ar']).default('en'),
  content: z.string().max(8000),
});

aiRouter.put(
  '/knowledge/:section',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const body = saveSchema.parse(req.body);
    await saveSection(actorFrom(req), String(req.params.section), body.language, body.content);
    res.json({ ok: true });
  }),
);

aiRouter.get(
  '/knowledge/:section/history',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const language = req.query.language === 'ar' ? 'ar' : 'en';
    res.json({ items: await sectionHistory(String(req.params.section), language) });
  }),
);

aiRouter.post(
  '/knowledge/restore/:versionId',
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    await restoreVersion(actorFrom(req), String(req.params.versionId));
    res.json({ ok: true });
  }),
);

/**
 * The Try box: ask something and see the answer the knowledge produces, before
 * it is in front of a client.
 *
 * Rate-limited and counted against the same cap as everything else — a test is
 * a real call and costs real money.
 */
const tryLimit = rateLimit({
  max: 20,
  windowMs: 10 * 60 * 1000,
  keyFor: (req) => `ai-try:${currentUser(req).id}`,
  message: 'Too many test questions in a short time. Please wait a few minutes.',
});

aiRouter.post(
  '/try',
  requireManager,
  tryLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const user = currentUser(req);
    const body = z.object({
      question: z.string().trim().min(1).max(500),
      feature: z.enum(['draft', 'ask', 'verdict', 'brief']).default('draft'),
      language: z.enum(['en', 'ar']).default('en'),
    }).parse(req.body);

    const provider = await aiProvider();
    if (!provider.enabled) {
      throw badRequest('No AI key is configured yet. Add GEMINI_API_KEY and set AI_PROVIDER=gemini, then restart.');
    }
    if (!(await withinCap())) {
      const spend = await monthSpend();
      throw badRequest(`This month's AI budget of $${usd(spend.capMicros)} is used up. Raise the cap in the environment settings to continue.`);
    }

    const knowledge = await buildKnowledge(body.feature, body.language);
    const system = [
      'You are Emir AI, the assistant inside a Dubai and Abu Dhabi off-plan real estate CRM.',
      'Answer as this brokerage would, using what you are told below about them.',
      knowledge,
    ].join('\n\n');

    const answer = await provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: body.question },
      ],
      temperature: 0.4,
    });

    const model = (await setting('AI_MODEL')) ?? 'gemini-2.0-flash-lite';
    await recordUsage({
      userId: user.id,
      feature: 'try',
      model,
      inputTokens: estimateTokens(system + body.question),
      outputTokens: estimateTokens(answer ?? ''),
      ok: Boolean(answer),
    });

    res.json({
      answer: answer ?? null,
      // Shown under the answer so the cost of a long knowledge base is visible
      // while it is being written, rather than at the end of the month.
      knowledgeChars: knowledge.length,
      spend: usd((await monthSpend()).micros),
    });
  }),
);

/* ── The connection: key, model and budget, without a redeploy ─────────── */

const connectionSchema = z.object({
  // Never logged, never returned. Written straight to AES-256-GCM.
  apiKey: z.string().trim().min(10).max(400).optional(),
  model: z.string().trim().max(64).optional(),
  monthlyCapUsd: z.number().min(0).max(1000).optional(),
  enabled: z.boolean().optional(),
});

/**
 * Owner and admin only — this is a credential that spends money. Managers may
 * write the knowledge, which is a different kind of decision.
 */
aiRouter.put(
  '/connection',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const body = connectionSchema.parse(req.body);
    const actor = actorFrom(req);

    if (body.apiKey) {
      /*
       * Encryption now looks after itself: with no ENCRYPTION_KEY set, one is
       * created on disk the first time it is needed. This only fires when the
       * environment supplies a key that is the wrong length — a real mistake
       * the owner has to correct, rather than something to work around.
       */
      if (!encryptionReady()) {
        throw badRequest(
          'The ENCRYPTION_KEY in your hosting settings is not a valid key — it must be 64 hex '
          + 'characters. Correct it and restart, or remove it entirely and the CRM will look after '
          + 'its own key.',
        );
      }
      await saveSecret(actor, 'GEMINI_API_KEY', body.apiKey);
    }
    if (body.model !== undefined) await saveSetting(actor, 'AI_MODEL', body.model || null);
    if (body.monthlyCapUsd !== undefined) await saveSetting(actor, 'AI_MONTHLY_CAP_USD', String(body.monthlyCapUsd));
    if (body.enabled !== undefined) await saveSetting(actor, 'AI_PROVIDER', body.enabled ? 'gemini' : 'none');

    // Prove it works before saying it does — a key that is merely stored is not
    // a key that answers.
    const provider = await aiProvider();
    let works: boolean | null = null;
    if (provider.enabled) {
      works = Boolean(await provider.complete({ messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxOutputTokens: 8 }));
    }

    res.json({ ok: true, ready: provider.enabled, works });
  }),
);

aiRouter.delete(
  '/connection',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    await clearSecret(actorFrom(req), 'GEMINI_API_KEY');
    await saveSetting(actorFrom(req), 'AI_PROVIDER', 'none');
    res.json({ ok: true });
  }),
);

/** What the AI has cost this month, by feature. */
aiRouter.get(
  '/usage',
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    const spend = await monthSpend();
    res.json({ spentUsd: usd(spend.micros), capUsd: usd(spend.capMicros), calls: spend.calls });
  }),
);
