/**
 * Ask Emir AI.
 *
 * The assistant on every CRM screen. It answers from the CRM's own data by
 * calling the read-only tools in `ask-tools.ts` — it has no other way to reach
 * the database, cannot write, and cannot widen the scope it was given, because
 * the scope comes from the session and not from anything it says.
 *
 * The instruction below is doing real work. Three of its rules exist because
 * of how this goes wrong in a brokerage:
 *
 *  - **Never state a price that did not come from `get_projects`.** A number
 *    an agent repeats to a buyer is the brokerage's word, and a model asked
 *    about "Emaar Beachfront" will otherwise recall one.
 *  - **Say what you do not know.** "I could not find that" is a useful answer;
 *    a confident wrong one costs a deal.
 *  - **Never promise on the brokerage's behalf** — no returns, no yields, no
 *    guarantees. That is regulated here.
 */
import { withinCap } from './usage.js';
import { buildKnowledge } from './knowledge.js';
import { setting, secret } from '../config/secrets.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { cachedModels, rankModels, resolveModel } from './models.js';
import { callGemini, candidateNames } from './call-gemini.js';
import { runTool, TOOLS, type Asker } from './ask-tools.js';

/** How many times the model may call a tool before it has to answer. */
const MAX_TOOL_ROUNDS = 4;

const INSTRUCTION = `You are Emir AI, the assistant inside a Dubai and Abu Dhabi off-plan real
estate CRM. You are talking to someone who works at the brokerage.

You answer from the CRM's own data. Use the tools to look things up — you cannot know anything
about this brokerage's leads, agents or projects except through them.

The rules, in order of importance:

1. NEVER state a price, a handover date, a payment plan or an availability that did not come back
   from the get_projects tool. Not one you remember, not one that sounds right. If the tool does
   not have it, say the project's details are not filled in yet.
2. NEVER promise or imply a return, a yield, a rental figure or that a price will rise. That is
   regulated in the UAE and the brokerage carries the liability.
3. If the tools do not answer the question, say so plainly. "I could not find that" is a good
   answer. A confident wrong one costs a deal.
4. The person can only see their own leads unless they are a manager or above. If a tool returns
   nothing, that may be why — say you could not find it, not that it does not exist.
5. Be brief. Two or three sentences unless they asked for a list. Real numbers, not adjectives.
6. When you mention a specific lead, give their name and, if you have it, write the id in square
   brackets like [lead:abc-123] so the CRM can link to them.
7. Answer in the language the question was asked in. Arabic if they wrote Arabic.
8. Never invent a name, a number or a date to make an answer look complete.`;

export type AskResult = {
  answer: string;
  /** Which tools were used, so the answer can be traced to its numbers. */
  toolsUsed: string[];
  model: string;
};

type Part = Record<string, unknown>;

/**
 * Ask a question and get an answer, with as many tool round-trips as it takes.
 *
 * Each round is a separate call, so it is bounded: four is plenty for "which
 * leads should I call first" and stops a model that has got into a loop from
 * spending the month's budget on it.
 */
export async function ask(
  question: string,
  asker: Asker,
  history: { role: 'user' | 'assistant'; body: string }[] = [],
): Promise<AskResult> {
  const apiKey = await secret('GEMINI_API_KEY');
  if (!apiKey) throw badRequest('Emir AI is not connected yet. Ask your admin to add the key in Settings.');
  if (!(await withinCap())) {
    throw badRequest("This month's AI budget is used up. It can be raised in Settings → Emir AI.");
  }

  const available = await cachedModels(apiKey);
  const candidates = candidateNames(
    rankModels(available),
    resolveModel((await setting('AI_MODEL')) ?? null, available),
  );

  // The brokerage's own words, so the answers sound like them.
  const knowledge = await buildKnowledge('ask');

  const contents: { role: string; parts: Part[] }[] = [
    // Only the last few turns: a long thread costs money on every question.
    ...history.slice(-6).map((turn) => ({
      role: turn.role === 'user' ? 'user' : 'model',
      parts: [{ text: turn.body }],
    })),
    { role: 'user', parts: [{ text: question }] },
  ];

  const toolsUsed: string[] = [];
  let model = candidates[0] ?? 'unknown';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await callGemini({
      apiKey,
      candidates,
      feature: 'ask',
      userId: asker.id,
      body: {
        systemInstruction: { parts: [{ text: `${INSTRUCTION}\n\n${knowledge}` }] },
        contents,
        tools: [{ functionDeclarations: TOOLS }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
      },
    });
    model = result.model;

    const calls = result.parts
      .map((part: Record<string, unknown>) => (part as { functionCall?: { name?: string; args?: Record<string, unknown> } }).functionCall)
      .filter((call): call is { name: string; args?: Record<string, unknown> } => Boolean(call?.name));

    if (calls.length === 0) {
      const answer = (result.text ?? '').trim();
      if (!answer) throw badRequest('Emir AI did not answer. Try asking again.');
      return { answer, toolsUsed, model };
    }

    // What it asked for goes back in, then what the tools said.
    contents.push({ role: 'model', parts: result.parts });

    const responses: Part[] = [];
    for (const call of calls) {
      toolsUsed.push(call.name);
      let output: unknown;
      try {
        output = await runTool(call.name, call.args ?? {}, asker);
      } catch (err) {
        // A tool that fails is information, not an outage: tell the model so
        // it can say it could not look that up.
        logger.warn('an ask tool failed', {
          tool: call.name, error: err instanceof Error ? err.message : String(err),
        });
        output = { error: 'That lookup failed.' };
      }
      responses.push({ functionResponse: { name: call.name, response: { result: output } } });
    }
    contents.push({ role: 'user', parts: responses });
  }

  throw badRequest('Emir AI could not settle on an answer. Try asking more simply.');
}
