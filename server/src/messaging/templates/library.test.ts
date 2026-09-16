import { describe, expect, it } from 'vitest';
import { TEMPLATE_LIBRARY, findTemplate, templateNameFor } from './library.js';
import { validateTemplate } from './validator.js';

describe('day-one template library', () => {
  it('every shipped template passes Meta validation', () => {
    for (const template of TEMPLATE_LIBRARY) {
      const result = validateTemplate(template);
      expect(result.issues, `${template.name}: ${JSON.stringify(result.issues)}`).toEqual([]);
    }
  });

  it('ships English and Arabic for every template', () => {
    const bases = new Set(TEMPLATE_LIBRARY.map((t) => t.name.replace(/_(en|ar)$/, '')));
    for (const base of bases) {
      expect(findTemplate(`${base}_en`), `${base}_en missing`).toBeDefined();
      expect(findTemplate(`${base}_ar`), `${base}_ar missing`).toBeDefined();
    }
  });

  it('covers the day-one list with the right categories', () => {
    const expected: Record<string, 'MARKETING' | 'UTILITY'> = {
      lead_welcome: 'MARKETING',
      followup_2h: 'MARKETING',
      followup_24h: 'MARKETING',
      followup_3d: 'MARKETING',
      appointment_confirm: 'UTILITY',
      appointment_reminder: 'UTILITY',
      agent_new_lead_alert: 'UTILITY',
      new_launch_alert: 'MARKETING',
    };
    for (const [base, category] of Object.entries(expected)) {
      expect(findTemplate(`${base}_en`)?.category, base).toBe(category);
      expect(findTemplate(`${base}_ar`)?.category, base).toBe(category);
    }
  });

  it('lead_welcome carries a document header and the three quick replies', () => {
    const template = findTemplate('lead_welcome_en');
    const header = template?.components.find((c) => c.type === 'HEADER');
    expect(header && 'format' in header ? header.format : null).toBe('DOCUMENT');
    const buttons = template?.components.find((c) => c.type === 'BUTTONS');
    const payloads = buttons && 'buttons' in buttons ? buttons.buttons.map((b) => ('payload' in b ? b.payload : null)) : [];
    expect(payloads).toEqual(['PRICING', 'LOCATION', 'CALL_ME']);
  });

  it('followup_3d offers Still interested / Not now / Stop', () => {
    const buttons = findTemplate('followup_3d_en')?.components.find((c) => c.type === 'BUTTONS');
    const payloads = buttons && 'buttons' in buttons ? buttons.buttons.map((b) => ('payload' in b ? b.payload : null)) : [];
    expect(payloads).toEqual(['STILL_INTERESTED', 'NOT_NOW', 'STOP']);
  });

  it('resolves lead_welcome_{lang} with an English fallback', () => {
    expect(templateNameFor('lead_welcome', 'ar')).toBe('lead_welcome_ar');
    expect(templateNameFor('lead_welcome', 'en')).toBe('lead_welcome_en');
    expect(templateNameFor('lead_welcome', 'ru')).toBe('lead_welcome_en');
  });
});
