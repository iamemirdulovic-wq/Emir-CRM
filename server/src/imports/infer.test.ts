import { describe, expect, it } from 'vitest';
import { columnsFromRows, inferMappingFromValues, preferNamed } from './infer.js';

/** The real Meta export's shape: no headers, the phone repeated three times. */
const META_ROWS = [
  ['ig', 'agora', 'sim', 'qualquer horario', 'bruno moreira', 'b@example.com', '934 741 207', 'p:934 741 207', '934 741 207'],
  ['fb', 'dentro_de_6_meses', 'não', '12gmt', 'Artur Miguel', 'a@example.com', '+351939768966', 'p:+351939768966', '+351939768966'],
  ['ig', 'agora', 'sim', 'Manhã', 'tiago dias', 't@example.com', '+351936 276 787', 'p:+351936276787', '936 276 787'],
  ['ig', 'dentro_de_6_meses', 'não', 'Tarde', 'Ana Oliveira', 'ana@example.com', '912 345 678', 'p:912345678', '912 345 678'],
];
const HEADERS = Array.from({ length: 9 }, (_, i) => `Column ${i + 1}`);

const infer = (rows: string[][], headers = HEADERS) =>
  inferMappingFromValues(headers, columnsFromRows(rows, headers.length));

describe('inferring a mapping from the values', () => {
  it('finds the name, email and phone in a file with no headers', () => {
    const mapping = infer(META_ROWS);
    expect(mapping['Column 5']).toBe('fullName');
    expect(mapping['Column 6']).toBe('email');
    expect(mapping['Column 7']).toBe('phone');
  });

  it('claims the phone once, though the file repeats it three times', () => {
    // Mapping all three would have the last silently overwrite the first.
    const mapping = infer(META_ROWS);
    const phones = Object.values(mapping).filter((field) => field === 'phone');
    expect(phones).toHaveLength(1);
  });

  it('leaves the answers to ad questions alone', () => {
    const mapping = infer(META_ROWS);
    expect(mapping['Column 1']).toBeUndefined(); // ig / fb
    expect(mapping['Column 2']).toBeUndefined(); // agora / dentro_de_6_meses
    expect(mapping['Column 3']).toBeUndefined(); // sim / não
    expect(mapping['Column 4']).toBeUndefined(); // free-text preferred time
  });

  it('recognises a name in any script', () => {
    const mapping = infer([
      ['سارة أحمد', 'sara@example.ae'],
      ['عمر حداد', 'omar@example.ae'],
      ['ليلى حسن', 'layla@example.ae'],
    ], ['Column 1', 'Column 2']);
    expect(mapping['Column 1']).toBe('fullName');
    expect(mapping['Column 2']).toBe('email');
  });

  it('does not call a column of budgets a phone', () => {
    const mapping = infer([
      ['Sara Ahmed', '1500000'],
      ['Omar Haddad', '2750000'],
      ['Layla Hassan', '980000'],
    ], ['Column 1', 'Column 2']);
    // Seven digits is phone-length, so this is the case worth pinning: a budget
    // column must not be claimed, or every lead gets an invented number.
    expect(mapping['Column 2']).not.toBe('phone');
  });

  it('does not call a single word a name', () => {
    const mapping = infer([['Dubai'], ['Sharjah'], ['Ajman']], ['Column 1']);
    expect(mapping['Column 1']).toBeUndefined();
  });

  it('tolerates the odd blank or bad value', () => {
    const mapping = infer([
      ['a@example.com'],
      [''],
      ['b@example.com'],
      ['n/a'],
      ['c@example.com'],
      ['d@example.com'],
    ], ['Column 1']);
    expect(mapping['Column 1']).toBe('email');
  });

  it('claims nothing from a column it cannot read', () => {
    const mapping = infer([['x'], ['y'], ['z']], ['Column 1']);
    expect(mapping).toEqual({});
  });

  it('survives ragged rows', () => {
    const mapping = infer([
      ['Sara Ahmed', 'sara@example.ae', '0501234567'],
      ['Omar Haddad'],
      ['Layla Hassan', 'layla@example.ae'],
    ], ['Column 1', 'Column 2', 'Column 3']);
    expect(mapping['Column 1']).toBe('fullName');
    expect(mapping['Column 2']).toBe('email');
  });
});

describe('preferNamed', () => {
  it('keeps the inferred mapping where the names matched nothing', () => {
    // The bug this exists for: a header matcher returns null for every column
    // it did not recognise, and spreading that over the inference erases it.
    const merged = preferNamed(
      { 'Column 5': 'fullName', 'Column 6': 'email' },
      { 'Column 5': null, 'Column 6': null, 'Column 7': null },
    );
    expect(merged['Column 5']).toBe('fullName');
    expect(merged['Column 6']).toBe('email');
  });

  it('lets a real column name win over a guess', () => {
    const merged = preferNamed({ 'Mobile No.': 'fullName' }, { 'Mobile No.': 'phone' });
    expect(merged['Mobile No.']).toBe('phone');
  });

  it('never leaves one field claimed by two columns', () => {
    // Otherwise both write to it and the second silently wins.
    const merged = preferNamed(
      { 'Column 1': 'phone' },
      { 'Column 1': null, 'Mobile No.': 'phone' },
    );
    expect(merged['Mobile No.']).toBe('phone');
    expect(merged['Column 1']).toBeNull();
  });
});
