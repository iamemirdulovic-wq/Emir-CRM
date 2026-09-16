import { describe, expect, it } from 'vitest';
import { bodyVariableCount, renderBody, validateBodyText, validateTemplate } from './validator.js';
import type { TemplateDefinition } from './types.js';

const base = (components: TemplateDefinition['components']): TemplateDefinition => ({
  name: 'lead_welcome_en',
  language: 'en',
  category: 'MARKETING',
  components,
});

const goodBody = {
  type: 'BODY' as const,
  text: 'Hi {{1}}, thanks for your interest in {{2}}. I am {{3}} from {{4}} and I will help you.',
  example: { body_text: [['Sara', 'Emaar Beachfront', 'Layla', 'Emir Real Estate']] },
};

describe('validateBodyText', () => {
  it('rejects a body that starts with a variable', () => {
    const issues = validateBodyText('{{1}} welcome to our project listing.');
    expect(issues.some((i) => /must not start with a variable/.test(i.message))).toBe(true);
  });

  it('rejects a body that ends with a variable', () => {
    const issues = validateBodyText('Thanks for your interest in {{1}}');
    expect(issues.some((i) => /must not end with a variable/.test(i.message))).toBe(true);
  });

  it('rejects adjacent variables', () => {
    const issues = validateBodyText('Hello {{1}} {{2}} welcome aboard.');
    expect(issues.some((i) => /must not be adjacent/.test(i.message))).toBe(true);
  });

  it('rejects gaps in the variable sequence', () => {
    const issues = validateBodyText('Hi {{1}}, your project {{3}} is ready to view.');
    expect(issues.some((i) => /sequential/.test(i.message))).toBe(true);
  });

  it('rejects a body over 1024 characters', () => {
    const issues = validateBodyText(`Hi {{1}}, ${'x'.repeat(1030)} regards.`);
    expect(issues.some((i) => /at most 1024 characters/.test(i.message))).toBe(true);
  });

  it('accepts a well-formed body', () => {
    expect(validateBodyText('Hi {{1}}, thanks for asking about {{2}}. I will call you shortly.')).toEqual([]);
  });
});

describe('validateTemplate', () => {
  it('accepts the day-one welcome shape', () => {
    const result = validateTemplate(
      base([
        { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: ['4::aWlt'] } },
        goodBody,
        { type: 'FOOTER', text: 'Emir Real Estate — RERA 12345' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Pricing', payload: 'PRICING' },
            { type: 'QUICK_REPLY', text: 'Location', payload: 'LOCATION' },
            { type: 'QUICK_REPLY', text: 'Call me', payload: 'CALL_ME' },
          ],
        },
      ]),
    );
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('requires examples for body variables', () => {
    const result = validateTemplate(base([{ type: 'BODY', text: goodBody.text }]));
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.field === 'body.example')).toBe(true);
  });

  it('requires a media handle example for a document header', () => {
    const result = validateTemplate(base([{ type: 'HEADER', format: 'DOCUMENT' }, goodBody]));
    expect(result.issues.some((i) => i.field === 'header.example')).toBe(true);
  });

  it('rejects a footer over 60 characters', () => {
    const result = validateTemplate(base([goodBody, { type: 'FOOTER', text: 'x'.repeat(61) }]));
    expect(result.issues.some((i) => /Footer must be at most 60/.test(i.message))).toBe(true);
  });

  it('rejects variables in a footer', () => {
    const result = validateTemplate(base([goodBody, { type: 'FOOTER', text: 'Sent by {{1}}' }]));
    expect(result.issues.some((i) => /Footers cannot contain variables/.test(i.message))).toBe(true);
  });

  it('rejects quick-reply text over 25 characters', () => {
    const result = validateTemplate(
      base([goodBody, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'A'.repeat(26) }] }]),
    );
    expect(result.issues.some((i) => /at most 25 characters/.test(i.message))).toBe(true);
  });

  it('rejects more than 10 buttons', () => {
    const buttons = Array.from({ length: 11 }, (_, i) => ({ type: 'QUICK_REPLY' as const, text: `Option ${i}` }));
    const result = validateTemplate(base([goodBody, { type: 'BUTTONS', buttons }]));
    expect(result.issues.some((i) => /At most 10 buttons/.test(i.message))).toBe(true);
  });

  it('rejects duplicate button labels', () => {
    const result = validateTemplate(
      base([
        goodBody,
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Pricing' },
            { type: 'QUICK_REPLY', text: 'pricing' },
          ],
        },
      ]),
    );
    expect(result.issues.some((i) => /Duplicate button text/.test(i.message))).toBe(true);
  });

  it('requires exactly one body', () => {
    expect(validateTemplate(base([{ type: 'FOOTER', text: 'hi' }])).issues.some((i) => /exactly one BODY/.test(i.message))).toBe(true);
    expect(validateTemplate(base([goodBody, goodBody])).issues.some((i) => /exactly one BODY/.test(i.message))).toBe(true);
  });

  it('rejects invalid template names', () => {
    const result = validateTemplate({ ...base([goodBody]), name: 'Lead Welcome EN' });
    expect(result.issues.some((i) => i.field === 'name')).toBe(true);
  });

  it('rejects a relative URL button', () => {
    const result = validateTemplate(
      base([goodBody, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Brochure', url: '/b/emaar' }] }]),
    );
    expect(result.issues.some((i) => /absolute http/.test(i.message))).toBe(true);
  });
});

describe('rendering', () => {
  it('counts body variables', () => {
    expect(bodyVariableCount(base([goodBody]))).toBe(4);
  });

  it('fills variables in order', () => {
    expect(renderBody('Hi {{1}}, about {{2}} — regards {{3}}.', ['Sara', 'Emaar Beachfront', 'Layla'])).toBe(
      'Hi Sara, about Emaar Beachfront — regards Layla.',
    );
  });

  it('leaves unfilled variables visible rather than printing undefined', () => {
    expect(renderBody('Hi {{1}}, about {{2}}.', ['Sara'])).toBe('Hi Sara, about {{2}}.');
  });
});
