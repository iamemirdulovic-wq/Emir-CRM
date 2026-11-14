import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

/**
 * No emoji in the sentences the server writes.
 *
 * Emir has asked for none, three times. A sentence the server writes is as
 * much "anywhere" as a button is: it goes on the screen AND into the lead's
 * timeline, so a picture written here outlives the screen that drew it. On
 * 14 Nov three were still in `SAID` — "Moved to Interested 🔥", "Meeting
 * booked 📅", "Deal won! 🏆" — months after the rule was given, because
 * nothing checked.
 *
 * The note box strips pictographs on the way to the screen. That is a guard,
 * not a reason to keep writing them: the stripped version is what a person
 * sees, while the stored timeline keeps the emoji for ever.
 *
 * **Country flags are deliberately exempt.** They are emoji, and they are
 * wanted — the leads list draws a flag beside every number and the owner's
 * own design shows them. So this checks the files that write SENTENCES, not
 * the flag table. Adding a file here is cheap; widening it to all of `src`
 * would fail on `countries.ts` and get switched off, which is worse than no
 * check at all.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** The files that write words a person reads. */
const SENTENCE_FILES = [
  join(HERE, 'actions.ts'),
  join(HERE, '..', 'v2', 'call-results.ts'),
];

/**
 * A pictograph, not punctuation and not a letter in somebody's alphabet.
 *
 * Deliberately narrow: `·`, `—`, `×`, `→` and every accented or Arabic or
 * Cyrillic letter must pass, because the CRM is full of them on purpose.
 */
const PICTOGRAPH = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

it('writes no emoji in the sentences a person reads', async () => {
  const offences: string[] = [];
  for (const file of SENTENCE_FILES) {
    const text = await readFile(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      const found = line.match(PICTOGRAPH);
      if (found) offences.push(`${file.split('/').slice(-2).join('/')}:${i + 1}  ${found[0]}  ${line.trim().slice(0, 70)}`);
    });
  }
  expect(offences, `Emoji in a sentence the server writes:\n${offences.join('\n')}`).toEqual([]);
});

it('still allows the things that are not emoji', () => {
  /* The guard has to let these through or it will be switched off. */
  for (const ok of ['No answer · try 2 of 5', 'Overdue — call them', 'No answer ×2',
    'Prüfen', 'محمد عبد الله', 'Светлана', "Sarah O’Brien"]) {
    expect(PICTOGRAPH.test(ok), `${ok} should not be flagged`).toBe(false);
  }
  /* And it has to catch the three that were really there. */
  for (const bad of ['Moved to Interested 🔥', 'Meeting booked 📅', 'Deal won! 🏆']) {
    expect(PICTOGRAPH.test(bad), `${bad} should be flagged`).toBe(true);
  }
});
