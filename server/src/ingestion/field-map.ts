import { query, type Executor, getPool } from '../db/client.js';

/**
 * Lead forms carry custom questions that differ per form and change without
 * notice. They are mapped through `form_field_map`, never hard-coded.
 */
export type FieldMapping = {
  externalField: string;
  crmField: string;
  transform: string | null;
  valueMap: Record<string, string> | null;
  formId: string | null;
};

/** The CRM fields a form question may be mapped onto. */
export const CRM_FIELDS = [
  'full_name',
  'first_name',
  'last_name',
  'phone',
  'email',
  'city',
  'country',
  'language',
  'project',
  'developer',
  'emirate',
  'preferred_location',
  'unit_type',
  'budget_band',
  'budget_min',
  'budget_max',
  'purpose',
  'payment_method',
  'timeline',
  'golden_visa',
  'notes',
  'consent_text',
  'ignore',
] as const;
export type CrmField = (typeof CRM_FIELDS)[number];

const key = (value: string): string => value.toLowerCase().trim().replace(/[\s_-]+/g, '_');

/**
 * Load mappings for a source. Form-specific rows win over the source-wide
 * defaults, so a form can override a shared question.
 */
export async function loadFieldMappings(
  source: string,
  formId: string | null,
  exec: Executor = getPool(),
): Promise<FieldMapping[]> {
  const rows = await query<{
    external_field: string;
    crm_field: string;
    transform: string | null;
    value_map: unknown;
    form_id: string | null;
  }>(
    `SELECT external_field, crm_field, transform, value_map, form_id
       FROM form_field_map
      WHERE source = ? AND (form_id IS NULL OR form_id = ?)`,
    [source, formId],
    exec,
  );

  return rows.map((row) => ({
    externalField: row.external_field,
    crmField: row.crm_field,
    transform: row.transform,
    valueMap: parseValueMap(row.value_map),
    formId: row.form_id,
  }));
}

function parseValueMap(raw: unknown): Record<string, string> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, string>;
  try {
    return JSON.parse(String(raw)) as Record<string, string>;
  } catch {
    return null;
  }
}

export type MapResult = {
  /** CRM field name → value. */
  mapped: Record<string, string>;
  /** Questions with no mapping yet. Kept so nothing is silently dropped. */
  unmapped: Record<string, string>;
};

/**
 * Apply mappings to raw form answers. Matching ignores case, spaces, hyphens
 * and underscores, because Meta and Google spell the same question differently.
 */
export function applyFieldMap(fields: Record<string, string>, mappings: FieldMapping[]): MapResult {
  const byField = new Map<string, FieldMapping>();
  // Source-wide rows first, then form-specific ones overwrite them.
  for (const mapping of mappings.filter((m) => m.formId === null)) byField.set(key(mapping.externalField), mapping);
  for (const mapping of mappings.filter((m) => m.formId !== null)) byField.set(key(mapping.externalField), mapping);

  const mapped: Record<string, string> = {};
  const unmapped: Record<string, string> = {};

  for (const [rawName, rawValue] of Object.entries(fields)) {
    const value = (rawValue ?? '').toString().trim();
    if (!value) continue;

    const mapping = byField.get(key(rawName));
    if (!mapping) {
      unmapped[rawName] = value;
      continue;
    }
    if (mapping.crmField === 'ignore') continue;

    const transformed = applyTransform(value, mapping);
    if (transformed === null || transformed === '') continue;

    // Two questions mapped onto one CRM field: first non-empty answer wins.
    if (mapped[mapping.crmField] === undefined) mapped[mapping.crmField] = transformed;
  }

  return { mapped, unmapped };
}

function applyTransform(value: string, mapping: FieldMapping): string | null {
  const viaMap = mapping.valueMap?.[value] ?? mapping.valueMap?.[value.toLowerCase()];
  const working = viaMap ?? value;

  switch (mapping.transform) {
    case 'lower':
      return working.toLowerCase();
    case 'upper':
      return working.toUpperCase();
    case 'digits':
      return working.replace(/\D/g, '') || null;
    case 'trim':
    case null:
    case undefined:
      return working.trim();
    default:
      return working.trim();
  }
}
