import { describe, expect, it } from 'vitest';
import { byNote, voiceFilename, type NoteFile } from './note-files.js';

const file = (id: string, noteId: string): NoteFile => ({
  id, note_id: noteId, kind: 'file', filename: `${id}.jpg`,
  content_type: 'image/jpeg', byte_size: 1, duration_s: null,
  created_at: '2026-01-01T00:00:00.000Z',
});

describe('grouping files by their note', () => {
  it('keeps each note’s files together and in order', () => {
    const grouped = byNote([file('a', 'n1'), file('b', 'n2'), file('c', 'n1')]);
    expect(grouped.get('n1')?.map((f) => f.id)).toEqual(['a', 'c']);
    expect(grouped.get('n2')?.map((f) => f.id)).toEqual(['b']);
  });

  it('gives nothing back for a note with no files', () => {
    expect(byNote([]).get('n1')).toBeUndefined();
  });
});

describe('naming a voice note', () => {
  it('uses the extension that matches what the browser recorded', () => {
    expect(voiceFilename('audio/mp4')).toMatch(/\.m4a$/);
    expect(voiceFilename('audio/ogg;codecs=opus')).toMatch(/\.ogg$/);
    expect(voiceFilename('audio/webm;codecs=opus')).toMatch(/\.webm$/);
  });

  it('falls back to webm for a type it does not know', () => {
    expect(voiceFilename('')).toMatch(/\.webm$/);
  });

  it('is readable rather than a random id', () => {
    expect(voiceFilename('audio/webm')).toMatch(/^voice-note-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.webm$/);
  });
});
