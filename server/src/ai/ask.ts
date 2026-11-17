/**
 * Ask Homes AI.
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
import Anthropic from '@anthropic-ai/sdk';
import { recordUsage, withinCap } from './usage.js';
import { buildKnowledge } from './knowledge.js';
import { setting, secret } from '../config/secrets.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { claudeModel, explain } from './anthropic.js';
import { runTool, TOOLS, type Asker, type Draft } from './ask-tools.js';
import { aiFeatureOn } from './features.js';
import { AI_NAME, AI_SETTINGS } from './name.js';

/** How many times the model may call a tool before it has to answer. */
const MAX_TOOL_ROUNDS = 4;

const INSTRUCTION = `You are ${AI_NAME}, the assistant inside a Dubai and Abu Dhabi off-plan real
estate CRM. You are talking to someone who works at the brokerage — usually a sales agent in the
middle of their day. Be their assistant, not a search box: say what you would do next and why,
and offer to write the message rather than waiting to be asked twice.

You answer from the CRM's own data. Use the tools to look things up — you cannot know anything
about this brokerage's leads, agents or projects except through them.

The rules, in order of importance:

1. NEVER state a price, a handover date, a payment plan or an availability for one of OUR projects
   that did not come back from the get_projects tool. Not one you remember, not one that sounds
   right, and NEVER one you found on the web. If the tool does not have it, say the project's
   details are not filled in yet. The web is for what the market is doing; get_projects is the
   only source for what we are selling and at what price.
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
8. Never invent a name, a number or a date to make an answer look complete.
9. When they ask you to write, draft or prepare a message for a lead, call draft_message. Do not
   type the message into your reply as well — the CRM shows the draft as a card with a Send
   button, so repeating it just makes them read it twice. Say one line about why you wrote it
   that way, and stop. Write in the language that lead speaks.
10. You never send anything. A draft goes to the agent, who reads it, changes it and sends it
   themselves. Never say or imply that you have sent, messaged or contacted anyone.
11. web_search is for the market outside this CRM: what is selling in Dubai and Abu Dhabi,
   developer news, area trends, rules and fees. Use it when the question is about the market
   rather than about us, and when you genuinely do not know — not to check something the tools
   already answered.
12. Anything you got from the web, say so in the same sentence and name the source: "Property
   Monitor says…", "according to Bayut…". Say the date it refers to. A market figure with no
   source is worse than no answer, because an agent will repeat it to a buyer as ours.
13. Never put a web figure into a message you draft for a client. Drafts may carry our own
   project's numbers from get_projects, and nothing else.`;

export type AskResult = {
  answer: string;
  /** Which tools were used, so the answer can be traced to its numbers. */
  toolsUsed: string[];
  model: string;
  /** Messages it wrote for a person to send. Never sent by us. */
  drafts: Draft[];
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
  const apiKey = await secret('CLAUDE_API_KEY');
  if (!apiKey) {
    throw badRequest(`${AI_NAME} is not connected yet. Ask your admin to add the key in ${AI_SETTINGS}.`);
  }
  if (!(await withinCap())) {
    throw badRequest(`This month\u2019s AI budget is used up. It can be raised in ${AI_SETTINGS}.`);
  }

  const model = claudeModel(await setting('AI_MODEL'));
  const client = new Anthropic({ apiKey });

  /* The same declarations, in Claude's spelling. `parameters` is already a
     JSON Schema object, which is exactly what `input_schema` wants, so the
     tools themselves did not have to change when the provider did. */
  const tools: Anthropic.ToolUnion[] = TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  }));

  /*
   * The web, when the owner leaves it on.
   *
   * `web_search_20250305` on purpose rather than a newer variant: from
   * `web_search_20260209` onwards the tool defaults to being callable only
   * from inside code execution, and a model without that returns a 400. The
   * basic one is the one that works on every model this setting can name.
   *
   * It runs on Anthropic's side — nothing here fetches a page — and it costs
   * about a fil a search, counted below against the owner's monthly cap.
   */
  const onTheWeb = await aiFeatureOn('web');
  if (onTheWeb) {
    tools.push({
      type: 'web_search_20250305',
      name: 'web_search',
      /* Three is enough for "what sold in Marina last month" and is the
         difference between a question and an afternoon's browsing. */
      max_uses: 3,
      user_location: { type: 'approximate', country: 'AE', city: 'Dubai', timezone: 'Asia/Dubai' },
    });
  }

  // The brokerage's own words, so the answers sound like them.
  const knowledge = await buildKnowledge('ask');

  const messages: Anthropic.MessageParam[] = [
    // Only the last few turns: a long thread costs money on every question.
    ...history.slice(-6).map((turn) => ({
      role: turn.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: turn.body,
    })),
    { role: 'user', content: question },
  ];

  const toolsUsed: string[] = [];
  const drafts: Draft[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let reply: Anthropic.Message;
    try {
      /* No `temperature` and no `thinking`: Claude Haiku 5.5 refuses a
         non-default sampling value outright, and the models differ on which
         `thinking` settings they accept. Sending neither works on all of
         them, which matters because the model is a setting. */
      reply = await client.messages.create({
        model,
        max_tokens: 1200,
        system: `${INSTRUCTION}\n\n${knowledge}`,
        messages,
        tools,
      });
    } catch (err) {
      /* Plain English, every time. The owner can read the exact error under
         Settings → Homes AI → Test the key; nobody is shown raw JSON here. */
      const failure = explain(err, model);
      logger.warn('Homes AI call failed', { error: failure.detail });
      throw badRequest(failure.say);
    }

    await recordUsage({
      userId: asker.id,
      feature: 'ask',
      model,
      inputTokens: reply.usage.input_tokens,
      outputTokens: reply.usage.output_tokens,
      /* Billed per search, not per token, so the cap has to be told. */
      searches: reply.usage.server_tool_use?.web_search_requests ?? 0,
      ok: true,
    });

    /*
     * A long search can pause the turn. The answer is not finished and there
     * is nothing for us to do: hand the same content straight back and let it
     * carry on. Treating this as "no tool calls, so it must be the answer"
     * would cut it off mid-search and show the half of it that exists.
     */
    if (reply.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: reply.content });
      continue;
    }

    const calls = reply.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    /* "Read: the web" under the answer, the same as every other source. An
       answer from outside the CRM must never look like one from inside it. */
    if (reply.content.some((block) => block.type === 'web_search_tool_result')
      && !toolsUsed.includes('the web')) {
      toolsUsed.push('the web');
    }

    if (calls.length === 0) {
      const answer = reply.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      if (!answer) throw badRequest(`${AI_NAME} did not answer. Try asking again.`);
      return { answer, toolsUsed, model, drafts };
    }

    // What it asked for goes back in, then what the tools said.
    messages.push({ role: 'assistant', content: reply.content });

    /* Every result in ONE user message. Splitting them across several teaches
       the model to stop asking for more than one at a time. */
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      toolsUsed.push(call.name);
      try {
        const output = await runTool(call.name, (call.input ?? {}) as Record<string, unknown>, asker);
        /* A draft is the one tool result the page needs as well as the model:
           it becomes a card with a Send button, not a paragraph of text. */
        const made = (output as { draft?: Draft } | null)?.draft;
        if (made) drafts.push(made);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(output),
        });
      } catch (err) {
        // A tool that fails is information, not an outage: tell the model so
        // it can say it could not look that up.
        logger.warn('an ask tool failed', {
          tool: call.name, error: err instanceof Error ? err.message : String(err),
        });
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: 'That lookup failed.',
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  throw badRequest(`${AI_NAME} could not settle on an answer. Try asking more simply.`);
}
