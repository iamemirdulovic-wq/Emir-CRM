const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;

/** Lowercase and trim. Returns null when the value is not a plausible address. */
export function normalizeEmail(input: string | null | undefined): string | null {
  const raw = (input ?? '').toString().trim().toLowerCase();
  if (!raw) return null;
  // Meta sometimes pads addresses or wraps them in angle brackets.
  const unwrapped = raw.replace(/^<|>$/g, '').trim();
  return EMAIL_RE.test(unwrapped) ? unwrapped : null;
}

export function isValidEmail(input: string | null | undefined): boolean {
  return normalizeEmail(input) !== null;
}

/**
 * Inbound replies arrive at reply+{conversation_id}@domain. Pull the id back out.
 */
export function parseReplyAddress(address: string | null | undefined): string | null {
  const normalized = normalizeEmail(address);
  if (!normalized) return null;
  const match = /^reply\+([a-z0-9-]{6,64})@/i.exec(normalized);
  return match?.[1] ?? null;
}

export function buildReplyAddress(conversationId: string, domain: string): string {
  return `reply+${conversationId}@${domain}`;
}
