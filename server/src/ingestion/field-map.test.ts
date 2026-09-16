import { describe, expect, it } from 'vitest';
import { applyFieldMap, type FieldMapping } from './field-map.js';

const mapping = (
  externalField: string,
  crmField: string,
  extra: Partial<FieldMapping> = {},
): FieldMapping => ({
  externalField,
  crmField,
  transform: null,
  valueMap: null,
  formId: null,
  ...extra,
});

describe('applyFieldMap', () => {
  const base = [
    mapping('full_name', 'full_name'),
    mapping('phone_number', 'phone'),
    mapping('email', 'email'),
    mapping('what_is_your_budget', 'budget_band'),
  ];

  it('maps known questions and keeps unknown ones', () => {
    const result = applyFieldMap(
      {
        full_name: 'Sara Al Mansoori',
        phone_number: '+971501234567',
        email: 'sara@example.com',
        which_floor_do_you_prefer: 'High floor',
      },
      base,
    );
    expect(result.mapped).toEqual({
      full_name: 'Sara Al Mansoori',
      phone: '+971501234567',
      email: 'sara@example.com',
    });
    expect(result.unmapped).toEqual({ which_floor_do_you_prefer: 'High floor' });
  });

  it('matches question names regardless of case, spaces and punctuation', () => {
    const result = applyFieldMap({ 'Full Name': 'Sara', 'PHONE-NUMBER': '0501234567' }, base);
    expect(result.mapped).toEqual({ full_name: 'Sara', phone: '0501234567' });
    expect(result.unmapped).toEqual({});
  });

  it('lets a form-specific mapping override the source-wide default', () => {
    const result = applyFieldMap({ city: 'Dubai Marina' }, [
      mapping('city', 'city'),
      mapping('city', 'preferred_location', { formId: 'form-123' }),
    ]);
    expect(result.mapped).toEqual({ preferred_location: 'Dubai Marina' });
  });

  it('applies value maps and transforms', () => {
    const result = applyFieldMap({ interest: 'INV', phone: ' +971 50 123 4567 ' }, [
      mapping('interest', 'purpose', { valueMap: { INV: 'investment' } }),
      mapping('phone', 'phone', { transform: 'digits' }),
    ]);
    expect(result.mapped).toEqual({ purpose: 'investment', phone: '971501234567' });
  });

  it('drops questions explicitly mapped to ignore', () => {
    const result = applyFieldMap({ marketing_opt_in: 'yes' }, [mapping('marketing_opt_in', 'ignore')]);
    expect(result.mapped).toEqual({});
    expect(result.unmapped).toEqual({});
  });

  it('skips blank answers entirely', () => {
    const result = applyFieldMap({ full_name: '   ', email: '' }, base);
    expect(result.mapped).toEqual({});
    expect(result.unmapped).toEqual({});
  });

  it('keeps the first answer when two questions map to one field', () => {
    const result = applyFieldMap({ mobile: '+971501112222', phone_number: '+971503334444' }, [
      mapping('mobile', 'phone'),
      mapping('phone_number', 'phone'),
    ]);
    expect(result.mapped.phone).toBe('+971501112222');
  });
});
