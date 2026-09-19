/**
 * Working out which column is which.
 *
 * A deterministic matcher first: it needs no API key, it runs the same way
 * every time, and it already places the headers real agency exports use
 * ("Mobile No.", "Budget AED", "Client Name"). Anything it cannot place is
 * offered to the AI provider, which is optional and may be switched off —
 * see suggestMappingWithAi.
 *
 * The matcher is pure, so the rules that decide where someone's phone number
 * ends up are testable without a database or a network.
 */
import { aiProvider, parseJsonReply } from '../ai/index.js';
import { logger } from '../lib/logger.js';

/** Every field a column can be mapped to. */
export const IMPORT_FIELDS = [
  'fullName', 'firstName', 'lastName', 'phone', 'altPhone', 'email', 'language',
  'projectName', 'developer', 'emirate', 'preferredLocation', 'unitType',
  'budgetMinAed', 'budgetMaxAed', 'budgetBand', 'purpose', 'paymentMethod', 'timeline',
  'goldenVisaInterest', 'source', 'campaignName', 'notes', 'tags', 'ownerEmail', 'createdAt',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** column header -> field, or null for "do not import this column". */
export type ColumnMapping = Record<string, ImportField | null>;

/**
 * Header spellings we have actually met, lowercased and stripped of anything
 * that is not a letter or a digit — so "Mobile No.", "mobile_no" and
 * "MOBILE NO" all reduce to "mobileno".
 */
const ALIASES: Record<ImportField, string[]> = {
  fullName: ['name', 'fullname', 'clientname', 'customername', 'leadname', 'contactname', 'aname', 'الاسم'],
  firstName: ['firstname', 'fname', 'givenname'],
  lastName: ['lastname', 'lname', 'surname', 'familyname'],
  phone: ['phone', 'mobile', 'mobileno', 'mobilenumber', 'phoneno', 'phonenumber', 'contactno', 'contactnumber', 'tel', 'telephone', 'whatsapp', 'whatsappnumber', 'msisdn', 'cell', 'cellphone', 'رقم', 'الهاتف', 'الجوال'],
  altPhone: ['phone2', 'altphone', 'alternatephone', 'secondphone', 'mobile2', 'otherphone', 'landline'],
  email: ['email', 'emailaddress', 'mail', 'emailid', 'البريد'],
  language: ['language', 'lang', 'preferredlanguage', 'اللغة'],
  projectName: ['project', 'projectname', 'property', 'propertyname', 'development', 'interestedproject', 'المشروع'],
  developer: ['developer', 'developername', 'builder', 'المطور'],
  emirate: ['emirate', 'city', 'location', 'area', 'region', 'الإمارة'],
  preferredLocation: ['preferredlocation', 'preferredarea', 'locationpreference', 'community'],
  unitType: ['unittype', 'propertytype', 'bedrooms', 'beds', 'type', 'configuration', 'bhk'],
  budgetMinAed: ['budgetmin', 'minbudget', 'budgetfrom', 'pricefrom', 'minprice'],
  budgetMaxAed: ['budgetmax', 'maxbudget', 'budgetto', 'priceto', 'maxprice'],
  budgetBand: ['budget', 'budgetaed', 'budgetrange', 'pricerange', 'price', 'budgetband', 'الميزانية'],
  purpose: ['purpose', 'investmentorenduse', 'buyingpurpose', 'reason', 'intent'],
  paymentMethod: ['paymentmethod', 'payment', 'cashormortgage', 'financing', 'paymenttype'],
  timeline: ['timeline', 'timeframe', 'purchasetimeline', 'whenbuying', 'urgency', 'readiness'],
  goldenVisaInterest: ['goldenvisa', 'goldenvisainterest', 'visa', 'goldenvisaeligible'],
  source: ['source', 'leadsource', 'channel', 'campaignsource', 'origin', 'المصدر'],
  campaignName: ['campaign', 'campaignname', 'adname', 'adsetname', 'adgroup'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'message', 'enquiry', 'requirement', 'ملاحظات'],
  tags: ['tags', 'tag', 'labels', 'segment'],
  ownerEmail: ['owner', 'owneremail', 'agent', 'agentemail', 'assignedto', 'salesperson', 'handler'],
  createdAt: ['date', 'createdat', 'created', 'datecreated', 'leaddate', 'enquirydate', 'submitteddate', 'timestamp'],
};

/** Lowercase, drop everything that is not a letter or digit. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Score of how well a header matches a field: 3 exact alias, 2 the header
 * contains an alias, 1 an alias contains the header, 0 no match. Longer aliases
 * beat shorter ones so "budgetmin" is not swallowed by "budget".
 */
function score(normalized: string, alias: string): number {
  if (!normalized || !alias) return 0;
  if (normalized === alias) return 3 + alias.length / 100;
  if (normalized.includes(alias)) return 2 + alias.length / 100;
  if (alias.includes(normalized)) return 1 + normalized.length / 100;
  return 0;
}

/** The best field for one header, or null when nothing is close enough. */
export function matchHeader(header: string): ImportField | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;

  let best: { field: ImportField; score: number } | null = null;
  for (const field of IMPORT_FIELDS) {
    for (const alias of ALIASES[field]) {
      const value = score(normalized, alias);
      if (value > 0 && (!best || value > best.score)) best = { field, score: value };
    }
  }
  // A bare containment match on a two-letter header is a coincidence, not a
  // mapping; require a real overlap before claiming one.
  if (!best || best.score < 1.03) return null;
  return best.field;
}

/**
 * Suggests a mapping for every header.
 *
 * A field is only ever suggested once: if two columns both look like the phone,
 * the better match wins and the other is left unmapped for a person to decide.
 * Silently importing "Phone 2" over "Phone" would be a data-loss bug that no
 * one notices until they call the wrong number.
 */
export function suggestMapping(headers: string[]): ColumnMapping {
  const scored = headers.map((header) => {
    const field = matchHeader(header);
    const normalized = normalizeHeader(header);
    const best = field
      ? Math.max(...ALIASES[field].map((alias) => score(normalized, alias)))
      : 0;
    return { header, field, best };
  });

  const taken = new Map<ImportField, number>();
  scored.forEach((entry, index) => {
    if (!entry.field) return;
    const holder = taken.get(entry.field);
    if (holder === undefined) {
      taken.set(entry.field, index);
      return;
    }
    const incumbent = scored[holder] as (typeof scored)[number];
    if (entry.best > incumbent.best) {
      incumbent.field = null;
      taken.set(entry.field, index);
    } else {
      entry.field = null;
    }
  });

  const mapping: ColumnMapping = {};
  for (const entry of scored) mapping[entry.header] = entry.field;
  return mapping;
}

/**
 * The AI pass, for headers the matcher could not place.
 *
 * Deliberately narrow: it never overrides a confident match, it only ever picks
 * from IMPORT_FIELDS, and a field already taken is ignored. If AI is switched
 * off, unavailable or returns nonsense, the heuristic mapping stands and the
 * user maps the rest by hand — which is step 2 of the wizard anyway.
 *
 * Only the column headers are sent, never the rows, so no lead's data leaves
 * the system to have its columns named.
 */
export async function suggestMappingWithAi(headers: string[]): Promise<ColumnMapping> {
  const mapping = suggestMapping(headers);
  const unmapped = headers.filter((header) => mapping[header] === null && normalizeHeader(header));
  if (unmapped.length === 0) return mapping;

  const provider = await aiProvider();
  if (!provider.enabled) return mapping;

  const taken = new Set(Object.values(mapping).filter(Boolean) as ImportField[]);
  const available = IMPORT_FIELDS.filter((field) => !taken.has(field));
  if (available.length === 0) return mapping;

  try {
    const reply = await provider.complete({
      feature: 'import_mapping',
      json: true,
      maxOutputTokens: 400,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You map spreadsheet column headers for a Dubai real estate CRM. Reply with JSON only: ' +
            'an object whose keys are the given headers and whose values are one of the allowed fields, ' +
            'or null when no field fits. Never invent a field name.',
        },
        {
          role: 'user',
          content: JSON.stringify({ headers: unmapped, allowedFields: available }),
        },
      ],
    });

    const parsed = parseJsonReply<Record<string, string | null>>(reply);
    if (!parsed) return mapping;

    for (const header of unmapped) {
      const guess = parsed[header];
      // Anything outside the allowed set, or already used, is dropped.
      if (guess && (available as string[]).includes(guess) && !taken.has(guess as ImportField)) {
        mapping[header] = guess as ImportField;
        taken.add(guess as ImportField);
      }
    }
  } catch (err) {
    logger.warn('AI column mapping failed; keeping the heuristic mapping', { error: String(err) });
  }

  return mapping;
}
