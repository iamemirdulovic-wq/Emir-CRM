/**
 * "Send a test" — the button that used to lie.
 *
 * On 15 Nov the owner finished setting up Firebase, pressed "Send a test" on
 * Settings, My notifications, read **"it works"**, and then spent an hour
 * asking why no alert had arrived anywhere. Nothing had been sent. The button
 * called no endpoint at all: it showed a toast saying it worked and flipped
 * the card's subtitle to "test sent just now". The card above it said
 * "Notifications are on" as a hardcoded heading, whether or not a key was set
 * and whether or not a single device had ever been registered.
 *
 * So this is the real thing, and the point of it is the *answer*. A boolean
 * would be no better than the toast: "did not work" sends an owner into the
 * Firebase console when the truth is that his own phone was never registered,
 * which is one tap on My Day. Five outcomes, five different people who have
 * to do something, five sentences.
 *
 * Two rules it keeps:
 *
 *  - **It only ever reaches the person who pressed it.** The user id comes
 *    from the session and the request body carries nothing, so there is no
 *    route here by which one person makes another's phone buzz.
 *  - **"It works" is only said when a device actually accepted it.** Every
 *    other outcome says plainly what went wrong and where to go.
 *
 * The sentences live on the server rather than in the screen on purpose: this
 * is where the outcome is known, and a sentence written beside the thing that
 * produced it cannot drift out of step with it. `leads/no-emoji.test.ts`
 * checks this file for pictographs, like every other file that writes words a
 * person reads.
 */
import { queryOne, getPool, type Executor } from '../db/client.js';
import { pushConfigured, pushToUserDetailed, type PushOutcome } from '../messaging/push.js';

/** Where somebody goes to register a phone. Not this settings screen. */
const REGISTER_HERE = '/v2/home';

/**
 * Whether an alert could reach this person, and if not, which of the two
 * reasons it is.
 *
 * The same reasoning as `measureNotifications` on the health page — key first,
 * then devices, because they are different jobs for different people — read
 * for one person instead of for the whole office. One definition of "a key is
 * set" (`pushConfigured`), shared with the health page and the owner's setup
 * list, so the heading on this screen cannot claim something the health page
 * denies.
 */
export type AlertsState =
  /** No Firebase key on the server: nothing reaches anybody. */
  | 'no-key'
  /** Key is set, this person has registered no device. */
  | 'no-device'
  /** Key is set and at least one device is registered to this person. */
  | 'ok';

export interface Alerts {
  state: AlertsState;
  /** Whether the server could send at all. Never the key, in any form. */
  keySet: boolean;
  /** How many of this person's own devices are registered. */
  devices: number;
  /** The heading, which is the whole of what the old screen got wrong. */
  say: string;
  /** Where to go to fix it, when there is somewhere to go. */
  to: string | null;
}

export async function alertsFor(userId: string, exec: Executor = getPool()): Promise<Alerts> {
  const keySet = pushConfigured();
  const row = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM push_tokens WHERE user_id = ?',
    [userId],
    exec,
  );
  const devices = Number(row?.n ?? 0);

  if (!keySet) {
    return {
      state: 'no-key',
      keySet,
      devices,
      /* Said even when a device is registered, because it is still true: the
         device is registered and the server cannot reach it. */
      say: 'Notifications cannot be sent yet',
      to: null,
    };
  }
  if (devices === 0) {
    return {
      state: 'no-device',
      keySet,
      devices,
      say: 'No device gets your alerts yet',
      to: REGISTER_HERE,
    };
  }
  return {
    state: 'ok',
    keySet,
    devices,
    say: devices === 1 ? 'Notifications are on · 1 device' : `Notifications are on · ${devices} devices`,
    to: null,
  };
}

/* ── the test itself ───────────────────────────────────────────────────── */

export interface TestPush {
  outcome: PushOutcome;
  /** How many devices actually got it. Zero unless `outcome` is "sent". */
  reached: number;
  /** How many were registered to this person when the button was pressed. */
  registered: number;
  /** How many Firebase disowned, and this removed. */
  removed: number;
  /** One plain sentence: the whole of what the screen shows. */
  say: string;
  /** Where the person has to go to fix it, when there is somewhere. */
  to: string | null;
}

/**
 * What a person is told, per outcome.
 *
 * Written out rather than built from fragments so that each sentence can be
 * read whole, which is the only way to tell whether it is any use to somebody
 * who does not know what a token is.
 */
export function sayFor(result: { outcome: PushOutcome; delivered: number; removed: number }): {
  say: string;
  to: string | null;
} {
  switch (result.outcome) {
    case 'sent':
      return {
        /* The only place "it works" is allowed, and it is allowed because a
           device accepted it. */
        say: result.delivered === 1
          ? 'It works. The test alert reached 1 device.'
          : `It works. The test alert reached ${result.delivered} devices.`,
        to: null,
      };
    case 'no-credentials':
      return {
        say: 'Nothing was sent. The server has no Firebase key, so no alert can reach '
          + 'any device. The seven Firebase values go in the hosting panel under Node.js '
          + 'environment variables, and the site needs a restart afterwards.',
        to: null,
      };
    case 'no-device':
      return {
        say: 'Nothing was sent. No device is registered for you yet. Open My Day and tap '
          + '"Turn on notifications" on the card at the top — on the phone you want the '
          + 'alerts on, not here.',
        to: REGISTER_HERE,
      };
    case 'token-rejected':
      return {
        say: result.removed === 1
          ? 'Nothing was sent. Firebase says your registered device is gone, so it has '
            + 'been removed. Open My Day on that phone and tap "Turn on notifications" again.'
          : 'Nothing was sent. Firebase says your registered devices are gone, so they have '
            + 'been removed. Open My Day on the phone you want the alerts on and tap '
            + '"Turn on notifications" again.',
        to: REGISTER_HERE,
      };
    case 'failed':
      return {
        say: 'Nothing was sent. Firebase refused the request. Your device is fine — this is '
          + 'the key or Firebase itself. Try again in a minute, and if it keeps failing the '
          + 'Firebase values need checking.',
        to: null,
      };
    case 'test-copy':
      return {
        say: 'Nothing was sent. This is the test copy of the CRM, which never sends to a '
          + 'real device.',
        to: null,
      };
  }
}

/**
 * Send one test alert to the devices of the person who asked for it.
 *
 * It goes through `notify` nowhere and through `pushToUserDetailed` only: a
 * test is not a notification the bell should keep, and recording it would put
 * a row in the owner's bell every time he pressed the button. The bell is for
 * things that happened to a lead.
 */
export async function sendTestPush(userId: string): Promise<TestPush> {
  const result = await pushToUserDetailed(userId, {
    title: 'homes.me test alert',
    body: 'If you can read this on your phone, lead alerts will reach you here.',
    link: '/v2/settings/notifications',
    priority: 'high',
  });

  const { say, to } = sayFor(result);
  return {
    outcome: result.outcome,
    reached: result.delivered,
    registered: result.registered,
    removed: result.removed,
    say,
    to,
  };
}
