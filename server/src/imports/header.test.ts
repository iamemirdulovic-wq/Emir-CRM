import { describe, expect, it } from 'vitest';
import { chooseHeader, looksLikeData } from './header.js';

/** The shape of the real Meta export that found this bug. */
const META_EXPORT = [
  ['SKY Flame - Portuguese', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['ig', 'agora', 'sim', 'qualquer horario', 'bruno moreira', 'b@example.com', '934 741 207', 'p:934 741 207', '934 741 207', '', '', '', ''],
  ['fb', 'dentro_de_6_meses', 'não', '12gmt', 'Artur Miguel', 'a@example.com', '+351939768966', 'p:+351939768966', '+351939768966', '', '', '', ''],
];

describe('chooseHeader', () => {
  it('takes an ordinary header row as the header', () => {
    const choice = chooseHeader([
      ['Full Name', 'Mobile No.', 'Email', 'Budget AED'],
      ['Sara Ahmed', '0501234567', 'sara@example.com', '1500000'],
    ]);
    expect(choice.generated).toBe(false);
    expect(choice.headers).toEqual(['Full Name', 'Mobile No.', 'Email', 'Budget AED']);
    expect(choice.skip).toBe(1);
  });

  it('skips a title line above the headers', () => {
    const choice = chooseHeader([
      ['Q3 Campaign Export', '', '', ''],
      ['Full Name', 'Phone', 'Email', 'Project'],
      ['Sara Ahmed', '0501234567', 'sara@example.com', 'Emaar Beachfront'],
    ]);
    expect(choice.generated).toBe(false);
    expect(choice.headers).toEqual(['Full Name', 'Phone', 'Email', 'Project']);
    expect(choice.skip).toBe(2);
  });

  it('invents names when the file has no headers, and keeps the first lead', () => {
    // The whole point: row 2 is a lead, not a label. Consuming it as a header
    // would lose that person and name every column after their answers.
    const choice = chooseHeader(META_EXPORT);
    expect(choice.generated).toBe(true);
    expect(choice.skip).toBe(1);
    expect(choice.headers).toHaveLength(13);
    expect(choice.headers[0]).toBe('Column 1');
    expect(choice.headers[6]).toBe('Column 7');
  });

  it('skips several blank or title lines', () => {
    const choice = chooseHeader([
      ['Monthly report', '', '', ''],
      ['', '', '', ''],
      ['Name', 'Phone', 'Email', 'Source'],
      ['Omar', '0559876543', 'omar@example.com', 'web'],
    ]);
    expect(choice.headers).toEqual(['Name', 'Phone', 'Email', 'Source']);
    expect(choice.skip).toBe(3);
  });

  it('does not mistake a narrow two-column header for a title', () => {
    const choice = chooseHeader([
      ['Name', 'Phone'],
      ['Sara', '0501234567'],
    ]);
    expect(choice.generated).toBe(false);
    expect(choice.headers).toEqual(['Name', 'Phone']);
  });

  it('handles an empty file without throwing', () => {
    expect(chooseHeader([])).toEqual({ headers: [], skip: 0, generated: false });
  });

  it('takes a lone row as the header, there being nothing to compare it to', () => {
    /*
     * A title is only recognisable as one because the rows beneath it are
     * wider. With a single row there is no such evidence, so it is read as a
     * one-column header — and nothing is lost either way, because a file of one
     * row carries no leads.
     */
    const choice = chooseHeader([['Some report', '', '', '']]);
    expect(choice.generated).toBe(false);
    expect(choice.headers[0]).toBe('Some report');
  });

  it('skips the title once the rows beneath it show how wide the file is', () => {
    const choice = chooseHeader([
      ['Some report', '', '', ''],
      ['Name', 'Phone', 'Email', 'Source'],
      ['Sara', '0501234567', 'sara@example.com', 'web'],
    ]);
    expect(choice.headers).toEqual(['Name', 'Phone', 'Email', 'Source']);
    expect(choice.skip).toBe(2);
  });
});

describe('looksLikeData', () => {
  it('knows an email means a lead, not a label', () => {
    expect(looksLikeData(['ig', 'agora', 'bruno', 'b@example.com'])).toBe(true);
  });

  it('knows a phone number means a lead', () => {
    expect(looksLikeData(['fb', 'now', 'Artur', '+351939768966'])).toBe(true);
    expect(looksLikeData(['ig', 'now', 'Sara', '934 741 207'])).toBe(true);
  });

  it('knows a mostly-numeric row means a lead', () => {
    expect(looksLikeData(['1', '2500000', '3', 'x'])).toBe(true);
  });

  /*
   * The asymmetry that shapes these rules: calling a header "data" costs one
   * junk row an agent can delete. Calling data a "header" swallows a lead and
   * mislabels every column. So ordinary labels must never read as data.
   */
  it('leaves ordinary column labels alone', () => {
    expect(looksLikeData(['Full Name', 'Mobile No.', 'Email', 'Budget AED'])).toBe(false);
    expect(looksLikeData(['name', 'phone', 'email'])).toBe(false);
    expect(looksLikeData(['الاسم', 'رقم الهاتف', 'البريد'])).toBe(false);
  });

  it('is not fooled by a label that merely mentions a year', () => {
    expect(looksLikeData(['Expo 2026 list', 'Name', 'Phone'])).toBe(false);
  });

  it('says nothing about an empty row', () => {
    expect(looksLikeData(['', '', ''])).toBe(false);
  });
});
