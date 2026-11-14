/**
 * The words and the colours a note wears, in one place.
 *
 * The note box and the saved-notes list both need them, and they are used on
 * the lead page, in the quick panel and on the phone — so there is one copy
 * rather than three that drift. The six values are the ones the column really
 * holds: `lead_notes.type` is an ENUM, and MySQL refuses a word that is not
 * in the list rather than storing an approximation.
 */
import type { IconName } from '../design/index.js';

/** The six kinds of note, in the order the design's own row draws them. */
export const NOTE_TYPES = [
  'general', 'call_summary', 'viewing_feedback', 'budget', 'objection', 'next_step',
] as const;

export type NoteType = (typeof NOTE_TYPES)[number];

/** The word a person reads. Never `call_summary`. */
export const TYPE_LABEL: Record<NoteType, string> = {
  general: 'Note',
  call_summary: 'Call',
  viewing_feedback: 'Viewing',
  budget: 'Budget',
  objection: 'Objection',
  next_step: 'Next step',
};

/**
 * A line icon each, in place of the emoji that used to sit on these chips.
 *
 * The owner has asked three times for no emoji anywhere in the CRM, and the
 * note type chips were the loudest example: 📝 📞 🏠 💰 ⚠️ ✅, six of them in
 * a row at the top of the box.
 */
export const TYPE_ICON: Record<NoteType, IconName> = {
  general: 'sticky-note',
  call_summary: 'phone',
  viewing_feedback: 'building',
  budget: 'wallet',
  objection: 'alert-triangle',
  next_step: 'check',
};

/**
 * The tint a saved note's type pill wears — the picture is explicit that it
 * follows the type: orange for Next step, blue for Call, grey for Note. The
 * other three take the tokens that already mean those things elsewhere in the
 * CRM; nothing new enters the palette.
 */
export const TYPE_TONE: Record<NoteType, string> = {
  general: '',
  call_summary: 'd-blue',
  viewing_feedback: 'd-violet',
  budget: 'd-green',
  objection: 'd-amber',
  next_step: 'd-orange',
};

export function isNoteType(value: string): value is NoteType {
  return (NOTE_TYPES as readonly string[]).includes(value);
}

/**
 * The five phrases an agent writes ten times a day, as one tap each.
 *
 * These are the five in the owner's own picture. There is nowhere in the CRM
 * to configure them and no table to keep them in, so they are a fixed set
 * here — see the report for 14 Nov. `MORE_PHRASES` is what "More" reveals.
 */
export const QUICK_PHRASES = [
  'Client wants 2 BR',
  'Send the payment plan',
  'Call after 6pm',
  'Cash buyer',
  'Needs a mortgage',
] as const;

export const MORE_PHRASES = [
  'Wants a sea view',
  'Comparing with another project',
  'Asked about the Golden Visa',
  'Will decide with the family',
  'Asked for the floor plan',
  'Budget is lower than the form says',
  'Only wants ready units',
  'Not before next month',
] as const;

/**
 * What a note says when the attachment *is* the note.
 *
 * A voice note or a photo on its own has no words, and the endpoint will not
 * take an empty body. These are the words used instead — plain English, and
 * never the file's own name, which is what F.2 is about.
 */
export function placeholderFor(kind: 'voice' | 'image' | 'file'): string {
  if (kind === 'voice') return 'Voice note';
  if (kind === 'image') return 'Photo';
  return 'Attachment';
}

/**
 * Is this note's body a stand-in rather than something somebody wrote?
 *
 * The notes already in the database carry three shapes of stand-in: the two
 * the old note box wrote ("🎤 Voice note", "📎 Attachment"), and the one the
 * Files tab writes on the server to this day — `"Photos · IMG_4821.jpg"`,
 * the folder's name and the **file's own name** as the note's text. That last
 * one is the bug in F.2: the list printed the file name as the note. When the
 * body is one of these and the file itself is drawn underneath, the line is
 * left out and the picture speaks for itself.
 *
 * It is deliberately narrow. Anything an agent typed is kept, even one word.
 */
const FOLDERS = [
  'Photos', 'Passport & ID', 'Booking forms', 'WhatsApp screenshots',
  'Payment receipts', 'Other files',
];

export function looksLikePlaceholder(body: string, filenames: string[]): boolean {
  const said = body.trim();
  if (said === '') return true;
  if (/^(voice note|photo|attachment|file)$/i.test(said)) return true;
  /* "Photos · IMG_4821.jpg" — the server's own words for a file upload. */
  for (const folder of FOLDERS) {
    if (said === folder) return true;
    if (said.startsWith(`${folder} · `)) return true;
  }
  /* Or the bare file name, which is the same fault without the folder. */
  return filenames.some((name) => name.trim() !== '' && said === name.trim());
}
