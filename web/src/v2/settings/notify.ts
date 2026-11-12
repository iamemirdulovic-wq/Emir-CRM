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
}
