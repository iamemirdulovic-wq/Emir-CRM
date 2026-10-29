/**
 * Redaction helpers. HARD RULES: never log secrets, or full phone and email lists.
 */
const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|api[-_]?key|private[-_]?key|access[-_]?token|refresh[-_]?token|signature|cookie|hash)/i;
const CONTACT_KEY_PATTERN = /(phone|mobile|whatsapp|wa_id|email|msisdn)/i;

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 4) return '***';
  return `${value.startsWith('+') ? '+' : ''}${digits.slice(0, 3)}***${digits.slice(-2)}`;
}

export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}

/**
 * Contact details also arrive inside free text — most often a MySQL duplicate-key
 * error, whose message quotes the offending value ("Duplicate entry
 * '+971501234567' for key 'uq_contact_phone'"). Those strings reach the log
 * through `errorContext`, so they are masked wherever they appear, not only when
 * they sit under a key we recognise.
 */
const PHONE_IN_TEXT = /\+\d{8,15}\b/g;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/*
 * A `wa_id` is stored without the leading `+` (971501234567), so a duplicate-key
 * error naming `uq_contacts_wa_id` would slip past the pattern above. Bare digit
 * runs are only masked inside quotes, which is how MySQL prints the offending
 * value — masking every long number in free text would mangle timestamps and
 * row counts instead.
 */
const QUOTED_DIGITS = /'(\d{8,15})'/g;

export function scrubText(value: string): string {
  return value
    .replace(EMAIL_IN_TEXT, maskEmail)
    .replace(PHONE_IN_TEXT, maskPhone)
    .replace(QUOTED_DIGITS, (_match, digits: string) => `'${maskPhone(digits)}'`);
}

/** Deep-clone `value` with secrets removed and contact details masked. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubText(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const head = value.slice(0, 20).map((v) => redact(v, depth + 1));
    return value.length > 20 ? [...head, `[+${value.length - 20} more]`] : head;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[redacted]';
    } else if (CONTACT_KEY_PATTERN.test(key) && typeof val === 'string') {
      out[key] = val.includes('@') ? maskEmail(val) : maskPhone(val);
    } else {
      out[key] = redact(val, depth + 1);
    }
  }
  return out;
}
