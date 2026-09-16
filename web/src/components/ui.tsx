import type { ReactNode } from 'react';
import { avatarColor, initials, scoreTone, stageTone, humanize } from '../lib/format.js';

import { Icon } from './Icon.js';

// Re-exported so pages keep a single import site for UI primitives.
export { Icon };

export function Avatar({ name, size = 'md' }: { name: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const dimensions = size === 'sm' ? 'h-7 w-7 text-xs' : size === 'lg' ? 'h-12 w-12 text-base' : 'h-9 w-9 text-sm';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${avatarColor(name)} ${dimensions}`}
      title={name ?? undefined}
    >
      {initials(name)}
    </span>
  );
}

export function ScoreChip({ score }: { score: number }) {
  return (
    <span className={`chip ${scoreTone(score)}`} title={`Lead score ${score}/100`}>
      {score >= 70 && <Icon name="local_fire_department" className="!text-[14px]" />}
      {score}
    </span>
  );
}

export function StageChip({ stage }: { stage: string }) {
  return <span className={`chip ${stageTone(stage)}`}>{humanize(stage)}</span>;
}

export function Tag({ value }: { value: string }) {
  const [namespace] = value.split(':');
  const tone =
    namespace === 'intent'
      ? 'bg-rose-50 text-rose-700'
      : namespace === 'src'
        ? 'bg-sky-50 text-sky-700'
        : namespace === 'lang'
          ? 'bg-violet-50 text-violet-700'
          : namespace === 'proj'
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-slate-100 text-slate-600';
  return <span className={`chip ${tone}`}>{value}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 p-8 text-sm text-slate-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      <Icon name={icon} className="!text-4xl text-slate-300" />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-slate-400">{hint}</p> : null}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-4 flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
      <Icon name="error" className="!text-[20px]" />
      <div className="flex-1">
        <p>{message}</p>
        {onRetry ? (
          <button type="button" className="mt-2 text-xs font-semibold underline" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      {/* Clicking the backdrop closes; the panel stops propagation. */}
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-e2 sm:max-w-lg sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button type="button" className="btn-ghost !px-2" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Toast({ message, tone = 'info' }: { message: string; tone?: 'info' | 'success' | 'error' }) {
  const tones = {
    info: 'bg-slate-800',
    success: 'bg-emerald-600',
    error: 'bg-rose-600',
  } as const;
  return (
    <div
      className={`fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-e2 sm:bottom-6 ${tones[tone]}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}

/** Delivery ticks, the way WhatsApp shows them. */
export function DeliveryTicks({ status }: { status: string }) {
  if (status === 'failed') return <Icon name="error" className="!text-[14px] text-rose-500" />;
  if (status === 'read') return <Icon name="done_all" className="!text-[14px] text-sky-500" />;
  if (status === 'delivered') return <Icon name="done_all" className="!text-[14px] text-slate-400" />;
  if (status === 'sent') return <Icon name="done" className="!text-[14px] text-slate-400" />;
  if (status === 'queued') return <Icon name="schedule" className="!text-[14px] text-slate-300" />;
  return null;
}

export function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, { icon: string; tone: string; label: string }> = {
    whatsapp: { icon: 'chat', tone: 'bg-emerald-50 text-emerald-700', label: 'WhatsApp' },
    email: { icon: 'mail', tone: 'bg-sky-50 text-sky-700', label: 'Email' },
    sms: { icon: 'sms', tone: 'bg-violet-50 text-violet-700', label: 'SMS' },
    note: { icon: 'sticky_note_2', tone: 'bg-amber-50 text-amber-800', label: 'Note' },
    system: { icon: 'settings', tone: 'bg-slate-100 text-slate-600', label: 'System' },
  };
  const meta = map[channel] ?? map.system;
  return (
    <span className={`chip ${meta!.tone}`}>
      <Icon name={meta!.icon} className="!text-[14px]" />
      {meta!.label}
    </span>
  );
}
