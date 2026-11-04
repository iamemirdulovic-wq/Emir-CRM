import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_SETS, ONBOARDING_QUESTIONS, QUESTION_IDS,
  cleanAnswers, cleanAvatarSet, isComplete,
} from './questions.js';

/**
 * What an agent types on their first morning, on a phone, in a hurry.
 *
 * The questions are Emir's and will be reworded. What must not move is the
 * id each answer is stored under, and what the cleaner accepts: a number
 * question that lets "5-6 inshallah" through is a column nobody can compare,
 * and a text question with no ceiling is a row somebody pastes a novel into.
 */
describe('the question list', () => {
  it('has an id for every question, and no duplicates', () => {
    expect(QUESTION_IDS).toHaveLength(ONBOARDING_QUESTIONS.length);
    expect(new Set(QUESTION_IDS).size).toBe(QUESTION_IDS.length);
  });

  it('asks the five Emir asked for', () => {
    expect(QUESTION_IDS).toEqual([
      'goal_this_year', 'deals_per_month', 'growth_view', 'the_dream', 'five_years',
    ]);
  });

  it('gives every question something to show and a kind to render', () => {
    for (const q of ONBOARDING_QUESTIONS) {
      expect(q.prompt.length).toBeGreaterThan(0);
      expect(q.emoji.length).toBeGreaterThan(0);
      expect(['text', 'number']).toContain(q.kind);
    }
  });
});

describe('cleaning what they typed', () => {
  it('keeps a plain answer', () => {
    expect(cleanAnswers({ the_dream: 'A house for my mother' }))
      .toEqual({ the_dream: 'A house for my mother' });
  });

  it('trims the spaces somebody leaves on a phone keyboard', () => {
    expect(cleanAnswers({ the_dream: '  a team of my own  ' }))
      .toEqual({ the_dream: 'a team of my own' });
  });

  it('drops an answer that is only spaces rather than storing an empty one', () => {
    expect(cleanAnswers({ the_dream: '   ' })).toEqual({});
  });

  it('ignores a question nobody wrote', () => {
    expect(cleanAnswers({ favourite_colour: 'teal' })).toEqual({});
  });

  it('survives rubbish instead of an object', () => {
    expect(cleanAnswers(null)).toEqual({});
    expect(cleanAnswers('nope')).toEqual({});
    expect(cleanAnswers(['a'])).toEqual({});
  });

  /* 280 characters is a long answer on a phone. Past that it is a paste. */
  it('cuts a very long answer rather than refusing it', () => {
    const long = 'x'.repeat(400);
    expect(cleanAnswers({ the_dream: long }).the_dream).toHaveLength(280);
  });

  describe('the deals-a-month number', () => {
    it('takes a number', () => {
      expect(cleanAnswers({ deals_per_month: 4 })).toEqual({ deals_per_month: '4' });
    });

    it('takes a number typed as text, because an input gives a string', () => {
      expect(cleanAnswers({ deals_per_month: '6' })).toEqual({ deals_per_month: '6' });
    });

    it('rounds rather than storing half a deal', () => {
      expect(cleanAnswers({ deals_per_month: 2.6 })).toEqual({ deals_per_month: '3' });
    });

    it('refuses a sentence, which is the whole reason it is a number', () => {
      expect(cleanAnswers({ deals_per_month: '5-6 inshallah' })).toEqual({});
    });

    it('pulls an impossible number back into range', () => {
      expect(cleanAnswers({ deals_per_month: 5000 })).toEqual({ deals_per_month: '100' });
      expect(cleanAnswers({ deals_per_month: -3 })).toEqual({ deals_per_month: '0' });
    });

    /* Zero is a real answer from somebody starting this month. */
    it('keeps a zero', () => {
      expect(cleanAnswers({ deals_per_month: 0 })).toEqual({ deals_per_month: '0' });
    });
  });
});

describe('knowing when they are finished', () => {
  const all = Object.fromEntries(QUESTION_IDS.map((id) => [id, 'something']));

  it('is finished when every question has an answer', () => {
    expect(isComplete(all)).toBe(true);
  });

  it('is not finished with one left', () => {
    const { five_years: _omitted, ...rest } = all;
    expect(isComplete(rest)).toBe(false);
  });

  it('is not finished with nothing', () => {
    expect(isComplete({})).toBe(false);
  });

  /* "0" is falsy as a number and truthy as a string; the answer is stored as
     a string for exactly this reason, so a zero still counts as answered. */
  it('counts a zero as an answer', () => {
    expect(isComplete({ ...all, deals_per_month: '0' })).toBe(true);
  });
});

describe('the picture beside each question', () => {
  /*
   * Each question names the illustration that stands beside it. The picture
   * is served from /onboarding/{set}-{image}.webp, so a name here that has no
   * file is a blank panel on somebody's first morning, and nothing else would
   * catch it.
   */
  it('names a picture that exists on disk, for both sets', () => {
    /* Reads the folder rather than a list copied here, because a list copied
       here agrees with itself while the file is missing. A question pointing
       at a pose nobody drew is a blank panel on somebody's first morning,
       and no type check or render test would say so. */
    const dir = path.join(
      path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
      'web', 'public', 'onboarding',
    );
    const files = new Set(readdirSync(dir));
    for (const question of ONBOARDING_QUESTIONS) {
      for (const set of AVATAR_SETS) {
        const wanted = `${set}-${question.image}.webp`;
        expect(files, `${question.id} wants ${wanted}, which is not there`)
          .toContain(wanted);
      }
    }
  });

  it('does not show the same picture twice', () => {
    const used = ONBOARDING_QUESTIONS.map((q) => q.image);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe('the character sets', () => {
  it('takes the two that exist', () => {
    expect(cleanAvatarSet('man')).toBe('man');
    expect(cleanAvatarSet('woman')).toBe('woman');
  });

  it('refuses anything else, including nothing', () => {
    for (const bad of ['robot', 'MAN', '', null, undefined, 7, {}]) {
      expect(cleanAvatarSet(bad)).toBeNull();
    }
  });
});
