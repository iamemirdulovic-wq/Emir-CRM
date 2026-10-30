import { describe, expect, it } from 'vitest';
import { buildOwnerSummary, summaryText, type SummaryNumbers } from './owner-summary.js';

const quietDay: SummaryNumbers = {
  newLeads: 0, newLeadsPrevious: 0, contacted: 0, slaBreaches: 0,
  appointments: 0, reservations: 0, overdue: 0, noNextStep: 0,
  unassigned: 0, topAgent: null, flaggedSignIns: 0,
};

const busyDay: SummaryNumbers = {
  newLeads: 34, newLeadsPrevious: 21, contacted: 29, slaBreaches: 2,
  appointments: 5, reservations: 1, overdue: 11, noNextStep: 46,
  unassigned: 3, topAgent: { name: 'Layla Hassan', contacted: 12 }, flaggedSignIns: 1,
};

describe('what the summary leads with', () => {
  it('puts the problems before the numbers', () => {
    const summary = buildOwnerSummary(busyDay, '2026-10-30');
    expect(summary.lines[0]?.kind).toBe('problem');
    const firstNumber = summary.lines.findIndex((line) => line.kind === 'number');
    const lastProblem = summary.lines.map((l) => l.kind).lastIndexOf('problem');
    expect(lastProblem).toBeLessThan(firstNumber);
  });

  it('orders the problems by what they cost', () => {
    /* A lead nobody owns is worse than one nobody rang back. */
    const problems = buildOwnerSummary(busyDay, '2026-10-30')
      .lines.filter((l) => l.kind === 'problem').map((l) => l.text);
    expect(problems[0]).toContain('nobody to work');
    expect(problems[1]).toContain('five minutes');
  });

  it('says so in the subject when there is something to look at', () => {
    expect(buildOwnerSummary(busyDay, '2026-10-30').subject)
      .toBe('Emigeo — 5 things to look at (2026-10-30)');
  });

  it('leads the subject with the lead count on a clean day', () => {
    expect(buildOwnerSummary({ ...quietDay, newLeads: 12, contacted: 12 }, '2026-10-30').subject)
      .toBe('Emigeo — 12 new leads yesterday (2026-10-30)');
  });
});

describe('a day with nothing wrong and nothing happening', () => {
  const summary = buildOwnerSummary(quietDay, '2026-10-30');

  it('says it was quiet rather than inventing something', () => {
    expect(summary.quiet).toBe(true);
    expect(summary.subject).toContain('a quiet day');
  });

  it('does not congratulate anybody', () => {
    /* "Great work yesterday!" every morning is how an email gets filtered. */
    const text = summary.lines.map((l) => l.text).join(' ');
    expect(text).not.toMatch(/great|well done|excellent|keep it up/i);
  });

  it('still says how many leads there were, which is none', () => {
    expect(summary.lines.some((l) => l.text.startsWith('0 new leads'))).toBe(true);
  });
});

describe('the numbers', () => {
  it('compares with the day before', () => {
    expect(buildOwnerSummary(busyDay, '2026-10-30').lines
      .find((l) => l.text.includes('new leads'))?.text)
      .toBe('34 new leads, 13 more than the day before.');
  });

  it('says "fewer" when it went down', () => {
    expect(buildOwnerSummary({ ...busyDay, newLeads: 10, newLeadsPrevious: 21 }, '2026-10-30')
      .lines.find((l) => l.text.includes('new lead'))?.text)
      .toContain('11 fewer than the day before');
  });

  it('says "the same" rather than "0 more"', () => {
    expect(buildOwnerSummary({ ...busyDay, newLeads: 21, newLeadsPrevious: 21 }, '2026-10-30')
      .lines.find((l) => l.text.includes('new lead'))?.text)
      .toContain('the same as the day before');
  });

  it('gives the contacted figure as a percentage of what came in', () => {
    expect(buildOwnerSummary(busyDay, '2026-10-30').lines
      .find((l) => l.text.includes('contacted'))?.text)
      .toBe('29 of them were contacted (85%).');
  });

  it('does not divide by zero on a day with no leads', () => {
    const summary = buildOwnerSummary(quietDay, '2026-10-30');
    expect(summary.lines.every((l) => !l.text.includes('NaN'))).toBe(true);
  });

  it('leaves out appointments and reservations when there were none', () => {
    const text = buildOwnerSummary({ ...quietDay, newLeads: 5, contacted: 5 }, '2026-10-30')
      .lines.map((l) => l.text).join(' ');
    expect(text).not.toContain('appointment');
    expect(text).not.toContain('reservation');
  });
});

describe('the singular', () => {
  it('is right everywhere', () => {
    const summary = buildOwnerSummary({
      newLeads: 1, newLeadsPrevious: 0, contacted: 1, slaBreaches: 1,
      appointments: 1, reservations: 1, overdue: 1, noNextStep: 1,
      unassigned: 1, topAgent: { name: 'Omar', contacted: 1 }, flaggedSignIns: 1,
    }, '2026-10-30');
    const text = summary.lines.map((l) => l.text).join(' ');
    expect(text).not.toMatch(/\b1 [a-z-]+s\b/);
    expect(text).toContain('1 lead arrived with nobody to work it');
    expect(text).toContain('1 lead was not touched');
    expect(text).toContain('1 follow-up is overdue');
  });
});

describe('the one line of good news', () => {
  it('names who did the most', () => {
    expect(buildOwnerSummary(busyDay, '2026-10-30').lines
      .find((l) => l.kind === 'good')?.text)
      .toBe('Layla Hassan spoke to the most people — 12 leads.');
  });

  it('is left out when nobody spoke to anyone', () => {
    expect(buildOwnerSummary({ ...busyDay, topAgent: { name: 'Omar', contacted: 0 } }, '2026-10-30')
      .lines.some((l) => l.kind === 'good')).toBe(false);
  });

  it('comes last, after the problems and the numbers', () => {
    const kinds = buildOwnerSummary(busyDay, '2026-10-30').lines.map((l) => l.kind);
    expect(kinds[kinds.length - 1]).toBe('good');
  });
});

describe('the email body', () => {
  it('marks problems differently from numbers', () => {
    const text = summaryText(buildOwnerSummary(busyDay, '2026-10-30'), 'https://crm.homes.me');
    expect(text).toContain('! 3 leads arrived with nobody');
    expect(text).toContain('- 34 new leads');
  });

  it('ends with a way into the CRM', () => {
    expect(summaryText(buildOwnerSummary(quietDay, '2026-10-30'), 'https://crm.homes.me/'))
      .toContain('https://crm.homes.me/dashboard');
  });
});
