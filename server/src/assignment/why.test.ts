import { describe, expect, it } from 'vitest';
import { assignmentTitle } from './why.js';

/**
 * "Assigned by sticky_owner" does not appear on a lead's history.
 *
 * Two places built the line as `Assigned by ${reason}` out of the routing
 * code's own word, and one of them did not even take the underscores out. The
 * history is read by agents and by the owner; Emir, 13 Nov: that phrase goes.
 *
 * The machine-readable reason is untouched — it still goes into the activity's
 * `meta.reason` and into the audit entry — so nothing that counts how leads
 * were routed is affected. This is only the sentence a person reads.
 */

describe('why a lead went to this agent, in words', () => {
  it('never says "assigned by", and never prints a code name', () => {
    const reasons = [
      'sticky_owner', 'language_and_project', 'project', 'language', 'round_robin',
      'bulk import', 'bulk action', 'agent left', 'untouched for 30 days on "Expo 2026"',
      'something nobody has mapped yet', '',
    ];
    for (const reason of reasons) {
      const title = assignmentTitle(reason);
      expect(title, reason).not.toMatch(/assigned by/i);
      expect(title, reason).not.toMatch(/_/);
      expect(title.length, reason).toBeGreaterThan(8);
    }
  });

  it('says the sticky owner in the words a person would use', () => {
    expect(assignmentTitle('sticky_owner')).toBe('Back to the agent who dealt with them before');
  });

  it('says what the routing actually matched on', () => {
    expect(assignmentTitle('language_and_project'))
      .toBe('Given to an agent who speaks their language and knows the project');
    expect(assignmentTitle('project')).toBe('Given to an agent who knows the project');
    expect(assignmentTitle('language')).toBe('Given to an agent who speaks their language');
    expect(assignmentTitle('round_robin')).toBe('Given to the next agent in turn');
  });

  it('reads properly for a batch hand-out', () => {
    expect(assignmentTitle('bulk import')).toBe('Given out with an imported list');
    expect(assignmentTitle('bulk action')).toBe('Given out by hand');
  });

  /*
   * The recycling reason is free text written by the caller and includes the
   * list's own name. "Assigned by untouched for 30 days on "Expo 2026"" was
   * the line it produced, which is not a sentence.
   */
  it('wraps the recycling reason in a sentence instead of a preposition', () => {
    expect(assignmentTitle('untouched for 30 days on "Expo 2026"'))
      .toBe('Moved on — untouched for 30 days on "Expo 2026"');
  });

  it('still says something when the reason is missing', () => {
    expect(assignmentTitle(null)).toBe('Given to an agent');
    expect(assignmentTitle(undefined)).toBe('Given to an agent');
    expect(assignmentTitle('   ')).toBe('Given to an agent');
  });

  it('turns an unmapped reason into words rather than printing it raw', () => {
    expect(assignmentTitle('new_rule_nobody_mapped'))
      .toBe('Given to an agent — new rule nobody mapped');
  });
});
