/**
 * Shared UI pieces, each a direct port of markup in the approved design.
 * Anything here should be recognisable line-for-line in
 * design/emir-crm-design.html.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon.js';
import { avatarColour, initials, stageStyle } from './stages.js';
import type { StageKey } from '../lib/types.js';

/* ── Identity ─────────────────────────────────────────────────────────── */

export function Avatar({
  name, size, colour, className,
}: { name: string | null; size?: number; colour?: string; className?: string }) {
  const seed = name ?? '?';
  return (
    <span
      className={className ? `avatar ${className}` : 'avatar'}
      style={{
        background: colour ?? avatarColour(seed),
        ...(size ? { width: size, height: size, fontSize: Math.round(size * 0.38) } : {}),
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function StagePill({ stage, label }: { stage: StageKey; label: string }) {
  const style = stageStyle(stage);
  return (
    <span className="stage-pill" style={{ ['--c' as string]: style.colour }}>
      <Icon name={style.icon} size={14} />
      {label}
    </span>
  );
}

/** A lead score, flagged hot at 70 as the specification requires. */
export function Score({ value }: { value: number }) {
  const hot = value >= 70;
  return (
    <span className={hot ? 'score hot' : 'score'} title={`Lead score ${value} of 100`}>
      {hot ? '🔥 ' : ''}
      {value}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

const CHANNEL_CLASS: Record<string, string> = {
  whatsapp: 'wa', email: 'em', sms: 'sms', note: 'note', system: 'note',
};

const CHANNEL_ICON: Record<string, IconName> = {
  whatsapp: 'message-circle', email: 'mail', sms: 'message-square',
  note: 'sticky-note', system: 'zap',
};

export function ChannelBadge({ channel }: { channel: string }) {
  return (
    <span className={`ch ${CHANNEL_CLASS[channel] ?? 'note'}`} title={channel}>
      <Icon name={CHANNEL_ICON[channel] ?? 'circle'} />
    </span>
  );
}

/* ── Layout ───────────────────────────────────────────────────────────── */

export function Panel({
  title, icon, action, span, index, children, className,
}: {
  title?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  /** Columns of the 12-wide dashboard grid. */
  span?: 3 | 4 | 5 | 6 | 7 | 8 | 12;
  /** Entrance order; the design staggers panels 70ms apart. */
  index?: number;
  children: ReactNode;
  className?: string;
}) {
  const classes = ['panel', span ? `span-${span}` : '', index === undefined ? '' : 'rise', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <section className={classes} style={index === undefined ? undefined : { ['--i' as string]: index }}>
      {title && (
        <h3>
          {icon && <Icon name={icon} />}
          {title}
          {action}
        </h3>
      )}
      {children}
    </section>
  );
}

export function Toolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="toolbar rise" style={{ ['--i' as string]: 0 }}>
      {children}
      {right && <div className="right">{right}</div>}
    </div>
  );
}

export function Chip({
  on, icon, onClick, children,
}: { on?: boolean; icon?: IconName; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" className={on ? 'chip on' : 'chip'} aria-pressed={on} onClick={onClick}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/** The small segmented control the design uses for chart ranges. */
export function Seg<T extends string | number>({
  value, options, onChange,
}: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <span className="seg">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={option.value === value ? 'on' : undefined}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/* ── Feedback ─────────────────────────────────────────────────────────── */

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted" style={{ padding: 28, textAlign: 'center' }} role="status">
      {label}
    </p>
  );
}

export function Empty({ icon = 'inbox', title, hint }: { icon?: IconName; title: string; hint?: string }) {
  return (
    <div style={{ padding: '38px 20px', textAlign: 'center', color: 'var(--ink-3)' }}>
      <Icon name={icon} size={30} />
      <p style={{ margin: '10px 0 2px', fontWeight: 600, color: 'var(--ink-2)' }}>{title}</p>
      {hint && <p style={{ margin: 0, fontSize: 13 }}>{hint}</p>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="err" style={{ display: 'block' }} role="alert">
      {children}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="note">
      <Icon name="info" />
      <span>{children}</span>
    </p>
  );
}

/* ── Toast ────────────────────────────────────────────────────────────── */

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}

const TOAST_MS = 2600;

export function ToastHost({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number>();

  const show = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* role=status rather than alert: a confirmation should not interrupt
          whatever the screen reader is already saying. */}
      <div className={message ? 'toast show' : 'toast'} role="status" aria-live="polite">
        {message && (
          <>
            <Icon name="check-circle-2" />
            <span>{message}</span>
          </>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/* ── Modal ────────────────────────────────────────────────────────────── */

/**
 * A centred dialog, for the things a drawer is the wrong shape for — mainly
 * the task form, which is a form and not a record.
 *
 * Portalled to `document.body` for the same reason the pipeline's stage menu
 * is: every panel on this app scrolls or clips something, and a dialog rendered
 * inside one inherits that clipping. Focus moves into the dialog on open and
 * back to whatever opened it on close, so keyboard and screen-reader users are
 * not left behind in the page underneath.
 */
export function Modal({
  open, onClose, title, icon, footer, children, wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: IconName;
  footer?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !card.current) return;
      // Keep Tab inside the dialog: without this it walks off into the page
      // behind, which for a modal means tabbing into controls you cannot see.
      const focusable = card.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    // After paint, or the element is not in the document to focus yet.
    const raf = requestAnimationFrame(() => {
      card.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    });

    return () => {
      document.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-wrap" role="presentation">
      <div className="scrim show" onClick={onClose} aria-hidden />
      <div
        className={wide ? 'modal wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={card}
      >
        <div className="drawer-head">
          {icon && <Icon name={icon} style={{ color: 'var(--primary)' }} />}
          <b style={{ flex: 1 }}>{title}</b>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ── Drawer ───────────────────────────────────────────────────────────── */

export function Drawer({
  open, onClose, label, children,
}: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className={open ? 'scrim show' : 'scrim'} onClick={onClose} aria-hidden />
      <aside
        className={open ? 'drawer show' : 'drawer'}
        aria-label={label}
        aria-hidden={!open}
      >
        {/* Nothing is rendered while the drawer is closed, so there is never a
            focusable control sitting off-screen in the tab order. */}
        {open && children}
      </aside>
    </>
  );
}

export function DrawerHead({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="drawer-head">
      {children}
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
        <Icon name="x" />
      </button>
    </div>
  );
}

/* ── Form fields ──────────────────────────────────────────────────────── */

export function Field({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={props.className ? `input ${props.className}` : 'input'} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={props.className ? `input ${props.className}` : 'input'} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={props.className ? `input ${props.className}` : 'input'} />;
}

/* ── Money and time ───────────────────────────────────────────────────── */

/** A budget range as agents write it: "AED 1.5–2.5M". */
export function budgetLabel(min: number | null, max: number | null, band: string | null): string {
  const short = (value: number) =>
    value >= 1_000_000
      ? `${Number((value / 1_000_000).toFixed(1))}M`
      : `${Math.round(value / 1000)}K`;
  if (min && max) return `AED ${short(min)}–${short(max)}`;
  if (min) return `AED ${short(min)}+`;
  if (max) return `up to AED ${short(max)}`;
  return band ?? '—';
}

/** "18s", "2m 10s", "1h 4m" — the leaderboard's first-reply column. */
export function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

/** Relative time for lists: "now", "12m", "3h", "2d", then the date. */
export function ago(value: string | null): string {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Counts down to a deadline: "3:12 left", or null once it has passed. */
export function useCountdown(deadline: string | null): string | null {
  const now = useNow(1000);
  return useMemo(() => {
    if (!deadline) return null;
    const remaining = new Date(deadline).getTime() - now;
    if (!Number.isFinite(remaining) || remaining <= 0) return null;
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')} left`;
  }, [deadline, now]);
}
