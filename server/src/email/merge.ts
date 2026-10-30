/**
 * Merge fields: `{{first_name}}` in a template, the person's name in the mail.
 *
 * Three rules, and all three exist because of a specific way client email goes
 * wrong:
 *
 * **A field that has no value is never left as `{{first_name}}`.** Sending a
 * client an email addressed to "Hi {{first_name}}" is worse than sending
 * nothing: it says out loud that they are a row in a database. Every field
 * carries a fallback, and the fallbacks are written to read naturally — the
 * greeting falls back to "there", so "Hi {{first_name}}" becomes "Hi there".
 *
 * **Values are escaped for HTML.** A lead whose company is "Smith & Sons" is
 * common; a lead whose name contains a `<` is rare but is how the agent's own
 * signature ends up inside someone's `<a href>`.
 *
 * **Unknown fields are reported, not guessed.** The composer shows them before
 * anything is sent, because a typo in a merge field is invisible until it is
 * in somebody's inbox.
 */

export interface MergeValues {
  firstName?: string | null;
  fullName?: string | null;
  projectName?: string | null;
  agentName?: string | null;
  agentFirstName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
  companyName?: string | null;
  budget?: string | null;
  unitType?: string | null;
  emirate?: string | null;
}

/** Every field a template may use, with what it falls back to when empty. */
export const MERGE_FIELDS: Array<{
  key: string;
  label: string;
  of: keyof MergeValues;
  fallback: string;
}> = [
  { key: 'first_name', label: 'Their first name', of: 'firstName', fallback: 'there' },
  { key: 'full_name', label: 'Their full name', of: 'fullName', fallback: 'there' },
  { key: 'project', label: 'The project they asked about', of: 'projectName', fallback: 'the project' },
  { key: 'budget', label: 'Their budget', of: 'budget', fallback: 'your budget' },
  { key: 'unit_type', label: 'The unit type they want', of: 'unitType', fallback: 'the unit' },
  { key: 'emirate', label: 'Dubai or Abu Dhabi', of: 'emirate', fallback: 'the UAE' },
  { key: 'agent_name', label: 'Your full name', of: 'agentName', fallback: 'your advisor' },
  { key: 'agent_first_name', label: 'Your first name', of: 'agentFirstName', fallback: 'your advisor' },
  { key: 'agent_phone', label: 'Your phone number', of: 'agentPhone', fallback: '' },
  { key: 'agent_email', label: 'Your email', of: 'agentEmail', fallback: '' },
  { key: 'company', label: 'The company name', of: 'companyName', fallback: 'Emigeo Homes' },
];

const BY_KEY = new Map(MERGE_FIELDS.map((field) => [field.key, field]));

/** `&`, `<`, `>`, `"` — enough to keep a value inside the tag it belongs to. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PLACEHOLDER = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi;

export interface MergeResult {
  text: string;
  /** Fields the template used that do not exist. Shown before sending. */
  unknown: string[];
  /** Fields that fell back because the contact had no value. */
  usedFallback: string[];
}

/**
 * Fill a template.
 *
 * `html` escapes every value; pass false for a plain-text body, where escaping
 * would turn "Smith & Sons" into "Smith &amp; Sons" in the client's reader.
 */
export function merge(
  template: string,
  values: MergeValues,
  options: { html?: boolean } = {},
): MergeResult {
  const unknown = new Set<string>();
  const usedFallback = new Set<string>();
  const escape = options.html === false ? (value: string) => value : escapeHtml;

  const text = template.replace(PLACEHOLDER, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const field = BY_KEY.get(key);
    if (!field) {
      unknown.add(rawKey);
      /* Left as written. The composer refuses to send while any remain, so
         this string is only ever seen in the preview, where showing the
         typo is the whole point. */
      return whole;
    }
    const value = values[field.of];
    if (value === undefined || value === null || String(value).trim() === '') {
      usedFallback.add(key);
      return escape(field.fallback);
    }
    return escape(String(value).trim());
  });

  return { text, unknown: [...unknown], usedFallback: [...usedFallback] };
}

/** Every placeholder a template contains, in the order it uses them. */
export function fieldsUsed(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    const key = (match[1] ?? '').toLowerCase();
    if (key) seen.add(key);
  }
  return [...seen];
}

/** Fields a template uses that do not exist. The composer blocks on these. */
export function unknownFields(template: string): string[] {
  return fieldsUsed(template).filter((key) => !BY_KEY.has(key));
}
