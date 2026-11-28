import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { CAPI_EVENT_NAMES, LEAD_EVENT_SOURCE } from './meta-capi.js';

const read = () => readFile(new URL('./meta-capi.ts', import.meta.url), 'utf8');

/**
 * The payload Meta's Conversion Leads specification asks for.
 *
 * Checked against the spec rather than against our own idea of it, because
 * the failure mode here is silent: Meta accepts an event, Events Manager
 * shows it arriving, and the campaign optimises on nothing because the event
 * was not recognised as a CRM conversion. Nobody finds that for a month.
 *
 * Spec: developers.facebook.com → Conversions API → Conversion Leads
 * integration → Payload specification.
 */
describe('the Conversion Leads payload', () => {
  it('marks every event as system generated, which the spec requires', async () => {
    expect(await read()).toContain("action_source: 'system_generated'");
  });

  it('carries lead_event_source and event_source on EVERY event, not just the sale', async () => {
    /*
     * Both are required by the spec and both lived inside the reservation's
     * `custom_data`, so `contacted`, `qualified` and `appointment` went up
     * without either -- and those stages are the reason this feature exists.
     */
    const src = await read();
    const custom = src.slice(src.indexOf('custom_data: {'), src.indexOf('},', src.indexOf('custom_data: {')));
    expect(custom).toContain('lead_event_source: LEAD_EVENT_SOURCE');
    expect(custom).toContain("event_source: 'crm'");
    // The value rides along on a reservation; it does not replace them.
    expect(custom).toContain('value: Number(row.deal_value_aed)');
  });

  it('names this CRM as the source, since Events Manager shows it', () => {
    expect(LEAD_EVENT_SOURCE).toMatch(/homes\.me/i);
  });

  it('sends the lead id as a number, as the spec example does', async () => {
    expect(await read()).toContain('userData.lead_id = Number(row.meta_lead_id)');
  });

  it('keeps the stages the brief names, plus the one it asks for elsewhere', () => {
    /*
     * The brief's PIPELINE section lists six. Its INTELLIGENCE section then
     * asks for confirmed junk to be fed back as a lead-quality event too, and
     * for a year nothing did: a lead marked invalid reported nothing at all,
     * so Meta could not tell junk from a lead nobody had worked yet.
     *
     * `invalid_lead` is that seventh. The list is pinned here because every
     * name in it has to exist in Events Manager's own funnel mapping as well
     * -- Meta accepts an unmapped event and quietly ignores it -- so adding
     * one is never only a code change, and this test is where that gets
     * noticed.
     */
    expect([...CAPI_EVENT_NAMES]).toEqual([
      'valid_lead', 'invalid_lead', 'contacted', 'qualified', 'appointment',
      'show', 'reservation',
    ]);
  });

  it('hashes every piece of a person before it leaves the server', async () => {
    const src = await read();
    for (const field of ['userData.ph', 'userData.em', 'userData.fn', 'userData.ln']) {
      const line = src.slice(src.indexOf(field), src.indexOf('\n', src.indexOf(field)));
      expect(line).toMatch(/Hash/);
    }
    /* And a raw column never reaches the payload directly. */
    expect(src).not.toMatch(/userData\.(ph|em|fn|ln)\s*=\s*\[?row\./);
  });
});
