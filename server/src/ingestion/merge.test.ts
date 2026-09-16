import { describe, expect, it } from 'vitest';
import { decideOpportunity, isPossibleDuplicate, mergeContactFields, resolveOwner, type ExistingContact } from './merge.js';
import { emptyLead, type LeadDTO } from './dto.js';

const contact = (over: Partial<ExistingContact> = {}): ExistingContact => ({
  id: 'c1',
  fullName: null,
  firstName: null,
  lastName: null,
  phoneE164: null,
  waId: null,
  email: null,
  language: null,
  country: null,
  city: null,
  ownerUserId: null,
  firstSource: null,
  firstTouchAt: null,
  lockedFields: [],
  ...over,
});

const lead = (over: Partial<LeadDTO['person']> = {}, rest: Partial<LeadDTO> = {}): LeadDTO => {
  const l = emptyLead('meta_lead_ads', 'ext-1');
  l.person = { ...l.person, ...over };
  return { ...l, ...rest };
};

describe('mergeContactFields', () => {
  it('fills empty fields', () => {
    const patch = mergeContactFields(contact(), lead({ fullName: 'Sara', phoneE164: '+971501234567', email: 'sara@x.com' }));
    expect(patch.full_name).toBe('Sara');
    expect(patch.phone_e164).toBe('+971501234567');
    expect(patch.email).toBe('sara@x.com');
  });

  it('never overwrites a field that already has a value', () => {
    const patch = mergeContactFields(
      contact({ fullName: 'Sara Al Mansoori', email: 'sara@work.com' }),
      lead({ fullName: 'S. Mansoori', email: 'sara@personal.com' }),
    );
    expect(patch.full_name).toBeUndefined();
    expect(patch.email).toBeUndefined();
  });

  it('never overwrites an agent-edited field, even when it is empty', () => {
    const patch = mergeContactFields(
      contact({ fullName: null, lockedFields: ['full_name'] }),
      lead({ fullName: 'Autofilled Name' }),
    );
    expect(patch.full_name).toBeUndefined();
  });

  it('treats a whitespace-only value as empty', () => {
    const patch = mergeContactFields(contact({ city: '   ' }), lead({ city: 'Dubai' }));
    expect(patch.city).toBe('Dubai');
  });

  it('keeps the first-touch source and updates the last source', () => {
    const first = new Date('2026-01-01T10:00:00Z');
    const patch = mergeContactFields(
      contact({ firstSource: 'website', firstTouchAt: first }),
      lead({}, { source: 'meta_lead_ads' }),
    );
    expect(patch.first_source).toBeUndefined();
    expect(patch.first_touch_at).toBeUndefined();
    expect(patch.last_source).toBe('meta_lead_ads');
  });

  it('records first touch when it is missing', () => {
    const patch = mergeContactFields(contact(), lead({}, { source: 'meta_ctwa' }));
    expect(patch.first_source).toBe('meta_ctwa');
    expect(patch.first_touch_at).toBeInstanceOf(Date);
  });

  it('ignores blank incoming values', () => {
    const patch = mergeContactFields(contact(), lead({ fullName: '   ', city: null }));
    expect(patch.full_name).toBeUndefined();
    expect(patch.city).toBeUndefined();
  });
});

describe('resolveOwner', () => {
  it('keeps a returning lead with their existing agent', () => {
    expect(resolveOwner(contact({ ownerUserId: 'agent-7' }))).toEqual({ ownerUserId: 'agent-7', sticky: true });
  });

  it('leaves a brand-new contact for round-robin', () => {
    expect(resolveOwner(contact())).toEqual({ ownerUserId: null, sticky: false });
    expect(resolveOwner(null)).toEqual({ ownerUserId: null, sticky: false });
  });
});

describe('decideOpportunity', () => {
  const now = new Date('2026-03-01T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it('creates the first opportunity', () => {
    expect(decideOpportunity([], lead(), now)).toEqual({ action: 'create', reason: 'no_open_opportunity' });
  });

  it('attaches a re-inquiry within 30 days on the same project', () => {
    const decision = decideOpportunity(
      [{ id: 'o1', projectName: 'Emaar Beachfront', stageKey: 'attempted_contact', status: 'open', createdAt: daysAgo(5) }],
      lead({}, { realEstate: { ...emptyLead('website', 'x').realEstate, projectName: 'emaar beachfront' } }),
      now,
    );
    expect(decision).toEqual({ action: 'attach', opportunityId: 'o1', reason: 'reinquiry_same_project' });
  });

  it('creates a new opportunity for a different project', () => {
    const decision = decideOpportunity(
      [{ id: 'o1', projectName: 'Emaar Beachfront', stageKey: 'new_lead', status: 'open', createdAt: daysAgo(3) }],
      lead({}, { realEstate: { ...emptyLead('website', 'x').realEstate, projectName: 'Damac Lagoons' } }),
      now,
    );
    expect(decision).toEqual({ action: 'create', reason: 'different_project' });
  });

  it('creates a new opportunity once the 30-day window has passed', () => {
    const decision = decideOpportunity(
      [{ id: 'o1', projectName: 'Emaar Beachfront', stageKey: 'new_lead', status: 'open', createdAt: daysAgo(45) }],
      lead({}, { realEstate: { ...emptyLead('website', 'x').realEstate, projectName: 'Emaar Beachfront' } }),
      now,
    );
    expect(decision).toEqual({ action: 'create', reason: 'outside_reinquiry_window' });
  });

  it('ignores closed opportunities', () => {
    const decision = decideOpportunity(
      [{ id: 'o1', projectName: 'Emaar Beachfront', stageKey: 'lost', status: 'lost', createdAt: daysAgo(2) }],
      lead({}, { realEstate: { ...emptyLead('website', 'x').realEstate, projectName: 'Emaar Beachfront' } }),
      now,
    );
    expect(decision).toEqual({ action: 'create', reason: 'no_open_opportunity' });
  });

  it('attaches an inquiry that names no project to the newest open card', () => {
    const decision = decideOpportunity(
      [
        { id: 'old', projectName: 'Emaar Beachfront', stageKey: 'new_lead', status: 'open', createdAt: daysAgo(20) },
        { id: 'new', projectName: 'Damac Lagoons', stageKey: 'new_lead', status: 'open', createdAt: daysAgo(1) },
      ],
      lead(),
      now,
    );
    expect(decision).toEqual({ action: 'attach', opportunityId: 'new', reason: 'reinquiry_no_project_named' });
  });

  it('matches project names regardless of punctuation and case', () => {
    const decision = decideOpportunity(
      [{ id: 'o1', projectName: 'Emaar  Beachfront - Tower 2', stageKey: 'new_lead', status: 'open', createdAt: daysAgo(1) }],
      lead({}, { realEstate: { ...emptyLead('website', 'x').realEstate, projectName: 'EMAAR BEACHFRONT TOWER 2' } }),
      now,
    );
    expect(decision.action).toBe('attach');
  });
});

describe('isPossibleDuplicate', () => {
  it('flags an email match whose phone differs', () => {
    expect(
      isPossibleDuplicate('email', contact({ phoneE164: '+971501111111' }), lead({ phoneE164: '+971502222222' })),
    ).toBe(true);
  });

  it('does not flag when the phones agree', () => {
    expect(
      isPossibleDuplicate('email', contact({ phoneE164: '+971501111111' }), lead({ phoneE164: '+971501111111' })),
    ).toBe(false);
  });

  it('does not flag when either side has no phone', () => {
    expect(isPossibleDuplicate('email', contact({ phoneE164: null }), lead({ phoneE164: '+971502222222' }))).toBe(false);
    expect(isPossibleDuplicate('email', contact({ phoneE164: '+971501111111' }), lead({ phoneE164: null }))).toBe(false);
  });

  it('never flags a phone or wa_id match', () => {
    expect(
      isPossibleDuplicate('phone', contact({ phoneE164: '+971501111111' }), lead({ phoneE164: '+971502222222' })),
    ).toBe(false);
    expect(isPossibleDuplicate('wa_id', contact({ phoneE164: '+971501111111' }), lead({ phoneE164: '+971502222222' }))).toBe(
      false,
    );
  });
});
