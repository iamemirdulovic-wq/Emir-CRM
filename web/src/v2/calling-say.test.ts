import { describe, expect, it } from 'vitest';
import { brandOf, opener } from './Calling.js';

/**
 * The line the agent reads out, which Emir found wrong in two ways on his
 * phone on 14 Nov.
 *
 * §G.3 — it greeted a lead called "Looks fake – verify" by that name.
 * §G.4 — it introduced the agent as "Emigeo Homes Real Estate LLC", which is
 *        the registered name off an invoice, not what anybody says out loud.
 */

const LEGAL = { legalName: 'Emigeo Homes Real Estate LLC', tradingName: '' };

describe('who we say we are', () => {
  it('is the brand, never the registered name', () => {
    expect(brandOf(LEGAL)).toBe('homes.me');
  });

  it('is the trading name when somebody has set one', () => {
    /* `tradingName` is the company field for "what people actually call us".
       An owner who fills it in has answered this question himself. */
    expect(brandOf({ ...LEGAL, tradingName: 'Homes Dubai' })).toBe('Homes Dubai');
  });

  it('is the brand when the company has not been filled in at all', () => {
    expect(brandOf(undefined)).toBe('homes.me');
    expect(brandOf({})).toBe('homes.me');
  });
});

describe('the opener', () => {
  const say = (name: string | null, project: string | null = 'The Archive') =>
    opener({ name, project }, 'Rocky Fernandes', brandOf(LEGAL));

  it('uses the first name when there is a real one', () => {
    expect(say('Khalid Al Mansoori'))
      .toBe('Hi Khalid, this is Rocky from homes.me about The Archive.');
  });

  it('never greets a note from the import file', () => {
    const fallback = 'Hi, this is Rocky from homes.me about The Archive.';
    expect(say('Looks fake – verify')).toBe(fallback);
    expect(say('Prüfen')).toBe(fallback);
    expect(say('check')).toBe(fallback);
    expect(say('TECHNICAL ANALYSIS.')).toBe(fallback);
    expect(say('Looks fake 2')).toBe(fallback);
  });

  it('never greets a record with no first name in it', () => {
    const fallback = 'Hi, this is Rocky from homes.me about The Archive.';
    expect(say(null)).toBe(fallback);
    expect(say('')).toBe(fallback);
    expect(say('Mr Khan')).toBe(fallback);
    expect(say('A. B.')).toBe(fallback);
  });

  it('leaves out the project when the lead has none', () => {
    expect(say('Khalid Al Mansoori', null)).toBe('Hi Khalid, this is Rocky from homes.me.');
    expect(say('Looks fake – verify', null)).toBe('Hi, this is Rocky from homes.me.');
  });

  it('leaves out the agent when nobody is signed in', () => {
    expect(opener({ name: 'Khalid', project: 'The Archive' }, null, 'homes.me'))
      .toBe('Hi Khalid, this is homes.me about The Archive.');
  });
});
