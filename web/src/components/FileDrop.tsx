import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Icon } from '../design/index.js';
import type { IconName } from '../design/Icon.js';

/**
 * A drop zone that also opens the file picker when clicked.
 *
 * Deliberately both: on a phone there is nothing to drag, and an agent
 * photographing a price list at a developer's office is on a phone.
 */
export function FileDrop({
  accept, multiple = true, icon = 'image-up', title, hint, disabled, onFiles,
}: {
  accept: string;
  multiple?: boolean;
  icon?: IconName;
  title: string;
  hint: ReactNode;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function take(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    if (!disabled) take(event.dataTransfer.files);
  }

  return (
    <>
      <button
        type="button"
        className={over ? 'drop over' : 'drop'}
        onClick={() => input.current?.click()}
        onDragOver={(event) => { event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        disabled={disabled}
        style={{ width: '100%' }}
      >
        <div className="ic"><Icon name={icon} /></div>
        <b>{title}</b>
        <small>{hint}</small>
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(event) => { take(event.target.files); event.target.value = ''; }}
      />
    </>
  );
}

/** How big a file is, in the units a person uses. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
