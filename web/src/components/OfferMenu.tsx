import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../design/index.js';

export type MenuItem =
  | { kind: 'item'; id: string; label: string; icon: IconName; danger?: boolean }
  | { kind: 'rule' };

/**
 * The ⋯ row menu.
 *
 * It is positioned in `fixed` coordinates off the button that opened it, then
 * nudged back on screen — a card at the right edge of the grid would otherwise
 * open its menu past the edge of the phone, and a card near the bottom would
 * open one that runs off underneath the tab bar.
 */
export function OfferMenu({
  anchor, items, onPick, onClose,
}: {
  anchor: DOMRect;
  items: MenuItem[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // Measured before paint, so the menu never appears in the wrong place first.
  useLayoutEffect(() => {
    const rect = box.current?.getBoundingClientRect();
    const width = rect?.width ?? 200;
    const height = rect?.height ?? 300;
    const gap = 6;
    setAt({
      left: Math.max(gap, Math.min(anchor.right - width, window.innerWidth - width - gap)),
      top: anchor.bottom + height + gap > window.innerHeight
        ? Math.max(gap, anchor.top - height - gap)
        : anchor.bottom + gap,
    });
  }, [anchor]);

  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    // `capture` so the click that opened it does not immediately close it.
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={box}
      className="menu"
      role="menu"
      style={{ left: at?.left ?? -9999, top: at?.top ?? -9999, visibility: at ? 'visible' : 'hidden' }}
    >
      {items.map((item, index) => (
        item.kind === 'rule'
          ? <hr key={`rule-${index}`} />
          : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : undefined}
              onClick={() => { onPick(item.id); onClose(); }}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          )
      ))}
    </div>
  );
}
