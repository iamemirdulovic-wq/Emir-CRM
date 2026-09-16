import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { csvEscape, parseCsvStream, sniffDelimiter, toCsvRow } from './csv.js';

async function parse(text: string, delimiter?: string): Promise<string[][]> {
  const rows: string[][] = [];
  for await (const row of parseCsvStream(Readable.from([text]), delimiter ? { delimiter } : {})) {
    rows.push(row);
  }
  return rows;
}

/** Feeds the parser one character at a time, which is the hard case. */
async function parseSplit(text: string): Promise<string[][]> {
  const rows: string[][] = [];
  for await (const row of parseCsvStream(Readable.from([...text]))) rows.push(row);
  return rows;
}

describe('parseCsvStream', () => {
  it('reads a plain file', async () => {
    expect(await parse('name,phone\nSara,+971501234567\n')).toEqual([
      ['name', 'phone'],
      ['Sara', '+971501234567'],
    ]);
  });

  it('handles CRLF, which is what Excel writes', async () => {
    expect(await parse('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('strips the byte-order mark Excel puts at the front', async () => {
    // Left in, the first column would be named "﻿name" and never match.
    const [header] = await parse('﻿name,phone\nSara,123\n');
    expect(header?.[0]).toBe('name');
  });

  it('keeps a delimiter inside quotes', async () => {
    expect(await parse('name,note\n"Khan, Ahmed",hello\n')).toEqual([
      ['name', 'note'],
      ['Khan, Ahmed', 'hello'],
    ]);
  });

  it('keeps a newline inside quotes', async () => {
    expect(await parse('name,note\nSara,"line one\nline two"\n')).toEqual([
      ['name', 'note'],
      ['Sara', 'line one\nline two'],
    ]);
  });

  it('turns a doubled quote into one quote', async () => {
    expect(await parse('note\n"she said ""yes"""\n')).toEqual([['note'], ['she said "yes"']]);
  });

  it('reads the last row when the file has no trailing newline', async () => {
    expect(await parse('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps empty fields rather than collapsing them', async () => {
    // A row that loses its empty columns shifts every value one to the left.
    expect(await parse('a,b,c\n1,,3\n')).toEqual([['a', 'b', 'c'], ['1', '', '3']]);
  });

  it('gives the same answer whatever the chunk boundaries are', async () => {
    const text = 'name,note\r\n"Khan, Ahmed","he said ""hi""\nsecond line"\r\nSara,plain\r\n';
    expect(await parseSplit(text)).toEqual(await parse(text));
  });

  it('reads a semicolon file, which some Excel locales produce', async () => {
    expect(await parse('name;phone\nSara;123\n')).toEqual([['name', 'phone'], ['Sara', '123']]);
  });

  it('reads a tab-separated paste', async () => {
    expect(await parse('name\tphone\nSara\t123\n', '\t')).toEqual([['name', 'phone'], ['Sara', '123']]);
  });

  it('yields nothing for an empty file', async () => {
    expect(await parse('')).toEqual([]);
  });
});

describe('sniffDelimiter', () => {
  it('prefers the delimiter that produces the most columns', () => {
    expect(sniffDelimiter('a;b;c;d')).toBe(';');
    expect(sniffDelimiter('a,b,c,d')).toBe(',');
  });

  it('falls back to a comma for a single-column file', () => {
    expect(sniffDelimiter('name')).toBe(',');
  });

  it('is not fooled by a delimiter inside quotes', () => {
    expect(sniffDelimiter('"Khan, Ahmed";phone;email')).toBe(';');
  });
});

describe('writing CSV', () => {
  it('quotes only what needs it', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('has,comma')).toBe('"has,comma"');
    expect(csvEscape('has"quote')).toBe('"has""quote"');
  });

  it('writes null and undefined as empty, not as the words', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('ends a row with CRLF, which every spreadsheet reads', () => {
    expect(toCsvRow(['a', 'b'])).toBe('a,b\r\n');
  });

  it('round-trips through the parser', async () => {
    const original = ['Khan, Ahmed', 'he said "hi"', 'line\nbreak', ''];
    const [row] = await parse(toCsvRow(original));
    expect(row).toEqual(original);
  });
});
