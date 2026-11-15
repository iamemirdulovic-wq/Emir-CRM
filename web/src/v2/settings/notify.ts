/**
 * The shape `/api/v2/notify` answers with.
 *
 * Shared by the General panel, which owns the sound settings, and the
 * Notifications panel, which owns the rest — both read and write the same
 * endpoint, so the type lives beside them rather than in either one.
 */
export interface NotifySwitch {
  id: string;
  title: string;
  note: string;
  alwaysOn: boolean;
}

export interface NotifyGroup {
  key: string;
  title: string;
  /** 'agent' or 'owner': which role the group is shown to. */
  forRole: string;
  switches: NotifySwitch[];
}

/**
 * Whether an alert could reach this person at all.
 *
 * Two separate facts, and the screen used to assert both of them: a Firebase
 * key on the server, and a device registered to this person. `server/src/v2/
 * test-push.ts` writes the sentence; nothing here invents one.
 */
export interface Alerts {
  state: 'no-key' | 'no-device' | 'ok';
  keySet: boolean;
  devices: number;
  say: string;
  to: string | null;
}

/** What `POST /api/v2/notifications/test` answers with. */
export interface TestPush {
  outcome: 'sent' | 'no-credentials' | 'no-device' | 'token-rejected' | 'failed' | 'test-copy';
  reached: number;
  registered: number;
  removed: number;
  say: string;
  to: string | null;
}

export interface Notify {
  switches: Record<string, boolean>;
  computer: boolean;
  sounds: boolean;
  volume: number;
  soundNewLead: boolean;
  soundWon: boolean;
  quiet: string | null;
  vipIgnoresQuiet: boolean;
  groups: NotifyGroup[];
  alerts: Alerts;
}
