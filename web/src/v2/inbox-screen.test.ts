import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `design/web/inbox.html` — the one page in the design package that marks
 * itself a later phase, in words, at the top of the screen.
 *
 * The audit (`docs/v2/audit-4.md` §44) found the banner, the Telegram filter,
 * the channel word in the chat header and the client's local time all
 * missing, and the page "presenting itself as a working shared inbox". The
 * banner is the part that matters: WhatsApp and email go nowhere until their
 * keys are set, and what the office actually does today is open the chat on
 * the agent's phone, which the messaging report counts.
 *
 * What is NOT held here, on purpose: the design's inert composer. That one
 * difference is written up in `docs/decisions-to-confirm.md` and in
 * `docs/v2/questions-inbox.md` — taking a working reply box away from ten
 * people is the owner's call, not a rebuild's.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SOURCE = readFileSync(path.join(HERE, 'Inbox.tsx'), 'utf8');
const WORDS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the later-phase banner', () => {
  it('carries the design\'s own words', () => {
    expect(WORDS).toContain('LATER PHASE');
    expect(WORDS).toContain('Not in the first build.');
    expect(WORDS).toContain(
      'For now WhatsApp and Telegram open on the',
    );
    expect(WORDS).toContain('phone and every tap is logged.');
  });

  it('sends an owner to the messaging report and an agent to My leads', () => {
    expect(WORDS).toContain('>Open the messaging report<');
    expect(WORDS).toContain('>Open My leads<');
    expect(WORDS).toContain('to="/v2/messaging"');
  });

  it('says in the foot where a message really goes out from', () => {
    expect(WORDS).toContain(
      'In this later phase messages go out from the company WhatsApp number.',
    );
  });
});

describe('the channel filter', () => {
  it('offers the design\'s Telegram as well as WhatsApp', () => {
    expect(WORDS).toContain("['telegram', 'Telegram']");
  });

  it('never asks the server for a channel it does not have', () => {
    /* `messages.channel` is whatsapp, email, sms or note. Sending
       `telegram` would be a 400 on a filter the design asks for. */
    expect(WORDS).toContain("channel === 'any' || channel === 'telegram' ? undefined : channel");
  });

  it('explains the empty list rather than leaving it blank', () => {
    expect(WORDS).toContain('No Telegram chat is in the CRM.');
  });
});

describe('the thread header and the lead beside it', () => {
  it('writes the channel before the number, as the design does', () => {
    expect(WORDS).toContain('{channelWord(chat.last_channel)} · {chat.phone_e164');
  });

  it('names the channel for each of the four the CRM has', () => {
    const fn = /function channelWord[\s\S]*?\n}/.exec(SOURCE)?.[0] ?? '';
    expect(fn).toContain("'Email'");
    expect(fn).toContain("'Note'");
    expect(fn).toContain("'SMS'");
    expect(fn).toContain("'WhatsApp'");
    /* Telegram is never a message channel, whatever the filter offers. */
    expect(fn).not.toContain("'Telegram'");
  });

  it('puts "Open the lead" back in the header the design draws it in', () => {
    expect(WORDS).toContain('>Open the lead</Link>');
  });

  it('shows the clock where the client is', () => {
    expect(WORDS).toContain('<LocalTime phone={contact.phone_e164} />');
    /* From the dialling code and the zone it names — never a guessed city. */
    expect(WORDS).toContain('originOf(phone)');
    expect(WORDS).toContain('clockIn(origin?.timeZone ?? null)');
  });

  it('fills the composer from a ready message, rather than the clipboard', () => {
    expect(WORDS).toContain('onUse(one.text)');
    expect(WORDS).not.toContain('navigator.clipboard');
  });

  it('counts the templates the link offers', () => {
    expect(WORDS).toContain('All ${templates.data.items.length} templates');
  });
});

describe('what the inbox still will not do', () => {
  it('does not wire the call button to the recorder, which has no lead id', () => {
    /* `docs/v2/questions-calls.md`: the conversation payload carries no
       opportunity id, and filing a call against the newest inquiry would
       move the wrong lead's stage. The check-in gate is still asked. */
    expect(SOURCE).not.toContain('useCallAction');
    expect(SOURCE).toContain('useCheckIn');
  });
});
