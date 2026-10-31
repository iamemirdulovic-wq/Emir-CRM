import { describe, expect, it } from 'vitest';
import { stageAfterNote, STAGE_AFTER_NOTE, SUB_STATUS_AFTER_NOTE } from './note-stage.js';
import { STAGE_DEFINITIONS } from '../pipeline/stages.js';

const note = (over: Partial<Parameters<typeof stageAfterNote>[0]> = {}) => stageAfterNote({
  stageKey: 'new_lead', status: 'open', authorRole: 'agent', ...over,
});

describe('a note moves a new lead to Attempted Contact', () => {
  it('moves it, with the first attempt recorded', () => {
    expect(note()).toEqual({ to: 'attempted_contact', subStatus: 'attempt_1' });
  });

  it('moves it whoever wrote the note, because anyone may be the one calling', () => {
    for (const role of ['agent', 'manager', 'admin', 'owner'] as const) {
      expect(note({ authorRole: role }), role).not.toBeNull();
    }
  });

  it('never moves a lead that is already further along', () => {
    for (const stage of STAGE_DEFINITIONS.filter((s) => s.key !== 'new_lead')) {
      expect(note({ stageKey: stage.key }), stage.key).toBeNull();
    }
  });

  it('leaves a won or lost lead exactly where it is', () => {
    expect(note({ status: 'won' })).toBeNull();
    expect(note({ status: 'lost' })).toBeNull();
  });

  it('ignores a note the system wrote itself', () => {
    expect(note({ authorRole: 'automation' })).toBeNull();
    expect(note({ authorRole: null })).toBeNull();
  });

  it('names a stage and a sub-status the pipeline actually has', () => {
    const stage = STAGE_DEFINITIONS.find((s) => s.key === STAGE_AFTER_NOTE);
    expect(stage, 'the stage must exist').toBeDefined();
    expect(stage?.subStatuses).toContain(SUB_STATUS_AFTER_NOTE);
  });
});
