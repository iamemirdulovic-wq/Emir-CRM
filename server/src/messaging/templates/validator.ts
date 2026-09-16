import type { TemplateComponent, TemplateDefinition } from './types.js';

/** Meta's published limits. */
export const LIMITS = {
  bodyMaxChars: 1024,
  footerMaxChars: 60,
  headerTextMaxChars: 60,
  maxButtons: 10,
  quickReplyTextMaxChars: 25,
  urlButtonTextMaxChars: 25,
  nameMaxChars: 512,
} as const;

export type ValidationIssue = { field: string; message: string };
export type ValidationResult = { valid: boolean; issues: ValidationIssue[] };

const VARIABLE_RE = /\{\{\s*(\d+)\s*\}\}/g;

export function extractVariableIndexes(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(VARIABLE_RE)) {
    const index = Number(match[1]);
    if (Number.isFinite(index)) found.push(index);
  }
  return found;
}

export function variableCount(text: string): number {
  return new Set(extractVariableIndexes(text)).size;
}

/**
 * Meta rejects a body that starts or ends with a variable, or that puts two
 * variables next to each other with nothing but whitespace between them.
 */
export function validateBodyText(text: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const trimmed = text.trim();

  if (!trimmed) {
    issues.push({ field: 'body.text', message: 'Body text is required' });
    return issues;
  }
  if (text.length > LIMITS.bodyMaxChars) {
    issues.push({ field: 'body.text', message: `Body must be at most ${LIMITS.bodyMaxChars} characters (got ${text.length})` });
  }
  if (/^\{\{\s*\d+\s*\}\}/.test(trimmed)) {
    issues.push({ field: 'body.text', message: 'Body must not start with a variable' });
  }
  if (/\{\{\s*\d+\s*\}\}$/.test(trimmed)) {
    issues.push({ field: 'body.text', message: 'Body must not end with a variable' });
  }
  if (/\}\}\s*\{\{/.test(trimmed)) {
    issues.push({ field: 'body.text', message: 'Variables must not be adjacent; put text between them' });
  }

  const indexes = extractVariableIndexes(text);
  if (indexes.length) {
    const unique = [...new Set(indexes)].sort((a, b) => a - b);
    if (unique[0] !== 1) {
      issues.push({ field: 'body.text', message: 'Variables must start at {{1}}' });
    }
    for (let i = 0; i < unique.length; i += 1) {
      if (unique[i] !== i + 1) {
        issues.push({ field: 'body.text', message: `Variables must be sequential with no gaps; expected {{${i + 1}}}` });
        break;
      }
    }
  }
  return issues;
}

export function validateComponents(components: TemplateComponent[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const counts = { HEADER: 0, BODY: 0, FOOTER: 0, BUTTONS: 0 };

  for (const component of components) {
    counts[component.type] += 1;

    if (component.type === 'HEADER') {
      if (component.format === 'TEXT') {
        const text = component.text ?? '';
        if (!text.trim()) issues.push({ field: 'header.text', message: 'A TEXT header needs text' });
        if (text.length > LIMITS.headerTextMaxChars) {
          issues.push({ field: 'header.text', message: `Header text must be at most ${LIMITS.headerTextMaxChars} characters` });
        }
        if (variableCount(text) > 1) {
          issues.push({ field: 'header.text', message: 'A header supports at most one variable' });
        }
        if (variableCount(text) === 1 && !component.example?.header_text?.length) {
          issues.push({ field: 'header.example', message: 'Provide an example value for the header variable' });
        }
      } else if (component.format !== 'LOCATION' && !component.example?.header_handle?.length) {
        issues.push({
          field: 'header.example',
          message: `A ${component.format} header needs an example media handle`,
        });
      }
    }

    if (component.type === 'BODY') {
      issues.push(...validateBodyText(component.text));
      const vars = variableCount(component.text);
      if (vars > 0) {
        const examples = component.example?.body_text?.[0] ?? [];
        if (examples.length !== vars) {
          issues.push({
            field: 'body.example',
            message: `Provide ${vars} example value(s) for the body variables (got ${examples.length})`,
          });
        }
      }
    }

    if (component.type === 'FOOTER') {
      if (component.text.length > LIMITS.footerMaxChars) {
        issues.push({ field: 'footer.text', message: `Footer must be at most ${LIMITS.footerMaxChars} characters` });
      }
      if (variableCount(component.text) > 0) {
        issues.push({ field: 'footer.text', message: 'Footers cannot contain variables' });
      }
    }

    if (component.type === 'BUTTONS') {
      if (component.buttons.length === 0) {
        issues.push({ field: 'buttons', message: 'A BUTTONS component needs at least one button' });
      }
      if (component.buttons.length > LIMITS.maxButtons) {
        issues.push({ field: 'buttons', message: `At most ${LIMITS.maxButtons} buttons are allowed` });
      }
      const seen = new Set<string>();
      component.buttons.forEach((button, i) => {
        const label = button.text ?? '';
        if (!label.trim()) issues.push({ field: `buttons[${i}].text`, message: 'Button text is required' });
        if (seen.has(label.toLowerCase())) {
          issues.push({ field: `buttons[${i}].text`, message: `Duplicate button text "${label}"` });
        }
        seen.add(label.toLowerCase());
        if (button.type === 'QUICK_REPLY' && label.length > LIMITS.quickReplyTextMaxChars) {
          issues.push({
            field: `buttons[${i}].text`,
            message: `Quick-reply text must be at most ${LIMITS.quickReplyTextMaxChars} characters (got ${label.length})`,
          });
        }
        if (button.type === 'URL') {
          if (!/^https?:\/\//i.test(button.url)) {
            issues.push({ field: `buttons[${i}].url`, message: 'URL buttons need an absolute http(s) URL' });
          }
          if (variableCount(button.url) > 0 && !button.example?.length) {
            issues.push({ field: `buttons[${i}].example`, message: 'Provide an example for the URL variable' });
          }
        }
      });
    }
  }

  if (counts.BODY !== 1) issues.push({ field: 'components', message: 'A template needs exactly one BODY component' });
  if (counts.HEADER > 1) issues.push({ field: 'components', message: 'At most one HEADER component is allowed' });
  if (counts.FOOTER > 1) issues.push({ field: 'components', message: 'At most one FOOTER component is allowed' });
  if (counts.BUTTONS > 1) issues.push({ field: 'components', message: 'At most one BUTTONS component is allowed' });

  return issues;
}

export function validateTemplate(template: TemplateDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!/^[a-z0-9_]+$/.test(template.name)) {
    issues.push({ field: 'name', message: 'Template names may contain only lowercase letters, digits and underscores' });
  }
  if (template.name.length > LIMITS.nameMaxChars) {
    issues.push({ field: 'name', message: `Template name must be at most ${LIMITS.nameMaxChars} characters` });
  }
  if (!template.language) {
    issues.push({ field: 'language', message: 'Template language is required' });
  }
  if (!['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(template.category)) {
    issues.push({ field: 'category', message: 'Category must be MARKETING, UTILITY or AUTHENTICATION' });
  }

  issues.push(...validateComponents(template.components));
  return { valid: issues.length === 0, issues };
}

/** Number of body variables a template expects — used when filling it in. */
export function bodyVariableCount(template: TemplateDefinition): number {
  const body = template.components.find((c): c is Extract<TemplateComponent, { type: 'BODY' }> => c.type === 'BODY');
  return body ? variableCount(body.text) : 0;
}

/** Render a template body locally for previews and for the message log. */
export function renderBody(text: string, values: string[]): string {
  return text.replace(VARIABLE_RE, (_match, index: string) => {
    const value = values[Number(index) - 1];
    return value === undefined ? `{{${index}}}` : value;
  });
}
