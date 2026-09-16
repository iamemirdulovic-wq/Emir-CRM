/**
 * Inline SVG icons.
 *
 * Deliberately not an icon font from a CDN: this is an installable PWA used by
 * agents on phones, and a blocked or slow font host made every icon render as
 * raw ligature text ("view_kanban", "logout"). Inline SVG always draws, works
 * offline, and costs nothing at runtime.
 *
 * One consistent 24px grid, 1.75 stroke, round caps and joins.
 */

type IconName =
  | 'home_work' | 'view_kanban' | 'forum' | 'contacts' | 'apartment' | 'insights' | 'description'
  | 'group' | 'search' | 'refresh' | 'translate' | 'logout' | 'close' | 'error' | 'warning'
  | 'arrow_back' | 'chevron_left' | 'chevron_right' | 'call' | 'mail' | 'sms' | 'chat'
  | 'person' | 'person_add' | 'person_off' | 'person_check' | 'send' | 'add' | 'download'
  | 'check_circle' | 'radio_button_unchecked' | 'cancel' | 'done' | 'done_all' | 'schedule'
  | 'verified' | 'pending' | 'lock_reset' | 'lock_open' | 'lock_clock' | 'block'
  | 'note_add' | 'sticky_note_2' | 'settings' | 'smart_toy' | 'auto_awesome' | 'psychology'
  | 'moving' | 'timer_off' | 'picture_as_pdf' | 'drive_file_move' | 'payments' | 'history'
  | 'inventory_2' | 'edit_note' | 'sync' | 'library_add' | 'local_fire_department' | 'crown'
  | 'circle' | 'brochure';

/** Path data for each icon, drawn on a 24×24 grid. */
const PATHS: Record<string, JSX.Element> = {
  home_work: <><path d="M3 21V9l6-4 6 4v12" /><path d="M9 21v-5h3v5" /><path d="M15 12h6v9h-6" /><path d="M18 15v.01M18 18v.01" /></>,
  view_kanban: <><rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="11" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" /></>,
  forum: <><path d="M4 4h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-5 4V6a2 2 0 0 1 2-2z" /><path d="M20 9v8a2 2 0 0 1-2 2h-6" /></>,
  contacts: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="10" r="2.5" /><path d="M8 17c.8-1.7 2.3-2.5 4-2.5s3.2.8 4 2.5" /></>,
  apartment: <><path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" /><path d="M14 10h5a1 1 0 0 1 1 1v10" /><path d="M7 8h.01M11 8h.01M7 12h.01M11 12h.01M7 16h.01M11 16h.01M17 14h.01M17 18h.01" /></>,
  insights: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="M7 15l4-5 3 3 5-7" /></>,
  description: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
  group: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" /><path d="M16 5.5a3 3 0 0 1 0 5.8" /><path d="M17 15c2.4.5 4 2.2 4 5" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-3.6-3.6" /></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>,
  translate: <><path d="M4 6h10" /><path d="M9 4v2c0 4-2.2 7-5 8" /><path d="M6 11c1.4 2.3 3.6 3.8 6 4.5" /><path d="M13 21l4-10 4 10" /><path d="M14.5 18h5" /></>,
  logout: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M16 16l4-4-4-4" /><path d="M20 12H10" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  error: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.01" /></>,
  warning: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4M12 17.5v.01" /></>,
  arrow_back: <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>,
  chevron_left: <path d="m14 6-6 6 6 6" />,
  chevron_right: <path d="m10 6 6 6-6 6" />,
  call: <path d="M6.5 3h3l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2L21 14.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.2 2 2 0 0 1 6 3z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  sms: <><path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" /><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" /></>,
  chat: <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" />,
  person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /></>,
  person_add: <><circle cx="10" cy="8" r="3.5" /><path d="M3 20c0-3.6 3.1-6 7-6 1.3 0 2.5.3 3.5.7" /><path d="M18 14v6M15 17h6" /></>,
  person_off: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /><path d="m4 4 16 16" /></>,
  person_check: <><circle cx="10" cy="8" r="3.5" /><path d="M3 20c0-3.6 3.1-6 7-6 1.1 0 2.2.2 3.1.6" /><path d="m15 17 2 2 4-4" /></>,
  send: <><path d="M4 12 20.5 4 13 20.5l-2-7z" /><path d="m11 13.5 9.5-9.5" /></>,
  add: <path d="M12 5v14M5 12h14" />,
  download: <><path d="M12 4v11" /><path d="m7.5 11 4.5 4.5 4.5-4.5" /><path d="M5 19h14" /></>,
  check_circle: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>,
  radio_button_unchecked: <circle cx="12" cy="12" r="9" />,
  cancel: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>,
  done: <path d="m5 13 4.5 4.5L19 7" />,
  done_all: <><path d="m3 13 3.5 3.5L14 8" /><path d="m11 16 1 1 8.5-9.5" /></>,
  schedule: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>,
  verified: <><path d="m12 3 2.3 2.1 3.1-.4.9 3 2.8 1.4-1.4 2.8.4 3.1-3 .9-2 2.4-2.1-1.2-2.1 1.2-2-2.4-3-.9.4-3.1L4.9 9.1l2.8-1.4.9-3 3.1.4z" /><path d="m9 12 2 2 4-4" /></>,
  pending: <><circle cx="12" cy="12" r="9" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>,
  lock_reset: <><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7-2.6" /><path d="M12 14.5v2" /></>,
  lock_open: <><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.8-1.3" /></>,
  lock_clock: <><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /><path d="M12 14v2l1.5 1" /></>,
  block: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  note_add: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /><path d="M14 3v5h5" /><path d="M18 3v6M15 6h6" /></>,
  sticky_note_2: <><path d="M5 4h14a1 1 0 0 1 1 1v9l-6 6H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M20 14h-5a1 1 0 0 0-1 1v5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" /></>,
  smart_toy: <><rect x="4" y="8" width="16" height="11" rx="3" /><path d="M12 4v4" /><circle cx="9" cy="13" r="1" /><circle cx="15" cy="13" r="1" /><path d="M2 12v3M22 12v3" /></>,
  auto_awesome: <><path d="m12 4 1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.3z" /><path d="M18.5 16.5 19 18l1.5.5-1.5.5-.5 1.5-.5-1.5L16.5 19l1.5-.5z" /></>,
  psychology: <><path d="M15.5 20v-2.5h2a1.5 1.5 0 0 0 1.5-1.5v-1.5h1.2a.6.6 0 0 0 .5-1L19 10a7 7 0 1 0-10.5 6.8V20" /><path d="M11 10.5a1.5 1.5 0 1 1 2.2 1.3c-.5.3-.7.7-.7 1.2" /></>,
  moving: <><path d="M4 17 10 11l3.5 3.5L20 8" /><path d="M15 8h5v5" /></>,
  timer_off: <><circle cx="12" cy="13" r="8" /><path d="M9 3h6" /><path d="m4 4 16 16" /></>,
  picture_as_pdf: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M8.5 16v-3h1a1 1 0 0 1 0 2h-1M13 16v-3h1a1.5 1.5 0 0 1 0 3z" /></>,
  drive_file_move: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M11 13h5m-2-2.5 2.5 2.5-2.5 2.5" /></>,
  payments: <><rect x="2.5" y="7" width="15" height="10" rx="2" /><circle cx="10" cy="12" r="2.2" /><path d="M21.5 9.5v7a2 2 0 0 1-2 2H7" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.4-5.7" /><path d="M4 4v4h4" /><path d="M12 8v4.5l3 1.8" /></>,
  inventory_2: <><path d="M3 8h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M2.5 4.5h19V8h-19z" /><path d="M10 12h4" /></>,
  edit_note: <><path d="M4 7h11M4 12h7M4 17h5" /><path d="m15.5 17.5 5-5 2 2-5 5H15.5z" /></>,
  sync: <><path d="M4 12a8 8 0 0 1 13.7-5.6" /><path d="M20 12a8 8 0 0 1-13.7 5.6" /><path d="M18 3v4h-4M6 21v-4h4" /></>,
  library_add: <><rect x="8" y="3" width="13" height="13" rx="2" /><path d="M14.5 6.5v6M11.5 9.5h6" /><path d="M5 7v12a2 2 0 0 0 2 2h12" /></>,
  local_fire_department: <path d="M12 3s5 4.2 5 9a5 5 0 0 1-10 0c0-1.6.6-2.8 1.3-3.7.4 1 1.2 1.7 2.2 1.7 0-3 1.5-5.5 1.5-7z" />,
  crown: <><path d="m3 18 1.5-11L9 12l3-7 3 7 4.5-5L21 18z" /><path d="M3 18h18" /></>,
  circle: <circle cx="12" cy="12" r="4" />,
  brochure: <><path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z" /><path d="M20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z" /></>,
};

export function Icon({ name, className = '' }: { name: IconName | string; className?: string }) {
  const path = PATHS[name] ?? PATHS.circle;
  return (
    <svg
      viewBox="0 0 24 24"
      className={`inline-block h-[1.25em] w-[1.25em] shrink-0 align-[-0.2em] ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  );
}
