import { describe, expect, it } from 'vitest';
import { filledDeveloperFields, safeParseDeveloper } from './extract-developer.js';

/**
 * An ORN or TRN that Emir AI invented goes onto the offer sheet a buyer reads
 * and a regulator could ask about. These tests hold the line that a field the
 * model was unsure of comes back missing, not wrong.
 */
describe('looking a developer up', () => {
  it('keeps what the model actually returned', () => {
    const result = safeParseDeveloper(JSON.stringify({
      legalName: 'Emaar Properties PJSC',
      shortName: 'Emaar',
      orn: '1234',
      trn: '100123456700003',
      headOffice: 'Emaar Square, Downtown Dubai',
      confidence: { legalName: 0.97, orn: 0.6 },
    }));

    expect(result?.legalName).toBe('Emaar Properties PJSC');
    expect(result?.shortName).toBe('Emaar');
    expect(result?.orn).toBe('1234');
    expect(result?.confidence).toEqual({ legalName: 0.97, orn: 0.6 });
  });

  it('leaves a registration number missing rather than inventing one', () => {
    const result = safeParseDeveloper(JSON.stringify({ legalName: 'A Small Developer LLC' }));

    expect(result?.orn).toBeNull();
    expect(result?.trn).toBeNull();
    expect(result?.escrowBank).toBeNull();
    expect(filledDeveloperFields(result!)).toEqual(['legalName']);
  });

  it('treats a blank string as a missing field, not a value', () => {
    const result = safeParseDeveloper(JSON.stringify({
      legalName: 'Emaar Properties PJSC',
      orn: '   ',
      trn: '',
    }));

    expect(result?.orn).toBeNull();
    expect(result?.trn).toBeNull();
    expect(filledDeveloperFields(result!)).toEqual(['legalName']);
  });

  it('reads a reply wrapped in a fence or buried in prose', () => {
    expect(safeParseDeveloper('```json\n{"legalName":"Aldar Properties PJSC"}\n```')?.legalName)
      .toBe('Aldar Properties PJSC');
    expect(safeParseDeveloper('Here you go: {"legalName":"Aldar Properties PJSC"} — hope that helps')?.legalName)
      .toBe('Aldar Properties PJSC');
  });

  it('trims a field to what the developers table holds', () => {
    const result = safeParseDeveloper(JSON.stringify({ legalName: 'x'.repeat(400), orn: 'y'.repeat(200) }));

    expect(result?.legalName).toHaveLength(200);
    expect(result?.orn).toHaveLength(64);
  });

  /*
   * A model that answered one field with the wrong type must not cost the
   * others — the same rule as the project extractor.
   */
  it('drops one bad field instead of losing the whole answer', () => {
    const result = safeParseDeveloper(JSON.stringify({
      legalName: 'Sobha Realty',
      orn: 5510,
      headOffice: 'MBR City, Dubai',
    }));

    expect(result?.legalName).toBe('Sobha Realty');
    expect(result?.headOffice).toBe('MBR City, Dubai');
    expect(result?.orn).toBeNull();
  });

  it('gives up on a reply with no JSON in it', () => {
    expect(safeParseDeveloper('I do not know that developer.')).toBeNull();
    expect(safeParseDeveloper('')).toBeNull();
    expect(safeParseDeveloper('["not","an","object"]')).toBeNull();
  });
});
