import { describe, expect, it } from 'vitest';
import { allClearMessage, doNowCards, greet, type DoNowCounts } from './do-now.js';

const none: DoNowCounts = {
  slaRunningOut: 0, overdue: 0, hotNeverCalled: 0,
  repliedWaiting: 0, dueToday: 0, noNextStep: 0,
};

describe('what an agent should do next', () => {
  it('shows nothing when there is nothing to do', () => {
    /* A dashboard full of "0 overdue" teaches people to skim, and the one
       morning something is wrong they skim past that too. */
    expect(doNowCards(none)).toEqual([]);
  });

  it('puts the lead about to be taken away first', () => {
    const cards = doNowCards({ ...none, slaRunningOut: 3, overdue: 9, noNextStep: 40 });
    expect(cards[0]?.key).toBe('sla_running_out');
  });

  it('orders by what costs most to leave undone, not by count', () => {
    const cards = doNowCards({
      ...none, slaRunningOut: 1, overdue: 2, hotNeverCalled: 3,
      repliedWaiting: 4, dueToday: 5, noNextStep: 99,
    });
    expect(cards.map((c) => c.key)).toEqual([
      'sla_running_out', 'overdue', 'hot_never_called', 'replied_waiting', 'due_today', 'no_next_step',
    ]);
  });

  it('marks the first four as needing doing now', () => {
    const cards = doNowCards({
      ...none, slaRunningOut: 1, overdue: 1, hotNeverCalled: 1, repliedWaiting: 1,
    });
    expect(cards.every((c) => c.urgency === 'now')).toBe(true);
  });

  it('does not make today’s later follow-ups look urgent', () => {
    expect(doNowCards({ ...none, dueToday: 5 })[0]?.urgency).toBe('today');
  });

  it('sends each card somewhere that shows exactly those leads', () => {
    const cards = doNowCards({
      ...none, slaRunningOut: 1, overdue: 1, hotNeverCalled: 1, dueToday: 1, noNextStep: 1,
    });
    expect(cards.map((c) => c.href)).toEqual([
      '/leads?tab=new', '/leads?tab=overdue', '/leads?tab=hot', '/leads?tab=today', '/leads?tab=no_next_step',
    ]);
  });
});

describe('the words on the cards', () => {
  it('reads correctly for one', () => {
    const [card] = doNowCards({ ...none, overdue: 1 });
    expect(card?.title).toBe('1 follow-up is overdue');
  });

  it('reads correctly for many', () => {
    const [card] = doNowCards({ ...none, overdue: 4 });
    expect(card?.title).toBe('4 follow-ups are overdue');
  });

  it('gets the singular right on every card', () => {
    const cards = doNowCards({
      slaRunningOut: 1, overdue: 1, hotNeverCalled: 1, repliedWaiting: 1, dueToday: 1, noNextStep: 1,
    });
    for (const card of cards) {
      expect(card.title).not.toMatch(/\b1 [a-z-]+s\b/);
      expect(card.title).not.toContain('leads have');
    }
  });

  it('is an instruction, not a label', () => {
    const [card] = doNowCards({ ...none, slaRunningOut: 3 });
    expect(card?.title).toMatch(/^Call 3 new leads now$/);
    expect(card?.why).toContain('back to the pool');
  });

  it('explains why in words anyone can read', () => {
    for (const card of doNowCards({
      slaRunningOut: 2, overdue: 2, hotNeverCalled: 2, repliedWaiting: 2, dueToday: 2, noNextStep: 2,
    })) {
      expect(card.why.length).toBeGreaterThan(20);
      expect(card.why).not.toMatch(/SLA|opportunit|stage_key/i);
    }
  });
});

describe('when there is genuinely nothing owing', () => {
  it('says so, by name', () => {
    expect(allClearMessage('Layla').title).toContain('Layla');
  });

  it('suggests something useful rather than congratulating and stopping', () => {
    expect(allClearMessage('Layla').hint).toMatch(/pool|quiet/);
  });

  it('copes with no name', () => {
    expect(allClearMessage(null).title).toBeTruthy();
  });
});

describe('the greeting', () => {
  it('follows Dubai time, not the server’s', () => {
    expect(greet('Layla', new Date('2026-10-27T05:00:00Z'))).toBe('Good morning, Layla');   // 09:00
    expect(greet('Layla', new Date('2026-10-27T10:00:00Z'))).toBe('Good afternoon, Layla'); // 14:00
    expect(greet('Layla', new Date('2026-10-27T15:00:00Z'))).toBe('Good evening, Layla');   // 19:00
  });

  it('turns over at noon and at five, not at the UTC hour', () => {
    expect(greet('A', new Date('2026-10-27T07:59:00Z'))).toContain('morning');   // 11:59
    expect(greet('A', new Date('2026-10-27T08:01:00Z'))).toContain('afternoon'); // 12:01
    expect(greet('A', new Date('2026-10-27T13:01:00Z'))).toContain('evening');   // 17:01
  });

  it('works without a name', () => {
    expect(greet(null, new Date('2026-10-27T05:00:00Z'))).toBe('Good morning');
  });
});
