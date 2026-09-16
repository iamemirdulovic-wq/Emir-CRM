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

/** Deep-clone `value` with secrets removed and contact details masked. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
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
