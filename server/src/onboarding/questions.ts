/**
 * The five questions a new agent answers on their first sign-in.
 *
 * Emir's questions, Nov 4, 2026, tightened for a phone. Each one is short
 * enough to read in a glance and open enough that nobody can answer it with
 * one word by accident.
 *
 * They live on the server, not in the web app, for one reason: an answer is
 * stored under its question's id, so if the wording moves the stored answers
 * must still line up. One list, one place, and the web app asks for it.
 *
 * Two of them take a number rather than a sentence. A free-text "how many
 * deals a month" comes back as "5-6 inshallah", which reads nicely and
 * cannot be put in a column or compared between people.
 */
export interface OnboardingQuestion {
  id: string;
  emoji: string;
  /** What the agent reads. */
  prompt: string;
  /** The quieter line under it, when the prompt alone could be read two ways. */
  hint?: string;
  kind: 'text' | 'number';
  placeholder?: string;
  /** Only for kind 'number'. */
  min?: number;
  max?: number;
  maxLength?: number;
  /**
   * Which of the five poses stands beside this question. The file is
   * `/onboarding/{set}-{image}.webp`, where the set is the character the
   * agent picked, so the mapping lives next to the wording it illustrates
   * rather than in a second list in the web app that drifts from it.
   */
  image: OnboardingImage;
}

export type OnboardingImage = 'working' | 'ideas' | 'keys' | 'dream' | 'celebrate';

/** The two sets of pictures. A choice of character, not a field about a person. */
export const AVATAR_SETS = ['man', 'woman'] as const;
export type AvatarSet = (typeof AVATAR_SETS)[number];

export function cleanAvatarSet(value: unknown): AvatarSet | null {
  return AVATAR_SETS.includes(value as AvatarSet) ? (value as AvatarSet) : null;
}

export const ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  {
    id: 'goal_this_year',
    image: 'working',
    emoji: '🎯',
    prompt: 'What are you going after this year?',
    hint: 'One thing. The one that would make the year a good one.',
    kind: 'text',
    placeholder: 'My first AED 10M deal',
    maxLength: 280,
  },
  {
    id: 'deals_per_month',
    image: 'keys',
    emoji: '🤝',
    prompt: 'Deals a month. What is your number?',
    hint: 'Not a promise. What you think you can do.',
    kind: 'number',
    min: 0,
    max: 100,
  },
  {
    id: 'growth_view',
    image: 'ideas',
    emoji: '📈',
    prompt: 'How big do you think homes.me can get?',
    hint: 'Say it however you like. Deals, people, a feeling.',
    kind: 'text',
    placeholder: 'Top three in Dubai off-plan within two years',
    maxLength: 280,
  },
  {
    id: 'the_dream',
    image: 'dream',
    emoji: '✨',
    prompt: 'What is the dream?',
    hint: 'Yours, not the company’s.',
    kind: 'text',
    placeholder: 'A house for my mother, and a team of my own',
    maxLength: 280,
  },
  {
    id: 'five_years',
    image: 'celebrate',
    emoji: '🗺️',
    prompt: 'Where are you in five years?',
    kind: 'text',
    placeholder: 'Running the Abu Dhabi desk',
    maxLength: 280,
  },
];

export const QUESTION_IDS = ONBOARDING_QUESTIONS.map((q) => q.id);

/**
 * Keep only answers to questions that exist, trimmed, within their limits.
 *
 * A question Emir rewords keeps its id and its answers; a question he removes
 * leaves answers behind that nothing asks for any more, and they are dropped
 * here rather than shown under a prompt nobody wrote.
 */
export function cleanAnswers(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const out: Record<string, string> = {};

  for (const question of ONBOARDING_QUESTIONS) {
    const value = raw[question.id];
    if (value === null || value === undefined) continue;

    if (question.kind === 'number') {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      if (!Number.isFinite(n)) continue;
      const clamped = Math.min(question.max ?? 1000, Math.max(question.min ?? 0, Math.round(n)));
      out[question.id] = String(clamped);
      continue;
    }

    const text = String(value).trim().slice(0, question.maxLength ?? 280);
    if (text) out[question.id] = text;
  }
  return out;
}

/** Every question answered. What the last screen waits for before saying thank you. */
export function isComplete(answers: Record<string, string>): boolean {
  return QUESTION_IDS.every((id) => Boolean(answers[id]));
}
