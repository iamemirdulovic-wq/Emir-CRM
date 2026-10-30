import { describe, expect, it } from 'vitest';
import { evaluateGuards, isRetryable, isWindowOpen, type GuardContext, type SendIntent } from './guards.js';
import { rulesFrom } from '../config/messaging-rules.js';

/** Asia/Dubai is UTC+4 all year. */
const dubai = (isoLocal: string) => new Date(`${isoLocal}+04:00`);
const MIDDAY = dubai('2026-03-11T13:00:00');
const NIGHT = dubai('2026-03-11T23:30:00');

const ctx = (over: Partial<GuardContext> = {}): GuardContext => {
  const now = over.now ?? MIDDAY;
  return {
    dnc: false,
    suppressed: false,
    consent: { whatsapp: true, email: true, sms: true },
    automatedMessagesLast24h: 0,
    botPausedUntil: null,
    lastHumanOutboundAt: null,
    // Open by default, relative to whatever "now" the test chose.
    waWindowExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    ...over,
    now,
  };
};

const intent = (over: Partial<SendIntent> = {}): SendIntent => ({
  channel: 'whatsapp',
  automated: true,
  isTemplate: false,
  ...over,
});

describe('guards: do-not-contact', () => {
  it('blocks every channel for a DNC contact', () => {
    for (const channel of ['whatsapp', 'email', 'sms'] as const) {
      const decision = evaluateGuards(ctx({ dnc: true }), intent({ channel, isTemplate: true }));
      expect(decision.allowed, channel).toBe(false);
      expect(decision.allowed === false && decision.reason).toBe('dnc');
    }
  });

  it('blocks a human message to a DNC contact too', () => {
    const decision = evaluateGuards(ctx({ dnc: true }), intent({ automated: false }));
    expect(decision.allowed).toBe(false);
  });

  it('blocks a suppressed identifier even when the contact is not flagged', () => {
    const decision = evaluateGuards(ctx({ suppressed: true }), intent());
    expect(decision.allowed === false && decision.reason).toBe('suppressed');
  });

  it('never retries a DNC block', () => {
    expect(isRetryable(evaluateGuards(ctx({ dnc: true }), intent()))).toBe(false);
  });
});

describe('guards: consent', () => {
  it('blocks an automated message on a channel with no opt-in', () => {
    const decision = evaluateGuards(
      ctx({ consent: { whatsapp: false, email: true, sms: false } }),
      intent({ channel: 'whatsapp' }),
    );
    expect(decision.allowed === false && decision.reason).toBe('no_consent');
  });

  it('allows an agent to reply by hand without a stored opt-in', () => {
    const decision = evaluateGuards(
      ctx({ consent: { whatsapp: false, email: false, sms: false } }),
      intent({ automated: false }),
    );
    expect(decision.allowed).toBe(true);
  });
});

describe('guards: the WhatsApp 24-hour window', () => {
  it('allows free-form text while the window is open', () => {
    expect(evaluateGuards(ctx(), intent()).allowed).toBe(true);
  });

  it('blocks free-form text once the window has closed', () => {
    const decision = evaluateGuards(ctx({ waWindowExpiresAt: null }), intent());
    expect(decision.allowed === false && decision.reason).toBe('window_closed_needs_template');
  });

  it('blocks free-form text on an expired window', () => {
    const decision = evaluateGuards(
      ctx({ waWindowExpiresAt: new Date(MIDDAY.getTime() - 1000) }),
      intent(),
    );
    expect(decision.allowed).toBe(false);
  });

  it('allows an approved template once the window has closed', () => {
    expect(evaluateGuards(ctx({ waWindowExpiresAt: null }), intent({ isTemplate: true })).allowed).toBe(true);
  });

  it('applies the window to agents as well as automation', () => {
    const decision = evaluateGuards(ctx({ waWindowExpiresAt: null }), intent({ automated: false }));
    expect(decision.allowed === false && decision.reason).toBe('window_closed_needs_template');
  });

  it('does not apply the window to email or SMS', () => {
    expect(evaluateGuards(ctx({ waWindowExpiresAt: null }), intent({ channel: 'email' })).allowed).toBe(true);
  });

  it('isWindowOpen reads the clock, not the flag', () => {
    expect(isWindowOpen({ waWindowExpiresAt: new Date(MIDDAY.getTime() + 1), now: MIDDAY })).toBe(true);
    expect(isWindowOpen({ waWindowExpiresAt: new Date(MIDDAY.getTime() - 1), now: MIDDAY })).toBe(false);
    expect(isWindowOpen({ waWindowExpiresAt: null, now: MIDDAY })).toBe(false);
  });
});

describe('guards: quiet hours', () => {
  it('defers an automated message sent at night to 08:00', () => {
    const decision = evaluateGuards(ctx({ now: NIGHT }), intent({ isTemplate: true }));
    expect(decision.allowed === false && decision.reason).toBe('quiet_hours');
    expect(decision.allowed === false && decision.deferUntil).toBeInstanceOf(Date);
    expect(isRetryable(decision)).toBe(true);
  });

  it("lets Workflow A's instant reply through at night", () => {
    const decision = evaluateGuards(ctx({ now: NIGHT }), intent({ isTemplate: true, bypassQuietHours: true }));
    expect(decision.allowed).toBe(true);
  });

  it('never applies quiet hours to an agent typing at 23:00', () => {
    const decision = evaluateGuards(ctx({ now: NIGHT }), intent({ automated: false }));
    expect(decision.allowed).toBe(true);
  });
});

describe('guards: the 3-per-24h cap', () => {
  it('allows the first three automated messages', () => {
    for (const sent of [0, 1, 2]) {
      expect(evaluateGuards(ctx({ automatedMessagesLast24h: sent }), intent()).allowed, String(sent)).toBe(true);
    }
  });

  it('blocks the fourth', () => {
    const decision = evaluateGuards(ctx({ automatedMessagesLast24h: 3 }), intent());
    expect(decision.allowed === false && decision.reason).toBe('rate_limited');
  });

  it('never caps an agent', () => {
    expect(evaluateGuards(ctx({ automatedMessagesLast24h: 50 }), intent({ automated: false })).allowed).toBe(true);
  });
});

describe('guards: the bot pauses after a human takes over', () => {
  it('blocks automation while the pause is live', () => {
    const decision = evaluateGuards(
      ctx({ botPausedUntil: new Date(MIDDAY.getTime() + 60 * 60 * 1000) }),
      intent(),
    );
    expect(decision.allowed === false && decision.reason).toBe('bot_paused');
    expect(isRetryable(decision)).toBe(true);
  });

  it('resumes once the pause has lapsed', () => {
    const decision = evaluateGuards(ctx({ botPausedUntil: new Date(MIDDAY.getTime() - 1000) }), intent());
    expect(decision.allowed).toBe(true);
  });

  it('derives the pause from the last manual message when the flag is missing', () => {
    const decision = evaluateGuards(
      ctx({ lastHumanOutboundAt: new Date(MIDDAY.getTime() - 60 * 60 * 1000) }),
      intent(),
    );
    expect(decision.allowed === false && decision.reason).toBe('bot_paused');
  });

  it('lets automation resume 24 hours after the agent’s message', () => {
    const decision = evaluateGuards(
      ctx({ lastHumanOutboundAt: new Date(MIDDAY.getTime() - 25 * 60 * 60 * 1000) }),
      intent(),
    );
    expect(decision.allowed).toBe(true);
  });

  it('never pauses the agent themselves', () => {
    const decision = evaluateGuards(
      ctx({ botPausedUntil: new Date(MIDDAY.getTime() + 60 * 60 * 1000) }),
      intent({ automated: false }),
    );
    expect(decision.allowed).toBe(true);
  });
});

describe('guards: precedence', () => {
  it('reports DNC ahead of every other problem', () => {
    const decision = evaluateGuards(
      ctx({ dnc: true, suppressed: true, consent: { whatsapp: false, email: false, sms: false }, now: NIGHT, automatedMessagesLast24h: 9 }),
      intent(),
    );
    expect(decision.allowed === false && decision.reason).toBe('dnc');
  });

  it('reports the closed window ahead of the automation limits', () => {
    const decision = evaluateGuards(
      ctx({ waWindowExpiresAt: null, automatedMessagesLast24h: 9 }),
      intent(),
    );
    expect(decision.allowed === false && decision.reason).toBe('window_closed_needs_template');
  });
});

describe('guards: the limits an owner can change', () => {
  const stricter = rulesFrom({ quietStart: '20', quietEnd: '10', maxPer24h: '1', botPauseHours: '48' });

  it('keeps the master prompt’s limits when nothing is set', () => {
    /* 21:00 Dubai is inside a 20:00 night and outside a 22:00 one. */
    const nine = dubai('2026-03-11T21:00:00');
    expect(evaluateGuards(ctx({ now: nine }), intent()).allowed).toBe(true);
  });

  it('respects a longer night', () => {
    const nine = dubai('2026-03-11T21:00:00');
    const decision = evaluateGuards(ctx({ now: nine, rules: stricter }), intent());
    expect(decision.allowed === false && decision.reason).toBe('quiet_hours');
  });

  it('says the hours it actually enforced, not the ones in the prompt', () => {
    const nine = dubai('2026-03-11T21:00:00');
    const decision = evaluateGuards(ctx({ now: nine, rules: stricter }), intent());
    expect(decision.allowed === false && decision.message).toContain('20:00');
    expect(decision.allowed === false && decision.message).toContain('10:00');
  });

  it('defers to the hour the owner set, not to eight', () => {
    const night = dubai('2026-03-11T23:00:00');
    const decision = evaluateGuards(ctx({ now: night, rules: stricter }), intent());
    const defer = decision.allowed === false ? decision.deferUntil : null;
    expect(defer).toBeInstanceOf(Date);
    expect(new Date((defer as Date).getTime() + 4 * 3600_000).getUTCHours()).toBe(10);
  });

  it('respects a lower daily cap', () => {
    const decision = evaluateGuards(ctx({ automatedMessagesLast24h: 1, rules: stricter }), intent());
    expect(decision.allowed === false && decision.reason).toBe('rate_limited');
    /* The default cap of three would have let this through. */
    expect(evaluateGuards(ctx({ automatedMessagesLast24h: 1 }), intent()).allowed).toBe(true);
  });

  it('respects a longer pause after a human replies', () => {
    const thirtyHoursAgo = new Date(MIDDAY.getTime() - 30 * 3600_000);
    expect(evaluateGuards(ctx({ lastHumanOutboundAt: thirtyHoursAgo }), intent()).allowed).toBe(true);
    const decision = evaluateGuards(ctx({ lastHumanOutboundAt: thirtyHoursAgo, rules: stricter }), intent());
    expect(decision.allowed === false && decision.reason).toBe('bot_paused');
  });

  it('cannot be set to let a fourth message through — the ceiling holds', () => {
    const loose = rulesFrom({ maxPer24h: '99' });
    const decision = evaluateGuards(ctx({ automatedMessagesLast24h: 6, rules: loose }), intent());
    expect(decision.allowed === false && decision.reason).toBe('rate_limited');
  });

  it('cannot be set to abolish the night', () => {
    const loose = rulesFrom({ quietStart: '22', quietEnd: '22' });
    const decision = evaluateGuards(ctx({ now: NIGHT, rules: loose }), intent());
    expect(decision.allowed === false && decision.reason).toBe('quiet_hours');
  });
});
