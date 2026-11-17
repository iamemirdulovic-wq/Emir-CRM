import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { TOOLS } from './ask-tools.js';

const read = (name: string) => readFile(new URL(name, import.meta.url), 'utf8');

/**
 * Homes AI writes messages. It does not send them.
 *
 * That is the one rule in CLAUDE.md this feature could break, and it would
 * break quietly: a tool that sent a WhatsApp would look exactly like a tool
 * that drafted one, right up until a real client got a message nobody read
 * first. So the checks here are about reach, not wording.
 */
describe('draft_message', () => {
  it('is a tool the model is offered, with the lead and the words required', () => {
    const tool = TOOLS.find((one) => one.name === 'draft_message');
    expect(tool).toBeDefined();
    const params = tool?.parameters as { required?: string[]; properties?: Record<string, unknown> };
    expect(params.required).toEqual(['contactId', 'body']);
    expect(Object.keys(params.properties ?? {})).toContain('channel');
  });

  it('tells the model plainly that it is not sending anything', () => {
    const tool = TOOLS.find((one) => one.name === 'draft_message');
    expect(tool?.description).toMatch(/does NOT send/i);
  });

  it('reads the lead through the same fence as every other tool', async () => {
    /*
     * An agent must not be able to have a message written for a colleague's
     * lead — the draft carries the person's name, and soon their number.
     * The clause is the same `fence` the read tools use; a hand-written
     * WHERE here is how that would quietly stop being true.
     */
    const src = await read('./ask-tools.ts');
    const tool = src.slice(src.indexOf("case 'draft_message'"), src.indexOf("case 'search_leads'"));
    expect(tool).toContain('${fence.clause}');
    expect(tool).toContain('...fence.params');
  });

  it('has no way to send: nothing in the tools reaches a client', async () => {
    const src = await read('./ask-tools.ts');
    for (const reach of ['wa.me', 'graph.facebook', 'sendMessage', 'sendMail', 'transport.send']) {
      expect(src).not.toContain(reach);
    }
    /* And every statement is a read. No tool writes a row. */
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE)\s+(INTO|FROM|\w)/i);
  });
});
