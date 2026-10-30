import { describe, expect, it } from 'vitest';
import { escapeHtml, fieldsUsed, merge, unknownFields } from './merge.js';

describe('filling a template', () => {
  it('puts the value in', () => {
    expect(merge('Hi {{first_name}},', { firstName: 'Sara' }).text).toBe('Hi Sara,');
  });

  it('never leaves a placeholder showing when the value is missing', () => {
    /* "Hi {{first_name}}" in a client's inbox is worse than sending nothing. */
    const result = merge('Hi {{first_name}},', { firstName: null });
    expect(result.text).toBe('Hi there,');
    expect(result.usedFallback).toContain('first_name');
  });

  it('treats an empty string and whitespace as missing', () => {
    expect(merge('Hi {{first_name}}', { firstName: '' }).text).toBe('Hi there');
    expect(merge('Hi {{first_name}}', { firstName: '   ' }).text).toBe('Hi there');
  });

  it('trims a value rather than sending the spreadsheet’s padding', () => {
    expect(merge('Hi {{first_name}}', { firstName: '  Sara  ' }).text).toBe('Hi Sara');
  });

  it('allows spaces inside the braces, because people type them', () => {
    expect(merge('Hi {{ first_name }}', { firstName: 'Sara' }).text).toBe('Hi Sara');
  });

  it('does not care about the case of the field name', () => {
    expect(merge('Hi {{First_Name}}', { firstName: 'Sara' }).text).toBe('Hi Sara');
  });

  it('replaces every occurrence, not just the first', () => {
    expect(merge('{{first_name}}, {{first_name}}', { firstName: 'Sara' }).text).toBe('Sara, Sara');
  });

  it('fills several different fields at once', () => {
    const result = merge('Hi {{first_name}}, about {{project}} — {{agent_name}}', {
      firstName: 'Omar', projectName: 'Emaar Beachfront', agentName: 'Layla Hassan',
    });
    expect(result.text).toBe('Hi Omar, about Emaar Beachfront — Layla Hassan');
    expect(result.usedFallback).toEqual([]);
  });
});

describe('escaping', () => {
  it('keeps a value inside the tag it belongs to', () => {
    expect(escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes the quote that would break out of an attribute', () => {
    expect(escapeHtml('a" onload="x')).toBe('a&quot; onload=&quot;x');
  });

  it('escapes a merged value by default', () => {
    expect(merge('Hi {{first_name}}', { firstName: '<b>Sara</b>' }).text)
      .toBe('Hi &lt;b&gt;Sara&lt;/b&gt;');
  });

  it('does not escape in a plain-text body, where it would be read literally', () => {
    expect(merge('From {{company}}', { companyName: 'Smith & Sons' }, { html: false }).text)
      .toBe('From Smith & Sons');
  });

  it('escapes an ampersand in HTML, because a bare & is not valid', () => {
    expect(merge('From {{company}}', { companyName: 'Smith & Sons' }).text)
      .toBe('From Smith &amp; Sons');
  });
});

describe('a field that does not exist', () => {
  it('is reported rather than quietly blanked', () => {
    const result = merge('Hi {{frist_name}}', { firstName: 'Sara' });
    expect(result.unknown).toEqual(['frist_name']);
  });

  it('is left visible in the preview, so the typo can be seen', () => {
    expect(merge('Hi {{frist_name}}', {}).text).toBe('Hi {{frist_name}}');
  });

  it('is listed by unknownFields without needing any values', () => {
    expect(unknownFields('Hi {{first_name}}, {{nope}} and {{alsonope}}'))
      .toEqual(['nope', 'alsonope']);
  });

  it('finds nothing wrong with a template that only uses real fields', () => {
    expect(unknownFields('Hi {{first_name}} about {{project}}')).toEqual([]);
  });
});

describe('listing what a template uses', () => {
  it('names each field once, in the order used', () => {
    expect(fieldsUsed('{{project}} for {{first_name}}, {{project}} again'))
      .toEqual(['project', 'first_name']);
  });

  it('finds nothing in a template with no fields', () => {
    expect(fieldsUsed('Just a plain sentence.')).toEqual([]);
  });

  it('ignores a single brace, which is not a placeholder', () => {
    expect(fieldsUsed('Costs {1000} and {not_a_field}')).toEqual([]);
  });
});
