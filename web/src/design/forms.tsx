import {
  forwardRef, useEffect, useId, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon.js';
import {
  COUNTRIES, countryOfE164, DEFAULT_COUNTRY, flagOf, maxLengthOf, readPhone, type Country,
} from './phone.js';

/**
 * The inputs an agent touches on a phone, in a car park, between viewings.
 *
 * Everything here is built on the design system that is already in
 * `ui.tsx` — the same `.btn`, `.input` and `.chip` classes — rather than
 * beside it, so there is one button in this CRM and not two that look nearly
 * the same.
 */

/* ── Button ────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'whatsapp';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn btn-primary',
  secondary: 'btn',
  ghost: 'btn btn-ghost',
  danger: 'btn btn-danger',
  whatsapp: 'btn btn-wa',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  /** Shows a spinner and blocks clicks, without the button changing width. */
  loading?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, block, children, className, disabled, ...rest },
  ref,
) {
  const classes = [
    VARIANT[variant],
    size !== 'md' ? `btn-${size}` : '',
    block ? 'btn-block' : '',
    loading ? 'is-loading' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <button ref={ref} type="button" className={classes} disabled={disabled || loading} {...rest}>
      {/*
        * The label stays in the DOM under the spinner rather than being
        * swapped out, so the button keeps its width and the row of buttons
        * beside it does not jump while something saves.
        */}
      {loading && <span className="btn-spin" aria-hidden />}
      <span className="btn-label">
        {icon && <Icon name={icon} />}
        {children}
      </span>
    </button>
  );
});

export function IconButton({
  icon, label, variant = 'secondary', className, ...rest
}: Omit<ButtonProps, 'icon' | 'children'> & { icon: IconName; label: string }) {
  return (
    <Button
      variant={variant}
      /* Merged, not replaced: spreading a className over this used to drop
         `icon-btn` itself and leave the button unstyled. */
      className={className ? `icon-btn ${className}` : 'icon-btn'}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} />
    </Button>
  );
}

/* ── Phone ─────────────────────────────────────────────────────────────── */

export interface PhoneInputProps {
  /** E.164, or '' — the only thing the server is ever told. */
  value: string;
  onChange: (e164: string, valid: boolean) => void;
  label?: ReactNode;
  required?: boolean;
  autoFocus?: boolean;
  /** Shows the problem under the field once the agent has moved on. */
  showProblem?: boolean;
}

export function PhoneInput({
  value, onChange, label = 'Phone', required, autoFocus, showProblem = true,
}: PhoneInputProps) {
  const id = useId();
  const [country, setCountry] = useState<Country>(() => countryOfE164(value) ?? DEFAULT_COUNTRY);
  const [raw, setRaw] = useState(() => readPhone(value, countryOfE164(value) ?? DEFAULT_COUNTRY).display);
  const [touched, setTouched] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const parsed = readPhone(raw, country);

  function set(nextRaw: string, nextCountry: Country) {
    const next = readPhone(nextRaw, nextCountry);
    setRaw(next.display);
    onChange(next.e164, next.valid);
  }

  const problem = touched && showProblem ? parsed.problem : null;

  return (
    <div className="field phone-field">
      <span id={`${id}-label`}>
        {label}
        {required && <em className="req" aria-hidden> *</em>}
      </span>

      <div className={problem ? 'phone-row has-problem' : 'phone-row'}>
        <button
          type="button"
          className="phone-country"
          aria-label={`Country: ${country.name}, +${country.dial}`}
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((open) => !open)}
        >
          <span className="phone-flag" aria-hidden>{flagOf(country.iso)}</span>
          <span className="phone-dial">+{country.dial}</span>
          <Icon name="chevron-down" size={14} />
        </button>

        <input
          className="input phone-number"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          aria-labelledby={`${id}-label`}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          autoFocus={autoFocus}
          placeholder={readPhone('5'.repeat(maxLengthOf(country)), country).display}
          value={raw}
          onChange={(event) => set(event.target.value, country)}
          onBlur={() => setTouched(true)}
        />
      </div>

      {pickerOpen && (
        <CountryPicker
          current={country}
          onPick={(next) => {
            setCountry(next);
            setPickerOpen(false);
            /* Re-read the same digits against the new country, so switching
               from UAE to India regroups rather than clearing the field. */
            set(raw, next);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {problem && <small className="field-problem" id={`${id}-problem`}>{problem}</small>}
    </div>
  );
}

function CountryPicker({
  current, onPick, onClose,
}: { current: Country; onPick: (country: Country) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const needle = search.trim().toLowerCase();
  const shown = needle
    ? COUNTRIES.filter((item) => item.name.toLowerCase().includes(needle) || item.dial.startsWith(needle.replace('+', '')))
    : COUNTRIES;

  return (
    <div className="country-picker" ref={box} role="dialog" aria-label="Choose a country">
      <input
        className="input"
        autoFocus
        placeholder="Search country or code"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ul>
        {shown.map((item) => (
          <li key={`${item.iso}-${item.dial}`}>
            <button
              type="button"
              className={item.iso === current.iso ? 'on' : undefined}
              onClick={() => onPick(item)}
            >
              <span aria-hidden>{flagOf(item.iso)}</span>
              <span className="country-name">{item.name}</span>
              <span className="country-dial">+{item.dial}</span>
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="country-none">No country matches “{search}”.</li>}
      </ul>
    </div>
  );
}

/* ── Money ─────────────────────────────────────────────────────────────── */

/**
 * A budget in AED, with the separators in as it is typed.
 *
 * Controlled by a number, not a string: a budget that round-trips through
 * `"2,500,000"` is a budget waiting to be parsed wrong somewhere later.
 */
export function CurrencyInput({
  value, onChange, placeholder = '0', ...rest
}: {
  value: number | null;
  onChange: (value: number | null) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const shown = value === null || Number.isNaN(value) ? '' : value.toLocaleString('en-AE');

  return (
    <span className="money-input">
      <span className="money-prefix" aria-hidden>AED</span>
      <input
        {...rest}
        className="input"
        type="text"
        inputMode="numeric"
        placeholder={placeholder}
        value={shown}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D+/g, '');
          onChange(digits === '' ? null : Number(digits));
        }}
      />
    </span>
  );
}

/* ── Combobox ──────────────────────────────────────────────────────────── */

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

/**
 * Type to search, pick from the list — or keep what was typed.
 *
 * `allowFree` is the point of it here: a project that is not in the library
 * yet must still be recordable, because the alternative is an agent leaving
 * the field blank and the lead arriving with no project at all.
 */
export function Combobox({
  options, value, onChange, placeholder, allowFree, emptyHint, loading, id,
}: {
  options: ComboOption[];
  value: string;
  onChange: (value: string, option: ComboOption | null) => void;
  placeholder?: string;
  allowFree?: boolean;
  emptyHint?: string;
  loading?: boolean;
  id?: string;
}) {
  const listId = useId();
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setSearch(value), [value]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options.slice(0, 50);
    return options.filter((option) => option.label.toLowerCase().includes(needle)).slice(0, 50);
  }, [options, search]);

  function choose(option: ComboOption) {
    setSearch(option.label);
    onChange(option.label, option);
    setOpen(false);
  }

  return (
    <div className="combo" ref={box}>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setActive(0);
          setOpen(true);
          /* Free text counts the moment it is typed, so a half-typed project
             is not lost when the agent tabs away without picking. */
          if (allowFree) onChange(event.target.value, null);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActive((at) => Math.min(at + 1, shown.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((at) => Math.max(at - 1, 0));
          } else if (event.key === 'Enter' && open && shown[active]) {
            event.preventDefault();
            choose(shown[active]);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
      />

      {open && (
        <ul className="combo-list" id={listId} role="listbox">
          {loading && <li className="combo-note">Searching…</li>}
          {!loading && shown.map((option, index) => (
            <li key={option.value} role="option" aria-selected={index === active}>
              <button
                type="button"
                className={index === active ? 'on' : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
                {option.hint && <small>{option.hint}</small>}
              </button>
            </li>
          ))}
          {!loading && shown.length === 0 && (
            <li className="combo-note">
              {allowFree
                ? <>Not in the list — “{search}” will be saved as typed.</>
                : (emptyHint ?? 'Nothing matches.')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ── When ──────────────────────────────────────────────────────────────── */

/**
 * A time to come back to this lead.
 *
 * The quick chips are the whole point. An agent setting a callback does not
 * want a calendar; they want "tomorrow morning", and the picker underneath is
 * for the one time in ten that it is something else.
 */
export function WhenField({
  value, onChange, quick = true,
}: {
  /** An ISO string in the browser's own zone, or '' for not set. */
  value: string;
  onChange: (value: string) => void;
  quick?: boolean;
}) {
  const options = useMemo(() => quickTimes(), []);

  return (
    <div className="when-field">
      {quick && (
        <div className="when-quick">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              className={value === option.value ? 'chip on' : 'chip'}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <input
        className="input"
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {/*
        * Browsers format their own date control from the browser's language,
        * which we do not control — an agent whose phone is set to US English
        * gets month-first, and 10/11 means two different days to two people
        * in the same office. So the chosen time is echoed back the way the
        * rest of the CRM writes it, where there is nothing to misread.
        */}
      {value && <small className="when-echo">{describeLocalInput(value)}</small>}
    </div>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Read back a `datetime-local` value as "Fri 31 Oct 2026 · 10:00".
 *
 * Built from the string's own parts rather than a Date and a timezone: the
 * value is already wall-clock time, and converting it to a zone and back is
 * how a 10:00 callback becomes a 06:00 one.
 */
export function describeLocalInput(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return '';
  const [, year, month, day, hour, minute] = match as unknown as string[];
  const weekday = DAYS[new Date(Number(year), Number(month) - 1, Number(day)).getDay()];
  return `${weekday} ${Number(day)} ${MONTHS[Number(month) - 1]} ${year} · ${hour}:${minute}`;
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in local time, not an ISO UTC string. */
export function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function quickTimes(now = new Date()): { label: string; value: string }[] {
  const at = (days: number, hour: number, minute = 0) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    return localInputValue(date);
  };

  const inAnHour = new Date(now.getTime() + 60 * 60 * 1000);
  const options = [
    { label: 'In 1 hour', value: localInputValue(inAnHour) },
    { label: 'In 2 hours', value: localInputValue(new Date(now.getTime() + 2 * 60 * 60 * 1000)) },
  ];

  /* Only offer tonight while there is still an evening left to offer. */
  if (now.getHours() < 18) options.push({ label: 'Tonight 19:00', value: at(0, 19) });
  options.push({ label: 'Tomorrow 10:00', value: at(1, 10) });
  options.push({ label: 'In 3 days', value: at(3, 10) });
  return options;
}

/* ── Budget range ──────────────────────────────────────────────────────── */

const STEPS = [
  500_000, 750_000, 1_000_000, 1_250_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000,
  4_000_000, 5_000_000, 7_500_000, 10_000_000, 15_000_000, 20_000_000,
];

export function budgetStepLabel(aed: number): string {
  if (aed >= 20_000_000) return 'AED 20M+';
  if (aed >= 1_000_000) return `AED ${(aed / 1_000_000).toFixed(aed % 1_000_000 === 0 ? 0 : 1)}M`;
  return `AED ${Math.round(aed / 1_000)}K`;
}

/**
 * Two handles over a fixed ladder of prices rather than a free number line.
 *
 * Nobody's budget is AED 1,337,000. Snapping to the bands the market actually
 * uses makes the control usable with a thumb and makes the answers comparable
 * across leads, which is what the budget reports need.
 */
export function BudgetRange({
  min, max, onChange,
}: {
  min: number | null;
  max: number | null;
  onChange: (min: number | null, max: number | null) => void;
}) {
  const lowAt = indexOf(min, 0);
  const highAt = indexOf(max, STEPS.length - 1);

  function indexOf(value: number | null, fallback: number): number {
    if (value === null) return fallback;
    const exact = STEPS.indexOf(value);
    if (exact >= 0) return exact;
    /* A budget typed elsewhere may not be on the ladder; show the nearest. */
    let nearest = 0;
    for (let at = 1; at < STEPS.length; at += 1) {
      if (Math.abs((STEPS[at] as number) - value) < Math.abs((STEPS[nearest] as number) - value)) nearest = at;
    }
    return nearest;
  }

  const last = STEPS.length - 1;
  const pct = (at: number) => (at / last) * 100;

  return (
    <div className="budget-range">
      <output className="budget-read">
        {budgetStepLabel(STEPS[lowAt] as number)} — {budgetStepLabel(STEPS[highAt] as number)}
      </output>

      {/*
        * One track with two handles on it, not two sliders stacked. The native
        * inputs stay — they are what makes this work with a keyboard and a
        * screen reader — but their own tracks are hidden and only the thumbs
        * show, over a track drawn underneath.
        */}
      <div className="budget-slider" style={{ ['--low' as string]: `${pct(lowAt)}%`, ['--high' as string]: `${pct(highAt)}%` }}>
        <span className="budget-track" aria-hidden />
        <span className="budget-fill" aria-hidden />
        <input
          type="range" min={0} max={last} value={lowAt}
          aria-label="Lowest budget"
          aria-valuetext={budgetStepLabel(STEPS[lowAt] as number)}
          onChange={(event) => {
            const at = Math.min(Number(event.target.value), highAt);
            onChange(STEPS[at] as number, STEPS[highAt] as number);
          }}
        />
        <input
          type="range" min={0} max={last} value={highAt}
          aria-label="Highest budget"
          aria-valuetext={budgetStepLabel(STEPS[highAt] as number)}
          onChange={(event) => {
            const at = Math.max(Number(event.target.value), lowAt);
            onChange(STEPS[lowAt] as number, STEPS[at] as number);
          }}
        />
      </div>

      <div className="budget-ends" aria-hidden>
        <span>{budgetStepLabel(STEPS[0] as number)}</span>
        <span>{budgetStepLabel(STEPS[last] as number)}</span>
      </div>
    </div>
  );
}
