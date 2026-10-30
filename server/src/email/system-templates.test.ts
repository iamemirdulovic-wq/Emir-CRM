import { describe, expect, it } from 'vitest';
import { SYSTEM_TEMPLATES, systemTemplate } from './system-templates.js';
import { merge, unknownFields } from './merge.js';

describe('the templates the CRM ships with', () => {
  it('ships six', () => {
    expect(SYSTEM_TEMPLATES).toHaveLength(6);
  });

  it('has a unique key for each', () => {
    const keys = SYSTEM_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('can be looked up by key', () => {
    expect(systemTemplate('first_reply')?.name).toBe('First reply');
    expect(systemTemplate('nope')).toBeUndefined();
  });

  it.each(SYSTEM_TEMPLATES.map((t) => [t.key, t]))('%s uses only real merge fields', (_key, template) => {
    expect(unknownFields(template.subject)).toEqual([]);
    expect(unknownFields(template.body)).toEqual([]);
  });

  it.each(SYSTEM_TEMPLATES.map((t) => [t.key, t]))('%s reads correctly with nothing known', (_key, template) => {
    /* The worst case: a lead with no name and no project. Nothing may show a
       raw placeholder, because that is what tells a client they are a row. */
    const subject = merge(template.subject, {}, { html: false }).text;
    const body = merge(template.body, {}, { html: false }).text;
    expect(subject).not.toMatch(/\{\{/);
    expect(body).not.toMatch(/\{\{/);
    expect(body).toContain('Hi there');
  });

  it.each(SYSTEM_TEMPLATES.map((t) => [t.key, t]))('%s is short enough to be read on a phone', (_key, template) => {
    expect(template.body.split(/\s+/).length).toBeLessThan(140);
  });

  /*
   * An email that asks nothing gets no reply — except a confirmation, whose
   * job is to tell someone where to be and what to bring. Asking a client to
   * reply to a booking confirmation is noise.
   */
  const WANTS_A_REPLY = SYSTEM_TEMPLATES.filter((t) => t.category !== 'appointment');

  it.each(WANTS_A_REPLY.map((t) => [t.key, t]))('%s gives the reader one clear ask', (_key, template) => {
    /* Not necessarily a question: "tell me which layout you prefer" is an
       ask, and a better one than a question mark. What matters is that there
       is one, and not three competing for the same reply. */
    const asks = (template.body.match(/\?|\btell me\b|\blet me know\b|\bsay\b|\bsend me\b/gi) ?? []).length;
    expect(asks).toBeGreaterThan(0);
    expect(asks).toBeLessThanOrEqual(3);
  });

  it('the viewing confirmation says where to be and what to bring instead', () => {
    const body = systemTemplate('viewing_confirmation')?.body ?? '';
    expect(body).toMatch(/Emirates ID/i);
    expect(body).toMatch(/\{\{agent_phone\}\}/);
    expect(body).toMatch(/confirmed/i);
  });

  it.each(SYSTEM_TEMPLATES.map((t) => [t.key, t]))('%s quotes no price or date', (_key, template) => {
    /* Prices, handover dates and payment plans come from the projects table
       and belong in an offer, where they are versioned. A number typed into
       a template is a number nobody updates. */
    const text = `${template.subject} ${template.body}`;
    expect(text).not.toMatch(/AED\s*[\d,]/i);
    expect(text).not.toMatch(/\b20\d\d\b/);
    expect(text).not.toMatch(/\b\d+\s*%/);
    expect(text).not.toMatch(/\b\d+\s*\/\s*\d+\b/);
  });

  it.each(SYSTEM_TEMPLATES.map((t) => [t.key, t]))('%s invents no scarcity', (_key, template) => {
    expect(template.body).not.toMatch(/only \d+ (units?|left)/i);
    expect(template.body).not.toMatch(/last chance|hurry|act now|don't miss/i);
  });

  it.each(SYSTEM_TEMPLATES.map((t) => [t.key, t]))('%s has a subject that fits an inbox list', (_key, template) => {
    const rendered = merge(template.subject, {
      projectName: 'Emaar Beachfront', agentFirstName: 'Layla', companyName: 'Emigeo Homes',
    }, { html: false }).text;
    expect(rendered.length).toBeLessThanOrEqual(78);
    expect(rendered.length).toBeGreaterThan(8);
  });

  it.each(SYSTEM_TEMPLATES.map((t) => [t.key, t]))('%s has preview text that adds to the subject', (_key, template) => {
    expect(template.previewText.length).toBeGreaterThan(10);
    expect(template.previewText.length).toBeLessThanOrEqual(120);
    expect(template.previewText.toLowerCase()).not.toBe(template.subject.toLowerCase());
  });

  it('offers a way out in the ones that chase', () => {
    /* A follow-up that cannot be stopped is the one that gets reported. */
    expect(systemTemplate('after_no_answer')?.body).toMatch(/stop chasing|moved on/i);
    expect(systemTemplate('quiet_lead')?.body).toMatch(/not interested|back burner/i);
  });
});
