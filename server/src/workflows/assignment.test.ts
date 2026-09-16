import { describe, expect, it } from 'vitest';
import { chooseAgent, coversProject, isEligible, isOnShift, speaksLanguage, type Candidate } from './assignment.js';

const agent = (over: Partial<Candidate> = {}): Candidate => ({
  id: 'a1',
  name: 'Agent One',
  isActive: true,
  availability: 'available',
  shiftStart: null,
  shiftEnd: null,
  languages: ['en'],
  projectsCovered: [],
  weight: 10,
  assignedCount: 0,
  ...over,
});

const NOON = 12 * 60;

describe('eligibility', () => {
  it('excludes inactive, busy and off-shift agents', () => {
    expect(isEligible(agent({ isActive: false }), NOON)).toBe(false);
    expect(isEligible(agent({ availability: 'busy' }), NOON)).toBe(false);
    expect(isEligible(agent({ availability: 'off' }), NOON)).toBe(false);
    expect(isEligible(agent(), NOON)).toBe(true);
  });

  it('treats an agent with no recorded shift as always on', () => {
    expect(isOnShift(agent(), 3 * 60)).toBe(true);
  });

  it('respects a daytime shift', () => {
    const nine_to_six = agent({ shiftStart: '09:00', shiftEnd: '18:00' });
    expect(isOnShift(nine_to_six, 8 * 60 + 59)).toBe(false);
    expect(isOnShift(nine_to_six, 9 * 60)).toBe(true);
    expect(isOnShift(nine_to_six, 17 * 60 + 59)).toBe(true);
    expect(isOnShift(nine_to_six, 18 * 60)).toBe(false);
  });

  it('handles a shift that runs through midnight', () => {
    const overnight = agent({ shiftStart: '20:00', shiftEnd: '04:00' });
    expect(isOnShift(overnight, 21 * 60)).toBe(true);
    expect(isOnShift(overnight, 2 * 60)).toBe(true);
    expect(isOnShift(overnight, 12 * 60)).toBe(false);
  });
});

describe('preferences', () => {
  it('matches language case-insensitively', () => {
    expect(speaksLanguage(agent({ languages: ['EN', 'ar'] }), 'en')).toBe(true);
    expect(speaksLanguage(agent({ languages: ['en'] }), 'ar')).toBe(false);
    expect(speaksLanguage(agent(), null)).toBe(false);
  });

  it('matches project coverage ignoring punctuation and sub-towers', () => {
    const a = agent({ projectsCovered: ['Emaar Beachfront'] });
    expect(coversProject(a, 'Emaar Beachfront')).toBe(true);
    expect(coversProject(a, 'emaar  beachfront')).toBe(true);
    expect(coversProject(a, 'Emaar Beachfront Tower 2')).toBe(true);
    expect(coversProject(a, 'Damac Lagoons')).toBe(false);
    expect(coversProject(a, null)).toBe(false);
  });
});

describe('chooseAgent', () => {
  it('reports when nobody is available', () => {
    const choice = chooseAgent([agent({ availability: 'off' })], { language: 'en', projectName: null, dubaiMinutes: NOON });
    expect(choice).toEqual({ assigned: false, reason: 'no_agent_available' });
    expect(chooseAgent([], { language: null, projectName: null, dubaiMinutes: NOON }).assigned).toBe(false);
  });

  it('prefers an agent who speaks the language and covers the project', () => {
    const choice = chooseAgent(
      [
        agent({ id: 'generalist' }),
        agent({ id: 'arabic', languages: ['ar'] }),
        agent({ id: 'project', projectsCovered: ['Emaar Beachfront'] }),
        agent({ id: 'both', languages: ['ar'], projectsCovered: ['Emaar Beachfront'] }),
      ],
      { language: 'ar', projectName: 'Emaar Beachfront', dubaiMinutes: NOON },
    );
    expect(choice.assigned && choice.userId).toBe('both');
    expect(choice.assigned && choice.reason).toBe('language_and_project');
  });

  it('falls back to project coverage, then language, then anyone', () => {
    const base = { language: 'ar', projectName: 'Emaar Beachfront', dubaiMinutes: NOON };

    expect(
      chooseAgent([agent({ id: 'generalist' }), agent({ id: 'project', projectsCovered: ['Emaar Beachfront'] })], base)
        .assigned &&
        chooseAgent([agent({ id: 'generalist' }), agent({ id: 'project', projectsCovered: ['Emaar Beachfront'] })], base),
    ).toMatchObject({ userId: 'project', reason: 'project' });

    expect(chooseAgent([agent({ id: 'generalist' }), agent({ id: 'arabic', languages: ['ar'] })], base)).toMatchObject({
      userId: 'arabic',
      reason: 'language',
    });

    expect(chooseAgent([agent({ id: 'generalist' })], base)).toMatchObject({
      userId: 'generalist',
      reason: 'round_robin',
    });
  });

  it('gives the next lead to the agent furthest below their share', () => {
    const choice = chooseAgent(
      [agent({ id: 'busy', assignedCount: 8 }), agent({ id: 'quiet', assignedCount: 2 })],
      { language: null, projectName: null, dubaiMinutes: NOON },
    );
    expect(choice.assigned && choice.userId).toBe('quiet');
  });

  it('honours weights: a double-weighted agent takes twice the volume', () => {
    const candidates = [agent({ id: 'heavy', weight: 20 }), agent({ id: 'light', weight: 10 })];
    const counts: Record<string, number> = { heavy: 0, light: 0 };

    for (let i = 0; i < 30; i += 1) {
      const choice = chooseAgent(candidates, { language: null, projectName: null, dubaiMinutes: NOON });
      if (!choice.assigned) throw new Error('expected an assignment');
      counts[choice.userId] = (counts[choice.userId] ?? 0) + 1;
      const winner = candidates.find((c) => c.id === choice.userId);
      if (winner) winner.assignedCount += 1;
    }
    expect(counts.heavy).toBe(20);
    expect(counts.light).toBe(10);
  });

  it('is deterministic when everything ties', () => {
    const candidates = [agent({ id: 'b' }), agent({ id: 'a' })];
    const request = { language: null, projectName: null, dubaiMinutes: NOON };
    expect(chooseAgent(candidates, request)).toEqual(chooseAgent(candidates, request));
    expect(chooseAgent(candidates, request).assigned && chooseAgent(candidates, request)).toMatchObject({ userId: 'a' });
  });

  it('skips an agent whose weight is zero', () => {
    const choice = chooseAgent([agent({ id: 'paused', weight: 0 }), agent({ id: 'active' })], {
      language: null,
      projectName: null,
      dubaiMinutes: NOON,
    });
    expect(choice.assigned && choice.userId).toBe('active');
  });

  it('respects shifts when choosing', () => {
    const choice = chooseAgent(
      [agent({ id: 'night', shiftStart: '20:00', shiftEnd: '04:00' }), agent({ id: 'day', shiftStart: '09:00', shiftEnd: '18:00' })],
      { language: null, projectName: null, dubaiMinutes: 22 * 60 },
    );
    expect(choice.assigned && choice.userId).toBe('night');
  });
});
