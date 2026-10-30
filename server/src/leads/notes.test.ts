import { describe, expect, it } from 'vitest';
import { findMentions, NOTE_TYPES } from './notes.js';

/**
 * Tagging somebody in a note.
 *
 * Matched from the text rather than a dropdown, because an agent typing
 * "@sara" mid-sentence should not have to stop and pick from a list. The
 * failure that matters is the quiet one: a mention that matches the wrong
 * person sends a client's details to somebody who should not have them.
 */
const TEAM = [
  { id: 'u1', name: 'Sara Al Mansoori' },
  { id: 'u2', name: 'Omar Farouk' },
  { id: 'u3', name: 'Layla Hassan' },
  { id: 'u4', name: 'Sara Khan' },
  { id: 'u5', name: 'Jo Ng' },
];

describe('finding who was tagged in a note', () => {
  it('finds a full name', () => {
    expect(findMentions('Handing this to @Omar Farouk tomorrow', TEAM)).toEqual(['u2']);
  });

  it('finds a first name when only one person has it', () => {
    expect(findMentions('@Layla can you cover the viewing?', TEAM)).toEqual(['u3']);
  });

  /*
   * Two Saras. A first name alone cannot say which, and guessing sends a
   * client's details to the wrong person — so it matches neither.
   */
  it('refuses to guess between two people with the same first name', () => {
    expect(findMentions('@Sara please call him', TEAM)).toEqual([]);
  });

  it('still finds the right Sara when the full name is given', () => {
    expect(findMentions('@Sara Khan is handling this one', TEAM)).toEqual(['u4']);
    expect(findMentions('@Sara Al Mansoori is handling this one', TEAM)).toEqual(['u1']);
  });

  it('does not care about capitals', () => {
    expect(findMentions('spoke to @omar farouk about it', TEAM)).toEqual(['u2']);
  });

  it('finds several people in one note', () => {
    const found = findMentions('@Layla Hassan and @Omar Farouk — both of you', TEAM);
    expect(found.sort()).toEqual(['u2', 'u3']);
  });

  /* An email address in a note is not a mention of everyone in it. */
  it('does not treat an email address as a tag', () => {
    expect(findMentions('They wrote from omar@example.com this morning', TEAM)).toEqual([]);
  });

  it('ignores a name with no @ in front of it', () => {
    expect(findMentions('Omar Farouk called them yesterday', TEAM)).toEqual([]);
  });

  /* A two-letter first name would match far too much text. */
  it('does not match a very short first name on its own', () => {
    expect(findMentions('@Jo take a look', TEAM)).toEqual([]);
    expect(findMentions('@Jo Ng take a look', TEAM)).toEqual(['u5']);
  });

  it('finds nothing in a note with no tags', () => {
    expect(findMentions('Client wants a sea view and a 2 BR', TEAM)).toEqual([]);
  });

  it('never returns the same person twice', () => {
    expect(findMentions('@Layla Hassan — @Layla, please', TEAM)).toEqual(['u3']);
  });
});

describe('the kinds of note', () => {
  /* The two that are worth pinning on a lead, and the reason the types
     exist at all rather than one undifferentiated stream. */
  it('separates what the client said from what was done', () => {
    expect(NOTE_TYPES).toContain('objection');
    expect(NOTE_TYPES).toContain('budget');
    expect(NOTE_TYPES).toContain('viewing_feedback');
    expect(NOTE_TYPES).toContain('call_summary');
  });
});
