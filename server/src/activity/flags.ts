/**
 * What is worth telling the owner about a sign-in.
 *
 * A list of sessions is not useful. Ten agents signing in from their phones
 * every morning is the normal state of the world, and an owner who has to
 * read it will stop reading it by Thursday. What is useful is the row that
 * does not belong.
 *
 * Every flag below is one an owner could act on. There is deliberately no
 * flag for "signed in from a phone" or "signed in at 9am", because those are
 * not events — they are Tuesday.
 */

export type FlagLevel = 'info' | 'watch' | 'alarm';

export interface SessionFlag {
  key: string;
  level: FlagLevel;
  /** Shown as-is. Written for somebody who is not a programmer. */
  message: string;
}

export interface SessionFacts {
  userName: string;
  deviceKey: string;
  deviceLabel: string;
  network: string | null;
  city: string | null;
  country: string | null;
  at: Date;
  /** Devices this person has signed in from before. */
  knownDevices: string[];
  knownNetworks: string[];
  knownCountries: string[];
  /** Their previous session, for working out whether the jump is possible. */
  previous: { at: Date; country: string | null; city: string | null } | null;
  /** True when this account has never signed in before. */
  firstEver: boolean;
}

/** Dubai is UTC+4 all year, so office hours are a fixed offset from UTC. */
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

function dubaiHour(at: Date): number {
  return new Date(at.getTime() + DUBAI_OFFSET_MS).getUTCHours();
}

/**
 * Hours nobody should be working.
 *
 * Not 6pm — agents in this business work evenings, and flagging that would
 * bury the real thing. Between 1am and 5am is different: an account active
 * then is either somebody who should be asleep or somebody who is not them.
 */
export function isOddHour(at: Date): boolean {
  const hour = dubaiHour(at);
  return hour >= 1 && hour < 5;
}

export function flagsFor(facts: SessionFacts): SessionFlag[] {
  const flags: SessionFlag[] = [];

  /* The first sign-in on a new account is expected, and flagging the device
     and the city as well would be three alarms for one ordinary event. */
  if (facts.firstEver) {
    return [{
      key: 'first_sign_in',
      level: 'info',
      message: `${facts.userName} signed in for the first time.`,
    }];
  }

  if (!facts.knownDevices.includes(facts.deviceKey)) {
    flags.push({
      key: 'new_device',
      level: 'watch',
      message: `${facts.userName} signed in on a ${facts.deviceLabel} for the first time.`,
    });
  }

  if (facts.country && facts.knownCountries.length > 0 && !facts.knownCountries.includes(facts.country)) {
    flags.push({
      key: 'new_country',
      level: 'alarm',
      message: `${facts.userName} signed in from ${facts.country}, which they have never done before.`,
    });
  } else if (
    facts.network
    && facts.knownNetworks.length > 0
    && !facts.knownNetworks.includes(facts.network)
    /* A new network inside a known country is ordinary — a different café,
       a 4G connection instead of the office wifi. Worth noting, not worth
       an alarm. */
  ) {
    flags.push({
      key: 'new_network',
      level: 'info',
      message: `${facts.userName} signed in from a different internet connection${facts.city ? ` in ${facts.city}` : ''}.`,
    });
  }

  if (isOddHour(facts.at)) {
    flags.push({
      key: 'odd_hour',
      level: 'watch',
      message: `${facts.userName} was active at ${formatDubai(facts.at)} Dubai time.`,
    });
  }

  const impossible = impossibleTravel(facts);
  if (impossible) flags.push(impossible);

  return flags;
}

/**
 * Two countries too close together in time to have flown between.
 *
 * The single strongest sign that a password is being used by somebody else,
 * and the one thing in here that is worth waking an owner for. Six hours is
 * deliberately generous — Dubai to London is seven — so this fires on
 * "Dubai and Manila twenty minutes apart", not on a long flight.
 */
export const IMPOSSIBLE_TRAVEL_HOURS = 6;

function impossibleTravel(facts: SessionFacts): SessionFlag | null {
  const previous = facts.previous;
  if (!previous || !previous.country || !facts.country) return null;
  if (previous.country === facts.country) return null;

  const hours = (facts.at.getTime() - previous.at.getTime()) / 3_600_000;
  if (hours < 0 || hours >= IMPOSSIBLE_TRAVEL_HOURS) return null;

  return {
    key: 'impossible_travel',
    level: 'alarm',
    message:
      `${facts.userName} was in ${previous.country} and then in ${facts.country} `
      + `${hours < 1 ? 'less than an hour' : `about ${Math.round(hours)} hours`} later. `
      + 'That is not a journey anyone makes, so the password may be in use by somebody else.',
  };
}

function formatDubai(at: Date): string {
  const dubai = new Date(at.getTime() + DUBAI_OFFSET_MS);
  return `${String(dubai.getUTCHours()).padStart(2, '0')}:${String(dubai.getUTCMinutes()).padStart(2, '0')}`;
}

/** The worst thing in a set of flags, which is what colours the row. */
export function worstLevel(flags: SessionFlag[]): FlagLevel | null {
  if (flags.some((flag) => flag.level === 'alarm')) return 'alarm';
  if (flags.some((flag) => flag.level === 'watch')) return 'watch';
  if (flags.length > 0) return 'info';
  return null;
}

/**
 * Is this session still live?
 *
 * Two minutes of silence, because the browser sends a heartbeat every thirty
 * seconds. One missed beat is a tunnel or a lift; four is a closed laptop.
 */
export const LIVE_WITHIN_MS = 2 * 60 * 1000;

export function isLive(lastSeenAt: Date, now: Date = new Date()): boolean {
  const gap = now.getTime() - lastSeenAt.getTime();
  return gap >= 0 && gap < LIVE_WITHIN_MS;
}

/** "Just now", "4 minutes ago" — what a table column needs. */
export function describeLastSeen(lastSeenAt: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - lastSeenAt.getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}
