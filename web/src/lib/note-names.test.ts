import { describe, expect, it } from 'vitest';
import { firstNameFor, importNoteIn, looksLikeImportNote } from './note-names.js';

/**
 * The names in here are the point of the module, so they are written out
 * rather than generated.
 *
 * The first block is Emir's own, off his phone on 14 Nov: "Looks fake –
 * verify" is the one he opened with, "TECHNICAL ANALYSIS." is a real row in
 * his data, and "Prüfen" and "check" came from the same file.
 *
 * The second block matters more. These are ordinary names from the five
 * languages this brokerage actually sells in, and **not one of them may be
 * flagged**. A list that cries wolf is a list Emir stops opening, and a
 * greeting that drops a real first name is a colder call for no reason.
 */

describe('a name that is really an import note', () => {
  const notes = [
    'Looks fake – verify',
    'Looks fake - verify',
    'looks fake',
    'LOOKS FAKE',
    'Looks fake 2',
    'Looks fake, verify',
    'verify',
    'Verify',
    'VERIFY!',
    'to verify',
    'Prüfen',
    'prüfen',
    'PRÜFEN',
    'Prufen',
    'check',
    'Check',
    'Ahmed - check number',
    'please check',
    'TECHNICAL ANALYSIS.',
    'duplicate',
    'Duplicate 3',
    'no name',
    'NO NAME',
    'unknown',
    'test',
    'wrong number',
    'do not call',
    'spam',
    '---',
    '12345',
  ];

  for (const name of notes) {
    it(`flags ${JSON.stringify(name)}`, () => {
      expect(importNoteIn(name)).not.toBeNull();
      expect(looksLikeImportNote(name)).toBe(true);
      expect(firstNameFor(name)).toBeNull();
    });
  }

  it('says why, in words that can be checked against the file', () => {
    expect(importNoteIn('Looks fake – verify')).toBe('Has “looks fake” in it');
    expect(importNoteIn('Prüfen')).toBe('Has the word “Prüfen” in it');
    /* The word as the file spells it, so it can be found in the file. */
    expect(importNoteIn('VERIFY!')).toBe('Has the word “VERIFY” in it');
    expect(importNoteIn('Ahmed - check number')).toBe('Has “check number” in it');
    expect(importNoteIn('TECHNICAL ANALYSIS.')).toBe('Reads as a sentence, not a name');
    expect(importNoteIn('---')).toBe('No letters in it');
  });

  it('leaves an empty name to the caller rather than calling it a note', () => {
    /* Nothing to show on a list, and the opener already has no name to use. */
    expect(importNoteIn(null)).toBeNull();
    expect(importNoteIn('')).toBeNull();
    expect(importNoteIn('   ')).toBeNull();
    expect(firstNameFor(null)).toBeNull();
    expect(firstNameFor('  ')).toBeNull();
  });
});

describe('ordinary names, which must never be flagged', () => {
  const people = [
    // Arabic
    'Ahmed Al Mansoori', 'Fatima Zahra', 'محمد عبد الله', 'Nour El Din',
    'Khalid bin Salem', 'Aisha Al Suwaidi', 'عائشة المنصوري',
    // Indian
    'Priya Ramachandran', 'Rajesh Kumar', 'Sunil Checker', 'Tejinder Singh',
    'Lakshmi Narayanan', 'Fakeer Mohammed',
    // Russian
    'Dmitry Volkov', 'Светлана Иванова', 'Anastasia Petrova', 'Чехов Антон',
    // German
    'Hans-Jürgen Schmidt', 'Müller', 'Katharina Prüfer', 'Jürgen Falschenberg',
    'Stefan Küng',
    // English and the rest of the desk
    'Sarah O’Brien', 'John Smith', 'Mary-Anne Taylor', 'McGrath',
    'Giulia Testa', 'Anne Marie Dubois', 'Li Wei', 'AHMED KHAN',
    'Mohammed Ali Jr.', 'Ahmed K.', 'Paulo de Almeida Neto',
  ];

  for (const name of people) {
    it(`keeps ${JSON.stringify(name)}`, () => {
      expect(importNoteIn(name)).toBeNull();
      expect(looksLikeImportNote(name)).toBe(false);
    });
  }

  it('does not read a stray full stop on a real name as a sentence', () => {
    /* Somebody's finger, not a note. Title case is what tells them apart. */
    expect(importNoteIn('Ahmed Khan.')).toBeNull();
    expect(importNoteIn('Mohammed Ali Jr.')).toBeNull();
    expect(importNoteIn('Ahmed K.')).toBeNull();
  });

  it('matches whole words only, never a fragment', () => {
    /* Every one of these holds a note word inside a real one. */
    expect(importNoteIn('Sunil Checker')).toBeNull();
    expect(importNoteIn('Fakeer Mohammed')).toBeNull();
    expect(importNoteIn('Giulia Testa')).toBeNull();
    expect(importNoteIn('Katharina Prüfer')).toBeNull();
    expect(importNoteIn('Чехов Антон')).toBeNull();
  });
});

describe('the name to say out loud', () => {
  it('is the first name when there is one', () => {
    expect(firstNameFor('Ahmed Al Mansoori')).toBe('Ahmed');
    expect(firstNameFor('Priya Ramachandran')).toBe('Priya');
    expect(firstNameFor('Hans-Jürgen Schmidt')).toBe('Hans-Jürgen');
    expect(firstNameFor('Sarah O’Brien')).toBe('Sarah');
    expect(firstNameFor('محمد عبد الله')).toBe('محمد');
    expect(firstNameFor('Li Wei')).toBe('Li');
  });

  it('writes a shouted name normally, because it is read aloud', () => {
    expect(firstNameFor('AHMED KHAN')).toBe('Ahmed');
    expect(firstNameFor('СВЕТЛАНА ИВАНОВА')).toBe('Светлана');
    /* Already normal, and left exactly as it is. */
    expect(firstNameFor('McGrath')).toBe('McGrath');
    expect(firstNameFor('Li Wei')).toBe('Li');
  });

  it('skips an initial and the particles that join a name together', () => {
    expect(firstNameFor('A. Khalid Hassan')).toBe('Khalid');
    expect(firstNameFor('Al Mansoori')).toBe('Mansoori');
    expect(firstNameFor('van der Berg')).toBe('Berg');
  });

  it('has nothing to say when a title is followed only by a surname', () => {
    expect(firstNameFor('Mr Khan')).toBeNull();
    expect(firstNameFor('Mr. Khan')).toBeNull();
    expect(firstNameFor('Dr Hassan')).toBeNull();
    /* But a title in front of a whole name is just a polite spreadsheet. */
    expect(firstNameFor('Dr. Ahmed Khan')).toBe('Ahmed');
    expect(firstNameFor('Mr Rajesh Kumar')).toBe('Rajesh');
  });

  it('has nothing to say when the name is initials or particles only', () => {
    expect(firstNameFor('A. B.')).toBeNull();
    expect(firstNameFor('Al')).toBeNull();
    expect(firstNameFor('.')).toBeNull();
  });
});
