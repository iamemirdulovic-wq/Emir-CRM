/**
 * What each person wants to hear about.
 *
 * `design/web/settings.html` lists about thirty switches across six groups,
 * and almost nobody will change more than two of them. So the stored value is
 * only the *differences* from the default — a person who changes nothing
 * stores nothing, and a switch added later arrives switched on for everybody
 * without a migration.
 *
 * It lives in `user_prefs`, scoped to the caller by construction: the user id
 * comes from the session, never from the request, so there is no path by which
 * one person reads or writes another's.
 *
 * Two of these cannot be switched off, and the design is right about why: a
 * VIP lead has a short clock, and an alert nobody hears is the clock running
 * out. `ALWAYS_ON` is enforced here rather than only in the UI, so a crafted
 * request cannot turn them off either.
 */
import { z } from 'zod';
import { execute, queryOne, type Executor, getPool } from '../db/client.js';

/**
 * Every switch, by the group it sits in, with the design's own wording.
 *
 * The note under each one is kept because it is the whole value of the
 * screen: "Lead goes back soon" means nothing, and "10 min before a VIP lead
 * goes back to Incoming" is a decision somebody can actually make.
 */
export const NOTIFY_GROUPS = {
  agent_leads: {
    title: 'My leads',
    forRole: 'agent',
    switches: {
      vip_lead: { title: 'VIP lead from the owner', note: 'You have a time limit to call. This alert is always loud.' },
      new_lead: { title: 'New lead given to me', note: 'From the owner, an import or a transfer' },
      going_back: { title: 'Lead goes back soon', note: '10 min before a VIP lead and 1 hour before an imported lead goes back to Incoming' },
      link_opened: { title: 'Client opened my link', note: 'Brochure, payment plan or location link' },
      transfer_in: { title: 'Transfer request for me', note: 'A colleague wants to give you a lead' },
      what_happened: { title: '"What happened?" reminders', note: 'When a WhatsApp or Telegram tap has no update yet' },
    },
  },
  agent_day: {
    title: 'My day',
    forRole: 'agent',
    switches: {
      followup_due: { title: 'Follow-up is due', note: 'At the time you planned' },
      meeting_soon: { title: 'Meeting or site visit', note: '2 hours before, and again 15 min before' },
      how_did_it_go: { title: '"How did it go?"', note: 'After each meeting · answer before 21:00' },
      task_from_owner: { title: 'Task from the owner', note: 'A new task or a change' },
      check_in: { title: 'Check-in reminder', note: 'At the start of the shift, only if you are not checked in' },
    },
  },
  agent_team: {
    title: 'Team and office',
    forRole: 'agent',
    switches: {
      leave_answered: { title: 'Leave request answered', note: 'Approved or refused' },
      owner_news: { title: 'News from the owner', note: 'Home banners and owner posts on the Team wall' },
      wall: { title: 'Team wall and Best of Homes', note: 'New posts, reactions, weekly results' },
    },
  },
  owner_leads: {
    title: 'Leads',
    forRole: 'owner',
    switches: {
      vip_late: { title: 'VIP lead not called in time', note: 'The lead came back to Incoming' },
      incoming_waiting: { title: 'Leads waiting in Incoming', note: 'When a lead waits more than 15 min' },
      transfer_approval: { title: 'Transfer needs my approval', note: 'Leads in Meeting or Offer stage' },
      unit_booked: { title: 'Unit booked', note: 'An agent marks a lead as Won' },
      wrong_number: { title: 'Wrong number flagged', note: 'An agent says the number is wrong' },
      import_done: { title: 'Import finished', note: 'Result per agent' },
    },
  },
  owner_team: {
    title: 'Team',
    forRole: 'owner',
    switches: {
      leave_requests: { title: 'Leave requests', note: 'A new request to answer' },
      agent_absent: { title: 'Agent absent', note: 'No check-in and no leave an hour into the shift' },
      agent_late: { title: 'Agent late', note: 'Check-in after the grace minutes' },
      working_outside: { title: 'Working outside', note: 'An agent starts or ends work outside' },
      meeting_result_missing: { title: 'Meeting result missing', note: 'Not answered by 21:00' },
    },
  },
  owner_system: {
    title: 'System',
    forRole: 'owner',
    switches: {
      new_sign_in: { title: 'New or unusual sign-in', note: 'A new device or a new place' },
      blocking_bug: { title: 'Blocking bug report', note: 'Feedback marked "Blocking my work"' },
      health: { title: 'System health problem', note: 'A service is slow or down' },
      ai_budget: { title: 'Homes AI budget', note: 'At 80% and at 100% of the month' },
    },
  },
} as const;

/**
 * The ones that start switched off.
 *
 * Everything else starts on, because somebody who has just been given the CRM
 * should hear about their leads before they have found this screen. These four
 * are the ones that would otherwise go off all day for no decision anybody
 * has to make.
 */
const OFF_BY_DEFAULT = new Set(['check_in', 'wall', 'wrong_number', 'agent_late', 'working_outside', 'ai_budget']);

/** Cannot be switched off: a short clock with a silent alert is no alert. */
export const ALWAYS_ON = new Set(['vip_lead', 'vip_late']);

export type NotifyKey = string;

export interface NotifySettings {
  /** Every switch and its current state, defaults applied. */
  switches: Record<NotifyKey, boolean>;
  /** Browser notifications on this person's computer. The phone is separate. */
  computer: boolean;
  /** Sound at all, and how loud. */
  sounds: boolean;
  volume: number;
  soundNewLead: boolean;
  soundWon: boolean;
  /** `null` means no quiet hours. Otherwise "22:00-08:00". */
  quiet: string | null;
  /** A VIP alert rings inside quiet hours. */
  vipIgnoresQuiet: boolean;
}

const QUIET_CHOICES = ['22:00-08:00', '20:00-09:00'] as const;

export const DEFAULTS: Omit<NotifySettings, 'switches'> = {
  computer: true,
  sounds: true,
  volume: 0.12,
  soundNewLead: true,
  soundWon: true,
  quiet: '22:00-08:00',
  vipIgnoresQuiet: true,
};

/** Every switch key that exists, which is what a write is checked against. */
export function everySwitch(): string[] {
  return Object.values(NOTIFY_GROUPS).flatMap((group) => Object.keys(group.switches));
}

function defaultSwitches(): Record<string, boolean> {
  return Object.fromEntries(everySwitch().map((key) => [key, !OFF_BY_DEFAULT.has(key)]));
}

/* Only the differences are stored, so the shape is deliberately loose. */
const storedSchema = z.object({
  off: z.array(z.string()).optional(),
  on: z.array(z.string()).optional(),
  computer: z.boolean().optional(),
  sounds: z.boolean().optional(),
  volume: z.number().optional(),
  soundNewLead: z.boolean().optional(),
  soundWon: z.boolean().optional(),
  quiet: z.string().nullable().optional(),
  vipIgnoresQuiet: z.boolean().optional(),
});

export async function notifySettings(
  userId: string,
  exec: Executor = getPool(),
): Promise<NotifySettings> {
  const row = await queryOne<{ value: string | null }>(
    "SELECT value FROM user_prefs WHERE user_id = ? AND name = 'notify'",
    [userId],
    exec,
  );

  const switches = defaultSwitches();
  const out: NotifySettings = { ...DEFAULTS, switches };
  if (!row?.value) return out;

  /* A value that will not parse is a value from an older shape. Falling back
     to the defaults is better than a 500 on the settings screen. */
  let stored: z.infer<typeof storedSchema>;
  try {
    stored = storedSchema.parse(JSON.parse(row.value));
  } catch {
    return out;
  }

  for (const key of stored.off ?? []) if (key in switches && !ALWAYS_ON.has(key)) switches[key] = false;
  for (const key of stored.on ?? []) if (key in switches) switches[key] = true;

  if (stored.computer !== undefined) out.computer = stored.computer;
  if (stored.sounds !== undefined) out.sounds = stored.sounds;
  if (stored.volume !== undefined) out.volume = stored.volume;
  if (stored.soundNewLead !== undefined) out.soundNewLead = stored.soundNewLead;
  if (stored.soundWon !== undefined) out.soundWon = stored.soundWon;
  if (stored.quiet !== undefined) out.quiet = stored.quiet;
  if (stored.vipIgnoresQuiet !== undefined) out.vipIgnoresQuiet = stored.vipIgnoresQuiet;
  return out;
}

export const saveSchema = z.object({
  switches: z.record(z.string(), z.boolean()).optional(),
  computer: z.boolean().optional(),
  sounds: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  soundNewLead: z.boolean().optional(),
  soundWon: z.boolean().optional(),
  quiet: z.enum(QUIET_CHOICES).nullable().optional(),
  vipIgnoresQuiet: z.boolean().optional(),
});

/**
 * Save a change. Only what the caller sent is changed; the rest is left alone,
 * so two tabs on this screen cannot wipe each other's switches.
 */
export async function saveNotifySettings(
  userId: string,
  input: z.infer<typeof saveSchema>,
  exec: Executor = getPool(),
): Promise<NotifySettings> {
  const now = await notifySettings(userId, exec);
  const next: NotifySettings = { ...now, switches: { ...now.switches } };

  for (const [key, on] of Object.entries(input.switches ?? {})) {
    /* An unknown key is a typo or an older client, not a new preference. */
    if (!(key in next.switches)) continue;
    next.switches[key] = ALWAYS_ON.has(key) ? true : on;
  }
  /* Written out one by one rather than looped: a loop over the field names
     needs a cast to an index signature, and a cast is exactly the thing that
     would let a renamed field through without the compiler noticing. */
  if (input.computer !== undefined) next.computer = input.computer;
  if (input.sounds !== undefined) next.sounds = input.sounds;
  if (input.volume !== undefined) next.volume = input.volume;
  if (input.soundNewLead !== undefined) next.soundNewLead = input.soundNewLead;
  if (input.soundWon !== undefined) next.soundWon = input.soundWon;
  if (input.vipIgnoresQuiet !== undefined) next.vipIgnoresQuiet = input.vipIgnoresQuiet;
  if (input.quiet !== undefined) next.quiet = input.quiet;

  /* Store the differences only. */
  const base = defaultSwitches();
  const value = JSON.stringify({
    off: Object.keys(next.switches).filter((key) => base[key] && !next.switches[key]),
    on: Object.keys(next.switches).filter((key) => !base[key] && next.switches[key]),
    ...Object.fromEntries(
      (Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>)
        .filter((field) => next[field] !== DEFAULTS[field])
        .map((field) => [field, next[field]]),
    ),
  });

  await execute(
    `INSERT INTO user_prefs (user_id, name, value) VALUES (?, 'notify', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [userId, value],
    exec,
  );
  return next;
}
