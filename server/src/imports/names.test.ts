import { describe, expect, it } from 'vitest';
import { findName, looksLikeName, notAName } from './names.js';

/*
 * The rejected cases are the real ones, taken from the contact list after the
 * first live import. The accepted cases are the names from the same file, plus
 * the shapes a Dubai brokerage has to handle.
 */
describe('values that are not names', () => {
  const rejected: [string, RegExp][] = [
    ['I am on holiday till 25.05 and have time. From 9 am to 8 pm ( Cyprus time)', /sentence|punctuation|numbers/],
    // All letters, no digits, no punctuation — only the sentence test catches it.
    ['I am looking to buy an apartment in Dubai', /sentence/],
    ['quero comprar um apartamento em Dubai', /sentence/],
    ['2pm / 6pm', /numbers|punctuation/],
    ['2155105343', /numbers/],
    ['0533 226 2935', /numbers/],
    ['0.75', /numbers/],
    ['24 horas', /numbers/],
    ['Any', /form answer/],
    ['Now', /form answer/],
    ['Done', /form answer/],
    ['Katalog', /form answer/],
    ['Şimdi', /form answer/],
    ['asdasdasd', /keyboard/],
    ['Y', /too short/],
  ];

  for (const [value, reason] of rejected) {
    it(`rejects ${JSON.stringify(value.slice(0, 40))}`, () => {
      const verdict = notAName(value);
      expect(verdict).not.toBe(false);
      expect(verdict).toMatch(reason);
    });
  }

  it('rejects an empty or whitespace-only value', () => {
    expect(notAName('')).toBe('empty');
    expect(notAName('   ')).toBe('empty');
    expect(notAName(null)).toBe('empty');
    expect(notAName(undefined)).toBe('empty');
  });

  it('rejects answers whatever their case', () => {
    expect(notAName('YES')).toBeTruthy();
    expect(notAName('Evet')).toBeTruthy();
    expect(notAName('НЕТ')).toBeTruthy();
  });
});

describe('values that are names', () => {
  /*
   * Every one of these must survive. A name test that rejects real customers is
   * worse than the bug it fixes, because the loss is silent.
   */
  const accepted = [
    // From the same import
    'Matio Caetano',
    'Paulo de A. L. Neto',
    'Edson Domingos',
    'Carlos Veiga',
    'Lilian Peixoto',
    'Henrique Resende',
    'Brother Calvin-Cía',
    'Wekasas Especialistas em Arrendamento', // a letting agency — a business lead is still a lead
    // Single word: extremely common in Gulf lead forms
    'Ahmed',
    'Fatima',
    // Arabic, including a long formal name
    'أحمد',
    'محمد بن راشد آل مكتوم',
    'فاطمة الزهراء',
    // Other scripts the CRM sells into
    'Дмитрий Иванов',
    '李明',
    // Latin shapes that trip naive validators
    "O'Brien",
    'Jean-Pierre Dupont',
    'Ana Oliveira',
    'María José Fernández',
    'Nguyễn Thị Hương',
    'van der Berg',
    'Rajesh Kumar Subramaniam Iyer',
  ];

  for (const value of accepted) {
    it(`keeps ${JSON.stringify(value)}`, () => {
      expect(notAName(value)).toBe(false);
      expect(looksLikeName(value)).toBe(true);
    });
  }

  it('keeps a six-word name, because Arabic names reach that', () => {
    expect(looksLikeName('محمد عبد الله بن سالم آل نهيان')).toBe(true);
  });
});

describe('finding a name in the neighbouring columns', () => {
  it('takes a two-word name from an unmapped column', () => {
    expect(findName({ q1: 'Sim', q2: 'Bruno Moreira', q3: 'Agora' })).toBe('Bruno Moreira');
  });

  it('will not promote a single word, which could be a city or a unit type', () => {
    // "Dubai" passes the name test on its own; as a guess it is far more likely
    // to be an emirate than somebody's name.
    expect(findName({ q1: 'Dubai', q2: 'Studio', q3: 'Ahmed' })).toBeNull();
  });

  it('skips answers and numbers', () => {
    expect(findName({ q1: '2pm / 6pm', q2: '24 horas', q3: '+971 50 123 4567' })).toBeNull();
  });

  it('returns null when there is nothing to find', () => {
    expect(findName({})).toBeNull();
  });

  /*
   * Guessing is held to a tighter standard than the mapped column: a wrong
   * guess invents a customer out of an answer, and unlike a blank name nobody
   * ever notices. These all passed the first version.
   */
  it('will not promote a phrase that merely looks name-shaped', () => {
    expect(findName({ q1: 'Nothing useful here' })).toBeNull();
    expect(findName({ q1: 'Not interested' })).toBeNull();
    expect(findName({ q1: 'I am John' })).toBeNull();
    expect(findName({ q1: 'call me please' })).toBeNull();
    expect(findName({ q1: 'as soon as possible' })).toBeNull();
  });

  it('still finds a plain two or three word name', () => {
    expect(findName({ q1: 'Carlos Veiga' })).toBe('Carlos Veiga');
    expect(findName({ q1: 'María José Fernández' })).toBe('María José Fernández');
    expect(findName({ q1: 'محمد الهاشمي' })).toBe('محمد الهاشمي');
  });
});

describe('the keyboard-mash test does not eat real names', () => {
  it('catches a repeated run', () => {
    expect(notAName('asdasdasd')).toMatch(/keyboard/);
    expect(notAName('abcabc')).toMatch(/keyboard/);
    expect(notAName('aaaa')).toMatch(/keyboard/);
  });

  it('leaves a name with a repeated syllable alone', () => {
    // These are the false positives a naive repetition check produces.
    expect(looksLikeName('Ntanda')).toBe(true);
    expect(looksLikeName('Ananda')).toBe(true);
    expect(looksLikeName('Lala Salama')).toBe(true);
    expect(looksLikeName('Didi')).toBe(true);
  });
});
