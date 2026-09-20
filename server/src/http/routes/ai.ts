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
import { monthSpend, usd, withinCap } from '../../ai/usage.js';
import { aiProvider } from '../../ai/index.js';
import { env } from '../../config/env.js';
import { encryptionReady } from '../../lib/crypto.js';
import { badRequest } from '../../lib/errors.js';
import { writeAudit } from '../../audit/audit.js';
import {
  clearSecret, saveSecret, saveSetting, secret, secretHint, secretSource, setting, unreadableSecrets,
} from '../../config/secrets.js';
import { GEMINI_BASE, explainGeminiError, listModels, pickDefault, rankModels, readGeminiError } from '../../ai/models.js';

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
        // Empty means "not chosen yet": the screen then offers the list from
        // Google rather than a name this codebase guessed.
        model: (await setting('AI_MODEL')) ?? '',
        // Where the key came from, so the screen can be honest about it rather
        // than implying the owner can change one that is set in the host.
        keySource: await secretSource('GEMINI_API_KEY'),
        keyEndsWith: await secretHint('GEMINI_API_KEY'),
        /*
         * Stored but undecryptable — the encryption key changed underneath it.
         * Worth saying out loud: "not connected" to someone who connected it
         * last week explains nothing, and the cause is almost always a deploy
         * that replaced the folder the key file was sitting in.
         */
        keyUnreadable: (await unreadableSecrets()).includes('GEMINI_API_KEY'),
        capUsd: (await setting('AI_MONTHLY_CAP_USD')) ?? '5',
      },
    });
  }),
);

/**
 * Which models this key can actually use.
 *
 * Exists because the CRM shipped with two model names written into it and the
 * owner's key answered 404 for both. Google renames and retires models on its
 * own schedule, so the only reliable list is the one Google gives back.
 *
 * Rate-limited because it costs a round trip to Google, though not tokens.
 */
aiRouter.get(
  '/models',
  rateLimit({
    max: 20,
    windowMs: 5 * 60 * 1000,
    keyFor: (req) => `ai-models:${currentUser(req).id}`,
    message: 'Checked too many times in a row. Wait a minute.',
  }),
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    const apiKey = await secret('GEMINI_API_KEY');
    if (!apiKey) {
      res.json({ models: [], suggested: null, error: 'No Gemini key is connected yet.' });
      return;
    }

    try {
      const models = await listModels(apiKey);
      res.json({
        models,
        suggested: models.length ? pickDefault(models) : null,
        current: (await setting('AI_MODEL')) ?? null,
      });
    } catch (err) {
      // A failure here is information, not an outage: the screen says what
      // Google answered so the owner can act on it.
      const status = err instanceof Error ? err.message : 'unknown';
      res.json({
        models: [],
        suggested: null,
        error: status === '403' || status === '401'
          ? 'Google would not accept the key. Check it is correct, that the Generative Language API is '
            + 'enabled on that project, and that billing is on.'
          : `Google could not be asked for the model list (${status}).`,
      });
    }
  }),
);

/**
 * Try every model the key offers and report what each one actually does.
 *
 * Built after four rounds of the owner pressing a button, getting a different
 * Google error each time, and sending it to me to interpret. Each error was
 * real and each fix was right, but the loop itself was the problem: the person
 * who can see the failure had no way to see the cause.
 *
 * This asks each model the same two-word question and reports, in plain words,
 * which ones answer. A working model can then be chosen on the spot.
 *
 * The prompts are a few tokens each, so the whole check costs a fraction of a
 * cent, and it is rate-limited so it cannot be leaned on.
 */
aiRouter.post(
  '/diagnose',
  rateLimit({
    max: 6,
    windowMs: 10 * 60 * 1000,
    keyFor: (req) => `ai-diagnose:${currentUser(req).id}`,
    message: 'Checked a few times already. Wait a few minutes.',
  }),
  requireManager,
  asyncHandler(async (req: Request, res: Response) => {
    const apiKey = await secret('GEMINI_API_KEY');
    if (!apiKey) {
      res.json({ ok: false, headline: 'No Gemini key is connected yet.', models: [] });
      return;
    }

    let catalogue;
    try {
      catalogue = await listModels(apiKey);
    } catch (err) {
      const status = err instanceof Error ? err.message : 'unknown';
      res.json({
        ok: false,
        headline: status === '403' || status === '401'
          ? 'Google would not accept the key at all. It is either wrong, or the Generative Language '
            + 'API is switched off for that project.'
          : `Google would not give us the model list (${status}).`,
        models: [],
      });
      return;
    }

    if (catalogue.length === 0) {
      res.json({
        ok: false,
        headline: 'The key works, but Google lists no usable models on it. That usually means the '
          + 'Generative Language API is not enabled on that project.',
        models: [],
      });
      return;
    }

    // The five best; testing forty would cost time and tell us nothing more.
    const toTest = rankModels(catalogue).slice(0, 5);
    const results = [];

    for (const model of toTest) {
      const started = Date.now();
      try {
        const response = await fetch(`${GEMINI_BASE}/models/${model.name}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ready' }] }],
            generationConfig: { maxOutputTokens: 8, temperature: 0 },
          }),
        });

        if (response.ok) {
          results.push({ model: model.name, works: true, ms: Date.now() - started, why: null });
        } else {
          const detail = await readGeminiError(response);
          results.push({
            model: model.name,
            works: false,
            ms: Date.now() - started,
            why: explainGeminiError(response.status, model.name, detail),
          });
        }
      } catch (err) {
        results.push({
          model: model.name,
          works: false,
          ms: Date.now() - started,
          why: `Could not reach Google: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    }

    const working = results.filter((row) => row.works);
    await writeAudit({
      actor: actorFrom(req),
      action: 'ai.diagnosed',
      entityType: 'setting',
      entityId: null,
      after: { tested: results.length, working: working.length },
    });

    res.json({
      ok: working.length > 0,
      headline: working.length > 0
        ? `${working.length} of ${results.length} models answered. Pick one below and press Save.`
        : 'None of the models answered. Every one was refused or busy — see the reasons below. '
          + 'This is almost always a Google project that has no billing on it yet.',
      models: results,
      current: (await setting('AI_MODEL')) ?? null,
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
      feature: 'try',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: body.question },
      ],
      temperature: 0.4,
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
      works = Boolean(await provider.complete({ feature: 'connection_test', messages: [{ role: 'user', content: 'Reply with the single word: ready' }], maxOutputTokens: 8 }));
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
