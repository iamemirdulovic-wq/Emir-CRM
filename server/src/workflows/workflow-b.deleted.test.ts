import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A deleted lead is a soft delete: its rows stay, still open, still in New
 * Lead. The no-reply sequence must treat it as gone, or every step puts a new
 * call task, and an Overdue email, in front of an agent for a lead nobody can
 * open. Unit-level so it runs without MySQL; the database side is in
 * workflows.integration.test.ts.
 */
const rows = vi.hoisted(() => ({
  opportunity: null as Record<string, unknown> | null,
  contact: null as Record<string, unknown> | null,
}));

vi.mock('../db/client.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../db/client.js')>(),
  queryOne: vi.fn(async (sql: string) =>
    sql.includes('FROM opportunities') ? rows.opportunity : rows.contact),
}));

const { shouldContinue } = await import('./workflow-b.js');

describe('workflow B: a deleted lead', () => {
  beforeEach(() => {
    rows.opportunity = { status: 'open', stage_key: 'attempted_contact', deleted_at: null };
    rows.contact = { dnc: 0, last_inbound_at: null, deleted_at: null };
  });

  it('keeps going for a live lead', async () => {
    expect((await shouldContinue('c1', 'o1')).ok).toBe(true);
  });

  it('stops when the enquiry was deleted', async () => {
    rows.opportunity = { ...rows.opportunity, deleted_at: new Date() };
    expect(await shouldContinue('c1', 'o1')).toEqual({ ok: false, reason: 'lead_deleted' });
  });

  it('stops when the contact was deleted', async () => {
    rows.contact = { ...rows.contact, deleted_at: new Date() };
    expect(await shouldContinue('c1', 'o1')).toEqual({ ok: false, reason: 'lead_deleted' });
  });
});
