import { describe, expect, it, beforeAll } from 'vitest';
import path from 'node:path';
import {
  AUDIO_TYPES, IMAGE_TYPES, baseContentType, extensionFor, insideUploadDir, isInlineSafe, uploadDir,
} from './uploads.js';

beforeAll(() => {
  process.env.UPLOAD_DIR = '/srv/crm/uploads';
});

describe('deciding what may be stored', () => {
  it('accepts the image types and PDF', () => {
    expect(extensionFor('image/jpeg', IMAGE_TYPES)).toBe('.jpg');
    expect(extensionFor('application/pdf', IMAGE_TYPES)).toBe('.pdf');
  });

  it('refuses SVG, which is a document that can carry script', () => {
    expect(extensionFor('image/svg+xml', IMAGE_TYPES)).toBeNull();
  });

  it('refuses HTML for the same reason', () => {
    expect(extensionFor('text/html', IMAGE_TYPES)).toBeNull();
  });

  it('refuses anything not named, rather than guessing from the extension', () => {
    expect(extensionFor('application/x-msdownload', IMAGE_TYPES)).toBeNull();
    expect(extensionFor('', IMAGE_TYPES)).toBeNull();
  });

  it('keeps audio out of the image list', () => {
    expect(extensionFor('audio/webm', IMAGE_TYPES)).toBeNull();
  });
});

describe('what a phone records', () => {
  it('strips the codecs parameter Chrome and Safari append', () => {
    expect(baseContentType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(extensionFor('audio/webm;codecs=opus', AUDIO_TYPES)).toBe('.webm');
  });

  it('handles the space some browsers put before codecs', () => {
    expect(extensionFor('audio/ogg; codecs=opus', AUDIO_TYPES)).toBe('.ogg');
  });

  it('is not case sensitive', () => {
    expect(extensionFor('AUDIO/MP4', AUDIO_TYPES)).toBe('.m4a');
  });

  it('takes what Safari gives and what Android gives', () => {
    expect(extensionFor('audio/mp4', AUDIO_TYPES)).toBe('.m4a');
    expect(extensionFor('audio/webm', AUDIO_TYPES)).toBe('.webm');
  });
});

describe('what may be rendered inline', () => {
  const both = { ...IMAGE_TYPES, ...AUDIO_TYPES };

  it('allows images and audio', () => {
    expect(isInlineSafe('image/png', both)).toBe(true);
    expect(isInlineSafe('audio/webm;codecs=opus', both)).toBe(true);
  });

  it('does not inline a PDF', () => {
    expect(isInlineSafe('application/pdf', both)).toBe(false);
  });

  it('does not inline a type that is not allowed at all', () => {
    expect(isInlineSafe('image/svg+xml', both)).toBe(false);
  });
});

describe('where a file may live', () => {
  it('accepts a path inside the upload directory', () => {
    expect(insideUploadDir('/srv/crm/uploads/notes/abc.jpg')).toBe(true);
  });

  it('refuses a path that climbs out of it', () => {
    expect(insideUploadDir('/srv/crm/uploads/../../etc/passwd')).toBe(false);
    expect(insideUploadDir('/srv/crm/uploads/notes/../../../etc/passwd')).toBe(false);
  });

  it('refuses the upload directory itself, which is not a file', () => {
    expect(insideUploadDir('/srv/crm/uploads')).toBe(false);
  });

  it('refuses a sibling directory whose name merely starts the same', () => {
    expect(insideUploadDir('/srv/crm/uploads-old/notes/abc.jpg')).toBe(false);
  });

  it('refuses somewhere else entirely', () => {
    expect(insideUploadDir('/etc/passwd')).toBe(false);
  });

  it('puts each kind in its own folder under the upload directory', () => {
    expect(uploadDir('notes')).toBe(path.join('/srv/crm/uploads', 'notes'));
    expect(insideUploadDir(path.join(uploadDir('notes'), 'x.jpg'))).toBe(true);
  });
});
