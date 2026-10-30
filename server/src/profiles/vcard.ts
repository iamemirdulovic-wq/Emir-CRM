/**
 * The contact card a client saves to their phone.
 *
 * vCard 3.0 rather than 4.0: 4.0 is the better standard and iOS still
 * handles 3.0 more predictably, and the only question that matters here is
 * whether the client's phone saves the number on the first tap.
 *
 * Every value is escaped and every line is folded, because a name with a
 * comma in it or a bio longer than 75 characters silently corrupts the rest
 * of the card on some phones — which looks like the CRM lost the number.
 */

export interface VCardInput {
  fullName: string;
  jobTitle?: string | null;
  company?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  note?: string | null;
  photoUrl?: string | null;
}

/** A comma, a semicolon, a backslash or a newline inside a value breaks it. */
export function escapeValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\;');
}

/**
 * RFC 2426 line folding: no line over 75 octets, continuations start with a
 * space. Folded by character rather than by octet, which is close enough for
 * the Latin and Arabic names this will carry and never produces a line that
 * is too long.
 */
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join('\r\n');
}

/** Split a name into family and given, which is what N wants. */
function nameParts(fullName: string): { given: string; family: string } {
  const words = fullName.trim().split(/\s+/);
  if (words.length === 1) return { given: words[0] ?? '', family: '' };
  return { given: words.slice(0, -1).join(' '), family: words[words.length - 1] ?? '' };
}

export function buildVCard(input: VCardInput): string {
  const { given, family } = nameParts(input.fullName);
  const lines: string[] = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeValue(family)};${escapeValue(given)};;;`,
    `FN:${escapeValue(input.fullName)}`,
  ];

  if (input.company) lines.push(`ORG:${escapeValue(input.company)}`);
  if (input.jobTitle) lines.push(`TITLE:${escapeValue(input.jobTitle)}`);
  if (input.phone) lines.push(`TEL;TYPE=CELL,VOICE:${escapeValue(input.phone)}`);
  /* A second number only when it differs — the same number twice shows as a
     duplicate in the phone's contact card. */
  if (input.whatsapp && input.whatsapp !== input.phone) {
    lines.push(`TEL;TYPE=CELL:${escapeValue(input.whatsapp)}`);
  }
  if (input.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${escapeValue(input.email)}`);
  if (input.website) lines.push(`URL:${escapeValue(input.website)}`);
  if (input.photoUrl) lines.push(`PHOTO;VALUE=URI:${escapeValue(input.photoUrl)}`);
  if (input.note) lines.push(`NOTE:${escapeValue(input.note)}`);

  lines.push(`REV:${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}`);
  lines.push('END:VCARD');

  /* CRLF, which the spec requires and some phones genuinely insist on. */
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** What the file is called when it lands in the client's downloads. */
export function vcardFilename(fullName: string): string {
  const slug = fullName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'contact'}.vcf`;
}
