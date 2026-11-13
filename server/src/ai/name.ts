/**
 * What the assistant is called, and where its settings are.
 *
 * It is **Homes AI**. It was called Emir AI while the brand was being decided,
 * and the screens were renamed and the server was not — so on 13 Nov the
 * owner's own health page listed a service called "Emir AI" beside a menu row
 * called "Homes AI", and every failure the assistant could have sent him to
 * "Settings → Emir AI", which is not a menu item that exists anywhere.
 *
 * Two constants rather than the words typed out thirty times, because that is
 * how the two halves drifted apart in the first place. `name.test.ts` reads
 * the source and fails if the old name comes back.
 *
 * The real menu row is Settings → Homes AI (`/v2/settings/ai` in v2,
 * `/settings?tab=ai` in the CRM running today), which is where the Gemini key,
 * the model and the monthly spending cap live.
 */

/** The assistant's name, everywhere a person reads it. */
export const AI_NAME = 'Homes AI';

/** Where an owner goes to fix the key, the model or the budget. */
export const AI_SETTINGS = 'Settings → Homes AI';
