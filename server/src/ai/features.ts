/**
 * What Homes AI may do.
 *
 * `design/web/ai-settings.html` gives an owner one switch per feature, which
 * is the difference between narrowing the AI and turning it off: an owner who
 * is uneasy about voice notes should not have to remove the key and lose the
 * lead summaries too.
 *
 * Each is on by default, because a key that has been added is a decision to
 * use it. The read is one `app_settings` lookup per feature and those are
 * cached, so a screen that asks for all five costs nothing.
 */
import { saveSetting, setting, type SettingName } from '../config/secrets.js';
import type { AuditActor } from '../audit/audit.js';
import { getPool, type Executor } from '../db/client.js';

export const AI_FEATURES = {
  summary: {
    name: 'AI_CAN_SUMMARY' as SettingName,
    title: 'Write "In short" on each lead',
    note: '3 lines from the notes and timeline, new after each change',
  },
  bestTime: {
    name: 'AI_CAN_BEST_TIME' as SettingName,
    title: 'Suggest the best time to call',
    note: "From the client's country, local time and past answers",
  },
  voice: {
    name: 'AI_CAN_VOICE' as SettingName,
    title: 'Turn voice notes into text',
    note: 'And find fields like budget and unit: "Save 4 to lead"',
  },
  brief: {
    name: 'AI_CAN_BRIEF' as SettingName,
    title: 'Write the morning brief for owners',
    note: 'One short text on the dashboard at 08:30',
  },
  chat: {
    name: 'AI_CAN_CHAT' as SettingName,
    title: 'Answer questions in Homes AI chat',
    note: 'Agents ask about their own leads. Owners ask about the team.',
  },
} as const;

export type AiFeature = keyof typeof AI_FEATURES;

export const AI_FEATURE_KEYS = Object.keys(AI_FEATURES) as AiFeature[];

export async function aiFeatures(exec: Executor = getPool()): Promise<Record<AiFeature, boolean>> {
  const values = await Promise.all(
    AI_FEATURE_KEYS.map((key) => setting(AI_FEATURES[key].name, exec)),
  );
  return Object.fromEntries(
    /* Unset means never chosen, which is on — not off. */
    AI_FEATURE_KEYS.map((key, i) => [key, values[i] !== '0']),
  ) as Record<AiFeature, boolean>;
}

/** Is one feature allowed? Called at the point of use, not only on screen. */
export async function aiFeatureOn(feature: AiFeature, exec: Executor = getPool()): Promise<boolean> {
  return (await setting(AI_FEATURES[feature].name, exec)) !== '0';
}

export async function saveAiFeatures(
  actor: AuditActor,
  input: Partial<Record<AiFeature, boolean>>,
  exec: Executor = getPool(),
): Promise<Record<AiFeature, boolean>> {
  await Promise.all(
    AI_FEATURE_KEYS.filter((key) => input[key] !== undefined).map((key) =>
      saveSetting(actor, AI_FEATURES[key].name, input[key] ? '1' : '0', exec),
    ),
  );
  return aiFeatures(exec);
}
