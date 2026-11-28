import { describe, expect, it } from 'vitest';
import { qualityEventFor, validateMove } from './moves.js';

const agent = { role: 'agent' as const, ownsCard: true };
const otherAgent = { role: 'agent' as const, ownsCard: false };
const manager = { role: 'manager' as const, ownsCard: false };

describe('validateMove', () => {
  it('lets an agent move their own card forward', () => {
    const move = validateMove({ from: 'new_lead', to: 'attempted_contact', subStatus: 'attempt_1' }, agent);
    expect(move.to).toBe('attempted_contact');
    expect(move.status).toBe('open');
    expect(move.isBackwards).toBe(false);
  });

  it('blocks an agent from moving someone else’s card', () => {
    expect(() => validateMove({ from: 'new_lead', to: 'attempted_contact' }, otherAgent)).toThrowError(
      /only move their own leads/,
    );
  });

  it('blocks an agent from moving a card backwards', () => {
    expect(() => validateMove({ from: 'deal_sent', to: 'new_lead' }, agent)).toThrowError(/requires a manager/);
  });

  it('lets a manager move any card in any direction', () => {
    const move = validateMove({ from: 'deal_sent', to: 'attempted_contact' }, manager);
    expect(move.isBackwards).toBe(true);
    expect(move.status).toBe('open');
  });

  it('requires a lost reason when marking a lead Lost', () => {
    expect(() => validateMove({ from: 'attempted_contact', to: 'lost' }, agent)).toThrowError(/lost reason is required/);
    expect(() => validateMove({ from: 'attempted_contact', to: 'lost', lostReason: 'changed_mind' }, agent)).toThrowError(
      /lost reason is required/,
    );
  });

  it('accepts a valid lost reason from an agent', () => {
    const move = validateMove({ from: 'attempted_contact', to: 'lost', lostReason: 'unresponsive' }, agent);
    expect(move.status).toBe('lost');
    expect(move.lostReason).toBe('unresponsive');
  });

  it('rejects a lost reason on a non-Lost move', () => {
    expect(() => validateMove({ from: 'new_lead', to: 'won', lostReason: 'invalid' }, manager)).toThrowError(
      /only applies when moving a lead to Lost/,
    );
  });

  it('marks Won as won', () => {
    expect(validateMove({ from: 'deal_sent', to: 'won', subStatus: 'reserved' }, agent).status).toBe('won');
  });

  it('rejects a sub-status that does not belong to the target stage', () => {
    expect(() => validateMove({ from: 'new_lead', to: 'attempted_contact', subStatus: 'qualified' }, agent)).toThrowError(
      /not a valid sub-status/,
    );
  });

  it('allows a move with no sub-status', () => {
    expect(validateMove({ from: 'new_lead', to: 'engaged_qualified' }, agent).subStatus).toBeNull();
  });
});

describe('qualityEventFor', () => {
  it('maps stages to lead-quality events', () => {
    expect(qualityEventFor('new_lead', 'raw')).toBe('valid_lead');
    expect(qualityEventFor('attempted_contact', 'attempt_1')).toBe('contacted');
    expect(qualityEventFor('engaged_qualified', 'qualified')).toBe('qualified');
    expect(qualityEventFor('appointment_scheduled', 'booked')).toBe('appointment');
    expect(qualityEventFor('won', 'reserved')).toBe('reservation');
  });

  it('reports a show from the sub-status, which the stage alone cannot express', () => {
    expect(qualityEventFor('appointment_scheduled', 'showed')).toBe('show');
    expect(qualityEventFor('appointment_scheduled', 'no_show')).toBe('appointment');
  });

  it('tells Meta a junk lead was junk, instead of saying nothing', () => {
    /*
     * This used to return null for all of these, which sounds harmless and
     * is not: a lead Meta hears nothing about looks exactly like a lead
     * nobody has worked yet, so it keeps buying more of the same. Silence is
     * the expensive answer.
     */
    expect(qualityEventFor('new_lead', 'invalid')).toBe('invalid_lead');
    expect(qualityEventFor('new_lead', 'duplicate')).toBe('invalid_lead');
    expect(qualityEventFor('attempted_contact', 'wrong_number')).toBe('invalid_lead');
  });

  it('reports the lost reasons Emir chose as bad', () => {
    expect(qualityEventFor('lost', null, 'invalid')).toBe('invalid_lead');
    expect(qualityEventFor('lost', null, 'unresponsive')).toBe('invalid_lead');
    expect(qualityEventFor('lost', null, 'not_interested')).toBe('invalid_lead');
  });

  it('never calls a real buyer a bad lead', () => {
    /*
     * The two that must stay out, and the reason this is a list rather than
     * "anything lost is bad". Someone who bought elsewhere had money and
     * bought a property: Meta found precisely who it was asked to find, and
     * telling it that person was junk teaches it to stop finding buyers. A
     * budget mismatch is a real buyer at the wrong price -- a targeting
     * problem to fix in the campaign, not a fault in the person.
     */
    expect(qualityEventFor('lost', null, 'bought_elsewhere')).toBeNull();
    expect(qualityEventFor('lost', null, 'budget_mismatch')).toBeNull();
  });

  it('reports nothing for a Lost with no reason given', () => {
    /* The reason decides, so without one it guesses nothing. */
    expect(qualityEventFor('lost', null)).toBeNull();
  });

  it('lets bad news outrank the stage the card sits in', () => {
    /* A card parked in Engaged and then marked a wrong number is a wrong
       number, whatever column it is in. */
    expect(qualityEventFor('engaged_qualified', 'wrong_number')).toBe('invalid_lead');
  });
});
