import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon.js';
import { CountUp } from './CountUp.js';
import { Button } from './forms.js';

/**
 * The parts of the CRM that tell an agent what is happening: what is loading,
 * what the number is, how long is left, what happened to this lead and when.
 */

/* ── Badge ─────────────────────────────────────────────────────────────── */

export function Badge({
  count, tone = 'urgent', label,
}: { count: number; tone?: 'urgent' | 'quiet'; label?: string }) {
  if (count <= 0) return null;
  return (
    <span className={tone === 'urgent' ? 'badge urgent' : 'badge'} aria-label={label ?? `${count}`}>
      {/* 99+ rather than a number that stretches the pill out of its nav row. */}
      {count > 99 ? '99+' : count}
    </span>
  );
}

/* ── Skeleton ──────────────────────────────────────────────────────────── */

/**
 * The shape of what is coming, not a spinner.
 *
 * A spinner says "wait"; a skeleton says "a list of leads is about to be
 * here", and because it is the same height as the real row the page does not
 * jump when the data lands.
 */
export function Skeleton({
  width, height = 14, radius = 6, className,
}: { width?: number | string; height?: number; radius?: number; className?: string }) {
  return (
    <span
      className={className ? `skeleton ${className}` : 'skeleton'}
      style={{ width: width ?? '100%', height, borderRadius: radius }}
      aria-hidden
    />
  );
}

export function SkeletonRows({ rows = 6, children }: { rows?: number; children?: ReactNode }) {
  return (
    <div className="skeleton-rows" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          {children ?? (
            <>
              <Skeleton width={36} height={36} radius={999} />
              <span className="skeleton-stack">
                <Skeleton width={`${45 + ((index * 13) % 30)}%`} />
                <Skeleton width={`${28 + ((index * 7) % 22)}%`} height={11} />
              </span>
              <Skeleton width={64} height={22} radius={999} />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Stat card ─────────────────────────────────────────────────────────── */

export function StatCard({
  icon, label, value, suffix, trend, hint, onClick, tone,
}: {
  icon?: IconName;
  label: string;
  value: number | string;
  suffix?: string;
  /** Change against the previous period, as a signed number. */
  trend?: number | null;
  hint?: string;
  onClick?: () => void;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const body = (
    <>
      <span className="stat-head">
        {icon && <span className="stat-icon"><Icon name={icon} /></span>}
        <span className="stat-label">{label}</span>
      </span>
      <strong className={tone ? `stat-value ${tone}` : 'stat-value'}>
        {typeof value === 'number' ? <CountUp value={value} /> : value}
        {suffix && <small>{suffix}</small>}
      </strong>
      {(hint || trend !== undefined && trend !== null) && (
        <span className="stat-foot">
          {trend !== undefined && trend !== null && trend !== 0 && (
            <span className={trend > 0 ? 'trend up' : 'trend down'}>
              <Icon name={trend > 0 ? 'arrow-up' : 'arrow-down-left'} size={13} />
              {Math.abs(trend)}
            </span>
          )}
          {hint && <span className="stat-hint">{hint}</span>}
        </span>
      )}
    </>
  );

  if (!onClick) return <div className="stat-card">{body}</div>;
  return (
    <button type="button" className="stat-card is-link" onClick={onClick}>
      {body}
    </button>
  );
}

/* ── Countdown ring ────────────────────────────────────────────────────── */

const RING = 54;
const CIRCUMFERENCE = 2 * Math.PI * RING;

/**
 * The five minutes, drawn.
 *
 * Teal, then amber under two minutes, then red under one — the colour changes
 * before the agent has read the number, which is the point. It counts down
 * from a deadline the server set, so a phone with the wrong clock still shows
 * the real time left.
 */
export function CountdownRing({
  deadline, size = 120, onExpire,
}: {
  /** When the time runs out, from the server. */
  deadline: Date | string;
  size?: number;
  onExpire?: () => void;
}) {
  const ends = typeof deadline === 'string' ? new Date(deadline) : deadline;
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  const msLeft = ends.getTime() - now;
  const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));

  useEffect(() => {
    if (msLeft <= 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [msLeft, onExpire]);

  /*
   * The arc is drawn against five minutes whatever the real window is, so the
   * ring empties at a pace an agent learns to read. A longer SLA just starts
   * it fuller.
   */
  const fraction = Math.max(0, Math.min(1, msLeft / (5 * 60 * 1000)));
  const tone = secondsLeft <= 60 ? 'late' : secondsLeft <= 120 ? 'soon' : 'fine';

  return (
    <div className={`ring ${tone}`} style={{ width: size, height: size }} role="timer" aria-live="off">
      <svg viewBox="0 0 120 120" aria-hidden>
        <circle className="ring-track" cx="60" cy="60" r={RING} />
        <circle
          className="ring-arc"
          cx="60" cy="60" r={RING}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <span className="ring-time">
        {secondsLeft > 0
          ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
          : '0:00'}
      </span>
      <span className="sr-only">
        {secondsLeft > 0 ? `${secondsLeft} seconds left to call` : 'Time is up'}
      </span>
    </div>
  );
}

/* ── Timeline ──────────────────────────────────────────────────────────── */

export function TimelineItem({
  icon, tone, title, meta, children,
}: {
  icon: IconName;
  /** Picks the circle's colour; keep it to what the event means. */
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'whatsapp';
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className={`tl-item${tone && tone !== 'default' ? ` ${tone}` : ''}`}>
      <span className="tl-dot" aria-hidden><Icon name={icon} size={15} /></span>
      <div className="tl-body">
        <span className="tl-title" dir="auto">{title}</span>
        {meta && <span className="tl-meta">{meta}</span>}
        {children && <div className="tl-extra" dir="auto">{children}</div>}
      </div>
    </li>
  );
}

/* ── Confirm ───────────────────────────────────────────────────────────── */

/**
 * Only for the owner actions that cannot be undone.
 *
 * Everything reversible gets an Undo toast instead: a dialog in front of every
 * action trains people to click through dialogs, which is how the one that
 * mattered gets clicked through too.
 */
export function ConfirmDialog({
  open, title, body, confirmLabel, cancelLabel = 'Cancel', danger, busy, typeToConfirm, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  /** When set, the exact text the person must type before confirming. */
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const blocked = Boolean(typeToConfirm) && typed.trim() !== typeToConfirm;

  return (
    <>
      <div className="scrim show" onClick={onCancel} aria-hidden />
      <div className="confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <b>
          <Icon name={danger ? 'alert-triangle' : 'circle-alert'} style={{ color: danger ? 'var(--s-lost)' : 'var(--s-att)' }} />
          {title}
        </b>
        <div className="confirm-body">{body}</div>

        {typeToConfirm && (
          <label className="field">
            <span>Type <b>{typeToConfirm}</b> to confirm</span>
            <input className="input" autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} />
          </label>
        )}

        <div className="confirm-actions">
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={blocked}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number | null;
  /** Draws the count in red — for overdue, where the number is the warning. */
  alarm?: boolean;
}

export function Tabs<T extends string>({
  tabs, value, onChange, label,
}: { tabs: TabItem<T>[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={tab.value === value ? 'tab on' : 'tab'}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.count !== undefined && tab.count !== null && tab.count > 0 && (
            <span className={tab.alarm ? 'tab-count alarm' : 'tab-count'}>{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ── Bottom sheet ──────────────────────────────────────────────────────── */

/**
 * The mobile answer to a dialog: it comes up from the bottom, where the thumb
 * already is. On a desktop it is a small centred card instead, because a
 * sheet climbing up a 27-inch screen looks like a mistake.
 */
export function BottomSheet({
  open, title, onClose, children, footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="scrim show" onClick={onClose} aria-hidden />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <span className="sheet-grip" aria-hidden />
        <header className="sheet-head">
          <b>{title}</b>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </>
  );
}
