import { describe, expect, it } from 'vitest';
import { assertIdentifier, assignmentList, placeholders } from './sql.js';

describe('assertIdentifier', () => {
  it('accepts ordinary column names', () => {
    for (const name of ['id', 'full_name', 'phone_e164', 'budget_min_aed', 'wa_id']) {
      expect(assertIdentifier(name)).toBe(name);
    }
  });

  it('rejects anything that could carry SQL', () => {
    for (const bad of [
      'name; DROP TABLE contacts',
      'name = 1 OR 1=1',
      'name--',
      '`name`',
      'name)',
      "name'",
      'Name',
      '1name',
      '',
      ' name',
    ]) {
      expect(() => assertIdentifier(bad), bad).toThrowError(/unsafe identifier/);
    }
  });
});

describe('assignmentList', () => {
  it('builds a placeholder assignment list', () => {
    expect(assignmentList(['full_name', 'email'])).toBe('full_name = ?, email = ?');
  });

  it('refuses an unsafe column', () => {
    expect(() => assignmentList(['full_name', 'email = 1 OR 1=1'])).toThrowError(/unsafe identifier/);
  });
});

describe('placeholders', () => {
  it('emits only question marks', () => {
    expect(placeholders(3)).toBe('?,?,?');
    expect(placeholders(1)).toBe('?');
    expect(placeholders(0)).toBe('');
  });
});
