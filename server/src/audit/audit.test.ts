import { describe, expect, it } from 'vitest';
import { diffFields } from './audit.js';

describe('diffFields', () => {
  it('keeps only the fields that changed', () => {
    const { before, after } = diffFields(
      { stage: 'new_lead', owner: 'a1', score: 10 },
      { stage: 'engaged', owner: 'a1', score: 45 },
    );
    expect(before).toEqual({ stage: 'new_lead', score: 10 });
    expect(after).toEqual({ stage: 'engaged', score: 45 });
  });

  it('treats null and undefined as equal', () => {
    const { before, after } = diffFields({ note: null }, { note: undefined });
    expect(before).toEqual({});
    expect(after).toEqual({});
  });

  it('records additions and removals', () => {
    const { before, after } = diffFields({ a: 1 }, { b: 2 });
    expect(before).toEqual({ a: 1 });
    expect(after).toEqual({ b: 2 });
  });
});
