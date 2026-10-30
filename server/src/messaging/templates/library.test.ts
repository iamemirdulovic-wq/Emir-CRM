import { describe, expect, it } from 'vitest';
import { findTemplate, templateLibrary, templateNameFor } from './library.js';
import { companyFrom } from '../../config/company.js';
import { validateTemplate } from './validator.js';

const LIBRARY = templateLibrary();

describe('day-one template library', () => {
  it('every shipped template passes Meta validation', () => {
    for (const template of LIBRARY) {
      const result = validateTemplate(template);
      expect(result.issues, `${template.name}: ${JSON.stringify(result.issues)}`).toEqual([]);
    }
  });

  it('ships English and Arabic for every template', () => {
    const bases = new Set(LIBRARY.map((template) => template.name.replace(/_(en|ar)$/, '')));
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

  it('carries the company name in every footer', () => {
    const renamed = templateLibrary(companyFrom({ tradingName: 'Another Brokerage', localityEn: 'Sharjah' }));
    for (const template of renamed) {
      const footer = template.components.find((c) => c.type === 'FOOTER');
      const text = footer && 'text' in footer ? footer.text : '';
      expect(text, template.name).toContain('Another Brokerage');
    }
  });

  it('puts the renamed company in the English and the Arabic footer', () => {
    const renamed = templateLibrary(companyFrom({ tradingName: 'Another Brokerage' }));
    const ar = renamed.find((template) => template.name === 'lead_welcome_ar');
    const footer = ar?.components.find((c) => c.type === 'FOOTER');
    expect(footer && 'text' in footer ? footer.text : '').toContain('Another Brokerage');
  });

  it('still passes Meta validation after a rename', () => {
    /* The footer is capped at 60 characters, so a long company name is the
       realistic way this breaks. */
    const renamed = templateLibrary(companyFrom({ tradingName: 'A Fairly Long Brokerage Name LLC' }));
    for (const template of renamed) {
      expect(validateTemplate(template).issues, template.name).toEqual([]);
    }
  });

  it('finds a template inside whichever library it is given', () => {
    const renamed = templateLibrary(companyFrom({ tradingName: 'Another Brokerage' }));
    expect(findTemplate('lead_welcome_en', renamed)).toBeDefined();
    expect(findTemplate('nope_en', renamed)).toBeUndefined();
  });
});
